/* FETCH FINISHED fanta-asta-live SESSIONS for the rival fits (05/10/2026). The same anonymous read the app performs
 * (`app/scripts/probe-live-session.mjs`): sign-in, one REST read per code, nothing written, no peer registered. The dumps
 * carry the listone - paid content - so they go to a gitignored folder and never into the repository.
 *
 *   node fetch-sessions.mjs CODES.txt ../../../data/raw/draft-sessions
 *
 * CODES.txt: session codes separated by spaces or new lines. A code the server no longer has answers null and is skipped.
 */
import { readFileSync, writeFileSync } from 'node:fs';
const KEY = 'AIzaSyAji5aMonqYhjfCnHU6YW4TgwOIh8x302Y';
const DB = 'https://leghe-fantagazzetta-app.firebaseio.com';
const [codesFile, outDir] = process.argv.slice(2);
const codes = readFileSync(codesFile, 'utf8').split(/\s+/).filter(Boolean)
  .filter((c) => !/xxx|abc|aaa|zzz|ghi/.test(c))
  .map((c) => `${c.slice(0, 2).toUpperCase()}-${c.slice(3).toLowerCase()}`);
const token = (await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json()).idToken;
const found = [];
for (const code of codes) {
  try {
    const r = await fetch(`${DB}/sessions/${code}.json?auth=${token}`);
    if (!r.ok) { console.log(code, r.status); continue; }
    const root = await r.json();
    if (!root) { console.log(code, 'null'); continue; }
    const state = root.state ?? {};
    const picks = Array.isArray(state.picks) ? state.picks.filter(Boolean) : Object.values(state.picks ?? {});
    console.log(code, 'market', state.marketType, 'picks', picks.length, 'env', !!root.env);
    writeFileSync(`${outDir}/${code}.json`, JSON.stringify(root));
    found.push(code);
  } catch (e) { console.log(code, 'err', e.message); }
  await new Promise((ok) => setTimeout(ok, 250));
}
console.log('saved', found.length);
