// Ported from the legacy figmalade prototype's inline `descNodeLabel`
// computation (src/components/BoardCanvas.tsx): a human-readable label for a
// node, used by the DescriptionModal's header. Prefers the node's own
// text/title where it has one, falling back to its id (matches the legacy's
// exact fallback chain).
import type { BoardNode } from '@easel/shared';

export function nodeLabel(node: BoardNode | undefined): string {
  if (!node) return '';
  switch (node.type) {
    case 'sticky':
    case 'text':
      return node.text;
    case 'shape':
      return node.text ?? node.id;
    case 'frame':
      return node.title;
    default:
      return node.id;
  }
}
