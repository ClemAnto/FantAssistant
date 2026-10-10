import { parseWidgetAnswer, widgetMen } from './widget-feed';

describe('widgetMen', () => {
  it('joins by OUR club id, and names the men whose club has no SofaScore id', () => {
    const { men, missing } = widgetMen(
      [
        { name: 'Bastoni', role: 'Dc', club: 'Inter', clubId: 8, fcId: 1 },
        { name: 'Senzaclub', role: 'C', club: 'Ignota', clubId: null, fcId: 2 },
        { name: 'Fuori', role: 'A', club: 'Altrove', clubId: 999, fcId: 3 },
      ],
      { '8': 2697 },
    );
    expect(men.map((m) => m.team)).toEqual([2697, null, null]);
    expect(missing).toEqual(['Senzaclub', 'Fuori']);
  });

  it('a bundle without the file sends nobody, and says who', () => {
    const { men, missing } = widgetMen([{ name: 'Bastoni', role: 'Dc', club: 'Inter', clubId: 8, fcId: 1 }], null);
    expect(men[0].team).toBeNull();
    expect(missing).toEqual(['Bastoni']);
  });
});

describe('widgetMen player ids', () => {
  it('carries his SofaScore id by OUR fc_id, and null where the bundle has none', () => {
    const { men } = widgetMen(
      [
        { name: 'Bastoni', role: 'Dc', club: 'Inter', clubId: 8, fcId: 1 },
        { name: 'Nuovo', role: 'C', club: 'Inter', clubId: 8, fcId: 9 },
      ],
      { '8': 2697 },
      { '1': 254491 },
    );
    expect(men.map((m) => m.id)).toEqual([254491, null]);
  });
});

describe('parseWidgetAnswer', () => {
  it('reads the Sheet answer and refuses anything else', () => {
    expect(parseWidgetAnswer({ ok: true, matches: 4 })?.matches).toBe(4);
    expect(parseWidgetAnswer({ ok: false, why: 'chiave segreta sbagliata' })?.why).toBe('chiave segreta sbagliata');
    expect(parseWidgetAnswer({ round: 7, clubs: {} })).toBeNull();
    expect(parseWidgetAnswer(null)).toBeNull();
  });
});
