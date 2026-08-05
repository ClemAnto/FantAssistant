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
    assert engine and desc and actual
    # nothing may sit in between: every column is identity/market, engine, descriptive, or an outcome
    known = {"fc_id", "name", "club", "league", "role_classic", "roles_mantra", "price_initial",
             "price_initial_mantra", "fvm_reporting_only"}
    assert set(snapshot.PLAYER_COLUMNS) == known | set(engine) | set(desc) | set(actual)
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
            view = AuctionView.__new__(AuctionView)
            view.inner = ttk.Frame(root)
            view.status_var = tk.StringVar()
            view.season_var = tk.StringVar(value="2026-27 · LIVE")
            row = {"rank": 1, "name": "Malen", "club": "Roma", "fm_pred": 7.92, "pv_pred": 28.6,
                   "surplus_pred": 44.8, "surplus_act": None, "value_pred": 226.2,
                   "value_act": None, "fvm": 210, "actual_rank": None, "pair": None}
            view._render({
                "window": "SNAP 2025-26->2026-27", "params_from": "T2+pooled(-)", "metric": metric,
                "live": True, "rules": "R3, R7, R13", "rows": 806, "priced": 357,
                "notes": [("2026-27 has no matchdays yet, so expected appearances are scaled on "
                           "2025-26's calendar (38 rounds)")],
                "by_role": {"A": {"n_ranked": 143, "replacement": 6.11, "replacement_actual": None,
                                  "hits": 0, "captured_value": 0.0, "perfect_value": 0.0,
                                  "predicted": [row], "actual": []}},
            })
            status = view.status_var.get()
            assert "LIVE" in status and "no season to compare against" in status
            assert "357 of 806 players priced" in status, "what IS honest: how much it can price"
            for claim in ("of the perfect", "names", "%"):
                assert claim not in status, (metric, claim, status)
            trees = [w for w in descendants(view.inner) if isinstance(w, ttk.Treeview)]
            assert len(trees) == 1, f"{metric}: a live role is ONE table, got {len(trees)}"
            columns = tuple(trees[0]["columns"])
            assert columns == AuctionView.LIVE_COLUMNS[metric]
            assert not [c for c in columns if "real" in c], columns
            # the cells must match the columns: dropping a column and forgetting its cell is how a
            # table starts printing the FVM under the header of the outcome it does not have
            values = trees[0].item(trees[0].get_children()[0], "values")
            assert len(values) == len(columns), (metric, values, columns)
            assert values[1] == "Malen"
            # The spare width of a single table goes to `Pair` and NOT to `Player`, measured three ways
            # (300 empty pixels beside short names / a clipped ΔQt.I at 170 px / this). And a heading is
            # aligned with its cells, or a 900 px column titles itself half a screen from its values.
            assert trees[0].column("Pair", "stretch") and not trees[0].column("Player", "stretch")
            for column in columns:
                assert trees[0].heading(column, "anchor") == trees[0].column(column, "anchor"), column
            # and the engine's caveat is on screen, not only in the manifest
            notes = [w for w in descendants(view.inner) if isinstance(w, ttk.Label)
                     and str(w.cget("text")).startswith("⚠")]
            assert len(notes) == 1 and "no matchdays yet" in str(notes[0].cget("text"))
            # the role header states the depth and the level, and claims nothing about hits
            box = view.inner.winfo_children()[1]
            assert isinstance(box, ttk.LabelFrame)
            head = str(box.cget("text"))
            assert "of 143 the engine could price" in head, head
            assert "in common" not in head and "captured" not in head, head
    finally:
        root.destroy()


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
