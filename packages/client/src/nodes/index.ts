// ── The ReactFlow node-type registry ─────────────────────────────────────────
//
// BoardCanvas (P3-T20) passes this map to `<ReactFlow nodeTypes={nodeTypes} />`.
// Keyed by each `BoardNode['type']` discriminant (@easel/shared) — matching
// `rf-adapters.ts`'s `boardNodeToRf`, which sets each RF node's `type` to the
// board node's own `type` string (not a `<type>Node` suffix convention).

import type { NodeTypes } from '@xyflow/react';
import { StickyNode } from './StickyNode.js';
import { TextNode } from './TextNode.js';
import { ShapeNode } from './ShapeNode.js';
import { FrameNode } from './FrameNode.js';
import { EmojiNode } from './EmojiNode.js';
import { IconNode } from './IconNode.js';
import { DrawingNode } from './DrawingNode.js';

export const nodeTypes: NodeTypes = {
  sticky: StickyNode,
  text: TextNode,
  shape: ShapeNode,
  frame: FrameNode,
  emoji: EmojiNode,
  icon: IconNode,
  drawing: DrawingNode,
};

export { StickyNode } from './StickyNode.js';
export type { StickyNodeData } from './StickyNode.js';
export { TextNode } from './TextNode.js';
export type { TextNodeData } from './TextNode.js';
export { ShapeNode } from './ShapeNode.js';
export type { ShapeNodeData } from './ShapeNode.js';
export { FrameNode } from './FrameNode.js';
export type { FrameNodeData } from './FrameNode.js';
export { EmojiNode } from './EmojiNode.js';
export type { EmojiNodeData } from './EmojiNode.js';
export { IconNode, IconGlyph } from './IconNode.js';
export type { IconNodeData } from './IconNode.js';
export { DrawingNode } from './DrawingNode.js';
export type { DrawingNodeData } from './DrawingNode.js';

export { BaseNode } from './BaseNode.js';
export type { BaseNodeProps } from './BaseNode.js';
export { ConnectionHandles } from './ConnectionHandles.js';
export type { ConnectionHandlesProps, HandleAnchor, HandleAnchors } from './ConnectionHandles.js';
export { DescriptionBadge } from './DescriptionBadge.js';
export type { DescriptionBadgeProps } from './DescriptionBadge.js';
export { useEditableText } from './useEditableText.js';
export type { EditableText } from './useEditableText.js';
export { hexToRgba } from './color.js';
