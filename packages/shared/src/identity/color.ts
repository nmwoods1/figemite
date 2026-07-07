// ── Cursor colour identity ───────────────────────────────────────────────────
//
// Ported verbatim from the prototype's src/lib/realtime-core.ts. Hashing a name
// into the palette gives the same colour across sessions for the same identity.

/** Palette of distinguishable cursor colours. */
export const CURSOR_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
];

/** Deterministically map a name to a colour from {@link CURSOR_COLORS}. */
export function colorForName(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length];
}
