/**
 * A real club's eleven, read from the board the TOOLKIT drew - not computed here.
 *
 * The board comes from `modules/boards.py`, which drives the panel's own class headless and calls the real
 * `board_shape` / `eleven` / `lanes_for` / `_placed`, with the operator's shape rulings applied. So the pitch
 * in this app and the pitch on the panel are the same call: there is no second eleven anywhere, which is the
 * whole point - the 08/08/2026 defect was a harness whose population differed from the screen's.
 *
 * What this file does is only READING it: turn the module's numbers into rows, join each man to the live
 * listone (so a man already taken can be faded), and report where the two disagree instead of hiding it.
 *
 * THE MODULE IS THE DRAWING, and it is the operator's own rule (10/08/2026): every number is how many men
 * stand on that line; the keeper is never one of them and always occupies one slot in front of the defence;
 * three numbers are defence / midfield / attack; four are defence / midfield / TREQUARTI / attack, and the
 * last is always the attack.
 */

import { Board, BoardMan } from './bundle';
import { BOARD_EFFECT, RulingBoard } from './player-rulings';
import { Titolarita, isTitolarita } from './titolarita';

/** The lines a pitch draws, from the GOAL down to the attack: the keeper at the top. */
export type PitchLine = 'A' | 'T' | 'M' | 'D' | 'P';

/**
 * The order the rows are drawn in, and it is the operator's (10/08/2026): the keeper at the TOP and the
 * forwards at the bottom - the team attacking downward, the way he reads a formation.
 *
 * It is only the drawing. The module's numbers are unchanged and still count from the defence up (`4-3-3` is
 * four defenders, three midfielders, three forwards, keeper never one of them): `lineCounts` reads the string,
 * this decides which end of the page each line lands on.
 */
export const DRAW_ORDER: PitchLine[] = ['P', 'D', 'M', 'T', 'A'];

export interface PitchMan {
  fcId: number | null;
  name: string;
  /** The granular REAL role codes, which is what says a left back is not a centre back. */
  codes: string[];
  /** The LISTONE's own role(s): what the game scores by, and what a bid is made against. */
  mantra: string[];
  /**
   * The ONE role he wears in this module, named by the panel (`Td`, `Dc`, `C`, `Pc`, ...).
   *
   * This is what the pitch shows, and showing his whole code list instead was the operator's correction of
   * 10/08/2026: a man drawn at right back is a `Td` there, and printing `DR;DC` says two jobs where the
   * module gave him one. Null on a board built before the marker travelled.
   */
  badge: string | null;
  /** The season's total minutes, on his own championship's calendar. Kept for the tooltip. */
  minutes: number | null;
  /** The matches he PLAYED, which is the denominator of the average below. */
  matches: number | null;
  /**
   * MINUTI MEDI A PARTITA, and this is the number the pitch shows (operator, 10/08/2026): minutes over the
   * matches he played, so «gioca poco» reads as «45′» and not as a season total nobody can compare at a
   * glance. Null when either half is missing - unknown, never zero.
   */
  perMatch: number | null;
  /**
   * ...E LO STESSO NUMERO PER LA STAGIONE CHE VIENE, che è quello che il campetto stampa dal 19/08/2026.
   *
   * Letto dalla board e mai ricalcolato qui (`engine/minutes.py`, con la misura che l'ha adottato: +7,5% e
   * +7,6% di errore su due finestre retrodatate contro il mostrare la media dell'anno scorso invariata).
   * È una PREVISIONE e quello sopra è una MISURA: il tooltip li nomina tutt'e due, perché una cifra nuda
   * che cambia natura è la trappola che questa carta ha già pagato una volta. Null = ignoto, mai zero -
   * una board scritta prima della colonna non ne ha una.
   */
  minutesNext: number | null;
  /**
   * A DIFFERENT quantity, and the two must not be confused: the sheet's own `minutes per club match` over the
   * last-ten window, which divides by the CLUB's matches and therefore folds absences in (Di Lorenzo 44.7
   * against 88 of the season average). It stays in the tooltip, labelled, and never on the chip.
   */
  minutesPerClubMatch: number | null;
  /** The panel's own claim: who starts when everybody is fit. It is what put him on the pitch. */
  claim: number | null;
  /**
   * ...and the ENGINE's own answer about the same man: the share of the calendar it expects him to be
   * RATED in. Null when the sheet cannot price him, which is «ignoto» and never «non gioca».
   */
  expectedShare: number | null;
  /** Where the two disagree by more than `BOARD_ENGINE_GAP`. Null = they agree, or one is missing. */
  disagreement: BoardDisagreement | null;
  /** Where the panel draws him across the line: 0 is one touchline, 1 the other. Flanks already ordered. */
  x: number;
  /** Already off the board at this table. */
  taken: boolean;
  /** What the table asks for him, from the LIVE listone - the board does not carry a price. */
  price: number | null;
  /** In the live listone at all: a man the board draws and the session does not have cannot be bought. */
  onTable: boolean;
  /** The 0-99 worth, on the scale of the whole session listone so it means one thing all evening. */
  value99: number | null;
  /** Il ruolo di listone CLASSIC (`P`/`D`/`C`/`A`), l'altra metà dell'interruttore dei ruoli. */
  classic: string | null;
  /**
   * L'OVERALL 0-99 della tabella Giocatori, che è il numero che il campetto mostra dal 18/08/2026.
   *
   * Non è il «valore» dell'asta e non è il Lead: è «quanto vale in assoluto», la stessa colonna che si
   * legge fra i Calciatori, così un uomo non porta due giudizi diversi in due schermate. Null quando il
   * foglio non lo valuta: ignoto, mai zero.
   */
  overall: number | null;
  /**
   * I MINUTI ATTESI PER PARTITA DEL CLUB: la quota di calendario che il motore gli prevede per i minuti
   * che fa QUANDO gioca (scelta dell'operatore, 18/08/2026, fra tre numeri veri).
   *
   * Nel bundle non esiste una colonna di minuti previsti, quindi questo è un prodotto DICHIARATO di due
   * numeri pubblicati - `engine_pv_pred / giornate` per `desc_minutes_full_season / desc_season_matches` -
   * e va letto come «quanti minuti ti aspetti da lui in una partita qualunque del suo club», assenze
   * comprese. Ignoto se manca una delle due metà, mai zero.
   */
  expectedMinutes: number | null;
  /**
   * IL GRADINO CHE L'OPERATORE HA DICHIARATO SU DI LUI, o null: la sua dritta
   * (`core/player-rulings.ts`, 07/09/2026).
   *
   * Sta sulla riga perche' il campetto lo DEVE dire: un uomo entrato nell'undici per una dichiarazione
   * e uno scelto dal modello sono due cose diverse, e un disegno che le mostra uguali fa credere che il
   * modello abbia cambiato idea. Le tre parole di `BOARD_EFFECT` dicono cosa quella dichiarazione fa
   * qui; la parola intera resta la SUA, cosi' la sigla accanto al nome e' la stessa della tabella.
   */
  ruled: Titolarita | null;
  /**
   * IL PADRONE DEL SUO POSTO STA RIENTRANDO, quindi la board dell'ULTIMO PERIODO lo tiene a
   * `ballottaggio` (regola dell'operatore, 10/09/2026, `engine/status.py`).
   *
   * Sta sulla riga per la stessa ragione di `ruled`: il campetto lo DEVE dire. Un uomo che gioca da tre
   * partite e legge `ballottaggio` accanto a una quota di 0,90 sembra un ordinamento rotto finché non si
   * sa che quel posto è di un altro che torna fra poco — «un vincolo che agisce in silenzio è
   * indistinguibile da un ordinamento rotto». Null/assente sulla board di STAGIONE, dove la regola non
   * esiste: confronta le due board, e lì non c'è niente da confrontare.
   */
  ownerReturning: boolean | null;
  /**
   * QUANTE DELLE ULTIME PARTITE DEL SUO CLUB la finestra corta l'ha visto GIOCARE, e su quante era
   * disponibile. Null dove la board non li porta: ignoto, mai zero.
   *
   * Servono a una cosa sola e necessaria: su un campetto che si chiama «ultimo periodo», un uomo che
   * quel periodo non ha giocato va detto. La sua quota lì viene dalla STAGIONE — una finestra vuota
   * restituisce il prior intatto — quindi senza questi due numeri sarebbe disegnato come chiunque altro.
   */
  recentPlayed: number | null;
  recentAvailable: number | null;
  /** At most two, in the panel's own order. */
  duels: PitchMan[];
  /** False when his granular real role is unknown: then the duels are UNKNOWN, not absent. */
  duelsKnown: boolean;
}

export interface PitchRow {
  line: PitchLine;
  /** How many men the MODULE puts on this line. */
  wanted: number;
  men: PitchMan[];
}

export interface Pitch {
  /** The module the drawn men actually form - the numbers this pitch is built from. */
  module: string;
  /** The module the fit was solved on, when it differs: a transformation split a row. */
  solvedOn: string | null;
  /** What the club usually plays, and how likely the drawn one was, so the picture can be doubted. */
  typical: string | null;
  coach: string | null;
  newCoach: boolean;
  why: string | null;
  odds: { shape: string; p: number }[];
  rows: PitchRow[];
  taken: number;
  /**
   * QUANTI BALLOTTAGGI IL CAMPETTO NON MOSTRA, e per quale delle due ragioni - un filtro silenzioso è un
   * filtro che inganna, ed è la stessa regola del conteggio delle righe pigre («il conteggio non deve
   * mentire»). `floor` sono i rivali sotto `PITCH_CLAIM_FLOOR`, `duplicate` quelli che il pannello aveva
   * messo su due posti e che si vedono su uno solo.
   */
  hiddenDuels: { floor: number; duplicate: number };
  /** Where the module's numbers and the drawn men disagree. Shown, never smoothed over. */
  problems: string[];
}

/**
 * The module's numbers as the LINES they are, keeper excluded.
 *
 * The same function exists in the toolkit (`boards.counts_of`) because both sides have to agree on what a
 * module string means; they are checked against each other by the fact that a mismatch is REPORTED - if the
 * two ever read a string differently, `problems` says so on the club it happens to.
 */
export function lineCounts(picture: string | null | undefined): Record<PitchLine, number> | null {
  if (!picture) return null;
  const numbers = String(picture)
    .split('-')
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
    .map((part) => Number(part));
  if (numbers.length === 3) {
    return { P: 1, D: numbers[0], M: numbers[1], T: 0, A: numbers[2] };
  }
  if (numbers.length === 4) {
    return { P: 1, D: numbers[0], M: numbers[1], T: numbers[2], A: numbers[3] };
  }
  return null;
}

/**
 * The granular code a drawn PLACE asks for, best first - the reading that says «in the typical eleven he
 * plays THERE».
 *
 * It is a vocabulary and not a measurement: the panel names a place with its own marker (`Td`, `Dc`, `C`,
 * `Pc`, `Sp`) and the provider names a man with the twelve codes, and this is the correspondence between
 * the two, keyed by the LINE because the same marker means different jobs on different rows - `Td` in the
 * defence is a terzino destro, `Td` on the trequarti is a trequartista drawn on the right.
 *
 * Where none of a man's codes appears in the list, nothing is marked: he is drawn off every role he has
 * been measured in, which is worth seeing rather than papering over.
 */
export function placeCodes(line: PitchLine, badge: string | null): string[] {
  const marker = (badge ?? '').trim().toLowerCase();
  const side = /d$/.test(marker) && marker !== 'd' ? 'right' : /s$/.test(marker) ? 'left' : 'centre';
  switch (line) {
    case 'P':
      return ['GK'];
    case 'D':
      if (side === 'right') return ['DR', 'MR', 'RW'];
      if (side === 'left') return ['DL', 'ML', 'LW'];
      return ['DC'];
    case 'M':
      if (side === 'right') return ['MR', 'DR', 'RW'];
      if (side === 'left') return ['ML', 'DL', 'LW'];
      // A mediano and a centrale are one row apart on the grid the twelve codes live on, and the panel
      // spells both `M`/`C`: the central codes answer for both, deepest job first.
      return ['MC', 'DM', 'AM'];
    case 'T':
      if (side === 'right') return ['RW', 'AM', 'MR'];
      if (side === 'left') return ['LW', 'AM', 'ML'];
      return ['AM', 'MC', 'ST'];
    case 'A':
      if (side === 'right') return ['RW', 'ST', 'AM'];
      if (side === 'left') return ['LW', 'ST', 'AM'];
      // `Pc` and `Sp` are both centre-forwards to the provider: there is no second-striker code at all.
      return ['ST', 'AM'];
  }
}

/** Which of HIS codes the place he is drawn in asks for, or null when none of them does. */
export function occupiedCode(
  line: PitchLine,
  badge: string | null,
  codes: readonly string[],
): string | null {
  const his = new Set(codes.map((code) => code.trim().toUpperCase()));
  return placeCodes(line, badge).find((code) => his.has(code)) ?? null;
}

const int = (value: string | null | undefined): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** What the live table knows about a man the board drew: whether he is gone, what he costs, what he is worth. */
export interface OnTable {
  taken: boolean;
  price: number | null;
  onTable: boolean;
  /** His worth on the 0-99 scale of THIS session's listone. Null when the sheet cannot price him. */
  value99: number | null;
  /** L'OVERALL 0-99 della tabella Giocatori: il numero che il campetto mostra accanto al nome. */
  overall?: number | null;
  /**
   * The share of the calendar the ENGINE expects him to be rated in (`engine_pv_pred / matchdays`, or
   * his declared estimate). Optional: a caller that has no sheet in hand passes nothing and no
   * disagreement is ever marked, which is «ignoto» and not «d'accordo».
   */
  expectedShare?: number | null;
}

/**
 * WHICH OF THE TWO MODELS IS THE OPTIMISTIC ONE about a man the board puts on the pitch.
 *
 * `board` = the claim is the higher number: the panel gives him the shirt and the engine expects him in
 * clearly fewer rounds. `engine` = the other way: the board keeps him low - often it simply had nobody
 * better for that place - while the engine expects him rated in far more of the calendar.
 */
export type BoardDisagreement = 'board' | 'engine';

/**
 * How far apart the two have to be before the pitch says so: a FIFTH of the calendar.
 *
 * THE TWO ARE NOT THE SAME QUESTION and neither is being corrected here (operator's decision,
 * 17/08/2026). `claim` is `presence.py`'s standing - «chi parte titolare quando stanno tutti bene» - and
 * `engine_pv_pred` is «in quante giornate prenderà un voto», which a substitute also collects. So they
 * are allowed to differ; what is NOT allowed is a card that shows an eleven and prices those same men on
 * a forecast that contradicts it without a word, which is the defect `presence.py` names about itself:
 * «una board che non disegna nessuno dove il motore prevede qualcuno sono due risposte a una domanda».
 *
 * The number is a DISPLAY choice like the two injury thresholds, declared here and owned by no gate -
 * but it is measured rather than picked: over the drawn men of the shipped bundle (17/08/2026) the gap
 * |claim − quota| has median 0.07 and p90 0.20 on euro, median 0.05 and p90 0.14 on Serie A. At 0.20 the
 * mark lands on 10% of the euro eleven (about one man per club) and 3% on Serie A - rare enough to mean
 * something. At 0.15 it would be one man in five, which is a decoration.
 */
export const BOARD_ENGINE_GAP = 0.2;

/**
 * SOTTO QUESTA QUOTA DA TITOLARE un BALLOTTAGGIO non si mostra (operatore, 18/08/2026: «se non ci sono
 * ballottaggi accetta qualsiasi claim; nel caso di ballottaggi scarta quelli sotto il 0,20»).
 *
 * Vale sui RIVALI e non sul titolare: l'undici disegnato resta di undici uomini - un posto vuoto sarebbe
 * una board diversa da quella del toolkit, che è la cosa che questo file non fa - mentre un rivale con
 * otto centesimi di quota da titolare è rumore su una carta che si legge in due secondi.
 *
 * Misurato sulle board del bundle (17/08/2026) prima di scegliere la soglia, su 610 rivali di euro:
 * a 0,20 se ne scartano 95 e 40 posizioni su 357 restano senza ballottaggio; a 0,30 sarebbero 161 e 72
 * (un ballottaggio vero su quattro sparirebbe), a 0,15 solo 62 - il decimo percentile dei rivali sta a
 * 0,145, quindi taglierebbe appena la coda. Come le due soglie degli infortuni: è una scelta di
 * VISUALIZZAZIONE, nessun gate la possiede, e sta scritto qui perché il prossimo lettore non la prenda
 * per una misura.
 */
export const PITCH_CLAIM_FLOOR = 0.2;

/** Which of the two is the optimist, when they are far enough apart to be worth saying. */
export function disagreementOf(
  claim: number | null,
  expectedShare: number | null,
  gap = BOARD_ENGINE_GAP,
): BoardDisagreement | null {
  if (claim == null || expectedShare == null) return null;
  const difference = claim - expectedShare;
  if (Math.abs(difference) < gap) return null;
  return difference > 0 ? 'board' : 'engine';
}

/**
 * The sentence a disagreement is written as - ONE of them, read by both pitches.
 *
 * It names the two questions rather than declaring a winner, because neither model is being corrected:
 * the reader is the one who decides which of the two he is buying on.
 */
export function disagreementHint(man: PitchMan): string | null {
  if (!man.disagreement || man.claim == null || man.expectedShare == null) return null;
  const claim = `${Math.round(man.claim * 100)}%`;
  const share = `${Math.round(man.expectedShare * 100)}%`;
  return man.disagreement === 'board'
    ? `i due modelli non sono d'accordo: la board gli dà la maglia (parte titolare nel ${claim} delle `
      + `giornate) e il motore lo prevede a voto nel ${share} — la board risponde a «chi parte dall'inizio», `
      + `il motore a «in quante giornate prende un voto», che è la titolarità qui, e un subentrato il voto `
      + `lo prende`
    : `i due modelli non sono d'accordo: il motore lo prevede a voto nel ${share} delle giornate e la `
      + `board lo tiene al ${claim} da titolare — spesso vuol dire che per quel posto non aveva nessuno `
      + `di meglio, non che quel posto è suo`;
}

/**
 * I MODULI FRA CUI SI PUÒ PASSARE, il disegnato compreso e in ordine di probabilità.
 *
 * Vengono dal TOOLKIT (`boards.ALTERNATIVE_MIN_ODDS`, sopra il 30%): l'app non calcola nessun undici di un
 * club vero, quindi se il bundle non li porta la lista ha un elemento solo e i tastini non compaiono - che
 * è il comportamento di prima e non un errore.
 */
export function shapesOf(board: Board | null): { shape: string; picture: string; p: number | null }[] {
  if (!board) return [];
  const drawn = board.board_shape ?? board.picture ?? '';
  const odds = board.odds ?? {};
  const out = [{ shape: drawn, picture: board.picture ?? drawn, p: odds[drawn] ?? null }];
  for (const [shape, one] of Object.entries(board.alternatives ?? {})) {
    out.push({ shape, picture: one.picture ?? shape, p: one.p ?? odds[shape] ?? null });
  }
  return out.sort((left, right) => (right.p ?? 0) - (left.p ?? 0));
}

/** Chi risponde «che dritta c'e' su quest'uomo»: la pagina la passa, il campetto non la va a prendere. */
export type RulingLookup = (fcId: number) => Titolarita | null;

function toMan(man: BoardMan, resolve: (man: BoardMan) => OnTable, ruling?: RulingLookup): PitchMan {
  const live = resolve(man);
  const expectedShare = live.expectedShare ?? null;
  const declared = man.fc_id != null && ruling ? ruling(man.fc_id) : null;
  return {
    ruled: isTitolarita(declared) ? declared : null,
    // Letto e basta: la regola l'ha applicata il toolkit, che è il solo posto che ha in mano tutt'e due
    // le board. Riderivarla qui sarebbe una seconda risposta a «di chi è questo posto».
    ownerReturning: man.owner_returning ?? null,
    recentPlayed: int(man.recent_played),
    recentAvailable: int(man.recent_available),
    fcId: man.fc_id ?? null,
    name: man.name ?? '—',
    codes: (man.codes ?? '').split(';').map((code) => code.trim()).filter(Boolean),
    mantra: (man.mantra ?? '').split(';').map((code) => code.trim()).filter(Boolean),
    badge: man.badge ?? null,
    minutes: int(man.minutes),
    matches: int(man.matches),
    perMatch: (() => {
      const minutes = int(man.minutes);
      const matches = int(man.matches);
      return minutes != null && matches ? Math.round(minutes / matches) : null;
    })(),
    // Letto e basta: nessuna aritmetica su un numero che il toolkit ha già deciso, o sarebbero due
    // definizioni dello stesso minuto.
    minutesNext: man.minutes_next ?? null,
    minutesPerClubMatch: man.minutes_per_match != null && man.minutes_per_match !== ''
      ? Number(man.minutes_per_match) : null,
    classic: man.classic ?? null,
    overall: live.overall ?? null,
    claim: man.claim ?? null,
    expectedShare,
    expectedMinutes: (() => {
      const minutes = int(man.minutes);
      const matches = int(man.matches);
      const perMatch = minutes != null && matches ? minutes / matches : null;
      return expectedShare == null || perMatch == null ? null : Math.round(expectedShare * perMatch);
    })(),
    disagreement: disagreementOf(man.claim ?? null, expectedShare),
    x: typeof man.x === 'number' ? man.x : 0.5,
    taken: live.taken,
    price: live.price,
    onTable: live.onTable,
    value99: live.value99,
    duels: (man.duels ?? []).map((rival) => toMan(rival, resolve, ruling)),
    duelsKnown: man.duels_known !== false,
  };
}

/**
 * UN UOMO IN BALLOTTAGGIO SU UN POSTO SOLO, E I POSTI DI UNA LINEA CON UN NUMERO SIMILE DI ALTERNATIVE.
 *
 * Due richieste dell'operatore nello stesso giorno (18/08/2026), e la seconda ha riscritto la prima.
 * «Non voglio che un calciatore compaia in ballottaggio in più di un item» - il pannello calcola i rivali
 * POSTO per posto, e un vice che copre due maglie compare due volte: misurato sulle board del bundle,
 * **171 voci di ballottaggio su 610** sono ripetizioni su euro (35 club su 37) e 104 su 371 su Serie A
 * (tutti e 20 i club). Poi: «riesci a distribuire i giocatori in ballottaggio in maniera più saggia? fai
 * una valutazione sui ruoli REALI e se possibile evitiamo posizioni con tanti calciatori in alternativa e
 * posizioni senza alternative».
 *
 * PERCHÉ LA PRIMA REGOLA DA SOLA SBILANCIAVA. Toglieva i doppioni scegliendo un posto alla volta, quindi il
 * quarto e il quinto rivale finivano dove finiva il terzo: l'Atalanta del bundle disegnava i due centrali di
 * riserva TUTT'E DUE sul posto del terzino sinistro e lasciava i due `Dc` senza nessuno, mentre un mancino
 * stava in ballottaggio a DESTRA perché era lì che il toolkit l'aveva elencato. Una scelta per uomo non può
 * vedere quel disegno: è un'ASSEGNAZIONE e va risolta come tale - la stessa forma del `_matching` ungherese
 * con cui il pannello assegna l'undici ai posti del modulo.
 *
 * COSA COSTA COSA, e sono tutte scelte di visualizzazione dichiarate qui, che nessun gate possiede:
 *
 *   1. il FIT sul ruolo REALE, che è il termine dominante: quanto in giù nella lista di codici che il posto
 *      chiede (`placeCodes`, già in ordine di preferenza) sta il primo codice che l'uomo ha, e a pari posto
 *      quanto in su nella lista SUA sta quel codice - un vice terzino destro è un ballottaggio a destra, e
 *      un uomo che il posto non chiede affatto paga `DUEL_MISS`;
 *   2. la FOLLA: il secondo uomo su un posto costa `DUEL_CROWD`, il terzo il doppio. È un prezzo convesso,
 *      che è il modo di dire «meglio uno e uno che due e zero» senza vietare niente;
 *   3. lo SPOSTAMENTO: un posto che il toolkit non gli aveva elencato costa `DUEL_OFF_PLACE`. Può succedere
 *      - è quello che porta il mancino a sinistra - ma solo dentro la SUA linea e solo se il ruolo reale lo
 *      giustifica: nessun ballottaggio viene inventato, si sceglie fra i posti di una riga dove il toolkit
 *      lo aveva già messo in discussione.
 *
 * Il tetto della folla non c'è: un rivale che il toolkit ha dichiarato si vede sempre da qualche parte,
 * perché nasconderlo sarebbe peggio che disegnarne tre su un posto.
 */
export const DUEL_CROWD = 4;
export const DUEL_OFF_PLACE = 1;
const DUEL_MISS = 12;

/** Il prezzo di quel rivale su quel posto, folla esclusa: solo il ruolo reale e lo spostamento. */
function duelFit(line: PitchLine, badge: string | null, rival: PitchMan, listed: boolean): number {
  const asked = placeCodes(line, badge);
  const his = rival.codes.map((code) => code.trim().toUpperCase());
  const at = asked.findIndex((code) => his.includes(code));
  const moved = listed ? 0 : DUEL_OFF_PLACE;
  if (at < 0) return DUEL_MISS + moved;
  return at * 4 + Math.max(his.indexOf(asked[at]), 0) + moved;
}

/** Quanto costa aggiungere un uomo a un posto che ne ha già `taken`: convesso, e zero per il primo. */
const crowd = (taken: number): number => taken * DUEL_CROWD;

/** Il posto più conveniente per un uomo, folla compresa. A pari costo vince quello dove già sta e poi il
 *  primo nell'ordine di disegno: due riletture della stessa board devono dare la stessa board. */
function bestPlace(cost: number[], taken: number[], current: number): number {
  let best = current;
  let price = cost[current] + crowd(taken[current]);
  for (let place = 0; place < cost.length; place += 1) {
    const here = cost[place] + crowd(taken[place]);
    if (here < price - 1e-9) {
      price = here;
      best = place;
    }
  }
  return best;
}

function spreadDuels(rows: PitchRow[]): { floor: number; duplicate: number } {
  const counted = { floor: 0, duplicate: 0 };
  /** I posti dell'undici, in fila: l'assegnazione è UNA per tutto il campetto e non una per riga, o un
   *  uomo che il toolkit mette in ballottaggio su due LINEE torna a comparire due volte - che è
   *  esattamente la cosa da togliere (Pasalic, ballottaggio in mezzo e sulla trequarti insieme). */
  const places = rows.flatMap((row) => row.men.map((starter) => ({ row, starter })));

  /** Un candidato: l'uomo - un oggetto solo, anche dove il toolkit lo elencava su tre posti - i posti su
   *  cui era elencato, che è quello che distingue uno spostamento da una conferma, e le LINEE di quei
   *  posti, che sono il suo perimetro: un rivale della difesa non si sposta a centrocampo. */
  interface Candidate { rival: PitchMan; listed: Set<number>; lines: Set<PitchLine>; at: number; }
  const candidates: Candidate[] = [];
  const byId = new Map<number, Candidate>();
  places.forEach(({ row, starter }, place) => {
    for (const rival of starter.duels) {
      // Sotto la soglia non è un ballottaggio: via, e il titolare resta comunque disegnato.
      if (rival.claim != null && rival.claim < PITCH_CLAIM_FLOOR) {
        counted.floor += 1;
        continue;
      }
      const before = rival.fcId == null ? undefined : byId.get(rival.fcId);
      if (before) {
        // Lo stesso uomo su due posti: una voce sola, e i due posti diventano due sue candidature.
        counted.duplicate += 1;
        before.listed.add(place);
        before.lines.add(row.line);
        continue;
      }
      const one: Candidate = { rival, listed: new Set([place]), lines: new Set([row.line]), at: place };
      candidates.push(one);
      if (rival.fcId != null) byId.set(rival.fcId, one);
    }
  });
  for (const { starter } of places) starter.duels = [];
  if (!candidates.length) return counted;

  // Il costo di ogni uomo su ogni posto, folla a parte. Fuori dalle sue linee non è un posto, e un posto
  // il cui titolare È lui nemmeno: sarebbe un uomo in ballottaggio con se stesso.
  const cost = candidates.map((one) => places.map(({ row, starter }, place) => (
    !one.lines.has(row.line) || (starter.fcId != null && starter.fcId === one.rival.fcId)
      ? Number.POSITIVE_INFINITY
      : duelFit(row.line, starter.badge, one.rival, one.listed.has(place))
  )));

  const taken = places.map(() => 0);
  // Prima chi ha meno scelta - il rimpianto fra il posto migliore e il secondo - così chi ha un solo posto
  // sensato non se lo trova occupato da chi ne aveva due.
  const regret = (index: number): number => {
    const sorted = [...cost[index]].sort((left, right) => left - right);
    return (sorted[1] ?? Number.POSITIVE_INFINITY) - (sorted[0] ?? 0);
  };
  const order = candidates.map((one, index) => index)
    .sort((left, right) => regret(right) - regret(left) || left - right);
  for (const index of order) {
    const place = bestPlace(cost[index], taken, candidates[index].at);
    candidates[index].at = place;
    taken[place] += 1;
  }
  // ...e poi si migliora finché si migliora: il greedy vede un uomo alla volta, e due mosse che
  // separatamente non convengono possono convenire insieme. Su undici posti converge in due passate.
  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false;
    candidates.forEach((one, index) => {
      taken[one.at] -= 1;
      const place = bestPlace(cost[index], taken, one.at);
      taken[place] += 1;
      if (place !== one.at) moved = true;
      one.at = place;
    });
    if (!moved) break;
  }

  // Rimontaggio: ogni posto riceve i suoi, il più credibile per primo. Un `claim` ignoto va in fondo - è
  // un ignoto e non uno zero, ma un ordine ci vuole e metterlo in cima direbbe il contrario.
  const drawn: PitchMan[][] = places.map(() => []);
  for (const one of candidates) drawn[one.at].push(one.rival);
  places.forEach(({ starter }, place) => {
    starter.duels = drawn[place]
      .map((rival, index) => ({ rival, index }))
      .sort((left, right) => (right.rival.claim ?? -1) - (left.rival.claim ?? -1) || left.index - right.index)
      .map((one) => one.rival);
  });
  return counted;
}

/**
 * LE DRITTE DELL'OPERATORE SUL DISEGNO: un posto va al migliore dei SUOI candidati, e una
 * dichiarazione batte il claim.
 *
 * L'app non calcola nessun undici di un club vero - e' la regola che tiene questo file - quindi qui non
 * si sceglie nessun uomo nuovo: si RIORDINA la graduatoria che il toolkit ha gia' scritto per ogni
 * posto (il titolare piu' i suoi ballottaggi), che e' l'unico insieme in cui uno scambio non invento
 * niente. Chi il toolkit non mette in discussione da nessuna parte non entra: la sua dritta muove i
 * NUMERI (`player-rulings.ts`) e il disegno lo aggiorna la prossima costruzione del foglio, che ha in
 * mano la rosa intera e l'assegnazione vera.
 *
 * LE TRE PAROLE VENGONO DAL CANCELLO CHE LA SCALA HA SU SE STESSA e non da una scelta nostra
 * (`BOARD_EFFECT`): i primi tre gradini pretendono l'undici, gli ultimi due lo escludono,
 * `ballottaggio` e' compatibile con tutt'e due e quindi NON muove niente - il dato lo conferma, 115
 * dei 155 ballottaggi del foglio Serie A sono nell'undici disegnato e 40 no.
 *
 * E' IDEMPOTENTE PER COSTRUZIONE, che e' la proprieta' che rende sicuro avere due lettori della stessa
 * dichiarazione (qui e nel toolkit): l'ordinamento e' STABILE e la chiave e' uguale per tutti quelli
 * che non portano una dritta, quindi su una board che la dichiarazione rispetta gia' - una board
 * costruita DOPO che l'operatore l'ha messa in `config/player_rulings.json` - non si muove niente.
 *
 * UNA MAGLIA PER UOMO: chi e' stato promosso in un posto non viene promosso anche nei due o tre altri
 * in cui il toolkit lo elenca (171 voci di ballottaggio su 610 sono ripetizioni), o il campetto lo
 * disegnerebbe due volte - che e' esattamente il difetto che `spreadDuels` esiste per togliere.
 */
function applyRulings(rows: PitchRow[], problems: string[]): void {
  const effect = (man: PitchMan): RulingBoard | null => (man.ruled ? BOARD_EFFECT[man.ruled] : null);
  // Chi la dichiarazione ha gia' messo in campo, e chi il modello ci mette da se': in tutt'e due i
  // casi la sua maglia e' presa e non se ne cerca un'altra.
  const seated = new Set<number>();
  for (const row of rows) {
    for (const man of row.men) if (man.fcId != null && effect(man) === 'starter') seated.add(man.fcId);
  }
  for (const row of rows) {
    row.men = row.men.map((starter) => {
      const candidates = [starter, ...starter.duels];
      const rank = (man: PitchMan): number => {
        const what = effect(man);
        if (what === 'starter') {
          // Gia' titolare da un'altra parte: qui vale come chiunque altro, o giocherebbe due partite.
          return man.fcId != null && seated.has(man.fcId) && man !== starter ? 1 : 0;
        }
        return what === 'reserve' ? 2 : 1;
      };
      const keys = candidates.map((man) => rank(man));
      // Niente da dichiarare su questo posto: si esce senza toccare l'ordine del toolkit.
      if (keys.every((key) => key === 1)) return starter;
      const order = candidates
        .map((man, at) => ({ man, at }))
        .sort((left, right) => keys[left.at] - keys[right.at] || left.at - right.at);
      const chosen = order[0].man;
      if (effect(chosen) === 'reserve') {
        // Un `panchina` o un `riserva` che resta in campo perche' quel posto non ha nessun ricambio
        // disegnato: si DICE, invece di lasciare una dichiarazione che non ha fatto niente in silenzio.
        problems.push(
          `${chosen.name}: la tua dritta lo terrebbe fuori, ma per il suo posto la board non disegna `
          + 'nessun ricambio',
        );
        return starter;
      }
      if (chosen.fcId != null) seated.add(chosen.fcId);
      chosen.duels = order.slice(1).map((one) => one.man);
      return chosen;
    });
  }
  // UN TITOLARE NON E' UN BALLOTTAGGIO, e dopo uno scambio va detto di nuovo: il toolkit elenca lo
  // stesso rivale su due o tre posti (171 voci su 610 sono ripetizioni), quindi chi la dichiarazione
  // ha appena messo in campo resta un suo ballottaggio ALTROVE - e il campetto lo disegna due volte.
  // Trovato dal banco e non dalla rilettura: l'invariante e' quello che `spreadDuels` protegge per il
  // posto di cui uno E' titolare, detto per l'intero campetto.
  const starters = new Set<number>();
  for (const row of rows) {
    for (const man of row.men) if (man.fcId != null) starters.add(man.fcId);
  }
  for (const row of rows) {
    for (const man of row.men) {
      man.duels = man.duels.filter((rival) => rival.fcId == null || !starters.has(rival.fcId));
    }
  }
}

/**
 * The pitch of one board: rows from the module's numbers, men where the panel puts them.
 *
 * A row is drawn even when the board placed FEWER men on it than the module asks for - the gap is the
 * information (an empty flank reads as a gap, which is exactly what the panel's own geometry is for), and
 * `problems` names it. Filling it would be inventing a man the toolkit did not place.
 */
export function pitchOf(
  board: Board | null,
  resolve: (man: BoardMan) => OnTable,
  /**
   * QUALE modulo disegnare, fra quelli che il toolkit ha mandato (`shapesOf`). Niente = quello scelto dal
   * pannello, che è la risposta del modello e resta il default: un'alternativa si vede perché la si chiede.
   */
  shape?: string | null,
  /**
   * CHE DRITTA C'E' su ogni uomo, se la pagina ne conosce (`core/player-rulings.ts`).
   *
   * Un parametro e non una lettura di questo file, per la stessa ragione per cui `resolve` e' un
   * parametro: quale stagione e quale listone si stia guardando lo sa il chiamante. Niente = nessuna
   * dichiarazione, e il disegno e' quello del toolkit senza una riga di differenza.
   */
  ruling?: RulingLookup,
): Pitch | null {
  if (!board || board.error) return null;
  const chosen = shape && shape !== (board.board_shape ?? board.picture)
    ? board.alternatives?.[shape] : null;
  const module = (chosen ? chosen.picture : board.picture ?? board.board_shape) ?? null;
  const drawnLines = chosen?.lines ?? board.lines;
  const counts = lineCounts(module);
  if (!counts || !drawnLines) return null;

  const rows: PitchRow[] = [];
  const problems: string[] = [];
  let taken = 0;
  for (const line of DRAW_ORDER) {
    const wanted = counts[line] ?? 0;
    const drawn = (drawnLines[line] ?? []).map((man) => toMan(man, resolve, ruling));
    if (!wanted && !drawn.length) continue;
    if (wanted !== drawn.length) {
      problems.push(`linea ${line}: il modulo dice ${wanted}, i disegnati sono ${drawn.length}`);
    }
    taken += drawn.filter((man) => man.taken).length;
    // ORDERED by the panel's own x and then spread evenly on the row, instead of placed at that x.
    // The order is the information a pitch can keep on a phone - it is the team's right to its left, flanks
    // already resolved by `_placed` - while the exact coordinate is not: four chips at their true x overlap
    // on a narrow screen, and a row nobody can read says less than a tidy one. A line the module says is
    // fuller than the drawn men still reports the gap (`problems`), which is what the empty space said.
    rows.push({ line, wanted, men: [...drawn].sort((left, right) => left.x - right.x) });
  }

  // LE DRITTE PRIMA DEI BALLOTTAGGI: chi entra in campo per una dichiarazione esce dai rivali, e chi
  // esce ci entra - `spreadDuels` distribuisce i rivali sui posti, quindi va fatto DOPO o
  // ridistribuirebbe una lista che sta per cambiare.
  if (ruling) applyRulings(rows, problems);
  const hiddenDuels = spreadDuels(rows);

  const solved = chosen ? shape ?? null : board.board_shape ?? null;
  return {
    module: module ?? '',
    solvedOn: solved && solved !== module ? solved : null,
    typical: board.formation_typical ?? null,
    coach: board.coach ?? null,
    // `'yes'` / `'no'`, as the sheet's own column spells it - and NOT `Boolean(...)`, which reads `'no'` as
    // true and would have called every coach new. The column that looks like a flag is a word.
    newCoach: String(board.new_coach ?? '').toLowerCase() === 'yes',
    why: board.why ?? null,
    odds: Object.entries(board.odds ?? {}).map(([shape, p]) => ({ shape, p })),
    rows,
    taken,
    hiddenDuels,
    problems,
  };
}
