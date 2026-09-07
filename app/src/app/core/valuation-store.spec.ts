import { describe, expect, it } from 'vitest';

import { BoardsFile } from './bundle';
import { EngineExpectation, placesFrom, ruledExpectation } from './valuation-store';

/**
 * Where the drawn elevens put their men, over a WHOLE boards file.
 *
 * The squads view asks for one club and the listone's table for all of them, and the answer must be the
 * same map: a man belongs to one board, so reading the file once is the definition and reading the club
 * on screen was only the first caller of it. What is tested is that nobody is lost by widening it, and
 * that a club the panel could not draw contributes nobody instead of an empty place.
 */
const file = (clubs: BoardsFile['clubs']): BoardsFile => ({
  sheet: 'test',
  mode: 'mantra',
  apply_rulings: true,
  clubs,
});

describe('placesFrom', () => {
  it('reads the place of every club of the file, not of one', () => {
    const places = placesFrom(
      file({
        Napoli: { lines: { P: [], D: [{ fc_id: 1, name: 'Di Lorenzo', codes: 'DR;DC', badge: 'Dd' }], M: [], T: [], A: [] } },
        Milan: { lines: { P: [], D: [], M: [{ fc_id: 2, name: 'Modric', codes: 'MC;DM', badge: 'M' }], T: [], A: [] } },
      } as unknown as BoardsFile['clubs']),
    );
    expect(places.get(1)).toBe('DR');
    expect(places.get(2)).toBe('MC');
    expect(places.size).toBe(2);
  });

  it('gives no place to a club the panel could not draw', () => {
    // An `error` board is not an empty eleven: nobody in it is «not a starter», the drawing failed.
    const places = placesFrom(
      file({
        Verona: { error: 'no shape' },
        Como: { lines: { P: [{ fc_id: 3, name: 'Butez', codes: 'GK', badge: 'Por' }], D: [], M: [], T: [], A: [] } },
      } as unknown as BoardsFile['clubs']),
    );
    expect(places.has(3)).toBe(true);
    expect(places.size).toBe(1);
  });

  it('answers with nothing when there is no file at all', () => {
    // No boards on this platform: «vuoto = ignoto», and the caller must not read a place into it.
    expect(placesFrom(null).size).toBe(0);
  });
});

/**
 * UNA RIGA DEL FOGLIO CON LA DRITTA DELL'OPERATORE DENTRO.
 *
 * Il punto di questa funzione e' la REGOLA su cosa si muove: quello che moltiplica le presenze la
 * segue, tutto il resto no - e in particolare `actual_*`, che e' com'e' andata davvero e riscalarla
 * vorrebbe dire correggere il passato.
 */
const sheetRow = (over: Partial<EngineExpectation> = {}): EngineExpectation => ({
  pv: 12, pvIsEstimate: true, fm: 6.4, fmIsEstimate: true, mv: 5.9,
  piFm: null, piBasis: null, piMatches: null,
  titolarita: 'riserva', titolaritaPlay: 0.25, minutesNext: 55,
  seasonMatches: 30, minutesFullSeason: 1800,
  category: 'bronzo', categoryBonus: 0.2, categoryBars: '0.1|0.3',
  replacementFm: 5.9, slot: 'A', surplus: 24, surplusIsEstimate: true,
  surplusFielded: 20, replacementFielded: 6.8, spm: 40, dvm: 10, confidence: 0.5,
  basis: 'anchor', note: null,
  cup: null, cupCountry: null,
  riserWatch: null, riserMinutes: null, riserStarts: null, riserWindow: null, riserKeeper: false,
  preseasonStarts: null, preseasonMatches: null,
  cupCapped: false, cupRounds: null, pvCup: null, valueCup: null, surplusCup: null,
  surplusFieldedCup: null, cupNote: null,
  anchor: 6.1, why: null,
  actual: { rounds: 36, pv: 3, mv: 5.5, fm: 5.5, value: 16.5 },
  ...over,
});

describe('ruledExpectation', () => {
  it('la PAROLA si sostituisce sempre: e’ quella che ogni schermata deve mostrare', () => {
    const out = ruledExpectation(sheetRow(), { rung: 'titolare' }, null, 36);
    expect(out.titolarita).toBe('titolare');
    // ...e senza una quota da imporre - una dritta che CONFERMA il foglio - i numeri non si muovono.
    expect(out.pv).toBe(12);
    expect(out.surplus).toBe(24);
  });

  it('riscala quello che MOLTIPLICA le presenze, e nient’altro', () => {
    // 0,9 di quota su 36 giornate = 32,4 presenze: il triplo di 12, quindi il surplus triplica.
    const out = ruledExpectation(sheetRow(), { rung: 'titolare' }, { play: 0.9, minutes: 71 }, 36);
    expect(out.pv).toBeCloseTo(32.4, 5);
    expect(out.titolaritaPlay).toBeCloseTo(0.9, 5);
    // ...E I MINUTI, che sono l'altro asse della stessa parola (operatore, 08/09/2026): un
    // `titolarissimo` accanto a «46 minuti attesi» sarebbe una riga che si contraddice. È un LIVELLO,
    // quindi si sostituisce e non si riscala.
    expect(out.minutesNext).toBe(71);
    expect(out.surplus).toBeCloseTo(24 * 2.7, 5);
    expect(out.surplusFielded).toBeCloseTo(20 * 2.7, 5);
    expect(out.spm).toBeCloseTo(40 * 2.7, 5);
    // `dvm = spm - FVM`, e l'FVM non e' cambiato: lo scarto si sposta di quanto si sposta lo `spm`.
    expect(out.dvm).toBeCloseTo(10 + (40 * 2.7 - 40), 5);
    // La fantamedia, la media voto, i due rimpiazzi, l'ancora e la categoria dicono quanto vale UNA
    // sua partita o dove sta lo zero del ruolo: non quante partite gioca.
    expect(out.fm).toBe(6.4);
    expect(out.mv).toBe(5.9);
    expect(out.replacementFm).toBe(5.9);
    expect(out.replacementFielded).toBe(6.8);
    expect(out.anchor).toBe(6.1);
    expect(out.category).toBe('bronzo');
    expect(out.confidence).toBe(0.5);
  });

  it('NON tocca l’esito: `actual_*` e’ com’e’ andata davvero', () => {
    const out = ruledExpectation(sheetRow(), { rung: 'bandiera' }, { play: 0.97, minutes: 80 }, 36);
    expect(out.actual).toEqual({ rounds: 36, pv: 3, mv: 5.5, fm: 5.5, value: 16.5 });
  });

  it('la coppa si sottrae in ASSOLUTO: le giornate che costa sono un fatto sulla finestra', () => {
    // 12 presenze piene, 9,6 al netto della coppa: la finestra gli costa 2,4 giornate, e restano 2,4
    // anche quando le presenze diventano 32,4 - non e' una proporzione.
    const out = ruledExpectation(
      sheetRow({ pvCup: 9.6, valueCup: 61, surplusCup: 19, surplusFieldedCup: 16 }),
      { rung: 'titolare' }, { play: 0.9, minutes: 71 }, 36,
    );
    expect(out.pvCup).toBeCloseTo(30, 5);
    expect(out.valueCup).toBeCloseTo(61 * (30 / 9.6), 5);
  });

  it('senza giornate una quota non e’ un numero di giornate: resta la parola', () => {
    const out = ruledExpectation(sheetRow(), { rung: 'titolare' }, { play: 0.9, minutes: 71 }, null);
    expect(out.titolarita).toBe('titolare');
    expect(out.pv).toBe(12);
  });

  it('una riga che il foglio non prezza non diventa prezzata: senza `Pa` non c’e’ proporzione', () => {
    const out = ruledExpectation(sheetRow({ pv: null, surplus: null }), { rung: 'titolare' },
      { play: 0.9, minutes: 71 }, 36);
    expect(out.pv).toBeCloseTo(32.4, 5);
    // Il surplus del foglio non c'e', e non lo si inventa qui: sarebbe un secondo motore.
    expect(out.surplus).toBeNull();
  });
});
