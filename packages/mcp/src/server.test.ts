// ── createFigemiteMcpServer tool-registration tests ────────────────────────────
//
// Drives the MCP server end-to-end at the protocol layer (a real `Client`
// talking to the server over `InMemoryTransport.createLinkedPair()`) but with
// every external dependency faked: `makePeer` builds a `BoardPeer` wired to a
// non-networked fake `WebsocketProvider` (so connect_board never opens a
// socket), a fake `InstanceRegistry` supplies instances without mDNS/health IO,
// and board-mgmt tools' `fetch` calls are stubbed globally. Proves the tools
// are registered and wired to the right shared ops / HTTP calls, and that every
// board/draft operation is addressed by instanceId (no shared active server).

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFigemiteMcpServer } from './server.js';
import { BoardPeer, type ProviderFactory } from './peer.js';
import type { Instance, InstanceRegistry } from './registry.js';
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

/** Build an Instance with sensible defaults for tests. */
function instance(id: string, httpUrl: string): Instance {
  return {
    id,
    name: id,
    httpUrl,
    wsUrl: `${httpUrl.replace(/^http/, 'ws')}/yjs`,
    boards: [],
    version: '0.0.0',
    lastSeen: 1,
    healthy: true,
  };
}

/** A minimal fake registry exposing only the methods createFigemiteMcpServer uses. */
function fakeRegistry(instances: Instance[]): InstanceRegistry {
  const map = new Map(instances.map((i) => [i.id, i]));
  return {
    get: (id: string) => map.get(id) ?? null,
    list: () => [...map.values()],
    healthyIds: () => [...map.keys()],
    start() {},
    warmUp: async () => {},
    dispose() {},
  } as unknown as InstanceRegistry;
}

const LOCAL = instance('local', 'http://localhost:5400');
const REMOTE = instance('remote', 'http://10.0.0.9:6000');

async function connectedClient(
  options: Parameters<typeof createFigemiteMcpServer>[0] = {},
) {
  const server = createFigemiteMcpServer({
    registry: fakeRegistry([LOCAL, REMOTE]),
    ...options,
  });
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
  it('registers all board tools including list_instances', async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'connect_board',
        'disconnect',
        'list_instances',
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

  it('every board/draft tool requires an instanceId', async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    const needsInstance = tools.filter((t) => t.name !== 'list_instances');
    for (const tool of needsInstance) {
      const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      expect(props, `${tool.name} should require instanceId`).toHaveProperty('instanceId');
    }
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

describe('list_instances', () => {
  it('returns the registry contents', async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({ name: 'list_instances', arguments: {} });
    const { instances } = jsonOf(result) as { instances: Instance[] };
    expect(instances.map((i) => i.id).sort()).toEqual(['local', 'remote']);
  });
});

describe('connect_board / disconnect', () => {
  it('connects to the instance, waits for sync, and returns the snapshot', async () => {
    const { peers, makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });

    const result = await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'local', slug: 'spend' },
    });

    const parsed = jsonOf(result) as {
      connected: boolean;
      instanceId: string;
      room: string;
      wsUrl: string;
      nodes: unknown[];
    };
    expect(parsed.connected).toBe(true);
    expect(parsed.instanceId).toBe('local');
    expect(parsed.room).toBe('spend');
    expect(parsed.wsUrl).toBe('ws://localhost:5400/yjs');
    expect(parsed.nodes).toEqual([]);
    expect(peers).toHaveLength(1);
  });

  it('resolves the wsUrl of the chosen instance', async () => {
    const { peers, makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });

    await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'remote', slug: 'spend' },
    });

    expect(peers[0].wsUrl).toBe('ws://10.0.0.9:6000/yjs');
  });

  it('rejects an unknown instanceId with a helpful error', async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'ghost', slug: 'spend' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/unknown or unhealthy instance/i);
    expect(textOf(result)).toMatch(/local, remote/);
  });

  it('sets isAI awareness on the underlying peer', async () => {
    const { makePeer, lastPeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'local', slug: 'spend', name: 'Claude' },
    });

    const state = lastPeer().awareness.getLocalState() as {
      isAI?: boolean;
      user?: { name: string };
    };
    expect(state?.isAI).toBe(true);
    expect(state?.user?.name).toBe('Claude');
  });

  it('reading before connecting throws a clear error', async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({
      name: 'get_board',
      arguments: { instanceId: 'local' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not connected/i);
  });

  it('disconnect tears down the peer and clears connection state', async () => {
    const { makePeer, lastPeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'local', slug: 'spend' },
    });

    const doc = lastPeer().doc;
    const destroySpy = vi.spyOn(doc, 'destroy');

    const result = await client.callTool({ name: 'disconnect', arguments: { instanceId: 'local' } });
    expect(textOf(result)).toMatch(/disconnected/i);
    expect(destroySpy).toHaveBeenCalled();

    const after = await client.callTool({ name: 'get_board', arguments: { instanceId: 'local' } });
    expect(after.isError).toBe(true);
  });

  it('holds independent connections per instance', async () => {
    const { peers, makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });

    await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'local', slug: 'spend', draft: 'd1' },
    });
    await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'remote', slug: 'plan', draft: 'd1' },
    });
    expect(peers).toHaveLength(2);

    // An edit to 'local' lands only on the local peer's doc.
    await client.callTool({
      name: 'add_node',
      arguments: { instanceId: 'local', type: 'sticky', pos: { x: 0, y: 0 } },
    });

    const localBoard = jsonOf(
      await client.callTool({ name: 'get_board', arguments: { instanceId: 'local' } }),
    ) as { nodes: unknown[] };
    const remoteBoard = jsonOf(
      await client.callTool({ name: 'get_board', arguments: { instanceId: 'remote' } }),
    ) as { nodes: unknown[] };
    expect(localBoard.nodes).toHaveLength(1);
    expect(remoteBoard.nodes).toHaveLength(0);
  });
});

describe('board management tools (HTTP)', () => {
  it('list_boards GETs /api/boards on the resolved instance url', async () => {
    let calledUrl = '';
    stubFetch(async (url) => {
      calledUrl = String(url);
      return jsonResponse({ boards: [{ slug: 'spend' }] });
    });
    const { client } = await connectedClient();

    const result = await client.callTool({
      name: 'list_boards',
      arguments: { instanceId: 'local' },
    });

    expect(calledUrl).toBe('http://localhost:5400/api/boards');
    expect(jsonOf(result)).toEqual({ boards: [{ slug: 'spend' }] });
  });

  it('targets a different instance url purely by instanceId (no shared active server)', async () => {
    let calledUrl = '';
    stubFetch(async (url) => {
      calledUrl = String(url);
      return jsonResponse({ boards: [] });
    });
    const { client } = await connectedClient();

    await client.callTool({ name: 'list_boards', arguments: { instanceId: 'remote' } });

    expect(calledUrl).toBe('http://10.0.0.9:6000/api/boards');
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
      arguments: { instanceId: 'local', slug: 'new-board', label: 'New Board' },
    });

    expect(calledBody).toEqual({ slug: 'new-board', label: 'New Board' });
    expect(jsonOf(result)).toEqual({ ok: true, slug: 'new-board' });
  });

  it('management tools reject an unknown instanceId', async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({
      name: 'list_boards',
      arguments: { instanceId: 'ghost' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/unknown or unhealthy instance/i);
  });
});

describe('node/edge tools operate on the connected peer', () => {
  // Content edits require a DRAFT connection now (the live board is read-only),
  // so this helper connects to a draft.
  async function connectedWithPeer() {
    const { makePeer, lastPeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'local', slug: 'spend', draft: 'd1' },
    });
    return { client, peer: () => lastPeer() };
  }

  it('add_node creates a node and returns its id', async () => {
    const { client } = await connectedWithPeer();
    const result = await client.callTool({
      name: 'add_node',
      arguments: { instanceId: 'local', type: 'sticky', pos: { x: 10, y: 20 } },
    });
    const { id } = jsonOf(result) as { id: string };
    expect(id).toBeTruthy();

    const board = jsonOf(
      await client.callTool({ name: 'get_board', arguments: { instanceId: 'local' } }),
    ) as {
      nodes: Array<{ id: string; type: string }>;
    };
    expect(board.nodes).toHaveLength(1);
    expect(board.nodes[0]).toMatchObject({ id, type: 'sticky' });
  });

  it('get_node returns a single node', async () => {
    const { client } = await connectedWithPeer();
    const { id } = jsonOf(
      await client.callTool({
        name: 'add_node',
        arguments: { instanceId: 'local', type: 'text', pos: { x: 0, y: 0 } },
      }),
    ) as { id: string };

    const result = await client.callTool({
      name: 'get_node',
      arguments: { instanceId: 'local', id },
    });
    expect(jsonOf(result)).toMatchObject({ id, type: 'text' });
  });

  it('get_node throws for a missing id', async () => {
    const { client } = await connectedWithPeer();
    const result = await client.callTool({
      name: 'get_node',
      arguments: { instanceId: 'local', id: 'nope' },
    });
    expect(result.isError).toBe(true);
  });

  it('list_nodes filters by type', async () => {
    const { client } = await connectedWithPeer();
    await client.callTool({
      name: 'add_node',
      arguments: { instanceId: 'local', type: 'sticky', pos: { x: 0, y: 0 } },
    });
    await client.callTool({
      name: 'add_node',
      arguments: { instanceId: 'local', type: 'text', pos: { x: 0, y: 0 } },
    });

    const result = await client.callTool({
      name: 'list_nodes',
      arguments: { instanceId: 'local', type: 'sticky' },
    });
    const nodes = jsonOf(result) as Array<{ type: string }>;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('sticky');
  });

  it('update_node merges a patch', async () => {
    const { client } = await connectedWithPeer();
    const { id } = jsonOf(
      await client.callTool({
        name: 'add_node',
        arguments: { instanceId: 'local', type: 'sticky', pos: { x: 0, y: 0 }, color: '#fef3c7' },
      }),
    ) as { id: string };

    await client.callTool({
      name: 'update_node',
      arguments: { instanceId: 'local', id, patch: { color: '#dbeafe' } },
    });

    const node = jsonOf(
      await client.callTool({ name: 'get_node', arguments: { instanceId: 'local', id } }),
    ) as {
      color: string;
    };
    expect(node.color).toBe('#dbeafe');
  });

  it('move_node updates position', async () => {
    const { client } = await connectedWithPeer();
    const { id } = jsonOf(
      await client.callTool({
        name: 'add_node',
        arguments: { instanceId: 'local', type: 'sticky', pos: { x: 0, y: 0 } },
      }),
    ) as { id: string };

    await client.callTool({
      name: 'move_node',
      arguments: { instanceId: 'local', id, pos: { x: 50, y: 60 } },
    });

    const node = jsonOf(
      await client.callTool({ name: 'get_node', arguments: { instanceId: 'local', id } }),
    ) as {
      pos: { x: number; y: number };
    };
    expect(node.pos).toEqual({ x: 50, y: 60 });
  });

  it('delete_node removes the node', async () => {
    const { client } = await connectedWithPeer();
    const { id } = jsonOf(
      await client.callTool({
        name: 'add_node',
        arguments: { instanceId: 'local', type: 'sticky', pos: { x: 0, y: 0 } },
      }),
    ) as { id: string };

    await client.callTool({ name: 'delete_node', arguments: { instanceId: 'local', id } });

    const result = await client.callTool({
      name: 'get_node',
      arguments: { instanceId: 'local', id },
    });
    expect(result.isError).toBe(true);
  });

  it('set_node_text sets the node text', async () => {
    const { client } = await connectedWithPeer();
    const { id } = jsonOf(
      await client.callTool({
        name: 'add_node',
        arguments: { instanceId: 'local', type: 'sticky', pos: { x: 0, y: 0 } },
      }),
    ) as { id: string };

    await client.callTool({
      name: 'set_node_text',
      arguments: { instanceId: 'local', id, text: 'hello' },
    });

    const node = jsonOf(
      await client.callTool({ name: 'get_node', arguments: { instanceId: 'local', id } }),
    ) as {
      text: string;
    };
    expect(node.text).toBe('hello');
  });

  it('set_description sets the description field', async () => {
    const { client } = await connectedWithPeer();
    const { id } = jsonOf(
      await client.callTool({
        name: 'add_node',
        arguments: { instanceId: 'local', type: 'text', pos: { x: 0, y: 0 } },
      }),
    ) as { id: string };

    await client.callTool({
      name: 'set_description',
      arguments: { instanceId: 'local', id, description: '# hi' },
    });

    const node = jsonOf(
      await client.callTool({ name: 'get_node', arguments: { instanceId: 'local', id } }),
    ) as {
      description: string;
    };
    expect(node.description).toBe('# hi');
  });

  it('add_drawing creates a drawing node from absolute points', async () => {
    const { client } = await connectedWithPeer();
    const result = await client.callTool({
      name: 'add_drawing',
      arguments: {
        instanceId: 'local',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    });
    const { id } = jsonOf(result) as { id: string };

    const node = jsonOf(
      await client.callTool({ name: 'get_node', arguments: { instanceId: 'local', id } }),
    ) as {
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
          arguments: { instanceId: 'local', type: 'sticky', pos: { x: 0, y: 0 } },
        }),
      ) as { id: string }
    ).id;
    const b = (
      jsonOf(
        await client.callTool({
          name: 'add_node',
          arguments: { instanceId: 'local', type: 'sticky', pos: { x: 0, y: 0 } },
        }),
      ) as { id: string }
    ).id;

    const { id: edgeId } = jsonOf(
      await client.callTool({
        name: 'add_edge',
        arguments: { instanceId: 'local', source: a, target: b },
      }),
    ) as { id: string };

    await client.callTool({
      name: 'update_edge',
      arguments: { instanceId: 'local', id: edgeId, patch: { label: 'x' } },
    });
    let board = jsonOf(
      await client.callTool({ name: 'get_board', arguments: { instanceId: 'local' } }),
    ) as {
      edges: Array<{ id: string; label?: string }>;
    };
    expect(board.edges.find((e) => e.id === edgeId)?.label).toBe('x');

    await client.callTool({ name: 'delete_edge', arguments: { instanceId: 'local', id: edgeId } });
    board = jsonOf(
      await client.callTool({ name: 'get_board', arguments: { instanceId: 'local' } }),
    ) as {
      edges: Array<{ id: string }>;
    };
    expect(board.edges.find((e) => e.id === edgeId)).toBeUndefined();
  });
});

describe('presence tools', () => {
  it('move_cursor / set_editing / set_viewport update peer awareness', async () => {
    const { makePeer, lastPeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'local', slug: 'spend' },
    });

    await client.callTool({ name: 'move_cursor', arguments: { instanceId: 'local', x: 3, y: 4 } });
    await client.callTool({
      name: 'set_editing',
      arguments: { instanceId: 'local', nodeId: null },
    });
    await client.callTool({
      name: 'set_viewport',
      arguments: { instanceId: 'local', x: 1, y: 2, zoom: 1.5 },
    });

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
    await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'local', slug: 'spend', draft: 'd1' },
    });

    const { id } = jsonOf(
      await client.callTool({
        name: 'add_node',
        arguments: { instanceId: 'local', type: 'sticky', pos: { x: 0, y: 0 } },
      }),
    ) as { id: string };
    await client.callTool({
      name: 'move_node',
      arguments: { instanceId: 'local', id, pos: { x: 5, y: 5 } },
    });
    await client.callTool({
      name: 'set_node_text',
      arguments: { instanceId: 'local', id, text: 'hi' },
    });
    await client.callTool({ name: 'delete_node', arguments: { instanceId: 'local', id } });

    expect(calledUrls.some((u) => u.includes('/api/board'))).toBe(false);
  });
});

describe('the live board is read-only over MCP', () => {
  it('a content-mutating tool on a PROD connection returns the read-only error', async () => {
    const { makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'local', slug: 'spend' },
    });

    const res = await client.callTool({
      name: 'add_node',
      arguments: { instanceId: 'local', type: 'sticky', pos: { x: 0, y: 0 } },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/read-only|create a draft/i);
  });

  it('the same tool on a DRAFT connection succeeds', async () => {
    const { makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'local', slug: 'spend', draft: 'd1' },
    });

    const res = await client.callTool({
      name: 'add_node',
      arguments: { instanceId: 'local', type: 'sticky', pos: { x: 0, y: 0 } },
    });
    expect(res.isError).toBeFalsy();
    expect((jsonOf(res) as { id: string }).id).toBeTruthy();
  });

  it('read + presence tools still work on a PROD connection', async () => {
    const { makePeer } = makePeerTracker();
    const { client } = await connectedClient({ makePeer });
    await client.callTool({
      name: 'connect_board',
      arguments: { instanceId: 'local', slug: 'spend' },
    });

    const board = await client.callTool({ name: 'get_board', arguments: { instanceId: 'local' } });
    expect(board.isError).toBeFalsy();
    const cursor = await client.callTool({
      name: 'move_cursor',
      arguments: { instanceId: 'local', x: 1, y: 2 },
    });
    expect(cursor.isError).toBeFalsy();
  });
});
