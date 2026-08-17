import { describe, expect, it } from 'vitest';

import { BundleTable } from './bundle';
import { buildCurves, euros, trendOf, yearBefore } from './market-trend';

/** Una curva come la scrive l'export: header e righe posizionali. */
function table(rows: [number, string, number | null][]): BundleTable {
  return {
    table: 'market_value_history',
    columns: ['fc_id', 'observed_on', 'source', 'value', 'club', 'age'],
    rows: rows.map(([id, on, value]) => [id, on, 'transfermarkt', value, 'Inter', 27]),
  };
}

const TODAY = '2026-08-17';

describe('trendOf', () => {
  it('confronta l\'ultimo punto con quello di un anno prima, non col primo dopo', () => {
    const points = buildCurves(table([
      [1, '2025-04-01', 20_000_000],   // un anno prima: questo è il riferimento
      [1, '2025-10-01', 35_000_000],   // dentro l'anno: è una variazione già avvenuta
      [1, '2026-06-01', 40_000_000],
    ])).get(1);
    const trend = trendOf(points, TODAY)!;
    expect(trend.value).toBe(40_000_000);
    expect(trend.at).toBe('2026-06-01');
    expect(trend.from!.on).toBe('2025-04-01');
    expect(trend.change).toBeCloseTo(1.0, 6);
    expect(trend.direction).toBe('up');
  });

  it('la banda del ±15% è una direzione e non una graduatoria', () => {
    const flat = trendOf(buildCurves(table([
      [1, '2025-01-01', 20_000_000], [1, '2026-01-01', 22_000_000],
    ])).get(1), TODAY)!;
    expect(flat.direction).toBe('flat');
    const down = trendOf(buildCurves(table([
      [1, '2025-01-01', 20_000_000], [1, '2026-01-01', 12_000_000],
    ])).get(1), TODAY)!;
    expect(down.direction).toBe('down');
  });

  it('senza un punto di un anno prima il VALORE c\'è e la tendenza è IGNOTA, mai «ferma»', () => {
    // Il caso vero: 26 quotati su 1.175 (17/08/2026) - chi è appena entrato nel giro della fonte, e chi
    // ha un solo punto vecchio portato dal taglio del bundle. Dire «ferma» inventerebbe una notizia dal
    // silenzio, che è lo stesso difetto di leggere una cella vuota come uno zero.
    const trend = trendOf(buildCurves(table([[1, '2026-03-01', 5_000_000]])).get(1), TODAY)!;
    expect(trend.value).toBe(5_000_000);
    expect(trend.change).toBeNull();
    expect(trend.direction).toBeNull();
  });

  it('ritaglia alla data: un punto scritto dopo, quel giorno, non c\'era', () => {
    const points = buildCurves(table([
      [1, '2024-01-01', 10_000_000],
      [1, '2025-06-01', 30_000_000],
      [1, '2026-06-01', 45_000_000],
    ])).get(1);
    const back = trendOf(points, '2025-08-17')!;
    expect(back.value).toBe(30_000_000);
    expect(back.from!.on).toBe('2024-01-01');
    // ...e la stessa curva letta oggi dà un'altra risposta, che è il punto del viaggio nel tempo.
    expect(trendOf(points, TODAY)!.value).toBe(45_000_000);
  });

  it('un valore nullo si scarta e non diventa zero', () => {
    const curves = buildCurves(table([[1, '2026-01-01', null], [1, '2026-02-01', 3_000_000]]));
    expect(curves.get(1)!.length).toBe(1);
    expect(trendOf(curves.get(1), TODAY)!.value).toBe(3_000_000);
    // ...e un uomo la cui unica riga è vuota non ha curva: null, non un valore di zero euro.
    expect(trendOf(buildCurves(table([[2, '2026-01-01', null]])).get(2), TODAY)).toBeNull();
  });

  it('una base a zero non produce una percentuale', () => {
    const trend = trendOf(buildCurves(table([
      [1, '2025-01-01', 0], [1, '2026-01-01', 4_000_000],
    ])).get(1), TODAY)!;
    expect(trend.change).toBeNull();
    expect(trend.direction).toBeNull();
  });

  it('ordina la curva per data anche se il bundle non la porta in ordine', () => {
    const points = buildCurves(table([
      [1, '2026-06-01', 40_000_000], [1, '2025-04-01', 20_000_000],
    ])).get(1)!;
    expect(points.map((point) => point.on)).toEqual(['2025-04-01', '2026-06-01']);
  });
});

describe('yearBefore', () => {
  it('è la stessa data dodici mesi prima', () => {
    expect(yearBefore('2026-08-17')).toBe('2025-08-17');
    expect(yearBefore('2026-03-01')).toBe('2025-03-01');
  });
});

describe('euros', () => {
  it('scrive la scala della fonte in italiano', () => {
    expect(euros(45_000_000)).toBe('45 M');
    expect(euros(4_500_000)).toBe('4,5 M');
    expect(euros(800_000)).toBe('800 mila');
  });
});
