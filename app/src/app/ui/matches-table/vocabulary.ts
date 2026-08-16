import { CellState } from '../../core/players-store';

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
  cup: 'trophy',
  friendly: 'coffee',
  national: 'flag',
};

export const KIND_LABEL: Record<string, string> = {
  league: 'Campionato',
  cup: 'Coppa o altra competizione',
  friendly: 'Amichevole',
  national: 'Nazionale',
};
