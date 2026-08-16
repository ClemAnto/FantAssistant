"""Le porte inviolate derivate dal layer per partita, e le tre cose che NON deve fare.

La colonna esiste perché una lega può pagarla anche se la fonte non la applica. Chi la deriva ha un
solo modo di sbagliare che conti davvero: contare le partite che un portiere NON ha giocato.
"""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules.stats import derive_clean_sheets


def _ctx(tmp_path) -> Context:
    config = Config(db_path=tmp_path / "test.db", data_dir=tmp_path)
    conn = init_db(config.db_path)
    ctx = Context(config=config)
    ctx.conn = conn
    return ctx


def _match(conn, fc_id, matchday, conceded, *, role="P", status="played", platform="default"):
    conn.execute(
        """INSERT INTO match_ratings(fc_id, season, matchday, role, team, platform, mv,
                                     goals_conceded, status)
           VALUES (?, '2025-26', ?, ?, 'Inter', ?, 6.0, ?, ?)""",
        (fc_id, matchday, role, platform, conceded, status),
    )


def _season(conn, fc_id, platform="default"):
    conn.execute("INSERT OR IGNORE INTO players(fc_id, canonical_name) VALUES (?, 'Tale')", (fc_id,))
    conn.execute(
        """INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm)
           VALUES (?, '2025-26', ?, 10, 6.0, 5.0)""",
        (fc_id, platform),
    )


def _clean(conn, fc_id, platform="default"):
    return conn.execute(
        "SELECT clean_sheets FROM season_stats WHERE fc_id = ? AND platform = ?",
        (fc_id, platform),
    ).fetchone()[0]


def test_conta_le_partite_giocate_e_chiuse_a_zero(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.require_conn()
    _season(conn, 1)
    for matchday, conceded in ((1, 0), (2, 1), (3, 0), (4, 2)):
        _match(conn, 1, matchday, conceded)
    derive_clean_sheets(ctx)
    assert _clean(conn, 1) == 2


def test_una_riga_senza_partita_non_e_una_porta_inviolata(tmp_path):
    """La guardia che conta: un portiere in panchina porta zero gol subiti come chi ha parato tutto."""
    ctx = _ctx(tmp_path)
    conn = ctx.require_conn()
    _season(conn, 2)
    _match(conn, 2, 1, 0)                       # giocata e chiusa a zero
    _match(conn, 2, 2, 0, status="no_vote")     # in panchina: non è una porta inviolata
    _match(conn, 2, 3, 0, status="no_vote")
    derive_clean_sheets(ctx)
    assert _clean(conn, 2) == 1


def test_chi_il_layer_non_copre_resta_IGNOTO_e_non_zero(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.require_conn()
    _season(conn, 3)                            # nessuna riga per partita
    derive_clean_sheets(ctx)
    assert _clean(conn, 3) is None


def test_un_giocatore_di_movimento_non_tiene_porte_inviolate(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.require_conn()
    _season(conn, 4)
    _match(conn, 4, 1, 0, role="D")
    _match(conn, 4, 2, 0, role="D")
    derive_clean_sheets(ctx)
    assert _clean(conn, 4) is None

def test_le_piattaforme_sono_due_calendari_e_non_si_sommano(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.require_conn()
    _season(conn, 5, platform="default")
    _season(conn, 5, platform="euro")
    _match(conn, 5, 1, 0, platform="default")
    _match(conn, 5, 2, 0, platform="default")
    _match(conn, 5, 1, 0, platform="euro")
    derive_clean_sheets(ctx)
    assert _clean(conn, 5, "default") == 2
    assert _clean(conn, 5, "euro") == 1
