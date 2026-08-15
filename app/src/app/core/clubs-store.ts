import { Injectable, computed, inject, signal } from '@angular/core';

import { Board, BoardsFile, Bundle, EngineSheetEntry, columnIndex, optionalIndex } from './bundle';
import { DRAW_ORDER, occupiedCode } from './club-eleven';
import { PlayerRating } from './player-ratings';
import { PlayerRatingsStore } from './player-ratings-store';
import {
  Platform,
  PlayerRow,
  abbreviate,
  buildRosters,
  competitionLabel,
  nameWords,
} from './players-store';

/**
 * The SQUADS of today's snapshot: who a real club has, and the eleven the toolkit draws for it.
 *
 * Everything here is READ from the bundle and nothing is re-derived. Three sources, three reasons:
 *
 *  - the PERIMETER is `listone_quotes` through `buildRosters`, the same function the consultation table
 *    uses, because a platform's club list is decided by who is quoted on THAT listone and not by the
 *    roster's single unattributed row (`rosters` keeps the last read of either list);
 *  - MV and FM are `season_stats` of the input season on the sheet's own platform - a fantamedia is a
 *    fact about a CALENDAR, so the euro number and the Serie A number are two different measurements of
 *    the same season and must never be shown under one label;
 *  - the BOARD is the toolkit's (`modules/boards.py`, the panel's own class driven headless with the
 *    operator's rulings applied). The app reads it and never computes a real club's eleven.
 *
 * The granular real role comes from `player_roles`, which is a SNAPSHOT and says so: the provider serves
 * only "now" (it accepts a seasonId and ignores it), so each row carries the day it was observed and the
 * view states it rather than presenting it as a season fact.
 */

/** One man of a club's squad, as the snapshot has him. */
export interface SquadMan extends PlayerRow {
  /** The twelve granular codes, `GK`, `DC`, `MC`, `LW`... - the only thing that says WHERE he plays. */
  codes: string[];
  /** The day those codes were observed. They are a snapshot, so the date travels with them. */
  codesOn: string | null;
  /**
   * Last season's MEASURED media voto on this platform's calendar. Null = unknown, never zero.
   *
   * A man with NO appearance is null here even though the table stores 0.0 for him: 147 of the 1,635
   * rows of the input season read mv = fm = 0.0 and every one of them has `pv` = 0, so the zero is the
   * aggregation's and not the player's. Printing it would say «he averaged nothing», which is a claim
   * about football; the truth is that there is no average to have.
   */
  mv: number | null;
  /** ...and his fantamedia, on the same calendar, under the same rule. */
  fm: number | null;
  /** The appearances behind those two: a fantamedia over three matches is not the same claim. */
  pv: number | null;
  /**
   * PARTITE ATTESE: how many matches WITH A VOTE the engine expects of him, on this platform's own
   * calendar. It is the sheet's `engine_pv_pred` - the engine's number, read and never recomputed here -
   * or its declared fallback `est_pv` for a man the core refuses to price, and then `expectedIsEstimate`
   * says so instead of passing an estimate off as a prediction.
   */
  expected: number | null;
  expectedIsEstimate: boolean;
  /**
   * ...and the fantamedia the engine EXPECTS of him this season - `engine_fm_pred`, or its declared
   * fallback `est_fm` for a man the core refuses to price.
   *
   * It is a different quantity from `fm` beside it and the two are never mixed: `fm` is what he DID on
   * this listone's calendar last season, this is what the engine says he will do on the next one. For a
   * man who played elsewhere the first is empty by construction and only this one can answer.
   */
  expectedFm: number | null;
  expectedFmIsEstimate: boolean;
  /**
   * ...and the base vote behind it: `est_mv`, which the sheet DERIVES from the fantamedia by subtracting
   * the bonus per appearance it expects of him. So `expectedFm − expectedMv` is that bonus rate, and the
   * two numbers can never say different things about one player.
   */
  expectedMv: number | null;
  /** Which rung of the cascade produced the estimate, and the sentence the toolkit wrote for it. */
  estimateBasis: string | null;
  estimateNote: string | null;
  /**
   * The code he would occupy in the club's typical eleven, when the board draws him: `DR` for a man with
   * `DC · DR · DL` played at right back. Null for everybody the board does not field - the question
   * «where would he play» has no answer for a man who would not.
   */
  place: string | null;
  /** The four readings, 0-99 inside this listone. Null before they are computed, and it says so. */
  rating: PlayerRating | null;
}

/** One club of the strip: what to draw, and the key a badge is filed under. */
export interface ClubEntry {
  name: string;
  /** `fc_club_id`. The crest is looked up by id - a NAME is not a key. */
  id: number | null;
  /**
   * The championship the CLUB plays in, from `clubs.league` and never from its players' roster rows.
   *
   * A club-level fact must not be counted off its members: on the euro listone Bayer Leverkusen has 27
   * men filed under `bundesliga` and one under `serie_a` - the same stale row that used to smuggle it
   * into the Serie A strip - so a majority vote would be right by luck and a first-row read wrong.
   * Null is «ignoto» and stays that way: Racing Strasburgo has no league here and none of its 23 men
   * carries one either, so naming it Ligue 1 would be inventing a fact the bundle does not have.
   */
  league: string | null;
  /** The short name drawn under the badge. Unique inside the listone on screen - see `shortNames`. */
  short: string;
  /** How many men of this club the listone quotes. */
  quoted: number;
}

/** What the engine's sheet says it expects of a player, prediction and declared fallback alike. */
interface EngineExpectation {
  pv: number | null;
  pvIsEstimate: boolean;
  fm: number | null;
  fmIsEstimate: boolean;
  /** The sheet's `est_mv`, absent on a bundle written before revision 18. */
  mv: number | null;
  basis: string | null;
  note: string | null;
}

/** The clubs of one championship, ready to draw as a row of the strip. */
export interface ClubGroup {
  league: string | null;
  label: string;
  clubs: ClubEntry[];
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** The order a squad is read in, and it is the listone's own. */
const ROLE_ORDER: Record<string, number> = { P: 0, D: 1, C: 2, A: 3 };

/**
 * How many quoted men a club must have before it is a club you can buy from.
 *
 * The toolkit's own rule and its own number (`snapshot.PERIMETER_SQUAD_MIN`, 08/08/2026): a purchasable
 * contingent fields at least an eleven. A player's CLUB comes from `rosters`, which keeps one unattributed
 * last read, so a single stale row smuggles a foreign club into a listone - measured here on the same case
 * the toolkit found, Serie A 2026-27 reading 21 clubs because Gutierrez is still filed at Bayer Leverkusen,
 * alone. Every real club is far above it: the smallest Serie A squad is 21 quoted men and the smallest euro
 * one 16, so the cut removes phantoms and nothing else.
 */
const PERIMETER_SQUAD_MIN = 11;

/**
 * The order the championships are read in, and it is not invented here: it is the order
 * `config/scoring_config.json` lists its own leagues in, which both the toolkit and the engine read.
 * A championship that is not in it keeps its place at the end, named; a club with no championship at
 * all comes last of all, under «campionato ignoto».
 */
const LEAGUE_ORDER = ['serie_a', 'premier_league', 'la_liga', 'bundesliga', 'ligue_1'];

/**
 * The short name drawn under each badge, UNIQUE inside the list it is drawn in.
 *
 * Three letters of the first real word is what a scoreboard does and it is what `abbreviate` already
 * does for the fixture columns - but on the euro listone it lies twice: Manchester City and Manchester
 * United both read `Man`, Bayern Monaco and Bayer Leverkusen both read `Bay` (measured, and four letters
 * does not cure either - the word that separates them is the SECOND one). A label that names two clubs
 * is worse than a longer one, so a collision is resolved by taking as much of the next word as it takes.
 *
 * The POOL is part of the label: `Man` is a perfectly good name for Manchester City on a listone where
 * United is not, which is why this is computed over the clubs on screen and not per club in isolation.
 */
export function shortNames(names: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const byBase = new Map<string, string[]>();
  for (const name of names) {
    const base = abbreviate(name);
    const group = byBase.get(base);
    group ? group.push(name) : byBase.set(base, [name]);
  }
  for (const [base, group] of byBase) {
    if (group.length === 1) {
      out.set(group[0], base);
      continue;
    }
    // Grow the tail one letter at a time until every name of the group is told apart, and stop when
    // growing stops helping - two clubs spelled the same are not something a label can fix.
    for (let letters = 1; letters <= 6; letters++) {
      const tried = group.map((name) => base + (nameWords(name)[1] ?? '').slice(0, letters));
      const unique = new Set(tried).size === group.length;
      if (unique || letters === 6) {
        group.forEach((name, at) => out.set(name, tried[at]));
        break;
      }
    }
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class ClubsStore {
  private readonly bundle = inject(Bundle);
  private readonly ratings = inject(PlayerRatingsStore);

  readonly status = signal<Status>('idle');
  readonly error = signal<string | null>(null);

  /** When the bundle was written: this view is «lo snapshot odierno» and has to say which day that is. */
  readonly generatedAt = signal<string | null>(null);
  readonly demo = signal(false);
  /** The season the squads are FOR, and the season MV/FM were measured in. Two different years. */
  readonly targetSeason = signal<string>('');
  readonly inputSeason = signal<string>('');

  readonly platform = signal<Platform>('default');
  readonly club = signal<string | null>(null);

  readonly crests = signal<Record<string, string>>({});

  private readonly rosters = signal<Map<Platform, PlayerRow[]>>(new Map());
  /** `platform|fc_id` -> the measured season. Keyed by platform because the calendars differ. */
  private readonly measured = signal<Map<string, { pv: number | null; mv: number | null; fm: number | null }>>(
    new Map(),
  );
  private readonly roles = signal<Map<number, { codes: string[]; on: string | null }>>(new Map());
  /** `fc_club_id` -> the championship the CLUB plays in, as the clubs table states it. */
  private readonly clubLeagues = signal<Map<number, string | null>>(new Map());
  /** `platform|fc_id` -> what the engine expects of him, and whether each half is the estimate. */
  private readonly expected = signal<Map<string, EngineExpectation>>(new Map());
  /** ...and the calendar THOSE numbers were predicted on, per platform: a share needs its own total. */
  private readonly expectedRounds = signal<Map<Platform, number | null>>(new Map());
  /** The boards per platform, and the sheet each one came from - so the card can name it. */
  private readonly boards = signal<Map<Platform, { file: BoardsFile; sheet: EngineSheetEntry }>>(
    new Map(),
  );

  /** The sheet whose boards this platform is drawn from, or null when no sheet carries any. */
  readonly boardSheet = computed(() => this.boards().get(this.platform())?.sheet ?? null);

  /** True when nothing on this platform carries boards at all: then there is nothing honest to draw. */
  readonly noBoards = computed(() => !this.boards().has(this.platform()));

  readonly clubs = computed<ClubEntry[]>(() => {
    const leagues = this.clubLeagues();
    const byName = new Map<string, ClubEntry>();
    for (const player of this.rosters().get(this.platform()) ?? []) {
      if (!player.club) continue;
      const entry = byName.get(player.club);
      if (entry) {
        entry.quoted += 1;
        continue;
      }
      byName.set(player.club, {
        name: player.club,
        id: player.clubId,
        // The CLUB's championship, from the clubs table - never the majority of its players' rows.
        league: (player.clubId != null ? leagues.get(player.clubId) : null) ?? null,
        short: '',
        quoted: 1,
      });
    }
    const kept = [...byName.values()]
      .filter((club) => club.quoted >= PERIMETER_SQUAD_MIN)
      .sort((left, right) => left.name.localeCompare(right.name, 'it'));
    const short = shortNames(kept.map((club) => club.name));
    for (const club of kept) club.short = short.get(club.name) ?? club.name.slice(0, 3);
    return kept;
  });

  /**
   * The clubs grouped by CHAMPIONSHIP, in the order the shared config lists them.
   *
   * Serie A is one group and reads as one strip; EuroLeghe is 37 clubs over five championships, and
   * «tutte le squadre in ordine alfabetico» there mixes leagues that have nothing to do with each other
   * at the same auction. A club whose championship the bundle does not carry gets its own group at the
   * end, named «campionato ignoto» - it is not filed under a league by guesswork.
   */
  readonly groups = computed<ClubGroup[]>(() => {
    const byLeague = new Map<string | null, ClubEntry[]>();
    for (const club of this.clubs()) {
      const group = byLeague.get(club.league);
      group ? group.push(club) : byLeague.set(club.league, [club]);
    }
    const rank = (league: string | null): number => {
      if (league == null) return LEAGUE_ORDER.length + 1;
      const at = LEAGUE_ORDER.indexOf(league);
      return at < 0 ? LEAGUE_ORDER.length : at;
    };
    return [...byLeague.entries()]
      .map(([league, clubs]) => ({
        league,
        label: league == null ? 'Campionato ignoto' : competitionLabel(league),
        clubs,
      }))
      .sort((left, right) => rank(left.league) - rank(right.league)
        || left.label.localeCompare(right.label, 'it'));
  });

  /**
   * The chosen club's squad, ordered the way the listone is read: P, D, C, A, and inside a role the
   * best measured fantamedia first. A man with no measured season sorts last - he has no number, which
   * is not a zero, and putting him among the worst would be a claim nobody measured.
   */
  readonly squad = computed<SquadMan[]>(() => {
    const club = this.club();
    if (!club) return [];
    const platform = this.platform();
    const measured = this.measured();
    const roles = this.roles();
    const places = this.places();
    const expected = this.expected();
    // Read once so the ratings recompute the rows when they land, instead of leaving them empty.
    const rated = this.ratings.ready();
    return (this.rosters().get(platform) ?? [])
      .filter((player) => player.club === club)
      .map((player) => {
        const season = measured.get(`${platform}|${player.fcId}`);
        const real = roles.get(player.fcId);
        const engine = expected.get(`${platform}|${player.fcId}`);
        // No appearance, no average: the stored 0.0 of a `pv` = 0 row is the aggregation's zero.
        const played = !!season?.pv;
        return {
          ...player,
          codes: real?.codes ?? [],
          codesOn: real?.on ?? null,
          mv: played ? (season?.mv ?? null) : null,
          fm: played ? (season?.fm ?? null) : null,
          pv: season?.pv ?? null,
          expected: engine?.pv ?? null,
          expectedIsEstimate: engine?.pvIsEstimate ?? false,
          expectedFm: engine?.fm ?? null,
          expectedFmIsEstimate: engine?.fmIsEstimate ?? false,
          expectedMv: engine?.mv ?? null,
          estimateBasis: engine?.basis ?? null,
          estimateNote: engine?.note ?? null,
          place: places.get(player.fcId) ?? null,
          rating: rated ? this.ratings.for(platform, player.fcId) : null,
        };
      })
      .sort(
        (left, right) =>
          (ROLE_ORDER[left.role] ?? 9) - (ROLE_ORDER[right.role] ?? 9) ||
          (right.fm ?? -1) - (left.fm ?? -1) ||
          left.name.localeCompare(right.name),
      );
  });

  /**
   * Where the drawn eleven puts each of its men, as one of HIS granular codes.
   *
   * Read off the board and not recomputed: the eleven and the place are the toolkit's, this only asks
   * which of the man's measured codes the place he was given corresponds to. The duels are deliberately
   * left out - a ballottaggio is a man who might play there, not one who does.
   */
  private readonly places = computed<Map<number, string>>(() => {
    const board = this.board();
    const out = new Map<number, string>();
    for (const line of DRAW_ORDER) {
      for (const man of board?.lines?.[line] ?? []) {
        if (man.fc_id == null) continue;
        const codes = (man.codes ?? '').split(';').map((code) => code.trim()).filter(Boolean);
        const place = occupiedCode(line, man.badge, codes);
        if (place) out.set(man.fc_id, place);
      }
    }
    return out;
  });

  /** The board of the chosen club, or null: a club the sheet could not draw says so, never a fallback. */
  readonly board = computed<Board | null>(() => {
    const club = this.club();
    const file = this.boards().get(this.platform())?.file;
    if (!club || !file) return null;
    const board = file.clubs?.[club] ?? null;
    return board && !board.error ? board : null;
  });

  selectPlatform(platform: Platform): void {
    if (platform === this.platform()) return;
    this.platform.set(platform);
    // The two club lists barely overlap, so a club kept across the switch would usually not be there.
    this.club.set(this.clubs()[0]?.name ?? null);
  }

  select(club: string | null): void {
    this.club.set(club);
  }

  async load(): Promise<void> {
    if (this.status() === 'loading' || this.status() === 'ready') return;
    this.status.set('loading');
    this.error.set(null);
    try {
      const manifest = await this.bundle.manifest();
      this.generatedAt.set(manifest.generated_at);
      this.demo.set(manifest.demo === true);
      this.targetSeason.set(manifest.target_season);
      this.inputSeason.set(manifest.input_season);

      const [players, clubs, rosters, quotes, seasons, crests] = await Promise.all([
        this.bundle.table('players'),
        this.bundle.table('clubs'),
        this.bundle.table('rosters'),
        this.bundle.table('listone_quotes'),
        this.bundle.table('season_stats'),
        // Optional by design: a bundle exported before the badges existed simply has none, and every
        // club falls back to its monogram.
        this.bundle.crests().catch(() => null),
      ]);

      this.rosters.set(buildRosters(players, clubs, rosters, quotes, manifest.target_season));
      this.crests.set(crests ?? {});

      const [cId, cLeague] = columnIndex(clubs, 'fc_club_id', 'league');
      const leagues = new Map<number, string | null>();
      for (const row of clubs.rows) leagues.set(Number(row[cId]), (row[cLeague] as string) ?? null);
      this.clubLeagues.set(leagues);

      const [sId, sSeason, sPlatform, sPv, sMv, sFm] = columnIndex(
        seasons,
        'fc_id',
        'season',
        'platform',
        'pv',
        'mv',
        'fm',
      );
      const stats = new Map<string, { pv: number | null; mv: number | null; fm: number | null }>();
      for (const row of seasons.rows) {
        if (row[sSeason] !== manifest.input_season) continue;
        stats.set(`${row[sPlatform]}|${row[sId]}`, {
          pv: (row[sPv] as number) ?? null,
          mv: (row[sMv] as number) ?? null,
          fm: (row[sFm] as number) ?? null,
        });
      }
      this.measured.set(stats);

      this.roles.set(await this.realRoles());
      const sheets = manifest.engine_sheets ?? [];
      const boards = await this.boardsByPlatform(sheets);
      this.boards.set(boards);
      this.expected.set(await this.expectedByPlatform(boards, sheets));

      this.club.set(this.clubs()[0]?.name ?? null);
      this.status.set('ready');
      // The four readings need the heavy per-match layer, so they land AFTER the page is drawable: the
      // squad is on screen with a dash in the star columns, and the stars fill in when the ranking of
      // the whole listone exists. A percentile cannot be shown player by player as it arrives.
      //
      // The engine's expected SHARE of the calendar travels with them: the presences star is about what
      // he will play, and the calendar it is a share of is the sheet's own (31 euro rounds, 38 default).
      void this.ratings.ensure(this.rosters(), this.expectedShares());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      this.status.set('error');
    }
  }

  /**
   * The granular real role per player: the LAST observation, with the day it was made.
   *
   * The provider serves only "now" - it accepts a seasonId and ignores it - so these rows are a dated
   * snapshot and the newest one is the only one that describes today's squad. A player the snapshot
   * never reached has no codes at all, and the view says «ignoto» rather than drawing a role.
   */
  private async realRoles(): Promise<Map<number, { codes: string[]; on: string | null }>> {
    try {
      const table = await this.bundle.table('player_roles');
      const [id, from, roles] = columnIndex(table, 'fc_id', 'valid_from', 'roles');
      const out = new Map<number, { codes: string[]; on: string | null }>();
      for (const row of table.rows) {
        const fcId = Number(row[id]);
        const on = (row[from] as string) ?? null;
        const seen = out.get(fcId);
        if (seen && (seen.on ?? '') > (on ?? '')) continue;
        out.set(fcId, {
          codes: String(row[roles] ?? '')
            .split(';')
            .map((code) => code.trim())
            .filter(Boolean),
          on,
        });
      }
      return out;
    } catch {
      // A bundle pulled before the table travelled: the column is empty and says so, and nothing else
      // in this view depends on it.
      return new Map();
    }
  }

  /**
   * The engine's expected matches turned into a SHARE of the calendar they were predicted on.
   *
   * The calendar is the one of the sheet the numbers were READ from - `expectedRounds`, filled beside
   * them - and not the first sheet of that platform: two leagues of one platform can declare different
   * `matchdays_target`, and dividing one sheet's `pv` by another's rounds is a share of nothing.
   */
  private expectedShares(): Map<string, { share: number | null; estimated: boolean }> {
    const rounds = this.expectedRounds();
    const out = new Map<string, { share: number | null; estimated: boolean }>();
    for (const [key, one] of this.expected()) {
      const platform = key.split('|')[0] as Platform;
      const total = rounds.get(platform);
      out.set(key, {
        share: one.pv == null || !total ? null : Math.min(1, one.pv / total),
        estimated: one.pvIsEstimate,
      });
    }
    return out;
  }

  /**
   * The boards to draw per platform, and which sheet they came from.
   *
   * A platform can declare more than one league (Serie A has a classic sheet and a mantra one) and the
   * BOARD is the same question in both - it is a prediction about a real coach, not about the game we
   * play - so the first sheet of the platform that actually carries boards is used, and its league is
   * named in the card so the reader knows which file he is looking at.
   */
  private async boardsByPlatform(
    sheets: EngineSheetEntry[],
  ): Promise<Map<Platform, { file: BoardsFile; sheet: EngineSheetEntry }>> {
    const out = new Map<Platform, { file: BoardsFile; sheet: EngineSheetEntry }>();
    for (const sheet of sheets) {
      if (out.has(sheet.platform) || !sheet.boards) continue;
      const file = await this.bundle.boards(sheet.boards);
      if (file) out.set(sheet.platform, { file, sheet });
    }
    return out;
  }

  /**
   * The engine's EXPECTED MATCHES WITH A VOTE per player, from the sheet of each platform.
   *
   * It is `engine_pv_pred` - read, never recomputed: this app has no engine, and a second way of
   * predicting appearances would be a second answer to a question the toolkit already answers. Where the
   * core refuses to price a man, his declared fallback `est_pv` answers and the row says it is an
   * estimate. The sheet is the SAME one the boards come from, so the card names one file for both.
   *
   * The number lives on the platform's own calendar (31 euro rounds, 38 default), which the manifest
   * states per sheet - the tooltip says which, or «22 partite» would be a number without a total.
   */
  private async expectedByPlatform(
    chosen: ReadonlyMap<Platform, { sheet: EngineSheetEntry }>,
    sheets: EngineSheetEntry[],
  ): Promise<Map<string, EngineExpectation>> {
    const out = new Map<string, EngineExpectation>();
    const rounds = new Map<Platform, number | null>();
    for (const platform of ['default', 'euro'] as Platform[]) {
      const sheet = chosen.get(platform)?.sheet ?? sheets.find((one) => one.platform === platform);
      if (!sheet) continue;
      // The calendar of THIS sheet, recorded with its numbers: what the pv values are a share of.
      rounds.set(platform, sheet.matchdays_target ?? null);
      try {
        const table = await this.bundle.table(sheet.path.replace(/\.json(\.gz)?$/, ''));
        const [id] = columnIndex(table, 'fc_id');
        const at = (name: string) => optionalIndex(table, name);
        const columns = {
          pv: at('engine_pv_pred'), estPv: at('est_pv'),
          fm: at('engine_fm_pred'), estFm: at('est_fm'),
          mv: at('est_mv'),
          basis: at('est_basis'), note: at('est_note'),
        };
        const read = (row: unknown[], engineAt: number, estimateAt: number) => {
          const engine = engineAt < 0 ? null : (row[engineAt] as number | null);
          const estimate = estimateAt < 0 ? null : (row[estimateAt] as number | null);
          return { value: engine ?? estimate, isEstimate: engine == null && estimate != null };
        };
        for (const row of table.rows) {
          const pv = read(row, columns.pv, columns.estPv);
          const fm = read(row, columns.fm, columns.estFm);
          if (pv.value == null && fm.value == null) continue;
          out.set(`${platform}|${Number(row[id])}`, {
            pv: pv.value,
            pvIsEstimate: pv.isEstimate,
            fm: fm.value,
            fmIsEstimate: fm.isEstimate,
            mv: columns.mv < 0 ? null : ((row[columns.mv] as number | null) ?? null),
            basis: columns.basis < 0 ? null : ((row[columns.basis] as string) ?? null),
            note: columns.note < 0 ? null : ((row[columns.note] as string) ?? null),
          });
        }
      } catch {
        // A sheet the bundle does not carry: the column stays empty and says «ignoto», which is the
        // truth - the engine has not been run for this platform.
        rounds.delete(platform);
      }
    }
    this.expectedRounds.set(rounds);
    return out;
  }
}
