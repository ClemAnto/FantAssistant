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
    stored = ctx.conn.execute(
        "SELECT fc_id, goals, pen_scored, pen_taken, xg, competition FROM external_stats").fetchone()
    assert tuple(stored) == (1, 13, 10, 11, 5.5, "serie_a")
    assert ctx.conn.execute("SELECT source_id FROM player_xref WHERE fc_id = 1").fetchone()[0] == "10"


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
