/**
 * THE PASS-THROUGH TO LEGHE FOR THE PUBLISHED SITE (08/10/2026), a Cloudflare Worker. Not deployed yet:
 * it needs the operator's own (free) Cloudflare account. The twin of `../proxy.conf.mjs`, which does the
 * same under `ng serve`.
 *
 * WHY IT EXISTS: Leghe's APIs answer CORS only for `https://*.fantacalcio.it` (measured 08/10/2026, and
 * hard-coded in their backend), so `clemanto.github.io` cannot call them from the browser. The server
 * itself checks nothing about the origin, so the same request made from here goes through.
 *
 * WHAT IT REFUSES TO BE: an open relay. It answers only the two origins of this app, forwards only to the
 * two Leghe API hosts, only the paths the Formazione page reads (plus the login), only GET and POST, and
 * only the headers those calls need. It logs nothing and stores nothing: the league token and - for the
 * EuroLeghe direct login - the password cross it in one request and are not kept.
 *
 * Deploy (from `app/proxy/`): `npx wrangler deploy leghe-worker.mjs --name leghe-proxy
 * --compatibility-date 2026-10-01`, then paste the `https://leghe-proxy.<account>.workers.dev` address
 * in the page («Account» -> intermediario).
 */

const ORIGINS = new Set(['https://clemanto.github.io', 'http://localhost:4200']);

const HOSTS = {
  classic: 'https://apileague.fantacalcio.it',
  euro: 'https://apieuroleague.fantacalcio.it',
};

/** What the page reads: keep in step with `src/app/core/leghe-api.ts` and `leghe-session.ts`. */
const PATHS = [
  /^\/onboarding\/v1\/login$/,
  /^\/onboarding\/v1\/league\/(status|competitions|teams\/my|teams)$/,
  /^\/onboarding\/v1\/league\/settings\/(lineup|calculate|rosters)$/,
  /^\/onboarding\/v1\/league\/competition\/calendar\/\d+$/,
  /^\/onboarding\/v1\/championship\/teams$/,
  /^\/gaming\/v1\/teamLineup\/visualizza\/[A-Z]{1,2}\/\d+$/,
  /^\/gaming\/v1\/league\/timing$/,
];

const FORWARDED = ['accept', 'app_key', 'authorization', 'content-type'];

function cors(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST',
    'access-control-allow-headers': 'accept, app_key, authorization, content-type',
    'access-control-max-age': '7200',
    vary: 'origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('origin') ?? '';
    if (!ORIGINS.has(origin)) return new Response('origin not allowed', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('method not allowed', { status: 405, headers: cors(origin) });
    }

    // `/<platform>/<leghe path>`, the shape the page uses for `/leghe-api` under `ng serve`.
    const url = new URL(request.url);
    const [, platform, ...rest] = url.pathname.split('/');
    const host = HOSTS[platform];
    const path = '/' + rest.join('/');
    if (!host || !PATHS.some((p) => p.test(path))) {
      return new Response('path not allowed', { status: 404, headers: cors(origin) });
    }

    const headers = new Headers();
    for (const name of FORWARDED) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const upstream = await fetch(host + path + url.search, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? await request.text() : undefined,
    });
    const answer = new Headers(cors(origin));
    answer.set('content-type', upstream.headers.get('content-type') ?? 'application/json');
    answer.set('cache-control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers: answer });
  },
};
