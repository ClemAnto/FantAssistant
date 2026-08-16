"""La finestra IN-SEASON: che cosa il modello puo' leggere e che cosa deve prevedere.

E' la meta' fragile del gate 7-duotricies. Con la data d'asta dentro la stagione bersaglio, l'esito
`pv_act` conterrebbe le giornate che il modello ha appena letto: un canale che le ricopiasse sembrerebbe
bravissimo per una parte di stagione gia' successa. Qui si inchioda che la separazione avvenga, e che su
una finestra PRE-STAGIONE non cambi assolutamente niente.
"""

from __future__ import annotations

from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.engine import features


def _db(tmp_path):
    conn = init_db(tmp_path / "t.db")
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'Titolare')")
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (2, 'Rotto a settembre')")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (10, 'Inter', 'serie_a')")
    for fc_id in (1, 2):
        for season in ("2024-25", "2025-26"):
            conn.execute(
                "INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic, price_initial) "
                "VALUES (?, ?, 10, 'serie_a', 'C', 20)", (fc_id, season))
            conn.execute(
                "INSERT INTO listone_quotes(fc_id, season, platform, price_initial) "
                "VALUES (?, ?, 'default', 20)", (fc_id, season))
        conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) "
                     "VALUES (?, '2024-25', 'default', 30, 6.0, 6.5)", (fc_id,))
    # Quattro giornate, due prima del taglio e due dopo. Il 2 jolly gioca solo le prime due.
    for md, date in ((1, "2025-08-24"), (2, "2025-08-31"), (3, "2025-09-14"), (4, "2025-09-21")):
        for fc_id in (1, 2):
            if fc_id == 2 and md > 2:
                continue
            conn.execute(
                "INSERT INTO match_ratings(fc_id, season, matchday, platform, status, mv, fantavoto) "
                "VALUES (?, '2025-26', ?, 'default', 'played', 6.0, ?)", (fc_id, md, 7.0 if md > 2 else 5.0))
        conn.execute(
            "INSERT INTO external_match_stats(fc_id, match_id, season, source, competition, real_md, "
            "match_date) VALUES (1, ?, '2025-26', 'sofascore', 'serie_a', ?, ?)", (900 + md, md, date))
    conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) "
                 "VALUES (1, '2025-26', 'default', 4, 6.0, 6.0)")
    conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) "
                 "VALUES (2, '2025-26', 'default', 2, 6.0, 5.0)")
    conn.commit()
    return conn


def test_una_finestra_in_season_prevede_il_RESTO_e_legge_quello_che_e_gia_successo(tmp_path):
    conn = _db(tmp_path)
    window = features.Window("SET", "2024-25", "2025-26", "2025-09-05")
    data = features.prepare(conn, window, "default", "classic")

    assert data.matchdays_seen == 2, "due giornate erano gia' state giocate il 5 settembre"
    assert data.matchdays_target == 2, "e il bersaglio sono le DUE che restano, non le quattro"
    men = {obs.fc_id: obs for obs in data.observations}
    # Quello che il modello puo' leggere: e' pubblico, lo vede chiunque al tavolo.
    assert men[1].pv_seen == 2 and men[2].pv_seen == 2
    # ...e quello che deve prevedere: solo il dopo. Chi non gioca piu' vale ZERO presenze - e' un esito -
    # ma non ha una media, perche' una media su zero partite non esiste.
    assert men[1].pv_act == 2 and men[1].fm_act == 7.0
    assert men[2].pv_act == 0 and men[2].fm_act is None


def test_una_finestra_PRE_STAGIONE_non_cambia_di_una_virgola(tmp_path):
    """La garanzia che tiene fermi i dieci numeri pubblicati: senza giornate giocate, tutto com'era."""
    conn = _db(tmp_path)
    window = features.Window("PRE", "2024-25", "2025-26", "2025-08-15")
    data = features.prepare(conn, window, "default", "classic")

    assert data.matchdays_seen == 0
    assert data.matchdays_target == 4, "il bersaglio e' la stagione intera"
    men = {obs.fc_id: obs for obs in data.observations}
    assert men[1].pv_seen is None, "«vuoto = ignoto»: la domanda non esiste su una pre-stagione"
    assert men[1].pv_act == 4, "l'esito e' il totale di stagione, come sempre"
    assert men[2].pv_act == 2
