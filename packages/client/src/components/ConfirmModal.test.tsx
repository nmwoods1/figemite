import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ConfirmModal from './ConfirmModal.js';

afterEach(cleanup);

describe('ConfirmModal', () => {
  it('renders title, body and confirm label', () => {
    render(
      <ConfirmModal
        title="Promote to live?"
        body="This overwrites the live board."
        confirmLabel="Promote to live"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Promote to live?')).toBeTruthy();
    expect(screen.getByText('This overwrites the live board.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Promote to live' })).toBeTruthy();
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal title="t" body="b" confirmLabel="Go" onConfirm={onConfirm} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel on Cancel click, backdrop click, and Escape', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmModal title="t" body="b" confirmLabel="Go" onConfirm={() => {}} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('shows a busy label and disables the confirm button when busy', () => {
    render(
      <ConfirmModal
        title="t"
        body="b"
        confirmLabel="Go"
        busy
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Working…' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
