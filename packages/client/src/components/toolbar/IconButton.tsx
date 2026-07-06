// ── IconButton ────────────────────────────────────────────────────────────────
//
// Ported from the legacy Toolbar.tsx's inline `IconButton`: an icon-only
// button with a hover tooltip, an optional dropdown caret, and an optional
// popover (`children`, rendered when `open`). Used for every toolbar action
// button so hover/active/disabled/tooltip behaviour lives in one place.
import { useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ICON_BTN, ICON_BTN_ACTIVE, TOOLTIP, CARET } from './styles.js';

const ICON_BTN_DISABLED: CSSProperties = {
  opacity: 0.4,
  cursor: 'not-allowed',
};

export interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  activeStyle?: CSSProperties;
  style?: CSSProperties;
  /** Adds a small "▾" to signal a dropdown/popover affordance. */
  caret?: boolean;
  /** Suppresses the hover tooltip while a picker popover is showing. */
  open?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  children?: ReactNode;
}

export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  activeStyle,
  style,
  caret,
  open,
  buttonRef,
  children,
}: IconButtonProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ position: 'relative', display: 'flex', flexShrink: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        style={{
          ...ICON_BTN,
          ...(active ? ICON_BTN_ACTIVE : {}),
          ...(active ? activeStyle : {}),
          ...(disabled ? ICON_BTN_DISABLED : {}),
          ...style,
        }}
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        title={label}
      >
        <Icon size={16} strokeWidth={1.75} />
        {caret && <span style={CARET}>▾</span>}
      </button>
      {children}
      {hovered && !disabled && !open && <span style={TOOLTIP}>{label}</span>}
    </div>
  );
}
