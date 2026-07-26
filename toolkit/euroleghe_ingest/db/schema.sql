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
    price      REAL,
    PRIMARY KEY (fc_id, season)
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
    yellows     INTEGER,
    reds        INTEGER,
    mv_synth    REAL,                        -- calibrated synthetic base voto, never the euro target
    PRIMARY KEY (fc_id, season, source, match_id)
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

CREATE TABLE IF NOT EXISTS club_elo (
    fc_club_id INTEGER NOT NULL REFERENCES clubs(fc_club_id),
    date       TEXT NOT NULL,                   -- ISO date (e.g. auction date)
    elo        REAL NOT NULL,
    PRIMARY KEY (fc_club_id, date)
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
    PRIMARY KEY (fc_id, date)
);

CREATE TABLE IF NOT EXISTS injuries (
    fc_id      INTEGER NOT NULL REFERENCES players(fc_id),
    start_date TEXT NOT NULL,
    end_date   TEXT,
    kind       TEXT,                            -- muscular | traumatic | ...
    days_out   INTEGER,
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

CREATE TABLE IF NOT EXISTS arrivals (
    fc_id           INTEGER NOT NULL REFERENCES players(fc_id),
    season          TEXT NOT NULL,
    type            TEXT,                        -- intra_league | cross_league | promoted | ...
    tier            TEXT,                        -- T1 | T2 | T3
    origin_club     TEXT,
    origin_league   TEXT,
    foreign_fm_equiv REAL,                       -- foreign FM-equivalent (tier T1)
    PRIMARY KEY (fc_id, season)
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
    probability REAL,
    source     TEXT,
    PRIMARY KEY (fc_id, valid_from)
);

CREATE TABLE IF NOT EXISTS availability (
    fc_id      INTEGER NOT NULL REFERENCES players(fc_id),
    valid_from TEXT NOT NULL,
    status     TEXT,                             -- available | injured | suspended | doubt
    source     TEXT,
    PRIMARY KEY (fc_id, valid_from)
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
