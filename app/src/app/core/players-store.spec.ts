import { cardRows } from './player-card';
import { MatchCell, RecentMatch, competitionKind, isChampionship, seasonMatches } from './players-store';
import { voteClass, voteText } from '../ui/matches-table/vocabulary';

/**
 * «Tutto il calcio che ha giocato», e le due domande che ne discendono.
 *
 * Il caso e' quello dell'operatore (05/09/2026) e i suoi numeri sono MISURATI sul bundle, non
 * inventati: Kolo Muani non ha nessuna riga di Serie A nel 2025-26 e ne ha 32 di Premier League col
 * Tottenham, e il 24/05/2026 contro l'Everton legge 17', rating 6.7 - che la retta di `synth` per il
 * ruolo A (0.2062 + 0.8474 x rating) porta a 5.88 di voto.
 */
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

const tottenham = (day: string, rating: number, synth: number | null): MatchCell =>
  cell({
    kind: 'other_league',
    competition: 'premier_league',
    competitionLabel: 'Premier League',
    matchday: null,
    date: day,
    vote: synth,
    voteSynthetic: synth != null,
    providerRating: rating,
    fantavoto: null,
    team: 'Tottenham Hotspur',
    opponent: 'Everton',
  });

describe('seasonMatches', () => {
  it("porta anche il campionato che non e' il suo: e' il caso da cui la richiesta nasce", () => {
    // Il suo campionato non ha una sola riga di lui: 38 giornate tutte `not_in_league`.
    const missing = new Map<number, MatchCell>();
    for (let md = 1; md <= 38; md++) {
      missing.set(md, cell({ state: 'not_in_league', team: '', opponent: null, date: null }));
    }
    const other = [
      tottenham('2026-05-11', 6.6, 5.8),
      tottenham('2026-05-19', 6.0, 5.29),
      tottenham('2026-05-24', 6.7, 5.88),
    ];
    const out = seasonMatches(undefined, missing, other, '2025-26');
    expect(out.map((one) => one.date)).toEqual(['2026-05-24', '2026-05-19', '2026-05-11']);
    // ...e le 38 giornate di cui non si sa niente NON diventano 38 righe vuote.
    expect(out).toHaveLength(3);
  });

  it("ordina per DATA, perche' due campionati sono due calendari e la giornata non e' piu' un asse", () => {
    const played = new Map([[2, cell({ matchday: 2, date: '2026-08-29' })]]);
    const other = [
      tottenham('2026-08-26', 6.1, 5.4),
      cell({ kind: 'friendly', competition: 'club-friendly-games', date: '2026-08-17' }),
    ];
    const out = seasonMatches(played, undefined, other, '2026-27');
    expect(out.map((one) => one.date)).toEqual(['2026-08-29', '2026-08-26', '2026-08-17']);
  });

  it('i voti battono l\'assenza sulla stessa giornata, e panchina e infortunio restano', () => {
    const played = new Map([[1, cell({ matchday: 1 })]]);
    const missing = new Map([
      [1, cell({ state: 'absent', matchday: 1 })],
      [2, cell({ state: 'bench', matchday: 2, date: '2026-08-29', minutes: 0, vote: null })],
      [3, cell({ state: 'injured', matchday: 3, date: '2026-09-01', team: '', opponent: null })],
      [4, cell({ state: 'absent', matchday: 4, date: '2026-09-06' })],
    ]);
    const out = seasonMatches(played, missing, undefined, '2026-27');
    expect(out.map((one) => one.state)).toEqual(['injured', 'bench', 'played']);
  });

  it("una stagione senza niente resta vuota: non e' un elenco di caselle", () => {
    expect(seasonMatches(undefined, undefined, undefined, '2026-27')).toEqual([]);
  });
});

describe('il tipo di una partita', () => {
  it("un campionato straniero e' un campionato, non una coppa", () => {
    expect(isChampionship('other_league')).toBe(true);
    expect(isChampionship('league')).toBe(true);
    expect(isChampionship('cup')).toBe(false);
    expect(isChampionship('friendly')).toBe(false);
  });

  it("`competitionKind` risponde sullo SLUG e non sa di chi sia il campionato", () => {
    // Non deve mai restituire `other_league`: «e' il suo?» e' una domanda sul GIOCATORE, e questa
    // funzione vede solo il nome della competizione. Chi lo sa e' `buildOtherMatches`.
    expect(competitionKind('premier_league')).toBe('league');
    expect(competitionKind('uefa-champions-league')).toBe('cup');
    expect(competitionKind('club-friendly-games')).toBe('friendly');
  });
});

describe('voteText', () => {
  it("mostra il SINTETICO di un campionato straniero, non il rating del provider", () => {
    // Il difetto che questa riga cura: leggere `kind` invece del voto stampava `*6,7` (scala
    // Sofascore) su una riga che ha `~5,9` (scala fantacalcio).
    expect(voteText(tottenham('2026-05-24', 6.7, 5.88))).toBe('~5.9');
  });

  it('senza sintetico ripiega sul rating, marcato perche\' e\' un\'altra scala', () => {
    expect(voteText(tottenham('2026-05-24', 6.7, null))).toBe('*6.7');
  });

  it("nel SUO campionato «nessun voto» resta s.v. anche se il provider lo ha votato", () => {
    // s.v. e' un fatto pubblicato, non un buco da riempire con un numero di un'altra scala.
    expect(voteText(cell({ vote: null, providerRating: 6.9 }))).toBe('s.v.');
  });

  it('una coppa senza rating non inventa niente', () => {
    expect(voteText(cell({ kind: 'cup', vote: null, providerRating: null }))).toBe('·');
  });
});

describe('voteClass', () => {
  it("le fasce del voto valgono per il sintetico, che e' sulla stessa scala", () => {
    // L'affermazione non e' «questo numero e' verde»: e' che lo STESSO numero prende la STESSA fascia
    // da qualunque parte arrivi. Asserirla cosi' e' anche l'unico modo di non ricopiare qui le soglie.
    for (const value of [7.3, 6.39, 5.29, 4.8]) {
      expect(voteClass(tottenham('2026-05-03', 7.0, value))).toBe(voteClass(cell({ vote: value })));
    }
    expect(voteClass(tottenham('2026-05-03', 7.0, 6.39))).toContain('text-success');
    expect(voteClass(tottenham('2026-05-03', 7.0, 4.8))).toContain('text-danger');
  });

  it("il rating del provider resta neutro: colorarlo sarebbe un'affermazione mai misurata", () => {
    expect(voteClass(tottenham('2026-05-24', 6.7, null))).toBe('text-muted');
  });
});


describe('cardRows', () => {
  const at = (season: string, team: string, date: string): RecentMatch => ({
    season,
    cell: cell({ team, date, competition: 'serie_a' }),
  });

  it("annuncia la stagione e il cambio di squadra, e li annuncia tutt'e due", () => {
    const rows = cardRows(
      [
        at('2026-27', 'Juventus', '2026-08-29'),
        at('2026-27', 'Juventus', '2026-08-23'),
        at('2025-26', 'Tottenham Hotspur', '2026-05-24'),
        at('2025-26', 'Tottenham Hotspur', '2026-05-19'),
      ],
      'Juventus',
    );
    expect(rows.map((one) => one.season)).toEqual([null, null, '2025-26', null]);
    expect(rows.map((one) => one.club)).toEqual([null, null, 'Tottenham Hotspur', null]);
  });

  it("la prima riga non annuncia niente: la squadra di adesso e' nell'intestazione", () => {
    const rows = cardRows([at('2026-27', 'Juventus', '2026-08-29')], 'Juventus');
    expect(rows[0]).toEqual({
      match: expect.anything(),
      season: null,
      club: null,
      totals: '2026-27',
    });
  });

  it('il riepilogo va su OGNI stagione, compresa quella in cima che non ha divisore', () => {
    // Operatore, 05/09/2026: «sotto la scritta ULTIME PARTITE, come per le altre stagioni, aggiungi le
    // medie per ogni colonna». Il divisore e il riepilogo sono due annunci diversi, e la stagione in
    // corso ha il secondo senza il primo: leggerlo dal divisore lo toglieva alla stagione che si compra.
    const rows = cardRows(
      [
        at('2026-27', 'Juventus', '2026-08-29'),
        at('2026-27', 'Juventus', '2026-08-23'),
        at('2025-26', 'Juventus', '2026-05-24'),
      ],
      'Juventus',
    );
    expect(rows.map((one) => one.season)).toEqual([null, null, '2025-26']);
    expect(rows.map((one) => one.totals)).toEqual(['2026-27', null, '2025-26']);
  });

  it('due grafie dello stesso club non sono un trasferimento', () => {
    // I VOTI scrivono `Milan`, il layer per-partita `AC Milan`: senza la chiave normalizzata la card
    // stamperebbe un divisore fra due partite della stessa squadra.
    const rows = cardRows(
      [at('2026-27', 'Milan', '2026-08-29'), at('2026-27', 'AC Milan', '2026-08-23')],
      'AC Milan',
    );
    expect(rows.map((one) => one.club)).toEqual([null, null]);
  });

  it("una giornata senza squadra non e' un cambio di squadra", () => {
    // Un infortunio non porta nessun club: leggerlo come un trasferimento stamperebbe DUE divisori
    // attorno a ogni riga saltata, e riporterebbe «Juventus» come se fosse una novita'.
    const rows = cardRows(
      [
        at('2026-27', 'Juventus', '2026-08-29'),
        { season: '2026-27', cell: cell({ team: '', opponent: null, state: 'injured' }) },
        at('2026-27', 'Juventus', '2026-08-23'),
      ],
      'Juventus',
    );
    expect(rows.map((one) => one.club)).toEqual([null, null, null]);
  });
});

describe('cardRows e il club di oggi', () => {
  it("annuncia il club gia' sulla PRIMA riga quando non e' quello di adesso", () => {
    // Il caso di Beto: il foglio lo da' alla Fiorentina e tutte le sue partite sono dell'Everton,
    // quindi dentro l'elenco non c'e' nessun «cambio» - e senza questo la card evidenziava
    // quarantasei righe senza mai dire di quale squadra fossero.
    const rows = cardRows(
      [
        { season: '2026-27', cell: cell({ team: 'Everton', date: '2026-08-29' }) },
        { season: '2026-27', cell: cell({ team: 'Everton', date: '2026-08-23' }) },
      ],
      'Fiorentina',
    );
    expect(rows.map((one) => one.club)).toEqual(['Everton', null]);
  });
});
