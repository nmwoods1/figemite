// ── PresenceLayer: remote cursors + editing outlines ────────────────────────
//
// P5-T30. Ported from the original prototype's
// `src/components/PresenceLayer.tsx` (visual style kept faithfully — colored
// arrow cursor + name pill, colored outline + "{name} editing" pill), adapted
// to this codebase's conventions:
//   - Positions are computed via `canvas/coords.ts`'s `flowToScreen`/
//     `nodeRect` — the ONE place that math lives in this rewrite — instead of
//     re-deriving `(x - vp.x) / vp.zoom`-style arithmetic inline, and instead
//     of the legacy's DOM `querySelector('[data-id="..."]')` +
//     `getBoundingClientRect()` approach for editing outlines (which required
//     a live DOM node and couldn't be unit-tested without a real layout
//     engine): outlines are derived purely from the `nodes` array + the live
//     viewport, so they work in jsdom.
//   - Presence data itself (the `remotes` list) is NOT this component's
//     concern — it's a prop, sourced from `hooks/usePresence.ts`. Cursor
//     publishing (pointer-move -> `usePresence`'s `publishCursor`) is also the
//     CALLER's job (BoardCanvas.tsx's `EditableCanvas`), not this component's
//     — keeping PresenceLayer pure render logic, easy to unit test without a
//     live awareness connection.
//
// An absolutely-positioned, `pointerEvents: 'none'` overlay (so it never
// blocks canvas interaction) meant to render as a sibling of `<ReactFlow>`
// inside the same measured container. Reads the live viewport via
// `useViewport()` (requires a `<ReactFlowProvider>`/`<ReactFlow>` ancestor).
import { useViewport } from '@xyflow/react';
import type { BoardNode } from '@figemite/shared';
import type { RemotePresence } from '../hooks/usePresence.js';
import { flowToScreen, nodeRect } from '../canvas/coords.js';

export interface PresenceLayerProps {
  remotes: RemotePresence[];
  nodes: BoardNode[];
}

/** Small "AI" label rendered inline in cursor/outline name pills. */
function AiBadge() {
  return (
    <span
      data-testid="presence-ai-badge"
      style={{
        background: 'rgba(255,255,255,0.25)',
        borderRadius: 3,
        padding: '0 3px',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.04em',
        lineHeight: '14px',
      }}
    >
      AI
    </span>
  );
}

export function PresenceLayer({ remotes, nodes }: PresenceLayerProps) {
  const viewport = useViewport();
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div
      data-testid="presence-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 9000,
      }}
    >
      {/* Editing outlines rendered first so cursors paint on top. */}
      {remotes.map((r) => {
        if (!r.editingNodeId) return null;
        const node = nodesById.get(r.editingNodeId);
        if (!node) return null;
        const rect = nodeRect(node);
        const topLeft = flowToScreen({ x: rect.x, y: rect.y }, viewport);
        const width = rect.width * viewport.zoom;
        const height = rect.height * viewport.zoom;
        return (
          <div
            key={`edit-${r.clientId}`}
            data-testid="presence-outline"
            style={{
              position: 'absolute',
              left: topLeft.x - 3,
              top: topLeft.y - 3,
              width: width + 6,
              height: height + 6,
              border: `2px solid ${r.user.color}`,
              borderRadius: 6,
              boxSizing: 'border-box',
              boxShadow: `0 0 0 4px ${r.user.color}33`,
              transition:
                'left 80ms linear, top 80ms linear, width 80ms linear, height 80ms linear',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -22,
                left: -2,
                padding: '2px 6px',
                background: r.user.color,
                color: 'white',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: 'system-ui, sans-serif',
                borderRadius: 4,
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {r.isAI && <AiBadge />}
              {r.isAI && r.agentClient ? `${r.agentClient} ` : ''}
              {r.user.name} editing
            </div>
          </div>
        );
      })}

      {/* Remote cursors. */}
      {remotes.map((r) => {
        if (!r.cursor) return null;
        const screen = flowToScreen(r.cursor, viewport);
        return (
          <div
            key={`cursor-${r.clientId}`}
            data-testid="presence-cursor"
            style={{
              position: 'absolute',
              left: screen.x,
              top: screen.y,
              transform: 'translate(-2px, -2px)',
              transition: 'left 80ms linear, top 80ms linear',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            {r.isAI ? (
              // AI peers get a distinct diamond cursor so they're recognisable
              // at a glance even without reading the name pill.
              <svg width="22" height="22" viewBox="0 0 18 18" style={{ display: 'block' }}>
                <path
                  d="M9 2 L16 9 L9 16 L2 9 Z"
                  fill={r.user.color}
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <circle cx="9" cy="9" r="2" fill="white" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 16 16" style={{ display: 'block' }}>
                <path
                  d="M2 2 L2 13 L5.5 10 L8 15 L10 14 L7.5 9 L13 9 Z"
                  fill={r.user.color}
                  stroke="white"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <div
              data-testid="presence-cursor-label"
              style={{
                position: 'absolute',
                left: r.isAI ? 18 : 14,
                top: r.isAI ? 18 : 14,
                padding: '2px 6px',
                background: r.user.color,
                color: 'white',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: 'system-ui, sans-serif',
                borderRadius: 4,
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {r.isAI && <AiBadge />}
              {r.isAI && r.agentClient ? `${r.agentClient} ` : ''}
              {r.user.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
