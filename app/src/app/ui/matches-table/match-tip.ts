import { BonusRow, MatchSpell, PLAYED_THE_MATCH, bonusesOf, spellOf } from '../../core/match-bonuses';
import { ScoringConfig } from '../../core/bundle';
import { MatchCell } from '../../core/players-store';
import { STATE_ICON, STATE_LABEL, voteInk } from './vocabulary';

/**
 * IL TOOLTIP DI UNA CELLA COME ELENCO, e non come una riga di frasi separate da un punto.
 *
 * Richiesta dell'operatore (10/09/2026): «formatta meglio il tooltip in questione: le informazioni
 * devono essere visualizzate come un elenco evidenziando le cose positive e quelle negative con
 * effetti diversi». Prima era un `join(' · ')`, cioe' una stringa in cui un gol e un'espulsione si
 * leggevano con lo stesso inchiostro e nello stesso posto - il numero di eventi di una partita era
 * proprio la cosa che quella forma non sapeva mostrare.
 *
 * IL VERSO DI UN EVENTO NON SI DECIDE QUI: lo dichiara `BonusRow.good`, che e' la stessa colonna su cui
 * `ui/bonus-mark` sceglie il verde e il rosso in ogni pagina. Un secondo giudizio scritto qui sarebbe
 * la porta da cui una pagina finisce per dipingere di verde quello che un'altra dipinge di rosso - ed
 * e' anche la ragione per cui i punti restano NULL senza il file dei punteggi invece di diventare uno
 * zero: l'evento e' un fatto, il suo valore no.
 *
 * QUESTO FILE STA ACCANTO AL VOCABOLARIO e non in `core/`, perche' legge le fasce del voto e le icone
 * di stato che il vocabolario possiede: un modello di tooltip che ricopiasse quelle soglie sarebbe una
 * seconda scala sullo stesso numero. Resta puro - nessun segnale, nessuna iniezione - quindi si prova
 * senza montare niente.
 */

/**
 * Che effetto ha una riga. Il template mappa questo in classi, e qui non ce ne sono: l'unica
 * eccezione e' l'inchiostro di un NUMERO che ha piu' di due fasce (il fantavoto), che viene dal
 * vocabolario invece di essere riscritto.
 */
export type TipTone = 'good' | 'bad' | 'plain' | 'muted' | 'warn';

export interface TipRow {
  /** L'evento, quando la riga ne descrive uno: lo disegna `ui/bonus-mark`, come ovunque. */
  bonus: BonusRow | null;
  /** L'icona dello stato, quando la riga dice perche' non ha giocato. */
  icon: string | null;
  /** I due triangolini, sulla riga dei minuti e su nessun'altra. */
  spell: MatchSpell | null;
  label: string;
  /** Il numero a destra: i punti dell'evento, i minuti, il fantavoto. */
  value: string | null;
  tone: TipTone;
  /** L'inchiostro del numero dove ha piu' di due fasce. Vuoto altrimenti: il `tone` basta. */
  valueInk: string;
}

export interface MatchTip {
  /** L'incontro, nell'ordine in cui si e' giocato. */
  fixture: string;
  /** La giornata e la data: quello che la colonna abbrevia. */
  when: string | null;
  rows: TipRow[];
}

/** dd/mm/yyyy, because a date in a tooltip is read by a person and not by a parser. */
const it = (iso: string): string => iso.split('-').reverse().join('/');

const line = (partial: Partial<TipRow> & { label: string }): TipRow => ({
  bonus: null,
  icon: null,
  spell: null,
  value: null,
  tone: 'plain',
  valueInk: '',
  ...partial,
});

export function matchTip(cell: MatchCell, scoring: ScoringConfig | null): MatchTip {
  const rows: TipRow[] = [];

  // 1. PERCHE' NON C'ERA, per prima: e' la riga che spiega l'assenza di tutte le altre. Un infortunio
  //    e' giallo e non rosso - e' un fatto sul calciatore, non una sua colpa - che e' la stessa scelta
  //    che il vocabolario fa sull'icona della cella.
  if (cell.state !== 'played') {
    rows.push(
      line({
        icon: STATE_ICON[cell.state] || 'minus-circle',
        label: STATE_LABEL[cell.state],
        tone: cell.state === 'injured' ? 'warn' : 'muted',
      }),
    );
  }

  // 2. I MINUTI, coi due triangolini accanto (richiesta dell'operatore, 10/09/2026). Grigi sotto i 75',
  //    che e' la soglia gia' dichiarata per «e' stata una sua partita» e non una nuova: la stessa che
  //    la riga compatta della card usa per lo stesso inchiostro.
  const spell = spellOf(cell);
  if (cell.state === 'played' || cell.state === 'no_vote') {
    const short = spell.minutes == null || spell.minutes < PLAYED_THE_MATCH;
    rows.push(
      line({
        spell,
        label: 'In campo',
        value: spell.minutes == null ? 'minuti ignoti' : `${spell.minutes}'`,
        tone: short ? 'muted' : 'plain',
      }),
    );
  }

  // 3. GLI EVENTI, dal lettore unico: lo stesso elenco che disegna i marchi della cella e il pannello
  //    grande, quindi una partita non puo' portare due liste di cose successe.
  for (const bonus of bonusesOf(cell, scoring)) {
    rows.push(
      line({
        bonus,
        label: bonus.count > 1 ? `${bonus.count} ${bonus.label.toLowerCase()}` : singular(bonus),
        value: bonus.points == null ? null : (bonus.points > 0 ? '+' : '') + points(bonus.points),
        tone: bonus.good ? 'good' : 'bad',
      }),
    );
  }

  // 4. IL FANTAVOTO, che e' l'unico numero della cella che la cella NON disegna: il voto sta gia' sotto
  //    il puntatore, e un tooltip che rilegge la riga ad alta voce e' un pannello che si apre per
  //    niente. Le fasce sono quelle del voto, dal vocabolario: il fantavoto e' lo stesso metro piu' i
  //    bonus, e due tinte diverse sullo stesso sei si leggerebbero come due giudizi.
  if (cell.fantavoto != null) {
    rows.push(
      line({
        label: 'Fantavoto',
        value: (cell.voteSynthetic ? '~' : '') + cell.fantavoto.toFixed(1),
        valueInk: voteInk(cell.fantavoto),
      }),
    );
  }

  // 5. L'ALTRA PARTITA DELLA STESSA SETTIMANA: una colonna e' una settimana, quindi una cella puo'
  //    nasconderne una seconda, e dirlo e' l'unico modo di non far leggere questa come l'unica.
  if (cell.alsoInWeek) {
    rows.push(line({ label: `+${cell.alsoInWeek} nella stessa settimana`, tone: 'muted' }));
  }

  return { fixture: fixtureOf(cell), when: whenOf(cell), rows };
}

/** «1 gol» accanto a un pallone e' rumore: al singolare l'evento si chiama col suo nome. */
function singular(bonus: BonusRow): string {
  if (bonus.kind === 'assist') return bonus.label;
  const one: Partial<Record<BonusRow['kind'], string>> = {
    goal: 'Gol',
    'own-goal': 'Autogol',
    'pen-scored': 'Rigore segnato',
    'pen-missed': 'Rigore sbagliato',
    yellow: 'Ammonizione',
    red: 'Espulsione',
    conceded: 'Gol subito',
    'pen-saved': 'Rigore parato',
  };
  return one[bonus.kind] ?? bonus.label;
}

/** I punti senza decimali inutili: `+3` e non `+3.0`, e il mezzo punto dove c'e'. */
function points(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** L'incontro nell'ordine in cui si e' giocato: chi era in casa a sinistra. */
export function fixtureOf(cell: MatchCell): string {
  if (!cell.opponent) return cell.team;
  return cell.home === false ? `${cell.opponent} - ${cell.team}` : `${cell.team} - ${cell.opponent}`;
}

/** La giornata (una coppa non ne ha, e allora il nome della competizione) e la data. */
export function whenOf(cell: MatchCell): string | null {
  const round =
    cell.kind === 'league' && cell.matchday != null ? `${cell.matchday}ª` : cell.competitionLabel;
  const day = cell.date ? it(cell.date) : null;
  return [round, day].filter(Boolean).join(' · ') || null;
}
