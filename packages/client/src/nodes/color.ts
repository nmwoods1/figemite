// ── The single hexToRgba implementation ──────────────────────────────────────
//
// Ported from the legacy figmalade prototype, which defined this exact same
// function twice — once in StickyNode.tsx, once in FrameNode.tsx. Both node
// components need "the fill color at reduced alpha" (sticky's border shadow,
// frame's fill + border), so this lives once here and both import it.

/** Convert a hex color (`#rgb` or `#rrggbb`, with or without `#`) to an
 * `rgba(r, g, b, alpha)` string. Falls back to returning `hex` unchanged if
 * it can't be parsed as a hex color (e.g. an already-valid CSS color name). */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.length === 3 ? clean[0] + clean[0] : clean.slice(0, 2), 16);
  const g = parseInt(clean.length === 3 ? clean[1] + clean[1] : clean.slice(2, 4), 16);
  const b = parseInt(clean.length === 3 ? clean[2] + clean[2] : clean.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
