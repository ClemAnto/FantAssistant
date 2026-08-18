import { Injectable, inject, signal } from '@angular/core';

import {
  AuctionFeed,
  AuctionPlayer,
  DraftStatus,
  GameType,
  MarketType,
  RawPick,
  RawState,
  Zone,
  zoneOf,
} from './auction-feed';
import { PlanTeam, ahead } from './auction-plan';
import { Bundle, BundleTable, EngineSheetEntry } from './bundle';

/**
 * «Segui un'asta» without an auction: an invented TABLE over the bundle's own listone.
 *
 * What is fake and what is not is the whole design, and it is deliberately asymmetric:
 *   * the TABLE is invented - the squads, their names, the pick order, the picks already made, the
 *     budget. None of it describes anybody, and the panel says so on screen for as long as it is up.
 *   * the PLAYERS are real, and so are the engine's numbers about them. The join between a session and
 *     a sheet is `fc_id` (`auction-advice.ts`), so a demo built on invented names would match no sheet
 *     at all and would show the panel with every column reading «—» - the layout of the thing instead
 *     of the thing. «Vedere di che si tratta» needs the numbers on.
 *
 * Two rules the fixture obeys rather than approximating:
 *   * the ORDER is the platform's own (`ahead`, re-used from `auction-plan.ts` and not copied), so the
 *     mechanic the panel explains - spend big, choose later - is the mechanic the demo shows;
 *   * the BUDGET is derived and not chosen: the FVM scale is calibrated on a reference auction (root
 *     `CLAUDE.md`), so what the market spends per squad is the sum of the top `teams x slots` quotations
 *     divided by the teams. Inventing a round number would have made every «crediti» figure a fiction
 *     on top of a fiction.
 *
 * What the fixture does NOT claim: the picks it pre-loads are not a prediction of anything. They are
 * made with «the dearest man this squad still needs», which is the panel's own DECLARED baseline for a
 * rival (`predictRivalPick`'s `prezzo` head) read on the only number a table publishes. It is a fixture,
 * it is not measured, and no verdict may ever be quoted off it.
 */

/**
 * The invented squads: fixed names and fixed colours, so two runs of the demo are the SAME table.
 *
 * Deterministic on purpose - `Math.random()` here would mean the operator could never point at
 * something twice, and a demo nobody can reproduce is a demo nobody can report a defect about.
 */
const DEMO_TEAMS: { label: string; colour: string }[] = [
  { label: 'Sporting Divano', colour: '#e04f5f' },
  { label: 'Real Panchina', colour: '#3f8cff' },
  { label: 'Atletico Rigore', colour: '#2fb673' },
  { label: 'Dinamo Fuorigioco', colour: '#f0a132' },
  { label: 'Union Contropiede', colour: '#9b5de5' },
  { label: 'Cucchiaio United', colour: '#00b8d9' },
  { label: 'Borussia Recupero', colour: '#e8734a' },
  { label: 'Ajax Rimborso', colour: '#5fb0b7' },
  { label: 'Tiki Taka FC', colour: '#c94f9b' },
  { label: 'Bayer Mai Vinto', colour: '#7d8b3f' },
  { label: 'Olympique Ammonito', colour: '#8a6b4f' },
  { label: 'Deportivo Sospiro', colour: '#4f6ce0' },
  { label: 'Vitesse Melina', colour: '#b7433f' },
  { label: 'Standard Tribuna', colour: '#3f9b8a' },
  { label: 'Sparta Rimessa', colour: '#a1793f' },
  { label: 'Legia Turnover', colour: '#6f5fd0' },
];

/** How many full rounds the fixture plays before handing the table over. */
export const DEMO_ROUNDS = 2;

/**
 * The round barrier of fanta-asta-live's own order rule: everybody picks once before anybody picks
 * twice. It is what the real session publishes in `options.draft.maxAheadPicks`, and the fixture
 * declares the same number it plays with.
 */
const MAX_AHEAD_PICKS = 1;

/** The listone's macro-role, in the two vocabularies the feed splits the outfield into. */
const ZONE_BY_ROLE: Record<string, Zone> = { P: 'gk', D: 'def', C: 'mid', A: 'atk' };

/** The squad slots a sheet declares, if a bundle carries none: the standard 3-8-8-6 of 25. */
const FALLBACK_SLOTS: Record<string, number> = { P: 3, D: 8, C: 8, A: 6 };

export interface DemoSession {
  players: AuctionPlayer[];
  state: RawState;
  /** Which of the invented squads the panel follows. */
  mineId: number;
}

/** A squad as the fixture plays it: a `PlanTeam` (so the real order rule reads it) plus its zone tally. */
interface DemoSquad extends PlanTeam {
  byZone: Map<Zone, number>;
}

/**
 * What one squad can spend, from the listone itself.
 *
 * The FVM is a PRICE on a scale calibrated against a reference auction, so «how much money is on this
 * table» is not a preference: it is what the market spends on the `teams x slots` men it actually
 * rosters, per squad. Rounded to fifty because a budget is a declared round number at every real table.
 */
export function demoBudget(players: AuctionPlayer[], teams: number, slots: number): number {
  if (teams <= 0 || slots <= 0) return 0;
  const rostered = players
    .map((player) => player.fvm)
    .sort((a, b) => b - a)
    .slice(0, teams * slots);
  if (!rostered.length) return 0;
  const total = rostered.reduce((sum, fvm) => sum + fvm, 0);
  return Math.max(50, Math.round(total / teams / 50) * 50);
}

/**
 * The session's `roles` block, in the vocabulary the feed counts with.
 *
 * Mantra keeps the outfield as one `mov` pool and classic splits it in three - the same asymmetry
 * `AuctionFeed.zones()` reads - so the same 3-8-8-6 is written twice in two different alphabets. Each
 * entry is the `[min, max]` pair fanta-asta-live publishes, and here the two are equal: a fixture has
 * no reason to state a range nobody set.
 */
export function demoRoles(slots: Record<string, number>, mantra: boolean): Record<string, number[]> {
  const gk = slots['P'] ?? FALLBACK_SLOTS['P'];
  const def = slots['D'] ?? FALLBACK_SLOTS['D'];
  const mid = slots['C'] ?? FALLBACK_SLOTS['C'];
  const atk = slots['A'] ?? FALLBACK_SLOTS['A'];
  const size = gk + def + mid + atk;
  const pair = (value: number) => [value, value];
  return mantra
    ? { gk: pair(gk), mov: pair(def + mid + atk), size: pair(size) }
    : { gk: pair(gk), def: pair(def), mid: pair(mid), atk: pair(atk), size: pair(size) };
}

/**
 * The listone of the demo, read from the sheet that will price it.
 *
 * Built from the SAME sheet the advice will choose, so the coverage is total by construction and the
 * demo never opens on «N giocatori su N non sono nel foglio» - a warning that would be true, useless
 * and only about the fixture.
 *
 * A man his own listone never quoted has NO price here and therefore no row: pricing him at zero would
 * put a free pick nobody could refuse at the top of every ranking, which is the «vuoto = ignoto, mai
 * zero» rule applied to a board.
 */
export function demoPlayers(
  sheet: BundleTable,
  priceOf: Map<number, number>,
  mantra: boolean,
): AuctionPlayer[] {
  const at = (name: string) => sheet.columns.indexOf(name);
  const [id, name, club, league, classic, codes] = [
    'fc_id',
    'name',
    'club',
    'league',
    'role_classic',
    'roles_mantra',
  ].map(at);
  if (id < 0 || name < 0 || classic < 0) {
    throw new Error(
      `Il foglio "${sheet.table}" non porta le colonne che servono a costruire un listone (fc_id, name, role_classic).`,
    );
  }

  const players: AuctionPlayer[] = [];
  for (const row of sheet.rows) {
    const key = Number(row[id]);
    const fvm = priceOf.get(key) ?? 0;
    if (!key || !(fvm > 0)) continue;
    const role = String(row[classic] ?? '').trim().toUpperCase();
    const zoneClassic = ZONE_BY_ROLE[role];
    if (!zoneClassic) continue;
    const mantraCodes =
      codes < 0
        ? []
        : String(row[codes] ?? '')
            .split(';')
            .map((code) => code.trim().toLowerCase())
            .filter(Boolean);
    players.push({
      id: key,
      name: String(row[name] ?? '—'),
      club: club < 0 ? '' : String(row[club] ?? ''),
      // The vocabulary the GAME scores by: mantra reads the twelve codes, classic the macro-role. The
      // live feed carries one `roles` field and what it holds for a classic session is not verified
      // here, so the demo states its own choice instead of assuming the other one.
      roles: mantra ? (mantraCodes.length ? mantraCodes : [role.toLowerCase()]) : [role],
      zoneClassic,
      zoneMantra: zoneClassic === 'gk' ? 'gk' : 'mov',
      // Never consulted: `platformOf` reads the championship only for a CUSTOM list, and the fixture
      // declares its platform outright. It travels because it is a fact about the row.
      championship: league < 0 ? null : ((row[league] as string) ?? null),
      fvm,
    });
  }
  return players;
}

/**
 * The invented table itself: squads, two rounds already played, and the order that follows from them.
 *
 * The order is NOT invented. It is recomputed with `ahead`, the platform's own comparison as this
 * project read it from fanta-asta-live's source - fewest picks first, then the cheapest squad - so the
 * demo's «Ordine di scelta» card and the sentence under it agree with each other.
 */
export function buildDemoSession(input: {
  players: AuctionPlayer[];
  teams: number;
  slots: Record<string, number>;
  mantra: boolean;
  platform: 'default' | 'euro';
  rounds?: number;
}): DemoSession {
  const teams = Math.max(2, Math.min(input.teams || DEMO_TEAMS.length, DEMO_TEAMS.length));
  const roles = demoRoles(input.slots, input.mantra);
  const size = roles['size'][0];
  const budget = demoBudget(input.players, teams, size);

  const squads: DemoSquad[] = Array.from({ length: teams }, (_, at) => ({
    id: at,
    label: DEMO_TEAMS[at].label,
    slots: [],
    held: [],
    heldIds: [],
    rosterValue: 0,
    pickValues: [],
    picksCount: 0,
    firstRoundIndex: at,
    byZone: new Map<Zone, number>(),
  }));

  // Dearest first, ties broken by id so the fixture cannot depend on the order the sheet happens to
  // carry. `find` below then reads «the best man this squad still needs».
  const board = [...input.players].sort((a, b) => b.fvm - a.fvm || a.id - b.id);
  const taken = new Set<number>();
  const picks: RawPick[] = [];
  const wants = (squad: DemoSquad, zone: Zone) =>
    (squad.byZone.get(zone) ?? 0) < (roles[zone]?.[1] ?? 0);

  const total = teams * (input.rounds ?? DEMO_ROUNDS);
  for (let index = 0; index < total; index += 1) {
    const squad = [...squads].sort((a, b) => ahead(a, b, MAX_AHEAD_PICKS))[0];
    const choice = board.find(
      (player) => !taken.has(player.id) && wants(squad, zoneOf(player, input.mantra)),
    );
    if (!choice) break;
    taken.add(choice.id);
    picks.push({ index, teamId: squad.id, playerId: choice.id, cost: choice.fvm });
    const zone = zoneOf(choice, input.mantra);
    squad.byZone.set(zone, (squad.byZone.get(zone) ?? 0) + 1);
    squad.rosterValue += choice.fvm;
    squad.pickValues.push(choice.fvm);
    squad.picksCount += 1;
  }

  const order = [...squads].sort((a, b) => ahead(a, b, MAX_AHEAD_PICKS)).map((squad) => squad.id);

  const state: RawState = {
    status: DraftStatus.Started,
    marketType: MarketType.Draft,
    playerListType: input.platform,
    settings: { budget, game: input.mantra ? GameType.Mantra : GameType.Classic, roles },
    options: { draft: { maxAheadPicks: MAX_AHEAD_PICKS } },
    teams: squads.map((squad, at) => ({
      id: squad.id,
      color: DEMO_TEAMS[at].colour,
      connection: { label: DEMO_TEAMS[at].label, active: true, host: at === 0 },
    })),
    picks,
    pickOrder: order,
    turnTeamId: order[0],
  };

  // The panel follows whoever is ON THE CLOCK, so the demo opens on the question it exists to answer -
  // «chi prendo adesso» - instead of on a squad that has nothing to decide.
  return { players: input.players, state, mineId: order[0] };
}

@Injectable({ providedIn: 'root' })
export class AuctionDemo {
  private readonly bundle = inject(Bundle);
  private readonly feed = inject(AuctionFeed);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Which sheet the invented table is played on, so the banner can NAME the listone it shows. */
  readonly sheet = signal<EngineSheetEntry | null>(null);

  async start(): Promise<boolean> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const manifest = await this.bundle.manifest();
      const sheets = manifest.engine_sheets ?? [];
      if (!sheets.length) {
        throw new Error(
          'Il bundle non porta nessun foglio del motore: senza numeri la demo mostrerebbe solo colonne vuote. ' +
            'Lancia "snapshot --league NOME" e poi "export".',
        );
      }
      // The sheet that prices the most men, so the demo shows the panel with its numbers ON. It is also
      // the one `AuctionAdvice` will re-choose by id overlap, since the listone below is built from it.
      const chosen = [...sheets].sort((a, b) => (b.priced ?? 0) - (a.priced ?? 0))[0];
      const mantra = chosen.game === 'mantra';

      const table = await this.bundle.table(chosen.path.replace(/\.json(\.gz)?$/, ''));
      const players = demoPlayers(
        table,
        await this.prices(manifest.target_season, chosen.platform, mantra),
        mantra,
      );
      if (!players.length) {
        throw new Error(
          `Nessun giocatore del foglio "${chosen.league}" è quotato sul listone ${chosen.platform} ` +
            `${manifest.target_season}: senza prezzo non c'è un tavolo da simulare.`,
        );
      }

      this.sheet.set(chosen);
      this.feed.startDemo(
        buildDemoSession({
          players,
          teams: chosen.teams ?? DEMO_TEAMS.length,
          slots: chosen.squad_slots ?? FALLBACK_SLOTS,
          mantra,
          platform: chosen.platform,
        }),
      );
      return true;
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'La modalità demo non è disponibile.',
      );
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * The FVM of the target listone, per player, on the sheet's own platform.
   *
   * The platform is part of the key and not a detail: the two listoni disagree on 226 FVM of the ~249
   * men quoted in both (root `CLAUDE.md`), so a price taken from the other one would be the ask price of
   * a different game. A man with no quote on THIS platform is simply absent, never zero.
   */
  private async prices(
    season: string,
    platform: 'default' | 'euro',
    mantra: boolean,
  ): Promise<Map<number, number>> {
    const table = await this.bundle.table('listone_quotes');
    const [id, when, where, fvm, fvmMantra] = [
      'fc_id',
      'season',
      'platform',
      'fvm',
      'fvm_mantra',
    ].map((name) => table.columns.indexOf(name));
    const column = mantra ? fvmMantra : fvm;
    const out = new Map<number, number>();
    if (id < 0 || when < 0 || where < 0 || column < 0) return out;
    for (const row of table.rows) {
      if (row[when] !== season || row[where] !== platform) continue;
      const value = Number(row[column] ?? 0);
      if (value > 0) out.set(Number(row[id]), value);
    }
    return out;
  }
}
