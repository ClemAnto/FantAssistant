/**
 * SCOUT: the trades that make BOTH squads better (operator, 22/10/2026: «in base alla rosa selezionata vengono
 * suggeriti una serie di calciatori di altre squadre da andare a prendere tramite scambio. Lo scambio deve
 * necessariamente andare a migliorare la rosa di entrambe le squadre. Bisogna partire da calciatori forti nella
 * propria rosa che non vengono utilizzati spesso» - and, the same minute, «anche 2x2 o 3x3 ... anche di ruoli
 * diversi»).
 *
 * NOTHING HERE PREDICTS A FOOTBALLER. Each man arrives priced by the page (the sheet's fantamedia, the app's
 * expected appearances with the insurance inside - `ExpectedPlay`, one formula for the whole app); this file asks a
 * question about ROSTERS: how many points a matchday a squad makes with these men, on the rulebook's modules.
 *
 * THE STRENGTH OF A SQUAD has two terms that are ADDED, the bench being the second one (the lesson of the auction
 * bench: «a metric that assumes the thing happens cannot price the risk that it does not»):
 *   * the best legal eleven on the VALUE (fantamedia x appearances, `mantra-legal.bestEleven`, the draft's own
 *     currency) - what the starters score when they play;
 *   * the COVER: every place gets at most one reserve of the bench who can stand there (best first, each reserve
 *     used once, the places that miss most served first), and he scores his fantamedia on the rounds the holder
 *     misses, times his own chance of being available. That is what a strong man who «does not play often» is
 *     worth to his squad - not zero, and not his full value.
 * In points A MATCHDAY (the operator's unit), over the rounds that remain.
 *
 * Limits stated rather than hidden: absences are independent (two keepers of one club are not exclusive here), a
 * reserve covers one place, and the modifiers (R-Factor, defence) are not in the sum.
 *
 * WHAT A TRADE MAY DO TO A ROSTER is the regulation's: a classic squad keeps its quotas (3 / 8 / 8 / 6), a Mantra one
 * its three keepers. A squad already outside a quota may stay where it is, never move further away - so «roles
 * different» passes exactly where the squads have room, and a full classic squad can only trade a role for the same
 * role in total (D + A for A + D is fine, D for A is not).
 */

import { MantraModules } from './auction-value';
import { ModuleLine, Placeable, bestEleven } from './mantra-legal';

export type ScoutRole = 'P' | 'D' | 'C' | 'A';

/** One man as the page priced him. `roles` lowercase, in the league's game. */
export interface ScoutMan extends Placeable {
  id: number;
  name: string;
  club: string;
  role: ScoutRole;
  /** The role codes as the listone spells them, for the badge. */
  shown: string[];
  /** Points a match he plays (the sheet's fantamedia). Null = unpriced. */
  fm: number | null;
  /** Expected appearances over the rounds that remain. Null = unpriced. */
  pv: number | null;
  /** The market value the rival judges a trade by (FVM): reporting only. */
  fvm: number | null;
  /** The sheet's category within the role (`desc_category`: super, top, ...); absent = unknown. */
  category?: string | null;
  /**
   * His FORM as the other manager sees it: the mean base vote of his last five matches, a missing vote counted 5
   * (`player-trend.trendVoteMean`, the reading the trend bars draw). Absent = unknown.
   */
  form?: number | null;
  /**
   * Matchdays of his club he is out for, counted from today (`ExpectedPlay`'s open window: injured or suspended with a
   * known return; the rest of the season when the source says it is over). Absent or null = available, or out with no
   * date we can count.
   */
  outFor?: number | null;
  /** His last club matches (up to five) and how many of them gave him no vote. Absent = unknown. */
  recent?: { matches: number; noVote: number } | null;
}

/**
 * HOW THE OTHER MANAGER READS AN OFFER (operator, 22/10/2026: «questo scambio è IMPOSSIBILE, il trend del calciatore
 * richiesto è troppo elevato per convincere l'altro fanta-allenatore a cederlo! Al contrario uno scambio è fattibile
 * quando un calciatore richiesto ha un trend basso ed un calciatore proposto invece ha un trend alto»): the form of
 * what we give minus the form of what we take, mean base vote of the last five. Positive = we offer men in better
 * form than the ones we ask - the easy sell. Null when either side has no form at all.
 *
 * A CONSTRAINT and a sort key, never a term of the gains: the gains are what the season will give, this is what the
 * other side will believe on the day. Below `FORM_TOLERANCE` (a quarter of a vote) an offer is dropped as impossible.
 */
export const FORM_TOLERANCE = -0.25;

export function appealOf(give: readonly ScoutMan[], take: readonly ScoutMan[]): number | null {
  const mean = (men: readonly ScoutMan[]) => {
    const known = men.map((m) => m.form).filter((v): v is number => v != null);
    return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  };
  const a = mean(give);
  const b = mean(take);
  return a == null || b == null ? null : a - b;
}

const tooHot = (give: readonly ScoutMan[], take: readonly ScoutMan[]) => {
  const appeal = appealOf(give, take);
  return appeal != null && appeal < FORM_TOLERANCE;
};

export interface ScoutSquad {
  name: string;
  men: ScoutMan[];
}

/** The standard roster quotas of a classic league; Mantra binds the keepers only. */
export const CLASSIC_QUOTAS: Record<ScoutRole, number> = { P: 3, D: 8, C: 8, A: 6 };
export const MANTRA_KEEPERS = 3;

/** A trade is shown when BOTH squads gain at least this much, in points a matchday. */
export const MIN_GAIN = 0.1;

export interface Strength {
  /** Points a matchday: starters + cover. */
  perRound: number;
  starters: number;
  cover: number;
  module: string;
  /** Who is in the best eleven. */
  eleven: Set<number>;
  /** Every place of that eleven, with its holder and the reserve the cover gave it. */
  places: ScoutPlace[];
}

export interface ScoutPlace {
  line: ModuleLine;
  slot: string;
  roles: string[];
  holder: ScoutMan | null;
  reserve: ScoutMan | null;
  /** Points a matchday the place makes: the holder, plus the reserve on the rounds he misses. */
  perRound: number;
}

const valueOf = (man: ScoutMan): number | null =>
  man.fm == null || man.pv == null ? null : man.fm * man.pv;

/** The squad's points a matchday over `rounds` remaining rounds (see the header). */
export function strengthOf(men: readonly ScoutMan[], rules: MantraModules | null, rounds: number): Strength {
  const none: Strength = { perRound: 0, starters: 0, cover: 0, module: '', eleven: new Set(), places: [] };
  if (!rules?.modules || rounds <= 0) return none;
  const best = bestEleven(men, rules, valueOf);
  if (!best) return none;
  const eleven = new Set(best.men.map((man) => man.id));
  const starters = best.total;
  const bench = men
    .filter((man) => !eleven.has(man.id) && (valueOf(man) ?? 0) > 0)
    .sort((a, b) => (valueOf(b) ?? 0) - (valueOf(a) ?? 0));
  // The places that miss most choose their reserve first: an empty place misses every round.
  const places: ScoutPlace[] = best.places.map((place, at) => {
    const holder = best.holders[at];
    return {
      line: place.line,
      slot: place.slot,
      roles: place.roles,
      holder,
      reserve: null,
      perRound: holder ? (valueOf(holder) ?? 0) / rounds : 0,
    };
  });
  const miss = (place: ScoutPlace) => (place.holder ? Math.max(0, rounds - (place.holder.pv ?? 0)) : rounds);
  const used = new Set<number>();
  let cover = 0;
  for (const place of [...places].sort((a, b) => miss(b) - miss(a))) {
    if (miss(place) <= 0) continue;
    const reserve = bench.find((man) => !used.has(man.id) && man.roles.some((r) => place.roles.includes(r)));
    if (!reserve) continue;
    used.add(reserve.id);
    const points = miss(place) * Math.min(1, (reserve.pv ?? 0) / rounds) * (reserve.fm ?? 0);
    place.reserve = reserve;
    place.perRound += points / rounds;
    cover += points;
  }
  return {
    perRound: (starters + cover) / rounds,
    starters: starters / rounds,
    cover: cover / rounds,
    module: best.module,
    eleven,
    places,
  };
}

/** Whether a squad's roster after a trade respects the quotas, measured against where it was before. */
export function quotasHold(before: readonly ScoutMan[], after: readonly ScoutMan[], mantra: boolean): boolean {
  const count = (men: readonly ScoutMan[]) => {
    const out: Record<ScoutRole, number> = { P: 0, D: 0, C: 0, A: 0 };
    for (const man of men) out[man.role] += 1;
    return out;
  };
  const was = count(before);
  const now = count(after);
  const roles: ScoutRole[] = mantra ? ['P'] : ['P', 'D', 'C', 'A'];
  return roles.every((role) => {
    const quota = mantra ? MANTRA_KEEPERS : CLASSIC_QUOTAS[role];
    return now[role] >= Math.min(was[role], quota) && now[role] <= Math.max(was[role], quota);
  });
}

/**
 * HOW A SQUAD'S BEST ELEVEN MOVES WITH A TRADE (operator, 22/10/2026, on Barnes for Valverde: «ha senso solo se lui non
 * ha una W o A più forte di Barnes ... è così?»): the reason a trade helps a squad, said instead of left to guess.
 *
 * The first version paired every newcomer with «whose place he takes», and read «Barnes titolare al posto di Fernandez
 * E. e Leweling e Cucurella» (operator: «che significa?»): the rebuilt eleven had CHANGED SHAPE, so two men left it and
 * two others of the bench came in, and pinning all of it on Barnes was false. One place does not map to one man when
 * the module moves: the honest statement is the eleven's own difference, both ways, and the module.
 */
export interface ElevenChange {
  moduleBefore: string;
  moduleAfter: string;
  /** Into the eleven: newcomers and men of the bench alike. */
  enter: ScoutMan[];
  /** Out of the eleven: men traded away and men pushed to the bench. */
  leave: ScoutMan[];
  /** Newcomers who do NOT make the eleven: they arrive as reserves. */
  reserves: ScoutMan[];
}

function changeOf(
  before: readonly ScoutMan[],
  after: readonly ScoutMan[],
  arriving: readonly ScoutMan[],
  rules: MantraModules | null,
  rounds: number,
): ElevenChange {
  const was = strengthOf(before, rules, rounds);
  const now = strengthOf(after, rules, rounds);
  return {
    moduleBefore: was.module,
    moduleAfter: now.module,
    enter: after.filter((m) => now.eleven.has(m.id) && !was.eleven.has(m.id)),
    leave: before.filter((m) => was.eleven.has(m.id) && !now.eleven.has(m.id)),
    reserves: arriving.filter((m) => !now.eleven.has(m.id)),
  };
}

export interface ScoutInput {
  mine: ScoutSquad;
  rivals: readonly ScoutSquad[];
  rules: MantraModules | null;
  rounds: number;
  mantra: boolean;
}

export interface ScoutProgress {
  done: number;
  total: number;
}

const priced = (man: ScoutMan) => (valueOf(man) ?? 0) > 0;
const fvmSum = (men: readonly ScoutMan[]) =>
  men.every((man) => man.fvm == null) ? null : men.reduce((sum, man) => sum + (man.fvm ?? 0), 0);

/**
 * STARTERS WITH A RESERVE AT THEIR LEVEL (operator, 22/10/2026: «titolari con riserva all'altezza, ovvero giocatori
 * che schieriamo titolari di cui possiamo fare a meno perché abbiamo una riserva dello stesso valore»).
 *
 * A reserve «all'altezza» has HIS BASE ROLE (operator, same day: «le alternative valide devono avere lo stesso ruolo
 * base, Chabot non è alternativa a Grimaldo!»): the first role code the listone writes (`Ds` for Grimaldo, `Dc` for
 * Chabot; on classic the macro-role). The first version NAMED as his reserve whoever the rebuilt eleven took in, and the
 * rebuild reshuffles whole lines - a centre back «replaced» a wing back, a forward «replaced» a trequartista.
 *
 * WHAT HE IS WORTH is not fantamedia x appearances (operator, same day: «non basta FMxPa, dobbiamo considerare che
 * quando non gioca subentra il panchinaro»). It is what the SQUAD loses without him: `strengthOf` rebuilt without him,
 * so his reserve takes the place, the reserve's own absences are covered by whoever is next, and the rounds he would
 * have missed anyway were already the bench's. That loss is `contribution`, the same arithmetic every trade is judged on.
 *
 * So a starter is listed when a man of his base role sits outside the eleven AND the squad loses at most
 * `REPLACEABLE_SHARE` of what he makes a matchday without him. Each reserve backs ONE starter (the most valuable
 * first): two starters who lean on the same reserve cannot both be sold.
 */
export const REPLACEABLE_SHARE = 0.25;

export interface Expendable {
  man: ScoutMan;
  /** What he makes a matchday when he plays every round he is expected to (fm x pv / rounds). */
  perRound: number;
  /** What the squad loses a matchday without him, the bench coming in: his real worth to it. */
  loss: number;
  /** The reserve of his base role. */
  replacement: ScoutMan;
}

/**
 * What a man is worth TO THIS SQUAD a matchday: its strength with him minus without him. For a starter it is what is
 * left once his reserve has come in; for a man on the bench it is the cover he gives.
 */
export function contribution(men: readonly ScoutMan[], man: ScoutMan, rules: MantraModules | null, rounds: number): number {
  return strengthOf(men, rules, rounds).perRound - strengthOf(men.filter((m) => m.id !== man.id), rules, rounds).perRound;
}

/** The base role: the first code the listone writes for him. */
export const baseRole = (man: Pick<ScoutMan, 'roles'>): string | null => man.roles[0] ?? null;

export function expendableStarters(men: readonly ScoutMan[], rules: MantraModules | null, rounds: number): Expendable[] {
  if (rounds <= 0) return [];
  const base = strengthOf(men, rules, rounds);
  const per = (m: ScoutMan) => (valueOf(m) ?? 0) / rounds;
  const bench = men.filter((m) => !base.eleven.has(m.id) && per(m) > 0).sort((a, b) => per(b) - per(a));
  const used = new Set<number>();
  const out: Expendable[] = [];
  for (const man of men.filter((m) => base.eleven.has(m.id) && per(m) > 0).sort((a, b) => per(b) - per(a))) {
    const role = baseRole(man);
    const reserve = bench.find((r) => !used.has(r.id) && baseRole(r) === role);
    // ...AND WORTH THREE QUARTERS OF HIM (22/10/2026): on the loss alone Kane read «expendable» behind Romulo, because
    // a quarter of 9.16 a matchday is 2.29 and that was exactly what the squad lost - a quarter of a great man is a
    // great loss. «All'altezza» is said of the reserve, so it is measured on him as well.
    if (!reserve || per(reserve) < (1 - REPLACEABLE_SHARE) * per(man)) continue;
    // Never below zero: the best eleven cannot gain from losing a man, and a hair under zero is the cover's
    // greedy reserve assignment, not a fact.
    const loss = Math.max(0, contribution(men, man, rules, rounds));
    if (loss > REPLACEABLE_SHARE * per(man)) continue;
    used.add(reserve.id);
    out.push({ man, perRound: per(man), loss, replacement: reserve });
  }
  return out;
}

/**
 * THE LIST AS IT IS READ (operator, 22/10/2026: «evita di ripetere lo stesso scambio in mille varianti»).
 *
 * An offer is ONE TARGET (operator, same day: «raggruppiamo questi scambi, hanno tutti lo stesso obiettivo»): the most
 * valuable man we take (fantamedia x appearances). Every trade with that rival for that target is one offer, and its
 * lines are the ways of paying for him - each a whole trade with its own two gains, because which man goes with which
 * is what keeps the quotas and the gains true. Offers are grouped by rival, the rival heading once; every order is by
 * the key the page sorts on, best first.
 *
 * (A version that wrote the men common to every line once, on a head line, was dropped with the multi-trade search
 * it served: the page draws every line whole.)
 */
export interface Tradeable {
  rival: string;
  give: ScoutMan[];
  take: ScoutMan[];
}

export interface TradeOffer<T extends Tradeable> {
  /** The target: the most valuable man we take. */
  take: ScoutMan;
  /** Best line first. */
  lines: T[];
  /** Lines left out by `maxLines`. */
  hidden: number;
}

export interface RivalOffers<T extends Tradeable> {
  rival: string;
  offers: TradeOffer<T>[];
}

const mainOf = (men: readonly ScoutMan[]): ScoutMan =>
  [...men].sort((a, b) => (valueOf(b) ?? 0) - (valueOf(a) ?? 0) || a.id - b.id)[0];

export function groupTrades<T extends Tradeable>(
  trades: readonly T[],
  key: (trade: T) => number,
  /** Lines kept per offer, best first; the rest are counted in `hidden`. */
  maxLines = Infinity,
): RivalOffers<T>[] {
  const rivals = new Map<string, Map<number, TradeOffer<T>>>();
  for (const trade of [...trades].sort((a, b) => key(b) - key(a))) {
    const take = mainOf(trade.take);
    const offers = rivals.get(trade.rival) ?? new Map<number, TradeOffer<T>>();
    rivals.set(trade.rival, offers);
    const offer = offers.get(take.id) ?? { take, lines: [], hidden: 0 };
    offers.set(take.id, offer);
    offer.lines.push(trade);
  }
  for (const offers of rivals.values()) {
    for (const offer of offers.values()) {
      // NO MAN TWICE in one offer (operator, 22/10/2026: «evita doppioni nelle offerte (chabot x2)»): best line first,
      // a line is kept only if none of its men besides the target - and those EVERY line moves - is already on a kept
      // line. The same man for a different return is the same offer worse paid, so it goes.
      const all = offer.lines;
      const moves = (t: T, m: ScoutMan) => t.give.some((o) => o.id === m.id) || t.take.some((o) => o.id === m.id);
      const core = (m: ScoutMan) => m.id === offer.take.id || all.every((t) => moves(t, m));
      const seen = new Set<number>();
      const kept = all.filter((t) => {
        const extra = [...t.give, ...t.take].filter((m) => !core(m)).map((m) => m.id);
        if (extra.some((id) => seen.has(id))) return false;
        extra.forEach((id) => seen.add(id));
        return true;
      });
      offer.hidden = Math.max(0, kept.length - maxLines);
      offer.lines = kept.slice(0, maxLines);
    }
  }
  // Insertion follows the sort, so the first rival and the first offer of each are the best ones.
  return [...rivals].map(([rival, offers]) => ({ rival, offers: [...offers.values()] }));
}

/**
 * THE ONE-FOR-ONE SWAP AS IT IS PROPOSED (operator, 22/10/2026: «quando vai a proporre uno scambio l'altro è sempre un
 * po' scettico e pensa che lo vuoi fregare, l'offerta deve essere puntuale e facilmente intellegibile ... negli scambi
 * 1x1 mostrami quali producono un miglioramento immediato ad entrambi: il mio del ruolo X deve essere migliore di uno
 * suo titolare di quel ruolo ed il suo del ruolo Y deve essere migliore del mio in quel ruolo/posizione»).
 *
 * Two comparisons a man can check at a glance, and nothing else:
 *   * the man WE TAKE is better than one of OUR starters whose place he can stand in;
 *   * the man WE GIVE is better than one of THEIR starters whose place he can stand in.
 * «A place he can stand in» is a place of that best eleven whose roles include one of his (the rulebook's own test,
 * so a wing back is not compared with a centre back). Against the WEAKEST such starter, because that is the one the
 * offer replaces. «Better» is points a matchday when he plays every round he is expected to (fantamedia x
 * appearances), by `MIN_GAIN` at least - the number the two cards show side by side.
 *
 * The man we give is one we can spare: a strong man outside our eleven, or a starter with a reserve of his base role at
 * his level (`expendableStarters`) - otherwise the swap would open a hole on our side. The quotas hold as for every
 * trade. The man we take who sits OUTSIDE their eleven is marked: they lose nothing they field.
 */
export interface SimpleSwap {
  rival: string;
  give: ScoutMan;
  take: ScoutMan;
  /** Our starter the man we take is better than (null = an empty place of ours). */
  ourOut: ScoutMan | null;
  /** Their starter the man we give is better than (null = an empty place of theirs). */
  theirOut: ScoutMan | null;
  /**
   * The two gains, points a matchday: what each side's BEST ELEVEN gains with the man who arrives and without the man
   * who leaves. Net by construction - giving one of our starters (Rice for Stiller) or taking one of theirs (Cunha for
   * Marmoush) costs what it costs, which the bare comparisons above cannot see.
   */
  ours: number;
  theirs: number;
  /** He is not in their eleven. */
  spare: boolean;
  /** The form we offer minus the form we ask (`appealOf`): how easily they will believe it. */
  appeal: number | null;
  fvmGive: number | null;
  fvmTake: number | null;
}

/** The weakest starter of an eleven whose place `man` can stand in, excluding `skip`; null holder = an empty place. */
function weakestFor(
  places: readonly ScoutPlace[],
  man: ScoutMan,
  skip: number | null,
): { holder: ScoutMan | null; value: number } | null {
  let best: { holder: ScoutMan | null; value: number } | null = null;
  for (const place of places) {
    if (!place.roles.some((r) => man.roles.includes(r))) continue;
    if (place.holder && place.holder.id === skip) continue;
    const value = place.holder ? (valueOf(place.holder) ?? 0) : 0;
    if (!best || value < best.value) best = { holder: place.holder, value };
  }
  return best;
}

/**
 * TWO RULES OF A PROPOSAL THAT IS ACCEPTED, both the operator's (22/10/2026), both constraints and never weights:
 *   * «il guadagno di entrambi deve essere paragonabile, nessuno dei due deve avere un guadagno troppo superiore
 *     all'altro»: the smaller gain is at least `BALANCE_RATIO` of the larger - neither side gains more than double;
 *   * «nessuno si toglie un supertop se non per un altro supertop»: a `super` of the sheet's category (within his
 *     role) is swapped only for another `super`, on both sides;
 *   * and the two men are worth about the same (`VALUE_RATIO`, below).
 */
export const BALANCE_RATIO = 0.5;
export const SUPER = 'super';
/**
 * ...and THE TWO MEN are worth about the same (operator, 22/10/2026: «Olise è un supertop (7.82), perché mai dovrebbe
 * scambiarlo per Baku (5.13)?»). The category is decided WITHIN the role, so a top wing back and a top forward are
 * both `super` and the rule above let them through; nobody gives a man for one worth two thirds of him, whatever
 * hole it fills. The cheaper of the two is worth at least `VALUE_RATIO` of the dearer, points a matchday.
 */
export const VALUE_RATIO = 0.8;

/*
 * A CATEGORY GUARD WAS TRIED AND TAKEN OUT the same evening (22/10/2026). «Nobody is replaced by a man of a lower
 * category» was written for Gvardiol (`top`) against Veiga (`scarto`), when the two read 4.41 and 4.71 a matchday -
 * and the cause turned out to be the sheets predicting presences on TWO rounds (`features.target_matchdays`). Fixed
 * that, Veiga reads 4.44 against 4.76 and the value says what the operator said. The guard, meanwhile, hid the trades
 * he asked for: the category is measured against the bars of a man's BASE role, so Pedro Neto (W/A, 7.08 of
 * fantamedia) is a `scarto` among forwards and could never replace Moreira (`scommessa`, 5.17 a matchday) on a wing.
 * A word built for another question is not a guard on this one.
 */

/** What we can offer: priced men outside our eleven, and starters with a reserve of their base role at their level. */
function spareOf(men: readonly ScoutMan[], strength: Strength, rules: MantraModules | null, rounds: number): ScoutMan[] {
  return [
    ...men.filter((m) => !strength.eleven.has(m.id) && priced(m)),
    ...expendableStarters(men, rules, rounds).map((one) => one.man),
  ];
}

/** The two sides are worth about the same (`VALUE_RATIO`) and carry as many supertops each. */
function worthAlike(give: readonly ScoutMan[], take: readonly ScoutMan[], per: (m: ScoutMan) => number): boolean {
  const sum = (men: readonly ScoutMan[]) => men.reduce((acc, m) => acc + per(m), 0);
  const supers = (men: readonly ScoutMan[]) => men.filter((m) => m.category === SUPER).length;
  return (
    supers(give) === supers(take) &&
    Math.min(sum(give), sum(take)) >= VALUE_RATIO * Math.max(sum(give), sum(take))
  );
}

/** Neither gain more than double the other (`BALANCE_RATIO`). */
const balanced = (a: number, b: number) => Math.min(a, b) >= BALANCE_RATIO * Math.max(a, b);

export function simpleSwaps(input: ScoutInput): SimpleSwap[] {
  const { rules, rounds, mantra } = input;
  if (rounds <= 0) return [];
  const per = (m: ScoutMan) => (valueOf(m) ?? 0) / rounds;
  const mine = strengthOf(input.mine.men, rules, rounds);
  const spareOurs = spareOf(input.mine.men, mine, rules, rounds);
  const out: SimpleSwap[] = [];
  for (const rival of input.rivals) {
    const theirs = strengthOf(rival.men, rules, rounds);
    for (const take of rival.men.filter((m) => per(m) > 0)) {
      for (const give of spareOurs) {
        // THE STARTER HE BEATS IS ONE WHO STAYS (operator, 22/10/2026, Barnes for Semenyo: «ho Douè e Marmoush come
        // A ... non me ne servono altre»): compared with the man we are giving away, the target only took his own
        // place back - a like-for-like swap of a starter, not a need of ours filled. Same rule as their side, which
        // skips the man we take.
        const ourSlot = weakestFor(mine.places, take, give.id);
        if (!ourSlot || per(take) - ourSlot.value / rounds < MIN_GAIN) continue;
        if (!worthAlike([give], [take], per) || tooHot([give], [take])) continue;
        const theirSlot = weakestFor(theirs.places, give, take.id);
        if (!theirSlot || per(give) - theirSlot.value / rounds < MIN_GAIN) continue;
        const ourMen = [...input.mine.men.filter((m) => m.id !== give.id), take];
        const theirMen = [...rival.men.filter((m) => m.id !== take.id), give];
        if (!quotasHold(input.mine.men, ourMen, mantra) || !quotasHold(rival.men, theirMen, mantra)) continue;
        // THE TWO GAINS ARE WHAT EACH BEST ELEVEN GAINS, a matchday (operator, 22/10/2026, Cunha for Marmoush:
        // «perché mai dovrebbe scambiare A x A dove il suo è meglio del mio? Ci andrebbe solo a perdere»). The two
        // comparisons above say WHERE each man fits; whether a squad is better off is the eleven rebuilt with the man
        // who arrives and WITHOUT the man who leaves - Marmoush beats Isak, and losing Cunha costs them more.
        const ours = strengthOf(ourMen, rules, rounds).starters - mine.starters;
        const theirGain = strengthOf(theirMen, rules, rounds).starters - theirs.starters;
        if (ours < MIN_GAIN || theirGain < MIN_GAIN) continue;
        if (!balanced(ours, theirGain)) continue;
        out.push({
          rival: rival.name,
          give,
          take,
          ourOut: ourSlot.holder,
          theirOut: theirSlot.holder,
          ours,
          theirs: theirGain,
          spare: !theirs.eleven.has(take.id),
          appeal: appealOf([give], [take]),
          fvmGive: give.fvm,
          fvmTake: take.fvm,
        });
      }
    }
  }
  return out;
}

/**
 * THE 2x2 (operator, 22/10/2026: «proviamo a passare agli scambi 2x2»), with the 1x1's rules and nothing more:
 *   * we give two men we can spare (outside our eleven, or starters with a reserve of their role at their level);
 *   * BOTH best elevens gain at least `MIN_GAIN` a matchday, counted with who arrives AND without who leaves, and the
 *     two gains are comparable (`BALANCE_RATIO`);
 *   * the two PAIRS are worth about the same (`VALUE_RATIO`, on the sums) and carry as many supertops each;
 *   * the quotas hold;
 *   * and it is not a 1x1 with a passenger: if one of the four 1x1 inside it already gives both sides as much, the 1x1
 *     is the offer - a second pair has to EARN its place (`PAIR_EXTRA`, on the smaller of the two gains).
 *
 * The search is a beam (the space is ~13,000 pairs of pairs per rival): every 1x1 that improves OUR eleven - their side
 * still free, since a second pair is what can fix it - kept by the total it creates, then extended with one more man
 * each way. Yields its progress so the page draws a bar.
 */
export const PAIR_BEAM = 12;
export const PAIR_EXTRA = 0.05;

export interface PairSwap {
  rival: string;
  give: ScoutMan[];
  take: ScoutMan[];
  ours: number;
  theirs: number;
  /** How each eleven moves: who enters, who leaves (the men traded and the men pushed to the bench). */
  ourChange: ElevenChange;
  theirChange: ElevenChange;
  /** The men we take who are NOT in their eleven. */
  spare: number[];
  /** The form we offer minus the form we ask (`appealOf`). */
  appeal: number | null;
  fvmGive: number | null;
  fvmTake: number | null;
}

export function* pairSwaps(input: ScoutInput): Generator<ScoutProgress, PairSwap[], void> {
  const { rules, rounds, mantra } = input;
  if (rounds <= 0) return [];
  const per = (m: ScoutMan) => (valueOf(m) ?? 0) / rounds;
  const starters = (men: readonly ScoutMan[]) => strengthOf(men, rules, rounds).starters;
  const mineMen = input.mine.men;
  const mine = strengthOf(mineMen, rules, rounds);
  const spareOurs = spareOf(mineMen, mine, rules, rounds);
  const total = input.rivals.length * (1 + PAIR_BEAM);
  let done = 0;
  const out: PairSwap[] = [];
  for (const [r, rival] of input.rivals.entries()) {
    const theirs = strengthOf(rival.men, rules, rounds);
    const pool = rival.men.filter((m) => per(m) > 0);
    const gains = new Map<string, [number, number]>();
    const gainOf = (give: ScoutMan[], take: ScoutMan[]): [number, number] => {
      const key = `${give.map((m) => m.id).sort().join(',')}|${take.map((m) => m.id).sort().join(',')}`;
      let held = gains.get(key);
      if (!held) {
        const gone = new Set(give.map((m) => m.id));
        const come = new Set(take.map((m) => m.id));
        held = [
          starters([...mineMen.filter((m) => !gone.has(m.id)), ...take]) - mine.starters,
          starters([...rival.men.filter((m) => !come.has(m.id)), ...give]) - theirs.starters,
        ];
        gains.set(key, held);
      }
      return held;
    };
    // 1. Every 1x1 that improves OUR eleven, whatever it does to theirs.
    const seeds: { give: ScoutMan; take: ScoutMan; total: number }[] = [];
    for (const take of pool) {
      for (const give of spareOurs) {
        const [a, b] = gainOf([give], [take]);
        if (a >= MIN_GAIN) seeds.push({ give, take, total: a + b });
      }
    }
    seeds.sort((x, y) => y.total - x.total);
    done += 1;
    yield { done, total };
    // NO PASSENGERS: the second man taken is one who MATTERS - a starter of theirs (his leaving is part of the deal)
    // or a man who improves OUR eleven. A reserve of theirs who would be a reserve of ours too moves nothing, and
    // twelve of them read as twelve «alternatives» of one offer (the first run: «Ezzalzouli + Sorloth, + Eze, ...»).
    const improvers = new Set(seeds.map((one) => one.take.id));
    const seconds = pool.filter((m) => theirs.eleven.has(m.id) || improvers.has(m.id));
    // 2. One more man each way.
    const seen = new Set<string>();
    for (const seed of seeds.slice(0, PAIR_BEAM)) {
      done += 1;
      yield { done, total };
      for (const give2 of spareOurs) {
        if (give2.id === seed.give.id) continue;
        for (const take2 of seconds) {
          if (take2.id === seed.take.id) continue;
          const give = [seed.give, give2];
          const take = [seed.take, take2];
          const key = `${give.map((m) => m.id).sort().join(',')}|${take.map((m) => m.id).sort().join(',')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // The cheap tests first: the eleven rebuilt twice is what costs.
          if (!worthAlike(give, take, per) || tooHot(give, take)) continue;
          const ourMen = [...mineMen.filter((m) => !give.includes(m)), ...take];
          const theirMen = [...rival.men.filter((m) => !take.includes(m)), ...give];
          if (!quotasHold(mineMen, ourMen, mantra) || !quotasHold(rival.men, theirMen, mantra)) continue;
          const [ours, theirsGain] = gainOf(give, take);
          if (ours < MIN_GAIN || theirsGain < MIN_GAIN || !balanced(ours, theirsGain)) continue;
          // Not a 1x1 with a passenger.
          const inner = give.flatMap((g) => take.map((t) => gainOf([g], [t])));
          if (inner.some(([a, b]) => Math.min(a, b) >= Math.min(ours, theirsGain) - PAIR_EXTRA && a >= MIN_GAIN && b >= MIN_GAIN)) continue;
          const ourChange = changeOf(mineMen, ourMen, take, rules, rounds);
          const theirChange = changeOf(rival.men, theirMen, give, rules, rounds);
          const moves = (m: ScoutMan) =>
            [ourChange.enter, ourChange.leave, theirChange.enter, theirChange.leave].some((side) => side.some((o) => o.id === m.id));
          if (![...give, ...take].every(moves)) continue;
          out.push({
            rival: rival.name,
            give,
            take,
            ours,
            theirs: theirsGain,
            ourChange,
            theirChange,
            appeal: appealOf(give, take),
            spare: take.filter((m) => !theirs.eleven.has(m.id)).map((m) => m.id),
            fvmGive: fvmSum(give),
            fvmTake: fvmSum(take),
          });
        }
      }
    }
    done = (r + 1) * (1 + PAIR_BEAM);
  }
  return out;
}

/**
 * ADDING A MAN TO AN OFFER (`roadmap-scambi-v1.md` step 3; operator, 22/10/2026: «lo scambio deve partire da 1x1 (o
 * 2x2) ma poi è possibile aggiungere altri attori in un secondo momento»). Not a search over every 3x3: from ONE offer
 * the operator chose, one man more - one of ours, one of theirs, or one each - to mend what would make the rival say no.
 *
 * What the rival sees is three things, and an extension must make at least one of them clearly better and none worse:
 *   * HIS GAIN, points a matchday (`EXTEND_STEP.theirs`);
 *   * the FVM BALANCE, what we give minus what we take, on his own price list (`EXTEND_STEP.fvm`);
 *   * the FORM we offer over the form we ask (`EXTEND_STEP.form`).
 * Every rule of a trade still holds: both gains at least `MIN_GAIN` and comparable, the quotas (so on a full classic
 * squad only one each way, of the same role in total), the form tolerance. The steps are declared, not measured: a
 * tenth of a point, five FVM, a tenth of a vote - the size of a difference a manager notices.
 *
 * The result has the shape of a 2x2 (`PairSwap`), so the page draws it with the same line, table and labels - and an
 * extension can be extended again.
 */
export const EXTEND_STEP = { theirs: 0.1, fvm: 5, form: 0.1 };
/** How much worse a side may get and still count as «not worse»: rounding, not a concession. */
const EXTEND_SLACK = { theirs: 0.05, fvm: 0, form: 0.05 };
export const EXTEND_RESULTS = 3;

export interface Extension extends PairSwap {
  /** The men added, each side. */
  added: { give: ScoutMan | null; take: ScoutMan | null };
  /** What got better for the rival against the offer it came from; null = not better (or unknown). */
  better: { theirs: number | null; fvm: number | null; form: number | null };
}

export function extendOffer(
  base: Tradeable,
  input: ScoutInput,
  maxResults = EXTEND_RESULTS,
): Extension[] {
  const { rules, rounds, mantra } = input;
  const rival = input.rivals.find((one) => one.name === base.rival);
  if (!rival || rounds <= 0) return [];
  const mineMen = input.mine.men;
  const mine = strengthOf(mineMen, rules, rounds);
  const theirs = strengthOf(rival.men, rules, rounds);
  const after = (give: readonly ScoutMan[], take: readonly ScoutMan[]) => {
    const gone = new Set(give.map((m) => m.id));
    const come = new Set(take.map((m) => m.id));
    return {
      ourMen: [...mineMen.filter((m) => !gone.has(m.id)), ...take],
      theirMen: [...rival.men.filter((m) => !come.has(m.id)), ...give],
    };
  };
  const gainsOf = (give: readonly ScoutMan[], take: readonly ScoutMan[]) => {
    const { ourMen, theirMen } = after(give, take);
    return {
      ours: strengthOf(ourMen, rules, rounds).starters - mine.starters,
      theirs: strengthOf(theirMen, rules, rounds).starters - theirs.starters,
    };
  };
  const balanceOf = (give: readonly ScoutMan[], take: readonly ScoutMan[]) => {
    const g = fvmSum(give);
    const t = fvmSum(take);
    return g == null || t == null ? null : g - t;
  };
  const was = gainsOf(base.give, base.take);
  // What a man given from OUR BENCH costs us is the cover he gave, which the gains (the elevens) do not see: ties on
  // our gain are broken by our whole squad's strength, so the sweetener we miss least comes first.
  const fullOurs = (give: readonly ScoutMan[], take: readonly ScoutMan[]) =>
    strengthOf(after(give, take).ourMen, rules, rounds).perRound - mine.perRound;
  const wasFvm = balanceOf(base.give, base.take);
  const wasForm = appealOf(base.give, base.take);

  const inBase = new Set([...base.give, ...base.take].map((m) => m.id));
  const ours: (ScoutMan | null)[] = [null, ...mineMen.filter((m) => !inBase.has(m.id))];
  const their: (ScoutMan | null)[] = [null, ...rival.men.filter((m) => !inBase.has(m.id))];
  const found: { ext: Omit<Extension, 'ourChange' | 'theirChange'>; fixes: number; full: number }[] = [];
  for (const g of ours) {
    for (const t of their) {
      if (!g && !t) continue;
      const give = g ? [...base.give, g] : [...base.give];
      const take = t ? [...base.take, t] : [...base.take];
      if (tooHot(give, take)) continue;
      const { ourMen, theirMen } = after(give, take);
      if (!quotasHold(mineMen, ourMen, mantra) || !quotasHold(rival.men, theirMen, mantra)) continue;
      const now = gainsOf(give, take);
      if (now.ours < MIN_GAIN || now.theirs < MIN_GAIN || !balanced(now.ours, now.theirs)) continue;
      const dTheirs = now.theirs - was.theirs;
      const fvm = balanceOf(give, take);
      const dFvm = fvm == null || wasFvm == null ? null : fvm - wasFvm;
      const form = appealOf(give, take);
      const dForm = form == null || wasForm == null ? null : form - wasForm;
      // None worse...
      if (dTheirs < -EXTEND_SLACK.theirs || (dFvm ?? 0) < -EXTEND_SLACK.fvm || (dForm ?? 0) < -EXTEND_SLACK.form) continue;
      // ...and at least one clearly better.
      const better = {
        theirs: dTheirs >= EXTEND_STEP.theirs ? dTheirs : null,
        fvm: dFvm != null && dFvm >= EXTEND_STEP.fvm ? dFvm : null,
        form: dForm != null && dForm >= EXTEND_STEP.form ? dForm : null,
      };
      const fixes = [better.theirs, better.fvm, better.form].filter((v) => v != null).length;
      if (!fixes) continue;
      found.push({
        fixes,
        full: fullOurs(give, take),
        ext: {
          rival: rival.name,
          give,
          take,
          ours: now.ours,
          theirs: now.theirs,
          spare: take.filter((m) => !theirs.eleven.has(m.id)).map((m) => m.id),
          appeal: form,
          fvmGive: fvmSum(give),
          fvmTake: fvmSum(take),
          added: { give: g, take: t },
          better,
        },
      });
    }
  }
  // Most fixes first; then what it leaves US, because each fix is paid for with our gain - our eleven, then the cover.
  return found
    .sort((a, b) => b.fixes - a.fixes || (Math.abs(b.ext.ours - a.ext.ours) > 0.005 ? b.ext.ours - a.ext.ours : b.full - a.full))
    .slice(0, maxResults)
    .map(({ ext }) => {
      const { ourMen, theirMen } = after(ext.give, ext.take);
      return {
        ...ext,
        ourChange: changeOf(mineMen, ourMen, ext.take, rules, rounds),
        theirChange: changeOf(rival.men, theirMen, ext.give, rules, rounds),
      };
    });
}

/**
 * WHAT EACH RIVAL CAN SPARE AND WHAT IT LACKS (operator, same day: «vedere i giocatori meno schierati dagli altri, che
 * sicuramente possono essere scambiati con più facilità ... oppure notare particolari "buchi" nelle formazioni
 * altrui per proporre scambi allettanti»).
 *
 *   * SPARE = his priced men OUTSIDE his best eleven, strongest first: what he can let go without touching his
 *     eleven - and, kept only where they would raise OURS, what is worth asking him for.
 *   * HOLES = the places of his eleven that make least against the league: a place's points a matchday (holder plus
 *     cover) below the MEDIAN of that line over every squad of the league, by `HOLE_GAP` at least - the median of
 *     the league and not of his own squad, because a hole is a statement about where he stands at this table.
 *     Beside each, the men of OUR bench who can stand there and make more than he does there now: the offer.
 */
export const HOLE_GAP = 0.5;

export interface RivalHole {
  slot: string;
  line: ModuleLine;
  /** What the place makes for him, and the league's median for that line. */
  now: number;
  median: number;
  holder: ScoutMan | null;
  /** Our men outside our eleven who fit the place and would make more there. */
  offers: ScoutMan[];
}

/**
 * WHAT A RIVAL FEELS IS WRONG (`roadmap-scambi-v1.md` step 4): an offer that solves a problem he already suffers is
 * one he reads; one that solves a problem only our numbers see is one he does not believe. One need per place of his
 * best eleven, the strongest kind first:
 *   * `out`    - the holder is out today (`ScoutMan.outFor`);
 *   * `novote` - the holder took no vote in at least `NO_VOTE_MIN` of his last club matches (declared: three of five,
 *                a majority, not measured);
 *   * `weak`   - the place makes less than the league's median for that line by `HOLE_GAP` (the holes, above).
 * Facts and not our valuation: each one is something he can see on his own team sheet.
 */
export type NeedKind = 'out' | 'novote' | 'weak';

/**
 * A SURPLUS (`roadmap-scambi-v1.md` step 6): more men of a role at a starter's level than his eleven has places for
 * that role - which he knows, so letting one go costs him little. The role is the listone's (P / D / C / A), the one
 * his quotas count. Said on the spare man as «4 A da titolare per 3 posti».
 *
 * «At a starter's level» is worth about as much as the weakest starter of that role - `VALUE_RATIO` of him, the same
 * «più o meno lo stesso» the trades use. The first version asked for AT LEAST as much, and a man outside the eleven
 * who makes at least as much as a starter of his own role would BE in the eleven: zero surpluses on every squad of a
 * real league, by construction.
 */
export interface RivalSurplus {
  role: ScoutRole;
  good: number;
  places: number;
}

/** The surplus `man` (outside the eleven) belongs to: null when he is not at a starter's level himself. */
export function surplusOf(men: readonly ScoutMan[], eleven: ReadonlySet<number>, man: ScoutMan): RivalSurplus | null {
  const role = man.role;
  const starters = men.filter((m) => eleven.has(m.id) && m.role === role);
  if (!starters.length) return null;
  const floor = VALUE_RATIO * Math.min(...starters.map((m) => valueOf(m) ?? 0));
  if ((valueOf(man) ?? 0) < floor) return null;
  const good = men.filter((m) => m.role === role && (valueOf(m) ?? 0) >= floor).length;
  return { role, good, places: starters.length };
}
export const NO_VOTE_MIN = 3;

export interface RivalNeed {
  kind: NeedKind;
  slot: string;
  line: ModuleLine;
  roles: string[];
  holder: ScoutMan | null;
}

/**
 * The need a trade MEETS: the first (strongest) the man we give really fills, which is what the rival can see.
 *   * `out` / `novote`: he plays in the eleven the rival fields WITHOUT the needy men (`withoutNeedy`), in a place of
 *     that line - «while X is out, your man plays». Their SEASON eleven cannot say it: a starter out for four
 *     matchdays still makes it on the rest of the season, so no trade ever «pushes him out» (measured on a real league:
 *     0 lines of 30 under that reading);
 *   * `weak`: he pushes the holder out of their eleven (`replaced`: on a 1x1 the starter he beats, on a 2x2 who leaves
 *     their eleven besides the men we take); an EMPTY place has no holder, and a man who can stand in it is enough.
 * A trade that TAKES the needy man meets nothing: it moves their problem, it does not solve it.
 *
 * The first version only asked whether a man we give could stand in a needy place, and with three needs a rival on
 * three lines it was true of nearly every offer (27 lines of 30): a label on every line says nothing.
 */
export function needMet(
  needs: readonly RivalNeed[],
  give: readonly ScoutMan[],
  take: readonly ScoutMan[],
  replaced: readonly (ScoutMan | null)[],
  withoutNeedy: ReadonlySet<number>,
): RivalNeed | null {
  const fits = (man: ScoutMan, need: RivalNeed) => man.roles.some((r) => need.roles.includes(r));
  return (
    needs.find((need) => {
      if (need.holder && take.some((man) => man.id === need.holder!.id)) return false;
      if (need.kind !== 'weak') return give.some((man) => withoutNeedy.has(man.id) && fits(man, need));
      return need.holder ? replaced.some((man) => man?.id === need.holder!.id) : give.some((man) => fits(man, need));
    }) ?? null
  );
}

/** The eleven a rival fields after a trade, without the men his `out` / `novote` needs name. */
export function elevenWithoutNeedy(
  men: readonly ScoutMan[],
  needs: readonly RivalNeed[],
  rules: MantraModules | null,
  rounds: number,
): Set<number> {
  const needy = new Set(needs.filter((n) => n.kind !== 'weak' && n.holder).map((n) => n.holder!.id));
  return strengthOf(men.filter((man) => !needy.has(man.id)), rules, rounds).eleven;
}

const NEED_ORDER: Record<NeedKind, number> = { out: 0, novote: 1, weak: 2 };

export interface RivalReport {
  name: string;
  perRound: number;
  module: string;
  /**
   * His men outside his eleven who would enter OURS, with what they add to us a matchday - those who come from a
   * SURPLUS first (`RivalSurplus`).
   */
  spare: { man: ScoutMan; forUs: number; surplus: RivalSurplus | null }[];
  holes: RivalHole[];
  /** What he feels is wrong, strongest kind first. */
  needs: RivalNeed[];
}

export function rivalReports(
  mine: ScoutSquad,
  rivals: readonly ScoutSquad[],
  rules: MantraModules | null,
  rounds: number,
): RivalReport[] {
  const ours = strengthOf(mine.men, rules, rounds);
  const all = [mine, ...rivals].map((squad) => ({ squad, strength: strengthOf(squad.men, rules, rounds) }));
  const byLine = new Map<ModuleLine, number[]>();
  for (const one of all) {
    for (const place of one.strength.places) byLine.set(place.line, [...(byLine.get(place.line) ?? []), place.perRound]);
  }
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const medians = new Map([...byLine].map(([line, values]) => [line, median(values)]));
  const ourBench = mine.men.filter((man) => priced(man) && !ours.eleven.has(man.id));
  return all.slice(1).map(({ squad, strength }) => {
    const spare = squad.men
      .filter((man) => priced(man) && !strength.eleven.has(man.id))
      .map((man) => ({
        man,
        forUs: strengthOf([...mine.men, man], rules, rounds).perRound - ours.perRound,
        surplus: surplusOf(squad.men, strength.eleven, man),
      }))
      .filter((one) => one.forUs >= MIN_GAIN)
      .sort((a, b) => Number(!!b.surplus) - Number(!!a.surplus) || b.forUs - a.forUs);
    const holes: RivalHole[] = strength.places
      .map((place) => {
        const med = medians.get(place.line) ?? 0;
        const offers = ourBench
          .filter((man) => man.roles.some((r) => place.roles.includes(r)) && (valueOf(man) ?? 0) / rounds > place.perRound)
          .sort((a, b) => (valueOf(b) ?? 0) - (valueOf(a) ?? 0));
        return { slot: place.slot, line: place.line, now: place.perRound, median: med, holder: place.holder, offers };
      })
      .filter((hole) => hole.median - hole.now >= HOLE_GAP)
      .sort((a, b) => b.median - b.now - (a.median - a.now));
    const weak = new Set(holes.map((hole) => hole.slot + '|' + (hole.holder?.id ?? '')));
    const needs: RivalNeed[] = strength.places
      .map((place): RivalNeed | null => {
        const holder = place.holder;
        const kind: NeedKind | null =
          holder && (holder.outFor ?? 0) > 0
            ? 'out'
            : holder && (holder.recent?.noVote ?? 0) >= NO_VOTE_MIN
              ? 'novote'
              : weak.has(place.slot + '|' + (holder?.id ?? ''))
                ? 'weak'
                : null;
        return kind ? { kind, slot: place.slot, line: place.line, roles: place.roles, holder } : null;
      })
      .filter((need): need is RivalNeed => !!need)
      .sort((a, b) => NEED_ORDER[a.kind] - NEED_ORDER[b.kind]);
    return { name: squad.name, perRound: strength.perRound, module: strength.module, spare, holes, needs };
  });
}
