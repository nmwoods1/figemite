import type { StickyColor, ShapeKind, WH } from './board.js';

// The suggested sticky-color palette shown in the color picker (and the
// default cycled through by `nextStickyColor`) — not an exhaustive
// constraint. `StickyColor` is a free-form hex string, so a sticky's `color`
// may legitimately be a hex value outside this list (e.g. from a legacy
// board or an external import).
export const STICKY_COLORS: StickyColor[] = [
  '#fef3c7',
  '#dbeafe',
  '#dcfce7',
  '#fce7f3',
  '#ede9fe',
  '#e2e8f0',
];

export const SHAPE_KINDS: ShapeKind[] = [
  'rect',
  'roundRect',
  'ellipse',
  'diamond',
  'triangle',
  'parallelogram',
  'hexagon',
  'pentagon',
  'star',
  'cylinder',
  'cloud',
  'arrow',
];

// Bumped whenever BoardFile's on-disk shape changes in a way that requires
// migration. Stamped onto every BoardFile; migration/validation that upgrades
// legacy files to the current version is implemented separately.
export const FORMAT_VERSION = 1;

export const DEFAULT_STICKY_SIZE: WH = { width: 200, height: 160 };
export const DEFAULT_SHAPE_SIZE: WH = { width: 160, height: 100 };
export const DEFAULT_FRAME_SIZE: WH = { width: 480, height: 320 };
export const DEFAULT_EMOJI_SIZE = 64;
export const DEFAULT_ICON_SIZE = 48;
