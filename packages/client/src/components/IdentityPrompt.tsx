// ── IdentityPrompt: first-time display-name capture ─────────────────────────
//
// Ported from the legacy figmalade prototype's `src/components/
// IdentityPrompt.tsx` (visual design kept faithfully), rewired from the
// legacy's `setStoredAuthor` (src/lib/comment-io.ts) onto this codebase's
// `lib/identity.ts`'s `setLocalUser` — the same stored name backs both
// comment authorship and realtime presence/awareness in this rewrite.
//
// This component only captures + persists a name and reports it via
// `onConfirm`; it does NOT decide whether to render at all. Callers gate
// mounting on `lib/identity.ts`'s `hasStoredUser()` so a returning user (one
// who already has a stored name) is never prompted again.
import { useState } from 'react';
import { setLocalUser } from '../lib/identity.js';

interface IdentityPromptProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export default function IdentityPrompt({ onConfirm, onCancel }: IdentityPromptProps) {
  const [name, setName] = useState('');

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLocalUser(trimmed);
    onConfirm(trimmed);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: '24px 28px',
          width: 320,
          boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Who are you?</div>
        <p style={{ margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
          Your name will appear to others editing this board. It&apos;s stored locally and never
          sent anywhere.
        </p>
        <input
          autoFocus
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onCancel();
          }}
          style={{
            padding: '8px 12px',
            fontSize: 13,
            border: '1.5px solid #cbd5e1',
            borderRadius: 7,
            outline: 'none',
            color: '#0f172a',
          }}
          onFocus={(e) => {
            (e.target as HTMLInputElement).style.borderColor = '#6366f1';
          }}
          onBlur={(e) => {
            (e.target as HTMLInputElement).style.borderColor = '#cbd5e1';
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 500,
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              background: '#fff',
              color: '#64748b',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            style={{
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 600,
              border: 'none',
              borderRadius: 6,
              background: name.trim() ? '#0f172a' : '#e2e8f0',
              color: name.trim() ? '#fff' : '#94a3b8',
              cursor: name.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
