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
  date,
  kind: null,
  title: key,
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
    // Il confine fra due stagioni non ha una data, e non deve rompere la catena né produrre un secondo
    // separatore: quello è già detto dal confine di stagione, e due separatori attaccati direbbero la
    // stessa cosa due volte.
    const columns = [column('a', '2026-09-06'), column('border', null), column('b', '2026-08-23')];
    const got = withCoachBreaks(columns, [[cell('2026-09-06'), null, cell('2026-08-23')]], spells);
    const coach = got.columns.filter((one) => one.breakKind === 'coach');
    expect(coach.length).toBe(1);
    expect(got.cells[0].length).toBe(got.columns.length);
  });
});
