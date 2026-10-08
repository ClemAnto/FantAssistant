/**
 * THE BOOKMAKERS' PRICES, READ AND JOINED (operator, 08/10/2026: «per ogni calciatore di movimento in rosa
 * mi devi mostrare anche la quota gol (media calcolata prendendo le quote da più siti di scommesse); per i
 * portieri la quota porta inviolata»).
 *
 * The prices are captured by the Sheet (`scripts/gas/odds.gs`): the mean over the Italian books that
 * oddschecker.com/it compares, twice a day, for the coming matches of the five championships. This file
 * reduces its JSON and JOINS it to a Leghe roster - and the join is the delicate half, because a
 * bookmaker names a man the way a betting page does («Mateo Pellegrino») and Leghe the way the listone
 * does («Pellegrino M.»). There is no shared id, so the join is by NAME inside the MATCH, and it refuses
 * rather than guesses: two candidates is no answer («vuoto = ignoto», applied to an identity).
 *
 * A PRICE IS REPORTING here, the way the listone's quotation is: nothing the advice computes reads it.
 */

/** One selection: the mean price over the books that priced it, and their spread. */
export interface OddsPrice {
  price: number;
  /** Mean implied probability (1/price per book, averaged), margin included. */
  prob: number;
  books: number;
  min: number;
  max: number;
}

export interface OddsMatch {
  league: string;
  match: string;
  kickoff: string;
  taken: string;
  home: string;
  away: string;
  homeShort: string;
  awayShort: string;
  goal: (OddsPrice & { name: string })[];
  cleanSheet: Partial<Record<'home' | 'away', OddsPrice>>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function price(raw: unknown): OddsPrice | null {
  const o = raw as Record<string, unknown> | null;
  const p = num(o?.['price']);
  if (!o || p === null) return null;
  return { price: p, prob: num(o['prob']) ?? 1 / p, books: num(o['books']) ?? 0, min: num(o['min']) ?? p, max: num(o['max']) ?? p };
}

/** The Sheet's `?what=odds` payload, or null when it is not that shape. */
export function parseOdds(body: unknown): OddsMatch[] | null {
  const matches = (body as { matches?: unknown } | null)?.matches;
  if (!Array.isArray(matches)) return null;
  return matches.map((raw) => {
    const o = raw as Record<string, unknown>;
    const clean = (o['cleanSheet'] ?? {}) as Record<string, unknown>;
    return {
      league: str(o['league']),
      match: str(o['match']),
      kickoff: str(o['kickoff']),
      taken: str(o['taken']),
      home: str(o['home']),
      away: str(o['away']),
      homeShort: str(o['homeShort']),
      awayShort: str(o['awayShort']),
      goal: (Array.isArray(o['goal']) ? o['goal'] : [])
        .map((g) => {
          const p = price(g);
          const name = str((g as Record<string, unknown>)?.['name']);
          return p && name ? { ...p, name } : null;
        })
        .filter((g): g is OddsPrice & { name: string } => !!g),
      cleanSheet: {
        ...(price(clean['home']) ? { home: price(clean['home'])! } : {}),
        ...(price(clean['away']) ? { away: price(clean['away'])! } : {}),
      },
    };
  });
}

/** Lowercase, accents off, anything not a letter a space. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Letters NFD does not decompose: a Turkish dotless i, a Danish o, a Polish l (Yıldız, Højlund, Kiwior).
    .replace(/ı/g, 'i').replace(/ø/g, 'o').replace(/ł/g, 'l').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/đ/g, 'd')
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

/** Words a club's corporate name adds and its short name does not have. */
const CLUB_NOISE = new Set([
  'fc', 'cfc', 'acf', 'ac', 'as', 'ssc', 'us', 'ss', 'sc', 'cf', 'afc', 'bc', 'calcio', 'club', 'de', 'football',
  'futbol', 'united', 'city', 'hotspur', 'olympique', 'racing', 'stade', 'sv', 'vfb', 'vfl', 'tsg', 'rb', 'real',
]);

function clubWords(name: string): string[] {
  return fold(name)
    .split(' ')
    .filter((w) => w.length > 1 && !CLUB_NOISE.has(w));
}

/**
 * Two spellings of one club: their FIRST meaningful words agree. Any overlap would be too loose - «Inter
 * Milan» shares «milan» with «Milan» - while the first word is the club's own name in both conventions
 * (`ACF Fiorentina` / `Fiorentina`, `Bayern Munich` / `Bayern`). Where it differs (`Man Utd`, `PSG`) the
 * 3-letter codes in `matchOf` are the way in.
 */
export function sameClub(a: string, b: string): boolean {
  const left = clubWords(a)[0];
  const right = clubWords(b)[0];
  return !!left && left === right;
}

/** What the join needs to know about one roster man. */
export interface OddsMan {
  id: number;
  name: string;
  club: string;
  /** Leghe's `GEN-FIO`, home first. Every man of one real match carries the same string. */
  match: string;
  home: boolean | null;
  keeper: boolean;
}

/**
 * Does a 3-letter code name this side? Leghe and oddschecker write their own codes (`TOU` / `TFC`,
 * `LIV` / `LFC`), so a code counts when it IS the bookmakers' short name, when a word of the club's name
 * starts with it (`TOU` -> Toulouse, `BOU` -> Bournemouth, `MAN` -> Le Mans), or when it is the initials
 * of its words (`PSG` -> Paris Saint Germain).
 */
export function codeNames(code: string, short: string, name: string): boolean {
  const c = code.trim().toLowerCase();
  if (!c) return false;
  if (short && short.toLowerCase() === c) return true;
  const words = fold(name).split(' ').filter(Boolean);
  if (c.length >= 3 && words.some((w) => w.startsWith(c))) return true;
  return words.length >= c.length && words.map((w) => w[0]).join('').includes(c);
}

/**
 * The bookmakers' match behind ONE Leghe fixture - and the fixture is LEGHE'S, not ours to infer.
 *
 * The operator's rule (08/10/2026): «per euroleghe non è sempre semplice capire quale giornata dei singoli
 * campionati bisogna prendere in considerazione: devi prendere ... per ogni calciatore quale è la sua
 * "prossima partita" e da lì confrontare le partite corrette». A EuroLeghe matchday bundles a DIFFERENT real
 * round in each championship, so «the club's next match» is not a safe proxy: the match to price is the one
 * Leghe names for that man - his club, the opponent (`teamH-teamA`) and the side (`hoaw`).
 *
 * So a candidate is scored on THAT fixture: his club on the side Leghe says (by code or by name) and the
 * opponent Leghe names on the other side (by code) - both sides 4, his side alone 1. A man of the group
 * named among a match's scorers adds 2: the clue that survives Leghe spelling foreign clubs in Italian
 * («Lipsia», «Stoccarda»). Below 3 a candidate is not taken at all; among the rest the best total wins and
 * a tie goes to the EARLIER match, the one still to be played first. No candidate = no price, never a guess.
 */
export function matchFor(matches: readonly OddsMatch[], group: readonly OddsMan[]): OddsMatch | null {
  if (!group.length) return null;
  const [codeH, codeA] = group[0].match.split('-').map((c) => c ?? '');
  let best: OddsMatch | null = null;
  let bestScore = 0;
  for (const m of matches) {
    let fixture = 0;
    for (const man of group) {
      const sides: ('home' | 'away')[] = man.home === true ? ['home'] : man.home === false ? ['away'] : ['home', 'away'];
      for (const side of sides) {
        const other = side === 'home' ? 'away' : 'home';
        const hisCode = side === 'home' ? codeH : codeA;
        const oppCode = side === 'home' ? codeA : codeH;
        const short = (s: 'home' | 'away') => (s === 'home' ? m.homeShort : m.awayShort);
        const his = codeNames(hisCode, short(side), m[side]) || sameClub(m[side], man.club);
        const opp = codeNames(oppCode, short(other), m[other]);
        fixture = Math.max(fixture, his && opp ? 4 : his ? 1 : 0);
      }
    }
    let score = fixture;
    for (const man of group) if (!man.keeper && scorerOf(m.goal, man.name)) score += 2;
    // ENOUGH EVIDENCE is both sides of the fixture, or one side plus a man of his among the scorers. One
    // side alone is not: «MIL» is a word of «Inter Milan», and a code that fits half a fixture fits a
    // different match as easily as the right one.
    if (score < 3) continue;
    const earlier = best && Date.parse(m.kickoff) < Date.parse(best.kickoff);
    if (score > bestScore || (score === bestScore && earlier)) {
      best = m;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The scorer row of a man, by name, among the scorers of his match. Leghe writes the SURNAME and an
 * initial («Pellegrino M.», «Martinez L.», or just «Kane»); every surname word must appear in the
 * bookmaker's name, and the initial, when there is one, must open its first name. Two candidates left is
 * no answer: a price joined to the wrong man is worse than no price.
 */
export function scorerOf(
  scorers: readonly (OddsPrice & { name: string })[],
  legheName: string,
): (OddsPrice & { name: string }) | null {
  const parts = legheName.trim().split(/\s+/);
  const initials = parts.filter((p) => /^[A-Za-zÀ-ÿ]{1,2}\.$/.test(p)).map((p) => fold(p)[0]);
  const surname = fold(parts.filter((p) => !/^[A-Za-zÀ-ÿ]{1,2}\.$/.test(p)).join(' ')).split(' ').filter(Boolean);
  if (!surname.length) return null;
  const hits = scorers.filter((s) => {
    const words = fold(s.name).split(' ');
    if (!surname.every((w) => words.includes(w))) return false;
    if (!initials.length || words.length < 2) return true;
    const rest = words.filter((w) => !surname.includes(w));
    return rest.some((w) => w.startsWith(initials[0]));
  });
  return hits.length === 1 ? hits[0] : null;
}

/** What a roster row shows: the goal price for an outfield man, the clean-sheet price for a keeper. */
export interface ManOdds extends OddsPrice {
  kind: 'goal' | 'clean-sheet';
  match: string;
  /** The bookmakers' kick-off of that match (ISO, UTC): what says which matchday the price is for. */
  kickoff: string;
  taken: string;
  /** The bookmaker's own spelling of the scorer; for a keeper, the side whose clean sheet it is. */
  name?: string;
  side?: 'home' | 'away';
}

/**
 * Every roster man's price, joined in one pass: men are grouped by their real match (so a keeper alone in
 * his match still finds it through the codes or the club, and a team-mate's name helps the others), then
 * each one reads his own row - the goal price for an outfield man, the clean sheet of HIS side for a
 * keeper (the side is Leghe's own home/away flag).
 */
export function joinOdds(matches: readonly OddsMatch[], men: readonly OddsMan[]): Map<number, ManOdds> {
  const out = new Map<number, ManOdds>();
  const groups = new Map<string, OddsMan[]>();
  for (const man of men) groups.set(man.match, [...(groups.get(man.match) ?? []), man]);
  for (const group of groups.values()) {
    const m = matchFor(matches, group);
    if (!m) continue;
    const base = { match: m.match, kickoff: m.kickoff, taken: m.taken };
    for (const man of group) {
      if (man.keeper) {
        const side = man.home === false ? 'away' : man.home === true ? 'home'
          : sameClub(m.home, man.club) ? 'home' : sameClub(m.away, man.club) ? 'away' : null;
        const cs = side ? m.cleanSheet[side] : undefined;
        if (cs && side) out.set(man.id, { ...cs, ...base, kind: 'clean-sheet', side });
      } else {
        const scorer = scorerOf(m.goal, man.name);
        if (scorer) out.set(man.id, { ...scorer, ...base, kind: 'goal' });
      }
    }
  }
  return out;
}
