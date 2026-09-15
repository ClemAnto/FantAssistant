import { describe, expect, it } from 'vitest';

import { BundleTable } from './bundle';
import { ColumnSlot, MatchCell, buildCoachSpells, coachOn, withCoachBreaks } from './players-store';

/**
 * IL CONFINE DEL CAMBIO ALLENATORE nella striscia delle ultime partite.
 *
 * Richiesta dell'operatore (11/09/2026): «evidenzia quando viene cambiato allenatore nella vista
 * squadre/ultime partite con un separatore diverso da quello del cambio stagione». Un allenatore nuovo è
 * un altro criterio di scelta, quindi le presenze di un uomo prima e dopo sono due popolazioni — la
 * stessa ragione per cui il confine fra due stagioni esiste già.
 */
const table = (rows: unknown[][]): BundleTable => ({
  table: 'coaches',
  columns: ['fc_club_id', 'coach_name', 'valid_from', 'valid_to'],
  rows,
});

const column = (key: string, date: string | null): ColumnSlot => ({
  key,
  label: key,
  detail: null,
  score: null,
  outcome: null,
  sides: null,
  shape: null,
  formation: null,
  matchId: null,
  matchClub: null,
  divider: null,
  breakKind: null,
  bench: null,
  unnamed: false,
  upcoming: false,
  date,
  kind: null,
  title: key,
});

/** Il confine fra due stagioni come `matchTableAcross` lo scrive davvero: senza data E con `divider`. */
const border = (): ColumnSlot => ({
  ...column('border', null),
  divider: '2026-27 → 2025-26',
  breakKind: 'season',
  title: 'Confine fra le stagioni 2026-27 e 2025-26',
});

const cell = (date: string): MatchCell => ({ date } as MatchCell);

describe('buildCoachSpells', () => {
  it('ordina dal più recente e scarta chi non sa quando è cominciato', () => {
    // Uno spell senza data d'inizio non può dire chi c'era: esce, invece di coprire un intervallo
    // indefinito. «Vuoto = ignoto» applicato a una panchina.
    const spells = buildCoachSpells(table([
      [1, 'Vieira', '2024-11-20', '2025-11-01'],
      [1, 'De Rossi', '2025-11-06', null],
      [1, 'Murgita', '2025-11-01', '2025-11-05'],
      [1, 'Senza data', null, null],
    ]));
    expect(spells.get(1)?.map((one) => one.name)).toEqual(['De Rossi', 'Murgita', 'Vieira']);
  });

  it('non inventa niente su un bundle che non porta la tabella', () => {
    // Un pacchetto tirato prima che `coaches` viaggiasse: il confine non si disegna, che NON è «non ci
    // sono stati cambi».
    expect(buildCoachSpells(null).size).toBe(0);
  });
});

describe('coachOn', () => {
  const spells = buildCoachSpells(table([
    [1, 'Vieira', '2024-11-20', '2025-11-01'],
    [1, 'De Rossi', '2025-11-06', null],
    [1, 'Murgita', '2025-11-01', '2025-11-05'],
  ])).get(1);

  it('nomina chi era in carica in quella data, traghettatori compresi', () => {
    expect(coachOn(spells, '2025-06-01')).toBe('Vieira');
    expect(coachOn(spells, '2025-11-03')).toBe('Murgita');
    expect(coachOn(spells, '2026-09-06')).toBe('De Rossi');
  });

  it('risponde NULL prima del primo spell, e non col primo che capita', () => {
    expect(coachOn(spells, '2020-01-01')).toBeNull();
    expect(coachOn(undefined, '2026-09-06')).toBeNull();
  });
});

describe('withCoachBreaks', () => {
  const spells = buildCoachSpells(table([
    [1, 'Palladino', '2025-06-01', '2026-08-30'],
    [1, 'Sarri', '2026-08-31', null],
  ])).get(1);

  it('inserisce UN confine fra due partite allenate da due persone, e porta i due nomi', () => {
    // Le colonne sono dalla più RECENTE, quindi il nome nuovo è quello della colonna di sinistra: la
    // frase va letta come la tabella, indietro nel tempo.
    const columns = [column('a', '2026-09-06'), column('b', '2026-08-23')];
    const cells = [[cell('2026-09-06'), cell('2026-08-23')]];
    const got = withCoachBreaks(columns, cells, spells);
    expect(got.columns.map((one) => one.breakKind)).toEqual([null, 'coach', null]);
    expect(got.columns[1].divider).toBe('Palladino → Sarri');
    // ...e le celle seguono le colonne: un confine non è una giornata non giocata, quindi la sua cella
    // è VUOTA e non un trattino. Se le due liste si disallineassero, ogni voto scivolerebbe di una
    // colonna - il difetto degli 84px del 20/08, un piano più sotto.
    expect(got.cells[0].length).toBe(got.columns.length);
    expect(got.cells[0][1]).toBeNull();
  });

  it('non inserisce niente dove l’allenatore è lo stesso', () => {
    const columns = [column('a', '2026-09-06'), column('b', '2026-09-01')];
    const got = withCoachBreaks(columns, [[cell('2026-09-06'), cell('2026-09-01')]], spells);
    expect(got.columns.length).toBe(2);
  });

  it('non inserisce niente senza spell: il confine ignoto non si disegna', () => {
    const columns = [column('a', '2026-09-06'), column('b', '2026-08-23')];
    const got = withCoachBreaks(columns, [[cell('2026-09-06'), cell('2026-08-23')]], undefined);
    expect(got.columns.length).toBe(2);
  });

  it('salta le colonne senza data invece di dedurne una', () => {
    // Una colonna senza data non deve rompere la catena: il cambio si vede lo stesso, fra le due
    // partite che hanno una data. Qui la colonna di mezzo NON è un confine - è una giornata che questo
    // club non ha giocato - quindi il separatore di panchina ci vuole eccome.
    const columns = [column('a', '2026-09-06'), column('vuota', null), column('b', '2026-08-23')];
    const got = withCoachBreaks(columns, [[cell('2026-09-06'), null, cell('2026-08-23')]], spells);
    const coach = got.columns.filter((one) => one.breakKind === 'coach');
    expect(coach.length).toBe(1);
    expect(got.cells[0].length).toBe(got.columns.length);
  });

  it('su un confine di STAGIONE non fa una seconda colonna: la marca e basta', () => {
    // Il docstring lo prometteva dall'11/09/2026 e il codice non lo faceva. Il test che ci provava
    // passava CON il difetto, perché il suo confine finto non aveva `divider`: era una colonna senza
    // data e basta, cioè un altro caso. Misurato il 15/09 sulla pagina vera - Atalanta, due separatori
    // di undici pixel attaccati - e questa volta il fixture è il confine come lo scrive `matchTableAcross`.
    const columns = [column('a', '2026-09-06'), border(), column('b', '2026-05-24')];
    const got = withCoachBreaks(columns, [[cell('2026-09-06'), null, cell('2026-05-24')]], spells);
    expect(got.columns.filter((one) => one.breakKind === 'coach').length).toBe(0);
    expect(got.columns.length).toBe(3);
    // Il fatto non si perde: il confine porta il segno e la frase, cioè i due fatti su una colonna sola.
    expect(got.columns[1].bench).toBe('Palladino → Sarri');
    expect(got.columns[1].title).toContain('da Palladino a Sarri');
    expect(got.cells[0].length).toBe(got.columns.length);
  });

  it('un cambio DENTRO la stagione dopo un confine resta una colonna sua', () => {
    // La marcatura vale per il cambio che CADE sul confine, non per il primo che capita dopo: il
    // confine si «consuma» appena una colonna vera è passata, o un cambio di dicembre finirebbe scritto
    // sul confine di agosto.
    const inSeason = buildCoachSpells(table([
      [1, 'Grosso', '2026-06-01', '2026-09-06'],
      [1, 'Vanoli', '2026-09-07', null],
    ])).get(1);
    const columns = [
      column('a', '2026-09-12'), column('b', '2026-08-30'), border(), column('c', '2026-05-24'),
    ];
    const got = withCoachBreaks(
      columns,
      [[cell('2026-09-12'), cell('2026-08-30'), null, cell('2026-05-24')]],
      inSeason,
    );
    expect(got.columns.map((one) => one.breakKind)).toEqual([null, 'coach', null, 'season', null]);
    expect(got.columns[1].bench).toBe('Grosso → Vanoli');
    expect(got.cells[0].length).toBe(got.columns.length);
  });
});
