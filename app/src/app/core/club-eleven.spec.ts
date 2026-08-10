import { Board, BoardMan } from './bundle';
import { OnTable, lineCounts, pitchOf } from './club-eleven';

const man = (name: string, x: number, over: Partial<BoardMan> = {}): BoardMan => ({
  fc_id: name.length,
  name,
  codes: 'DC',
  role_line: 'D',
  role_side: '0.0',
  minutes: '1800',
  matches: '24',
  minutes_club: '1800',
  starts_club: '20',
  minutes_per_match: '75',
  starter_prob: null,
  x,
  claim: 0.8,
  duels: [],
  duels_known: true,
  ...over,
});

const board = (picture: string, lines: Partial<Board['lines']>, over: Partial<Board> = {}): Board => ({
  picture,
  board_shape: picture,
  formation_typical: picture,
  coach: 'Mister',
  new_coach: 'no',
  why: 'perché',
  odds: { [picture]: 0.5 },
  lines: { P: [], D: [], M: [], T: [], A: [], ...lines } as Board['lines'],
  ...over,
});

const free: OnTable = { taken: false, price: 20, onTable: true };
const nowhere = (): OnTable => ({ taken: false, price: null, onTable: false });

describe('lineCounts', () => {
  it('reads three numbers as defence, midfield and attack, with the keeper always alone', () => {
    expect(lineCounts('4-3-3')).toEqual({ P: 1, D: 4, M: 3, T: 0, A: 3 });
    expect(lineCounts('3-5-2')).toEqual({ P: 1, D: 3, M: 5, T: 0, A: 2 });
  });

  it('reads FOUR numbers with the third as the trequarti and the last always the attack', () => {
    expect(lineCounts('4-2-3-1')).toEqual({ P: 1, D: 4, M: 2, T: 3, A: 1 });
    expect(lineCounts('3-4-1-2')).toEqual({ P: 1, D: 3, M: 4, T: 1, A: 2 });
  });

  it('refuses what it cannot read instead of guessing a shape', () => {
    expect(lineCounts('')).toBeNull();
    expect(lineCounts(null)).toBeNull();
    expect(lineCounts('4-4-2-1-1')).toBeNull();
  });
});

describe('pitchOf', () => {
  it('reads `new_coach` as the WORD it is: `no` is not a new coach', () => {
    // The column that looks like a flag is `yes`/`no`, so `Boolean(...)` reads `no` as true - which would
    // have called every coach of the listone new. Found by this test before it shipped.
    const old = pitchOf(board('4-3-3', { P: [man('Portiere', 0.5)] }, { new_coach: 'no' }), () => free)!;
    const fresh = pitchOf(board('4-3-3', { P: [man('Portiere', 0.5)] }, { new_coach: 'yes' }), () => free)!;
    expect(old.newCoach).toBe(false);
    expect(fresh.newCoach).toBe(true);
  });

  it('draws the rows the module asks for, attack first and the goal last', () => {
    const drawn = pitchOf(board('4-3-3', {
      P: [man('Portiere', 0.5)],
      D: [man('A', 0.1), man('B', 0.37), man('C', 0.63), man('D', 0.89)],
      M: [man('E', 0.28), man('F', 0.5), man('G', 0.72)],
      A: [man('H', 0.11), man('I', 0.5), man('J', 0.89)],
    }), () => free)!;
    expect(drawn.rows.map((row) => row.line)).toEqual(['A', 'M', 'D', 'P']);
    expect(drawn.rows.map((row) => row.wanted)).toEqual([3, 3, 4, 1]);
    expect(drawn.problems).toEqual([]);
    // The panel's own horizontal position travels through untouched: that is what makes a flank a flank.
    expect(drawn.rows.at(-1)!.men[0].x).toBe(0.5);
    expect(drawn.rows[2].men[0].x).toBe(0.1);
  });

  it('keeps the TREQUARTI as its own row when the module has four numbers', () => {
    const drawn = pitchOf(board('4-2-3-1', {
      P: [man('Portiere', 0.5)],
      D: [man('A', 0.1), man('B', 0.37), man('C', 0.63), man('D', 0.89)],
      M: [man('E', 0.35), man('F', 0.65)],
      T: [man('G', 0.15), man('H', 0.5), man('I', 0.85)],
      A: [man('J', 0.5)],
    }), () => free)!;
    expect(drawn.rows.map((row) => row.line)).toEqual(['A', 'T', 'M', 'D', 'P']);
    expect(drawn.rows[1].wanted).toBe(3);
  });

  it('REPORTS a line where the module and the drawn men disagree, and still draws it', () => {
    const drawn = pitchOf(board('4-3-3', {
      P: [man('Portiere', 0.5)],
      D: [man('A', 0.2), man('B', 0.8)],          // the module says four
      M: [man('E', 0.28), man('F', 0.5), man('G', 0.72)],
      A: [man('H', 0.11), man('I', 0.5), man('J', 0.89)],
    }), () => free)!;
    expect(drawn.problems.length).toBe(1);
    expect(drawn.problems[0]).toContain('linea D');
    expect(drawn.rows.find((row) => row.line === 'D')!.men.length).toBe(2);
  });

  it('marks who is already TAKEN, which is the only thing the board cannot know', () => {
    const gone = (name: string): OnTable => ({ taken: name === 'B', price: 30, onTable: true });
    const drawn = pitchOf(board('3-4-3', {
      P: [man('Portiere', 0.5)],
      D: [man('A', 0.2), man('B', 0.5), man('C', 0.8)],
      M: [man('D', 0.1), man('E', 0.4), man('F', 0.6), man('G', 0.9)],
      A: [man('H', 0.2), man('I', 0.5), man('J', 0.8)],
    }), (candidate) => gone(candidate.name ?? ''))!;
    expect(drawn.taken).toBe(1);
    expect(drawn.rows.find((row) => row.line === 'D')!.men[1].taken).toBe(true);
  });

  it('a man the session listone does not carry is not «free»: he is not on the table', () => {
    const drawn = pitchOf(board('4-3-3', { P: [man('Portiere', 0.5)] }), nowhere)!;
    const keeper = drawn.rows.at(-1)!.men[0];
    expect(keeper.onTable).toBe(false);
    expect(keeper.taken).toBe(false);
    expect(keeper.price).toBeNull();
  });

  it('carries the ballottaggi, and «unknown» is not «no rival»', () => {
    const withDuels = man('Titolare', 0.5, {
      duels: [man('Rivale1', 0), man('Rivale2', 0)],
      duels_known: true,
    });
    const blind = man('Senza ruolo', 0.5, { duels: [], duels_known: false, codes: null });
    const drawn = pitchOf(board('4-3-3', { P: [withDuels], D: [blind] }), () => free)!;
    expect(drawn.rows.at(-1)!.men[0].duels.map((rival) => rival.name)).toEqual(['Rivale1', 'Rivale2']);
    const unknown = drawn.rows.find((row) => row.line === 'D')!.men[0];
    expect(unknown.duels.length).toBe(0);
    expect(unknown.duelsKnown).toBe(false);
    expect(unknown.codes).toEqual([]);
  });

  it('says when the fit was solved on a DIFFERENT module than the one drawn', () => {
    const drawn = pitchOf(board('4-2-3-1', { P: [man('Portiere', 0.5)] },
                                { board_shape: '4-3-3' }), () => free)!;
    expect(drawn.module).toBe('4-2-3-1');
    expect(drawn.solvedOn).toBe('4-3-3');
  });

  it('draws nothing for a club the panel could not draw, and nothing for an unreadable module', () => {
    expect(pitchOf({ error: 'boom' } as Board, () => free)).toBeNull();
    expect(pitchOf(board('quattro-tre-tre', { P: [man('Portiere', 0.5)] }), () => free)).toBeNull();
    expect(pitchOf(null, () => free)).toBeNull();
  });
});
