import { Injectable, computed, effect, resource, signal, untracked } from '@angular/core';

import {
  LEGHE_PLATFORMS,
  LegheAccount,
  LegheError,
  LegheLeague,
  LeghePlatform,
  ProxyBase,
  accountFromEmbed,
  directLogin,
  leagueGet,
  legheRequestsSent,
  readLineup,
  readTeams,
  readTiming,
} from './leghe-api';
import { Cached, LegheCache, Volatility, browserStore } from './leghe-cache';
import {
  Fixture,
  LeagueStatus,
  LegheCompetition,
  LegheTeam,
  NextMatchRow,
  RealTeam,
  SavedLineup,
  fixtureOf,
  parseCompetitions,
  parseRealTeams,
  parseRoster,
  parseSaved,
  parseStatus,
  parseTeam,
} from './leghe-matchday';
import { LineupRules, parseRules } from './leghe-rules';
import { storedText } from './view-state';

/**
 * THE PASS-THROUGH OF THE PUBLISHED SITE, empty until the operator deploys one (`proxy/leghe-worker.mjs`).
 * A default and not a constant, like the press sheet's address: the live value is `leghe-proxy-url` in
 * `localStorage`, pasted from the page, so a redeploy of the Worker needs no rebuild of the app.
 */
export const LEGHE_PROXY_DEFAULT = '';

/** What `ng serve` answers on (`proxy.conf.mjs`). */
const DEV_PROXY = '/leghe-api';

/**
 * WHERE THE TOKENS LIVE: `sessionStorage`, never `localStorage`. Two reasons, both about where this app is
 * hosted. A league JWT reads and (with the right endpoint) writes the operator's lineup, so it should die
 * with the tab - the same choice Fanta-Asta made for the same tokens. And `clemanto.github.io` is ONE
 * origin for every GitHub Pages site of the account: `localStorage` there is shared with any other page
 * he ever publishes, while `sessionStorage` belongs to this tab alone. Nothing else stores a token.
 */
const SESSION_KEY = 'leghe.accounts';

/**
 * WHAT SURVIVES THE TAB WITHOUT A TOKEN (operator, 09/10/2026: «una volta che fai login su Leghe/Euroleghe,
 * memorizza i dati scaricati e riutilizzali in seguito senza fare il login, mostra solo la data dell'ultimo
 * aggiornamento»): who logged in and which leagues he has - everything of an account but the `jwt`. With it a
 * new tab draws the last readings of the cache (`leghe-cache.ts`) and their date; only asking Leghe again needs
 * a login. In `localStorage`, like the readings themselves: a league's name and id are what the page already
 * shows, and the tokens still never leave `sessionStorage` (a test asserts it).
 */
const KNOWN_KEY = 'fantassistant.leghe-known';

export type KnownAccount = Omit<LegheAccount, 'leagues'> & { leagues: Omit<LegheLeague, 'jwt'>[] };

/**
 * MORE THAN ONE ACCOUNT PER PLATFORM (operator, 09/10/2026: «piuttosto che loggarti su un'unico account, dammi la
 * possibilità di aggiungere più fantasquadre ognuna con il suo account o dello stesso account»). An account is ONE
 * LOGIN, named by its platform and its user (`accountKey`); the store keeps a LIST of them. Until that day it kept
 * one per platform (`{classic, euro}`), so a second Leghe login replaced the first - and a list stored in that old
 * shape is read as the list of its values, so nobody has to log in again because the format changed.
 */
export function accountKey(account: Pick<LegheAccount, 'platform' | 'userId'>): string {
  return `${account.platform}:${account.userId}`;
}

/** A stored list, or the old one-per-platform record read as its values; anything else is nothing. */
function asList<T extends { platform: unknown; userId: unknown }>(parsed: unknown): T[] {
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? Object.values(parsed) : [];
  return list.filter((one): one is T => !!one && typeof one === 'object' && 'platform' in one && 'userId' in one);
}

function readList<T extends { platform: unknown; userId: unknown }>(store: Storage, key: string): T[] {
  try {
    const raw = store.getItem(key);
    return raw ? asList<T>(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function withoutToken(account: LegheAccount): KnownAccount {
  return {
    ...account,
    leagues: account.leagues.map(({ platform, id, name, alias, game }) => ({ platform, id, name, alias, game })),
  };
}

/** The list with `account` in it: in the place of the same login if there was one, at the end otherwise. */
function upsert<T extends Pick<LegheAccount, 'platform' | 'userId'>>(list: readonly T[], account: T): T[] {
  const key = accountKey(account);
  return list.some((one) => accountKey(one) === key)
    ? list.map((one) => (accountKey(one) === key ? account : one))
    : [...list, account];
}

/** One competition of the league on this matchday. */
export interface CompetitionDay {
  competition: LegheCompetition;
  /** Leghe has a matchday in play for it (otherwise it starts later, or is over). */
  active: boolean;
  fixture: Fixture | null;
  opponent: LegheTeam | null;
  saved: SavedLineup | null;
}

/** Everything the page shows about one league's next matchday, read in one pass. */
export interface LeagueMatchday {
  league: LegheLeague;
  status: LeagueStatus;
  rules: LineupRules;
  team: LegheTeam | null;
  teams: LegheTeam[];
  competitions: CompetitionDay[];
  roster: NextMatchRow[];
  /** Leghe's real clubs by id: what names the opponent of a man's next match. Empty when not read. */
  realTeams: Map<number, RealTeam>;
  /** When lineups close: the first match minus the league's own margin. Null = Leghe did not say. */
  closesAt: Date | null;
  /** When Leghe was READ for the moving part (roster, percentages, status): the oldest of those readings,
   *  which is not «now» when they come from the local cache (`leghe-cache.ts`). */
  readAt: Date;
  /** When this pass was served, what «closes in N minutes» is counted from. */
  servedAt: Date;
  /** Requests that left for Leghe in this pass: 0 = all of it from the local cache. */
  requests: number;
}

/**
 * THE LEGHE ACCOUNT AND THE MATCHDAY OF THE CHOSEN LEAGUE - one store, so «am I connected» and «what did
 * Leghe say» have one answer on every page that ever asks.
 */
@Injectable({ providedIn: 'root' })
export class LegheSession {
  readonly proxyUrl = storedText('leghe-proxy-url', LEGHE_PROXY_DEFAULT);

  /**
   * The pass-through to dial: the pasted address when there is one, the dev server's under `ng serve`,
   * and nothing at all on a published site that has none - which `legheCall` turns into its own message
   * instead of a «network error» that would read like Leghe being down.
   */
  readonly base = computed<ProxyBase>(() => {
    const pasted = this.proxyUrl().trim().replace(/\/+$/, '');
    if (pasted) return pasted;
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? DEV_PROXY : null;
  });

  /** The logins of THIS TAB, with their tokens: as many as he made, on either platform. */
  readonly accounts = signal<LegheAccount[]>(readList<LegheAccount>(sessionStorage, SESSION_KEY));

  /**
   * The accounts of past logins without their tokens (`KNOWN_KEY`): what a new tab shows before any login. A tab
   * that opens with tokens already in `sessionStorage` (a reload, or a login made before this memory existed)
   * counts as a login: its accounts are remembered from the start, not only at the next `adopt`.
   */
  private readonly known = signal<KnownAccount[]>(
    untracked(this.accounts).reduce<KnownAccount[]>(
      (list, account) => upsert(list, withoutToken(account)),
      readList<KnownAccount>(localStorage, KNOWN_KEY),
    ),
  );

  /**
   * Every account this browser knows, Leghe first and then in the order they were added, each saying whether
   * THIS TAB holds its token (`logged`) - what the Account modal lists, one row per login.
   */
  readonly accountList = computed(() => {
    const logged = new Set(this.accounts().map(accountKey));
    return LEGHE_PLATFORMS.flatMap((platform) =>
      this.known()
        .filter((account) => account.platform === platform)
        .map((account) => ({ ...account, key: accountKey(account), logged: logged.has(accountKey(account)) })),
    );
  });

  /**
   * Every league of every account - one FANTASQUADRA each, since an account fields one team per league - Leghe
   * first: with its token where this tab logged in, and with an EMPTY token where only a past login knows it,
   * which `readMatchday` reads as «show what is stored, ask nothing». Each carries the user it belongs to, so the
   * same league reached by two accounts is two entries (two different «my team»).
   */
  readonly leagues = computed<LegheLeague[]>(() => {
    const tokens = new Map(this.accounts().map((account) => [accountKey(account), account]));
    return this.accountList().flatMap((account) => {
      const logged = tokens.get(account.key);
      return logged
        ? logged.leagues.map((league) => ({ ...league, userId: account.userId }))
        : account.leagues.map((league) => ({ ...league, jwt: '', userId: account.userId }));
    });
  });

  /** The league on screen is drawn from STORED readings: no login in this tab, so nothing can be re-read. */
  readonly offline = computed(() => this.league()?.jwt === '');

  /**
   * The league the page looks at, remembered WITHOUT its token: `classic:101:4392237` (platform, user, league). A
   * key written before there could be two accounts (`classic:4392237`) still finds its league.
   */
  readonly chosenKey = storedText('leghe-league', '');

  readonly league = computed<LegheLeague | null>(() => {
    const all = this.leagues();
    const chosen = this.chosenKey();
    return (
      all.find((l) => keyOf(l) === chosen) ?? all.find((l) => `${l.platform}:${l.id}` === chosen) ?? all[0] ?? null
    );
  });

  /** Every reading of Leghe passes through here first (`leghe-cache.ts`, the operator's rule of 09/10/2026). */
  private readonly cache = new LegheCache(browserStore());

  /** How many readings the local cache holds, for the Account modal. */
  readonly cacheSize = signal(this.cache.size());

  /** Presses of «rileggi»: a new value forces the moving part of the next pass past the cache. */
  private readonly refreshes = signal(0);
  private served = 0;

  /**
   * THE CHOSEN LEAGUE'S MATCHDAY, as a `resource`: it re-reads by itself when the league changes, a newer
   * read supersedes an older one, and «loading / read / failed» are its own signals - no effect that
   * writes state, no ticket to compare. `undefined` params = nobody connected = idle. Re-reading is not
   * asking Leghe: what the cache holds and is young enough is served from there.
   */
  readonly matchday = resource({
    params: () => {
      const league = this.league();
      return league ? { league, refresh: this.refreshes() } : undefined;
    },
    loader: ({ params }) => {
      const force = params.refresh !== this.served;
      this.served = params.refresh;
      return this.readMatchday(params.league, force);
    },
  });

  /** The read's failure as ONE cause with its message (`LegheError`), whatever threw. */
  readonly error = computed<LegheError | null>(() => {
    const err = this.matchday.error();
    if (!err) return null;
    return err instanceof LegheError
      ? err
      : new LegheError('unexpected', `Errore imprevisto: ${err.message.slice(0, 120)}`);
  });

  constructor() {
    effect(() => {
      const value = this.accounts();
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
      } catch {
        // A browser that refuses session storage just asks for the login again on the next tab.
      }
    });
    effect(() => {
      const value = this.known();
      try {
        localStorage.setItem(KNOWN_KEY, JSON.stringify(value));
      } catch {
        // Refused storage: the next tab simply has nothing to show before a login.
      }
    });
  }

  /** At least one login of this tab on the platform. */
  connected(platform: LeghePlatform): boolean {
    return this.accounts().some((account) => account.platform === platform);
  }

  /** The embedded login's success message. False = it was not the shape Leghe documents. */
  acceptEmbed(platform: LeghePlatform, payload: unknown): boolean {
    const account = accountFromEmbed(platform, payload);
    if (!account) return false;
    this.adopt(account);
    return true;
  }

  /** Direct login. Throws the `LegheError` that names the cause; the password is not kept anywhere. */
  async loginDirect(platform: LeghePlatform, username: string, password: string): Promise<void> {
    this.adopt(await directLogin(this.base(), platform, username, password));
  }

  /**
   * «Esci», his own gesture, for ONE login: its token AND the memory of the account go, so nothing is shown in its
   * name. The other accounts stay as they are.
   */
  logout(account: Pick<LegheAccount, 'platform' | 'userId'>): void {
    const key = accountKey(account);
    this.dropToken(account);
    this.known.update((all) => all.filter((one) => accountKey(one) !== key));
  }

  /** The token only (an expired session): the stored readings stay on screen with their date. */
  private dropToken(account: Pick<LegheAccount, 'platform' | 'userId'>): void {
    const key = accountKey(account);
    this.accounts.update((all) => all.filter((one) => accountKey(one) !== key));
  }

  /**
   * The name of HIS TEAM in a league, from the stored reading of `teams/my` - asking nothing. What tells two
   * fantasquadre of one league (two accounts) apart in the selector; null until that league was read once.
   */
  teamName(league: Pick<LegheLeague, 'platform' | 'id' | 'userId'>): string | null {
    const stored = this.cache.stored<unknown>(`${league.platform}:${league.userId ?? 0}:${league.id}:/onboarding/v1/league/teams/my`);
    return (stored && parseTeam(stored.body)?.name) || null;
  }

  choose(league: LegheLeague): void {
    this.chosenKey.set(keyOf(league));
  }

  /** «Rileggi»: the roster, the percentages and the status asked again; rules and teams stay cached. */
  refresh(): void {
    this.refreshes.update((n) => n + 1);
  }

  /** «Svuota»: every reading forgotten, so the next pass asks Leghe for everything (rules included). */
  forgetCache(): void {
    this.cache.clear();
    this.cacheSize.set(this.cache.size());
    if (untracked(this.league)) this.refresh();
  }

  /** A login: a NEW account joins the list, the same login made again replaces its own entry and nothing else. */
  private adopt(account: LegheAccount): void {
    // PIN THE LEAGUE ON SCREEN before the list grows: with nothing remembered the selector shows the
    // FIRST league, and a second login (Leghe after EuroLeghe) would swap the page under his eyes.
    const shown = this.league();
    if (shown && !this.chosenKey()) this.chosenKey.set(keyOf(shown));
    this.accounts.update((all) => upsert(all, account));
    this.known.update((all) => upsert(all, withoutToken(account)));
  }

  /**
   * One pass over everything the page shows about a league's next matchday, each reading through the local
   * cache with the volatility of its fact (`leghe-cache.ts`). `force` («rileggi») skips the cache for the
   * `live` readings only: the rules of a league do not move because a percentage did.
   */
  private async readMatchday(league: LegheLeague, force: boolean): Promise<LeagueMatchday> {
    const base = this.base();
    // The key carries the USER, never the token: two accounts in one league see two different «my team».
    const user = league.userId ?? 0;
    // NO TOKEN IN THIS TAB: every fact is the stored reading, whatever its age, and nothing is asked - the page
    // says when they were taken. A fact never stored means this league was never read here, and that is said too.
    const offline = !league.jwt;
    const before = legheRequestsSent();
    let oldestLive = Number.POSITIVE_INFINITY;
    const cached = async <T>(path: string, volatility: Volatility, fetch: () => Promise<T>): Promise<Cached<T>> => {
      const key = `${league.platform}:${user}:${league.id}:${path}`;
      const stored = offline ? this.cache.stored<T>(key) : null;
      if (offline && !stored) {
        throw new LegheError('no-login', 'Nessun dato salvato per questa lega: collegati a Leghe per scaricarlo.');
      }
      const one = stored ?? (await this.cache.read(key, volatility, fetch, force && volatility === 'live'));
      if (volatility === 'live') oldestLive = Math.min(oldestLive, one.at);
      return one;
    };
    const get = (path: string, volatility: Volatility) =>
      cached(path, volatility, () => leagueGet(base, league, path)).then((one) => one.body);
    try {
      const [status, lineupSettings, calcSettings, rostersSettings, competitionsBody, myTeamBody, untilFirst] =
        await Promise.all([
          get('/onboarding/v1/league/status', 'live'),
          get('/onboarding/v1/league/settings/lineup', 'season'),
          get('/onboarding/v1/league/settings/calculate', 'season'),
          get('/onboarding/v1/league/settings/rosters', 'season'),
          get('/onboarding/v1/league/competitions', 'day'),
          get('/onboarding/v1/league/teams/my', 'day'),
          cached('/gaming/v1/league/timing', 'live', () => readTiming(base, league)),
        ]);
      const rules = parseRules(lineupSettings, calcSettings, rostersSettings);
      // The real clubs only NAME opponents for the odds join: a failure here costs that check, not the page.
      const realTeams = await get('/onboarding/v1/championship/teams', 'season')
        .then(parseRealTeams)
        .catch(() => new Map<number, RealTeam>());
      const team = parseTeam(myTeamBody);
      const division = team?.division ?? 'A';
      const teamsBody = await cached(`/onboarding/v1/league/teams?division=${division}`, 'day', () =>
        readTeams(base, league, division),
      );
      const teams = teamsBody.body.map(parseTeam).filter((t): t is LegheTeam => !!t);
      // Only the competitions this team is in: a league with divisions lists everybody's.
      const competitions = parseCompetitions(competitionsBody).filter(
        (c) => !team || !c.teamIds.length || c.teamIds.includes(team.id),
      );
      const days: CompetitionDay[] = [];
      let roster: NextMatchRow[] = [];
      for (const competition of competitions) {
        // `null` («no matchday in play», CE26) is a reading too, and is cached like one.
        const lineup = (
          await cached(`/gaming/v1/teamLineup/visualizza/${division}/${competition.id}`, 'live', () =>
            readLineup(base, league, division, competition.id),
          )
        ).body;
        const saved = lineup ? parseSaved(lineup) : null;
        if (lineup && !roster.length) roster = parseRoster(lineup);
        const fixture: Fixture | null =
          lineup && competition.headToHead && team && saved?.matchday
            ? fixtureOf(
                await get(`/onboarding/v1/league/competition/calendar/${competition.id}`, 'season'),
                saved.matchday,
                team.id,
              )
            : null;
        days.push({
          competition,
          active: !!lineup,
          fixture,
          opponent: fixture ? (teams.find((t) => t.id === fixture.opponentId) ?? null) : null,
          saved,
        });
      }
      const margin = (rules.closesMinutesBefore ?? 0) * 60_000;
      const now = Date.now();
      return {
        league,
        status: parseStatus(status),
        rules,
        team,
        teams,
        competitions: days,
        roster,
        realTeams,
        // The milliseconds Leghe gave are counted from when it GAVE them, which a cached reading keeps.
        closesAt: untilFirst.body === null ? null : new Date(untilFirst.at + untilFirst.body - margin),
        readAt: new Date(Number.isFinite(oldestLive) ? oldestLive : now),
        servedAt: new Date(now),
        requests: legheRequestsSent() - before,
      };
    } catch (err) {
      // An expired token is not a broken page: drop it - and only it - so the page goes back to the stored
      // readings with their date and «rileggi» asks for the login again.
      if (err instanceof LegheError && err.kind === 'expired') {
        this.dropToken({ platform: league.platform, userId: user });
      }
      throw err;
    } finally {
      this.cacheSize.set(this.cache.size());
    }
  }
}

/** A fantasquadra: the league AND the account that plays it (`classic:101:2001`). */
export function keyOf(league: Pick<LegheLeague, 'platform' | 'id' | 'userId'>): string {
  return `${league.platform}:${league.userId ?? 0}:${league.id}`;
}
