// ── New board modal ──────────────────────────────────────────────────────────
//
// Ported from the original prototype's `src/components/NewBoardModal.tsx`.
// Deviations:
//   - Slug validity is now checked against the shared `ID_GRAMMAR` (via
//     `isValidId`) instead of the prototype's local `SLUG_RE`, so the
//     client-side check matches exactly what the server/shared schema will
//     accept (letters, digits, `_`, `-`).
//   - Submission calls the new `lib/boards-api.ts`'s `createBoard` instead of
//     a raw `fetch('/api/boards', ...)`.
import { useEffect, useRef, useState } from 'react';
import { isValidId } from '@figemite/shared';
import { createBoard } from '../lib/boards-api.js';

interface NewBoardModalProps {
  onCreated: (slug: string) => void;
  onClose: () => void;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const SLUG_HELP =
  'Slug must contain only letters, digits, underscores, and hyphens (no spaces or other symbols).';

export default function NewBoardModal({ onCreated, onClose }: NewBoardModalProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManuallyEdited) setSlug(toSlug(value));
    setError(null);
  };

  const handleSlugChange = (value: string) => {
    setSlugManuallyEdited(true);
    setSlug(value);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSlug = slug || toSlug(name);
    if (!isValidId(finalSlug)) {
      setError(SLUG_HELP);
      return;
    }
    if (!name.trim()) {
      setError('Please enter a name.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createBoard(finalSlug, name.trim());
      onCreated(finalSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const displaySlug = slug || toSlug(name);
  const slugValid = displaySlug === '' || isValidId(displaySlug);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.4)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          width: '100%',
          maxWidth: 420,
          padding: '28px 28px 24px',
          fontFamily: 'Helvetica, Arial, sans-serif',
        }}
      >
        <h2
          style={{
            margin: '0 0 6px',
            fontSize: 18,
            fontWeight: 700,
            color: '#0f172a',
            letterSpacing: '-0.02em',
          }}
        >
          New board
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748b' }}>
          Create a blank whiteboard
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="new-board-name"
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: '#374151',
                marginBottom: 6,
              }}
            >
              Name
            </label>
            <input
              id="new-board-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Product brainstorm"
              style={{
                width: '100%',
                padding: '9px 12px',
                fontSize: 14,
                border: '1.5px solid #e2e8f0',
                borderRadius: 8,
                outline: 'none',
                boxSizing: 'border-box',
                color: '#0f172a',
              }}
              disabled={submitting}
            />
          </div>

          <div style={{ marginBottom: error ? 12 : 24 }}>
            <label
              htmlFor="new-board-slug"
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: '#374151',
                marginBottom: 6,
              }}
            >
              Slug <span style={{ fontWeight: 400, color: '#94a3b8' }}>(auto-generated)</span>
            </label>
            <input
              id="new-board-slug"
              type="text"
              value={displaySlug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="product-brainstorm"
              style={{
                width: '100%',
                padding: '9px 12px',
                fontSize: 13,
                fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                border: `1.5px solid ${slugValid ? '#e2e8f0' : '#fca5a5'}`,
                borderRadius: 8,
                outline: 'none',
                boxSizing: 'border-box',
                color: '#374151',
                background: '#f8fafc',
              }}
              disabled={submitting}
            />
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94a3b8' }}>
              Folder: <code>boards/{displaySlug || '…'}/</code>
            </p>
          </div>

          {error && (
            <div
              style={{
                marginBottom: 16,
                padding: '9px 12px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                fontSize: 13,
                color: '#dc2626',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '9px 18px',
                fontSize: 13,
                fontWeight: 500,
                background: '#fff',
                color: '#374151',
                border: '1.5px solid #e2e8f0',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '9px 18px',
                fontSize: 13,
                fontWeight: 600,
                background: '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: submitting ? 'wait' : 'pointer',
                opacity: submitting ? 0.5 : 1,
              }}
            >
              {submitting ? 'Creating…' : 'Create board'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
