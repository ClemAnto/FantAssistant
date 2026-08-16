import { describe, expect, it } from 'vitest';

import { BundleTable } from './bundle';
import { CLEAN_SHEET_MIN_ROUNDS, CLEAN_SHEET_SHARE, clubCleanSheets } from './club-defence';

/**
 * Il record difensivo di un club, che è quello che l'icona dice - e le tre cose che deve NON fare:
 * contare due portieri come due giornate, leggere una stagione corta, e inventare uno zero.
 */
const table = (rows: unknown[][]): BundleTable => ({
  columns: ['season', 'role', 'team', 'platform', 'goals_conceded', 'status', 'matchday'],
  rows,
} as BundleTable);

/** Una stagione intera di un club: `clean` giornate a zero, il resto con un gol. */
const season = (year: string, club: string, clean: number, played = 38): unknown[][] =>
  Array.from({ length: played }, (_, md) =>
    [year, 'P', club, 'default', md < clean ? 0 : 1, 'played', md + 1]);

describe('clubCleanSheets', () => {
  it('conta le GIORNATE chiuse a zero, non le righe dei portieri', () => {
    // Un portiere sostituito lascia due righe sulla stessa giornata: la porta è una, e se una delle
    // due porta un gol la giornata non è inviolata.
    const rows = season('2025-26', 'Inter', 20);
    rows.push(['2025-26', 'P', 'Inter', 'default', 1, 'played', 1]);
    const inter = clubCleanSheets(table(rows), 'default').get('Inter')!;
    expect(inter.played).toBe(38);
    expect(inter.clean).toBe(19);
  });

  it('tiene l\'ULTIMA stagione misurata, che è quella con la rosa più simile a quella che si compra', () => {
    const rows = [...season('2024-25', 'Roma', 8), ...season('2025-26', 'Roma', 18)];
    const roma = clubCleanSheets(table(rows), 'default').get('Roma')!;
    expect(roma.season).toBe('2025-26');
    expect(roma.share).toBeCloseTo(18 / 38, 6);
  });

  it('tace su una stagione corta invece di leggerne la quota', () => {
    const short = season('2025-26', 'Pisa', 8, CLEAN_SHEET_MIN_ROUNDS - 1);
    expect(clubCleanSheets(table(short), 'default').has('Pisa')).toBe(false);
  });

  it('non risponde per un promosso: «vuoto = ignoto», mai una porta che subisce sempre', () => {
    const rows = season('2025-26', 'Inter', 19);
    expect(clubCleanSheets(table(rows), 'default').has('Frosinone')).toBe(false);
  });

  it('legge un listone alla volta: le due piattaforme sono due calendari', () => {
    const rows = [...season('2025-26', 'Inter', 19)];
    expect(clubCleanSheets(table(rows), 'euro').size).toBe(0);
  });

  it('salta le giornate senza un portiere a voto invece di contarle come subite', () => {
    const rows = season('2025-26', 'Como', 19);
    rows.push(['2025-26', 'P', 'Como', 'default', null, 'no_vote', 39]);
    const como = clubCleanSheets(table(rows), 'default').get('Como')!;
    expect(como.played).toBe(38);
    expect(como.share).toBeGreaterThanOrEqual(CLEAN_SHEET_SHARE);
  });
});
