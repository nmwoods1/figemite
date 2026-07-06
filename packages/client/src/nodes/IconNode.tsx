// ── IconNode ──────────────────────────────────────────────────────────────────
//
// Ported from figmalade's IconNode.tsx: a glyph from the icon registry
// (lib/icons.js) rendered at the chosen size + color. No editable text
// (icons have no text to edit) — `editable` (which gates connection handles
// and hover-reveal on the description badge) is derived from
// `data.onOpenDescription` being present, the only write-capable callback
// IconNode data carries. Resize/rotate interaction HANDLERS are Phase 4;
// `data.rotation` is applied as a static CSS transform via BaseNode only.
//
// `IconGlyph` is exported standalone (as in the legacy) so a future icon
// picker (Toolbar, not in this task's scope) can render the same glyph
// preview without duplicating the registry-lookup + SVG markup.

import type { NodeProps, Node } from '@xyflow/react';
import { getIcon } from '../lib/icons.js';
import { ConnectionHandles } from './ConnectionHandles.js';
import { BaseNode } from './BaseNode.js';

export interface IconNodeData extends Record<string, unknown> {
  name: string;
  color: string;
  size: number;
  description?: string;
  rotation?: number;
  onOpenDescription?: (id: string) => void;
}

export function IconGlyph({ name, size, color }: { name: string; size: number; color: string }) {
  const def = getIcon(name);
  if (!def) {
    return (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: Math.min(size * 0.4, 24),
          color: '#94a3b8',
          border: '1px dashed #cbd5e1',
          borderRadius: 4,
        }}
      >
        ?
      </div>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
      aria-label={name}
    >
      {def.paths?.map((d, i) => (
        <path key={`p${i}`} d={d} />
      ))}
      {def.circles?.map((c, i) => (
        <circle key={`c${i}`} cx={c.cx} cy={c.cy} r={c.r} />
      ))}
      {def.lines?.map((l, i) => (
        <line key={`l${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      ))}
    </svg>
  );
}

export function IconNode({ id, data, selected }: NodeProps<Node<IconNodeData, 'icon'>>) {
  const editable = !!data.onOpenDescription;

  return (
    <BaseNode
      nodeId={id}
      selected={selected}
      rotation={data.rotation}
      description={data.description}
      onOpenDescription={data.onOpenDescription}
      descriptionBadgeStyle={{ top: 2, right: 2 }}
    >
      <ConnectionHandles interactive={editable} />
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: selected ? 'rgba(37,99,235,0.06)' : 'transparent',
          border: selected ? '1px dashed #2563eb' : '1px dashed transparent',
          borderRadius: 6,
          cursor: 'default',
          position: 'relative',
        }}
      >
        <IconGlyph name={data.name} size={data.size} color={data.color} />
      </div>
    </BaseNode>
  );
}
