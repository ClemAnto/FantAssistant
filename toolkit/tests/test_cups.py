"""A mid-season continental cup: the declared window, the identity it joins on, the measured penalty.

The three facts are deliberately of three different kinds and each test says which one it is about:
the CALENDAR is declared (verified against the public record), the NATIONALITY is an identity read from
payloads we already cache, and WHAT IT COSTS is measured. What must never happen is any of them being
guessed - a call-up list does not exist in August, and the measured coefficient exists precisely so
that nobody has to invent one.
"""

from __future__ import annotations

import json

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.engine import cups
from euroleghe_ingest.modules import positions, snapshot

DECLARED = {
    "cups": {
        "asian_cup_2027": {
            "name": "Coppa d'Asia 2027", "confederation": "AFC",
            "start": "2027-01-07", "end": "2027-02-05", "seasons": ["2026-27"],
            "qualified": ["Japan", "Australia"],
        },
        "afcon_2025": {
            "name": "Coppa d'Africa 2025", "confederation": "CAF",
            "start": "2025-12-21", "end": "2026-01-18", "seasons": ["2025-26"],
        },
        # malformed on purpose: no dates. It must be DROPPED, not defaulted - a window with half a date
        # would expose nobody while looking like a working feature.
        "broken": {"name": "Nowhere Cup", "confederation": "CAF"},
    },
    "confederations": {"AFC": ["Japan", "Australia", "Indonesia"], "CAF": ["Senegal", "Morocco"]},
}


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


def test_a_malformed_window_is_dropped_and_never_defaulted():
    parsed, membership = cups.parse(DECLARED)
    assert set(parsed) == {"asian_cup_2027", "afcon_2025"}
    assert membership["Japan"] == "AFC" and membership["Senegal"] == "CAF"
    # ...and an empty file reads as «no rulebook», the treatment the two module files already get
    assert cups.parse({}) == ({}, {})


def test_the_qualified_field_excludes_and_an_unknown_field_does_not():
    """A declared field is a filter; a missing one is «ignoto» and must not exclude anybody."""
    parsed, _membership = cups.parse(DECLARED)
    asia, africa = parsed["asian_cup_2027"], parsed["afcon_2025"]
    assert asia.covers("Japan") and not asia.covers("Indonesia")   # Indonesia is AFC and not in the field
    assert africa.covers("Senegal") and africa.covers("Morocco")   # no field declared: nobody excluded
    assert not asia.covers(None)


def test_only_the_measured_profiles_carry_a_penalty():
    """A confederation whose cup has never fallen inside a European season has no measured loss, and a
    borrowed coefficient would be a fitted number outside its own population."""
    assert cups.loss_share("AFC", True) == cups.loss_share("AFC", False) == 0.59
    assert cups.loss_share("CAF", True) > cups.loss_share("CAF", False)
    assert cups.loss_share("CONMEBOL", True) is None
    # ...and the Asian Cup is worth about twice the Africa Cup in every band, which is the measurement
    # and not a preference: the passport predicts the call-up far better in Asia.
    for band, floor in cups.BANDS:
        share = floor + 0.01
        assert cups.loss_share("AFC", True, share) > cups.loss_share("CAF", True, share), band


def test_each_band_gets_the_coefficient_measured_on_its_own_population():
    """«Penalità a tutti» done by MEASURING each band, not by trimming the regulars' number.

    The three populations are cut on his own expected share of the calendar, and the coefficient comes
    from the band - so a squad player is charged what squad players were measured to lose (0.05 of the
    window on AFC) instead of the regulars' 0.59 capped by a rule of thumb.
    """
    parsed, membership = cups.parse(DECLARED)
    asia = [parsed["asian_cup_2027"]]

    def exposure(played_share):
        return cups.exposure_of("Japan", True, asia, membership, lambda cup: 4.0,
                                played_share=played_share)

    regular = exposure(30 / 38)
    rotation = exposure(12 / 38)
    fringe = exposure(4 / 38)
    assert [one[0].band for one in (regular, rotation, fringe)] == ["regular", "rotation", "fringe"]
    assert regular[0].share_lost > rotation[0].share_lost > fringe[0].share_lost
    assert round(cups.adjusted_pv(30.0, regular, 38), 2) == round(30.0 - 0.59 * 4, 2)
    assert round(cups.adjusted_pv(12.0, rotation, 38), 2) == round(12.0 - 0.15 * 4, 2)
    assert round(cups.adjusted_pv(4.0, fringe, 38), 2) == round(4.0 - 0.05 * 4, 2)
    # a caller who passes no share is treated as a regular, which is the strongest of the three
    assert exposure(None)[0].share_lost == regular[0].share_lost

    # THE GUARD, which is not the model: nobody loses more rounds than he was going to play, and nothing
    # ever goes below zero. It must not bind on a regular.
    assert cups.adjusted_pv(1.0, exposure(1 / 38), 38) >= 0.0
    assert cups.adjusted_pv(0.2, regular, 38) == 0.0
    # no exposure, no adjustment - and no pv, no number
    assert cups.adjusted_pv(30.0, [], 38) == 30.0
    assert cups.adjusted_pv(None, regular, 38) is None


def test_a_country_outside_the_confederation_is_not_exposed_at_all():
    parsed, membership = cups.parse(DECLARED)
    assert cups.exposure_of("Italy", True, list(parsed.values()), membership, lambda cup: 4.0) == []
    # ...and a cup his own championship's calendar cannot answer for yields nothing rather than a zero
    assert cups.exposure_of("Japan", True, [parsed["asian_cup_2027"]], membership, lambda cup: 0) == []


def test_a_declared_exception_removes_an_exposure_and_can_never_add_one():
    """Dahoud reads Syria and plays for Germany. Nothing here observes that choice, so it is declared."""
    excused = cups.excused({"exceptions": {"123": {"reason": "gioca per la Germania",
                                                   "decided_on": "2026-08-17"},
                                           "not-an-id": {"reason": "ignored"}}})
    assert set(excused) == {123}
    assert "Germania" in excused[123] and "2026-08-17" in excused[123]


def test_the_rounds_in_a_window_are_counted_per_championship(tmp_path):
    """The same tournament costs a different number of rounds in each league, so it is COUNTED - and a
    round already played before the auction date is not a round at risk."""
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    rows = [
        # serie_a: one round inside the window, one before it, one after
        ("serie_a", 19, "2027-01-10"), ("serie_a", 18, "2027-01-03"), ("serie_a", 25, "2027-03-01"),
        # premier_league: two rounds inside
        ("premier_league", 20, "2027-01-09"), ("premier_league", 21, "2027-01-16"),
    ]
    for league, rnd, date in rows:
        conn.execute("INSERT INTO fixtures(event_id, season, league, round, date, home_key, away_key, "
                     "source, observed_on) VALUES (?, '2026-27', ?, ?, ?, 'a', 'b', 'sofascore', "
                     "'2026-08-17')", (f"{league}{rnd}", league, rnd, date))
    conn.commit()
    parsed, _membership = cups.parse(DECLARED)
    counted = snapshot.cup_rounds_by_league(conn, "2026-27", parsed["asian_cup_2027"])
    assert counted["serie_a"] == (1, 3)
    assert counted["premier_league"] == (2, 2)
    # a league with no calendar at all is ABSENT rather than zero: «no rounds» and «we cannot say» are
    # different answers and the sheet's column may only mean the first
    assert "bundesliga" not in counted
    # ...and the auction date drops what is already played
    after = snapshot.cup_rounds_by_league(conn, "2026-27", parsed["asian_cup_2027"], after="2027-01-12")
    assert after["serie_a"] == (0, 3)


def test_nationality_is_read_from_the_cache_offline_and_the_international_flag_keeps_its_first_day(tmp_path):
    """The fact was in the payload we already pay for, unread: `players.nationality` was NULL on every
    row of the real database while the granular roles were being read from the same files."""
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    for fc_id, name in ((1, "Doan"), (2, "Zambo Anguissa")):
        conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", (fc_id, name))
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (1, 'sofascore', '111')")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (2, 'sofascore', '222')")
    conn.commit()

    def payload(*, national):
        players = [{"player": {"id": 111, "name": "Ritsu Doan", "country": {"name": "Japan"}}},
                   {"player": {"id": 222, "name": "Anguissa", "country": {"name": "Cameroon"}}},
                   # nobody resolved this one: counted and skipped, never matched by name
                   {"player": {"id": 999, "name": "Kid", "country": {"name": "Japan"}}}]
        return {"players": players,
                "nationalPlayers": [{"player": {"id": pid}} for pid in national]}

    for date, national in (("2026-07-28", [111]), ("2026-08-15", [111, 222])):
        (ctx.config.cache_dir / f"sofascore_squad_1_{date}.json").write_text(
            json.dumps(payload(national=national)), encoding="utf-8")

    assert positions.ingest_nationality_from_cache(ctx) == 2
    stored = dict(conn.execute("SELECT canonical_name, nationality FROM players").fetchall())
    assert stored == {"Doan": "Japan", "Zambo Anguissa": "Cameroon"}
    capped = dict(conn.execute("SELECT fc_id, capped_on FROM players").fetchall())
    # the EARLIEST sighting is kept - it is the earliest day it can be proved - and a rerun must not
    # push it later
    assert capped == {1: "2026-07-28", 2: "2026-08-15"}
    positions.ingest_nationality_from_cache(ctx)
    assert dict(conn.execute("SELECT fc_id, capped_on FROM players").fetchall()) == capped
