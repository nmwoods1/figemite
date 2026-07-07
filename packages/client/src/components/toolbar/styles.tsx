// ── Shared Toolbar visual constants ──────────────────────────────────────────
//
// Ported verbatim (colors/sizes) from the original prototype's
// Toolbar.tsx so the new toolbar matches its visual design. Split into its
// own module so Toolbar.tsx and its picker sub-components (ShapePicker,
// EmojiPicker, IconPicker, EdgeControls) share one source of truth instead of
// duplicating these `CSSProperties` objects.
import type { CSSProperties } from 'react';

export const BTN: CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 500,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: '#fff',
  color: '#1e293b',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const ICON_BTN: CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: '#fff',
  color: '#1e293b',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const ICON_BTN_ACTIVE: CSSProperties = {
  background: '#1e293b',
  color: '#fff',
  borderColor: '#1e293b',
};

export const TOOLTIP: CSSProperties = {
  position: 'absolute',
  bottom: '135%',
  left: '50%',
  transform: 'translateX(-50%)',
  background: '#1e293b',
  color: '#fff',
  fontSize: 11,
  fontWeight: 500,
  padding: '4px 8px',
  borderRadius: 4,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  zIndex: 30,
  boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
  lineHeight: 1.3,
};

export const CARET: CSSProperties = {
  fontSize: 9,
  opacity: 0.6,
  marginLeft: 1,
};

export const SELECT: CSSProperties = {
  padding: '5px 8px',
  fontSize: 12,
  fontWeight: 500,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: '#fff',
  color: '#1e293b',
  cursor: 'pointer',
  outline: 'none',
  appearance: 'auto',
};

export const POPOVER: CSSProperties = {
  position: 'absolute',
  bottom: '110%',
  left: 0,
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  zIndex: 20,
};

export const LINE_BTN_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 26,
  padding: 0,
  background: '#fff',
  border: '1px solid #cbd5e1',
  cursor: 'pointer',
};

export function Divider() {
  return <div style={{ width: 1, height: 20, background: '#e2e8f0', flexShrink: 0 }} />;
}
