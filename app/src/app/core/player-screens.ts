/**
 * The two SCREENS the five-season calibration left standing: «possibile promessa» and «possibile flop».
 *
 * A screen is not a correlation. A correlation says a signal orders better on average; a screen answers the
 * question a table actually asks - among the men who pass this filter, how many turned out that way, and how
 * many MORE than among the men who did not? That ratio is the lift, and it is the only number that says
 * whether a filter is worth drawing: a precision of 30% is excellent against a base of 10% and worthless
 * against a base of 32%.
 *
 * MEASURED 14/08/2026 on four seasons x two platforms (2022-23 .. 2025-26, euro and Serie A), leave-one-out:
 * every threshold was chosen on three seasons and read on the fourth, because a threshold chosen on the
 * season that judges it is a memory and not a threshold. The window is the first two rounds; the rates are
 * per 90 minutes and need at least 90 minutes played, because a rate over 20 minutes is not a rate.
 *
 * WHY THE NULL MATTERS HERE, since the first version of the measurement got it wrong: the screen contains
 * «cheap» among its conditions, so comparing it with everybody who fails the filter - the expensive men
 * included, who by definition cannot be labelled «exploded» - credits the signal with what is merely the
 * definition. The lift below is measured INSIDE the pool the operator chooses from (same role, same price
 * band, same minutes floor). That correction took the lifts from 5-10x to 1.0-2.4x, and the honest numbers
 * are the second ones.
 *
 * WHAT SHIPS, and only these two: the rest of the grid came out at or below 1.1x, and three cells came out
 * BELOW 1.0 - i.e. worse than not filtering (shots/90 for a midfielder's promise 0.79x, shots/90 0.79x and
 * key passes/90 0.64x for a striker's flop). They are written down in `docs/model/` so nobody re-proposes
 * them.
 *
 *   promise    a CHEAP DEFENDER with xG+xA/90 >= 0.25   -> 50.0% against a 28.9% base = 1.89x (n=24)
 *   flopRisk   a DEAR STRIKER with xG+xA/90 <= 0.25     -> 21.9% against a  9.1% base = 2.41x (n=32)
 *
 * The asymmetry is the result and it has a readable mechanism: a cheap defender who plays AND contributes
 * going forward is a source of bonuses the price ignores, while an expensive striker who is not generating
 * chances is being paid for goals he is not producing. For the upside look at defenders; for the downside,
 * at strikers.
 *
 * REPORTING ONLY. This decorates a row the engine has already priced: it enters no valuation, no ranking,
 * no gate and no board - the same standing as the injury marks beside it. And it is NOT a gate verdict:
 * nothing here was pre-registered, the samples on the promise side are small (24-91 men held out), and the
 * signals were looked at because one season suggested them. Adopting either of them as an input would need
 * a pre-registration and a run on the bench.
 */

import { PlayerMark } from './player-status';

/**
 * The listone's macro-role from the zone the feed files a man under.
 *
 * The screens were calibrated on `role_classic`, which IS the macro-role, so the zone is read rather than
 * a Mantra code bent into one by analogy - the operator's warning of 10/08/2026 and the reason the two
 * rulebooks are two files. `mov` (a generic outfield slot) maps to nothing: it names a place, not a role.
 */
export const MACRO_ROLE: Record<string, string> = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };

/** Which side of the listone a man's price sits on, INSIDE his own role. */
export const CHEAP_PERCENTILE = 50;
export const DEAR_PERCENTILE = 75;

/** Below this many minutes in the window a per-90 rate is not a rate, so no screen is drawn. */
export const MIN_WINDOW_MINUTES = 90;

/** The calibrated threshold, the same number on both sides - it is where the two curves crossed. */
export const XGA90_THRESHOLD = 0.25;

export type ScreenFlag = 'promise' | 'flop_risk';

/** What a player brings to the screen: his role, his price rank, and the window he has played. */
export interface ScreenInput {
  id: number;
  /** The listone's macro-role, uppercase (`P` | `D` | `C` | `A`). Anything else is never screened. */
  role: string | null;
  /** The pre-auction price. Only its RANK inside the role is used, never its value. */
  price: number | null;
  minutes: number;
  xg: number;
  xa: number;
}

export interface ScreenHit {
  flag: ScreenFlag;
  /** The rate that triggered it, so the tooltip can show the number and not just the verdict. */
  xga90: number;
  minutes: number;
}

/**
 * One player's window, aggregated from the per-match layer.
 *
 * `xg` and `xa` are summed with a missing value read as ZERO, which is measured and not assumed: of the
 * rows with a NULL `xg`, 3701 of 3701 carry `shots` = 0 and not one of a season's goals sits on such a row,
 * so NULL means «he did not shoot». The provider changed the payload's own shape between seasons (2022-23
 * emitted an explicit 0, from 2024-25 it omits the key), which is why the reader must impose the
 * convention rather than trust the encoding.
 */
export interface WindowRow {
  minutes: number | null;
  xg: number | null;
  xa: number | null;
}

export function windowOf(rows: readonly WindowRow[]): { minutes: number; xg: number; xa: number } {
  let minutes = 0;
  let xg = 0;
  let xa = 0;
  for (const row of rows) {
    // A row with no minutes is an unused substitute: not a performance, so it is not an observation.
    if (!row.minutes) continue;
    minutes += row.minutes;
    xg += row.xg ?? 0;
    xa += row.xa ?? 0;
  }
  return { minutes, xg, xa };
}

/** Percentile of each value inside its own list, 0-100, ties sharing the average rank. */
function percentiles(values: readonly number[]): number[] {
  const order = [...values.keys()].sort((left, right) => values[left] - values[right]);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k]] = (100 * (rank - 0.5)) / values.length;
    i = j + 1;
  }
  return out;
}

/**
 * The screens for a whole listone, keyed by player id.
 *
 * The POOL IS PART OF THE MEASUREMENT, so it is explicit here rather than implied: the price percentile is
 * computed inside the ROLE and inside the list handed in - which must be the listone the operator is
 * playing on. Pooling two platforms would rank an Italian defender against quotations from a different
 * scale, a defect this project has already paid for once.
 *
 * A role group smaller than this is not a distribution, so it is skipped rather than percentiled.
 */
export const MIN_ROLE_POOL = 20;

export function screensFor(players: readonly ScreenInput[]): Map<number, ScreenHit> {
  const out = new Map<number, ScreenHit>();
  const byRole = new Map<string, ScreenInput[]>();
  for (const man of players) {
    const role = (man.role ?? '').toUpperCase();
    if (role !== 'D' && role !== 'A') continue;   // only the two screens that survived
    if (man.price == null) continue;              // no price, no percentile, no screen
    const group = byRole.get(role);
    if (group) group.push(man);
    else byRole.set(role, [man]);
  }

  for (const [role, group] of byRole) {
    if (group.length < MIN_ROLE_POOL) continue;
    const ranks = percentiles(group.map((man) => man.price as number));
    group.forEach((man, at) => {
      if (man.minutes < MIN_WINDOW_MINUTES) return;
      const xga90 = ((man.xg + man.xa) * 90) / man.minutes;
      const price = ranks[at];
      if (role === 'D' && price <= CHEAP_PERCENTILE && xga90 >= XGA90_THRESHOLD) {
        out.set(man.id, { flag: 'promise', xga90, minutes: man.minutes });
      } else if (role === 'A' && price >= DEAR_PERCENTILE && xga90 <= XGA90_THRESHOLD) {
        out.set(man.id, { flag: 'flop_risk', xga90, minutes: man.minutes });
      }
    });
  }
  return out;
}

/** The measured provenance of each screen, shown in the tooltip: a reader must be able to doubt it. */
const EVIDENCE: Record<ScreenFlag, string> = {
  promise:
    'difensore nella meta bassa del suo ruolo che produce: 50% di questi ha chiuso nel quarto alto del '
    + 'ruolo, contro il 28,9% di base (1,89x) su 4 stagioni e 2 piattaforme',
  flop_risk:
    'attaccante nel quarto alto del suo ruolo che non genera: 21,9% di questi ha reso sotto la mediana, '
    + 'contro il 9,1% di base (2,41x) su 4 stagioni e 2 piattaforme',
};

/**
 * A screen as a mark: what it says, the number behind it, and the evidence for it.
 *
 * The tooltip carries the LIFT and not only the verdict, because a screen at 1.89x is a reason to look and
 * never a reason to be sure - and the sample on the promise side is 24 men held out.
 */
export function screenMark(hit: ScreenHit): PlayerMark {
  const rate = hit.xga90.toFixed(2);
  return {
    flag: hit.flag,
    note: `xG+xA ${rate} per 90' su ${hit.minutes}' giocati · ${EVIDENCE[hit.flag]}`,
  };
}
