import { Injectable, computed, effect, resource, signal } from '@angular/core';

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
  readLineup,
  readTeams,
  readTiming,
} from './leghe-api';
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

function readAccounts(): Partial<Record<LeghePlatform, LegheAccount>> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Record<LeghePlatform, LegheAccount>>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
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
  readAt: Date;
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

  readonly accounts = signal<Partial<Record<LeghePlatform, LegheAccount>>>(readAccounts());

  /** Every league of every connected platform, Leghe first. */
  readonly leagues = computed<LegheLeague[]>(() =>
    LEGHE_PLATFORMS.flatMap((p) => this.accounts()[p]?.leagues ?? []),
  );

  /** The league the page looks at, remembered WITHOUT its token: `classic:4392237`. */
  readonly chosenKey = storedText('leghe-league', '');

  readonly league = computed<LegheLeague | null>(() => {
    const all = this.leagues();
    return all.find((l) => keyOf(l) === this.chosenKey()) ?? all[0] ?? null;
  });

  /**
   * THE CHOSEN LEAGUE'S MATCHDAY, as a `resource`: it re-reads by itself when the league changes, a newer
   * read supersedes an older one, and «loading / read / failed» are its own signals - no effect that
   * writes state, no ticket to compare. `undefined` params = nobody connected = idle.
   */
  readonly matchday = resource({
    params: () => this.league() ?? undefined,
    loader: ({ params }) => this.readMatchday(params),
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
  }

  connected(platform: LeghePlatform): boolean {
    return !!this.accounts()[platform];
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

  logout(platform: LeghePlatform): void {
    this.accounts.update((all) => {
      const next = { ...all };
      delete next[platform];
      return next;
    });
  }

  choose(league: LegheLeague): void {
    this.chosenKey.set(keyOf(league));
  }

  private adopt(account: LegheAccount): void {
    // PIN THE LEAGUE ON SCREEN before the list grows: with nothing remembered the selector shows the
    // FIRST league, and a second login (Leghe after EuroLeghe) would swap the page under his eyes.
    const shown = this.league();
    if (shown && !this.chosenKey()) this.chosenKey.set(keyOf(shown));
    this.accounts.update((all) => ({ ...all, [account.platform]: account }));
  }

  /** One pass over everything the page shows about a league's next matchday. */
  private async readMatchday(league: LegheLeague): Promise<LeagueMatchday> {
    const base = this.base();
    try {
      const [status, lineupSettings, calcSettings, rostersSettings, competitionsBody, myTeamBody, untilFirst] =
        await Promise.all([
          leagueGet(base, league, '/onboarding/v1/league/status'),
          leagueGet(base, league, '/onboarding/v1/league/settings/lineup'),
          leagueGet(base, league, '/onboarding/v1/league/settings/calculate'),
          leagueGet(base, league, '/onboarding/v1/league/settings/rosters'),
          leagueGet(base, league, '/onboarding/v1/league/competitions'),
          leagueGet(base, league, '/onboarding/v1/league/teams/my'),
          readTiming(base, league),
        ]);
      const rules = parseRules(lineupSettings, calcSettings, rostersSettings);
      // The real clubs only NAME opponents for the odds join: a failure here costs that check, not the page.
      const realTeams = await leagueGet(base, league, '/onboarding/v1/championship/teams')
        .then(parseRealTeams)
        .catch(() => new Map<number, RealTeam>());
      const team = parseTeam(myTeamBody);
      const division = team?.division ?? 'A';
      const teams = (await readTeams(base, league, division))
        .map(parseTeam)
        .filter((t): t is LegheTeam => !!t);
      // Only the competitions this team is in: a league with divisions lists everybody's.
      const competitions = parseCompetitions(competitionsBody).filter(
        (c) => !team || !c.teamIds.length || c.teamIds.includes(team.id),
      );
      const days: CompetitionDay[] = [];
      let roster: NextMatchRow[] = [];
      for (const competition of competitions) {
        const lineup = await readLineup(base, league, division, competition.id);
        const saved = lineup ? parseSaved(lineup) : null;
        if (lineup && !roster.length) roster = parseRoster(lineup);
        const fixture: Fixture | null =
          lineup && competition.headToHead && team && saved?.matchday
            ? fixtureOf(
                await leagueGet(base, league, `/onboarding/v1/league/competition/calendar/${competition.id}`),
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
      return {
        league,
        status: parseStatus(status),
        rules,
        team,
        teams,
        competitions: days,
        roster,
        realTeams,
        closesAt: untilFirst === null ? null : new Date(Date.now() + untilFirst - margin),
        readAt: new Date(),
      };
    } catch (err) {
      // An expired token is not a broken page: drop it, so the page asks for the login again.
      if (err instanceof LegheError && err.kind === 'expired') this.logout(league.platform);
      throw err;
    }
  }
}

export function keyOf(league: Pick<LegheLeague, 'platform' | 'id'>): string {
  return `${league.platform}:${league.id}`;
}
