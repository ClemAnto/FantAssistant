/**
 * I BONUS DI UNA PARTITA, in una definizione sola.
 *
 * Esisteva gia' dentro `ui/match-detail`, che e' il pannello grande di una cella; da oggi la stessa
 * lista la legge anche la RIGA COMPATTA della card di un calciatore («lista di bonus», richiesta
 * dell'operatore del 05/09/2026). Due conti sugli stessi eventi finirebbero per dare a una partita due
 * fantavoti - il difetto che questo progetto paga da sempre - quindi il conto sta qui, puro, e i due
 * componenti lo leggono.
 *
 * IL PUNTEGGIO E' DEL CAMPIONATO in cui la partita e' stata giocata (`scoring_config.json`, per
 * campionato e non per lega): il file esiste proprio perche' un campionato puo' segnare diversamente, e
 * senza di lui l'evento resta un FATTO e il suo valore no - `points` e' `null`, mai zero.
 */

import { ScoringConfig, ScoringTerms } from './bundle';
import { MatchCell } from './players-store';

/**
 * CHE COSA E' SUCCESSO, come VOCABOLARIO e non come etichetta.
 *
 * Il marchio che una pagina disegna si sceglie su questo e mai sulla stringa: l'operatore ha chiesto
 * (05/09/2026) che «le icone abbiano lo stesso significato in ogni pagina della piattaforma», e due
 * pagine che scegliessero l'icona guardando il testo finirebbero per dipingere due cose diverse la
 * settimana in cui una delle due etichette cambia parola.
 */
export type BonusKind =
  | 'goal'
  | 'own-goal'
  | 'assist'
  | 'pen-scored'
  | 'pen-missed'
  | 'yellow'
  | 'red'
  | 'conceded'
  | 'pen-saved';

export interface BonusRow {
  kind: BonusKind;
  /** Come si chiama per esteso: e' quello che legge un pannello. */
  label: string;
  /** ...e in due caratteri, per chi non puo' disegnare un'icona (e per un arnese che legge il testo). */
  short: string;
  count: number;
  /** Null quando nessun file di punteggio era in casa: l'evento resta un fatto, il suo valore no. */
  points: number | null;
  /** Se e' una cosa buona: decide l'inchiostro, e non lo decide il SEGNO dei punti (che senza il file
   *  non c'e'). Un gol subito e' un fatto neutro per un difensore e un malus per il portiere. */
  good: boolean;
}

/** I termini del campionato di QUESTA partita, col default sotto. */
export function termsOf(cell: MatchCell, config: ScoringConfig | null): ScoringTerms | null {
  if (!config) return null;
  return { ...config.default, ...(config.leagues[cell.competition] ?? {}) };
}

/**
 * Gli eventi di una partita che valgono qualcosa, in ordine di lettura.
 *
 * I GOL SUBITI E I RIGORI PARATI SOLO A CHI HA GIOCATO DA PORTIERE, e il ruolo e' quello della RIGA di
 * quella partita e non quello di listone: un uomo di movimento in porta non esiste, ma un portiere
 * schierato altrove si', e il malus dei gol subiti si applica a chi era in porta.
 */
export function bonusesOf(cell: MatchCell, config: ScoringConfig | null): BonusRow[] {
  const terms = termsOf(cell, config);
  const rows: BonusRow[] = [];
  const add = (
    kind: BonusKind,
    label: string,
    short: string,
    count: number,
    value: number | undefined,
    sign: 1 | -1,
  ) => {
    if (!count) return;
    rows.push({
      kind,
      label,
      short,
      count,
      points: terms && value != null ? sign * count * value : null,
      good: sign > 0,
    });
  };

  add('goal', 'Gol', 'G', cell.goals, terms?.goal_bonus, 1);
  add('pen-scored', 'Rigori segnati', 'R+', cell.penScored, terms?.penalty_scored_bonus, 1);
  add('assist', 'Assist', 'A', cell.assists, terms?.assist_bonus, 1);
  add('assist', 'Assist da fermo', 'Af', cell.assistsSetPiece, terms?.assist_set_piece_bonus, 1);
  add('pen-missed', 'Rigori sbagliati', 'R-', cell.penMissed, terms?.penalty_missed_malus, -1);
  add('own-goal', 'Autogol', 'Aut', cell.ownGoals, terms?.own_goal_malus, -1);
  add('yellow', 'Ammonizioni', 'Amm', cell.yellows, terms?.yellow_card_malus, -1);
  add('red', 'Espulsioni', 'Esp', cell.reds, terms?.red_card_malus, -1);

  if (cell.role === 'P') {
    add('pen-saved', 'Rigori parati', 'Rp', cell.penSaved, terms?.penalty_saved_bonus_gk, 1);
    add('conceded', 'Gol subiti', 'Gs', cell.goalsConceded ?? 0, terms?.goal_conceded_malus_gk, -1);
  }
  return rows;
}

/**
 * COM'E' ANDATA LA SUA PARTITA: e' SUBENTRATO, e' USCITO, tutt'e due o nessuna delle due.
 *
 * Le due frecce che l'operatore ha chiesto (verde in su per chi entra, rossa in giu' per chi esce) sono
 * DUE FATTI INDIPENDENTI, e per questo sono due booleani e non un'etichetta a scelta multipla.
 *
 * E UNO DEI DUE SI PUO' OSSERVARE SOLO PER CHI E' PARTITO TITOLARE, il che e' il motivo per cui questa
 * funzione esiste invece di un `minutes < 90` scritto nel template. I minuti sono i SUOI e non l'ora
 * del campo: un titolare uscito al 63' legge 63, ma anche un subentrato entrato al 63' legge 27, e in
 * quel caso 27 non dice affatto che sia uscito - dice che e' entrato tardi. Senza il MINUTO D'INGRESSO,
 * che il livello per-partita non porta, «un subentrato e' poi uscito?» e' una domanda a cui questa
 * riga non puo' rispondere, e allora non risponde: «vuoto = ignoto, mai zero» applicato a una freccia.
 *
 * Il confine dei 90' non e' una convenzione scelta: e' quello che il provider scrive per chi finisce la
 * partita, recupero compreso, quindi 90 e' «c'era alla fine» e 89 no.
 */
export interface MatchSpell {
  minutes: number | null;
  /** E' entrato a partita in corso. */
  on: boolean;
  /** E' stato sostituito - e lo si sa solo di chi era in distinta dal principio (vedi sopra). */
  off: boolean;
}

export const FULL_MATCH = 90;

export function spellOf(cell: MatchCell): MatchSpell {
  const minutes = cell.minutes;
  // Senza i minuti o senza la distinta non si dice niente: una freccia inventata su una riga di
  // fantacalcio e' una frase sul calciatore che nessuno ha osservato.
  if (minutes == null || cell.started == null) return { minutes, on: false, off: false };
  return {
    minutes,
    on: !cell.started && minutes > 0,
    off: cell.started && minutes > 0 && minutes < FULL_MATCH,
  };
}
