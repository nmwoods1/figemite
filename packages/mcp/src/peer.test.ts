// ── BoardPeer unit tests ─────────────────────────────────────────────────────
//
// Drives BoardPeer against a fake WebsocketProvider (injected via
// `makeProvider`) so these tests never open a real socket. The fake mimics
// just enough of y-websocket's WebsocketProvider surface (awareness,
// synced/on('sync'), destroy) for BoardPeer's own logic to be exercised.

import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { roomNameFor, colorForName } from '@easel/shared';
import { BoardPeer } from './peer.js';
import { FakeAwareness } from './test/fake-awareness.js';

class FakeProvider {
  synced = false;
  awareness: FakeAwareness;
  destroyed = false;
  private syncListeners: Array<(isSynced: boolean) => void> = [];

  constructor(
    public serverUrl: string,
    public roomname: string,
    public doc: Y.Doc,
  ) {
    this.awareness = new FakeAwareness();
  }

  on(event: string, cb: (isSynced: boolean) => void): void {
    if (event === 'sync') this.syncListeners.push(cb);
  }

  off(event: string, cb: (isSynced: boolean) => void): void {
    if (event === 'sync') {
      this.syncListeners = this.syncListeners.filter((l) => l !== cb);
    }
  }

  /** Test helper: simulate the server completing sync. */
  triggerSync(isSynced = true): void {
    this.synced = isSynced;
    for (const l of this.syncListeners) l(isSynced);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

type PeerOpts = ConstructorParameters<typeof BoardPeer>[0];

function makePeer(opts: Partial<PeerOpts> = {}) {
  let fakeProvider!: FakeProvider;
  const peer = new BoardPeer({
    wsUrl: 'ws://localhost:5400/yjs',
    slug: 'spend',
    name: 'AI',
    makeProvider: ((wsUrl: string, roomname: string, doc: Y.Doc) => {
      fakeProvider = new FakeProvider(wsUrl, roomname, doc);
      return fakeProvider;
    }) as unknown as PeerOpts['makeProvider'],
    ...opts,
  });
  return { peer, getProvider: () => fakeProvider };
}

describe('BoardPeer construction', () => {
  it('joins the room for the given slug (no sub-path)', () => {
    const { peer, getProvider } = makePeer({ slug: 'spend' });
    expect(peer.roomName).toBe(roomNameFor('spend', []));
    expect(getProvider().roomname).toBe('spend');
  });

  it('joins the dot-joined room for a sub-board path', () => {
    const { peer, getProvider } = makePeer({ slug: 'spend', path: ['NodeA', 'NodeB'] });
    expect(peer.roomName).toBe(roomNameFor('spend', ['NodeA', 'NodeB']));
    expect(getProvider().roomname).toBe('spend.NodeA.NodeB');
  });

  it('passes the wsUrl through to the provider unchanged', () => {
    const { getProvider } = makePeer({ wsUrl: 'ws://10.0.0.5:5400/yjs' });
    expect(getProvider().serverUrl).toBe('ws://10.0.0.5:5400/yjs');
  });

  it('sets isAI true in awareness local state', () => {
    const { peer } = makePeer({ name: 'Cursor' });
    const state = peer.awareness.getLocalState() as { isAI?: boolean };
    expect(state?.isAI).toBe(true);
  });

  it('sets user name and a deterministic color derived from the name', () => {
    const { peer } = makePeer({ name: 'Cursor' });
    const state = peer.awareness.getLocalState() as {
      user?: { name: string; color: string };
    };
    expect(state?.user?.name).toBe('Cursor');
    expect(state?.user?.color).toBe(colorForName('Cursor'));
  });

  it('defaults the display name to "AI" when none is given', () => {
    const { peer } = makePeer({ name: undefined });
    const state = peer.awareness.getLocalState() as { user?: { name: string } };
    expect(state?.user?.name).toBe('AI');
  });

  it('sets agentClient in awareness when provided', () => {
    const { peer } = makePeer({ agentClient: 'claude-code' });
    const state = peer.awareness.getLocalState() as { agentClient?: string };
    expect(state?.agentClient).toBe('claude-code');
  });

  it('omits agentClient from awareness when not provided', () => {
    const { peer } = makePeer({ agentClient: undefined });
    const state = peer.awareness.getLocalState() as { agentClient?: string };
    expect(state?.agentClient).toBeUndefined();
  });
});

describe('BoardPeer.waitForSync', () => {
  it('resolves immediately if the provider is already synced', async () => {
    const { peer, getProvider } = makePeer();
    getProvider().triggerSync(true);
    await expect(peer.waitForSync(1000)).resolves.toBeUndefined();
  });

  it('resolves once the provider emits a sync event', async () => {
    const { peer, getProvider } = makePeer();
    const promise = peer.waitForSync(1000);
    getProvider().triggerSync(true);
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects after the timeout if sync never happens', async () => {
    vi.useFakeTimers();
    try {
      const { peer } = makePeer();
      const promise = peer.waitForSync(50);
      const assertion = expect(promise).rejects.toThrow(/sync/i);
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('BoardPeer presence setters', () => {
  it('setCursor sets the cursor awareness field', () => {
    const { peer } = makePeer();
    peer.setCursor({ x: 10, y: 20 });
    const state = peer.awareness.getLocalState() as { cursor?: { x: number; y: number } };
    expect(state?.cursor).toEqual({ x: 10, y: 20 });
  });

  it('setCursor(null) clears the cursor field', () => {
    const { peer } = makePeer();
    peer.setCursor({ x: 1, y: 2 });
    peer.setCursor(null);
    const state = peer.awareness.getLocalState() as { cursor?: unknown };
    expect(state?.cursor).toBeNull();
  });

  it('setEditing sets the editingNodeId awareness field', () => {
    const { peer } = makePeer();
    peer.setEditing('node1');
    const state = peer.awareness.getLocalState() as { editingNodeId?: string | null };
    expect(state?.editingNodeId).toBe('node1');
  });

  it('setEditing(null) clears the editingNodeId field', () => {
    const { peer } = makePeer();
    peer.setEditing('node1');
    peer.setEditing(null);
    const state = peer.awareness.getLocalState() as { editingNodeId?: string | null };
    expect(state?.editingNodeId).toBeNull();
  });

  it('setViewport sets the viewport awareness field', () => {
    const { peer } = makePeer();
    peer.setViewport({ x: 5, y: 6, zoom: 1.5 });
    const state = peer.awareness.getLocalState() as {
      viewport?: { x: number; y: number; zoom: number };
    };
    expect(state?.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 });
  });
});

describe('BoardPeer.destroy', () => {
  it('clears local awareness state, destroys the provider, and destroys the doc', () => {
    const { peer, getProvider } = makePeer();
    const doc = peer.doc;
    const destroySpy = vi.spyOn(doc, 'destroy');

    peer.destroy();

    expect(peer.awareness.getLocalState()).toBeNull();
    expect(getProvider().destroyed).toBe(true);
    expect(destroySpy).toHaveBeenCalled();
  });
});

describe('BoardPeer does not flush to disk', () => {
  it('never calls global fetch — the server persists the room, not the peer', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { peer } = makePeer();
    peer.setCursor({ x: 1, y: 1 });
    peer.destroy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
