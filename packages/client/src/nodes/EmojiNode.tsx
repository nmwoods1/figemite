// ── EmojiNode ─────────────────────────────────────────────────────────────────
//
// Ported from the prototype's EmojiNode.tsx: a single emoji glyph rendered at
// `size` pixels. Uses `useEditableText`/`ConnectionHandles`/`BaseNode` for
// the shared chrome. `ConnectionHandles` is nested INSIDE `BaseNode`'s
// children (i.e. inside the rotation wrapper), matching the legacy's DOM
// nesting exactly — so the handles rotate together with the glyph rather
// than staying axis-aligned.
//
// P4-T24: `NodeResizer` (keepAspectRatio, so the glyph always stays square)
// and `RotationHandle` are rendered as SIBLINGS of `BaseNode` — NOT inside
// its rotation wrapper — so neither the resize handles nor the rotation knob
// spin along with the glyph (matching the legacy's identical sibling
// placement). `RotationHandle` measures `BaseNode`'s rotation div via
// `rotationRef` to compute the drag angle around the node's actual center.

import { useRef } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { NodeResizer } from '@xyflow/react';
import { ConnectionHandles } from './ConnectionHandles.js';
import { BaseNode } from './BaseNode.js';
import { RotationHandle } from './RotationHandle.js';
import { useEditableText } from './useEditableText.js';
import { useIsMultiSelected } from './use-is-multi-selected.js';

export interface EmojiNodeData extends Record<string, unknown> {
  text: string;
  size: number;
  description?: string;
  rotation?: number;
  onTextChange?: (id: string, newText: string) => void;
  onOpenDescription?: (id: string) => void;
  onResizeEnd?: (id: string, size: number) => void;
  onRotate?: (id: string, rotation: number) => void;
}

/** Ported from legacy EmojiNode's NodeResizer minWidth/minHeight/keepAspectRatio. */
const MIN_WIDTH = 32;
const MIN_HEIGHT = 32;

export function EmojiNode({ id, data, selected }: NodeProps<Node<EmojiNodeData, 'emoji'>>) {
  const editable = !!data.onTextChange;
  const resizable = !!data.onResizeEnd;
  const rotatable = !!data.onRotate;
  const multiSelected = useIsMultiSelected();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { editing, draft, startEdit, onChange, commit, cancel } = useEditableText(
    data.text,
    (next) => {
      const trimmed = next.trim();
      if (trimmed) data.onTextChange?.(id, trimmed);
    },
  );

  const size = data.size;

  return (
    <>
      <NodeResizer
        nodeId={id}
        isVisible={!!selected && resizable && !multiSelected}
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        keepAspectRatio
        handleStyle={{
          width: 8,
          height: 8,
          background: '#fff',
          border: '1.5px solid #94a3b8',
          borderRadius: 2,
        }}
        onResizeEnd={(_event, params) =>
          data.onResizeEnd?.(id, Math.max(params.width, params.height))
        }
      />

      {selected && rotatable && !multiSelected && (
        <RotationHandle
          nodeId={id}
          rotation={data.rotation ?? 0}
          wrapperRef={wrapperRef}
          onRotate={(nid, deg) => data.onRotate?.(nid, deg)}
        />
      )}

      <BaseNode
        nodeId={id}
        selected={selected}
        rotation={data.rotation}
        description={data.description}
        onOpenDescription={data.onOpenDescription}
        onDoubleClick={editable ? startEdit : undefined}
        rotationRef={wrapperRef}
        descriptionBadgeStyle={{ top: 2, right: 2 }}
      >
        <ConnectionHandles interactive={editable} />
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: selected ? 'rgba(37,99,235,0.06)' : 'transparent',
            border: selected ? '1px dashed #2563eb' : '1px dashed transparent',
            borderRadius: 6,
            cursor: 'default',
            userSelect: 'none',
            position: 'relative',
            WebkitFontSmoothing: 'antialiased',
          }}
        >
          {editing ? (
            <input
              className="nodrag"
              autoFocus
              value={draft}
              onChange={(e) => onChange(e.target.value)}
              onBlur={commit}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') cancel();
                e.stopPropagation();
              }}
              style={{
                fontSize: Math.min(size * 0.7, 48),
                textAlign: 'center',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                width: '90%',
                fontFamily: 'inherit',
              }}
            />
          ) : (
            <span
              style={{
                fontSize: Math.min(size * 0.85, 320),
                lineHeight: 1,
                display: 'block',
              }}
            >
              {data.text}
            </span>
          )}
        </div>
      </BaseNode>
    </>
  );
}
