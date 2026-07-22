// ── InstanceRegistry tests ───────────────────────────────────────────────────
//
// Drives the full discover → health-check → evict lifecycle with both IO seams
// faked: a fake PeerDiscovery (no multicast socket) and a fake `fetchInstance`
// (no HTTP). No timers are relied on — `warmUp()` runs exactly one health tick,
// so each test controls when checks happen.

import { describe, it, expect, vi } from 'vitest';
import { InstanceRegistry } from './registry.js';
import { PeerDiscovery, type PeerInfo } from './discovery.js';
import type { InstanceInfoResult } from './board-http.js';

/** A PeerDiscovery whose peer list we control directly (no Bonjour). */
function fakeDiscovery(peers: PeerInfo[]): PeerDiscovery {
  return {
    start() {},
    warmUp: async () => {},
    getPeers: () => peers,
    destroy() {},
    buildUrls: (peer: PeerInfo) => ({
      wsUrl: `${(peer.url || `http://${peer.addresses[0]}:${peer.port}`).replace(/^http/, 'ws')}/yjs`,
      httpUrl: peer.url || `http://${peer.addresses[0]}:${peer.port}`,
    }),
  } as unknown as PeerDiscovery;
}

function peer(id: string, url: string, boards: string[] = []): PeerInfo {
  return {
    id,
    name: id,
    host: `${id}.local`,
    url,
    version: '1.0.0',
    addresses: ['10.0.0.1'],
    port: 5400,
    boards,
    lastSeen: 1,
  };
}

function info(id: string, url: string, boards: string[] = []): InstanceInfoResult {
  return { id, name: id, url, version: '1.0.0', boards };
}

describe('InstanceRegistry discovery + health', () => {
  it('lists the synthetic local instance once it health-checks OK', async () => {
    const fetchInstance = vi.fn(async () => info('local', 'http://localhost:5400', ['a']));
    const reg = new InstanceRegistry({
      localUrl: 'http://localhost:5400',
      discovery: fakeDiscovery([]),
      fetchInstance,
    });
    await reg.warmUp(0);

    const list = reg.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'local', httpUrl: 'http://localhost:5400', healthy: true });
    expect(list[0].boards).toEqual(['a']);
    reg.dispose();
  });

  it('ingests mDNS peers and health-checks each', async () => {
    const fetchInstance = vi.fn(async (url: string) =>
      url.includes('6000') ? info('remote', url, ['x']) : info('local', url),
    );
    const reg = new InstanceRegistry({
      localUrl: 'http://localhost:5400',
      discovery: fakeDiscovery([peer('remote', 'http://10.0.0.9:6000')]),
      fetchInstance,
    });
    await reg.warmUp(0);

    expect(reg.healthyIds().sort()).toEqual(['local', 'remote']);
    expect(reg.get('remote')).toMatchObject({
      wsUrl: 'ws://10.0.0.9:6000/yjs',
      boards: ['x'],
    });
    reg.dispose();
  });

  it('evicts a stopped instance after maxFailures consecutive failed checks', async () => {
    let alive = true;
    const fetchInstance = vi.fn(async (url: string) => {
      if (!alive) throw new Error('connection refused');
      return info('remote', url);
    });
    const reg = new InstanceRegistry({
      localUrl: undefined,
      discovery: fakeDiscovery([peer('remote', 'http://10.0.0.9:6000')]),
      fetchInstance,
      maxFailures: 2,
    });

    await reg.warmUp(0);
    expect(reg.get('remote')).not.toBeNull();

    // Server stops responding.
    alive = false;
    await reg['tick'](); // failure 1 — marked unhealthy, still tracked
    expect(reg.get('remote')).toBeNull(); // not listed while unhealthy
    await reg['tick'](); // failure 2 — evicted entirely
    expect(reg.healthyIds()).toEqual([]);
    reg.dispose();
  });

  it('recovers an instance that starts responding again before eviction', async () => {
    let alive = true;
    const fetchInstance = vi.fn(async (url: string) => {
      if (!alive) throw new Error('down');
      return info('remote', url);
    });
    const reg = new InstanceRegistry({
      discovery: fakeDiscovery([peer('remote', 'http://10.0.0.9:6000')]),
      fetchInstance,
      maxFailures: 3,
    });

    await reg.warmUp(0);
    alive = false;
    await reg['tick'](); // one failure (below threshold)
    expect(reg.get('remote')).toBeNull();
    alive = true;
    await reg['tick'](); // healthy again, failure counter resets
    expect(reg.get('remote')).not.toBeNull();
    reg.dispose();
  });

  it('get() returns null for an unknown id', async () => {
    const reg = new InstanceRegistry({
      localUrl: 'http://localhost:5400',
      discovery: fakeDiscovery([]),
      fetchInstance: vi.fn(async (url: string) => info('local', url)),
    });
    await reg.warmUp(0);
    expect(reg.get('nope')).toBeNull();
    reg.dispose();
  });
});
