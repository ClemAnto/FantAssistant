/**
 * CHI ENTRA DALLA PANCHINA PRENDE IL VOTO MA PERDE BONUS (operatore, 05/10/2026, sul draft FA-610-2ih: «Atta
 * e' stato uno dei migliori centrocampisti della scorsa stagione e Saelemaekers non e' un titolare»).
 *
 * La fantamedia attesa del motore viene dalla stagione scorsa, cioe' da partite giocate col RUOLO di allora:
 * Saelemaekers ne ha cominciate 33 su 35, e quest'anno la stampa lo da' titolare nel 35% delle partite. Un
 * subentrato ha meno tempo per segnare e servire un assist, quindi il suo fantavoto e' piu' basso a parita' di
 * voto base - MISURATO su Serie A 2022-26 (`docs/model/rosa-3-giornate-v1.md` §2): voto base identico (D
 * −0,013 · C +0,009 · A −0,008), fantavoto **A −0,439 · C −0,129 · D −0,050** per partita da subentrato.
 *
 * Lo spostamento e' quel costo per la DIFFERENZA fra la quota di presenze da subentrato di adesso e quella della
 * stagione da cui la fantamedia viene: chi era titolare e resta titolare non si muove (la sua fantamedia contiene
 * gia' le sue partite), chi era titolare e ora e' in ballottaggio scende, e chi entrava dalla panchina e ora
 * parte titolare sale.
 *
 * La quota di adesso e' `1 − partenze / presenze` sulle partite in cui e' SANO: la stampa stima le partenze
 * quando sano (`start_pct`), il foglio le presenze quando sano (`desc_titolarita_play`), quindi i due numeri
 * hanno lo stesso denominatore. Il portiere non si muove: di un club ne gioca uno e il suo «bonus» e' il malus
 * dei gol subiti, che non dipende da quando entra.
 *
 * NON GATATO: e' la lettura dell'app per il draft, accanto alla colonna del motore, come la fantamedia dei
 * portieri (`keeperFmBy`). Dove manca uno dei tre numeri non si sposta niente: vuoto = ignoto, mai zero.
 */

/** Fantavoto perso per partita da subentrato invece che da titolare, per ruolo classico (misurato, vedi sopra). */
export const SUB_BONUS_COST: Readonly<Record<string, number>> = { D: 0.05, C: 0.129, A: 0.439 };

/** Sotto quante presenze la stagione scorsa non dice quante ne cominciava: una quota su tre partite e' una monetina. */
export const SUB_PREV_MIN_APPS = 5;

export interface StartRecord {
  apps: number;
  starts: number;
}

/**
 * Lo spostamento della fantamedia attesa, in punti a partita; null dove un numero manca o il ruolo non paga.
 *
 * `startPct` 0-100 (la stampa), `play` 0-1 (il foglio), `prev` le presenze e le partenze in campionato della
 * stagione da cui la fantamedia viene.
 */
export function subBonusShift(
  role: string | null,
  startPct: number | null | undefined,
  play: number | null | undefined,
  prev: StartRecord | null | undefined,
): number | null {
  const cost = role ? SUB_BONUS_COST[role] : undefined;
  if (cost == null || startPct == null || play == null || !(play > 0) || !prev || prev.apps < SUB_PREV_MIN_APPS) {
    return null;
  }
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const subNow = clamp(1 - startPct / 100 / play);
  const subPrev = clamp(1 - prev.starts / prev.apps);
  const shift = -cost * (subNow - subPrev);
  return PROMOTION_SHIFT ? shift : Math.min(0, shift);
}

/**
 * CHI DIVENTA TITOLARE NON SALE (operatore, 05/10/2026: «Maldini e Adams sono troppo alti ... la classifica degli
 * attaccanti dovrebbe essere più o meno Malen, Martinez, Hojlund»). Il costo misurato e' simmetrico, ma il verso che
 * alza usa una PREVISIONE della stampa su un ruolo nuovo, e il calcio che quel ruolo ha gia' prodotto quest'anno e'
 * dentro la fantamedia (le giornate viste, R25): Maldini da subentrato a titolare leggeva +0,19 a partita e Adams A.
 * +0,22, e salivano sopra Hojlund. Spento: lo spostamento toglie, non aggiunge. Riaccenderlo e' una riga.
 */
export const PROMOTION_SHIFT = false;

/**
 * QUANTO VALE IN FERTILITA' UNA PRESENZA DA SUBENTRATO rispetto a una da titolare (operatore, 05/10/2026: «penso che si
 * debba abbassare un po' il valore delle partite dove si entra dalla panchina», poi «ok» su 0,5). DICHIARATO e non
 * misurato: il bonus perso a partita da subentrato e' gia' tolto da `subBonusShift`, quindi questo peso in parte conta
 * due volte la stessa cosa - il prezzo detto quando l'ha scelto - e pesa di piu' su chi parte spesso dalla panchina.
 * Solo nella fertilita' di +Rosa: la copertura non cambia (un subentrato prende il voto e copre il posto).
 */
export const SUB_APPEARANCE_WEIGHT = 0.5;

/** La quota di presenze da subentrato ADESSO, `1 − partenze / presenze` da sano; null dove un numero manca. */
export function subShareNow(startPct: number | null | undefined, play: number | null | undefined): number | null {
  if (startPct == null || play == null || !(play > 0)) return null;
  return Math.min(1, Math.max(0, 1 - startPct / 100 / play));
}
