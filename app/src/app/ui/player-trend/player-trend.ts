import { Component, computed, input } from '@angular/core';

import { PlayerTrend, TrendMatch, TrendState } from '../../core/player-trend';

/** Where a bar starts and where it tops out, on the VOTO. A DISPLAY scale and nothing else: it is
 *  declared here, no valuation reads it, and it is the same one the toolkit's panel draws with. */
export const VOTE_FLOOR = 4;
export const VOTE_CEIL = 8;

/** The bands, best first. A fantacalcio voto lives on its own scale - 6 is the average match, 7 a very
 *  good one - which is why these are not the provider's 1-10 rating bands. */
const BANDS: readonly [number, string][] = [
  [7.5, 'var(--color-vote-top)'],
  [7.0, 'var(--color-vote-high)'],
  [6.5, 'var(--color-vote-good)'],
  [6.0, 'var(--color-vote-mid)'],
  [5.5, 'var(--color-vote-low)'],
  [0, 'var(--color-vote-poor)'],
];

/** Four reasons for an empty bar, four colours, because they are four different facts - and only the
 *  first says he was available and was not chosen. */
const ABSENT: Record<string, string> = {
  b: 'var(--color-absent-bench)',
  i: 'var(--color-absent-injury)',
  s: 'var(--color-absent-ban)',
  o: 'var(--color-absent-out)',
  n: 'var(--color-absent-unknown)',
  x: 'var(--color-absent-bench)',
};

const STATE_LABEL: Record<TrendState, string> = {
  p: 'giocata',
  b: 'in panchina, non entrato',
  i: 'infortunato',
  s: 'squalificato',
  o: 'fuori dai convocati',
  n: 'nessun dato per questa partita',
  x: "in formazione, nessuna statistica pubblicata",
};

const COMPETITION_LABEL: Record<string, string> = {
  serie_a: 'Serie A',
  premier_league: 'Premier League',
  la_liga: 'LaLiga',
  bundesliga: 'Bundesliga',
  ligue_1: 'Ligue 1',
  serie_b: 'Serie B',
};

/** Geometry, in the SVG's own units: ten matches of ten, and two pixels under the bars for the mark
 *  that says the euro calendar never counted that round. */
const BAR_W = 10;
const BAR_H = 18;
const GAP = 2;
/** The cell is seven units of voto plus two of xG+xA: the second layer sits BESIDE the bar, never
 *  over it, or a striker's expectation would eat the height that says how he actually played. */
const XGA_W = 2;
const VOTE_W = BAR_W - XGA_W - 1;

interface Bar {
  key: string;
  x: number;
  /** Null when he did not play: the cell then draws a plinth in the reason's own colour. */
  y: number | null;
  height: number;
  width: number;
  colour: string;
  /** A synthetic voto is drawn hollow: the same number, from a round the game never voted. */
  hollow: boolean;
  xgaY: number | null;
  xgaHeight: number;
  goal: boolean;
  assist: boolean;
  card: string | null;
  outside: boolean;
  title: string;
}

/**
 * The last ten championship matches as bars: how he played, and whether he played at all.
 *
 * Four channels and each answers a different question, because at ten pixels a shade of another channel
 * is unreadable. HEIGHT is the voto on the declared scale; a HOLLOW bar means that voto is the
 * calibrated synthetic one, from a round the EuroLeghe calendar skipped; a two-unit PLINTH instead of a
 * bar is a match he did not play, coloured by the reason - and «he did not play» must never read as a
 * bad performance, because availability is 90% of the variance of fantapunti. The purple column beside
 * each bar is xG+xA: a man can play well and finish badly, and adding the two into one number would
 * hide exactly that.
 *
 * The data is the toolkit's (`desc_trend_detail`) and is not recomputed here - see `core/player-trend`.
 */
@Component({
  selector: 'ui-trend',
  templateUrl: './player-trend.html',
  host: { class: 'inline-block shrink-0 leading-none' },
})
export class PlayerTrendStrip {
  readonly trend = input.required<PlayerTrend | null | undefined>();

  protected readonly width = computed(() => BAR_W * Math.max(this.matches().length, 1));
  protected readonly height = BAR_H + GAP;

  private readonly matches = computed(() => this.trend()?.matches ?? []);

  protected readonly bars = computed<Bar[]>(() =>
    this.matches().map((match, index) => this.bar(match, index)),
  );

  /** What the strip is, in one line, for the reader who wants the numbers rather than the picture. */
  protected readonly summary = computed(() => {
    const trend = this.trend();
    if (!trend?.matches.length) return 'Nessuna partita di campionato recente per il suo club.';
    const mean =
      trend.fp == null
        ? 'nessuna delle dieci è valutabile'
        : `media ${trend.fp.toFixed(2)} fantapunti sulle ${trend.scored} valutabili`;
    return (
      `Ultime ${trend.window} di campionato del suo club: ${trend.played} giocate, ` +
      `${trend.bench} in panchina · ${mean} (una non giocata vale 0, una senza voto non entra nella ` +
      `media) · ${trend.outsideEuro} sono giornate che il calendario EuroLeghe non ha contato. ` +
      'Descrive quello che ha fatto, non prevede quello che farà.'
    );
  });

  private bar(match: TrendMatch, index: number): Bar {
    const x = index * BAR_W;
    const played = match.state === 'p' && match.vote != null;
    const share = played
      ? (Math.min(match.vote as number, VOTE_CEIL) - VOTE_FLOOR) / (VOTE_CEIL - VOTE_FLOOR)
      : 0;
    const room = BAR_H - 4; // the top is left to the goal mark
    const height = played ? Math.max(2, Math.min(room, Math.round(share * room))) : 2;
    const xga = match.xga;
    // Nothing is drawn at zero: at two units a floor of one is indistinguishable from a small value,
    // so the number lives in the tooltip and the column only ever means «he created something».
    const xgaHeight = xga == null ? 0 : Math.min(room, Math.round(Math.min(xga, 1) * room));
    return {
      key: `${match.date}|${match.opponent}`,
      x,
      y: played ? BAR_H - height : null,
      height,
      width: VOTE_W,
      colour: played ? band(match.vote as number) : (ABSENT[match.state] ?? ABSENT['n']),
      hollow: match.voteSource === 'synth',
      xgaY: !xgaHeight || !played ? null : BAR_H - xgaHeight,
      xgaHeight,
      goal: match.goals > 0,
      assist: match.goals === 0 && match.assists > 0,
      card: match.reds ? 'var(--color-vote-poor)' : match.yellows ? 'var(--color-vote-low)' : null,
      outside: match.inEuro === false,
      title: title(match),
    };
  }
}

function band(vote: number): string {
  for (const [floor, colour] of BANDS) {
    if (vote >= floor) return colour;
  }
  return BANDS[BANDS.length - 1][1];
}

function title(match: TrendMatch): string {
  const when = match.date.split('-').reverse().join('/');
  const competition = COMPETITION_LABEL[match.competition] ?? match.competition;
  const where = `${match.home ? 'vs' : '@'} ${match.opponent}`;
  const parts = [`${when} · ${competition} ${where}`, STATE_LABEL[match.state]];
  if (match.state === 'p') {
    parts.push(`${match.minutes ?? '?'}′${match.started ? ' da titolare' : ' entrando'}`);
    if (match.vote != null) {
      parts.push(
        `voto ${match.vote.toFixed(2)}${match.voteSource === 'synth' ? ' (sintetico calibrato)' : ''}`,
      );
    } else {
      parts.push('senza voto');
    }
    if (match.points != null) parts.push(`${match.points.toFixed(1)} fantapunti`);
    if (match.goals) parts.push(`${match.goals} gol`);
    if (match.assists) parts.push(`${match.assists} assist`);
    if (match.yellows) parts.push('ammonito');
    if (match.reds) parts.push('espulso');
    if (match.xga != null) parts.push(`xG+xA ${match.xga.toFixed(2)}`);
  }
  if (match.inEuro === false) parts.push('giornata fuori dal calendario EuroLeghe');
  return parts.join(' · ');
}
