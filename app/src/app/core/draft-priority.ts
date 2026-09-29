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

/** A mean without its extremes, once there are ten values to trim (`TRIM`); `sorted` ascending. */
function trimmedMean(sorted: readonly number[]): number {
  const cut = Math.floor(sorted.length * TRIM);
  const kept = sorted.length >= 10 ? sorted.slice(cut, sorted.length - cut) : sorted;
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

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
   * R, the fantamedia of the hypothetical FALLBACK man a squad has for this base role: the mean of the role's
   * RESERVES, the bought men past its starters by fantamedia (`RESERVE_QUARTER`). The same for every squad.
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
 * Z IS A STARTER AND R IS A RESERVE (the operator, 29/09/2026: «Z dovrebbe rappresentare un titolare e R una
 * riserva»; R is «l'ipotetico calciatore di ripiego che puoi avere in rosa ... un fantavalore medio di basso
 * rango»). The bought men of a base role are split by FANTAMEDIA: the best `teams x places` of that role in the
 * rulebook (`slotShares`, averaged over the shapes; one door per team) are its starters, the rest its reserves.
 * Z is the trimmed mean of the starters, R the mean of the reserves - the same men and the same fantamedia, so
 * the two can be subtracted. Measured on the EuroLeghe mantra sheet before adopting it (12 teams): R - Z from
 * -0.13 (por) to -0.81 (pc), with Z 0.1-0.7 above the mean of all the bought; and the 12 real squads of
 * FA-jo5-zai, split into their best eleven and the rest, read the same direction (-0.02 to -0.60).
 * Two splits were refused on their numbers: by appearances x fantamedia, R = Z to a tenth on every role (a thin
 * man's fantamedia falls back on the role's anchor, so that rank does not separate fantamedia), and the
 * toolkit's replacement level, another population and another yardstick (on the attackers it sat ABOVE Z).
 * Where a role has no reserve at all (the league buys fewer of it than it starts) R falls back on the mean of
 * its bottom quarter (`RESERVE_QUARTER`).
 */
export const RESERVE_QUARTER = 0.25;

export function roleStats(
  everybody: readonly PriorityMan[],
  rules: MantraModules,
  size: LeagueSize,
): Map<string, RoleStat> {
  const byBase = new Map<string, PriorityMan[]>();
  for (const man of boughtMen(everybody, size)) {
    const key = baseRole(rules, man.roles, man.slot);
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key)!.push(man);
  }
  const places = slotShares(rules);
  const stats = new Map<string, RoleStat>();
  for (const [key, men] of byBase) {
    const fms = men.map((m) => m.fm!).sort((a, b) => a - b);
    const starting = Math.round(size.teams * (key === KEEPER ? 1 : (places.get(key) ?? 0)));
    const reserves = fms.slice(0, Math.max(0, fms.length - starting));
    const starters = fms.slice(reserves.length);
    const steady = men.map((m) => m.steady).filter((s): s is number => s != null).sort((a, b) => a - b);
    const low = reserves.length ? reserves : fms.slice(0, Math.max(1, Math.round(fms.length * RESERVE_QUARTER)));
    stats.set(key, {
      z: trimmedMean(starters),
      top: quantile(fms, 0.9)!,
      semi: quantile(fms, 0.7)!,
      median: quantile(fms, 0.5)!,
      p25: quantile(fms, 0.25)!,
      p10: quantile(fms, 0.1)!,
      steady: quantile(steady, 0.5) ?? 0.6,
      share: men.reduce((a, m) => a + (m.share ?? 0), 0) / men.length,
      bought: men.length,
      reserveFm: trimmedMean(low),
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

/**
 * THE DRAFT PRIORITY (the operator, 29/09/2026): `[P (Fm - Z) + (N - P) (R - Z)] / N` - the points per matchday
 * a man gives over the average man of his base role, counting that when he does not play his place goes to a
 * fallback man of low rank, worth R (`RoleStat.reserveFm`). It is a fact about the MAN, never about the squad
 * nor the picks left: it replaced the squad-level G with its look-ahead, whose faded promise charged every pick
 * the fading of the very places it filled and read below zero for nearly everybody from the 13th pick on
 * (FA-jo5-zai, 29/09). R does not read our roster either: read from our bench it credited a man with the worth
 * of a reserve the squad ALREADY had, so whoever played least ranked first (priorita-draft-v1.md §15).
 */
export function manValue(man: PriorityMan, ctx: WorthContext, matchdays: number): number | null {
  if (man.fm == null || man.share == null || !matchdays) return null;
  const s = statOf(ctx, man);
  const pv = man.share * matchdays;
  const r = s.reserveFm ?? s.p10;
  return (pv * (man.fm - s.z) + (matchdays - pv) * (r - s.z)) / matchdays;
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
}

/** The Draft Priority of every priced man of the pool, for the squad `team`, by id. */
export function priorities(state: PriorityState): Map<number, number> {
  const out = new Map<number, number>();
  for (const player of state.pool) {
    const man = state.manOf(player.id);
    if (!man) continue;
    const value = manValue(man, state.worth, state.matchdays);
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
