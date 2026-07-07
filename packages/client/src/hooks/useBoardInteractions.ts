// ── useBoardInteractions: keyboard, clipboard, layers, alt-drag ──────────────
//
// P4-T27. Ported from the legacy figmalade prototype's `src/components/
// BoardCanvas.tsx` (~L1063-1236 alt-drag / clipboard / layer handlers,
// ~L1774-1811 the global keydown handler), rewired onto this codebase's
// doc-first `BoardStore` mutation API instead of the legacy's whole-board
// `commit()` reducer. Every mutation lands through a named store method, each
// of which runs a shared `@easel/shared` CRDT op under `LOCAL_ORIGIN`
// (crdt/ops.ts) — which is exactly what `useUndoRedo` (Y.UndoManager scoped to
// `LOCAL_ORIGIN`) already observes, and (P5-T28) what the SERVER'S OWN
// `doc.on('update', ...)` persistence listener observes on its side of the
// same room. So there is NO separate undo/save wiring needed here: every
// clipboard, layer, and alt-drag-clone mutation is automatically undoable and
// automatically persisted (by the server, on its own debounce), purely by
// virtue of going through the store.
//
// ── Clipboard (internal, not the system clipboard — matches the legacy) ──────
// `clipboardRef` holds a plain `{ nodes, edges }` snapshot (structuredClone'd
// so later doc mutations can't alias into it). Copy takes the current
// selection's nodes plus any edge whose BOTH endpoints are selected (an edge
// with only one selected endpoint is NOT copied — pasting it with a dangling
// remapped end makes no sense). Paste mints a fresh id per node
// (`generateId(node.type, existingIds)`, extending the used-id set as it goes
// so two nodes of the same type in one paste don't collide), builds an
// old-id -> new-id map, offsets every pasted node's `pos` by +20/+20, and
// remaps each copied edge's `source`/`target` through that map (an edge is
// only re-created if BOTH remapped endpoints resolve — always true here since
// copy already filtered to both-endpoints-selected, but kept as a defensive
// skip rather than assumed). `cutSelection` = copy then delete. `duplicate` =
// copy then paste immediately. `pasteClipboard` returns the pasted node ids so
// the caller can select them (mirroring the legacy's paste-then-select UX).
//
// ── Layer reorder ────────────────────────────────────────────────────────────
// Delegates entirely to the shared `reorderLayers(nodes, selectedIds, op)`
// (board-io.ts), which returns a full array with every node's `order`
// recomputed (frames-behind-non-frames partition preserved). We diff that
// against the current snapshot and `store.updateNode(id, { order })` ONLY the
// nodes whose order actually changed — never a bulk replace — so an
// unaffected node's CRDT entry isn't touched (and doesn't show up as a no-op
// diff in the undo stack).
//
// ── Alt-drag duplicate ───────────────────────────────────────────────────────
// Mirrors the legacy's Option+drag: when a node drag starts with Alt held, we
// clone the dragged node (or the whole selection, if the dragged node is
// itself selected) as STATIONARY copies at the original position(s), rewire
// edges between two cloned nodes to point at the clones, and leave the
// ORIGINALS as what the user's cursor keeps dragging — i.e. we do NOT try to
// swap which node ReactFlow is mid-drag-tracking (that would fight the P4-T22
// drag-commit path, which reads `draggedNodes` from RF's own event and calls
// `moveNode` on those exact ids at drag-stop). Concretely: `onNodeDragStart`
// commits the clone-add doc-first (stationary copies inserted alongside the
// originals); RF's OWN drag then continues moving the id(s) it started
// dragging (the originals), and P4-T22's existing `onNodeDragStop` commits
// their final position exactly as any ordinary drag would. Net visible
// result matches the legacy: original moves away, a stationary duplicate (with
// the pre-drag edges) is left behind — the difference from the legacy (which
// makes the CURSOR track the clean clone and leaves the ORIGINAL stationary)
// is deliberately flipped here to avoid fighting P4-T22's drag-commit
// architecture; see this task's own report for the tradeoff.
//
// ── Global keyboard handler ───────────────────────────────────────────────────
// One `keydown` listener on `window`, registered/cleaned up per mount. Gated
// on: not read-only, not AI-locked (a later-phase concept; defaults to false),
// and focus NOT in a text input / textarea / contentEditable element — so
// typing inside a node's inline editor or a modal never fires a shortcut.
// Cmd/Ctrl+S (flushNow) and Escape are exempt from the input-focus gate,
// matching the legacy (`isMod && e.key === 's'` has no `!inInput` guard) and
// because Escape needs to work everywhere it's meaningful (e.g. cancelling an
// in-progress mode) while save must always be reachable.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { OnNodeDrag } from '@xyflow/react';
import { generateId, reorderLayers } from '@easel/shared';
import type { BoardEdge, BoardNode, LayerOp } from '@easel/shared';
import type { BoardStore } from '../store/board-store.js';
import type { BoardRfNode } from '../canvas/rf-adapters.js';

export interface UseBoardInteractionsOptions {
  store: BoardStore;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  /** Read-only board: every mutating shortcut/gesture becomes a no-op. */
  readonly: boolean;
  /** AI holds the write lock (Phase 5 concept) — mutating shortcuts become a
   * no-op, same as read-only, but undo/redo/flushNow still work (matches the
   * legacy's `editingLocked` gate, which never blocked undo/redo/save). */
  aiLocked?: boolean;
  undo(): void;
  redo(): void;
  /** Called on Cmd/Ctrl+S. Caller-supplied — P5-T29's editable canvas passes
   * a no-op (the server persists content on its own debounce; there is
   * nothing left for the client to flush), kept purely so the shortcut stays
   * bound-but-harmless rather than falling through to the browser's own
   * save-page dialog. */
  flushNow(): void;
  /** Called on Escape (cancel edit/active mode). Optional no-op if omitted. */
  onEscape?(): void;
}

export interface BoardInteractions {
  /** Wire directly to ReactFlow's `onNodeDragStart`. */
  onNodeDragStart: OnNodeDrag<BoardRfNode>;
  copySelection(): void;
  cutSelection(): void;
  /** Returns the ids of the newly-pasted nodes (empty if the clipboard was empty). */
  pasteClipboard(): string[];
  duplicateSelection(): void;
  deleteSelected(): void;
  reorderSelectedLayers(op: LayerOp): void;
}

interface Clipboard {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

/** True when the given element is a text input / textarea / contentEditable —
 * i.e. typing there should never be hijacked by a board shortcut. Checks both
 * the live `isContentEditable` property (real browsers, including inherited
 * editability from an ancestor) and the raw `contenteditable` attribute —
 * jsdom (used by this hook's own tests) doesn't implement the IDL property at
 * all, so the attribute check is what makes contentEditable gating testable
 * there; it's also a perfectly valid direct check in real browsers. */
function isTextEntryElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable === true) return true;
  const attr = el.getAttribute('contenteditable');
  return attr === '' || attr === 'true';
}

export function useBoardInteractions(options: UseBoardInteractionsOptions): BoardInteractions {
  const { store } = options;

  // Read through a ref so the keydown listener/callbacks always see the
  // LATEST option values without needing to re-register the listener (or
  // recreate every callback) on every render — same technique
  // useEditableCanvas.ts's onOpenDescription ref uses.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const clipboardRef = useRef<Clipboard | null>(null);

  // ── Clipboard ────────────────────────────────────────────────────────────

  const copySelection = useCallback(() => {
    const { selectedNodeIds } = optionsRef.current;
    const snapshot = store.getSnapshot();
    const copiedNodes = snapshot.nodes.filter((n) => selectedNodeIds.has(n.id));
    const nodeIds = new Set(copiedNodes.map((n) => n.id));
    const copiedEdges = snapshot.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
    );
    clipboardRef.current = {
      nodes: structuredClone(copiedNodes),
      edges: structuredClone(copiedEdges),
    };
  }, [store]);

  const pasteClipboard = useCallback((): string[] => {
    const clip = clipboardRef.current;
    if (!clip || clip.nodes.length === 0) return [];

    const existingIds = new Set(store.getSnapshot().nodes.map((n) => n.id));
    const idMap = new Map<string, string>();
    const newNodes: BoardNode[] = [];

    for (const node of clip.nodes) {
      const newId = generateId(node.type, existingIds);
      existingIds.add(newId);
      idMap.set(node.id, newId);
      newNodes.push({
        ...structuredClone(node),
        id: newId,
        pos: { x: node.pos.x + 20, y: node.pos.y + 20 },
      });
    }

    const existingEdgeIds = new Set(store.getSnapshot().edges.map((e) => e.id));
    for (const edge of clip.edges) {
      const newSource = idMap.get(edge.source);
      const newTarget = idMap.get(edge.target);
      if (!newSource || !newTarget) continue;
      const newEdgeId = generateId('e', existingEdgeIds);
      existingEdgeIds.add(newEdgeId);
      // structuredClone strips `undefined`-valued keys (arrow/cardinality are
      // mutually exclusive per edge kind), so spreading the clone over the
      // base fields is safe — no stale opposite-kind field survives.
      store.addEdge({
        ...structuredClone(edge),
        id: newEdgeId,
        source: newSource,
        target: newTarget,
      });
    }

    for (const node of newNodes) store.addNode(node);

    return newNodes.map((n) => n.id);
  }, [store]);

  const cutSelection = useCallback(() => {
    copySelection();
    const { selectedNodeIds, selectedEdgeIds } = optionsRef.current;
    if (selectedNodeIds.size > 0) store.deleteNodes([...selectedNodeIds]);
    if (selectedEdgeIds.size > 0) store.deleteEdges([...selectedEdgeIds]);
  }, [copySelection, store]);

  const duplicateSelection = useCallback(() => {
    copySelection();
    pasteClipboard();
  }, [copySelection, pasteClipboard]);

  // ── Delete ───────────────────────────────────────────────────────────────

  const deleteSelected = useCallback(() => {
    const { selectedNodeIds, selectedEdgeIds } = optionsRef.current;
    if (selectedNodeIds.size > 0) store.deleteNodes([...selectedNodeIds]);
    if (selectedEdgeIds.size > 0) store.deleteEdges([...selectedEdgeIds]);
  }, [store]);

  // ── Layer reorder ────────────────────────────────────────────────────────

  const reorderSelectedLayers = useCallback(
    (op: LayerOp) => {
      const { selectedNodeIds } = optionsRef.current;
      if (selectedNodeIds.size === 0) return;
      const snapshot = store.getSnapshot();
      const reordered = reorderLayers(snapshot.nodes, selectedNodeIds, op);
      const before = new Map(snapshot.nodes.map((n) => [n.id, n.order]));
      for (const node of reordered) {
        if (before.get(node.id) !== node.order) {
          store.updateNode(node.id, { order: node.order });
        }
      }
    },
    [store],
  );

  // ── Alt-drag duplicate ───────────────────────────────────────────────────
  //
  // See module doc: clones are inserted STATIONARY at the dragged node's
  // pre-drag position(s); the original id(s) RF is already tracking continue
  // to be dragged (and committed via the existing onNodeDragStop path).

  const onNodeDragStart = useCallback<OnNodeDrag<BoardRfNode>>(
    (event, node) => {
      const { readonly: ro, aiLocked, selectedNodeIds } = optionsRef.current;
      const altKey = (event as MouseEvent).altKey ?? false;
      if (!altKey || ro || aiLocked) return;

      const snapshot = store.getSnapshot();
      const nodeIsSelected = selectedNodeIds.has(node.id);
      const idsToClone = new Set(nodeIsSelected ? [...selectedNodeIds] : [node.id]);
      if (idsToClone.size === 0) return;

      const existingIds = new Set(snapshot.nodes.map((n) => n.id));
      const idMap = new Map<string, string>();
      const clones: BoardNode[] = [];
      for (const n of snapshot.nodes) {
        if (!idsToClone.has(n.id)) continue;
        const newId = generateId(n.type, existingIds);
        existingIds.add(newId);
        idMap.set(n.id, newId);
        clones.push({ ...structuredClone(n), id: newId });
      }

      const existingEdgeIds = new Set(snapshot.edges.map((e) => e.id));
      const clonedEdges: BoardEdge[] = [];
      for (const e of snapshot.edges) {
        const newSource = idMap.get(e.source);
        const newTarget = idMap.get(e.target);
        if (!newSource || !newTarget) continue;
        const newEdgeId = generateId('e', existingEdgeIds);
        existingEdgeIds.add(newEdgeId);
        clonedEdges.push({
          ...structuredClone(e),
          id: newEdgeId,
          source: newSource,
          target: newTarget,
        });
      }

      for (const clone of clones) store.addNode(clone);
      for (const edge of clonedEdges) store.addEdge(edge);
    },
    [store],
  );

  // ── Global keyboard handler ──────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const opts = optionsRef.current;
      const inTextEntry = isTextEntryElement(document.activeElement);
      const isMod = e.metaKey || e.ctrlKey;
      const locked = opts.readonly || (opts.aiLocked ?? false);
      const hasNodeSelection = opts.selectedNodeIds.size > 0;
      const hasSelection = hasNodeSelection || opts.selectedEdgeIds.size > 0;

      if (e.key === 'Escape') {
        opts.onEscape?.();
        return;
      }

      // Save is reachable everywhere (matches the legacy's unconditional
      // `isMod && e.key === 's'`), including while text-editing.
      if (isMod && e.key === 's') {
        e.preventDefault();
        opts.flushNow();
        return;
      }

      if (isMod && e.key === 'z' && !e.shiftKey && !inTextEntry) {
        e.preventDefault();
        opts.undo();
        return;
      }
      if (isMod && ((e.shiftKey && e.key === 'z') || e.key === 'y') && !inTextEntry) {
        e.preventDefault();
        opts.redo();
        return;
      }

      if (isMod && e.key === 'c' && !inTextEntry && hasNodeSelection) {
        e.preventDefault();
        copySelection();
        return;
      }
      if (isMod && e.key === 'x' && !inTextEntry && hasSelection && !locked) {
        e.preventDefault();
        cutSelection();
        return;
      }
      if (isMod && e.key === 'v' && !inTextEntry && !locked) {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (isMod && e.key === 'd' && !inTextEntry && hasNodeSelection && !locked) {
        e.preventDefault();
        duplicateSelection();
        return;
      }

      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        hasSelection &&
        !inTextEntry &&
        !locked
      ) {
        e.preventDefault();
        deleteSelected();
        return;
      }

      if (!inTextEntry && !isMod && !locked && hasNodeSelection) {
        if (e.key === ']') {
          e.preventDefault();
          reorderSelectedLayers('forward');
          return;
        }
        if (e.key === '[') {
          e.preventDefault();
          reorderSelectedLayers('backward');
          return;
        }
        if (e.key === '}') {
          e.preventDefault();
          reorderSelectedLayers('front');
          return;
        }
        if (e.key === '{') {
          e.preventDefault();
          reorderSelectedLayers('back');
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    copySelection,
    cutSelection,
    pasteClipboard,
    duplicateSelection,
    deleteSelected,
    reorderSelectedLayers,
  ]);

  return useMemo(
    () => ({
      onNodeDragStart,
      copySelection,
      cutSelection,
      pasteClipboard,
      duplicateSelection,
      deleteSelected,
      reorderSelectedLayers,
    }),
    [
      onNodeDragStart,
      copySelection,
      cutSelection,
      pasteClipboard,
      duplicateSelection,
      deleteSelected,
      reorderSelectedLayers,
    ],
  );
}
