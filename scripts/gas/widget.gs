/**
 * widget.gs - the real matches of the clubs a fantasquadra's men play for, for an Android home-screen widget.
 *
 * From the operator's request (10/10/2026): «un widget android che mostri sempre la lista delle partite reali
 * che interessano i miei calciatori ... data/orario di inizio quando non sono iniziate oppure il risultato live
 * e minuto (durante la partita) o definitivo (quando sono terminate). Cliccando sulla partita vorrei si aprisse
 * la pagina del dettaglio della partita su SofaScore», on the FREE version of KWGT, refreshed every 5 minutes.
 *
 * A THIRD FILE OF THE SAME APPS SCRIPT PROJECT as `probabili-sheet.gs` and `odds.gs`: it shares the web-app
 * deployment and `json_`, and `doGet` there hands `?what=widget` to `widgetGet_` here. Paste it as a new file in
 * the same editor (File -> + -> Script, name it `widget`), then run `widgetInstall` once.
 *
 * THE THREE HALVES, and who owns each:
 *   1. WHO my men are: the app's Lineup page POSTs them here («Invia al widget»), with the SofaScore team id of
 *      each man's club already resolved by the toolkit (`sofascore_clubs.json` in the bundle). Nothing here
 *      reads a Leghe account - the league tokens never leave the browser's sessionStorage.
 *   2. WHAT their clubs play: a 5-minute trigger asks SofaScore, which answers a Google server (measured
 *      10/10/2026: 200 on `/team/2697/events/next/0`, while our own PC still reads 403). A club's schedule is
 *      re-read every `WIDGET_SCHEDULE_TTL_H` hours; a match that is in play (or due) is re-read every run, so
 *      the cost is one request per live match per 5 minutes and NOTHING on a quiet day.
 *   3. HOW it is drawn: `doGet?what=widget` serves the list already formatted - one string per field - because
 *      a free KWGT widget reads a JSON path with `wg()` and is a poor place for date arithmetic.
 *
 * SECURITY. The POST must carry the secret stored in the script property `WIDGET_SECRET` (Project settings ->
 * Script properties); without that property every POST is refused. The GET is public like the rest of this
 * deployment («Chiunque»): it serves club names, scores and the names of the men you sent, which is worth knowing.
 */

var WIDGET_API = 'https://api.sofascore.com/api/v1';
/** How long a club's schedule is trusted: kick-off times move rarely, and a live match is re-read anyway. */
var WIDGET_SCHEDULE_TTL_H = 6;
/** The window the widget shows: finished matches of the last N hours, upcoming ones of the next N days. */
var WIDGET_PAST_H = 48;
var WIDGET_AHEAD_D = 7;
var WIDGET_MAX_ROWS = 30;
/**
 * The championships only (operator, 10/10/2026: «si filtra solo il campionato»): SofaScore's `uniqueTournament`
 * ids of the five EuroLeghe leagues - Serie A 23, Premier League 17, LaLiga 8, Bundesliga 35, Ligue 1 34. A cup,
 * a European night or a friendly of the same club is left out.
 */
var WIDGET_LEAGUES = [23, 17, 8, 35, 34];
/** A match is re-read every run from this many minutes before kick-off until it is final (or this many hours later). */
var WIDGET_LIVE_BEFORE_MIN = 5;
var WIDGET_LIVE_FOR_H = 4;
var WIDGET_DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

// ==============================================================================================
// 1. The squad, from the app
// ==============================================================================================

/**
 * The app posts `{secret, key, label, players: [{name, role, club, team}]}` as text/plain (a «simple» request,
 * so the browser sends it without a CORS preflight). `key` is one fantasquadra: sending it again REPLACES that
 * team, and `players: []` removes it. The answer says what was kept.
 */
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_(JSON.stringify({ ok: false, why: 'il corpo non e\' JSON' }));
  }
  var secret = PropertiesService.getScriptProperties().getProperty('WIDGET_SECRET');
  if (!secret) return json_(JSON.stringify({ ok: false, why: 'WIDGET_SECRET non e\' impostato nello script' }));
  if (body.secret !== secret) return json_(JSON.stringify({ ok: false, why: 'chiave segreta sbagliata' }));
  if (!body.key) return json_(JSON.stringify({ ok: false, why: 'manca la squadra' }));

  var squads = widgetSquads_();
  var players = (body.players || []).filter(function (p) { return p && p.name && Number(p.team) > 0; })
    .map(function (p) { return { name: String(p.name), role: String(p.role || ''), club: String(p.club || ''), team: Number(p.team) }; });
  if (players.length) squads[body.key] = { label: String(body.label || body.key), sentAt: new Date().toISOString(), players: players };
  else delete squads[body.key];
  PropertiesService.getScriptProperties().setProperty('widget:squads', JSON.stringify(squads));

  var out = refreshWidget();
  return json_(JSON.stringify({
    ok: true,
    teams: Object.keys(squads).length,
    players: players.length,
    matches: out ? out.rows.length : 0
  }));
}

function widgetSquads_() {
  var raw = PropertiesService.getScriptProperties().getProperty('widget:squads');
  try { return raw ? JSON.parse(raw) : {}; } catch (err) { return {}; }
}

// ==============================================================================================
// 2. The matches, from SofaScore
// ==============================================================================================

/** The 5-minute trigger. Also run after every POST, so a new squad shows at once. */
function refreshWidget() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return null;
  try {
    var props = PropertiesService.getScriptProperties();
    var squads = widgetSquads_();
    var teams = {};
    Object.keys(squads).forEach(function (k) {
      squads[k].players.forEach(function (p) { teams[p.team] = true; });
    });
    var now = Date.now();

    // Each club's schedule, re-read when it is older than the TTL.
    var schedules = {};
    var stale = [];
    Object.keys(teams).forEach(function (id) {
      var raw = props.getProperty('widget:team:' + id);
      var one = null;
      try { one = raw ? JSON.parse(raw) : null; } catch (err) { one = null; }
      // A schedule cached before `ut` was stored cannot be filtered by championship: read it again.
      var old = one && one.events.some(function (ev) { return ev.ut === undefined; });
      if (!one || old || now - one.at > WIDGET_SCHEDULE_TTL_H * 3600000) stale.push(id);
      schedules[id] = one;
    });
    if (stale.length) {
      var urls = [];
      stale.forEach(function (id) {
        urls.push(WIDGET_API + '/team/' + id + '/events/last/0');
        urls.push(WIDGET_API + '/team/' + id + '/events/next/0');
      });
      var answers = widgetFetchAll_(urls);
      stale.forEach(function (id, i) {
        var last = answers[2 * i], next = answers[2 * i + 1];
        // A club whose two reads both failed keeps what it had: an unanswered request is not «no matches».
        if (!last && !next) return;
        var events = [].concat(last ? last.events || [] : [], next ? next.events || [] : [])
          .map(widgetCompact_)
          .filter(function (ev) { return ev && WIDGET_LEAGUES.indexOf(ev.ut) >= 0 && widgetInWindow_(ev, now, 24); });
        schedules[id] = { at: now, events: events };
      });
    }

    // Every match of the window, once, even when two of my clubs play each other.
    var byId = {};
    Object.keys(schedules).forEach(function (id) {
      var one = schedules[id];
      if (!one) return;
      one.events.forEach(function (ev) { if (!byId[ev.id] || byId[ev.id].at < ev.at) byId[ev.id] = ev; });
    });

    // The matches in play (or due) are re-read every run.
    var live = Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (ev) {
      return !widgetFinal_(ev) && ev.start * 1000 <= now + WIDGET_LIVE_BEFORE_MIN * 60000 &&
        ev.start * 1000 >= now - WIDGET_LIVE_FOR_H * 3600000;
    });
    if (live.length) {
      var fresh = widgetFetchAll_(live.map(function (ev) { return WIDGET_API + '/event/' + ev.id; }));
      live.forEach(function (ev, i) {
        var one = fresh[i] && fresh[i].event ? widgetCompact_(fresh[i].event) : null;
        if (one) byId[one.id] = one;
      });
      // Put the fresh state back into each club's schedule, so the next run starts from it.
      Object.keys(schedules).forEach(function (id) {
        if (!schedules[id]) return;
        schedules[id].events = schedules[id].events.map(function (ev) { return byId[ev.id] || ev; });
      });
    }

    Object.keys(schedules).forEach(function (id) {
      if (schedules[id]) props.setProperty('widget:team:' + id, JSON.stringify(schedules[id]));
    });

    var out = widgetBuild_(squads, byId, now);
    var body = JSON.stringify(out);
    props.setProperty('widget:out', body);
    try { CacheService.getScriptCache().put('widget', body, 300); } catch (err) { /* over size */ }
    return out;
  } finally {
    lock.releaseLock();
  }
}

/** Parallel GETs; a failed one is null, never an empty answer (an empty answer would read as «no matches»). */
function widgetFetchAll_(urls) {
  if (!urls.length) return [];
  var requests = urls.map(function (url) {
    return { url: url, muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } };
  });
  var responses = UrlFetchApp.fetchAll(requests);
  return responses.map(function (r, i) {
    var code = r.getResponseCode();
    // 404 on `events/next/0` is the provider's way of saying «nothing scheduled»: that IS an answer.
    if (code === 404) return { events: [] };
    if (code !== 200) {
      Logger.log('widget: ' + code + ' on ' + urls[i]);
      return null;
    }
    try { return JSON.parse(r.getContentText()); } catch (err) { return null; }
  });
}

/** The few fields the widget reads, so a club's schedule fits a script property. */
function widgetCompact_(ev) {
  if (!ev || !ev.id || !ev.homeTeam || !ev.awayTeam) return null;
  var time = ev.time || {};
  return {
    id: ev.id,
    at: Date.now(),
    slug: ev.slug || '',
    customId: ev.customId || '',
    start: ev.startTimestamp,
    ut: ev.tournament && ev.tournament.uniqueTournament ? ev.tournament.uniqueTournament.id : null,
    league: ev.tournament && ev.tournament.uniqueTournament ? ev.tournament.uniqueTournament.name :
      (ev.tournament ? ev.tournament.name : ''),
    home: ev.homeTeam.shortName || ev.homeTeam.name,
    away: ev.awayTeam.shortName || ev.awayTeam.name,
    homeId: ev.homeTeam.id,
    awayId: ev.awayTeam.id,
    hs: ev.homeScore && ev.homeScore.current !== undefined ? ev.homeScore.current : null,
    as: ev.awayScore && ev.awayScore.current !== undefined ? ev.awayScore.current : null,
    type: ev.status ? ev.status.type : '',
    code: ev.status ? ev.status.code : null,
    desc: ev.status ? ev.status.description : '',
    cps: time.currentPeriodStartTimestamp || null,
    initial: time.initial || 0,
    max: time.max || null
  };
}

function widgetFinal_(ev) {
  return ['finished', 'canceled', 'postponed', 'interrupted', 'abandoned'].indexOf(ev.type) >= 0;
}

/** Inside the shown window, widened by `slackH` hours so a match about to enter it is already in the cache. */
function widgetInWindow_(ev, now, slackH) {
  var ms = ev.start * 1000;
  return ms >= now - (WIDGET_PAST_H + slackH) * 3600000 && ms <= now + (WIDGET_AHEAD_D * 24 + slackH) * 3600000;
}

// ==============================================================================================
// 3. The list, already formatted
// ==============================================================================================

function widgetBuild_(squads, byId, now) {
  // My men by club, and which fantasquadra each belongs to when there are several.
  var mine = {};
  var keys = Object.keys(squads);
  keys.forEach(function (k) {
    squads[k].players.forEach(function (p) {
      (mine[p.team] = mine[p.team] || []).push(p.name);
    });
  });

  var events = Object.keys(byId).map(function (k) { return byId[k]; })
    .filter(function (ev) {
      return WIDGET_LEAGUES.indexOf(ev.ut) >= 0 && widgetInWindow_(ev, now, 0) && (mine[ev.homeId] || mine[ev.awayId]);
    })
    .filter(function (ev) { return !(ev.type === 'finished' && ev.start * 1000 < now - WIDGET_PAST_H * 3600000); })
    .sort(function (a, b) { return a.start - b.start; })
    .slice(0, WIDGET_MAX_ROWS);

  var rows = events.map(function (ev) {
    var state = widgetFinal_(ev) ? 'done' : ev.type === 'inprogress' ? 'live' : 'pre';
    // A score only for a match being played or played: a cancelled or postponed one has a 0-0 that never happened.
    var played = state === 'live' || ev.type === 'finished';
    var score = ev.hs === null || ev.as === null || !played ? '' : ev.hs + ' - ' + ev.as;
    var when = state === 'pre' ? widgetWhen_(ev.start * 1000, now)
      : state === 'live' ? widgetMinute_(ev, now)
      : ev.type === 'finished' ? 'Finale' : widgetStatusIt_(ev.type);
    var men = [].concat(mine[ev.homeId] || [], mine[ev.awayId] || []);
    var title = ev.home + ' - ' + ev.away;
    return {
      state: state,
      title: title,
      score: score,
      when: when,
      league: ev.league,
      // The men of each side apart, for the widget's «show my men» toggle (a KWGT global switch that sets
      // the visibility of the line under the match): `players` both together, `homePlayers`/`awayPlayers` split.
      players: men.join(', '),
      homePlayers: (mine[ev.homeId] || []).join(', '),
      awayPlayers: (mine[ev.awayId] || []).join(', '),
      line: title + '   ' + (score ? score + '  ' : '') + when,
      url: 'https://www.sofascore.com/football/match/' + ev.slug + '/' + ev.customId + '#id:' + ev.id,
      start: new Date(ev.start * 1000).toISOString()
    };
  });

  var updated = Utilities.formatDate(new Date(now), 'Europe/Rome', 'dd/MM HH:mm');
  return {
    what: 'the real matches of the clubs of the men sent from the Lineup page, from SofaScore',
    updated: updated,
    teams: keys.map(function (k) { return squads[k].label; }),
    count: rows.length,
    // ONE STRING for the quickest widget: a single KWGT text item showing `.text` (with my men under each
    // match) or `.textShort` (the matches alone) - the widget's toggle picks one of the two.
    text: rows.length
      ? rows.map(function (r) { return r.line + '\n  ' + r.players; }).join('\n')
      : widgetEmpty_(keys),
    textShort: rows.length ? rows.map(function (r) { return r.line; }).join('\n') : widgetEmpty_(keys),
    // THE SAME LIST WITH KUSTOM'S TEXT TAGS (operator, 10/10/2026: a KWGT widget draws text, not HTML, so the
    // look travels inside the string): the match in bold, the score bold, the live minute in pink, my men
    // grey and in italics. `rich` has the men, `richShort` does not.
    rich: rows.length ? rows.map(function (r) { return widgetRich_(r, true); }).join('\n') : widgetEmpty_(keys),
    richShort: rows.length ? rows.map(function (r) { return widgetRich_(r, false); }).join('\n') : widgetEmpty_(keys),
    rows: rows
  };
}

/** One match in Kustom's BBCode-like tags. Square brackets inside a name would read as a tag, so they are dropped. */
function widgetRich_(r, withMen) {
  var plain = function (s) { return String(s || '').replace(/[\[\]]/g, ''); };
  var when = r.state === 'live' ? '[c=#FF5C93][b]' + plain(r.when) + '[/b][/c]' : '[c=#9A9AA8]' + plain(r.when) + '[/c]';
  var line = '[b]' + plain(r.title) + '[/b]  ' + (r.score ? '[b]' + plain(r.score) + '[/b]  ' : '') + when;
  return withMen && r.players ? line + '\n  [c=#9A9AA8][i]' + plain(r.players) + '[/i][/c]' : line;
}

function widgetEmpty_(keys) {
  return keys.length ? 'Nessuna partita nei prossimi giorni' : 'Nessuna rosa: usa «Invia al widget» dalla pagina Formazione';
}

/** «Oggi 20:45», «Domani 15:00», «Sab 18:00», in Italian time. */
function widgetWhen_(ms, now) {
  var day = Utilities.formatDate(new Date(ms), 'Europe/Rome', 'yyyy-MM-dd');
  var today = Utilities.formatDate(new Date(now), 'Europe/Rome', 'yyyy-MM-dd');
  var tomorrow = Utilities.formatDate(new Date(now + 86400000), 'Europe/Rome', 'yyyy-MM-dd');
  var hour = Utilities.formatDate(new Date(ms), 'Europe/Rome', 'HH:mm');
  if (day === today) return 'Oggi ' + hour;
  if (day === tomorrow) return 'Domani ' + hour;
  var weekday = Number(Utilities.formatDate(new Date(ms), 'Europe/Rome', 'u')) % 7; // u: 1 = Monday ... 7 = Sunday
  return WIDGET_DAYS[weekday] + ' ' + Utilities.formatDate(new Date(ms), 'Europe/Rome', 'dd/MM') + ' ' + hour;
}

/**
 * The minute as SofaScore draws it: seconds since the current period began plus the period's offset
 * (`time.initial`: 0 for the first half, 2700 for the second), «45+2'» past the period's length. Half time and
 * the other pauses are their own word. Up to 5 minutes old, which is the refresh the operator accepted.
 */
function widgetMinute_(ev, now) {
  if (ev.code === 31) return 'Intervallo';
  if (ev.code === 50) return 'Rigori';
  if (!ev.cps) return ev.desc || 'In corso';
  var minute = Math.floor((now / 1000 - ev.cps + ev.initial) / 60) + 1;
  var limit = ev.max ? Math.round((ev.initial + ev.max) / 60) : null;
  if (limit && minute > limit) return limit + '+' + (minute - limit) + "'";
  return minute + "'";
}

function widgetStatusIt_(type) {
  return { canceled: 'Annullata', postponed: 'Rinviata', interrupted: 'Sospesa', abandoned: 'Sospesa' }[type] || type;
}

/**
 * What `doGet?what=widget` serves: the last list built, never a fetch (the trigger does the fetching).
 * `?what=widgetPage` serves the same list as a PAGE, which the KWGT widget opens on a tap.
 */
function widgetGet_(e) {
  if (e && e.parameter && e.parameter.what === 'widgetPage') return widgetPage_();
  var cached = CacheService.getScriptCache().get('widget');
  if (cached) return json_(cached);
  return json_(widgetStored_());
}

function widgetStored_() {
  var body = PropertiesService.getScriptProperties().getProperty('widget:out');
  return body || JSON.stringify({ updated: null, count: 0, text: 'Widget non ancora aggiornato', rows: [] });
}

/**
 * THE PAGE THE WIDGET OPENS (operator, 10/10/2026: a hand-built KWGT row per match was too much work, so the
 * widget is one text with the list and one tap that opens this). Every match is a link to SofaScore, and the
 * «calciatori» switch shows or hides the men under each match - remembered on this phone when the browser lets
 * the page keep it.
 *
 * Links open with `target="_top"`: an Apps Script page lives in a sandboxed frame, and a plain link would try to
 * load SofaScore INSIDE that frame, which SofaScore refuses.
 */
function widgetPage_() {
  var out = JSON.parse(widgetStored_());
  var esc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var rows = (out.rows || []).map(function (r) {
    var right = r.score
      ? '<b class="score">' + esc(r.score) + '</b><span class="when ' + esc(r.state) + '">' + esc(r.when) + '</span>'
      : '<span class="when ' + esc(r.state) + '">' + esc(r.when) + '</span>';
    return '<a class="row ' + esc(r.state) + '" href="' + esc(r.url) + '" target="_top">' +
      '<div class="top"><span class="title">' + esc(r.title) + '</span><span class="right">' + right + '</span></div>' +
      '<div class="league">' + esc(r.league) + '</div>' +
      (r.players ? '<div class="men">' + esc(r.players) + '</div>' : '') +
      '</a>';
  }).join('');
  var self = ScriptApp.getService().getUrl() + '?what=widgetPage';
  var html =
    '<!doctype html><html lang="it"><head><meta charset="utf-8">' +
    '<style>' +
    ':root{--bg:#f6f6f8;--card:#fff;--fg:#14141c;--muted:#6b6b78;--line:#e3e3ea;--live:#d6336c;--done:#6b6b78}' +
    '@media (prefers-color-scheme:dark){:root{--bg:#0e0e14;--card:#17171f;--fg:#ececf2;--muted:#9a9aa8;--line:#2a2a36;--live:#ff6b9a}}' +
    'body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.35 system-ui,sans-serif}' +
    '*{box-sizing:border-box}' +
    'header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:12px 16px}' +
    'header small{color:var(--muted)}' +
    'label{display:flex;align-items:center;gap:6px;font-size:14px}' +
    'main{padding:0 12px 24px;display:flex;flex-direction:column;gap:8px}' +
    '.row{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}' +
    '.top{display:flex;justify-content:space-between;gap:8px}' +
    '.title{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.right{display:flex;gap:8px;white-space:nowrap;flex-shrink:0}' +
    '.score{font-variant-numeric:tabular-nums}.when{color:var(--muted)}.when.live{color:var(--live);font-weight:600}' +
    '.row.live{border-color:var(--live)}' +
    '.league{color:var(--muted);font-size:12px}.men{margin-top:4px;font-size:13px}' +
    'body.hide .men{display:none}' +
    'a.refresh{color:var(--muted);font-size:13px}' +
    '</style></head><body>' +
    '<header><div><b>Partite</b> <small>agg. ' + esc(out.updated || '-') + '</small> ' +
    '<a class="refresh" href="' + esc(self) + '" target="_top">aggiorna</a></div>' +
    '<label><input type="checkbox" id="men" checked> calciatori</label></header>' +
    '<main>' + (rows || '<p>' + esc(out.text) + '</p>') + '</main>' +
    '<script>' +
    'var box=document.getElementById("men");' +
    'try{if(localStorage.getItem("widget-men")==="0"){box.checked=false;document.body.classList.add("hide")}}catch(e){}' +
    'box.addEventListener("change",function(){document.body.classList.toggle("hide",!box.checked);' +
    'try{localStorage.setItem("widget-men",box.checked?"1":"0")}catch(e){}});' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Partite')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ==============================================================================================
// Setup
// ==============================================================================================

/** Run once: the 5-minute trigger. It costs nothing on a quiet day - no match in play means no request. */
function widgetInstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshWidget') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshWidget').timeBased().everyMinutes(5).create();
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'refreshWidget'; });
  Logger.log(triggers.length === 1
    ? 'OK: trigger refreshWidget attivo, ogni 5 minuti.'
    : 'ATTENZIONE: trovati ' + triggers.length + ' trigger refreshWidget invece di 1.');
  if (!PropertiesService.getScriptProperties().getProperty('WIDGET_SECRET')) {
    Logger.log('Manca WIDGET_SECRET: impostala in Impostazioni progetto -> Proprieta\' script e scrivi la stessa chiave nell\'app.');
  } else {
    Logger.log('OK: WIDGET_SECRET impostata. Ora ridistribuisci (Gestisci distribuzioni -> Nuova versione) e invia la squadra dall\'app.');
  }
}

/** Logs what the widget would show now, without waiting for the trigger. */
function widgetProbe() {
  var out = refreshWidget();
  Logger.log(out ? out.text : 'lock not acquired');
}
