import { Component, computed, input } from '@angular/core';

import { TrendCell, TrendState, VOTE_TREND_MATCHES } from '../../core/player-trend';
import { abbreviate } from '../../core/players-store';

/**
 * IL TREND DEL VOTO: cinque barrette a pillola, una per partita (operatore, 26/09/2026).
 *
 * Il suo disegno, regola per regola, e nessuna e' una misura - sono tutte scelte di VISUALIZZAZIONE e
 * nessuna valutazione le legge:
 * - l'ALTEZZA segue il voto BASE: ferma al minimo fino al 6, poi cresce in modo proporzionale fino al
 *   10, dove vale il 120% del contenitore. Il minimo e' la LARGHEZZA, cosi' la forma di base e' una
 *   pallina. Le barrette sono CENTRATE in verticale e non appoggiate sul fondo;
 * - il COLORE ha quattro fasce di voto (≤ 4,5 rosso · < 6 ambra · 6-6,5 verde · da 7 azzurro, il 7
 *   compreso su sua correzione dello stesso giorno);
 * - sotto i 75 minuti la barretta e' a META' opacita': ha giocato, ma non tutta la partita;
 * - una partita SENZA VOTO - panchina, infortunio, squalifica, fuori dai convocati, s.v., nessun dato -
 *   e' un PUNTINO da 2,5 x 2,5 (operatore, 27/09/2026): grigio scuro, e viola per l'infortunio. Piccolo
 *   apposta, perche' in quella partita non c'e' un numero da disegnare, e il vuoto lo si vede subito
 *   accanto alle palline di chi ha giocato. Sostituisce la barretta grigia della panchina e l'anello
 *   delle altre assenze, che erano la prima versione.
 *
 * La casella di una partita che il suo club non ha giocato (una finestra piu' corta di cinque) resta
 * VUOTA ma occupa il suo posto, perche' le colonne di due righe sorelle devono incolonnarsi - e per la
 * stessa ragione il puntino tiene la LARGHEZZA di una barretta, centrato con un margine.
 *
 * LE CASELLE ARRIVANO GIA' TAGLIATE da `rowTrend` - la piu' recente per prima, il verso dichiarato di
 * questa app per le «ultime partite» - e qui non si decide quali partite sono: una seconda finestra
 * sarebbe una seconda risposta a «quali sono le sue ultime cinque». Il DISEGNO pero' le mette dalla
 * piu' vecchia a sinistra alla piu' recente a destra (operatore, 26/09/2026): e' un andamento.
 *
 * L'altezza delle barrette e' in PERCENTUALE del contenitore e non in pixel, e il contenitore lo
 * dimensiona chi ospita il componente con `height` - un INPUT e non una classe `h-*` sul tag, perche'
 * due utility sulla stessa proprieta' si decidono sull'ordine del CSS generato (misurato: `h-2.5` sul
 * tag perdeva contro l'`h-3` dell'ospite).
 */
@Component({
  selector: 'ui-vote-trend',
  templateUrl: './vote-trend.html',
  host: {
    // AL CENTRO, in verticale (operatore, 26/09/2026): la pallina di un 6 sta a meta' della riga come
    // le cifre accanto, e una barretta alta cresce verso l'alto e verso il basso insieme - al voto 10
    // esce del 10% da tutt'e due i lati, che e' il 120% chiesto.
    class: 'inline-flex shrink-0 items-center gap-0.5',
    '[style.height.px]': 'height()',
    role: 'img',
    '[attr.aria-label]': 'summary()',
  },
})
export class VoteTrend {
  /** Le caselle gia' tagliate e gia' girate da `rowTrend`. */
  readonly cells = input<readonly TrendCell[]>([]);
  /** La larghezza di una barretta in pixel, che e' anche la sua altezza minima. */
  readonly bar = input(4);
  /** L'altezza del contenitore in pixel: il voto 10 ne occupa il 120%. */
  readonly height = input(12);

  protected readonly bars = computed<Bar[]>(() => trendBars(this.cells(), this.bar(), VOTE_SCALE));

  /** Le cinque partite in parole, per chi non vede il disegno. */
  protected readonly summary = computed(() => voteTrendWords(this.cells()));
}

/**
 * LE CINQUE PARTITE IN PAROLE, la piu' recente prima: la stessa frase per l'etichetta accessibile e per
 * il suggerimento di chi ospita il disegno, cosi' le due non si contraddicono.
 */
export function voteTrendWords(
  cells: readonly TrendCell[],
  measure: (cell: TrendCell) => number | null = (cell) => cell.vote,
): string {
  return (
    `Ultime ${VOTE_TREND_MATCHES}, dalla più vecchia: ` +
    cells.slice(0, VOTE_TREND_MATCHES).reverse().map((cell) => wordOf(cell, measure)).join(' · ')
  );
}

/**
 * LA MISURA CHE UNA STRISCIA DISEGNA: quale numero della partita, quanto sale, di che colore.
 *
 * Esiste perche' le strisce sono DUE (operatore, 26/09/2026): il voto base (`ui-vote-trend`) e il
 * fantavoto meno 6 (`ui-delta-trend`). Tutto il resto - cinque posti, il verso, la pallina come
 * minimo, il 120%, la meta' opacita' sotto i 75', i colori delle assenze - e' lo STESSO disegno, e sta
 * in `trendBars` una volta sola: due copie finirebbero per dire la panchina in due colori.
 */
export interface TrendScale {
  /** Il numero della partita che la barretta disegna, o `null` dove non c'e'. */
  measure(cell: TrendCell): number | null;
  /** Quanto della corsa fra la pallina e il 120% quel numero ha fatto: fra 0 e 1. */
  rise(value: number): number;
  fill(value: number): string;
}

export interface Bar {
  /** La regola CSS dell'altezza: `calc` fra il minimo in pixel e il 120% del contenitore. */
  height: string;
  width: string;
  /** Il riempimento, o `null` per la casella che non esiste. */
  fill: string | null;
  /** Il margine orizzontale del puntino, che tiene il posto largo quanto una barretta. */
  inset: string | null;
  /** Sotto i 75 minuti. */
  dim: boolean;
  /** La partita non esiste: il posto resta, il disegno no. */
  void: boolean;
}

/** Dal 6 in giu' la barretta e' una pallina; dal 6 al 10 cresce in proporzione fino al 120%. */
export const TREND_FLAT_UNTIL = 6;
export const TREND_TOP_VOTE = 10;
export const TREND_TOP_SHARE = 1.2;
/** Sotto questi minuti la barretta va a meta' opacita' (operatore, 26/09/2026). */
export const TREND_FULL_MINUTES = 75;

/**
 * LE FASCE, sul voto base (operatore, 26/09/2026). I colori sono i token del tema che l'istogramma delle
 * ultime dieci usa gia' (`--color-vote-*`, `--color-absent-*`): una seconda palette per lo stesso voto
 * sarebbe una seconda legenda.
 */
export function voteFill(vote: number): string {
  if (vote <= 4.5) return 'var(--color-vote-poor)';
  if (vote < 6) return 'var(--color-warning)';
  if (vote < 7) return 'var(--color-vote-good)';
  return 'var(--color-vote-top)';
}

/**
 * IL PUNTINO DI UNA PARTITA SENZA VOTO: 2,5 px di lato (operatore, 27/09/2026: prima 1,5,
 * «troppo piccolo», poi 2), viola per l'infortunio e grigio scuro per tutto il resto.
 *
 * Il grigio scuro e' `--color-absent-out` e non `--color-absent-unknown`, che e' piu' scuro ancora: su
 * un puntino di due pixel e mezzo, sopra il fondo della pastiglia, quello quasi sparisce - e un segno che
 * non si vede e' un segno che non c'e'.
 */
export const TREND_DOT = 2.5;
const DOT_FILL = 'var(--color-absent-out)';
const INJURY_FILL = 'var(--color-absent-injury)';

/** Quanto della corsa fra il minimo e il 120% un voto ha fatto: 0 fino al 6, 1 al 10. */
export function trendRise(vote: number | null): number {
  if (vote == null || vote <= TREND_FLAT_UNTIL) return 0;
  return Math.min(1, (vote - TREND_FLAT_UNTIL) / (TREND_TOP_VOTE - TREND_FLAT_UNTIL));
}

/** La scala del voto base: pallina fino al 6, 120% al 10. */
export const VOTE_SCALE: TrendScale = {
  measure: (cell) => cell.vote,
  rise: trendRise,
  fill: voteFill,
};

/**
 * LE CINQUE BARRETTE, su una scala qualunque.
 *
 * DALLA PIU' VECCHIA A SINISTRA alla piu' recente a destra (operatore, 26/09/2026): e' un ANDAMENTO,
 * e si legge come un grafico nel tempo. Le caselle arrivano nel verso dell'app per le «ultime partite»
 * (la piu' recente prima), quindi si girano qui e solo qui - il taglio resta quello di `rowTrend`.
 * Girandole, le caselle che non esistono finiscono a SINISTRA, cioe' dal lato delle partite che il suo
 * club non ha ancora giocato, che e' dove mancano.
 */
export function trendBars(cells: readonly TrendCell[], width: number, scale: TrendScale): Bar[] {
  const out: Bar[] = [];
  for (let at = 0; at < VOTE_TREND_MATCHES; at += 1) out.push(barOf(cells[at], width, scale));
  return out.reverse();
}

function barOf(cell: TrendCell | undefined, width: number, scale: TrendScale): Bar {
  const px = `${width}px`;
  const base = { width: px, height: px, fill: null, inset: null, dim: false, void: false };
  if (!cell || cell.state == null) return { ...base, void: true };
  const value = cell.state === 'p' ? scale.measure(cell) : null;
  if (value != null) {
    const rise = scale.rise(value);
    const minutes = cell.spell.minutes;
    return {
      ...base,
      height: rise ? `calc(${px} + (${TREND_TOP_SHARE * 100}% - ${px}) * ${rise.toFixed(4)})` : px,
      fill: scale.fill(value),
      dim: minutes != null && minutes < TREND_FULL_MINUTES,
    };
  }
  const dot = `${TREND_DOT}px`;
  return {
    ...base,
    width: dot,
    height: dot,
    inset: `${Math.max(0, (width - TREND_DOT) / 2)}px`,
    fill: cell.state === 'i' ? INJURY_FILL : DOT_FILL,
  };
}

/**
 * COME ANDO' UNA PARTITA, dalla parte di chi la guarda: le due squadre (in casa per prima) e il
 * risultato. Il record del foglio porta l'avversario e il campo ma non il punteggio, quindi il
 * chiamante lo cerca dove l'app lo ha gia' (le partite che la card legge) e lo passa qui; dove non lo
 * trova, la riga dice la partita senza risultato invece di inventarne uno.
 */
export interface TrendFixture {
  team: string | null;
  opponent: string | null;
  home: boolean | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
}

/**
 * LE CINQUE PARTITE COME RIGHE DEL SUGGERIMENTO (operatore, 26/09/2026):
 * `1) Ata-Cag 3-0 - 10.5 (7.5+3) - 88'`.
 *
 * NELLO STESSO VERSO DELLE BARRETTE: la piu' vecchia per prima e la piu' recente in fondo, cosi' la
 * riga `n` e' la barretta `n` da sinistra. Due versi fra il disegno e la sua didascalia farebbero
 * leggere a chi guarda la prima barretta la partita dell'ultima.
 *
 * Il FANTAVOTO prima, poi fra parentesi il voto e i bonus che lo compongono - e i bonus sono la
 * sottrazione fra i due, non un terzo numero: chi legge `10.5 (7.5+3)` rifa' il conto da se'. Dove i
 * bonus sono zero la parentesi non si stampa, perche' `6 (6+0)` ripete il numero che sta accanto.
 *
 * Il separatore dei decimali e' il PUNTO, come in tutta l'app (regola dell'operatore del 05/09/2026).
 * Chi non ha il voto dice perche' al posto dei numeri (`panchina`, `infortunato`...), e una casella che
 * non e' una partita non diventa una riga.
 */
export function voteTrendLines(
  cells: readonly TrendCell[],
  club: string | null,
  fixtureOf: (cell: TrendCell) => TrendFixture | null,
): string[] {
  const out: string[] = [];
  const played = cells
    .slice(0, VOTE_TREND_MATCHES)
    .filter((cell): cell is TrendCell & { state: TrendState } => cell.state != null)
    .reverse();
  played.forEach((cell, at) => {
    const found = fixtureOf(cell);
    const team = found?.team ?? club;
    const opponent = found?.opponent ?? cell.opponent;
    const home = found?.home ?? cell.home;
    const [left, right] = home === false ? [opponent, team] : [team, opponent];
    const [leftGoals, rightGoals] = home === false
      ? [found?.goalsAgainst, found?.goalsFor]
      : [found?.goalsFor, found?.goalsAgainst];
    const score = leftGoals != null && rightGoals != null ? ` ${leftGoals}-${rightGoals}` : '';
    const parts = [`${at + 1}) ${abbreviate(left)}-${abbreviate(right)}${score}`];
    if (cell.state === 'p' && cell.vote != null) {
      const points = cell.points ?? cell.vote;
      const bonus = points - cell.vote;
      const split = Math.abs(bonus) < 1e-9 ? '' : ` (${plain(cell.vote)}${bonus > 0 ? '+' : '-'}${plain(Math.abs(bonus))})`;
      parts.push(`${plain(points)}${split}`);
      if (cell.spell.minutes != null) parts.push(`${cell.spell.minutes}'`);
    } else {
      parts.push(STATE_WORD[cell.state]);
    }
    out.push(parts.join(' - '));
  });
  return out;
}

/** Un voto come si legge: `7.5`, `6`, `0.5` - al piu' due decimali, e nessuno zero di coda. */
function plain(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const STATE_WORD: Record<TrendState, string> = {
  p: 'senza voto',
  b: 'panchina',
  i: 'infortunato',
  s: 'squalificato',
  o: 'non convocato',
  n: 'nessun dato',
  x: 'senza voto',
};

function wordOf(cell: TrendCell, measure: (cell: TrendCell) => number | null): string {
  if (cell.state == null) return 'nessuna partita';
  const value = cell.state === 'p' ? measure(cell) : null;
  if (value != null) {
    const minutes = cell.spell.minutes;
    return `${value.toFixed(1)}${minutes != null ? ` (${minutes}′)` : ''}`;
  }
  return STATE_WORD[cell.state];
}
