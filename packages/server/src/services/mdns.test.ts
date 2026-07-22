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

/** Baseline identity fields every construction needs now that they're required. */
const IDENTITY = { id: 'inst-1', version: '1.2.3' };

describe('MdnsService default-off behaviour', () => {
  it('does not construct a Bonjour instance when disabled (the default)', () => {
    const makeBonjour = vi.fn(fakeBonjour);
    const service = new MdnsService({
      ...IDENTITY,
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
      ...IDENTITY,
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
      ...IDENTITY,
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
  it('publishes one service with type figemite and a full identity TXT record', () => {
    const bonjour = fakeBonjour();
    const makeBonjour = vi.fn(() => bonjour);
    const service = new MdnsService({
      ...IDENTITY,
      enabled: true,
      port: 5400,
      name: 'my-host',
      getBoards: () => ['spend', 'planning'],
      makeBonjour,
    });

    service.start({ port: 5400, url: 'http://192.168.1.5:5400' });

    expect(bonjour.publish).toHaveBeenCalledTimes(1);
    const config = bonjour.publish.mock.calls[0][0];
    expect(config.type).toBe('figemite');
    expect(config.port).toBe(5400);
    expect(config.txt).toEqual({
      id: 'inst-1',
      name: 'my-host',
      url: 'http://192.168.1.5:5400',
      version: '1.2.3',
      boards: 'spend,planning',
    });
  });

  it('advertises the port supplied to start(), overriding the constructed fallback', () => {
    const bonjour = fakeBonjour();
    const makeBonjour = vi.fn(() => bonjour);
    const service = new MdnsService({
      ...IDENTITY,
      enabled: true,
      port: 0, // ephemeral fallback — real port only known after listen()
      getBoards: () => [],
      makeBonjour,
    });

    service.start({ port: 41234, url: 'http://127.0.0.1:41234' });

    const config = bonjour.publish.mock.calls[0][0];
    expect(config.port).toBe(41234);
    expect(config.txt.url).toBe('http://127.0.0.1:41234');
  });

  it('defaults the TXT name to os.hostname() when no name is supplied', () => {
    const bonjour = fakeBonjour();
    const makeBonjour = vi.fn(() => bonjour);
    const service = new MdnsService({
      ...IDENTITY,
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
      ...IDENTITY,
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

  it('caps the boards preview so the TXT record stays small', () => {
    const bonjour = fakeBonjour();
    const makeBonjour = vi.fn(() => bonjour);
    const manySlugs = Array.from({ length: 200 }, (_, i) => `board-${i}`);
    const service = new MdnsService({
      ...IDENTITY,
      enabled: true,
      port: 5400,
      getBoards: () => manySlugs,
      makeBonjour,
    });

    service.start();

    const config = bonjour.publish.mock.calls[0][0];
    expect(config.txt.boards.length).toBeLessThanOrEqual(200);
    // Never truncates mid-slug (the cap drops the last partial entry).
    expect(config.txt.boards.endsWith(',')).toBe(false);
    expect(config.txt.boards.split(',').every((s: string) => /^board-\d+$/.test(s))).toBe(true);
  });

  it('re-publishing unpublishes the previous advertisement first, reusing one Bonjour instance', () => {
    const bonjour = fakeBonjour();
    const makeBonjour = vi.fn(() => bonjour);
    let boards = ['a'];
    const service = new MdnsService({
      ...IDENTITY,
      enabled: true,
      port: 5400,
      getBoards: () => boards,
      makeBonjour,
    });

    service.start({ port: 5400 });
    boards = ['a', 'b'];
    service.start(); // re-publish keeps the last-known port

    expect(makeBonjour).toHaveBeenCalledTimes(1);
    expect(bonjour.unpublishAll).toHaveBeenCalledTimes(1);
    expect(bonjour.publish).toHaveBeenCalledTimes(2);
    expect(bonjour.publish.mock.calls[1][0].port).toBe(5400);
    expect(bonjour.publish.mock.calls[1][0].txt.boards).toBe('a,b');
  });

  it('constructs the injected Bonjour instance lazily via makeBonjour when enabled', () => {
    const makeBonjour = vi.fn(fakeBonjour);
    const service = new MdnsService({
      ...IDENTITY,
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
      ...IDENTITY,
      enabled: true,
      port: 5400,
      getBoards: () => [],
      makeBonjour,
    });

    service.start();
    service.dispose();

    expect(bonjour.unpublishAll).toHaveBeenCalled();
    expect(bonjour.destroy).toHaveBeenCalledTimes(1);
  });

  it('is safe to call before start() (never-started service)', () => {
    const makeBonjour = vi.fn(fakeBonjour);
    const service = new MdnsService({
      ...IDENTITY,
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
      ...IDENTITY,
      port: 5400,
      getBoards: () => [],
      makeBonjour,
    });

    service.start();
    expect(() => service.dispose()).not.toThrow();
    expect(makeBonjour).not.toHaveBeenCalled();
  });
});
