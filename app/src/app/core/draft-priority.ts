/**
 * THE DRAFT PRIORITY (`docs/model/priorita-draft-v1.md`), the operator's own formula for «whom do I take now»,
 * as he restated it on 29/09/2026 after the live draft FA-jo5-zai:
 *
 *   Priority(x) = [ P (Fm - Z) + (N - P) (R - Z) ] / N          (points per matchday)
 *
 *   P  = x's expected appearances in the competition, N its matchdays;
 *   Fm = x's expected fantamedia;
 *   Z  = the trimmed mean fantamedia of x's BASE role (his most defensive Mantra role), over the men a league
 *        of this size BUYS - so a full back who scores is worth more than a winger who scores the same;
 *   R  = the mean fantamedia of the squad's own men of that base role - who comes on when x does not play -
 *        or, with none, of the FREE men of that base role among those the league buys.
 *
 * «Quanti punti in media ti darebbe il calciatore rispetto alla media, considerando che se non gioca entra una
 * riserva». It REPLACED the squad-level G with its one-turn look-ahead and its doubles bonus: on the real draft
 * that G charged every pick the fading of the reserve promise of the very places it filled, so from the 13th
 * pick on nearly every free man read below zero and the column showed 0 or nothing (priorita-draft-v1.md §13).
 * The consequences of a pick on the ORDER are not in this number: they are what the scenarios are for.
 *
 * Nothing here predicts a footballer: `fm` and `share` are the sheet's, read and never recomputed. The file
 * imports no Angular.
 */

import { MantraModules, slotShares } from './auction-value';
import { PickCap, PlanPlayer, PlanTeam, capBlocks } from './auction-plan';
import { bestEleven } from './mantra-legal';

/** A man as the priority reads him. `share` = expected appearances over the season's matchdays. */
export interface PriorityMan {
  id: number;
  /** Lowercase Mantra codes, the vocabulary legality is decided in. */
  roles: string[];
  slot: string | null;
  price: number;
  fm: number | null;
  share: number | null;
  /** Share of his votes with a BASE vote of 6 or more: what the R-Factor counts. Null = unknown. */
  steady: number | null;
}

/** The rulebook as the priority needs it: the places, and the substitution matrix with its -1. */
export interface PriorityRules extends MantraModules {
  substitution?: { matrix?: Record<string, Record<string, string>> };
}

/* ---- the base role, and the statistics of each over the men the league buys ------------------------- */

const LINE_DEPTH: Record<string, number> = { D: 1, M: 2, T: 3, A: 4 };
const KEEPER = 'por';

/**
 * The deepest LINE the rulebook ever puts each role in, READ from the rulebook («more defensive is MEASURED on
 * the rulebook, never a hand-written list»), ties broken by the order the rulebook declares its roles in.
 */
function depthsOf(rules: MantraModules): { depth: Map<string, number>; order: string[] } {
  const depth = new Map<string, number>([[KEEPER, 0]]);
  for (const shape of Object.values(rules.modules ?? {})) {
    for (const [line, slots] of Object.entries(shape)) {
      for (const slot of slots) {
        for (const role of rules.slot_roles[slot] ?? []) {
          const key = role.toLowerCase();
          depth.set(key, Math.min(depth.get(key) ?? Infinity, LINE_DEPTH[line] ?? Infinity));
        }
      }
    }
  }
  return { depth, order: (rules.roles ?? []).map((role) => role.toLowerCase()) };
}

const depthCache = new WeakMap<MantraModules, ReturnType<typeof depthsOf>>();

/** A man's BASE role: his most defensive Mantra code. */
export function baseRole(rules: MantraModules, roles: readonly string[], slot: string | null): string {
  let entry = depthCache.get(rules);
  if (!entry) depthCache.set(rules, (entry = depthsOf(rules)));
  const { depth, order } = entry;
  const known = roles.filter((role) => depth.has(role));
  if (!known.length) return slot ?? roles[0] ?? '';
  return known.reduce((best, role) => {
    const d = depth.get(role)!, b = depth.get(best)!;
    return d < b || (d === b && order.indexOf(role) < order.indexOf(best)) ? role : best;
  });
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** The trimmed mean drops this share at EACH end (the operator: «scarta i valori estremi»). */
export const TRIM = 0.1;

export interface RoleStat {
  z: number;
  top: number;
  semi: number;
  median: number;
  p25: number;
  p10: number;
  steady: number;
  /** The mean share of the calendar a bought man of this role plays: what an empty place is promised. */
  share: number;
  bought: number;
  /**
   * THE MEAN FANTAMEDIA OF THE ROLE'S RESERVES (the operator, 29/09/2026: «nella colonna DP R è la fantamedia
   * media delle RISERVE»): the bought men of this base role past the ones the league STARTS there - `teams` x
   * the role's places in the rulebook, averaged over the shapes (`slotShares`), one door per team. Null where
   * the league buys no reserve of that role. Read by DP only: the pick keeps the tier prior of §2.
   */
  reserveFm: number | null;
}

/**
 * Z, the tier cut-offs and the tier priors of every base role, over the men a league of this size BUYS.
 *
 * The operator, 28/09/2026: «Z va valutato prendendo solo i calciatori acquistabili da una lega a 12 squadre e
 * non tutti quelli nella lista». Mantra has no quota per role, so «bought» is read the only way that needs no
 * split: the `teams x outfield` best outfield men by what they are expected to give (share x fm), and the
 * `teams x keepers` best doors. Who the caller hands in is the POPULATION - the app leaves out the excluded
 * clubs and the heavily injured, which the bench's historical windows cannot date.
 */
export interface LeagueSize {
  teams: number;
  keepers: number;
  rounds: number;
}

/** The men a league of this size BUYS (see `roleStats`): the population of Z, and of R among the free. */
export function boughtMen(everybody: readonly PriorityMan[], { teams, keepers, rounds }: LeagueSize): PriorityMan[] {
  const worth = (m: PriorityMan) => (m.share ?? 0) * (m.fm ?? 0);
  const priced = everybody.filter((m) => m.fm != null);
  const doors = priced.filter((m) => m.slot === KEEPER).sort((a, b) => worth(b) - worth(a));
  const field = priced.filter((m) => m.slot !== KEEPER).sort((a, b) => worth(b) - worth(a));
  return [...doors.slice(0, teams * keepers), ...field.slice(0, teams * Math.max(0, rounds - keepers))];
}

/**
 * The bought men of each base role, and among them the RESERVES: those past the ones the league STARTS there -
 * `teams` x the role's places in the rulebook, averaged over the shapes (`slotShares`), one door per team.
 * One split for the DP's R, the Draft Priority's free R and the role statistics.
 */
function splitBought(
  everybody: readonly PriorityMan[],
  rules: MantraModules,
  size: LeagueSize,
): Map<string, { men: PriorityMan[]; reserves: PriorityMan[] }> {
  const worth = (m: PriorityMan) => (m.share ?? 0) * (m.fm ?? 0);
  const byBase = new Map<string, PriorityMan[]>();
  for (const man of boughtMen(everybody, size)) {
    const key = baseRole(rules, man.roles, man.slot);
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key)!.push(man);
  }
  const places = slotShares(rules);
  const out = new Map<string, { men: PriorityMan[]; reserves: PriorityMan[] }>();
  for (const [key, men] of byBase) {
    const starters = Math.round(size.teams * (key === KEEPER ? 1 : (places.get(key) ?? 0)));
    out.set(key, { men, reserves: [...men].sort((a, b) => worth(b) - worth(a)).slice(starters) });
  }
  return out;
}

/** The men of RESERVE rank a league of this size buys (`splitBought`): among the free, the population of R. */
export function leagueReserves(everybody: readonly PriorityMan[], rules: MantraModules, size: LeagueSize): PriorityMan[] {
  return [...splitBought(everybody, rules, size).values()].flatMap((one) => one.reserves);
}

export function roleStats(
  everybody: readonly PriorityMan[],
  rules: MantraModules,
  size: LeagueSize,
): Map<string, RoleStat> {
  const stats = new Map<string, RoleStat>();
  for (const [key, { men, reserves }] of splitBought(everybody, rules, size)) {
    const fms = men.map((m) => m.fm!).sort((a, b) => a - b);
    const cut = Math.floor(fms.length * TRIM);
    const kept = fms.length >= 10 ? fms.slice(cut, fms.length - cut) : fms;
    const steady = men.map((m) => m.steady).filter((s): s is number => s != null).sort((a, b) => a - b);
    stats.set(key, {
      z: kept.reduce((a, b) => a + b, 0) / kept.length,
      top: quantile(fms, 0.9)!,
      semi: quantile(fms, 0.7)!,
      median: quantile(fms, 0.5)!,
      p25: quantile(fms, 0.25)!,
      p10: quantile(fms, 0.1)!,
      steady: quantile(steady, 0.5) ?? 0.6,
      share: men.reduce((a, m) => a + (m.share ?? 0), 0) / men.length,
      bought: men.length,
      reserveFm: reserves.length ? reserves.reduce((a, m) => a + m.fm!, 0) / reserves.length : null,
    });
  }
  return stats;
}

const FALLBACK: Omit<RoleStat, 'z'> = { top: Infinity, semi: Infinity, median: 6, p25: 5.8, p10: 5.6, steady: 0.6,
  share: 0.75, bought: 0, reserveFm: null };

/* ---- the value of a man ---------------------------------------------------------------------------- */

export interface WorthContext {
  rules: PriorityRules;
  stats: Map<string, RoleStat>;
}

function statOf(ctx: WorthContext, man: PriorityMan): RoleStat {
  return ctx.stats.get(baseRole(ctx.rules, man.roles, man.slot)) ?? { z: man.fm ?? 6, ...FALLBACK };
}

/** The operator's declared prior for a place with no reserve yet, by the holder's tier (90th/70th pct). */
function priorReserve(ctx: WorthContext, man: PriorityMan): number {
  const s = statOf(ctx, man);
  const fm = man.fm ?? -Infinity;
  if (fm >= s.top) return s.median;
  if (fm >= s.semi) return s.p25;
  return s.p10;
}

/**
 * A MAN'S OWN value, the formula of §2 on its own row: `[Pv (FM - Z) + (N - Pv) (R - Z)] / N`, i.e. in
 * fantapunti PER MATCHDAY (the operator, 29/09/2026: «devono essere per giornata, dividi il risultato per N»). It is what the «Previste» view shows as DP (the operator, 29/09/2026), and R is his definition for
 * that column: the mean fantamedia of the RESERVES of his base role (`RoleStat.reserveFm`), falling back to the
 * tier prior where the league buys none. The PICK is made on the squad's G, where a real reserve replaces both.
 */
export function manValue(
  man: PriorityMan,
  ctx: WorthContext,
  matchdays: number,
  /** R when the caller knows it (the Draft Priority's own, `reserveOf`); absent = the DP column's R. */
  reserve?: number | null,
): number | null {
  if (man.fm == null || man.share == null || !matchdays) return null;
  const s = statOf(ctx, man);
  const pv = man.share * matchdays;
  const r = reserve ?? s.reserveFm ?? priorReserve(ctx, man);
  return (pv * (man.fm - s.z) + (matchdays - pv) * (r - s.z)) / matchdays;
}

/**
 * R OF THE DRAFT PRIORITY (the operator, 29/09/2026): «R deve essere sempre inteso come un calciatore di rango
 * inferiore che non appartiene all'11 titolare». So R is the mean fantamedia of the squad's men of the
 * candidate's base role who are NOT in its best legal eleven - who really comes on when he misses a match -
 * and, with none, of the free men of that base role of RESERVE rank (`leagueReserves`). Read literally as «every
 * man of the base role», R after Kane was Kane himself, and a centre-forward who never plays scored highest
 * because Kane «covered» the matches he missed (FA-jo5-zai: Moumbagna, 2 of FVM, first advice from the 84th
 * pick to the end). The candidate is never his own reserve. Null = nobody of that rank: the caller falls back
 * to the league's reserve mean (`RoleStat.reserveFm`).
 */
export function reserveOf(
  man: PriorityMan,
  rules: MantraModules,
  bench: readonly PriorityMan[],
  freeReserves: readonly PriorityMan[],
): number | null {
  const base = baseRole(rules, man.roles, man.slot);
  const mean = (men: readonly PriorityMan[]) => {
    const fms = men.filter((m) => m.id !== man.id && m.fm != null
      && baseRole(rules, m.roles, m.slot) === base).map((m) => m.fm!);
    return fms.length ? fms.reduce((a, b) => a + b, 0) / fms.length : null;
  };
  return mean(bench) ?? mean(freeReserves);
}

const expected = (man: PriorityMan) => (man.share ?? 0) * (man.fm ?? 0);

/** The squad's men who are NOT in its best legal eleven: where R is read first. */
export function benchOf(roster: readonly PriorityMan[], rules: MantraModules): PriorityMan[] {
  const starting = new Set(bestEleven(roster, rules, expected)?.men.map((m) => m.id) ?? []);
  return roster.filter((m) => !starting.has(m.id));
}

/**
 * THE DRAFT PRIORITY (the operator, 29/09/2026): `[P (Fm - Z) + (N - P) (R - Z)] / N` - the points per matchday
 * a man gives over the average man of his base role, counting that a reserve comes on when he does not play.
 * It is a fact about the MAN and the squad's reserves, never about the whole squad nor the picks left: it
 * replaced the squad-level G with its look-ahead, whose faded promise charged every pick the fading of the
 * very places it filled and read below zero for nearly everybody from the 13th pick on (FA-jo5-zai, 29/09).
 */
export function draftPriority(
  man: PriorityMan,
  ctx: WorthContext,
  matchdays: number,
  bench: readonly PriorityMan[],
  freeReserves: readonly PriorityMan[],
): number | null {
  return manValue(man, ctx, matchdays, reserveOf(man, ctx.rules, bench, freeReserves));
}

/** The rulebook with the operator's two shapes first: a tie keeps his reference, only a better one wins. */
export function preferredRules<T extends MantraModules>(rules: T, first: readonly string[]): T {
  const modules: MantraModules['modules'] = {};
  for (const name of first) if (rules.modules[name]) modules[name] = rules.modules[name];
  for (const [name, shape] of Object.entries(rules.modules)) if (!(name in modules)) modules[name] = shape;
  return { ...rules, modules };
}

/* ---- the policy ----------------------------------------------------------------------------------- */

/** Who may be called and how: the ceiling of the first turns and the exact doors (`legalFor`). */
export interface CallRules {
  cap: PickCap | null;
  keeperCap: number;
  /** Picks a squad makes in the whole draft. */
  rounds: number;
}

/** The league's rules on WHO a squad may call now: the ceiling of the first turns and the exact doors. */
export function legalFor(team: PlanTeam, pool: readonly PlanPlayer[], rules: CallRules): PlanPlayer[] {
  const doors = team.slots.filter((slot) => slot === KEEPER).length;
  const missing = rules.keeperCap - doors;
  const onlyDoors = missing > 0 && rules.rounds - team.picksCount <= missing;
  return pool.filter((p) => {
    if (capBlocks(team.picksCount, p.price, rules.cap)) return false;
    if (p.slot === KEEPER) return doors < rules.keeperCap;
    return !onlyDoors;
  });
}

export interface PriorityState {
  team: PlanTeam;
  pool: readonly PlanPlayer[];
  /** Everything the priority knows about a man, by id: the pool AND every squad's men. */
  manOf: (id: number) => PriorityMan | null;
  worth: WorthContext;
  matchdays: number;
  /** The men of reserve rank a league of this size buys (`leagueReserves`): among the free, R's population. */
  reserves: ReadonlySet<number>;
}

/** The Draft Priority of every priced man of the pool, for the squad `team`, by id. */
export function priorities(state: PriorityState): Map<number, number> {
  const roster = state.team.heldIds.map(state.manOf).filter((m): m is PriorityMan => !!m);
  const bench = benchOf(roster, state.worth.rules);
  const freeReserves = state.pool.filter((p) => state.reserves.has(p.id)).map((p) => state.manOf(p.id))
    .filter((m): m is PriorityMan => !!m);
  const out = new Map<number, number>();
  for (const player of state.pool) {
    const man = state.manOf(player.id);
    if (!man) continue;
    const value = draftPriority(man, state.worth, state.matchdays, bench, freeReserves);
    if (value != null) out.set(player.id, value);
  }
  return out;
}

/** The pick: the highest Draft Priority among the men the rules let the squad call now. */
export function priorityPick(state: PriorityState, rules: CallRules): PlanPlayer | null {
  const scores = priorities(state);
  let best: PlanPlayer | null = null;
  for (const player of legalFor(state.team, state.pool, rules)) {
    const score = scores.get(player.id);
    if (score == null) continue;
    const top = best ? scores.get(best.id)! : -Infinity;
    if (score > top || (score === top && best && player.price > best.price)) best = player;
  }
  return best;
}
