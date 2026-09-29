/* The matchday as the operator's EuroLeghe plays it (declared 28/09/2026, `docs/model/priorita-draft-v1.md`):
 *
 *   * the eleven is handed in BEFORE the matchday - the best legal eleven on what each man is EXPECTED to
 *     give, `p x fm_pred` - and never picked after the votes are known (the published metric `matchdayXI`
 *     does the latter, which is information nobody has: «the model of a decision must respect WHEN it is
 *     taken»);
 *   * substitutions are UNLIMITED and follow the rulebook's matrix, with its -1 out-of-position malus;
 *   * there is NO «riserva d'ufficio»: a place nobody can cover is worth 0 AND voids the day's R-Factor;
 *   * the R-Factor counts the eleven who took the field with a BASE vote >= 6: 8 -> 0.5, 9 -> 1, 10 -> 2,
 *     11 -> 3.
 *
 * The substitution engine is ORDERED, as the rulebook writes it and the operator restated it (28/09/2026:
 * «un calciatore non può essere schierato inizialmente fuori ruolo, può accadere solo se una riserva entra e
 * l'unico modulo ammesso è uno dove lui è fuori ruolo»):
 *   1. OPTIMAL  - the reserves enter IN ROLE in the declared scheme;
 *   2. EFFICIENT - otherwise the scheme changes, to any module that keeps EVERY man on the pitch in role;
 *   3. ADAPTED  - only if no module does, the declared scheme is kept and a reserve enters with the -1.
 * A level is taken only if it fields more men than the one before it, so a -1 is paid only where it buys a
 * place nobody could fill in role. One approximation, stated: the malus comes off the fantavoto, never off
 * the base vote the R-Factor reads - the regulation does not say, and a malus on the pass mark would be a
 * second penalty for one event. */
import { assign, bestEleven, placesIn } from './appcode.mjs';

/** The R-Factor ladder, as declared. Index = sufficient men on the pitch. */
export const R_FACTOR = (count) => (count >= 11 ? 3 : count === 10 ? 2 : count === 9 ? 1 : count === 8 ? 0.5 : 0);

/** The rulebook's spelling of a role, which is how the matrix is keyed. */
const CANON = { pc: 'Pc', a: 'A', t: 'T', w: 'W', c: 'C', m: 'M', e: 'E', b: 'B', dc: 'Dc', dd: 'Dd', ds: 'Ds',
                por: 'Por' };

/**
 * The malus of putting a man with `inRoles` in a place opened by a man who played there as `outRole`.
 * `0` = no penalty, `-1` = out of position, `null` = not allowed.
 *
 * A man whose roles the PLACE already lists enters at no cost: that is what «in alternativa» means, and it
 * is why every asterisk of the matrix resolves to its «otherwise» branch here - we only reach the matrix
 * when the place does not list him.
 */
export function subMalus(rules, module, place, outRole, inRoles) {
  if (inRoles.some((role) => place.roles.includes(role))) return 0;
  const row = rules.substitution?.matrix?.[CANON[outRole]];
  if (!row) return null;
  let best = null;
  for (const role of inRoles) {
    const cell = row[CANON[role]];
    let malus = null;
    if (cell === 'OK') malus = 0;
    else if (cell === '-1' || cell === '**') malus = -1;
    else if (cell === '***') malus = module === '4-1-4-1' ? null : -1;
    if (malus !== null && (best === null || malus > best)) best = malus;
  }
  return best;
}

/** The DECLARED eleven: best legal eleven on expected points, and who stands where. */
export function declaredEleven(roster, rules) {
  const eleven = bestEleven(roster, rules, (man) => (man.p ?? 0) * (man.fm_pred ?? 0));
  if (!eleven) return null;
  return {
    module: eleven.module,
    places: eleven.places,
    holders: eleven.holders,
    // The role each holder was fielded AS: his first code the place lists. It is the matrix's ROW.
    fieldedAs: eleven.holders.map((man, i) => (man
      ? man.roles.find((role) => eleven.places[i].roles.includes(role)) ?? man.roles[0] : null)),
  };
}

/**
 * Fill the opened places from the bench, maximising first HOW MANY are filled (a hole voids the R-Factor)
 * and then the points. Exhaustive over the four best candidates of each open place, which is exact for the
 * open-place counts a matchday produces and bounded when it is not.
 */
function fillOpen(open, bench, voteOf) {
  const options = open.map((slot) => bench
    .map((man) => ({ man, malus: slot.malusFor(man) }))
    .filter((option) => option.malus !== null)
    .map((option) => ({ ...option, points: voteOf(option.man) + option.malus }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 4));
  let best = { filled: 0, points: 0, men: [] };
  const used = new Set();
  // A squad short of a whole line opens many places every day; there the exhaustive walk is replaced by
  // a greedy one (best candidate per place, in order), which is exact whenever no two places want one man.
  if (open.length > 6) {
    for (const choices of options) {
      const option = choices.find((o) => !used.has(o.man.id));
      if (!option) continue;
      used.add(option.man.id);
      best = { filled: best.filled + 1, points: best.points + option.points, men: [...best.men, option.man] };
    }
    return best;
  }
  const walk = (i, filled, points, men) => {
    if (i === open.length) {
      if (filled > best.filled || (filled === best.filled && points > best.points)) best = { filled, points, men };
      return;
    }
    for (const option of options[i]) {
      if (used.has(option.man.id)) continue;
      used.add(option.man.id);
      walk(i + 1, filled + 1, points + option.points, [...men, option.man]);
      used.delete(option.man.id);
    }
    walk(i + 1, filled, points, men);
  };
  walk(0, 0, 0, []);
  return best;
}

/**
 * The EFFICIENT substitution: a module in which the men still on the pitch AND the incoming reserves all
 * stand in role. The men on the pitch are placed first and must ALL fit - they cannot be taken off - then the
 * reserves best-vote first. Returns the reserves that enter under the module that fields most (then most
 * points), in the same shape `fillOpen` returns; null when no module keeps the men on the pitch.
 */
function changeScheme(rules, onPitch, bench, voteOf) {
  const ranked = [...bench].sort((a, b) => voteOf(b) - voteOf(a));
  let best = null;
  for (const name of Object.keys(rules.modules)) {
    const places = placesIn(rules, name).map((place) => place.roles);
    const { chosen } = assign([...onPitch, ...ranked], places);
    const kept = chosen.filter((man) => onPitch.includes(man));
    if (kept.length < onPitch.length) continue;
    const men = chosen.filter((man) => !onPitch.includes(man));
    const points = men.reduce((sum, man) => sum + voteOf(man), 0);
    if (!best || men.length > best.filled || (men.length === best.filled && points > best.points)) {
      best = { filled: men.length, points, men };
    }
  }
  return best;
}

/** One squad's season under these rules: points per matchday summed, R-Factor included. */
export function seasonDeclared(roster, rules, votes, base, rounds, { rFactor = true } = {}) {
  const xi = declaredEleven(roster, rules);
  let points = 0, filled = 0, holes = 0, rfPoints = 0;
  if (!xi) return { points: 0, filled: 0, places: rounds * 11, holes: rounds * 11, rfPoints: 0 };
  const starters = new Set(xi.holders.filter(Boolean).map((man) => man.id));
  const bench = roster.filter((man) => !starters.has(man.id));
  for (let md = 1; md <= rounds; md += 1) {
    const voteOf = (man) => votes[man.id]?.[md];
    const has = (man) => voteOf(man) !== undefined;
    let day = 0, onPitch = [];
    const open = [];
    xi.places.forEach((place, i) => {
      const man = xi.holders[i];
      if (man && has(man)) {
        day += voteOf(man);
        onPitch.push(man);
      } else {
        const outRole = xi.fieldedAs[i] ?? place.roles[0];
        open.push({ malusFor: (sub) => subMalus(rules, xi.module, place, outRole, sub.roles) });
      }
    });
    const available = bench.filter(has);
    let subs = { filled: 0, points: 0, men: [] };
    if (open.length) {
      // 1. OPTIMAL: in role, same scheme (the adapted filler restricted to a zero malus).
      const inRole = open.map((slot) => ({ malusFor: (sub) => (slot.malusFor(sub) === 0 ? 0 : null) }));
      subs = fillOpen(inRole, available, voteOf);
      if (subs.filled < open.length) {
        // 2. EFFICIENT: another module that keeps everybody in role.
        const changed = changeScheme(rules, onPitch, available, voteOf);
        if (changed && changed.filled > subs.filled) subs = changed;
        // 3. ADAPTED: the declared scheme with the -1, only if it fields more.
        if (subs.filled < open.length) {
          const adapted = fillOpen(open, available, voteOf);
          if (adapted.filled > subs.filled) subs = adapted;
        }
      }
    }
    day += subs.points;
    onPitch = onPitch.concat(subs.men);
    const dayHoles = open.length - subs.filled;
    let rf = 0;
    if (rFactor && dayHoles === 0) {
      rf = R_FACTOR(onPitch.filter((man) => (base[man.id]?.[md] ?? -Infinity) >= 6).length);
    }
    points += day + rf;
    rfPoints += rf;
    filled += onPitch.length;
    holes += dayHoles;
  }
  return { points, filled, places: rounds * 11, holes, rfPoints, module: xi.module };
}
