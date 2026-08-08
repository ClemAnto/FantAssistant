-- Main schema for euroleghe.db (spec v9).
-- fc_id = players' primary key; the other sites live in the xref tables.
-- Volatile states (penalty takers, starters, injuries) = DATED tables with valid_from, never static flags.
-- The DB is always rebuildable from scratch from the raw files in data/raw (idempotent rebuild).

PRAGMA foreign_keys = ON;

-- ---------- Registries ----------
CREATE TABLE IF NOT EXISTS players (
    fc_id          INTEGER PRIMARY KEY,       -- fantacalcio.it id
    canonical_name TEXT NOT NULL,
    birth_year     INTEGER,
    nationality    TEXT
);

CREATE TABLE IF NOT EXISTS clubs (
    fc_club_id     INTEGER PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    league         TEXT                        -- serie_a | premier_league | la_liga | bundesliga | ligue_1
);

-- Cross-reference to the other sources' ids (never overwrite the source ids).
-- For players outside the roster list: a provisional prov_* id mapped to fc_id.
CREATE TABLE IF NOT EXISTS player_xref (
    fc_id      INTEGER NOT NULL REFERENCES players(fc_id),
    source     TEXT NOT NULL,                  -- fbref | sofascore | transfermarkt | wikidata
    source_id  TEXT NOT NULL,
    valid_from TEXT,                            -- ISO date
    valid_to   TEXT,
    -- WHICH MODULE established the mapping, and therefore who may retract it. Three of them write
    -- here with different evidence: `positions` matches names against a season's roster pools,
    -- `recent_form` pays for a direct provider SEARCH (name + birth year + club - the expensive and
    -- fragile half of that module), `injuries` reads the Transfermarkt squad pages. `positions` also
    -- DELETES - over the whole cache "nobody claimed this id" is a verdict on a stale mapping - and
    -- with no author on the row that verdict was being passed on evidence it had never seen: measured
    -- 08/08/2026, an authoritative re-ingest dropped 20 identities, 19 of them men quoted in the
    -- 2026-27 listone (Evanilson, Senesi, Tzolis...) whose ids another module had resolved over the
    -- network, because they play in a league-season no listone of ours quoted. Same rule as
    -- `club_levels_xref.resolved_by`: a judgement that cannot be audited is one nobody can correct.
    -- Rows written before this column are 'unknown' - «vuoto = ignoto» - and no module retracts those.
    resolved_by TEXT,
    PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS club_xref (
    fc_club_id INTEGER NOT NULL REFERENCES clubs(fc_club_id),
    source     TEXT NOT NULL,                  -- clubelo | fbref | transfermarkt | sofascore
    source_id  TEXT NOT NULL,
    valid_from TEXT,
    valid_to   TEXT,
    PRIMARY KEY (source, source_id)
);

-- ---------- Season data (normalized from raw) ----------
CREATE TABLE IF NOT EXISTS rosters (
    fc_id      INTEGER NOT NULL REFERENCES players(fc_id),
    season     TEXT NOT NULL,                  -- e.g. 2025-26
    fc_club_id INTEGER REFERENCES clubs(fc_club_id),
    roles      TEXT,                            -- Mantra roles, e.g. "dc;b"
    role_classic TEXT,                          -- P | D | C | A
    league     TEXT,                            -- per-player league from the listone (present even when club is unknown)
    -- TWO prices, and the difference between them matters. `price` is the listone's Qt.A (current
    -- quotation): it is revised all season long, so for a past season it already knows how the
    -- player did and is NOT usable as a predictor. `price_initial` is Qt.I, the quotation set before
    -- the auction: that one is the market's EXPECTATION and the only price a backtest may read.
    price          REAL,                        -- Qt.A, current quotation (hindsight for past seasons)
    price_initial  REAL,                        -- Qt.I, pre-auction quotation (auction-safe)
    -- FVM = "fantavalore di mercato", the listone's market-value index (Classic and Mantra). Served in
    -- the file's CURRENT state, so for a finished season it is the END-OF-SEASON value: a scoring
    -- column, like Qt.A, never a model input. Kept because it is the market's own answer to the
    -- question the engine answers with the predicted VALUE, and the two belong side by side.
    fvm            REAL,
    fvm_mantra     REAL,
    -- The same two quotations in the MANTRA currency (Qt.A M / Qt.I M). Mantra is played on both
    -- platforms - the Serie A listone carries RM, Qt.A M, Qt.I M and FVM M like the EuroLeghe one - and
    -- an auction is bought in the currency of its own game. `price_mantra` is hindsight for a past
    -- season, `price_initial_mantra` is pre-auction and would be the honest input for a Mantra
    -- market-expectation rule; today both are reporting columns and no rule reads them.
    -- ⚠️ THESE SIX COLUMNS ARE THE LAST LISTONE READ AND DO NOT KNOW WHICH ONE. A quotation is a fact
    -- about a PLATFORM (see `listone_quotes` below) and this PK cannot hold two, so for a player quoted
    -- in both listoni the last download wins. Kept because a roster row without a price is useless to
    -- read at a glance, and because the whole codebase joins this table - but anything that DECIDES
    -- something per platform must read `listone_quotes`, never these.
    price_mantra         REAL,
    price_initial_mantra REAL,
    PRIMARY KEY (fc_id, season)
);

-- THE QUOTATION, PER PLATFORM - because that is what it is, and `rosters` above cannot say it.
-- Measured 07/08/2026: the two listoni disagree on 202 Qt.I and 226 FVM for the ~249 Italians quoted in
-- both (Svilar Qt.I 18 / FVM 65 on the Serie A listone against 15 / 56 on the EuroLeghe one), so with one
-- pair of columns per player-season the LAST download decided what both sheets showed - including the ask
-- price you bid against at the table. It also made every percentile a mixed-currency ranking: a Serie A
-- forward was ranked against a pool whose foreign quotations reach 49 where the Italian ones stop at 28,
-- and the two distributions are not proportional (defenders are the other way round, 28 against 20).
-- Same shape and same cure as `match_ratings` and `season_stats`: `platform` in the key.
-- Backfillable, unlike the three snapshot facts: the cache holds one listone file per platform and season
-- (`listone_{platform}_{season}.xlsx`), so `ratings.reingest_quotes_from_cache` fills the whole history
-- offline - the raw file is the source of truth, exactly as `rebuild` assumes.
CREATE TABLE IF NOT EXISTS listone_quotes (
    fc_id      INTEGER NOT NULL REFERENCES players(fc_id),
    season     TEXT NOT NULL,
    platform   TEXT NOT NULL,                   -- euro | default: WHICH listone said this
    price          REAL,                        -- Qt.A, current quotation (hindsight for past seasons)
    price_initial  REAL,                        -- Qt.I, pre-auction quotation (the only auction-safe one)
    fvm            REAL,
    fvm_mantra     REAL,
    price_mantra         REAL,
    price_initial_mantra REAL,
    PRIMARY KEY (fc_id, season, platform)
);

-- Season aggregates PER PLATFORM: 'euro' = the EuroLeghe calendar (fantamedia/target, from the
-- listone); 'default' = the full real-league season (classic Serie A here) -> the propensity/ability
-- view, so a player's goals/assists count even when they fall outside the EuroLeghe calendar.
CREATE TABLE IF NOT EXISTS season_stats (
    fc_id   INTEGER NOT NULL REFERENCES players(fc_id),
    season  TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'euro',      -- euro (fantamedia) | default (full-season propensity)
    pv      INTEGER,                            -- appearances with a vote
    mv      REAL,                               -- average vote
    fm      REAL,                               -- fantamedia
    goals   INTEGER,
    assists INTEGER,
    yellows INTEGER,
    reds    INTEGER,
    own_goals INTEGER,
    pen_scored INTEGER,
    pen_missed INTEGER,
    goals_conceded INTEGER,                     -- goalkeepers
    pen_saved INTEGER,                          -- goalkeepers
    PRIMARY KEY (fc_id, season, platform)
);

-- Canonical per-matchday ratings (comparable across seasons). Base rating (mv) + the classic
-- bonus components; fantavoto is computed from these via scoring_config (stored with the default
-- fantacalcio.it scoring for display). Season-specific extras live in match_rating_bonuses (raw).
CREATE TABLE IF NOT EXISTS match_ratings (
    fc_id     INTEGER NOT NULL REFERENCES players(fc_id),
    season    TEXT NOT NULL,
    matchday  INTEGER NOT NULL,
    role      TEXT,                              -- matchday role: P|D|C|A, or ALL for coaches (kept for info)
    team      TEXT,                              -- club name from the ratings Excel (used to backfill missing clubs)
    platform TEXT NOT NULL DEFAULT 'euro',  -- euro | default: DIFFERENT calendars, so part of the key
    mv        REAL,                              -- base rating (voto), NULL if no vote
    goals     INTEGER,
    assists   INTEGER,                           -- canonical: sum of all assist subtypes
    assists_set_piece INTEGER,                   -- set-piece assists when the season splits them
    own_goals INTEGER,
    pen_scored INTEGER,
    pen_missed INTEGER,
    pen_saved INTEGER,
    goals_conceded INTEGER,                      -- goalkeepers
    yellows   INTEGER,
    reds      INTEGER,
    player_of_the_match INTEGER,                 -- optional, only seasons that award it
    started   INTEGER,                           -- 0/1 (not in the Excel yet)
    minutes   INTEGER,                           -- (not in the Excel yet)
    fantavoto REAL,                              -- fantasy rating (mv + bonus/malus), default scoring
    status    TEXT,                              -- played | sub | no_vote | bench | injured | suspended | not_in_squad
    PRIMARY KEY (fc_id, season, matchday, platform)
);

-- Lossless raw bonus layer (aggregation option A): every bonus column of the source Excel as-is,
-- one row per (player, matchday, bonus_key). Future season-specific bonuses (assist soft/medium,
-- player-of-the-match, ...) are captured here without any schema migration.
CREATE TABLE IF NOT EXISTS match_rating_bonuses (
    fc_id     INTEGER NOT NULL REFERENCES players(fc_id),
    season    TEXT NOT NULL,
    matchday  INTEGER NOT NULL,
    platform TEXT NOT NULL DEFAULT 'euro',
    bonus_key TEXT NOT NULL,                     -- raw source column name (e.g. Gf, Ass, Rp, ...)
    value     REAL,
    PRIMARY KEY (fc_id, season, matchday, platform, bonus_key)
);

-- ---------- External sources (full-season propensity, spec v9) ----------
-- Season aggregates from the external providers. The euro calendar only SAMPLES a player's real
-- season, so propensity (goals/assists/xG per 90) is computed here, over the full real season.
-- Source-tagged on purpose: this layer must never contaminate the 'euro' target in season_stats.
CREATE TABLE IF NOT EXISTS external_stats (
    fc_id       INTEGER NOT NULL REFERENCES players(fc_id),
    season      TEXT NOT NULL,
    source      TEXT NOT NULL,               -- sofascore | fbref
    competition TEXT NOT NULL DEFAULT '',    -- league key (serie_a, ...); '' = all competitions
    matches     INTEGER,
    starts      INTEGER,
    minutes     INTEGER,
    goals       INTEGER,
    assists     INTEGER,
    pen_scored  INTEGER,
    pen_taken   INTEGER,
    xg          REAL,
    xa          REAL,
    rating      REAL,                        -- provider's average rating (SofaScore scale)
    yellows     INTEGER,
    reds        INTEGER,
    -- The KEEPER's half of the fantavoto. Measured on 16,017 of our own keeper rows, the identity is
    -- exact: fantavoto = mv - goals_conceded + 3*pen_saved - cards, and there is NO clean-sheet bonus.
    -- So goals conceded is the ONE number an FM-equivalent for a keeper needs (gate §7-decies). Both
    -- fields have been requested from the provider since the first run and were dropped at parse time.
    -- Note: goals_conceded is filled for outfielders too (goals the team conceded while he was on the
    -- pitch); it is only the keeper's fantavoto that reads it.
    goals_conceded INTEGER,
    saves       INTEGER,
    -- WHICH CLUB he played them for, by the PROVIDER'S OWN ID and never by its name. The rule this
    -- project keeps - «an entity joins through its canonical key, never through the string a source
    -- uses to name it» - had no way of being obeyed here: nothing in the per-season or per-match layer
    -- carried a club identifier, so a level computed per club had to match spellings, and that is
    -- exactly how three PSG seasons came out priced at Paris FC. The payload has always shipped
    -- `team.id`; it is stored now. One caveat that comes with the grain rather than with the column:
    -- the PK holds ONE row per (player, season, competition), so a man who moved in January is
    -- attributed to whichever club the aggregate names - the per-match layer keeps the split, and only
    -- as a string.
    club_id     TEXT,
    PRIMARY KEY (fc_id, season, source, competition)
);

-- Per-match layer from the external providers: the granularity the CALIBRATED synthetic base voto
-- needs (fitted on the matches where we also know the real Mv) and where the real matchday comes
-- from for the 4 foreign leagues. source='synthetic' rows carry the fitted mv_synth only.
CREATE TABLE IF NOT EXISTS external_match_stats (
    fc_id       INTEGER NOT NULL REFERENCES players(fc_id),
    season      TEXT NOT NULL,
    source      TEXT NOT NULL,               -- sofascore | fbref | synthetic
    match_id    TEXT NOT NULL,               -- provider event id
    competition TEXT,                        -- league key
    real_md     INTEGER,                     -- real league matchday (round)
    match_date  TEXT,                        -- ISO date
    club        TEXT,
    opponent    TEXT,
    home        INTEGER,                     -- 0/1
    position    TEXT,                        -- provider position code (G|D|M|F)
    started     INTEGER,                     -- 0/1
    minutes     INTEGER,
    rating      REAL,                        -- provider rating (SofaScore scale)
    goals       INTEGER,
    assists     INTEGER,
    xg          REAL,
    xa          REAL,
    shots       INTEGER,                     -- totalShots: the "reference striker" usage signal
    shots_on_target INTEGER,                 -- onTargetScoringAttempt
    big_chances_created INTEGER,
    big_chances_missed  INTEGER,
    key_passes  INTEGER,
    touches     INTEGER,
    yellows     INTEGER,
    reds        INTEGER,
    mv_synth    REAL,                        -- calibrated synthetic base voto, never the euro target
    PRIMARY KEY (fc_id, season, source, match_id)
);

-- Club-level lineup counts from the SAME cached rounds, over ALL entries - resolved or not. A
-- per-player row needs an identity, but counting how many forwards a club FIELDS does not, and
-- the identity funnel would bias exactly the clubs whose fringe players are not quoted (Serie A
-- 24/25: half the XIs have 1-3 unresolved starters, Juventus had 0 fully-resolved elevens).
CREATE TABLE IF NOT EXISTS club_match_lineups (
    season      TEXT NOT NULL,
    source      TEXT NOT NULL,               -- sofascore
    match_id    TEXT NOT NULL,               -- provider event id
    club        TEXT NOT NULL,               -- provider spelling ("AC Milan"), NOT canonical
    competition TEXT,                        -- league key
    real_md     INTEGER,
    match_date  TEXT,
    starters    INTEGER,                     -- lineup entries with substitute = false (11 pre-match)
    goalkeepers INTEGER,                     -- of the starters, by provider position G/D/M/F
    defenders   INTEGER,
    midfielders INTEGER,
    forwards    INTEGER,
    PRIMARY KEY (season, source, match_id, club)
);

-- euro <-> real matchday alignment, PER LEAGUE: one euro round bundles a DIFFERENT real round in
-- each of the 5 leagues, and skips some real rounds entirely. Lets the views tell the real
-- euro-calendar matchdays from the synthetically filled ones.
CREATE TABLE IF NOT EXISTS matchday_map (
    season   TEXT NOT NULL,
    euro_md  INTEGER NOT NULL,
    league   TEXT NOT NULL,
    real_md  INTEGER NOT NULL,
    source   TEXT,                           -- derived (from our ratings) | sofascore | manual
    confidence REAL,                         -- share of rating rows that agreed on this alignment
    PRIMARY KEY (season, euro_md, league)
);

CREATE TABLE IF NOT EXISTS positions (
    fc_id     INTEGER NOT NULL REFERENCES players(fc_id),
    season    TEXT NOT NULL,
    source    TEXT,                             -- sofascore
    avg_x     REAL,
    avg_y     REAL,
    derived_role TEXT,                          -- real role from the heatmap
    n_matches INTEGER,
    is_friendly INTEGER,                        -- friendlies -> factor 21
    PRIMARY KEY (fc_id, season, source)
);

-- The player's REAL position in the provider's own vocabulary: GK | DL DC DR | DM | ML MC MR | AM |
-- LW RW | ST - twelve codes, one to three per player, saying roughly WHERE ON THE PITCH he belongs.
-- It is not a fantacalcio role and not a valuation: the listone's P/D/C/A says what you buy him as,
-- and `positions.derived_role` says which of four lines he was used in. Neither can tell a left back
-- from a centre back, which is the question this answers.
--
-- DATED, and it has to be. The provider serves only "now": `?seasonId=` is accepted (HTTP 200) and
-- IGNORED - the same player returns today's codes for a season three years old. So this is a third
-- snapshot that can never be backfilled, alongside `probable_starter` and `flags.contract_until`, and
-- every day the observation does not happen is a day that will not exist later.
CREATE TABLE IF NOT EXISTS player_roles (
    fc_id      INTEGER NOT NULL REFERENCES players(fc_id),
    valid_from TEXT NOT NULL,                   -- the date the roles were observed
    source     TEXT NOT NULL,                   -- sofascore
    roles      TEXT,                            -- the provider's own order, e.g. "DL;ML"
    primary_role TEXT,                          -- the first of them
    line       TEXT,                            -- the provider's broad slot: G | D | M | F
    foot       TEXT,                             -- Left | Right | Both: which flank a wide role really is
    height     INTEGER,                         -- cm, from the same payload as the roles
    weight     INTEGER,                         -- kg, same. DESCRIPTIVE: the physical profile of a
                                                -- centre-forward is visible to the operator and is NOT a
                                                -- selection criterion - measured, the more used of a
                                                -- club's two strikers is the taller one 44 times out of
                                                -- 92 (48%), i.e. nothing (gate §5-terdecies)
    PRIMARY KEY (fc_id, valid_from, source)
);

-- WHICH ClubElo row belongs to which PROVIDER TEAM, resolved once at ingest and stored so that no
-- read path ever compares a club name. Deliberately NOT `club_xref`: that table's key is one of OUR
-- clubs (`fc_club_id NOT NULL`), and most of the clubs a career runs through have never been in a
-- listone - Benfica, Ajax, Porto. Forcing them in there would mean minting 250 rows into `clubs` and
-- paying the twin-club risk again; this maps the provider's id to ClubElo's row and leaves `clubs`
-- alone, with `fc_club_id` filled only where one exists.
-- `resolved_by` says HOW the pairing was made (alias table, exact tokens, abbreviation), because a
-- name comparison is a judgement and a judgement that cannot be audited is one nobody can correct.
CREATE TABLE IF NOT EXISTS club_levels_xref (
    provider_club_id TEXT PRIMARY KEY,          -- Sofascore's team id, from external_stats.club_id
    elo_name    TEXT NOT NULL,                  -- the ClubElo spelling this club is priced under
    provider_name TEXT,                         -- what the provider called it, for the audit
    fc_club_id  INTEGER,                        -- our own id where the club is in a listone; NULL else
    resolved_by TEXT
);

CREATE TABLE IF NOT EXISTS club_elo (
    fc_club_id INTEGER NOT NULL REFERENCES clubs(fc_club_id),
    date       TEXT NOT NULL,                   -- ISO date (e.g. auction date)
    elo        REAL NOT NULL,
    PRIMARY KEY (fc_club_id, date)
);

-- EVERY club ClubElo publishes, per year, keyed CANONICALLY - not just the ~97 that a listone carries.
-- `club_elo` above is our own clubs at a DATE (the auction day) and cannot hold anybody else: its key is
-- `fc_club_id`, which only exists for a club that has been in a listone. That is a table about OUR
-- perimeter, and a level is not: Red Bull Salzburg is a real club with a real strength, and a man whose
-- measured football was played there read as «no level at all» (08/08/2026, the operator: «ogni calciatore
-- DEVE avere il suo club_elo corretto, il Salisburgo ha sfornato numerosi campioni»). ~630 clubs a year
-- against 97, from the same cached snapshots `club_elo` is built from - no acquisition, only a table that
-- does not throw them away.
-- The key is `matching.club_identity` of a spelling, and BOTH sides are indexed: ClubElo's own name and
-- every spelling of ours that resolves to it, so a read never compares a name (`elo_name` says whose level
-- the row is, so a row can be audited). Per YEAR because that is the granularity the snapshots are cached
-- at, and because the level of a club is a season-long fact.
CREATE TABLE IF NOT EXISTS club_levels (
    club_key   TEXT NOT NULL,                   -- club_identity() of a spelling, ours or ClubElo's
    year       TEXT NOT NULL,                   -- YYYY of the snapshot
    elo        REAL NOT NULL,
    elo_name   TEXT NOT NULL,                   -- the ClubElo club this level belongs to
    fc_club_id INTEGER,                         -- ours where the key is one of our clubs, NULL otherwise
    country    TEXT,                            -- ClubElo's own three-letter code (ITA, AUT, ...)
    PRIMARY KEY (club_key, year)
);

-- ---------- Market / career history ----------
CREATE TABLE IF NOT EXISTS transfers_history (
    fc_id       INTEGER NOT NULL REFERENCES players(fc_id),
    date        TEXT NOT NULL,
    from_club   TEXT,
    to_club     TEXT,
    from_league TEXT,
    to_league   TEXT,
    fee         REAL,
    -- WHEN WE FIRST SAW THE ROW (the cache file's own download day). Transfermarkt dates every summer
    -- operation YYYY-07-01 (contract-start semantics), so `date` cannot tell a late-July deal from an
    -- early one. This is the OBSERVATION date instead, kept at its MINIMUM across re-parses so a
    -- re-download never rejuvenates a row. On a fresh clone it is the bootstrap day for the whole
    -- history - honest («the first time WE saw it») and only informative from then on, like the other
    -- snapshot facts.
    first_seen  TEXT,
    -- THE COUNTERPART IS PART OF THE KEY, not decoration. Transfermarkt dates every summer move
    -- YYYY-07-01 and a club's page can legitimately carry the SAME player twice on that date - the loan
    -- return (OUT to the owner) and the permanent signing (IN from the owner). Keyed on (fc_id, date)
    -- the two collapsed and whichever was parsed last won, which made Hojlund read as leaving Napoli for
    -- Manchester United in the very summer Napoli bought him. Same shape as the `match_ratings` note: a
    -- key that cannot represent two real events silently drops one.
    PRIMARY KEY (fc_id, date, from_club, to_club)
);

-- The player's MARKET VALUE, by season, from the source's own squad page of that season.
-- A SEASON fact and not a snapshot of today: the squad page of a past season carries that season's
-- value (verified on eleven seasons of one club - the same player reads 225 / 175 / 150 / 100 / 200
-- mila across them), which is what lets a window read the INPUT season's value to predict the target
-- one. Reading the target season's value would be reading the outcome.
-- It exists because the fee could not answer the question: `transfers_history.fee` is NULL for a free
-- transfer, so the investment hypothesis was tested with a proxy that said "no investment" about
-- Modric and De Bruyne, the two names it came from (gate 7-quater).
-- The FANTAVALORE DI MERCATO as the DATED SERIES it actually is. The operator's own description: «varia
-- ogni settimana o quando ci sono eventi particolari - infortuni, trasferimenti», which makes it a volatile
-- state, and this project's rule for those is a dated time series and never a static field
-- (`penalty_rank`, `probable_starter`, injuries). It was being kept in `rosters.fvm`, one value per season,
-- OVERWRITTEN at every listone download - so every reading of "where the player is now" was thrown away and
-- replaced by the next one.
-- Not backfillable, exactly like the three snapshot facts: the endpoint serves one archived value per past
-- season (verified: it moves season to season, Acerbi 17 -> 50 -> 10), so the WEEKLY history before today
-- does not exist anywhere we can reach. It accumulates from now on, and `observed_on` is the whole point.
-- ⚠️ It is a JUDGEMENT, finer and fresher than the quotation but still somebody's opinion, so it is read
-- only where nothing measured exists - and NEVER for the target season, which would be reading the outcome.
-- PER PLATFORM too, for the reason `listone_quotes` states: the two listoni give a player two different
-- fantavalori, so a series keyed only on the day mixed them - and which one a day held depended on the
-- order of that day's downloads. Rows written before 07/08/2026 carry platform 'unknown', which is what
-- they are: attributing them now would be inventing provenance.
CREATE TABLE IF NOT EXISTS fvm_history (
    fc_id       INTEGER NOT NULL REFERENCES players(fc_id),
    season      TEXT NOT NULL,
    observed_on TEXT NOT NULL,
    platform    TEXT NOT NULL DEFAULT 'unknown',
    fvm         REAL,
    fvm_mantra  REAL,
    PRIMARY KEY (fc_id, season, observed_on, platform)
);

CREATE TABLE IF NOT EXISTS market_values (
    fc_id   INTEGER NOT NULL REFERENCES players(fc_id),
    season  TEXT NOT NULL,
    source  TEXT NOT NULL,
    value   REAL,
    PRIMARY KEY (fc_id, season, source)
);

CREATE TABLE IF NOT EXISTS injuries (
    fc_id      INTEGER NOT NULL REFERENCES players(fc_id),
    start_date TEXT NOT NULL,
    end_date   TEXT,                            -- NULL = still out at the snapshot date
    kind       TEXT,                            -- muscular | knee | ankle | illness | ...
    days_out   INTEGER,
    -- matches_missed is the ONE the presences module can use directly: days out translate into
    -- missed matches only through the calendar, and the source already did that translation.
    matches_missed INTEGER,
    detail     TEXT,                            -- the source's own label, kept verbatim
    source     TEXT,
    PRIMARY KEY (fc_id, start_date)
);

CREATE TABLE IF NOT EXISTS coaches (
    fc_club_id INTEGER NOT NULL REFERENCES clubs(fc_club_id),
    coach_name TEXT NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to   TEXT,
    PRIMARY KEY (fc_club_id, valid_from)
);

CREATE TABLE IF NOT EXISTS tournaments_squads (
    fc_id       INTEGER NOT NULL REFERENCES players(fc_id),
    tournament  TEXT NOT NULL,                  -- e.g. africa_cup_2025
    start_date  TEXT,
    end_date    TEXT,
    PRIMARY KEY (fc_id, tournament)
);

-- The arrival EVENT is platform-independent (a roster diff: one club per player-season), but its TIER is
-- not: it is a percentile inside a listone, and the two listoni are two currencies (see `listone_quotes`).
-- Hence `platform` in the key - one row per platform, identical except where the quotation decides. 84
-- players of 1175 cross a T1/T2/T3 band depending on which listone was read last, and 10 of the 330
-- arrivals of 2026-27 are routed by that number.
CREATE TABLE IF NOT EXISTS arrivals (
    fc_id           INTEGER NOT NULL REFERENCES players(fc_id),
    season          TEXT NOT NULL,
    platform        TEXT NOT NULL DEFAULT 'default',
    type            TEXT,                        -- intra_league | cross_league | promoted | ...
    tier            TEXT,                        -- T1 | T2 | T3, inside THIS platform's listone
    origin_club     TEXT,
    origin_league   TEXT,
    foreign_fm_equiv REAL,                       -- foreign FM-equivalent (tier T1)
    PRIMARY KEY (fc_id, season, platform)
);

-- ---------- Volatile states (TIME SERIES, spec v8) ----------
CREATE TABLE IF NOT EXISTS penalty_hierarchy (
    fc_club_id    INTEGER NOT NULL REFERENCES clubs(fc_club_id),
    valid_from    TEXT NOT NULL,
    fc_id         INTEGER NOT NULL REFERENCES players(fc_id),
    rank          INTEGER NOT NULL,             -- 1 = designated penalty taker
    confidence    REAL,                          -- weights the bonus, never binary
    source        TEXT,                          -- revealed | fc_site | friendly | manual
    trigger_event TEXT,                          -- pen_missed | injury | transfer | benched
    PRIMARY KEY (fc_club_id, valid_from, fc_id)
);

CREATE TABLE IF NOT EXISTS probable_starter (
    fc_id      INTEGER NOT NULL REFERENCES players(fc_id),
    valid_from TEXT NOT NULL,
    probability REAL,                            -- NULL for bench/reserve rows (no % on the page)
    source     TEXT,
    team       TEXT,                             -- as printed on the probabili page
    formation  TEXT,                             -- declared module, e.g. 3-5-2 (2 strikers) vs 4-3-3
    starter    INTEGER,                          -- 0/1: listed in the starting XI block
    role       TEXT,                             -- the page's role letter for the slot
    status     TEXT,                             -- e.g. injured/doubtful marker on the card
    -- WHICH SEASON THE PAGE WAS TALKING ABOUT, from the season segment of every player href. A reading is
    -- dated by the day it was TAKEN, and in August that day says nothing about the season it describes:
    -- measured 07/08/2026, the probabili page served the last 2025-26 round until 04/08 (810 hrefs, all
    -- `2025-26`, probabilities 1.0 - confirmed line-ups of a match already played) and the 2026-27 page is
    -- still empty. Without this column those rows were the freshest "starting probability" a 2026-27 sheet
    -- could find: 428 of 648 Serie A rows and 415 duels built on last season's elevens.
    season     TEXT,
    PRIMARY KEY (fc_id, valid_from)
);

-- Who is REALLY in a club's squad on a given date, independent of the listone.
-- Why it exists: an auction is prepared before the listone comes out, and the listone is the only
-- thing `rosters` knows. This is the real squad instead - from the current Transfermarkt squad pages,
-- from the probabili (which carry an exact fc_id in each href) and from who actually appeared in the
-- club's recent matches. Dated, like every volatile state: a squad is a fact about a DAY.
CREATE TABLE IF NOT EXISTS squad_snapshot (
    fc_id      INTEGER NOT NULL REFERENCES players(fc_id),
    valid_from TEXT NOT NULL,                    -- the date the squad was observed
    club       TEXT,                             -- canonical club name
    source     TEXT NOT NULL,                    -- transfermarkt | fc_site | appearances
    role_hint  TEXT,                             -- Classic role where the source states one
    PRIMARY KEY (fc_id, valid_from, source)
);

CREATE TABLE IF NOT EXISTS availability (
    fc_id      INTEGER NOT NULL REFERENCES players(fc_id),
    valid_from TEXT NOT NULL,
    status     TEXT,                             -- available | injured | suspended | doubt
    source     TEXT,
    PRIMARY KEY (fc_id, valid_from)
);

-- The PRESS'S typical formations: the boards' EXTERNAL JUDGE (todolist-formazioni-tipo-v1.md item 0).
-- A per-DAY fact like `probable_starter`: the press republishes its typical XIs all summer and a reading
-- not taken is gone, so the table can never be backfilled - which is why every import is also archived
-- under data/raw/press/ and replayed by `rebuild` (the DB stays rebuildable from raw).
-- A JUDGE, never an input: nothing the engine or the panel computes may read this table - reading it
-- inside the claim would make circular exactly the comparison it exists for. Its one reader is the
-- `press` module's own comparison report.
-- `club` and the XI names are stored as the source spelled them and resolved at READ time
-- (`matching.club_identity`, surname tokens), like every other source string in this schema.
CREATE TABLE IF NOT EXISTS press_formations (
    club        TEXT NOT NULL,               -- as the source spelled it
    season      TEXT NOT NULL,               -- the season the XI predicts, e.g. 2026-27
    observed_on TEXT NOT NULL,               -- the day the reading was taken (ISO date)
    source      TEXT NOT NULL,               -- outlet or synthesis name, e.g. 'press'
    coach       TEXT,                        -- the coach the source names
    module      TEXT,                        -- the module the source expects, e.g. 4-3-3
    module_alternatives TEXT,                -- JSON list; a free-text qualifier may follow the module
    xi          TEXT,                        -- JSON {line: [names]}, the source's own lines/spellings
    duels       TEXT,                        -- JSON list: the source's own ballottaggi, verbatim
    notes       TEXT,
    confidence  TEXT,                        -- the source's own confidence, verbatim
    PRIMARY KEY (club, season, observed_on, source)
);

-- ---------- Derived flags and manual overrides ----------
CREATE TABLE IF NOT EXISTS flags (
    fc_id  INTEGER NOT NULL REFERENCES players(fc_id),
    season TEXT NOT NULL,
    flag   TEXT NOT NULL,                        -- exit_risk | off_role_usage | new_coach | ...
    value  TEXT,
    source TEXT,
    PRIMARY KEY (fc_id, season, flag)
);

-- Optional highest-precedence overrides. The system works even with this table empty.
CREATE TABLE IF NOT EXISTS manual_overrides (
    entity     TEXT NOT NULL,                    -- target table/field
    fc_id      INTEGER,
    season     TEXT,
    field      TEXT NOT NULL,
    value      TEXT NOT NULL,
    reason     TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- ---------- Pipeline metadata ----------
CREATE TABLE IF NOT EXISTS ingest_runs (
    module     TEXT NOT NULL,
    started_at TEXT NOT NULL,
    status     TEXT,                             -- ok | error | skipped
    detail     TEXT,
    PRIMARY KEY (module, started_at)
);

-- ---------- Indexes for hot lookups ----------
-- clubs are looked up by name once per player (rosters/listone/elo) -> avoid full scans.
CREATE INDEX IF NOT EXISTS idx_clubs_name ON clubs(canonical_name);
-- match_ratings PK leads with fc_id; the resume/derive/consistency queries filter by season+platform.
CREATE INDEX IF NOT EXISTS idx_match_ratings_season_platform ON match_ratings(season, platform);
-- the external per-match layer is scanned per season+competition (resume, calibration, aggregation).
CREATE INDEX IF NOT EXISTS idx_external_match_season_comp
    ON external_match_stats(season, competition, real_md);
-- player_xref is queried the "wrong way round" too (fc_id -> source id) when resuming a scrape.
CREATE INDEX IF NOT EXISTS idx_player_xref_fc_id ON player_xref(fc_id, source);
