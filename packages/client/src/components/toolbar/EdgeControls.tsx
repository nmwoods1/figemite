// ── EdgeControls ──────────────────────────────────────────────────────────────
//
// Ported from the legacy Toolbar.tsx's `EdgeKindToggle` + arrow `<select>` +
// `LineStyleToggle`. Shown only when the current selection is edge-only
// (Toolbar.tsx gates rendering this whole group); each control commits
// through the P4-T24 edge-style store methods for every selected edge.
import type { ArrowStyle, Cardinality, EdgeKind, LineStyle } from '@figemite/shared';
import { LINE_BTN_BASE, SELECT } from './styles.js';

const ARROW_OPTIONS: { value: ArrowStyle; label: string }[] = [
  { value: 'none', label: 'No arrows' },
  { value: 'end', label: '→ Forward' },
  { value: 'start', label: '← Back' },
  { value: 'both', label: '↔ Both' },
];

const CARDINALITY_OPTIONS: Cardinality[] = ['1:1', '1:N', 'N:1', 'N:N'];

export function EdgeKindToggle({
  value,
  onChange,
}: {
  value: EdgeKind | null;
  onChange: (next: EdgeKind) => void;
}) {
  const arrowActive = value === 'arrow' || value === null;
  const cardActive = value === 'cardinality';
  return (
    <div
      role="group"
      aria-label="Edge kind"
      style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden' }}
    >
      <button
        type="button"
        onClick={() => onChange('arrow')}
        title="Arrow edge"
        aria-pressed={arrowActive}
        style={{
          ...LINE_BTN_BASE,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          borderTopLeftRadius: 6,
          borderBottomLeftRadius: 6,
          background: arrowActive ? '#e0e7ff' : '#fff',
          borderColor: arrowActive ? '#6366f1' : '#cbd5e1',
          zIndex: arrowActive ? 1 : 0,
          padding: '0 8px',
          fontSize: 11,
          fontWeight: 600,
          width: 'auto',
        }}
      >
        →
      </button>
      <button
        type="button"
        onClick={() => onChange('cardinality')}
        title="Cardinality edge (1/N labels)"
        aria-pressed={cardActive}
        style={{
          ...LINE_BTN_BASE,
          marginLeft: -1,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderTopRightRadius: 6,
          borderBottomRightRadius: 6,
          background: cardActive ? '#e0e7ff' : '#fff',
          borderColor: cardActive ? '#6366f1' : '#cbd5e1',
          zIndex: cardActive ? 1 : 0,
          padding: '0 6px',
          fontSize: 9,
          fontWeight: 700,
          width: 'auto',
        }}
      >
        1:N
      </button>
    </div>
  );
}

export function ArrowSelect({
  value,
  onChange,
}: {
  value: ArrowStyle | null;
  onChange: (next: ArrowStyle) => void;
}) {
  return (
    <select
      style={SELECT}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value as ArrowStyle)}
      title="Arrow direction"
    >
      {!value && <option value="">Arrows</option>}
      {ARROW_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function CardinalitySelect({
  value,
  onChange,
}: {
  value: Cardinality | null;
  onChange: (next: Cardinality) => void;
}) {
  return (
    <select
      style={SELECT}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value as Cardinality)}
      title="Cardinality"
    >
      {!value && <option value="">Cardinality</option>}
      {CARDINALITY_OPTIONS.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function LineSwatch({ dashed }: { dashed: boolean }) {
  return (
    <svg width={20} height={10} viewBox="0 0 20 10" aria-hidden>
      <line
        x1={1}
        y1={5}
        x2={19}
        y2={5}
        stroke="#1e293b"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeDasharray={dashed ? '3 2.5' : undefined}
      />
    </svg>
  );
}

export function LineStyleToggle({
  value,
  onChange,
}: {
  value: LineStyle | null;
  onChange: (next: LineStyle) => void;
}) {
  const solidActive = value === 'solid';
  const dashedActive = value === 'dashed';
  return (
    <div
      role="group"
      aria-label="Line style"
      style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden' }}
    >
      <button
        type="button"
        onClick={() => onChange('solid')}
        title="Solid line"
        aria-pressed={solidActive}
        style={{
          ...LINE_BTN_BASE,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          borderTopLeftRadius: 6,
          borderBottomLeftRadius: 6,
          background: solidActive ? '#e0e7ff' : '#fff',
          borderColor: solidActive ? '#6366f1' : '#cbd5e1',
          zIndex: solidActive ? 1 : 0,
        }}
      >
        <LineSwatch dashed={false} />
      </button>
      <button
        type="button"
        onClick={() => onChange('dashed')}
        title="Dashed line"
        aria-pressed={dashedActive}
        style={{
          ...LINE_BTN_BASE,
          marginLeft: -1,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderTopRightRadius: 6,
          borderBottomRightRadius: 6,
          background: dashedActive ? '#e0e7ff' : '#fff',
          borderColor: dashedActive ? '#6366f1' : '#cbd5e1',
          zIndex: dashedActive ? 1 : 0,
        }}
      >
        <LineSwatch dashed={true} />
      </button>
    </div>
  );
}
