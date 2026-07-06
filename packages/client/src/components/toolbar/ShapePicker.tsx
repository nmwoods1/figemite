// ── ShapePicker ───────────────────────────────────────────────────────────────
//
// Ported from the legacy Toolbar.tsx's shape popover + `ShapePreview`: a
// 4-column grid of the 12 `SHAPE_KINDS`, each with a small SVG preview drawn
// to match figmalade's exact preview art.
import { SHAPE_KINDS } from '@easel/shared';
import type { ShapeKind } from '@easel/shared';
import { POPOVER } from './styles.js';

const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  roundRect: 'Rounded',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  triangle: 'Triangle',
  parallelogram: 'Parallelogram',
  hexagon: 'Hexagon',
  pentagon: 'Pentagon',
  star: 'Star',
  cylinder: 'Cylinder',
  cloud: 'Cloud',
  arrow: 'Arrow',
};

export function ShapePicker({ onPick }: { onPick: (kind: ShapeKind) => void }) {
  return (
    <div
      style={{
        ...POPOVER,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 56px)',
        gap: 6,
        width: 'auto',
      }}
    >
      {SHAPE_KINDS.map((kind) => (
        <button
          key={kind}
          title={SHAPE_LABELS[kind]}
          onClick={() => onPick(kind)}
          style={{
            width: 56,
            height: 48,
            padding: 0,
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            background: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ShapePreview kind={kind} />
        </button>
      ))}
    </div>
  );
}

function ShapePreview({ kind }: { kind: ShapeKind }) {
  const W = 36;
  const H = 24;
  const stroke = '#475569';
  const fill = '#f1f5f9';
  const sw = 1.5;

  // Plain function (not a component) called directly below — declaring it as
  // a component (`const Inner = () => ...` rendered via `<Inner />`) would
  // recreate that component's identity every render (react-hooks/
  // static-components), resetting any state it held. It holds no state, but
  // calling it as a value-returning function sidesteps the lint rule
  // entirely and is simpler besides.
  function renderShape() {
    if (kind === 'rect')
      return (
        <rect
          x={1}
          y={1}
          width={W - 2}
          height={H - 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    if (kind === 'roundRect')
      return (
        <rect
          x={1}
          y={1}
          width={W - 2}
          height={H - 2}
          rx={4}
          ry={4}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    if (kind === 'ellipse')
      return (
        <ellipse
          cx={W / 2}
          cy={H / 2}
          rx={W / 2 - 1}
          ry={H / 2 - 1}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    if (kind === 'diamond')
      return (
        <polygon
          points={`${W / 2},1 ${W - 1},${H / 2} ${W / 2},${H - 1} 1,${H / 2}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    if (kind === 'triangle')
      return (
        <polygon
          points={`${W / 2},1 ${W - 1},${H - 1} 1,${H - 1}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    if (kind === 'parallelogram')
      return (
        <polygon
          points={`6,1 ${W - 1},1 ${W - 6},${H - 1} 1,${H - 1}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    if (kind === 'hexagon')
      return (
        <polygon
          points={`8,1 ${W - 8},1 ${W - 1},${H / 2} ${W - 8},${H - 1} 8,${H - 1} 1,${H / 2}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    if (kind === 'pentagon')
      return (
        <polygon
          points={`${W / 2},1 ${W - 1},10 ${W * 0.82},${H - 1} ${W * 0.18},${H - 1} 1,10`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    if (kind === 'star') {
      const cx = W / 2;
      const cy = H / 2;
      const rO = Math.min(W, H) / 2 - 1;
      const rI = rO * 0.45;
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? rO : rI;
        pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
      }
      return <polygon points={pts.join(' ')} fill={fill} stroke={stroke} strokeWidth={sw} />;
    }
    if (kind === 'cylinder') {
      const ry = 3;
      const rx = (W - 2) / 2;
      const top = ry + 1;
      const bottom = H - ry - 1;
      return (
        <>
          <path
            d={`M 1,${top} L 1,${bottom} A ${rx} ${ry} 0 0 0 ${W - 1} ${bottom} L ${W - 1},${top} A ${rx} ${ry} 0 0 0 1 ${top} Z`}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
          <path
            d={`M 1,${top} A ${rx} ${ry} 0 0 0 ${W - 1} ${top}`}
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
          />
        </>
      );
    }
    if (kind === 'cloud') {
      return (
        <path
          d={`M 6,${H - 3} A 5 5 0 0 1 6,${H * 0.55} A 6 6 0 0 1 14,4 A 5 5 0 0 1 24,4 A 6 6 0 0 1 30,${H * 0.5} A 4 4 0 0 1 28,${H - 3} Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    }
    if (kind === 'arrow') {
      const tipW = 8;
      const sy = H * 0.3;
      const syB = H * 0.7;
      const headX = W - tipW;
      return (
        <polygon
          points={`1,${sy} ${headX},${sy} ${headX},1 ${W - 1},${H / 2} ${headX},${H - 1} ${headX},${syB} 1,${syB}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    }
    return null;
  }

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {renderShape()}
    </svg>
  );
}
