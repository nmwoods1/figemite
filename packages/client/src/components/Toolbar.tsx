// ── Toolbar: node creation + styling controls ────────────────────────────────
//
// Ported from the original prototype's `src/components/Toolbar.tsx`
// (visual design + affordances kept faithfully), rewired from the legacy's
// `commit`-based board reducer to this codebase's doc-first `BoardStore`
// mutation API (store/board-store.ts):
//
//   - Add-node buttons build a fresh `BoardNode` via the shared `@figemite/shared`
//     factories (`makeStickyNode`/`makeTextNode`/…), with:
//       - `pos` = the current ReactFlow view center (`canvas/coords.ts`'s
//         `viewCenter`, fed the live `useReactFlow().getViewport()`) — so a
//         node created while panned/zoomed lands where the user is actually
//         looking, not at flow-space (0,0);
//       - `id` = `generateId(prefix, existingIds)` over the CURRENT store
//         snapshot's node ids, so a rapid double-click can't collide;
//       - `order` = `nextOrder(currentNodes)`, so it renders on top of the
//         existing stack.
//     The node is then committed via `store.addNode(node)` — the store's
//     mutation API didn't have a bare "add a fully-built node" method before
//     this task (P4-T22..T24 only needed `addEdge`/`moveNode`/etc.), so this
//     task ALSO adds `BoardStore.addNode`, a thin wrapper over
//     `@figemite/shared`'s `addNode` op (mirroring every other mutation method's
//     no-op-when-readonly guard).
//   - The sticky/shape/frame color-cycle button ports the legacy's
//     `onCycleColor` (NOT a picker for an existing selection — the legacy
//     only ever exposed a picker for the NEW-sticky color, and a single
//     "next color" button for a selection) via `updateNode(id, { color })`
//     through `nextStickyColor`.
//   - Edge-style controls (arrow/line/kind/cardinality) call the P4-T24 edge
//     store methods (`setEdgeArrow`/`setEdgeLineStyle`/`setEdgeKind`/
//     `setEdgeCardinality`) for every selected edge, shown only when the
//     selection is edge-only (mirrors the legacy's `selectionIsEdgeOnly`).
//   - `syncStatus` is a passed-in prop (`hooks/useSyncStatus.ts`'s
//     `SyncStatus`, P5-T29) — this component doesn't own the realtime
//     provider itself, matching how it doesn't own the store either. It
//     replaces the earlier content-autosave's `SaveStatus`: the server, not
//     the client, now persists board content, so what's shown here is
//     connection/sync health, not a save result.
//   - `readonly` hides every write affordance (the whole toolbar renders
//     nothing), matching "READONLY hides every write affordance" for every
//     other component in this codebase.
//
// Deliberately NOT ported here (out of this task's scope, per the plan):
// version history, copy/paste, layer reordering, keyboard shortcuts — those
// are separate legacy features not yet built in this rewrite (clipboard/
// keyboard/layers are the NEXT task, P4-T27).
//
// P6-T35 adds the pencil (persisted DrawingNode via PencilLayer) and
// annotation (ephemeral Y.Array strokes via AnnotationLayer) mode toggles,
// replacing the previous bespoke `commentMode`/`onToggleCommentMode` pair
// with a single `activeMode: 'none' | 'comment' | 'pencil' | 'annotation'` +
// `onSetActiveMode` — the three modes are mutually exclusive (activating one
// deactivates whichever else was active), and BoardCanvas owns the actual
// state slot (mirroring how it already owned `commentMode`). Clicking the
// already-active mode's button toggles it back to `'none'` (mirrors the
// legacy's own toggle-off behaviour for each of its three independent
// booleans). A Wipe button (annotation mode only, and only once at least one
// annotation exists) clears the shared annotations array for every peer.
//
// P6-T36 adds the History button (time-travel: list/preview/restore/discard
// snapshots — hooks/useHistory.ts + components/HistoryPanel.tsx). `onOpenHistory`
// is OPTIONAL and only rendered when given: EditableCanvas omits it whenever
// `useHistory`'s `available` is false (no slug — the no-room unit-test
// convenience path), so the button is naturally absent there too, on top of
// the Toolbar-wide `readonly` early-return already hiding every write
// affordance (including this one) in READONLY mode.

import { useCallback, useState } from 'react';
import { useRef } from 'react';
import {
  StickyNote,
  Type,
  Shapes,
  Frame,
  Smile,
  Sparkles,
  Palette,
  MessageCircle,
  Pencil,
  Eraser,
  Trash2,
  History,
} from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import {
  generateId,
  makeStickyNode,
  makeTextNode,
  makeShapeNode,
  makeFrameNode,
  makeEmojiNode,
  makeIconNode,
  nextOrder,
  nextStickyColor,
} from '@figemite/shared';
import type {
  ArrowStyle,
  BoardNode,
  Cardinality,
  EdgeKind,
  LineStyle,
  ShapeKind,
} from '@figemite/shared';
import type { BoardStore } from '../store/board-store.js';
import { useBoardStore } from '../store/use-board-store.js';
import { viewCenter } from '../canvas/coords.js';
import type { SyncStatus } from '../hooks/useSyncStatus.js';
import { IconButton } from './toolbar/IconButton.js';
import { ShapePicker } from './toolbar/ShapePicker.js';
import { EmojiPicker } from './toolbar/EmojiPicker.js';
import { IconPicker } from './toolbar/IconPicker.js';
import { StickyColorPicker } from './toolbar/StickyColorPicker.js';
import {
  ArrowSelect,
  CardinalitySelect,
  EdgeKindToggle,
  LineStyleToggle,
} from './toolbar/EdgeControls.js';
import { SaveIndicator } from './toolbar/SaveIndicator.js';
import { Divider } from './toolbar/styles.js';

/** The single mutually-exclusive "active overlay mode" slot (P6-T35) — at
 * most one of comment-placement, pencil-drawing, or annotation-drawing is
 * ever active. `'none'` means normal RF interaction/selection. */
export type ToolbarMode = 'none' | 'comment' | 'pencil' | 'annotation';

export interface ToolbarProps {
  store: BoardStore;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  syncStatus: SyncStatus;
  readonly: boolean;
  /** Which of comment/pencil/annotation mode (if any) is currently active. */
  activeMode: ToolbarMode;
  /** Set the active mode. BoardCanvas owns the actual state and is expected
   * to toggle back to `'none'` when the caller re-selects the already-active
   * mode's button (mirrored here as each toggle button's own onClick). */
  onSetActiveMode: (mode: ToolbarMode) => void;
  /** Whether the shared annotations array currently has any strokes — gates
   * the Wipe button, which only appears alongside annotation mode. */
  hasAnnotations: boolean;
  /** Clear every annotation stroke for every peer (P6-T35). */
  onWipeAnnotations: () => void;
  /** Opens the history panel (P6-T36). Omitted (not just disabled) when
   * history isn't available — see this module's doc — which hides the button
   * entirely rather than rendering it disabled. */
  onOpenHistory?: () => void;
}

type OpenPicker = null | 'sticky' | 'shape' | 'emoji' | 'icon';

export function Toolbar({
  store,
  selectedNodeIds,
  selectedEdgeIds,
  syncStatus,
  readonly,
  activeMode,
  onSetActiveMode,
  hasAnnotations,
  onWipeAnnotations,
  onOpenHistory,
}: ToolbarProps) {
  const { nodes, edges } = useBoardStore(store);
  const { getViewport } = useReactFlow();
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const stickyBtnRef = useRef<HTMLButtonElement>(null);

  const getPos = useCallback(() => viewCenter(getViewport()), [getViewport]);

  const addNode = useCallback(
    (
      build: (id: string, pos: { x: number; y: number }, order: number) => BoardNode,
      prefix: string,
    ) => {
      const existingIds = new Set(store.getSnapshot().nodes.map((n) => n.id));
      const id = generateId(prefix, existingIds);
      const pos = getPos();
      const order = nextOrder(store.getSnapshot().nodes);
      store.addNode(build(id, pos, order));
    },
    [store, getPos],
  );

  const selectedNodes = nodes.filter((n) => selectedNodeIds.has(n.id));
  const selectedEdges = edges.filter((e) => selectedEdgeIds.has(e.id));

  const selectionIsEdgeOnly = selectedEdges.length > 0 && selectedNodes.length === 0;
  const showColorCycle =
    selectedNodes.length > 0 &&
    selectedNodes.every((n) => n.type === 'sticky' || n.type === 'shape' || n.type === 'frame');

  const selectedArrow: ArrowStyle | null = selectionIsEdgeOnly
    ? uniqueValue(selectedEdges.map((e) => e.arrow ?? 'end'))
    : null;
  const selectedLineStyle: LineStyle | null = selectionIsEdgeOnly
    ? uniqueValue(selectedEdges.map((e) => e.style))
    : null;
  const selectedEdgeKind: EdgeKind | null = selectionIsEdgeOnly
    ? uniqueValue(selectedEdges.map((e) => e.kind ?? 'arrow'))
    : null;
  const selectedCardinality: Cardinality | null = selectionIsEdgeOnly
    ? uniqueValue(selectedEdges.map((e) => e.cardinality ?? '1:N'))
    : null;

  const handleCycleColor = useCallback(() => {
    for (const n of selectedNodes) {
      if (n.type === 'sticky' || n.type === 'shape' || n.type === 'frame') {
        store.updateNode(n.id, { color: nextStickyColor(n.color) });
      }
    }
  }, [selectedNodes, store]);

  const setArrowOnSelection = useCallback(
    (arrow: ArrowStyle) => {
      for (const id of selectedEdgeIds) store.setEdgeArrow(id, arrow);
    },
    [selectedEdgeIds, store],
  );
  const setLineStyleOnSelection = useCallback(
    (style: LineStyle) => {
      for (const id of selectedEdgeIds) store.setEdgeLineStyle(id, style);
    },
    [selectedEdgeIds, store],
  );
  const setEdgeKindOnSelection = useCallback(
    (kind: EdgeKind) => {
      for (const id of selectedEdgeIds) store.setEdgeKind(id, kind);
    },
    [selectedEdgeIds, store],
  );
  const setCardinalityOnSelection = useCallback(
    (cardinality: Cardinality) => {
      for (const id of selectedEdgeIds) store.setEdgeCardinality(id, cardinality);
    },
    [selectedEdgeIds, store],
  );

  // Clicking the already-active mode's button toggles it back off; clicking
  // any other mode switches to it (mutually exclusive — see ToolbarMode's doc).
  const toggleMode = useCallback(
    (mode: ToolbarMode) => onSetActiveMode(activeMode === mode ? 'none' : mode),
    [activeMode, onSetActiveMode],
  );

  if (readonly) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        padding: '8px 12px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        userSelect: 'none',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* ── Sticky picker ─────────────────────────────────────────────── */}
      <IconButton
        icon={StickyNote}
        label="Sticky note"
        caret
        open={openPicker === 'sticky'}
        buttonRef={stickyBtnRef}
        onClick={() => setOpenPicker((p) => (p === 'sticky' ? null : 'sticky'))}
      >
        {openPicker === 'sticky' && (
          <StickyColorPicker
            onPick={(color) => {
              addNode((id, pos, order) => makeStickyNode(id, pos, color, order), 'sticky');
              setOpenPicker(null);
            }}
          />
        )}
      </IconButton>

      <IconButton
        icon={Type}
        label="Text"
        onClick={() => addNode((id, pos, order) => makeTextNode(id, pos, order), 'text')}
      />

      {/* ── Shape picker ──────────────────────────────────────────────── */}
      <IconButton
        icon={Shapes}
        label="Shape"
        caret
        open={openPicker === 'shape'}
        onClick={() => setOpenPicker((p) => (p === 'shape' ? null : 'shape'))}
      >
        {openPicker === 'shape' && (
          <ShapePicker
            onPick={(kind: ShapeKind) => {
              addNode((id, pos, order) => makeShapeNode(id, pos, order, kind), 'shape');
              setOpenPicker(null);
            }}
          />
        )}
      </IconButton>

      <IconButton
        icon={Frame}
        label="Frame / group"
        onClick={() => addNode((id, pos, order) => makeFrameNode(id, pos, order), 'frame')}
      />

      {/* ── Emoji picker ──────────────────────────────────────────────── */}
      <IconButton
        icon={Smile}
        label="Emoji"
        caret
        open={openPicker === 'emoji'}
        onClick={() => setOpenPicker((p) => (p === 'emoji' ? null : 'emoji'))}
      >
        {openPicker === 'emoji' && (
          <EmojiPicker
            onPick={(emoji) => {
              addNode((id, pos, order) => makeEmojiNode(id, pos, order, emoji), 'emoji');
              setOpenPicker(null);
            }}
          />
        )}
      </IconButton>

      {/* ── Icon picker ───────────────────────────────────────────────── */}
      <IconButton
        icon={Sparkles}
        label="Icon"
        caret
        open={openPicker === 'icon'}
        onClick={() => setOpenPicker((p) => (p === 'icon' ? null : 'icon'))}
      >
        {openPicker === 'icon' && (
          <IconPicker
            onPick={(name) => {
              addNode((id, pos, order) => makeIconNode(id, pos, order, name), 'icon');
              setOpenPicker(null);
            }}
          />
        )}
      </IconButton>

      <IconButton
        icon={MessageCircle}
        label="Comment"
        active={activeMode === 'comment'}
        onClick={() => toggleMode('comment')}
      />

      {/* ── Pencil (persisted freehand drawing) ──────────────────────────── */}
      <IconButton
        icon={Pencil}
        label={activeMode === 'pencil' ? 'Exit pencil mode' : 'Pencil'}
        active={activeMode === 'pencil'}
        onClick={() => toggleMode('pencil')}
      />

      {/* ── Annotation (ephemeral discussion scribbles) ──────────────────── */}
      <IconButton
        icon={Eraser}
        label={activeMode === 'annotation' ? 'Exit annotation mode' : 'Annotation'}
        active={activeMode === 'annotation'}
        onClick={() => toggleMode('annotation')}
      />

      {activeMode === 'annotation' && hasAnnotations && (
        <IconButton icon={Trash2} label="Wipe all annotations" onClick={onWipeAnnotations} />
      )}

      <Divider />

      {showColorCycle && (
        <IconButton icon={Palette} label="Cycle colour" onClick={handleCycleColor} />
      )}

      {selectionIsEdgeOnly && (
        <>
          <EdgeKindToggle value={selectedEdgeKind} onChange={setEdgeKindOnSelection} />

          {selectedEdgeKind === 'cardinality' ? (
            <CardinalitySelect value={selectedCardinality} onChange={setCardinalityOnSelection} />
          ) : (
            <ArrowSelect value={selectedArrow} onChange={setArrowOnSelection} />
          )}

          <LineStyleToggle value={selectedLineStyle} onChange={setLineStyleOnSelection} />
        </>
      )}

      {onOpenHistory && (
        <IconButton icon={History} label="Version history" onClick={onOpenHistory} />
      )}

      <Divider />

      <SaveIndicator status={syncStatus} />
    </div>
  );
}

/** The single value shared by every item in `values`, or null if they differ
 * (or the list is empty) — used to show a control's value only when the
 * whole (possibly multi-edge) selection agrees on it. */
function uniqueValue<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  const set = new Set(values);
  return set.size === 1 ? values[0] : null;
}
