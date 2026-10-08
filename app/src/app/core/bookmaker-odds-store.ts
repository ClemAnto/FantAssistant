import { Injectable, inject, signal, untracked } from '@angular/core';

import { OddsMatch, parseOdds } from './bookmaker-odds';
import { NextRoundStore } from './next-round-store';
import { storedText } from './view-state';

/** Apps Script's second redirect fails on its own now and then (`next-round-store.ts` measured it). */
const TRIES = 3;
const PAUSE_MS = 600;

export type OddsState = 'idle' | 'loading' | 'read' | 'unreachable';

/**
 * THE BOOKMAKERS' PRICES, read live from the Sheet (`?what=odds` on the same deployment that serves the
 * probable line-ups - one address, one place to paste it when a redeploy changes it).
 *
 * Kept on disk like the probabili reading, with the day it was read: a price of yesterday drawn without
 * its date would read as today's.
 */
@Injectable({ providedIn: 'root' })
export class BookmakerOddsStore {
  private readonly sheet = inject(NextRoundStore);
  private readonly cache = storedText('bookmaker-odds-cache', '');

  readonly state = signal<OddsState>('idle');
  readonly matches = signal<OddsMatch[]>([]);
  readonly why = signal('');
  readonly readAt = signal<Date | null>(null);
  private token = 0;

  constructor() {
    const saved = untracked(this.cache);
    if (!saved) return;
    try {
      const { at, body } = JSON.parse(saved) as { at: string; body: string };
      const matches = parseOdds(JSON.parse(body));
      if (!matches) return;
      this.matches.set(matches);
      this.readAt.set(new Date(at));
      this.state.set('read');
    } catch {
      // An unreadable save is a lost save: the network is the answer.
    }
  }

  /**
   * Read once if nothing is in hand, and again when the reading in hand is older than an hour. An hour and
   * not six: the Sheet APPENDS a sweep league by league over four minutes, so a page opened mid-sweep reads
   * half the matches - it happened on the first capture (08/10/2026: 9 men of 36 priced, the read taken at
   * 21:59 of a sweep that closed at 22:00) - and a short expiry is what makes that half heal by itself.
   */
  load(): void {
    const at = untracked(this.readAt);
    const stale = !at || Date.now() - at.getTime() > 3600_000;
    if (untracked(this.state) === 'idle' || (stale && untracked(this.state) !== 'loading')) void this.read();
  }

  refresh(): void {
    void this.read();
  }

  private async read(): Promise<void> {
    const base = untracked(this.sheet.url).trim();
    const mine = (this.token += 1);
    if (!base) return this.fail(mine, 'nessun indirizzo del foglio');
    const url = `${base}${base.includes('?') ? '&' : '?'}what=odds`;
    this.state.set('loading');
    let last = '';
    for (let attempt = 1; attempt <= TRIES; attempt += 1) {
      try {
        const res = await fetch(url, { redirect: 'follow' });
        const text = await res.text();
        if (mine !== this.token) return;
        if (!res.ok) {
          last = `il foglio ha risposto ${res.status}`;
        } else {
          let raw: unknown = null;
          try {
            raw = JSON.parse(text);
          } catch {
            raw = null;
          }
          const matches = parseOdds(raw);
          if (matches) {
            const now = new Date();
            this.matches.set(matches);
            this.readAt.set(now);
            this.why.set('');
            this.state.set('read');
            this.cache.set(JSON.stringify({ at: now.toISOString(), body: text }));
            return;
          }
          // A deployment that predates `odds.gs` answers the probable line-ups instead: say THAT.
          last = 'il foglio non serve ancora le quote (va aggiunto odds.gs e ridistribuito)';
        }
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      if (attempt < TRIES) await new Promise((go) => setTimeout(go, PAUSE_MS));
    }
    this.fail(mine, `${last} · ${TRIES} tentativi`);
  }

  private fail(mine: number, why: string): void {
    if (mine !== this.token) return;
    this.why.set(why);
    this.state.set('unreachable');
  }
}
