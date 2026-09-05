import { ScoringConfig } from './bundle';
import {
  FULL_MATCH,
  PLAYED_THE_MATCH,
  roundVote,
  syntheticFantavoto,
  bonusesOf,
  spellOf,
} from './match-bonuses';
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


describe('roundVote', () => {
  it("mette il sintetico sulla griglia dei mezzi punti, che e' quella dei voti veri", () => {
    // I numeri sono quelli di Kolo Muani col Tottenham: rating 6,7 / 6,0 / 6,6 / 7,3 -> mv_synth.
    expect([5.88, 5.29, 5.8, 6.39].map(roundVote)).toEqual([6, 5.5, 6, 6.5]);
  });

  it("un voto gia' sulla griglia non si muove", () => {
    expect([3, 5.5, 6, 10].map(roundVote)).toEqual([3, 5.5, 6, 10]);
  });
});

describe('syntheticFantavoto', () => {
  const synth = (over: Partial<MatchCell> = {}) =>
    cell({ kind: 'other_league', vote: 6, voteSynthetic: true, fantavoto: null, ...over });

  it('somma i bonus al voto sintetico, coi punteggi di QUEL campionato', () => {
    // `premier_league` non ha una riga sua in questo file di punteggi, quindi vale il default: 3 a gol.
    expect(syntheticFantavoto(synth({ competition: 'premier_league', goals: 1 }), SCORING)).toBe(9);
    // ...e in Serie A un gol ne vale 4, che e' esattamente perche' il punteggio e' per campionato.
    expect(syntheticFantavoto(synth({ goals: 1 }), SCORING)).toBe(10);
  });

  it('sottrae i malus come li somma', () => {
    expect(syntheticFantavoto(synth({ role: 'C', yellows: 1 }), SCORING)).toBe(5.5);
  });

  it("non tocca una partita che il fantavoto ce l'ha gia' dalla fonte", () => {
    // Il voto non e' sintetico: il fantavoto e' quello pubblicato, e un secondo conto sarebbe un
    // secondo numero per la stessa partita.
    expect(syntheticFantavoto(cell({ goals: 1 }), SCORING)).toBeNull();
  });

  it("un PORTIERE porta i suoi gol subiti, presi dai gol dell'avversario", () => {
    // La richiesta dell'operatore del 05/09/2026: due gol dell'avversario sono due punti in meno.
    expect(syntheticFantavoto(synth({ role: 'P', goalsConceded: 2 }), SCORING)).toBe(4);
    expect(syntheticFantavoto(synth({ role: 'P', goalsConceded: 0 }), SCORING)).toBe(6);
  });

  it('...e se i gol subiti non si sono potuti contare, non si calcola affatto', () => {
    // Sommare quello che c'e' gli darebbe fantavoto = voto, cioe' una promessa che nessuna sua
    // partita mantiene. La condizione e' sul DATO, non sul ruolo.
    expect(syntheticFantavoto(synth({ role: 'P', goalsConceded: null }), SCORING)).toBeNull();
  });

  it("il bonus porta inviolata NON si somma, perche' la fonte non lo somma", () => {
    // Misurato: su 1.222 portieri a porta inviolata il fantavoto pubblicato e' `voto + bonus` senza
    // premio in 1.218 casi. E' un modificatore di lega, non un termine della riga.
    const terms = SCORING.default.clean_sheet_bonus_gk;
    expect(terms).toBe(1);
    expect(syntheticFantavoto(synth({ role: 'P', goalsConceded: 0 }), SCORING)).toBe(6);
  });

  it('senza il file dei punteggi non inventa una somma', () => {
    expect(syntheticFantavoto(synth({ goals: 1 }), null)).toBeNull();
  });

  it("senza eventi il fantavoto E' il voto", () => {
    expect(syntheticFantavoto(synth({ role: 'D' }), SCORING)).toBe(6);
  });
});

describe('PLAYED_THE_MATCH', () => {
  it("e' il pavimento della scala e NON il 90 che dice se e' stato sostituito", () => {
    // Tre numeri per tre affermazioni, e il difetto da impedire e' che qualcuno li unifichi:
    // 90 = «e' uscito», 75 = «e' stata una sua partita» (`engine/status.py:FULL_MATCH`, il pavimento
    // che l'operatore aveva gia' dichiarato per `bandiera`), 65 = il terzo gradino della scala.
    expect(PLAYED_THE_MATCH).toBe(75);
    expect(PLAYED_THE_MATCH).not.toBe(FULL_MATCH);
  });

  it('separa una partita giocata da un pezzo di partita, e il 75 sta dentro', () => {
    expect(75 < PLAYED_THE_MATCH).toBe(false); // 75' e' una partita sua: >= e non >
    expect(74 < PLAYED_THE_MATCH).toBe(true);
  });
});
