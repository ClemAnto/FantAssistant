/**
 * THE DRAFT PRIORITY (`docs/model/priorita-draft-v1.md`), the operator's own formula for «whom do I take now,
 * at my turn», ported from the bench policy that measured it (`toolkit/bench/draft/priority.mjs`).
 *
 *   Priority(x) = G(x) + the best G still free at our NEXT turn, having taken x.
 *
 * G is what x adds to the SQUAD, in points per matchday, and it is computed on the squad and never on the row:
 *
 *   S(squad) = SUM over the declared eleven's places of   p_h (fm_h - Z_h) + (1 - p_h) (C - Z_h)
 *              + E[R-Factor]
 *
 *   Z   = trimmed mean fantamedia of the holder's BASE role (his most defensive Mantra role), over the men a
 *         league of this size BUYS - so that a full back who scores is worth more than a winger who scores the
 *         same (the operator's example);
 *   C   = what the place yields on the days its holder has no vote: the squad's real reserves, chained, with
 *         the rulebook's -1 out of position and ZERO where nobody covers; before a reserve exists, the
 *         operator's DECLARED prior by the holder's tier (a top has an average reserve, a semi-top a poor
 *         one), fading with the picks left - a promise the draft can no longer keep is worth nothing;
 *   E[R-Factor] = the league's ladder over the eleven's sufficient men, voided by a hole: a threshold on the
 *         ELEVEN, so it can only be computed on the squad.
 *
 * The second term simulates the rivals between now and our next turn, and how many they are depends on x:
 * after the first round the order is roster FVM ascending, so a dear x sends us further down.
 *
 * THE VERDICT IT CARRIES (bench, five euro seasons, the operator's rules, 29/09/2026): +2.7% of points per
 * matchday against `pickForUs`, 5 of 5 windows on all seats, with the one-turn look-ahead up to the 7th turn.
 * That run preceded the code review of the same day, which fixed two defects of the look-ahead; the rerun is
 * the open item of §12. The operator asked for it in the app on 29/09/2026 («implementa il Draft Priority»).
 *
 * Nothing here predicts a footballer: `fm`, `share` and `steady` are the sheet's and the ratings', read and
 * never recomputed. What is deduced is about PLACES, PICKS and the rulebook - the boundary that keeps the
 * engine in the toolkit. The file imports no Angular, so the draft bench can bundle it (`appcode.mjs`).
 */

import { MantraModules, slotShares } from './auction-value';
import {
  DEFAULT_HEAD,
  PickCap,
  PlanPlayer,
  PlanTeam,
  RivalHead,
  ahead,
  capBlocks,
  predictRivalPick,
  take,
} from './auction-plan';
import { Eleven, Place, bestEleven, placesIn } from './mantra-legal';

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
export function roleStats(
  everybody: readonly PriorityMan[],
  rules: MantraModules,
  { teams, keepers, rounds }: { teams: number; keepers: number; rounds: number },
): Map<string, RoleStat> {
  const worth = (m: PriorityMan) => (m.share ?? 0) * (m.fm ?? 0);
  const priced = everybody.filter((m) => m.fm != null);
  const doors = priced.filter((m) => m.slot === KEEPER).sort((a, b) => worth(b) - worth(a));
  const field = priced.filter((m) => m.slot !== KEEPER).sort((a, b) => worth(b) - worth(a));
  const bought = [...doors.slice(0, teams * keepers), ...field.slice(0, teams * Math.max(0, rounds - keepers))];
  const byBase = new Map<string, PriorityMan[]>();
  for (const man of bought) {
    const key = baseRole(rules, man.roles, man.slot);
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key)!.push(man);
  }
  const places = slotShares(rules);
  const stats = new Map<string, RoleStat>();
  for (const [key, men] of byBase) {
    const starters = Math.round(teams * (key === KEEPER ? 1 : (places.get(key) ?? 0)));
    const reserves = [...men].sort((a, b) => worth(b) - worth(a)).slice(starters);
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

/* ---- the squad's worth ---------------------------------------------------------------------------- */

export interface WorthContext {
  rules: PriorityRules;
  stats: Map<string, RoleStat>;
  /** Picks a squad makes in the whole draft: the size of the roster. */
  rounds: number;
  /** Does the league pay the R-Factor? A declared regulation (`LeagueSettings.rFactor`). */
  rFactor: boolean;
}

function statOf(ctx: WorthContext, man: PriorityMan): RoleStat {
  return ctx.stats.get(baseRole(ctx.rules, man.roles, man.slot)) ?? { z: man.fm ?? 6, ...FALLBACK };
}

export function isTop(ctx: WorthContext, man: PriorityMan): boolean {
  return (man.fm ?? -Infinity) >= statOf(ctx, man).top;
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
export function manValue(man: PriorityMan, ctx: WorthContext, matchdays: number): number | null {
  if (man.fm == null || man.share == null || !matchdays) return null;
  const s = statOf(ctx, man);
  const pv = man.share * matchdays;
  const reserve = s.reserveFm ?? priorReserve(ctx, man);
  return (pv * (man.fm - s.z) + (matchdays - pv) * (reserve - s.z)) / matchdays;
}

/** The coverage probability the prior assumes for the R-Factor: a reserve is somebody who plays, mostly. */
export const PRIOR_COVER = 0.75;

/** The R-Factor ladder of the operator's EuroLeghe (28/09/2026): 8 -> 0.5, 9 -> 1, 10 -> 2, 11 -> 3. */
export function rFactorLadder(count: number): number {
  return count >= 11 ? 3 : count === 10 ? 2 : count === 9 ? 1 : count === 8 ? 0.5 : 0;
}

/** Exact distribution of how many of the independent men are sufficient, then the ladder's expectation. */
export function expectedRFactor(shares: readonly number[]): number {
  let dist = [1];
  for (const s of shares) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k += 1) {
      next[k] += dist[k] * (1 - s);
      next[k + 1] += dist[k] * s;
    }
    dist = next;
  }
  return dist.reduce((sum, pk, k) => sum + pk * rFactorLadder(k), 0);
}

/** How much of the declared reserve prior is still ahead: all of it until the eleven is built, none at the end. */
export function priorLeft(size: number, rounds: number, eleven = 11): number {
  return Math.max(0, Math.min(1, (rounds - size) / Math.max(1, rounds - eleven)));
}

/** The rulebook's spelling of a role, which is how the matrix is keyed. */
const CANON: Record<string, string> = { pc: 'Pc', a: 'A', t: 'T', w: 'W', c: 'C', m: 'M', e: 'E', b: 'B',
  dc: 'Dc', dd: 'Dd', ds: 'Ds', por: 'Por' };

/**
 * The malus of putting a man with `inRoles` in a place opened by a man fielded there as `outRole`: `0` no
 * penalty, `-1` out of position, `null` not allowed. A man the PLACE already lists enters free - that is what
 * «in alternativa» means, which is why every asterisk resolves to its «otherwise» branch here.
 */
export function subMalus(
  rules: PriorityRules,
  module: string,
  place: Place,
  outRole: string,
  inRoles: readonly string[],
): number | null {
  if (inRoles.some((role) => place.roles.includes(role))) return 0;
  const row = rules.substitution?.matrix?.[CANON[outRole]];
  if (!row) return null;
  let best: number | null = null;
  for (const role of inRoles) {
    const cell = row[CANON[role]];
    let malus: number | null = null;
    if (cell === 'OK') malus = 0;
    else if (cell === '-1' || cell === '**') malus = -1;
    else if (cell === '***') malus = module === '4-1-4-1' ? null : -1;
    if (malus !== null && (best === null || malus > best)) best = malus;
  }
  return best;
}

const expected = (man: PriorityMan) => (man.share ?? 0) * (man.fm ?? 0);

/**
 * THE ZERO OF A SQUAD NOBODY CAN FIELD is eleven empty places, not 0 (the code review of 29/09/2026). An empty
 * roster, or one of unpriced men only, has no eleven for `bestEleven` to return; scored 0, the first pick's G
 * carried ten faded «promise» terms its baseline did not, so the gain shown there was on another zero than
 * every later pick. The module is the first the rules declare, which is how `bestEleven` breaks its own ties.
 */
function emptyEleven(rules: PriorityRules): Eleven<PriorityMan> | null {
  const first = Object.keys(rules.modules ?? {})[0];
  const places = first ? placesIn(rules, first) : [];
  if (!places.length) return null;
  return { module: first, places, holders: places.map(() => null), men: [], total: 0, scores: [] };
}

/** What a squad is worth per matchday, against the zeros of its own roles (the header of this file). */
export function squadWorth(roster: readonly PriorityMan[], ctx: WorthContext): number {
  const { rules } = ctx;
  const phi = priorLeft(roster.length, ctx.rounds);
  const xi = bestEleven(roster, rules, expected) ?? emptyEleven(rules);
  if (!xi) return 0;
  const onPitch = new Set(xi.men.map((m) => m.id));
  const bench = roster.filter((m) => !onPitch.has(m.id));
  const used = new Set<number>();
  // The least reliable holders pick their reserves first: that is where a reserve earns most.
  const order = xi.places.map((_, i) => i).sort((a, b) =>
    (xi.holders[b] ? 1 - (xi.holders[b]!.share ?? 0) : -1) - (xi.holders[a] ? 1 - (xi.holders[a]!.share ?? 0) : -1));
  let total = 0;
  const covered: number[] = [];
  const sufficient: number[] = [];
  for (const i of order) {
    const man = xi.holders[i];
    if (!man) {
      // An EMPTY place is worth an average bought man of its role - fantamedia Z, the role's mean share, the
      // lowest tier's reserve - and that promise FADES with the picks left, down to a real hole (0 points and
      // no R-Factor) at the last pick. Scored 0 from the start, every real starter looked like a loss next to
      // leaving the place empty; never fading, the bench ended a draft with a centre back's place empty.
      const roles = xi.places[i].roles;
      const s = ctx.stats.get(baseRole(rules, roles, roles[0] ?? null)) ?? { z: 6, ...FALLBACK };
      total += phi * (1 - s.share) * (s.p10 - s.z) + (1 - phi) * (0 - s.z);
      covered.push(phi * (s.share + (1 - s.share) * PRIOR_COVER));
      sufficient.push(s.steady);
      continue;
    }
    const s = statOf(ctx, man);
    const p = man.share ?? 0;
    const fm = man.fm ?? 0;
    const place = xi.places[i];
    const as = man.roles.find((role) => place.roles.includes(role)) ?? man.roles[0];
    const chain = bench
      .filter((b) => !used.has(b.id))
      .map((b) => ({ b, malus: subMalus(rules, xi.module, place, as, b.roles) }))
      .filter((o): o is { b: PriorityMan; malus: number } => o.malus !== null)
      .sort((x, y) => (y.b.fm ?? 0) + y.malus - ((x.b.fm ?? 0) + x.malus))
      .slice(0, 2);
    // The real reserves first, chained; whatever probability they leave uncovered goes to the declared prior,
    // faded by how much draft is left to buy it. The prior IS «the reserve you will have», so it is not
    // discounted again for his own absences: PRIOR_COVER enters only the R-Factor.
    let cover = 0, coverProb = 0, coverSuff = 0, left = 1;
    for (const { b, malus } of chain) {
      const q = b.share ?? 0;
      cover += ((b.fm ?? 0) + malus) * q * left;
      coverSuff += (b.steady ?? statOf(ctx, b).steady) * q * left;
      coverProb += q * left;
      left *= 1 - q;
      used.add(b.id);
    }
    cover += left * phi * priorReserve(ctx, man);
    coverProb += left * phi * PRIOR_COVER;
    coverSuff += left * phi * s.steady * PRIOR_COVER;
    total += p * (fm - s.z) + (1 - p) * (cover - s.z);
    const cp = p + (1 - p) * coverProb;
    covered.push(cp);
    sufficient.push(cp > 0 ? (p * (man.steady ?? s.steady) + (1 - p) * coverSuff) / cp : 0);
  }
  if (!ctx.rFactor) return total;
  const allCovered = covered.reduce((a, b) => a * b, 1);
  return total + allCovered * expectedRFactor(sufficient);
}

/** The rulebook with the operator's two shapes first: a tie keeps his reference, only a better one wins. */
export function preferredRules<T extends MantraModules>(rules: T, first: readonly string[]): T {
  const modules: MantraModules['modules'] = {};
  for (const name of first) if (rules.modules[name]) modules[name] = rules.modules[name];
  for (const [name, shape] of Object.entries(rules.modules)) if (!(name in modules)) modules[name] = shape;
  return { ...rules, modules };
}

/* ---- the policy ----------------------------------------------------------------------------------- */

/** How many candidates get the look-ahead: the rest are ranked on G alone and cannot be the pick. */
export const LOOKAHEAD_K = 10;
/** The look-ahead runs while a squad has made fewer picks than this (bench: the same yield, faster). */
export const LOOKAHEAD_UNTIL = 7;
/** The declared share of a trade's worth that is expected to close (the operator: «un 50% di sconto»). */
export const TRADE_SHARE = 0.5;
export const MAX_DOUBLES = 2;
/**
 * The first of OUR calls on which a double may be advised (the operator, 29/09/2026: «consiglia doppioni solo
 * dalla 7 chiamata in poi»): before it the eleven is still being built and a bench seat is not what a pick buys.
 */
export const DOUBLES_FROM_CALL = 7;

export interface PriorityInput {
  teams: PlanTeam[];
  /** The order of the round being played, and the index of the team that is choosing (ours). */
  order: number[];
  at: number;
  pool: PlanPlayer[];
  mineId: number;
  keeperCap: number;
  maxAheadPicks: number;
  cap: PickCap | null;
  places: Map<string, number>;
  /** Everything the priority knows about a man, by id: the pool AND every squad's men. */
  manOf: (id: number) => PriorityMan | null;
  worth: WorthContext;
  /** `false` = G alone (the projection's later picks, where the look-ahead would cost seconds). */
  deep: boolean;
  doubles: boolean;
  /**
   * Each rival's head, the one the displayed round predicts him with (`simulateRound`). The look-ahead reads
   * the same map, so one rival is never assumed to take two different men in two simulations of one state.
   * Absent = everybody by price.
   */
  heads?: ReadonlyMap<number, RivalHead> | null;
  /** A man held by some squad, as a plan player: what a double can be traded FOR. Absent = the pool only. */
  playerOf?: (id: number) => PlanPlayer | null;
}

export interface PriorityRow {
  /** G(x) + the look-ahead + half a trade for a double: the number the pick is made on. */
  score: number;
  /** G(x) alone, in points per matchday. */
  gain: number;
  /** The best G still free at our next turn, when the look-ahead ran for this man. */
  next: number | null;
  /** For a man outside the ten the look-ahead ran on: the lowest look-ahead of the ten, added to his score. */
  nextFloor?: number;
  /** A DOUBLE: a top man who would not get a shirt, worth a trade at no higher FVM. */
  double: { tradeFor: PlanPlayer; bonus: number } | null;
}

/** The league's rules on WHO a squad may call now: the ceiling of the first turns and the exact doors. */
export function legalFor(team: PlanTeam, pool: readonly PlanPlayer[], input: Pick<PriorityInput,
  'cap' | 'keeperCap' | 'worth'>): PlanPlayer[] {
  const doors = team.slots.filter((slot) => slot === KEEPER).length;
  const missing = input.keeperCap - doors;
  const onlyDoors = missing > 0 && input.worth.rounds - team.picksCount <= missing;
  return pool.filter((p) => {
    if (capBlocks(team.picksCount, p.price, input.cap)) return false;
    if (p.slot === KEEPER) return doors < input.keeperCap;
    return !onlyDoors;
  });
}

/** The men worth pricing at all: per base role the best by (fm - Z) x share, plus the most reliable. */
function shortlist(pool: readonly PriorityMan[], ctx: WorthContext, per = 10, reliable = 5): PriorityMan[] {
  const byBase = new Map<string, PriorityMan[]>();
  for (const man of pool) {
    const key = baseRole(ctx.rules, man.roles, man.slot);
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key)!.push(man);
  }
  const out = new Set<PriorityMan>();
  for (const men of byBase.values()) {
    const z = (m: PriorityMan) => (m.share ?? 0) * ((m.fm ?? 0) - statOf(ctx, m).z);
    [...men].sort((a, b) => z(b) - z(a)).slice(0, per).forEach((m) => out.add(m));
    [...men].sort((a, b) => (b.share ?? 0) - (a.share ?? 0)).slice(0, reliable).forEach((m) => out.add(m));
  }
  return [...out];
}

function rosterOf(team: PlanTeam, manOf: PriorityInput['manOf']): PriorityMan[] {
  return team.heldIds.map(manOf).filter((m): m is PriorityMan => !!m);
}

const elevenIds = (roster: readonly PriorityMan[], rules: MantraModules) =>
  new Set(bestEleven(roster, rules, expected)?.men.map((m) => m.id) ?? []);

/** A DOUBLE is a top man who does NOT get a shirt: two top centre-backs a 4-2-3-1 fields are not doubles. */
function doublesIn(roster: readonly PriorityMan[], ctx: WorthContext): number {
  const starting = elevenIds(roster, ctx.rules);
  return roster.filter((m) => isTop(ctx, m) && !starting.has(m.id)).length;
}

/**
 * The priority of every man of the pool, for the team at `order[at]`.
 *
 * Every free man gets G - the list shows a number for all of them - while the look-ahead runs on the ten best
 * by G among those the rules let us call, which is where the pick is made (the bench's own cut: everybody
 * else ranks below it on G alone). A man the ceiling freezes keeps his G, because he unfreezes in a few turns.
 */
export function draftPriorities(input: PriorityInput): Map<number, PriorityRow> {
  const ctx = input.worth;
  const me = input.teams.find((team) => team.id === input.mineId);
  const out = new Map<number, PriorityRow>();
  if (!me) return out;
  const roster = rosterOf(me, input.manOf);
  const here = squadWorth(roster, ctx);
  const legal = new Set(legalFor(me, input.pool, input).map((p) => p.id));
  const gains: { player: PlanPlayer; man: PriorityMan; g: number }[] = [];
  for (const player of input.pool) {
    const man = input.manOf(player.id);
    if (!man || man.fm == null) continue;
    if (player.slot === KEEPER && me.slots.filter((s) => s === KEEPER).length >= input.keeperCap) continue;
    gains.push({ player, man, g: squadWorth([...roster, man], ctx) - here });
  }

  // The double: a top man who would stay out of our eleven, worth half of what trading him would bring.
  const bonus = new Map<number, { tradeFor: PlanPlayer; bonus: number }>();
  if (input.doubles && me.picksCount + 1 >= DOUBLES_FROM_CALL && doublesIn(roster, ctx) < MAX_DOUBLES) {
    const ours = new Set(me.heldIds);
    let trades: { player: PlanPlayer; gain: number; base: string }[] | null = null;
    const tradesOnce = () => (trades ??= (() => {
      // Everybody who is not ours, free AND held by a rival - the bench's own set (`priority.mjs`, `everybody`
      // minus ours); the pool alone left out exactly the men a trade is made with.
      const held = input.playerOf
        ? input.teams.filter((team) => team.id !== me.id).flatMap((team) => team.heldIds)
            .map(input.playerOf).filter((p): p is PlanPlayer => !!p)
        : [];
      const candidates = [...input.pool, ...held].filter((p) => !ours.has(p.id) && p.slot !== KEEPER)
        .map((p) => ({ p, man: input.manOf(p.id) }))
        .filter((o): o is { p: PlanPlayer; man: PriorityMan } => !!o.man && o.man.fm != null);
      const best = new Set(shortlist(candidates.map((o) => o.man), ctx).map((m) => m.id));
      return candidates
        .filter((o) => best.has(o.man.id) && (o.man.share ?? 0) * ((o.man.fm ?? 0) - statOf(ctx, o.man).z) > 0)
        .map((o) => ({ player: o.p, gain: squadWorth([...roster, o.man], ctx) - here,
          base: baseRole(ctx.rules, o.man.roles, o.man.slot) }))
        .sort((a, b) => b.gain - a.gain);
    })());
    for (const { player, man, g } of gains) {
      if (!legal.has(player.id) || !isTop(ctx, man)) continue;
      if (elevenIds([...roster, man], ctx.rules).has(man.id)) continue;
      const base = baseRole(ctx.rules, man.roles, man.slot);
      const trade = tradesOnce().find((t) => t.base !== base && t.player.price <= player.price);
      if (trade && trade.gain > g) bonus.set(player.id, { tradeFor: trade.player, bonus: TRADE_SHARE * (trade.gain - g) });
    }
  }

  for (const { player, g } of gains) {
    out.set(player.id, { score: g + (bonus.get(player.id)?.bonus ?? 0), gain: g, next: null,
      double: bonus.get(player.id) ?? null });
  }
  if (!input.deep || me.picksCount >= LOOKAHEAD_UNTIL || me.picksCount + 1 >= ctx.rounds) return out;

  const heads = gains.filter(({ player }) => legal.has(player.id))
    .sort((a, b) => out.get(b.player.id)!.score - out.get(a.player.id)!.score)
    .slice(0, LOOKAHEAD_K);
  let floor = Infinity;
  for (const { player } of heads) {
    const row = out.get(player.id)!;
    const next = nextBest(input, player);
    floor = Math.min(floor, next);
    out.set(player.id, { ...row, score: row.score + next, next });
  }
  // EVERYBODY ELSE CARRIES THE LOWEST LOOK-AHEAD OF THE TEN (found by the operator on Hakimi, 29/09/2026: «come
  // mai ha una PRIO bassa nonostante DP alto?»). Scored on G alone, a man just outside the ten read 17 on the
  // 0-99 scale against 50 for a head with the same DP: the gap was the next turn, not the player. The next turn
  // depends on him mostly through his price, and the floor of the ten is the conservative stand-in - a head
  // scores G + its own look-ahead >= G + the floor, so nobody outside the ten can overtake the ten.
  if (Number.isFinite(floor)) {
    const heads_ = new Set(heads.map(({ player }) => player.id));
    for (const [id, row] of out) {
      if (!heads_.has(id)) out.set(id, { ...row, score: row.score + floor, nextFloor: floor });
    }
  }
  return out;
}

/** What we could take at our NEXT turn if we took `mine` now, the rivals simulated as the round shows them. */
function nextBest(input: PriorityInput, mine: PlanPlayer): number {
  const ctx = input.worth;
  let pool = input.pool.filter((p) => p.id !== mine.id);
  const teams = new Map(input.teams.map((team) => [team.id, team]));
  teams.set(input.mineId, take(teams.get(input.mineId)!, mine));
  // The rivals as the displayed round predicts them - their head, and the tail rule counted from the end of the
  // order they call in - on the pool the league's rules leave each of them (the review of 29/09/2026: price
  // and no tail here, heads and tail in `simulateRound`, made one state two different rounds).
  const rival = (id: number, fromEnd: number) => {
    const team = teams.get(id);
    if (!team || team.picksCount >= ctx.rounds) return;
    const choice = predictRivalPick(team, legalFor(team, pool, input), input.places, input.keeperCap, fromEnd,
      input.heads?.get(id) ?? DEFAULT_HEAD, input.cap);
    if (!choice) return;
    pool = pool.filter((p) => p.id !== choice.id);
    teams.set(id, take(team, choice));
  };
  for (const [index, id] of input.order.entries()) if (index > input.at) rival(id, input.order.length - index);
  const next = [...teams.values()].sort((a, b) => ahead(a, b, input.maxAheadPicks)).map((team) => team.id);
  for (const [index, id] of next.entries()) {
    if (id === input.mineId) break;
    rival(id, next.length - index);
  }
  const me = teams.get(input.mineId)!;
  if (me.picksCount >= ctx.rounds) return 0;
  const roster = rosterOf(me, input.manOf);
  const worth = squadWorth(roster, ctx);
  const candidates = legalFor(me, pool, input).map((p) => input.manOf(p.id))
    .filter((m): m is PriorityMan => !!m && m.fm != null);
  let best = 0;
  for (const man of shortlist(candidates, ctx)) best = Math.max(best, squadWorth([...roster, man], ctx) - worth);
  return best;
}

/**
 * The pick itself: the best score among the men the rules let us call now. A shallow call (`deep: false`)
 * prices only the shortlist, the bench's own shortcut for the picks of a rollout.
 */
export function priorityPick(
  input: PriorityInput,
  /** The rows of this very state when the caller already has them (a DEEP call only): one look-ahead per state. */
  known?: Map<number, PriorityRow>,
): { player: PlanPlayer; row: PriorityRow } | null {
  const me = input.teams.find((team) => team.id === input.mineId);
  if (!me || me.picksCount >= input.worth.rounds) return null;
  const legal = legalFor(me, input.pool, input);
  let candidates = legal;
  // DEEP: the WHOLE pool goes in, because the look-ahead simulates the rivals on it - a frozen top or a door we
  // can no longer hold is still somebody a rival may take (the review of 29/09/2026); only the CHOICE is
  // restricted to what we may call. SHALLOW: no look-ahead runs, so the shortlist is the pool.
  if (!input.deep) {
    const men = legal.map((p) => input.manOf(p.id)).filter((m): m is PriorityMan => !!m && m.fm != null);
    const keep = new Set(shortlist(men, input.worth, 6, 3).map((m) => m.id));
    candidates = legal.filter((p) => keep.has(p.id));
    if (!candidates.length) candidates = legal;
  }
  const rows = (input.deep && known) || draftPriorities({ ...input, pool: input.deep ? input.pool : candidates });
  let best: { player: PlanPlayer; row: PriorityRow } | null = null;
  for (const player of candidates) {
    const row = rows.get(player.id);
    if (!row) continue;
    if (!best || row.score > best.row.score || (row.score === best.row.score && player.price > best.player.price)) {
      best = { player, row };
    }
  }
  return best;
}
