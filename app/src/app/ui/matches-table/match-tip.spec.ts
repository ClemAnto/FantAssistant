import { ScoringConfig } from '../../core/bundle';
import { MatchCell } from '../../core/players-store';
import { matchTip } from './match-tip';

const SCORING: ScoringConfig = {
  default: {
    goal_bonus: 3,
    penalty_scored_bonus: 3,
    penalty_missed_malus: 3,
    assist_bonus: 1,
    assist_set_piece_bonus: 1,
    own_goal_malus: 2,
    yellow_card_malus: 0.5,
    red_card_malus: 1,
    goal_conceded_malus_gk: 1,
    penalty_saved_bonus_gk: 3,
    clean_sheet_bonus_gk: 1,
  },
  leagues: { serie_a: { goal_bonus: 4 } },
};

const cell = (over: Partial<MatchCell> = {}): MatchCell => ({
  kind: 'league',
  state: 'played',
  injury: null,
  role: 'A',
  competition: 'serie_a',
  competitionLabel: 'Serie A',
  matchday: 3,
  date: '2026-09-01',
  vote: 6,
  voteSynthetic: false,
  providerRating: null,
  fantavoto: 6,
  goals: 0,
  assists: 0,
  assistsSetPiece: 0,
  penScored: 0,
  penMissed: 0,
  penSaved: 0,
  ownGoals: 0,
  goalsConceded: null,
  xg: null,
  xa: null,
  yellows: 0,
  reds: 0,
  minutes: 90,
  started: true,
  team: 'Inter',
  opponent: 'Monza',
  home: true,
  goalsFor: 2,
  goalsAgainst: 1,
  shape: null,
  formation: null,
  matchId: null,
  matchClub: null,
  ...over,
});

const labels = (over: Partial<MatchCell> = {}, scoring: ScoringConfig | null = SCORING) =>
  matchTip(cell(over), scoring).rows.map((row) => row.label);

describe('matchTip', () => {
  it('e\' un ELENCO e non una frase, e il verso di ogni riga viene da `BonusRow.good`', () => {
    const tip = matchTip(cell({ goals: 1, yellows: 1, fantavoto: 8.5 }), SCORING);
    expect(tip.fixture).toBe('Inter - Monza');
    expect(tip.when).toBe('3ª · 01/09/2026');
    expect(tip.rows.map((row) => [row.label, row.tone, row.value])).toEqual([
      ['In campo', 'plain', "90'"],
      // 4 e non 3: il punteggio e' quello del campionato di QUELLA partita.
      ['Gol', 'good', '+4'],
      ['Ammonizione', 'bad', '-0.5'],
      ['Fantavoto', 'plain', '8.5'],
    ]);
  });

  it('mette i MINUTI, che era la meta\' della richiesta, coi due triangolini accanto', () => {
    const on = matchTip(cell({ started: false, minutes: 27 }), SCORING).rows[0];
    expect(on).toMatchObject({ label: 'In campo', value: "27'" });
    expect(on.spell).toMatchObject({ on: true, off: false });

    const off = matchTip(cell({ started: true, minutes: 63 }), SCORING).rows[0];
    expect(off.spell).toMatchObject({ on: false, off: true });
    // Sotto i 75' la riga e' grigia: e' la soglia gia' dichiarata per «e' stata una sua partita».
    expect(off.tone).toBe('muted');
    expect(matchTip(cell({ minutes: 90 }), SCORING).rows[0].tone).toBe('plain');
  });

  it('senza minuti o senza distinta non inventa una freccia, e lo dice invece di scrivere zero', () => {
    const row = matchTip(cell({ minutes: null, started: null }), SCORING).rows[0];
    expect(row.value).toBe('minuti ignoti');
    expect(row.spell).toMatchObject({ on: false, off: false });
  });

  it('la prima riga dice PERCHE\' non ha giocato, e un infortunio e\' giallo e non rosso', () => {
    const hurt = matchTip(cell({ state: 'injured', minutes: null }), SCORING);
    expect(hurt.rows[0]).toMatchObject({ tone: 'warn', icon: 'medicine-box' });
    // ...e allora non c'e' nessuna riga di minuti: non era in campo.
    expect(hurt.rows.map((row) => row.label)).not.toContain('In campo');

    expect(matchTip(cell({ state: 'bench', minutes: null }), SCORING).rows[0].tone).toBe('muted');
  });

  it('senza il file dei punteggi l\'evento resta un fatto e il numero non c\'e\': null, mai zero', () => {
    const row = matchTip(cell({ goals: 1 }), null).rows.find((one) => one.label === 'Gol')!;
    expect(row.value).toBeNull();
    expect(row.tone).toBe('good');
  });

  it('NON ripete il voto, che e\' il numero sotto il puntatore, e porta il fantavoto', () => {
    expect(labels()).toEqual(['In campo', 'Fantavoto']);
    expect(labels({ fantavoto: null })).toEqual(['In campo']);
    // Il sintetico si marca come nella cella: `~`, e non come un voto pubblicato.
    const synth = matchTip(cell({ voteSynthetic: true, fantavoto: 7 }), SCORING).rows;
    expect(synth[synth.length - 1].value).toBe('~7.0');
  });

  it('al singolare un evento si chiama col suo nome, al plurale porta il conto', () => {
    expect(labels({ goals: 1 })).toContain('Gol');
    expect(labels({ goals: 2 })).toContain('2 gol');
    expect(labels({ penMissed: 1 })).toContain('Rigore sbagliato');
    expect(labels({ role: 'P', goalsConceded: 1 })).toContain('Gol subito');
    // I due assist restano distinti: sono due voci del punteggio, non due parole per una cosa.
    expect(labels({ assists: 1, assistsSetPiece: 1 })).toEqual(
      expect.arrayContaining(['Assist', 'Assist da fermo']),
    );
  });

  it('l\'incontro e\' nell\'ordine in cui si e\' giocato, e una coppa non ha giornate', () => {
    expect(matchTip(cell({ home: false }), SCORING).fixture).toBe('Monza - Inter');
    expect(matchTip(cell({ opponent: null }), SCORING).fixture).toBe('Inter');
    expect(matchTip(cell({ kind: 'cup', competitionLabel: 'Champions' }), SCORING).when).toBe(
      'Champions · 01/09/2026',
    );
  });
});
