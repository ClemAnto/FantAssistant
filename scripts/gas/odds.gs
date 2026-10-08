/**
 * odds.gs - the bookmakers' price that a man SCORES, and that a club keeps a CLEAN SHEET, averaged over
 * many Italian books, for the coming matches of the five championships.
 *
 * From the operator's request (08/10/2026): «per ogni calciatore di movimento in rosa mi devi mostrare
 * anche la quota gol (media calcolata prendendo le quote da più siti di scommesse); per i portieri la
 * quota porta inviolata», then: «se troviamo delle api gratis ok, altrimenti leggiamo i bookmaker
 * italiani ... se ne riusciamo a trovare 3 adatti è già sufficiente».
 *
 * A SECOND FILE OF THE SAME APPS SCRIPT PROJECT as `probabili-sheet.gs`: it shares its helpers (`tab_`,
 * `log_`, `json_`, `iso_`) and its web-app deployment, and `doGet` there hands `?what=odds` to `oddsGet_`
 * here. Paste it as a new file in the same editor (File -> + -> Script, name it `odds`).
 *
 * -----------------------------------------------------------------------------------------------
 * WHY ODDSCHECKER AND NOT THE BOOKMAKERS ONE BY ONE - measured 08/10/2026 before a line was written:
 *
 *   free odds APIs           The Odds API has `player_goal_scorer_anytime` on the five championships but
 *                            with US bookmakers only, and no clean-sheet market; the others are paid.
 *   sisal / snai / lottomatica / goldbet / eurobet
 *                            behind Akamai or Cloudflare: 403 or a dropped connection to anything that is
 *                            not a full browser. Sisal and Snai answer to a real browser only.
 *   oddschecker.com/it/      200 to a plain GET, and ONE match page carries every market of that match
 *                            priced by the ITALIAN books it compares: 26 bookmakers listed, 12-13 of them
 *                            pricing each «Marcatore in qualsiasi momento», 3 pricing «Total Home Goals
 *                            Under 0.5». Server-rendered: the odds sit in the page's own island props, no
 *                            second call.
 *
 * So one page per match gives the average the operator asked for, over more books than three, and
 * the question of which three books to trust does not arise. Coverage of the five championships, read
 * off the league pages the same day: Serie A 20 matches, Premier 20, Bundesliga 18, Ligue 1 18, Liga
 * (path `spagna/liga`, not `la-liga`) the same.
 *
 * WHAT A CLEAN SHEET IS HERE. The «Clean Sheet» market exists on the page but its odds are not in the
 * server-rendered props; the SAME EVENT is priced under three other names that are: «Total Away Goals»
 * Under 0.5 and «Total Away Goals Exact» 0 (= the HOME side keeps a clean sheet), and the two home
 * mirrors. Every book on any of them prices one event, so they are pooled.
 *
 * WHAT IS STORED: per match and per selection, the mean of the decimal prices (what the operator asked
 * for: «la media delle quote»), how many books priced it, the lowest and the highest, and the mean of
 * the implied probabilities (1/price) - which is the number a model would read, and keeping both costs
 * nothing. The book margin is NOT removed: a price is what the operator sees at a counter.
 *
 * THIS IS A PRICE, AND IN THIS PROJECT A PRICE IS REPORTING. Nothing in the engine reads it - the
 * quotation rule («la quotazione è un giudizio, va per ULTIMA») applies to bookmakers too - and the
 * series kept here is what would let a harness judge it one day, which is why every capture is
 * APPENDED and not overwritten.
 * -----------------------------------------------------------------------------------------------
 *
 * INSTALL (after the main file is installed)
 *   1. paste this file, save
 *   2. run oddsProbe()      - does oddschecker answer a GOOGLE server? (it answered our laptop)
 *   3. run oddsInstall()    - arms a capture every morning and every evening
 *   4. Deploy -> Manage deployments -> edit -> New version, so `?what=odds` reaches the app
 */

// ==============================================================================================
// Configuration
// ==============================================================================================

var ODDS_BASE = 'https://www.oddschecker.com';

/** Championship -> oddschecker path. The keys are this project's championship names (`config.LEAGUES`). */
var ODDS_LEAGUES = {
  serie_a: '/it/calcio/italia/serie-a',
  premier_league: '/it/calcio/inghilterra/premier-league',
  la_liga: '/it/calcio/spagna/liga',
  bundesliga: '/it/calcio/germania/bundesliga',
  ligue_1: '/it/calcio/francia/ligue-1'
};

/** Only matches that kick off within this many days are read: the next round of every championship. */
var ODDS_HORIZON_DAYS = 8;

/** Pause between two pages, in ms. Measured 08/10/2026: at 1.5 s the last league of a sweep came back
 *  refused (2 Ligue 1 pages of 10), the same pages read at once a minute later - a rate limit, not a wall. */
var ODDS_PAUSE_MS = 3000;

/** An Apps Script run dies at six minutes. A sweep of ~50 pages does not fit, so a run stops at this
 *  budget, writes what it has, and schedules itself to go on a minute later with the leagues left. */
var ODDS_BUDGET_MS = 4.5 * 60 * 1000;

/** A browser's user agent: oddschecker's edge refuses obvious robots, and this reads a public page. */
var ODDS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

/** The markets read, by oddschecker's English bet-type name, and what each one is evidence of. */
var ODDS_SCORER = 'Anytime Goalscorer';
var ODDS_CLEAN = {
  // market -> [selection that means «nobody scores against <side>», the side that keeps the sheet]
  'Total Away Goals': { line: '0.5', pick: 'Under', side: 'home' },
  'Total Home Goals': { line: '0.5', pick: 'Under', side: 'away' },
  'Total Away Goals Exact': { pick: '0', side: 'home' },
  'Total Home Goals Exact': { pick: '0', side: 'away' }
};

/** The Quote tab, one row per selection per capture. */
var ODDS_TAB = 'Quote';
var ODDS_COLUMNS = ['taken_utc', 'league', 'match', 'kickoff_utc', 'home', 'away', 'home_short', 'away_short',
  'kind', 'side', 'name', 'mean_price', 'mean_prob', 'books', 'min_price', 'max_price'];

// ==============================================================================================
// Parsers - pure, so `verify-odds.mjs` can run them outside Google
// ==============================================================================================

/** The upcoming matches a league page lists: name, kick-off (ISO, UTC) and the page path. */
function oddsMatches_(html) {
  var out = [];
  var seen = {};
  var re = /"name":"([^"]+)","categoryGroupId":\d+,"categoryId":\d+,"eventId":\d+,"eventName":"[^"]*","startTime":"([^"]+)","endTime":"[^"]*","urlPath":"([^"]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (seen[m[3]]) continue;
    seen[m[3]] = true;
    out.push({ name: m[1], start: m[2], path: m[3] });
  }
  return out;
}

/** Astro serialises props as [0, value] / [1, array]; this undoes it. */
function oddsDeserialise_(v) {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') {
    if (v[0] === 1) return v[1].map(oddsDeserialise_);
    if (v[0] === 0) return oddsDeserialise_(v[1]);
    return v[1];
  }
  if (Array.isArray(v)) return v.map(oddsDeserialise_);
  if (v && typeof v === 'object') {
    var o = {};
    Object.keys(v).forEach(function (k) { o[k] = oddsDeserialise_(v[k]); });
    return o;
  }
  return v;
}

function oddsUnescape_(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
}

/**
 * A match page's markets: `{ home, away, markets: { betTypeName: bets[] } }`, or null when the page does
 * not carry the odds grid (a rebuilt page, a refused request that still answered 200).
 *
 * The bet-type name comes from `marketGroups` (market id -> name) and the prices from `oddsGrids`
 * (market id -> the server-rendered query): two halves of one island, joined by the market id.
 */
function oddsGrids_(html) {
  var re = /<astro-island[^>]*component-url="[^"]*GridGroupIsland[^"]*"[^>]*props="([^"]*)"/;
  var m = re.exec(html);
  if (!m) return null;
  var props;
  try {
    props = oddsDeserialise_(JSON.parse(oddsUnescape_(m[1])));
  } catch (e) {
    return null;
  }
  var args = props && props.componentArgs;
  if (!args || !args.oddsGrids || !args.marketGroups) return null;
  var names = {};
  Object.keys(args.marketGroups).forEach(function (g) {
    (args.marketGroups[g] || []).forEach(function (mk) { names[String(mk.ocMarketId)] = mk.betTypeName; });
  });
  var markets = {};
  var teams = null;
  Object.keys(args.oddsGrids).forEach(function (id) {
    var q = args.oddsGrids[id] && args.oddsGrids[id].queries && args.oddsGrids[id].queries[0];
    var data = q && q.state && q.state.data;
    if (!data || !data.bets || !names[id]) return;
    if (!teams && data.teams) teams = data.teams;
    markets[names[id]] = (markets[names[id]] || []).concat(data.bets);
  });
  if (!teams) return null;
  return {
    home: teams.home && teams.home.name, away: teams.away && teams.away.name,
    homeShort: teams.home && teams.home.shortName, awayShort: teams.away && teams.away.shortName,
    markets: markets
  };
}

/** The ACTIVE decimal prices of one selection, one per book. */
function oddsPrices_(bet) {
  return (bet.odds || [])
    .filter(function (o) { return o.status === 'ACTIVE' && typeof o.decimal === 'number' && o.decimal > 1; })
    .map(function (o) { return o.decimal; });
}

/** Mean price, mean implied probability, count, min, max - or null when nobody prices it. */
function oddsSummary_(prices) {
  if (!prices.length) return null;
  var sum = 0, prob = 0, lo = Infinity, hi = -Infinity;
  prices.forEach(function (p) { sum += p; prob += 1 / p; lo = Math.min(lo, p); hi = Math.max(hi, p); });
  var round = function (x, d) { var f = Math.pow(10, d); return Math.round(x * f) / f; };
  return {
    mean_price: round(sum / prices.length, 2), mean_prob: round(prob / prices.length, 4),
    books: prices.length, min_price: lo, max_price: hi
  };
}

/**
 * The rows of one match: one per scorer, and one per side for the clean sheet. `match` is the league
 * page's entry, `grids` what `oddsGrids_` read off the match page.
 */
function oddsRows_(league, match, grids, takenAt) {
  var rows = [];
  var base = function (kind, side, name, s) {
    return [takenAt, league, match.name, match.start, grids.home, grids.away, grids.homeShort, grids.awayShort,
      kind, side, name, s.mean_price, s.mean_prob, s.books, s.min_price, s.max_price];
  };
  (grids.markets[ODDS_SCORER] || []).forEach(function (bet) {
    var s = oddsSummary_(oddsPrices_(bet));
    if (s && bet.name) rows.push(base('goal', '', bet.name, s));
  });
  // The clean sheet: every book on any of the equivalent markets prices the same event, so pool them.
  var pools = { home: [], away: [] };
  Object.keys(ODDS_CLEAN).forEach(function (market) {
    var rule = ODDS_CLEAN[market];
    (grids.markets[market] || []).forEach(function (bet) {
      if (String(bet.name) !== rule.pick) return;
      if (rule.line && !(bet.line && String(bet.line.absolute) === rule.line)) return;
      pools[rule.side] = pools[rule.side].concat(oddsPrices_(bet));
    });
  });
  ['home', 'away'].forEach(function (side) {
    var s = oddsSummary_(pools[side]);
    if (s) rows.push(base('clean_sheet', side, side === 'home' ? grids.home : grids.away, s));
  });
  return rows;
}

// ==============================================================================================
// Capture
// ==============================================================================================

function oddsFetch_(path) {
  var res;
  try {
    res = UrlFetchApp.fetch(ODDS_BASE + path, {
      muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': ODDS_UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'it-IT,it;q=0.9' }
    });
  } catch (e) {
    return { ok: false, why: 'no answer (' + e.message + ')', html: '' };
  }
  var code = res.getResponseCode();
  if (code !== 200) return { ok: false, why: 'HTTP ' + code, html: '' };
  return { ok: true, why: '', html: res.getContentText() };
}

/** One page, retried once after a pause: a single 403 on back-to-back requests was seen, and it passed. */
function oddsFetchRetry_(path) {
  var one = oddsFetch_(path);
  if (one.ok) return one;
  Utilities.sleep(ODDS_PAUSE_MS * 3);
  return oddsFetch_(path);
}

/**
 * Read every championship's coming matches and APPEND their prices to the Quote tab.
 *
 * ONE SWEEP CAN SPAN SEVERAL RUNS: the leagues left and the sweep's own timestamp are kept in the script
 * properties, so a continuation writes under the SAME `taken_utc` - one capture, read in pieces - and the
 * reader's «latest capture of a match» does not see half a sweep as two.
 */
function captureOdds() {
  var props = PropertiesService.getScriptProperties();
  var pending = null;
  try { pending = JSON.parse(props.getProperty('odds.pending') || 'null'); } catch (e) { pending = null; }
  var sweep = pending || { takenAt: iso_(new Date()), queue: Object.keys(ODDS_LEAGUES) };
  var started = Date.now();
  var horizon = Date.now() + ODDS_HORIZON_DAYS * 86400000;
  while (sweep.queue.length) {
    if (Date.now() - started > ODDS_BUDGET_MS) break;
    var league = sweep.queue.shift();
    var rows = oddsLeague_(league, sweep.takenAt, horizon, started);
    if (rows.length) {
      var sh = oddsTab_();
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, ODDS_COLUMNS.length).setValues(rows);
    }
  }
  oddsClearContinuation_();
  if (sweep.queue.length) {
    props.setProperty('odds.pending', JSON.stringify(sweep));
    ScriptApp.newTrigger('captureOddsContinue').timeBased().after(60 * 1000).create();
    log_('odds', 'sweep', 'out of time: ' + sweep.queue.join(', ') + ' go on in a minute');
  } else {
    props.deleteProperty('odds.pending');
    try { CacheService.getScriptCache().remove('odds'); } catch (e) { /* nothing cached */ }
  }
}

/** One league: its rows, or none when its page is refused (logged, and the sweep goes on). */
function oddsLeague_(league, takenAt, horizon, started) {
  var page = oddsFetchRetry_(ODDS_LEAGUES[league]);
  if (!page.ok) { log_('odds', league, 'league page refused: ' + page.why); return []; }
  var matches = oddsMatches_(page.html).filter(function (mt) {
    var t = Date.parse(mt.start);
    return t > Date.now() && t < horizon;
  });
  var all = [], read = 0, refused = 0;
  matches.forEach(function (mt) {
    Utilities.sleep(ODDS_PAUSE_MS);
    var one = oddsFetchRetry_(mt.path);
    var grids = one.ok ? oddsGrids_(one.html) : null;
    if (!grids) { refused += 1; return; }
    var rows = oddsRows_(league, mt, grids, takenAt);
    if (rows.length) { all = all.concat(rows); read += 1; }
  });
  log_('odds', league, read + ' matches read of ' + matches.length + (refused ? ', ' + refused + ' refused' : '')
    + ' in ' + Math.round((Date.now() - started) / 1000) + ' s');
  return all;
}

/** The continuation has its OWN handler name, so it can be told apart from the two daily triggers and
 *  removed once it has fired: a one-off trigger left registered is clutter that piles up. */
function captureOddsContinue() { return captureOdds(); }

function oddsClearContinuation_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'captureOddsContinue') ScriptApp.deleteTrigger(t);
  });
}

function oddsTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ODDS_TAB);
  if (!sh) {
    sh = ss.insertSheet(ODDS_TAB);
    sh.getRange(1, 1, 1, ODDS_COLUMNS.length).setValues([ODDS_COLUMNS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // The two instants as TEXT: a Sheet turns an ISO string into a Date on its own, and a Date read back
    // compares as a locale string - «the latest capture» would then be decided by the day of the week.
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('D:D').setNumberFormat('@');
  }
  return sh;
}

// ==============================================================================================
// The public reading
// ==============================================================================================

/**
 * What `doGet?what=odds` serves: the LATEST capture of every match that has not kicked off yet (with a
 * three-hour grace, so a match in play still shows the price it was taken at). Small on purpose - the
 * app reads it live.
 */
function oddsGet_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('odds');
  if (cached) return json_(cached);
  var v = oddsTab_().getDataRange().getValues();
  var latest = {};
  for (var i = 1; i < v.length; i += 1) {
    var match = v[i][2], taken = oddsIso_(v[i][0]);
    if (!latest[match] || taken > latest[match]) latest[match] = taken;
  }
  var since = Date.now() - 3 * 3600000;
  var matches = {};
  for (var j = 1; j < v.length; j += 1) {
    var r = v[j];
    var kickoff = oddsIso_(r[3]);
    if (oddsIso_(r[0]) !== latest[r[2]] || Date.parse(kickoff) < since) continue;
    var key = r[2];
    if (!matches[key]) {
      matches[key] = { league: r[1], match: r[2], kickoff: kickoff, taken: oddsIso_(r[0]),
        home: r[4], away: r[5], homeShort: r[6], awayShort: r[7], goal: [], cleanSheet: {} };
    }
    var one = { price: r[11], prob: r[12], books: r[13], min: r[14], max: r[15] };
    if (r[8] === 'goal') matches[key].goal.push(Object.assign({ name: r[10] }, one));
    else matches[key].cleanSheet[r[9]] = one;
  }
  // EVERY UPCOMING MATCH, NOT ONLY EACH CLUB'S NEXT ONE. A EuroLeghe matchday bundles a different real round
  // in each championship (operator, 08/10/2026: «devi prendere ... per ogni calciatore quale è la sua
  // "prossima partita"»), so the match to price is the one LEGHE names for the man, and the app chooses it
  // against his fixture. Cutting here to «the club's earliest» could drop exactly that match.
  var body = JSON.stringify({
    what: 'bookmaker odds, mean over the Italian books oddschecker.com/it compares - a PRICE, not our prediction',
    matches: Object.keys(matches).map(function (k) { return matches[k]; })
  });
  try { cache.put('odds', body, 300); } catch (e) { /* over size: serve uncached */ }
  return json_(body);
}

/** A cell as an ISO instant, whether the Sheet kept the text or turned it into a Date anyway. */
function oddsIso_(cell) {
  return cell instanceof Date ? cell.toISOString().replace(/\.\d{3}Z$/, 'Z') : String(cell);
}

// ==============================================================================================
// Setup
// ==============================================================================================

/** Does oddschecker answer a Google server? Logs one league page and one match page. */
function oddsProbe() {
  var page = oddsFetchRetry_(ODDS_LEAGUES.serie_a);
  Logger.log('league page: ' + (page.ok ? 'ok, ' + page.html.length + ' chars' : page.why));
  if (!page.ok) return;
  var matches = oddsMatches_(page.html);
  Logger.log('matches listed: ' + matches.length);
  if (!matches.length) return;
  var one = oddsFetchRetry_(matches[0].path);
  var grids = one.ok ? oddsGrids_(one.html) : null;
  Logger.log(matches[0].name + ': ' + (grids
    ? oddsRows_('serie_a', matches[0], grids, iso_(new Date())).length + ' rows'
    : 'no grid (' + (one.why || 'page without odds') + ')'));
}

/** Two captures a day, morning and evening: a price moves with the news, a Leghe lineup closes at the
 *  first kick-off, and twice is enough to have a fresh one before any of them. */
function oddsInstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'captureOdds') ScriptApp.deleteTrigger(t);
  });
  [8, 19].forEach(function (hour) {
    ScriptApp.newTrigger('captureOdds').timeBased().everyDays(1).atHour(hour).create();
  });
  oddsTab_();
}
