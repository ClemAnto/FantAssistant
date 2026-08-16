"""La curva del valore: il parser della serie e il giro offline.

Quello che deve reggere e' il payload della fonte com'e', virgole e localizzazione comprese - e quello
che NON deve fare e' inventare una data quando non la sa leggere.
"""

from __future__ import annotations

import json

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules.market import parse_graph, reingest_from_cache, upsert

PAYLOAD = {
    "list": [
        {"x": 1313359200000, "y": 50000, "mw": "50 mila €", "datum_mw": "15/08/2011",
         "verein": "Barnsley FC U18", "age": "17"},
        {"x": 1400000000000, "y": 12000000, "mw": "12,00 mln €", "datum_mw": "13/05/2014",
         "verein": "Everton FC", "age": "19"},
        # senza data: la fonte a volte manda un punto monco, e un punto senza quando non e' un punto
        {"x": 1500000000000, "y": 40000000, "mw": "40,00 mln €", "verein": "Man City"},
        # senza valore
        {"datum_mw": "01/01/2020", "verein": "Man City", "age": "25"},
    ],
    "current": "20,00 mln €",
}


def _ctx(tmp_path) -> Context:
    config = Config(db_path=tmp_path / "test.db", data_dir=tmp_path)
    conn = init_db(config.db_path)
    ctx = Context(config=config)
    ctx.conn = conn
    return ctx


def test_legge_la_serie_e_scarta_i_punti_monchi():
    points = parse_graph(PAYLOAD)
    assert len(points) == 2
    assert points[0] == {"observed_on": "2011-08-15", "value": 50000.0,
                         "club": "Barnsley FC U18", "age": 17}
    assert points[1]["observed_on"] == "2014-05-13"
    assert points[1]["value"] == 12000000.0


def test_il_valore_viene_dal_NUMERO_e_non_dalla_stringa_per_umani():
    """`mw` e' «12,00 mln €»: parsarla sarebbe sbagliare un numero che si ha gia' pulito accanto."""
    points = parse_graph({"list": [{"y": 12000000, "mw": "12,00 mln €",
                                    "datum_mw": "13/05/2014"}]})
    assert points[0]["value"] == 12000000.0


def test_una_lista_vuota_e_un_fatto_e_non_un_errore():
    assert parse_graph({"list": []}) == []
    assert parse_graph({}) == []


def test_il_giro_offline_rilegge_la_cache_e_salta_gli_id_non_mappati(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.require_conn()
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'Stones')")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (1, 'transfermarkt', '186590')")
    ctx.config.cache_dir.mkdir(parents=True, exist_ok=True)
    (ctx.config.cache_dir / "transfermarkt_mv_186590.json").write_text(
        json.dumps(PAYLOAD), encoding="utf-8")
    # ...e una curva di un id che nessuno ha mappato: si salta, non si indovina a chi appartiene
    (ctx.config.cache_dir / "transfermarkt_mv_999999.json").write_text(
        json.dumps(PAYLOAD), encoding="utf-8")

    assert reingest_from_cache(ctx) == 2
    rows = [tuple(row) for row in conn.execute(
        "SELECT observed_on, value, club, age FROM market_value_history ORDER BY observed_on")]
    assert rows == [("2011-08-15", 50000.0, "Barnsley FC U18", 17),
                    ("2014-05-13", 12000000.0, "Everton FC", 19)]


def test_un_fc_id_con_DUE_id_transfermarkt_non_si_scarica_affatto(tmp_path):
    """31 fc_id su 3.407 sono omonimi fusi (Sergio Ramos ne ha quattro).

    La chiave e' (fc_id, observed_on): due carriere non si affiancano, si sovrascrivono, e quello che
    resta e' una curva che nessuno ha vissuto. Meglio una cella vuota.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.require_conn()
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (7, 'Sergio Ramos')")
    for source_id in ("25557", "282429"):
        conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (7, 'transfermarkt', ?)",
                     (source_id,))
        ctx.config.cache_dir.mkdir(parents=True, exist_ok=True)
        (ctx.config.cache_dir / f"transfermarkt_mv_{source_id}.json").write_text(
            json.dumps(PAYLOAD), encoding="utf-8")

    assert reingest_from_cache(ctx) == 0
    assert conn.execute("SELECT COUNT(*) FROM market_value_history").fetchone()[0] == 0


def test_ripassare_la_stessa_curva_non_duplica_niente(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.require_conn()
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'Stones')")
    points = parse_graph(PAYLOAD)
    upsert(conn, 1, points)
    upsert(conn, 1, points)
    assert conn.execute("SELECT COUNT(*) FROM market_value_history").fetchone()[0] == 2
