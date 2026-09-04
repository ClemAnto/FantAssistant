import { OutWindow } from './injury-window';
import { Spell } from './player-status';
import {
  INSURANCE_CAP_SHARE,
  INSURANCE_DEFAULT_ROUNDS,
  PlayInput,
  expectedPlay,
  insuranceRounds,
  roundDaysOf,
  seasonLosses,
} from './expected-play';

/**
 * L'assicurazione dell'operatore (04/09/2026), i suoi tre pezzi e il metro della plancia.
 *
 * Quello che questi test difendono non e' un numero ma la SEPARAZIONE fra i tre: un fatto (la finestra
 * dello stop aperto), un rischio (l'assicurazione) e una scelta di fonte (la board dove il motore
 * ripiega). Mescolarli in un totale solo e' il modo in cui una riga smette di poter spiegare se stessa.
 */
const NO_HISTORY = new Map<string, number>();

function spell(from: string, days: number): Spell {
  return { from, to: null, days, kind: null, detail: null, observedOn: null };
}

function input(over: Partial<PlayInput> = {}): PlayInput {
  return {
    matchdays: 36,
    pv: 30,
    pvIsEstimate: false,
    playShare: null,
    out: null,
    losses: NO_HISTORY,
    ...over,
  };
}

describe('expectedPlay', () => {
  it('toglie per intero le giornate di uno stop APERTO, che sono un fatto', () => {
    // Yildiz il 04/09/2026: rientro dichiarato il 25/11, 10 giornate della Juve prima di quel giorno.
    const out = { lost: 10 } as OutWindow;
    const result = expectedPlay(input({ pv: 25.8, out }));
    expect(result.out).toBe(10);
    expect(result.expected).toBeCloseTo(25.8 - 10 - INSURANCE_DEFAULT_ROUNDS, 5);
  });

  it("assicura lo SCARTO fra la stagione peggiore e la media, non il totale perso", () => {
    // tre stagioni: 2, 3 e 12 giornate. Media 5,67, peggiore 12 -> si assicurano 6,33.
    const losses = new Map([['2023-24', 2], ['2024-25', 3], ['2025-26', 12]]);
    expect(insuranceRounds(losses)).toBeCloseTo(12 - 17 / 3, 5);
    const result = expectedPlay(input({ losses }));
    expect(result.insurance).toBeCloseTo(12 - 17 / 3, 5);
    expect(result.expected).toBeCloseTo(30 - (12 - 17 / 3), 5);
  });

  it('a chi non ha abbastanza storia applica il numero del listone, non uno zero', () => {
    expect(insuranceRounds(NO_HISTORY)).toBe(INSURANCE_DEFAULT_ROUNDS);
    expect(insuranceRounds(new Map([['2025-26', 30]]))).toBe(INSURANCE_DEFAULT_ROUNDS);
  });

  it('non toglie mai piu' + ' del tetto dichiarato, perche' + ' uno storico brutto e' + ' uno sconto e non una sentenza', () => {
    const losses = new Map([['2023-24', 0], ['2024-25', 34]]);
    const result = expectedPlay(input({ losses }));
    expect(result.insurance).toBeCloseTo(36 * INSURANCE_CAP_SHARE, 5);
    expect(result.expected).toBeGreaterThan(0);
  });

  it('adotta il metro della PLANCIA solo dove il foglio ripiega su una costante', () => {
    // Kolo Muani il 04/09/2026: est_pv 18,6 su 36 giornate, e il pannello lo da' allo 0,72.
    const board = expectedPlay(input({ pv: 18.6, pvIsEstimate: true, playShare: 0.72 }));
    expect(board.basis).toBe('board');
    expect(board.base).toBeCloseTo(0.72 * 36, 5);
    // ...e dove il motore prezza il suo calcio la board non lo scavalca: una fonte sola per riga.
    const core = expectedPlay(input({ pv: 18.6, pvIsEstimate: false, playShare: 0.72 }));
    expect(core.basis).toBe('core');
    expect(core.base).toBe(18.6);
  });

  it('il fattore riprezza un numero DEL FOGLIO, quindi divide per la pv del foglio', () => {
    const result = expectedPlay(input({ pv: 20, out: { lost: 4 } as OutWindow, losses: NO_HISTORY }));
    expect(result.factor).toBeCloseTo(result.expected! / 20, 10);
    // un surplus e' (fm - rimpiazzo) x presenze: scalarlo col fattore e' la stessa sottrazione
    expect(40 * result.factor).toBeCloseTo(40 * (result.expected! / 20), 10);
  });

  it('...anche quando la BASE viene dalla board, che e un altro numero', () => {
    // Kolo Muani, 05/09/2026: il foglio dice 18,6 presenze e la board 0,72 x 36 = 25,9. Il suo surplus
    // e' costruito su 18,6, quindi dividere per 25,9 lo farebbe SCENDERE dopo avergli alzato le
    // presenze - l'errore di unita' che questo file ha commesso il giorno prima.
    const result = expectedPlay(input({ pv: 18.6, pvIsEstimate: true, playShare: 0.72 }));
    expect(result.base).toBeCloseTo(25.92, 2);
    expect(result.factor).toBeCloseTo(result.expected! / 18.6, 10);
    expect(result.factor).toBeGreaterThan(1);
  });

  it('un Pa che il foglio non ha resta vuoto: ignoto non e' + ' zero', () => {
    const result = expectedPlay(input({ pv: null }));
    expect(result.expected).toBeNull();
    expect(result.factor).toBe(1);
  });
});

describe('seasonLosses', () => {
  it('attribuisce uno stop alla stagione in cui e cominciato e conta GIORNATE', () => {
    const rounds = roundDaysOf('2026-08-22', '2027-05-23', 38);
    expect(rounds).toBeGreaterThan(6);
    expect(rounds).toBeLessThan(9);
    const losses = seasonLosses([spell('2026-08-24', 94), spell('2025-11-01', 15)], rounds, '2026-09-04');
    expect(losses.get('2025-26')!).toBeCloseTo(15 / rounds, 5);
    // ...e lo stop di QUESTA stagione non e' nella finestra: e' un fatto, non un rischio, e lo toglie
    // gia' la finestra dello stop aperto. Contarlo qui sarebbe sottrarlo due volte.
    expect(losses.has('2026-27')).toBe(false);
  });

  it('guarda TRE stagioni e non la carriera: il caso Malen (5 settembre 2026)', () => {
    // «Come mai Malen ha solo 14 Pa?» - un'operazione al ginocchio del 2019-20, 242 giorni, gli faceva
    // scattare il tetto dell'assicurazione sette anni dopo. Nelle ultime tre stagioni ha perso 4,4 - 1,5 - 0.
    const career = [spell('2019-12-16', 242), spell('2024-04-14', 33), spell('2025-02-26', 11)];
    const losses = seasonLosses(career, 7.5, '2026-09-05');
    expect([...losses.keys()].sort()).toEqual(['2023-24', '2024-25', '2025-26']);
    expect(losses.has('2019-20')).toBe(false);
    // ...e l'assicurazione che ne esce e' quella di un uomo sano, non il tetto
    expect(insuranceRounds(losses)).toBeLessThan(4);
  });

  it('una stagione senza stop vale ZERO e non manca, o la media diventa quella delle annate brutte', () => {
    const losses = seasonLosses([spell('2025-11-01', 30)], 7.5, '2026-09-05');
    expect(losses.size).toBe(3);
    expect(losses.get('2024-25')).toBe(0);
    expect(losses.get('2023-24')).toBe(0);
    // media 4/3 delle sue tre stagioni, non 4 della sola stagione in cui si e' fatto male
    expect(insuranceRounds(losses)).toBeCloseTo(4 - 4 / 3, 5);
  });

  it('senza calendario torna alla convenzione dichiarata invece di dividere per zero', () => {
    expect(roundDaysOf(null, null, 38)).toBe(7.5);
    expect(roundDaysOf('2026-08-22', '2027-05-23', 0)).toBe(7.5);
  });
});
