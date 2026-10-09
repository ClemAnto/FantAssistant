/**
 * WRITING THE LINEUP TO LEGHE (operator, 09/10/2026: «nella pagina Lineup permettimi di salvare sul leghe la
 * formazione»). Until that day the page only advised (his decision of 08/10/2026: «per il momento basta il
 * consiglio»); this file is the other half, and it is pure - the shapes and the platform's rules, no network.
 *
 * WHAT LEGHE ASKS, read in its own code and not guessed (backend `origin/master` of 08/10/2026,
 * `TeamLineupService.Save` + `ValidateTeamLineup` + `ControlloSwitch`; the Leghe front-end's `Lineups.saveLineup`):
 *   POST /gaming/v1/teamLineup/{division}, the team taken from the league token, body
 *   {starts, bench, capt, mdl, idcomp, mday, cmday, tid, allComp, visb, act, swtcA, swtcB, swtc, swtcMdl, pos}.
 *   - `starts` is SLOT-ORDERED: index 0 the keeper, then the module's places in LEGHE's order - on Mantra the
 *     backend checks the man at `starts[i]` against place `i` (`LegheCalcoloMantraHelper.RitornaMalus`), and its
 *     order is not the rulebook file's (`LEGHE_MANTRA_SLOTS`). Classic counts the roles: keeper first, then D, C, A.
 *   - `mdl` is the league's own code (`343`), and must be one the league allows.
 *   - the bench: Mantra exactly `tbench` men with at least one keeper; classic fixed exactly `tbench` (per-role
 *     counts exact where positive, `bseq` in order), variable at most `tbench` with the counts as minimums.
 *   - `act` 0 = saved from the web, the only value (with 1, the app) a non-admin client may send.
 *   - the SWITCH: both men or neither, the one going out a starter, the one coming in on the bench. Default
 *     (the page's «basic») keeps the module; Plus may change it, to a module the league allows that the eleven
 *     after the switch can field (classic: the counts; Mantra: every man in a place of his roles, `FindLineup`).
 *
 * A refusal is worded HERE, before the request, wherever the rule can be checked locally: a request Leghe is
 * certain to refuse is a request the operator's rule («limitiamo al minimo le richieste») says not to send.
 */

import { LegheError } from './leghe-api';
import { LegheGame, LineupRules } from './leghe-rules';
import { classicCounts, rulebookName } from './lineup-advice';
import { assign } from './mantra-legal';

/**
 * LEGHE'S ORDER OF THE PLACES of each Mantra module, keeper first: the backend's `MantraStaticData.Modulo*`, the
 * same strings the front-end's `Formations.schemes.mantra` writes (read 09/10/2026). Checked the same day against
 * `mantra_modules.json`: all eleven modules have the SAME places as the rulebook file, in another order - so this
 * table decides the order of `starts` and nothing else.
 */
export const LEGHE_MANTRA_SLOTS: Readonly<Record<string, string>> = {
  '343': 'Por Dc;B Dc Dc E C M;C E W;A A;Pc W;A',
  '3412': 'Por Dc;B Dc Dc E C M;C E T A;Pc A;Pc',
  '3421': 'Por Dc;B Dc Dc E M;C M E;W T;A T A;Pc',
  '352': 'Por Dc;B Dc Dc E C M M;C E;W A;Pc A;Pc',
  '3511': 'Por Dc;B Dc Dc E;W M C M E;W T;A A;Pc',
  '433': 'Por Ds Dc Dc Dd C M M;C W;A A;Pc W;A',
  '4312': 'Por Ds Dc Dc Dd C M M;C T A;Pc T;A;Pc',
  '442': 'Por Ds Dc Dc Dd E C M;C E;W A;Pc A;Pc',
  '4141': 'Por Ds Dc Dc Dd M W T C;T E;W A;Pc',
  '4411': 'Por Ds Dc Dc Dd E;W C M E;W T;A A;Pc',
  '4231': 'Por Ds Dc Dc Dd M;C M W;A T W;T A;Pc',
};

/** Leghe's places of a module in Leghe's order, each as the lowercase roles it accepts; null = unknown module. */
export function legheSlots(code: string, game: LegheGame | null): string[][] | null {
  if (game === 'mantra') {
    const row = LEGHE_MANTRA_SLOTS[code];
    return row ? row.split(' ').map((slot) => slot.toLowerCase().split(';')) : null;
  }
  const counts = classicCounts(code);
  if (!counts) return null;
  const [d, c, a] = counts;
  const line = (role: string, n: number) => Array.from({ length: n }, () => [role]);
  return [['p'], ...line('d', d), ...line('c', c), ...line('a', a)];
}

/**
 * The league's own code for a module named the rulebook's way (`3-4-3` -> `343`); null = the league does not allow
 * it. With the league's list not read, the name's digits: Leghe will say whether it allows it.
 */
export function legheModuleCode(module: string, allowed: readonly string[]): string | null {
  if (!allowed.length) return /^[\d-]+$/.test(module) ? module.replace(/-/g, '') : null;
  return allowed.find((code) => rulebookName(code) === rulebookName(module)) ?? null;
}

/** A man as the payload needs him: who he is and the roles Leghe gives him (lowercase codes). */
export interface SaveMan {
  id: number;
  name: string;
  roles: string[];
}

/**
 * The STARTERS IN LEGHE'S SLOT ORDER, or null when they do not fill the module's places. The matching is the
 * rulebook's own (`mantra-legal.assign`): a man takes a place only with one of the roles it accepts, so no place
 * is filled with a malus.
 */
export function orderForLeghe<T extends SaveMan>(starters: readonly T[], slots: string[][]): T[] | null {
  if (starters.length !== slots.length) return null;
  const { chosen, holder } = assign(starters, slots);
  if (holder.some((who) => who === -1)) return null;
  return holder.map((who) => chosen[who]);
}

/**
 * A BASIC SWITCH TAKES THE PLACE THE MAN GOING OUT STANDS IN, so the order of `starts` decides whether it is legal:
 * the Leghe front-end says it in so many words («in Basic eligibility depends on the module slot the switch-out
 * vacates ... a B is a valid replacement for a Dc standing in a Dc/B slot», `lineup-switch.ts`, QIT-1721). Hence
 * the starters in Leghe's order with `out` on a place `into` can also take - every place both fit is tried, the
 * other ten placed around it - or null when there is none.
 */
export function orderWithSwitch<T extends SaveMan>(
  starters: readonly T[],
  out: T,
  into: SaveMan,
  slots: string[][],
): T[] | null {
  const fits = (man: SaveMan, slot: string[]) => man.roles.some((role) => slot.includes(role));
  const others = starters.filter((man) => man.id !== out.id);
  for (let at = 0; at < slots.length; at++) {
    if (!fits(out, slots[at]) || !fits(into, slots[at])) continue;
    const rest = slots.filter((_, i) => i !== at);
    const placed = orderForLeghe(others, rest);
    if (placed) return [...placed.slice(0, at), out, ...placed.slice(at)];
  }
  return null;
}

/**
 * THE MODULES A SWITCH CAN LAND ON, the lineup's own first (Leghe's codes). Basic never changes module and `into`
 * takes `out`'s very place (`orderWithSwitch`); Plus is any module the league allows on which the eleven AFTER the
 * switch fills every place - the backend's `FindLineup` on Mantra, the counts on classic. A keeper only swaps with
 * a keeper, which the places say by themselves (the keeper's place accepts only `p`/`por`).
 */
export function switchModules(
  starters: readonly SaveMan[],
  out: SaveMan,
  into: SaveMan,
  code: string,
  allowed: readonly string[],
  game: LegheGame | null,
  mode: 'basic' | 'plus',
): string[] {
  if (mode === 'basic') {
    const slots = legheSlots(code, game);
    return slots && orderWithSwitch(starters, out, into, slots) ? [code] : [];
  }
  const after = starters.map((man) => (man.id === out.id ? into : man));
  return [code, ...allowed.filter((one) => one !== code)].filter((one) => {
    const slots = legheSlots(one, game);
    return !!slots && !!orderForLeghe(after, slots);
  });
}

/** What the body is built from: the lineup on screen, the matchday Leghe named, the league's rules. */
export interface SaveInput {
  game: LegheGame | null;
  rules: Pick<LineupRules, 'modules' | 'bench' | 'captain' | 'switchMode'>;
  /** The module as the page names it (the rulebook's `3-4-3`). */
  module: string;
  starters: readonly SaveMan[];
  bench: readonly SaveMan[];
  switchPair: { out: number; in: number; module: string | null } | null;
  competitionId: number;
  matchday: number | null;
  championshipMatchday: number | null;
  teamId: number;
  allCompetitions: boolean;
  visible: boolean;
}

export interface LegheLineupBody {
  starts: number[];
  bench: number[];
  capt: number[];
  mdl: string;
  idcomp: number;
  mday: number;
  cmday: number;
  tid: number;
  allComp: boolean;
  visb: boolean;
  act: 0;
  swtcA: number;
  swtcB: number;
  swtc: 0;
  swtcMdl: string;
  pos: number;
}

export type SavePlan = { body: LegheLineupBody } | { refusal: string };

const KEEPER = new Set(['p', 'por']);
const isKeeper = (man: SaveMan) => man.roles.some((role) => KEEPER.has(role));
/** A classic man's group on the bench: 0-3 for P, D, C, A. */
const classicGroup = (man: SaveMan) => ['p', 'd', 'c', 'a'].indexOf(man.roles[0] ?? '');
const PDCA = 'PDCA';

/** The bench against the league's rule, as Leghe checks it; null = fine. */
function benchRefusal(bench: readonly SaveMan[], rules: SaveInput['rules'], game: LegheGame | null): string | null {
  const rule = rules.bench;
  const n = bench.length;
  if (game === 'mantra') {
    if (rule.size !== null && n !== rule.size) return `La panchina deve avere ${rule.size} calciatori: ne ha ${n}.`;
    if (!bench.some(isKeeper)) return 'Serve almeno un portiere in panchina.';
    return null;
  }
  if (rule.fixed) {
    if (rule.size !== null && n !== rule.size) return `La panchina deve avere ${rule.size} calciatori: ne ha ${n}.`;
    if (rule.sequence?.length) {
      const wrong = rule.sequence.findIndex((role, at) => classicGroup(bench[at] ?? { id: 0, name: '', roles: [] }) !== role - 1);
      if (wrong >= 0) return `La panchina deve seguire i ruoli ${rule.sequence.map((r) => PDCA[r - 1] ?? '?').join(' ')}.`;
    }
  } else if (rule.size !== null && n > rule.size) {
    return `La panchina ha al massimo ${rule.size} posti: ne hai usati ${n}.`;
  }
  const counts = [0, 0, 0, 0];
  for (const man of bench) if (classicGroup(man) >= 0) counts[classicGroup(man)] += 1;
  for (let group = 0; group < 4; group++) {
    const want = rule.perRole[group] ?? 0;
    if (want <= 0) continue;
    if (rule.fixed && counts[group] !== want) return `In panchina servono esattamente ${want} ${PDCA[group]}: ce ne sono ${counts[group]}.`;
    if (!rule.fixed && counts[group] < want) return `In panchina servono almeno ${want} ${PDCA[group]}: ce ne sono ${counts[group]}.`;
  }
  return null;
}

/** The body Leghe takes, or the ONE reason it would refuse it, worded for the page. */
export function saveBody(input: SaveInput): SavePlan {
  const { rules, game } = input;
  if (rules.captain === 'season' || rules.captain === 'match') {
    return { refusal: 'La lega usa il capitano, e da qui non si sceglie ancora: salvala da Leghe.' };
  }
  if (input.matchday === null) return { refusal: 'Leghe non ha detto quale giornata schierare: rileggi la lega.' };
  const missing = 11 - input.starters.length;
  if (missing > 0) return { refusal: missing === 1 ? 'Manca un titolare.' : `Mancano ${missing} titolari.` };
  const code = legheModuleCode(input.module, rules.modules);
  if (!code) return { refusal: `Il modulo ${input.module} non è fra quelli ammessi dalla lega.` };
  const slots = legheSlots(code, game);
  if (!slots) return { refusal: `Leghe non conosce il modulo ${input.module}.` };
  let starts = orderForLeghe(input.starters, slots);
  if (!starts) return { refusal: `I titolari non riempiono i posti del ${input.module}.` };
  const onPitch = new Set(starts.map((man) => man.id));
  if (input.bench.some((man) => onPitch.has(man.id))) return { refusal: 'Un calciatore è sia in campo sia in panchina.' };
  const bench = benchRefusal(input.bench, rules, game);
  if (bench) return { refusal: bench };

  let swtc = { swtcA: 0, swtcB: 0, swtcMdl: '', pos: 0 };
  const pair = input.switchPair;
  if (pair) {
    const mode = rules.switchMode;
    if (mode !== 'basic' && mode !== 'plus') return { refusal: 'La lega non ha lo switch.' };
    const out = starts.find((man) => man.id === pair.out);
    const into = input.bench.find((man) => man.id === pair.in);
    if (!out) return { refusal: 'Nello switch deve uscire un titolare.' };
    if (!into) return { refusal: 'Nello switch deve entrare un calciatore della panchina.' };
    const modules = switchModules(starts, out, into, code, rules.modules, game, mode);
    if (!modules.length) {
      return {
        refusal:
          mode === 'basic'
            ? `Switch Basic: ${into.name} non può prendere il posto di ${out.name}.`
            : `Con ${into.name} al posto di ${out.name} nessun modulo della lega è schierabile.`,
      };
    }
    const wanted = pair.module ? legheModuleCode(pair.module, rules.modules) : null;
    const module = wanted && modules.includes(wanted) ? wanted : modules[0];
    // Basic: the man going out stands where the man coming in can stand (`orderWithSwitch`, non-null here).
    if (mode === 'basic') starts = orderWithSwitch(starts, out, into, slots) ?? starts;
    swtc = { swtcA: out.id, swtcB: into.id, swtcMdl: module, pos: starts.indexOf(out) };
  }

  return {
    body: {
      starts: starts.map((man) => man.id),
      bench: input.bench.map((man) => man.id),
      capt: [],
      mdl: code,
      idcomp: input.competitionId,
      mday: input.matchday,
      cmday: input.championshipMatchday ?? 0,
      tid: input.teamId,
      allComp: input.allCompetitions,
      visb: input.visible,
      act: 0,
      ...swtc,
      swtc: 0,
    },
  };
}

/**
 * LEGHE'S REFUSALS IN THE PAGE'S LANGUAGE: the backend answers in English (`ErrorCode.Label`), the code says which
 * rule it is. A code not listed keeps Leghe's own words, with the code beside them.
 */
const REFUSALS: Record<string, string> = {
  LUP004: 'servono esattamente 11 titolari',
  LUP007: 'le formazioni sono chiuse',
  LUP008: 'il primo titolare deve essere il portiere',
  LUP009: 'modulo non ammesso dalla lega',
  LUP010: 'la panchina Mantra non ha il numero di calciatori richiesto',
  LUP011: 'serve almeno un portiere in panchina',
  LUP012: 'la panchina fissa non ha il numero di calciatori richiesto',
  LUP014: "la panchina non segue l'ordine dei ruoli della lega",
  LUP015: 'in panchina manca il numero esatto di un ruolo',
  LUP016: 'troppi calciatori in panchina',
  LUP017: 'in panchina manca il minimo di un ruolo',
  LUP019: 'switch fra ruoli incompatibili',
  LUP020: 'switch: cambio di modulo non ammesso',
  LUP021: 'switch: chi esce non è fra i titolari',
  LUP022: 'switch: chi entra non è in panchina',
  LUP024: 'uno o più calciatori non sono nella rosa',
  LUP026: 'manca il capitano',
  LUP027: 'manca il capitano o il vice',
  LUP028: 'i titolari non corrispondono al modulo dichiarato',
  LUP030: 'il modulo dello switch è diverso da quello della formazione',
  LUP031: 'il modulo dopo lo switch non è ammesso',
  LUP036: 'dati dello switch non validi',
  LUP039: 'la rosa non è completa',
  LUP041: 'la squadra non gioca questa giornata',
};

/** One sentence for a failed save: the rule broken when Leghe names one, the cause otherwise. */
export function saveRefusal(err: unknown): string {
  if (!(err instanceof LegheError)) {
    return `Salvataggio non riuscito: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`;
  }
  if (err.kind !== 'refused') return err.message;
  const known = err.code ? REFUSALS[err.code] : null;
  return known ? `Leghe non ha salvato: ${known} (${err.code}).` : err.message;
}
