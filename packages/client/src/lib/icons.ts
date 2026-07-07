// ── Icon registry ────────────────────────────────────────────────────────────
//
// Ported verbatim from the original prototype's src/lib/icons.ts.
// Inline SVG paths for a small curated set of icons. Adding a new icon means
// dropping its name + `paths` (one or more path-data strings) into ICONS, then
// it shows up automatically in the toolbar's icon picker.
//
// All icons are designed against a 24×24 viewBox with `stroke="currentColor"`,
// `stroke-width="1.75"`, `stroke-linecap="round"`, `stroke-linejoin="round"`,
// and `fill="none"` — i.e. classic Feather/Lucide style line icons. Drawing
// them with `currentColor` lets IconNode set the colour with a single CSS
// property instead of patching every `<path>`.
//
// Note: this registry is hand-rolled SVG path data, NOT drawn from the
// `lucide-react` package — that dependency (added per P3-T19's plan) is used
// by the toolbar's icon-picker UI (chrome icons like StickyNote/Type/Frame),
// not by the board-rendered icon glyphs here.

export interface IconDef {
  name: string;
  category: 'communication' | 'actions' | 'objects' | 'symbols' | 'people' | 'media';
  // One path per stroke (so detached strokes don't connect).
  // For shapes that aren't paths (circle, line) we use a `circles`/`lines` array.
  paths?: string[];
  circles?: { cx: number; cy: number; r: number }[];
  lines?: { x1: number; y1: number; x2: number; y2: number }[];
}

export const ICONS: IconDef[] = [
  // ── communication ─────────────────────────────────────────────────────
  {
    name: 'mail',
    category: 'communication',
    paths: ['M4 6h16v12H4z', 'M4 6l8 6 8-6'],
  },
  {
    name: 'phone',
    category: 'communication',
    paths: [
      'M5 4h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
    ],
  },
  {
    name: 'message',
    category: 'communication',
    paths: ['M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  },
  {
    name: 'bell',
    category: 'communication',
    paths: ['M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
  },

  // ── actions ───────────────────────────────────────────────────────────
  { name: 'check', category: 'actions', paths: ['M4 12l5 5L20 6'] },
  {
    name: 'x',
    category: 'actions',
    lines: [
      { x1: 6, y1: 6, x2: 18, y2: 18 },
      { x1: 6, y1: 18, x2: 18, y2: 6 },
    ],
  },
  {
    name: 'plus',
    category: 'actions',
    lines: [
      { x1: 12, y1: 5, x2: 12, y2: 19 },
      { x1: 5, y1: 12, x2: 19, y2: 12 },
    ],
  },
  {
    name: 'thumbs-up',
    category: 'actions',
    paths: [
      'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.3a2 2 0 0 0 2-1.7l1.4-9A2 2 0 0 0 19.7 9z',
      'M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3',
    ],
  },
  {
    name: 'thumbs-down',
    category: 'actions',
    paths: [
      'M10 15v4a3 3 0 0 0 3 3l4-9V2H5.7a2 2 0 0 0-2 1.7L2.3 12.7A2 2 0 0 0 4.3 15z',
      'M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3',
    ],
  },
  {
    name: 'edit',
    category: 'actions',
    paths: [
      'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7',
      'M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z',
    ],
  },
  {
    name: 'search',
    category: 'actions',
    paths: ['M21 21l-4.3-4.3'],
    circles: [{ cx: 11, cy: 11, r: 7 }],
  },
  {
    name: 'link',
    category: 'actions',
    paths: [
      'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 1 0-7-7l-1.7 1.7',
      'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
    ],
  },

  // ── objects ───────────────────────────────────────────────────────────
  {
    name: 'lightbulb',
    category: 'objects',
    paths: [
      'M9 18h6',
      'M10 22h4',
      'M12 2a7 7 0 0 0-4 12.7c1 .8 1.5 1.6 1.5 2.3v1h5v-1c0-.7.5-1.5 1.5-2.3A7 7 0 0 0 12 2z',
    ],
  },
  {
    name: 'flame',
    category: 'objects',
    paths: [
      'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z',
    ],
  },
  {
    name: 'star',
    category: 'objects',
    paths: ['M12 2l3.1 6.3 7 1-5 4.9 1.2 6.8L12 17.8 5.7 21l1.2-6.8-5-4.9 7-1z'],
  },
  {
    name: 'heart',
    category: 'objects',
    paths: [
      'M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1-1A5.5 5.5 0 0 0 3.2 13.5l1 1L12 22l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.7z',
    ],
  },
  {
    name: 'flag',
    category: 'objects',
    paths: ['M4 22V4a8 8 0 0 1 14 4 8 8 0 0 0 14 4', 'M4 4h14'],
    lines: [{ x1: 4, y1: 22, x2: 4, y2: 4 }],
  },
  {
    name: 'key',
    category: 'objects',
    paths: ['M21 2l-9.6 9.6', 'M15.5 7.5l3 3', 'M2 22l4.5-1L21 6.5 17.5 3 3 17.5z'],
  },
  {
    name: 'lock',
    category: 'objects',
    paths: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 1 1 8 0v4'],
  },
  {
    name: 'calendar',
    category: 'objects',
    paths: ['M3 6h18v15H3z'],
    lines: [
      { x1: 16, y1: 3, x2: 16, y2: 9 },
      { x1: 8, y1: 3, x2: 8, y2: 9 },
      { x1: 3, y1: 11, x2: 21, y2: 11 },
    ],
  },
  {
    name: 'clock',
    category: 'objects',
    circles: [{ cx: 12, cy: 12, r: 9 }],
    paths: ['M12 7v5l3 2'],
  },
  {
    name: 'file',
    category: 'objects',
    paths: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
  },
  {
    name: 'folder',
    category: 'objects',
    paths: ['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6l2 3h8a2 2 0 0 1 2 2z'],
  },

  // ── symbols ───────────────────────────────────────────────────────────
  {
    name: 'alert',
    category: 'symbols',
    paths: ['M10.3 3.86L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.86a2 2 0 0 0-3.4 0z'],
    lines: [
      { x1: 12, y1: 9, x2: 12, y2: 13 },
      { x1: 12, y1: 17, x2: 12, y2: 17 },
    ],
  },
  {
    name: 'info',
    category: 'symbols',
    circles: [{ cx: 12, cy: 12, r: 9 }],
    lines: [
      { x1: 12, y1: 16, x2: 12, y2: 12 },
      { x1: 12, y1: 8, x2: 12, y2: 8 },
    ],
  },
  {
    name: 'help',
    category: 'symbols',
    circles: [{ cx: 12, cy: 12, r: 9 }],
    paths: ['M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3'],
    lines: [{ x1: 12, y1: 17, x2: 12, y2: 17 }],
  },
  {
    name: 'home',
    category: 'symbols',
    paths: ['M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z'],
  },
  {
    name: 'settings',
    category: 'symbols',
    circles: [{ cx: 12, cy: 12, r: 3 }],
    paths: [
      'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    ],
  },
  {
    name: 'zap',
    category: 'symbols',
    paths: ['M13 2L3 14h9l-1 8 10-12h-9z'],
  },

  // ── people ────────────────────────────────────────────────────────────
  {
    name: 'user',
    category: 'people',
    paths: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'],
    circles: [{ cx: 12, cy: 7, r: 4 }],
  },
  {
    name: 'users',
    category: 'people',
    paths: [
      'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
      'M22 21v-2a4 4 0 0 0-3-3.9',
      'M16 3.1a4 4 0 0 1 0 7.8',
    ],
    circles: [{ cx: 9, cy: 7, r: 4 }],
  },

  // ── media ─────────────────────────────────────────────────────────────
  {
    name: 'image',
    category: 'media',
    paths: ['M3 5h18v14H3z', 'M3 17l5-5 4 4 3-3 6 6'],
    circles: [{ cx: 9, cy: 9, r: 1.5 }],
  },
  {
    name: 'video',
    category: 'media',
    paths: ['M16 9l5-3v12l-5-3z', 'M2 6h14v12H2z'],
  },
];

export function getIcon(name: string): IconDef | undefined {
  return ICONS.find((i) => i.name === name);
}

export const ICON_CATEGORIES: IconDef['category'][] = [
  'symbols',
  'actions',
  'communication',
  'people',
  'objects',
  'media',
];
