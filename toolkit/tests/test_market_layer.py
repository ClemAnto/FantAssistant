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
    # the href carries Transfermarkt's own player id: the canonical key, kept alongside the name
    assert [rec["tm_id"] for rec in records] == ["111", "222"]


def test_upsert_transfers_resolves_the_canonical_id_where_the_name_pool_is_blind(tmp_path):
    """The Molina case (08/08/2026): a July arrival is not in the buying club's LISTONE roster, so
    the name pool cannot contain him - but his Transfermarkt id is already in `player_xref`. The id
    resolves first; the name inside the club stays as the fallback for men the xref does not know."""
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (1,'Roma','serie_a')")
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(4998, "Molina N."), (7, "Bonny")])
    # the listone still files Molina elsewhere: Roma's roster pool does NOT contain him
    conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id, league) "
                 "VALUES (7, '2026-27', 1, 'serie_a')")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) "
                 "VALUES (4998, 'transfermarkt', '424042')")
    conn.commit()
    records = [
        {"direction": "in", "name": "Nahuel Molina", "tm_id": "424042",
         "counterpart": "Atletico Madrid", "fee": 15_000_000},
        # no xref row -> resolved by name inside the club, as before
        {"direction": "in", "name": "Ange-Yoan Bonny", "tm_id": "111",
         "counterpart": "Parma", "fee": 23_000_000},
        # neither an xref row nor a roster row: reported, never guessed
        {"direction": "in", "name": "Perfect Stranger", "tm_id": "999",
         "counterpart": "Nowhere FC", "fee": None},
    ]
    stored, unresolved = transfers.upsert_transfers(conn, 1, "serie_a", "2026-27", records,
                                                    observed_on="2026-08-08")
    assert (stored, unresolved) == (2, ["Perfect Stranger"])
    rows = dict(conn.execute("SELECT fc_id, first_seen FROM transfers_history").fetchall())
    assert rows == {4998: "2026-08-08", 7: "2026-08-08"}


def test_the_same_deal_on_both_clubs_pages_is_one_row(tmp_path):
    """A perimeter-to-perimeter deal is published twice, each page spelling the other club its own
    way ('AS Roma' / 'SS Lazio'): the counterpart canonicalizes at write, so the two parses land on
    ONE key - and their half-filled league columns merge instead of overwriting each other."""
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.executemany("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, 'serie_a')",
                     [(1, "Roma"), (2, "Lazio")])
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'A')")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) "
                 "VALUES (1, 'transfermarkt', '11')")
    conn.commit()
    # the buyer's page names the seller, the seller's page names the buyer
    transfers.upsert_transfers(conn, 2, "serie_a", "2026-27",
                               [{"direction": "in", "name": "A", "tm_id": "11",
                                 "counterpart": "AS Roma", "fee": 10.0}], observed_on="2026-08-05")
    transfers.upsert_transfers(conn, 1, "serie_a", "2026-27",
                               [{"direction": "out", "name": "A", "tm_id": "11",
                                 "counterpart": "SS Lazio", "fee": 10.0}], observed_on="2026-08-08")
    rows = [tuple(row) for row in conn.execute(
        "SELECT from_club, to_club, from_league, to_league, fee, first_seen "
        "FROM transfers_history")]
    assert rows == [("Roma", "Lazio", "serie_a", "serie_a", 10.0, "2026-08-05")]


def test_first_seen_is_kept_at_its_minimum_across_reparses(tmp_path):
    """A re-download must never rejuvenate a row: the observation date answers «since when do we
    know this?», and the earliest answer is the one that means something."""
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (1,'Roma','serie_a')")
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'A')")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) "
                 "VALUES (1, 'transfermarkt', '11')")
    conn.commit()
    record = [{"direction": "in", "name": "A", "tm_id": "11", "counterpart": "B", "fee": None}]
    for day in ("2026-08-08", "2026-08-20", None):
        transfers.upsert_transfers(conn, 1, "serie_a", "2026-27", record, observed_on=day)
    assert conn.execute("SELECT first_seen FROM transfers_history").fetchone()[0] == "2026-08-08"


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
