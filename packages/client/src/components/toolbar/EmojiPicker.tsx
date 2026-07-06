// ── EmojiPicker ───────────────────────────────────────────────────────────────
//
// Ported from the legacy Toolbar.tsx's `EmojiPicker`: a curated set of emoji
// grouped by category, plus a free-text input for any other emoji.
import { useState } from 'react';
import { BTN, POPOVER } from './styles.js';

// Curated emoji set covering reactions, gestures, objects, and process markers
// — enough variety to match FigJam's stamp tray without shipping a full picker.
const EMOJI_GROUPS: { label: string; items: string[] }[] = [
  {
    label: 'Reactions',
    items: ['👍', '👎', '❤️', '🔥', '⭐', '✅', '❌', '⚠️', '❓', '💡', '🎉', '🚀'],
  },
  {
    label: 'Faces',
    items: ['😀', '😅', '😂', '🤔', '😍', '😎', '😢', '😮', '🤯', '😴', '🤩', '🙃'],
  },
  {
    label: 'Hands',
    items: ['👋', '👌', '🤝', '🙌', '👏', '🙏', '💪', '✋', '👇', '👆', '👈', '👉'],
  },
  {
    label: 'Objects',
    items: ['📌', '📎', '📝', '📊', '📅', '📦', '🔑', '🔒', '💰', '💎', '🏆', '🎯'],
  },
  {
    label: 'Symbols',
    items: ['🟢', '🟡', '🔴', '🔵', '🟣', '⚫', '◼️', '➕', '➖', '🔄', '🔁', '♻️'],
  },
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [custom, setCustom] = useState('');
  return (
    <div style={{ ...POPOVER, width: 312 }}>
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label} style={{ marginBottom: 8 }}>
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
            {group.label}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 2 }}>
            {group.items.map((e) => (
              <button
                key={e}
                onClick={() => onPick(e)}
                style={{
                  width: 24,
                  height: 24,
                  padding: 0,
                  border: '1px solid transparent',
                  borderRadius: 4,
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: 1,
                }}
                title={e}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          borderTop: '1px solid #f1f5f9',
          paddingTop: 8,
        }}
      >
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Paste any emoji…"
          maxLength={4}
          style={{
            flex: 1,
            fontSize: 13,
            padding: '4px 8px',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            outline: 'none',
            fontFamily: 'inherit',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) {
              onPick(custom.trim());
              setCustom('');
            }
          }}
        />
        <button
          type="button"
          style={{ ...BTN, padding: '4px 10px' }}
          disabled={!custom.trim()}
          onClick={() => {
            if (custom.trim()) {
              onPick(custom.trim());
              setCustom('');
            }
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
