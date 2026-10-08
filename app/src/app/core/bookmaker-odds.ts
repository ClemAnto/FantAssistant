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
  /** The listone names of his club's whole squad: how his club is recognised in a bookmakers' match. */
  squad: readonly string[];
  /** The same for the opponent Leghe names; null when the bundle does not know that club. */
  opponentSquad: readonly string[] | null;
  /** The opponent's name as Leghe lists it, when it lists it. */
  opponentName: string | null;
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

/** How many men of a squad a bookmakers' match prices among its scorers - one join each, by name. */
export function squadOverlap(m: OddsMatch, squad: readonly string[]): number {
  let n = 0;
  for (const name of squad) if (scorerOf(m.goal, name)) n += 1;
  return n;
}

/**
 * Men of a squad that must be found among a match's scorers before it counts as THEIR match. Five, from the
 * payload of 08/10/2026 (52 matches, two rounds in four leagues, every club of both listoni against every
 * match): a club's own match prices **16 to 23** of its listone men, while a club NOT in the match never got
 * past **2** - a shared surname, a namesake. Five sits well inside that gap on both sides.
 */
export const SQUAD_EVIDENCE = 5;

/**
 * The bookmakers' match behind ONE Leghe fixture - and the fixture is LEGHE'S, recognised by its MEN and
 * never by a 3-letter label.
 *
 * The operator's rules (08/10/2026): «devi prendere ... per ogni calciatore quale è la sua "prossima
 * partita" e da lì confrontare le partite corrette», then «tre lettere sono poche visto l'enorme numero di
 * squadre, cerchiamo di rendere il controllo solido». So a match is THE fixture only on evidence about
 * people: at least `SQUAD_EVIDENCE` men of his club's squad among its scorers, AND the opponent confirmed -
 * by its squad the same way when the bundle knows that club, by Leghe's own name for it, or (only where
 * neither exists, an opponent outside the EuroLeghe perimeter) by its code against the bookmakers' short
 * name or name. A candidate that fails the opponent check is refused, not ranked lower: a price for the
 * wrong game reads exactly like a price for the right one. Two candidates left = no answer. The one weaker
 * path, for an opponent nothing can confirm, is spelled out at the bottom and needs three facts at once.
 */
export function matchFor(matches: readonly OddsMatch[], group: readonly OddsMan[]): OddsMatch | null {
  if (!group.length) return null;
  const [codeH, codeA] = group[0].match.split('-').map((c) => c ?? '');
  const short = (m: OddsMatch, side: 'home' | 'away') => (side === 'home' ? m.homeShort : m.awayShort);
  const strong: OddsMatch[] = [];
  const weak: OddsMatch[] = [];
  let withSquad = 0;
  for (const m of matches) {
    let isStrong = false;
    let isWeak = false;
    let squadHere = false;
    for (const man of group) {
      if (!man.squad.length || squadOverlap(m, man.squad) < SQUAD_EVIDENCE) continue;
      squadHere = true;
      const hisCode = man.home === false ? codeA : codeH;
      const oppCode = man.home === false ? codeH : codeA;
      // Which side is his, Leghe says (`hoaw`); without it either side may be checked.
      const sides: ('home' | 'away')[] = man.home === true ? ['home'] : man.home === false ? ['away'] : ['home', 'away'];
      for (const side of sides) {
        const other = side === 'home' ? 'away' : 'home';
        const opp = man.opponentSquad?.length
          ? squadOverlap(m, man.opponentSquad) >= SQUAD_EVIDENCE
          : (!!man.opponentName && sameClub(m[other], man.opponentName)) || codeNames(oppCode, short(m, other), m[other]);
        if (opp) isStrong = true;
        // His own club on the side Leghe gives it: the weaker confirmation, used only below.
        else if (codeNames(hisCode, short(m, side), m[side]) || sameClub(m[side], man.club)) isWeak = true;
      }
    }
    if (squadHere) withSquad += 1;
    if (isStrong) strong.push(m);
    else if (isWeak) weak.push(m);
  }
  if (strong.length) return strong.length === 1 ? strong[0] : null;
  // NOTHING CONFIRMS THE OPPONENT - an opponent outside the EuroLeghe perimeter whose code is another site's
  // convention (Leghe `SCP` for Paderborn). Then three facts must agree: his squad is in the match, his club
  // stands on the side Leghe says, and the payload holds no OTHER match of his club in the window. Short of
  // all three there is no price.
  return weak.length === 1 && withSquad === 1 ? weak[0] : null;
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
