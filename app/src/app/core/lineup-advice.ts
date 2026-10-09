/**
 * THE ADVISED LINEUP, FIRST CUT (operator, 08/10/2026: «nella pagina della formazione consigliata ... un campo
 * che mostra i calciatori schierati e sotto una griglia con quelli in panchina»).
 *
 * WHAT THIS IS AND WHAT IT IS NOT. A lineup is a question about the RULEBOOK (which legal module lets these men
 * on the pitch) asked with a WEIGHT per man, and the weight is the one quantity this file owns: the points he
 * is expected to bring THIS matchday,
 *
 *     points = his FVA (`fva.ts`), null for a man Leghe marks out (unavailable, suspended, not called).
 *
 * Until 09/10/2026 it was P(vote) x FVA (and the sheet's FMa before that). The operator, that day: «il modulo
 * migliore è semplicemente la somma dei singoli FVA (non pensare alla probabilità di prendere il voto)». The
 * price of the rule, stated: a man Leghe gives at 5% with a good FVA can now be fielded over a regular starter -
 * the VOTO column still shows that chance, and choosing is the operator's.
 *
 * P(vote) is read from the platform's probable-starter percentage with the curve measured in
 * `rosa-3-giornate-v1.md` §2 (932 out-of-sample observations, matchdays 1-2 of 2026-27). That curve is on
 * record as «da rimisurare» and this is NOT the advice `formazione-leghe-v1.md` §4 describes: it ignores the
 * automatic substitutions, the modifiers, the press consensus and the opponent. It is the floor the page draws
 * until the bench (`formazione-leghe-v1.md` §5 item 3) can judge something better - stated on the page, so a
 * reader does not take a first cut for the engine.
 *
 * Legality is the rulebook's, never ours: the same matroid the draft uses (`mantra-legal.ts`), restricted to
 * the modules the LEAGUE allows (Leghe's own `mods`), on `classic_modules.json` or `mantra_modules.json`.
 */

import { MantraModules } from './auction-value';
import { DRAW_ORDER, PitchLine } from './club-eleven';
import { Place, Placeable, assign, bestEleven, placesIn } from './mantra-legal';
import { BenchRule, LegheGame } from './leghe-rules';

/**
 * P(vote) against the editorial starter probability, `rosa-3-giornate-v1.md` §2: bucket centres and the share
 * of men who then got a vote. Linear between centres, flat beyond the two ends - outside them nothing was
 * measured, and extending the line would be inventing the tails.
 */
export const VOTE_CURVE: readonly (readonly [number, number])[] = [
  [0.05, 0.013],
  [0.2, 0.141],
  [0.375, 0.374],
  [0.51, 0.643],
  [0.64, 0.713],
  [0.775, 0.791],
  [0.93, 0.952],
];

/** A man the probable-lineups page does not list at all: measured on the same population, not a zero. */
export const VOTE_IF_UNLISTED = 0.063;

/**
 * BELOW THIS CHANCE OF A VOTE A MAN IS NOT FIELDED (operator, 09/10/2026: «togliamo dal campo i giocatori < 15%
 * come Lienard»). The eleven is chosen on the FVA alone, which is «what he scores IF he plays» - so a third keeper
 * at 1% with a decent FVA was taking the place. The bench still has him, in FVA order: a place on the bench is
 * cheap. A declared threshold on the chance the page SHOWS (`voteChance`), not a measured one.
 */
export const MIN_CHANCE_ON_PITCH = 0.15;

/** What a man weighs when the ELEVEN is chosen: his points, or nothing under the floor. One rule for the pitch
 *  and for the module menu's totals, so the two cannot disagree about who can stand on the pitch. */
export function fieldWeight(man: LineupMan): number | null {
  return man.chance >= MIN_CHANCE_ON_PITCH ? man.points : null;
}

/** Leghe's own flag that he cannot play this matchday. */
export type OutFlag = 'unavailable' | 'suspended' | 'not-called' | null;

/** `percent` is Leghe's 0-100. Out = no vote, whatever the percentage says. */
export function voteChance(percent: number | null, out: OutFlag): number {
  if (out) return 0;
  if (percent === null) return VOTE_IF_UNLISTED;
  const p = Math.max(0, Math.min(1, percent / 100));
  const first = VOTE_CURVE[0];
  const last = VOTE_CURVE[VOTE_CURVE.length - 1];
  if (p <= first[0]) return first[1];
  if (p >= last[0]) return last[1];
  for (let i = 1; i < VOTE_CURVE.length; i++) {
    const [x1, y1] = VOTE_CURVE[i];
    if (p <= x1) {
      const [x0, y0] = VOTE_CURVE[i - 1];
      return y0 + ((p - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

/** One man of the roster, priced for this matchday. */
export interface LineupMan extends Placeable {
  id: number;
  name: string;
  /** Lowercase listone codes (`roles`) and the same codes as shown (`shown`). */
  shown: string[];
  chance: number;
  /** Expected fantavoto; null = nobody can price him, and then he is never fielded (unknown, not zero). */
  fm: number | null;
  /**
   * The weight the eleven is chosen on: the FVA (`fva.ts`) since 09/10/2026, evening; `chance x FVA` and
   * `chance x fm` before. Null = nobody can price him, or Leghe marks him out: then he is never fielded.
   */
  points: number | null;
  /** The FVA shown beside the name: the expected fantavoto IF he plays. Absent = the caller did not price it. */
  fva?: number | null;
}

export interface LineupPlace {
  line: PitchLine;
  /** The rulebook's name for the place (`D`, `DC/B`). */
  slot: string;
  man: LineupMan | null;
}

export interface LineupRow {
  line: PitchLine;
  places: LineupPlace[];
}

export interface LineupPlan {
  module: string;
  rows: LineupRow[];
  /** Expected points of the eleven: the sum of the men placed. */
  total: number;
  placed: number;
  /** In bench order: first in, first out. */
  bench: LineupMan[];
  /** Left out of both: past the bench's size, or unpriced. */
  outside: LineupMan[];
  /** Every allowed module's worth, best first: why the winner won, and by how much. */
  scores: { module: string; total: number; placed: number }[];
  /** How many starters have their own cover on the bench (`coverOrder`); absent on a lineup drawn as sent. */
  cover?: LineupCover;
}

/** The bench's promise: every starter with a distinct substitute who plays, or the names of those without one. */
export interface LineupCover {
  starters: number;
  covered: number;
  open: string[];
}

/** Leghe writes `343`, the rulebooks `3-4-3`. */
export function rulebookName(code: string): string {
  return /^\d+$/.test(code) ? code.split('').join('-') : code;
}

/**
 * The rulebook restricted to what the league allows. A league that allows nothing we can read keeps the whole
 * rulebook - an empty module list is «not read», never «no module is legal».
 */
export function allowedRules(rules: MantraModules, allowed: readonly string[]): MantraModules {
  const names = new Set(allowed.map(rulebookName));
  const kept = Object.fromEntries(Object.entries(rules.modules).filter(([name]) => names.has(name)));
  return Object.keys(kept).length ? { ...rules, modules: kept } : rules;
}

const byPoints = (a: LineupMan, b: LineupMan) =>
  (b.points ?? -Infinity) - (a.points ?? -Infinity) || a.name.localeCompare(b.name);

function rowsOf(places: ReturnType<typeof placesIn>, holders: (LineupMan | null)[]): LineupRow[] {
  const rows: LineupRow[] = [];
  for (const line of DRAW_ORDER) {
    const inLine: LineupPlace[] = [];
    places.forEach((place, at) => {
      if (place.line === line) inLine.push({ line, slot: place.slot, man: holders[at] ?? null });
    });
    if (inLine.length) rows.push({ line, places: toTheFlanks(inLine) });
  }
  return rows;
}

/**
 * A slot that offers a WIDE role (`E`, `W`): `E/W`, `W/A`, `W/T`. It has no side of its own, but a flank. Until
 * 09/10/2026 every option had to be wide, so `W/A` stayed where the rulebook writes it and the 3-4-3 drew its
 * front three as `W/A, W/A, A/PC`, the centre-forward on a touchline (operator: «le W devono stare ai lati, la Pc
 * al centro»). No rulebook slot offers both a wide role and a `PC`, so the centre-forward is never sent out.
 */
function isWideSlot(slot: string): boolean {
  return slot.split('/').some((code) => code === 'E' || code === 'W');
}

/**
 * THE WIDE PLACES GO TO THE TOUCHLINES (operator, 09/10/2026: «E/W e W devono essere ai lati del campo e non
 * centrali», then «le W devono stare ai lati, la Pc al centro»). The rulebook writes some lines in no side
 * order (`4-1-4-1` has `C/T, T, E/W, W`, the 3-4-3 `W/A, W/A, A/PC`), so the drawing moves the wide slots to
 * the two ends, alternating, and keeps the central ones - the `PC` among them - in the rulebook's order between
 * them. Sided slots (`DD`, `DS`) are not touched: their order already is the side.
 */
export function toTheFlanks(row: LineupPlace[]): LineupPlace[] {
  const wide = row.filter((place) => isWideSlot(place.slot));
  if (!wide.length || wide.length === row.length) return row;
  const left: LineupPlace[] = [];
  const right: LineupPlace[] = [];
  wide.forEach((place, at) => (at % 2 === 0 ? left.push(place) : right.unshift(place)));
  if (wide.length === 1) return [...row.filter((place) => !isWideSlot(place.slot)), ...left];
  return [...left, ...row.filter((place) => !isWideSlot(place.slot)), ...right];
}

/** The role a man counts as on a classic bench (`P`/`D`/`C`/`A`), or `Por` vs outfield on mantra. */
function benchGroup(man: LineupMan, game: LegheGame | null): number {
  if (game === 'mantra') return man.roles.includes('por') ? 0 : 1;
  const at = ['p', 'd', 'c', 'a'].indexOf(man.roles[0] ?? '');
  return at < 0 ? 4 : at;
}

/** A starter and the place he holds: what a bench has to be able to replace. */
export interface Starter {
  place: Place;
  man: LineupMan;
}

/**
 * CAN `sub` TAKE THE PLACE `starter` LEAVES? Classic: the same role, which is what every substitution kind can
 * always do. Mantra: a role the place itself accepts (no malus), or what the official matrix allows from the role
 * the starter held there - with the out-of-position malus too, because a malus of one point is not a hole. The
 * footnotes read as the file states them: `*` only «in alternativa» (i.e. the place already accepts the role,
 * handled above), `**` always (OK or -1), `***` everywhere but in the 4-1-4-1.
 */
export function canCover(
  sub: LineupMan,
  starter: Starter,
  game: LegheGame | null,
  rules: MantraModules,
  module: string,
): boolean {
  if (game !== 'mantra') return !!sub.roles[0] && sub.roles[0] === starter.man.roles[0];
  if (sub.roles.some((role) => starter.place.roles.includes(role))) return true;
  const matrix = rules.substitution?.matrix;
  if (!matrix) return false;
  const lower = (row: Record<string, string>) => new Map(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
  const out = starter.man.roles.find((role) => starter.place.roles.includes(role)) ?? starter.man.roles[0];
  const rowKey = Object.keys(matrix).find((key) => key.toLowerCase() === out);
  if (!rowKey) return false;
  const row = lower(matrix[rowKey]);
  return sub.roles.some((role) => {
    const verdict = row.get(role);
    return verdict === 'OK' || verdict === '-1' || verdict === '**' || (verdict === '***' && module !== '4-1-4-1');
  });
}

/**
 * THE MEN WHO MAKE A HOLE IMPOSSIBLE, in the order to put them on the bench (operator, 09/10/2026: «la panchina
 * deve essere impostata in maniera da essere CERTI che non ci siano buchi nel caso ci sia qualche infortunio
 * all'ultimo»).
 *
 * Every starter gets his OWN cover - a distinct man, so two injuries in one department are two substitutions and
 * not one - and only a man who will play himself counts (chance >= `MIN_CHANCE_ON_PITCH`: a third keeper at 1% is
 * no cover). Rounds over the lines, keeper first: one cover per line per round, so the first injury of every
 * department is covered before the second of any; inside a line the starter with the fewest possible covers goes
 * first, and he gets the man most likely to play (then the best FVA). A starter nobody in the roster can replace
 * stays uncovered, and the caller counts him.
 */
export function coverOrder(
  starters: readonly Starter[],
  rest: readonly LineupMan[],
  game: LegheGame | null,
  rules: MantraModules,
  module: string,
): { covers: LineupMan[]; coveredBy: Map<number, LineupMan> } {
  const candidates = rest.filter((man) => man.chance >= MIN_CHANCE_ON_PITCH);
  const used = new Set<number>();
  const coveredBy = new Map<number, LineupMan>();
  const covers: LineupMan[] = [];
  const better = (a: LineupMan, b: LineupMan) => b.chance - a.chance || byPoints(a, b);
  for (let progress = true; progress; ) {
    progress = false;
    for (const line of DRAW_ORDER) {
      const open = starters
        .filter((one) => one.place.line === line && !coveredBy.has(one.man.id))
        .map((one) => ({
          one,
          options: candidates.filter((sub) => !used.has(sub.id) && canCover(sub, one, game, rules, module)),
        }))
        .filter((entry) => entry.options.length)
        .sort((a, b) => a.options.length - b.options.length);
      if (!open.length) continue;
      const { one, options } = open[0];
      const pick = [...options].sort(better)[0];
      used.add(pick.id);
      coveredBy.set(one.man.id, pick);
      covers.push(pick);
      progress = true;
    }
  }
  return { covers, coveredBy };
}

/**
 * THE BENCH: who sits there and in which order.
 *
 * Classic substitutions take the first man of the SAME role in bench order, so the classic bench is written by
 * role (P, D, C, A) and best first inside each; Mantra reads it as one queue, best first. The league's per-role
 * counts are honoured (exact on a fixed bench, minimums on a variable one), and the size caps it. WHO gets a place
 * is decided by `covers` first (`coverOrder`: no hole if a starter drops out), then by the FVA. Unpriced men go
 * last: a bench place is cheap, and «unknown» is not «useless».
 */
export function benchOf(
  rest: readonly LineupMan[],
  rule: BenchRule,
  game: LegheGame | null,
  covers: readonly LineupMan[] = [],
): {
  bench: LineupMan[];
  outside: LineupMan[];
} {
  const pool = [...rest].sort(byPoints);
  // The order places are handed out in: the covers first, in their own order, then everybody else by FVA.
  const coverIds = new Set(covers.map((man) => man.id));
  const ordered = [...covers.filter((man) => pool.includes(man)), ...pool.filter((man) => !coverIds.has(man.id))];
  const size = rule.size ?? pool.length;
  const groups = game === 'mantra' ? 2 : 4;
  const wanted = rule.perRole.slice(0, groups);
  const picked: LineupMan[] = [];
  const take = (man: LineupMan) => {
    picked.push(man);
    pool.splice(pool.indexOf(man), 1);
    ordered.splice(ordered.indexOf(man), 1);
  };
  wanted.forEach((count, group) => {
    for (const man of ordered.filter((m) => benchGroup(m, game) === group).slice(0, count)) {
      if (picked.length < size) take(man);
    }
  });
  const exact = rule.fixed && game !== 'mantra' && wanted.some((n) => n > 0);
  if (!exact) {
    while (picked.length < size && ordered.length) take(ordered[0]);
  }
  const bench =
    game === 'mantra'
      ? picked.sort(byPoints)
      : picked.sort((a, b) => benchGroup(a, game) - benchGroup(b, game) || byPoints(a, b));
  return { bench, outside: pool };
}

/** The best eleven by expected points on the league's modules, and the bench behind it. */
export function adviseLineup(
  men: readonly LineupMan[],
  rulebook: MantraModules | null,
  allowed: readonly string[],
  rule: BenchRule,
  game: LegheGame | null,
): LineupPlan | null {
  if (!rulebook?.modules) return null;
  const rules = allowedRules(rulebook, allowed);
  const best = bestEleven(men, rules, fieldWeight);
  if (!best) return null;
  const onPitch = new Set(best.men.map((m) => m.id));
  const rest = men.filter((m) => !onPitch.has(m.id));
  const starters: Starter[] = best.places
    .map((place, at) => ({ place, man: best.holders[at] }))
    .filter((one): one is Starter => !!one.man);
  const { covers, coveredBy } = coverOrder(starters, rest, game, rulebook, best.module);
  const { bench, outside } = benchOf(rest, rule, game, covers);
  return {
    module: best.module,
    rows: rowsOf(best.places, best.holders),
    total: best.total,
    placed: best.men.length,
    bench,
    outside,
    scores: best.scores,
    cover: coverOf(starters, coveredBy, bench),
  };
}

/** Which starters have their own cover ON THE BENCH: a cover the bench's size left out covers nothing. */
function coverOf(starters: readonly Starter[], coveredBy: Map<number, LineupMan>, bench: readonly LineupMan[]): LineupCover {
  const onBench = new Set(bench.map((man) => man.id));
  const open = starters.filter((one) => !onBench.has(coveredBy.get(one.man.id)?.id ?? -1)).map((one) => one.man.name);
  return { starters: starters.length, covered: starters.length - open.length, open };
}

/**
 * The lineup ALREADY SENT to Leghe, drawn on the same pitch: its module, its eleven placed by the rulebook
 * and its bench in the order he wrote it. Men the module cannot place (a lineup sent under another rulebook)
 * end up in `outside` rather than vanishing.
 */
export function drawSent(
  men: readonly LineupMan[],
  rulebook: MantraModules | null,
  sent: { module: string; starts: readonly number[]; bench: readonly number[] },
): LineupPlan | null {
  if (!rulebook?.modules) return null;
  const module = rulebookName(sent.module);
  const places = placesIn(rulebook, module);
  if (!places.length) return null;
  const byId = new Map(men.map((m) => [m.id, m]));
  const starters = sent.starts.map((id) => byId.get(id)).filter((m): m is LineupMan => !!m);
  const { chosen, holder } = assign(
    [...starters].sort(byPoints),
    places.map((p) => p.roles),
  );
  const holders = holder.map((who) => (who === -1 ? null : chosen[who]));
  const placed = new Set(chosen.map((m) => m.id));
  return {
    module,
    rows: rowsOf(places, holders),
    total: chosen.reduce((sum, m) => sum + (m.points ?? 0), 0),
    placed: chosen.length,
    bench: sent.bench.map((id) => byId.get(id)).filter((m): m is LineupMan => !!m),
    outside: starters.filter((m) => !placed.has(m.id)),
    scores: [],
  };
}
