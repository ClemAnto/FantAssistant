import { describe, expect, it } from 'vitest';

import {
  MIN_TREND_POOL,
  ROW_TREND_MATCHES,
  isKnownAbsence,
  parseTrend,
  rowTrend,
  trendScores,
} from './player-trend';

/** One record of `desc_trend_detail`, in the sixteen fields the toolkit writes. */
function record(fields: Partial<Record<number, string>>): string {
  const base = [
    '2026-05-01', 'serie_a', 'Lazio', 'A', 'p', '90', '1', '6.5', 'real', '6.5', '0', '0', '0', '0',
    '0.20', '1',
  ];
  for (const [at, value] of Object.entries(fields)) base[Number(at)] = value as string;
  return base.join('|');
}

describe('parseTrend', () => {
  it('reads the sixteen fields and keeps the toolkit’s own order', () => {
    const [match] = parseTrend(record({ 4: 'p', 5: '63', 6: '', 10: '1', 12: '1', 15: '0' }));
    expect(match.minutes).toBe(63);
    expect(match.started).toBe(false);
    expect(match.goals).toBe(1);
    expect(match.yellows).toBe(1);
    expect(match.inEuro).toBe(false);
  });

  it('never turns an unknown into a zero', () => {
    // A synthetic round has no cards at all (the per-match layer carries no bookings) and a season
    // the provider served no xG for has no xG: both must stay null, or the strip draws a fact nobody
    // measured. Same rule as everywhere else here - «vuoto = ignoto, mai zero».
    const [match] = parseTrend(record({ 8: 'synth', 12: '', 13: '', 14: '', 15: '' }));
    expect(match.yellows).toBeNull();
    expect(match.reds).toBeNull();
    expect(match.xga).toBeNull();
    expect(match.inEuro).toBeNull();
    expect(match.voteSource).toBe('synth');
  });

  it('skips a record shorter than the format instead of padding it', () => {
    // A bundle older than the column would otherwise read as «voto 0, dentro il calendario».
    expect(parseTrend('2026-05-01|serie_a|Lazio|A|p|90|1')).toEqual([]);
    expect(parseTrend(null)).toEqual([]);
  });
});

describe('isKnownAbsence', () => {
  it('counts the four reasons we know and not the two we do not', () => {
    // The four count ZERO in the mean because he really was not on the pitch; `n` (no data at all)
    // and `x` (an eleven with no statistics) are unknown, and a zero there would say he was bad.
    expect(['b', 'i', 's', 'o'].every(isKnownAbsence as never)).toBe(true);
    expect(['p', 'n', 'x'].some(isKnownAbsence as never)).toBe(false);
  });
});

describe('trendScores', () => {
  const pool = (role: string, values: number[]) =>
    values.map((fp, index) => ({ id: index + 1 + (role === 'A' ? 100 : 0), role, fp }));

  it('scales inside the ROLE, so a defender is not ranked against a striker', () => {
    const forwards = pool('A', Array.from({ length: MIN_TREND_POOL }, (_x, i) => 4 + i * 0.5));
    const defenders = pool('D', Array.from({ length: MIN_TREND_POOL }, (_x, i) => 2 + i * 0.2));
    const scores = trendScores([...forwards, ...defenders]);
    expect(scores.get(forwards.at(-1)!.id)).toBe(99);
    expect(scores.get(defenders.at(-1)!.id)).toBe(99);
    // the best defender collects 3.4 against the best forward's 7.5 and still reads 99: the column
    // answers «how is HE going», not «is a defender worth as much as a striker»
    expect(scores.get(defenders[0].id)).toBe(Math.round((2 / 3.4) * 99));
  });

  it('refuses a pool too thin to be a distribution, and never invents a zero', () => {
    const thin = pool('P', [5, 6, 7]);
    expect(trendScores(thin).size).toBe(0);
    const withHoles = [
      ...pool('A', Array.from({ length: MIN_TREND_POOL }, () => 6)),
      { id: 999, role: 'A', fp: null },
    ];
    expect(trendScores(withHoles).has(999)).toBe(false);
  });
});

describe('rowTrend', () => {
  /** Una finestra di `n` partite, la piu' vecchia per prima, come il toolkit la scrive. */
  const windowOf = (days: string[], fields: Partial<Record<number, string>>[] = []) =>
    parseTrend(days.map((day, at) => record({ 0: day, ...(fields[at] ?? {}) })).join(';'));

  it("prende le ultime quattro del CALENDARIO, la piu' recente per prima", () => {
    // Sei partite: la striscia ne porta quattro e la prima casella e' l'ultima giocata dal club. Il
    // verso e' quello dichiarato di questa app per le «ultime partite» (06/09/2026).
    const cells = rowTrend(windowOf(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']));
    expect(cells).toHaveLength(ROW_TREND_MATCHES);
    expect(cells.map((one) => one.date)).toEqual(['2026-06', '2026-05', '2026-04', '2026-03']);
  });

  it('NON salta le partite che non ha giocato per riempirsi di numeri', () => {
    // E' la decisione che il commento di `rowTrend` porta: un uomo fermo da tre giornate mostra tre
    // caselle vuote e non i voti di un mese fa, perche' l'assenza e' la meta' che decide un'asta.
    const cells = rowTrend(
      windowOf(
        ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'],
        [{}, { 4: 'p', 9: '7.5' }, { 4: 'b', 5: '', 6: '', 9: '' }, { 4: 'i', 5: '', 6: '', 9: '' }, { 4: 'b', 5: '', 6: '', 9: '' }],
      ),
    );
    // Il voto e' in fondo a destra - e' la piu' VECCHIA delle quattro - e le tre caselle a sinistra,
    // cioe' le piu' recenti, sono vuote. Con l'altra lettura la riga avrebbe stampato quel 7,5 per
    // primo, come se fosse di sabato scorso.
    expect(cells.map((one) => one.points)).toEqual([null, null, null, 7.5]);
    expect(cells.map((one) => one.state)).toEqual(['b', 'i', 'b', 'p']);
  });

  it("esce sempre di quattro caselle, e quelle che non esistono non sono un'assenza", () => {
    // Le colonne di due righe sorelle si incolonnano solo se ogni riga ne porta quattro; e una casella
    // che non esiste porta `state` a `null`, che non e' «era in panchina».
    const cells = rowTrend(windowOf(['2026-01', '2026-02']));
    expect(cells).toHaveLength(ROW_TREND_MATCHES);
    expect(cells.slice(2).map((one) => one.state)).toEqual([null, null]);
    expect(rowTrend([])).toHaveLength(ROW_TREND_MATCHES);
  });

  it('i due triangolini vengono dalla definizione UNICA e non da un `minutes < 90` scritto qui', () => {
    // Chi non parte ed entra e' SUBENTRATO; chi parte e non c'e' alla fine e' USCITO; di un subentrato
    // non si sa se poi e' uscito, e la seconda freccia resta spenta - `spellFrom` dice perche'.
    const [sub] = rowTrend(windowOf(['2026-01'], [{ 5: '23', 6: '' }]));
    expect(sub.spell).toEqual({ minutes: 23, on: true, off: false });
    const [off] = rowTrend(windowOf(['2026-01'], [{ 5: '63', 6: '1' }]));
    expect(off.spell).toEqual({ minutes: 63, on: false, off: true });
    const [full] = rowTrend(windowOf(['2026-01'], [{ 5: '90', 6: '1' }]));
    expect(full.spell).toEqual({ minutes: 90, on: false, off: false });
    // In panchina non ci sono minuti, quindi non c'e' nessuna freccia da disegnare.
    const [bench] = rowTrend(windowOf(['2026-01'], [{ 4: 'b', 5: '', 6: '', 9: '' }]));
    expect(bench.spell).toEqual({ minutes: null, on: false, off: false });
  });
});

describe('la finestra di un uomo che ha cambiato squadra', () => {
  /** Una partita del record, con i campi che questa domanda usa. */
  const match = (day: string, competition: string, own: string, points = '') =>
    record({ 0: day, 1: competition, 4: points ? 'p' : 'o', 5: points ? '90' : '', 6: points ? '1' : '',
      9: points, 16: own });

  it('IL CLUB BATTE IL CAMPIONATO: Frattesi cambia club dentro la Serie A', () => {
    // Cinque delle sue dieci sono giornate del club che ha lasciato, tutte `o`, e tutte `serie_a`:
    // `competition` non ne separa una. Il campo del club si'.
    const cells = rowTrend(
      parseTrend(
        [
          match('2026-09-05', 'serie_a', '0'),
          match('2026-09-07', 'serie_a', '1', '10.5'),
          match('2026-09-12', 'serie_a', '1', '6.0'),
          match('2026-09-14', 'serie_a', '0'),
          match('2026-09-19', 'serie_a', '0'),
          match('2026-09-19', 'serie_a', '1', '6.0'),
        ].join(';'),
      ),
      { league: 'serie_a' },
    );
    expect(cells.map((one) => one.points)).toEqual([6.0, 6.0, 10.5, null]);
  });

  it('...e senza il campo del club resta il ripiego del CAMPIONATO, che cura chi ha cambiato paese', () => {
    // Mastantuono: quattro giornate di Serie A giocate, e tre delle sue ultime quattro caselle erano
    // giornate del Real Madrid. Un pacchetto scritto prima del campo non porta il `1`/`0`.
    const cells = rowTrend(
      parseTrend(
        [
          match('2026-09-05', 'serie_a', '', '5.0'),
          match('2026-09-11', 'serie_a', '', '18.0'),
          match('2026-09-12', 'la_liga', ''),
          match('2026-09-15', 'la_liga', ''),
          match('2026-09-20', 'la_liga', ''),
          match('2026-09-20', 'serie_a', '', '6.0'),
        ].join(';'),
      ),
      { league: 'serie_a' },
    );
    expect(cells.map((one) => one.points)).toEqual([6.0, 18.0, 5.0, null]);
  });

  it('si disarma dove svuoterebbe la finestra, e senza campionato non filtra niente', () => {
    // Chi e' appena arrivato e qui non ha ancora giocato: una striscia vuota direbbe «non gioca» di un
    // uomo che nessuno ha ancora schierato, quindi resta il record intero.
    const foreign = [match('2026-09-12', 'la_liga', '', '7.0'), match('2026-09-20', 'la_liga', '', '6.0')];
    expect(rowTrend(parseTrend(foreign.join(';')), { league: 'serie_a' }).map((one) => one.points))
      .toEqual([6.0, 7.0, null, null]);
    expect(rowTrend(parseTrend(foreign.join(';'))).map((one) => one.points))
      .toEqual([6.0, 7.0, null, null]);
  });

  it("il diciassettesimo campo e' un ignoto quando non c'e', mai un no", () => {
    // Un pacchetto piu' vecchio del campo porta sedici campi: `ownClub` e' `null` e non `false`, o il
    // filtro leggerebbe «nessuna di queste e' sua» e butterebbe l intera finestra.
    const [old] = parseTrend(record({}));
    expect(old.ownClub).toBeNull();
    const [dichiarato] = parseTrend(record({ 16: '1' }));
    expect(dichiarato.ownClub).toBe(true);
    const [altrui] = parseTrend(record({ 16: '0' }));
    expect(altrui.ownClub).toBe(false);
  });
});
