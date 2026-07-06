import { describe, expect, it, vi } from 'vitest';
import { MdnsService, type BonjourLike } from './mdns.js';

/** A fake Bonjour instance recording publish/unpublishAll/destroy calls. */
function fakeBonjour(): BonjourLike & {
  publish: ReturnType<typeof vi.fn>;
  unpublishAll: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} {
  return {
    publish: vi.fn(() => ({ name: 'fake-service' })),
    unpublishAll: vi.fn((callback?: () => void) => callback?.()),
    destroy: vi.fn((callback?: () => void) => callback?.()),
  };
}

describe('MdnsService default-off behaviour', () => {
  it('does not construct a Bonjour instance when disabled (the default)', () => {
    const makeBonjour = vi.fn(fakeBonjour);
    const service = new MdnsService({
      port: 5400,
      getBoards: () => [],
      makeBonjour,
    });

    service.start();

    expect(makeBonjour).not.toHaveBeenCalled();
  });

  it('publishes nothing when start() is called while disabled', () => {
    const bonjour = fakeBonjour();
    const makeBonjour = vi.fn(() => bonjour);
    const service = new MdnsService({
      port: 5400,
      getBoards: () => ['spend'],
      makeBonjour,
    });

    service.start();

    expect(bonjour.publish).not.toHaveBeenCalled();
  });

  it('is a no-op even when enabled: false is passed explicitly', () => {
    const makeBonjour = vi.fn(fakeBonjour);
    const service = new MdnsService({
      enabled: false,
      port: 5400,
      getBoards: () => [],
      makeBonjour,
    });

    service.start();

    expect(makeBonjour).not.toHaveBeenCalled();
  });
});

describe('MdnsService enabled behaviour', () => {
  it('publishes exactly one service with type easel, the given port, and a TXT record', () => {
    const bonjour = fakeBonjour();
    const makeBonjour = vi.fn(() => bonjour);
    const service = new MdnsService({
      enabled: true,
      port: 5400,
      name: 'my-host',
      getBoards: () => ['spend', 'planning'],
      makeBonjour,
    });

    service.start();

    expect(bonjour.publish).toHaveBeenCalledTimes(1);
    const config = bonjour.publish.mock.calls[0][0];
    expect(config.type).toBe('easel');
    expect(config.port).toBe(5400);
    expect(config.txt).toEqual({ name: 'my-host', boards: 'spend,planning' });
  });

  it('defaults the TXT name to os.hostname() when no name is supplied', () => {
    const bonjour = fakeBonjour();
    const makeBonjour = vi.fn(() => bonjour);
    const service = new MdnsService({
      enabled: true,
      port: 5400,
      getBoards: () => [],
      makeBonjour,
    });

    service.start();

    const config = bonjour.publish.mock.calls[0][0];
    expect(typeof config.txt.name).toBe('string');
    expect(config.txt.name.length).toBeGreaterThan(0);
  });

  it('reads getBoards() at publish time, not at construction time', () => {
    const bonjour = fakeBonjour();
    const makeBonjour = vi.fn(() => bonjour);
    let boards = ['a'];
    const service = new MdnsService({
      enabled: true,
      port: 5400,
      getBoards: () => boards,
      makeBonjour,
    });

    boards = ['a', 'b', 'c'];
    service.start();

    const config = bonjour.publish.mock.calls[0][0];
    expect(config.txt.boards).toBe('a,b,c');
  });

  it('constructs the injected Bonjour instance lazily via makeBonjour when enabled', () => {
    const makeBonjour = vi.fn(fakeBonjour);
    const service = new MdnsService({
      enabled: true,
      port: 5400,
      getBoards: () => [],
      makeBonjour,
    });

    expect(makeBonjour).not.toHaveBeenCalled();
    service.start();
    expect(makeBonjour).toHaveBeenCalledTimes(1);
  });
});

describe('MdnsService.dispose', () => {
  it('unpublishes and destroys the Bonjour instance after start()', () => {
    const bonjour = fakeBonjour();
    const makeBonjour = vi.fn(() => bonjour);
    const service = new MdnsService({
      enabled: true,
      port: 5400,
      getBoards: () => [],
      makeBonjour,
    });

    service.start();
    service.dispose();

    expect(bonjour.unpublishAll).toHaveBeenCalledTimes(1);
    expect(bonjour.destroy).toHaveBeenCalledTimes(1);
  });

  it('is safe to call before start() (never-started service)', () => {
    const makeBonjour = vi.fn(fakeBonjour);
    const service = new MdnsService({
      enabled: true,
      port: 5400,
      getBoards: () => [],
      makeBonjour,
    });

    expect(() => service.dispose()).not.toThrow();
    expect(makeBonjour).not.toHaveBeenCalled();
  });

  it('is safe to call when disabled and never started', () => {
    const makeBonjour = vi.fn(fakeBonjour);
    const service = new MdnsService({
      port: 5400,
      getBoards: () => [],
      makeBonjour,
    });

    service.start();
    expect(() => service.dispose()).not.toThrow();
    expect(makeBonjour).not.toHaveBeenCalled();
  });
});
