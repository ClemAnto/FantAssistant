"""Tests for the press module: the dated reference, its archive, and the board comparison.

The press is a JUDGE, never an input of the claim - so nothing here touches the engine or the
presence model; what is under test is that the judgement is a REPEATABLE measurement: a dated fact
that survives `rebuild`, a comparison whose joins go through identities and not spellings, and an
extraction that drives the panel's own functions.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import press

REFERENCE = [
    {"club": "Hellas Verona", "coach_web": "Paolo Zanetti", "module": "3-5-2",
     "module_alternatives": ["3-4-2-1 (in partita)"],
     "typical_xi": {"GK": ["Montipo"], "DEF": ["Nunez", "Ghilardi", "Valentini"],
                    "MID": ["Tchatchoua", "Serdar", "Niasse", "Suslov", "Bradaric"],
                    "ATT": ["Giovane", "Sarr"]},
     "ballottaggi": ["Sarr vs Mosquera"], "notes": "test entry", "confidence": "medium"},
    {"club": "Atalanta", "coach_web": "Maurizio Sarri", "module": "4-3-3",
     "module_alternatives": ["4-3-1-2", "4-2-3-1"],
     "typical_xi": {"GK": ["Carnesecchi"], "DEF": ["Zappacosta", "Hien", "Scalvini", "Bernasconi"],
                    "MID": ["Samardzic", "Gaetano", "Ederson"],
                    "ATT": ["De Ketelaere", "Scamacca", "Raspadori"]},
     "ballottaggi": [], "notes": "", "confidence": "high"},
]


def _ctx(tmp_path) -> Context:
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    return Context(config=cfg, conn=init_db(cfg.db_path))


def test_import_is_a_dated_fact_that_survives_a_rebuild(tmp_path):
    """The reading lands keyed on its day and source, and the archive replays it after the table is
    gone - which is what `rebuild` (drop everything, re-ingest raw) does to every table."""
    ctx = _ctx(tmp_path)
    source_file = tmp_path / "groupA.json"
    source_file.write_text(json.dumps(REFERENCE), encoding="utf-8")
    season, day, source, count = press.import_reference(
        ctx, source_file, season="2026-27", observed_on="2026-08-08")
    assert (season, day, source, count) == ("2026-27", "2026-08-08", "press", 2)
    archived = press.archive(ctx, season, day, source)
    assert archived.name == "press_2026-27_2026-08-08_press.json"

    ctx.conn.execute("DELETE FROM press_formations")
    ctx.conn.commit()
    files, clubs = press.reingest_from_raw(ctx)
    assert (files, clubs) == (1, 2)
    row = ctx.conn.execute(
        "SELECT module, xi FROM press_formations WHERE club = 'Hellas Verona'").fetchone()
    assert row[0] == "3-5-2" and "Montipo" in row[1]


def test_reference_reads_the_latest_day_and_joins_by_identity(tmp_path):
    """Two readings of the same club on different days: the later one judges. And the club joins
    through `club_identity`, so the press's 'Hellas Verona' finds a sheet that says 'Verona'."""
    ctx = _ctx(tmp_path)
    for day, module in (("2026-08-01", "4-4-2"), ("2026-08-08", "3-5-2")):
        entry = dict(REFERENCE[0], module=module)
        path = tmp_path / f"ref-{day}.json"
        path.write_text(json.dumps([entry]), encoding="utf-8")
        press.import_reference(ctx, path, season="2026-27", observed_on=day)
    reference = press.load_reference(ctx.conn, "2026-27")
    assert list(reference) == ["hellas verona"]
    assert reference["hellas verona"]["module"] == "3-5-2"
    assert reference["hellas verona"]["observed_on"] == "2026-08-08"

    boards = {"Verona": {"board_shape": "3-5-2", "picture": "3-5-2",
                         "lines": {"P": [{"name": "Montipo"}], "D": [], "M": [], "T": [], "A": []}}}
    rows, summary = press.compare(boards, reference)
    assert summary["no_board"] == 0 and rows[0]["module"] == "MATCH"


def test_compare_verdicts_and_name_matching(tmp_path):
    """MATCH is judged on the DRAWN picture, ALT tolerates the press's free-text qualifier, DIFF is
    neither; names match on surname tokens both ways ('Martinez L.' vs 'Lautaro Martinez')."""
    ctx = _ctx(tmp_path)
    path = tmp_path / "ref.json"
    path.write_text(json.dumps(REFERENCE), encoding="utf-8")
    press.import_reference(ctx, path, season="2026-27", observed_on="2026-08-08")
    reference = press.load_reference(ctx.conn, "2026-27")

    verona_lines = {"P": [{"name": "Montipo"}],
                    "D": [{"name": "Nunez"}, {"name": "Ghilardi"}, {"name": "Unknown D"}],
                    "M": [{"name": "Tchatchoua"}, {"name": "Serdar"}, {"name": "Niasse"},
                          {"name": "Suslov"}, {"name": "Bradaric"}],
                    "T": [], "A": [{"name": "Giovane"}, {"name": "Sarr"}]}
    boards = {
        # board says 3-5-2 but the transformation drew 3-4-2-1 = the press's declared alternative
        "Verona": {"board_shape": "3-5-2", "picture": "3-4-2-1", "lines": verona_lines},
        "Atalanta": {"board_shape": "3-4-3", "picture": "3-4-3",
                     "lines": {"P": [{"name": "Carnesecchi"}], "D": [], "M": [], "T": [],
                               "A": [{"name": "De Ketelaere C."}]}},
    }
    rows, summary = press.compare(boards, reference)
    by_club = {row["club"]: row for row in rows}
    assert by_club["Hellas Verona"]["module"] == "ALT"           # first token of the qualifier
    assert by_club["Atalanta"]["module"] == "DIFF"               # not the module, not an alternative
    assert by_club["Hellas Verona"]["xi_shared"] == 10           # all but the unknown defender
    assert "Unknown D" in by_club["Hellas Verona"]["only_ours"]
    # the initial is dropped, the surname token joins: 'De Ketelaere C.' finds 'De Ketelaere'
    assert "De Ketelaere" not in by_club["Atalanta"]["only_press"]
    # `short_board` counts the boards that drew FEWER THAN ELEVEN men - here Atalanta's two. That is a
    # club whose contingent on the sheet cannot field an eleven, not a wrong forecast, so it is
    # reported apart instead of being scored as a miss (the euro sheet of 20/08/2026 carried 5 Como
    # rows against 29 quoted, and a 0-of-10 there would have been a fact about the sheet).
    assert by_club["Atalanta"]["our_xi"] == 2 and by_club["Hellas Verona"]["our_xi"] == 11
    assert summary == {"judged_on": "picture", "clubs": 2, "no_board": 0, "short_board": 1,
                       "module_match": 0, "module_alt": 1, "module_diff": 1,
                       "xi_shared": 12, "xi_of": 22}


def test_the_verdict_is_given_on_the_shape_the_reference_can_express(tmp_path):
    """The outcome is counted off the provider's THREE lines, so it can never say '3-4-1-2'. Judged on
    the drawn picture it reads as a disagreement every time `_reshape` split a row - the same shape
    written two ways, and on the 2025-26 back-test that artifact alone was 5 clubs of 20, the whole
    difference between 7 MATCH and 12."""
    boards = {"Atalanta": {"board_shape": "3-4-3", "picture": "3-4-1-2",
                           "lines": {"P": [], "D": [], "M": [], "T": [], "A": []}}}
    reference = {"atalanta": {"club": "Atalanta", "observed_on": "2025-26 (outcome)",
                              "source": "outcome", "module": "3-4-3", "module_alternatives": [],
                              "xi": {"XI": []}, "confidence": "46 XIs"}}
    on_picture, _ = press.compare(boards, reference, on="picture")
    on_board, summary = press.compare(boards, reference, on="board")
    assert on_picture[0]["module"] == "DIFF"          # 3-4-1-2 against a three-number reference
    assert on_board[0]["module"] == "MATCH"           # the comparable side
    assert summary["judged_on"] == "board"


def test_the_report_quantifies_the_vocabulary_without_tolerating_it(tmp_path):
    """Item 6b. Our 4-5-1 and the press's 4-2-3-1 can be the same eleven counted two ways, and how many
    clubs sit on that difference is a READING - never a second verdict, and never a widened criterion.
    So the report carries both counts and the verdict stays the one the reference can express."""
    boards = {"Lecce": {"board_shape": "4-5-1", "picture": "4-5-1",
                        "lines": {"P": [], "D": [], "M": [], "T": [], "A": []}},
              "Atalanta": {"board_shape": "3-4-3", "picture": "3-4-1-2",
                           "lines": {"P": [], "D": [], "M": [], "T": [], "A": []}}}
    reference = {
        "lecce": {"club": "Lecce", "observed_on": "d", "source": "press", "module": "4-2-3-1",
                  "module_alternatives": [], "xi": {"XI": []}, "confidence": ""},
        "atalanta": {"club": "Atalanta", "observed_on": "d", "source": "press", "module": "3-4-3",
                     "module_alternatives": [], "xi": {"XI": []}, "confidence": ""},
    }
    _rows, on_picture = press.compare(boards, reference, on="picture")
    _rows, on_board = press.compare(boards, reference, on="board")
    # judged on the picture Atalanta disagrees; judged on the board it agrees - the same eleven
    assert on_picture["module_match"] == 0 and on_board["module_match"] == 1
    assert on_picture["judged_on"] == "picture" and on_board["judged_on"] == "board"


def test_the_outcome_verdict_carries_its_null_model(tmp_path):
    """«A statistic must be compared with the right null, never with zero.» 135 of 220 means nothing
    until «the same eleven as last year» is on the page - and a promoted club is counted APART, because
    «0 of 11» there is a property of the baseline, not evidence about it."""
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (1,'Inter','serie_a')")
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(index, f"Player{index:02d}") for index in range(1, 13)])
    for season in ("2024-25", "2025-26"):
        conn.executemany("INSERT INTO rosters(fc_id, season, fc_club_id, league) "
                         "VALUES (?, ?, 1, 'serie_a')", [(i, season) for i in range(1, 13)])
        # ten men start both seasons; the eleventh differs, so the null must score 10 of 11
        squad = list(range(1, 12)) if season == "2024-25" else [*range(1, 11), 12]
        rows = []
        for match in range(12):
            for fc_id in squad:
                rows.append((fc_id, season, f"{season}-m{match}", 1))
        conn.executemany(
            "INSERT INTO external_match_stats(fc_id, season, source, match_id, started, club,"
            " competition, minutes) VALUES (?, ?, 'sofascore', ?, ?, 'Inter', 'serie_a', 90)", rows)
        conn.executemany(
            "INSERT INTO club_match_lineups(season, source, match_id, club, competition, starters,"
            " goalkeepers, defenders, midfielders, forwards) VALUES (?, 'sofascore', ?, 'Inter',"
            " 'serie_a', 11, 1, 3, 5, 2)", [(season, f"{season}-m{m}") for m in range(12)])
    conn.commit()
    reference = press.outcome_reference(conn, "2025-26")
    assert reference["inter"]["module"] == "3-5-2"
    null = press.null_model(conn, "2025-26", reference)
    assert null["season"] == "2024-25"
    assert (null["module_match"], null["xi_shared"], null["xi_of"]) == (1, 10, 11)
    assert null["no_previous"] == 0


def test_a_press_club_missing_from_the_sheet_is_reported_not_dropped(tmp_path):
    """A club the sheet has no board for is a statement (NO BOARD), never a silent hole - the same
    rule as the empty cell: the summary must say the population it was measured on."""
    ctx = _ctx(tmp_path)
    path = tmp_path / "ref.json"
    path.write_text(json.dumps(REFERENCE), encoding="utf-8")
    press.import_reference(ctx, path, season="2026-27", observed_on="2026-08-08")
    reference = press.load_reference(ctx.conn, "2026-27")
    rows, summary = press.compare({}, reference)
    assert summary["clubs"] == 2 and summary["no_board"] == 2
    assert all(row["status"] == "NO BOARD" for row in rows)


#: A legal 4-3-3 worth of men, plus whatever a caller adds behind them.
ELEVEN = ([("P", "por", "GK")]
          + [("D", "dc", "DL"), ("D", "dc", "DC"), ("D", "dc", "DC"), ("D", "dc", "DR")]
          + [("C", "c", "DM"), ("C", "c", "MC"), ("C", "c", "MC"),
             ("C", "c", "ML"), ("C", "c", "MR")]
          + [("A", "pc", "ST"), ("A", "pc", "LW"), ("A", "pc", "RW")])


def _one_club_sheet(tmp_path, roles=ELEVEN, starts="20", minutes="1800"):
    """A synthetic one-club sheet on disk, in the shape `SnapshotView.load_sheet` expects."""
    import csv

    from euroleghe_ingest.modules import snapshot

    folder = tmp_path / "data" / "reports" / "auction-snapshot-2026-27-euro-classic-2026-08-08"
    folder.mkdir(parents=True)
    with open(folder / "players.csv", "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(snapshot.PLAYER_COLUMNS))
        writer.writeheader()
        for index, (role, mantra, real) in enumerate(roles):
            writer.writerow({"fc_id": index, "name": f"Uomo{index}", "club": "Test",
                             "role_classic": role, "roles_mantra": mantra,
                             "desc_real_roles": real, "desc_real_role_primary": real,
                             "desc_start_share": "0.80",
                             "desc_season_starts": starts if index < 11 else "2",
                             "desc_season_matches": starts if index < 11 else "3",
                             "desc_minutes_full_season": minutes if index < 11 else "180"})
    with open(folder / "clubs.csv", "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["club", "formation_typical",
                                                    "formation_typical_share",
                                                    "formation_typical_of", "complete_XIs"])
        writer.writeheader()
        writer.writerow({"club": "Test", "formation_typical": "4-3-3",
                         "formation_typical_share": "0.9", "formation_typical_of": "30",
                         "complete_XIs": "30"})
    (folder / "manifest.json").write_text(
        json.dumps({"engine": {"rules": ["R0"]}, "target_season": "2026-27"}), encoding="utf-8")
    return folder


def _extract(tmp_path, folder, **kwargs):
    try:
        return press.extract_boards(
            Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db"), folder,
            **kwargs)
    except Exception as exc:                      # a display is an environment, not a failure
        if "display" in str(exc).lower() or "tcl" in str(exc).lower():
            pytest.skip(f"no display available: {exc}")
        raise


def test_extraction_drives_the_real_panel_headless(tmp_path):
    """`extract_boards` runs the panel's own class through the panel's own loader: the board shape,
    the drawn picture and eleven placed men with claims come back for a synthetic one-club sheet."""
    folder = _one_club_sheet(tmp_path)
    boards = _extract(tmp_path, folder)
    assert set(boards) == {"Test"}
    board = boards["Test"]
    assert "error" not in board, board.get("error")
    assert board["board_shape"] and board["picture"]
    placed = [man for line in ("P", "D", "M", "T", "A") for man in board["lines"][line]]
    assert len(placed) == 11
    assert all(isinstance(man["claim"], float) for man in placed)


def test_the_titolarita_ladder_covers_the_whole_sheet_and_obeys_the_board(tmp_path):
    """The operator's coherence requirement, checked where it can actually break (20/08/2026).

    Not a test of which rung: a test that the gate is wired in BOTH directions on real rows, because from
    inside `engine/status.py` the gate looks redundant and is the first thing a simplification deletes.
    The three men behind the eleven have a real but thin season, so their numbers alone would not stop
    them - only the drawing does.
    """
    from euroleghe_ingest.engine import status as status_engine

    roles = ELEVEN + [("D", "dc", "DC"), ("C", "c", "MC"), ("A", "pc", "ST")]
    folder = _one_club_sheet(tmp_path, roles)
    statuses: dict[int, dict] = {}
    boards = _extract(tmp_path, folder, with_rivals=True, statuses=statuses)
    drawn = {man["fc_id"] for line in boards["Test"]["lines"].values() for man in line}
    assert len(drawn) == 11
    # every row of the sheet gets an answer, not only the eleven
    assert set(statuses) == set(range(len(roles)))
    assert all(one["status"] in status_engine.LADDER for one in statuses.values())
    ceiling = status_engine.rank_of("ballottaggio")
    for fc_id, one in statuses.items():
        rank = status_engine.rank_of(one["status"])
        assert one["in_eleven"] is (fc_id in drawn)
        if fc_id in drawn:
            assert rank <= ceiling, f"{fc_id} is drawn and reads {one['status']}"
        else:
            assert rank >= ceiling, f"{fc_id} is not drawn and reads {one['status']}"
    # ...and the men ON the pitch carry it too, so a card is self-contained
    placed = [man for line in boards["Test"]["lines"].values() for man in line]
    assert all(man["status"] in status_engine.LADDER for man in placed)


def test_a_man_with_no_football_on_file_gets_NO_rung_and_not_riserva(tmp_path):
    """«Vuoto = ignoto, mai zero», in the shape that cost a real row on the first sheet that shipped.

    `presence.Inputs` stores appearances as a float, so an absent column and a measured zero both arrive
    as 0.0 and the share reads 0.000 - which the ladder would call `riserva`, the strongest thing it can
    say about a man. Terracciano F. read exactly that with nothing measured about him at all and the
    engine expecting him in 29 giornate of 38.
    """
    import csv

    from euroleghe_ingest.engine import status as status_engine
    from euroleghe_ingest.modules import snapshot

    roles = ELEVEN + [("C", "c", "MC")]
    folder = _one_club_sheet(tmp_path, roles)
    # ...and strip the twelfth man's football, which is what a July arrival's row looks like.
    path = folder / "players.csv"
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        if int(row["fc_id"]) == len(roles) - 1:
            for column in ("desc_season_matches", "desc_season_starts",
                           "desc_minutes_full_season", "desc_elsewhere_matches"):
                row[column] = ""
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(snapshot.PLAYER_COLUMNS))
        writer.writeheader()
        writer.writerows(rows)

    statuses: dict[int, dict] = {}
    _extract(tmp_path, folder, with_rivals=True, statuses=statuses)
    unmeasured = statuses[len(roles) - 1]
    assert unmeasured["status"] is None, unmeasured
    assert unmeasured["play"] is None
    # ...and the men who DO have a season still get one, so the guard has not switched the ladder off.
    assert statuses[0]["status"] in status_engine.LADDER


def test_a_rival_is_judged_on_the_DRAWN_eleven_and_not_on_the_shape_being_looked_at(tmp_path):
    """An alternative module is a button, not a fact about a man: his rung must not change with it.

    Same reason the badge is read off the drawn board - «the label is a fact about the man». Without the
    explicit `eleven_ids`, a man the club fields only in a shape it probably will not play would read
    `titolare` as soon as somebody clicked the other picture.
    """
    from euroleghe_ingest.engine import status as status_engine

    folder = _one_club_sheet(tmp_path, ELEVEN + [("C", "c", "MC")])
    boards = _extract(tmp_path, folder, with_rivals=True)
    drawn = {man["fc_id"] for line in boards["Test"]["lines"].values() for man in line}
    for alternative in (boards["Test"].get("alternatives") or {}).values():
        for line in alternative["lines"].values():
            for man in line:
                if man["fc_id"] not in drawn:
                    assert status_engine.rank_of(man["status"]) >= status_engine.rank_of("ballottaggio")


ARCHIVED = Path(__file__).resolve().parents[2] / "data" / "reports" / "press-formations-2026-08-08"


@pytest.mark.skipif(not ARCHIVED.exists(), reason="the 08/08/2026 reference is a local dataset")
def test_the_harness_reproduces_the_archived_2026_08_08_comparison(tmp_path):
    """The recorded judgement of 08/08/2026, replayed through the module's own compare().

    The archived pair (extracted boards + press reference) scores 9 MATCH / 5 ALT / 6 DIFF and
    160/220 men - the numbers of the ARCHIVED state, i.e. after the wing-back fix of that session.
    (The session notes quote 10/5/5 · 159/220 from a mid-session state whose boards were not kept.)
    """
    ctx = _ctx(tmp_path)
    for group in sorted(ARCHIVED.glob("press_group*.json")):
        press.import_reference(ctx, group, season="2026-27", observed_on="2026-08-08")
    reference = press.load_reference(ctx.conn, "2026-27")
    assert len(reference) == 20
    boards = json.loads((ARCHIVED / "boards_default.json").read_text(encoding="utf-8"))
    _rows, summary = press.compare(boards, reference)
    assert summary["module_match"] == 9 and summary["module_alt"] == 5
    assert summary["module_diff"] == 6 and summary["no_board"] == 0
    assert (summary["xi_shared"], summary["xi_of"]) == (160, 220)


def test_an_empty_reading_does_not_displace_a_full_one():
    """The judge was silently OFF on 20/08/2026: 20 blank rows of the 17th beat 20 full ones of the 8th.

    `load_reference` keeps the LAST row per club by (observed_on, source), which is right when both
    readings say something and is how a uniform «men 0/0» got reported - the zero this project has learnt
    not to believe. «Vuoto = ignoto, mai zero», applied to a judge's own reference.
    """
    import sqlite3

    from euroleghe_ingest.modules import press

    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE press_formations (club TEXT, season TEXT, observed_on TEXT,
                        source TEXT, coach TEXT, module TEXT, module_alternatives TEXT, xi TEXT,
                        duels TEXT, confidence REAL)""")
    conn.executemany("INSERT INTO press_formations VALUES (?, '2026-27', ?, ?, NULL, ?, NULL, ?, NULL, NULL)", [
        ("Napoli", "2026-08-08", "press", "4-3-3", '{"ATT": ["Alisson Santos"]}'),
        ("Napoli", "2026-08-17", "transfermarkt", None, None),
    ])
    loaded = press.load_reference(conn, "2026-27")
    entry = next(iter(loaded.values()))
    assert entry["module"] == "4-3-3" and entry["observed_on"] == "2026-08-08"
    # ...and a later reading that DOES say something still wins, which is what the ordering is for.
    conn.execute("INSERT INTO press_formations VALUES ('Napoli', '2026-27', '2026-08-18', 'press',"
                 " NULL, '3-4-3', NULL, '{\"ATT\": [\"Lucca\"]}', NULL, NULL)")
    assert next(iter(press.load_reference(conn, "2026-27").values()))["module"] == "3-4-3"

# ---------- the round judge (24/08/2026) ----------
def _one_round(ctx, *, score_only=("Inter",)):
    """Two clubs, one played round, and only SOME of them scored by the platform's voti.

    That asymmetry is the whole point: a round is «scored» from its first match, so a club still
    playing must leave the voto UNKNOWN instead of reading as a measured no-voto.
    """
    conn = ctx.conn
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name) VALUES (1, 'Inter')")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name) VALUES (2, 'Milan')")
    for fc_id, name, club in ((10, "Lautaro Martinez", 1), (11, "Barella", 1),
                              (20, "Leao", 2), (21, "Modric", 2)):
        conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", (fc_id, name))
        conn.execute("INSERT INTO rosters(fc_id, season, fc_club_id) VALUES (?, '2026-27', ?)",
                     (fc_id, club))
        conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (?, 'sofascore', ?)",
                     (fc_id, str(fc_id)))
    for match_id, club, back, middle, front in (("m1", "Inter", 3, 5, 2), ("m1", "Torino", 3, 4, 3),
                                                ("m2", "AC Milan", 4, 3, 3), ("m2", "Lazio", 4, 5, 1)):
        conn.execute(
            """INSERT INTO club_match_lineups(season, source, match_id, club, competition, real_md,
                                              match_date, starters, goalkeepers, defenders,
                                              midfielders, forwards)
               VALUES ('2026-27', 'sofascore', ?, ?, 'serie_a', 1, '2026-08-22', 11, 1, ?, ?, ?)""",
            (match_id, club, back, middle, front))
    for fc_id, match_id, club, started, minutes in ((10, "m1", "Inter", 1, 90), (11, "m1", "Inter", 0, 0),
                                                    (20, "m2", "AC Milan", 1, 76),
                                                    (21, "m2", "AC Milan", 0, 14)):
        conn.execute(
            """INSERT INTO external_match_stats(fc_id, season, source, match_id, competition,
                                                real_md, match_date, club, started, minutes)
               VALUES (?, '2026-27', 'sofascore', ?, 'serie_a', 1, '2026-08-22', ?, ?, ?)""",
            (fc_id, match_id, club, started, minutes))
    # only the clubs in `score_only` have their voti published for the round
    for fc_id, team, status in ((10, "Inter", "played"), (11, "Inter", "no_vote"),
                                (20, "Milan", "played"), (21, "Milan", "no_vote")):
        if team in score_only:
            conn.execute(
                """INSERT INTO match_ratings(fc_id, season, matchday, platform, team, status)
                   VALUES (?, '2026-27', 1, 'default', ?, ?)""", (fc_id, team, status))
    conn.commit()


def test_the_round_reference_reads_the_eleven_that_was_actually_fielded(tmp_path):
    """The judge that exists from the first weekend: the shape off `club_match_lineups` (three lines,
    so the verdict is given on the board and never on the drawn picture) and the starters off the
    per-match layer."""
    ctx = _ctx(tmp_path)
    _one_round(ctx)
    reference = press.round_reference(ctx.conn, "2026-27", rounds=(1,))
    assert set(reference) == {"inter", "milan"}
    inter = reference["inter"]
    assert inter["module"] == "3-5-2" and inter["observed_on"] == "2026-08-22"
    assert inter["xi"]["XI"] == ["Lautaro Martinez"] and inter["xi_resolved"] == 1
    assert reference["milan"]["module"] == "4-3-3"


def test_a_round_that_is_scored_for_one_club_leaves_the_other_unknown(tmp_path):
    """«Vuoto = ignoto, mai zero», applied to a judgement. A global «is round 1 scored?» flag turns
    every man of a match still being played into a measured no-voto - twenty-two zeros invented by
    the question - so the answer is asked per CLUB."""
    ctx = _ctx(tmp_path)
    _one_round(ctx, score_only=("Inter",))
    sheet = tmp_path / "sheet"
    sheet.mkdir()
    (sheet / "players.csv").write_text(
        "fc_id,name,club,desc_titolarita,desc_titolarita_play\n"
        "10,Lautaro Martinez,Inter,bandiera,0.9\n"
        "11,Barella,Inter,titolare,0.8\n"
        "20,Leao,Milan,bandiera,0.9\n"
        "21,Modric,Milan,ballottaggio,0.5\n", encoding="utf-8")
    verdict = press.judge_ladder(ctx.conn, sheet, "2026-27", "default", rounds=(1,))
    assert verdict["n"] == 4 and verdict["clubs_played"] == 2
    # Inter is scored: one voto of two. Milan is not: nobody of it counts toward the voto denominator.
    assert verdict["voto_known"] == 2
    assert verdict["base"]["voto"] == 1 and verdict["base"]["voto_of"] == 2
    # ...and STARTING is known for all four, because it comes from the lineups and not from the voti
    assert verdict["base"]["started"] == 2 and verdict["base"]["n"] == 4
    milan = [one for one in verdict["detail"] if one["club"] == "Milan"]
    assert all(one["voto"] is None for one in milan)
    assert {one["name"] for one in milan if one["minutes"] > 0} == {"Leao", "Modric"}
