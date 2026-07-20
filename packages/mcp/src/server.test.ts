// ── createFigemiteMcpServer tool-registration tests ────────────────────────────
//
// Drives the MCP server end-to-end at the protocol layer (a real `Client`
// talking to the server over `InMemoryTransport.createLinkedPair()`) but with
// every external dependency faked: `makePeer` builds a `BoardPeer` wired to a
// non-networked fake `WebsocketProvider` (so connect_board never opens a
// socket), and board-mgmt tools' `fetch` calls are stubbed globally. Proves
// the ~18 tools are registered and wired to the right shared ops / HTTP calls
// — not just that `./tools.js` works in isolation (that's tools.test.ts).

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFigemiteMcpServer } from './server.js';
import { BoardPeer, type ProviderFactory } from './peer.js';
import { PeerDiscovery } from './discovery.js';
import { FakeAwareness } from './test/fake-awareness.js';

class FakeProvider {
  synced = true;
  awareness = new FakeAwareness();
  constructor(
    public serverUrl: string,
    public roomname: string,
    public doc: Y.Doc,
  ) {}
  on(): void {}
  off(): void {}
  destroy(): void {}
}

const makeFakeProvider: ProviderFactory = ((wsUrl: string, roomname: string, doc: Y.Doc) =>
  new FakeProvider(wsUrl, roomname, doc)) as unknown as ProviderFactory;

/** Track every BoardPeer built by the server under test so tests can inspect its doc/awareness directly. */
function makePeerTracker() {
  const peers: BoardPeer[] = [];
  const makePeer = (opts: ConstructorParameters<typeof BoardPeer>[0]): BoardPeer => {
    const peer = new BoardPeer({ ...opts, makeProvider: makeFakeProvider });
    peers.push(peer);
    return peer;
  };
  return { peers, makePeer, lastPeer: () => peers[peers.length - 1] };
}

async function connectedClient(options: Parameters<typeof createFigemiteMcpServer>[0] = {}) {
  const server = createFigemiteMcpServer(options);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content[0]?.text ?? '';
}

function jsonOf(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  return JSON.parse(textOf(result));
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createFigemiteMcpServer tool list', () => {
  it('registers all 20 board tools', async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'connect_board',
        'disconnect',
        'list_boards',
        'create_board',
        'list_drafts',
        'create_draft',
        'get_board',
        'get_node',
        'list_nodes',
        'move_cursor',
        'set_editing',
        'set_viewport',
        'add_node',
        'add_drawing',
        'update_node',
        'move_node',
        'delete_node',
        'set_node_text',
        'set_description',
        'add_edge',
        'update_edge',
        'delete_edge',
      ].sort(),
    );
  });

  it('does NOT register a promote/approve tool (human-only, enforced by omission)', async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('promote_draft');
    expect(names).not.toContain('promote');
    expect(names).not.toContain('approve_draft');
  });
});

describe('connect_board / disconnect', () => {
  it('connects, waits for sync, and returns the board snapshot', async () => {
    const { peers, makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });

    const result = await client.callTool({
      name: 'connect_board',
      arguments: { slug: 'spend' },
    });

    const parsed = jsonOf(result) as { connected: boolean; room: string; nodes: unknown[] };
    expect(parsed.connected).toBe(true);
    expect(parsed.room).toBe('spend');
    expect(parsed.nodes).toEqual([]);
    expect(peers).toHaveLength(1);
  });

  it('sets isAI awareness on the underlying peer', async () => {
    const { makePeer, lastPeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({ name: 'connect_board', arguments: { slug: 'spend', name: 'Claude' } });

    const state = lastPeer().awareness.getLocalState() as {
      isAI?: boolean;
      user?: { name: string };
    };
    expect(state?.isAI).toBe(true);
    expect(state?.user?.name).toBe('Claude');
  });

  it('reading before connecting throws a clear error', async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({ name: 'get_board', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not connected/i);
  });

  it('disconnect tears down the peer and clears connection state', async () => {
    const { makePeer, lastPeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({ name: 'connect_board', arguments: { slug: 'spend' } });

    const doc = lastPeer().doc;
    const destroySpy = vi.spyOn(doc, 'destroy');

    const result = await client.callTool({ name: 'disconnect', arguments: {} });
    expect(textOf(result)).toMatch(/disconnected/i);
    expect(destroySpy).toHaveBeenCalled();

    const after = await client.callTool({ name: 'get_board', arguments: {} });
    expect(after.isError).toBe(true);
  });

  it('resolves a bare address as a direct host, bypassing discovery, when no mDNS peer matches', async () => {
    const { makePeer, peers } = makePeerTracker();
    const discovery = new PeerDiscovery({
      makeBonjour: () => ({ find: () => fakeBrowser(), destroy() {} }),
    });
    const { client } = await connectedClient({ makePeer, discovery });

    await client.callTool({
      name: 'connect_board',
      arguments: { slug: 'spend', address: '10.0.0.9:6000' },
    });

    expect(peers[0].wsUrl).toBe('ws://10.0.0.9:6000/yjs');
  });
});

function fakeBrowser() {
  return { on: () => {} };
}

describe('board management tools (HTTP)', () => {
  it('list_boards GETs /api/boards on the default http url', async () => {
    let calledUrl = '';
    stubFetch(async (url) => {
      calledUrl = String(url);
      return jsonResponse({ boards: [{ slug: 'spend' }] });
    });
    const { client } = await connectedClient({ defaultHttpUrl: 'http://localhost:5400' });

    const result = await client.callTool({ name: 'list_boards', arguments: {} });

    expect(calledUrl).toBe('http://localhost:5400/api/boards');
    expect(jsonOf(result)).toEqual({ boards: [{ slug: 'spend' }] });
  });

  it('create_board POSTs /api/boards with slug/label', async () => {
    let calledBody: unknown;
    stubFetch(async (_url, init) => {
      calledBody = JSON.parse(String(init?.body ?? '{}'));
      return jsonResponse({ ok: true, slug: 'new-board' });
    });
    const { client } = await connectedClient();

    const result = await client.callTool({
      name: 'create_board',
      arguments: { slug: 'new-board', label: 'New Board' },
    });

    expect(calledBody).toEqual({ slug: 'new-board', label: 'New Board' });
    expect(jsonOf(result)).toEqual({ ok: true, slug: 'new-board' });
  });

  it('list_boards targets the httpUrl from the most recent connect_board', async () => {
    const { makePeer } = makePeerTracker();
    let calledUrl = '';
    stubFetch(async (url) => {
      calledUrl = String(url);
      return jsonResponse({ boards: [] });
    });
    const discovery = new PeerDiscovery({
      makeBonjour: () => ({ find: () => fakeBrowser(), destroy() {} }),
    });
    const { client } = await connectedClient({ makePeer, discovery });

    await client.callTool({
      name: 'connect_board',
      arguments: { slug: 'spend', address: '10.0.0.9:6000' },
    });
    await client.callTool({ name: 'list_boards', arguments: {} });

    expect(calledUrl).toBe('http://10.0.0.9:6000/api/boards');
  });
});

describe('node/edge tools operate on the connected peer', () => {
  // Content edits require a DRAFT connection now (the live board is read-only),
  // so this helper connects to a draft.
  async function connectedWithPeer() {
    const { makePeer, lastPeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({ name: 'connect_board', arguments: { slug: 'spend', draft: 'd1' } });
    return { client, peer: () => lastPeer() };
  }

  it('add_node creates a node and returns its id', async () => {
    const { client } = await connectedWithPeer();
    const result = await client.callTool({
      name: 'add_node',
      arguments: { type: 'sticky', pos: { x: 10, y: 20 } },
    });
    const { id } = jsonOf(result) as { id: string };
    expect(id).toBeTruthy();

    const board = jsonOf(await client.callTool({ name: 'get_board', arguments: {} })) as {
      nodes: Array<{ id: string; type: string }>;
    };
    expect(board.nodes).toHaveLength(1);
    expect(board.nodes[0]).toMatchObject({ id, type: 'sticky' });
  });

  it('get_node returns a single node', async () => {
    const { client } = await connectedWithPeer();
    const { id } = jsonOf(
      await client.callTool({ name: 'add_node', arguments: { type: 'text', pos: { x: 0, y: 0 } } }),
    ) as { id: string };

    const result = await client.callTool({ name: 'get_node', arguments: { id } });
    expect(jsonOf(result)).toMatchObject({ id, type: 'text' });
  });

  it('get_node throws for a missing id', async () => {
    const { client } = await connectedWithPeer();
    const result = await client.callTool({ name: 'get_node', arguments: { id: 'nope' } });
    expect(result.isError).toBe(true);
  });

  it('list_nodes filters by type', async () => {
    const { client } = await connectedWithPeer();
    await client.callTool({ name: 'add_node', arguments: { type: 'sticky', pos: { x: 0, y: 0 } } });
    await client.callTool({ name: 'add_node', arguments: { type: 'text', pos: { x: 0, y: 0 } } });

    const result = await client.callTool({ name: 'list_nodes', arguments: { type: 'sticky' } });
    const nodes = jsonOf(result) as Array<{ type: string }>;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('sticky');
  });

  it('update_node merges a patch', async () => {
    const { client } = await connectedWithPeer();
    const { id } = jsonOf(
      await client.callTool({
        name: 'add_node',
        arguments: { type: 'sticky', pos: { x: 0, y: 0 }, color: '#fef3c7' },
      }),
    ) as { id: string };

    await client.callTool({ name: 'update_node', arguments: { id, patch: { color: '#dbeafe' } } });

    const node = jsonOf(await client.callTool({ name: 'get_node', arguments: { id } })) as {
      color: string;
    };
    expect(node.color).toBe('#dbeafe');
  });

  it('move_node updates position', async () => {
    const { client } = await connectedWithPeer();
    const { id } = jsonOf(
      await client.callTool({
        name: 'add_node',
        arguments: { type: 'sticky', pos: { x: 0, y: 0 } },
      }),
    ) as { id: string };

    await client.callTool({ name: 'move_node', arguments: { id, pos: { x: 50, y: 60 } } });

    const node = jsonOf(await client.callTool({ name: 'get_node', arguments: { id } })) as {
      pos: { x: number; y: number };
    };
    expect(node.pos).toEqual({ x: 50, y: 60 });
  });

  it('delete_node removes the node', async () => {
    const { client } = await connectedWithPeer();
    const { id } = jsonOf(
      await client.callTool({
        name: 'add_node',
        arguments: { type: 'sticky', pos: { x: 0, y: 0 } },
      }),
    ) as { id: string };

    await client.callTool({ name: 'delete_node', arguments: { id } });

    const result = await client.callTool({ name: 'get_node', arguments: { id } });
    expect(result.isError).toBe(true);
  });

  it('set_node_text sets the node text', async () => {
    const { client } = await connectedWithPeer();
    const { id } = jsonOf(
      await client.callTool({
        name: 'add_node',
        arguments: { type: 'sticky', pos: { x: 0, y: 0 } },
      }),
    ) as { id: string };

    await client.callTool({ name: 'set_node_text', arguments: { id, text: 'hello' } });

    const node = jsonOf(await client.callTool({ name: 'get_node', arguments: { id } })) as {
      text: string;
    };
    expect(node.text).toBe('hello');
  });

  it('set_description sets the description field', async () => {
    const { client } = await connectedWithPeer();
    const { id } = jsonOf(
      await client.callTool({ name: 'add_node', arguments: { type: 'text', pos: { x: 0, y: 0 } } }),
    ) as { id: string };

    await client.callTool({ name: 'set_description', arguments: { id, description: '# hi' } });

    const node = jsonOf(await client.callTool({ name: 'get_node', arguments: { id } })) as {
      description: string;
    };
    expect(node.description).toBe('# hi');
  });

  it('add_drawing creates a drawing node from absolute points', async () => {
    const { client } = await connectedWithPeer();
    const result = await client.callTool({
      name: 'add_drawing',
      arguments: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    });
    const { id } = jsonOf(result) as { id: string };

    const node = jsonOf(await client.callTool({ name: 'get_node', arguments: { id } })) as {
      type: string;
    };
    expect(node.type).toBe('drawing');
  });

  it('add_edge / update_edge / delete_edge operate on edges', async () => {
    const { client } = await connectedWithPeer();
    const a = (
      jsonOf(
        await client.callTool({
          name: 'add_node',
          arguments: { type: 'sticky', pos: { x: 0, y: 0 } },
        }),
      ) as { id: string }
    ).id;
    const b = (
      jsonOf(
        await client.callTool({
          name: 'add_node',
          arguments: { type: 'sticky', pos: { x: 0, y: 0 } },
        }),
      ) as { id: string }
    ).id;

    const { id: edgeId } = jsonOf(
      await client.callTool({ name: 'add_edge', arguments: { source: a, target: b } }),
    ) as { id: string };

    await client.callTool({
      name: 'update_edge',
      arguments: { id: edgeId, patch: { label: 'x' } },
    });
    let board = jsonOf(await client.callTool({ name: 'get_board', arguments: {} })) as {
      edges: Array<{ id: string; label?: string }>;
    };
    expect(board.edges.find((e) => e.id === edgeId)?.label).toBe('x');

    await client.callTool({ name: 'delete_edge', arguments: { id: edgeId } });
    board = jsonOf(await client.callTool({ name: 'get_board', arguments: {} })) as {
      edges: Array<{ id: string }>;
    };
    expect(board.edges.find((e) => e.id === edgeId)).toBeUndefined();
  });
});

describe('presence tools', () => {
  it('move_cursor / set_editing / set_viewport update peer awareness', async () => {
    const { makePeer, lastPeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({ name: 'connect_board', arguments: { slug: 'spend' } });

    await client.callTool({ name: 'move_cursor', arguments: { x: 3, y: 4 } });
    await client.callTool({ name: 'set_editing', arguments: { nodeId: null } });
    await client.callTool({ name: 'set_viewport', arguments: { x: 1, y: 2, zoom: 1.5 } });

    const state = lastPeer().awareness.getLocalState() as {
      cursor?: { x: number; y: number };
      editingNodeId?: string | null;
      viewport?: { x: number; y: number; zoom: number };
    };
    expect(state?.cursor).toEqual({ x: 3, y: 4 });
    expect(state?.editingNodeId).toBeNull();
    expect(state?.viewport).toEqual({ x: 1, y: 2, zoom: 1.5 });
  });
});

describe('BoardPeer does not flush to disk via the MCP tools', () => {
  it('never POSTs /api/board after node/edge mutations', async () => {
    const calledUrls: string[] = [];
    stubFetch(async (url) => {
      calledUrls.push(String(url));
      return jsonResponse({ ok: true });
    });
    const { makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    // Edits require a draft connection now (the live board is read-only).
    await client.callTool({ name: 'connect_board', arguments: { slug: 'spend', draft: 'd1' } });

    const { id } = jsonOf(
      await client.callTool({
        name: 'add_node',
        arguments: { type: 'sticky', pos: { x: 0, y: 0 } },
      }),
    ) as { id: string };
    await client.callTool({ name: 'move_node', arguments: { id, pos: { x: 5, y: 5 } } });
    await client.callTool({ name: 'set_node_text', arguments: { id, text: 'hi' } });
    await client.callTool({ name: 'delete_node', arguments: { id } });

    expect(calledUrls.some((u) => u.includes('/api/board'))).toBe(false);
  });
});

describe('the live board is read-only over MCP', () => {
  it('a content-mutating tool on a PROD connection returns the read-only error', async () => {
    const { makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({ name: 'connect_board', arguments: { slug: 'spend' } });

    const res = await client.callTool({
      name: 'add_node',
      arguments: { type: 'sticky', pos: { x: 0, y: 0 } },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/read-only|create a draft/i);
  });

  it('the same tool on a DRAFT connection succeeds', async () => {
    const { makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({ name: 'connect_board', arguments: { slug: 'spend', draft: 'd1' } });

    const res = await client.callTool({
      name: 'add_node',
      arguments: { type: 'sticky', pos: { x: 0, y: 0 } },
    });
    expect(res.isError).toBeFalsy();
    expect((jsonOf(res) as { id: string }).id).toBeTruthy();
  });

  it('read + presence tools still work on a PROD connection', async () => {
    const { makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({ name: 'connect_board', arguments: { slug: 'spend' } });

    const board = await client.callTool({ name: 'get_board', arguments: {} });
    expect(board.isError).toBeFalsy();
    const cursor = await client.callTool({ name: 'move_cursor', arguments: { x: 1, y: 2 } });
    expect(cursor.isError).toBeFalsy();
  });
});
