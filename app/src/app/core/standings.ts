import { CalendarFile } from './keeper-pairs';

/**
 * THE LEAGUE TABLES, for the match tooltip of the Formazione page (operator, 09/10/2026: «nel tooltip ... tra
 * parentesi il posto in classifica», then «sì, serve per EuroLeghe»).
 *
 * They are the toolkit's (`fixtures.fetch_standings`, ESPN's public tables, one read per championship) and
 * travel inside `calendar.json` on the calendar's own club keys: the app does not rank anybody. Checked the
 * day they arrived against the Serie A table rebuilt from the votes - the same 20 positions - which is why
 * that rebuild no longer exists: two tables for one league would eventually disagree on screen.
 *
 * A club is found by its IDENTITY first (`fc_club_id`, which the calendar carries for every club of ours),
 * and only then by name inside its championship, refused when two clubs fit: an ambiguous name gets no
 * position, «vuoto = ignoto».
 */
export interface TablePlace {
  position: number;
  points: number | null;
  played: number | null;
}

interface Entry extends TablePlace {
  league: string;
  key: string;
  name: string | null;
  fcClubId: number | null;
}

export interface Standings {
  byClubId: Map<number, TablePlace>;
  entries: Entry[];
}

/** Leghe's championship code -> the calendar's league key. Unknown code = look in every league. */
const LEAGUE_OF_CODE: Record<string, string> = {
  ITA: 'serie_a',
  ENG: 'premier_league',
  ESP: 'la_liga',
  GER: 'bundesliga',
  DEU: 'bundesliga',
  FRA: 'ligue_1',
};

export function standingsOf(calendar: CalendarFile | null): Standings {
  const byClubId = new Map<number, TablePlace>();
  const entries: Entry[] = [];
  for (const [league, block] of Object.entries(calendar?.leagues ?? {})) {
    const clubs = new Map(block.clubs.map((club) => [club.key, club]));
    for (const [key, position, points, played] of block.standings ?? []) {
      const club = clubs.get(key);
      const place = { position, points, played };
      entries.push({ ...place, league, key, name: club?.name ?? null, fcClubId: club?.fc_club_id ?? null });
      if (club?.fc_club_id != null) byClubId.set(club.fc_club_id, place);
    }
  }
  return { byClubId, entries };
}

export function placeOf(
  table: Standings,
  club: { fcClubId: number | null; name: string; championship?: string | null },
): TablePlace | null {
  if (club.fcClubId !== null) {
    const hit = table.byClubId.get(club.fcClubId);
    if (hit) return hit;
  }
  const league = club.championship ? LEAGUE_OF_CODE[club.championship.toUpperCase()] : undefined;
  // The name that shares the MOST words with his, and only if no other shares as many: «Real Madrid» is
  // not «Real Sociedad» (one word against two), «Bayern Monaco» meets our own name for the club.
  const words = wordsOf(club.name);
  let best = 0;
  let fits: Entry[] = [];
  for (const entry of table.entries) {
    if (league && entry.league !== league) continue;
    const theirs = new Set([...wordsOf(entry.key), ...(entry.name ? wordsOf(entry.name) : [])]);
    const shared = words.filter((word) => theirs.has(word)).length;
    if (shared > best) [best, fits] = [shared, [entry]];
    else if (shared === best && shared > 0) fits.push(entry);
  }
  return fits.length === 1 ? fits[0] : null;
}

/** Lowercase, accents off, words of three letters or more: `FC Köln` -> [`koln`]. */
function wordsOf(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}
