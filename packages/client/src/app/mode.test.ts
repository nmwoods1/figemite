import { afterEach, describe, expect, it, vi } from 'vitest';

// `READONLY` is derived from `import.meta.env.VITE_READONLY` at module load
// time, so each test that needs a different env value must reset the module
// registry and re-import — a plain re-assignment wouldn't re-run the
// top-level `const READONLY = ...` line.
describe('READONLY', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is true when VITE_READONLY is "1"', async () => {
    vi.stubEnv('VITE_READONLY', '1');
    const { READONLY } = await import('./mode.js');
    expect(READONLY).toBe(true);
  });

  it('is false when VITE_READONLY is unset', async () => {
    vi.stubEnv('VITE_READONLY', '');
    const { READONLY } = await import('./mode.js');
    expect(READONLY).toBe(false);
  });

  it('is false when VITE_READONLY is some other value', async () => {
    vi.stubEnv('VITE_READONLY', 'true');
    const { READONLY } = await import('./mode.js');
    expect(READONLY).toBe(false);
  });
});
