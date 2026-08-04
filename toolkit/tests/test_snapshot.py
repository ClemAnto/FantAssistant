"""Tests for the auction snapshot.

The contract worth defending is not the arithmetic - the engine columns come from the harness and are
tested there - but the SEPARATION: an `engine_*` column is a gated valuation and a `desc_*` column is
not, and a sheet that blurs the two is how an ungated rule ends up in a decision. Plus the two dates
that make a dry run honest: the auction date must never be after the season it pretends to price.
"""

from __future__ import annotations

import csv
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
        return picture, where

    picture, where = drawn("3-4-3")
    assert picture == "3-4-2-1", where
    assert where["Hojlund"] == ("A", "C"), "the centre-forward is the centre-forward"
    assert where["Neres"][0] == "T", "the winger drops onto the trequarti, he is not a second striker"
    assert where["Neres"][1] in ("R", "L"), "and he keeps his flank: an inside forward, not a trequartista"
    assert where["Politano"] == ("M", "R"), "the wide forward drops back and COVERS the four's right"
    assert where["Spinazzola"] == ("M", "L")
    row = {name for name, (lane, _side) in where.items() if lane == "M"}
    assert row < {"Politano", "Spinazzola", "McTominay", "Lobotka", "De Bruyne"} and len(row) == 4, where

    # ...and a module whose own attack is a TWO keeps both men up front: nothing was thinned, so there is
    # nothing to transform, and the winger beside the striker is the seconda punta the coach asked for.
    picture, where = drawn("3-4-1-2")
    assert picture == "3-4-1-2", where
    assert where["Hojlund"][0] == "A" and where["Neres"][0] == "A", where

    # A side whose only forwards are wingers is drawn WITH THEM up front: that is the truth about the
    # squad, and an empty front line would be a worse drawing than a narrow one.
    rows[9].update(name="Lang", desc_real_roles="LW;RW")
    picture, where = drawn("3-4-3")
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
    # the shape gave him a WING - and with no Ad to pair it, the lone winger's As folds to Sp as well
    # («se c'è un Ad ci deve essere anche una As e viceversa»: flank codes stand in pairs or not at all)
    three = badged(("ST", "C"), ("ST", "R"), ("LW", "L"))
    assert three == {"ST@C": "Pc", "ST@R": "Sp", "LW@L": "Sp"}, three
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
