import { Injectable, computed, inject, signal } from '@angular/core';

import { Bundle } from './bundle';
import { PlayerRating, matchHistories, ratingsFor, seasonHistories } from './player-ratings';
import { buildSpells } from './player-status';
import { Platform, PlayerRow } from './players-store';

/**
 * The four readings, computed once per listone and handed to whoever draws a list.
 *
 * The POOL comes from the caller and is never rebuilt here, for the same reason the screens are
 * registered on `PlayerStatus` from outside: a percentile is a fact about a pool, and who owns the
 * selection is who knows which pool it is. Both lists therefore rank against exactly the same men.
 *
 * The tables it reads are the ones `Bundle` already caches, so a view that has drawn the consultation
 * table pays nothing extra for the stars.
 */
@Injectable({ providedIn: 'root' })
export class PlayerRatingsStore {
  private readonly bundle = inject(Bundle);

  private readonly byPlatform = signal<Map<Platform, Map<number, PlayerRating>>>(new Map());

  /** True once the ratings are in: before that a missing star means «not computed», not «no data». */
  readonly ready = computed(() => this.byPlatform().size > 0);

  /** The day the injury window is read against - the clock's, while the data is as old as the bundle. */
  private readonly today = new Date().toISOString().slice(0, 10);

  /** The pools the current answer was computed for: a different one has to be computed, not reused. */
  private pending: Promise<void> | null = null;
  private computed: string | null = null;

  /**
   * Computes them for every platform of `pool`, once. A second call with the same pools is free.
   *
   * `expected` is the ENGINE's forecast share of the calendar per `platform|fc_id`, handed in by whoever
   * read the sheet: the presences star is about what he WILL play, and only the caller knows which sheet
   * is in play. Same direction as `PlayerStatus.screens` - the owner of the selection computes it.
   */
  ensure(
    pool: ReadonlyMap<Platform, PlayerRow[]>,
    expected: ReadonlyMap<string, { share: number | null; estimated: boolean }>,
  ): Promise<void> {
    // The percentile is a fact about a POOL, so a call with a different pool is a different question and
    // must not be answered with the previous one's numbers. Keyed on what actually changes the answer.
    const wanted = [...pool]
      .map(([platform, players]) => `${platform}:${players.length}`)
      .sort()
      .join('|') + `/${expected.size}`;
    if (this.computed === wanted && this.pending) return this.pending;
    this.computed = wanted;
    this.pending = this.build(pool, expected).catch(() => {
      // An older bundle without one of the tables: no stars anywhere, and `ready` stays false so
      // nothing reads their absence as «this player has nothing measured». The next call retries.
      this.pending = null;
      this.computed = null;
    });
    return this.pending;
  }

  for(platform: Platform, fcId: number): PlayerRating | null {
    return this.byPlatform().get(platform)?.get(fcId) ?? null;
  }

  private async build(
    pool: ReadonlyMap<Platform, PlayerRow[]>,
    expected: ReadonlyMap<string, { share: number | null; estimated: boolean }>,
  ): Promise<void> {
    const [seasonStats, external, ratings, matchdayMap, injuries] = await Promise.all([
      this.bundle.table('season_stats'),
      this.bundle.table('external_match_stats'),
      this.bundle.table('match_ratings'),
      this.bundle.table('matchday_map'),
      this.bundle.table('injuries'),
    ]);
    const spells = buildSpells(injuries);

    const out = new Map<Platform, Map<number, PlayerRating>>();
    for (const [platform, players] of pool) {
      if (!players.length) continue;
      const leagueOf = new Map<number, string | null>(players.map((p) => [p.fcId, p.league]));
      // WHICH championships this listone prices: Serie A alone on `default` - a foreign fantamedia is
      // R1 and the gate refused it - and every league its own men play on `euro`, read from the pool
      // itself rather than from a list somebody has to keep in step with the perimeter.
      const inScope = platform === 'default'
        ? new Set(['serie_a'])
        : new Set(players.map((p) => p.league).filter((league): league is string => !!league));
      const share = new Map<number, { share: number | null; estimated: boolean }>();
      for (const player of players) {
        const one = expected.get(`${platform}|${player.fcId}`);
        if (one) share.set(player.fcId, one);
      }
      out.set(
        platform,
        ratingsFor({
          pool: players,
          seasons: seasonHistories(seasonStats, platform),
          matches: matchHistories(external, ratings, matchdayMap, leagueOf, inScope),
          spells,
          expectedShare: share,
          today: this.today,
        }),
      );
    }
    this.byPlatform.set(out);
  }
}
