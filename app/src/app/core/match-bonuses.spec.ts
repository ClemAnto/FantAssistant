import { ScoringConfig } from './bundle';
import { bonusesOf, spellOf } from './match-bonuses';
import { MatchCell } from './players-store';

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
  ...over,
});

describe('bonusesOf', () => {
  it('elenca solo quello che è successo, e il punteggio è quello del CAMPIONATO di quella partita', () => {
    const rows = bonusesOf(cell({ goals: 2, assists: 1 }), SCORING);
    expect(rows.map((one) => one.short)).toEqual(['G', 'A']);
    expect(rows.map((one) => one.kind)).toEqual(['goal', 'assist']);
    // 4 e non 3: la Serie A sovrascrive il default, ed è la ragione per cui il file esiste.
    expect(rows[0]).toMatchObject({ count: 2, points: 8, good: true });
    expect(rows[1]).toMatchObject({ count: 1, points: 1, good: true });
  });

  it('senza il file dei punteggi l\'evento resta un FATTO e il suo valore no: `points` è null, mai zero', () => {
    const rows = bonusesOf(cell({ yellows: 1 }), null);
    expect(rows).toEqual([
      { kind: 'yellow', label: 'Ammonizioni', short: 'Amm', count: 1, points: null, good: false },
    ]);
  });

  it('i gol subiti e i rigori parati sono del PORTIERE, e il ruolo è quello della RIGA di quella partita', () => {
    const outfield = bonusesOf(cell({ role: 'D', goalsConceded: 2 }), SCORING);
    expect(outfield).toEqual([]);
    const keeper = bonusesOf(cell({ role: 'P', goalsConceded: 2, penSaved: 1 }), SCORING);
    expect(keeper.map((one) => one.short)).toEqual(['Rp', 'Gs']);
    // IL MARCHIO SI SCEGLIE SUL `kind`, che è il vocabolario che ogni pagina legge.
    expect(keeper.map((one) => one.kind)).toEqual(['pen-saved', 'conceded']);
    expect(keeper[1]).toMatchObject({ points: -2, good: false });
  });
});

describe('spellOf', () => {
  it('chi parte e finisce non porta nessuna freccia', () => {
    expect(spellOf(cell({ started: true, minutes: 90 }))).toEqual({ minutes: 90, on: false, off: false });
  });

  it('chi parte e non c\'è alla fine è USCITO', () => {
    expect(spellOf(cell({ started: true, minutes: 63 }))).toEqual({ minutes: 63, on: false, off: true });
  });

  it('chi non parte ed entra è SUBENTRATO', () => {
    expect(spellOf(cell({ started: false, minutes: 30 }))).toEqual({ minutes: 30, on: true, off: false });
  });

  it('DI UN SUBENTRATO NON SI SA SE POI È USCITO, e non lo si inventa', () => {
    // I minuti sono i SUOI, non l'ora del campo: 27' è un uomo entrato al 63' - che quei 27 li abbia
    // finiti o no, questa riga non lo sa. Senza il minuto d'ingresso la freccia rossa resta spenta.
    expect(spellOf(cell({ started: false, minutes: 27 })).off).toBe(false);
  });

  it('chi entra e non gioca nemmeno un minuto non porta nessuna freccia', () => {
    expect(spellOf(cell({ started: false, minutes: 0 }))).toEqual({ minutes: 0, on: false, off: false });
  });

  it('senza i minuti o senza la distinta non si disegna niente: «vuoto = ignoto», mai una freccia inventata', () => {
    expect(spellOf(cell({ started: true, minutes: null }))).toEqual({ minutes: null, on: false, off: false });
    expect(spellOf(cell({ started: null, minutes: 45 }))).toEqual({ minutes: 45, on: false, off: false });
  });
});
