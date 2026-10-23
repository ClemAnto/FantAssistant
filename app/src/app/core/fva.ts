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
 * Outfield:  FVA = MV' +   GOAL_BONUS x lambda  +  others x k, MV' = 6 + (MV - 6) x k above the 6, MV below it
 *   lambda  = expected goals in this match: -ln(1 - p), p the bookmakers' price CALIBRATED on the archived
 *             outcomes together with his own goal rate (`goalChance`, 22/10/2026); without a price, his own
 *             goals per appearance times `k`;
 *   others  = assists, cards, the rest of the bonus: with a price, MEASURED per voted match on the same matches
 *             as the goal rate (`restPerMatch`, 09/10/2026); without one, (FM - MV) - GOAL_BONUS x goals per
 *             appearance, which gives the sheet's FM back.
 * Keeper:    FVA = MV - lambda_conceded, lambda_conceded = -ln(p clean sheet), p from the price, else from the
 *            calendar (Serie A); without either, his FM.
 *            The clean-sheet price is used AS IT IS, now by measurement (22/10/2026, 94 sides of the archived
 *            odds against the keepers' goals conceded): implied 30.8%, real 28.7%, and every correction - a
 *            shift, a two-parameter curve - read worse out of sample than the raw price (log-loss 0.5822 raw,
 *            0.5882 shifted, 0.5926 curve). Unlike the scorer market, this one has no margin worth removing.
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
 * THE BASE VOTE OF THE NEXT MATCH, NOT OF THE REST OF THE SEASON (operator, 23/10/2026: «va dato più peso al
 * momento presente rispetto alla scorsa stagione ma anche a 10 partite fa ... FVA nella prossima partita»).
 * The sheet's MV is a SEASON forecast and lets this season in at K = 40 (R25), so four votes of 5.5 move it by a
 * tenth. For the NEXT match the votes already played weigh more, and the recent ones more than the old:
 *
 *   MV_next = (RECENT_MV_K x MV_sheet + sum_i d^age_i x vote_i) / (RECENT_MV_K + sum_i d^age_i)
 *
 * over this season's real championship votes, age 0 = the last one. MEASURED (23/10/2026, outfield, next-match
 * base vote, previous season with 15+ votes as the prior, leave-one-season-out on a grid K 2-40 x d 0.7-1.0):
 * every fold picks K 8-10 and d 0.95 - both INTERIOR - and the held-out MAE falls 0.5202 -> 0.5171 on Serie A
 * (11 seasons of 11) and 0.5072 -> 0.5040 on EuroLeghe (6 of 6); laid over the sheet's own blend instead of the raw
 * prior it reads 0.5175 / 0.5042, i.e. the same. The same recency on the GOALS and on the rest of the bonus buys
 * nothing (goals 0.1105 -> 0.1103 squared error, the rest worse): the base vote is where the present shows, so it
 * stays there. Keepers are not measured and keep the sheet's MV.
 */
export const RECENT_MV_K = 10;
export const RECENT_MV_DECAY = 0.95;

/** The next-match base vote from the sheet's MV and this season's votes, oldest first. Null prior stays null. */
export function recentMv(prior: number | null, votes: readonly number[]): number | null {
  if (prior === null || !votes.length) return prior;
  let num = RECENT_MV_K * prior;
  let den = RECENT_MV_K;
  votes.forEach((vote, i) => {
    const w = RECENT_MV_DECAY ** (votes.length - 1 - i);
    num += w * vote;
    den += w;
  });
  return num / den;
}

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
 * THE PRICE, CALIBRATED (22/10/2026, measured on the odds the press sheet has archived since 08/10: 97 played
 * matches of the five championships, the last capture before kick-off, 1,381 men who played and 150 of them who
 * scored, outcomes from Transfermarkt - Serie A's 61 goals match the votes' 61). Two findings decide the form:
 *
 *   - 1/price OVERSTATES the goal, and more for the long shots: implied 7.7% realised 4.0%, 14.0% -> 6.9%,
 *     24.7% -> 12.9%, 33.9% -> 19.7%, 44.5% -> 31.2%, 57.6% -> 42.9% - a margin plus the favourite-longshot bias;
 *   - the price ranks the scorers a little better than his own goals per appearance (AUC 0.709 against 0.697) and
 *     the TWO TOGETHER better than either (0.717; log-loss 0.3197 history, 0.3155 price, 0.3144 both, five folds by
 *     match). The gain is small - ~2% - and 150 goals cannot tell it from noise; it is what the data say today.
 *
 * So P(he scores | he plays) = sigmoid(a + b x logit(price prob) + c x logit(his shrunk goals per appearance)).
 * Fitted on all of it; leaving out one championship at a time moves `b` 0.63-0.79 and `c` 0.22-0.42, the
 * direction never. It REPLACES the per-page rescaling used until this day (history over market on the roster's
 * own men, clamped 0.5-1), which out of sample read the same log-loss (0.3151) and is not a per-man probability
 * anybody can show beside the price. To be re-measured when the archive reaches ~500 goals.
 */
export const GOAL_CURVE = { intercept: -0.475, odds: 0.697, history: 0.308 };
/** His goals per appearance are shrunk by this many league appearances at this many goals (0.1 a match). */
export const HISTORY_PRIOR_MATCHES = 5;
export const HISTORY_PRIOR_GOALS = 0.5;

const logit = (p: number) => Math.log(p / (1 - p));
const clampProb = (p: number) => Math.min(Math.max(p, 0.01), 0.95);

/**
 * P(he scores in this match | he plays): the bookmakers' price corrected by the curve above. `goals` and
 * `appearances` are his league record this season and the last; none on file reads as the prior (0.1 a match).
 * The ONE definition behind the FVA's goal part and the percentage the page prints beside the price.
 */
export function goalChance(oddsProb: number, goals: number | null, appearances: number | null): number {
  const n = appearances ?? 0;
  const history = (Math.max(goals ?? 0, 0) + HISTORY_PRIOR_GOALS) / (Math.max(n, 0) + HISTORY_PRIOR_MATCHES);
  const z = GOAL_CURVE.intercept + GOAL_CURVE.odds * logit(clampProb(oddsProb)) + GOAL_CURVE.history * logit(clampProb(history));
  return 1 / (1 + Math.exp(-z));
}

export interface FvaInput {
  keeper: boolean;
  mv: number | null;
  /**
   * The NEXT match's base vote (`recentMv`): it replaces `mv` in the base part only. `mv` stays the sheet's season
   * MV because the rest of the bonus is derived from FM - MV, and the two halves of that pair must be the sheet's.
   * Null/absent = the sheet's MV.
   */
  mvNext?: number | null;
  fm: number | null;
  /** Forecast minutes per appearance (`desc_minutes_next`); null = unknown, and then `k` is 1. */
  minutes: number | null;
  /** His own goals per championship appearance, this season and the last; null = no appearance on file. */
  goalsPerMatch: number | null;
  /** How many championship appearances that rate stands on (the calibrated price shrinks it by them). */
  appearances?: number | null;
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

export function fvaOf(input: FvaInput): Fva {
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
  const base = towardSix(input.mvNext ?? input.mv, k);
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
  // The calibrated price is P(goal | he plays) over men who started AND men who came on, so it already knows how
  // many minutes he is likely to get: the minutes discount is not applied on top of it (22/10/2026). The history
  // is a rate per appearance too, and keeps the operator's `k` as before.
  const goals = fromOdds
    ? GOAL_BONUS * lambdaOf(goalChance(input.oddsProb!, input.goalsPerMatch * (input.appearances ?? 0), input.appearances ?? 0))
    : historyGoals * k;
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
