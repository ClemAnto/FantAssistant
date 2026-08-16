"""Tests for the auction snapshot.

The contract worth defending is not the arithmetic - the engine columns come from the harness and are
tested there - but the SEPARATION: an `engine_*` column is a gated valuation and a `desc_*` column is
not, and a sheet that blurs the two is how an ungated rule ends up in a decision. Plus the two dates
that make a dry run honest: the auction date must never be after the season it pretends to price.
"""

from __future__ import annotations

import contextlib
import csv
import inspect
import io
import json
import re

from euroleghe_ingest import ui_theme as theme
from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.gui import _number
from euroleghe_ingest.modules import snapshot


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


def _seed(conn) -> None:
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (10, 'Inter', 'serie_a')")
    for fc_id, name, role in ((1, "Lautaro", "A"), (2, "Thuram", "A"), (3, "Sommer", "P")):
        conn.execute("INSERT INTO players(fc_id, canonical_name, birth_year) VALUES (?, ?, 1997)",
                     (fc_id, name))
        for season in ("2024-25", "2025-26"):
            conn.execute(
                "INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic, roles, "
                "price_initial) VALUES (?, ?, 10, 'serie_a', ?, ?, 20)",
                (fc_id, season, role, role.lower()))
            conn.execute(
                "INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm, goals, assists, "
                "yellows, reds) VALUES (?, ?, 'euro', 30, 6.5, 7.5, 10, 5, 4, 0)",
                (fc_id, season))
        # `team` matters: it is what defines the platform's perimeter (who you can buy from)
        conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, platform, team, mv) "
                     "VALUES (?, '2024-25', 1, 'euro', 'Inter', 6.5)", (fc_id,))
        conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, platform, team, mv) "
                     "VALUES (?, '2025-26', 1, 'euro', 'Inter', 6.5)", (fc_id,))
    conn.commit()


def test_the_target_is_the_season_being_auctioned_listone_or_not(tmp_path):
    """The default target is the season TODAY belongs to, not the newest listone.

    That is the point of the whole exercise: in July the auction being prepared is for a season whose
    listone does not exist yet. Asking for the newest listone instead would silently prepare last
    year's auction.
    """
    ctx = _ctx(tmp_path)
    _seed(ctx.conn)
    assert snapshot.season_of("2026-07-28") == "2026-27"
    assert snapshot.season_of("2026-06-30") == "2025-26"

    window, note = snapshot.resolve_window(ctx.conn, today="2026-07-28")
    assert window.target_season == "2026-27"      # no listone for it, and it is still the target
    assert window.input_season == "2025-26"
    assert window.auction_date == "2026-07-28"    # before 15 August, so: today
    assert note and "no listone yet" in note and "REAL squads" in note

    # a season already played is priced on ITS OWN auction day, never on today: a dry run must not
    # read the future it is pretending not to know
    window, note = snapshot.resolve_window(ctx.conn, "2025-26", today="2026-07-28")
    assert window.auction_date == "2025-08-15"
    assert note is None


def test_columns_declare_which_half_is_gated():
    engine = [c for c in snapshot.PLAYER_COLUMNS if c.startswith("engine_")]
    desc = [c for c in snapshot.PLAYER_COLUMNS if c.startswith("desc_")]
    # `actual_*` is the third class and the only one measured AFTER the auction date: what really happened
    # in the club's first match of the following week. A back-dated sheet has no use for a forecast of who
    # plays - the outcome exists - and the prefix is what keeps the two apart, so nobody can read a
    # certainty as a guess. Reporting only: nothing in engine_* or desc_* may be derived from it.
    actual = [c for c in snapshot.PLAYER_COLUMNS if c.startswith("actual_")]
    # `est_*` is the FOURTH class and the only one that is neither gated nor measured: the fallback
    # valuation, which exists because «ogni calciatore DEVE avere il suo SURPLUS» and which carries its own
    # basis and its own penalty per row (engine/estimate.py). It must stay a separate prefix: an estimate
    # filed under `engine_` would read as something that passed the gate, and under `desc_` as something
    # somebody measured.
    estimated = [c for c in snapshot.PLAYER_COLUMNS if c.startswith("est_")]
    assert engine and desc and actual and estimated
    assert {"est_surplus", "est_basis", "est_confidence", "est_note"} <= set(estimated), (
        "an estimate that does not say what it is built from and what it cost is not usable")
    # ...and BOTH halves of the pair: the operator's rule is that every player always has a realistic FM
    # and MV, so an estimate that answers only one of the two leaves the other column empty for exactly
    # the men the fallback exists for.
    assert {"est_fm", "est_mv"} <= set(estimated)
    # nothing may sit in between: every column is identity/market, engine, descriptive, or an outcome
    known = {"fc_id", "name", "club", "league", "role_classic", "roles_mantra", "price_initial",
             "price_initial_mantra", "fvm_reporting_only"}
    assert set(snapshot.PLAYER_COLUMNS) == (known | set(engine) | set(desc) | set(actual)
                                            | set(estimated))
    # the price that may be read is the pre-auction one; the end-of-season value is labelled
    assert "price_initial" in known and "fvm_reporting_only" in known


def test_duels_need_a_probabili_snapshot_and_never_guess():
    class Obs:
        def __init__(self, fc_id, name, club, role):
            self.fc_id, self.name, self.club_target, self.role_classic = fc_id, name, club, role

    observations = [Obs(1, "Lautaro", "Inter", "A"), Obs(2, "Thuram", "Inter", "A"),
                    Obs(3, "Taremi", "Inter", "A")]
    roles = {1: {"roles": "ST"}, 2: {"roles": "ST;AM"}, 3: {"roles": "ST"}}
    assert snapshot.duels(observations, {}, roles) == {}, "no snapshot -> no duel, never a guess"
    starters = {1: {"probability": 0.85}, 2: {"probability": 0.80}, 3: {"probability": 0.20}}
    found = snapshot.duels(observations, starters, roles)
    assert found[1]["rivals"] == 1 and "Thuram" in found[1]["names"]
    assert found[3]["rivals"] == 0, "a 20% third striker is not in a duel with an 85% starter"

    # A duel is a REAL POSITION and never a listone role. At Napoli, Politano, Lobotka and Neres are all
    # 'C' and all certain to start, and the Classic role declared a right winger in a ballottaggio with a
    # regista thirty metres away - while the man who really shares his shirt went unnamed.
    napoli = [Obs(1, "Politano", "Napoli", "C"), Obs(2, "Lobotka", "Napoli", "C"),
              Obs(3, "Neres", "Napoli", "C")]
    listed = {1: {"probability": 1.0}, 2: {"probability": 1.0}, 3: {"probability": 0.9}}
    found = snapshot.duels(napoli, listed,
                           {1: {"roles": "RW;MR"}, 2: {"roles": "MC;DM"}, 3: {"roles": "RW;LW"}})
    assert found[1]["names"] == "Neres", "one shared code is a duel; the same 'C' is not"
    assert found[2]["rivals"] == 0, "a regista is nobody's right wing ballottaggio"
    # ...and a player with NO observed code is out of the column altogether: his position is unknown, and
    # the listone role must not stand in for it - unknown is not "no rival"
    assert 2 not in snapshot.duels(napoli, listed, {1: {"roles": "RW"}, 3: {"roles": "RW"}})
    assert snapshot.duels(napoli, listed, {}) == {}


def test_injury_absence_is_told_apart_from_absence_of_data(tmp_path):
    ctx = _ctx(tmp_path)
    _seed(ctx.conn)
    conn = ctx.conn
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (1,'transfermarkt','111')")
    conn.execute("INSERT INTO injuries(fc_id, start_date, end_date, kind, days_out, matches_missed, "
                 "source) VALUES (1, '2025-01-10', '2025-02-10', 'knee', 31, 5, 'transfermarkt')")
    conn.commit()
    found = snapshot.injury_history(conn, "2025-08-15", ["2023-24", "2024-25", "2025-26"])
    assert found[1]["matches_missed"] == 5 and found[1]["spells"] == 1
    assert found[1]["weighted"] > 0
    assert 2 not in found, "a player with no Transfermarkt id must be UNKNOWN, not zero"
    assert "no absence recorded" not in found[1]["source"]


def test_snapshot_writes_the_sheet_and_the_manifest(tmp_path):
    ctx = _ctx(tmp_path)
    _seed(ctx.conn)
    # `season` pinned: the default target is the season today belongs to, which has no fixtures in this
    # fixture DB - here we want the sheet for the season the seed actually describes.
    manifest = snapshot.run(ctx, platform="euro", game="classic", refresh=False, season="2025-26")
    assert manifest["players"] == 3
    folder = next((ctx.config.data_dir / "reports").glob("auction-snapshot-2025-26-euro-classic-*"))
    rows = list(csv.DictReader(io.StringIO((folder / "players.csv").read_text(encoding="utf-8-sig"))))
    assert {row["name"] for row in rows} == {"Lautaro", "Thuram", "Sommer"}
    assert set(rows[0]) == set(snapshot.PLAYER_COLUMNS)
    # what cannot be measured says so, in the sheet and in the manifest
    assert rows[0]["desc_set_piece_duty"].startswith("not available")
    written = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    assert "club_relationship" in written["not_measurable"]
    assert written["engine"]["rules"][0] == "R0"
    assert "NOT gated" in written["descriptive"]["_note"]
    assert written["auction_date"] == "2025-08-15"


def test_the_live_squad_is_read_after_the_run_that_downloads_it(tmp_path, monkeypatch):
    """The payload the live squad reads is downloaded by the ROLES step, which used to run after the
    squads were already derived - so `squad_snapshot` held the newest file on disk, i.e. the PREVIOUS
    day's reading, and a departure spotted today reached the sheet tomorrow. Measured on 07/08/2026:
    35 payloads written at 14:24 by a run whose squads were built at 14:22. Here the roles step writes
    one payload that omits a seeded player, and the sheet has to see it in the same run.
    """
    ctx = _ctx(tmp_path)
    _seed(ctx.conn)
    ctx.conn.execute("INSERT INTO club_xref(source, source_id, fc_club_id) "
                     "VALUES ('sofascore', '2697', 10)")
    for fc_id in (1, 2, 3):
        ctx.conn.execute("INSERT INTO player_xref(source, source_id, fc_id) VALUES ('sofascore', ?, ?)",
                         (f"90{fc_id}", fc_id))
    ctx.conn.commit()

    def fake_roles(context, clubs, date, progress=None):
        """What the real roles step does to the disk: one dated payload per club - Thuram is gone."""
        payload = {"players": [{"player": {"id": 901, "name": "Lautaro"}},
                               {"player": {"id": 903, "name": "Sommer"}}]}
        path = context.config.cache_dir / f"sofascore_squad_2697_{date}.json"
        path.write_text(json.dumps(payload), encoding="utf-8")

    monkeypatch.setattr(snapshot, "refresh_real_roles", fake_roles)
    monkeypatch.setattr(snapshot, "refresh_editorial", lambda context: None)
    snapshot.run(ctx, platform="euro", game="classic", refresh=True, season="2025-26")

    live = {(row[0], row[1]) for row in ctx.conn.execute(
        "SELECT fc_id, valid_from FROM squad_snapshot WHERE source = 'sofascore'")}
    assert live, "the payload written during the run never reached `squad_snapshot`"
    day = next(iter(live))[1]
    assert {fc_id for fc_id, _ in live} == {1, 3}, "the live squad is the payload, absences included"
    assert day == "2025-08-15", "a live squad is dated with the payload's own day, not the run's"


def test_the_last_ten_series_tells_bench_from_injured_from_unknown(tmp_path):
    """The strip's four states are four different facts, and conflating them is the whole risk.

    A dot that says "did not play" when we simply have no data for that match is the same mistake as an
    injury table that reads zero for a player with no id: absence of evidence rendered as evidence.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _seed(conn)
    # four matches of the club: played 90', played 20', a bench one, and one nobody has rows for
    for match_id, date, minutes in (("m1", "2025-05-01", 90), ("m2", "2025-05-08", 20)):
        conn.execute(
            "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, "
            "match_date, club, minutes, started, rating) "
            "VALUES (1, '2024-25', 'sofascore', ?, 'serie_a', ?, 'Inter', ?, 1, 7.4)",
            (match_id, date, minutes))
    # m3: another player of the club has a row, so the match IS measured - our man simply did not play
    conn.execute(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, match_date, "
        "club, minutes, started, rating) "
        "VALUES (2, '2024-25', 'sofascore', 'm3', 'serie_a', '2025-05-15', 'Inter', 90, 1, 6.5)")
    # m4: only a club-level lineup row, no player rows at all -> unknown for everyone
    conn.execute(
        "INSERT INTO club_match_lineups(season, source, match_id, club, competition, match_date, "
        "starters, goalkeepers, defenders, midfielders, forwards) "
        "VALUES ('2024-25', 'sofascore', 'm4', 'Inter', 'serie_a', '2025-05-22', 11, 1, 4, 4, 2)")
    # and an injury covering m3, so that match reads as an absence with a reason
    conn.execute("INSERT INTO injuries(fc_id, start_date, end_date, kind, days_out, matches_missed, "
                 "source) VALUES (1, '2025-05-12', '2025-05-18', 'muscular', 6, 1, 'transfermarkt')")
    conn.commit()

    class Obs:
        fc_id, name, club_target, role_classic = 1, "Lautaro", "Inter", "A"

    form = snapshot.club_form(conn, "2025-08-15", [Obs()], {1: "Inter"})[1]
    tokens = form["series"].split()
    assert tokens[0].startswith("p:7.4:90"), "oldest first, so the strip reads like a calendar"
    assert tokens[1].startswith("p:7.4:20")
    assert tokens[2] == "i", "an absence inside a recorded injury spell is not a bench appearance"
    # a suspension is its own reason: same spell shape, different kind, different token
    conn.execute("UPDATE injuries SET kind = 'suspension' WHERE fc_id = 1")
    conn.commit()
    assert snapshot.club_form(conn, "2025-08-15", [Obs()], {1: "Inter"})[1]["series"].split()[2] == "s"
    assert tokens[3] == "n", "a match with no player-level data is unknown, not a bench appearance"
    assert (form["played"], form["measured"], form["club_matches"]) == (2, 3, 4)
    assert form["unused"] == 1 and form["unknown"] == 1


def test_the_bench_is_measured_and_beats_a_spell_that_covers_the_day(tmp_path):
    """A man NAMED among the substitutes was available and was not chosen - and that is not an absence.

    The row has always been there (an unused substitute carries a statistics object with no
    `minutesPlayed`, so `minutes` is NULL and `started` is 0): what was missing is a reader that says
    so. The order is the claim - a spell whose dates happen to cover the day cannot overrule the team
    sheet he is printed on - because «out injured» and «fit and left out» are the two answers item 6
    exists to tell apart, and only the second one changes a bid.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _seed(conn)
    # He is on the bench for m1 and nowhere near m2; a spell covers BOTH days.
    conn.execute(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, match_date, "
        "club, minutes, started) "
        "VALUES (1, '2024-25', 'sofascore', 'm1', 'serie_a', '2025-05-01', 'Inter', NULL, 0)")
    for match_id, date in (("m1", "2025-05-01"), ("m2", "2025-05-08")):
        conn.execute(
            "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, "
            "match_date, club, minutes, started, rating) "
            "VALUES (2, '2024-25', 'sofascore', ?, 'serie_a', ?, 'Inter', 90, 1, 6.5)",
            (match_id, date))
    conn.execute("INSERT INTO injuries(fc_id, start_date, end_date, kind, days_out, matches_missed, "
                 "source) VALUES (1, '2025-04-20', '2025-05-20', 'muscular', 30, 5, 'transfermarkt')")
    conn.commit()

    class Obs:
        fc_id, name, club_target, role_classic = 1, "Lautaro", "Inter", "A"

    form = snapshot.club_form(conn, "2025-08-15", [Obs()], {1: "Inter"})[1]
    assert form["series"].split() == ["b", "i"], "named on the bench beats a spell; the other day is a spell"
    assert (form["bench"], form["out"], form["unused"]) == (1, 1, 2), "the sum is what `unused` was"
    # And the friendly layer must NOT be read as a bench: there a row with no minutes means the
    # provider published the line-up and no statistics at all, which says nothing about the player.
    assert snapshot.bench_matches(conn, "2025-08-15") == {1: {"m1"}}
    conn.execute("UPDATE external_match_stats SET source = 'sofascore_extra' WHERE fc_id = 1")
    conn.commit()
    assert snapshot.bench_matches(conn, "2025-08-15") == {}, "a friendly's blank row is not a bench"


def test_a_summer_arrival_is_not_scored_on_his_new_club_s_spring(tmp_path):
    """The window follows the MAN, and a club is only his for the seasons he belonged to it.

    Found by calling the function on a real case (Doekhi, Union Berlin -> Lazio): the window
    interleaved his new club's spring with his own Bundesliga matches and scored him ZERO on six
    rounds played while he was still in Germany. The two-pass club resolution knew WHICH clubs the
    window spans and had no way to say WHEN each of them was his.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _seed(conn)
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) "
                 "VALUES (11, 'Union Berlino', 'bundesliga')")
    # He is quoted at Inter for the season being auctioned and played 2025-26 at Union Berlin.
    conn.execute("UPDATE rosters SET fc_club_id = 11, league = 'bundesliga' "
                 "WHERE fc_id = 1 AND season = '2024-25'")
    for match_id, date in (("u1", "2025-05-03"), ("u2", "2025-05-10")):
        conn.execute(
            "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, "
            "match_date, club, minutes, started, rating, mv_synth) "
            "VALUES (1, '2024-25', 'sofascore', ?, 'bundesliga', ?, 'Union Berlino', 90, 1, 7.0, 6.5)",
            (match_id, date))
    # ...while his NEW club played its own rounds on the very same days, with other men in them.
    for match_id, date in (("i1", "2025-05-03"), ("i2", "2025-05-10")):
        conn.execute(
            "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, "
            "match_date, club, minutes, started, rating) "
            "VALUES (2, '2024-25', 'sofascore', ?, 'serie_a', ?, 'Inter', 90, 1, 6.5)",
            (match_id, date))
    conn.commit()

    class Obs:
        fc_id, name, club_target, role_classic = 1, "Doekhi", "Inter", "D"

    scoring = {"": {"goal_bonus": 3.0, "assist_bonus": 1.0}}
    form = snapshot.club_form(conn, "2025-08-15", [Obs()], {1: "Inter"}, scoring=scoring,
                              target_season="2025-26")
    assert form[1]["trend_window"] == 2, "his window is his own two matches, not four"
    assert "serie_a" not in form[1]["trend_detail"], "his new club's spring is not his"
    assert form[1]["trend_played"] == 2
    assert form[1]["trend_fp"] == 6.5, "the synthetic voto, with no bonus to add"


def test_the_trend_scores_what_it_can_and_leaves_out_what_it_cannot(tmp_path):
    """The judgement's denominator is the claim: zero for an absence, nothing for an unknown.

    A match he did not play is a ZERO because availability is half of what a fantamedia is worth; a
    match nobody voted cannot be scored at all, and putting a zero there would say he was bad when we
    do not know. `trend_matches` is what makes the two readable apart.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _seed(conn)
    # voted (real), unvoted (no mv_synth either), and a round he sat out with nothing recorded
    conn.execute(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, match_date, "
        "club, minutes, started, rating) "
        "VALUES (1, '2024-25', 'sofascore', 'm1', 'serie_a', '2025-05-01', 'Inter', 90, 1, 7.0)")
    conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, platform, team, mv, fantavoto) "
                 "VALUES (1, '2024-25', 33, 'default', 'Inter', 7.0, 10.0)")
    conn.execute("UPDATE external_match_stats SET real_md = 33 WHERE match_id = 'm1'")
    conn.execute(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, match_date, "
        "club, minutes, started, rating) "
        "VALUES (1, '2024-25', 'sofascore', 'm2', 'serie_a', '2025-05-08', 'Inter', 90, 1, 6.0)")
    conn.execute(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, match_date, "
        "club, minutes, started, rating) "
        "VALUES (2, '2024-25', 'sofascore', 'm3', 'serie_a', '2025-05-15', 'Inter', 90, 1, 6.0)")
    conn.commit()

    class Obs:
        fc_id, name, club_target, role_classic = 1, "Lautaro", "Inter", "A"

    form = snapshot.club_form(conn, "2025-08-15", [Obs()], {1: "Inter"},
                              scoring={"": {"goal_bonus": 3.0, "assist_bonus": 1.0}},
                              target_season="2025-26")[1]
    assert form["trend_window"] == 3 and form["trend_played"] == 2
    assert form["trend_matches"] == 2, "the voted match and the absence; the unvoted one is left out"
    assert form["trend_fp"] == 5.0, "(10 + 0) / 2 - and never (10 + 0 + 0) / 3"


def _place_seed(conn, minutes_by_round: dict[int, int | None], mate: dict | None = None) -> None:
    """A club season of 20 rounds, a week apart, with his minutes per round. None = no row at all."""
    for round_number in range(1, 21):
        date = f"2025-09-{round_number:02d}" if round_number < 10 else f"2025-10-{round_number - 9:02d}"
        conn.execute(
            "INSERT INTO club_match_lineups(season, source, match_id, club, competition, match_date, "
            "real_md, starters, goalkeepers, defenders, midfielders, forwards) "
            "VALUES ('2024-25', 'sofascore', ?, 'Inter', 'serie_a', ?, ?, 11, 1, 4, 4, 2)",
            (f"r{round_number}", date, round_number))
        minutes = minutes_by_round.get(round_number)
        if minutes is not None:
            conn.execute(
                "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, "
                "match_date, real_md, club, minutes, started) "
                "VALUES (1, '2024-25', 'sofascore', ?, 'serie_a', ?, ?, 'Inter', ?, ?)",
                # a CAMEO is not a start, and the difference is the whole point of the screen below
                (f"r{round_number}", date, round_number, minutes or None,
                 1 if minutes >= 60 else 0))
        if mate:
            conn.execute(
                "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, "
                "match_date, real_md, club, minutes, started) "
                "VALUES (2, '2024-25', 'sofascore', ?, 'serie_a', ?, ?, 'Inter', 90, 1)",
                (f"r{round_number}", date, round_number))
    for fc_id in (1, 2):
        conn.execute("INSERT INTO player_roles(fc_id, valid_from, source, roles, primary_role, line) "
                     "VALUES (?, '2025-08-01', 'sofascore', 'DL;ML', 'DL', 'M')", (fc_id,))
    conn.commit()


def _place_of(conn, tmp_path=None):
    from euroleghe_ingest.modules import positions

    class Obs:
        fc_id, name, club_target, role_classic = 1, "Lautaro", "Inter", "D"

    roles = positions.roles_as_of(conn, "2025-11-01")
    belongs = snapshot.player_clubs(conn, snapshot.club_index(conn))
    return snapshot.place_changes(conn, "2024-25", [Obs()], {1: "Inter"}, belongs, roles).get(1)


def test_a_place_is_dated_and_the_order_with_the_injury_is_the_measurement(tmp_path):
    """«Gioca perche' manca X» and «ha vinto il posto, l'infortunio e' arrivato dopo» are two facts.

    The operator's own case: Bartesaghi's first 90 minutes are the round of 3-5 October and Estupinan's
    ankle is of the 12th - he took the place a WEEK BEFORE, and the injury consolidated it rather than
    causing it. Co-occurrence over the season answers the opposite, which is exactly why the control
    compares DATES and why the two sentences must not collapse into one.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _seed(conn)
    # bench for five rounds, then a starter for the rest - the shape of a place changing hands
    _place_seed(conn, {round_number: (0 if round_number <= 5 else 90) for round_number in range(1, 21)},
                mate={"any": True})
    # the man in front of him breaks down AFTER the change (round 6 is 2025-09-06)
    conn.execute("INSERT INTO injuries(fc_id, start_date, end_date, kind, days_out, matches_missed, "
                 "source) VALUES (2, '2025-09-13', '2025-10-05', 'ankle', 22, 4, 'transfermarkt')")
    conn.commit()
    place = _place_of(conn)
    assert place["change"] == "gained"
    assert place["on"] == "2025-09-06" and place["md"] == 6
    assert place["cause"] == "won_then_injury", "the injury is LATER: it consolidated the place"
    assert "Thuram" in place["who"]

    # ...and the same spell moved to BEFORE the change reverses the sentence, which is the whole point
    conn.execute("UPDATE injuries SET start_date = '2025-08-20', end_date = '2025-10-05' WHERE fc_id = 2")
    conn.commit()
    place = _place_of(conn)
    assert place["cause"] == "front_injured"
    assert "may go back" in place["note"], "a stand-in loses the place when the other returns"


def test_a_lost_place_says_whether_he_was_out_or_simply_not_chosen(tmp_path):
    """6.6, and the operator's second case: fifteen rounds on the bench in good health are not a convalescence.

    The reading is over the WHOLE window and not over the day the place changed: Angelino's place goes
    on the week of a six-day flu, and what matters is that fifteen rounds later he is still not playing
    with no spell on record at all. Reading the day alone answers «influenza» and stops there.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _seed(conn)
    _place_seed(conn, {round_number: (90 if round_number <= 5 else 0) for round_number in range(1, 21)})
    conn.execute("INSERT INTO injuries(fc_id, start_date, end_date, kind, days_out, matches_missed, "
                 "source) VALUES (1, '2025-09-05', '2025-09-11', 'illness', 6, 1, 'transfermarkt')")
    conn.commit()
    place = _place_of(conn)
    assert place["change"] == "lost"
    assert place["cause"] == "benched", "a six-day spell does not explain fifteen rounds"
    assert "AVAILABLE and not fielded" in place["note"]
    assert "Suspensions are NOT checked" in place["note"], \
        "where a ban cannot be seen the note says so, and never «he was not banned»"

    # ...and a spell that really covers the window is the other answer
    conn.execute("UPDATE injuries SET end_date = '2025-10-30' WHERE fc_id = 1")
    conn.commit()
    assert _place_of(conn)["cause"] == "own_injury"


def test_a_january_transfer_is_not_a_place_lost(tmp_path):
    """A club's calendar is his only WHILE he was there - and 7.3% of a season's players moved.

    Without the bound the union of two clubs' fixtures gives him 76 matches with half of them played by
    a side he was not in, and the changepoint lands on the day of the transfer and calls it «he lost his
    place». The bound is his own first and last appearance for each club, and it applies ONLY to a man
    who really played for two: for everybody else it would cut off exactly the rounds a place is won in.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _seed(conn)
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) "
                 "VALUES (11, 'Milan', 'serie_a')")
    _place_seed(conn, {round_number: 90 for round_number in range(1, 11)})
    # the same twenty rounds played by his NEW club, where he arrives in January and starts every game
    for round_number in range(1, 21):
        date = f"2025-09-{round_number:02d}" if round_number < 10 else f"2025-10-{round_number - 9:02d}"
        conn.execute(
            "INSERT INTO club_match_lineups(season, source, match_id, club, competition, match_date, "
            "real_md, starters, goalkeepers, defenders, midfielders, forwards) "
            "VALUES ('2024-25', 'sofascore', ?, 'Milan', 'serie_a', ?, ?, 11, 1, 4, 4, 2)",
            (f"m{round_number}", date, round_number))
        if round_number > 10:
            conn.execute(
                "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, "
                "match_date, real_md, club, minutes, started) "
                "VALUES (1, '2024-25', 'sofascore', ?, 'serie_a', ?, ?, 'Milan', 90, 1)",
                (f"m{round_number}", date, round_number))
    conn.commit()
    assert _place_of(conn) is None, "he started every match of both halves: nothing changed hands"


def _rotation_of(conn, minutes_by_round, price=40.0, before=None, spell=None, seed=True):
    """The screen, driven the way the sheet drives it. `minutes_by_round`: None = no row at all."""
    if seed:
        _place_seed(conn, minutes_by_round)
        if spell:
            conn.execute("INSERT INTO injuries(fc_id, start_date, end_date, kind, days_out, "
                         "matches_missed, source) VALUES (1, ?, ?, 'muscular', 30, 5, "
                         "'transfermarkt')", spell)
        conn.commit()

    class Obs:
        def __init__(self, fc_id, price_initial):
            self.fc_id, self.price_initial = fc_id, price_initial
            self.name, self.club_target, self.role_classic = f"p{fc_id}", "Inter", "A"

    # a role pool of twenty, so a percentile exists at all, with our man at the top
    observations = [Obs(1, price)] + [Obs(100 + i, 1.0 + i) for i in range(20)]
    prices = snapshot.role_percentiles(observations)
    belongs = snapshot.player_clubs(conn, snapshot.club_index(conn))
    return snapshot.rotation_watch(conn, "2024-25", observations, belongs, prices, before), prices


def test_the_rotation_screen_fires_on_a_man_who_plays_every_week_and_never_starts(tmp_path):
    """The operator's Lewandowski case, and it is a DIFFERENT shape from a place lost.

    There is no step to find: he plays every round (14, 12, 22, 90, 25, 90...) and is simply not the
    starter, so a changepoint over a season reads nothing while the table loses points every Sunday.
    What fires is a reading of the CLUB's last five rounds - under 45 minutes a match and at most one
    start - inside the pool that was sold as a starter, which is the top of his role by quotation.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _seed(conn)
    # cameo, cameo, cameo, one start, cameo... over twenty rounds, so eight are still to play
    rotated = {round_number: (90 if round_number % 4 == 0 else 15) for round_number in range(1, 21)}
    flagged, prices = _rotation_of(conn, rotated, before="2025-09-06")
    assert prices[1] > snapshot.ROTATION_POOL, "he is quoted at the top of his role"
    watch = flagged.get(1)
    assert watch, "five rounds under the bar with one start is what the screen is for"
    assert watch["starts"] == 1 and watch["minutes"] < snapshot.ROTATION_MINUTES
    assert "90.4%" in watch["note"], "the mark carries the measurement that justifies it"


def test_the_rotation_screen_stays_silent_where_it_would_be_saying_something_else(tmp_path):
    """Three silences, and each is a claim the data does not support.

    A STARTER is not rotated. A man the market never sold as a starter cannot fail to be one - the pool
    is part of the measurement, and the thresholds were calibrated inside it. And a man who spent that
    window INJURED is not being rotated: the screen scores the same either way (86.3% against 85.7%),
    so the guard costs no precision, and he already carries the injury mark - two marks saying two
    different things about the same five matches is how a table stops trusting both.
    """
    for case, minutes, price, spell in (
            ("a starter", {n: 90 for n in range(1, 21)}, 40.0, None),
            ("nobody sold him as a starter",
             {n: (90 if n % 4 == 0 else 15) for n in range(1, 21)}, 0.5, None),
            ("he was hurt", {n: (90 if n % 4 == 0 else 15) for n in range(1, 21)}, 40.0,
             ("2025-08-25", "2025-09-30"))):
        ctx = _ctx(tmp_path / case.replace(" ", "-"))
        conn = ctx.conn
        _seed(conn)
        flagged, _prices = _rotation_of(conn, minutes, price=price, before="2025-09-06", spell=spell)
        assert 1 not in flagged, f"it must not fire when {case}"


def test_the_rotation_screen_says_nothing_about_a_season_that_has_not_been_played(tmp_path):
    """It reads rounds, so before there are any it is EMPTY - and it stops when the season is closing.

    Both ends are the calibration's own: the screen was measured predicting the REST of a season, so a
    mark in August (nothing behind it) or in May (nothing in front) would be a claim nobody scored.
    On a pre-season sheet this column is therefore empty by construction, which is the same thing item
    4.4 measured from the other side - what pays after kick-off is the appearances everybody can see.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _seed(conn)
    rotated = {round_number: (90 if round_number % 4 == 0 else 15) for round_number in range(1, 21)}
    nothing, _prices = _rotation_of(conn, rotated, before="2025-09-02")
    assert 1 not in nothing, "one round is not a reading of anything"
    late, _prices = _rotation_of(conn, rotated, before="2025-10-09", seed=False)
    assert 1 not in late, "with fewer than eight rounds left the screen was never scored"


def test_a_window_too_short_says_less_instead_of_saying_it_earlier(tmp_path):
    """The operator asked for a mark BEFORE the fifth round, and the measurement drew the line.

    After four rounds the reading is worth as much as after five (96.3% against 94.9%), so the full
    mark fires there. After two or three it is worth 81% against a base of 58% - a reason to look and
    NOT the same sentence, which is why it comes out as its own weaker mark instead of the strong one
    drawn early. The counter-example is what settles it: after two rounds of 2025-26 the reading would
    have named Donnarumma at Manchester City on 0 minutes, and he went on to average 85.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _seed(conn)
    # never a starter, cameos only, so the short window has something to read
    rotated = {round_number: 15 for round_number in range(1, 21)}
    two, _prices = _rotation_of(conn, rotated, before="2025-09-03")
    assert two[1]["strength"] == "early" and two[1]["window"] == 2
    assert "81%" in two[1]["note"] and "Donnarumma" in two[1]["note"]
    four, _prices = _rotation_of(conn, rotated, before="2025-09-05", seed=False)
    assert four[1]["strength"] == "watch", "the fourth round is worth as much as the fifth"
    assert "90.4%" in four[1]["note"]


def test_the_mirror_screen_names_a_reserve_who_is_playing_like_a_starter(tmp_path):
    """The operator's inverse question, with his own cases as the test: F. Torres, Castro.

    Same window and the opposite reading, and the POOL is where the work is: above the 85th percentile
    of his role he was sold as a starter (that is the other screen's population and «he is playing» is
    not news), below the 30th he is a filler whose four good matches are a cup run. What the mark
    claims is weaker than the rotation one and says so - 76.8% against a 42.3% base for an outfield
    player, where losing a place reads 90.4%.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _seed(conn)
    _place_seed(conn, {round_number: 90 for round_number in range(1, 21)})
    conn.commit()

    class Obs:
        def __init__(self, fc_id, price_initial, role="A"):
            self.fc_id, self.price_initial = fc_id, price_initial
            self.name, self.club_target, self.role_classic = f"p{fc_id}", "Inter", role

    # a role pool of twenty-one where our man sits mid-table: a reserve, not a filler and not a top
    observations = [Obs(1, 11.0)] + [Obs(100 + i, float(i)) for i in range(21)]
    prices = snapshot.role_percentiles(observations)
    belongs = snapshot.player_clubs(conn, snapshot.club_index(conn))
    low, high = snapshot.RISER_POOL
    assert low <= prices[1] < high, "he is quoted in the reserve band of his role"
    flagged = snapshot.starter_signs(conn, "2024-25", observations, belongs, prices,
                                     before="2025-09-06")
    assert flagged[1]["starts"] == 5 and flagged[1]["minutes"] == 90.0
    assert "76.8%" in flagged[1]["note"] and "WEAKER" in flagged[1]["note"]

    # ...and the two edges of the band, which are the measurement and not a precaution
    top = [Obs(1, 99.0)] + [Obs(100 + i, float(i)) for i in range(21)]
    assert 1 not in snapshot.starter_signs(
        conn, "2024-25", top, belongs, snapshot.role_percentiles(top), before="2025-09-06"), \
        "a man sold as a starter cannot be «a reserve who is playing»"


def test_the_vote_cascade_is_declared_and_a_keeper_is_not_guessed():
    """Real fantavoto, then the calibrated synthetic voto, then nothing. Never a zero.

    Two things the synthetic side cannot carry, and both are stated instead of approximated: cards
    (the per-match layer has no bookings at all) and a goalkeeper's fantapunti, which are dominated by
    the goals conceded - no per-match row of ours holds them, and the outfield formula reads +0.82 to
    +1.22 above a keeper's real fantamedia.
    """
    scoring = {"goal_bonus": 3.0, "assist_bonus": 1.0}
    assert snapshot.match_worth(10.0, 7.0, 6.2, 1, 0, False, scoring) == (7.0, "real", 10.0)
    assert snapshot.match_worth(None, None, 6.2, 1, 1, False, scoring) == (6.2, "synth", 10.2)
    assert snapshot.match_worth(None, None, None, 0, 0, False, scoring) == (None, None, None)
    assert snapshot.match_worth(None, None, 6.2, 0, 0, True, scoring) == (6.2, "synth", None)
    assert snapshot.match_worth(None, None, 6.2, 2, 0, False, None) == (6.2, "synth", None), \
        "no league, no bonus values: this project hard-codes none"


def test_a_missing_xg_is_a_zero_only_where_he_did_not_shoot():
    """The convention on a NULL is measured, and it is not the same in both directions.

    NULL with no shots is a zero (19,719 of 19,719 such rows in 2025-26 have `shots` = 0); NULL on a
    row that DID shoot is unknown, because before 2022-23 the provider served no xG at all and drawing
    a zero there would invent a measurement out of a season nobody covered.
    """
    assert snapshot._xga(0.3, 0.2, 4) == 0.5
    assert snapshot._xga(None, 0.0, 0) == 0.0, "he did not shoot: that is a zero, not a hole"
    assert snapshot._xga(None, 0.1, 3) is None, "he shot and no xG was served: unknown"
    assert snapshot._xga(0.4, None, 2) is None


def _headless_root():
    import tkinter as tk

    try:
        root = tk.Tk()
    except tk.TclError:
        import pytest
        pytest.skip("no display available")
    root.withdraw()
    return root


def test_the_pitch_never_draws_outside_itself(tmp_path):
    """Every formation, on the canvas it actually has. This is the regression that cost three rounds.

    The drawing broke three different ways - a name plate to the right of the marker on a five-man line,
    a caption wider than the pitch, a mowing stripe past the touchline - and all three are invisible in
    code and obvious in a bounding box. So the bounding box is the test.
    """
    import csv
    import json

    from euroleghe_ingest.gui import SnapshotView

    folder = tmp_path / "data" / "reports" / "auction-snapshot-2026-27-euro-classic-2026-07-28"
    folder.mkdir(parents=True)
    # The third element is the GRANULAR real role, spread across the depth of each line so the pitch is
    # checked with it: DM behind MC, AM ahead of the midfield, and the flanks named outright. Every line
    # keeps enough men whose real role belongs to it - a squad whose five defenders are all really
    # wing-backs cannot fill a back four, and that is a question about the eleven, not about the
    # drawing, so it does not belong in a bounding-box test.
    roles = ([("P", "por", "GK")]
             + [("D", "dc", "DL"), ("D", "dc", "DC"), ("D", "dc", "DC"), ("D", "dc", "DR"),
                ("D", "dc", "DR")]
             + [("C", "c", "DM"), ("C", "c", "DM"), ("C", "c", "MC"), ("C", "c", "MC"),
                ("C", "c", "ML"), ("C", "c", "MR")]
             + [("A", "pc", "ST"), ("A", "pc", "LW"), ("A", "pc", "RW"), ("A", "pc", "AM")])
    with open(folder / "players.csv", "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(snapshot.PLAYER_COLUMNS))
        writer.writeheader()
        for index, (role, mantra, real) in enumerate(roles):
            writer.writerow({"fc_id": index, "name": f"Verylongsurname{index}", "club": "Test",
                             "role_classic": role, "roles_mantra": mantra,
                             "desc_real_roles": real, "desc_real_role_primary": real,
                             "engine_surplus": "10.0", "desc_start_share": "0.80",
                             "desc_season_starts": "20", "desc_form_measured": "10",
                             "desc_form_starts": "8", "desc_form_minutes": "700",
                             "desc_form_series": "p:7.0:90 " * 10,
                             "desc_duel_names": "Verylongsurname18; Verylongsurname17"})
    with open(folder / "clubs.csv", "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["club", "formation_typical",
                                                   "formation_typical_share", "formation_typical_of",
                                                   "formation_settled", "formation_today",
                                                   "probabili_date"])
        writer.writeheader()
        writer.writerow({"club": "Test", "formation_typical": "3-5-2",
                         "formation_typical_share": "0.9", "formation_typical_of": "38",
                         "formation_settled": "yes", "formation_today": "3-4-2-1",
                         "probabili_date": "2026-07-26"})
    (folder / "manifest.json").write_text(json.dumps({"engine": {"rules": ["R0"]}}), encoding="utf-8")

    root = _headless_root()
    try:
        root.geometry("1180x800")
        view = SnapshotView(root, Config(data_dir=tmp_path / "data",
                                         db_path=tmp_path / "data" / "euro.db"))
        view.pack(fill="both", expand=True)
        view.reload()
        # a withdrawn root never resolves geometry, so the canvas is told its size explicitly: the
        # drawing reads the requested size when it is not mapped, which is what makes this testable
        view.pitch.configure(width=430, height=470)
        root.update()
        for formation in ("3-5-2", "4-3-3", "3-4-2-1", "4-2-3-1", "5-3-2"):
            view.clubs["Test"]["formation_typical"] = formation
            for mode in ("typical", "next"):
                view.xi_mode.set(mode)
                view._show_club()
                root.update()
                canvas = view.pitch
                width = canvas.winfo_width() if canvas.winfo_width() > 1 else canvas.winfo_reqwidth()
                height = (canvas.winfo_height() if canvas.winfo_height() > 1
                          else canvas.winfo_reqheight())
                box = canvas.bbox("all")
                assert box, f"{formation}/{mode}: nothing drawn"
                assert box[0] >= -2 and box[1] >= -2, f"{formation}/{mode} spills top/left: {box}"
                assert box[2] <= width + 2, f"{formation}/{mode} spills right: {box} in {width}"
                assert box[3] <= height + 2, f"{formation}/{mode} spills below: {box} in {height}"
                # No name plate on top of another. "The layout is broken" is exactly this - a plate
                # above one marker meeting the plate below the marker in the line before it - and a
                # bounding box cannot see it, because everything stays inside the canvas while
                # overlapping. The plates are the rectangles the shirts draw (their own outline).
                plates = [canvas.bbox(item) for item in canvas.find_all()
                          if canvas.type(item) == "rectangle"
                          and canvas.itemcget(item, "outline") == "#4c7a35"]
                for first in range(len(plates)):
                    for second in range(first + 1, len(plates)):
                        one, two = plates[first], plates[second]
                        assert not (one[0] < two[2] and two[0] < one[2]
                                    and one[1] < two[3] and two[1] < one[3]),                             f"{formation}/{mode}: name plates overlap: {one} {two}"
                # and every shirt is really on the pitch, not merely inside the bounding box
                assert len(view.eleven("Test", formation, mode)) == 11
    finally:
        root.destroy()


# ---------- placing the granular real role on the pitch ----------
def test_granular_real_role_places_the_player():
    """The twelve codes are a grid, and the pitch has to read both axes off them: the flank, which the
    listone's 'e' and 'w' leave open, and the depth, which its single 'C' collapses entirely."""
    from euroleghe_ingest.gui import SnapshotView as View

    left_back = {"desc_real_roles": "DL", "role_classic": "D"}
    assert View.lateral(left_back) == -1.0
    assert View.badge(left_back) == "Ts"
    assert View.lateral({"desc_real_roles": "RW;AM"}) == 1.0        # the PRIMARY code decides
    assert View.lateral({"desc_real_roles": "MC"}) == 0.0

    # the depth the listone cannot express: three 'C' at three different places on the pitch
    assert (View.depth({"desc_real_roles": "DM"}) < View.depth({"desc_real_roles": "MC"})
            < View.depth({"desc_real_roles": "AM"}))
    assert [View.badge({"desc_real_roles": code}) for code in ("DM", "MC", "AM")] == ["M", "C", "T"]
    # and with no granular role at all it stays exactly as it was: the Mantra role, then the drawn side
    assert View.depth({"roles_mantra": "c"}) is None
    assert View.lateral({"roles_mantra": "b;ds;e"}) == -1.0
    assert View.lateral({"roles_mantra": "w"}) is None
    assert View.badge({"roles_mantra": "w"}, drawn_side=-1.0) == "As"


def test_granular_role_wins_over_a_measured_side_that_contradicts_it():
    """`desc_side_measured` is a season centroid: it smears a man used on both flanks into the middle,
    or onto the wrong one. Where the code plainly names a flank, the code decides."""
    from euroleghe_ingest.gui import SnapshotView as View

    # they agree -> keep the measured value, which also says how far out he stood
    assert View.lateral({"desc_real_roles": "DL", "desc_side_measured": "-0.62"}) == -0.62
    # it contradicts the code -> the code
    assert View.lateral({"desc_real_roles": "DL", "desc_side_measured": "0.55"}) == -1.0
    # it reads central for a man the provider calls a full back -> the code
    assert View.lateral({"desc_real_roles": "DR", "desc_side_measured": "0.03"}) == 1.0
    # a CENTRAL code claims nothing about the flank, so the measurement stands: a nominal centre back
    # who spent the season on the left of a back three really was on the left
    assert View.lateral({"desc_real_roles": "DC", "desc_side_measured": "-0.71"}) == -0.71
    # an unknown code is not a placement: it falls through to the listone
    assert View.lateral({"desc_real_roles": "SS", "roles_mantra": "dd"}) == 1.0


def test_real_role_columns_reach_the_sheet():
    """The drawing positions travel in the CSV, so a reader of the sheet places him the same way the
    pitch does instead of inventing a mapping."""
    for column in ("desc_real_roles", "desc_real_role_primary", "desc_real_role_line",
                   "desc_real_role_depth", "desc_real_role_side", "desc_foot",
                   "desc_real_role_observed"):
        assert column in snapshot.PLAYER_COLUMNS


# ---------- the percentage on a shirt, and the two rules of a real attack ----------
def test_the_pre_season_shape_is_measured_and_weighs_nothing():
    """Item 5 of the todolist, run and refused. The column exists (`friendly_shapes`, 1-3 complete
    elevens per club, all 20 covered), the fifth source of `shape_odds` reads it, and the
    pre-registered grid put its optimum at the EDGE: the module count never improves at any weight and
    the men fall from 166 to 163. A parameter is not adopted at the edge of its grid."""
    from euroleghe_ingest.gui import SnapshotView as View

    assert View.PRESEASON_WEIGHT == 0.0
    # the accessor still reads the measurement, as a distribution and not as a mode
    shares, count = View.friendly_shapes({"friendly_shapes": "4-3-3:2;3-5-2:1"})
    assert count == 3 and shares == {"4-3-3": 2 / 3, "3-5-2": 1 / 3}
    assert View.friendly_shapes({}) == ({}, 0)


def test_a_trequartista_is_a_candidate_for_the_midfield_too():
    """The Paz case: coded `AM` and nothing else, our grid calls that a trequartista and sends every
    trequartista to the ATTACK - so the highest claim in Como's squad (0.760, 33 starts) lost the
    4-5-1's single forward place to the centre-forward and had no other line to be considered for.
    Both sources say midfielder: the provider files 20 of 27 `AM` under M, the listone calls 22 C."""
    from euroleghe_ingest.gui import SnapshotView as View

    # the provider's own slot is a SECOND observation, and it is what widens the candidacy
    assert View.PROVIDER_LINE["M"] == "M" and View.PROVIDER_LINE["F"] == "A"
    # our grid still draws him forward - this is about who is CONSIDERED, not where he is placed
    assert View.LANE_OF_ROLE["AM"] == "T"
    assert View.depth({"desc_real_roles": "AM"}) > View.depth({"desc_real_roles": "MC"})


def test_co_starts_are_counted_over_the_matches_both_were_available_for(tmp_path):
    """The denominator IS the measurement. Counted over all matches, every pair split by a transfer
    reads 0.00 and «they never coexist» would be said of every summer signing - measured on the
    boards, 35 pairs looked like that and 32 had simply never shared a squad."""
    from euroleghe_ingest.db.database import init_db

    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(1, "Krstovic"), (2, "Scamacca"), (3, "Newcomer")])
    rows = []
    # 20 matches both were in the squad for, and the shirt ROTATES: Krstovic starts the first twelve,
    # Scamacca the last ten, so they start together exactly twice
    for index in range(20):
        rows.append((1, f"m{index}", 1 if index < 12 else 0))
        rows.append((2, f"m{index}", 1 if index >= 10 else 0))
    # the newcomer played 12 matches ELSEWHERE: he shares no squad with either, so he is UNKNOWN
    for index in range(50, 62):
        rows.append((3, f"x{index}", 1))
    conn.executemany("INSERT INTO external_match_stats(fc_id, season, source, match_id, started) "
                     "VALUES (?, '2025-26', 'sofascore', ?, ?)", rows)
    conn.commit()
    clubs = {1: "Atalanta", 2: "Atalanta", 3: "Atalanta"}
    out = snapshot.costarts(conn, "2025-26", {1, 2, 3}, clubs)
    assert out[1] == "Scamacca:0.20" and out[2] == "Krstovic:0.20"   # 2 of the rarer man's 10 starts
    assert 3 not in out, "a man who never shared a squad has co-started nothing BY CONSTRUCTION"

    # ...and the panel reads it back per pair, with None where the sheet says nothing
    from euroleghe_ingest.gui import SnapshotView as View

    krsto = {"name": "Krstovic", "desc_costart_low": out[1]}
    assert View.costart_share(krsto, {"name": "Scamacca"}) == 0.20
    assert View.costart_share(krsto, {"name": "Newcomer"}) is None


def test_a_plate_carries_the_MARGIN_and_not_just_the_winner():
    """Item 6a. «Un undici che mostra 0.72 vs 0.67 e' un'informazione, uno che mostra solo il vincitore
    e' un'affermazione»: Gila/Tomori and Thuram K./Koopmeiners are duels under 0.1 of claim, and the
    plate has to let the operator see how thin they are. One rival per LINE, each with his own share -
    two names sharing a line cannot carry the percentages that make it a ranking."""
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    view.xi_mode = type("V", (), {"get": staticmethod(lambda: "typical")})()
    view.clubs = {"Test": {"complete_XIs": "38", "league_XIs": "38"}}
    view.players = []
    def row(name, share):
        return {"name": name, "club": "Test", "desc_start_share": str(share),
                "desc_season_starts": str(int(share * 38)),
                "desc_minutes_full_season": str(int(share * 3420)),
                "desc_injury_source": "transfermarkt (no absence recorded)"}
    starter, rival = row("Tomori", 0.67), row("Gila", 0.66)
    lines = view.plate_lines(starter, [rival], 18, 16)
    assert lines[0].startswith("Tomori") and "%" in lines[0], lines
    assert lines[1].startswith("vs Gila") and "%" in lines[1], lines
    # ...and the two shares are close enough that only the numbers can tell them apart
    assert lines[0] != lines[1]


def test_a_shape_is_worth_the_mean_surplus_of_the_eleven_it_fields():
    """The selector's second number. A missing surplus is UNKNOWN, never zero - averaging it as zero
    would make a shape look poorer for exactly the men the sheet could not price - so the mean is over
    the men who carry one and the count travels with it. And `~` where the fallback valuation is in it:
    the two are the same arithmetic times a confidence, which is what lets one number rank a squad, but
    the reader has to be told which he is looking at."""
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    # the gated number where it exists, the estimate where it does not, None where neither
    assert View.row_surplus({"engine_surplus": "12.5", "est_surplus": "9.0"}) == (12.5, False)
    assert View.row_surplus({"est_surplus": "9.0"}) == (9.0, True)
    assert View.row_surplus({}) == (None, False)

    def eleven(*surpluses):
        return [("A", dict(row), []) for row in surpluses]

    gated = eleven(*[{"engine_surplus": "10"}] * 10, {"engine_surplus": "20"})
    assert view.eleven_surplus(gated) == (10 + 10 / 11, 11, 11, False)
    # one estimate in the eleven marks the whole mean
    mixed = eleven(*[{"engine_surplus": "10"}] * 10, {"est_surplus": "20"})
    assert view.eleven_surplus(mixed)[0] == 10 + 10 / 11
    assert view.eleven_surplus(mixed)[3] is True
    # ...and an unpriced man is left OUT of the mean rather than counted as zero
    partial = eleven(*[{"engine_surplus": "10"}] * 9, {}, {})
    assert view.eleven_surplus(partial) == (10.0, 9, 11, False)
    assert view.eleven_surplus(eleven({}, {})) == (None, 0, 2, False)


def test_the_shirt_shows_a_share_of_the_matchdays_discounted_by_the_injuries():
    """The number an operator writes by hand ("Meret 50%, Di Lorenzo 95%") is a share of the season, not
    of a duel: normalising over the rivals a slot happens to have left over made a 14-start midfielder
    read 100%. And a man who misses stretches of every year is worth less of a shirt than a team-mate
    who is available every week, even when the coach prefers him."""
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    view.clubs = {"Test": {"complete_XIs": "38"}}
    view.players = []
    fit = {"club": "Test", "desc_season_starts": "30", "desc_minutes_full_season": "2700",
           "desc_injury_source": "transfermarkt (no absence recorded)", "desc_injury_weighted": "0"}
    # 30 of 38 matchdays, 2700 of 3420 minutes: the same story twice, and no injury to discount
    assert 0.75 < view.presence(fit) < 0.85
    assert view.availability(fit) == 1.0

    # the same starts and minutes, but he misses ~10 matches a season: below a healthy team-mate
    fragile = dict(fit, desc_injury_weighted=str(10 * (1.0 + 0.6 + 0.35)))
    assert view.availability(fragile) < 0.75
    assert view.presence(fragile) < view.presence(fit)
    # NO history is not a clean bill of health either way: it must not discount him
    assert view.availability({"club": "Test", "desc_season_starts": "30"}) == 1.0

    # and the share is the ONLY encoding of it: three tiers of disc colour on the marker said the same
    # thing a second time, on a shirt that already prints the number under the name


def test_a_season_played_at_another_club_is_discounted_and_never_read_as_this_one():
    """Marin R. arrives at Napoli with 21 starts and 1980 minutes, and every one of them is Villarreal's.

    Read as a Napoli standing they put him ahead of Rrahmani (0.81 of standing, but available 41% of the
    time). Dropped altogether they would delete every summer signing from the eleven. So they are
    DISCOUNTED - being sent on loan is the club's own judgement of a player - and the discount comes out
    of the split the sheet carries, not out of a flag.
    """
    import pytest

    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    view.clubs = {"Napoli": {"complete_XIs": "36"}}
    view.players = []
    total = {"club": "Napoli", "desc_season_starts": "21", "desc_season_matches": "23",
             "desc_minutes_full_season": "1980", "desc_at_club_before": "2024-25",
             "desc_injury_source": "transfermarkt (no absence recorded)", "desc_injury_weighted": "0"}
    home = dict(total, desc_season_starts_club="21", desc_season_starts_elsewhere="0",
                desc_minutes_club="1980", desc_minutes_elsewhere="0")
    loaned = dict(total, desc_season_starts_club="0", desc_season_starts_elsewhere="21",
                  desc_minutes_club="0", desc_minutes_elsewhere="1980")
    assert view.standing(loaned) == pytest.approx(view.standing(home) * View.LOAN_DISCOUNT)
    assert view.voto_share(loaned) == pytest.approx(view.voto_share(home) * View.LOAN_DISCOUNT)
    # the whole season at the club he is at now is the number as it always was: no discount, no drift
    assert view.standing(home) == view.standing(total)
    # and NO split at all is unknown, not a season played elsewhere: it must not discount him either
    assert view.at_club_weight(total) == 1.0

    # a January transfer sits in between, and the discount shrinks by itself as he plays here - which is
    # what a second "seasons at the club" parameter would have been for
    moved = dict(total, desc_season_starts_club="9", desc_season_starts_elsewhere="12",
                 desc_minutes_club="880", desc_minutes_elsewhere="1100")
    assert view.standing(loaned) < view.standing(moved) < view.standing(home)
    settled = dict(moved, desc_minutes_club="1500", desc_minutes_elsewhere="480")
    assert view.at_club_weight(moved) < view.at_club_weight(settled)

    # A man this club has NEVER had is discounted less: it never sent him away, so only the first of the
    # two reasons applies - the season was measured in another side. Gila, four years at Lazio, is Milan's
    # now, and Milan has no judgement of him to read.
    bought = {key: value for key, value in loaned.items() if key != "desc_at_club_before"}
    assert view.at_club_weight(bought) == View.ARRIVAL_DISCOUNT
    assert view.at_club_weight(loaned) == View.LOAN_DISCOUNT
    assert view.standing(loaned) < view.standing(bought) < view.standing(home)


def test_the_split_between_this_club_and_elsewhere_comes_from_the_per_match_layer(tmp_path):
    """Only the per-match layer stores a club per appearance, so only it can say whose season it was.

    A player it has nothing for stays OUT of the result: that is what leaves the columns empty and his
    standing undiscounted, the same asymmetry the injury layer makes for a player with no id.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    _seed(conn)
    for club in ("Napoli", "Villarreal"):
        conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, 'serie_a')",
                     (hash(club) % 1000, club))
    conn.execute("INSERT INTO players(fc_id, canonical_name, birth_year) VALUES (9, 'Marin R.', 1997)")
    for match_id, club, minutes, started in (("v1", "Villarreal", 90, 1), ("v2", "Villarreal", 75, 1),
                                             ("n1", "Napoli", 20, 0)):
        conn.execute(
            "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, "
            "match_date, club, minutes, started) "
            "VALUES (9, '2025-26', 'sofascore', ?, 'serie_a', '2026-03-01', ?, ?, ?)",
            (match_id, club, minutes, started))
    conn.commit()

    class Obs:
        def __init__(self, fc_id, club):
            self.fc_id, self.club_target = fc_id, club

    split = snapshot.at_current_club(conn, "2025-26", [Obs(9, "Napoli"), Obs(1, "Inter")], {})
    assert split[9] == {"starts": 0, "minutes": 20,
                        "starts_elsewhere": 2, "minutes_elsewhere": 165}
    assert 1 not in split, "no row in the per-match layer -> unknown, and the columns stay empty"
    # and both halves reach the sheet, so a reader sees whose season it was
    for column in ("desc_season_starts_club", "desc_season_starts_elsewhere",
                   "desc_minutes_club", "desc_minutes_elsewhere"):
        assert column in snapshot.PLAYER_COLUMNS


def test_a_real_attack_has_one_centre_forward_and_he_plays_in_the_middle():
    """Two rules a coach does not break, and the drawing has to obey both: a punta centrale plays in the
    middle of an attack, and a side fields ONE - the second adapts as a seconda punta."""
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    striker = {"name": "Nine", "desc_real_roles": "ST"}
    winger = {"name": "Seven", "desc_real_roles": "RW"}
    # the wide place of a front three goes to the winger, and the middle to the striker - priced, because
    # that is what the assignment reads (`_slot_price`): a forward pays nothing for a wing in the attacking
    # line (the three interchange, and the marker says so), while a striker still prefers the middle
    assert view._slot_price(winger, "R", "A") < view._slot_price(striker, "R", "A")
    assert view._slot_price(striker, "C", "A") < view._slot_price(striker, "R", "A")
    assert view._slot_price(striker, "C", "A") < view._slot_price(winger, "C", "A")

    # two centre-forwards on the board: the central one keeps the shirt, the other reads seconda punta
    # the fractions are the real drawn ones, so the CENTRAL striker keeps the shirt: read off an even
    # spread instead, a second striker nearer the middle stole it from the true centre-forward
    view.players = []
    view.clubs = {}
    wide = dict(striker, name="Nine bis", desc_side_measured="0.6")
    codes = view._line_codes([(0.30, wide, []), (0.50, striker, [])])
    assert codes == ["Sp", "Pc"]      # the CENTRAL role keeps the shirt, wherever he is drawn
    assert view._line_codes([(0.15, winger, []), (0.50, striker, [])]) == ["Ad", "Pc"]


def _view_of(rows: list[dict]):
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    view.players = rows
    view.rows = rows
    view.clubs = {"Test": {"complete_XIs": "38"}}
    for row in rows:
        row.setdefault("club", "Test")
    return view


def test_the_flank_on_the_badge_is_the_one_he_is_drawn_on():
    """A five-man midfield is a winger on one flank and a wing back on the other, and the marker has to
    say which is which. Inter's 3-5-2 read 'Es' TWICE - Carlos Augusto is left-sided by code and plays
    right wing back, so his own code labelled him on the wrong touchline. The role stays his; the flank
    belongs to the shirt he was given."""
    from euroleghe_ingest.gui import SnapshotView as View

    left_sided = {"desc_real_roles": "ML;DC;DR"}
    assert View.badge(left_sided, 1.0) == "Ed", "drawn on the right, he is the right-sided one"
    assert View.badge(left_sided, -1.0) == "Es"
    assert View.badge(left_sided) == "Es", "with no shirt to speak for him, his own code does"
    # a full back does not become a winger by being moved: only the side mirrors
    assert View.badge({"desc_real_roles": "DR;DC;DL"}, -1.0) == "Ts"
    # and a central role claims no flank, so being drawn wide changes nothing about it
    assert View.badge({"desc_real_roles": "ST"}, -1.0) == "Pc"
    assert View.badge({"desc_real_roles": "MC"}, 1.0) == "C"


def test_a_line_short_of_its_own_men_borrows_a_surplus_and_never_an_empty_shirt():
    """Bayern's 4-5-1 had four midfielders in the M lane and drew TEN men, calling it 4-4-1.

    Two rules make the borrowing safe, and both were found by breaking them: a line lends only what it
    has OVER its own shirts (served in order, a defence with nobody of its own ate the strikers and the
    attack was drawn empty), and it lends from its bench, never its first choice.
    """
    def man(name, codes, role, starts):
        return {"name": name, "role_classic": role, "desc_real_roles": codes,
                "desc_season_starts": str(starts), "desc_start_share": str(starts / 38)}

    rows = ([man("Portiere", "GK", "P", 38)]
            + [man(f"Dif{i}", "DC", "D", 34 - i) for i in range(1, 5)]
            + [man(f"Cen{i}", "MC", "C", 30 - i) for i in range(1, 5)]      # four for five shirts
            + [man("Punta", "ST", "A", 33), man("Ala", "LW", "A", 24), man("Ala2", "LW", "A", 12)])
    view = _view_of(rows)
    eleven = view.eleven("Test", "4-5-1", "typical")
    assert len(eleven) == 11, "a line of the module is a line even when its own men have run out"
    assert {row["name"] for _r, row, _o in eleven} >= {"Punta"}, "the attack keeps its first choice"
    # the fifth midfield shirt goes to a WINGER and not to a centre back: the slot knows its line, not
    # only its flank, and a winger is one step from a midfield where a defender is two
    mids = [row["name"] for role, row, _o in eleven if role == "M"]
    assert "Ala" in mids and not any(name.startswith("Dif") for name in mids)


def test_a_duel_is_spoken_in_real_roles_and_never_in_listone_ones():
    """The listone says what you BUY a man as; a ballottaggio is about where a coach PUTS him.

    Napoli is the whole argument: Politano, Lobotka, Neres and McTominay are all 'C'. So the granular
    codes decide and nothing else does - not the Classic role, and not the flank it implies either, since
    with no codes `side_of` reads the Mantra role, which is the same listone talking again.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    winger = {"name": "Politano", "role_classic": "C", "desc_real_roles": "RW;MR"}
    regista = {"name": "Lobotka", "role_classic": "C", "desc_real_roles": "MC;DM"}
    ala = {"name": "Neres", "role_classic": "C", "desc_real_roles": "RW;LW"}
    unobserved = {"name": "McTominay", "role_classic": "C", "roles_mantra": "m;c"}
    assert View.can_replace(winger, ala), "one shared code is enough"
    assert not View.can_replace(winger, regista), "the same 'C' is not a duel"
    # no observed code -> no duel, in either direction. A gap in the roles, not a fact about the man:
    # `positions --layer roles` is the cure, and a false duel would hide the need for it.
    assert not View.can_replace(winger, unobserved) and not View.can_replace(unobserved, winger)
    assert not View.can_replace(unobserved, dict(unobserved, name="Anguissa"))
    # the other flank is still the second option, and it is still spoken in codes
    assert View.can_replace({"desc_real_roles": "DR"}, {"desc_real_roles": "DL"}, mirrored=True)
    assert not View.can_replace({"desc_real_roles": "DR"}, {"desc_real_roles": "DL"})


def test_an_alternative_is_the_next_man_who_can_take_the_place_never_nobody():
    """Three ways the ballottaggi went silent at Napoli, and all three said "nobody" about a real duel.

    A shirt is not unchallenged because its challengers won shirts of their own, and it is not
    unchallenged because the editors named men who play somewhere else.
    """
    def man(name, codes, role, starts, **extra):
        return dict(name=name, role_classic=role, desc_real_roles=codes,
                    desc_season_starts=str(starts), desc_start_share=str(starts / 38), **extra)

    def mid(name, starts, **extra):
        return man(name, "MC", "C", starts, **extra)

    # A squad that can fill a 4-3-3 without borrowing between the lines, so the midfield is the only
    # question: four central midfielders for three shirts, and the fourth man is the alternative to all
    # three of them.
    others = ([man("Portiere", "GK", "P", 38)]
              + [man(f"Dif{i}", "DC", "D", 30) for i in range(1, 5)]
              + [man(f"Att{i}", "ST", "A", 30) for i in range(1, 4)])
    rows = others + [mid("Uno", 34), mid("Due", 30), mid("Tre", 26), mid("Quattro", 12)]
    view = _view_of(rows)
    rivals = {starter["name"]: [row["name"] for row in more]
              for _role, starter, more in view.eleven("Test", "4-3-3", "typical")}
    assert {name: rivals[name] for name in ("Uno", "Due", "Tre")} == {
        "Uno": ["Quattro"], "Due": ["Quattro"], "Tre": ["Quattro"]}, (
        "collected before the shirts are handed out and filtered after, a starter whose two best "
        "challengers also start was left with no alternative at all")

    # the editors name a man who is not in this duel: it FILTERS the real alternatives, never erases them
    rows = others + [mid("Uno", 34, desc_duel_names="Portiere; Att1"), mid("Due", 30), mid("Tre", 26),
                     mid("Quattro", 12)]
    assert [row["name"] for _r, starter, row_list in _view_of(rows).eleven("Test", "4-3-3", "typical")
            for row in row_list if starter["name"] == "Uno"] == ["Quattro"]
    # and where they name a man who IS, he comes first: a stated fact beats a measured ranking
    rows = others + [mid("Uno", 34, desc_duel_names="Quattro"), mid("Due", 30), mid("Tre", 26),
                     mid("Cinque", 20), mid("Quattro", 12)]
    picked = {starter["name"]: [row["name"] for row in more]
              for _role, starter, more in _view_of(rows).eleven("Test", "4-3-3", "typical")}
    assert picked["Uno"] == ["Quattro"] and picked["Due"] == ["Cinque", "Quattro"]


def test_the_declared_eleven_takes_its_alternatives_from_the_whole_squad():
    """The probabili decide who STARTS. They do not decide who the alternatives are.

    A probability answers "does he play on Sunday", and its absence is not an answer about the shirt:
    Neres, injured on the day, is in no probabili list and is still the man who takes Politano's place.
    Nor may a lane bucket strand a whole line - De Bruyne and Vergara sit in the 'T' lane, and Napoli's
    declared eleven has its ten outfield men in D, M and A.
    """
    def man(name, codes, role, prob=None, starts=20, **extra):
        row = dict(name=name, role_classic=role, desc_real_roles=codes,
                   desc_season_starts=str(starts), desc_start_share=str(starts / 38), **extra)
        if prob is not None:
            row["desc_starter_prob"] = str(prob)
        return row

    rows = [man("Portiere", "GK", "P", 1.0)]
    rows += [man(f"Dif{i}", "DC", "D", 1.0) for i in range(1, 6)]
    rows += [man(f"Cen{i}", "MC", "C", 1.0) for i in range(1, 6)]
    # outside the declared eleven: a trequartista, a man the editors never listed, and an injured one
    rows.append(man("Trequartista", "AM;MC", "C", 0.5))
    rows.append(man("Ignorato", "MC", "C", starts=24))
    rows.append(man("Infortunato", "MC", "C", 0.9, desc_availability_now="injured"))
    view = _view_of(rows)
    eleven = view.eleven("Test", "3-4-2-1", "next")
    assert len(eleven) == 11 and "Trequartista" not in {row["name"] for _r, row, _o in eleven}
    offered = {row["name"] for _role, _starter, others in eleven for row in others}
    assert "Ignorato" in offered, "no probability is not an answer about the shirt"
    assert "Trequartista" in offered, "a lane nobody starts in must not strand its whole bench"
    assert "Infortunato" not in offered, "for the COMING match a man who is out is not an alternative"


def test_the_trend_dot_is_full_only_for_a_full_match_and_carries_the_bonus():
    """Colour says how he played, full-or-hollow whether he was really on the pitch, and a black mark on
    the corner carries the bonus - three questions, three channels that cannot be confused."""
    from euroleghe_ingest.gui import SnapshotView as View

    class Fake:
        def __init__(self):
            self.pixels: dict[tuple[int, int], str] = {}

        def put(self, colour, to):
            for x in range(to[0], to[2]):
                for y in range(to[1], to[3]):
                    self.pixels[(x, y)] = colour

    solid, hollow = Fake(), Fake()
    View._dot(solid, 0, 0, "#66bb6a")
    View._dot(hollow, 0, 0, "#66bb6a", hollow=True)
    assert solid.pixels[(4, 4)] == "#66bb6a"          # the middle is filled in
    assert (4, 4) not in hollow.pixels                # and hollow when he played less than 75'
    assert hollow.pixels[(0, 3)] == "#66bb6a"         # same colour on the ring: it still means the band
    assert (2, 3) not in hollow.pixels                # a two-pixel ring, not an outline

    # a friendly: five pixels instead of eight, centred in the same cell, and never a band colour
    small = Fake()
    View._dot(small, 0, 0, "#9e9e9e", small=True)
    assert small.pixels[(4, 4)] == "#9e9e9e"
    assert (0, 0) not in small.pixels and (7, 7) not in small.pixels
    assert max(x for x, _y in small.pixels) == 6 and min(x for x, _y in small.pixels) == 2

    goal, assist = Fake(), Fake()
    View._bonus(goal, 0, scored=True)
    View._bonus(assist, 0, scored=False)
    # both marks are black and sit on the dot's top-right corner; the goal's is the bigger one
    assert goal.pixels[(5, 2)] == assist.pixels[(6, 1)] == "#000000"
    assert len(goal.pixels) > len(assist.pixels)
    assert max(x for x, _y in goal.pixels) == max(x for x, _y in assist.pixels) == 7


def test_the_trend_bar_says_four_things_and_never_confuses_them():
    """Height = the voto, hollow = that voto is synthetic, a plinth = he did not play, purple = xG+xA.

    A bar is read at ten pixels wide, so every channel has to be a different KIND of mark and not a
    shade of another. The one that matters most is the plinth: an absence drawn as a short bar would
    read as a bad match, and «he did not play» and «he played badly» are the two facts an auction must
    not confuse - the first is availability, which is 90% of the variance of fantapunti.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    class Fake:
        def __init__(self, width=200, height=20):
            self.pixels: dict[tuple[int, int], str] = {}
            self._size = (width, height)

        def width(self):
            return self._size[0]

        def height(self):
            return self._size[1]

        def put(self, colour, to):
            for x in range(to[0], to[2]):
                for y in range(to[1], to[3]):
                    self.pixels[(x, y)] = colour

    image = Fake()
    View._bar(image, 0, 4, 8, 10, "#66bb6a", hollow=False)
    assert image.pixels[(4, 8)] == "#66bb6a", "a real voto fills its bar"
    hollow = Fake()
    View._bar(hollow, 0, 4, 8, 10, "#66bb6a", hollow=True)
    assert (4, 8) not in hollow.pixels, "a SYNTHETIC voto is the same colour, drawn hollow"
    assert hollow.pixels[(0, 4)] == hollow.pixels[(7, 13)] == "#66bb6a"

    # ...and the same four channels through the real drawing, which is what the panel calls.
    class Panel(View):
        def __init__(self):
            pass

    import tkinter as tk
    made: list[Fake] = []
    original = tk.PhotoImage
    tk.PhotoImage = lambda width, height: made.append(Fake(width, height)) or made[-1]
    try:
        Panel()._histogram(
            "2026-05-01|serie_a|Lazio|A|p|90|1|7.0|real|7.0|0|0|0|0|0.5|1"
            ";2026-05-08|serie_a|Como|H|b|||||||||||1"
            ";2026-05-15|serie_a|Roma|A|p|90|1|6.0|synth||0|0|||0.0|0")
    finally:
        tk.PhotoImage = original
    drawn = made[-1]
    column = {y: colour for (x, y), colour in drawn.pixels.items() if x == 1}
    assert View.vote_band(7.0) in column.values(), "the height is coloured by the voto's own band"
    bench = {y for (x, y), colour in drawn.pixels.items()
             if x == View.BAR_W + 1 and colour == View.ABSENT_BAR["b"]}
    assert bench == {View.BAR_H - 2, View.BAR_H - 1}, "an absence is a two-pixel plinth, never a bar"
    assert View.XGA_COLOUR in drawn.pixels.values(), "xG+xA is a layer of its own beside the bar"
    outside = [(x, y) for (x, y), colour in drawn.pixels.items()
               if y == View.BAR_H + 1 and colour == theme.color("text_faint")]
    assert outside and all(x >= 2 * View.BAR_W for x, _y in outside), \
        "only the third round is outside the euro calendar, and it says so under its own bar"


def test_the_shape_decides_where_a_man_is_drawn_and_not_his_own_code(monkeypatch):
    """A front three is right, centre, left - and the shirts were handed out reading every code each man
    has (`slot_cost`). Re-deciding the side at drawing time from the PRIMARY code alone threw that away:
    Napoli's attack drew Politano - Neres - Hojlund because Politano and Neres are both 'RW', so the two
    wingers took the outer slots between them and the CENTRE-FORWARD was pushed onto the left wing, with
    the shape's own answer already computed and discarded."""
    rows = [
        {"name": "Keeper", "desc_real_roles": "GK", "role_classic": "P", "share": 0.9},
        {"name": "Back R", "desc_real_roles": "DR", "role_classic": "D", "share": 0.8},
        {"name": "Back C1", "desc_real_roles": "DC", "role_classic": "D", "share": 0.8},
        {"name": "Back C2", "desc_real_roles": "DC", "role_classic": "D", "share": 0.8},
        {"name": "Back L", "desc_real_roles": "DL", "role_classic": "D", "share": 0.8},
        {"name": "Mid 1", "desc_real_roles": "MC", "role_classic": "C", "share": 0.8},
        {"name": "Mid 2", "desc_real_roles": "MC", "role_classic": "C", "share": 0.7},
        {"name": "Mid 3", "desc_real_roles": "DM", "role_classic": "C", "share": 0.6},
        # the Napoli case: two men whose primary code is the RIGHT wing, one centre-forward
        {"name": "Politano", "desc_real_roles": "RW;MR", "role_classic": "C", "share": 0.68,
         "desc_side_measured": "0.72"},
        {"name": "Neres", "desc_real_roles": "RW;LW", "role_classic": "C", "share": 0.35,
         "desc_side_measured": "0.32"},
        {"name": "Hojlund", "desc_real_roles": "ST", "role_classic": "A", "share": 0.78,
         "desc_side_measured": "0.006"},
    ]
    view = _view_of(rows)
    view._calendar = {}
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim",
                        lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))
    eleven = view.eleven("Test", "4-3-3", "typical")
    lanes, _geometry, _drawn = view.lanes_for(eleven)
    placed = view._placed(view._lane(lanes["A"], "A"), "A")
    drawn = [row.get("name") for _x, row, _rivals in placed]
    assert drawn == ["Politano", "Hojlund", "Neres"], (
        "the centre-forward stands in the middle: the slots are R, C, L and he won the C")
    # ...and the drawing is mirrored, so the man in the L slot is on the SCREEN's right
    assert placed[0][0] < placed[1][0] < placed[2][0]
    assert view._slot_side[id(rows[-1])] == "C"


def test_the_preferred_foot_separates_two_centre_backs_and_is_inverted_in_attack(monkeypatch):
    """MEASURED, not assumed (2025-26, repeated on 2024-25): a full back plays his own foot (DL 96%
    left-footed, DR 96% right), a winger plays INVERTED (LW 86% right-footed, RW 69% left), and a nominal
    centre back with no flank in his code still leans - left-footed DCs measured -0.309 mean side and 93%
    of them left of centre. So the foot is the tie-break for men no code separates, and applying the
    defence's rule to a wing would be backwards more often than not."""
    from euroleghe_ingest.gui import SnapshotView as View

    left_footed, right_footed = {"desc_foot": "Left"}, {"desc_foot": "Right"}
    assert View.foot_side(left_footed, "D") < 0 < View.foot_side(right_footed, "D")
    assert View.foot_side(left_footed, "A") > 0 > View.foot_side(right_footed, "A")
    assert View.foot_side({"desc_foot": "Both"}, "D") == 0.0
    assert View.foot_side({}, "M") == 0.0, "no observation is not a claim about his side"

    # two centre backs of one pair: the left-footed one is drawn to the team's LEFT, which is the screen's
    # right - and neither code says a word about the flank
    view = View.__new__(View)
    view.players, view.clubs, view._slot_side, view._calendar = [], {}, {}, {}
    monkeypatch.setattr(View, "presence", lambda _self, _row, _horizon: 0.5)
    monkeypatch.setattr(View, "claim", lambda _self, _row, _horizon="season": 0.5)
    pair = [({"name": "Lefty", "desc_real_roles": "DC", "desc_foot": "Left"}, []),
            ({"name": "Righty", "desc_real_roles": "DC", "desc_foot": "Right"}, [])]
    placed = view._placed(view._lane(pair, "D"), "D")
    assert [row["name"] for _x, row, _rivals in placed] == ["Righty", "Lefty"]


_PERCENT = re.compile(r"^\[snapshot\]\s+(\d{1,3})%")


def test_the_build_percentage_is_measured_monotone_and_drops_what_it_skips(capsys):
    """The panel shows a number, so the number has to mean something: the stages carry MEASURED seconds
    and the percentage is the share of them that is behind us. A build with no refresh must not stop at
    20% - the two network stages leave the denominator - and a stage that finds nothing to fetch leaves
    it too, rather than crediting the cache with work it did not do."""
    from euroleghe_ingest.modules.snapshot import STAGES, Progress

    keys = [key for key, _label, _seconds in STAGES]
    progress = Progress()
    seen = []
    for key in keys:
        progress.stage(key)
    progress.finish()
    for line in capsys.readouterr().out.splitlines():
        if (found := _PERCENT.match(line)):
            seen.append(int(found.group(1)))
    assert seen == sorted(seen), f"the percentage must never go backwards: {seen}"
    assert seen[0] == 0 and seen[-1] == 100

    # no refresh: the two network stages are not in the denominator, so the offline ones fill the bar
    offline = Progress(skip=("refresh", "roles"))
    for key in keys:
        offline.stage(key)
    offline.finish()
    reached = [int(found.group(1)) for found in
               (_PERCENT.match(line) for line in capsys.readouterr().out.splitlines()) if found]
    assert max(reached) == 100
    assert len(reached) == len(keys) - 2 + 1, "a skipped stage announces nothing"

    # a warm cache: `tick(0, 0)` means "nothing to fetch", and the stage leaves the denominator
    warm = Progress()
    warm.stage("refresh")
    warm.stage("roles")
    before = sum(warm.cost.values())
    warm.tick(0, 0)
    assert "roles" not in warm.cost and sum(warm.cost.values()) < before
    assert "nothing to fetch" in capsys.readouterr().out


def test_the_table_colours_a_role_and_a_number_against_the_sheets_mean(tmp_path):
    """The squad table is a CANVAS because a Treeview in Tk 8.6 colours a row and nothing smaller (there is
    no `tag cell`), and its cells carry two things plain text cannot say: a role belongs to its line's
    colour - the same palette the pitch badges use, so board and table speak one language - and a number
    is read against the SHEET'S MEAN, over every player of every club (green above it, red below), with
    `inj` inverted because missing more of a season than the average man is the bad news."""
    import tkinter as tk

    from euroleghe_ingest.gui import SnapshotView as View

    try:
        root = tk.Tk()
    except tk.TclError:
        import pytest
        pytest.skip("no display available")
    root.withdraw()
    try:
        from euroleghe_ingest import ui_theme as theme

        view = View.__new__(View)
        view.table_body = tk.Canvas(root)
        view.table_head = tk.Canvas(root)
        view._sparks = []
        # the reference is a measurement over the whole sheet; here it is given, so what is under test is
        # the READING of it and not the arithmetic of a mean
        view._means = {"surplus": 5.0, "inj": 0.20}
        rows = [{"name": "Above", "role_classic": "A", "roles_mantra": "pc;a",
                 "engine_surplus": "12.4", "desc_real_roles": "ST"},
                {"name": "Below", "role_classic": "D", "roles_mantra": "dc",
                 "engine_surplus": "3.1", "desc_real_roles": "DC"}]
        for index, row in enumerate(rows):
            view._draw_cell("surplus", "num", row["engine_surplus"], 0, index * View.ROW_H,
                            44, "e", row, _number(row["engine_surplus"]))
            view._draw_cell("role", "pill_classic", row["role_classic"], 50, index * View.ROW_H,
                            30, "center", row)
        # ...and the column where a HIGH number is the bad news reads the other way round
        view._draw_cell("inj", "num", "35%", 100, 0, 38, "e", rows[0], 0.35)
        view._draw_cell("inj", "num", "5%", 100, View.ROW_H, 38, "e", rows[1], 0.05)
        by_text = {view.table_body.itemcget(item, "text"): view.table_body.itemcget(item, "fill")
                   for item in view.table_body.find_all()
                   if view.table_body.type(item) == "text"}
        assert by_text["12.4"] == theme.color("ok"), "above the sheet's mean reads positive"
        assert by_text["3.1"] == theme.color("error"), "below it, negative - even though it is > 0"
        assert by_text["35%"] == theme.color("error"), "missing more than the average man is bad news"
        assert by_text["5%"] == theme.color("ok")
        # the pill is a filled shape in the LINE's colour, not text in the theme's foreground
        pills = [item for item in view.table_body.find_all()
                 if view.table_body.type(item) in ("polygon", "rectangle")]
        assert len(pills) == 2
        fills = {view.table_body.itemcget(item, "fill") for item in pills}
        assert fills == {View.CLASSIC_COLOUR["A"][0], View.CLASSIC_COLOUR["D"][0]}
    finally:
        root.destroy()


def test_unticking_a_player_rebuilds_the_eleven_without_him(monkeypatch):
    """The tick is an INPUT: clear it and the board answers the question again without that man - which is
    what an operator asks about a squad he does not own yet, and about a man who is out for two months. It
    must not touch the sheet, and the pitch has to say how many are missing."""
    from euroleghe_ingest.gui import SnapshotView as View

    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("Keeper", "GK", "P", 0.9), ("Back R", "DR", "D", 0.8), ("Back C1", "DC", "D", 0.8),
                ("Back C2", "DC", "D", 0.8), ("Back L", "DL", "D", 0.8), ("Mid 1", "MC", "C", 0.9),
                ("Mid 2", "MC", "C", 0.8), ("Mid 3", "DM", "C", 0.7), ("Wing R", "RW", "C", 0.7),
                ("Wing L", "LW", "C", 0.6), ("Nine", "ST", "A", 0.9), ("Deputy nine", "ST", "A", 0.4)))]
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded = {}, {}, set()
    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    picked = {starter["name"] for _role, starter, _rivals in view.eleven("Test", "4-3-3", "typical")}
    assert "Nine" in picked and "Deputy nine" not in picked

    view._excluded.add("10")            # the centre-forward's fc_id
    again = {starter["name"] for _role, starter, _rivals in view.eleven("Test", "4-3-3", "typical")}
    assert "Nine" not in again, "unticked means the elevens are rebuilt without him"
    assert "Deputy nine" in again, "and his deputy takes the shirt"
    assert len(again) == 11
    assert view.is_excluded(rows[10]) and not view.is_excluded(rows[11])
    # the sheet is untouched: the man is still in the table, which is what the tick is drawn on
    assert rows[10] in view.rows


def test_a_line_may_take_another_lines_starter_if_the_hole_closes_better(monkeypatch):
    """The user's case, by name. The lines are served in order and each used its OWN men first, so
    unticking Gutierrez put a right back (`MR;DR`, 13%) on the left of Napoli's midfield while Spinazzola -
    whose first code IS `ML` - stayed at left back and Olivera, a left back, sat out. The expectation is a
    CHAIN: Spinazzola moves up, Olivera takes the shirt he leaves.

    Accepted only when it improves BOTH axes (`_better_pair`): the fixed shirt fits strictly better, the
    vacated one closes no worse, and the eleven loses no claim. And the LINE comes first in that
    comparison, unlike inside a line - `DR` covers the right flank, but a centre back is not a right
    winger, and reading the flank first offered Atalanta's front three a defender."""
    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("Keeper", "GK", "P", 0.9),
                ("Right back", "DR;DC", "D", 1.0), ("Centre 1", "DC", "D", 1.0),
                ("Centre 2", "DC;DL", "D", 0.97), ("Spinazzola", "ML;DL", "D", 0.78),
                ("Olivera", "DL;DC", "D", 0.52), ("Mazzocchi", "MR;DR", "C", 0.13),
                ("Right wing", "RW;MR", "C", 0.88), ("Mid 1", "MC;AM", "C", 1.0),
                ("Mid 2", "MC;DM", "C", 1.0), ("Gutierrez", "DL;ML", "D", 0.59),
                ("Nine", "ST", "A", 1.0), ("Ten", "AM;MC", "A", 1.0)))]
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded = {}, {}, set()
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    def drawn(shape="4-4-2"):
        return {row["name"]: (role, view._slot_side.get(id(row)))
                for role, row, _rivals in view.eleven("Test", shape, "typical")}

    before = drawn()
    # each man on his FIRST job when the prices tie (`_slot_price`'s half-step): Spinazzola is ML-first
    # and takes the midfield's left, Gutierrez is DL-first and takes the left back's shirt
    assert before["Spinazzola"] == ("M", "L"), "the left of the midfield is his: his first code is ML"
    assert before["Gutierrez"] == ("D", "L")
    assert "Olivera" not in before

    view._excluded.add("4")                       # untick Spinazzola: the left of the midfield opens
    after = drawn()
    assert after["Gutierrez"] == ("M", "L"), "he moves up: ML is in his codes"
    assert after["Olivera"] == ("D", "L"), "and the left back's shirt goes to a left back"
    assert "Mazzocchi" not in after, "a right back on the left of a midfield is not the answer"
    assert len(after) == 11


def test_a_line_reaches_both_touchlines_or_neither(monkeypatch):
    """Two rules of the operator's, and the second sharpened the first. «In un centrocampo a 4, due sono
    sempre esterni, e devono essere esterni di ruolo»: the grid must not be stretched to the touchlines
    when the men are not wide men - Napoli's declared four (`MC`, `MC;DM`, `MC;AM`, `MC;DM`) drew Lobotka
    on the left wing. And «il modulo deve sempre mantenere la simmetria nelle posizioni»: a lopsided row -
    one man on the paint, an empty touchline opposite - is not a position a module has. A single wide man
    was drawn reaching HIS touchline for a while, on the argument that lopsided is information; the
    operator overruled it (Fiorentina's front three: a seconda punta at 0.28, the punta at 0.58, a wing
    back on the left paint). So: BOTH touchlines, or a central block, symmetric about the middle."""
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    view.players, view.clubs, view._slot_side, view._calendar = [], {}, {}, {}
    monkeypatch.setattr(View, "presence", lambda _self, _row, _horizon: 0.5)

    def line(*codes):
        return [({"name": code, "desc_real_roles": code}, []) for code in codes]

    central = view._placed(line("MC", "MC;DM", "MC;AM", "MC;DM"), "M")
    spread = [round(x, 2) for x, _row, _rivals in central]
    assert min(spread) >= View.CENTRAL_MARGIN_MIN, f"four centrals must stay a block: {spread}"
    assert max(spread) <= 1 - View.CENTRAL_MARGIN_MIN

    # two wide men: the touchlines, as before - this is the case the grid was built for
    proper = view._placed(line("MR", "MC", "MC", "ML"), "M")
    assert round(proper[0][0], 2) == View.LINE_MARGIN
    assert round(proper[-1][0], 2) == round(1 - View.LINE_MARGIN, 2)

    # ONE wide man is not a flank pair: the row is a block, symmetric, and no touchline is claimed
    for row in (line("MR", "MC", "MC", "MC"), line("MC", "MC", "MC", "ML")):
        spread = [x for x, _row, _rivals in view._placed(row, "M")]
        assert abs((spread[0] + spread[-1]) / 2 - 0.5) < 1e-9, f"symmetric always: {spread}"
        assert min(spread) >= View.CENTRAL_MARGIN_MIN - 1e-9, f"and no lone man on the paint: {spread}"


def test_a_declared_eleven_is_assigned_to_the_shape_and_never_moves_a_man_for_nothing(monkeypatch):
    """The operator's rules, all three, on the eleven the editors declared:

    * «4 centrocampisti centrali non esistono, massimo 3 - ai lati devono esserci due esterni»: the four's
      flanks go to the men who play there, and this eleven HAS them (Politano `RW;MR`, Santos `LW`) - they
      were only being drawn as a front three while four centrals shared the line;
    * «Hojlund (Pc) non può mai stare sulla trequarti e Santos non può giocare al centro»: the centre-forward
      is the centre-forward and the winger is not a lone striker;
    * «il cambio di linea deve essere un passo obbligato»: nobody leaves his own line unless the shape asked
      for a role the eleven has not got.

    The three cannot be satisfied by a greedy pass, whichever way it orders the flank and the line - the
    numbers are in `_matching`, which is why the eleven is priced and assigned as a WHOLE.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    def man(name, codes, role, probability):
        return {"name": name, "desc_real_roles": codes, "role_classic": role,
                "desc_starter_prob": str(probability), "club": "Test"}

    squad = [man("Meret", "GK", "P", 1.0),
             man("Di Lorenzo", "DR;DC", "D", 1.0), man("Rrahmani", "DC", "D", 1.0),
             man("Olivera", "DL;DC", "D", 1.0),
             man("McTominay", "MC;AM;DM", "C", 1.0), man("Anguissa", "MC;DM", "C", 0.6),
             man("Elmas", "MC;AM", "C", 1.0), man("Lobotka", "MC;DM", "C", 1.0),
             man("Politano", "RW;MR", "C", 1.0), man("Santos", "LW", "C", 1.0),
             man("Hojlund", "ST", "A", 1.0)]
    view = _view_of(squad)
    view._calendar, view._slot_side, view._excluded, view._lanes_final = {}, {}, set(), False
    monkeypatch.setattr(View, "squad", lambda _self, _club: squad)
    codes = {row["name"]: row["desc_real_roles"] for row in squad}

    def drawn(shape):
        eleven = view.eleven("Test", shape, "next")
        assert len(eleven) == 11
        where = {row["name"]: (lane, view._slot_side.get(id(row))) for lane, row, _rivals in eleven}
        # NO central man on a flank, in any shape - and no keeper or defender out of his line either
        assert not [name for name, (_lane, side) in where.items()
                    if side in ("R", "L")
                    and View.sides_of({"desc_real_roles": codes[name]}) == {"C"}
                    and "ST" not in codes[name]]
        # the centre-forward stays a centre-forward, and the winger never plays as one
        assert where["Hojlund"][0] == "A" and where["Hojlund"][1] == "C", where
        assert where["Santos"][1] != "C" or where["Santos"][0] != "A", where
        # nobody is asked to play two lines from where he plays
        for lane, row, _rivals in eleven:
            assert lane == "P" or view._within_reach(row, lane), (lane, row["name"])
        return where

    # A declared 3-4-2-1 - the shape the editors themselves gave: the two wide forwards drop into the four
    # («i due attaccanti esterni possono arretrare e coprire il centrocampo») and the four centrals split
    # over the two central rows («dislocarsi un po' sulla tre quarti e sulla mediana»).
    where = drawn("3-4-2-1")
    assert where["Politano"] == ("M", "R") and where["Santos"] == ("M", "L"), where
    assert where["McTominay"][0] == "T" and where["Elmas"][0] == "T", where
    assert where["Lobotka"][0] == "M" and where["Anguissa"][0] == "M", where

    # ...and asking these same eleven men for a 3-4-3 TRANSFORMS it, which is the operator's own remedy:
    # this squad has no full backs to spare for the four's flanks (its only wide defenders are its back
    # three), so the wingers stay in the four and the four centrals split over the two central rows. What
    # must hold in every case is the invariants above plus this: no midfielder in the back three.
    where = drawn("3-4-3")
    assert {where[name][0] for name in ("Di Lorenzo", "Rrahmani", "Olivera")} == {"D"}, where
    assert {where["Politano"][1], where["Santos"][1]} == {"R", "L"}, where
    assert where["Politano"][0] == where["Santos"][0], "the two wide men stand in the same line"


def test_a_transformed_shape_never_turns_a_winger_into_a_second_striker(monkeypatch):
    """The operator's catch, by name: «3-4-3 non può diventare 3-4-1-2 - Neres (Ad) non può diventare un
    attaccante centrale».

    Napoli's typical eleven has four central midfielders for a midfield four with two flanks, and the
    whole transformation (`_reshape`) plays out on it: a central man cannot hold the four's right (rule
    2), the wide forward drops back into it - «i due attaccanti esterni possono arretrare e coprire il
    centrocampo» (rule 3) - and the front line, thinned, keeps its centre-forward while the winger drops
    onto the trequarti with his flank (rule 4). 3-4-2-1: Hojlund alone, Politano in the four, Neres an
    inside forward - never a 3-4-1-2 with two strikers in a side that has one.

    A module that ASKS for two forwards is untouched: a winger playing off the striker is a real seconda
    punta, and this is about the transformation not inventing one.
    """
    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("Milinkovic", "GK", "P", 0.75),
                ("Di Lorenzo", "DR;DC", "D", 0.94), ("Rrahmani", "DC", "D", 0.91),
                ("Buongiorno", "DC;DL", "D", 0.80),
                ("McTominay", "MC;AM;DM", "C", 0.97), ("Lobotka", "MC;DM", "C", 0.87),
                ("De Bruyne", "AM;MC", "C", 0.72), ("Politano", "RW;MR", "C", 0.72),
                ("Spinazzola", "ML;DL", "D", 0.64),
                ("Hojlund", "ST", "A", 0.88), ("Neres", "RW;LW", "A", 0.60)))]
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    def drawn(shape):
        eleven = view.eleven("Test", shape, "typical")
        assert len(eleven) == 11
        lanes, _geometry, picture = view.lanes_for(eleven)
        where = {row["name"]: (lane, view._slot_side.get(id(row)))
                 for lane, row, _rivals in eleven}
        # the drawn shape is what the LANES say, so the caption and the pitch can never disagree
        assert picture == "-".join(str(len(lanes.get(key, []))) for key in ("D", "M", "T", "A")
                                   if lanes.get(key))
        return picture, where, lanes

    picture, where, lanes = drawn("3-4-3")
    assert picture == "3-4-2-1", where
    assert where["Hojlund"] == ("A", "C"), "the centre-forward is the centre-forward"
    assert where["Neres"][0] == "T", "the winger drops onto the trequarti, he is not a second striker"
    # ...and NOT with a flank SLOT, because the row he lands on has none to give: a trequarti of two is two
    # central places (`SLOT_SHAPE`), and a slot outliving the line that issued it is what had Sabitzer
    # reading 'As' on a trequarti of ONE - «sta giocando sulla trequarti quindi il badge deve mostrare T».
    # It is DROPPED and not made central, so the DRAWING still reads his own flank and puts him on his own
    # side of the row - «Saka gioca come Ad, quindi anche sulla trequarti deve posizionarsi a destra».
    assert where["Neres"][1] is None, "no flank slot outlives the row that issued it"
    trequarti = view._placed(lanes["T"], "T")
    assert view._line_codes(trequarti, "T") == ["T", "T"], "and the markers name no flank the row has not"
    drawn_neres = next(x for x, row, _rivals in trequarti if row["name"] == "Neres")
    assert drawn_neres < 0.5, "a right-sided man stands on the team's right, wherever the row is"
    assert where["Politano"] == ("M", "R"), "the wide forward drops back and COVERS the four's right"
    assert where["Spinazzola"] == ("M", "L")
    row = {name for name, (lane, _side) in where.items() if lane == "M"}
    assert row < {"Politano", "Spinazzola", "McTominay", "Lobotka", "De Bruyne"} and len(row) == 4, where

    # ...and a module whose own attack is a TWO does NOT keep him up front either, which reverses what this
    # test asserted until the operator looked at the same board again: «Neres non è una Sp, è un esterno,
    # non potrebbe mai giocare al centro ... al massimo sulla trequarti». A front two has two CENTRAL
    # places, so a man who plays no central role holds neither of them (rule 6), and the trequarti is
    # exactly where he does go. The previous reading - a winger beside the striker is the seconda punta the
    # module asked for - was a statement about the SHAPE; this one is about the man, and the man wins.
    picture, where, _lanes = drawn("3-4-1-2")
    assert picture == "3-4-2-1", where
    assert where["Hojlund"][0] == "A" and where["Neres"][0] == "T", where

    # A side whose only forwards are wingers is drawn WITH THEM up front: that is the truth about the
    # squad, and an empty front line would be a worse drawing than a narrow one.
    rows[9].update(name="Lang", desc_real_roles="LW;RW")
    picture, where, _lanes = drawn("3-4-3")
    assert where["Lang"][0] == "A" and where["Neres"][0] == "A", where


def test_the_front_line_is_for_forwards_and_the_trequartisti_stand_behind_it(monkeypatch):
    """The operator, on Roma: «Malen ha giocato solo come Pc, perché adesso è schierato come Ad? Dovrebbero
    giocare Dybala e Soulé come trequartisti».

    The module is a 3-4-3 - 39 of the club's 42 elevens, because the provider counts a trequartista among
    the FORWARDS - and the three men are Malen (`RW;ST`), Dybala (`AM;ST`) and Soulé (`AM;RW`). So two
    trequartisti were being drawn as wide forwards, and the punta took a wing because his own codes are
    listed `RW` first. Rule 4a: a place in the front line is a forward's job, and a man whose FIRST code is
    not an attacking place is a trequartista who can also go up, not a forward - he drops to the row his
    depth says. What is left is 3-4-2-1 with the punta alone, which is what the club fields.

    The measurement agrees with the operator against the code order, and that is worth writing down: the
    season heatmap puts Malen at side -0.149 (central) and depth 70.6 (the most advanced man of the three),
    while the actual right winger, Soulé, is at +0.422. `desc_real_roles` is observed on the day the
    snapshot runs and the provider ignores `seasonId`, so its ORDER is a statement about today, not about
    the season the sheet measures.
    """
    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("Svilar", "GK", "P", 1.00),
                ("Mancini", "DC;DR", "D", 0.92), ("N'Dicka", "DC;DL", "D", 0.81),
                ("Hermoso", "DC;DL;DR", "D", 0.78),
                ("Kone", "MC;DM", "C", 0.98), ("Cristante", "MC;DM", "C", 0.91),
                ("Wesley", "DR;ML", "D", 0.85), ("Celik", "DR;MR;DC", "D", 0.82),
                ("Soule", "AM;RW", "A", 0.73), ("Dybala", "AM;ST", "A", 0.65),
                ("Malen", "RW;ST", "A", 0.40)))]
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    lanes, _geometry, picture = view.lanes_for(view.eleven("Roma", "3-4-3", "typical"))
    assert picture == "3-4-2-1", picture
    assert {row["name"] for row, _rivals in lanes["T"]} == {"Dybala", "Soule"}
    front = view._placed(lanes["A"], "A")
    assert [(row["name"], round(x, 2)) for x, row, _r in front] == [("Malen", 0.50)]
    assert view._line_codes(front, "A") == ["Pc"], "the punta is the punta, in the middle of the pitch"
    assert view._slot_side[id(rows[10])] == "C", "and no flank slot survives on a line that has none"

    # ...and a side whose forwards are ALL trequartisti keeps them up front: the truth about the squad
    rows[10].update(name="Baldanzi", desc_real_roles="AM;MC")
    lanes, _geometry, picture = view.lanes_for(view.eleven("Roma", "3-4-3", "typical"))
    assert len(lanes["A"]) >= 1, picture


def test_a_centre_forward_is_never_drawn_as_a_winger(monkeypatch):
    """The operator's second catch, on Atalanta: «Krstovic e Scamacca non possono trasformarsi in As, sono
    Pc e basta».

    Krstovic is an `ST` and nothing else, and he was reading 'As' beside the other striker. Two causes, one
    idea - a place that is not there:
    * the front three's LEFT slot survived in him after the transformation had thinned the line to two, and
      the badge reads the slot to name a flank (a back four's outer men are full backs). A front two has no
      flank slot at all, so the flank was the drawing's invention;
    * and where a line really does have wide places, the man who is not its centre-forward reads as the
      wing he stands on only IF he plays one: a punta centrale in a narrow front line is a seconda punta.

    So the thinned line keeps its centre-forwards and everybody else drops behind them, which is what their
    own codes say and what the operator says too («De Ketelaere e Raspadori possono giocare anche sulla
    trequarti»): Atalanta comes out 3-4-2-1 with Krstovic alone up front - the shape its own probabili
    declare - and the shirt is his, with De Ketelaere (`AM;ST`) the man playing off him.
    """
    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("Carnesecchi", "GK", "P", 0.97),
                ("Djimsiti", "DC;DR", "D", 0.80), ("Scalvini", "DC;DR;DL", "D", 0.72),
                ("Hien", "DC", "D", 0.66),
                ("De Roon", "MC;DM", "C", 0.81), ("Zappacosta", "MR;ML", "D", 0.75),
                ("Ederson", "MC;DM", "C", 0.75), ("Zalewski", "ML;AM", "C", 0.59),
                ("Pasalic", "MC;DM;AM", "C", 0.56),
                ("De Ketelaere", "AM;ST", "A", 0.78), ("Krstovic", "ST", "A", 0.52)))]
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    lanes, _geometry, picture = view.lanes_for(view.eleven("Atalanta", "3-4-3", "typical"))
    assert picture == "3-4-2-1", picture
    front = view._placed(lanes["A"], "A")
    assert [row["name"] for _x, row, _rivals in front] == ["Krstovic"]
    assert view._line_codes(front, "A") == ["Pc"], "the centre-forward, in the middle, and nothing else"
    assert view._slot_side[id(rows[10])] == "C", "no flank slot survives a line that has no flank place"
    assert {row["name"] for _x, row, _rivals in view._placed(lanes["T"], "T")} == {
        "Pasalic", "De Ketelaere"}, "the trequartista-first man drops in behind him"

    # ...and where the line DOES have wide places, only a man who plays one reads as a wing: two pure
    # centre-forwards in a front three are a punta and a SECONDA PUNTA, and it is the wider code that takes
    # the flank when there is one.
    def badged(*spec):
        """The codes a front line of (role, slot the shape gave him) comes out with, by name."""
        view._slot_side = {}
        men = [({"name": f"{code}@{slot}", "desc_real_roles": code, "share": 0.5}, [])
               for code, slot in spec]
        for (row, _rivals), (_code, slot) in zip(men, spec):
            view._slot_side[id(row)] = slot
        drawn = view._placed(men, "A")
        return dict(zip((row["name"] for _x, row, _rivals in drawn),
                        view._line_codes(drawn, "A")))

    # a front three with two punte in it: one keeps the shirt, the other is the SECONDA PUNTA even though
    # the shape gave him a WING - while the man who really plays that wing keeps it, because on a row where
    # the men interchange the PLACE is what pairs a flank code and not the name of the man on the other
    # side («in un attacco a 3 non ci possono essere 2 SP»: the winger is the reason there is only one)
    three = badged(("ST", "C"), ("ST", "R"), ("LW", "L"))
    assert three == {"ST@C": "Pc", "ST@R": "Sp", "LW@L": "As"}, three
    # ...where BOTH wings are really played, both stand: the pair is what makes them positions
    both = badged(("ST", "C"), ("ST;RW", "R"), ("LW", "L"))
    assert both == {"ST@C": "Pc", "ST;RW@R": "Ad", "LW@L": "As"}, both


def test_the_module_never_loses_its_symmetry_to_a_second_opinion(monkeypatch):
    """«Il modulo non può perdere la simmetria», on Liverpool's 4-5-1, and the cause is one line of code.

    The eleven is ASSIGNED to the shape's own places and every one of them is priced (`_assign`): Gakpo
    (`LW`) got the five's LEFT flank because that is who covers a midfield flank when the squad has no left
    midfielder, and Gravenberch (`MC;DM`) got the back four's second centre because a mediano dropping in
    costs less than a right back switching flank. Then the lanes were re-read from each man's FIRST code -
    a leftover from before the assignment existed - and both decisions were thrown away: Gakpo drawn in the
    attack, Gravenberch in the midfield. The board came out a back THREE, a five squeezed into the right
    half with its left touchline empty, and a front two of two left-sided men.

    So the re-read keeps exactly the one move it is for - a CENTRAL midfielder one row forward onto the
    trequarti, the 4-5-1 that is really a 4-4-1-1 - and nothing else. What it must never do is empty a
    place the shape asked somebody to cover.
    """
    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("Alisson", "GK", "P", 1.00),
                ("Van Dijk", "DC", "D", 1.00), ("Bradley", "DR;MR", "D", 0.69),
                ("Kerkez", "DL", "D", 0.67), ("Frimpong", "MR;DR", "D", 0.54),
                ("Szoboszlai", "AM;MC", "C", 0.95), ("Gravenberch", "MC;DM", "C", 0.90),
                ("Mac Allister", "MC;DM", "C", 0.80), ("Jones C.", "MC;DM", "C", 0.62),
                ("Gakpo", "LW", "A", 0.85), ("Wirtz", "AM;LW", "C", 0.80)))]
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    lanes, _geometry, picture = view.lanes_for(view.eleven("Liverpool", "4-5-1", "typical"))
    assert picture == "4-5-1", picture
    for lane, wanted in (("D", 4), ("M", 5), ("A", 1)):
        drawn = view._placed(lanes[lane], lane)
        # every place the module names is covered, and the row reaches BOTH touchlines or neither
        assert {view._slot_side.get(id(row)) for _x, row, _r in drawn} == set(
            view.slot_shape(lane, wanted)), (lane, [row["name"] for _x, row, _r in drawn])
        spread = [x for x, _row, _r in drawn]
        assert abs((spread[0] + spread[-1]) / 2 - 0.5) < 1e-9, f"{lane} is lopsided: {spread}"
    assert {row["name"] for _x, row, _r in view._placed(lanes["M"], "M")} == {
        "Frimpong", "Szoboszlai", "Gravenberch", "Mac Allister", "Gakpo"}, "the winger keeps the flank"
    # ...and the compromise the fit chose is drawn where it was made: a mediano at centre back, because this
    # squad has one proper centre back and a mediano dropping in costs less than a full back switching. It
    # falls on the WEAKEST of the equals (Jones 0.62, not Gravenberch 0.90), and of the two right backs the
    # MR-first one takes the five's right, the DR-first one the four's (`_slot_price`'s first-code half-step).
    assert {row["name"] for row, _rivals in lanes["D"]} == {
        "Bradley", "Van Dijk", "Jones C.", "Kerkez"}


def test_a_rows_flank_is_contested_by_everybody_who_plays_there(monkeypatch):
    """Measured on Bologna's 4-5-1: the row of five took a `MR` at 0.44 for its right and a CENTRE BACK for
    its left, while Orsolini (`RW`, 0.64) and Cambiaghi (`LW`, 0.53) - the two men who actually play those
    places - never competed for them, because a winger's codes only ever put him in the attack's pool. A
    bucket was deciding a side.

    «I due attaccanti esterni possono arretrare e coprire il centrocampo», one step earlier than `_reshape`
    rule 3: at SELECTION. Still the claim's question - a rival takes the shirt only from a weaker man, and
    only if his own line can spare him - which is what keeps a 0% man off a flank he happens to fit.
    """
    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("Skorupski", "GK", "P", 0.74),
                ("Miranda", "DL", "D", 0.79), ("Lucumi", "DC", "D", 0.75),
                ("Heggem", "DC;DL", "D", 0.69), ("Zortea", "DR;MR", "D", 0.53),
                ("Freuler", "MC;DM", "C", 0.75), ("Moro", "MC;DM", "C", 0.53),
                ("Ferguson", "MC;DM;AM", "C", 0.47), ("Bernardeschi", "RW;MR", "C", 0.44),
                ("Castro", "ST", "A", 0.69), ("Orsolini", "RW", "C", 0.64),
                ("Cambiaghi", "LW;AM;ST", "A", 0.53), ("Rowe", "LW;RW", "C", 0.48),
                ("Pobega", "MC;DM", "C", 0.46)))]
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    lanes, _geometry, picture = view.lanes_for(view.eleven("Bologna", "4-5-1", "typical"))
    assert picture == "4-5-1", picture
    row = {r["name"]: view._slot_side.get(id(r)) for r, _rivals in lanes["M"]}
    assert row.get("Orsolini") == "R", f"the best right-sided man takes the right: {row}"
    assert row.get("Cambiaghi") == "L", f"and the only left-sided man the left: {row}"
    assert "Heggem" not in row, "no centre back covering a wing of the midfield"
    assert {name for name, side in row.items() if side == "C"} == {"Freuler", "Moro", "Ferguson"}
    assert {r["name"] for r, _rivals in lanes["A"]} == {"Castro"}, "and the attack keeps its striker"

    # the guard: a flank man is not worth a shirt at any price. Drop Orsolini to a squad player's claim and
    # the row keeps the man it had - «chi gioca lo decide il claim», and Touré at 0.00 stays out.
    rows[10]["share"] = 0.05
    lanes, _geometry, _picture = view.lanes_for(view.eleven("Bologna", "4-5-1", "typical"))
    row = {r["name"]: (view._slot_side.get(id(r)), r["share"]) for r, _rivals in lanes["M"]}
    assert "Orsolini" not in row, row
    assert min(share for _side, share in row.values()) >= 0.44, "nobody weaker than the man he replaced"
    assert {side for side, _share in row.values()} >= {"R", "L"}, "and both flanks are still covered"


def test_a_midfield_row_is_never_more_than_five(monkeypatch):
    """The operator's ceiling: «una linea di centrocampo a 5 è già il massimo». Six men across a pitch is
    not a midfield, it is two rows drawn as one - the vocabulary says so itself, since a 3-4-2-1 fields six
    midfielders in the P/D/C/A sense and nobody draws them in a line.

    Both ways in are the same drawing and both are capped: a module that ASKS for six (a measured shape
    rounded to 3-6-1), and a five that the transformation sends a sixth man back into. Who goes forward is
    the most advanced by his own codes - the trequartista, never the mediano."""
    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("Keeper", "GK", "P", 0.99),
                ("Centre 1", "DC", "D", 0.95), ("Centre 2", "DC", "D", 0.90),
                ("Centre 3", "DC;DL", "D", 0.85),
                ("Right wing back", "MR;DR", "D", 0.80), ("Left wing back", "ML;DL", "D", 0.75),
                ("Mediano", "DM;MC", "C", 0.94), ("Regista", "MC;DM", "C", 0.92),
                ("Mezzala", "MC", "C", 0.70), ("Trequartista", "AM;MC", "C", 0.65),
                ("Nine", "ST", "A", 0.88)))]
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    lanes, _geometry, picture = view.lanes_for(view.eleven("Test", "3-6-1", "typical"))
    assert len(lanes["M"]) <= View.MIDFIELD_ROW, picture
    assert picture == "3-5-1-1", picture
    assert [row["name"] for row, _rivals in lanes["T"]] == ["Trequartista"], "the most advanced man goes"
    assert {view._slot_side.get(id(row)) for row, _rivals in lanes["M"]} == {"R", "C", "L"}, \
        "and the row keeps its flanks: a wing back on the trequarti would empty the one he covers"


def test_a_midfield_row_gets_two_flank_men_of_role_and_never_a_centre_back(monkeypatch):
    """Two of the operator's rules on the same row, and they pull in opposite directions.

    «Servono sempre due esterni di centrocampo di ruolo»: Lille's five came out as five centrali, because
    the row held Correia (`LW;RW`) - who covers either touchline and can still only stand on one - so the
    other flank went to a central man, rule 2 vacated it and rule 3 cannot cover it behind a lone striker.
    The claim stops deciding there and the man who plays the flank takes it, up to `FLANK_OVERRIDE_GAP`.

    «Non è realistico che un Dc sia schierato a centrocampo»: what may NOT take it is a centre back whose
    second code happens to name a side. Manchester United gave the five's left to Martinez (`DC;DL`, 0.62)
    over Dorgu (`ML;DL`, 0.60) - two hundredths of claim - and Stuttgart's to Jeltsch (`DC;DR`). The depth
    gate cannot separate them (a centre back and a full back both stand at 0.25, exactly one line from a
    midfield); the PRIMARY code can, and it is the only thing that does.
    """
    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("Keeper", "GK", "P", 0.95),
                ("Right back", "DR", "D", 0.79), ("Centre 1", "DC;DR", "D", 0.81),
                ("Centre 2", "DC", "D", 0.68), ("Left back", "DL", "D", 0.76),
                ("Regista", "MC;DM", "C", 0.86), ("Mezzala", "MC;DM", "C", 0.76),
                ("Mediano", "MC;DM", "C", 0.53), ("Central", "MC", "C", 0.33),
                ("Two-flank winger", "LW;RW", "C", 0.68),
                ("Trequartista", "AM", "C", 0.83),
                ("Right winger", "RW", "C", 0.12),          # nobody's first choice, and of ROLE
                ("Centre back", "DC;DL", "D", 0.31)))]      # a flank in his codes, not in his trade
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    lanes, _geometry, _picture = view.lanes_for(view.eleven("Test", "4-5-1", "typical"))
    row = {name: view._slot_side.get(id(next(entry[0] for entry in lanes["M"]
                                             if entry[0]["name"] == name)))
           for name in (man["name"] for man, _rivals in lanes["M"])}
    assert sorted(side for side in row.values() if side in ("R", "L")) == ["L", "R"], row
    assert "Right winger" in row, "the flank nobody covered goes to the man whose job it is"
    assert "Centre back" not in row, "and a centre back is not that man, whatever his second code says"
    # the man who can do either flank keeps one of them, and the override paid for the other
    assert row["Two-flank winger"] in ("R", "L"), row
    assert View.FLANK_OVERRIDE_GAP >= 0.33 - 0.12, "the ceiling has to admit the swap it was measured on"


def test_the_mediano_stands_in_the_middle_of_his_row(monkeypatch):
    """«Rodri è una M, le M vanno piazzate al centro della linea».

    Which men of a row are WIDE is decided by the shape and the codes; among the central ones nothing said
    who holds the middle, so it fell through to the foot and the claim - and Manchester City's five drew
    Rodri (`DM`) second from the touchline with a mezzala in the middle of it. The row is filled from the
    outside in, so what ends up in the middle is the man whose own first code is the deepest.
    """
    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("Donnarumma", "GK", "P", 0.89),
                ("Matheus", "DR", "D", 0.86), ("Guehi", "DC", "D", 0.84),
                ("Ruben Dias", "DC", "D", 0.82), ("O'Reilly", "DL", "D", 0.80),
                ("Semenyo", "LW;RW", "C", 0.85), ("Rodri", "DM;MC", "C", 0.84),
                ("Nico Gonzalez", "MC;DM", "C", 0.50), ("Reijnders", "MC;DM;AM", "C", 0.48),
                ("Gvardiol", "DL;DC", "D", 0.73), ("Haaland", "ST", "A", 0.89)))]
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    lanes, _geometry, picture = view.lanes_for(view.eleven("Test", "4-5-1", "typical"))
    assert picture == "4-5-1", picture
    drawn = view._placed(lanes["M"], "M")
    order = [row["name"] for _x, row, _rivals in drawn]
    assert order[len(order) // 2] == "Rodri", order
    assert view._line_codes(drawn, "M")[len(order) // 2] == "M", "and the marker says what he is"


def test_a_front_three_of_punte_recruits_the_wings_it_needs(monkeypatch):
    """The operator, on Fiorentina: «in un attacco a 3 non ci possono essere 2 SP, servono 2 attaccanti
    esterni o 2 ali».

    Kean, Gudmundsson and Piccoli are three centre-forwards, so the shape's two WIDE places were held by
    punte and the badge said Pc + Sp + Sp - which is not an attack. A row's flank is already a job the men
    who do it compete for (`_flanked`), and here the CLAIM stops deciding: the wide places go to the wingers
    even at 0.31 and 0.27 against 0.52 and 0.70, a cost the operator has taken in the open.

    The trigger is TWO punte and no wide man in the line, and nothing looser, because the same override on
    one uncovered flank cost two boards the operator had already ruled on: Atalanta lost Krstovic (0.52, its
    only centre-forward) to a winger at 0.33 for a line the transformation then thinned to one man anyway,
    and Roma went back to a front three after «dovrebbero giocare Dybala e Soulé come trequartisti». With
    the trigger as it stands, Fiorentina is the only board of 108 that moves.
    """
    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("De Gea", "GK", "P", 0.97),
                ("Dodo", "DR;MR", "D", 0.94), ("Pongracic", "DC;DR", "D", 0.85),
                ("Ranieri", "DC;DL", "D", 0.72), ("Gosens", "ML;DL", "D", 0.70),
                ("Fagioli", "MC;DM", "C", 0.77), ("Mandragora", "MC;DM", "C", 0.75),
                ("Ndour", "MC;DM", "C", 0.55),
                ("Kean", "ST", "A", 0.84), ("Gudmundsson", "ST;AM", "C", 0.70),
                ("Piccoli", "ST", "A", 0.52),
                ("Solomon", "LW", "A", 0.31), ("Harrison", "RW;MR", "C", 0.27)))]
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    lanes, _geometry, _picture = view.lanes_for(view.eleven("Test", "4-3-3", "typical"))
    front = view._placed(lanes["A"], "A")
    drawn = dict(zip((row["name"] for _x, row, _r in front), view._line_codes(front, "A")))
    assert drawn == {"Harrison": "Ad", "Kean": "Pc", "Solomon": "As"}, drawn

    # ...and with ONE punta in the line the claim decides again, which is Atalanta's case: two trequartisti
    # beside the centre-forward are not two wings left uncovered, and rule 4 is what has them. Krstovic
    # (0.52) keeps the shirt the looser trigger handed to a winger at 0.33.
    rows[8].update(name="De Ketelaere", desc_real_roles="AM;ST", share=0.78)
    rows[9].update(name="Pasalic", desc_real_roles="MC;DM;AM", share=0.56)
    rows[10].update(name="Krstovic", desc_real_roles="ST", share=0.52)
    rows[11].update(share=0.10)                                   # Solomon, a winger nobody plays
    lanes, _geometry, _picture = view.lanes_for(view.eleven("Test", "4-3-3", "typical"))
    assert {row["name"] for row, _rivals in lanes["A"]} == {"Krstovic"}, "the punta keeps his shirt"
    assert "Solomon" not in {row["name"] for men in lanes.values() for row, _r in men}, \
        "and no wing is recruited for a line that is not holding two punte"


def test_a_pure_attacker_is_not_a_wing_back_in_a_back_three(monkeypatch):
    """The operator, on Roma: «Malen dovrebbe giocare come Pc e non come centrocampista esterno».

    Found comparing the boards with the press's 2026-27 typical formations (08/08/2026). In a module
    whose back line has no flank places, the midfield's wide places are the WHOLE touchline - the
    press mans Roma's right one with Molina or Rensch, both full backs - and `_flanked` handed it to
    Malen (`RW;ST`, 0.391) over Rensch (`DR;MR`, 0.363), because among everybody who plays a side the
    claim alone decided. A pure attacker does not become an esterno a tutta fascia by 0.03 of claim:
    on a wing-back row the rival must hold a D/M flank code (`_wing_back_trade`). Malen goes back to
    the attack's bench, where his shirt is the punta's - which is what the press's own ballottaggio
    says (Malen vs Castro). The guard this must NOT undo is Bologna's: in front of a back FOUR the
    wide places stay open to wingers (Orsolini's 4-5-1 right), so the same squad drawn 4-4-2 keeps
    recruiting its winger.
    """
    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("Svilar", "GK", "P", 0.86),
                ("Mancini", "DC;DR", "D", 0.80), ("N'Dicka", "DC;DL", "D", 0.71),
                ("Hermoso", "DC;DL;DR", "D", 0.68),
                ("Wesley", "DR;ML", "D", 0.74), ("Rensch", "DR;MR", "D", 0.36),
                ("Cristante", "MC;DM", "C", 0.79), ("Kone", "MC;DM", "C", 0.78),
                ("Pisilli", "MC;DM", "C", 0.37),
                ("Soule", "AM;RW", "A", 0.65), ("Dybala", "AM;ST", "A", 0.53),
                ("Castro", "ST", "A", 0.50), ("Malen", "RW;ST", "A", 0.39)))]
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    eleven = view.eleven("Test", "3-4-3", "typical")
    where = {starter["name"]: lane for lane, starter, _rivals in eleven}
    assert where.get("Malen") != "M", f"a RW;ST holds no wing-back place: {where}"
    middles = {starter["name"] for lane, starter, _rivals in eleven if lane == "M"}
    assert {"Wesley", "Rensch"} & middles or {"Wesley"} <= middles, \
        f"the touchline belongs to men whose codes do the job: {middles}"
    # ...and the punta's shirt stays a duel between the punte: Malen is Castro's rival, not a wing back
    front = {starter["name"]: {r.get("name") for r in rivals}
             for lane, starter, rivals in eleven if lane == "A"}
    assert "Malen" in front or any("Malen" in rivals for rivals in front.values()), front

    # The Bologna guard: the SAME wide forward is still recruited where full backs stand behind him.
    four_four_two = [{"fc_id": str(index), "name": name, "desc_real_roles": codes,
                      "role_classic": role, "share": share}
                     for index, (name, codes, role, share) in enumerate((
                         ("Skorupski", "GK", "P", 0.90),
                         ("Holm", "DR", "D", 0.70), ("Beukema", "DC", "D", 0.80),
                         ("Lucumi", "DC", "D", 0.78), ("Miranda", "DL", "D", 0.72),
                         ("Freuler", "MC;DM", "C", 0.80), ("Ferguson", "MC;AM", "C", 0.75),
                         ("Moro", "MC;DM", "C", 0.50), ("Fabbian", "MC;AM", "C", 0.45),
                         ("Orsolini", "RW", "A", 0.64), ("Castro", "ST", "A", 0.70),
                         ("Cambiaghi", "LW", "A", 0.53)))]
    view = _view_of(four_four_two)
    view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
    monkeypatch.setattr(View, "squad", lambda _self, _club: four_four_two)
    eleven = view.eleven("Test", "4-4-2", "typical")
    middles = {starter["name"] for lane, starter, _rivals in eleven if lane == "M"}
    assert "Orsolini" in middles, f"in front of a back four the winger still takes the wide place: {middles}"


def test_a_four_five_one_whose_five_plays_ahead_of_itself_is_a_four_two_three_one(monkeypatch):
    """The operator, on Bayern and Barcelona at once: «spesso scambi il 4-2-3-1 con il 4-5-1».

    The source cannot tell them apart - the provider publishes three lines per eleven, so 4-5-1 is the
    commonest string in the whole repertoire (1746 of 4812 complete elevens) and every side with two mediani
    behind three attacking men arrives as one. The twelve codes can, which is what the grid is for, so the
    ROW is counted: Bayern's five is Olise (`RW`), Gnabry (`LW;AM`) and Luis Diaz (`LW`) around Kimmich and
    Pavlovic, i.e. a majority that plays ahead of it, and the board must draw 4-2-3-1 with those three on
    the trequarti - «Olise, Diaz e Gnabry sulla trequarti».

    A MAJORITY, because one or two wide forwards in a midfield row is the operator's other rule and not a
    mistake («i due attaccanti esterni possono arretrare e coprire il centrocampo»): with one of the three
    replaced by a real wide midfielder the five stays a five.
    """
    rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
             "share": share}
            for index, (name, codes, role, share) in enumerate((
                ("Neuer", "GK", "P", 0.79),
                ("Laimer", "DR", "D", 0.74), ("Tah", "DC", "D", 0.66),
                ("Upamecano", "DC", "D", 0.61), ("Stanisic", "DR;DC;DL", "D", 0.76),
                ("Kimmich", "MC;DM", "C", 0.82), ("Pavlovic", "MC;DM", "C", 0.51),
                ("Olise", "RW", "C", 0.76), ("Luis Diaz", "LW", "A", 0.80),
                ("Gnabry", "LW;AM", "A", 0.55), ("Kane", "ST", "A", 0.83)))]
    view = _view_of(rows)
    view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
    from euroleghe_ingest.gui import SnapshotView as View

    monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
    monkeypatch.setattr(View, "presence", lambda _self, row, _horizon: row.get("share", 0.0))
    monkeypatch.setattr(View, "claim", lambda _self, row, _horizon="season": row.get("share", 0.0))
    monkeypatch.setattr(View, "titolarita", lambda _self, row, _horizon: (0.0, row.get("share", 0.0)))

    lanes, _geometry, picture = view.lanes_for(view.eleven("Test", "4-5-1", "typical"))
    assert picture == "4-2-3-1", picture
    assert {row["name"] for row, _rivals in lanes["M"]} == {"Kimmich", "Pavlovic"}, "the two mediani"
    assert {row["name"] for row, _rivals in lanes["T"]} == {"Olise", "Gnabry", "Luis Diaz"}
    assert [row["name"] for row, _rivals in lanes["A"]] == ["Kane"]
    # the trequarti is a LINE and it is drawn as one: its two wide places are named, in pairs, and the row
    # reaches both touchlines (`_paired`, and rule 2's exemption for a row whose men interchange)
    front = view._placed(lanes["T"], "T")
    assert dict(zip((row["name"] for _x, row, _r in front),
                    view._line_codes(front, "T"))) == {"Olise": "Ad", "Gnabry": "T", "Luis Diaz": "As"}

    # ...and TWO attacking men in the row is a cover, not a line: the five stays a five, which is the case
    # `_reshape` rule 3 exists for.
    rows[9].update(name="Kimmich II", desc_real_roles="MC;ML", role_classic="C")
    _lanes, _geometry, picture = view.lanes_for(view.eleven("Test", "4-5-1", "typical"))
    assert picture == "4-5-1", picture


def test_a_tooltip_never_leaves_the_screen():
    """They did, and often: the tip's corner was pinned at the pointer, and the columns carrying the
    longest help sit at the RIGHT of the table while the plates sit at the BOTTOM of the pitch - so the
    text ran off both edges. Measured first, then flipped to the other side of the pointer (and only
    clamped for a tip taller than the screen), because a tip pinned to the edge covers the very cell it
    is describing."""
    import tkinter as tk

    from euroleghe_ingest import gui

    try:
        root = tk.Tk()
    except tk.TclError:
        import pytest
        pytest.skip("no display available")
    root.geometry("400x300+100+100")
    try:
        root.update()
        screen_w, screen_h = root.winfo_screenwidth(), root.winfo_screenheight()
        tip = gui.Tooltip(root, "A very long tooltip. " * 40, delay=1, wraplength=520,
                          anchor="pointer", bind_events=False)
        # the pointer in the bottom-right corner, which is where it used to go wrong
        root.winfo_pointerx = lambda: screen_w - 12
        root.winfo_pointery = lambda: screen_h - 12
        tip._show()
        root.update_idletasks()
        window = tip._tip
        left, top = window.winfo_x(), window.winfo_y()
        assert left >= 0 and top >= 0
        assert left + window.winfo_reqwidth() <= screen_w
        assert top + window.winfo_reqheight() <= screen_h
        tip.hide()
    finally:
        root.destroy()


def test_the_body_reaches_the_sheet_and_decides_nothing():
    """Height and weight come from the same provider payload as the granular codes, so they cost no extra
    request - and they say the one thing `ST` cannot: a punta centrale who plays as a TORRE and one who
    plays on the move are the same code (Hojlund 191 against Boga 172).

    They are DESCRIPTIVE and that is measured, not assumed: over 92 club-seasons where two strikers each
    started five league matches, the more used of the two is the taller one 44 times (48%) - a coin. So the
    sheet carries them, the plate shows them, and nothing selects on them (gate §5-terdecies)."""
    from euroleghe_ingest.gui import SnapshotView as View
    from euroleghe_ingest.modules import positions

    entry = positions._role_entry({"id": 7, "positionsDetailed": ["ST"], "position": "F",
                                   "preferredFoot": "Right", "height": 191, "weight": 84})
    assert entry["height"] == 191 and entry["weight"] == 84
    # ...and a payload without them is not a payload with zeros
    thin = positions._role_entry({"id": 8, "positionsDetailed": ["LW"], "position": "F"})
    assert thin["height"] is None and thin["weight"] is None

    assert "desc_height" in snapshot.PLAYER_COLUMNS and "desc_weight" in snapshot.PLAYER_COLUMNS
    assert View.build({"desc_height": "191", "desc_weight": "84"}) == "191 cm · 84 kg"
    assert View.build({"desc_height": "172"}) == "172 cm", "as much of it as the provider gave"
    assert View.build({}) == ""

    # the price of a place must not read the body: two strikers of the same code cost the same shirt
    view = View.__new__(View)
    tall = {"desc_real_roles": "ST", "desc_height": "191", "desc_weight": "84"}
    small = {"desc_real_roles": "ST", "desc_height": "172"}
    assert view._slot_price(tall, "C", "A") == view._slot_price(small, "C", "A")


def test_the_outer_men_of_a_back_four_are_full_backs_on_the_badge():
    """The operator's rule: «in una linea a 4 di difensori, i due terzini esterni devi segnarli come Ts e Td
    e non come Dc», and the same for a central midfielder holding the right of a five, who reads 'Ed'.

    It is the mirror rule one step further - the role stays his, the FLANK belongs to the shirt - and it is
    what the shape says: a back four HAS two full backs, whoever plays them. A back THREE has three central
    slots and no flanks at all, so its outer men keep 'Dc'."""
    from euroleghe_ingest.gui import SnapshotView as View

    # `drawn_side` is TEAM-relative: +1 is its right, which is the 'R' slot (the screen is mirrored, and
    # that inversion belongs to `_line_codes`, not here).
    centre_back = {"desc_real_roles": "DC"}
    assert View.badge(centre_back, 1.0, "D", slot="R") == "Td"
    assert View.badge(centre_back, -1.0, "D", slot="L") == "Ts"
    assert View.badge(centre_back, 0.9, "D", slot="C") == "Dc", "a back three names no flank"
    assert View.badge(centre_back, None, "D") == "Dc", "and neither does a slot nobody gave"

    # a central midfielder on the right of a five is an esterno destro, not a 'C'
    assert View.badge({"desc_real_roles": "MC;AM"}, 1.0, "M", slot="R") == "Ed"
    assert View.badge({"desc_real_roles": "MC;AM"}, -1.0, "M", slot="L") == "Es"
    # ...while a man whose own code NAMES a flank keeps his role and only mirrors it (unchanged rule)
    assert View.badge({"desc_real_roles": "DL"}, 1.0, "D", slot="R") == "Td"
    assert View.badge({"desc_real_roles": "DL"}, -1.0, "D", slot="L") == "Ts"
    # A CENTRE-FORWARD is where the rule stops, and the operator's own words are why: «Krstovic e Scamacca
    # non possono trasformarsi in As, sono Pc e basta». A terzino is a job a coach gives a centre back for a
    # match; a punta centrale is defined by being central, so a wide place cannot rename him - what it makes
    # him is the seconda punta of a narrow front line - and both that and the wing of a striker who really
    # plays one (`ST;RW`) are decided in `_line_codes`, where the whole line is visible
    # (`test_a_centre_forward_is_never_drawn_as_a_winger`).
    assert View.badge({"desc_real_roles": "ST"}, 1.0, "A", slot="R") == "Pc"
    assert View.badge({"desc_real_roles": "ST;RW"}, 1.0, "A", slot="R") == "Pc"


def test_the_measurement_and_the_code_are_two_things_and_the_weights_are_measured(monkeypatch):
    """The operator's model, and it is the right one: a code is a position the player CAN hold (the provider
    lists what he has covered or could cover, and it reads TODAY), the heatmap is where he ACTUALLY stood.
    Two things that complete each other, weighed - so `_slot_price` pulls each code toward the measured
    point instead of replacing it, per axis, and both weights are swept rather than chosen.

    What this guards is the machinery, not a verdict: the depth axis must be CALIBRATED on the sheet's own
    single-code men (the provider's avg_x means nothing on its own), a man with no heatmap must be priced
    exactly as before, and a weight of zero must leave the price bit-identical - which is what makes the
    swept surface in `HEATMAP_SIDE`'s note a measurement of one thing at a time.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    # a population whose single-code men span the pitch: the fit has to come out monotone in depth
    view.players = ([{"desc_real_roles": "GK", "desc_avg_x": "10"} for _ in range(8)]
                    + [{"desc_real_roles": "DC", "desc_avg_x": "34"} for _ in range(8)]
                    + [{"desc_real_roles": "MC", "desc_avg_x": "51"} for _ in range(8)]
                    + [{"desc_real_roles": "ST", "desc_avg_x": "62"} for _ in range(8)])
    slope, _intercept = view._depth_fit()
    assert slope and slope > 0, "deeper on the provider's axis must mean further up the pitch"
    assert view.measured_point({"desc_avg_x": "10"})[0] < view.measured_point({"desc_avg_x": "62"})[0]
    assert 0.0 <= view.measured_point({"desc_avg_x": "200"})[0] <= 1.0, "and it stays on the grid"
    assert view.measured_point({})[0] is None, "no heatmap, no measured point"

    winger = {"desc_real_roles": "RW", "desc_avg_x": "62", "desc_side_measured": "-0.9"}
    view._depth_cache = (0.0182, -0.28)
    plain = view._slot_price(winger, "R", "A")
    monkeypatch.setattr(View, "HEATMAP_SIDE", 0.0)
    assert view._slot_price(winger, "R", "A") == plain, "weight zero changes nothing at all"
    monkeypatch.setattr(View, "HEATMAP_SIDE", 1.0)
    assert view._slot_price(winger, "R", "A") > plain, \
        "measured on the LEFT, the right of an attack costs him more"
    assert view._slot_price({"desc_real_roles": "RW"}, "R", "A") == \
        view._slot_price({"desc_real_roles": "RW"}, "R", "A"), "and a man with no heatmap is untouched"


def test_the_preseason_is_a_reading_and_never_a_criterion():
    """«Gli undici del nuovo allenatore devono pesare» — the CLAIM half of it, and the answer is measured.

    For an August auction the pre-season is the only football a new coach has played, and on the case the
    operator brought it looks decisive: Atalanta's two friendlies under Sarri were started by Gaetano,
    Samardzic, Scamacca and Raspadori - the four the published prediction fields and the claim does not -
    while De Roon, Ederson and Krstovic, whom the board starts, started NEITHER. Five measured reasons why
    it still cannot decide anything (`snapshot.preseason_starts`): per-player friendlies exist for exactly
    ONE pre-season (1696 rows against 37), so no window can judge another; the sample is 1-3 matches and two
    of seven Serie A clubs with a new coach have none; minutes are missing from 1399 of 1716 rows; the
    fixtures are a U23 side and a Serie C club; and the one source that agrees read the same friendlies.

    So this test asserts the SEPARATION, which is the decision: the plate says it, and nothing that picks a
    side reads it. Same treatment as the body, for the same reason (gate §5-terdecies).
    """
    from euroleghe_ingest import gui
    from euroleghe_ingest.gui import SnapshotView as View
    from euroleghe_ingest.modules import snapshot

    view = View.__new__(View)
    view.clubs = {"Atalanta": {"coach": "Maurizio Sarri"}}
    started = {"name": "Raspadori", "club": "Atalanta", "desc_real_roles": "ST;AM",
               "desc_preseason_starts": "2", "desc_preseason_matches": "2"}
    benched = {**started, "name": "De Roon", "desc_real_roles": "MC;DM",
               "desc_preseason_starts": "0"}
    assert "2 of 2 friendlies under Maurizio Sarri" in view.preseason(started)
    assert "started 0 of 2" in view.preseason(benched)
    assert "not a criterion" in view.preseason(started), "the plate has to say what it is"
    assert view.preseason({"name": "x", "club": "Atalanta"}) == "", "no friendlies, no line"

    # ...and NOTHING that chooses or places a man may read those columns
    for name in ("claim", "presence", "standing", "titolarita", "_slot_price", "_off_the_front",
                 "voto_share", "availability", "presence_inputs"):
        source = inspect.getsource(getattr(View, name))
        assert "preseason" not in source, f"{name} must not read the pre-season"
    # it IS written by `build_rows` - that is the sheet column, and the point - and read by nothing that
    # builds an eleven or transforms a module
    assert "desc_preseason" in inspect.getsource(snapshot.build_rows)
    assert "preseason" not in inspect.getsource(gui.SnapshotView.eleven)
    assert "preseason" not in inspect.getsource(gui.SnapshotView._reshape)

def test_a_player_the_toolkit_can_still_measure_says_so_and_says_when_it_is_being_fetched():
    """«Deve essere evidente per questi calciatori che mancano ancora dei dati che il toolkit sta
    recuperando», and an empty cell cannot say it: below `MIN_PV_PREV` the core refuses to predict, so the
    surplus of a man with nothing measured is blank - and blank is what a zero looks like too.

    So he carries a MARK, on the same per-player list every other state lives on, and the rule behind it is
    the fetching module's own (`recent_form.awaiting_data`): priced above his role's median with nothing
    measured. One definition, two readers - the module selects whom to fetch over the DB, the panel marks
    whom the operator is waiting for over the sheet - because two copies of that rule would be two
    populations and the mark would stop meaning «this is what is being fetched».

    While a recovery run is in flight the same men read «being fetched» instead of «missing», which is the
    other half of the request: the gap closes where it was seen to open.
    """
    from euroleghe_ingest.gui import SnapshotView as View
    from euroleghe_ingest.modules import recent_form

    rows = [{"name": name, "role_classic": role, "price_initial": price,
             "desc_season_matches": played}
            for name, role, price, played in (
                ("Alajbegovic", "C", "12", ""),       # priced above the median, nothing measured
                ("Regular", "C", "20", "34"),         # priced high AND measured: no mark
                ("Fourth choice", "C", "1", ""),      # nothing measured, and nobody is waiting for him
                ("Median man", "C", "5", ""),         # AT the median, which is not above it
                ("Mid", "C", "5", "20"), ("Mid2", "C", "6", "30"), ("Mid3", "C", "4", "12"))]
    view = View.__new__(View)
    view.players, view._medians = rows, None

    waiting = [row["name"] for row in rows if view.awaiting_data(row)]
    assert waiting == ["Alajbegovic"], waiting
    assert view._price_medians()["C"] == 5.0, view._price_medians()
    # the mark is on the flags, and its words say what it is and what closes it
    icons, words = view._flags(rows[0])
    assert "⧖" in icons and "recent_form" in words, (icons, words)
    assert "⧖" not in view._flags(rows[1])[0], "a measured man carries no gap"

    # ...and it changes while the toolkit is fetching, without a rebuild of the sheet
    view._recovering = "recent_form"
    icons, words = view._flags(rows[0])
    assert "⟳" in icons and "⧖" not in icons, icons
    assert "right now" in words, words

    # ...and once the window is IN, the mark says what the valuation stands on: these men are priced on the
    # presences it buys them with the role anchor for the rate, so their surplus ranks them by "he will
    # play" - a column that stops saying «waiting» and then says nothing is the worse of the two.
    view._recovering = ""
    filled = {**rows[0], "desc_elsewhere_matches": "10", "desc_elsewhere_minutes": "693",
              "desc_elsewhere_where": "bundesliga"}
    icons, words = view._flags(filled)
    assert "→" in icons and "10 matches, 693 minutes in bundesliga" in words, (icons, words)
    assert "⧖" not in icons, "the gap is closed: it is no longer waiting for anything"
    assert "→" not in view._flags({**filled, "desc_season_matches": "34"})[0],         "a man with a season HERE is not priced off a window"

    # the panel's rule IS the module's rule, called with the same arguments
    assert recent_form.awaiting_data("C", 12.0, measured=False, medians={"C": 5.0})
    assert not recent_form.awaiting_data("C", 12.0, measured=True, medians={"C": 5.0})


def test_any_module_percentage_drives_the_bar_and_it_never_goes_backwards():
    """«Poi deve essere visibile una progress bar animata durante il recupero dei dati (con % di
    completamento)»: the widget and the protocol already existed for a snapshot build - a module prints
    `[name] NN% · label` (`Context.progress`) and the bar goes determinate on it - and what was missing is
    that the parser only accepted the snapshot's own lines.

    Monotone by construction, for the reason the build's bar states: a bar that retreats reads as a failure
    even when nothing failed.
    """
    import re

    from euroleghe_ingest.context import Context
    from euroleghe_ingest.gui import SnapshotView as View

    assert View.PERCENT_LINE.match("[recent_form] 34% · 2026-27 · Alajbegovic")
    assert View.PERCENT_LINE.match("[snapshot] 12% · clubs 4/34"), "the build's own lines still parse"
    assert not View.PERCENT_LINE.match("[recent_form]   Alajbegovic  Qt.I 12  tier1 10 matches")

    said: list[str] = []
    ctx = Context.__new__(Context)
    with contextlib.redirect_stdout(io.StringIO()) as out:
        ctx.progress("recent_form", 0, 11, "starting")
        ctx.progress("recent_form", 5, 11, "half")
        ctx.progress("recent_form", 11, 11, "done")
        ctx.progress("recent_form", 3, 0, "nothing to fetch")     # no total, no claim
    said = [line for line in out.getvalue().splitlines() if line]
    percents = [int(re.match(r"\[recent_form\]\s+(\d+)%", line).group(1)) for line in said]
    assert percents == [0, 45, 99], percents
    assert len(said) == 3, "a total of zero prints nothing: there is no honest fraction of no work"

def test_a_man_measured_only_elsewhere_competes_for_a_shirt_and_pays_for_being_elsewhere():
    """«Un calciatore come Alajbegovic, con i dati recuperati, dovrebbe almeno concorrere per un posto da
    titolare.»

    He had 693 minutes over ten Bundesliga matches and a standing of ZERO - not low, absent - because
    `standing` reads a SEASON and he has none. The window has its own denominator: ten matches at 69 minutes
    is 77% of the football that was available to him, and reading those minutes against a 38-round season
    calls the same man a 20% player.

    It costs him the arrival discount, taken explicitly and not through `at_club_weight`: that one splits his
    minutes between here and elsewhere, and a man with no minutes here at all reads 1.0 there - right for an
    unknown split, wrong for a known one. 0.77 x 0.80 = 0.62, which competes with a real eleven and does not
    pretend to be a season played here.

    OFF in the engine (`presence.DEFAULTS`) and ON in the panel, which is the honest state until gate
    §7-octies runs: every gated number is computed with the default.
    """
    from dataclasses import replace

    from euroleghe_ingest.engine import presence

    window = presence.Inputs(window_matches=10, window_minutes=693, league_matches=38)
    assert presence.standing(window, presence.DEFAULTS) == 0.0, "the engine's answer for him is R13"
    panel = replace(presence.DEFAULTS, window_standing=1.0)
    assert round(presence.standing(window, panel), 3) == 0.616, presence.standing(window, panel)
    # ...and a club that already had him discounts him harder: it sent him away, which is its own judgement
    returning = replace(window, was_here_before=True)
    assert presence.standing(returning, panel) < presence.standing(window, panel)
    # a season measured HERE is untouched by any of this
    season = presence.Inputs(starts=30, appearances=34, minutes=2700, league_matches=38,
                             window_matches=10, window_minutes=693)
    assert presence.standing(season, panel) == presence.standing(season, presence.DEFAULTS)


def test_a_population_statistic_is_measured_over_the_SHEET_and_not_the_club_on_screen():
    """`self.rows` is one club's squad; five statistics read it believing they had the sheet.

    Found 08/08/2026 by driving the real panel instead of a harness, which is the only way it could be
    found: every test built a view with `rows` = the whole sheet, so the harness and the panel were
    measuring different populations and only the panel was wrong. `_show_club` assigns
    `self.rows = self.squad(club)`, and the shrinkage prior plus the four z-scores (`fm_z`, `career_z`,
    `level_z`, `level_gap_z`) all say «this sheet» in their docstrings while getting 25-43 men.
    What it cost: Milan's keeper read 99% of claim against 85%, and the board drew the predecessor's
    3-5-2 instead of Amorim's 3-4-3 - the shape odds are built on those claims. Two adopted parameters
    were affected at once, `standing_prior_rounds` and `level_weight`.
    """
    sheet = [{"club": "Test", "name": f"p{i}", "role_classic": "C", "desc_season_starts": "20",
              "desc_season_matches": "20", "desc_minutes_full_season": str(900 + i * 90),
              "desc_minutes_club": str(900 + i * 90), "desc_minutes_elsewhere": "0",
              "engine_fm_pred": f"{6.0 + i * 0.1:.1f}"} for i in range(12)]
    mine = {"club": "Other", "name": "mine", "role_classic": "C", "desc_season_starts": "30",
            "desc_season_matches": "30", "desc_minutes_full_season": "2700",
            "desc_minutes_club": "2700", "desc_minutes_elsewhere": "0", "engine_fm_pred": "7.5"}
    view = _view_of([*sheet, mine])
    view.players = [*sheet, mine]
    view.rows = [mine]                       # what `_show_club` really leaves behind
    assert len(view.population()) == 13, "the statistics are the SHEET's, not the club on screen"
    # his fantamedia is measured against the twelve, so it is well above the mean...
    assert view.fm_z(mine) > 1.0
    # ...and against his own club of one it cannot be measured at all, which is what used to happen
    alone = _view_of([mine])
    alone.players = [mine]
    assert alone.fm_z(mine) is None, "one man is not a population"


def test_the_trend_score_is_read_inside_its_own_role_and_over_the_whole_sheet():
    """The 0-99 says «he is going well», and that sentence is relative to what his ROLE can produce.

    A forward's ten matches are worth more fantapunti than a defender's by construction, so one pool
    for everybody would rank the roles and call it form. The population is the SHEET (`population`) and
    a role too thin to be a distribution gets no number at all - a 0-99 read against two other men says
    nothing about either.
    """
    forwards = [{"club": "Test", "name": f"a{i}", "role_classic": "A",
                 "desc_trend_fp": f"{4.0 + i * 0.5:.1f}"} for i in range(10)]
    defenders = [{"club": "Test", "name": f"d{i}", "role_classic": "D",
                  "desc_trend_fp": f"{3.0 + i * 0.2:.1f}"} for i in range(10)]
    keepers = [{"club": "Test", "name": "p1", "role_classic": "P", "desc_trend_fp": "5.0"}]
    view = _view_of([*forwards, *defenders, *keepers])
    view.players = [*forwards, *defenders, *keepers]
    assert view.trend_score(forwards[-1]) == 99 and view.trend_score(defenders[-1]) == 99, \
        "the best of each role is the 99 of that role's scale"
    # the best defender collects 4.8 against the best forward's 8.5, and still reads 99: what the
    # column answers is «how is HE going», not «is a defender worth as much as a striker»
    assert view.trend_score(defenders[0]) == round(3.0 / 4.8 * 99)
    assert view.trend_score(keepers[0]) is None, "one keeper is not a distribution"
    assert view.trend_score({"role_classic": "A"}) is None, "no trend, no score - never a zero"


def test_a_coach_keeps_the_elevens_his_club_is_spelled_differently_in(tmp_path):
    """A coach's repertoire joined the line-ups on a club NAME, and lost 26% of every career.

    `club_match_lineups.club` is what the parser wrote ('AC Milan', 'RB Leipzig', 'SSC Napoli'), and
    `clubs.canonical_name` is ours ('Milan') - so `=` silently dropped every eleven of every club whose two
    spellings differ. Measured on 08/08/2026: **13.830 complete elevens of 24.042 sat under a string that
    is not a canonical name**, and it cost the repertoires where they decide - Gattuso came back with 2
    elevens and has 79, Tedesco 3 of 28, Spalletti 31 of 107, and Simeone, Flick, Kompany, Pellegrini,
    Hütter, Genesio and Mourinho read ZERO or ONE against full careers. Three coaches under
    `COACH_SHAPE_MIN` whose real sample is far above it means the board drew the PREDECESSOR's shape at
    exactly the clubs `coach_shapes` exists to fix (euro: 3 boards moved once resolved).

    Fourth instance of «an entity joins through its CANONICAL KEY, never through the string a source uses
    to name it», and the cheapest to have avoided: `club_context` was already holding `lineup_spellings`
    for the club's own shapes.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (10, 'Milan', 'serie_a')")
    conn.execute("INSERT INTO coaches(fc_club_id, coach_name, valid_from, valid_to) "
                 "VALUES (10, 'Allegri', '2024-07-01', NULL)")
    for match_id, date, club, lines in (("m1", "2025-05-01", "AC Milan", (1, 3, 4, 3)),
                                        ("m2", "2025-05-08", "AC Milan", (1, 3, 4, 3)),
                                        ("m3", "2025-05-15", "Milan", (1, 3, 5, 2))):
        conn.execute(
            "INSERT INTO club_match_lineups(season, source, match_id, club, competition, match_date, "
            "starters, goalkeepers, defenders, midfielders, forwards) "
            "VALUES ('2024-25', 'sofascore', ?, ?, 'serie_a', ?, 11, ?, ?, ?, ?)",
            (match_id, club, date, *lines))
    conn.commit()

    text, total = snapshot.coach_repertoire(conn, "Allegri")
    assert total == 3, f"the provider's spelling is the same club: {text}"
    assert text.startswith("3-4-3:2"), text
    # ...and the cut-off date still bounds it, so a back-dated sheet cannot read tomorrow's eleven
    assert snapshot.coach_repertoire(conn, "Allegri", "2025-05-10")[1] == 2
    # a spell that does not cover the match contributes nothing - the window is not decoration
    conn.execute("UPDATE coaches SET valid_to = '2025-05-02'")
    conn.commit()
    assert snapshot.coach_repertoire(conn, "Allegri")[1] == 1


def test_the_perimeter_is_the_target_listone_and_not_last_seasons_ratings(tmp_path):
    """In August the target season has no ratings, so a ratings-only perimeter is the season that ENDED.

    Measured on the 2026-27 Serie A sheet (08/08/2026): the relegated Cremonese, Pisa and Verona kept
    94 unpurchasable rows while all 74 quoted players of the promoted Frosinone, Monza and Venezia
    were silently dropped - three clubs you WILL buy from, absent from the sheet and from every
    board. The target LISTONE knows a promotion before a ball is kicked, so it is the authority;
    ratings remain the fallback for a window the quotes backfill does not cover. And a single stray
    row - `rosters` keeps the last read, so a man the listone still quotes after his move abroad is
    filed at his NEW club - must not smuggle that club in: a purchasable contingent fields an eleven.
    """
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES "
                 "(1, 'Verona', 'serie_a'), (2, 'Venezia', 'serie_a'), "
                 "(3, 'Bayer Leverkusen', 'bundesliga')")
    # the season that ended: Verona played it, Venezia did not (Serie B is not ingested)
    conn.execute("INSERT INTO players(fc_id, canonical_name, birth_year) VALUES (100, 'Suslov', 1998)")
    conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, platform, team, mv) "
                 "VALUES (100, '2025-26', 1, 'default', 'Verona', 6.0)")
    # the target listone: eleven quoted Venezia men, and one stray whose roster row moved abroad
    for fc_id in range(200, 211):
        conn.execute("INSERT INTO players(fc_id, canonical_name, birth_year) "
                     "VALUES (?, 'Laguna', 1998)", (fc_id,))
        conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic) "
                     "VALUES (?, '2026-27', 2, 'serie_a', 'C')", (fc_id,))
        conn.execute("INSERT INTO listone_quotes(fc_id, season, platform, price_initial) "
                     "VALUES (?, '2026-27', 'default', 5)", (fc_id,))
    conn.execute("INSERT INTO players(fc_id, canonical_name, birth_year) VALUES (300, 'Gutierrez', 1998)")
    conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic) "
                 "VALUES (300, '2026-27', 3, 'serie_a', 'D')")
    conn.execute("INSERT INTO listone_quotes(fc_id, season, platform, price_initial) "
                 "VALUES (300, '2026-27', 'default', 8)")
    conn.commit()

    assert snapshot.perimeter_clubs(conn, "default", ("2025-26", "2026-27")) == {"Venezia"}
    # a window the quotes backfill does not cover falls back to the ratings
    assert snapshot.perimeter_clubs(conn, "default", ("2024-25", "2025-26")) == {"Verona"}


def test_a_ten_match_window_is_shrunk_on_its_ten_matches_like_any_other_short_sample():
    """The shortest sample the panel ever builds a standing from was the only one exempt from the shrinkage.

    `standing_prior_rounds` = 10 was adopted (gate §7-quaterdecies, euro strict AND robust) because «a
    standing built on few rounds does not hold» - and the window branch RETURNED before it. What that
    decided: Oulai, no season on file and ten matches in Turkey, read 0.609 and took Fiorentina's third
    midfield shirt off Atta, who had played 2563 measured minutes at 0.576. A ten-match window outranking a
    season is the defect stated as a sentence.

    Two things are pinned. The sample behind the number is the WINDOW's ten matches and not his new club's
    38 rounds - `sample_rounds`, which is also what the caller has to bucket a prior BAND by, or a man with
    ten matches is filed among the season-long starters and shrunk toward the highest prior there is. And
    the direction: with a prior below him he comes DOWN, with a prior above him he goes up, because a
    shrinkage that only ever lowered would be a haircut.
    """
    from dataclasses import replace

    from euroleghe_ingest.engine import presence

    panel = replace(presence.DEFAULTS, window_standing=1.0)
    window = presence.Inputs(window_matches=10, window_minutes=693, league_matches=38)
    assert presence.sample_rounds(window, panel) == 10, "his sample is the window, not the calendar"
    assert presence.window_only(window, panel) is True
    # ...half his own number and half the population's, because ten matches are ten matches
    fringe = replace(window, standing_prior=0.207)
    assert abs(presence.standing(fringe, panel) - (0.5 * 0.616 + 0.5 * 0.207)) < 1e-9
    # it pulls BOTH ways
    assert presence.standing(replace(window, standing_prior=0.9), panel) > 0.616
    # and the case it was found on: a measured season now outranks a ten-match window
    starter = presence.Inputs(starts=29, appearances=32, minutes=2563, league_matches=38,
                              minutes_elsewhere=2563, standing_prior=0.571)
    assert presence.sample_rounds(starter, panel) == 38
    assert presence.standing(starter, panel) > presence.standing(fringe, panel)


def test_a_season_played_abroad_is_a_share_of_ITS_OWN_calendar():
    """1320 minutes in Ligue 1's 34 rounds are not 1320 minutes in Serie A's 38.

    «Numerator and denominator must be counted over the same competitions» (spec «Novità v9.11»), and for a
    man bought from abroad every numerator on the row is his OLD championship's while the denominator was
    his NEW club's. Gonçalo Ramos read 0.386 of a season where he had played 0.431 - 12% of himself given
    away - and it kept him out of Milan's typical eleven by 0.013 of claim.

    Only where the WHOLE measured season was played elsewhere: a January transfer has minutes on two
    calendars and no single denominator is right for him, so he keeps his club's. An origin we cannot name
    keeps it too - «vuoto = ignoto».
    """
    abroad = {"club": "Test", "desc_arrival_origin": "ligue_1", "desc_arrival_origin_rounds": "34",
              "desc_minutes_elsewhere": "1320", "desc_minutes_club": "0"}
    view = _view_of([abroad])
    assert view.season_calendar(abroad) == 34.0
    # a man whose season is split keeps his club's calendar, and so does one with no origin on file
    assert view.season_calendar({**abroad, "desc_minutes_club": "400"}) == 38.0
    assert view.season_calendar({**abroad, "desc_arrival_origin_rounds": ""}) == 38.0
    # ...and the share he is credited with is the bigger, honest one
    with_origin = view.presence_inputs(abroad)
    assert with_origin.league_matches == 34.0
    assert round(1320 / (34 * 90), 3) > round(1320 / (38 * 90), 3)


def test_one_man_per_flank_in_a_row():
    """Juventus drew Yildiz and Alajbegovic BOTH as the left-sided forward: two 'As' on one row, which is
    the unpaired-flank defect seen from the other side - a row has one left and one right.

    The man the shape put on that side keeps it; the other reads the line's own central job, exactly as if
    he had no pair at all.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    assert view._paired(["As", "As", "Ad"], "A", ["C", "L", "R"]) == ["Pc", "As", "Ad"]
    assert view._paired(["Es", "Es", "Ed"], "M", ["L", "C", "R"]) == ["Es", "C", "Ed"]
    # ...and a row that names one flank once is untouched
    assert view._paired(["Ad", "T", "As"], "T", ["R", "C", "L"]) == ["Ad", "T", "As"]



def test_the_live_auction_list_is_one_table_and_claims_no_score():
    """The season being auctioned has no other side, and the panel must not pretend it has one.

    Every other entry in that tab is a rehearsal on a finished season, where '6/10 in common' and '78% of
    the perfect top-10' are real measurements. On the live list they would be zeros dressed as a score,
    and the columns that report the outcome would be empty cells - which is exactly how a blank reads as a
    zero. So: one table, the outcome columns ABSENT, and a status line that says what it cannot say.
    """
    import tkinter as tk
    from pathlib import Path
    from tkinter import ttk

    from euroleghe_ingest.gui import SURPLUS, AuctionView

    try:
        root = tk.Tk()
    except tk.TclError:
        import pytest
        pytest.skip("no display available")
    root.withdraw()

    def descendants(widget):
        for child in widget.winfo_children():
            yield child
            yield from descendants(child)

    try:
        for metric in ("value", SURPLUS):
            # the REAL panel and not a stand-in, pointed at a database that is not there: a harness that
            # assembles its own widgets is a harness that can be right while the panel is wrong
            view = AuctionView(root, Config(db_path=Path("nowhere.db")))
            view.season_var.set("2026-27 · LIVE")
            row = {"fc_id": 2839, "rank": 1, "name": "Malen", "club": "Roma", "role": "A",
                   "role_classic": "A", "roles_mantra": "w;a", "fm_pred": 7.92, "pv_pred": 28.6,
                   "surplus_pred": 44.8, "surplus_act": None, "value_pred": 226.2,
                   "value_act": None, "fm_act": None, "pv_act": None, "fvm": 210,
                   "spm": 254.6, "dvm": 44.6, "actual_rank": None, "pair": None}
            view._render({
                "window": "SNAP 2025-26->2026-27", "params_from": "T2+pooled(-)", "metric": metric,
                "live": True, "rules": "R3, R7, R13", "roster": 806, "priced": 357,
                "notes": [("2026-27 has no matchdays yet, so expected appearances are scaled on "
                           "2025-26's calendar (38 rounds)")],
                "rows": [row], "teams": 12,
                "rates": {"A": {"rate": 5.68, "n": 48, "rostered": 72,
                                "fvm": 10387.0, "surplus": 563.8}},
                "by_role": {"A": {"n_ranked": 143, "replacement": 6.11, "replacement_actual": None,
                                  "hits": 0, "captured_value": 0.0, "perfect_value": 0.0,
                                  "predicted": [row], "actual": [], "rows": [row]}},
            })
            status = view.status_var.get()
            assert "LIVE" in status and "no season to compare against" in status
            assert "357 of 806 players priced" in status, "what IS honest: how much it can price"
            for claim in ("of the perfect", "names", "%"):
                assert claim not in status, (metric, claim, status)
            bodies = [w for w in descendants(view.inner) if isinstance(w, tk.Canvas)]
            assert len(bodies) == 2, f"{metric}: one table = a header and a body, got {len(bodies)}"
            columns = view._columns
            assert columns == AuctionView.LIVE_COLUMNS[metric]
            assert not [c for c in columns if "real" in c], columns
            # the header names exactly the columns the cells are drawn in - one layout, or a title
            # ends up over the neighbouring column's values
            titles = [view._head.itemcget(item, "text") for item in view._head.find_all()
                      if view._head.type(item) == "text"]
            assert titles == list(columns), (metric, titles)
            drawn = [view._body.itemcget(item, "text") for item in view._body.find_all()
                     if view._body.type(item) == "text"]
            assert "Malen" in drawn and "ROM" in drawn, drawn
            # the two ROLE columns are chips and not characters: a polygon per code, and the Mantra
            # ones say which shirt he is priced in by being filled
            pills = [item for item in view._body.find_all() if view._body.type(item) == "polygon"]
            assert len(pills) == 3, f"{metric}: A + w + a = three chips, got {len(pills)}"
            assert {"A", "W"} <= set(drawn), drawn      # the Classic 'A', and 'W'/'A' from the codes
            # and the engine's caveat is on screen, not only in the manifest
            notes = [w for w in descendants(view.inner) if isinstance(w, ttk.Label)
                     and str(w.cget("text")).startswith("⚠")]
            assert len(notes) == 1 and "no matchdays yet" in str(notes[0].cget("text"))
            # the lines above the table carry what a single list would otherwise lose - the level each
            # surplus is measured against - and claim nothing about an outcome nobody has played
            lines = " | ".join(str(w.cget("text")) for w in view.inner.winfo_children()
                               if isinstance(w, ttk.Label))
            assert "in common" not in lines and "captured" not in lines, lines
            if metric == SURPLUS:
                assert "replacement FM" in lines and "6.11" in lines, lines
                assert "listone's own credits" in lines and "5.68" in lines, lines
                assert "10,387" in lines and "866 a team" in lines, lines
                assert "255" in drawn and "45" in drawn, drawn        # SpM and dVM are on the row
            assert view.count_var.get().startswith("1 of 1 players · 805 of the perimeter not listed")
    finally:
        root.destroy()


def test_the_single_list_shows_a_mantra_player_once_in_the_slot_he_is_fielded_in():
    """The engine ranks a 'dc;b' defender in BOTH lists, each against its own floor, and that is right
    for a per-role top ten. One table has to answer with one row, and which slot it belongs to already
    has an owner - `snapshot.auction_level`, the same definition the sheet, the rank and `est_surplus`
    read. Deciding it a second time here would be the "two pricers that could disagree" defect, so the
    resolver names the slot and the row of that role is the one kept: the slot he is worth MOST in, i.e.
    the lowest replacement level among his own codes.
    """
    from euroleghe_ingest.gui import SURPLUS, AuctionView

    class Obs:
        def __init__(self, fc_id, name, codes, role_classic):
            self.fc_id, self.name = fc_id, name
            self.roles_mantra, self.role_classic = codes, role_classic

    class Data:
        game = "mantra"

        def __init__(self):
            self.replacement = {"dc": 5.82, "b": 5.92, "por": 4.33}    # 'dc' is the cheaper floor

    both = Obs(1, "Bastoni", ("dc", "b"), "D")
    keeper = Obs(2, "Svilar", ("por",), "P")
    data = Data()
    data.observations = [both, keeper]

    def row(fc_id, name, role, surplus, rank):
        return {"fc_id": fc_id, "name": name, "role": role, "role_classic": "D",
                "surplus_pred": surplus, "rank": rank, "ranked": True, "club": "Inter"}

    by_role = {
        "dc": {"rows": [row(1, "Bastoni", "dc", 18.0, 3)]},
        "b": {"rows": [row(1, "Bastoni", "b", 16.0, 1)]},
        "por": {"rows": [{**row(2, "Svilar", "por", 20.0, 1), "role_classic": "P"}]},
    }
    view = AuctionView.__new__(AuctionView)
    rows = view._one_row_per_player(by_role, data, SURPLUS)
    assert [r["name"] for r in rows] == ["Svilar", "Bastoni"], "ranking order, best first"
    kept = next(r for r in rows if r["name"] == "Bastoni")
    assert (kept["role"], kept["rank"]) == ("dc", 3), "the slot an auction fields him in, and its rank"


def test_the_auction_table_sorts_by_the_value_and_sinks_the_blanks():
    """Every heading is a sort button, and three things must hold. It sorts by the VALUE behind the cell
    and not by the string in it (or 100 would come before 9). A missing cell sinks to the bottom in BOTH
    directions, because a blank is not a small number - the same rule the squad table follows. And the
    third click restores the ranking order, which is the only order in which the rank column reads top to
    bottom, so a sort is never a one-way door.
    """
    from euroleghe_ingest.gui import AuctionView

    view = AuctionView.__new__(AuctionView)
    view._sort_column, view._sort_desc = None, True
    view._head = view._body = None
    view._rows = []
    rows = [{"fc_id": 1, "name": "Nine", "dvm": 9.0, "club": "Inter",
             "role": "dc", "role_classic": "D", "roles_mantra": "dc;b"},
            {"fc_id": 2, "name": "Hundred", "dvm": 100.0, "club": "Milan",
             "role": "dc", "role_classic": "D", "roles_mantra": "dc"},
            {"fc_id": 3, "name": "Unquoted", "dvm": None, "club": "Inter",
             "role": "b", "role_classic": "D", "roles_mantra": "b"}]

    view._sort_column, view._sort_desc = "dVM", True
    assert [r["name"] for r in view._sorted(rows)] == ["Hundred", "Nine", "Unquoted"]
    view._sort_desc = False
    assert [r["name"] for r in view._sorted(rows)] == ["Nine", "Hundred", "Unquoted"]
    view._sort_column = None
    assert view._sorted(rows) == rows

    # and the two filters only HIDE rows - they never reorder and never recompute
    view.role_vars, view.team_var = {}, _Var("Inter")
    assert [r["name"] for r in view._filtered(rows)] == ["Nine", "Unquoted"]
    # ROLE is a multiple choice and on Mantra it reads his CODES, not the slot he is priced in: a
    # 'dc;b' defender priced as a 'dc' is one of the answers to «who can play me a braccetto»
    view.team_var = _Var("all")
    view.role_vars = {"b": _Var(True), "dc": _Var(False)}
    assert [r["name"] for r in view._filtered(rows)] == ["Nine", "Unquoted"]
    view.role_vars = {"b": _Var(False), "dc": _Var(True)}
    assert [r["name"] for r in view._filtered(rows)] == ["Nine", "Hundred"]
    # nothing ticked is not "nothing": it is everything, which is what an empty filter means
    view.role_vars = {"b": _Var(False), "dc": _Var(False)}
    assert len(view._filtered(rows)) == 3


class _Var:
    """A tk variable without a Tk: the filters read `.get()` and nothing else."""

    def __init__(self, value):
        self.value = value

    def get(self):
        return self.value


def test_a_front_place_goes_to_a_forward_even_when_a_trequartista_claims_more(monkeypatch):
    """Rule 4a at SELECTION (`_fronted`), and it was the last case of its family left on the board.

    The trequartisti compete for the attacking line (`line_key`), so on a shape with a SINGLE front place a
    man who plays on the trequarti outbids a centre-forward on claim - and then the guard «never the last man
    of the attack» rightly keeps him there, so nothing downstream can repair it. Measured on Lille's 4-5-1,
    the only offender left on the 516 boards the model selects: Haraldsson (`AM`, 0.86) held the place while
    Fernandez-Pardo (`ST`, 0.82) sat outside the eleven.

    The job decides who is ELIGIBLE, the claim decides between them, and the ceiling is the one the other two
    overrides use. And where the squad has no forward to offer, nothing happens: «una squadra i cui unici
    attaccanti sono trequartisti va disegnata con loro».
    """
    from euroleghe_ingest.gui import SnapshotView as View

    def squad_of(extra):
        rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
                 "share": share}
                for index, (name, codes, role, share) in enumerate((
                    ("Chevalier", "GK", "P", 1.00),
                    ("Meunier", "DR", "D", 0.90), ("Diakite", "DC", "D", 0.88),
                    ("Mandi", "DC", "D", 0.86), ("Perraud", "DL", "D", 0.84),
                    ("Bouaddi", "MC;DM", "C", 0.82), ("Andre", "DM;MC", "C", 0.80),
                    ("Bentaleb", "MC", "C", 0.78), ("Correia", "LW;RW", "C", 0.61),
                    ("Mukau", "MC;DM", "C", 0.70),
                    ("Haraldsson", "AM", "C", 0.86)) + extra)]
        return rows

    def front_of(rows):
        view = _view_of(rows)
        view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
        monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
        monkeypatch.setattr(View, "presence", lambda _self, row, _h: row.get("share", 0.0))
        monkeypatch.setattr(View, "claim", lambda _self, row, _h="season": row.get("share", 0.0))
        monkeypatch.setattr(View, "titolarita", lambda _self, row, _h: (0.0, row.get("share", 0.0)))
        eleven = view.eleven("Lille", "4-5-1", "typical")
        assert len(eleven) == 11
        return [row["name"] for lane, row, _rivals in eleven if lane == "A"]

    # The striker claims LESS and still takes the place: the front line is his job, and 0.04 of claim is
    # well inside the ceiling the other overrides pay.
    assert front_of(squad_of((("Fernandez-Pardo", "ST", "A", 0.82),))) == ["Fernandez-Pardo"]
    # ...but not at any price: past `FLANK_OVERRIDE_GAP` the forward is a man who does not play, and then
    # the drawing keeps the side the coach actually fields.
    assert front_of(squad_of((("Fernandez-Pardo", "ST", "A", 0.20),))) == ["Haraldsson"]
    # ...and with no forward in the squad at all, the trequartista keeps the place - the Roma case.
    assert front_of(squad_of((("Ngoy", "MC", "C", 0.55),))) == ["Haraldsson"]


def test_the_lone_front_place_goes_to_a_centre_forward_not_to_a_jolly(monkeypatch):
    """The operator's rule of 08/08/2026: «nel 4-5-1 o 4-2-3-1 lì davanti ci vuole una Pc, o al massimo
    una A» (`_speared`).

    The Bologna case: Odgaard (`AM;RW`, listone C) held the 4-5-1's only front place over Dovbyk (`ST`,
    listone A) 0.429 to 0.382, and NEITHER existing guard could object - his RW is a front-line code, so
    `_fronted` does not read him as off the front, and his AM is central, so `_pointed` is satisfied too.
    A front three interchanges and a winger holds a place in it by right; a front line of ONE has no
    flank to interchange with, so its only place is the point of the attack.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    def squad_of(extra):
        rows = [{"fc_id": str(index), "name": name, "desc_real_roles": codes, "role_classic": role,
                 "share": share}
                for index, (name, codes, role, share) in enumerate((
                    ("Skorupski", "GK", "P", 1.00),
                    ("Zortea", "DR;MR", "D", 0.90), ("Lucumi", "DC", "D", 0.88),
                    ("Heggem", "DC;DL", "D", 0.86), ("Miranda", "DL", "D", 0.84),
                    ("Moro", "MC;DM", "C", 0.82), ("Ferguson", "MC;DM;AM", "C", 0.80),
                    ("Holm", "DR;MR", "C", 0.78), ("Orsolini", "RW", "C", 0.61),
                    ("Cambiaghi", "LW", "C", 0.60),
                    ("Odgaard", "AM;RW", "C", 0.43)) + extra)]
        return rows

    def front_of(rows):
        view = _view_of(rows)
        view._calendar, view._slot_side, view._excluded, view._reshaped = {}, {}, set(), set()
        monkeypatch.setattr(View, "squad", lambda _self, _club: rows)
        monkeypatch.setattr(View, "presence", lambda _self, row, _h: row.get("share", 0.0))
        monkeypatch.setattr(View, "claim", lambda _self, row, _h="season": row.get("share", 0.0))
        monkeypatch.setattr(View, "titolarita", lambda _self, row, _h: (0.0, row.get("share", 0.0)))
        eleven = view.eleven("Bologna", "4-5-1", "typical")
        assert len(eleven) == 11
        return [row["name"] for lane, row, _rivals in eleven if lane == "A"]

    # The centre-forward claims LESS and still takes the lone place: it is his job, and 0.05 of claim is
    # well inside the ceiling every override pays.
    assert front_of(squad_of((("Dovbyk", "ST", "A", 0.38),))) == ["Dovbyk"]
    # ...a listone forward with no observed codes is «al massimo una A» and qualifies the same way...
    assert front_of(squad_of((("Dallinga", "", "A", 0.38),))) == ["Dallinga"]
    # ...but not at any price: past `FLANK_OVERRIDE_GAP` the striker stays out and a jolly leads the
    # line - WHICH jolly is the fit's business among men who all pay the same, not this rule's.
    assert "Dovbyk" not in front_of(squad_of((("Dovbyk", "ST", "A", 0.01),)))
    # ...and with nobody who leads a line in the squad, the place is still worn: a squad whose only
    # attackers are jollies is drawn with them.
    assert len(front_of(squad_of((("Fabbian", "MC;AM", "C", 0.55),)))) == 1


def test_a_shape_ruling_outlives_the_session_and_never_reaches_the_judge(tmp_path):
    """The operator's board ruling («Napoli 2026-27 plays 4-3-3») is a persisted, dated, revocable fact.

    Three statements, each the answer to a way the first draft could rot:
    - it comes back for the SAME season and joins clubs by IDENTITY, not by the spelled string;
    - withdrawing it (the selector's `auto`) removes it from the file rather than papering over it;
    - and the press/outcome harness NEVER sees it (`load_sheet(apply_rulings=False)`): a ruling is
      often made looking at the judge, and a judge must not score the operator's own answers.
    """
    from euroleghe_ingest.config import Config
    from euroleghe_ingest.gui import SnapshotView as View

    view = _view_of([])
    view.config = Config(board_rulings_path=tmp_path / "board_rulings.json")
    view.manifest = {"target_season": "2026-27"}
    view.clubs = {"Napoli": {}}
    view._shape_choice = {}

    view._save_ruling("Napoli", "4-3-3")
    saved = json.loads((tmp_path / "board_rulings.json").read_text(encoding="utf-8"))
    assert saved["2026-27"]["Napoli"]["shape"] == "4-3-3"
    assert saved["2026-27"]["Napoli"]["decided_on"], "a ruling is a dated fact"

    # a new session: the ruling comes back for its season, and only for its season
    view._shape_choice = {}
    view._seed_shape_rulings()
    assert view._shape_choice == {("Napoli", "typical"): "4-3-3"}
    view._shape_choice, view.manifest = {}, {"target_season": "2027-28"}
    view._seed_shape_rulings()
    assert view._shape_choice == {}, "another season is another squad"

    # ...by identity, not by the string the file spelled
    view.manifest, view.clubs = {"target_season": "2026-27"}, {"SSC Napoli": {}}
    view._seed_shape_rulings()
    assert view._shape_choice == {("SSC Napoli", "typical"): "4-3-3"}

    # withdrawn = gone from the file, not overwritten
    view.clubs = {"Napoli": {}}
    view._save_ruling("Napoli", None)
    assert json.loads((tmp_path / "board_rulings.json").read_text(encoding="utf-8")) == {}

    # and the harness seam: the loader seeds by default, and not when asked to stay pure
    assert View.load_sheet.__defaults__ == (True,)
    import inspect

    from euroleghe_ingest.modules import boards, press
    from euroleghe_ingest.modules import snapshot as snap
    # The invariant is no longer a substring inside one function: `extract_boards` grew a SECOND caller with
    # the opposite need - the panel's data path must honour the rulings, the judge must never see them - so the
    # guard grew into the three facts that keep them apart, plus where the boards are written, which is what
    # stops them from describing a different sheet than the one exported.
    assert inspect.signature(boards.extract_boards).parameters["apply_rulings"].default is False, \
        "the safe default must be the judge's: a forgotten flag must not seed the operator's rulings"
    # On the MODULE and not on one function: which function holds the call is a detail, «the judge never
    # turns the flag on anywhere» is the invariant.
    assert "apply_rulings=False" in inspect.getsource(press), \
        "the judge must ask for the model's own answer explicitly"
    assert "apply_rulings=True" not in inspect.getsource(press), \
        "the judge must never score the operator's own rulings"
    assert "apply_rulings=True" in inspect.getsource(boards.write_boards), \
        "the PANEL's board must honour the operator's rulings: they have the highest precedence"
    assert "write_boards" in inspect.getsource(snap.run), \
        "the boards are written from the sheet just built, so they cannot describe a different one"


def test_a_sheet_says_how_old_its_squad_and_transfer_evidence_is(tmp_path):
    """The operator's case: «Gutierrez non è più nel Napoli». The sheet was RIGHT about what it had - both
    squad sources said Napoli - and what it had was days old, while `transfers_history` did not carry a
    single move dated 2026: the whole summer market was missing and nothing said so.

    A squad is a volatile state, so its AGE is part of the answer. Per source, because one being fresh says
    nothing about the others; and the transfer window separately, because an empty market is a different
    defect from a stale roster - it blinds an arrival's origin and fee rather than misplacing a man.
    """
    from euroleghe_ingest.config import Config
    from euroleghe_ingest.db.database import init_db
    from euroleghe_ingest.engine import features
    from euroleghe_ingest.modules import snapshot

    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euroleghe.db")
    (tmp_path / "data").mkdir()
    conn = init_db(cfg.db_path)
    window = features.Window("SNAP", "2025-26", "2026-27", "2026-08-05")
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'Gutierrez')")
    conn.executemany("INSERT INTO squad_snapshot(fc_id, valid_from, club, source) VALUES (1, ?, 'Napoli', ?)",
                     [("2026-08-04", "fc_site"), ("2026-07-29", "transfermarkt")])
    conn.execute("INSERT INTO transfers_history(fc_id, date, from_club, to_club, fee) "
                 "VALUES (1, '2025-07-01', 'Girona FC', 'Napoli', 18000000)")
    conn.commit()

    facts, notes = snapshot.evidence_age(conn, window)
    assert facts["squad_sources"] == {"fc_site": "2026-08-04", "transfermarkt": "2026-07-29"}
    assert facts["transfers_latest"] == "2025-07-01" and facts["transfers_in_window"] == 0
    assert any("SQUAD EVIDENCE is older" in note and "transfermarkt last observed 2026-07-29" in note
               for note in notes), notes
    assert any("TRANSFER LAYER has no move dated 2026-01-01" in note for note in notes), notes

    # ...and neither note fires once the evidence is of the sheet's own day and the market is in the DB
    conn.execute("UPDATE squad_snapshot SET valid_from = '2026-08-05'")
    conn.execute("INSERT INTO transfers_history(fc_id, date, from_club, to_club) "
                 "VALUES (1, '2026-07-20', 'Napoli', 'Girona FC')")
    conn.commit()
    facts, notes = snapshot.evidence_age(conn, window)
    assert facts["transfers_in_window"] == 1 and not notes, notes


def test_every_player_gets_a_surplus_and_it_says_what_it_cost():
    """«Ogni calciatore DEVE avere il suo SURPLUS altrimenti è impossibile valutarli oggettivamente ... se non
    ci sono tutti i requisiti, penalizziamo il SURPLUS ma dobbiamo comunque avere un valore di riferimento.»

    The ladder is in `engine/estimate.py` and each rung carries the measurement that put it there. What this
    pins is the two properties the operator's rule needs: a core row comes out at EXACTLY its gated surplus
    (or the column could not rank the two together), and everything else is penalised monotonically in how
    little is known - with the club's own level standing in for a man nobody has measured, which is the
    «attaccante della Juve» against the «attaccante del Verona».
    """
    import pytest

    from euroleghe_ingest.engine import estimate as est

    # a core row is untouched: confidence 1.00 and the same arithmetic
    assert est.surplus(7.0, 30.0, 6.0, est.CONFIDENCE["core"]) == pytest.approx((7.0 - 6.0) * 30.0)
    # ...and the penalty multiplies the surplus, never the fantamedia
    assert est.surplus(7.0, 30.0, 6.0, 0.5) == pytest.approx(15.0)
    # no replacement level: falls back to VALUE, exactly as the sheet's own helper does
    assert est.surplus(7.0, 30.0, None, 1.0) == pytest.approx(210.0)

    # SHRINKING a thin season: the operator's «pad the missing votes with the role average», as arithmetic.
    # 3 votes of 15 keeps a fifth of his own mean and four fifths of the anchor...
    value, confidence = est.shrink(8.0, 3, 6.0)
    assert value == pytest.approx(6.4) and confidence == pytest.approx(0.6)
    # ...and 15 votes would be the core itself, which is why the rung stops there
    assert est.shrink(8.0, 15, 6.0) == (pytest.approx(8.0), pytest.approx(1.0))
    # monotone in the evidence: more votes, more of his own mean and more confidence
    thin, thin_conf = est.shrink(8.0, 2, 6.0)
    thick, thick_conf = est.shrink(8.0, 12, 6.0)
    assert thin < thick and thin_conf < thick_conf

    # THE CLUB moves the anchor, and by how much of the club we measured
    assert est.club_anchor(6.5, None, 0) == pytest.approx(6.5)          # nothing known: the role's own
    juve = est.club_anchor(6.5, 7.4, 6)                                 # six measured forwards at 7.4
    verona = est.club_anchor(6.5, 6.0, 6)
    assert juve > 6.5 > verona, (juve, verona)
    assert est.club_anchor(6.5, 7.4, 1) < est.club_anchor(6.5, 7.4, 6), "one man is not a club's level"

    # an older season is worth less the further back it is, and never less than the anchor it replaces
    assert est.older_confidence(2) > est.older_confidence(4) >= est.CONFIDENCE["anchor"]


def test_an_out_is_not_a_departure_when_an_arrival_brings_him_back(tmp_path):
    """«Verifica bene le rose delle squadre ed i trasferimenti: Gutierrez ad esempio non è più nel Napoli.»

    Every source the sheet had said Napoli - the 26/27 listone lists him there and the squad pages were days
    behind - and the transfer knew: Napoli -> Bayer 04 Leverkusen, 01/07/2026. But reading an OUT on its own
    reported 82 departures, most of them false: a club's page carries the same man TWICE on the same 1 July
    when a loan returns him and the club then signs him permanently (Hojlund is in Napoli's OUT to Manchester
    United AND in its IN from Manchester United, 44M). So a man has left only when the window holds an OUT
    from his club and NO arrival back at it - and `transfers_history` had to be re-keyed for both rows to
    exist at all (`db.database.widen_transfers_pk`).
    """
    from euroleghe_ingest.modules import snapshot

    class Obs:
        def __init__(self, club):
            self.club_target = club

    moves = {
        # Gutierrez: one OUT, nothing back
        1: {"at": set(), "out": [(snapshot._club_key("Napoli"), "Bayer 04 Leverkusen", "2026-07-01", 26e6)]},
        # Hojlund: the loan return AND the permanent signing, same club, same day
        2: {"at": {snapshot._club_key("Napoli")},
            "out": [(snapshot._club_key("Napoli"), "Manchester United", "2026-07-01", None)]},
    }
    assert snapshot.left_his_club(Obs("Napoli"), moves[1]) == ("Bayer 04 Leverkusen", "2026-07-01")
    assert snapshot.left_his_club(Obs("Napoli"), moves[2]) == (None, None)
    assert snapshot.left_his_club(Obs("Napoli"), None) == (None, None)
    # a spelling difference is not a transfer: «LOSC Lilla» and «Lille» are one club
    same = {"at": set(), "out": [(snapshot._club_key("LOSC Lilla"), "Lille", "2026-07-01", None)]}
    assert snapshot.left_his_club(Obs("Lille"), same) == (None, None)

    # ...and the parse no longer hands the sheet the page's own doubled label for "no club"
    from euroleghe_ingest.modules import transfers

    class Link:
        def __init__(self, title):
            self._title = title

        def get(self, _key):
            return self._title

    assert transfers._counterpart(Link("svincolatosvincolato")) == "svincolato"
    assert transfers._counterpart(Link("Bayer 04 Leverkusen")) == "Bayer 04 Leverkusen"
    assert transfers._counterpart(None) is None


def test_absence_from_the_live_squad_is_read_only_for_a_man_the_provider_knows():
    """«Il listone può non essere aggiornato al minuto, troviamo un ente affidabile e aggiornato in tempo reale
    che ci dia certezza sui trasferimenti e sulle rose effettive.»

    It already existed and nothing read it as a squad: the provider's own team page, one request per club,
    downloaded every day for the granular roles. Measured on the case that asked the question - on 28/07 its
    Napoli payload had 46 players and NOT Gutierrez, while `fc_site` still listed him on 04/08 and the
    Transfermarkt squad page on 29/07. Its power is ABSENCE, which no other source of ours can express.

    And absence has a twin that means the opposite, which is what this pins: a man with no provider identity is
    missing from every payload by construction, so reading him as "gone" would flag the unresolved half of the
    league. «Vuoto = ignoto, mai zero.»
    """
    from euroleghe_ingest.modules import snapshot

    class Obs:
        def __init__(self, fc_id, club):
            self.fc_id, self.club_target = fc_id, club

    live = {snapshot._club_key("Napoli"): {"on": "2026-08-05", "ids": {1, 2}}}
    known = {1, 2, 3}
    # 3 is known to the provider and not in the payload: he is not in that squad any more
    where, when = snapshot.left_his_club(Obs(3, "Napoli"), None, live, known)
    assert where == "not in the club's live squad" and when == "2026-08-05"
    # 1 is in it: nothing to say
    assert snapshot.left_his_club(Obs(1, "Napoli"), None, live, known) == (None, None)
    # 9 has no provider identity: absence is UNKNOWN, never a departure
    assert snapshot.left_his_club(Obs(9, "Napoli"), None, live, known) == (None, None)
    # a club nobody has read live: silence, not a departure
    assert snapshot.left_his_club(Obs(3, "Lecce"), None, live, known) == (None, None)
    # ...and the transfer wins when it exists, because it says WHERE he went
    moves = {"at": set(), "out": [(snapshot._club_key("Napoli"), "Bayer 04 Leverkusen", "2026-07-01", 1.0)]}
    assert snapshot.left_his_club(Obs(3, "Napoli"), moves, live, known) == (
        "Bayer 04 Leverkusen", "2026-07-01")


def test_a_live_squad_joins_by_club_key_and_only_speaks_when_it_is_complete():
    """Two guards the same measurement asked for, 05/08/2026, both of them silent failures without a test.

    THE JOIN. The sheet spells a club one way and the provider another - `Paris Saint Germain` against
    `Paris Saint-Germain`, `AC Milan` against `Milan`. A raw-string lookup answers "no payload", which reads
    as "no evidence" and switches the whole signal off for that club without saying so. Third instance of «an
    entity joins through its CANONICAL KEY, never through the string a source uses to name it», and the
    cheapest to miss because it works on every other club.

    What `club_key` does NOT fix, and no join can: `Newcastle`/`Newcastle United` and
    `Eintracht`/`Eintracht Francoforte` are not two spellings, they are two ROWS of `clubs` for one club, with
    the listone's players on one and the provider's xref on the other. That is a data defect (see the spec's
    twin-identity note), not a lookup, and those two clubs stay dark until the identities are merged.

    THE COMPLETENESS. `/team/{id}/players` is the FIRST TEAM as the provider publishes it, and how much of it
    arrives varies: West Ham reads 18 men against 29 identified and not one of its fourteen "departures" is
    corroborated by a transfer, while Bologna at 24 of 28 is 6 for 6. So a payload speaks only above
    `SQUAD_COMPLETENESS` of the squad the sheet shows - measured curve in the constant's own comment.
    """
    from euroleghe_ingest.modules import snapshot

    class Obs:
        def __init__(self, fc_id, club):
            self.fc_id, self.club_target = fc_id, club

    def payload():
        return {snapshot._club_key("Paris Saint-Germain"):
                {"on": "2026-08-04", "club": "Paris Saint-Germain", "ids": set(range(1, 10))}}

    # the provider's spelling on one side, the listone's on the other
    live = snapshot.complete_squads(payload(), [Obs(n, "Paris Saint Germain") for n in range(1, 11)],
                                    set(range(1, 11)))
    assert snapshot.left_his_club(Obs(10, "Paris Saint Germain"), None, live, set(range(1, 11))) == (
        "not in the club's live squad", "2026-08-04"), "9 of 10 is a squad, and 10 is not in it"

    # ...the same payload against a squad it covers barely two thirds of says NOTHING
    thin = snapshot.complete_squads(payload(), [Obs(n, "Paris Saint Germain") for n in range(1, 15)],
                                    set(range(1, 15)))
    assert snapshot.left_his_club(Obs(14, "Paris Saint Germain"), None, thin, set(range(1, 15))) == (
        None, None)
    assert thin[snapshot._club_key("Paris Saint Germain")]["thin"] == (9, 14), "and it says how thin"


def test_the_fm_cell_shows_the_estimate_with_a_tilde_when_the_core_cannot_predict():
    """«Nella colonna FM se non ci sono abbastanza valori, mostra la FM stimata con il simbolino "circa"
    davanti» - the same rule the SURPLUS cell already follows, for the same reason.

    Under `MIN_PV_PREV` the core refuses to predict, so the one number an operator reads a player by was
    blank exactly for the men he knows least: Mazzocchi, 11 votes of 15, no FM at all while his estimate
    (5.885, blended with the level of Napoli's defenders) sat unread in another column. And the SORT KEY
    has to be the estimate too - a column that shows one list and orders by another is the defect the
    v9.28 measurement caught, and it looked measured.
    """
    view = _view_of([])
    view.manifest = {}
    gated = view._cell_values({"name": "Gated", "engine_fm_pred": "6.42", "est_fm": "5.9"})
    assert gated["fm"] == ("6.4", 6.42), "a gated prediction is shown plain, and never overwritten"

    guessed = view._cell_values({"name": "Mazzocchi", "engine_fm_pred": "", "est_fm": "5.885",
                           "engine_unpriced_reason": "only 11 votes of 15"})
    text, value = guessed["fm"]
    assert text == "~5.9", "the estimate, marked as one"
    assert value == 5.885, "and the number behind the cell is the one shown, so the sort agrees with it"

    unknown = view._cell_values({"name": "Nobody", "engine_fm_pred": "", "est_fm": ""})
    assert unknown["fm"] == ("", None), "nothing measured and nothing estimated stays a blank, not a zero"


def test_the_board_does_not_field_a_man_who_has_left_the_club():
    """«Avevamo detto di utilizzare sofascore come verità sulle rose» - and the eleven is where a squad is a
    squad. The row keeps its club (the listone is what you buy from, and it is reported with a ⇥), but the
    typical eleven is «the side with everybody fit» and a man who plays elsewhere is not in it at any fitness.
    Before this, `eligible` filtered injuries and suspensions only, so a departed starter was still drawn.
    """
    def man(name, codes, role, starts=30, **extra):
        return dict(name=name, role_classic=role, desc_real_roles=codes,
                    desc_season_starts=str(starts), desc_start_share=str(starts / 38), **extra)

    rows = [man("Portiere", "GK", "P")]
    rows += [man(f"Dif{i}", "DC", "D") for i in range(1, 4)]
    rows += [man(f"Cen{i}", "MC", "C") for i in range(1, 5)]
    rows += [man(f"Att{i}", "ST", "A") for i in range(1, 3)]
    # the strongest defender of the lot, and a transfer says he plays elsewhere now
    rows.append(man("Partito", "DC", "D", starts=38, desc_left_for="Bayer 04 Leverkusen",
                    desc_left_on="2026-07-01"))
    rows.append(man("Riserva", "DC", "D", starts=4))
    view = _view_of(rows)
    for mode in ("typical", "next"):
        eleven = view.eleven("Test", "4-4-2", mode)
        drawn = {row["name"] for _r, row, _o in eleven}
        offered = {row["name"] for _r, _s, others in eleven for row in others}
        assert "Partito" not in drawn, f"{mode}: a man who has left is not in the side"
        assert "Partito" not in offered, f"{mode}: nor is he one of its alternatives"
        assert "Riserva" in drawn, f"{mode}: and his place goes to somebody who is actually there"


def test_a_mantra_sheet_measures_its_surplus_against_a_mantra_replacement_level():
    """The SURPLUS on the EuroLeghe sheet was the VALUE, on all 1007 priced rows, and nothing said so.

    `features.replacement_levels` keys its levels on the vocabulary the GAME is played with - 'P'/'D'/'C'/'A'
    on classic, the twelve codes on mantra ('por' 4.33 ... 'pc' 7.19 on the 2026-27 euro window) - and the
    sheet asked for them with `role_classic`, which on mantra matches no key at all. Every reader then took
    the documented "no level, fall back to VALUE" branch: `engine_replacement_fm` empty, `engine_surplus`
    identical to `engine_value`, `est_surplus` the same, and `engine_role_rank` ranked inside the classic
    role by that same fallback. Only 1 or 2 of each role's top ten survived the correction.

    What is pinned: the level is found in the game's own vocabulary; a multi-role player is priced in the
    slot he is worth MOST in (that is the slot an auction fields him in) and the row NAMES it; a man with
    no mantra code at all still gets a level, because leaving him without one is what put 11 estimated men
    in the top 12 of the corrected sheet; and a window with no league setup - the gate's own path - still
    falls back to VALUE.
    """
    import pytest

    from euroleghe_ingest.modules import snapshot

    class Obs:
        def __init__(self, fc_id, roles_mantra, role_classic="A"):
            self.fc_id, self.role_classic, self.roles_mantra = fc_id, role_classic, roles_mantra

    class Pred:
        def __init__(self, obs, fm, pv):
            self.obs, self.fm_pred, self.pv_pred = obs, fm, pv

    class Data:
        def __init__(self, game, replacement):
            self.game, self.replacement = game, replacement

    # the real shape of the 2026-27 euro window: a winger's floor is far below a centre-forward's
    levels = {"w": 6.559, "t": 6.721, "a": 7.199, "pc": 7.191, "por": 4.326}
    mantra = Data("mantra", levels)
    winger = Obs(1, ("w", "a"))
    striker = Obs(2, ("pc",))

    # the slot is the CHEAPEST floor he is listed at - where he is worth most, and where he would be fielded
    assert snapshot.auction_level(winger, mantra) == ("w", pytest.approx(6.559))
    assert snapshot.auction_level(striker, mantra) == ("pc", pytest.approx(7.191))
    # ...and the surplus is measured over it, so it is NOT the value any more
    assert snapshot._surplus(Pred(winger, 7.5, 30.0), mantra) == pytest.approx((7.5 - 6.559) * 30.0)
    assert snapshot._surplus(Pred(winger, 7.5, 30.0), mantra) != pytest.approx(7.5 * 30.0)

    # NO mantra code - a man the listone does not carry - is levelled on his classic group's MEAN, and
    # the row shows the listone role rather than a code nobody observed. Not the cheapest of the group:
    # picking his best slot is a statement about a man whose slots we know, and we do not know his.
    unlisted = Obs(4, ())
    slot, level = snapshot.auction_level(unlisted, mantra)
    assert slot == "A"
    assert level == pytest.approx((6.559 + 6.721 + 7.199 + 7.191) / 4)
    assert snapshot._surplus(Pred(unlisted, 7.5, 30.0), mantra) != pytest.approx(7.5 * 30.0), (
        "an unlevelled estimate is a VALUE sitting in a column of surpluses - 11 of the top 12 rows")

    # classic asks the same question with one role per player, and the two vocabularies coincide
    classic = Data("classic", {"A": 5.605})
    assert snapshot.auction_level(Obs(3, ()), classic) == ("A", pytest.approx(5.605))
    assert snapshot._surplus(Pred(Obs(3, ()), 7.5, 30.0), classic) == pytest.approx((7.5 - 5.605) * 30.0)

    # the gate prepares its windows WITHOUT a league, so there is no level to be over: VALUE, as published
    bare = Data("mantra", {})
    assert snapshot.auction_level(winger, bare) == ("w", None), "still says which role, even unpriced"
    assert snapshot._surplus(Pred(winger, 7.5, 30.0), bare) == pytest.approx(7.5 * 30.0)

    # and the row carries the slot, or `engine_replacement_fm` is a number nobody can explain
    assert "engine_role_slot" in snapshot.PLAYER_COLUMNS


def test_the_sheet_carries_two_zeros_because_they_answer_two_questions():
    """DECISO il 16/08/2026 (metrica-asta-surplus-v1.md §21.1): due colonne, non una scelta.

    `engine_surplus` conta dal marginale di ROSA e risponde a «chi conviene comprare»; il rimpiazzo che
    ENTRA risponde a «quanto costa una giornata saltata», ed è mezzo punto più in alto. Nessuna delle due
    vince, quindi il foglio le porta tutt'e due e si sceglie soltanto per quale si ORDINA.

    Quattro cose sono fissate qui, e ognuna è una decisione che si potrebbe disfare per sbaglio:

    * la cascata è UNA (`auction_level` con la mappa che le si passa): due cascate finirebbero per
      dissentire su quale slot è di un uomo, che è il difetto per cui quella funzione esiste;
    * `engine_surplus` non si muove di un decimale - è gated, e questo è reporting;
    * senza regolamento la colonna è VUOTA e non un VALORE: un valore in una colonna di surplus è il
      difetto che mise 11 stimati nei primi 12;
    * le due colonne stanno nel contratto d'export, o l'app legge un foglio che non le ha.
    """
    import pytest

    from euroleghe_ingest.modules import snapshot

    class Obs:
        def __init__(self, fc_id, roles_mantra, role_classic="A"):
            self.fc_id, self.role_classic, self.roles_mantra = fc_id, role_classic, roles_mantra

    class Pred:
        def __init__(self, obs, fm, pv):
            self.obs, self.fm_pred, self.pv_pred = obs, fm, pv

    class Data:
        def __init__(self, game, replacement, fielded=None):
            self.game, self.replacement = game, replacement
            self.replacement_fielded = fielded or {}

    # i due zeri del foglio euro/mantra: la rosa e quello che entra davvero
    roster = {"w": 6.559, "t": 6.721, "a": 7.199, "pc": 7.191}
    fielded = {"w": 7.084, "t": 7.244, "a": 7.726, "pc": 8.286}
    data = Data("mantra", roster, fielded)
    winger = Obs(1, ("w", "a"))

    assert snapshot.auction_level(winger, data) == ("w", pytest.approx(6.559))
    assert snapshot.auction_level(winger, data, fielded) == ("w", pytest.approx(7.084))

    # LO SLOT SI DECIDE UNA VOLTA SOLA, e questo è il caso misurato che lo impone: al secondo livello i
    # centrali sono il pavimento più basso della difesa, quindi lasciando scegliere di nuovo TUTTI i
    # `dd`/`ds` dei due fogli mantra finirebbero nella lista dei `dc` - riga che dichiara uno slot e
    # porta il livello di un altro.
    back = Data("mantra", {"dc": 5.852, "dd": 5.669, "ds": 5.727},
                {"dc": 5.992, "dd": 6.282, "ds": 6.268})
    right = Obs(9, ("dd", "dc"), "D")
    assert snapshot.auction_level(right, back) == ("dd", pytest.approx(5.669))
    assert snapshot.auction_level(right, back, back.replacement_fielded) == (
        "dc", pytest.approx(5.992)), "libera di scegliere, la cascata lo sposta di lista"
    assert snapshot.auction_level(right, back, back.replacement_fielded, slot="dd") == (
        "dd", pytest.approx(6.282)), "con lo slot già deciso cambia solo la PROFONDITÀ"
    # ...e chi non ha codici resta sulla media del suo gruppo di listone, con lo slot fissato come senza
    assert snapshot.auction_level(Obs(10, (), "D"), back, back.replacement_fielded, slot="D") == (
        "D", pytest.approx((5.992 + 6.282 + 6.268) / 3))
    prediction = Pred(winger, 7.5, 30.0)
    assert snapshot._surplus(prediction, data) == pytest.approx((7.5 - 6.559) * 30.0)
    _slot, level = snapshot.auction_level(winger, data, fielded)
    assert snapshot._surplus_over(prediction, level) == pytest.approx((7.5 - 7.084) * 30.0)
    assert snapshot._surplus_over(prediction, level) < snapshot._surplus(prediction, data), (
        "lo zero più alto vale meno surplus: è la stessa aritmetica, non una seconda")

    # nessun regolamento -> nessuna colonna, e MAI il ripiego sul VALORE che la colonna gated ha
    assert snapshot._surplus_over(prediction, None) is None
    bare = Data("mantra", roster)
    assert snapshot.auction_level(winger, bare, bare.replacement_fielded) == ("w", None)
    assert snapshot._surplus(prediction, bare) == pytest.approx((7.5 - 6.559) * 30.0), (
        "e la colonna gated non si accorge nemmeno che l'altra esiste")

    from euroleghe_ingest.modules import export

    for column in ("desc_replacement_fielded", "desc_surplus_fielded"):
        assert column in snapshot.PLAYER_COLUMNS
        assert column in export.SHEET_COLUMNS, "un foglio che l'app non può leggere non serve a niente"


def test_measured_and_estimated_go_together_and_either_side_can_be_filtered():
    """The operator's decision of 05/08/2026, taken with the measurement in front of him:
    «stimati e misurati vanno insieme ma aggiungiamo la possibilità di filtrare gli uni e gli altri».

    ⚠️ What it costs is on the record and is not hidden by this test: ranking them together lowered the
    captured SURPLUS on 10 windows of 10, mean -12.4%, worst -30.3% (gate §7-undecies, `estimates`). The
    failure mode is variance - Douglas Luiz predicted +28.6 and returned -3.2, McTominay +16.0 and returned
    +50.2 - and the operator has chosen to see both kinds in one list with a filter, which is a decision the
    number informs rather than one it makes.

    What must hold, and is pinned here: `include` decides who is in the list; every figure of the block is
    computed from THAT list (the +0.00%-on-ten-windows defect came from a screen and a metric describing
    different lists); the gate's own path passes no estimates and is untouched.
    """
    import pytest

    from euroleghe_ingest.engine import evaluate

    class Obs:
        def __init__(self, fc_id, name, fm_prev):
            self.fc_id, self.name, self.fm_prev = fc_id, name, fm_prev
            self.role_classic, self.club_target = "A", "Test"
            self.roles_mantra = ("pc",)
            self.pv_prev = 30
            self.fm_act = self.pv_act = self.value_act = None
            self.price_initial = self.price_initial_mantra = 10.0
            self.fvm = self.fvm_mantra = 100.0

    class Pred:
        def __init__(self, obs, fm, pv):
            self.obs, self.fm_pred, self.pv_pred = obs, fm, pv
            self.value_pred = None if fm is None else fm * pv
            self.anchor = 6.0

    class Data:
        game = "classic"
        platform = "default"
        matchdays_target = 38
        reliability = 0.0
        min_availability = 0.0

        def __init__(self, observations):
            self.observations = observations
            self.replacement = {"A": 6.0}
            self.replacement_actual: dict = {}
            self.anchors = {"A": 6.0}
            self.forward_caps: dict = {}
            self.co_starts: dict = {}

    strong, weak, unpriced = Obs(1, "Strong", 7.0), Obs(2, "Weak", 6.2), Obs(3, "Unpriced", None)
    data = Data([strong, weak, unpriced])
    predictions = [Pred(strong, 7.0, 30.0), Pred(weak, 6.2, 30.0), Pred(unpriced, None, None)]
    estimates = {3: {"fm": 6.8, "pv": 28.0, "basis": "other_platform", "confidence": 0.95,
                     "note": "his season on the other platform", "value": 180.0, "surplus": 21.0}}

    def names(include):
        view = evaluate.auction_view(data, predictions, top_n=5, metric=evaluate.SURPLUS,
                                     estimates=estimates, include=include)
        return [row["name"] for row in view["A"]["predicted"]], view["A"]

    # TOGETHER: the estimate sits where its penalised score puts it, between the two measured men
    together, block = names(evaluate.INCLUDE_ALL)
    assert together == ["Strong", "Unpriced", "Weak"], together
    guessed = next(row for row in block["predicted"] if row["name"] == "Unpriced")
    assert guessed["estimated"] and guessed["est_basis"] == "other_platform"
    assert guessed["est_confidence"] == pytest.approx(0.95) and guessed["est_note"]
    assert block["include"] == evaluate.INCLUDE_ALL

    # ...and either side alone
    assert names(evaluate.INCLUDE_MEASURED)[0] == ["Strong", "Weak"]
    assert names(evaluate.INCLUDE_ESTIMATED)[0] == ["Unpriced"]

    # the block's own numbers follow the filter, never the other list
    _, measured_only = names(evaluate.INCLUDE_MEASURED)
    _, estimated_only = names(evaluate.INCLUDE_ESTIMATED)
    assert measured_only["n_estimated"] == 1, "the count of what EXISTS does not depend on the filter"
    assert all(not row["estimated"] for row in measured_only["predicted"])
    assert all(row["estimated"] for row in estimated_only["predicted"])

    # and the gate's path - no estimates at all - ranks the measured men and nothing else
    bare = evaluate.auction_view(data, predictions, top_n=5, metric=evaluate.SURPLUS)
    assert [row["name"] for row in bare["A"]["predicted"]] == ["Strong", "Weak"]
    assert bare["A"]["n_estimated"] == 0


def test_the_other_platform_rung_is_only_for_the_same_football():
    """«Kolo Muani ha già giocato nella Juventus qualche anno fa, forse non sarebbe più corretto prendere
    quella fantamedia come riferimento?» - yes, and the reason is a population, not a preference.

    The `other_platform` rung stands in with mean +0.001 and 92% inside 0.3, MEASURED on players with a
    full season on BOTH platforms: Serie A men, whose euro and default rows are one season seen from two
    calendars. Kolo Muani's euro 2025-26 is TOTTENHAM. Substituting it into a Serie A sheet is not that
    rung at all, it is a FOREIGN fantamedia - which is R1, refused by the gate on five windows of six - and
    it priced him 5.74 with a surplus of −9.9 while his own Juventus season sat one rung below, unread.
    It erred both ways: Gonzalez N. was lifted to +17.8 off a Liga season against his measured 6.41 here.

    Same rule as `synth.calibrated_competitions`: a fitted transform belongs to the population it was
    fitted on, and eligibility is read from the data. `default` covers Serie A alone, so the test is the
    roster's own league; on a euro sheet the other platform IS Serie A and always qualifies.
    """
    import sqlite3

    from euroleghe_ingest.engine import features
    from euroleghe_ingest.modules import snapshot

    class Obs:
        def __init__(self, fc_id):
            self.fc_id = fc_id

    conn = sqlite3.connect(":memory:")
    conn.executescript(
        """
        -- `mv` beside `fm` because the real table has both and the layer reads both: the estimate now
        -- carries the base vote too (`est_mv` = FM minus the bonus per appearance).
        CREATE TABLE season_stats (fc_id INTEGER, season TEXT, platform TEXT, pv INTEGER, mv REAL,
                                   fm REAL);
        CREATE TABLE rosters (fc_id INTEGER, season TEXT, fc_club_id INTEGER, role_classic TEXT, league TEXT);
        CREATE TABLE clubs (fc_club_id INTEGER, canonical_name TEXT);
        -- the layer that says how much football he played ELSEWHERE: empty here on purpose, so the
        -- rung under test is the competition filter and nothing else
        CREATE TABLE external_stats (fc_id INTEGER, season TEXT, source TEXT, competition TEXT,
                                     minutes INTEGER);
        CREATE TABLE external_match_stats (fc_id INTEGER, season TEXT, competition TEXT,
                                           real_md INTEGER);
        INSERT INTO clubs VALUES (1, 'Juventus');
        -- 5951 played 2025-26 in the Premier League; 7 played it in Serie A
        INSERT INTO rosters VALUES (5951, '2025-26', 1, 'A', 'premier_league'), (7, '2025-26', 1, 'A', 'serie_a'),
                                   (5951, '2024-25', 1, 'A', 'serie_a');   -- his Juventus year
        INSERT INTO season_stats VALUES
            (5951, '2025-26', 'euro', 23, 5.61, 5.74), (5951, '2024-25', 'default', 16, 6.06, 7.62),
            (7,    '2025-26', 'euro', 30, 6.10, 6.90);
        """
    )
    conn.executescript(
        """
        -- 6397 is Gonçalo Ramos: PSG for every season he has, and never a Serie A one
        INSERT INTO rosters VALUES (6397, '2025-26', 1, 'A', 'ligue_1'), (6397, '2024-25', 1, 'A', 'ligue_1');
        INSERT INTO season_stats VALUES (6397, '2025-26', 'euro', 26, 5.98, 6.23),
                                        (6397, '2024-25', 'euro', 19, 6.20, 7.50);
        """
    )
    window = features.Window("W", "2025-26", "2026-27", "2026-08-06")
    layer = snapshot.estimation_layer(conn, window, "default",
                                      [Obs(5951), Obs(7), Obs(6397)])["players"]
    assert "other" not in layer[5951], "a Premier season is not a Serie A season on the other calendar"
    assert layer[5951]["older"]["fm"] == 7.62, "...so the rung below answers: his own Serie A season"
    assert layer[7]["other"]["fm"] == 6.90, "a man who really played Serie A keeps the rung"
    # ...and the rung below is bound by the same test, which the first version of the filter forgot:
    # a Ligue 1 season is not «his last measured season» on a Serie A sheet, at either rung.
    assert "other" not in layer[6397] and "older" not in layer[6397],         "a man who has never played here belongs at the anchor, not at a foreign fantamedia"

    # ...and on a euro sheet the other platform is Serie A by construction, so nothing is filtered
    euro = snapshot.estimation_layer(conn, window, "euro", [Obs(5951)])["players"]
    assert euro[5951].get("other") is None, "no default row exists for him in 2025-26"


def test_an_old_fantamedia_is_regressed_before_it_becomes_a_prediction():
    """«Un calciatore che torna in Serie A dopo un anno: la sua FM è confrontabile?» - measured, and it is.

    Predicting season t from t-2 on our own Serie A seasons, anchor out of sample: returners (no Serie A at
    t-1) MAE 0.407 against 0.395 for men who never left, and the same best beta - the year away costs 0.012.
    What the same table also says is that RAW it loses to the plain role anchor (0.369 / 0.376) and that
    anchor + 0.40 x (FM - anchor) beats both (0.326 / 0.336), the shape the core already uses on `fm_prev`.
    It is biased UPWARD for the men this rung serves: +0.079, +0.144 for forwards.

    The direction matters as much as the size, so this pins both: a season above the anchor comes DOWN
    (Kolo Muani 6.98 -> 6.85, Ramos G. 7.50 -> 6.91) and one below it comes UP (Vasquez D. 4.61 -> 4.88,
    whose surplus went from 13.2 to 20.4). A shrinkage that only ever lowered would be a haircut, not a
    prediction.
    """
    from euroleghe_ingest.engine import estimate as est

    anchor = 6.30
    assert est.regress(7.50, anchor) < 7.50, "above the anchor it comes down..."
    assert est.regress(4.61, anchor) > 4.61, "...and below it, up"
    assert est.regress(anchor, anchor) == anchor, "at the anchor it does nothing"
    # the size is the measured beta, not a taste
    assert abs(est.regress(7.30, anchor) - (anchor + 0.40 * 1.0)) < 1e-9
    assert 0 < est.OLDER_BETA < 1


def test_a_man_who_has_left_has_no_claim_on_the_shirt():
    """«Vlahovic -> partito -> claim = 0». The board already refuses to field him; a row showing 54% beside
    a ⇥ was the panel contradicting itself in two columns. Zero and not "low": the claim asks whether this
    coach fields him, and the answer for a man at another club is no, at any fitness. What he measured last
    season stays in `tit` and `min`, which are facts about last season and not claims on this shirt."""
    view = _view_of([])
    view.manifest = {}
    row = {"name": "Vlahovic", "role_classic": "A", "desc_season_starts": "30",
           "desc_season_matches": "34", "desc_minutes_full_season": "2400", "club": "Test"}
    assert view.claim(row, "season") > 0.3, "with no departure he keeps the standing his minutes earned"
    row["desc_left_for"] = "svincolato"
    assert view.claim(row, "season") == 0.0
    assert view.claim(row, "recent") == 0.0, "and the next-match horizon says the same"
    assert view._cell_values(row)["claim"] == ("0%", 0.0)


def test_a_club_squad_does_not_contain_a_man_who_has_left():
    """«Perché si vede ancora Gutierrez nel Napoli?» - chiesto due volte, e la seconda è una risposta.

    The two questions are different and now answered differently. The AUCTION LIST keeps him, with his ⇥:
    the listone is what you bid against, and a row you can still be offered must not vanish. A club's
    SQUAD is a claim about who is at the club, and answering it with a man who plays elsewhere is wrong -
    which is also why the eleven and the claim already refused him.
    """
    rows = [{"name": "Gutierrez", "club": "Napoli", "role_classic": "D",
             "desc_left_for": "Bayer 04 Leverkusen", "desc_left_on": "2026-07-01"},
            {"name": "Buongiorno", "club": "Napoli", "role_classic": "D"},
            {"name": "Rrahmani", "club": "Napoli", "role_classic": "D"}]
    view = _view_of(rows)
    view.players = rows
    assert [r["name"] for r in view.squad("Napoli")] == ["Buongiorno", "Rrahmani"]
    assert any(r["name"] == "Gutierrez" for r in view.players), "resta nella lista d'asta"


def test_il_valore_di_mercato_si_legge_al_giorno_dell_asta_e_la_riga_dice_da_dove(tmp_path):
    """La CURVA batte la fotografia di stagione, e dove non arriva la fotografia resta - dichiarata.

    Il canale dell'investimento leggeva `market_values`, cioè UN valore per la stagione di input: per
    un'asta di agosto è un numero vecchio fino a un anno, che di un uomo comprato a luglio dice quanto
    valeva prima del trasferimento. `market_value_history` porta ogni variazione con la sua data, quindi
    «quanto valeva il giorno dell'asta» ha una risposta esatta - e la legalità è più stretta, non meno:
    un punto datato si filtra sulla data, una fotografia di stagione non sa dire quando è stata presa.

    Tre cose che questo test inchioda, e la terza è quella che un lettore futuro potrebbe togliere per
    sbaglio: si prende l'ULTIMO punto non successivo alla data d'asta (mai il più recente in assoluto,
    che sarebbe leggere il futuro), dove la curva non c'è si torna alla fotografia invece di dire None,
    e ogni riga dichiara quale delle due basi ha usato - due letture della stessa grandezza dentro la
    stessa somma sono oneste solo se la riga lo dice.
    """
    from euroleghe_ingest.engine import features

    conn = init_db(tmp_path / "test.db")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (10, 'Inter', 'serie_a')")
    for fc_id, name in ((1, "Con curva"), (2, "Solo fotografia")):
        conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", (fc_id, name))
    conn.executemany(
        "INSERT INTO market_value_history(fc_id, observed_on, source, value) VALUES (?, ?, 'tm', ?)",
        [(1, "2025-12-01", 30_000_000.0),      # la sua ultima lettura PRIMA dell'asta
         (1, "2026-09-30", 90_000_000.0)])     # ...e una DOPO, che nessuno può conoscere quel giorno
    conn.executemany("INSERT INTO market_values(fc_id, season, source, value) VALUES (?, '2025-26', 'tm', ?)",
                     [(1, 10_000_000.0), (2, 10_000_000.0)])
    conn.commit()

    class Obs:
        def __init__(self, fc_id):
            self.fc_id, self.club_target, self.role_classic = fc_id, "Inter", "A"

    window = features.Window("W", "2025-26", "2026-27", "2026-08-15")
    out = snapshot.investment(conn, window, [Obs(1), Obs(2)], {})

    assert out[1]["value"] == 30_000_000.0, "l'ultimo punto al giorno dell'asta, non quello di dicembre dopo"
    assert out[1]["value_basis"] == "curve"
    assert out[2]["value"] == 10_000_000.0, "senza curva resta la fotografia della stagione di input"
    assert out[2]["value_basis"] == "season"
    # ...e il denominatore è la somma delle letture che quei due uomini hanno davvero (30 + 10)
    assert out[1]["value_share"] == 0.75 and out[2]["value_share"] == 0.25

    # un uomo che la curva non tocca e che nessuna fotografia porta non ha né valore né base: «vuoto =
    # ignoto», e la sua assenza non entra nemmeno nel denominatore degli altri
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (3, 'Ignoto')")
    conn.commit()
    out = snapshot.investment(conn, window, [Obs(1), Obs(2), Obs(3)], {})
    assert out[3]["value"] is None and out[3]["value_basis"] is None and out[3]["value_share"] is None
    assert out[1]["value_share"] == 0.75, "il denominatore non cambia per un uomo che nessuno sa prezzare"
