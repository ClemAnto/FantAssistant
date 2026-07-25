"""Lightweight UI (Tkinter, stdlib) - the toolkit's operator panel.

Two tabs:
  * Operations - launch pipeline operations (initdb, rebuild, fetch, single modules) with a live
    log, DB status, and a per-button state indicator (completed / to do / unavailable).
  * Players    - browse the players of a selected team, with cascading season/league/team selectors
    and a canvas table (role pills, sortable columns) or a per-matchday fantavoti grid (colored by status).

Operations run in a separate thread so the window doesn't freeze; module output is redirected into
the log panel. No external dependencies: Tkinter ships with Python.

Launch: `python -m euroleghe_ingest gui`  (or with no arguments).
"""

from __future__ import annotations

import queue
import re
import sqlite3
import sys
import threading
import tkinter as tk
from tkinter import scrolledtext, ttk

from euroleghe_ingest import __version__
from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import connect, init_db
from euroleghe_ingest.modules import IMPLEMENTED, PIPELINE, load
from euroleghe_ingest.sources import available_sources


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

# Operations exposed in the panel: (label, command-key).
OPERATIONS: tuple[tuple[str, str], ...] = (
    ("Initialize DB", "initdb"),
    ("Rebuild all", "rebuild"),
    ("Plan fetch (--plan)", "fetch:plan"),
    *[(f"Module: {name}", name) for name in PIPELINE],
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
    "fc_site": "Read fantacalcio.it editorial lists (penalty takers, probable starters, unavailable "
               "players) into dated tables.",
    "transfers": "Read transfers, coach history and injuries from Transfermarkt; derive the exit_risk and "
                 "new_coach flags.",
    "fbref": "Import from FBref: foreign-league performance, career penalty conversion, set pieces, "
             "xG/xA and minutes.",
    "positions": "Derive each player's real role from SofaScore heatmaps (friendlies included) to flag "
                 "off-role usage.",
    "arrivals": "Detect new arrivals by diffing the roster lists and classify them by tier (T1/T2/T3) "
                "for pricing.",
    "tournaments": "Load international tournament squads from Wikidata (post-tournament effect, "
                   "mid-season cups).",
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
    output_table = {"rosters": "rosters", "stats": "season_stats", "ratings": "match_ratings",
                    "arrivals": "arrivals", "elo": "club_elo"}.get(command)
    if output_table and rows(output_table) > 0:
        return "completed"
    return "todo"


class Tooltip:
    """Minimal hover tooltip for a Tk widget (stdlib only). `text` may be a str or a callable."""

    def __init__(self, widget, text, delay: int = 450, wraplength: int = 320) -> None:
        self.widget = widget
        self.text = text
        self.delay = delay
        self.wraplength = wraplength
        self._after_id: str | None = None
        self._tip: tk.Toplevel | None = None
        widget.bind("<Enter>", self._schedule, add="+")
        widget.bind("<Leave>", self._hide, add="+")
        widget.bind("<ButtonPress>", self._hide, add="+")

    def _schedule(self, _event=None) -> None:
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
        x = self.widget.winfo_rootx() + self.widget.winfo_width() + 8
        y = self.widget.winfo_rooty()
        self._tip = tw = tk.Toplevel(self.widget)
        tw.wm_overrideredirect(True)
        tw.wm_geometry(f"+{x}+{y}")
        tk.Label(
            tw, text=text, justify="left", background="#ffffe0", foreground="#000000",
            relief="solid", borderwidth=1, wraplength=self.wraplength, padx=8, pady=6,
        ).pack()

    def _hide(self, _event=None) -> None:
        self._unschedule()
        if self._tip is not None:
            self._tip.destroy()
            self._tip = None


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
    # Mantra roles are multi-valued; sources separate them with ';', '|' or '/'.
    return [r.strip().lower() for r in re.split(r"[;/|]", str(value)) if r.strip()] if value else []


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
_DEFAULT_RATING_STYLE = ("#ffffff", "#111111")


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

_RATINGS_QUERY = """
    SELECT v.fc_id AS fc_id, v.matchday AS matchday, v.fantavoto AS fantavoto, v.status AS status
    FROM match_ratings v
    JOIN rosters r ON r.fc_id = v.fc_id AND r.season = v.season
    JOIN clubs c ON c.fc_club_id = r.fc_club_id
    WHERE v.season = ? AND c.league = ? AND c.canonical_name = ?
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
            self._rating_rows = self._query(_RATINGS_QUERY, (season, raw_league, team))
            self._rating_players = self._query(_TEAM_PLAYERS_QUERY, (season, raw_league, team))
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
        data: dict[tuple, tuple] = {}
        matchdays: set[int] = set()
        for r in self._rating_rows:
            data[(r["fc_id"], r["matchday"])] = (r["fantavoto"], r["status"])
            matchdays.add(r["matchday"])
        days = sorted(matchdays)

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
            hc.create_rectangle(cx, 0, cx + CELL_W, HEADER_H, fill="#e9e9e9", outline="#cfcfcf")
            hc.create_text(cx + CELL_W // 2, HEADER_H // 2, text=str(md), font=("Segoe UI", 8, "bold"))
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
                if cell is None:
                    bg, fg, txt = "#f4f4f4", "#bbbbbb", ""
                else:
                    fv, status = cell
                    bg, fg = rating_cell_style(status)
                    txt = rating_cell_text(fv, status)
                bc.create_rectangle(cx, y, cx + CELL_W, y + ROW_H, fill=bg, outline="#e6e6e6")
                if txt:
                    bc.create_text(cx + CELL_W // 2, y + ROW_H // 2, text=txt, fill=fg,
                                   font=("Segoe UI", 8))
        bc.configure(scrollregion=(0, 0, total_w, max(len(players) * ROW_H, 1)))
        suffix = "" if days else " (run ratings to fill)"
        self.info_var.set(f"{len(players)} players · {len(days)} matchdays{suffix}")
        bc.configure(scrollregion=(0, 0, total_w, max(len(players) * ROW_H, 1)))
        self.info_var.set(f"{len(players)} players · {len(days)} matchdays")

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


class ToolkitGUI:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.config = Config()
        self.log_queue: queue.Queue = queue.Queue()
        self.busy = False
        self._cancel_event = threading.Event()

        root.title(f"euroleghe-ingest - operator panel v{__version__}")
        root.geometry("1000x640")
        root.minsize(820, 520)

        notebook = ttk.Notebook(root)
        notebook.pack(fill="both", expand=True)

        ops_tab = ttk.Frame(notebook)
        notebook.add(ops_tab, text="Operations")
        self._build_operations_tab(ops_tab)

        self.players = PlayersView(notebook, self.config)
        notebook.add(self.players, text="Players")

        self.refresh_status()
        self.refresh_operation_states()
        self.players.reload()
        self.root.after(100, self._drain_log)

    # ---------- operations tab layout ----------
    def _build_operations_tab(self, parent: tk.Widget) -> None:
        main = ttk.Frame(parent, padding=10)
        main.pack(fill="both", expand=True)

        left = ttk.LabelFrame(main, text="Operations", padding=8)
        left.pack(side="left", fill="y")
        self.buttons: list[ttk.Button] = []
        self.dots: list[tk.Label] = []
        self.op_commands: list[str] = []
        for label, command in OPERATIONS:
            row = ttk.Frame(left)
            row.pack(fill="x", pady=2)
            dot = tk.Label(row, text="○", width=2, font=("Segoe UI", 11))
            dot.pack(side="left")
            btn = ttk.Button(row, text=label, width=27,
                             command=lambda c=command: self.run_operation(c))
            btn.pack(side="left", fill="x", expand=True)
            Tooltip(btn, lambda c=command: self._tooltip_for(c))
            self.buttons.append(btn)
            self.dots.append(dot)
            self.op_commands.append(command)

        ttk.Separator(left, orient="horizontal").pack(fill="x", pady=(8, 6))
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
            for (name,) in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall():
                (counts[name],) = conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()
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
        populated = [f"{name}={n}" for name, n in sorted(counts.items()) if n]
        rows = ", ".join(populated) if populated else "all empty"
        self.status_var.set(f"DB: {db}\nTables: {len(counts)} · rows: {rows}")

    def _refresh_all(self) -> None:
        self.refresh_status()
        self.refresh_operation_states()
        self.players.reload()

    # ---------- execution ----------
    def _request_stop(self) -> None:
        self._cancel_event.set()
        self._append("\n[stop requested - finishing the current step; saved data is kept]\n")

    def _ratings_dialog(self) -> dict | None:
        """Ask which competition + season to import. Returns run() kwargs, or None if cancelled."""
        dlg = tk.Toplevel(self.root)
        dlg.title("Scrape ratings")
        dlg.transient(self.root)
        dlg.grab_set()
        dlg.resizable(False, False)
        frm = ttk.Frame(dlg, padding=12)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="Competition:").grid(row=0, column=0, sticky="w", pady=4)
        comp = tk.StringVar(value="euroleghe")
        ttk.Combobox(frm, textvariable=comp, state="readonly", width=18,
                     values=["euroleghe", "serie_a"]).grid(row=0, column=1, pady=4)
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
            out["competition"] = comp.get()
            out["seasons"] = None if season.get() == "all" else [season.get()]
            out["refresh"] = refresh.get()
            dlg.destroy()

        btns = ttk.Frame(frm)
        btns.grid(row=3, column=0, columnspan=2, pady=(10, 0))
        ttk.Button(btns, text="Run", command=confirm).pack(side="left", padx=4)
        ttk.Button(btns, text="Cancel", command=dlg.destroy).pack(side="left", padx=4)
        dlg.wait_window()
        return out or None

    def run_operation(self, command: str) -> None:
        if self.busy:
            return
        params: dict = {}
        if command == "ratings":
            params = self._ratings_dialog()
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
