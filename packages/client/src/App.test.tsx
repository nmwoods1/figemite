import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import App from './App.js';

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ boards: [] }),
      })) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the shell heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'easel' })).toBeInTheDocument();
  });

  it('renders the board count once the mocked fetch resolves', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('0 board(s)')).toBeInTheDocument());
  });
});
