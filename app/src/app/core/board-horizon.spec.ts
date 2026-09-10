import { describe, expect, it } from 'vitest';

import { Board, BoardsFile } from './bundle';
import { boardViewOf, shortShiftOf } from './valuation-store';

/**
 * I DUE ORIZZONTI DELL'UNDICI TIPO: la stagione e l'ULTIMO PERIODO.
 *
 * Richiesta dell'operatore, 10/09/2026: «la formazione tipo nell'ultimo periodo switchabile con quella
 * tipo a lungo periodo». Le due le disegna il TOOLKIT e viaggiano nello stesso `boards.json`; quello che
 * l'app fa - e che questi test coprono - è scegliere quale leggere e dire di quanto si discostano.
 */
const man = (fcId: number, extra: Record<string, unknown> = {}) => ({
  fc_id: fcId, name: `p${fcId}`, codes: null, mantra: null, classic: null, badge: null,
  role_line: null, role_side: null, minutes: null, matches: null, minutes_club: null,
  starts_club: null, minutes_per_match: null, starter_prob: null, claim: null, ...extra,
});

const board = (ids: number[], extra: Record<string, unknown> = {}): Board => ({
  lines: { P: [], D: ids.map((id) => man(id, extra)), M: [], T: [], A: [] },
} as unknown as Board);

const file = (short?: BoardsFile['short']): BoardsFile => ({
  sheet: 'test',
  mode: 'typical',
  apply_rulings: true,
  clubs: { Genoa: board([1, 2, 3]) },
  titolarita: { 1: { status: 'bandiera', play: 0.95, minutes: 88 } },
  short,
});

describe('boardViewOf', () => {
  it('legge la stagione quando è quella scelta', () => {
    const view = boardViewOf(file(), 'season');
    expect(view?.horizon).toBe('season');
    expect(Object.keys(view?.clubs ?? {})).toEqual(['Genoa']);
    // ...e la finestra è null: una finestra è una proprietà della lettura CORTA, e stamparne una sulla
    // stagione direbbe che anche quella guarda tre partite.
    expect(view?.window).toBeNull();
  });

  it('legge l’ultimo periodo quando c’è, con la finestra che il toolkit dichiara', () => {
    const view = boardViewOf(file({
      mode: 'short', window: 3, prior: 3, evidence: 'minutes', owner_matches: 4,
      clubs: { Genoa: board([1, 2, 9]) },
      titolarita: { 9: { status: 'ballottaggio', play: 0.9, minutes: 90, owner_returning: true } },
    }), 'short');
    expect(view?.horizon).toBe('short');
    expect(view?.window).toBe(3);
    expect(view?.rungs['9'].owner_returning).toBe(true);
  });

  it('RIPIEGA sulla stagione quando l’ultimo periodo non c’è, e lo DICE nell’orizzonte', () => {
    // Un bundle scritto prima del 10/09/2026 non porta `short`. La risposta giusta è la lettura che c'è -
    // non un vuoto - e `horizon` deve dire «season», o la barra scriverebbe «ultimo periodo» sopra il
    // disegno di stagione: è la stessa cosa mostrata due volte sotto due nomi.
    const view = boardViewOf(file(), 'short');
    expect(view?.horizon).toBe('season');
    expect(view?.window).toBeNull();
  });

  it('non inventa una lettura dove non c’è nessuna board', () => {
    expect(boardViewOf(null, 'season')).toBeNull();
    expect(boardViewOf(null, 'short')).toBeNull();
  });
});

describe('shortShiftOf', () => {
  it('conta chi l’ultimo periodo schiera e la stagione no, e chi il padrone che rientra ha retrocesso', () => {
    const shift = shortShiftOf(file({
      mode: 'short', window: 3, prior: 3, evidence: 'minutes', owner_matches: 4,
      clubs: {
        Genoa: {
          lines: {
            P: [], D: [man(1), man(2), man(9, { owner_returning: true })], M: [], T: [], A: [],
          },
        } as unknown as Board,
      },
    }), 'Genoa');
    // 9 è nuovo (la stagione schiera 1, 2, 3); 1 e 2 c'erano già.
    expect(shift).toEqual({ moved: 1, capped: 1 });
  });

  it('dice ZERO quando le due board disegnano gli stessi uomini', () => {
    // Uno zero è un risultato e va detto: a zero il pulsante è un ornamento, e questa è la stessa
    // disciplina del conteggio che `snapshot` stampa - uno zero silenzioso non si distingue da una
    // funzione rotta.
    const shift = shortShiftOf(file({
      mode: 'short', window: 3, prior: 3, evidence: 'minutes', owner_matches: 4,
      clubs: { Genoa: board([1, 2, 3]) },
    }), 'Genoa');
    expect(shift).toEqual({ moved: 0, capped: 0 });
  });

  it('risponde NULL - e non zero - quando l’ultimo periodo non c’è o nessun club è scelto', () => {
    expect(shortShiftOf(file(), 'Genoa')).toBeNull();
    expect(shortShiftOf(file({
      mode: 'short', window: 3, prior: 3, evidence: 'minutes', owner_matches: 4,
      clubs: { Genoa: board([1]) },
    }), null)).toBeNull();
  });
});
