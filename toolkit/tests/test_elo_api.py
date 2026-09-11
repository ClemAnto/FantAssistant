"""Tests for the ClubElo API layer: the CSV parser, the alias table, and the offline re-ingest.

The alias table is the part worth testing: ClubElo writes 'Bayern', 'Man City', 'Paris SG', and
without the mapping the API silently leaves the strongest clubs of four leagues without an Elo -
which is exactly the population the LEVEL channel exists for, since a man arriving from one of them
is the case R19 prices (this used to say "the goalkeeper model", which reads measured goals conceded
and no Elo at all - see the audited reader list at the top of `elo.py`). A miss here is not a crash,
it is a quietly emptier table, so it gets an assertion.
"""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import elo

_SNAPSHOT = (
    "Rank,Club,Country,Level,Elo,From,To\n"
    "1,Liverpool,ENG,1,1993.43103027,2025-05-29,2025-08-15\n"
    "7,Inter,ITA,1,1933.51513672,2025-06-01,2025-08-21\n"
    "3,Paris SG,FRA,1,1970.07531738,2025-08-13,2025-08-17\n"
    "9,Bayern,GER,1,1920.5,2025-06-01,2025-08-21\n"
    "99,Nowhere United,ITA,1,1200.0,2025-06-01,2025-08-21\n"
    "100,Broken,ITA,1,,2025-06-01,2025-08-21\n"
)


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


def test_parse_snapshot_skips_rows_without_an_elo():
    records = elo.parse_snapshot(_SNAPSHOT)
    assert [rec["club"] for rec in records] == ["Liverpool", "Inter", "Paris SG", "Bayern",
                                                "Nowhere United"]
    assert records[0]["elo"] == 1993.43103027


def test_store_snapshot_resolves_the_short_names(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    for club_id, name, league in ((1, "Inter", "serie_a"), (2, "Paris Saint-Germain", "ligue_1"),
                                  (3, "Bayern Monaco", "bundesliga")):
        conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, ?)",
                     (club_id, name, league))
    conn.commit()
    stored, unresolved = elo.store_snapshot(conn, "2025-08-15", elo.parse_snapshot(_SNAPSHOT))
    assert stored == 3, "PSG and Bayern must resolve through ELO_ALIASES, not by luck"
    assert "Nowhere United" in unresolved and "Liverpool" in unresolved
    rows = dict(conn.execute("SELECT fc_club_id, elo FROM club_elo WHERE date = '2025-08-15'"))
    assert rows == {1: 1933.51513672, 2: 1970.07531738, 3: 1920.5}


def test_reingest_from_cache_is_offline_and_idempotent(tmp_path):
    ctx = _ctx(tmp_path)
    ctx.conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) "
                     "VALUES (1, 'Inter', 'serie_a')")
    ctx.conn.commit()
    for date in ("2024-08-15", "2025-08-15"):
        (ctx.config.cache_dir / f"clubelo_{date}.csv").write_text(_SNAPSHOT, encoding="utf-8")
    for _ in range(2):
        elo.reingest_from_cache(ctx)
        assert ctx.conn.execute("SELECT COUNT(*) FROM club_elo").fetchone()[0] == 2


def test_auction_dates_come_from_the_engine_windows(tmp_path):
    from euroleghe_ingest.engine.features import WINDOWS

    ctx = _ctx(tmp_path)
    ctx.conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'X')")
    ctx.conn.execute("INSERT INTO rosters(fc_id, season) VALUES (1, '2025-26')")
    ctx.conn.commit()
    dates = elo.auction_dates(ctx.conn, today="2026-09-01")
    assert {window.auction_date for window in WINDOWS.values()} <= set(dates)
    assert "2020-09-15" in dates, "the COVID auction date is a special case, not a computed 08-15"
    assert "2025-08-15" in dates, "the newest season's own auction date, once it has happened"


def test_the_newest_snapshot_is_dated_when_it_was_taken_and_never_in_the_future(tmp_path):
    """A sheet built during the preseason has TODAY as its auction date, and the readers take
    `MAX(date) <= auction_date` - so with only the conventional 15 August on the list, the whole
    2026-27 window read the 2025-08-15 snapshot: a club's strength a season and a transfer window
    ago, which is what `desc_level_elo` (R19) and the club card are built on. Today's date goes in
    instead, because filing a reading taken today under a day that has not happened is the one thing
    a dated fact must never do."""
    ctx = _ctx(tmp_path)
    ctx.conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'X')")
    ctx.conn.execute("INSERT INTO rosters(fc_id, season) VALUES (1, '2026-27')")
    ctx.conn.commit()

    early = elo.auction_dates(ctx.conn, today="2026-08-07")
    assert "2026-08-07" in early and "2026-08-15" not in early
    # ...and on the day itself the pre-registered date is the one taken, joining the series
    assert "2026-08-15" in elo.auction_dates(ctx.conn, today="2026-08-20")


# The mirror republishes ClubElo's own daily CSV with two columns appended, so the fallback has to
# pick a date out of one big file rather than ask for one. Same seven columns in the same order.
_MIRROR = (
    "Rank,Club,Country,Level,Elo,From,To,date,updated_at\n"
    "1,Inter,ITA,1,1900.0,2023-04-01,2023-04-20,2023-04-16,2023-04-16 18:17:58\n"
    "1,Inter,ITA,1,1910.0,2025-12-20,2026-01-20,2026-01-13,2026-01-13 10:20:15\n"
    "2,Bayern,GER,1,1990.0,2025-12-20,2026-01-20,2026-01-13,2026-01-13 10:20:15\n"
    "1,Inter,ITA,1,1925.0,2026-01-01,2026-02-08,2026-01-14,2026-01-14 10:20:15\n"
    "2,Bayern,GER,1,1996.3,2026-01-01,2026-02-08,2026-01-14,2026-01-14 10:20:15\n"
)


def test_the_mirror_serves_the_latest_reading_that_is_not_after_the_date_asked_for():
    """The fallback's whole risk is filing a reading under a date it does not belong to.

    A request for today is answered with the most recent snapshot the mirror HAS, returned together
    with the day it was observed so the caller stores that and not the request - and never with a
    later one, since a snapshot taken after an auction knows things the auction did not.
    """
    picked = elo.pick_from_mirror(_MIRROR.splitlines(), ["2026-08-07", "2026-01-13"])

    observed, payload = picked["2026-08-07"]
    assert observed == "2026-01-14", "the freshest reading at or before the request"
    # ...and what comes out is exactly what the API would have returned, parser untouched
    assert payload.splitlines()[0] == "Rank,Club,Country,Level,Elo,From,To"
    assert {rec["club"]: rec["elo"] for rec in elo.parse_snapshot(payload)} == {
        "Inter": 1925.0, "Bayern": 1996.3}

    assert picked["2026-01-13"][0] == "2026-01-13", "an earlier request is not served the newer day"
    assert elo.parse_snapshot(picked["2026-01-13"][1])[0]["elo"] == 1910.0


def test_a_date_the_mirror_cannot_reach_is_absent_and_not_approximated():
    """The mirror starts in 2023 and the ten gate windows are cached in full, so the honest answer
    for an older date is nothing at all - «vuoto = ignoto» applied to a date. Filling it with the
    closest thing available would put a 2023 reading inside a 2016 window."""
    assert elo.pick_from_mirror(_MIRROR.splitlines(), ["2016-08-15"]) == {}


def test_paris_fc_is_not_paris_saint_germain():
    """The guard that cost a wrong number to find, and the reason this matcher exists at all.

    Stripping the corporate noise reduced «Paris FC» to the single token `paris`, a subset of «Paris
    Saint-Germain», and the match came out UNIQUE - so Gonçalo Ramos's three PSG seasons were priced
    at a Ligue 2 club and he read 1472, below every Milan forward. An ambiguous match is worse than a
    missing one: a missing Elo leaves a man unknown, a wrong one hands him another club's strength.
    """
    theirs = ["Paris FC", "Paris SG", "Milan", "Bayern", "Man City", "Leverkusen"]
    index = elo.match_club_names(theirs, ["Paris Saint-Germain", "AC Milan", "FC Bayern München",
                                          "Manchester City", "Paris FC"])

    assert index.get("Paris Saint-Germain") == "Paris SG", "the initials are a name: sg = saint germain"
    assert index.get("Paris FC") == "Paris FC", "and the real Paris FC still finds itself"
    # ...while the one-generic-token guard does not cost the abbreviations that are legitimate
    assert index["AC Milan"] == "Milan"
    assert index["FC Bayern München"] == "Bayern"
    assert index["Manchester City"] == "Man City"


def test_the_level_of_a_club_is_read_by_ID_and_never_by_name(tmp_path):
    """The operator's rule, and this project's own: «risalire alla squadra solo da un id squadra unico».

    The name comparison happens ONCE, at ingest, and what it leaves behind is a row keyed on the
    PROVIDER'S TEAM ID. Every read then goes through that id, so a spelling can no longer put a man at
    the wrong club - which is what «Paris FC» did to three of Gonçalo Ramos's seasons.
    """
    ctx = _ctx(tmp_path)
    (ctx.config.cache_dir / "clubelo_2025-08-15.csv").write_text(
        "Rank,Club,Country,Level,Elo,From,To\n"
        "1,Paris SG,FRA,1,1970.0,2025-06-01,2025-08-21\n"
        "2,Paris FC,FRA,2,1405.0,2025-06-01,2025-08-21\n", encoding="utf-8")
    (ctx.config.cache_dir / "sofascore_stats_ligue_1_2025-26.json").write_text(
        '[{"player": {"id": 1, "name": "X"}, "team": {"id": 1644, "name": "Paris Saint-Germain"}},'
        ' {"player": {"id": 2, "name": "Y"}, "team": {"id": 1641, "name": "Paris FC"}}]',
        encoding="utf-8")

    written, refused = elo.derive_elo_xref(ctx.conn, ctx)
    assert written == 2 and not refused

    levels = elo.elo_by_provider_club(ctx.conn, ctx)
    assert levels["1644"]["2025"] == 1970.0, "PSG's id must reach PSG's level"
    assert levels["1641"]["2025"] == 1405.0, "...and Paris FC's its own, which is the whole point"


def test_an_ambiguous_club_name_is_left_unknown_rather_than_guessed():
    """Two candidates and no way to choose is «vuoto = ignoto», not a coin toss."""
    index = elo.match_club_names(["Lech", "Lechia"], ["Lech Poznan"])
    assert "Lech Poznan" not in index


def test_the_mirror_changing_shape_is_an_error_and_not_a_silent_empty():
    """If the columns move, every date would come back empty and `club_elo` would just stay as it
    was - a fallback that fails looking like a fallback that had nothing to add."""
    import pytest

    with pytest.raises(ValueError, match="columns"):
        elo.pick_from_mirror(["Team,Rating,day\n", "Inter,1900,2026-01-14\n"], ["2026-08-07"])


def test_the_archive_serves_the_snapshot_at_or_before_the_date_asked():
    """`pick_from_archive`: la stessa disciplina del ripiego che sostituisce, su un formato diverso.

    A O PRIMA e mai dopo: l'Elo del giorno d'asta e' quello che valeva quel giorno, e uno snapshot
    successivo conterrebbe partite che quel giorno non erano state giocate - cioe' del futuro dentro
    una finestra che il gate misura.
    """
    lines = [
        "date,club,country,elo",
        "2026-08-15,Arsenal,ENG,2050.5", "2026-08-15,Napoli,ITA,1830.0",
        "2026-09-01,Arsenal,ENG,2060.0", "2026-09-01,Napoli,ITA,1840.0",
        "2027-01-01,Arsenal,ENG,9999.0",
    ]
    got = elo.pick_from_archive(iter(lines), ["2026-08-20", "2026-09-11", "2020-01-01"])
    assert got["2026-08-20"][0] == "2026-08-15", "il piu' vicino PRECEDENTE"
    assert got["2026-09-11"][0] == "2026-09-01"
    assert "2020-01-01" not in got, "prima del primo snapshot non si inventa niente"
    assert all(observed <= asked for asked, (observed, _csv) in got.items()), "mai uno successivo"


def test_the_archive_names_are_bridged_to_the_API_s_own():
    """L'archivio ha RINOMINATO i club nella convenzione dei match data, e il ponte lo cura.

    `Bayern Munich` dove ClubElo scrive `Bayern`, `Ath Bilbao` dove scrive `Bilbao`, `Ein Frankfurt`
    dove scrive `Frankfurt`: alla prima corsa quattro club del listone restarono senza Elo, e sono i
    grossi. Il ponte si deriva incrociando una data che ha ENTRAMBE le fonti - stesso giorno, stesso
    paese, stesso Elo = stesso club - e poi vale per qualunque data.

    LO STESSO GIORNO E' LA CONDIZIONE, ed e' l'errore che la prima versione ha fatto: incrociava
    (paese, Elo) di date DIVERSE e non agganciava niente, perche' l'Elo si muove. Da 43 club del
    listone a 46 su 47.
    """
    lines = ["date,club,country,elo",
             "2024-08-15,Bayern Munich,GER,1900.0", "2024-08-15,Napoli,ITA,1800.0",
             "2026-08-15,Bayern Munich,GER,1950.0", "2026-08-15,Napoli,ITA,1830.0"]
    api = {"2024-08-15": {("GER", 1900.0): "Bayern", ("ITA", 1800.0): "Napoli"}}
    got = elo.pick_from_archive(iter(lines), ["2026-08-15"], api)
    names = [r["club"] for r in elo.parse_snapshot(got["2026-08-15"][1])]
    assert names == ["Bayern", "Napoli"], "tradotto su una data dove l'API non c'e'"
    # senza ponte il club NON sparisce: resta col proprio nome e finira' fra gli irrisolti stampati
    plain = elo.pick_from_archive(iter(lines), ["2026-08-15"], None)
    assert [r["club"] for r in elo.parse_snapshot(plain["2026-08-15"][1])] == ["Bayern Munich", "Napoli"]


def test_a_name_two_dates_translate_differently_is_not_a_translation():
    """Meglio nessuna traduzione che una scelta a caso fra due: il club resta col proprio nome."""
    bridge = elo.name_bridge(
        {"d1": [("X", "ITA", 1000.0)], "d2": [("X", "ITA", 2000.0)]},
        {"d1": {("ITA", 1000.0): "Alpha"}, "d2": {("ITA", 2000.0): "Beta"}})
    assert "X" not in bridge
    one = elo.name_bridge({"d1": [("Y", "ITA", 1000.0)]}, {"d1": {("ITA", 1000.0): "Alpha"}})
    assert one == {"Y": "Alpha"}


def test_the_archive_writes_the_API_s_own_columns_and_leaves_the_level_empty():
    """Il ripiego produce un file che `parse_snapshot` legge senza sapere da dove viene.

    E il LIVELLO resta vuoto perche' l'archivio non lo porta: non entra in `club_elo` - lo legge solo
    la segnalazione «questo club di prima divisione non e' mappato» - quindi la conseguenza e' che da
    questa fonte quella segnalazione TACE invece di sbagliare. Un livello inventato la accenderebbe su
    club che nessuno ha classificato, ed e' «vuoto = ignoto» applicato a una colonna di servizio.
    """
    lines = ["date,club,country,elo", "2026-08-15,Napoli,ITA,1830.0", "2026-08-15,Arsenal,ENG,2050.5"]
    _observed, payload = elo.pick_from_archive(iter(lines), ["2026-08-15"], None)["2026-08-15"]
    assert payload.splitlines()[0].split(",") == list(elo.MIRROR_COLUMNS)
    rows = elo.parse_snapshot(payload)
    assert [r["club"] for r in rows] == ["Arsenal", "Napoli"], "ordinati per Elo, che E' il rank"
    assert all(r["level"] == "" for r in rows)
    assert rows[0]["country"] == "ENG" and rows[0]["elo"] == 2050.5


def test_the_two_fallbacks_are_ordered_by_freshness_and_the_old_one_is_marked():
    """L'archivio prima, il mirror dopo - e il secondo vede solo cio' che il primo non ha coperto.

    L'ordine e' la freschezza misurata l'11/09/2026: l'archivio era al 1º settembre, il mirror fermo
    al 14/01/2026. Quello vecchio resta come SECONDA rete finche' il primo non ha una storia, ed e'
    marcato deprecato nel modulo con la data - due fonti di terzi che si spengono nello stesso
    trimestre sono improbabili, e tenerlo costa una funzione che quasi nessuno chiama.
    """
    import inspect
    source = inspect.getsource(elo)
    archive = source.index("fetch_from_archive(ctx, missing)")
    mirror = source.index("fetch_from_mirror(ctx, missing)")
    assert archive < mirror, "l'archivio si prova per primo"
    assert "DEPRECATO" in source, "il ripiego vecchio dice di esserlo"
