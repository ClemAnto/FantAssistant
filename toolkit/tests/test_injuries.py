"""Tests for the Transfermarkt injury layer: the parsers, the classifier and the round trip.

Two things here are worth a test rather than a reading. (1) The squad table nests a player card, so
the visible cells only line up with the header when the nested tds are excluded - reading the
contract column by NAME depends on that. (2) The injury page carries a second table (the per-season
summary) with the same CSS class, and ingesting it as history would invent absences.
"""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import injuries

# Two tables, exactly as the source ships them: the history (6 columns) and the summary (4).
_INJURY_HTML = """
<html><body>
<table class="items">
  <thead><tr><th>Stagione</th><th>Infortunio</th><th>da</th><th>fino al</th>
             <th>giorni</th><th>Partite perse</th></tr></thead>
  <tbody>
    <tr><td>25/26</td><td>Ritardo di condizione</td><td>06/10/2025</td><td>06/12/2025</td>
        <td>62 giorni</td><td>7</td></tr>
    <tr><td>24/25</td><td>Rottura del legamento crociato</td><td>18/01/2025</td><td>05/10/2025</td>
        <td>261 giorni</td><td>26</td></tr>
    <tr><td>24/25</td><td>Influenza</td><td>29/12/2024</td><td>-</td><td>-</td><td>-</td></tr>
  </tbody>
</table>
<table class="items">
  <thead><tr><th>Stagione</th><th>giorni</th><th>Infortuni</th><th>Partite perse</th></tr></thead>
  <tbody><tr><td>24/25</td><td>302 giorni</td><td>4</td><td>33</td></tr></tbody>
</table>
<div><a href="/x/verletzungen/spieler/29260/page/2">2</a>
     <a href="/x/verletzungen/spieler/29260/page/3">3</a></div>
</body></html>
"""

# The 'Giocatori' cell nests a whole card, which is what breaks a naive cell-index parser.
_SQUAD_HTML = """
<html><body>
<table class="items">
  <thead><tr><th>#</th><th>Giocatori</th><th>Nato il</th><th>Naz</th><th>Altezza</th><th>Piede</th>
             <th>In rosa da</th><th>Precedente</th><th>Contratto</th>
             <th>Valore di mercato</th></tr></thead>
  <tbody>
    <tr>
      <td>9</td>
      <td><table class="inline-table"><tr>
            <td><a href="/moise-kean/profil/spieler/300716">Moise Kean</a></td>
            <td>Attaccante</td></tr></table></td>
      <td>28/02/2000 (26)</td><td></td><td>1,83m</td><td>destro</td>
      <td>01/07/2024</td><td></td><td>30/06/2029</td><td>25,00 mln</td>
    </tr>
  </tbody>
</table>
</body></html>
"""

# The same page for a PAST season: no contract column at all (verified against the source).
_OLD_SQUAD_HTML = _SQUAD_HTML.replace("<th>Contratto</th>", "").replace(
    "<td>30/06/2029</td>", "")


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


def test_parse_injury_history_reads_only_the_history_table():
    rows = injuries.parse_injury_history(_INJURY_HTML)
    assert len(rows) == 3, "the per-season summary table must not be ingested as history"
    first = rows[0]
    assert first["start_date"] == "2025-10-06"
    assert first["end_date"] == "2025-12-06"
    assert first["days_out"] == 62
    assert first["matches_missed"] == 7
    assert first["season"] == "2025-26"
    assert first["kind"] == "conditioning"
    # a knee injury must not be classified as a generic muscular one
    assert rows[1]["kind"] == "knee"
    # still out / unknown -> NULL, never zero
    assert rows[2]["end_date"] is None
    assert rows[2]["days_out"] is None
    assert rows[2]["matches_missed"] is None
    assert rows[2]["kind"] == "illness"


def test_parse_max_page_reads_the_pager():
    assert injuries.parse_max_page(_INJURY_HTML) == 3
    assert injuries.parse_max_page("<html><body>no pager</body></html>") == 1


def test_parse_squad_aligns_the_contract_column_despite_the_nested_card():
    rows = injuries.parse_squad(_SQUAD_HTML)
    assert rows == [{"tm_id": "300716", "name": "Moise Kean", "contract_until": "2029-06-30"}]
    # the birth date is also a dd/mm/yyyy in the same row: it must not be mistaken for the contract
    assert rows[0]["contract_until"] != "2000-02-28"


def test_parse_squad_on_a_past_season_has_no_contract():
    rows = injuries.parse_squad(_OLD_SQUAD_HTML)
    assert rows[0]["tm_id"] == "300716"
    assert rows[0]["contract_until"] is None, "contract expiry exists only on the current squad page"


def test_classify_injury_falls_back_to_other_without_guessing():
    assert injuries.classify_injury("Problemi alla caviglia") == "ankle"
    assert injuries.classify_injury("Lesione muscolare") == "muscular"
    assert injuries.classify_injury("Qualcosa di mai visto") == "other"
    assert injuries.classify_injury(None) == "other"


def test_upsert_injuries_and_contract_flags_round_trip(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (2001, 'Moise Kean')")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) "
                 "VALUES (10, 'Fiorentina', 'serie_a')")
    conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic) "
                 "VALUES (2001, '2025-26', 10, 'serie_a', 'A')")
    conn.commit()

    matched, unresolved = injuries.resolve_squad(conn, 10, "2025-26",
                                                injuries.parse_squad(_SQUAD_HTML))
    assert (matched, unresolved) == (1, [])
    assert conn.execute("SELECT source_id FROM player_xref WHERE source = 'transfermarkt'"
                        ).fetchone()[0] == "300716"

    stored = injuries.upsert_injuries(conn, 2001, injuries.parse_injury_history(_INJURY_HTML))
    assert stored == 3
    row = conn.execute("SELECT kind, days_out, matches_missed, source FROM injuries "
                       "WHERE fc_id = 2001 AND start_date = '2025-01-18'").fetchone()
    assert tuple(row) == ("knee", 261, 26, "transfermarkt")

    # A contract expiring inside the provisional horizon is an exit risk; a 2029 one is not.
    written = injuries.upsert_contracts(conn, injuries.parse_squad(_SQUAD_HTML),
                                        "2025-26", "2026-07-28")
    assert written == 1
    assert conn.execute("SELECT value FROM flags WHERE flag = 'contract_until'"
                        ).fetchone()[0] == "2029-06-30"
    assert conn.execute("SELECT COUNT(*) FROM flags WHERE flag = 'exit_risk'").fetchone()[0] == 0

    soon = [{"tm_id": "300716", "name": "Moise Kean", "contract_until": "2027-06-30"}]
    injuries.upsert_contracts(conn, soon, "2025-26", "2026-07-28")
    assert conn.execute("SELECT value FROM flags WHERE flag = 'exit_risk'"
                        ).fetchone()[0] == "2027-06-30"


def test_reingest_from_cache_is_offline_and_idempotent(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (2001, 'Moise Kean')")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) "
                 "VALUES (10, 'Fiorentina', 'serie_a')")
    conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic) "
                 "VALUES (2001, '2025-26', 10, 'serie_a', 'A')")
    conn.execute("INSERT INTO club_xref(fc_club_id, source, source_id) "
                 "VALUES (10, 'transfermarkt', '430')")
    conn.commit()
    cache = ctx.config.cache_dir
    (cache / "transfermarkt_kader_430_2025.html").write_text(_SQUAD_HTML, encoding="utf-8")
    (cache / "transfermarkt_squad_430_2026-07-28.html").write_text(_SQUAD_HTML, encoding="utf-8")
    (cache / "transfermarkt_injuries_300716.html").write_text(_INJURY_HTML, encoding="utf-8")

    for _ in range(2):   # twice: the rebuild replays the cache and must converge
        injuries.reingest_from_cache(ctx)
        assert conn.execute("SELECT COUNT(*) FROM injuries").fetchone()[0] == 3
        assert conn.execute("SELECT COUNT(*) FROM flags WHERE flag = 'contract_until'"
                            ).fetchone()[0] == 1
