"""Il perimetro di una pagina e' quello della PAGINA, e per un anno e' stato quello di un'altra.

`_season_pools` filtrava `r.league = 'serie_a'` e la sua docstring lo dichiarava - «these pages are Serie
A» - il che era vero fino al 07/08/2026, quando sono state agganciate le pagine euro. Da quel giorno un
infortunato di Premier, Liga, Ligue 1 o Bundesliga non poteva combaciare PER COSTRUZIONE, perche' nel
pool dei candidati non c'era un solo giocatore di quelle leghe: si risolvevano soltanto gli uomini quotati
ANCHE in Serie A.

Misurato sulla pagina vera del 26/08/2026: **24 righe su 88** prima, **87 su 88** dopo, con la Serie A
ferma a 43/43. E i nomi scartati stavano nel registro col nome identico e col club identico a quello che
la pagina dichiarava (Bruno Guimaraes/Arsenal, Baleba/Manchester United, Asencio/Real Madrid), che e' la
ragione per cui la storia plausibile - «e' un buco di identita' sui trasferiti» - era sbagliata: le
identita' erano state rilette poche ore prima e non era cambiato niente.

Due meta', perche' una correzione che allarga un pool deve anche NON allargare quello di prima.
"""

from __future__ import annotations

from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import fc_site

SEASON = "2026-27"


def _db(tmp_path):
    conn = init_db(tmp_path / "pools.db")
    clubs = {1: ("Inter", "serie_a"), 2: ("Arsenal", "premier_league")}
    for club_id, (name, league) in clubs.items():
        conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, ?)",
                     (club_id, name, league))
    men = [
        # (fc_id, nome, club, campionato, quotato su euro, quotato su default)
        (1, "Lautaro", 1, "serie_a", True, True),
        (2, "Bruno Guimaraes", 2, "premier_league", True, False),
    ]
    for fc_id, name, club_id, league, on_euro, on_default in men:
        conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", (fc_id, name))
        conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic) "
                     "VALUES (?, ?, ?, ?, 'A')", (fc_id, SEASON, club_id, league))
        for platform, quoted in (("euro", on_euro), ("default", on_default)):
            if quoted:
                conn.execute("INSERT INTO listone_quotes(fc_id, season, platform, price_initial) "
                             "VALUES (?, ?, ?, 20)", (fc_id, SEASON, platform))
    conn.commit()
    return conn


def test_un_infortunato_di_premier_si_aggancia_sulla_pagina_euro(tmp_path):
    conn = _db(tmp_path)
    records = [{"name": "Bruno Guimaraes", "team": "Arsenal", "status": "injured"}]
    stored, unresolved, _dated = fc_site.upsert_availability(conn, records, SEASON, "2026-08-26", "euro")
    assert (stored, unresolved) == (1, []), "il pool euro contiene i quotati di QUEL listone"
    assert conn.execute("SELECT fc_id, status FROM availability").fetchone()[0] == 2


def test_e_la_pagina_di_serie_A_non_si_allarga(tmp_path):
    """L'altra meta': la cura non deve portare uno straniero nel pool della pagina italiana.

    Serve perche' un pool piu' largo aggiunge omonimi, e il matcher accetta solo un candidato UNICO:
    allargare la pagina sbagliata non darebbe un errore, darebbe righe in meno senza dirlo.
    """
    conn = _db(tmp_path)
    records = [{"name": "Bruno Guimaraes", "team": "Arsenal", "status": "injured"}]
    stored, unresolved, _dated = fc_site.upsert_availability(conn, records, SEASON, "2026-08-26")
    assert (stored, unresolved) == (0, ["Bruno Guimaraes (Arsenal)"])
    # ...e l'italiano si aggancia comunque, sulla sua pagina
    stored, unresolved, _dated = fc_site.upsert_availability(
        conn, [{"name": "Lautaro", "team": "Inter", "status": "injured"}], SEASON, "2026-08-26")
    assert (stored, unresolved) == (1, [])
