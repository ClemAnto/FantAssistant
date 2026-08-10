/* The heads WE can sit down with, in three families: the ones already measured (kept so their published
 * numbers reproduce after the move into the repo), and the candidates of `todolist-draft-v1.md`.
 *
 * A candidate lives here and NOT in the app until it wins a verdict. That order is the golden rule applied
 * to the advice: measure on the bench, then change the panel, then let the bench read it from the panel. */
import {
  DEPTH_WEIGHT, SURVIVOR_DISCOUNT, coverNeedOf, goneBeforeOurNextTurn, lambdaOf, needForUs, netOf,
} from './appcode.mjs';
import { ahead, appNeed, bestUnder } from './engine.mjs';
import { augments, bestCovered } from './legal.mjs';

/* ---- currencies ------------------------------------------------------------------------------------ */

export const VALUE = (p) => p.value;
export const SURPLUS = (p) => p.surplus;
export const PRICE = (p) => p.price;

/**
 * What the PANEL actually ranks by today: the net, surplus minus the going rate per credit.
 *
 * `lambdaOf` is the app's own function and lambda is a property of the POOL, so it is recomputed per pick,
 * cached on the pool array identity (the engine replaces it at every pick, so the cache is exactly as valid
 * as the pool it describes). Two approximations are stated rather than averaged away: the bench's surplus
 * is the SHEET's, measured at the league-wide zero, where the panel moves the zero as the pool empties; and
 * the price here is Qt.I, which in a draft is what the FVM is at a real table.
 */
const lambdaCache = new WeakMap();
export const NET = (p, ctx) => {
  let lambda = lambdaCache.get(ctx.pool);
  if (lambda === undefined) {
    lambda = lambdaOf(ctx.pool.map((m) => ({ id: m.id, surplus: m.surplus, price: m.price })), ctx.slotsLeft);
    lambdaCache.set(ctx.pool, lambda);
  }
  return netOf(p.surplus, p.price, lambda) ?? p.surplus;
};

/**
 * Item 1.2: the HYBRID. Value for the outfield, surplus for the keeper.
 *
 * The five-window campaign refuted the surplus as a draft-wide currency (-4.0%, -15.7% on Tm4) because it
 * charges a per-slot scarcity the mantra rulebook does not impose - 3 keepers + 22 outfield and no quota
 * per slot. The keeper is the one place where the scarcity IS real: you field exactly one, and the
 * replacement `por` is 4.36 of fantamedia against `pc` 7.29. So the hypothesis is not «the surplus is
 * wrong», it is «the surplus is right where the constraint is».
 */
export const HYBRID = (p, ctx) => (p.slot === (ctx?.keeperSlot ?? 'por') ? p.surplus : p.value);

/** The interpolation the campaign used, kept because the two are the same number bar one term. */
export const blend = (theta) => (p, ctx) => {
  const t = typeof theta === 'function' ? theta(ctx.round, ctx.rounds) : theta;
  return (1 - t) * p.value + t * p.surplus;
};

/* ---- need: how much a slot is still wanted --------------------------------------------------------- */

/**
 * Item 1.1 read LITERALLY: the app's `needFor` with the per-role target doubled.
 *
 * It is in the table so that what it does is visible rather than assumed, and what it does is mostly
 * nothing: `startingPlaces` is the CEILING of each role's average share over the eleven shapes and sums to
 * SIXTEEN against a shape's ten outfield places, so a 22-man outfield squad almost never holds twice a
 * role's quota. Doubling that target does not tighten the rule, it releases it. The candidate that can
 * actually bind is `coverPlaces` below.
 */
export const coverTwice = (mode = 'soft') => (team, player, places) => {
  const slot = player.slot;
  if (!slot) return DEPTH_WEIGHT;
  const wanted = places.get(slot) ?? 1;
  const held = team.slots.filter((s) => s === slot).length;
  if (held < wanted) return 1;
  if (held < 2 * wanted) return mode === 'graded' ? 0.7 : 1;
  return mode === 'hard' ? 0 : DEPTH_WEIGHT;
};

/**
 * The same idea counted on the PLACES instead, which is the one that can actually bind.
 *
 * `startingPlaces` is the ceiling of each role's average share over the eleven shapes and sums to SIXTEEN
 * against a shape's ten outfield places, so a squad of 22 outfield men reaches «twice the starting places»
 * almost never: doubling that target does not tighten the rule, it switches it off (measured, and it is
 * why the row `copertura x2 morbida` behaves like `nessuna copertura`). What the rulebook rations is a
 * PLACE, and whether a man covers one more is exactly the augmenting question `legal.mjs` already answers.
 *
 * `copies` = how many legal elevens the squad should be able to field. The campaign's +10.6 points a
 * matchday was measured at TWO (20 outfield places + 2 spares, i.e. the standard squad).
 *
 * The answers are cached against the team OBJECT: the engine replaces it only when that team picks, so the
 * cache is valid for exactly as long as the roster it describes - and the cost falls to one matching plus
 * one walk per distinct role set (there are a few dozen in a listone, against a thousand candidates).
 */
export const coverPlaces = (copies = 2, mode = 'soft') => {
  const cache = new WeakMap();
  return (team, player, places, ctx) => {
    let state = cache.get(team);
    if (!state) {
      const target = bestCovered(team.roster, ctx.shapes, copies);
      state = { target, answers: new Map() };
      cache.set(team, state);
    }
    const key = player.roles.join('|');
    let helps = state.answers.get(key);
    if (helps === undefined) {
      helps = augments(state.target.matching, state.target.places, player.roles);
      state.answers.set(key, helps);
    }
    if (helps) return 1;
    return mode === 'hard' ? 0 : DEPTH_WEIGHT;
  };
};

/**
 * The rationing AS THE PANEL NOW SHIPS IT, read from the app instead of restated here.
 *
 * This row exists to check the direction the project's rule demands: measure on the bench, change the panel,
 * then let the bench read it from the panel. It must land on the same numbers as `coverPlaces(2)` - if it
 * does not, the app implements something other than what was measured, and that is the whole point of
 * looking. The memo is keyed on the team OBJECT, which the engine replaces exactly when that team picks.
 */
export const adoptedCover = () => {
  const cache = new WeakMap();
  return (team, player, places, ctx) => {
    let need = cache.get(team);
    if (!need) {
      need = coverNeedOf(team.roster, ctx.shapes);
      cache.set(team, need);
    }
    return needForUs(need, player);
  };
};

/* ---- exploiting what the TABLE does not know -------------------------------------------------------- */

/**
 * A blend of the market's ranking and one of ours, both on the pool's own percentile scale.
 *
 * Why a blend at all, and why THIS one. Measured with `edge.py` (partial Spearman against the real
 * fantapunti, each signal controlling for the other): our value carries information the price does not
 * (+0.214 on euro, +0.246 on Serie A) and the price carries information WE do not (+0.388 on euro, +0.211 on
 * Serie A). Two signals, neither redundant, and on euro theirs is the bigger of the two - so «prefer our
 * number» is not the way to use the asymmetry, and «prefer theirs» throws our half away.
 *
 * `signal` says WHICH of ours to blend, and that is the sharp part of the measurement: essentially all of our
 * incremental information is the expected APPEARANCES. Controlling for the price, `pv_pred` is worth +0.198
 * (euro) and +0.243 (Serie A), while `fm_pred` is worth +0.046 and **-0.032** and the SURPLUS +0.006 and
 * **-0.077**. Our edge over a price-driven table is one number wide, and it is not the fantamedia.
 */
export const blendWith = (signal, w) => (p) =>
  (1 - w) * (p.pctPrice ?? 0) + w * (signal === 'pv' ? (p.pctPv ?? 0) : (p.pctValue ?? 0));

/**
 * The other way to use the asymmetry, and it needs no ranking edge at all: TAKE THE MAN WHO WILL BE GONE.
 *
 * The rivals rank by the price, so expensive men disappear and cheap ones survive. Two candidates we rate
 * almost the same are therefore not equivalent at all: the dear one has to be taken NOW or lost, the cheap one
 * can be harvested next round. Buying the survivor first spends a pick to acquire what waiting would have
 * given for free - and the bench says the choice is available constantly (in 57.3% of our picks some man about
 * to disappear raises our own eleven as much as the policy's pick).
 *
 * `discount` is what a survivor is worth relative to a man who will be gone. 1 = the rule is off.
 *
 * What it is allowed to know is exactly what the panel knows: the ORDER (the platform's own rule, reproduced),
 * the rivals' squads (public), and one policy for their heads - the DEFAULT price head, deliberately, so the
 * candidate wins or loses on the weaker of the two assumptions available to it rather than on the classifier.
 * It never sees the future; it simulates it.
 */
export const survival = (discount) => {
  const cache = new WeakMap();
  const goneBefore = (ctx) => {
    let set = cache.get(ctx.pool);
    if (set) return set;
    set = new Set();
    const { table, order, at, setup, places, keeperSlot } = ctx;
    if (!table || !order) { cache.set(ctx.pool, set); return set; }
    // The rest of THIS round, then the next round up to our own turn: the men gone before we choose again.
    let pool = ctx.pool, teams = table.map((t) => ({ ...t }));
    const meId = order[at];
    const take = (id, choice) => {
      pool = pool.filter((p) => p.id !== choice.id);
      const t = teams.find((x) => x.id === id);
      t.slots = [...t.slots, choice.slot];
      t.roster = [...t.roster, choice];
      t.rosterValue += choice.price;
      t.pickValues = [...t.pickValues, choice.price];
      t.picksCount += 1;
      set.add(choice.id);
    };
    const ask = (team) => bestUnder({
      team, pool, places, keeperCap: setup.keepers, tail: false,
      quality: (p) => p.price, need: appNeed, ctx: { ...ctx, pool, keeperSlot },
    });
    for (const id of order.slice(at + 1)) {
      const choice = ask(teams.find((x) => x.id === id));
      if (choice) take(id, choice);
    }
    const next = [...teams].sort((a, b) => ahead(a, b, setup.maxAhead ?? 1)).map((t) => t.id);
    for (const id of next) {
      if (id === meId) break;
      const choice = ask(teams.find((x) => x.id === id));
      if (choice) take(id, choice);
    }
    cache.set(ctx.pool, set);
    return set;
  };
  return (p, ctx) => (p.value ?? 0) * (goneBefore(ctx).has(p.id) ? 1 : discount);
};

/* ---- the operator's PAIR: a bonus man who plays little beside a reliable man who does not score ------ */

/**
 * What a place is expected to YIELD, if you always field the best of the men who turn up.
 *
 * Sort the men who can fill it by fantamedia, and walk down: the first plays with probability p and pays his
 * fantamedia, the second only pays when the first does not turn up, and so on.
 *
 *     E = SUM_i  fm_i x p_i x PRODUCT_{j<i} (1 - p_j)
 *
 * This is the operator's idea written down (10/08/2026): «for one place in my module, a man who plays little
 * but scores bonuses often, TOGETHER WITH a bench man of the same place who plays a lot and scores nothing».
 * The formula says exactly when that pairing pays - adding a reliable man to a place held by an unreliable one
 * is worth `fm x p x (1 - p_held)`, which is large precisely when the holder is unreliable - and it needs NO
 * parameter, which is what makes it worth measuring: it would REPLACE `DEPTH_WEIGHT` = 0.35, a declared
 * constant, with a computed quantity.
 *
 * Two declared approximations. A place is treated as INDEPENDENT of the others, while the real assignment is
 * joint (the matroid), so «the men who compete for his place» is read as «the men who share a role code with
 * him» - the cheap honest definition. And the metric this is scored on fields the best of the AVAILABLE men
 * each matchday, i.e. it grants perfect within-matchday foresight, where the real game gives you an ordered
 * substitution hierarchy with an out-of-position malus. The bench is therefore GENEROUS to this idea, which
 * matters for how a positive result should be read.
 */
export const placeYield = (men) => {
  const sorted = [...men].sort((a, b) => (b.fm_pred ?? 0) - (a.fm_pred ?? 0));
  let total = 0, left = 1;
  for (const man of sorted) {
    const p = man.p ?? 0;
    total += (man.fm_pred ?? 0) * p * left;
    left *= 1 - p;
    if (left <= 0) break;
  }
  return total;
};

/** The men of our roster who would compete with him for the same place: a shared role code. */
const rivalsForHisPlace = (roster, player) =>
  roster.filter((man) => man.roles.some((role) => player.roles.includes(role)));

/**
 * The currency: how much this man raises the expected yield of the place he would fill.
 *
 * For an EMPTY place it reduces to `fm x p`, which is the value divided by the calendar - so on the first man
 * of a place it ranks exactly as the adopted policy does, and it can only differ on DEPTH. That is the whole
 * point: depth is where a flat 0.35 is currently deciding.
 */
export const PORTFOLIO = (p, ctx) => {
  const held = rivalsForHisPlace(ctx.team?.roster ?? [], p);
  return placeYield([...held, p]) - placeYield(held);
};

/* ---- the policy sets a run can ask for ------------------------------------------------------------- */

const app = { need: appNeed };

/** What was measured on 10/08/2026, before the bench moved into the repo. The port must reproduce these. */
export const PUBLISHED = [
  { name: 'VALORE, sempre il meglio', ...app, currency: VALUE, floor: Infinity },
  { name: 'VALORE, pavimento 200', ...app, currency: VALUE, floor: 200 },
  { name: 'VALORE, pavimento 100', ...app, currency: VALUE, floor: 100 },
  { name: 'SURPLUS, sempre il meglio', ...app, currency: SURPLUS, floor: Infinity },
  { name: 'SURPLUS, pavimento 100', ...app, currency: SURPLUS, floor: 100 },
  { name: 'prezzo, sempre il meglio', ...app, currency: PRICE, floor: Infinity },
  { name: 'prezzo, pavimento 200', ...app, currency: PRICE, floor: 200 },
  { name: 'sempre primo (pavimento 0)', ...app, currency: VALUE, floor: 0 },
  { name: 'valore -> surplus, g11', ...app, currency: blend((r) => (r < 11 ? 0 : 1)), floor: 200 },
  { name: 'ROVESCIA: surplus -> valore, g11', ...app, currency: blend((r) => (r < 11 ? 1 : 0)), floor: 200 },
];

/** Item 1.1: the coverage target, against the app as it ships. Same currency in every row, so what is
 *  being measured is the RATIONING and nothing else. */
export const COVERAGE = [
  { name: 'app: needFor (la base)', ...app, currency: VALUE, floor: Infinity },
  { name: 'PANNELLO OGGI: netto, 0 razion.', need: () => 1, currency: NET, floor: Infinity },
  { name: 'netto + posti x2', need: coverPlaces(2), currency: NET, floor: Infinity },
  { name: 'nessuna copertura (peso 1)', need: () => 1, currency: VALUE, floor: Infinity },
  { name: 'quote x2 morbida', need: coverTwice('soft'), currency: VALUE, floor: Infinity },
  { name: 'quote x2 graduata', need: coverTwice('graded'), currency: VALUE, floor: Infinity },
  { name: 'posti x1: un undici', need: coverPlaces(1), currency: VALUE, floor: Infinity },
  { name: 'posti x2: due undici', need: coverPlaces(2), currency: VALUE, floor: Infinity },
  { name: 'posti x2 VINCOLO (0 fuori)', need: coverPlaces(2, 'hard'), currency: VALUE, floor: Infinity },
  { name: 'posti x3: tre undici', need: coverPlaces(3), currency: VALUE, floor: Infinity },
  { name: 'APP: adottata, letta dal pannello', need: adoptedCover(), currency: VALUE, floor: Infinity },
];

/**
 * Item 1.2: the hybrid currency, against both pure ones, on the rationing that WON item 1.1 - a currency
 * has to be judged on top of the rationing that is going to ship, or the two changes are measured against
 * each other instead of against the table.
 *
 * `IBRIDA per scelta interna` is the scale-honest form of the same hypothesis, and it exists because the
 * literal one has a problem worth naming: a keeper's SURPLUS and an outfield man's VALUE are not on one
 * scale (the keeper's zero is 4.36 of fantamedia, a `pc`'s is 7.29), so ranking them in a single argmax
 * does not price the keeper by his scarcity - it just takes keepers later. The internal form separates the
 * two questions the rulebook separates: WHETHER to spend a pick on a keeper is decided by the value, WHICH
 * keeper is decided by the surplus, and neither number is ever compared with the other.
 */
const keeperBySurplus = (pool, ctx) => {
  const keeper = ctx?.keeperSlot ?? 'por';
  let best = null;
  for (const p of pool) if (p.slot === keeper && (!best || p.surplus > best.surplus)) best = p;
  return best ? pool.filter((p) => p.slot !== keeper || p.id === best.id) : pool;
};

export const CURRENCY = [
  { name: 'VALORE puro', need: coverPlaces(2), currency: VALUE, floor: Infinity },
  { name: 'SURPLUS puro', need: coverPlaces(2), currency: SURPLUS, floor: Infinity },
  { name: 'IBRIDA letterale (surplus in porta)', need: coverPlaces(2), currency: HYBRID, floor: Infinity },
  { name: 'IBRIDA per scelta interna', need: coverPlaces(2), currency: VALUE, floor: Infinity,
    restrict: keeperBySurplus },
];

/**
 * Item «how do we use what the table cannot see»: the blend, on a PRE-REGISTERED grid, both families, with
 * the two pure ends in the table so the shape of the curve is visible instead of inferred.
 */
export const BLEND = [
  { name: 'VALORE puro (la base)', need: coverPlaces(2), currency: VALUE, floor: Infinity },
  { name: 'prezzo puro', need: coverPlaces(2), currency: PRICE, floor: Infinity },
  ...[0.25, 0.5, 0.75].map((w) => ({
    name: `prezzo + valore, w=${w}`, need: coverPlaces(2), currency: blendWith('value', w), floor: Infinity,
  })),
  ...[0.25, 0.5, 0.75].map((w) => ({
    name: `prezzo + PRESENZE, w=${w}`, need: coverPlaces(2), currency: blendWith('pv', w), floor: Infinity,
  })),
];

/** The same question from the other side: use what they will DO, not what they cannot see. */
export const SURVIVAL = [
  { name: 'VALORE puro (la base)', need: coverPlaces(2), currency: VALUE, floor: Infinity },
  ...[0.85, 0.7, 0.5].map((d) => ({
    name: `sopravvive => sconto ${d}`, need: coverPlaces(2), currency: survival(d), floor: Infinity,
  })),
];

/**
 * Do the two ways of using the asymmetry ADD UP, or are they the same mechanism twice?
 *
 * They might well be one: ranking closer to the price means taking the men the rivals want, which is the men
 * who would be gone - so the blend may be an implicit, blunter survival rule. Measured rather than assumed,
 * because «they are independent» is exactly the kind of claim that stacks two gains into one that is not there.
 */
const blended = blendWith('value', 0.25);
/**
 * The survival rule AS THE PANEL SHIPS IT, read from the app instead of restated here.
 *
 * Same purpose as `adoptedCover`: check that the code that ships lands on the number that adopted it. The one
 * adaptation is the team's shape - the app's `PlanTeam` carries `held`/`heldIds` (a weighted eleven needs
 * them), the bench's carries the men themselves - so the teams are mapped, never the rule.
 */
export const appSurvival = () => {
  const cache = new WeakMap();
  const asPlanTeam = (t) => ({
    ...t,
    held: t.roster.map((p) => ({ roles: p.roles })),
    heldIds: t.roster.map((p) => p.id),
  });
  return (p, ctx) => {
    let gone = cache.get(ctx.pool);
    if (!gone) {
      gone = goneBeforeOurNextTurn({
        teams: (ctx.table ?? []).map(asPlanTeam),
        order: ctx.order ?? [],
        pool: ctx.pool,
        places: ctx.places,
        mineId: (ctx.order ?? [])[ctx.at ?? 0],
        keeperCap: ctx.setup?.keepers ?? 3,
        maxAheadPicks: ctx.setup?.maxAhead ?? 1,
      });
      cache.set(ctx.pool, gone);
    }
    return (p.value ?? 0) * (gone.has(p.id) ? 1 : SURVIVOR_DISCOUNT);
  };
};

export const COMBINED = [
  { name: 'VALORE puro (la base)', need: coverPlaces(2), currency: VALUE, floor: Infinity },
  { name: 'solo sopravvivenza 0.7', need: coverPlaces(2), currency: survival(0.7), floor: Infinity },
  { name: 'solo blend prezzo+valore 0.25', need: coverPlaces(2), currency: blended, floor: Infinity },
  { name: 'APP: sopravvivenza dal pannello', need: coverPlaces(2), currency: appSurvival(), floor: Infinity },
  { name: 'sopravvivenza SU blend', need: coverPlaces(2), floor: Infinity,
    currency: (() => {
      const inner = survival(0.7);
      // The same survival discount, applied to the blended base instead of to our value alone: the discount
      // is a factor, so it composes with whatever the base currency is.
      return (p, ctx) => blended(p) * (inner(p, ctx) / (p.value || 1));
    })() },
];

/**
 * The operator's pair, against the policy AS IT SHIPS - which by now is value x coverage x survival, so a
 * candidate has to beat all three and not just the value.
 *
 * `senza copertura` is in the table because the marginal yield already knows whether a place is covered: if the
 * idea works, the coverage need may be double-counting it, and that is a question the table can answer instead
 * of an argument.
 */
const shipped = (currency) => ({ need: coverPlaces(2), currency, floor: Infinity });

/**
 * The survival discount, applied to whatever base currency is handed in.
 *
 * `survival(...)` is built ONCE per policy and never inside the returned function: it carries the memo of the
 * forward simulation, so constructing it per call makes the memo per call and the whole look-ahead is redone
 * for EVERY candidate of every pick. The run does not fail, it just never finishes - which is how it was
 * found. A memoised hook is built where the policy is built.
 */
const withSurvival = (currency) => {
  const discount = survival(SURVIVOR_DISCOUNT);
  return (p, ctx) => currency(p, ctx) * (discount(p, ctx) / (p.value || 1));
};

/**
 * The operator's claim in its NARROW form: keep the currency that ships, and only prefer a RELIABLE man as
 * depth behind an UNRELIABLE holder.
 *
 * The wide form (`PORTFOLIO`) replaced the currency and lost 4.69%, mostly by rationing depth far harder than
 * `DEPTH_WEIGHT` does - `fm x p x (1 - p_held)` is 0.15-0.30 where the flat weight is 0.35 - so the coverage
 * fell with it. This form cannot do that: it is a bounded multiplier ON TOP of what ships, it is 1 for a place
 * with nobody in it, and it grows only with how unreliable the holder is times how reliable the candidate is.
 * `k` = 0 is the rule switched off, which is the baseline.
 */
export const complement = (k) => (p, ctx) => {
  const held = rivalsForHisPlace(ctx.team?.roster ?? [], p);
  if (!held.length) return p.value ?? 0;
  const pHeld = held.reduce((best, man) => Math.max(best, man.p ?? 0), 0);
  return (p.value ?? 0) * (1 + k * (1 - pHeld) * (p.p ?? 0));
};

export const PAIRS = [
  { name: 'SPEDITA: valore x copertura x sopravv.', ...shipped(withSurvival(VALUE)) },
  { name: 'portafoglio (resa del posto)', ...shipped(withSurvival(PORTFOLIO)) },
  { name: 'portafoglio, senza copertura', need: () => 1, currency: withSurvival(PORTFOLIO), floor: Infinity },
  { name: 'portafoglio, senza sopravvivenza', ...shipped(PORTFOLIO) },
  ...[0.3, 0.6, 1.0].map((k) => ({
    name: `coppia: riserva affidabile k=${k}`, ...shipped(withSurvival(complement(k))),
  })),
];

export const SETS = {
  published: PUBLISHED, coverage: COVERAGE, currency: CURRENCY, blend: BLEND, survival: SURVIVAL,
  combined: COMBINED, pairs: PAIRS,
};
