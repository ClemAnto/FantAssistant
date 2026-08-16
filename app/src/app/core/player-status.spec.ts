import { BundleTable } from './bundle';
import {
  BACK_FROM_LONG_DAYS,
  LONG_INJURY_DAYS,
  Spell,
  buildSpells,
  declaredFor,
  declaredMark,
  injuryMark,
  isOpen,
  spellDays,
} from './player-status';

const TODAY = '2026-08-11';

const spell = (from: string, to: string | null, days: number | null = null): Spell => ({
  from,
  to,
  days,
  kind: 'knee',
  detail: 'Rottura del legamento crociato',
});

describe('spellDays', () => {
  it('takes the longer of the source count and the calendar', () => {
    // The page was read before the bundle was built, so `days_out` can lag the dates.
    expect(spellDays(spell('2026-06-11', null, 10), TODAY)).toBe(61);
    expect(spellDays(spell('2026-08-01', null, 200), TODAY)).toBe(200);
  });

  it('stops counting a closed spell at its end', () => {
    expect(spellDays(spell('2026-01-01', '2026-03-02'), TODAY)).toBe(60);
  });
});

describe('isOpen', () => {
  it('reads a missing end and a FUTURE end as still out', () => {
    expect(isOpen(spell('2026-06-01', null), TODAY)).toBe(true);
    expect(isOpen(spell('2026-06-01', '2026-08-31'), TODAY)).toBe(true);
    expect(isOpen(spell('2026-06-01', '2026-07-31'), TODAY)).toBe(false);
  });
});

describe('injuryMark', () => {
  it('marks a long open absence, and says since when', () => {
    const mark = injuryMark([spell('2026-01-10', null)], TODAY)!;
    expect(mark.flag).toBe('long_injury');
    expect(mark.note).toContain('10/01/2026');
  });

  it('says nothing about a knock: a mark on every twisted ankle is not a mark', () => {
    expect(injuryMark([spell('2026-08-01', null)], TODAY)).toBeNull();
    expect(spellDays(spell('2026-08-01', null), TODAY)).toBeLessThan(LONG_INJURY_DAYS);
  });

  it('marks a RECENT return from a long absence, and forgets an old one', () => {
    const back = injuryMark([spell('2026-01-01', '2026-07-20')], TODAY)!;
    expect(back.flag).toBe('back_from_long');
    expect(back.note).toContain('20/07/2026');
    // Two months and a day later it is history, not a caveat.
    const old = `2026-0${1}-01`;
    expect(injuryMark([spell(old, '2026-06-01')], TODAY)).toBeNull();
    expect(BACK_FROM_LONG_DAYS).toBe(60);
  });

  it('does not call a recent SHORT absence a return from a long one', () => {
    expect(injuryMark([spell('2026-07-25', '2026-08-05')], TODAY)).toBeNull();
  });

  it('lets the open spell win: a man out now is not a man just back', () => {
    const mark = injuryMark(
      [spell('2026-01-01', '2026-07-20'), spell('2026-08-01', null, 60)],
      TODAY,
    )!;
    expect(mark.flag).toBe('long_injury');
  });

  it('ignores a spell that has not started', () => {
    expect(injuryMark([spell('2026-09-01', null, 200)], TODAY)).toBeNull();
  });
});

describe('buildSpells', () => {
  const table: BundleTable = {
    table: 'injuries',
    columns: ['fc_id', 'start_date', 'end_date', 'kind', 'days_out', 'matches_missed', 'detail'],
    rows: [
      [7, '2026-01-01', null, 'knee', 220, 30, 'Crociato'],
      [7, '2020-01-01', '2020-02-01', 'muscular', 31, 4, 'Coscia'],
      [9, null, null, 'knee', 10, 1, 'niente data'],
    ],
  };

  it('keeps one dated list per player and drops a row with no start', () => {
    const spells = buildSpells(table);
    expect(spells.get(7)!.length).toBe(2);
    expect(spells.has(9)).toBe(false);
    expect(injuryMark(spells.get(7)!, TODAY)!.flag).toBe('long_injury');
  });

  it('survives an older bundle with no days_out and no detail', () => {
    const older: BundleTable = {
      table: 'injuries',
      columns: ['fc_id', 'start_date', 'end_date', 'kind'],
      rows: [[7, '2026-01-01', null, 'knee']],
    };
    const mark = injuryMark(buildSpells(older).get(7)!, TODAY)!;
    expect(mark.flag).toBe('long_injury');
    expect(mark.note).toContain('Infortunio');
  });
});

describe('declaredFor', () => {
  const file = {
    _comment: ['not a season'],
    edition: '2026/2027',
    '2025-26': { '11': { kind: 'dispute' } },
    '2026-27': {
      '2170': { kind: 'out_of_squad', note: 'allenamenti a parte', decided_on: '2026-08-11' },
      '99': { kind: 'nonsense' },
      pippo: { kind: 'dispute' },
    },
  } as unknown as import('./bundle').PlayerNotesFile;

  it('reads only the bundle’s own season, and skips what is not a note', () => {
    const notes = declaredFor(file, '2026-27');
    expect([...notes.keys()]).toEqual([2170]);
    expect(notes.get(2170)!.kind).toBe('out_of_squad');
  });

  it('is empty without a season, without a file and for a season nobody declared', () => {
    expect(declaredFor(file, null).size).toBe(0);
    expect(declaredFor(null, '2026-27').size).toBe(0);
    expect(declaredFor(file, '2027-28').size).toBe(0);
  });

  it('spells the kind out, with the day it was declared', () => {
    const mark = declaredMark(declaredFor(file, '2026-27').get(2170)!);
    expect(mark.flag).toBe('dispute');
    expect(mark.note).toBe('Fuori rosa · allenamenti a parte · dichiarato il 11/08/2026');
  });
});

/**
 * IL VIAGGIO NEL TEMPO su uno spell, che è il caso in cui è più facile sapere il futuro senza accorgersene.
 *
 * Tre regole, e la seconda è quella che conta: uno stop che si CHIUDE dopo la data era ancora aperto quel
 * giorno, quindi dire «è durato 40 giorni» sarebbe leggere il referto di domani. Anche `days_out` se ne va
 * con lui - è la durata totale, che quel giorno nessuno conosceva.
 */
describe('buildSpells nel viaggio nel tempo', () => {
  const table: BundleTable = {
    table: 'injuries',
    columns: ['fc_id', 'start_date', 'end_date', 'kind', 'days_out'],
    rows: [
      [1, '2025-09-01', '2025-09-20', 'knee', 19],   // finito prima: intatto
      [1, '2025-10-15', '2025-12-20', 'thigh', 66],  // ancora aperto al 3 novembre
      [1, '2026-02-01', '2026-03-01', 'ankle', 28],  // non è ancora successo
    ],
  };

  it('taglia quello che non è ancora cominciato e lascia APERTO quello che finisce dopo', () => {
    const spells = buildSpells(table, '2025-11-03').get(1)!;
    expect(spells.length).toBe(2);
    expect(spells[0].to).toBe('2025-09-20');
    expect(spells[0].days).toBe(19);
    expect(spells[1].to).toBeNull();
    expect(spells[1].days).toBeNull();
  });

  it('senza data legge la tabella come sta scritta, che e` il caso normale', () => {
    const spells = buildSpells(table).get(1)!;
    expect(spells.length).toBe(3);
    expect(spells[1].to).toBe('2025-12-20');
    expect(spells[1].days).toBe(66);
  });
});
