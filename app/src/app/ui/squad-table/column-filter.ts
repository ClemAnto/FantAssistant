/**
 * FILTRARE UNA COLONNA: che domanda si può fare a ognuna, e quando una riga passa.
 *
 * Tutto puro e in un file suo, per la stessa ragione dell'ordinamento: il filtro NON è di nz-table.
 * `nzFilterFn` filtra `nzData`, e `nzData` sono le righe già caricate - con 60 righe di 592 a schermo,
 * «FMa ≥ 6,50» avrebbe risposto sulle prime 60 e la tabella si sarebbe riempita scorrendo, che è
 * esattamente il difetto misurato il 18/08/2026 sull'ordinamento («una lista mostrata i cui numeri
 * descrivono un'altra lista»). Quindi si filtra PRIMA di ordinare e prima di ritagliare, e le funzioni
 * che decidono stanno qui, dove un test le raggiunge senza un browser.
 *
 * TRE DOMANDE E NON UNA, perché le colonne portano tre cose diverse: una PAROLA da cercare (il nome), un
 * ELENCO da spuntare (ruolo, squadra, i codici, il gradino di titolarità) e un INTERVALLO di numeri
 * (tutte le altre). Un filtro solo, «contiene questo testo», su una colonna di fantamedie sarebbe un
 * filtro che non risponde alla domanda che si fa a una fantamedia.
 *
 * E IL VUOTO È UNA RISPOSTA, non un caso limite. Mezza tabella porta celle vuote per costruzione - un
 * arrivo da un altro campionato non ha una stagione misurata - e in questo progetto vuoto vuol dire
 * IGNOTO e mai zero. Quindi un estremo non può includerli per sbaglio (un ignoto non è «sotto il
 * minimo»: non ha un numero da confrontare) e chi vuole cercarli DEVE poterlo chiedere, perché «chi non
 * ha una stagione misurata» è una delle domande vere di un'asta.
 */

/** Come si filtra una colonna. `null` = non si filtra. */
export type FilterKind = 'text' | 'pick' | 'range';

/**
 * CHE COSA SI FA DEGLI IGNOTI, dichiarato invece che dedotto.
 *
 * `any` = il filtro non dice niente su di loro; `known` = solo chi ha il numero; `only` = solo chi non
 * ce l'ha. Con un estremo scelto, `any` e `known` fanno la stessa cosa - un ignoto non passa comunque -
 * e la differenza esiste per il caso senza estremi, che è «mostrami chi ha una curva di mercato».
 */
export type Blanks = 'any' | 'known' | 'only';

/** Il filtro di UNA colonna. Ogni campo assente = quella metà non è stata scelta. */
export interface ColumnFilter {
  /** `text`: un pezzo di parola, senza accenti e senza maiuscole. */
  text?: string;
  /** `pick`: i valori spuntati. Lista vuota = nessuna scelta, cioè tutti. */
  pick?: string[];
  /** `range`: gli estremi, ognuno opzionale, inclusivi. */
  min?: number | null;
  max?: number | null;
  blanks?: Blanks;
}

/**
 * Il valore che vuol dire «questa riga non ce l'ha», dentro un elenco da spuntare.
 *
 * Una stringa vuota e non una parola («ignoto»), perché una parola sarebbe indistinguibile da un valore
 * vero che si chiama così: i ruoli reali sono una lista di codici che arriva dal provider, e il giorno
 * che ne comparisse uno nuovo l'opzione «senza» se lo mangerebbe.
 */
export const NO_VALUE = '';

/** Vero se il filtro dice qualcosa: uno spento non deve né filtrare né accendere l'imbuto. */
export function isActive(filter: ColumnFilter | undefined): boolean {
  if (!filter) return false;
  return (
    !!filter.text?.trim()
    || (filter.pick?.length ?? 0) > 0
    || filter.min != null
    || filter.max != null
    || (filter.blanks != null && filter.blanks !== 'any')
  );
}

/** Senza accenti e senza maiuscole: «Lautaro» si trova scrivendo «lautaro», e «Højlund» con «hojlund». */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ø/gi, 'o').toLowerCase().trim();
}

export function passesText(value: string, filter: ColumnFilter): boolean {
  const wanted = fold(filter.text ?? '');
  return wanted ? fold(value).includes(wanted) : true;
}

/**
 * Passa se ALMENO UNO dei suoi valori è spuntato - perché una riga può portarne più di uno.
 *
 * Un uomo con `dc; ds` è un difensore centrale E un difensore di fascia: chiedere «i centrali» e non
 * vederlo sarebbe una risposta sbagliata a una domanda giusta. Nessun valore = `NO_VALUE`, così «senza»
 * è una spunta come le altre e non un caso a parte.
 */
export function passesPick(values: readonly string[], filter: ColumnFilter): boolean {
  const wanted = filter.pick;
  if (!wanted?.length) return true;
  const mine = values.length ? values : [NO_VALUE];
  return mine.some((one) => wanted.includes(one));
}

export function passesRange(value: number | null | undefined, filter: ColumnFilter): boolean {
  const { min, max } = filter;
  const blanks = filter.blanks ?? 'any';
  if (blanks === 'only') return value == null;
  // UN IGNOTO NON È SOTTO IL MINIMO: non ha un numero, quindi con un estremo scelto esce, e senza
  // estremi resta a meno che non gli si chieda di andarsene. È «vuoto = ignoto, mai zero», qui.
  if (value == null) return blanks === 'any' && min == null && max == null;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

/**
 * IL FILTRO IN UNA FRASE, che è metà della funzione: un filtro salvato che non si vede è un filtro che
 * la prossima sessione legge come «il listone ha dodici uomini».
 *
 * `label` traduce un valore spuntato nella parola che la tabella mostra (il ruolo per esteso, la sigla
 * del gradino), così l'etichetta sopra la tabella e la cella dicono la stessa cosa.
 */
export function describeFilter(
  kind: FilterKind,
  filter: ColumnFilter,
  label: (value: string) => string = (one) => one || 'ignoto',
): string {
  if (kind === 'text') return `contiene «${(filter.text ?? '').trim()}»`;
  if (kind === 'pick') {
    const chosen = filter.pick ?? [];
    return chosen.length > 3 ? `${chosen.length} valori` : chosen.map(label).join(', ');
  }
  const blanks = filter.blanks ?? 'any';
  if (blanks === 'only') return 'solo ignoti';
  const bounds = boundsOf(filter);
  if (!bounds) return 'solo con un numero';
  return blanks === 'known' ? `${bounds}, solo con un numero` : bounds;
}

function boundsOf(filter: ColumnFilter): string {
  const { min, max } = filter;
  if (min != null && max != null) return `${decimal(min)}–${decimal(max)}`;
  if (min != null) return `≥ ${decimal(min)}`;
  if (max != null) return `≤ ${decimal(max)}`;
  return '';
}

/** La virgola, perché la tabella scrive 6,50 e un'etichetta che scrive 6.5 parla di un'altra colonna. */
function decimal(value: number): string {
  return String(value).replace('.', ',');
}

/**
 * Quello che c'è sul disco, VALIDATO invece che creduto.
 *
 * Può essere di una versione precedente dell'app, e un filtro che non si capisce più è un filtro perso -
 * va bene; una tabella che non sa disegnare il proprio stato no. Una chiave che il codice non conosce
 * viene TENUTA e semplicemente non applicata: le colonne offerte cambiano da vista a vista, e buttarla
 * qui spegnerebbe il filtro dell'altra schermata.
 */
export function readFilters(raw: unknown): Record<string, ColumnFilter> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, ColumnFilter> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const one = readFilter(value);
    if (one) out[key] = one;
  }
  return out;
}

function readFilter(raw: unknown): ColumnFilter | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const { text, pick, min, max, blanks } = source;
  const filter: ColumnFilter = {};
  if (typeof text === 'string') filter.text = text;
  if (Array.isArray(pick)) filter.pick = pick.filter((one): one is string => typeof one === 'string');
  if (typeof min === 'number' && Number.isFinite(min)) filter.min = min;
  if (typeof max === 'number' && Number.isFinite(max)) filter.max = max;
  if (blanks === 'known' || blanks === 'only' || blanks === 'any') filter.blanks = blanks;
  return isActive(filter) ? filter : null;
}
