// ── ShapeNode ─────────────────────────────────────────────────────────────────
//
// Ported from the prototype's ShapeNode.tsx (the biggest single port in this
// task, ~428 lines): the 12 `ShapeKind`s rendered as scalable SVG, each with
// a shape-specific text inset so labels stay clear of corners the shape
// carves out (a triangle's tip, a diamond's points, …). The drill-in badge
// is still out of scope (a later task) — only the description badge (a
// presence indicator + open-seam) is built.
//
// P4-T24: `NodeResizer` and `RotationHandle` are rendered as SIBLINGS of
// `BaseNode` — NOT inside its rotation-transform wrapper — so neither the
// resize handles nor the rotation knob spin along with the shape (matching
// the legacy's identical sibling placement; see EmojiNode.tsx's module doc
// for the same rationale). `RotationHandle` measures `BaseNode`'s rotation
// div via its `rotationRef` prop to compute the drag angle around the
// node's actual (rotating) center.
//
// Diamond nuance (ported faithfully): a diamond's visual vertices sit INSET
// from its bounding-box edges (see `renderShape`'s diamond case — the
// polygon points are NOT at the bbox edge midpoints), so the default
// bbox-edge-midpoint `<Handle>` placement `ConnectionHandles` gives every
// other shape would visually float off the diamond's outline. The legacy's
// `getDiamondAnchors(w, h)` computes the 4 exact vertex coordinates matching
// the polygon's own points (`t=(w/2,1) r=(w-1,h/2) b=(w/2,h-1) l=(1,h/2)`);
// `ConnectionHandles`'s `anchors` prop (built for exactly this case, see its
// module doc) takes those coordinates directly.

import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { NodeResizer } from '@xyflow/react';
import type { ShapeKind } from '@figemite/shared';
import { ConnectionHandles } from './ConnectionHandles.js';
import type { HandleAnchors } from './ConnectionHandles.js';
import { BaseNode } from './BaseNode.js';
import { RotationHandle } from './RotationHandle.js';
import { useEditableText } from './useEditableText.js';
import { useIsMultiSelected } from './use-is-multi-selected.js';

export interface ShapeNodeData extends Record<string, unknown> {
  shape: ShapeKind;
  text?: string;
  color: string;
  width: number;
  height: number;
  description?: string;
  rotation?: number;
  hasSubBoard?: boolean;
  canCreateSubBoard?: boolean;
  onTextChange?: (id: string, newText: string) => void;
  onOpenDescription?: (id: string) => void;
  onDrillIn?: (id: string) => void;
  onResizeEnd?: (id: string, size: { width: number; height: number }) => void;
  onRotate?: (id: string, rotation: number) => void;
}

/** Ported from legacy ShapeNode's NodeResizer minWidth/minHeight. */
const MIN_WIDTH = 60;
const MIN_HEIGHT = 40;

// ── Shape-specific geometry helpers ─────────────────────────────────────────
//
// Each shape draws into the full node bounds (w, h). Returning an inset for
// text keeps labels away from corners that the shape carves out.

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

interface TextInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface ShapeRender {
  element: ReactNode;
  textInset: TextInset;
}

function renderShape(
  shape: ShapeKind,
  w: number,
  h: number,
  fill: string,
  stroke: string,
): ShapeRender {
  const noInset: TextInset = { top: 8, right: 8, bottom: 8, left: 8 };
  const sw = 2; // stroke width

  if (shape === 'rect') {
    return {
      element: (
        <rect
          x={1}
          y={1}
          width={w - 2}
          height={h - 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      ),
      textInset: noInset,
    };
  }

  if (shape === 'roundRect') {
    const r = clamp(Math.min(w, h) * 0.12, 6, 24);
    return {
      element: (
        <rect
          x={1}
          y={1}
          width={w - 2}
          height={h - 2}
          rx={r}
          ry={r}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      ),
      textInset: noInset,
    };
  }

  if (shape === 'ellipse') {
    return {
      element: (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={(w - 2) / 2}
          ry={(h - 2) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      ),
      textInset: { top: h * 0.12, bottom: h * 0.12, left: w * 0.1, right: w * 0.1 },
    };
  }

  if (shape === 'diamond') {
    const pts = `${w / 2},1 ${w - 1},${h / 2} ${w / 2},${h - 1} 1,${h / 2}`;
    return {
      element: <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />,
      textInset: { top: h * 0.2, bottom: h * 0.2, left: w * 0.18, right: w * 0.18 },
    };
  }

  if (shape === 'triangle') {
    const pts = `${w / 2},1 ${w - 1},${h - 1} 1,${h - 1}`;
    return {
      element: <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />,
      textInset: { top: h * 0.4, bottom: 8, left: w * 0.15, right: w * 0.15 },
    };
  }

  if (shape === 'parallelogram') {
    const skew = clamp(w * 0.18, 12, h * 0.5);
    const pts = `${skew},1 ${w - 1},1 ${w - skew},${h - 1} 1,${h - 1}`;
    return {
      element: <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />,
      textInset: { top: 8, bottom: 8, left: skew + 6, right: skew + 6 },
    };
  }

  if (shape === 'hexagon') {
    const dx = clamp(w * 0.22, 12, h * 0.5);
    const pts = `${dx},1 ${w - dx},1 ${w - 1},${h / 2} ${w - dx},${h - 1} ${dx},${h - 1} 1,${h / 2}`;
    return {
      element: <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />,
      textInset: { top: 8, bottom: 8, left: dx + 6, right: dx + 6 },
    };
  }

  if (shape === 'pentagon') {
    const pts = `${w / 2},1 ${w - 1},${h * 0.4} ${w * 0.82},${h - 1} ${w * 0.18},${h - 1} 1,${h * 0.4}`;
    return {
      element: <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />,
      textInset: { top: h * 0.18, bottom: h * 0.05, left: w * 0.18, right: w * 0.18 },
    };
  }

  if (shape === 'star') {
    const cx = w / 2;
    const cy = h / 2;
    const rOuter = Math.min(w, h) / 2 - 2;
    const rInner = rOuter * 0.45;
    const pts: string[] = [];
    // 5-point star, 10 vertices alternating outer/inner, starting at top.
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? rOuter : rInner;
      pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
    }
    return {
      element: <polygon points={pts.join(' ')} fill={fill} stroke={stroke} strokeWidth={sw} />,
      textInset: { top: h * 0.32, bottom: h * 0.28, left: w * 0.25, right: w * 0.25 },
    };
  }

  if (shape === 'cylinder') {
    // Top ellipse + side rectangle (two vertical lines) + bottom curve.
    const rx = (w - 2) / 2;
    const ry = clamp(h * 0.12, 8, 36);
    const top = ry + 1;
    const bottom = h - ry - 1;
    const path = [
      `M 1,${top}`,
      `L 1,${bottom}`,
      `A ${rx} ${ry} 0 0 0 ${w - 1} ${bottom}`,
      `L ${w - 1},${top}`,
      `A ${rx} ${ry} 0 0 0 1 ${top}`,
      'Z',
    ].join(' ');
    return {
      element: (
        <>
          <path d={path} fill={fill} stroke={stroke} strokeWidth={sw} />
          {/* Top rim (drawn after fill so it sits visibly on the body). */}
          <path
            d={`M 1,${top} A ${rx} ${ry} 0 0 0 ${w - 1} ${top}`}
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
          />
        </>
      ),
      textInset: { top: ry * 2 + 4, bottom: ry + 4, left: 12, right: 12 },
    };
  }

  if (shape === 'cloud') {
    // Cluster of overlapping circles with a flat-ish bottom.
    const r1 = h * 0.32;
    const r2 = h * 0.4;
    const r3 = h * 0.34;
    const r4 = h * 0.3;
    const baseY = h - 4;
    const path = [
      `M ${w * 0.18},${baseY}`,
      `A ${r1} ${r1} 0 0 1 ${w * 0.18},${h * 0.55}`,
      `A ${r2} ${r2} 0 0 1 ${w * 0.42},${h * 0.18}`,
      `A ${r3} ${r3} 0 0 1 ${w * 0.7},${h * 0.18}`,
      `A ${r2} ${r2} 0 0 1 ${w * 0.86},${h * 0.5}`,
      `A ${r4} ${r4} 0 0 1 ${w * 0.82},${baseY}`,
      'Z',
    ].join(' ');
    return {
      element: <path d={path} fill={fill} stroke={stroke} strokeWidth={sw} />,
      textInset: { top: h * 0.25, bottom: h * 0.2, left: w * 0.18, right: w * 0.18 },
    };
  }

  if (shape === 'arrow') {
    // Block arrow pointing right.
    const tipW = clamp(h * 0.4, 16, w * 0.35);
    const shaftY = h * 0.3;
    const shaftYB = h * 0.7;
    const tipX = w - 1;
    const headX = w - tipW;
    const pts = `1,${shaftY} ${headX},${shaftY} ${headX},1 ${tipX},${h / 2} ${headX},${h - 1} ${headX},${shaftYB} 1,${shaftYB}`;
    return {
      element: <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />,
      textInset: { top: shaftY + 4, bottom: h - shaftYB + 4, left: 10, right: tipW + 6 },
    };
  }

  // Fallback — shouldn't happen (ShapeKind is exhaustive above), but render a
  // rect so an unrecognized persisted value doesn't crash the canvas.
  return {
    element: (
      <rect x={1} y={1} width={w - 2} height={h - 2} fill={fill} stroke={stroke} strokeWidth={sw} />
    ),
    textInset: noInset,
  };
}

// Returns the four connection vertex coordinates for a diamond, matching the
// polygon points used in renderShape. Used for precise handle placement so
// handles appear exactly at the tips, not at bbox edge midpoints.
function getDiamondAnchors(w: number, h: number): HandleAnchors {
  return {
    t: { x: w / 2, y: 1 },
    r: { x: w - 1, y: h / 2 },
    b: { x: w / 2, y: h - 1 },
    l: { x: 1, y: h / 2 },
  };
}

export function ShapeNode({ id, data, selected }: NodeProps<Node<ShapeNodeData, 'shape'>>) {
  const editable = !!data.onTextChange;
  const resizable = !!data.onResizeEnd;
  const rotatable = !!data.onRotate;
  const multiSelected = useIsMultiSelected();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { editing, draft, startEdit, onChange, commit, cancel } = useEditableText(
    data.text ?? '',
    (next) => {
      const trimmed = next.trim();
      data.onTextChange?.(id, trimmed);
    },
  );

  const w = data.width;
  const h = data.height;
  const stroke = selected ? '#2563eb' : 'rgba(0,0,0,0.35)';
  const { element, textInset } = useMemo(
    () => renderShape(data.shape, w, h, data.color, stroke),
    [data.shape, w, h, data.color, stroke],
  );
  const isDiamond = data.shape === 'diamond';
  const diamondAnchors = isDiamond ? getDiamondAnchors(w, h) : undefined;

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
        hasSubBoard={data.hasSubBoard}
        canCreateSubBoard={data.canCreateSubBoard}
        onDrillIn={data.onDrillIn}
        rotationRef={wrapperRef}
        descriptionBadgeStyle={
          isDiamond
            ? { top: Math.round(h * 0.14), right: 'auto', left: 'calc(50% - 8px)' }
            : undefined
        }
        drillInBadgeStyle={
          isDiamond
            ? { top: Math.round(h * 0.14), right: 'auto', left: 'calc(50% - 28px)' }
            : undefined
        }
      >
        <ConnectionHandles interactive={editable} anchors={diamondAnchors} />

        <div style={{ width: '100%', height: '100%', position: 'relative', cursor: 'default' }}>
          <svg
            width={w}
            height={h}
            viewBox={`0 0 ${w} ${h}`}
            style={{ display: 'block', position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            {element}
          </svg>

          <div
            style={{
              position: 'absolute',
              top: textInset.top,
              right: textInset.right,
              bottom: textInset.bottom,
              left: textInset.left,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              pointerEvents: 'auto',
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
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    commit();
                  }
                  e.stopPropagation();
                }}
                style={{
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  resize: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#1e293b',
                  textAlign: 'center',
                  lineHeight: 1.4,
                  width: '100%',
                  fontFamily: 'inherit',
                }}
              />
            ) : (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#1e293b',
                  textAlign: 'center',
                  lineHeight: 1.4,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  userSelect: 'none',
                }}
              >
                {data.text || ''}
              </span>
            )}
          </div>
        </div>
      </BaseNode>
    </>
  );
}
