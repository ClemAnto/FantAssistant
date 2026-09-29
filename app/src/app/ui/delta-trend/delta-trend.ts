import { Component, computed, input } from '@angular/core';

import { TREND_DELTA_BASE, TrendCell } from '../../core/player-trend';
import { Bar, TrendScale, trendBars, voteTrendWords } from '../vote-trend/vote-trend';

/**
 * IL TREND DEL FANTAVOTO MENO 6: le stesse cinque barrette di `ui-vote-trend`, su un'altra misura
 * (operatore, 26/09/2026: «un component analogo ma al posto dei voti utilizza il fantavoto-6»).
 *
 * Il delta dice quanto una partita ha reso SOPRA o SOTTO la sufficienza, bonus e malus compresi - cioe'
 * quello che la rosa incassa - mentre il voto base e' quello che i modificatori leggono. Due domande,
 * due strisce, e un disegno solo (`trendBars`): cambiano la misura, i colori e da dove comincia a
 * crescere; il resto e' identico, anche le assenze, che dicono la stessa cosa nelle due strisce.
 *
 * LE SUE REGOLE, tutte scelte di visualizzazione e nessuna una misura:
 * - delta 0 grigio · da -1 a -0,5 ambra · sotto -1 rosso · fino a +4 verde · oltre +4 azzurro;
 * - la barretta e' una pallina fino a 0 e cresce solo per un delta positivo, fino al 120% del
 *   contenitore a `DELTA_TOP`.
 *
 * Il TEMPLATE e' quello di `ui-vote-trend`, letto dallo stesso file: il disegno e' uno, e due copie di
 * un ciclo di cinque barrette finirebbero per incolonnarsi in due modi.
 */
@Component({
  selector: 'ui-delta-trend',
  templateUrl: '../vote-trend/vote-trend.html',
  host: {
    class: 'inline-flex shrink-0 items-center gap-0.5',
    '[style.height.px]': 'height()',
    role: 'img',
    '[attr.aria-label]': 'summary()',
  },
})
export class DeltaTrend {
  /** Le caselle gia' tagliate e gia' girate da `rowTrend`. */
  readonly cells = input<readonly TrendCell[]>([]);
  /** La larghezza di una barretta in pixel, che e' anche la sua altezza minima. */
  readonly bar = input(4);
  /** L'altezza del contenitore in pixel: `DELTA_TOP` ne occupa il 120%. */
  readonly height = input(12);

  protected readonly bars = computed<Bar[]>(() => trendBars(this.cells(), this.bar(), DELTA_SCALE));

  /** Le cinque partite in parole, sul FANTAVOTO: la misura che questa striscia disegna. */
  protected readonly summary = computed(() => voteTrendWords(this.cells(), (cell) => cell.points));
}

/** La sufficienza da cui il delta si conta: una definizione sola, accanto alla sua media. */
export const DELTA_BASE = TREND_DELTA_BASE;

/**
 * IL DELTA CHE ARRIVA AL 120%: +6, cioe' un fantavoto di 12 (una partita da gol e assist).
 *
 * Scelta di disegno e non una misura. La striscia del voto sale per quattro punti (dal 6 al 10), ma un
 * fantavoto ha una coda che il voto non ha - un gol vale tre punti da solo - e su una corsa di quattro
 * mezzo listone di attaccanti toccherebbe il tetto. Oltre il +6 la barretta resta al 120%.
 */
export const DELTA_TOP = 6;

/** Il fantavoto meno 6 di una partita, o `null` dove un fantavoto non c'e'. */
export function deltaOf(cell: TrendCell): number | null {
  return cell.points == null ? null : cell.points - DELTA_BASE;
}

/**
 * Le cinque fasce del delta (operatore, 26/09/2026, riviste lo stesso giorno): sotto -1 rosso, da -1 a
 * sotto 0 ambra, 0 grigio, fino a +4 verde, oltre +4 azzurro. Il -1 esatto cade nell'AMBRA: la regola
 * dice rosso solo «sotto -1», e fra le fasce dichiarate l'ambra e' quella che lo tocca.
 */
export function deltaFill(delta: number): string {
  // Arrotondato al centesimo prima di confrontare: `-1` letto come `-1.0000001` finirebbe nel rosso.
  const at = Math.round(delta * 100) / 100;
  if (at < -1) return 'var(--color-vote-poor)';
  if (at < 0) return 'var(--color-warning)';
  if (at === 0) return 'var(--color-vote-mid)';
  if (at <= 4) return 'var(--color-vote-good)';
  return 'var(--color-vote-top)';
}

/** Quanto della corsa fra la pallina e il 120% un delta ha fatto: 0 fino a 0, 1 a `DELTA_TOP`. */
export function deltaRise(delta: number): number {
  return delta <= 0 ? 0 : Math.min(1, delta / DELTA_TOP);
}

export const DELTA_SCALE: TrendScale = { measure: deltaOf, rise: deltaRise, fill: deltaFill };
