import { Injectable, computed, inject, signal } from '@angular/core';

import { Board } from './bundle';
import { Platform, abbreviate, competitionLabel, nameWords } from './players-store';
import { SquadMan, ValuationStore } from './valuation-store';

/**
 * The SQUADS of today's snapshot: who a real club has, and the eleven the toolkit draws for it.
 *
 * The per-player numbers are NOT computed here: they come from `ValuationStore`, which the consultation
 * table reads too, so «rosa quotata» and the listone's own table can never disagree about a man. What
 * belongs to this store is the club dimension - the strip, the championship groups, the selection, and
 * the board of the club on screen.
 *
 * The BOARD is the toolkit's (`modules/boards.py`, the panel's own class driven headless with the
 * operator's rulings applied). The app reads it and never computes a real club's eleven.
 */

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

/** The clubs of one championship, ready to draw as a row of the strip. */
export interface ClubGroup {
  league: string | null;
  label: string;
  clubs: ClubEntry[];
}

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
  private readonly valuation = inject(ValuationStore);

  /* The bundle's own state, read from the one store that loads it: two copies of «sto caricando» would
   * eventually disagree, and the view would show a table under a spinner or the other way round. */
  readonly status = this.valuation.status;
  readonly error = this.valuation.error;
  readonly generatedAt = this.valuation.generatedAt;
  readonly demo = this.valuation.demo;
  readonly targetSeason = this.valuation.targetSeason;
  readonly inputSeason = this.valuation.inputSeason;
  readonly crests = this.valuation.crests;

  readonly platform = signal<Platform>('default');
  readonly club = signal<string | null>(null);

  /** The sheet whose boards this platform is drawn from, or null when no sheet carries any. */
  readonly boardSheet = computed(() => this.valuation.sheetFor(this.platform()));

  /** True when nothing on this platform carries boards at all: then there is nothing honest to draw. */
  readonly noBoards = computed(() => !this.valuation.boardsFor(this.platform()));

  readonly clubs = computed<ClubEntry[]>(() => {
    const leagues = this.valuation.clubLeagues();
    const byName = new Map<string, ClubEntry>();
    for (const player of this.valuation.rosters().get(this.platform()) ?? []) {
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

  /** The chosen club's squad, valued by the one store that values a man - see `ValuationStore`. */
  readonly squad = computed<SquadMan[]>(() => {
    const club = this.club();
    if (!club) return [];
    const platform = this.platform();
    const men = (this.valuation.rosters().get(platform) ?? []).filter(
      (player) => player.club === club,
    );
    return this.valuation.valuations(platform, men);
  });

  /** What the table's two measured columns are about: one season, one calendar. */
  readonly measuredOn = computed(() => this.valuation.measuredOn(this.platform()));

  /** The board of the chosen club, or null: a club the sheet could not draw says so, never a fallback. */
  readonly board = computed<Board | null>(() => {
    const club = this.club();
    const file = this.valuation.boardsFor(this.platform());
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
    await this.valuation.load();
    if (this.valuation.status() !== 'ready' || this.club()) return;
    this.club.set(this.clubs()[0]?.name ?? null);
  }
}
