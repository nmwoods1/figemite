import { afterEach, describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { addNode } from '@figemite/shared';
import type { BoardFile, BoardNode } from '@figemite/shared';

// ── Realtime room mock (P5-T29) ──────────────────────────────────────────────
// `createBoardStore`'s editable-with-room path delegates to `lib/realtime.js`'s
// `joinBoardRoom` rather than seeding the doc locally — mocked here so these
// are unit tests of the STORE's own branching (does it call loadBoardIntoDoc
// or joinBoardRoom, does it seed content, does destroy tear the room down),
// not an integration test against a real websocket (that's `realtime.test.ts`
// + the E2E gate).
const joinBoardRoomMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/realtime.js', () => ({
  joinBoardRoom: joinBoardRoomMock,
}));

import { createBoardStore } from './board-store.js';

interface FakeRoom {
  roomName: string;
  provider: unknown;
  awareness: unknown;
  synced: boolean;
  onSyncedChange: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function makeFakeRoom(roomName = 'spend'): FakeRoom {
  return {
    roomName,
    provider: { id: 'fake-provider' },
    awareness: { id: 'fake-awareness' },
    synced: false,
    onSyncedChange: vi.fn(() => vi.fn()),
    destroy: vi.fn(),
  };
}

function fixtureBoard(): BoardFile {
  return {
    formatVersion: 1,
    boardLabel: 'Fixture',
    nodes: [
      {
        id: 's1',
        type: 'sticky',
        pos: { x: 10, y: 20 },
        order: 0,
        size: { width: 200, height: 160 },
        text: 'hello',
        color: '#fef3c7',
      },
      {
        id: 'f1',
        type: 'frame',
        pos: { x: 0, y: 0 },
        order: 1,
        size: { width: 480, height: 320 },
        title: 'Frame',
        color: '#fef3c7',
      },
    ],
    edges: [{ id: 'e1', source: 's1', target: 'f1', style: 'solid' }],
    viewport: { x: 5, y: 6, zoom: 1.5 },
  };
}

describe('createBoardStore', () => {
  it('hydrates the doc from the initial board and getSnapshot reflects its nodes/edges', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const snap = store.getSnapshot();

    expect(snap.nodes).toHaveLength(2);
    expect(snap.edges).toHaveLength(1);
    const sticky = snap.nodes.find((n) => n.id === 's1');
    expect(sticky).toMatchObject({ id: 's1', type: 'sticky', text: 'hello' });
    const frame = snap.nodes.find((n) => n.id === 'f1');
    expect(frame).toMatchObject({ id: 'f1', type: 'frame', title: 'Frame' });
    expect(snap.edges[0]).toMatchObject({ id: 'e1', source: 's1', target: 'f1' });

    store.destroy();
  });

  it('getSnapshot returns the SAME object reference when nothing has changed', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const a = store.getSnapshot();
    const b = store.getSnapshot();
    expect(a).toBe(b);
    store.destroy();
  });

  it('applying a shared op fires subscribers and the next getSnapshot includes the change', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const before = store.getSnapshot();
    const newNode: BoardNode = {
      id: 'new1',
      type: 'text',
      pos: { x: 100, y: 100 },
      order: 2,
      text: 'New node',
    };
    addNode(store.doc, newNode);

    expect(listener).toHaveBeenCalled();
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.nodes.some((n) => n.id === 'new1')).toBe(true);

    unsubscribe();
    store.destroy();
  });

  it('getSnapshot reference changes only when the doc actually updates', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const first = store.getSnapshot();
    const second = store.getSnapshot();
    expect(first).toBe(second);

    addNode(store.doc, {
      id: 'x1',
      type: 'text',
      pos: { x: 0, y: 0 },
      order: 5,
      text: 'x',
    });

    const third = store.getSnapshot();
    expect(third).not.toBe(second);
    const fourth = store.getSnapshot();
    expect(fourth).toBe(third);

    store.destroy();
  });

  it('destroy() stops further notifications', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const listener = vi.fn();
    store.subscribe(listener);
    store.destroy();

    // Mutating the doc after destroy should not notify (doc.destroy() also
    // detaches observers, but this proves the store's own cleanup too).
    addNode(store.doc, {
      id: 'after-destroy',
      type: 'text',
      pos: { x: 0, y: 0 },
      order: 9,
      text: 'nope',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribe stops that particular listener from being called again', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    addNode(store.doc, {
      id: 'after-unsub',
      type: 'text',
      pos: { x: 0, y: 0 },
      order: 9,
      text: 'nope',
    });

    expect(listener).not.toHaveBeenCalled();
    store.destroy();
  });

  it('exposes the underlying Y.Doc', () => {
    const store = createBoardStore(fixtureBoard(), { readonly: false });
    expect(store.doc).toBeInstanceOf(Y.Doc);
    store.destroy();
  });

  describe('reconnectEdge', () => {
    it('moves an edge to a new endpoint in place, preserving id and styling', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.addNode({ id: 's2', type: 'text', pos: { x: 300, y: 300 }, order: 2, text: 'other' });
      store.setEdgeLabel('e1', 'depends on');
      store.setEdgeArrow('e1', 'both');

      store.reconnectEdge('e1', {
        source: 's1',
        target: 's2',
        sourceHandle: 'r',
        targetHandle: 'l',
      });

      const edge = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(edge).toMatchObject({
        id: 'e1',
        source: 's1',
        target: 's2',
        sourceHandle: 'r',
        targetHandle: 'l',
        label: 'depends on',
        arrow: 'both',
        style: 'solid',
      });
      store.destroy();
    });

    it('normalises null handles by removing any prior handle', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      store.addNode({ id: 's2', type: 'text', pos: { x: 300, y: 300 }, order: 2, text: 'other' });
      store.reconnectEdge('e1', {
        source: 's1',
        target: 's2',
        sourceHandle: 'r',
        targetHandle: 'l',
      });
      store.reconnectEdge('e1', {
        source: 's1',
        target: 's2',
        sourceHandle: null,
        targetHandle: null,
      });

      const edge = store.getSnapshot().edges.find((e) => e.id === 'e1')!;
      expect('sourceHandle' in edge).toBe(false);
      expect('targetHandle' in edge).toBe(false);
      store.destroy();
    });

    it('is a no-op on a read-only store', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      store.reconnectEdge('e1', { source: 'f1', target: 's1' });
      const edge = store.getSnapshot().edges.find((e) => e.id === 'e1');
      expect(edge).toMatchObject({ source: 's1', target: 'f1' });
      store.destroy();
    });
  });

  describe('viewport', () => {
    it('getViewport returns the initial board viewport', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      expect(store.getViewport()).toEqual({ x: 5, y: 6, zoom: 1.5 });
      store.destroy();
    });

    it('setViewport updates getViewport and notifies viewport subscribers', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const listener = vi.fn();
      store.subscribeViewport(listener);

      store.setViewport({ x: 1, y: 2, zoom: 2 });

      expect(store.getViewport()).toEqual({ x: 1, y: 2, zoom: 2 });
      expect(listener).toHaveBeenCalled();
      store.destroy();
    });

    it('viewport getSnapshot is referentially stable when unchanged', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      const a = store.getViewport();
      const b = store.getViewport();
      expect(a).toBe(b);
      store.destroy();
    });
  });

  // ── Realtime room integration (P5-T29) ────────────────────────────────────
  //
  // Editable mode + a `room` option joins the server room via
  // `joinBoardRoom` and does NOT seed content locally — the server is now the
  // single content writer (P5-T28). Read-only mode (unchanged from Phase 3)
  // and editable-WITHOUT-a-room (unit-test convenience — see this file's
  // other describe blocks, which rely on immediate local seeding) both keep
  // hydrating via `loadBoardIntoDoc` and never touch the network.
  describe('realtime room integration', () => {
    afterEach(() => {
      joinBoardRoomMock.mockReset();
    });

    it('editable mode WITH a room option calls joinBoardRoom with the doc, slug, and path', () => {
      const room = makeFakeRoom();
      joinBoardRoomMock.mockReturnValue(room);

      const store = createBoardStore(fixtureBoard(), {
        readonly: false,
        room: { slug: 'spend', path: ['NodeA'] },
      });

      expect(joinBoardRoomMock).toHaveBeenCalledTimes(1);
      const [doc, slug, path] = joinBoardRoomMock.mock.calls[0]!;
      expect(doc).toBe(store.doc);
      expect(slug).toBe('spend');
      expect(path).toEqual(['NodeA']);

      store.destroy();
    });

    it('editable mode WITH a room option does NOT seed the doc from the passed-in board', () => {
      const room = makeFakeRoom();
      joinBoardRoomMock.mockReturnValue(room);

      const board = fixtureBoard();
      const store = createBoardStore(board, {
        readonly: false,
        room: { slug: 'spend', path: [] },
      });

      // fixtureBoard() has 2 nodes + 1 edge; a room-joined store must start
      // EMPTY (content arrives from the room's sync), not pre-loaded from the
      // fetched BoardFile passed in for metadata purposes only.
      const snap = store.getSnapshot();
      expect(snap.nodes).toHaveLength(0);
      expect(snap.edges).toHaveLength(0);

      store.destroy();
    });

    it('editable mode WITHOUT a room option does NOT call joinBoardRoom (unit-test/local-seed path)', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      expect(joinBoardRoomMock).not.toHaveBeenCalled();
      expect(store.getSnapshot().nodes).toHaveLength(2);
      store.destroy();
    });

    it('read-only mode never calls joinBoardRoom, even if a room option is passed', () => {
      const store = createBoardStore(fixtureBoard(), {
        readonly: true,
        room: { slug: 'spend', path: [] },
      });
      expect(joinBoardRoomMock).not.toHaveBeenCalled();
      // Read-only still hydrates from the fetched board via loadBoardIntoDoc.
      expect(store.getSnapshot().nodes).toHaveLength(2);
      store.destroy();
    });

    it('exposes the joined room on the store', () => {
      const room = makeFakeRoom('spend.NodeA');
      joinBoardRoomMock.mockReturnValue(room);

      const store = createBoardStore(fixtureBoard(), {
        readonly: false,
        room: { slug: 'spend', path: ['NodeA'] },
      });

      expect(store.room).toBe(room);
      store.destroy();
    });

    it('store.room is null when no room option is given', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: false });
      expect(store.room).toBeNull();
      store.destroy();
    });

    it('store.room is null in read-only mode', () => {
      const store = createBoardStore(fixtureBoard(), { readonly: true });
      expect(store.room).toBeNull();
      store.destroy();
    });

    it('destroy() tears down the joined room', () => {
      const room = makeFakeRoom();
      joinBoardRoomMock.mockReturnValue(room);

      const store = createBoardStore(fixtureBoard(), {
        readonly: false,
        room: { slug: 'spend', path: [] },
      });
      store.destroy();

      expect(room.destroy).toHaveBeenCalledTimes(1);
    });

    it('content synced into the doc (simulating the room applying a remote update) reaches getSnapshot', () => {
      const room = makeFakeRoom();
      joinBoardRoomMock.mockReturnValue(room);

      const store = createBoardStore(fixtureBoard(), {
        readonly: false,
        room: { slug: 'spend', path: [] },
      });

      // Simulate the provider applying a synced update from the room by
      // writing directly to the doc (exactly what y-websocket's sync
      // protocol does under the hood) — the store's own doc `update`
      // observer must pick this up the same way it does for local ops.
      addNode(store.doc, {
        id: 'from-room',
        type: 'text',
        pos: { x: 1, y: 1 },
        order: 0,
        text: 'synced content',
      });

      const snap = store.getSnapshot();
      expect(snap.nodes.some((n) => n.id === 'from-room')).toBe(true);

      store.destroy();
    });
  });
});
