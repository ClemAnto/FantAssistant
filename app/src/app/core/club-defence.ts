import { BundleTable, columnIndex } from './bundle';

/**
 * LA PORTA È DELLA SQUADRA, e questo marchio lo dice invece di attribuirlo al portiere.
 *
 * L'operatore aveva il sospetto giusto («il clean-sheet dipende più dalla squadra che dal portiere»,
 * 16/08/2026) e i numeri lo confermano, misurati su sette stagioni di Serie A:
 *
 *   - sul PORTIERE la quota non persiste: r = **0,074** fra la sua quota di una stagione e quella
 *     della stagione dopo (18 coppie con 10+ presenze);
 *   - sul CLUB persiste: r = **0,488** fra due stagioni consecutive (102 coppie con 20+ giornate);
 *   - due portieri nella stessa porta nella stessa stagione differiscono in media di 0,147 e **nelle
 *     due direzioni** - Skorupski 0,44 contro Ravaglia 0,12 al Bologna, ma Provedel 0,17 contro
 *     Mandas 0,44 alla Lazio - cioè rumore, non merito.
 *
 * E l'ALLENATORE, che l'operatore ha chiesto di aggiungere («squadra+allenatore → merito clean
 * sheet»), non regge la misura che lo isola: nei 30 cambi in corsa (stessa rosa, stessa stagione,
 * due tratti da 8+ partite) lo scarto medio fra i due tratti è **0,155**, ma il NULL - due metà della
 * stessa stagione SENZA cambio, 110 casi - è **0,094**. L'eccesso è 0,06 di quota, cioè un paio di
 * porte inviolate in una stagione, e i tratti di un cambio sono più corti delle metà, il che gonfia
 * lo scarto per costruzione. Quindi il marchio è della SQUADRA e basta: mettere l'allenatore
 * vorrebbe dire far dire a un'icona più di quello che i dati sanno.
 */

/**
 * Da quale quota una porta «resta inviolata spesso»: DUE GIORNATE SU CINQUE.
 *
 * Misurata sul bundle e non scelta a occhio, e vale su tutt'e due i listoni perché le due
 * distribuzioni quasi coincidono: Serie A mediana 0,289 e p75 0,395 (40 stagioni-club), EuroLeghe
 * mediana 0,323 e p75 0,387 (71). A 0,40 restano 8 stagioni-club su 40 e 16 su 71, cioè un club su
 * cinque da una parte e dall'altra - Inter, Roma, Juventus e Como nel 2025-26.
 */
export const CLEAN_SHEET_SHARE = 0.4;

/** Sotto quante giornate una quota non si legge: mezza stagione non dice come gioca una squadra. */
export const CLEAN_SHEET_MIN_ROUNDS = 20;

/**
 * I POSTI CHE UN MODULO SCHIERA, per ruolo, mediati sui moduli del regolamento.
 *
 * Serve al rimpiazzo che entra davvero: il rango è `squadre × posti`. Si legge dal REGOLAMENTO
 * (`classic_modules.json`) e non si scrive a mano, perché è configurazione - e perché un listone euro
 * gioca un altro gioco. Sui sette moduli classici la media è 1 portiere, 4 difensori, 4 centrocampisti,
 * 2 attaccanti, che fanno undici; il portiere è uno per costruzione e non sta nei moduli.
 */
export function fieldedPlaces(modules: unknown): Map<string, number> | null {
  const shapes = (modules as { modules?: Record<string, Record<string, string[]>> })?.modules;
  if (!shapes) return null;
  const totals = new Map<string, number>();
  const names = Object.keys(shapes);
  if (!names.length) return null;
  for (const shape of Object.values(shapes)) {
    for (const line of Object.values(shape)) {
      for (const role of line) totals.set(role, (totals.get(role) ?? 0) + 1);
    }
  }
  const out = new Map<string, number>([['P', 1]]);
  for (const [role, total] of totals) out.set(role, total / names.length);
  return out;
}

/** Il record difensivo di un club in una stagione: giornate chiuse a zero su giornate giocate. */
export interface ClubDefence {
  season: string;
  played: number;
  clean: number;
  share: number;
}

/**
 * Per ogni club, l'ULTIMA stagione misurata di questo listone.
 *
 * L'ultima e non la media di quelle che ci sono: fra una stagione e l'altra la quota persiste a 0,488,
 * che è parecchio e non è tutto, e la stagione appena finita è quella con la rosa e la panchina più
 * simili a quella che si compra. Un promosso non ha una stagione qui e resta senza record - «vuoto =
 * ignoto», che è la ragione per cui questa funzione non torna zeri.
 *
 * I gol subiti si leggono dalle righe dei PORTIERI (`role = 'P'`), che è dove stanno, e si SOMMANO per
 * giornata: con una sostituzione la porta è una e i portieri sono due.
 */
export function clubCleanSheets(ratings: BundleTable, platform: string): Map<string, ClubDefence> {
  const [season, role, team, plat, conceded, status, matchday] = columnIndex(
    ratings, 'season', 'role', 'team', 'platform', 'goals_conceded', 'status', 'matchday',
  );
  /** (stagione, club) -> giornata -> gol subiti dal club. */
  const rounds = new Map<string, Map<number, number>>();
  for (const row of ratings.rows) {
    if (row[plat] !== platform || row[role] !== 'P' || row[status] !== 'played') continue;
    const goals = row[conceded] as number | null;
    if (goals == null) continue;
    const key = `${row[season]}|${row[team]}`;
    const days = rounds.get(key) ?? rounds.set(key, new Map()).get(key)!;
    const md = row[matchday] as number;
    days.set(md, (days.get(md) ?? 0) + goals);
  }

  const out = new Map<string, ClubDefence>();
  for (const [key, days] of rounds) {
    const [year, club] = key.split('|');
    const played = days.size;
    if (played < CLEAN_SHEET_MIN_ROUNDS) continue;
    const previous = out.get(club);
    if (previous && previous.season >= year) continue;
    const clean = [...days.values()].filter((goals) => goals === 0).length;
    out.set(club, { season: year, played, clean, share: clean / played });
  }
  return out;
}
