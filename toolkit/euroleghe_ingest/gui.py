"""Lightweight UI (Tkinter, stdlib) - the toolkit's operator panel.

Three tabs:
  * Operations - launch pipeline operations (initdb, rebuild, fetch, single modules) with a live
    log, DB status, and a per-button state indicator (completed / to do / unavailable).
  * Players    - browse the players of a selected team, with cascading season/league/team selectors
    and a canvas table (role pills, sortable columns) or a per-matchday fantavoti grid (colored by status).
  * Auction    - for a chosen season / platform / game, per role: the ten players the engine would
    have valued highest at the auction, and the ten who actually finished highest, each list carrying
    the other's rank plus the end-of-season FVM. Read-only, and it runs the same code path as
    `backtest --auction`, so the panel and the gate can never drift apart.

Operations run in a separate thread so the window doesn't freeze; module output is redirected into
the log panel. No external dependencies: Tkinter ships with Python.

Launch: `python -m euroleghe_ingest gui`  (or with no arguments).
"""

from __future__ import annotations

import queue
import sqlite3
import sys
import threading
import tkinter as tk
from tkinter import scrolledtext, ttk
from typing import ClassVar

from euroleghe_ingest import __version__
from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import connect, init_db, table_names
from euroleghe_ingest.matching import club_abbreviation
from euroleghe_ingest.modules import IMPLEMENTED, load
from euroleghe_ingest.sources import _norm_roles, available_sources


class _QueueWriter:
    """File-like: routes whatever the modules print to the log queue."""

    def __init__(self, q: queue.Queue) -> None:
        self._q = q

    def write(self, text: str) -> None:
        if text:
            self._q.put(text)

    def flush(self) -> None:  # required by the file-like interface
        pass


# ============================ Operations tab ============================

# Operations grouped by HOW OFTEN they are run - the panel's layout follows this, because the
# question in front of the panel is always "what do I have to run now?".
#   setup   = once (or after a schema/code change)
#   season  = when a new season opens: new squads, prices, arrivals, auction-time club strength
#   weekly  = as the season goes: new ratings, the round they map to, the external layer, the checks
OPERATION_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Setup - once", ("initdb", "rebuild", "fetch:plan")),
    ("Start of season", ("rosters", "stats", "elo", "transfers", "tournaments", "arrivals", "recent_form",
      "fbref")),
    ("During the season - every matchday",
     ("ratings", "matchdays", "positions", "synth", "fc_site", "validate")),
)

# Labels for the operations that are not pipeline modules (those just use their own name).
OPERATION_LABELS: dict[str, str] = {
    "initdb": "Initialize DB",
    "rebuild": "Rebuild all",
    "fetch:plan": "Plan fetch (--plan)",
}


def operation_label(command: str) -> str:
    return OPERATION_LABELS.get(command, command)


# Flat view of the same operations, in layout order: (label, command-key).
OPERATIONS: tuple[tuple[str, str], ...] = tuple(
    (operation_label(command), command)
    for _group, commands in OPERATION_GROUPS for command in commands
)

# One descriptive tooltip per button (what it does, in plain terms).
TOOLTIPS: dict[str, str] = {
    "initdb": "Create an empty database and apply the schema (all tables). Loads no data.",
    "rebuild": "Rebuild the whole database from scratch from the raw files in data/raw: runs every "
               "pipeline step in order and ends with validate. Safe to run repeatedly (idempotent).",
    "fetch:plan": "Work out which raw files are needed and, for domains not reachable yet, write "
                  "whitelist_request.md to forward to the workspace administrator. Does not use the network.",
    "rosters": "Normalize the season roster lists into players, clubs and rosters. fc_id is the primary "
               "key. Always the first pipeline step.",
    "stats": "Aggregate the season statistics (FM, goals, assists, cards, penalties, goals conceded...) "
             "into season_stats.",
    "ratings": "Scrape per-matchday ratings from fantacalcio.it (login required) into match_ratings, "
               "splitting standard assists from set-piece assists.",
    "matchdays": "Line the EuroLeghe calendar up with the real one, league by league (matchday_map): "
                 "which real matchdays the euro rounds cover, and which ones they skip.",
    "fc_site": "Read fantacalcio.it editorial lists (penalty takers, probable starters, unavailable "
               "players) into dated tables.",
    "transfers": "Read the club identities, the coach history and the club transfer pages from "
                 "Transfermarkt -> club_xref, coaches (hence the new_coach flag) and "
                 "transfers_history with the fees. Injuries and exit_risk are not covered yet.",
    "fbref": "Import from FBref: foreign-league performance, career penalty conversion, set pieces, "
             "xG/xA and minutes.",
    "positions": "Import the FULL real season from SofaScore. Asks which layer: 'season' = the facts "
                 "(goals, assists, minutes, xG/xA) into external_stats; 'match' = the per-match "
                 "ratings of the perimeter clubs, which is what fills the SYNTHETIC matchdays "
                 "(long, resumable - matchdays and synth run right after it).",
    "recent_form": "For the priced players the engine knows nothing about - they arrive from a league "
                   "we do not scrape - fetch their last 10 club matches (rating, minutes, goals) so "
                   "there is SOMETHING measured about them. Tagged apart from the 5-league layer: a "
                   "Serie B rating is not a Serie A one.",
    "synth": "Fit the SofaScore rating onto the real base voto on the overlap and fill the synthetic "
             "base voto (mv_synth) for the matches EuroLeghe never voted.",
    "arrivals": "Detect new arrivals by diffing the roster lists and classify them by tier (T1/T2/T3) "
                "for pricing.",
    "tournaments": "Load who actually PLAYED at an international tournament (SofaScore lineups, "
                   "minutes included) -> tournaments_squads + the post_torneo signal: a summer "
                   "tournament eats the next preseason, a mid-season one takes appearances away.",
    "elo": "Load club strength from ClubElo into club_elo at the auction dates (feeds the goalkeeper model).",
    "validate": "Run integrity checks on the database (e.g. no entirely-null column) and fail loudly if "
                "something is wrong.",
}

# Operation state -> (symbol, color) for the indicator dot.
STATE_STYLE: dict[str, tuple[str, str]] = {
    "completed": ("✓", "#2e7d32"),
    "todo": ("●", "#ed6c02"),
    "unavailable": ("○", "#9e9e9e"),
}
STATE_LABEL: dict[str, str] = {
    "completed": "Completed - no need to run.",
    "todo": "To do - available, should be run.",
    "unavailable": "Not available.",
}


# What each module PRODUCES: as soon as that has rows, the module counts as done. Keep this in sync
# with IMPLEMENTED (a test enforces it) - a module missing from here would stay orange forever.
# `synth` writes a COLUMN, not a table, hence the "table.column" pseudo-key filled by _db_counts.
OUTPUT_COUNTER: dict[str, str] = {
    "rosters": "rosters",
    "stats": "season_stats",
    "ratings": "match_ratings",
    "matchdays": "matchday_map",
    "fc_site": "penalty_hierarchy",   # the revealed hierarchy is derived offline, so it always lands
    "positions": "external_stats",
    "recent_form": "external_match_stats",
    "synth": "external_match_stats.mv_synth",
    "tournaments": "tournaments_squads",
    "transfers": "coaches",
    "arrivals": "arrivals",
    "elo": "club_elo",
}

# Column-level outputs to count alongside the table row counts: (pseudo-key, table, column).
COLUMN_COUNTERS: tuple[tuple[str, str, str], ...] = (
    ("external_match_stats.mv_synth", "external_match_stats", "mv_synth"),
)


def operation_state(command: str, counts: dict[str, int] | None, has_sources: bool) -> str:
    """Pure state logic: 'completed' | 'todo' | 'unavailable' for an operation."""
    def rows(table: str) -> int:
        return counts.get(table, 0) if counts else 0

    has_db = counts is not None

    if command == "initdb":
        return "completed" if has_db else "todo"
    if command == "rebuild":
        if not has_sources:
            return "unavailable"
        return "completed" if rows("players") > 0 else "todo"
    if command == "fetch:plan":
        return "unavailable"
    if command not in IMPLEMENTED:
        return "unavailable"
    if command == "validate":
        return "todo" if rows("players") > 0 else "unavailable"
    if not has_sources:
        return "unavailable"
    counter = OUTPUT_COUNTER.get(command)
    if counter and rows(counter) > 0:
        return "completed"
    return "todo"


class Tooltip:
    """Minimal hover tooltip for a Tk widget (stdlib only). `text` may be a str or a callable."""

    def __init__(self, widget, text, delay: int = 450, wraplength: int = 320,
                 anchor: str = "widget", bind_events: bool = True) -> None:
        self.widget = widget
        self.text = text
        self.delay = delay
        self.wraplength = wraplength
        # 'widget' parks the tip beside the widget; 'pointer' follows the cursor, which is what a
        # per-column tooltip needs - a Treeview heading is part of the tree, not a widget of its own.
        self.anchor = anchor
        self._after_id: str | None = None
        self._tip: tk.Toplevel | None = None
        if bind_events:
            widget.bind("<Enter>", self.schedule, add="+")
            widget.bind("<Leave>", self.hide, add="+")
            widget.bind("<ButtonPress>", self.hide, add="+")

    def schedule(self, _event=None) -> None:
        self._unschedule()
        self._after_id = self.widget.after(self.delay, self._show)

    def _unschedule(self) -> None:
        if self._after_id is not None:
            self.widget.after_cancel(self._after_id)
            self._after_id = None

    def _show(self) -> None:
        text = self.text() if callable(self.text) else self.text
        if self._tip is not None or not text:
            return
        if self.anchor == "pointer":
            x = self.widget.winfo_pointerx() + 14
            y = self.widget.winfo_pointery() + 18
        else:
            x = self.widget.winfo_rootx() + self.widget.winfo_width() + 8
            y = self.widget.winfo_rooty()
        self._tip = tw = tk.Toplevel(self.widget)
        tw.wm_overrideredirect(True)
        tw.wm_geometry(f"+{x}+{y}")
        tk.Label(
            tw, text=text, justify="left", background="#ffffe0", foreground="#000000",
            relief="solid", borderwidth=1, wraplength=self.wraplength, padx=8, pady=6,
        ).pack()

    def hide(self, _event=None) -> None:
        self._unschedule()
        if self._tip is not None:
            self._tip.destroy()
            self._tip = None


class HeadingTooltip:
    """Per-column hover help for a Treeview's header row.

    Headings are drawn by the tree, not packed as widgets, so there is nothing to bind a Tooltip to.
    This follows <Motion>, asks the tree what is under the cursor, and reschedules the tip whenever the
    column changes - without that, sliding along the header would keep the first column's text up.
    """

    def __init__(self, tree, help_by_column: dict[str, str]) -> None:
        self.tree = tree
        self.help = help_by_column
        self.current: str | None = None
        self.tip = Tooltip(tree, self._text, delay=350, anchor="pointer", bind_events=False)
        tree.bind("<Motion>", self._on_motion, add="+")
        tree.bind("<Leave>", self._leave, add="+")

    def _text(self) -> str:
        return self.help.get(self.current or "", "")

    def _column_under(self, event) -> str | None:
        if self.tree.identify_region(event.x, event.y) != "heading":
            return None
        columns = self.tree.cget("columns")
        try:
            index = int(self.tree.identify_column(event.x).lstrip("#")) - 1
        except ValueError:
            return None
        return columns[index] if 0 <= index < len(columns) else None

    def _on_motion(self, event) -> None:
        column = self._column_under(event)
        if column == self.current:
            return
        self.current = column
        self.tip.hide()
        if column and self.help.get(column):
            self.tip.schedule()

    def _leave(self, _event=None) -> None:
        self.current = None
        self.tip.hide()


# ============================== Players tab ==============================

LEAGUE_DISPLAY: dict[str, str] = {
    "serie_a": "Serie A",
    "premier_league": "Premier League",
    "la_liga": "La Liga",
    "bundesliga": "Bundesliga",
    "ligue_1": "Ligue 1",
}

# Player table columns: (column id, header, kind, width). kind in {"num", "text", "pill"}.
PLAYER_COLUMNS: tuple[tuple[str, str, str, int], ...] = (
    ("fc_id", "ID", "num", 48),
    ("name", "Name", "text", 150),
    ("role_classic", "R", "pill", 46),
    ("roles", "Mantra", "pill", 135),
    ("pv", "Pv", "num", 40),
    ("mv", "Mv", "num", 50),
    ("fm", "Fm", "num", 50),
    ("goals", "Gf", "num", 40),
    ("assists", "Ass", "num", 42),
    ("yellows", "Amm", "num", 44),
    ("reds", "Esp", "num", 40),
    ("own_goals", "Au", "num", 38),
    ("pen_scored", "R+", "num", 38),
    ("pen_missed", "R-", "num", 38),
    ("goals_conceded", "Gs", "num", 40),
    ("pen_saved", "Rp", "num", 38),
)

# Approximate fantacalcio.it role colors (background, foreground). Centralized so the exact
# brand hex can be tuned in one place if these don't match precisely.
ROLE_COLORS: dict[str, tuple[str, str]] = {
    "P": ("#f0a30a", "#ffffff"), "D": ("#3fa535", "#ffffff"),
    "C": ("#22a0c8", "#ffffff"), "A": ("#e4022d", "#ffffff"),
    "por": ("#f0a30a", "#ffffff"),
    "dc": ("#2e7d32", "#ffffff"), "dd": ("#3fa535", "#ffffff"), "ds": ("#3fa535", "#ffffff"),
    "b": ("#66bb6a", "#ffffff"), "e": ("#16a085", "#ffffff"),
    "m": ("#22a0c8", "#ffffff"), "c": ("#2f6fbf", "#ffffff"),
    "w": ("#8e44ad", "#ffffff"), "t": ("#e67e22", "#ffffff"),
    "a": ("#e4022d", "#ffffff"), "pc": ("#c0392b", "#ffffff"),
}
_DEFAULT_ROLE_COLOR = ("#9e9e9e", "#ffffff")

CLASSIC_ORDER = {"P": 0, "D": 1, "C": 2, "A": 3}
MANTRA_ORDER = {r: i for i, r in enumerate(
    ["por", "dc", "dd", "ds", "b", "e", "m", "c", "w", "t", "a", "pc"])}


def role_pill_color(role) -> tuple[str, str]:
    if not role:
        return _DEFAULT_ROLE_COLOR
    r = str(role).strip()
    # case-insensitive: Classic roles are uppercase (P/D/C/A), Mantra roles lowercase (por/dc/...).
    return (ROLE_COLORS.get(r) or ROLE_COLORS.get(r.lower())
            or ROLE_COLORS.get(r.upper()) or _DEFAULT_ROLE_COLOR)


def _split_roles(value) -> list[str]:
    # Single canonical splitter for multi-valued Mantra roles (';', '|' or '/').
    return _norm_roles(value)


def role_sort_key(role_classic, roles, fm) -> tuple:
    rc = (role_classic or "").upper()
    split = _split_roles(roles)
    first_m = split[0] if split else ""
    fmv = fm if fm is not None else -1e9
    return (CLASSIC_ORDER.get(rc, 9), MANTRA_ORDER.get(first_m, 99), -fmv)


# Fantavoti (per-matchday) cell styling by player status.
RATING_STATUS_STYLE: dict[str, tuple[str, str]] = {
    "played": ("#ffffff", "#111111"),
    "sub": ("#cfe8ff", "#0b3d66"),
    "no_vote": ("#ececec", "#666666"),
    "bench": ("#dcdcdc", "#777777"),
    "injured": ("#ffd6d6", "#a11111"),
    "suspended": ("#ffe0b3", "#7a4a00"),
    "not_in_squad": ("#c8c8c8", "#666666"),
}
RATING_STATUS_LABEL: dict[str, str] = {
    "played": "vote", "sub": "substitute", "no_vote": "no vote (SV)",
    "bench": "bench", "injured": "injured", "suspended": "suspended", "not_in_squad": "not in squad",
}
RATING_MARKER: dict[str, str] = {
    "no_vote": "sv", "bench": "•", "injured": "inf", "suspended": "sq", "not_in_squad": "–",
}
# Real matchdays the EuroLeghe calendar never voted: the value shown is the CALIBRATED SYNTHETIC
# base voto (external_match_stats.mv_synth), not a real vote - hence its own colour.
SYNTHETIC_STYLE = ("#ede4ff", "#4b2a86")
SYNTHETIC_HEADER = "#ded0f7"
_DEFAULT_RATING_STYLE = ("#ffffff", "#111111")


def half_step(value) -> float | None:
    """Round to the nearest 0.5 - the grid real votes live on.

    Only for DISPLAY: external_match_stats.mv_synth keeps the continuous fit, which is what the
    engine should average over a season (rounding every match first only adds noise).
    """
    if value is None:
        return None
    return round(value * 2) / 2


def rating_cell_style(status) -> tuple[str, str]:
    return RATING_STATUS_STYLE.get(status, _DEFAULT_RATING_STYLE)


def rating_cell_text(fantavoto, status) -> str:
    if status in ("played", "sub") and fantavoto is not None:
        try:
            return f"{float(fantavoto):g}"
        except (TypeError, ValueError):
            return str(fantavoto)
    return RATING_MARKER.get(status, "")


def _round_rect(canvas: tk.Canvas, x1, y1, x2, y2, r, **kw):
    r = min(r, (x2 - x1) / 2, (y2 - y1) / 2)
    points = [x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2,
              x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1]
    return canvas.create_polygon(points, smooth=True, **kw)


def _fmt_num(v) -> str:
    if v is None or v == "":
        return ""
    if isinstance(v, float):
        return f"{v:g}"
    return str(v)


_PLAYER_QUERY = """
    SELECT p.fc_id AS fc_id, p.canonical_name AS name,
           r.role_classic AS role_classic, r.roles AS roles,
           s.pv AS pv, s.mv AS mv, s.fm AS fm, s.goals AS goals, s.assists AS assists,
           s.yellows AS yellows, s.reds AS reds, s.own_goals AS own_goals,
           s.pen_scored AS pen_scored, s.pen_missed AS pen_missed,
           s.goals_conceded AS goals_conceded, s.pen_saved AS pen_saved
    FROM rosters r
    JOIN players p ON p.fc_id = r.fc_id
    JOIN clubs c ON c.fc_club_id = r.fc_club_id
    LEFT JOIN season_stats s ON s.fc_id = r.fc_id AND s.season = r.season
      -- prefer the fuller-season aggregate (default = full real season) so a player's goals/assists
      -- count even when they fall outside the EuroLeghe calendar; euro for non-Serie-A players.
      AND s.platform = (SELECT platform FROM season_stats x
                        WHERE x.fc_id = r.fc_id AND x.season = r.season
                        ORDER BY x.pv DESC, x.platform LIMIT 1)
    WHERE r.season = ? AND c.league = ? AND c.canonical_name = ?
"""

_TEAM_PLAYERS_QUERY = """
    SELECT p.fc_id AS fc_id, p.canonical_name AS name,
           r.role_classic AS role_classic, r.roles AS roles
    FROM rosters r
    JOIN players p ON p.fc_id = r.fc_id
    JOIN clubs c ON c.fc_club_id = r.fc_club_id
    WHERE r.season = ? AND c.league = ? AND c.canonical_name = ?
"""

# Per-matchday ratings of one team, on the REAL calendar.
#
# Two things happen here, both in SQL on purpose:
#  * one platform per player - EuroLeghe and the classic Serie A have different calendars, so we take
#    the fuller one (Serie A players come from `default`, everyone else from `euro`);
#  * the matchday is translated to the REAL one, so the grid can put a euro round and a synthetic
#    round side by side: `default` matchdays already ARE real ones, `euro` matchdays go through
#    matchday_map (and fall back to themselves when the map has not been built yet).
#
# The team is resolved FIRST (the `team` CTE) and everything else joins onto those ~30 players. The
# earlier version asked "which platform is fuller?" as a correlated subquery in the WHERE clause,
# which re-ran a GROUP BY over match_ratings for every candidate row: 130 s on 91k rows.
_RATINGS_QUERY = """
    WITH team AS (
        SELECT r.fc_id AS fc_id, c.league AS league
        FROM rosters r
        JOIN clubs c ON c.fc_club_id = r.fc_club_id
        WHERE r.season = ? AND c.league = ? AND c.canonical_name = ?
    ),
    per_platform AS (
        SELECT v.fc_id AS fc_id, v.platform AS platform, COUNT(*) AS n
        FROM match_ratings v
        JOIN team t ON t.fc_id = v.fc_id
        WHERE v.season = ?
        GROUP BY v.fc_id, v.platform
    ),
    chosen AS (   -- MIN(platform) only breaks a tie, deterministically
        SELECT fc_id, MIN(platform) AS platform
        FROM per_platform p
        WHERE p.n = (SELECT MAX(q.n) FROM per_platform q WHERE q.fc_id = p.fc_id)
        GROUP BY fc_id
    )
    SELECT v.fc_id AS fc_id,
           CASE WHEN v.platform = 'default' THEN v.matchday
                ELSE COALESCE(m.real_md, v.matchday) END AS matchday,
           v.fantavoto AS fantavoto, v.status AS status
    FROM match_ratings v
    JOIN team t ON t.fc_id = v.fc_id
    JOIN chosen ch ON ch.fc_id = v.fc_id AND ch.platform = v.platform
    LEFT JOIN matchday_map m ON m.season = v.season AND m.league = t.league
                            AND m.euro_md = v.matchday
    WHERE v.season = ?
"""

# euro <-> real calendar (per league) and the synthetic per-match layer, for the fantavoti grid.
_MATCHDAY_MAP_QUERY = """
    SELECT euro_md, real_md FROM matchday_map WHERE season = ? AND league = ? ORDER BY real_md
"""

# Every matchday of the season for a league, so the grid shows the WHOLE calendar and not just the
# rounds the selected team's players happen to have a row for (a squad with 2 known players used to
# get 2 columns). Three sources, unioned: the euro rounds (translated to real where the map exists),
# the classic Serie A calendar, and the real rounds seen by the external per-match layer.
_CALENDAR_QUERY = """
    SELECT DISTINCT md FROM (
        SELECT COALESCE(m.real_md, v.matchday) AS md
        FROM (SELECT DISTINCT matchday FROM match_ratings
              WHERE season = ? AND platform = 'euro') v
        LEFT JOIN matchday_map m ON m.season = ? AND m.league = ? AND m.euro_md = v.matchday
        UNION
        SELECT DISTINCT matchday AS md FROM match_ratings
        WHERE season = ? AND platform = 'default' AND ? = 'serie_a'
        UNION
        SELECT DISTINCT real_md AS md FROM external_match_stats
        WHERE season = ? AND competition = ? AND real_md IS NOT NULL
    )
    WHERE md IS NOT NULL ORDER BY md
"""

_SYNTH_QUERY = """
    SELECT e.fc_id AS fc_id, e.real_md AS real_md, e.mv_synth AS mv_synth, e.minutes AS minutes
    FROM external_match_stats e
    JOIN rosters r ON r.fc_id = e.fc_id AND r.season = e.season
    JOIN clubs c ON c.fc_club_id = r.fc_club_id
    WHERE e.season = ? AND c.league = ? AND c.canonical_name = ?
      AND e.source = 'sofascore' AND e.real_md IS NOT NULL
"""

ROW_H = 26
HEADER_H = 28
NAME_W = 150   # fantavoti grid: player-name column width
CELL_W = 42    # fantavoti grid: matchday cell width

# Left (fixed) columns kept visible in the fantavoti grid too: name + role pills, sortable.
VOTES_LEFT_COLUMNS: tuple[tuple[str, str, str, int], ...] = (
    ("name", "Name", "text", 150),
    ("role_classic", "R", "pill", 46),
    ("roles", "Mantra", "pill", 120),
)


class PlayersView(ttk.Frame):
    """Team players browser: cascading selectors + a sortable canvas table / fantavoti grid."""

    def __init__(self, parent: tk.Widget, config: Config) -> None:
        super().__init__(parent, padding=10)
        self.config = config
        self._league_map: dict[str, str] = {}      # display league -> raw league key
        self._sort_col = "role_classic"            # default: sort by role (persists across selections)
        self._sort_desc: dict[str, bool] = {}
        self._col_layout: list[tuple] = []
        self._rows: list[sqlite3.Row] = []
        self._rating_rows: list[sqlite3.Row] = []
        self._rating_players: list[sqlite3.Row] = []
        self._matchday_map: list[sqlite3.Row] = []
        self._synth_rows: list[sqlite3.Row] = []
        self._calendar: list[int] = []
        self._build()

    # ---------- layout ----------
    def _build(self) -> None:
        top = ttk.Frame(self)
        top.pack(fill="x")
        self.season_var = tk.StringVar()
        self.league_var = tk.StringVar()
        self.team_var = tk.StringVar()
        self.season_cb = self._selector(top, "Season", self.season_var, self._on_season_change)
        self.league_cb = self._selector(top, "League", self.league_var, self._on_league_change)
        self.team_cb = self._selector(top, "Team", self.team_var, self._on_team_change)
        self.mode_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(top, text="Fantavoti (per matchday)", variable=self.mode_var,
                        command=self._toggle_mode).pack(side="left", padx=(12, 0))
        self.info_var = tk.StringVar(value="")
        ttk.Label(top, textvariable=self.info_var, foreground="#555").pack(side="right", padx=6)

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True, pady=(8, 0))
        self.header_canvas = tk.Canvas(body, height=HEADER_H, highlightthickness=0, background="#e9e9e9")
        self.body_canvas = tk.Canvas(body, highlightthickness=0, background="#ffffff")
        vsb = ttk.Scrollbar(body, orient="vertical", command=self.body_canvas.yview)
        hsb = ttk.Scrollbar(body, orient="horizontal", command=self._xview_both)
        self.body_canvas.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)
        self.header_canvas.grid(row=0, column=0, sticky="ew")
        self.body_canvas.grid(row=1, column=0, sticky="nsew")
        vsb.grid(row=1, column=1, sticky="ns")
        hsb.grid(row=2, column=0, sticky="ew")
        body.rowconfigure(1, weight=1)
        body.columnconfigure(0, weight=1)
        self.header_canvas.bind("<Button-1>", self._on_header_click)
        self.body_canvas.bind("<MouseWheel>",
                              lambda e: self.body_canvas.yview_scroll(int(-e.delta / 120), "units"))

        self.legend = ttk.Frame(self)
        self.legend.pack(fill="x", pady=(6, 0))

    def _selector(self, parent, label, var, callback) -> ttk.Combobox:
        ttk.Label(parent, text=label).pack(side="left", padx=(0, 4))
        cb = ttk.Combobox(parent, textvariable=var, state="readonly", width=18)
        cb.pack(side="left", padx=(0, 12))
        cb.bind("<<ComboboxSelected>>", callback)
        return cb

    def _xview_both(self, *args) -> None:
        self.header_canvas.xview(*args)
        self.body_canvas.xview(*args)

    # ---------- data queries ----------
    def _query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        db = self.config.db_path
        if not db.exists():
            return []
        conn = connect(db)
        try:
            return conn.execute(sql, params).fetchall()
        except sqlite3.OperationalError:
            return []
        finally:
            conn.close()

    def _seasons(self) -> list[str]:
        return [r[0] for r in self._query(
            "SELECT DISTINCT r.season FROM rosters r "
            "JOIN clubs c ON c.fc_club_id = r.fc_club_id ORDER BY r.season")]

    def _leagues(self, season: str) -> list[str]:
        return [r[0] for r in self._query(
            "SELECT DISTINCT c.league FROM rosters r JOIN clubs c ON c.fc_club_id = r.fc_club_id "
            "WHERE r.season = ? AND c.league IS NOT NULL ORDER BY c.league", (season,))]

    def _teams(self, season: str, league: str) -> list[str]:
        return [r[0] for r in self._query(
            "SELECT DISTINCT c.canonical_name FROM rosters r JOIN clubs c ON c.fc_club_id = r.fc_club_id "
            "WHERE r.season = ? AND c.league = ? ORDER BY c.canonical_name", (season, league))]

    # ---------- cascading selectors (sort/mode persist across changes) ----------
    def reload(self) -> None:
        seasons = self._seasons()
        self.season_cb["values"] = seasons
        if not seasons:
            for cb in (self.season_cb, self.league_cb, self.team_cb):
                cb.set("")
                cb.state(["disabled"])
            self._clear()
            self._draw_legend()
            self.info_var.set("No team data - run Rebuild first (2024-25 has no clubs).")
            return
        for cb in (self.season_cb, self.league_cb, self.team_cb):
            cb.state(["readonly"])
        if self.season_var.get() not in seasons:
            self.season_var.set(seasons[0])
        self._on_season_change()

    def _on_season_change(self, _event=None) -> None:
        leagues = self._leagues(self.season_var.get())
        self._league_map = {LEAGUE_DISPLAY.get(lg, lg): lg for lg in leagues}
        display = list(self._league_map.keys())
        self.league_cb["values"] = display
        if self.league_var.get() not in display:
            self.league_var.set(display[0] if display else "")
        self._on_league_change()

    def _on_league_change(self, _event=None) -> None:
        raw_league = self._league_map.get(self.league_var.get(), "")
        teams = self._teams(self.season_var.get(), raw_league)
        self.team_cb["values"] = teams
        if self.team_var.get() not in teams:
            self.team_var.set(teams[0] if teams else "")
        self._on_team_change()

    def _on_team_change(self, _event=None) -> None:
        self._render()

    def _toggle_mode(self) -> None:
        self._render()

    # ---------- rendering ----------
    def _clear(self) -> None:
        self.header_canvas.delete("all")
        self.body_canvas.delete("all")

    def _render(self) -> None:
        self._draw_legend()
        raw_league = self._league_map.get(self.league_var.get(), "")
        season, team = self.season_var.get(), self.team_var.get()
        if not (season and raw_league and team):
            self._clear()
            self.info_var.set("")
            return
        if self.mode_var.get():
            self._rating_rows = self._query(_RATINGS_QUERY,
                                           (season, raw_league, team, season, season))
            self._rating_players = self._query(_TEAM_PLAYERS_QUERY, (season, raw_league, team))
            self._matchday_map = self._query(_MATCHDAY_MAP_QUERY, (season, raw_league))
            self._synth_rows = self._query(_SYNTH_QUERY, (season, raw_league, team))
            self._calendar = [row["md"] for row in self._query(
                _CALENDAR_QUERY, (season, season, raw_league, season, raw_league, season, raw_league))]
            self._draw_ratings()
        else:
            self._rows = list(self._query(_PLAYER_QUERY, (season, raw_league, team)))
            self._draw_stats()

    # ---------- stats table (canvas) ----------
    def _sort_rows(self) -> None:
        col = self._sort_col
        desc = self._sort_desc.get(col, False)
        if col in ("role_classic", "roles"):
            def keyf(r):
                return role_sort_key(r["role_classic"], r["roles"], r["fm"])
        else:
            def keyf(r):
                v = r[col]
                try:
                    return (0, float(v))
                except (TypeError, ValueError):
                    return (1, str(v).lower() if v is not None else "")
        self._rows.sort(key=keyf, reverse=desc)

    def _draw_stats(self) -> None:
        self._sort_rows()
        hc, bc = self.header_canvas, self.body_canvas
        hc.delete("all")
        bc.delete("all")

        layout, x = [], 0
        for col_id, header, kind, w in PLAYER_COLUMNS:
            layout.append((col_id, header, kind, x, w))
            x += w
        total_w = x
        self._col_layout = layout

        for col_id, header, kind, cx, w in layout:
            hc.create_rectangle(cx, 0, cx + w, HEADER_H, fill="#e9e9e9", outline="#cfcfcf")
            text = header
            if col_id == self._sort_col:
                text += " ▼" if self._sort_desc.get(col_id) else " ▲"
            if kind == "num":
                hc.create_text(cx + w - 6, HEADER_H // 2, anchor="e", text=text, font=("Segoe UI", 8, "bold"))
            else:
                hc.create_text(cx + 6, HEADER_H // 2, anchor="w", text=text, font=("Segoe UI", 8, "bold"))
        hc.configure(scrollregion=(0, 0, total_w, HEADER_H))

        for i, row in enumerate(self._rows):
            y = i * ROW_H
            if i % 2:
                bc.create_rectangle(0, y, total_w, y + ROW_H, fill="#f6f6f6", outline="")
            for col_id, header, kind, cx, w in layout:
                if kind == "pill":
                    self._draw_role_pills(bc, row[col_id], cx, y, w)
                elif kind == "num":
                    bc.create_text(cx + w - 6, y + ROW_H // 2, anchor="e",
                                   text=_fmt_num(row[col_id]), font=("Segoe UI", 8))
                else:
                    v = row[col_id]
                    bc.create_text(cx + 6, y + ROW_H // 2, anchor="w",
                                   text="" if v is None else str(v), font=("Segoe UI", 8))
        bc.configure(scrollregion=(0, 0, total_w, max(len(self._rows) * ROW_H, 1)))
        self.info_var.set(f"{len(self._rows)} players")

    def _draw_role_pills(self, canvas: tk.Canvas, value, x: int, y: int, cell_w: int) -> None:
        roles = _split_roles(value)
        px = x + 5
        for role in roles:
            bg, fg = role_pill_color(role)
            label = role.upper() if len(role) == 1 else role.capitalize()
            pw = 10 + len(label) * 7
            if px + pw > x + cell_w:
                break
            _round_rect(canvas, px, y + 4, px + pw, y + ROW_H - 4, 9, fill=bg, outline=bg)
            canvas.create_text(px + pw // 2, y + ROW_H // 2, text=label, fill=fg,
                               font=("Segoe UI", 8, "bold"))
            px += pw + 3

    def _redraw(self) -> None:
        """Redraw the current mode from already-loaded data (used after a header-click sort)."""
        if self.mode_var.get():
            self._draw_ratings()
        else:
            self._draw_stats()

    def _on_header_click(self, event) -> None:
        x = self.header_canvas.canvasx(event.x)
        for col_id, header, kind, cx, w in self._col_layout:
            if cx <= x < cx + w:
                if self._sort_col == col_id:
                    self._sort_desc[col_id] = not self._sort_desc.get(col_id, False)
                else:
                    self._sort_col = col_id
                    self._sort_desc.setdefault(col_id, False)
                self._redraw()   # re-sort only, no re-query (works in both modes)
                return

    # ---------- fantavoti grid (canvas) ----------
    def _sort_players_list(self, players: list) -> list:
        # In votes mode only the left columns (name / role) are sortable; anything else -> by role.
        col = self._sort_col if self._sort_col in ("name", "role_classic", "roles") else "role_classic"
        desc = self._sort_desc.get(col, False)
        if col in ("role_classic", "roles"):
            def keyf(r):
                return role_sort_key(r["role_classic"], r["roles"], None)
        else:
            def keyf(r):
                return str(r["name"] or "").lower()
        return sorted(players, key=keyf, reverse=desc)

    def _draw_ratings(self) -> None:
        hc, bc = self.header_canvas, self.body_canvas
        hc.delete("all")
        bc.delete("all")

        players = self._sort_players_list(self._rating_players)
        # The query already speaks REAL matchdays (see _RATINGS_QUERY), so do the synthetic rows.
        data = {(r["fc_id"], r["matchday"]): (r["fantavoto"], r["status"])
                for r in self._rating_rows}
        synth = {(row["fc_id"], row["real_md"]): (row["mv_synth"], row["minutes"])
                 for row in self._synth_rows}
        # Which real matchdays the euro calendar actually covers. Empty map (nothing scraped yet)
        # -> treat every column as a euro round, i.e. behave as before.
        euro_rounds = {row["real_md"] for row in self._matchday_map}
        days = sorted(set(self._calendar) | {md for _fc_id, md in data}
                      | {md for _fc_id, md in synth})
        if not euro_rounds:
            euro_rounds = set(days)

        # left fixed columns (name + role pills) - stay visible and sortable in votes mode too
        left, x = [], 0
        for col_id, header, kind, w in VOTES_LEFT_COLUMNS:
            left.append((col_id, header, kind, x, w))
            x += w
        left_w = x
        self._col_layout = left   # only the left columns are clickable/sortable here

        total_w = left_w + len(days) * CELL_W
        for col_id, header, kind, cx, w in left:
            hc.create_rectangle(cx, 0, cx + w, HEADER_H, fill="#e9e9e9", outline="#cfcfcf")
            text = header
            if col_id == self._sort_col:
                text += " ▼" if self._sort_desc.get(col_id) else " ▲"
            hc.create_text(cx + 6, HEADER_H // 2, anchor="w", text=text, font=("Segoe UI", 8, "bold"))
        for j, md in enumerate(days):
            cx = left_w + j * CELL_W
            in_euro = md in euro_rounds
            hc.create_rectangle(cx, 0, cx + CELL_W, HEADER_H,
                                fill="#e9e9e9" if in_euro else SYNTHETIC_HEADER, outline="#cfcfcf")
            hc.create_text(cx + CELL_W // 2, HEADER_H // 2, text=str(md),
                           font=("Segoe UI", 8, "bold"),
                           fill="#111111" if in_euro else SYNTHETIC_STYLE[1])
        hc.configure(scrollregion=(0, 0, total_w, HEADER_H))

        for i, pl in enumerate(players):
            y = i * ROW_H
            if i % 2:
                bc.create_rectangle(0, y, total_w, y + ROW_H, fill="#f6f6f6", outline="")
            for col_id, header, kind, cx, w in left:
                if kind == "pill":
                    self._draw_role_pills(bc, pl[col_id], cx, y, w)
                else:
                    bc.create_text(cx + 6, y + ROW_H // 2, anchor="w",
                                   text=str(pl[col_id] or ""), font=("Segoe UI", 8))
            for j, md in enumerate(days):
                cx = left_w + j * CELL_W
                cell = data.get((pl["fc_id"], md))
                if cell is not None:
                    fv, status = cell
                    bg, fg = rating_cell_style(status)
                    txt = rating_cell_text(fv, status)
                    font = ("Segoe UI", 8)
                else:
                    mv_synth, minutes = synth.get((pl["fc_id"], md), (None, None))
                    bg, fg = (SYNTHETIC_STYLE if mv_synth is not None else ("#f4f4f4", "#bbbbbb"))
                    shown = half_step(mv_synth) if (minutes or 0) > 0 else None
                    txt = f"{shown:g}" if shown is not None else ""
                    font = ("Segoe UI", 8, "italic")
                bc.create_rectangle(cx, y, cx + CELL_W, y + ROW_H, fill=bg, outline="#e6e6e6")
                if txt:
                    bc.create_text(cx + CELL_W // 2, y + ROW_H // 2, text=txt, fill=fg, font=font)
        bc.configure(scrollregion=(0, 0, total_w, max(len(players) * ROW_H, 1)))
        if not days:
            self.info_var.set(f"{len(players)} players · 0 matchdays (run ratings to fill)")
            return
        euro_count = sum(1 for md in days if md in euro_rounds)
        scale = "real" if self._matchday_map else "euro"
        self.info_var.set(f"{len(players)} players · {len(days)} {scale} matchdays "
                          f"({euro_count} in the euro calendar, "
                          f"{len(days) - euro_count} outside it)")

    # ---------- legend ----------
    def _draw_legend(self) -> None:
        for w in self.legend.winfo_children():
            w.destroy()
        if self.mode_var.get():
            ttk.Label(self.legend, text="Status:").pack(side="left")
            for st in ("played", "sub", "no_vote", "bench", "injured", "suspended", "not_in_squad"):
                bg, _fg = rating_cell_style(st)
                tk.Label(self.legend, text="  ", background=bg, relief="solid",
                         borderwidth=1).pack(side="left", padx=(8, 3))
                ttk.Label(self.legend, text=RATING_STATUS_LABEL[st]).pack(side="left")
            tk.Label(self.legend, text="  ", background=SYNTHETIC_STYLE[0], relief="solid",
                     borderwidth=1).pack(side="left", padx=(8, 3))
            ttk.Label(self.legend, text="synthetic voto, to the nearest 0.5 "
                                        "(real matchday outside the euro calendar)").pack(side="left")
        else:
            ttk.Label(self.legend, text="Roles:").pack(side="left")
            for role in ("P", "D", "C", "A"):
                bg, fg = role_pill_color(role)
                tk.Label(self.legend, text=f" {role} ", background=bg, foreground=fg).pack(side="left", padx=(8, 2))
            ttk.Label(self.legend, text="  (Mantra roles use the same palette)",
                      foreground="#777").pack(side="left")


# ============================ Main window ============================

# Meta-operations that already work (not pipeline modules, so not in IMPLEMENTED).
_READY_OPS: frozenset[str] = frozenset({"initdb", "rebuild"})


def make_app_icon() -> tk.PhotoImage:
    """Soccer-pitch window/taskbar icon drawn at runtime (stdlib only, no asset file).

    A green mowing-striped field with white markings (touchlines, halfway line,
    centre circle + spot, penalty boxes). Requires an existing Tk root.
    """
    import math

    size = 64
    img = tk.PhotoImage(width=size, height=size)
    grass = ("#2f7d32", "#37913a")          # two mowing-stripe greens
    line = "#f4f6f5"
    stripe = size // 8
    for i in range(0, size, stripe):
        img.put(grass[(i // stripe) % 2], to=(0, i, size, i + stripe))

    def frame(x0, y0, x1, y1, w=2):
        img.put(line, to=(x0, y0, x1, y0 + w))          # top
        img.put(line, to=(x0, y1 - w, x1, y1))          # bottom
        img.put(line, to=(x0, y0, x0 + w, y1))          # left
        img.put(line, to=(x1 - w, y0, x1, y1))          # right

    m, c = 5, size // 2
    frame(m, m, size - m, size - m)                     # touchlines
    img.put(line, to=(c - 1, m, c + 1, size - m))       # halfway line
    box = 22
    frame(m, c - box // 2, m + 11, c + box // 2)        # left penalty box
    frame(size - m - 11, c - box // 2, size - m, c + box // 2)  # right penalty box
    r = 10                                              # centre circle (ring of dots)
    for deg in range(0, 360, 8):
        x = round(c + r * math.cos(math.radians(deg)))
        y = round(c + r * math.sin(math.radians(deg)))
        img.put(line, to=(x, y, x + 2, y + 2))
    img.put(line, to=(c - 1, c - 1, c + 1, c + 1))      # centre spot
    return img


class AuctionView(ttk.Frame):
    """Per role, side by side: who the engine would have bought and who actually paid off.

    The two lists answer different questions and the panel shows both, because a single precision
    number ("6/10") hides whether the misses were players the engine could not price at all, players it
    priced in the third hundred, or noise between comparable names.
    """

    # Both games on both platforms. Mantra is played on the classic Serie A game as well, and its
    # listone carries the whole Mantra apparatus - the earlier "euro only" restriction was wrong and
    # was switching off a combination the data fully supports.
    GAMES: ClassVar[dict[str, tuple[str, ...]]] = {
        "euro": ("classic", "mantra"), "default": ("classic", "mantra")}

    # Shared by both tables. What differs between them - FM/Pv/VALUE are predicted on the left and
    # actual on the right - is in PREDICTED_HELP / ACTUAL_HELP below.
    COMMON_HELP: ClassVar[dict[str, str]] = {
        "#": "Position in this list.",
        "Player": "Name as it appears in the listone (fc_id is the primary key behind it).",
        "Team": "Club at the auction, abbreviated: MUN = Manchester United, S04 = Schalke 04. "
                "Empty when the club is unknown for that season.",
        "Qt.I": "Qt.I, the quotation set BEFORE the auction - the market's expectation, and the only "
                "price the engine is allowed to read. Qt.A is revised all season long, so for a season "
                "already played it embeds the outcome. Under Mantra this is Qt.I M.",
        "FVM": "Fantavalore di mercato from the listone, in its current state - so for a finished "
               "season it is the END-OF-SEASON market value. The market's own answer to the question "
               "the engine answers with VALUE. Reporting only: no rule may read it. Mantra: FVM M.",
    }
    PREDICTED_HELP: ClassVar[dict[str, str]] = {
        "FM": "Predicted fantamedia: role anchor + beta x (last season's fantamedia - anchor). "
              "Goalkeepers go through the decomposed M2e model instead, which never uses the anchor.",
        "Pv": "Predicted appearances over the season's matchdays. This side of the product carries "
              "3 to 11 times more of the VALUE error than the fantamedia does.",
        "VALUE": "Predicted VALUE = predicted fantamedia x predicted appearances. The list is sorted "
                 "by this, and it is what the engine would have paid for.",
        "real VALUE": "What he actually returned: real fantamedia x real appearances. Blank when he "
                      "never played.",
        "real #": "Where he actually finished among this role's players. A dash means he ended the "
                  "season with no real VALUE at all.",
    }
    ACTUAL_HELP: ClassVar[dict[str, str]] = {
        "FM": "Fantamedia actually achieved over the season.",
        "Pv": "Appearances actually made.",
        "VALUE": "VALUE actually achieved = fantamedia x appearances. This list is sorted by it.",
        "pred. VALUE": "What the engine predicted for him on auction day. Empty when it could not "
                       "price him at all - no previous season to regress from.",
        "pred. #": "His rank in the predicted list. 'not priced' means the engine had no prediction "
                   "for him, so no ranking could contain him: an unreachable slot, not a bad guess.",
    }

    # Kept beside the help dictionaries on purpose: a test asserts that the two cover exactly the same
    # columns, so a new column cannot ship without an explanation of what it means.
    PREDICTED_COLUMNS: ClassVar[tuple[str, ...]] = (
        "#", "Player", "Team", "Qt.I", "FM", "Pv", "VALUE", "real VALUE", "FVM", "real #")
    ACTUAL_COLUMNS: ClassVar[tuple[str, ...]] = (
        "#", "Player", "Team", "Qt.I", "FM", "Pv", "VALUE", "FVM", "pred. VALUE", "pred. #")

    ROLE_LABELS: ClassVar[dict[str, str]] = {
        "P": "Goalkeepers", "D": "Defenders", "C": "Midfielders", "A": "Forwards",
        "por": "por", "dc": "dc", "dd": "dd", "ds": "ds", "b": "b", "e": "e",
        "m": "m", "c": "c", "w": "w", "t": "t", "a": "a", "pc": "pc",
    }

    def __init__(self, parent: tk.Widget, config: Config) -> None:
        super().__init__(parent, padding=10)
        self.config = config
        self._cache: dict[tuple[str, str], dict] = {}     # (platform, game) -> {season: view}
        self._running = False
        self._build()

    # ---------- layout ----------
    def _build(self) -> None:
        top = ttk.Frame(self)
        top.pack(fill="x")
        self.platform_var = tk.StringVar(value="euro")
        self.game_var = tk.StringVar(value="classic")
        self.season_var = tk.StringVar()
        self.platform_cb = self._selector(top, "Platform", self.platform_var,
                                          ["euro", "default"], self._on_platform_change, width=10)
        self.game_cb = self._selector(top, "Game", self.game_var,
                                      list(self.GAMES["euro"]), self._on_config_change, width=10)
        self.season_cb = self._selector(top, "Season", self.season_var, [], self._on_season_change)
        # Indeterminate, because the work has no progress to report: the engine either has the window
        # fitted or it does not. It is packed and unpacked rather than left in place, so a still bar
        # never sits there looking like a stalled one.
        self.spinner = ttk.Progressbar(top, mode="indeterminate", length=90)
        self.status_var = tk.StringVar(value="")
        ttk.Label(top, textvariable=self.status_var, foreground="#555").pack(side="left", padx=8)

        hint = ("predicted VALUE = predicted fantamedia x predicted appearances, from the previous "
                "season only · FVM = the listone's end-of-season market value")
        ttk.Label(self, text=hint, foreground="#777").pack(fill="x", pady=(4, 0))

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True, pady=(6, 0))
        self.canvas = tk.Canvas(body, highlightthickness=0)
        scroll = ttk.Scrollbar(body, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=scroll.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self.inner = ttk.Frame(self.canvas)
        self._window_id = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>",
                        lambda _e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>",
                         lambda e: self.canvas.itemconfigure(self._window_id, width=e.width))
        self.canvas.bind_all("<MouseWheel>", self._on_wheel)

    def _on_wheel(self, event) -> None:
        # bind_all is global, so only scroll when this tab is the visible one
        if self.winfo_ismapped():
            self.canvas.yview_scroll(int(-event.delta / 120), "units")

    def _selector(self, parent, label, var, values, callback, width: int = 14) -> ttk.Combobox:
        ttk.Label(parent, text=label).pack(side="left", padx=(0, 4))
        cb = ttk.Combobox(parent, textvariable=var, state="readonly", width=width, values=values)
        cb.pack(side="left", padx=(0, 12))
        cb.bind("<<ComboboxSelected>>", callback)
        return cb

    # ---------- data ----------
    def reload(self) -> None:
        """Called on startup and after an operation: recompute for the current selection."""
        self._cache.clear()
        self._on_config_change()

    def _on_platform_change(self, _event=None) -> None:
        games = self.GAMES.get(self.platform_var.get(), ("classic",))
        self.game_cb.configure(values=list(games))
        if self.game_var.get() not in games:
            self.game_var.set(games[0])
        self._on_config_change()

    def _on_config_change(self, _event=None) -> None:
        key = (self.platform_var.get(), self.game_var.get())
        if key in self._cache:
            self._refresh_seasons(self._cache[key])
            return
        if self._running:
            return
        if not self.config.db_path.exists():
            self.status_var.set("no database yet - run initdb")
            return
        self._running = True
        self.status_var.set("valuing the listone (the engine fits every window)...")
        self._busy(True)
        self._clear()
        threading.Thread(target=self._compute, args=key, daemon=True).start()

    def _compute(self, platform: str, game: str) -> None:
        """Worker: run the engine for every usable window of this platform+game."""
        try:
            views = self._auction_views(platform, game)
            error = None
        except Exception as exc:                    # noqa: BLE001 - the panel reports, never crashes
            views, error = {}, f"{type(exc).__name__}: {exc}"
        self.after(0, lambda: self._done(platform, game, views, error))

    def _auction_views(self, platform: str, game: str) -> dict[str, dict]:
        """{target season: per-role view}. Imported here so the GUI starts without the engine."""
        from euroleghe_ingest.engine import evaluate, features

        conn = connect(self.config.db_path)
        try:
            usable, fits = {}, {}
            for key, window in features.WINDOWS.items():
                data = features.prepare(conn, window, platform, game)
                if evaluate._window_is_usable(data, platform):
                    usable[key] = data
                    fits[key] = evaluate.fit_params(data, ("R0", *evaluate.CANDIDATES))
            adopted = ("R0", *evaluate.ADOPTED.get(platform, ()))
            out: dict[str, dict] = {}
            for key, data in usable.items():
                # the same parameters the gate scores this window with: the adjacent window's fit, with
                # the pooled rules averaged over every window except this one
                source = features.cross_fit_source(key, tuple(usable))
                params = evaluate.pool_params(fits, key, fits[source])
                out[data.window.target_season] = {
                    "window": key, "params_from": params.source,
                    "rules": ", ".join(adopted[1:]) or "baseline only",
                    "by_role": evaluate.auction_view(
                        data, evaluate.predict_window(data, adopted, None, params)),
                }
            return out
        finally:
            conn.close()

    def _busy(self, running: bool) -> None:
        """Show/hide the spinner. Also called on the error path, or a failure would spin forever."""
        if running:
            self.spinner.pack(side="left", padx=(4, 0))
            self.spinner.start(12)
        else:
            self.spinner.stop()
            self.spinner.pack_forget()

    def _done(self, platform: str, game: str, views: dict, error: str | None) -> None:
        self._running = False
        self._busy(False)
        if error:
            self.status_var.set(error)
            return
        self._cache[(platform, game)] = views
        if (platform, game) == (self.platform_var.get(), self.game_var.get()):
            self._refresh_seasons(views)

    def _refresh_seasons(self, views: dict) -> None:
        seasons = sorted(views, reverse=True)
        self.season_cb.configure(values=seasons)
        if not seasons:
            self.status_var.set("no window has votes on both sides for this platform")
            self._clear()
            return
        if self.season_var.get() not in seasons:
            self.season_var.set(seasons[0])
        self._render(views[self.season_var.get()])

    def _on_season_change(self, _event=None) -> None:
        views = self._cache.get((self.platform_var.get(), self.game_var.get()))
        if views and self.season_var.get() in views:
            self._render(views[self.season_var.get()])

    # ---------- rendering ----------
    def _clear(self) -> None:
        for child in self.inner.winfo_children():
            child.destroy()

    def _render(self, view: dict) -> None:
        self._clear()
        total_hits = sum(block["hits"] for block in view["by_role"].values())
        captured = sum(block["captured_value"] or 0 for block in view["by_role"].values())
        perfect = sum(block["perfect_value"] or 0 for block in view["by_role"].values())
        roles = len(view["by_role"])
        share = f"{captured / perfect * 100:.0f}%" if perfect else "n/a"
        self.status_var.set(
            f"window {view['window']} · rules {view['rules']} · parameters from "
            f"{view['params_from']} · {total_hits}/{roles * 10} names · {share} of the perfect "
            f"top-10 VALUE")
        for role, block in view["by_role"].items():
            self._render_role(role, block)

    @staticmethod
    def _num(value, digits: int = 0) -> str:
        """One place for the column formats: %g would print 32.199999 next to 5.1 and 210.9."""
        return "" if value is None else f"{float(value):.{digits}f}"

    def _render_role(self, role: str, block: dict) -> None:
        label = self.ROLE_LABELS.get(role, role)
        misses = block["misses"]
        head = (f"{label} — {block['hits']}/10 in common · VALUE captured "
                f"{(block['captured_value'] or 0):.0f} of {(block['perfect_value'] or 0):.0f} · "
                f"misses: {misses['near']} near, {misses['regime']} beyond rank 50, "
                f"{misses['unpriced']} never priced")
        box = ttk.LabelFrame(self.inner, text=head, padding=6)
        box.pack(fill="x", expand=True, pady=(0, 10))
        left = ttk.Frame(box)
        right = ttk.Frame(box)
        left.pack(side="left", fill="both", expand=True, padx=(0, 6))
        right.pack(side="left", fill="both", expand=True)
        self._table(left, "Predicted at the auction", self.PREDICTED_COLUMNS,
                    [(row["rank"], row["name"], club_abbreviation(row["club"]),
                      self._num(row["price_initial"]),
                      self._num(row["fm_pred"], 2), self._num(row["pv_pred"], 1),
                      self._num(row["value_pred"]), self._num(row["value_act"]),
                      self._num(row["fvm"]), row["actual_rank"] or "-")
                     for row in block["predicted"]],
                    {**self.COMMON_HELP, **self.PREDICTED_HELP})
        self._table(right, "Actual, end of season", self.ACTUAL_COLUMNS,
                    [(row["rank"], row["name"], club_abbreviation(row["club"]),
                      self._num(row["price_initial"]),
                      self._num(row["fm_act"], 2), self._num(row["pv_act"]),
                      self._num(row["value_act"]), self._num(row["fvm"]),
                      self._num(row["value_pred"]),
                      row["predicted_rank"] or "not priced")
                     for row in block["actual"]],
                    {**self.COMMON_HELP, **self.ACTUAL_HELP})

    def _table(self, parent: tk.Widget, title: str, columns: tuple[str, ...],
               rows: list[tuple], help_by_column: dict[str, str]) -> None:
        """`help_by_column` is REQUIRED, not defaulted: it went missing from one of the two tables when
        it was optional, and a missing tooltip is invisible until someone hovers. Now forgetting it is a
        TypeError at the call site."""
        ttk.Label(parent, text=title, font=("Segoe UI", 9, "bold")).pack(anchor="w")
        tree = ttk.Treeview(parent, columns=columns, show="headings", height=max(1, len(rows)))
        for column in columns:
            tree.heading(column, text=column)
            width = (130 if column == "Player" else 46 if column == "#"
                     else 52 if column == "Team" else 68)
            tree.column(column, width=width,
                        anchor="w" if column in ("Player", "Team") else "e",
                        stretch=column == "Player")
        for row in rows:
            tree.insert("", "end", values=row)
        HeadingTooltip(tree, help_by_column)
        tree.pack(fill="x")


class ToolkitGUI:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.config = Config()
        self.log_queue: queue.Queue = queue.Queue()
        self.busy = False
        self._cancel_event = threading.Event()

        root.title(f"euroleghe-ingest - operator panel v{__version__}")
        root.geometry("1000x700")
        root.minsize(820, 640)   # the three operation groups + legend need this much height
        try:
            self._app_icon = make_app_icon()           # keep a reference (Tk needs it alive)
            root.iconphoto(True, self._app_icon)
        except tk.TclError:
            pass  # the icon is cosmetic; never block startup over it

        notebook = ttk.Notebook(root)
        notebook.pack(fill="both", expand=True)

        ops_tab = ttk.Frame(notebook)
        notebook.add(ops_tab, text="Operations")
        self._build_operations_tab(ops_tab)

        self.players = PlayersView(notebook, self.config)
        notebook.add(self.players, text="Players")

        self.auction = AuctionView(notebook, self.config)
        notebook.add(self.auction, text="Auction")

        self.refresh_status()
        self.refresh_operation_states()
        self.players.reload()
        self.auction.reload()
        self.root.after(100, self._drain_log)

    # ---------- operations tab layout ----------
    def _build_operations_tab(self, parent: tk.Widget) -> None:
        main = ttk.Frame(parent, padding=10)
        main.pack(fill="both", expand=True)

        left = ttk.Frame(main)
        left.pack(side="left", fill="y")
        self.buttons: list[ttk.Button] = []
        self.dots: list[tk.Label] = []
        self.op_commands: list[str] = []
        for group, commands in OPERATION_GROUPS:
            box = ttk.LabelFrame(left, text=group, padding=6)
            box.pack(fill="x", pady=(0, 6))
            for command in commands:
                row = ttk.Frame(box)
                row.pack(fill="x", pady=1)
                dot = tk.Label(row, text="○", width=2, font=("Segoe UI", 11))
                dot.pack(side="left")
                btn = ttk.Button(row, text=operation_label(command), width=25,
                                 command=lambda c=command: self.run_operation(c))
                btn.pack(side="left", fill="x", expand=True)
                Tooltip(btn, lambda c=command: self._tooltip_for(c))
                self.buttons.append(btn)
                self.dots.append(dot)
                self.op_commands.append(command)

        legend = ttk.Frame(left)
        legend.pack(anchor="w")
        for state in ("completed", "todo", "unavailable"):
            sym, color = STATE_STYLE[state]
            tk.Label(legend, text=sym, foreground=color, font=("Segoe UI", 10)).pack(side="left")
            tk.Label(legend, text=f" {state}   ", foreground="#555").pack(side="left")

        right = ttk.Frame(main)
        right.pack(side="left", fill="both", expand=True, padx=(10, 0))

        status = ttk.LabelFrame(right, text="Status", padding=8)
        status.pack(fill="x")
        self.status_var = tk.StringVar(value="...")
        ttk.Label(status, textvariable=self.status_var, justify="left").pack(anchor="w")
        buttons = ttk.Frame(status)
        buttons.pack(anchor="e", pady=(6, 0))
        self.stop_button = ttk.Button(buttons, text="Stop", command=self._request_stop, state="disabled")
        self.stop_button.pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Refresh", command=self._refresh_all).pack(side="left")

        log_frame = ttk.LabelFrame(right, text="Log", padding=8)
        log_frame.pack(fill="both", expand=True, pady=(10, 0))
        self.log = scrolledtext.ScrolledText(log_frame, height=16, state="disabled", wrap="word")
        self.log.pack(fill="both", expand=True)

        self.progress = ttk.Progressbar(right, mode="indeterminate")
        self.progress.pack(fill="x", pady=(8, 0))

    # ---------- operation state ----------
    def _db_counts(self) -> dict[str, int] | None:
        db = self.config.db_path
        if not db.exists():
            return None
        conn = connect(db)
        try:
            counts: dict[str, int] = {}
            tables = set(table_names(conn))
            for name in tables:
                (counts[name],) = conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()
            # modules whose output is a column: COUNT(col) ignores NULLs, so it tells whether the
            # step actually ran (mv_synth is empty until `synth` fits the calibration).
            for key, table, column in COLUMN_COUNTERS:
                if table in tables:
                    (counts[key],) = conn.execute(f'SELECT COUNT("{column}") FROM {table}').fetchone()
            return counts
        except Exception:  # noqa: BLE001 - a broken DB just means "no counts"
            return None
        finally:
            conn.close()

    def _current_status(self, command: str) -> str:
        return operation_state(command, self._db_counts(), bool(available_sources(self.config)))

    def refresh_operation_states(self) -> None:
        if self.busy:
            return
        counts = self._db_counts()
        has_sources = bool(available_sources(self.config))
        for command, dot, btn in zip(self.op_commands, self.dots, self.buttons):
            state = operation_state(command, counts, has_sources)
            sym, color = STATE_STYLE[state]
            dot.configure(text=sym, foreground=color)
            btn.configure(state="disabled" if state == "unavailable" else "normal")

    def _tooltip_for(self, command: str) -> str:
        desc = TOOLTIPS.get(command, command)
        return f"{desc}\n\n— {STATE_LABEL[self._current_status(command)]}"

    # ---------- DB status panel ----------
    def refresh_status(self) -> None:
        db = self.config.db_path
        if not db.exists():
            self.status_var.set(f"DB: {db}\n(not created yet - use 'Initialize DB' or 'Rebuild all')")
            return
        counts = self._db_counts() or {}
        tables = {name: n for name, n in counts.items() if "." not in name}   # drop column counters
        populated = [f"{name}={n}" for name, n in sorted(tables.items()) if n]
        rows = ", ".join(populated) if populated else "all empty"
        self.status_var.set(f"DB: {db}\nTables: {len(tables)} · rows: {rows}")

    def _refresh_all(self) -> None:
        self.refresh_status()
        self.refresh_operation_states()
        self.players.reload()

    # ---------- execution ----------
    def _request_stop(self) -> None:
        self._cancel_event.set()
        self._append("\n[stop requested - finishing the current step; saved data is kept]\n")

    def _ratings_dialog(self) -> dict | None:
        """Ask which platform + season to import. Returns run() kwargs, or None if cancelled."""
        dlg = tk.Toplevel(self.root)
        dlg.title("Scrape ratings")
        dlg.transient(self.root)
        dlg.grab_set()
        dlg.resizable(False, False)
        frm = ttk.Frame(dlg, padding=12)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="Competition:").grid(row=0, column=0, sticky="w", pady=4)
        comp = tk.StringVar(value="euro")
        ttk.Combobox(frm, textvariable=comp, state="readonly", width=18,
                     values=["euro", "default"]).grid(row=0, column=1, pady=4)
        ttk.Label(frm, text="Season:").grid(row=1, column=0, sticky="w", pady=4)
        season = tk.StringVar(value="all")
        # EuroLeghe voti go back to ~2021-22, Serie A classic to ~2015-16 (the module resolves the
        # championship id per season, so any listed season works if the site has it).
        seasons = ["all"] + [f"{y}-{(y + 1) % 100:02d}" for y in range(2025, 2014, -1)]
        ttk.Combobox(frm, textvariable=season, state="readonly", width=18,
                     values=seasons).grid(row=1, column=1, pady=4)
        refresh = tk.BooleanVar(value=False)
        ttk.Checkbutton(frm, text="Refresh (re-download existing matchdays)",
                        variable=refresh).grid(row=2, column=0, columnspan=2, sticky="w", pady=4)

        out: dict = {}

        def confirm():
            out["platform"] = comp.get()
            out["seasons"] = None if season.get() == "all" else [season.get()]
            out["refresh"] = refresh.get()
            dlg.destroy()

        btns = ttk.Frame(frm)
        btns.grid(row=3, column=0, columnspan=2, pady=(10, 0))
        ttk.Button(btns, text="Run", command=confirm).pack(side="left", padx=4)
        ttk.Button(btns, text="Cancel", command=dlg.destroy).pack(side="left", padx=4)
        dlg.wait_window()
        return out or None

    def _positions_dialog(self) -> dict | None:
        """Ask which league/season and WHICH LAYER to import. Returns run() kwargs, or None.

        The two layers cost wildly different amounts of network, so the choice has to be explicit:
        'season' is ~6 requests per league-season, 'match' walks every round of every perimeter club
        (hours) and is what produces the synthetic matchdays.
        """
        from euroleghe_ingest.modules.positions import SEASONS, TOURNAMENTS

        dlg = tk.Toplevel(self.root)
        dlg.title("Import SofaScore")
        dlg.transient(self.root)
        dlg.grab_set()
        dlg.resizable(False, False)
        frm = ttk.Frame(dlg, padding=12)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="Layer:").grid(row=0, column=0, sticky="w", pady=4)
        layer = tk.StringVar(value="season")
        ttk.Combobox(frm, textvariable=layer, state="readonly", width=24,
                     values=["season", "match", "all"]).grid(row=0, column=1, pady=4)
        ttk.Label(frm, text="League:").grid(row=1, column=0, sticky="w", pady=4)
        league = tk.StringVar(value="all")
        ttk.Combobox(frm, textvariable=league, state="readonly", width=24,
                     values=["all", *TOURNAMENTS]).grid(row=1, column=1, pady=4)
        ttk.Label(frm, text="Season:").grid(row=2, column=0, sticky="w", pady=4)
        season = tk.StringVar(value="all")
        ttk.Combobox(frm, textvariable=season, state="readonly", width=24,
                     values=["all", *SEASONS]).grid(row=2, column=1, pady=4)
        refresh = tk.BooleanVar(value=False)
        ttk.Checkbutton(frm, text="Refresh (re-download what is already cached)",
                        variable=refresh).grid(row=3, column=0, columnspan=2, sticky="w", pady=4)

        hint = tk.StringVar()
        ttk.Label(frm, textvariable=hint, foreground="#555", wraplength=330,
                  justify="left").grid(row=4, column=0, columnspan=2, sticky="w", pady=(6, 0))

        def describe(*_args) -> None:
            hint.set({
                "season": "Season facts (goals, assists, minutes, xG/xA) -> external_stats. "
                          "Fast: about 6 requests per league-season.",
                "match": "Per-match ratings of the perimeter clubs -> external_match_stats. This is "
                         "what fills the SYNTHETIC matchdays. Hours for everything; resumable, and "
                         "'Stop' keeps whatever landed. Run 'matchdays' and 'synth' afterwards.",
                "all": "Both layers, one after the other.",
            }[layer.get()])

        layer.trace_add("write", describe)
        describe()

        out: dict = {}

        def confirm():
            out["layer"] = layer.get()
            out["leagues"] = None if league.get() == "all" else [league.get()]
            out["seasons"] = None if season.get() == "all" else [season.get()]
            out["refresh"] = refresh.get()
            dlg.destroy()

        btns = ttk.Frame(frm)
        btns.grid(row=5, column=0, columnspan=2, pady=(10, 0))
        ttk.Button(btns, text="Run", command=confirm).pack(side="left", padx=4)
        ttk.Button(btns, text="Cancel", command=dlg.destroy).pack(side="left", padx=4)
        dlg.wait_window()
        return out or None

    # Operations that ask for options before running: command -> dialog method name.
    DIALOGS: ClassVar[dict[str, str]] = {"ratings": "_ratings_dialog",
                                         "positions": "_positions_dialog"}

    @staticmethod
    def _follow_ups(command: str, params: dict) -> tuple[str, ...]:
        """Offline steps to run right after an operation, because its output feeds them.

        Downloading the per-match layer is pointless on its own: the synthetic base voto only shows
        up once the calendar map and the calibration are recomputed (exactly what `rebuild` does, in
        this order). Chaining them here spares the operator three clicks in a mandatory order - and
        the log names every step, so nothing runs invisibly.
        """
        if command == "positions" and params.get("layer") in ("match", "all"):
            return ("matchdays", "synth")
        if command == "ratings":
            return ("matchdays",)   # new matchdays to line up with the real calendar
        return ()

    def run_operation(self, command: str) -> None:
        if self.busy:
            return
        params: dict = {}
        if command in self.DIALOGS:
            params = getattr(self, self.DIALOGS[command])()
            if params is None:
                return   # user cancelled the dialog
        self._cancel_event.clear()
        self._set_busy(True)
        self._append(f"\n> {command}\n")
        threading.Thread(target=self._worker, args=(command, params), daemon=True).start()

    def _worker(self, command: str, params: dict | None = None) -> None:
        old_out, old_err = sys.stdout, sys.stderr
        sys.stdout = sys.stderr = _QueueWriter(self.log_queue)
        try:
            ctx = Context(config=self.config, cancel_event=self._cancel_event)
            if command == "initdb":
                init_db(self.config.db_path)
                print(f"DB initialized: {self.config.db_path}")
            elif command == "rebuild":
                load("rebuild").run(ctx)
            elif command == "fetch:plan":
                load("fetch").run(ctx, plan=True)
            else:
                ctx.conn = init_db(self.config.db_path)
                load(command).run(ctx, **(params or {}))
                ctx.conn.commit()
                for follow_up in self._follow_ups(command, params or {}):
                    print(f"\n> {follow_up} (follow-up: {command} changed what it depends on)")
                    load(follow_up).run(ctx)
                    ctx.conn.commit()
            print(f"OK {command}: done")
        except NotImplementedError as exc:
            print(f".. {command}: to implement - {exc}")
        except Exception as exc:  # noqa: BLE001
            print(f"XX {command}: error - {exc}")
        finally:
            sys.stdout, sys.stderr = old_out, old_err
            self.log_queue.put("__DONE__")

    # ---------- log pump ----------
    def _drain_log(self) -> None:
        try:
            while True:
                item = self.log_queue.get_nowait()
                if item == "__DONE__":
                    self._set_busy(False)
                    self._refresh_all()
                else:
                    self._append(item)
        except queue.Empty:
            pass
        self.root.after(100, self._drain_log)

    def _append(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text)
        self.log.see("end")
        self.log.configure(state="disabled")

    def _set_busy(self, busy: bool) -> None:
        self.busy = busy
        if busy:
            for btn in self.buttons:
                btn.configure(state="disabled")
            self.stop_button.configure(state="normal")
            self.progress.start(12)
        else:
            self.progress.stop()
            self.stop_button.configure(state="disabled")
            self.refresh_operation_states()


def main() -> int:
    root = tk.Tk()
    ToolkitGUI(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
