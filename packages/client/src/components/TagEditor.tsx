// ── Tag editor popover ───────────────────────────────────────────────────────
//
// Ported from the original prototype's `src/components/TagEditor.tsx`.
// Deviations:
//   - `saveTags` now comes from `lib/boards-api.ts` (which throws
//     `ReadOnlyError` in READONLY mode) instead of the prototype's
//     `lib/tags-io.ts`; normalization (`normalizeTag`/`normalizeTags`) moved
//     to the new pure-helper module `lib/tags.ts`.
//   - Each tag-removal button now has an accessible name ("Remove <tag>") so
//     RTL/a11y tooling can target it without relying on DOM structure.
import { useEffect, useRef, useState } from 'react';
import { saveTags } from '../lib/boards-api.js';
import { normalizeTag, normalizeTags } from '../lib/tags.js';

interface TagEditorProps {
  slug: string;
  currentTags: string[];
  allKnownTags: string[];
  onSaved: (newTags: string[]) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export default function TagEditor({
  slug,
  currentTags,
  allKnownTags,
  onSaved,
  onClose,
  anchorRef,
}: TagEditorProps) {
  const [tags, setTags] = useState<string[]>(currentTags);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Position the popover below the anchor
  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, left: rect.left });
  }, [anchorRef]);

  // Close on outside click or Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const suggestions = allKnownTags.filter(
    (t) => !tags.includes(t) && t.includes(normalizeTag(input)) && input.trim() !== '',
  );

  const addTag = (raw: string) => {
    const tag = normalizeTag(raw);
    if (!tag) return;
    if (!tags.includes(tag)) setTags((prev) => [...prev, tag]);
    setInput('');
  };

  const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));

  const handleInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const final = normalizeTags([...tags, ...(input.trim() ? [input] : [])]);
    try {
      await saveTags(slug, final);
      onSaved(final);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!pos) return null;

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: Math.min(pos.top, window.innerHeight - 260),
        left: Math.min(pos.left, window.innerWidth - 300),
        zIndex: 200,
        background: '#fff',
        border: '1.5px solid #e2e8f0',
        borderRadius: 12,
        boxShadow: '0 8px 30px rgba(0,0,0,0.14)',
        padding: '16px',
        width: 280,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Tags</div>

      {/* Current tag chips */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: tags.length > 0 ? 10 : 0,
        }}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: '#ede9fe',
              color: '#5b21b6',
              padding: '3px 8px',
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {tag}
            <button
              onClick={() => removeTag(tag)}
              aria-label={`Remove ${tag}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#7c3aed',
                fontSize: 13,
                lineHeight: 1,
                padding: 0,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* Input */}
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleInputKey}
        placeholder="Add tag, press Enter…"
        style={{
          width: '100%',
          padding: '7px 10px',
          fontSize: 13,
          border: '1.5px solid #e2e8f0',
          borderRadius: 7,
          outline: 'none',
          boxSizing: 'border-box',
          color: '#0f172a',
        }}
      />

      {/* Autocomplete suggestions */}
      {suggestions.length > 0 && (
        <div
          style={{
            marginTop: 4,
            border: '1.5px solid #e2e8f0',
            borderRadius: 7,
            overflow: 'hidden',
          }}
        >
          {suggestions.slice(0, 5).map((s) => (
            <button
              key={s}
              onMouseDown={(e) => {
                e.preventDefault();
                addTag(s);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '7px 10px',
                fontSize: 12,
                color: '#374151',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              # {s}
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button
          onClick={onClose}
          style={{
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 500,
            background: '#fff',
            color: '#374151',
            border: '1.5px solid #e2e8f0',
            borderRadius: 7,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            background: '#0f172a',
            color: '#fff',
            border: 'none',
            borderRadius: 7,
            cursor: saving ? 'wait' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
