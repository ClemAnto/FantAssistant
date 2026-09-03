"""Il CLUB del listone e' un fatto di PIATTAFORMA, come il prezzo (03/09/2026).

Il prezzo era stato spostato in `listone_quotes` il 07/08/2026; il club era rimasto in `rosters`, che
tiene una riga per (fc_id, season) - quindi per un uomo quotato su tutt'e due i listoni l'ultimo
download decideva a quale club stesse, e `ratings:euro` gira dopo `ratings:default`. Misurato sul
foglio Serie A 2026-27: 221 dei 289 quotati su entrambi portavano in `rosters.price` esattamente il
prezzo EURO, e cinque quotati Serie A erano filati a Bournemouth, Aston Villa, Bayer, Lipsia e
Stoccarda - quindi `perimeter_clubs` li metteva fuori dal campionato che li quota.

E la `league` era peggio: l'upsert scriveva `COALESCE(rosters.league, excluded.league)`, cioe' il
PRIMO valore mai scritto si congelava e nessuna rilettura poteva correggerlo.
"""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import ratings, snapshot


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


def _rec(fc_id, name, team, price, role="P"):
    return {"fc_id": fc_id, "name": name, "team": team, "roles": [role.lower()],
            "role_classic": role, "price": price, "price_initial": price,
            "fvm": price * 3, "fvm_mantra": None, "price_mantra": None,
            "price_initial_mantra": None}


def test_the_two_listoni_keep_their_own_club_and_their_own_price(tmp_path):
    """Lo stesso uomo, due listoni, due club: nessuno dei due cancella l'altro."""
    ctx = _ctx(tmp_path)
    # the Serie A listone quotes him at Como for 8...
    ratings.upsert_listone(ctx.conn, "2026-27", [_rec(6344, "Sanchez Ro.", "Como", 8.0)],
                           "default")
    # ...and the EuroLeghe one, downloaded AFTER, has him at Chelsea for 9
    ratings.upsert_listone(ctx.conn, "2026-27", [_rec(6344, "Sanchez Ro.", "Chelsea", 9.0)],
                           "euro")
    rows = {platform: (club, league, price) for platform, club, league, price in ctx.conn.execute(
        "SELECT q.platform, c.canonical_name, q.league, q.price FROM listone_quotes q "
        "JOIN clubs c ON c.fc_club_id = q.fc_club_id WHERE q.fc_id = 6344")}
    assert rows["default"] == ("Como", "serie_a", 8.0)
    assert rows["euro"][0] == "Chelsea" and rows["euro"][2] == 9.0
    # ...and the perimeter of each platform sees him at ITS OWN club
    assert "Como" in _perimeter(ctx, "default")
    assert "Chelsea" in _perimeter(ctx, "euro")
    assert "Chelsea" not in _perimeter(ctx, "default")


def _perimeter(ctx, platform):
    """The perimeter with the squad minimum lowered: this fixture has one man, not eleven."""
    keep = snapshot.PERIMETER_SQUAD_MIN
    snapshot.PERIMETER_SQUAD_MIN = 1
    try:
        return snapshot.perimeter_clubs(ctx.conn, platform, ("2026-27",))
    finally:
        snapshot.PERIMETER_SQUAD_MIN = keep


def test_a_reread_can_correct_the_league_instead_of_freezing_it(tmp_path):
    """`COALESCE(rosters.league, excluded.league)` congelava il primo valore per sempre."""
    ctx = _ctx(tmp_path)
    ratings.upsert_listone(ctx.conn, "2026-27", [_rec(6344, "Sanchez Ro.", "Chelsea", 9.0)],
                           "euro")
    assert ctx.conn.execute("SELECT league FROM rosters WHERE fc_id = 6344").fetchone()[0] != "serie_a"
    ratings.upsert_listone(ctx.conn, "2026-27", [_rec(6344, "Sanchez Ro.", "Como", 8.0)],
                           "default")
    assert ctx.conn.execute(
        "SELECT league FROM rosters WHERE fc_id = 6344").fetchone()[0] == "serie_a", (
        "a later read must be able to correct the league, not find it frozen")


def test_the_columns_are_inert_on_a_row_written_before_they_existed(tmp_path):
    """Nessuna finestra pubblicata si muove finche' nessuno riempie lo storico: il COALESCE regge."""
    ctx = _ctx(tmp_path)
    ratings.upsert_listone(ctx.conn, "2026-27", [_rec(6344, "Sanchez Ro.", "Como", 8.0)],
                           "default")
    ctx.conn.execute("UPDATE listone_quotes SET fc_club_id = NULL, league = NULL")
    peri = _perimeter(ctx, "default")
    assert peri == {"Como"}, "senza le colonne nuove il perimetro torna a leggere `rosters`"


def test_a_quoted_man_the_provider_sees_abroad_stays_in_the_population(tmp_path):
    """Cadeva fuori da ENTRAMBI i rami di `squad_source='squad'` (03/09/2026).

    Il primo ramo prende chi la fonte colloca in un club del campionato; il secondo prendeva chi la
    fonte non ha MAI visto. Un uomo che la fonte vede in un club ESTERO non soddisfa nessuno dei due, e
    cosi' 35 quotati Serie A erano assenti dal foglio - 7 dei quali la pagina probabili di quel giorno
    dava titolari: Woltemade (23 crediti, dato al Newcastle e schierato dalla Juventus), Beto (14,
    dato all'Everton e schierato dalla Fiorentina), Sanchez Ro., Mbangula, Sarr P.

    La regola dell'operatore del 17/08 («l'autorita' su chi e' in rosa e' la fonte») serve a leggere
    un'ASSENZA da un club; usarla per affermare un club estero contro il listone che lo quota la porta
    fuori dal suo dominio. Essere quotato su QUESTO listone e' prova positiva di essere in QUESTO
    campionato, e la contraddizione si riporta (`desc_live_club`) invece di cancellare la riga.
    """
    from euroleghe_ingest.engine import features
    ctx = _ctx(tmp_path)
    ratings.upsert_listone(ctx.conn, "2026-27", [_rec(6344, "Sanchez Ro.", "Como", 8.0)], "default")
    ratings.upsert_listone(ctx.conn, "2026-27", [_rec(7000, "Butez", "Como", 15.0)], "default")
    # il campionato esiste per la piattaforma
    ctx.conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, platform, team) "
                     "VALUES (7000, '2026-27', 1, 'default', 'Como')")
    # ...e la fonte, letta oggi, lo vede al Chelsea
    ctx.conn.execute("INSERT INTO squad_snapshot(fc_id, club, valid_from, source) "
                     "VALUES (6344, 'Chelsea', '2026-09-01', 'sofascore')")
    ctx.conn.commit()
    window = features.Window(key="live", input_season="2025-26", target_season="2026-27",
                             auction_date="2026-09-01")
    seen = {o.fc_id: o for o in features.load(ctx.conn, window, "default", squad_source="squad")}
    assert 6344 in seen, "un quotato che la fonte vede all'estero deve restare nella popolazione"
    assert seen[6344].price == 8.0, "col prezzo del SUO listone"
    # e una volta sola, non due
    ids = [o.fc_id for o in features.load(ctx.conn, window, "default", squad_source="squad")]
    assert ids.count(6344) == 1, "i due rami non devono duplicarlo"


def test_the_provider_still_decides_where_it_sees_him_inside_the_championship(tmp_path):
    """La meta' della regola del 17/08 che RESTA: dentro il campionato l'autorita' e' la fonte."""
    from euroleghe_ingest.engine import features
    ctx = _ctx(tmp_path)
    ratings.upsert_listone(ctx.conn, "2026-27", [_rec(5000, "Molina", "Atalanta", 10.0, "D")],
                           "default")
    for i, club in enumerate(("Atalanta", "Roma")):
        ctx.conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                         (9100 + i, f"filler{i}"))
        ctx.conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, platform, team) "
                         "VALUES (?, '2026-27', 1, 'default', ?)", (9100 + i, club))
    ctx.conn.execute("INSERT INTO clubs(canonical_name, league) VALUES ('Roma', 'serie_a')")
    ctx.conn.execute("INSERT INTO squad_snapshot(fc_id, club, valid_from, source) "
                     "VALUES (5000, 'Roma', '2026-08-14', 'sofascore')")
    ctx.conn.commit()
    window = features.Window(key="live", input_season="2025-26", target_season="2026-27",
                             auction_date="2026-09-01")
    seen = {o.fc_id: o for o in features.load(ctx.conn, window, "default", squad_source="squad")}
    assert seen[5000].club_target == "Roma", (
        "dentro il campionato la fonte decide dove sta: e' la regola dell'operatore del 17/08")
