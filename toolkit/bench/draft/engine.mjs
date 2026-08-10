/* The bench's engine, parametric on the listone AND on the league: ONE definition of the draft and of the
 * two scores, used by every script here. A copy per window would be two populations and two truths (the
 * repository's rule on repeated definitions), so the listone enters as an argument and nothing is captured
 * at module level.
 *
 * A POLICY is our own head, and it is a record of hooks rather than a flag, because that is what the
 * measurements this bench exists for actually vary:
 *   `currency`  what we rank a free man by            (item 1.2: VALUE, SURPLUS, or one per line)
 *   `need`      how much a slot is still wanted       (item 1.1: the app's `needFor`, or a candidate)
 *   `floor`     the credits added under the price     (item 1.3: a discipline floor, Infinity = none)
 * The app's own functions are the default for `need`, imported from `appcode.mjs`, so a run with no
 * candidate measures the panel as it ships. */
import { needFor, startingPlaces, TAIL_POSITIONS, TAIL_PRICE_FLOOR } from './appcode.mjs';
import { legalXI } from './legal.mjs';

/** The table the campaign of 10/08/2026 was measured on, kept as the default so its numbers reproduce. */
export const PUBLISHED_SETUP = { teams: 12, rounds: 25, keepers: 3, maxAhead: 1, keeperSlot: 'por' };

/** What the keeper's slot is CALLED in each game. Reading `'por'` as a literal made the cap unreachable on
 *  classic, where the same role is `p` - and an unreachable cap is a rival taking a fourth keeper. */
export const KEEPER_SLOT = { mantra: 'por', classic: 'p' };

/**
 * The same three numbers read from a DECLARED league instead of assumed (item 3.3).
 *
 * `squad_slots` is what a draft's ROUNDS are: you pick until the squad is full, so 3+8+8+6 = 25 rounds is
 * not a bench convention but the league's own roster. Anything a league does not state is inherited from
 * the file's top level, exactly as the toolkit's `Config.load_league` does it.
 */
export function setupFrom(leagueConfig, name) {
  const league = leagueConfig.my_leagues?.[name];
  if (!league) {
    const known = Object.keys(leagueConfig.my_leagues ?? {}).join(', ') || '(none declared)';
    throw new Error(`league "${name}" is not in league_config.json - declared: ${known}`);
  }
  const slots = league.squad_slots ?? leagueConfig.squad_slots ?? {};
  const rounds = Object.values(slots).reduce((a, b) => a + b, 0);
  const keepers = slots.P ?? 3;
  const game = league.game ?? leagueConfig.game ?? 'classic';
  return {
    teams: league.teams ?? leagueConfig.teams,
    rounds,
    keepers,
    maxAhead: 1,
    platform: league.platform,
    game,
    keeperSlot: KEEPER_SLOT[game] ?? 'por',
    name,
  };
}

/**
 * The APP's own rationing, adapted to the bench's wider signature.
 *
 * `needFor` takes the SLOT; a coverage rule needs the whole man, because the flexibility that decides
 * legality is in his role LIST (497 of 1014 quoted men carry 2+ codes). So the bench passes the player and
 * the app's function is adapted HERE, once - not reimplemented, and not adapted twice: passing `needFor`
 * itself as a policy's `need` silently made the weight 1 for every candidate (`places.get(player)` is
 * undefined), which cost one full five-window run before it was noticed.
 */
export const appNeed = (team, player, places) => needFor(team, player.slot, places);

/* Seeded PRNG: the analysis has to repeat identically. */
const rng = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

/* The heads that sit at the table. `giudizio` has an opinion of its own, fixed noise per player. */
export const KIND = {
  prezzo: (p) => p.price,
  giudizio: (p, noise) => p.price * (0.7 + 0.6 * noise),
  surplus: (p) => p.surplus,
  valore: (p) => p.value,
};

/** The default table: 2 heads like ours, 4 with personal judgements, the rest on the price. */
export const MIXED = (i) => (i % 6 === 0 ? 'surplus' : (i % 3 === 0 ? 'giudizio' : 'prezzo'));

/**
 * A table with ALL FOUR heads at it, three seats each.
 *
 * `MIXED` is the model of the operator's real table and it contains no `valore` head at all, so a classifier
 * judged only on it is never asked to recognise one (found while measuring item 1.4 - a hole that is invisible
 * from inside the run). This table exists to ask that question and NOT to replace `MIXED`: the published
 * numbers are about the real table.
 */
export const EVERY_KIND = (i) => ['prezzo', 'giudizio', 'surplus', 'valore'][i % 4];

export const stat = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  return { m, se: sd / Math.sqrt(xs.length) };
};

const ahead = (a, b, maxAhead) => {
  let byPicks = a.picksCount - b.picksCount;
  if (Math.abs(byPicks) < maxAhead) byPicks = 0;
  if (byPicks) return byPicks;
  if (a.rosterValue !== b.rosterValue) return a.rosterValue - b.rosterValue;
  const l = [...a.pickValues].sort((x, y) => y - x), r = [...b.pickValues].sort((x, y) => y - x);
  for (let i = 0; i < Math.max(l.length, r.length); i += 1) {
    const d = (l[i] ?? 0) - (r[i] ?? 0);
    if (d) return d;
  }
  return a.firstRoundIndex - b.firstRoundIndex;
};

/**
 * `theta` interpolates between our two currencies, and it is EXACT because they are the same thing bar
 * one term: surplus = value - replacement x pv. 0 = VALUE, 1 = SURPLUS.
 */
export const THETA = { value: () => 0, surplus: () => 1 };

/**
 * What a HEAD would take out of this pool, and the only place that arithmetic exists.
 *
 * `quality(p)` is the currency, `need` the rationing, `floor` the credits added under the price. It is at
 * module level so that whoever wants to ASK the question - the draft itself, or a harness trying to guess a
 * rival's head from his past picks (item 1.4) - asks the same function. Allocation-free on purpose: it runs
 * once per candidate per pick, twelve thousand picks per policy per window.
 */
export function bestUnder({ team, pool, places, keeperCap, tail, quality, need, floor = Infinity, ctx }) {
  const keeperSlot = ctx?.keeperSlot ?? 'por';
  const keepers = team.slots.filter((s) => s === keeperSlot).length;
  let best = null, score = -Infinity;
  for (const p of pool) {
    if (p.slot === keeperSlot && keepers >= keeperCap) continue;
    const want = need(team, p, places, ctx);
    if (want <= 0) continue;
    const q = quality(p);
    // At the end of a round the price is a price again for everybody: points per credit, price smoothed.
    const value = tail ? (q * want) / (p.price + TAIL_PRICE_FLOOR)
                       : (floor === Infinity ? q * want : (q * want) / (p.price + floor));
    if (value > score) { score = value; best = p; }
  }
  return best;
}

/** The same scores, sorted, for a harness that needs WHERE a man came rather than who won. */
export function rankUnder(args) {
  const { team, pool, places, keeperCap, tail, quality, need, floor = Infinity, ctx } = args;
  const keeperSlot = ctx?.keeperSlot ?? 'por';
  const keepers = team.slots.filter((s) => s === keeperSlot).length;
  const rows = [];
  for (const p of pool) {
    if (p.slot === keeperSlot && keepers >= keeperCap) continue;
    const want = need(team, p, places, ctx);
    if (want <= 0) continue;
    const q = quality(p);
    rows.push({ player: p, score: tail ? (q * want) / (p.price + TAIL_PRICE_FLOOR)
                                       : (floor === Infinity ? q * want : (q * want) / (p.price + floor)) });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

/** The draft of ONE listone, at ONE league setup. */
export function makeDraft(players, shapes, setup = PUBLISHED_SETUP) {
  const places = startingPlaces(shapes);
  const { teams: TEAMS, rounds: ROUNDS, keepers: KEEPERS, maxAhead: MAX_AHEAD } = setup;
  const KEEPER_SLOT_HERE = setup.keeperSlot ?? 'por';

  const pickFor = (team, pool, kind, noiseAt, placesFromEnd, policy, round, slotsLeft) => {
    // The context every hook shares. `pool` and `slotsLeft` are in it because the app's own currency (the
    // net, surplus minus lambda x price) is a property of the POOL and not of the man - so a bench row that
    // claims to be «the panel as it ships» has to be able to compute it.
    const ctx = { round, rounds: ROUNDS, keepers: KEEPERS, shapes, pool, slotsLeft, teams: TEAMS,
                  keeperSlot: KEEPER_SLOT_HERE };
    return bestUnder({
      team,
      pool: policy?.restrict ? policy.restrict(pool, ctx) : pool,
      places,
      keeperCap: KEEPERS,
      tail: placesFromEnd <= TAIL_POSITIONS,
      quality: policy ? (p) => policy.currency(p, { ...ctx, team }) : (p) => KIND[kind](p, noiseAt(p.id)),
      need: policy?.need ?? appNeed,
      floor: policy?.floor ?? Infinity,
      ctx,
    });
  };

  /**
   * One draft. `seat` is us; `policy` is our head; every rival runs `table(i)`'s KIND with the app's own
   * need weighting and no floor - a rival is not assumed to have our discipline either.
   */
  return function draft({ seat, seed, policy, table = MIXED, observe = null }) {
    const random = rng(seed);
    const noise = new Map();
    const noiseAt = (id) => { if (!noise.has(id)) noise.set(id, random()); return noise.get(id); };
    const kinds = Array.from({ length: TEAMS }, (_, i) => (i === seat ? null : table(i)));
    let pool = [...players];
    // `roster` carries the men themselves, not only their primary slots: a coverage rule is about legality
    // and legality is decided by the role LIST. `slots` stays because the app's own policy reads it.
    let teams = Array.from({ length: TEAMS }, (_, i) => ({
      id: i, slots: [], roster: [], rosterValue: 0, pickValues: [], picksCount: 0, firstRoundIndex: i }));
    const got = Array.from({ length: TEAMS }, () => []);
    const orders = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = [...teams].sort((a, b) => ahead(a, b, MAX_AHEAD)).map((t) => t.id);
      orders.push(order);
      for (const [index, id] of order.entries()) {
        const team = teams.find((t) => t.id === id);
        const fromEnd = order.length - index;
        // The table's residual demand in SLOTS, which is what a draft spends instead of credits (§11.2).
        const slotsLeft = TEAMS * ROUNDS - teams.reduce((a, t) => a + t.picksCount, 0);
        const choice = id === seat
          ? pickFor(team, pool, null, noiseAt, fromEnd, policy, round, slotsLeft)
          : pickFor(team, pool, kinds[id], noiseAt, fromEnd, null, round, slotsLeft);
        // The harness sees the state a predictor would have: this team, this pool, this position in the
        // round - and then what actually happened. It is called BEFORE the pool shrinks, on purpose.
        if (observe) {
          observe({ team, teams, pool, places, round, fromEnd, slotsLeft, keeperCap: KEEPERS,
                    kind: kinds[id], isMine: id === seat, choice });
        }
        if (!choice) continue;
        pool = pool.filter((p) => p.id !== choice.id);
        teams = teams.map((t) => (t.id === id
          ? { ...t, slots: [...t.slots, choice.slot], roster: [...t.roster, choice],
              rosterValue: t.rosterValue + choice.price,
              pickValues: [...t.pickValues, choice.price], picksCount: t.picksCount + 1 }
          : t));
        got[id].push(choice);
      }
    }
    return { got, kinds, orders, teams };
  };
}

/** First metric: the best legal eleven on the season TOTALS. A good reserve is worth nothing. */
export const totalXI = (roster, shapes) => legalXI(roster, shapes).points;

/** Second metric, and it is the project's definition (§12.1): the sum over the matchdays of the best legal
 *  eleven among that matchday's AVAILABLE men. An uncovered place is worth zero and does not void the day. */
export function matchdayXI(roster, shapes, votes, rounds) {
  let points = 0, filled = 0;
  for (let md = 1; md <= rounds; md += 1) {
    const available = roster.filter((p) => votes[p.id]?.[md] !== undefined);
    const xi = legalXI(available, shapes, (p) => votes[p.id][md]);
    points += xi.points;
    filled += xi.filled;
  }
  return { points, filled, places: rounds * 11 };
}
