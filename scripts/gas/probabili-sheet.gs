/**
 * probabili-sheet.gs - which site predicts a Serie A line-up best, measured inside one Sheet.
 *
 * From the operator's request (18/09/2026): "uno script che per ogni giornata di serie-a, subito
 * prima dell'inizio del primo anticipo, scansioni i siti principali che mostrano le probabili
 * formazioni e segni per ognuno le probabili indicate; poi alla fine del turno crei un report con i
 * calciatori corretti e quelli sbagliati. A lungo termine verificheremo quale e' il sito piu'
 * attendibile".
 *
 * WHY A SHEET AND NOT A GITHUB RUNNER. The cloud plan had died on one objection - the only place a
 * GitHub runner may write is the PUBLIC repository, and a capture is paid content. A Drive is
 * private, so that objection does not exist here. The second reason decides the design below: this
 * file must answer the whole question with the laptop switched off, because a probabili page shows
 * only "now" and a round not taken is a round lost for ever.
 *
 * ONE PHOTOGRAPH PER ROUND, TAKEN BEFORE IT OPENS - his own words above, "subito prima dell'inizio del
 * primo anticipo", restated on 21/09/2026 after the first round measured showed the code had drifted
 * from them: see LEAD_MINUTES for the rule, its price and what the drift cost.
 *
 * IT KEEPS THE PHOTOGRAPH. Every fetch is saved to Drive gzipped BEFORE anything is parsed, exactly
 * as fc_site does on the laptop: the photographs ARE the historical series, and the rows in the
 * Sheet are a READING of them. If a parser is wrong the evidence is still on disk and the reading
 * can be redone - `recover(round)` is what redoes it, and until 21/09/2026 that promise had no
 * function behind it.
 *
 * -----------------------------------------------------------------------------------------------
 * WHAT WAS MEASURED BEFORE ANY OF THIS WAS WRITTEN (18/09/2026, anonymous client, no credentials):
 *
 *   fantacalcio.it          200 | 765 KB | 20 team cards | 477 players | fc_id IN THE HREF | per-man %
 *   sport.sky.it            200 | 493 KB | 20 clubs | 10 match tables | shirt number + own player id
 *   corrieredellosport.it   200 | 535 KB | 20 clubs | 110+110 starters | declares its data is OPTA
 *   sosfanta.com            200 | 547 KB | 20 clubs | per-man % | NAMES the duels | ISO kick-offs
 *   gazzetta.it             200 | 0 real shapes | the page DECLARES its own wall:
 *                           "isAccessibleForFree":false and cssSelector ".bck-freemium__wall"
 *
 * A 200 proves nothing here, and that is why the counts are above: the refused site answers 200 too.
 * The guard counts REAL shapes - the rulebook's, whose digits sum to ten - because '3-2-4' and
 * '4-2-1' passed a naive n-n-n pattern on a page that carries no eleven at all.
 *
 * AND SOS FANTA IS HERE BECAUSE THE FIRST VERDICT ON IT WAS WRONG, twice over, which is worth more
 * than the source. It was filed as "login, and the eleven is drawn on a CANVAS": the canvas count
 * came from grepping the string `canvas`, which was matching `offcanvas-menu` - driven in a real
 * browser the page has ZERO canvas elements and makes no data call at all. And the page that carries
 * the elevens was never tried: `/probabili-formazioni/` is an index of one ARTICLE PER FIXTURE, while
 * `/lista-formazioni/probabili-formazioni-serie-a/` is the table, server-rendered, no JavaScript
 * needed. That URL is LINKED FROM the hub - i.e. the discovery pass this file already ran for the
 * other sites would have found it.
 *
 * The lesson is the durable half: ONCE A SOURCE IS FILED AS REFUSED, THE METHOD THAT WOULD OVERTURN
 * THE VERDICT STOPS BEING APPLIED TO IT. A premature no is expensive in a way a premature yes is not,
 * because nothing later contradicts it.
 *
 * THE TRUTH IS EXACT AND COSTS ONE REQUEST. fantacalcio.it's voti page for a played round carries,
 * per club, every man who got a vote, with the SAME fc_id, and an icon title="Subentrato" on
 * whoever came on. So "he started" = he has a vote and is not marked as having come on. Measured on
 * rounds 2, 3 and 4 of 2026-27: 20 club blocks, ELEVEN starters each, 220 total, 220 distinct ids -
 * three times out of three. That invariant is ASSERTED at every scoring run rather than trusted.
 * -----------------------------------------------------------------------------------------------
 *
 * INSTALL
 *   1. sheets.new -> Extensions -> Apps Script -> paste this file -> save
 *   2. run probe()     (authorise when asked: UrlFetch, Drive, Sheets)
 *   3. run install()   once: builds the tabs and arms the daily planner
 *   4. nothing else. The "Probabili" menu in the Sheet does the same things by hand.
 */

// ==============================================================================================
// Configuration
// ==============================================================================================

/** One source = one entry plus its parser. Adding a site is adding a row here. */
var SOURCES = {
  fantacalcio: {
    label: 'fantacalcio.it',
    url: 'https://www.fantacalcio.it/probabili-formazioni-serie-a',
    parse: 'parseFantacalcio_',
    // The only source that publishes OUR primary key, so it also lends its identity to the others.
    hasFcId: true
  },
  sky: {
    label: 'sport.sky.it',
    url: 'https://sport.sky.it/calcio/serie-a/probabili-formazioni',
    parse: 'parseSky_',
    hasFcId: false
  },
  corriere: {
    label: 'corrieredellosport.it',
    url: 'https://www.corrieredellosport.it/probabili-formazioni/calcio/serie-a',
    parse: 'parseCorriere_',
    hasFcId: false
  },
  // Added 18/09/2026 on the operator's request, and it is here because a first verdict was WRONG.
  // See the header: the page that carries the elevens is /lista-formazioni/..., not the hub that was
  // probed first. It is the only source besides fantacalcio that publishes a per-man percentage, and
  // the only one of all four that NAMES the duels ("Ballottaggi 60% - 40% Skorupski - Pessina").
  sosfanta: {
    label: 'sosfanta.com',
    url: 'https://www.sosfanta.com/lista-formazioni/probabili-formazioni-serie-a/',
    parse: 'parseSosfanta_',
    hasFcId: false
  }
};

/** The truth. The page honours {season} and {round}: measured, three different rounds returned three
 *  different pages, so the parameter is not ignored - the trap this project has paid for elsewhere. */
var TRUTH_URL = 'https://www.fantacalcio.it/voti-fantacalcio-serie-a/{season}/{round}';

/**
 * When the OFFICIAL line-ups are published, in minutes before kick-off. DECLARED by the operator
 * (18/09/2026: "mezz'ora prima danno le formazioni ufficiali"), not measured here - it is a fact about
 * how the league publishes, the same standing as the rulebooks this project reads and never fits.
 *
 * IT IS THE MOST IMPORTANT NUMBER IN THIS FILE, because it is the line between a forecast and a copy
 * of the answer. A reading taken after it is not a late prediction: the eleven is already known, every
 * source would name it, and the ranking would say all four are near-perfect while measuring nothing.
 * The first version of this file reasoned "about an hour" from memory and timed the capture twenty
 * minutes before kick-off - i.e. ten minutes INSIDE the window, on the one fixture it was built for.
 */
var OFFICIAL_MINUTES = 30;
// It is REPORTING and not a rule - see LEAD_MINUTES for the line that IS the rule.

/**
 * How long before the round's FIRST kick-off the one capture of the round fires. Fifteen minutes, the
 * operator's own number (18/09/2026).
 *
 * THE LINE IS THE OPENER, AND IT APPLIES TO EVERY CLUB OF THE ROUND. His rule of 21/09/2026: «il
 * meccanismo di lettura deve avvenire solo fino a quando la prima partita del turno non inizia, dopo
 * non si deve piu' aggiornare: si deve prendere la fotografia delle predizioni per ogni sito solo
 * quando le partite non sono ancora giocate». One photograph per source per round, taken while the
 * round is entirely unplayed - which is the same definition this project already uses for the board
 * judges: the press is the only judge that exists before a ball is kicked.
 *
 * IT REPLACES A PER-CLUB DEADLINE, and the first round measured is why. Until 21/09 the capture fired
 * fifteen minutes before EACH club's own kick-off, so a club playing on Sunday was photographed on
 * Sunday - after its official line-up was out. Round 5 came back reading fantacalcio 100.0% of the
 * real elevens, sosfanta 99.1%, sky 92.3%, and the capture log said why in its own words: "100% of the
 * men are given at 100%: this reading may be the OFFICIAL line-up rather than a forecast". A ranking
 * where three sources sit within two points of perfect is not measuring forecasting.
 *
 * THE PRICE IS STATED. Against the opener the other nineteen fixtures are one to three days away, so
 * every share will FALL and some will fall to the null (the eleven that started the club's previous
 * match). That is the point: the null is what a forecast has to beat, and on round 5 the only source
 * measured this way - corrieredellosport.it, whose later pages were refused, so it was scored on its
 * Friday photograph at an average of 30 hours - read 81.4% against a null of 80.9%.
 *
 * WHAT IT DOES NOT BUY IS A CLEAN WINDOW FOR THE OPENER'S OWN TWO CLUBS. At fifteen minutes their
 * line-ups are already announced, so two clubs of twenty stay inside the official window. The residue
 * is not hidden: `after_official` still marks exactly those rows, and it is now a number to read
 * rather than a caveat to remember.
 */
var LEAD_MINUTES = 15;

/** When the daily planner reads the day's fixtures. Early enough to precede any kick-off (the
 *  earliest Serie A slot is 12:30) and late enough that the pages carry the round. */
var PLAN_HOUR = 9;

/** A capture is refused below this many clubs. A page answering 200 with half the league is a page
 *  being rebuilt, and half a round stored as a whole one is a defect this project has already paid
 *  for: a matchday voted half way was read as complete. */
var MIN_CLUBS = 16;

var FOLDER = 'FantAssistant - probabili';
var KEEP_DAYS = 90;
var UA = 'FantAssistant/1.0 (+personal use)';

/** How many of the rulebook's shapes a LINE-UP page must carry to be believed. Five, measured: the
 *  three readable sites carry 6-7 and the two refused ones carry 0. It does NOT apply to the truth
 *  page, which is a table of grades and carries none - see `fetch_`. */
var MIN_SHAPES = 5;

/** How many clubs a complete round has. Serie A's twenty, and it is the number the truth page must
 *  carry before a round is scored: fewer means the round is not fully graded, not that those clubs
 *  played badly. */
var CLUBS_IN_LEAGUE = 20;

/** Above this share of men given at 100%, a reading is flagged as possibly the OFFICIAL line-up and
 *  not a forecast. Half, declared and not measured: the number that matters is the one tonight's
 *  capture writes into the Log, and until that exists a threshold here would be a guess dressed up. */
var CERTAIN_SHARE = 0.5;

/** The rulebook's own shapes - used only to tell a page that carries elevens from one that does not. */
var REAL_SHAPES = ['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-3-2', '5-4-1', '4-2-3-1',
  '3-4-2-1', '4-3-1-2', '3-4-1-2', '4-1-4-1', '4-3-2-1', '3-5-1-1', '4-4-1-1', '5-2-3', '4-2-4'];

/** A club joins through a KEY, never through the string a source uses to name it. This repository has
 *  lost Milan, Roma and Napoli from a join more than once, and here the three sites really do spell
 *  them differently. Anything absent falls back to its own normalised name, and a club that fails to
 *  join is REPORTED rather than dropped. */
var CLUB_ALIASES = {
  'ac milan': 'milan', 'as roma': 'roma', 'ssc napoli': 'napoli', 'fc internazionale': 'inter',
  'internazionale': 'inter', 'inter milan': 'inter', 'hellas verona': 'verona', 'hellas': 'verona',
  'ss lazio': 'lazio', 'acf fiorentina': 'fiorentina', 'us lecce': 'lecce', 'ac monza': 'monza',
  'us sassuolo': 'sassuolo', 'bologna fc': 'bologna', 'torino fc': 'torino',
  'udinese calcio': 'udinese', 'cagliari calcio': 'cagliari', 'genoa cfc': 'genoa',
  'parma calcio': 'parma', 'venezia fc': 'venezia', 'como 1907': 'como', 'atalanta bc': 'atalanta',
  'juventus fc': 'juventus', 'frosinone calcio': 'frosinone', 'us cremonese': 'cremonese',
  'pisa sc': 'pisa', 'uc sampdoria': 'sampdoria'
};

var TABS = {
  // First, and written whole at every meaningful action. A Sheet that stays empty cannot be told
  // apart from one that never started, which is the same defect as a silent zero: this tab says what
  // was done, what is armed and what is missing, in that order.
  Stato: ['voce', 'valore', 'nota'],
  Probabili: ['round', 'season', 'source', 'club', 'club_key', 'formation', 'fc_id', 'player',
    'role', 'probability', 'starter', 'taken_at_utc', 'kickoff_utc', 'lead_min'],
  Veri: ['round', 'season', 'club', 'club_key', 'fc_id', 'player', 'started'],
  // No column for the shape, and that is a decision rather than an omission. The truth page gives the
  // eleven men, not the drawn shape, so the only shape it could yield is the COUNT of their roles -
  // three lines, which cannot express a 4-2-3-1. Scoring a site's "4-2-3-1" against a counted
  // "4-4-2" would measure our vocabulary and not its forecast; on this project's own archive that
  // disagreement is worth 68.5% of the elevens. The shape each site declares is kept in Probabili,
  // where it can be compared between sites without pretending there is a right answer to check.
  Report: ['round', 'source', 'club', 'named', 'of', 'share', 'null_share',
    'missed', 'invented', 'unresolved', 'lead_min', 'after_official'],
  Attendibilita: ['source', 'rounds', 'clubs', 'named', 'of', 'share', 'null_share', 'margin_pt',
    'unresolved', 'avg_lead_min', 'after_official', 'lead_unknown', 'updated_utc'],
  Log: ['when_utc', 'step', 'subject', 'detail']
};

/**
 * Columns that must stay TEXT, by tab, 1-based.
 *
 * MEASURED ON THE REAL SHEET, 18/09/2026, and it is a corruption a test capture made visible: Sheets
 * parses `4-3-3` as a DATE and stores 4 March 2003, so the formation column came back reading
 * `4-3-2003` for Sassuolo, `4-4-2002` for Cagliari and `3-5-2002` for Inter. The four-number shapes
 * (`3-4-2-1`, `4-2-3-1`) survive because they do not look like a date - which is the worst kind of
 * defect, since most rows look right.
 *
 * It costs no score - the shape is REPORTING here, deliberately outside the metric - but it is wrong
 * data, and a site's shape is exactly what somebody would compare later. The instants are given the
 * same treatment for a different reason: an ISO string that Sheets turned into a date-time would be
 * re-rendered in the Sheet's own zone, and the stored instant is meant to be UTC and comparable.
 */
var TEXT_COLUMNS = {
  Probabili: [6, 12, 13],          // formation, taken_at_utc, kickoff_utc
  Veri: [],
  Report: [],
  Attendibilita: [12],             // updated_utc
  Log: [1],                        // when_utc
  Stato: []
};

// ==============================================================================================
// The probe - run this first, and again whenever a number looks wrong
// ==============================================================================================

/**
 * Does each site answer a GOOGLE server, and does the answer carry the elevens?
 *
 * Exactly one thing in this design cannot be measured from Italy: whether these sites serve Google's
 * IP ranges the way they serve a home connection. This answers it in seconds, and it COUNTS the
 * elevens rather than trusting the status code - a 200 without the table is how this would fail
 * while looking like it works, which is precisely what two of the five sites do.
 */
function probe() {
  var lines = [];
  var pages = {};
  Object.keys(SOURCES).forEach(function (key) {
    var src = SOURCES[key];
    var got = fetch_(src.url);
    pages[key] = got;
    if (!got.ok) {
      lines.push(src.label + ': NO - ' + got.why);
      log_('probe', src.label, 'NO - ' + got.why);      // on the record, or the Sheet cannot say when
      return;                                            // we last looked or what the answer was
    }
    var clubs = -1;
    try { clubs = uniqueClubs_(parseWith_(src.parse, got.html)); } catch (e) { clubs = -1; }
    var verdict = Utilities.formatString('HTTP 200 | %s KB | real shapes %s | clubs parsed %s -> %s',
      Math.round(got.html.length / 1024), countShapes_(got.html), clubs,
      clubs >= MIN_CLUBS ? 'READABLE'
        : 'NOT USABLE (200 but no elevens, or the parser no longer matches its markup)');
    lines.push(src.label + ': ' + verdict);
    log_('probe', src.label, verdict);
  });

  // The script's timezone is stated rather than assumed. The kick-off instants are built with
  // `new Date(y, m, d, h, min)`, which is the SCRIPT's zone, and `planToday` compares a fixture's day
  // with today in that same zone - so a project left on a different zone would arm every capture off
  // by the offset, silently and by exactly the amount nobody would notice on a 15:00 kick-off.
  lines.push('script timezone: ' + tz_() + (tz_() === 'Europe/Rome' ? '' :
    ' <- NOT Europe/Rome: set it in Project Settings, or the captures are armed at the wrong hour'));

  var cal = schedule_(pages);
  var opener = firstFixture_(cal);
  lines.push('schedule: ' + (cal.length
    ? cal.length + ' fixtures, first kick-off ' + itDate_(opener.kickoff, true)
      + ' (' + opener.home + '-' + opener.away + ')'
    : 'NOT READ - no capture could be timed'));

  var anchor = round_(pages.fantacalcio);
  lines.push('round the page numbers: ' + (anchor.round
    ? anchor.round + ' of ' + anchor.season
    : 'NOT DECLARED - scoring would not know which round to ask the truth for'));

  if (anchor.round && anchor.round > 1) {
    var t = truth_(anchor.season, anchor.round - 1);
    lines.push(Utilities.formatString('truth page (round %s): %s clubs | %s starters | %s',
      anchor.round - 1, t.clubs, t.rows.length, t.ok ? 'EXACT (11 per club)' : 'NOT USABLE: ' + t.why));
  }
  var out = lines.join('\n');
  Logger.log(out);
  try { refreshStatus(pages); } catch (e) { log_('probe', 'status', 'not refreshed: ' + e.message); }
  return out;
}

// ==============================================================================================
// The capture
// ==============================================================================================

/**
 * Take every source, save the photograph, append the reading.
 *
 * APPEND and never replace: a source that publishes twice leaves two rows, and choosing between them
 * is the SCORER's job (one prediction per fixture, the last one before kick-off). Overwriting here
 * would destroy the earlier reading, and nobody could then ask how much a site changes its mind
 * between Friday and Sunday - a question worth keeping the option on.
 *
 * A source that does not answer writes a line in Log and NO row in Probabili. An empty marker that
 * reads like "this site predicted nothing" is the defect that cost this project 91 good cache files.
 */
function capture(reason) {
  var takenAt = new Date();
  // One fetch per source, all held before anything is written: the identity index comes from
  // fantacalcio's page and the other two are resolved against it, so the three readings describe the
  // same instant instead of three instants a few seconds apart.
  var pages = {};
  Object.keys(SOURCES).forEach(function (key) { pages[key] = fetch_(SOURCES[key].url); });

  // THE PHOTOGRAPH IS SAVED FIRST, for every page that ARRIVED - before the round is even known and
  // whatever the guard then says about it. The first version returned on a refused 200 before writing
  // the file, so the one case where the evidence is needed to fix a parser (a site rebuilt and the
  // shape count fell) was the one case where it was thrown away, with the HTML already in hand. The
  // header promises the opposite, and now it is true.
  var stamp = Utilities.formatDate(takenAt, 'UTC', "yyyy-MM-dd'T'HH-mm'Z'");
  Object.keys(pages).forEach(function (key) {
    if (!pages[key].html) return;
    var base = key + '_' + stamp + '.html';
    folder_().createFile(Utilities.gzip(Utilities.newBlob(pages[key].html, 'text/html', base), base + '.gz'));
  });

  var done = readAll_(pages, takenAt, how_(reason), null);
  // Superseded readings go now, so the Sheet carries one reading per source and club per round
  // instead of one per capture. It runs AFTER the writing, on this round only: a prune that walked
  // every round would pay for the whole archive at every kick-off.
  if (done.written && done.round) prune_(done.round);
  tidy_();
  // The picture is refreshed by whoever changed something, so the Sheet is never older than the last
  // thing that happened. It must not be able to take a capture down with it.
  try { refreshStatus(pages); } catch (e) { log_('capture', 'status', 'not refreshed: ' + e.message); }
  return done.written;
}

/**
 * How a run describes itself in the Log.
 *
 * A time-based trigger calls its handler WITH AN EVENT OBJECT, so `capture` used to print
 * "[object Object]" as its own reason on every automatic run - i.e. the log line said who captured on
 * the runs a person started and said nothing on the runs nobody watched, which is the wrong way
 * round. Measured on the live Sheet 21/09/2026: 25 of the 36 capture lines that carry a reason.
 */
function how_(reason) {
  if (!reason) return '';
  if (typeof reason === 'string') return reason;
  return 'armed trigger';
}

/**
 * Turn pages in hand into rows in the Sheet. ONE definition, two callers: the live `capture` and
 * `recover`, which replays photographs from Drive.
 *
 * IT IS IDEMPOTENT, and that is what makes a replay safe: a (round, source, club) already recorded at
 * that same minute is not written again, so running `recover` twice writes nothing the second time
 * and a photograph whose rows partly survived the pruner contributes only the missing ones.
 *
 * `anchor` forces the round when the caller knows it better than the page does; null means read it
 * from fantacalcio, which is the live case.
 *
 * APPEND and never replace: a source that publishes twice leaves two rows, and choosing between them
 * is the SCORER's job (one prediction per round, the last one before the opener). Overwriting here
 * would destroy the earlier reading, and nobody could then ask how much a site changes its mind
 * between Friday and Sunday - a question worth keeping the option on.
 *
 * A source that does not answer writes a line in Log and NO row in Probabili. An empty marker that
 * reads like "this site predicted nothing" is the defect that cost this project 91 good cache files.
 */
function readAll_(pages, takenAt, how, anchor) {
  // The round comes from fantacalcio, which is the only page carrying it with its season - but a
  // failure there must not cost the OTHER three. They answered, their pages are in hand, and a round
  // not taken is a round lost for ever: so the last round seen in the Sheet stands in, and the row
  // says which of the two it is. Guessing a round would be worse; reusing the one already recorded is
  // not a guess.
  if (!anchor || !anchor.round) {
    anchor = round_(pages.fantacalcio);
    if (!anchor.round) {
      anchor = lastRound_();
      if (!anchor.round) { log_('capture', 'skipped', 'no round on the page and none in the Sheet'); return { written: 0, round: null }; }
      log_('capture', 'round', 'fantacalcio unreadable: falling back to round ' + anchor.round
        + ' of ' + anchor.season + ', the last one this Sheet recorded');
    }
  }
  var cal = schedule_(pages);
  var index = pages.fantacalcio.ok ? rosterIndex_(pages.fantacalcio.html) : null;
  if (!index) log_('capture', 'identity', 'fantacalcio not read: the other sources keep their names without ids');
  var already = writtenIndex_();
  var minute = iso_(takenAt).slice(0, 16);
  var written = 0;

  Object.keys(SOURCES).forEach(function (key) {
    var src = SOURCES[key];
    var got = pages[key];
    if (!got.ok) { log_('capture', src.label, 'NOT TAKEN - ' + got.why + ' (photograph kept)'); return; }

    var rows;
    try { rows = parseWith_(src.parse, got.html); }
    catch (e) { log_('capture', src.label, 'PARSER FAILED - ' + e.message + ' (photograph kept)'); return; }

    var clubs = uniqueClubs_(rows);
    if (clubs < MIN_CLUBS) {
      log_('capture', src.label, 'REFUSED - only ' + clubs + ' clubs parsed (photograph kept)');
      return;
    }

    // A name that still fails to join keeps its verbatim spelling, carries no id and is COUNTED in
    // Log instead of vanishing: a name normalised into an archive is a name lost.
    var unmatched = 0;
    var skipped = 0;
    var out = [];
    rows.forEach(function (r) {
      if (already[anchor.round + '|' + src.label + '|' + r.clubKey + '|' + minute]) { skipped += 1; return; }
      var fcId = r.fcId || (index ? resolve_(index, r.clubKey, r.player) : '');
      if (!fcId) unmatched += 1;
      var kick = kickoffOf_(cal, r.clubKey);
      out.push([anchor.round, anchor.season, src.label, r.club, r.clubKey, r.formation, fcId, r.player,
        r.role || '', r.probability === null ? '' : r.probability, r.starter ? 1 : 0,
        iso_(takenAt), kick ? iso_(kick) : '',
        kick ? Math.round((kick.getTime() - takenAt.getTime()) / 60000) : '']);
    });
    if (!out.length) {
      log_('capture', src.label, 'nothing to add - this reading is already in the Sheet');
      return;
    }
    appendRows_('Probabili', out);
    written += out.length;
    var sure = certainty_(rows);
    log_('capture', src.label, Utilities.formatString('%s players over %s clubs%s%s%s%s',
      out.length, clubs, unmatched ? ' | ' + unmatched + ' names without an fc_id' : '',
      skipped ? ' | ' + skipped + ' already there' : '',
      sure === null ? '' : ' | ' + Math.round(sure * 100) + '% of the men at 100%',
      how ? ' | ' + how : ''));
    if (sure !== null && sure >= CERTAIN_SHARE) {
      log_('capture', src.label, 'WARNING - ' + Math.round(sure * 100) + '% of the men are given at'
        + ' 100%: this reading may be the OFFICIAL line-up rather than a forecast, and a source scored'
        + ' on it is being credited for copying the answer');
    }
  });
  return { written: written, round: anchor.round };
}

/**
 * Re-read a round from the PHOTOGRAPHS, keeping only what was taken before the round opened.
 *
 * WHY IT EXISTS. The header of this file has promised from day one that "the photographs ARE the
 * historical series, and the rows in the Sheet are a derived reading that can be redone" - and
 * nothing redid them. An offline replay nobody calls is a cache that does not exist, which this
 * project has already written down once about `recent_form.reingest_from_cache`.
 *
 * WHAT IT BUYS THE DAY IT WAS WRITTEN. Round 5 of 2026-27 was captured under the old rule, fifteen
 * minutes before EACH club's kick-off, and the pruner then kept one reading per source and club - the
 * late one. So the Sheet holds, for nine clubs of twenty, only readings taken after those clubs had
 * their official line-ups out, and the pre-opener readings that the new rule wants are in the Sheet
 * for no source at all. They are on Drive: 43 photographs, 90 days, four of them taken at 20:30 on
 * Friday 18/09 - fifteen minutes before Monza-Sassuolo opened the round. `recover(5)` puts those rows
 * back and `score()` then answers the operator's question on them.
 *
 * IT ADDS AND NEVER REMOVES. The late readings stay where they are; under the new deadline the scorer
 * simply stops reading them. Nothing measured under the old rule is destroyed by adopting the new one
 * - the two questions remain answerable from the same tab.
 *
 * THE OPENER IS READ FROM THE SHEET AND NOT FROM TODAY'S CALENDAR, because a round is recovered long
 * after its fixtures have left the sites. A round whose rows carry no kick-off has no opener, and
 * there this refuses rather than guessing: replaying every photograph would file readings taken
 * during the round as forecasts of it.
 */
function recover(round) {
  round = Number(round);
  if (!round) { log_('recover', 'skipped', 'no round given'); return 0; }
  var v = tab_('Probabili').getDataRange().getValues();
  var opener = openerIndex_(v)[round];
  if (opener === undefined) {
    log_('recover', 'round ' + round, 'REFUSED - no kick-off on any row of this round, so the opener'
      + ' is unknown and a photograph cannot be told from one taken while the round was played');
    return 0;
  }

  // The photographs of that window, grouped by the instant they were taken.
  var byStamp = {};
  var it = folder_().getFiles();
  var seen = 0;
  while (it.hasNext()) {
    var f = it.next();
    var m = String(f.getName()).match(/^([a-z]+)_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})Z\.html\.gz$/);
    if (!m || !SOURCES[m[1]]) continue;
    seen += 1;
    var when = new Date(m[2] + 'T' + m[3] + ':' + m[4] + ':00Z');
    if (when.getTime() >= opener) continue;                  // the round had already started
    var key = m[2] + 'T' + m[3] + '-' + m[4];
    if (!byStamp[key]) byStamp[key] = { when: when, files: {} };
    byStamp[key].files[m[1]] = f;
  }
  var stamps = Object.keys(byStamp).sort();                  // oldest first, so the last one read wins
  if (!stamps.length) {
    log_('recover', 'round ' + round, 'nothing to replay - ' + seen + ' photographs on Drive and none'
      + ' of them taken before ' + iso_(new Date(opener)));
    return 0;
  }

  var written = 0;
  stamps.forEach(function (key) {
    var pages = {};
    Object.keys(SOURCES).forEach(function (k) {
      var f = byStamp[key].files[k];
      if (!f) { pages[k] = { ok: false, why: 'no photograph at this instant', html: '' }; return; }
      var html;
      try { html = Utilities.ungzip(f.getBlob()).getDataAsString(); }
      catch (e) { pages[k] = { ok: false, why: 'photograph unreadable (' + e.message + ')', html: '' }; return; }
      // The SAME guard the live fetch applies, so a page refused then is refused now for the same
      // reason: a replay that believed pages the capture refused would be measuring a different rule.
      pages[k] = believable_(html);
    });
    // The photograph's own round wins over the one asked for; where it cannot be read, the window
    // decides - the file was taken before this round opened, which is evidence enough.
    var own = round_(pages.fantacalcio);
    if (own.round && own.round !== round) {
      log_('recover', key, 'skipped - this photograph carries round ' + own.round + ', not ' + round);
      return;
    }
    var anchor = own.round ? own : { round: round, season: seasonOfRound_(v, round) };
    written += readAll_(pages, byStamp[key].when, 'recovered from the photograph of ' + key, anchor).written;
  });
  log_('recover', 'round ' + round, written + ' row(s) restored from ' + stamps.length
    + ' pre-opener photograph(s)');
  try { refreshStatus(); } catch (e) { log_('recover', 'status', 'not refreshed: ' + e.message); }
  return written;
}

/** The season a round was recorded under, from the Sheet - never today's, which is a different season
 *  the moment a recovery is run in August. */
function seasonOfRound_(values, round) {
  for (var i = 1; i < values.length; i += 1) if (Number(values[i][0]) === round) return values[i][1];
  return '';
}

/** Is this HTML a line-up page? The guard `fetch_` applies to what arrives, reachable on its own so a
 *  replayed photograph is judged by the same rule as the live page. */
function believable_(html, minShapes) {
  var floor = (minShapes === undefined) ? MIN_SHAPES : minShapes;
  if (floor && countShapes_(html) < floor) {
    return { ok: false, why: '200 without elevens (' + html.length + ' bytes)', html: html };
  }
  return { ok: true, why: '', html: html };
}

/** What Probabili already holds, as (round|source|club|minute) - the key `readAll_` refuses to write
 *  twice. Minute and not second, because that is the resolution of a photograph's file name. */
function writtenIndex_() {
  var v = tab_('Probabili').getDataRange().getValues();
  var out = {};
  for (var i = 1; i < v.length; i += 1) {
    if (!v[i][11]) continue;
    out[Number(v[i][0]) + '|' + v[i][2] + '|' + v[i][4] + '|' + iso_(new Date(v[i][11])).slice(0, 16)] = 1;
  }
  return out;
}

/**
 * fantacalcio publishes our key, so its page IS the identity table for the two sites that do not.
 *
 * BUILT OVER THE WHOLE PAGE, starters AND reserves, and that is the point rather than a detail. The
 * first version indexed only fantacalcio's own eleven, so a man another site predicted and
 * fantacalcio benched could not be resolved at all - i.e. the identity failed exactly on the players
 * the sources DISAGREE about, which is the entire question. Measured 18/09/2026: it cost 31-32 names
 * of 220 per source, and every one of them was either a disagreement or a forename-first spelling,
 * so the metric would have flattered fantacalcio by construction.
 *
 * The value is a token map per club: a name resolves when its tokens point at exactly ONE man of that
 * club. A token claimed by two different men (Inter has two Martinez) is set to empty and refuses
 * both - an ambiguous join is worse than a missing one, and this repository has paid for that.
 */
function rosterIndex_(html) {
  var idx = {};
  html.split(/class="[^"]*\bteam-card\b[^"]*"/).slice(1).forEach(function (card) {
    var name = card.match(/class="[^"]*\bteam-name\b[^"]*"[^>]*>([^<]+)</);
    if (!name) return;
    var key = clubKey_(clean_(name[1]));
    idx[key] = idx[key] || {};
    card.split(/class="[^"]*\bplayer-item\b[^"]*"/).slice(1).forEach(function (item) {
      var href = item.match(/\/squadre\/[^\/"]+\/[^\/"]+\/(\d+)/);
      var nm = item.match(/player-link[^>]*>[\s\S]*?<span[^>]*>([^<]+)</);
      if (!href || !nm) return;
      tokens_(nm[1]).forEach(function (t) {
        if (!(t in idx[key])) idx[key][t] = href[1];
        else if (idx[key][t] !== href[1]) idx[key][t] = '';        // claimed twice: refused
      });
    });
  });
  return idx;
}

/** A name resolves when its tokens point at exactly one man of that club, else it stays unnamed. */
function resolve_(idx, clubKey, name) {
  var per = idx[clubKey] || {};
  var hits = {};
  tokens_(name).forEach(function (t) { if (per[t]) hits[per[t]] = 1; });
  var ids = Object.keys(hits);
  return ids.length === 1 ? ids[0] : '';
}

// ==============================================================================================
// When: the round is what the page NUMBERS, the capture is timed on the real kick-off
// ==============================================================================================

/**
 * Arm the ONE capture of the round: fifteen minutes before its first kick-off.
 *
 * One, and not one per slot: by the operator's rule of 21/09/2026 the photograph is taken while the
 * round is entirely unplayed, so every later slot would produce a reading that scores nothing (see
 * LEAD_MINUTES and `chosenTakes_`). Arming them anyway would not be harmless - it would keep writing
 * rows that look like predictions in a tab whose other rows are predictions.
 *
 * The planner still runs EVERY morning, because it is what notices that a new round's calendar has
 * been published; on the days after the opener it arms nothing and says so.
 *
 * Yesterday's triggers are dropped first: Apps Script allows twenty per project, and letting them
 * pile up would make the twenty-first installation fail without saying why.
 */
function planToday() {
  var cal = schedule_();
  if (!cal.length) { log_('plan', 'skipped', 'schedule not read - no capture could be timed'); return 0; }
  dropTriggers_('capture');
  var now = new Date();
  var opener = firstFixture_(cal);
  var when = new Date(opener.kickoff.getTime() - LEAD_MINUTES * 60000);
  if (when <= now) {
    // Two different sentences, and the Log says which: the round has been photographed, or the moment
    // went by. A single "0 armed" would read the same in both cases.
    log_('plan', 'armed', '0 capture(s) - the opener (' + itDate_(opener.kickoff, true)
      + ') is past: this round is photographed or lost, never pending');
    try { refreshStatus(); } catch (e) { log_('plan', 'status', 'not refreshed: ' + e.message); }
    return 0;
  }
  if (!sameDay_(when, now)) {
    log_('plan', 'armed', '0 capture(s) today - the opener is ' + itDate_(opener.kickoff, true)
      + ', the capture arms on its own morning');
    try { refreshStatus(); } catch (e) { log_('plan', 'status', 'not refreshed: ' + e.message); }
    return 0;
  }
  ScriptApp.newTrigger('capture').timeBased().at(when).create();
  log_('plan', 'armed', '1 capture | opener ' + itDate_(opener.kickoff, true)
    + ' minus ' + LEAD_MINUTES + ' min (' + opener.home + '-' + opener.away + ')');
  try { refreshStatus(); } catch (e) { log_('plan', 'status', 'not refreshed: ' + e.message); }
  return 1;
}

/**
 * The round, taken from the number the page itself carries.
 *
 * Never a block of days deduced from the calendar: between two consecutive Serie A rounds the gap is
 * one day 124 times and seven days 90 times, so no threshold separates "inside a round" from
 * "between two rounds". fantacalcio's fixture links carry BOTH the round and the season
 * (/calendario/{md}/{season}/), which is why it is the anchor; the most frequent wins, because a
 * page is one round and a tie would mean this is no longer the right anchor.
 */
function round_(prefetched) {
  var got = prefetched || fetch_(SOURCES.fantacalcio.url);
  if (!got.ok) return { round: null, season: null };
  var counts = {};
  var re = /\/calendario\/(\d+)\/(\d{4}-\d{2})\//g;
  var m;
  while ((m = re.exec(got.html)) !== null) {
    var k = m[1] + '|' + m[2];
    counts[k] = (counts[k] || 0) + 1;
  }
  var best = null;
  Object.keys(counts).forEach(function (k) { if (!best || counts[k] > counts[best]) best = k; });
  if (!best) return { round: null, season: null };
  return { round: Number(best.split('|')[0]), season: best.split('|')[1] };
}

/**
 * The fixtures and their kick-off instants.
 *
 * Read from Corriere, which states each one as "venerdi 18.09.2026 ore 20:45" next to the two club
 * names - unambiguous, with the year, one per fixture. Sky is the fallback. fantacalcio is NOT used
 * for this although it is the anchor for the round: its per-fixture time is a placeholder
 * (01/01 01:00) and its real slots sit in a separate block, i.e. the day is stated but not attached
 * to the fixture.
 *
 * Entities are decoded BEFORE matching, and that is not a detail: the weekday arrives as
 * "venerd&#xEC;", so a reader anchored on the weekday name silently loses every Friday anticipo -
 * the one fixture this file exists to be in time for. Measured 18/09/2026.
 */
function schedule_(pages) {
  pages = pages || {};
  var out = fromCorriere_(pages.corriere);
  if (!out.length) out = fromSky_(pages.sky);
  // Third, and arguably the one that should be first: SOS Fanta states each kick-off as an ISO
  // instant in an attribute (`<time datetime="2026-09-19T13:00:00.000Z">`), so it needs no date
  // parsing and no locale at all. It is kept last because the other two are the ones verified against
  // each other, and the schedule is what arms every capture - a reader that has never been wrong is
  // not a reason to displace two that have been checked. Its own agreement is measured: all eight
  // kick-off instants identical to Corriere's and Sky's.
  return out.length ? out : fromSosfanta_(pages.sosfanta);
}

function fromSosfanta_(prefetched) {
  var got = prefetched || fetch_(SOURCES.sosfanta.url);
  if (!got.ok) return [];
  var out = [];
  got.html.split(/<article\b[^>]*?id="match-/).slice(1).forEach(function (a) {
    var names = [];
    var m;
    var nre = /<h2\b[^>]*>([^<]+)<\/h2>/g;
    while ((m = nre.exec(a)) !== null && names.length < 2) names.push(clean_(m[1]));
    var when = a.match(/<time\b[^>]*datetime="([^"]+)"/);
    if (names.length < 2 || !when) return;
    out.push({ home: names[0], away: names[1], kickoff: new Date(when[1]) });
  });
  return out;
}

function fromCorriere_(prefetched) {
  var got = prefetched || fetch_(SOURCES.corriere.url);
  if (!got.ok) return [];
  // Comments are stripped FIRST. This site renders with Next.js, which writes an empty `<!-- -->`
  // between every interpolated value: the date arrives as `18.09.2026<!-- --> ore <!-- -->20:45`, so
  // a pattern with `\s*ore\s*` in it matches nothing and the schedule reads as zero fixtures - which
  // would silently disarm every capture. Measured 18/09/2026.
  var html = noComments_(decode_(got.html));
  var out = [];
  // The class hash changes when the site is rebuilt, so only the stable prefix is matched.
  var blocks = html.split(/<time class="ProbabiliFormazioni_day__/).slice(1);
  blocks.forEach(function (b) {
    var d = b.match(/(\d{2})\.(\d{2})\.(\d{4})\s*ore\s*(\d{1,2})[:.](\d{2})/);
    var names = [];
    var re = /class="ProbabiliFormazioni_teamName__[^"]*"[^>]*>([^<]+)</g;
    var m;
    while ((m = re.exec(b)) !== null && names.length < 2) names.push(clean_(m[1]));
    if (!d || names.length < 2) return;
    out.push({
      home: names[0],
      away: names[1],
      kickoff: new Date(Number(d[3]), Number(d[2]) - 1, Number(d[1]), Number(d[4]), Number(d[5]))
    });
  });
  return out;
}

function fromSky_(prefetched) {
  var got = prefetched || fetch_(SOURCES.sky.url);
  if (!got.ok) return [];
  var text = decode_(strip_(got.html));
  var MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto',
    'settembre', 'ottobre', 'novembre', 'dicembre'];
  var out = [];
  // The away club is terminated by the shape that follows it ("... Monza VS Sassuolo 3-4-2-1"), not
  // by whitespace: `strip_` has already collapsed runs of spaces, so anchoring on two of them
  // matched nothing. Ending on the shape also lets a two-word club through (Hellas Verona).
  var re = new RegExp('(\\d{1,2})\\s+(' + MONTHS.join('|') + ')\\s+(\\d{4})\\s+ore\\s+(\\d{1,2})[:.](\\d{2})'
    + '\\s+(.+?)\\s+VS\\s+(.+?)\\s+\\d-\\d', 'gi');
  var m;
  while ((m = re.exec(text)) !== null) {
    out.push({
      home: clean_(m[6]),
      away: clean_(m[7]),
      kickoff: new Date(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()), Number(m[1]),
        Number(m[4]), Number(m[5]))
    });
  }
  return out;
}

/**
 * The fixture a round OPENS with: the earliest kick-off, not the first one in document order.
 *
 * One definition because there were two answers to one question: `probe` printed `cal[0]` while the
 * Stato tab took the minimum, and a site that groups its fixtures by day with Sunday first would have
 * made the diagnostic line name a Sunday match as the opener - on the very line a human reads to check
 * that the Friday anticipo is covered.
 */
function firstFixture_(cal) {
  if (!cal || !cal.length) return null;
  return cal.reduce(function (a, b) { return a.kickoff < b.kickoff ? a : b; });
}

function kickoffOf_(cal, key) {
  for (var i = 0; i < cal.length; i += 1) {
    if (clubKey_(cal[i].home) === key || clubKey_(cal[i].away) === key) return cal[i].kickoff;
  }
  return null;
}

// ==============================================================================================
// The parsers - one per source, each returning the same shape
// ==============================================================================================
// Apps Script has no DOM, so these are regular expressions over the markup. Each one anchors on the
// STABLE part of a class name and never on a build hash, and each is verified by probe(), which
// reports how many clubs it parsed: a site that changes its markup reads as "0 clubs" and refuses to
// write, instead of writing a quieter kind of wrong.

/** fantacalcio.it - the only one that publishes our own key, in every player's href. */
function parseFantacalcio_(html) {
  var out = [];
  var cards = html.split(/class="[^"]*\bteam-card\b[^"]*"/).slice(1);
  cards.forEach(function (card) {
    var name = card.match(/class="[^"]*\bteam-name\b[^"]*"[^>]*>([^<]+)</);
    var shape = card.match(/class="[^"]*\bteam-formation\b[^"]*"[^>]*>([^<]+)</);
    if (!name) return;
    var club = clean_(name[1]);
    var formation = shape ? clean_(shape[1]) : '';
    // The starters list only. The card carries reserves right after it, and taking the whole card
    // would file a bench man as a predicted starter.
    var start = card.indexOf('player-list starters');
    var end = card.indexOf('player-list reserves');
    if (start < 0) return;
    var block = end > start ? card.substring(start, end) : card.substring(start);
    block.split(/class="[^"]*\bplayer-item\b[^"]*"/).slice(1).forEach(function (item) {
      var href = item.match(/\/squadre\/[^\/"]+\/[^\/"]+\/(\d+)/);
      if (!href) return;
      var nm = item.match(/player-link[^>]*>[\s\S]*?<span[^>]*>([^<]+)</);
      var pct = item.match(/class="[^"]*progress-value[^"]*"[^>]*>\s*(\d+)\s*%/);
      var role = item.match(/class="role"[^>]*data-value="([^"]*)"/);
      out.push({
        club: club, clubKey: clubKey_(club), formation: formation,
        fcId: href[1], player: nm ? clean_(nm[1]) : '',
        role: role ? role[1].toUpperCase() : '',
        probability: pct ? Number(pct[1]) / 100 : null,
        starter: true
      });
    });
  });
  return out;
}

/** sport.sky.it - one table per fixture, home on the left panel and away on the right. */
function parseSky_(html) {
  var out = [];
  // Each fixture block holds the two club names, the two shapes and then the table of starters.
  var blocks = html.split(/<table class="ftbl__report-tabs-panel"/).slice(1);
  var heads = [];
  var hre = /class="[^"]*ftbl__team__name[^"]*"[^>]*>([^<]+)</g;
  var m;
  while ((m = hre.exec(html)) !== null) heads.push(clean_(m[1]));
  var sre = /class="[^"]*ftbl__formation-(home|away)[^"]*"[^>]*>([^<]+)</g;
  var shapes = [];
  while ((m = sre.exec(html)) !== null) shapes.push(clean_(m[2]));

  // Heads and shapes are collected over the WHOLE document and paired to the fixture tables by index,
  // so one extra occurrence anywhere - a "next round" teaser using the same class - would shift every
  // club label by one and hand each eleven to the wrong club, silently, with twenty clubs still parsed
  // and the capture still written. Measured today: 20 heads, 20 shapes, 10 tables, i.e. exactly two
  // per fixture. The day that stops being true this refuses instead of writing a quieter kind of wrong.
  if (heads.length !== blocks.length * 2 || shapes.length !== blocks.length * 2) return [];

  blocks.forEach(function (b, i) {
    // The table stops at the "Riserve" header: everything after it is the bench.
    var stop = b.search(/report-tabs-panel__header-td[^>]*>\s*Riserve/i);
    var starters = stop > 0 ? b.substring(0, stop) : b;
    var home = heads[i * 2], away = heads[i * 2 + 1];
    if (!home || !away) return;
    ['left', 'right'].forEach(function (side) {
      var club = side === 'left' ? home : away;
      var formation = shapes[i * 2 + (side === 'left' ? 0 : 1)] || '';
      var re = new RegExp('data-panel-' + side + '="true"[\\s\\S]*?(?=data-panel-|$)', 'g');
      var seen = {};
      var cell;
      while ((cell = re.exec(starters)) !== null) {
        var pre = /class="[^"]*match-formation-player--name[^"]*"[^>]*href="[^"]*\/atleti\/[^\/"]+\/(\d+)"[^>]*>([^<]+)</g;
        var p;
        while ((p = pre.exec(cell[0])) !== null) {
          var nm = clean_(p[2]);
          if (seen[nm]) continue;
          seen[nm] = true;
          out.push({
            club: club, clubKey: clubKey_(club), formation: formation,
            fcId: '', player: nm, role: '', probability: null, starter: true
          });
        }
      }
    });
  });
  return out;
}

/** corrieredellosport.it - the cleanest structure of the three, and it declares its data is OPTA. */
function parseCorriere_(html) {
  var out = [];
  var blocks = noComments_(decode_(html)).split(/<time class="ProbabiliFormazioni_day__/).slice(1);
  blocks.forEach(function (b) {
    var names = [];
    var shapes = [];
    var m;
    var nre = /class="ProbabiliFormazioni_teamName__[^"]*"[^>]*>([^<]+)</g;
    while ((m = nre.exec(b)) !== null && names.length < 2) names.push(clean_(m[1]));
    var sre = /class="ProbabiliFormazioni_teamFormation__[^"]*"[^>]*>\s*([\d-]+)\s*</g;
    while ((m = sre.exec(b)) !== null && shapes.length < 2) shapes.push(clean_(m[1]));
    if (names.length < 2) return;
    // Only the two starter grids: the bench sits under its own classes, and 110 + 110 over ten
    // fixtures is exactly eleven per side, which is the check that says these classes are the
    // starters and nothing else.
    [['homePlayer', 0], ['awayPlayer', 1]].forEach(function (pair) {
      var re = new RegExp('class="ProbabiliFormazioni_' + pair[0] + '__[^"]*"[^>]*id="([^"]*)"', 'g');
      var p;
      while ((p = re.exec(b)) !== null) {
        out.push({
          club: names[pair[1]], clubKey: clubKey_(names[pair[1]]),
          formation: shapes[pair[1]] || '',
          fcId: '', player: clean_(p[1]), role: '', probability: null, starter: true
        });
      }
    });
  });
  return out;
}

/**
 * sosfanta.com - one <article> per fixture, and the richest markup of the four.
 *
 * Every attribute sits on its own LINE, so a pattern written as `<article id="match-` matches
 * nothing: the first prototype read zero fixtures and the reason was invisible because the markup had
 * been inspected with the whitespace collapsed. Hence `<article\b[^>]*?` here and everywhere else in
 * this parser - the same trap as Corriere's comments, met on the other side.
 *
 * The starters stop where "Ballottaggi" begins: that section names the duels and repeats men, so
 * reading past it would file a substitute as a predicted starter and count some men twice.
 */
function parseSosfanta_(html) {
  var out = [];
  html.split(/<article\b[^>]*?id="match-/).slice(1).forEach(function (a) {
    var names = [];
    var shapes = [];
    var m;
    var nre = /<h2\b[^>]*>([^<]+)<\/h2>/g;
    while ((m = nre.exec(a)) !== null && names.length < 2) names.push(clean_(m[1]));
    var sre = /<span\b[^>]*text-primary[^>]*>\s*([\d-]+)\s*<\/span>/g;
    while ((m = sre.exec(a)) !== null && shapes.length < 2) shapes.push(clean_(m[1]));
    if (names.length < 2) return;
    var start = a.search(/>\s*Titolari\s*</);
    var stop = a.search(/>\s*Ballottaggi\s*</);
    if (start < 0) return;
    var block = stop > start ? a.substring(start, stop) : a.substring(start);
    block.split(/<ul\b/).slice(1, 3).forEach(function (ul, side) {
      var pre = />\s*(\d+)\s*%\s*<\/span>\s*<span\b[^>]*>([^<]+)<\/span>/g;
      var p;
      while ((p = pre.exec(ul)) !== null) {
        out.push({
          club: names[side], clubKey: clubKey_(names[side]), formation: shapes[side] || '',
          fcId: '', player: clean_(p[2]), role: '',
          probability: Number(p[1]) / 100, starter: true
        });
      }
    });
  });
  return out;
}

// ==============================================================================================
// The truth, and the report
// ==============================================================================================

/**
 * Who actually started, per club, for one round.
 *
 * "He started" = he has a vote and is not marked as having come on. The page marks the two states
 * explicitly (title="Subentrato" on whoever came on, title="Sostituito" on whoever went off), which
 * is why this is a reading and not an inference.
 *
 * The invariant is checked and not trusted: twenty clubs, eleven each. Measured exact on rounds 2, 3
 * and 4 of 2026-27. If it fails, the round is NOT scored and the reason is written down - a round
 * scored against a half-published page would quietly punish every source at once.
 */
function truth_(season, round) {
  var url = TRUTH_URL.replace('{season}', season).replace('{round}', String(round));
  // No shape guard: this page is a table of grades and carries no shapes at all. Its completeness is
  // checked below, and far more strictly - twenty clubs, eleven each.
  var got = fetch_(url, 0);
  if (!got.ok) return { ok: false, why: got.why, rows: [], clubs: 0 };
  var rows = [];
  var clubs = 0;
  var bad = [];
  var blocks = got.html.split(/<li id="team-\d+" class="team-table"/).slice(1);
  blocks.forEach(function (b) {
    var nm = b.match(/class="team-badge"[^>]*title="([^"]+)"/);
    if (!nm) return;
    var club = clean_(nm[1]);
    clubs += 1;
    var starters = 0;
    (b.match(/<tr>[\s\S]*?<\/tr>/g) || []).forEach(function (tr) {
      var href = tr.match(/\/squadre\/[^\/"]+\/[^\/"]+\/(\d+)/);
      if (!href) return;
      if (/title="Subentrato"/.test(tr)) return;             // came on: he did not start
      var nmp = tr.match(/player-link[^>]*>[\s\S]*?<span[^>]*>([^<]+)</);
      starters += 1;
      rows.push({
        club: club, clubKey: clubKey_(club), fcId: href[1],
        player: nmp ? clean_(nmp[1]) : ''
      });
    });
    if (starters !== 11) bad.push(club + '=' + starters);
  });
  if (clubs === 0) return { ok: false, why: 'no club block on the page', rows: rows, clubs: 0 };
  if (bad.length) {
    return { ok: false, why: 'not eleven starters for ' + bad.join(', '), rows: rows, clubs: clubs };
  }
  // TWENTY clubs, and this is the half the first version only claimed. A voti page published while a
  // postponed fixture is still ungraded carries fewer club blocks, each with a perfectly good eleven -
  // so the eleven-per-club check passes and the round would be scored over 14 clubs instead of 20,
  // silently, for every source at once. The number is the league's own size, taken from the schedule
  // rather than written here: a league that changes size must not need this file edited.
  if (clubs < CLUBS_IN_LEAGUE) {
    return { ok: false, why: 'only ' + clubs + ' clubs on the page of ' + CLUBS_IN_LEAGUE
      + ' - the round is not fully graded yet', rows: rows, clubs: clubs };
  }
  return { ok: true, why: '', rows: rows, clubs: clubs };
}

/**
 * Score every round that has been captured and has since been played.
 *
 * THE METRIC, per source and per club: how many of the eleven who REALLY started had been named.
 * The denominator is the real eleven, which is the same question for every source and for the null.
 *
 * THE NULL is the eleven that started that club's PREVIOUS match - free, public, and no source
 * deserves a verdict until it beats it. It is scored PAIRED: same rows, same denominator. Scoring a
 * source over four rounds and its null over three hands the source the round it gets most wrong (the
 * first, where there is no previous match), and that defect moved a published number by three points
 * when it was found, so here the club-round is simply left out of BOTH when the null cannot exist.
 *
 * ONE PREDICTION PER FIXTURE: the last capture before that club's kick-off. A source that publishes
 * twice must not weigh twice, and a reading taken AFTER the whistle is not a forecast.
 */
function score() {
  var v = tab_('Probabili').getDataRange().getValues();
  if (v.length < 2) { log_('score', 'skipped', 'nothing captured yet'); return; }

  var chosen = chosenTakes_(v);
  // Per (round, club) kick-off, recovered from whichever row of that club knows it: the scorer needs
  // it to state how early a reading was, even when the capture that wrote the row could not.
  var kicks = kickoffIndex_(v);
  var best = {};
  var seasonOf = {};
  for (var i = 1; i < v.length; i += 1) {
    var r = v[i];
    var round = Number(r[0]);
    seasonOf[round] = r[1];
    var k = takeKey_(r);
    var c = chosen[k];
    if (!c || c.use === null) continue;                        // no reading before that kick-off
    var taken = new Date(r[11]);
    if (taken.getTime() !== c.use) continue;                   // an older or a post-whistle reading
    if (!best[k]) {
      best[k] = { taken: taken, kick: r[12] ? new Date(r[12]) : null, rows: [],
        formation: r[5], lead: r[13] };
    }
    best[k].rows.push({ fcId: String(r[6]), player: r[7] });
  }

  var rounds = {};
  Object.keys(best).forEach(function (k) { rounds[k.split('|')[0]] = true; });

  // THE TRUTH IS FETCHED ONCE AND THEN IT IS ARCHIVE. `Veri` already holds every complete round, so it
  // IS the cache: a round found there costs no request at all. Without this the daily run re-fetched
  // every round from scratch AND fetched each one twice - as the round and as its successor's null -
  // so by the end of a season one 09:00 run would pull 76 pages of 1.2 MB, which is both a quota and a
  // six-minute-limit problem. It also stops Veri being rewritten: only rounds fetched THIS run are
  // appended, so a round whose captures were removed keeps its real elevens instead of losing them.
  var archive = truthArchive_();
  var freshRows = [];
  var fetched = 0;
  var truthOf = function (season, round) {
    if (archive[round]) return { ok: true, why: '', rows: archive[round], clubs: CLUBS_IN_LEAGUE };
    var t = truth_(season, round);
    fetched += 1;
    if (t.ok) {
      archive[round] = t.rows;
      t.rows.forEach(function (x) {
        freshRows.push([round, season, x.club, x.clubKey, x.fcId, x.player, 1]);
      });
    }
    return t;
  };

  var reportRows = [];
  var tally = {};
  Object.keys(rounds).map(Number).sort(function (a, b) { return a - b; }).forEach(function (round) {
    var season = seasonOf[round];
    var t = truthOf(season, round);
    if (!t.ok) { log_('score', 'round ' + round, 'NOT SCORED - ' + t.why); return; }
    var prev = round > 1 ? truthOf(season, round - 1) : { ok: false, rows: [] };

    var realBy = {}, prevBy = {};
    t.rows.forEach(function (x) { (realBy[x.clubKey] = realBy[x.clubKey] || []).push(x); });
    if (prev.ok) prev.rows.forEach(function (x) { (prevBy[x.clubKey] = prevBy[x.clubKey] || []).push(x); });

    Object.keys(best).forEach(function (k) {
      var parts = k.split('|');
      if (Number(parts[0]) !== round) return;
      var source = parts[1], clubKey = parts[2];
      var real = realBy[clubKey];
      if (!real) { log_('score', source, 'round ' + round + ': club ' + clubKey + ' not on the truth page'); return; }
      var nullEleven = prevBy[clubKey];
      // Paired: without a previous match the club-round leaves BOTH the source and the null.
      if (!nullEleven) return;

      // A name we could not resolve to an id cannot be credited, so it reads as a miss. That is a
      // cost of OUR identity and not a fact about the source, so it is counted and shown per source
      // rather than folded into the score in silence. Measured 18/09/2026 on a full round: 4 of 220
      // for sport.sky.it and 2 of 220 for corrieredellosport.it - the two Martinez of Inter, whose
      // token is claimed twice and therefore refused, plus two names one site spells differently.
      var said = {};
      var unresolved = 0;
      best[k].rows.forEach(function (p) {
        if (p.fcId) said[String(p.fcId)] = p.player; else unresolved += 1;
      });
      var nullSaid = {};
      nullEleven.forEach(function (p) { nullSaid[String(p.fcId)] = 1; });

      var named = 0, missed = [], nullNamed = 0;
      real.forEach(function (x) {
        if (said[x.fcId]) named += 1; else missed.push(x.player);
        if (nullSaid[x.fcId]) nullNamed += 1;
      });
      var realSet = {};
      real.forEach(function (x) { realSet[x.fcId] = 1; });
      var invented = [];
      Object.keys(said).forEach(function (id) { if (!realSet[id]) invented.push(said[id]); });

      // How early the reading was, in minutes before THIS club's kick-off - and whether that puts it
      // inside the official-line-up window. A fact about the reading, not a judgement on the source.
      //
      // THE LEAD IS RECOVERED WHEN THE ROW DOES NOT CARRY IT, and that is a defect this cost. The
      // capture writes `lead_min` only when it could read the calendar at that instant; when it could
      // not, the cell is empty - while eligibility has always recovered the kick-off from whichever
      // row of the round knows it. Two readers, two answers, in one function: on round 5, 33 readings
      // of 80 had an empty lead and `Number('') < 30` is false, so `after_official` read 0 and eleven
      // clubs of twenty were filed as forecasts when nobody knew. "Vuoto = ignoto, mai zero", broken
      // in the one column that exists to tell a forecast from a copy.
      var kick = best[k].kick ? best[k].kick.getTime() : kicks[round + '|' + clubKey];
      var lead = best[k].lead;
      if ((lead === '' || lead === null) && kick !== undefined && kick !== null) {
        lead = Math.round((kick - best[k].taken.getTime()) / 60000);
      }
      // And an unknown lead stays UNKNOWN. A blank here is not "it was a forecast": it is a reading
      // whose distance from the whistle nobody can state.
      var afterOfficial = (lead === '' || lead === null) ? ''
        : (Number(lead) < OFFICIAL_MINUTES ? 1 : 0);
      reportRows.push([round, source, clubKey, named, real.length, named / real.length,
        nullNamed / real.length, missed.join(', '), invented.join(', '), unresolved,
        lead, afterOfficial]);

      var a = tally[source] = tally[source] || { rounds: {}, clubs: 0, named: 0, of: 0, nullNamed: 0, lead: [], unresolved: 0, afterOfficial: 0, leadUnknown: 0 };
      a.rounds[round] = true; a.clubs += 1; a.named += named; a.of += real.length;
      a.nullNamed += nullNamed; a.unresolved += unresolved;
      if (afterOfficial === '') a.leadUnknown += 1; else a.afterOfficial += afterOfficial;
      if (lead !== '' && lead !== null) a.lead.push(Number(lead));
    });
  });

  // Veri is APPENDED and never rewritten: it is the archive of what really happened, and a round whose
  // captures have gone must not take its real eleven with it.
  appendRows_('Veri', freshRows);
  write_('Report', reportRows);

  var rank = Object.keys(tally).map(function (s) {
    var a = tally[s];
    var share = a.of ? a.named / a.of : 0;
    var nullShare = a.of ? a.nullNamed / a.of : 0;
    // `after_official` counts only the rows whose distance from the whistle is KNOWN, and the rows
    // where it is not are counted apart instead of being added to the safe side.
    return [s, Object.keys(a.rounds).length, a.clubs, a.named, a.of, share, nullShare,
      (share - nullShare) * 100, a.unresolved,
      a.lead.length ? Math.round(a.lead.reduce(function (x, y) { return x + y; }, 0) / a.lead.length) : '',
      a.afterOfficial, a.leadUnknown, iso_(new Date())];
  }).sort(function (x, y) { return y[5] - x[5]; });
  write_('Attendibilita', rank);
  log_('score', 'done', rank.length + ' source(s) over ' + Object.keys(rounds).length + ' round(s) | '
    + fetched + ' truth page(s) fetched, the rest read from Veri');
  try { refreshStatus(); } catch (e) { log_('score', 'status', 'not refreshed: ' + e.message); }
  return rank;
}

// ==============================================================================================
// The Stato tab - what is working, what is armed, and what is missing
// ==============================================================================================

/**
 * Write the one-glance picture into the Sheet.
 *
 * WHY IT IS A TAB AND NOT A LOG LINE. Everything this file does happens while nobody is watching, and
 * the Apps Script log is only visible to whoever opens the editor. A Sheet that stays empty cannot be
 * told apart from one that never started - the same defect as a silent zero - so the picture is
 * written where the operator already is, and it says what was DONE, what is ARMED and what is
 * MISSING, in that order.
 *
 * THE VERDICT LINE STATES THE CONSEQUENCE AND NOT THE AGE, which is the rule this project already
 * applies to the app's freshness pill: "the kick-off is in 40 minutes and nothing is armed" is a
 * sentence somebody can act on, while "last run 3 hours ago" is a number they have to interpret. The
 * colour follows the same rule and is not decoration: green means nothing to do, amber means look,
 * red means this round is being lost right now.
 *
 * It never throws into its callers: a status that fails to draw must not take a capture down with it.
 */
function refreshStatus(pages) {
  var now = new Date();
  var anchor = round_(pages && pages.fantacalcio);
  var cal = schedule_(pages);
  var rows = [];
  var note = function (a, b, c) { rows.push([a, b === undefined ? '' : b, c === undefined ? '' : c]); };

  // What is armed, and for when.
  var armedAt = [];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'capture') armedAt.push(t);
  });
  var handlers = {};
  ScriptApp.getProjectTriggers().forEach(function (t) {
    handlers[t.getHandlerFunction()] = (handlers[t.getHandlerFunction()] || 0) + 1;
  });

  // The next kick-off still to come, and the one this round opened with. The OPENER is the one that
  // decides everything now (LEAD_MINUTES): the capture is armed on it and the scorer reads nothing
  // taken after it.
  var next = null;
  cal.forEach(function (f) { if (f.kickoff > now && (!next || f.kickoff < next.kickoff)) next = f; });
  var first = firstFixture_(cal);
  var openPassed = first && first.kickoff <= now;

  var taken = captureSummary_(anchor.round);
  var expected = Object.keys(SOURCES).length;
  var got = Object.keys(taken).length;

  // IS THE CALENDAR THE ONE OF THE ROUND THE ANCHOR NAMES? The round number comes from fantacalcio and
  // the fixtures from Corriere or Sky, and they do not change at the same moment: on Monday 21/09/2026
  // the anchor already said 6 while the fixture pages still carried round 5, all of it played - so the
  // Sheet printed "TURNO 6 PERSO" about a round nobody had had the chance to capture. It is provable
  // from the Sheet rather than guessed: if the opener this calendar shows is a kick-off ALREADY stored
  // under an earlier round, the calendar is the old one.
  var stale = false;
  if (first) {
    var t = first.kickoff.getTime();
    var pv = tab_('Probabili').getDataRange().getValues();
    for (var q = 1; q < pv.length && !stale; q += 1) {
      if (pv[q][12] && Number(pv[q][0]) < anchor.round && new Date(pv[q][12]).getTime() === t) stale = true;
    }
  }

  // ---- the verdict -------------------------------------------------------------------------
  var verdict, colour;
  if (!anchor.round) {
    verdict = 'NON RIESCO A LEGGERE IL TURNO - senza quello non si prende e non si scora';
    colour = '#f4cccc';
  } else if (!cal.length) {
    verdict = 'CALENDARIO NON LETTO - nessuna presa puo\' essere messa in orario';
    colour = '#f4cccc';
  } else if (stale) {
    // Not a loss and not an alarm: the fixture pages have not published the new round yet. Saying
    // "turno perso" here is crying wolf on the normal state of a Monday morning.
    verdict = 'IN ATTESA DEL CALENDARIO DEL TURNO ' + anchor.round
      + ' - le pagine portano ancora le partite del turno precedente, gia\' giocate';
    colour = '#efefef';
  } else if (openPassed) {
    verdict = got
      ? 'TURNO ' + anchor.round + ' FOTOGRAFATO (' + got + ' fonti su ' + expected
        + '). Si scora quando le partite sono giocate.'
      : 'TURNO ' + anchor.round + ' PERSO: e\' cominciato (' + itDate_(first.kickoff, true)
        + ') e non c\'e\' nessuna presa. Le fotografie su Drive si rileggono con recover('
        + anchor.round + ').';
    colour = got ? '#d9ead3' : '#f4cccc';
  } else if (!ScriptApp.getProjectTriggers().length) {
    verdict = 'NON INSTALLATO - lancia install(), altrimenti non succede niente da solo';
    colour = '#f4cccc';
  } else if (sameDay_(first.kickoff, now) && !armedAt.length) {
    verdict = 'IL TURNO SI APRE OGGI E LA PRESA NON E\' ARMATA - lancia planToday() adesso';
    colour = '#f4cccc';
  } else if (armedAt.length) {
    verdict = 'A POSTO - presa armata a ' + LEAD_MINUTES + ' minuti dall\'apertura del turno, '
      + itDate_(first.kickoff, true);
    colour = '#d9ead3';
  } else {
    verdict = 'IN ATTESA - il turno si apre ' + itDate_(first.kickoff, true)
      + '; la presa si arma alle ' + PLAN_HOUR + ':00 di quel giorno';
    colour = '#efefef';
  }
  note('VERDETTO', verdict);
  note('', '');

  // ---- where we are ------------------------------------------------------------------------
  note('Quadro scritto il', Utilities.formatDate(now, tz_(), 'dd/MM/yyyy HH:mm'), 'ora locale del progetto (' + tz_() + ')');
  note('Turno', anchor.round ? anchor.round + ' di ' + anchor.season : 'ignoto',
    'letto dal numero che la pagina stessa porta');
  note('Partite del turno', cal.length || 'ignote',
    first ? 'prima: ' + first.home + '-' + first.away + ' ' + itDate_(first.kickoff, true) : '');
  note('Apertura del turno', first ? itDate_(first.kickoff, true) : 'ignota',
    first ? (openPassed ? 'gia\' passata: dopo di lei nessuna lettura conta'
      : 'fra ' + human_(first.kickoff.getTime() - now.getTime()) + ' - e\' la scadenza di TUTTI i club')
      : '');
  note('Prossimo calcio d\'inizio', next ? itDate_(next.kickoff, true) : 'nessuno: il turno e\' cominciato tutto',
    next ? 'fra ' + human_(next.kickoff.getTime() - now.getTime()) + ' (' + next.home + '-' + next.away + ')' : '');
  note('Prese armate', armedAt.length, armedAt.length
    ? 'una sola, a ' + LEAD_MINUTES + ' minuti dall\'apertura del turno'
    : 'nessun trigger di presa in questo momento');
  note('Automatismi', Object.keys(handlers).length
    ? Object.keys(handlers).map(function (k) { return k + ' x' + handlers[k]; }).join(', ')
    : 'NESSUNO', Object.keys(handlers).length ? '' : 'lancia install()');
  note('', '');

  // ---- the capture of this round, source by source -----------------------------------------
  note('PRESA DEL TURNO ' + (anchor.round || '?'), got + ' fonti su ' + expected);
  Object.keys(SOURCES).forEach(function (key) {
    var s = taken[SOURCES[key].label];
    if (!s) {
      // An absence is stated, never left blank: "not yet" and "it failed" are different sentences and
      // the second one is in the Log with its reason.
      note('  ' + SOURCES[key].label, openPassed ? 'MANCA' : 'non ancora',
        openPassed ? 'il turno e\' cominciato senza questa fonte'
          : 'si prende a ' + LEAD_MINUTES + ' minuti dall\'apertura del turno');
      return;
    }
    note('  ' + SOURCES[key].label, s.players + ' giocatori su ' + s.clubs + ' club',
      'presa ' + Utilities.formatDate(s.takenAt, tz_(), 'dd/MM HH:mm')
      + (s.lead === '' ? '' : ' (' + s.lead + " minuti prima del fischio)")
      + (s.noId ? ' - ' + s.noId + ' nomi senza fc_id' : ''));
  });
  note('', '');

  // ---- what has been scored so far ---------------------------------------------------------
  var rank = tab_('Attendibilita').getDataRange().getValues();
  if (rank.length < 2) {
    note('CLASSIFICA', 'ancora niente',
      'esce dopo il primo turno GIOCATO: serve la verita\', che arriva a partite finite');
  } else {
    // The column indexes come from TABS so that inserting one cannot silently print the wrong cell -
    // which it just did: `after_official` pushed `updated_utc` along and the date read as a count.
    var col = function (name) { return TABS.Attendibilita.indexOf(name); };
    note('CLASSIFICA', 'aggiornata il '
      + Utilities.formatDate(new Date(rank[1][col('updated_utc')]), tz_(), 'dd/MM HH:mm'),
      'turni scorati: ' + rank[1][col('rounds')]);
    for (var i = 1; i < rank.length; i += 1) {
      note('  ' + rank[i][col('source')], (rank[i][col('share')] * 100).toFixed(1) + '% degli undici veri',
        'null ' + (rank[i][col('null_share')] * 100).toFixed(1) + '% -> margine '
        + (rank[i][col('margin_pt')] >= 0 ? '+' : '') + Number(rank[i][col('margin_pt')]).toFixed(1) + ' punti'
        + (rank[i][col('unresolved')] ? ' | ' + rank[i][col('unresolved')] + ' nomi non risolti' : ''));
    }
    note('  come si legge', 'il margine, non la percentuale',
      'il null e\' l\'undici della partita precedente: una fonte vale solo quanto lo batte');
    // What the number is ABOUT, said where it is read: with the capture fifteen minutes out, the
    // official eleven is already public, so this largely measures who copies it soonest.
    var afterAll = 0, clubsAll = 0, unknownAll = 0;
    for (var j = 1; j < rank.length; j += 1) {
      afterAll += Number(rank[j][col('after_official')]) || 0;
      unknownAll += Number(rank[j][col('lead_unknown')]) || 0;
      clubsAll += Number(rank[j][col('clubs')]) || 0;
    }
    note('  letture dopo le ufficiali', afterAll + ' su ' + clubsAll,
      afterAll ? 'li\' l\'undici e\' gia\' annunciato: si misura chi lo riporta prima, non chi lo prevede'
        : 'tutte prese prima dell\'annuncio: e\' una previsione');
    // An unknown distance from the whistle is its own line and is NEVER added to the safe side: a
    // blank in `lead_min` says nobody can state whether that reading was a forecast or a copy.
    if (unknownAll) {
      note('  letture di distanza ignota', unknownAll + ' su ' + clubsAll,
        'il calendario non fu letto a quella presa: non si sa se erano previsioni o copie');
    }
  }
  note('', '');

  // ---- anything that went wrong ------------------------------------------------------------
  var bad = recentTrouble_(8);
  note('PROBLEMI RECENTI', bad.length ? bad.length + ' nel foglio Log' : 'nessuno');
  bad.forEach(function (b) { note('  ' + b[1] + ' / ' + b[2], b[3], Utilities.formatDate(new Date(b[0]), tz_(), 'dd/MM HH:mm')); });

  var n = 0, it = folder_().getFiles();
  while (it.hasNext()) { it.next(); n += 1; }
  note('', '');
  note('Fotografie su Drive', n, 'cartella "' + FOLDER + '", una per fonte per presa, tenute ' + KEEP_DAYS + ' giorni');

  write_('Stato', rows);
  var sh = tab_('Stato');
  sh.getRange(2, 1, 1, 3).setBackground(colour).setFontWeight('bold');
  sh.setColumnWidth(1, 230); sh.setColumnWidth(2, 330); sh.setColumnWidth(3, 520);
  return verdict;
}

/**
 * What has been captured for a round, per source: the reading that COUNTS, club by club.
 *
 * Per (source, CLUB) and not per source, because after a prune the surviving instants differ inside
 * one source on purpose - the Friday fixture keeps its Friday reading while the rest keep Saturday's.
 * The first version kept only the rows sharing the single newest instant and therefore reported a
 * complete round as half captured: measured on a pruned round, `198 giocatori su 18 club` for a source
 * that had all 220 over 20. A status that undercounts is worse than no status, because it sends
 * somebody looking for a failure that is not there.
 */
function captureSummary_(round) {
  var out = {};
  if (!round) return out;
  var v = tab_('Probabili').getDataRange().getValues();
  var chosen = chosenTakes_(v);
  for (var i = 1; i < v.length; i += 1) {
    var r = v[i];
    if (Number(r[0]) !== Number(round) || !r[11]) continue;
    var c = chosen[takeKey_(r)];
    if (!c || new Date(r[11]).getTime() !== c.keep) continue;
    var src = r[2];
    var s = out[src] || (out[src] = { takenAt: new Date(r[11]), lead: r[13], players: 0, clubs: {}, noId: 0 });
    // The instant shown is the most RECENT of the ones kept, and the lead travels with it, so the two
    // describe the same reading instead of one row's instant and another row's distance from kick-off.
    if (new Date(r[11]).getTime() > s.takenAt.getTime()) { s.takenAt = new Date(r[11]); s.lead = r[13]; }
    s.players += 1;
    s.clubs[r[4]] = 1;
    if (!r[6]) s.noId += 1;
  }
  Object.keys(out).forEach(function (k) { out[k].clubs = Object.keys(out[k].clubs).length; });
  return out;
}

/**
 * The rounds whose truth is already in `Veri`, COMPLETE - twenty clubs and eleven each.
 *
 * The completeness rule is the truth page's own, applied to the archive: a round stored while a
 * fixture was still ungraded must not be believed just because it is on the Sheet, or the cache would
 * make a half-published round permanent.
 */
function truthArchive_() {
  var v = tab_('Veri').getDataRange().getValues();
  var per = {};
  for (var i = 1; i < v.length; i += 1) {
    var round = Number(v[i][0]);
    (per[round] = per[round] || []).push({
      club: v[i][2], clubKey: v[i][3], fcId: String(v[i][4]), player: v[i][5]
    });
  }
  var out = {};
  Object.keys(per).forEach(function (round) {
    var byClub = {};
    per[round].forEach(function (x) { byClub[x.clubKey] = (byClub[x.clubKey] || 0) + 1; });
    var clubs = Object.keys(byClub);
    var complete = clubs.length >= CLUBS_IN_LEAGUE && clubs.every(function (c) { return byClub[c] === 11; });
    if (complete) out[round] = per[round];
  });
  return out;
}

/** The lines of the Log that report something going wrong, most recent first. */
function recentTrouble_(limit) {
  var v = tab_('Log').getDataRange().getValues();
  var bad = [];
  for (var i = v.length - 1; i > 0 && bad.length < limit; i -= 1) {
    var d = String(v[i][3] || '');
    if (/NOT TAKEN|REFUSED|FAILED|NOT SCORED|skipped|NO -|not refreshed/i.test(d)) bad.push(v[i]);
  }
  return bad;
}

function sameDay_(a, b) {
  return Utilities.formatDate(a, tz_(), 'yyyy-MM-dd') === Utilities.formatDate(b, tz_(), 'yyyy-MM-dd');
}

function human_(ms) {
  var m = Math.round(ms / 60000);
  if (m < 60) return m + ' minuti';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h' + (m % 60 ? ' ' + (m % 60) + "'" : '');
  return Math.floor(h / 24) + ' giorni e ' + (h % 24) + 'h';
}

/**
 * How sure a reading is of itself: the share of its men given at exactly 100%.
 *
 * WHY IT IS WATCHED. The official line-ups come out about an hour before kick-off, and a capture timed
 * twenty minutes before it falls AFTER that. If a site replaces its forecast with the announced eleven,
 * this stops being a prediction and becomes a copy of the answer - and every source scored on it would
 * read near 100%, which is the one way this whole Sheet could produce a confident and meaningless
 * ranking. Measured two hours before kick-off on 18/09/2026: ZERO men at 100% anywhere on the page,
 * so there is no contamination then; what happens inside the last hour is not known and is therefore
 * WATCHED rather than assumed.
 *
 * Only two of the four sources publish a percentage, so this is a partial instrument - but if the one
 * that does goes to 100%, the window is contaminated for all of them. Returns null when a source
 * publishes no percentages at all, which is "unknown" and not "fine".
 */
function certainty_(rows) {
  var n = 0, sure = 0;
  rows.forEach(function (r) {
    if (r.probability === null || r.probability === undefined) return;
    n += 1;
    if (r.probability >= 1) sure += 1;
  });
  return n ? sure / n : null;
}

/** The key a reading is chosen by: one prediction per (round, source, club). */
function takeKey_(row) { return Number(row[0]) + '|' + row[2] + '|' + row[4]; }

/** The highest round this Sheet has already recorded - the stand-in when fantacalcio cannot be read. */
function lastRound_() {
  var v = tab_('Probabili').getDataRange().getValues();
  var best = { round: null, season: null };
  for (var i = 1; i < v.length; i += 1) {
    if (best.round === null || Number(v[i][0]) > best.round) best = { round: Number(v[i][0]), season: v[i][1] };
  }
  return best;
}

/**
 * The kick-off of a (round, club), taken from ANY row that carries one.
 *
 * A kick-off is a fact about the fixture, not about the source that happened to report it, so a row
 * written while the schedule was unreadable inherits the instant another row already knows. Without
 * this, a round captured with no schedule leaves every row with an empty kick-off, and then a reading
 * taken the day AFTER the match counts as a forecast - the exact thing `chosenTakes_` says it refuses.
 */
function kickoffIndex_(values) {
  var out = {};
  for (var i = 1; i < values.length; i += 1) {
    var r = values[i];
    if (!r[12]) continue;
    var k = Number(r[0]) + '|' + r[4];
    var t = new Date(r[12]).getTime();
    if (out[k] === undefined || t < out[k]) out[k] = t;      // the earliest, so a late row cannot widen it
  }
  return out;
}

/**
 * The instant a round OPENED, per round, read from the rows themselves.
 *
 * It is the deadline every club of that round shares (LEAD_MINUTES): a reading taken at or after it
 * describes a round that has started. Derived from the archive and not from today's calendar on
 * purpose - a round is scored months after its fixtures have left the sites, and a deadline that
 * depended on a page still carrying them would quietly change what an old round means.
 *
 * A round whose rows carry no kick-off at all has no opener, and there `chosenTakes_` keeps the
 * newest reading rather than none: an unknown deadline must not silently delete a prediction.
 */
function openerIndex_(values) {
  var out = {};
  for (var i = 1; i < values.length; i += 1) {
    var r = values[i];
    if (!r[12]) continue;
    var round = Number(r[0]);
    var t = new Date(r[12]).getTime();
    if (out[round] === undefined || t < out[round]) out[round] = t;
  }
  return out;
}

/**
 * Which capture counts, per (round, source, club) - ONE definition, read by the scorer and by the
 * pruner.
 *
 * `use` is the last reading strictly before the round's FIRST kick-off, and null when there is none:
 * once the opener has started the round is under way, so a later reading is not a forecast of it and
 * scores nothing. `keep` is what the Sheet should still carry, which is `use` when it exists and
 * otherwise the last reading there is - a source that only published late still said something, and a
 * row removed would read as a source that said nothing.
 *
 * THE DEADLINE IS THE OPENER AND NOT THE CLUB'S OWN KICK-OFF, by the operator's rule of 21/09/2026;
 * LEAD_MINUTES carries the rule, its reason and its price. The club's own kick-off is still read, and
 * still matters - it is what `lead_min` and `after_official` are measured against - but it no longer
 * decides what counts.
 *
 * TWO READERS AND ONE DEFINITION, on purpose: if the pruner kept "the newest" while the scorer used
 * "the last before the opener", then the only surviving reading would be one taken while the round
 * was being played, and every club would silently lose its prediction. A round with no kick-off on
 * any row has no opener, and there the newest is the newest - an unknown deadline must not delete a
 * prediction.
 */
function chosenTakes_(values) {
  var openers = openerIndex_(values);
  var out = {};
  for (var i = 1; i < values.length; i += 1) {
    var r = values[i];
    if (!r[11]) continue;
    var k = takeKey_(r);
    var taken = new Date(r[11]).getTime();
    var opener = openers[Number(r[0])];
    if (opener === undefined) opener = null;
    var o = out[k] || (out[k] = { use: null, keep: null });
    if (opener === null || taken < opener) { if (o.use === null || taken > o.use) o.use = taken; }
    if (o.keep === null || taken > o.keep) o.keep = taken;
  }
  Object.keys(out).forEach(function (k) { if (out[k].use !== null) out[k].keep = out[k].use; });
  return out;
}

// ==============================================================================================
// Repair and removal
// ==============================================================================================

/**
 * Drop the readings no longer worth keeping: per (round, source, club), everything but the one
 * `chosenTakes_` says counts.
 *
 * Asked for by the operator (18/09/2026) as "capture the same round twice and the old rows should
 * go", and implemented one step away from the letter of it: NOT "keep the newest", but "keep the one
 * that counts". The two differ exactly where it matters - a club that has already played keeps its
 * last PRE-KICK-OFF reading, while the newest reading for it was taken after the whistle and is worth
 * nothing.
 *
 * What it costs is the SERIES: after a prune nobody can ask how much a site changed its mind between
 * Friday and Sunday. That question was worth keeping the option on and is now traded for a Sheet that
 * stays the same size every round - a trade, said out loud, and reversible by not calling this.
 */
function prune_(round) {
  var sh = tab_('Probabili');
  if (sh.getLastRow() < 2) return 0;
  var v = sh.getDataRange().getValues();
  var chosen = chosenTakes_(v);
  var width = TABS.Probabili.length;
  var keep = [];
  var dropped = 0;
  for (var i = 1; i < v.length; i += 1) {
    var r = v[i];
    if (round && Number(r[0]) !== Number(round)) { keep.push(r); continue; }
    var c = chosen[takeKey_(r)];
    if (c && r[11] && new Date(r[11]).getTime() === c.keep) keep.push(r); else dropped += 1;
  }
  if (!dropped) return 0;
  sh.getRange(2, 1, sh.getLastRow() - 1, width).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep);
  log_('prune', round ? 'round ' + round : 'all rounds',
    dropped + ' superseded rows dropped, ' + keep.length + ' kept (one reading per source and club)');
  return dropped;
}

/** The menu entry, for a prune by hand over everything captured so far. */
function pruneNow() { return prune_(null); }

/**
 * Put back the shapes Sheets turned into dates - rather than delete the rows that carry them.
 *
 * REPAIRING BEATS DELETING HERE, and the reason is what those rows contain: the coercion damaged ONE
 * column, while the player, the fc_id, the probability and the instants on the same row are intact
 * and are what everything is scored on. Throwing the row away to fix a reporting column would cost
 * the good data to tidy the bad.
 *
 * The date is INVERTIBLE, which is what makes this a repair and not a guess: `4-3-3` was read as
 * 4 March 2003, so day-month-(year - 2000) reconstructs it exactly. And the reconstruction is CHECKED
 * against the rulebook's own shapes before it is written: a value that does not come back as a real
 * shape is left alone and counted, because a plausible reconstruction that nothing verifies is how a
 * repair quietly invents data.
 *
 * Idempotent: a cell already holding text is not a Date and is skipped.
 */
function repairFormations() {
  var sh = tab_('Probabili');                       // also sets the column to text, which must happen first
  if (sh.getLastRow() < 2) { log_('repair', 'formation', 'nothing to repair'); return 0; }
  var col = TABS.Probabili.indexOf('formation') + 1;
  var rng = sh.getRange(2, col, sh.getLastRow() - 1, 1);
  var vals = rng.getValues();
  var fixed = 0, unrecoverable = 0;
  for (var i = 0; i < vals.length; i += 1) {
    var v = vals[i][0];
    if (!(v instanceof Date)) continue;
    var guess = v.getDate() + '-' + (v.getMonth() + 1) + '-' + (v.getFullYear() - 2000);
    if (REAL_SHAPES.indexOf(guess) >= 0) { vals[i][0] = guess; fixed += 1; }
    else { unrecoverable += 1; }
  }
  if (fixed) rng.setValues(vals);
  log_('repair', 'formation', fixed + ' shapes put back'
    + (unrecoverable ? ' | ' + unrecoverable + ' dates that do not reconstruct a real shape, LEFT ALONE' : ''));
  try { refreshStatus(); } catch (e) { /* the repair is what matters */ }
  return fixed;
}

/**
 * Remove the captured rows of ONE round. Destructive on purpose, and therefore narrow.
 *
 * It takes a round rather than clearing everything, and it SAYS how many rows it removed and how many
 * it kept: a delete that reports nothing cannot be told from one that matched nothing. Nothing else in
 * this file removes a captured row - `write_` rewrites only the DERIVED tabs - so this is the single
 * place where a reading is destroyed, which is where it should be.
 *
 * What it costs is usually nothing: every capture writes all twenty clubs, so the next one replaces
 * what this removes. What it cannot give back is a reading of a round already KICKED OFF, which is
 * the one case worth stopping to think about.
 */
function clearRound(round) {
  if (!round) { log_('clear', 'skipped', 'no round given - nothing removed'); return 0; }
  var sh = tab_('Probabili');
  var v = sh.getDataRange().getValues();
  var width = TABS.Probabili.length;
  var keep = [];
  var removed = 0;
  for (var i = 1; i < v.length; i += 1) {
    if (Number(v[i][0]) === Number(round)) removed += 1; else keep.push(v[i]);
  }
  if (!removed) { log_('clear', 'round ' + round, 'no row of that round - nothing removed'); return 0; }
  sh.getRange(2, 1, sh.getLastRow() - 1, width).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep);
  log_('clear', 'round ' + round, removed + ' rows removed, ' + keep.length + ' kept');
  try { refreshStatus(); } catch (e) { /* the removal is what matters */ }
  return removed;
}

/** The menu entry: a destructive action asks which round, and says what it did. */
function recoverAsked() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt('Rileggere un turno dalle fotografie',
    'Numero del turno. Rimette le letture prese PRIMA che il turno cominciasse, senza togliere niente'
    + ' di quello che c\'e\' gia\'. Poi lancia lo scoring.', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return 0;
  var round = Number(String(answer.getResponseText()).trim());
  if (!round) { ui.alert('Niente fatto: non ho letto un numero di turno.'); return 0; }
  var n = recover(round);
  ui.alert(n ? n + ' righe rimesse per il turno ' + round + '. Adesso lancia lo scoring.'
    : 'Nessuna riga rimessa per il turno ' + round + ': guarda il foglio Log per la ragione.');
  return n;
}

function clearRoundAsked() {
  var ui = SpreadsheetApp.getUi();
  var anchor = round_();
  var answer = ui.prompt('Togliere le prese di un turno',
    'Numero del turno da rimuovere' + (anchor.round ? ' (quello in corso e\' il ' + anchor.round + ')' : '')
    + '. Le righe tolte tornano alla presa successiva.', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return 0;
  var round = Number(String(answer.getResponseText()).trim());
  if (!round) { ui.alert('Niente rimosso: non ho letto un numero di turno.'); return 0; }
  var n = clearRound(round);
  ui.alert(n ? n + ' righe rimosse dal turno ' + round + '.' : 'Nessuna riga del turno ' + round + '.');
  return n;
}

// ==============================================================================================
// The public reading: what the sources say about the coming round, as JSON
// ==============================================================================================

/**
 * `doGet` - the endpoint the app reads for its "prossimo turno" board.
 *
 * WHY THE APP READS THIS AND NOT THE BUNDLE. The bundle is written by `export` on the operator's
 * laptop, and the captures happen at kick-off minus fifteen with that laptop possibly off - which is
 * the entire reason this Sheet exists. A board delivered through the bundle would therefore be about
 * a day stale for exactly the fixtures it is for: on Saturday at 15:00 it would show Friday's reading.
 * So the app reads this, live. His decision, 18/09/2026.
 *
 * IT IS NOT OUR PREDICTION AND THE PAYLOAD SAYS SO. These are the four sites' elevens, counted - the
 * press, which in this project is a JUDGE and never an input. Our own two boards stay where they are
 * and keep being judged against it; this is a third object, a re-publication of what the sources say,
 * and nothing in the engine may read it back.
 *
 * IT DOES NOT CUT THE ELEVEN. Every man a source named comes out with how many sources named him, and
 * the reader takes the top eleven. Cutting here would bake a tie-break into the transport, and a tie
 * broken silently is a latent bias - the reading that matters (four sources out of four, or two) is
 * exactly what the count makes visible.
 *
 * The reading served is the one `chosenTakes_` says COUNTS, so this endpoint and the score can never
 * disagree about which capture is being shown.
 *
 * DEPLOY: Extensions -> Apps Script -> Deploy -> New deployment -> Web app, execute as ME, access
 * ANYONE. That makes the URL public, which is the same choice already taken for the gh-pages bundle -
 * it carries player names and predicted elevens derived from paid pages, and it is worth knowing.
 */
function doGet(e) {
  var round = e && e.parameter && e.parameter.round ? Number(e.parameter.round) : null;
  var cached = CacheService.getScriptCache().get('next:' + round);
  if (cached) return json_(cached);
  var body = JSON.stringify(nextRound_(round));
  // Two minutes: long enough that a page open on several devices costs one read, short enough that a
  // capture fifteen minutes before kick-off is visible almost at once.
  try { CacheService.getScriptCache().put('next:' + round, body, 120); } catch (err) { /* over size */ }
  return json_(body);
}

function json_(body) {
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

/**
 * What the sources say about a round, club by club, with the count behind every man.
 *
 * `votes` is how many of the sources that were READ name him, and `of` how many read that club at all -
 * two different numbers, because a source that failed to answer must not read as a source that left
 * him out. That is the same "vuoto = ignoto" this project applies everywhere, at the level of a vote.
 */
function nextRound_(round) {
  var v = tab_('Probabili').getDataRange().getValues();
  if (v.length < 2) return { round: null, clubs: {}, note: 'nothing captured yet' };
  if (!round) {
    round = 0;
    for (var i = 1; i < v.length; i += 1) if (Number(v[i][0]) > round) round = Number(v[i][0]);
  }
  var chosen = chosenTakes_(v);
  var clubs = {};
  var sources = {};
  for (var j = 1; j < v.length; j += 1) {
    var r = v[j];
    if (Number(r[0]) !== round || !r[11]) continue;
    var c = chosen[takeKey_(r)];
    if (!c || new Date(r[11]).getTime() !== c.keep) continue;   // not the reading that counts
    sources[r[2]] = 1;
    var key = r[4];
    var club = clubs[key] || (clubs[key] = {
      club: r[3], kickoff: r[12] || null, taken_at: r[11], sources: {}, men: {}, shapes: {}
    });
    // IL MODULO CHE OGNI FONTE DICHIARA, e non un modulo nostro: e' la colonna `formation`, che il
    // foglio archivia dal primo giorno e che l'endpoint non esportava. Serve a chi disegna - un
    // 3-4-2-1 e' una cosa che i ruoli di listone non sanno dire (leggono 1-3-6-1, perche' un
    // trequartista e' un `C`) - e si esporta con CHI lo dice, perche' le fonti possono non essere
    // d'accordo sul modulo come non lo sono sugli uomini.
    if (r[5]) (club.shapes[r[5]] = club.shapes[r[5]] || {})[r[2]] = 1;
    if (r[11] > club.taken_at) club.taken_at = r[11];
    club.sources[r[2]] = 1;
    // Men are keyed on the fc_id where there is one, and on the verbatim name where there is not -
    // so an unresolved name stays a man of his own rather than merging with somebody else's.
    var id = r[6] ? String(r[6]) : 'name:' + r[7];
    var man = club.men[id] || (club.men[id] = {
      fc_id: r[6] ? String(r[6]) : null, player: r[7], role: r[8] || null, votes: 0, by: [], prob: []
    });
    man.votes += 1;
    man.by.push(r[2]);
    if (r[9] !== '' && r[9] !== null) man.prob.push(Number(r[9]));
  }
  var out = {};
  Object.keys(clubs).forEach(function (key) {
    var club = clubs[key];
    var read = Object.keys(club.sources).length;
    mergeInitials_(club.men);
    var shapes = {};
    Object.keys(club.shapes).forEach(function (one) { shapes[one] = Object.keys(club.shapes[one]); });
    out[key] = {
      club: club.club, kickoff: club.kickoff, taken_at: club.taken_at, of: read, shapes: shapes,
      men: Object.keys(club.men).map(function (id) {
        var m = club.men[id];
        return {
          fc_id: m.fc_id, player: m.player, role: m.role, votes: m.votes, of: read, by: m.by,
          // The mean of the percentages that exist, and null when none does: two of the four sources
          // publish one, so this is a tie-break the reader may use and never a figure to rank on.
          prob: m.prob.length ? Math.round(m.prob.reduce(function (a, b) { return a + b; }, 0)
            / m.prob.length * 100) / 100 : null
        };
      }).sort(function (a, b) { return b.votes - a.votes || (b.prob || 0) - (a.prob || 0); })
    };
  });
  return {
    round: round, generated_at: iso_(new Date()), sources: Object.keys(sources),
    // Said in the payload and not only in a comment: whoever reads this must know it is the press.
    what: 'what the sources published, counted - not a prediction of ours',
    clubs: out
  };
}

/**
 * DUE GRAFIE DI UN UOMO SOLO, quando NESSUNA delle due ha la nostra chiave.
 *
 * Sky scrive `Haps R.` e il Corriere `Haps`: due voci da 1/4 al posto di un uomo da 2/4, cioe' un uomo
 * che le fonti nominano di piu' di quanto il conteggio dica (operatore, 18/09/2026). Succede quando la
 * pagina di fantacalcio non lo nomina affatto - l'indice delle identita' nasce da li', quindi per lui
 * non c'e' nessuna chiave a cui agganciarsi e ognuno resta col proprio nome.
 *
 * SI UNISCONO SOLO GLI IRRISOLTI, e solo dove la cosa non e' ambigua: il nome corto dev'essere il
 * PREFISSO dell'altro e l'altro deve aggiungere soltanto un'iniziale (`Haps` + `R.`). Se in quel club
 * ci sono TRE voci che si somigliano cosi', o se una di loro ha un `fc_id`, non si tocca niente: unire
 * `Esposito` a `Esposito S.` quando all'Inter ce ne sono due sarebbe inventare una persona, che e'
 * peggio del conteggio spezzato che si sta curando. E si unisce dentro UN club, mai fra club diversi.
 *
 * Chi vince il nome e' il piu' LUNGO: porta l'iniziale, quindi dice di piu'.
 */
function mergeInitials_(men) {
  var keys = Object.keys(men);
  var open = keys.filter(function (k) { return !men[k].fc_id; });
  for (var i = 0; i < open.length; i += 1) {
    var a = men[open[i]];
    if (!a) continue;
    for (var j = i + 1; j < open.length; j += 1) {
      var b = men[open[j]];
      if (!b) continue;
      var pair = initialsPair_(a.player, b.player);
      if (!pair) continue;
      // Un terzo nome che si somiglia rende la coppia ambigua: si lascia tutto com'e'.
      var others = open.filter(function (k) {
        var one = men[k];
        return one && one !== a && one !== b
          && (initialsPair_(one.player, a.player) || initialsPair_(one.player, b.player));
      });
      if (others.length) continue;
      var keep = a.player.length >= b.player.length ? a : b;
      var drop = keep === a ? b : a;
      drop.by.forEach(function (src) { if (keep.by.indexOf(src) < 0) { keep.by.push(src); } });
      keep.votes = keep.by.length;
      drop.prob.forEach(function (one) { keep.prob.push(one); });
      if (!keep.role) keep.role = drop.role;
      // Si cancella la voce di chi PERDE, e una sola volta: `keep` e' gia' il nome piu' lungo, quindi
      // non c'e' niente da ricopiargli addosso e la seconda delete di prima non toglieva niente.
      delete men[keep === a ? open[j] : open[i]];
      break;
    }
  }
}

/** `Haps` e `Haps R.` sono la stessa coppia; `Esposito S.` e `Esposito P.` no, e nemmeno due nomi diversi. */
function initialsPair_(one, two) {
  var a = String(one || '').trim();
  var b = String(two || '').trim();
  if (!a || !b || a === b) return false;
  var shortOne = a.length < b.length ? a : b;
  var longOne = a.length < b.length ? b : a;
  if (longOne.indexOf(shortOne + ' ') !== 0) return false;
  var rest = longOne.slice(shortOne.length + 1);
  // Quello che resta dev'essere SOLO un'iniziale puntata: `R.`, `J.`, al piu' `Fr.`.
  return /^[A-Z][a-z]?\.$/.test(rest);
}

// ==============================================================================================
// Install, menu, status
// ==============================================================================================

function install() {
  Object.keys(TABS).forEach(function (t) { tab_(t); });
  dropTriggers_('planToday');
  dropTriggers_('score');
  ScriptApp.newTrigger('planToday').timeBased().everyDays(1).atHour(PLAN_HOUR).create();
  // The score runs the morning after: a round is scored once it has been played, and scoring it on
  // Friday evening would be scoring a round nobody has played.
  ScriptApp.newTrigger('score').timeBased().everyDays(1).atHour(9).create();
  log_('install', 'ok', 'planner at ' + PLAN_HOUR + ':00, scorer at 09:00');
  planToday();
  return status();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Probabili')
    .addItem('1. Check the sources (probe)', 'probe')
    .addItem('2. Install the schedule', 'install')
    .addSeparator()
    .addItem('Capture now', 'captureNow')
    .addItem('Score the played rounds', 'score')
    .addItem('Refresh the Stato tab', 'status')
    .addSeparator()
    .addItem('Repair the shapes Sheets turned into dates', 'repairFormations')
    .addItem('Re-read a round from the photographs...', 'recoverAsked')
    .addItem('Drop superseded readings', 'pruneNow')
    .addItem('Remove the captures of a round...', 'clearRoundAsked')
    .addToUi();
}

function captureNow() { return capture('by hand'); }

/**
 * Write the Stato tab and return its verdict.
 *
 * The editor's log is only visible to whoever has the editor open, and this thing runs while nobody
 * is watching - so the picture goes where the operator already is.
 */
function status() {
  var verdict = refreshStatus();
  Logger.log(verdict);
  return verdict;
}

// ==============================================================================================
// Helpers
// ==============================================================================================

/**
 * One fetch, with the guard the CALLER's question needs - and that parameter is the whole point.
 *
 * The shape count is the right instrument for a probabili page and the wrong one for the truth page,
 * which carries a table of GRADES and therefore zero shapes by construction (measured: 0 on a page of
 * 1.2 MB that is perfectly complete). The first version applied it to both, so `probe()` reported the
 * truth page as "200 without elevens" the first time it ran on Google - a guard used outside the
 * population it was measured on, which is a defect this project has paid for more than once.
 *
 * The truth page needs no shape guard because `truth_` already holds a STRICTER one of its own:
 * twenty clubs and eleven starters each, asserted, with the round refused when it fails. A weaker
 * guard in front of a stronger one can only get in its way.
 *
 * Note for whoever verifies this offline: a harness that stubs `fetch_` tests the parser and NOT this
 * guard, which is exactly how the defect above survived a green bench.
 */
function fetch_(url, minShapes) {
  var res;
  try {
    res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': UA, 'Accept-Language': 'it-IT,it;q=0.9' }
    });
  } catch (e) {
    return { ok: false, why: 'no answer (' + e.message + ')', html: '' };
  }
  var code = res.getResponseCode();
  if (code !== 200) return { ok: false, why: 'HTTP ' + code, html: '' };
  var html = res.getContentText();
  // A 200 is not evidence for a LINE-UP page: both refused sites answer 200. The elevens decide - and
  // the same judgement is reachable on its own (`believable_`) so a replayed photograph is refused for
  // the same reason the live page was.
  return believable_(html, minShapes);
}

/** How many of the rulebook's own shapes the page carries. A naive n-n-n pattern is not enough:
 *  '3-2-4' and '4-2-1' matched it on a page with no eleven at all. */
function countShapes_(html) {
  var text = strip_(html);
  var n = 0;
  REAL_SHAPES.forEach(function (s) { if (text.indexOf(s) >= 0) n += 1; });
  return n;
}

function parseWith_(name, html) {
  if (name === 'parseFantacalcio_') return parseFantacalcio_(html);
  if (name === 'parseSky_') return parseSky_(html);
  if (name === 'parseCorriere_') return parseCorriere_(html);
  if (name === 'parseSosfanta_') return parseSosfanta_(html);
  throw new Error('unknown parser ' + name);
}

function uniqueClubs_(rows) {
  var s = {};
  rows.forEach(function (r) { if (r.clubKey) s[r.clubKey] = 1; });
  return Object.keys(s).length;
}

function strip_(html) { return decode_(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' '); }

/** Entities are decoded before anything is matched: the weekday arrives as "venerd&#xEC;" and a
 *  reader anchored on it loses every Friday anticipo. */
function decode_(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function clean_(s) { return noComments_(decode_(String(s))).replace(/\s+/g, ' ').trim(); }

/** Next.js writes an empty comment between interpolated values, so a value can be split in three. */
function noComments_(s) { return String(s).replace(/<!--[\s\S]*?-->/g, ''); }

/**
 * The parts of a name worth joining on: accents off, case off, initials dropped.
 *
 * Tokens and not "the first word": the three sites order the parts differently - fantacalcio writes
 * `Varela G.` where the others write `Gustavo Varela`, and `Mangas` against `Ricardo Mangas` - so a
 * first-word key misses every forename-first spelling. Anything shorter than three letters goes: it
 * is an initial, and an initial joins nothing while being able to collide with everything.
 */
function tokens_(s) {
  var base = fold_(clean_(s).toLowerCase());
  // Both spellings of a joined name are emitted: `N'Dicka` is written `Ndicka` by one site and
  // `N'Dicka` by another, and splitting on the apostrophe would leave `dicka` against `ndicka`.
  // Emitting both costs nothing - a token claimed by two men is refused anyway.
  var forms = [base.replace(/['’`\-]/g, ''), base.replace(/['’`\-]/g, ' ')];
  var out = {};
  forms.forEach(function (f) {
    f.replace(/[^a-z]+/g, ' ').split(' ').forEach(function (t) { if (t.length >= 3) out[t] = 1; });
  });
  return Object.keys(out);
}

/** Accents off, including the Nordic and Slavic ones a Serie A team sheet is full of.
 *  Written as a pair of strings because Apps Script has no String.normalize('NFD'). */
var FOLD_FROM = 'àáâãäåāăą'
  + 'èéêëēĕėęě'
  + 'ìíîïĩīĭįı'
  + 'òóôõöøōŏő'
  + 'ùúûüũūŭůűų'
  + 'çćĉčñńňśšşźżž'
  + 'ýÿŷğģķļłřŗťţďđı';
var FOLD_TO = 'aaaaaaaaa' + 'eeeeeeeee' + 'iiiiiiiii' + 'ooooooooo' + 'uuuuuuuuuu'
  + 'cccc' + 'nnn' + 'sss' + 'zzz' + 'yyy' + 'gg' + 'kll' + 'rrtt' + 'ddi';

function fold_(s) {
  var out = '';
  for (var i = 0; i < s.length; i += 1) {
    var c = s.charAt(i);
    if (c === 'æ') { out += 'ae'; continue; }
    if (c === 'ß') { out += 'ss'; continue; }
    var j = FOLD_FROM.indexOf(c);
    out += j >= 0 ? FOLD_TO.charAt(j) : c;
  }
  return out;
}

function clubKey_(name) {
  var k = clean_(name).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return CLUB_ALIASES[k] || k.split(' ')[0];
}

function iso_(d) { return Utilities.formatDate(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'"); }

function tz_() { return Session.getScriptTimeZone(); }

/**
 * A date in Italian, because `EEE` follows the SCRIPT's locale and the Stato tab is written in
 * Italian: "Fri 18/09" in the middle of Italian prose is the sort of seam that makes a reader ask
 * whether the number beside it is theirs. The map is three letters, which is what a date in a tab
 * has room for.
 */
var GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

function itDate_(d, withTime) {
  // The calendar date is taken in the project's zone, and the weekday is then computed from that
  // date in UTC. Going through the date instead of asking for a weekday pattern avoids both the
  // locale (which is what put "Fri" there) and the daylight-saving edge, where a weekday read from
  // the raw instant can belong to the previous day.
  var ymd = Utilities.formatDate(d, tz_(), 'yyyy-MM-dd').split('-');
  var day = new Date(Date.UTC(Number(ymd[0]), Number(ymd[1]) - 1, Number(ymd[2]))).getUTCDay();
  return GIORNI[day] + ' ' + Utilities.formatDate(d, tz_(), withTime ? 'dd/MM HH:mm' : 'dd/MM');
}


/** Which tabs have had their text columns formatted in THIS execution. */
var FORMATTED_ = {};

function tab_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Stato goes leftmost: it is the tab that answers "is this working", so it should be the one
    // already open when the Sheet is opened.
    if (name === 'Stato') { ss.setActiveSheet(sh); ss.moveActiveSheet(1); }
  }
  // Applied once per EXECUTION and not once per call: `tab_` is reached by every single log line
  // through `appendRows_`, and re-formatting a whole column on each of them pays a full-column write
  // for nothing. Once per run is all the self-repair needs - a Sheet built before TEXT_COLUMNS existed
  // still fixes itself the first time anything runs.
  if (!FORMATTED_[name]) {
    FORMATTED_[name] = true;
    (TEXT_COLUMNS[name] || []).forEach(function (c) {
      sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
    });
    // THE HEADER IS REPAIRED, not written once. A tab created before a column existed keeps the old
    // header for ever while the rows below it carry the new width, so the name over a column stops
    // describing it: measured 21/09/2026 on the live Sheet, where `after_official` had pushed
    // `updated_utc` one place along and the column labelled `updated_utc` was showing a count of 9.
    // The code was already immune - every reader goes through `TABS[...].indexOf(name)` - and the
    // person reading the Sheet was not.
    var want = TABS[name];
    var head = sh.getRange(1, 1, 1, want.length).getValues()[0];
    var same = head.length === want.length;
    for (var h = 0; same && h < want.length; h += 1) if (String(head[h]) !== want[h]) same = false;
    if (!same) sh.getRange(1, 1, 1, want.length).setValues([want]).setFontWeight('bold');
  }
  return sh;
}

function appendRows_(name, rows) {
  if (!rows.length) return;
  var sh = tab_(name);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/** Report and Attendibilita are DERIVED: they are rewritten whole, because a stale half is worse
 *  than an empty one. Probabili and Veri are never rewritten. */
function write_(name, rows) {
  var sh = tab_(name);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function log_(step, subject, detail) {
  appendRows_('Log', [[iso_(new Date()), step, subject, detail]]);
  Logger.log('%s | %s | %s', step, subject, detail);
}

function folder_() {
  var it = DriveApp.getFoldersByName(FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
}

function dropTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
  });
}

/** The photographs the toolkit has already imported are not needed here for ever. */
function tidy_() {
  var limit = new Date().getTime() - KEEP_DAYS * 24 * 3600 * 1000;
  var it = folder_().getFiles();
  var n = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (f.getDateCreated().getTime() < limit) { f.setTrashed(true); n += 1; }
  }
  if (n) log_('tidy', 'drive', n + ' old photographs to the bin');
}
