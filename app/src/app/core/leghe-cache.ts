/**
 * THE LOCAL CACHE OF WHAT LEGHE SAID (operator, 09/10/2026: «dobbiamo evitare di fare troppe chiamate a
 * euroleghe.fantacalcio.it o leghe.fantacalcio.it altrimenti la sicurezza ci blocca, limitiamo al minimo le
 * richieste e utilizziamo la cache locale»).
 *
 * Every read of the LINEUP page goes through here first, and the network is asked only when the reading in
 * hand is older than what that fact can bear. Before this file one look at the page cost ~12 requests - and
 * so did every league switch, every press of «rileggi», and every live reload of `ng serve` after a saved
 * file, which during a working session is the bulk of them.
 *
 * HOW LONG A READING STAYS GOOD is a property of the FACT, not of the endpoint's name:
 *  - `live`   (1 hour): the roster with the platform's percentages, injuries and the lineup already sent,
 *             the league status, the time to kick-off. They move during a matchday; the page's «rileggi»
 *             button forces exactly these and nothing else.
 *  - `day`    (24 hours): the competitions, my team, the league's teams. They move with a market.
 *  - `season` (7 days): the league's rules, the real clubs, a competition's calendar. Set once, rarely
 *             touched by an admin - and «svuota» in the Account modal is the way to re-read them at once.
 * Declared choices, not measurements: nothing tells us how often Leghe's editors move a percentage.
 *
 * WHERE: `localStorage`, unlike the league TOKENS, which live in `sessionStorage` on purpose
 * (`leghe-session.ts`). A token reads and writes a lineup; this is what the page already showed, and a cache
 * that died with the tab would re-read everything at every new tab. The key never carries a token: it is
 * platform, user, league and path. What stays true about the shared origin (`clemanto.github.io` hosts every
 * Pages site of the account) is that another of his own sites could read these readings - stated, not hidden.
 *
 * What is NOT cached: a failure. An error goes back to the page as it was, and the next pass asks again.
 */

/** How fast the fact behind a reading moves. */
export type Volatility = 'live' | 'day' | 'season';

export const LEGHE_TTL: Record<Volatility, number> = {
  live: 60 * 60_000,
  day: 24 * 60 * 60_000,
  season: 7 * 24 * 60 * 60_000,
};

/**
 * The longest a reading is ever kept: older ones are dropped when the cache opens. Thirty days and not the
 * seven of `season` since 09/10/2026: the page now SHOWS the last readings without a login (operator: «memorizza
 * i dati scaricati e riutilizzali in seguito senza fare il login»), and a roster read ten days ago, drawn with
 * its date, is still worth more than a page asking to connect. Freshness online is still decided by the TTLs.
 */
export const LEGHE_KEEP = 30 * 24 * 60 * 60_000;

const PREFIX = 'fantassistant.leghe-cache.';

/** The part of `Storage` this file uses, so a test can hand it a map. */
export interface KeyValueStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A reading, with WHEN it was taken from Leghe - which is not «now» when it comes from here. */
export interface Cached<T> {
  body: T;
  at: number;
  fromCache: boolean;
}

interface Entry {
  at: number;
  body: unknown;
}

/** The browser's `localStorage`, or nothing where it is refused (a private window, a blocked site). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class LegheCache {
  /** Two passes asking the same thing at the same time share ONE request. */
  private readonly inflight = new Map<string, Promise<Cached<unknown>>>();

  constructor(
    private readonly store: KeyValueStore | null,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.prune();
  }

  /**
   * The reading under `key`: from here when it is younger than its volatility allows, from `fetch` otherwise.
   * `force` skips the stored reading (the «rileggi» button), never an in-flight one, which is just as fresh.
   */
  async read<T>(key: string, volatility: Volatility, fetch: () => Promise<T>, force = false): Promise<Cached<T>> {
    if (!force) {
      const hit = this.peek(key);
      if (hit && this.now() - hit.at < LEGHE_TTL[volatility]) {
        return { body: hit.body as T, at: hit.at, fromCache: true };
      }
    }
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<Cached<T>>;
    const run = fetch()
      .then((body) => {
        const at = this.now();
        this.write(key, { at, body });
        return { body, at, fromCache: false } as Cached<T>;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  /**
   * The reading under `key` WHATEVER ITS AGE, or null: what the page shows without a login, beside the date it
   * was taken. Never the network - with no token there is nothing to ask Leghe with.
   */
  stored<T>(key: string): Cached<T> | null {
    const hit = this.peek(key);
    return hit ? { body: hit.body as T, at: hit.at, fromCache: true } : null;
  }

  /** How many readings are kept. */
  size(): number {
    return this.keys().length;
  }

  /** Forget every reading: the next pass asks Leghe for everything. */
  clear(): void {
    for (const key of this.keys()) this.remove(key);
  }

  private peek(key: string): Entry | null {
    try {
      const raw = this.store?.getItem(PREFIX + key);
      const entry = raw ? (JSON.parse(raw) as Entry) : null;
      return entry && Number.isFinite(entry.at) ? entry : null;
    } catch {
      return null;
    }
  }

  private write(key: string, entry: Entry): void {
    try {
      this.store?.setItem(PREFIX + key, JSON.stringify(entry));
    } catch {
      // A full or refused storage costs the NEXT pass a request, never this one its answer.
    }
  }

  private remove(storeKey: string): void {
    try {
      this.store?.removeItem(storeKey);
    } catch {
      // Nothing to do: a key that cannot be removed is read and judged by its age anyway.
    }
  }

  /** Every stored key of this cache, collected first: removing while walking `key(i)` skips entries. */
  private keys(): string[] {
    const out: string[] = [];
    try {
      const store = this.store;
      if (!store) return out;
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key?.startsWith(PREFIX)) out.push(key);
      }
    } catch {
      // A refused storage has no keys.
    }
    return out;
  }

  /** Drop what no volatility can still use, and what cannot be read at all. */
  private prune(): void {
    for (const storeKey of this.keys()) {
      const entry = this.peek(storeKey.slice(PREFIX.length));
      if (!entry || this.now() - entry.at >= LEGHE_KEEP) this.remove(storeKey);
    }
  }
}
