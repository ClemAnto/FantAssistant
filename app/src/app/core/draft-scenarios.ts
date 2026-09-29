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

import { PlanPlayer, PlanTeam, RivalWalkInput, rivalWalker, take, walkToOurTurn } from './auction-plan';
import { MantraModules } from './auction-value';
import { CallRules, PriorityMan, WorthContext, legalFor, manValue } from './draft-priority';
import { Place, bestEleven, placesIn } from './mantra-legal';

export type NeedKind = 'vuoto' | 'debole' | 'senza riserva';

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
  /** The place he is taken for. */
  need: PlaceNeed | null;
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
  /** first + second, points per matchday. */
  total: number;
}

export interface ScenarioInput extends RivalWalkInput {
  rules: MantraModules;
  worth: WorthContext;
  matchdays: number;
  calls: CallRules;
  manOf: (id: number) => PriorityMan | null;
}

const URGENCY: Record<NeedKind, number> = { vuoto: 0, debole: 1, 'senza riserva': 2 };

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

/** The squad as the priority reads it. */
const rosterOf = (team: PlanTeam, manOf: ScenarioInput['manOf']) =>
  team.heldIds.map(manOf).filter((man): man is PriorityMan => !!man);

/** The best man for a place among the ones the rules let the squad call, by Draft Priority. */
function bestFor(place: Place | null, team: PlanTeam, pool: readonly PlanPlayer[], input: ScenarioInput,
  exclude: ReadonlySet<number> = new Set()): ScenarioStep | null {
  let best: ScenarioStep | null = null;
  for (const player of legalFor(team, pool, input.calls)) {
    if (exclude.has(player.id) || (place && !fits(player.roles, place))) continue;
    const man = input.manOf(player.id);
    const priority = man ? manValue(man, input.worth, input.matchdays) : null;
    if (priority == null) continue;
    if (!best || priority > best.priority) best = { player, priority, need: null };
  }
  return best;
}

/**
 * THE CHAIN FROM A GIVEN FIRST PICK: the rivals calling before us in this round call first (they would anyway),
 * then we take `first`, then the rivals until our next pick - the order after `first` is decided by the FVM he
 * adds, which is the whole point - and then the best man left for the place that is most urgent THEN.
 */
export function chainFrom(input: ScenarioInput, first: PlanPlayer, need: PlaceNeed | null): Scenario | null {
  const teams = new Map(input.teams.map((team) => [team.id, team]));
  const firstMan = input.manOf(first.id);
  const firstPriority = firstMan ? manValue(firstMan, input.worth, input.matchdays) : null;
  if (!teams.has(input.mineId) || firstPriority == null) return null;
  const walked = { ...input, rounds: input.calls.rounds };
  const walk = rivalWalker({ ...walked, pool: input.pool.filter((p) => p.id !== first.id) }, teams);
  walkToOurTurn(walked, teams, walk);
  const before = walk.gone.size;
  const mine = take(teams.get(input.mineId)!, first);
  teams.set(input.mineId, mine);
  const after = walkToOurTurn(walked, teams, walk);
  // Our place in the round of our next pick: one after every squad that makes THAT turn before us.
  const nextAt = 1 + after.filter((step) => step.picksBefore === mine.picksCount).length;
  const pool = input.pool.filter((p) => p.id !== first.id && !walk.gone.has(p.id));
  const then = diagnose(rosterOf(mine, input.manOf), input.rules, input.worth, input.matchdays);
  let second: ScenarioStep | null = null;
  if (mine.picksCount < input.calls.rounds) {
    for (const one of then?.needs ?? []) {
      const found = bestFor(one.place, mine, pool, input);
      if (found) {
        second = { ...found, need: one };
        break;
      }
    }
    second ??= bestFor(null, mine, pool, input);
  }
  return {
    first: { player: first, priority: firstPriority, need },
    wait: walk.gone.size - before,
    nextAt,
    second,
    gone: walk.gone,
    total: firstPriority + (second?.priority ?? 0),
  };
}

/**
 * THREE SCENARIOS, one per place to fix (the most urgent first, on three different places): A is the best man by
 * Draft Priority who can stand on that place.
 */
export function scenarios(input: ScenarioInput, count = 3): { diagnosis: Diagnosis | null; list: Scenario[] } {
  const me = input.teams.find((team) => team.id === input.mineId);
  if (!me || me.picksCount >= input.calls.rounds) return { diagnosis: null, list: [] };
  const diagnosis = diagnose(rosterOf(me, input.manOf), input.rules, input.worth, input.matchdays);
  const list: Scenario[] = [];
  const firsts = new Set<number>();
  for (const need of diagnosis?.needs ?? []) {
    if (list.length >= count) break;
    const first = bestFor(need.place, me, input.pool, input, firsts);
    if (!first) continue;
    const chain = chainFrom(input, first.player, need);
    if (!chain) continue;
    firsts.add(first.player.id);
    list.push(chain);
  }
  return { diagnosis, list };
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
  const diagnosis = diagnose(roster, input.rules, input.worth, input.matchdays);
  const man = input.manOf(first.id);
  const withHim = man ? bestEleven([...roster, man], input.rules, expected) : null;
  const at = withHim ? withHim.holders.findIndex((holder) => holder?.id === first.id) : -1;
  const place = at >= 0 ? withHim!.places[at] : null;
  const need = place ? (diagnosis?.needs.find((one) => one.place.slot === place.slot && fits(first.roles, one.place)) ?? null)
    : null;
  const scenario = chainFrom(input, first, need);
  if (!place) return { scenario, verdict: 'inopportuna', why: 'non entra nel tuo miglior undici' };
  if (!need) return { scenario, verdict: 'inopportuna', why: `entra come ${place.slot}, un posto che era già coperto` };
  return { scenario, verdict: 'coerente', why: `sistema il posto ${place.slot} (${need.kind})` };
}
