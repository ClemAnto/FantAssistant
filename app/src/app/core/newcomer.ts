/**
 * IL NUOVO ARRIVATO che questo campionato non ha mai visto giocare, e il marchio che dice «guardalo».
 *
 * Il fatto lo MISURA il toolkit (`modules/abroad.py`) e qui non si ricalcola niente: la finestra delle
 * ultime venti partite altrove, il braccio che l'ha acceso e il rango dentro il ruolo arrivano dal
 * foglio, e questo file possiede solo le PAROLE - come `player-place` possiede quelle di
 * `starter_signs`. Due letture degli stessi `desc_abroad_*` finirebbero per dare a un uomo due frasi.
 *
 * PERCHE' ESISTE. Sul foglio Serie A 2026-27, 188 uomini su 531 non hanno un solo voto della stagione
 * appena finita: il motore li prezza sull'ancora di ruolo e `est_pv` cade sulla costante «nessuno lo
 * ha mai visto giocare», quindi in lista sono ordinati da un numero uguale per tutti. Misurato sul
 * foglio vivo, `r(quota giocata all'estero, est_pv)` legge **+0,05**: il foglio non sbaglia su di loro,
 * e' CIECO.
 *
 * DUE BRACCI, E NON PER SIMMETRIA. Chi arriva dai cinque campionati che copriamo e' letto su QUANTO HA
 * GIOCATO (1,41x), chi arriva da dove il livello non lo sappiamo sui GOL+ASSIST (1,35x) - e non il
 * contrario, perche' dentro i cinque i bonus valgono 1,03x e 0,70x fra i quotati bassi, cioe'
 * fuorviano proprio dove si cerca l'affare. Il meccanismo: nei cinque il campionato dice gia' il
 * livello, quindi cio' che distingue due uomini e' se giocavano; fuori, il livello e' ignoto e i bonus
 * sono l'unica cosa che dice «e' forte».
 *
 * QUELLO CHE IL MARCHIO NON DICE, e la frase lo rispetta: non dice quanto vale. Il Qt.I da solo legge
 * 1,41x e 1,51x, cioe' quanto o meglio di qualunque nostro segnale - quindi questo non batte il
 * mercato, aggiunge dei numeri accanto a un nome che oggi non ne ha. E' REPORTING: nessun gate lo
 * possiede, non entra in nessuna valutazione e non riordina nessuna lista.
 *
 * SU EURO IL MARCHIO NON ARRIVA, e non e' una dimenticanza: rimisurata la' con lo stesso disegno, i
 * due bracci si INVERTONO (coperto 1,27x sui minuti contro 1,35x sui bonus, non coperto 1,37x contro
 * 1,12x). Con n = 151 e 168 quella differenza non e' risolvibile, quindi il toolkit scrive i NUMERI su
 * tutt'e due i fogli e il VERDETTO solo dove e' stato misurato (`abroad.SCREEN_PLATFORMS`). Qui non
 * serve nessun controllo: la colonna arriva vuota da sola.
 */

import { PlayerMark } from './player-status';

/** Le due parole che il foglio scrive in `desc_abroad_watch`, e nessun'altra. */
export type NewcomerArm = 'share' | 'bonuses';

/** La finestra come il foglio la porta. Tutti i campi possono mancare: un foglio piu' vecchio della
 *  revisione 58 non ha nessuna di queste colonne, e allora non si disegna niente. */
export interface NewcomerWindow {
  arm: string | null;
  competition: string | null;
  matches: number | null;
  minutes: number | null;
  ga90: number | null;
  vote: number | null;
  /** Su QUANTE delle partite della finestra il voto e' noto: una media su tre non e' una media su venti. */
  voted: number | null;
  share: number | null;
  rank: number | null;
  pool: number | null;
}

/** Il nome del campionato come lo legge un umano. Solo i nostri cinque piu' i vicini piu' frequenti:
 *  per tutto il resto si mostra lo slug della fonte, che e' leggibile e non inventa niente. */
const LEAGUE_NAMES: Record<string, string> = {
  serie_a: 'Serie A',
  serie_b: 'Serie B',
  premier_league: 'Premier League',
  la_liga: 'Liga',
  bundesliga: 'Bundesliga',
  ligue_1: 'Ligue 1',
  ekstraklasa: 'Ekstraklasa',
  eredivisie: 'Eredivisie',
  championship: 'Championship',
  'liga-portugal-betclic': 'Liga Portugal',
  'saudi-pro-league': 'Saudi Pro League',
  'pro-league': 'Pro League',
  'super-league': 'Super League',
  'stoiximan-super-league': 'Super League',
  'bundesliga-aut': 'Bundesliga austriaca',
  'trendyol-super-lig': 'Süper Lig',
  'brasileirao-serie-a': 'Brasileirão',
  'liga-profesional-de-futbol': 'Liga Profesional',
};

export function leagueName(competition: string | null): string {
  if (!competition) return '';
  return LEAGUE_NAMES[competition] ?? competition;
}

/** Il ruolo al plurale, per la frase del rango: «1° di 8 attaccanti». */
const ROLE_PLURAL: Record<string, string> = { D: 'difensori', C: 'centrocampisti', A: 'attaccanti' };

/**
 * La frase del marchio, o null quando il foglio non ha acceso niente.
 *
 * Il numero che si mostra e' QUELLO CHE HA DECISO, mai tutti e due: mostrare la quota accanto ai bonus
 * farebbe chiedere quale dei due conta, ed e' la stessa ragione per cui la plancia non stampa due
 * cifre sulla stessa riga. L'altro resta nel dettaglio, dove chi vuole va a cercarlo.
 */
export function newcomerMark(window: NewcomerWindow, role: string | null): PlayerMark | null {
  if (window.arm !== 'share' && window.arm !== 'bonuses') return null;
  const where = leagueName(window.competition);
  const rank = window.rank && window.pool
    ? `, ${window.rank}° di ${window.pool} ${ROLE_PLURAL[role ?? ''] ?? 'nel suo ruolo'}`
    : '';
  const note = window.arm === 'share'
    ? `Nuovo: ha giocato il ${Math.round((window.share ?? 0) * 100)}% della stagione${
        where ? ` in ${where}` : ''}${rank}`
    : `Nuovo: ${fmt(window.ga90)} gol+assist per 90${where ? ` in ${where}` : ''}${rank}`;
  return { flag: 'newcomer', note };
}

/**
 * La riga di dettaglio: cosa ha fatto nelle ultime partite, per chi il marchio NON ce l'ha.
 *
 * Esiste perche' i numeri viaggiano su 75 righe e il marchio su 23: togliere i numeri a chi non passa
 * il taglio renderebbe impossibile capire perche' non e' passato, ed e' la stessa disciplina per cui
 * il foglio scrive la finestra anche su euro dove il verdetto non arriva.
 */
export function newcomerDetail(window: NewcomerWindow): string | null {
  if (!window.matches || !window.minutes) return null;
  const where = leagueName(window.competition);
  const parts = [`${window.matches} partite`, `${window.minutes}'`];
  if (window.ga90 !== null) parts.push(`${fmt(window.ga90)} gol+assist per 90`);
  if (window.vote !== null) {
    // Il conteggio VIAGGIA col voto: una media su tre partite e una su venti non sono la stessa
    // affermazione, e una riga che non lo dice e' una riga di cui il lettore si fidera' troppo.
    parts.push(`voto ${fmt(window.vote, 2)}${window.voted ? ` su ${window.voted}` : ''}`);
  }
  return `${where ? `${where}: ` : ''}${parts.join(' · ')}`;
}

/** Il punto e' il separatore dei decimali di questa app (operatore, 05/09/2026). */
function fmt(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toFixed(digits);
}
