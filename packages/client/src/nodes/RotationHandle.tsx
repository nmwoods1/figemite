// ── RotationHandle ────────────────────────────────────────────────────────────
//
// Ported from figmalade's src/components/RotationHandle.tsx: a small circular
// grab target rendered above a node's top edge. It sits as a sibling OUTSIDE
// the rotation wrapper (BaseNode's `data-testid="base-node-rotation"` div) so
// it doesn't spin along with the node it's rotating. Dragging computes the
// angle from the node's center to the pointer and applies that as the node's
// rotation; holding Shift snaps to 15° increments — ported 1:1, unchanged.

import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

export interface RotationHandleProps {
  nodeId: string;
  rotation: number;
  wrapperRef: RefObject<HTMLDivElement | null>;
  onRotate: (id: string, deg: number) => void;
}

export function RotationHandle({ nodeId, rotation, wrapperRef, onRotate }: RotationHandleProps) {
  const startRef = useRef<{ angle: number; rotation: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
      startRef.current = { angle: startAngle, rotation };
    },
    [rotation, wrapperRef],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!startRef.current) return;
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const currentAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
      let newRotation = startRef.current.rotation + (currentAngle - startRef.current.angle);
      if (e.shiftKey) {
        newRotation = Math.round(newRotation / 15) * 15;
      }
      onRotate(nodeId, newRotation);
    },
    [nodeId, wrapperRef, onRotate],
  );

  const handlePointerUp = useCallback(() => {
    startRef.current = null;
  }, []);

  return (
    <div
      className="nodrag"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title="Rotate (hold Shift to snap to 15°)"
      style={{
        position: 'absolute',
        top: -28,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: '#fff',
        border: '1.5px solid #94a3b8',
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <svg
        width={10}
        height={10}
        viewBox="0 0 10 10"
        fill="none"
        stroke="#475569"
        strokeWidth={1.4}
        strokeLinecap="round"
      >
        <path d="M 8,2 A 4 4 0 1 0 9,6" />
        <polyline points="7,0 9,2 7,4" />
      </svg>
    </div>
  );
}
