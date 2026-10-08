/**
 * THE «+GIRO» SCORE OF EVERY FREE MAN (operator, 06/10/2026: «una nuova colonna dopo +Rosa che abbia un valore
 * finale per ordinare i vari calciatori in maniera assoluta ... deve contemplare sia +Rosa che il +Rosa della
 * scelta successiva, in base all'FVM del calciatore in oggetto e all'ordine di scelta attuale e futuro», then
 * «vorrei che il punteggio riguardasse 4 prese (quella attuale + 3 future)»): his own +Rosa fertility PLUS the
 * fertility of the best men predicted to STILL BE THERE at each of our next `TURN_PICKS - 1` turns once he is
 * taken. His declared formula, built from measured parts and nothing else.
 *
 * It is the scenarios' chain total (`Scenario.horizon`, `CHAIN_TURNS`) flattened to a column: a chain walks the
 * rivals once per candidate and can afford six of them (`draft-scenarios.CHAINED`), a column over the whole free
 * list cannot, so ONE walk (`auction-plan.rivalPicksHorizon`) is read by every candidate as its own prefixes -
 * how long each prefix is depends on the PRICES of the chain so far, by the platform's order rule
 * (`positionAfterSpending`'s own comparison): a dear pick sends us later in a `default` order in EVERY round
 * that follows, which is exactly the dependence the operator asked the column to carry. On a snake the order
 * ignores the price and the prefixes are positional, one for all. And from our third pick the `default` order has
 * SETTLED (`auction-plan.ORDER_SETTLES_AFTER`, operator 08/10/2026): our next turn comes after one call of every
 * rival whatever we pay, so a cheap man no longer buys an earlier one.
 *
 * THE DECLARED APPROXIMATIONS, each one the machinery already makes elsewhere:
 *   - the rivals' picks do not change with OUR picks: the walk prices ours at zero, as `goneBeforeOurNextTurn`
 *     declares of itself - a rival who would have taken our man takes his next-best instead, second order;
 *   - the later picks are GREEDY: each of our turns takes the best man left, it never sacrifices one turn for
 *     the next - the same policy the plans' later steps play (`chainFrom`);
 *   - a surviving candidate of a group the chain has NOT touched keeps the +Rosa computed on today's pitch:
 *     the chain stands on places of ITS OWN groups, so the others' marginals barely move (the door's price
 *     moves by a pick and a keeper candidate reads today's, stated);
 *   - a surviving candidate of a group the chain ALREADY HOLDS is re-measured on the pitch WITH the chain
 *     (`exactOn`), because there the interaction IS the question: two men of one group fill starter + reserve,
 *     and counting the second at his solo marginal would double-count the slot and favour the rich groups -
 *     the exact opposite of what the column exists to say. Only the tops that would otherwise win are
 *     re-measured (`SAME_GROUP_EXACT`): adding men never raises a same-group marginal (the keepers' calendar
 *     pairing aside, accepted), so a candidate already losing on his cached reading keeps losing on the exact.
 *
 * FOUR PICKS AND NOT TWO OR SIX because the draft bench has already measured the knee (`CHAIN_TURNS`, 02/10/2026:
 * chains of 2 · 3 · 4 read 72.20 · 72.93 · 73.43 points a matchday, 5 and 6 under the floor), and the operator
 * asked for the same horizon here. NO SURVIVOR DISCOUNT ON TOP: the chain IS the lookahead the discount
 * approximates on one number (`rankGain`), and the bench has already measured that stacking the same mechanism
 * twice is worse than either half (`docs/model/metrica-asta-surplus-v1.md` §18).
 */

import { settledAfter, type HorizonStep } from './auction-plan';

/** Our picks the score spans: the current one plus three future turns (operator, 06/10/2026; the bench's knee). */
export const TURN_PICKS = 4;

/** A free man as the column reads him: the +Rosa pair, his price and his interaction group. */
export interface TurnMan {
  id: number;
  /** The FVM, which is what moves our place in a `default` order. */
  price: number;
  /** The interaction group: RAR's own (base role on mantra, slot on classic, a door is `por`). */
  group: string;
  /** His +Rosa fertility, points per matchday; null = unknown, and he gets no score («vuoto = ignoto»). */
  fert: number | null;
  /** His +Rosa coverage, the candidates' tie-break - never summed into the score. */
  cover: number;
}

export interface TurnScore {
  /** His fertility plus the later picks': the column, points per matchday over our next `TURN_PICKS` picks. */
  score: number;
  /** The predicted later picks, in turn order: who and what he adds. Empty on our last pick. */
  picks: { id: number; fert: number }[];
  /** Rival calls before our SECOND pick if we take him now. */
  wait: number;
  /** Our LAST pick: nothing follows, the score is his own fertility alone. */
  last: boolean;
}

export interface TurnInput {
  men: readonly TurnMan[];
  /** The one walk (`rivalPicksHorizon`, `roundsAhead` = TURN_PICKS - 1), in call order. */
  steps: readonly HorizonStep[];
  /** Where our zero-priced turn of each future round falls among the steps: the boundaries on a snake. */
  myTurns: readonly number[];
  orderType?: 'default' | 'pingpong';
  /** Our roster value now: plus the chain's prices, it is what each later round's order reads. */
  myValue: number;
  /** Where the order has settled and the price stops moving our turn; absent = the platform's rule throughout. */
  settle?: TurnSettle;
  /** Our picks still to make, the current one included: the chain is at most this long. */
  picksLeft: number;
  /** Whether `candidate` may be the next pick of a chain that already took `taken`: quota, cap, the doors. */
  canPick: (taken: readonly TurnMan[], candidate: TurnMan) => boolean;
  /** Whether `candidate` may be the pick being made NOW: a man who may not gets no score at all. Absent = all may. */
  canPickFirst?: (candidate: TurnMan) => boolean;
  /** The fertility of `candidates` on the pitch WITH the chain `taken`: the costly exact path. */
  exactOn: (taken: readonly TurnMan[], candidates: readonly TurnMan[]) => ReadonlyMap<number, number | null>;
}

/** How many used-group survivors are re-measured exactly per turn, when their cached reading would otherwise win. */
export const SAME_GROUP_EXACT = 2;

/** The candidates' ranking key, +Rosa's own sort: fertility first, the coverage a tie-break that cannot outweigh it. */
const scalar = (man: TurnMan): number | null => (man.fert == null ? null : man.fert + man.cover * 1e-3);

/**
 * WHERE THE ORDER HAS SETTLED (`auction-plan.ORDER_SETTLES_AFTER`): our picks so far, how many rival calls come
 * before our current one and how many each settled turn waits. Absent = the platform's rule for every turn.
 */
export interface TurnSettle {
  /** Our picks before the current one. */
  picksBefore: number;
  /** Rival calls before our current call (`HorizonWalk.nowAt`). */
  nowAt: number;
  /** Rivals with picks left: one call each before a settled turn (`HorizonWalk.rivals`). */
  rivals: number;
}

/**
 * The rival calls that fall BEFORE our pick number `prices.length + 1`, given the chain spent `prices` so far,
 * and whom they take. On a snake the prefix is positional (`myTurns`: no price moves it); under the `default`
 * order every call of an EARLIER round precedes it, and a call of its own round only while the caller's
 * projected value stays under ours - strictly, the same comparison as `positionAfterSpending`, ties to us. Once
 * the order has settled (`settle`, from our third pick on) the price moves nothing: the turn after a settled pick
 * comes after one call of every rival, counted from where the turn before it fell.
 */
export function goneUpTo(
  steps: readonly HorizonStep[],
  myTurns: readonly number[],
  orderType: 'default' | 'pingpong',
  myValue: number,
  prices: readonly number[],
  settle: TurnSettle | null = null,
): { wait: number; gone: Set<number> } {
  const round = prices.length;
  const gone = new Set<number>();
  let wait = 0;
  if (orderType === 'pingpong') {
    const upTo = myTurns[round - 1] ?? steps.length;
    for (const step of steps.slice(0, upTo)) {
      wait += 1;
      if (step.playerId != null) gone.add(step.playerId);
    }
    return { wait, gone };
  }
  if (settle && settledAfter(settle.picksBefore + round - 1)) {
    // The calls before each turn are a prefix of the walk (a round's rivals call by value, cheapest first), so the
    // settled turns add `rivals` calls to the prefix of the last turn the price still placed - or to our current call.
    let upTo = settle.nowAt;
    for (let turn = 1; turn <= round; turn += 1) {
      upTo = settledAfter(settle.picksBefore + turn - 1)
        ? upTo + settle.rivals
        : goneUpTo(steps, myTurns, orderType, myValue, prices.slice(0, turn)).wait;
    }
    for (const step of steps.slice(0, Math.min(upTo, steps.length))) {
      wait += 1;
      if (step.playerId != null) gone.add(step.playerId);
    }
    return { wait, gone };
  }
  const mine = myValue + prices.reduce((sum, price) => sum + price, 0);
  for (const step of steps) {
    if (step.round > round) continue;
    if (step.round === round && step.value != null && step.value >= mine) continue;
    wait += 1;
    if (step.playerId != null) gone.add(step.playerId);
  }
  return { wait, gone };
}

/** The «+Giro» of every man whose +Rosa fertility is known, by id. */
export function turnScores(input: TurnInput): Map<number, TurnScore> {
  const out = new Map<number, TurnScore>();
  const ranked = input.men
    .map((man) => ({ man, key: scalar(man) }))
    .filter((one): one is { man: TurnMan; key: number } => one.key != null)
    .sort((a, b) => b.key - a.key);
  const orderType = input.orderType ?? 'default';
  const turns = Math.max(1, Math.min(TURN_PICKS, input.picksLeft));
  for (const { man: first } of ranked) {
    if (input.canPickFirst && !input.canPickFirst(first)) continue;
    const chain: TurnMan[] = [first];
    const picks: TurnScore['picks'] = [];
    let score = first.fert!;
    let wait = 0;
    for (let turn = 1; turn < turns; turn += 1) {
      const { wait: calls, gone } = goneUpTo(input.steps, input.myTurns, orderType, input.myValue,
        chain.map((man) => man.price), input.settle ?? null);
      if (turn === 1) wait = calls;
      // Best first: the first legal survivor of a group the chain has NOT touched is the bar, and only the
      // used-group men ranked ABOVE it can beat it after the exact re-measure (the list is sorted).
      const used = new Set(chain.map((man) => man.group));
      const taken = new Set(chain.map((man) => man.id));
      let bestFresh: TurnMan | null = null;
      const usedTops: TurnMan[] = [];
      for (const { man } of ranked) {
        if (taken.has(man.id) || gone.has(man.id)) continue;
        if (used.has(man.group)) {
          if (usedTops.length < SAME_GROUP_EXACT && input.canPick(chain, man)) usedTops.push(man);
          continue;
        }
        if (input.canPick(chain, man)) {
          bestFresh = man;
          break;
        }
      }
      let next = bestFresh ? { man: bestFresh, fert: bestFresh.fert! } : null;
      if (usedTops.length) {
        const exact = input.exactOn(chain, usedTops);
        for (const candidate of usedTops) {
          const value = exact.get(candidate.id);
          if (value != null && (!next || value > next.fert)) next = { man: candidate, fert: value };
        }
      }
      if (!next) break;
      chain.push(next.man);
      picks.push({ id: next.man.id, fert: next.fert });
      score += next.fert;
    }
    out.set(first.id, { score, picks, wait, last: turns === 1 });
  }
  return out;
}
