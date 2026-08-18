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
import math
import queue
import re
import shutil
import sqlite3
import sys
import threading
import tkinter as tk
from dataclasses import replace
from tkinter import messagebox, scrolledtext, ttk
from typing import ClassVar

from euroleghe_ingest import __version__
from euroleghe_ingest import ui_theme as theme
from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import connect, init_db, record_run, table_names
from euroleghe_ingest.engine import minutes, presence
from euroleghe_ingest.matching import club_abbreviation, club_identity
from euroleghe_ingest.modules import IMPLEMENTED, load, recent_form
from euroleghe_ingest.modules.positions import (
    REAL_ROLE_DEPTH,
    REAL_ROLE_LABEL,
    REAL_ROLE_SIDE,
    REAL_ROLES,
)
from euroleghe_ingest.modules.snapshot import competition_class
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
    ("Start of season", ("rosters", "stats", "elo", "transfers", "injuries", "market", "performance",
      "tournaments", "arrivals", "recent_form", "fbref")),
    ("During the season - every matchday",
     ("ratings", "matchdays", "positions", "synth", "fc_site", "fixtures", "validate")),
    ("Before an auction", ("snapshot", "press", "export")),
)

# Labels for the operations that are not pipeline modules (those just use their own name).
OPERATION_LABELS: dict[str, str] = {
    "initdb": "Initialize DB",
    "rebuild": "Rebuild all",
    "bootstrap": "Bootstrap (from zero)",
    "fetch:plan": "What is missing?",
    "export": "Export app bundle",
    "snapshot": "Auction snapshot (today)",
    "press": "Press reference (judge)",
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
    "fixtures": "Read each club's upcoming matches into `fixtures` (keyed on the provider's event id, "
                "clubs resolved by provider id). Feeds the sheet's easy-matches count and calendar "
                "margin. Re-run it through the season: a postponement moves a match by weeks.",
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
    "market": "Load the market-value CURVE per player from Transfermarkt's own JSON endpoint -> "
              "market_value_history: every change with its date, the club and the age of the time. It "
              "is not `market_values`, which holds ONE value per season and cannot say whether a man "
              "was rising or falling - nor what he was worth on the day of the auction. One request "
              "per quoted player (about an hour), resumable, and a man with two Transfermarkt ids is "
              "skipped rather than blended.",
    "performance": "Load Transfermarkt's PER-MATCH layer -> tm_appearances: the competition of every "
                   "match, the minutes, the participation state and whether it was a NATIONAL-team "
                   "game. It is the acquisition that unblocks the congestion channel (cups and European "
                   "ties) and the national-team minutes the gate had declared missing. One request per "
                   "quoted player (about fifty minutes), resumable from the cache, and the minutes of a "
                   "man who never came on stay NULL - never a zero.",
    "elo": "Load club strength from ClubElo into club_elo at the auction dates (feeds R19, the level "
           "channel: the ORIGIN club's Elo moves the appearances of a man who changed club).",
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
    "press": "THE BOARDS' EXTERNAL JUDGE. Imports the press's typical formations as a DATED fact "
             "(press_formations, archived under data/raw/press/ - a reading not taken is gone) and "
             "judges a sheet's boards against them: module MATCH/ALT/DIFF on the drawn picture, "
             "shared XI men per club. A judge, never an input: nothing the engine or the panel "
             "computes reads it. From the CLI: press --import FILE --season YYYY-YY, then "
             "press --sheet DIR. The button alone replays the archived references (offline).",
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
    "market": "market_value_history",
    "performance": "tm_appearances",
    "arrivals": "arrivals",
    "elo": "club_elo",
    "press": "press_formations",
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
    """Minimal hover tooltip for a Tk widget (stdlib only). `text` may be a str or a callable.

    It never leaves the screen: the tip is measured before it is shown and flipped to the other side of
    the pointer when it would overflow (`_show`).
    """

    MARGIN = 8          # how much of the screen edge stays clear




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
        # Placed OFF SCREEN first, so it is measured before it is seen: the size of a tip depends on its
        # text and on the wraplength, and a tip whose corner is put at the pointer runs off the right edge
        # and off the bottom - which on this panel is most of them, because the columns that carry the
        # longest help sit at the right of the table and the plates at the bottom of the pitch.
        tw.wm_geometry("+10000+10000")
        tk.Label(
            tw, text=text, justify="left", background="#ffffe0", foreground="#000000",
            relief="solid", borderwidth=1, wraplength=self.wraplength, padx=8, pady=6,
        ).pack()
        tw.update_idletasks()
        width, height = tw.winfo_reqwidth(), tw.winfo_reqheight()
        screen_w, screen_h = tw.winfo_screenwidth(), tw.winfo_screenheight()
        # FLIPPED rather than clamped where it does not fit: a tip pinned to the edge covers the very cell
        # or plate it is describing, so it goes to the other side of the pointer instead - and only then
        # clamped, for a tip taller than the screen.
        if x + width + self.MARGIN > screen_w:
            x = max(self.MARGIN, self.widget.winfo_pointerx() - width - 14)
        if y + height + self.MARGIN > screen_h:
            y = max(self.MARGIN, self.widget.winfo_pointery() - height - 8)
        tw.wm_geometry(f"+{int(x)}+{int(y)}")

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


def draw_role_pills(canvas: tk.Canvas, value, x: int, y: int, cell_w: int,
                    filled: set[str] | None = None) -> None:
    """Roles as the coloured chips the panel names a role with - ONE drawing, three tables.

    `filled` = the codes drawn as a solid chip; the others are outlined in the same colour. None means
    they are all solid, which is what a cell where no code is special looks like. The auction list uses
    it to say which of a Mantra player's codes his SURPLUS is measured against, and the difference has
    to be visible without a legend: a filled chip is the shirt he is priced in.

    A chip that does not fit is not drawn HALF - it is not drawn at all, because half a role code is a
    different role code. What that costs is a column measured on the widest list it really holds.
    """
    left = x + 5
    for role in (value if isinstance(value, (list, tuple)) else _split_roles(value)):
        background, foreground = role_pill_color(role)
        label = role.upper() if len(role) == 1 else role.capitalize()
        width = 10 + len(label) * 7
        if left + width > x + cell_w:
            break
        solid = filled is None or role in filled
        _round_rect(canvas, left, y + 4, left + width, y + ROW_H - 4, 9,
                    fill=background if solid else theme.color("surface"), outline=background)
        canvas.create_text(left + width // 2, y + ROW_H // 2, text=label,
                           fill=foreground if solid else background,
                           font=("Segoe UI", 8, "bold"))
        left += width + 3


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
        # one drawing for every table that names a role (see `draw_role_pills`)
        draw_role_pills(canvas, value, x, y, cell_w)

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
    """ONE list of every player, sortable by any column and filterable by role and by club.

    It used to be a top ten per role, twice - predicted and actual, side by side - and that shape
    answered a question about the ENGINE ("of the ten it names, how many were right?") rather than the
    question asked at a table ("what about this man in front of me?"). The operator asked for the table's
    shape, 08/08/2026: one list, every column sortable, a filter for the role and one for the club. What
    the two top tens carried is kept rather than dropped - each row shows the predicted side AND the
    outcome, the aggregate score is in the status line, and the men the engine never priced are in the
    list with empty cells, because that is the only way a single list can still be scored against the
    season that happened.

    ...and, first in the Season selector, the ONE list an auction is actually held on: the season being
    played next, which has no other side at all. Every other entry here is a rehearsal on a season whose
    answer is known; that one is the exercise. It is priced by the same function the Snapshot sheet calls
    (`snapshot.engine_predictions`), never by a second computation of its own.
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

    # WHO is in the list, the operator's choice of 05/08/2026: measured and estimated together, with a filter
    # to see either side alone. ⚠️ The cost of "together" is measured and the panel keeps saying it (gate
    # §7-undecies): ranking them mixed lowered the captured surplus on ten windows of ten. The filter is what
    # makes the decision reversible per look instead of per build.
    INCLUDES: ClassVar[dict[str, str]] = {
        "measured + estimated": "all",
        "measured only": "measured",
        "estimated only (~)": "estimated",
    }

    # (row key, decimals, kind) for every column the table can draw. ONE place, because the header, the
    # cell and the SORT all have to name the same field: a heading that sorts by a different key than the
    # one under it is the "displayed list whose metrics describe a different list" defect with a mouse
    # click attached. The KIND is what the cell is DRAWN as, and it is why this table is a canvas and not
    # a Treeview - in Tk 8.6 a Treeview colours a ROW and nothing smaller, so a role chip could not be
    # drawn at all (the squad table learned this first).
    #   text  left-aligned characters · num  a right-aligned number, `decimals` of them
    #   pill  the role, as the coloured chip the Snapshot board and the pitch badges already use
    FIELDS: ClassVar[dict[str, tuple[str, int | None, str]]] = {
        "role #": ("rank", None, "num"),
        "Player": ("name", None, "text"),
        "Team": ("club", None, "text"),
        "R": ("role_classic", None, "pill"),
        "M": ("roles_mantra", None, "pill"),
        "FM": ("fm_pred", 2, "num"),
        "Pv": ("pv_pred", 1, "num"),
        "VALUE": ("value_pred", 0, "num"),
        "SURPLUS": ("surplus_pred", 0, "num"),
        "SpM": ("spm", 0, "num"),
        "FVM": ("fvm", 0, "num"),
        "dVM": ("dvm", 0, "num"),
        "real FM": ("fm_act", 2, "num"),
        "real Pv": ("pv_act", 0, "num"),
        "real VALUE": ("value_act", 0, "num"),
        "real SURPLUS": ("surplus_act", 0, "num"),
        "real #": ("actual_rank", None, "num"),
        "Pair": ("pair", None, "text"),
    }

    HELP: ClassVar[dict[str, str]] = {
        "role #": "His rank among the players of his own ROLE, in the currency being ranked by - not the "
             "position in the list on screen, so it survives sorting and filtering. A dash means the "
             "ranking could not hold him: below the minimum share of the season (see the line above "
             "the table) he was never someone you could have fielded, or the engine never priced him.",
        "Player": "Name as it appears in the listone (fc_id is the primary key behind it).",
        "Team": "Club at the auction, abbreviated: MUN = Manchester United, S04 = Schalke 04. "
                "Empty when the club is unknown for that season.",
        "R": "The listone's Classic role, drawn in the same palette as the Snapshot board and the pitch "
             "badges, so that a role is one language across the panel.",
        "M": "His Mantra codes, in the listone's own order. The FILLED chip is the slot this row's "
             "SURPLUS and `role #` are measured against - on Mantra the one of his codes he is worth "
             "most in, which is the slot an auction fields him in; the outlined ones are the other "
             "shirts he can take. One row per player: a 'dc;b' defender is ranked in both lists by the "
             "engine and shown once here, against the level of the better of the two. On a Classic "
             "sheet nothing here prices him - his Classic role does - so they are all drawn filled.",
        "FVM": "Fantavalore di mercato: a PRICE, not an opinion in arbitrary units - the listone's scale "
               "is calibrated on a reference auction (Serie A: 10 teams with 1000 credits each, max FVM "
               "500; measured on the complete 2025-26 listone, its top 250 sum to 1032 credits a team). "
               "It is a VOLATILE state - it moves at every salient event, not once a season - so what is "
               "shown is the last value read for that listone: for the live season what the market is "
               "asking now, for a finished one a value that already knows the outcome. Which is why it "
               "is reporting only: no rule may read it. Mantra: FVM M.",
        "FM": "Predicted fantamedia: role anchor + beta x (last season's fantamedia - anchor). "
              "Goalkeepers go through the decomposed M2e model instead, which never uses the anchor.",
        "Pv": "Predicted appearances over the season's matchdays. This side of the product carries "
              "3 to 11 times more of the VALUE error than the fantamedia does.",
        "VALUE": "Predicted VALUE = predicted fantamedia x predicted appearances - the sum of the "
                 "fantavoti he is expected to hand you.",
        "SURPLUS": "Predicted SURPLUS = (predicted fantamedia - the role's replacement level) x "
                   "predicted appearances, then weighted by how much of the season he is expected to "
                   "play: what he is worth OVER the player you would have fielded instead, discounted "
                   "for not being able to count on him. Negative means worse than the bench. The list "
                   "opens sorted by this; the replacement level of each role and the reliability "
                   "weight are in the lines above the table. A '~' marks a man the engine could not "
                   "price at all, whose number is a penalised reconstruction (`engine.estimate`). "
                   "THIS IS NOT THE SHEET'S `SUR`, and the difference is the weight: the sheet carries "
                   "the exact expected surplus and this ranking discounts it by (Pv/matchdays)^gamma, "
                   "because a line-up is set before knowing whether he plays. Same arithmetic "
                   "(`model.surplus_of`), gamma on one side only - measured, 22-23 of the top 25 are "
                   "the same men and the ones that move are the high-fantamedia, low-appearance names.",
        "SpM": "SURPLUS DI MERCATO: the same surplus, in the listone's own credits, so it can be put "
               "beside FVM. The rate is not chosen - it is a budget. Inside each listone role, the "
               "money the market spends on the men it rosters (its top teams x slots by FVM) divided by "
               "the surplus of the men THIS engine would roster: so the whole list costs exactly one "
               "auction's money, and a number here is what he is worth in credits. Reporting only, "
               "exactly like the FVM it is calibrated on: no rule reads it and the gate never sees it. "
               "Empty where the surplus is (see 'role #').",
        "dVM": "SpM - FVM: the credits he is worth, minus the credits he costs. Positive = the market "
               "asks less than his surplus is worth AMONG HIS OWN ROLE, negative = more. A "
               "reallocation and not a discount: the same budget over the same number of slots, split "
               "by the engine instead of by the market - so it says who is cheap relative to whom, and "
               "cannot say that the whole listone is cheap. Empty when the listone does not quote him - "
               "a missing price is unknown, not zero, and a difference against it would be the biggest "
               "bargain on screen. On the LIVE season it is the question an auction asks. On a finished "
               "one the FVM has since moved with the season itself, so a big positive is not a bargain "
               "anybody could have taken: it is the engine and a price that already knows the outcome.",
        "real FM": "Fantamedia actually achieved over the season. Blank when he never played.",
        "real Pv": "Appearances actually made.",
        "real VALUE": "What he actually returned: real fantamedia x real appearances.",
        "real SURPLUS": "The same over-the-bench measure on what he actually did, against the "
                        "replacement level of the season it happened in. The reliability weight bites "
                        "here too: 18 appearances of 38 keep 69% of the surplus.",
        "real #": "Where he actually finished among his role's players, in the currency being ranked "
                  "by. A dash means he ended the season with nothing at all.",
        "Pair": "Another player of the SAME CLUB is in this role's predicted top ten with him: the two "
                "claim the same slots, so treat the pair as one auction decision, not two. The "
                "evidence, all auction-legal: K = forwards the club actually fielded per eleven last "
                "season (2.05 = a two-striker system that can feed both, 1.4 = one slot; n/m = not "
                "measurable); co = elevens the two started TOGETHER last season (23 = a real "
                "partnership, 0-3 = starter and backup, - = never, e.g. one just arrived); "
                "ΔQt.I = his quotation minus the companion's - negative means the market itself "
                "ranks him as the second choice.",
    }

    # Columns follow the chosen currency rather than showing both: the table had one column too many
    # already. SpM and dVM exist only under SURPLUS, because that is what they are made of - showing
    # them on the VALUE list would be one name for two different quantities, which is how a column stops
    # saying what it is measured against. A test asserts every column here has an entry in HELP.
    COLUMNS: ClassVar[dict[str, tuple[str, ...]]] = {
        "value": ("role #", "Player", "Team", "R", "M", "FM", "Pv", "VALUE", "FVM",
                  "real FM", "real Pv", "real VALUE", "real #", "Pair"),
        SURPLUS: ("role #", "Player", "Team", "R", "M", "FM", "Pv", "SURPLUS", "SpM", "FVM", "dVM",
                  "real FM", "real Pv", "real SURPLUS", "real #", "Pair"),
    }

    # The LIVE list has no other side, so the columns that report the outcome are ABSENT and not empty:
    # an empty "real SURPLUS" reads as a zero, which is the same defect a blank surplus needed a stated
    # reason for. A subset of the columns above, so every one of them is already explained.
    LIVE_COLUMNS: ClassVar[dict[str, tuple[str, ...]]] = {
        "value": ("role #", "Player", "Team", "R", "M", "FM", "Pv", "VALUE", "FVM", "Pair"),
        SURPLUS: ("role #", "Player", "Team", "R", "M", "FM", "Pv", "SURPLUS", "SpM", "FVM", "dVM",
                  "Pair"),
    }

    # Measured on the widest value each column really holds, not rounded up by eye. `Pair` takes the
    # spare width because it is the only cell that carries a sentence, and clipping it loses the ΔQt.I;
    # `M` on the widest real code list ('dc/dd/ds' and 'w/t/a' both exist), because a chip that does not
    # fit is not drawn half - it is not drawn at all, and then a role is ABSENT rather than narrow.
    WIDTHS: ClassVar[dict[str, int]] = {
        "role #": 52, "real #": 52, "Player": 150, "Team": 52, "R": 34, "M": 116, "Pair": 170,
        "SURPLUS": 82, "real SURPLUS": 92, "VALUE": 70, "real VALUE": 82, "real Pv": 62,
    }
    WIDTH_DEFAULT: ClassVar[int] = 60
    LEFT_ALIGNED: ClassVar[frozenset[str]] = frozenset({"Player", "Team", "R", "M", "Pair"})

    # What the club filter reads when it is not filtering. Not "" - a blank entry in a combobox reads as
    # "nothing selected yet" next to a table that is showing everything. The ROLE filter is a multiple
    # choice and says the same thing by having nothing ticked.
    ALL: ClassVar[str] = "all"

    # How the season being auctioned is named in the Season selector. Never a bare season string: next
    # to the concluded ones it would read as one of them, and the whole difference is that this one has
    # no outcome. The suffix also sorts it first, which is where it belongs in August.
    LIVE_LABEL: ClassVar[str] = "{season} · LIVE"

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
        # What the table is showing, and how. The sort survives a change of season on purpose: an
        # operator who has just sorted by dVM is looking for a bargain, not for the default order.
        self._view: dict = {}
        self._rows: list[dict] = []
        self._table_rows: list[dict] = []
        self._columns: tuple[str, ...] = ()
        self._head: tk.Canvas | None = None
        self._body: tk.Canvas | None = None
        self._drawn_width = 0
        self._resize_after: str | None = None
        self._sort_column: str | None = None
        self._sort_desc = True
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
        self.include_var = tk.StringVar(value=next(iter(self.INCLUDES)))
        # Re-renders from the cache instead of recomputing: the three lists are built in the same pass
        # (`auction_view` is arithmetic over data already prepared), so the filter is instant.
        self.include_cb = self._selector(top, "Include", self.include_var, list(self.INCLUDES),
                                         self._on_include_change, width=20)
        # The two FILTERS hide rows; they never recompute and they never touch a figure. In particular
        # the SpM rate is fitted on the whole list and not on what is left on screen - a rate read off
        # one club's 25 players would be a percentile computed inside the wrong pool, which is a defect
        # this project has already paid for once (`listone_quotes`).
        # ROLE is a MULTIPLE choice, and on Mantra it has to be: a Mantra auction is run one slot at a
        # time and the question at the table is «chi mi fa il braccetto o l'esterno», which a single
        # choice cannot ask. A menu of checkbuttons rather than a list box - it reads like a select, it
        # holds twelve entries without taking twelve rows of the bar, and nothing is ticked = everything.
        ttk.Label(top, text="Role").pack(side="left", padx=(0, 4))
        self.role_button = ttk.Menubutton(top, text=self.ALL, width=16)
        self.role_menu = tk.Menu(self.role_button, tearoff=0)
        self.role_button.configure(menu=self.role_menu)
        self.role_button.pack(side="left", padx=(0, 12))
        self.role_vars: dict[str, tk.BooleanVar] = {}
        self.team_var = tk.StringVar(value=self.ALL)
        self.team_cb = self._selector(top, "Team", self.team_var, [self.ALL],
                                      self._on_filter_change, width=20)
        # How many rows the filters left, of how many the list holds. Beside them, because it is the
        # only thing that says a filter is ON once the table is scrolled away from the top.
        self.count_var = tk.StringVar(value="")
        ttk.Label(top, textvariable=self.count_var, style="Muted.TLabel").pack(side="left", padx=(0, 8))
        # Indeterminate, because the work has no progress to report: the engine either has the window
        # fitted or it does not. It is packed and unpacked rather than left in place, so a still bar
        # never sits there looking like a stalled one.
        self.spinner = ttk.Progressbar(top, mode="indeterminate", length=90)
        # Every selector in one place: `_busy` disables the collection, so a selector added later is
        # locked during a run without anyone having to remember it.
        self._selectors = (self.platform_cb, self.game_cb, self.season_cb, self.metric_cb,
                           self.include_cb, self.team_cb)
        # The role menu is not a combobox and has no 'readonly': it is locked with the others and kept
        # out of the tuple a test reads, rather than given a state the widget does not have.
        self._buttons = (self.role_button,)
        self.status_var = tk.StringVar(value="")
        ttk.Label(top, textvariable=self.status_var, style="Muted.TLabel").pack(side="left", padx=8)

        # The league is named, and it FOLLOWS the two selectors: platform and game identify which of the
        # declared leagues is being looked at, and each can roster differently - so a line stating one
        # league's squad size under another league's numbers would be describing the wrong zero.
        self.league_hint = tk.StringVar()
        ttk.Label(self, textvariable=self.league_hint, foreground="#777", wraplength=1100,
                  justify="left").pack(fill="x", pady=(4, 0))
        self._describe_league()

        # One table that scrolls ITSELF, and no enclosing canvas. A thousand rows in a frame inside a
        # scrolling canvas is a thousand-row-tall widget, and the canvas' `bind_all("<MouseWheel>")`
        # would swallow the wheel events the tree needs to scroll with.
        self.inner = ttk.Frame(self)
        self.inner.pack(fill="both", expand=True, pady=(6, 0))

    def _selector(self, parent, label, var, values, callback, width: int = 14) -> ttk.Combobox:
        ttk.Label(parent, text=label).pack(side="left", padx=(0, 4))
        cb = ttk.Combobox(parent, textvariable=var, state="readonly", width=width, values=values)
        cb.pack(side="left", padx=(0, 12))
        cb.bind("<<ComboboxSelected>>", callback)
        return cb

    def _league(self) -> dict:
        """The league played on the selected platform and game - whose squad size IS the zero."""
        return self.config.load_league(platform=self.platform_var.get(), game=self.game_var.get())

    def _describe_league(self) -> None:
        """Say which league's replacement level the numbers on screen are measured against."""
        setup = self._league()
        gamma, floor = setup["reliability_exponent"], setup["min_availability"]
        self.league_hint.set(
            "predicted from the previous season only · FVM = the listone's market value, last read"
            " · league: "
            + (f"{setup['name']}, " if setup["name"] else "not one you declared, ")
            + f"{setup['teams']} teams, squad "
            + "/".join(f"{count}{role}" for role, count in setup["squad_slots"].items())
            + (f", catchability weight (Pv/matchdays)^{gamma:g}" if gamma else
               ", catchability weight off")
            + (f", ranked only above {floor:.0%} of the season" if floor else "")
            + " (config/league_config.json) — sets the replacement level SURPLUS is measured "
              "against, and how much a player you cannot count on is worth")

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
        self._describe_league()
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
        # into per-role depth using the fielding caps it measures off real lineups. Read for THIS
        # platform and game: two leagues can roster differently, and then one setup is not the other's.
        setup = self.config.load_league(platform=platform, game=game)
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
                by_role = evaluate.auction_view(
                    data, evaluate.predict_window(data, adopted, None, params),
                    metric=metric, full=True)
                rows = self._one_row_per_player(by_role, data, metric)
                rates = self._market(rows, metric, setup)
                out[data.window.target_season] = {
                    "window": key, "params_from": params.source, "metric": metric,
                    "rules": ", ".join(adopted[1:]) or "baseline only",
                    "by_role": by_role, "rows": rows, "rates": rates,
                    "roster": len(data.observations), "teams": setup.get("teams"),
                }
            live = self._live_view(conn, platform, game, metric, setup, fits)
            if live is not None:
                label, view = live
                out[label] = view
            return out
        finally:
            conn.close()

    def _live_view(self, conn, platform: str, game: str, metric: str, setup: dict,
                   fits: dict) -> tuple[str, dict] | None:
        """The season being AUCTIONED: one list, no other side. None when there is nothing to price.

        The same pricer the Snapshot sheet uses, with the fits this panel has already computed injected
        so eleven windows are not prepared twice - the CHOICE of which fit prices a live target stays in
        `snapshot.engine_predictions`. A second computation here would be a second opinion on a decision
        that is already priced, and that is the defect this project has paid for three times.
        """
        from euroleghe_ingest.engine import evaluate
        from euroleghe_ingest.modules import snapshot

        window, squad_note = snapshot.resolve_window(conn)
        # `squad_source='real'` because in August the listone is PARTIAL - 494 of the ~1450 Serie A
        # players on 5/08/2026 - and a list that shows only the quoted ones is not the table's list.
        # Whoever has no Qt.I is priced at the role anchor, which `engine_predictions` states in a note.
        data, predictions, params_from, notes = snapshot.engine_predictions(
            conn, window, platform, game, setup, squad_source="real", fits=fits)
        if not data.observations:
            return None
        adopted = ("R0", *evaluate.ADOPTED.get(platform, ()))
        # ...and the men the core cannot price, on their penalised estimate: «ogni calciatore DEVE avere il
        # suo SURPLUS altrimenti è impossibile valutarli oggettivamente». The sheet already gave them a
        # number; without this the LIST YOU BID FROM still ranked only the priced ones, which is the same
        # blank in the place it matters most. Built by the sheet's own layer, so the two agree by
        # construction, and passed as an argument the gate never passes.
        estimates = self._estimates(conn, data, predictions, window, platform)
        shared = {
            "window": f"{window.key} {window.input_season}->{window.target_season}",
            "params_from": params_from, "metric": metric, "live": True,
            "rules": ", ".join(adopted[1:]) or "baseline only",
            "roster": len(data.observations), "teams": setup.get("teams"),
            "priced": sum(1 for p in predictions if p.fm_pred is not None),
            "estimated": len(estimates),
            "notes": ([squad_note] if squad_note else []) + notes,
        }
        # THE THREE LISTS IN ONE PASS: `auction_view` is arithmetic over data already prepared, so building
        # all of them costs a fraction of the fits above - and that is what makes the Include filter instant
        # instead of a twenty-second rebuild. Whichever is on screen, its own figures were computed from it.
        out, rates = {}, None
        for include in self.INCLUDES.values():
            by_role = evaluate.auction_view(data, predictions, metric=metric, estimates=estimates,
                                            include=include, full=True)
            rows = self._one_row_per_player(by_role, data, metric)
            # The exchange rate is fitted ONCE - on the first and widest list - and the two subsets are
            # priced with it. Refitted per filter it would move a man's SpM because of who else is on
            # screen, and a number about a player must not depend on what you are looking at.
            rates = self._market(rows, metric, setup, rates)
            out[include] = {**shared, "include": include, "by_role": by_role,
                            "rows": rows, "rates": rates}
        return self.LIVE_LABEL.format(season=window.target_season), out

    @staticmethod
    def _rank_key(metric: str) -> str:
        """The row field the list is ordered by - the chosen currency, and nothing else."""
        return "surplus_pred" if metric == SURPLUS else "value_pred"

    def _one_row_per_player(self, by_role: dict, data, metric: str) -> list[dict]:
        """The single list: every player once, in the slot an auction would field him in.

        The engine ranks a Mantra player in EVERY list his codes put him in, each against that list's own
        floor, and that is right for a per-role top ten. A single table has to answer with one row, and
        which slot it belongs to is a question that already has an owner: `snapshot.auction_level`, the
        same definition the sheet, the rank and `est_surplus` read. Asking it again in a second way here
        is exactly the "two pricers that could disagree" defect, so it is not asked again - the resolver
        names the slot and the row of that role is the one kept.
        """
        from euroleghe_ingest.modules import snapshot

        key = self._rank_key(metric)
        slots = {obs.fc_id: snapshot.auction_level(obs, data)[0] for obs in data.observations}
        best: dict[int, dict] = {}
        for block in by_role.values():
            for row in block.get("rows") or ():
                best[row["fc_id"]] = self._better_row(best.get(row["fc_id"]), row,
                                                      slots.get(row["fc_id"]), key)
        # Ranking order, and a man without a number goes to the bottom rather than to the top: an
        # unpriced row is not a zero, and floating it into the first screen is how absence gets read as
        # a result. fc_id breaks the ties, so the same list comes out twice.
        return sorted(best.values(),
                      key=lambda row: (row.get(key) is None, -(row.get(key) or 0.0), row["fc_id"]))

    @staticmethod
    def _better_row(current: dict | None, candidate: dict, slot: str | None, key: str) -> dict:
        """Of two rows for the same man, the one whose role is the slot he would be FIELDED in."""
        if current is None or candidate.get("role") == slot:
            return candidate
        if current.get("role") == slot:
            return current
        # Neither is that slot (a code the league does not price, or no code at all): keep the list he
        # is worth most in, which is the same tie-break `auction_level` takes one level down.
        return max((current, candidate),
                   key=lambda row: (row.get(key) is not None, row.get(key) or 0.0))

    def _market(self, rows: list[dict], metric: str, setup: dict,
                rates: dict[str, dict] | None = None) -> dict[str, dict]:
        """Fit the SURPLUS -> market-money rate (or reuse one), write SpM and dVM, return the rates.

        Only under SURPLUS: SpM is made OF the surplus, and a VALUE list has none - `surplus_pred` is
        None on every row there, so a column would be empty for everybody. Empty rates and empty cells,
        stated rather than improvised into a second meaning for the same header.

        The league decides HOW DEEP the conversion looks, and nothing else: the FVM is a price in the
        listone's own reference auction, and what a league of this size does is fix how many of those
        men get bought - `teams x squad_slots`, the same numbers that fix the replacement level.
        """
        from euroleghe_ingest.engine import evaluate

        if metric != SURPLUS:
            return {}
        key = self._rank_key(metric)
        if rates is None:
            teams = setup.get("teams") or 0
            roster = {role: teams * slots
                      for role, slots in (setup.get("squad_slots") or {}).items()} if teams else None
            rates = evaluate.market_rates(rows, key=key, roster=roster)
        evaluate.market_surplus(rows, rates, key=key)
        return rates

    @staticmethod
    def _estimates(conn, data, predictions, window, platform: str) -> dict[int, dict]:
        """{fc_id: the fallback valuation} for the men the core could not price - the SHEET's own layer.

        Imported here rather than reimplemented: the cascade, its measured rungs and its penalties live in
        `engine/estimate.py` with `snapshot` gathering their inputs, and a second copy of that ladder would be
        a second answer to the same question. Only the unpriced men are estimated - a priced one keeps his
        gated number, which is what makes the two comparable in one list.
        """
        from euroleghe_ingest.engine import estimate as est
        from euroleghe_ingest.modules import snapshot

        priced = {p.obs.fc_id for p in predictions if p.value_pred is not None}
        by_id = {p.obs.fc_id: p for p in predictions}
        layer = snapshot.estimation_layer(conn, window, platform, data.observations)
        out: dict[int, dict] = {}
        for obs in data.observations:
            if obs.fc_id in priced:
                continue
            guess = snapshot.estimate_for(obs, by_id.get(obs.fc_id), layer, data.anchors, data,
                                          window, platform)
            # The level of the slot he would be FIELDED in, in the game's own vocabulary: on mantra
            # `role_classic` matches no key at all, which priced every estimate at its VALUE and let it
            # outrank gated men measured over their floor (`snapshot.auction_level`).
            _slot, level = snapshot.auction_level(obs, data)
            out[obs.fc_id] = {
                "fm": guess.fm, "pv": guess.pv, "basis": guess.basis,
                "confidence": guess.confidence, "note": guess.note,
                "value": est.surplus(guess.fm, guess.pv, None, guess.confidence),
                "surplus": est.surplus(guess.fm, guess.pv, level, guess.confidence),
            }
        return out

    # A run owns the selection it was started with. Changing platform or game mid-run would leave a
    # worker computing one thing while the panel claims another, and changing season would render from a
    # cache entry the run is about to replace.
    SELECTOR_STATE: ClassVar[dict[bool, str]] = {True: "disabled", False: "readonly"}

    def _busy(self, running: bool) -> None:
        """Spinner on, selectors off - and the reverse. Called on the error path too: a failure must not
        leave the panel spinning with its controls locked."""
        for selector in self._selectors:
            selector.configure(state=self.SELECTOR_STATE[running])
        for button in getattr(self, "_buttons", ()):
            button.configure(state="disabled" if running else "normal")
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
        self._render(self._variant(views[self.season_var.get()]))

    def _on_season_change(self, _event=None) -> None:
        views = self._cache.get((self.platform_var.get(), self.game_var.get(), self._metric()))
        if views and self.season_var.get() in views:
            self._render(self._variant(views[self.season_var.get()]))

    def _on_include_change(self, _event=None) -> None:
        """The filter changes WHICH candidates the list ranks - and it re-renders, never recomputes.

        All three lists come out of the same pass (`auction_view` is arithmetic over data already prepared),
        so switching between them costs nothing. Whichever is on screen, its own figures were computed from
        it: that is the rule the +0.00%-on-ten-windows defect taught, an hour before this filter existed.
        """
        self._on_season_change()

    def _include(self) -> str:
        return self.INCLUDES.get(self.include_var.get(), "all")

    def _variant(self, stored: dict) -> dict:
        """The stored entry for a season is {include: view} for a LIVE season and a plain view otherwise.

        A finished season has nothing to estimate - the listone is complete and the core prices whoever it
        can - so only the live list is built three ways, and the filter falls back to what exists.
        """
        if "by_role" in stored:
            return stored
        return stored.get(self._include()) or next(iter(stored.values()))

    # ---------- rendering ----------
    def _clear(self) -> None:
        for child in self.inner.winfo_children():
            child.destroy()
        # ...and the canvases went with them: a `_fill` between two renders must not draw on a dead
        # widget, which is the shape of every "invalid command name" this panel has ever raised.
        self._head = self._body = None

    def _on_filter_change(self, _event=None) -> None:
        """Role and Team only HIDE rows: no recomputation, and no figure is fitted on what is left."""
        self._fill()

    def _render(self, view: dict) -> None:
        self._clear()
        self._view = view
        self._rows = list(view.get("rows") or ())
        metric = view.get("metric", "value")
        currency = "SURPLUS" if metric == SURPLUS else "VALUE"
        live = bool(view.get("live"))
        if live:
            # No hit count and no share of a perfect top-10: nobody has played, so both would be a
            # zero pretending to be a score. What IS honest here is how much of the table the engine
            # can price at all - the rest is the empty-cell-is-a-statement rule, on a whole list.
            self.status_var.set(
                f"LIVE · {view['window']} · rules {view['rules']} · parameters from "
                f"{view['params_from']} · {view['priced']} of {view['roster']} players priced, "
                # No PERCENTAGE in this line, and a test pins that: a figure with a % on a season nobody
                # has played reads as a hit rate. The measured cost of ranking the estimates together is in
                # the gate (§7-undecies) and in the column help, where it can carry its numbers.
                f"{view.get('estimated', 0)} on an ESTIMATE (~, penalised) · showing "
                f"{view.get('include', 'all')} · "
                f"no season to compare against: this is the list you bid from")
        else:
            total_hits = sum(block["hits"] for block in view["by_role"].values())
            captured = sum(block["captured_value"] or 0 for block in view["by_role"].values())
            perfect = sum(block["perfect_value"] or 0 for block in view["by_role"].values())
            roles = len(view["by_role"])
            share = f"{captured / perfect * 100:.0f}%" if perfect else "n/a"
            self.status_var.set(
                f"window {view['window']} · rules {view['rules']} · parameters from "
                f"{view['params_from']} · {total_hits}/{roles * 10} names · {share} of the perfect "
                f"top-10 {currency}")
        # The engine's own caveats about THIS list (a calendar borrowed from last season, players with
        # no quotation yet, a DRY RUN): on screen, because a note that only reaches the manifest is a
        # note the operator reads after the auction.
        for note in view.get("notes") or ():
            ttk.Label(self.inner, text=f"⚠  {note}", style="Muted.TLabel",
                      wraplength=1100, justify="left").pack(fill="x", pady=(0, 4))
        # The replacement level is the whole premise of the surplus, so it is stated where the list is
        # and not in a tooltip: without it a "-33" on a row means nothing. Per role, because there is one
        # per role - a single number here would be an average of four different zeros.
        for line in self._role_lines(view, metric, live):
            ttk.Label(self.inner, text=line, style="Muted.TLabel",
                      wraplength=1100, justify="left").pack(fill="x", pady=(0, 2))
        self._build_table(metric, live)
        self._fill()

    def _role_lines(self, view: dict, metric: str, live: bool) -> list[str]:
        """The per-role facts a single list would otherwise lose: the level, and the score."""
        blocks = view.get("by_role") or {}
        lines = []
        if metric == SURPLUS:
            levels = [f"{self.ROLE_LABELS.get(role, role)} {block['replacement']:.2f}"
                      for role, block in blocks.items() if block.get("replacement") is not None]
            if levels:
                lines.append("replacement FM the surplus is measured against · "
                             + " · ".join(levels))
        if not live and blocks:
            lines.append("in each role's predicted top ten · "
                         + " · ".join(f"{self.ROLE_LABELS.get(role, role)} {block['hits']}/10"
                                      for role, block in blocks.items()))
        rates = view.get("rates") or {}
        if rates:
            # The rate is a PRICE, so the line says whose money it is and how much of it is in play:
            # the FVM is calibrated on a reference auction (Serie A: 10 teams x 1000 credits, measured),
            # and what this league changes is only how deep it buys.
            credits = sum(entry.get("fvm") or 0 for entry in rates.values())
            rostered = sum(entry.get("rostered") or 0 for entry in rates.values())
            teams = view.get("teams") or 0
            per_team = f" = {credits / teams:,.0f} a team" if teams else ""
            lines.append(
                f"SpM = surplus in the listone's own credits, conserving what the market spends on the "
                f"{rostered} men this league rosters ({credits:,.0f}{per_team}) · "
                + " · ".join(f"{role} {entry['rate']:.2f}" for role, entry in sorted(rates.items())))
        return lines

    # ---------- the one table ----------
    def _build_table(self, metric: str, live: bool) -> None:
        """Header and body, two canvases scrolled together. Rebuilt per view: the COLUMNS follow the
        currency and the season.

        A canvas and not a Treeview, for the reason the squad table already wrote down: in Tk 8.6 a
        Treeview colours a ROW and nothing smaller, so a role drawn as the coloured chip the board uses
        could not be drawn at all. The trade is that everything the Treeview gave for free is written out
        here - the sort marks, the tooltips, the alternating rows, the click.
        """
        columns = (self.LIVE_COLUMNS if live else self.COLUMNS)[metric]
        self._columns = columns
        frame = ttk.Frame(self.inner)
        frame.pack(fill="both", expand=True)
        # GRID and not pack, for the reason the squad table already paid for: a widget packed after an
        # expanding one gets the cavity that is left, which is none - that is how a status bar once
        # collapsed to 1x1 px. Grid also lets the horizontal bar be removed and put back in its place.
        frame.rowconfigure(1, weight=1)
        frame.columnconfigure(0, weight=1)
        self._head = tk.Canvas(frame, height=HEADER_H, highlightthickness=0,
                               background=theme.color("surface_alt"))
        self._body = tk.Canvas(frame, highlightthickness=0, background=theme.color("surface"))
        scroll = ttk.Scrollbar(frame, orient="vertical", command=self._body.yview)
        # Tk CLIPS what does not fit and offers no way to reach it - «276px of the squad table's columns
        # were not narrow, they were ABSENT» - so the sideways bar exists, and it is shown only while it
        # is needed, asked of the canvas itself (`xview` is (0, 1) exactly when everything is visible)
        # rather than computed from the widths.
        self._sideways = ttk.Scrollbar(frame, orient="horizontal", command=self._scroll_sideways)
        self._body.configure(yscrollcommand=scroll.set, xscrollcommand=self._on_xscroll)
        self._head.grid(row=0, column=0, sticky="ew")
        self._body.grid(row=1, column=0, sticky="nsew")
        scroll.grid(row=1, column=1, sticky="ns")
        self._sideways.grid(row=2, column=0, sticky="ew")
        self._sideways.grid_remove()               # put back by `_on_xscroll` the moment it is needed
        self._sideways_shown = False
        self._body.bind("<Configure>", lambda _e: self._on_body_configure(), add="+")
        self._body.bind("<MouseWheel>",
                        lambda event: self._body.yview_scroll(int(-event.delta / 120), "units"))
        self._head.bind("<Button-1>", self._on_head_click)
        # The column help follows the pointer along the header, as it did when the headings were a
        # Treeview's: a canvas has no headings to bind to, so the column is resolved from x.
        self._head.bind("<Motion>", self._on_head_motion, add="+")
        self._head.bind("<Leave>", lambda _e: self._head_tip.hide(), add="+")
        self._head_tip = Tooltip(self._head, lambda: self.HELP.get(self._hover_column or "", ""),
                                 delay=350, wraplength=520, anchor="pointer", bind_events=False)
        self._hover_column = None

    def _scroll_sideways(self, *args) -> None:
        """The sideways bar drives BOTH canvases: a header out of step is worse than no header."""
        self._body.xview(*args)
        self._head.xview(*args)

    def _on_xscroll(self, first: str, last: str) -> None:
        self._sideways.set(first, last)
        self._head.xview_moveto(first)

    def _on_body_configure(self) -> None:
        """A resize changes what `Pair` is worth, so the table is redrawn - once, and only on a real
        change of width. Debounced, because dragging a window edge fires this by the dozen and a redraw
        is 20,000 canvas items; guarded on the width, or the redraw's own <Configure> would loop."""
        self._sync_sideways()
        width = self._body.winfo_width()
        if width == self._drawn_width:
            return
        self._drawn_width = width
        if self._resize_after is not None:
            self.after_cancel(self._resize_after)
        self._resize_after = self.after(120, self._fill)

    def _sync_sideways(self) -> None:
        needed = self._body.xview() != (0.0, 1.0)
        if needed == self._sideways_shown:
            return                          # only act on a change: gridding fires <Configure> again
        self._sideways_shown = needed
        if needed:
            self._sideways.grid()
        else:
            self._sideways.grid_remove()

    def _layout(self) -> list[tuple[str, int, int]]:
        """[(column, its left edge, its width)] - one measurement, used by the header, the cells and the
        click. Two of them would be a header that names a column the cells do not hold.

        The spare width goes to `Pair` and to nothing else, measured three ways when this was a Treeview:
        sharing it leaves `Player` 300 empty pixels beside nine-letter names, giving it to nobody clips
        the pair text at 170 px and loses the ΔQt.I, `Pair` alone fits it.
        """
        widths = [self.WIDTHS.get(column, self.WIDTH_DEFAULT) for column in self._columns]
        spare = self._drawn_width - sum(widths)
        if spare > 0 and "Pair" in self._columns:
            widths[self._columns.index("Pair")] += spare
        out, left = [], 0
        for column, width in zip(self._columns, widths, strict=True):
            out.append((column, left, width))
            left += width
        return out

    def _column_at(self, x: float) -> str | None:
        for column, left, width in self._layout():
            if left <= x < left + width:
                return column
        return None

    def _on_head_click(self, event) -> None:
        column = self._column_at(self._head.canvasx(event.x))
        if column:
            self._sort_by(column)

    def _on_head_motion(self, event) -> None:
        column = self._column_at(self._head.canvasx(event.x))
        if column == self._hover_column:
            return
        self._hover_column = column
        self._head_tip.hide()
        if column and self.HELP.get(column):
            self._head_tip.schedule()

    def _sort_by(self, column: str) -> None:
        """Click a heading to sort by it, click it again to reverse, and once more to go back.

        Back to WHAT is the point: the third click restores the ranking order the engine produced, which
        is the list's own answer and the only order in which `role #` reads top to bottom. Same rule as
        the squad table's headings, and the same treatment of a missing cell - it sinks to the bottom in
        both directions, because a blank is not a small number.
        """
        if self._sort_column != column:
            self._sort_column, self._sort_desc = column, True
        elif self._sort_desc:
            self._sort_desc = False
        else:
            self._sort_column, self._sort_desc = None, True
        self._fill()

    def _sort_value(self, row: dict, column: str):
        """What a column SORTS by: the value behind the cell, never the string in it."""
        field, _digits, _kind = self.FIELDS[column]
        value = row.get(field)
        if column == "Team":
            return club_abbreviation(value)
        if column == "Pair":
            return self._pair_text(value)
        if column == "R":
            # by the order the game is played in, not alphabetically: A, C, D, P is not a role order
            return CLASSIC_ORDER.get(str(value or ""), len(CLASSIC_ORDER))
        if column == "M":
            codes = _split_roles(value)
            return MANTRA_ORDER.get(codes[0], len(MANTRA_ORDER)) if codes else None
        return value

    def _sorted(self, rows: list[dict]) -> list[dict]:
        column = self._sort_column
        if not column:
            return rows                                  # already in ranking order
        values = [self._sort_value(row, column) for row in rows]
        numeric = any(_is_number(value) for value in values)

        def key(pair):
            row, value = pair
            missing = value in (None, "")
            if numeric:
                number = _number(value, 0.0)
                return (missing, -number if self._sort_desc else number, row["fc_id"])
            return (missing, str(value or "").lower(), row["fc_id"])

        ordered = [row for row, _value in sorted(zip(rows, values, strict=True), key=key)]
        if not numeric and self._sort_desc:
            present = [row for row in ordered if self._sort_value(row, column) not in (None, "")]
            absent = [row for row in ordered if self._sort_value(row, column) in (None, "")]
            ordered = list(reversed(present)) + absent
        return ordered

    def _picked_roles(self) -> set[str]:
        """The ticked roles. Empty = every role, which is what an empty selection means everywhere."""
        return {role for role, var in self.role_vars.items() if var.get()}

    def _filtered(self, rows: list[dict]) -> list[dict]:
        roles, team = self._picked_roles(), self.team_var.get()
        if roles:
            # On Mantra the filter reads his CODES and not the slot he is priced in: the question at the
            # table is «who can play me a braccetto», and a 'dc;b' defender priced as a 'dc' is one of
            # the answers. On Classic there is one role and the two readings are the same one.
            rows = [row for row in rows
                    if roles & ({row.get("role_classic") or ""} | set(_split_roles(
                        row.get("roles_mantra"))))]
        if team != self.ALL:
            rows = [row for row in rows if (row.get("club") or "") == team]
        return rows

    def _refresh_filters(self) -> None:
        """The two filters offer what this GAME is played with, and keep a choice that still exists.

        The roles come from the game and not from the rows: on Mantra all twelve codes are offered even
        where the current list happens to hold none of one - a filter whose entries appear and disappear
        with the season is a filter the operator cannot learn.
        """
        mantra = self.game_var.get() == "mantra"
        roles = list(MANTRA_ORDER if mantra else CLASSIC_ORDER)
        if list(self.role_vars) != roles:
            self.role_vars = {role: tk.BooleanVar(value=False) for role in roles}
            self.role_menu.delete(0, "end")
            self.role_menu.add_command(label="all (clear)", command=self._clear_roles)
            self.role_menu.add_separator()
            for role in roles:
                self.role_menu.add_checkbutton(
                    label=self.ROLE_LABELS.get(role, role), variable=self.role_vars[role],
                    onvalue=True, offvalue=False, command=self._on_filter_change)
        picked = self._picked_roles()
        self.role_button.configure(
            text=self.ALL if not picked
            else "/".join(role for role in roles if role in picked) if len(picked) <= 3
            else f"{len(picked)} roles")
        teams = [self.ALL, *sorted({row["club"] for row in self._rows if row.get("club")})]
        self.team_cb.configure(values=teams)
        if self.team_var.get() not in teams:
            self.team_var.set(self.ALL)

    def _clear_roles(self) -> None:
        for var in self.role_vars.values():
            var.set(False)
        self._on_filter_change()

    def _fill(self) -> None:
        """Draw the rows the filters leave, in the order the headings ask for."""
        if self._body is None:
            return
        self._resize_after = None
        self._drawn_width = self._body.winfo_width()
        self._refresh_filters()
        rows = self._sorted(self._filtered(self._rows))
        self._table_rows = rows
        layout = self._layout()
        total = sum(width for _c, _l, width in layout)
        head, body = self._head, self._body
        head.delete("all")
        body.delete("all")
        for column, left, width in layout:
            mark = "" if column != self._sort_column else (" ▼" if self._sort_desc else " ▲")
            head.create_rectangle(left, 0, left + width, HEADER_H,
                                  fill=theme.color("surface_alt"), outline=theme.color("border"))
            # The heading follows its CELLS: a title left-aligned over right-aligned numbers reads as
            # the neighbouring column's.
            if column in self.LEFT_ALIGNED:
                head.create_text(left + 5, HEADER_H // 2, anchor="w", text=column + mark,
                                 font=("Segoe UI", 8, "bold"))
            else:
                head.create_text(left + width - 5, HEADER_H // 2, anchor="e", text=column + mark,
                                 font=("Segoe UI", 8, "bold"))
        head.configure(scrollregion=(0, 0, total, HEADER_H))
        # the stripes run the whole width of the canvas and not only of the columns, or the spare space
        # to the right of the last column reads as a seam down the table
        stripe = max(total, body.winfo_width())
        for index, row in enumerate(rows):
            top = index * ROW_H
            if index % 2:
                body.create_rectangle(0, top, stripe, top + ROW_H,
                                      fill=theme.color("surface_alt"), outline="")
            for column, left, width in layout:
                self._draw_cell(row, column, left, top, width)
        body.configure(scrollregion=(0, 0, total, max(len(rows) * ROW_H, 1)))
        self._sync_sideways()
        shown = len(rows)
        count = len(self._rows)
        roster = self._view.get("roster")
        # What is NOT on screen, said out loud: the filters' own count, and how many of the perimeter
        # never reached the list at all. A list called "all the players" has to be able to say who is
        # missing from it and why - measured on the 2026-27 euro sheet, 61 of 1895, every one of them a
        # man the listone does not carry, so he has no Mantra code and there is no slot to rank him in.
        missing = (f" · {roster - count} of the perimeter not listed (no role this game ranks by)"
                   if roster and roster > count else "")
        self.count_var.set(f"{shown} of {count} players{missing}")

    def _draw_cell(self, row: dict, column: str, left: int, top: int, width: int) -> None:
        """One cell, drawn as its KIND asks. The only place a table colour is decided."""
        _field, _digits, kind = self.FIELDS[column]
        if kind == "pill":
            # The SLOT is the code this row's surplus is measured against, and it is the filled chip:
            # on Mantra a 'dc;b' man is priced in one of the two and the row has to say which. Where
            # nothing in the cell is the slot - the whole Classic column, whose roles ARE the slots -
            # they are all filled, so a rule that is about Mantra never dims a Classic sheet.
            codes = _split_roles(row.get(_field))
            slot = row.get("role")
            draw_role_pills(self._body, codes, left, top, width,
                            filled=None if slot not in codes else {slot})
            return
        text = self._cell(row, column)
        if column in self.LEFT_ALIGNED:
            self._body.create_text(left + 5, top + ROW_H // 2, anchor="w", text=text,
                                   font=("Segoe UI", 8), fill=theme.color("text"))
        else:
            self._body.create_text(left + width - 5, top + ROW_H // 2, anchor="e", text=text,
                                   font=("Segoe UI", 8), fill=theme.color("text"))

    def _cell(self, row: dict, column: str) -> str:
        field, digits, _kind = self.FIELDS[column]
        value = row.get(field)
        if column == "Team":
            return club_abbreviation(value)
        if column == "Pair":
            return self._pair_text(value)
        if digits is None:                               # a name, or a rank that may not exist
            return "-" if value in (None, "") else str(value)
        text = self._num(value, digits)
        # An ESTIMATED row is marked where the number is, exactly as the squad table marks it: same
        # arithmetic, penalised, so it belongs in the same order - and a reader has to be able to see
        # which of two adjacent names is measured and which is a reconstruction.
        if column in ("SURPLUS", "VALUE", "SpM") and text and row.get("estimated"):
            text = f"~{text}"
        return text

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



def _replace_params(params, **changes):
    from dataclasses import replace
    return replace(params, **changes)


# The rounds bands the shrinkage's prior is conditioned on - the same edges the sweep uses, published in
# gate §7-quaterdecies. Two copies would be two populations, which is the defect this project keeps finding.
_ROUNDS_BANDS = ((0, 10), (11, 19), (20, 28), (29, 34), (35, 10_000))


def _rounds_band(rounds: float) -> tuple[int, int]:
    for band in _ROUNDS_BANDS:
        if band[0] <= rounds <= band[1]:
            return band
    return _ROUNDS_BANDS[-1]


class SnapshotView(ttk.Frame):
    """The auction snapshot as a board: the clubs on the left, one club's plan on the right.

    Reads the folder `snapshot` wrote - `players.csv`, `clubs.csv`, `manifest.json` - rather than
    recomputing anything, so what is on screen is exactly the sheet that was produced and a run and a
    reading can never disagree. The bar names the two axes a sheet HAS - which league it is for, which
    day it stands on - and `Build` rebuilds exactly what the bar states, without a dialog.

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
    # Each width is MEASURED, not rounded up by eye: the widest value the column really holds over every
    # club of a sheet ('dd/ds/e', 'MC/DM', 'Milinkovic-Savic V.', '100%'), rendered on this face, plus the
    # cell's padding - or the bold heading where the heading is the wider of the two, which for a
    # three-character number it usually is. It matters because the SUM decides what is on screen: the
    # columns add up to more than a card that also holds a pitch, and 40px "saved" on one of them buys
    # nothing while costing a role code its last letter (the trimmed guesses clipped six columns).
    # (key, header, width, anchor, kind). The KIND is what the cell is drawn as, and it is the reason
    # this table is a canvas and not a Treeview: in Tk 8.6 a Treeview can colour a ROW and nothing
    # smaller (`tag cell` does not exist), so a role pill and a signed number - two things that mean
    # nothing in the theme's plain text colour - could not be drawn at all.
    #   pill_classic / pill_mantra  the role, in the SAME palette the pitch badges use
    #   num                         a number, coloured against the SHEET'S MEAN for that column: green
    #                               above it, red below, and inverted where a high number is bad news
    #                               (`HIGHER_IS_WORSE`). The reference is every player of every club.
    #   trend                       the last-ten strip (a PhotoImage, `_sparkline`)
    #   text                        left-aligned plain text (`real` takes its LINE's colour)
    COLUMNS: ClassVar[tuple[tuple[str, str, int, str, str], ...]] = (
        # The tick comes first because it is an INPUT and not a reading: clear it and the board redraws
        # its elevens without that man, which is the question an operator asks about a squad he does not
        # own yet ("if I do not buy him, who plays?") and about a man who is out for two months.
        ("pick", "", 24, "center", "check"),
        # The strip comes next, as it did when it was the Treeview's tree column: it is the row's
        # picture, and a picture belongs at the start of the line one reads.
        ("trend", "TREND", 106, "w", "trend"),
        # ...and its JUDGEMENT, 0-99, right beside the picture it summarises. A description and not a
        # forecast (`trend_score`), which is why it does not sit among the engine's numbers.
        ("judge", "0-99", 38, "e", "num"),
        ("role", "R", 30, "center", "pill_classic"),
        # Three role columns, because they answer three questions: what you BUY (the listone role), what
        # a Mantra module asks for (the sided roles), and where he was actually USED - the last one small
        # on purpose, it is a two-code hint and not the thing an auction bids on.
        ("mantra", "M", 72, "w", "pill_mantra"),
        ("real", "real", 58, "center", "text"),
        ("name", "Player", 118, "w", "text"),
        # WHO PLAYS, immediately left of WHAT HE IS WORTH: the two questions the sheet answers, and the
        # pair an operator has to read together. «Gimenez ha 80 di surplus, Ramos 129 - perché Gimenez è in
        # campo e Ramos no?» stops being a puzzle when 59% and 31% sit right beside those numbers.
        ("claim", "claim", 44, "e", "num"),
        ("surplus", "SUR", 44, "e", "num"),
        # ...and the SAME margin over the other zero, right beside it: two questions, two columns, and
        # the pair is read together (`docs/model/metrica-asta-surplus-v1.md` §21.1).
        ("mar", "MAR", 44, "e", "num"),
        ("fm", "FM", 38, "e", "num"),
        # Everything to the right is PER MATCHDAY, which is the unit an auction thinks in: a season total
        # answers "how good was he", a per-matchday share answers "what does he give me on Sunday".
        ("pv", "Pv", 38, "e", "num"),
        ("minutes", "min", 42, "e", "num"),
        ("tit", "tit", 44, "e", "num"),
        ("rating", "rat", 38, "e", "num"),
        ("bonus", "g+a", 42, "e", "num"),
        ("inj", "inj", 38, "e", "num"),
        ("status", "flags", 70, "w", "text"),
    )
    ROW_H: ClassVar[int] = 22          # tall enough for a pill with air around its text
    HEAD_H: ClassVar[int] = 21

    # One line per column, because a sheet nobody can read is a sheet nobody should act on. The two
    # families are named in every entry: `engine_*` is gated, `desc_*` is not.
    COLUMN_HELP: ClassVar[dict[str, str]] = {
        "pick": "IN or OUT of the elevens. Clear the tick and both boards - schieramento tipo and "
                "prossima giornata - are rebuilt without him, shape included: the formation is scored on "
                "the eleven it can field, so a squad without its centre-forward may prefer another one. "
                "He stays in this table, and the pitch caption counts how many are unticked, because a "
                "side drawn without somebody must say so. It changes nothing in the sheet or in the "
                "engine's numbers: it is a question asked of the drawing.",
        "trend": "TREND - the club's last 10 CHAMPIONSHIP matches, oldest on the left. Click a row to "
              "read them one by one. The BAR's height is the voto, from a declared cascade: the real "
              "one where the game gave it, the calibrated synthetic one (hollow bar) where the "
              "EuroLeghe calendar skipped that round, and nothing at all otherwise - never a zero for "
              "a match nobody voted. Its colour is the same reading in bands (cyan 7.5+, blue 7, "
              "green 6.5, grey 6, yellow 5.5, red below) - a DISPLAY threshold, not a model parameter. "
              "A two-pixel plinth instead of a bar is a match he did not play, and the four reasons "
              "are four colours: pale grey on the bench, violet injured, red suspended, slate not in "
              "the squad, dark grey no data at all. The BENCH is measured, not guessed: the provider's "
              "own row for an unused substitute. The purple column on the right of each bar is xG+xA, "
              "the second layer - a man can play well and finish badly, and adding the two into one "
              "number would hide exactly that. A black disc is a goal, the small one an assist, a "
              "yellow or red line at the foot a card (only where the match was really voted: the "
              "per-match layer carries no bookings). An underline marks a round the EuroLeghe calendar "
              "never counted - 3 to 7 a season, i.e. about 18% of his football missing from the "
              "fantamedia the game shows.",
        "judge": "The trend as a 0-99, inside HIS OWN ROLE and over this whole sheet: the mean "
              "fantapunti of those ten league matches against the best of his role. A match he did not "
              "play counts ZERO - availability is half of what a fantamedia is worth - and a match "
              "nobody can score is left out of the denominator instead of counting as a bad one. "
              "It is a DESCRIPTION and not a forecast: measured 14/08/2026 over ~65,000 windows "
              "against the reshuffled null, a player's departure from his own averages does not "
              "predict his next rounds (+0.0167 / +0.0072 / -0.0007 at two, three and five matchdays, "
              "the sign changing). Order by it to see who has been going well; do not read it as who "
              "will. No valuation and no board reads it.",
        "tit": "The share of the season's matchdays he is expected to GET A VOTO in: his appearances "
               "over the matches he was available for, discounted by how much of a season a player with "
               "his injury history misses, and by how much of that season he played in ANOTHER shirt "
               "(a season measured elsewhere is evidence about this club too, and weaker evidence). An "
               "appearance is taken as a voto - the season layer stores totals, so it cannot tell a "
               "10-minute cameo from a full match; the TREND strip can, and a hollow dot is exactly "
               "that.",
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
        "surplus": "GREEN above the sheet's mean, RED below it - and the mean is over EVERY player of "
               "EVERY club in the sheet, not over the club on screen (being the best of a bad squad is "
               "not being good). Same convention in every numeric column, inverted in `inj`, where "
               "missing more of a season than the average man is the bad news. "
               "GATED. Predicted SURPLUS = (predicted fantamedia - the role's replacement level) x "
               "predicted appearances: points over the man you would have fielded instead. This is the "
               "auction's own currency - an iron man on a replacement-level fantamedia scores ~0. "
               "EMPTY means the engine could not price him at all, and that is a statement rather than a "
               "zero - the sheet says WHICH statement, per row, in `engine_unpriced_reason`, and there are "
               "two: 'only N votes of 15' (measured here and too little of it: Boga 13, Pavard 1 - outside "
               "the domain the core's coefficients were fitted on) and 'no season on this platform' (his "
               "football was played on the other calendar or outside the perimeter: Kolo Muani has 23 euro "
               "votes and no Serie A season, Stones 3). Converting the second into a prediction is R1, "
               "which the gate has refused twice. On euro the adopted set falls back to the role anchor "
               "(R0c) and prices him anyway; on Serie A R0c is not adopted, so there is nothing to fall "
               "back to - measured on this sheet: 283 of 629 rows, 157 + 126. "
               "UNWEIGHTED, and deliberately: the league declares a `reliability_exponent` and the "
               "AUCTION tab applies it to its own ranking, not to this column - the weight is a "
               "property of whoever ranks, so the sheet, the app and the bench all read the exact "
               "expected surplus. One arithmetic for both (`model.surplus_of`), gamma as an argument.",
        "mar": "THE SAME MARGIN OVER THE OTHER ZERO, and the two columns are two QUESTIONS rather than "
               "two answers to one (`docs/model/metrica-asta-surplus-v1.md` §21). `SUR` counts from the "
               "marginal ROSTERED man - the 80th midfielder of a ten-team league - which is «who is worth "
               "buying». `MAR` counts from the man who actually ENTERS when a starter misses a round: the "
               "rank `teams x the places the rulebook FIELDS` (P 1 - D 4 - C 4 - A 2 on classic, the "
               "twelve codes on mantra, counted from the rulebook and never chosen). That zero is half a "
               "fantavoto higher, so this column is always the smaller number, and the ORDER is what "
               "changes: on the Serie A sheet the two top twenty-fives share 7 names of 25. Read them "
               "together - a man high in both is strong, a man who falls here was worth mostly because "
               "the fillers of his role are poor. REPORTING and not gated: no rule reads it, and "
               "`engine_surplus` did not move a decimal when it arrived. Same slot as `SUR` by "
               "construction, so the difference is the DEPTH and nothing else. EMPTY where the sheet "
               "carries no second zero (a folder older than revision 22) - never a zero.",
        "fm": "GATED. Predicted fantamedia for the season being auctioned, from the adopted rule set "
              "with parameters fitted on a window that is not this season. A `~` in front means the "
              "core could not predict him (too few votes here) and the cell shows the ESTIMATE instead, "
              "penalised by how little is known - the row's tooltip says what it is built from.",
        "pv": "GATED. Predicted appearances as a SHARE of the season: the prediction over the "
              "club's own number of matches (38 in Serie A), because 30 presences mean one thing in "
              "Italy and another in a 34-match Bundesliga.",
        "minutes": "Expected minutes PER MATCHDAY: the projected season minutes over the club's "
               "matches - what he gives you on an average round, cameos and absences included. His own "
               "measured average stands in where there is no projection.",
        "claim": "WHO THE COACH FIELDS when everyone is fit - his standing, as a share of a season, and "
                 "the number the schieramento tipo picks by. Minutes over the rounds he was there for "
                 "(`standing_weights` = minutes, not start rate - measured), weighted by whose season it "
                 "was: minutes played at another club are evidence about this shirt too, and weaker "
                 "(ARRIVAL_DISCOUNT). It is deliberately NOT the surplus. Surplus answers «is he worth "
                 "buying» over a season - it multiplies by expected appearances - and a coach does not "
                 "pick a side by it, which is why a new signing can be second in SUR and twelfth here.",
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

    # How many sheets of a league the "when" selector lists before it hides the rest. An auction week
    # produces one a day and only the last two or three are ever opened again; the older ones are kept
    # (a sheet is the record of what the engine said that day) but they do not have to be in the way.
    RECENT_SHEETS = 8

    def __init__(self, parent, config: Config, on_build=None) -> None:
        super().__init__(parent)
        self.config = config
        self._sparks: list = []
        self.on_build = on_build
        # One entry per sheet on disk, newest first, as `_read_sheet` describes it.
        self.sheets: list[dict] = []
        self.sort_by: str | None = None
        self.sort_desc = True
        self.rows: list[dict] = []
        self.players: list[dict] = []
        self.clubs: dict[str, dict] = {}
        self.manifest: dict = {}
        self._show_all = False
        self._when_paths: list = []
        self._pending_path = None
        self._last_league = ""
        # (club, mode) -> the shape the board draws. Scoring the candidates means building an eleven per
        # shape, and `_draw_pitch` runs on every <Configure>; the sheet is a file, so the answer cannot
        # change until another one is loaded.
        self._shape_cache: dict[tuple[str, str], tuple[str, str]] = {}
        # ...and (club, mode) -> the shape the OPERATOR asked for, which outranks the board's own choice.
        # Per club, because it is a judgement about that squad and not a preference about modules.
        self._shape_choice: dict[tuple[str, str], str] = {}
        self._top_cache: dict[tuple[str, str], list[str]] = {}
        self._surplus_cut: float | None = None
        # club -> its championship calendar. `club_matches` floors it with the busiest player's starts,
        # which is a pass over every row of the sheet, and every presence in the panel asks for it.
        self._calendar: dict[str, float] = {}
        # The declared LEAGUES, cached from the config file. Not `_declared`: this class already has a
        # `_declared` METHOD (the editors' declared eleven), and an attribute of that name shadows it -
        # which silently broke the "prossima giornata" XI until a probe called it.
        self._my_leagues: dict = {}
        # The highest percentage this build has reported, or None before the first one: the bar starts
        # indeterminate and only becomes a real gauge once the module says a number (`building`).
        self._build_percent: int | None = None
        # id(row) -> the slot side ('R'/'C'/'L') that man won in the eleven currently drawn. Written by
        # `eleven`, read by `across_bucket`; empty until an eleven has been built, and empty for the
        # elevens that hand out no slots (declared, fielded).
        self._slot_side: dict[int, str] = {}
        # id(row) -> the men the TRANSFORMATION moved out of the line the shape gave them (`_reshape`):
        # their lane is a decision already taken, so `lanes_for` must not re-read it from their codes.
        self._reshaped: set[int] = set()
        # The men the operator has UNTICKED: the board draws its elevens without them. By `fc_id`, so it
        # survives a sort and a change of club, and emptied when another sheet is loaded.
        self._excluded: set = set()
        # The sheet's mean per column, computed once per sheet (`_column_means`): it is what the cell
        # colours compare against, and it walks every row of every club.
        self._means: dict[str, float] | None = None
        # ...and the 99 of the trend scale, per role, over the same population and cleared with it.
        self._trend_pool: dict[str, float] | None = None
        self._build()

    # ---------- layout ----------
    def _build(self) -> None:
        """The bar states WHICH SHEET is on screen, and Build rebuilds exactly that.

        Two selectors, because a sheet has exactly two axes an operator chooses between: the league it
        is for - which carries the platform, the game and the squad size, i.e. everything that decides
        the numbers - and the day it stands on. Everything else (a past date, one club, a forced season,
        no refresh) is behind `...`: it is rare, and it is what the Operations dialog already asks.
        """
        bar = ttk.Frame(self, padding=(0, 3))
        bar.pack(fill="x")
        ttk.Label(bar, text="League:").pack(side="left")
        self.league_var = tk.StringVar()
        self.league_cb = ttk.Combobox(bar, textvariable=self.league_var, state="readonly", width=26)
        self.league_cb.pack(side="left", padx=(4, 12))
        self.league_cb.bind("<<ComboboxSelected>>", lambda _e: self._on_league_change())
        ttk.Label(bar, text="When:").pack(side="left")
        self.when_var = tk.StringVar()
        # Wide enough for the longest label the list can produce - a day, a season, a single club and the
        # build time - because a truncated entry is exactly the ambiguity the build time was added to fix.
        # 58, not 44: the label now carries the platform and the game too, and Tk CLIPS what does not fit -
        # a truncated sheet name is the same "not narrow, absent" defect the squad table already paid for.
        self.when_cb = ttk.Combobox(bar, textvariable=self.when_var, state="readonly", width=58)
        self.when_cb.pack(side="left", padx=(4, 12))
        self.when_cb.bind("<<ComboboxSelected>>", lambda _e: self._on_when_change())
        if self.on_build:
            # No dialog: the bar already says what to build. `...` is the same run with the rare options.
            self.build_button = ttk.Button(bar, text="Build", style="Accent.TButton",
                                           command=self._build_now)
            self.build_button.pack(side="left", padx=(0, 4))
            ttk.Button(bar, text="...", width=3, command=lambda: self.on_build(None)).pack(side="left")
        ttk.Button(bar, text="Delete", command=self._delete_selected).pack(side="left", padx=(8, 4))
        ttk.Button(bar, text="Reload", command=self.reload).pack(side="left")
        # A build takes minutes and its log lives on another tab, so the progress belongs here. It sits
        # in a FIXED-WIDTH slot: packed and unpacked directly it moved everything to its right on every
        # run, and a bar that is only there while it spins must not also rearrange the bar it is in.
        self.build_slot = ttk.Frame(bar, width=120, height=20)
        self.build_slot.pack(side="left", padx=(8, 4))
        self.build_slot.pack_propagate(flag=False)
        self.build_progress = ttk.Progressbar(self.build_slot, mode="indeterminate", length=110)
        self.build_step = tk.StringVar()
        # Fixed character width and always packed: the stage text changes on every line the module
        # prints, and a label that grows with its content would jitter the whole bar for a minute.
        self.build_label = ttk.Label(bar, textvariable=self.build_step, width=30,
                                     style="Muted.TLabel")
        self.build_label.pack(side="left")
        self.xi_mode = tk.StringVar(value="typical")
        # Its own row, not the tail of the bar: it names the league, the rule set and the parameter
        # source - the provenance of every number below it - and packed after four buttons and a
        # progress slot it was being pushed off the right edge of the window, which is where a line
        # nobody reads goes to die.
        self.note_var = tk.StringVar()
        # One line, clipped, with the whole of it on hover: it is provenance, read once per sheet, and a
        # wraplength that turns it into two lines takes those pixels off the pitch on every club.
        note = ttk.Label(self, textvariable=self.note_var, style="Muted.TLabel", anchor="w")
        note.pack(fill="x", padx=2, pady=(0, 3))
        Tooltip(note, lambda: self.note_var.get(), wraplength=520)

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

        # The club's name and what is known about it on ONE row. Wrapped at 900px under the title the
        # card was 94px tall - a quarter of the pitch under it - for a line read once per club. Clipped
        # here, with everything the sheet says about the club (including the shape and WHY the board
        # chose it) on hover, where there is room for the sentence.
        head = ttk.Frame(right, style="Card.TFrame", padding=(12, 4))
        head.pack(fill="x")
        self.club_title = tk.StringVar(value="select a club")
        ttk.Label(head, textvariable=self.club_title, style="H1.TLabel").pack(side="left")
        self.club_info = tk.StringVar()
        self._club_detail = ""
        info_label = ttk.Label(head, textvariable=self.club_info, style="CardMuted.TLabel",
                               anchor="w")
        info_label.pack(side="left", fill="x", expand=True, padx=(12, 0))
        Tooltip(info_label, lambda: self._club_detail, wraplength=520)

        # Two columns: the eleven on the left, the squad on the right. Stacked, the pitch pushed the
        # list below the fold on a laptop - and the two are read together, not one after the other.
        columns = ttk.Frame(right)
        columns.pack(fill="both", expand=True, pady=(6, 0))
        # NOT a 50/50 split: the pitch is drawn as a tall column and stops gaining from width once its
        # plates fit, while the squad table is 13 columns wide and was losing its last five off the right
        # edge with no horizontal scrollbar to reach them. One third / two thirds, with a floor under both
        # so neither disappears at the minimum window size.
        # 446 = the canvas's own 430 plus the card's padding: below that the pitch stops being drawn at
        # its designed width and the plates start losing characters of names, which is a floor and not a
        # preference. The squad table takes everything else and reaches the rest with its scrollbar.
        columns.columnconfigure(0, weight=1, minsize=446)
        # The table's floor is deliberately low: the two floors have to add up to less than the MINIMUM
        # window (900px leaves the row 676), or grid honours them by pushing the table's own scrollbar off
        # the right edge of the screen - a floor that hides the control that compensates for it.
        columns.columnconfigure(1, weight=2, minsize=220)
        columns.rowconfigure(0, weight=1)
        pitch_card = ttk.Frame(columns, style="Card.TFrame", padding=(8, 5))
        pitch_card.grid(row=0, column=0, sticky="nsew")
        toggle = ttk.Frame(pitch_card, style="Card.TFrame")
        toggle.pack(fill="x", pady=(0, 1))
        ttk.Label(toggle, text="XI", style="CardMuted.TLabel").pack(side="left", padx=(2, 8))
        for label, value in (("schieramento tipo", "typical"), ("prossima giornata", "next")):
            ttk.Radiobutton(toggle, text=label, value=value, variable=self.xi_mode,
                            style="Card.TRadiobutton",
                            command=self._show_club).pack(side="left", padx=(0, 10))
        # Second row, because the first one is full: what the markers speak, and WHICH SHAPE to draw.
        options = ttk.Frame(pitch_card, style="Card.TFrame")
        options.pack(fill="x", pady=(0, 3))
        # Which vocabulary the markers speak. Three, because an auction uses three.
        ttk.Label(options, text="ruoli", style="CardMuted.TLabel").pack(side="left", padx=(2, 4))
        self.role_mode = tk.StringVar(value="real")
        ttk.Combobox(options, textvariable=self.role_mode, state="readonly", width=8,
                     values=["real", "mantra", "classic"]).pack(side="left", padx=(0, 10))
        self.role_mode.trace_add("write", lambda *_a: self._draw_pitch())
        # More than one shape is often plausible - Arsenal played 4-5-1 and 4-3-3 exactly 28 times each -
        # and which one an auction should look at is a judgement, not a measurement. So the board picks
        # one and says why, and this offers every shape the club actually fielded, each with what it is
        # worth: how many of its elevens used it, and how many matchdays the side it fields adds up to.
        ttk.Label(options, text="modulo", style="CardMuted.TLabel").pack(side="left", padx=(0, 4))
        self.shape_var = tk.StringVar()
        self.shape_cb = ttk.Combobox(options, textvariable=self.shape_var, state="readonly", width=36)
        self.shape_cb.pack(side="left")
        self.shape_cb.bind("<<ComboboxSelected>>", lambda _e: self._on_shape_change())
        Tooltip(self.shape_cb,
                "Which shape to DRAW, and how likely this side is to line up in it - one number, built "
                "from three things: what THIS CLUB lines up in (its own elevens, the strongest signal), "
                "what the LEAGUE lines up in (so a module new to this side is possible, and so a history "
                "that belongs to the PREVIOUS coach counts for less), and whether the squad can man it - "
                "the eleven each shape fields, in matchdays. A shape whose slots force a 5% squad player "
                "onto the pitch is not one a coach picks, and that is what pushes its percentage down. "
                "An ESTIMATE for choosing between the shapes, not a gated number, and not a prediction "
                "the engine reads. A module nobody in the league plays is not offered at all: on 2025-26 "
                "that is 2 elevens out of 4812, a parsing tail rather than a formation. Where the men "
                "redraw a shape, the drawing is named after it: a 4-3-3 with a trequartista is drawn "
                "4-3-1-2, and both readings are true.\n\n"
                "SUR = the mean SURPLUS of the eleven that shape fields. A second question, and not the "
                "same one: the percentage says how likely the coach is to pick the shape, this says what "
                "the side it puts on the pitch is worth - so the likely shape can field the poorer "
                "eleven, which is exactly what is worth seeing before bidding. The mean and not the sum "
                "(every shape fields eleven men, so a sum would only change the unit). `~` means at "
                "least one of the eleven carries an ESTIMATE instead of the gated valuation; a count "
                "like (9/11) means the sheet could not price them all, and the mean is over the nine - "
                "a missing surplus is unknown, never zero.", delay=400)
        self.pitch = tk.Canvas(pitch_card, width=430, highlightthickness=0,
                               background=theme.color("surface"))
        self.pitch.pack(fill="both", expand=True)
        self.pitch.bind("<Configure>", lambda _e: self._draw_pitch())
        # A plate names two rivals; a shirt can have more. HOVER lists all of them, CLICK opens the duel
        # with the declared-versus-positional reading. Same idiom as the TREND strip in the table, for
        # the same reason: a plate and ten dots are summaries, not the evidence.
        self.pitch.bind("<Button-1>", self._on_pitch_click)
        self.pitch.bind("<Motion>", self._on_pitch_motion, add="+")
        self.pitch.bind("<Leave>", lambda _e: self.pitch_tip.hide(), add="+")
        self.pitch_tip = Tooltip(self.pitch, self._pitch_tip_text, delay=320, wraplength=460,
                                 anchor="pointer", bind_events=False)

        table = ttk.Frame(columns, style="Card.TFrame", padding=(8, 5))
        table.grid(row=0, column=1, sticky="nsew", padx=(8, 0))
        # TWO canvases, header and body, scrolled together sideways. A canvas because the cells have to
        # be COLOURED one by one - the role in the pitch's own palette, a surplus green or red - and a
        # Treeview in Tk 8.6 colours whole rows only. The trade is that everything a Treeview gave for
        # free is written out here: the sort marks, the tooltips, the alternating rows, the click.
        table.rowconfigure(1, weight=1)
        table.columnconfigure(0, weight=1)
        self.table_head = tk.Canvas(table, height=self.HEAD_H, highlightthickness=0,
                                    background=theme.color("surface_alt"))
        self.table_head.grid(row=0, column=0, sticky="ew")
        self.table_body = tk.Canvas(table, highlightthickness=0,
                                    background=theme.color("surface"))
        self.table_body.grid(row=1, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(table, orient="vertical", command=self.table_body.yview)
        scroll.grid(row=1, column=1, sticky="ns")
        self.table_body.configure(yscrollcommand=scroll.set)
        # ...and a HORIZONTAL one, because the columns add up to more than the card is wide as soon as the
        # window is not maximised: without it the right-hand columns (inj, flags) were not narrow, they
        # were absent - a canvas clips what does not fit exactly as the Treeview did. Shown only when it
        # is needed, so the 15px it costs are spent on rows whenever the whole sheet already fits.
        self.hscroll = ttk.Scrollbar(table, orient="horizontal", command=self._scroll_sideways)
        self.table_body.configure(xscrollcommand=self._on_xscroll)
        self._hscroll_shown = False
        self.table_body.bind("<Configure>", lambda _e: self._sync_hscroll(), add="+")
        self.table_body.bind("<MouseWheel>",
                             lambda event: self.table_body.yview_scroll(-event.delta // 120, "units"))
        # Click the strip to see what the dots stand for. Ten dots cannot carry a date, an opponent or a
        # scoreline, and those are exactly what turns "a red dot" into a reason.
        self.table_body.bind("<Button-1>", self._on_click, add="+")
        self.table_head.bind("<Button-1>", self._on_head_click, add="+")
        # One tooltip for the whole table, resolving what is under the pointer: a column's own help over
        # the header, the flags of THAT row over the flags cell. Same idiom as the pitch's plates.
        self.table_body.bind("<Motion>", self._on_table_motion, add="+")
        self.table_body.bind("<Leave>", lambda _e: self.table_tip.hide(), add="+")
        self.table_tip = Tooltip(self.table_body, self._table_tip_text, delay=320, wraplength=520,
                                 anchor="pointer", bind_events=False)
        self.table_head.bind("<Motion>", self._on_head_motion, add="+")
        self.table_head.bind("<Leave>", lambda _e: self.head_tip.hide(), add="+")
        self.head_tip = Tooltip(self.table_head, self._head_tip_text, delay=320, wraplength=520,
                                anchor="pointer", bind_events=False)
        self._hover: tuple[int, str] | None = None      # (row index, column key) under the pointer
        self._hover_column: str | None = None           # the header column under the pointer

    # ---------- the squad table (canvas) ----------
    def _table_width(self) -> int:
        """The columns' total width: what the two canvases scroll over."""
        return sum(width for _key, _title, width, _anchor, _kind in self.COLUMNS)

    def _column_at(self, x: float) -> tuple[str, int, int] | None:
        """(key, its left edge, its width) for the column at canvas x, or None past the last one."""
        left = 0
        for key, _title, width, _anchor, _kind in self.COLUMNS:
            if left <= x < left + width:
                return key, left, width
            left += width
        return None

    def _scroll_sideways(self, *args) -> None:
        """The horizontal scrollbar drives BOTH canvases: a header out of step is worse than no header."""
        self.table_body.xview(*args)
        self.table_head.xview(*args)

    def _on_xscroll(self, first: str, last: str) -> None:
        self.hscroll.set(first, last)
        self.table_head.xview_moveto(first)

    def _sync_hscroll(self) -> None:
        """Pack the horizontal scrollbar only while the columns really do not fit.

        Asked of the canvas (`xview` is (0, 1) exactly when everything is visible) rather than computed
        from the widths, so the answer comes from the same place the scrolling does.
        """
        needed = self.table_body.xview() != (0.0, 1.0)
        if needed == self._hscroll_shown:
            return                          # only act on a change: gridding fires <Configure> again
        self._hscroll_shown = needed
        if needed:
            self.hscroll.grid(row=2, column=0, sticky="ew")
        else:
            self.hscroll.grid_forget()

    def restyle(self) -> None:
        """Redraw everything whose colours were baked in: the dot strips and the pitch."""
        self._char_widths = {}          # the theme may have changed the faces the plates are sized on
        self.pitch.configure(background=theme.color("surface"))
        if self.rows:
            self._fill_table()
        self._draw_pitch()

    # ---------- the sheets on disk ----------
    # Shown in the league selector for a sheet whose league is not one of the declared ones: the gate
    # sweeps all four platform/game combinations, so looking at one you do not play is legitimate - it
    # just must not be mistaken for a league.
    UNDECLARED = "{platform}/{game} (not a league)"
    MANAGE = "Manage leagues..."

    def _read_sheet(self, folder, declared: dict | None = None) -> dict:
        """Describe one snapshot folder, from its MANIFEST - which is the only thing that knows.

        The folder name carries the same fields, but reading them off it is guessing: a sheet says in
        its manifest which league it was built for, and therefore what its surplus column is measured
        against. The name is the fallback for sheets written before the manifest carried a league.
        """
        manifest = _read_json(folder / "manifest.json")
        league = manifest.get("league") or {}
        platform, game = manifest.get("platform"), manifest.get("game")
        if not platform or not game:
            # Pre-manifest or unreadable: `auction-snapshot-<season>-<platform>-<game>[-...]-<date>`.
            parts = folder.name.replace("auction-snapshot-", "").split("-")
            platform = next((p for p in parts if p in ("euro", "default")), "euro")
            game = next((g for g in parts if g in ("classic", "mantra")), "classic")
        name = league.get("name") if league.get("declared", True) else None
        if not name and not league:
            # A sheet built before the manifest carried a league. Its numbers came from the config
            # file's top-level setup, which is exactly what a declared league inherits, so filing it
            # under the league played on this platform and game is correct rather than a guess - when
            # there is exactly one. The note line still says the sheet does not state it.
            played = [key for key, setup in (declared or {}).items()
                      if setup["platform"] == platform and setup["game"] == game]
            name = played[0] if len(played) == 1 else None
        return {
            "path": folder,
            "league": name,
            "recorded": bool(league),
            "group": name or self.UNDECLARED.format(platform=platform, game=game),
            "platform": platform, "game": game,
            "season": manifest.get("target_season") or "?",
            "date": manifest.get("auction_date") or folder.name[-10:],
            "generated_at": manifest.get("generated_at") or "",
            "only": sorted({row["club"] for row in _read_csv(folder / "clubs.csv")})
                    if manifest.get("clubs", 99) == 1 else [],
            "players": manifest.get("players"),
        }

    def reload(self, *, select_newest: bool = False) -> None:
        """Rescan the sheets and repopulate both selectors, keeping the current choice if it survives.

        `select_newest` jumps to the most recently BUILT sheet: after a run the operator is looking at
        the thing he just made, which is not necessarily what was selected before it (he may have been
        reading a back-dated sheet) and not necessarily the newest DAY either (the run may itself have
        been back-dated).
        """
        with contextlib.suppress(Exception):
            self._my_leagues = self.config.my_leagues()
        declared = self._my_leagues
        reports = self.config.data_dir / "reports"
        folders = sorted((path for path in reports.glob("auction-snapshot-*")
                          if (path / "players.csv").exists()),
                         key=lambda path: path.name, reverse=True)
        self.sheets = [self._read_sheet(folder, declared) for folder in folders]
        # Declared leagues first, in the file's own order, then any group found on disk that is not one
        # of them: every sheet must stay reachable, including a combination nobody plays any more.
        groups = list(dict.fromkeys([*declared, *(sheet["group"] for sheet in self.sheets)]))
        self.league_cb.configure(values=[*groups, self.MANAGE])
        newest_build = max(self.sheets, key=lambda sheet: sheet["generated_at"], default=None)
        if select_newest and newest_build:
            self.league_var.set(newest_build["group"])
            self.when_var.set("")
            self._pending_path = newest_build["path"]
        if self.league_var.get() not in groups:
            # Open on the league of the most recently BUILT sheet, not on whatever sorts first: the
            # folder name starts with the season, so sorting by name once put a mantra sheet on screen
            # for an operator who had just built a classic one.
            self.league_var.set(newest_build["group"] if newest_build
                                else (groups[0] if groups else ""))
        self._last_league = self.league_var.get()
        self._refresh_when()

    def _group_sheets(self) -> list[dict]:
        """The sheets of the selected league, newest day first."""
        return sorted((sheet for sheet in self.sheets if sheet["group"] == self.league_var.get()),
                      key=lambda sheet: (sheet["date"], sheet["generated_at"]), reverse=True)

    def _refresh_when(self) -> None:
        """Repopulate the day selector for the selected league, and load whatever it lands on."""
        sheets = self._group_sheets()
        pending = getattr(self, "_pending_path", None)
        if pending and pending not in [sheet["path"] for sheet in sheets[:self.RECENT_SHEETS]]:
            self._show_all = True     # a back-dated build lands outside the recent window
        shown = sheets if self._show_all else sheets[:self.RECENT_SHEETS]
        labels, self._when_paths = [], []
        for index, sheet in enumerate(shown):
            day = "/".join(reversed(sheet["date"].split("-"))) if "-" in sheet["date"] else sheet["date"]
            # PLATFORM and GAME in the sheet's own name, at the operator's request. A declared league fixes
            # both, so the League selector shows neither - and the same league's name over a euro/mantra
            # sheet and a default/classic one would read as the same thing while every number in them
            # differs (measured: 904 of 916 surplus values change between the two games alone).
            label = f"{day} · {sheet['season']} · {sheet['platform']}/{sheet['game']}"
            if sheet["only"]:
                label += f" · {sheet['only'][0]} only"
            if index == 0 and not sheet["only"]:
                label += "  (latest)"
            # Two sheets of the same league standing on the same DAY - one rebuilt, or an older one that
            # does not state its league and was filed here - would read as the same entry. What tells
            # them apart is when each was run, so that is added to both rather than to the second.
            if sum(1 for other in shown if other["date"] == sheet["date"]) > 1:
                label += f"  [built {sheet['generated_at'][11:16] or '?'}]"
            labels.append(label)
            self._when_paths.append(sheet["path"])
        hidden = len(sheets) - len(shown)
        if hidden > 0:
            labels.append(f"... show all ({len(sheets)})")
            self._when_paths.append(None)
        self.when_cb.configure(values=labels)
        if not labels:
            self.when_var.set("")
            self._clear_sheet(f"no sheet for {self.league_var.get() or 'this league'} yet - "
                             f"press Build")
            return
        if pending in self._when_paths:
            self.when_var.set(labels[self._when_paths.index(pending)])
        elif self.when_var.get() not in labels:
            self.when_var.set(labels[0])
        self._pending_path = None
        self.load_selected()

    def _on_league_change(self) -> None:
        if self.league_var.get() == self.MANAGE:
            self.league_var.set(getattr(self, "_last_league", ""))
            self._manage_leagues()
            return
        self._last_league = self.league_var.get()
        self._show_all = False
        self.when_var.set("")
        self._refresh_when()

    def _on_when_change(self) -> None:
        labels = list(self.when_cb["values"])
        index = labels.index(self.when_var.get()) if self.when_var.get() in labels else -1
        if 0 <= index < len(self._when_paths) and self._when_paths[index] is None:
            self._show_all = True          # the "show all" entry, not a sheet
            self.when_var.set("")
            self._refresh_when()
            return
        self.load_selected()

    def _selected_sheet(self) -> dict | None:
        labels = list(self.when_cb["values"])
        if self.when_var.get() not in labels:
            return None
        path = self._when_paths[labels.index(self.when_var.get())]
        return next((sheet for sheet in self.sheets if sheet["path"] == path), None)

    def _clear_sheet(self, message: str) -> None:
        """No sheet to show: empty the board and say why, rather than leaving the last one on screen."""
        self.players, self.clubs, self.manifest, self.rows = [], {}, {}, []
        self._means, self._excluded, self._trend_pool = None, set(), None
        self.club_tree.delete(*self.club_tree.get_children())
        self._table_rows = []
        self.table_body.delete("all")
        self.table_head.delete("all")
        self.club_title.set("no snapshot")
        self.club_info.set("")
        self.note_var.set(message)
        self._draw_pitch()

    # ---------- building ----------
    def _build_now(self) -> None:
        """Build the sheet the bar describes: no dialog, because the bar already answered the question.

        A declared league carries its own platform and game, so it is passed BY NAME - the run then
        cannot be given a squad size that belongs to another league. An undeclared group has no name to
        pass, so the two dimensions go straight through.
        """
        group = self.league_var.get()
        if group in self._my_leagues:
            self.on_build({"league": group, "refresh": True})
            return
        sheet = next((sheet for sheet in self.sheets if sheet["group"] == group), None)
        self.on_build({"platform": sheet["platform"] if sheet else "euro",
                       "game": sheet["game"] if sheet else "classic", "refresh": True})

    # The percentage in a `[snapshot] 46% · descriptive layers` line. The module owns the number - its
    # stages carry MEASURED weights (`snapshot.STAGES`) - and the panel only reads it, so the two cannot
    # drift: a stage added there shows up here without a line of change.
    # ANY module's progress line, not only the snapshot's: `Context.progress` prints the same shape, so
    # a scrape that recovers what a player is missing drives the same determinate bar as a build.
    PERCENT_LINE: ClassVar[re.Pattern] = re.compile(
        r"^\[[a-z_]+\]\s+(\d{1,3})%\s*·?\s*(.*)$")

    def building(self, running: bool, step: str = "") -> None:
        """Show how much of the build is done and the stage it is on; hide it again when it ends.

        DETERMINATE while the module reports a percentage, indeterminate until it does. The number is
        `snapshot.Progress`'s, computed from stage weights that were measured on real runs rather than
        assumed - which is what makes it publishable at all: it says how much of the WORK is behind us,
        not how many seconds are left, and the stage name beside it says which work. A line without a
        percentage (any other line the module prints) still updates the text, so the last thing the
        module said is always on screen.

        It cannot go backwards: `Progress` closes each stage at its full weight, and this bar refuses a
        lower number for the same run - a bar that retreats reads as a failure even when nothing failed.
        """
        if hasattr(self, "build_button"):
            self.build_button.configure(state="disabled" if running else "normal")
        if not running:
            self.build_progress.stop()
            self.build_progress.pack_forget()
            self.build_step.set("")
            self._build_percent = None
            return
        match = self.PERCENT_LINE.match(step.strip())
        percent = int(match.group(1)) if match else None
        if match:
            step = match.group(2) or "working"
            step = f"{percent}% · {step}"
        if not self.build_progress.winfo_ismapped():
            self.build_progress.pack(side="left")
            self._build_percent = None
        self.build_step.set(step[:38])
        if percent is None:
            if self._build_percent is None:      # nothing measurable yet: say "working", not "0%"
                self.build_progress.configure(mode="indeterminate")
                self.build_progress.start(12)
            return
        if self._build_percent is None:
            self.build_progress.stop()
            self.build_progress.configure(mode="determinate", maximum=100)
        self._build_percent = max(self._build_percent or 0, percent)
        self.build_progress.configure(value=self._build_percent)

    # ---------- the leagues you play in ----------
    def _manage_leagues(self) -> None:
        """Declare the leagues you play in: one row each, everything visible at once.

        No selection state and no "apply" step - with two or three leagues a form per row is simpler
        than a list plus an editor, and nothing can be typed into a field that then quietly belongs to
        the row you switched away from. Save rewrites only `my_leagues` in the config file; the comments
        and the top-level defaults every league inherits from stay where they are.
        """
        from euroleghe_ingest.config import GAMES, PLATFORMS

        dlg = tk.Toplevel(self)
        dlg.title("Leagues you play in")
        dlg.transient(self.winfo_toplevel())
        dlg.grab_set()
        frame = ttk.Frame(dlg, padding=12)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, style="Muted.TLabel", justify="left", wraplength=560,
                  text="One row per league. `platform` decides which matches count toward the "
                       "fantamedia, `game` the roles and the currency, teams x squad the REPLACEMENT "
                       "LEVEL the surplus is measured against - three choices that change every number "
                       "in the sheet. A blank field inherits the value at the top of "
                       "config/league_config.json. That file is tracked by git and the repository is "
                       "public, so a league name is published with the next commit."
                  ).pack(anchor="w", pady=(0, 10))
        grid = ttk.Frame(frame)
        grid.pack(fill="both", expand=True)
        for column, (title, width) in enumerate((("league", 22), ("platform", 9), ("game", 9),
                                                 ("teams", 6), ("P", 4), ("D", 4), ("C", 4), ("A", 4))):
            ttk.Label(grid, text=title, style="Muted.TLabel", width=width).grid(
                row=0, column=column, sticky="w", padx=2)
        rows: list[dict] = []

        def add_row(name: str = "", setup: dict | None = None) -> None:
            setup = setup or {}
            slots = setup.get("squad_slots") or {}
            index = len(rows) + 1
            row = {
                "name": tk.StringVar(value=name),
                "platform": tk.StringVar(value=setup.get("platform", PLATFORMS[0])),
                "game": tk.StringVar(value=setup.get("game", GAMES[0])),
                "teams": tk.StringVar(value=str(setup["teams"]) if setup.get("teams") else ""),
            }
            for role in ("P", "D", "C", "A"):
                row[role] = tk.StringVar(value=str(slots[role]) if slots.get(role) else "")
            widgets = [ttk.Entry(grid, textvariable=row["name"], width=22),
                       ttk.Combobox(grid, textvariable=row["platform"], state="readonly",
                                    width=8, values=list(PLATFORMS)),
                       ttk.Combobox(grid, textvariable=row["game"], state="readonly",
                                    width=8, values=list(GAMES)),
                       ttk.Entry(grid, textvariable=row["teams"], width=5),
                       *(ttk.Entry(grid, textvariable=row[role], width=3)
                         for role in ("P", "D", "C", "A"))]
            for column, widget in enumerate(widgets):
                widget.grid(row=index, column=column, sticky="w", padx=2, pady=2)
            drop = ttk.Button(grid, text="x", width=2)
            drop.grid(row=index, column=len(widgets), padx=(6, 0))
            row["widgets"] = [*widgets, drop]
            drop.configure(command=lambda r=row: forget(r))
            rows.append(row)

        def forget(row: dict) -> None:
            for widget in row["widgets"]:
                widget.destroy()
            rows.remove(row)

        for name, setup in self.config.my_leagues().items():
            add_row(name, setup)

        def save() -> None:
            out: dict[str, dict] = {}
            for row in rows:
                name = row["name"].get().strip()
                if not name:
                    messagebox.showerror("Leagues", "A league needs a name.", parent=dlg)
                    return
                if name in out:
                    messagebox.showerror("Leagues", f"Two leagues are both called {name!r}.",
                                         parent=dlg)
                    return
                setup: dict = {"platform": row["platform"].get(), "game": row["game"].get()}
                if row["teams"].get().strip():
                    if not row["teams"].get().strip().isdigit() or int(row["teams"].get()) < 2:
                        messagebox.showerror("Leagues", f"{name}: teams must be a number, 2 or more.",
                                             parent=dlg)
                        return
                    setup["teams"] = int(row["teams"].get())
                slots = {role: row[role].get().strip() for role in ("P", "D", "C", "A")}
                if any(slots.values()):
                    if not all(value.isdigit() and int(value) >= 1 for value in slots.values()):
                        messagebox.showerror(
                            "Leagues", f"{name}: give all four squad slots as numbers of 1 or more, or "
                                       f"leave all four blank to inherit them.", parent=dlg)
                        return
                    setup["squad_slots"] = {role: int(value) for role, value in slots.items()}
                out[name] = setup
            self.config.save_leagues(out)
            dlg.destroy()
            self.league_var.set("")     # the groups changed: let reload pick a valid one
            self.reload()

        ttk.Button(frame, text="+ add league", command=add_row).pack(anchor="w", pady=(10, 0))
        buttons = ttk.Frame(frame)
        buttons.pack(anchor="e", pady=(12, 0))
        ttk.Button(buttons, text="Save", style="Accent.TButton",
                   command=save).pack(side="left", padx=4)
        ttk.Button(buttons, text="Cancel", command=dlg.destroy).pack(side="left", padx=4)
        dlg.wait_window()

    def _delete_selected(self) -> None:
        """Remove one sheet from disk, on confirmation.

        Manual only, and never automatic. A sheet is not just data that can be recomputed: it is the
        record of what the engine said on that day with those rules and those parameters (the manifest
        carries `generated_at`, `rules`, `params_from`), and rebuilding the same date after adopting a
        rule or refitting gives different numbers - legitimately. Pruning "the old ones" would delete
        the sheet an auction was actually run from, silently. Hence a button, and a name to read first.
        """
        sheet = self._selected_sheet()
        if not sheet:
            return
        folder = sheet["path"]
        reports = (self.config.data_dir / "reports").resolve()
        # Never outside data/reports, and never anything that is not a snapshot: this deletes a TREE.
        if folder.resolve().parent != reports or not folder.name.startswith("auction-snapshot-"):
            messagebox.showerror("Delete snapshot", f"{folder} is not a snapshot folder under "
                                                    f"{reports} - refusing to delete it.")
            return
        size = sum(path.stat().st_size for path in folder.glob("*") if path.is_file())
        if not messagebox.askyesno(
                "Delete snapshot",
                f"Delete this sheet?\n\n{folder.name}\n\n"
                f"{sheet['players'] or '?'} players · {size / 1024:.0f} KB · built "
                f"{sheet['generated_at'] or 'at an unknown time'}\n\n"
                f"It is the record of what the engine said that day: rebuilding the same date later, "
                f"after adopting a rule or refitting the parameters, gives different numbers."):
            return
        shutil.rmtree(folder, ignore_errors=True)
        self.when_var.set("")
        self.reload()

    def load_sheet(self, folder, apply_rulings: bool = True) -> None:
        """Load a sheet folder into the view - the rows, the clubs, the manifest, and every cache OF
        the sheet invalidated with it.

        THE one loader, read by the panel (`load_selected`) and by the headless harnesses (the press
        comparison, the tests). A second copy of this list is how a harness ends up describing a
        different population from the screen's: the cache list below was once duplicated in a
        scratchpad extractor, and any cache added here alone would silently desynchronize it.

        `apply_rulings` re-seeds the operator's persisted shape rulings for the sheet's season
        (`config/board_rulings.json`). The harnesses pass False: a ruling is often made LOOKING AT the
        judge, so letting it into the measured boards would have the judge scoring the operator's own
        answers - the same circularity the press reference is guarded against.
        """
        self._shape_cache.clear()
        self._shape_choice.clear()      # another sheet is another squad: the judgement does not carry
        self._top_cache.clear()
        self._surplus_cut = None
        self._calendar.clear()
        self.players = _read_csv(folder / "players.csv")
        # another sheet is another population and another squad: the means and the operator's own
        # exclusions both belong to the sheet that was on screen, not to the one being loaded
        self._means, self._excluded, self._trend_pool = None, set(), None
        # ...and so do the five POPULATION statistics the presence model needs - the shrinkage prior and
        # the four z-scores. They are cached because they are read once per row, and they were never
        # invalidated at all: the first sheet a session opened kept its means for every sheet after it.
        for cached in ("_standing_prior", "_prior_by_band", "_level_stats", "_level_gap_stats",
                       "_fm_stats", "_career_stats"):
            if hasattr(self, cached):
                delattr(self, cached)
        self.clubs = {row["club"]: row for row in _read_csv(folder / "clubs.csv")}
        self.manifest = _read_json(folder / "manifest.json")
        if apply_rulings:
            self._seed_shape_rulings()

    def load_selected(self) -> None:
        sheet = self._selected_sheet()
        if not sheet:
            return
        folder = sheet["path"]
        self.load_sheet(folder)
        engine = self.manifest.get("engine", {})
        league = self.manifest.get("league") or {}
        notes = self.manifest.get("notes", [])
        # The league is named on the bar because it is what the surplus column is measured against: the
        # squad size fixes the replacement level, so the same prediction ranks differently in a league
        # that rosters deeper.
        squad = "/".join(f"{count}{role}" for role, count in (league.get("squad_slots") or {}).items())
        self.note_var.set(f"{len(self.players)} players · {sheet['platform']}/{sheet['game']}"
                          + (f" · {league['teams']} teams {squad}" if league.get("teams") else "")
                          + ("" if sheet["recorded"] else " · this sheet does not state its league")
                          + f" · rules {', '.join(engine.get('rules', []))}"
                          + f" · params {engine.get('params_from', '?')}"
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
        """The club's players, BY ROLE then by predicted SURPLUS - how an auction is prepared.

        A man a transfer or the live squad says has LEFT is not in it. The listone keeps declaring him
        here and the AUCTION LIST keeps showing him with his ⇥ - it is what you bid against, and hiding
        him there would hide a row you can still be offered. But a club's SQUAD is a claim about who is at
        the club, and answering it with somebody who plays elsewhere is simply wrong: «perché si vede
        ancora Gutierrez nel Napoli?», asked twice, and the second time is an answer.
        """
        rows = [row for row in self.players
                if (row.get("club") or "(club unknown)") == club and not row.get("desc_left_for")]
        rows.sort(key=lambda row: (self.ROLE_ORDER.get(row.get("role_classic") or "", 9),
                                   -_number(row.get("engine_surplus"), -1e9)))
        return rows

    # ---------- the last-10 strip ----------
    # What each token of `desc_form_series` means, in the popup's own words.
    TOKEN_LABEL: ClassVar[dict[str, str]] = {
        "p": "played", "b": "on the bench, unused", "i": "injured", "s": "suspended",
        "o": "not in the squad", "n": "no data for this match",
        "x": "in the eleven, no statistics published (friendly)",
    }

    def _row_at(self, event) -> dict | None:
        """The sheet row under the pointer, or None below the last one."""
        index = int(self.table_body.canvasy(event.y) // self.ROW_H)
        rows = getattr(self, "_table_rows", [])
        return rows[index] if 0 <= index < len(rows) else None

    def is_excluded(self, row: dict) -> bool:
        """Whether the operator has taken his tick off - i.e. whether the board must draw without him."""
        return (row.get("fc_id") or row.get("name") or "") in self._excluded

    def _toggle_pick(self, row: dict) -> None:
        """Take a man out of the elevens, or put him back, and redraw both the table and the board.

        Keyed by `fc_id` (the sheet's own key), so the choice survives sorting and switching club and back.
        The two caches have to go with it: they hold an ELEVEN per (club, mode) - and the shape itself is
        scored on the eleven, so a squad without its centre-forward can prefer a different formation, which
        is exactly what the question is for.
        """
        key = row.get("fc_id") or row.get("name") or ""
        self._excluded.discard(key) if key in self._excluded else self._excluded.add(key)
        self._shape_cache, self._top_cache = {}, {}
        self._fill_table()
        self._draw_pitch()

    def _on_click(self, event) -> None:
        """The tick takes a man out of the elevens; a click on the strip opens his match-by-match list."""
        column = self._column_at(self.table_body.canvasx(event.x))
        row = self._row_at(event)
        if not (row and column):
            return
        if column[0] == "pick":
            self._toggle_pick(row)
        elif column[0] == "trend":
            self._match_popup(row)

    def _on_head_click(self, event) -> None:
        """A click on a heading sorts by it - except the strip, which is a picture and has no order."""
        column = self._column_at(self.table_head.canvasx(event.x))
        if column and column[0] != "trend":
            self._sort_by(column[0])

    def _on_table_motion(self, event) -> None:
        """Remember what the pointer is over, and offer the tooltip only where there is one to give."""
        column = self._column_at(self.table_body.canvasx(event.x))
        index = int(self.table_body.canvasy(event.y) // self.ROW_H)
        found = (index, column[0]) if column else None
        if found == self._hover:
            return                      # same cell: leave the tip that is already scheduled alone
        self._hover = found
        self.table_tip.hide()
        if self._table_tip_text():
            self.table_tip.schedule()

    def _on_head_motion(self, event) -> None:
        column = self._column_at(self.table_head.canvasx(event.x))
        key = column[0] if column else None
        if key == self._hover_column:
            return
        self._hover_column = key
        self.head_tip.hide()
        if key and self.COLUMN_HELP.get(key):
            self.head_tip.schedule()

    def _table_tip_text(self) -> str:
        """What the hovered CELL says beyond its own characters.

        Three cases only, because a tooltip on every cell is a tooltip nobody reads: the flags, which are
        icons and have to be spelled out per row; the strip, whose ten dots are a summary of matches the
        popup lists in full; and a SURPLUS that carries a `~`, because a penalised number has to say what
        it is built from and what the penalty was - «se il surplus è penalizzato aggiungere una nota a
        riguardo». On a gated surplus there is nothing to add and the tooltip stays silent.
        """
        if not self._hover:
            return ""
        index, key = self._hover
        rows = getattr(self, "_table_rows", [])
        if not (0 <= index < len(rows)):
            return ""
        if key == "status":
            return self._flags(rows[index])[1]
        if key == "trend":
            return f"{rows[index].get('name')} · click for the ten matches, one by one"
        if key == "surplus":
            return self._surplus_note(rows[index])
        return ""

    @staticmethod
    def _surplus_note(row: dict) -> str:
        """Why this surplus is an ESTIMATE and what the indeterminacy cost it - empty when it is gated."""
        if row.get("engine_surplus") or not row.get("est_surplus"):
            return ""
        confidence = _number(row.get("est_confidence"), None)
        penalty = f" · penalised x{confidence:.2f}" if confidence is not None else ""
        note = row.get("est_note") or "estimated"
        return (f"~{row.get('est_surplus')} is an ESTIMATE, not the gated valuation: {note}{penalty}. "
                f"The engine could not price him ({row.get('engine_unpriced_reason') or 'no prediction'}), "
                f"and a missing number cannot be compared with anything - so the sheet gives one and says "
                f"how much it is worth. Basis: {row.get('est_basis') or '?'}.")

    def _head_tip_text(self) -> str:
        return self.COLUMN_HELP.get(self._hover_column or "", "")

    def _match_popup(self, row: dict) -> None:
        """The club's last ten CHAMPIONSHIP matches, one line each: what the bars are, in words.

        Reads `desc_trend_detail`, which the sheet carries for exactly this purpose - so the window and
        the CSV can never tell different stories about the same match. Its counters are the TREND's own
        (`desc_trend_*`) and never `desc_form_*`: those describe a different window - every competition,
        friendlies included - and a picture explained by another window's numbers is the defect this
        project has already paid for.
        """
        dialog = tk.Toplevel(self)
        dialog.title(f"{row.get('name')} · last 10 league matches of {row.get('club')}")
        dialog.transient(self.winfo_toplevel())
        dialog.resizable(False, False)
        frame = ttk.Frame(dialog, padding=12)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text=f"{row.get('name')}  ({row.get('role_classic') or '?'})",
                  style="H2.TLabel").pack(anchor="w")
        trend = bool(row.get("desc_trend_detail"))
        played = row.get("desc_trend_played" if trend else "desc_form_played") or 0
        window = row.get("desc_trend_window" if trend else "desc_form_club_matches") or 0
        scored = row.get("desc_trend_matches") or 0
        mean = _number(row.get("desc_trend_fp"), None)
        ttk.Label(frame, style="Muted.TLabel", justify="left", wraplength=560,
                  text=(f"played {played} of the {window} championship matches his club played, "
                        f"{row.get('desc_trend_bench') or 0} of them on the bench. "
                        + (f"Mean {mean:.2f} fantapunti over the {scored} we can score "
                           f"(a match he did not play counts 0, a match nobody voted is left out). "
                           if mean is not None else "No match of the ten can be scored. ")
                        + f"{row.get('desc_trend_outside_euro') or 0} of them the EuroLeghe calendar "
                          f"never counted."
                        if trend else
                        f"played {played} of {row.get('desc_form_measured') or 0} matches we have "
                        f"player data for, out of {window} the club played.")
                  ).pack(anchor="w", pady=(2, 8))

        columns = ("date", "comp", "opponent", "state", "min", "vote", "fp", "g", "a", "xga")
        titles = ("date", "competition", "opponent", "what happened", "min", "voto", "fanta",
                  "G", "A", "xG+xA")
        widths = (82, 112, 126, 116, 40, 46, 46, 26, 26, 48)
        tree = ttk.Treeview(frame, columns=columns, show="headings", height=11, selectmode="none")
        for key, title, width in zip(columns, titles, widths, strict=True):
            tree.heading(key, text=title)
            tree.column(key, width=width, anchor="w" if key in ("comp", "opponent", "state") else "e")
        tree.pack(fill="both", expand=True)
        source = row.get("desc_trend_detail") if trend else row.get("desc_form_detail")
        for line in (source or "").split(";"):
            if not line:
                continue
            parts = (line.split("|") + [""] * 16)[:16]
            date, comp, opponent, side, token, minutes, started = parts[:7]
            vote, vote_source, points = parts[7], parts[8], parts[9]
            goals, assists, xga, in_euro = parts[10], parts[11], parts[14], parts[15]
            if not trend:                     # an older sheet: the form strip's own, shorter record
                minutes, started, vote = parts[5], parts[9], parts[6]
                goals, assists, vote_source, points, xga, in_euro = parts[7], parts[8], "", "", "", ""
            state = self.TOKEN_LABEL.get(token, token)
            if token == "p":
                state = f"started, {state}" if started else f"came on, {state}"
            tree.insert("", "end", values=(
                date + (" *" if in_euro == "0" else ""), comp,
                f"{'vs' if side == 'H' else '@'} {opponent}".strip(), state, minutes,
                f"{vote}~" if vote and vote_source == "synth" else vote, points,
                goals or "", assists or "", xga))
        ttk.Label(frame, style="Muted.TLabel", justify="left", wraplength=560,
                  text=("Oldest first, same order as the bars. The voto is the real one where the game "
                        "gave it and the CALIBRATED SYNTHETIC one where it did not (marked ~) - never a "
                        "zero for a match nobody voted. `fanta` is that match's fantapunti, and it is "
                        "missing for a synthetic goalkeeper round: his fantavoto is mostly the goals "
                        "conceded, which the per-match layer does not carry. A date marked * is a round "
                        "the EuroLeghe calendar skipped, i.e. football that is invisible in his "
                        "fantamedia. 'out of the squad' is not a bench appearance: the bench is measured."
                        if trend else
                        "Oldest first. This sheet predates the trend columns: the rating is the "
                        "provider's, not a fantavoto, and the window is every competition."))\
            .pack(anchor="w", pady=(8, 0))
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

    # ---------- the last-ten HISTOGRAM (the trend) ----------
    # Where a bar starts and where it tops out, ON THE VOTE. A DISPLAY scale and nothing else: it is
    # declared here, no number downstream reads it, and it is NOT the rating bands above - those are
    # calibrated on the provider's 1-10 rating, and a fantacalcio voto lives on a different one (6 is
    # the average match, 7 a very good one). Votes outside are clamped, never dropped.
    VOTE_FLOOR = 4.0
    VOTE_CEIL = 8.0
    VOTE_BANDS: ClassVar[tuple[tuple[float, str], ...]] = (
        (7.5, "#00e5ff"),      # exceptional
        (7.0, "#2196f3"),      # very good
        (6.5, "#66bb6a"),      # good
        (6.0, "#9e9e9e"),      # average
        (5.5, "#ffd54f"),      # weak
        (0.0, "#ef5350"),      # poor
    )
    # A SYNTHETIC vote is a different fact from a real one and the picture has to say so, or the strip
    # claims the game voted a round it never saw. Same hue, drawn hollow (a one-pixel outline).
    BAR_W = 10                 # one match, in pixels
    BAR_H = 18                 # the drawing area: 14 for the bar, 4 above it for the bonus mark
    # A match he did not play: no bar, a two-pixel plinth in the reason's own colour, so an absence can
    # never read as a bad performance and the four reasons stay four.
    ABSENT_BAR: ClassVar[dict[str, str]] = {"b": "#9e9e9e", "i": "#9575cd", "s": "#ef5350",
                                            "o": "#546e7a", "n": "#37474f", "x": "#9e9e9e"}
    # xG+xA, the SECOND layer the operator asked for - BESIDE the bar and never inside its height, so
    # the cell is seven pixels of voto plus two of expectation. Full at this many expected goals+assists
    # in one match. Nothing is drawn at zero: at two pixels a floor of one is indistinguishable from a
    # small value, so the number lives in the popup and the column says «he created something».
    XGA_FULL = 1.0
    XGA_W = 2
    XGA_COLOUR = "#7e57c2"

    @classmethod
    def vote_band(cls, vote: float | None) -> str:
        if vote is None:
            return "#9e9e9e"
        for floor, colour in cls.VOTE_BANDS:
            if vote >= floor:
                return colour
        return cls.VOTE_BANDS[-1][1]

    def _histogram(self, detail: str | None):
        """The last ten CHAMPIONSHIP matches as BARS, oldest on the left. `desc_trend_detail`.

        Four things are readable at a glance and each is a different question. The HEIGHT is the vote,
        on the declared scale above; a HOLLOW bar means that vote is the calibrated synthetic one,
        because the euro calendar skipped that round and the game never voted it. A bar that is only a
        plinth is a match he did not play, coloured by the reason (bench, injury, suspension, out of
        the squad, unknown) - never by a performance he did not give. The purple column on the right of
        each cell is xG+xA, the second layer: a man can be playing well and finishing badly, and the
        two must not be added into one number. The marks are the events - a black disc for a goal, a
        small one for an assist, a yellow or red two-pixel line at the foot for a card - and a match
        the EURO calendar never counted carries a one-pixel underline: 18% of a season, invisible in
        the fantamedia the game shows.
        """
        records = [line.split("|") for line in (detail or "").split(";") if line]
        image = tk.PhotoImage(width=self.BAR_W * max(len(records), 1) + 2, height=self.BAR_H + 2)
        background = theme.color("surface")
        image.put(background, to=(0, 0, image.width(), image.height()))
        floor_y = self.BAR_H              # the baseline: bars grow up from it
        top_room = self.BAR_H - 4         # what a bar may use, leaving room for the bonus mark
        for index, fields in enumerate(records):
            parts = (fields + [""] * 16)[:16]
            state, vote, source = parts[4], _number(parts[7], None), parts[8]
            goals, assists = _number(parts[10]), _number(parts[11])
            yellows, reds = _number(parts[12], None), _number(parts[13], None)
            xga, in_euro = _number(parts[14], None), parts[15]
            x = index * self.BAR_W + 1
            bar_w = self.BAR_W - self.XGA_W - 1        # the voto's own width; the rest is the layer
            if in_euro == "0":
                # under the cell, the width of the cell: this round is not in the euro calendar
                image.put(theme.color("text_faint"),
                          to=(x, floor_y + 1, x + self.BAR_W - 1, floor_y + 2))
            if state != "p" or vote is None:
                colour = self.ABSENT_BAR.get(state, "#37474f")
                if state == "p":
                    colour = self.ABSENT_BAR["n"]     # he played and nobody scored it: unknown, not bad
                image.put(colour, to=(x, floor_y - 2, x + bar_w, floor_y))
                continue
            share = (min(vote, self.VOTE_CEIL) - self.VOTE_FLOOR) / (self.VOTE_CEIL - self.VOTE_FLOOR)
            height = max(2, min(top_room, round(share * top_room)))
            self._bar(image, x, floor_y - height, bar_w, height,
                      self.vote_band(vote), hollow=source == "synth")
            if xga:
                tall = min(top_room, round(min(xga / self.XGA_FULL, 1.0) * top_room))
                if tall:
                    image.put(self.XGA_COLOUR,
                              to=(x + bar_w, floor_y - tall, x + bar_w + self.XGA_W, floor_y))
            if goals or assists:
                self._bonus(image, x, bool(goals))
            if reds:
                image.put("#ef5350", to=(x, floor_y - 1, x + bar_w, floor_y))
            elif yellows:
                image.put("#ffd54f", to=(x, floor_y - 1, x + bar_w, floor_y))
        return image

    @staticmethod
    def _bar(image, x: int, y: int, width: int, height: int, colour: str, hollow: bool) -> None:
        """A filled rectangle, or its one-pixel outline when the vote behind it is synthetic."""
        if not hollow or height <= 2 or width <= 2:
            image.put(colour, to=(x, y, x + width, y + height))
            return
        image.put(colour, to=(x, y, x + width, y + 1))
        image.put(colour, to=(x, y + height - 1, x + width, y + height))
        image.put(colour, to=(x, y, x + 1, y + height))
        image.put(colour, to=(x + width - 1, y, x + width, y + height))

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
        "surplus": "engine_surplus", "mar": "desc_surplus_fielded",
        "fm": "engine_fm_pred", "pv": "engine_pv_pred",
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
        if rows and field not in rows[0]:
            # A DERIVED column - `claim`, `judge` - whose number is computed by the panel and is in no
            # CSV field. Ordering it by a raw column would order the list by something other than what
            # it SHOWS, which is the defect this project paid for once already.
            pairs = [(row, self._cell_values(row).get(self.sort_by, ("", None))[1]) for row in rows]
            pairs.sort(key=lambda pair: (pair[1] is None,
                                         -(pair[1] or 0.0) if self.sort_desc else (pair[1] or 0.0)))
            return [row for row, _value in pairs]
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

    # ---------- what a shape is WORTH ----------
    @staticmethod
    def row_surplus(row: dict) -> tuple[float | None, bool]:
        """(surplus, whether it is an ESTIMATE) - the gated number where it exists, the fallback else.

        ONE definition, because the sheet's cell, its tooltip and the shape selector all answer the same
        question and three copies would be three populations (`population()`, same lesson). The two are
        the same arithmetic times a confidence, which is exactly what lets one number rank a whole squad;
        a row with neither returns None, and None is not zero - «un vuoto è un'affermazione».
        """
        estimated = not row.get("engine_surplus") and bool(row.get("est_surplus"))
        return _number(row.get("est_surplus" if estimated else "engine_surplus"), None), estimated

    def eleven_surplus(self, eleven: list) -> tuple[float | None, int, int, bool]:
        """(mean surplus of the starters, how many carried one, of how many, any estimated).

        The mean and NOT the sum, because the shapes being compared all field eleven men: a sum would
        say the same thing in a bigger unit, and a mean is the number an operator already has in his eye
        from the squad table. Averaged over the men who HAVE a number - a missing surplus is unknown,
        not zero, and counting it as zero would make a shape look poorer for the men it cannot price -
        so the count travels with it and the label shows it whenever it is short of eleven.
        """
        values, estimated = [], False
        for _role, starter, _rivals in eleven:
            surplus, is_estimate = self.row_surplus(starter)
            if surplus is None:
                continue
            values.append(surplus)
            estimated = estimated or is_estimate
        if not values:
            return None, 0, len(eleven), False
        return sum(values) / len(values), len(values), len(eleven), estimated

    # ---------- which shape to draw ----------
    def _fill_shapes(self, club: str, info: dict, drawn: str) -> None:
        """Offer every shape this club fielded, with what each is worth, and select the drawn one.

        Locked for the coming match when the probabili name a shape: that is the coach's own choice for
        that game, and offering alternatives to it would be offering to ignore him. Everywhere else the
        list is a real question - Arsenal played 4-5-1 and 4-3-3 twenty-eight times each - so the board's
        answer is only a default.
        """
        mode = self.xi_mode.get()
        odds = self.shape_odds(club, info, mode)
        declared = mode == "next" and bool(info.get("formation_today"))
        if not odds or declared:
            self._shape_labels = {}
            self.shape_cb.configure(values=[drawn], state="disabled")
            self.shape_var.set(drawn)
            return
        self._shape_labels = {}
        for shape, probability in odds.items():
            # TWO numbers per shape, and they answer different questions: how LIKELY this side is to line
            # up in it, and what the eleven it fields is WORTH. The odds already read the claims (a shape
            # whose places force a 5% man on the pitch is not one a coach picks), and a surplus is a
            # valuation and not a claim - so a shape can be the likely one and field the poorer eleven,
            # which is precisely what an operator wants to see before he bids. Where the men redraw it,
            # the drawing is named too - the counts are the PROVIDER's three lines, where a trequartista
            # is a forward, so the familiar-but-slightly-different case (a 4-3-3 fielded as a 4-3-1-2) is
            # the same line counts drawn differently, and that is a fact about the shape, not a number.
            eleven = self.eleven(club, shape, mode)
            picture = self.lanes_for(eleven)[2]
            mean, priced, of_men, estimated = self.eleven_surplus(eleven)
            # `<1%` rather than `0%`: it is offered, so it is possible - a shape a coach would only go to
            # in a corner. Rounding that to zero would say the opposite of why it is in the list.
            label = (f"{shape} · " + ("<1%" if probability < 0.005 else f"{probability:.0%}")
                     + (f" → {picture}" if picture and picture != shape else ""))
            if mean is not None:
                # `~` where any of the eleven is an estimate rather than the gated valuation, and the
                # count where the sheet could not price them all: the number says what it is measured on
                label += f" · SUR {'~' if estimated else ''}{mean:.1f}"
                if priced < of_men:
                    label += f" ({priced}/{of_men})"
            self._shape_labels[label] = shape
        # ...and the way BACK, offered only where there is something to go back FROM: a ruling is
        # revoked by handing the question to the odds again. Without this entry a wrong judgement, once
        # persisted, could only ever be replaced by another one - and offered unconditionally it would
        # be a permanent extra line meaning «leave everything as it is».
        ruled = (club, mode) in self._shape_choice
        self.shape_cb.configure(values=([self.SHAPE_AUTO] if ruled else []) + list(self._shape_labels),
                                state="readonly")
        self.shape_var.set(next((label for label, shape in self._shape_labels.items()
                                 if shape == drawn), drawn))

    # The selector entry that means «no ruling»: the odds decide, and any persisted judgement for this
    # club is withdrawn.
    SHAPE_AUTO: ClassVar[str] = "auto · the odds decide"

    def _on_shape_change(self) -> None:
        """Draw the shape the operator asked for, and remember it for this club.

        A `typical` choice is a RULING about the season's squad («Napoli 2026-27 plays 4-3-3») and is
        persisted to `config/board_rulings.json` - the same kind of operator-declared fact as
        `league_config.json`, dated, revocable from the selector (`SHAPE_AUTO`). A `next` choice is a
        judgement about ONE match day and deliberately stays in memory only.
        """
        club = self._selected_club()
        if not club:
            return
        mode = self.xi_mode.get()
        if self.shape_var.get() == self.SHAPE_AUTO:
            self._shape_choice.pop((club, mode), None)
            if mode == "typical":
                self._save_ruling(club, None)
            self._show_club()
            return
        shape = getattr(self, "_shape_labels", {}).get(self.shape_var.get())
        if not shape:
            return
        self._shape_choice[(club, mode)] = shape
        if mode == "typical":
            self._save_ruling(club, shape)
        self._show_club()

    def _load_rulings(self) -> dict:
        """`config/board_rulings.json`: {season: {club: {shape, decided_on}}} - absent file, no rulings."""
        try:
            return json.loads(self.config.board_rulings_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}

    def _save_ruling(self, club: str, shape: str | None) -> None:
        """Persist (or withdraw, shape=None) the operator's typical-board ruling for this sheet's season.

        A rewrite replaces the club's whole entry, so a hand-written `reason` does NOT survive a change
        of shape - which is the wanted behaviour rather than an oversight: the reason argued for the
        shape that is being replaced, and carrying it over would file an old argument under a new
        ruling. Withdrawing prunes the club, and the season with it when it was the last one, so the
        file never accumulates empty scaffolding.
        """
        season = (self.manifest or {}).get("target_season")
        if not season:
            return
        rulings = self._load_rulings()
        entries = rulings.setdefault(season, {})
        if shape is None:
            entries.pop(club, None)
            if not entries:
                rulings.pop(season, None)
        else:
            entries[club] = {"shape": shape,
                             "decided_on": dt.datetime.now(tz=dt.UTC).date().isoformat()}
        path = self.config.board_rulings_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(rulings, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
                        encoding="utf-8")

    def _seed_shape_rulings(self) -> None:
        """The persisted rulings of THIS sheet's season, back into the selector's memory.

        Clubs join by identity, never by the string the file happens to spell (`club_identity` - the
        join that silently lost Milan, Roma and Napoli once already). A ruling whose shape has dropped
        out of the club's plausible odds simply stops applying (`board_shape` checks membership), which
        is the right failure: a squad rebuilt past its ruling is a new question for the odds.
        """
        season = (self.manifest or {}).get("target_season")
        if not season:
            return
        known = {club_identity(club): club for club in self.clubs}
        for club_name, entry in (self._load_rulings().get(season) or {}).items():
            club = known.get(club_identity(club_name))
            shape = (entry or {}).get("shape")
            if club and shape:
                self._shape_choice[(club, "typical")] = shape

    # ---------- club detail ----------
    def _show_club(self) -> None:
        club = self._selected_club()
        if not club:
            return
        info = self.clubs.get(club, {})
        self.club_title.set(club)
        formation, source = self.board_shape(club, info, self.xi_mode.get())
        self._fill_shapes(club, info, formation)
        # Two renderings of the same facts. What is SHOWN is what is short and is written nowhere else on
        # the board; the shape and the reason for it lead the HOVER instead, because the `modulo` selector
        # already names the shape with its percentage and the pitch's own caption repeats it - the same
        # fact three times is what made this card 94px tall.
        # The lines come from the provider's slots, where a winger counts as a midfielder: a 4-3-3
        # with wingers reads 4-5-1. Said out loud, so nobody reads the shape as the coach's own words.
        label = "prossima giornata" if self.xi_mode.get() == "next" else "modulo tipo"
        bits = []
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
        # HOW OLD THE EVIDENCE IS, on the HOVER and not on the card: it is the first thing to look
        # at when a drawn eleven seems wrong, and the last that should cost the pitch a pixel (the
        # 08/08 lesson - the panel spends its height on the board, not on its own chrome). Lazio and
        # Fiorentina diverge from the press partly because the sheet honestly says its squads are
        # 4-10 days old and its transfers a month; that sentence belongs beside the board that used
        # them. Flattened one level, because the manifest nests the squad sources.
        # ...and NOT with a loop variable called `source`: this method already has one - where the drawn
        # module came from - and shadowing it made the hover's first line read «(transfers_latest,
        # provider lines)». The same family as the `_declared` attribute that shadowed its own method.
        # Only DATES are shown: `evidence_age` also carries counts (789 transfers in the window), and a
        # count printed where a reader expects a day is a number that means the wrong thing.
        ages = self.manifest.get("evidence_age") or {}
        stale: list[str] = []

        def _dates(prefix: str, value) -> None:
            if isinstance(value, dict):
                for inner, when in sorted(value.items()):
                    _dates(inner, when)
            elif isinstance(value, str) and value[:4].isdigit() and "-" in value:
                stale.append(f"{prefix} {value}")

        for key, value in sorted(ages.items()):
            _dates(key, value)
        self._club_detail = "\n".join([f"{label} {formation} ({source}, provider lines)", *bits]
            + ([f"evidence: {' · '.join(stale)}"] if stale else []))

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
        ("⧖", "nothing measured about him yet, and the toolkit can still fetch it (recent_form)"),
        ("⟳", "the toolkit is fetching his data right now"),
        ("→", "priced from a WINDOW measured elsewhere, not from a season here"),
        ("⇥", "a TRANSFER says he has left this club - the listone and the squad pages can be days behind"),
        # ...and what happened to his SHIRT during the measured season. Two arrows and not one flag,
        # because gaining a place and losing one are opposite facts about the same man, and the tooltip
        # carries the department control that says whether he won it or merely stood in for somebody.
        ("↑", "he GAINED a place during the season"),
        ("↓", "he LOST his place during the season"),
        # ...and the one that fires WHILE the season is being played: bought as a starter, rotated in
        # fact. A different shape from the two arrows above - no step to find, just a man who plays
        # every week and never starts - and the mark that would have caught the operator's own case.
        ("◑", "sold as a starter and being ROTATED right now"),
        # ...and the same reading on a window too short to say that much: «look at him», measured at
        # 81% against a 58% base where the full one reads 96%.
        ("◔", "sold as a starter and showing signs of uncertainty (a SHORT window)"),
        # ...and the mirror, in the same clock family: nearly full, because he is on the pitch.
        ("◕", "given as a RESERVE and playing like a starter"),
        # A CONTINENTAL CUP takes him away in the middle of the league season. A GLOBE - meridians in a
        # circle - and not a calendar or a plane: what is missing in January is not a date and not a
        # journey, it is that he plays for another continent. Same reading as the app's `global` icon,
        # because a mark is a vocabulary and one fact must not carry two symbols across one project.
        ("⊕", "a CONTINENTAL CUP takes him away during the season"),
    )

    # Whether a data-recovery run is in flight, so the mark says «being fetched» instead of «missing».
    # Class-level default: a headless view can read a row before any run has ever been launched.
    _recovering: ClassVar[str] = ""

    def awaiting_data(self, row: dict) -> bool:
        """Whether this row is one the toolkit can still go and measure (`recent_form.awaiting_data`).

        Read off the SHEET: nothing measured means no season behind him and no recent matches either, which
        is the same emptiness the module tests in the DB - and it is what makes the mark self-clearing, since
        the very rows the scrape fills stop qualifying on the next build.
        """
        # WHAT COUNTS AS MEASURED for the panel: a season here, a recent window here, or the window the
        # toolkit went and fetched elsewhere. The last one is the point of the whole exercise - a man whose
        # ten matches are now in the sheet is not waiting for anything, and leaving the ⧖ on him would have
        # the board ask for a run that has already happened.
        measured = bool(row.get("desc_season_matches") or row.get("desc_form_measured")
                        or row.get("desc_elsewhere_matches"))
        return recent_form.awaiting_data(row.get("role_classic") or "",
                                         _number(row.get("price_initial"), None),
                                         measured, self._price_medians())

    def _price_medians(self) -> dict[str, float]:
        """The sheet's own median quotation per role - computed once, like the column means."""
        if getattr(self, "_medians", None) is None:
            self._medians = recent_form.role_medians(
                [((row.get("role_classic") or ""), _number(row.get("price_initial"), None))
                 for row in self.players])
        return self._medians

    def recovering(self, running: bool, step: str = "", command: str = "") -> None:
        """A data-recovery run, on the sheet's own bar: same widget and same percentage as a build.

        It belongs here and not only in the log because the men being fetched are the men this table marks
        as waiting - so the operator watches the gap close where he saw it open. Redrawing the table on the
        way in and out is what flips their mark between «missing» and «being fetched».
        """
        was, self._recovering = self._recovering, (command or "recent_form") if running else ""
        self.building(running, f"{command or 'recovering'} {step}" if running else "")
        if bool(was) != bool(self._recovering):
            with contextlib.suppress(Exception):
                self._fill_table()

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
            # A GAP THE TOOLKIT CAN STILL CLOSE, and it has to be visible: a man priced above his role's
            # median with nothing measured at all is why his surplus cell is empty - «below MIN_PV_PREV the
            # core refuses to predict» - and he is exactly whom `recent_form` goes and fetches. The rule is
            # the module's own (`recent_form.awaiting_data`), so the mark and the population are one thing.
            self.awaiting_data(row) and not self._recovering,
            self.awaiting_data(row) and self._recovering,
            # ...and once the gap is CLOSED, the mark says what closed it. These men are priced on the
            # presences the window buys them (R13) with the role anchor for the rate, so their surplus ranks
            # them by "he will play" and not by how well: Daffara reads 17.0 off ten Serie B matches. A
            # column that stops saying "waiting" and then says nothing is the worse of the two.
            bool(row.get("desc_elsewhere_matches")) and not row.get("desc_season_matches"),
            # ...and a man a TRANSFER says has left the club he is listed at. The row keeps its club - the
            # listone is the game's own authority on who is in a squad - so the flag is how the operator sees
            # the contradiction at all («verifica bene le rose ed i trasferimenti»: Gutierrez was still drawn
            # at Napoli while the transfer had him at Leverkusen since 1 July).
            bool(row.get("desc_left_for")),
            row.get("desc_place_change") == "gained",
            row.get("desc_place_change") == "lost",
            row.get("desc_rotation_watch") == "watch",
            row.get("desc_rotation_watch") == "early",
            bool(row.get("desc_riser_watch")),
            bool(row.get("desc_cup")),
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
            elif icon == "→":
                extra = (f" - {row.get('desc_elsewhere_matches')} matches, "
                         f"{row.get('desc_elsewhere_minutes')} minutes in "
                         f"{row.get('desc_elsewhere_where') or 'another league'}")
            elif icon == "⇥":
                extra = (f" - to {row.get('desc_left_for')} on {row.get('desc_left_on')}. He is still "
                         f"listed here, so treat the row as a question and not as a squad")
            elif icon in ("↑", "↓"):
                # The whole sentence, control included: the icon says WHAT and the note says whether
                # he won the shirt or was standing in for somebody who was hurt.
                extra = f" - {row.get('desc_place_note') or ''}"
            elif icon in ("◑", "◔"):
                extra = f" - {row.get('desc_rotation_note') or ''}"
            elif icon == "◕":
                extra = f" - {row.get('desc_riser_note') or ''}"
            elif icon == "⊕":
                # The sheet's own sentence: the tournament, its window, which population the coefficient
                # is about and how many rounds it covers. Rewriting it here would be a second wording of
                # one measurement, and the two would drift.
                extra = f" - {row.get('desc_cup_note') or ''}"
            words.append(f"{icon}  {why}{extra}")
        return icons, "\n".join(words)

    def _cells(self, row: dict) -> dict[str, str]:
        """One row of the sheet as the strings the table shows (`_numbers` holds the values behind them)."""
        return {key: text for key, (text, _value) in self._cell_values(row).items()}

    def _cell_values(self, row: dict) -> dict[str, tuple[str, float | None]]:
        """One row of the sheet: (what the cell reads, the number behind it or None).

        The number is kept because the COLOUR is a comparison - above or below the sheet's own mean
        (`_column_means`) - and several of these cells are derived rather than copied: comparing the raw
        column would compare something else than what is on screen. No colours and no widgets here, which
        is what lets a headless test read the table's content.
        """
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
        calendar = self.platform_matchdays() or matches
        # THE FM CELL, by the same rule as the surplus below and for the same reason: «se non ci sono
        # abbastanza valori, mostra la FM stimata con il simbolino "circa" davanti». Under `MIN_PV_PREV`
        # the core refuses to predict and the cell was empty, so the one number an operator reads a player
        # by was missing exactly for the men he knows least - and a blank cannot be compared. The estimate
        # is shown with a `~`, and the SORT KEY is the estimate too: a column that displays one list and
        # orders by another is the v9.28 defect, and it looked measured.
        fm_estimated = (row.get("engine_fm_pred") in (None, "")
                        and row.get("est_fm") not in (None, ""))
        fm = _number(row.get("est_fm" if fm_estimated else "engine_fm_pred"), None)
        fm_text = "" if fm is None else (f"~{fm:.1f}" if fm_estimated else f"{fm:.1f}")
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
        # THE SURPLUS CELL: the gated number where it exists, the ESTIMATE where it does not - «ogni
        # calciatore DEVE avere il suo SURPLUS altrimenti è impossibile valutarli oggettivamente». An
        # estimated one is marked with `~` and its own tooltip says what it is built from and what the
        # indeterminacy cost (`est_note`, `est_confidence`); the two are the same arithmetic, so one column
        # can rank the whole squad, which is the point.
        surplus, estimated = self.row_surplus(row)
        surplus_text = (f"~{row.get('est_surplus')}" if estimated
                        else (row.get("engine_surplus") or ""))
        # ...and the same margin over the OTHER zero, which the sheet writes for the whole list (engine
        # where there is one, estimate elsewhere) - so the `~` is the same fact as the column beside it.
        margin = _number(row.get("desc_surplus_fielded"), None)
        margin_text = "" if margin is None else (f"~{margin:.1f}" if estimated else f"{margin:.1f}")
        share = min(presences / calendar, 1) if presences is not None else None
        started = self.voto_share(row) if row.get("desc_season_matches") else None
        rating = _number(row.get("desc_form_rating"), None)
        claim = self.claim(row, "season")
        judge = self.trend_score(row)
        missed = 1 - self.availability(row) if row.get("desc_injury_source") else None
        return {
            "role": (row.get("role_classic") or "?", None),
            "mantra": ((row.get("roles_mantra") or "").replace(";", "/") or "-", None),
            "real": (real or "-", None),
            "name": (row.get("name") or "", None),
            "surplus": (surplus_text, surplus),
            "mar": (margin_text, margin),
            "fm": (fm_text, fm),
            "pv": (f"{share:.0%}" if share is not None else "", share),
            "minutes": (f"{per_match:.0f}" if per_match else "", per_match),
            "tit": (f"{started:.0%}" if started is not None else "", started),
            # THE NUMBER THAT PICKS THE ELEVEN, on the SEASON horizon - the schieramento tipo's own
            # question, «chi schiera il tecnico quando stanno tutti bene». The next-match board asks a
            # different one and answers it with `presence('recent')`; showing two claims in one column
            # would be showing neither.
            "claim": (f"{claim:.0%}", claim),
            "judge": ((f"{judge:.0f}" if judge is not None else ""), judge),
            "rating": (row.get("desc_form_rating") or "", rating),
            "bonus": (f"{bonus:.0f}" if bonus >= 0.5 else "", bonus),
            "inj": (f"{missed:.0%}" if missed is not None else "", missed),
            "status": (self._flags(row)[0], None),
        }

    # How few men of a role make a scale rather than a coincidence. Below it the column stays empty:
    # a 0-99 read against two other players says nothing about either.
    TREND_POOL_MIN: ClassVar[int] = 8

    def trend_pool(self) -> dict[str, float]:
        """{listone role: the best trend of that role in THIS SHEET} - the 99 of the scale.

        THE POOL IS PART OF THE MEASUREMENT and it is the ROLE, declared rather than implied: «he is
        going well» is a sentence about what his own role can produce, and a forward's ten matches are
        worth more fantapunti than a defender's by construction. The population is the SHEET and never
        the club on screen - being the best of a bad squad is not being good - which is the same
        accessor every other population statistic here reads (`population`).
        """
        if self._trend_pool is None:
            best: dict[str, list[float]] = {}
            for row in self.population():
                value = _number(row.get("desc_trend_fp"), None)
                if value is not None:
                    best.setdefault((row.get("role_classic") or "?").upper(), []).append(value)
            self._trend_pool = {role: max(values) for role, values in best.items()
                                if len(values) >= self.TREND_POOL_MIN and max(values) > 0}
        return self._trend_pool

    def trend_score(self, row: dict) -> float | None:
        """The last ten league matches as a 0-99, inside his own role. A DESCRIPTION, not a forecast.

        Linear against the best of the role, which is the scale the app already uses for the value, so
        twice the fantapunti reads as twice the score. What it must never be read as is a prediction:
        measured 14/08/2026 over ~65,000 windows with the reshuffled null, a player's departure from
        his own averages carries a true excess of +0.0167 / +0.0072 / -0.0007 at two, three and five
        matchdays - it changes SIGN - so this orders «what he has done» and nothing else. No gate owns
        it because no valuation reads it.
        """
        value = _number(row.get("desc_trend_fp"), None)
        top = self.trend_pool().get((row.get("role_classic") or "?").upper())
        if value is None or not top:
            return None
        return max(0.0, min(99.0, round(value / top * 99)))

    # The columns where a HIGH number is the bad news, so "above the mean" has to read red: `inj` is the
    # share of a season a man like this one MISSES. Everything else is more-is-better.
    HIGHER_IS_WORSE: ClassVar[frozenset[str]] = frozenset({"inj"})

    def _column_means(self) -> dict[str, float]:
        """Each numeric column's mean over EVERY player of EVERY club in the sheet.

        The reference the colours compare against, and the operator's own choice of it: a number is read
        as good or bad against the whole population, not against the club on screen - being the best of a
        bad squad is not being good. Empty cells are left OUT of the mean (a missing number is not a zero,
        which is the same rule the sorting obeys), so a column nobody has data for simply has no mean and
        nothing in it is coloured.

        Computed once per sheet: it walks every row and the board redraws on every <Configure>. A sheet
        narrowed to one club is its own population - there is nothing else in the file - and the heading
        tooltip says so rather than pretending the mean is a league's.
        """
        if self._means is None:
            totals: dict[str, list[float]] = {}
            for row in self.players:
                for key, (_text, value) in self._cell_values(row).items():
                    if value is not None:
                        totals.setdefault(key, []).append(value)
            self._means = {key: sum(values) / len(values) for key, values in totals.items() if values}
        return self._means

    def _draw_head(self) -> None:
        """The header row: titles, the sort mark, and the column edges. Redrawn with the table."""
        head = self.table_head
        head.delete("all")
        head.configure(background=theme.color("surface_alt"))
        border, muted = theme.color("border"), theme.color("text_muted")
        left = 0
        for key, title, width, anchor, _kind in self.COLUMNS:
            head.create_rectangle(left, 0, left + width, self.HEAD_H,
                                  fill=theme.color("surface_alt"), outline=border)
            mark = ""
            if key == self.sort_by:
                mark = " v" if self.sort_desc else " ^"
            elif key == "role" and not self.sort_by:
                mark = " *"          # the auction order: by role, then by surplus
            text, x, where = f"{title}{mark}", left + 5, "w"
            if anchor == "e":
                x, where = left + width - 5, "e"
            elif anchor == "center":
                x, where = left + width // 2, "center"
            head.create_text(x, self.HEAD_H // 2, text=text, anchor=where, fill=muted,
                             font=theme.FONTS["strong"])
            left += width
        head.configure(scrollregion=(0, 0, self._table_width(), self.HEAD_H))

    def _draw_cell(self, key: str, kind: str, value: str, left: int, top: int,
                   width: int, anchor: str, row: dict, number: float | None = None) -> None:
        """One cell, in the colour its KIND asks for. The only place a table colour is decided."""
        body = self.table_body
        middle = top + self.ROW_H // 2
        if kind == "trend":
            # The strip stays a PhotoImage: the bar logic is measured and tested, and re-drawing it on the
            # canvas would be a second implementation of it. A sheet built before the trend existed still
            # has its dots - the picture degrades to the older one instead of disappearing.
            spark = (self._histogram(row.get("desc_trend_detail"))
                     if row.get("desc_trend_detail")
                     else self._sparkline(row.get("desc_form_series"), row.get("desc_form_detail")))
            self._sparks.append(spark)              # Tk drops an image nobody references
            body.create_image(left + 3, middle, image=spark, anchor="w")
            return
        if kind == "check":
            picked = not self.is_excluded(row)
            body.create_text(left + width // 2, middle, text="☑" if picked else "☐",
                             anchor="center", font=theme.FONTS["strong"],
                             fill=theme.color("accent") if picked else theme.color("text_muted"))
            return
        if kind == "pill_classic" and value:
            self._draw_pill(left + width // 2 - 11, top, 22, value.upper(),
                            *self.CLASSIC_COLOUR.get(value.upper(), (theme.color("surface_alt"),
                                                                     theme.color("text"))))
            return
        if kind == "pill_mantra":
            x = left + 4
            for code in [part for part in (value or "").split("/") if part.strip("- ")]:
                label = code.strip().capitalize()
                pill = 9 + len(label) * 6
                if x + pill > left + width:
                    break                          # what does not fit is not drawn half
                self._draw_pill(x, top, pill, label,
                                *self.MANTRA_COLOUR.get(code.strip().lower(),
                                                        (theme.color("surface_alt"),
                                                         theme.color("text"))))
                x += pill + 2
            return
        colour = theme.color("text")
        if kind == "num" and number is not None:
            # ABOVE or BELOW THE SHEET'S MEAN, in the theme's own semantic pair - the operator's own
            # definition of positive and negative, and the reference is every player of every club in the
            # file rather than the club on screen. Not decoration: it is what turns a column of numbers
            # into a reading, because 6.3 of predicted fantamedia means nothing until you know that the
            # sheet's average is 6.1. `inj` is inverted (`HIGHER_IS_WORSE`): missing MORE of a season
            # than the average man is bad news, so it reads red.
            mean = self._column_means().get(key)
            if mean is not None:
                better = number < mean if key in self.HIGHER_IS_WORSE else number > mean
                worse = number > mean if key in self.HIGHER_IS_WORSE else number < mean
                colour = (theme.color("ok") if better
                          else theme.color("error") if worse else colour)
        elif key == "real" and value:
            # the real role in its LINE's colour, the same four families the pitch badges use
            line = self.LANE_OF_ROLE.get((self.real_roles(row) or [""])[0], "")
            colour = {"P": "#f2a93b", "D": "#2e9b52", "C": "#1f6fb2", "A": "#d1443c"}.get(
                {"P": "P", "D": "D", "M": "C", "T": "C", "A": "A"}.get(line, ""), colour)
        x, where = left + 5, "w"
        if anchor == "e":
            x, where = left + width - 5, "e"
        elif anchor == "center":
            x, where = left + width // 2, "center"
        body.create_text(x, middle, text=value or "", anchor=where, fill=colour,
                         font=theme.FONTS["body"])

    def _draw_pill(self, left: int, top: int, width: int, label: str, fill: str, text: str) -> None:
        """A rounded role chip - the same shape and palette as the badge on the pitch, so that the table
        and the board name a role in one language."""
        _round_rect(self.table_body, left, top + 3, left + width, top + self.ROW_H - 3, 8,
                    fill=fill, outline=fill)
        self.table_body.create_text(left + width // 2, top + self.ROW_H // 2, text=label, fill=text,
                                    font=theme.FONTS["small"])

    def _fill_table(self) -> None:
        self._draw_head()
        body = self.table_body
        body.delete("all")
        body.configure(background=theme.color("surface"))
        self._sparks = []
        self._table_rows = self._sorted(self.rows)
        total = self._table_width()
        for index, row in enumerate(self._table_rows):
            top = index * self.ROW_H
            if index % 2:
                body.create_rectangle(0, top, total, top + self.ROW_H,
                                      fill=theme.color("surface_alt"), outline="")
            cells = self._cell_values(row)
            left = 0
            for key, _title, width, anchor, kind in self.COLUMNS:
                text, number = cells.get(key, ("", None))
                self._draw_cell(key, kind, text, left, top, width, anchor, row, number)
                left += width
        body.configure(scrollregion=(0, 0, total,
                                     max(len(self._table_rows) * self.ROW_H, 1)))
        self._sync_hscroll()

    @staticmethod
    def _formation(info: dict, mode: str = "typical") -> tuple[str, str]:
        """(shape, where it comes from), for the mode being shown.

        `typical` - the shape the coach actually uses over a year: the MODE of his complete elevens,
        with the share saying how settled it is. When that share is high the shape is his PREFERRED one
        and nothing else overrides it, which is the point: a single matchday cannot outvote a season.

        `next` - the next match, from fact to forecast: the shape it actually FIELDED that week when the
        sheet is back-dated (the outcome exists, so nothing guesses at it); then the probabili's own
        formation when there is a snapshot, because that is the coach's declared choice for THAT game;
        then the preferred shape - and where the coach has no preferred shape (he alternates), the
        fallback says so.
        """
        typical = info.get("formation_typical")
        share = _number(info.get("formation_typical_share"), None)
        settled = info.get("formation_settled") == "yes"
        today = info.get("formation_today")
        fielded, when = info.get("formation_next_fielded"), info.get("next_match_date")
        if mode == "next" and fielded:
            return fielded, f"FIELDED on {when} - a fact, not a forecast"
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

    # How much stronger an eleven another shape has to field before the board stops drawing the club's
    # own modal one, in SHARES OF A SEASON summed over the eleven (0.30 = one shirt going from a 20% man
    # to a 50% one). The modal shape is evidence about the coach and is not overturned by noise; a shape
    # that asks for a player the squad has not got is not evidence about anything.
    # Three, because how much the mode is worth is itself measured: `formation_settled` = a habit,
    # `under_coach = 0` = the shape of a side that no longer exists (a summer coach change), and in
    # between a coach still choosing. DISPLAY parameters - the pitch is descriptive, nothing here reaches
    # the engine - and they were set by measuring what each one changes across the 34 euro clubs.
    # How much of the prior comes from THIS CLUB's own elevens rather than from the league's: 0.40 when
    # none of the measured sample is the current coach's (the distribution is his predecessor's, so what
    # the league does at large is the better guess), 0.90 when all of it is his. Between the two it moves
    # with the share that is his.
    SHAPE_TRUST_FLOOR: ClassVar[float] = 0.40
    SHAPE_TRUST_RANGE: ClassVar[float] = 0.50
    # ...and the third source: what the man in charge NOW lines up in, wherever he has been
    # (`coach_shapes`). It takes the place of the LEAGUE's share of the prior, not the club's, and that is
    # the whole argument - the league repertoire is the generic guess for «what would a side do here», and
    # a coach's own 188 elevens are a specific answer to it. The club's habit is untouched: where the
    # sample IS his, `SHAPE_TRUST_*` already gives it 0.90 and this barely shows.
    # WEIGHED BY ITS OWN SAMPLE, because the sample is wildly uneven and a floor is not optional: Sarri
    # arrives with 188 elevens (4-3-3 at 86%), Amorim 47 (3-4-3 96%), Maresca 57 (4-5-1 98%) - and Tedesco
    # with 3, Gattuso with 2, Mourinho with 1, Iraola and Filipe Luís with NONE, because their careers
    # were spent outside the five leagues we parse. With n = 2 the mode is noise and it would overwrite a
    # club habit that is already right (Lazio: the club says 4-3-3, which is what the sources predict, and
    # Gattuso's two elevens say 3-3-4).
    # Ramped and not a cliff, so nothing turns on one eleven either side of the line.
    # RE-MEASURED AGAINST THE EXTERNAL JUDGE and CONFIRMED (08/08/2026, todolist item 4). The values
    # were calibrated on samples the name join had BROKEN (v9.38), so they were quoting numbers nobody
    # had re-measured; the internal judge (gate §7-quinvicies, 48 cases) said «raise, do not lower» off
    # bands of 6-17 cases, too thin to move anything. The press reference answers the question the
    # internal one cannot - how the thresholds do against a FORECAST of the season being auctioned -
    # on a pre-registered grid, MIN in (10, 15, 20, 30, 40) x span in (20, 40, 60):
    #     every cell from 10/50 to 40/80 returns the SAME 11 MATCH / 5 ALT / 4 DIFF, 165-166 men.
    #     Only the extremes move it: 10/30 turns an ALT into a DIFF, 40/100 loses a MATCH.
    # So the verdict is FLAT and 20/60 sits in the middle of the plateau. Two independent judges, and
    # neither asks to move them: the question is closed rather than left open, and what would reopen it
    # is a bigger reference, not a finer grid.
    COACH_SHAPE_MIN: ClassVar[int] = 20
    COACH_SHAPE_FULL: ClassVar[int] = 60
    # How many matchdays weaker an eleven has to be for the shape to be half as likely: a coach does not
    # field the module that forces a 5% squad player onto the pitch, but half a matchday is nothing.
    SHAPE_FIT_SCALE: ClassVar[float] = 0.60
    # Below this share of the league's own elevens a shape is not a formation. MEASURED, not chosen: on
    # 2025-26's 4812 complete elevens it separates the seven real modules (5-4-1, the rarest, is at 2.5%)
    # from four tails of two elevens each - 2-6-2, 4-2-4, 4-6-0 - which are parsing artefacts.
    LEAGUE_SHAPE_FLOOR: ClassVar[float] = 0.01

    @staticmethod
    def observed_shapes(info: dict) -> dict[str, int]:
        """{shape: how many times the club fielded it}, from `formation_shapes`."""
        out: dict[str, int] = {}
        for part in (info.get("formation_shapes") or "").split(";"):
            shape, _, count = part.partition(":")
            if shape.strip() and count.strip().isdigit():
                out[shape.strip()] = int(count)
        return out

    @staticmethod
    def friendly_shapes(info: dict) -> tuple[dict[str, float], int]:
        """({shape: its share of the PRE-SEASON elevens}, how many there were).

        The target season's own elevens, which before a competitive match is the training camp - the
        only football played by the side that will take the field, and the only source that can say
        what the coach has ANNOUNCED for this squad rather than what he has done elsewhere. Read as a
        distribution and not as a mode: with two elevens a mode is a coin.
        """
        counts: dict[str, int] = {}
        for part in (info.get("friendly_shapes") or "").split(";"):
            shape, _, count = part.partition(":")
            if shape.strip() and count.strip().isdigit():
                counts[shape.strip()] = int(count)
        total = sum(counts.values())
        if not total:
            return {}, 0
        return {shape: count / total for shape, count in counts.items()}, total

    def league_shapes(self) -> dict[str, float]:
        """{shape: its share of the LEAGUE's complete elevens} - what counts as a formation at all.

        The club's own history answers "what does this coach do"; this answers "is this a module".
        Without it the board could only ever redraw a shape the club had already used, which is wrong for
        exactly the case that matters at an auction: a side rebuilt over the summer, whose new coach will
        line it up in something this squad has not played yet.
        """
        repertoire = self.manifest.get("formation_repertoire") or {}
        total = sum(repertoire.values())
        if not total:
            return {}
        return {shape: count / total for shape, count in repertoire.items()
                if count / total >= self.LEAGUE_SHAPE_FLOOR}

    def coach_shapes(self, info: dict) -> tuple[dict[str, float], int]:
        """({shape: his share of them}, how many elevens they are) — what the man in charge NOW lines up in.

        The third source, from `coach_shapes` in the sheet: his own elevens, every spell and every
        competition (`snapshot.coach_repertoire`). It answers the question neither of the other two can -
        the club's history says what THIS SIDE does, the league's repertoire says what a formation IS -
        and for a summer coach change it is the only one that is about the side that will take the field.
        The count comes back with it because the sample decides how much it may be worth.
        """
        out: dict[str, float] = {}
        for part in (info.get("coach_shapes") or "").split(";"):
            shape, _, count = part.partition(":")
            if shape.strip() and count.strip().isdigit():
                out[shape.strip()] = float(count)
        total = _number(info.get("coach_shapes_of"), 0.0) or sum(out.values())
        return ({shape: count / total for shape, count in out.items()} if total else {}), int(total)

    def plausible_shapes(self, info: dict) -> dict[str, tuple[int, float]]:
        """{shape: (elevens THIS club played it in, its share of the league's)}, the club's first.

        Two kinds of plausible, and the difference is kept visible rather than merged into one list: a
        shape with a count is a habit of this side, one with a count of zero is a module of the league
        that this side has not used. Both can be drawn; only the first is drawn by default.
        A shape the COACH lines up in is plausible too, even where neither the club nor the league floor
        offers it: Sarri's 4-3-3 has to be reachable at a club that spent the year in a back three.
        """
        own = self.observed_shapes(info)
        league = self.league_shapes()
        out = {shape: (count, league.get(shape, 0.0))
               for shape, count in sorted(own.items(), key=lambda item: -item[1])}
        for shape, share in sorted(league.items(), key=lambda item: -item[1]):
            if shape not in out:
                out[shape] = (0, share)
        his, sample = self.coach_shapes(info)
        if sample >= self.COACH_SHAPE_MIN:
            for shape, share in sorted(his.items(), key=lambda item: -item[1]):
                if shape not in out and share >= self.LEAGUE_SHAPE_FLOOR:
                    out[shape] = (0, 0.0)
        return out

    def shape_odds(self, club: str, info: dict, mode: str) -> dict[str, float]:
        """{shape: how likely this side is to line up in it}, summing to 1. A DISPLAY estimate.

        FOUR things decide it, and none of them is enough on its own:
          * what THIS CLUB lines up in (`formation_shapes`) - a habit, and the strongest signal there is;
          * what the COACH lines up in, wherever he has been (`coach_shapes`) - because the club's history
            may be his PREDECESSOR's, and then it describes a side that no longer exists while he is the
            side that will take the field. Weighed by ITS OWN sample (`COACH_SHAPE_MIN/FULL`), because it
            runs from 188 elevens to none at all;
          * what the LEAGUE lines up in (`formation_repertoire`) - the generic answer to «what would a side
            do here», which is what the coach's own history replaces when we have it. `SHAPE_TRUST_*` is
            how much of the prior comes from the club, and it moves with the share of the sample that is
            the current coach's;
          * whether the SQUAD can man it - the eleven each shape fields, in matchdays, on the same
            percentages the shirts show. A shape whose slots force a 5% squad player onto the pitch is
            not one a coach picks, and `SHAPE_FIT_SCALE` is how many matchdays halve its odds.
        Not gated and not a prediction of anything the engine values: it orders the shapes a human is
        choosing between, and it is shown as a percentage so that choice can be made with a number.
        """
        options = self.plausible_shapes(info)
        if not options:
            return {}
        if mode == "next" and info.get("formation_today"):
            return {info["formation_today"]: 1.0}      # the coach has declared it
        own = self.observed_shapes(info)
        played = sum(own.values())
        under_coach = _number(info.get("formation_typical_under_coach"), 0.0)
        his = (under_coach / played) if played else 0.0
        trust = self.SHAPE_TRUST_FLOOR + self.SHAPE_TRUST_RANGE * min(1.0, max(0.0, his))
        # ...and how much of what is LEFT is his own history rather than the league's, ramped on his sample
        coach_share, sample = self.coach_shapes(info)
        span = self.COACH_SHAPE_FULL - self.COACH_SHAPE_MIN
        mine = (0.0 if sample < self.COACH_SHAPE_MIN
                else min(1.0, (sample - self.COACH_SHAPE_MIN) / span) if span > 0 else 1.0)
        scores = {shape: self.shape_matchdays(club, shape, mode) for shape in options}
        best = max(scores.values())
        weights: dict[str, float] = {}
        # THE PRE-SEASON, which is the only thing that has seen THIS squad under THIS coach. Weighed by
        # its own sample like the coach's repertoire, and it is a small one by nature (1-3 complete
        # elevens per club): `PRESEASON_FULL` is how many it takes to be worth its full weight.
        preseason, friendly_xis = self.friendly_shapes(info)
        camp = (min(1.0, friendly_xis / self.PRESEASON_FULL) * self.PRESEASON_WEIGHT
                if friendly_xis else 0.0)
        for shape, (count, league_share) in options.items():
            generic = mine * coach_share.get(shape, 0.0) + (1 - mine) * league_share
            prior = trust * (count / played if played else 0.0) + (1 - trust) * generic
            prior = (1 - camp) * prior + camp * preseason.get(shape, 0.0)
            # exp(-gap / scale): smooth, so half a matchday is nothing and two are decisive
            weights[shape] = prior * math.exp((scores[shape] - best) / self.SHAPE_FIT_SCALE)
        total = sum(weights.values())
        if not total:
            return {}
        return dict(sorted(((shape, weight / total) for shape, weight in weights.items()),
                           key=lambda item: -item[1]))

    def board_shape(self, club: str, info: dict, mode: str) -> tuple[str, str]:
        """(the shape to DRAW, why). The likeliest one, unless the operator asked for another.

        For the coming match the probabili's own shape beats every estimate and is not second-guessed.
        Otherwise the board draws the top of `shape_odds` - which is the club's habit unless the squad
        cannot man it, because that is exactly what the odds are built from.
        """
        odds = self.shape_odds(club, info, mode)
        picked = self._shape_choice.get((club, mode))
        if picked and picked in odds:
            return picked, f"your choice · {odds[picked]:.0%} likely, of what this side plays"
        if not odds:
            return self._formation(info, mode)
        cached = self._shape_cache.get((club, mode))
        if cached:
            return cached
        best = next(iter(odds))
        measured = info.get("formation_typical")
        why = (f"{odds[best]:.0%} likely" if best == measured else
               f"{odds[best]:.0%} likely against {odds.get(measured, 0):.0%} for the measured {measured}: "
               f"with these men it fields "
               f"{self.shape_matchdays(club, best, mode) - self.shape_matchdays(club, measured, mode):+.1f}"
               f" matchdays")
        self._shape_cache[(club, mode)] = (best, why)
        return best, why

    def shape_matchdays(self, club: str, shape: str, mode: str) -> float:
        """What the eleven this shape fields adds up to: the shirts' own percentages, summed.

        NOT what the shape's own places cost it, which was tried on Marseille («un centrocampo a 5 deve
        avere 2 esterni»: its only right-sided man is its right BACK, so a 4-5-1 cannot man both flanks of
        its five while a back three frees him for one) and REVERTED. Charging a shape for a place nobody in
        the row plays moves 13 boards of 108 at 2 matchdays a place - Como onto a "3-3-1-3", Barcelona off
        the 4-2-3-1 and Napoli back onto the 3-5-2, i.e. it un-fixed two boards the operator had just ruled
        on to fix a third. That is the project's own signal that the MODEL is wrong and not the value, so it
        is written down here instead of tuned: what a squad cannot man is repaired where the men are chosen
        (`_flanked`, `_pointed`) and drawn (`_reshape`), never by re-ranking the modules a club plays.
        """
        horizon = "recent" if mode == "next" else "season"
        return sum(self.claim(starter, horizon)
                   for _role, starter, _rivals in self.eleven(club, shape, mode))

    # ---------- the men whose marker is inverted ----------
    # At most three per club, and every condition has to hold at once - a high surplus with a rival on
    # his shoulder is not a certainty, and a certainty worth nothing is not a top player.
    TOP_PLAYERS: ClassVar[int] = 3
    # Where the bar is. The surplus is read as a PERCENTILE of the sheet, because it is measured against
    # a replacement level that depends on the league's squad size - an absolute 5.0 would mean one thing
    # in an 8-team league and another in a 12-team one. On the 2026-27 euro sheet p90 is 5.5 points.
    TOP_SURPLUS_PERCENTILE: ClassVar[float] = 0.90
    # What replaced titolarita, and it is the better question: does he ALWAYS play a real number of
    # minutes? Read per match off the trend detail and only on LEAGUE matches - which is also what makes
    # it comparable between clubs, where titolarita is not: titolarita's denominator is the club's own
    # matches and we parse a different mix of competitions per club (Arsenal 58 = 38 league + 14
    # European + 6 cup, Napoli 38 = league only), so Kane reads 49% for playing nearly everything.
    # 70 minutes is "he finished the match" allowing for a late substitution; 70% of the league matches
    # in the window is "always" allowing for one rest in three. A minimum of four league matches, because
    # a share over two is not a share. Measured on euro 2026-27: 25 men over 34 clubs.
    TOP_MINUTES_FULL: ClassVar[float] = 70.0
    TOP_MINUTES_ALWAYS: ClassVar[float] = 0.70
    TOP_MINUTES_MATCHES: ClassVar[int] = 4
    # "Ballottaggio quasi nullo": his likeliest challenger is well under him, so the shirt is his.
    TOP_DUEL_SHARE: ClassVar[float] = 0.60

    @classmethod
    def full_match_share(cls, row: dict) -> tuple[float, int]:
        """(share of his club's recent LEAGUE matches he played nearly all of, how many there were).

        Per match, not on average: an average of 60 minutes is the same number for a man who plays every
        match to the 70th and for one who alternates 90 with 20, and only the first is a top player. The
        cups are left out on purpose - they are not what the fantamedia is scored on, and counting a
        rested man's cup rest against him is what made an absolute minutes bar reward the clubs that play
        fewest matches.
        """
        played = total = 0
        for entry in (row.get("desc_form_detail") or "").split(";"):
            if not entry:
                continue
            fields = (entry.split("|") + [""] * 10)[:10]
            if competition_class(fields[1]) != "league":
                continue
            total += 1
            played += _number(fields[5]) >= cls.TOP_MINUTES_FULL
        return (played / total if total else 0.0), total

    def top_players(self, club: str, mode: str) -> list[str]:
        """The (at most three) men of this club whose every number is good at once, best surplus first.

        A conjunction and not a score: a top player has to play nearly every league match nearly whole,
        AND be worth something, AND have nobody on his shoulder - averaging the three would let a huge
        surplus carry a man who is on the pitch for twenty minutes. Nothing here is fitted (the surplus
        bar is a percentile of the sheet, the rest are shares of matches) and nothing reaches the engine:
        it decides which markers are drawn inverted.
        """
        cached = self._top_cache.get((club, mode))
        if cached is not None:
            return cached
        horizon = "recent" if mode == "next" else "season"
        shape, _why = self.board_shape(club, self.clubs.get(club, {}), mode)
        eleven = self.eleven(club, shape, mode)
        floor = self._surplus_floor()
        picked: list[tuple[float, str]] = []
        for _role, starter, rivals in eleven:
            surplus = _number(starter.get("engine_surplus"))
            always, matches = self.full_match_share(starter)
            # the duel is a RATIO between two men of the same club, so the denominator that makes
            # titolarita incomparable between clubs cancels out and it can be read straight
            share = self.claim(starter, horizon)
            challenger = max((self.claim(row, horizon) for row in rivals), default=0.0)
            if (matches >= self.TOP_MINUTES_MATCHES and always >= self.TOP_MINUTES_ALWAYS
                    and floor is not None and surplus >= floor
                    and challenger <= self.TOP_DUEL_SHARE * share
                    and not starter.get("desc_injury_open")
                    and starter.get("desc_availability_now") not in ("injured", "suspended")):
                picked.append((surplus, starter.get("name") or ""))
        out = [name for _surplus, name in sorted(picked, reverse=True)[:self.TOP_PLAYERS]]
        self._top_cache[(club, mode)] = out
        return out

    def _surplus_floor(self) -> float | None:
        """The sheet's own `TOP_SURPLUS_PERCENTILE` of surplus - None when the sheet has no valuation."""
        if self._surplus_cut is None:
            values = sorted(_number(row.get("engine_surplus")) for row in self.players
                            if row.get("engine_surplus") not in (None, ""))
            self._surplus_cut = (values[min(len(values) - 1,
                                            int(len(values) * self.TOP_SURPLUS_PERCENTILE))]
                                 if values else None)
        return self._surplus_cut

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
    # The band the lines are spread over. Widened once the plates grew a rival line: below the attack
    # sat 17% of the canvas that nothing used, and above the keeper 7% where only his marker goes (his
    # plate is drawn BELOW him, and a lane of one man never staggers). Measured effect on a 493px pitch:
    # a five-line shape's rows go from 94px apart to 102, i.e. from ~2px of clearance between two facing
    # plates to ~14 - and the bottom plate still ends 15px inside the pitch.
    LANE_TOP: ClassVar[float] = 0.05
    LANE_BOTTOM: ClassVar[float] = 0.88

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
            if self._lanes_final:
                # The eleven was ASSIGNED to a shape's own places (`_assign`), so the lane is a decision
                # already taken and re-reading it from his primary code would undo it: Santos is `LW`, and
                # the declared four gave him its left flank precisely because it needed a man who plays
                # there. Only the two paths with a declared shape set this.
                lanes.setdefault(role, []).append((starter, rivals))
                continue
            if id(starter) in self._reshaped:
                # The TRANSFORMATION moved him (`_reshape`), and it moved him precisely because no code of
                # his plays where the shape needed a man - so re-reading his codes here would send him
                # straight back and the board would deny a decision the eleven has already taken.
                lanes.setdefault(role, []).append((starter, rivals))
                continue
            codes = self.real_roles(starter)
            lane = self.LANE_OF_ROLE.get(codes[0] if codes else "", "M" if role == "C" else role)
            # ...unless one of his OTHER codes is the line he was actually chosen for. The eleven picks a
            # man for a line, and since it reads every code (Spinazzola is 'ML;DL' and can be its left
            # back), drawing him by his first code alone contradicted the choice: he was picked as the
            # left back and drawn among the midfielders, so the board said 3-4-3 for a back four.
            if lane != role and role in {self.LANE_OF_ROLE.get(code) for code in codes}:
                lane = role
            # AND THAT IS THE ONLY MOVE IT MAY MAKE: one row FORWARD, out of the midfield onto the
            # trequarti, for a man on a CENTRAL place. What the re-read is FOR is the DEPTH of a central
            # midfielder - the 4-5-1 that is really a 4-4-1-1 - and there it takes nothing away, because
            # the men beside him keep the row's own shape. Every other direction empties a place the shape
            # asked somebody to cover, and «il modulo non può perdere la simmetria». All three measured:
            #   * across the module's LINES, on Liverpool's 4-5-1: the assignment gave Gakpo (`LW`) the
            #     five's LEFT flank and Gravenberch (`MC;DM`) the back four's second centre, both by fit
            #     and both priced, and this read sent Gakpo to the attack and Gravenberch to the midfield.
            #     The board drew a back THREE, a five squeezed into the right half with its left touchline
            #     empty, and a front two of two left-sided men;
            #   * off a FLANK, on Bayer Leverkusen's 3-4-3: Tella held the four's right and his first code
            #     is `AM`, so he was drawn among three trequartisti and the four had no right flank at all
            #     - a 3-3-3-1, which is no module;
            #   * BACKWARD onto the row, on Verona's 3-5-1-1: the module NAMES a trequartista, the fit put
            #     a `MC` there, and reading him back into the row made it a six and left the trequarti
            #     empty - two things a coach does not do, at once.
            # A man given a place he plays no line of is the transformation's business (`_reshape`, which
            # prices the move and is gated by `LINE_REACH`), not a second opinion here.
            if (role, lane) != ("M", "T") or self._slot_side.get(id(starter), "C") != "C":
                lane = role
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

    # Which flank a PREFERRED FOOT suggests, per line, on the same -1 (the team's left) .. +1 scale as
    # everything else here. MEASURED on this DB, not assumed, and the two lines disagree - which is the
    # whole reason it is a table and not a rule of thumb (`desc_foot`, the provider's own field, against
    # the season heatmap; 2025-26, repeated on 2024-25 with the same signs):
    #   * a full back or a wide midfielder plays HIS OWN foot: DL 96% left-footed, DR 96% right,
    #     MR 98% right, ML 68% left (n = 103 / 126 / 54 / 40);
    #   * a winger is INVERTED: LW 86% right-footed, RW 69% left-footed (n = 95 / 90). Placing a
    #     left-footer on the left in attack would therefore be backwards more often than not;
    #   * and a nominal CENTRE back with no flank in his code still leans: left-footed DCs measured
    #     -0.309 mean side, 93% of them left of centre, against +0.167 and 69% right for right-footed
    #     ones (n = 29 / 80). That is the "difese a piedi diversi" case, and it is the one where no
    #     code says anything at all.
    # A TIE-BREAK and nothing more: it decides which of two men already chosen stands on which side, and
    # it never picks the eleven - the shirt goes to who plays, which is what presence already answers.
    FOOT_SIDE: ClassVar[dict[str, float]] = {"right": 1.0, "left": -1.0}

    # The class-level defaults are the empty answers - "no eleven has been built yet", "nobody is
    # unticked", "no sheet, so no mean" - so a lane can be drawn and a cell coloured before a panel has
    # been through `__init__`. Every instance rebinds all three there, and loading a sheet resets them.
    _slot_side: ClassVar[dict[int, str]] = {}
    _reshaped: ClassVar[set[int]] = set()
    _lanes_final: ClassVar[bool] = False
    _excluded: ClassVar[set] = set()
    _means: ClassVar[dict[str, float] | None] = None
    _trend_pool: ClassVar[dict[str, float] | None] = None

    @staticmethod
    def build(row: dict) -> str:
        """His PHYSICAL profile: '191 cm · 78 kg', or as much of it as the provider gave.

        It is on the plate because it is the one thing `ST` cannot say and an operator asks first: a punta
        centrale who plays as a TORRE and one who plays on the move are the same code (Hojlund 191 and
        Vlahovic 190 against David 180 and Boga 172). Weight is thinner than height at the source - 343 of
        953 men - so the string carries what exists and nothing more.

        DESCRIPTIVE, and deliberately not a criterion. The obvious use - «most coaches field the tall
        physical one» - was MEASURED before being believed and it does not hold: over 92 club-seasons where
        two strikers each started at least five league matches, the more used of the two is the TALLER one
        44 times, 48%, with the seasons scattered from 14% to 69%. A coin. What the hypothesis is really
        about is how a side PLAYS (crosses, aerial duels, long balls), and none of those are in the
        per-match layer - so it stays a reading for the human, in the tooltip, and nothing selects on it.
        Details: gate §5-terdecies.
        """
        parts = [f"{int(_number(row.get(key)))} {unit}"
                 for key, unit in (("desc_height", "cm"), ("desc_weight", "kg"))
                 if _number(row.get(key), None)]
        return " · ".join(parts)

    def preseason(self, row: dict) -> str:
        """«PRE-SEASON: started 2 of 2 friendlies under Maurizio Sarri» — a reading, never a criterion.

        For an August auction the pre-season is the only football a new coach has played, and on the case
        the operator brought it looks decisive: Atalanta's two friendlies under Sarri were started by
        Gaetano, Samardzic, Scamacca and Raspadori - the four men the published prediction fields and the
        claim does not - while De Roon, Ederson and Krstovic, whom the board starts, started NEITHER.
        It stays off every decision anyway, for five reasons that are measured and not guessed
        (`snapshot.preseason_starts`): per-player friendlies exist for ONE pre-season, so no out-of-sample
        test can be built; the sample is 1-3 matches and two of the seven Serie A clubs with a new coach
        have none; minutes and ratings are missing from 1399 of 1716 rows; the fixtures are against a U23
        side and a Serie C club, where a starting eleven is not a competitive statement; and the one
        external source that agrees is not independent, because it read the same friendlies.
        So the plate says it and the eleven ignores it - the same treatment as the body, and for the same
        reason (gate §5-terdecies). Whoever is bidding can see «0 of 2» under a 90% shirt and decide; the
        tick is already there for acting on it.
        """
        matches = _number(row.get("desc_preseason_matches"), 0.0)
        if not matches:
            return ""
        started = int(_number(row.get("desc_preseason_starts"), 0.0))
        coach = ((self.clubs.get(row.get("club") or "") or {}).get("coach") or "").strip()
        return (f"PRE-SEASON: started {started} of {int(matches)} "
                f"{'friendly' if matches == 1 else 'friendlies'}"
                + (f" under {coach}" if coach else "")
                + " — a reading, not a criterion: it decides nothing here")

    @classmethod
    def foot_side(cls, row: dict, lane: str) -> float:
        """+1 his foot suggests the team's right .. -1 its left, 0.0 unknown or two-footed."""
        value = cls.FOOT_SIDE.get((row.get("desc_foot") or "").strip().lower(), 0.0)
        return -value if lane == "A" else value

    def across_bucket(self, row: dict, lane: str = "M") -> int:
        """Which THIRD of a line's width he belongs in: +1 the team's right, 0 the middle, -1 its left.

        THE SLOT HE WON DECIDES IT. The shape asked for a right, a centre and a left (`slot_shape`) and
        `_slot_price` handed those three shirts out reading every code the man has; re-deriving the side
        here from his primary code alone threw that reasoning away, and two men whose code names the same
        flank then took the two outer slots between them. Napoli's front three was drawn Politano - Neres
        - Hojlund because Politano and Neres are both 'RW': the centre-forward was pushed to the LEFT
        wing while the winger stood in the middle, with the shape's own answer (Hojlund central) already
        computed and discarded.

        Where no slot was handed out - the editors' declared eleven, the one really fielded - it falls
        back to his own flank, which is what this always did.
        """
        slot = self._slot_side.get(id(row))
        if slot:
            return {"R": 1, "C": 0, "L": -1}[slot]
        side = self.flank(row)
        return 1 if side > 0.34 else -1 if side < -0.34 else 0

    @classmethod
    def sides_of(cls, row: dict) -> set[str]:
        """Every side he can cover, from ALL his granular codes - not just the primary one.

        A 'DC;DL' is a centre back who also plays left back, and that IS in his repertoire; a 'DC' alone
        is not, and asking him to play wide is the thing a coach does last. With no codes at all this
        falls back to the single side `side_of` derives from the Mantra role or the heatmap.

        It reads the CODES and not the heatmap, and the asymmetry is the operator's own model: a code is
        what he CAN do, a measurement is what he DID, and eligibility is a question about the first one.
        Adding the flank the heatmap saw him on was tried and swept (0.34 / 0.50 / 0.70 / 0.85) and changes
        nothing at any threshold - because a code list ALREADY carries it: Zé Pedro reads `DC;DR` with 75%
        of his touches in the right band, and the R is in his codes, just not first. What the primary code
        alone missed, every code together has. See `HEATMAP_SIDE`'s note for the whole family of these.
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

    # How far up the pitch each LINE of a module stands, on the same 0..1 axis as the twelve codes
    # (`REAL_ROLE_DEPTH`: a full back 0.25, a central midfielder 0.60, a winger 0.80, a striker 1.0).
    # It is what lets a slot say which LINE it belongs to and not only which flank: the sides alone made
    # a centre back and a winger equally good candidates for the left of a MIDFIELD five, and once a line
    # short of its own men could borrow, Bayern's fifth midfielder was a centre back.
    LANE_DEPTH: ClassVar[dict[str, float]] = {"P": 0.0, "D": 0.25, "M": 0.60, "T": 0.80, "A": 0.90}

    def _line_gap(self, row: dict, lane: str) -> int:
        """How far that LINE is from the one he plays, on the `LANE_DEPTH` grid x20: one full line is 7.

        The NEAREST of his codes, not the first one: Spinazzola is `ML;DL`, so reading the primary charged
        him seven steps for a defensive slot and Napoli's left back became a 38% man while the 54% one
        stayed out. A pure centre back still pays the two steps up to a midfield line - what is gone is the
        penalty for a position he actually plays. With no observed code at all, his listone line answers.

        This used to be the third term of a `slot_cost` tuple that also priced the FLANK and what the role
        allows - a second listino beside `_slot_price`, and the two disagreed: `slot_cost` said a front
        line's wide place is a forward's and `_slot_price` did not, which is how a wing back outbid
        Fiorentina's third striker (`_off_the_front`). One pricer decides who gets a place; all this needs
        to answer is `_within_reach`, and a gate is not a price.
        """
        depths = [REAL_ROLE_DEPTH[code] for code in self.real_roles(row)
                  if code in REAL_ROLE_DEPTH] or [self.LANE_DEPTH.get(self.lane_of(row), 0.60)]
        return round(min(abs(depth - self.LANE_DEPTH.get(lane, 0.60)) for depth in depths) * 20)

    # What each slot of a line IS, in the module's own terms - the Mantra scheme vocabulary again. A
    # back three is three CENTRE BACKS (a full back may adapt into one of the outer two, which is what
    # `_slot_price` charges him for); a midfield four is two wide men and two centrals; a front three
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
        # one or two trequartisti are central by definition (a winger there pays the side in `_slot_price`);
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
    # THE PRESENCE PARAMETERS, all provisional and all owned by the gate (7-bis): the two discounts for a
    # season measured elsewhere, the recency of the injury history, the availability floor, how starts and
    # minutes are weighed, and which absences come off the denominator of a start rate. They live in
    # `engine.presence` with the formulas that read them, so `sweep` can score the same functions this
    # panel draws - a constant no harness can reach is a constant nobody can sweep.
    # The panel's parameters are the engine's, with ONE addition it declares: a window measured elsewhere
    # counts toward the standing (`window_standing`), because otherwise the board draws a standing of ZERO
    # for a man whose presences the engine predicts from exactly those matches (R13, adopted on Serie A) -
    # two answers to one question, and the one on screen the more wrong of the two. It is a DISPLAY choice
    # until gate §7-octies runs, like `FORM_WEIGHT` and `RECENT_PRIOR`, and every gated number is computed
    # with `presence.DEFAULTS`, where it is off.
    PRESENCE: ClassVar[presence.Params] = replace(presence.DEFAULTS, window_standing=1.0)
    AVAILABILITY_FLOOR: ClassVar[float] = PRESENCE.availability_floor
    STANDING_WEIGHTS: ClassVar[tuple[float, float]] = PRESENCE.standing_weights
    LOAN_DISCOUNT: ClassVar[float] = PRESENCE.loan_discount
    ARRIVAL_DISCOUNT: ClassVar[float] = PRESENCE.arrival_discount
    # For the NEXT matchday, form leads and standing is the ballast - with RECENT_PRIOR matches' worth of
    # standing mixed into a ten-match window, which is what stops an empty or a dead-rubber window from
    # deciding a side. These two stay here: they are about the panel's `recent` horizon, which is a
    # reading of the last ten matches and not part of the season model the gate sweeps.
    FORM_WEIGHT: ClassVar[float] = 0.60
    RECENT_PRIOR: ClassVar[float] = 3.0

    def population(self) -> list:
        """The rows every POPULATION statistic is measured over: the SHEET, and not the club on screen.

        Found 08/08/2026, driving the real panel instead of a harness. `self.rows` is assigned in
        `_show_club` and holds ONE CLUB's squad - 25-43 players - while the five statistics that read it
        (the shrinkage prior and the four z-scores) all say «this sheet» in their own docstrings and were
        measured on a sheet. Two things went wrong at once and only the second was visible: a mean over
        32 men where the bands hold one or two, so the adopted `standing_prior_rounds` was shrinking
        toward noise; and sd over a single club's movers, which is zero or near it, so `level_z` and
        `level_gap_z` - both ADOPTED - came out None or wild. Milan's keeper read 99% of claim in the
        panel against 85% in every harness, and the board drew the predecessor's 3-5-2 instead of
        Amorim's 3-4-3, because the odds are built on those same claims.
        Falls back to the club on screen only when no sheet is loaded, which is what the tests build.
        """
        return getattr(self, "players", None) or getattr(self, "rows", None) or []

    def presence_inputs(self, row: dict) -> presence.Inputs:
        """One row of the sheet, as `engine.presence` wants it: the numbers, with their units settled.

        This is where the sheet's column names stop and the model starts. The formulas live in
        `engine/presence.py` because the constants in them are MODEL choices the gate owns (7-bis), and a
        parameter no harness can reach is a parameter nobody can sweep: `sweep` scores the very same
        functions against what actually happened, so panel and gate cannot drift apart.
        """
        base = presence.Inputs(
            starts=_number(row.get("desc_season_starts")),
            appearances=_number(row.get("desc_season_matches")),
            minutes=_number(row.get("desc_minutes_full_season")),
            league_matches=self.season_calendar(row),
            fixtures=self.club_fixtures(row.get("club")) or self.SEASON_MATCHES,
            # counted rounds where a calendar existed, and `rounds_seasons` = 0 says it did not
            rounds_measured=(_number(row.get("desc_injury_rounds_measured"))
                             if _number(row.get("desc_injury_rounds_seasons")) else None),
            rounds_by_season=_rounds_by_season(row.get("desc_injury_rounds_by_season")),
            weighted_all=_number(row.get("desc_injury_weighted")),
            known_injuries=bool(row.get("desc_injury_source")),
            days_since_return=_number(row.get("desc_injury_days_since_return")),
            window_matches=_number(row.get("desc_elsewhere_matches")),
            window_minutes=_number(row.get("desc_elsewhere_minutes")),
            minutes_here=_number(row.get("desc_minutes_club")),
            minutes_elsewhere=_number(row.get("desc_minutes_elsewhere")),
            was_here_before=bool(row.get("desc_at_club_before")),
            # ...and whether the club has just PAID for him, which decides WHICH of the two discounts that
            # earns. See `presence.Inputs.resigned`: the amount is never read, only whether there is one.
            resigned=bool(_number(row.get("desc_transfer_fee"), None)
                          or _number(row.get("desc_investment_fee"), None)),
            fee_share=_number(row.get("desc_investment_fee_share"), None),
            stature=_number(row.get("desc_investment_stature"), None),
            value_share=_number(row.get("desc_investment_value_share"), None),
            level_z=self.level_z(row),
            level_gap_z=self.level_gap_z(row),
            standing_prior=None,
            # ...and the two the panel used to leave empty. `fm_z` feeds a channel the gate FALSIFIED, so
            # it changes nothing today - and that is exactly why it has to be here: a weight the sweep
            # could turn on and a view that cannot see it is how a parameter ends up adopted and blind,
            # which happened twice in one session (`level_z`, `standing_prior`).
            fm_z=self.fm_z(row),
            career_z=self._career_z(row),
            # ...and his AGE, for the threshold decline. Read straight off the sheet: it is a fact about
            # the man and not a population statistic, so there is nothing to standardise here.
            age=_number(row.get("desc_age"), None),
            cross_league=(row.get("desc_arrival") == "transfer_cross_league"),
        )
        # ...and the prior LAST, from the inputs just built: computing it from the row would rebuild them
        # and call back into here. One cycle, found by the tests.
        return _replace_params(base, standing_prior=self._band_prior(base))

    def _career_z(self, row: dict) -> float | None:
        """His career fantamedia in sd over the FORWARDS of this sheet - see `presence.Inputs.career_z`."""
        value = _number(row.get("desc_career_fm"), None)
        if value is None:
            return None
        stats = getattr(self, "_career_stats", None)
        if stats is None:
            pool = [v for v in (_number(other.get("desc_career_fm"), None)
                                for other in (self.population() or ())) if v is not None]
            if len(pool) > 1:
                mean = sum(pool) / len(pool)
                sd = (sum((v - mean) ** 2 for v in pool) / len(pool)) ** 0.5
                stats = (mean, sd)
            else:
                stats = (0.0, 0.0)
            self._career_stats = stats
        return (value - stats[0]) / stats[1] if stats[1] else None

    def fm_z(self, row: dict) -> float | None:
        """His fantamedia relative to his ROLE on this sheet, in standard deviations. None if unmeasured.

        Standardised within the role because a 6.6 from a defender and a 6.6 from a forward are not the
        same season - the same convention the sweep uses on the window.
        """
        fm = _number(row.get("engine_fm_pred"), None)
        if fm is None:
            fm = _number(row.get("est_fm"), None)
        role = row.get("role_classic") or ""
        if fm is None or not role:
            return None
        cache = getattr(self, "_fm_stats", None)
        if cache is None:
            cache = {}
            pools: dict[str, list[float]] = {}
            for other in (self.population() or ()):
                value = _number(other.get("engine_fm_pred"), None)
                if value is None:
                    value = _number(other.get("est_fm"), None)
                key = other.get("role_classic") or ""
                if value is not None and key:
                    pools.setdefault(key, []).append(value)
            for key, values in pools.items():
                if len(values) > 1:
                    mean = sum(values) / len(values)
                    sd = (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5
                    cache[key] = (mean, sd)
            self._fm_stats = cache
        stats = cache.get(role)
        if not stats or not stats[1]:
            return None
        return (fm - stats[0]) / stats[1]

    def standing_prior(self) -> float | None:
        """The sheet's own mean standing, computed with the shrinkage OFF - what a short sample is pulled to.

        Two passes for the same reason the sweep needs them: the prior is a property of the population, and
        taking it from an already-shrunk one would be circular. Cached per sheet.
        """
        cached = getattr(self, "_standing_prior", "unset")
        if cached != "unset":
            return cached
        self._standing_prior = None                      # breaks the recursion while the pass runs
        unshrunk = _replace_params(self.PRESENCE, standing_prior_rounds=0.0)
        population = self.population() or ()
        bands: dict[tuple[int, int], list[float]] = {}
        for other in population:
            other_inputs = self.presence_inputs(other)
            band = _rounds_band(presence.sample_rounds(other_inputs, unshrunk))
            bands.setdefault(band, []).append(presence.standing(other_inputs, unshrunk))
        if not bands:
            self._standing_prior = None
            return None
        self._prior_by_band = {band: sum(v) / len(v) for band, v in bands.items()}
        self._standing_prior = (sum(sum(v) for v in bands.values())
                                / sum(len(v) for v in bands.values()))
        return self._standing_prior

    def _band_prior(self, inputs: presence.Inputs) -> float | None:
        """The prior for HIS band of rounds - see `presence.Inputs.standing_prior`.

        `sample_rounds` and not `contested`: for a man whose standing comes from a ten-match window the
        rounds behind the number are those ten, while `contested` would hand back his new club's 38 and
        file him among the season-long starters - the band whose prior is highest, which is the opposite
        of what a ten-match sample deserves.
        """
        overall = self.standing_prior()
        if overall is None:
            return None
        unshrunk = _replace_params(self.PRESENCE, standing_prior_rounds=0.0)
        band = _rounds_band(presence.sample_rounds(inputs, unshrunk))
        return getattr(self, "_prior_by_band", {}).get(band, overall)

    def level_z(self, row: dict) -> float | None:
        """His origin club's Elo in standard deviations, over the movers of THIS sheet. None if he stayed.

        Standardised over the sheet's own population for the same reason the sweep standardises over the
        window's: the channel's coefficient is in sd, and an sd is a property of a population, not of a
        number. Cached because it is read once per row and the population does not change while a sheet is
        open.
        """
        elo = _number(row.get("desc_level_elo"), None)
        if elo is None:
            return None
        stats = getattr(self, "_level_stats", None)
        if stats is None:
            population = self.population() or ()
            values = [v for v in (_number(other.get("desc_level_elo"), None) for other in population)
                      if v is not None]
            if len(values) > 1:
                mean = sum(values) / len(values)
                sd = (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5
                stats = (mean, sd) if sd > 0 else (mean, 0.0)
            else:
                stats = (0.0, 0.0)
            self._level_stats = stats
        mean, sd = stats
        return (elo - mean) / sd if sd else None

    def level_gap_z(self, row: dict) -> float | None:
        """The SALTO he takes by moving, in sd over this sheet's movers: origin Elo minus the club's own.

        Same two numbers the sweep uses (`elo_prev - elo_target`), read from where the sheet keeps them:
        `desc_level_elo` is the origin, and the destination is the club card's own Elo. Standardised over
        the DIFFERENCES and not over the levels - the spread of a gap is not the spread of what it is made
        of. None where either side is missing, because «vuoto = ignoto» and a missing Elo is not a gap of
        zero. Gate §7-duovicies.
        """
        origin = _number(row.get("desc_level_elo"), None)
        if origin is None:
            return None

        def gap_of(other: dict) -> float | None:
            was = _number(other.get("desc_level_elo"), None)
            now = _number((self.clubs.get(other.get("club") or "") or {}).get("elo"), None)
            return None if was is None or now is None else was - now

        mine = gap_of(row)
        if mine is None:
            return None
        stats = getattr(self, "_level_gap_stats", None)
        if stats is None:
            values = [v for v in (gap_of(other) for other in (self.population() or ()))
                      if v is not None]
            if len(values) > 1:
                mean = sum(values) / len(values)
                sd = (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5
                stats = (mean, sd if sd > 0 else 0.0)
            else:
                stats = (0.0, 0.0)
            self._level_gap_stats = stats
        mean, sd = stats
        return (mine - mean) / sd if sd else None

    def availability(self, row: dict) -> float:
        """The share of a season a man like this one is fit for: 1.0 healthy, less for the injury-prone.

        NO history means 1.0, and that is a deliberate asymmetry: not knowing whether a man gets injured
        is not knowing, and the unknown perimeter (a player with no Transfermarkt id) must not be
        penalised for it. `desc_injury_source` is what separates the two - it says "no absence recorded"
        for a player who was actually looked up. Formula and parameters: `engine.presence`.
        """
        return presence.availability(self.presence_inputs(row), self.PRESENCE)

    def at_club_weight(self, row: dict) -> float:
        """How much of his measured season counts toward THIS club's shirt (`engine.presence`)."""
        return presence.at_club_weight(self.presence_inputs(row), self.PRESENCE)

    def platform_matchdays(self) -> float:
        """The PLATFORM's calendar for the season being auctioned - what `engine_pv_pred` is counted on.

        Not the club's championship: euro bundles a subset of the real rounds (31 of them in 2025-26,
        against 38 in Serie A and 34 in the Bundesliga), so a predicted 26.6 appearances is 86% of a euro
        season and reading it against Bayern's fixtures printed 53%. Zero for a sheet written before the
        manifest carried it, and the caller falls back to the club's calendar.
        """
        return _number((self.manifest.get("matchdays") or {}).get("platform_target"))

    def club_fixtures(self, club: str | None) -> float:
        """Every match of the club we parsed an eleven for, whatever the competition.

        Not a calendar of matchdays: this is the fixture list a man's absences are counted against, which
        is what Transfermarkt does (a spell says how many of the club's GAMES he missed, cups included).
        """
        return _number(self.clubs.get(club or "", {}).get("complete_XIs"))

    def season_calendar(self, row: dict) -> float:
        """The calendar his MEASURED season is a share of - not always the calendar of the club he is at.

        «Numerator and denominator must be counted over the same competitions» (spec «Novità v9.11»), and
        for a man bought from abroad the numerator is his OLD championship's: Gonçalo Ramos played 1320
        minutes in Ligue 1's 34 rounds, and dividing them by Milan's 38 read 0.386 of a season where he
        played 0.431 - 12% of himself given away, and it kept him out of the eleven by 0.013 of claim. The
        rounds each championship played are on the row (`desc_arrival_origin_rounds`, from the per-match
        layer of the input season), so nothing here is a constant that a league changing size would break.

        Only for a man whose whole measured season was played elsewhere. A January transfer has minutes on
        both calendars and there is no single right denominator for him, so he keeps his club's - stated
        rather than silently averaged. An unknown origin is «vuoto = ignoto» and keeps it too.
        """
        origin = _number(row.get("desc_arrival_origin_rounds"), None)
        if origin and _number(row.get("desc_minutes_elsewhere")) and not _number(
                row.get("desc_minutes_club")):
            return origin
        return self.club_matches(row.get("club"))

    def club_matches(self, club: str | None) -> float:
        """The club's matches in ITS OWN CHAMPIONSHIP - the denominator of a share of the season.

        The platform's calendar is made of league rounds (euro bundles a subset of them, default is Serie
        A's 38), and every numerator here is league-only because the season aggregate is: `external_stats`
        stores one row per championship and nothing else. Counting the cups in the denominator therefore
        divided one competition set by another, and the mix is different for every club - Arsenal 58
        elevens against 38 rounds, Bayern 50 against 34, Napoli 38 against 38 - so the titolarità on a
        shirt could not be compared with the one next to it: Kane read 49% off 25 starts in 34 rounds, and
        a European campaign was indistinguishable from a bench.

        Floored by the starts of its busiest player: the two come from different sources (parsed line-ups
        and the provider's season stats), and a denominator smaller than its numerator would print a 120%
        titolare. `complete_XIs` is the fallback for a sheet built before `league_XIs` existed.
        """
        known = getattr(self, "_calendar", None)
        if known is not None and club in known:
            return known[club]
        info = self.clubs.get(club or "", {})
        busiest = max((_number(row.get("desc_season_starts")) for row in self.players
                       if row.get("club") == club), default=0.0)
        answer = max(_number(info.get("league_XIs")) or _number(info.get("complete_XIs")), busiest, 1.0)
        if known is not None:
            known[club] = answer
        return answer

    def contested(self, row: dict) -> float:
        """The championship rounds he was in CONTENTION for (`engine.presence`)."""
        return presence.contested(self.presence_inputs(row), self.PRESENCE)

    def standing(self, row: dict) -> float:
        """His absolute standing in the side - the blasone - as a share of a season, 0..1.

        The last ten matches certify FORM, not stature: they are ten matches, and a July window is half
        friendlies and rested internationals. So the schieramento tipo is decided on a whole season, by two
        measured facts about how much the coach actually used him - his start rate over the rounds he was
        there for, and his share of the minutes - both weighed by WHOSE season it was. Neither is a
        fantacalcio quantity: surplus and quotation answer "is he worth buying", and a coach does not pick
        a side by them. The formulas and their parameters are in `engine.presence`.
        """
        return presence.standing(self.presence_inputs(row), self.PRESENCE)

    def voto_share(self, row: dict) -> float:
        """The share of the season's matchdays he is expected to get a VOTO in - not to START in.

        The difference is what a fantacalcio squad is actually bought on: a substitute who comes on every
        week scores every week, and `presence` deliberately does not count him. An appearance is taken as a
        voto, which is the honest limit of the layer: the season aggregate cannot tell a ten-minute cameo
        from a full match. The TREND strip can - a hollow dot is precisely that - and the two columns are
        meant to be read together. Formula: `engine.presence`.
        """
        return presence.voto_share(self.presence_inputs(row), self.PRESENCE)

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

    def claim(self, row: dict, horizon: str = "season") -> float:
        """How strong his claim to THIS SHIRT is - the number that picks the eleven and sits on the plate.

        It is NOT `presence`, and the difference is the injury discount. `presence` answers the auction's
        question - how many matchdays will he give me - so it multiplies `standing` by `availability`;
        this answers the coach's - who does he field when everyone is fit - so it is `standing` alone.
        The `typical` eleven is defined as the side with everybody available, and ranking it by a number
        with the injury discount inside contradicted its own definition.

        Found by the user, on Napoli's 4-5-1 of 03/08/2026: Elmas was drawn and De Bruyne was not.
        Measured, the two questions answer differently and the second one is the wrong one to ask here -
        De Bruyne standing **1.00** x availability 0.53 = 0.53, Elmas 0.62 x 0.92 = 0.57, Anguissa
        0.87 x 0.70 = 0.61. A midfield of McTominay, Lobotka and Elmas is not the side Napoli fields when
        everyone is fit; it is the side weighted by who tends to be there, which is a different sentence
        and one the sheet already writes in `engine_pv_pred` and in the `inj` column.

        For the NEXT match nothing changes: there the injured and the suspended are excluded outright
        (`eleven`), the editors' probability wins where it exists, and form leads.
        """
        # ...and a man who has LEFT has no claim to this shirt at all. Zero, not "low": the board already
        # refuses to field him (`eleven`), and a row that shows 54% next to a ⇥ is the panel contradicting
        # itself in two columns. The measured history stays in `tit` and `min`, where it is a fact about
        # last season rather than a claim on this one.
        if row.get("desc_left_for"):
            return 0.0
        return self.presence(row, "recent") if horizon == "recent" else self.standing(row)

    def minutes_next(self, row: dict) -> float | None:
        """The minutes he is expected to play IN A MATCH HE PLAYS, next season (`engine.minutes`).

        Where the sheet's column names stop and the model starts, exactly like `presence_inputs`: the
        formula and its two measured weights live in `engine/minutes.py`, so a harness can reach them and
        the panel cannot drift from what it publishes. ONE definition, called by the panel and by the
        board writer - the app then draws it and never recomputes it, because how long a man stays on the
        pitch is a prediction about a person.

        `desc_start_share` is his measured start-per-appearance rate, and this is the first thing that
        reads it: its own docstring says it «reaches no decision at all» and that its denominator - HIS
        APPEARANCES rather than the club's rounds - is the wrong one for titolarità. For this question it
        is the right one, because the quantity being split is an appearance.
        """
        # The share of the PLATFORM's calendar the engine expects him to be rated in - the denominator of
        # the start rate, and the reason it is a share: `engine_pv_pred` is a count on a different
        # calendar from the one `presence` is a share of.
        predicted = _number(row.get("engine_pv_pred"), None)
        rounds = self.platform_matchdays()
        return minutes.per_appearance(
            row.get("role_classic"),
            _number(row.get("desc_minutes_full_season")),
            _number(row.get("desc_season_matches")),
            _number(row.get("desc_start_share"), None),
            self.presence(row, "season"),
            predicted / rounds if predicted and rounds else None,
        )

    @staticmethod
    def titolarita(row: dict, horizon: str) -> tuple[float, float]:
        """(start share, minutes) - how often he STARTS, and how long he stays on. DISPLAY, not selection.

        It used to say «the only criterion for who plays», and that is `claim` - this is read by `eleven`
        for its SECOND element alone, as the tie-break between two equal claims. The `season` share itself
        (`desc_start_share`) is consumed nowhere in the code, and its denominator is his own APPEARANCES
        rather than the club's league rounds, which is against this project's own rule and inflates it by
        +0.216 on average (51 of 516 Serie A rows read 1.000 - Sportiello starts his single appearance).
        Measured on 07/08/2026 (gate §7-unvicies) while falsifying a rule built on the sentence that used to
        be here: substituting the right denominator changes the drawn eleven of **0 clubs out of 55**.
        Correcting it - or dropping the column - moves a value the sheet CARRIES, so it wants a
        `SHEET_REVISION`, and it is a decision rather than a fix to slip in.
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

        `typical` - the side he fields when everyone is available, ranked by `claim` (= `standing`, with
        `titolarita`'s STARTS as the tie-break and nothing else). Injuries and suspensions are deliberately
        IGNORED: a man out today is still the first choice of the shape, and pretending otherwise would make
        the "tipo" eleven a snapshot of this week.
        This used to say «ranked by the season's start share», which is false twice over and cost a gate
        pre-registration on 07/08/2026 (§7-unvicies): the ranking is `standing`, which reads starts,
        appearances, minutes AND the club's league rounds, and inside it the sweep of 29/07 measured
        `standing_weights` = (0, 1) - the start RATE weighs zero and the minutes carry it. `desc_start_share`
        reaches no decision at all.

        `next` - the side for the coming match, and there is an order of precedence to it, from fact to
        forecast: the eleven the club actually FIELDED (`actual_*`, which only a back-dated sheet has - for
        that day the outcome exists, and a forecast is only interesting while it does not); then the
        probabili's own starters, which is what a sheet standing on TODAY refreshes, because the editors
        carry the one thing we cannot compute, the coach's own words; then who has been starting lately.
        Either way the injured and the suspended are OUT.

        SURPLUS is not consulted in any of them. It was, in the first version, and it was wrong: the sheet
        would field the most valuable player rather than the one the coach plays.
        """
        # A man whose tick is off is not in the squad this question is asked of - in EVERY mode, including
        # the eleven the editors declared and the one really fielded: the operator has said "draw it
        # without him", and a fact about last Sunday is not an exception to that.
        squad = [row for row in self.squad(club) if not self.is_excluded(row)]
        # WHICH SLOT each man won, so the drawing can put him where the shape asked for him rather than
        # re-deciding it from his own codes (`across_bucket`). Cleared per eleven, and left empty by the
        # two paths that hand out no slots: the editors' declared side and the one really fielded.
        self._slot_side = {}
        self._reshaped = set()
        # Whether the lanes this eleven reports are the DRAWING's own (an assignment to a shape's places)
        # or the four listone lines the men were chosen by, which `lanes_for` then splits by role.
        self._lanes_final = False
        if mode == "next" and sum(1 for row in squad if row.get("actual_next_started") == "1") >= 11:
            return self._fielded(squad, formation)
        # ...and ENOUGH of them to make an eleven. One name is not a declared side: Eintracht had a single
        # probability recorded in this sheet and the board drew a single man on an empty pitch. Where the
        # editors have said too little, the answer is the one the measurements give (recent starts).
        if (mode == "next"
                and sum(1 for row in squad if row.get("desc_starter_prob")) >= 11):
            return self._declared(squad, formation)
        # Group by the line he REALLY plays in, not by the listone's role. A 3-4-3's midfield four is
        # two centre mids and two wing backs, and the listone calls those wing backs defenders - so
        # grouping by `role_classic` filled the middle with four central midfielders and left the flanks
        # to nobody. The listone role is the fallback for a player with no granular code.
        by_role: dict[str, list[dict]] = {}
        bucket: dict[int, str] = {}

        def line_key(code_line: str) -> str:
            # the trequartisti compete for the attacking line: which of the two lanes they are DRAWN in
            # is decided afterwards, by `lanes_for`, and only for the men actually chosen
            return "A" if code_line == "T" else "M" if code_line == "C" else code_line

        for row in squad:
            codes = self.real_roles(row)
            home = line_key((self.LANE_OF_ROLE.get(codes[0], "") if codes else "")
                            or (row.get("role_classic") or "?"))
            # EVERY line his codes play in, not just the primary one's. Spinazzola is 'ML;DL': bucketed
            # by his first code alone he only ever competed with central midfielders, lost to them at
            # 54%, and Napoli's left back became a 38% man while the 54% one sat outside the eleven. A
            # second code is not a guess - it is where the provider has actually seen him play - and a
            # line that can consider him is the difference between a real side and a tidy one.
            # `bucket` stays the PRIMARY lane: it is what `can_lend` calls "his own line".
            keys = {line_key(self.LANE_OF_ROLE.get(code, "")) for code in codes
                    if self.LANE_OF_ROLE.get(code)} or {home}
            # ...and the line the PROVIDER puts him in, which is a separate observation from his codes
            # and sometimes contradicts what we derive from them. `AM` is the case that costs: our grid
            # calls it a trequartista and `line_key` sends every trequartista to the ATTACK, so a man
            # coded `AM` and nothing else was never a candidate for a midfield - Nico Paz, the highest
            # claim in Como's squad (0.760, 33 starts), lost the 4-5-1's single forward place to the
            # centre-forward by `_fronted` and then had no other line to be considered for, while a
            # 0.49 winger played. Both sources say he is a midfielder: the provider files 20 of the 27
            # `AM` on this sheet under M, and the listone calls 22 of them C. Widening the CANDIDACY
            # only - `bucket` stays his primary lane, and where he is DRAWN is still the fit's answer -
            # touches 28 rows of 638, all of them the linking men (wingers and trequartisti).
            provider_line = self.PROVIDER_LINE.get(row.get("desc_real_role_line") or "")
            if provider_line:
                keys.add(provider_line)
            for key in keys:
                by_role.setdefault(key, []).append(row)
            bucket[id(row)] = home
        defenders, midfielders, forwards = self.lines(formation)
        horizon = "recent" if mode == "next" else "season"
        # by PRESENCE, the same number the shirt shows: ranking by anything else would draw a starter
        # carrying a percentage below his own alternative's
        # ...and a man who has LEFT is out of both elevens, which is not the same question as availability:
        # the typical eleven is «the side with everybody fit», and somebody who plays elsewhere is not in it
        # at any fitness. The row itself stays at his listone club with its ⇥ - the listone is the game's own
        # authority on who is in a squad and it is what you buy from - but a squad is a fact about a DAY and
        # the board draws the day. Safe only because the signal is guarded twice (`snapshot.left_his_club`):
        # ungated, a thin payload would have benched twelve West Ham players who are really there.
        eligible = sorted(
            (row for row in squad
             if not row.get("desc_left_for")
             and (mode != "next"    # a man who is out cannot play the next match; the tipo eleven can
                  or (not row.get("desc_injury_open")
                      and row.get("desc_availability_now") not in ("injured", "suspended")))),
            key=lambda row: (-self.claim(row, horizon), -self.titolarita(row, horizon)[1]))
        rank = {id(row): index for index, row in enumerate(eligible)}
        out: list[tuple[str, dict, list[dict]]] = []
        taken: set[str] = set()          # one shirt per man, across every line
        left = {"P": 1, "D": defenders, "M": midfielders, "A": forwards}

        def can_lend(row: dict, asking: str) -> bool:
            """Whether his own line can spare him: he is BEYOND the men it still needs for itself.

            Two mistakes this closes, both found by measuring. Borrowing without the check starved the
            later lines - the lines are served in order, so a defence with nobody of its own helped
            itself to the strikers and the attack was drawn empty. Borrowing the lending line's BEST man
            was the same mistake one step down: its first choice went to somebody else's shirt. A line
            lends from its bench, in presence order, and only what it has over.
            """
            lane = bucket.get(id(row), asking)
            if lane == asking:
                return True
            free = sorted((other for other in by_role.get(lane, ())
                           if id(other) in rank and other.get("name") not in taken),
                          key=lambda other: rank[id(other)])
            return id(row) in {id(other) for other in free[left.get(lane, 0):]}

        # WHO plays is the CLAIM's question, line by line - and only that. Handing the shirts out one slot
        # at a time by fit let a 0% man take a place because he fitted its flank: Atalanta's 3-4-3 drew
        # Touré (claim 0.00) on the left of its front three, which then made the repair pull two wing backs
        # into the attack, and the drawing came out 3-6-1 with one forward in it. Fit decides WHERE each of
        # the chosen men plays (`_assign`), never WHETHER he plays.
        chosen: list[tuple[str, dict]] = []
        for role, slots in (("P", 1), ("D", defenders), ("M", midfielders), ("A", forwards)):
            pool = [row for row in eligible
                    if id(row) in rank and row.get("name") not in taken
                    and row in by_role.get(role, [])]
            take = pool[:slots]
            if role != "P":
                # A line short of its own men borrows - a line of the module is still a line: Bayern's
                # 4-5-1 had four midfielders in the M lane and drew TEN men, calling it 4-4-1, while its
                # wingers and trequartisti sat outside the eleven. It borrows in CLAIM order and only what
                # another line can spare (`can_lend`); in the goal nobody adapts, so an empty keeper's
                # shirt is the honest drawing of a squad with no keeper.
                # IN TWO PASSES, and the first one is «non è realistico che un Dc sia schierato a
                # centrocampo»: a man who plays SOME line one step from the asking one comes before a man
                # who plays none of it. The depth gate cannot say this on its own - a centre back and a full
                # back both stand at 0.25, exactly `LINE_REACH` from a midfield - so the claim order alone
                # gave Manchester United's midfield to Martinez (`DC;DL`, 0.62) over Mainoo (0.58) and
                # Stuttgart's to Jeltsch (`DC`, 0.58) over Nartey (0.44). The second pass is the old
                # behaviour and it stays: a line whose squad has nobody nearer is still drawn with eleven
                # men, and Bayern's borrowed wingers are found by it exactly as before.
                for near in (True, False):
                    for row in eligible:
                        if len(take) >= slots:
                            break
                        if (row.get("name") in taken or row in take
                                or not can_lend(row, role)):
                            continue
                        if near and role not in {self.LANE_OF_ROLE.get(code)
                                                 for code in self.real_roles(row)}:
                            continue
                        take.append(row)
                # ...and a row's FLANKS are a job of their own, contested by everybody who does it.
                pool = [
                    row for row in eligible
                    if row.get("name") not in taken and row not in take
                    and can_lend(row, role) and self._within_reach(row, role)
                    and not (role == "A" and self._off_the_front(row, "A", lone=slots == 1))]
                take = self._flanked(
                    take, role, slots, horizon, pool,
                    # a midfield in front of a back line with no flanks of its own (three or five
                    # centrals) owns the whole touchline: its wide places are wing-back jobs
                    wing_backs=role == "M" and not any(
                        side in ("R", "L") for side in self.slot_shape("D", defenders)))
                # ...a place in the FRONT line is a forward's job, which is rule 4a one step earlier...
                take = self._fronted(take, role, slots, horizon,
                                     [row for row in pool if row not in take])
                # ...and so is the middle of a FRONT line, for the same reason and with the same ceiling
                take = self._pointed(take, role, slots, horizon,
                                     [row for row in pool if row not in take])

            for row in take:
                taken.add(row.get("name"))
                left[role] -= 1
            chosen += [(role, row) for row in take]
        # ...and then WHERE: one assignment over the shape's own places, and the bench of each line for the
        # alternatives (`_settle` may still bring in a better-fitting man from outside and refill).
        benches = {row.get("name"): [other for other in eligible
                                     if other.get("name") not in taken
                                     and other in by_role.get(role, [])]
                   for role, row in chosen}
        men = [row for _role, row in chosen]
        picked = {id(row): role for role, row in chosen}

        def arranged(shape: str) -> list[tuple[str, dict]]:
            return self._assign(men, shape, order=lambda row: rank.get(id(row), 99), home=picked)

        placed = arranged(formation)
        # How many ROWS the shape really has: a five whose majority plays AHEAD of it is a two and a three,
        # which is the module the source cannot name. Read off the men the assignment PLACED in the row and
        # not off the line they were picked for, because a line picks men for places it may not give them -
        # Liverpool's five is picked with three attacking men in it and drawn with a real wide midfielder on
        # its right, and splitting on the selection sent that right back onto the trequarti.
        split = self._two_rows(placed, formation)
        if split != formation:
            formation, placed = split, arranged(split)
        out = [(lane, row, benches.get(row.get("name"), []))
               for lane, row in placed]
        out = self._settle(out, eligible, picked)
        # ...and the middle of the front line is checked AGAIN on the settled eleven, because `_settle`
        # can create the very thing `_pointed` refused: Napoli's 4-4-2 is picked with Hojlund and De Bruyne
        # up front (both central men) and the repair exchanges De Bruyne for Neres, so the second central
        # place ends up on a winger and the badge says 'Sp' - «un attaccante esterno non può diventare Sp».
        out = self._repointed(out, eligible)
        # A line the squad cannot fill with men who play there is redrawn around the men it has, instead of
        # showing a central midfielder on a touchline.
        reshaped = {id(row): lane for lane, row in
                    self._reshape([(lane, row) for lane, row, _bench in out], formation)}
        out = [(reshaped.get(id(row), lane), row, bench) for lane, row, bench in out]
        # A rival is by definition NOT in the eleven - "Hojlund vs De Bruyne" with both starting counts a
        # team-mate's claim as competition for a place he is not competing for. Which men those are is
        # only known once every shirt has been handed out, so the alternatives are chosen HERE and not
        # inside the slot loop: filtered afterwards instead, a shirt whose two best challengers went on
        # to win shirts of their own was left with no alternative at all rather than with the next man
        # who can really take the place - McTominay, whose whole midfield starts, read as unchallenged.
        starters = {row.get("name") for _role, row, _bench in out}
        final: list[tuple[str, dict, list[dict]]] = []
        for role, starter, bench in out:
            # the ranked list spans the whole line, so the alternatives are narrowed back to the men who
            # could really take THIS place (see `can_replace`): his own position first, the other flank
            # only when nobody plays his - the order a coach solves it in, and it keeps a switched full
            # back out of a duel that a proper one is already in
            free = [row for row in bench if row.get("name") not in starters]
            able = ([row for row in free if self.can_replace(starter, row)]
                    or [row for row in free if self.can_replace(starter, row, mirrored=True)])
            # An alternative is whoever else can wear THIS shirt. Two men of equal titolarità in one slot
            # alternate, and the shirt then reads 50% - the sentence an auction needs ("50%, in
            # ballottaggio") instead of two 100%s.
            named = [name.strip() for name in (starter.get("desc_duel_names") or "").split(";")
                     if name.strip() and name.strip() not in starters]
            # The editors' own named ballottaggio comes first - it is a stated fact - but only as a
            # FILTER on the men who can really wear this shirt, never as a replacement for them. Given
            # precedence outright it erased the real alternatives whenever it named nobody who is in THIS
            # duel: Politano, a 'C' in the listone, was declared in a ballottaggio with Lobotka and
            # Elmas, neither of whom is in his line, so the intersection came out empty and Neres - who
            # shares his RW - was reported as no alternative at all.
            # Up to THREE, because a duel is not always a pair: the editors name three men for one
            # midfield place often enough, and a shirt contested by three is a different risk from a
            # shirt contested by one. The drawing fits what it can and counts the rest (`rival_text`).
            final.append((role, starter,
                          [row for row in able if row.get("name") in named][:3] or able[:2]))
        return final

    # What the drawing is willing to PAY, in shares of a season, to put a man who really plays a flank on
    # it when nobody in the line does. MEASURED on the 108 boards of the two 2026-27 sheets, one board at a
    # time: 0.30 admits Fiorentina's right (Harrison 0.27 for Piccoli 0.52) and Lille's (Perrin 0.12 for
    # Mbappé 0.33) and refuses Fiorentina's left (Solomon 0.31 for Gudmundsson 0.70) - the operator asked
    # for BOTH wings there; 0.40 admits all three and still refuses the case the ceiling exists for
    # (Napoli's row of four regulars, a 0.87 gap). Above 0.50 nothing new is admitted on either sheet.
    FLANK_OVERRIDE_GAP: ClassVar[float] = 0.40

    # The provider's own broad slot -> the line whose shirts a man may CONTEND for. It is a second
    # observation, not a restatement of his codes: `desc_real_role_line` is where the provider saw him
    # play, and for a trequartista it says M where our grid says T. Read in `eleven`, for candidacy
    # only; nothing about where he is DRAWN, which the fit decides.
    PROVIDER_LINE: ClassVar[dict[str, str]] = {"G": "P", "D": "D", "M": "M", "F": "A"}

    # THE PRE-SEASON as the fifth source of `shape_odds` (todolist item 5). It answers the one question
    # the repertoire cannot - «what has he announced for THIS squad» - and it is the only football
    # played by the side that will actually take the field. Coverage measured BEFORE writing any of
    # this, as the item demanded: 2026-27 has 1-3 complete elevens for all 20 Serie A clubs (297 over
    # 200 clubs), where 2025-26 had Milan and Napoli at zero.
    # PRE-REGISTERED GRID for the weight, fixed before looking at any verdict: 0 (off), 0.15, 0.30,
    # 0.45, 0.60. Judged on the press reference, and adoptable only on an INTERIOR optimum - the same
    # discipline as any swept constant («a parameter is never adopted at the edge of its grid»).
    # MEASURED, AND IT DOES NOT PAY (08/08/2026):
    #     weight   0.00   0.15   0.30   0.45   0.60
    #     modules  11/5/4 11/5/4 11/5/3+1 11/3/6 11/2/7
    #     men      166    166    165    163    163
    # The optimum is at the EDGE and the curve is monotone downward: the module count never improves at
    # any weight - not even on the two cases the item came from - and the alternatives decay. So the
    # pre-season shape is kept as a COLUMN (`friendly_shapes`, measured and on the sheet) and weighs
    # nothing, exactly like `HEATMAP_SIDE`/`HEATMAP_DEPTH`. The reason is worth more than the parameter:
    # a training-camp shape is chosen against opponents who are not in the league and with men who are
    # not all signed yet, so it says less about September than the coach's own repertoire does.
    PRESEASON_WEIGHT: ClassVar[float] = 0.0
    PRESEASON_FULL: ClassVar[int] = 3           # elevens for the pre-season to carry its full weight

    # CO-TITOLARITÀ: MEASURED, IMPLEMENTED, AND REFUSED BY THE JUDGE (08/08/2026). Kept as a threshold
    # and an accessor because the DATA is real and on the sheet (`desc_costart_low`); what is gone is
    # the rule that read them, and the reason it is gone is worth more than the rule was.
    # The hypothesis was the operator's: «Scamacca e Krstovic giocheranno entrambi ma non
    # contemporaneamente». The measurement agrees about the pair - 2 co-starts of 15/18 over the 35
    # matches both were available for, 0.13, against Lautaro Martinez and Thuram at 0.58 - so «mai due
    # Pc» is false and «two who do not coexist are not drawn together» is measurable, with both
    # anchors on one scale. Implemented as the fourth trade override (it cannot run at selection time:
    # Atalanta's attack pool leads with two midfielders coded `AM`, and it is `_fronted` that puts the
    # centre-forwards in), it did exactly what it promised - Scamacca out, Sulemana K. in - and the
    # press comparison went from 164/220 to **162**, with Atalanta itself 7/11 -> 6/11 and its module
    # verdict from ALT to DIFF. The press starts SCAMACCA. The rule had no way to know which half of a
    # rotation to keep: it drops the lower claim (0.468 against 0.490), and on the one case it exists
    # for that is the wrong man. Reverted, per v9.16 - «se aggiustare un club ne rompe un altro è il
    # MODELLO sbagliato, si annota e si torna indietro». What would make it decidable is a signal for
    # WHICH of two rotating men leads, and the claim is not it.
    COSTART_MIN: ClassVar[float] = 0.25

    @staticmethod
    def costart_share(row: dict, mate: dict) -> float | None:
        """How often these two STARTED together, of the matches both were available for. None = unknown.

        Read off `desc_costart_low`, which the sheet only fills where the share is low and where there
        was enough shared football to say anything: a pair that never shared a squad has co-started
        nothing by construction, and that is not the same sentence as «they do not coexist».
        """
        name = mate.get("name")
        if not name:
            return None
        for entry in (row.get("desc_costart_low") or "").split(";"):
            mate_name, _, share = entry.rpartition(":")
            if mate_name.strip() == name:
                return _number(share, None)
        return None

    def _covers(self, men: list[dict], sides: list[str]) -> int:
        """How many of a row's flank places these men can hold AT ONCE - a matching, not a count.

        One man answers for one touchline, so a `LW;RW` covers either and not both: the scarcer side is
        served first and by the least flexible man who can, which is exact for the two flanks a row has.
        """
        used: set[int] = set()
        held = 0
        for side in sorted(sides, key=lambda side: sum(1 for row in men
                                                       if side in self.sides_of(row))):
            cover = min((row for row in men
                         if side in self.sides_of(row) and id(row) not in used),
                        key=lambda row: len(self.sides_of(row) & set(sides)), default=None)
            if cover is not None:
                used.add(id(cover))
                held += 1
        return held

    @classmethod
    def _wing_back_trade(cls, row: dict) -> bool:
        """Whether a flank he owns WHOLE is his job: a flank code of the D or M lines, not an attack's.

        «Malen dovrebbe giocare come Pc e non come centrocampista esterno» (operator, 08/08/2026). In a
        module whose BACK line has no flank places (a back three or five), the midfield's wide places are
        the whole touchline - a wing back's work, the places the press mans with full backs - and Roma's
        right one went to Malen (`RW;ST`, 0.391) over Rensch (`DR;MR`, 0.363) because `_flanked` ranks by
        claim alone among everybody who plays A side. A pure attacker does not become an esterno a tutta
        fascia by 0.03 of claim. Where the midfield has full backs BEHIND it the wide places stay open to
        wingers - Bologna's 4-5-1 right is Orsolini's, the case `_flanked` was built on - and `_reshape`
        rule 3 can still drop a wide attacker onto a VACATED wing: an emergency, never a selection.
        """
        return any(REAL_ROLE_SIDE.get(code) and cls.LANE_OF_ROLE.get(code) in ("D", "M")
                   for code in cls.real_roles(row))

    @classmethod
    def _flank_trade(cls, row: dict, role: str) -> bool:
        """Whether a flank of THIS row is a job he really does: his FIRST code names a side, or the line is
        his own line anyway.

        «Non è realistico che un Dc sia schierato a centrocampo», twice over: Martinez (`DC;DL`) took
        Manchester United's five on the left from Dorgu (`ML;DL`) by 0.02 of claim, and Jeltsch (`DC;DR`)
        took Stuttgart's from Nartey - because ANY code of his is enough to cover a side, and the depth gate
        cannot tell a centre back from a full back: both stand at 0.25, exactly `LINE_REACH` from a midfield.
        The PRIMARY code can, and it is the reading the rest of this module uses - «il primo codice è il
        mestiere». Every case the rival pool exists for survives it: Orsolini and Cambiaghi (`RW`, `LW`)
        taking Bologna's five, Spinazzola (`ML;DL`) Napoli's left, Verdonk (`DL;DC`) Lille's, and a centre
        back adapting into the outer place of his own BACK line, which is his line and so never filtered.
        """
        codes = cls.real_roles(row)
        return bool(REAL_ROLE_SIDE.get(next(iter(codes), ""))) or role in {
            cls.LANE_OF_ROLE.get(code) for code in codes}

    def _flanked(self, take: list[dict], role: str, slots: int, horizon: str,
                 rivals: list[dict], wing_backs: bool = False) -> list[dict]:
        """A ROW'S FLANK IS A JOB, and the men who do it are not only the ones its own line's pool holds.

        «I due attaccanti esterni possono arretrare e coprire il centrocampo» - the same sentence as
        `_reshape` rule 3, one step earlier: there it repairs a row the transformation emptied, here it
        decides who is PICKED for it. Measured on Bologna's 4-5-1: the row of five took Bernardeschi (`MR`,
        0.44) for its right and a CENTRE BACK for its left, while Orsolini (`RW`, 0.64) and Cambiaghi (`LW`,
        0.53) - the two men who actually play there - never competed for the place at all, because a
        winger's codes only ever put him in the attack's pool. That is a bucket deciding a side, not a coach.

        It stays the CLAIM's question, which is what keeps Touré out of it (0.00 on Atalanta's left, the
        mistake this whole family was born from): a rival takes the shirt only from a man whose claim is
        WEAKER, only if his own line can spare him (`can_lend`, checked by the caller), and never if that
        would leave the other flank uncovered. And nothing is lent FORWARD into the attack - a place in the
        front line is a forward's (`_off_the_front`), which is why the caller filters that case out.

        WITH ONE EXCEPTION, and it is the operator's own, on Fiorentina's front three: «in un attacco a 3
        non ci possono essere 2 SP, servono 2 attaccanti esterni o 2 ali». Where NOBODY in the line covers
        that flank at all, the claim stops deciding and the man who plays there takes the place - Kean,
        Gudmundsson and Piccoli are three centre-forwards, so the shape's two wide places were held by two
        punte and the badge said Pc + Sp + Sp, which is not an attack. The exception is the FRONT line's
        only, because it is the only row nothing else can repair: a midfield or a defensive flank held by a
        central man is vacated by `_reshape` rule 2 and covered from the front by rule 3, while a striker on
        a wing is exempt from rule 2 by design («sono Pc e basta») and rule 4 only fires on a line the
        transformation has already thinned. It costs claim and the operator has taken that decision in the
        open: Solomon (0.31) and Harrison (0.27) for Piccoli (0.52) and Gudmundsson (0.70).
        """
        sides = [side for side in self.slot_shape(role, slots) if side in ("R", "L")]
        if not sides or len(take) < slots:
            return take                      # a row with no flanks, or one that has not even got its men
        for side in sides:
            # `wing_backs` = this row's flanks are the WHOLE touchline (no full back behind them), so a
            # flank is a D/M job and a pure attacker does not compete for it (`_wing_back_trade`)
            rival = max((row for row in rivals if side in self.sides_of(row)
                         and self._flank_trade(row, role)
                         and (not wing_backs or self._wing_back_trade(row))),
                        key=lambda row: self.claim(row, horizon), default=None)
            if rival is None:
                continue
            # ...and whether the claim stops deciding for this place, which happens in two cases and both
            # are the operator's words. In the MIDFIELD it is unconditional - «servono sempre due esterni di
            # centrocampo di ruolo»: nobody in the row plays that flank, so a central man would be given it,
            # rule 2 would vacate it and rule 3 cannot cover it behind a lone striker (Lille's five came out
            # as five centrali). In the FRONT line it needs TWO PUNTE, because there the place is one a
            # centre-forward would KEEP («sono Pc e basta», so rule 4 leaves him on it) - and looser than
            # that it cost two boards the operator had already ruled on (Atalanta, Roma).
            punte = [row for row in take if self.sides_of(row) == {"C"}
                     and next(iter(self.real_roles(row)), "") == "ST"]
            others = [other for other in sides if other != side]
            weakest = min(
                (row for row in take
                 # not the last cover of a flank this row still needs, and not the man who covers THIS one
                 # better than the rival does: that is what makes the swap an improvement and not a shuffle
                 if not any(other in self.sides_of(row)
                            and not any(other in self.sides_of(kept) for kept in take if kept is not row)
                            for other in others)),
                key=lambda row: self.claim(row, horizon), default=None)
            if weakest is None:
                continue
            # ...and what the override may sacrifice is a CENTRAL man and nobody else: reading the row's
            # weakest instead had it swap one winger for a worse winger, because a row short of wide men is
            # short of them whichever of them you take out.
            central = min((row for row in take if not self.sides_of(row) & set(sides)),
                          key=lambda row: self.claim(row, horizon), default=None)
            # WHETHER THE ROW CAN MAN ITS FLANKS AT ALL is a MATCHING and not a count (`_covers`), and the
            # override may only fire where the swap ADDS one: Lille's five holds Correia (`LW;RW`), who
            # covers either touchline and can still only stand on one, so counting wide men said "covered"
            # while a flank was going to a central man; and counting them short let a row with one left
            # winger take a SECOND left winger, which adds no flank and cost the eleven its better one.
            uncovered = ((role == "M" or (role == "A" and len(punte) >= 2))
                         and central is not None
                         and self._covers(take, sides) < len(sides)
                         and self._covers([row for row in take if row is not central] + [rival], sides)
                         > self._covers(take, sides)
                         and self.claim(rival, horizon) > 0.0
                         # ...and it is a COST, so it has a CEILING: past `FLANK_OVERRIDE_GAP` the man being
                         # sacrificed is a regular starter and the "esterno" is somebody who does not play,
                         # which is what a coach answers by adapting a central man instead. Without it the
                         # override is the Touré mistake with the sign flipped: Napoli's row of four 100%
                         # men handed a place to a 13% right back because nobody in it plays a wing.
                         and self.claim(central, horizon) - self.claim(rival, horizon)
                         <= self.FLANK_OVERRIDE_GAP)
            if uncovered:
                weakest = central
            elif self.claim(rival, horizon) <= self.claim(weakest, horizon):
                continue
            if side in self.sides_of(weakest) and not any(
                    side in self.sides_of(kept) for kept in take if kept is not weakest):
                pass                         # he was this flank's only cover; the rival is a better one
            take = [row for row in take if row is not weakest] + [rival]
            rivals = [row for row in rivals if row is not rival]
        return take

    def _fronted(self, take: list[dict], role: str, slots: int, horizon: str,
                 rivals: list[dict]) -> list[dict]:
        """A PLACE IN THE FRONT LINE IS A FORWARD'S JOB - `_reshape` rule 4a, one step earlier.

        The rule already exists twice: `_reshape` says it about a line already drawn, and `_off_the_front`
        prices it where a place is priced. Neither can do anything when the SELECTION never offered the line
        a forward at all - the trequartisti compete for the attacking line (`line_key`), so on a shape with a
        single front place a man who plays on the trequarti outbids a centre-forward on claim, and then the
        guard «never the last man of the attack» rightly keeps him there. Measured: Lille's 4-5-1 was the last
        case of this family left on the 516 boards the model selects, and it had Haraldsson (`AM`, claim
        0.86) on the only front place while Fernandez-Pardo (`ST`, 0.82) sat outside the eleven.

        Same currency and same ceiling as the other two overrides (`FLANK_OVERRIDE_GAP`): the JOB decides who
        is eligible for the place, the claim decides between them, and never outside it. Nothing happens where
        the squad has no forward to offer - «una squadra i cui unici attaccanti sono trequartisti va disegnata
        con loro», which is why Roma is untouched: Malen reads `RW;ST` and holds the place by right.

        `_off_the_front` is the ONE definition of "not his job" (it also covers a man with no observed codes,
        placed by his listone line, and the LONE front place's stricter question - the operator's «lì
        davanti ci vuole una Pc o al massimo una A», which is why Bologna's single place is Dovbyk's and
        not Odgaard's): a second opinion on the same question is how the module lost its symmetry once
        already.
        """
        if role != "A" or len(take) < slots:
            return take
        lone = slots == 1
        while True:
            weakest = min((row for row in take if self._off_the_front(row, "A", lone=lone)),
                          key=lambda row: self.claim(row, horizon), default=None)
            if weakest is None:
                return take                  # every place is held by a man who plays up there
            rival = max((row for row in rivals if not self._off_the_front(row, "A", lone=lone)),
                        key=lambda row: self.claim(row, horizon), default=None)
            if (rival is None or self.claim(rival, horizon) <= 0.0
                    or self.claim(weakest, horizon) - self.claim(rival, horizon)
                    > self.FLANK_OVERRIDE_GAP):
                return take
            take = [row for row in take if row is not weakest] + [rival]
            rivals = [row for row in rivals if row is not rival]

    def _pointed(self, take: list[dict], role: str, slots: int, horizon: str,
                 rivals: list[dict]) -> list[dict]:
        """A CENTRAL place of the FRONT LINE wants a man who can play centrally - the mirror of `_flanked`.

        «Non è realistico che un attaccante esterno come Neres giochi al centro sulla trequarti ... un
        attaccante esterno può adattarsi sulla trequarti solo se decentrato, ovvero in linea di trequarti con
        almeno 2 calciatori», and on Napoli's 3-5-2 both ends of that are shut: a front two is two CENTRAL
        places, so a winger holds one of them, and the trequarti behind it has room for one man, so rule 6
        cannot send him there either. Nothing downstream can repair it, so the place is decided where the men
        are: the club's best forward who plays centrally takes it. Lazio's front three is the same statement
        with the shape's own arithmetic - one central place, three wingers, and «serve una punta di ruolo al
        centro dell'attacco».

        Same currency as the flank override and the same ceiling (`FLANK_OVERRIDE_GAP`): a place is a job,
        and the claim decides inside what the job allows, never outside it.
        """
        if role != "A":
            return take
        wanted = sum(1 for place in self.slot_shape(role, slots) if place == "C")
        if not wanted or len(take) < slots:
            return take
        while sum(1 for row in take if "C" in self.sides_of(row)) < wanted:
            rival = max((row for row in rivals if "C" in self.sides_of(row)),
                        key=lambda row: self.claim(row, horizon), default=None)
            weakest = min((row for row in take if "C" not in self.sides_of(row)),
                          key=lambda row: self.claim(row, horizon), default=None)
            if (rival is None or weakest is None or self.claim(rival, horizon) <= 0.0
                    or self.claim(weakest, horizon) - self.claim(rival, horizon)
                    > self.FLANK_OVERRIDE_GAP):
                return take
            take = [row for row in take if row is not weakest] + [rival]
            rivals = [row for row in rivals if row is not rival]
        return take

    def _repointed(self, out: list, eligible: list[dict]) -> list:
        """`_pointed` on the SETTLED eleven: a CENTRAL place of the front line is a central man's shirt.

        The selection can hand the front line two men who play centrally and `_settle` can then exchange one
        of them for a better-fitting winger, which is a better PAIR of shirts and a worse attack: «un
        attaccante esterno non può diventare Sp». So the place is checked once more where the eleven is
        final, and it is filled the same way, from the men outside it and inside `FLANK_OVERRIDE_GAP`.

        Nothing happens when the squad has nobody else - a front line of wingers is the truth about a side
        with no centre-forward, and rule 6 of `_reshape` leaves it alone for the same reason.

        A front line of ONE asks its stricter question here too (`_off_the_front`'s `lone`): a holder can
        be central by his codes and still not lead a line - Odgaard's AM satisfied the centrality check
        while the operator's rule says the lone place is a Pc's, or at most a listone A's.
        """
        lone = sum(1 for role, _holder, _bench in out if role == "A") == 1
        inside = {row.get("name") for _role, row, _bench in out}
        free = [row for row in eligible
                if row.get("name") not in inside and not self.is_excluded(row)
                and "C" in self.sides_of(row)
                and not self._off_the_front(row, "A", lone=lone)]
        for index, (role, holder, bench) in enumerate(out):
            if role != "A" or self._slot_side.get(id(holder), "C") != "C":
                continue
            if "C" in self.sides_of(holder) and not (
                    lone and self._off_the_front(holder, "A", lone=True)):
                continue
            rival = max(free, key=lambda row: self.claim(row, "season"), default=None)
            if rival is None or self.claim(rival, "season") <= 0.0 or (
                    self.claim(holder, "season") - self.claim(rival, "season")
                    > self.FLANK_OVERRIDE_GAP):
                continue
            self._slot_side[id(rival)] = "C"
            out[index] = (role, rival, bench)
            free = [row for row in free if row is not rival]
        return out

    # How many rounds of repair `_settle` runs. Every accepted move improves the pair on one axis without
    # losing the other, so the loop terminates on its own; the cap is a backstop. Six, because a chain can
    # now be longer than two moves - an equal-fit move that only adds claim can open the next one.
    SETTLE_ROUNDS: ClassVar[int] = 6
    # How much CLAIM an equal-fit move has to add to be worth making: 0.05 of a season is two matchdays out
    # of 38, i.e. the smallest difference between two men that is not noise. A display parameter, like the
    # rest of the board's - nothing gated reads it.
    CLAIM_MARGIN: ClassVar[float] = 0.05

    def _settle(self, out: list, eligible: list[dict],
                home: dict[int, str] | None = None) -> list:
        """Let a line take a man from ANOTHER line's eleven, as long as the hole he leaves closes better.

        The lines are served in order (P, D, M, A) and each one used its OWN men first, borrowing only
        when it had run out. That is why unticking Gutierrez put Mazzocchi - a right back, 13% - on the
        left of Napoli's midfield: the M lane still had a man of its own, so it never looked at Spinazzola,
        who was already wearing the left back's shirt and whose codes are `ML;DL`. The user's expectation
        is the right one and it is a CHAIN: Spinazzola moves up, and the left back's shirt goes to Olivera.

        So after the greedy pass, every pair of shirts is offered one move: give slot A the man wearing
        slot B, and refill B from whoever is not in the eleven. It is accepted only if the PAIR comes out
        better, on the same order this module uses everywhere - fit first (`_slot_price`, the flank and the
        role), then the claim - so a shirt is never handed to a worse-fitting man for the sake of a
        stronger one, and nothing moves at all when the greedy answer was already the best pair. Napoli
        with Gutierrez in is untouched; with him out the pair goes from (cost 1, claim 0.91) to
        (cost 0, claim 1.30).

        """
        for _round in range(self.SETTLE_ROUNDS):
            move = self._better_pair(out, eligible, home)
            if not move:
                return out
            here, there, mover, refill = move
            role_here, holder, bench_here = out[here]
            role_there, _mover, bench_there = out[there]
            # BOTH sides are read before anything is written: the mover takes the shirt he moves INTO, the
            # refill the one he leaves. Written in the wrong order this gave a back four two right backs
            # and no left one - the sort of mistake only the drawing shows.
            side_here = self._slot_side.get(id(holder), "C")
            side_there = self._slot_side.get(id(mover), "C")
            self._slot_side[id(mover)] = side_here
            out[here] = (role_here, mover, bench_here)
            if refill is None:
                out[there] = None                    # nobody left for it: an empty shirt, said out loud
            else:
                self._slot_side[id(refill)] = side_there
                out[there] = (role_there, refill, bench_there)
            out = [entry for entry in out if entry]
        return out

    def _better_pair(self, out: list, eligible: list[dict],
                     home: dict[int, str] | None = None):
        """The BEST pair of shirts a move-with-refill improves: (slot to fill, slot to empty, who, who).

        A move is accepted only when it is an improvement on BOTH axes at once - PARETO, not a trade-off:

        * the shirt being fixed gets a man who fits it BETTER (`_slot_price`, strictly);
        * the shirt being vacated is refilled NO WORSE than it was;
        * and the eleven does not lose claim - the two shirts together are worth at least as much.

        That conservatism is the whole design. A rule that weighed fit against claim on one scale threw
        Di Lorenzo (a right back at 100%) out of the side to gain one step of fit somewhere else, which is
        not a better drawing, it is a different one. Requiring both means a squad whose greedy answer was
        already coherent cannot move at all, and the only elevens that change are the ones where a slot was
        plainly wrong - a right back on the left of a midfield, with the man whose code says `ML` standing
        one line below him.

        And it is the BEST such move, not the first one found: the left of Napoli's midfield can be fixed
        by Buongiorno, a centre back who plays left (`DC;DL`, seven steps of line away), or by Spinazzola,
        whose first code IS `ML`. Taking the first improvement drew the centre back there.

        TWO KINDS OF MOVE, and the first one asks nothing of the bench: the two shirts are EXCHANGED. It is
        what fixes an eleven that is already the right eleven and only badly arranged, which is what an
        assignment to a declared shape produces - the trequartisti line is served before the attack, so
        Hojlund took a trequartista's place and a mediano was drawn as the centre-forward behind him. The
        claims cannot change there (the same men wear the same eleven), so only the fit decides.
        """
        inside = {row.get("name") for _role, row, _bench in out}
        free = [row for row in eligible
                if row.get("name") not in inside and not self.is_excluded(row)]
        moves = []
        # the same stricter question the selection asked: a repair pass that prices the lone front place
        # without it quietly undoes `_fronted`'s answer (the first draft of the 08/08/2026 rule did)
        lone = sum(1 for role, _row, _bench in out if role == "A") == 1

        def price(row: dict, side: str, lane: str) -> int:
            # WITHOUT the first-code half-step (`_slot_price` doubles the grid and adds 1 to a later
            # code): here it is a tie-BREAKER and nothing more, and letting it into the "never a worse
            # fit" test made a real repair invisible - Gaetano, a trequartista drawn as Cagliari's third
            # centre back, could not hand his midfield shirt back to its MC-first holder because second-
            # code MC read as "worse" by half a step, and Zé Pedro (a DC at the same claim) stayed out.
            return self._slot_price(row, side, lane, lone=lone) // 2

        for here, (role_here, holder, _bench) in enumerate(out):
            if role_here == "P":
                continue                              # nobody adapts between the posts
            side_here = self._slot_side.get(id(holder), "C")
            fit_here = price(holder, side_here, role_here)
            for there, (role_there, mover, _other) in enumerate(out):
                if there == here or role_there == "P":
                    continue
                side_there = self._slot_side.get(id(mover), "C")
                if not self._within_reach(mover, role_here):
                    continue                          # more than one line from where he plays
                if home and home.get(id(mover)) not in (None, role_here):
                    # A CROSS-LINE move, and a line fixes its own places first: only when nobody picked FOR
                    # that line fits the shirt better than the man in it may another line be asked. It is
                    # the difference between the two cases the operator brought - Napoli's midfield had no
                    # left-sided man of its own, so Spinazzola came up from the defence and Olivera took his
                    # shirt; Atalanta's attack had De Ketelaere for its left, so a left wing back had no
                    # business being pulled into the front three (and with him the last forward left it).
                    own = [row for _lane, row, _bench in out
                           if home.get(id(row)) == role_here and row is not holder]
                    if any(price(row, side_here, role_here) < fit_here for row in own):
                        continue
                moved = price(mover, side_here, role_here)
                if moved > fit_here:
                    continue                          # a worse fit for this shirt: never
                fit_there = price(mover, side_there, role_there)
                # First the SWAP, which needs nobody from outside: the two men exchange shirts. It is what
                # fixes an eleven that is already the right eleven and only badly arranged - a striker given
                # a trequartista's place because that line was served first, with a mediano behind him.
                swapped = price(holder, side_there, role_there)
                if (moved < fit_here and swapped <= fit_there
                        and self._within_reach(holder, role_there)):
                    # a SWAP moves the same men, so there is no claim to gain: it has to earn its place
                    # on the fit alone, which is why this branch keeps the strict test.
                    moves.append(((moved, 0.0, swapped), here, there, mover, holder))
                    continue
                reachable = [row for row in free if self._within_reach(row, role_there)]
                if not reachable:
                    continue
                refill = min(reachable, key=lambda row: (
                    self._slot_price(row, side_there, role_there, lone=lone),
                    -self.claim(row, "season")))
                closed = price(refill, side_there, role_there)
                if closed > fit_there:
                    continue                          # the hole would close worse than it was
                gain = (self.claim(mover, "season") + self.claim(refill, "season")
                        - self.claim(holder, "season") - self.claim(mover, "season"))
                if gain < 0:
                    continue                          # ...and the eleven must not get weaker for it
                if moved == fit_here and gain < self.CLAIM_MARGIN:
                    # EQUAL fit is allowed, but then the move has to be worth SOMETHING REAL. This is the
                    # case the operator found on Juventus: the front three was Conceicao - Yildiz - Gonzalez
                    # (0.75 + 0.90 + 0.36) with Vlahovic, a centre-forward at 0.57, outside it. Yildiz on
                    # his own left wing fits exactly as well as in the middle, so nothing was ever "badly
                    # fitted" and a rule that demanded a BETTER fit could not see it. Moving him left and
                    # giving the middle to Vlahovic keeps every fit identical and adds 0.21 of claim.
                    # The margin is what stops the other half of it, found on Atalanta: two equal-fit moves
                    # worth +0.01 and +0.02 chained, and a front three ended up with one forward in it
                    # while a fourth wing back came off the bench. A hundredth of a share of the season is
                    # not a reason to change a side.
                    continue
                moves.append(((moved, -gain, closed), here, there, mover, refill))
        if not moves:
            return None
        _score, here, there, mover, refill = min(moves, key=lambda entry: entry[0])
        return here, there, mover, refill

    # How far from his own line a man may be moved (`_line_gap`): 7 is ONE full line, a full back 0.25 to a
    # central midfielder 0.60. It is a GATE and not a price, which is the only way both of these stay fixed:
    #   * priced by the flank first, Atalanta's front three was offered Scalvini, a CENTRE BACK, because
    #     `DR` names the right flank and a left winger's own flank was the wrong one;
    #   * priced by the line first, a central midfielder is a better left-of-four than a left winger, which
    #     is the operator's rule upside down.
    # A gate on the LINE with the flank priced inside it (`_slot_price`) says both things: two lines away is
    # not a candidate at all, and among the men who are near enough, the flank decides.
    LINE_REACH: ClassVar[int] = 7

    def _within_reach(self, row: dict, lane: str) -> bool:
        """Whether that line is at most ONE line away from where he really plays."""
        return self._line_gap(row, lane) <= self.LINE_REACH

    @staticmethod
    def shape_lanes(formation: str) -> tuple[tuple[str, int], ...]:
        """'3-4-2-1' -> (('D', 3), ('M', 4), ('T', 2), ('A', 1)). The module's OWN lines, uncollapsed.

        `lines()` collapses everything between the defence and the attack, because the eleven is CHOSEN by
        the four listone lines; here the question is different - eleven men are already chosen and each has
        to be given a place - so a 3-4-2-1 is a four with two men in front of it and not a six.
        """
        try:
            parts = [int(part) for part in str(formation).split("-") if part.strip()]
        except (ValueError, TypeError):
            parts = []
        if len(parts) < 2 or sum(parts) != 10:
            parts = [4, 3, 3]
        middle = parts[1:-1]
        lanes = [("D", parts[0])]
        if len(middle) == 1:
            lanes.append(("M", middle[0]))
        elif middle:
            lanes.append(("M", middle[0]))
            lanes.append(("T", sum(middle[1:])))
        lanes.append(("A", parts[-1]))
        return (("P", 1), *[(lane, count) for lane, count in lanes if count])

    # How many men stand on the TREQUARTI of a split row - three, in front of two mediani, which is the one
    # split the vocabulary needs. Everything else a five turns into is already drawn by the transformation
    # (a 4-4-1-1, a 3-5-1-1) or is not a module: a row of four behind a lone striker with one man holding
    # the middle is nobody's side, and `lanes_for` has the measured case of a 3-3-3-1 that is «no module».
    TREQUARTI_ROW: ClassVar[int] = 3

    def _two_rows(self, placed: list[tuple[str, dict]], formation: str) -> str:
        """The shape to DRAW where a row of five is really a two and a three: «spesso scambi il 4-2-3-1 con
        il 4-5-1».

        The SOURCE cannot say 4-2-3-1 - the provider publishes three lines per eleven, so every side that
        plays two mediani behind three attacking men arrives as a 4-5-1, which is why that string is the
        commonest "shape" in the whole repertoire (1746 of 4812 complete elevens). The twelve codes can, and
        telling those two lines apart is what the grid was built for: «DM behind MC behind AM is a 4-3-3 or
        a 4-2-3-1, and all three are 'C'» (`REAL_ROLE_DEPTH`). So the row is counted, not the module's
        number: a man whose own first code is a trequartista's or a forward's does not play in a midfield.

        The test is a MAJORITY of the row, and that is what keeps rule 3 of `_reshape` intact - one or two
        wide forwards dropping in is the operator's «i due attaccanti esterni possono arretrare e coprire il
        centrocampo», Napoli's four with Politano on its right, and no split may undo it. Three of five is
        not a cover, it is a line, and the four boards it moves are four sides that really do play 4-2-3-1:
        Bayern (Olise, Gnabry, Luis Diaz behind Kane), Barcelona (Yamal, Olmo, Lopez behind Torres), Betis
        (Antony, Lo Celso, Ezzalzouli), Manchester United. Measured on the 2026-27 sheets: 4 boards of 54
        move, and the eleven rows that hold TWO attacking men stay exactly as they were.

        Only a five in front of a front ONE, which is what «two mediani» means arithmetically: a 3-5-2 whose
        five split would be a 3-2-3-2 and a 3-6-1's a 3-3-3-1, and neither is a side anybody lines up. No
        board on either sheet reaches the majority in those shapes anyway - the deepest is Napoli's two.

        And the men counted are the ones the ASSIGNMENT put in the row, never the ones the LINE was picked
        with: a line picks men for places it may not end up giving them, so the two counts differ, and on
        Liverpool's five the selection's is the wrong one - it holds three attacking men while the drawing
        gives the row's right to a real wide midfielder (Frimpong, `MR;DR`). Split on the selection, that
        right back was sent onto the trequarti and the guarded symmetry case broke.
        """
        lanes = dict(self.shape_lanes(formation))
        if lanes.get("T") or lanes.get("M", 0) - self.TREQUARTI_ROW != 2 or lanes.get("A") != 1:
            return formation
        men = [row for lane, row in placed if lane == "M"]
        ahead = [row for row in men
                 if self.LANE_OF_ROLE.get(next(iter(self.real_roles(row)), "")) in ("T", "A")]
        if len(ahead) * 2 <= len(men):
            return formation
        return f"{lanes.get('D', 4)}-2-{self.TREQUARTI_ROW}-1"

    # THE PRICE OF A PLACE, and the whole model behind it in one table. A place is a point on the grid the
    # twelve codes already live on - `REAL_ROLE_DEPTH` down the pitch, `REAL_ROLE_SIDE` across it - and the
    # price is the distance from where the man plays to where the place is: `20 x depth` (so ONE FULL LINE
    # is 7, a full back 0.25 to a central midfielder 0.60) plus the side, weighted PER LINE.
    #
    # Per line, because that is the football and it is the only thing that fits every case at once. On a
    # midfield or a defensive line the flank IS a role: a wing back and a mediano are different jobs, so
    # being one flank out has to cost MORE than coming up a whole line - it is why Gutierrez (a left back,
    # one line away) is the four's left and a central midfielder is not. In the front line the three men
    # INTERCHANGE: a centre-forward takes a wing for a spell and the marker says so, so the side has to
    # cost LESS than a line - it is why Krstovic keeps the front three's left against a left wing back, and
    # why the trequarti goes to a winger and not to the centre-forward.
    # Every attempt to price the side with ONE number broke one of those: a low price drew Lobotka as a
    # winger, a high one gave the trequartista's place to Hojlund and the front three's flank to a full
    # back. Two numbers, one meaning each.
    SIDE_WEIGHT: ClassVar[dict[str, int]] = {"P": 3, "D": 8, "M": 8, "T": 3, "A": 3}

    # HOW MUCH THE MEASUREMENT IS WORTH AGAINST THE CODE - the operator's own model, and it is the right
    # one: a code is a position the player CAN hold (the provider lists what he has covered or could cover,
    # and it reads TODAY, not the season the sheet measures), the heatmap is where he ACTUALLY stood. Two
    # things that complete each other, so each code is PULLED toward the measured point rather than replaced
    # by it, per axis, and a man with no heatmap keeps his codes untouched.
    #
    # Both weights swept on a pre-registered grid, judged on the 20 published typical elevens of the same
    # window - for every man in both elevens, does the source draw him in the same LINE (193 judged):
    #     side  depth      lines            side  depth      lines
    #     0.00   0.00   172/193  89.1%      0.00   0.25   169/193  -3
    #     0.25   0.00   172/194   +0        0.25   0.25   168/192  -4
    #     0.50   0.00   172/194   +0        0.50   0.25   168/192  -4
    #     0.75   0.00   172/193   +0        0.00   0.50   169/193  -3
    #     1.00   0.00   170/192   -2        1.00   1.00   159/192  -13
    # And two further readings of the same axis, in case the centroid was the wrong statistic: the flank
    # metric (of the men the source puts on a flank, do I draw him on the same one - 38 judged) gives 26/38
    # at weight 0, 27/38 at 0.50, 25/37 at 1.00; and a per-player pull driven by how CONCENTRATED his cloud
    # is (the dominant band of left/middle/right, which is the statistic that separates a two-flank winger
    # from a central man where a mean cannot) gives 172/193 at 0.25 and 0.50, 173/194 at 0.75, 170/193 at
    # 1.00. Every arm is flat where it is not negative, and no invariant breaks at any weight (0 unpaired,
    # lopsided or over-long rows over all 394 boards), so the drawing is robust to the parameter.
    #
    # So the measured answer is ZERO on both axes, for two different reasons worth keeping apart:
    #   * the DEPTH axis cannot certify what it is being asked: median avg_x is 10 for a keeper, 34 for a
    #     centre back, 47 for a full back, 51 for a central midfielder - and then 61 for a right winger, 62
    #     for a CENTRE-FORWARD, 63 for a left winger. Touches gather where a man receives the ball, so a
    #     striker and a winger are indistinguishable up there while a full back and a centre back are 13
    #     apart. A linear fit onto `LANE_DEPTH` leaves a residual of 0.33, one full line. It is not a weak
    #     signal, it is the wrong one, and any weight on it costs lines immediately.
    #   * the FLANK axis is measured well and adds NOTHING here: from 0 to 0.75 the drawing does not change,
    #     because for the men who win shirts the codes already say what the heatmap says. It is not that the
    #     measurement is worthless - it is that this is not where it pays.
    # Where it already pays, and has all along: `lateral`, which reads the measurement FIRST and keeps the
    # code only as a guard against a contradiction. That is the one thing the twelve codes cannot express -
    # a nominal centre back who spent the year on the left of a back three - and the badge and
    # `across_bucket` are drawn from it. The measurement is in the board; it is in the right place.
    #
    # VALIDATED as a signal, on the 52 men whose flank the published elevens STATE (in those lists a line
    # runs from the team's right to its left), as a prediction task with its coverage:
    #     the primary code's flank   46/49 = 93.9%      the centroid   46/47 = 97.9%
    #     the cloud's dominant band  45/46 = 97.8%
    # So the measurement IS better than the code at naming a flank - and the bands are not better than the
    # centroid, which is what `lateral` already uses. That is the fourth flat result in a row: reordering the
    # codes by it (3 arms), weighing it per axis (12 grid points), deriving the side from the bands, and
    # adding the flank it saw to `sides_of` (4 thresholds) all leave the drawn elevens where they were. The
    # reason is the one `sides_of` states: what the PRIMARY code misses, the code LIST already carries. So
    # the pipeline work the bands would need - a `positions` migration, an ingest column, a sheet column -
    # is not justified by the drawing, and nothing here is waiting for it.
    HEATMAP_SIDE: ClassVar[float] = 0.0
    HEATMAP_DEPTH: ClassVar[float] = 0.0

    def measured_point(self, row: dict) -> tuple[float | None, float | None]:
        """(depth, side) where he ACTUALLY stood, on the same grid the codes live on - or None, None.

        The side is the sheet's own calibrated column. The depth is fitted HERE, per sheet, on the men
        whose code is unambiguous (`_depth_fit`), for the same reason `measured_sides` calibrates the flank
        axis instead of assuming it: the provider's axis is arbitrary and only the population can say what
        a number on it means.
        """
        x = _number(row.get("desc_avg_x"), None)
        slope, intercept = self._depth_fit()
        depth = None if x is None or slope is None else max(0.0, min(1.0, slope * x + intercept))
        return depth, _number(row.get("desc_side_measured"), None)

    def _depth_fit(self) -> tuple[float | None, float]:
        """depth = slope * avg_x + intercept, least squares on the single-code men of THIS sheet."""
        fit = getattr(self, "_depth_cache", None)
        if fit is None:
            points = []
            for row in getattr(self, "players", ()):
                codes = self.real_roles(row)
                x = _number(row.get("desc_avg_x"), None)
                if len(codes) == 1 and x is not None and codes[0] in REAL_ROLE_DEPTH:
                    points.append((REAL_ROLE_DEPTH[codes[0]], x))
            if len(points) < 20:
                fit = (None, 0.0)
            else:
                mean_x = sum(x for _d, x in points) / len(points)
                mean_d = sum(d for d, _x in points) / len(points)
                spread = sum((x - mean_x) ** 2 for _d, x in points)
                slope = (sum((x - mean_x) * (d - mean_d) for d, x in points) / spread
                         if spread else None)
                fit = (slope, mean_d - slope * mean_x) if slope else (None, 0.0)
            self._depth_cache = fit
        return fit

    def _slot_price(self, row: dict, side: str, lane: str, lone: bool = False) -> int:
        """What it costs to put this man in that place: the distance from where he really plays.

        Read over ALL his codes and the nearest one wins - Spinazzola is `ML;DL` and either job may be the
        one asked of him - and a man with no code at all is placed by his listone line, dead centre, which
        is as much as it says. Each code is then pulled toward where he was MEASURED, by `HEATMAP_SIDE` and
        `HEATMAP_DEPTH`: the code says what he can do, the heatmap what he did.

        `lone` says the front line this price is about has ONE place - `_off_the_front`'s stricter
        question - so that `_assign` and `_settle` charge the same rule the selection enforces: without
        it, the first draft's repair pass quietly relocated the centre-forward into the midfield and
        handed the point of the attack back to the jolly.
        """
        wanted = {"R": 1.0, "L": -1.0}.get(side, 0.0)
        depth = self.LANE_DEPTH.get(lane, 0.60)
        weight = self.SIDE_WEIGHT.get(lane, 8)
        seen_depth = seen_side = 0.0
        pull_depth = pull_side = 0.0
        if self.HEATMAP_DEPTH or self.HEATMAP_SIDE:      # both zero: the hot path stays what it was
            seen_depth, seen_side = self.measured_point(row)
            pull_depth = self.HEATMAP_DEPTH if seen_depth is not None else 0.0
            pull_side = self.HEATMAP_SIDE if seen_side is not None else 0.0
        # Everything on the grid is DOUBLED so that half a step can break a tie: where two of his codes
        # price a place the same, the FIRST one is his first job and wins it. Two men who both play `DL`
        # and `DC` were splitting the left back's shirt and the second centre back arbitrarily; a coach
        # gives the shirt to the man whose first job it is (Olivera `DL;DC` left, the `DC;DL` inside).
        prices = [round(40 * abs((1 - pull_depth) * REAL_ROLE_DEPTH[code]
                                 + pull_depth * (seen_depth or 0.0) - depth)
                        + 2 * weight * abs((1 - pull_side) * REAL_ROLE_SIDE[code]
                                           + pull_side * (seen_side or 0.0) - wanted))
                  + (1 if order else 0)
                  for order, code in enumerate(self.real_roles(row))
                  if code in REAL_ROLE_DEPTH and code in REAL_ROLE_SIDE]
        if prices:
            # A CENTRE-FORWARD prefers the middle of the attack. On the grid alone a trequartista and a
            # striker are equidistant from a front-three place (both 2), so the two were interchangeable and
            # a 3-4-3 drew McTominay as the centre-forward with Hojlund out on the right.
            wide = 4 if lane == "A" and side != "C" and "ST" in self.real_roles(row) else 0
            return min(prices) + wide + 2 * self._off_the_front(row, lane, lone=lone)
        own = self.LANE_DEPTH.get(self.lane_of(row), 0.60)
        return (round(40 * abs(own - depth) + 2 * weight * abs(wanted))
                + 2 * self._off_the_front(row, lane, lone=lone))

    def _off_the_front(self, row: dict, lane: str, lone: bool = False) -> int:
        """What a man who plays NO attacking line pays for a place in the front one: a FULL line.

        The grid cannot say this on its own, and the operator found what that costs, on Fiorentina: a wing
        back is one line from a wide attacking place (`ML` to the front three's left, 6) while a
        centre-forward pays the flank plus the two the grid gives him (7). So Gosens OUTBID Piccoli for the
        last shirt in the front three, `_better_pair` refilled left back with Parisi, and the squad's third
        striker left the eleven altogether - drawn as a seconda punta, a punta and an ESTERNO, which is not
        an attack: «Sp + Pc non può avere un esterno d'attacco».

        It is the rule the OTHER pricer used to state from the other side - a forward pays nothing for a
        wide attacking place, and by any of them, because the three interchange. Two listini that could
        disagree is exactly how this defect got in, so there is now one (`slot_cost` is gone; what was left
        of it is the `_line_gap` gate). A full line
        (`LINE_REACH`) because that is what the compromise is: asking a man who plays no attacking line to
        play in the attack. And a cost, never a veto - a side with two forwards must still fill a front
        three, and then every candidate pays the same and the order among them is unchanged.

        A man with no observed code is placed by his listone line, which is all that is known about him: a
        listone forward is not charged for playing forward. (Returned on the SINGLE grid; `_slot_price`
        doubles it with everything else.)

        ...and a front line of ONE asks a stricter question (`lone`) - the operator's rule, 08/08/2026:
        «nel 4-5-1 o 4-2-3-1 lì davanti ci vuole una Pc, o al massimo una A». A front THREE interchanges,
        so a winger holds a place in it by right and is charged nothing; a front line of one has no flank
        to interchange with - its only place is the point of the attack, and a man who does not lead a
        line (`_leads_the_line`) pays the same full line there. Bologna was the case that named the hole:
        Odgaard (`AM;RW`, listone C) outbid Dovbyk (`ST`, listone A) 0.429 to 0.382 and no guard could
        object - his RW made him a front-line man here, and his AM a central one for `_pointed`. Stated
        INSIDE the one definition rather than as a new override, because a second opinion on the same
        question is how the module lost its symmetry once already - and the first draft of this rule was
        exactly that: a swap at selection that `_settle`, pricing the places without the rule, quietly
        undid by RELOCATING the centre-forward into the midfield.
        """
        if lane != "A":
            return 0
        if lone and not self._leads_the_line(row):
            return self.LINE_REACH
        codes = self.real_roles(row)
        home = ({self.LANE_OF_ROLE.get(code) for code in codes} if codes
                else {self.lane_of(row)})
        return 0 if "A" in home else self.LINE_REACH

    def _leads_the_line(self, row: dict) -> bool:
        """Who may hold the LONE place of a front line: a real centre-forward, or an UNCODED listone A.

        The operator's vocabulary, translated once: «una Pc» is the measured `ST`; «al massimo una A» is
        the listone's line, and it speaks only for the man the provider has never coded - all that is
        known about him, the same statement `_off_the_front` already makes («a listone forward is not
        charged for playing forward»). For a CODED man his own measured codes outrank the listone, which
        calls half a squad the same thing: a coded winger is a listone A too, and a winger is not a punta
        («Neres non è una Sp») - Liverpool's ruled board is the proof, Gakpo (`LW`, listone A) covering
        the five's left flank with Wirtz on the lone front place, not the other way round."""
        codes = self.real_roles(row)
        return "ST" in codes if codes else (row.get("role_classic") or "") == "A"

    @staticmethod
    def _matching(cost: list[list[int]]) -> dict[int, int]:
        """Minimum-cost assignment, row -> column (Hungarian, O(n^3), no dependencies).

        WHY the arithmetic is here at all, instead of a shirt at a time: a greedy pass has to fix an order
        of priority - the flank before the line, or the line before the flank - and MEASURING showed both
        orders are wrong, on the same eleven:

        * flank first: the left of a midfield four goes to a central midfielder (side 0, gap 0) over a
          winger (side 0, gap 4) - «Lobotka sembra giocare esterno»;
        * line first: the trequartista's place goes to the CENTRE-FORWARD (gap 4) over the winger who plays
          there (gap 0) - «Hojlund non può mai stare sulla trequarti», with the winger left as a lone
          striker, which he is not either.

        Neither is a bug in the order, they are the same tuple read two ways: (0, 3, 0) against (4, 0, 0).
        What separates them is that the RIGHT answer is about the whole eleven and not about one shirt -
        Santos on the trequarti and Hojlund up front costs 16 against 20 for the other way round, whichever
        sensible weights are used - so the assignment is solved as a whole and the order of priority stops
        being a choice anybody has to make. Padding keeps it square when a shape asks for fewer places than
        the eleven has men.
        """
        size = max(len(cost), max((len(row) for row in cost), default=0))
        big = 10 ** 6
        grid = [[(cost[i][j] if i < len(cost) and j < len(cost[i]) else big)
                 for j in range(size)] for i in range(size)]
        inf = float("inf")
        u = [0] * (size + 1)
        v = [0] * (size + 1)
        p = [0] * (size + 1)
        way = [0] * (size + 1)
        for i in range(1, size + 1):
            p[0] = i
            j0 = 0
            minv = [inf] * (size + 1)
            used = [False] * (size + 1)
            while True:
                used[j0] = True
                i0, delta, j1 = p[j0], inf, -1
                for j in range(1, size + 1):
                    if used[j]:
                        continue
                    cur = grid[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j], way[j] = cur, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
                for j in range(size + 1):
                    if used[j]:
                        u[p[j]] += delta
                        v[j] -= delta
                    else:
                        minv[j] -= delta
                j0 = j1
                if p[j0] == 0:
                    break
            while j0:
                j1 = way[j0]
                p[j0], j0 = p[j1], j1
        return {p[j] - 1: j - 1 for j in range(1, size + 1) if p[j]}

    def _assign(self, chosen: list[dict], formation: str, order=None,
                home: dict[int, str] | None = None) -> list[tuple[str, dict]]:
        """The eleven MEN are given; this decides WHICH SHIRT each of them wears.

        The operator's rule, and it is a rule about football and not about drawing: «4 centrocampisti
        centrali non esistono, massimo 3 - ai lati devono esserci due esterni (ali, terzini, esterni), mai
        centrali». It cannot be satisfied by placing men who were bucketed by their own role: Napoli's
        declared eleven has Politano (`RW;MR`) and Santos (`LW`) in it, so the four HAS its two wide men -
        they were just being drawn as a front three while four central midfielders shared the line.

        So the shape's own places are handed out over the eleven already chosen. Nobody can be left out and
        nobody can be added: with as many places as men, this only ever decides the arrangement - which is
        the difference from fitting a shape by SELECTING per line, the thing that once put a 35% squad
        player on the pitch while a 100% full back sat outside.

        Solved as ONE assignment (`_matching`) and not a place at a time, because a greedy pass has to fix
        an order of priority between the flank and the line, and both orders are wrong on this very eleven -
        the numbers are in `_matching`. `order` breaks ties (the editors' probability by default), which is
        why the price carries a small rank term: two arrangements of equal cost should not depend on the
        order the rows happened to arrive in.
        """
        order = order or (lambda row: -self.claim(row, "recent"))
        places = [(lane, wanted) for lane, count in self.shape_lanes(formation)
                  for wanted in self.slot_shape(lane, count)]
        if not places or not chosen:
            return [(self.lane_of(row), row) for row in chosen]
        ranked = sorted(range(len(chosen)), key=lambda index: order(chosen[index]))
        rank = {index: position for position, index in enumerate(ranked)}
        # Three terms, in descending weight, and the two small ones only ever decide a TIE:
        #   the price of the place (what this is about);
        #   whether he is drawn OUT of the line he was picked for, charged by how good he is - so when the
        #     shape has more places than a line has men, the compromise falls on the weakest of them. A
        #     squad of three strikers filling a 4-4-2 put the 10% man in the attack and the 90% one in
        #     midfield, because the total was the same either way and nothing broke the tie.
        #     THE CHARGE IS `len - rank` AND NOT `rank`, which is what the sentence above always said and
        #     the arithmetic did not: rank 0 is the BEST man, so charging `rank` made him the cheapest to
        #     displace. Liverpool's guarded case was passing for another reason (a swap in `_flanked` kept
        #     the weakest man out of the row), and the moment that swap stopped happening the compromise
        #     landed on Gravenberch (0.90) instead of Jones (0.62). Corrected: 16 boards of 108 change and
        #     all but one are two equal centre backs trading places; the real one is Dortmund keeping Can
        #     (`MC;DC;DM`) out of its back three, which is the same sentence again;
        #   his rank, so two men who are equal in every other respect are ordered by who plays more and the
        #     board never depends on the order the rows happened to arrive in.
        lone = sum(1 for lane, _side in places if lane == "A") == 1
        cost = [[1000 * self._slot_price(row, side, lane, lone=lone)
                 + (10 * (len(chosen) - rank[index])
                    if home and home.get(id(row)) not in (None, lane) else 0)
                 + rank[index]
                 for lane, side in places]
                for index, row in enumerate(chosen)]
        taken = self._matching(cost)
        out: list[tuple[str, dict]] = []
        for index, row in enumerate(chosen):
            place = taken.get(index)
            if place is None or place >= len(places):
                # more men than the shape has places (a malformed module): he is still drawn, in the line
                # his own role puts him in, rather than vanishing from the board
                out.append((self.lane_of(row), row))
                continue
            lane, side = places[place]
            self._slot_side[id(row)] = side
            out.append((lane, row))
        return out

    def _reshape(self, placed: list[tuple[str, dict]],
                 formation: str = "") -> list[tuple[str, dict]]:
        """The men are placed; this transforms the MODULE around the ones who cannot do the job asked -
        the way a coach transforms it, and in the order a coach checks it. Balanced, symmetric, equal.

        Five rules, each of them the operator's own words, applied top to bottom:

        1. NOBODY PLAYS TWO LINES FROM HOME (`LINE_REACH`): a man given a line none of his codes play
           moves to the one they do, «il cambio di linea deve essere un passo obbligato».
        2. A FLANK IS COVERED BY A FLANK PLAYER: a central man does not hold a wing («4 centrocampisti
           centrali non esistono... ai lati devono esserci due esterni, mai centrali»). He vacates it and
           joins the central row his own depth says - his most ADVANCED code, because Napoli's four are
           all `MC` first and two of them also play the trequarti, which is the «dislocarsi un po' sulla
           tre quarti e sulla mediana». The DEFENCE is exempt: the outer men of a back line are braccetti,
           and moving them out drew Bayern's back four as a midfield. So is a striker: his case is rule 4.
           And so is the TREQUARTI, for the reason `SIDE_WEIGHT` already prices: on that row the flank is
           not a role - the three men interchange - so a central trequartista holding the left of a three
           is a job a coach gives, exactly as a centre-forward takes a wing for a spell. Measured on
           Barcelona's split 4-2-3-1: vacating it left Lamine Yamal the only flank of the row, and an
           unpaired 'Ad' folds to a central code (`_paired`) - so the winger read 'T' while standing on
           the touchline, «Yamal non può mai giocare come centrocampista centrale, è un'ala». With the row
           exempt he reads 'Ad' and Lopez, on the place the fit gave him, 'As'. One board, two badges.
        3. A VACATED MIDFIELD WING IS COVERED FROM THE FRONT: «i due attaccanti esterni possono arretrare
           e coprire il centrocampo» - the wide forward whose side it is drops into the slot, as long as
           the attack keeps a man. Without this the row simply lost the wing and the module its symmetry.
        4. A THINNED FRONT LINE KEEPS ITS CENTRE-FORWARDS («Krstovic e Scamacca non possono trasformarsi
           in As, sono Pc e basta»): when fewer men remain than the module asked for, the places left are
           central, so whoever is not a centre-forward first drops onto the trequarti - wingers keep
           their flank there (an inside forward), «Sp + Pc non può avere un esterno d'attacco». Never the
           last man: a squad whose only forwards are wingers is drawn with them up front.
        5. A MIDFIELD ROW IS FIVE AT MOST («una linea di centrocampo a 5 è già il massimo»): the extra
           centrals dislocate onto the trequarti, most advanced first, weakest claim first among equals.
           The flank slots stay - a wing back on the trequarti would empty the wing he covers.
        6. AND THE MIRROR OF RULE 2, IN THE ATTACK: a man who plays NO central role does not hold a CENTRAL
           place of the front line - «Neres non è una Sp, è un esterno, non potrebbe mai giocare al centro,
           al massimo sulla trequarti». Napoli's 3-5-2 gave the second central place beside Hojlund to a
           winger and the badge called him the seconda punta; he drops to the row his own depth says, which
           for a winger IS the trequarti. Never the last man, for the same reason as rule 4: a squad whose
           only forward is a winger is drawn with him up front.

        Only a man who plays NO flank at all vacates one (`sides_of` exactly central): an inverted winger,
        a full back covering the other side, a `DC;DL` on the left are all things a coach does, and they
        keep their shirt. Whoever moves is REMEMBERED (`_reshaped`), because `lanes_for` re-reads the
        typical eleven's lanes from the men's codes and would otherwise undo the decision: a winger sent
        onto the trequarti has no code that plays there - being moved is the whole point.
        """
        out: list[tuple[str, dict]] = []
        self._reshaped = set()
        vacated: list[str] = []       # sides of MIDFIELD flank slots a central man could not hold
        forwards = sum(1 for lane, _row in placed if lane == "A")
        for lane, row in placed:
            side = self._slot_side.get(id(row))
            # rule 2, with its three exemptions: the defence (braccetti), a striker (rule 4 is his), and
            # the trequarti, where the flank is not a role and the three men interchange (`SIDE_WEIGHT`)
            wrong_flank = (lane in ("M", "A") and side in ("R", "L")
                           and self.sides_of(row) == {"C"} and "ST" not in self.real_roles(row))
            # rule 6, its mirror: a man who plays no central role at all does not hold a CENTRAL place of
            # the front line - never the last man of the line, and only when SOMEBODY ELSE up there can
            # hold the middle. A front line of nothing but wingers is the truth about a squad with no
            # centre-forward (Lazio: Cancellieri, Isaksen, Zaccagni), and emptying its middle would be the
            # drawing inventing a punta the side has not got.
            # AND ONLY ONTO A ROW HE CAN STAND OFF-CENTRE IN: «un attaccante esterno può adattarsi sulla
            # trequarti solo se decentrato, ovvero in linea di trequarti con almeno 2 calciatori». Napoli's
            # 3-5-2 has one place behind the striker, so sending Neres there drew him dead centre on a row
            # of one - a lone trequartista, which is the same mistake one line further back. Where the
            # trequarti cannot hold him he stays up front, and what answers for it is the SELECTION: a
            # central place of the front line wants a man who can play there (`_pointed`).
            wrong_middle = (lane == "A" and side == "C" and forwards > 1
                            and "C" not in self.sides_of(row)
                            and any("C" in self.sides_of(other) for other_lane, other in placed
                                    if other_lane == "A" and other is not row)
                            and (sum(1 for other_lane, other in placed if other_lane == "T")
                                 + sum(1 for other_lane, other in placed
                                       if other_lane == "A" and other is not row
                                       and "C" not in self.sides_of(other)) >= 1))
            wrong_line = lane != "P" and not self._within_reach(row, lane)         # rule 1
            if lane == "P" or not (wrong_flank or wrong_middle or wrong_line):
                out.append((lane, row))
                continue
            depths = [REAL_ROLE_DEPTH[code] for code in self.real_roles(row)
                      if code in REAL_ROLE_DEPTH]
            if wrong_line and depths:
                home = min(("D", "M", "T", "A"),
                           key=lambda key: min(abs(depth - self.LANE_DEPTH[key])
                                               for depth in depths))
                self._slot_side[id(row)] = "C" if home != lane else side
                self._reshaped.add(id(row))
                forwards -= lane == "A" and home != "A"
                out.append((home, row))
                continue
            if lane == "M":                                                        # rule 2
                vacated.append(side)
            home = self._dislocated(row, lane)
            self._slot_side[id(row)] = "C"
            self._reshaped.add(id(row))
            forwards -= lane == "A" and home != "A"
            out.append((home, row))
        for side in vacated:                                                       # rule 3
            front = [(index, row) for index, (lane, row) in enumerate(out) if lane == "A"]
            takers = [(index, row) for index, row in front
                      if side in self.sides_of(row) and self._within_reach(row, "M")]
            if len(front) < 2 or not takers:
                continue
            index, row = max(takers, key=lambda entry: self.claim(entry[1], "season"))
            out[index] = ("M", row)
            self._slot_side[id(row)] = side
            self._reshaped.add(id(row))
        # The cap comes LAST, because rule 4 can hand the row a man too: a `MC`-first forward dislocated
        # out of the attack lands in the midfield, and Genoa's next-match five became a six that way.
        out = self._capped(self._narrowed(out, formation))
        # ...and then no SLOT may outlive the row that issued it. A flank is a place, so a row that has none
        # cannot hand one out: Dortmund's 3-4-3 gave Sabitzer the front three's left, rule 4a sent him back
        # to a trequarti of ONE, and the stale L had the badge read 'As' on a row whose only place is the
        # middle - «Sabitzer sta giocando sulla trequarti quindi il badge deve mostrare T».
        # DROPPED and not set to "C", because the slot is read by two different things and only one of them
        # is wrong here: the badge must stop naming a flank the row has not got, while the DRAWING must
        # still put a right-sided man on the right - «Saka gioca come Ad, quindi anche sulla trequarti deve
        # posizionarsi a destra». With no slot, `across_bucket` falls back to the man's own flank, which is
        # exactly what that asks for; the badge is told about the row instead (`_line_codes`).
        for lane in ("D", "M", "T", "A"):
            men = [row for other, row in out if other == lane]
            if men and not set(self.slot_shape(lane, len(men))) & {"R", "L"}:
                for row in men:
                    # only a FLANK slot is stale: a central one is the shape's own answer and the drawing
                    # reads it (a back three is three central places, and its braccetti are spread by foot)
                    if self._slot_side.get(id(row)) in ("R", "L"):
                        del self._slot_side[id(row)]
        return out

    def _dislocated(self, row: dict, lane: str) -> str:
        """Which central row a man joins when the place he was given is not his job: `M` or `T`.

        By his most ADVANCED code, not the nearest one: Napoli's four are all `MC` first and two of them
        also play the trequarti, so the nearest code flattened them into one row of six - the most advanced
        one spreads them, which is the operator's «dislocarsi un po' sulla tre quarti e sulla mediana».
        """
        depth = max((REAL_ROLE_DEPTH[code] for code in self.real_roles(row)
                     if code in REAL_ROLE_DEPTH), default=self.LANE_DEPTH.get(lane, 0.60))
        return min(("M", "T"), key=lambda key: abs(depth - self.LANE_DEPTH[key]))

    # The widest line a coach lines up in a ROW (`_reshape` rule 5). Six across is not a midfield, it is
    # two rows drawn as one - the vocabulary says so itself, since a 3-4-2-1 fields six midfielders in the
    # P/D/C/A sense (`lines`) and nobody draws them in a line.
    MIDFIELD_ROW: ClassVar[int] = 5

    def _capped(self, placed: list[tuple[str, dict]]) -> list[tuple[str, dict]]:
        """Rule 5 of `_reshape`: the midfield row keeps `MIDFIELD_ROW`, the extra centrals dislocate to T.

        A six is arrived at from either end - a measured shape rounded to 3-6-1, or the transformation
        sending a man back into a five that was already full - and both are the same drawing.
        """
        row_men = [row for lane, row in placed if lane == "M"]
        if len(row_men) <= self.MIDFIELD_ROW:
            return placed
        forward = sorted(
            (row for row in row_men if self._slot_side.get(id(row), "C") == "C"),
            key=lambda row: (-max((REAL_ROLE_DEPTH[code] for code in self.real_roles(row)
                                   if code in REAL_ROLE_DEPTH), default=0.60),
                             self.claim(row, "season")))
        movers = {id(row) for row in forward[:len(row_men) - self.MIDFIELD_ROW]}
        if not movers:
            return placed
        self._reshaped |= movers
        return [("T", row) if lane == "M" and id(row) in movers else (lane, row)
                for lane, row in placed]

    def _narrowed(self, placed: list[tuple[str, dict]],
                  formation: str) -> list[tuple[str, dict]]:
        """Rule 4 of `_reshape`, in two steps: the front line holds FORWARDS, and once thinned only punte.

        4a. A PLACE IN THE FRONT LINE IS A FORWARD'S JOB. Roma measured it: the module is a 3-4-3 (39 of the
        club's 42 elevens, because the provider counts a trequartista among the forwards) and the men are
        Malen, Dybala (`AM;ST`) and Soulé (`AM;RW`) - so two trequartisti were drawn as wide forwards while
        the punta took a wing, «Malen ha giocato solo come Pc, dovrebbero giocare Dybala e Soulé come
        trequartisti». A man whose FIRST code is not an attacking place is a trequartista or a midfielder
        who can also go up, not a forward: he drops to the row his own depth says (`_dislocated`), and the
        front line is left to the men whose job it is. Never all of them: a side whose forwards are all
        trequartisti is drawn with them up front.

        4b. A front THREE is two wingers and a punta (`SLOT_SHAPE`); take a place away and what remains is
        CENTRAL, so the men who keep it are the ones whose FIRST role is the middle of an attack (`ST;AM`
        stays, `AM;ST` drops - De Ketelaere plays off Krstovic, not beside him). A mover keeps the flank
        the shape gave him: an inside forward on his own side, not a central trequartista. Whoever stays
        is re-slotted central, because a flank slot of a line the module no longer has is a stale answer
        the badge would read («Krstovic ... sono Pc e basta»).

        Three guards on 4b, each a case that must NOT move: only a line the transformation actually thinned
        (a module that asks for two forwards keeps its seconda punta); only when no flank place is left (a
        front four still has wings); never the last man - a squad whose only forwards are wingers is drawn
        with them up front, which is the truth about the squad and not an empty front line.
        """
        front = [row for lane, row in placed if lane == "A"]
        strangers = {id(row) for row in front                                      # rule 4a
                     if self.real_roles(row)
                     and self.LANE_OF_ROLE.get(self.real_roles(row)[0]) != "A"}
        if strangers and len(strangers) < len(front):
            self._reshaped |= strangers
            placed = [(self._dislocated(row, lane), row) if lane == "A" and id(row) in strangers
                      else (lane, row) for lane, row in placed]
            front = [row for lane, row in placed if lane == "A"]
        asked = dict(self.shape_lanes(formation)).get("A", 0) if formation else 0
        if not front or len(front) >= asked:
            return placed
        if set(self.slot_shape("A", len(front))) & {"R", "L"}:
            return placed
        # His FIRST code, the provider's own order of evidence: `ST;AM` is a centre-forward who also drops
        # in, `AM;ST` is a trequartista who also plays there. A man with no observed code at all stays -
        # the line he was picked for is all that is known about him, and it says forward.
        movers = {id(row) for row in front
                  if self.real_roles(row) and self.real_roles(row)[0] != "ST"}
        if len(movers) >= len(front):
            movers = set()           # never the last man: the line keeps every one of them...
        for row in front:
            if id(row) not in movers:
                self._slot_side[id(row)] = "C"     # ...and what it has left to give is central
        if not movers:
            return placed
        self._reshaped |= movers
        return [("T", row) if lane == "A" and id(row) in movers else (lane, row)
                for lane, row in placed]

    def _declared(self, squad: list[dict],
                  formation: str = "4-3-3") -> list[tuple[str, dict, list[dict]]]:
        """The probabili's own eleven: the men the editors name, in the DECLARED shape's own places.

        For the coming match this IS the answer - it is the coach's declared side, and no measurement
        beats it. What it must not be made to do is fit a shape by SELECTING per line: the editors' 3-4-2-1
        calls two full backs wing backs, and demanding six midfielders once put a 35%-probability squad
        player on the pitch while a 100% full back sat outside the eleven. Choosing WHO plays and deciding
        WHERE each of them plays are two questions, and only the first one is the editors' (`_assign`).

        The eleven is theirs; the ALTERNATIVES are not. A probability answers "does he start on Sunday",
        and its absence is not an answer about the shirt: Neres, injured on the day, is in no probabili
        list and is still the man who takes Politano's place. So the rivals are drawn from the whole
        squad, ranked by `presence(recent)` - which IS the editors' probability where they gave one, so a
        listed man still comes first - and only whoever cannot play the coming match is left out.
        """
        listed = sorted((row for row in squad if row.get("desc_starter_prob")),
                        key=lambda row: -_number(row.get("desc_starter_prob")))
        keepers = [row for row in listed if self.lane_of(row) == "P"]
        chosen = keepers[:1] + [row for row in listed if self.lane_of(row) != "P"][:10]
        names = {row.get("name") for row in chosen}
        rest = sorted((row for row in squad if row.get("name") not in names
                       and not row.get("desc_injury_open")
                       and row.get("desc_availability_now") not in ("injured", "suspended")),
                      key=lambda row: -self.presence(row, "recent"))
        alternatives: dict[str, list[dict]] = {}
        offered: set[str] = set()
        for starter in chosen:
            named = [name.strip() for name in (starter.get("desc_duel_names") or "").split(";")
                     if name.strip() and name.strip() not in names]
            # No lane bucket: `can_replace` is the positional test, and a bucket on top of it stranded
            # every trequartista of a side that declares no trequartista - De Bruyne and Vergara sit in
            # the 'T' lane, and Napoli's declared eleven has ten outfield men in D, M and A.
            # And a man is offered ONCE: three midfield shirts all reporting the same first alternative
            # said the same thing three times and hid the second and the third.
            able = [row for row in rest if self.can_replace(starter, row)]
            pool = [row for row in able if row.get("name") not in offered]
            # ...and a shirt that would be left with nobody takes a man who is already challenging
            # another: one alternative twice is a reading, no alternative at all is a wrong one.
            # A NAMED ballottaggio is a stated fact and all of it is carried (up to three). The
            # positional fallback stays at one on purpose: it is our inference, and `offered` spends a
            # man per shirt - being greedy with guesses leaves the last shirts of a line with nobody.
            rivals = ([row for row in pool if row.get("name") in named][:3] or pool[:1] or able[:1])
            offered.update(row.get("name") for row in rivals)
            alternatives[starter.get("name")] = rivals
        # WHERE each of them plays: the shape's own places, by fit (`_assign`), and the lines are final -
        # a man given the four's left flank is drawn there and not moved back to his own code's line.
        self._lanes_final = True
        return [(lane, row, alternatives.get(row.get("name"), []))
                for lane, row in self._reshape(self._assign(chosen, formation), formation)]

    def _fielded(self, squad: list[dict],
                 formation: str = "4-3-3") -> list[tuple[str, dict, list[dict]]]:
        """The eleven the club really FIELDED, from `actual_next_started`. A fact, and only on a past sheet.

        It outranks every forecast for the obvious reason: the question "who plays on Sunday" has an answer
        once Sunday has happened, and a back-dated sheet is standing after it. It is kept in its own column
        family (`actual_*`) and drawn through its own method rather than being poured into
        `desc_starter_prob`, because a sheet where a certainty and a guess share a column is a sheet where
        nobody can tell which is which - and the board's caption says which one it is showing.

        The ALTERNATIVES stay a reading: who else could have taken that shirt, ranked as everywhere else.
        The bench of that match is not in the layer (it stores a row for a man who got minutes), so the
        rivals are ours, not history's.
        """
        chosen = [row for row in squad if row.get("actual_next_started") == "1"]
        keepers = [row for row in chosen if self.lane_of(row) == "P"]
        eleven = keepers[:1] + [row for row in chosen if self.lane_of(row) != "P"][:10]
        names = {row.get("name") for row in eleven}
        rest = sorted((row for row in squad if row.get("name") not in names),
                      key=lambda row: -self.presence(row, "recent"))
        alternatives: dict[str, list[dict]] = {}
        offered: set[str] = set()
        for starter in eleven:
            able = [row for row in rest if self.can_replace(starter, row)]
            pool = [row for row in able if row.get("name") not in offered]
            rivals = pool[:1] or able[:1]
            offered.update(row.get("name") for row in rivals)
            alternatives[starter.get("name")] = rivals
        self._lanes_final = True
        return [(lane, row, alternatives.get(row.get("name"), []))
                for lane, row in self._reshape(self._assign(eleven, formation), formation)]

    # The same position on the OTHER flank. A coach who runs out of right backs plays a left back there
    # and inverts him; he does not play a centre-forward there. So a mirrored flank is a real option and
    # the two are never treated as one: it is the SECOND choice, both when a shirt is handed out
    # (`_slot_price`) and when the alternatives are listed (`can_replace`).
    MIRROR: ClassVar[dict[str, str]] = {"DL": "DR", "DR": "DL", "ML": "MR", "MR": "ML",
                                        "LW": "RW", "RW": "LW"}

    # The code that names a flank of each LINE - what the badge reads when the shape gave a central man a
    # flank slot ('DC' at right back is a `Td`). The T row borrows the wings, because a wide trequartista
    # is drawn where a winger would be.
    FLANK_OF_LANE: ClassVar[dict[tuple[str, str], str]] = {
        ("D", "R"): "DR", ("D", "L"): "DL",
        ("M", "R"): "MR", ("M", "L"): "ML",
        ("T", "R"): "RW", ("T", "L"): "LW",
        ("A", "R"): "RW", ("A", "L"): "LW",
    }
    # ...and its mirror: the code a CENTRAL place of each line names. No entry for the attack, whose
    # vocabulary `_line_codes` owns («Krstovic e Scamacca sono Pc e basta», wherever they are drawn).
    CENTRE_CODE_OF_LANE: ClassVar[dict[str, str]] = {"D": "DC", "M": "MC", "T": "AM"}

    @classmethod
    def can_replace(cls, starter: dict, row: dict, mirrored: bool = False) -> bool:
        """Whether this man could really take that place - the same POSITION, in the REAL vocabulary.

        The granular codes decide, and one shared code is enough: 'RW;AM' and 'AM' do compete for the
        same shirt. The listone role is NOT a fallback here, and that is the whole rule - it says what
        you buy a man as, not where a coach puts him, and at Napoli it calls Politano, Lobotka, Elmas,
        McTominay, Anguissa, De Bruyne, Vergara and Neres the same thing. Nor is the flank it implies any
        better: with no codes, `side_of` reads the Mantra role, which is the same listone talking again.

        So a man with no granular code is in NO duel. That is a gap in the OBSERVED roles, not a fact
        about him, and it belongs where it can be seen and cured - the provider identity first, then
        `positions --layer roles`, which observes the codes and only for TODAY - instead of being papered
        over with a false duel. A false duel is the worse error at an auction: it reads as a risk that is
        not there, and it drags down the percentage of a man who actually has nobody behind him.
        """
        mine, theirs = set(cls.real_roles(starter)), set(cls.real_roles(row))
        if mirrored:
            mine |= {cls.MIRROR[code] for code in mine if code in cls.MIRROR}
        return bool(mine & theirs)

    @classmethod
    def real_roles(cls, row: dict) -> list[str]:
        """His granular real roles, in the provider's own order: ['DL', 'ML'].

        Only codes from the enumerated vocabulary survive, so a new one upstream leaves the marker
        neutral instead of placing a man by a code nothing here can read.

        The ORDER is load-bearing - the first code is his job, and everything from the badge to the price of
        a place reads it - and `HEATMAP_FIRST` is the experiment on where that order should come from.
        """
        codes = [code.strip() for code in (row.get("desc_real_roles") or "").upper().split(";")
                 if code.strip() in REAL_ROLES]
        if not cls.HEATMAP_FIRST or len(codes) < 2:
            return codes
        measured = _number(row.get("desc_side_measured"), None)
        if measured is None:
            return codes
        if cls.HEATMAP_FIRST == "all":
            return sorted(codes, key=lambda code: abs(REAL_ROLE_SIDE.get(code, 0.0) - measured))
        # the narrow arm: a flank code the measurement CONTRADICTS loses its place to a central one, and
        # never for a man who holds both wings - there a centroid near zero means "both", not "neither"
        named = REAL_ROLE_SIDE.get(codes[0], 0.0)
        if not named or cls.MIRROR.get(codes[0]) in codes:
            return codes
        if abs(measured) >= 0.1 and (measured > 0) == (named > 0):
            return codes
        central = next((code for code in codes if not REAL_ROLE_SIDE.get(code, 0.0)), None)
        return [central, *(code for code in codes if code != central)] if central else codes

    # WHERE THE ORDER OF A MAN'S CODES COMES FROM - and it stays the PROVIDER'S, measured.
    #
    # The order is load-bearing (the first code is his job) and the two sources disagree on 31 of the 246
    # Serie A men who have two codes and a measured side, 51 of 343 on euro. The provider's list is an
    # observation of TODAY (`seasonId` is ignored at the source); the season heatmap measures the window the
    # sheet is about. Malen is the case the operator brought: `RW;ST` by code, side -0.149 and the most
    # advanced depth of his line by heatmap - a punta centrale drawn as an ala destra.
    #
    # Scored against the 20 published typical elevens of the same window (SOS Fanta), on the sharpest metric
    # available - for every man in both elevens, does the source draw him in the same LINE (193 judged):
    #   * baseline, the provider's order:                             172/193 = 89.1%
    #   * `"all"`, every code sorted by the measured side:             174/194 = 89.7%   (+2, -1 at Pisa)
    #   * `True`, only demoting a flank code the measurement denies:   172/193 = 89.1%   (+0)
    # So the narrow rule buys NOTHING - Malen's own case is already carried by `_reshape` rule 4a, which
    # reads the LINE of his first code and not its flank - and the broad rule's +1 point is not separable
    # from a documented artefact: it promotes the central code of a man used on BOTH wings (Pulisic
    # `RW;LW;AM;ST` -> `AM;ST;LW;RW`), which is the season-centroid smearing `lateral` already warns about,
    # and it is what turned Juventus into a 3-4-2-1 (+2) while breaking Pisa (-1). Two clubs out of twenty.
    #
    # A FOURTH arm answers the operator's follow-up - «separare chi gioca sulle fasce dx e sx da chi gioca
    # al centro» - and it is the right reading of the heatmap, because a MEAN cannot tell a man used on both
    # wings from a central one while the CLOUD can. The cloud is already on disk (the Sofascore payload
    # `points: [{x, y, count}]`, which `positions.ingest_heatmaps_from_cache` already parses for the
    # centroid), so the three band shares - left third, middle third, right third of the team-oriented y
    # axis - cost nothing to compute. They separate the two cases cleanly on the very pair the centroid
    # confuses: Malen 0.37 / 0.50 / 0.14 (CENTRAL, the middle holds half his touches) against Pulisic
    # 0.46 / 0.30 / 0.24 (BOTH FLANKS), centroids -0.149 and -0.163. Diao `RW;LW` reads 0.38/0.14/0.48 and
    # Rensch `DR;MR` 0.47/0.10/0.43 - both flanks, empty middle - exactly as a coach would say it.
    # Measured end to end, it still does not earn a place in the DRAWING: it reorders 2 men of the 246 with
    # two codes (Malen, and Gonzalez whose first code names the wrong wing), scores the same 172/193, leaves
    # all 162 drawn shapes identical, and its only visible effect is 2 markers of 1782 - Roma's Dybala and
    # Soulé read 'As'/'Ad' instead of 'T'/'T', which is the opposite of what the operator asked for. The
    # board is simply INSENSITIVE to the order here, because rule 4a reads the LINE of a code and `_paired`
    # settles the vocabulary; that insensitivity is a property worth keeping, not a gap.
    # Where the bands WOULD pay is a different question with a different metric: `sides_of` (can he really
    # cover the other flank?) and the alternatives that read it. Not plumbed - it needs a column.
    HEATMAP_FIRST: ClassVar[bool | str] = False

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

    def _lane(self, slots: list[tuple[dict, list[dict]]],
              lane: str = "M") -> list[tuple[dict, list[dict]]]:
        """One line of the formation, in SCREEN order (left to right on the canvas).

        Left and right are the player's, judged facing the opponents' goal - and the pitch is drawn with
        the keeper at the top, so the team attacks DOWNWARDS and its left flank is the viewer's RIGHT.
        Hence the sort is descending: the team's right back is drawn first, at the screen's left. Getting
        this backwards mirrors every full back on the board, which is worse than not placing them at all.

        Ordered by the SLOT the man won first (`across_bucket`) and only then by how far out he really
        stood, with the preferred foot separating men the measurement leaves equal - the left-footed one
        of two centre backs to the left, which is measured and is exactly the pair no code speaks about.
        `_placed` sorts again on the same keys; this order is what it starts from, and the two agreeing
        matters more than either of them being clever.

        `lateral` stays team-relative everywhere else; the inversion belongs to the drawing alone.
        """
        def key(entry):
            side, row = entry[0], entry[1]
            return (-self.across_bucket(row, lane), -(side or 0.0), -self.foot_side(row, lane))

        known = [(self.lateral(row), row, rivals) for row, rivals in slots]
        # Side unknown AND no slot to stand on: those are the men the flanks are filled with, alternately,
        # because "wide, side unknown" is what a Mantra 'e' or 'w' with no granular code means. A man the
        # shape gave a slot to is never in here - his side is not unknown, it was decided.
        loose = [index for index, entry in enumerate(known)
                 if entry[0] is None and not self._slot_side.get(id(entry[1]))]
        placed = sorted((entry for index, entry in enumerate(known) if index not in loose), key=key)
        unknown = [known[index] for index in loose]
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
    CENTRAL_STEP: ClassVar[float] = 0.22     # the gap between two men of an all-central line
    # ...and how far out a central BLOCK may reach: never past where a line of three would stand
    # (0.28 .. 0.72). Without the clamp four central men spread 0.17 .. 0.83 - two thirds of the width,
    # which is a line of four with wingers and not a block of four centrals. A line of three or fewer is
    # untouched by it, which is most of them: `("D", 3)`, `("M", 3)`, the trequartisti.
    CENTRAL_MARGIN_MIN: ClassVar[float] = 0.5 - CENTRAL_STEP

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

    def _centred(self, entries: list[tuple[dict, list[dict]]],
                 lane: str) -> list[tuple[dict, list[dict]]]:
        """The MEDIANO stands in the MIDDLE of his row: «Rodri è una M, le M vanno piazzate al centro».

        Which men are wide is decided (`across_bucket`); among the CENTRAL ones nothing said who holds the
        middle, so the order fell through to the foot and the claim - and Manchester City's five drew Rodri
        (`DM`, the deepest man of the row) off-centre with a mezzala in the middle of it. So the central run
        is filled FROM THE OUTSIDE IN, shallowest first: what ends up in the middle is the man whose own job
        is the deepest, which is what a mediano davanti alla difesa is.

        By his PRIMARY code, the provider's order of evidence and the same reading the rest of this module
        uses: `DM` is a mediano, `MC;DM` is a central midfielder who can also sit deeper. Rows of two are
        left alone - two central places are symmetric, so there is no middle to hold.
        """
        places = [index for index, (row, _rivals) in enumerate(entries)
                  if self.across_bucket(row, lane) == 0]
        if len(places) < 3:
            return entries
        shallow_first = sorted(
            (entries[index] for index in places),
            key=lambda entry: -REAL_ROLE_DEPTH.get(
                next(iter(self.real_roles(entry[0])), ""), self.LANE_DEPTH.get(lane, 0.60)))
        arranged: list[tuple[dict, list[dict]] | None] = [None] * len(places)
        low, high = 0, len(places) - 1
        for step, entry in enumerate(shallow_first):
            if step % 2:
                arranged[high], high = entry, high - 1
            else:
                arranged[low], low = entry, low + 1
        out = list(entries)
        for index, entry in zip(places, arranged):
            if entry is not None:
                out[index] = entry
        return out

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
        # The SLOT first (`across_bucket`), then the widest man of a flank to the outside, then the foot,
        # then who plays most. Each of those is a mistake this made: a marginally wide striker took the
        # middle of a three-man attack off the centre-forward (who then read as the seconda punta), a left
        # back was drawn inside a left midfielder because he had fewer starts, and two men coded for the
        # same flank shared the two outer slots while the centre-forward was pushed onto a wing.
        def order(entry):
            side = self.flank(entry[0])
            bucket = self.across_bucket(entry[0], lane)
            # the widest man of a flank goes OUTSIDE, and outside is a different direction on each
            # flank: the drawn order runs from the team's right to its left, so on the right the widest
            # comes first and on the left it comes last
            return (-bucket, -abs(side) * bucket, -self.foot_side(entry[0], lane),
                    -self.claim(entry[0], "season"))

        entries = self._centred(sorted(slots, key=order), lane)
        count = len(entries)
        # Wide only if the line has flanks AND MEN WHO PLAY THEM. The shape says a midfield four is two
        # wide men and two centrals, and where the men are the shape's own the two readings agree - but a
        # line can arrive with nobody wide, and then the grid was stretched to the touchlines anyway and
        # the outermost CENTRAL midfielder read as a winger. Napoli's declared four (McTominay, Anguissa,
        # Elmas, Lobotka: `MC`, `MC;DM`, `MC;AM`, `MC;DM`) drew Lobotka on the left touchline - the
        # operator's own catch, and "in un centrocampo a 4 due sono esterni, e devono essere esterni di
        # ruolo". They cannot be invented: for a declared eleven the men are the editors', so what the
        # drawing owes is not to CLAIM a flank nobody plays. Two of them, because a flank band is a pair
        # of touchlines: with one wide man the line is drawn narrow and he sits at its edge, which says
        # lopsided instead of saying winger.
        # `sides_of` and not the primary code: a `DC;DL` really does play the left, and the line's own
        # composition is exactly the question here.
        wide_men = [row for row, _rivals in entries if self.sides_of(row) & {"R", "L"}]
        asks = bool(set(self.slot_shape(lane, count)) & {"R", "L"})
        block = max(0.5 - (count - 1) * self.CENTRAL_STEP / 2, self.CENTRAL_MARGIN_MIN)
        # BOTH TOUCHLINES OR NEITHER, because «il modulo deve sempre mantenere la simmetria nelle
        # posizioni». One margin per edge shipped here for a while - a line with a single wide man reached
        # HIS touchline and the rest kept the block's spacing, on the argument that lopsided is information
        # - and the operator's rule overrules it: a row drawn with one man on the paint and an empty
        # touchline opposite him is not a position a module has. Fiorentina's front three said it plainest
        # (a seconda punta at 0.28, the punta at 0.58 and a wing back on the left paint), and the vocabulary
        # says the same thing on the marker: a flank code only stands where the line names the other flank
        # too (`_paired`). So a line with fewer than two men who play a flank is a central BLOCK, evenly
        # spread about the middle, and the flanks it does not have are not claimed anywhere.
        start, end = block, block
        if asks and len(wide_men) >= 2:
            start = end = self.LINE_MARGIN
        span = 1 - start - end
        out: list[tuple[float, dict, list[dict]]] = []
        for index, (starter, rivals) in enumerate(entries):
            out.append((start + span * index / (count - 1) if count > 1 else 0.5, starter, rivals))
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
    def badge(cls, row: dict, drawn_side: float | None = None, lane: str | None = None,
              slot: str | None = None) -> str:
        """The role code for the marker: 'Ts', 'Td', 'Dc', 'Ed'...

        Three inputs, in this order: the granular REAL role, which names both the line and the flank on
        its own ('DL' is a terzino sinistro and nothing else); then the Mantra role, which often names
        the flank; then, when neither does, WHERE the player is drawn in his line - so a winger the
        sheet places on the left reads 'Es' and not a shrug. Nothing is invented: with none of them,
        the code stays neutral.

        `slot` is the place the shape gave him ('R' / 'C' / 'L'), and where it names a FLANK it wins over
        a central code: «in una linea a 4 di difensori, i due terzini esterni devi segnarli come Ts e Td e
        non come Dc», and the same for a central midfielder holding the right of a five, who reads 'Ed'.
        This is the mirror rule one step further - the role stays his, the FLANK belongs to the shirt -
        and it is what the shape says: a back four HAS two full backs, whoever plays them, while a back
        three has three centre backs and no flank slots at all, so its outer men keep 'Dc'.

        `lane` is the line he is DRAWN in, and it chooses WHICH of his codes is badged: Spinazzola is
        'ML;DL' and the eleven can pick him as its left back, so badging his first code put 'Es' - a
        midfielder - on the left of a back four while Gutierrez, drawn in midfield, read 'Ts'. The line
        is a decision that has already been taken; the badge has to agree with it.
        """
        side = cls.lateral(row)
        if side is None:
            side = drawn_side
        index = 1 if side is None or abs(side) < 0.34 else (0 if side < 0 else 2)
        real = cls.real_roles(row)
        if real:
            code = real[0]
            if lane:
                code = next((other for other in real if cls.LANE_OF_ROLE.get(other) == lane), code)
            named = REAL_ROLE_SIDE.get(code, 0.0)
            # Where the eleven DREW him wins over the flank his own code names, and only for the label:
            # the shirt has already been handed out, `_slot_price` charged him for the switch, and a
            # left-sided man adapted to the right must not read 'Es' while standing on the right - Inter's
            # 3-5-2 did exactly that, two 'Es' on the two flanks with Carlos Augusto at right wing-back.
            # The role stays his (a full back does not become a winger); the FLANK belongs to the shirt.
            if (drawn_side is not None and abs(drawn_side) >= 0.34 and abs(named) >= 0.34
                    and (drawn_side < 0) != (named < 0)):
                code = cls.MIRROR.get(code, code)
            # ...and where the SHAPE gave him a flank and his code names none, the flank is the shirt's:
            # a back four's outer men are full backs (Ts / Td) even when both are centre backs by code, and
            # a central midfielder on the right of a five reads Ed. Only for a slot that IS a flank, so a
            # back three - three central slots - is untouched.
            # A CENTRE-FORWARD is the exception, and the operator's own words are the rule: «Krstovic e
            # Scamacca non possono trasformarsi in As, sono Pc e basta». A terzino and an esterno are jobs
            # a coach gives a central man for a match; a punta centrale is defined by BEING central, so a
            # wide place cannot rename him - what it makes him is the seconda punta of a narrow front line
            # ('Sp', in `_line_codes`, which needs him to still read 'Pc' to see it). A striker who really
            # does play a wing is untouched by this: `ST;LW` gets his wing there, off his own code.
            # AND THE FLANK IS THE ONE OF THE LINE HE IS DRAWN IN, which is the operator's pairing rule:
            # «se c'è un Ed ci deve essere anche una Es e viceversa, se c'è un Ad ci deve essere anche una
            # As, se c'è un Td ci deve essere anche un Ts». A line's two flanks are one pair of jobs, so
            # both of them have to be named in the same vocabulary - and reading the flank off the man's own
            # LINE broke that: Gakpo (`LW`) covering the five's left read 'As' next to Bradley's 'Ed', and
            # Tella (`AM;RW`) on the four's right read 'Ad' next to Tillman's 'Es'. Each was a winger who
            # had dropped into the row, which is true and is not what the row is: the man is in that line,
            # so his flank is that line's. It only fires when NONE of his codes plays there - where one
            # does, `lane` above has already chosen it (Spinazzola is `ML;DL` and reads 'Es' in midfield,
            # 'Ts' at left back).
            if slot in ("R", "L") and code != "ST" and (
                    not REAL_ROLE_SIDE.get(code) or cls.LANE_OF_ROLE.get(code) != lane):
                code = cls.FLANK_OF_LANE.get((lane or cls.LANE_OF_ROLE.get(code, "M"), slot), code)
            # ...AND THE SAME SENTENCE FROM THE OTHER SIDE, which is the operator's: «Martin G. sta giocando
            # al centro, quindi il badge deve mostrare Dc». Where the shape gave him a CENTRAL place and his
            # code names a flank, the middle is the shirt's too - Barcelona's back four read 'Ts' twice, one
            # of them on its second centre-back place, and Cremonese's five had two 'Es' with only one man on
            # the touchline. It is the same asymmetry as above and it stops at the same line: the ATTACK is
            # `_line_codes`'s business, where a centre-forward is a centre-forward wherever he is drawn.
            # A back THREE is three central places and so three 'Dc', which is what `SLOT_SHAPE` says a back
            # three is - a full back adapting into one of the outer two is a braccetto, priced as such.
            # It rewrites the FLANK and never the line, which is the same asymmetry the mirror rule keeps:
            # a mediano drawn at centre back still reads 'C', because that is the compromise the drawing
            # made and the operator has to see it (Liverpool's Mac Allister), while a left back drawn in the
            # middle of a back four is a centre back for the afternoon. On the TREQUARTI the row itself is
            # the job, so a man drawn there whose codes play no attacking-midfield reads 'T' all the same.
            elif slot == "C" and (
                    (lane in ("D", "M") and REAL_ROLE_SIDE.get(code)
                     and cls.LANE_OF_ROLE.get(code) == lane)
                    or (lane == "T" and cls.LANE_OF_ROLE.get(code) != lane)):
                # ...and on the TREQUARTI the row itself is the job, so a man drawn there who plays no
                # attacking-midfield code still reads 'T': «Sabitzer sta giocando sulla trequarti quindi il
                # badge deve mostrare T» - his codes are `MC;DM;LW` and he was reading the wing of a row
                # that has none.
                code = cls.CENTRE_CODE_OF_LANE[lane]
            return cls.BADGE_REAL[code]
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

    def _line_codes(self, placed: list[tuple[float, dict, list[dict]]],
                    lane: str | None = None) -> list[str]:
        """The code on each marker of one line, with only ONE centre-forward among them.

        A real side fields one punta centrale; a second adapts as a seconda punta and reads 'Sp', which is
        what he is actually asked to do. The shirt stays with the striker drawn most centrally - and
        "most centrally" is read off the REAL fractions `_placed` produced, not off an even spread: while
        it was computed from the index, Hojlund at 0.61 read as less central than a second striker at
        0.50 and the true centre-forward was labelled the seconda punta.
        """
        sides = [self._slot_side.get(id(starter), "C") for _spread, starter, _rivals in placed]
        if not {"R", "L"} & set(self.slot_shape(lane or "", len(placed))):
            # a row with no flank PLACES names no flank on any of its markers, whoever stands where: it is
            # the same statement `_paired` makes about a lone forward, read off the shape instead of off the
            # other men's codes, and it is what tells a trequarti of one or two from a trequarti of three.
            sides = ["C"] * len(placed)
        codes = [self.badge(starter, -(spread - 0.5) * 2, lane, slot=sides[index])
                 for index, (spread, starter, _rivals) in enumerate(placed)]
        centre = [index for index, code in enumerate(codes) if code == "Pc"]
        if len(centre) > 1 and len(placed) > 2:
            # A line with WIDE places is drawn as one, so the shirt stays with the man drawn in the middle
            # of it and the other one reads as where he stands. 'Ad' / 'As' only if he really plays there:
            # «Krstovic e Scamacca non possono trasformarsi in As, sono Pc e basta» - a centre-forward who
            # is one and nothing else is a SECONDA PUNTA in a narrow front line, never a winger, and the
            # marker must not invent a job for him out of the place he was given.
            keep = min(centre, key=lambda index: abs(placed[index][0] - 0.5))
            for index in centre:
                if index == keep:
                    continue
                wide = {"LW", "RW"} & set(self.real_roles(placed[index][1]))
                codes[index] = ("As" if placed[index][0] > 0.5 else "Ad") if wide else "Sp"
            return self._paired(codes, lane, sides)
        if len(centre) > 1:
            # A line of two has two CENTRAL places, so this is only about which of them is the point of
            # the attack - and it is decided by ROLE, not by where he ended up drawn: reading the shirt off
            # the drawn x handed 'Pc' to the striker who plays off the flank and called the centre-forward
            # the seconda punta. The purest centre-forward keeps it (`_centre_forward_first`: Krstovic is
            # `ST`, De Ketelaere `AM;ST`, so the shirt is Krstovic's and De Ketelaere is the man playing
            # off him), then the most central role, then the drawing, then who plays most.
            keep = min(centre, key=lambda index: (self._centre_forward_first(placed[index][1]),
                                                  abs(self.flank(placed[index][1])),
                                                  abs(placed[index][0] - 0.5),
                                                  -self.claim(placed[index][1], "season")))
            for index in centre:
                if index != keep:
                    codes[index] = "Sp"
        return self._paired(codes, lane, sides)

    # A line's two flanks are ONE PAIR OF JOBS, and the code each side gets is the other's mirror.
    FLANK_PAIRS: ClassVar[dict[str, str]] = {"Td": "Ts", "Ts": "Td", "Ed": "Es", "Es": "Ed",
                                             "Ad": "As", "As": "Ad"}
    # ...and what a man in that line is when it has no flanks to give: its own CENTRAL job.
    CENTRE_OF_LANE: ClassVar[dict[str, str]] = {"D": "Dc", "M": "C", "T": "T", "A": "Pc"}

    # The rows where a flank is not a ROLE but a place the men INTERCHANGE. The same distinction three
    # times over now, and it is the operator's: `SIDE_WEIGHT` prices the side at 3 there against 8 on a
    # line where a wing back and a mediano are different jobs, `_reshape` rule 2 exempts them, and here a
    # flank code needs the shape's own PLACE rather than a partner to stand on.
    INTERCHANGE: ClassVar[tuple[str, ...]] = ("T", "A")

    def _paired(self, codes: list[str], lane: str | None,
                sides: list[str] | None = None) -> list[str]:
        """A flank code only stands where the line names the OTHER flank too, and otherwise reads central.

        The operator's rule, three times over: «se c'è un Ed ci deve essere anche una Es e viceversa, se
        c'è un Ad ci deve essere anche una As e viceversa, se c'è un Td ci deve essere anche un Ts e
        viceversa». A module's positions are symmetric, so a line that names one wing and not the other is
        describing a shape nobody plays - and every case of it was a man drawn in a line that has no wing
        for him: Wirtz, `AM;LW`, the LONE forward of a 4-5-1, read 'As' standing dead centre; Neres, sent
        back onto the trequarti, read a wing on a row of two whose places are both central.

        The fallback is the line's own central job (a 'C' in midfield, a 'Dc' in defence, a 'T' on the
        trequarti), and in the ATTACK it is the centre-forward - or the SECONDA PUNTA where the punta is
        already somebody else's shirt, since a side fields one.

        NOT on a man the shape put ON a flank of a row that HAS one, where the men interchange
        (`INTERCHANGE`): there the place is the pair, and folding it renamed real wingers after the man
        standing on the other side. Both cases are the operator's own words, from the two ends: Fiorentina's
        declared front three is Harrison (`RW;MR`), Gudmundsson and Piccoli, so the right winger read 'Sp'
        because the left of the three is a punta - «in un attacco a 3 non ci possono essere 2 SP»; and on
        the trequarti it is «Yamal non può mai giocare come centrocampista centrale, è un'ala». What the
        pairing is for is the row with no flank PLACES, and that case is untouched.
        """
        # ONE MAN PER FLANK, first: a row has one right and one left, so two markers reading 'As' is the
        # same defect as an unpaired one seen from the other side - Juventus drew Yildiz and Alajbegovic both
        # as the left-sided forward. The man the shape actually put on that side keeps it (`sides`), and
        # where the shape says nothing the one drawn furthest that way does; the other reads the line's
        # central job, exactly as if he had no pair.
        for side, flank in (("R", ("Td", "Ed", "Ad")), ("L", ("Ts", "Es", "As"))):
            for name in flank:
                holders = [index for index, code in enumerate(codes) if code == name]
                if len(holders) < 2:
                    continue
                keep = next((index for index in holders if sides and sides[index] == side), holders[0])
                for index in holders:
                    if index != keep:
                        codes[index] = self.CENTRE_OF_LANE.get(lane or "", codes[index])
        present = set(codes)
        for index, code in enumerate(codes):
            if code in self.FLANK_PAIRS and self.FLANK_PAIRS[code] not in present:
                if (lane in self.INTERCHANGE and sides
                        and sides[index] in ("R", "L")):
                    continue
                fallback = self.CENTRE_OF_LANE.get(lane or "", code)
                codes[index] = "Sp" if fallback == "Pc" and "Pc" in present else fallback
        return codes

    @classmethod
    def _centre_forward_first(cls, row: dict) -> tuple[int, int]:
        """How much of a CENTRE-FORWARD he is: where 'ST' sits among his codes, and how few other jobs he
        has. `ST` alone is (0, 1), `ST;AM` is (0, 2), `AM;ST` is (1, 2) - a man who plays behind the striker
        as often as he plays there. Nothing observed at all comes last: he reads 'Pc' from the listone's
        vocabulary, which calls half a squad the same thing."""
        codes = cls.real_roles(row)
        return (codes.index("ST"), len(codes)) if "ST" in codes else (9, 9)

    def char_width(self, key: str) -> float:
        """Average character width of a theme font, in pixels - MEASURED, and cached.

        The plate's own width constant (7.2) was measured on the bold face the NAME is drawn in. The
        rival line is drawn one size smaller and not bold, so budgeting it at 7.2 threw away about a
        fifth of the room - which is a whole surname on a crowded line, i.e. exactly the difference
        between naming both men and counting one of them.
        """
        cache = getattr(self, "_char_widths", None)
        if cache is None:
            cache = self._char_widths = {}
        if key not in cache:
            from tkinter import font as tkfont
            sample = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
            with contextlib.suppress(Exception):
                cache[key] = tkfont.Font(font=theme.FONTS[key]).measure(sample) / len(sample)
        return cache.get(key) or 7.2

    def _shirt_under(self, event) -> tuple[dict, list[dict]] | None:
        """The shirt nearest the pointer, or None if the pointer is on grass."""
        nearest, best = None, 34.0 ** 2       # a shirt owns ~34px around its marker; beyond that, grass
        for x, y, starter, rivals in getattr(self, "_hits", []):
            distance = (event.x - x) ** 2 + (event.y - y) ** 2
            if distance < best:
                nearest, best = (starter, rivals), distance
        return nearest

    def _on_pitch_click(self, event) -> None:
        """Open the duel of the shirt nearest the pointer, if the pointer is on a shirt at all."""
        found = self._shirt_under(event)
        if found:
            self._duel_popup(*found)

    def _on_pitch_motion(self, event) -> None:
        """Follow the pointer from shirt to shirt, rescheduling the tip when it changes."""
        found = self._shirt_under(event)
        name = found[0].get("name") if found else None
        if name == getattr(self, "_hovered", None):
            return
        self._hovered = name
        self._tip_for = found
        self.pitch_tip.hide()
        if found:
            self.pitch_tip.schedule()

    def _pitch_tip_text(self) -> str:
        """The hovered shirt's duel IN FULL - which is what the plate cannot hold.

        Every rival with his own share, so a plate reading `+1` has somewhere to be resolved, plus the
        editors' named ballottaggio when there is one. Two lines of ranking, not prose: the tooltip is
        read while the pointer is moving.
        """
        found = getattr(self, "_tip_for", None)
        if not found:
            return ""
        starter, rivals = found
        horizon = "recent" if self.xi_mode.get() == "next" else "season"
        share = self.claim(starter, horizon)
        # The FOOT is on the head line, because it is half of why he stands on this side: the flanks of a
        # defence and of a midfield are played on the man's own foot (DL 96% left-footed, MR 98% right),
        # a wing is played INVERTED (LW 86% right-footed), and between two centre backs the left-footed
        # one is on the left 93% of the time - so a plate that says where he is drawn should say it too.
        foot = (starter.get("desc_foot") or "").strip().lower()
        head = f"{starter.get('name')}  {', '.join(self.real_roles(starter)) or '?'}"
        lines = [head + (f"  ·  {foot} foot" if foot else "")
                 + (f"  ·  {self.build(starter)}" if self.build(starter) else "")
                 + (f"  ·  {share:.0%} when available" if share else "")]
        if self.preseason(starter):
            lines.append(self.preseason(starter))
        if horizon != "recent":
            # BOTH numbers, because they answer two questions and the plate can only carry one: the shirt
            # is his when everyone is fit (above), and this is how much of the season he is expected to be
            # there for. A man at 100% with an availability of 0.53 is a first choice you get half of.
            available = self.availability(starter)
            lines.append(f"expected to be there {available:.0%} of the season -> "
                         f"{self.presence(starter, 'season'):.0%} of the matchdays"
                         + ("" if available > 0.95 else
                            f" (the injury history costs him {1 - available:.0%}; it discounts the "
                            f"auction's Pv and SURPLUS, and NOT who the coach fields)"))
        club = self._selected_club()
        if club and starter.get("name") in self.top_players(club, self.xi_mode.get()):
            always, matches = self.full_match_share(starter)
            lines.append(f"TOP PLAYER (light disc): {self.TOP_MINUTES_FULL:.0f}+ minutes in "
                         f"{always:.0%} of his last {matches} LEAGUE matches, in the top "
                         f"{1 - self.TOP_SURPLUS_PERCENTILE:.0%} of the sheet by surplus, and with no "
                         "real challenger for the shirt")
        ranked = sorted(rivals, key=lambda row: -self.claim(row, horizon))
        if ranked:
            lines.append("")
            lines.append(f"who else wears this shirt ({len(ranked)}):")
            for rival in ranked:
                rival_share = self.claim(rival, horizon)
                lines.append(f"   {rival.get('name')}"
                             + (f"  {rival_share:.0%}" if rival_share else "  -")
                             + f"  {', '.join(self.real_roles(rival)) or '?'}"
                             + (f"  {self.build(rival)}" if self.build(rival) else ""))
        else:
            lines.append("nobody else in the squad plays his position")
        stated = [name.strip() for name in (starter.get("desc_duel_names") or "").split(";")
                  if name.strip()]
        if stated:
            lines.append("")
            lines.append("probabili declare a ballottaggio with " + ", ".join(stated))
        lines.append("")
        lines.append("click for the whole duel, and why a declared name may not be here")
        return "\n".join(lines)

    def _duel_popup(self, starter: dict, rivals: list[dict]) -> None:
        """Who else can wear this shirt: every rival, with his share of the matchdays and his real roles.

        The pitch can only ever draw a few characters of this, and a ballottaggio is precisely the thing
        an auction cannot read from a truncated name. Two facts are shown side by side and NOT merged:
        the editors' own named ballottaggio (`desc_duel_names`, a stated fact about the coming match) and
        the men who can positionally take the place (`can_replace`, our inference from the real roles).
        Where the first is empty the second still answers; where they disagree, both are on screen.
        """
        horizon = "recent" if self.xi_mode.get() == "next" else "season"
        dialog = tk.Toplevel(self)
        dialog.title(f"{starter.get('name')} · who else wears this shirt")
        dialog.transient(self.winfo_toplevel())
        dialog.resizable(False, False)
        frame = ttk.Frame(dialog, padding=12)
        frame.pack(fill="both", expand=True)
        share = self.claim(starter, horizon)
        ttk.Label(frame, style="H2.TLabel",
                  text=f"{starter.get('name')}  "
                       f"{(', '.join(self.real_roles(starter)) or starter.get('role_classic') or '?')}"
                       + (f"  ·  {share:.0%}" if share else "")).pack(anchor="w")
        stated = [name.strip() for name in (starter.get("desc_duel_names") or "").split(";")
                  if name.strip()]
        count = _number(starter.get("desc_duel_rivals"))
        ttk.Label(frame, style="Muted.TLabel", justify="left", wraplength=460,
                  text=("the probabili declare a ballottaggio with " + ", ".join(stated)
                        if stated else
                        "the probabili declare no ballottaggio for him"
                        + (" (and no starting probability is recorded, so they cannot)"
                           if not starter.get("desc_starter_prob") else ""))
                       + (f" · {count:.0f} rival(s) counted" if count else "")
                  ).pack(anchor="w", pady=(2, 8))

        columns = ("name", "share", "roles", "declared")
        titles = ("who", "matchdays", "real roles", "declared duel")
        tree = ttk.Treeview(frame, columns=columns, show="headings", height=max(3, len(rivals) + 1),
                            selectmode="none")
        for key, title, width in zip(columns, titles, (150, 74, 130, 96), strict=True):
            tree.heading(key, text=title)
            tree.column(key, width=width, anchor="w" if key in ("name", "roles") else "center")
        tree.pack(fill="both", expand=True)
        def line(row: dict, declared: str) -> tuple:
            row_share = self.claim(row, horizon)
            return (row.get("name"), f"{row_share:.0%}" if row_share else "-",
                    ", ".join(self.real_roles(row)) or (row.get("role_classic") or "?"), declared)

        for rival in rivals:
            tree.insert("", "end",
                        values=line(rival, "yes" if (rival.get("name") or "") in stated else "-"))
        # A named ballottaggio the pitch does NOT offer, with the reason - otherwise the sentence above
        # ("declared with three men") and a table of two rows read as a contradiction. The commonest
        # reason is the one that is right: a rival is by definition not in the eleven, and De Roon's
        # third man is starting a shirt of his own.
        in_eleven = {row.get("name") for _x, _y, row, _rivals in getattr(self, "_hits", [])}
        offered = {row.get("name") for row in rivals} | {starter.get("name")}
        squad = {row.get("name"): row for row in self.squad(starter.get("club") or "")}
        for name in stated:
            if name in offered:
                continue
            row = squad.get(name) or {"name": name}
            # In order of how much it explains, and every step is CHECKABLE rather than assumed: he is
            # starting (a rival is by definition not in the eleven), his real roles do not overlap at
            # all, or he is drawn in another line - the eleven is built lane by lane, so the
            # alternatives for a shirt come from that lane's own bench.
            why = ("in the XI" if name in in_eleven else
                   "other position" if not self.can_replace(starter, row) else
                   f"drawn in {self.lane_of(row)}" if self.lane_of(row) != self.lane_of(starter) else
                   "not offered here")
            tree.insert("", "end", values=line(row, f"yes · {why}"))
        if not tree.get_children():
            tree.insert("", "end", values=("nobody in the squad shares his position", "", "", ""))
        ttk.Label(frame, style="Muted.TLabel", justify="left", wraplength=460,
                  text="A duel is POSITIONAL: it is decided on the granular real roles, where one shared "
                       "code is enough - the listone role is not used, because it calls a winger and a "
                       "regista the same thing. A man with no observed role is therefore in NO duel: that "
                       "is a gap in what was observed, not a statement that he has nobody behind him. "
                       "'matchdays' is the share of the season he gets a voto in, on the same horizon the "
                       "XI selector is set to."
                  ).pack(anchor="w", pady=(8, 0))

    # How many rivals a plate names. Two, and it is a VERTICAL budget, not a taste: a plate sits between
    # two drawn lines ~90px apart, a line of text is ~14px, and a crowded lane staggers its plates above
    # and below the markers - so four lines of plate on two neighbouring shirts is where they collide.
    # Whoever is left over is named in the shirt's tooltip and counted on the plate.
    PLATE_RIVALS: ClassVar[int] = 2

    # The geometry a plate is built from, in pixels: one text line, the padding inside the plate, and
    # what sits between a marker's centre and the top of its plate (the radius plus the gap). Named
    # because the number of rivals a shirt can name is DERIVED from them and the room between two drawn
    # lines - a constant would be right for a four-line shape and one pixel short of a collision for a
    # five-line one, which is what measuring found (Roma, next XI: 1px).
    PLATE_LINE_PX: ClassVar[int] = 13
    PLATE_PAD_PX: ClassVar[int] = 3
    PLATE_OFFSET_PX: ClassVar[int] = 15
    PLATE_CLEARANCE_PX: ClassVar[int] = 6
    # The two caption lines at the bottom own the last band of the canvas, and the eleven is laid out in
    # what is left. Without it the forward's plate was clamped to the bottom edge and drawn straight over
    # the caption - both unreadable, and more of the plate the taller the pitch got.
    CAPTION_BAND_PX: ClassVar[int] = 34

    @classmethod
    def plate_rivals_for(cls, lane_gap: float) -> int:
        """How many rivals a plate may name, given the px between this drawn line and its neighbour.

        Half the gap, because the neighbouring line's plate may be staggered TOWARDS this one, and both
        must fit in it. Never fewer than one - a shirt with a challenger has to say so - and never more
        than `PLATE_RIVALS`. Measured consequence: a four-line shape names two rivals, a five-line one
        (a trequartisti lane exists) names one and counts the rest.
        """
        # Derived, not tuned: a plate reaches OFFSET + PAD + n*LINE px from its marker's centre, two of
        # them may face each other across the gap, so n*LINE <= half the gap minus the fixed parts. A
        # formula fitted to "no overlap in today's data" would be a formula about today's data.
        half = (lane_gap - cls.PLATE_CLEARANCE_PX) / 2
        lines = int((half - cls.PLATE_OFFSET_PX - cls.PLATE_PAD_PX) // cls.PLATE_LINE_PX)
        return max(1, min(cls.PLATE_RIVALS, lines - 1))

    def plate_lines(self, starter: dict, rivals: list[dict], name_budget: int,
                    rival_budget: int, max_rivals: int | None = None) -> list[str]:
        """The text of a shirt's plate: the man and his share, then ONE RIVAL PER LINE, likeliest first.

        Stacked rather than packed onto one line, because a duel is read as a RANKING - "who takes the
        shirt if he does not" - and a ranking needs each man's own percentage next to him, which two
        names sharing a line cannot carry. Sorted by the same number the shirt shows, so the order on
        the plate is the order of the answer.

        At most `PLATE_RIVALS`; the rest are announced as `+N` on the last line and named in the tooltip.
        A shirt contested by three men is a different risk from one contested by one, so the count is
        never dropped - but the pitch has ~90px between two lines and cannot draw them all.
        """
        horizon = "recent" if self.xi_mode.get() == "next" else "season"
        cap = self.PLATE_RIVALS if max_rivals is None else max(1, max_rivals)
        share = self.claim(starter, horizon)
        share_text = f" {share:.0%}" if share else ""
        name = starter.get("name") or ""
        # his own line, by the same rule as the rivals': the share stays, the name is cut to what is
        # left, and only a plate too narrow for four characters and a percentage loses the percentage
        out = [name[:max(1, name_budget)]]
        for tail in (share_text, ""):
            if name_budget - len(tail) >= 4:
                out = [name[:name_budget - len(tail)] + tail]
                break
        ranked = sorted((row for row in rivals if row.get("name")),
                        key=lambda row: -self.claim(row, horizon))
        for index, rival in enumerate(ranked[:cap]):
            rival_share = self.claim(rival, horizon)
            share_tail = f" {rival_share:.0%}" if rival_share else ""
            extra = len(ranked) - cap
            # the count rides on the LAST line drawn, where it reads as "and this many more"
            count_tail = f" +{extra}" if extra > 0 and index == cap - 1 else ""
            lead = "vs " if index == 0 else "   "
            budget = max(4, rival_budget - len(lead))
            name = rival.get("name") or ""
            # What gives way, in order: the count of the others, then his percentage, and the name is cut
            # to whatever is left with a floor of four characters. The percentage outranks the rest of
            # the name because it is what makes the stack a RANKING - a cut surname next to 20% still
            # answers "who takes the shirt", a whole surname with no number does not. Nothing is ever
            # floored past the budget, which is how a line ends up on the neighbouring shirt; and the
            # tooltip carries all three parts whatever the width.
            for tail in (share_tail + count_tail, share_tail, ""):
                if budget - len(tail) >= 4:
                    out.append(f"{lead}{name[:budget - len(tail)]}{tail}")
                    break
            else:
                out.append(f"{lead}{name[:budget]}")
        return out

    def _shirt(self, x: float, y: float, starter: dict, rivals: list[dict],
               drawn_side: float | None = None, room: float = 100.0, code: str = "",
               above: bool = False, max_rivals: int | None = None, highlight: bool = False) -> None:
        """One shirt: the role marker, and the name under it - or ABOVE it, when the line is crowded.

        `highlight` INVERTS the marker - a light disc with the role in the dark colour - for the men whose
        every number is good at once (`top_players`). Inverting rather than adding a mark keeps the
        marker's own vocabulary intact: it still says the role, and the role still says the flank. Named
        `highlight` and not `top`, because `top` is already this method's plate coordinate.

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
        # MEASURED per face, not one constant for both: 6 px was optimistic and the names ran past their
        # plates, 7.2 was the bold face's own width and cut the small line by a fifth. `char_width` asks
        # the font, so each line gets the room it actually needs on this theme and this display.
        fits = max(5, int((room - 8) / self.char_width("strong")))
        # The name and his own share on the first line, then ONE RIVAL PER LINE, the likeliest first: a
        # duel is read as a ranking ("who takes the shirt if he does not"), and two names sharing a line
        # cannot carry the percentage that makes it a ranking. At most two, because the plate is bounded
        # by the 90px between two drawn lines - whatever is left over is named in the tooltip, and the
        # count says how many there are so a third man is never invisible.
        small = max(6, int((room - 8) / self.char_width("small")))
        lines = [(text, theme.FONTS["strong" if index == 0 else "small"],
                  "#ffffff" if index == 0 else "#ffe082")
                 for index, text in enumerate(
                     self.plate_lines(starter, rivals, fits, small, max_rivals))]

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
                # a top player wears the same colours the other way round, and a dark ring so a light
                # disc still has an edge against the grass
                disc, letters = (ink, fill) if highlight else (fill, ink)
                canvas.create_oval(left, y - size / 2, left + size, y + size / 2, fill=disc,
                                   outline="#12351a" if highlight else "#ffffff", width=2)
                canvas.create_text(left + size / 2, y, fill=letters, font=theme.FONTS["pill"],
                                   text=label)
                left += size + 3
        else:
            code = code or self.badge(starter, drawn_side)
            disc, letters, ring = (("#f4f6f5", "#12351a", "#12351a") if highlight
                                   else ("#12351a", "#ffffff", "#f4f6f5"))
            canvas.create_oval(x - radius, y - radius, x + radius, y + radius,
                               fill=disc, outline=ring, width=2)
            canvas.create_text(x, y, fill=letters, font=theme.FONTS["pill"], text=code)

        # The plate is as wide as its WIDEST line really is, each measured on its own face: sizing every
        # line with the bold width over-reserved for the small ones, which is harmless, and under-reserved
        # for a long bold name, which is not.
        plate = min(room, 8 + max(len(part) * self.char_width("strong" if index == 0 else "small")
                                  for index, (part, _font, _fill) in enumerate(lines)))
        # a shirt near the touchline slides inwards rather than hanging over it
        x = min(max(x, 4 + plate / 2), edge - 4 - plate / 2)
        high = self.PLATE_PAD_PX + len(lines) * self.PLATE_LINE_PX
        top = y - radius - 3 - high if above else y + radius + 3
        # ...and never past the top or bottom edge, the same way it never hangs over a touchline: the
        # attack's plate grew by a line and ended 1px outside the canvas, which is a clamp missing rather
        # than a lane fraction to re-tune - the fraction would have to be re-tuned for every plate height.
        # ...and the floor is the PLAYING area, not the canvas: the caption band below it is not grass a
        # plate may stand on.
        floor_y = (canvas.winfo_height() if canvas.winfo_height() > 1
                   else (canvas.winfo_reqheight() or 470)) - self.CAPTION_BAND_PX
        top = max(2.0, min(top, floor_y - high - 2))
        canvas.create_rectangle(x - plate / 2, top, x + plate / 2, top + high,
                                fill="#12351a", outline="#4c7a35", width=1)
        for index, (part, font, fill) in enumerate(lines):
            canvas.create_text(x, top + 9 + index * self.PLATE_LINE_PX, fill=fill, font=font, text=part)

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
        self._hits: list[tuple[float, float, dict, list[dict]]] = []
        # The REAL size - drawing to an inflated height put the forwards' plates off the bottom edge.
        # Before the widget is mapped `winfo_width` is 1, so the REQUESTED size answers instead: that is
        # what the canvas was configured with, and it keeps the drawing consistent with the space it
        # will get rather than with a constant.
        width = canvas.winfo_width() if canvas.winfo_width() > 1 else (canvas.winfo_reqwidth() or 430)
        height = (canvas.winfo_height() if canvas.winfo_height() > 1
                  else (canvas.winfo_reqheight() or 470))
        # The grass is the whole canvas; the ELEVEN is laid out in `field`, above the caption band. Two
        # different things, and the men are the ones that must not stand on the writing.
        field = max(140, height - self.CAPTION_BAND_PX)
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
        formation, _source = self.board_shape(club, info, mode)
        eleven = self.eleven(club, formation, mode)
        if not eleven:
            canvas.create_text(width // 2, height // 2, fill=line, font=theme.FONTS["strong"],
                               text="no players in this club's sheet")
            return
        lanes, geometry, drawn = self.lanes_for(eleven)
        highlighted = set(self.top_players(club, mode))
        # How much room each drawn line has to its nearest neighbour, in pixels: it is what decides how
        # many rivals a plate may NAME (`plate_rivals_for`). A shape with a trequartisti line packs five
        # rows into the same canvas and its plates have to be shorter - measured, not assumed.
        rows = [fraction * field for _role, fraction in geometry]
        lane_gaps = {role: min((abs(rows[here] - rows[other]) for other in range(len(rows))
                                if other != here), default=field)
                     for here, (role, _fraction) in enumerate(geometry)}
        # top to bottom: keeper, defence, midfield, attack. The keeper sits high enough for his plate,
        # the attack low enough for theirs: a lane at 0.92 would draw the names off the pitch.
        for role, fraction in geometry:
            slots = self._lane(lanes.get(role, []), role)
            if not slots:
                continue
            placed = self._placed(slots, role)
            codes = self._line_codes(placed, role)
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
                y = field * fraction
                # the TEAM-relative side of where he is drawn, on the same -1..+1 scale `lateral` uses:
                # it names the flank for a role that does not (a winger placed there reads 'Es' or 'Ed').
                # Negated, because the screen is mirrored with respect to the team facing downwards.
                self._shirt(x, y, starter, rivals, drawn_side=-(spread - 0.5) * 2, room=room,
                            code=codes[index], above=crowded and index % 2 == 1,
                            max_rivals=self.plate_rivals_for(lane_gaps[role]),
                            highlight=starter.get("name") in highlighted)
                # Where each shirt ended up, so a click can find it. A plate can only ever hold a few
                # characters of a duel; the whole of it is one click away (`_duel_popup`).
                self._hits.append((x, y, starter, rivals))
        editorial = mode == "next" and any(row.get("desc_starter_prob")
                                           for _role, row, _rivals in eleven)
        if mode == "next":
            criterion = "probabili" if editorial else "recent starts (no probabili)"
        else:
            # The percentage on a plate is `claim`, so the caption has to name THAT: the tipo eleven is
            # the side with everyone fit, and "% of the matchdays" was the other number - the one with the
            # injury discount in it, which is what put a rotation midfielder over De Bruyne.
            criterion = "% started when available"
        # Two short lines: one caption wide enough to say all of it ran off both touchlines. The
        # viewpoint stays in the column's tooltip, where there is room for the sentence.
        # An eleven drawn without somebody has to SAY it on the drawing: the count is the difference
        # between "this is the side" and "this is the side without the two men I unticked".
        left_out = sum(1 for row in self.squad(club) if self.is_excluded(row))
        criterion += f" · without {left_out} unticked" if left_out else ""
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
        # ...plus, when there are any, what an inverted marker means. Only when there are: a legend for
        # something not on the pitch is noise, and 13 of the 34 euro clubs have no such player at all.
        viewpoint = "attacking downwards: the team's LEFT is on your right"
        canvas.create_text(width // 2, height - 12, fill=line, font=theme.FONTS["small"],
                           text=(f"{viewpoint} · light disc = top player"
                                 if highlighted else viewpoint))


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


def _rounds_by_season(value: str | None) -> tuple[float | None, ...]:
    """`"7;;6"` -> (7.0, None, 6.0): league rounds missed per season, most recent first.

    An empty entry is a season we had no calendar to count on - unknown, and it keeps its POSITION so the
    recency weights still line up with the right seasons.
    """
    if not value:
        return ()
    return tuple(_number(part, None) for part in value.split(";"))


class ToolkitGUI:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.config = Config()
        self.log_queue: queue.Queue = queue.Queue()
        self.busy = False
        self._running: str | None = None
        self._cancel_event = threading.Event()

        root.title(f"euroleghe-ingest · operator panel v{__version__}")
        root.minsize(900, 660)   # the operation cards + the status bar need this much height
        # MAXIMISED by default, and the operator's own choice remembered after that. The Snapshot board
        # draws a pitch and a 13-column squad table side by side, so every pixel of the window is spent on
        # something: at 1180x780 the table's last five columns were off the right edge and the pitch was
        # half the height it can be. Maximised rather than a computed size because the work area is the
        # window manager's own number - the taskbar's height and the title bar's are not ours to guess,
        # and measuring showed a "screen minus a safe margin" formula leaving 49px unused.
        self._restore_geometry()
        root.protocol("WM_DELETE_WINDOW", self._on_close)
        self._theme_mode = self._load_prefs().get("theme", "light")
        theme.apply_theme(root, self._theme_mode)
        try:
            self._app_icon = make_app_icon()           # keep a reference (Tk needs it alive)
            root.iconphoto(True, self._app_icon)
        except tk.TclError:
            pass  # the icon is cosmetic; never block startup over it

        # The status bar is packed FIRST, before the shell that expands. The packer hands out the cavity in
        # packing order, so an expanding widget packed before it leaves nothing behind: the bar was being
        # created, filled and updated at 1x1 pixels - present in the code and invisible on screen since it
        # was written. It costs 27px of every tab, which is why it is as thin as its text allows.
        self._build_status_bar(root)
        shell = ttk.Frame(root, padding=(12, 6, 12, 0))
        shell.pack(fill="both", expand=True)
        self._build_header(shell)

        notebook = self.notebook = ttk.Notebook(shell)
        notebook.pack(fill="both", expand=True, pady=(6, 0))

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

        self.refresh_status()
        self.refresh_operation_states()
        self.players.reload()
        self.auction.reload()
        self.snapshot.reload()
        self.root.after(100, self._drain_log)

    # ---------- preferences (theme and window, so a restart looks like the last session) ----------
    def _restore_geometry(self) -> None:
        """Maximised, or wherever the operator last left the window.

        A size saved on one screen can be off another one entirely (a laptop after a docking station), so
        it is only honoured while it still fits: otherwise the window manager's maximised state answers,
        which is right on every screen by construction.
        """
        saved = self._load_prefs().get("window")
        if isinstance(saved, str) and "x" in saved:
            width, _, rest = saved.partition("x")
            height = rest.split("+")[0].split("-")[0]
            with contextlib.suppress(ValueError, tk.TclError):
                if (int(width) <= self.root.winfo_screenwidth()
                        and int(height) <= self.root.winfo_screenheight()):
                    self.root.geometry(saved)
                    return
        with contextlib.suppress(tk.TclError):
            self.root.state("zoomed")

    def _on_close(self) -> None:
        """Remember the window before closing: 'zoomed', or its own geometry if it was restored down."""
        with contextlib.suppress(tk.TclError):
            state = self.root.state()
            self._save_prefs(window="zoomed" if state == "zoomed" else self.root.geometry())
        self.root.destroy()

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
        """ONE row: the app's name, its version and which DB is open, then the global actions.

        Stacked on two rows it was 75px of every tab - and on the Snapshot board those 75px come off the
        pitch, which is the thing an auction is actually read on. The name and the DB line are read once
        when the panel opens; nothing about them needs a row of its own.
        """
        bar = ttk.Frame(parent, style="Card.TFrame", padding=(14, 5))
        bar.pack(fill="x")
        left = ttk.Frame(bar, style="Card.TFrame")
        left.pack(side="left", fill="x", expand=True)
        ttk.Label(left, text="⚽", style="Icon.TLabel").pack(side="left", padx=(0, 8))
        ttk.Label(left, text="euroleghe-ingest", style="H1.TLabel").pack(side="left")
        ttk.Label(left, text=f"v{__version__}", style="CardMuted.TLabel").pack(side="left",
                                                                              padx=(8, 12))
        self.db_var = tk.StringVar()
        # Clipped rather than wrapped: a long path must never turn the header into two rows again, and
        # the whole of it is one hover away.
        db_label = ttk.Label(left, textvariable=self.db_var, style="CardMuted.TLabel", anchor="w")
        db_label.pack(side="left", fill="x", expand=True)
        Tooltip(db_label, lambda: self.db_var.get(), wraplength=420)

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
        """What is running, and when the last run was. One text line tall, and no taller.

        Vertical padding 3: this strip is subtracted from every view above it, and the Snapshot board
        spends its height on a pitch. The progressbar sets the row's height on its own (~19px), so
        anything more than 3 is padding around a bar that is already tall enough.
        """
        bar = ttk.Frame(parent, style="Card.TFrame", padding=(14, 3))
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

    def _refresh_all(self, *, built_snapshot: bool = False) -> None:
        self.refresh_status()
        self.refresh_operation_states()
        self.players.reload()
        with contextlib.suppress(Exception):
            self.snapshot.reload(select_newest=built_snapshot)

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

    # What the League selector offers when you want the two dimensions read straight, rather than taken
    # from a league you play in. Named here because both the dialog and its confirm() test for it.
    NO_LEAGUE = "(none - platform/game below)"

    def _snapshot_dialog(self) -> dict | None:
        """Which league (or which raw platform/game), which day, and whether to refresh first.

        Naming a LEAGUE answers three questions at once - the platform, the game and the squad size that
        fixes the replacement level - which is why it comes first and why choosing one DISABLES the two
        selectors below: a league states them, and a dialog that still showed them editable would be
        offering a choice the run then ignores. Without a league the two are read straight, which is what
        the gate does when it sweeps all four combinations.
        """
        from euroleghe_ingest.config import GAMES, PLATFORMS, SEASONS

        leagues = self.config.my_leagues()
        dlg = tk.Toplevel(self.root)
        dlg.title("Auction snapshot")
        dlg.transient(self.root)
        dlg.grab_set()
        dlg.resizable(False, False)
        frm = ttk.Frame(dlg, padding=12)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="League:").grid(row=0, column=0, sticky="w", pady=4)
        league = tk.StringVar(value=next(iter(leagues), self.NO_LEAGUE))
        ttk.Combobox(frm, textvariable=league, state="readonly", width=22,
                     values=[*leagues, self.NO_LEAGUE]).grid(row=0, column=1, pady=4)
        ttk.Label(frm, text="Platform:").grid(row=1, column=0, sticky="w", pady=4)
        platform = tk.StringVar(value="euro")
        platform_cb = ttk.Combobox(frm, textvariable=platform, state="readonly", width=22,
                                   values=list(PLATFORMS))
        platform_cb.grid(row=1, column=1, pady=4)
        ttk.Label(frm, text="Game:").grid(row=2, column=0, sticky="w", pady=4)
        game = tk.StringVar(value="classic")
        game_cb = ttk.Combobox(frm, textvariable=game, state="readonly", width=22,
                               values=list(GAMES))
        game_cb.grid(row=2, column=1, pady=4)

        def on_league(*_args) -> None:
            """Show what wins: a named league fills the two selectors and locks them."""
            setup = leagues.get(league.get())
            if setup:
                platform.set(setup["platform"])
                game.set(setup["game"])
            state = "disabled" if setup else "readonly"
            platform_cb.configure(state=state)
            game_cb.configure(state=state)

        league.trace_add("write", on_league)
        on_league()
        ttk.Label(frm, text="Season:").grid(row=3, column=0, sticky="w", pady=4)
        season = tk.StringVar(value="latest")
        ttk.Combobox(frm, textvariable=season, state="readonly", width=22,
                     values=["latest", *SEASONS]).grid(row=3, column=1, pady=4)
        # A DAY and a CLUB, both optional: this is what turns the sheet into "what did this squad look
        # like on 1 March", which is the only way to look at a decision that has already been taken.
        ttk.Label(frm, text="As of date:").grid(row=4, column=0, sticky="w", pady=4)
        as_of = tk.StringVar(value="")
        ttk.Entry(frm, textvariable=as_of, width=24).grid(row=4, column=1, pady=4)
        ttk.Label(frm, text="Only club:").grid(row=5, column=0, sticky="w", pady=4)
        only = tk.StringVar(value="")
        clubs = sorted({name for (name,) in connect(self.config.db_path).execute(
            "SELECT canonical_name FROM clubs WHERE canonical_name IS NOT NULL")}) \
            if self.config.db_path.exists() else []
        ttk.Combobox(frm, textvariable=only, width=22,
                     values=["", *clubs]).grid(row=5, column=1, pady=4)
        refresh = tk.BooleanVar(value=True)
        ttk.Checkbutton(frm, text="Refresh today's probabili / indisponibili first (3 requests)",
                        variable=refresh).grid(row=6, column=0, columnspan=2, sticky="w", pady=4)

        ttk.Label(frm, foreground=theme.color("text_muted"), wraplength=360, justify="left",
                  text="Writes players.csv + clubs.csv + manifest.json under data/reports/. The "
                       "`engine_*` columns are the gated valuation; every `desc_*` column is "
                       "descriptive and must not become a coefficient without a pre-registered gate "
                       "run. Whatever no source states is reported as not measurable.\n\n"
                       "AS OF a past date: the ten matches are the ten before it, the squads and the "
                       "availability are the ones known then, and titolarita and the bonus rates are "
                       "measured on that season UP TO that day. The probabili are not refetched - "
                       "today's are not that day's - so the weekly XI falls back to who was playing."
                  ).grid(row=7, column=0, columnspan=2, sticky="w", pady=(6, 0))

        out: dict = {}

        def confirm():
            # A named league is passed BY NAME and the run reads its platform and game from the config
            # file: sending the two values the dialog displays instead would freeze today's copy of a
            # league that is edited elsewhere.
            named = league.get() if league.get() in leagues else None
            out["league"] = named
            if not named:
                out["platform"] = platform.get()
                out["game"] = game.get()
            out["season"] = None if season.get() == "latest" else season.get()
            out["refresh"] = refresh.get()
            out["date"] = as_of.get().strip() or None
            out["clubs"] = [only.get()] if only.get().strip() else None
            dlg.destroy()

        btns = ttk.Frame(frm)
        btns.grid(row=8, column=0, columnspan=2, pady=(10, 0))
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
            return ("matchdays", "synth", "arrivals")
        if command == "ratings":
            # a new listone is a new PERIMETER: who counts as an arrival changes with it
            return ("matchdays", "arrivals")
        if command == "recent_form":
            # ...and the matches it recovers are worth nothing until they are CONVERTED and read: without
            # this the scrape lands rows nobody looks at, which is how Alajbegovic kept an empty valuation
            # after his ten Bundesliga matches were already in the table.
            return ("synth", "arrivals")
        return ()

    def _build_snapshot(self, params: dict | None = None) -> None:
        """The Snapshot tab's button: the same run as the Operations tab, with the progress in view.

        `params` is what the tab's own bar already states (which league, refreshed first) and the run
        starts immediately; `None` means the operator asked for the rare options, so the dialog opens.

        It goes through `run_operation` rather than starting a thread of its own - one worker, one audit
        line - and the bar only starts if the run really started: a cancelled dialog would otherwise
        leave it spinning forever.
        """
        self.run_operation("snapshot", params=params)
        if self.busy:
            self.snapshot.building(True, "starting")

    def run_operation(self, command: str, params: dict | None = None) -> None:
        """Run one operation in the worker thread. `params` given = the caller already knows them."""
        if self.busy:
            return
        if params is None and command in self.DIALOGS:
            params = getattr(self, self.DIALOGS[command])()
            if params is None:
                return   # user cancelled the dialog
        params = params or {}
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
                    built_snapshot = self._running == "snapshot"
                    self._set_busy(False)
                    self._refresh_all(built_snapshot=built_snapshot)
                    self.snapshot.building(False)
                    self.snapshot.recovering(False)
                else:
                    self._append(item)
                    line = item.strip().splitlines()[-1] if item.strip() else ""
                    if self._running == "snapshot" and line:
                        self.snapshot.building(True, line)
                    # A RECOVERY run belongs on the sheet's own bar too: the men it is fetching are the
                    # ones the table marks as waiting, so the operator watches the gap close where he saw
                    # it open. Same widget, same percentage, same parser.
                    elif self._running in self.RECOVERS_DATA and line:
                        self.snapshot.recovering(True, line, self._running)
                    if line:
                        self._show_percent(line)
        except queue.Empty:
            pass
        self.root.after(100, self._drain_log)

    def _append(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text, self._line_tag(text) or ())
        self.log.see("end")
        self.log.configure(state="disabled")

    # The operations that go and MEASURE what a player is missing - the ones the sheet's "waiting for
    # data" mark is about. Named here because two views need the same list: the status bar drives its bar
    # from them, and the Snapshot table says «in recupero» while one of them runs.
    RECOVERS_DATA: ClassVar[frozenset[str]] = frozenset({
        "recent_form", "positions", "injuries", "fbref", "transfers", "stats"})

    def _show_percent(self, line: str) -> None:
        """Drive the status bar off any module's `NN% ·` line: determinate, with the number in words.

        Indeterminate until a module says a number, because a bar that fills at a guessed rate is a lie
        told smoothly - and never backwards for the same run, for the reason `building` states.
        """
        match = SnapshotView.PERCENT_LINE.match(line)
        if not match:
            return
        percent, label = int(match.group(1)), (match.group(2) or "").strip()
        if self._percent is None:
            self.progress.stop()
            self.progress.configure(mode="determinate", maximum=100)
        self._percent = max(self._percent or 0, percent)
        self.progress.configure(value=self._percent)
        running = f" {self._running}" if self._running else ""
        self.activity_var.set(f"⟳  running{running} · {self._percent}%"
                              + (f" · {label[:40]}" if label else ""))

    def _set_busy(self, busy: bool, command: str | None = None) -> None:
        self.busy = busy
        self._running = command if busy else None
        self._percent = None
        if busy:
            for btn in self.buttons:
                btn.configure(state="disabled")
            self.stop_button.configure(state="normal")
            self.activity_var.set(f"⟳  running {command}" if command else "⟳  running")
            self.progress.configure(mode="indeterminate")
            self.progress.start(12)
        else:
            self.progress.stop()
            self.progress.configure(mode="determinate", value=0)
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
