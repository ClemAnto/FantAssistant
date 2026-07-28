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

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
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
    assert engine and desc
    # nothing may sit in between: every column is either identity/market, engine, or descriptive
    known = {"fc_id", "name", "club", "league", "role_classic", "roles_mantra", "price_initial",
             "price_initial_mantra", "fvm_reporting_only"}
    assert set(snapshot.PLAYER_COLUMNS) == known | set(engine) | set(desc)
    # the price that may be read is the pre-auction one; the end-of-season value is labelled
    assert "price_initial" in known and "fvm_reporting_only" in known


def test_duels_need_a_probabili_snapshot_and_never_guess():
    class Obs:
        def __init__(self, fc_id, name, club, role):
            self.fc_id, self.name, self.club_target, self.role_classic = fc_id, name, club, role

    observations = [Obs(1, "Lautaro", "Inter", "A"), Obs(2, "Thuram", "Inter", "A"),
                    Obs(3, "Taremi", "Inter", "A")]
    assert snapshot.duels(observations, {}) == {}, "no snapshot -> no duel, not a guess from minutes"
    starters = {1: {"probability": 0.85}, 2: {"probability": 0.80}, 3: {"probability": 0.20}}
    found = snapshot.duels(observations, starters)
    assert found[1]["rivals"] == 1 and "Thuram" in found[1]["names"]
    assert found[3]["rivals"] == 0, "a 20% third striker is not in a duel with an 85% starter"


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


def test_a_real_attack_has_one_centre_forward_and_he_plays_in_the_middle():
    """Two rules a coach does not break, and the drawing has to obey both: a punta centrale plays in the
    middle of an attack, and a side fields ONE - the second adapts as a seconda punta."""
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    striker = {"name": "Nine", "desc_real_roles": "ST"}
    winger = {"name": "Seven", "desc_real_roles": "RW"}
    # for the wide slot the winger comes first, however the pool is ordered: a striker on the touchline
    # is a compromise, and it only happens when the flank has nobody else
    assert view.slot_cost(winger, "R", "A", 0) < view.slot_cost(striker, "R", "A", 0)
    assert view.slot_cost(striker, "C", "A", 0) < view.slot_cost(striker, "C", "A", 2)

    # two centre-forwards on the board: the central one keeps the shirt, the other reads seconda punta
    # the fractions are the real drawn ones, so the CENTRAL striker keeps the shirt: read off an even
    # spread instead, a second striker nearer the middle stole it from the true centre-forward
    codes = view._line_codes([(0.30, dict(striker, name="Nine bis"), []), (0.50, striker, [])])
    assert codes == ["Sp", "Pc"]
    assert view._line_codes([(0.15, winger, []), (0.50, striker, [])]) == ["Ad", "Pc"]


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

    goal, assist = Fake(), Fake()
    View._bonus(goal, 0, scored=True)
    View._bonus(assist, 0, scored=False)
    # both marks are black and sit on the dot's top-right corner; the goal's is the bigger one
    assert goal.pixels[(5, 2)] == assist.pixels[(6, 1)] == "#000000"
    assert len(goal.pixels) > len(assist.pixels)
    assert max(x for x, _y in goal.pixels) == max(x for x, _y in assist.pixels) == 7
