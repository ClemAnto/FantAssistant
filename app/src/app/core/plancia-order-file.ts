/**
 * L'ORDINE DELLA PLANCIA COME UN OGGETTO SOLO, per portarlo su un altro device.
 *
 * Richiesta dell'operatore (24/09/2026): «consenti di esportare un oggetto con l'ordinamento impostato
 * nella plancia per poterlo importare su un altro device». Nasce da un vincolo che il progetto si e'
 * scelto: l'ordine a mano e i buttati stanno in `localStorage` e non nell'indirizzo, perche' «questa
 * pagina non e' un link che si manda a qualcuno, e' il foglio su cui si segna l'asta» - e la
 * conseguenza e' che il portatile su cui si prepara l'asta e quello con cui ci si siede al tavolo non
 * sanno niente l'uno dell'altro.
 *
 * DUE COSE E NON UNA, e non e' una scelta di comodita': l'ordine a mano dice CHI viene prima, i buttati
 * dicono CHI non c'e' piu', e una lista con l'uno e senza gli altri e' una lista diversa da quella che
 * si e' preparata. Chi esporta «l'ordinamento» intende la lista che ha davanti.
 *
 * QUELLO CHE NON VIAGGIA sono le impostazioni della lega, il taglio e il set di numeri: sono tre modi di
 * GUARDARE, non il lavoro fatto, e sovrascrivere sull'altro device un regolamento dichiarato li' sarebbe
 * un'adozione silenziosa - la cosa che la modale della sessione dichiara sempre a voce alta.
 *
 * NIENTE QUI E' UNA VALUTAZIONE: sono id e basta. Il foglio sull'altro device puo' essere piu' nuovo, e
 * allora un nome che li' non esiste piu' semplicemente non trova una riga - `withRowAt` e la griglia
 * lavorano su cio' che c'e', e un id orfano non disegna niente.
 */

/** Che cos'e' questo oggetto. Un import che non lo trova RIFIUTA invece di provarci: incollare il file
 *  sbagliato deve dirlo, non svuotare una lista preparata in un'ora. */
export const ORDER_FILE_KIND = 'fantassistant.plancia.order';

/**
 * La versione del FORMATO, e non quella dell'app.
 *
 * Sale solo quando la forma cambia in modo che un lettore vecchio leggerebbe male; un lettore che trova
 * un numero piu' alto del suo si ferma e lo DICE, perche' un import che accetta un formato che non
 * conosce e' un import che perde meta' del lavoro in silenzio.
 */
export const ORDER_FILE_VERSION = 1;

export interface PlanciaOrderFile {
  kind: typeof ORDER_FILE_KIND;
  version: number;
  /** Il giorno in cui e' stato scritto: chi lo importa deve poter vedere se e' quello di stasera. */
  saved: string;
  /** L'ordine a mano, per chiave `<piattaforma>|<ruolo>` come lo store la scrive. */
  order: Record<string, number[]>;
  /** Gli id buttati, con la stessa chiave. */
  binned: Record<string, number[]>;
}

/** Quanto pesa un oggetto importato, in parole che una riga a schermo puo' dire. */
export interface OrderFileCounts {
  /** Quante liste (ruolo) portano un ordine a mano, e quanti nomi in tutto. */
  lists: number;
  names: number;
  binned: number;
}

const isIdList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((one) => typeof one === 'number' && Number.isFinite(one));

/**
 * Le liste di un oggetto grezzo, tenendo solo quelle che hanno la forma giusta.
 *
 * Una chiave con dentro qualcosa che non e' una lista di numeri viene SCARTATA e non fa fallire tutto:
 * il resto e' comunque lavoro vero, e rifiutare l'intero file per una chiave sporca costerebbe all'uomo
 * l'ora che ha passato a ordinare. Quello che invece fa fallire e' il `kind`, che dice se questo oggetto
 * e' nostro.
 */
function listsOf(raw: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isIdList(value) && value.length) out[key] = [...value];
  }
  return out;
}

/** L'oggetto da consegnare: quello che c'e' adesso, con la sua data. */
export function orderFileOf(
  order: Record<string, number[]>,
  binned: Record<string, number[]>,
  saved: string,
): PlanciaOrderFile {
  return {
    kind: ORDER_FILE_KIND,
    version: ORDER_FILE_VERSION,
    saved,
    order: listsOf(order),
    binned: listsOf(binned),
  };
}

/**
 * Un oggetto letto da fuori, o la RAGIONE per cui non si puo' leggere.
 *
 * Torna una stringa quando rifiuta, perche' quella stringa e' cio' che la pagina mostra: «non ho
 * importato niente» senza dire perche' e' indistinguibile da un bottone rotto, ed e' la stessa regola
 * per cui la plancia scrive nell'avviso il motivo di ogni assegnazione rifiutata.
 */
export function readOrderFile(text: string): PlanciaOrderFile | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'Non è un oggetto valido: manca una parentesi, o è stato incollato a metà.';
  }
  if (!raw || typeof raw !== 'object') return 'Non è un oggetto valido.';
  const file = raw as Partial<PlanciaOrderFile>;
  if (file.kind !== ORDER_FILE_KIND) {
    return "Questo oggetto non è un ordinamento della plancia: manca il suo marchio. Non ho toccato niente.";
  }
  if (typeof file.version === 'number' && file.version > ORDER_FILE_VERSION) {
    return `È stato scritto da una versione più nuova (${file.version}): aggiorna l'app prima di importarlo.`;
  }
  return {
    kind: ORDER_FILE_KIND,
    version: ORDER_FILE_VERSION,
    saved: typeof file.saved === 'string' ? file.saved : '',
    order: listsOf(file.order),
    binned: listsOf(file.binned),
  };
}

/** Quanto porta, per la frase che l'import scrive: un conto che non si vede è un import muto. */
export function countsOf(file: PlanciaOrderFile): OrderFileCounts {
  const lists = Object.values(file.order).filter((one) => one.length);
  return {
    lists: lists.length,
    names: lists.reduce((sum, one) => sum + one.length, 0),
    binned: Object.values(file.binned).reduce((sum, one) => sum + one.length, 0),
  };
}
