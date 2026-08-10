/**
 * What a player is worth AT THIS TABLE, in the currency an auction is actually about.
 *
 * The engine hands us two numbers per man (`docs/model/assistente-asta-v1.md` §6): his predicted
 * fantamedia and his expected appearances. Everything here turns those into the three the panel
 * shows, and every one of them needs a ZERO that the engine cannot know in advance:
 *
 *   SURPLUS = (fm - replacement) x pv x horizon      points over the man you would field instead
 *   NETTO   = surplus - lambda x price               what is left after paying the going rate
 *
 * The replacement is the marginal man among the players still FREE (§4.1) - not the league-wide one
 * the sheet was built with - because the pool empties as the auction runs and, on this table, it can
 * be the host's own customised list rather than the listone. That is why the export ships fm and pv
 * and not a frozen surplus: a zero that cannot move answers a question nobody at the table is asking.
 *
 * In a draft the price IS the FVM (fanta-asta-live forces it), so `lambda` is not estimated but
 * computed: order the free men by surplus per credit, walk down until the table's residual demand is
 * exhausted, and the last one who fits sets the exchange rate. §11.2 says exactly this, and it is the
 * one place a draft is easier than an auction with raises.
 */

/** One player's engine numbers, as the bundle's sheet carries them. */
export interface EngineNumbers {
  /** The predicted fantamedia. Null when the core refuses to price him: `unpricedReason` says why. */
  fm: number | null;
  /** Expected appearances over the platform's WHOLE calendar (`matchdaysTarget`). */
  pv: number | null;
  /** The role the two above are measured in - the game's own vocabulary (`pc`, `dc`, `por`, ...). */
  slot: string | null;
  /** The league-wide zero the sheet used. We recompute ours, and show this to say what moved. */
  replacementFm: number | null;
  /** The sheet's own surplus, at the league zero. Reference only: never what a live panel ranks by. */
  surplusLeague: number | null;
  unpricedReason: string | null;
  /** The declared fallback for a man the core cannot price, with the penalty already inside. */
  estFm: number | null;
  estPv: number | null;
  estConfidence: number | null;
  estBasis: string | null;
  estNote: string | null;
  /** MEASURED last season: minutes over his own championship, and the matches they were played in. */
  minutesFullSeason: number | null;
  seasonMatches: number | null;
}

/** Which of the two valuations a row is standing on. A ranking that mixes them says which is which. */
export type ValuationBasis = 'measured' | 'estimated' | 'none';

export interface Valuation {
  basis: ValuationBasis;
  fm: number | null;
  pv: number | null;
  slot: string | null;
  /** Multiplies the SURPLUS and never the fantamedia: indeterminacy is a fact about the number. */
  confidence: number;
  note: string | null;
}

/**
 * The one valuation a row stands on, measured first.
 *
 * The estimate uses the same arithmetic times a confidence, so one column ranks the whole list
 * (§«ogni calciatore DEVE avere il suo SURPLUS»). A man with neither is NOT a zero: he has no number,
 * and `basis: 'none'` is what the panel prints instead of inventing one.
 */
export function valuationOf(numbers: EngineNumbers | undefined): Valuation {
  if (numbers?.fm != null && numbers.pv != null) {
    return { basis: 'measured', fm: numbers.fm, pv: numbers.pv, slot: numbers.slot, confidence: 1, note: null };
  }
  if (numbers?.estFm != null && numbers.estPv != null) {
    return {
      basis: 'estimated',
      fm: numbers.estFm,
      pv: numbers.estPv,
      slot: numbers.slot,
      confidence: numbers.estConfidence ?? 1,
      note: numbers.estNote ?? numbers.estBasis ?? null,
    };
  }
  return { basis: 'none', fm: null, pv: null, slot: numbers?.slot ?? null, confidence: 0, note: numbers?.unpricedReason ?? null };
}

/**
 * How many men of each slot the table is going to buy, DERIVED from the sheet instead of configured.
 *
 * The sheet's own `engine_replacement_fm` already encodes the league setup (`teams x squad_slots`, via
 * `features.replacement_levels`), so the count of men it puts above that line IS the league's demand
 * for that slot. Reading it back costs nothing and inherits the league without re-deriving it - and
 * re-deriving it here would be a second implementation of a number the gate already owns.
 */
export function demandBySlot(rows: Iterable<EngineNumbers>): Map<string, number> {
  const demand = new Map<string, number>();
  for (const row of rows) {
    const valuation = valuationOf(row);
    if (!valuation.slot || valuation.fm == null || row.replacementFm == null) continue;
    if (valuation.fm < row.replacementFm) continue;
    demand.set(valuation.slot, (demand.get(valuation.slot) ?? 0) + 1);
  }
  return demand;
}

/** The game's own rules, as `config/mantra_modules.json` states them. */
export interface MantraModules {
  /** Slot type -> the listone roles allowed to occupy it (`DC/B` -> `Dc`, `B`). */
  slot_roles: Record<string, string[]>;
  /** Module name -> its lines of slot types (`3-4-3` -> D/M/T/A). The keeper is outside the lines. */
  modules: Record<string, Record<string, string[]>>;
}

/**
 * How many outfield places each role occupies, averaged over the eleven legal shapes.
 *
 * THIS IS A MODEL CHOICE and it is declared rather than measured: every place contributes one unit of
 * demand, split equally among the roles allowed to fill it (a `W/A` counts a half for `w` and a half
 * for `a`), and the eleven shapes are weighted equally because nobody has measured which ones a table
 * will play. The proper answer is the fixed point of §15.4 - assume a distribution of shapes, simulate
 * the draft, re-derive it - and this is the placeholder that replaces a WORSE one: splitting a roster
 * by macro-role quotas read «the league will buy all 124 left backs», which doubled the surplus of the
 * best `ds` in the listone (measured 10/08/2026).
 *
 * The shares sum to the ten outfield places of a shape, so scaling them by a squad's outfield size
 * gives a demand in men and not in places.
 */
export function slotShares(rules: MantraModules): Map<string, number> {
  const totals = new Map<string, number>();
  const shapes = Object.values(rules.modules ?? {});
  if (!shapes.length) return totals;

  for (const shape of shapes) {
    for (const line of Object.values(shape)) {
      for (const place of line) {
        const roles = rules.slot_roles?.[place] ?? [];
        if (!roles.length) continue;
        for (const role of roles) {
          const slot = role.toLowerCase();
          totals.set(slot, (totals.get(slot) ?? 0) + 1 / roles.length);
        }
      }
    }
  }
  for (const [slot, total] of totals) totals.set(slot, total / shapes.length);
  return totals;
}

/**
 * The men of each role the table will roster, from the shapes and the squad size the session declares.
 *
 * `outfield` is how many non-keeper slots a squad has (22 here), so a team keeps `outfield / 10` men
 * per starting place and the split between roles is the shapes'. Keepers are not in here: their slot
 * count is stated by the session and, with the porte rule on, their unit is a club.
 */
export function demandFromShapes(
  shares: Map<string, number>,
  teams: number,
  outfield: number,
): Map<string, number> {
  const places = [...shares.values()].reduce((sum, share) => sum + share, 0);
  const demand = new Map<string, number>();
  if (!places || !teams || !outfield) return demand;
  for (const [slot, share] of shares) {
    demand.set(slot, Math.max(1, Math.round((share / places) * outfield * teams)));
  }
  return demand;
}

export interface FreeMan {
  id: number;
  slot: string | null;
  fm: number | null;
}

/**
 * The live zero: per slot, the fantamedia of the last free man the table still has room for.
 *
 * As the pool empties the zero moves on its own, and in the direction that matches the football: when
 * the men taken were all above the line, demand falls with the pool and the marginal man is unchanged;
 * when somebody digs below it, the bench gets better and every remaining surplus shrinks.
 *
 * `taken` is per slot, so the demand that remains is the initial one minus what is already bought. If
 * a slot runs out of free men - a customised list can be a subset of the listone - the zero is the
 * worst man still available and the caller can say the pool is thin, which is better than a zero
 * borrowed from a pool that does not exist.
 */
export function liveReplacements(
  free: Iterable<FreeMan>,
  demand: Map<string, number>,
  taken: Map<string, number>,
): Map<string, number> {
  const bySlot = new Map<string, number[]>();
  for (const man of free) {
    if (!man.slot || man.fm == null) continue;
    const list = bySlot.get(man.slot) ?? [];
    list.push(man.fm);
    bySlot.set(man.slot, list);
  }

  const zeros = new Map<string, number>();
  for (const [slot, values] of bySlot) {
    values.sort((a, b) => b - a);
    const left = Math.max(0, (demand.get(slot) ?? 0) - (taken.get(slot) ?? 0));
    if (!left) continue;                        // nobody is buying this slot any more: no zero exists
    const index = Math.min(left, values.length) - 1;
    zeros.set(slot, values[index]);
  }
  return zeros;
}

/**
 * Points over the replacement, on the horizon actually being played.
 *
 * `horizon` is n/N - the rounds of this competition over the calendar `pv` is expressed on (§19.5).
 * It is the same constant for every player, so it moves the cifre and can never reorder the list;
 * what it buys is that a 4-round competition does not quote a full season's total.
 */
export function surplusOf(valuation: Valuation, replacementFm: number | null, horizon = 1): number | null {
  if (valuation.fm == null || valuation.pv == null || replacementFm == null) return null;
  return (valuation.fm - replacementFm) * valuation.pv * horizon * valuation.confidence;
}

/**
 * The GROSS worth: fantamedia times expected appearances, nothing subtracted.
 *
 * It is the surplus's other half - `surplus = value - replacement x pv` - and in a DRAFT it is the
 * better currency for outfield players: measured over the five gate windows (10/08/2026), what
 * separates criteria is availability, and the value carries it as a factor while the surplus charges
 * a per-slot scarcity the mantra rulebook does not impose. The confidence multiplies the number for
 * the same reason it multiplies the surplus: indeterminacy is a fact about the number, and one column
 * has to rank the whole list. No horizon here - it cancels in the 0-99 scale below, which is the only
 * unit the panel shows this in.
 */
export function valueOf(valuation: Valuation): number | null {
  if (valuation.fm == null || valuation.pv == null) return null;
  return valuation.fm * valuation.pv * valuation.confidence;
}

/**
 * The same worth on the 0-99 scale the table can actually read: 99 = the best man of THIS listone.
 *
 * The reference is the maximum over the whole session listone - taken players included - so the scale
 * does not shift as the pool empties: a 60 said at the first pick is a 60 at the last. Linear, not a
 * percentile, so twice the fantapunti reads as twice the score.
 */
export function score99(value: number | null, max: number | null): number | null {
  if (value == null || max == null || max <= 0) return null;
  return Math.max(0, Math.min(99, Math.round((value / max) * 99)));
}

export interface Priced {
  id: number;
  surplus: number | null;
  /** What the table asks for him. In a draft this is the FVM, which is the price by the rules. */
  price: number;
}

/**
 * The exchange rate between a credit and a fantapunto, right now.
 *
 * Walk the free men by surplus per credit, richest ratio first, spending the table's residual DEMAND
 * (slots, not credits - in a draft the budget is implicit and the order rule equalises it, §11.2).
 * The last one who still fits sets lambda. Null when nothing is left to buy or nothing is priced: a
 * rate nobody can pay is not a rate, and the caller shows the surplus alone rather than a made-up net.
 */
export function lambdaOf(priced: Iterable<Priced>, slotsLeft: number): number | null {
  if (slotsLeft <= 0) return null;
  const ranked = [...priced]
    .filter((man) => man.surplus != null && man.surplus > 0 && man.price > 0)
    .map((man) => ({ ratio: man.surplus! / man.price }))
    .sort((a, b) => b.ratio - a.ratio);
  if (!ranked.length) return null;
  return ranked[Math.min(slotsLeft, ranked.length) - 1].ratio;
}

/** What is left after paying the going rate. Positive = the table is selling him under his worth. */
export function netOf(surplus: number | null, price: number, lambda: number | null): number | null {
  if (surplus == null || lambda == null) return null;
  return surplus - lambda * price;
}

/**
 * The same points in the unit the table thinks in: how many over `every` rounds.
 *
 * A season total is not a quantity anybody feels; «+3 ogni 10 giornate» is. It is one constant for
 * every player, so it can never reorder the list - and it is the SAME number in any competition,
 * which is what makes two different auctions comparable at all. The man's own absences are already
 * inside `points`, because the surplus was built on his expected appearances and not on the calendar.
 */
export function per(points: number | null, rounds: number | null, every = 10): number | null {
  if (points == null || !rounds) return null;
  return (points / rounds) * every;
}
