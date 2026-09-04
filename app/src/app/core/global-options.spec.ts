import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_LEAGUE, GlobalOptions } from './global-options';
import { PlayerRow } from './players-store';
import { catalogueOf } from './valuation-store';

/**
 * Le opzioni globali: il regolamento dichiarato una volta sola, e chi resta fuori da ogni lista.
 *
 * Quello che va tenuto fermo sono le tre cose che, se cedono, non si vedono a schermo: un uomo senza
 * club non viene escluso da niente («vuoto = ignoto»), il regolamento salvato da una versione precedente
 * non entra rotto dentro un conto, e la dichiarazione che le due pagine avevano già fatto non sparisce
 * in silenzio quando passa qui.
 */

const man = (fcId: number, club: string, clubId: number | null): PlayerRow => ({
  fcId,
  name: `#${fcId}`,
  clubId,
  role: 'C',
  mantra: 'C',
  mantraCodes: ['C'],
  club,
  league: 'serie_a', quoted: true,
});

function fresh(): GlobalOptions {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(GlobalOptions);
}

beforeEach(() => {
  localStorage.clear();
});

describe('catalogueOf', () => {
  it('counts the quoted men of each club, per listone', () => {
    const catalogue = catalogueOf(
      new Map([
        ['default', [man(1, 'Napoli', 10), man(2, 'Napoli', 10), man(3, 'Inter', 11)]],
        ['euro', [man(1, 'Napoli', 10)]],
      ]),
      new Map([
        [10, 'serie_a'],
        [11, 'serie_a'],
      ]),
    );
    expect(catalogue.map((one) => one.name)).toEqual(['Inter', 'Napoli']);
    const napoli = catalogue.find((one) => one.id === 10)!;
    expect(napoli.men).toEqual({ default: 2, euro: 1 });
    expect(napoli.league).toBe('serie_a');
  });

  it('leaves out a man whose club has no id: that is not a club you can exclude', () => {
    const catalogue = catalogueOf(new Map([['default', [man(1, 'Ignoto', null)]]]), new Map());
    expect(catalogue).toEqual([]);
  });
});

describe('GlobalOptions', () => {
  it('keeps a man with no club, whatever is excluded', () => {
    const options = fresh();
    options.excludedIds.set([10]);
    // «Vuoto = ignoto, mai zero»: non sapere di che squadra è uno non è una prova che sia di quella.
    expect(options.keeps(null)).toBe(true);
    expect(options.keeps(10)).toBe(false);
    expect(options.keeps(11)).toBe(true);
  });

  it('hands back the SAME list when nothing is excluded, and filters when something is', () => {
    const options = fresh();
    const rows = [man(1, 'Napoli', 10), man(2, 'Inter', 11), man(3, 'Ignoto', null)];
    expect(options.keep(rows)).toBe(rows);
    options.excludedIds.set([10]);
    expect(options.keep(rows).map((one) => one.fcId)).toEqual([2, 3]);
  });

  it('says how many men the exclusion hides, per listone', () => {
    const options = fresh();
    options.catalogue.set(
      catalogueOf(
        new Map([
          ['default', [man(1, 'Napoli', 10), man(2, 'Napoli', 10), man(3, 'Inter', 11)]],
          ['euro', [man(1, 'Napoli', 10)]],
        ]),
        new Map(),
      ),
    );
    options.setExcluded(10, true);
    expect(options.excludedClubs().map((one) => one.name)).toEqual(['Napoli']);
    expect(options.hidden()).toEqual({ default: 2, euro: 1 });
  });

  it('refuses a number that is not a number, whatever the field emitted', () => {
    const options = fresh();
    // `nz-input-number` manda `null` nell'istante in cui la casella viene svuotata per riscriverla: con
    // un budget nullo i crediti di ogni rivale leggono `null - speso`, cioè negativo.
    options.patchNumber('budget', null as unknown as number);
    options.patchClassic('D', Number.NaN);
    expect(options.league().budget).toBe(DEFAULT_LEAGUE.budget);
    expect(options.league().slots.classic.D).toBe(DEFAULT_LEAGUE.slots.classic.D);
  });

  it('reads what was stored by an older version field by field, never whole', () => {
    localStorage.setItem(
      'fantassistant.options.league',
      JSON.stringify({ budget: 500, game: 'mantra', slots: { classic: { D: 9 } } }),
    );
    const league = fresh().league();
    expect(league.budget).toBe(500);
    expect(league.game).toBe('mantra');
    expect(league.slots.classic.D).toBe(9);
    // Quello che quel salvataggio non aveva vale il valore di partenza, non `undefined` dentro un conto.
    expect(league.slots.classic.P).toBe(DEFAULT_LEAGUE.slots.classic.P);
    expect(league.slots.mantra).toEqual(DEFAULT_LEAGUE.slots.mantra);
    expect(league.rounds).toBe(DEFAULT_LEAGUE.rounds);
  });

  it('takes over what the two pages had already declared, the Strategia winning the overlap', () => {
    // Un azzeramento silenzioso si legge come «non c'era niente da tenere»: chi aveva dichiarato la sua
    // lega su una delle due pagine se la ritrova qui, e non ai valori di partenza.
    localStorage.setItem(
      'fantassistant.strategy.setup',
      JSON.stringify({ platform: 'euro', game: 'mantra', budget: 500, teams: 12 }),
    );
    localStorage.setItem(
      'fantassistant.sealedBid.rules',
      JSON.stringify({ budget: 750, rounds: 6, roleLock: false, from: 3, to: 38 }),
    );
    const league = fresh().league();
    expect(league.platform).toBe('euro');
    expect(league.teams).toBe(12);
    expect(league.budget).toBe(500);          // la Strategia dichiarava la lega per intero
    expect(league.rounds).toBe(6);            // e questo lo aveva solo la pagina delle buste
    expect(league.roleLock).toBe(false);
    expect(league.from).toBe(3);
  });

  it('does not touch a declaration made with the panel itself', () => {
    localStorage.setItem('fantassistant.options.league', JSON.stringify({ budget: 250 }));
    localStorage.setItem('fantassistant.strategy.setup', JSON.stringify({ budget: 999 }));
    expect(fresh().league().budget).toBe(250);
  });
});
