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

export interface RivalReport {
  name: string;
  perRound: number;
  module: string;
  /** His men outside his eleven who would enter OURS, with what they add to us a matchday. */
  spare: { man: ScoutMan; forUs: number }[];
  holes: RivalHole[];
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
      .map((man) => ({ man, forUs: strengthOf([...mine.men, man], rules, rounds).perRound - ours.perRound }))
      .filter((one) => one.forUs >= MIN_GAIN)
      .sort((a, b) => b.forUs - a.forUs);
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
    return { name: squad.name, perRound: strength.perRound, module: strength.module, spare, holes };
  });
}
