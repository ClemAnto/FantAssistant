import { describe, expect, it } from 'vitest';

import { FilterClause, FilterRow, matchesFilter } from './player-filter';
import { SquadMan } from './valuation-store';

const man = (over: Partial<SquadMan> = {}): SquadMan => ({
  fcId: 1, name: 'Esposito F.P.', clubId: 1, role: 'A', mantra: 'Pc', mantraCodes: ['Pc'],
  club: 'Inter', league: 'serie_a', codes: [], codesOn: null,
  mv: 6.2, fm: 6.9, pv: 30, expected: 24, expectedIsEstimate: false, expectedFm: 6.8,
  expectedFmIsEstimate: false, expectedMv: 6.1, estimateBasis: null, estimateNote: null,
  fvm: 120, place: null, rating: null,
  tones: { fm: null, mv: null, expectedFm: null, expectedMv: null, dvm: null },
  surplus: 28.4, surplusIsEstimate: false, value: 163.2, spm: null, dvm: null,
  surplusFielded: 14.7, replacementFielded: 6.99,
  ...over,
});

const row = (over: Partial<SquadMan> = {}, flags: FilterRow['flags'] = []): FilterRow => ({
  man: man(over),
  flags,
});

const clause = (over: Partial<FilterClause>): FilterClause =>
  ({ field: 'fm', op: 'gt', value: '6', join: 'and', ...over });

describe('matchesFilter', () => {
  it('non filtra niente quando non ci sono condizioni', () => {
    expect(matchesFilter([], row())).toBe(true);
  });

  it('confronta i numeri, e legge la virgola come la scrive un italiano', () => {
    expect(matchesFilter([clause({ field: 'fm', op: 'gt', value: '6,5' })], row())).toBe(true);
    expect(matchesFilter([clause({ field: 'fm', op: 'lt', value: '6,5' })], row())).toBe(false);
    expect(matchesFilter([clause({ field: 'pv', op: 'eq', value: '30' })], row())).toBe(true);
  });

  it('TIENE FUORI da entrambe le liste chi il numero non ce l\'ha', () => {
    // «Vuoto = ignoto, mai zero»: di un arrivo senza stagione misurata non si sa se sta sopra o sotto,
    // e metterlo di sotto sarebbe un'affermazione che nessuno ha misurato.
    const arrivo = row({ fm: null });
    expect(matchesFilter([clause({ field: 'fm', op: 'gt', value: '6' })], arrivo)).toBe(false);
    expect(matchesFilter([clause({ field: 'fm', op: 'lt', value: '6' })], arrivo)).toBe(false);
    // ...e per trovarlo c'è il criterio apposta.
    expect(matchesFilter([clause({ field: 'fm', op: 'empty', value: '' })], arrivo)).toBe(true);
    expect(matchesFilter([clause({ field: 'fm', op: 'filled', value: '' })], arrivo)).toBe(false);
  });

  it('confronta ruolo, squadra e nome senza badare ad accenti e maiuscole', () => {
    expect(matchesFilter([clause({ field: 'role', op: 'is', value: 'A' })], row())).toBe(true);
    expect(matchesFilter([clause({ field: 'role', op: 'not', value: 'A' })], row())).toBe(false);
    expect(matchesFilter([clause({ field: 'club', op: 'is', value: 'inter' })], row())).toBe(true);
    expect(matchesFilter([clause({ field: 'name', op: 'contains', value: 'ESPOSITO' })], row())).toBe(true);
  });

  it('cerca le icone che un uomo porta', () => {
    expect(matchesFilter([clause({ field: 'flag', op: 'is', value: 'mystery' })], row({}, ['mystery'])))
      .toBe(true);
    expect(matchesFilter([clause({ field: 'flag', op: 'is', value: 'fragile' })], row({}, ['mystery'])))
      .toBe(false);
    expect(matchesFilter([clause({ field: 'flag', op: 'not', value: 'fragile' })], row({}, ['mystery'])))
      .toBe(true);
  });

  it('lega le condizioni DA SINISTRA A DESTRA, senza precedenze', () => {
    // «A e B o C» è «(A e B) o C»: la lettura che corrisponde a come stanno scritte in colonna.
    const clauses = [
      clause({ field: 'role', op: 'is', value: 'A', join: 'and' }),
      clause({ field: 'fm', op: 'gt', value: '9', join: 'and' }),   // falsa
      clause({ field: 'club', op: 'is', value: 'Inter', join: 'or' }),
    ];
    expect(matchesFilter(clauses, row())).toBe(true);
    expect(matchesFilter(clauses, row({ club: 'Milan' }))).toBe(false);
  });

  it('ignora una proprietà che non esiste più invece di svuotare la lista', () => {
    // Un filtro salvato mesi fa su una colonna che è stata tolta: meglio una condizione in meno che una
    // lista vuota senza spiegazione.
    expect(matchesFilter([clause({ field: 'colonna-sparita', op: 'gt', value: '1' })], row())).toBe(true);
  });
});
