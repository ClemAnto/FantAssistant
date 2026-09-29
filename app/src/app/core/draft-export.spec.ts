import type { AuctionPlayer, AuctionTeam } from './auction-feed';
import { ExportReadings, pickRecords, picksCsv, squadsCsv, toCsv } from './draft-export';

function player(id: number, name: string, zone: AuctionPlayer['zoneClassic'], roles: string[]): AuctionPlayer {
  return { id, name, club: 'Inter', roles, zoneClassic: zone, zoneMantra: 'mov', championship: null, fvm: id * 10 };
}

function team(id: number, label: string): AuctionTeam {
  return {
    id, label, colour: '', online: true, host: false, spent: 0, budgetLeft: 0, squad: [],
    missing: {}, missingTotal: 0, orderIndex: -1, onTheClock: false,
  };
}

const A = team(1, 'Alfa');
const B = team(2, 'Beta');
const picks = [
  { team: A, player: player(10, 'Lautaro', 'atk', ['pc']), cost: 100 },
  { team: B, player: player(20, "D'Ambrosio; jr", 'def', ['dc', 'b']), cost: 50 },
  { team: B, player: player(30, 'Sommer', 'gk', ['por']), cost: 20 },
  { team: A, player: player(40, 'Barella', 'mid', ['c', 't']), cost: 80 },
];

const readings = (id: number): ExportReadings | null =>
  id === 10
    ? { rung: 'titolare', rungSource: 'stampa', fm: 7.456, pv: 30.04, value: 224.1, value99: 97 }
    : null;

describe('draft export', () => {
  it('counts each squad its own turn, in call order', () => {
    const records = pickRecords(picks);
    expect(records.map((r) => [r.overall, r.team?.label, r.round])).toEqual([
      [1, 'Alfa', 1], [2, 'Beta', 1], [3, 'Beta', 2], [4, 'Alfa', 2],
    ]);
  });

  it('writes the pick list in call order, with a point for decimals and empty cells for the unknown', () => {
    const lines = picksCsv(pickRecords(picks), 1, readings).trimEnd().split('\r\n');
    expect(lines).toHaveLength(5);
    expect(lines[0].split(';')[0]).toBe('scelta');
    expect(lines[1]).toBe('1;1;Alfa;si;10;Lautaro;Inter;A;pc;100;100;titolare;stampa;7.46;30.04;224.1;97');
    // A man the page cannot price: every reading empty, never a zero.
    expect(lines[4]).toBe('4;2;Alfa;si;40;Barella;Inter;C;c,t;400;80;;;;;;');
  });

  it('quotes a cell that carries the separator or a quote', () => {
    const lines = picksCsv(pickRecords(picks), null, readings).split('\r\n');
    expect(lines[2]).toContain(';"D\'Ambrosio; jr";');
    expect(toCsv(['a'], [['say "hi"']])).toBe('a\r\n"say ""hi"""\r\n');
  });

  it('groups the squads by team in the teams order, and by turn inside a team', () => {
    const lines = squadsCsv(pickRecords(picks), [B, A], 2, readings).trimEnd().split('\r\n').slice(1);
    expect(lines.map((line) => line.split(';').slice(0, 3).join(';'))).toEqual([
      '2;1;Beta', '3;2;Beta', '1;1;Alfa', '4;2;Alfa',
    ]);
    expect(lines[0].split(';')[3]).toBe('si');
  });
});
