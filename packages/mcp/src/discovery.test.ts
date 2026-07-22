// ── PeerDiscovery unit tests ──────────────────────────────────────────────────
//
// Drives PeerDiscovery against a fake Bonjour/Browser pair (injected via
// `makeBonjour`) so these tests never open a real multicast socket — mirrors
// how `@figemite/server`'s MdnsService tests presumably fake `Bonjour`
// (`makeBonjour` factory pattern).

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { PeerDiscovery, type BonjourLike } from './discovery.js';

interface FakeService {
  name: string;
  host: string;
  port: number;
  addresses?: string[];
  fqdn: string;
  txt?: Record<string, string>;
}

class FakeBrowser extends EventEmitter {
  emitUp(service: FakeService): void {
    this.emit('up', service);
  }
  emitDown(service: FakeService): void {
    this.emit('down', service);
  }
}

class FakeBonjour implements BonjourLike {
  readonly browser = new FakeBrowser();
  destroyed = false;
  lastFindType: string | undefined;

  find(opts: { type: string }): FakeBrowser {
    this.lastFindType = opts.type;
    return this.browser;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

function makeDiscovery() {
  const fake = new FakeBonjour();
  const discovery = new PeerDiscovery({ makeBonjour: () => fake });
  return { discovery, fake };
}

describe('PeerDiscovery.start', () => {
  it('browses the _figemite._tcp service type', () => {
    const { discovery, fake } = makeDiscovery();
    discovery.start();
    expect(fake.lastFindType).toBe('figemite');
  });

  it('is idempotent — a second start() does not re-browse', () => {
    const { discovery, fake } = makeDiscovery();
    discovery.start();
    const firstBrowser = fake.browser;
    discovery.start();
    expect(fake.browser).toBe(firstBrowser); // same fake instance either way
  });

  it('does not construct a Bonjour instance until start() is called', () => {
    let constructed = false;
    const discovery = new PeerDiscovery({
      makeBonjour: () => {
        constructed = true;
        return new FakeBonjour();
      },
    });
    expect(constructed).toBe(false);
    discovery.start();
    expect(constructed).toBe(true);
  });
});

describe('PeerDiscovery peer tracking', () => {
  it('adds a peer on an "up" event, using the TXT name/boards', () => {
    const { discovery, fake } = makeDiscovery();
    discovery.start();
    fake.browser.emitUp({
      name: 'fallback-name',
      host: 'nick.local',
      port: 5400,
      addresses: ['10.0.0.5'],
      fqdn: 'nick._figemite._tcp.local',
      txt: { name: 'nick', boards: 'spend,planning' },
    });

    const peers = discovery.getPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({
      name: 'nick',
      host: 'nick.local',
      addresses: ['10.0.0.5'],
      port: 5400,
      boards: ['spend', 'planning'],
    });
  });

  it('falls back to the service name when the TXT record has no name', () => {
    const { discovery, fake } = makeDiscovery();
    discovery.start();
    fake.browser.emitUp({
      name: 'fallback-name',
      host: 'nick.local',
      port: 5400,
      fqdn: 'nick._figemite._tcp.local',
    });
    expect(discovery.getPeers()[0]?.name).toBe('fallback-name');
  });

  it('treats an empty boards TXT field as no boards', () => {
    const { discovery, fake } = makeDiscovery();
    discovery.start();
    fake.browser.emitUp({
      name: 'nick',
      host: 'nick.local',
      port: 5400,
      fqdn: 'nick._figemite._tcp.local',
      txt: { name: 'nick', boards: '' },
    });
    expect(discovery.getPeers()[0]?.boards).toEqual([]);
  });

  it('removes a peer on a "down" event', () => {
    const { discovery, fake } = makeDiscovery();
    discovery.start();
    const service: FakeService = {
      name: 'nick',
      host: 'nick.local',
      port: 5400,
      fqdn: 'nick._figemite._tcp.local',
      txt: { name: 'nick', boards: '' },
    };
    fake.browser.emitUp(service);
    expect(discovery.getPeers()).toHaveLength(1);
    fake.browser.emitDown(service);
    expect(discovery.getPeers()).toHaveLength(0);
  });
});

describe('PeerDiscovery.resolvePeer', () => {
  it('finds a peer by name, case-insensitively', () => {
    const { discovery, fake } = makeDiscovery();
    discovery.start();
    fake.browser.emitUp({
      name: 'Nick',
      host: 'nick.local',
      port: 5400,
      fqdn: 'nick._figemite._tcp.local',
      txt: { name: 'Nick', boards: '' },
    });
    expect(discovery.resolvePeer('nick')?.name).toBe('Nick');
    expect(discovery.resolvePeer('NICK')?.name).toBe('Nick');
  });

  it('also matches a bare hostname with or without ".local"', () => {
    const { discovery, fake } = makeDiscovery();
    discovery.start();
    fake.browser.emitUp({
      name: 'display-name',
      host: 'nick.local',
      port: 5400,
      fqdn: 'nick._figemite._tcp.local',
      txt: { name: 'display-name', boards: '' },
    });
    expect(discovery.resolvePeer('nick.local')?.host).toBe('nick.local');
    expect(discovery.resolvePeer('nick')?.host).toBe('nick.local');
  });

  it('returns null when no peer matches', () => {
    const { discovery } = makeDiscovery();
    discovery.start();
    expect(discovery.resolvePeer('nobody')).toBeNull();
  });
});

describe('PeerDiscovery peer identity TXT fields', () => {
  it('parses id, url, and version from the TXT record', () => {
    const { discovery, fake } = makeDiscovery();
    discovery.start();
    fake.browser.emitUp({
      name: 'fallback-name',
      host: 'nick.local',
      port: 5400,
      addresses: ['10.0.0.5'],
      fqdn: 'nick._figemite._tcp.local',
      txt: {
        id: 'inst-abc',
        name: 'nick',
        url: 'http://10.0.0.5:5400',
        version: '1.2.3',
        boards: 'spend',
      },
    });
    expect(discovery.getPeers()[0]).toMatchObject({
      id: 'inst-abc',
      url: 'http://10.0.0.5:5400',
      version: '1.2.3',
    });
  });

  it('defaults id/url/version to empty strings for a legacy server that omits them', () => {
    const { discovery, fake } = makeDiscovery();
    discovery.start();
    fake.browser.emitUp({
      name: 'nick',
      host: 'nick.local',
      port: 5400,
      fqdn: 'nick._figemite._tcp.local',
      txt: { name: 'nick', boards: '' },
    });
    expect(discovery.getPeers()[0]).toMatchObject({ id: '', url: '', version: '' });
  });
});

describe('PeerDiscovery.buildUrls', () => {
  const base = { id: '', url: '', version: '' };

  it('prefers the advertised TXT url when present', () => {
    const { discovery } = makeDiscovery();
    const urls = discovery.buildUrls({
      ...base,
      name: 'nick',
      host: 'nick.local',
      url: 'http://192.168.1.9:5400',
      addresses: ['10.0.0.5'],
      port: 5400,
      boards: [],
      lastSeen: Date.now(),
    });
    expect(urls).toEqual({
      wsUrl: 'ws://192.168.1.9:5400/yjs',
      httpUrl: 'http://192.168.1.9:5400',
    });
  });

  it('prefers the first IPv4 address over the .local hostname when no url is advertised', () => {
    const { discovery } = makeDiscovery();
    const urls = discovery.buildUrls({
      ...base,
      name: 'nick',
      host: 'nick.local',
      addresses: ['10.0.0.5', '10.0.0.6'],
      port: 5400,
      boards: [],
      lastSeen: Date.now(),
    });
    expect(urls).toEqual({
      wsUrl: 'ws://10.0.0.5:5400/yjs',
      httpUrl: 'http://10.0.0.5:5400',
    });
  });

  it('falls back to the .local hostname when no addresses were resolved', () => {
    const { discovery } = makeDiscovery();
    const urls = discovery.buildUrls({
      ...base,
      name: 'nick',
      host: 'nick.local',
      addresses: [],
      port: 5400,
      boards: [],
      lastSeen: Date.now(),
    });
    expect(urls).toEqual({
      wsUrl: 'ws://nick.local:5400/yjs',
      httpUrl: 'http://nick.local:5400',
    });
  });
});

describe('PeerDiscovery.warmUp', () => {
  it('starts discovery if not already started and resolves after the timeout', async () => {
    const { discovery, fake } = makeDiscovery();
    await discovery.warmUp(5);
    expect(fake.lastFindType).toBe('figemite');
  });

  it('only waits once — a second call resolves the same promise', async () => {
    const { discovery } = makeDiscovery();
    const p1 = discovery.warmUp(5);
    const p2 = discovery.warmUp(5);
    expect(p1).toBe(p2);
    await p1;
  });
});

describe('PeerDiscovery.destroy', () => {
  it('destroys the underlying Bonjour instance', () => {
    const { discovery, fake } = makeDiscovery();
    discovery.start();
    discovery.destroy();
    expect(fake.destroyed).toBe(true);
  });

  it('is safe to call before start()', () => {
    const { discovery } = makeDiscovery();
    expect(() => discovery.destroy()).not.toThrow();
  });
});

describe('buildDirectUrls (no discovery)', () => {
  it('builds URLs from a bare host', async () => {
    const { buildDirectUrls } = await import('./discovery.js');
    expect(buildDirectUrls('10.0.0.5')).toEqual({
      wsUrl: 'ws://10.0.0.5:5400/yjs',
      httpUrl: 'http://10.0.0.5:5400',
    });
  });

  it('builds URLs from a host:port address', async () => {
    const { buildDirectUrls } = await import('./discovery.js');
    expect(buildDirectUrls('10.0.0.5:6000')).toEqual({
      wsUrl: 'ws://10.0.0.5:6000/yjs',
      httpUrl: 'http://10.0.0.5:6000',
    });
  });

  it('strips a scheme and path if the caller pasted a full URL', async () => {
    const { buildDirectUrls } = await import('./discovery.js');
    expect(buildDirectUrls('http://10.0.0.5:6000/some/path')).toEqual({
      wsUrl: 'ws://10.0.0.5:6000/yjs',
      httpUrl: 'http://10.0.0.5:6000',
    });
  });
});
