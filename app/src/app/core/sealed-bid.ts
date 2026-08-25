import { ClassicRole } from './players-store';
import { titolaritaRank } from './titolarita';

/**
 * ASTE A BUSTA CHIUSA: what the rosters of a finished round say about the round that comes.
 *
 * A sealed bid is a different game from the live auction the rest of this app is built around, and the
 * difference is not the interface. In a live auction you learn the price while you pay it; here every
 * envelope is opened at once, the winner pays HIS OWN number (first price), the losers pay nothing, and
 * a tie awards nobody - the man simply returns to the next round. So the quantity that decides a bid is
 * not «what is he worth» but «what will it TAKE», and those are two different questions with two
 * different answers, exactly as the two zeros of the surplus are (root CLAUDE.md, «the zero of a metric
 * is a question»).
 *
 * Everything here is a DEDUCTION from the rulebook and from what the league has already done - the
 * boundary that put a real club's board in the toolkit and a fanta eleven in the app. Nothing in this
 * file predicts a footballer: the valuation is the sheet's (`surplus`, read and never recomputed) and
 * what is computed here is about SLOTS, CREDITS and RIVALS.
 *
 * Three things it measures off the league's own history rather than assuming:
 *
 *  - WHAT THE ROOM PAYS FOR. Scored on the 125 awards of round 1 of the operator's league, the winning
 *    bid ranks with the FVM at Spearman +0.719 and with the engine's own surplus at +0.508. The room
 *    bids on the price. That is not a complaint, it is the edge: where our number and theirs disagree,
 *    the disagreement is available at the price of the cheaper opinion.
 *  - WHERE CONTENTION IS. `pressure` below - how deep inside a role's still-open demand a man sits -
 *    predicts the price paid BETTER than the FVM does (+0.738), and unlike a count of interested rivals
 *    it is the same quantity in every round.
 *  - WHAT A BID HAS TO BEAT. Not from a curve: from the precedents themselves. The obvious model -
 *    share the money out in proportion to the FVM - was written first and MEASURED against round 1, and
 *    it is a poor point predictor (median relative error 58%, 54% of awards inside a 0.5x-2x band),
 *    because a winning bid is not a price but the MAXIMUM of however many envelopes arrived, and 37 of
 *    125 awards arrived alone and cost 1-2 credits. So `askFor` returns real comparable awards and their
 *    spread, and the screen shows them: a range with its precedents is honest where a point is not.
 */

/** One awarded man, as a league export states him: who got him and what he paid. */
export interface Award {
  team: string;
  fcId: number;
  paid: number;
}

/** The league's own rules. Every one of them changes a bid, so none of them is hard-coded. */
export interface LeagueRules {
  /** Credits each manager started with. */
  budget: number;
  /** How many men of each role a squad holds - the Classic 3/8/8/6 unless the league says otherwise. */
  slots: Record<ClassicRole, number>;
  /** How many rounds the market runs for in total. */
  rounds: number;
  /**
   * Whether a filled role is a role you may no longer bid in.
   *
   * It is the single most exploitable fact the rules give us about a rival, because it is not a guess:
   * a team with eight defenders is OUT of the defence market, whatever it wants. Declared rather than
   * inferred, because leagues differ and reading it wrong would silently delete rivals from a market.
   */
  roleLock: boolean;
  /** The platform's own calendar - what a share of a season is a share OF, and what the sheet predicted on. */
  matchdays: number;
  /**
   * How many rounds the COMPETITION you are buying for actually covers.
   *
   * Not the same as `matchdays` and the difference is not pedantic: a market held after the first round
   * is a market for a 37-round competition, while `engine_pv_pred` is a forecast over all 38. What you
   * will collect is his prediction cut to that window, so every total scales by `horizon / matchdays`.
   *
   * It is a UNIT and the code says so on purpose, because the tempting mistake is to treat it as a
   * signal: the factor is the same for every player, so it changes every figure on the screen and
   * cannot reorder a single row - `gainOf` keeps the availability SHARE on the full calendar for
   * exactly that reason (his appearances and the window shrink together, so the share does not move,
   * and the league's own floor keeps meaning what it meant). A test holds both halves.
   */
  horizon: number;
  /**
   * `SURPLUS x (Pv/matchdays)^exponent`, from `config/league_config.json`. You set the lineup before
   * knowing whether he plays, so what you collect is the appearances you could SEE COMING; 0.5 is the
   * measured shape of that catchability and not a risk knob.
   */
  reliability: number;
  /**
   * The share of the season below which a man is not RANKED at all. Also the league config's: a man who
   * played once is not a man you could have fielded, so he does not belong in a ranking of who to buy -
   * which is a category question and not a discount.
   */
  minAvailability: number;
}

export const CLASSIC_SLOTS: Record<ClassicRole, number> = { P: 3, D: 8, C: 8, A: 6 };

export const DEFAULT_RULES: LeagueRules = {
  budget: 1000,
  slots: CLASSIC_SLOTS,
  rounds: 9,
  roleLock: true,
  matchdays: 38,
  horizon: 38,
  reliability: 0.5,
  minAvailability: 0.35,
};

/**
 * The least a man has to carry for this module to reason about him.
 *
 * Structural on purpose: `SquadMan` satisfies it, so the page hands over the store's own rows and there
 * is no second valuation anywhere - but a test can build one in four lines instead of forty.
 */
export interface Bidder {
  fcId: number;
  name: string;
  club: string;
  role: ClassicRole;
  /** The listone's fantavalore on THIS platform. It is what the room bids on, so it is not optional. */
  fvm: number | null;
  /** The sheet's `engine_surplus`, or its declared fallback `est_surplus`. Read, never recomputed. */
  surplus: number | null;
  surplusIsEstimate: boolean;
  /** `engine_pv_pred`: the matches with a vote the engine expects, on this platform's calendar. */
  expected: number | null;
  titolarita: string | null;
  /** `desc_spm`: the same surplus converted into credits on the market's own budget. Reporting only. */
  spm: number | null;
}

export const ROLES: ClassicRole[] = ['P', 'D', 'C', 'A'];

/** Where one manager stands: what he holds, what he may still buy, and with what. */
export interface TeamState {
  team: string;
  men: (Bidder & { paid: number })[];
  spent: number;
  credits: number;
  taken: Record<ClassicRole, number>;
  free: Record<ClassicRole, number>;
  slotsFree: number;
  /**
   * The most he can put on ONE envelope and still fill every remaining slot at a credit apiece.
   *
   * Not the same as his balance, and the difference decides whether he can reach a name at all: with 143
   * credits and six slots the ceiling is 138, and a man who clears 138 is out of his reach however rich
   * he looks in the standings.
   */
  ceiling: number;
}

/** A cumulative export of every roster, as the league site writes it. */
export type Snapshot = Award[];

/** One round, reconstructed: who was awarded in it, and the state each manager was in before it. */
export interface Round {
  index: number;
  awards: Award[];
  /** The states as they were when the envelopes for this round were written. */
  before: Map<string, TeamState>;
}

const EMPTY_COUNT = (): Record<ClassicRole, number> => ({ P: 0, D: 0, C: 0, A: 0 });

/**
 * Parse a league roster export: `team,fc_id,credits`, with `$,$,$` separating one squad from the next.
 *
 * The team name is taken as everything BEFORE the last two commas, because a squad may legitimately be
 * called «Piangi, Meno FC» and splitting on the first comma would file its men under a team that does
 * not exist - the kind of silent mis-join this project has paid for four times with club names.
 */
export function parseAwards(csv: string): Award[] {
  const out: Award[] = [];
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('$')) continue;
    const last = line.lastIndexOf(',');
    if (last < 0) continue;
    const prev = line.lastIndexOf(',', last - 1);
    if (prev < 0) continue;
    const team = line.slice(0, prev).trim();
    const fcId = Number(line.slice(prev + 1, last));
    const paid = Number(line.slice(last + 1));
    if (!team || !Number.isFinite(fcId) || !Number.isFinite(paid)) continue;
    out.push({ team, fcId, paid });
  }
  return out;
}

/** Where every manager stands after a set of awards. */
export function teamStates(
  awards: readonly Award[],
  byId: ReadonlyMap<number, Bidder>,
  rules: LeagueRules,
  teams?: readonly string[],
): Map<string, TeamState> {
  const names = new Set<string>(teams ?? []);
  for (const award of awards) names.add(award.team);
  const out = new Map<string, TeamState>();
  for (const team of names) {
    out.set(team, {
      team,
      men: [],
      spent: 0,
      credits: rules.budget,
      taken: EMPTY_COUNT(),
      free: { ...rules.slots },
      slotsFree: ROLES.reduce((sum, role) => sum + rules.slots[role], 0),
      ceiling: 0,
    });
  }
  for (const award of awards) {
    const state = out.get(award.team);
    const man = byId.get(award.fcId);
    if (!state || !man) continue;
    state.men.push({ ...man, paid: award.paid });
    state.spent += award.paid;
    state.taken[man.role] += 1;
  }
  for (const state of out.values()) {
    state.credits = rules.budget - state.spent;
    for (const role of ROLES) {
      state.free[role] = Math.max(0, rules.slots[role] - state.taken[role]);
    }
    state.slotsFree = ROLES.reduce((sum, role) => sum + state.free[role], 0);
    state.ceiling = Math.max(0, state.credits - Math.max(0, state.slotsFree - 1));
  }
  return out;
}

/**
 * Rebuild one round per snapshot, so an award can be scored against the state it was decided in.
 *
 * A roster export is CUMULATIVE - it says who is in a squad today, not when he arrived - so the rounds
 * are the differences between consecutive exports. Feeding a later round's award into an earlier round's
 * demand would price it against a market that no longer existed, which is the same defect as dividing a
 * numerator by somebody else's calendar.
 */
export function roundsOf(
  snapshots: readonly Snapshot[],
  byId: ReadonlyMap<number, Bidder>,
  rules: LeagueRules,
): Round[] {
  const teams = new Set<string>();
  for (const snapshot of snapshots) for (const award of snapshot) teams.add(award.team);
  const names = [...teams];
  const rounds: Round[] = [];
  let seen = new Set<number>();
  let cumulative: Award[] = [];
  snapshots.forEach((snapshot, index) => {
    const fresh = snapshot.filter((award) => !seen.has(award.fcId));
    rounds.push({
      index: index + 1,
      awards: fresh,
      before: teamStates(cumulative, byId, rules, names),
    });
    cumulative = [...snapshot];
    seen = new Set(snapshot.map((award) => award.fcId));
  });
  return rounds;
}

/** How many slots of each role the rivals of `me` still have to fill. */
export function roleDemand(
  states: ReadonlyMap<string, TeamState>,
  me?: string | null,
): Record<ClassicRole, number> {
  const out = EMPTY_COUNT();
  for (const state of states.values()) {
    if (me && state.team === me) continue;
    for (const role of ROLES) out[role] += state.free[role];
  }
  return out;
}

/**
 * How deep inside his role's still-open demand a free man sits: 1 at the top of it, 0 outside it.
 *
 * The obvious alternative - count the rivals whose shortlist would hold him - was written first and is
 * NOT comparable between rounds: in round 1 every manager had all 25 slots, so every shortlist was long
 * and every good name scored high, while in round 2 the same man scores 3 because the shortlists are
 * short. Two numbers in two units, which is the mistake the `zeros` harness made about itself. Rank
 * against demand is the same question in every round - «do the slots still to be filled in his role
 * reach down as far as him?» - and measured on round 1 it predicts the price paid better than the FVM
 * (Spearman +0.738 against +0.719).
 *
 * The ranking inside a role is by FVM because that is what the room demonstrably bids on, not because
 * it is the better valuation: on Serie A our own value beats the price at ranking the outcome. This is a
 * model of THEM.
 */
export function pressureOf(
  pool: readonly Bidder[],
  demand: Record<ClassicRole, number>,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const role of ROLES) {
    const men = pool
      // A man THIS listone does not quote has no place in a ranking BY that quotation. Leaving him in
      // with `fvm ?? 0` sorts him last, which reads as «nobody is bidding on him» - a claim about the
      // room, made out of a missing cell. It is «vuoto = ignoto, mai zero» broken exactly where it
      // decides a bid: measured on the 2026-27 Serie A sheet, 82 rows of 605 have no quotation on this
      // platform, and every one of them was landing in the cheapest price band as a two-credit bargain.
      // He gets NO entry here, and `candidatesOf` turns that into a declared unknown.
      .filter((man) => man.role === role && man.fvm != null)
      .sort((left, right) => (right.fvm ?? 0) - (left.fvm ?? 0) || left.fcId - right.fcId);
    const wanted = demand[role];
    men.forEach((man, rank) => {
      out.set(man.fcId, wanted > 0 ? Math.max(0, 1 - rank / wanted) : 0);
    });
  }
  return out;
}

/** One award of the past, placed on the two axes a future bid is judged on. */
export interface Precedent {
  fcId: number;
  name: string;
  team: string;
  paid: number;
  pressure: number;
  fvm: number;
  round: number;
}

/**
 * Every past award, each priced against the demand that existed when its envelope was written.
 *
 * This is the whole memory of the league, and it is the only thing that can say what a bid has to beat:
 * the site publishes the WINNING number and nothing else, so the losing envelopes are unobservable and
 * no amount of modelling will recover them. What the winners do carry is an order statistic - the
 * maximum of the field - and a lookup of comparable maxima is the honest use of that.
 */
export function precedentsOf(rounds: readonly Round[], pool: readonly Bidder[]): Precedent[] {
  const byId = new Map(pool.map((man) => [man.fcId, man]));
  const out: Precedent[] = [];
  for (const round of rounds) {
    const takenBefore = new Set<number>();
    for (const state of round.before.values()) {
      for (const man of state.men) takenBefore.add(man.fcId);
    }
    const free = pool.filter((man) => !takenBefore.has(man.fcId));
    // The demand EXCLUDING the manager who won him, because that is the pressure his envelope had to
    // beat - and it is the same quantity `candidatesOf` measures for us, which excludes us. Reading the
    // precedents on the ten-team demand and the candidates on the nine-team one would put the price
    // ladder and the men being priced against it on two different scales: measured on round 1, it moves
    // the head band from 63 awards to 66 and every recommendation with it.
    const pressureFor = new Map<string, Map<number, number>>();
    for (const team of round.before.keys()) {
      pressureFor.set(team, pressureOf(free, roleDemand(round.before, team)));
    }
    for (const award of round.awards) {
      const man = byId.get(award.fcId);
      if (!man) continue;
      out.push({
        fcId: award.fcId,
        name: man.name,
        team: award.team,
        paid: award.paid,
        pressure: pressureFor.get(award.team)?.get(award.fcId) ?? 0,
        fvm: man.fvm ?? 0,
        round: round.index,
      });
    }
  }
  return out;
}

/** What it took to win men like this one, and which men those were. */
export interface Ask {
  /** The median of the comparables: what a name like this usually went for. */
  mid: number;
  /** The 75th percentile - the bid this module recommends, and what it means. */
  ask: number;
  /** The 90th - what it takes to be nearly sure, when a name is worth being sure about. */
  safe: number;
  /** The actual awards behind those numbers. A range without its precedents is a guess with a decimal. */
  comparables: Precedent[];
}

/** How many past awards a recommendation is allowed to rest on. Nine is about a tenth of one round. */
export const COMPARABLES = 9;

function quantile(sorted: readonly number[], share: number): number {
  if (!sorted.length) return 1;
  const at = Math.min(sorted.length - 1, Math.round(share * (sorted.length - 1)));
  return sorted[at];
}

/**
 * The nearest past awards in (pressure, log FVM), and their spread.
 *
 * The two axes are put on one scale before they are compared: pressure runs 0 to 1 while `log1p(FVM)`
 * runs to about 6, so the FVM distance is divided by 6 and neither axis silently decides the neighbours.
 * The FVM is read through a logarithm because the room's own bids are: the step from 20 to 40 moves a
 * price far more than the step from 300 to 320.
 */
export function askFor(
  pressure: number,
  fvm: number,
  precedents: readonly Precedent[],
  neighbours = COMPARABLES,
): Ask {
  if (!precedents.length) return { mid: 1, ask: 1, safe: 1, comparables: [] };
  const target = Math.log1p(Math.max(0, fvm));
  const near = [...precedents]
    .map((one) => ({
      one,
      distance: Math.abs(pressure - one.pressure) + Math.abs(target - Math.log1p(one.fvm)) / 6,
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, neighbours)
    .map((entry) => entry.one);
  const prices = near.map((one) => one.paid).sort((left, right) => left - right);
  return {
    mid: Math.max(1, quantile(prices, 0.5)),
    ask: Math.max(1, quantile(prices, 0.75)),
    safe: Math.max(1, quantile(prices, 0.9)),
    comparables: near,
  };
}

/**
 * The share of comparable past awards this offer would have OUTBID.
 *
 * Read with a strict `<` and that is the regulation, not a rounding taste: equalling the field is a TIE,
 * and a tie awards the man to nobody. So matching a precedent is not winning against it.
 *
 * It is a frequency and it says what it is: «of the men who went at a comparable depth of demand and a
 * comparable price, this many went for less than you are offering». Two things it deliberately does not
 * claim. The precedents are men who WERE awarded, so the ladder is conditioned on somebody having
 * wanted them - a name nobody bid on at all never appears. And 125 awards over four pressure bands is a
 * coarse instrument: it is honest about the shape of the risk, not about the second decimal.
 */
export function winChance(offer: number, ask: Ask): number | null {
  if (!ask.comparables.length) return null;
  const beaten = ask.comparables.filter((one) => one.paid < offer).length;
  return beaten / ask.comparables.length;
}

/**
 * WHAT IT COST TO WIN, by how deep in his role's demand the man sat: the price ladder of the league.
 *
 * The bands are the pressure's own quarters and the WORDS are the operator's, so a hover can say what
 * «testa» means without him having to remember the arithmetic. Every band carries what it is, how many
 * awards it holds, its median - and REAL examples out of the league's own history, because a band
 * explained with an invented name is a band explained with nothing.
 *
 * `fuori dalla domanda` is not the bottom of the ladder, it is off it: the still-open slots of his role
 * do not reach down as far as him, which is why that band is where 14 of 20 awards cost 1-2 credits.
 */
export type LadderKey = 'head' | 'middle' | 'tail' | 'outside';

export interface LadderBand {
  key: LadderKey;
  label: string;
  /** What the band IS, in the operator's own units. Drawn as the tooltip of its row. */
  hint: string;
  count: number;
  /** How many of them went at one or two credits: the envelopes that arrived alone. */
  cheap: number;
  median: number | null;
  /** The dearest, the middle one and the cheapest of that band - real awards, with what they cost. */
  examples: Precedent[];
}

const LADDER_SHAPE: { key: LadderKey; label: string; hint: string; keep: (pressure: number) => boolean }[] = [
  {
    key: 'head',
    label: 'testa (67-100%)',
    hint:
      'I primi della domanda: gli slot ancora aperti del suo ruolo arrivano fino a lui e oltre, quindi ' +
      'quasi tutti possono bustarci e quasi tutti lo vogliono. È la banda dove si paga.',
    keep: (p) => p >= 0.67,
  },
  {
    key: 'middle',
    label: 'metà (33-67%)',
    hint:
      'A metà della domanda: lo raggiungono ancora, ma dopo i nomi grossi del ruolo. Qui il prezzo ' +
      'crolla rispetto alla testa, ed è la banda dove una busta decisa vale di più.',
    keep: (p) => p >= 0.34 && p < 0.67,
  },
  {
    key: 'tail',
    label: 'coda (0-33%)',
    hint:
      'In coda alla domanda: ci arrivano solo gli ultimi slot liberi del ruolo. Pochi contendenti, ' +
      'quindi spesso basta una busta bassa - ma è anche dove nascono le parità.',
    keep: (p) => p > 0 && p < 0.34,
  },
  {
    key: 'outside',
    label: 'fuori dalla domanda',
    hint:
      'La domanda ancora aperta del suo ruolo NON arriva fino a lui: sulla carta non lo vuole nessuno. ' +
      'Non vuol dire che sia scarso, vuol dire che gli slot di quel ruolo finiscono prima.',
    keep: (p) => p <= 0,
  },
];

/** The ladder, read off the awards themselves. Empty bands are dropped: a band with nobody in it says nothing. */
export function ladderOf(precedents: readonly Precedent[]): LadderBand[] {
  return LADDER_SHAPE.map(({ key, label, hint, keep }) => {
    const inside = precedents
      .filter((one) => keep(one.pressure))
      .sort((left, right) => right.paid - left.paid);
    const middle = inside[Math.floor(inside.length / 2)];
    // The dearest, the middle one and the cheapest - deduplicated, because a band of one award must
    // not print the same name three times as if it were three cases.
    const examples: Precedent[] = [];
    for (const one of [inside[0], middle, inside.at(-1)]) {
      if (one && !examples.some((seen) => seen.fcId === one.fcId)) examples.push(one);
    }
    return {
      key,
      label,
      hint,
      count: inside.length,
      cheap: inside.filter((one) => one.paid <= 2).length,
      median: middle ? middle.paid : null,
      examples,
    };
  }).filter((band) => band.count > 0);
}

/**
 * THE GAIN: the one absolute number this page values a man with, and why it is this one.
 *
 * The operator asked (25/08/2026) which currency gives an ABSOLUTE value here - the Overall, the
 * surplus, or something else - and named whatever came out `GAIN`. It is the sheet's SURPLUS, cut to
 * the competition's window and discounted by how much of the season you can see coming; the two
 * candidates it beat are refused for reasons this project has already written down, not by taste.
 *
 *  - NOT the OVERALL. That column is a TOTAL WITH NO ZERO by the operator's own definition of 18/08/2026
 *    («Pv x (MVa + bonus), senza rimpiazzo sottratto»), and an auction is nothing but a comparison
 *    against the man you would otherwise have had: with no zero it crowns whoever plays and says nothing
 *    about what a SLOT gains by holding him. Its own reading is `letture-app-v1.md` §9 - with a
 *    replacement subtracted, the role medians moved by thirty points.
 *  - NOT the bare SURPLUS. It is already the right subtraction (over the roster-marginal man of his own
 *    role, so the four roles are comparable by construction), and it is a forecast over 38 matchdays
 *    while this market buys 37 of them - «a number must say what it is measured against». And it prices
 *    a season you have to be able to FIELD: you set the lineup before knowing whether he plays, so what
 *    you collect is the appearances you could see coming, which is the league config's own
 *    `reliability` exponent and not a risk knob of ours.
 *
 * So: `gain = surplus x (horizon / matchdays) x (Pv / matchdays) ^ reliability`, silent below the
 * league's own availability floor. Null and never zero for a man under the floor or without a number:
 * an empty cell is a statement, and ranking him at the bottom would be a claim nobody measured.
 *
 * It is REPORTING in the sense that matters here - no gate owns it, because the sheet's surplus is the
 * gated part and the two factors above are a UNIT and a declared league constant. What it must never
 * become is a second valuation: nothing in this file recomputes a footballer.
 */
export function gainOf(man: Bidder, rules: LeagueRules): number | null {
  if (man.surplus == null || man.expected == null) return null;
  // The SHARE stays on the full calendar: his appearances and the window shrink by the same factor, so
  // the quantity «how much of the season does he play» is untouched - and so is the league's own floor,
  // which is a statement about him and not about how late the market is being held.
  const share = man.expected / rules.matchdays;
  if (share < rules.minAvailability) return null;
  return man.surplus * (rules.horizon / rules.matchdays) * Math.pow(share, rules.reliability);
}

/**
 * The appearances of his you will actually COLLECT: his prediction cut to the competition's window.
 *
 * Shown beside a name rather than left implicit, because `engine_pv_pred` is a forecast over the whole
 * calendar and a screen that prints it under a 37-round competition is quoting a number measured against
 * something else - the defect this project keeps paying for.
 */
export function appearancesIn(man: Bidder, rules: LeagueRules): number | null {
  if (man.expected == null) return null;
  return man.expected * (rules.horizon / rules.matchdays);
}

/** The four words a GAIN is drawn with, plus the fifth that is not a word about football. */
export type GainBand = 'ottimo' | 'buono' | 'medio' | 'scarso' | 'ignoto';

export const GAIN_WORD: Record<GainBand, string> = {
  ottimo: 'ottimo',
  buono: 'buono',
  medio: 'medio',
  scarso: 'scarso',
  ignoto: 'ignoto',
};

/**
 * Where the four bands are cut. Percentiles of the LISTONE and not thresholds anybody chose.
 *
 * `ottimo` is the best tenth of the men this sheet can price, `buono` the best third, `medio` down to
 * the fortieth percentile. Saying which POOL a band is a fact about is half the measurement - the
 * lesson the app's Overall was rebuilt on, 16/08/2026 - and the pool here is stated twice: it is the
 * whole quoted listone of this league, never the men still free.
 */
export const GAIN_SHARES = { top: 0.9, good: 0.7, fair: 0.4 } as const;

/** The three cuts, with the sample they were cut on. A scale without its sample is a decoration. */
export interface GainScale {
  top: number;
  good: number;
  fair: number;
  sample: number;
}

/**
 * Cut the four bands on the WHOLE pool, once.
 *
 * On the free board instead they would move under the operator's feet: the same man would go from
 * `buono` to `ottimo` because somebody else was bought, which is a statement about the market and not
 * about him. The colour of a name must mean the same thing in round 2 and in round 9.
 */
export function gainScale(pool: readonly Bidder[], rules: LeagueRules): GainScale {
  const gains = pool
    .map((man) => gainOf(man, rules))
    .filter((one): one is number => one != null)
    .sort((left, right) => left - right);
  return {
    top: quantile(gains, GAIN_SHARES.top),
    good: quantile(gains, GAIN_SHARES.good),
    fair: quantile(gains, GAIN_SHARES.fair),
    sample: gains.length,
  };
}

/**
 * Which of the four words a gain is - and `ignoto` for the two cases that are not a low number.
 *
 * A man the sheet cannot price and a scale with nobody in it are both «we cannot say», so neither gets
 * a colour: painting them `scarso` would be a verdict nobody gave. It is the same rule the pressure
 * column obeys one screen up.
 */
export function gainBandOf(gain: number | null, scale: GainScale): GainBand {
  if (gain == null || !scale.sample) return 'ignoto';
  if (gain >= scale.top) return 'ottimo';
  if (gain >= scale.good) return 'buono';
  if (gain >= scale.fair) return 'medio';
  return 'scarso';
}

/** A free man with everything a bid needs: what he is worth, what he will cost, who else wants him. */
export interface Candidate {
  man: Bidder;
  /**
   * Null, and never zero, for a man the sheet cannot price or who falls under the availability floor.
   *
   * He stays on the board all the same, because he is still a man the ROOM can bid on and a rival's
   * shortlist is built from the price and not from our opinion. Dropping him here would quietly shrink
   * the market we are modelling; what he must not do is enter a plan of ours, and `allocate` is where
   * that is decided.
   */
  gain: number | null;
  /**
   * Null when THIS listone carries no quotation for him, and then it is an unknown and not a zero.
   *
   * Everything downstream needs the distinction: a pressure of 0 is the measured statement «the demand
   * of his role does not reach down as far as him», while this is «we cannot say». A plan may not
   * contain him - `priced` is where that is enforced - but he stays on the board and stays offerable by
   * hand, which is the same treatment `fanta-eleven.ts` gives a man the sheet cannot price: listed
   * apart, never fielded automatically.
   */
  pressure: number | null;
  ask: Ask;
  /** Which rivals may legally bid on his role at all, richest first. It is a fact, not a forecast. */
  reachedBy: string[];
}

/**
 * Price the whole free board once.
 *
 * Once, and not once per question: the same man is looked at by our own plan and by every rival's
 * shortlist, and two pricings of one name would eventually disagree - the defect this project keeps
 * paying for. So `rivalPlan` below reads this list instead of building its own.
 */
export function candidatesOf(input: {
  pool: readonly Bidder[];
  states: ReadonlyMap<string, TeamState>;
  precedents: readonly Precedent[];
  rules: LeagueRules;
  me: string;
}): Candidate[] {
  const { pool, states, precedents, rules, me } = input;
  const pressure = pressureOf(pool, roleDemand(states, me));
  const rivals = [...states.values()]
    .filter((state) => state.team !== me)
    .sort((left, right) => right.credits - left.credits);
  const out: Candidate[] = [];
  for (const man of pool) {
    const press = pressure.get(man.fcId) ?? null;
    out.push({
      man,
      gain: gainOf(man, rules),
      pressure: press,
      // With no quotation there is no neighbourhood to look him up in, so the ask carries no
      // precedents rather than the cheapest ones the board happens to hold.
      ask: press == null ? { mid: 1, ask: 1, safe: 1, comparables: [] } : askFor(press, man.fvm ?? 0, precedents),
      reachedBy: rivals
        .filter((state) => (rules.roleLock ? state.free[man.role] > 0 : state.slotsFree > 0))
        .map((state) => state.team),
    });
  }
  // Gain first, and whoever has none sorts last on the price: an unknown is not a bad number.
  return out.sort(
    (left, right) =>
      (right.gain ?? -Infinity) - (left.gain ?? -Infinity) ||
      (right.man.fvm ?? 0) - (left.man.fvm ?? 0),
  );
}

/**
 * The men a plan may actually contain: the ones this app can put BOTH numbers on.
 *
 * Two different unknowns and a plan needs neither: no `gain` means we cannot say what he is worth, no
 * `pressure` means we cannot say what he will cost - and a bid is a pair. Whoever fails either test is
 * still on the board and still offerable by hand; he is only kept out of the automatic answer.
 */
export function priced(
  candidates: readonly Candidate[],
): (Candidate & { gain: number; pressure: number })[] {
  return candidates.filter(
    (one): one is Candidate & { gain: number; pressure: number } =>
      one.gain != null && one.pressure != null,
  );
}

/** One recommended envelope. */
export interface Bid {
  candidate: Candidate;
  /** What to write in the envelope. */
  offer: number;
  /**
   * A deliberate CHEAP SHOT: a strong man nobody seems to be chasing, tried for a couple of credits.
   *
   * Drawn as what it is, because it is the one row on the screen that is EXPECTED to lose most of the
   * time - and reading it as a normal recommendation would make the plan look reckless instead of
   * patient. Losing costs nothing; the man comes back next round.
   */
  shot: boolean;
  /** Why this number: the 75th percentile of the comparables, raised toward the 90th if credits allow. */
  raised: boolean;
  /**
   * How often an offer of this size beat a comparable name in the past. Null with no history.
   *
   * The number the screen was missing: «offri 45» says nothing on its own, while «45, e in tre casi
   * simili su quattro sarebbe bastato» says what you are buying and what you are risking.
   */
  chance: number | null;
}

/** The whole plan for one round, with the reading that makes its total interpretable. */
export interface BidPlan {
  bids: Bid[];
  /** What it costs if EVERY envelope wins - the ceiling, and the only figure the budget must respect. */
  spend: number;
  /**
   * What you should actually expect to pay: every offer weighted by how often it has been enough.
   *
   * The distinction is the whole point of a sealed bid and the screen was hiding it. Losing costs
   * nothing, so a plan that reads «257 di 257» is quoting the worst case as if it were the forecast -
   * and a manager who reads it that way leaves credits unspent for a round that will never come back.
   */
  expectedSpend: number;
  /** ...and how many of these twelve envelopes the same frequencies say you will actually win. */
  expectedWins: number;
  gain: number;
  /**
   * ...and the same total weighted by how often each envelope has been enough: what you expect to WIN.
   *
   * The honest headline of a plan that mixes serious bids with lottery tickets, because `gain` above is
   * what you would hold having won every single envelope - which nobody ever does.
   */
  expectedGain: number;
  /** What the same slots would hold if we bought the way the room buys - the null this has to beat. */
  marketGain: number;
  /** Whichever slots no candidate could fill: stated, never quietly dropped. */
  unfilled: Record<ClassicRole, number>;
  /**
   * Where the SICUREZZE rule could not be met, role by role: no regular left the budget could reach.
   *
   * Reported for the reason every cap in this project is reported: a constraint that silently gives up
   * reads exactly like a constraint that was satisfied.
   */
  missingSure: Record<ClassicRole, number>;
  /**
   * How many keepers the plan is betting on ALONE - neither sure starters nor paired with their rival.
   *
   * Zero is the target and the number is on the screen when it is not, because this is the one gamble
   * the operator named explicitly: with three keeper slots, buying the loser of a two-way fight and
   * nobody else costs a third of the department.
   */
  keeperGamble: number;
}

/** Above this many DP states the exact solve is abandoned for the greedy, and the caller is told. */
const DP_LIMIT = 1_500_000;

/** How many candidates per role the solver looks at. Beyond the best few the answer stops changing. */
const PER_ROLE = 16;

/**
 * THE STRATEGY THE PLAN PLAYS, in the operator's own words (25/08/2026) and applied as CONSTRAINTS.
 *
 * The knapsack maximises the gain and that is right about a MAN; three of his sentences are about the
 * SET, which no per-man number can express - and each one arrived as a concrete objection to a concrete
 * recommendation, which is why they are written down with the case that produced them.
 *
 *  1. «Per completare un reparto meglio calciatori che magari portano anche qualche bonus ma
 *     PRINCIPALMENTE DEVONO GIOCARE SEMPRE (anche se in squadre minori)» - on Cabal, a `panchina` at
 *     Juventus the plan was offering two credits for, with 17.6 expected appearances of 38. The gain
 *     discounts him for that already; what it cannot say is that a slot filled by a man who plays half
 *     the season is a slot you cover from the bench on the other half. Hence `SURE_PER_ROLE`.
 *  2. «In una rosa completa bisogna sempre avere almeno un paio di calciatori per ruolo titolarissimi,
 *     gente che porta sempre il 6 a casa che costano poco ma ti assicurano la tranquillità della
 *     panchina ogni giornata» - the same rule, stated as the minimum it is.
 *  3. THE KEEPERS ARE A DIFFERENT GAME, and he said why on Di Gregorio: «quasi sicuramente sarà Vicario
 *     il titolare, e prenderne solo uno dei due è una scommessa troppo rischiosa (abbiamo solo 3 slot
 *     per i portieri)». You field exactly ONE keeper, so what has to turn up is the SHIRT and not the
 *     man: either you own both sides of the fight, or you own somebody who is not in one. His three
 *     ways out, in his own order: the two keepers of one club with a reliable defence; two dependable
 *     first choices to alternate on the calendar; and a third keeper as cover - one who always plays,
 *     or the club-mate of one already bought. Hence `ensureKeepers`, and hence P being exempt from
 *     rule 1: a PAIR is exactly two men of whom only one plays each week, so counting regulars there
 *     would forbid the very strategy he asked for.
 *
 * All three are DECLARED. No gate owns them, nothing measured them, and every one of them reports where
 * it could not be met instead of quietly giving up - which is the only way a constraint stays checkable.
 */

/**
 * HOW MANY MEN PER ROLE MUST SIMPLY PLAY - the operator's rule, dictated 25/08/2026.
 *
 * «In una rosa completa bisogna sempre avere almeno un paio di calciatori per ruolo titolarissimi, gente
 * che porta sempre il 6 a casa che costano poco ma ti assicurano la tranquillità della panchina ogni
 * giornata». It is a DECLARED preference of his and it is written down as one: no gate owns it, nothing
 * measured it, and it is revocable by changing this number.
 *
 * What it is NOT is a taste. A fanta squad fields eleven men every single matchday, so a slot filled by
 * a man who plays half the season is a slot you have to cover from the bench on the other half - and
 * this project has measured what the bench is worth, half a point of fantamedia under the rostered
 * replacement (root CLAUDE.md, «the zero of a metric is a question»). The gain already discounts a man
 * by how much of the season you can see coming; what it cannot do is guarantee that SOMEBODY in that
 * role turns up, because that is a property of the SET and not of a man.
 *
 * It is also why it is a CONSTRAINT and not a currency, exactly as role coverage is on the draft bench:
 * measured there, covering the roles beat every change of currency tenfold.
 */
export const SURE_PER_ROLE = 2;

/**
 * HOW MANY MEN OF A ROLE MUST PLAY, all in: the eleven first, his «un paio per ruolo» as the floor.
 *
 * The operator's last word on 25/08/2026 - «le buste consigliate devono rispecchiare i consigli che dai
 * reparto per reparto» - and it is a rule about CONSISTENCY, not a new preference: the department
 * verdict calls a role `scoperto` when it cannot FIELD what a shape asks of it with men who actually
 * play, so a plan that reads that verdict and then buys three cheap shots there is a screen arguing
 * with itself. One definition, two readers (`ensureSure` acts on it, `strategyCheck` reports it, and
 * `adviceFor` writes the sentence about it), so they cannot drift apart.
 *
 * The keepers are not here: they field one man and their rule is `ensureKeepers`.
 */
export function sureTarget(role: ClassicRole): number {
  return Math.max(SURE_PER_ROLE, FIELDED_PLACES[role]);
}

/**
 * Under which rung a keeper is somebody you cannot count on turning up.
 *
 * `ballottaggio` is the fight itself and `panchina` is being behind in one, so both are men whose SHIRT
 * is undecided - which is the state the pairing rule exists for. A `riserva` is not in the fight at all
 * and is therefore never the mate that covers it: he is the third keeper, which is a different job.
 */
const KEEPER_DISPUTE = 4;

/**
 * The keeper department, repaired to the operator's own strategy: never a lone bet on a contested shirt.
 *
 * Three moves in his own order, and each one is tried before the next: PAIR him with the club-mate he is
 * fighting (using the place of another keeper the plan was betting on alone), then replace him with a
 * keeper who simply plays, and only then leave the gamble standing and COUNT it - because a plan that
 * quietly keeps a coin toss looks exactly like a plan that solved one.
 *
 * A keeper already in the squad counts as cover for his club-mate, which is the third of his rules
 * («o uno che è già della squadra di un altro portiere comprato») and costs nothing to check.
 */
function ensureKeepers(
  chosen: readonly Picked[],
  candidates: readonly Candidate[],
  cap: number,
  squad: TeamState,
  rules: LeagueRules,
): Picked[] {
  let out = [...chosen];
  const sure = (one: Picked) => playsOften(one.candidate.man, rules) === true;
  const spend = () => out.reduce((sum, one) => sum + one.price, 0);
  const taken = () => new Set(out.map((one) => one.candidate.man.fcId));
  const paired = (one: Picked) =>
    out.some(
      (other) =>
        other !== one &&
        other.candidate.man.role === 'P' &&
        other.candidate.man.club === one.candidate.man.club,
    ) || squad.men.some((man) => man.role === 'P' && man.club === one.candidate.man.club);

  const keepers = out
    .filter((one) => one.candidate.man.role === 'P')
    .sort((left, right) => (right.candidate.gain ?? 0) - (left.candidate.gain ?? 0));
  for (const keeper of keepers) {
    if (!out.includes(keeper) || sure(keeper) || paired(keeper)) continue;
    const held = taken();

    // 1. the other side of the same fight, put in the place of another lone bet
    const mate = priced(candidates).find(
      (one) =>
        one.man.role === 'P' &&
        one.man.club === keeper.candidate.man.club &&
        one.man.fcId !== keeper.candidate.man.fcId &&
        (titolaritaRank(one.man.titolarita) ?? 99) <= KEEPER_DISPUTE &&
        !held.has(one.man.fcId),
    );
    const giver = out
      .filter((one) => one.candidate.man.role === 'P' && one !== keeper && !sure(one) && !paired(one))
      .sort((left, right) => (left.candidate.gain ?? 0) - (right.candidate.gain ?? 0))[0];
    if (mate && giver && spend() - giver.price + mate.ask.ask <= cap) {
      out = out.map((one) =>
        one === giver ? { candidate: mate, price: mate.ask.ask, shot: false } : one,
      );
      continue;
    }

    // 2. somebody who is not in a fight at all
    const dependable = priced(candidates)
      .filter(
        (one) => one.man.role === 'P' && playsOften(one.man, rules) === true && !held.has(one.man.fcId),
      )
      .sort((left, right) => (right.gain ?? 0) - (left.gain ?? 0))
      .find((one) => spend() - keeper.price + one.ask.ask <= cap);
    if (dependable) {
      out = out.map((one) =>
        one === keeper ? { candidate: dependable, price: dependable.ask.ask, shot: false } : one,
      );
      continue;
    }
    // 3. the gamble stands, and `strategyCheck` counts it on the list the operator sees.
  }
  return out;
}

/** Where a set of envelopes stands against the operator's two rules about the SQUAD. */
export interface StrategyCheck {
  /** Men who simply play still missing, role by role, counting the squad and these envelopes together. */
  missingSure: Record<ClassicRole, number>;
  /** Keepers being bet on alone: neither dependable nor paired with the man they are fighting. */
  keeperGamble: number;
}

/**
 * Score a set of envelopes against the two rules, whoever wrote them.
 *
 * ONE definition and two readers, which is the rule this project keeps paying for: the solver applies
 * the constraints and the SCREEN checks the list the operator actually has in front of him - and after
 * a swap, a deletion or a name added by hand, that is a different list. Two checkers would eventually
 * disagree about the same twelve envelopes.
 */
export function strategyCheck(
  men: readonly Bidder[],
  squad: TeamState,
  rules: LeagueRules,
): StrategyCheck {
  const missingSure = EMPTY_COUNT();
  for (const role of ROLES) {
    // P is exempt: see `ensureKeepers` - a pair is two men of whom one plays each week.
    if (role === 'P') continue;
    const held = squad.men.filter((man) => man.role === role && playsOften(man, rules) === true).length;
    const coming = men.filter((man) => man.role === role && playsOften(man, rules) === true).length;
    // Only where he can still act: a role with no slot left is a fact about the past, not a warning.
    const reachable = Math.min(sureTarget(role), held + squad.free[role]);
    missingSure[role] = Math.max(0, reachable - held - coming);
  }
  const keepers = men.filter((man) => man.role === 'P');
  const keeperGamble = keepers.filter((man) => {
    if (playsOften(man, rules) === true) return false;
    const mate =
      keepers.some((other) => other.fcId !== man.fcId && other.club === man.club) ||
      squad.men.some((other) => other.role === 'P' && other.club === man.club);
    return !mate;
  }).length;
  return { missingSure, keeperGamble };
}

/**
 * Make the plan hold `SURE_PER_ROLE` men who play, per role, counting whoever is already in the squad.
 *
 * A REPAIR and not a second solver: the knapsack keeps its optimum wherever the rule is already met, and
 * where it is not, the cheapest violation is undone - the lowest-gain man of that role who does NOT play
 * makes way for the best regular the freed credits can reach. It is `_settle`'s discipline in the
 * toolkit's panel, one level up: repair only what is broken, never re-solve around it, or the operator
 * cannot recognise the list he was looking at a second ago.
 *
 * A role where no regular fits is left alone and COUNTED: `missingSure` says so on the screen.
 */
function ensureSure(
  chosen: readonly Picked[],
  candidates: readonly Candidate[],
  cap: number,
  held: Record<ClassicRole, number>,
  rules: LeagueRules,
): Picked[] {
  let out = [...chosen];
  for (const role of ROLES) {
    // The KEEPERS are exempt and `ensureKeepers` is why: a pair is two men of whom one plays each week,
    // so demanding two regulars there would forbid the operator's own first strategy for that role.
    if (role === 'P') continue;
    const inRole = out.filter((one) => one.candidate.man.role === role);
    if (!inRole.length) continue;
    const plays = (one: Picked) => playsOften(one.candidate.man, rules) === true;
    let short = sureTarget(role) - held[role] - inRole.filter(plays).length;
    if (short <= 0) continue;

    const taken = new Set(out.map((one) => one.candidate.man.fcId));
    // Whoever could take one of those places: a man who plays, priced by the ladder, not already in.
    const pool = priced(candidates)
      .filter(
        (one) =>
          one.man.role === role &&
          playsOften(one.man, rules) === true &&
          !taken.has(one.man.fcId),
      )
      .sort((left, right) => (right.gain ?? 0) - (left.gain ?? 0));
    // ...and whoever gives one up: the weakest man of that role who does not play.
    const givers = inRole
      .filter((one) => !plays(one))
      .sort((left, right) => (left.candidate.gain ?? 0) - (right.candidate.gain ?? 0));

    for (const giver of givers) {
      if (short <= 0) break;
      const slack = cap - out.reduce((sum, one) => sum + one.price, 0) + giver.price;
      const swap = pool.find(
        (one) => one.ask.ask <= slack && !out.some((had) => had.candidate.man.fcId === one.man.fcId),
      );
      if (!swap) break;
      // A sicurezza is a SERIOUS bid: he is there to turn up, so he is written at the price that wins.
      out = out.map((one) =>
        one === giver ? { candidate: swap, price: swap.ask.ask, shot: false } : one,
      );
      short -= 1;
    }
  }
  return out;
}

/**
 * WHAT A CHEAP SHOT COSTS - the operator's «offerte da 1 o 2 crediti», written as the number it is.
 *
 * Two and not one because a tie awards nobody and the cheap end is where ties happen: Gudmundsson A.
 * drew two envelopes of exactly 2 in round 1 and went to neither of them. Two is what he named, and the
 * ladder prices the risk of it honestly - `winChance` reads a tie as a loss, so a shot that often ties
 * simply scores lower and the optimiser stops choosing it.
 */
export const CHEAP_SHOT = 2;

/** One envelope the optimiser may write: a man, a number, and what it is worth to write it. */
interface Picked {
  candidate: Candidate;
  price: number;
  /** A deliberate lottery ticket rather than a serious bid: it is drawn as one and never raised. */
  shot: boolean;
}

/**
 * THE PRICES ONE MAN MAY BE OFFERED, and the value of each - the whole strategy is in this function.
 *
 * The operator's rule of 25/08/2026: «non devi pensare di chiudere subito la rosa ma di provare, con le
 * buste a disposizione, a piazzare qualche colpo a sorpresa... invece di puntare a un forte C con una
 * busta da 100, meglio 2/3 offerte da 1 o 2 crediti a calciatori dal profilo più basso ma forti», and
 * «le offerte consigliate devono essere un misto di offerte toste e offerte cheap».
 *
 * It is not a taste, it is arithmetic he had already seen on his own league: LOSING COSTS NOTHING. An
 * envelope that fails takes no credit out of your pocket and the man simply comes back next round, so
 * what an envelope is worth is not what he is worth - it is what he is worth TIMES how often a number
 * like that has been enough. Written down: `value = gain x chance(price)`.
 *
 * That single change produces the mix he asked for, and produces it for a reason instead of by taste:
 *  - on a man everybody wants, two credits almost never win, so the shot scores near zero and the
 *    optimiser pays the real price or leaves him alone;
 *  - on a STRONG man the room is not chasing - «profilo più basso ma forte», which is exactly what a
 *    high gain and a low pressure mean together - two credits win often, so his shot beats a safe
 *    filler and the plan buys the lottery ticket;
 *  - and the budget goes where it buys the most chance per credit, which is what the old raise pass was
 *    doing by hand at the end and is now simply what the objective says.
 *
 * The league's own round 1 is the evidence that this is real and not clever: 37 of 125 awards cost ONE
 * OR TWO CREDITS, and among them Mora (FVM 100), Zaniolo (90), Da Cunha (90), Vlasic (75), Dybala (70).
 *
 * WITH NO HISTORY there is no chance to read, and inventing one would be worse than the old objective:
 * a man with no comparable award keeps his gain at the recommended price and no shot is offered on him.
 */
function offersFor(candidate: Candidate): { price: number; value: number; shot: boolean }[] {
  const gain = candidate.gain ?? 0;
  const blind = winChance(candidate.ask.ask, candidate.ask) == null;
  if (blind) return [{ price: candidate.ask.ask, value: gain, shot: false }];
  const points = [
    { price: CHEAP_SHOT, shot: true },
    { price: candidate.ask.ask, shot: false },
    { price: candidate.ask.safe, shot: false },
  ];
  const out: { price: number; value: number; shot: boolean }[] = [];
  for (const { price, shot } of points) {
    const at = Math.max(1, price);
    // A price the ladder has already passed is not a second option: two identical numbers would only
    // make the same envelope look like a choice.
    if (out.some((one) => one.price === at)) continue;
    out.push({ price: at, value: gain * (winChance(at, candidate.ask) ?? 0), shot: shot && at < candidate.ask.ask });
  }
  return out;
}

/**
 * The envelopes to write: which men, at which numbers, for the best EXPECTED return.
 *
 * It is a KNAPSACK over the SLOTS, because slots are what binds - a credit left at the end of a market
 * is worth exactly nothing, and ranking by gain-per-credit was measured degenerate (it fills twelve
 * slots with two-credit men and leaves 219 of 257 credits unspent). What changed on 25/08/2026 is the
 * OBJECTIVE, not the shape: it maximises `gain x chance` rather than gain, so the same solver now
 * decides the NUMBER on each envelope as well as the name - see `offersFor` for why, and for whose
 * rule it is.
 */
export function allocate(
  candidates: readonly Candidate[],
  need: Record<ClassicRole, number>,
  cap: number,
  strategy?: {
    /** OUR squad as it stands: the rules count what is already in it, not only this round's envelopes. */
    squad: TeamState;
    rules: LeagueRules;
  },
): BidPlan {
  const valued = priced(candidates);
  const shortlist: Candidate[] = [];
  for (const role of ROLES) {
    if (!need[role]) continue;
    shortlist.push(...valued.filter((one) => one.man.role === role).slice(0, PER_ROLE));
  }
  const states = ROLES.reduce((product, role) => product * (need[role] + 1), 1) * (cap + 1);
  const solved =
    states <= DP_LIMIT
      ? exact(shortlist, need, cap, offersFor)
      : greedy(shortlist, need, cap, offersFor);
  // The operator's rules are applied to the SOLVED list and not folded into the objective: a constraint
  // that becomes a weight stops being checkable, and these have to be able to report where they failed.
  // The KEEPERS go first, because pairing a shirt is structural and the sicurezze rule then counts the
  // department as the keeper rule left it.
  let chosen = solved;
  if (strategy) {
    const { squad, rules } = strategy;
    const held = EMPTY_COUNT();
    for (const role of ROLES) {
      held[role] = squad.men.filter(
        (man) => man.role === role && playsOften(man, rules) === true,
      ).length;
    }
    chosen = ensureKeepers(chosen, candidates, cap, squad, rules);
    chosen = ensureSure(chosen, candidates, cap, held, rules);
  }
  // What the repairs could NOT do is read off the list they produced, by the same function the screen
  // uses on the list the operator ends up with: a report computed anywhere else would describe a
  // different set of envelopes the first time he swaps a name.
  const check = strategy
    ? strategyCheck(chosen.map((one) => one.candidate.man), strategy.squad, strategy.rules)
    : { missingSure: EMPTY_COUNT(), keeperGamble: 0 };

  const bids: Bid[] = chosen
    .map((one) => ({
      candidate: one.candidate,
      offer: one.price,
      raised: false,
      shot: one.shot,
      chance: null as number | null,
    }))
    .sort((left, right) => (right.candidate.gain ?? 0) - (left.candidate.gain ?? 0));

  /**
   * Whatever credits the whole numbers left over, spent where they buy the most CHANCE.
   *
   * The objective already prices every step it was offered, so this only mops up the remainder of an
   * integer knapsack - and it never touches a SHOT. Raising a lottery ticket to the safe price is
   * undoing the very choice the optimiser made about it: it was cheap on purpose, because those credits
   * were worth more somewhere else.
   *
   * Chance per credit and not «the dearest first», and that has direct evidence behind it: a two-credit
   * filler carries a 33-44% chance while a 45-credit bid carries 67%, so three credits at the bottom
   * move far more than three at the top.
   */
  let left = cap - bids.reduce((sum, bid) => sum + bid.offer, 0);
  const bySteepness = [...bids]
    .filter((bid) => !bid.shot && bid.offer < bid.candidate.ask.safe)
    .map((bid) => {
      const step = bid.candidate.ask.safe - bid.offer;
      const gain =
        (winChance(bid.candidate.ask.safe, bid.candidate.ask) ?? 0) -
        (winChance(bid.offer, bid.candidate.ask) ?? 0);
      return { bid, step, perCredit: step > 0 ? gain / step : -1 };
    })
    .filter((one) => one.step > 0)
    .sort((one, other) => other.perCredit - one.perCredit);
  for (const { bid, step } of bySteepness) {
    if (step > left) continue;
    bid.offer = bid.candidate.ask.safe;
    bid.raised = true;
    left -= step;
  }

  // The chance is read AFTER the raising above, or it would describe an offer nobody is making.
  for (const bid of bids) bid.chance = winChance(bid.offer, bid.candidate.ask);

  const filled = EMPTY_COUNT();
  for (const bid of bids) filled[bid.candidate.man.role] += 1;
  const unfilled = EMPTY_COUNT();
  for (const role of ROLES) unfilled[role] = Math.max(0, need[role] - filled[role]);

  return {
    bids,
    spend: bids.reduce((sum, bid) => sum + bid.offer, 0),
    expectedSpend: bids.reduce((sum, bid) => sum + bid.offer * (bid.chance ?? 1), 0),
    expectedWins: bids.reduce((sum, bid) => sum + (bid.chance ?? 1), 0),
    gain: bids.reduce((sum, bid) => sum + (bid.candidate.gain ?? 0), 0),
    expectedGain: bids.reduce(
      (sum, bid) => sum + (bid.candidate.gain ?? 0) * (bid.chance ?? 1),
      0,
    ),
    marketGain: marketNull(candidates, need, cap),
    unfilled,
    missingSure: check.missingSure,
    keeperGamble: check.keeperGamble,
  };
}

/**
 * Exact multi-dimensional knapsack over (man, price). Prices are whole credits, so the axis is exact.
 *
 * `offers` is what it maximises over, and it is a PARAMETER because the null below has to be solved by
 * the same optimiser under a different preference: «buy the way the room buys» means maximise the FVM,
 * not maximise our own number badly. A null that is allowed to be stupid flatters whatever it is
 * compared with, and this project has already been caught quoting a margin over a table of deliberately
 * weak heads.
 *
 * ONE PRICE PER MAN, and it is the loop that guarantees it rather than a check: every option of a
 * candidate transitions out of `best` - the state BEFORE that candidate - and into `next`, so two
 * options of the same man can never be taken together.
 */
function exact(
  shortlist: readonly Candidate[],
  need: Record<ClassicRole, number>,
  cap: number,
  offers: (one: Candidate) => { price: number; value: number; shot: boolean }[],
): Picked[] {
  type Cell = { gain: number; chosen: Picked[] };
  let best = new Map<string, Cell>([[`0,0,0,0|0`, { gain: 0, chosen: [] }]]);
  for (const candidate of shortlist) {
    const next = new Map(best);
    const index = ROLES.indexOf(candidate.man.role);
    for (const option of offers(candidate)) {
      for (const [key, cell] of best) {
        const [counts, spent] = key.split('|');
        const taken = counts.split(',').map(Number);
        const paid = Number(spent);
        if (taken[index] >= need[candidate.man.role] || paid + option.price > cap) continue;
        taken[index] += 1;
        const nextKey = `${taken.join(',')}|${paid + option.price}`;
        const gain = cell.gain + option.value;
        const seen = next.get(nextKey);
        if (!seen || seen.gain < gain) {
          next.set(nextKey, {
            gain,
            chosen: [...cell.chosen, { candidate, price: option.price, shot: option.shot }],
          });
        }
      }
    }
    best = next;
  }
  const wanted = ROLES.map((role) => need[role]).join(',');
  let winner: Cell = { gain: -1, chosen: [] };
  for (const [key, cell] of best) {
    if (key.split('|')[0] === wanted && cell.gain > winner.gain) winner = cell;
  }
  // No full house fits the budget: take the richest state there is rather than returning nothing.
  if (winner.gain < 0) {
    for (const cell of best.values()) if (cell.gain > winner.gain) winner = cell;
  }
  return winner.chosen;
}

/** Best expected return first, skipping whoever no longer fits. Only when the exact solve is too large. */
function greedy(
  shortlist: readonly Candidate[],
  need: Record<ClassicRole, number>,
  cap: number,
  offers: (one: Candidate) => { price: number; value: number; shot: boolean }[],
): Picked[] {
  const taken = EMPTY_COUNT();
  const chosen: Picked[] = [];
  let left = cap;
  const ranked = shortlist
    .map((candidate) => ({
      candidate,
      options: offers(candidate).sort((one, other) => other.value - one.value),
    }))
    .sort((one, other) => (other.options[0]?.value ?? 0) - (one.options[0]?.value ?? 0));
  for (const { candidate, options } of ranked) {
    const role = candidate.man.role;
    if (taken[role] >= need[role]) continue;
    const stillToBuy = ROLES.reduce((sum, one) => sum + (need[one] - taken[one]), 0);
    // A credit apiece is kept for every other slot still to fill, or the first names eat the budget.
    const room = left - Math.max(0, stillToBuy - 1);
    const option = options.find((one) => one.price <= room);
    if (!option) continue;
    chosen.push({ candidate, price: option.price, shot: option.shot });
    taken[role] += 1;
    left -= option.price;
  }
  return chosen;
}

/**
 * The null: the same slots and the same budget, filled the way the ROOM fills them - by FVM.
 *
 * A plan's total gain means nothing on its own. This is what a manager who simply bought the dearest
 * names his slots could hold would have collected, so the plan can be quoted as a margin over somebody
 * who is not a straw man: it is precisely the strategy the league demonstrably plays. He pays the
 * RECOMMENDED price for everybody, because that is what buying by the price means - the cheap shot is
 * our idea, not his.
 */
function marketNull(
  candidates: readonly Candidate[],
  need: Record<ClassicRole, number>,
  cap: number,
): number {
  const byPrice = priced(candidates).sort(
    (left, right) => (right.man.fvm ?? 0) - (left.man.fvm ?? 0),
  );
  const shortlist: Candidate[] = [];
  for (const role of ROLES) {
    if (!need[role]) continue;
    shortlist.push(...byPrice.filter((one) => one.man.role === role).slice(0, PER_ROLE));
  }
  const states = ROLES.reduce((product, role) => product * (need[role] + 1), 1) * (cap + 1);
  const asPriced = (one: Candidate) => [
    { price: one.ask.ask, value: one.man.fvm ?? 0, shot: false },
  ];
  // Same slots, same budget, same solver - it simply believes the price is the value. What comes back
  // is then scored with OUR number, which is the whole comparison: not «we optimise and they do not»,
  // but «we rank by a different quantity».
  const chosen =
    states <= DP_LIMIT
      ? exact(shortlist, need, cap, asPriced)
      : greedy(shortlist, need, cap, asPriced);
  return chosen.reduce((sum, one) => sum + (one.candidate.gain ?? 0), 0);
}

/**
 * What a rival is likely to put an envelope on: the dearest free men his OWN open roles can hold.
 *
 * It is a model of him and not of football, and it rests on one measured fact - the room ranks by the
 * price (Spearman +0.719 against the surplus's +0.508) - plus one that is not a model at all: a role he
 * has filled is a role he cannot bid in. The second half is why this is worth drawing. Round 1 gives no
 * evidence about it, because everybody had every slot open; from round 2 on it removes whole managers
 * from whole markets, and that is a fact about the rules rather than a guess about a person.
 */
export function rivalPlan(
  state: TeamState,
  board: readonly Candidate[],
  rules: LeagueRules,
): Candidate[] {
  const out: Candidate[] = [];
  for (const role of ROLES) {
    const want = rules.roleLock ? state.free[role] : Math.min(state.free[role], state.slotsFree);
    if (!want) continue;
    const men = board
      .filter((one) => one.man.role === role)
      // He ranks by the quotation, so a man his listone does not quote is not on his list either - and
      // certainly not at the TOP of it, which is where a missing price read as zero would never put
      // him but a missing price read as «cheapest» quietly does.
      .filter((one) => one.pressure != null)
      // He cannot pay for everything: a name whose usual price clears his own ceiling is not on his
      // list at all, and dropping it AFTER the cut would have left him with fewer targets than slots.
      .filter((one) => one.ask.mid <= state.ceiling)
      .sort(
        (left, right) =>
          (right.man.fvm ?? 0) - (left.man.fvm ?? 0) || left.man.fcId - right.man.fcId,
      );
    out.push(...men.slice(0, want));
  }
  return out.sort((left, right) => (right.man.fvm ?? 0) - (left.man.fvm ?? 0));
}

/** One free man seen from the ROOM's side: who can bid on him, who is favourite, and can we reach him. */
export interface Contested {
  candidate: Candidate;
  /** The rivals who may legally bid on his role AND whose ceiling reaches what he usually costs. */
  chasers: string[];
  /** ...and those who want him and cannot pay: a fact about the rules, not a guess about a person. */
  priced_out: string[];
  /**
   * The favourite: of the men who can reach him, the one whose own shortlist already holds him -
   * richest ceiling first. Null when nobody's shortlist gets that far down.
   */
  favourite: string | null;
  /** Whether OUR ceiling reaches his usual price. The one line of this table that is about us. */
  ours: boolean;
}

/**
 * TURN THE RIVAL TARGETS INSIDE OUT: not «what will he take» but «who is taking this man».
 *
 * The lists drawn per manager are nearly identical - Rabiot, Leao, Krstovic for almost everybody -
 * because everybody ranks by the same quotation, so read down the columns they say the same thing ten
 * times. Read across the rows they say something new and usable: how many people can bid on this man at
 * all, who is favourite for him, and who WANTS him but cannot pay - which is a fact about ceilings and
 * roles, not a guess about anybody's taste.
 *
 * Ranked by how contested he is and then by price, so the head of the list is where the round will be
 * decided. Only men the sheet can price appear: a man without a quotation is not on anybody's shortlist
 * (`rivalPlan` refuses him too), and putting him here would invent a contest nobody is having.
 */
export function contestedOf(input: {
  candidates: readonly Candidate[];
  states: ReadonlyMap<string, TeamState>;
  rules: LeagueRules;
  me: string;
  howMany?: number;
}): Contested[] {
  const { candidates, states, rules, me, howMany = 10 } = input;
  const board = priced(candidates);
  const rivals = [...states.values()]
    .filter((state) => state.team !== me)
    .sort((left, right) => right.ceiling - left.ceiling);
  // Each rival's own shortlist, read from the SAME priced board the screen shows - never rebuilt here,
  // or the favourite could be a man his own card does not list. The POSITION is kept and not just the
  // membership: with everybody sorting by the same quotation, «who wants him most» is «whose open roles
  // put him nearest the top of his own list» - and that is what tells two rivals apart. Ranking by
  // money alone made the richest manager the favourite for all ten names, which is a fact about him and
  // not about the contest.
  const shortlists = new Map(
    rivals.map((state) => [
      state.team,
      new Map(rivalPlan(state, board, rules).map((one, at) => [one.man.fcId, at])),
    ]),
  );
  const mine = states.get(me);
  const rows = board.map((candidate) => {
    const open = rivals.filter((state) =>
      rules.roleLock ? state.free[candidate.man.role] > 0 : state.slotsFree > 0,
    );
    // «Can he pay» is asked against the MEDIAN of the comparables and not against the recommended
    // number: the ask is what it takes to win, the median is what a name like this usually goes for,
    // and a man who cannot even reach that is out of this contest whatever he wants.
    const chasers = open.filter((state) => state.ceiling >= candidate.ask.mid);
    // Nearest the top of his own list first; the deepest pocket only breaks a tie.
    const wanting = chasers
      .map((state) => ({ state, at: shortlists.get(state.team)?.get(candidate.man.fcId) }))
      .filter((one): one is { state: TeamState; at: number } => one.at != null)
      .sort((left, right) => left.at - right.at || right.state.ceiling - left.state.ceiling);
    const favourite = wanting[0]?.state.team ?? chasers[0]?.team ?? null;
    return {
      candidate,
      chasers: chasers.map((state) => state.team),
      priced_out: open
        .filter((state) => state.ceiling < candidate.ask.mid)
        .map((state) => state.team),
      favourite,
      ours: !!mine && mine.ceiling >= candidate.ask.mid,
    };
  });
  return rows
    .sort(
      (left, right) =>
        right.chasers.length - left.chasers.length ||
        (right.candidate.man.fvm ?? 0) - (left.candidate.man.fvm ?? 0),
    )
    .slice(0, howMany);
}

/**
 * WHAT THE LEAGUE HAS PAID SO FAR: the dearest names, and the ones who cost least for what they give.
 *
 * Two lists off the same awards, because they answer two questions the operator asks out loud at a
 * table - «chi ha speso una fortuna e su chi» and «chi ha fatto l'affare» - and neither is a model:
 * these are prices that were really paid and gains the sheet really carries.
 *
 * The bargain list divides the GAIN by what was paid, so it is «punti per credito». It is deliberately
 * NOT the ranking the plan buys by: at one credit anything looks like an affare, which is precisely why
 * `allocate` is a knapsack over slots and not a ranking by efficiency. Here it is a REPORT on what has
 * happened, and the row carries both numbers so the divisor is never hidden.
 */
export interface Deal {
  fcId: number;
  name: string;
  club: string;
  role: ClassicRole;
  team: string;
  paid: number;
  gain: number;
  /** Gain per credit paid. The two numbers travel with it: a ratio without them is not readable. */
  perCredit: number;
  round: number;
}

export function dealsOf(
  rounds: readonly Round[],
  pool: readonly Bidder[],
  rules: LeagueRules,
  howMany = 8,
): { dearest: Deal[]; bargains: Deal[] } {
  const byId = new Map(pool.map((man) => [man.fcId, man]));
  const deals: Deal[] = [];
  for (const round of rounds) {
    for (const award of round.awards) {
      const man = byId.get(award.fcId);
      const gain = man ? gainOf(man, rules) : null;
      if (!man || gain == null) continue;
      deals.push({
        fcId: man.fcId,
        name: man.name,
        club: man.club,
        role: man.role,
        team: award.team,
        paid: award.paid,
        gain,
        perCredit: gain / Math.max(1, award.paid),
        round: round.index,
      });
    }
  }
  return {
    dearest: [...deals].sort((left, right) => right.paid - left.paid).slice(0, howMany),
    bargains: [...deals]
      .sort((left, right) => right.perCredit - left.perCredit)
      .slice(0, howMany),
  };
}

/** How a manager played round one, in two words. Both axes are measured, neither is a judgement. */
export type Tactic = 'stelle' | 'volume' | 'tesoretto' | 'misto';

export const TACTIC_LABEL: Record<Tactic, string> = {
  stelle: 'Stelle e comprimari',
  volume: 'Volume',
  tesoretto: 'Tesoretto',
  misto: 'Misto',
};

/**
 * The three cuts the four words are made with. Exported so the hint below cannot drift from the code.
 *
 * They are DECLARED and not fitted, and this is the place that says so: no gate owns them, they move no
 * bid and no ranking. What they do is name a shape the operator can see for himself in the numbers
 * beside them - which is why the hint quotes the number rather than hiding it.
 */
export const TACTIC_CUTS = { committed: 0.35, topThree: 0.72, men: 16 } as const;

/** What each word MEANS - the strategy behind it, and what it says about that manager's next envelope. */
export const TACTIC_HINT: Record<Tactic, string> = {
  stelle:
    `Più del ${Math.round(TACTIC_CUTS.topThree * 100)}% di quello che ha speso sta su TRE soli nomi: ` +
    'ha preso due o tre big e riempirà il resto della rosa con uomini da pochi crediti. Sui big non lo ' +
    'batti quasi mai, sugli slot che gli restano lo batti con poco.',
  volume:
    `Ha già ${TACTIC_CUTS.men} uomini o più con la spesa distribuita: compra tanti giocatori medi ` +
    'invece di pochi costosi. Ti contende molti nomi insieme, ma con offerte basse: ha meno crediti ' +
    'per slot di quanti ne abbia in cassa.',
  tesoretto:
    `Ha impegnato meno del ${Math.round(TACTIC_CUTS.committed * 100)}% del budget: non ha ancora scelto ` +
    'una forma, i soldi sono ancora in mano. È il rivale pericoloso - può soprapagare qualunque nome ' +
    'nei round che restano, e la classifica per spesa lo sottovaluta.',
  misto:
    'Né concentrato su tre nomi né tante teste: ha speso in modo distribuito su una rosa ancora a metà. ' +
    'La sua prossima busta si legge dai ruoli che ha aperti, non dalla strategia.',
};

/** The two numbers that decide it, kept beside the verdict so the label can explain itself. */
export interface TacticRead {
  tactic: Tactic;
  /** Share of his spend that went on his three dearest men. */
  topThree: number;
  /** Share of his budget he has already committed. */
  committed: number;
  /** How many of his men cost him one or two credits - the envelopes that arrived alone. */
  snipes: number;
}

/**
 * Two axes and not one, the way the six-word ladder of the toolkit is built.
 *
 * CONCENTRATION says how much of his money sits on three names, COMMITMENT how much of it he has spent
 * at all. A manager who has spent a fifth of his budget has not chosen a shape yet - calling him
 * «balanced» would be reading a decision into an absence - so he is a `tesoretto` whatever his
 * concentration looks like, and the label says what is true: the money is still in his pocket.
 */
export function tacticOf(state: TeamState, rules: LeagueRules): TacticRead {
  const paid = state.men.map((man) => man.paid).sort((left, right) => right - left);
  const spend = state.spent || 1;
  const topThree = paid.slice(0, 3).reduce((sum, one) => sum + one, 0) / spend;
  const committed = state.spent / rules.budget;
  const snipes = paid.filter((one) => one <= 2).length;
  let tactic: Tactic;
  if (committed < TACTIC_CUTS.committed) tactic = 'tesoretto';
  else if (topThree >= TACTIC_CUTS.topThree) tactic = 'stelle';
  else if (state.men.length >= TACTIC_CUTS.men) tactic = 'volume';
  else tactic = 'misto';
  return { tactic, topThree, committed, snipes };
}

/** What one still-open slot is worth, role by role, and what a credit still buys anywhere. */
export interface MarketRate {
  /**
   * The mean GAIN of the men the room's still-open demand of that role will absorb.
   *
   * Ranked by FVM and not by our own number, for the same reason `pressure` is: this is a model of the
   * ROOM, and the room demonstrably buys the price (Spearman +0.719 against the surplus's +0.508).
   */
  perSlot: Record<ClassicRole, number>;
  /** Gain per credit over the whole room: the pool the money left will actually chase. */
  perCredit: number;
  demand: Record<ClassicRole, number>;
}

/**
 * What the market still holds, per role and per credit. One measurement, three readers.
 *
 * Computed off the pool itself rather than assumed, and per ROLE because a credit is not fungible when
 * the slots are not: the best forwards left and the best keepers left are two different queues.
 */
export function marketRate(
  states: ReadonlyMap<string, TeamState>,
  pool: readonly Bidder[],
  rules: LeagueRules,
): MarketRate {
  const demand = roleDemand(states);
  const perSlot: Record<ClassicRole, number> = { P: 0, D: 0, C: 0, A: 0 };
  let gainAhead = 0;
  for (const role of ROLES) {
    const men = pool
      .filter((man) => man.role === role)
      .map((man) => ({ man, gain: gainOf(man, rules) ?? 0 }))
      .sort((left, right) => (right.man.fvm ?? 0) - (left.man.fvm ?? 0))
      .slice(0, demand[role]);
    const total = men.reduce((sum, one) => sum + one.gain, 0);
    perSlot[role] = men.length ? total / men.length : 0;
    gainAhead += total;
  }
  let creditsAhead = 0;
  for (const state of states.values()) creditsAhead += state.credits;
  return { perSlot, perCredit: creditsAhead > 0 ? gainAhead / creditsAhead : 0, demand };
}

/** What a manager's round was worth, and against what. */
export interface Verdict {
  /** Sum of the GAIN of the men he holds - the quality actually in his hands. */
  gain: number;
  /** ...per hundred credits spent. Meaningless alone: see `standing`. */
  perHundred: number | null;
  /** What his remaining credits can still buy - bounded by the SLOTS he has left to buy with. */
  toCome: number;
  /**
   * What filling his own open slots would be worth at the market's current depth, role by role.
   *
   * The other half of `toCome`, and the reason that number is not a multiplication: money he has no
   * slot for cannot become quality.
   */
  wanted: number;
  /**
   * His money over what he still has to buy: 1 = exactly the room's own rate, under 1 = short.
   *
   * The number the standings could not say. Two managers with 361 and 377 credits are opposite
   * situations when one has 5 slots left and the other 13, and this is where that shows.
   */
  reach: number;
  /**
   * Gain in hand PLUS the gain his money can still reach. The only figure that compares a manager who
   * spent 857 with one who spent 128, because the second one still has to spend it - and the pool he
   * will spend it on is thinner than the one the first one bought from.
   */
  standing: number;
  /** His rank on `standing`, 1 = best. */
  rank: number;
}

/**
 * Score every manager's round, and score it against the thing that makes it interpretable.
 *
 * Gain per hundred credits is the number everyone reaches for and it mechanically crowns whoever
 * bought least: a manager who spent 128 credits «wins» efficiency by not playing. The honest reading
 * needs both halves - what he holds and what his money can still reach - and the second half is worth
 * LESS than it looks, because the money left in the room now chases a pool the best names have already
 * left. That rate is measured here from the pool itself rather than assumed.
 *
 * WHAT HIS MONEY CAN REACH IS BOUNDED BY HIS SLOTS, and the first version of this function forgot it -
 * a defect recorded in `todolist-buste-chiuse-v1.md` §2.1 before it was fixed, and found by reading the
 * screen rather than the code: MaCheMollo (361 credits, FIVE slots, three of them forwards) read 106
 * and Andreolana (377 credits, THIRTEEN slots) read 111. Two opposite situations, practically the same
 * number, because one league-wide rate was being multiplied by everybody's balance. Now both halves are
 * computed and the SMALLER one wins: what the credits buy at the room's rate, and what his own open
 * slots can absorb at the room's own depth in each role. A credit with no slot to spend it on is worth
 * exactly nothing - the same argument that made the allocator a knapsack over slots.
 */
export function verdicts(input: {
  states: ReadonlyMap<string, TeamState>;
  pool: readonly Bidder[];
  rules: LeagueRules;
}): Map<string, Verdict> {
  const { states, pool, rules } = input;
  const rate = marketRate(states, pool, rules);

  const rows = [...states.values()].map((state) => {
    const gain = state.men.reduce((sum, man) => sum + (gainOf(man, rules) ?? 0), 0);
    const wanted = ROLES.reduce((sum, role) => sum + state.free[role] * rate.perSlot[role], 0);
    const afford = state.credits * rate.perCredit;
    const toCome = Math.min(wanted, afford);
    return {
      team: state.team,
      gain,
      perHundred: state.spent > 0 ? (gain / state.spent) * 100 : null,
      toCome,
      wanted,
      // No slots left is not «infinitely rich»: there is nothing left to reach, so the ratio is 1 and
      // the sentence that reads it says «non gli manca niente» instead of dividing by zero.
      reach: wanted > 0 ? afford / wanted : 1,
      standing: gain + toCome,
      rank: 0,
    };
  });
  rows.sort((left, right) => right.standing - left.standing);
  rows.forEach((row, index) => (row.rank = index + 1));
  return new Map(rows.map((row) => [row.team, row]));
}

/**
 * How many stars a rank is drawn as: five bands over the room, best first.
 *
 * A RANK and not a score, because there is no absolute scale for «a good squad» in the middle of a
 * market - three rounds in, everybody's squad is a third of a squad. Five bands over ten managers is
 * two per band, which is what makes a star readable: «he is in the top fifth of this room».
 */
export function starsFromRank(rank: number, of: number): number {
  if (!of) return 3;
  const band = Math.floor(((rank - 1) * 5) / of);
  return Math.max(1, Math.min(5, 5 - band));
}

/**
 * Past how much of what he still has to buy a manager's money stops earning conduct.
 *
 * DECLARED, and stated where it is used: twice what your open slots are worth already means «you can
 * outbid anybody for them», and three times is not more conduct - it is a manager who will end the
 * market with credits nobody can spend.
 */
export const REACH_CAP = 2;

/** Two verdicts in stars, and every number they were built from beside them. */
export interface TeamRating {
  team: string;
  /** 1-5 on the quality he ALREADY holds - his rank inside this room on the gain in hand. */
  squad: number;
  /** 1-5 on how he has PLAYED the market: what a credit bought him, and whether the rest still covers. */
  conduct: number;
  gain: number;
  squadRank: number;
  perHundred: number | null;
  /** His place on efficiency, 1 = best. Null for a manager who has spent nothing to be efficient with. */
  perHundredRank: number | null;
  reach: number;
  reachRank: number;
  /** The role the biggest part of what he still has to buy sits in. Null when he has no slot left. */
  mostToBuy: ClassicRole | null;
}

/**
 * A star rating per manager, on the two questions the operator asked for: the SQUAD and the CONDUCT.
 *
 * THEY ARE A DECLARED READING AND NOT A MEASUREMENT, and that has to be said before anything else: no
 * gate owns them, they move no bid, and nothing in the plan reads them. What makes them honest is that
 * both are RANKS inside this room - the discipline the app's Overall was rebuilt on, 16/08/2026, «a
 * ranking must say which pool each number is a fact about» - so a star is the sentence «he is in the
 * top fifth of this league at this», never «his squad is worth four out of five in the absolute».
 *
 * THE SQUAD star is the gain in hand, which is what a rosa IS: what he holds. It deliberately ignores
 * his credits, because money is not a squad - the conduct star is where the money is judged, and
 * `Verdict.standing` is where the two are added.
 *
 * THE CONDUCT star is two halves, and it needs both for the reason `verdicts` states: efficiency alone
 * crowns whoever bought least. So it averages his place on what a credit BOUGHT him with his place on
 * whether what he KEPT still covers what he has left to buy, role by role (`Verdict.reach`). A manager
 * who has spent nothing has shown no conduct to judge: he sits in the MIDDLE of the efficiency ranking
 * rather than at the top of it, which is the same refusal to divide by an absence.
 */
export function ratingsOf(input: {
  states: ReadonlyMap<string, TeamState>;
  pool: readonly Bidder[];
  rules: LeagueRules;
}): Map<string, TeamRating> {
  const { states, pool, rules } = input;
  const rate = marketRate(states, pool, rules);
  const scores = verdicts(input);
  const teams = [...states.values()];
  const of = teams.length;

  const rankOf = (values: Map<string, number>): Map<string, number> => {
    const order = [...values.entries()].sort((left, right) => right[1] - left[1]);
    return new Map(order.map(([team], at) => [team, at + 1]));
  };

  const squadRank = rankOf(new Map(teams.map((one) => [one.team, scores.get(one.team)?.gain ?? 0])));
  const spentSomething = teams.filter((one) => (scores.get(one.team)?.perHundred ?? null) != null);
  const perHundredRank = rankOf(
    new Map(spentSomething.map((one) => [one.team, scores.get(one.team)!.perHundred!])),
  );
  // Where a manager who has spent NOTHING goes: the middle. He has not shown conduct, and «no evidence»
  // is not «the best» - the same refusal that leaves his `perHundred` empty instead of infinite.
  const middle = (spentSomething.length + 1) / 2;
  const reachRank = rankOf(
    new Map(teams.map((one) => [one.team, Math.min(scores.get(one.team)?.reach ?? 1, REACH_CAP)])),
  );

  const conduct = teams.map((one) => ({
    team: one.team,
    // A sum of PLACES, so SMALLER is better and the sort below is ascending.
    score: (perHundredRank.get(one.team) ?? middle) + (reachRank.get(one.team) ?? middle),
  }));
  conduct.sort((left, right) => left.score - right.score);
  const conductRank = new Map(conduct.map((row, at) => [row.team, at + 1]));

  const out = new Map<string, TeamRating>();
  for (const state of teams) {
    const score = scores.get(state.team);
    let mostToBuy: ClassicRole | null = null;
    let heaviest = 0;
    for (const role of ROLES) {
      const weight = state.free[role] * rate.perSlot[role];
      if (weight > heaviest) {
        heaviest = weight;
        mostToBuy = role;
      }
    }
    out.set(state.team, {
      team: state.team,
      squad: starsFromRank(squadRank.get(state.team) ?? of, of),
      conduct: starsFromRank(conductRank.get(state.team) ?? of, of),
      gain: score?.gain ?? 0,
      squadRank: squadRank.get(state.team) ?? of,
      perHundred: score?.perHundred ?? null,
      perHundredRank: perHundredRank.get(state.team) ?? null,
      reach: score?.reach ?? 1,
      reachRank: reachRank.get(state.team) ?? of,
      mostToBuy,
    });
  }
  return out;
}

/** One envelope as it was actually sent: the man, the number written on it, and what we expected of it. */
export interface SentBid {
  fcId: number;
  offer: number;
  /** The chance the ladder gave that offer WHEN IT WAS SENT, kept so the forecast can be scored later. */
  chance: number | null;
}

/** Everything we put in for one round. Saved before the envelopes are opened, never edited after. */
export interface RoundLog {
  round: number;
  bids: SentBid[];
}

/**
 * What happened to one of our envelopes.
 *
 * `unassigned` is the interesting one and it is the whole reason for keeping this record. The league
 * publishes WINNERS and nothing else, so a name that appears nowhere in the next export was either
 * bid on by nobody or TIED - and if we bid on him ourselves, the first branch is excluded. That is a
 * fact about the room that no export states and that no rival can reconstruct: somebody wrote the same
 * number we did.
 */
export type Outcome =
  | { kind: 'won'; price: number }
  | { kind: 'lost'; team: string; price: number }
  | { kind: 'unassigned' };

export interface Settled {
  bid: SentBid;
  man: Bidder | undefined;
  outcome: Outcome;
}

/**
 * Score one round's envelopes against the export that followed them.
 *
 * `snapshots` is the whole cumulative history, so the round's awards are the difference between the
 * export that closed it and the one before - the same reconstruction `roundsOf` makes, and for the same
 * reason: a roster export says who is in a squad today, not when he arrived.
 */
export function settle(
  log: RoundLog,
  snapshots: readonly Snapshot[],
  byId: ReadonlyMap<number, Bidder>,
  me: string,
): Settled[] | null {
  const after = snapshots[log.round - 1];
  if (!after) return null;                       // that round has not been exported yet
  const before = new Set((snapshots[log.round - 2] ?? []).map((one) => one.fcId));
  const awarded = new Map<number, Award>();
  for (const award of after) {
    if (!before.has(award.fcId)) awarded.set(award.fcId, award);
  }
  return log.bids.map((bid) => {
    const award = awarded.get(bid.fcId);
    const outcome: Outcome = !award
      ? { kind: 'unassigned' }
      : award.team === me
        ? { kind: 'won', price: award.paid }
        : { kind: 'lost', team: award.team, price: award.paid };
    return { bid, man: byId.get(bid.fcId), outcome };
  });
}

/** How the round went, and - the point of keeping the record - how good the forecast was. */
export interface Calibration {
  sent: number;
  won: number;
  lost: number;
  /** Nobody was awarded him: we bid, so somebody matched us. */
  tied: number;
  /** What we actually paid. */
  spent: number;
  /**
   * How many wins the ladder had promised, summing the chances we recorded at the time.
   *
   * Compared with `won`, this is the only honest check on the whole pricing model - and it is checkable
   * only because the chances were stored when the envelopes were sent. Recomputing them today would
   * score the forecast against a ladder that has since read this very round.
   */
  expected: number;
}

export function calibrationOf(settled: readonly Settled[]): Calibration {
  const out: Calibration = { sent: settled.length, won: 0, lost: 0, tied: 0, spent: 0, expected: 0 };
  for (const one of settled) {
    out.expected += one.bid.chance ?? 0;
    if (one.outcome.kind === 'won') {
      out.won += 1;
      out.spent += one.outcome.price;
    } else if (one.outcome.kind === 'lost') {
      out.lost += 1;
    } else {
      out.tied += 1;
    }
  }
  return out;
}

/** How one manager stands in ONE role: what he holds there, what he still needs, and where that puts him. */
export interface RoleStrength {
  role: ClassicRole;
  held: number;
  free: number;
  gain: number;
  /** His place among the managers at this role, 1 = the strongest. */
  rank: number;
}

/**
 * The strengths and the holes of every squad, role by role.
 *
 * Ranked WITHIN the role and never across roles, for the reason the app's Overall column had to be
 * rebuilt on 16/08/2026: four roles are four pools of different depth, and one ranking over all of them
 * says more about the ruler than about the squads. So «he is second at midfield and last in goal» is a
 * sentence worth reading, and «his defence is worth 42» on its own is not.
 */
export function strengthsOf(
  states: ReadonlyMap<string, TeamState>,
  rules: LeagueRules,
): Map<string, RoleStrength[]> {
  const out = new Map<string, RoleStrength[]>();
  const perRole = new Map<ClassicRole, { team: string; gain: number }[]>();
  for (const role of ROLES) perRole.set(role, []);
  for (const state of states.values()) {
    for (const role of ROLES) {
      const gain = state.men
        .filter((man) => man.role === role)
        .reduce((sum, man) => sum + (gainOf(man, rules) ?? 0), 0);
      perRole.get(role)!.push({ team: state.team, gain });
    }
  }
  const rankOf = new Map<string, number>();
  for (const role of ROLES) {
    const rows = perRole.get(role)!.sort((left, right) => right.gain - left.gain);
    rows.forEach((row, at) => rankOf.set(`${row.team}|${role}`, at + 1));
  }
  for (const state of states.values()) {
    out.set(
      state.team,
      ROLES.map((role) => ({
        role,
        held: state.taken[role],
        free: state.free[role],
        gain: perRole.get(role)!.find((row) => row.team === state.team)?.gain ?? 0,
        rank: rankOf.get(`${state.team}|${role}`) ?? 0,
      })),
    );
  }
  return out;
}

/**
 * The men of one role a plan could still put in a slot: everybody free, minus whoever is already in it.
 *
 * ONE definition, two callers - «what else could stand here» (the alternatives of a bid) and «who can I
 * add» (an envelope written by hand) are the same question asked from two places, and two lists would
 * eventually disagree about who is available. It is the rule this project keeps paying for: a displayed
 * list whose figures describe a different list is worse than no list.
 *
 * NOT `priced`: a man without a quotation is kept here on purpose, because «the automatic choice must be
 * doubtable» and he is exactly the kind of name the operator may know something about that the listone
 * does not. The row says his price is unknown; it does not hide him.
 */
export function boardFor(
  role: ClassicRole,
  candidates: readonly Candidate[],
  plan: BidPlan,
  exclude?: number,
): Candidate[] {
  const chosen = new Set(plan.bids.map((one) => one.candidate.man.fcId));
  return candidates.filter(
    (one) =>
      one.man.role === role &&
      one.gain != null &&
      one.man.fcId !== exclude &&
      !chosen.has(one.man.fcId),
  );
}

/**
 * Alternatives to one recommended bid: men of the same role who could take that same slot.
 *
 * Offered because an automatic choice must be doubtable - the same reason the fanta pitch shows the
 * runner-up shapes. They are ranked by gain and NOT by gain-per-credit, for the reason the allocator
 * itself is: the slot is the scarce thing, so the question is «who else could stand here», and the
 * price is shown beside each so the swap can be priced rather than guessed.
 *
 * `howMany` is the SHORT list drawn under the row; the operator asked (25/08/2026) to be able to walk
 * the whole role too, so the screen's «vedi tutti» reads `boardFor` with no cut. Same list, same order,
 * no second definition of who is available.
 */
export function alternativesTo(
  bid: Bid,
  candidates: readonly Candidate[],
  plan: BidPlan,
  budgetLeft: number,
  howMany = 6,
): { candidate: Candidate; delta: number; affordable: boolean }[] {
  return boardFor(bid.candidate.man.role, candidates, plan, bid.candidate.man.fcId)
    .slice(0, howMany)
    .map((candidate) => ({
      candidate,
      delta: (candidate.gain ?? 0) - (bid.candidate.gain ?? 0),
      affordable: candidate.ask.ask - bid.offer <= budgetLeft,
    }));
}

/**
 * How many men of each role an eleven FIELDS in this game.
 *
 * The toolkit's own `features.fielded_places` for classic - P 1 · D 4 · C 4 · A 2, eleven in total -
 * counted there from the game's own rulebook and quoted here rather than invented, because it is the
 * demand a squad has to cover before depth is worth anything. It is not the same as the SLOTS a roster
 * holds (3-8-8-6 = 25): the slots say what you may own, this says what plays on Sunday.
 */
export const FIELDED_PLACES: Record<ClassicRole, number> = { P: 1, D: 4, C: 4, A: 2 };

/**
 * From what share of the calendar a man counts as one of those who PLAY, when his rung is missing.
 *
 * A DISPLAY threshold on the same axis the rung is built on - «titolarità» here means getting a VOTE,
 * not starting (root CLAUDE.md, the operator's definition of 20/08/2026) - so the fallback and the word
 * are about the same quantity and cannot disagree about a man.
 */
export const OFTEN_SHARE = 0.7;

/**
 * Is he one of the men who play? The sheet's rung first, his own expected share when it is empty.
 *
 * NULL and never false for a man with neither, because «vuoto = ignoto, mai zero»: a squad where three
 * men cannot be read is not a squad with three substitutes, and the advice says so instead of counting
 * them against him.
 */
export function playsOften(man: Bidder, rules: LeagueRules): boolean | null {
  const rung = titolaritaRank(man.titolarita);
  // `titolare` or better - the three rungs whose promise the toolkit measured as kept 4 times out of 4.
  if (rung != null) return rung <= 2;
  if (man.expected == null) return null;
  return man.expected / rules.matchdays >= OFTEN_SHARE;
}

/** The two shapes the keeper department can be completed in, read off the board itself. */
export interface KeeperOptions {
  /** Both keepers of one club, both still free: whoever wins the shirt, it is ours. */
  pairs: { club: string; men: Candidate[]; cost: number }[];
  /** Keepers who are not in a fight at all - the ones you can alternate on the calendar. */
  dependable: Candidate[];
  /** Is the department already covered? A sure keeper, or both sides of one fight, in the squad. */
  covered: boolean;
}

/**
 * The keeper strategy, priced against what is actually left.
 *
 * «Prendere primo e secondo portiere di una squadra» and «due primi portieri affidabili da alternare»
 * are the operator's two ways of owning a shirt rather than a man, so the screen has to be able to say
 * which of the two is still ON THE BOARD - advice that names a strategy nobody can play any more is
 * advice about a market that no longer exists.
 *
 * A pair is only a pair if BOTH sides are free: owning one of them is the very gamble this exists to
 * avoid, and it is already covered by whoever is in the squad.
 */
export function keeperOptions(
  mine: TeamState,
  candidates: readonly Candidate[],
  rules: LeagueRules,
): KeeperOptions {
  const free = candidates.filter((one) => one.man.role === 'P' && one.gain != null);
  const owned = mine.men.filter((man) => man.role === 'P');
  const byClub = new Map<string, Candidate[]>();
  for (const one of free) {
    if ((titolaritaRank(one.man.titolarita) ?? 99) > KEEPER_DISPUTE) continue;
    byClub.set(one.man.club, [...(byClub.get(one.man.club) ?? []), one]);
  }
  const pairs = [...byClub.entries()]
    .filter(([, men]) => men.length >= 2)
    .map(([club, men]) => {
      const two = [...men].sort((left, right) => (right.gain ?? 0) - (left.gain ?? 0)).slice(0, 2);
      return { club, men: two, cost: two.reduce((sum, one) => sum + one.ask.ask, 0) };
    })
    .filter((pair) => pair.cost <= mine.ceiling)
    .sort((left, right) => (right.men[0].gain ?? 0) - (left.men[0].gain ?? 0));
  const dependable = free
    .filter((one) => playsOften(one.man, rules) === true && one.ask.ask <= mine.ceiling)
    .sort((left, right) => (right.gain ?? 0) - (left.gain ?? 0));
  const covered =
    owned.some((man) => playsOften(man, rules) === true) ||
    owned.some((man) => owned.some((other) => other.fcId !== man.fcId && other.club === man.club));
  return { pairs, dependable, covered };
}

/** What one department of OUR squad is, and what to do about it. */
export interface RoleAdvice {
  role: ClassicRole;
  held: number;
  free: number;
  /** How many of the men he holds there actually play - `playsOften`, counted on what can be read. */
  starters: number;
  /** ...and how many could not be read at all. Stated, never counted as substitutes. */
  unknown: number;
  /** How many an eleven fields in that role: what the department has to cover before depth pays. */
  fielded: number;
  gain: number;
  /** His place among the managers AT THIS ROLE, 1 = the strongest. Never a cross-role ranking. */
  rank: number;
  of: number;
  state: 'chiuso' | 'scoperto' | 'da completare' | 'solido';
  /** The sentence the operator reads, with the numbers that produced it inside it. */
  advice: string;
  /** The men on the board the advice points at, best first. Three at most: a list is not a plan. */
  targets: Candidate[];
  /**
   * ...and the envelopes THIS ROUND is already sending in that role, so the two cannot contradict.
   *
   * «Le buste consigliate devono rispecchiare i consigli che dai reparto per reparto» (25/08/2026): the
   * verdict and the plan are two answers to one question, and a screen that shows them side by side has
   * to show what the plan is doing about the hole it has just named.
   */
  bidding: Candidate[];
}

/**
 * A verdict per department of OUR OWN squad, with what to do about it and who is left to do it with.
 *
 * The operator's request of 25/08/2026: «un giudizio per ogni reparto (PDCA), con dei consigli rispetto
 * anche a quello che c'è ancora disponibile». Three rules hold it honest.
 *
 * THE VERDICT IS ABOUT THE ELEVEN, not about the roster. A department is `scoperto` when it cannot FIELD
 * what a shape asks of it (`FIELDED_PLACES`) with men who actually play - which is why a squad with six
 * defenders can still be uncovered, and why filling the last slots of a covered one is a different piece
 * of advice and says so.
 *
 * THE RANK IS INSIDE THE ROLE, from `strengthsOf`: four roles are four pools of different depth and one
 * ranking over all of them says more about the ruler than about the squads (the app's Overall, 16/08).
 *
 * AND IT READS WHAT IS STILL ON THE BOARD, because «take a TOP» is not advice if no top is left: every
 * sentence carries how many men of that kind are free and names the best one with what it would take.
 */
export function adviceFor(input: {
  mine: TeamState;
  states: ReadonlyMap<string, TeamState>;
  candidates: readonly Candidate[];
  scale: GainScale;
  rules: LeagueRules;
  /** The envelopes on screen. Passing them is what keeps the verdict and the plan telling one story. */
  bids?: readonly Bid[];
}): RoleAdvice[] {
  const { mine, states, candidates, scale, rules, bids = [] } = input;
  const strengths = strengthsOf(states, rules).get(mine.team) ?? [];
  const of = states.size;

  return ROLES.map((role) => {
    const line = strengths.find((one) => one.role === role);
    const bidding = bids.filter((one) => one.candidate.man.role === role).map((one) => one.candidate);
    const arriving = bidding.filter((one) => playsOften(one.man, rules) === true).length;
    const held = mine.taken[role];
    const free = mine.free[role];
    const reads = mine.men.filter((man) => man.role === role).map((man) => playsOften(man, rules));
    const starters = reads.filter((one) => one === true).length;
    const unknown = reads.filter((one) => one == null).length;
    const fielded = FIELDED_PLACES[role];
    const rank = line?.rank ?? 0;

    // What is still out there, in the two shapes the advice can point at: quality, and men who play.
    const taken = new Set(bidding.map((one) => one.man.fcId));
    const board = candidates.filter(
      (one) => one.man.role === role && one.gain != null && !taken.has(one.man.fcId),
    );
    const reachable = board.filter((one) => one.ask.ask <= mine.ceiling);
    const tops = reachable.filter((one) => gainBandOf(one.gain, scale) === 'ottimo');
    const regulars = reachable.filter((one) => playsOften(one.man, rules) === true);
    const cheapRegulars = regulars.filter((one) => one.ask.ask <= 2);
    const name = (one: Candidate | undefined): string =>
      one ? `${one.man.name} (${one.ask.ask} cr)` : '';

    const missing = Math.max(0, fielded - starters);
    let state: RoleAdvice['state'];
    let advice: string;
    let targets: Candidate[] = [];

    // THE KEEPERS ARE NOT A DEPARTMENT LIKE THE OTHERS and the advice says so in his own terms: you
    // field one, you own three, and what has to turn up on Sunday is the SHIRT. So «quanti titolari
    // hai» is the wrong question there - «hai un portiere che gioca, o tutti e due quelli che se la
    // giocano?» is the right one.
    if (role === 'P' && free) {
      const keeper = keeperOptions(mine, candidates, rules);
      const pair = keeper.pairs[0];
      const first = keeper.dependable[0];
      const both = (one: { club: string; men: Candidate[]; cost: number }) =>
        `${one.men.map((man) => man.man.name).join(' + ')} (${one.club}, ${one.cost} cr in due)`;
      if (!keeper.covered) {
        state = 'scoperto';
        targets = keeper.dependable.slice(0, 2);
        if (!targets.length && pair) targets = pair.men;
        advice =
          'Non hai ancora una porta sicura: con tre soli slot, comprare uno solo di due che se la ' +
          'giocano è la scommessa da evitare. Due vie - ' +
          (pair ? `la COPPIA di un club, ${both(pair)}` : 'nessuna coppia intera è più libera') +
          '; oppure ' +
          (first
            ? `due primi portieri da alternare sul calendario, il migliore libero è ${first.man.name} ` +
              `(${first.ask.ask} cr)`
            : 'due primi portieri, ma di sicuri liberi non ne restano') +
          '.';
      } else {
        state = 'da completare';
        targets = (cheapRegulars.length ? cheapRegulars : regulars).slice(0, 3);
        advice =
          `La porta è coperta. I ${free} slot che restano sono da terzo portiere: o uno che gioca ` +
          'sempre, o il compagno di squadra di un portiere che hai già - non un altro titolare pagato ' +
          'a prezzo pieno che poi guardi dalla panchina.';
      }
      advice += plannedWords(bidding, arriving, rules);
      if (unknown) {
        advice += ` ${unknown} dei tuoi non ha un gradino misurato: non li ho contati come titolari.`;
      }
      return {
        role, held, free, starters, unknown, fielded,
        gain: line?.gain ?? 0, rank, of, state, advice, targets, bidding,
      };
    }

    if (!free) {
      state = 'chiuso';
      advice = rules.roleLock
        ? `Ruolo pieno: ${held} uomini su ${held}, non puoi più bustare qui.`
        : `Hai già i tuoi ${held}: una busta qui toglierebbe crediti a un reparto ancora scoperto.`;
    } else if (missing > 0) {
      state = 'scoperto';
      targets = regulars.slice(0, 3);
      advice =
        `Ti manca${missing === 1 ? '' : 'no'} ${missing} titolar${missing === 1 ? 'e' : 'i'} per ` +
        `coprire l'undici (${starters} su ${fielded}). Qui cerca chi GIOCA, non chi costa poco: ` +
        (regulars.length
          ? `liberi ${regulars.length} uomini alla tua portata che prendono il voto quasi ogni ` +
            `giornata${tops.length ? `, ${tops.length} dei quali di prima fascia` : ''}. Il migliore: ` +
            `${name(targets[0])}.`
          : 'ma alla tua portata non ne è rimasto nessuno, quindi alza il tetto lasciando qualche slot per dopo.');
    } else if (rank && rank <= Math.ceil(of / 3)) {
      state = 'solido';
      targets = cheapRegulars.slice(0, 3);
      advice =
        `${rank}º della lega in questo ruolo e l'undici è coperto (${starters} su ${fielded}): qui non ` +
        `serve altro. Riempi i ${free} slot con l'ultimo prezzo` +
        (cheapRegulars.length ? ` - ${cheapRegulars.length} uomini a 1-2 crediti prendono comunque il voto.` : '.') +
        ' I crediti rendono di più dove sei scoperto.';
    } else {
      state = 'da completare';
      targets = (cheapRegulars.length ? cheapRegulars : regulars).slice(0, 3);
      advice =
        `L'undici è coperto (${starters} su ${fielded}) ma il reparto è ${rank}º di ${of}: ${free} slot ` +
        `da riempire. ` +
        (tops.length
          ? `Se vuoi salire, sul tabellone restano ${tops.length} uomini di prima fascia (${name(tops[0])}); `
          : 'Di prima fascia non è rimasto nessuno alla tua portata; ') +
        (cheapRegulars.length
          ? `altrimenti ${cheapRegulars.length} a 1-2 crediti che il voto lo prendono.`
          : 'per il resto conviene aspettare il round dopo.');
    }

    advice += plannedWords(bidding, arriving, rules);
    if (unknown) {
      advice +=
        ` ${unknown} dei tuoi non ha un gradino misurato: non li ho contati come titolari, ` +
        'e nemmeno contro di te.';
    }

    return {
      role,
      held,
      free,
      starters,
      unknown,
      fielded,
      gain: line?.gain ?? 0,
      rank,
      of,
      state,
      advice,
      targets,
      bidding,
    };
  });
}

/**
 * What the plan is doing about this department, as the last clause of its verdict.
 *
 * It names the envelopes and says how many of them are men who PLAY, because that is the number the
 * verdict was about: «ti manca un titolare» followed by a list of three lottery tickets would be the
 * screen contradicting itself, and now it either says «il piano ce ne mette uno» or it does not.
 */
function plannedWords(bidding: readonly Candidate[], arriving: number, rules: LeagueRules): string {
  if (!bidding.length) return ' Questo round non ci busti su nessuno.';
  const names = bidding.map((one) => one.man.name).join(', ');
  const plays =
    arriving === 0
      ? 'nessuno di loro è uno che gioca sempre'
      : arriving === 1
        ? 'uno di loro gioca quasi ogni giornata'
        : `${arriving} di loro giocano quasi ogni giornata`;
  return ` Questo round ci busti su ${names}: ${plays}.`;
}

/** Whether a hand-written envelope may join the plan, and what it would cost if it did. */
export interface AddCheck {
  ok: boolean;
  /** Why not, in the operator's own words. Null when it may be added. */
  why: string | null;
  /** The number the envelope would carry: the ladder's own recommendation. */
  offer: number;
  /** It fits the slots but not the money: allowed, and the screen says the ceiling would be over. */
  tight: boolean;
}

/**
 * Can this man be added to the plan by hand?
 *
 * The SLOTS are the rulebook and are refused outright - one envelope per open slot, and a role you have
 * filled is a role you may not bid in - while the BUDGET is a decision of his: an envelope that pushes
 * the ceiling over the credits is allowed and MARKED, because the cure may well be lowering another
 * offer rather than dropping this name. The two are different kinds of «no» and the screen must not
 * present them as one.
 */
export function canAdd(
  candidate: Candidate,
  plan: BidPlan,
  mine: TeamState,
  rules: LeagueRules,
): AddCheck {
  const role = candidate.man.role;
  const offer = Math.max(1, candidate.ask.ask);
  const already = plan.bids.some((one) => one.candidate.man.fcId === candidate.man.fcId);
  const inRole = plan.bids.filter((one) => one.candidate.man.role === role).length;
  if (already) return { ok: false, why: 'È già fra le tue buste.', offer, tight: false };
  if (!mine.free[role]) {
    return {
      ok: false,
      why: rules.roleLock
        ? `Ruolo ${role} pieno: il regolamento non ti lascia bustare qui.`
        : `Non hai slot liberi da ${role}.`,
      offer,
      tight: false,
    };
  }
  if (inRole >= mine.free[role]) {
    return {
      ok: false,
      why: `Hai già una busta per ognuno dei ${mine.free[role]} slot da ${role} che ti restano: ` +
        'togline una, o sostituisci un nome invece di aggiungerlo.',
      offer,
      tight: false,
    };
  }
  return { ok: true, why: null, offer, tight: plan.spend + offer > mine.credits };
}
