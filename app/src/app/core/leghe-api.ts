/**
 * LEGHE FANTACALCIO, READ FROM THE BROWSER (the operator, 08/10/2026: «una nuova pagina che ti aiuti ad
 * inserire la formazione per la prossima giornata»). This file is the wire: the two platforms, the login
 * payloads turned into one account model, and one function per endpoint. No Angular in here, so every
 * shape can be tested without a network.
 *
 * WHY A PROXY, MEASURED AND NOT ASSUMED (08/10/2026). Every Leghe microservice answers CORS for
 * `https://*.fantacalcio.it` only - a preflight from `clemanto.github.io` gets 204 without
 * `Access-Control-Allow-Origin`, on both hosts - and the list is HARD-CODED in the backend's shared
 * policy, so authorising this site would be a code change on five services, not a setting. The server
 * itself checks nothing about the origin (only `app_key` + the league Bearer), which is why the same
 * calls made from Node answered 200 on every endpoint read here. Hence: the browser talks to a small
 * pass-through of ours (`/leghe-api` under `ng serve`, a Worker on the published site) and the
 * pass-through talks to Leghe. It forwards; it decides nothing.
 *
 * THE TWO LOGINS ARE DIFFERENT ON PURPOSE.
 *  - Leghe (classic): the official EMBEDDED login, an iframe of `leghe.fantacalcio.it/embed`. The password
 *    is typed into fantacalcio's own page and never reaches this app; what arrives by `postMessage` is
 *    `{id, jwt, leagues[{id, name, alias, jwt}]}` - verified live 08/10/2026. It returns only the leagues
 *    with at least one competition a partner may see (on his account it returned two classic leagues of
 *    six; the one missing league that was checked has no competition this season).
 *  - EuroLeghe: the embedded login is NOT deployed there (the backend's deploy tags show the partners
 *    service never reached the euro production, and the iframe's own error path throws a DataCloneError,
 *    so the host does not even get the refusal). The operator's decision of 08/10/2026: «se su EuroLeghe
 *    non c'è login embed, usiamo login diretto in ogni caso» - so there the credentials go through our
 *    pass-through to `/onboarding/v1/login`, and the screen says so before he types.
 *
 * `app_key` IS NOT A SECRET, and that is stated rather than assumed: it ships in Leghe's own public JS
 * bundle and the backend's documentation calls it a noise filter, «non una protezione di sicurezza».
 * Same standing as a Firebase web config. The secrets here are the league JWTs, and those live in the
 * session store (`leghe-session.ts`), never in a file and never in a log.
 */

export type LeghePlatform = 'classic' | 'euro';

export interface LegheSite {
  /** What the operator calls it on screen. */
  label: string;
  /** The public site: the iframe's origin, i.e. the only origin a login message is accepted from. */
  site: string;
  /** The API host, which only the pass-through dials. */
  api: string;
  appKey: string;
  /** Whether the embedded login exists on this platform's production (see the header). */
  embed: boolean;
}

export const LEGHE: Record<LeghePlatform, LegheSite> = {
  classic: {
    label: 'Leghe',
    site: 'https://leghe.fantacalcio.it',
    api: 'https://apileague.fantacalcio.it',
    appKey: 'ICiELOObd5DF5uJEATi77CRvHiiRuMU0',
    embed: true,
  },
  euro: {
    label: 'EuroLeghe',
    site: 'https://euroleghe.fantacalcio.it',
    api: 'https://apieuroleague.fantacalcio.it',
    appKey: 'Ra0mTZqa9ZkgrSDZ7zQBOjJ29KavxqOt',
    embed: false,
  },
};

export const LEGHE_PLATFORMS: readonly LeghePlatform[] = ['classic', 'euro'];

/** One league of the logged account, with the token every league-scoped call needs. */
export interface LegheLeague {
  platform: LeghePlatform;
  id: number;
  name: string;
  alias: string;
  jwt: string;
  /** Read from the login where it says so (direct login); null where it does not (embed). */
  game: 'classic' | 'mantra' | null;
  /**
   * The account (user) the league was reached with, stamped by the session (`LegheSession.leagues`) and not by
   * the wire: one league reached by two accounts is two fantasquadre. Absent on a league straight off a login.
   */
  userId?: number;
}

export interface LegheAccount {
  platform: LeghePlatform;
  userId: number;
  via: 'embed' | 'direct';
  leagues: LegheLeague[];
}

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function asLeague(platform: LeghePlatform, raw: unknown, game: LegheLeague['game']): LegheLeague | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = Number(o['id']);
  const jwt = o['jwt'];
  if (!Number.isFinite(id) || typeof jwt !== 'string' || !JWT.test(jwt)) return null;
  return {
    platform,
    id,
    name: String(o['name'] ?? o['nome'] ?? id),
    alias: String(o['alias'] ?? ''),
    jwt,
    game,
  };
}

/**
 * The embedded login's success payload: `{id, jwt, leagues[{id, name, alias, jwt}]}`.
 *
 * Null when it is not that shape - a message that does not parse is not «an account with no leagues»,
 * and the modal tells the two apart.
 */
export function accountFromEmbed(platform: LeghePlatform, payload: unknown): LegheAccount | null {
  if (!payload || typeof payload !== 'object') return null;
  const o = payload as Record<string, unknown>;
  const userId = Number(o['id']);
  if (!Number.isFinite(userId) || !Array.isArray(o['leagues'])) return null;
  const leagues = (o['leagues'] as unknown[])
    .map((one) => asLeague(platform, one, null))
    .filter((one): one is LegheLeague => !!one);
  return { platform, userId, via: 'embed', leagues };
}

/**
 * The direct login's body: `{data: {utente: {id}, leghe: {<index>: {id, nome, alias, tipo_gioco, jwt}}}}`.
 * `leghe` is a dictionary keyed by an arbitrary index, not an array, and v2 answers without `data`.
 */
export function accountFromLogin(platform: LeghePlatform, body: unknown): LegheAccount | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const data = (root['data'] ?? root) as Record<string, unknown>;
  const user = (data['utente'] ?? {}) as Record<string, unknown>;
  const userId = Number(user['id'] ?? data['id']);
  const leghe = data['leghe'];
  if (!Number.isFinite(userId) || !leghe || typeof leghe !== 'object') return null;
  const leagues = Object.values(leghe as Record<string, unknown>)
    .map((one) => {
      const kind = Number((one as Record<string, unknown>)?.['tipo_gioco']);
      return asLeague(platform, one, kind === 2 ? 'mantra' : kind === 1 ? 'classic' : null);
    })
    .filter((one): one is LegheLeague => !!one);
  return { platform, userId, via: 'direct', leagues };
}

/** One cause, one message: the modal and the page print `text`, and `kind` decides what they offer. */
export type LegheErrorKind =
  /** No token in this tab and nothing stored for this league: there is neither a way to ask nor a reading to show. */
  | 'no-login'
  | 'no-proxy'
  | 'unreachable'
  | 'credentials'
  | 'expired'
  | 'refused'
  | 'unexpected';

export class LegheError extends Error {
  constructor(
    readonly kind: LegheErrorKind,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

/**
 * The codes the backend answers when a league token is no longer good (the Leghe front-end refreshes on
 * exactly these). Without the `token_auth` of a direct login there is no refresh to try, so all of them
 * read as «log in again».
 */
const EXPIRED_CODES = new Set(['ATH003', 'ATH004', 'ATH013', 'ATH015']);

/** Turn an HTTP answer into either its body or the ONE error that describes it. */
export function readAnswer(status: number, body: unknown): unknown {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const code = typeof o?.['code'] === 'string' ? (o['code'] as string) : null;
  const message = typeof o?.['message'] === 'string' ? (o['message'] as string) : '';
  if (status >= 200 && status < 300 && o?.['success'] !== false) return body;
  if (code === 'ATH018') {
    throw new LegheError('credentials', 'Nome utente o password non validi.', code);
  }
  if (status === 401 || (code && EXPIRED_CODES.has(code))) {
    throw new LegheError('expired', 'La sessione di Leghe è scaduta: rifai il login.', code);
  }
  throw new LegheError(
    'refused',
    `Leghe ha rifiutato la richiesta (${code ?? `HTTP ${status}`}${message ? `: ${message}` : ''}).`,
    code,
  );
}

/** Where the pass-through answers, or null when nobody has configured one for this site. */
export type ProxyBase = string | null;

export interface LegheCall {
  base: ProxyBase;
  platform: LeghePlatform;
  method: 'GET' | 'POST';
  path: string;
  jwt?: string;
  body?: unknown;
}

/**
 * ONE REQUEST AT A TIME, AND A PAUSE BETWEEN TWO (operator, 09/10/2026: «limitiamo al minimo le richieste ...
 * altrimenti la sicurezza ci blocca»). A cold pass of the LINEUP page asks Leghe about a dozen things; fired
 * together they are a burst, which is what a firewall reads as a script. In line and `SPACING_MS` apart they
 * cost a few seconds once. The cache (`leghe-cache.ts`) is what makes a cold pass rare; this makes the rare
 * one gentle. A declared spacing, not a measured threshold: nobody here knows Leghe's.
 */
export const SPACING_MS = 400;

let lane: Promise<unknown> = Promise.resolve();
let lastStart = 0;
let sent = 0;

/** Requests that actually left for Leghe since the page was opened: what «dalla cache» is counted with. */
export function legheRequestsSent(): number {
  return sent;
}

function inLane<T>(job: () => Promise<T>): Promise<T> {
  const run = lane.then(async () => {
    const wait = lastStart + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((go) => setTimeout(go, wait));
    lastStart = Date.now();
    sent += 1;
    return job();
  });
  // A failed request must not stop the ones queued behind it.
  lane = run.catch(() => undefined);
  return run;
}

/** The one door to the network. Every endpoint below goes through it, so every failure reads the same way. */
export async function legheCall(call: LegheCall): Promise<unknown> {
  if (!call.base) {
    throw new LegheError(
      'no-proxy',
      "Manca l'indirizzo dell'intermediario: da questo sito il browser non può parlare con Leghe direttamente.",
    );
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    app_key: LEGHE[call.platform].appKey,
  };
  if (call.jwt) headers['Authorization'] = `Bearer ${call.jwt}`;
  if (call.body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  let text: string;
  try {
    // The body is read INSIDE the lane: a request is not over until its answer has arrived.
    ({ response, text } = await inLane(async () => {
      const answer = await fetch(`${call.base}/${call.platform}${call.path}`, {
        method: call.method,
        headers,
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
      });
      return { response: answer, text: await answer.text() };
    }));
  } catch (err) {
    throw new LegheError(
      'unreachable',
      `Leghe non risponde (${err instanceof Error ? err.message.slice(0, 80) : String(err)}).`,
    );
  }
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new LegheError(
      'unexpected',
      `Risposta di Leghe non leggibile (HTTP ${response.status}): ${text.slice(0, 80)}`,
    );
  }
  return readAnswer(response.status, body);
}

/** Direct login, the EuroLeghe path. The password goes in the body of ONE request and is kept nowhere. */
export async function directLogin(
  base: ProxyBase,
  platform: LeghePlatform,
  username: string,
  password: string,
): Promise<LegheAccount> {
  const body = await legheCall({
    base,
    platform,
    method: 'POST',
    path: '/onboarding/v1/login',
    body: { username, password },
  });
  const account = accountFromLogin(platform, body);
  if (!account) throw new LegheError('unexpected', 'Il login è riuscito ma la risposta non ha la forma attesa.');
  return account;
}

/** A GET on a league-scoped endpoint. */
export function leagueGet(base: ProxyBase, league: LegheLeague, path: string): Promise<unknown> {
  return legheCall({ base, platform: league.platform, method: 'GET', path, jwt: league.jwt });
}

/** Milliseconds until the league's first match: `POST {}` (a GET answers 405), the body is a bare number. */
export async function readTiming(base: ProxyBase, league: LegheLeague): Promise<number | null> {
  const body = await legheCall({
    base,
    platform: league.platform,
    method: 'POST',
    path: '/gaming/v1/league/timing',
    jwt: league.jwt,
    body: {},
  });
  const ms = Number(body);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The lineup of the CURRENT matchday for one competition, with the roster's next-match facts.
 *
 * `CE26` («Calendar matchday not found») is not a failure: it is a competition with no matchday in
 * play right now (a cup that starts later), and the page shows it as such. Null says exactly that.
 */
export async function readLineup(
  base: ProxyBase,
  league: LegheLeague,
  division: string,
  competitionId: number,
): Promise<unknown | null> {
  try {
    return await leagueGet(base, league, `/gaming/v1/teamLineup/visualizza/${division}/${competitionId}`);
  } catch (err) {
    if (err instanceof LegheError && err.code === 'CE26') return null;
    throw err;
  }
}

/**
 * SAVE THE LINEUP of the logged team (operator, 09/10/2026: «permettimi di salvare sul leghe la formazione»):
 * `POST /gaming/v1/teamLineup/{division}`, the team taken by Leghe from the league token. The body is built and
 * checked by `leghe-lineup.saveBody`; this is the wire only. The ONE call of this file that writes.
 */
export function saveLineup(base: ProxyBase, league: LegheLeague, division: string, body: unknown): Promise<unknown> {
  return legheCall({
    base,
    platform: league.platform,
    method: 'POST',
    path: `/gaming/v1/teamLineup/${encodeURIComponent(division)}`,
    jwt: league.jwt,
    body,
  });
}

/** Every team of one division, across its pages (a division can hold more than one page). */
export async function readTeams(base: ProxyBase, league: LegheLeague, division: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 1; page <= 20; page++) {
    const body = (await leagueGet(
      base,
      league,
      `/onboarding/v1/league/teams?page=${page}&pageSize=50&division=${encodeURIComponent(division)}`,
    )) as { data?: unknown[]; pages?: number } | null;
    out.push(...(body?.data ?? []));
    if (!body?.pages || page >= body.pages) break;
  }
  return out;
}
