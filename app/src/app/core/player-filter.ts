import { PlayerFlag } from './player-status';
import { plain } from './players-store';
import { SquadMan } from './valuation-store';

/**
 * I FILTRI COMPOSTI: una proprietà, un criterio, un valore, e altri pezzi in AND o in OR.
 *
 * Richiesta dell'operatore (15/08/2026), e la forma è la sua: si sceglie una proprietà fra quelle che la
 * tabella già mostra, un criterio che dipende dal TIPO di quella proprietà (un ruolo non è «maggiore di»
 * niente), un valore fra quelli che quella proprietà può assumere, e si aggiungono altre condizioni.
 *
 * DUE REGOLE che valgono per tutto quello che c'è qui sotto:
 *
 *  - le proprietà sono ESATTAMENTE le colonne che si vedono, prese dalla stessa riga (`SquadMan`) e con
 *    la stessa etichetta. Un filtro che leggesse un numero diverso da quello stampato accanto sarebbe la
 *    solita lista i cui conti descrivono un'altra lista;
 *  - un valore che NON c'è non è mai zero. «FM > 6» non tiene chi non ha una fantamedia misurata, e
 *    «FM < 6» nemmeno: chi non ha il numero esce da entrambe le liste, perché di lui non lo sappiamo.
 *    L'unico modo per cercarlo è il criterio «vuoto».
 */

/** Che tipo di domanda si può fare a una proprietà: da qui dipendono i criteri e i valori. */
export type FieldKind = 'role' | 'club' | 'text' | 'flag' | 'number';

/** I criteri, per tipo. `empty`/`filled` valgono per tutti: «non lo sappiamo» è una domanda legittima. */
export type FilterOp = 'is' | 'not' | 'contains' | 'lt' | 'eq' | 'gt' | 'empty' | 'filled';

export const OPS_FOR: Record<FieldKind, FilterOp[]> = {
  role: ['is', 'not'],
  club: ['is', 'not'],
  flag: ['is', 'not'],
  text: ['contains'],
  number: ['gt', 'eq', 'lt', 'empty', 'filled'],
};

export const OP_LABEL: Record<FilterOp, string> = {
  is: 'è',
  not: 'non è',
  contains: 'contiene',
  lt: '<',
  eq: '=',
  gt: '>',
  empty: 'è vuoto',
  filled: 'ha un valore',
};

/** Una proprietà filtrabile: come si chiama a schermo, di che tipo è, e dove sta nella riga. */
export interface FilterField {
  key: string;
  label: string;
  kind: FieldKind;
  /** Il numero, per le proprietà numeriche. Null = non lo sappiamo, che non è zero. */
  number?: (man: SquadMan) => number | null;
  /** Il testo o la categoria, per le altre. */
  text?: (man: SquadMan) => string;
}

/**
 * Le proprietà offerte, nell'ordine in cui si leggono nella tabella.
 *
 * Le cinque letture sono il PUNTEGGIO 0-99 e non le stelline: è il numero su cui la colonna ordina, e
 * «Overall > 90» è una domanda che si può fare, mentre «Overall > 4 stelle e mezza» sarebbe una domanda
 * sull'arrotondamento.
 */
export const FILTER_FIELDS: FilterField[] = [
  { key: 'name', label: 'Nome', kind: 'text', text: (man) => man.name },
  { key: 'role', label: 'Ruolo', kind: 'role', text: (man) => man.role },
  { key: 'club', label: 'Squadra', kind: 'club', text: (man) => man.club },
  { key: 'flag', label: 'Icona', kind: 'flag' },
  { key: 'expected', label: 'P (partite attese)', kind: 'number', number: (man) => man.expected },
  { key: 'expectedFm', label: 'FM att.', kind: 'number', number: (man) => man.expectedFm },
  { key: 'expectedMv', label: 'MV att.', kind: 'number', number: (man) => man.expectedMv },
  { key: 'fvm', label: 'FVM', kind: 'number', number: (man) => man.fvm },
  { key: 'mv', label: 'MV misurata', kind: 'number', number: (man) => man.mv },
  { key: 'fm', label: 'FM misurata', kind: 'number', number: (man) => man.fm },
  { key: 'pv', label: 'Presenze misurate', kind: 'number', number: (man) => man.pv },
  { key: 'overall', label: 'Overall (0-99)', kind: 'number', number: (man) => man.rating?.overall.score ?? null },
  { key: 'votes', label: 'Voti (0-99)', kind: 'number', number: (man) => man.rating?.votes.score ?? null },
  { key: 'bonus', label: 'Bonus (0-99)', kind: 'number', number: (man) => man.rating?.bonus.score ?? null },
  { key: 'presence', label: 'Presenze (0-99)', kind: 'number', number: (man) => man.rating?.presence.score ?? null },
  { key: 'consistency', label: 'Costanza (0-99)', kind: 'number', number: (man) => man.rating?.consistency.score ?? null },
];

export const FIELD_BY_KEY = new Map(FILTER_FIELDS.map((field) => [field.key, field]));

/** Una condizione, con il modo in cui si lega alla precedente. La prima ignora il legame. */
export interface FilterClause {
  field: string;
  op: FilterOp;
  /** Il valore di confronto: un numero per le proprietà numeriche, altrimenti la categoria o il testo. */
  value: string;
  join: 'and' | 'or';
}

/** Un filtro salvato: un nome che l'operatore riconosce, e le sue condizioni. */
export interface SavedFilter {
  id: string;
  name: string;
  clauses: FilterClause[];
}

/** Una riga come la vede un filtro: i suoi numeri, e i marchi che porta. */
export interface FilterRow {
  man: SquadMan;
  flags: readonly PlayerFlag[];
}

/** Se una singola condizione è vera per quest'uomo. */
export function matchesClause(clause: FilterClause, row: FilterRow): boolean {
  const field = FIELD_BY_KEY.get(clause.field);
  if (!field) return true;   // una proprietà che non esiste più: non filtra invece di svuotare la lista

  if (field.kind === 'flag') {
    const has = row.flags.includes(clause.value as PlayerFlag);
    return clause.op === 'not' ? !has : has;
  }

  if (field.kind === 'number') {
    const value = field.number?.(row.man) ?? null;
    if (clause.op === 'empty') return value == null;
    if (clause.op === 'filled') return value != null;
    // «Vuoto = ignoto»: chi non ha il numero non entra né in «maggiore» né in «minore».
    if (value == null) return false;
    const wanted = Number(String(clause.value).replace(',', '.'));
    if (!Number.isFinite(wanted)) return true;
    if (clause.op === 'lt') return value < wanted;
    if (clause.op === 'gt') return value > wanted;
    return Math.abs(value - wanted) < 1e-9;
  }

  const text = field.text?.(row.man) ?? '';
  if (field.kind === 'text') return plain(text).includes(plain(clause.value));
  const same = plain(text) === plain(clause.value);
  return clause.op === 'not' ? !same : same;
}

/**
 * Se un uomo passa il filtro intero.
 *
 * Si valuta DA SINISTRA A DESTRA, senza precedenze: `A e B o C` è `(A e B) o C`. È la lettura che
 * corrisponde a come le condizioni sono scritte in colonna sullo schermo, e l'alternativa - dare all'AND
 * la precedenza, come fa un linguaggio - vorrebbe le parentesi per essere spiegata.
 */
export function matchesFilter(clauses: readonly FilterClause[], row: FilterRow): boolean {
  if (!clauses.length) return true;
  let out = matchesClause(clauses[0], row);
  for (const clause of clauses.slice(1)) {
    const one = matchesClause(clause, row);
    out = clause.join === 'or' ? out || one : out && one;
  }
  return out;
}
