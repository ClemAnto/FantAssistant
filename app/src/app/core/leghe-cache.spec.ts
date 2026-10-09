import { describe, expect, it } from 'vitest';

import { KeyValueStore, LEGHE_TTL, LegheCache } from './leghe-cache';

/** A `Storage` made of a map, with the same key walk the browser offers. */
function mapStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** A clock the test moves by hand, and a fetch that counts how often the network was asked. */
function rig(store = mapStore()) {
  let now = 1_000_000;
  let asked = 0;
  const cache = new LegheCache(store, () => now);
  const fetch = (body: unknown) => async () => {
    asked += 1;
    return body;
  };
  return {
    store,
    cache,
    fetch,
    asked: () => asked,
    tick: (ms: number) => (now += ms),
    reopen: () => new LegheCache(store, () => now),
  };
}

describe('LegheCache', () => {
  it('asks the network once, then serves the reading from the store while it is young enough', async () => {
    const r = rig();
    const first = await r.cache.read('k', 'live', r.fetch({ a: 1 }));
    r.tick(LEGHE_TTL.live - 1);
    const second = await r.cache.read('k', 'live', r.fetch({ a: 2 }));
    expect(r.asked()).toBe(1);
    expect(first).toEqual({ body: { a: 1 }, at: 1_000_000, fromCache: false });
    // The cached reading keeps the time it was TAKEN, not the time it was served.
    expect(second).toEqual({ body: { a: 1 }, at: 1_000_000, fromCache: true });
  });

  it('asks again once the reading is older than its volatility allows, and each volatility has its own age', async () => {
    const r = rig();
    await r.cache.read('status', 'live', r.fetch(1));
    await r.cache.read('rules', 'season', r.fetch(1));
    r.tick(LEGHE_TTL.live);
    expect((await r.cache.read('status', 'live', r.fetch(2))).body).toBe(2);
    expect((await r.cache.read('rules', 'season', r.fetch(2))).body).toBe(1);
    expect(r.asked()).toBe(3);
  });

  it('survives a reload of the page: a new cache on the same store serves what the old one read', async () => {
    const r = rig();
    await r.cache.read('k', 'day', r.fetch('roster'));
    const again = await r.reopen().read('k', 'day', r.fetch('other'));
    expect(again.body).toBe('roster');
    expect(r.asked()).toBe(1);
  });

  it('`force` skips the stored reading (the «rileggi» button)', async () => {
    const r = rig();
    await r.cache.read('k', 'live', r.fetch(1));
    const forced = await r.cache.read('k', 'live', r.fetch(2), true);
    expect(forced).toEqual({ body: 2, at: 1_000_000, fromCache: false });
    expect(r.asked()).toBe(2);
  });

  it('keeps a `null` answer («no matchday in play») as a reading, not as a miss', async () => {
    const r = rig();
    await r.cache.read('cup', 'live', r.fetch(null));
    const again = await r.cache.read('cup', 'live', r.fetch({ found: true }));
    expect(again.body).toBeNull();
    expect(again.fromCache).toBe(true);
  });

  it('never caches a failure: the next pass asks again', async () => {
    const r = rig();
    await expect(
      r.cache.read('k', 'live', async () => {
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    expect(r.cache.size()).toBe(0);
    expect((await r.cache.read('k', 'live', r.fetch('ok'))).body).toBe('ok');
  });

  it('two passes asking the same thing at once share ONE request', async () => {
    const r = rig();
    let release!: () => void;
    let asked = 0;
    const slow = () =>
      new Promise<string>((go) => {
        asked += 1;
        release = () => go('answer');
      });
    const one = r.cache.read('k', 'live', slow);
    const two = r.cache.read('k', 'live', slow);
    release();
    expect((await one).body).toBe('answer');
    expect((await two).body).toBe('answer');
    expect(asked).toBe(1);
  });

  it('drops on opening what no volatility can still use, and what it cannot read', async () => {
    const r = rig();
    await r.cache.read('old', 'season', r.fetch(1));
    r.tick(LEGHE_TTL.season);
    await r.cache.read('new', 'live', r.fetch(1));
    r.store.setItem('fantassistant.leghe-cache.broken', '{not json');
    r.store.setItem('fantassistant.other', 'kept');
    const reopened = r.reopen();
    expect(reopened.size()).toBe(1);
    expect(r.store.getItem('fantassistant.other')).toBe('kept');
  });

  it('`clear` forgets every reading of this cache and nothing else of the app', async () => {
    const r = rig();
    await r.cache.read('a', 'live', r.fetch(1));
    await r.cache.read('b', 'day', r.fetch(1));
    r.store.setItem('fantassistant.leghe-league', 'classic:1');
    r.cache.clear();
    expect(r.cache.size()).toBe(0);
    expect(r.store.getItem('fantassistant.leghe-league')).toBe('classic:1');
  });

  it('answers even where the browser refuses storage: it just cannot remember', async () => {
    let asked = 0;
    const cache = new LegheCache(null);
    const fetch = async () => (asked += 1);
    await cache.read('k', 'live', fetch);
    await cache.read('k', 'live', fetch);
    expect(asked).toBe(2);
    expect(cache.size()).toBe(0);
  });
});
