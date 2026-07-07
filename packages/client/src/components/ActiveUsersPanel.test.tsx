// ── ActiveUsersPanel tests ───────────────────────────────────────────────────
//
// P5-T30. A small floating panel listing who's online (self + remotes),
// colored dots/avatars + names, AI peers marked, and a Follow button per
// remote (Following…/Stop while active). Ported intent from the legacy
// figmalade prototype's `src/components/ActiveUsersPanel.tsx`, adapted to
// take plain `RemotePresence[]` (sourced from `hooks/usePresence.ts`) rather
// than a `BoardRoom` + its own awareness subscription — keeping this
// component pure render logic, matching PresenceLayer's split.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RemotePresence } from '../hooks/usePresence.js';
import { ActiveUsersPanel } from './ActiveUsersPanel.js';

afterEach(() => {
  cleanup();
});

const LOCAL_USER = { name: 'Ada', color: '#3b82f6' };

function remote(overrides: Partial<RemotePresence> = {}): RemotePresence {
  return {
    clientId: 2,
    user: { name: 'Grace', color: '#22c55e' },
    cursor: null,
    editingNodeId: null,
    viewport: null,
    isAI: false,
    ...overrides,
  };
}

describe('ActiveUsersPanel', () => {
  it('lists the local user', () => {
    render(
      <ActiveUsersPanel
        localUser={LOCAL_USER}
        remotes={[]}
        followClientId={null}
        onFollow={vi.fn()}
      />,
    );
    expect(screen.getByText(/^Ada/)).toBeInTheDocument();
  });

  it('lists remote users alongside the local user', () => {
    render(
      <ActiveUsersPanel
        localUser={LOCAL_USER}
        remotes={[remote({ user: { name: 'Grace', color: '#22c55e' } })]}
        followClientId={null}
        onFollow={vi.fn()}
      />,
    );
    expect(screen.getByText(/^Ada/)).toBeInTheDocument();
    expect(screen.getByText(/^Grace/)).toBeInTheDocument();
  });

  it('marks an AI peer distinctly', () => {
    render(
      <ActiveUsersPanel
        localUser={LOCAL_USER}
        remotes={[remote({ user: { name: 'agent-01', color: '#8b5cf6' }, isAI: true })]}
        followClientId={null}
        onFollow={vi.fn()}
      />,
    );
    expect(screen.getByText(/^agent-01/)).toBeInTheDocument();
    expect(screen.getByTestId('active-users-ai-badge-2')).toBeInTheDocument();
  });

  it('offers a Follow button for each remote user', () => {
    render(
      <ActiveUsersPanel
        localUser={LOCAL_USER}
        remotes={[remote()]}
        followClientId={null}
        onFollow={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /follow grace/i })).toBeInTheDocument();
  });

  it('does not offer a Follow button for the local user', () => {
    render(
      <ActiveUsersPanel
        localUser={LOCAL_USER}
        remotes={[]}
        followClientId={null}
        onFollow={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /follow ada/i })).not.toBeInTheDocument();
  });

  it('clicking Follow calls onFollow with the remote clientId', () => {
    const onFollow = vi.fn();
    render(
      <ActiveUsersPanel
        localUser={LOCAL_USER}
        remotes={[remote({ clientId: 7 })]}
        followClientId={null}
        onFollow={onFollow}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /follow grace/i }));
    expect(onFollow).toHaveBeenCalledWith(7);
  });

  it('shows a "Following…" state for the currently-followed remote', () => {
    render(
      <ActiveUsersPanel
        localUser={LOCAL_USER}
        remotes={[remote({ clientId: 7 })]}
        followClientId={7}
        onFollow={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('clicking Stop while following calls onFollow(null)', () => {
    const onFollow = vi.fn();
    render(
      <ActiveUsersPanel
        localUser={LOCAL_USER}
        remotes={[remote({ clientId: 7 })]}
        followClientId={7}
        onFollow={onFollow}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onFollow).toHaveBeenCalledWith(null);
  });

  it('a non-followed remote among multiple still offers its own Follow button while another is followed', () => {
    render(
      <ActiveUsersPanel
        localUser={LOCAL_USER}
        remotes={[
          remote({ clientId: 7, user: { name: 'Grace', color: '#22c55e' } }),
          remote({ clientId: 8, user: { name: 'Alan', color: '#ef4444' } }),
        ]}
        followClientId={7}
        onFollow={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /follow alan/i })).toBeInTheDocument();
  });
});
