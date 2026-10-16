/**
 * THE ROSTERS, SHARED BETWEEN DEVICES (16/10/2026). A fourth file of the probabili project, beside
 * `probabili-sheet.gs`, `odds.gs` and `widget.gs`, sharing their deployment and URL.
 *
 * The Lineup page reads the league's roster export (`app/src/app/core/roster-file.ts`), as many as he loads - one
 * entry per fantasquadra - and the operator asked that a roster loaded on one device be there on every device
 * («caricando una rosa su un dispositivo poi la rosa resta visibile per ogni dispositivo»). Each device keeps its
 * own list; this file keeps the MERGE of all of them.
 *
 *   POST {kind: 'rosters', secret, rosters: [...]}   merges them in and answers the merged list
 *   GET  ?what=rosters&secret=...                    answers the list: `{ok: true, rosters: [...]}`
 *
 * THE MERGE is per entry (`key`) and the newer `updatedAt` wins - a removal included, which travels as an entry
 * with `removed: true` (a tombstone), or a device that still had it would bring it back at its next sync.
 *
 * SECURITY: the same script property `WIDGET_SECRET` the widget uses, on BOTH ways, because a roster names a
 * league's squads. No credential travels here.
 *
 * Install: add this file to the project, then Deploy -> Manage deployments -> edit -> New version (the URL stays).
 */

/** One script property holds 9 KB at most: the list is kept in chunks, `rosters:n` = how many, then each. */
var ROSTERS_CHUNK = 8000;

function rosterSecretOk_(given) {
  var secret = PropertiesService.getScriptProperties().getProperty('WIDGET_SECRET');
  return !!secret && given === secret;
}

function rostersStored_() {
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('rosters:n'));
  if (!n) return [];
  var text = '';
  for (var i = 0; i < n; i++) text += props.getProperty('rosters:' + i) || '';
  try {
    var list = JSON.parse(text);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function rostersStore_(list) {
  var text = JSON.stringify(list);
  var props = PropertiesService.getScriptProperties();
  var n = Math.ceil(text.length / ROSTERS_CHUNK) || 1;
  var chunks = { 'rosters:n': String(n) };
  for (var i = 0; i < n; i++) chunks['rosters:' + i] = text.slice(i * ROSTERS_CHUNK, (i + 1) * ROSTERS_CHUNK);
  props.setProperties(chunks);
  props.getKeys().forEach(function (key) {
    var m = /^rosters:(\d+)$/.exec(key);
    if (m && Number(m[1]) >= n) props.deleteProperty(key);
  });
}

/** Per `key`, the entry with the later `updatedAt` (ISO strings compare as dates). */
function rostersMerge_(a, b) {
  var byKey = {};
  a.concat(b).forEach(function (one) {
    if (!one || typeof one.key !== 'string' || typeof one.updatedAt !== 'string') return;
    var seen = byKey[one.key];
    if (!seen || one.updatedAt > seen.updatedAt) byKey[one.key] = one;
  });
  return Object.keys(byKey).map(function (key) { return byKey[key]; });
}

function rosterPost_(body) {
  if (!rosterSecretOk_(body.secret)) return json_(JSON.stringify({ ok: false, why: 'chiave segreta sbagliata' }));
  if (!Array.isArray(body.rosters)) return json_(JSON.stringify({ ok: false, why: 'mancano le rose' }));
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var merged = rostersMerge_(rostersStored_(), body.rosters);
    rostersStore_(merged);
    return json_(JSON.stringify({ ok: true, rosters: merged }));
  } finally {
    lock.releaseLock();
  }
}

function rosterGet_(e) {
  if (!rosterSecretOk_(e && e.parameter ? e.parameter.secret : null)) {
    return json_(JSON.stringify({ ok: false, why: 'chiave segreta sbagliata' }));
  }
  return json_(JSON.stringify({ ok: true, rosters: rostersStored_() }));
}
