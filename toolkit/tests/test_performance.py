"""Tests for the Transfermarkt per-match layer (`performance`).

What is worth asserting is the semantics the payload makes easy to get wrong: a man who was in the squad and
never came on has NO minutes, and writing a zero there would say «he played zero minutes» about somebody who
never took the field - the same «vuoto = ignoto, mai zero» this project keeps paying for. Plus the two
things that make a row joinable at all: a season string of ours derived from the provider's id, and the
NATIONAL flag, which is the half of the acquisition nobody else can give us.
"""

from __future__ import annotations

import sqlite3

from euroleghe_ingest.modules import performance


def _game(**over) -> dict:
    game = {
        "gameInformation": {
            "gameId": "4635309", "competitionId": "IT1", "seasonId": 2025, "gameDay": 34,
            "isNationalGame": False, "date": {"dateTimeUTC": "2026-05-17T19:00:00+00:00"},
        },
        "clubsInformation": {"club": {"clubId": "273"}},
        "statistics": {
            "generalStatistics": {"participationState": "played"},
            "goalStatistics": {"goalsScoredTotal": 1, "assists": None},
            "cardStatistics": {"yellowCards": 1, "redCards": 0},
            "playingTimeStatistics": {"playedMinutes": 69},
        },
    }
    for key, value in over.items():
        if key in ("gameInformation", "statistics"):
            game[key] = {**game[key], **value}
        else:
            game[key] = value
    return game


def test_a_played_match_carries_its_minutes_and_our_own_season_string():
    rows = performance.parse_games({"data": {"performance": [_game()]}})
    assert len(rows) == 1
    row = rows[0]
    assert row["minutes"] == 69 and row["state"] == "played"
    assert row["season"] == "2025-26", "l'id della fonte e' l'anno d'inizio, non la nostra stringa"
    assert row["competition"] == "IT1" and row["is_national"] == 0
    assert row["played_on"] == "2026-05-17"


def test_an_unused_substitute_has_NO_minutes_and_never_a_zero():
    """La riga esiste - era in distinta - e i minuti sono IGNOTI: e' lo stato che distingue, non uno zero."""
    bench = _game(statistics={"generalStatistics": {"participationState": "in squad"},
                              "playingTimeStatistics": {}})
    row = performance.parse_games({"data": {"performance": [bench]}})[0]
    assert row["minutes"] is None
    assert row["state"] == "in squad"


def test_a_national_team_match_is_marked_because_nothing_else_can_say_it():
    game = _game(gameInformation={"isNationalGame": True, "competitionId": "FS"})
    assert performance.parse_games({"data": {"performance": [game]}})[0]["is_national"] == 1


def test_a_game_without_an_id_or_a_date_is_dropped_rather_than_stored_under_a_guess():
    no_id = _game(gameInformation={"gameId": None})
    no_date = _game(gameInformation={"date": {}})
    assert performance.parse_games({"data": {"performance": [no_id, no_date]}}) == []
    # ...e un payload vuoto o rotto non e' un errore: e' zero righe.
    assert performance.parse_games(None) == []
    assert performance.parse_games({"data": {}}) == []


def test_season_of_refuses_a_number_that_cannot_be_a_season():
    assert performance.season_of(2025) == "2025-26"
    assert performance.season_of("2019") == "2019-20"
    assert performance.season_of(None) is None
    assert performance.season_of(12) is None


def test_storing_twice_does_not_duplicate_a_match(tmp_path):
    """La PK e' (fc_id, tm_game_id): la serie cresce e si ri-scarica, quindi il re-ingest deve sovrascrivere."""
    from euroleghe_ingest.db.database import init_db
    conn = init_db(tmp_path / "euro.db")
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (7, 'Jacquet')")
    rows = performance.parse_games({"data": {"performance": [_game()]}})
    performance.store(conn, 7, rows)
    performance.store(conn, 7, rows)
    conn.commit()
    assert conn.execute("SELECT COUNT(*) FROM tm_appearances").fetchone()[0] == 1
    assert isinstance(conn, sqlite3.Connection)
