"""Tests for the market layer: Transfermarkt parsing / new_coach, and tournament minutes."""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import tournaments, transfers

# ---------- transfers: fees ----------


def test_parse_fee_handles_the_units_and_the_non_fees():
    assert transfers.parse_fee("23,00 mln €") == 23_000_000
    assert transfers.parse_fee("300 mila €") == 300_000
    assert transfers.parse_fee("1,50 mln €") == 1_500_000
    for text in ("prestito oneroso", "svincolato", "sconosciuto", "-", "", None):
        assert transfers.parse_fee(text) is None


# ---------- transfers: pages ----------

_COMPETITION = """
<table class="items"><tbody>
  <tr><td><a href="/inter/startseite/verein/46" title="Inter">Inter</a></td></tr>
  <tr><td><a href="/ac-milan/startseite/verein/5" title="AC Milan">AC Milan</a></td></tr>
</tbody></table>
"""

# Mirrors the real page: the first trainer link is the PHOTO (no text), the date of birth shows up
# twice, and the duration column carries no date.
_COACHES = """
<table class="items"><tbody>
  <tr>
    <td><a href="/cristian-chivu/profil/trainer/1234"><img src="chivu.png"/></a>
        Cristian Chivu 26/10/1980</td><td></td>
    <td><a href="/cristian-chivu/profil/trainer/1234">Cristian Chivu</a></td>
    <td>26/10/1980</td><td></td><td>09/06/2025</td><td></td><td>48 giorni</td>
  </tr>
  <tr>
    <td><a href="/simone-inzaghi/profil/trainer/9876"><img src="inzaghi.png"/></a>
        Simone Inzaghi 05/04/1976</td><td></td>
    <td><a href="/simone-inzaghi/profil/trainer/9876">Simone Inzaghi</a></td>
    <td>05/04/1976</td><td>01/07/2021</td><td>04/06/2025</td><td></td><td>1434 giorni</td>
  </tr>
</tbody></table>
"""

_CLUB_TRANSFERS = """
<table class="items">
  <thead><tr><th>Giocatori</th><th>Venditore</th><th>Costo</th></tr></thead>
  <tbody><tr>
    <td><a href="/bonny/profil/spieler/111">Ange-Yoan Bonny</a></td>
    <td><a href="/parma/startseite/verein/130" title="Parma">Parma</a></td>
    <td>23,00 mln €</td>
  </tr></tbody>
</table>
<table class="items">
  <thead><tr><th>Giocatori</th><th>Acquirente</th><th>Costo</th></tr></thead>
  <tbody><tr>
    <td><a href="/correa/profil/spieler/222">Joaquin Correa</a></td>
    <td><a href="/botafogo/startseite/verein/537" title="Botafogo">Botafogo</a></td>
    <td>prestito</td>
  </tr></tbody>
</table>
"""


def test_parse_competition_clubs():
    assert transfers.parse_competition_clubs(_COMPETITION) == [("AC Milan", "5"), ("Inter", "46")]


def test_parse_coach_history_reads_the_spell_not_the_birth_date():
    spells = transfers.parse_coach_history(_COACHES)
    assert spells[0] == {"name": "Cristian Chivu", "valid_from": "2025-06-09", "valid_to": None}
    assert spells[1] == {"name": "Simone Inzaghi", "valid_from": "2021-07-01",
                         "valid_to": "2025-06-04"}


def test_parse_club_transfers_separates_arrivals_from_departures():
    records = transfers.parse_club_transfers(_CLUB_TRANSFERS)
    assert [rec["direction"] for rec in records] == ["in", "out"]
    assert records[0]["counterpart"] == "Parma" and records[0]["fee"] == 23_000_000
    assert records[1]["counterpart"] == "Botafogo" and records[1]["fee"] is None   # a loan


def test_resolve_clubs_maps_transfermarkt_names_to_ours(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.executemany("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, 'serie_a')",
                     [(1, "Inter"), (2, "Milan")])
    conn.commit()
    matched, misses = transfers.resolve_clubs(conn, "serie_a", [("Inter", "46"), ("AC Milan", "5"),
                                                               ("Hellas Verona", "276")])
    assert (matched, misses) == (2, ["Hellas Verona"])       # Verona is not in this perimeter
    assert dict(conn.execute("SELECT source_id, fc_club_id FROM club_xref")) == {"46": 1, "5": 2}


def test_new_coach_flags_the_season_after_the_change(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (1,'Inter','serie_a')")
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", [(1, "A"), (2, "B")])
    conn.executemany("INSERT INTO rosters(fc_id, season, fc_club_id, league) "
                     "VALUES (?, ?, 1, 'serie_a')",
                     [(1, "2024-25"), (2, "2024-25"), (1, "2025-26"), (2, "2025-26")])
    conn.executemany("INSERT INTO coaches(fc_club_id, coach_name, valid_from, valid_to) "
                     "VALUES (1, ?, ?, ?)",
                     [("Inzaghi", "2021-07-01", "2025-06-04"), ("Chivu", "2025-06-09", None)])
    conn.commit()

    assert transfers.derive_new_coach(conn) == 2            # both 2025-26 players, none in 2024-25
    rows = conn.execute("SELECT season, value FROM flags WHERE flag = 'new_coach'").fetchall()
    assert {row[0] for row in rows} == {"2025-26"}
    assert {row[1] for row in rows} == {"Chivu"}


# ---------- tournaments ----------


def test_summarise_counts_minutes_only_for_players_we_know():
    payload = {
        "key": "world_cup_2026",
        "events": [{"id": 1, "startTimestamp": 1_781_204_400},
                   {"id": 2, "startTimestamp": 1_781_809_200}],
        "lineups": {
            "1": {"home": [{"id": 900, "minutes": 90}, {"id": 901, "minutes": 20},
                           {"id": 902, "minutes": None}], "away": []},
            "2": {"home": [{"id": 900, "minutes": 75}], "away": []},
        },
    }
    summary = tournaments.summarise(payload, {"900": 1, "902": 3})
    assert set(summary) == {1}                       # 901 is unknown, 902 never came on
    assert summary[1]["minutes"] == 165 and summary[1]["matches"] == 2
    assert summary[1]["first_date"] < summary[1]["last_date"]


def test_store_writes_the_squad_and_the_post_tournament_signal(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'X')")
    conn.commit()
    stored = tournaments.store(conn, "world_cup_2026", {
        1: {"matches": 7, "minutes": 630, "first_date": "2026-06-11", "last_date": "2026-07-05"}})
    assert stored == 1
    squad = conn.execute("SELECT tournament, start_date, end_date FROM tournaments_squads").fetchone()
    assert tuple(squad) == ("world_cup_2026", "2026-06-11", "2026-07-05")
    flag = conn.execute("SELECT season, value FROM flags WHERE flag = 'post_torneo'").fetchone()
    # the effect lands on the season that follows a summer tournament, with the minutes as the load
    assert flag[0] == "2026-27" and "630min" in flag[1]
