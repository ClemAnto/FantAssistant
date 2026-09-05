import { PASS_MARK } from '../../core/player-ratings';
import { CellState, MatchCell } from '../../core/players-store';

/**
 * How a match cell is NAMED and MARKED, in one place.
 *
 * Its own file rather than the component's, because the detail panel says the same words about the same
 * cell: if it lived in the table, the table would import the panel and the panel the table. One
 * vocabulary, no cycle - and two marks for the same thing would be two vocabularies.
 */

/** A cell with no vote is not blank: it says WHY. One icon per reason, and never red - an
 *  injury is a fact about a player, not a failure. */
export const STATE_ICON: Record<CellState, string> = {
  played: '',
  no_data: '',
  no_vote: 'question-circle',
  bench: 'pause-circle',
  injured: 'medicine-box',
  not_in_league: 'global',
  absent: 'minus-circle',
};

export const STATE_LABEL: Record<CellState, string> = {
  played: 'Ha giocato',
  no_data: 'Risulta giocata, nessun dato oltre alla distinta',
  no_vote: 'In campo, senza voto',
  bench: 'In panchina, non entrato',
  injured: 'Infortunato',
  not_in_league: 'Non in questo campionato',
  absent: 'Non risulta in distinta',
};

/** One symbol per kind of match, used BOTH in the column header and in the cell. `national` has no
 *  icon in use - no national-team competition exists in the per-match layer, measured - but it is
 *  mapped so that the day one arrives it is named rather than filed under "cup". */
export const KIND_ICON: Record<string, string> = {
  league: 'calendar',
  // UN CALENDARIO E NON UN TROFEO: un campionato straniero e' un campionato, e per giunta e' l'unico
  // fra i «non suoi» che possa portare un voto sulla scala del fantacalcio. Un trofeo accanto a
  // Tottenham-Everton direbbe una cosa falsa proprio sulla riga che ne dice una vera.
  other_league: 'calendar',
  cup: 'trophy',
  friendly: 'coffee',
  national: 'flag',
};

export const KIND_LABEL: Record<string, string> = {
  league: 'Campionato',
  other_league: 'Un altro campionato',
  cup: 'Coppa o altra competizione',
  friendly: 'Amichevole',
  national: 'Nazionale',
};

/**
 * IL NUMERO DI UNA CELLA, e non e' la stessa grandezza in ogni cella.
 *
 * Una partita di campionato porta il voto fantacalcio, o quello sintetico calibrato, marcato `~`;
 * una coppa o un'amichevole possono portare solo il rating 1-10 del provider, marcato `*` perche' e'
 * un'altra scala. Un punto vuol dire che ha una riga e niente di misurabile.
 *
 * Sta nel VOCABOLARIO da quando la card di un calciatore disegna le stesse partite in riga compatta
 * (05/09/2026): due formattazioni dello stesso voto sono come lo stesso uomo finisce con due pagelle.
 */
export function voteText(cell: MatchCell): string {
  // IL VOTO PRIMA DI TUTTO, e la domanda e' «ce n'e' uno», non «di che competizione e' la riga».
  // Erano la stessa domanda finche' solo il suo campionato poteva portarne uno; da quando il layer
  // per-partita porta il sintetico calibrato anche degli altri quattro, sono due - e leggere la
  // seconda al posto della prima stampava `*6,7` (la scala del provider) su una riga che ha `~5,9`
  // (la nostra).
  if (cell.vote != null) {
    return (cell.voteSynthetic ? '~' : '') + cell.vote.toFixed(1);
  }
  // Nel SUO campionato «nessun voto» e' un fatto pubblicato - s.v. - e non un buco da riempire col
  // rating: sono due scale, e il rating resta nel dettaglio.
  if (cell.kind === 'league') return 's.v.';
  if (cell.providerRating == null) return '·';
  return '*' + cell.providerRating.toFixed(1);
}

/**
 * L'inchiostro di quel numero: le fasce sono TARATE SUL VOTO FANTACALCIO, quindi un rating del
 * provider resta neutro - colorarlo con le stesse sbarre sarebbe un'affermazione che nessuno ha
 * misurato. Il 5 e sotto e' rosso, che e' l'unico uso che la regola del colore concede: un giudizio
 * negativo esplicito (decisione dell'operatore, 09/08/2026).
 *
 * SOPRA IL SEI E' VERDE (operatore, 05/09/2026), e il sei non e' una soglia scelta: e' la sufficienza
 * del gioco, la stessa da cui la plancia conta (`EDGE_BASE`). I sette restano piu' marcati, cosi' la
 * colonna distingue ancora «bene» da «benissimo» invece di appiattirli in una tinta sola.
 *
 * UNA DEFINIZIONE, TRE LETTORI: la tabella di consultazione, la sua cella e le ultime partite della
 * card. Due fasce diverse sullo stesso voto sono come lo stesso uomo finisce con due pagelle.
 */
export function voteClass(cell: MatchCell): string {
  // Le fasce sono tarate sul VOTO DI FANTACALCIO, quindi le prende chi ne porta uno - suo o sintetico
  // - e nessun altro: colorare il rating del provider con lo stesso metro sarebbe un'affermazione che
  // nessuno ha misurato. La stessa domanda di `voteText`, quindi la stessa condizione.
  if (cell.vote != null) return voteInk(cell.vote);
  if (cell.kind !== 'league') return 'text-muted';
  return voteInk(null) + ' italic';
}

/** Le fasce, sul NUMERO: le legge anche il fantavoto, che e' lo stesso metro piu' i bonus. */
export function voteInk(value: number | null): string {
  if (value == null) return 'text-muted';
  if (value >= 7) return 'text-success font-semibold';
  if (value > PASS_MARK) return 'text-success';
  if (value >= PASS_MARK) return 'text-fg';
  if (value > 5) return 'text-muted';
  return 'text-danger font-semibold';
}
