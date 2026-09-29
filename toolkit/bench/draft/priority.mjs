/* The DRAFT PRIORITY (`docs/model/priorita-draft-v1.md`), as a bench policy. A CANDIDATE: it lives here
 * until it wins, or loses by little and the operator decides (his instruction, 28/09/2026).
 *
 *   Priority(x) = G(x) + the best G still free at our NEXT turn, having taken x.
 *
 * G is what x adds to the SQUAD, in points per matchday, and it is computed on the squad and not on the row:
 *
 *   S(squad) = SUM over the declared eleven's places of   p_h (fm_h - Z_h) + (1 - p_h) (C - Z_h)
 *              + E[R-Factor]
 *
 *   Z   = trimmed mean fantamedia of the holder's BASE role (his most defensive Mantra role), so that a full
 *         back who scores is worth more than a winger who scores the same (the operator's example);
 *   C   = what the place yields on the days its holder has no vote: the squad's real reserves for it, chained
 *         (the best, then the next when the best has no vote either), with the -1 out-of-position malus and
 *         ZERO for a place nobody covers; before any reserve exists, the operator's DECLARED prior by the
 *         holder's tier (a top has an average reserve, a semi-top a poor one);
 *   E[R-Factor] = the ladder 8/9/10/11 -> 0.5/1/2/3 over the eleven's sufficient men, voided by a hole -
 *         a threshold on the ELEVEN, so it can only be computed on the squad.
 *
 * The second term is the operator's point 2 in its exact form: the rivals between now and our next turn are
 * SIMULATED, and how many they are depends on x, because the order after the first round is roster value
 * ascending - a dear x sends us further down.
 *
 * The DOUBLE (at most two a squad, top tier only) is worth G(x) plus half of what trading it would bring: the
 * G of the best man of ANOTHER base role at a price no higher than x's. Half is his declared estimate of how
 * often such a trade closes. Nothing here measures a trade. */
import { readFileSync } from 'node:fs';

import { bestEleven } from './appcode.mjs';
import { ahead, appNeed, bestUnder, legalPoolFor } from './engine.mjs';
import { config } from './paths.mjs';
import { R_FACTOR, subMalus } from './lineup.mjs';

/* ---- the base role, and the population statistics of each ---------------------------------------- */

/**
 * The deepest LINE the rulebook ever puts a role in, READ from the rulebook (pagina-strategia-v1.md §8: «more
 * defensive is MEASURED on the rulebook, never a hand-written list»), ties broken by the order the rulebook
 * declares its roles in - the same measure as the app's `strategy.deepestRole`. Read here rather than imported
 * because that function lives in a file that bundles half the app.
 */
const RULEBOOK = JSON.parse(readFileSync(config('mantra_modules.json'), 'utf8'));
const LINE_DEPTH = { D: 1, M: 2, T: 3, A: 4 };
const DEPTH = { por: 0 };
for (const shape of Object.values(RULEBOOK.modules)) {
  for (const [line, slots] of Object.entries(shape)) {
    for (const slot of slots) {
      for (const role of RULEBOOK.slot_roles[slot] ?? []) {
        const key = role.toLowerCase();
        DEPTH[key] = Math.min(DEPTH[key] ?? Infinity, LINE_DEPTH[line] ?? Infinity);
      }
    }
  }
}
const ORDER = RULEBOOK.roles.map((role) => role.toLowerCase());

export const baseRole = (man) => {
  const roles = man.roles.filter((role) => role in DEPTH);
  if (!roles.length) return man.slot;
  return roles.reduce((best, role) => (DEPTH[role] < DEPTH[best]
    || (DEPTH[role] === DEPTH[best] && ORDER.indexOf(role) < ORDER.indexOf(best)) ? role : best));
};

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
};

/** The trimmed mean drops this share at EACH end (the operator: «scarta i valori estremi»). */
export const TRIM = 0.1;

/**
 * Z, the tier cut-offs and the tier priors of every base role, over the men a league of this size BUYS.
 *
 * The operator, 28/09/2026: «Z va valutato prendendo solo i calciatori acquistabili da una lega a 12 squadre
 * e non tutti quelli nella lista». Mantra has no quota per role, so «bought» is read the only way that needs
 * no split: the `teams x outfield` best outfield men by what they are expected to give (p x fm), and the
 * `teams x keepers` best doors. A man outside that set is not the average of anybody's role - he is who
 * nobody rosters. The heavily injured have no dated spell in these windows to exclude them by; the ones who
 * will barely play fall out of the bought set by themselves, which is stated rather than hidden.
 */
const statsCache = new WeakMap();
/** The same statistics, computed once per window: pool plus rosters is the same set all draft long. */
export function roleStatsOnce(everybody, options) {
  const key = everybody.reduce((a, m) => (a && a.id < m.id ? a : m), null);
  let entry = key && statsCache.get(key);
  if (!entry || entry.n !== everybody.length) {
    entry = { n: everybody.length, stats: roleStats(everybody, options) };
    if (key) statsCache.set(key, entry);
  }
  return entry.stats;
}

export function roleStats(everybody, { teams = 12, keepers = 2, rounds = 32, keeperSlot = 'por' } = {}) {
  const worth = (m) => (m.p ?? 0) * (m.fm_pred ?? 0);
  const priced = everybody.filter((m) => m.fm_pred != null);
  const doors = priced.filter((m) => m.slot === keeperSlot).sort((a, b) => worth(b) - worth(a));
  const field = priced.filter((m) => m.slot !== keeperSlot).sort((a, b) => worth(b) - worth(a));
  const bought = [...doors.slice(0, teams * keepers), ...field.slice(0, teams * (rounds - keepers))];
  const byBase = new Map();
  for (const man of bought) {
    const key = baseRole(man);
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key).push(man);
  }
  const stats = new Map();
  for (const [key, men] of byBase) {
    const fms = men.map((m) => m.fm_pred).sort((a, b) => a - b);
    const cut = Math.floor(fms.length * TRIM);
    const kept = fms.length >= 10 ? fms.slice(cut, fms.length - cut) : fms;
    const steady = men.map((m) => m.steady).filter((s) => s != null).sort((a, b) => a - b);
    stats.set(key, {
      z: kept.reduce((a, b) => a + b, 0) / kept.length,
      top: quantile(fms, 0.9), semi: quantile(fms, 0.7),
      median: quantile(fms, 0.5), p25: quantile(fms, 0.25), p10: quantile(fms, 0.1),
      steady: quantile(steady, 0.5) ?? 0.6,
      share: men.reduce((a, m) => a + (m.p ?? 0), 0) / men.length,
      bought: men.length,
    });
  }
  return stats;
}

const statOf = (stats, man) => stats.get(baseRole(man)) ?? { z: man.fm_pred ?? 6, median: 6, p25: 5.8, p10: 5.6,
  top: Infinity, semi: Infinity, steady: 0.6 };

export const isTop = (stats, man) => (man.fm_pred ?? -Infinity) >= statOf(stats, man).top;

/** The operator's declared prior for a place with no reserve yet: «a TOP has an average reserve, a SEMITOP a
 *  poor one, and so on». The tiers are the fantamedia percentiles of the base role, 90 and 70. */
export function priorReserve(stats, man) {
  const s = statOf(stats, man);
  const fm = man.fm_pred ?? -Infinity;
  if (fm >= s.top) return s.median;
  if (fm >= s.semi) return s.p25;
  return s.p10;
}

/** The coverage probability the prior assumes for the R-Factor: a reserve is somebody who plays, mostly. */
export const PRIOR_COVER = 0.75;

/* ---- the squad's worth ---------------------------------------------------------------------------- */

/** The rulebook with the operator's two shapes first: a tie keeps his reference, only a better one wins. */
export function preferredRules(rules, first = ['4-2-3-1', '4-1-4-1']) {
  const modules = {};
  for (const name of first) if (rules.modules[name]) modules[name] = rules.modules[name];
  for (const [name, shape] of Object.entries(rules.modules)) if (!(name in modules)) modules[name] = shape;
  return { ...rules, modules };
}

/** Exact distribution of how many of the independent men are sufficient, then the ladder's expectation. */
function expectedRFactor(shares) {
  let dist = [1];
  for (const s of shares) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k += 1) {
      next[k] += dist[k] * (1 - s);
      next[k + 1] += dist[k] * s;
    }
    dist = next;
  }
  return dist.reduce((sum, pk, k) => sum + pk * R_FACTOR(k), 0);
}

/**
 * How much of the declared reserve prior is still ahead of us: all of it before the eleven is built, none of it
 * when the last pick is gone. The prior is a promise that a reserve WILL be bought, and a promise the draft can
 * no longer keep is worth nothing - without this fade any real reserve read worse than the imaginary one
 * (the second run bought centre-forwards from the twelfth pick on, because they changed nothing and every
 * real defender lowered the squad below its own prior).
 */
export const priorLeft = (size, rounds, eleven = 11) =>
  Math.max(0, Math.min(1, (rounds - size) / Math.max(1, rounds - eleven)));

export function squadWorth(roster, ctx) {
  const { rules, stats } = ctx;
  const phi = priorLeft(roster.length, ctx.rounds ?? 32);
  const xi = bestEleven(roster, rules, (man) => (man.p ?? 0) * (man.fm_pred ?? 0));
  if (!xi) return 0;
  const onPitch = new Set(xi.men.map((m) => m.id));
  const bench = roster.filter((m) => !onPitch.has(m.id));
  const used = new Set();
  // The least reliable holders pick their reserves first: that is where a reserve earns most.
  const order = xi.places.map((_, i) => i)
    .sort((a, b) => ((xi.holders[b] ? 1 - (xi.holders[b].p ?? 0) : -1)
      - (xi.holders[a] ? 1 - (xi.holders[a].p ?? 0) : -1)));
  let total = 0;
  const covered = [], sufficient = [];
  for (const i of order) {
    const man = xi.holders[i];
    if (!man) {
      // An EMPTY place is not worth zero: the draft will fill it, with a man the league buys anyway. So it is
      // worth what an AVERAGE bought man of its role gives - his fantamedia is Z by definition, he plays the
      // role's mean share of the calendar, and his missing days go to the lowest tier's reserve. Scoring it
      // 0 instead made every real starter look like a LOSS next to leaving the place empty, and the first
      // run built squads of centre-forwards with 63% of the places uncovered.
      //
      // And that promise FADES like the reserve prior: with no picks left an empty place is a HOLE - zero
      // points, so -Z against the role's average, and no R-Factor. Without the fade an empty place read as an
      // average man to the very last pick, and on a capped window the priority ended a draft with a centre
      // back's place empty all season (93 holes: it had bought Lewandowski and Kane instead).
      const s = stats.get(baseRole({ roles: xi.places[i].roles, slot: xi.places[i].roles[0] }))
        ?? { z: 6, p10: 5.6, share: 0.75, steady: 0.6 };
      total += phi * (1 - s.share) * (s.p10 - s.z) + (1 - phi) * (0 - s.z);
      covered.push(phi * (s.share + (1 - s.share) * PRIOR_COVER));
      sufficient.push(s.steady);
      continue;
    }
    const s = statOf(stats, man);
    const p = man.p ?? 0;
    const fm = man.fm_pred ?? 0;
    const place = xi.places[i];
    const as = man.roles.find((role) => place.roles.includes(role)) ?? man.roles[0];
    const chain = bench
      .filter((b) => !used.has(b.id))
      .map((b) => ({ b, malus: subMalus(rules, xi.module, place, as, b.roles) }))
      .filter((o) => o.malus !== null)
      .sort((x, y) => (y.b.fm_pred ?? 0) + y.malus - ((x.b.fm_pred ?? 0) + x.malus))
      .slice(0, 2);
    // The real reserves first, chained; whatever probability they leave uncovered goes to the operator's
    // declared R (the reserve's fantavalore by the holder's tier), faded by how much draft is left to buy it.
    // R is not discounted again for the days that reserve might miss - it already IS «the reserve you will
    // have»; PRIOR_COVER enters only the R-Factor, which needs a probability and not a value.
    let cover = 0, coverProb = 0, coverSuff = 0, left = 1;
    for (const { b, malus } of chain) {
      const q = b.p ?? 0;
      cover += ((b.fm_pred ?? 0) + malus) * q * left;
      coverSuff += (b.steady ?? statOf(stats, b).steady) * q * left;
      coverProb += q * left;
      left *= 1 - q;
      used.add(b.id);
    }
    cover += left * phi * priorReserve(stats, man);
    coverProb += left * phi * PRIOR_COVER;
    coverSuff += left * phi * s.steady * PRIOR_COVER;
    total += p * (fm - s.z) + (1 - p) * (cover - s.z);
    const cp = p + (1 - p) * coverProb;
    covered.push(cp);
    sufficient.push(cp > 0 ? (p * (man.steady ?? s.steady) + (1 - p) * coverSuff) / cp : 0);
  }
  const allCovered = covered.reduce((a, b) => a * b, 1);
  return total + allCovered * expectedRFactor(sufficient);
}

/* ---- the policy ----------------------------------------------------------------------------------- */

/** How many candidates get the look-ahead: the rest are ranked on G alone and cannot win. */
export const LOOKAHEAD_K = 10;
/** The declared share of a trade's worth that is expected to close (the operator: «un 50% di sconto»). */
export const TRADE_SHARE = 0.5;
export const MAX_DOUBLES = 2;

/** The men worth pricing at all: per base role the best by (fm - Z) x p, plus the most reliable. */
function shortlist(pool, stats, per = 10, reliable = 5) {
  const byBase = new Map();
  for (const man of pool) {
    const key = baseRole(man);
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key).push(man);
  }
  const out = new Set();
  for (const [, men] of byBase) {
    const z = (m) => (m.p ?? 0) * ((m.fm_pred ?? 0) - statOf(stats, m).z);
    [...men].sort((a, b) => z(b) - z(a)).slice(0, per).forEach((m) => out.add(m));
    [...men].sort((a, b) => (b.p ?? 0) - (a.p ?? 0)).slice(0, reliable).forEach((m) => out.add(m));
  }
  return [...out];
}

/** Who stands in the declared eleven of this squad: the double question is «does he get a shirt?». */
const elevenIds = (roster, rules) =>
  new Set(bestEleven(roster, rules, (man) => (man.p ?? 0) * (man.fm_pred ?? 0))?.men.map((m) => m.id) ?? []);

/**
 * A DOUBLE is a top-tier man who does NOT get a shirt in the declared eleven - his place is held by somebody
 * at least as good. Two top centre-backs who both start are not a double: a 4-2-3-1 fields two. Counted on
 * the squad as it stands, so the cap of two reads the doubles already held, not the top men.
 */
function doublesIn(roster, stats, rules) {
  const starting = elevenIds(roster, rules);
  return roster.filter((m) => isTop(stats, m) && !starting.has(m.id)).length;
}

/**
 * `options.lookahead` false = G alone (the ablation that says what the look-ahead is worth);
 * `options.doubles` false = no double rule; `options.log` receives one line per pick of ours.
 */
export function priority(options = {}) {
  const { lookahead = true, doubles = true, first = ['4-2-3-1', '4-1-4-1'], depth = 1 } = options;
  // `turns` (a number, or a function of the squad) = how many of OUR turns a candidate is judged over, the
  // current one included: 1 = G alone, 2+ = the rollout. `stayTop` = {rank, penalty, until}: while the squad
  // holds no man at `cap.fvm`+ (a «supertop»), a candidate whose rollout lands us past `rank` in the order of
  // the round the ceiling opens is charged `penalty` - the operator's «rimanere nei primi 3».
  const { turns = null, stayTop = null } = options;
  // `rivals`: how the rollout predicts a rival's pick. null = everybody by price (the default so far);
  // 'infer' = read each rival's head off his own picks; a function (teamId) -> quality = an ORACLE (the
  // bench knows the true heads - the ceiling of what prediction can buy, not something a table allows).
  const { rivals = null } = options;
  const HEADS = { price: (p) => p.price, value: (p) => p.value ?? 0, surplus: (p) => p.surplus ?? 0 };
  /**
   * A rival's head, read off his picks: for each head, the mean percentile his picks take in the whole
   * listone under that head's own ranking; the head that ranks them highest is the one he is using. Below
   * two picks there is nothing to read and he is taken to draft by price, the commonest head at a table.
   */
  const inferHead = (team, everybody) => {
    if (team.roster.length < 2) return 'price';
    let best = 'price', bestScore = -Infinity;
    for (const [name, of] of Object.entries(HEADS)) {
      const sorted = everybody.map(of).sort((a, b) => a - b);
      const pct = (x) => { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; } return lo / sorted.length; };
      const score = team.roster.reduce((sum, m) => sum + pct(of(m)), 0) / team.roster.length;
      if (score > bestScore + 1e-9) { best = name; bestScore = score; }
    }
    return best;
  };
  const cache = new WeakMap();
  let rulesCache = null;

  const evaluate = (ctx) => {
    const team = ctx.team;
    const everybody = [...ctx.pool, ...(ctx.table ?? []).flatMap((t) => t.roster)];
    const stats = roleStatsOnce(everybody, { teams: ctx.teams, keepers: ctx.keepers, rounds: ctx.rounds,
      keeperSlot: ctx.keeperSlot ?? 'por' });
    if (!rulesCache || rulesCache.src !== ctx.shapes) rulesCache = { src: ctx.shapes, rules: preferredRules(ctx.shapes, first) };
    const wctx = { rules: rulesCache.rules, stats, rounds: ctx.rounds };
    const here = squadWorth(team.roster, wctx);
    const gainOf = (roster, worth, man) => squadWorth([...roster, man], wctx) - worth;
    const keeperSlot = ctx.keeperSlot ?? 'por';
    const keepers = team.slots.filter((s) => s === keeperSlot).length;
    // The roster is EXACTLY `keepers` doors plus the rest outfield (the regulation: 2 porte + 30), so once the
    // picks left are the doors still missing, only a door is legal - and once the outfield is full, likewise.
    const left = ctx.rounds - team.picksCount;
    const doorsMissing = ctx.keepers - keepers;
    const onlyDoors = doorsMissing > 0 && left <= doorsMissing;
    const legal = (m) => (m.slot === keeperSlot ? keepers < ctx.keepers : !onlyDoors);
    // Candidates from the pool the RULES leave us, the ceiling of the first turns included: scoring frozen men
    // spent the whole look-ahead on names that could not be called (the review of 29/09/2026).
    const short = shortlist(legalPoolFor(team, ctx.pool, ctx.setup), stats).filter(legal);
    const scored = short.map((man) => ({ man, g: gainOf(team.roster, here, man) }));
    scored.sort((a, b) => b.g - a.g);

    // The double: a top-tier man whose base role already holds a top-tier man of ours.
    const heldDoubles = doublesIn(team.roster, stats, wctx.rules);
    const ours = new Set(team.roster.map((m) => m.id));
    const doubleBonus = new Map();
    if (doubles && heldDoubles < MAX_DOUBLES) {
      // What a trade could bring does not depend on which double we take, so it is priced ONCE per pick, on the
      // men worth trading for at all (the same shortlist the picks are made from), best gain first.
      let trades = null;
      const tradesOnce = () => (trades ??= shortlist(
        everybody.filter((m) => !ours.has(m.id) && m.slot !== keeperSlot), stats)
        .filter((y) => (y.p ?? 0) * ((y.fm_pred ?? 0) - statOf(stats, y).z) > 0)
        .map((y) => ({ y, gain: gainOf(team.roster, here, y) }))
        .sort((a, b) => b.gain - a.gain));
      for (const { man, g } of scored) {
        if (!isTop(stats, man)) continue;
        if (elevenIds([...team.roster, man], wctx.rules).has(man.id)) continue;
        const base = baseRole(man);
        const trade = tradesOnce().find(({ y }) => baseRole(y) !== base && y.price <= man.price);
        if (trade && trade.gain > g) doubleBonus.set(man.id, TRADE_SHARE * (trade.gain - g));
      }
    }

    const result = new Map();
    for (const { man, g } of scored) result.set(man.id, g + (doubleBonus.get(man.id) ?? 0));
    const t = typeof turns === 'function' ? turns(team, { stats, rules: wctx.rules, setup: ctx.setup }) : turns;
    const hunting = stayTop && ctx.setup.cap
      && !team.roster.some((m) => m.price >= ctx.setup.cap.fvm) && team.picksCount < ctx.setup.cap.turns;
    if (t !== null && ctx.table && ctx.order) {
      if (t > 1) {
        const heads = [...scored].sort((a, b) => result.get(b.man.id) - result.get(a.man.id)).slice(0, LOOKAHEAD_K);
        for (const { man } of heads) {
          const { gain, position } = rollout(ctx, man, wctx, stats, t, here, true);
          const off = hunting && position != null && position > stayTop.rank ? stayTop.penalty : 0;
          result.set(man.id, gain + (doubleBonus.get(man.id) ?? 0) - off);
        }
      }
    } else if (lookahead && ctx.table && ctx.order
      && (options.lookaheadUntil == null || team.picksCount < options.lookaheadUntil)) {
      const heads = [...scored].sort((a, b) => result.get(b.man.id) - result.get(a.man.id)).slice(0, LOOKAHEAD_K);
      for (const { man } of heads) {
        result.set(man.id, depth > 1
          ? rollout(ctx, man, wctx, stats, depth, here) + (doubleBonus.get(man.id) ?? 0)
          : result.get(man.id) + nextBest(ctx, man, wctx, stats));
      }
    }
    // Everyone outside the shortlist ranks below it, on G's cheapest proxy: never a pick unless nothing else is.
    const floor = -1e6;
    for (const man of ctx.pool) {
      if (!result.has(man.id)) result.set(man.id, floor + (man.p ?? 0) * (man.fm_pred ?? 0));
    }
    return { result, doubleBonus };
  };

  /** What we could take at our NEXT turn if we took `mine` now: rivals simulated with the price head. */
  const nextBest = (ctx, mine, wctx, stats) => {
    const { table, order, at, setup, places } = ctx;
    const meId = order[at];
    let pool = ctx.pool.filter((p) => p.id !== mine.id);
    const teams = table.map((t) => ({ ...t }));
    const me = teams.find((t) => t.id === meId);
    me.roster = [...me.roster, mine];
    me.slots = [...me.slots, mine.slot];
    me.rosterValue += mine.price;
    me.pickValues = [...me.pickValues, mine.price];
    me.picksCount += 1;
    const take = (team, choice) => {
      pool = pool.filter((p) => p.id !== choice.id);
      team.slots = [...team.slots, choice.slot];
      team.roster = [...team.roster, choice];
      team.rosterValue += choice.price;
      team.pickValues = [...team.pickValues, choice.price];
      team.picksCount += 1;
    };
    const ask = (team) => bestUnder({
      team, pool: legalPoolFor(team, pool, setup), places, keeperCap: setup.keepers, tail: false,
      quality: (p) => p.price, need: appNeed, ctx: { ...ctx, pool },
    });
    for (const id of order.slice(at + 1)) {
      const team = teams.find((x) => x.id === id);
      const choice = ask(team);
      if (choice) take(team, choice);
    }
    const next = [...teams].sort((a, b) => ahead(a, b, setup.maxAhead ?? 1)).map((t) => t.id);
    for (const id of next) {
      if (id === meId) break;
      const team = teams.find((x) => x.id === id);
      const choice = ask(team);
      if (choice) take(team, choice);
    }
    if (me.picksCount >= setup.rounds) return 0;
    const worth = squadWorth(me.roster, wctx);
    const keeperSlot = ctx.keeperSlot ?? 'por';
    const keepers = me.slots.filter((s) => s === keeperSlot).length;
    let best = 0;
    for (const man of shortlist(legalPoolFor(me, pool, setup), stats)) {
      if (man.slot === keeperSlot && keepers >= setup.keepers) continue;
      best = Math.max(best, squadWorth([...me.roster, man], wctx) - worth);
    }
    return best;
  };

  /**
   * The DEEP look-ahead (`depth` = our turns considered, the current one included): take `mine`, let the
   * rivals pick with the price head, take OUR best by G at our next turn, and so on for `depth - 1` more of
   * our turns. The candidate is worth how much the squad rises over those picks. The rivals obey the league's
   * rules (the ceiling of the first turns, the exact doors) because a simulation that lets them break them
   * would hand us men they could not have taken.
   */
  const rollout = (ctx, mine, wctx, stats, turns, now, detail = false) => {
    const { setup, places } = ctx;
    const keeperSlot = ctx.keeperSlot ?? 'por';
    const meId = ctx.order[ctx.at];
    let pool = ctx.pool.filter((p) => p.id !== mine.id);
    const teams = ctx.table.map((t) => ({ ...t }));
    const add = (team, choice) => {
      pool = pool.filter((p) => p.id !== choice.id);
      team.slots = [...team.slots, choice.slot];
      team.roster = [...team.roster, choice];
      team.rosterValue += choice.price;
      team.pickValues = [...team.pickValues, choice.price];
      team.picksCount += 1;
    };
    const legalFor = (team) => legalPoolFor(team, pool, setup);
    const headOf = new Map();
    if (rivals === 'infer') {
      const everybody = [...ctx.pool, ...ctx.table.flatMap((t) => t.roster)];
      for (const t of ctx.table) if (t.id !== meId) headOf.set(t.id, HEADS[inferHead(t, everybody)]);
    } else if (typeof rivals === 'function') {
      for (const t of ctx.table) if (t.id !== meId) headOf.set(t.id, rivals(t.id));
    }
    const rival = (team) => bestUnder({
      team, pool: legalFor(team), places, keeperCap: setup.keepers, tail: false,
      quality: headOf.get(team.id) ?? ((p) => p.price), need: appNeed, ctx: { ...ctx, pool },
    });
    const me = teams.find((t) => t.id === meId);
    add(me, mine);
    let order = ctx.order, at = ctx.at, taken = 1, position = null;
    while (taken < turns && me.picksCount < setup.rounds) {
      at += 1;
      if (at >= order.length) {
        order = [...teams].sort((a, b) => ahead(a, b, setup.maxAhead ?? 1)).map((t) => t.id);
        at = 0;
        // Where we stand in the round the ceiling opens for us: the «first three» the operator asks for.
        if (setup.cap && me.picksCount === setup.cap.turns && position === null) {
          position = order.indexOf(meId) + 1;
        }
      }
      const team = teams.find((t) => t.id === order[at]);
      if (team.picksCount >= setup.rounds) continue;
      if (team.id !== meId) {
        const choice = rival(team);
        if (choice) add(team, choice);
        continue;
      }
      const doors = me.slots.filter((x) => x === keeperSlot).length;
      const legal = legalFor(me).filter((p) => (p.slot === keeperSlot ? doors < setup.keepers : true));
      const worth = squadWorth(me.roster, wctx);
      let best = null, bestGain = -Infinity;
      for (const man of shortlist(legal, stats, 6, 3)) {
        const gain = squadWorth([...me.roster, man], wctx) - worth;
        if (gain > bestGain) { best = man; bestGain = gain; }
      }
      if (!best) break;
      add(me, best);
      taken += 1;
    }
    // A rollout too short to reach the round the ceiling opens still has to answer «where will we stand»: the
    // order as it would be if that round started now, on the squads as the rollout leaves them (the review of
    // 29/09/2026: without it a 3-turn rollout never fired the «first three» rule on the first three picks).
    if (position === null && setup.cap && me.picksCount <= setup.cap.turns) {
      position = [...teams].sort((a, b) => ahead(a, b, setup.maxAhead ?? 1)).findIndex((t) => t.id === meId) + 1;
    }
    const gain = squadWorth(me.roster, wctx) - now;
    return detail ? { gain, position } : gain;
  };

  const policy = {
    inferHead,
    need: () => 1,
    floor: Infinity,
    noTail: true,
    doublesTaken: 0,
    picks: 0,
    currency: (man, ctx) => {
      let entry = cache.get(ctx.pool);
      if (!entry) {
        entry = evaluate(ctx);
        cache.set(ctx.pool, entry);
      }
      return entry.result.get(man.id) ?? -1e9;
    },
  };
  return policy;
}
