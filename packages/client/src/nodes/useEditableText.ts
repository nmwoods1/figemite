// ── The shared inline-edit state machine ─────────────────────────────────────
//
// Every text-bearing node (Sticky/Text/Shape/Frame/Emoji) needs the same
// dance: double-click enters edit mode, typing tracks a local draft separate
// from the committed value (so other peers' concurrent edits don't clobber
// keystrokes mid-edit), blur/Enter commits, Escape reverts. Ported from the
// (near-identical, copy-pasted per component) `editing`/`draft` state in each
// legacy node component into one reusable hook.
//
// Scope note (P3-T19, render-only phase): this hook is the seam — node
// components call `startEdit()` from a double-click handler ONLY when an
// `onTextChange` callback is present in `data` (read-only boards omit it, so
// nodes stay non-editable). Wiring that guard lives in each node component,
// not here.

import { useCallback, useState } from 'react';

export interface EditableText {
  /** Whether the node is currently in edit mode. */
  editing: boolean;
  /** The in-progress (uncommitted) text value. */
  draft: string;
  /** Enter edit mode, seeding the draft from the current value. */
  startEdit: () => void;
  /** Update the draft while editing. */
  onChange: (value: string) => void;
  /** Exit edit mode, calling `onCommit(draft)` iff the draft differs from `value`. */
  commit: () => void;
  /** Exit edit mode, reverting the draft to `value` without committing. */
  cancel: () => void;
}

/**
 * The inline-edit state machine for a single text value. `value` is the
 * committed/external value (e.g. `data.text`); `onCommit` is called with the
 * new value when the user finishes editing with a real change.
 */
export function useEditableText(value: string, onCommit: (next: string) => void): EditableText {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // Tracks the `value` the draft was last synced from, so we can tell
  // "value changed externally" apart from "value changed because we're
  // mid-edit" — without an effect. This is React's documented "adjust state
  // during rendering" pattern (https://react.dev/learn/you-might-not-need-an-effect):
  // calling setState directly in the render body when a prop changes is
  // safe and avoids the extra commit + effect round-trip a `useEffect` would
  // cost, and (per `react-hooks/set-state-in-effect`) is the recommended
  // replacement for the legacy's `useEffect(() => setDraft(data.text), [data.text])`.
  const [lastSyncedValue, setLastSyncedValue] = useState(value);

  if (!editing && value !== lastSyncedValue) {
    setDraft(value);
    setLastSyncedValue(value);
  }

  const startEdit = useCallback(() => {
    setDraft(value);
    setLastSyncedValue(value);
    setEditing(true);
  }, [value]);

  const onChange = useCallback((next: string) => {
    setDraft(next);
  }, []);

  const commit = useCallback(() => {
    setEditing(false);
    if (draft !== value) {
      onCommit(draft);
    }
  }, [draft, value, onCommit]);

  const cancel = useCallback(() => {
    setDraft(value);
    setLastSyncedValue(value);
    setEditing(false);
  }, [value]);

  return { editing, draft, startEdit, onChange, commit, cancel };
}
