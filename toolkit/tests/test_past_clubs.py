"""A club that left the perimeter keeps its past: its Transfermarkt id is derived from the per-game rows."""
from __future__ import annotations

from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import transfers


def _seed(conn, club_id: int, name: str, men: int, tm_votes: dict[str, int], season: str = "2023-24") -> None:
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, 'serie_a')", (club_id, name))
    fc = club_id * 1000
    for tm, games in tm_votes.items():
        for _ in range(men):
            fc += 1
            conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", (fc, f"P{fc}"))
            conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id) VALUES (?, ?, ?)", (fc, season, club_id))
            for g in range(games):
                conn.execute("INSERT INTO tm_appearances(fc_id, tm_game_id, played_on, season, competition, "
                             "is_national, club_id, state) VALUES (?, ?, ?, ?, 'IT1', 0, ?, 'played')",
                             (fc, f"{fc}-{g}", f"2023-09-{g % 28 + 1:02d}", season, tm))


def test_a_clear_vote_maps_the_club_and_a_split_or_taken_one_does_not(tmp_path):
    conn = init_db(tmp_path / "t.sqlite")
    _seed(conn, 48, "Verona", 10, {"276": 35})                 # 350 rows, all one provider club
    _seed(conn, 21, "West Ham", 2, {"416": 40, "379": 38})     # a split vote
    _seed(conn, 30, "Torino", 10, {"416": 35})                 # the competition page already mapped it
    _seed(conn, 64, "Wolfsburg", 10, {"416": 35})              # the id belongs to somebody else
    conn.execute("INSERT INTO club_xref(fc_club_id, source, source_id) VALUES (30, 'transfermarkt', '416')")
    assert transfers.derive_past_clubs(conn) == 1
    mapped = dict(conn.execute("SELECT fc_club_id, source_id FROM club_xref WHERE source = 'transfermarkt'"))
    assert mapped == {30: "416", 48: "276"}


def test_a_thin_vote_is_not_evidence(tmp_path):
    conn = init_db(tmp_path / "t.sqlite")
    _seed(conn, 72, "Brescia", 2, {"19": 30})                  # 60 rows < DERIVED_MIN_ROWS
    assert transfers.derive_past_clubs(conn) == 0
