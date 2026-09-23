/**
 * LA MIA ROSA SUL CAMPETTO, e cosa manca ancora per riempirlo.
 *
 * Richiesta dell'operatore (23/09/2026): «un campetto con i migliori 11 della tua squadra (secondo il
 * modulo 433) e a sinistra i restanti calciatori ordinati prima per ruolo e poi per moneta ... se in
 * una posizione non sono stati acquistati calciatori mostra un paio di suggerimenti realistici su chi
 * potrebbe essere acquistato, e se per una posizione occupata c'e' ancora un acquisto migliore
 * fattibile fallo comparire subito sotto».
 *
 * NIENTE QUI PREVEDE UN CALCIATORE. I numeri sono quelli della plancia, letti e mai ricalcolati; quello
 * che si deduce riguarda POSTI, CREDITI e REGOLAMENTO - lo stesso confine che mette la board di un club
 * vero nel toolkit e l'undici di una rosa fanta nell'app (`core/fanta-eleven.ts`).
 *
 * PERCHE' NON E' `fanta-eleven.ts`, che risponde a una domanda vicina e non alla stessa. Quello SCEGLIE
 * il modulo - «quale delle forme legali fa giocare l'undici piu' forte» - e prezza in `value99` sulla
 * scala del pannello d'asta; qui il modulo e' FISSATO dall'operatore e la moneta e' quella della
 * plancia. Quello che le due condividono, e che percio' non si riscrive, e' il REGOLAMENTO: i posti li
 * legge `placesIn` da `classic_modules.json`, quindi l'1-4-3-3 non e' trascritto da nessuna parte.
 *
 * DUE MONETE E DUE DOMANDE, che e' la parte da non confondere:
 *   * chi GIOCA lo decide il VALORE ATTESO (`points` = fantamedia x presenze), che e' la moneta con cui
 *     il banco draft ha misurato questo formato e la stessa che `fanta-eleven.ts` dichiara - schierare
 *     non e' comprare, e la risorsa scarsa di un undici sono i POSTI;
 *   * la panchina si ordina per RUOLO e poi per MONETA, che e' la sua istruzione, e la moneta della
 *     plancia e' il SURPLUS (`PlanciaMan.surplus`, misurato contro lo swing il 23/09/2026).
 *   Le due non si contraddicono perche' agiscono su insiemi disgiunti: dentro un ruolo, chi e' in
 *   panchina ha per costruzione meno valore atteso di chi e' in campo, quindi riordinarli per moneta
 *   non puo' mettere un uomo di panchina sopra un titolare.
 */

import { MantraModules } from './auction-value';
import { ModuleLine, placesIn } from './mantra-legal';
import { ROLES, Role } from './plancia';

/**
 * IL MODULO E' DICHIARATO DALL'OPERATORE e non scelto dal campetto: «secondo il modulo 433».
 *
 * Dichiararlo e non sceglierlo e' anche cio' che rende leggibile il confronto fra due sguardi alla
 * pagina: un campetto che cambia forma quando compro un difensore direbbe due cose insieme - chi e'
 * entrato e che lo schema e' cambiato - e nessuna delle due si vedrebbe.
 */
export const PITCH_MODULE = '4-3-3';

/** Quanti nomi in grigio sotto un posto VUOTO: «un paio», che e' la sua parola. */
export const HINTS_PER_EMPTY = 2;

/** Un posto del modulo: la riga su cui si disegna, e il macro-ruolo che lo puo' occupare. */
export interface SquadPlace {
  line: ModuleLine;
  role: Role;
}

/** Un uomo come questo campetto lo legge: la plancia ha gia' tutti e quattro i numeri. */
export interface SquadMan {
  id: number;
  name: string;
  role: Role;
  /** Fantapunti attesi sulle giornate che restano. Decide CHI GIOCA, e `null` non e' uno zero. */
  points: number | null;
  /** La moneta della plancia (il surplus): ordina la panchina. Chi non ce l'ha va in fondo. */
  coin: number | null;
}

/** ...e uno ancora nell'urna, con quello che la stanza paga per il suo slot. */
export interface UrnMan extends SquadMan {
  /**
   * QUANTO COSTERA', e non quanto sono disposto a pagarlo.
   *
   * E' `LotAdvice.expectedPrice` - la mediana del FVM dello slot scontata dall'assottigliamento
   * (`discountFor`, misurata sulle 10 aste vere a estrazione di questa lega) - e non la mia max
   * offerta, perche' la domanda qui e' «posso permettermelo» e non «quanto vale per me». Il prezzo e'
   * dello SLOT e non dell'uomo, ed e' corretto cosi': dentro uno slot il prezzo sta in 1,0-1,3 volte
   * la sua mediana (§27), che e' la stessa ragione per cui lo slot esiste.
   */
  price: number;
  /** Lo slot su cui quel prezzo e' letto: si NOMINA, invece di lasciarlo dedurre da un numero. */
  slot: string;
}

/** Un posto disegnato: chi ce l'ha, e chi si potrebbe ancora comprare per occuparlo. */
export interface PitchPlace<T extends SquadMan = SquadMan> {
  line: ModuleLine;
  role: Role;
  man: T | null;
  /**
   * I nomi in grigio: due sotto un posto vuoto, UNO sotto un posto occupato da migliorare.
   *
   * Vuoto non vuol dire «non c'e' niente da comprare»: vuol dire che nessuno di quel ruolo e' insieme
   * ancora nell'urna, alla mia portata e migliore di chi il posto ce l'ha gia'. La card lo dichiara
   * invece di lasciare una riga bianca.
   */
  hints: UrnMan[];
}

export interface PitchRow {
  line: ModuleLine;
  places: PitchPlace[];
}

export interface SquadPitch<T extends SquadMan = SquadMan> {
  module: string;
  rows: PitchRow[];
  /** Quanti degli undici posti sono occupati: a inizio asta una rosa non li riempie. */
  placed: number;
  /** I restanti, per RUOLO e poi per MONETA (sua istruzione). */
  bench: T[];
  /**
   * QUANTO POSSO METTERE SU UN UOMO tenendo un credito per ogni altro posto che mi resta da riempire.
   *
   * E' la definizione di «fattibile» di questa card, ed e' l'aritmetica del regolamento e non una
   * cautela nostra: una rosa incompleta non e' una rosa, quindi l'ultimo credito di ogni posto e'
   * impegnato. Zero quando la rosa e' piena - e allora non c'e' nessun suggerimento da dare.
   */
  spendable: number;
}

/**
 * I POSTI DEL MODULO, LETTI DAL REGOLAMENTO e mai trascritti.
 *
 * `classic_modules.json` e' CONFIGURAZIONE (`config/`, letta e mai fittata), e la legalita' classic e'
 * per MACRO-RUOLO: un posto e' un P, un D, un C o un A e basta, quindi qui non serve il matroide che
 * Mantra richiede. Vale anche il contrario, ed e' l'avvertimento dell'operatore del 10/08/2026: la
 * legalita' classic non si deduce da Mantra per analogia. Per questo un posto che accetta PIU' di un
 * ruolo fa tornare una lista VUOTA invece di essere piegato a uno solo - vorrebbe dire che a questa
 * funzione e' stato passato l'altro regolamento, e disegnare comunque sarebbe disegnare un undici di
 * un gioco diverso sotto lo stesso nome.
 */
export function classicPlaces(rules: MantraModules | null, module = PITCH_MODULE): SquadPlace[] {
  if (!rules?.modules?.[module]) return [];
  const out: SquadPlace[] = [];
  for (const place of placesIn(rules, module)) {
    if (place.roles.length !== 1) return [];
    const role = place.roles[0].toUpperCase() as Role;
    if (!ROLES.includes(role)) return [];
    out.push({ line: place.line, role });
  }
  return out;
}

/**
 * Il campetto, la panchina e i suggerimenti, in una passata sola.
 *
 * `freeSlots` sono i posti di ROSA ancora liberi per ruolo, e non i posti del campetto: un
 * suggerimento in un ruolo gia' pieno e' un acquisto che il regolamento rifiuta, e una card che lo
 * propone manda l'operatore a fare un'offerta che il tavolo non gli lascerebbe chiudere.
 */
export function squadPitchOf<T extends SquadMan>(input: {
  mine: readonly T[];
  urn: readonly UrnMan[];
  places: readonly SquadPlace[];
  freeSlots: Record<Role, number>;
  credits: number;
  hintsPerEmpty?: number;
}): SquadPitch<T> {
  const left = ROLES.reduce((sum, role) => sum + Math.max(0, input.freeSlots[role] ?? 0), 0);
  // Un credito per ogni ALTRO posto: con la rosa piena non si compra nessuno, e zero e' la risposta.
  const spendable = left > 0 ? Math.max(0, Math.round(input.credits) - (left - 1)) : 0;

  // CHI GIOCA: il valore atteso, e i pareggi li rompe la moneta e poi l'id - due disegni della stessa
  // rosa devono dare lo stesso undici, che e' la determinatezza che `buildMap` deve al mercato.
  const pool = new Map<Role, T[]>();
  for (const role of ROLES) pool.set(role, []);
  for (const man of input.mine) pool.get(man.role)?.push(man);
  for (const role of ROLES) pool.get(role)!.sort(byStrength);

  const taken = new Map<Role, number>();
  const holders = input.places.map((place) => {
    const at = taken.get(place.role) ?? 0;
    const man = pool.get(place.role)?.[at] ?? null;
    if (man) taken.set(place.role, at + 1);
    return man;
  });

  const onPitch = new Set(holders.filter((man): man is T => !!man).map((man) => man.id));
  // LA PANCHINA: per RUOLO e poi per MONETA, che e' la sua istruzione. L'ordine dei ruoli e' quello in
  // cui la rosa li dichiara (`ROLES`), lo stesso che la plancia disegna dall'alto in basso: due ordini
  // dei quattro reparti sulla stessa pagina si leggerebbero come due pagine.
  const bench = input.mine
    .filter((man) => !onPitch.has(man.id))
    .sort(
      (a, b) =>
        ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || coinOf(b) - coinOf(a) || a.id - b.id,
    );

  const hints = hintsByPlace({
    places: input.places,
    holders,
    urn: input.urn,
    freeSlots: input.freeSlots,
    spendable,
    perEmpty: input.hintsPerEmpty ?? HINTS_PER_EMPTY,
  });

  const rows: PitchRow[] = [];
  input.places.forEach((place, at) => {
    const row = rows.at(-1);
    const entry: PitchPlace<T> = {
      line: place.line,
      role: place.role,
      man: holders[at],
      hints: hints[at],
    };
    if (row?.line === place.line) row.places.push(entry);
    else rows.push({ line: place.line, places: [entry] });
  });

  return {
    module: input.places.length ? PITCH_MODULE : '',
    rows,
    placed: onPitch.size,
    bench,
    spendable,
  };
}

/**
 * CHI COMPREREI PER OGNI POSTO, con una passata sola per ruolo e senza mai proporre due volte lo
 * stesso uomo.
 *
 * I posti di un ruolo arrivano in ordine di forza (il riempimento e' avido, quindi il primo posto ha
 * l'uomo migliore e i vuoti stanno in coda) e i candidati pure, quindi un solo indice basta: si prova
 * il candidato migliore sul posto piu' forte, e se non lo batte si scende di posto tenendo lo stesso
 * candidato - perche' un uomo che non batte il mio primo difensore puo' benissimo battere il quarto.
 *
 * DUE ASSENZE CHE NON SONO UNO ZERO, e tutt'e due tolgono il suggerimento invece di inventarlo: un
 * candidato che il foglio non prezza non e' «migliore» di nessuno, e un uomo in campo che il foglio
 * non prezza non e' peggiore di nessuno. Sul primo si tacerebbe comunque; sul secondo la card
 * preferisce non dire niente piuttosto che dire «compra al posto suo» su un confronto che non esiste.
 */
function hintsByPlace(input: {
  places: readonly SquadPlace[];
  holders: readonly (SquadMan | null)[];
  urn: readonly UrnMan[];
  freeSlots: Record<Role, number>;
  spendable: number;
  perEmpty: number;
}): UrnMan[][] {
  const out: UrnMan[][] = input.places.map(() => []);
  const byRole = new Map<Role, UrnMan[]>();
  for (const role of ROLES) {
    // FATTIBILE E' UNA CONGIUNZIONE DI DUE COSE, e nessuna delle due e' un'opinione: un posto di rosa
    // libero in quel ruolo (il regolamento) e un prezzo che la borsa copre (l'aritmetica).
    const free = (input.freeSlots[role] ?? 0) > 0;
    byRole.set(
      role,
      free
        ? input.urn
            .filter(
              (man) => man.role === role && man.points != null && man.price <= input.spendable,
            )
            .sort(byStrength)
        : [],
    );
  }

  const next = new Map<Role, number>();
  input.places.forEach((place, at) => {
    const holder = input.holders[at];
    if (holder && holder.points == null) return;
    const queue = byRole.get(place.role) ?? [];
    const want = holder ? 1 : input.perEmpty;
    let cursor = next.get(place.role) ?? 0;
    while (out[at].length < want && cursor < queue.length) {
      const candidate = queue[cursor];
      // Su un posto occupato il candidato deve BATTERLO, o non e' «un acquisto migliore»; su un posto
      // vuoto chiunque lo e', perche' l'alternativa e' un buco.
      if (holder && !((candidate.points ?? 0) > (holder.points ?? 0))) break;
      out[at].push(candidate);
      cursor += 1;
    }
    next.set(place.role, cursor);
  });

  return out;
}

/** L'ordine di chi gioca: valore atteso, poi moneta, poi id. Chi non ha un numero va in fondo. */
function byStrength(a: SquadMan, b: SquadMan): number {
  return pointsOf(b) - pointsOf(a) || coinOf(b) - coinOf(a) || a.id - b.id;
}

function pointsOf(man: SquadMan): number {
  return man.points ?? Number.NEGATIVE_INFINITY;
}

function coinOf(man: SquadMan): number {
  return man.coin ?? Number.NEGATIVE_INFINITY;
}
