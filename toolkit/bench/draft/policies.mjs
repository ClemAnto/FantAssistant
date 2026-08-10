/* The heads WE can sit down with, in three families: the ones already measured (kept so their published
 * numbers reproduce after the move into the repo), and the candidates of `todolist-draft-v1.md`.
 *
 * A candidate lives here and NOT in the app until it wins a verdict. That order is the golden rule applied
 * to the advice: measure on the bench, then change the panel, then let the bench read it from the panel. */
import { DEPTH_WEIGHT, coverNeedOf, lambdaOf, needForUs, netOf } from './appcode.mjs';
import { appNeed } from './engine.mjs';
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
export const HYBRID = (p) => (p.slot === 'por' ? p.surplus : p.value);

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
const keeperBySurplus = (pool) => {
  let best = null;
  for (const p of pool) if (p.slot === 'por' && (!best || p.surplus > best.surplus)) best = p;
  return best ? pool.filter((p) => p.slot !== 'por' || p.id === best.id) : pool;
};

export const CURRENCY = [
  { name: 'VALORE puro', need: coverPlaces(2), currency: VALUE, floor: Infinity },
  { name: 'SURPLUS puro', need: coverPlaces(2), currency: SURPLUS, floor: Infinity },
  { name: 'IBRIDA letterale (surplus in porta)', need: coverPlaces(2), currency: HYBRID, floor: Infinity },
  { name: 'IBRIDA per scelta interna', need: coverPlaces(2), currency: VALUE, floor: Infinity,
    restrict: keeperBySurplus },
];

export const SETS = { published: PUBLISHED, coverage: COVERAGE, currency: CURRENCY };
