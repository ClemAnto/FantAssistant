"""ui_theme - one palette, one type scale, one set of icons for the operator panel.

Why a module and not inline colours. The panel had ~30 hex literals spread over the drawing code,
which is fine until the third tab needs the same grey and gets a slightly different one, and it makes
a dark mode impossible: half the surfaces would stay white. So the structural colours live here,
semantically named (`surface`, `surface_alt`, `border`, `text`, `text_muted`, `accent`...), and the
drawing code reads them AT DRAW TIME - which is what lets the theme switch without restarting.

What deliberately does NOT live here: the role pills and the per-status fantavoto cells. Those are
data encodings (a `dc` is green because a defender is green everywhere in this game), not chrome, and
they must look the same in both modes or the grid stops being readable.

Tkinter has no image assets in this project - the icons are single Unicode glyphs, chosen for coverage
in the fonts Windows actually ships (Segoe UI / Segoe UI Symbol). A glyph that renders as a box on the
operator's machine is worse than no icon, so nothing here needs an emoji font.
"""

from __future__ import annotations

import contextlib
from tkinter import font as tkfont
from tkinter import ttk

# ---------------------------------------------------------------- palettes
LIGHT: dict[str, str] = {
    "bg": "#f4f5f7",             # window background
    "surface": "#ffffff",        # cards, tables
    "surface_alt": "#f7f8fa",    # zebra stripe, table headers
    "surface_sunken": "#eceef1",  # log background, wells
    "border": "#d8dce1",
    "border_strong": "#b9bfc7",
    "text": "#1b1f24",
    "text_muted": "#5b6470",
    "text_faint": "#8b939e",
    "accent": "#1f6feb",         # primary action
    "accent_text": "#ffffff",
    "accent_soft": "#e6f0fe",
    "ok": "#1f8a4c",
    "warn": "#c76a00",
    "error": "#c62828",
    "idle": "#9aa3ad",
    "selection": "#dbeafe",
}

DARK: dict[str, str] = {
    "bg": "#14171c",
    "surface": "#1c2027",
    "surface_alt": "#22262e",
    "surface_sunken": "#0f1216",
    "border": "#2a303a",          # only enough to separate two surfaces, never a visible line
    "border_strong": "#3a424e",
    "text": "#e6e9ee",
    "text_muted": "#a7b0bc",
    "text_faint": "#7b8492",
    "accent": "#4c8dff",
    "accent_text": "#0f1216",
    "accent_soft": "#1d2b45",
    "ok": "#4cc38a",
    "warn": "#e0a458",
    "error": "#f2777a",
    "idle": "#6b7480",
    "selection": "#264063",
}

# The live palette. Mutated in place by `apply_theme`, so every module that did
# `from ... import PALETTE` keeps reading the current values instead of a stale copy.
PALETTE: dict[str, str] = dict(LIGHT)
MODE = "light"

FAMILY = "Segoe UI"
MONO = "Consolas"

# ---------------------------------------------------------------- icons
# One glyph per operation. Read as: what the step DOES, not which site it comes from.
OPERATION_ICONS: dict[str, str] = {
    "initdb": "▣",
    "rebuild": "↻",
    "bootstrap": "⏻",
    "fetch:plan": "☰",
    "export": "⇪",
    "snapshot": "◎",
    "rosters": "☰",
    "stats": "∑",
    "ratings": "★",
    "matchdays": "▤",
    "fc_site": "◔",
    "transfers": "⇄",
    "injuries": "✚",
    "fbref": "⊘",
    "positions": "⊕",
    "recent_form": "◷",
    "synth": "≈",
    "arrivals": "→",
    "tournaments": "♛",
    "elo": "▲",
    # NOT a tick: the state dot to its left already uses one, and two ticks on the same row read
    # as "done, done" instead of "the integrity check, to run".
    "validate": "≟",
}
DEFAULT_ICON = "•"

# Log line severity -> (tag name, colour key). Matched against what the modules actually print.
LOG_TAGS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("error", "error", ("XX ", "PROBLEM", "Traceback", "error -", "ERROR", "failed")),
    ("warn", "warn", ("WARNING", "!!", "not implemented", "skipping", "interrupted", "note:")),
    ("ok", "ok", ("OK ", "verify:", "done", "ok")),
    ("head", "accent", ("> ", "=== ")),
)


def icon(command: str) -> str:
    return OPERATION_ICONS.get(command, DEFAULT_ICON)


def color(key: str) -> str:
    """The live value of a palette entry. Call at draw time, never cache."""
    return PALETTE.get(key, PALETTE["text"])


# ---------------------------------------------------------------- ttk styling
def _fonts(scale: float = 1.0) -> dict[str, tuple]:
    base = round(10 * scale)
    return {
        "body": (FAMILY, base),
        "small": (FAMILY, base - 1),
        "strong": (FAMILY, base, "bold"),
        "h1": (FAMILY, base + 6, "bold"),
        "h2": (FAMILY, base + 2, "bold"),
        "icon": (FAMILY, base + 3),
        "mono": (MONO, base - 1),
        "pill": (FAMILY, base - 2, "bold"),
    }


FONTS: dict[str, tuple] = _fonts()


def apply_theme(root, mode: str = "light") -> ttk.Style:
    """Point every ttk widget class at the palette. Returns the Style, already configured.

    'clam' is the theme chosen on purpose: the native Windows theme ignores most colour options
    (it draws with the OS), so a dark mode built on it would end up half light. clam honours them.
    """
    global MODE
    MODE = "dark" if mode == "dark" else "light"
    PALETTE.clear()
    PALETTE.update(DARK if MODE == "dark" else LIGHT)
    FONTS.update(_fonts())

    style = ttk.Style(root)
    # A missing theme or font must never stop the panel from opening: chrome is cosmetic, the
    # operations are not.
    with contextlib.suppress(Exception):
        style.theme_use("clam")

    surface, bg, text = color("surface"), color("bg"), color("text")
    muted, border, accent = color("text_muted"), color("border"), color("accent")

    root.configure(background=bg)
    for name in ("TkDefaultFont", "TkTextFont", "TkMenuFont"):
        with contextlib.suppress(Exception):
            tkfont.nametofont(name).configure(family=FAMILY, size=FONTS["body"][1])

    # `lightcolor`/`darkcolor` are clam's 3D bevel, and they default to near-white: in dark mode every
    # card, tab, table and combobox came out ringed in a bright line. Pinned to the surface itself, the
    # bevel disappears and the only edge left is `bordercolor`, which the palette controls.
    style.configure(".", background=bg, foreground=text, fieldbackground=surface,
                    bordercolor=border, lightcolor=surface, darkcolor=surface,
                    focuscolor=accent, font=FONTS["body"])
    style.configure("TFrame", background=bg)
    style.configure("Card.TFrame", background=surface, relief="flat")
    style.configure("Toolbar.TFrame", background=surface)
    style.configure("TLabel", background=bg, foreground=text)
    style.configure("Card.TLabel", background=surface, foreground=text)
    style.configure("H1.TLabel", background=surface, foreground=text, font=FONTS["h1"])
    style.configure("H2.TLabel", background=bg, foreground=text, font=FONTS["h2"])
    style.configure("Muted.TLabel", background=bg, foreground=muted, font=FONTS["small"])
    style.configure("CardMuted.TLabel", background=surface, foreground=muted, font=FONTS["small"])
    style.configure("Metric.TLabel", background=surface, foreground=text, font=FONTS["h2"])
    style.configure("Icon.TLabel", background=surface, foreground=muted, font=FONTS["icon"])

    style.configure("TLabelframe", background=bg, bordercolor=border, relief="solid", borderwidth=1)
    style.configure("TLabelframe.Label", background=bg, foreground=muted, font=FONTS["strong"])
    style.configure("Card.TLabelframe", background=surface, bordercolor=border,
                    relief="solid", borderwidth=1)
    style.configure("Card.TLabelframe.Label", background=surface, foreground=muted,
                    font=FONTS["strong"])

    style.configure("TButton", background=color("surface_alt"), foreground=text,
                    bordercolor=border, focusthickness=1, padding=(10, 5), relief="flat",
                    lightcolor=color("surface_alt"), darkcolor=color("surface_alt"))
    style.map("TButton",
              background=[("disabled", color("surface_alt")), ("pressed", color("accent_soft")),
                          ("active", color("accent_soft"))],
              foreground=[("disabled", color("text_faint"))],
              bordercolor=[("active", accent)])
    style.configure("Accent.TButton", background=accent, foreground=color("accent_text"),
                    bordercolor=accent, font=FONTS["strong"], padding=(12, 6))
    style.map("Accent.TButton",
              background=[("disabled", color("border")), ("active", color("accent"))],
              foreground=[("disabled", color("text_faint"))])
    style.configure("Danger.TButton", background=color("surface_alt"), foreground=color("error"),
                    bordercolor=color("error"))
    style.map("Danger.TButton", background=[("active", color("error")),
                                            ("pressed", color("error"))],
              foreground=[("active", color("surface")), ("disabled", color("text_faint"))])
    # A step row: the label is left-aligned so a column of operations reads as a list, not as keys.
    style.configure("Op.TButton", anchor="w", padding=(8, 5), background=surface,
                    bordercolor=surface, relief="flat")
    style.map("Op.TButton",
              background=[("active", color("accent_soft")), ("pressed", color("accent_soft")),
                          ("disabled", surface)],
              bordercolor=[("active", accent)],
              foreground=[("disabled", color("text_faint"))])

    style.configure("TNotebook", background=bg, bordercolor=border, tabmargins=(8, 6, 8, 0),
                    lightcolor=bg, darkcolor=bg, borderwidth=0)
    style.configure("TNotebook.Tab", background=color("surface_alt"), foreground=muted,
                    padding=(16, 8), font=FONTS["body"], bordercolor=border,
                    lightcolor=color("surface_alt"), darkcolor=color("surface_alt"))
    style.map("TNotebook.Tab",
              background=[("selected", surface)],
              foreground=[("selected", text)],
              expand=[("selected", (0, 0, 0, 1))])

    style.configure("Treeview", background=surface, fieldbackground=surface, foreground=text,
                    bordercolor=border, lightcolor=surface, darkcolor=surface, borderwidth=0,
                    rowheight=FONTS["body"][1] * 2 + 6, font=FONTS["body"])
    style.configure("Treeview.Heading", background=color("surface_alt"), foreground=muted,
                    font=FONTS["strong"], relief="flat", padding=(6, 5), borderwidth=0,
                    lightcolor=color("surface_alt"), darkcolor=color("surface_alt"))
    style.map("Treeview.Heading", background=[("active", color("accent_soft"))])
    style.map("Treeview", background=[("selected", color("selection"))],
              foreground=[("selected", text)])

    style.configure("TCombobox", fieldbackground=surface, background=color("surface_alt"),
                    foreground=text, arrowcolor=muted, bordercolor=border, padding=(6, 4),
                    lightcolor=surface, darkcolor=surface)
    style.map("TCombobox", fieldbackground=[("readonly", surface)],
              bordercolor=[("focus", accent)])
    style.configure("TEntry", fieldbackground=surface, foreground=text, bordercolor=border,
                    padding=(6, 4), lightcolor=surface, darkcolor=surface)
    style.configure("TCheckbutton", background=bg, foreground=text)
    style.configure("Card.TCheckbutton", background=surface, foreground=text)
    style.configure("Card.TRadiobutton", background=surface, foreground=text)
    style.map("Card.TRadiobutton", background=[("active", surface)],
              indicatorcolor=[("selected", accent)])
    style.configure("TRadiobutton", background=bg, foreground=text)
    style.configure("TProgressbar", background=accent, troughcolor=color("surface_sunken"),
                    bordercolor=border, lightcolor=accent, darkcolor=accent)
    style.configure("TSeparator", background=border)
    for orientation in ("Vertical", "Horizontal"):
        style.configure(f"{orientation}.TScrollbar", background=color("surface_alt"), troughcolor=bg,
                        bordercolor=border, arrowcolor=muted, lightcolor=color("surface_alt"),
                        darkcolor=color("surface_alt"), borderwidth=0)
    return style
