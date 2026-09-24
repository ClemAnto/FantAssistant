import { Component, computed, input } from '@angular/core';

import { MatchSpell } from '../../core/match-bonuses';
import { ROW_TREND_MATCHES, TrendCell } from '../../core/player-trend';
import { voteInk } from '../matches-table/vocabulary';
import { SpellMark } from '../spell-mark/spell-mark';

/**
 * I FANTAVOTI DELLE ULTIME PARTITE, con i due triangolini di chi è entrato o è uscito.
 *
 * Richiesta dell'operatore del 24/09/2026, prima sulle righe della plancia e poi sulla riga del
 * calciatore in asta: **due posti, un disegno**. Due copie di questa trasformazione sarebbero due modi
 * di stampare lo stesso fantavoto - e il giorno in cui una fascia di colore cambia, due schermate
 * darebbero allo stesso uomo due pagelle. È la stessa ragione per cui `ui/bonus-mark` esiste.
 *
 * L'INCHIOSTRO È `voteInk`, cioè le fasce della tabella e della card: un fantavoto è lo stesso metro
 * del voto più i bonus, come quella funzione dichiara di sé. Il TRATTINO non dice perché - la casella
 * vale «nessun fantavoto» e non separa la panchina dall'infortunio - ed è una scelta dichiarata: il
 * motivo lo portano le iconcine accanto al nome e la card, che è a un click.
 *
 * IL TRIANGOLINO È SOVRAPPOSTO A SINISTRA, dove il numero lascia spazio. In linea costerebbe altri
 * quattro pixel per cella, che su una riga della plancia sono sedici tolti al NOME; sovrapposto non
 * costa niente, perché la cella è larga quanto il numero più largo più quello che il triangolo chiede.
 * Le due misure sono MISURATE e non scelte: vedi `SIZES`.
 */
@Component({
  selector: 'ui-trend-votes',
  templateUrl: './trend-votes.html',
  imports: [SpellMark],
  host: { class: 'inline-flex items-center' },
})
export class TrendVotes {
  /** Le caselle già tagliate e già girate da `rowTrend`: qui non si decide quali partite sono. */
  readonly cells = input<readonly TrendCell[]>([]);
  /**
   * Quanto è largo il posto in cui va: `row` è la riga della plancia, `card` è la riga del lotto.
   *
   * Una TAGLIA e non un secondo componente, come per `ui-spell`: quello che cambia è quanti pixel ci
   * sono, non cosa il disegno significa.
   */
  readonly size = input<'row' | 'card'>('row');

  protected readonly geometry = computed(() => SIZES[this.size()]);

  protected readonly shown = computed<Shown[]>(() => {
    const cells = this.cells();
    const out: Shown[] = [];
    for (let at = 0; at < ROW_TREND_MATCHES; at += 1) {
      const cell = cells[at];
      const points = cell?.points ?? null;
      out.push({
        // Un decimale, che è la griglia su cui il fantacalcio pubblica (i mezzi punti): stamparne due
        // scriverebbe una precisione che la fonte non ha.
        text: points == null ? '·' : points.toFixed(1),
        ink: points == null ? 'text-muted' : voteInk(points),
        spell: cell?.spell ?? NO_SPELL,
        // Si chiede qui e non nel template perché il marchio si monta solo dove c'è: mille `ui-spell`
        // vuoti sono mille istanze che nessuno disegna.
        mark: !!cell && (cell.spell.on || cell.spell.off),
      });
    }
    return out;
  });
}

interface Shown {
  text: string;
  ink: string;
  spell: MatchSpell;
  mark: boolean;
}

const NO_SPELL: MatchSpell = { minutes: null, on: false, off: false };

/**
 * LE DUE GEOMETRIE, misurate nella pagina vera e non stimate.
 *
 * `row`: a 8px il fantavoto più largo che esista qui («14.0») misura 14,7px e la cella ne tiene 18,
 * quindi ne avanzano 3,3 - ed è da lì che viene il triangolo da 3, non il contrario. A 10px - il corpo
 * della riga - lo stesso numero ne chiede 18,3 e la cella 25, cioè 103 per quattro: più di quanti la
 * riga della plancia ne abbia da dare, e il nome sarebbe sceso a ventiquattro pixel.
 *
 * `card`: la riga del lotto è UNA sola e alta il triplo, quindi il vincolo non c'è. A 11px «14.0»
 * misura ~20px, la cella ne tiene 28 e il triangolo torna a 6, la taglia con cui è disegnato in ogni
 * altra tabella.
 */
const SIZES: Record<'row' | 'card', { cell: string; text: string; spell: 'xxs' | 'xs' }> = {
  row: { cell: 'w-[18px]', text: 'text-[8px]', spell: 'xxs' },
  card: { cell: 'w-[28px]', text: 'text-[11px]', spell: 'xs' },
};
