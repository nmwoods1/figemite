// ── lib/realtime.ts tests ────────────────────────────────────────────────────
//
// `joinBoardRoom` is the client-side entry point that attaches a
// `WebsocketProvider` (content sync, relayed by @easel/server's
// YjsWebsocketService — P5-T28) and an `IndexeddbPersistence` (offline cache)
// to a caller-supplied Y.Doc, bootstraps awareness to a non-null local user
// BEFORE returning, and gives back a small `BoardRoom` handle. Ported from the
// legacy figmalade prototype's `src/lib/realtime.ts`, adapted so the doc is
// caller-supplied (this codebase's `createBoardStore` owns Y.Doc construction
// — see store/board-store.ts) rather than constructed inside this module.
//
// `WebsocketProvider`/`IndexeddbPersistence` are mocked: this suite is a UNIT
// test of the wiring (right URL, right room name, awareness bootstrap order,
// teardown), not an integration test against a real server (that's covered by
// the E2E gate + the server's own yjs-persistence.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

interface MockProviderInstance {
  url: string;
  room: string;
  doc: Y.Doc;
  opts: Record<string, unknown>;
  awareness: { setLocalState: ReturnType<typeof vi.fn>; getLocalState: () => unknown };
  destroy: ReturnType<typeof vi.fn>;
  synced: boolean;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  /** The actual mock class instance (identity-comparable to what `joinBoardRoom` returns as `room.provider`). */
  instance: unknown;
}

const wsInstances: MockProviderInstance[] = [];

const idbInstances: Array<{ room: string; doc: Y.Doc; destroy: ReturnType<typeof vi.fn> }> = [];

vi.mock('y-websocket', () => {
  class MockWebsocketProvider {
    url: string;
    roomname: string;
    doc: Y.Doc;
    opts: Record<string, unknown>;
    synced = false;
    destroy = vi.fn();
    on = vi.fn();
    off = vi.fn();
    awareness: { setLocalState: ReturnType<typeof vi.fn>; getLocalState: () => unknown };
    private localState: unknown = null;

    constructor(url: string, roomname: string, doc: Y.Doc, opts: Record<string, unknown>) {
      this.url = url;
      this.roomname = roomname;
      this.doc = doc;
      this.opts = opts;
      this.awareness = {
        setLocalState: vi.fn((state: unknown) => {
          this.localState = state;
        }),
        getLocalState: () => this.localState,
      };
      wsInstances.push({
        url,
        room: roomname,
        doc,
        opts,
        awareness: this.awareness,
        destroy: this.destroy,
        synced: false,
        on: this.on,
        off: this.off,
        instance: this,
      });
    }
  }
  return { WebsocketProvider: MockWebsocketProvider };
});

vi.mock('y-indexeddb', () => {
  class MockIndexeddbPersistence {
    destroy = vi.fn();
    constructor(
      public room: string,
      public doc: Y.Doc,
    ) {
      idbInstances.push({ room, doc, destroy: this.destroy });
    }
  }
  return { IndexeddbPersistence: MockIndexeddbPersistence };
});

import { joinBoardRoom } from './realtime.js';

describe('joinBoardRoom', () => {
  beforeEach(() => {
    wsInstances.length = 0;
    idbInstances.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the ws URL from the current origin (ws: for http:)', () => {
    const doc = new Y.Doc();
    const room = joinBoardRoom(doc, 'spend', []);
    expect(wsInstances).toHaveLength(1);
    expect(wsInstances[0]!.url).toBe('ws://localhost:3000/yjs');
    room.destroy();
  });

  it('uses wss: when the page is served over https:', () => {
    vi.stubGlobal('location', {
      ...window.location,
      protocol: 'https:',
      host: 'example.com',
    });
    const doc = new Y.Doc();
    const room = joinBoardRoom(doc, 'spend', []);
    expect(wsInstances[0]!.url).toBe('wss://example.com/yjs');
    room.destroy();
  });

  it('connects to the room named via roomNameFor(slug, path) — root board', () => {
    const doc = new Y.Doc();
    const room = joinBoardRoom(doc, 'spend', []);
    expect(room.roomName).toBe('spend');
    expect(wsInstances[0]!.room).toBe('spend');
    room.destroy();
  });

  it('connects to the room named via roomNameFor(slug, path) — sub-board path', () => {
    const doc = new Y.Doc();
    const room = joinBoardRoom(doc, 'spend', ['NodeA', 'NodeB']);
    expect(room.roomName).toBe('spend.NodeA.NodeB');
    expect(wsInstances[0]!.room).toBe('spend.NodeA.NodeB');
    room.destroy();
  });

  it('passes the caller-supplied doc straight to the provider (no second Y.Doc constructed)', () => {
    const doc = new Y.Doc();
    const room = joinBoardRoom(doc, 'spend', []);
    expect(wsInstances[0]!.doc).toBe(doc);
    room.destroy();
  });

  it('connects with connect: true', () => {
    const doc = new Y.Doc();
    const room = joinBoardRoom(doc, 'spend', []);
    expect(wsInstances[0]!.opts.connect).toBe(true);
    room.destroy();
  });

  it('bootstraps local awareness state to a non-null object containing the local user', () => {
    const doc = new Y.Doc();
    const room = joinBoardRoom(doc, 'spend', []);
    const state = room.awareness.getLocalState() as { user?: { name: string; color: string } };
    expect(state).not.toBeNull();
    expect(state.user).toBeDefined();
    expect(typeof state.user!.name).toBe('string');
    expect(state.user!.name.length).toBeGreaterThan(0);
    expect(typeof state.user!.color).toBe('string');
    room.destroy();
  });

  it('awareness bootstrap happens exactly once, before the caller ever touches awareness', () => {
    const doc = new Y.Doc();
    const room = joinBoardRoom(doc, 'spend', []);
    const providerInstance = wsInstances[0]!;
    expect(providerInstance.awareness.setLocalState).toHaveBeenCalledTimes(1);
    expect(providerInstance.awareness.setLocalState).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.any(Object) }),
    );
    room.destroy();
  });

  it('attaches an IndexeddbPersistence for the same room/doc (offline persistence)', () => {
    const doc = new Y.Doc();
    const room = joinBoardRoom(doc, 'spend', []);
    expect(idbInstances).toHaveLength(1);
    expect(idbInstances[0]!.room).toBe('spend');
    expect(idbInstances[0]!.doc).toBe(doc);
    room.destroy();
  });

  it('exposes the provider and awareness on the returned BoardRoom', () => {
    const doc = new Y.Doc();
    const room = joinBoardRoom(doc, 'spend', []);
    expect(room.provider).toBe(wsInstances[0]!.instance);
    expect(room.awareness).toBe(wsInstances[0]!.awareness);
    room.destroy();
  });

  describe('destroy', () => {
    it('destroys the websocket provider', () => {
      const doc = new Y.Doc();
      const room = joinBoardRoom(doc, 'spend', []);
      const providerInstance = wsInstances[0]!;
      room.destroy();
      expect(providerInstance.destroy).toHaveBeenCalled();
    });

    it('destroys the indexeddb persistence', () => {
      const doc = new Y.Doc();
      const room = joinBoardRoom(doc, 'spend', []);
      const idbInstance = idbInstances[0]!;
      room.destroy();
      expect(idbInstance.destroy).toHaveBeenCalled();
    });

    it('clears local awareness state (setLocalState(null)) before destroying the provider', () => {
      const doc = new Y.Doc();
      const room = joinBoardRoom(doc, 'spend', []);
      const providerInstance = wsInstances[0]!;
      room.destroy();
      expect(providerInstance.awareness.setLocalState).toHaveBeenLastCalledWith(null);
    });

    it('does NOT destroy the caller-supplied doc (the store owns doc lifecycle)', () => {
      const doc = new Y.Doc();
      const destroySpy = vi.spyOn(doc, 'destroy');
      const room = joinBoardRoom(doc, 'spend', []);
      room.destroy();
      expect(destroySpy).not.toHaveBeenCalled();
    });
  });
});
