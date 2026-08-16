import { BundleTable, PlayerNote, ScoringConfig, ScoringTerms, columnIndex, optionalIndex } from './bundle';
import { FRAGILITY_YEARS, Fragility, Spell, fragilityOf, isOpen } from './player-status';
import { Platform, PlayerRow } from './players-store';

/**
 * Four readings of a player, each a 0-99 inside the listone he is quoted on.
 *
 * THEY ARE REPORTING, and that has to be said before anything else: no valuation reads them, no ranking
 * of the auction panel uses them, no gate owns them. They are four questions the operator asks at a
 * table - «prende voti?», «fa bonus?», «gioca?», «è costante?» - answered from what was MEASURED, with
 * every threshold declared here in one place so nobody takes one for a fitted parameter.
 *
 * THE POOL IS PART OF THE MEASUREMENT. The score is a percentile inside the platform's own listone with
 * the ROLES MIXED, which is what the operator asked for («rispetto a tutti gli altri trasversalmente ai
 * ruoli»): a keeper therefore reads one star for bonus, and that is the answer and not a defect. It is
 * also why this is computed per platform - the euro listone and the Serie A one are different pools, and
 * a percentile quoted without its pool means nothing.
 *
 * It is NOT `value99`, which is a proportion of the best man's worth (`auction-value.score99`). This one
 * is a RANK: 50 means «half the listone is below him», not «half as good as the best».
 */

/**
 * A FULL sample: how many appearances a reading needs before it is entirely his own.
 *
 * It is the toolkit's own `estimate.FULL_SEASON_VOTES` and not a new number: below it the reading is
 * blended with the anchor in proportion to what he HAS - «aggiungiamo i voti che mancano come la media
 * del ruolo», the operator's remedy written as arithmetic. Without it a third keeper with four
 * appearances at 6.2 outranks a man with three hundred at 6.1, because a mean says nothing about how
 * much of it there is; with it he is mostly his role's anchor, which is what we actually know about him.
 */
export const FULL_SAMPLE = 15;

/** How fast a club's own level takes over from the role's - `estimate.CLUB_PRIOR`, same number. */
export const CLUB_PRIOR = 3;

/** Under how much of a reading being his own it is drawn as «spannometrico» rather than measured. */
export const MOSTLY_ANCHOR = 0.5;

/** Under how many measured matches the per-match readings refuse to answer. A display choice. */
export const MIN_MATCHES = 5;

/** The base vote from which a performance stops being a bad one. The game's own «sufficienza». */
export const PASS_MARK = 6;

/** A season's mean is trimmed of its best and worst only from this many seasons on (operator's rule). */
export const TRIM_FROM = 5;

/**
 * How much the COSTANZA moves the summary: POINTS OF FANTAMEDIA per point of steadiness above or below
 * THE MEDIAN OF HIS OWN ROLE.
 *
 * The operator asked that it weigh («la costanza deve avere il suo peso»), and it enters as a correction
 * of what one of his matches is worth rather than as a fourth addend, because steadiness is not a term
 * of the sum the game pays: it is a property of the DISTRIBUTION of the votes already counted.
 *
 * IL CENTRO È IL RUOLO, e prima era il listone intero: è il difetto che questo numero aveva, e non la
 * sua taglia (misurato 16/08/2026 sui 498 quotati di Serie A). Prendere almeno 6 è un evento diverso a
 * seconda di dove si gioca - mediana della quota: portieri 0,864 · difensori 0,652 · centrocampisti
 * 0,611 · attaccanti 0,572 - quindi centrare sulla mediana del listone (0,636) regalava a OGNI portiere
 * +0,11 di fantamedia a partita per il fatto di essere un portiere, e ne toglieva agli attaccanti. Con
 * quel centro i portieri erano 4 dei primi 10 e 8 dei primi 25 dell'Overall, contro gli 0 e i 5 del
 * SURPLUS con cui il toolkit ordina la sua asta; centrato sul ruolo e a questo peso sono 1 e 7. È la
 * lezione che il canale dell'età aveva già insegnato (`CLAUDE.md`, «una differenza fra due gruppi non è
 * un canale»): una differenza fra RUOLI non è una virtù di chi la porta.
 *
 * E il peso è 2 e non più 0,5 perché a 0,5 non si vedeva: Hojlund, 29 di costanza sul listone, pagava
 * −0,03 su un surplus di 1,60 a giornata. L'accordo con il surplus del foglio (Spearman fra i due
 * ranghi, 498 uomini) dice dove sta il ginocchio: 0,628 senza costanza, 0,644 a peso 1, **0,639 a peso
 * 2**, 0,623 a 3, 0,559 a 6. Sopra 2 si comincia a pagare in accordo quello che si guadagna in severità,
 * e 2 è il valore che dimezza i portieri nei primi dieci restando sopra il «senza».
 *
 * ADDED and not multiplied, and the reason is a sign: the summary is a SURPLUS over the man who would
 * play instead, so it can be negative, and multiplying a negative by 1.06 would make a steady reserve
 * WORSE than an erratic one. An addend is monotonic whatever the sign.
 *
 * DECLARED, not fitted: no gate owns the readings (they are reporting), and it is stated here in one
 * place so nobody takes it for a measured parameter.
 */
export const CONSISTENCY_TILT = 2;

/**
 * How much a man who breaks down often has to give back, per point of injury share above the median.
 *
 * THIS IS A RISK PREFERENCE AND NOT A SECOND FORECAST, and the difference has to be stated or the next
 * reader will take it for a measurement. The engine ALREADY predicts fewer matches for these men and it
 * predicts them well: Dybala 22.8 of 38 against Yildiz's 29.6, and his last four seasons are 25, 27, 22,
 * 22 - the mean is right. What the mean cannot say is that those 22 are the average of a season at 30
 * and a season at 12, and the operator's rule (15/08/2026) is that such a man does not belong «nell'olimpo
 * degli attaccanti» whatever his average says: «dal punto di vista di presenze ti dà troppe incertezze».
 *
 * So it is his preference, declared, applied to the SECURED share - the matches you can count on - and
 * measured from the listone's own median rather than from zero, so the ordinary man pays nothing. At 1.0
 * a point of extra injury share costs a point of calendar: Dybala loses 27% of his matches, Berardi 24%,
 * a Di Lorenzo 3% and a Yildiz nothing.
 */
export const FRAGILITY_RISK = 1;

/**
 * Da quale quota di partite COMINCIATE un uomo ha «il posto da titolare», e sotto la quale il riassunto
 * smette di pagarlo linearmente.
 *
 * Il caso dell'operatore, e la misura che lo ha risolto (15/08/2026). «Esposito F.P. non è titolare, come
 * fa ad avere un overall così alto?» - e poi: «non può stare sopra Simeone o Davis, che hanno dimostrato
 * di essere più affidabili». La prima versione leggeva le PRESENZE previste dal motore, e con quelle i
 * tre sono lo stesso uomo: 24, 25 e 24 partite su 38. Il motore conta le presenze A VOTO, e un subentrato
 * ne prende - quindi la titolarità da lì non si vede.
 *
 * Si vede dalle partite da TITOLARE della sua ultima stagione, che è un fatto misurato e non una
 * preferenza: Esposito 15 su 36 presenze, Simeone 27, Davis 27, Yildiz 33. È quello che «hanno
 * dimostrato» vuol dire, ed è il numero che questo vincolo legge.
 *
 * Chi non ha una stagione misurata non paga niente: «vuoto = ignoto», e un arrivo non viene penalizzato
 * per un passato che qui non c'è.
 */
export const STARTER_SHARE = 0.75;

/**
 * Quanto pesa lo scarto: 1 = una volta, 2 = al quadrato.
 *
 * A 1 la correzione era troppo educata per il caso che l'ha chiesta - un posto di classifica - perché
 * lassù il listone è fitto. Al quadrato: chi ha cominciato il 40% delle giornate tiene il 27% del suo
 * surplus, chi ne ha cominciate il 70% ne tiene il 90%, e un titolare vero non perde niente.
 */
export const STARTER_CONCAVITY = 2;

/**
 * What a DECLARED note costs a man in this column, per kind.
 *
 * «Lukaku è in rotta con la società, dalla fine dello scorso anno non si sa che fine farà» - and nothing
 * in this project observes a quarrel: `flags.exit_risk` is a contract expiring, a transfer is a move that
 * has happened, a missing squad row is evidence of a departure. So it is DECLARED, in
 * `config/player_notes.json`, by whoever knows it, dated and revocable (root CLAUDE.md, «A judgement the
 * model cannot reach is DECLARED»).
 *
 * WHERE THE LINE IS, because that file's charter drew it and the operator has just moved it: nothing
 * under `engine/` reads a declared note and nothing ever should - a declared fact that moved a FITTED
 * number would make every measurement his own answer, which is what the two board judges refuse. This
 * column is the other kind: reporting, ungated, unjudged, and it is where he asked for the penalty
 * (15/08/2026). The file's own comment now says so.
 *
 * The three kinds are one icon and three sentences, and they are three different risks: a man out of the
 * squad will not play at all, a quarrel may end in a transfer or in a bench, a transfer request is the
 * mildest of the three. What is left of him is what is left of the season you can count on.
 */
export const DECLARED_RISK: Record<PlayerNote['kind'], number> = {
  out_of_squad: 0.1,
  dispute: 0.35,
  wants_out: 0.6,
};

/**
 * What his steadiness adds to one of his matches, in points of fantamedia. Zero without a pool.
 *
 * `medianConsistency` is the middle of HIS ROLE and not of the listone - see `CONSISTENCY_TILT`, where
 * the four medians and what the wrong centre cost are written down.
 */
export function steadinessOf(input: {
  consistency: number | null;
  medianConsistency: number | null;
  tilt?: number;
}): number {
  const { consistency, medianConsistency } = input;
  if (consistency == null || medianConsistency == null) return 0;
  return (input.tilt ?? CONSISTENCY_TILT) * (consistency - medianConsistency);
}

/**
 * What every event is worth in a man's own CHAMPIONSHIP: read from the shared config, never hard-coded
 * (spec v9 - a league with non-standard scoring is a different game).
 *
 * `clean_sheet_bonus_gk` IS read here, and da qui in poi è l'unico posto del progetto dove succede
 * (operatore, 16/08/2026: la sua lega la porta inviolata la paga). Il resto del progetto continua a
 * lasciarla fuori e deve continuare a farlo: `ratings._fantavoto` e `arrivals.keeper_fm_equivalent`
 * RICOSTRUISCONO il fantavoto del sito, che non l'applica - misurato su 16.017 righe di portiere, e su
 * quelle chiuse a zero il residuo è 0,000. Sono due domande diverse: là «cosa ha scritto il sito», qui
 * «quanto vale una sua partita nella tua lega». La conseguenza va detta invece che scoperta: per un
 * portiere questa colonna NON torna più uguale alla `fm` del bundle, ed è voluto.
 */
export function eventTerms(scoring: ScoringConfig | null, league: string | null): ScoringTerms {
  const own: Partial<ScoringTerms> = (league ? scoring?.leagues?.[league] : undefined) ?? {};
  const base: Partial<ScoringTerms> = scoring?.default ?? {};
  const term = (name: keyof ScoringTerms, fallback: number): number =>
    own[name] ?? base[name] ?? fallback;
  return {
    goal_bonus: term('goal_bonus', 3),
    penalty_scored_bonus: term('penalty_scored_bonus', 3),
    penalty_missed_malus: term('penalty_missed_malus', 3),
    assist_bonus: term('assist_bonus', 1),
    assist_set_piece_bonus: term('assist_set_piece_bonus', 1),
    own_goal_malus: term('own_goal_malus', 2),
    yellow_card_malus: term('yellow_card_malus', 0.5),
    red_card_malus: term('red_card_malus', 1),
    goal_conceded_malus_gk: term('goal_conceded_malus_gk', 1),
    penalty_saved_bonus_gk: term('penalty_saved_bonus_gk', 3),
    clean_sheet_bonus_gk: term('clean_sheet_bonus_gk', 1),
  };
}

/**
 * The POINTS a season's events are worth, beyond the base vote: `fm × pv − mv × pv`, rebuilt from its
 * parts so that each one is priced with the league the man actually played in.
 *
 * A MALUS IS STORED AS A POSITIVE MAGNITUDE and is subtracted here - `own_goal_malus: 2.0`, not −2 -
 * which is what `ui-match-detail` has always done with its own `-1` sign beside each term. Written down
 * because the first version of this function added them all and the check below caught it: the rebuilt
 * fantavoto matched the toolkit's stored one on 174 season rows of 1,449 (median error 0.169), and the
 * overall's agreement with the engine's value fell from 0.83 to 0.71. A sign is not a detail.
 */
export function eventPointsOf(
  season: {
    goals: number;
    assists: number;
    penScored: number;
    penMissed: number;
    ownGoals: number;
    yellows: number;
    reds: number;
    conceded: number;
    penSaved: number;
    /**
     * Le giornate chiuse a zero. Vuoto è IGNOTO e non «non ne ha tenute»: la conta viene dal layer per
     * partita, che una stagione vecchia può non avere, e allora quel termine non entra affatto.
     */
    cleanSheets?: number | null;
  },
  terms: ScoringTerms,
): number {
  return (
    season.goals * terms.goal_bonus
    + season.penScored * terms.penalty_scored_bonus
    + season.assists * terms.assist_bonus
    + season.penSaved * terms.penalty_saved_bonus_gk
    + (season.cleanSheets ?? 0) * terms.clean_sheet_bonus_gk
    - season.penMissed * terms.penalty_missed_malus
    - season.ownGoals * terms.own_goal_malus
    - season.yellows * terms.yellow_card_malus
    - season.reds * terms.red_card_malus
    - season.conceded * terms.goal_conceded_malus_gk
  );
}

/**
 * WHAT HE IS WORTH HAVING, in the arithmetic the game itself uses: the matches he plays times the
 * points he makes in one, tilted by how steadily he makes them.
 *
 * THE ZERO IS THE REPLACEMENT AND NOT NOTHING, which is the second case the operator brought (Bremer
 * and Kelly, 15/08/2026): Kelly plays 29 giornate at 6.16 and Bremer 26 at 6.77, and counted from zero
 * they come out level - 92 and 90 - because three extra appearances at any level buy more than half a
 * point of quality. But nobody fields NOBODY in that slot: you field the marginal man of that role, and
 * over him Bremer is worth nearly double. It is this project's own metric and its own number
 * (`engine_replacement_fm`, per role slot: 4.13 for a keeper on the Serie A sheet against 5.87 for a
 * midfielder), and the toolkit's own surplus agrees with the operator - Bremer 87, Kelly 73.
 *
 * It also un-punishes a whole ROLE: a first-choice keeper reads 15 of 99 counted from zero, because his
 * matches are made of the goals he concedes, and 81 counted from the keeper you would field instead.
 *
 * THE MINUTES DO NOT BELONG HERE, and the case that proved it is worth keeping: Idzes and Dimarco both
 * read 29 expected matches, and the overall called them equal (93 and 92) while every other reading had
 * Dimarco far ahead - 6.66 of media voto against 6.00, 7.70 of fantamedia against 5.96. The reason was
 * that the summary multiplied by the PRESENZE column, which discounts a man by the minutes he plays when
 * he plays: a wing back taken off at the 70th was charged a quarter of his worth for coming off, while
 * the game pays him the whole fantavoto - and what he does in those minutes is already inside his bonus
 * per appearance. One factor, counted twice.
 *
 * This is the overall, and it is a PRODUCT and not a mean. Measured 15/08/2026 on the real bundle,
 * against the engine's own expected fantapunti (`FM att. × P`), Serie A / euro:
 *
 *   media delle quattro letture, pesi uguali   0.538 / 0.653   (peggiore delle presenze da sole, 0.776)
 *   prodotto, ma con i minuti dentro            0.831 / 0.816
 *   prodotto, giornate a voto × punti           0.982 / 0.980
 *
 * ...and then against the toolkit's own SURPLUS, which is the metric its auction panel ranks by, the
 * same three-factor product measured 0.684 / 0.313 while this one - the same product over the
 * replacement - measures 0.812 / 0.789. The two yardsticks are two questions and this column answers
 * the second: «quanto mi dà IN PIÙ di chi giocherebbe al suo posto».
 *
 * The four are not four virtues to average - they multiply, and averaging the ranks of quantities that
 * multiply destroys the comparison the column exists for. Every factor is a reading on screen, so a
 * reader can see where the number came from.
 */
export function worthOf(input: {
  /**
   * The share of the coming calendar the engine expects him to be RATED in - `pv / matchdays`, and not
   * the Presenze column, which multiplies that by the minutes he plays when he plays. A fantavoto is
   * not scaled by minutes: a man taken off at the 70th takes the whole of it home.
   */
  matches: number | null;
  /** His base vote when he plays. */
  votes: number | null;
  /**
   * ...and what his events add to it per appearance, valued with his championship's own scoring:
   * bonuses AND maluses, so a keeper carries the goals he concedes and the number is negative for him.
   */
  eventPoints: number | null;
  /**
   * The fantamedia of the man who would play instead of him, from the engine's own sheet. Null only
   * when no sheet carries one, and then the number counts from zero and the note says so.
   */
  replacement: number | null;
  consistency: number | null;
  /** The listone's own middle: the tilt is a fact about the pool, like every other number here. */
  medianConsistency: number | null;
  tilt?: number;
}): number | null {
  const { matches, votes, eventPoints, replacement, consistency, medianConsistency } = input;
  // No forecast of his appearances, no worth to state: «vuoto = ignoto, mai zero». A man nobody
  // predicts is not the worst man in the listone, he is one we cannot answer for.
  if (matches == null || votes == null) return null;
  return matches * (votes + (eventPoints ?? 0) + steadinessOf(input) - (replacement ?? 0));
}

/** The middle of a pool's readings, used to centre the tilt. Null when nothing was measured. */
export function medianOf(values: Iterable<number | null>): number | null {
  const known = [...values].filter((one): one is number => one != null).sort((a, b) => a - b);
  if (!known.length) return null;
  const middle = Math.floor(known.length / 2);
  return known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
}

/** How far back the injury share looks. One year: a calendar of a player's own. */
export const INJURY_WINDOW_DAYS = 365;

const DAY_MS = 86_400_000;

export type RatingKey = 'overall' | 'votes' | 'bonus' | 'presence' | 'consistency';

/** The four readings, in the order a row is read. `overall` is not one of them: it is their mean. */
export const DETAIL_KEYS: Exclude<RatingKey, 'overall'>[] = [
  'votes', 'bonus', 'presence', 'consistency',
];

/** Every column, the summary first: it is the one that is scanned, the four are the reason for it. */
export const RATING_KEYS: RatingKey[] = ['overall', ...DETAIL_KEYS];

export interface Rating {
  /** The quantity itself, in its own unit. Null = not even an anchor could answer. */
  raw: number | null;
  /**
   * His place in the listone, 0-99, which is what the stars are drawn from - through the bands of
   * `starsOf`, not by dividing it: three stars is the middle of the pool and five is two sigmas above.
   * Null wherever `raw` is.
   */
  score: number | null;
  /**
   * How much of the number is HIS: 1 = a full sample of his own football, 0 = the anchor of his role at
   * his club and nothing else. It is the doubt, carried on the row instead of hidden behind a dash.
   */
  weight: number;
  /** What the number rests on, in words: the sample, the window, the caveat. */
  note: string;
}

export type PlayerRating = Record<RatingKey, Rating>;

/**
 * What the ENGINE'S SHEET says about the season that is coming, for one man on one platform.
 *
 * Read from the sheet and never recomputed here: the share of the calendar it expects him to be rated
 * in, whether that is the prediction or the declared estimate, and the fantamedia of the man who would
 * play instead of him - the zero every valuation in this project is measured from.
 */
export interface EngineForecast {
  share: number | null;
  estimated: boolean;
  replacement: number | null;
  /**
   * La FANTAMEDIA ATTESA del foglio (`engine_fm_pred`, o `est_fm` per chi il motore non prezza).
   *
   * È quello su cui l'Overall si basa dal 16/08/2026, su richiesta dell'operatore: «l'overall deve
   * basarsi su FM att.». Prima moltiplicava la fantamedia di CARRIERA, che è un'altra domanda - quanto
   * ha fatto, non quanto ci si aspetta - e per chi cambia squadra le due divergono per costruzione (il
   * caso Gila: la sua media è quella di un difensore della Lazio, e il motore lo prevede al Milan).
   */
  fm: number | null;
  fmIsEstimate: boolean;
}

/** One season of a player, as `season_stats` states it for one platform. */
interface SeasonRow {
  season: string;
  pv: number;
  mv: number | null;
  /** Gol e assist per presenza: the column's own definition, and what it ranks by. */
  bonus: number | null;
  /** ...and every event apart, because they are not worth the same POINTS - and a keeper's are mostly
   *  the ones he suffers. Read as counts and priced by `eventPointsOf` with the league's own config. */
  goals: number;
  assists: number;
  penScored: number;
  penMissed: number;
  ownGoals: number;
  yellows: number;
  reds: number;
  conceded: number;
  penSaved: number;
  /** Giornate chiuse a zero. Null finché il bundle non porta la colonna: ignoto, non zero. */
  cleanSheets: number | null;
}

/** What the per-match layer says about a player, already reduced. */
interface MatchHistory {
  /**
   * Quanto del suo ULTIMO campionato ha cominciato da titolare, sulle giornate che quel campionato ha
   * giocato. Null quando non ha una stagione misurata: «vuoto = ignoto», e chi non ha un passato non
   * viene penalizzato per non averlo.
   */
  startShare: number | null;
  /** ...e i due numeri che lo compongono, per scriverlo nella nota invece di farlo credere. */
  starts: number;
  startedIn: string;
  /** The base vote of every match he PLAYED: the real one where it exists, else the calibrated one. */
  votes: number[];
  synthetic: number;
  /** Minutes he was on the pitch for, over the matches of the clubs he belonged to. */
  minutes: number;
  /** The matches he actually got on the pitch in: the denominator of «how long he stays on». */
  appearances: number;
  seasons: Set<string>;
}

/**
 * The percentile of every value inside its own pool, as a 0-99.
 *
 * Ties share a score - two identical numbers cannot be ranked apart - and a null keeps no place at all:
 * a man we cannot measure is not «the worst», he is unmeasured, and giving him a 0 would put him in the
 * ranking under a claim nobody made.
 */
export function rank99(values: ReadonlyMap<number, number | null>): Map<number, number | null> {
  const measured = [...values.entries()].filter(([, value]) => value != null) as [number, number][];
  const out = new Map<number, number | null>();
  for (const [id] of values) out.set(id, null);
  if (measured.length < 2) {
    // One measured man is a pool of one: he is neither above nor below anybody, so he has no rank.
    for (const [id] of measured) out.set(id, measured.length === 1 ? 50 : null);
    return out;
  }
  const sorted = measured.map(([, value]) => value).sort((left, right) => left - right);
  for (const [id, value] of measured) {
    // How many are strictly below him, over how many he could be above: the plain percentile.
    let below = 0;
    while (below < sorted.length && sorted[below] < value) below += 1;
    out.set(id, Math.round((99 * below) / (sorted.length - 1)));
  }
  return out;
}

/**
 * What each half-star means, as the operator wrote it (15/08/2026), and the percentile it starts at.
 *
 *   5 = eccezionale · 4 = molto sopra la media · 3 = in media · 2 = molto sotto · 1 = estremamente
 *   negativo · 0 = peggio di così si muore
 *
 * A LINEAR map cannot say that: it puts the middle of the listone at two stars and a half, hands five
 * stars to the top few per cent and zero to the bottom few, and the four words in between mean nothing.
 * So the bands are ONE STANDARD DEVIATION PER STAR, centred on the median - three stars is the middle,
 * four is a sigma above it, five is two - and the thresholds below are the normal quantiles at the
 * MIDPOINT of each half-star, because a value is drawn as the star it is nearest to.
 *
 * Two consequences worth stating rather than discovering. The scale is a fact about the POOL: «in media»
 * has no meaning without one, so the same 63% of matches passed can be three stars in one listone and
 * two in another - that is what the words ask for. And the stars are NO LONGER the score divided: the
 * column still sorts on the score, and the 0-99 reading beside it is the percentile itself.
 */
const STAR_BANDS: { from: number; stars: number }[] = [
  { from: 96.0, stars: 5 },    // z ≥ +1.75 · eccezionale
  { from: 89.4, stars: 4.5 },
  { from: 77.3, stars: 4 },    // z ≥ +0.75 · molto sopra la media
  { from: 59.9, stars: 3.5 },
  { from: 40.1, stars: 3 },    // il centro: mezza sigma di qua e di là dalla mediana
  { from: 22.7, stars: 2.5 },
  { from: 10.6, stars: 2 },    // z ≤ −0.75 · molto sotto la media
  { from: 4.0, stars: 1.5 },
  { from: 1.2, stars: 1 },     // z ≤ −1.75 · estremamente negativo
  { from: 0.3, stars: 0.5 },
  { from: 0, stars: 0 },       // peggio di così si muore
];

/** The word a star band carries, so a tooltip can say the verdict and not only the number. */
export const STAR_WORD: Record<number, string> = {
  5: 'eccezionale',
  4.5: 'quasi eccezionale',
  4: 'molto sopra la media',
  3.5: 'sopra la media',
  3: 'in media',
  2.5: 'sotto la media',
  2: 'molto sotto la media',
  1.5: 'gravemente sotto la media',
  1: 'estremamente negativo',
  0.5: 'fra i peggiori del listone',
  0: 'il peggiore del listone',
};

/**
 * Il COLORE di una lettura, dalle stesse bande delle stelle.
 *
 * Deriva da `starsOf` e non da una soglia sua, perché due scale finirebbero per dire due cose diverse
 * dello stesso numero - il difetto che questo progetto paga da sempre. Sette gradini invece di undici: il
 * colore serve a far saltare all'occhio un'eccellenza o un disastro mentre si scorre, e undici sfumature
 * di verde non le distingue nessuno.
 *
 * Rosso solo in fondo, ed è la stessa eccezione che le celle dei voti hanno già: la regola di casa tiene
 * il rosso per il pericolo e per i giudizi esplicitamente negativi, e «peggio di così si muore» è uno di
 * quelli. Il centro del listone è NEUTRO: una tabella dove ogni numero è colorato è una tabella che
 * grida, e la media non è una notizia.
 */
export function toneOf(score: number | null): string {
  const stars = starsOf(score);
  if (stars == null) return 'text-muted';
  /*
   * L'INCHIOSTRO DIPENDE DA QUANTO IL FONDO È PIENO, e non è un dettaglio estetico: misurato sulla
   * pagina vera, il bianco sul verde pieno dava 1.78 di contrasto e l'inchiostro della pagina sul verde
   * al 60% dava 1.01 - illeggibili tutti e due, e nessuno dei due si vede in uno screenshot.
   * Su un token PIENO l'inchiostro è quello del fondo della pagina (opposto per costruzione, 11.07); su
   * uno TRASLUCIDO il fondo resta scuro e vuole l'inchiostro normale del testo.
   */
  if (stars >= 5) return 'bg-success text-page';
  if (stars >= 4) return 'bg-success/60 text-fg';
  if (stars >= 3.5) return 'bg-success/25 text-fg';
  if (stars >= 3) return 'bg-control text-fg';
  if (stars >= 2) return 'bg-warning/30 text-fg';
  if (stars >= 1) return 'bg-warning/60 text-fg';
  return 'bg-danger text-page';
}

/**
 * The stars a score is drawn as: five of them, in HALVES, on the bands above.
 *
 * The number is the fact and the stars are the reading of it - which is why the column sorts on the
 * score and not on the stars: two men half a star apart are two different numbers.
 */
export function starsOf(score: number | null): number | null {
  if (score == null) return null;
  // The score is a place in a hundred: `rank99` yields 0-99, so a full 99 is the top of the pool.
  const percentile = Math.max(0, Math.min(100, (score / 99) * 100));
  return STAR_BANDS.find((band) => percentile >= band.from)!.stars;
}

/** Whole days between two ISO dates. */
function days(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/**
 * The mean of a player's seasons, weighted by the appearances each rests on - and trimmed of its best
 * and its worst season once there are five, which is the operator's own convention for a mean that
 * judges: one exceptional year should not be what a career reads as.
 */
function seasonMean(rows: readonly { pv: number; value: number | null }[]): number | null {
  const usable = rows.filter((row) => row.value != null && row.pv > 0) as { pv: number; value: number }[];
  // The floor is on the APPEARANCES and not on the seasons: one season of thirty matches is a career
  // this can speak about, four matches spread over three seasons is not.
  if (usable.reduce((sum, row) => sum + row.pv, 0) < MIN_MATCHES) return null;
  let kept = usable;
  if (usable.length >= TRIM_FROM) {
    const byValue = [...usable].sort((left, right) => left.value - right.value);
    kept = byValue.slice(1, -1);
  }
  const weight = kept.reduce((sum, row) => sum + row.pv, 0);
  if (!weight) return null;
  return kept.reduce((sum, row) => sum + row.value * row.pv, 0) / weight;
}

/** `season_stats` reduced to one list per player, for one platform. */
export function seasonHistories(
  table: BundleTable,
  platform: Platform,
): Map<number, SeasonRow[]> {
  const [id, season, plat, pv, mv, goals, assists] = columnIndex(
    table, 'fc_id', 'season', 'platform', 'pv', 'mv', 'goals', 'assists',
  );
  // The rest of the fantavoto's terms. Optional by design: an older bundle simply has fewer columns,
  // and then those events are absent - which the overall reads as «no malus recorded», not as zero
  // goals conceded, because a missing COLUMN and a measured zero are the same shape here. It is stated
  // rather than hidden: every bundle since the export's first version carries all nine.
  const [penScored, penMissed, ownGoals, yellows, reds, conceded, penSaved, cleanSheets] = [
    'pen_scored', 'pen_missed', 'own_goals', 'yellows', 'reds', 'goals_conceded', 'pen_saved',
    // La porta inviolata è l'unica di queste che può mancare DAVVERO: la conta il toolkit dal layer
    // per partita, e un bundle scritto prima non ce l'ha. Allora quel termine non entra - «vuoto =
    // ignoto» - invece di leggere «non ne ha tenuta nessuna».
    'clean_sheets',
  ].map((name) => optionalIndex(table, name));
  const count = (row: unknown[], at: number): number => (at < 0 ? 0 : ((row[at] as number) ?? 0));
  const out = new Map<number, SeasonRow[]>();
  for (const row of table.rows) {
    if (row[plat] !== platform) continue;
    const appearances = (row[pv] as number) ?? 0;
    // A season with no appearance carries no average: its stored 0.0 is the aggregation's zero.
    if (!appearances) continue;
    const fcId = Number(row[id]);
    const list = out.get(fcId);
    const one: SeasonRow = {
      season: row[season] as string,
      pv: appearances,
      mv: (row[mv] as number) ?? null,
      bonus: (((row[goals] as number) ?? 0) + ((row[assists] as number) ?? 0)) / appearances,
      goals: (row[goals] as number) ?? 0,
      assists: (row[assists] as number) ?? 0,
      penScored: count(row, penScored),
      penMissed: count(row, penMissed),
      ownGoals: count(row, ownGoals),
      yellows: count(row, yellows),
      reds: count(row, reds),
      conceded: count(row, conceded),
      penSaved: count(row, penSaved),
      cleanSheets: cleanSheets < 0 ? null : ((row[cleanSheets] as number) ?? null),
    };
    list ? list.push(one) : out.set(fcId, [one]);
  }
  return out;
}

/**
 * The per-match layer reduced per player: the base vote of every match he played, his minutes, and the
 * matches his clubs played while he was there.
 *
 * The vote follows the TOOLKIT's own definition (`arrivals.fm_equivalents`): the real fantacalcio vote
 * where one exists, the calibrated synthetic one where it does not - `COALESCE(mr.mv, e.mv_synth)` - over
 * matches with minutes on the clock. The real vote is looked for on BOTH platforms because the base voto
 * is the same number seen from two calendars (spec v9): `default` states it for a Serie A round, `euro`
 * for whichever round its own calendar bundled, and only when neither has it does the synthetic answer.
 *
 * MINUTES are summed with the APPEARANCES they were played in, and nothing else: how much of a match he
 * plays when he plays. How much of the SEASON he plays is not asked here at all - that is the engine's
 * own forecast (`expectedShare`), because the question «presenze» is about the season that is coming.
 */
export function matchHistories(
  external: BundleTable,
  ratings: BundleTable,
  matchdayMap: BundleTable,
  leagueOf: ReadonlyMap<number, string | null>,
  /**
   * Which championships this listone PRICES. On Serie A it is `serie_a` alone - a foreign fantamedia is
   * R1, refused by the gate - while the euro listone prices five, so filtering a euro man on the league
   * his roster names today threw away the whole history of everybody who moved: 37 men of 925, Bernardo
   * Silva's 71 Premier matches among them.
   */
  inScope: ReadonlySet<string>,
): Map<number, MatchHistory> {
  const [rId, rSeason, rPlatform, rMatchday, rMv] = columnIndex(
    ratings, 'fc_id', 'season', 'platform', 'matchday', 'mv',
  );
  const [mSeason, mEuro, mLeague, mReal] = columnIndex(
    matchdayMap, 'season', 'euro_md', 'league', 'real_md',
  );
  /** (season, league, real round) -> the euro round that bundled it. */
  const euroRound = new Map<string, number>();
  for (const row of matchdayMap.rows) {
    euroRound.set(`${row[mSeason]}|${row[mLeague]}|${row[mReal]}`, row[mEuro] as number);
  }
  /** The real votes, keyed by the round they were played in on each platform. */
  const realVote = new Map<string, number>();
  for (const row of ratings.rows) {
    const mv = row[rMv] as number | null;
    if (mv == null) continue;
    realVote.set(`${row[rPlatform]}|${row[rId]}|${row[rSeason]}|${row[rMatchday]}`, mv);
  }

  const [eId, eSeason, eSource, eCompetition, eRealMd, eMinutes, eSynth] = columnIndex(
    external, 'fc_id', 'season', 'source', 'competition', 'real_md', 'minutes', 'mv_synth',
  );
  // Chi COMINCIA le partite, che è una cosa diversa da chi le gioca: `pv` conta le presenze a voto e un
  // subentrato ne prende, quindi la titolarità non si legge da lì. La colonna è opzionale per un bundle
  // vecchio, e allora la quota resta ignota invece di diventare zero.
  const eStarted = optionalIndex(external, 'started');
  /** (stagione, campionato) -> quante giornate ha giocato: il denominatore giusto è il suo campionato. */
  const rounds = new Map<string, number>();
  /** fc_id -> stagione -> quante ne ha cominciate. */
  const startsBySeason = new Map<number, Map<string, number>>();
  for (const row of external.rows) {
    if (row[eSource] !== 'sofascore') continue;
    const realMd = row[eRealMd] as number | null;
    if (realMd == null) continue;
    const key = `${row[eSeason]}|${row[eCompetition]}`;
    rounds.set(key, Math.max(rounds.get(key) ?? 0, realMd));
    if (eStarted < 0 || row[eStarted] !== 1) continue;
    const fcId = Number(row[eId]);
    const mine = startsBySeason.get(fcId) ?? startsBySeason.set(fcId, new Map()).get(fcId)!;
    mine.set(row[eSeason] as string, (mine.get(row[eSeason] as string) ?? 0) + 1);
  }

  const out = new Map<number, MatchHistory>();

  for (const row of external.rows) {
    // The LEAGUE calendar only, and only the source the calibration was fitted on: a friendly goal must
    // never enter a number a threshold was fitted on, and a cup tie has no fantacalcio vote at all.
    if (row[eSource] !== 'sofascore') continue;
    const fcId = Number(row[eId]);
    const league = row[eCompetition] as string;
    // Football played in a championship this listone does not price: it happened, and it is not what
    // this sheet is about. A man whose own roster league is outside the scope keeps nothing either.
    if (!inScope.has(league) || !inScope.has(leagueOf.get(fcId) ?? league)) continue;
    const season = row[eSeason] as string;
    let history = out.get(fcId);
    if (!history) {
      out.set(fcId, (history = {
        startShare: null, starts: 0, startedIn: '',
        votes: [], synthetic: 0, minutes: 0, appearances: 0, seasons: new Set(),
      }));
    }
    history.seasons.add(season);

    // A row with NO minutes is an unused substitute: he was there and was not chosen, so it adds
    // nothing to the minutes and does not count as an appearance either.
    const minutes = (row[eMinutes] as number) ?? 0;
    history.minutes += minutes;
    if (minutes <= 0) continue;
    history.appearances += 1;

    const realMd = row[eRealMd] as number | null;
    const euroMd = realMd == null ? undefined : euroRound.get(`${season}|${league}|${realMd}`);
    const vote =
      (realMd != null ? realVote.get(`default|${fcId}|${season}|${realMd}`) : undefined)
      ?? (euroMd != null ? realVote.get(`euro|${fcId}|${season}|${euroMd}`) : undefined)
      ?? (row[eSynth] as number | null)
      ?? null;
    if (vote == null) continue;
    history.votes.push(vote);
    if (realMd == null || realVote.get(`default|${fcId}|${season}|${realMd}`) == null) {
      const fromEuro = euroMd != null && realVote.get(`euro|${fcId}|${season}|${euroMd}`) != null;
      if (!fromEuro) history.synthetic += 1;
    }
  }

  // La titolarità dell'ULTIMA stagione che ha giocato: «hanno dimostrato di essere affidabili» è una
  // cosa sul passato recente, e una stagione da titolare di tre anni fa non è una garanzia di oggi.
  for (const [fcId, history] of out) {
    const last = [...history.seasons].sort().at(-1);
    if (!last) continue;
    const league = leagueOf.get(fcId) ?? null;
    const played = league ? rounds.get(`${last}|${league}`) ?? null : null;
    const starts = startsBySeason.get(fcId)?.get(last) ?? 0;
    if (eStarted < 0 || !played) continue;   // niente colonna o niente calendario: ignoto, non zero
    history.starts = starts;
    history.startedIn = last;
    history.startShare = Math.min(1, starts / played);
  }

  return out;
}

/** The days of the last year a player spent inside an injury spell, as a share of that year. */
export function injuredShare(spells: readonly Spell[], today: string): number {
  const from = new Date(Date.parse(today) - INJURY_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  // The source records one row per DIAGNOSIS, so a man hurt twice at once - or re-injured before the
  // first spell was closed - has overlapping rows: summing them read 591 days out of 365 for one player.
  // Merged first, then counted, so a day out is a day and never two.
  const windows: [string, string][] = [];
  for (const spell of spells) {
    if (!spell.from) continue;
    const start = spell.from > from ? spell.from : from;
    const endsAt = spell.to ?? today;
    // An open spell counts to today and no further: what it will cost from tomorrow is a forecast.
    const end = isOpen(spell, today) || endsAt > today ? today : endsAt;
    if (end <= start) continue;
    windows.push([start, end]);
  }
  windows.sort((left, right) => left[0].localeCompare(right[0]));
  let out = 0;
  let open: [string, string] | null = null;
  for (const window of windows) {
    if (open && window[0] <= open[1]) {
      if (window[1] > open[1]) open[1] = window[1];
      continue;
    }
    if (open) out += days(open[0], open[1]);
    open = [window[0], window[1]];
  }
  if (open) out += days(open[0], open[1]);
  return Math.min(1, out / INJURY_WINDOW_DAYS);
}

const it = (iso: string): string => iso.split('-').reverse().join('/');

/** One reading of one man's own football: the number, how much of it there is, and what it says. */
interface Sample {
  value: number | null;
  /** Appearances or matches behind it. Zero = nothing measured, which is not a zero value. */
  size: number;
  said: string;
}

/**
 * The readings blended with an anchor. Three of them are columns; `points` is not - it is what a man's
 * match is WORTH in his championship's own scoring, which the summary needs whole and no column shows.
 */
type OwnKey = 'votes' | 'bonus' | 'consistency' | 'points';

/** How the role is named in a sentence about a club's level. */
const ROLE_WORD: Record<string, string> = {
  P: 'portieri',
  D: 'difensori',
  C: 'centrocampisti',
  A: 'attaccanti',
};

/**
 * The anchors a thin reading is blended with: one per ROLE, and one per (club, role) inside it.
 *
 * Both are means over the men of THIS listone who have a full-sized sample, so the scale is the pool's
 * own - the same reason the percentile is. A club with nobody measured in that role simply has no club
 * anchor and the role's stands.
 */
function anchorsOf(
  pool: readonly PlayerRow[],
  own: ReadonlyMap<number, Record<OwnKey, Sample>>,
  key: OwnKey,
): { role: Map<string, number>; club: Map<string, { mean: number; measured: number }> } {
  const byRole = new Map<string, number[]>();
  const byClub = new Map<string, number[]>();
  for (const player of pool) {
    const sample = own.get(player.fcId)?.[key];
    if (!sample || sample.value == null || sample.size < FULL_SAMPLE) continue;
    (byRole.get(player.role) ?? byRole.set(player.role, []).get(player.role)!).push(sample.value);
    const clubKey = `${player.club}|${player.role}`;
    (byClub.get(clubKey) ?? byClub.set(clubKey, []).get(clubKey)!).push(sample.value);
  }
  const mean = (values: number[]) => values.reduce((sum, one) => sum + one, 0) / values.length;
  return {
    role: new Map([...byRole].map(([role, values]) => [role, mean(values)])),
    club: new Map([...byClub].map(([clubKey, values]) =>
      [clubKey, { mean: mean(values), measured: values.length }])),
  };
}

/**
 * The role's anchor moved toward the CLUB's own level for that role - `estimate.club_anchor`, same
 * arithmetic and same prior: a club we have measured three men of counts half, one man counts a quarter.
 */
export function clubAnchor(
  roleAnchor: number,
  club: { mean: number; measured: number } | undefined,
): number {
  if (!club || club.measured <= 0) return roleAnchor;
  return roleAnchor + (club.mean - roleAnchor) * (club.measured / (club.measured + CLUB_PRIOR));
}

/**
 * The four readings for one listone, ranked inside it.
 *
 * Each raw number is measured first and ranked after, so the note can state what the star rests on -
 * «6.12 di media su 87 partite» - and a reader can disagree with the number instead of with the stars.
 */
export function ratingsFor(input: {
  pool: readonly PlayerRow[];
  seasons: ReadonlyMap<number, SeasonRow[]>;
  matches: ReadonlyMap<number, MatchHistory>;
  spells: ReadonlyMap<number, Spell[]>;
  /**
   * The share of the coming calendar the ENGINE expects him to be on the team sheet for -
   * `engine_pv_pred / matchdays_target`, or its declared fallback. It is what «presenze» is about
   * (operator, 15/08/2026): a star there must say what he will play, not what he played.
   */
  expectedShare: ReadonlyMap<number, EngineForecast>;
  today: string;
  /**
   * The per-CHAMPIONSHIP scoring, for the one place a bonus has to be turned into POINTS: the overall.
   * Null on a bundle without the file, and then the game's published defaults stand and say so.
   */
  scoring?: ScoringConfig | null;
  /**
   * The operator's DECLARED notes for this season, keyed by `fc_id`. Empty is the normal case, and it
   * means «nothing declared» - never «nothing to declare».
   */
  declared?: ReadonlyMap<number, PlayerNote>;
}): Map<number, PlayerRating> {
  const { pool, seasons, matches, spells, expectedShare, today } = input;
  /**
   * The engine's share of the calendar, KEPT APART from the Presenze reading built on top of it.
   *
   * The column multiplies it by the minutes he plays when he plays - the operator's own definition of
   * «quanto ti assicura» - and the OVERALL must not: a fantavoto is not scaled by minutes, a man who
   * comes off at the 70th takes his full vote home, and what he does in those minutes is already inside
   * his own bonus per appearance. Multiplying by it there charged the same fact twice and cost exactly
   * the case that found it (Idzes and Dimarco, below).
   */
  const calendarShare = new Map<number, number | null>();
  const raw: Record<Exclude<RatingKey, 'overall'>, Map<number, number | null>> = {
    votes: new Map(), bonus: new Map(), presence: new Map(), consistency: new Map(),
  };
  const notes: Record<Exclude<RatingKey, 'overall'>, Map<number, string>> = {
    votes: new Map(), bonus: new Map(), presence: new Map(), consistency: new Map(),
  };
  const weights: Record<Exclude<RatingKey, 'overall'>, Map<number, number>> = {
    votes: new Map(), bonus: new Map(), presence: new Map(), consistency: new Map(),
  };

  /** What each man's own football says, before anybody is compared with anybody. */
  const own = new Map<number, Record<OwnKey, Sample>>();
  /** ...and how much of a match he plays when he plays, which the presences reading needs per role. */
  const minutesShare = new Map<number, { value: number | null; size: number }>();
  /** ...and how much of the last three years he spent injured, which is a fact about the NEXT one. */
  const fragility = new Map<number, Fragility>();

  for (const player of pool) {
    const id = player.fcId;
    const history = seasons.get(id) ?? [];
    const played = matches.get(id);
    const window = played ? [...played.seasons].sort().join(', ') : '';

    // 1. VOTI - the base vote of a career, weighted by the appearances behind each season and trimmed
    //    once there are five. The synthetic vote enters only where a season has no measured one: the
    //    listone's own history is the fact, the calibrated line is the fallback.
    const measuredSeasons = history.map((row) => ({ pv: row.pv, value: row.mv }));
    const seasonAppearances = history.reduce((sum, row) => sum + row.pv, 0);
    let votes: Sample = { value: seasonMean(measuredSeasons), size: seasonAppearances, said: '' };
    if (votes.value != null) {
      const kept = history.filter((row) => row.mv != null).length;
      votes.said = `${votes.value.toFixed(2)} su ${kept} stagion${kept === 1 ? 'e' : 'i'}`
        + `, ${seasonAppearances} presenze`
        + (kept >= TRIM_FROM ? ', tolte la migliore e la peggiore' : '');
    } else if (played?.votes.length) {
      const sum = played.votes.reduce((total, one) => total + one, 0);
      votes = {
        value: sum / played.votes.length,
        size: played.votes.length,
        said: `${(sum / played.votes.length).toFixed(2)} su ${played.votes.length} partite`
          + ` (${window}), ${played.synthetic} col voto sintetico`,
      };
    }

    // 2. BONUS - gol e assist per presenza, sulle stesse stagioni e con la stessa media troncata.
    const bonusValue = seasonMean(history.map((row) => ({ pv: row.pv, value: row.bonus })));
    const bonus: Sample = {
      value: bonusValue,
      size: seasonAppearances,
      said: bonusValue == null ? ''
        : `${bonusValue.toFixed(2)} fra gol e assist a presenza, su ${seasonAppearances}`,
    };

    // 4. COSTANZA - quante delle partite che gioca porta a casa almeno la sufficienza. È misurata sul
    //    VOTO e non sul fantavoto, perché la domanda è proprio quella: se non segna, prende 5?
    const votesPlayed = played?.votes ?? [];
    const consistency: Sample = {
      value: votesPlayed.length
        ? votesPlayed.filter((vote) => vote >= PASS_MARK).length / votesPlayed.length
        : null,
      size: votesPlayed.length,
      said: votesPlayed.length
        ? `${Math.round((votesPlayed.filter((vote) => vote >= PASS_MARK).length / votesPlayed.length) * 100)}%`
          + ` delle ${votesPlayed.length} partite chiuse con almeno ${PASS_MARK} (${window})`
        : '',
    };
    // ...and, with no column of its own, what one of his matches is WORTH beyond the base vote: every
    // bonus AND every malus the config prices, per appearance, on the same seasons and with the same
    // trimmed mean. It is the half of the fantavoto the Bonus column deliberately leaves out - a
    // keeper's goals conceded above all, which is most of what his matches are made of.
    const terms = eventTerms(input.scoring ?? null, player.league);
    const pointsValue = seasonMean(
      history.map((row) => ({ pv: row.pv, value: eventPointsOf(row, terms) / row.pv })),
    );
    const points: Sample = {
      value: pointsValue,
      size: seasonAppearances,
      said: pointsValue == null
        ? ''
        : `${pointsValue >= 0 ? '+' : ''}${pointsValue.toFixed(2)} di bonus e malus a presenza`,
    };
    own.set(id, { votes, bonus, consistency, points });

    // 3. PRESENZE - quanto della stagione CHE VIENE ti assicura, e la domanda guarda avanti (operator,
    //    15/08/2026): la base è la quota di calendario che il MOTORE gli prevede - la sua titolarità
    //    nella rosa di oggi, non le partite di ieri - corretta da quanto sta in campo QUANDO gioca, che
    //    è l'unica cosa che il passato sa e la previsione non dice: `pv` conta presenze a voto, non
    //    minuti, e un uomo che entra sempre al 70' ne ha tante e vale poco.
    //
    //    Il modello delle presenze del toolkit legge già gli infortuni, quindi la PREVISIONE non viene
    //    scontata una seconda volta. Quello che si applica sotto (`FRAGILITY_RISK`) non è una seconda
    //    previsione ma la preferenza dichiarata dell'operatore su chi si rompe spesso, ed è scritta lì.
    const forecast = expectedShare.get(id);
    const expected = forecast?.share ?? null;
    fragility.set(id, fragilityOf(spells.get(id) ?? [], today));
    // How much of a match he plays when he is on the team sheet. Blended with the ROLE's own figure by
    // how many appearances it rests on - the same shrink as every other reading here - because crediting
    // an unmeasured man with a full 90' put men nobody has seen play at the top of the column.
    minutesShare.set(id, played?.appearances
      ? { value: Math.min(1, played.minutes / (played.appearances * 90)), size: played.appearances }
      : { value: null, size: 0 });
    raw.presence.set(id, expected);       // the corrections are applied below, once the pool is known
    weights.presence.set(id, expected == null ? 0 : forecast!.estimated ? 0.5 : 1);
    notes.presence.set(
      id,
      expected == null
        ? 'il motore non lo prevede e non offre una stima: non misurabile'
        : `${Math.round(expected * 100)}% del calendario${forecast!.estimated ? ' (STIMA)' : ''}`,
    );
  }

  /**
   * ...and now the men with little or nothing measured, which is most of what an August listone is.
   *
   * NOBODY IS LEFT WITHOUT A NUMBER (operator, 15/08/2026, and it is his own rule of 05/08 one level
   * down): where his own football is thin the reading is BLENDED with the anchor of his role moved
   * toward his club's own level for that role, and where there is no football at all the anchor IS the
   * reading. The arithmetic is the toolkit's own and so are its constants - `engine/estimate.py`:
   * `shrink` pads the sample he is missing with the anchor (full sample = 15 votes), `club_anchor`
   * moves the role's number toward the club's by `n/(n+3)`.
   *
   * The doubt is not hidden, it is CARRIED: `weight` says how much of the number is his own, the note
   * says it in words, and the stars are drawn faded when it is mostly the anchor speaking. «Un
   * attaccante titolare della Juve anche se sconosciuto è sempre meglio di un attaccante sconosciuto
   * del Verona» - that is what the club pull is, and it is measured rather than assumed.
   */
  /**
   * The second half of PRESENZE, now that the pool can speak for a man it has not measured: how much of
   * a match his ROLE plays when it plays, blended with his own by the appearances he has. A keeper who
   * is fielded plays 90, a forward is taken off, and neither is «unknown means a full match».
   */
  const minuteAnchor = new Map<string, number>();
  const byRole = new Map<string, number[]>();
  for (const player of pool) {
    const one = minutesShare.get(player.fcId);
    if (!one || one.value == null || one.size < FULL_SAMPLE) continue;
    (byRole.get(player.role) ?? byRole.set(player.role, []).get(player.role)!).push(one.value);
  }
  for (const [role, values] of byRole) {
    minuteAnchor.set(role, values.reduce((sum, one) => sum + one, 0) / values.length);
  }
  /**
   * ...and the FRAGILITY, measured from the listone's own middle so that the ordinary man pays nothing.
   *
   * The median of the pool is the zero here for the same reason it is everywhere else in this file: half
   * a listone loses some days to injury every year, and charging everybody for the normal amount would
   * only re-scale the column. What is charged is the EXCESS - see `FRAGILITY_RISK`, and read the reason
   * there before touching it, because it is a declared preference and not a second forecast.
   */
  const injuryShares = [...pool].map((player) => fragility.get(player.fcId)?.share ?? 0);
  const usualInjury = medianOf(injuryShares) ?? 0;
  const secured = (id: number): number =>
    Math.max(0, 1 - FRAGILITY_RISK * Math.max(0, (fragility.get(id)?.share ?? 0) - usualInjury));

  for (const player of pool) {
    const id = player.fcId;
    const expected = raw.presence.get(id) ?? null;
    if (expected == null) continue;
    // The share you can COUNT ON: what the engine predicts, less what a man who breaks down often
    // cannot promise. One definition, read by this column and by the overall.
    const risk = secured(id);
    // ...and the overall alone also asks whether the place is his, and whether he will be there at all:
    // below `STARTER_SHARE` the summary stops paying linearly, and a DECLARED quarrel cuts what is left.
    // The COLUMN keeps the plain share - it answers «quanto gioca», and mixing a preference into it
    // would say the engine predicts something it does not.
    // Each preference is charged ONCE and on its own evidence: the guarantee reads what the engine
    // predicts for him when he is fit, the fragility what his three years say, the note what the
    // operator declared. Charging the concavity on the already-cut share billed the fragility twice
    // and took Dybala to 15% of a calendar the engine puts at 60%.
    const said = input.declared?.get(id);
    // Il POSTO si legge dalle partite cominciate, non da quelle giocate; se non ne ha di misurate il
    // vincolo non si applica invece di dare per scontato il peggio.
    const startShare = matches.get(id)?.startShare ?? null;
    const place = startShare == null
      ? 1
      : Math.min(1, startShare / STARTER_SHARE) ** STARTER_CONCAVITY;
    calendarShare.set(id, expected * place * risk * (said ? DECLARED_RISK[said.kind] : 1));
    const one = minutesShare.get(id) ?? { value: null, size: 0 };
    const anchor = minuteAnchor.get(player.role) ?? null;
    const weight = Math.max(0, Math.min(1, one.size / FULL_SAMPLE));
    const share = one.value == null || anchor == null
      ? (one.value ?? anchor)
      : anchor + weight * (one.value - anchor);
    if (share == null) {
      raw.presence.set(id, expected * risk);   // nothing of his role measured: the forecast stands alone
      continue;
    }
    raw.presence.set(id, expected * risk * share);
    // A forecast is only as sure as the minutes it is multiplied by: an unmeasured factor halves it.
    if (one.value == null || weight < 1) {
      weights.presence.set(id, (weights.presence.get(id) ?? 1) * Math.max(0.5, weight));
    }
    const hurt = fragility.get(id);
    notes.presence.set(
      id,
      `${notes.presence.get(id)} × ${Math.round(share * 90)}′ quando gioca`
        + (one.value == null
          ? ' (del suo ruolo)'
          : weight < 1
            ? ` (${Math.round(weight * 100)}% suoi)`
            : '')
        + (risk < 1 && hurt
          ? ` · −${Math.round((1 - risk) * 100)}% fragilità (${Math.round(hurt.share * 100)}% fuori in `
            + `${FRAGILITY_YEARS} anni)`
          : ''),
    );
  }

  /** One reading, blended with its anchors for the men the pool has little or nothing of. */
  const blend = (key: OwnKey): Map<number, { value: number | null; weight: number; said: string }> => {
    const anchors = anchorsOf(pool, own, key);
    const out = new Map<number, { value: number | null; weight: number; said: string }>();
    for (const player of pool) {
      const id = player.fcId;
      const sample = own.get(id)![key];
      const anchor = anchors.role.get(player.role) ?? null;
      if (anchor == null) {
        // A role nobody in this listone has measured at all: there is nothing to anchor to, and
        // inventing a number here would be inventing the scale itself.
        out.set(id, {
          value: sample.value,
          weight: sample.value == null ? 0 : 1,
          said: sample.said || 'niente di misurato e nessuna ancora per il suo ruolo',
        });
        continue;
      }
      const clubbed = clubAnchor(anchor, anchors.club.get(`${player.club}|${player.role}`));
      const weight = Math.max(0, Math.min(1, sample.size / FULL_SAMPLE));
      // «del Juventus» is not Italian and «della Roma» is: a club's article is not derivable, so the
      // sentence is built to need none.
      const level = `i ${ROLE_WORD[player.role] ?? 'giocatori'} del ${player.club || 'suo club'}`;
      out.set(id, {
        value: sample.value == null ? clubbed : clubbed + weight * (sample.value - clubbed),
        weight: sample.value == null ? 0 : weight,
        said:
          sample.value == null
            ? `SPANNOMETRICO: niente di misurato, vale come ${level} (${clubbed.toFixed(2)})`
            : weight >= 1
              ? sample.said
              : `${sample.said} · campione corto: ${Math.round(weight * 100)}% suo, il resto `
                + `${level} (${clubbed.toFixed(2)})`,
      });
    }
    return out;
  };

  for (const key of ['votes', 'consistency'] as const) {
    for (const [id, one] of blend(key)) {
      raw[key].set(id, one.value);
      weights[key].set(id, one.weight);
      notes[key].set(id, one.said);
    }
  }

  /**
   * The fourth blended reading, and the only one with no column: what his bonuses and MALUSES are
   * worth per appearance, in his championship's own points.
   *
   * It exists because the summary needs the whole of a match and the Bonus column is only half of it:
   * measured 15/08/2026, an overall built on «voto + gol e assist» put third-choice goalkeepers above
   * strikers (Corvi 73 against a value rank of 21), for the plain reason that a keeper's points are
   * mostly the goals he CONCEDES - a malus the column does not carry, because the column answers «fa
   * bonus?» and this one answers «quanto pesa una sua partita». Anchored like the others, so a man with
   * no measured season is his role's average and not «non subisce gol».
   */
  const eventPoints = blend('points');

  /*
   * ...ed È la colonna BONUS (operatore, 15/08/2026): «per i portieri che ne dici di valutare anche i
   * gol subiti, ovviamente in negativo?». Prima la colonna portava solo gol e assist, quindi ogni
   * portiere leggeva zero e i cartellini non li pagava nessuno - mentre fra i portieri con 20+ presenze
   * i gol subiti vanno da 0.76 a 1.75 a partita, un fantapunto pieno di differenza reso invisibile.
   * Ora è quello che una sua partita vale OLTRE al voto, che è anche il numero che il riassunto
   * moltiplica: una colonna che spiega l'Overall invece di raccontare metà della storia.
   */
  for (const [id, one] of eventPoints) {
    raw.bonus.set(id, one.value);
    weights.bonus.set(id, one.weight);
    notes.bonus.set(id, one.said);
  }

  const ranked: Record<RatingKey, Map<number, number | null>> = {
    votes: rank99(raw.votes),
    bonus: rank99(raw.bonus),
    presence: rank99(raw.presence),
    consistency: rank99(raw.consistency),
    overall: new Map(),
  };

  /**
   * OVERALL - «chi conviene avere», in the arithmetic the game pays in, then ranked like the others.
   *
   * NOT a mean of the four (operator, 15/08/2026, with the measurement in front of him): matches and
   * points per match MULTIPLY, so averaging their ranks made the summary worse than its own best part -
   * rho 0.538 against the presences' 0.776 on Serie A. It is `worthOf`: the share of the calendar he is
   * expected to play, times the points he makes when he plays, tilted by his steadiness. Ranked
   * afterwards for the same reason every column is: the raw number piles up in the middle, and the
   * column has to spread the listone it is about.
   */
  /**
   * Il centro della COSTANZA, uno per RUOLO.
   *
   * Chiudere a 6 è un evento diverso in porta e in attacco (le quattro mediane stanno in
   * `CONSISTENCY_TILT`), quindi un centro solo per tutti pagava il ruolo e non l'uomo. Un ruolo di cui
   * non è misurato nessuno resta senza centro e allora la correzione è zero: «vuoto = ignoto».
   */
  const consistencyMedian = new Map<string, number | null>();
  {
    const byRole = new Map<string, (number | null)[]>();
    for (const player of pool) {
      (byRole.get(player.role) ?? byRole.set(player.role, []).get(player.role)!)
        .push(raw.consistency.get(player.fcId) ?? null);
    }
    for (const [role, values] of byRole) consistencyMedian.set(role, medianOf(values));
    // ...e il centro va DETTO sulla riga, o il numero si legge male: il 58 di Martinez L. è un 58 sul
    // listone e un 80 fra gli attaccanti, e l'operatore lo ha letto come mediocre due volte in un'ora
    // (16/08/2026). La colonna resta ordinata su tutto il listone - è la pool che ha chiesto lui - ma
    // la nota porta il metro con cui l'Overall lo giudica.
    for (const player of pool) {
      const mid = consistencyMedian.get(player.role);
      const said = notes.consistency.get(player.fcId);
      if (mid == null || !said) continue;
      notes.consistency.set(player.fcId, `${said} · nel suo ruolo la mediana è ${Math.round(mid * 100)}%`);
    }
  }
  /**
   * The zero per ROLE, for the men the sheet does not price.
   *
   * Taken from the sheet's own numbers - the median of what it says about the men of that role - and
   * never invented: an estimated row still has to be measured against the man who would play instead,
   * and the alternative («no replacement, so count from zero») would put exactly the unmeasured men on
   * a different scale from everybody else in the same column.
   */
  const roleZero = new Map<string, number>();
  const zeros = new Map<string, number[]>();
  for (const player of pool) {
    const one = expectedShare.get(player.fcId)?.replacement;
    if (one != null) (zeros.get(player.role) ?? zeros.set(player.role, []).get(player.role)!).push(one);
  }
  for (const [role, values] of zeros) roleZero.set(role, medianOf(values)!);

  /**
   * QUANTO VALE UNA SUA PARTITA, e la fonte è il MOTORE prima della sua carriera.
   *
   * «L'overall deve basarsi su FM att.» (operatore, 16/08/2026). La fantamedia attesa del foglio è una
   * previsione per la stagione che VIENE e sa cose che una media di carriera non può sapere - il club
   * di oggi, l'arrivo, il livello del reparto che lo prende - mentre la carriera risponde a un'altra
   * domanda, «quanto ha fatto». Il caso che lo ha deciso: Gila arriva al Milan e la sua media è quella
   * di un difensore della Lazio.
   *
   * La CARRIERA resta come ripiego dichiarato per chi il foglio non porta affatto - «vuoto = ignoto»
   * vale per il numero, non per l'uomo, e ogni calciatore deve avere il suo - e la nota dice quale dei
   * due sta parlando, perché due basi diverse sotto una colonna sola sono esattamente il difetto che
   * questo progetto paga da sempre.
   */
  const matchWorth = (id: number): { value: number | null; fromEngine: boolean } => {
    const engine = expectedShare.get(id)?.fm ?? null;
    if (engine != null) return { value: engine, fromEngine: true };
    const votes = raw.votes.get(id) ?? null;
    if (votes == null) return { value: null, fromEngine: false };
    return { value: votes + (eventPoints.get(id)?.value ?? 0), fromEngine: false };
  };

  const overallRaw = new Map<number, number | null>();
  for (const player of pool) {
    const id = player.fcId;
    const points = matchWorth(id);
    overallRaw.set(
      id,
      worthOf({
        matches: calendarShare.get(id) ?? null,
        votes: points.value,
        eventPoints: null,
        replacement: expectedShare.get(id)?.replacement ?? roleZero.get(player.role) ?? null,
        consistency: raw.consistency.get(id) ?? null,
        medianConsistency: consistencyMedian.get(player.role) ?? null,
      }),
    );
  }
  /**
   * ...e prima di classificarlo, l'Overall grezzo viene ALLINEATO FRA I RUOLI: ognuno standardizzato
   * dentro il suo, poi tutti e quattro classificati insieme su una scala sola.
   *
   * IL PROBLEMA, portato dall'operatore il 16/08/2026 e vero due volte: «mettere tutti i primi portieri
   * a 99 non ha senso, significa che tutti sono forti uguale». Classificato grezzo su tutto il listone
   * il ruolo del portiere galleggiava (mediana 66 contro il 40 dei centrocampisti) e insieme si
   * schiacciava (i dodici migliori in dieci punti, 88-98), quindi la colonna non diceva né quanto vale
   * un portiere né QUALE comprare.
   *
   * LA CAUSA sta nello zero e non nella classifica, ed è scritta nel toolkit stesso
   * (`features.replacement_levels`): il rimpiazzo è il rango `squadre × slot` dentro la pool dei
   * regolari di quel ruolo, e le pool hanno taglie diverse. Per i portieri di Serie A il rango (10×3 =
   * 30) è più lungo della pool (~22 titolari), quindi lo zero è **l'ultimo portiere titolare**, mentre
   * per D/C/A è l'80° di ~150, cioè uno di metà classifica. Misurato come distanza dall'ancora del
   * proprio ruolo: P −0,90 · D −0,35 · C −0,38 · A −1,15. Quattro zeri a quattro profondità diverse
   * non sono confrontabili, ed è per questo che i ruoli non si allineavano.
   *
   * LA CURA è quella che l'operatore stesso ha indicato - «normalmente è la fantamedia a creare questo
   * confronto cross-ruolo»: un portiere lo si giudica sui portieri e un attaccante sugli attaccanti, e
   * POI i due giudizi si confrontano. Cioè uno z dentro il ruolo, classificato su tutto il listone. I
   * ruoli partono alla pari per costruzione e la colonna resta CROSS-RUOLO, che è quello che deve
   * essere.
   *
   * MISURATO, 498 quotati di Serie A - grezzo → allineato:
   *   mediana per ruolo   P 66 / D 49 / C 40 / A 60  →  P 58 / D 51 / C 46 / A 47   (scarto 26 → 12)
   *   primi 25            P7 / D5 / C5 / A8          →  P6 / D7 / C6 / A6
   *   spanna dei primi 12 portieri            10     →  16
   *   accordo col SURPLUS del foglio (Spearman) 0,64 →  0,48
   *
   * IL PREZZO VA DETTO: lo z divide per la dispersione del ruolo, quindi promuove i migliori di un
   * ruolo compatto (difensori, sd 0,21) rispetto a quelli di un ruolo largo (attaccanti, sd 0,39) - a
   * parità di z l'attaccante porta più fantapunti. Chi vuole i fantapunti li ha nel tooltip di ogni
   * cella, che è il numero grezzo e resta la scala vera.
   *
   * DUE STRADE RIFIUTATE, perché nessuno le ri-provi. Prendere come zero il rimpiazzo che si SCHIERA
   * (l'11° portiere invece del 31°, il 21° attaccante invece del 61°) distanzia benissimo i portieri ma
   * manda Simeone da 94 a 41 lasciando Esposito F.P. a 79 - cioè rimette la riserva sopra i due «che
   * hanno dimostrato di essere più affidabili», il caso che l'operatore aveva già chiuso - e l'accordo
   * col foglio crolla a 0,29. Mettere tutti gli zeri alla stessa distanza dall'ancora del ruolo tiene
   * quel caso solo fino a 0,5 di distanza, e già a 0,7 ribalta Bremer e Kelly. Entrambe misurate il
   * 16/08/2026.
   */
  {
    const measured = new Map<string, number[]>();
    for (const player of pool) {
      const value = overallRaw.get(player.fcId);
      if (value == null) continue;
      (measured.get(player.role) ?? measured.set(player.role, []).get(player.role)!).push(value);
    }
    const scale = new Map<string, { mean: number; sd: number }>();
    for (const [role, values] of measured) {
      const mean = values.reduce((sum, one) => sum + one, 0) / values.length;
      const sd = Math.sqrt(
        values.reduce((sum, one) => sum + (one - mean) ** 2, 0) / values.length,
      );
      scale.set(role, { mean, sd });
    }
    const aligned = new Map<number, number | null>();
    for (const player of pool) {
      const value = overallRaw.get(player.fcId) ?? null;
      const own = scale.get(player.role);
      // Un ruolo con un uomo solo, o con tutti uguali, non ha una dispersione da dividere: allora si
      // classifica il numero com'è invece di inventare una scala.
      aligned.set(player.fcId, value == null || !own || !own.sd ? value : (value - own.mean) / own.sd);
    }
    ranked.overall = rank99(aligned);
  }

  const out = new Map<number, PlayerRating>();
  for (const player of pool) {
    const id = player.fcId;
    const worth = overallRaw.get(id) ?? null;
    const reading = (key: Exclude<RatingKey, 'overall'>): Rating => ({
      raw: raw[key].get(id) ?? null,
      score: ranked[key].get(id) ?? null,
      weight: weights[key].get(id) ?? 0,
      note: notes[key].get(id) ?? '',
    });
    // The overall is as sure as the readings under it: the mean of their weights, so a row built on
    // anchors reads faded all the way across instead of pretending the summary knows more.
    const sureness = DETAIL_KEYS.map((key) => weights[key].get(id) ?? 0);
    // ...and the sum, said in words: the three factors and what they make, so the number can be
    // disagreed with instead of believed.
    const presence = calendarShare.get(id) ?? null;
    const worthOfOne = matchWorth(id);
    const points = worthOfOne.value;
    const zero = expectedShare.get(id)?.replacement ?? roleZero.get(player.role) ?? null;
    const steady = steadinessOf({
      consistency: raw.consistency.get(id) ?? null,
      medianConsistency: consistencyMedian.get(player.role) ?? null,
    });
    out.set(id, {
      overall: {
        raw: worth,
        score: ranked.overall.get(id) ?? null,
        weight: sureness.reduce((sum, one) => sum + one, 0) / sureness.length,
        // Two lines at most (`TOOLTIP_MAX`): the surplus, and the three numbers it is made of. The
        // sentence that explains WHAT it is lives under the table, where it can be read twice.
        note: worth == null || presence == null || points == null
          ? 'il motore non gli prevede presenze'
          : `${worth >= 0 ? '+' : '−'}${Math.abs(worth).toFixed(2)} a giornata sul rimpiazzo`
            + ` · ${Math.round(presence * 100)}% × (${points.toFixed(2)}`
            + (zero == null ? ' da zero' : ` − ${zero.toFixed(2)}`)
            + ')'
            + (steady === 0 ? '' : `, costanza ${steady > 0 ? '+' : '−'}${Math.abs(steady).toFixed(2)}`)
            // Quale delle due basi ha parlato: la FM attesa dal motore o - per chi il foglio non porta -
            // la sua carriera. Due basi sotto una colonna sola devono dirsi.
            + (worthOfOne.fromEngine ? '' : ' · su CARRIERA, il foglio non lo valuta'),
      },
      votes: reading('votes'),
      bonus: reading('bonus'),
      presence: reading('presence'),
      consistency: reading('consistency'),
    });
  }
  return out;
}

/** What each column is called, and what its star actually says. Written once, drawn everywhere. */
export const RATING_LABEL: Record<RatingKey, string> = {
  overall: 'Overall',
  votes: 'Voti',
  bonus: 'Bonus/Malus',
  presence: 'Presenze',
  consistency: 'Costanza',
};

export const RATING_HINT: Record<RatingKey, string> = {
  overall:
    'Quanto ti dà IN PIÙ di chi prenderesti al suo posto: giornate × (voto + bonus − il rimpiazzo). '
    + 'Cross-ruolo: ognuno è misurato sui suoi.',
  votes: 'Media voto di carriera, pesata sulle presenze di ogni stagione e troncata da cinque in su.',
  bonus:
    'Quanto vale una sua partita OLTRE al voto: gol e assist meno cartellini, autogol, rigori sbagliati '
    + 'e - per un portiere - i gol subiti.',
  presence:
    'Quanto della stagione CHE VIENE ti assicura: la quota di calendario che il motore gli prevede, '
    + 'corretta dai minuti che gioca quando gioca.',
  consistency:
    'Quante delle partite che gioca chiude con almeno 6 di VOTO: se non segna, prende 5? Il posto è '
    + 'sul listone, il giudizio sul suo ruolo.',
};

/**
 * ...and the long version of each, for «Come si leggono queste colonne» under the table.
 *
 * Nothing is lost by keeping a tooltip to two lines: what a number rests on, what it deliberately does
 * NOT count and what it cost to get right belongs where it can be read twice, not in a hover.
 */
export const RATING_DETAIL: Record<RatingKey, string> = {
  overall:
    'È CROSS-RUOLO, e per esserlo davvero ogni ruolo è misurato sui suoi prima di finire nella stessa '
    + 'classifica - come si fa normalmente con la fantamedia, dove un portiere si giudica sui portieri. '
    + 'Serviva: i quattro rimpiazzi del foglio stanno a profondità diverse della loro pool (per i '
    + 'portieri di Serie A i regolari sono meno degli slot di rosa, quindi lo zero è l\'ULTIMO titolare), '
    + 'e così i portieri galleggiavano - mediana 66 contro il 40 dei centrocampisti - e insieme si '
    + 'schiacciavano, i dodici migliori in dieci punti. Allineati: 58/51/46/47, e i portieri si '
    + 'distanziano. Il prezzo, detto: si divide per la dispersione del ruolo, quindi a parità di posto un '
    + 'attaccante porta più fantapunti di un difensore - i fantapunti veri sono nel tooltip della cella. '
    + 'Come è fatto il numero grezzo: '
    + 'le giornate a voto che il motore gli prevede × (voto + bonus e MALUS coi punti della tua lega + un '
    + 'aggiustamento di costanza − il livello di RIMPIAZZO del suo ruolo, che dice il foglio del motore: '
    + '4,13 per un portiere di Serie A contro 5,87 per un centrocampista). Lo zero non è zero perché al '
    + 'suo posto un giocatore lo schieri comunque: contati da zero, tre giornate in più battevano mezzo '
    + 'punto di qualità e un portiere titolare finiva in fondo al listone. È un PRODOTTO e non una media '
    + '(la media delle quattro letture concorda 0,54 col surplus del motore, questo 0,81) e NON sconta i '
    + 'minuti: chi esce al 70\' porta a casa tutto il fantavoto, ed è quella la differenza con la colonna '
    + 'Presenze. Vuoto = il motore non gli prevede presenze, che non è uno zero.',
  votes:
    'Media voto di carriera, pesata sulle presenze di ogni stagione e - da cinque stagioni in su - '
    + 'scartata la migliore e la peggiore. Dove una stagione non è sul listone entra il voto sintetico '
    + 'calibrato.',
  bonus:
    'Gol più assist per presenza, sulle stesse stagioni e con la stessa media troncata. I MALUS non sono '
    + 'qui: i gol subiti di un portiere pesano nell\'Overall, perché quella colonna chiede quanto vale '
    + 'una sua partita e questa chiede se fa bonus.',
  presence:
    'La quota di calendario che il motore gli prevede (engine_pv_pred, o la stima dichiarata), corretta '
    + 'da quanti minuti sta in campo quando gioca. Guarda avanti e non indietro; gli infortuni sono già '
    + 'dentro la previsione e non vengono contati due volte.',
  consistency:
    'Quante delle partite che gioca chiude con almeno 6 di voto base - reale dove c\'è, sintetico '
    + 'calibrato dove manca. ATTENZIONE A COME SI LEGGE: il numero 0-99 è il posto sul listone INTERO, '
    + 'e prendere 6 è un evento diverso a seconda del ruolo (mediana: portieri 86%, difensori 65%, '
    + 'centrocampisti 61%, attaccanti 57%), quindi un attaccante a 58 è nella metà alta dei suoi. '
    + 'Nell\'Overall infatti entra confrontato con la mediana del SUO RUOLO - centrarlo sul listone '
    + 'regalava a ogni portiere un decimo di fantamedia a partita per il fatto di essere un portiere - '
    + 'e vale due punti di fantamedia per punto di scarto: una correzione che si vede, non un verdetto.',
};

/** What the five stars mean, in the operator's own words. Said once, drawn wherever they are. */
export const STAR_SCALE_HINT =
  '3 stelle = in media, 4 = molto sopra, 5 = eccezionale, 2 = molto sotto, 1 = estremamente negativo. '
  + 'Una stella per deviazione standard.';

/** ...and the same rule with its consequences, for the panel under the table. */
export const STAR_SCALE_DETAIL =
  'La stellina è un GIUDIZIO rispetto al listone e non una percentuale: 3 stelle = in media, 4 = molto '
  + 'sopra la media, 5 = eccezionale, 2 = molto sotto, 1 = estremamente negativo, 0 = il peggiore del '
  + 'listone. Vale una deviazione standard per stella, quindi «in media» tiene dentro un quinto dei '
  + 'quotati e le 5 stelle ne toccano il 4% - su 499 quotati di Serie A sono 18 uomini. Il numero 0-99 '
  + 'accanto (bottone «Letture») è il posto esatto, e dentro una stella ci stanno decine di giocatori.';

/**
 * The sentence that explains a faded star, said once.
 *
 * It is the honest half of «tutti devono avere un valore»: everybody gets one, and the ones built on
 * the anchor say so instead of looking like the measured ones.
 */
export const ANCHOR_HINT =
  'Stella SFUMATA = spannometrica: di lui è misurato poco o niente, e il numero viene dall\'ancora del '
  + 'suo ruolo al suo club.';

/** ...and why that is a scale and not a guess, for the panel under the table. */
export const ANCHOR_DETAIL =
  'Stella SFUMATA = spannometrica: di lui è misurato poco o niente, quindi il numero è (in tutto o in '
  + 'parte) l\'ancora del suo ruolo spostata verso il livello del suo club - la stessa scala che usa il '
  + 'toolkit quando non può valutare un giocatore, perché ogni calciatore deve avere un numero e un '
  + 'numero incerto è meglio di una cella vuota, purché lo dica. Il tooltip della cella dice quanto è suo.';
