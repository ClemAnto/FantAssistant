import {
  READINGS,
  ReadingKey,
  ReadingRef,
  WHOLE_CAREER,
  defaultSeasonOf,
  seasonsFor,
  shortSeason,
} from './strategy';

/**
 * I FILTRI DELLA STRATEGIA: una lettura, un criterio, un numero - e altri pezzi in AND.
 *
 * Richiesta dell'operatore (12/09/2026), e la forma e' la sua: «+aggiungi filtro», si sceglie il valore
 * (mv, pv, ecc.), il criterio fra `<`, `<=`, `=`, `>=`, `>`, `!=`, e un riferimento numerico; piu'
 * filtri vanno in AND; e un insieme di filtri si salva e si richiama.
 *
 * SOLO IN AND, che e' quello che ha chiesto e non una semplificazione. L'OR ha un costo che questo
 * progetto ha gia' scritto altrove (`core/player-filter.ts`): senza parentesi «A e B o C» si legge da
 * sinistra a destra e non come chiunque lo leggerebbe, quindi finche' nessuno lo chiede la pagina non
 * offre una scrittura ambigua. Con l'AND soltanto l'ordine delle condizioni non cambia la risposta, ed
 * e' questo che rende sicuro cancellarne una a meta' lista.
 *
 * LE PROPRIETA' SONO ESATTAMENTE I NUMERI CHE LA RIGA STAMPA, ed e' la regola che rende verificabile un
 * filtro a occhio: si filtra sulla stessa `ManReadings` che disegna le pastiglie, con la stessa
 * etichetta del selettore dell'ordinamento (`SORTABLE_READINGS`). Un filtro che leggesse un numero
 * diverso da quello stampato accanto sarebbe l'ennesima lista i cui conti descrivono un'altra lista.
 *
 * E «VUOTO = IGNOTO» VALE ANCHE QUI, in tutte e sei le direzioni: chi non ha il numero non passa nessun
 * criterio, nemmeno `≠`. Un uomo senza xG non e' «xG diverso da 1»: di lui non lo sappiamo, e tenerlo
 * in lista sarebbe un giudizio che nessuno ha dato. Quanti ne sono usciti lo dice la barra.
 */

/** I sei criteri che l'operatore ha dettato, nell'ordine in cui li ha scritti. */
export type CompareOp = 'lt' | 'lte' | 'eq' | 'gte' | 'gt' | 'ne';

export const COMPARE_OPS: CompareOp[] = ['lt', 'lte', 'eq', 'gte', 'gt', 'ne'];

/** Come si scrive a schermo: il SEGNO e non la parola, che e' come si legge un filtro numerico. */
export const OP_SIGN: Record<CompareOp, string> = {
  lt: '<',
  lte: '≤',
  eq: '=',
  gte: '≥',
  gt: '>',
  ne: '≠',
};

/**
 * Su cosa si puo' filtrare: una lettura, o il GAIN.
 *
 * La STAGIONE non sta qui ma accanto (`FilterClause.season`): la chiave dice QUALE numero, la stagione
 * su quale calcio, e tenerle separate e' quello che permette due condizioni sulla stessa lettura.
 */
export type FilterKey = ReadingKey | 'gain';

/**
 * Una condizione sola. Le condizioni di un filtro sono in AND, quindi non portano un legame.
 *
 * LA STAGIONE E' PARTE DELLA CONDIZIONE (operatore, 12/09/2026: «voglio filtrare i calciatori che nella
 * stagione corrente abbiano mv > 7 e nella stagione passata mv < 6»). Due condizioni sulla stessa
 * lettura e su due stagioni sono due condizioni diverse, ed e' esattamente la domanda che ha fatto:
 * senza la stagione, «mv > 7 E mv < 6» non ha soluzioni.
 *
 * `null` per il gain e per le letture del foglio, che una stagione non ce l'hanno.
 */
export interface FilterClause {
  key: FilterKey;
  season: string | null;
  op: CompareOp;
  value: number;
}

/** Un insieme salvato: un nome che l'operatore riconosce, e le sue condizioni. */
export interface FilterSet {
  id: string;
  name: string;
  clauses: FilterClause[];
}

/**
 * LE LETTURE SU CUI SI PUO' FILTRARE: quelle ordinabili, meno le PAROLE.
 *
 * Le coppie sono gia' fuori da `SORTABLE_READINGS` (stampano `12:5` e non hanno un numero dietro); qui
 * cade anche la TITOLARITA', che un numero ce l'ha ma e' il rango di un gradino, e «Tit > 3» sarebbe un
 * riferimento numerico su una scala di parole - il contrario di quello che l'operatore ha chiesto
 * («scegli riferimento (valore numerico)»). Ordinare per quella scala resta legittimo e resta
 * possibile: e' un'altra domanda. Il giorno in cui servisse filtrarla, il controllo giusto non e' una
 * casella numerica ma un elenco di gradini da spuntare.
 *
 * DERIVATO da `READINGS` e non riscritto, come l'elenco dell'ordinamento: due elenchi della stessa cosa
 * sono come una lettura nuova finisce per esistere e non essere filtrabile.
 */
export const FILTERABLE_READINGS: ReadingKey[] = READINGS
  .filter((one) => !one.pair && !one.word)
  .map((one) => one.key);

/** Una voce del menu' «valore»: la chiave, come si chiama, e con quante cifre si stampa. */
export interface FilterField {
  key: FilterKey;
  label: string;
  /** Se prende una stagione: allora la riga del filtro ne offre il menu' accanto. */
  seasonal: boolean;
  /** Le stagioni che puo' prendere, gia' con l'etichetta: `25/26`, `tutte`. Vuoto se non ne prende. */
  seasons: { value: string; label: string }[];
  /** ...e quella su cui nasce una condizione nuova: quella che la lettura dichiara. */
  season: string | null;
  /** Le cifre con cui la riga la stampa: e' la precisione a cui `=` e `≠` rispondono. Vedi `passesClause`. */
  decimals: number;
}

/**
 * QUANTE CIFRE STAMPA UN FORMATO di `DecimalPipe` (`'1.2-2'` -> 2), cioe' a che precisione quel numero
 * si LEGGE sulla riga.
 *
 * Serve solo a `=` e `≠`, e senza di lei quei due criteri sarebbero controlli che non fanno niente: una
 * fantamedia attesa vale 6,4999999 e nessuno scrivera' mai quel numero in una casella, quindi
 * un'uguaglianza sul valore grezzo non risponderebbe mai si'. Arrotondando tutt'e due i lati alla
 * precisione della pastiglia, `= 6,50` seleziona esattamente le righe che sullo schermo dicono `6,50` -
 * che e' la sola definizione di uguaglianza che un occhio possa verificare.
 */
export function decimalsOf(format: string): number {
  const parts = /\.(\d+)-(\d+)$/.exec(format);
  return parts ? Number(parts[2]) : 0;
}

/**
 * LE CIFRE DEL GAIN: due, che sono quelle con cui la riga lo stampa (`ui-gain`, `digits="2"`).
 *
 * Scritte qui e non dedotte da `READINGS`, perche' il gain non e' una lettura: e' la colonna che ordina
 * la lista e la sua forma la decide chi la disegna.
 */
export const GAIN_DECIMALS = 2;

/**
 * LE VOCI DEL MENU', nell'ordine in cui `READINGS` le dichiara, col gain in testa.
 *
 * L'etichetta del GAIN la passa chi chiama, perche' dipende dal tipo d'asta (SURPLUS o VALORE) e questo
 * modulo non ha un setup: e' la stessa ragione per cui il selettore dell'ordinamento la compone nella
 * vista.
 */
export function filterFields(
  gainLabel: string,
  seasons: { pickable: readonly string[]; target: string; input: string },
): FilterField[] {
  const known = new Set<ReadingKey>(FILTERABLE_READINGS);
  return [
    { key: 'gain', label: gainLabel, seasonal: false, seasons: [], season: null, decimals: GAIN_DECIMALS },
    ...READINGS.filter((one) => known.has(one.key)).map((one) => ({
      key: one.key as FilterKey,
      label: one.label,
      seasonal: !!one.seasonal,
      seasons: seasonsFor(one, seasons.pickable).map((season) => ({
        value: season,
        label: season === WHOLE_CAREER ? WHOLE_CAREER : shortSeason(season),
      })),
      season: one.seasonal ? defaultSeasonOf(one, seasons) : null,
      decimals: decimalsOf(one.format),
    })),
  ];
}

/** Le cifre di una chiave, dalla stessa dichiarazione: una chiave sconosciuta si stampa intera. */
export function filterDecimals(key: FilterKey): number {
  if (key === 'gain') return GAIN_DECIMALS;
  const spec = READINGS.find((one) => one.key === key);
  return spec ? decimalsOf(spec.format) : 2;
}

/**
 * SE UN NUMERO PASSA UNA CONDIZIONE. `null` non passa mai, nemmeno `≠` (vedi la nota in testa).
 *
 * `decimals` decide solo `=` e `≠`: gli altri quattro confrontano il valore vero, perche' «maggiore di
 * 6,5» su un 6,4999 e' una domanda a cui l'arrotondamento non serve e a cui si risponde comunque no.
 */
export function passesClause(clause: FilterClause, value: number | null, decimals: number): boolean {
  if (value == null || !Number.isFinite(clause.value)) return false;
  switch (clause.op) {
    case 'lt':
      return value < clause.value;
    case 'lte':
      return value <= clause.value;
    case 'gt':
      return value > clause.value;
    case 'gte':
      return value >= clause.value;
    case 'eq':
      return round(value, decimals) === round(clause.value, decimals);
    case 'ne':
      return round(value, decimals) !== round(clause.value, decimals);
  }
}

function round(value: number, decimals: number): number {
  const unit = 10 ** decimals;
  return Math.round(value * unit) / unit;
}

/**
 * SE UN UOMO PASSA IL FILTRO INTERO: tutte le condizioni, in AND.
 *
 * `valueOf` lo passa chi chiama, e non e' un dettaglio di comodo: il gain si stampa PER GIORNATA
 * (`perMatch`) mentre in memoria e' un totale di stagione, quindi un filtro che leggesse il numero
 * grezzo risponderebbe su un'unita' diversa da quella che l'operatore ha davanti - e un errore di unita'
 * e' la famiglia di difetti piu' cara di questo progetto. Chi disegna la riga sa in che unita' la
 * disegna; questo modulo no, e non deve indovinarlo.
 *
 * Un filtro vuoto passa tutti: e' lo stato in cui la pagina si apre, non un filtro che nasconde tutto.
 */
export function passesFilter(
  clauses: readonly FilterClause[],
  valueOf: (clause: FilterClause) => number | null,
): boolean {
  return clauses.every((clause) =>
    passesClause(clause, valueOf(clause), filterDecimals(clause.key)),
  );
}

/**
 * LE LETTURE CHE UN FILTRO INTERROGA.
 *
 * Quali stagioni di calcio giocato caricare dipende anche da queste e non solo dalle pastiglie accese:
 * senza, un filtro su `xG` taglierebbe la lista leggendo una colonna che nessuno ha caricato, cioe'
 * svuoterebbe ogni blocco in silenzio. E' la stessa dipendenza dichiarata da `ReadingSpec.season`, vista
 * dal lato di chi filtra.
 */
export function filterReadings(clauses: readonly FilterClause[]): ReadingRef[] {
  const out: ReadingRef[] = [];
  for (const clause of clauses) {
    if (clause.key === 'gain') continue;
    const ref = { key: clause.key as ReadingKey, season: clause.season };
    if (!out.some((one) => one.key === ref.key && one.season === ref.season)) out.push(ref);
  }
  return out;
}

/**
 * COME SI LEGGE UNA CONDIZIONE SU UN GETTONE: `Partite attese ≥ 25`.
 *
 * IL NOME PER ESTESO e non la sigla della pastiglia, ed e' una decisione: il gettone e' l'unica cosa che
 * dice cosa sta tagliando la lista, e si legge anche quando quella pastiglia in barra e' SPENTA - `Pas
 * ≥ 25` sarebbe una sigla da cercare in una legenda che in quel momento non e' a schermo.
 */
export function describeClause(clause: FilterClause, name: string): string {
  return `${name} ${OP_SIGN[clause.op]} ${round(clause.value, filterDecimals(clause.key))}`;
}

/** La stagione di una condizione come si legge su un gettone: `25/26`, o niente se non ne ha una. */
export function clauseSeason(clause: FilterClause): string {
  if (!clause.season) return '';
  return clause.season === WHOLE_CAREER ? WHOLE_CAREER : shortSeason(clause.season);
}

/**
 * QUELLO CHE C'E' SUL DISCO puo' essere di una versione precedente: si valida invece di fidarsi.
 *
 * Una condizione su una lettura che non esiste piu' (o con un criterio che non si capisce) si BUTTA, e
 * non si tiene «disattivata»: un filtro che non si puo' ne' leggere ne' spegnere taglierebbe una lista
 * senza dire perche'. Un insieme che resta senza condizioni resta comunque, col suo nome: e' una cosa
 * che l'operatore ha scritto, e un insieme vuoto lo si vede e lo si cancella.
 */
export function readClauses(raw: unknown): FilterClause[] {
  if (!Array.isArray(raw)) return [];
  const keys = new Set<string>(['gain', ...FILTERABLE_READINGS]);
  const ops = new Set<string>(COMPARE_OPS);
  return raw.flatMap((one) => {
    if (!one || typeof one !== 'object') return [];
    const { key, op, value } = one as Record<string, unknown>;
    if (typeof key !== 'string' || !keys.has(key)) return [];
    if (typeof op !== 'string' || !ops.has(op)) return [];
    if (typeof value !== 'number' || !Number.isFinite(value)) return [];
    // La stagione di una versione precedente non c'era: chi non la porta cade sul default della sua
    // lettura, che e' chi costruisce la riga a risolvere - qui resta `null`, che vuol dire «quella che
    // la lettura dichiara».
    const season = (one as Record<string, unknown>)['season'];
    return [{
      key: key as FilterKey,
      season: typeof season === 'string' && season ? season : null,
      op: op as CompareOp,
      value,
    }];
  });
}

/** ...e lo stesso per un insieme salvato: si tiene se ha un'identita' e un nome. */
export function isFilterSet(one: unknown): one is FilterSet {
  if (!one || typeof one !== 'object') return false;
  const { id, name } = one as Record<string, unknown>;
  return typeof id === 'string' && !!id && typeof name === 'string';
}

/** ...e le sue condizioni si validano come quelle in vigore: una sola definizione di «filtro leggibile». */
export function readFilterSet(one: FilterSet): FilterSet {
  return { id: one.id, name: one.name, clauses: readClauses(one.clauses) };
}
