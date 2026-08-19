import { BundleTable, PlayerNote, ScoringConfig, ScoringTerms, columnIndex, optionalIndex } from './bundle';
import { anchorValue, scale99 } from './projection';
import { FRAGILITY_YEARS, Fragility, Spell, fragilityOf, isOpen } from './player-status';
import { Platform, PlayerRow } from './players-store';
import { short } from './tooltip';

/**
 * THREE readings of a player plus their summary, each a 0-99 inside the listone he is quoted on.
 *
 * THEY ARE REPORTING, and that has to be said before anything else: no valuation reads them, no ranking
 * of the auction panel uses them, no gate owns them. They are the questions the operator asks at a table -
 * «prende voti?», «fa bonus?», «gioca?», «chi conviene avere?» - answered from what was MEASURED, with
 * every threshold declared here in one place so nobody takes one for a fitted parameter.
 *
 * THE POOL IS PART OF THE MEASUREMENT, and it is why this is computed per platform: the euro listone and
 * the Serie A one are different pools, and a percentile quoted without its pool means nothing.
 *
 * COME SI CLASSIFICANO, e la storia va letta in ordine perché è cambiata due volte in due giorni.
 * ~~Percentile coi ruoli MESCOLATI, «rispetto a tutti gli altri trasversalmente ai ruoli».~~ Il 16/08/2026
 * fu corretto in uno z DENTRO il ruolo poi classificato con tutti (`alignedRank99`), perché mescolare i
 * ruoli non rendeva le letture cross-ruolo ma una FOTOGRAFIA DEL RUOLO - mediane del punteggio per
 * P/D/C/A: bonus 6/35/63/89, costanza 91/50/42/24, voti 87/36/45/55. **Il 17/08/2026 l'operatore ha
 * chiesto di tornare a tutti i calciatori** («il valore di VOTI, BONUS e PRESENZE deve essere calcolato in
 * relazione a tutti i calciatori e non al suo ruolo»), quindi quella funzione è stata cancellata e le tre
 * letture usano `rank99` sul listone: le mediane sopra tornano a valere, il ruolo è scritto sulla riga, e
 * il confronto fra ruoli lo fa l'OVERALL, che sottrae a ognuno il rimpiazzo della sua pool mantra. Le due
 * frasi vecchie restano barrate perché chi legge trova prima quelle.
 *
 * LA QUARTA LETTURA NON C'È PIÙ: la COSTANZA è un simbolo di varianza accanto ai Voti (`VarianceMark`,
 * stessa data e stessa richiesta), non un percentile fra gli altri.
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
 * LA COSTANZA NON PESA PIÙ SULL'OVERALL, e questa nota resta al posto del parametro che c'era.
 *
 * L'operatore ha dettato la formula il 17/08/2026: «Overall deve essere uguale a Presenze × (Voti +
 * Bonus − Rimpiazzo)». Non contiene un termine di costanza, quindi il tilt (`CONSISTENCY_TILT` = 2, con
 * il suo centro per ruolo) è stato TOLTO invece di essere messo a zero: un parametro che nessuno legge è
 * un parametro che il prossimo lettore crede attivo.
 *
 * Quello che quella misura aveva insegnato non si butta e sta scritto in `letture-app-v1.md` §3: il
 * centro giusto era il RUOLO e non il listone (mediane della quota di partite chiuse col 6: portieri
 * 0,864 · difensori 0,652 · centrocampisti 0,611 · attaccanti 0,572), perché una differenza fra RUOLI non
 * è una virtù di chi la porta. La stessa quota adesso si legge nel tooltip del simbolo di varianza, che
 * è dove l'operatore l'ha voluta (stessa data): una nota accanto al voto, non un addendo dentro la somma.
 */

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
}): number | null {
  const { matches, votes, eventPoints } = input;
  // No forecast of his appearances, no worth to state: «vuoto = ignoto, mai zero». A man nobody
  // predicts is not the worst man in the listone, he is one we cannot answer for.
  if (matches == null || votes == null) return null;
  return matches * (votes + (eventPoints ?? 0));
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

export type RatingKey = 'overall' | 'pi' | 'votes' | 'bonus' | 'presence';

/**
 * The three readings, in the order a row is read. `overall` is not one of them: it is what they make.
 *
 * LA COSTANZA NON È PIÙ UNA COLONNA (operatore, 17/08/2026): «trasformiamo il valore in un simbolo vicino
 * al voto che deve indicare la varianza». La misura non si è persa - si legge come marchio accanto ai
 * Voti (`VarianceMark`), con la sua deviazione standard e la quota di partite chiuse col 6 nel tooltip -
 * ma non è più un percentile fra gli altri: era una lettura che nessuno ordinava, e una colonna in meno è
 * una tabella che si legge.
 */
export const DETAIL_KEYS: Exclude<RatingKey, 'overall' | 'pi'>[] = ['votes', 'bonus', 'presence'];

/** Every column, the summary first: it is the one that is scanned, the four are the reason for it. */
export const RATING_KEYS: RatingKey[] = ['overall', 'pi', ...DETAIL_KEYS];

/**
 * L'OVERALL A COLORI, le bande dalla migliore in giù - richiesta dell'operatore del 18/08/2026 sul
 * campetto: «colora l'overall evidenziando i valori buoni da quelli meno buoni».
 *
 * DUE COSE VANNO DETTE PRIMA DEI NUMERI. La prima è che sono QUANTILI e non giudizi: l'overall è un
 * `rank99` dentro il listone della sessione, quindi 90 vuol dire «il 10% migliore» e 50 è la mediana per
 * costruzione - una banda qui è una fetta di listone, non una soglia di bravura, e cambiando listone
 * cambia chi ci finisce dentro. La seconda è che è una SCELTA DI VISUALIZZAZIONE dichiarata in un posto
 * solo, come le due soglie degli infortuni: nessuna valutazione la legge, nessun gate la possiede.
 *
 * I colori sono quelli che l'app usa già per dire «quanto è buono questo numero» (le barre di
 * `player-trend`), e non una seconda tavolozza: un secondo vocabolario per la stessa domanda finirebbe
 * per dire due cose. Il rosso qui non è un pericolo, è l'ultimo quinto del listone.
 */
export const OVERALL_BANDS: readonly [number, string][] = [
  [90, 'var(--color-vote-top)'],
  [75, 'var(--color-vote-high)'],
  [60, 'var(--color-vote-good)'],
  [40, 'var(--color-vote-mid)'],
  [20, 'var(--color-vote-low)'],
  [0, 'var(--color-vote-poor)'],
];

/** Il colore di un overall, e per un overall IGNOTO il grigio del bordo: un numero che non c'è non è un
 *  numero basso - «vuoto = ignoto, mai zero», applicato a una tinta. */
export function overallTone(score: number | null | undefined): string {
  if (score == null) return 'var(--color-border)';
  return OVERALL_BANDS.find(([floor]) => score >= floor)?.[1] ?? 'var(--color-vote-poor)';
}

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

export type PlayerRating = Record<RatingKey, Rating> & {
  /** Il marchio di varianza accanto ai Voti, o null quando è nella norma o non è misurabile. */
  variance: VarianceMark | null;
};

/**
 * QUANTO BALLA IL SUO VOTO, come simbolo accanto al voto (operatore, 17/08/2026).
 *
 * Tre stati e uno è il silenzio: varianza GRANDE, nella norma (nessun simbolo), PICCOLA. La misura è la
 * deviazione standard dei voti che ha preso davvero - la stessa lista di partite su cui si leggeva la
 * Costanza, che era invece la quota di partite chiuse col 6 e viaggia nel tooltip.
 *
 * LE BANDE SONO DENTRO IL RUOLO, e la ragione è misurata (17/08/2026, 359 quotati di Serie A con almeno
 * dieci voti nelle due stagioni sul calendario Serie A): la sd mediana è P 0,569 · D 0,598 · C 0,579 ·
 * A 0,715. Un attaccante balla di più per mestiere - segna o non segna - quindi bande comuni avrebbero
 * marcato «grande varianza» su mezzo reparto d'attacco, cioè avrebbero detto il RUOLO e non l'uomo: è la
 * lezione del canale dell'età, «una differenza fra due gruppi non è una virtù di chi la porta».
 *
 * I QUINTILI ESTERNI del suo ruolo DENTRO LA POOL sul quale la tabella lavora (il listone, non le righe a
 * schermo): il 20% più stabile e il 20% più ballerino prendono un simbolo, il 60% in mezzo niente. È una
 * scelta di VISUALIZZAZIONE dichiarata qui, come le soglie degli infortuni: non entra in nessuna
 * valutazione e nessun gate la possiede. Un ruolo con meno di `VARIANCE_MIN_POOL` uomini misurati non si
 * bandisce affatto - un quintile su otto portieri sarebbe un solo uomo.
 */
export interface VarianceMark {
  /** Deviazione standard dei suoi voti. */
  sd: number;
  band: 'high' | 'low';
  /** Una riga: la sd, la banda del suo ruolo e la vecchia costanza. */
  note: string;
}

/** Quale coda del ruolo prende un simbolo: il quinto per lato. */
export const VARIANCE_TAIL = 0.2;

/** Sotto quanti uomini misurati un ruolo non si bandisce: un quintile di otto portieri è un uomo. */
export const VARIANCE_MIN_POOL = 20;

/** La deviazione standard di una lista di voti, o null sotto `MIN_MATCHES`: una sd su tre partite non è una sd. */
export function spreadOf(votes: readonly number[]): number | null {
  if (votes.length < MIN_MATCHES) return null;
  const mean = votes.reduce((sum, one) => sum + one, 0) / votes.length;
  return Math.sqrt(votes.reduce((sum, one) => sum + (one - mean) ** 2, 0) / votes.length);
}

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
  /**
   * La MEDIA VOTO ATTESA del foglio (`est_mv`), che è la colonna MVa.
   *
   * La legge la lettura VOTI dal 17/08/2026 su richiesta dell'operatore («il valore Voti (0-99) deve
   * essere calcolato su MVa»): prima quella colonna era la media voto di CARRIERA, un'altra domanda.
   */
  mv: number | null;
  /**
   * `pi_fm`: quanto vale una sua partita secondo il calcio che ha DAVVERO giocato.
   *
   * Non è `fm` con un altro nome. Dove il motore non lo prezza, `fm` (cioè `est_fm`) scende sull'ANCORA
   * del ruolo - «è un attaccante della Juve» - mentre questa legge le sue partite vere all'estero e le
   * regredisce verso quell'ancora con un coefficiente misurato. Differiscono su 129 righe del foglio
   * mantra di Serie A; `piBasis` dice sempre quale delle due ha parlato.
   */
  piFm: number | null;
  piBasis: string | null;
  piMatches: number | null;
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
 * Lo stesso percentile, ma dentro il RUOLO: ogni uomo confrontato con quelli del suo, sul listone intero.
 *
 * Perché non basta `rank99` su tutti. Una fantamedia e una media voto non vogliono dire la stessa cosa in
 * porta e in attacco - è la lezione del 16/08/2026 sull'Overall, scritta per esteso dove i ruoli vengono
 * allineati - quindi un 6,20 classificato sul listone intero direbbe soprattutto CHE RUOLO GIOCA, e una
 * colonna colorata così sarebbe una colonna che dipinge i portieri. «Un portiere lo si giudica sui
 * portieri e un attaccante sugli attaccanti», che è la frase dell'operatore e anche la cura.
 *
 * IL POOL È IL LISTONE e non le righe a schermo, ed è deliberato: la stessa tabella disegna la rosa di UN
 * club e il listone intero, e con il pool delle righe «buono» vorrebbe dire «il migliore di questi
 * ventisei» - cioè il difetto che il pannello del toolkit ha già pagato (il portiere del Milan al 99%
 * perché la popolazione era un club solo). Buono qui vuol dire buono fra i giocatori che puoi comprare.
 *
 * Un ruolo con un uomo misurato solo non ha una classifica: `rank99` gli dà 50, che è «né sopra né sotto».
 */
export function rank99ByRole(
  pool: readonly { fcId: number; role: string }[],
  values: ReadonlyMap<number, number | null>,
): Map<number, number | null> {
  const byRole = new Map<string, Map<number, number | null>>();
  for (const player of pool) {
    const mine = byRole.get(player.role) ?? byRole.set(player.role, new Map()).get(player.role)!;
    mine.set(player.fcId, values.get(player.fcId) ?? null);
  }
  const out = new Map<number, number | null>();
  for (const [, mine] of byRole) {
    for (const [fcId, score] of rank99(mine)) out.set(fcId, score);
  }
  return out;
}

/**
 * IL PERCENTILE ALLINEATO FRA I RUOLI È STATO RITIRATO il 17/08/2026, e questa nota sta al posto suo.
 *
 * Che cos'era: ogni lettura standardizzata dentro il suo ruolo (mediana e MAD) e poi classificata con
 * tutte le altre, cioè la scala del surplus applicata a una lettura qualsiasi. Serviva perché il numero
 * GREZZO di VOTI, BONUS e COSTANZA vuol dire cose diverse a seconda del ruolo, e quanto diverse era
 * misurato - mediane per ruolo del punteggio, 499 quotati di Serie A: BONUS 6 / 35 / 63 / 89 (83 punti di
 * scarto, perché i punti evento di un portiere sono negativi per costruzione: i gol che subisce),
 * COSTANZA 91 / 50 / 42 / 24 (67), VOTI 87 / 36 / 45 / 55 (51).
 *
 * Perché non c'è più: l'operatore ha chiesto l'opposto - «il valore di VOTI, BONUS e PRESENZE deve essere
 * calcolato in relazione a tutti i calciatori e non al suo ruolo» - e la sua ragione tiene, perché quelle
 * tre colonne sono descrittive e il ruolo è scritto sulla riga. Il confronto fra ruoli lo fa l'OVERALL,
 * che sottrae a ognuno il rimpiazzo della sua pool MANTRA: comparabile per costruzione, senza
 * standardizzare due volte. Le misure sopra restano vere e sono la ragione per cui la conseguenza va
 * detta invece che scoperta al tavolo (`letture-app-v1.md` §4-ter).
 *
 * Cancellata e non messa a riposo: una funzione esportata che nessuno chiama è una funzione che il
 * prossimo lettore crede attiva.
 */
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
/**
 * Quali stagioni un uomo al `cutoff` poteva già leggere come TOTALE: quelle finite.
 *
 * Un aggregato di stagione è un numero che esiste a maggio. A novembre la stagione in corso non ha un
 * totale - ce l'ha a fine anno, e leggerlo sarebbe sapere come va a finire - quindi al viaggio nel tempo
 * la stagione in corso e tutte quelle successive escono, e le letture che vivono sullo strato per-partita
 * (costanza, trend) continuano a rispondere per il pezzo giocato. È il taglio più severo dei due, ed è il
 * lato giusto da sbagliare: meglio una lettura in meno che una che conosce il futuro.
 *
 * La fine si ricava dal NOME («2024-25» è chiusa dal 1º luglio 2025) e non dall'ultima partita che
 * abbiamo: una stagione che il layer per-partita non copre sarebbe altrimenti indistinguibile da una mai
 * cominciata, e la sparirebbe anche viaggiando a ieri.
 */
export function seasonsClosedBy(seasons: Iterable<string>, cutoff: string): Set<string> {
  const out = new Set<string>();
  for (const season of seasons) {
    const start = Number(season.slice(0, 4));
    if (!Number.isFinite(start)) continue;
    if (`${start + 1}-07-01` <= cutoff) out.add(season);
  }
  return out;
}

export function seasonHistories(
  table: BundleTable,
  platform: Platform,
  /** Le sole stagioni leggibili come totale. Assente = tutte, che è il caso normale (nessun viaggio). */
  closed?: ReadonlySet<string>,
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
    if (closed && !closed.has(row[season] as string)) continue;
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
  /**
   * IL VIAGGIO NEL TEMPO: una partita giocata dopo questo giorno non è ancora stata giocata.
   *
   * Taglia in un punto solo - la prima passata e la seconda leggono lo stesso predicato - perché i
   * denominatori vivono qui: le giornate che un campionato aveva giocato, le partite da titolare, la
   * finestra delle ultime dieci. Tagliare il numeratore e non il denominatore è il modo classico di
   * inventarsi una quota, ed è lo stesso difetto che questo progetto ha già pagato sui campionati.
   */
  cutoff?: string,
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
  const eDate = optionalIndex(external, 'match_date');
  /** Un solo predicato per le due passate: «questa partita era già stata giocata quel giorno?». */
  const played = (row: unknown[]): boolean =>
    !cutoff || eDate < 0 || ((row[eDate] as string | null) ?? '') <= cutoff;
  /** (stagione, campionato) -> quante giornate ha giocato: il denominatore giusto è il suo campionato. */
  const rounds = new Map<string, number>();
  /** fc_id -> stagione -> quante ne ha cominciate. */
  const startsBySeason = new Map<number, Map<string, number>>();
  for (const row of external.rows) {
    if (row[eSource] !== 'sofascore' || !played(row)) continue;
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
    if (row[eSource] !== 'sofascore' || !played(row)) continue;
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
  /**
   * La quota di porte inviolate del CLUB, per nome di club (`club-defence.clubCleanSheets`).
   *
   * Serve solo ai portieri, ed entra su tutt'e due i lati del conto - vedi `cleanSheetLift`. Assente su
   * un bundle vecchio: allora nessun lato la vede, che è coerente e non un mezzo conto.
   */
  cleanSheetRate?: ReadonlyMap<string, number>;
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
  const raw: Record<Exclude<RatingKey, 'overall' | 'pi'>, Map<number, number | null>> = {
    votes: new Map(), bonus: new Map(), presence: new Map(),
  };
  const notes: Record<Exclude<RatingKey, 'overall' | 'pi'>, Map<number, string>> = {
    votes: new Map(), bonus: new Map(), presence: new Map(),
  };
  const weights: Record<Exclude<RatingKey, 'overall' | 'pi'>, Map<number, number>> = {
    votes: new Map(), bonus: new Map(), presence: new Map(),
  };
  /**
   * La COSTANZA, che non è più una colonna e non è più un addendo: resta come NOTA del simbolo di
   * varianza, blendata con l'ancora come quando era una lettura, così la frase sul tooltip è la stessa
   * che la colonna diceva.
   */
  const steadyRaw = new Map<number, number | null>();
  const steadyNote = new Map<number, string>();
  /** ...e la DISPERSIONE vera dei suoi voti, che è quello che il simbolo dichiara di dire. */
  const spread = new Map<number, { sd: number | null; size: number }>();
  /**
   * LA CARRIERA, che non è più una colonna e serve solo come RIPIEGO dell'Overall.
   *
   * Il voto medio pesato e troncato, e quello che i suoi eventi valgono a presenza: rispondono a «quanto
   * ha fatto» e l'Overall li usa soltanto per chi il foglio non valuta affatto, perché ogni calciatore
   * deve avere il suo numero. La nota della cella lo DICHIARA.
   */
  const careerVote = new Map<number, number | null>();
  const careerEvents = new Map<number, number | null>();

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
    // ...e la DISPERSIONE degli stessi voti, che è quello che il simbolo accanto ai Voti dichiara di dire.
    spread.set(id, { sd: spreadOf(votesPlayed), size: votesPlayed.length });
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

    // ---- LE TRE LETTURE VENGONO DAL FOGLIO (operatore, 17/08/2026):
    //      «Voti (0-99) deve essere calcolato su MVa · Bonus (0-99) su FMa · Presenze (0-99) su P».
    //
    // Quindi non sono più tre misure di carriera pesate e ancorate: sono i tre numeri che il MOTORE
    // prevede per la stagione che viene, classificati sul listone. Il senso di ognuna cambia e va detto:
    // VOTI è la media voto ATTESA (`est_mv`) e non quella fatta; BONUS classifica la FANTAMEDIA attesa
    // (`engine_fm_pred`), che contiene il voto - il tasso di bonus vero sarebbe FMa − MVa, e questa
    // colonna non è quello; PRESENZE è la quota di calendario che il motore gli prevede, senza le tre
    // correzioni che c'erano prima (minuti quando gioca, fragilità, nota dichiarata).
    //
    // Quelle tre preferenze non sono sparite dal tavolo, sono sparite da QUESTE colonne: restano i marchi
    // accanto al nome (infortunio in corso, si infortuna spesso, fuori rosa) che le dicono in parole.
    const forecast = expectedShare.get(id);
    const sheetReading = (value: number | null | undefined, said: string) => {
      const known = value ?? null;
      return {
        value: known,
        weight: known == null ? 0 : forecast?.estimated ? 0.5 : 1,
        said: known == null
          ? 'il motore non lo valuta e non offre una stima: ignoto, mai zero'
          : `${said}${forecast?.estimated ? ' (STIMA dichiarata)' : ''}`,
      };
    };
    for (const [key, one] of [
      ['votes', sheetReading(forecast?.mv, `${(forecast?.mv ?? 0).toFixed(2)} di media voto attesa`)],
      /*
       * BONUS = I BONUS, e non la fantamedia (operatore, 18/08/2026, con la sua definizione dell'Overall:
       * «partite a voto previste x (Media Voto attesa + Bonus attesi)»).
       *
       * Portava `est_fm`, cioe' il voto DENTRO, quindi «MVa + Bonus» contava il voto due volte e la frase
       * sotto la tabella doveva avvertire di non sommarle - e un avvertimento e' la confessione che due
       * colonne non si possono leggere insieme. Adesso la colonna e' `est_fm - est_mv`: il tasso di bonus a
       * presenza che il foglio si aspetta da lui, cioe' l'altro addendo della sua formula. Per un portiere
       * resta NEGATIVO per costruzione (i gol che subisce), ed e' la stessa aritmetica che il foglio scrive
       * nella propria nota (`est_note`: «-0.82 di bonus a presenza»).
       */
      ['bonus', sheetReading(
        forecast?.fm != null && forecast?.mv != null ? forecast.fm - forecast.mv : null,
        `${((forecast?.fm ?? 0) - (forecast?.mv ?? 0)).toFixed(2)} di bonus a presenza`
          + ` (fantamedia attesa ${(forecast?.fm ?? 0).toFixed(2)} meno media voto`
          + ` ${(forecast?.mv ?? 0).toFixed(2)})`,
      )],
      ['presence', sheetReading(
        forecast?.share,
        `${Math.round((forecast?.share ?? 0) * 100)}% del calendario a voto`,
      )],
    ] as const) {
      raw[key].set(id, one.value);
      weights[key].set(id, one.weight);
      notes[key].set(id, one.said);
    }
    // Quello che l'OVERALL moltiplica è la stessa quota, senza correzioni: la formula dettata è
    // «presenze × (voti+bonus)» e le presenze sono quelle del motore.
    calendarShare.set(id, forecast?.share ?? null);
  }

  /**
   * IL BLEND CON L'ANCORA resta per DUE usi soli, e non è più una lettura di nessuna colonna.
   *
   * Serve (a) al ripiego di CARRIERA dell'Overall - chi il foglio non prezza affatto deve comunque avere
   * un numero, ed è la regola «ogni calciatore deve avere il suo» - e (b) alla nota del simbolo di
   * varianza, che porta la vecchia costanza. L'aritmetica è quella del toolkit (`engine/estimate.py`):
   * `shrink` riempie il campione che manca con l'ancora del ruolo, `club_anchor` la tira verso il livello
   * del club di `n/(n+3)`.
   */
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

  for (const [id, one] of blend('votes')) {
    careerVote.set(id, one.value);
  }
  // ...e la costanza per la stessa strada, in due mappe sue: nessuna colonna la classifica più.
  for (const [id, one] of blend('consistency')) {
    steadyRaw.set(id, one.value);
    steadyNote.set(id, one.said);
  }
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
    careerEvents.set(id, one.value);
  }

  /**
   * NIENTE PIÙ ANCORE, NIENTE PIÙ CORREZIONI SULLE PRESENZE: le tre letture sono i numeri del foglio.
   *
   * Che cosa è stato cancellato il 17/08/2026 con la richiesta dell'operatore, perché nessuno lo
   * ricostruisca per sbaglio credendo che manchi: il blend con l'ANCORA del ruolo tirata verso il livello
   * del club (era la regola «ogni calciatore deve avere il suo numero» applicata alle letture), i MINUTI
   * QUANDO GIOCA (un esterno tolto al 70' valeva meno di un centrale a parità di presenze), lo sconto di
   * FRAGILITÀ sull'eccesso rispetto alla mediana del listone, la concavità sul POSTO da titolare e la
   * penale della NOTA DICHIARATA. Le misure che li avevano scelti stanno in `letture-app-v1.md` §5-§7.
   *
   * Restano - e sono la stessa informazione detta in parole invece che in un numero - i marchi accanto al
   * nome: infortunio lungo in corso, rientrato da poco, si infortuna spesso, fuori rosa/rottura.
   */
  const consistencyMedian = new Map<string, number | null>();
  {
    const byRole = new Map<string, (number | null)[]>();
    for (const player of pool) {
      (byRole.get(player.role) ?? byRole.set(player.role, []).get(player.role)!)
        .push(steadyRaw.get(player.fcId) ?? null);
    }
    for (const [role, values] of byRole) consistencyMedian.set(role, medianOf(values));
    // ...e il centro va DETTO sulla riga, o il numero si legge male: il 58 di Martinez L. è un 58 sul
    // listone e un 80 fra gli attaccanti, e l'operatore lo ha letto come mediocre due volte in un'ora
    // (16/08/2026). La colonna resta ordinata su tutto il listone - è la pool che ha chiesto lui - ma
    // la nota porta il metro con cui l'Overall lo giudica.
    for (const player of pool) {
      const mid = consistencyMedian.get(player.role);
      const said = steadyNote.get(player.fcId);
      if (mid == null || !said) continue;
      steadyNote.set(player.fcId, `${said} · nel suo ruolo la mediana è ${Math.round(mid * 100)}%`);
    }
  }
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
  /**
   * LA PORTA INVIOLATA, sui DUE LATI del conto o su nessuno.
   *
   * `FM att.` è la previsione del motore nel punteggio della FONTE, che quel termine non lo applica; la
   * colonna Bonus invece usa il punteggio della LEGA, che lo paga. Le due colonne dicevano quindi due
   * numeri diversi sulla stessa partita di un portiere (dichiarato il 16/08/2026, e l'operatore ha
   * chiesto di allinearle).
   *
   * Si allineano QUI e non nel motore, e la differenza conta: cambiare il punteggio in cui il motore
   * prevede vorrebbe dire rifare ogni numero che il gate ha misurato. Questa è invece una conversione
   * di REPORTING, dichiarata come la fragilità e la costanza, e la regola che la rende onesta è una
   * sola: **si applica al giocatore E al suo rimpiazzo**. Aggiungerla da un lato solo regalerebbe a
   * ogni portiere +0,30 di fantamedia, che è l'errore che questo progetto ha già pagato altrove.
   *
   * IL TASSO È QUELLO DEL CLUB, non del portiere, ed è misurato: la quota di porte inviolate non
   * persiste sull'uomo (r 0,074 fra due stagioni) e persiste sul club (r 0,488) - la misura sta in
   * `club-defence.ts`. Un club che non abbiamo misurato (una promossa) prende la mediana del listone,
   * che è anche quello che prende il rimpiazzo: così nessuno dei due lati resta scoperto.
   */
  const keeperBonus = input.scoring == null && !input.cleanSheetRate
    ? 0
    : eventTerms(input.scoring ?? null, null).clean_sheet_bonus_gk;
  const cleanSheetRates = [...(input.cleanSheetRate?.values() ?? [])];
  const typicalCleanSheet = medianOf(cleanSheetRates) ?? 0;
  const cleanSheetLift = (player: PlayerRow): number => {
    if (player.role !== 'P' || !keeperBonus) return 0;
    return keeperBonus * (input.cleanSheetRate?.get(player.club) ?? typicalCleanSheet);
  };

  const matchWorth = (id: number, player: PlayerRow): { value: number | null; fromEngine: boolean } => {
    const engine = expectedShare.get(id)?.fm ?? null;
    if (engine != null) return { value: engine + cleanSheetLift(player), fromEngine: true };
    const votes = careerVote.get(id) ?? null;
    if (votes == null) return { value: null, fromEngine: false };
    // La carriera passa dai punti-evento, che la porta inviolata la contano già (`eventPointsOf`).
    return { value: votes + (careerEvents.get(id) ?? 0), fromEngine: false };
  };

  /** Lo stesso numero senza il giro del ruolo: serve a ordinare la pool prima che lo zero esista. */
  const matchWorthRaw = (id: number): number | null => {
    const engine = expectedShare.get(id)?.fm ?? null;
    if (engine != null) return engine;
    const votes = careerVote.get(id) ?? null;
    return votes == null ? null : votes + (careerEvents.get(id) ?? 0);
  };

  /**
   * NON C'È PIÙ UNO ZERO, e la formula in vigore è quella dettata dall'operatore il 17/08/2026 sera:
   * «facciamo che overall è semplicemente presenze × (voti+bonus)».
   *
   * Quindi la colonna dice **quanti fantapunti porta in tutto**, non quanti ne porta in più di qualcuno.
   * Tre pezzi di macchina sono stati cancellati con essa e vanno ricordati per non ricostruirli per
   * sbaglio: il rimpiazzo che si SCHIERA (P 5,01 · D 6,11 · C 6,37 · A 6,79, misurato per due strade il
   * 16/08), il rimpiazzo del RUOLO MANTRA letto dal foglio mantra (`por` 4,13 … `pc` 7,01, in vigore per
   * un'ora la sera del 17/08) e la mediana per ruolo che serviva a chi il foglio non prezza. Le misure
   * stanno in `letture-app-v1.md` §4-bis e §9.
   *
   * UNA CONSEGUENZA VA DETTA, perché nessuno la scopra al tavolo: senza rimpiazzo la porta inviolata del
   * portiere resta su UN SOLO lato del conto (la sua). Prima entrava su tutt'e due proprio per non
   * regalargliela; adesso non c'è un altro lato, quindi il numero è «quanto vale una sua partita nella
   * TUA lega» e la porta inviolata ne fa parte per definizione. Chi la volesse fuori dovrebbe togliere
   * `clean_sheet_bonus_gk` dal punteggio della lega, che è un'altra decisione.
   */

  /**
   * OGNI LETTURA È CLASSIFICATA SU TUTTI I CALCIATORI, e non dentro il suo ruolo (operatore, 17/08/2026:
   * «il valore di VOTI, BONUS e PRESENZE deve essere calcolato in relazione a tutti i calciatori e non al
   * suo ruolo»). `alignedRank99` è stata cancellata; la conseguenza misurata sta in `letture-app-v1.md`
   * §9.2 - un portiere prende voti base più alti, quindi in VOTI i portieri stanno in alto per il ruolo
   * prima che per il merito, e il ruolo è scritto sulla riga davanti al nome.
   */
  const ranked: Record<RatingKey, Map<number, number | null>> = {
    votes: rank99(raw.votes),
    bonus: rank99(raw.bonus),
    presence: rank99(raw.presence),
    overall: new Map(),
    pi: new Map(),
  };

  const overallRaw = new Map<number, number | null>();
  for (const player of pool) {
    const id = player.fcId;
    const points = matchWorth(id, player);
    overallRaw.set(
      id,
      worthOf({
        matches: calendarShare.get(id) ?? null,
        votes: points.value,
        eventPoints: null,
      }),
    );
  }
  /**
   * ...e SI CLASSIFICA GREZZO, su tutto il listone, senza più allinearlo fra i ruoli.
   *
   * PERCHÉ SI PUÒ, dal 17/08/2026: lo z dentro il ruolo esisteva per curare uno ZERO che cambiava
   * profondità da ruolo a ruolo (i quattro rimpiazzi del foglio stanno a −0,90 / −0,35 / −0,38 / −1,15
   * dall'ancora del loro ruolo, perché per i portieri di Serie A il rango «squadre × slot» è più lungo
   * della pool dei regolari). Adesso lo zero è il marginale della sua pool MANTRA, quindi ogni uomo è già
   * misurato contro chi lo sostituirebbe davvero e la scala è la stessa per tutti: standardizzare ancora
   * dividerebbe una seconda volta per la dispersione del ruolo, che è il prezzo che quella cura faceva
   * pagare (a parità di z l'attaccante porta più fantapunti dell'esterno basso).
   *
   * QUELLO CHE SI PERDE VA DETTO, perché è la misura del 16/08: allineati, i quattro ruoli avevano
   * mediane 58/51/46/47 contro 66/49/40/60 da grezzi, e i dodici migliori portieri si distanziavano su 16
   * punti invece di 10. Con questo zero il conto va rifatto, non ricopiato: la cura è un'altra e i numeri
   * di quella non descrivono questa. Le due strade rifiutate quel giorno restano rifiutate e stanno in
   * `letture-app-v1.md` §4 - lo zero «schierato» (manda Simeone da 94 a 41) e gli zeri a distanza fissa
   * dall'ancora (ribaltano Bremer e Kelly a 0,7).
   */
  ranked.overall = rank99(overallRaw);

  /**
   * Fπ: LO STESSO CONTO CON UN VALORE A PARTITA DIVERSO, e una scala dichiarata invece di un percentile.
   *
   * Il fattore delle presenze è identico a quello dell'Overall; cambia il valore di una partita, che qui
   * è `pi_fm` - le sue partite VERE all'estero regredite verso l'ancora, dove il motore non lo prezza -
   * invece dell'ancora secca. Il bonus della porta inviolata entra su tutt'e due per la stessa ragione:
   * fa parte di quanto vale la partita di un portiere, e toglierlo da una sola delle due colonne le
   * renderebbe incomparabili.
   *
   * La SCALA è in `projection.ts` con i tre punti fissi che l'operatore ha dettato, e l'ancora si sceglie
   * per OVERALL: un riferimento definito dalla colonna che sta scalando si sposterebbe a ogni suo ritocco.
   */
  const piRaw = new Map<number, number | null>();
  for (const player of pool) {
    const id = player.fcId;
    const perMatch = expectedShare.get(id)?.piFm ?? null;
    piRaw.set(id, worthOf({
      matches: calendarShare.get(id) ?? null,
      votes: perMatch == null ? null : perMatch + cleanSheetLift(player),
      eventPoints: null,
    }));
  }
  {
    const ids = [...piRaw.keys()];
    const scores = ids.map((id) => piRaw.get(id) ?? null);
    const byOverall = ids.map((id) => overallRaw.get(id) ?? null);
    const mean = anchorValue(scores, byOverall);
    const measured = scores.filter((one): one is number => one != null);
    const best = measured.length ? Math.max(...measured) : null;
    const worst = measured.length ? Math.min(...measured) : null;
    for (const id of ids) ranked.pi.set(id, scale99(piRaw.get(id) ?? null, mean, best, worst));
  }

  /**
   * Le due soglie per ruolo, prese DALLA POOL: il quintile basso e quello alto della sd di quel ruolo.
   *
   * Il pool di un percentile è parte della misura - la regola che questo progetto ha già pagato - quindi
   * le soglie di un listone euro non sono quelle di un listone di Serie A, e non sono scritte a mano.
   */
  const varianceBands = new Map<string, { low: number; high: number }>();
  {
    const byRole = new Map<string, number[]>();
    for (const player of pool) {
      const sd = spread.get(player.fcId)?.sd;
      if (sd == null) continue;
      (byRole.get(player.role) ?? byRole.set(player.role, []).get(player.role)!).push(sd);
    }
    for (const [role, values] of byRole) {
      if (values.length < VARIANCE_MIN_POOL) continue;   // pool troppo corta: nessun simbolo, e va bene
      values.sort((left, right) => left - right);
      const at = (share: number) => values[Math.min(values.length - 1, Math.floor(share * values.length))];
      varianceBands.set(role, { low: at(VARIANCE_TAIL), high: at(1 - VARIANCE_TAIL) });
    }
  }
  const varianceFor = (player: PlayerRow): VarianceMark | null => {
    const sd = spread.get(player.fcId)?.sd;
    const bands = varianceBands.get(player.role);
    if (sd == null || !bands) return null;
    const band = sd >= bands.high ? 'high' : sd <= bands.low ? 'low' : null;
    if (!band) return null;
    const steady = steadyNote.get(player.fcId);
    return {
      sd,
      band,
      note: short(
        `Varianza ${band === 'high' ? 'GRANDE' : 'PICCOLA'}: sd ${sd.toFixed(2)} sul voto, `
          + `${band === 'high' ? 'ultimo' : 'primo'} quinto del suo ruolo (soglie `
          + `${bands.low.toFixed(2)} / ${bands.high.toFixed(2)})`
          + (steady ? ` · ${steady}` : ''),
      ),
    };
  };

  /** Cosa dice la cella di Fπ: il totale, i due fattori, e DA QUALE calcio viene il valore a partita. */
  const piNote = (id: number, forecast: EngineForecast | null,
                  worth: number | null, presence: number | null): string => {
    if (worth == null || presence == null || forecast?.piFm == null) {
      return 'il motore non gli prevede presenze';
    }
    const from = forecast.piBasis === 'abroad'
      ? ` · da ${forecast.piMatches} partite vere all'estero`
      : forecast.piBasis === 'core' ? '' : ` · su ${forecast.piBasis}, il foglio non lo valuta qui`;
    return short(`${worth.toFixed(2)} fantapunti a giornata · ${Math.round(presence * 100)}%`
      + ` del calendario × ${forecast.piFm.toFixed(2)} a partita${from}`);
  };

  const out = new Map<number, PlayerRating>();
  for (const player of pool) {
    const id = player.fcId;
    const worth = overallRaw.get(id) ?? null;
    const reading = (key: Exclude<RatingKey, 'overall' | 'pi'>): Rating => ({
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
    const worthOfOne = matchWorth(id, player);
    const points = worthOfOne.value;
    out.set(id, {
      overall: {
        raw: worth,
        score: ranked.overall.get(id) ?? null,
        weight: sureness.reduce((sum, one) => sum + one, 0) / sureness.length,
        // Due righe al massimo (`TOOLTIP_MAX`): il totale e i due fattori che lo fanno, così il numero si
        // può contestare invece di crederlo. La frase che spiega CHE COS'È sta sotto la tabella.
        note: worth == null || presence == null || points == null
          ? 'il motore non gli prevede presenze'
          : `${worth.toFixed(2)} fantapunti a giornata`
            + ` · ${Math.round(presence * 100)}% del calendario × ${points.toFixed(2)} a partita`
            // Quale delle due basi ha parlato: la FM attesa dal motore o - per chi il foglio non porta -
            // la sua carriera. Due basi sotto una colonna sola devono dirsi.
            + (worthOfOne.fromEngine ? '' : ' · su CARRIERA, il foglio non lo valuta'),
      },
      pi: {
        raw: piRaw.get(id) ?? null,
        score: ranked.pi.get(id) ?? null,
        weight: sureness.reduce((sum, one) => sum + one, 0) / sureness.length,
        note: piNote(id, expectedShare.get(id) ?? null, piRaw.get(id) ?? null, presence),
      },
      votes: reading('votes'),
      bonus: reading('bonus'),
      presence: reading('presence'),
      variance: varianceFor(player),
    });
  }
  return out;
}

/** What each column is called, and what its star actually says. Written once, drawn everywhere. */
export const RATING_LABEL: Record<RatingKey, string> = {
  overall: 'Overall',
  // Il nome è dell'operatore (19/08/2026): «Fπ», FantaPi, e `Fpi` dove l'encoding non regge.
  pi: 'Fπ',
  votes: 'Voti',
  // «Bonus» e basta (operatore, 16/08/2026): il malus è sottinteso, e la colonna lo dice già da sé -
  // per un portiere il numero è NEGATIVO, perché i gol che subisce sono la parte grossa di quel conto.
  bonus: 'Bonus',
  presence: 'Presenze',
};

export const RATING_HINT: Record<RatingKey, string> = {
  // La scala dichiarata sta nel DETTAGLIO qui sotto: in un hover non ci stava, e il test lo diceva.
  pi: 'Il rendimento PREVISTO: le presenze dell\'Overall, ma il valore di una partita letto dal '
    + 'calcio che ha davvero giocato, anche altrove.',
  overall:
    'FANTAPUNTI in tutto: giornate a voto attese × quanto vale una sua partita. Un totale, non un margine, '
    + 'e non il «Valore» dell\'asta.',
  votes:
    'MVa: la media voto che il MOTORE gli prevede. Posto su tutto il listone, portieri compresi.',
  bonus:
    'I BONUS attesi a presenza: fantamedia attesa meno media voto. Per un portiere è negativa: i gol che '
    + 'subisce. Posto su tutto il listone.',
  presence:
    'P: la quota di calendario a voto che il motore gli prevede. Numero nudo, senza sconti.',
};

/**
 * ...and the long version of each, for «Come si leggono queste colonne» under the table.
 *
 * Nothing is lost by keeping a tooltip to two lines: what a number rests on, what it deliberately does
 * NOT count and what it cost to get right belongs where it can be read twice, not in a hover.
 */
export const RATING_DETAIL: Record<RatingKey, string> = {
  pi: 'Dove il motore lo prezza, Fπ e Overall dicono la stessa cosa. Dove NON lo prezza, Overall scende '
    + 'sull\'ancora del ruolo («è un attaccante della Juve») mentre Fπ legge le sue partite vere altrove '
    + 'e le regredisce verso quell\'ancora con un coefficiente misurato fuori campione. La cella dice '
    + 'sempre su quante partite, perché dieci non sono una stagione. La scala è dichiarata e non un '
    + 'percentile: 0 non gioca, sotto 10 inutile, sotto 30 scarso, sotto 50 riserva, e 50 è la media '
    + 'dei primi 250 per Overall.',
  overall:
    'È il TOTALE che porta: le giornate a voto che il motore gli prevede per la stagione che viene, per '
    + 'quello che vale una sua partita nel punteggio della TUA lega (fantamedia attesa, con la porta '
    + 'inviolata dei portieri dentro). La formula è la sua, nella forma del 18/08/2026: '
    + '«partite a voto previste × (Media Voto attesa + Bonus attesi)», e le due colonne accanto sono '
    + 'esattamente quei due addendi: Voti è la MVa, Bonus è il tasso di bonus a presenza, e la loro '
    + 'somma è la fantamedia attesa. Fino al 17/08/2026 Bonus portava la fantamedia intera e la somma '
    + 'contava il voto due volte; dal 18/08/2026 si sommano davvero. '
    + 'E non sottrae nessun rimpiazzo: risponde a «quanti fantapunti mi porta», non a «quanti in più del '
    + 'suo sostituto», che è la domanda del Surplus. Per chi il foglio non valuta affatto parla la '
    + 'CARRIERA e la nota della cella lo dichiara. Il numero grezzo è nel tooltip; la colonna mostra il '
    + 'posto 0-99 su tutto il listone. '
    + 'DUE DIFFERENZE COL «VALORE» DEL PANNELLO ASTA, dichiarate invece che scoperte al tavolo (17/08/2026): '
    + 'quella colonna moltiplica per la CONFIDENZA della stima e questa no — sul listone di Serie A metà '
    + 'delle righe sono stimate con confidenza mediana 0,50, quindi Doekhi è 167° qui e 390° là — e questa '
    + 'aggiunge ai portieri la porta inviolata che la tua lega paga, mentre là il conto resta nel punteggio '
    + 'della fonte, che non la applica. Sono due domande («quanto vale» contro «quanto conviene comprarlo '
    + 'a questo tavolo») e nessuna delle due è sbagliata: quello che sarebbe sbagliato è non saperlo.',
  votes:
    'La MVa del foglio: la media voto che il motore gli prevede, non quella che ha fatto. Classificata su '
    + 'TUTTI i quotati (sua richiesta del 17/08/2026), e la conseguenza va detta: un portiere prende voti '
    + 'base più alti per mestiere, quindi in questa colonna i portieri stanno in cima per il ruolo prima '
    + 'che per il merito — mediane misurate per P/D/C/A: 87 / 36 / 45 / 55. Il ruolo è scritto sulla riga.',
  bonus:
    'I BONUS ATTESI A PRESENZA, e da soli: la fantamedia attesa meno la media voto attesa, cioè quanto il '
    + 'foglio si aspetta che aggiunga al suo voto ogni volta che gioca - o che gli levi, e per un portiere '
    + 'è negativa per costruzione, perché i gol che subisce sono la parte grossa di quel conto. Fino al '
    + '17/08/2026 questa colonna portava la FANTAMEDIA, voto compreso, e allora «Voti + Bonus» contava il '
    + 'voto due volte: cambiata sulla sua definizione del 18/08/2026, così la somma delle due colonne È il '
    + 'fattore dell Overall e non serve più avvertire di non sommarle. Classificata su tutti i quotati '
    + '(sua richiesta del 17/08/2026), quindi qui i portieri stanno in fondo.',
  presence:
    'La P del foglio: la quota di calendario a voto che il motore gli prevede (`engine_pv_pred`, o la '
    + 'stima dichiarata, e allora la stellina è sfumata). Dal 17/08/2026 è il numero NUDO: non è più '
    + 'corretta dai minuti che gioca quando gioca, né scontata dalla fragilità o da una nota dichiarata. '
    + 'Quelle tre cose restano al tavolo come MARCHI accanto al nome, dove si leggono in parole.',
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
