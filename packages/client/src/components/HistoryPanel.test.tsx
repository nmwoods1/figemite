// ── HistoryPanel tests ────────────────────────────────────────────────────────
//
// Pure-render panel: `hooks/useHistory.ts` owns the fetch + preview/restore/
// discard state machine, this component just renders `versions`/`loading` and
// calls `onSelect(id)`/`onClose`. AI-boundary snapshots ('preai'/'ai') must
// read distinctly from a plain 'save' snapshot (both a chip AND a sub-label).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { HistoryVersion } from '../lib/boards-api.js';
import { HistoryPanel } from './HistoryPanel.js';

afterEach(() => {
  cleanup();
});

const VERSIONS: HistoryVersion[] = [
  { id: 'v3', timestamp: '2026-07-06T10:00:00.000Z', trigger: 'save' },
  { id: 'v2', timestamp: '2026-07-06T09:00:00.000Z', trigger: 'ai' },
  { id: 'v1', timestamp: '2026-07-06T08:00:00.000Z', trigger: 'preai' },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof HistoryPanel>> = {}) {
  const onSelect = overrides.onSelect ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const utils = render(
    <HistoryPanel
      versions={overrides.versions ?? VERSIONS}
      loading={overrides.loading ?? false}
      error={overrides.error ?? null}
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
  return { ...utils, onSelect, onClose };
}

describe('HistoryPanel', () => {
  it('renders the snapshot list (one row per version)', () => {
    renderPanel();
    // 3 version rows + no other buttons besides the close (×) button.
    const rows = screen.getAllByRole('button').filter((b) => b.title !== 'Close');
    expect(rows).toHaveLength(3);
  });

  it('shows a "Latest" marker on the first (newest) entry only', () => {
    renderPanel();
    expect(screen.getByText(/Latest —/)).toBeInTheDocument();
  });

  it('labels a plain save snapshot as "Human" with no AI sub-label', () => {
    renderPanel({ versions: [VERSIONS[0]] });
    expect(screen.getByText('Human')).toBeInTheDocument();
    expect(screen.queryByText(/Before AI changes/)).not.toBeInTheDocument();
    expect(screen.queryByText(/After AI changes/)).not.toBeInTheDocument();
  });

  it('labels an "ai" trigger snapshot distinctly ("AI" chip + "After AI changes")', () => {
    renderPanel({ versions: [VERSIONS[1]] });
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('After AI changes')).toBeInTheDocument();
  });

  it('labels a "preai" trigger snapshot distinctly ("AI" chip + "Before AI changes")', () => {
    renderPanel({ versions: [VERSIONS[2]] });
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('Before AI changes')).toBeInTheDocument();
  });

  it('clicking a version row calls onSelect with that version id', () => {
    const { onSelect } = renderPanel();
    const rows = screen.getAllByRole('button').filter((b) => b.title !== 'Close');
    fireEvent.click(rows[1]); // the 'ai' (v2) row
    expect(onSelect).toHaveBeenCalledWith('v2');
  });

  it('shows a loading state and no rows while loading', () => {
    renderPanel({ loading: true, versions: [] });
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
    expect(screen.queryAllByRole('button').filter((b) => b.title !== 'Close')).toHaveLength(0);
  });

  it('shows an empty state when there is no history yet', () => {
    renderPanel({ versions: [] });
    expect(screen.getByText(/No history yet/)).toBeInTheDocument();
  });

  it('shows an error message when given one', () => {
    renderPanel({ error: 'boom', versions: [] });
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('clicking the close (×) button calls onClose', () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByTitle('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking outside the panel calls onClose', () => {
    const { onClose } = renderPanel();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking inside the panel does not call onClose', () => {
    const { onClose } = renderPanel();
    fireEvent.mouseDown(screen.getByText('Version history'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
