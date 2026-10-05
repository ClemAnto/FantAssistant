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
  return -cost * (subNow - subPrev);
}
