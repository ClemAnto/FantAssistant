"""Uno ZERO di quella curva non e' un valore, e un rivale a zero non e' un rivale.

Il 26/08/2026 la fase dei fogli e' morta su `ZeroDivisionError: float division by zero` alla PRIMA delle
tre leghe, quindi nessun foglio e' stato scritto - e `export` avrebbe imbarcato i piu' recenti che
trovava, quelli del 20/08, con la data di oggi sul bundle. La causa e' una riga sola di
`features.load`: la guardia chiedeva «ci sono rivali?» e non «i rivali hanno un valore?», e con TUTTI i
compagni che condividono un codice mantra a zero, `max(rivali)` da' zero.

Perche' capiti servono uomini a zero, e ce ne sono: misurato quel giorno, **531** quotati hanno l'ultimo
punto della curva a zero entro la data d'asta - Immobile, Milner, Umtiti, Florenzi, Varane, Zouma - perche'
Transfermarkt azzera chi si e' ritirato o e' senza contratto. Il commento accanto alla riga diceva gia' la
cosa giusta («senza rivali leggibili il TAPPO, non uno zero»): mancava che «rivali» volesse dire «rivali
leggibili».

La correzione non tocca nessun numero dove prima un numero c'era: `max()` ignora i valori piu' piccoli, e
zero e' il minimo possibile, quindi togliere gli zeri cambia il massimo solo quando erano TUTTI zero -
cioe' esattamente il caso che sollevava. Il test inchioda le due meta'.
"""

from __future__ import annotations

from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.engine import features


def _db(tmp_path):
    """Due club: uno di soli ritirati che condividono la maglia, uno con un rivale vero."""
    conn = init_db(tmp_path / "peers.db")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (10, 'Inter', 'serie_a')")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (20, 'Milan', 'serie_a')")
    men = [
        # (fc_id, nome, club, codici mantra, valore all'ultimo punto della curva)
        (1, "Ritirato A", 10, "pc", 0.0),
        (2, "Ritirato B", 10, "pc", 0.0),
        (3, "Vale poco", 20, "pc", 5.0),
        (4, "Vale molto", 20, "pc", 20.0),
    ]
    for fc_id, name, club, roles, worth in men:
        conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", (fc_id, name))
        for season in ("2025-26", "2026-27"):
            conn.execute(
                "INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic, roles, "
                "price_initial) VALUES (?, ?, ?, 'serie_a', 'A', ?, 20)", (fc_id, season, club, roles))
            conn.execute("INSERT INTO listone_quotes(fc_id, season, platform, price_initial) "
                         "VALUES (?, ?, 'default', 20)", (fc_id, season))
        conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) "
                     "VALUES (?, '2025-26', 'default', 30, 6.0, 6.5)", (fc_id,))
        conn.execute("INSERT INTO market_value_history(fc_id, observed_on, source, value) "
                     "VALUES (?, '2026-07-01', 'transfermarkt', ?)", (fc_id, worth))
    conn.commit()
    return conn


def _peers(conn):
    window = features.Window("SNAP", "2025-26", "2026-27", "2026-08-26")
    data = features.prepare(conn, window, "default", "classic")
    return {obs.fc_id: obs.peer_top for obs in data.observations}


def test_un_reparto_di_soli_ritirati_non_solleva_e_legge_il_TAPPO(tmp_path):
    peers = _peers(_db(tmp_path))
    # I due a zero: nessun rivale LEGGIBILE, quindi il tappo - la stessa risposta che avrebbero se
    # fossero soli in rosa, ed e' quello che il commento accanto alla riga prometteva da sempre.
    assert peers[1] == features.PEER_TOP_CAP
    assert peers[2] == features.PEER_TOP_CAP


def test_dove_un_rivale_ha_un_valore_il_rapporto_non_cambia(tmp_path):
    peers = _peers(_db(tmp_path))
    # 5 contro 20: un quarto del piu' caro che gli contende la maglia. E il piu' caro legge il tappo,
    # perche' 20/5 = 4 e il tappo sta sotto.
    assert abs(peers[3] - 0.25) < 1e-9
    assert peers[4] == features.PEER_TOP_CAP
