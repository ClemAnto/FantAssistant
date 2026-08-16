import { Injectable, computed, inject, signal } from '@angular/core';

import { Bundle, BundleTable, columnIndex } from './bundle';
import { CLEAN_SHEET_SHARE, ClubDefence, clubCleanSheets, fieldedPlaces } from './club-defence';
import { EngineForecast, PlayerRating, matchHistories, ratingsFor, seasonHistories } from './player-ratings';
import { CareerEvents, habitMarks } from './player-discipline';
import { MYSTERY_WINDOW, mysteryOf } from './player-mystery';
import { PlayerMark, PlayerStatus, Spell, buildSpells, declaredFor } from './player-status';
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
  /** Dove finiscono i marchi: un nome prende i suoi da un posto solo, mai da due liste. */
  private readonly marks = inject(PlayerStatus);

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
    expected: ReadonlyMap<string, EngineForecast>,
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
    expected: ReadonlyMap<string, EngineForecast>,
  ): Promise<void> {
    const [seasonStats, external, ratings, matchdayMap, injuries, scoring, season, notes] =
      await Promise.all([
      this.bundle.table('season_stats'),
      this.bundle.table('external_match_stats'),
      this.bundle.table('match_ratings'),
      this.bundle.table('matchday_map'),
      this.bundle.table('injuries'),
      // The overall prices a bonus in POINTS, and what a gol is worth is a fact about the
      // championship: read from the shared config, never hard-coded. A bundle without it still
      // draws the column, on the game's published defaults, and the note says so.
      this.bundle.scoring().catch(() => null),
      // The operator's DECLARED notes: the app's Overall reads them (see `DECLARED_RISK`), nothing
      // under `engine/` does. Parsed by the same `declaredFor` the marks use, so «what a note is» has
      // one definition and a season's notes are never read as another season's.
      this.bundle.manifest().then((one) => one.target_season).catch(() => null),
      this.bundle.playerNotes().catch(() => null),
    ]);
    // Quante squadre gioca la lega e quanti posti schiera il suo regolamento: i due numeri del
    // rimpiazzo che entra davvero. Vengono dal manifest e dal regolamento, mai scritti qui.
    const sheets = await this.bundle.manifest()
      .then((one) => one.engine_sheets ?? []).catch(() => []);
    const places = fieldedPlaces(await this.bundle.classicModules().catch(() => null));
    const spells = buildSpells(injuries);
    const declared = declaredFor(notes, season);

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
      const share = new Map<number, EngineForecast>();
      for (const player of players) {
        const one = expected.get(`${platform}|${player.fcId}`);
        if (one) share.set(player.fcId, one);
      }
      // La quota di porte inviolate per club, che l'Overall applica ai portieri sui DUE lati del conto.
      // Stessa funzione che disegna l'icona: un fatto, una definizione.
      const cleanSheetRate = new Map(
        [...clubCleanSheets(ratings, platform)].map(([club, one]) => [club, one.share]),
      );
      out.set(
        platform,
        ratingsFor({
          pool: players,
          seasons: seasonHistories(seasonStats, platform),
          matches: matchHistories(external, ratings, matchdayMap, leagueOf, inScope),
          spells,
          expectedShare: share,
          today: this.today,
          scoring,
          declared,
          cleanSheetRate,
          teams: sheets.find((one) => one.platform === platform)?.teams ?? null,
          fieldedPlaces: places ?? undefined,
        }),
      );
    }
    this.byPlatform.set(out);
    this.marks.mysteries.set(this.mysteries(external, spells, pool, out, expected));
    // Un posto solo che scrive `habits`: le abitudini dell'uomo e il record della sua porta finiscono
    // nella stessa lista, o due `set` di fila si cancellerebbero a vicenda.
    const habits = this.habits(seasonStats, pool);
    for (const [fcId, mark] of this.cleanSheets(ratings, pool)) {
      (habits.get(fcId) ?? habits.set(fcId, []).get(fcId)!).push(mark);
    }
    this.marks.habits.set(habits);
  }

  /**
   * LA PORTA DELLA SUA SQUADRA, per i portieri e per nessun altro.
   *
   * Non è un'abitudine di chi la porta - la misura che lo dimostra sta in `club-defence.ts` - ma è una
   * cosa che al tavolo cambia un'offerta, perché i gol subiti sono la metà di quello che vale una
   * partita di un portiere. Quindi si disegna accanto al suo nome e la frase dice di chi è il merito.
   *
   * Un uomo quotato su tutt'e due i listoni prende UN marchio solo, e il record letto è quello del
   * campionato vero del suo club (`default`) quando c'è: il calendario euro è un sottoinsieme, quindi
   * dice meno della stessa cosa.
   */
  private cleanSheets(
    ratings: BundleTable,
    pool: ReadonlyMap<Platform, PlayerRow[]>,
  ): Map<number, PlayerMark> {
    const record = new Map<Platform, Map<string, ClubDefence>>();
    for (const platform of pool.keys()) record.set(platform, clubCleanSheets(ratings, platform));
    const out = new Map<number, PlayerMark>();
    for (const platform of ['default', 'euro'] as Platform[]) {
      for (const player of pool.get(platform) ?? []) {
        if (player.role !== 'P' || out.has(player.fcId)) continue;
        const club = record.get(platform)?.get(player.club);
        if (!club || club.share < CLEAN_SHEET_SHARE) continue;
        out.set(player.fcId, {
          flag: 'clean_sheets',
          note: `${player.club}: ${club.clean} porte inviolate su ${club.played} nel ${club.season}`
            + ' · è un merito della squadra, non suo',
        });
      }
    }
    return out;
  }

  /**
   * Le due abitudini misurate: cartellini e rigori sbagliati, sulla CARRIERA di questo listone.
   *
   * Sommate su tutte le stagioni e non sull'ultima: un'abitudine è quello che uno fa da anni, e una
   * stagione da tre ammonizioni non distingue il falloso dal fortunato. Le soglie stanno in
   * `player-discipline.ts` con la misura che le ha scelte.
   */
  private habits(
    seasonStats: BundleTable,
    pool: ReadonlyMap<Platform, PlayerRow[]>,
  ): Map<number, PlayerMark[]> {
    const [id, platform, pv, yellows, reds, ownGoals, penScored, penMissed, penSaved] = columnIndex(
      seasonStats, 'fc_id', 'platform', 'pv', 'yellows', 'reds', 'own_goals', 'pen_scored',
      'pen_missed', 'pen_saved',
    );
    const career = new Map<number, CareerEvents>();
    for (const row of seasonStats.rows) {
      // Una piattaforma sola, o le stagioni di un italiano verrebbero contate due volte: euro e Serie A
      // sono la STESSA stagione vista da due calendari.
      if (row[platform] !== 'default') continue;
      const fcId = Number(row[id]);
      const one = career.get(fcId)
        ?? { appearances: 0, yellows: 0, reds: 0, ownGoals: 0, penScored: 0, penMissed: 0, penSaved: 0 };
      one.appearances += (row[pv] as number) ?? 0;
      one.yellows += (row[yellows] as number) ?? 0;
      one.reds += (row[reds] as number) ?? 0;
      one.ownGoals += (row[ownGoals] as number) ?? 0;
      one.penScored += (row[penScored] as number) ?? 0;
      one.penMissed += (row[penMissed] as number) ?? 0;
      one.penSaved += (row[penSaved] as number) ?? 0;
      career.set(fcId, one);
    }

    const quoted = new Set<number>();
    for (const players of pool.values()) for (const player of players) quoted.add(player.fcId);

    const out = new Map<number, PlayerMark[]>();
    for (const [fcId, one] of career) {
      if (!quoted.has(fcId)) continue;
      const marks = habitMarks(one);
      if (marks.length) out.set(fcId, marks);
    }
    return out;
  }

  /**
   * I MISTERI: chi era disponibile, ha i voti di un titolare e non ha giocato.
   *
   * Calcolato QUI e non nello store dei valori perché la «qualità» è il posto che occupa nella lettura
   * VOTI, cioè un percentile dentro la pool - e la pool la conosce chi la classifica. Lo stesso motivo
   * per cui gli screen del pannello d'asta sono registrati da fuori: «the owner of the selection
   * computes them».
   *
   * La regola e le sue soglie stanno in `player-mystery.ts`; qui si raccolgono solo i tre ingredienti.
   */
  private mysteries(
    external: BundleTable,
    spells: ReadonlyMap<number, Spell[]>,
    pool: ReadonlyMap<Platform, PlayerRow[]>,
    rated: ReadonlyMap<Platform, Map<number, PlayerRating>>,
    expected: ReadonlyMap<string, EngineForecast>,
  ): Map<number, PlayerMark> {
    const found = new Map<number, PlayerMark>();
    const [eId, eSeason, eSource, eCompetition, eMd, eMinutes, eDate] = columnIndex(
      external, 'fc_id', 'season', 'source', 'competition', 'real_md', 'minutes', 'match_date',
    );

    /** L'ultima stagione con righe, e l'ultima giornata di ogni campionato dentro di essa. */
    let season = '';
    for (const row of external.rows) {
      if (row[eSource] !== 'sofascore' || row[eMd] == null) continue;
      const one = row[eSeason] as string;
      if (one > season) season = one;
    }
    const lastRound = new Map<string, number>();
    for (const row of external.rows) {
      if (row[eSeason] !== season || row[eSource] !== 'sofascore') continue;
      const md = row[eMd] as number | null;
      if (md == null) continue;
      const league = row[eCompetition] as string;
      lastRound.set(league, Math.max(lastRound.get(league) ?? 0, md));
    }

    const window = new Map<number, { minutes: number; rounds: number; injured: number }>();
    for (const row of external.rows) {
      if (row[eSeason] !== season || row[eSource] !== 'sofascore') continue;
      const md = row[eMd] as number | null;
      const last = lastRound.get(row[eCompetition] as string);
      if (md == null || last == null || md <= last - MYSTERY_WINDOW) continue;
      const fcId = Number(row[eId]);
      const one = window.get(fcId) ?? { minutes: 0, rounds: 0, injured: 0 };
      one.minutes += (row[eMinutes] as number) ?? 0;
      one.rounds += 1;
      const date = (row[eDate] as string) ?? null;
      if (date && (spells.get(fcId) ?? []).some(
        (spell) => spell.from <= date && (spell.to == null || spell.to >= date))) {
        one.injured += 1;
      }
      window.set(fcId, one);
    }

    // Un uomo quotato su due listoni tiene la lettura migliore: è comunque «uno che i voti li prende».
    const quality = new Map<number, number>();
    for (const [platform, players] of pool) {
      for (const player of players) {
        const score = rated.get(platform)?.get(player.fcId)?.votes.score;
        if (score == null) continue;
        quality.set(player.fcId, Math.max(quality.get(player.fcId) ?? 0, score));
      }
    }

    for (const [fcId, one] of window) {
      const mark = mysteryOf({
        minutes: one.minutes,
        rounds: one.rounds,
        injured: one.injured,
        qualityPercentile: quality.get(fcId) ?? null,
        // La previsione del motore PRIMA delle preferenze: quella è la sua, e dice se lo aspetta in campo.
        expectedShare: Math.max(
          expected.get(`default|${fcId}`)?.share ?? 0,
          expected.get(`euro|${fcId}`)?.share ?? 0,
        ) || null,
        season,
      });
      if (mark) found.set(fcId, mark);
    }
    return found;
  }
}
