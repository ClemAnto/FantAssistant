import {
  GOOD_MATCH,
  LONG_SHIFT,
  POOR_MATCH,
  THIN_SAMPLE,
  matchFrequencies,
} from './match-frequency';
import { MatchCell } from './players-store';

const cell = (over: Partial<MatchCell> = {}): MatchCell => ({
  kind: 'league',
  state: 'played',
  injury: null,
  role: 'A',
  competition: 'serie_a',
  competitionLabel: 'Serie A',
  matchday: 1,
  date: '2026-08-23',
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
  team: 'Juventus',
  opponent: 'Frosinone',
  home: false,
  goalsFor: 1,
  goalsAgainst: 0,
  shape: null,
  formation: null,
  matchId: null,
  matchClub: null,
  ...over,
});

describe('le quattro frequenze', () => {
  it('conta i quattro predicati sulle stesse partite', () => {
    const counted = matchFrequencies(
      [
        cell({ minutes: 90, fantavoto: 9, goals: 1 }),
        cell({ minutes: 86, fantavoto: 6.5 }),
        cell({ minutes: 85, fantavoto: 5.5 }),
        cell({ minutes: 20, fantavoto: 6 }),
      ],
      null,
    );
    expect(counted?.played).toBe(4);
    expect(counted?.long).toBe(0.5);
    // «Almeno 6,5» e non «piu' di 6,5»: e' la frase dell'operatore, e il 6,5 secco e' un voto vero.
    expect(counted?.good).toBe(0.5);
    expect(counted?.bonus).toBe(0.25);
    // «Sotto 6» e non «al massimo 6»: il 6,0 secco resta fuori, ed e' il fantavoto piu' frequente che ci sia.
    expect(counted?.poor).toBe(0.25);
  });

  it("l'85' e' un confine e non un intorno: 85 non passa, 86 si", () => {
    const counted = matchFrequencies([cell({ minutes: LONG_SHIFT }), cell({ minutes: LONG_SHIFT + 1 })], null);
    expect(counted?.long).toBe(0.5);
  });

  it('i confini del fantavoto sono quelli dichiarati, e il sei secco non e insufficiente', () => {
    const counted = matchFrequencies(
      [cell({ fantavoto: GOOD_MATCH }), cell({ fantavoto: POOR_MATCH }), cell({ fantavoto: POOR_MATCH - 0.5 })],
      null,
    );
    expect(counted?.good).toBeCloseTo(1 / 3, 10);
    expect(counted?.poor).toBeCloseTo(1 / 3, 10);
  });

  /**
   * UN BONUS E' UN BONUS, e la lista e' quella che il resto dell'app disegna gia' (`bonusesOf`).
   *
   * Il caso che decide e' l'ammonizione: e' un evento che cambia il fantavoto, e non e' un bonus. Se
   * questa quota fosse scritta come «fantavoto sopra il voto» un gol piu' un rosso leggerebbe «nessun
   * bonus» su una partita in cui ha segnato.
   */
  it('un malus non e un bonus, e un gol con un cartellino resta un bonus', () => {
    const counted = matchFrequencies(
      [cell({ yellows: 1 }), cell({ goals: 1, reds: 1 }), cell({ assistsSetPiece: 1 }), cell({ penScored: 1 })],
      null,
    );
    expect(counted?.bonus).toBe(0.75);
  });

  it('il rigore parato conta per chi era in porta, e i gol subiti non sono un bonus', () => {
    const keeper = matchFrequencies([cell({ role: 'P', penSaved: 1, goalsConceded: 2 })], null);
    expect(keeper?.bonus).toBe(1);
    const conceded = matchFrequencies([cell({ role: 'P', goalsConceded: 3 })], null);
    expect(conceded?.bonus).toBe(0);
  });

  /**
   * OGNUNA COL SUO DENOMINATORE: i minuti li porta il livello per-partita e il fantavoto i voti, quindi
   * una giornata puo' avere gli uni e non l'altro. Contarle sullo stesso numero e' l'errore di unita'
   * che questo progetto paga da sempre.
   */
  it('i tre denominatori sono tre numeri, e una partita senza minuti non dice ne si ne no', () => {
    const counted = matchFrequencies(
      [cell({ minutes: 90, fantavoto: 7 }), cell({ minutes: null, fantavoto: 4 }), cell({ minutes: 90, fantavoto: null })],
      null,
    );
    expect(counted?.played).toBe(3);
    expect(counted?.timed).toBe(2);
    expect(counted?.rated).toBe(2);
    expect(counted?.long).toBe(1);
    expect(counted?.poor).toBe(0.5);
  });

  it('una coppa o un amichevole non entrano: non hanno un fantavoto e non entrano in nessun punteggio', () => {
    const counted = matchFrequencies(
      [cell({ kind: 'cup', minutes: 90 }), cell({ kind: 'friendly', minutes: 90 }), cell({ minutes: 20 })],
      null,
    );
    expect(counted?.played).toBe(1);
    expect(counted?.long).toBe(0);
  });

  it('un campionato straniero SI, ed e dichiarato sintetico', () => {
    const counted = matchFrequencies(
      [cell({ kind: 'other_league', competition: 'premier_league', fantavoto: 7, voteSynthetic: true })],
      null,
    );
    expect(counted?.played).toBe(1);
    expect(counted?.good).toBe(1);
    expect(counted?.synthetic).toBe(true);
  });

  /** Una panchina non e' una partita giocata, e un uomo che non ha giocato non ha una quota: e' ignoto. */
  it('chi non ha giocato niente non ha una quota, e non ha uno zero', () => {
    expect(matchFrequencies([], null)).toBeNull();
    expect(matchFrequencies([cell({ state: 'bench' }), cell({ state: 'injured' })], null)).toBeNull();
  });

  /** Una giornata senza pagella e' comunque una partita giocata: entra nei bonus e non nel fantavoto. */
  it('una giornata senza pagella conta come giocata', () => {
    const counted = matchFrequencies([cell({ state: 'no_vote', fantavoto: null, goals: 1 })], null);
    expect(counted?.played).toBe(1);
    expect(counted?.rated).toBe(0);
    expect(counted?.bonus).toBe(1);
    expect(counted?.good).toBeNull();
  });

  /**
   * LA SOGLIA DEL CAMPIONE E' DERIVATA e non scelta: una quota e' grossolana quando una partita in piu'
   * la sposta di oltre dieci punti, cioe' sotto le dieci partite.
   */
  it('la soglia del campione sottile e quella per cui una partita vale piu di dieci punti', () => {
    expect(1 / (THIN_SAMPLE - 1)).toBeGreaterThan(0.1);
    expect(1 / THIN_SAMPLE).toBeLessThanOrEqual(0.1);
  });
});
