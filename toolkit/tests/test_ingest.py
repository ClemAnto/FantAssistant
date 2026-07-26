"""Tests for the rosters/stats parsers on a synthetic CSV (17-column format)."""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import load

CSV = (
    "id,nome,lega,squadra,r,rm,pv,mv,fm,gf,gs,rig_s,rig_t,rp,ass,amm,esp\n"
    "2557,Kane,Bundesliga,Bayern Monaco,A,pc,28,6.89,10.64,33,0,5,5,0,7,2,0\n"
    "100,Tizio,Serie A,Inter,C,m,10,6.0,6.5,1,0,0,0,0,2,1,0\n"
)


def _make_ctx(tmp_path):
    data_dir = tmp_path / "data"
    (data_dir / "raw").mkdir(parents=True)
    (data_dir / "raw" / "euroleghe-stats-2023-24.csv").write_text(CSV, encoding="utf-8")
    cfg = Config(data_dir=data_dir, db_path=data_dir / "euroleghe.db")
    return Context(config=cfg, conn=init_db(cfg.db_path))


def test_rosters_and_stats(tmp_path):
    ctx = _make_ctx(tmp_path)
    load("rosters").run(ctx)
    load("stats").run(ctx)
    conn = ctx.conn

    assert conn.execute("SELECT COUNT(*) FROM players").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM rosters").fetchone()[0] == 2

    # Kane: FM and penalties mapped correctly; league normalized; Mantra role lowercase
    row = conn.execute(
        "SELECT s.fm, s.pen_scored, s.pen_missed, s.goals, r.roles, r.role_classic, c.league "
        "FROM season_stats s JOIN rosters r ON r.fc_id=s.fc_id AND r.season=s.season "
        "JOIN clubs c ON c.fc_club_id=r.fc_club_id WHERE s.fc_id=2557"
    ).fetchone()
    assert row["fm"] == 10.64
    assert row["pen_scored"] == 5 and row["pen_missed"] == 0
    assert row["goals"] == 33
    assert row["roles"] == "pc"
    assert row["league"] == "bundesliga"

    # validate must not complain (known-empty columns are whitelisted)
    load("validate").run(ctx)


def test_rebuild_idempotent(tmp_path):
    ctx = _make_ctx(tmp_path)  # rebuild closes and reopens from scratch on its own
    load("rebuild").run(ctx)
    first = ctx.conn.execute("SELECT COUNT(*) FROM season_stats").fetchone()[0]
    load("rebuild").run(ctx)
    second = ctx.conn.execute("SELECT COUNT(*) FROM season_stats").fetchone()[0]
    assert first == second == 2


# A Bayern squad with one player per Classic role, to check role ordering.
CSV_MULTI = (
    "id,nome,lega,squadra,r,rm,pv,mv,fm,gf,gs,rig_s,rig_t,rp,ass,amm,esp\n"
    "2557,Kane,Bundesliga,Bayern Monaco,A,pc,28,6.89,10.64,33,0,5,5,0,7,2,0\n"
    "10,Kim,Bundesliga,Bayern Monaco,D,dc,30,6.1,6.2,1,0,0,0,0,1,3,0\n"
    "11,Kimmich,Bundesliga,Bayern Monaco,C,m,32,6.4,6.9,3,0,0,0,0,8,4,0\n"
    "12,Neuer,Bundesliga,Bayern Monaco,P,por,25,6.0,5.5,0,20,0,0,3,0,0,0\n"
)


def _build_db(tmp_path, csv_text):
    from euroleghe_ingest.config import Config
    from euroleghe_ingest.context import Context
    from euroleghe_ingest.db.database import init_db

    data_dir = tmp_path / "data"
    (data_dir / "raw").mkdir(parents=True)
    (data_dir / "raw" / "euroleghe-stats-2023-24.csv").write_text(csv_text, encoding="utf-8")
    cfg = Config(data_dir=data_dir, db_path=data_dir / "euroleghe.db")
    ctx = Context(config=cfg, conn=init_db(cfg.db_path))
    load("rebuild").run(ctx)
    return ctx


def _headless_root():
    import tkinter as tk

    try:
        root = tk.Tk()
    except tk.TclError:
        import pytest
        pytest.skip("no display available")
    root.withdraw()
    return root


def test_role_and_vote_helpers():
    from euroleghe_ingest.gui import (
        rating_cell_style,
        rating_cell_text,
        role_pill_color,
        role_sort_key,
    )

    assert role_pill_color("P") != role_pill_color("A")
    assert role_pill_color("pc")            # Mantra role has a color
    assert role_pill_color(None)            # default, no crash
    # Classic roles are colored regardless of case (P/D were grey before the case-insensitive fix)
    assert role_pill_color("P") == role_pill_color("p")
    assert role_pill_color("D") == role_pill_color("d")
    assert role_pill_color("P")[0] != "#9e9e9e" and role_pill_color("D")[0] != "#9e9e9e"
    # Classic role order P < D < C < A
    assert role_sort_key("P", "", 6.0) < role_sort_key("A", "", 6.0)
    assert role_sort_key("D", "", 6.0) < role_sort_key("C", "", 6.0)
    # fantavoti cell rendering
    assert rating_cell_text(7.5, "played") == "7.5"
    assert rating_cell_text(6.0, "sub") == "6"
    assert rating_cell_text(None, "injured") == "inf"
    assert rating_cell_style("injured") != rating_cell_style("played")


def test_elo_module(tmp_path):
    ctx = _build_db(tmp_path, CSV_MULTI)  # clubs table has "Bayern Monaco"
    (ctx.config.raw_dir / "elo-asta-mappa-club.csv").write_text(
        "squadra,elo24,elo25\nBayern Monaco,1900.0,1919.0\nInter,1964.7,1933.5\n",
        encoding="utf-8",
    )
    load("elo").run(ctx)
    rows = ctx.conn.execute(
        "SELECT ce.date, ce.elo FROM club_elo ce JOIN clubs c ON c.fc_club_id = ce.fc_club_id "
        "WHERE c.canonical_name = 'Bayern Monaco' ORDER BY ce.date"
    ).fetchall()
    assert [r[0] for r in rows] == ["2024-08-15", "2025-08-15"]
    assert rows[0][1] == 1900.0 and rows[1][1] == 1919.0
    # 'Inter' is outside this mini-perimeter -> simply not inserted (no crash)


def test_players_view_default_role_sort_persists(tmp_path):
    from euroleghe_ingest.gui import PlayersView

    ctx = _build_db(tmp_path, CSV_MULTI)
    root = _headless_root()
    try:
        view = PlayersView(root, ctx.config)
        view.reload()
        assert list(view.season_cb["values"]) == ["2023-24"]
        view.season_var.set("2023-24"); view._on_season_change()
        view.league_var.set("Bundesliga"); view._on_league_change()
        view.team_var.set("Bayern Monaco"); view._on_team_change()

        # default sort by role: P, D, C, A
        assert [r["name"] for r in view._rows] == ["Neuer", "Kim", "Kimmich", "Kane"]
        assert view._sort_col == "role_classic"

        # re-selecting the team must keep the sort (persist)
        view._on_team_change()
        assert view._sort_col == "role_classic"
        assert [r["name"] for r in view._rows] == ["Neuer", "Kim", "Kimmich", "Kane"]
    finally:
        root.destroy()


def test_fantavoti_grid_renders(tmp_path):
    from euroleghe_ingest.gui import PlayersView

    ctx = _build_db(tmp_path, CSV_MULTI)
    ctx.conn.executemany(
        "INSERT INTO match_ratings(fc_id, season, matchday, fantavoto, status) VALUES (?, ?, ?, ?, ?)",
        [
            (2557, "2023-24", 1, 7.5, "played"),
            (2557, "2023-24", 2, None, "injured"),
            (10, "2023-24", 1, 6.0, "sub"),
        ],
    )
    ctx.conn.commit()

    root = _headless_root()
    try:
        view = PlayersView(root, ctx.config)
        view.reload()
        view.season_var.set("2023-24"); view._on_season_change()
        view.league_var.set("Bundesliga"); view._on_league_change()
        view.team_var.set("Bayern Monaco"); view._on_team_change()

        view.mode_var.set(True)
        view._toggle_mode()
        assert view.body_canvas.find_all()          # something was drawn
        assert "2 matchdays" in view.info_var.get()  # md 1 and 2 present
    finally:
        root.destroy()
