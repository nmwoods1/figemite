// ── Breadcrumb (board hierarchy nav) ─────────────────────────────────────────
//
// Ported from the original prototype's `src/components/Breadcrumb.tsx`.
// Deviations:
//   - Dropped `pathDescriptions`/`onViewParentDescription` (the "≡ view this
//     node's description" affordance): that depends on canvas node state
//     which doesn't exist until Phase 3's BoardCanvas lands. Re-add that seam
//     when the canvas provides node descriptions instead of faking it now.
//   - `isDirty` is a plain typed prop, same as upstream — real dirty-tracking
//     arrives with the canvas in Phase 4; this component only renders the dot
//     when told to, it never computes dirtiness itself.
//   - `onDelete` is optional and the delete-sub-board button only renders
//     when both `path.length > 0` AND `onDelete` is provided, so callers can
//     hide the (dev-only / write) affordance in READONLY mode simply by not
//     passing a callback.
export interface BreadcrumbProps {
  boardLabel?: string;
  /** Sub-board path segment labels (parallel to path). */
  pathLabels?: string[];
  path: string[];
  onNavigate: (next: string[]) => void;
  onGoHome: () => void;
  onDelete?: () => void;
  isDirty: boolean;
}

const HOME_BTN: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#0f766e',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  padding: '4px 6px',
  borderRadius: 4,
};

const ROOT_BTN: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#475569',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '4px 6px',
  borderRadius: 4,
};

const SEG_BTN: React.CSSProperties = {
  ...ROOT_BTN,
  fontWeight: 500,
};

const CURRENT: React.CSSProperties = {
  ...SEG_BTN,
  color: '#1e293b',
  fontWeight: 700,
  cursor: 'default',
};

const SEPARATOR: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 12,
  margin: '0 2px',
  userSelect: 'none',
};

const DIRTY_DOT: React.CSSProperties = {
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: '#f59e0b',
  marginLeft: 6,
  verticalAlign: 'middle',
};

const DEL_BTN: React.CSSProperties = {
  marginLeft: 10,
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 500,
  color: '#dc2626',
  background: '#fff',
  border: '1px solid #fca5a5',
  borderRadius: 6,
  cursor: 'pointer',
};

export default function Breadcrumb({
  boardLabel,
  pathLabels = [],
  path,
  onNavigate,
  onGoHome,
  onDelete,
  isDirty,
}: BreadcrumbProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        padding: '6px 10px 6px 6px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        maxWidth: 'calc(100% - 24px)',
      }}
    >
      <button style={HOME_BTN} onClick={onGoHome} title="Back to all boards">
        ← Boards
      </button>

      <span style={SEPARATOR}>|</span>

      {path.length > 0 && (
        <button
          style={{
            ...ROOT_BTN,
            padding: '5px 8px',
            fontSize: 12,
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            background: '#fff',
          }}
          onClick={() => onNavigate(path.slice(0, -1))}
          title="Go up one level"
        >
          ← Back
        </button>
      )}

      <button
        style={path.length === 0 ? CURRENT : ROOT_BTN}
        onClick={() => path.length > 0 && onNavigate([])}
        disabled={path.length === 0}
      >
        {boardLabel || 'Board'}
      </button>

      {path.map((seg, i) => {
        const isLast = i === path.length - 1;
        const displayLabel = pathLabels[i] || seg;
        return (
          <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
            <span style={SEPARATOR}>›</span>
            <button
              style={isLast ? CURRENT : SEG_BTN}
              onClick={() => !isLast && onNavigate(path.slice(0, i + 1))}
              disabled={isLast}
              title={seg}
            >
              {displayLabel}
            </button>
          </span>
        );
      })}

      {isDirty && <span style={DIRTY_DOT} title="Unsaved edits" />}

      {path.length > 0 && onDelete && (
        <button style={DEL_BTN} onClick={onDelete} title="Delete this sub-board">
          Delete sub-board
        </button>
      )}
    </div>
  );
}
