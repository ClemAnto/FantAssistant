import { describe, expect, it } from 'vitest';

import {
  INJURY_WINDOW_DAYS,
  clubAnchor,
  eventPointsOf,
  eventTerms,
  injuredShare,
  STAR_WORD,
  medianOf,
  rank99,
  rank99ByRole,
  seasonsClosedBy,
  starsOf,
  worthOf,
} from './player-ratings';
import { Spell } from './player-status';

/** A rank is a fact about a POOL, and these are the properties that must hold whatever the numbers are. */
describe('rank99', () => {
  it('puts the worst at 0 and the best at 99', () => {
    const ranked = rank99(new Map([[1, 5], [2, 7], [3, 6]]));
    expect(ranked.get(1)).toBe(0);
    expect(ranked.get(3)).toBe(50);
    expect(ranked.get(2)).toBe(99);
  });

  it('gives equal numbers equal rank', () => {
    const ranked = rank99(new Map([[1, 6], [2, 6], [3, 9]]));
    expect(ranked.get(1)).toBe(ranked.get(2));
    expect(ranked.get(3)).toBe(99);
  });

  it('leaves the unmeasured OUT of the ranking instead of at the bottom', () => {
    // The whole point: a man nobody could measure is not «the worst», and a 0 would say he is.
    const ranked = rank99(new Map<number, number | null>([[1, 6], [2, null], [3, 9]]));
    expect(ranked.get(2)).toBeNull();
    expect(ranked.get(1)).toBe(0);
  });

  it('refuses to rank a pool of one measured man against nobody', () => {
    expect(rank99(new Map<number, number | null>([[1, 6]])).get(1)).toBe(50);
    expect(rank99(new Map<number, number | null>([[1, null]])).get(1)).toBeNull();
  });
});

/**
 * Il rango DENTRO IL RUOLO, che è quello che colora le colonne di fantamedia.
 *
 * La proprietà che conta è una sola e va inchiodata: un portiere si confronta con i portieri. Con un
 * rango unico sul listone la stessa 6,20 direbbe «ottimo» in porta e «mediocre» in attacco leggendo
 * soltanto il ruolo, e la colonna colorata dipingerebbe i ruoli invece dei giocatori.
 */
describe('rank99ByRole', () => {
  const pool = [
    { fcId: 1, role: 'P' }, { fcId: 2, role: 'P' }, { fcId: 3, role: 'P' },
    { fcId: 4, role: 'A' }, { fcId: 5, role: 'A' }, { fcId: 6, role: 'A' },
  ];

  it('judges a man against his own role and not against the listone', () => {
    // I portieri stanno su 5,9-6,3 e gli attaccanti su 6,5-8,0: sul listone intero OGNI portiere
    // starebbe sotto OGNI attaccante, e il colore direbbe soltanto «è un portiere».
    const ranked = rank99ByRole(pool, new Map([
      [1, 5.9], [2, 6.1], [3, 6.3],
      [4, 6.5], [5, 7.2], [6, 8.0],
    ]));
    expect(ranked.get(3)).toBe(99);   // il miglior portiere è in cima al SUO pool...
    expect(ranked.get(4)).toBe(0);    // ...e il peggiore attaccante in fondo al suo, pur valendo di più
    expect(ranked.get(2)).toBe(50);
    expect(ranked.get(5)).toBe(50);
  });

  it('leaves a man with no number out of his role\'s ranking', () => {
    const ranked = rank99ByRole(pool, new Map<number, number | null>([
      [1, 5.9], [2, null], [3, 6.3], [4, 6.5], [5, 7.2], [6, 8.0],
    ]));
    expect(ranked.get(2)).toBeNull();
    expect(ranked.get(1)).toBe(0);
    expect(ranked.get(3)).toBe(99);
  });

  it('answers for every man of the pool, measured or not', () => {
    const ranked = rank99ByRole(pool, new Map());
    expect([...ranked.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...ranked.values()].every((one) => one === null)).toBe(true);
  });
});

/** «Un attaccante sconosciuto della Juve è meglio di uno sconosciuto del Verona», as arithmetic. */
describe('clubAnchor', () => {
  it('stays on the role when the club has nobody measured', () => {
    expect(clubAnchor(6.0, undefined)).toBe(6.0);
    expect(clubAnchor(6.0, { mean: 7.0, measured: 0 })).toBe(6.0);
  });

  it('moves toward the club by how much of it we measured', () => {
    // Three men measured = half way, the same prior the toolkit uses (n / (n + 3)).
    expect(clubAnchor(6.0, { mean: 7.0, measured: 3 })).toBeCloseTo(6.5, 6);
    expect(clubAnchor(6.0, { mean: 7.0, measured: 1 })).toBeCloseTo(6.25, 6);
    expect(clubAnchor(6.0, { mean: 5.0, measured: 9 })).toBeCloseTo(5.25, 6);
  });

  it('never overshoots the club it is moving toward', () => {
    const moved = clubAnchor(6.0, { mean: 7.0, measured: 1000 });
    expect(moved).toBeLessThanOrEqual(7.0);
    expect(moved).toBeGreaterThan(6.9);
  });
});

/**
 * The OVERALL: «quanto conviene averlo», and the properties that make it answer that question.
 *
 * It is a product and not a mean because the readings multiply - measured 15/08/2026 against the
 * engine's own expected fantapunti, the equal-weight mean scored worse than the presences alone.
 */
describe('worthOf', () => {
  const base = {
    matches: 0.8,
    votes: 6.0,
    eventPoints: 0.6,
  };

  it('e i FANTAPUNTI CHE PORTA IN TUTTO: presenze per quanto vale una sua partita', () => {
    // La formula dettata dall'operatore il 17/08/2026 sera: «facciamo che overall e semplicemente
    // presenze * (voti+bonus)». Nessuno zero da sottrarre, quindi il numero e un TOTALE e non un margine.
    expect(worthOf(base)).toBeCloseTo(0.8 * (6.0 + 0.6), 6);
    const many = worthOf({ ...base, matches: 0.9, votes: 5.7, eventPoints: 0.3 })!;
    const better = worthOf({ ...base, matches: 0.8, votes: 6.2, eventPoints: 0.5 })!;
    // Chi gioca piu con meno qualita puo stare avanti: e la proprieta di un totale, non un difetto.
    expect(many).toBeGreaterThan(better);
  });

  it('NON sottrae piu un rimpiazzo, e i tre zeri cancellati non tornano per sbaglio', () => {
    // Sono esistiti tre zeri in due giorni - il marginale di rosa del foglio, il rimpiazzo SCHIERATO
    // (P 5,01 / D 6,11 / C 6,37 / A 6,79) e il rimpiazzo del ruolo MANTRA (por 4,13 ... pc 7,01), e
    // l'ultimo mandava gli attaccanti in fondo (mediana 11 di percentile) e i portieri in cima (77). La
    // formula in vigore non ne ha nessuno: letture-app-v1.md 9.
    expect(worthOf({ ...base, votes: 4.0, eventPoints: 0 })).toBeCloseTo(0.8 * 4.0, 6);
  });

  it('says nothing about a man nobody predicts, which is not a zero', () => {
    // No forecast of his appearances: «vuoto = ignoto». A null keeps no place in the ranking at all.
    expect(worthOf({ ...base, matches: null })).toBeNull();
    expect(worthOf({ ...base, votes: null })).toBeNull();
  });

  it('prefers who plays more at equal points, and who scores more at equal presences', () => {
    expect(worthOf({ ...base, matches: 0.9 })!).toBeGreaterThan(worthOf(base)!);
    expect(worthOf({ ...base, eventPoints: 1.2 })!).toBeGreaterThan(worthOf(base)!);
  });

  it('does NOT scale a man by the minutes he plays: the game pays the whole fantavoto', () => {
    // The case that found it: Idzes and Dimarco, both 29 expected matches, read 93 and 92 while every
    // other reading had Dimarco far ahead - because the summary multiplied by the Presenze column,
    // which discounts a wing back for coming off at the 70th. What he does in those minutes is already
    // inside his bonus per appearance, so it was one fact charged twice.
    const wingBack = worthOf({ ...base, votes: 6.66, eventPoints: 1.04 })!;
    const centreBack = worthOf({ ...base, votes: 6.0, eventPoints: -0.04 })!;
    expect(wingBack).toBeGreaterThan(centreBack * 1.25);
  });

  it('charges a keeper the goals he concedes: his events are worth LESS than nothing', () => {
    // The case the column-only version got wrong: with «voto + gol e assist» a keeper carries no
    // malus at all and third choices outranked strikers. His events are negative and must lower him.
    const keeper = worthOf({ ...base, eventPoints: -1.2 })!;
    expect(keeper).toBeLessThan(worthOf({ ...base, eventPoints: 0 })!);
  });
});

describe('medianOf', () => {
  it('takes the middle of what was measured and ignores what was not', () => {
    expect(medianOf([1, null, 3, null, 5])).toBe(3);
    expect(medianOf([4, 2])).toBe(3);
    expect(medianOf([null, null])).toBeNull();
  });
});

describe('eventTerms and eventPointsOf', () => {
  const scoring = {
    default: { goal_bonus: 3, assist_bonus: 1, goal_conceded_malus_gk: 1, own_goal_malus: 2 },
    leagues: { serie_a: { assist_bonus: 0.5 } },
  } as never;

  it('prices an event with the championship own number, and falls back to the game default', () => {
    expect(eventTerms(scoring, 'serie_a').assist_bonus).toBe(0.5);
    expect(eventTerms(scoring, 'ligue_1').assist_bonus).toBe(1);
    expect(eventTerms(null, 'serie_a').goal_bonus).toBe(3);
  });

  const season = {
    goals: 0, assists: 0, penScored: 0, penMissed: 0, ownGoals: 0,
    yellows: 0, reds: 0, conceded: 0, penSaved: 0,
  };

  it('SUBTRACTS the maluses, which the config stores as positive magnitudes', () => {
    // The sign this got wrong once: `own_goal_malus: 2.0` in the file means «togli due», and adding it
    // made the rebuilt fantavoto miss the toolkit's on 1,275 season rows of 1,449.
    const terms = eventTerms(scoring, 'ligue_1');
    expect(eventPointsOf({ ...season, goals: 2, assists: 1 }, terms)).toBe(7);
    // A keeper: what he suffers is what his matches are made of, and it must come out negative.
    expect(eventPointsOf({ ...season, conceded: 40 }, terms)).toBe(-40);
    expect(eventPointsOf({ ...season, goals: 1, ownGoals: 1 }, terms)).toBe(1);
  });

  it('prezza la porta inviolata, che la LEGA paga anche se la fonte non la applica', () => {
    // Rovesciata il 16/08/2026 su decisione dell'operatore, e la ragione va tenuta perché è sottile:
    // che il sito non la applichi (misurato su 16.017 righe di portiere) vincola chi RICOSTRUISCE il
    // suo fantavoto, non chi chiede quanto vale una partita nella lega in cui si gioca.
    const terms = eventTerms(null, null);
    expect(terms.clean_sheet_bonus_gk).toBe(1);
    const season = {
      goals: 0, assists: 0, penScored: 0, penMissed: 0, ownGoals: 0,
      yellows: 0, reds: 0, conceded: 40, penSaved: 0,
    };
    expect(eventPointsOf({ ...season, cleanSheets: 12 }, terms)).toBe(-28);
  });

  it('non legge una porta inviolata mancante come «non ne ha tenute»', () => {
    // Un bundle scritto prima della colonna non porta la conta: allora il termine NON entra, invece di
    // togliere a ogni portiere i punti che nessuno ha misurato.
    const terms = eventTerms(null, null);
    const season = {
      goals: 0, assists: 0, penScored: 0, penMissed: 0, ownGoals: 0,
      yellows: 0, reds: 0, conceded: 40, penSaved: 0,
    };
    expect(eventPointsOf(season, terms)).toBe(eventPointsOf({ ...season, cleanSheets: null }, terms));
  });
});

/**
 * The star scale, as the operator defined it word by word (15/08/2026): 3 = in media, 4 = molto sopra,
 * 5 = eccezionale, 2 = molto sotto, 1 = estremamente negativo, 0 = peggio di così si muore.
 */
describe('starsOf', () => {
  it('puts the MIDDLE of the listone at three stars, not at two and a half', () => {
    // The defect this replaces: a linear scale called the median man «due stelle e mezza» and left the
    // words «in media» describing nobody.
    expect(starsOf(49)).toBe(3);
    expect(starsOf(50)).toBe(3);
  });

  it('spends one star per standard deviation', () => {
    expect(starsOf(84)).toBe(4); // una sigma sopra: molto sopra la media
    expect(starsOf(98)).toBe(5); // due sigma: eccezionale
    expect(starsOf(16)).toBe(2); // una sigma sotto
    expect(starsOf(2)).toBe(1); // due sigma sotto: estremamente negativo
    expect(starsOf(0)).toBe(0); // peggio di così si muore
  });

  it('keeps the scale monotonic and always on a half', () => {
    let previous = -1;
    for (let score = 0; score <= 99; score++) {
      const stars = starsOf(score)!;
      expect((stars * 2) % 1).toBe(0);
      expect(stars).toBeGreaterThanOrEqual(previous);
      previous = stars;
    }
    expect(starsOf(99)).toBe(5);
  });

  it('gives every band a word, so a star can be read as the verdict it is', () => {
    for (const stars of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
      expect(STAR_WORD[stars]).toBeTruthy();
    }
  });

  it('draws nothing for what was not measured', () => {
    expect(starsOf(null)).toBeNull();
  });
});

describe('injuredShare', () => {
  const spell = (from: string, to: string | null): Spell => ({ from, to, days: null, kind: null, detail: null });

  it('counts only the days inside the last year', () => {
    // A spell that ended before the window opened is not what he is carrying now.
    expect(injuredShare([spell('2024-01-01', '2024-03-01')], '2026-08-14')).toBe(0);
  });

  it('counts an open spell up to today and no further', () => {
    const share = injuredShare([spell('2026-07-15', null)], '2026-08-14');
    expect(share).toBeCloseTo(30 / INJURY_WINDOW_DAYS, 5);
  });

  it('clips a spell that started before the window at the window', () => {
    const share = injuredShare([spell('2020-01-01', null)], '2026-08-14');
    expect(share).toBe(1);
  });

  it('is zero for a man with no spell at all', () => {
    expect(injuredShare([], '2026-08-14')).toBe(0);
  });
});

describe('injuredShare, overlapping spells', () => {
  const spell = (from: string, to: string | null): Spell =>
    ({ from, to, days: null, kind: null, detail: null });

  it('counts a day out ONCE when two spells overlap', () => {
    // The source records one row per diagnosis, so a man hurt twice at once has two rows over the same
    // days: summed, one player of the window read 591 days out of 365.
    const both = injuredShare([spell('2026-05-01', '2026-07-01'), spell('2026-05-15', '2026-06-15')],
                              '2026-08-14');
    const one = injuredShare([spell('2026-05-01', '2026-07-01')], '2026-08-14');
    expect(both).toBeCloseTo(one, 6);
  });

  it('joins two spells that touch and keeps two that do not', () => {
    const joined = injuredShare([spell('2026-05-01', '2026-06-01'), spell('2026-06-01', '2026-07-01')],
                                '2026-08-14');
    expect(joined).toBeCloseTo(injuredShare([spell('2026-05-01', '2026-07-01')], '2026-08-14'), 6);
    const apart = injuredShare([spell('2026-05-01', '2026-05-11'), spell('2026-06-01', '2026-06-11')],
                               '2026-08-14');
    expect(apart).toBeCloseTo(20 / INJURY_WINDOW_DAYS, 6);
  });

  it('never reports more than the window itself', () => {
    const many = [spell('2020-01-01', null), spell('2026-01-01', null), spell('2026-06-01', null)];
    expect(injuredShare(many, '2026-08-14')).toBe(1);
  });
});

/**
 * IL VIAGGIO NEL TEMPO sulle stagioni: un aggregato è un numero che esiste a maggio.
 *
 * La regola severa è deliberata: a novembre la stagione in corso NON ha un totale, e leggerlo sarebbe
 * sapere come va a finire. Meglio una lettura in meno che una che conosce il futuro.
 */
describe('seasonsClosedBy', () => {
  const seasons = ['2023-24', '2024-25', '2025-26'];

  it('drops the season being played and every one after it', () => {
    expect([...seasonsClosedBy(seasons, '2025-11-03')].sort()).toEqual(['2023-24', '2024-25']);
  });

  it('opens a season only once it is really over', () => {
    // Il 30 giugno la 2024-25 non è ancora «chiusa» per questa convenzione, il 1º luglio sì.
    expect(seasonsClosedBy(seasons, '2025-06-30').has('2024-25')).toBe(false);
    expect(seasonsClosedBy(seasons, '2025-07-01').has('2024-25')).toBe(true);
  });

  it('keeps everything when the day is today', () => {
    expect(seasonsClosedBy(seasons, '2026-08-17').size).toBe(3);
  });
});
