// ── StickyNode ────────────────────────────────────────────────────────────────
//
// Ported from figmalade's StickyNode.tsx. Differences from the legacy:
//   - `hexToRgba` now comes from `./color.js` (was duplicated inline).
//   - Uses `useEditableText` instead of local editing/draft state.
//   - Uses `ConnectionHandles`/`BaseNode` for the shared chrome.
//   - The drill-in (sub-board) badge is dropped — that's a later task. The
//     description badge (render-only: presence indicator + seam) IS built.
//   - `interactive` (whether handles/edit affordances show) is derived from
//     whether `data.onTextChange` is present, matching the read-only-vs-
//     editable seam the task specifies, rather than a separate READONLY
//     global (BoardCanvas decides what callbacks to pass down).
//   - P4-T24: `NodeResizer` is wired (no rotation — sticky notes don't
//     rotate in the legacy either), gated on `selected && !!data.onResizeEnd
//     && !useIsMultiSelected()` — hidden while the multi-select group-resize
//     overlay (canvas/MultiSelectResizer.tsx) is active.

import type { NodeProps, Node } from '@xyflow/react';
import { NodeResizer } from '@xyflow/react';
import { ConnectionHandles } from './ConnectionHandles.js';
import { BaseNode } from './BaseNode.js';
import { useEditableText } from './useEditableText.js';
import { useIsMultiSelected } from './use-is-multi-selected.js';

export interface StickyNodeData extends Record<string, unknown> {
  text: string;
  color: string;
  width: number;
  height: number;
  description?: string;
  onTextChange?: (id: string, newText: string) => void;
  onOpenDescription?: (id: string) => void;
  onResizeEnd?: (id: string, size: { width: number; height: number }) => void;
}

/** Ported from legacy StickyNode's NodeResizer minWidth/minHeight. */
const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;

export function StickyNode({ id, data, selected }: NodeProps<Node<StickyNodeData, 'sticky'>>) {
  const editable = !!data.onTextChange;
  const resizable = !!data.onResizeEnd;
  const multiSelected = useIsMultiSelected();
  const { editing, draft, startEdit, onChange, commit, cancel } = useEditableText(
    data.text,
    (next) => data.onTextChange?.(id, next),
  );

  const bg = data.color;

  return (
    <>
      <NodeResizer
        nodeId={id}
        isVisible={!!selected && resizable && !multiSelected}
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        handleStyle={{
          width: 8,
          height: 8,
          background: '#fff',
          border: '1.5px solid #94a3b8',
          borderRadius: 2,
        }}
        onResizeEnd={(_event, params) =>
          data.onResizeEnd?.(id, { width: params.width, height: params.height })
        }
      />

      <BaseNode
        nodeId={id}
        selected={selected}
        description={data.description}
        onOpenDescription={data.onOpenDescription}
        onDoubleClick={editable ? startEdit : undefined}
      >
        <ConnectionHandles interactive={editable} />
        <div
          data-testid="sticky-body"
          style={{
            width: '100%',
            height: '100%',
            background: bg,
            borderRadius: 4,
            boxSizing: 'border-box',
            padding: 10,
            display: 'flex',
            alignItems: 'flex-start',
            cursor: 'default',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {editing ? (
            <textarea
              className="nodrag"
              autoFocus
              value={draft}
              onChange={(e) => onChange(e.target.value)}
              onBlur={commit}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancel();
                e.stopPropagation();
              }}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                resize: 'none',
                fontSize: 14,
                fontWeight: 500,
                color: '#1e293b',
                lineHeight: 1.5,
                fontFamily: 'inherit',
                cursor: 'text',
              }}
            />
          ) : (
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: '#1e293b',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                width: '100%',
                userSelect: 'none',
                opacity: data.text ? 1 : 0.4,
              }}
            >
              {data.text || 'Double-click to edit'}
            </span>
          )}
        </div>
      </BaseNode>
    </>
  );
}
