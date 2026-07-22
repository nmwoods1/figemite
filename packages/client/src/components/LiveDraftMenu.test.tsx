import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LiveDraftMenu from './LiveDraftMenu.js';

const api = vi.hoisted(() => ({
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
  promoteDraft: vi.fn(),
  discardDraft: vi.fn(),
  renameDraft: vi.fn(),
}));
vi.mock('../lib/boards-api.js', () => api);

beforeEach(() => {
  api.listDrafts.mockReset().mockResolvedValue([
    { id: 'd1', title: 'New card limits', createdBy: 'human', createdAt: '2026-07-21T00:00:00Z' },
  ]);
  api.createDraft.mockReset().mockResolvedValue('d2');
  api.promoteDraft.mockReset().mockResolvedValue(undefined);
  api.discardDraft.mockReset().mockResolvedValue(undefined);
  api.renameDraft.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('LiveDraftMenu', () => {
  it('shows "Live" when on the live board', () => {
    render(<LiveDraftMenu slug="spend" onOpenDraft={() => {}} onExitDraft={() => {}} />);
    expect(screen.getByRole('button', { name: /Live/ })).toBeTruthy();
  });

  it('shows the draft title when editing a draft', async () => {
    render(<LiveDraftMenu slug="spend" draftId="d1" onOpenDraft={() => {}} onExitDraft={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /New card limits/ })).toBeTruthy(),
    );
  });

  it('lists drafts and creates a new one', async () => {
    const onOpenDraft = vi.fn();
    render(<LiveDraftMenu slug="spend" onOpenDraft={onOpenDraft} onExitDraft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    await waitFor(() => expect(screen.getByText('New card limits')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /New draft/ }));
    await waitFor(() => expect(onOpenDraft).toHaveBeenCalledWith('d2'));
  });

  it('clicking a draft row opens it', async () => {
    const onOpenDraft = vi.fn();
    render(<LiveDraftMenu slug="spend" onOpenDraft={onOpenDraft} onExitDraft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    await waitFor(() => expect(screen.getByText('New card limits')).toBeTruthy());
    fireEvent.click(screen.getByText('New card limits'));
    expect(onOpenDraft).toHaveBeenCalledWith('d1');
  });

  it('promote asks for confirmation then calls promoteDraft, keeping the draft by default', async () => {
    render(<LiveDraftMenu slug="spend" onOpenDraft={() => {}} onExitDraft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    await waitFor(() => expect(screen.getByText('New card limits')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Promote draft New card limits to live' }));
    // The "delete after promotion" checkbox is present and unchecked by default.
    const checkbox = screen.getByRole('checkbox', { name: /delete this draft after promotion/i });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Promote to live' }));
    // deleteDraft defaults to false (draft kept).
    await waitFor(() => expect(api.promoteDraft).toHaveBeenCalledWith('spend', 'd1', false));
  });

  it('promote deletes the draft when the "delete after promotion" checkbox is checked', async () => {
    render(<LiveDraftMenu slug="spend" onOpenDraft={() => {}} onExitDraft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    await waitFor(() => expect(screen.getByText('New card limits')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Promote draft New card limits to live' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /delete this draft after promotion/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Promote to live' }));
    await waitFor(() => expect(api.promoteDraft).toHaveBeenCalledWith('spend', 'd1', true));
  });

  it('does not double-submit promote when the confirm button is clicked twice', async () => {
    let resolvePromote: () => void = () => {};
    api.promoteDraft.mockReset().mockReturnValue(
      new Promise<void>((r) => {
        resolvePromote = r;
      }),
    );
    render(<LiveDraftMenu slug="spend" onOpenDraft={() => {}} onExitDraft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    await waitFor(() => expect(screen.getByText('New card limits')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Promote draft New card limits to live' }));

    const confirm = screen.getByRole('button', { name: 'Promote to live' });
    fireEvent.click(confirm);
    fireEvent.click(confirm); // second click while the first is still in flight
    resolvePromote();

    await waitFor(() => expect(api.promoteDraft).toHaveBeenCalledTimes(1));
  });

  it('discard asks for confirmation then calls discardDraft', async () => {
    render(<LiveDraftMenu slug="spend" onOpenDraft={() => {}} onExitDraft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    await waitFor(() => expect(screen.getByText('New card limits')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft New card limits' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(api.discardDraft).toHaveBeenCalledWith('spend', 'd1'));
  });

  it('renames a draft via the edit icon (Enter commits)', async () => {
    render(<LiveDraftMenu slug="spend" onOpenDraft={() => {}} onExitDraft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    await waitFor(() => expect(screen.getByText('New card limits')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Rename draft New card limits' }));
    const input = screen.getByRole('textbox', { name: 'Rename draft New card limits' });
    fireEvent.change(input, { target: { value: 'Tighter limits' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(api.renameDraft).toHaveBeenCalledWith('spend', 'd1', 'Tighter limits'),
    );
  });

  it('Escape cancels a rename without calling renameDraft', async () => {
    render(<LiveDraftMenu slug="spend" onOpenDraft={() => {}} onExitDraft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    await waitFor(() => expect(screen.getByText('New card limits')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Rename draft New card limits' }));
    const input = screen.getByRole('textbox', { name: 'Rename draft New card limits' });
    fireEvent.change(input, { target: { value: 'Discarded edit' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    // Back to the label; no API call.
    expect(screen.getByText('New card limits')).toBeTruthy();
    expect(api.renameDraft).not.toHaveBeenCalled();
  });

  it('clicking the Live row while in a draft exits to live', async () => {
    const onExitDraft = vi.fn();
    render(
      <LiveDraftMenu slug="spend" draftId="d1" onOpenDraft={() => {}} onExitDraft={onExitDraft} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /New card limits/ }));
    fireEvent.click(screen.getByRole('button', { name: /Switch to Live/ }));
    expect(onExitDraft).toHaveBeenCalledOnce();
  });
});
