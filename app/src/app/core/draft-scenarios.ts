/**
 * THE DRAFT SCENARIOS (the operator, 29/09/2026, after the live draft FA-jo5-zai): «a partire dalla rosa, vedere
 * le posizioni non coperte o coperte male, proporre delle soluzioni e mostrarne le conseguenze, ovvero dopo quanti
 * turni cadrebbe la prossima scelta e quali calciatori utili rimarrebbero per sistemare le altre posizioni».
 *
 *   diagnose  the module that fields our best men together, and the places to fix on it;
 *   scenario  a chain  A --wait--> A2 : A fills a place now, the rivals call until our next pick (how many
 *             depends on A's FVM, by the platform's own order rule), A2 is the best man left for the place
 *             that is then the most urgent.
 *
 * WHAT «COVERED BADLY» MEANS IS A FIRST DECLARED READING, to be tuned with the operator on real cases (his words:
 * «poi vediamo bene come tarare il giudizio sulla copertura di una posizione nel campetto»): a place is
 * EMPTY when nobody can stand there, WEAK when its holder's Draft Priority is below zero - he gives less than an
 * average starter of his base role - and WITHOUT A RESERVE when nobody on the bench can take it. That is the
 * order of urgency, and inside a class the bigger gap first.
 *
 * Nothing here predicts a footballer: the men's numbers are the Draft Priority's (`draft-priority.ts`), the rivals
 * are predicted by the advice's own walker (`auction-plan.rivalWalker`) and the legality is the rulebook's.
 * The file imports no Angular.
 */

import { PlanPlayer, PlanTeam, RivalWalkInput, SURVIVOR_DISCOUNT, rivalWalker, take, walkToOurTurn } from './auction-plan';
import { MantraModules } from './auction-value';
import { CallRules, PriorityMan, WorthContext, baseRole, legalFor, manValue } from './draft-priority';
import { Place, bestEleven, placesIn } from './mantra-legal';
import { DOOR_HOLE_COST, doorHolePrice } from './draft-pitch';
import { isKeeperSlot } from './auction-plan';

/** Whether a keeper may be proposed to this squad now (`ScenarioInput.keepers`); every other man may. */
export function keeperAllowed(team: PlanTeam, player: PlanPlayer, input: ScenarioInput, picksLeft: number): boolean {
  const rule = input.keepers;
  if (!rule || !isKeeperSlot(player.slot) || rule.firsts.has(player.id)) return true;
  const doors = team.slots.filter(isKeeperSlot).length;
  if (picksLeft <= input.calls.keeperCap - doors) return true;
  // The deputy of a keeper I own may come any time (the survivor discount sends him late by itself); a non-first of
  // ANOTHER club only at the last calls, where the door is closed with what is left (operator, 01/10/2026: «il terzo
  // è quasi sempre l'ultima chiamata»).
  const club = rule.clubOf(player.id);
  if (club != null && team.heldIds.some((id) => rule.clubOf(id) === club && isKeeperSlot(teamSlotOf(team, id)))) return true;
  return picksLeft <= input.calls.keeperCap - doors + 1;
}

/** The slot a held man was called on, by id ('' when the squad does not say). */
function teamSlotOf(team: PlanTeam, id: number): string {
  const at = team.heldIds.indexOf(id);
  return at >= 0 ? (team.slots[at] ?? '') : '';
}

/** The door's price at THIS squad's decision: its keeper places still open over its picks left, one price per move. */
export function doorPriceFor(team: PlanTeam, input: ScenarioInput, picksLeft: number): number {
  const doors = team.slots.filter(isKeeperSlot).length;
  return doorHolePrice(input.calls.keeperCap - doors, picksLeft);
}

export type NeedKind = 'vuoto' | 'debole' | 'scoperto' | 'senza riserva';

/** A place of the module to fix, and why. */
export interface PlaceNeed {
  kind: NeedKind;
  place: Place;
  /** Who stands there now; null on an empty place. */
  holder: PriorityMan | null;
  /** How urgent inside its kind: the holder's gap under an average starter, in points per matchday. */
  gap: number;
}

export interface Diagnosis {
  /** The module that fields the squad's best men together (the preferred shapes win a tie). */
  module: string;
  needs: PlaceNeed[];
}

export interface ScenarioStep {
  player: PlanPlayer;
  /** His Draft Priority, points per matchday. */
  priority: number;
  /** How much the WHOLE squad gains by taking him (`squadWorth` after minus before), points per matchday. */
  gain: number;
  /** The place he is taken for. */
  need: PlaceNeed | null;
  /** For a LATER step (`Scenario.later`): how many picks the rivals make before it, after our previous one. */
  wait?: number;
}

export interface Scenario {
  first: ScenarioStep;
  /** How many picks the rivals make between A and our next pick. */
  wait: number;
  /** Where we call next (1 = first of the round). */
  nextAt: number;
  /** The best man left for the most urgent place at our next pick; null when the pool has none. */
  second: ScenarioStep | null;
  /** The men the rivals are predicted to take before our next pick, this round's included: player id -> team id. */
  gone: Map<number, number>;
  /** What the squad gains over the two picks on screen, first.gain + second.gain, points per matchday. */
  total: number;
  /** Our best pick at each of our turns AFTER the second, up to `CHAIN_TURNS` picks in all (rivals walked between). */
  later: ScenarioStep[];
  /** What the squad gains over the whole chain, `total` plus the later picks: the RANKING (`CHAIN_TURNS`). */
  horizon: number;
  /** The squads calling during the wait that want the second man, and why (`interestIn`), one each. */
  interested: Interest[];
  difficulty: Difficulty;
}

/** Why a rival wants the second man: he has nobody of that role, fewer than a shape starts, or only weak ones. */
export interface Interest {
  teamId: number;
  why: 'nessuno' | 'pochi' | 'scarsi';
  /** The base role the question was asked on, lowercase. */
  role: string;
}

export type Difficulty = 'sicuro' | 'facile' | 'medio' | 'difficile';

/**
 * HOW HARD A PLAN IS (the operator, 29/09/2026): «0 scelte inframezze: sicuro; poi per ogni scelta inframezza
 * bisogna valutare se la squadra è interessata al secondo calciatore (ad esempio non ha calciatori di quel ruolo o ne
 * ha pochi o quelli che ha sono scarsi); più squadre inframezze sono interessate più il piano si complica». So: no
 * pick in between is SAFE, no squad interested is EASY, one is MEDIUM, two or more HARD. The cut at two is ours and
 * declared; the three reasons are his words, read on each rival's roster at the moment he calls.
 */
export const HARD_FROM = 2;

export interface ScenarioInput extends RivalWalkInput {
  rules: MantraModules;
  worth: WorthContext;
  matchdays: number;
  calls: CallRules;
  manOf: (id: number) => PriorityMan | null;
  /**
   * THE DRAFT PITCH, when the caller has one (operator, 01/10/2026: «procedi con le correzioni»): the plans are then
   * ranked on what the pitch and +Rosa measure - the squad's fertility with its reserves, coverage on a tie - and
   * the places to fix are the PITCH's, on its own eleven and its coverage. Without it the Draft Priority of the best
   * eleven decides, as before (the bench and the tests that do not build a pitch).
   */
  pitch?: SquadPitch;
  /**
   * WHO THE RIVALS ARE PREDICTED TO TAKE BEFORE OUR NEXT PICK (player id -> squad), when the caller has the walk
   * (operator, 01/10/2026: «come possiamo trovare il momento giusto?»). A man NOT in it will still be there, so his
   * gain counts at `SURVIVOR_DISCOUNT` when the moves are RANKED - take who will be gone, harvest who survives, the
   * draft bench's strongest result (+4.54%, strict on 5/5). The gain printed stays his whole gain.
   */
  gone?: ReadonlyMap<number, number>;
  /**
   * THE KEEPERS WHO OWN THEIR CLUB'S SHIRT (operator, 01/10/2026: «prendere Sanchez Ro. che non è un titolarissimo è
   * molto rischioso perché non hai la certezza di prendere anche l'altro»), and the club of every man. A keeper who is
   * not his club's first is worth his cover only next to his club's other keeper, which nobody guarantees, so he is
   * a move only as the DEPUTY of a keeper the squad holds, or at the last calls (picks left <= keeper places open + 1). Absent = no such rule (the bench, the tests that build no pitch).
   */
  keepers?: { firsts: ReadonlySet<number>; clubOf: (id: number) => string | null };
  /**
   * THE MEN THE OPERATOR TOOK OUT OF HIS ADVICE (operator, 05/10/2026: «dammi la possibilità di escludere dei calciatori
   * dai consigli»): never one of OUR moves, while the rivals may still call them - an excluded man is a preference
   * about our squad, not a fact about the table. Absent = nobody excluded.
   */
  excluded?: ReadonlySet<number>;
}

/** What the draft pitch says about a squad, in the scenarios' terms (`ScenarioInput.pitch`). */
export interface SquadPitch {
  /** What the squad yields, the quantity the plans are ranked on: higher is better, and differences add. */
  /** `doorHole` is the price of an uncovered door week at the decision being weighed (`draft-pitch.doorHolePrice`). */
  worth(roster: readonly PriorityMan[], doorHole: number): number;
  /** The places to fix on the pitch's eleven, most urgent first. */
  diagnose(roster: readonly PriorityMan[]): Diagnosis | null;
  /** The place the man would stand on, as a starter or a reserve; null where he adds nothing. */
  placeOf(roster: readonly PriorityMan[], man: PriorityMan): Place | null;
}

const URGENCY: Record<NeedKind, number> = { vuoto: 0, debole: 1, scoperto: 2, 'senza riserva': 3 };

const expected = (man: PriorityMan) => (man.share ?? 0) * (man.fm ?? 0);

const fits = (roles: readonly string[], place: Place) => roles.some((role) => place.roles.includes(role.toLowerCase()));

/** The module our men field best together, and every place on it that needs fixing, most urgent first. */
export function diagnose(roster: readonly PriorityMan[], rules: MantraModules, worth: WorthContext,
  matchdays: number): Diagnosis | null {
  const xi = bestEleven(roster, rules, expected);
  const module = xi?.module ?? Object.keys(rules.modules ?? {})[0];
  if (!module) return null;
  const places = xi?.places ?? placesIn(rules, module);
  const holders = xi?.holders ?? places.map(() => null);
  const starting = new Set(holders.filter((m): m is PriorityMan => !!m).map((m) => m.id));
  const bench = roster.filter((man) => !starting.has(man.id));
  const needs: PlaceNeed[] = [];
  places.forEach((place, at) => {
    const holder = holders[at];
    if (!holder) {
      needs.push({ kind: 'vuoto', place, holder: null, gap: 0 });
      return;
    }
    const value = manValue(holder, worth, matchdays);
    if (value != null && value < 0) {
      needs.push({ kind: 'debole', place, holder, gap: -value });
      return;
    }
    if (!bench.some((man) => fits(man.roles, place))) needs.push({ kind: 'senza riserva', place, holder, gap: 0 });
  });
  needs.sort((a, b) => URGENCY[a.kind] - URGENCY[b.kind] || b.gap - a.gap);
  return { module, needs };
}

/** The places to fix: the pitch's where the caller has one, the Draft Priority's eleven otherwise. */
export function diagnosisOf(roster: readonly PriorityMan[], input: ScenarioInput): Diagnosis | null {
  return input.pitch ? input.pitch.diagnose(roster) : diagnose(roster, input.rules, input.worth, input.matchdays);
}

/** The squad as the priority reads it. */
const rosterOf = (team: PlanTeam, manOf: ScenarioInput['manOf']) =>
  team.heldIds.map(manOf).filter((man): man is PriorityMan => !!man);

/**
 * WHAT A SQUAD IS WORTH, in the Draft Priority's own units (the operator, 29/09/2026: «la strategia deve partire
 * puntando alla mossa che farebbe migliorare in maniera più alta l'intera rosa»): the sum of the Draft Priority of
 * the men our best eleven fields. An EMPTY place counts 0 - the promise of an average starter of its role, which is
 * what the Draft Priority's zero Z is - for as long as the picks left can still fill it; a place the picks left can
 * no longer reach is a hole that scores nothing, so it costs its role's Z (the cheapest holes are the ones left).
 * The bench is not counted: a man who does not enter the eleven gains the squad nothing here, which is stated.
 */
export function squadWorth(roster: readonly PriorityMan[], input: ScenarioInput, picksLeft: number,
  doorHole = DOOR_HOLE_COST): number {
  if (input.pitch) return input.pitch.worth(roster, doorHole);
  const xi = bestEleven(roster, input.rules, expected);
  const first = Object.keys(input.rules.modules ?? {})[0];
  const places = xi?.places ?? (first ? placesIn(input.rules, first) : []);
  const holders = xi?.holders ?? places.map(() => null);
  let total = 0;
  const holes: number[] = [];
  places.forEach((place, at) => {
    const holder = holders[at];
    if (holder) total += manValue(holder, input.worth, input.matchdays) ?? 0;
    else holes.push(input.worth.stats.get(baseRole(input.rules, place.roles, null))?.z ?? 0);
  });
  const unreachable = holes.length - Math.max(0, picksLeft);
  if (unreachable > 0) total -= holes.sort((a, b) => a - b).slice(0, unreachable).reduce((sum, z) => sum + z, 0);
  return total;
}

/** How many men the gain is computed for: the best by Draft Priority, plus the best for every place to fix. */
const CANDIDATES = 40;

/**
 * THE MOVES, BY WHAT THEY GIVE THE WHOLE SQUAD: every man the rules let the squad call among the best by Draft
 * Priority (and the best for each place the diagnosis names, so a door is weighed even when no door is in the
 * top), with his gain on the squad. Best gain first; a tie goes to the higher Draft Priority.
 */
export function movesFor(team: PlanTeam, pool: readonly PlanPlayer[], input: ScenarioInput): ScenarioStep[] {
  const roster = rosterOf(team, input.manOf);
  const left = input.calls.rounds - team.picksCount;
  const door = doorPriceFor(team, input, left);
  const before = squadWorth(roster, input, left, door);
  const priced: { player: PlanPlayer; man: PriorityMan; priority: number }[] = [];
  const excluded = team.id === input.mineId ? input.excluded : undefined;
  for (const player of legalFor(team, pool, input.calls)) {
    if (excluded?.has(player.id)) continue;
    if (!keeperAllowed(team, player, input, left)) continue;
    const man = input.manOf(player.id);
    const priority = man ? manValue(man, input.worth, input.matchdays) : null;
    if (man && priority != null) priced.push({ player, man, priority });
  }
  priced.sort((a, b) => b.priority - a.priority);
  const picked = new Set(priced.slice(0, CANDIDATES));
  const needs = diagnosisOf(roster, input)?.needs ?? [];
  for (const need of needs) {
    const best = priced.find((one) => fits(one.player.roles, need.place));
    if (best) picked.add(best);
  }
  return [...picked]
    .map(({ player, man, priority }): ScenarioStep => ({
      player, priority, need: null,
      gain: squadWorth([...roster, man], input, left - 1, door) - before,
    }))
    .sort((a, b) => rankGain(b, input, left) - rankGain(a, input, left) || b.priority - a.priority);
}

/**
 * The gain a move is RANKED on: his whole gain if the rivals are predicted to take him before our next pick (or if
 * there is no next pick), `SURVIVOR_DISCOUNT` of it if he will still be there. A loss is never discounted - waiting
 * does not make a bad move better.
 */
export function rankGain(step: ScenarioStep, input: ScenarioInput, picksLeft: number): number {
  if (!input.gone || picksLeft <= 1 || step.gain <= 0 || input.gone.has(step.player.id)) return step.gain;
  return step.gain * SURVIVOR_DISCOUNT;
}

/** The place of the diagnosis a man would take, entering our best eleven; null when he would not fix one. */
function needTaken(roster: readonly PriorityMan[], man: PriorityMan | null, diagnosis: Diagnosis | null,
  input: ScenarioInput): { place: Place | null; need: PlaceNeed | null } {
  let place: Place | null = null;
  if (man && input.pitch) place = input.pitch.placeOf(roster, man);
  else if (man) {
    const withHim = bestEleven([...roster, man], input.rules, expected);
    const at = withHim ? withHim.holders.findIndex((holder) => holder?.id === man.id) : -1;
    place = at >= 0 ? withHim!.places[at] : null;
  }
  const need = place && man
    ? (diagnosis?.needs.find((one) => one.place.slot === place.slot && fits(man.roles, one.place)) ?? null) : null;
  return { place, need };
}

/**
 * THE CHAIN FROM A GIVEN FIRST PICK: the rivals calling before us in this round call first (they would anyway),
 * then we take `first`, then the rivals until our next pick - the order after `first` is decided by the FVM he
 * adds, which is the whole point - and then the move left that gives the squad most (`movesFor`).
 */
export function chainFrom(input: ScenarioInput, first: PlanPlayer, need: PlaceNeed | null): Scenario | null {
  const teams = new Map(input.teams.map((team) => [team.id, team]));
  const firstMan = input.manOf(first.id);
  const firstPriority = firstMan ? manValue(firstMan, input.worth, input.matchdays) : null;
  if (!teams.has(input.mineId) || firstPriority == null || !firstMan) return null;
  const start = teams.get(input.mineId)!;
  const roster = rosterOf(start, input.manOf);
  const left = input.calls.rounds - start.picksCount;
  const door = doorPriceFor(start, input, left);
  const firstGain = squadWorth([...roster, firstMan], input, left - 1, door) - squadWorth(roster, input, left, door);
  // Every squad that calls during the wait, as it stands when it calls: asked afterwards whether it wants the
  // second man, so the walk is made once and not twice.
  const callers: PlanTeam[] = [];
  const { walk, before, mine, after, teams: board } = walkPast(input, first, (team) => callers.push(team));
  // Our place in the round of our next pick: one after every squad that makes THAT turn before us.
  const nextAt = 1 + after.filter((step) => step.picksBefore === mine.picksCount).length;
  const pool = input.pool.filter((p) => p.id !== first.id && !walk.gone.has(p.id));
  let second: ScenarioStep | null = null;
  if (mine.picksCount < input.calls.rounds) {
    const best = movesFor(mine, pool, input)[0];
    if (best) {
      const held = rosterOf(mine, input.manOf);
      const then = diagnosisOf(held, input);
      second = { ...best, need: needTaken(held, input.manOf(best.player.id), then, input).need };
    }
  }
  const wait = walk.gone.size - before;
  const interested = second && wait > 0 ? interestAmong(callers, second.player, input) : [];
  // The men gone before OUR NEXT pick are what the screen highlights: kept before the walk goes further.
  const gone = new Map(walk.gone);
  // THE LATER PICKS (`CHAIN_TURNS`): ours by the same moves, the rivals walked by the same order rule in between.
  const later: ScenarioStep[] = [];
  if (second) {
    let me = take(mine, second.player);
    board.set(input.mineId, me);
    walk.exclude(second.player.id);
    walk.hooks.onCall = null;
    const ours = new Set([first.id, second.player.id]);
    const walked = { ...input, rounds: input.calls.rounds };
    while (2 + later.length < CHAIN_TURNS && me.picksCount < input.calls.rounds) {
      const goneBefore = walk.gone.size;
      walkToOurTurn(walked, board, walk);
      const waited = walk.gone.size - goneBefore;
      me = board.get(input.mineId)!;
      if (me.picksCount >= input.calls.rounds) break;
      const best = movesFor(me, input.pool.filter((p) => !ours.has(p.id) && !walk.gone.has(p.id)), input)[0];
      if (!best) break;
      later.push({ ...best, need: null, wait: waited });
      ours.add(best.player.id);
      walk.exclude(best.player.id);
      me = take(me, best.player);
      board.set(input.mineId, me);
    }
  }
  const difficulty: Difficulty = !second || wait === 0 ? 'sicuro'
    : interested.length === 0 ? 'facile' : interested.length < HARD_FROM ? 'medio' : 'difficile';
  return {
    first: { player: first, priority: firstPriority, gain: firstGain, need },
    wait,
    nextAt,
    second,
    gone,
    total: firstGain + (second?.gain ?? 0),
    later,
    horizon: firstGain + (second?.gain ?? 0) + later.reduce((sum, step) => sum + step.gain, 0),
    interested,
    difficulty,
  };
}

/** The rivals call until our turn, we take `first`, the rivals call until our next turn. `onWait`, when given,
 * hears every squad that calls during that second walk: the wait of the plan. */
function walkPast(input: ScenarioInput, first: PlanPlayer, onWait: ((team: PlanTeam) => void) | null = null) {
  const teams = new Map(input.teams.map((team) => [team.id, team]));
  const walked = { ...input, rounds: input.calls.rounds };
  const walk = rivalWalker({ ...walked, pool: input.pool.filter((p) => p.id !== first.id) }, teams);
  walkToOurTurn(walked, teams, walk);
  const before = walk.gone.size;
  const mine = take(teams.get(input.mineId)!, first);
  teams.set(input.mineId, mine);
  walk.hooks.onCall = onWait;
  const after = walkToOurTurn(walked, teams, walk);
  return { walk, before, mine, after, teams };
}

/**
 * Does this squad want the second man (see `Difficulty`)? His base role is the Draft Priority's; a man of theirs
 * counts for it if he can play that role; «pochi» is fewer than the starting places the shapes give the role
 * (`places`, what the rival model already reads); «scarsi» is when none of them reaches an average starter
 * (Draft Priority below zero).
 */
export function interestIn(team: PlanTeam, second: PlanPlayer, input: ScenarioInput): Interest | null {
  const man = input.manOf(second.id);
  if (!man) return null;
  const role = baseRole(input.rules, man.roles, man.slot);
  const theirs = rosterOf(team, input.manOf).filter((one) => one.roles.includes(role));
  if (!theirs.length) return { teamId: team.id, why: 'nessuno', role };
  if (theirs.length < (input.places.get(role) ?? 1)) return { teamId: team.id, why: 'pochi', role };
  // Only the men the sheet can price: a man with no Draft Priority is unknown, not weak («vuoto = ignoto»).
  const known = theirs.map((one) => manValue(one, input.worth, input.matchdays)).filter((v): v is number => v != null);
  if (!known.length) return null;
  return Math.max(...known) < 0 ? { teamId: team.id, why: 'scarsi', role } : null;
}

/**
 * Every squad calling during the wait that wants the second man AND may call him (the cap of the first turns and
 * the exact doors, `legalFor`: a squad the rules keep off him cannot take him from us), once each.
 */
function interestAmong(callers: readonly PlanTeam[], second: PlanPlayer, input: ScenarioInput): Interest[] {
  const found = new Map<number, Interest>();
  for (const team of callers) {
    if (team.id === input.mineId || found.has(team.id)) continue;
    if (!legalFor(team, [second], input.calls).length) continue;
    const interest = interestIn(team, second, input);
    if (interest) found.set(team.id, interest);
  }
  return [...found.values()];
}

/** How many first moves become a chain: the rivals' walk is the costly part, so only the best by gain do. */
const CHAINED = 6;

/**
 * HOW MANY OF OUR PICKS A PLAN IS JUDGED OVER, the current one included (operator, 02/10/2026, for the Serie A
 * classic draft of 6 October whose order is the roster's FVM: «secondo te dovrebbe aver maggiore peso il fatto che
 * un calciatore con un FVM alto ti può far andare indietro nella prossima scelta?»). Measured on the draft bench
 * (`toolkit/bench/draft/chains.mjs --head=value`, ten Serie A seasons, quotas 8/8/6, ten seats, 8 seeds, the heads
 * rotated over three seats): chains of 2 · 3 · 4 read 72.20 · 72.93 · 73.43 points a matchday, 3 vs 2 +1.04% and
 * 4 vs 2 +1.76% (8 seasons of 10, robust), 4 vs 3 +0.71% (7/10, robust); 5 and 6 add +0.22% and +0.43% over 4,
 * under the 0.5% floor - so 4 is the knee. The longer chain spends MORE (258 -> 271 FVM) and stands LATER in the
 * order (2.2 -> 3.2 in round 6): it does not avoid falling back, it sees when falling back is worth it.
 * Stated: the bench's chain ranks on value x cover, the app's on the pitch's fertility; the LENGTH is what moves.
 */
export const CHAIN_TURNS = 4;

/**
 * THREE SCENARIOS, BY WHAT THEY GIVE THE WHOLE SQUAD (the operator, 29/09/2026, replacing «one per place to fix,
 * the most urgent first», which opened every draft on the empty door): the best first moves by squad gain become
 * chains, and the chains are ranked by what the squad gains over BOTH picks. That is where the price enters, with
 * no weight of ours: a cheap first pick keeps us early in the order, so the wait is shorter and the second pick
 * better - «un calciatore che porti tanti bonus a poco prezzo» wins when the second pick says so.
 */
export function scenarios(input: ScenarioInput, count = 3): { diagnosis: Diagnosis | null; list: Scenario[] } {
  const me = input.teams.find((team) => team.id === input.mineId);
  if (!me || me.picksCount >= input.calls.rounds) return { diagnosis: null, list: [] };
  const roster = rosterOf(me, input.manOf);
  const diagnosis = diagnosisOf(roster, input);
  const list: Scenario[] = [];
  for (const move of movesFor(me, input.pool, input).slice(0, CHAINED)) {
    const need = needTaken(roster, input.manOf(move.player.id), diagnosis, input).need;
    const chain = chainFrom(input, move.player, need);
    if (chain) list.push(chain);
  }
  // Ranked with the first move's gain discounted when he would survive (`rankGain`); the second pick is a hope at our
  // next turn already, so it is not discounted again.
  const left = input.calls.rounds - me.picksCount;
  const score = (chain: Scenario) => chain.horizon - chain.first.gain + rankGain(chain.first, input, left);
  list.sort((a, b) => score(b) - score(a) || b.first.gain - a.first.gain);
  return { diagnosis, list: list.slice(0, count) };
}

export type Verdict = 'coerente' | 'inopportuna';

/**
 * A SCENARIO FROM A MAN THE OPERATOR NAMES (his double click): the same chain, and whether the pick is COHERENT -
 * he enters our best eleven on a place that needed fixing - or INOPPORTUNE - he would sit on the bench, or stand
 * on a place that was fine. The comparison with the best scenario is the caller's to draw, in its own numbers.
 */
export function judge(input: ScenarioInput, first: PlanPlayer): { scenario: Scenario | null; verdict: Verdict;
  why: string } {
  const me = input.teams.find((team) => team.id === input.mineId);
  if (!me) return { scenario: null, verdict: 'inopportuna', why: 'nessuna squadra seguita' };
  const roster = rosterOf(me, input.manOf);
  const diagnosis = diagnosisOf(roster, input);
  const { place, need } = needTaken(roster, input.manOf(first.id), diagnosis, input);
  const scenario = chainFrom(input, first, need);
  if (!place) {
    return { scenario, verdict: 'inopportuna',
      why: input.pitch ? 'non aggiunge niente a nessun posto della tua rosa' : 'non entra nel tuo miglior undici' };
  }
  if (!need) return { scenario, verdict: 'inopportuna', why: `entra come ${place.slot}, un posto che era già coperto` };
  return { scenario, verdict: 'coerente', why: `sistema il posto ${place.slot} (${need.kind})` };
}
