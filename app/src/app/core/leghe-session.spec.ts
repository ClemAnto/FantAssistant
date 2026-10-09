import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LegheSession, keyOf } from './leghe-session';

/**
 * THE LOCAL CACHE AS THE PAGE USES IT (operator, 09/10/2026: «limitiamo al minimo le richieste e utilizziamo
 * la cache locale»). The real store against a FAKE Leghe that counts what it is asked: a cold look, the same
 * look after a reload of the page, and «rileggi». Synthetic payloads with the real shapes, as in
 * `leghe-api.spec.ts`: the real ones carry the operator's tokens and leagues.
 *
 * Real timers on purpose: the requests go through the real lane, 400 ms apart, so a cold pass takes ~5 s.
 */

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';

/** Path (without the pass-through's `/leghe-api/classic` prefix) -> answer. */
const LEGHE: Record<string, { status?: number; body: unknown }> = {
  '/onboarding/v1/league/status': { body: { mday: 7 } },
  '/onboarding/v1/league/settings/lineup': { body: { mods: ['343'] } },
  '/onboarding/v1/league/settings/calculate': { body: {} },
  '/onboarding/v1/league/settings/rosters': { body: { sroles: 1 } },
  '/onboarding/v1/league/competitions': {
    body: [
      { id: 11, name: 'Campionato', type: 1, tmids: [5, 6] },
      { id: 12, name: 'Coppa', type: 7, tmids: [5, 6] },
    ],
  },
  '/onboarding/v1/league/teams/my': { body: { id: 5, n: 'Mia', d: 'A' } },
  '/gaming/v1/league/timing': { body: 3_600_000 },
  '/onboarding/v1/championship/teams': { body: { teams: [] } },
  '/onboarding/v1/league/teams?page=1&pageSize=50&division=A': {
    body: { data: [{ id: 5, n: 'Mia' }, { id: 6, n: 'Altra' }], pages: 1 },
  },
  '/gaming/v1/teamLineup/visualizza/A/11': {
    body: { lineUpInfo: [{ pid: 100, plyr: 'Uno' }], teamLineupDto: { mday: 3, ldate: 0 } },
  },
  // A cup with no matchday in play: Leghe's own «not found», which the page reads as «not active».
  '/gaming/v1/teamLineup/visualizza/A/12': { status: 400, body: { code: 'CE26', message: 'Calendar matchday not found.' } },
  '/onboarding/v1/league/competition/calendar/11': { body: [{ matchDay: 3, matches: [{ tIdH: 5, tIdA: 6 }] }] },
};

const LIVE = [
  '/onboarding/v1/league/status',
  '/gaming/v1/league/timing',
  '/gaming/v1/teamLineup/visualizza/A/11',
  '/gaming/v1/teamLineup/visualizza/A/12',
];

let asked: string[] = [];

function fakeLeghe(): void {
  asked = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const path = String(url).replace(/^\/leghe-api\/classic/, '');
    asked.push(path);
    const answer = LEGHE[path];
    if (!answer) return new Response('{"code":"NOPE"}', { status: 404 });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
}

function connected(): LegheSession {
  const session = TestBed.inject(LegheSession);
  session.acceptEmbed('classic', { id: 101, leagues: [{ id: 2001, name: 'Lega', alias: 'lega', jwt: TOKEN }] });
  return session;
}

/** The matchday the page would draw; a test that reaches it without one has nothing to assert. */
function day(session: LegheSession) {
  const value = session.matchday.value();
  if (!value) throw new Error('no matchday');
  return value;
}

/** Until the matchday has an answer and nothing is loading. */
async function settled(session: LegheSession): Promise<void> {
  for (let i = 0; i < 600; i++) {
    TestBed.tick();
    if (!session.matchday.isLoading() && (session.matchday.hasValue() || session.matchday.error())) return;
    await new Promise((go) => setTimeout(go, 50));
  }
  throw new Error('the matchday never settled');
}

describe('LegheSession and its local cache', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.resetTestingModule();
    fakeLeghe();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a cold look asks Leghe once per fact, and the page reloaded asks it NOTHING', async () => {
    const session = connected();
    await settled(session);
    expect(session.error()).toBeNull();
    const cold = [...asked];
    expect(new Set(cold).size).toBe(cold.length);
    expect(cold.length).toBe(Object.keys(LEGHE).length);
    expect(day(session).requests).toBe(cold.length);
    expect(day(session).roster.map((r) => r.fcId)).toEqual([100]);
    expect(day(session).competitions.map((c) => c.active)).toEqual([true, false]);

    // A reload of the page: a new store, the same browser storage (tokens in the tab, readings on disk).
    TestBed.resetTestingModule();
    asked = [];
    const again = TestBed.inject(LegheSession);
    await settled(again);
    expect(asked).toEqual([]);
    expect(day(again).requests).toBe(0);
    expect(day(again).roster.map((r) => r.fcId)).toEqual([100]);
    // The reading keeps the time it was TAKEN.
    expect(day(again).readAt.getTime()).toBeLessThanOrEqual(day(again).servedAt.getTime());
  }, 30_000);

  it('«rileggi» asks again ONLY the moving part: status, kick-off, the rosters of each competition', async () => {
    const session = connected();
    await settled(session);
    asked = [];
    session.refresh();
    await settled(session);
    expect([...asked].sort()).toEqual([...LIVE].sort());
    expect(day(session).requests).toBe(LIVE.length);
  }, 30_000);

  it('«svuota» forgets every reading and re-reads them all', async () => {
    const session = connected();
    await settled(session);
    expect(session.cacheSize()).toBe(Object.keys(LEGHE).length);
    asked = [];
    session.forgetCache();
    await settled(session);
    expect(asked.length).toBe(Object.keys(LEGHE).length);
  }, 30_000);

  it('a NEW TAB without a login draws the stored readings with their date, and asks Leghe nothing', async () => {
    // Operator, 09/10/2026: «memorizza i dati scaricati e riutilizzali in seguito senza fare il login».
    const session = TestBed.inject(LegheSession);
    session.acceptEmbed('classic', {
      id: 101,
      leagues: [
        { id: 2001, name: 'Lega', alias: 'lega', jwt: TOKEN },
        { id: 2002, name: 'Mai letta', alias: 'altra', jwt: TOKEN },
      ],
    });
    await settled(session);
    const taken = day(session).readAt.getTime();

    // The tab is closed: the tokens die with it, the readings and the memory of the account do not.
    TestBed.resetTestingModule();
    sessionStorage.clear();
    asked = [];
    const later = TestBed.inject(LegheSession);
    expect(later.connected('classic')).toBe(false);
    expect(later.leagues().map((l) => l.name)).toEqual(['Lega', 'Mai letta']);
    expect(later.offline()).toBe(true);
    await settled(later);
    expect(asked).toEqual([]);
    expect(day(later).requests).toBe(0);
    expect(day(later).roster.map((r) => r.fcId)).toEqual([100]);
    expect(day(later).readAt.getTime()).toBe(taken);

    // «Rileggi» without a token is not a request either (the page turns it into the login).
    later.refresh();
    await settled(later);
    expect(asked).toEqual([]);

    // A league the account has and this browser never read: said, not invented, and still nothing asked.
    later.choose(later.leagues()[1]);
    await settled(later);
    expect(later.error()?.kind).toBe('no-login');
    expect(asked).toEqual([]);

    // «Esci» is his own gesture: the account goes from this browser too.
    later.logout({ platform: 'classic', userId: 101 });
    TestBed.tick();
    expect(later.leagues()).toEqual([]);
  }, 30_000);

  it('MORE THAN ONE ACCOUNT per platform: each its own fantasquadre, its own cache, its own «Esci»', async () => {
    // Operator, 09/10/2026: «dammi la possibilità di aggiungere più fantasquadre ognuna con il suo account o dello
    // stesso account». Until that day a second Leghe login REPLACED the first.
    const session = connected();
    session.acceptEmbed('classic', {
      id: 202,
      leagues: [
        { id: 2001, name: 'Lega', alias: 'lega', jwt: TOKEN }, // the same league, his other team
        { id: 2003, name: 'Terza', alias: 'terza', jwt: TOKEN },
      ],
    });
    TestBed.tick();
    expect(session.accountList().map((a) => a.key)).toEqual(['classic:101', 'classic:202']);
    expect(session.leagues().map(keyOf)).toEqual(['classic:101:2001', 'classic:202:2001', 'classic:202:2003']);

    // The same league through the second account is another «my team»: its readings are filed under user 202.
    session.choose(session.leagues()[1]);
    await settled(session);
    expect(session.error()).toBeNull();
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('fantassistant.leghe-cache.'));
    expect(keys.some((k) => k.startsWith('fantassistant.leghe-cache.classic:202:2001:/'))).toBe(true);
    expect(session.teamName(session.leagues()[1])).toBe('Mia');

    // Logging in again with an account already listed refreshes it: no twin.
    session.acceptEmbed('classic', { id: 202, leagues: [{ id: 2003, name: 'Terza', alias: 'terza', jwt: TOKEN }] });
    TestBed.tick();
    expect(session.accountList().map((a) => a.key)).toEqual(['classic:101', 'classic:202']);
    expect(session.leagues().map(keyOf)).toEqual(['classic:101:2001', 'classic:202:2003']);

    // «Esci» takes ONE account and leaves the other.
    session.logout({ platform: 'classic', userId: 202 });
    TestBed.tick();
    expect(session.leagues().map(keyOf)).toEqual(['classic:101:2001']);
  }, 30_000);

  it('reads the logins stored in the old one-per-platform shape, and the league chosen with the old key', () => {
    // What a browser holds from before the list: `{classic: account}` in both stores, `classic:2001` chosen.
    const old = { platform: 'classic', userId: 101, via: 'embed', leagues: [{ platform: 'classic', id: 2001, name: 'Lega', alias: '', jwt: TOKEN, game: null }] };
    sessionStorage.setItem('leghe.accounts', JSON.stringify({ classic: old }));
    localStorage.setItem('fantassistant.leghe-known', JSON.stringify({ euro: { ...old, platform: 'euro', userId: 7, leagues: [{ ...old.leagues[0], platform: 'euro', id: 3001, jwt: undefined }] } }));
    localStorage.setItem('fantassistant.leghe-league', 'euro:3001');
    const session = TestBed.inject(LegheSession);
    expect(session.leagues().map((l) => [keyOf(l), l.jwt ? 'token' : 'stored'])).toEqual([
      ['classic:101:2001', 'token'],
      ['euro:7:3001', 'stored'],
    ]);
    expect(session.league() && keyOf(session.league()!)).toBe('euro:7:3001');
  });

  it('never keeps a token in the cache: the key is platform, user, league and path', async () => {
    const session = connected();
    await settled(session);
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('fantassistant.leghe-cache.'));
    expect(keys.length).toBe(Object.keys(LEGHE).length);
    expect(keys.every((k) => k.startsWith('fantassistant.leghe-cache.classic:101:2001:/'))).toBe(true);
    expect(keys.some((k) => k.includes(TOKEN)) || Object.values(localStorage).some((v) => String(v).includes(TOKEN))).toBe(false);
  }, 30_000);
});
