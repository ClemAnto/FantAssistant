import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { TrendCell, TrendState, VOTE_TREND_MATCHES, trendPointsMean, trendVoteMean } from '../../core/player-trend';
import { VoteTrend, trendRise, voteFill, voteTrendLines } from './vote-trend';

/**
 * Le regole del disegno sono dell'operatore (26/09/2026) e si verificano sui NUMERI che il componente
 * scrive - altezza, colore, opacita' - e non guardandolo: uno scatto mostra un rendering, non dice che
 * il 6 e' ancora una pallina o che il voto 10 arriva al 120%.
 */
function cell(state: TrendState | null, vote: number | null = null, minutes: number | null = 90): TrendCell {
  return {
    date: state ? '2026-09-20' : '',
    state,
    points: vote,
    vote,
    opponent: state ? 'Cagliari' : null,
    home: state ? true : null,
    spell: { minutes: state === 'p' ? minutes : null, on: false, off: false },
  };
}

function draw(cells: TrendCell[]): HTMLElement[] {
  const fixture = TestBed.createComponent(VoteTrend);
  fixture.componentRef.setInput('cells', cells);
  fixture.detectChanges();
  return [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-vote-bar]')];
}

describe('ui-vote-trend', () => {
  it('disegna sempre cinque posti, anche su una finestra piu corta', () => {
    const bars = draw([cell('p', 6.5)]);
    expect(bars).toHaveLength(VOTE_TREND_MATCHES);
    // Le partite che mancano sono le piu' VECCHIE, quindi stanno a sinistra.
    expect(bars.slice(0, -1).every((bar) => bar.classList.contains('invisible'))).toBe(true);
    expect(bars.at(-1)!.classList.contains('invisible')).toBe(false);
  });

  it('dalla piu vecchia a sinistra alla piu recente a destra', () => {
    // Le caselle arrivano dalla piu' recente: 9 e' l'ultima partita giocata, 5 la piu' vecchia.
    const bars = draw([cell('p', 9), cell('p', 8), cell('p', 7), cell('p', 6), cell('p', 5)]);
    expect(bars.at(-1)!.style.background).toContain('vote-top');
    expect(bars[0].style.background).toContain('warning');
  });

  it('resta una pallina fino al 6 e cresce dopo', () => {
    const [rising, six, low] = draw([cell('p', 5), cell('p', 6), cell('p', 6.5)]).slice(-3);
    expect(low.style.height).toBe('4px');
    expect(six.style.height).toBe('4px');
    expect(rising.style.height).toContain('calc');
    expect(trendRise(6)).toBe(0);
    expect(trendRise(6.5)).toBeCloseTo(0.125);
    expect(trendRise(8)).toBeCloseTo(0.5);
  });

  it('al voto 10 arriva al 120% del contenitore', () => {
    expect(trendRise(10)).toBe(1);
    const top = draw([cell('p', 10)]).at(-1)!;
    expect(top.style.height).toContain('120%');
  });

  it('le quattro fasce del voto', () => {
    expect(voteFill(4.5)).toContain('vote-poor');
    expect(voteFill(4)).toContain('vote-poor');
    expect(voteFill(5)).toContain('warning');
    expect(voteFill(5.5)).toContain('warning');
    expect(voteFill(6)).toContain('vote-good');
    expect(voteFill(6.5)).toContain('vote-good');
    // Il 7 e' azzurro (correzione dell'operatore, 26/09/2026): la fascia alta parte da li'.
    expect(voteFill(7)).toContain('vote-top');
    expect(voteFill(7.5)).toContain('vote-top');
  });

  it('senza voto e un puntino da 2.5: grigio scuro, viola per l infortunio', () => {
    const [noVote, banned, injured, bench] = draw([
      cell('b'), cell('i'), cell('s'), cell('p', null),
    ]).slice(-4);
    for (const dot of [noVote, banned, injured, bench]) {
      expect(dot.style.width).toBe('2.5px');
      expect(dot.style.height).toBe('2.5px');
      // Il posto resta largo quanto una barretta: 2.5 + 2 x 0.75 = 4.
      expect(dot.style.marginInline).toBe('0.75px');
    }
    expect(bench.style.background).toContain('absent-out');
    expect(noVote.style.background).toContain('absent-out');
    expect(banned.style.background).toContain('absent-out');
    expect(injured.style.background).toContain('absent-injury');
  });

  it('sotto i 75 minuti la barretta e a meta opacita', () => {
    const [unknown, full, short] = draw([cell('p', 7, 60), cell('p', 7, 75), cell('p', 7, null)]).slice(-3);
    expect(short.classList.contains('opacity-50')).toBe(true);
    expect(full.classList.contains('opacity-50')).toBe(false);
    expect(unknown.classList.contains('opacity-50')).toBe(false);
  });
});

describe('trendVoteMean', () => {
  it('un voto che non c e vale 5, una partita che non esiste non conta', () => {
    // 7 + 6 + panchina(5) + senza voto(5) = 23 su quattro partite: la quinta casella non esiste.
    expect(trendVoteMean([cell('p', 7), cell('p', 6), cell('b'), cell('p', null), cell(null)]))
      .toBeCloseTo(5.75);
  });

  it('nessuna partita, nessuna media', () => {
    expect(trendVoteMean([cell(null), cell(null)])).toBeNull();
    expect(trendVoteMean([])).toBeNull();
  });
});

describe('trendPointsMean', () => {
  it('un fantavoto che non c e vale 5, una partita che non esiste non conta', () => {
    // 10,5 + 6 + panchina(5) + senza fantavoto(5) = 26,5 su quattro partite: la quinta casella non esiste.
    expect(trendPointsMean([{ ...cell('p', 7), points: 10.5 }, cell('p', 6), cell('b'), cell('p', null), cell(null)]))
      .toBeCloseTo(6.625);
  });

  it('nessuna partita, nessuna media', () => {
    expect(trendPointsMean([cell(null)])).toBeNull();
  });
});

describe('voteTrendLines', () => {
  it('una riga per partita, nella forma dettata: squadre, risultato, fantavoto (voto+bonus), minuti', () => {
    const lines = voteTrendLines(
      [{ ...cell('p', 7.5, 88), points: 10.5 }, cell('b'), { ...cell('p', 6, 90), home: false }, cell(null)],
      'Atalanta',
      (one) => (one.spell.minutes === 88
        ? { team: 'Atalanta', opponent: 'Cagliari', home: true, goalsFor: 3, goalsAgainst: 0 }
        : null),
    );
    // Nello stesso verso delle barrette: la piu' vecchia (l'ultima casella) e' la riga 1, e la casella
    // che non e' una partita non diventa una riga.
    expect(lines).toEqual([
      // In trasferta la squadra di casa va prima; senza risultato noto la riga non ne inventa uno, e
      // senza bonus la parentesi non ripete il numero.
      "1) Cag-Ata - 6 - 90'",
      '2) Ata-Cag - panchina',
      "3) Ata-Cag 3-0 - 10.5 (7.5+3) - 88'",
    ]);
  });

  it('un malus si scrive col meno', () => {
    const [line] = voteTrendLines([{ ...cell('p', 6, 90), points: 5.5 }], 'Roma', () => null);
    expect(line).toBe("1) Rom-Cag - 5.5 (6-0.5) - 90'");
  });
});
