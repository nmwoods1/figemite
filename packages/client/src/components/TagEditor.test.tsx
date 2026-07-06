import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import TagEditor from './TagEditor.js';

const boardsApiMock = vi.hoisted(() => ({
  saveTags: vi.fn(),
}));
vi.mock('../lib/boards-api.js', () => boardsApiMock);

function anchorRef() {
  const ref = createRef<HTMLElement>();
  const el = document.createElement('button');
  document.body.appendChild(el);
  (ref as React.MutableRefObject<HTMLElement | null>).current = el;
  return ref;
}

describe('TagEditor', () => {
  const onSaved = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    boardsApiMock.saveTags.mockReset().mockResolvedValue(undefined);
    onSaved.mockReset();
    onClose.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders existing tags as chips', () => {
    render(
      <TagEditor
        slug="spend"
        currentTags={['roadmap', 'q3']}
        allKnownTags={['roadmap', 'q3', 'other']}
        anchorRef={anchorRef()}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('roadmap')).toBeInTheDocument();
    expect(screen.getByText('q3')).toBeInTheDocument();
  });

  it('adding a tag and saving calls saveTags with the normalized tag list', async () => {
    render(
      <TagEditor
        slug="spend"
        currentTags={['roadmap']}
        allKnownTags={['roadmap']}
        anchorRef={anchorRef()}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/add tag/i), { target: { value: 'Q3 ' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/add tag/i), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await vi.waitFor(() =>
      expect(boardsApiMock.saveTags).toHaveBeenCalledWith('spend', ['roadmap', 'q3']),
    );
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(['roadmap', 'q3']));
  });

  it('removing a tag chip and saving omits it from the saved list', async () => {
    render(
      <TagEditor
        slug="spend"
        currentTags={['roadmap', 'q3']}
        allKnownTags={['roadmap', 'q3']}
        anchorRef={anchorRef()}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /remove roadmap/i }));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await vi.waitFor(() => expect(boardsApiMock.saveTags).toHaveBeenCalledWith('spend', ['q3']));
  });

  it('clicking cancel closes without saving', () => {
    render(
      <TagEditor
        slug="spend"
        currentTags={['roadmap']}
        allKnownTags={['roadmap']}
        anchorRef={anchorRef()}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(boardsApiMock.saveTags).not.toHaveBeenCalled();
  });
});
