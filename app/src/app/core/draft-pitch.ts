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
  /** A SUGGESTED starter, where the squad has nobody for this place yet (`withSuggestions`). */
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
 * THE SHARE OF A MAN'S EXPECTED APPEARANCES THAT COUNTS AS COVER (operator, 01/10/2026: «un calciatore che gioca 38
 * partite contribuisce alla copertura per 38/38 * 0.8 (togliamo un 20% per eventuali defezioni)»). DECLARED, not
 * measured: the expected appearances already discount the injuries the sheet knows of, so this is a margin on top.
 */
export const COVER_AVAILABILITY = 0.8;

/**
 * What a man contributes to the cover of the place he stands on, before the cap at one place. `share` is his expected
 * appearances over the COMPETITION's rounds (operator, 01/10/2026: «e non su 38 della serie A») - the caller's
 * business, because the calendar is the sheet's: 33 rounds left on Serie A, 27 on EuroLeghe. Nothing here knows 38.
 */
export function coverOf(man: FantaMan | null | undefined): number {
  return man?.share == null ? 0 : man.share * COVER_AVAILABILITY;
}

/** The men a place counts, in order: the starter, his reserves best first, then the suggestions where asked for. */
function menOf(place: DraftPlace, withSuggested: boolean): (FantaMan | null)[] {
  return withSuggested
    ? [place.man ?? place.suggested ?? null, ...place.reserves, place.suggestedReserve ?? null]
    : [place.man, ...place.reserves];
}

/** How much coverage `man` adds to `place` if he stands there too (`placeYield` with and without him). */
export function coverageGain(place: DraftPlace, man: FantaMan, withSuggested = false): number {
  const now = placeYield(place, withSuggested).cover;
  return Math.min(1, now + coverOf(man)) - now;
}

/**
 * WHAT A PLACE GIVES, from the men who stand on it (operator, 29/09/2026, coverage rewritten 01/10/2026).
 *
 * COVERAGE is the SUM of what each man contributes - his expected appearances over the season x `COVER_AVAILABILITY`
 * - CAPPED at one place: a man of 38 expected appearances gives 80%, one of 20 gives 42%, both on one place 122%
 * -> 100%. FERTILITY is each man's expected bonus per appearance weighted by the part of that coverage he actually
 * contributes, taken in order (the starter, then his reserves best first), so the cap cuts the last man's bonus and
 * not the starter's. Only the REAL men count unless `withSuggested`: the suggestions are a projection, drawn at 30%.
 * A man who contributes with an UNKNOWN bonus makes the place's fertility unknown («vuoto = ignoto, mai zero»).
 */
export function placeYield(place: DraftPlace, withSuggested = false): { cover: number; fertility: number | null } {
  let cover = 0;
  let fertility: number | null = null;
  let unknown = false;
  for (const man of menOf(place, withSuggested)) {
    if (!man || man.share == null) continue;
    const adds = Math.min(1 - cover, coverOf(man));
    if (adds <= 0) continue;
    cover += adds;
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
  // THE RESERVES GO WHERE THEY ADD MOST COVERAGE (01/10/2026, with the new coverage): best projected man first, to
  // the place of his roles - with no suggested reserve yet - whose cover he raises the most. A place already full
  // takes nobody, and a man who adds nothing anywhere is not drawn.
  for (const man of ranked.filter((one) => !used.has(one))) {
    let target: DraftPlace | null = null;
    let best = 1e-9;
    for (const place of places) {
      if (place.suggestedReserve || !man.roles.some((role) => place.roles.includes(role))) continue;
      const gain = coverageGain(place, man, true);
      if (gain > best) {
        target = place;
        best = gain;
      }
    }
    if (target) target.suggestedReserve = man;
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
 * quanto aumenta la rosa in copertura e fertilità»): the pitch with him as a SUGGESTION minus the pitch without, the
 * same `withSuggestions` + `placeYield` a plan's increments read (`planYields`), so the column and the solutions
 * cannot disagree about the same pick. The rule that comes with it is the pitch's own: a real man is never pushed off
 * his place, so a man adds where a place is EMPTY (as its starter) or has NO reserve yet (as its reserve) - a third
 * option behind a starter and a reserve adds nothing, and that is the reading and not a defect.
 * Coverage in places (0.8 = one place covered at 80%); fertility in bonus points per matchday, null when the man's
 * own bonus is unknown and he covers something («vuoto = ignoto»: summing without him would read his matchdays at
 * zero bonus). `pitch` is not touched: the places are copied before the suggestion is written on them.
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
    const was = placeYield(before[at]);
    const now = placeYield(after[at], true);
    cover += now.cover - was.cover;
    fertility += (now.fertility ?? 0) - (was.fertility ?? 0);
  }
  return { cover, fertility: man.bonus == null && cover > 1e-9 ? null : fertility };
}
