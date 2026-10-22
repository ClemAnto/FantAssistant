/**
 * THE SCOUT'S PITCH (operator, 22/10/2026: «a sinistra ci deve essere il campetto con la mia formazione ideale:
 * riprendiamo lo stesso principio del campetto dell'assistente al draft con le zone, le posizioni, la % di copertura e
 * la fertilità. Cliccando su una zona/posizione nella parte destra devono comparire gli obiettivi (calciatori) delle
 * altre squadre che possono migliorare quella zona/posizione»).
 *
 * The pitch IS the draft's (`draft-pitch.draftPitchOf`, `placeYield`): the same eleven, the same reserves spread
 * under their places, the same coverage and fertility. What is different is only where a man's two numbers come from,
 * because the Scout has no draft session behind it:
 *   - SHARE = his expected appearances (`ExpectedPlay`, as every page) over the season's rounds;
 *   - BONUS (fertility per appearance) = his fantamedia above the 6 an outfield man is read against without a draft
 *     context (`swing.EDGE_BASE`, the draft's own fallback), and for a keeper his fantamedia above the AVERAGE STARTING
 *     KEEPER of the listone (the draft's «keeper zero», 01/10/2026), so a strong door is positive and a weak one negative.
 * The draft's league modifiers (steadiness, clean sheet) and its bench-appearance discount are NOT here: declared, and
 * the first thing to add if the two pitches are ever compared side by side.
 *
 * A TARGET is a man of another squad who, put on the chosen place, raises what it gives: with him the place's points a
 * matchday (`placePoints`) go up. He starts where he is the better starter (`starterWeight`, the draft's rule) - the
 * holder then counts as the first reserve - and otherwise stands as one more reserve. Nothing here is a trade: what
 * the other squad loses, and what we pay him with, is the plan that comes next.
 */
import { DraftPitch, DraftPlace, placeYield, starterWeight } from './draft-pitch';
import { FantaMan } from './fanta-eleven';
import { EDGE_BASE } from './plancia';
import { ScoutMan } from './scout';

/** A man of the Scout as the draft pitch draws him. `keeperZero` is the average starting keeper's fantamedia. */
export function fantaManOf(man: ScoutMan, rounds: number, keeperZero: number): FantaMan {
  const keeper = isKeeperMan(man);
  return {
    id: man.id,
    name: man.name,
    club: man.club,
    coverClub: man.club,
    shown: man.shown,
    roles: man.roles,
    value: man.fm == null || man.pv == null ? null : man.fm * man.pv,
    value99: null,
    cost: man.fvm ?? 0,
    minutesPerMatch: null,
    share: man.pv == null || rounds <= 0 ? null : Math.min(1, Math.max(0, man.pv / rounds)),
    bonus: man.fm == null ? null : man.fm - (keeper ? keeperZero : EDGE_BASE),
  };
}

export function isKeeperMan(man: { roles: readonly string[] }): boolean {
  return man.roles.some((role) => role === 'por' || role === 'p');
}

function isDoor(place: DraftPlace): boolean {
  return place.roles.some((role) => role === 'por' || role === 'p');
}

/**
 * THE AVERAGE STARTING KEEPER's fantamedia: per club, the keeper with the most expected appearances, then the mean of
 * their fantamedia. `keepers` is every priced keeper of the listone.
 */
export function keeperZeroOf(keepers: readonly { club: string; fm: number | null; pv: number | null }[]): number {
  const first = new Map<string, { fm: number; pv: number }>();
  for (const one of keepers) {
    if (one.fm == null) continue;
    const pv = one.pv ?? 0;
    const best = first.get(one.club);
    if (!best || pv > best.pv) first.set(one.club, { fm: one.fm, pv });
  }
  const values = [...first.values()].map((one) => one.fm);
  return values.length ? values.reduce((sum, one) => sum + one, 0) / values.length : EDGE_BASE - 1;
}

/**
 * WHAT A PLACE SCORES A MATCHDAY, in fantapunti: the draft pitch's «a partita» per place - a base of 6 on the matchdays
 * it is covered (the average starting keeper's fantamedia for the door, against which its fertility is read) plus its
 * fertility. A place whose bonus is unknown counts its base only.
 */
export function placePoints(place: DraftPlace, keeperZero: number, withSuggested = false): number {
  const { cover, fertility } = placeYield(place, withSuggested, 0);
  return cover * (isDoor(place) ? keeperZero : EDGE_BASE) + (fertility ?? 0);
}

/**
 * WHERE A MAN STANDS IN A SQUAD (operator, 23/10/2026: «panchina/titolare/riserva nella nostra rosa e nella rosa
 * dell'altro»), read off that squad's draft pitch: TITOLARE holds a place, RISERVA is the FIRST reserve of a place (the
 * one who plays when the starter has no vote), PANCHINA is any reserve behind him or a man no place of the module takes.
 */
export type Standing = 'titolare' | 'riserva' | 'panchina';

export function standingsOf(pitch: DraftPitch | null): Map<number, Standing> {
  const out = new Map<number, Standing>();
  if (!pitch) return out;
  for (const place of placesOf(pitch)) {
    if (place.man) out.set(place.man.id, 'titolare');
    place.reserves.forEach((man, at) => out.set(man.id, at === 0 ? 'riserva' : 'panchina'));
  }
  for (const man of pitch.unplaced) out.set(man.id, 'panchina');
  return out;
}

export interface PlaceTarget {
  man: FantaMan;
  /** The squad he plays for. */
  rival: string;
  /** Where he stands in that squad (`standingsOf` on its pitch): a starter costs them more to let go. */
  theirs: Standing | null;
  /** Where he would stand in OURS on this place: starting (the holder becoming the first reserve), its first reserve, or behind. */
  ours: Standing;
  /** What the place gains with him: coverage (share of the calendar), fertility and points a matchday. */
  cover: number;
  fertility: number | null;
  points: number;
}

/** Below this a target improves nothing worth a line (points a matchday). */
export const TARGET_MIN_POINTS = 0.01;

/**
 * THE TARGETS OF ONE PLACE: every man of the other squads who can stand there and raises its points a matchday, best
 * first. `starters` says who is in each rival's best eleven.
 */
export function placeTargets(
  place: DraftPlace,
  rivals: readonly { name: string; men: readonly FantaMan[]; standing: ReadonlyMap<number, Standing> }[],
  keeperZero: number,
): PlaceTarget[] {
  const before = placeYield(place, false, 0);
  const pointsBefore = placePoints(place, keeperZero);
  const out: PlaceTarget[] = [];
  for (const rival of rivals) {
    for (const man of rival.men) {
      if (man.share == null || !man.roles.some((role) => place.roles.includes(role))) continue;
      const starts = !place.man || (starterWeight(man) ?? -Infinity) > (starterWeight(place.man) ?? -Infinity);
      const trial: DraftPlace = starts ? { ...place, suggested: man } : { ...place, suggestedReserve: man };
      const points = placePoints(trial, keeperZero, true) - pointsBefore;
      if (points < TARGET_MIN_POINTS) continue;
      const after = placeYield(trial, true, 0);
      const first = place.reserves[0];
      const ours: Standing = starts ? 'titolare'
        : !first || (starterWeight(man) ?? -Infinity) > (starterWeight(first) ?? -Infinity) ? 'riserva' : 'panchina';
      out.push({
        man,
        rival: rival.name,
        theirs: rival.standing.get(man.id) ?? null,
        ours,
        cover: after.cover - before.cover,
        // An unknown bonus makes the place's fertility unknown («vuoto = ignoto»), so the gain is unknown too.
        fertility: after.fertility == null ? null : after.fertility - (before.fertility ?? 0),
        points,
      });
    }
  }
  return out.sort((a, b) => b.points - a.points);
}

/** The places of a pitch in drawing order, so a click can name one by its index. */
export function placesOf(pitch: DraftPitch | null): DraftPlace[] {
  return pitch ? pitch.rows.flatMap((row) => row.places) : [];
}
