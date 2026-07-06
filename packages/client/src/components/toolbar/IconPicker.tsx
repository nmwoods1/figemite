// ── IconPicker ────────────────────────────────────────────────────────────────
//
// Ported from the legacy Toolbar.tsx's `IconPicker`: icons grouped by
// category (lib/icons.ts's `ICON_CATEGORIES`), each rendered via IconNode's
// exported `IconGlyph` so the picker preview matches the on-canvas glyph.
import { ICON_CATEGORIES, ICONS } from '../../lib/icons.js';
import { IconGlyph } from '../../nodes/IconNode.js';
import { POPOVER } from './styles.js';

export function IconPicker({ onPick }: { onPick: (name: string) => void }) {
  return (
    <div style={{ ...POPOVER, width: 280, maxHeight: 360, overflowY: 'auto' }}>
      {ICON_CATEGORIES.map((cat) => {
        const items = ICONS.filter((i) => i.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} style={{ marginBottom: 8 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                marginBottom: 4,
              }}
            >
              {cat}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
              {items.map((icon) => (
                <button
                  key={icon.name}
                  onClick={() => onPick(icon.name)}
                  title={icon.name}
                  style={{
                    width: 36,
                    height: 36,
                    padding: 0,
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    background: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#1e293b',
                  }}
                >
                  <IconGlyph name={icon.name} size={20} color="#1e293b" />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
