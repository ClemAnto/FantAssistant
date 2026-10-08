/**
 * THE DEV-SERVER PASS-THROUGH TO LEGHE (08/10/2026), used by `npm start` only.
 *
 * Leghe's APIs answer CORS for `https://*.fantacalcio.it` alone (measured, and hard-coded in their
 * backend), so a page on localhost cannot call them. Under `ng serve` the page calls `/leghe-api/<platform>`
 * on its own origin and the dev server forwards it from Node, where there is no CORS. The published site
 * needs the same thing as a small Worker (`proxy/leghe-worker.mjs`); this file is the local twin.
 *
 * It forwards and decides nothing. The `Origin`/`Referer` of the page are dropped because they are the
 * BROWSER's and say nothing true about this hop - the backend does not check them (read in its code and
 * measured from Node, 08/10/2026), so dropping them makes this request the same one a script would make.
 * Keep the two hosts in step with `LEGHE` in `src/app/core/leghe-api.ts`.
 */
const strip = (proxy) =>
  proxy.on('proxyReq', (request) => {
    request.removeHeader('origin');
    request.removeHeader('referer');
  });

export default {
  '/leghe-api/classic': {
    target: 'https://apileague.fantacalcio.it',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/leghe-api\/classic/, ''),
    configure: strip,
  },
  '/leghe-api/euro': {
    target: 'https://apieuroleague.fantacalcio.it',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/leghe-api\/euro/, ''),
    configure: strip,
  },
};
