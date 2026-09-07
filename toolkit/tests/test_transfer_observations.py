"""`first_seen` sopravvive alla purga di `transfers_history` - l'unica data vera che la tabella ha.

Richiesta dell'operatore, 07/09/2026: «i trasferimenti devono essere aggiornati in maniera affidabile».
La tabella e' un DIFF fra rose e la sua colonna `date` e' SINTETIZZATA (`{anno}-07-01`: 6019 righe su
quattro date distinte), quindi l'unico modo di ordinare due movimenti dello stesso uomo nella stessa
finestra e' la data in cui li abbiamo OSSERVATI. E quella si perdeva due volte: l'mtime del file di cache
la porta a oggi a ogni ri-scaricamento, e il `DELETE FROM transfers_history` che precede la ri-ingestione
faceva si' che l'`ON CONFLICT` che tiene il minimo non vedesse mai il valore vecchio.

Misurato sul DB vivo prima della cura: 1239 righe della finestra 2026 con `first_seen` = 2026-09-07 e
**274 uomini su 274** con due movimenti in quella finestra non ordinabili - cioe' Cheddira, che quell'estate
e' arrivato dal Lecce ed e' andato all'Avellino, e le cui due righe sono indistinguibili nel tempo.
"""

from __future__ import annotations

import sqlite3

from euroleghe_ingest.modules import transfers


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE transfers_history (fc_id INTEGER, date TEXT, from_club TEXT, "
                 "to_club TEXT, from_league TEXT, to_league TEXT, fee REAL, first_seen TEXT)")
    return conn


def _add(conn, fc_id, to_club, first_seen, date="2026-07-01", from_club="Lecce"):
    conn.execute("INSERT INTO transfers_history (fc_id, date, from_club, to_club, first_seen) "
                 "VALUES (?, ?, ?, ?, ?)", (fc_id, date, from_club, to_club, first_seen))


def test_the_observation_date_survives_the_purge_that_rebuilds_the_table():
    conn = _db()
    _add(conn, 6439, "Napoli", "2026-08-01")                       # visto ad agosto
    remembered = transfers.remember_observations(conn)

    # la purga e la ri-ingestione, con l'mtime di OGGI su ogni riga: e' il difetto
    conn.execute("DELETE FROM transfers_history")
    _add(conn, 6439, "Napoli", "2026-09-07")
    assert conn.execute("SELECT first_seen FROM transfers_history").fetchone()[0] == "2026-09-07", (
        "il difetto e' rimesso: senza il ripristino la riga dice «vista oggi»")

    assert transfers.restore_observations(conn, remembered) == 1
    assert conn.execute("SELECT first_seen FROM transfers_history").fetchone()[0] == "2026-08-01"


def test_two_moves_in_one_window_become_orderable():
    """Il caso che il segnale forte non vedeva: arrivato e ripartito nella stessa estate."""
    conn = _db()
    _add(conn, 6439, "Napoli", "2026-08-01")                       # l'arrivo, visto ad agosto
    remembered = transfers.remember_observations(conn)
    conn.execute("DELETE FROM transfers_history")
    _add(conn, 6439, "Napoli", "2026-09-07")                       # rivisto oggi
    _add(conn, 6439, "US Avellino 1912", "2026-09-07", from_club="Napoli")   # la partenza, NUOVA
    transfers.restore_observations(conn, remembered)
    seen = dict(conn.execute("SELECT to_club, first_seen FROM transfers_history"))
    assert seen == {"Napoli": "2026-08-01", "US Avellino 1912": "2026-09-07"}, (
        "l'arrivo tiene la sua data, la partenza porta quella in cui e' comparsa: ordinabili")


def test_a_row_the_re_ingest_did_not_rewrite_does_not_come_back():
    """La purga serve - toglie quello che una vecchia regola di risoluzione aveva scritto - e continua."""
    conn = _db()
    _add(conn, 111, "Grafia Vecchia", "2026-08-01")
    remembered = transfers.remember_observations(conn)
    conn.execute("DELETE FROM transfers_history")
    _add(conn, 111, "Grafia Canonica", "2026-09-07")
    assert transfers.restore_observations(conn, remembered) == 0
    assert conn.execute("SELECT to_club, first_seen FROM transfers_history").fetchall() == [
        ("Grafia Canonica", "2026-09-07")]


def test_an_observation_already_earlier_is_not_raised():
    conn = _db()
    _add(conn, 222, "Napoli", "2026-07-27")
    remembered = transfers.remember_observations(conn)
    conn.execute("DELETE FROM transfers_history")
    _add(conn, 222, "Napoli", "2026-07-01")                        # una lettura ancora piu' vecchia
    assert transfers.restore_observations(conn, remembered) == 0, "il minimo non si alza mai"
    assert conn.execute("SELECT first_seen FROM transfers_history").fetchone()[0] == "2026-07-01"
