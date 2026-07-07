// ── StickyColorPicker ─────────────────────────────────────────────────────────
//
// Ported from the legacy Toolbar.tsx's sticky-note color popover: a row of
// swatches for the 6 `STICKY_COLORS`. Used both by the "new sticky" button
// (picks the new node's initial color) and could be reused by a future
// "recolor selection" popover — for now the selected-node recolor affordance
// is the single-button "cycle colour" control (see Toolbar.tsx), matching the
// legacy's own `onCycleColor` (not a picker) for an existing selection.
import { STICKY_COLORS } from '@figemite/shared';
import type { StickyColor } from '@figemite/shared';
import { POPOVER } from './styles.js';

export function StickyColorPicker({ onPick }: { onPick: (color: StickyColor) => void }) {
  return (
    <div style={{ ...POPOVER, display: 'flex', gap: 6 }}>
      {STICKY_COLORS.map((c) => (
        <button
          key={c}
          title={c}
          onClick={() => onPick(c)}
          style={{
            width: 24,
            height: 24,
            background: c,
            border: '1.5px solid rgba(0,0,0,0.12)',
            borderRadius: 4,
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}
