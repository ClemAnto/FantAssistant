import { PlayerMark } from './player-status';

/**
 * Il marchio di chi una COPPA CONTINENTALE porta via in mezzo al campionato.
 *
 * Letto dal foglio (`desc_cup*`) e mai ricalcolato qui, per la ragione di sempre: chi va a un torneo è una
 * PREVISIONE SU UNA PERSONA, quindi si misura dove le misure si fanno e si giudicano. L'app disegna
 * l'icona e scrive la frase; il numero glielo passa il toolkit.
 *
 * Il marchio porta solo quello che NON dipende dalla piattaforma - il torneo, le sue date, il paese, se è
 * già nazionale - perché `PlayerStatus` è uno per giocatore mentre le giornate a rischio sono 4 in Serie A
 * e 3,3 su euro. Le giornate stanno nella colonna delle presenze attese, dove la piattaforma della riga è
 * dichiarata: un numero senza il suo calendario è un numero che non dice di cosa è misura.
 */
export interface CupExposure {
  /** Il nome del torneo, come lo dichiara `config/international_cups.json`. */
  cup: string;
  /** Le sue date, già leggibili (07/01-05/02): il foglio le porta dentro la propria nota. */
  window: string | null;
  country: string;
  /** Il provider lo file fra i nazionali della sua squadra. Falso = non lo sappiamo, non «non lo è». */
  capped: boolean;
}

/** «07/01-05/02» dalla nota che il foglio scrive, o null: si legge, non si ricostruisce. */
export function windowFromNote(note: string | null | undefined): string | null {
  const match = /\(([\d/]{5}-[\d/]{5})\)/.exec(note ?? '');
  return match ? match[1] : null;
}

/**
 * Il fatto in una riga, o null quando il foglio non dichiara nessun torneo.
 *
 * «Nazionale» e «convocabile» sono due frasi diverse e la differenza è misurata: in una finestra di Coppa
 * d'Africa un titolare già nazionale perde lo 0,35 delle giornate e uno solo convocabile lo 0,20. Sulla
 * Coppa d'Asia i due valori coincidono (0,59), perché i pochi asiatici che giocano in Europa sono titolari
 * delle loro nazionali quasi senza eccezione - e il tooltip dice quale delle due cose sta guardando.
 */
export function cupMark(exposure: CupExposure | null | undefined): PlayerMark | null {
  if (!exposure?.cup || !exposure.country) return null;
  const when = exposure.window ? ` (${exposure.window})` : '';
  const who = exposure.capped ? 'nazionale' : 'convocabile';
  return {
    flag: 'intl_cup',
    note: `${exposure.cup}${when}: ${exposure.country}, ${who} — le giornate a rischio sono nella `
      + 'colonna delle presenze attese, che è l’unica a sapere su quale calendario contarle',
  };
}
