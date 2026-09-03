/**
 * The SLOT BOARD of a random-extraction auction: what a lot is worth, and what to bid.
 *
 * The grid is not an impagination, it is the structure of the market (`docs/model/
 * assistente-asta-v1.md` «La PLANCIA a slot»): a roster is 25 men and a listone holds exactly 25
 * SLOTS of `teams` men, because a slot is a rank divided by the number of squads. So *a roster is
 * one man per slot*, and every measurement of the auction bench lives on that grid - the engine's
 * advice pays INSIDE a slot (§25), the end-of-phase discount exists from slot 3 down (§23), and the
 * adopted timing rule is a rule about slots (§24).
 *
 * Nothing here predicts a footballer. The valuation is the sheet's, read and never recomputed; what
 * is deduced is about SLOTS, CREDITS and RIVALS - the same boundary that puts a real club's board in
 * the toolkit and a fanta eleven in the app.
 *
 * The one thing this file must not do is print a precision the measurement does not have: every
 * ceiling below is a BAND, because the thresholds are measured on ten seasons with 3-8 of them
 * agreeing (§27.6). What is solid and can be written flat: above 20% of the budget one is wrong in
 * any slot, below 10% never.
 */

import { ValuationBasis } from './auction-value';

export type Role = 'P' | 'D' | 'C' | 'A';

/** In the order the roster declares them, which is also the order the board draws its four lines. */
export const ROLES: readonly Role[] = ['P', 'D', 'C', 'A'] as const;

/** A man as the board needs him: his coordinate in the room, and what the engine expects of him. */
export interface PlanciaMan {
  id: number;
  name: string;
  club: string;
  role: Role;
  /**
   * The FVM, which is the coordinate the ROOM reads, frozen at the auction date.
   *
   * Measured over the 20 real auctions of this league: grouping men by what they will actually cost,
   * the dispersion inside the slot is FVM 0.350 · Qt.A 0.358 · Qt.I 0.382, and the auction-day FVM
   * wins in 14 of 20. The better reason is the operator's own: the block must group the men the room
   * treats as equivalent, and the room reads the FVM.
   */
  fvm: number;
  /** Expected fantapunti over the calendar (`fm x pv`). Null when the sheet refuses to price him. */
  points: number | null;
  /** Expected appearances, the one number where we measurably beat the quotation (§21, §25). */
  pv: number | null;
  /**
   * QUANTO RENDE SOPRA IL SEI, PER PARTITA GIOCATA: `fantamedia prevista − 6`.
   *
   * Richiesta dell'operatore (03/09/2026): «un numerino che mi indichi il suo valore a colpo
   * d'occhio ... quanti punti (tra media voto e bonus) a partita fa guadagnare rispetto al 6». La
   * prima versione era per PARTITA GIOCATA (`fm − 6`) e lui ha trovato subito il difetto guardando
   * lo schermo: «perche' Hojlund (+1,1) sta prima di Martinez (+1,6)? Immagino per le presenze».
   * Si': dentro uno slot la plancia ordina per VALORE ATTESO (§23.2), e un numero che non sa niente
   * delle presenze non puo' che contraddire quell'ordine.
   *
   * Portarlo A GIORNATA (`fm × pv / giornate − 6`) e' stato provato per una versione e RITIRATO da
   * lui: «i punteggi non tornano - meglio il delta medio a partita e tra parentesi il num di partite
   * atteso». Aveva ragione due volte. Il riferimento «sei in TUTTE le giornate» non lo raggiunge
   * nessuno, quindi la colonna diventava quasi tutta negativa e larga (−247 su un attaccante da 19
   * presenze), e soprattutto **schiacciava due fatti in una cifra**: quanto vale una sua partita e
   * quante ne gioca. Adesso sono due numeri accanto, il secondo fra parentesi - che e' la disciplina
   * che questa pagina applica gia' al conteggio delle facili e alla sua attesa, «due numeri, due
   * domande, mai una cifra sola». E l'ordine del blocco resta il valore atteso, che quei due numeri
   * ora SPIEGANO invece di contraddire: Hojlund +1,1 (33) sopra Martinez +1,6 (30) si legge.
   *
   * Il SEI e' la media di riferimento di un voto - una convenzione del gioco, non una misura nostra -
   * e vive in `EDGE_BASE`, qui, che e' l'unico posto dove questa colonna e' definita. `null` quando
   * il foglio non lo prezza («vuoto = ignoto, mai zero»: uno zero qui si leggerebbe come «rende
   * esattamente il sei»).
   */
  edge: number | null;
  basis: ValuationBasis;
  /**
   * OGGI NON GIOCA: la stampa lo dà fuori, o un infortunio ufficiale è ancora aperto.
   *
   * Non è una valutazione e non entra in nessun numero - non sappiamo per quanto starà fuori, quindi
   * riprezzarlo sarebbe inventare. È un VINCOLO: lo fa scendere in fondo al suo slot e cambia il
   * verdetto del lotto, sempre dicendolo. Popolato dallo store, che è l'unico a conoscere lo stato.
   */
  outNow?: boolean;
  /**
   * FUORI ROSA: la nota che l'operatore ha DICHIARATO su di lui (`config/player_notes.json`,
   * `kind: 'out_of_squad'`), letta dallo stesso servizio dello stato di salute perche' due letture di
   * una dichiarazione darebbero a un uomo due risposte.
   *
   * E' INFORMAZIONE e non un motivo per toglierlo dal tabellone, ed e' una distinzione dell'operatore
   * (03/09/2026): «non deve essere tolto per la nota "fuori rosa" ma perche' non gioca piu' in serie
   * A». Fuori rosa e' uno stato DENTRO un club - uno cosi' e' ancora nel campionato e qualcuno lo
   * comprera' - mentre chi ha lasciato il campionato lo dice il LISTONE col foglio `Ceduti` (sul sito
   * l'asterisco), e quelle righe il foglio non le porta piu' affatto (`listone_quotes.sold`). Quindi
   * qui non filtra niente: si disegna, e chi guarda decide.
   */
  outOfSquad?: boolean;
}

export interface SlotBlock {
  role: Role;
  /** 1-based: `D2` is the second defender of every roster. */
  index: number;
  id: string;
  /**
   * The men of the slot, `teams` of them, ordered by EXPECTED VALUE and not by price.
   *
   * Membership is decided by the FVM (it is the room's coordinate); the ORDER inside is ours, because
   * that is the only decision the advice changes and the only one it measurably wins: inside a price
   * band the quotation is worth less than a throw of the dice (-1.0 +/- 3.7 fantapunti for taking the
   * dearest), while taking the man the engine expects to play more is worth +18.1 +/- 3.4, ten seasons
   * out of ten (§25). Two different orders on one block, and mixing them is the defect.
   */
  men: PlanciaMan[];
  /** What the room pays for this slot, from the men themselves: the median FVM. */
  medianFvm: number;
}

/** Il voto di riferimento del gioco: sopra questo un uomo guadagna, sotto perde. */
export const EDGE_BASE = 6;

export interface PlanciaMap {
  blocks: SlotBlock[];
  byRole: Map<Role, SlotBlock[]>;
  /** Where a man sits, by id. A man outside the map has no entry - and that is not «worthless». */
  slotOf: Map<number, SlotBlock>;
  /**
   * The men below the map, counted and NOT named.
   *
   * A board that hides them talks the operator into waiting, and waiting until places are left empty
   * is the most expensive error this bench has measured. In the real auctions 5 men of every 25-man
   * roster come from here, paid one credit - so they deserve a count and no more than that.
   */
  tail: PlanciaMan[];
}

/**
 * The board, cut by FVM.
 *
 * `slots` is the league's own roster shape (3/8/8/6), so the number of blocks per role is declared
 * and never inferred: a role with 8 places has 8 slots whatever the listone happens to carry.
 */
export function buildMap(
  men: Iterable<PlanciaMan>,
  teams: number,
  slots: Record<Role, number>,
): PlanciaMap {
  const byRole = new Map<Role, SlotBlock[]>();
  const blocks: SlotBlock[] = [];
  const slotOf = new Map<number, SlotBlock>();
  const tail: PlanciaMan[] = [];
  const pool = new Map<Role, PlanciaMan[]>();

  for (const role of ROLES) pool.set(role, []);
  for (const man of men) pool.get(man.role)?.push(man);

  for (const role of ROLES) {
    // Dearest first, ties broken by id: two runs over one listone must give one board.
    const ranked = (pool.get(role) ?? []).sort((a, b) => b.fvm - a.fvm || a.id - b.id);
    const count = Math.max(0, slots[role] ?? 0);
    const roleBlocks: SlotBlock[] = [];

    for (let index = 0; index < count; index += 1) {
      const chunk = ranked.slice(index * teams, (index + 1) * teams);
      if (!chunk.length) break;
      const block: SlotBlock = {
        role,
        index: index + 1,
        id: `${role}${index + 1}`,
        men: orderInside(chunk),
        medianFvm: median(chunk.map((man) => man.fvm)),
      };
      for (const man of chunk) slotOf.set(man.id, block);
      roleBlocks.push(block);
      blocks.push(block);
    }

    tail.push(...ranked.slice(count * teams));
    byRole.set(role, roleBlocks);
  }

  return { blocks, byRole, slotOf, tail };
}

/**
 * The order INSIDE a block: expected value first, and the price only as a tie-break.
 *
 * The criterion adapts by itself, which is why it is expected value and not bare appearances: where
 * the price inside the slot is flat (ratio 1.0-1.3 from slot 2 down) the presences dominate, and in
 * the first slot - where the dearest costs 1.7-2.5 times the tenth - the price is still saying
 * something and the fantamedia it carries comes back into the order (§27).
 */
function orderInside(men: PlanciaMan[]): PlanciaMan[] {
  return [...men].sort(
    // CHI OGGI NON GIOCA VA IN FONDO, prima di ogni altra cosa. Vincolo e non peso: la sua posizione
    // dentro lo slot resta quella di prima fra i suoi pari, cambia solo che non è il primo nome che
    // l'occhio incontra alla quarta ora. Un uomo dato fuori dalla stampa e proposto in cima è
    // esattamente il caso che l'operatore non vuole vedere (03/09/2026).
    (a, b) =>
      Number(a.outNow ?? false) - Number(b.outNow ?? false) ||
      (b.points ?? -1) - (a.points ?? -1) ||
      b.fvm - a.fvm ||
      a.id - b.id,
  );
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The adopted ladder, as a SHARE of the budget per (role, slot).
 *
 * These are the credits of `simulatore-asta-rilanci-v1.md` §19.3 - the market scale tilted onto the
 * defence, verdict STRICT over 10 windows of 10, worst +10.1%, interior optimum - divided by the
 * 1000-credit budget they were measured on. A share and not a figure because the ceiling SCALES with
 * the budget: verified at 500 · 1000 · 2000, the sign turns between 17.5% and 19% in all three cases
 * (§27.2), which is «a threshold is not compared between different budgets» applied to a ceiling.
 *
 * Read it as one sentence: **the four best defenders are the investment, everything else is at the
 * market price or under.** The defence is paid above market ACROSS its first four slots and never on
 * one top man - which is what the §27.3 measurement means by «difensori: nessun prezzo».
 */
export const LADDER: Record<Role, number[]> = {
  P: [0.077, 0.01, 0.002],
  D: [0.097, 0.063, 0.032, 0.025, 0.005, 0.004, 0.003, 0.002],
  C: [0.107, 0.048, 0.034, 0.019, 0.004, 0.003, 0.002, 0.001],
  A: [0.234, 0.083, 0.042, 0.009, 0.005, 0.001],
};

/** Above this share of the budget one is wrong in any slot (-0.3 to -1.2 points a matchday, §27.6). */
export const CEILING_ALWAYS_WRONG = 0.2;

/** Under this share one is never wrong, whatever the slot. The other half of the same measurement. */
export const CEILING_ALWAYS_SAFE = 0.1;

/**
 * What running out of DEPTH does to a ceiling (§27.5), and it is not linear.
 *
 * Emptying the next slot alone barely moves it (21% -> 22%): the alternative is not «two of the next
 * slot» but «two of the best that remain», and the third slot is nearly as good a substitute. The
 * jump comes with TWO empty slots below: +44%, and there the first slot wins 10 seasons of 10.
 * In one line: while there is depth under him a top man is worth 210, when the depth is gone he is
 * worth 320.
 */
export function depthFactor(exhaustedBelow: number): number {
  if (exhaustedBelow >= 2) return 1.52;
  if (exhaustedBelow === 1) return 1.05;
  return 1;
}

export interface OfferBand {
  low: number;
  high: number;
  /** The share of the budget the band is centred on, before the room cap. */
  share: number;
  /** True when the purse and not the measurement decided the ceiling. */
  capped: boolean;
  /** True when the band sits over the «wrong in any slot» line - which the screen must show. */
  overCeiling: boolean;
}

/**
 * The max offer, as a BAND.
 *
 * Never an exact figure: the thresholds are measured on ten seasons with 3-8 agreeing, so the
 * direction is sharp (the sign turns between 13% and 19%, over three slots and three independent
 * roles) and the point is not. Writing «180» on a row that decides a purchase is a precision the
 * data does not have.
 *
 * Three things enter it and each has its measurement:
 *   * the LADDER above, anchored on the median man of the slot;
 *   * the man's OWN expected value against that median, because a slot is ten men and what separates
 *     them is not the price (§25) - this is the only place our own opinion enters a bid;
 *   * the ROOM. A pair costing 160 credits is no alternative to somebody who has 100, so the ceiling
 *     is always `min(measured quota, what the purse allows)` or the board advises a ceiling that
 *     cannot even be reached.
 */
export function offerBand(input: {
  role: Role;
  slotIndex: number;
  budget: number;
  room: number;
  points: number | null;
  medianPoints: number | null;
  exhaustedBelow?: number;
}): OfferBand | null {
  const ladder = LADDER[input.role];
  const share = ladder[Math.min(input.slotIndex, ladder.length) - 1];
  if (share == null || !(input.budget > 0)) return null;

  // The man's own weight inside his slot, held to +/-35%: the band is a fact about the SLOT and this
  // term only says where in it he stands. Letting it run free would turn a measured ceiling into a
  // ranking of our own, which is not what any of the ten windows judged.
  const middle = input.medianPoints;
  const own =
    input.points != null && middle != null && middle > 0
      ? clamp(input.points / middle, 0.65, 1.35)
      : 1;

  const centre = share * input.budget * own * depthFactor(input.exhaustedBelow ?? 0);
  const low = Math.round(centre * 0.9);
  const high = Math.round(centre * 1.1);
  const room = Math.max(0, Math.round(input.room));

  return {
    low: Math.min(low, room),
    high: Math.min(high, room),
    share: centre / input.budget,
    capped: high > room,
    overCeiling: centre / input.budget > CEILING_ALWAYS_WRONG,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * What a thinning table does to the price, measured on the 10 real drawn auctions of this league
 * (2495 awards, §23.1), inside the band so the composition does not pollute it.
 *
 * The answer is a THRESHOLD and not a curve, and it is substitutability that draws it: the first two
 * slots are twenty men for ten starting places and everybody wants them, so they never go on sale
 * (zero awards at one credit out of 552 for the first slot of any role); from the third slot the men
 * outnumber the places and the room's demand evaporates as the rosters fill.
 *
 * `hands` = how many rosters still have a free place in that role.
 */
export function discountFor(slotIndex: number, hands: number, teams: number): number {
  const open = teams > 0 ? hands / teams : 0;
  const band = open > 0.8 ? 0 : open > 0.5 ? 1 : 2;
  if (slotIndex <= 2) return [1.0, 0.91, 0.8][band];
  if (slotIndex <= 4) return [1.0, 0.5, 0.5][band];
  return [1.0, 0.36, 0.21][band];
}

/** From which slot down it pays to let a man pass (`bench.DEPTH_TIER`, §24). */
export const DEPTH_TIER = 2;

/** And while at least this many rosters still want that role (`bench.DEPTH_HANDS`, §24). */
export const DEPTH_HANDS = 9;

/**
 * Whether to let this lot go by, which is the one channel that measurably pays at the urn.
 *
 * +1.88% STRICT over 800 paired seasons (t 11.6, 10 windows of 10, worst +0.57%), holes 18.9 -> 13.3.
 * The mechanism is not «depth for less»: the tail goes from 3 credits to 1 with the expected
 * appearances unchanged, and the credits saved buy 10.5 -> 12.1 men of the first two slots, which is
 * where §27.4 measured that the price never drops.
 *
 * The band is the ARCHIVE's and not the bench's optimum: the bench improves monotonically down to 3
 * hands (+3.85%), but the prices that peak collects do not exist at a real table. Two percentage
 * points left on the table on purpose.
 */
export function worthWaiting(slotIndex: number, hands: number, teams: number): boolean {
  if (slotIndex <= DEPTH_TIER) return false;
  return hands >= Math.min(DEPTH_HANDS, teams);
}

export type Verdict = 'prendi' | 'aspetta' | 'lascia' | 'ignoto' | 'fermo';

export interface LotAdvice {
  verdict: Verdict;
  /** One line, and it is the reason and not a description of the verdict. */
  reason: string;
  band: OfferBand | null;
  hands: number;
  /** What the room usually pays for this (role, slot), after the thinning discount. */
  expectedPrice: number;
  waiting: boolean;
}

/**
 * The verdict, and it is three questions asked in order.
 *
 * `ignoto` is a fourth state and not a soft «lascia»: a man the sheet cannot price has no number, and
 * an empty cell is a statement - the board says so and leaves the decision to the table.
 */
export function adviseLot(input: {
  role: Role;
  slotIndex: number;
  band: OfferBand | null;
  medianFvm: number;
  tablePrice: number;
  hands: number;
  teams: number;
  exhaustedBelow: number;
  priced: boolean;
  /** Oggi non gioca. Decide il verdetto prima di ogni prezzo, e non tocca la banda. */
  outNow?: boolean;
  outReason?: string | null;
}): LotAdvice {
  const { band, tablePrice, slotIndex, hands, teams } = input;
  const expectedPrice = Math.max(
    1,
    Math.round(input.medianFvm * discountFor(slotIndex, hands, teams)),
  );
  const waiting = worthWaiting(slotIndex, hands, teams);
  const shared = { band, hands, expectedPrice, waiting };

  // PRIMA DI OGNI ALTRA COSA: se oggi non gioca, il verdetto è quello e non un prezzo. Sta davanti al
  // caso «non prezzato» perché è più forte - lì non sappiamo quanto vale, qui sappiamo che non gioca -
  // ed è un quinto stato e non un «lascia», perché la ragione è diversa e la decisione è dell'operatore:
  // può volerlo lo stesso, a un prezzo che tenga conto di quello che la banda non sa.
  if (input.outNow) {
    return {
      verdict: 'fermo',
      reason: input.outReason ?? 'Oggi non gioca: da esaminare prima di offrire.',
      ...shared,
    };
  }

  if (!input.priced || !band) {
    return {
      verdict: 'ignoto',
      reason: 'Il foglio non lo prezza: qui non c’è un numero.',
      ...shared,
    };
  }

  if (tablePrice > band.high) {
    return {
      verdict: 'lascia',
      reason:
        input.role === 'D'
          ? `Oltre ${band.high} non vale: la coppia dello slot successivo rende di più.`
          : `Oltre ${band.high} gli stessi crediti comprano più di lui.`,
      ...shared,
    };
  }

  if (waiting) {
    return {
      verdict: 'aspetta',
      reason: `Slot ${slotIndex} con ${hands} rose ancora aperte: il prezzo scende, lascialo passare.`,
      ...shared,
    };
  }

  if (input.exhaustedBelow >= 2) {
    return {
      verdict: 'prendi',
      reason: 'Sotto di lui la profondità è finita: adesso vale la metà in più.',
      ...shared,
    };
  }

  if (slotIndex <= 2) {
    return {
      verdict: 'prendi',
      reason: 'Primi due slot: non arrivano mai in saldo, aspettare vale al massimo il 20%.',
      ...shared,
    };
  }

  return {
    verdict: 'prendi',
    reason: `Dentro la banda e sotto la mediana dello slot (${Math.round(input.medianFvm)} cr).`,
    ...shared,
  };
}

export interface Alternative {
  men: PlanciaMan[];
  /**
   * What each of them costs, in the SAME currency as the total and in the same order as `men`.
   *
   * Carried rather than recomputed by the reader: splitting the total back over the two men is how a
   * screen ends up printing a per-man figure nobody measured, and the whole point of showing the pair
   * is that its two prices are real ones you could pay.
   */
  costs: number[];
  /**
   * Whether the two are bought TOGETHER, which decides whether a total means anything.
   *
   * For a man of movement it is a PAIR - two of the slot below instead of one of his - so the total is
   * the thing being compared with his price. For a KEEPER it is false: you field one, so the second and
   * third of his own slot are two alternatives TO EACH OTHER, and adding them would compare his price
   * with a sum nobody would ever pay. Two shapes with one name is how a screen prints a number in the
   * wrong unit.
   */
  together: boolean;
  /** The sum, and `null` when the men are alternatives to each other rather than a pair. */
  total: number | null;
  note: string;
}

/**
 * What you would buy INSTEAD, and it is what makes the verdict doubtable.
 *
 * Two rules the measurement imposes. The pair is computed on WHO IS STILL IN THE URN and not on the
 * two best of all time: the alternative degrades as the auction goes on, and it is exactly that
 * count nobody holds in his head at the fourth hour - the work the board exists for. And FOR A
 * KEEPER THE PAIR DOES NOT EXIST: you field one, so «two of the next slot instead of one» is a bench
 * and not an alternative; there the alternative is ANOTHER KEEPER of the same slot, which is also the
 * role where the engine is worth double, because at equal price the only question is which of the ten
 * plays.
 *
 * The CURRENCY is the caller's (`costOf`) and it is not optional, because it is the whole meaning of the
 * total: the board quotes the pair in MAX OFFER - what those two would cost you - and quoting it in FVM
 * beside a row that shows a max offer would put two units in one comparison.
 */
export function alternativeFor(
  map: PlanciaMap,
  block: SlotBlock,
  inUrn: (man: PlanciaMan) => boolean,
  exclude: number,
  costOf: (man: PlanciaMan) => number,
): Alternative | null {
  if (block.role === 'P') {
    const others = block.men.filter((man) => man.id !== exclude && inUrn(man)).slice(0, 2);
    if (!others.length) return null;
    return {
      men: others,
      costs: others.map(costOf),
      together: false,
      total: null,
      note: 'un altro portiere dello stesso slot',
    };
  }

  const roleBlocks = map.byRole.get(block.role) ?? [];
  for (const next of roleBlocks.filter((candidate) => candidate.index > block.index)) {
    const pair = next.men.filter(inUrn).slice(0, 2);
    if (pair.length < 2) continue;
    const costs = pair.map(costOf);
    return {
      men: pair,
      costs,
      together: true,
      total: costs.reduce((sum, cost) => sum + cost, 0),
      note: `la coppia ${next.id} al suo posto`,
    };
  }
  return null;
}
