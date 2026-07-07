// ── IdentityPrompt tests ──────────────────────────────────────────────────────
//
// A first-time modal capturing the local display name (used by presence — a
// later task — and already used by comments). Ported from the legacy
// original prototype's IdentityPrompt.tsx, rewired onto this codebase's
// `lib/identity.ts` (`setLocalUser`) instead of the legacy's
// `setStoredAuthor`. The "gate a returning user" half of the contract lives in
// `lib/identity.ts`'s `hasStoredUser` — this component itself just captures a
// name and reports it; callers decide whether to mount it at all.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import IdentityPrompt from './IdentityPrompt.js';
import { getLocalUser } from '../lib/identity.js';

describe('IdentityPrompt', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    onConfirm.mockReset();
    onCancel.mockReset();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('submitting a name persists it via setLocalUser and calls onConfirm with the trimmed name', () => {
    render(<IdentityPrompt onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.change(screen.getByPlaceholderText(/your name/i), {
      target: { value: '  Ada Lovelace  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(getLocalUser().name).toBe('Ada Lovelace');
    expect(onConfirm).toHaveBeenCalledWith('Ada Lovelace');
  });

  it('pressing Enter in the input submits the name', () => {
    render(<IdentityPrompt onConfirm={onConfirm} onCancel={onCancel} />);
    const input = screen.getByPlaceholderText(/your name/i);
    fireEvent.change(input, { target: { value: 'Grace Hopper' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith('Grace Hopper');
  });

  it('does not submit an empty/whitespace-only name', () => {
    render(<IdentityPrompt onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('the continue button is disabled while the name is empty', () => {
    render(<IdentityPrompt onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('clicking Cancel calls onCancel without persisting a name', () => {
    render(<IdentityPrompt onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.change(screen.getByPlaceholderText(/your name/i), { target: { value: 'Nope' } });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(getLocalUser().name).not.toBe('Nope');
  });

  it('pressing Escape calls onCancel', () => {
    render(<IdentityPrompt onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByPlaceholderText(/your name/i), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('clicking the backdrop calls onCancel', () => {
    const { container } = render(<IdentityPrompt onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(container.firstChild as Element);
    expect(onCancel).toHaveBeenCalled();
  });
});
