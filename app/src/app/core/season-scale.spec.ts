import { describe, expect, it } from 'vitest';

import { engineNumbersFrom } from './engine-sheet';
import { INSURANCE_FLOOR_ROUNDS, expectedPlay } from './expected-play';
import { onSeasonBase, seasonScale, sheetSeasonScale } from './season-scale';

describe('la scala della stagione', () => {
  it('porta un numero dalle giornate che restano alla stagione piena', () => {
    // I due calendari veri del foglio di Serie A del 22/09/2026: 33 restano, 38 ne ha la stagione.
    expect(seasonScale(33, 38)).toBeCloseTo(38 / 33, 10);
    expect(onSeasonBase(24, seasonScale(33, 38))).toBeCloseTo(27.64, 2);
  });

  it('e su euro la stagione piena ne ha 31, non 38', () => {
    // Scrivere «38» al posto della stagione della PIATTAFORMA inventerebbe sette giornate che
    // EuroLeghe non gioca: il foglio euro del 22/09/2026 dichiara 27 e 31.
    expect(seasonScale(27, 31)).toBeCloseTo(31 / 27, 10);
    expect(seasonScale(27, 31)).toBeLessThan(seasonScale(27, 38));
  });

  it('senza uno dei due calendari non inventa una scala', () => {
    // Vuoto = ignoto, mai zero e mai un fattore indovinato: il numero resta quello che era, e una
    // pagina che moltiplicasse per una costante scelta direbbe una cosa che nessuno ha misurato.
    expect(seasonScale(null, 38)).toBe(1);
    expect(seasonScale(33, null)).toBe(1);
    expect(seasonScale(0, 38)).toBe(1);
    expect(sheetSeasonScale(undefined)).toBe(1);
    expect(sheetSeasonScale({ platform_target: 33, platform_input: 38 })).toBeCloseTo(38 / 33, 10);
  });

  it('tiene vuoto il vuoto', () => {
    expect(onSeasonBase(null, 1.15)).toBeNull();
    expect(onSeasonBase(undefined, 1.15)).toBeNull();
  });
});

describe('il lettore dei numeri del motore', () => {
  const sheet = (matchdays: { platform_target?: number | null; platform_input?: number | null } | null) => ({
    table: 'sheet',
    matchdays,
    columns: [
      'fc_id', 'engine_pv_pred', 'engine_fm_pred', 'engine_surplus', 'engine_replacement_fm',
      'est_pv', 'est_surplus', 'est_fm', 'desc_minutes_next', 'desc_titolarita_play',
    ],
    // Coerente con l'identita' del foglio: surplus = (7.2 - 6.0) x 24 = 28.8.
    rows: [[1, 24, 7.2, 28.8, 6.0, 24, 28.8, 7.2, 78, 0.9]],
  });

  it('riporta quello che e\' in GIORNATE e lascia fermo quello che e\' per partita', () => {
    const one = engineNumbersFrom(sheet({ platform_target: 33, platform_input: 38 })).get(1)!;
    const scale = 38 / 33;
    // Estensive: raddoppiano se raddoppiano le partite.
    expect(one.pv!).toBeCloseTo(24 * scale, 6);
    expect(one.surplusLeague!).toBeCloseTo(28.8 * scale, 6);
    expect(one.estPv!).toBeCloseTo(24 * scale, 6);
    expect(one.estSurplus!).toBeCloseTo(28.8 * scale, 6);
    // Intensive: una fantamedia e' PER PARTITA e riportarla direbbe che segna di piu' a settembre.
    expect(one.fm).toBe(7.2);
    expect(one.replacementFm).toBe(6.0);
    expect(one.minutesNext).toBe(78);
    expect(one.titolaritaPlay).toBe(0.9);
  });

  it('e l\'identita\' del surplus regge, perche\' le due meta\' non si riportano allo stesso modo', () => {
    // `(fm - rimpiazzo) x pv` e' quello che `/why` verifica riga per riga: `fm` e il rimpiazzo sono
    // per partita e restano fermi, `pv` e il surplus salgono insieme, quindi la catena riproduce
    // ancora il proprio numero. E' la prova che la lista di cosa si riporta e' quella giusta.
    const one = engineNumbersFrom(sheet({ platform_target: 33, platform_input: 38 })).get(1)!;
    expect((one.fm! - one.replacementFm!) * one.pv!).toBeCloseTo(one.surplusLeague!, 6);
  });

  it('una tabella che non e\' un foglio non porta i calendari e non si tocca', () => {
    const one = engineNumbersFrom(sheet(null)).get(1)!;
    expect(one.pv).toBe(24);
    expect(one.surplusLeague).toBe(28.8);
  });
});

describe('la finestra di un infortunio, quando la base e\' riportata', () => {
  const losses = new Map([['2023-24', 0], ['2024-25', 0], ['2025-26', 0]]);
  const window = (lost: number, remaining: number) => ({
    until: '2026-11-01', declared: '2026-10-25', seasonOver: false, source: 'file' as const,
    slipDays: 7, lost, playable: remaining - lost, remaining, share: (remaining - lost) / remaining,
  });

  it('sottrae la finestra sulla scala della base e non un conteggio di partite vere', () => {
    // Ne salta 10 delle 33 che restano, cioe' il 30,3% - su una base riportata a 38 sono 11,5
    // giornate e non 10. Sottrarre il conteggio crudo mescolerebbe due unita'.
    const out = expectedPlay({
      matchdays: 38, pv: 27.6, pvIsEstimate: false, playShare: null, ruled: null,
      out: window(10, 33), losses,
    });
    expect(out.out).toBeCloseTo(10 * (38 / 33), 6);
    expect(out.expected!).toBeCloseTo(27.6 - 10 * (38 / 33) - INSURANCE_FLOOR_ROUNDS, 6);
  });

  it('e dove non c\'e\' niente da riportare e\' il conto di prima alla cifra', () => {
    const out = expectedPlay({
      matchdays: 33, pv: 24, pvIsEstimate: false, playShare: null, ruled: null,
      out: window(10, 33), losses,
    });
    expect(out.out).toBe(10);
  });
});
