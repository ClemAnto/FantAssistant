/**
 * THE DRAFT ASSISTANT'S PITCH: a squad as it is being built, on a module, with every man somewhere.
 *
 * The operator's request of 28/09/2026: the positions start EMPTY, each pick goes where it can, the men with
 * the highest priority on the pitch, and whoever is not a starter is spread EVENLY over the places of his own
 * role, drawn under the starter as his reserve.
 *
 * It is `fanta-eleven.ts` with two differences, both declared:
 *   * a squad that fields nobody yet still has a MODULE - the first of the recommended ones - so the empty
 *     places are on screen from the first minute instead of a blank card;
 *   * the bench is not «the first alternative of each place» (a man there can be the ballottaggio of two
 *     places, which is a statement about ONE place) but a DISTRIBUTION: every reserve stands under exactly
 *     one place, and the places of a role fill up evenly.
 *
 * The eleven itself is the same matroid (`mantra-legal.bestEleven`), on the same weight the panel prices a
 * draft with - the VALUE - and nothing here predicts a footballer.
 */

import { MantraModules } from './auction-value';
import { DRAW_ORDER } from './club-eleven';
import type { FantaMan } from './fanta-eleven';
import { ModuleLine, Place, assign, bestEleven, placesIn } from './mantra-legal';

/**
 * The modules the operator plays towards on MANTRA, in the order he names them («il modulo di riferimento
 * parte da 4-2-3-1 e 4-1-4-1», `docs/model/priorita-draft-v1.md` §3). They are a PREFERENCE and not a
 * measurement: they decide the shape an empty squad is drawn on and who wins a TIE - with an incomplete
 * squad many shapes hold the same men, and a tie broken by the order of the rulebook's file would be an
 * accident. A module that fields a strictly better eleven still wins.
 */
export const RECOMMENDED_MANTRA = ['4-2-3-1', '4-1-4-1'] as const;

/**
 * The same preference on CLASSIC (the operator, 30/09/2026: «3-4-3 e 4-3-3»), the two shapes he had already
 * declared for the sealed bids - the 4-3-3 being the one of whoever plays with the defence modifier. Until then an
 * empty classic squad was drawn on whichever shape the suggestions filled best (a 5-4-1 on the bench of that day).
 */
export const RECOMMENDED_CLASSIC = ['3-4-3', '4-3-3'] as const;

/** The recommended modules of the table's game, in the order he names them: one reader for every caller. */
export function recommendedModules(mantra: boolean): readonly string[] {
  return mantra ? RECOMMENDED_MANTRA : RECOMMENDED_CLASSIC;
}

export interface DraftPlace {
  line: ModuleLine;
  /** The rulebook's own name for the place (`DC/B`, `A/PC`). */
  slot: string;
  /** The listone roles this place accepts, lowercase. */
  roles: string[];
  man: FantaMan | null;
  /** His role the place is filled with, as the listone spells it. */
  badge: string | null;
  /** The men standing under this place as its reserves, best first. */
  reserves: FantaMan[];
  /**
   * A SUGGESTED starter (`withSuggestions`): where the squad has nobody for this place yet, or - next to a real `man` -
   * a better starter than him, in which case the real man is drawn and counted as the first reserve.
   */
  suggested?: FantaMan | null;
  /** A SUGGESTED reserve, where the place has no reserve yet. */
  suggestedReserve?: FantaMan | null;
}

export interface DraftRow {
  line: ModuleLine;
  places: DraftPlace[];
}

export interface DraftPitch {
  module: string;
  /** True when the module is not one of the recommended ones: an automatic choice must say it moved. */
  offPlan: boolean;
  rows: DraftRow[];
  /** How many of the eleven places are filled. */
  placed: number;
  /** The squad's men no place of this module accepts: never dropped, listed apart. */
  unplaced: FantaMan[];
  /** The module's eleven worth, in fantapunti. */
  total: number;
}

/**
 * WHO STARTS (operator, 01/10/2026: «scegli come titolari quelli che danno un maggior contributo in fertilità e poi
 * distribuisci le riserve per copertura»): the man whose FERTILITY CONTRIBUTION is highest - his expected bonus per
 * appearance x the coverage he gives a place on his own (`coverOf`, capped at one place) - which is what the place
 * would yield with him as its starter.
 * The `STARTER_FLOOR` offset keeps every man with a share positive, so `bestEleven` (which maximises the SUM and drops a
 * weight <= 0) still fills as many places as it can before it compares fertility - a defender whose bonus is a malus
 * is a starter rather than an empty place. A man with an UNKNOWN bonus comes after every man with a known one (he is
 * placed, never preferred: «vuoto = ignoto»), and a man with no expected appearances or no value is not a starter.
 * THE KEEPER IS THE EXCEPTION, and the reason is arithmetic: his «bonus» is the malus of the goals conceded, so the
 * literal rule would start whoever PLAYS LEAST. A door starts the keeper who covers it most.
 */
export const STARTER_FLOOR = 10;

export function starterWeight(man: FantaMan): number | null {
  // A man the sheet cannot price is never a starter (he is drawn as a reserve), as before the rule changed.
  if (man.share == null || man.value == null) return null;
  const cover = Math.min(1, coverOf(man));
  if (man.roles.some((role) => role === 'por' || role === 'p')) return STARTER_FLOOR + cover;
  if (man.bonus == null) return STARTER_FLOOR / 2;
  return STARTER_FLOOR + cover * man.bonus;
}

/** The rulebook with the preferred modules FIRST, so a tie goes to them (`bestEleven` keeps the first). */
export function preferring(rules: MantraModules, preferred: readonly string[]): MantraModules {
  const names = Object.keys(rules.modules ?? {});
  const first = preferred.filter((name) => names.includes(name));
  const ordered: MantraModules['modules'] = {};
  for (const name of [...first, ...names.filter((name) => !first.includes(name))]) {
    ordered[name] = rules.modules[name];
  }
  return { ...rules, modules: ordered };
}

/**
 * The pitch of a squad on the best module, with its reserves spread.
 *
 * `forced` draws a module the operator chose instead of the best one. Returns null when there is no
 * rulebook to read - the card must say so rather than draw shapes nobody loaded.
 */
export function draftPitchOf(
  squad: readonly FantaMan[],
  rules: MantraModules | null,
  preferred: readonly string[] = [],
  forced: string | null = null,
  byCoverage = false,
): DraftPitch | null {
  if (!rules?.modules || !Object.keys(rules.modules).length) return null;
  const ordered = preferring(rules, forced ? [forced, ...preferred] : preferred);
  const scoped = forced && ordered.modules[forced]
    ? { ...ordered, modules: { [forced]: ordered.modules[forced] } }
    : ordered;
  const best = bestEleven(squad, scoped, starterWeight);
  const module = best?.module ?? Object.keys(scoped.modules)[0];
  const places: Place[] = best?.places ?? placesIn(scoped, module);
  const holders: (FantaMan | null)[] = best?.holders ?? places.map(() => null);

  const drawn: DraftPlace[] = places.map((place, at) => {
    const man = holders[at];
    return {
      line: place.line,
      slot: place.slot,
      roles: place.roles,
      man,
      badge: man ? badgeFor(man, place.roles) : null,
      reserves: [],
    };
  });

  const { unplaced } = spreadReserves(drawn, squad.filter((man) => !holders.includes(man)), byCoverage);

  const rows: DraftRow[] = [];
  for (const line of DRAW_ORDER) {
    const inLine = flanksOutside(drawn.filter((place) => place.line === line));
    if (inLine.length) rows.push({ line, places: inLine });
  }
  return {
    module,
    offPlan: preferred.length > 0 && !preferred.includes(module),
    rows,
    placed: drawn.filter((place) => place.man).length,
    unplaced,
    // The eleven's worth stays in FANTAPUNTI (the header prints it so): the starters are CHOSEN on fertility, but
    // what they are worth is still their value.
    total: holders.reduce((sum, man) => sum + (man?.value ?? 0), 0),
  };
}

/**
 * THE RESERVES, SPREAD EVENLY: each man, best first, goes under the place of his roles that has the FEWEST
 * reserves so far, and a tie goes to the place whose starter is weakest - that is where a reserve is most
 * likely to play. It mutates `places[*].reserves` and returns who fits nowhere.
 *
 * Evenly is the operator's word and it is the whole rule: it is not a substitution plan (the rulebook's
 * matrix decides who comes on, with its -1 out of role), it is where a man is DRAWN so that a glance tells
 * which places are covered twice and which not at all. A man with no value sorts last, never first.
 */
export function spreadReserves(
  places: DraftPlace[],
  bench: readonly FantaMan[],
  byCoverage = false,
): { unplaced: FantaMan[] } {
  const unplaced: FantaMan[] = [];
  const ordered = [...bench].sort(
    (left, right) => (right.value ?? -Infinity) - (left.value ?? -Infinity),
  );
  for (const man of ordered) {
    let target: DraftPlace | null = null;
    let targetGain = -1;
    for (const place of places) {
      if (!man.roles.some((role) => place.roles.includes(role))) continue;
      // CLASSIC (operator, 01/10/2026: «distribuisci i calciatori con lo stesso ruolo nelle varie posizioni per
      // ottimizzare la copertura»): the place where he adds the MOST coverage wins, and only a tie falls back on
      // the even spread below.
      const gain = byCoverage ? coverageGain(place, man) : 0;
      if (byCoverage && gain > targetGain + 1e-9) {
        target = place;
        targetGain = gain;
        continue;
      }
      if (byCoverage && gain < targetGain - 1e-9) continue;
      if (
        !target
        || place.reserves.length < target.reserves.length
        || (place.reserves.length === target.reserves.length
          && (place.man?.value ?? -Infinity) < (target.man?.value ?? -Infinity))
      ) {
        target = place;
      }
    }
    if (target) target.reserves.push(man);
    else unplaced.push(man);
  }
  return { unplaced };
}

/**
 * What a man contributes to the cover of the place he stands on: his expected appearances as a share of the
 * COMPETITION's rounds (operator, 01/10/2026: «e non su 38 della serie A») - the caller's business, because the
 * calendar is the sheet's: 33 rounds left on Serie A, 27 on EuroLeghe. Nothing here knows 38.
 * A MARGIN THAT GROWS ON THE SAFEST MEN (operator, 01/10/2026: «se la copertura personale supera l'80% lo
 * moltiplichiamo per un margine che aumenta da 0 fino a 0.1 all'aumentare della copertura (quindi un 100% diventa
 * 90%)», which replaces the same day's flat x 0.8, then no margin, then x 0.9 above 90%). Above `COVER_MARGIN_FROM`
 * the discount rises linearly from 0 to `COVER_MARGIN_MAX` at a full calendar: 80% -> 80%, 90% -> 85.5%,
 * 100% -> 90%. DECLARED. Unlike the x 0.9 above 90% it is MONOTONE (the slope is 1.4 - share, positive on [0, 1]),
 * so a man predicted to play more never covers less. The measurement it stands beside (expected-appearances bench,
 * 5 September, 7 Serie A seasons, 1,848 men): real over predicted reads 0.88-0.90 for men predicted over 70% and
 * 1.03-1.08 under 50%.
 */
export const COVER_MARGIN_FROM = 0.8;
export const COVER_MARGIN_MAX = 0.1;

export function coverOf(man: FantaMan | null | undefined): number {
  if (man?.share == null) return 0;
  if (man.share <= COVER_MARGIN_FROM) return man.share;
  const discount = (COVER_MARGIN_MAX * (man.share - COVER_MARGIN_FROM)) / (1 - COVER_MARGIN_FROM);
  return man.share * (1 - discount);
}

/**
 * A PLACE COVERED ENOUGH: the cut the pitch paints green from (operator, 29/09/2026: «rosso sotto metà calendario,
 * ambra sotto 85%, verde da 85%»), DECLARED. Under it the draft's diagnosis calls the place «scoperto»
 * (01/10/2026), so the pitch's colour and the plans' list of places to fix are one rule.
 */
export const COVER_OK = 0.85;

/** The men a place counts, in order: the starter, his reserves best first, then the suggestions where asked for. */
function menOf(place: DraftPlace, withSuggested: boolean): (FantaMan | null)[] {
  if (!withSuggested) return [place.man, ...place.reserves];
  // A suggested man on an OCCUPIED place is a better starter (`withSuggestions`): he starts and the holder is the
  // first reserve.
  const starters = place.suggested ? [place.suggested, place.man] : [place.man];
  return [...starters, ...place.reserves, place.suggestedReserve ?? null];
}

/** How much coverage `man` adds to `place` if he stands there too (`placeYield` with and without him). */
export function coverageGain(place: DraftPlace, man: FantaMan, withSuggested = false): number {
  const men = menOf(place, withSuggested);
  return combinedCover([...men, man]) - combinedCover(men);
}

/**
 * HOW MANY MATCHDAYS AT LEAST ONE OF THESE MEN GETS A VOTE (operator, 01/10/2026: «correggi come hai detto», replacing
 * the plain sum of the same morning). A reserve enters only when the starter has no vote, so what he adds is his share
 * of the matchdays the others leave uncovered - not his whole share: `1 - prod(1 - c)`, the men's absences read as
 * independent draws. 80% and 42% give 88.4%, not 122% -> 100%.
 * THE ONE EXCEPTION IS TWO KEEPERS OF ONE CLUB (operator, same day: «non è vero che uomini dello stesso club si
 * contendono una maglia sola se non sono portieri»): a club fields one keeper, so when one plays the other does not and
 * their covers ADD, capped at one place - the rule `keeperCovered` already applies. Two outfield men of one club can
 * both start, so they combine like any other two. A keeper is grouped on his REAL club (`coverClub`, a door's label is
 * «porta»); a keeper with no club on the row is his own group: two blanks are not evidence of one shirt.
 */
export function combinedCover(men: readonly (FantaMan | null | undefined)[]): number {
  const byClub = new Map<string, number>();
  for (const man of men) {
    if (!man || man.share == null) continue;
    const club = man.coverClub ?? man.club;
    const keeper = man.roles.some((role) => role === 'por' || role === 'p');
    const key = keeper && club ? `club:${club}` : `man:${man.id}`;
    byClub.set(key, (byClub.get(key) ?? 0) + coverOf(man));
  }
  let uncovered = 1;
  for (const cover of byClub.values()) uncovered *= 1 - Math.min(1, cover);
  return 1 - uncovered;
}

/**
 * WHAT A PLACE GIVES, from the men who stand on it (operator, 29/09/2026, coverage rewritten 01/10/2026 twice).
 *
 * COVERAGE is `combinedCover`: each man contributes his expected appearances over the season (`coverOf`, with its margin above 80%),
 * the men combine as independent absences, and only two keepers of one club ADD (one shirt). FERTILITY is each man's
 * expected bonus per appearance weighted by the coverage he actually ADDS, taken in order (the starter, then his
 * reserves best first): a reserve scores his bonus only on the matchdays the starter misses (a keeper of the same club
 * up to the cap). Only the REAL men count unless `withSuggested`: the suggestions are a
 * projection, drawn at 30%.
 * A man who contributes with an UNKNOWN bonus makes the place's fertility unknown («vuoto = ignoto, mai zero»).
 */
export function placeYield(place: DraftPlace, withSuggested = false): { cover: number; fertility: number | null } {
  const counted: FantaMan[] = [];
  let cover = 0;
  let fertility: number | null = null;
  let unknown = false;
  for (const man of menOf(place, withSuggested)) {
    if (!man || man.share == null) continue;
    counted.push(man);
    const now = combinedCover(counted);
    const adds = now - cover;
    if (adds <= 1e-12) continue;
    cover = now;
    if (man.bonus == null) unknown = true;
    else fertility = (fertility ?? 0) + adds * man.bonus;
  }
  return { cover, fertility: unknown ? null : fertility };
}

/**
 * THE WHOLE PITCH's coverage and fertility: the sums over its places (`placeYield`). Coverage is in PLACES - 0.85 is
 * one place covered at 85% - so the difference between two pitches is how much of the eleven a plan adds.
 */
export function pitchYield(pitch: DraftPitch, withSuggested = false): { cover: number; fertility: number } {
  let cover = 0;
  let fertility = 0;
  for (const place of pitch.rows.flatMap((row) => row.places)) {
    const one = placeYield(place, withSuggested);
    cover += one.cover;
    fertility += one.fertility ?? 0;
  }
  return { cover, fertility };
}

/** The one role of his the place is filled with, spelled the way the listone spells it. */
function badgeFor(man: FantaMan, roles: string[]): string | null {
  const at = man.roles.findIndex((role) => roles.includes(role));
  return at < 0 ? null : (man.shown[at] ?? man.roles[at]);
}


/**
 * THE SUGGESTIONS ON THE PITCH (operator, 29/09/2026: «suggerisci un titolare ed una riserva per ogni
 * ruolo, con opacità 0.3»), filled in only where the REAL squad leaves a gap: a real man is never pushed
 * off his place by a projected one. First the empty places get a starter - a maximum matching, best
 * projected man first, so the suggestions cover as many places as they can - then the places with no
 * reserve get one from whoever is left. Mutates the places and returns the pitch.
 */
export function withSuggestions(pitch: DraftPitch, projected: readonly FantaMan[]): DraftPitch {
  const places = pitch.rows.flatMap((row) => row.places);
  // ONE MAN, ONE PLACE (operator, 29/09/2026): a projected man already on the pitch, or projected twice, is drawn once.
  const onPitch = new Set(places.flatMap((place) => [place.man, ...place.reserves]).filter((m): m is FantaMan => !!m)
    .map((man) => man.id));
  const seen = new Set<number>();
  const ranked = [...projected]
    .filter((man) => !onPitch.has(man.id) && !seen.has(man.id) && (seen.add(man.id), true))
    // The same order the real starters are chosen on (`starterWeight`): a suggestion is a projected starter too.
    .sort((a, b) => (starterWeight(b) ?? -Infinity) - (starterWeight(a) ?? -Infinity));
  const empty = places.filter((place) => !place.man);
  const starters = assign(ranked, empty.map((place) => place.roles));
  empty.forEach((place, at) => {
    place.suggested = starters.holder[at] >= 0 ? starters.chosen[starters.holder[at]] : null;
  });
  const used = new Set(starters.chosen);
  // THE OTHERS GO WHERE THEY ADD MOST (01/10/2026), one place each, best projected man first. On a place he fits he
  // either STARTS - where his `starterWeight` beats the holder's, the holder becoming the first reserve (operator:
  // «se un calciatore prende il posto di un titolare, devi ricalcolare il contributo alla fertilità che si perde del
  // giocatore sostituito che diventa quindi riserva», and «allinea piani e campo») - or joins as the suggested reserve.
  // The place is the one where he adds the most FERTILITY, coverage on a tie; a keeper, or a man whose bonus is
  // unknown, on coverage (a keeper's «bonus» is the malus of the goals conceded). A man who adds nothing is not drawn.
  for (const man of ranked.filter((one) => !used.has(one))) {
    const byCover = man.bonus == null || man.roles.some((role) => role === 'por' || role === 'p');
    let target: { place: DraftPlace; starts: boolean; cover: number; fertility: number } | null = null;
    for (const place of places) {
      if (!man.roles.some((role) => place.roles.includes(role))) continue;
      const holder = place.man ?? place.suggested ?? null;
      const starts = !!place.man && !place.suggested
        && (starterWeight(man) ?? -Infinity) > (starterWeight(place.man) ?? -Infinity);
      if (!starts && (place.suggestedReserve || !holder)) continue;
      const trial: DraftPlace = starts ? { ...place, suggested: man } : { ...place, suggestedReserve: man };
      const was = placeYield(place, true);
      const now = placeYield(trial, true);
      const one = { place, starts, cover: now.cover - was.cover, fertility: (now.fertility ?? 0) - (was.fertility ?? 0) };
      if (one.cover <= 1e-9 && Math.abs(one.fertility) <= 1e-9) continue;
      const key = (y: typeof one) => (byCover ? [y.cover, y.fertility] : [y.fertility, y.cover]);
      if (!target || better(target, one, key) === one) target = one;
    }
    if (!target) continue;
    if (target.starts) target.place.suggested = man;
    else target.place.suggestedReserve = man;
  }
  for (const place of places) place.suggestedReserve ??= null;
  return pitch;
}


/**
 * THE WIDE PLACES ON THE OUTSIDE of their line (operator, 29/09/2026: «E/W devono stare all'esterno»). The
 * rulebook writes some lines with the wide places LAST (`3-5-1-1`: M, M, C, E/W, E/W), which drawn as they
 * come puts both wings on one side. A sided place keeps its side - `Dd` on the left of the drawing and `Ds`
 * on the right, which is the order the rulebook itself gives a back four (the team's right to its left) -
 * an unsided wide place (`E`, `W`, `E/W`) goes to whichever end has fewer, and the central ones stay in the
 * middle in the rulebook's order.
 */
export function flanksOutside(places: DraftPlace[]): DraftPlace[] {
  const side = (place: DraftPlace): 'right' | 'left' | 'wide' | 'centre' => {
    const roles = place.roles;
    if (roles.includes('dd')) return 'right';
    if (roles.includes('ds')) return 'left';
    if (roles.some((role) => role === 'e' || role === 'w')) return 'wide';
    return 'centre';
  };
  const right = places.filter((place) => side(place) === 'right');
  const left = places.filter((place) => side(place) === 'left');
  for (const place of places.filter((one) => side(one) === 'wide')) {
    (right.length <= left.length ? right : left).push(place);
  }
  const centre = places.filter((place) => side(place) === 'centre');
  // The right-hand group reads outside-in from the left edge; the left-hand group outside-in from the right.
  return [...right, ...centre, ...left.reverse()];
}

/**
 * WHAT ONE MAN ADDS to a squad's pitch (operator, 01/10/2026: «una nuova colonna che indichi per ogni calciatore di
 * quanto aumenta la rosa in copertura e fertilità»): the place's yield with him minus without (`placeYield`), on the
 * ONE place he would stand on.
 * It is the pitch with him as a SUGGESTION minus the pitch without, the same `withSuggestions` + `placeYield` the
 * pitch draws and the plans' increments read (`planYields`), so the column, the pitch and the plans cannot disagree
 * about one pick (operator, 01/10/2026: «allinea piani e campo»). So he takes an EMPTY place first, and otherwise the
 * place where he adds most - STARTING where he is the better starter, the holder re-weighed as the first reserve.
 * Coverage in places (0.8 = one place covered at 80%); fertility in bonus points per matchday, null when the man's
 * own bonus is unknown and he covers something («vuoto = ignoto»). `pitch` is not touched: the places are copied.
 */
export function addedYield(pitch: DraftPitch, man: FantaMan): { cover: number; fertility: number | null } {
  const copy: DraftPitch = {
    ...pitch,
    rows: pitch.rows.map((row) => ({ ...row, places: row.places.map((one) => ({ ...one })) })),
  };
  withSuggestions(copy, [man]);
  const before = pitch.rows.flatMap((row) => row.places);
  const after = copy.rows.flatMap((row) => row.places);
  let cover = 0;
  let fertility = 0;
  for (let at = 0; at < after.length; at++) {
    const was = placeYield(before[at], true);
    const now = placeYield(after[at], true);
    cover += now.cover - was.cover;
    fertility += (now.fertility ?? 0) - (was.fertility ?? 0);
  }
  return { cover, fertility: man.bonus == null && cover > 1e-9 ? null : fertility };
}

/** The better of two candidate places on `key`, first component then second, with a tolerance; ties keep `a`. */
function better<T>(a: T, b: T, key: (y: T) => number[]): T {
  const [a1, a2] = key(a);
  const [b1, b2] = key(b);
  if (b1 > a1 + 1e-9) return b;
  if (b1 < a1 - 1e-9) return a;
  return b2 > a2 + 1e-9 ? b : a;
}
