/**
 * THE NEXT MATCHDAY OF ONE LEAGUE, AS LEGHE SEES IT (08/10/2026). Pure parsers from the wire shapes to the
 * page's model: the roster with each man's next real match, the competitions with this matchday's opponent,
 * and the lineup already saved. Every shape below was read off the operator's own leagues on 08/10/2026
 * (two classic, one Mantra); the field meanings come from the Leghe front-end's mapping.
 *
 * WHO IS WHO: Leghe's player id (`pid`) IS this project's `fc_id` - checked on six names (Hradecky 4154,
 * Kane 2557, Falcone 2134...) - so a roster row joins the bundle by identity, never by name.
 */

/** Leghe's role ids: classic 1-4, Mantra 6-19 (5 and 18 are the coaches, 17 the generic outfield). */
const ROLE_CODE: Record<number, string> = {
  1: 'P',
  2: 'D',
  3: 'C',
  4: 'A',
  6: 'Por',
  7: 'Dd',
  8: 'Ds',
  9: 'Dc',
  10: 'E',
  11: 'M',
  12: 'C',
  13: 'T',
  14: 'W',
  15: 'A',
  16: 'Pc',
  19: 'B',
};

export function roleCodes(ids: unknown): string[] {
  return Array.isArray(ids) ? ids.map((id) => ROLE_CODE[Number(id)]).filter((c): c is string => !!c) : [];
}

/** One man of the roster with the facts Leghe attaches for the coming matchday. */
export interface NextMatchRow {
  fcId: number;
  name: string;
  roles: string[];
  club: string;
  /** Championship code (`ITA`, `ENG`, `FRA`...): EuroLeghe spans five. */
  championship: string;
  /** `LEC-BOL`: home first, as Leghe writes it. */
  match: string;
  /** Plays at home. Null when Leghe does not say. */
  home: boolean | null;
  /**
   * The platform's probable-starter percentage (fantacalcio.it's «probabili formazioni»), for every
   * championship of the platform - our own press sheet covers Serie A only.
   */
  percent: number | null;
  /** Leghe's availability code: 2 = unavailable, 3 = suspended, 4 = not called up; anything else = no flag. */
  out: 'unavailable' | 'suspended' | 'not-called' | null;
  /** The platform's note on him (an injury, a doubt), verbatim. */
  note: string | null;
  /** Season averages as the platform shows them: base vote and fantavoto. Zero = no vote yet = null. */
  vote: number | null;
  fantavote: number | null;
  /** Sold out of the championship (Leghe's `trnsf`). */
  transferred: boolean;
  /**
   * Leghe's ids of his real club (`tid`) and of the opponent of his next match (`tidOp`) - an IDENTITY of the
   * fixture, where `match` is only two 3-letter labels. Null when Leghe does not say.
   */
  clubId: number | null;
  opponentId: number | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseRoster(lineupBody: unknown): NextMatchRow[] {
  const info = (lineupBody as { lineUpInfo?: unknown[] } | null)?.lineUpInfo;
  if (!Array.isArray(info)) return [];
  const rows: NextMatchRow[] = [];
  for (const raw of info) {
    const o = raw as Record<string, unknown>;
    const fcId = finite(o['pid']);
    if (fcId === null) continue;
    const status = finite(o['status']);
    const note = str(o['comment']) || str(o['descr']);
    const vote = finite(o['agrd']);
    const fantavote = finite(o['fagrd']);
    rows.push({
      fcId,
      name: str(o['plyr']),
      roles: roleCodes(o['role']),
      club: str(o['tname']),
      championship: str(o['champ']),
      match: [str(o['teamH']), str(o['teamA'])].filter(Boolean).join('-'),
      home: o['hoaw'] === 0 ? true : o['hoaw'] === 1 ? false : null,
      percent: finite(o['percent']),
      out: status === 2 ? 'unavailable' : status === 3 ? 'suspended' : status === 4 ? 'not-called' : null,
      note: note || null,
      // A season average of zero is «no vote yet», not a zero: «vuoto = ignoto, mai zero».
      vote: vote ? vote : null,
      fantavote: fantavote ? fantavote : null,
      transferred: !!o['trnsf'],
      clubId: finite(o['tid']),
      opponentId: finite(o['tidOp']),
    });
  }
  return rows;
}

/** A real club as Leghe lists it (`/onboarding/v1/championship/teams`): its id, name and 3-letter code. */
export interface RealTeam {
  id: number;
  name: string;
  code: string;
  championship: string;
}

/**
 * `{teams: [{id_s, s, sigla, camp}]}`. On EuroLeghe it lists only the clubs of the platform's perimeter
 * (37 on 08/10/2026), so an opponent from outside it has an id and no name - which the odds join says,
 * instead of guessing one.
 */
export function parseRealTeams(body: unknown): Map<number, RealTeam> {
  const out = new Map<number, RealTeam>();
  const rows = (body as { teams?: unknown[] } | null)?.teams;
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const o = raw as Record<string, unknown>;
    const id = finite(o['id_s']);
    if (id === null) continue;
    out.set(id, { id, name: str(o['s']), code: str(o['sigla']), championship: str(o['camp']) });
  }
  return out;
}

/**
 * The bundle's `fc_teams` (09/10/2026): fantacalcio.it's clubs by THEIR id - the same id space as Leghe's
 * `tid`/`tidOp` (Atalanta 1, Chelsea 26 on both) - read by the toolkit off the probabili pages, which name
 * both sides of every match of the round. It names what `parseRealTeams` cannot: an opponent outside the
 * EuroLeghe perimeter («PSG-MAN» is Paris Saint-Germain - Le Mans). Empty on a bundle without the table.
 */
export function fcTeamNames(table: { columns: string[]; rows: unknown[][] } | null): Map<number, string> {
  const out = new Map<number, string>();
  const id = table?.columns.indexOf('team_id') ?? -1;
  const name = table?.columns.indexOf('name') ?? -1;
  if (!table || id < 0 || name < 0) return out;
  for (const row of table.rows) {
    const key = finite(row[id]);
    const text = str(row[name]).trim();
    if (key !== null && text) out.set(key, text);
  }
  return out;
}

/** The lineup already sent for one competition's matchday. */
export interface SavedLineup {
  module: string;
  starts: number[];
  bench: number[];
  /** When it was last saved; null = never sent this matchday. */
  savedAt: Date | null;
  /** Competition matchday and championship matchday. */
  matchday: number | null;
  championshipMatchday: number | null;
}

/**
 * `ldate` is `yyyyMMddHHmmssfff`, Italian wall-clock time with no zone; zero or missing = never submitted.
 * Built as LOCAL time, which is exact in the operator's browser (Rome) and off by the zone difference
 * anywhere else - stated, because the only thing it decides on screen is «sent at hh:mm».
 */
export function parseLdate(raw: unknown): Date | null {
  const m = String(raw ?? '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m || m[1] === '0000') return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

export function parseSaved(lineupBody: unknown): SavedLineup | null {
  const dto = (lineupBody as { teamLineupDto?: Record<string, unknown> } | null)?.teamLineupDto;
  if (!dto) return null;
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n > 0) : []);
  return {
    module: str(dto['mdl']),
    starts: ids(dto['starts']),
    bench: ids(dto['bench']),
    savedAt: parseLdate(dto['ldate']),
    matchday: finite(dto['mday']),
    championshipMatchday: finite(dto['cmday']),
  };
}

/** Competition types, numbered by Leghe. */
export const COMPETITION_TYPE: Record<number, string> = {
  1: 'Campionato',
  2: 'A punti',
  3: 'Formula 1',
  4: 'Gironi',
  5: 'Gironi',
  6: 'Gironi',
  7: 'Eliminazione diretta',
  8: 'Eliminazione diretta (andata e ritorno)',
  9: 'Finale',
  10: 'Battle Royale',
  11: 'Highlander',
};

/** Types where the matchday is played AGAINST one opponent (head-to-head). */
const HEAD_TO_HEAD = new Set([1, 4, 5, 6, 7, 8, 9]);

export interface LegheCompetition {
  id: number;
  name: string;
  type: number;
  typeLabel: string;
  headToHead: boolean;
  /** First and last championship matchday it covers. */
  from: number | null;
  to: number | null;
  teamIds: number[];
}

export function parseCompetitions(body: unknown): LegheCompetition[] {
  const rows = Array.isArray(body) ? body : ((body as { data?: unknown[] } | null)?.data ?? []);
  const out: LegheCompetition[] = [];
  for (const raw of rows) {
    const o = raw as Record<string, unknown>;
    const id = finite(o['id']);
    if (id === null || o['del'] === true) continue;
    const type = finite(o['type']) ?? 0;
    out.push({
      id,
      name: str(o['name']),
      type,
      typeLabel: COMPETITION_TYPE[type] ?? `tipo ${type}`,
      headToHead: HEAD_TO_HEAD.has(type),
      from: finite(o['sDay']),
      to: finite(o['eDay']),
      teamIds: Array.isArray(o['tmids']) ? (o['tmids'] as unknown[]).map(Number) : [],
    });
  }
  return out;
}

/** This matchday's fixture of one team in a head-to-head calendar. */
export interface Fixture {
  matchday: number;
  championshipMatchday: number | null;
  /** -1 = bye, -2 = ghost team, as Leghe numbers them. */
  opponentId: number;
  home: boolean;
}

export function fixtureOf(calendarBody: unknown, matchday: number, teamId: number): Fixture | null {
  const rounds = Array.isArray(calendarBody) ? calendarBody : [];
  for (const raw of rounds) {
    const round = raw as Record<string, unknown>;
    if (finite(round['matchDay']) !== matchday) continue;
    for (const m of (round['matches'] as unknown[]) ?? []) {
      const match = m as Record<string, unknown>;
      const home = finite(match['tIdH']);
      const away = finite(match['tIdA']);
      if (home === teamId && away !== null) {
        return { matchday, championshipMatchday: finite(round['championshipMatchDay']), opponentId: away, home: true };
      }
      if (away === teamId && home !== null) {
        return { matchday, championshipMatchday: finite(round['championshipMatchDay']), opponentId: home, home: false };
      }
    }
  }
  return null;
}

/** A fantasy team of the league: name, manager, roster ids. */
export interface LegheTeam {
  id: number;
  name: string;
  manager: string;
  division: string;
  roster: number[];
}

export function parseTeam(raw: unknown): LegheTeam | null {
  const o = raw as Record<string, unknown> | null;
  const id = finite(o?.['id']);
  if (!o || id === null) return null;
  return {
    id,
    name: str(o['n']),
    manager: str(o['nu']),
    division: str(o['d']) || 'A',
    // `cal` is `;`-separated with a trailing separator; empty entries dropped.
    roster: str(o['cal'])
      .split(';')
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0),
  };
}

export interface LeagueStatus {
  /** The championship matchday in play or next. */
  matchday: number | null;
  /** The first match of that matchday, as Leghe writes it (Rome time, no zone). */
  firstMatch: string | null;
  live: boolean;
}

export function parseStatus(body: unknown): LeagueStatus {
  const o = (body ?? {}) as Record<string, unknown>;
  return {
    matchday: finite(o['mday']),
    firstMatch: typeof o['mstr'] === 'string' ? (o['mstr'] as string) : null,
    live: o['sto'] === true,
  };
}
