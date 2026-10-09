/**
 * FVA - FANTA VOTO ATTESO (operator, 09/10/2026: «al posto di PT mettiamo FVA»), the fantavoto a man is
 * expected to score THIS matchday IF HE PLAYS. Formula and the operator's three decisions in
 * `docs/model/formazione-leghe-v1.md` §4-quater:
 *
 *   - «la probabilità di prendere voto ci interessa poco»: P(vote) is not inside the number;
 *   - «il minutaggio un contributo minimo, decisivo solo per distinguere due situazioni simili»: `k` below,
 *     -7.5% at 45' on what sits above the 6 and on the bonuses;
 *   - «le quote fotografano meglio la capacità di segnare in quella partita che non la fantamedia»: where a
 *     scorer price exists, it REPLACES the goal part of the fantamedia.
 *
 * Outfield:  FVA = MV' +   GOAL_BONUS x lambda x k  +  others x k, MV' = 6 + (MV - 6) x k above the 6, MV below it
 *   lambda  = expected goals in this match: -ln(1 - p) from the bookmakers' price, rescaled (below);
 *             without a price, his own goals per appearance;
 *   others  = assists, cards, the rest of the bonus: with a price, MEASURED per voted match on the same matches
 *             as the goal rate (`restPerMatch`, 09/10/2026); without one, (FM - MV) - GOAL_BONUS x goals per
 *             appearance, which gives the sheet's FM back.
 * Keeper:    FVA = MV - lambda_conceded, lambda_conceded = -ln(p clean sheet), p from the price, else from the
 *            calendar (Serie A); without either, his FM.
 *            The clean-sheet price carries a margin too, which makes p too high and the goals conceded too
 *            few: not rescaled, because a roster has two or three keepers and a ratio over them is noise.
 *
 * THE MATCH (09/10/2026, measured: `docs/model/formazione-leghe-v1.md` §4-quinquies). `delta` is this match's
 * edge (Elo + venue - opponent, the bundle's calendar) MINUS his club's ordinary edge, because the fantamedia
 * already contains how strong his club is against the league: only the deviation of THIS match is news.
 *   - base vote:     + MATCH_MV_PER_100 x delta/100 (`a`), on every outfield man;
 *   - other bonuses: + MATCH_OTHERS_PER_100 x delta/100 (`b`);
 *   - goals:         x (1 + MATCH_GOALS_PER_100 x delta/100), ONLY without a price - the price already
 *                    knows the opponent and the venue, and correcting it would count the match twice;
 *   - keeper without a price: the calendar's clean-sheet probability takes the price's place, so
 *     FVA = MV + ln(p) instead of the flat FM (Serie A only: elsewhere the probability is not fitted).
 * The trend stays OUTSIDE by measurement: given this season's fantamedia, the last five weigh 0.03 (Serie A)
 * and 0.07 (EuroLeghe) and the hot hand measures zero against the right null. Nothing here is gated: it is a
 * reading of the app, like the advised lineup it feeds.
 */

/**
 * The match's weight, per 100 Elo of `delta`, fitted on 63,222 outfield votes (Serie A 2020-26 and EuroLeghe
 * 2019-26) leave-one-season-out. Pooled over the three outfield roles because fitted per role they read the
 * same (a 0.054-0.063, b 0.010-0.022, goals 0.085-0.134) and the backtest is identical to the decimal.
 */
export const MATCH_MV_PER_100 = 0.059;
export const MATCH_OTHERS_PER_100 = 0.018;
export const MATCH_GOALS_PER_100 = 0.127;
/** `delta` is clamped here: the fit is linear and its 1st-99th percentiles are -276 / +207. */
export const MATCH_DELTA_MAX = 300;

/**
 * The game's goal bonus (`config/scoring_config.json` default, and Leghe's default for both games). A league can
 * change it PER ROLE and Leghe does serve that (`settings/calculate` → `bnMls.bmgs`, P/D/C/A on classic, read
 * 09/10/2026 in its backend: `CalcoloHelper.CalcolaTotaleBonus`), as it serves the keeper's clean-sheet bonus
 * (`bmcsh`, +1 by default and not in this number either). Neither is read yet: `formazione-leghe-v1.md` §5.
 */
export const GOAL_BONUS = 3;

/** Minutes weight: k = 1 - MINUTES_WEIGHT x (1 - minutes / 90). A CHOICE, the operator's «contributo minimo». */
export const MINUTES_WEIGHT = 0.15;

/**
 * The price's rescaling is clamped here: a scorer market's margin only ever makes 1/price TOO HIGH, so the
 * factor is at most 1, and below one half it would be the history overruling the market it was asked to
 * trust.
 */
export const ODDS_SCALE_MIN = 0.5;
export const ODDS_SCALE_MAX = 1;
/** Fewer men with both a price and a history than this, and the rescaling is not measured: the floor of a ratio. */
export const ODDS_SCALE_SAMPLE = 3;

export interface FvaInput {
  keeper: boolean;
  mv: number | null;
  fm: number | null;
  /** Forecast minutes per appearance (`desc_minutes_next`); null = unknown, and then `k` is 1. */
  minutes: number | null;
  /** His own goals per championship appearance, this season and the last; null = no appearance on file. */
  goalsPerMatch: number | null;
  /**
   * The rest of his bonus per VOTED match, MEASURED on the same matches as `goalsPerMatch` (`restPerMatch`):
   * assists, cards, missed penalties, own goals. Null/absent = no voted match on file.
   */
  restPerMatch?: number | null;
  /** Implied probability of the bookmakers' price (scorer for outfield, clean sheet for a keeper). */
  oddsProb: number | null;
  /** This match's edge minus his club's ordinary edge, in Elo; null/absent = the match is not known. */
  delta?: number | null;
  /** The calendar's P(clean sheet) for his club in this match (Serie A only); null/absent = none. */
  cleanSheet?: number | null;
}

export interface Fva {
  value: number | null;
  /** The three parts, so the tooltip can show the sum. Zero where a part does not apply. */
  base: number;
  goals: number;
  others: number;
  k: number;
  /** Where the goal part came from (for a keeper: the price, the calendar, or the sheet's FM). */
  source: 'odds' | 'history' | 'calendar' | 'sheet' | 'none';
  /** What the match added to the base vote and the other bonuses (and to the goals, without a price). */
  match: number;
}

/** Expected goals from the probability of at least one: P(>=1) = 1 - e^-lambda. */
export function lambdaOf(prob: number): number {
  const p = Math.min(Math.max(prob, 0), 0.99);
  return -Math.log(1 - p);
}

export function minutesFactor(minutes: number | null): number {
  if (minutes === null || !Number.isFinite(minutes)) return 1;
  return 1 - MINUTES_WEIGHT * (1 - Math.min(Math.max(minutes, 0), 90) / 90);
}

/**
 * HOW MUCH TO TRUST THE LEVEL OF THE PRICES. A scorer market carries a margin nobody publishes, so 1/price
 * overstates every man by a factor; the market's ORDER is what the operator trusts it for. The factor is
 * measured on the page's own men: their goals per appearance over the expected goals the prices imply, for the
 * men who have both - so the prices keep who scores more in THIS match and the level comes from the football
 * they played. Clamped (see the constants) and 1 when too few men have both.
 */
export function oddsScale(pairs: readonly { goalsPerMatch: number; oddsProb: number }[]): number {
  if (pairs.length < ODDS_SCALE_SAMPLE) return 1;
  const history = pairs.reduce((sum, one) => sum + one.goalsPerMatch, 0);
  const market = pairs.reduce((sum, one) => sum + lambdaOf(one.oddsProb), 0);
  if (market <= 0) return 1;
  return Math.min(ODDS_SCALE_MAX, Math.max(ODDS_SCALE_MIN, history / market));
}

/**
 * How many voted matches the rest of the bonus is worth before it counts at full weight: the measured rate is
 * shrunk toward zero by `n / (n + REST_PRIOR_MATCHES)`. A CHOICE, the operator's of 09/10/2026: «dobbiamo
 * premiare leggermente di più chi ha dei dati più effettivi» - Godts' one assist in three matches read +0.31 a
 * match and put him ahead of Doue, whose +0.08 stands on 24. Toward zero and not toward a role mean, because a
 * man who still has to show it is exactly the one this should not credit.
 */
export const REST_PRIOR_MATCHES = 10;

/**
 * THE REST OF THE BONUS PER VOTED MATCH: fantavoto - voto - GOAL_BONUS x goals (a scored penalty is a goal), on
 * the championship matches the caller hands in - the SAME ones the goal rate is counted on. Assists, cards,
 * missed penalties, own goals: what the fantavoto adds beyond the vote and the goals, shrunk by its sample
 * (`REST_PRIOR_MATCHES`). Null = no voted match.
 */
export function restPerMatch(
  cells: readonly { vote: number | null; fantavoto: number | null; goals: number; penScored: number }[],
): number | null {
  const voted = cells.filter((one) => one.vote != null && one.fantavoto != null);
  if (!voted.length) return null;
  const sum = voted.reduce(
    (total, one) => total + (one.fantavoto as number) - (one.vote as number) - GOAL_BONUS * (one.goals + one.penScored),
    0,
  );
  return sum / (voted.length + REST_PRIOR_MATCHES);
}

/**
 * The minutes ONLY DISCOUNT: what sits above the 6 shrinks toward it, what sits below stays where it is. Applied
 * both ways, a man under 6 would read BETTER for playing less, which inverts the tie the operator asked the
 * minutes to break (found in the review of 09/10/2026).
 */
function towardSix(value: number, k: number): number {
  return value > 6 ? 6 + (value - 6) * k : value;
}

export function fvaOf(input: FvaInput, scale = 1): Fva {
  const k = minutesFactor(input.minutes);
  const none: Fva = { value: null, base: 0, goals: 0, others: 0, k, source: 'none', match: 0 };
  if (input.keeper) {
    // The keeper's «bonus» is the malus of the goals conceded: from the clean-sheet price where there is
    // one, then from the calendar's own probability for this match, and only without both from the sheet's
    // FM, which discounts the season's AVERAGE conceded and so knows nothing about this opponent.
    const mv = input.mv;
    const priced = input.oddsProb !== null && input.oddsProb > 0;
    const probability = priced ? input.oddsProb! : (input.cleanSheet ?? null);
    if (mv !== null && probability !== null && probability > 0) {
      const conceded = -Math.log(Math.min(probability, 0.99));
      return { value: mv - conceded, base: mv, goals: -conceded, others: 0, k: 1, source: priced ? 'odds' : 'calendar', match: 0 };
    }
    return input.fm === null ? none : { value: input.fm, base: input.fm, goals: 0, others: 0, k: 1, source: 'sheet', match: 0 };
  }
  if (input.fm === null) return none;
  const delta = input.delta == null || !Number.isFinite(input.delta)
    ? 0
    : Math.max(-MATCH_DELTA_MAX, Math.min(MATCH_DELTA_MAX, input.delta)) / 100;
  const vote = MATCH_MV_PER_100 * delta;
  const rest = MATCH_OTHERS_PER_100 * delta * k;
  if (input.mv === null || input.goalsPerMatch === null) {
    // No base vote or no goal history: the goal part cannot be told apart from the rest of the bonus, so the
    // whole fantamedia stands, with the minutes on what sits above the 6 and the match on the vote and the rest.
    const value = towardSix(input.fm, k) + vote + rest;
    return { value, base: value - vote - rest, goals: 0, others: 0, k, source: 'sheet', match: vote + rest };
  }
  const base = towardSix(input.mv, k);
  const historyGoals = GOAL_BONUS * input.goalsPerMatch;
  const fromOdds = input.oddsProb !== null && input.oddsProb > 0;
  // «ALTRI» IS MEASURED WHERE THE PRICE TAKES THE GOALS (operator, 09/10/2026, after «perché Gabriel Jesus ha un
  // FVA > di Kane?»). Derived as FM - MV - goals, it carried the sheet's regression of the fantamedia toward the
  // role's anchor, which is mostly a correction of the GOALS: Kane's FM 10.6 -> 9.2 read as «altri» -1.00, Jesus's
  // 6.38 -> 7.24 as +0.42, while measured on their matches the rest of the bonus is +0.05 and 0.00. With a price
  // the goals are this match's, so the regression of the old ones must not stay behind. Without a price the
  // derivation stands: history goals + the remainder give back exactly the sheet's FM, which is the estimate then.
  const measuredRest = fromOdds && input.restPerMatch != null && Number.isFinite(input.restPerMatch);
  const others = (measuredRest ? input.restPerMatch! : input.fm - input.mv - historyGoals) * k;
  const goals = (fromOdds ? GOAL_BONUS * lambdaOf(input.oddsProb!) * scale : historyGoals) * k;
  // The price already knows the opponent and the venue; the history does not.
  const goalMatch = fromOdds ? 0 : historyGoals * MATCH_GOALS_PER_100 * delta * k;
  const match = vote + rest + goalMatch;
  return { value: base + goals + others + match, base, goals, others, k, source: fromOdds ? 'odds' : 'history', match };
}

/** The sum in words for the tooltip: `MV 6.20 · gol +0.95 (quota) · altri +0.30 · minuti ×0.97`. */
export function fvaWords(fva: Fva, keeper: boolean): string {
  if (fva.value === null) return 'Non prezzabile';
  const sign = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  if (keeper) {
    if (fva.source === 'odds' || fva.source === 'calendar') {
      return `MV ${fva.base.toFixed(2)} · gol subiti ${sign(fva.goals)} (${fva.source === 'odds' ? 'quota' : 'calendario'})`;
    }
    return 'Fantamedia del foglio (nessuna quota né calendario)';
  }
  const match = fva.match ? ` · partita ${sign(fva.match)}` : '';
  if (fva.source === 'sheet') return `Fantamedia del foglio${match} · minuti ×${fva.k.toFixed(2)}`;
  return (
    `MV ${fva.base.toFixed(2)} · gol ${sign(fva.goals)} (${fva.source === 'odds' ? 'quota' : 'storico'})` +
    ` · altri ${sign(fva.others)}${match} · minuti ×${fva.k.toFixed(2)}`
  );
}
