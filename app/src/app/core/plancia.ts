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
import { OutWindow } from './injury-window';
import { itDate } from './tooltip';

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
   * e vive in `EDGE_BASE`, qui, che e' l'unica DEFINIZIONE di questa colonna - e da oggi ha due
   * lettori, perche' le pastiglie della Strategia mostrano lo stesso numero (`strategy.readingsOf`).
   * Un secondo `6` scritto la' sarebbe la stessa colonna con due basi il giorno che una cambia.
   * `null` quando il foglio non lo prezza («vuoto = ignoto, mai zero»: uno zero qui si leggerebbe
   * come «rende esattamente il sei»).
   */
  edge: number | null;
  /**
   * LO SWING: i gol di classifica che fa segnare (`core/swing.ts`), e l'ordine dello SLOT PERSONALE.
   *
   * Non ordina lo slot di MERCATO, che resta il valore atteso: li' il taglio e' il rango per prezzo e
   * i due numeri della riga (+X e le partite) devono SPIEGARE l'ordine, che e' la regola del
   * 03/09/2026. Sul taglio personale la riga porta invece lo SWING accanto al tetto, quindi la
   * colonna e l'ordine tornano a dire la stessa cosa - «una colonna con due significati non puo'
   * essere anche la chiave dell'ordinamento», applicata alla griglia nuova.
   *
   * `null` dove il foglio non prezza l'uomo: uno zero direbbe «non fa segnare niente», che e' una
   * frase sul calciatore e non sulla nostra ignoranza.
   */
  swing: number | null;
  basis: ValuationBasis;
  /** Quanto e' solido il numero: 1 per una misura, `est_confidence` per una stima. Entra nel TETTO. */
  confidence: number;
  /**
   * OGGI NON GIOCA E NON SAPPIAMO PER QUANTO: la stampa lo dà fuori, o un infortunio ufficiale è
   * ancora aperto, e nessuna delle due fonti dice fino a quando.
   *
   * È INFORMAZIONE E NON UN VINCOLO, per decisione dell'operatore del 04/09/2026, che ritira la sua
   * stessa regola del 03/09: «non è molto rilevante ai fini del mercato, è solo una gara saltata,
   * mostrarlo addirittura barrato mi ha tratto in inganno». Quindi non fa scendere più nessuno e non
   * tinge più nessuna riga: il fatto lo porta l'ICONA della riga, che ha la sua ragione nel tooltip, e
   * la card lo scrive per esteso. *Un inchiostro che grida un fatto piccolo è peggio di nessun
   * inchiostro, perché fa leggere come cancellato un uomo che salta una partita.*
   *
   * Quello che NON è cambiato è il tetto: `offerBand` lo demota di un gradino (`HURT_SLOT_STEP`),
   * perché chi non dice quando torna non può avere il tetto pieno del suo slot - lì la penalità
   * produce un NUMERO, che la riga mostra, invece di un decreto che nessuno può leggere.
   *
   * DOVE UNA DATA DI RIENTRO C'È, questo campo è FALSO e al suo posto c'è `out`: il vincolo esisteva
   * perché mancava un numero, e dove il numero c'è fa lo stesso lavoro meglio, perché dice di quanto.
   * I due non convivono mai su una riga, o l'uomo verrebbe penalizzato due volte per un fatto solo.
   */
  outNow?: boolean;
  /**
   * INFORTUNATO DI LUNGA DATA: uno spell ancora aperto che dura da 45 giorni o più.
   *
   * È l'inchiostro BARRATO della plancia, su richiesta dell'operatore (04/09/2026): «lo stile barrato
   * utilizziamolo per gli infortunati di lunga data». Questo sì è un fatto di mercato - la sua stagione
   * è compromessa, non una giornata - e il barrato lo dice sulla riga senza cercare un'icona.
   *
   * NON riordina e non riprezza niente da sé: chi ha una data porta già le giornate perse dentro
   * `points` e `pv`, quindi scende per conto suo. La soglia è quella che decide l'icona
   * (`player-status.LONG_INJURY_DAYS`) e non una nostra: un'icona e un inchiostro per una frase sola.
   */
  longOut?: boolean;
  /**
   * ...E QUANDO INVECE LA DURATA SI SA: quante giornate perde, e quindi quanta stagione compri.
   *
   * `points` e `pv` di questa riga sono GIÀ ridotti di `out.share` - una sola valutazione per uomo,
   * quella che l'ordine dentro lo slot legge e che lo schermo mostra - e `offerBand` riceve la quota
   * a parte perché la sua clamp non se la mangi. Il conto sta in `injury-window.ts`, che lo fa sul
   * calendario del club e non sul calendario di nessun altro.
   */
  out?: OutWindow | null;
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
  /**
   * ...e chi di questo slot e' stato LASCIATO FUORI perche' rientra troppo tardi (`MIN_PLAY_SHARE`).
   *
   * Restano nel RANGO e non nella lista: il numero di slot e' un fatto sul mercato - un rango diviso
   * il numero di squadre - e la stanza quei nomi li compra ancora, quindi toglierli dalla graduatoria
   * sposterebbe tutti di un posto e la mia plancia parlerebbe di slot diversi da quelli su cui la
   * scala e' misurata. Quello che si toglie e' la RIGA, non il posto.
   *
   * Contati e NOMINATI, perche' un blocco con nove righe invece di dieci e senza una parola si legge
   * come un tabellone rotto: «un vincolo che agisce in silenzio e' indistinguibile da un ordinamento
   * rotto» (03/09/2026), e qui il vincolo cancella una riga invece di spostarla in fondo.
   */
  excluded: PlanciaMan[];
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
      // CHI RIENTRA TROPPO TARDI ESCE DALLA LISTA E RESTA NEL RANGO (vedi `SlotBlock.excluded`). La
      // mediana del PREZZO si calcola comunque su tutti e dieci, perche' risponde a «quanto paga la
      // stanza per questo slot» e la stanza lo compra ancora; quella dei PUNTI la calcola chi legge,
      // sui soli disegnati, perche' risponde a «quanto vale il medio di quelli che posso comprare».
      // Due mediane, due domande.
      const excluded = chunk.filter((man) => (man.out?.share ?? 1) < MIN_PLAY_SHARE);
      const block: SlotBlock = {
        role,
        index: index + 1,
        id: `${role}${index + 1}`,
        men: orderInside(chunk.filter((man) => !excluded.includes(man))),
        excluded,
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
  // NESSUN GRADINO PER CHI OGGI NON GIOCA (04/09/2026, e ritira la regola del 03/09 dello stesso
  // operatore): «e' solo una gara saltata», quindi far scendere un nome per quello è una penalità
  // di un ordine di grandezza più grande del fatto - e senza il barrato, che era l'inchiostro con cui
  // il vincolo si dichiarava, sarebbe anche un riordino MUTO, che questa pagina non fa per principio.
  // Chi manca davvero scende da sé: `points` porta le giornate che perde, e di quanto scende è una
  // misura invece di un decreto.
  return [...men].sort(
    (a, b) => (b.points ?? -1) - (a.points ?? -1) || b.fvm - a.fvm || a.id - b.id,
  );
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * WHICH GRID THE BOARD DRAWS. Two readings of the same 250 men, and the toggle names them.
 *
 * `market` is the measurement: a slot is a rank by FVM divided by the number of squads, which is a
 * conservation law (ten first defenders, because every roster fields one) and the population every
 * number of the auction bench is measured on - the ladder, the thinning discount, the timing band.
 *
 * `mine` is the operator's own request (04/09/2026): «un tasto che mi permetta di cambiare
 * visualizzazione da slot MERCATO a slot PERSONALI ... ripopolare gli slot ordinando i calciatori per
 * offerta massima». It answers the question the market grid cannot - «di tutti i difensori, quali
 * sono i dieci che pagherei di piu'» - which at a free extraction is what decides whether the name
 * that just came up is one of mine at all.
 */
export type SlotView = 'market' | 'mine';

/** A block of the personal grid: the same shape the market one has, cut on another coordinate. */
export interface OfferGroup<T extends PlanciaMan> {
  role: Role;
  index: number;
  id: string;
  men: T[];
  /** The median of MY ceilings in the block: the coordinate it is cut on, so it is what its header says. */
  medianOffer: number;
  /** ...and what the room asks for the same ten men, which is no longer a property of the block. */
  medianFvm: number;
}

/**
 * The same men, cut on MY OWN CEILING instead of the room's price.
 *
 * THE CEILING IS NOT RE-DERIVED ON THE NEW GRID, and that is a decision rather than a shortcut. The
 * ladder is a share of the budget per (role, slot) measured with the slot defined as a rank BY PRICE
 * (§19.3), so re-reading it on a rank by our own offer would apply a measured scale outside the
 * population it was measured on - and it would be circular on top of that, the offer deciding the slot
 * that decides the offer. So this is a RE-ARRANGEMENT of the market's own ceilings: every man keeps
 * the band the measurement gave him, and the card keeps naming the slot it was read on.
 *
 * NESSUNO E' ESCLUSO DA QUI, e la storia vale la riga di codice che non c'e'. Per un'ora questa
 * funzione ha tolto dalla griglia personale chi «oggi non gioca», su richiesta dell'operatore
 * («negli slot personali devi anche toglirmi calciatori come Bernabe e Casadei») - e lui l'ha
 * RITIRATA guardando il risultato: «non e' molto rilevante ai fini del mercato, e' solo una gara
 * saltata». La causa stava a monte e stava nell'INCHIOSTRO, non nella lista: la riga era BARRATA,
 * cioe' un fatto da una giornata era disegnato come una cancellazione, e chiedere di togliere quei
 * nomi era la conseguenza ragionevole di quello che lo schermo diceva. *Quando l'operatore chiede di
 * eliminare qualcosa, vale la pena chiedersi se sia la cosa a essere sbagliata o il modo in cui la si
 * mostra.* Il barrato ora dice «infortunato di lunga data» (`PlanciaMan.longOut`) e quei nomi sono
 * tornati.
 *
 * Quello che il taglio non fa e' promuovere chi la mappa non porta: la coda non ha una banda affatto
 * (la scala ha esattamente un gradino per slot), quindi cio' che si ritaglia e' la popolazione che la
 * griglia del mercato ha gia' prezzato.
 *
 * E DENTRO IL BLOCCO L'ORDINE E' LO SWING (operatore, 06/09/2026), non il tetto: il taglio risponde a
 * «quanto pagherei», l'ordine a «chi mi fa vincere di piu'», e sono due domande. Quella di prima era
 * una sola chiave per tutt'e due, e il prezzo si vedeva - la discesa si rompeva sulle righe di chi e'
 * gia' di qualcuno, perche' li' la cifra e' il prezzo PAGATO mentre l'ordine leggeva la banda.
 */
export function regroupByOffer<T extends PlanciaMan>(
  men: Iterable<T>,
  offerOf: (man: T) => number,
  teams: number,
  slots: Record<Role, number>,
): OfferGroup<T>[] {
  const pool = new Map<Role, T[]>();
  for (const role of ROLES) pool.set(role, []);
  for (const man of men) pool.get(man.role)?.push(man);

  const out: OfferGroup<T>[] = [];
  for (const role of ROLES) {
    // Dearest to me first, ties broken by the room's price and then by id: two runs over one board
    // must give one grid, the same determinism `buildMap` owes the market one.
    const ranked = [...(pool.get(role) ?? [])].sort(
      (a, b) => offerOf(b) - offerOf(a) || b.fvm - a.fvm || a.id - b.id,
    );
    const count = Math.max(0, slots[role] ?? 0);

    for (let index = 0; index < count; index += 1) {
      const chunk = ranked.slice(index * teams, (index + 1) * teams);
      if (!chunk.length) break;
      out.push({
        role,
        index: index + 1,
        id: `${role}${index + 1}`,
        // IL TAGLIO E' IL TETTO, L'ORDINE DENTRO E' LO SWING (operatore, 06/09/2026). Sono due
        // domande e per questo sono due chiavi: il blocco resta «quanto sono disposto a pagare»,
        // mentre chi sta in cima al blocco e' chi fa segnare di piu'. Chi non ha uno SWING va in
        // fondo e non in mezzo, perche' un numero che non c'e' non si ordina; il pareggio lo rompe
        // il tetto e poi l'id, cosi' due disegni della stessa plancia non si scambiano due righe.
        men: [...chunk].sort(
          (a, b) =>
            (b.swing ?? Number.NEGATIVE_INFINITY) - (a.swing ?? Number.NEGATIVE_INFINITY) ||
            offerOf(b) - offerOf(a) ||
            b.fvm - a.fvm ||
            a.id - b.id,
        ),
        medianOffer: median(chunk.map(offerOf)),
        medianFvm: median(chunk.map((man) => man.fvm)),
      });
    }
  }
  return out;
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

/**
 * SOTTO QUESTA QUOTA DI CALENDARIO UN UOMO NON ENTRA IN PLANCIA, per quanto sia bravo.
 *
 * DICHIARATA dall'operatore (04/09/2026): «nella nostra plancia non dobbiamo inserire calciatori che
 * tornano a gennaio». La sua frase e' un MESE, e un mese non e' confrontabile fra una stagione e
 * l'altra ne' fra un'asta di agosto e una di novembre - «una soglia assoluta non si confronta fra
 * budget diversi», applicata al calendario invece che alla borsa. Quindi la regola vive nell'unita'
 * invariante, la quota di giornate rimaste che l'uomo giocherebbe, e la sua frase e' quello che quella
 * quota PRODUCE oggi.
 *
 * 0,60 e non un altro valore per una ragione che si puo' misurare: sui 27 quotati di Serie A con una
 * data di rientro al 04/09/2026, la soglia 0,60 lascia fuori ESATTAMENTE i due che rientrano nell'anno
 * nuovo (Kone' I. 03/01, Thuram K. 01/01) e tiene dentro il primo di dicembre (Yildiz 25/11) a
 * qualunque margine di prudenza fra 0 e 40%. La soglia 0,65 invece cambia risposta col margine - a
 * 0,25 si porta via anche Yildiz - quindi e' il punto fragile e questo e' il punto stabile. *Fra due
 * soglie che dicono la stessa cosa oggi, si sceglie quella che non dipende da un'altra costante.*
 */
export const MIN_PLAY_SHARE = 0.6;

/**
 * SOTTO QUESTA QUOTA UN ACQUISTO E' UNA SCOMMESSA, e una scommessa ha un tetto suo.
 *
 * DICHIARATO dall'operatore su Yildiz (04/09/2026): «spendere un massimo di 65 crediti mi sembra
 * tanto ... troppi dubbi, troppo rischio ... io direi che fino a 20 o 30 crediti si possono impegnare
 * per una scommessa del genere, non di piu'». `BET_CAP_LOW`/`HIGH` sono le sue due cifre, tenute come
 * QUOTE del budget perche' un tetto in crediti non si confronta fra budget diversi (§27.2, verificato
 * a 500 - 1000 - 2000).
 *
 * 0,70 e' il centro di un VUOTO nell'archivio piu' che una scelta: sui 27 quotati di Serie A con una
 * data di rientro al 04/09/2026 non c'e' nessuno fra 0,64 (Yildiz, meta' dicembre col margine) e 0,75
 * (Buongiorno, Pessina, Ekhator, meta' novembre), quindi qualunque soglia in mezzo separa gli stessi
 * uomini e questa non dipende dal margine di prudenza.
 *
 * QUELLO CHE QUESTO TETTO NON E': il prezzo del rodaggio. «Prima che torni in forma ci vorra' qualche
 * partita» e' vero ed e' misurato - alla prima presenza dopo uno stop lungo gioca **20,2 minuti in
 * meno** (t -29,4 su 2043 rientri), prende il voto nell'**80,8% delle giornate contro il 90,8%**
 * (t -6,6) e il suo bonus a presenza cala di 0,09 (t -4,6) - ma sommato vale **circa 1,8 fantapunti
 * su ~140**, l'1,3%, cinque centesimi di punto a giornata. Il rodaggio esiste e NON e' quello che
 * porta un uomo da 65 crediti a 30: quello e' un'avversione al rischio, ed e' sua da dichiarare.
 * Tenerli separati e' il punto - un termine misurato che vale l'1% non deve prendersi il merito di
 * una decisione che ne vale il 60%. Numeri e decomposizione: `assistente-asta-v1.md` §36.
 */
export const BET_SHARE = 0.7;

/** Le due cifre dell'operatore, come quota del budget: 20 e 30 crediti su 1000. */
export const BET_CAP_LOW = 0.02;
export const BET_CAP_HIGH = 0.03;

/**
 * CHI E' INFORTUNATO OGGI NON SI PAGA COME IL PRIMO DEL SUO SLOT: si paga come quello sotto.
 *
 * L'operatore, 04/09/2026: «troviamo un modo per penalizzare McTominay e Orsolini, con il loro
 * infortunio non possono essere da primo slot». La quota di calendario da sola non li tocca - perdono
 * tre giornate su 36, cioe' l'8% - perche' risponde a un'altra domanda: **quante giornate perde** e'
 * un conto, **quanto e' solida la data** e' un rischio, e i due non si sommano dentro una cifra sola.
 *
 * La forma e' una DEMOZIONE DI UN GRADINO sulla scala, non un numero nuovo: il tetto che si applica e'
 * quello dello slot successivo. E' la sua frase detta nella valuta che la scala parla gia', ed e'
 * l'unica forma disponibile che non introduca una costante che nessuno ha misurato. Costa quanto vale
 * il gradino, che e' molto in cima (C1 0,107 -> C2 0,048) e quasi niente in fondo, dove il prezzo e'
 * gia' piatto - il che e' anche il comportamento giusto: un rischio del genere si paga sui top.
 *
 * NON tocca l'ORDINE dentro lo slot, che resta il valore atteso: quello e' misurato (§25) e un
 * gradino binario lo rovinerebbe. Tocca solo quanto sono disposto a pagarlo.
 */
export const HURT_SLOT_STEP = 1;

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
  /** Lo slot su cui il tetto e' stato letto: diverso dal suo quando l'infortunio lo ha demoto. */
  pricedAt: number;
  /** True quando a decidere la banda e' stato il tetto DICHIARATO della scommessa. */
  bet: boolean;
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
 *
 * E DAL 04/09/2026 UNA QUARTA, che non è un'opinione: la QUOTA DI CALENDARIO per cui l'uomo c'è.
 * Arriva già dentro `points` (una valutazione sola per uomo), e viaggia anche a parte per una ragione
 * precisa - la clamp qui sotto limita quanto la NOSTRA opinione può muovere una banda misurata sullo
 * slot, e un infortunio non è un'opinione: è una quota di calendario, quindi può portare la banda
 * sotto il pavimento della clamp, ma solo fino a quella quota e non oltre.
 */
/**
 * QUANTO SCENDE L'OFFERTA PER UN UOMO DI UN CLUB CHE HO GIÀ, per quanti ne ho già in rosa.
 *
 * Sua istruzione del 04/09/2026: «la max-offerta per un calciatore della stessa squadra reale di un
 * altro calciatore in rosa diminuisca, e peggiori ancora di più se in rosa abbiamo già 2 calciatori
 * della stessa squadra». La forma è sua e i valori sono DICHIARATI, non misurati - e vale la pena
 * dire contro cosa, perché una misura su questo esiste e dice una cosa diversa.
 *
 * IL BANCO MISURA `CLUB_FREE` = 2 e `CLUB_PENALTY` = 0,45: i primi DUE di un club non costano niente e
 * la penalità scatta dal TERZO (adottata il 02/09: 4,1 punti di costo contro il 4,4% di dispersione in
 * meno). La sua regola comincia un uomo prima. E c'è una ragione, misurata dall'altro lato, per cui il
 * banco non può decidere qui: la sua sd è FRA STAGIONI mentre il rischio che si compra diversificando
 * è DENTRO una (`metrica-asta-surplus-v1.md` §24) - «questo banco non può vedere il beneficio che
 * compra». Quindi la scala è la sua, dichiarata qui, e i due numeri sono cauti apposta: −10% sul
 * secondo (dove il banco non toglie niente) e −25% dal terzo (dove il banco toglierebbe il 45%).
 *
 * Il conteggio è di uomini della MIA rosa, per club reale, e non tocca il valore del giocatore: è uno
 * sconto sull'OFFERTA, cioè su quanto sono disposto a pagarlo, che è la cosa che lui ha chiesto.
 */
export const SAME_CLUB_DISCOUNT = [0, 0.1, 0.25];

export function sameClubDiscount(held: number): number {
  if (!(held > 0)) return 0;
  return SAME_CLUB_DISCOUNT[Math.min(held, SAME_CLUB_DISCOUNT.length - 1)];
}

export function offerBand(input: {
  role: Role;
  slotIndex: number;
  budget: number;
  room: number;
  points: number | null;
  medianPoints: number | null;
  exhaustedBelow?: number;
  /** `out.share`: la frazione delle giornate rimaste in cui ci sarà. Uno quando non manca. */
  available?: number;
  /**
   * OGGI NON GIOCA, con o senza una data di rientro: e' questo che fa scattare la demozione.
   *
   * Separato da `available` di proposito. Chi non ha una data e' l'uomo di cui sappiamo MENO, e
   * legarla alla quota gli avrebbe lasciato il tetto pieno del primo slot proprio per non aver detto
   * quando torna - il premio all'ignoranza, che e' il difetto opposto a quello che si stava curando.
   */
  hurt?: boolean;
  /**
   * QUANTO E' SOLIDO il numero su cui sto offrendo: 1 per una misura, meno per una stima.
   *
   * Nasce dalla domanda dell'operatore (04/09/2026): «per il primo slot io vorrei premiare calciatori
   * che ti danno comunque continuita' ... come mai ci sono Mora o Pulisic che hanno < 20 partite
   * previste?». I due casi sono diversi e solo uno e' una frase sul calciatore: **Pulisic 19,1 e' una
   * MISURA** (`basis: core`, confidenza 1 - lui salta davvero le partite), mentre **Mora 12,6 e' una
   * COSTANTE** (`basis: anchor`, confidenza 0,50, e la sua nota dice «nothing measured anywhere»),
   * cioe' «vuoto = ignoto» che prende la forma di un numero basso. Molina N. legge la sua ultima
   * stagione misurata di CINQUE anni fa (0,55) e Kolo Muani di due (0,85).
   *
   * `est_confidence` viaggia sul foglio da sempre e ogni altro lettore la applica (`worthOf`,
   * `gainOf`: «la penalita' moltiplica il numero perche' l'indeterminatezza e' un fatto sul NUMERO»).
   * La plancia era l'unica a ignorarla, quindi offriva su una costante con la stessa autorita' di una
   * misura - due letture dello stesso foglio che danno a un uomo due valutazioni.
   *
   * ENTRA NEL TETTO E NON NELL'ORDINE, ed e' una decisione. L'ordine dentro lo slot e' il valore
   * atteso, e i due numeri della riga - quanto rende una sua partita, quante ne gioca - devono
   * SPIEGARLO (sua regola, 03/09/2026): metterci dentro una confidenza li farebbe contraddire.
   * L'incertezza limita quanto sono disposto a ESPORMI, che e' la stessa forma del tetto della
   * scommessa qui sopra.
   */
  confidence?: number;
  /** Quanti uomini del SUO club reale ho già in rosa: l'offerta scende, il suo valore no. */
  sameClub?: number;
}): OfferBand | null {
  const ladder = LADDER[input.role];
  // LA DEMOZIONE PRIMA DI TUTTO: chi ha un infortunio aperto legge il gradino di sotto.
  const pricedAt = input.hurt ? input.slotIndex + HURT_SLOT_STEP : input.slotIndex;
  const share = ladder[Math.min(pricedAt, ladder.length) - 1];
  if (share == null || !(input.budget > 0)) return null;

  // The man's own weight inside his slot, held to +/-35%: the band is a fact about the SLOT and this
  // term only says where in it he stands. Letting it run free would turn a measured ceiling into a
  // ranking of our own, which is not what any of the ten windows judged.
  //
  // IL PAVIMENTO SCENDE FINO ALLA QUOTA DI CALENDARIO, e mai piu' giu': `points` porta gia' la
  // riduzione, quindi bloccarlo a 0,65 direbbe «offri il 65%» a chi gioca il 58% della stagione - un
  // tetto misurato su uomini che ci sono tutta la stagione applicato a chi non c'e'.
  const middle = input.medianPoints;
  const floor = Math.min(0.65, input.available ?? 1);
  const own =
    input.points != null && middle != null && middle > 0
      ? clamp(input.points / middle, floor, 1.35)
      : (input.available ?? 1);

  const centre =
    share *
    input.budget *
    own *
    depthFactor(input.exhaustedBelow ?? 0) *
    (1 - sameClubDiscount(input.sameClub ?? 0)) *
    clamp(input.confidence ?? 1, 0, 1);
  let low = Math.round(centre * 0.9);
  let high = Math.round(centre * 1.1);
  const room = Math.max(0, Math.round(input.room));

  // IL TETTO DELLA SCOMMESSA, e sta DOPO tutto il resto perche' non e' una correzione al valore: e' un
  // limite a quanto l'operatore e' disposto a perdere su un uomo che potrebbe non tornare quando
  // dicono. Abbassa e non alza mai - chi vale gia' meno resta dov'e'.
  const bet = (input.available ?? 1) < BET_SHARE && high > BET_CAP_HIGH * input.budget;
  if (bet) {
    low = Math.min(low, Math.round(BET_CAP_LOW * input.budget));
    high = Math.round(BET_CAP_HIGH * input.budget);
  }

  return {
    low: Math.min(low, room),
    high: Math.min(high, room),
    share: (bet ? high : centre) / input.budget,
    capped: high > room,
    overCeiling: !bet && centre / input.budget > CEILING_ALWAYS_WRONG,
    pricedAt,
    bet,
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
  /** Oggi non gioca e non si sa per quanto. Decide il verdetto prima di ogni prezzo, e non tocca la banda. */
  outNow?: boolean;
  outReason?: string | null;
  /**
   * ...e chi invece una data di rientro ce l'ha: il verdetto resta un PREZZO, perché un'asta iniziale
   * compra la stagione e non sabato, e la banda che sta giudicando è già ridotta. Quello che cambia è
   * che la ragione lo DICE: una banda più bassa senza il perché si legge come un ordinamento rotto.
   */
  out?: { until: string | null; lost: number; playable: number; seasonOver: boolean } | null;
}): LotAdvice {
  const { band, tablePrice, slotIndex, hands, teams } = input;
  const expectedPrice = Math.max(
    1,
    Math.round(input.medianFvm * discountFor(slotIndex, hands, teams)),
  );
  const waiting = worthWaiting(slotIndex, hands, teams);
  const shared = { band, hands, expectedPrice, waiting };
  // La finestra sta IN TESTA alla ragione, non in coda: è la cosa che cambia il numero, e una ragione
  // che comincia dal prezzo fa leggere il prezzo prima del perché.
  const window = !input.out
    ? ''
    : input.out.seasonOver || !input.out.until
      ? `STAGIONE FINITA per lui: non gioca nessuna delle ${input.out.lost} giornate che restano. `
      : `Fuori fino al ${itDate(input.out.until)}: gioca ${input.out.playable} giornate su ` +
        `${input.out.playable + input.out.lost}. `;
  // ...e come si e' arrivati alla cifra, quando non e' il suo gradino a deciderla.
  const priced =
    band && band.pricedAt !== slotIndex
      ? `Prezzato come uno slot ${band.pricedAt}: infortunato oggi, non lo pago da primo. `
      : '';
  const wager = band?.bet
    ? `Tetto dichiarato per una scommessa: ${band.high} crediti, non di piu'. `
    : '';
  const said = (reason: string) => window + priced + wager + reason;

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
      reason: said(
        input.role === 'D'
          ? `Oltre ${band.high} non vale: la coppia dello slot successivo rende di più.`
          : `Oltre ${band.high} gli stessi crediti comprano più di lui.`,
      ),
      ...shared,
    };
  }

  if (waiting) {
    return {
      verdict: 'aspetta',
      reason: said(
        `Slot ${slotIndex} con ${hands} rose ancora aperte: il prezzo scende, lascialo passare.`,
      ),
      ...shared,
    };
  }

  if (input.exhaustedBelow >= 2) {
    return {
      verdict: 'prendi',
      reason: said('Sotto di lui la profondità è finita: adesso vale la metà in più.'),
      ...shared,
    };
  }

  if (slotIndex <= 2) {
    return {
      verdict: 'prendi',
      reason: said('Primi due slot: non arrivano mai in saldo, aspettare vale al massimo il 20%.'),
      ...shared,
    };
  }

  return {
    verdict: 'prendi',
    reason: said(
      `Dentro la banda e sotto la mediana dello slot (${Math.round(input.medianFvm)} cr).`,
    ),
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
