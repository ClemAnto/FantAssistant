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

import contextlib
import datetime as dt
import json
import queue
import sqlite3
import sys
import threading
import tkinter as tk
from tkinter import scrolledtext, ttk
from typing import ClassVar

from euroleghe_ingest import __version__
from euroleghe_ingest import ui_theme as theme
from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import connect, init_db, record_run, table_names
from euroleghe_ingest.matching import club_abbreviation
from euroleghe_ingest.modules import IMPLEMENTED, load
from euroleghe_ingest.modules.positions import (
    REAL_ROLE_DEPTH,
    REAL_ROLE_LABEL,
    REAL_ROLE_SIDE,
    REAL_ROLES,
)
from euroleghe_ingest.modules.snapshot import INJURY_WEIGHTS, competition_class
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
    ("Setup - once", ("initdb", "bootstrap", "rebuild", "fetch:plan")),
    ("Start of season", ("rosters", "stats", "elo", "transfers", "injuries", "tournaments",
      "arrivals", "recent_form", "fbref")),
    ("During the season - every matchday",
     ("ratings", "matchdays", "positions", "synth", "fc_site", "validate")),
    ("Before an auction", ("snapshot", "export")),
)

# Labels for the operations that are not pipeline modules (those just use their own name).
OPERATION_LABELS: dict[str, str] = {
    "initdb": "Initialize DB",
    "rebuild": "Rebuild all",
    "bootstrap": "Bootstrap (from zero)",
    "fetch:plan": "What is missing?",
    "export": "Export app bundle",
    "snapshot": "Auction snapshot (today)",
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
    "injuries": "Load the injury HISTORY per player from Transfermarkt -> injuries (dated absences "
                "with the matches actually missed) plus the contract-expiry snapshot (exit_risk). "
                "The per-player walk takes hours and is resumable; contract expiry exists only for "
                "TODAY - a past season's page does not carry it.",
    "elo": "Load club strength from ClubElo into club_elo at the auction dates (feeds the goalkeeper model).",
    "validate": "Run integrity checks on the database (e.g. no entirely-null column) and fail loudly if "
                "something is wrong.",
    "bootstrap": "Build EVERYTHING from the network, in dependency order, on a machine that has "
                 "nothing: listone + votes, the provider facts, transfers, Elo, injuries. About 17 "
                 "hours, fully resumable - `bootstrap --plan` prints the order and the cost first. "
                 "Needs the fantacalcio.it credentials in .env.",
    "snapshot": "TODAY'S AUCTION SHEET. Refreshes the probabili/indisponibili (a state that only "
                "exists now and cannot be backfilled), then writes one row per player and one per "
                "club under data/reports/. Two column families, and the header says which is which: "
                "`engine_*` is the valuation the gate validated (predicted fantamedia, appearances, "
                "VALUE, SURPLUS); `desc_*` is DESCRIPTIVE and NOT gated - form over the last 10 "
                "matches, injury propensity, expected minutes, starting duels, bonus and penalty "
                "duty, discipline, contract situation. What no source states (the player's "
                "relationship with the club, the coach's ideas, set-piece duty beyond penalties) is "
                "listed as not measurable instead of being invented.",
    "export": "Write the app's data bundle (data/export/<season>/): a pruned SQLite + JSON tables + "
              "a manifest carrying provenance, which prices are auction-safe, the provisional "
              "parameters and the known gaps. Read-only on the DB, and it verifies what it wrote.",
}

# Operation state -> (symbol, palette key) for the indicator dot. The colour is resolved at DRAW
# time through the theme, so the same dot works in both modes.
STATE_GLYPH: dict[str, tuple[str, str]] = {
    "completed": ("✓", "ok"),
    "todo": ("●", "warn"),
    "unavailable": ("○", "idle"),
}


def state_style(state: str) -> tuple[str, str]:
    glyph, key = STATE_GLYPH[state]
    return glyph, theme.color(key)


# Kept as a mapping for the callers that only want the glyph; the colour is theme-dependent now.
STATE_STYLE: dict[str, tuple[str, str]] = {
    state: (glyph, theme.LIGHT[key]) for state, (glyph, key) in STATE_GLYPH.items()
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
    "injuries": "injuries",
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
        return "todo"          # a report, so it is always worth running (and now implemented)
    if command == "bootstrap":
        # From-zero acquisition: done once the registry exists. Never "unavailable" - it is exactly
        # what an empty machine needs, and it is the only button that works with nothing in place.
        return "completed" if rows("players") > 0 else "todo"
    if command == "export":
        if not has_db or rows("rosters") == 0:
            return "unavailable"
        return "completed" if rows("_export_bundle") else "todo"
    if command == "snapshot":
        # A snapshot is about TODAY, so yesterday's does not count as done: it goes back to "to do"
        # every day, which is the honest state for a sheet whose whole value is being current.
        if not has_db or rows("rosters") == 0:
            return "unavailable"
        return "completed" if rows("_snapshot_today") else "todo"
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

    def __init__(self, tree, help_by_column: dict[str, str], cell_text=None) -> None:
        self.tree = tree
        self.help = help_by_column
        # Optional per-CELL text: `cell_text(row_id, column) -> str`. A column of icons needs it - the
        # heading can say what the column is for, but only the row can say what its own icons mean.
        self.cell_text = cell_text
        self.current: str | None = None
        self.current_cell: tuple | None = None
        self.tip = Tooltip(tree, self._text, delay=350, anchor="pointer", bind_events=False)
        tree.bind("<Motion>", self._on_motion, add="+")
        tree.bind("<Leave>", self._leave, add="+")

    def _text(self) -> str:
        if self.current_cell and self.cell_text:
            return self.cell_text(*self.current_cell)
        return self.help.get(self.current or "", "")

    def _column_under(self, event) -> str | None:
        if self.tree.identify_region(event.x, event.y) != "heading":
            return None
        columns = self.tree.cget("columns")
        try:
            index = int(self.tree.identify_column(event.x).lstrip("#")) - 1
        except ValueError:
            return None
        if index < 0:
            return "#0"          # the tree column, which a view may use for a drawing of its own
        return columns[index] if index < len(columns) else None

    def _cell_under(self, event) -> tuple | None:
        if self.cell_text is None or self.tree.identify_region(event.x, event.y) != "cell":
            return None
        row = self.tree.identify_row(event.y)
        columns = self.tree.cget("columns")
        try:
            index = int(self.tree.identify_column(event.x).lstrip("#")) - 1
        except ValueError:
            return None
        if not row or index < 0 or index >= len(columns):
            return None
        return row, columns[index]

    def _on_motion(self, event) -> None:
        column = self._column_under(event)
        cell = self._cell_under(event)
        if column == self.current and cell == self.current_cell:
            return
        self.current, self.current_cell = column, cell
        self.tip.hide()
        if self._text():
            self.tip.schedule()

    def _leave(self, _event=None) -> None:
        self.current = self.current_cell = None
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


# The neutral cells (a plain vote, an empty one) are CHROME: they must follow the theme, or a dark
# panel shows a white sheet. The coloured statuses (injured, suspended, bench...) are data encodings
# and stay fixed - a defender's green means the same thing in both modes.
_THEMED_RATING_STATUS = {"played": ("surface", "text"), "no_vote": ("surface_alt", "text_faint")}


def rating_cell_style(status) -> tuple[str, str]:
    themed = _THEMED_RATING_STATUS.get(status)
    if themed:
        return theme.color(themed[0]), theme.color(themed[1])
    return RATING_STATUS_STYLE.get(status, (theme.color("surface"), theme.color("text")))


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
        ttk.Label(top, textvariable=self.info_var, style="Muted.TLabel").pack(side="right", padx=6)

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True, pady=(8, 0))
        self.header_canvas = tk.Canvas(body, height=HEADER_H, highlightthickness=0,
                                       background=theme.color("surface_alt"))
        self.body_canvas = tk.Canvas(body, highlightthickness=0,
                                     background=theme.color("surface"))
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
            hc.create_rectangle(cx, 0, cx + w, HEADER_H, fill=theme.color("surface_alt"),
                                outline=theme.color("border"))
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
                bc.create_rectangle(0, y, total_w, y + ROW_H, fill=theme.color("surface_alt"),
                                    outline="")
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
            hc.create_rectangle(cx, 0, cx + w, HEADER_H, fill=theme.color("surface_alt"),
                                outline=theme.color("border"))
            text = header
            if col_id == self._sort_col:
                text += " ▼" if self._sort_desc.get(col_id) else " ▲"
            hc.create_text(cx + 6, HEADER_H // 2, anchor="w", text=text, font=("Segoe UI", 8, "bold"))
        for j, md in enumerate(days):
            cx = left_w + j * CELL_W
            in_euro = md in euro_rounds
            hc.create_rectangle(cx, 0, cx + CELL_W, HEADER_H,
                                fill=theme.color("surface_alt") if in_euro else SYNTHETIC_HEADER,
                                outline=theme.color("border"))
            hc.create_text(cx + CELL_W // 2, HEADER_H // 2, text=str(md),
                           font=("Segoe UI", 8, "bold"),
                           fill=theme.color("text") if in_euro else SYNTHETIC_STYLE[1])
        hc.configure(scrollregion=(0, 0, total_w, HEADER_H))

        for i, pl in enumerate(players):
            y = i * ROW_H
            if i % 2:
                bc.create_rectangle(0, y, total_w, y + ROW_H, fill=theme.color("surface_alt"),
                                    outline="")
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
                    bg, fg = (SYNTHETIC_STYLE if mv_synth is not None
                              else (theme.color("surface_alt"), theme.color("text_faint")))
                    shown = half_step(mv_synth) if (minutes or 0) > 0 else None
                    txt = f"{shown:g}" if shown is not None else ""
                    font = ("Segoe UI", 8, "italic")
                bc.create_rectangle(cx, y, cx + CELL_W, y + ROW_H, fill=bg,
                                    outline=theme.color("border"))
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


# Mirrors `evaluate.SURPLUS` / `evaluate.SURPLUS_PRESSURE`, deliberately NOT imported: the panel
# must open on a machine where the engine cannot be imported at all (see `_auction_views`). A test
# pins the constants together.
SURPLUS = "surplus"
SURPLUS_PRESSURE = "surplus_pressure"


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

    # The two currencies a role slot can be ranked in, SURPLUS first because it is what an auction
    # actually asks: what is he worth OVER the man who would have played instead. VALUE = FM x Pv is
    # kept, not because it is the pre-registered gate metric (it is, but the gate reads the engine, not
    # this panel) - it is kept because it is the only way to SEE why surplus reordered something. An
    # iron man on a replacement-level fantamedia is 9th by VALUE and 154th by SURPLUS, and the pair of
    # views is the explanation. Label -> the metric key `evaluate.auction_view` takes.
    # SURPLUS_PRESSURE exists in the engine (slot-pressure scaled ranking) and is deliberately NOT
    # offered here: its own declared validation (metrica-asta-surplus-v1.md §11) found the bust rate
    # unchanged on all 30 window views while captured VALUE fell 0.61% - the contested-group flops
    # either never reach the predicted top-10s (the engine could not price Openda or David at all)
    # or are injuries no slot logic can foresee. The Pair column carries the same evidence without
    # reordering anything. Re-offering it is a user decision to take out loud, not a default.
    METRICS: ClassVar[dict[str, str]] = {
        "SURPLUS ((FM - repl.) x Pv)": SURPLUS,
        "VALUE (FM x Pv)": "value",
    }

    # Shared by both tables. What differs between them - FM/Pv/VALUE are predicted on the left and
    # actual on the right - is in PREDICTED_HELP / ACTUAL_HELP below.
    COMMON_HELP: ClassVar[dict[str, str]] = {
        "#": "Position in this list.",
        "Player": "Name as it appears in the listone (fc_id is the primary key behind it).",
        "Team": "Club at the auction, abbreviated: MUN = Manchester United, S04 = Schalke 04. "
                "Empty when the club is unknown for that season.",
        "FVM":"Fantavalore di mercato from the listone, in its current state - so for a finished "
               "season it is the END-OF-SEASON market value. The market's own answer to the question "
               "the engine answers with VALUE. Reporting only: no rule may read it. Mantra: FVM M.",
    }
    PREDICTED_HELP: ClassVar[dict[str, str]] = {
        "FM": "Predicted fantamedia: role anchor + beta x (last season's fantamedia - anchor). "
              "Goalkeepers go through the decomposed M2e model instead, which never uses the anchor.",
        "Pv": "Predicted appearances over the season's matchdays. This side of the product carries "
              "3 to 11 times more of the VALUE error than the fantamedia does.",
        "VALUE": "Predicted VALUE = predicted fantamedia x predicted appearances - the sum of the "
                 "fantavoti he is expected to hand you. The list is sorted by this.",
        "real VALUE": "What he actually returned: real fantamedia x real appearances. Blank when he "
                      "never played.",
        "SURPLUS": "Predicted SURPLUS = (predicted fantamedia - the role's replacement level) x "
                   "predicted appearances, then weighted by how much of the season he is expected to "
                   "play: what he is worth OVER the player you would have fielded instead, discounted "
                   "for not being able to count on him. Negative means worse than the bench. The list "
                   "is sorted by this; the replacement level is in each role's header and the "
                   "reliability weight is in the line above the tables.",
        "real SURPLUS": "The same over-the-bench measure on what he actually did. The weight bites "
                        "here too: 18 appearances of 38 keep 69% of the surplus. Below the minimum "
                        "share of the season (see the line above the tables) a player is not ranked "
                        "at all - he was never someone you could have fielded. Blank when he never "
                        "played.",
        "real #": "Where he actually finished among this role's players, in the currency being ranked "
                  "by. A dash means he ended the season with nothing at all.",
        "Pair": "Another player of the SAME CLUB sits in this top list: the two claim the same "
                "slots, so treat the pair as one auction decision, not two. The evidence, all "
                "auction-legal: K = forwards the club actually fielded per eleven last season "
                "(2.05 = a two-striker system that can feed both, 1.4 = one slot; n/m = not "
                "measurable); co = elevens the two started TOGETHER last season (23 = a real "
                "partnership, 0-3 = starter and backup, - = never, e.g. one just arrived); "
                "ΔQt.I = his quotation minus the companion's - negative means the market itself "
                "ranks him as the second choice.",
    }
    ACTUAL_HELP: ClassVar[dict[str, str]] = {
        "FM": "Fantamedia actually achieved over the season.",
        "Pv": "Appearances actually made.",
        "VALUE": "VALUE actually achieved = fantamedia x appearances. This list is sorted by it - "
                 "which is why an iron man on a mediocre fantamedia legitimately appears here.",
        "SURPLUS": "(fantamedia - the role's replacement level) x appearances, actually achieved, "
                   "weighted by the share of the season he played. This list is sorted by it, so two "
                   "kinds of player drop out: whoever only accumulated fantavoti without ever beating "
                   "the bench, and whoever was excellent in too few matches to be counted on.",
        "pred. VALUE": "What the engine predicted for him on auction day. Empty when it could not "
                       "price him at all - no previous season to regress from.",
        "pred. SURPLUS": "The same prediction in the over-the-bench currency. Empty when the engine "
                         "could not price him at all.",
        "pred. #": "His rank in the predicted list. 'not priced' means the engine had no prediction "
                   "for him, so no ranking could contain him: an unreachable slot, not a bad guess.",
    }

    # Columns follow the chosen currency rather than showing both: the panel had one column too many
    # already. Kept beside the help dictionaries on purpose - a test asserts that every column of every
    # metric has an explanation, so a new column cannot ship without one.
    COLUMNS: ClassVar[dict[str, tuple[tuple[str, ...], tuple[str, ...]]]] = {
        "value": (
            ("#", "Player", "Team", "FM", "Pv", "VALUE", "real VALUE", "FVM", "real #", "Pair"),
            ("#", "Player", "Team", "FM", "Pv", "VALUE", "FVM", "pred. VALUE", "pred. #")),
        SURPLUS: (
            ("#", "Player", "Team", "FM", "Pv", "SURPLUS", "real SURPLUS", "FVM", "real #", "Pair"),
            ("#", "Player", "Team", "FM", "Pv", "SURPLUS", "FVM", "pred. SURPLUS", "pred. #")),
    }

    ROLE_LABELS: ClassVar[dict[str, str]] = {
        "P": "Goalkeepers", "D": "Defenders", "C": "Midfielders", "A": "Forwards",
        "por": "por", "dc": "dc", "dd": "dd", "ds": "ds", "b": "b", "e": "e",
        "m": "m", "c": "c", "w": "w", "t": "t", "a": "a", "pc": "pc",
    }

    def __init__(self, parent: tk.Widget, config: Config) -> None:
        super().__init__(parent, padding=10)
        self.config = config
        # (platform, game, metric) -> {season: view}. The metric is part of the key because it changes
        # the ORDER of both lists, so a cached view computed under the other one is a different answer.
        self._cache: dict[tuple[str, str, str], dict] = {}
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
        self.metric_var = tk.StringVar(value=next(iter(self.METRICS)))
        self.metric_cb = self._selector(top, "Rank by", self.metric_var, list(self.METRICS),
                                        self._on_config_change, width=26)
        # Indeterminate, because the work has no progress to report: the engine either has the window
        # fitted or it does not. It is packed and unpacked rather than left in place, so a still bar
        # never sits there looking like a stalled one.
        self.spinner = ttk.Progressbar(top, mode="indeterminate", length=90)
        # Every selector in one place: `_busy` disables the collection, so a selector added later is
        # locked during a run without anyone having to remember it.
        self._selectors = (self.platform_cb, self.game_cb, self.season_cb, self.metric_cb)
        self.status_var = tk.StringVar(value="")
        ttk.Label(top, textvariable=self.status_var, style="Muted.TLabel").pack(side="left", padx=8)

        setup = self.config.load_league()
        gamma, floor = setup["reliability_exponent"], setup["min_availability"]
        hint = (f"predicted from the previous season only · FVM = the listone's end-of-season market "
                f"value · league: {setup['teams']} teams, squad "
                + "/".join(f"{count}{role}" for role, count in setup["squad_slots"].items())
                + (f", catchability weight (Pv/matchdays)^{gamma:g}" if gamma else
                   ", catchability weight off")
                + (f", ranked only above {floor:.0%} of the season" if floor else "")
                + " (config/league_config.json) — sets the replacement level SURPLUS is measured "
                  "against, and how much a player you cannot count on is worth")
        ttk.Label(self, text=hint, foreground="#777", wraplength=1100,
                  justify="left").pack(fill="x", pady=(4, 0))

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

    def _metric(self) -> str:
        return self.METRICS.get(self.metric_var.get(), "value")

    def _on_config_change(self, _event=None) -> None:
        key = (self.platform_var.get(), self.game_var.get(), self._metric())
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

    def _compute(self, platform: str, game: str, metric: str) -> None:
        """Worker: run the engine for every usable window of this platform+game."""
        try:
            views = self._auction_views(platform, game, metric)
            error = None
        except Exception as exc:                    # noqa: BLE001 - the panel reports, never crashes
            views, error = {}, f"{type(exc).__name__}: {exc}"
        self.after(0, lambda: self._done(platform, game, metric, views, error))

    def _auction_views(self, platform: str, game: str, metric: str) -> dict[str, dict]:
        """{target season: per-role view}. Imported here so the GUI starts without the engine."""
        from euroleghe_ingest.engine import evaluate, features

        conn = connect(self.config.db_path)
        # The league setup is what makes SURPLUS computable at all: it fixes the rank of the marginal
        # rostered player, whose fantamedia IS the replacement level. Under Mantra the engine turns it
        # into per-role depth using the fielding caps it measures off real lineups.
        setup = self.config.load_league()
        try:
            usable, fits = {}, {}
            for key, window in features.WINDOWS.items():
                data = features.prepare(conn, window, platform, game, league=setup)
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
                    "window": key, "params_from": params.source, "metric": metric,
                    "rules": ", ".join(adopted[1:]) or "baseline only",
                    "by_role": evaluate.auction_view(
                        data, evaluate.predict_window(data, adopted, None, params),
                        metric=metric),
                }
            return out
        finally:
            conn.close()

    # A run owns the selection it was started with. Changing platform or game mid-run would leave a
    # worker computing one thing while the panel claims another, and changing season would render from a
    # cache entry the run is about to replace.
    SELECTOR_STATE: ClassVar[dict[bool, str]] = {True: "disabled", False: "readonly"}

    def _busy(self, running: bool) -> None:
        """Spinner on, selectors off - and the reverse. Called on the error path too: a failure must not
        leave the panel spinning with its controls locked."""
        for selector in self._selectors:
            selector.configure(state=self.SELECTOR_STATE[running])
        if running:
            self.spinner.pack(side="left", padx=(4, 0))
            self.spinner.start(12)
        else:
            self.spinner.stop()
            self.spinner.pack_forget()

    def _done(self, platform: str, game: str, metric: str, views: dict,
              error: str | None) -> None:
        self._running = False
        self._busy(False)
        if error:
            self.status_var.set(error)
            return
        self._cache[(platform, game, metric)] = views
        if (platform, game, metric) == (self.platform_var.get(), self.game_var.get(),
                                        self._metric()):
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
        views = self._cache.get((self.platform_var.get(), self.game_var.get(), self._metric()))
        if views and self.season_var.get() in views:
            self._render(views[self.season_var.get()])

    # ---------- rendering ----------
    def _clear(self) -> None:
        for child in self.inner.winfo_children():
            child.destroy()

    def _render(self, view: dict) -> None:
        self._clear()
        metric = view.get("metric", "value")
        currency = "SURPLUS" if metric == SURPLUS else "VALUE"
        total_hits = sum(block["hits"] for block in view["by_role"].values())
        captured = sum(block["captured_value"] or 0 for block in view["by_role"].values())
        perfect = sum(block["perfect_value"] or 0 for block in view["by_role"].values())
        roles = len(view["by_role"])
        share = f"{captured / perfect * 100:.0f}%" if perfect else "n/a"
        self.status_var.set(
            f"window {view['window']} · rules {view['rules']} · parameters from "
            f"{view['params_from']} · {total_hits}/{roles * 10} names · {share} of the perfect "
            f"top-10 {currency}")
        for role, block in view["by_role"].items():
            self._render_role(role, block, metric)

    @staticmethod
    def _num(value, digits: int = 0) -> str:
        """One place for the column formats: %g would print 32.199999 next to 5.1 and 210.9."""
        return "" if value is None else f"{float(value):.{digits}f}"

    @staticmethod
    def _pair_text(pair: dict | None) -> str:
        """The same-club annotation, compact: 'w/ Piccoli · K 1.71 · co - · ΔQt.I -17'."""
        if not pair:
            return ""
        mate = pair["with"][0] + (f" +{len(pair['with']) - 1}" if len(pair["with"]) > 1 else "")
        k = pair.get("k_mean")
        co = pair.get("co_starts")
        gap = pair.get("qti_gap")
        return " · ".join((f"w/ {mate}",
                           f"K {k:.2f}" if k is not None else "K n/m",
                           f"co {co}" if co is not None else "co -",
                           f"ΔQt.I {gap:+.0f}" if gap is not None else "ΔQt.I -"))

    def _render_role(self, role: str, block: dict, metric: str = "value") -> None:
        label = self.ROLE_LABELS.get(role, role)
        misses = block["misses"]
        surplus = metric in (SURPLUS, SURPLUS_PRESSURE)
        currency = "SURPLUS" if surplus else "VALUE"
        # The replacement level is the whole premise of the surplus ranking, so it is stated in the
        # header rather than hidden in a tooltip: without it "-33" on a row means nothing.
        floor, floor_act = block.get("replacement"), block.get("replacement_actual")
        floor_text = ""
        if surplus and floor is not None:
            floor_text = f" · replacement FM {floor:.2f}"
            # Both, when the role's level moved: the predicted list is scored against what the auction
            # could know, the actual list against the season it actually happened in.
            if floor_act is not None and abs(floor_act - floor) >= 0.005:
                floor_text += f" (predicted) / {floor_act:.2f} (this season)"
        head = (f"{label} — {block['hits']}/10 in common · {currency} captured "
                f"{(block['captured_value'] or 0):.0f} of {(block['perfect_value'] or 0):.0f}"
                f"{floor_text} · misses: {misses['near']} near, {misses['regime']} beyond rank 50, "
                f"{misses['unpriced']} never priced")
        box = ttk.LabelFrame(self.inner, text=head, padding=6)
        box.pack(fill="x", expand=True, pady=(0, 10))
        left = ttk.Frame(box)
        right = ttk.Frame(box)
        left.pack(side="left", fill="both", expand=True, padx=(0, 6))
        right.pack(side="left", fill="both", expand=True)
        predicted_columns, actual_columns = self.COLUMNS[metric]
        pred_key, act_key = (("surplus_pred", "surplus_act") if surplus
                             else ("value_pred", "value_act"))
        def predicted_row(row: dict) -> tuple:
            cells = [row["rank"], row["name"], club_abbreviation(row["club"]),
                     self._num(row["fm_pred"], 2), self._num(row["pv_pred"], 1),
                     self._num(row[pred_key]), self._num(row[act_key]),
                     self._num(row["fvm"]), row["actual_rank"] or "-"]
            if metric == SURPLUS_PRESSURE:
                cells.append(self._num(row.get("pressure"), 2))
            cells.append(self._pair_text(row.get("pair")))
            return tuple(cells)

        self._table(left, "Predicted at the auction", predicted_columns,
                    [predicted_row(row) for row in block["predicted"]],
                    {**self.COMMON_HELP, **self.PREDICTED_HELP})
        self._table(right, "Actual, end of season", actual_columns,
                    [(row["rank"], row["name"], club_abbreviation(row["club"]),
                      self._num(row["fm_act"], 2), self._num(row["pv_act"]),
                      self._num(row[act_key]), self._num(row["fvm"]),
                      self._num(row[pred_key]),
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
            # The widest header decides: "real SURPLUS" and "pred. SURPLUS" do not fit in 68 px with
            # the theme's font, and a clipped column header reads as a different column.
            width = (130 if column == "Player" else 46 if column == "#"
                     else 52 if column == "Team" else 170 if column == "Pair"
                     else 96 if "SURPLUS" in column else 68)
            tree.column(column, width=width,
                        anchor="w" if column in ("Player", "Team", "Pair") else "e",
                        stretch=column in ("Player", "Pair"))
        for row in rows:
            tree.insert("", "end", values=row)
        HeadingTooltip(tree, help_by_column)
        tree.pack(fill="x")



class SnapshotView(ttk.Frame):
    """The auction snapshot as a board: the clubs on the left, one club's plan on the right.

    Reads the folder `snapshot` wrote - `players.csv`, `clubs.csv`, `manifest.json` - rather than
    recomputing anything, so what is on screen is exactly the sheet that was produced and a run and a
    reading can never disagree. "Build now" runs the module and reloads.

    Right hand side, top to bottom: what is known about the club, the probable eleven on a pitch with
    each starter's rivals for the shirt underneath him, and the squad ordered BY ROLE first and by
    predicted SURPLUS second - the order an auction is actually prepared in.
    """

    ROLE_ORDER: ClassVar[dict[str, int]] = {"P": 0, "D": 1, "C": 2, "A": 3}
    # Where a player really stands across the pitch, from his MANTRA roles - which encode laterality
    # even when the auction is played in Classic: 'dd' is a right-back, 'ds' a left-back, 'dc' a centre
    # back. -1 = the team's left, +1 = its right, 0 = the middle. `None` = wide but the side is not
    # stated ('e' wing-back, 'w' winger): those fill the flanks that are still free.
    # Precedence matters: a role that NAMES a side wins over one that does not. Carlos Augusto is
    # 'b;ds;e' - braccetto, left-back, wing-back - and reading the first entry put a left-back in the
    # middle of the defence.
    # The short code drawn inside the position marker. Italian, because that is the vocabulary of the
    # game: Ts terzino sinistro, Td terzino destro, Dc difensore centrale, Br braccetto, Es/Ed esterno,
    # M mediano, C centrocampista, T trequartista, As/Ad ala, Pc punta centrale, A attaccante.
    # A side is only claimed when something states it: the Mantra role, or failing that where the player
    # is actually drawn in his line. Otherwise the code stays neutral rather than inventing a flank.
    BADGE: ClassVar[dict[str, tuple[str, str, str]]] = {
        # role: (left form, centre/neutral form, right form)
        "por": ("P", "P", "P"),
        "ds": ("Ts", "Ts", "Ts"),
        "dd": ("Td", "Td", "Td"),
        "dc": ("Dc", "Dc", "Dc"),
        "b": ("Bs", "Br", "Bd"),
        "e": ("Es", "E", "Ed"),
        "w": ("As", "Al", "Ad"),
        "m": ("M", "M", "M"),
        "c": ("Cs", "C", "Cd"),
        "t": ("T", "T", "T"),
        "a": ("As", "A", "Ad"),
        "pc": ("Pc", "Pc", "Pc"),
    }
    # The granular REAL role, in the same Italian vocabulary. One entry per provider code, and no side
    # variants are needed: every one of the twelve already names its flank, which is the whole reason it
    # beats the Mantra role here. M mediano (davanti alla difesa), C centrocampista centrale,
    # T trequartista - three places the listone calls 'C' and draws on top of each other.
    BADGE_REAL: ClassVar[dict[str, str]] = {
        "GK": "P",
        "DL": "Ts", "DC": "Dc", "DR": "Td",
        "DM": "M",
        "ML": "Es", "MC": "C", "MR": "Ed",
        "AM": "T",
        "LW": "As", "RW": "Ad",
        "ST": "Pc",
    }
    # Fallback when the listone gives no Mantra role at all: the Classic role, with the side if known.
    BADGE_CLASSIC: ClassVar[dict[str, tuple[str, str, str]]] = {
        "P": ("P", "P", "P"), "D": ("Ts", "Dc", "Td"),
        "C": ("Cs", "C", "Cd"), "A": ("As", "A", "Ad"),
    }

    # The reference depth of each drawn line, so the granular role's own depth becomes a NUDGE inside
    # the line rather than a second, competing placement. A wing-back listed as 'D' but really used as
    # ML (0.60 against the defence's 0.25) steps forward - which is what a 3-5-2 looks like - and a DM
    # among the midfielders drops behind the mezzale. Clamped, because this places a man within his
    # line and must never move him into the next one: which line he is in comes from the formation and
    # the titolarità, and that decision is not this function's to reopen.
    LINE_DEPTH: ClassVar[dict[str, float]] = {"P": 0.0, "D": 0.25, "C": 0.60, "A": 0.90}

    SIDE: ClassVar[dict[str, float]] = {"ds": -1.0, "dd": 1.0}
    # Wide, but the side is not stated: 'e' wing-back, 'w' winger, 'b' the wide man of a back three.
    WIDE: ClassVar[frozenset[str]] = frozenset({"e", "w", "b"})
    # (column id, header, width, anchor). SURPLUS leads the numbers: it is the auction's own currency.
    COLUMNS: ClassVar[tuple[tuple[str, str, int, str], ...]] = (
        ("role", "R", 30, "center"),
        # Three role columns, because they answer three questions: what you BUY (the listone role), what
        # a Mantra module asks for (the sided roles), and where he was actually USED - the last one small
        # on purpose, it is a two-code hint and not the thing an auction bids on.
        ("mantra", "M", 58, "center"),
        ("real", "real", 42, "center"),
        ("name", "Player", 126, "w"),
        ("surplus", "SUR", 56, "e"),
        ("fm", "FM", 44, "e"),
        # Everything to the right is PER MATCHDAY, which is the unit an auction thinks in: a season total
        # answers "how good was he", a per-matchday share answers "what does he give me on Sunday".
        ("pv", "Pv", 40, "e"),
        ("minutes", "min", 42, "e"),
        ("tit", "tit", 40, "e"),
        ("rating", "rat", 40, "e"),
        ("bonus", "g+a", 40, "e"),
        ("inj", "inj", 38, "e"),
        ("status", "flags", 84, "center"),
    )

    # One line per column, because a sheet nobody can read is a sheet nobody should act on. The two
    # families are named in every entry: `engine_*` is gated, `desc_*` is not.
    COLUMN_HELP: ClassVar[dict[str, str]] = {
        "#0": "TREND - the club's last 10 matches, oldest on the left. Click a row to read them one by "
              "one (date, opponent, minutes, rating). One dot per match: cyan exceptional, "
              "light blue very good, green good, grey average, yellow weak, red poor - by the provider's "
              "rating, which is a DISPLAY threshold and not a model parameter. Faded dots are matches he "
              "did not play: pale grey bench or left out, violet inside a recorded injury spell, pale "
              "red a suspension, dark grey no player-level data at all (unknown, which includes not "
              "being in the squad). A suspension nobody recorded reads as bench - we do not know he "
              "was banned. A FULL dot means he played at least 75 minutes, a hollow one that he was "
              "on for less. A black mark on the top-right corner is the bonus: the big one a goal, the "
              "small one an assist - and a match with both reads as a goal. A FRIENDLY is a small grey "
              "dot, solid if he was in the eleven: the provider publishes those line-ups and no "
              "per-player statistics at all, so there is no rating to colour it with.",
        "tit": "The share of the season's matchdays he is expected to GET A VOTO in: his appearances "
               "over the matches he was available for, discounted by how much of a season a player with "
               "his injury history misses. An appearance is taken as a voto - the season layer stores "
               "totals, so it cannot tell a 10-minute cameo from a full match; the TREND strip can, and "
               "a hollow dot is exactly that.",
        "mantra": "The MANTRA roles, as the listone lists them (por, dd, dc, ds, e, m, c, t, w, a, "
                  "pc) - the roles a Mantra module has slots for, and the only ones that name a flank.",
        "role": "The LISTONE role - what you buy him as (P/D/C/A). Click to restore the auction order: "
             "by role, then by predicted SURPLUS.",
        "real": "The REAL role, in the provider's twelve-code vocabulary: "
                + " · ".join(f"{code} {REAL_ROLE_LABEL[code]}" for code in REAL_ROLES)
                + ". Up to two are shown, most representative first. This is the only column that "
                  "separates a left back from a centre back - the listone role calls both D. It is a "
                  "DATED observation of today and cannot be reconstructed for a past season, so what "
                  "the weekly run does not record is lost. Where it is missing the column falls back "
                  "to the modal per-match slot (G/D/M/F) plus a sided Mantra role, whose measured "
                  "translation is G->P 100%, D->D 97%, M->C 80%, F->A 80%.",
        "name": "Name as the listone spells it. fc_id is the key underneath, so the same man is the "
                  "same row in every view.",
        "surplus": "GATED. Predicted SURPLUS = (predicted fantamedia - the role's replacement level) x "
               "predicted appearances: points over the man you would have fielded instead. This is the "
               "auction's own currency - an iron man on a replacement-level fantamedia scores ~0.",
        "fm": "GATED. Predicted fantamedia for the season being auctioned, from the adopted rule set "
              "with parameters fitted on a window that is not this season.",
        "pv": "GATED. Predicted appearances as a SHARE of the season: the prediction over the "
              "club's own number of matches (38 in Serie A), because 30 presences mean one thing in "
              "Italy and another in a 34-match Bundesliga.",
        "minutes": "Expected minutes PER MATCHDAY: the projected season minutes over the club's "
               "matches - what he gives you on an average round, cameos and absences included. His own "
               "measured average stands in where there is no projection.",
        "rating": "Average provider rating over those matches. Not a fantamedia: a 7.0 in Serie B is not "
               "a 7.0 in Serie A, which is why it is reported raw and never converted here.",
        "bonus": "Goals + assists per 90 over the FULL real season (all competitions we scrape), not the "
               "euro calendar's subset. The engine's own propensity input, shown as it is.",
        "inj": "How much of a season a player with his history is expected to MISS, as a percentage - "
               "100% would be all of it. From his matches missed over the last three seasons, weighted "
               "by recency (1.0 / 0.6 / 0.35). DESCRIPTIVE, not gated. EMPTY is not zero: it means no "
               "absence history was found for him at all, and the flags column says so with a '?'.",
        "status": "Everything true about him that is not a number: the probabili's verdict, an open "
                 "injury, a suspension, a ballottaggio, a summer arrival, an expiring contract, and "
                 "whether we have any absence history for him at all. HOVER A ROW to read its icons.",
    }

    def __init__(self, parent, config: Config, on_build=None) -> None:
        super().__init__(parent)
        self.config = config
        self._sparks: list = []
        self.on_build = on_build
        self.folders: list = []
        self.sort_by: str | None = None
        self.sort_desc = True
        self.rows: list[dict] = []
        self.players: list[dict] = []
        self.clubs: dict[str, dict] = {}
        self.manifest: dict = {}
        self._build()

    # ---------- layout ----------
    def _build(self) -> None:
        bar = ttk.Frame(self, padding=(0, 8))
        bar.pack(fill="x")
        ttk.Label(bar, text="Snapshot:").pack(side="left")
        self.folder_var = tk.StringVar()
        self.folder_cb = ttk.Combobox(bar, textvariable=self.folder_var, state="readonly", width=42)
        self.folder_cb.pack(side="left", padx=6)
        self.folder_cb.bind("<<ComboboxSelected>>", lambda _e: self.load_selected())
        if self.on_build:
            ttk.Button(bar, text="Build now", style="Accent.TButton",
                       command=self.on_build).pack(side="left", padx=(0, 6))
        ttk.Button(bar, text="Reload", command=self.reload).pack(side="left")
        # A build takes minutes and its log lives on another tab, so the progress belongs here.
        self.build_progress = ttk.Progressbar(bar, mode="indeterminate", length=120)
        self.build_step = tk.StringVar()
        self.build_label = ttk.Label(bar, textvariable=self.build_step, style="Muted.TLabel")
        self.xi_mode = tk.StringVar(value="typical")
        self.note_var = tk.StringVar()
        ttk.Label(bar, textvariable=self.note_var, style="Muted.TLabel").pack(side="left", padx=10)

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True)

        left = ttk.Frame(body, style="Card.TFrame", padding=(8, 8))
        left.pack(side="left", fill="y")
        ttk.Label(left, text="CLUBS", style="CardMuted.TLabel").pack(anchor="w", pady=(0, 4))
        self.club_tree = ttk.Treeview(left, columns=("club", "n"), show="headings", height=24,
                                      selectmode="browse")
        self.club_tree.heading("club", text="Club")
        self.club_tree.heading("n", text="#")
        self.club_tree.column("club", width=132, anchor="w")
        self.club_tree.column("n", width=34, anchor="e")
        self.club_tree.pack(fill="y", expand=True)
        self.club_tree.bind("<<TreeviewSelect>>", lambda _e: self._show_club())

        right = ttk.Frame(body)
        right.pack(side="left", fill="both", expand=True, padx=(10, 0))

        head = ttk.Frame(right, style="Card.TFrame", padding=(12, 10))
        head.pack(fill="x")
        self.club_title = tk.StringVar(value="select a club")
        ttk.Label(head, textvariable=self.club_title, style="H1.TLabel").pack(anchor="w")
        self.club_info = tk.StringVar()
        ttk.Label(head, textvariable=self.club_info, style="CardMuted.TLabel", justify="left",
                  wraplength=900).pack(anchor="w", pady=(2, 0))

        # Two columns: the eleven on the left, the squad on the right. Stacked, the pitch pushed the
        # list below the fold on a laptop - and the two are read together, not one after the other.
        columns = ttk.Frame(right)
        columns.pack(fill="both", expand=True, pady=(8, 0))
        pitch_card = ttk.Frame(columns, style="Card.TFrame", padding=(8, 8))
        pitch_card.pack(side="left", fill="both", expand=True)
        toggle = ttk.Frame(pitch_card, style="Card.TFrame")
        toggle.pack(fill="x", pady=(0, 6))
        ttk.Label(toggle, text="XI", style="CardMuted.TLabel").pack(side="left", padx=(2, 8))
        for label, value in (("schieramento tipo", "typical"), ("prossima giornata", "next")):
            ttk.Radiobutton(toggle, text=label, value=value, variable=self.xi_mode,
                            style="Card.TRadiobutton",
                            command=self._show_club).pack(side="left", padx=(0, 10))
        # Which vocabulary the markers speak. Three, because an auction uses three.
        ttk.Label(toggle, text="ruoli", style="CardMuted.TLabel").pack(side="left", padx=(6, 4))
        self.role_mode = tk.StringVar(value="real")
        ttk.Combobox(toggle, textvariable=self.role_mode, state="readonly", width=8,
                     values=["real", "mantra", "classic"]).pack(side="left")
        self.role_mode.trace_add("write", lambda *_a: self._draw_pitch())
        self.pitch = tk.Canvas(pitch_card, width=430, highlightthickness=0,
                               background=theme.color("surface"))
        self.pitch.pack(fill="both", expand=True)
        self.pitch.bind("<Configure>", lambda _e: self._draw_pitch())

        table = ttk.Frame(columns, style="Card.TFrame", padding=(8, 8))
        table.pack(side="left", fill="both", expand=True, padx=(8, 0))
        # `show="tree headings"`: a Treeview cell cannot hold a drawing, but the TREE column can hold
        # one image per row - which is where the last-10 strip goes.
        self.player_tree = ttk.Treeview(table, columns=[c[0] for c in self.COLUMNS],
                                        show="tree headings", selectmode="browse")
        self.player_tree.heading("#0", text="TREND")
        self.player_tree.column("#0", width=124, minwidth=124, stretch=False, anchor="w")
        for key, title, width, anchor in self.COLUMNS:
            self.player_tree.heading(key, text=title,
                                     command=lambda column=key: self._sort_by(column))
            self.player_tree.column(key, width=width, anchor=anchor,
                                    stretch=key in ("name", "status"))
        scroll = ttk.Scrollbar(table, orient="vertical", command=self.player_tree.yview)
        self.player_tree.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.player_tree.pack(fill="both", expand=True)
        HeadingTooltip(self.player_tree, self.COLUMN_HELP, cell_text=self._cell_help)
        # Click the strip to see what the dots stand for. Ten dots cannot carry a date, an opponent or a
        # scoreline, and those are exactly what turns "a red dot" into a reason.
        self.player_tree.bind("<Button-1>", self._on_click, add="+")

    def restyle(self) -> None:
        """Redraw everything whose colours were baked in: the dot strips and the pitch."""
        self.pitch.configure(background=theme.color("surface"))
        if self.rows:
            self._fill_table()
        self._draw_pitch()

    # ---------- data ----------
    def reload(self) -> None:
        reports = self.config.data_dir / "reports"
        self.folders = sorted((path for path in reports.glob("auction-snapshot-*")
                               if (path / "players.csv").exists()), reverse=True)
        self.folder_cb.configure(values=[path.name.replace("auction-snapshot-", "")
                                         for path in self.folders])
        if not self.folders:
            self.note_var.set("no snapshot yet - use 'Build now', or Operations > Auction snapshot")
            return
        if self.folder_var.get() not in self.folder_cb["values"]:
            self.folder_var.set(self.folder_cb["values"][0])
        self.load_selected()

    def building(self, running: bool, step: str = "") -> None:
        """Show the build's progress and the stage it has reached; hide it again when it is done.

        Indeterminate on purpose. What the run costs is dominated by whatever the DB is missing - a
        squad walk, the club form, the granular roles - so a percentage would be a number we made up,
        and the honest signal is that it is still working and what it is working on. The stage text is
        the module's own last line, which is also what the Operations log records.
        """
        self.build_step.set(step[:64])
        if running:
            if not self.build_progress.winfo_ismapped():
                self.build_progress.pack(side="left", padx=(8, 4))
                self.build_label.pack(side="left")
                self.build_progress.start(12)
        else:
            self.build_progress.stop()
            self.build_progress.pack_forget()
            self.build_label.pack_forget()

    def load_selected(self) -> None:
        names = list(self.folder_cb["values"])
        if not names or self.folder_var.get() not in names:
            return
        folder = self.folders[names.index(self.folder_var.get())]
        self.players = _read_csv(folder / "players.csv")
        self.clubs = {row["club"]: row for row in _read_csv(folder / "clubs.csv")}
        self.manifest = _read_json(folder / "manifest.json")
        engine = self.manifest.get("engine", {})
        notes = self.manifest.get("notes", [])
        self.note_var.set(f"{len(self.players)} players · rules {', '.join(engine.get('rules', []))} "
                          f"· params {engine.get('params_from', '?')}"
                          + (f" · {len(notes)} note(s) in the manifest" if notes else ""))
        self.club_tree.delete(*self.club_tree.get_children())
        counts: dict[str, int] = {}
        for row in self.players:
            club = row.get("club") or "(club unknown)"
            counts[club] = counts.get(club, 0) + 1
        for club in sorted(counts):
            self.club_tree.insert("", "end", iid=club, values=(club, counts[club]))
        children = self.club_tree.get_children()
        if children:
            self.club_tree.selection_set(children[0])

    def _selected_club(self) -> str | None:
        selection = self.club_tree.selection()
        return selection[0] if selection else None

    def squad(self, club: str) -> list[dict]:
        """The club's players, BY ROLE then by predicted SURPLUS - how an auction is prepared."""
        rows = [row for row in self.players if (row.get("club") or "(club unknown)") == club]
        rows.sort(key=lambda row: (self.ROLE_ORDER.get(row.get("role_classic") or "", 9),
                                   -_number(row.get("engine_surplus"), -1e9)))
        return rows

    # ---------- the last-10 strip ----------
    # What each token of `desc_form_series` means, in the popup's own words.
    TOKEN_LABEL: ClassVar[dict[str, str]] = {
        "p": "played", "b": "bench / left out", "i": "injured", "s": "suspended",
        "n": "no data for this match",
        "x": "in the eleven, no statistics published (friendly)",
    }

    def _on_click(self, event) -> None:
        """A click on the strip (the tree column) opens the match-by-match list for that row."""
        if self.player_tree.identify_region(event.x, event.y) != "tree":
            return
        item = self.player_tree.identify_row(event.y)
        if not item:
            return
        index = self.player_tree.index(item)
        rows = self._sorted(self.rows)
        if 0 <= index < len(rows):
            self._match_popup(rows[index])

    def _match_popup(self, row: dict) -> None:
        """The club's last ten, one line each: what the dots are, in words.

        Reads `desc_form_detail`, which the sheet carries for exactly this purpose - so the window and
        the CSV can never tell different stories about the same match.
        """
        dialog = tk.Toplevel(self)
        dialog.title(f"{row.get('name')} · last 10 matches of {row.get('club')}")
        dialog.transient(self.winfo_toplevel())
        dialog.resizable(False, False)
        frame = ttk.Frame(dialog, padding=12)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text=f"{row.get('name')}  ({row.get('role_classic') or '?'})",
                  style="H2.TLabel").pack(anchor="w")
        played = row.get("desc_form_played") or 0
        measured = row.get("desc_form_measured") or 0
        ttk.Label(frame, style="Muted.TLabel", justify="left", wraplength=520,
                  text=f"played {played} of {measured} matches we have player data for, out of "
                       f"{row.get('desc_form_club_matches') or 0} the club played. "
                       f"{row.get('desc_form_unknown') or 0} of them we know nothing about."
                  ).pack(anchor="w", pady=(2, 8))

        columns = ("date", "comp", "opponent", "state", "min", "rating", "g", "a")
        titles = ("date", "competition", "opponent", "what happened", "min", "rating", "G", "A")
        widths = (82, 118, 130, 118, 44, 52, 30, 30)
        tree = ttk.Treeview(frame, columns=columns, show="headings", height=11, selectmode="none")
        for key, title, width in zip(columns, titles, widths, strict=True):
            tree.heading(key, text=title)
            tree.column(key, width=width, anchor="w" if key in ("comp", "opponent", "state") else "e")
        tree.pack(fill="both", expand=True)
        for line in (row.get("desc_form_detail") or "").split(";"):
            if not line:
                continue
            parts = (line.split("|") + [""] * 10)[:10]
            date, comp, opponent, side, token, minutes, rating, goals, assists, started = parts
            state = self.TOKEN_LABEL.get(token, token)
            if token == "p":
                state = f"started, {state}" if started else f"came on, {state}"
            tree.insert("", "end", values=(
                date, comp, f"{'vs' if side == 'H' else '@'} {opponent}".strip(), state,
                minutes, rating, goals or "", assists or ""))
        ttk.Label(frame, style="Muted.TLabel", justify="left", wraplength=520,
                  text="Oldest first, same order as the dots. The rating is the provider's, not a "
                       "fantavoto: a 7.0 in another league is not a 7.0 here, which is why it is shown "
                       "raw. 'no data' includes not being in the squad - it is not a bench appearance."
                  ).pack(anchor="w", pady=(8, 0))
        ttk.Button(frame, text="Close", command=dialog.destroy).pack(anchor="e", pady=(8, 0))

    # Performance bands, by the provider's rating. A DISPLAY threshold, not a model parameter: nothing
    # downstream fits on it, and the sheet says so in the column's own tooltip.
    BANDS: ClassVar[tuple[tuple[float, str], ...]] = (
        (8.0, "#00e5ff"),      # exceptional
        (7.3, "#2196f3"),      # very good - darker than the cyan above it, or the two read as one
        (6.8, "#66bb6a"),      # good
        (6.3, "#9e9e9e"),      # average
        (5.8, "#ffd54f"),      # weak
        (0.0, "#ef5350"),      # poor
    )
    # Matches he did not play, faded to 30% over the row background so a blank week never reads as a
    # performance. Four reasons, four colours, because they are four different facts: a choice, an
    # injury, a suspension (his own doing, and it ends on a known date), and no data at all.
    ABSENT: ClassVar[dict[str, str]] = {"b": "#9e9e9e", "i": "#9575cd", "s": "#ef5350",
                                        "n": "#37474f"}
    # A friendly is drawn SMALL and always GREY: the provider publishes its eleven and no per-player
    # statistics, so there is no rating to colour the dot with and no minutes to fill it by. Solid = he
    # was in the eleven, hollow = he was not. Size, not colour, says "this was not a competitive match".
    FRIENDLY = "#9e9e9e"
    DOT = 10                                   # cell size per match, in pixels
    FULL_MATCH = 75                            # minutes from which the dot is drawn SOLID

    @classmethod
    def band(cls, rating: float | None) -> str:
        if rating is None:
            return "#9e9e9e"
        for floor, colour in cls.BANDS:
            if rating >= floor:
                return colour
        return cls.BANDS[-1][1]

    def _sparkline(self, series: str | None, detail: str | None = None):
        """The last ten matches as dots, OLDEST on the left. A PhotoImage: a Treeview cell cannot draw.

        Three things are readable at a glance and each is a different question. The COLOUR is how he
        played (the rating band, or the faded reason he did not). SOLID or HOLLOW is whether he was really
        on the pitch - 75 minutes or more fills the dot in. And a black mark on the dot's top-right corner
        is the bonus: a big one for a goal, a small one for an assist, the goal winning when he did both.
        It is read from `desc_form_detail`, because the series token carries only rating and minutes.
        """
        tokens = (series or "").split()
        bonus = [(0, 0)] * len(tokens)
        friendly = [False] * len(tokens)
        for index, entry in enumerate((detail or "").split(";")[:len(tokens)]):
            fields = entry.split("|")
            if len(fields) >= 9:
                bonus[index] = (int(_number(fields[7])), int(_number(fields[8])))
            if fields and competition_class(fields[1] if len(fields) > 1 else "") == "friendly":
                friendly[index] = True
        size = self.DOT
        image = tk.PhotoImage(width=size * max(len(tokens), 1) + 2, height=size + 4)
        background = theme.color("surface")
        image.put(background, to=(0, 0, image.width(), image.height()))
        for index, token in enumerate(tokens):
            parts = token.split(":")
            played = parts[0] == "p"
            if played:
                rating = _number(parts[1], None) if len(parts) > 1 and parts[1] else None
                colour = self.band(rating)
                minutes = _number(parts[2]) if len(parts) > 2 else 0.0
            else:
                colour = _blend(self.ABSENT.get(parts[0], "#9e9e9e"), background, 0.3)
                minutes = 0.0
            x = index * size + 1
            if friendly[index]:
                # small, grey, and solid only if he was actually in the eleven
                self._dot(image, x, 2, self.FRIENDLY if parts[0] in ("p", "x")
                          else _blend(self.FRIENDLY, background, 0.3),
                          hollow=parts[0] not in ("p", "x"), small=True)
                continue
            self._dot(image, x, 2, colour, hollow=minutes < self.FULL_MATCH)
            goals, assists = bonus[index]
            if goals or assists:
                self._bonus(image, x, bool(goals))
        return image

    # The bonus mark: a 5x5 disc for a goal, a 3x3 one for an assist, black, on the dot's top-right
    # corner. One mark per match and the GOAL WINS - a man who scored and assisted the same game reads
    # as a scorer, because at ten pixels a cell that tries to say both says neither.
    GOAL_MARK: ClassVar[tuple[str, ...]] = (" ### ", "#####", "#####", "#####", " ### ")
    ASSIST_MARK: ClassVar[tuple[str, ...]] = (" # ", "###", " # ")

    @classmethod
    def _bonus(cls, image, x: int, scored: bool) -> None:
        """The mark, right-aligned on the dot's top-right corner, over whatever the dot drew there."""
        mark = cls.GOAL_MARK if scored else cls.ASSIST_MARK
        left = x + 8 - len(mark[0])
        for row, line in enumerate(mark):
            for column, pixel in enumerate(line):
                if pixel == "#":
                    image.put("#000000",
                              to=(left + column, row, left + column + 1, row + 1))

    # A friendly's dot: five pixels instead of eight, centred in the same cell.
    SMALL_MASK: ClassVar[tuple[str, ...]] = (" ### ", "#####", "#####", "#####", " ### ")
    SMALL_EDGE: ClassVar[tuple[str, ...]] = (" ### ", "#   #", "#   #", "#   #", " ### ")

    @staticmethod
    def _dot(image, x: int, y: int, colour: str, hollow: bool = False, small: bool = False) -> None:
        """An 8x8 dot: SOLID when he played a full match, an empty circle of the same colour otherwise.

        Filled against hollow, rather than an outline around the dot. The outline was a SECOND colour on
        a strip of ten - it had to contrast with the row, so it changed with the theme, and what it read
        as was a grid. Full and empty need no second colour and survive both themes, and the colour goes
        on meaning only one thing: how he played.
        """
        if small:
            x, y = x + 2, y + 2
        mask = SnapshotView.SMALL_MASK if small else (
               "  ####  ",
               " ###### ",
               "########",
               "########",
               "########",
               "########",
               " ###### ",
               "  ####  ")
        # the ring is two pixels thick and the hole four wide: a one-pixel ring around a six-wide hole
        # read as an outline at this size, which is the opposite of what full-against-empty is for
        edge = SnapshotView.SMALL_EDGE if small else (
               "  ####  ",
               " ###### ",
               "##    ##",
               "##    ##",
               "##    ##",
               "##    ##",
               " ###### ",
               "  ####  ")
        for row, line in enumerate(mask):
            for column, pixel in enumerate(line):
                if pixel != "#" or (hollow and edge[row][column] != "#"):
                    continue
                image.put(colour, to=(x + column, y + row, x + column + 1, y + row + 1))

    # ---------- sorting ----------
    # (column id -> the CSV field it reads). The auction order is not a column: it is role first, then
    # predicted surplus, which is what the sheet opens on and what clicking "R" restores.
    SORT_FIELD: ClassVar[dict[str, str]] = {
        "real": "desc_real_role", "mantra": "roles_mantra", "name": "name",
        "surplus": "engine_surplus", "fm": "engine_fm_pred", "pv": "engine_pv_pred",
        "minutes": "desc_expected_minutes", "tit": "desc_season_matches",
        "rating": "desc_form_rating", "bonus": "desc_goals_p90", "inj": "desc_injury_weighted",
        "status": "desc_starter_prob",
    }

    def _sort_by(self, column: str) -> None:
        """Click a heading to sort by it; click it again to reverse. "R" goes back to auction order.

        Empty cells always sink to the bottom, whichever direction is chosen: a missing number is not a
        small one, and floating it to the top of a ranking is how absent data gets mistaken for a result.
        """
        if column == "role":
            self.sort_by, self.sort_desc = None, True
        elif self.sort_by == column:
            self.sort_desc = not self.sort_desc
        else:
            self.sort_by, self.sort_desc = column, True
        self._fill_table()

    def _sorted(self, rows: list[dict]) -> list[dict]:
        if not self.sort_by:
            return rows                                    # already in auction order
        field = self.SORT_FIELD.get(self.sort_by, self.sort_by)
        numeric = any(_is_number(row.get(field)) for row in rows)

        def key(row: dict):
            value = row.get(field)
            missing = value in (None, "")
            if numeric:
                return (missing, -_number(value) if self.sort_desc else _number(value))
            return (missing, str(value or "").lower())

        rows = sorted(rows, key=key)
        if not numeric and self.sort_desc:
            present = [row for row in rows if row.get(field) not in (None, "")]
            absent = [row for row in rows if row.get(field) in (None, "")]
            rows = list(reversed(present)) + absent
        return rows

    def _heading_titles(self) -> None:
        """An arrow on the column being sorted, so the order on screen is never a guess."""
        for key, title, _width, _anchor in self.COLUMNS:
            mark = ""
            if key == self.sort_by:
                mark = " v" if self.sort_desc else " ^"
            elif key == "role" and not self.sort_by:
                mark = " *"
            self.player_tree.heading(key, text=f"{title}{mark}")

    # ---------- club detail ----------
    def _show_club(self) -> None:
        club = self._selected_club()
        if not club:
            return
        info = self.clubs.get(club, {})
        self.club_title.set(club)
        formation, source = self._formation(info, self.xi_mode.get())
        # The lines come from the provider's slots, where a winger counts as a midfielder: a 4-3-3
        # with wingers reads 4-5-1. Said out loud, so nobody reads the shape as the coach's own words.
        label = "prossima giornata" if self.xi_mode.get() == "next" else "modulo tipo"
        bits = [f"{label} {formation} ({source}, provider lines)"]
        bits.append(f"probabili: {info['probabili_date']}" if info.get("probabili_date")
                    else "probabili: NONE (no snapshot yet)")
        typical = info.get("formation_typical")
        if typical and typical != formation:
            bits.append(f"modulo tipo: {typical}")
        if info.get("coach"):
            bits.append(f"coach {info['coach']} since {info.get('coach_since') or '?'}"
                        + (" · NEW" if info.get("new_coach") == "yes" else ""))
        if info.get("elo"):
            bits.append(f"Elo {info['elo']}")
        if info.get("arrivals"):
            bits.append(f"{info['arrivals']} arrivals")
        if info.get("complete_XIs"):
            bits.append(f"lines D{info.get('lines_fielded_D')}/M{info.get('lines_fielded_M')}/"
                        f"F{info.get('lines_fielded_F')} over {info['complete_XIs']} XIs")
        self.club_info.set(" · ".join(bits))

        self.rows = self.squad(club)
        self._fill_table()
        self._draw_pitch()

    # (icon, what it means) per condition, in the order they are drawn. Symbols from the BMP and never
    # emoji: a colour emoji renders as a box in Tk on Windows, which is a flag nobody can read.
    FLAG_ICONS: ClassVar[tuple[tuple[str, str], ...]] = (
        ("\u25cf", "the probabili name him a starter"),
        ("\u25d0", "the probabili have him doubtful"),
        ("\u271a", "an injury spell is open right now"),
        ("\u2716", "suspended"),
        ("\u21c4", "in a ballottaggio for his place"),
        ("\u2605", "he arrived this summer"),
        ("\u231b", "his contract expires within a year"),
        ("?", "no injury history at all was found for him - his inj column is unknown, not zero"),
    )

    def _flags(self, row: dict) -> tuple[str, str]:
        """(the icons, the same thing in words). Two renderings of one list, so the cell can be narrow.

        The words are not decoration: an icon column is unreadable without them, and the tooltip is
        where a fact like "no absence history was found" can be stated instead of hinted at.
        """
        probability = _number(row.get("desc_starter_prob"), None)
        state = row.get("desc_availability_now") or ""
        present = (
            probability is not None and probability >= 0.75,
            probability is not None and probability < 0.75,
            bool(row.get("desc_injury_open")) or state == "injured",
            state == "suspended",
            row.get("desc_duel_rivals") not in (None, "", "0"),
            bool(row.get("desc_arrival")),
            bool(row.get("desc_exit_risk")),
            not row.get("desc_injury_source"),
        )
        icons = "".join(icon for (icon, _why), on in zip(self.FLAG_ICONS, present, strict=True) if on)
        words = []
        for (icon, why), on in zip(self.FLAG_ICONS, present, strict=True):
            if not on:
                continue
            extra = ""
            if icon == "\u25cf" or icon == "\u25d0":
                extra = f" ({probability:.0%})"
            elif icon == "\u271a" and row.get("desc_injury_open"):
                extra = f" - {row['desc_injury_open']}"
            elif icon == "\u2605":
                extra = f" - {row.get('desc_arrival')} {row.get('desc_arrival_tier') or ''}".rstrip()
            elif icon == "\u231b":
                extra = f" - {row.get('desc_contract_until')}"
            words.append(f"{icon}  {why}{extra}")
        return icons, "\n".join(words)

    def _cell_help(self, row_id: str, column: str) -> str:
        """The flags column explains itself per row; every other cell says nothing extra."""
        if column != "status":
            return ""
        index = self.player_tree.index(row_id)
        rows = self._sorted(self.rows)
        return self._flags(rows[index])[1] if index < len(rows) else ""

    def _fill_table(self) -> None:
        self._heading_titles()
        self.player_tree.delete(*self.player_tree.get_children())
        self._sparks = []
        for row in self._sorted(self.rows):
            icons, _words = self._flags(row)
            matches = self.club_matches(row.get("club"))
            # g+a over the FULL real season, from the two per-90 rates and the minutes behind them: a
            # count is what an operator reads, and the rates are what the sheet stores.
            minutes_played = _number(row.get("desc_minutes_full_season"))
            bonus = ((_number(row.get("desc_goals_p90")) + _number(row.get("desc_assists_p90")))
                     * minutes_played / 90.0)
            # expected minutes PER MATCHDAY: the projection where there is one, his own average where
            # there is not - and nothing at all rather than a zero when neither exists
            projected = _number(row.get("desc_expected_minutes"), None)
            per_match = (projected / matches if projected
                         else minutes_played / matches if minutes_played else None)
            presences = _number(row.get("engine_pv_pred"), None)
            fm = _number(row.get("engine_fm_pred"), None)
            # The GRANULAR real role when we have it ('DL/ML' - which line AND which flank), else the
            # old pair: the modal per-match slot plus a sided Mantra role. Strictly more informative,
            # so it takes the column rather than adding a second one to a sheet already 70 wide.
            granular = self.real_roles(row)
            if granular:
                real = "/".join(granular[:2])
            else:
                sided = next((part for part in (row.get("roles_mantra") or "").split(";")
                              if part.strip().lower() in self.SIDE), "")
                real = " ".join(part for part in (row.get("desc_real_role") or "", sided) if part)
            spark = self._sparkline(row.get("desc_form_series"), row.get("desc_form_detail"))
            self._sparks.append(spark)              # Tk drops an image nobody references
            self.player_tree.insert("", "end", image=spark, values=(
                row.get("role_classic") or "?",
                (row.get("roles_mantra") or "").replace(";", "/") or "-", real or "-",
                row.get("name"), row.get("engine_surplus") or "",
                f"{fm:.1f}" if fm is not None else "",
                f"{min(presences / matches, 1):.0%}" if presences is not None else "",
                f"{per_match:.0f}" if per_match else "",
                f"{self.voto_share(row):.0%}" if row.get("desc_season_matches") else "",
                row.get("desc_form_rating") or "", f"{bonus:.0f}" if bonus >= 0.5 else "",
                f"{1 - self.availability(row):.0%}" if row.get("desc_injury_source") else "",
                icons))

    @staticmethod
    def _formation(info: dict, mode: str = "typical") -> tuple[str, str]:
        """(shape, where it comes from), for the mode being shown.

        `typical` - the shape the coach actually uses over a year: the MODE of his complete elevens,
        with the share saying how settled it is. When that share is high the shape is his PREFERRED one
        and nothing else overrides it, which is the point: a single matchday cannot outvote a season.

        `next` - the next match: the probabili's own formation when there is a snapshot, because that is
        the coach's declared choice for THAT game. Without a snapshot it falls back to the preferred
        shape - and where the coach has no preferred shape (he alternates), the fallback says so.
        """
        typical = info.get("formation_typical")
        share = _number(info.get("formation_typical_share"), None)
        settled = info.get("formation_settled") == "yes"
        today = info.get("formation_today")
        if mode == "next" and today:
            return today, "probabili of today"
        if typical:
            basis = info.get("formation_typical_basis") or f"{info.get('formation_typical_of')} XIs"
            detail = (f"preferred - {share:.0%} of {basis}" if settled and share
                      else f"most used, not settled - {share:.0%} of {basis}" if share
                      else "most used")
            return typical, detail
        if today:
            return today, "probabili of today (no complete XI measured)"
        return SnapshotView._derived_formation(info), "rounded mean of the lines fielded"

    @staticmethod
    def _derived_formation(info: dict) -> str:
        """No probabili? Then the module the club ACTUALLY fielded, rounded from the lines it played."""
        lines = [_number(info.get(f"lines_fielded_{key}")) for key in ("D", "M", "F")]
        if not any(lines):
            return "4-3-3"
        counts = [max(1, round(value)) for value in lines]
        while sum(counts) > 10:
            counts[counts.index(max(counts))] -= 1
        while sum(counts) < 10:
            counts[counts.index(min(counts))] += 1
        return "-".join(str(value) for value in counts)

    # Which DRAWN lane a granular role belongs to. Five, not four: the provider counts a trequartista
    # among the forwards and a wing back among the midfielders, so its three lines cannot say 3-4-2-1 -
    # and 3-4-2-1 is what a coach means. The LINE COUNTS still come from the club's measured elevens;
    # this only decides which of them a man is drawn in, which is a question about him and not about
    # the shape.
    LANE_OF_ROLE: ClassVar[dict[str, str]] = {
        "GK": "P",
        "DL": "D", "DC": "D", "DR": "D",
        "DM": "M", "ML": "M", "MC": "M", "MR": "M",
        "AM": "T",
        "LW": "A", "RW": "A", "ST": "A",
    }
    # Where each lane sits down the pitch, with and without a trequartisti line.
    # Where the rows sit down the pitch: as many as the drawn shape has lines, evenly spaced between
    # the keeper and the attack. Fixed tables of fractions drifted from that as soon as a fifth lane
    # appeared, and the request is exactly this - the vertical reads the module's line count.
    LANE_TOP: ClassVar[float] = 0.07
    LANE_BOTTOM: ClassVar[float] = 0.83

    @classmethod
    def lane_of(cls, row: dict) -> str:
        """His lane - P, D, M, T or A - from the granular role, with the listone role as the fallback."""
        codes = cls.real_roles(row)
        lane = cls.LANE_OF_ROLE.get(codes[0], "") if codes else ""
        listone = row.get("role_classic") or "?"
        return lane or ("M" if listone == "C" else listone)

    @classmethod
    def geometry_for(cls, keys: list[str]) -> tuple[tuple[str, float], ...]:
        return tuple((key, cls.LANE_TOP + (cls.LANE_BOTTOM - cls.LANE_TOP) * index / (len(keys) - 1))
                     for index, key in enumerate(keys)) if len(keys) > 1 else ((keys[0], 0.5),)

    def lanes_for(self, eleven: list) -> tuple[dict[str, list], tuple[tuple[str, float], ...], str]:
        """(players per drawn lane, the lane geometry, the shape as drawn).

        The eleven is chosen by LINE - keeper, defence, midfield, attack - and then redrawn by granular
        ROLE: a listone forward whose real role is AM moves to the trequartisti lane, a listone
        midfielder who is really ML stays in midfield. Napoli's measured shape is 3-4-3 and its eleven is
        two trequartisti behind one striker, so the board says 3-4-2-1 while the line counts still say
        3-4-3. Both are true and the caption carries both.
        """
        lanes: dict[str, list] = {}
        for role, starter, rivals in eleven:
            codes = self.real_roles(starter)
            lane = self.LANE_OF_ROLE.get(codes[0] if codes else "", "M" if role == "C" else role)
            lanes.setdefault(lane, []).append((starter, rivals))
        geometry = self.geometry_for([key for key in ("P", "D", "M", "T", "A")
                                      if lanes.get(key)])
        drawn = "-".join(str(len(lanes.get(key, []))) for key, _y in geometry if key != "P")
        return lanes, geometry, drawn

    @classmethod
    def flank(cls, row: dict) -> float:
        """-1 the team's left ... +1 its right, with a code that NAMES a flank overriding the heatmap.

        `lateral` keeps the measured centroid whenever it agrees in sign with the role, which is right
        for how FAR out he stood and wrong for whether he is a full back: Gutierrez reads 'DL' and -0.23,
        and a 0.34 threshold on the measurement alone drew a terzino sinistro in the middle of the
        defence while his own marker said 'Ts'. Where the code names a flank, the code decides.
        """
        codes = cls.real_roles(row)
        named = REAL_ROLE_SIDE.get(codes[0]) if codes else None
        if named is not None:
            # in BOTH directions: 'ST' names the middle of an attack as plainly as 'DL' names the left,
            # and letting a +0.5 season centroid outrank it put the centre-forward on a wing and a
            # second striker in the middle of a front three
            return named
        return cls.lateral(row) or 0.0

    @classmethod
    def sides_of(cls, row: dict) -> set[str]:
        """Every side he can cover, from ALL his granular codes - not just the primary one.

        A 'DC;DL' is a centre back who also plays left back, and that IS in his repertoire; a 'DC' alone
        is not, and asking him to play wide is the thing a coach does last. With no codes at all this
        falls back to the single side `side_of` derives from the Mantra role or the heatmap.
        """
        sides = {("L" if REAL_ROLE_SIDE[code] < -0.34 else
                  "R" if REAL_ROLE_SIDE[code] > 0.34 else "C")
                 for code in cls.real_roles(row) if code in REAL_ROLE_SIDE}
        return sides or {cls.side_of(row)}

    @classmethod
    def side_of(cls, row: dict) -> str:
        """L, C or R - which slot of his line he belongs to."""
        side = cls.lateral(row)
        if side is None or abs(side) < 0.34:
            return "C"
        return "L" if side < 0 else "R"

    def slot_cost(self, row: dict, side: str, lane: str, strikers: int) -> tuple[int, int]:
        """(does he belong on that side, does the role allow that slot) - lower fits better.

        A cost and never a veto: a slot has to be filled by somebody, and an adapted player is a truer
        drawing than an empty flank. What it encodes are the things a coach does not do in a REAL
        formation - a punta centrale plays in the middle of an attack, a side fields one of him, and a
        flank is covered by a flank player (from the other flank if need be) long before a central one.
        """
        mine = self.sides_of(row)
        if side in mine:
            wrong_side = 0        # it is in his repertoire: one of his own codes plays there
        elif side != "C" and mine != {"C"}:
            wrong_side = 1        # a flank player asked to cover the other flank: a coach does this
        elif side != "C":
            wrong_side = 3        # a central onto a wing: hardly ever, unless it is in his codes
        else:
            wrong_side = 2        # a wide player asked to play in the middle
        if "ST" not in self.real_roles(row):
            return wrong_side, 0
        return wrong_side, (2 if lane == "A" and side != "C" else 0) + (4 if strikers >= 2 else 0)

    # What each slot of a line IS, in the module's own terms - the Mantra scheme vocabulary again. A
    # back three is three CENTRE BACKS (a full back may adapt into one of the outer two, which is what
    # `slot_cost` charges him one for); a midfield four is two wide men and two centrals; a front three
    # is two wingers and a centre-forward. Measuring the composition from the candidates instead put a
    # mediano on a flank whenever the squad had no winger, which is a squad fact and not a formation.
    SLOT_SHAPE: ClassVar[dict[tuple[str, int], tuple[str, ...]]] = {
        ("D", 3): ("C", "C", "C"),
        ("D", 4): ("R", "C", "C", "L"),
        ("D", 5): ("R", "C", "C", "C", "L"),
        ("M", 3): ("C", "C", "C"),
        ("M", 4): ("R", "C", "C", "L"),
        ("M", 5): ("R", "C", "C", "C", "L"),
        ("M", 6): ("R", "C", "C", "C", "C", "L"),
        # one or two trequartisti are central by definition (a winger there costs 2 in `slot_cost`);
        # three of them are a wide trio, so the outer two are wingers or wide midfielders
        ("T", 3): ("R", "C", "L"),
        ("A", 3): ("R", "C", "L"),
        ("A", 4): ("R", "C", "C", "L"),
    }

    def slot_shape(self, lane: str, count: int) -> tuple[str, ...]:
        """The sides of a line's slots, right to left. Anything not in the table is all central."""
        return self.SLOT_SHAPE.get((lane, count), tuple("C" * count))

    # A season is 38 matches when the club's own count is unknown, and a man is never assumed to miss
    # more than 60% of it: a bad history is a discount, not a verdict that he will not play.
    SEASON_MATCHES: ClassVar[float] = 38.0
    AVAILABILITY_FLOOR: ClassVar[float] = 0.40
    # Standing: starts weigh more than minutes because the pitch draws who STARTS, and minutes are what
    # tell a 90-minute fixture from a man who comes off at 60. Then, for the next matchday, form leads
    # and standing is the ballast - with RECENT_PRIOR matches' worth of standing mixed into a ten-match
    # window, which is what stops an empty or a dead-rubber window from deciding a side.
    STANDING_WEIGHTS: ClassVar[tuple[float, float]] = (0.65, 0.35)
    FORM_WEIGHT: ClassVar[float] = 0.60
    RECENT_PRIOR: ClassVar[float] = 3.0

    @classmethod
    def availability(cls, row: dict) -> float:
        """The share of a season a man like this one is fit for: 1.0 healthy, less for the injury-prone.

        `desc_injury_weighted` is his matches missed over the last three seasons with snapshot.py's
        recency weights applied, so dividing by their sum reads as "matches missed in a season".

        NO history means 1.0, and that is a deliberate asymmetry: not knowing whether a man gets injured
        is not knowing, and the unknown perimeter (a player with no Transfermarkt id) must not be
        penalised for it. `desc_injury_source` is what separates the two - it says "no absence recorded"
        for a player who was actually looked up.
        """
        if not row.get("desc_injury_source"):
            return 1.0
        per_season = _number(row.get("desc_injury_weighted")) / sum(INJURY_WEIGHTS)
        matches = _number(row.get("desc_season_matches")) or cls.SEASON_MATCHES
        return max(1.0 - per_season / max(matches, 1.0), cls.AVAILABILITY_FLOOR)

    def club_matches(self, club: str | None) -> float:
        """How many matches the club played in the measured season - the denominator of a presence.

        Its own count of fielded elevens, floored by the starts of its busiest player: the two come from
        different sources (parsed line-ups and the provider's season stats), and a denominator smaller
        than its numerator would print a 120% titolare.
        """
        info = self.clubs.get(club or "", {})
        busiest = max((_number(row.get("desc_season_starts")) for row in self.players
                       if row.get("club") == club), default=0.0)
        return max(_number(info.get("complete_XIs")), busiest, 1.0)

    def standing(self, row: dict) -> float:
        """His absolute standing in the side - the blasone - as a share of a season, 0..1.

        The last ten matches certify FORM, not stature: they are ten matches, and a July window is half
        friendlies and rested internationals. So the schieramento tipo is decided here, on a whole season,
        by two measured facts about how much the coach actually used him:

        * HIS START RATE, over the matches he was in CONTENTION for. Not over 38: a man who spent two
          months injured has fewer starts, and dividing by the whole season would read his absence as the
          coach preferring someone else. His expected absences go back into the denominator.
        * HIS SHARE OF THE MINUTES of the full real season. `desc_minutes_full_season` is measured over
          the club's whole real calendar rather than the euro subset, which is why it survives when the
          last-ten window is empty - McTominay rested after the World Cup has no recent match at all and
          2793 minutes behind him. A man who has none recorded is judged on his starts alone: no minutes
          on file is not zero minutes played.

        Neither is a fantacalcio quantity. Surplus, quotation and FVM answer "is he worth buying" and a
        coach does not pick a side by them; minutes and starts are what he did.
        """
        contested = max(self.club_matches(row.get("club"))
                        - _number(row.get("desc_injury_weighted")) / sum(INJURY_WEIGHTS), 1.0)
        starts = min(self.titolarita(row, "season")[1] / contested, 1.0)
        minutes = _number(row.get("desc_minutes_full_season"))
        if not minutes:
            return starts
        by_starts, by_minutes = self.STANDING_WEIGHTS
        return by_starts * starts + by_minutes * min(minutes / (contested * 90.0), 1.0)

    def voto_share(self, row: dict) -> float:
        """The share of the season's matchdays he is expected to get a VOTO in - not to START in.

        The difference is what a fantacalcio squad is actually bought on: a substitute who comes on every
        week scores every week, and `presence` deliberately does not count him. So this reads APPEARANCES
        over the matches he was available for, discounted by `availability` exactly as `presence` is.

        An appearance is taken as a voto, which is the honest limit of the layer: `external_stats` stores
        season totals, so it cannot tell a ten-minute cameo from a full match. The TREND strip can - a
        hollow dot is precisely that - and the two columns are meant to be read together.
        """
        available = max(self.club_matches(row.get("club"))
                        - _number(row.get("desc_injury_weighted")) / sum(INJURY_WEIGHTS), 1.0)
        appearances = min(_number(row.get("desc_season_matches")) / available, 1.0)
        return min(appearances * self.availability(row), 1.0)

    def presence(self, row: dict, horizon: str = "season") -> float:
        """The share of the club's MATCHDAYS he is expected to start in. The one number a shirt carries.

        This is the sentence an operator writes by hand - "Meret 50% in ballottaggio with Milinkovic, Di
        Lorenzo 95%, Anguissa 60%" - and it is a share of the season, not of a duel. The distinction
        matters: normalising over the rivals a slot happens to have left over made Anguissa read 100% off
        14 starts, because by then everyone else in midfield already had a shirt. A share of the matchdays
        cannot do that. Perfect alternation lands both men near 50% with no rival bookkeeping at all, the
        men who are always on the pitch are the only ones near 100% - which is what makes the spine of a
        squad visible at a glance - and an injury-prone first choice lands below a team-mate who is
        available every week, because `availability` discounts him.

        `recent` (the next matchday) leads with FORM and keeps standing as the ballast: who has been
        starting in the club's last ten, shrunk toward his standing by RECENT_PRIOR matches of it. That
        shrinkage is what a July window needs - with nothing measured the number IS his standing, so a
        rested international does not drop out of the eleven for having rested, and three benchings in a
        dead rubber do not unseat a man who started every match that mattered.
        """
        if horizon != "recent":
            return min(self.standing(row) * self.availability(row), 1.0)
        if row.get("desc_starter_prob"):
            # the editors have answered the question for this match; nothing measured beats it
            return _number(row.get("desc_starter_prob"))
        base = self.standing(row)
        rate = ((_number(row.get("desc_form_starts")) + self.RECENT_PRIOR * base)
                / (_number(row.get("desc_form_measured")) + self.RECENT_PRIOR))
        return min(self.FORM_WEIGHT * rate + (1.0 - self.FORM_WEIGHT) * base, 1.0)

    @staticmethod
    def titolarita(row: dict, horizon: str) -> tuple[float, float]:
        """(start share, minutes) - how often he STARTS, and how long he stays on.

        The only criterion for who plays. It is deliberately not the predicted SURPLUS: surplus is a
        fantacalcio valuation, it answers "is he worth buying", and a coach does not pick a side by it.
        `season` is his share over the whole real season (the habit); `recent` is his share of the club's
        last ten (the side as it stands now).
        """
        if horizon == "recent":
            measured = _number(row.get("desc_form_measured"))
            starts = _number(row.get("desc_form_starts"))
            share = starts / measured if measured else 0.0
            return share, _number(row.get("desc_form_minutes"))
        return _number(row.get("desc_start_share")), _number(row.get("desc_season_starts"))

    def eleven(self, club: str, formation: str,
               mode: str = "typical") -> list[tuple[str, dict, list[dict]]]:
        """(role, starter, rivals) per shirt. Two modes, two questions, and neither uses a valuation.

        `typical` - the side he fields when everyone is available: ranked by the season's start share,
        and injuries and suspensions are deliberately IGNORED. A man out today is still the first choice
        of the shape, and pretending otherwise would make the "tipo" eleven a snapshot of this week.

        `next` - the side for the coming match: the probabili's own starters when a snapshot exists,
        ranked by the probability the editors give them; without a snapshot, ranked by who has been
        starting lately. Either way the injured and the suspended are OUT.

        SURPLUS is not consulted in either. It was, in the first version, and it was wrong: the sheet
        would field the most valuable player rather than the one the coach plays.
        """
        squad = self.squad(club)
        if mode == "next" and any(row.get("desc_starter_prob") for row in squad):
            return self._declared(squad)
        # Group by the line he REALLY plays in, not by the listone's role. A 3-4-3's midfield four is
        # two centre mids and two wing backs, and the listone calls those wing backs defenders - so
        # grouping by `role_classic` filled the middle with four central midfielders and left the flanks
        # to nobody. The listone role is the fallback for a player with no granular code.
        by_role: dict[str, list[dict]] = {}
        for row in squad:
            codes = self.real_roles(row)
            line = (self.LANE_OF_ROLE.get(codes[0], "") if codes else "") or                 (row.get("role_classic") or "?")
            # the trequartisti compete for the attacking line: which of the two lanes they are DRAWN in
            # is decided afterwards, by `lanes_for`, and only for the men actually chosen
            by_role.setdefault("A" if line == "T" else "M" if line == "C" else line, []).append(row)
        defenders, midfielders, forwards = self.lines(formation)
        editorial = mode == "next" and any(row.get("desc_starter_prob") for row in squad)
        out: list[tuple[str, dict, list[dict]]] = []
        taken: set[str] = set()          # one shirt per man, across every line
        for role, slots in (("P", 1), ("D", defenders), ("M", midfielders), ("A", forwards)):
            pool = list(by_role.get(role, []))
            if mode == "next":
                # a man who is out cannot play the next match; for the schieramento tipo he can
                pool = [row for row in pool
                        if not row.get("desc_injury_open")
                        and row.get("desc_availability_now") not in ("injured", "suspended")]
            if editorial:
                pool = sorted((row for row in pool if row.get("desc_starter_prob")),
                              key=lambda row: (-_number(row.get("desc_starter_prob")),
                                               -self.titolarita(row, "recent")[0]))
            else:
                horizon = "recent" if mode == "next" else "season"
                # by PRESENCE, the same number the shirt shows: ranking by anything else would draw a
                # starter carrying a percentage below his own alternative's
                pool = sorted(pool, key=lambda row, h=horizon: (-self.presence(row, h),
                                                                -self.titolarita(row, h)[1]))
            # the line's composition, then ONE SHIRT AT A TIME: the best candidate for THAT side
            strikers = 0
            for wanted in self.slot_shape(role, slots):
                # `pool` is already in presence order and the sort is stable, so the slot's own cost
                # (right side first, then whether the role can play there at all) only ever reorders men
                # who are otherwise equal - the flank goes to a full back rather than to a striker, and
                # the best available man still gets the shirt.
                picks = sorted((row for row in pool if row.get("name") not in taken),
                               key=lambda row, w=wanted, s=strikers: self.slot_cost(row, w, role, s))
                if not picks:
                    continue
                starter, *bench = picks
                strikers += 1 if "ST" in self.real_roles(starter) else 0
                # the ranked list spans the whole line, so the alternatives are narrowed back to the men
                # who could really take THIS place (see `can_replace`)
                # his own position first; the other flank only when nobody plays his - which is the
                # order a coach solves it in, and it keeps a switched full back out of a duel that a
                # proper one is already in
                bench = ([row for row in bench if self.can_replace(starter, row)]
                         or [row for row in bench if self.can_replace(starter, row, mirrored=True)])
                taken.add(starter.get("name"))
                # An alternative is whoever else can wear THIS shirt: same side, still unpicked. Two men
                # of equal titolarità in one slot alternate, and `slot_share` then reads 50% - the
                # sentence an auction needs ("50%, in ballottaggio") instead of two 100%s.
                named = [name.strip() for name in (starter.get("desc_duel_names") or "").split(";")
                         if name.strip() and name.strip() not in taken]
                rivals = ([row for row in bench if row.get("name") in named][:2] if named
                          else bench[:2])
                out.append((role, starter, rivals))
        # A rival is by definition NOT in the eleven. Rivals are collected while the shirts are still
        # being handed out, so a man picked for a later slot could turn up as an earlier one's challenger
        # - "Hojlund vs De Bruyne" with both starting - and that also inflates the slot share, by
        # counting a team-mate's claim as competition for a place he is not competing for.
        starters = {row.get("name") for _role, row, _rivals in out}
        return [(role, starter, [rival for rival in rivals if rival.get("name") not in starters])
                for role, starter, rivals in out]

    def _declared(self, squad: list[dict]) -> list[tuple[str, dict, list[dict]]]:
        """The probabili's own eleven: the men the editors name, in the lanes their real roles put them.

        For the coming match this IS the answer - it is the coach's declared side, and no measurement
        beats it. What it must NOT be made to do is fit a formation's line counts: the editors' 3-4-2-1
        calls two full backs wing backs, so demanding six midfielders put a 35%-probability squad player
        on the pitch while a 100% full back sat outside the eleven. The shape follows from the men (see
        `lanes_for`), which is why a declared 3-4-2-1 can draw as 4-4-2 - and both readings are shown.
        """
        listed = sorted((row for row in squad if row.get("desc_starter_prob")),
                        key=lambda row: -_number(row.get("desc_starter_prob")))
        keepers = [row for row in listed if self.lane_of(row) == "P"]
        chosen = keepers[:1] + [row for row in listed if self.lane_of(row) != "P"][:10]
        names = {row.get("name") for row in chosen}
        out: list[tuple[str, dict, list[dict]]] = []
        for starter in chosen:
            lane = self.lane_of(starter)
            # the editors' own ballottaggio first, then whoever they rate next in the same lane
            named = [name.strip() for name in (starter.get("desc_duel_names") or "").split(";")
                     if name.strip() and name.strip() not in names]
            rest = [row for row in listed
                    if row.get("name") not in names and self.lane_of(row) == lane]
            # the editors' named duel is a stated fact and wins; otherwise only a man who could actually
            # take the place counts, so a winger is not offered as the centre-forward's alternative
            rivals = ([row for row in rest if row.get("name") in named][:2]
                      or [row for row in rest if self.can_replace(starter, row)][:1])
            out.append((lane, starter, rivals))
        return out

    # The same position on the OTHER flank. A coach who runs out of right backs plays a left back there
    # and inverts him; he does not play a centre-forward there. So a mirrored flank is a real option and
    # the two are never treated as one: it is the SECOND choice, both when a shirt is handed out
    # (`slot_cost`) and when the alternatives are listed (`can_replace`).
    MIRROR: ClassVar[dict[str, str]] = {"DL": "DR", "DR": "DL", "ML": "MR", "MR": "ML",
                                        "LW": "RW", "RW": "LW"}

    @classmethod
    def can_replace(cls, starter: dict, row: dict, mirrored: bool = False) -> bool:
        """Whether this man could really take that place - the same POSITION, not merely the same line.

        A winger is not a centre-forward. Neres listed as Hojlund's ballottaggio was the listone's 'A'
        talking, and a false duel is worse at an auction than no duel at all: it reads as a risk that is
        not there, and it drags the percentage of a man who has nobody behind him.

        Where both have granular codes they decide, and one shared code is enough - 'RW;AM' and 'AM' do
        compete for the same shirt. Where either has none, the older test stands (same listone role, same
        flank), because that is the whole of what is known about him.
        """
        mine, theirs = set(cls.real_roles(starter)), set(cls.real_roles(row))
        if mirrored:
            mine |= {cls.MIRROR[code] for code in mine if code in cls.MIRROR}
        if mine and theirs:
            return bool(mine & theirs)
        return (row.get("role_classic") == starter.get("role_classic")
                and (cls.side_of(row) == cls.side_of(starter) if not mirrored
                     else cls.side_of(row) != "C" and cls.side_of(starter) != "C"))

    @classmethod
    def real_roles(cls, row: dict) -> list[str]:
        """His granular real roles, in the provider's own order: ['DL', 'ML'].

        Only codes from the enumerated vocabulary survive, so a new one upstream leaves the marker
        neutral instead of placing a man by a code nothing here can read.
        """
        return [code.strip() for code in (row.get("desc_real_roles") or "").upper().split(";")
                if code.strip() in REAL_ROLES]

    @classmethod
    def lateral(cls, row: dict) -> float | None:
        """Where this player stands across the pitch: -1 left ... +1 right, None = wide, side unknown.

        Three sources, strongest first, because they answer the question with decreasing precision:

        1. `desc_side_measured` - where he REALLY stood, from the positional heatmap with its axis
           calibrated on the backs whose role names a side. Measured, so it wins.
        2. `desc_real_roles` - the provider's granular real role. Every one of its twelve codes either
           names a flank (DL/ML/LW left, DR/MR/RW right) or is central, so unlike the listone it never
           leaves the side open. Read from the PRIMARY code, since the provider's list is ordered.
        3. the Mantra roles, which say it for defenders ('dd' right back, 'ds' left back) and not for
           the rest - which is why 'e' and 'w' come back as None and go to the free flanks. Here the
           first entry that NAMES a side wins, because a Mantra role list is an unordered set: Carlos
           Augusto is 'b;ds;e' and reading the first entry put a left back in the middle.
        """
        measured = _number(row.get("desc_side_measured"), None)
        real = cls.real_roles(row)
        stated = REAL_ROLE_SIDE.get(real[0]) if real else None
        # `stated` is 0.0 for a CENTRAL code, and that is deliberately not treated as a claim about the
        # flank: a nominal centre back who spent the season on the left of a back three is exactly the
        # case the measured heatmap gets right and a categorical code cannot express.
        if measured is not None and stated:
            # Both, and the code names a flank: keep the measured value, which also says HOW far out he
            # stood - unless it contradicts the code or reads central. The two agree on 196 of the 219
            # sided players of this sheet (89%); in the other 23 a season centroid smeared a man who
            # was used on both flanks, or in midfield too, into something the code plainly denies. A
            # DL is not a centre back, so where they disagree the code wins.
            same_side = (measured > 0) == (stated > 0)
            return measured if abs(measured) >= 0.1 and same_side else stated
        if measured is not None:
            return measured
        if stated is not None:
            return stated
        roles = [part.strip().lower() for part in (row.get("roles_mantra") or "").split(";")
                 if part.strip()]
        sided = [cls.SIDE[role] for role in roles if role in cls.SIDE]
        if sided:
            return sided[0]
        if any(role in cls.WIDE for role in roles):
            return None
        return 0.0

    @classmethod
    def depth(cls, row: dict) -> float | None:
        """How far up the pitch he stands: 0.0 his own goal ... 1.0 the opponent's. None = unknown.

        This is the axis the listone's four roles cannot resolve at all: a mediano, a mezzala and a
        trequartista are one letter, 'C', and they are three different places on the pitch. Only the
        granular real role answers it, so there is no fallback - without it the line's own order
        stands, which is what the pitch did before.
        """
        real = cls.real_roles(row)
        return REAL_ROLE_DEPTH.get(real[0]) if real else None

    def _lane(self, slots: list[tuple[dict, list[dict]]]) -> list[tuple[dict, list[dict]]]:
        """One line of the formation, in SCREEN order (left to right on the canvas).

        Left and right are the player's, judged facing the opponents' goal - and the pitch is drawn with
        the keeper at the top, so the team attacks DOWNWARDS and its left flank is the viewer's RIGHT.
        Hence the sort is descending: the team's right back is drawn first, at the screen's left. Getting
        this backwards mirrors every full back on the board, which is worse than not placing them at all.

        `lateral` stays team-relative everywhere else; the inversion belongs to the drawing alone.
        """
        known = [(self.lateral(row), row, rivals) for row, rivals in slots]
        unknown = [entry for entry in known if entry[0] is None]
        placed = sorted((entry for entry in known if entry[0] is not None),
                        key=lambda entry: -entry[0])
        for index, entry in enumerate(unknown):
            placed.insert(0 if index % 2 == 0 else len(placed), entry)
        return [(row, rivals) for _side, row, rivals in placed]

    # Where a line's shirts sit ACROSS the pitch, as fractions of the canvas width. A line is a set of
    # POSITIONS and not an even spread: a midfield four with one wide man is three men in the middle and
    # one on the flank, and spreading four evenly drew Lobotka - a mediano - on the touchline, which is a
    # place he never plays. The bands are fixed, so an EMPTY flank stays empty: that a coach's four is
    # lopsided is information, and filling the gap with a central player is a false winger.
    # The team attacks downwards, so its RIGHT is the screen's left (see `_lane`).
    # A line is drawn on evenly spaced slots: same gap between every pair of men, the outermost pair
    # `LINE_MARGIN` from the touchline. Modules-with-a-shape (a narrow back three, wing backs on the
    # line) and pulling a central player inside his slot both moved men off that grid, and a grid that
    # is not a grid reads as scatter - the flank ORDER already says who is wide.
    LINE_MARGIN: ClassVar[float] = 0.11

    # What a marker says, and in which colour. Three readings of the same man, because an auction uses
    # three vocabularies: the MANTRA roles are what a Mantra module has slots for, the CLASSIC role is
    # what you buy him as, and the REAL position is where he actually stands. The families follow the
    # listone's own convention - keeper orange, defence green, midfield blue, attack red - with the wide
    # and creative roles set apart inside their line so a 'w' is not read as a 'pc'.
    MANTRA_COLOUR: ClassVar[dict[str, tuple[str, str]]] = {
        "por": ("#f2a93b", "#20160a"),
        "dc": ("#2e9b52", "#ffffff"), "dd": ("#2e9b52", "#ffffff"), "ds": ("#2e9b52", "#ffffff"),
        "b": ("#57b877", "#12280f"),
        "e": ("#26a69a", "#ffffff"), "m": ("#1f6fb2", "#ffffff"), "c": ("#1f6fb2", "#ffffff"),
        "w": ("#7e57c2", "#ffffff"), "t": ("#7e57c2", "#ffffff"),
        "a": ("#d1443c", "#ffffff"), "pc": ("#d1443c", "#ffffff"),
    }
    CLASSIC_COLOUR: ClassVar[dict[str, tuple[str, str]]] = {
        "P": ("#f2a93b", "#20160a"), "D": ("#2e9b52", "#ffffff"),
        "C": ("#1f6fb2", "#ffffff"), "A": ("#d1443c", "#ffffff"),
    }

    def _placed(self, slots: list[tuple[dict, list[dict]]],
                lane: str = "M") -> list[tuple[float, dict, list[dict]]]:
        """[(fraction of the width, starter, rivals)] for one line, left to right on the screen.

        THE MODULE FIRST. A line of N is drawn on the N evenly spaced slots a formation diagram uses, so
        a 3-4-3 looks like a 3-4-3 - which three fixed side-bands did not: two left midfielders shared
        0.22 of the width, 34px apart, while the right flank sat empty and the whole line read as a
        crowd. Who gets which slot is decided by FLANK, the widest man to the outside (and among equals
        the one who plays most, so a 3-man attack puts the first-choice striker in the middle).

        Then each man is pulled toward the centre in proportion to how CENTRAL he really is: a right back
        stays on the touchline, a mediano handed the outside slot of a lopsided line is drawn tucked
        inside it. That is the compromise between the two true statements - the shape is the coach's, and
        Lobotka does not play on the wing - and the empty flank still reads as a gap.
        """
        # Flank first, then the WIDEST man of a flank to the outside, then who plays most. Each of those
        # three is a mistake this made: a marginally wide striker took the middle of a three-man attack
        # off the centre-forward (who then read as the seconda punta), and a left back was drawn inside a
        # left midfielder because he had fewer starts.
        def order(entry):
            side = self.flank(entry[0])
            bucket = 1 if side > 0.34 else -1 if side < -0.34 else 0
            # the widest man of a flank goes OUTSIDE, and outside is a different direction on each
            # flank: the drawn order runs from the team's right to its left, so on the right the widest
            # comes first and on the left it comes last
            return -bucket, -abs(side) * bucket, -self.presence(entry[0], "season")

        entries = sorted(slots, key=order)
        count = len(entries)
        span = 1 - 2 * self.LINE_MARGIN
        out: list[tuple[float, dict, list[dict]]] = []
        for index, (starter, rivals) in enumerate(entries):
            out.append((self.LINE_MARGIN + span * index / (count - 1) if count > 1 else 0.5,
                        starter, rivals))
        return out

    @staticmethod
    def lines(formation: str) -> tuple[int, int, int]:
        """'3-5-2' -> (3, 5, 2) · '3-4-2-1' -> (3, 6, 1). Every part counts.

        A four-part module is read by taking the first as the defence, the LAST as the attack and summing
        everything between: in the P/D/C/A vocabulary a 3-4-2-1 fields six midfielders. Reading only the
        first three parts left ten men on the pitch, which is how this was found.
        """
        try:
            parts = [int(part) for part in str(formation).split("-") if part.strip()]
        except (ValueError, TypeError):
            parts = []
        if len(parts) < 2 or sum(parts) != 10:
            return 4, 3, 3
        return parts[0], sum(parts[1:-1]), parts[-1]

    @classmethod
    def badge(cls, row: dict, drawn_side: float | None = None) -> str:
        """The role code for the marker: 'Ts', 'Td', 'Dc', 'Ed'...

        Three inputs, in this order: the granular REAL role, which names both the line and the flank on
        its own ('DL' is a terzino sinistro and nothing else); then the Mantra role, which often names
        the flank; then, when neither does, WHERE the player is drawn in his line - so a winger the
        sheet places on the left reads 'Es' and not a shrug. Nothing is invented: with none of them,
        the code stays neutral.
        """
        side = cls.lateral(row)
        if side is None:
            side = drawn_side
        index = 1 if side is None or abs(side) < 0.34 else (0 if side < 0 else 2)
        real = cls.real_roles(row)
        if real:
            return cls.BADGE_REAL[real[0]]
        roles = [part.strip().lower() for part in (row.get("roles_mantra") or "").split(";")
                 if part.strip()]
        for role in roles:
            if role in cls.BADGE:
                return cls.BADGE[role][index]
        classic = (row.get("role_classic") or "").upper()
        return cls.BADGE_CLASSIC.get(classic, ("?", "?", "?"))[index]

    # Every marker looks the same on purpose. Three tiers of disc (white for a fondamentale, dimmed for a
    # ballottaggio) shipped here for a while and were redundant: the percentage is written under the name
    # on the same shirt, so the colour said a second time what the number already says - and two encodings
    # of one quantity are two things to read instead of one.

    def _line_codes(self, placed: list[tuple[float, dict, list[dict]]]) -> list[str]:
        """The code on each marker of one line, with only ONE centre-forward among them.

        A real side fields one punta centrale; a second adapts as a seconda punta and reads 'Sp', which is
        what he is actually asked to do. The shirt stays with the striker drawn most centrally - and
        "most centrally" is read off the REAL fractions `_placed` produced, not off an even spread: while
        it was computed from the index, Hojlund at 0.61 read as less central than a second striker at
        0.50 and the true centre-forward was labelled the seconda punta.
        """
        codes = [self.badge(starter, -(spread - 0.5) * 2) for spread, starter, _rivals in placed]
        centre = [index for index, code in enumerate(codes) if code == "Pc"]
        if len(centre) > 1 and len(placed) > 2:
            # A front three has no seconda punta: the man who is not the centre-forward is playing wide,
            # so he reads as the wing he is drawn on. 'Sp' belongs to a two-man attack (4-4-2, 5-3-2).
            keep = min(centre, key=lambda index: abs(placed[index][0] - 0.5))
            for index in centre:
                if index != keep:
                    codes[index] = "As" if placed[index][0] > 0.5 else "Ad"
            return codes
        if len(centre) > 1:
            # by ROLE, not by where he ended up drawn: with two strikers and three slots one of them has
            # to take a wide one, and it is the wider man who does - so reading the shirt off the drawn x
            # handed 'Pc' to the striker who plays off the flank and called the centre-forward the
            # seconda punta. The most central role keeps it, and among equals the man who plays most.
            keep = min(centre, key=lambda index: (abs(self.flank(placed[index][1])),
                                                  abs(placed[index][0] - 0.5),
                                                  -self.presence(placed[index][1], "season")))
            for index in centre:
                if index != keep:
                    codes[index] = "Sp"
        return codes

    def _shirt(self, x: float, y: float, starter: dict, rivals: list[dict],
               drawn_side: float | None = None, room: float = 100.0, code: str = "",
               above: bool = False) -> None:
        """One shirt: the role marker, and the name under it - or ABOVE it, when the line is crowded.

        Stacked rather than side by side, because a plate to the right of the disc needs the width of a
        name for every player in the line - which a five-man midfield does not have on a column-shaped
        pitch, and which is how the layout broke. `room` is the horizontal space this shirt owns; every
        string is cut to it, so the drawing cannot overflow the pitch whatever the formation.

        `above` alternates the plates of a crowded line. Three central midfielders stand ~45px apart and a
        name needs twice that: staggered vertically they can each be twice as wide without colliding,
        which is what lets a shirt keep its real position instead of being spread out for legibility.
        """
        canvas = self.pitch
        edge = canvas.winfo_width() if canvas.winfo_width() > 1 else (canvas.winfo_reqwidth() or 430)
        # 7.2 px per character, measured on the theme's bold face - 6 was optimistic and the names ran
        # past their plates and off the pitch
        fits = max(5, int((room - 8) / 7.2))
        # the share of the matchdays he plays: the whole statement about how firmly the shirt is his, in
        # one number, under his name
        horizon = "recent" if self.xi_mode.get() == "next" else "season"
        share = self.presence(starter, horizon)
        # TWO lines at most, and the percentage shares the first with the name. Three lines of plate
        # (name, share, rivals) made a 40px block, and with a plate above one marker and below the one in
        # the lane before it that is 108px of stack for 90px of pitch between two lines - which is what
        # "the layout is broken" looked like. One rival is named, not two: the second is in the table.
        share_text = f" {share:.0%}" if share else ""
        name = (starter.get("name") or "")[:max(5, fits - len(share_text))]
        lines = [(f"{name}{share_text}", theme.FONTS["strong"], "#ffffff")]
        if rivals:
            rival = (rivals[0].get("name") or "")[:max(4, fits - 3)]
            lines.append((f"vs {rival}", theme.FONTS["small"], "#ffe082"))

        radius = 12
        mode = self.role_mode.get()
        if mode == "mantra":
            pills = [(part.strip().upper(), *self.MANTRA_COLOUR.get(part.strip().lower(),
                                                                    ("#546e7a", "#ffffff")))
                     for part in (starter.get("roles_mantra") or "").split(";")[:3] if part.strip()]
        elif mode == "classic":
            role = (starter.get("role_classic") or "?").upper()
            pills = [(role, *self.CLASSIC_COLOUR.get(role, ("#546e7a", "#ffffff")))]
        else:
            pills = []
        if pills:
            # one pill per role, in a row centred on the slot: a Mantra player is two or three roles and
            # a single disc cannot say which, which is the whole reason the selector exists
            # Round, white-ringed, and sized to the room this shirt owns: three roles side by side are
            # wider than a crowded line has, so the third is dropped before the discs are shrunk to
            # unreadable. The ring is what keeps a coloured disc legible on the grass.
            shown = pills if room >= 74 else pills[:2]
            size = max(15.0, min(22.0, (min(room, 76.0) - 3 * (len(shown) - 1)) / len(shown)))
            left = x - (size * len(shown) + 3 * (len(shown) - 1)) / 2
            for label, fill, ink in shown:
                canvas.create_oval(left, y - size / 2, left + size, y + size / 2,
                                   fill=fill, outline="#ffffff", width=2)
                canvas.create_text(left + size / 2, y, fill=ink, font=theme.FONTS["pill"], text=label)
                left += size + 3
        else:
            code = code or self.badge(starter, drawn_side)
            canvas.create_oval(x - radius, y - radius, x + radius, y + radius,
                               fill="#12351a", outline="#f4f6f5", width=2)
            canvas.create_text(x, y, fill="#ffffff", font=theme.FONTS["pill"], text=code)

        widest = max(len(part) for part, _font, _fill in lines)
        plate = min(room, 8 + widest * 7.2)
        # a shirt near the touchline slides inwards rather than hanging over it
        x = min(max(x, 4 + plate / 2), edge - 4 - plate / 2)
        high = 3 + len(lines) * 13
        top = y - radius - 3 - high if above else y + radius + 3
        canvas.create_rectangle(x - plate / 2, top, x + plate / 2, top + high,
                                fill="#12351a", outline="#4c7a35", width=1)
        for index, (part, font, fill) in enumerate(lines):
            canvas.create_text(x, top + 9 + index * 13, fill=fill, font=font, text=part)

    def _draw_pitch(self) -> None:
        """The eleven on a VERTICAL pitch: keeper at the TOP, attack at the bottom.

        Vertical because the pitch shares the row with the squad list, and a tall column is the shape a
        formation is normally drawn in. Across the width the players sit at their real lateral position,
        so the left-backs are on the left even in a Classic auction (see `lateral`).

        Which side is "left" is stated on the pitch itself rather than left to the reader: with the
        keeper at the top the eleven is seen FROM THE OPPOSING GOAL, and in that view the team's left is
        the viewer's left. Read the other way round - from behind your own goal - it would be mirrored,
        and for choosing between two right-backs an unstated convention is worse than either choice.
        """
        canvas = self.pitch
        canvas.delete("all")
        canvas.configure(background=theme.color("surface"))
        # The REAL size - drawing to an inflated height put the forwards' plates off the bottom edge.
        # Before the widget is mapped `winfo_width` is 1, so the REQUESTED size answers instead: that is
        # what the canvas was configured with, and it keeps the drawing consistent with the space it
        # will get rather than with a constant.
        width = canvas.winfo_width() if canvas.winfo_width() > 1 else (canvas.winfo_reqwidth() or 430)
        height = (canvas.winfo_height() if canvas.winfo_height() > 1
                  else (canvas.winfo_reqheight() or 470))
        line = "#e8f5e9"
        stripe = max(34, height // 10)
        canvas.create_rectangle(0, 0, width, height, fill="#2f7d32", outline="")
        for index in range(0, height, stripe):
            if (index // stripe) % 2 == 0:
                canvas.create_rectangle(0, index, width, min(index + stripe, height),
                                        fill="#37913a", outline="")
        canvas.create_rectangle(6, 6, width - 6, height - 6, outline=line, width=2)
        canvas.create_line(6, height // 2, width - 6, height // 2, fill=line, width=2)
        canvas.create_oval(width // 2 - 40, height // 2 - 40, width // 2 + 40, height // 2 + 40,
                           outline=line, width=2)
        box = min(150, width // 3)
        canvas.create_rectangle(width // 2 - box, height - 6, width // 2 + box, height - 60,
                                outline=line, width=2)
        canvas.create_rectangle(width // 2 - box, 6, width // 2 + box, 60, outline=line, width=2)
        club = self._selected_club()
        if not club:
            return
        info = self.clubs.get(club, {})
        mode = self.xi_mode.get()
        formation, _source = self._formation(info, mode)
        eleven = self.eleven(club, formation, mode)
        if not eleven:
            canvas.create_text(width // 2, height // 2, fill=line, font=theme.FONTS["strong"],
                               text="no players in this club's sheet")
            return
        lanes, geometry, drawn = self.lanes_for(eleven)
        # top to bottom: keeper, defence, midfield, attack. The keeper sits high enough for his plate,
        # the attack low enough for theirs: a lane at 0.92 would draw the names off the pitch.
        for role, fraction in geometry:
            slots = self._lane(lanes.get(role, []))
            if not slots:
                continue
            placed = self._placed(slots, role)
            codes = self._line_codes(placed)
            # How much width a shirt owns: the distance to its nearest neighbour, since the shirts are no
            # longer evenly spaced. Three men crowded into the centre band leave ~45px each, which is not
            # a name - so a crowded line ALTERNATES its plates above and below the marker, and each one
            # may then be as wide as two gaps.
            gaps = [min((abs(placed[here][0] - placed[other][0])
                         for other in range(len(placed)) if other != here), default=1.0) * width
                    for here in range(len(placed))]
            crowded = min(gaps) < 92
            for index, (spread, starter, rivals) in enumerate(placed):
                x = width * spread
                # and never wider than twice the distance to the nearest touchline: a plate that has to
                # be clamped inwards eats the clearance of the shirt two slots away, which is how two
                # same-parity plates of a five-man line came to overlap
                room = min(150.0, max(gaps[index] * (2 if crowded else 1) - 10, 40.0),
                           2 * min(x, width - x) - 8)
                # One row per line, and every man of a line on it: the depth nudge that used to move
                # a mediano forward and a trequartista back inside his own lane is what made the rows
                # look ragged, and the lane a man is drawn in already says how far up he plays.
                y = height * fraction
                # the TEAM-relative side of where he is drawn, on the same -1..+1 scale `lateral` uses:
                # it names the flank for a role that does not (a winger placed there reads 'Es' or 'Ed').
                # Negated, because the screen is mirrored with respect to the team facing downwards.
                self._shirt(x, y, starter, rivals, drawn_side=-(spread - 0.5) * 2, room=room,
                            code=codes[index], above=crowded and index % 2 == 1)
        editorial = mode == "next" and any(row.get("desc_starter_prob")
                                           for _role, row, _rivals in eleven)
        if mode == "next":
            criterion = "probabili" if editorial else "recent starts (no probabili)"
        else:
            criterion = "% matchdays started"
        # Two short lines: one caption wide enough to say all of it ran off both touchlines. The
        # viewpoint stays in the column's tooltip, where there is room for the sentence.
        shown = f"{drawn} · XI by {criterion}"
        if drawn != formation:
            # both are true and they answer different questions: the lines are what the club measured,
            # the drawn shape is where these eleven men actually stand
            shown = f"{drawn} (lines {formation}) · {criterion}"
        canvas.create_text(width // 2, height - 26, fill=line, font=theme.FONTS["small"],
                           text=shown[:62])
        # With the disc legend gone the line goes back to the viewpoint, which is the one thing about
        # this drawing that cannot be guessed from it. Kept short: a caption wide enough to say more ran
        # off both touchlines, and the drawing has to stay inside the canvas whatever the formation.
        canvas.create_text(width // 2, height - 12, fill=line, font=theme.FONTS["small"],
                           text="attacking downwards: the team's LEFT is on your right")


def _read_csv(path) -> list[dict]:
    import csv

    try:
        with open(path, encoding="utf-8-sig", newline="") as handle:
            return list(csv.DictReader(handle))
    except OSError:
        return []


def _read_json(path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _blend(colour: str, background: str, alpha: float) -> str:
    """`colour` at `alpha` over `background`. Tk canvases and images have no alpha channel, so the
    fading in the last-10 strip is done by mixing the two colours here."""
    def parts(value: str) -> tuple[int, int, int]:
        value = value.lstrip("#")
        return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)

    front, back = parts(colour), parts(background)
    mixed = [round(front[index] * alpha + back[index] * (1 - alpha)) for index in range(3)]
    return "#" + "".join(f"{value:02x}" for value in mixed)


def _is_number(value) -> bool:
    try:
        float(value)
    except (TypeError, ValueError):
        return False
    return True


def _number(value, default: float | None = 0.0) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class ToolkitGUI:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.config = Config()
        self.log_queue: queue.Queue = queue.Queue()
        self.busy = False
        self._running: str | None = None
        self._cancel_event = threading.Event()

        root.title(f"euroleghe-ingest · operator panel v{__version__}")
        root.geometry("1180x780")
        root.minsize(900, 660)   # the operation cards + the status bar need this much height
        self._theme_mode = self._load_prefs().get("theme", "light")
        theme.apply_theme(root, self._theme_mode)
        try:
            self._app_icon = make_app_icon()           # keep a reference (Tk needs it alive)
            root.iconphoto(True, self._app_icon)
        except tk.TclError:
            pass  # the icon is cosmetic; never block startup over it

        shell = ttk.Frame(root, padding=(12, 10, 12, 0))
        shell.pack(fill="both", expand=True)
        self._build_header(shell)

        notebook = self.notebook = ttk.Notebook(shell)
        notebook.pack(fill="both", expand=True, pady=(10, 0))

        ops_tab = ttk.Frame(notebook)
        notebook.add(ops_tab, text="  Operations  ")
        self._build_operations_tab(ops_tab)

        self.players = PlayersView(notebook, self.config)
        notebook.add(self.players, text="  Players  ")

        self.auction = AuctionView(notebook, self.config)
        notebook.add(self.auction, text="  Auction  ")

        self.snapshot = SnapshotView(notebook, self.config,
                                     on_build=self._build_snapshot)
        notebook.add(self.snapshot, text="  Snapshot  ")

        self._build_status_bar(root)
        self.refresh_status()
        self.refresh_operation_states()
        self.players.reload()
        self.auction.reload()
        self.snapshot.reload()
        self.root.after(100, self._drain_log)

    # ---------- preferences (theme only, so a restart looks like the last session) ----------
    def _prefs_path(self):
        return self.config.data_dir / "reports" / "ui-prefs.json"

    def _load_prefs(self) -> dict:
        try:
            return json.loads(self._prefs_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _save_prefs(self, **values) -> None:
        prefs = {**self._load_prefs(), **values}
        with contextlib.suppress(OSError):
            self._prefs_path().parent.mkdir(parents=True, exist_ok=True)
            self._prefs_path().write_text(json.dumps(prefs, indent=2), encoding="utf-8")

    def _toggle_theme(self) -> None:
        """Light <-> dark. Re-styles in place and asks the canvas views to redraw themselves."""
        self._theme_mode = "dark" if self._theme_mode == "light" else "light"
        theme.apply_theme(self.root, self._theme_mode)
        self._save_prefs(theme=self._theme_mode)
        self.theme_button.configure(text="☾  Dark" if self._theme_mode == "light" else "☀  Light")
        self._restyle_log()
        self.refresh_operation_states()
        with contextlib.suppress(Exception):
            self.players.reload()
            self.auction.reload()
            # The TREND strips are IMAGES: their background was baked in when they were drawn, so a
            # theme switch left white plates on a dark table until they are redrawn.
            self.snapshot.restyle()

    # ---------- header ----------
    def _build_header(self, parent: tk.Widget) -> None:
        bar = ttk.Frame(parent, style="Card.TFrame", padding=(14, 10))
        bar.pack(fill="x")
        left = ttk.Frame(bar, style="Card.TFrame")
        left.pack(side="left", fill="x", expand=True)
        title = ttk.Frame(left, style="Card.TFrame")
        title.pack(anchor="w")
        ttk.Label(title, text="⚽", style="Icon.TLabel").pack(side="left", padx=(0, 8))
        ttk.Label(title, text="euroleghe-ingest", style="H1.TLabel").pack(side="left")
        ttk.Label(title, text=f"v{__version__}", style="CardMuted.TLabel").pack(side="left",
                                                                               padx=(8, 0))
        self.db_var = tk.StringVar()
        ttk.Label(left, textvariable=self.db_var, style="CardMuted.TLabel").pack(anchor="w",
                                                                                pady=(2, 0))

        actions = ttk.Frame(bar, style="Card.TFrame")
        actions.pack(side="right")
        self.theme_button = ttk.Button(
            actions, text="☾  Dark" if self._theme_mode == "light" else "☀  Light", width=10,
            command=self._toggle_theme)
        self.theme_button.pack(side="left", padx=(0, 6))
        ttk.Button(actions, text="↻  Refresh", command=self._refresh_all).pack(side="left",
                                                                              padx=(0, 6))
        self.stop_button = ttk.Button(actions, text="■  Stop", style="Danger.TButton",
                                      command=self._request_stop, state="disabled")
        self.stop_button.pack(side="left")

    # ---------- status bar ----------
    def _build_status_bar(self, parent: tk.Widget) -> None:
        bar = ttk.Frame(parent, style="Card.TFrame", padding=(14, 6))
        bar.pack(fill="x", side="bottom")
        self.activity_var = tk.StringVar(value="idle")
        ttk.Label(bar, textvariable=self.activity_var, style="Card.TLabel").pack(side="left")
        self.progress = ttk.Progressbar(bar, mode="indeterminate", length=180)
        self.progress.pack(side="right")
        self.last_run_var = tk.StringVar()
        ttk.Label(bar, textvariable=self.last_run_var, style="CardMuted.TLabel").pack(
            side="right", padx=(0, 14))

    # ---------- operations tab layout ----------
    def _build_operations_tab(self, parent: tk.Widget) -> None:
        """Two columns: the operations as cards on the left, what the DB contains on the right.

        The cadence groups become cards because that is the question an operator actually asks -
        "what do I run today?" - and a flat list of nineteen buttons never answered it. Each row
        carries the state dot, the operation's glyph and its name, in that order: state first,
        because a green row needs no reading at all.
        """
        main = ttk.Frame(parent, padding=(0, 12, 0, 0))
        main.pack(fill="both", expand=True)

        left = ttk.Frame(main)
        left.pack(side="left", fill="y")
        self.buttons: list[ttk.Button] = []
        self.dots: list[tk.Label] = []
        self.op_commands: list[str] = []
        # TWO columns, balanced by row count. With four cadence groups and twenty-one operations one
        # column no longer fits the window, and an operator panel whose buttons are below the fold is
        # a panel that hides half of what it can do. Balanced rather than 2+2 so the columns end level.
        columns = (ttk.Frame(left), ttk.Frame(left))
        columns[0].pack(side="left", fill="y", padx=(0, 8))
        columns[1].pack(side="left", fill="y")
        rows_per_group = [1 + len(commands) for _group, commands in OPERATION_GROUPS]
        half = sum(rows_per_group) / 2
        running = 0
        for index, (group, commands) in enumerate(OPERATION_GROUPS):
            side = 0 if running < half else 1
            running += rows_per_group[index]
            card = ttk.Frame(columns[side], style="Card.TFrame", padding=(10, 8))
            card.pack(fill="x", pady=(0, 8))
            head = ttk.Frame(card, style="Card.TFrame")
            head.pack(fill="x", pady=(0, 4))
            ttk.Label(head, text=group.upper(), style="CardMuted.TLabel").pack(side="left")
            for command in commands:
                row = ttk.Frame(card, style="Card.TFrame")
                row.pack(fill="x")
                dot = tk.Label(row, text="○", width=2, font=theme.FONTS["body"],
                               background=theme.color("surface"))
                dot.pack(side="left")
                btn = ttk.Button(row, style="Op.TButton", width=26,
                                 text=f"{theme.icon(command)}   {operation_label(command)}",
                                 command=lambda c=command: self.run_operation(c))
                btn.pack(side="left", fill="x", expand=True)
                Tooltip(btn, lambda c=command: self._tooltip_for(c))
                self.buttons.append(btn)
                self.dots.append(dot)
                self.op_commands.append(command)

        legend = ttk.Frame(columns[1])
        legend.pack(anchor="w", pady=(2, 0))
        self._legend_dots: list[tuple[tk.Label, str]] = []
        for state in ("completed", "todo", "unavailable"):
            glyph, colour = state_style(state)
            mark = tk.Label(legend, text=glyph, foreground=colour, font=theme.FONTS["small"],
                            background=theme.color("bg"))
            mark.pack(side="left")
            tk.Label(legend, text=f" {state}   ", foreground=theme.color("text_faint"),
                     background=theme.color("bg"), font=theme.FONTS["small"]).pack(side="left")
            self._legend_dots.append((mark, state))

        right = ttk.Frame(main)
        right.pack(side="left", fill="both", expand=True, padx=(12, 0))

        # Metric strip: how much of the database exists, in the four numbers that matter.
        strip = ttk.Frame(right)
        strip.pack(fill="x")
        self.metrics: dict[str, tk.StringVar] = {}
        for key, label in (("tables", "tables"), ("players", "players"), ("ratings", "votes"),
                           ("matches", "match rows")):
            cell = ttk.Frame(strip, style="Card.TFrame", padding=(12, 8))
            cell.pack(side="left", fill="x", expand=True, padx=(0, 8))
            var = tk.StringVar(value="—")
            ttk.Label(cell, textvariable=var, style="Metric.TLabel").pack(anchor="w")
            ttk.Label(cell, text=label, style="CardMuted.TLabel").pack(anchor="w")
            self.metrics[key] = var

        detail = ttk.Frame(right, style="Card.TFrame", padding=(12, 10))
        detail.pack(fill="x", pady=(8, 0))
        self.status_var = tk.StringVar(value="...")
        ttk.Label(detail, textvariable=self.status_var, style="CardMuted.TLabel", justify="left",
                  wraplength=620).pack(anchor="w")

        log_card = ttk.Frame(right, style="Card.TFrame", padding=(12, 10))
        log_card.pack(fill="both", expand=True, pady=(8, 0))
        log_head = ttk.Frame(log_card, style="Card.TFrame")
        log_head.pack(fill="x", pady=(0, 6))
        ttk.Label(log_head, text="LOG", style="CardMuted.TLabel").pack(side="left")
        ttk.Button(log_head, text="copy", width=6,
                   command=self._copy_log).pack(side="right", padx=(6, 0))
        ttk.Button(log_head, text="clear", width=6, command=self._clear_log).pack(side="right")
        self.log = scrolledtext.ScrolledText(log_card, height=16, state="disabled", wrap="word",
                                             relief="flat", borderwidth=0)
        self.log.pack(fill="both", expand=True)
        self._restyle_log()

    # ---------- log ----------
    def _restyle_log(self) -> None:
        """Colours for the log, re-applied on a theme switch. Severity is read from what modules print."""
        self.log.configure(background=theme.color("surface_sunken"), foreground=theme.color("text"),
                           insertbackground=theme.color("text"), font=theme.FONTS["mono"],
                           selectbackground=theme.color("selection"))
        for tag, key, _needles in theme.LOG_TAGS:
            self.log.tag_configure(tag, foreground=theme.color(key))
        self.log.tag_configure("head", font=theme.FONTS["strong"])

    def _line_tag(self, text: str) -> str | None:
        for tag, _key, needles in theme.LOG_TAGS:
            if any(needle in text for needle in needles):
                return tag
        return None

    def _copy_log(self) -> None:
        self.root.clipboard_clear()
        self.root.clipboard_append(self.log.get("1.0", "end"))

    def _clear_log(self) -> None:
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

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
            # `export` writes files, not rows: count the bundles on disk under the same key space, so
            # `operation_state` stays a pure function of one dict.
            export_dir = self.config.data_dir / "export"
            counts["_export_bundle"] = len(list(export_dir.glob("*/manifest.json")))                 if export_dir.exists() else 0
            today = dt.datetime.now(tz=dt.UTC).date().isoformat()
            reports = self.config.data_dir / "reports"
            counts["_snapshot_today"] = len(list(reports.glob(f"auction-snapshot-*-{today}/manifest.json")))                 if reports.exists() else 0
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
        surface = theme.color("surface")
        for command, dot, btn in zip(self.op_commands, self.dots, self.buttons, strict=False):
            state = operation_state(command, counts, has_sources)
            glyph, colour = state_style(state)
            dot.configure(text=glyph, foreground=colour, background=surface)
            btn.configure(state="disabled" if state == "unavailable" else "normal")
        for mark, state in getattr(self, "_legend_dots", []):
            glyph, colour = state_style(state)
            mark.configure(text=glyph, foreground=colour, background=theme.color("bg"))

    def _tooltip_for(self, command: str) -> str:
        desc = TOOLTIPS.get(command, command)
        return f"{desc}\n\n— {STATE_LABEL[self._current_status(command)]}"

    # ---------- DB status panel ----------
    def _last_run(self) -> str:
        """The provenance line: which module ran last, when, and how it ended (`ingest_runs`)."""
        db = self.config.db_path
        if not db.exists():
            return ""
        conn = connect(db)
        try:
            row = conn.execute("SELECT module, started_at, status FROM ingest_runs "
                               "ORDER BY started_at DESC LIMIT 1").fetchone()
        except sqlite3.Error:
            return ""
        finally:
            conn.close()
        if not row:
            return "no run recorded yet"
        module, started_at, status = row
        return f"last run: {module} · {started_at.replace('T', ' ')[:16]} · {status}"

    def refresh_status(self) -> None:
        db = self.config.db_path
        self.db_var.set(f"⛁  {db}")
        if not db.exists():
            self.status_var.set("The database does not exist yet. 'Initialize DB' creates it empty; "
                                "'Bootstrap' builds everything from the network (see `bootstrap "
                                "--plan` for the order and the cost).")
            for var in self.metrics.values():
                var.set("—")
            self.last_run_var.set("")
            return
        counts = self._db_counts() or {}
        # Drop the pseudo-keys: a column counter ("table.column") and the on-disk bundle count
        # ("_export_bundle") are state for `operation_state`, not tables of the database.
        tables = {name: n for name, n in counts.items()
                  if "." not in name and not name.startswith("_")}
        self.metrics["tables"].set(f"{sum(1 for n in tables.values() if n)}/{len(tables)}")
        self.metrics["players"].set(f"{counts.get('players', 0):,}")
        self.metrics["ratings"].set(f"{counts.get('match_ratings', 0):,}")
        self.metrics["matches"].set(f"{counts.get('external_match_stats', 0):,}")
        empty = sorted(name for name, n in tables.items() if not n)
        populated = ", ".join(f"{name} {n:,}" for name, n in sorted(tables.items()) if n)
        note = f"\n\nEmpty: {', '.join(empty)}" if empty else ""
        self.status_var.set(f"{populated}{note}")
        self.last_run_var.set(self._last_run())

    def _refresh_all(self) -> None:
        self.refresh_status()
        self.refresh_operation_states()
        self.players.reload()
        with contextlib.suppress(Exception):
            self.snapshot.reload()

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
                     values=["season", "match", "complete", "heatmap", "roles", "all", "reparse",
                             "crosstab", "extra"]).grid(row=0, column=1, pady=4)
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
        ttk.Label(frm, textvariable=hint, style="Muted.TLabel", wraplength=330,
                  justify="left").grid(row=4, column=0, columnspan=2, sticky="w", pady=(6, 0))

        def describe(*_args) -> None:
            hint.set({
                "season": "Season facts (goals, assists, minutes, xG/xA) -> external_stats. "
                          "Fast: about 6 requests per league-season.",
                "match": "Per-match ratings of the perimeter clubs -> external_match_stats. This is "
                         "what fills the SYNTHETIC matchdays. Hours for everything; resumable, and "
                         "'Stop' keeps whatever landed. Run 'matchdays' and 'synth' afterwards.",
                "complete": "Adds the matches the perimeter filter skipped (non-perimeter vs "
                            "non-perimeter), which is what removes the 'hardest half' bias.",
                "heatmap": "Average pitch position (avg_x/avg_y) -> positions. One request per "
                           "player-season, roughly an hour per season; resumable.",
                "roles": "The GRANULAR real role (DL/DC/DR, ML/MC/MR, LW/RW, ST...) and the preferred "
                         "foot -> player_roles. One request per CLUB, so minutes not hours. Dated: the "
                         "provider serves only today, and it cannot be backfilled.",
                "all": "Both layers, one after the other.",
                "reparse": "Offline: rebuilds everything from the cached JSON. Zero requests.",
                "crosstab": "Offline report: provider slot (G/D/M/F) vs our listone role, so the "
                            "lineup counts can be read as fantacalcio roles. Zero requests.",
                "extra": "The matches no league calendar contains: PRE-SEASON FRIENDLIES, cups, "
                         "continental ties. In July the per-match layer stops at the last matchday of "
                         "May, which is exactly the window an August auction is prepared in. One "
                         "request per club plus one per match found; each match keeps its own "
                         "competition, so a friendly is never counted as a league match.",
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

    def _injuries_dialog(self) -> dict | None:
        """Ask which layer of the Transfermarkt injury walk to run. Returns run() kwargs, or None.

        Same reason the positions dialog exists: 'ids' is a few hundred requests, 'injuries' is one
        per player and takes hours, so nothing here starts by accident.
        """
        from euroleghe_ingest.config import SEASONS

        dlg = tk.Toplevel(self.root)
        dlg.title("Import Transfermarkt injuries")
        dlg.transient(self.root)
        dlg.grab_set()
        dlg.resizable(False, False)
        frm = ttk.Frame(dlg, padding=12)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="Layer:").grid(row=0, column=0, sticky="w", pady=4)
        layer = tk.StringVar(value="ids")
        ttk.Combobox(frm, textvariable=layer, state="readonly", width=24,
                     values=["ids", "injuries", "all", "reparse"]).grid(row=0, column=1, pady=4)
        ttk.Label(frm, text="Season:").grid(row=1, column=0, sticky="w", pady=4)
        season = tk.StringVar(value="all")
        ttk.Combobox(frm, textvariable=season, state="readonly", width=24,
                     values=["all", *SEASONS]).grid(row=1, column=1, pady=4)
        ttk.Label(frm, text="Limit (players):").grid(row=2, column=0, sticky="w", pady=4)
        limit = tk.StringVar(value="")
        ttk.Entry(frm, textvariable=limit, width=26).grid(row=2, column=1, pady=4)
        refresh = tk.BooleanVar(value=False)
        ttk.Checkbutton(frm, text="Refresh (re-download what is already cached)",
                        variable=refresh).grid(row=3, column=0, columnspan=2, sticky="w", pady=4)

        hint = tk.StringVar()
        ttk.Label(frm, textvariable=hint, style="Muted.TLabel", wraplength=330,
                  justify="left").grid(row=4, column=0, columnspan=2, sticky="w", pady=(6, 0))

        def describe(*_args) -> None:
            hint.set({
                "ids": "Squad pages: Transfermarkt player ids + the CONTRACT EXPIRY snapshot "
                       "(exit_risk). One request per club-season plus one per club.",
                "injuries": "The injury history, one request per player - hours. Resumable, and "
                            "'Stop' keeps every player already fetched.",
                "all": "Ids first, then the per-player walk.",
                "reparse": "Offline: rebuilds injuries and the flags from the cache. Zero requests.",
            }[layer.get()])

        layer.trace_add("write", describe)
        describe()

        out: dict = {}

        def confirm():
            out["layer"] = layer.get()
            out["seasons"] = None if season.get() == "all" else [season.get()]
            out["limit"] = int(limit.get()) if limit.get().strip().isdigit() else None
            out["refresh"] = refresh.get()
            dlg.destroy()

        btns = ttk.Frame(frm)
        btns.grid(row=5, column=0, columnspan=2, pady=(10, 0))
        ttk.Button(btns, text="Run", command=confirm).pack(side="left", padx=4)
        ttk.Button(btns, text="Cancel", command=dlg.destroy).pack(side="left", padx=4)
        dlg.wait_window()
        return out or None

    def _snapshot_dialog(self) -> dict | None:
        """Platform / game / season for today's auction sheet, and whether to refresh first.

        The two selectors are the question the sheet cannot answer for you: a Mantra auction is bought
        with different roles and a different currency than a Classic one, and euro and default are
        different competitions with different calendars.
        """
        from euroleghe_ingest.config import SEASONS

        dlg = tk.Toplevel(self.root)
        dlg.title("Auction snapshot")
        dlg.transient(self.root)
        dlg.grab_set()
        dlg.resizable(False, False)
        frm = ttk.Frame(dlg, padding=12)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="Platform:").grid(row=0, column=0, sticky="w", pady=4)
        platform = tk.StringVar(value="euro")
        ttk.Combobox(frm, textvariable=platform, state="readonly", width=22,
                     values=["euro", "default"]).grid(row=0, column=1, pady=4)
        ttk.Label(frm, text="Game:").grid(row=1, column=0, sticky="w", pady=4)
        game = tk.StringVar(value="classic")
        ttk.Combobox(frm, textvariable=game, state="readonly", width=22,
                     values=["classic", "mantra"]).grid(row=1, column=1, pady=4)
        ttk.Label(frm, text="Season:").grid(row=2, column=0, sticky="w", pady=4)
        season = tk.StringVar(value="latest")
        ttk.Combobox(frm, textvariable=season, state="readonly", width=22,
                     values=["latest", *SEASONS]).grid(row=2, column=1, pady=4)
        # A DAY and a CLUB, both optional: this is what turns the sheet into "what did this squad look
        # like on 1 March", which is the only way to look at a decision that has already been taken.
        ttk.Label(frm, text="As of date:").grid(row=3, column=0, sticky="w", pady=4)
        as_of = tk.StringVar(value="")
        ttk.Entry(frm, textvariable=as_of, width=24).grid(row=3, column=1, pady=4)
        ttk.Label(frm, text="Only club:").grid(row=4, column=0, sticky="w", pady=4)
        only = tk.StringVar(value="")
        clubs = sorted({name for (name,) in connect(self.config.db_path).execute(
            "SELECT canonical_name FROM clubs WHERE canonical_name IS NOT NULL")}) \
            if self.config.db_path.exists() else []
        ttk.Combobox(frm, textvariable=only, width=22,
                     values=["", *clubs]).grid(row=4, column=1, pady=4)
        refresh = tk.BooleanVar(value=True)
        ttk.Checkbutton(frm, text="Refresh today's probabili / indisponibili first (3 requests)",
                        variable=refresh).grid(row=5, column=0, columnspan=2, sticky="w", pady=4)

        ttk.Label(frm, foreground=theme.color("text_muted"), wraplength=360, justify="left",
                  text="Writes players.csv + clubs.csv + manifest.json under data/reports/. The "
                       "`engine_*` columns are the gated valuation; every `desc_*` column is "
                       "descriptive and must not become a coefficient without a pre-registered gate "
                       "run. Whatever no source states is reported as not measurable.\n\n"
                       "AS OF a past date: the ten matches are the ten before it, the squads and the "
                       "availability are the ones known then, and titolarita and the bonus rates are "
                       "measured on that season UP TO that day. The probabili are not refetched - "
                       "today's are not that day's - so the weekly XI falls back to who was playing."
                  ).grid(row=6, column=0, columnspan=2, sticky="w", pady=(6, 0))

        out: dict = {}

        def confirm():
            out["platform"] = platform.get()
            out["game"] = game.get()
            out["season"] = None if season.get() == "latest" else season.get()
            out["refresh"] = refresh.get()
            out["date"] = as_of.get().strip() or None
            out["clubs"] = [only.get()] if only.get().strip() else None
            dlg.destroy()

        btns = ttk.Frame(frm)
        btns.grid(row=7, column=0, columnspan=2, pady=(10, 0))
        ttk.Button(btns, text="Run", style="Accent.TButton", command=confirm).pack(side="left", padx=4)
        ttk.Button(btns, text="Cancel", command=dlg.destroy).pack(side="left", padx=4)
        dlg.wait_window()
        return out or None

    # Operations that ask for options before running: command -> dialog method name.
    DIALOGS: ClassVar[dict[str, str]] = {"ratings": "_ratings_dialog",
                                         "positions": "_positions_dialog",
                                         "injuries": "_injuries_dialog",
                                         "snapshot": "_snapshot_dialog"}

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

    def _build_snapshot(self) -> None:
        """The Snapshot tab's button: the same run as the Operations tab, with the progress in view.

        It goes through `run_operation` rather than starting a thread of its own - one worker, one audit
        line - and the bar only starts if the run really started: the snapshot asks for platform and
        gameType first, and a cancelled dialog would otherwise leave it spinning forever.
        """
        self.run_operation("snapshot")
        if self.busy:
            self.snapshot.building(True, "starting")

    def run_operation(self, command: str) -> None:
        if self.busy:
            return
        params: dict = {}
        if command in self.DIALOGS:
            params = getattr(self, self.DIALOGS[command])()
            if params is None:
                return   # user cancelled the dialog
        self._cancel_event.clear()
        self._set_busy(True, command)
        self._append(f"\n> {command}\n")
        threading.Thread(target=self._worker, args=(command, params), daemon=True).start()

    def _worker(self, command: str, params: dict | None = None) -> None:
        old_out, old_err = sys.stdout, sys.stderr
        sys.stdout = sys.stderr = _QueueWriter(self.log_queue)
        started_at = dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds")
        status, detail = "ok", " ".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
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
            status, detail = "skipped", str(exc)
            print(f".. {command}: to implement - {exc}")
        except Exception as exc:  # noqa: BLE001
            status, detail = "error", f"{type(exc).__name__}: {exc}"
            print(f"XX {command}: error - {exc}")
        finally:
            # Provenance: the panel is where most runs are launched from, so a run started here has
            # to leave the same audit line the CLI leaves (its own connection - `ctx` may be gone).
            with contextlib.suppress(Exception):
                conn = connect(self.config.db_path)
                record_run(conn, command, started_at, status, detail[:400])
                conn.close()
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
                    self.snapshot.building(False)
                else:
                    self._append(item)
                    if self._running == "snapshot" and item.strip():
                        self.snapshot.building(True, item.strip().splitlines()[-1])
        except queue.Empty:
            pass
        self.root.after(100, self._drain_log)

    def _append(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text, self._line_tag(text) or ())
        self.log.see("end")
        self.log.configure(state="disabled")

    def _set_busy(self, busy: bool, command: str | None = None) -> None:
        self.busy = busy
        self._running = command if busy else None
        if busy:
            for btn in self.buttons:
                btn.configure(state="disabled")
            self.stop_button.configure(state="normal")
            self.activity_var.set(f"⟳  running {command}" if command else "⟳  running")
            self.progress.start(12)
        else:
            self.progress.stop()
            self.stop_button.configure(state="disabled")
            self.activity_var.set("idle")
            self.refresh_operation_states()


def main() -> int:
    root = tk.Tk()
    ToolkitGUI(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
