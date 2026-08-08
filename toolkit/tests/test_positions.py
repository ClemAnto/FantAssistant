"""Tests for the SofaScore module: identity injectivity, per-match parsing, offline re-ingest."""

from __future__ import annotations

import json

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import positions


def _provider_row(provider_id, name, team, **stats):
    row = {"player": {"id": provider_id, "name": name}, "team": {"name": team},
           "appearances": 10, "goals": 0, "assists": 0, "minutesPlayed": 900, "rating": 6.8}
    row.update(stats)
    return row


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


def _add_player(conn, fc_id, name, club, league, season="2023-24"):
    conn.execute("INSERT OR IGNORE INTO players(fc_id, canonical_name) VALUES (?, ?)", (fc_id, name))
    club_id = None
    if club:
        row = conn.execute("SELECT fc_club_id FROM clubs WHERE canonical_name = ?", (club,)).fetchone()
        club_id = row[0] if row else conn.execute(
            "SELECT COALESCE(MAX(fc_club_id), 0) + 1 FROM clubs").fetchone()[0]
        if not row:
            conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, ?)",
                         (club_id, club, league))
    conn.execute("INSERT OR REPLACE INTO rosters(fc_id, season, fc_club_id, league, role_classic) "
                 "VALUES (?, ?, ?, ?, 'C')", (fc_id, season, club_id, league))


def test_season_stats_resolution_and_penalty_fields(tmp_path):
    ctx = _ctx(tmp_path)
    _add_player(ctx.conn, 1, "Calhanoglu", "Inter", "serie_a")
    ctx.conn.commit()
    rows = [_provider_row(10, "Hakan Calhanoglu", "Inter", goals=13, penaltyGoals=10,
                          penaltiesTaken=11, expectedGoals=5.5)]
    claims, _report = positions.resolve_season(ctx.conn, "2023-24", {"serie_a": rows})
    positions._store_claims(ctx.conn, "2023-24", claims)
    positions._store_identities(ctx.conn, {"2023-24": claims}, {"2023-24": {"serie_a": rows}})
    stored = ctx.conn.execute(
        "SELECT fc_id, goals, pen_scored, pen_taken, xg, competition FROM external_stats").fetchone()
    assert tuple(stored) == (1, 13, 10, 11, 5.5, "serie_a")
    assert ctx.conn.execute("SELECT source_id FROM player_xref WHERE fc_id = 1").fetchone()[0] == "10"


def test_an_identity_is_not_a_season_fact(tmp_path):
    """The Saka case: resolved in 2024-25, unresolved in 2025-26, and he must KEEP his provider id.

    Written per season, the identity was decided by whichever season happened to be processed last: each
    one dropped the xref rows of the provider ids it was about to re-resolve and then rewrote only its own
    survivors. 91 players on the real cache ended up with their season aggregates in the table and no
    identity at all - and every dated layer (granular roles, heatmap, per-match rows) joins through it, so
    they were invisible to all three at once.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _add_player(conn, 1, "Saka", "Arsenal", "premier_league", season="2024-25")
    conn.commit()
    row = _provider_row(934235, "Bukayo Saka", "Arsenal")
    identified, _r = positions.resolve_season(conn, "2024-25", {"premier_league": [row]})
    assert [claim.provider_id for claim in identified] == ["934235"]
    # the same provider row a season later, when nothing of ours matches it: no claim at all
    unresolved, _r = positions.resolve_season(conn, "2025-26", {"premier_league": [row]})
    assert unresolved == []

    cache = {"2024-25": {"premier_league": [row]}, "2025-26": {"premier_league": [row]}}
    positions._store_identities(conn, {"2024-25": identified, "2025-26": unresolved}, cache)
    assert conn.execute("SELECT fc_id FROM player_xref WHERE source_id = '934235'").fetchone()[0] == 1

    # ...and a run bounded to seasons may not FORGET: over a subset, "unclaimed" is not a verdict,
    # because the season that identifies him was never read
    positions._store_identities(conn, {"2025-26": unresolved}, {"2025-26": cache["2025-26"]},
                               authoritative=False)
    assert conn.execute("SELECT fc_id FROM player_xref WHERE source_id = '934235'").fetchone()[0] == 1
    # over the WHOLE cache it is a verdict, and a stale mapping has to go
    positions._store_identities(conn, {"2025-26": unresolved}, {"2025-26": cache["2025-26"]})
    assert conn.execute("SELECT COUNT(*) FROM player_xref WHERE source_id = '934235'").fetchone()[0] == 0


def test_a_known_identity_rescues_the_season_the_listone_perimeter_hides(tmp_path):
    """The Doekhi case (08/08/2026): bought into the perimeter in 2026-27, so the pools of the season
    he actually PLAYED do not contain him and his input season goes to nobody - 59 men of the 2026-27
    listone with no 2025-26 aggregate at all, their provider id already in `player_xref`."""
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    # quoted in 2023-24 (which is what established his identity) and again in 2026-27, never between
    _add_player(conn, 1, "Doekhi", "Union Berlino", "bundesliga", season="2023-24")
    _add_player(conn, 1, "Doekhi", "Lazio", "serie_a", season="2026-27")
    conn.commit()
    row = _provider_row(830803, "Danilho Doekhi", "1. FC Union Berlin")

    # without the identity, the 2025-26 aggregate is orphaned - the name pools are that season's roster
    orphaned, _r = positions.resolve_season(conn, "2025-26", {"bundesliga": [row]}, known={})
    assert orphaned == []
    # with it, the row lands on him, at the WEAKEST evidence there is
    rescued, _r = positions.resolve_season(conn, "2025-26", {"bundesliga": [row]},
                                           known={"830803": 1})
    assert [(claim.fc_id, claim.pass_name) for claim in rescued] == [(1, "known")]

    # ...and it does NOT re-confirm the identity: a mapping no name pass supports must still be
    # droppable, or a namesake collapse from an old run would live forever
    positions._store_identities(conn, {"2025-26": rescued}, {"2025-26": {"bundesliga": [row]}})
    assert conn.execute("SELECT COUNT(*) FROM player_xref WHERE source_id = '830803'").fetchone()[0] == 0


def test_a_known_claim_whose_identity_died_is_dropped_before_it_is_written(tmp_path):
    """Otherwise two runs over one cache give two different databases: the first writes the season
    fact under an identity it has just deleted, the second (reading the emptied table) does not."""
    ctx = _ctx(tmp_path)
    row = _provider_row(830803, "Danilho Doekhi", "1. FC Union Berlin")
    rescued, _r = positions.resolve_season(ctx.conn, "2025-26", {"bundesliga": [row]},
                                           known={"830803": 1})
    kept, dropped = positions.drop_orphan_known_claims({"2025-26": rescued}, surviving={})
    assert (kept["2025-26"], dropped) == ([], 1)
    # an identity the run DID re-establish keeps its claims
    kept, dropped = positions.drop_orphan_known_claims({"2025-26": rescued},
                                                       surviving={"830803": 1})
    assert (len(kept["2025-26"]), dropped) == (1, 0)


def test_an_authoritative_run_retracts_only_the_identities_it_owns(tmp_path):
    """`recent_form` pays provider searches for men no listone of ours ever quoted, so no name pool
    here can re-establish them - and the delete was dropping exactly those (20 on the real cache, 19
    quoted in 2026-27). `resolved_by` says who owns a row; 'unknown' predates the column."""
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(1, "Evanilson"), (2, "Stale"), (3, "Legacy")])
    conn.executemany("INSERT INTO player_xref(fc_id, source, source_id, resolved_by) "
                     "VALUES (?, 'sofascore', ?, ?)",
                     [(1, "998490", "recent_form"), (2, "111", "positions"), (3, "222", "unknown")])
    conn.commit()
    cache = {"2025-26": {"premier_league": [_provider_row(998490, "Evanilson", "Bournemouth"),
                                            _provider_row(111, "Stale", "Nowhere"),
                                            _provider_row(222, "Legacy", "Nowhere")]}}
    positions._store_identities(conn, {"2025-26": []}, cache)          # nothing claimed this time
    survivors = dict(conn.execute("SELECT source_id, resolved_by FROM player_xref"))
    assert survivors == {"998490": "recent_form", "222": "unknown"}    # only its own was retracted


def test_namesakes_in_one_season_are_rejected_not_collapsed(tmp_path):
    """Ten different 'Sanchez' must not all land on our single Sanchez (the bug this guards)."""
    ctx = _ctx(tmp_path)
    _add_player(ctx.conn, 1, "Sanchez", "Inter", "serie_a")
    ctx.conn.commit()
    rows_by_league = {
        "serie_a": [_provider_row(10, "Alexis Sanchez", "Inter")],
        "la_liga": [_provider_row(11, "Carlos Sanchez", "Sevilla")],
        "ligue_1": [_provider_row(12, "Davinson Sanchez", "Nice")],
    }
    claims, report = positions.resolve_season(ctx.conn, "2023-24", rows_by_league)
    # the club pass identifies the Inter one; the other two only matched by surname -> superseded
    assert [claim.provider_id for claim in claims] == ["10"]
    assert {entry["reason"] for entry in report} == {"superseded"}


def test_weak_multi_claims_keep_nobody(tmp_path):
    ctx = _ctx(tmp_path)
    _add_player(ctx.conn, 1, "Martin", "Inter", "serie_a")
    ctx.conn.commit()
    rows_by_league = {                     # neither provider row matches our club -> both fallbacks
        "la_liga": [_provider_row(20, "Jose Martin", "Getafe")],
        "ligue_1": [_provider_row(21, "Paul Martin", "Nice")],
    }
    claims, report = positions.resolve_season(ctx.conn, "2023-24", rows_by_league)
    assert claims == []
    assert {entry["reason"] for entry in report} == {"ambiguous"}


def test_one_identity_across_seasons(tmp_path):
    """A real player has ONE provider id: two ids on the same fc_id in different seasons = namesake."""
    ctx = _ctx(tmp_path)
    _add_player(ctx.conn, 1, "Nunez", "Liverpool", "premier_league", season="2023-24")
    _add_player(ctx.conn, 1, "Nunez", "Liverpool", "premier_league", season="2025-26")
    ctx.conn.commit()
    first, _r = positions.resolve_season(
        ctx.conn, "2023-24", {"premier_league": [_provider_row(30, "Darwin Nunez", "Liverpool FC")]})
    second, _r = positions.resolve_season(
        ctx.conn, "2025-26", {"la_liga": [_provider_row(31, "Unai Nunez", "Celta Vigo")]})
    kept, report = positions.enforce_one_identity({"2023-24": first, "2025-26": second})
    assert [claim.provider_id for claim in kept["2023-24"]] == ["30"]
    assert kept["2025-26"] == []
    assert [entry["reason"] for entry in report] == ["namesake"]


def test_manual_override_wins(tmp_path):
    ctx = _ctx(tmp_path)
    _add_player(ctx.conn, 1, "Somebody", "Inter", "serie_a")
    ctx.conn.execute(
        "INSERT INTO manual_overrides(entity, fc_id, field, value, reason, created_at) "
        "VALUES ('player_xref', 1, 'sofascore', '999', 'test', '2026-07-26')")
    ctx.conn.commit()
    claims, _report = positions.resolve_season(
        ctx.conn, "2023-24", {"serie_a": [_provider_row(999, "Totally Different", "Empoli")]})
    assert [(claim.fc_id, claim.pass_name) for claim in claims] == [(1, "manual")]


def test_parse_round_uses_the_xref_and_keeps_the_real_matchday():
    payload = {
        "league": "premier_league", "round": 7,
        "events": [{"id": 111, "home": "Liverpool FC", "away": "Arsenal", "round": 7,
                    "startTimestamp": 1_696_000_000}],
        "lineups": {"111": {
            "home": [{"player": {"id": 30, "name": "Darwin Nunez", "position": "F"},
                      "substitute": False, "position": "F",
                      "statistics": {"rating": 7.4, "minutesPlayed": 88, "goals": 1,
                                     "goalAssist": 1, "expectedGoals": 0.7,
                                     "expectedAssists": 0.2, "totalShots": 5,
                                     "onTargetScoringAttempt": 3, "bigChanceCreated": 1,
                                     "bigChanceMissed": 2, "keyPass": 4, "touches": 41}},
                     {"player": {"id": 31, "name": "Unknown Guy"}, "substitute": True,
                      "statistics": {"rating": 6.0, "minutesPlayed": 2}},
                     {"player": {"id": 32, "name": "Never Played"}, "substitute": True,
                      "statistics": {}}],
            "away": []}},
    }
    rows, club_rows, unknown = positions.parse_round(payload, "2023-24", {"30": 1})
    assert unknown == 2                       # 31 has no xref, 32 never came on
    assert len(rows) == 1
    # the club-level count reads EVERY entry, identity or not: one starter, and he is a forward
    assert club_rows == [("2023-24", "111", "Liverpool FC", "premier_league", 7, "2023-09-29",
                          1, 0, 0, 0, 1)]
    (fc_id, season, match_id, competition, real_md, match_date, club, opponent, home, position,
     started, minutes, rating, goals, assists, xg, xa,
     shots, shots_on_target, bcc, bcm, key_passes, touches) = rows[0]
    assert (fc_id, season, match_id, competition, real_md) == (1, "2023-24", "111", "premier_league", 7)
    assert (club, opponent, home, started, minutes, rating) == ("Liverpool FC", "Arsenal", 1, 1, 88, 7.4)
    assert (goals, assists, xg, xa, position) == (1, 1, 0.7, 0.2, "F")
    assert (shots, shots_on_target, bcc, bcm, key_passes, touches) == (5, 3, 1, 2, 4, 41)
    assert match_date == "2023-09-29"


def test_completion_merges_the_missing_matches_and_keeps_the_cached_ones(tmp_path, monkeypatch):
    """The completion pass must ADD what the perimeter filter skipped without losing or duplicating
    what is already cached - the round file is the only copy of those lineups."""
    ctx = _ctx(tmp_path)
    cached = {"league": "serie_a", "round": 3,
              "events": [{"id": 111, "home": "Inter", "away": "Cremonese", "round": 3,
                          "startTimestamp": 1_696_000_000}],
              "lineups": {"111": {"home": [{"player": {"id": 30}, "substitute": False,
                                            "statistics": {"rating": 7.0, "minutesPlayed": 90}}],
                                  "away": []}}}
    path = ctx.config.cache_dir / "sofascore_round_serie_a_2025-26_r3.json"
    path.write_text(json.dumps(cached), encoding="utf-8")

    round_three = {"events": [
        # already cached: must not be fetched again
        {"id": 111, "homeTeam": {"name": "Inter"}, "awayTeam": {"name": "Cremonese"},
         "roundInfo": {"round": 3}, "status": {"type": "finished"}, "startTimestamp": 1_696_000_000},
        # two non-perimeter clubs: the match the old filter dropped
        {"id": 222, "homeTeam": {"name": "Lecce"}, "awayTeam": {"name": "Pisa"},
         "roundInfo": {"round": 3}, "status": {"type": "finished"}, "startTimestamp": 1_696_100_000},
        # not played yet: must be left alone
        {"id": 333, "homeTeam": {"name": "Parma"}, "awayTeam": {"name": "Como"},
         "roundInfo": {"round": 3}, "status": {"type": "notstarted"}},
    ]}
    # rounds 1-2 are already complete: their listing holds exactly what the cache holds
    for other in (1, 2):
        (ctx.config.cache_dir / f"sofascore_round_serie_a_2025-26_r{other}.json").write_text(
            json.dumps({**cached, "round": other,
                        "events": [{**cached["events"][0], "id": 100 + other, "round": other}],
                        "lineups": {str(100 + other): cached["lineups"]["111"]}}), encoding="utf-8")
    listings = {
        1: {"events": [{"id": 101, "homeTeam": {"name": "Inter"}, "awayTeam": {"name": "Cremonese"},
                        "roundInfo": {"round": 1}, "status": {"type": "finished"}}]},
        2: {"events": [{"id": 102, "homeTeam": {"name": "Inter"}, "awayTeam": {"name": "Cremonese"},
                        "roundInfo": {"round": 2}, "status": {"type": "finished"}}]},
        3: round_three,
    }
    fetched: list[int] = []

    monkeypatch.setattr(positions, "_client", lambda: _FakeSession())
    monkeypatch.setattr(positions, "_polite_sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(positions, "resolve_season_id", lambda *_a, **_k: 77)
    monkeypatch.setattr(
        positions, "_get_json",
        lambda _s, url, **_k: listings.get(int(url.rsplit("/", 1)[1])) if "/round/" in url else None)

    def fake_lineups(_session, event_id, cancel_event=None):
        fetched.append(event_id)
        return {"home": [{"player": {"id": 31}, "substitute": False,
                          "statistics": {"rating": 6.5, "minutesPlayed": 90}}], "away": []}

    monkeypatch.setattr(positions, "_lineups_for", fake_lineups)
    monkeypatch.setattr(positions, "MAX_ROUNDS", 3)

    added = positions.complete_match_layer(ctx, ["serie_a"], ["2025-26"])

    assert fetched == [222], "only the missing FINISHED match may be fetched"
    assert added["matches"] == 1
    merged = json.loads(path.read_text(encoding="utf-8"))
    assert {str(event["id"]) for event in merged["events"]} == {"111", "222"}
    assert set(merged["lineups"]) == {"111", "222"}
    # the pre-existing lineup is untouched
    assert merged["lineups"]["111"]["home"][0]["player"]["id"] == 30


class _FakeSession:
    def close(self):
        pass


def test_reingest_match_layer_is_idempotent(tmp_path):
    ctx = _ctx(tmp_path)
    ctx.conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'Nunez')")
    ctx.conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (1,'sofascore','30')")
    ctx.conn.commit()
    payload = {"league": "premier_league", "round": 7,
               "events": [{"id": 111, "home": "Liverpool FC", "away": "Arsenal", "round": 7,
                           "startTimestamp": 1_696_000_000}],
               "lineups": {"111": {"home": [{"player": {"id": 30}, "substitute": False,
                                             "statistics": {"rating": 7.4, "minutesPlayed": 90}}],
                                   "away": []}}}
    path = ctx.config.cache_dir / "sofascore_round_premier_league_2023-24_r7.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    for _ in range(2):
        positions.reingest_match_layer(ctx)
        assert ctx.conn.execute("SELECT COUNT(*) FROM external_match_stats").fetchone()[0] == 1


# ---------- heatmap layer (avg_x / avg_y) ----------
def test_heatmap_centroid_is_weighted_by_touch_count():
    payload = {"points": [{"x": 10, "y": 50, "count": 90}, {"x": 90, "y": 50, "count": 10}]}
    assert positions.heatmap_centroid(payload) == (18.0, 50.0, 100)
    # an unweighted mean would answer 50: one stray touch in the box must not move a full-back
    assert positions.heatmap_centroid({"points": []}) is None
    assert positions.heatmap_centroid(None) is None


def test_heatmap_targets_pick_the_league_with_the_most_minutes(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _add_player(conn, 1, "Nunez", "Liverpool FC", "premier_league", season="2023-24")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (1,'sofascore','30')")
    for league, minutes in (("premier_league", 400), ("la_liga", 1200)):
        conn.execute("INSERT INTO external_stats(fc_id, season, source, competition, minutes) "
                     "VALUES (1, '2023-24', 'sofascore', ?, ?)", (league, minutes))
    conn.commit()
    assert positions.heatmap_targets(conn) == [("la_liga", "2023-24", "30", 1)]


def test_ingest_heatmaps_from_cache_keeps_the_derived_role(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'Nunez')")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (1,'sofascore','30')")
    conn.execute("INSERT INTO positions(fc_id, season, source, derived_role, n_matches, is_friendly) "
                 "VALUES (1, '2023-24', 'sofascore', 'A', 20, 0)")
    conn.commit()
    (ctx.config.cache_dir / "sofascore_heatmap_premier_league_2023-24_30.json").write_text(
        json.dumps({"points": [{"x": 80, "y": 40, "count": 10}]}), encoding="utf-8")
    for _ in range(2):
        assert positions.ingest_heatmaps_from_cache(ctx) == 1
        row = conn.execute("SELECT avg_x, avg_y, derived_role FROM positions").fetchone()
        assert tuple(row) == (80.0, 40.0, "A"), "the coordinates must not wipe the role"


def test_role_crosstab_counts_the_provider_vocabulary(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _add_player(conn, 1, "Bastoni", "Inter", "serie_a")
    _add_player(conn, 2, "Thuram", "Inter", "serie_a")
    conn.execute("UPDATE rosters SET role_classic = 'D', roles = 'Dc' WHERE fc_id = 1")
    conn.execute("UPDATE rosters SET role_classic = 'A', roles = 'A;Pc' WHERE fc_id = 2")
    for fc_id, position, matches in ((1, "D", 3), (2, "F", 2), (2, "M", 1)):
        for index in range(matches):
            conn.execute(
                "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, "
                "position, minutes) VALUES (?, '2023-24', 'sofascore', ?, 'serie_a', ?, 90)",
                (fc_id, f"{fc_id}-{position}-{index}", position))
    conn.commit()
    table = positions.role_crosstab(ctx)
    assert table["D"] == {"D": 3}
    assert table["F"] == {"A": 2}
    assert table["M"] == {"A": 1}, "a forward used in midfield is still a listone A"
    report = (ctx.config.data_dir / "reports" / "role_crosstab.csv").read_text(encoding="utf-8")
    assert "classic,D,D,3,1.0000" in report
    assert "mantra,D,Dc,3,1.0000" in report


def test_derive_club_leagues_fills_what_a_fresh_clone_cannot_know(tmp_path):
    """On a machine with no Drive exports the euro listone gives no league: the cache must supply it.

    Ordering matters more than the function: `transfers` resolves clubs BY LEAGUE, so a NULL league at
    that point leaves club_xref empty - and with it the coach spells, the fees and the Transfermarkt
    ids. Hence this runs inside the season-layer re-ingest, not only in `rebuild`.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'Wirtz')")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) "
                 "VALUES (5, 'Bayer Leverkusen', NULL)")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (6, 'Inter', 'serie_a')")
    conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id, league) VALUES (1, '2023-24', 5, NULL)")
    conn.commit()
    (ctx.config.cache_dir / "sofascore_stats_bundesliga_2023-24.json").write_text(
        json.dumps([_provider_row(10, "Florian Wirtz", "Bayer 04 Leverkusen")]), encoding="utf-8")

    clubs, rosters = positions.derive_club_leagues(ctx)
    assert (clubs, rosters) == (1, 1)
    assert conn.execute("SELECT league FROM clubs WHERE fc_club_id = 5").fetchone()[0] == "bundesliga"
    assert conn.execute("SELECT league FROM rosters WHERE fc_id = 1").fetchone()[0] == "bundesliga"
    # a league we already know is never overwritten by a name match
    assert conn.execute("SELECT league FROM clubs WHERE fc_club_id = 6").fetchone()[0] == "serie_a"


# ---------- the granular real role ----------
def _squad_payload(*players) -> dict:
    """A `/team/{id}/players` payload with the two fields the real role is read from."""
    return {"players": [{"player": entry} for entry in players]}


def _provider_player(provider_id, name, detailed, position=None, foot="Right") -> dict:
    return {"id": provider_id, "name": name, "positionsDetailed": list(detailed),
            "position": position, "preferredFoot": foot}


def test_real_role_vocabulary_is_a_complete_grid():
    """Every one of the twelve codes has a line, a flank, a depth and an Italian label - or a player
    carrying it would be placed by a lookup that quietly returns None."""
    assert len(positions.REAL_ROLES) == 12
    for code in positions.REAL_ROLES:
        assert code in positions.REAL_ROLE_LINE
        assert code in positions.REAL_ROLE_SIDE
        assert code in positions.REAL_ROLE_DEPTH
        assert code in positions.REAL_ROLE_LABEL
    # the flanks are symmetric and the middle is the middle
    assert [positions.REAL_ROLE_SIDE[code] for code in ("DL", "ML", "LW")] == [-1.0, -1.0, -1.0]
    assert [positions.REAL_ROLE_SIDE[code] for code in ("DR", "MR", "RW")] == [1.0, 1.0, 1.0]
    assert set(positions.REAL_ROLE_LINE.values()) == {"G", "D", "M", "F"}
    # depth runs from the player's own goal to the opponent's, and the lines do not cross
    assert (positions.REAL_ROLE_DEPTH["GK"] < positions.REAL_ROLE_DEPTH["DC"]
            < positions.REAL_ROLE_DEPTH["DM"] < positions.REAL_ROLE_DEPTH["MC"]
            < positions.REAL_ROLE_DEPTH["AM"] < positions.REAL_ROLE_DEPTH["ST"])


def test_roles_from_squad_pages_are_dated_and_ordered(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _add_player(conn, 1, "Dimarco", "Inter", "serie_a")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (1, 'sofascore', '284361')")
    conn.commit()
    (ctx.config.cache_dir / "sofascore_squad_2697_2026-07-28.json").write_text(
        json.dumps(_squad_payload(
            _provider_player(284361, "Federico Dimarco", ["ML", "DL"], "M", "Left"),
            # nobody resolved this one: counted and skipped, never guessed by name
            _provider_player(999999, "Primavera Kid", ["DC"], "D"))), encoding="utf-8")

    assert positions.ingest_roles_from_cache(ctx) == 1
    roles, primary, line, foot = conn.execute(
        "SELECT roles, primary_role, line, foot FROM player_roles WHERE fc_id = 1").fetchone()
    # the provider's own order is preserved: the first code is the one he is drawn by
    assert (roles, primary, line, foot) == ("ML;DL", "ML", "M", "Left")
    assert conn.execute("SELECT valid_from FROM player_roles").fetchone()[0] == "2026-07-28"


def test_roles_are_a_dated_series_and_read_as_of_a_date(tmp_path):
    """A role observed today must not be visible to an auction dated before it - the same discipline
    every other volatile state here follows."""
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _add_player(conn, 1, "Zappacosta", "Atalanta", "serie_a")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (1, 'sofascore', '77')")
    conn.commit()
    for date, codes in (("2025-08-15", ["DR"]), ("2026-07-28", ["MR", "ML"])):
        (ctx.config.cache_dir / f"sofascore_squad_2686_{date}.json").write_text(
            json.dumps(_squad_payload(_provider_player(77, "Davide Zappacosta", codes, "D"))),
            encoding="utf-8")
    positions.ingest_roles_from_cache(ctx)

    assert conn.execute("SELECT COUNT(*) FROM player_roles").fetchone()[0] == 2
    assert positions.roles_as_of(conn, "2025-12-01")[1]["roles"] == "DR"
    newest = positions.roles_as_of(conn, "2026-07-28")[1]
    assert newest["roles"] == "MR;ML"
    # the drawing position travels with it, so every reader places him the same way
    assert (newest["side"], newest["depth"]) == (1.0, 0.6)
    assert positions.roles_as_of(conn, "2025-01-01") == {}


def test_unknown_provider_code_is_reported_not_absorbed(tmp_path):
    """A thirteenth code upstream must be visible. Dropping it silently would place the player by
    whatever remained, or not at all, with nothing in the log to say why."""
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _add_player(conn, 1, "Someone", "Inter", "serie_a")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (1, 'sofascore', '5')")
    conn.commit()
    (ctx.config.cache_dir / "sofascore_squad_2697_2026-07-28.json").write_text(
        json.dumps(_squad_payload(_provider_player(5, "Someone", ["SS", "ST"], "F"))),
        encoding="utf-8")

    assert positions.unknown_role_codes([_provider_player(5, "x", ["SS", "ST"])]) == {"SS": 1}
    positions.ingest_roles_from_cache(ctx)
    # the known code still lands; the unknown one is dropped from the stored list, not smuggled in
    assert conn.execute("SELECT roles FROM player_roles WHERE fc_id = 1").fetchone()[0] == "ST"


def test_club_xref_folds_duplicate_club_rows_onto_one_provider_team(tmp_path):
    """Two `clubs` rows for the same real club both claim one provider team id, and the xref PK keeps
    one: the live row (more roster players) must win, or a club silently loses its squad page."""
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name) VALUES (1, 'Newcastle')")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name) VALUES (2, 'Newcastle United')")
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (7, 'Isak')")
    conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id) VALUES (7, '2025-26', 2)")
    conn.commit()
    (ctx.config.cache_dir / "sofascore_stats_premier_league_2025-26.json").write_text(
        json.dumps([{"player": {"id": 1, "name": "Alexander Isak"},
                     "team": {"id": 39, "name": "Newcastle United"}}]), encoding="utf-8")

    assert positions.derive_club_xref(ctx) == 1
    assert conn.execute("SELECT fc_club_id FROM club_xref WHERE source = 'sofascore'"
                        ).fetchone()[0] == 2
    assert positions.role_targets(conn) == [("Newcastle United", "39")]
    # and a caller can narrow it to the clubs it actually needs
    assert positions.role_targets(conn, ["Arsenal"]) == []


def test_the_twelve_codes_map_onto_the_mantra_vocabulary():
    """Mantra SIMPLIFIES, so the mapping is lossy on purpose: 'e' and 'w' are sideless, AM is two
    different roles depending on how far forward he plays, and 'b' comes from a COMBINATION."""
    assert set(positions.REAL_TO_MANTRA.values()) <= set(positions.MANTRA_ROLES)
    # every code has a Mantra role, AM excepted: it needs the line to decide
    assert set(positions.REAL_ROLES) - set(positions.REAL_TO_MANTRA) == {"AM"}

    # the direct ones
    assert positions.mantra_roles("GK") == "por"
    assert positions.mantra_roles("ST") == "pc"
    assert positions.mantra_roles("DM") == "m"
    assert positions.mantra_roles("MC") == "c"
    # the flank is dropped, because Mantra does not name it - and the collapse is visible
    assert positions.mantra_roles("ML") == positions.mantra_roles("MR") == "e"
    assert positions.mantra_roles("LW") == positions.mantra_roles("RW") == "w"
    assert positions.mantra_roles("ML;MR") == "e"          # collapsed, not duplicated
    # the flank IS named for defenders, where Mantra keeps it
    assert positions.mantra_roles("DL") == "ds"
    assert positions.mantra_roles("DR") == "dd"

    # AM: more midfielder -> trequartista, more forward -> attaccante. The provider's own line decides.
    assert positions.mantra_roles("AM;MC", line="M") == "t;c"
    assert positions.mantra_roles("AM;ST", line="F") == "a;pc"
    assert positions.mantra_roles("AM") == "t"             # no line stated: the midfield reading

    # 'b' (braccetto): a flank defender who also plays central in a back three. No single code says it.
    assert positions.mantra_roles("DL;DC") == "ds;dc;b"
    assert positions.mantra_roles("DC;DR") == "dc;dd;b"
    assert positions.mantra_roles("DC") == "dc"            # central only: not a braccetto
    assert positions.mantra_roles("DL") == "ds"            # flank only: not a braccetto either
    assert positions.mantra_roles("ML;DC;DR") == "e;dc;dd;b"

    # the provider's order is preserved, and nothing unknown gets through
    assert positions.mantra_roles("RW;AM;MC", line="M") == "w;t;c"
    assert positions.mantra_roles("SS;ST") == "pc"
    assert positions.mantra_roles(None) == ""


def test_derived_mantra_role_travels_with_the_observation(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _add_player(conn, 1, "Bastoni", "Inter", "serie_a")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (1, 'sofascore', '385330')")
    conn.commit()
    (ctx.config.cache_dir / "sofascore_squad_2697_2026-07-28.json").write_text(
        json.dumps(_squad_payload(
            _provider_player(385330, "Alessandro Bastoni", ["DC", "DR"], "D", "Left"))),
        encoding="utf-8")
    positions.ingest_roles_from_cache(ctx)

    entry = positions.roles_as_of(conn, "2026-07-28")[1]
    # a centre back who also plays right back IS a braccetto, and that is only visible in the LIST
    assert entry["mantra"] == "dc;dd;b"


# ---------- the extra layer: what a league calendar cannot see ----------
def test_the_extra_layer_keeps_each_match_in_its_own_competition_and_season(tmp_path):
    """A club's friendlies and cup ties arrive in ONE cached file, so the competition and the season
    cannot come from the file: a July friendly and a May cup tie are two seasons, and a friendly must
    never be counted as a league match (`snapshot.competition_class` reads that slug)."""
    from euroleghe_ingest.modules import positions, snapshot

    payload = {
        "league": "extra", "round": 0,
        "events": [
            {"id": 1, "home": "Napoli", "away": "Girona", "round": None,
             "startTimestamp": 1_784_000_000, "competition": "club-friendly-games",
             "season": "2026-27"},
            {"id": 2, "home": "Napoli", "away": "Milan", "round": None,
             "startTimestamp": 1_747_000_000, "competition": "coppa-italia", "season": "2024-25"},
        ],
        "lineups": {
            "1": {"home": [{"player": {"id": "99", "name": "Tester", "position": "F"},
                            "substitute": False, "position": "F",
                            "statistics": {"minutesPlayed": 62, "rating": 7.1, "goals": 1}}],
                  "away": []},
            "2": {"home": [{"player": {"id": "99", "name": "Tester", "position": "F"},
                            "substitute": False, "position": "F",
                            "statistics": {"minutesPlayed": 90, "rating": 6.5}}],
                  "away": []},
        },
    }
    rows, club_rows, _unknown = positions.parse_round(payload, "2025-26", {"99": 7})
    by_match = {row[2]: row for row in rows}
    assert by_match["1"][1] == "2026-27" and by_match["1"][3] == "club-friendly-games"
    assert by_match["2"][1] == "2024-25" and by_match["2"][3] == "coppa-italia"
    # the club-level counts follow the same event, or the two layers would disagree about a match
    assert {row[0] for row in club_rows} == {"2026-27", "2024-25"}
    # and the sheet classes them apart: a friendly's goals are never league goals
    assert snapshot.competition_class("club-friendly-games") == "friendly"
    assert snapshot.competition_class("coppa-italia") == "cup"

    # a payload with no per-event tags still reads as before: the file names both
    plain = {"league": "serie_a", "round": 3,
             "events": [{"id": 3, "home": "Napoli", "away": "Lazio", "round": 3,
                         "startTimestamp": 1_747_000_000}],
             "lineups": {"3": payload["lineups"]["2"]}}
    (row,) = positions.parse_round(plain, "2024-25", {"99": 7})[0]
    assert row[1] == "2024-25" and row[3] == "serie_a"


def test_the_football_year_turns_in_july():
    """Whether a pre-season friendly counts as next season is a one-line rule, and getting it wrong
    files it in the aggregates of a season that is already over."""
    from euroleghe_ingest.modules.positions import _season_of

    assert _season_of("2026-07-18") == "2026-27"      # pre-season
    assert _season_of("2026-06-30") == "2025-26"      # the season that just ended
    assert _season_of("2027-05-24") == "2026-27"
