// ── Board data types ─────────────────────────────────────────────────────────
//
// A BoardFile is the single JSON file persisted per board: boards/<slug>/board.json.
// The BoardNode union is the extension seam — future views (object-model entities,
// user-journey steps) will add new `type` discriminants here.

// Arrowhead placement: 'none' (plain line), 'end' (Forward — arrowhead at the
// target), 'start' (Back — arrowhead at the source), 'both' (arrowheads at both
// ends). Older boards only ever stored none/end/both; 'start' is additive and
// needs no migration.
export type ArrowStyle = 'none' | 'end' | 'start' | 'both';
export type LineStyle = 'solid' | 'dashed';

// How an edge is drawn: 'bezier' = current default curved look, 'straight' =
// a direct line, 'elbow' = orthogonal (right-angle) routing. Meaningful for
// both edge kinds ('arrow' and 'cardinality'), like `style`. Defaults to
// 'bezier' when absent, so existing board files stay valid.
export type EdgeRouting = 'bezier' | 'straight' | 'elbow';

// Edge kind: 'arrow' = directional arrows (existing behaviour); 'cardinality' =
// ER-style 1/N pills at each endpoint with no arrowheads. Defaults to 'arrow'
// when missing so old board files stay valid.
export type EdgeKind = 'arrow' | 'cardinality';
export type Cardinality = '1:1' | '1:N' | 'N:1' | 'N:N';

// A sticky's fill color as a hex string. Conventionally one of
// `STICKY_COLORS` (the picker palette) but any hex is valid — matches
// ShapeNode/FrameNode color.
export type StickyColor = string;

export interface XY {
  x: number;
  y: number;
}
export interface WH {
  width: number;
  height: number;
}

// All shape kinds the canvas can draw. New kinds are rendered by ShapeNode via
// SVG so they scale cleanly at any aspect ratio. Older boards may persist
// `'rect'` or `'ellipse'`; both stay valid forever.
export type ShapeKind =
  | 'rect'
  | 'ellipse'
  | 'roundRect'
  | 'diamond'
  | 'triangle'
  | 'parallelogram'
  | 'hexagon'
  | 'pentagon'
  | 'star'
  | 'cylinder'
  | 'cloud'
  | 'arrow';

// Shared fields for every node variant.
//
// `order` is an explicit z-order (higher = rendered in front), replacing
// reliance on array position — this lets the CRDT layer represent z-order
// independently of node insertion/replication order. Frame-vs-non-frame
// layering rules (e.g. frames always rendering behind their children) are
// enforced later in board-io, not encoded in this field.
export interface NodeBase {
  id: string;
  pos: XY;
  order: number;
  description?: string;
}

export interface StickyNode extends NodeBase {
  type: 'sticky';
  size: WH;
  text: string;
  color: StickyColor;
}

export interface TextNode extends NodeBase {
  type: 'text';
  text: string;
}

export interface ShapeNode extends NodeBase {
  type: 'shape';
  size: WH;
  shape: ShapeKind;
  text?: string;
  color: string;
  rotation?: number;
}

export interface FrameNode extends NodeBase {
  type: 'frame';
  size: WH;
  title: string;
  color: string;
}

// A single emoji rendered at the chosen pixel size. `text` is the emoji
// character itself (e.g. '🎉'). Kept as its own node type — rather than a
// flavour of TextNode — so the toolbar can offer an emoji picker and so
// resizing means "make the glyph bigger" rather than "wrap the text".
export interface EmojiNode extends NodeBase {
  type: 'emoji';
  text: string;
  size: number;
  rotation?: number;
}

// A glyph from the built-in icon registry (see src/lib/icons.ts). `name`
// references that registry; rendered as an inline SVG with the chosen color.
export interface IconNode extends NodeBase {
  type: 'icon';
  name: string;
  size: number;
  color: string;
  rotation?: number;
}

// A persisted freehand pencil stroke. `points` are stored relative to `pos`
// (the bounding-box origin) so dragging the node only updates `pos` — the
// stroke geometry doesn't have to be rewritten on every move. `size` is the
// bbox width/height, padded slightly so the SVG doesn't clip wide strokes.
export interface DrawingNode extends NodeBase {
  type: 'drawing';
  size: WH;
  points: XY[];
  color: string;
  strokeWidth: number;
}

export type BoardNode =
  StickyNode | TextNode | ShapeNode | FrameNode | EmojiNode | IconNode | DrawingNode;

export interface BoardEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  style: LineStyle;
  // kind defaults to 'arrow' when absent — existing board files stay valid.
  kind?: EdgeKind;
  // Meaningful when kind === 'arrow' (or absent).
  arrow?: ArrowStyle;
  // Meaningful when kind === 'cardinality'.
  cardinality?: Cardinality;
  // How the edge is drawn. Defaults to 'bezier' when absent.
  routing?: EdgeRouting;
}

export interface BoardFile {
  formatVersion: number;
  boardLabel: string;
  nodes: BoardNode[];
  edges: BoardEdge[];
  viewport: { x: number; y: number; zoom: number };
}
