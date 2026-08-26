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
   * `SURPLUS x (Pv/matchdays)^exponent`. You set the lineup before knowing whether he plays, so what
   * you collect is the appearances you could SEE COMING; 0.5 is the measured shape of that
   * catchability and not a risk knob.
   *
   * DECLARED HERE, and the provenance is worth stating rather than borrowing: the bundle's manifest
   * carries `squad_slots` and `matchdays_target` and nothing else of the league config, so this and
   * `minAvailability` below are read from `DEFAULT_RULES` and from no file. Citing them as
   * «`config/league_config.json`'s» - which an earlier draft of this comment did - would be quoting a
   * number to a source that never gave it.
   */
  reliability: number;
  /**
   * The share of the season below which a man is not RANKED at all: a man who played once is not a man
   * you could have fielded, so he does not belong in a ranking of who to buy - which is a category
   * question and not a discount. Declared here too, for the reason stated just above.
   */
  minAvailability: number;
  /**
   * IS THE DEFENCE MODIFIER ON? An INPUT, in the operator's own words: «sì è attivo e deve essere una
   * informazione da mettere come input (come le impostazioni delle rose)» (25/08/2026).
   *
   * It belongs here and not in a heuristic because it is a REGULATION, like `roleLock` above it, and it
   * changes what an eleven has to look like: the bonus needs four defenders on the pitch, so with it on
   * a reference shape of three would tune the whole page away from money the league is offering
   * (`referenceShape`). What it is WORTH is priced NOWHERE in this app - the modifier pays on the
   * average vote of the defensive block and nobody here has measured that - so it decides the SHAPE and
   * touches no valuation, which is stated rather than left to be discovered.
   */
  defenceModifier: boolean;
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
  // Declared by the operator for his league on 25/08/2026. Like every other line of this object it is
  // HIS regulation and not a neutral default, and the panel's own switch writes it.
  defenceModifier: true,
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
  /**
   * DAYS HE IS STILL EXPECTED TO BE OUT, when he is out now. Null when he is not, or when nobody knows.
   *
   * The operator's rule of 25/08/2026 - «non suggerire calciatori che hanno infortuni lunghi in corso
   * (>= 1 mese)» - and it is a fact about a person, so it is not this module's to compute: the page reads
   * it from `PlayerStatus`, the one place that decides «e' fuori oggi», and hands it over here. Optional
   * on purpose: a caller that knows nothing about injuries (a test, an older screen) passes nothing and
   * the rule does not fire, instead of silently reading every man as fit.
   */
  outDays?: number | null;
  /**
   * IS HE DECLARED OUT OF THE SQUAD? Not measured here and not measurable anywhere - it is declared.
   *
   * `config/player_notes.json`, `kind: 'out_of_squad'`, the operator's own channel for a fact the model
   * cannot reach (root CLAUDE.md). It joined this module on 25/08/2026 on his own report - «vedo Lukaku
   * nei nomi contesi ma ormai non e' piu' in serie A» - and the bundle really cannot know: the sheet
   * drops a man only when a TRANSFER names where he went, while the live squad read that no longer
   * lists him leaves `desc_live_club` pointing at his last sighting (Lukaku: Napoli, 10/08, on a sheet
   * whose Napoli was re-read on the 20th without him).
   *
   * ONLY `out_of_squad`, and the other two declared kinds are deliberately not here: `dispute` and
   * `wants_out` are states of a RELATIONSHIP and a man in either can still be fielded on Sunday, so
   * reading them as an absence would be inventing a fact from a different one - which is the very
   * sentence the notes file opens with. Optional for `outDays`'s reason: a caller that knows nothing
   * about the notes passes nothing, instead of silently reading every man as in the squad.
   */
  outOfSquad?: boolean;
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
  /**
   * Awards of his this listone cannot name: charged to his credits, absent from his roster.
   *
   * Never silently zero. It is the one number that says «this squad is bigger than the rows below it»,
   * and without it a stale bundle reads as a manager with free slots he does not have.
   */
  unknown: number;
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

/**
 * A fresh zero per role. Exported because the SCREEN counts roles too (the slots one plan leaves
 * empty), and a second literal would be a second place to forget a role the day one is added.
 */
export const emptyByRole = (): Record<ClassicRole, number> => ({ P: 0, D: 0, C: 0, A: 0 });

const EMPTY_COUNT = emptyByRole;

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
      unknown: 0,
    });
  }
  for (const award of awards) {
    const state = out.get(award.team);
    if (!state) continue;
    const man = byId.get(award.fcId);
    // A PRICE IS A FACT WHOEVER HE IS. The credits are charged even when this listone does not carry
    // the man - a bundle older than the market, or somebody the sheet has since dropped because two
    // signals said he had left the club - because his money has left that manager's pocket either way,
    // and `credits`/`ceiling` are what every rival model on this page is built on. Skipping the award
    // outright made him read RICHER than he is, silently. What cannot be attributed is the ROLE, so he
    // gets no roster row and no slot: `unknown` says how many rows that was, and the screen states it
    // rather than letting a squad look one man short of nothing.
    state.spent += award.paid;
    if (!man) {
      state.unknown += 1;
      continue;
    }
    state.men.push({ ...man, paid: award.paid });
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
      const pressure = pressureFor.get(award.team)?.get(award.fcId);
      // A MAN THIS LISTONE DOES NOT QUOTE IS NOT A COMPARABLE, and reading his two axes as zeros is
      // the exact `?? 0` that `pressureOf` twenty lines up refuses: it would file him at the bottom of
      // the demand and at the cheapest price, where he becomes the nearest neighbour of every genuinely
      // cheap candidate and drags their ask down with him. He was bought - that is a fact - but we
      // cannot say WHERE he sat, so he prices nobody.
      //
      // Measured before removing it (25/08/2026): of the 125 awards of round 1 of the operator's
      // league, ZERO fall here, so the ladder and every ask are unchanged today. It is the case that
      // has not happened yet - a bundle older than the market - that this closes.
      if (pressure == null || man.fvm == null) continue;
      out.push({
        fcId: award.fcId,
        name: man.name,
        team: award.team,
        paid: award.paid,
        pressure,
        fvm: man.fvm,
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
    label: 'metà (34-67%)',
    hint:
      'A metà della domanda: lo raggiungono ancora, ma dopo i nomi grossi del ruolo. Qui il prezzo ' +
      'crolla rispetto alla testa, ed è la banda dove una busta decisa vale di più.',
    keep: (p) => p >= 0.34 && p < 0.67,
  },
  {
    key: 'tail',
    label: 'coda (1-34%)',
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

/**
 * THE KEEPER DEPARTMENT IS ONE PLACE, so two keepers are not two gains.
 *
 * Found on 25/08/2026 on a plan of the operator's own: the busta offered Falcone (81) and Palmisani
 * (15) and read their two surpluses ADDED - 49.3 of the sheet's points. You field ONE keeper, so on the
 * ~52% of matchdays on which both of them play one of the two votes is thrown away: the department is
 * worth 33.9, and 15.4 of the number on the screen was the same matchday counted twice. Nothing here
 * could see it - `gainOf` is a fact about ONE man and the knapsack adds its items up - and the pairing
 * rule (`ensureKeepers`) does not cure it either: that one is about the SHIRT, not about arithmetic.
 *
 * It predicts no football, which is this file's own boundary: the appearances are the sheet's
 * (`expected`), the worth of one of them is the sheet's (`surplus / expected`), and what is deduced
 * here is which of them you are on the pitch to collect.
 *
 * WHAT IS ASSUMED, stated because a model nobody states is a model nobody can refuse:
 *  - he plays a given matchday with probability `expected / matchdays`;
 *  - two keepers OF ONE CLUB never play the same match - the rulebook, not an assumption - so their
 *    shares are rescaled when the sheet's forecasts sum past the calendar (Napoli 2026-27:
 *    Milinkovic-Savic 25.0 + Meret 14.6 + Contini 8.0 = 47.6 appearances of 38, which is the engine
 *    saying it does not know who wins that shirt);
 *  - keepers of DIFFERENT clubs are independent;
 *  - and you collect the better of whoever turns up, which is what the bench order buys you: the
 *    automatic substitution walks your keepers in the order you listed them.
 *
 * WHAT WAS REFUSED, measured rather than argued: rescaling a club's shares over ALL its keepers instead
 * of the ones you own. It reads as the more principled version - a club fields exactly one keeper a
 * matchday, so the whole club should sum to the calendar - and the sheet's FILLER is what pays for it:
 * Lecce's four unmeasured reserves carry 3.7 appearances apiece, which is «vuoto = ignoto» and not a
 * forecast, and dividing by their 46.9 sends Falcone from 0.845 of the season to 0.684. A man with a
 * measured season must not be deflated by men nobody measured.
 *
 * ONE MAN REPRODUCES `gainOf` EXACTLY, and a test holds it: the catchability discount stays a property
 * of the MAN - his own share of the season - and what this changes is only the number of matchdays on
 * which he is the one you field.
 */
interface KeeperPlace {
  man: Bidder;
  /** What ONE of his appearances is worth over the replacement - `surplus / expected`, the sheet's own. */
  perMatch: number;
  /** His share of the season: `expected / matchdays`. */
  share: number;
  /** ...and that share read as «does he play THIS matchday», capped by his club's own calendar. */
  play: number;
}

/** The keepers of a set, best first, carrying the numbers the department is made of. */
function keeperPlaces(men: readonly Bidder[], rules: LeagueRules): KeeperPlace[] {
  const out: KeeperPlace[] = [];
  for (const man of men) {
    if (man.role !== 'P') continue;
    // A man the sheet cannot price is not IN the department - «vuoto = ignoto» - and neither is one
    // worth less than the bench, who would be shadowed by it on every matchday anyway.
    //
    // The league's AVAILABILITY FLOOR is deliberately not applied here, and the distinction is the one
    // its own comment makes: it gates the RANKING - who may be proposed - and `priced` still enforces
    // that upstream, so nothing this file would not have offered before can be offered now. What a man
    // you already HOLD covers is a different question, and a keeper who plays a third of the season is
    // precisely the second half of a pair.
    if (man.surplus == null || !man.expected) continue;
    const perMatch = man.surplus / man.expected;
    if (perMatch <= 0) continue;
    const share = man.expected / rules.matchdays;
    out.push({ man, perMatch, share, play: Math.min(1, share) });
  }
  // Best per appearance first, because that is the order you list them in and therefore the order the
  // automatic substitution walks - and among equals the one who turns up more often.
  out.sort((left, right) => right.perMatch - left.perMatch || right.share - left.share);
  const byClub = new Map<string, number>();
  for (const place of out) byClub.set(place.man.club, (byClub.get(place.man.club) ?? 0) + place.play);
  for (const place of out) {
    const club = byClub.get(place.man.club) ?? 0;
    if (club > 1) place.play /= club;
  }
  return out;
}

/**
 * The share of HIS OWN appearances each keeper is the one you field on, best first.
 *
 * Grouped by club and not man by man, because two better keepers of ONE other club do not multiply:
 * they cannot both play, so what is left free is `1 - (their shares added)` and never `(1-a)(1-b)`.
 */
function keeperCover(places: readonly KeeperPlace[]): number[] {
  const played = new Map<string, number>();
  return places.map((place) => {
    let free = 1;
    for (const [club, taken] of played) {
      if (club !== place.man.club) free *= Math.max(0, 1 - taken);
    }
    played.set(place.man.club, (played.get(place.man.club) ?? 0) + place.play);
    return free;
  });
}

/**
 * What a set of keepers is worth as ONE place: never the sum, and exactly `gainOf` for a single man.
 *
 * THE CATCHABILITY DISCOUNT BELONGS TO THE DEPARTMENT AND NOT TO THE MAN, which is the correction the
 * first version of this function got wrong and the real sheet exposed within the hour. `gainOf` charges
 * `share ^ reliability` because «you set the lineup before knowing whether he plays» - and that is a
 * sentence about a slot with NOBODY behind it. In goal you list three men and the automatic
 * substitution takes the first with a vote, so what you need to see coming is whether you will have A
 * keeper, not whether you will have THAT one. Charged per man it double-counts exactly the risk a pair
 * exists to remove: Meret + Milinkovic-Savic read 26.4 against the 35.5 they are worth, i.e. below a
 * lone Falcone, and the busta would have gone on recommending against the very thing that works.
 *
 * So the discount is taken once, on what the department COVERS - and a single man still reproduces
 * `gainOf` to the decimal, because for him the two are the same number. It also says something true
 * that the per-man version could not: buying a backup makes the keeper you already own worth MORE
 * (Falcone alone is discounted by 0.919 of his surplus, Falcone with a deputy by 0.969).
 *
 * WHERE THIS DISAGREES WITH A MEASUREMENT, and the measurement is the stronger evidence.
 * `metrica-asta-surplus-v1.md` §24.5 (25/08/2026, 11 Serie A seasons, pairs matched against controls of
 * two different clubs) reads the same-club keeper pair at **-0.59 points a season, the interval
 * containing zero, the same club winning 41% of the time** - while this deduction hands it +6 to +10
 * over diversifying at equal quality. Both agree on the COVERAGE (it finds 5.2 fewer uncovered
 * matchdays of 38, and so does this: 4.8), and they disagree on whether that coverage becomes points:
 * its answer is that the gap was already being covered by the THIRD keeper, who is in the squad anyway.
 *
 * Nothing is fitted to close the gap, because fitting a deduction to a measurement it contradicts is
 * how a model stops being checkable. What ships is the half neither of them disputes - two keepers'
 * gains may not be ADDED - and the open half is stated here so the next reader does not take the pair
 * bonus for measured. §24.6's operative conclusion is the one to advise with: buying both is fine if
 * the second is paid as a second, and the club is not an auction criterion while the discount is.
 * How to settle it: the plan already writes down what it expected, so at the end of the market count
 * the matchdays actually covered and the points actually collected, pairs against diversified.
 */
export function keeperGain(men: readonly Bidder[], rules: LeagueRules): number {
  const places = keeperPlaces(men, rules);
  const cover = keeperCover(places);
  let worth = 0;
  let covered = 0;
  places.forEach((place, at) => {
    const fielded = place.play * cover[at];
    worth += place.perMatch * fielded;
    covered += fielded;
  });
  if (covered <= 0) return 0;
  return rules.horizon * worth * Math.pow(covered, rules.reliability);
}

/**
 * THE SHARE OF MATCHDAYS ON WHICH ONE OF THESE KEEPERS TURNS UP - the same sum `keeperGain` discounts by.
 *
 * Factored out and not written twice, because it is the number two different questions need: what the
 * department is WORTH, and whether it has a HOLE. Two copies would eventually disagree about one squad.
 *
 * It reads a man the sheet cannot price as covering nothing, which is «vuoto = ignoto» and not a claim
 * that he never plays: what it must never do is promise cover the plan cannot count on.
 */
export function keeperCovered(men: readonly Bidder[], rules: LeagueRules): number {
  const places = keeperPlaces(men, rules);
  const cover = keeperCover(places);
  return Math.min(1, places.reduce((sum, place, at) => sum + place.play * cover[at], 0));
}

/**
 * What a whole squad is worth: the three departments added, and the keepers read as the one place.
 *
 * ONE definition and three readers - the plan, the standings (`verdicts`) and the role-by-role table
 * (`strengthsOf`) - which is the rule this project keeps paying for: a manager holding three keepers
 * used to read as a manager who fields three.
 */
export function squadGain(men: readonly Bidder[], rules: LeagueRules): number {
  let total = 0;
  for (const man of men) if (man.role !== 'P') total += gainOf(man, rules) ?? 0;
  return total + keeperGain(men, rules);
}

/**
 * What each of these men ADDS, given the ones already held - the numbers that sum to the plan's gain.
 *
 * The keepers are charged in a chain, best first: each is worth the department WITH him minus the
 * department without him, so the total telescopes to `squadGain(held + men) - squadGain(held)` exactly
 * and the screen's rows can never disagree with the screen's total. It also puts the cost where it
 * belongs - a keeper who demotes one you already own pays for the demotion himself.
 */
export function marginalGains(
  men: readonly Bidder[],
  held: readonly Bidder[],
  rules: LeagueRules,
): Map<number, number> {
  const out = new Map<number, number>();
  const running = held.filter((man) => man.role === 'P');
  let before = keeperGain(running, rules);
  for (const place of keeperPlaces(men, rules)) {
    running.push(place.man);
    const after = keeperGain(running, rules);
    out.set(place.man.fcId, after - before);
    before = after;
  }
  for (const man of men) {
    if (man.role === 'P') {
      // Whoever `keeperPlaces` dropped adds nothing, and says zero rather than nothing at all: he IS in
      // the plan, so a row with no number would read as «not counted» instead of «worth nothing here».
      if (!out.has(man.fcId)) out.set(man.fcId, 0);
      continue;
    }
    out.set(man.fcId, gainOf(man, rules) ?? 0);
  }
  return out;
}

/**
 * The four words a GAIN is drawn with, plus the fifth that is not a word about football.
 *
 * The band IS the word - `ottimo`, `buono`, `medio`, `scarso` - so there is no lookup table beside it:
 * one existed and mapped every key to its own name, which is an indirection that can only ever return
 * what it was given and would hide a divergence between key and label the day somebody introduced one.
 */
export type GainBand = 'ottimo' | 'buono' | 'medio' | 'scarso' | 'ignoto';

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
  return scaleOf(pool.map((man) => gainOf(man, rules)));
}

/**
 * The same three cuts, from the gains themselves - so a page with ANOTHER definition of «gain» paints
 * its chips on the same bands instead of inventing a second palette.
 *
 * It exists because the STRATEGY page ranks by the currency the auction type asks for (the surplus with
 * raises, the value in a draft: `core/strategy.ts`), which is not this file's gain. What must not differ
 * is what a colour MEANS - the best tenth of the pool is `ottimo` wherever it is drawn - and that is
 * exactly what `GAIN_SHARES` and `ui-gain` are for. Nulls are dropped and never read as a zero.
 */
export function scaleOf(gains: readonly (number | null)[]): GainScale {
  const sorted = gains
    .filter((one): one is number => one != null)
    .sort((left, right) => left - right);
  return {
    top: quantile(sorted, GAIN_SHARES.top),
    good: quantile(sorted, GAIN_SHARES.good),
    fair: quantile(sorted, GAIN_SHARES.fair),
    sample: sorted.length,
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
 * FOR HOW LONG AN INJURY IS «LONG», when the question is whether to suggest him.
 *
 * A month, the operator's own word (25/08/2026). It is deliberately NOT `player-status`'s 45 days: that
 * number decides when to draw a warning icon beside a name, this one decides whether a man enters a
 * plan, and a threshold borrowed from a different question is the defect this project keeps paying for.
 */
export const LONG_OUT_DAYS = 30;

/**
 * Is he available to be BOUGHT, as opposed to available to be marked?
 *
 * He is only kept out of what WE propose. He stays on the board, on the rivals' shortlists and in the
 * lists the operator picks from by hand - the room can still bid on him, and the operator may know
 * something the bundle does not. A man missing from the board would be a fact hidden; a man missing
 * from the PLAN is a suggestion refused, which is what was asked.
 */
export function buyable(man: Bidder): boolean {
  // A man his own club has put out of the squad is not a man to write an envelope for, whatever the
  // sheet still prices him at - and it is the same KIND of refusal as the long injury: he stays on the
  // board and stays offerable by hand, because the declaration is revocable and the room may not know.
  if (man.outOfSquad) return false;
  const out = man.outDays;
  return out == null || out < LONG_OUT_DAYS;
}

/**
 * The men a plan may actually contain: the ones this app can put BOTH numbers on.
 *
 * Two different unknowns and a plan needs neither: no `gain` means we cannot say what he is worth, no
 * `pressure` means we cannot say what he will cost - and a bid is a pair. Whoever fails either test is
 * still on the board and still offerable by hand; he is only kept out of the automatic answer.
 */
export function numbered(
  candidates: readonly Candidate[],
): (Candidate & { gain: number; pressure: number })[] {
  return candidates.filter(
    (one): one is Candidate & { gain: number; pressure: number } =>
      one.gain != null && one.pressure != null,
  );
}

/**
 * ...and the men a PLAN may contain: the numbered ones who are also available to be bought.
 *
 * Two functions because they answer two questions and the screen asks both: «how much of the board can
 * this app put numbers on» is a fact about the BOARD - the market card prints it - while this one is
 * about our own suggestions. The long-term injured man fails HERE and nowhere else, which is the
 * cheapest place that is also the right one: `priced` is what the allocator, both repairs and the
 * market rate read, and it is not what the board, the rivals or the hand-made lists read.
 */
export function priced(
  candidates: readonly Candidate[],
): (Candidate & { gain: number; pressure: number })[] {
  return numbered(candidates).filter((one) => buyable(one.man));
}

/** One recommended envelope. */
export interface Bid {
  candidate: Candidate;
  /**
   * What this envelope ADDS, given the others - which for a keeper is not his own gain.
   *
   * The department is one place (`keeperGain`), so a second keeper is worth what he covers that the
   * first does not; `marginalGains` charges the chain and these rows therefore sum to `BidPlan.gain`
   * exactly. Drawn instead of `candidate.gain` for the reason this project has already paid for once:
   * a displayed list whose figures describe a different list is worse than no figure.
   */
  gain: number;
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
  /**
   * The empty places each department still leaves on a typical matchday, plan included.
   *
   * `strategyCheck`'s own number, carried on the plan so the SCREEN reads what the solver used instead
   * of recomputing it - two answers to «is my defence covered» would eventually disagree, and this page
   * has already paid for a displayed list whose figures described a different list.
   */
  holes: Record<ClassicRole, number>;
  /** The shape it was all tuned on: `referenceShape`'s choice, so the screen can show and doubt it. */
  reference: Reference;
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
 * HOW MANY MEN OF A ROLE MUST PLAY: his «un paio per ruolo», and no longer the eleven's own places.
 *
 * It used to be `max(SURE_PER_ROLE, FIELDED_PLACES[role])`, and the reason was his rule of 25/08/2026 -
 * «le buste consigliate devono rispecchiare i consigli che dai reparto per reparto», a rule about
 * CONSISTENCY between the verdict and the plan. **That rule is kept and what carries it changed**: the
 * verdict no longer counts men, it reads the department's empty places (`expectedHoles` / `HOLE_TARGET`),
 * and `ensureSure` reads the same number - so the two still cannot drift apart, and the count going back
 * to his floor is what stops the plan asking for FOUR men who always play in a role where five men
 * already cover it. That was the same evening's objection: «5 ottimi difensori, quindi la difesa va solo
 * puntellata e non vale la pena spendere crediti che possono essere usati in altri reparti».
 *
 * The keepers are not here: they field one man and their rule is `ensureKeepers`.
 */
export function sureTarget(role: ClassicRole): number {
  // Every outfield role has the same floor; the ROLE stays in the signature because the caller asks a
  // question about a role, and a function that silently ignores its argument invites the day somebody
  // gives one role a different floor and nothing reads it.
  return role === 'P' ? 0 : SURE_PER_ROLE;
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
 * ...and under which rung the BOARD DRAWS him, which is what wearing the shirt means.
 *
 * Not a threshold of ours: it is the toolkit's own gate, quoted («Six words for one shirt, and the
 * drawing is a GATE», root CLAUDE.md). A man the typical eleven fields never falls below `ballottaggio`
 * and a man it does not field can never be `titolare` - so `ballottaggio` or better IS «the board draws
 * him», and `panchina` IS «somebody else is drawn in his place».
 */
const KEEPER_SHIRT = 3;

/**
 * DOES THIS SET OWN THE CLUB'S SHIRT, or only the men who are not wearing it?
 *
 * Found on 25/08/2026 on the operator's own plan, and he named the missing man: «Di Gregorio e Perin
 * sono riserve e senza Vicario non ha senso offrire delle buste per loro». The rule was written down
 * where the mate is SEARCHED for (`KEEPER_DISPUTE`, «a `riserva` is never the mate that covers it») and
 * missing from the three places that decide whether a pair EXISTS - so a club-mate, any club-mate,
 * counted. Measured on that Juventus goal: Di Gregorio (`panchina`) + Perin (`riserva`) read
 * `keeperGamble` 0, i.e. the screen said the department was solved while the shirt belonged to Vicario
 * (`ballottaggio`), who was in nobody's envelope. Owning both losers of a fight is not owning a fight.
 *
 * The DEPARTMENT ARITHMETIC cannot see it and is not what cures it: `keeperPlaces` shares a club's
 * calendar between the keepers YOU OWN, so those two read 33.9 points against the 30.7 of Di Gregorio +
 * Vicario - it prefers the wrong pair, because 26.9 + 13.3 appearances tile a 38-round season and
 * 26.9 + 23.6 overlap. That is the constraint's job, exactly as `keeperGain`'s own comment says.
 *
 * AN UNKNOWN RUNG DOES NOT REFUSE A PAIR, and the asymmetry with the mate search is deliberate: to ACT
 * on a man you need evidence, to REFUSE him you need evidence too. A sheet built where the boards could
 * not be drawn carries no rung at all (the three columns are empty on a machine with no display), and
 * turning every pair on such a sheet into a warning - or worse, swapping men on the strength of it -
 * would be «vuoto = ignoto» broken from the other side. The price is stated rather than hidden: a
 * hand-made plan pairing a drawn-less keeper with a third keeper nobody can read still passes here.
 *
 * TWO HALVES AND BOTH ARE NECESSARY, which the first version of this function got wrong and the same
 * Juventus goal caught again: the set needs TWO claimants on that shirt, one of whom the board draws.
 * «One drawn man plus anybody» would have let Vicario (`ballottaggio`) + Perin (`riserva`) pass, and if
 * Di Gregorio won the shirt there would be nobody in it - which is the operator's own sentence,
 * «prenderne solo uno dei due e' una scommessa troppo rischiosa», said about the other side of the duel.
 */
function drawnInGoal(man: Bidder): boolean {
  const rung = titolaritaRank(man.titolarita);
  return rung == null || rung <= KEEPER_SHIRT;
}

/** ...and whether he is a CLAIMANT on it at all: a `riserva` is the third keeper, a different job. */
function claimsTheShirt(man: Bidder): boolean {
  const rung = titolaritaRank(man.titolarita);
  return rung == null || rung <= KEEPER_DISPUTE;
}

/**
 * IS THERE ANYBODY IN GOAL WHO SIMPLY TURNS UP - a keeper who plays, or a shirt owned outright?
 *
 * The operator's rule is «mai una scommessa SOLITARIA su una maglia contesa» (25/08/2026), and the word
 * that was not being read is «solitaria»: a `ballottaggio` bought beside a `bandiera` is not a lone bet
 * on anything, and the department behind him is covered. Asked per man, the rule was swapping a cheap
 * upside out of a plan that already had its anchor - the same defect he had corrected that morning one
 * department along, «un binario per uomo non può rispondere a una domanda su un INSIEME».
 *
 * No threshold and no new constant: the sentence itself is the test. What is left over - HOW MUCH of
 * the calendar the department covers - is `expectedHoles` for role P, and it is already on the screen.
 */
export function keeperAnchored(men: readonly Bidder[], rules: LeagueRules): boolean {
  const keepers = men.filter((man) => man.role === 'P');
  if (keepers.some((man) => playsOften(man, rules) === true)) return true;
  return keepers.some((man) => ownsShirt(keepers, man.club));
}

function ownsShirt(keepers: readonly Bidder[], club: string): boolean {
  const claimants = keepers.filter(
    (man) => man.role === 'P' && man.club === club && claimsTheShirt(man),
  );
  return claimants.length >= 2 && claimants.some(drawnInGoal);
}

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
  // ONE definition of «his shirt is covered», and it is `ownsShirt`: a club-mate is not the other side
  // of a fight unless one of the two is the man the board draws.
  const paired = (one: Picked) =>
    ownsShirt(
      [...out.map((other) => other.candidate.man), ...squad.men],
      one.candidate.man.club,
    );

  // Re-read at every step and not once: a repair can bring the anchor in, and from that moment there is
  // nothing left to repair.
  const anchored = () =>
    keeperAnchored([...out.map((one) => one.candidate.man), ...squad.men], rules);

  const keepers = out
    .filter((one) => one.candidate.man.role === 'P')
    .sort((left, right) => (right.candidate.gain ?? 0) - (left.candidate.gain ?? 0));
  for (const keeper of keepers) {
    if (!out.includes(keeper) || sure(keeper) || paired(keeper) || anchored()) continue;
    const held = taken();

    // 1. the other side of the same fight, put in the place of another lone bet.
    //
    // He has to COMPLETE the shirt and not merely share the club - which is the whole of the operator's
    // objection - and his own rung has to be READ: `?? 99` refuses an unknown here, where `ownsShirt`
    // tolerates one, because this line ACTS and that one only declines to refuse.
    const mate = priced(candidates).find(
      (one) =>
        one.man.role === 'P' &&
        one.man.club === keeper.candidate.man.club &&
        one.man.fcId !== keeper.candidate.man.fcId &&
        (titolaritaRank(one.man.titolarita) ?? 99) <= KEEPER_DISPUTE &&
        ownsShirt([keeper.candidate.man, one.man], keeper.candidate.man.club) &&
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
  /**
   * The empty places each department would still leave on a typical matchday, squad + envelopes.
   *
   * The number the VERDICT is built on (`expectedHoles`), reported on the list the operator ends up
   * with: after a swap or a name added by hand that is a different list, and a screen that said
   * «scoperto» while the plan believed otherwise would be the defect this page already paid for once.
   */
  holes: Record<ClassicRole, number>;
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
  /**
   * The shape the envelopes are tuned on. Defaults to the STANDARD eleven, which is what this file used
   * to hard-code: an un-updated caller therefore behaves exactly as it did before, instead of getting a
   * new guess. The page always passes the chosen one, and `BidPlan.reference` is how it knows which.
   */
  reference: Reference = STANDARD_ELEVEN,
): StrategyCheck {
  const missingSure = EMPTY_COUNT();
  const holes = EMPTY_COUNT();
  for (const role of ROLES) {
    holes[role] = expectedHoles([...squad.men, ...men], role, reference.places[role], rules);
    // P is exempt: see `ensureKeepers` - a pair is two men of whom one plays each week.
    if (role === 'P') continue;
    const held = squad.men.filter((man) => man.role === role && playsOften(man, rules) === true).length;
    const coming = men.filter((man) => man.role === role && playsOften(man, rules) === true).length;
    // Only where he can still act: a role with no slot left is a fact about the past, not a warning.
    const reachable = Math.min(sureTarget(role), held + squad.free[role]);
    missingSure[role] = Math.max(0, reachable - held - coming);
  }
  const keepers = men.filter((man) => man.role === 'P');
  // THE SAME QUESTION THE SOLVER ASKS, and it is about the department: with an anchor in goal nobody is
  // betting alone, so the warning goes quiet instead of naming a man the plan has already covered.
  const keeperGamble = keeperAnchored([...keepers, ...squad.men], rules)
    ? 0
    : keepers.filter((man) => {
        if (playsOften(man, rules) === true) return false;
        // The same `ownsShirt` the solver applies, on the list the operator actually has in front of
        // him: two men of one club are a pair only if one of them is the man the board draws.
        return !ownsShirt([...keepers, ...squad.men], man.club);
      }).length;
  return { missingSure, keeperGamble, holes };
}

/**
 * Make the plan hold men who PLAY: his floor of two per role, and enough of them to COVER the shape.
 *
 * A REPAIR and not a second solver: the knapsack keeps its optimum wherever the rule is already met, and
 * where it is not, the cheapest violation is undone - the lowest-gain man of that role who does NOT play
 * makes way for the best regular the freed credits can reach. It is `_settle`'s discipline in the
 * toolkit's panel, one level up: repair only what is broken, never re-solve around it, or the operator
 * cannot recognise the list he was looking at a second ago.
 *
 * TWO CONDITIONS AND EITHER IS ENOUGH, and the second one is what changed on 25/08/2026: his own floor
 * («almeno un paio per ruolo titolarissimi»), plus the department's EMPTY PLACES against the reference
 * shape. It used to demand as many regulars as the eleven fields, which is how a defence of five men -
 * three `bandiera` and two `ballottaggio`, 0.64 of a hole a matchday - kept asking for a fourth
 * signing: «non vale la pena spendere crediti che possono essere usati in altri reparti». One
 * definition (`expectedHoles`), and the verdict on screen reads the same one.
 *
 * A role where no regular fits is left alone and COUNTED: `missingSure` and `holes` say so on the screen.
 */
function ensureSure(
  chosen: readonly Picked[],
  candidates: readonly Candidate[],
  cap: number,
  held: Record<ClassicRole, number>,
  rules: LeagueRules,
  squad: TeamState,
  reference: Reference,
): Picked[] {
  let out = [...chosen];
  for (const role of ROLES) {
    // The KEEPERS are exempt and `ensureKeepers` is why: a pair is two men of whom one plays each week,
    // so demanding two regulars there would forbid the operator's own first strategy for that role.
    if (role === 'P') continue;
    const inRole = out.filter((one) => one.candidate.man.role === role);
    if (!inRole.length) continue;
    const plays = (one: Picked) => playsOften(one.candidate.man, rules) === true;
    const covering = expectedHoles(
      [...squad.men, ...out.map((one) => one.candidate.man)],
      role,
      reference.places[role],
      rules,
    );
    const floor = sureTarget(role) - held[role] - inRole.filter(plays).length;
    // Ceil, because a swap buys one man: half a hole still asks for the man who closes it.
    let short = Math.max(floor, covering >= HOLE_TARGET ? Math.ceil(covering) : 0);
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
function offersFor(
  candidate: Candidate,
  /**
   * What he is worth HERE, which is his own gain everywhere except in goal: a keeper is priced against
   * the department he is joining, or the objective chooses him on a number the plan will not collect.
   */
  worth: number,
): { price: number; value: number; shot: boolean }[] {
  const gain = worth;
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
  /**
   * The league, and it is REQUIRED since 25/08/2026 - it used to arrive only with the squad.
   *
   * A plan cannot be valued without it: the keeper department is a share of a CALENDAR, so a caller
   * that does not say which league it is in would silently get the old arithmetic, two keepers added
   * up. «A fallback that is correct for one caller is silent for another» is the costliest defect in
   * this repository's own list, and the cure is the same one - do not offer the fallback.
   */
  rules: LeagueRules,
  /** OUR squad as it stands: the rules count what is already in it, not only this round's envelopes. */
  squad?: TeamState,
  /**
   * The shape to tune on - `referenceShape`'s choice, made by the page because only the page has the
   * rulebook and the board.
   *
   * Defaults to the STANDARD eleven, which is the number this file used to hard-code: a caller that does
   * not pass one behaves exactly as it did before instead of getting a new guess, and the plan CARRIES
   * what it used (`BidPlan.reference`) so nothing downstream has to assume.
   */
  reference: Reference = STANDARD_ELEVEN,
): BidPlan {
  const valued = priced(candidates);
  const shortlist: Candidate[] = [];
  for (const role of ROLES) {
    if (!need[role]) continue;
    shortlist.push(...valued.filter((one) => one.man.role === role).slice(0, PER_ROLE));
  }
  const heldKeepers = (squad?.men ?? []).filter((man) => man.role === 'P');
  /**
   * WHAT A CANDIDATE IS WORTH TO THIS PLAN, which for a keeper is not what he is worth on his own.
   *
   * In goal you field ONE man, so the second keeper is worth what he covers that the first does not -
   * and the OBJECTIVE has to know it, not just the report: priced on his standalone gain, Palmisani
   * entered the plan on 14.2 points and delivers 2.2 beside Falcone. Memoised on the keeper set,
   * because `exact` asks the same question once per state and the answer only depends on who is
   * already in.
   */
  const marginal = new Map<string, number>();
  const worthOf = (candidate: Candidate, chosen: readonly Picked[]): number => {
    if (candidate.man.role !== 'P') return candidate.gain ?? 0;
    const key = keeperKey(candidate, chosen);
    const seen = marginal.get(key);
    if (seen != null) return seen;
    const base = [...heldKeepers, ...keepersIn(chosen)];
    const worth = keeperGain([...base, candidate.man], rules) - keeperGain(base, rules);
    marginal.set(key, worth);
    return worth;
  };
  /**
   * ...and the OPTIONS memoised on the same key, not only the worth behind them.
   *
   * `exact` asks this once per candidate PER STATE, and there are hundreds of thousands of states in a
   * full-squad round: pricing the three envelopes afresh each time turned a solve into a hang. Outside
   * goal the answer does not depend on the state at all, so it is computed once per man.
   */
  type Offer = { price: number; value: number; shot: boolean };
  const alone = new Map<number, Offer[]>();
  const inGoal = new Map<string, Offer[]>();
  const offers = (candidate: Candidate, chosen: readonly Picked[]): Offer[] => {
    if (candidate.man.role !== 'P') {
      let known = alone.get(candidate.man.fcId);
      if (!known) {
        known = offersFor(candidate, candidate.gain ?? 0);
        alone.set(candidate.man.fcId, known);
      }
      return known;
    }
    const key = keeperKey(candidate, chosen);
    let known = inGoal.get(key);
    if (!known) {
      known = offersFor(candidate, worthOf(candidate, chosen));
      inGoal.set(key, known);
    }
    return known;
  };
  const states = ROLES.reduce((product, role) => product * (need[role] + 1), 1) * (cap + 1);
  const solved =
    states <= DP_LIMIT
      ? exact(shortlist, need, cap, offers)
      : greedy(shortlist, need, cap, offers);
  // The operator's rules are applied to the SOLVED list and not folded into the objective: a constraint
  // that becomes a weight stops being checkable, and these have to be able to report where they failed.
  // The KEEPERS go first, because pairing a shirt is structural and the sicurezze rule then counts the
  // department as the keeper rule left it.
  let chosen = solved;
  if (squad) {
    const held = EMPTY_COUNT();
    for (const role of ROLES) {
      held[role] = squad.men.filter(
        (man) => man.role === role && playsOften(man, rules) === true,
      ).length;
    }
    chosen = ensureKeepers(chosen, candidates, cap, squad, rules);
    chosen = ensureSure(chosen, candidates, cap, held, rules, squad, reference);
  }
  // What the repairs could NOT do is read off the list they produced, by the same function the screen
  // uses on the list the operator ends up with: a report computed anywhere else would describe a
  // different set of envelopes the first time he swaps a name.
  const check = squad
    ? strategyCheck(chosen.map((one) => one.candidate.man), squad, rules, reference)
    : { missingSure: EMPTY_COUNT(), keeperGamble: 0, holes: EMPTY_COUNT() };

  // What each envelope adds to what is already held - the same chain the total is made of, so a row and
  // the sum under it can never tell two stories.
  const adds = marginalGains(
    chosen.map((one) => one.candidate.man),
    squad?.men ?? [],
    rules,
  );
  const bids: Bid[] = chosen
    .map((one) => ({
      candidate: one.candidate,
      gain: adds.get(one.candidate.man.fcId) ?? 0,
      offer: one.price,
      raised: false,
      shot: one.shot,
      chance: null as number | null,
    }))
    .sort((left, right) => right.gain - left.gain);

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
    gain: bids.reduce((sum, bid) => sum + bid.gain, 0),
    expectedGain: expectedGainOf(bids, squad?.men ?? [], rules),
    marketGain: marketNull(candidates, need, cap, rules, squad?.men ?? []),
    unfilled,
    missingSure: check.missingSure,
    keeperGamble: check.keeperGamble,
    holes: check.holes,
    reference,
  };
}

/** The keepers of a part-built plan - what a keeper's worth in it depends on, and nothing else. */
function keepersIn(chosen: readonly Picked[]): Bidder[] {
  return chosen.filter((one) => one.candidate.man.role === 'P').map((one) => one.candidate.man);
}

/** ONE key for the two memos of `allocate`, so a worth and the envelopes priced on it cannot drift. */
function keeperKey(candidate: Candidate, chosen: readonly Picked[]): string {
  const ids = keepersIn(chosen).map((man) => man.fcId).sort((left, right) => left - right);
  return `${candidate.man.fcId}|${ids.join(',')}`;
}

/**
 * How many keepers a plan may hold before the outcomes are enumerated one by one.
 *
 * Eight is far above any league's keeper slots (three here) and is a backstop rather than a rule: the
 * enumeration below is 2^k, so a caller that ever asked for more would hang instead of being slow.
 */
const EXPECTED_KEEPER_LIMIT = 8;

/**
 * WHAT YOU EXPECT TO WIN, with the keepers read as the one place they are.
 *
 * An envelope you lose is a keeper you do not own, so what the ones you DO win are worth depends on
 * WHICH of them arrive - two keepers that would shadow each other are worth nearly twice as much when
 * only one lands. Weighting each of them by his own chance, as the other three roles are weighted, is
 * the same double count this file has just removed, one level up. So the keeper outcomes are
 * enumerated: 2^k of them, k being at most the free keeper slots.
 */
export function expectedGainOf(
  bids: readonly Bid[],
  held: readonly Bidder[],
  rules: LeagueRules,
): number {
  const keepers = bids.filter((bid) => bid.candidate.man.role === 'P');
  const rest = bids
    .filter((bid) => bid.candidate.man.role !== 'P')
    .reduce((sum, bid) => sum + bid.gain * (bid.chance ?? 1), 0);
  if (!keepers.length) return rest;
  if (keepers.length > EXPECTED_KEEPER_LIMIT) {
    return rest + keepers.reduce((sum, bid) => sum + bid.gain * (bid.chance ?? 1), 0);
  }
  const base = keeperGain(held, rules);
  let total = 0;
  for (let mask = 0; mask < 1 << keepers.length; mask += 1) {
    let weight = 1;
    const won: Bidder[] = [];
    keepers.forEach((bid, at) => {
      const chance = bid.chance ?? 1;
      if (mask & (1 << at)) {
        weight *= chance;
        won.push(bid.candidate.man);
      } else {
        weight *= 1 - chance;
      }
    });
    if (weight <= 0) continue;
    total += weight * (keeperGain([...held, ...won], rules) - base);
  }
  return rest + total;
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
  offers: (one: Candidate, chosen: readonly Picked[]) => { price: number; value: number; shot: boolean }[],
): Picked[] {
  type Cell = { gain: number; chosen: Picked[] };
  let best = new Map<string, Cell>([[`0,0,0,0|0`, { gain: 0, chosen: [] }]]);
  for (const candidate of shortlist) {
    const next = new Map(best);
    const index = ROLES.indexOf(candidate.man.role);
    // The options are priced INSIDE the state, because what a keeper adds depends on the keepers that
    // state already holds - the department is one place. For everybody else `offers` ignores the second
    // argument and the loop is the one it always was.
    for (const [key, cell] of best) {
      const [counts, spent] = key.split('|');
      const taken = counts.split(',').map(Number);
      const paid = Number(spent);
      if (taken[index] >= need[candidate.man.role]) continue;
      for (const option of offers(candidate, cell.chosen)) {
        if (paid + option.price > cap) continue;
        const after = [...taken];
        after[index] += 1;
        const nextKey = `${after.join(',')}|${paid + option.price}`;
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

/**
 * Best expected return first, skipping whoever no longer fits. Only when the exact solve is too large.
 *
 * Re-priced at every step and not ranked once: a keeper is worth what he adds to the department AS IT
 * STANDS, so a list sorted before the first pick would buy the second keeper at the first one's price.
 * The pool is at most `PER_ROLE` per role, so choosing the best of what is left each time is cheap.
 */
function greedy(
  shortlist: readonly Candidate[],
  need: Record<ClassicRole, number>,
  cap: number,
  offers: (one: Candidate, chosen: readonly Picked[]) => { price: number; value: number; shot: boolean }[],
): Picked[] {
  const taken = EMPTY_COUNT();
  const chosen: Picked[] = [];
  const left = { credits: cap };
  const remaining = [...shortlist];
  for (;;) {
    let bestAt = -1;
    let bestOption: { price: number; value: number; shot: boolean } | null = null;
    for (let at = 0; at < remaining.length; at += 1) {
      const candidate = remaining[at];
      if (taken[candidate.man.role] >= need[candidate.man.role]) continue;
      const stillToBuy = ROLES.reduce((sum, one) => sum + (need[one] - taken[one]), 0);
      // A credit apiece is kept for every other slot still to fill, or the first names eat the budget.
      const room = left.credits - Math.max(0, stillToBuy - 1);
      const option = offers(candidate, chosen)
        .filter((one) => one.price <= room)
        .sort((one, other) => other.value - one.value)[0];
      if (!option) continue;
      if (!bestOption || option.value > bestOption.value) {
        bestOption = option;
        bestAt = at;
      }
    }
    if (bestAt < 0 || !bestOption) break;
    const [candidate] = remaining.splice(bestAt, 1);
    chosen.push({ candidate, price: bestOption.price, shot: bestOption.shot });
    taken[candidate.man.role] += 1;
    left.credits -= bestOption.price;
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
  rules: LeagueRules,
  held: readonly Bidder[],
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
  // Scored with OUR number and through the SAME definition the plan is scored with, department
  // included: a null that still adds two keepers up would be beaten by arithmetic instead of by
  // ranking, which is exactly the flattery this function exists to avoid.
  const men = chosen.map((one) => one.candidate.man);
  return squadGain([...held, ...men], rules) - squadGain(held, rules);
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
    const want = state.free[role];
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
  const ranked = out.sort((left, right) => (right.man.fvm ?? 0) - (left.man.fvm ?? 0));
  // WITHOUT THE ROLE LOCK a manager's slots are one pool, so what caps his list is the TOTAL he can
  // still buy and not the count of each role - and the cap has to be applied to the ranked list, or it
  // is no cap at all. The old form (`min(free[role], slotsFree)` inside the loop) could never bind:
  // `slotsFree` is the SUM of `free[*]`, so it is always the larger of the two and the minimum was
  // always `free[role]` - a rule the flag was written to express and that was not implemented.
  return rules.roleLock ? ranked : ranked.slice(0, state.slotsFree);
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
  /**
   * How much of that demand could be PRICED at all, role by role: measured men over men looked at.
   *
   * On the 2026-27 Serie A sheet one row in five carries no gain (121 of 605, and 43 of them keepers),
   * so this is not a rounding note: it says how much of the rate is measurement and how much is the
   * assumption below.
   */
  covered: Record<ClassicRole, number>;
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
  const covered: Record<ClassicRole, number> = { P: 0, D: 0, C: 0, A: 0 };
  let gainAhead = 0;
  for (const role of ROLES) {
    const men = pool
      .filter((man) => man.role === role)
      // The ROOM's order and not ours - it buys the price - so the men the open slots will absorb are
      // the dearest ones, whether or not our sheet can put a number on them.
      .sort((left, right) => (right.fvm ?? 0) - (left.fvm ?? 0))
      .slice(0, demand[role])
      .map((man) => gainOf(man, rules));
    const priced = men.filter((one): one is number => one != null);
    // A MAN THE SHEET CANNOT PRICE IS NOT A MAN WORTH NOTHING. Averaging him in as a zero - which this
    // did - drags the rate down in proportion to how much of the listone we cannot read (a fifth of it,
    // and three fifths of the keepers), and every number built on the rate moves with it: `toCome`, the
    // standings, `reach` and the conduct star. So the mean is taken over what IS measured and then
    // projected onto all the slots, which is the assumption «the ones we cannot read are like the ones
    // we can» - stated here rather than hidden, and `covered` says how much of it is measurement.
    perSlot[role] = priced.length ? priced.reduce((sum, one) => sum + one, 0) / priced.length : 0;
    covered[role] = men.length ? priced.length / men.length : 0;
    gainAhead += perSlot[role] * demand[role];
  }
  let creditsAhead = 0;
  for (const state of states.values()) creditsAhead += state.credits;
  return { perSlot, perCredit: creditsAhead > 0 ? gainAhead / creditsAhead : 0, demand, covered };
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
    // Through the ONE definition, department included: a manager holding three keepers used to read
    // as a manager who fields three, which flattered whoever had spent his money in goal.
    const gain = squadGain(state.men, rules);
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
  /**
   * Written by the page itself when the next export arrived, instead of by the «registra» button.
   *
   * DECLARED and never hidden, because the two records are not the same evidence: a recorded round is
   * the envelopes as he SENT them, an automatic one is the envelopes as they STOOD when the export
   * closing that round was loaded - and he may have edited the plan in between. What the flag does NOT
   * weaken is the calibration: the chances still come from a ladder built before the new export was in,
   * so the forecast is never scored against a round it has already read.
   */
  auto?: boolean;
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
      const men = state.men.filter((man) => man.role === role);
      // The keepers are ONE place and the other three roles are not, so the P row is the department and
      // never the sum - which is exactly the row this table exists to make readable.
      const gain =
        role === 'P'
          ? keeperGain(men, rules)
          : men.reduce((sum, man) => sum + (gainOf(man, rules) ?? 0), 0);
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
 * NOTHING IS FILTERED OUT HERE BUT THE MEN ALREADY IN THE PLAN, and the comment used to promise that
 * while the code did not: it required a GAIN, which hid two different unknowns behind one condition.
 * The operator found it on a name (25/08/2026): «come mai non mi esce il portiere Martinez dell'Inter?»
 * - Josep Martínez is expected in 10.6 matchdays of 38, i.e. 28% against the league's own 35% floor, so
 * the engine gives him no comparable number and he vanished from the alternatives AND from the modal,
 * while the RIVALS' lists (which ask for a quotation, not for a gain) went on showing him.
 *
 * He belongs here for the reason this list exists: it is what the operator picks from BY HAND, and the
 * third keeper - «uno che gioca sempre, o il compagno di squadra di un portiere che hai già» - is by
 * construction a man below that floor. `candidates` is sorted with the unpriced last, so he sits at the
 * bottom with a dash where his number would be: listed apart, never proposed. The PLAN still refuses
 * him (`priced` is the gate there), which is the split that was asked for.
 */
export function boardFor(
  role: ClassicRole,
  candidates: readonly Candidate[],
  plan: BidPlan,
  exclude?: number,
): Candidate[] {
  const chosen = new Set(plan.bids.map((one) => one.candidate.man.fcId));
  return candidates.filter(
    (one) => one.man.role === role && one.man.fcId !== exclude && !chosen.has(one.man.fcId),
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
): { candidate: Candidate; delta: number | null; affordable: boolean }[] {
  return boardFor(bid.candidate.man.role, candidates, plan, bid.candidate.man.fcId)
    .slice(0, howMany)
    .map((candidate) => ({
      candidate,
      // NULL and not zero when either side has no number: `(gain ?? 0) - gain` reads as «he is worth
      // exactly the other man less», which is a measurement nobody made. Now that an unpriced man can
      // stand in this list, the column has to be able to say «non lo so».
      delta:
        candidate.gain == null || bid.candidate.gain == null
          ? null
          : candidate.gain - bid.candidate.gain,
      affordable: candidate.ask.ask - bid.offer <= budgetLeft,
    }));
}

/** The shape of `classic_modules.json` this file needs. Structural, so the bundle's own type fits. */
export interface ModulesFile {
  modules: Record<string, Record<string, string[]>>;
}

/** A shape the envelopes are tuned on: the rulebook's own name for it, and what it fields per role. */
export interface Reference {
  name: string;
  places: Record<ClassicRole, number>;
}

/**
 * How many men of each role an eleven FIELDS - the FALLBACK, for when the rulebook did not load.
 *
 * The toolkit's own `features.fielded_places` for classic - P 1 · D 4 · C 4 · A 2, eleven in total -
 * counted there from the game's own rulebook and quoted here rather than invented, because it is the
 * demand a squad has to cover before depth is worth anything. It is not the same as the SLOTS a roster
 * holds (3-8-8-6 = 25): the slots say what you may own, this says what plays on Sunday.
 *
 * It stopped being THE reference on 25/08/2026, on the operator's instruction: «il 3-4-3 nel classic è
 * una formazione molto gettonata ma per chi usa il modificatore di difesa anche il 4-3-3 è molto
 * frequente ... devi tarare le buste scegliendo quali dei due moduli prendere come riferimento in base ai
 * calciatori già in rosa e quelli rimanenti». 1-4-4-2 is neither of the two, and its A = 2 was making a
 * third forward look like depth when in both of his shapes he is a STARTER. So the reference is now
 * chosen (`referenceShape`), and this is what stands in when `classic_modules.json` is missing - said on
 * screen and never silently, because a silent fallback is indistinguishable from a broken feature.
 */
export const STANDARD_ELEVEN: Reference = { name: '1-4-4-2', places: { P: 1, D: 4, C: 4, A: 2 } };

/**
 * THE TWO SHAPES THE OPERATOR DECLARED, in the order they are preferred when nothing separates them.
 *
 * His own words of 25/08/2026, and both field THREE forwards, which is the half of this change that
 * needed no choosing. The other five of the rulebook are not excluded - they are the FALLBACK, for when
 * neither of these two can be covered (his decision, same day) - and the preference is declared here
 * rather than derived, because «which shapes does the room play» is a fact about his league.
 */
export const DECLARED_SHAPES = ['3-4-3', '4-3-3'] as const;

/**
 * The rulebook's shapes, read and never transcribed.
 *
 * `config/classic_modules.json` says so about itself - it is CONFIGURATION, «read and never fitted» -
 * and it carries its own transcription check (every module sums to ten outfield men and its three lines
 * reproduce its name). So the places come from there and the keeper is the one the game always fields; a
 * shape whose lines do not add up to ten is dropped rather than drawn, because a reference that fields
 * twelve men is worse than a reference nobody chose.
 */
export function shapesOf(file: ModulesFile | null): Reference[] {
  const modules = (file?.modules ?? {}) as Record<string, Record<string, string[]>>;
  const out: Reference[] = [];
  for (const [name, lines] of Object.entries(modules)) {
    const places: Record<ClassicRole, number> = { P: 1, D: 0, C: 0, A: 0 };
    for (const slots of Object.values(lines ?? {})) {
      for (const slot of slots ?? []) {
        // Classic legality is per MACRO-ROLE and the file's own comment insists on it: a place is a P, a
        // D, a C or an A. Anything else is a mantra code and does not belong to a classic shape.
        if (slot === 'D' || slot === 'C' || slot === 'A') places[slot] += 1;
      }
    }
    if (places.D + places.C + places.A === 10) out.push({ name, places });
  }
  return out;
}

/**
 * THE EMPTY PLACES A DEPARTMENT LEAVES ON A TYPICAL MATCHDAY - what «is this role covered?» really asks.
 *
 * Born on 25/08/2026 from the operator's own objection, and it is the outfield twin of the lesson the
 * keepers taught the same evening: «non capisco perché nei consigli di reparto dici che la difesa è
 * SCOPERTA - Molina N., Solet, Di Lorenzo, Kalulu, Bisseck sono 5 ottimi difensori, quindi la difesa va
 * solo puntellata e non vale la pena spendere crediti che possono essere usati in altri reparti».
 *
 * The verdict was counting men whose RUNG is `titolare` or better: three of those five are (`bandiera`),
 * Bisseck and Molina read `ballottaggio`, so against four places it said «ti manca un titolare». True
 * about each man and the wrong question about the SET - their own shares of the calendar are 0.87 · 0.81
 * · 0.67 · 0.66 · 0.50, which cover 3.36 of four places, i.e. **0.64 of a hole a matchday**. A per-man
 * binary cannot answer a question about a department, which is what `keeperGain` says about the goal one
 * place along.
 *
 * Exact and not simulated: the men of a role are independent draws (his own share, `expected /
 * matchdays`), so «how many have a vote» is a convolution and the expected shortfall is a sum over it.
 * Nothing here is fitted; the only choice is `HOLE_TARGET` below.
 *
 * A man with no readable `expected` is left OUT instead of counted as absent, and the advice says how
 * many those were - «vuoto = ignoto, mai zero». On the 2026-27 Serie A sheet there are none: all 605 rows
 * carry a prediction, where 102 carry no rung at all, and that is the second reason this reading beats
 * the count it replaces.
 */
export function expectedHoles(
  men: readonly Bidder[],
  role: ClassicRole,
  places: number,
  rules: LeagueRules,
): number {
  if (!places) return 0;
  // THE KEEPERS ARE ONE PLACE AND THEIR SHARES ARE NOT INDEPENDENT DRAWS: two men of one club never
  // play the same match, so «is one of mine playing» is the department's own covered share and not a
  // convolution - which reads Milinkovic-Savic + Meret as 0.87 of the calendar where they cover 1.00.
  // Same entry point on purpose: one question about empty places, one answer, whatever the role.
  if (role === 'P') return Math.max(0, places - keeperCovered(men, rules));
  const shares = men
    .filter((man) => man.role === role && man.expected != null)
    .map((man) => Math.min(1, Math.max(0, (man.expected as number) / rules.matchdays)));
  let dist = [1];
  for (const share of shares) {
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((probability, at) => {
      next[at] += probability * (1 - share);
      next[at + 1] += probability * share;
    });
    dist = next;
  }
  return dist.reduce((holes, probability, at) => holes + probability * Math.max(0, places - at), 0);
}

/**
 * FROM HOW BIG A HOLE A DEPARTMENT COUNTS AS UNCOVERED. One whole place, on a typical matchday.
 *
 * DECLARED and not measured, and it is said here so nobody reads it as fitted: what a hole COSTS is
 * known - the bench, about half a point of fantamedia under the rostered replacement (root CLAUDE.md,
 * «the zero of a metric is a question») - but the point at which he should spend a credit rather than
 * accept it is a preference. One place is the reading his own sentence uses: «ti manca un titolare per
 * coprire l'undici».
 *
 * It is also what keeps the verdict and the PLAN telling one story, which is his rule of the same day
 * («le buste consigliate devono rispecchiare i consigli che dai reparto per reparto»): the screen calls a
 * role `scoperto` on this threshold and `ensureSure` buys until it is met. The MECHANISM changed - it
 * used to be a count of men who play - and the rule survived, because it is one definition with three
 * readers: the verdict, the repair, and the choice of the reference shape itself.
 */
export const HOLE_TARGET = 1;

/** Which shape the envelopes are tuned on, what it leaves open, and the one that came second. */
export interface ReferenceChoice {
  chosen: Reference;
  /** The best of the shapes NOT chosen: an automatic choice must be doubtable. */
  runnerUp: Reference | null;
  /** The chosen shape's empty places per role, on the squad as it stands. */
  holes: Record<ClassicRole, number>;
  /** ...of which these cannot be filled from what is left on the board, given his free slots. */
  unfillable: Record<ClassicRole, number>;
  /** True when neither declared shape was coverable and the rulebook's other five were consulted. */
  fellBack: boolean;
  /** True when `classic_modules.json` did not load and the standard eleven is standing in. */
  noRulebook: boolean;
  /** The sentence the screen shows: a target nobody can see is a target nobody can correct. */
  why: string;
}

/**
 * WHICH MODULE THE ENVELOPES ARE TUNED ON, chosen from the squad and from what is left on the board.
 *
 * The operator's instruction of 25/08/2026, quoted at `STANDARD_ELEVEN`. Three rules hold it, and the
 * first two are his:
 *
 *  1. HIS TWO SHAPES COME FIRST (`DECLARED_SHAPES`), and the other five of the rulebook are consulted
 *     only when neither of the two can be covered - «se nessuno dei due è copribile, sì, gli altri
 *     cinque del regolamento». So the target does not wander while he is buying, which is what a
 *     reference is for, and a TIE never moves it.
 *  2. THE DEFENCE MODIFIER IS AN INPUT AND IT BINDS. «sì è attivo e deve essere una informazione da
 *     mettere come input», so it is declared in `LeagueRules` beside the budget and the slots, never
 *     inferred; and when it is on, a shape that fields four defenders is preferred as long as four
 *     defenders who play are within reach - the bonus cannot be earned with three, so a reference of
 *     three would tune the page away from money the league is offering. What the modifier is WORTH is
 *     priced nowhere yet, and that is written down rather than guessed.
 *  3. THE COST OF A SHAPE IS ITS HOLES (`expectedHoles`), never a count of men - the same definition the
 *     verdict and the repair read. A hole he can still FILL is not a reason to abandon a shape, which is
 *     the «e quelli rimanenti» half of his sentence, so shapes are compared on what cannot be filled
 *     first and on the holes themselves second.
 */
export function referenceShape(input: {
  squad: TeamState;
  candidates: readonly Candidate[];
  rules: LeagueRules;
  shapes: readonly Reference[];
}): ReferenceChoice {
  const { squad, candidates, rules, shapes } = input;
  // How many more men who PLAY he could still add per role: his free slots, capped by who is left on the
  // board within his ceiling. This is «quelli rimanenti», and it is a fact and not a forecast.
  const gettable = EMPTY_COUNT();
  for (const role of ROLES) {
    if (!squad.free[role]) continue;
    const regulars = priced(candidates).filter(
      (one) =>
        one.man.role === role && playsOften(one.man, rules) === true && one.ask.ask <= squad.ceiling,
    ).length;
    gettable[role] = Math.min(squad.free[role], regulars);
  }
  const sum = (counts: Record<ClassicRole, number>) =>
    ROLES.reduce((total, role) => total + counts[role], 0);
  const priceOf = (shape: Reference) => {
    const holes = EMPTY_COUNT();
    const unfillable = EMPTY_COUNT();
    for (const role of ROLES) {
      holes[role] = expectedHoles(squad.men, role, shape.places[role], rules);
      unfillable[role] = Math.max(0, holes[role] - gettable[role]);
    }
    return { shape, holes, unfillable, cannot: sum(unfillable), open: sum(holes) };
  };

  const noRulebook = !shapes.length;
  const all = (noRulebook ? [STANDARD_ELEVEN] : shapes).map(priceOf);
  const named = (one: { shape: Reference }) =>
    (DECLARED_SHAPES as readonly string[]).indexOf(one.shape.name);
  const declared = all.filter((one) => named(one) >= 0);
  const pool = declared.length ? declared : all;
  // The modifier's own preference, applied only where it can be EARNED: four defenders who play have to
  // be reachable, or it is a bonus on a shape nobody can field.
  const fourAtTheBack = pool.filter((one) => one.shape.places.D >= 4 && one.unfillable.D <= 0);
  const preferred = rules.defenceModifier && fourAtTheBack.length ? fourAtTheBack : pool;
  const order = (left: typeof all[number], right: typeof all[number]) =>
    left.cannot - right.cannot ||
    left.open - right.open ||
    Math.max(0, named(left)) - Math.max(0, named(right));
  let best = [...preferred].sort(order)[0];
  let fellBack = false;
  if (best.cannot > 0 && declared.length && all.length > declared.length) {
    const wider = [...all].sort(order)[0];
    // Strictly better only: a tie must not move the target he is buying against.
    if (wider.cannot < best.cannot) {
      best = wider;
      fellBack = true;
    }
  }
  const runnerUp = [...all].filter((one) => one.shape !== best.shape).sort(order)[0]?.shape ?? null;
  const short = ROLES.filter((role) => best.holes[role] >= HOLE_TARGET);
  const why = noRulebook
    ? "Il regolamento dei moduli non è nel bundle, quindi taro sull'undici standard 1-4-4-2. " +
      'Con `classic_modules.json` scelgo fra 3-4-3 e 4-3-3 in base alla tua rosa.'
    : `Buste tarate sul ${best.shape.name}` +
      (rules.defenceModifier && best.shape.places.D >= 4
        ? ' (modificatore di difesa attivo: con quattro difensori che giocano a portata, il quarto lo vuoi)'
        : '') +
      (fellBack ? ", perché nessuno dei due moduli dichiarati era copribile" : '') +
      (short.length ? `. Scoperto in ${short.join(', ')}.` : '. Ogni reparto copre le sue maglie.') +
      (runnerUp ? ` Secondo: ${runnerUp.name}.` : '');
  return { chosen: best.shape, runnerUp, holes: best.holes, unfillable: best.unfillable, fellBack, noRulebook, why };
}

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
  const free = candidates.filter(
    (one) => one.man.role === 'P' && one.gain != null && buyable(one.man),
  );
  const owned = mine.men.filter((man) => man.role === 'P');
  const byClub = new Map<string, Candidate[]>();
  for (const one of free) {
    if ((titolaritaRank(one.man.titolarita) ?? 99) > KEEPER_DISPUTE) continue;
    byClub.set(one.man.club, [...(byClub.get(one.man.club) ?? []), one]);
  }
  const pairs = [...byClub.entries()]
    .map(([club, men]) => {
      const sorted = [...men].sort((left, right) => (right.gain ?? 0) - (left.gain ?? 0));
      // THE MAN THE BOARD DRAWS IS THE HALF A PAIR CANNOT BE WITHOUT, and taking the two best by gain
      // was not the same thing: at a club with three claimants it can pick two men who are both behind
      // somebody else - the Juventus case (`ownsShirt`). He is also named FIRST, because he is the one
      // expected to play and the operator reads the pair as «lui, più chi gliela gioca».
      const shirt = sorted.find((one) => drawnInGoal(one.man));
      const mate = sorted.find((one) => one !== shirt);
      if (!shirt || !mate) return null;
      return { club, men: [shirt, mate], cost: shirt.ask.ask + mate.ask.ask };
    })
    .filter((pair): pair is { club: string; men: Candidate[]; cost: number } => pair != null)
    .filter((pair) => pair.cost <= mine.ceiling)
    .sort(
      (left, right) =>
        Math.max(...right.men.map((one) => one.gain ?? 0)) -
        Math.max(...left.men.map((one) => one.gain ?? 0)),
    );
  const dependable = free
    .filter((one) => playsOften(one.man, rules) === true && one.ask.ask <= mine.ceiling)
    .sort((left, right) => (right.gain ?? 0) - (left.gain ?? 0));
  // ...and «entrambi quelli che se la giocano» is `ownsShirt` too: two keepers of one club whom the
  // board draws NEITHER cover no shirt, so they do not cover the department either.
  const covered =
    owned.some((man) => playsOften(man, rules) === true) ||
    owned.some((man) => ownsShirt(owned, man.club));
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
  /**
   * ...and how many of those places stay EMPTY on a typical matchday, squad + this round's envelopes.
   *
   * The number the verdict is decided on (`expectedHoles`), carried out so the screen shows the reason
   * and not only the word: «scoperto» with 0,6 beside it is a different sentence from «scoperto» alone.
   */
  holes: number;
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
 * THE VERDICT IS ABOUT THE ELEVEN, not about the roster. A department is `scoperto` when the shape it is
 * tuned on (`referenceShape`) would leave a whole place EMPTY on a typical matchday (`expectedHoles` and
 * `HOLE_TARGET`) - which is why a squad with six defenders can still be uncovered, and why filling the
 * last slots of a covered one is a different piece of advice and says so. It used to count the men whose
 * rung is `titolare` or better, and 25/08/2026 is where that stopped being enough: five defenders of whom
 * two read `ballottaggio` cover 3.36 places of four, and calling that «ti manca un titolare» was a
 * per-man answer to a question about the SET.
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
  /**
   * The shape the plan was tuned on - pass `BidPlan.reference`, never a second choice of your own.
   *
   * Defaults to the standard eleven, the number this file used to hard-code, so an un-updated caller
   * reads what it read yesterday rather than a new guess.
   */
  reference?: Reference;
}): RoleAdvice[] {
  const { mine, states, candidates, scale, rules, bids = [], reference = STANDARD_ELEVEN } = input;
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
    const fielded = reference.places[role];
    // WHAT «COPERTO» MEANS, and it is no longer a count of men: the places this department leaves empty
    // on a typical matchday, computed on the squad AND on the envelopes this round would win, because a
    // verdict that ignored the plan would argue with the plan.
    const holes = expectedHoles(
      [...mine.men, ...bidding.map((one) => one.man)],
      role,
      fielded,
      rules,
    );
    const holesWord = holes.toLocaleString('it-IT', { maximumFractionDigits: 1 });
    const rank = line?.rank ?? 0;

    // What is still out there, in the two shapes the advice can point at: quality, and men who play.
    const taken = new Set(bidding.map((one) => one.man.fcId));
    // `buyable` here too: «il migliore libero e' X» is a SUGGESTION, and suggesting a man who will be
    // out for another month is the thing that was refused - even though he stays on the board next door.
    const board = candidates.filter(
      (one) =>
        one.man.role === role &&
        one.gain != null &&
        buyable(one.man) &&
        !taken.has(one.man.fcId),
    );
    const reachable = board.filter((one) => one.ask.ask <= mine.ceiling);
    const tops = reachable.filter((one) => gainBandOf(one.gain, scale) === 'ottimo');
    const regulars = reachable.filter((one) => playsOften(one.man, rules) === true);
    const cheapRegulars = regulars.filter((one) => one.ask.ask <= 2);
    const name = (one: Candidate | undefined): string =>
      one ? `${one.man.name} (${one.ask.ask} cr)` : '';

    // Kept as the SENTENCE's own number and no longer as the verdict's: «ne hai 3 su 4» is true and
    // worth reading, it just is not what decides whether a department is covered.
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
        // IL COMPAGNO DI SQUADRA DI UN PORTIERE CHE HA GIÀ, per nome: è la terza delle sue regole sui
        // portieri, e finora era solo una frase. Si prende dal tabellone INTERO e non dai soli uomini
        // con un numero, perché un terzo portiere sta sotto la soglia delle presenze per definizione -
        // è il motivo per cui non ne aveva mai visto uno consigliato.
        const clubs = new Set(mine.men.filter((one) => one.role === 'P').map((one) => one.club));
        const mates = candidates
          .filter((one) => one.man.role === 'P' && clubs.has(one.man.club))
          .sort((left, right) => left.ask.ask - right.ask.ask);
        targets = mates.length ? mates.slice(0, 2) : (cheapRegulars.length ? cheapRegulars : regulars).slice(0, 3);
        advice =
          `La porta è coperta. I ${free} slot che restano sono da terzo portiere: o uno che gioca ` +
          'sempre, o il compagno di squadra di un portiere che hai già - non un altro titolare pagato ' +
          'a prezzo pieno che poi guardi dalla panchina.' +
          (mates.length
            ? ` In rosa hai la porta di ${[...clubs].join(', ')}: il compagno costa ${mates[0].ask.ask} ` +
              `crediti (${mates[0].man.name}) e ti copre quella maglia qualunque dei due giochi.`
            : '');
      }
      advice += plannedWords(bidding, arriving, rules);
      if (unknown) {
        advice += ` ${unknown} dei tuoi non ha un gradino misurato: non li ho contati come titolari.`;
      }
      return {
        role, held, free, starters, unknown, fielded, holes,
        gain: line?.gain ?? 0, rank, of, state, advice, targets, bidding,
      };
    }

    if (!free) {
      state = 'chiuso';
      advice = rules.roleLock
        ? `Ruolo pieno: ${held} uomini su ${held}, non puoi più bustare qui.`
        : `Hai già i tuoi ${held}: una busta qui toglierebbe crediti a un reparto ancora scoperto.`;
    } else if (holes >= HOLE_TARGET) {
      state = 'scoperto';
      targets = regulars.slice(0, 3);
      advice =
        `Su ${fielded} maglie del ${reference.name} te ne restano ${holesWord} vuote a giornata` +
        `${missing > 0 ? ` (di titolari ne hai ${starters})` : ''}: è il buco che costa più punti, ` +
        'perché ogni giornata lo copri con la panchina. Qui cerca chi GIOCA, non chi costa poco: ' +
        (regulars.length
          ? `liberi ${regulars.length} uomini alla tua portata che prendono il voto quasi ogni ` +
            `giornata${tops.length ? `, ${tops.length} dei quali di prima fascia` : ''}. Il migliore: ` +
            `${name(targets[0])}.`
          : 'ma alla tua portata non ne è rimasto nessuno, quindi alza il tetto lasciando qualche slot per dopo.');
    } else if (rank && rank <= Math.ceil(of / 3)) {
      state = 'solido';
      targets = cheapRegulars.slice(0, 3);
      advice =
        `${rank}º della lega in questo ruolo e le ${fielded} maglie del ${reference.name} le copri ` +
        `(${holesWord} di buco a giornata, ${held} uomini in rosa): qui non serve altro. Riempi i ` +
        `${free} slot con l'ultimo prezzo` +
        (cheapRegulars.length ? ` - ${cheapRegulars.length} uomini a 1-2 crediti prendono comunque il voto.` : '.') +
        ' I crediti rendono di più dove sei scoperto.';
    } else {
      state = 'da completare';
      targets = (cheapRegulars.length ? cheapRegulars : regulars).slice(0, 3);
      advice =
        `Le ${fielded} maglie del ${reference.name} le copri (${holesWord} di buco a giornata) ma il ` +
        `reparto è ${rank}º di ${of}: ${free} slot da riempire. ` +
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
      holes,
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
