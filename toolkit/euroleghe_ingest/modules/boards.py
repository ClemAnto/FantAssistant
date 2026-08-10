"""boards - what the PANEL would draw, as data: one board per club of a sheet.

ONE definition of a board, and it is the panel's own. This module does not re-derive a shape or an eleven:
it drives `SnapshotView` headless, through the panel's own loader, and calls the REAL functions
(`board_shape` / `eleven` / `lanes_for` / `_placed`). The 08/08/2026 defect was exactly a harness whose rows
were a different population from the screen's - «Drive the REAL panel, not a harness that builds a different
population» - and the cure was to stop building a second one. It lives here rather than inside `press` because
it now has two callers with opposite needs, and a shared function is the only way they cannot drift:

  * the JUDGES (`press --against press|outcome`) read it with `apply_rulings=False`. A ruling is often made
    looking at the judge, so a judge must never score the operator's own answers.
  * the PANEL's data path (`snapshot`, and from there the app's bundle) reads it with `apply_rulings=True`,
    because `config/board_rulings.json` is the operator's declared truth and has the highest precedence for
    the DRAWN board. Same function, opposite flag, and the reason is written at each call site.

`with_rivals` is the other difference: the judges compare names and shapes, while a pitch has to show the
BALLOTTAGGI. The panel already computes them - `_placed` returns `(x, starter, rivals)` per man - and the
judges simply threw them away.

What a drawn line is: the module's numbers ARE the lines, keeper excluded and always alone in front of the
defence. Three numbers mean defence / midfield / attack, four mean defence / midfield / TREQUARTI / attack,
and the last is always the attack (the operator's own statement of the rule, 10/08/2026). `picture` is that
string AFTER `_reshape`, i.e. the one the drawn men actually form; `board_shape` is the module the fit was
solved on, and the two differ whenever a transformation split a row - measured at 5 clubs of 20, which is why
both travel instead of one.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

NAME = "boards"
DESCRIPTION = "what the panel would draw for every club of a sheet, as data"

#: The lines a pitch draws, from the goal up. The keeper is not one of the module's numbers.
LINES = ("P", "D", "M", "T", "A")

#: What a drawn man carries beyond his position, and every one of them is a MEASURED column of the sheet -
#: nothing here is derived a second time. `codes` is the granular real role (the twelve codes), which is the
#: only thing that separates a left back from a centre back; `minutes` and `matches` are his own championship's
#: and are what «gioca poco» means in numbers.
MAN_COLUMNS = {
    "fc_id": "fc_id",
    "name": "name",
    "codes": "desc_real_roles",
    # The LISTONE's own role, which is what the game scores by and what a bid is made against - a different
    # thing from the granular real role above (`Dd;Dc` against `DR;DC`) and from the marker below.
    "mantra": "roles_mantra",
    "classic": "role_classic",
    "role_line": "desc_real_role_line",
    "role_side": "desc_real_role_side",
    "minutes": "desc_minutes_full_season",
    "matches": "desc_season_matches",
    "minutes_club": "desc_minutes_club",
    "starts_club": "desc_season_starts_club",
    "minutes_per_match": "desc_form_minutes_per_club_match",
    "starter_prob": "desc_starter_prob",
}

#: How many rivals a starter may carry. The operator's own bound: «eventualmente uno o due ballottaggi».
#: A man with NONE is not a man without rivals - a starter whose granular role is unknown has no duel the
#: sheet can express, and `duels_known` says which of the two it is («vuoto = ignoto, mai zero»).
MAX_DUELS = 2


def _man(view: Any, row: dict, x: float | None = None) -> dict:
    """One drawn man: his identity, where he is drawn, what he is, and how much he plays."""
    out: dict[str, Any] = {}
    for key, column in MAN_COLUMNS.items():
        value = row.get(column)
        out[key] = value if value not in ("", None) else None
    if out.get("fc_id") is not None:
        try:
            out["fc_id"] = int(float(out["fc_id"]))
        except (TypeError, ValueError):
            out["fc_id"] = None
    if x is not None:
        out["x"] = round(float(x), 3)
    # The claim is the panel's own standing - who starts when everybody is fit - and it is what picked him.
    try:
        out["claim"] = round(view.claim(row, "season"), 3)
    except Exception:                                   # noqa: BLE001 - a claim we cannot read is not a zero
        out["claim"] = None
    return out


def extract_boards(config, sheet: Path, mode: str = "typical", *,
                   apply_rulings: bool = False,
                   with_rivals: bool = False) -> dict[str, dict]:
    """What the panel would draw for every club of `sheet`, by calling the REAL functions.

    `apply_rulings` defaults to FALSE, which is the judges' setting and the safe one: a caller that forgets
    to think about it gets the model's own answer and not the operator's. The panel's data path opts in.
    """
    import tkinter as tk

    from euroleghe_ingest.gui import SnapshotView

    root = tk.Tk()
    root.withdraw()
    try:
        view = SnapshotView(root, config)
        view.load_sheet(Path(sheet), apply_rulings=apply_rulings)
        boards: dict[str, dict] = {}
        for club in sorted(view.clubs):
            info = view.clubs[club]
            try:
                odds = view.shape_odds(club, info, mode)
                shape, why = view.board_shape(club, info, mode)
                eleven = view.eleven(club, shape, mode)
                lanes, _geometry, picture = view.lanes_for(eleven)
                lines: dict[str, list] = {}
                for line in LINES:
                    # The panel's EXACT sequence: `_lane` puts the line in screen order (and decides the side
                    # of the men whose side is unknown, alternately), `_placed` spreads them, `_line_codes`
                    # names the marker each of them wears - with the corrections that make a centre-forward a
                    # `Pc` and not an `As`. Skipping `_lane` was a latent divergence from the screen: it does
                    # not change WHO is in the eleven (so no published judge number moves) but it can change
                    # the side an unknown-side man is drawn on, and the marker is read off that side.
                    slots = view._lane(lanes.get(line) or [], line)
                    placed = view._placed(slots, line)
                    markers = view._line_codes(placed, line)
                    drawn = []
                    for index, (x, row, rivals) in enumerate(placed):
                        man = _man(view, row, x)
                        # The role he wears IN THIS MODULE, which is one code and not his whole list: that is
                        # what the pitch shows, and it is the panel's own answer rather than a re-derivation.
                        man["badge"] = markers[index] if index < len(markers) else None
                        if with_rivals:
                            # The panel's own order, capped: the first two are the ones a pitch can show.
                            man["duels"] = [_man(view, rival) for rival in (rivals or [])[:MAX_DUELS]]
                            # A starter whose granular real role is unknown has no duel the sheet can
                            # express: that is «unknown», never «no rival», and the flag says which.
                            man["duels_known"] = bool(row.get("desc_real_roles"))
                        drawn.append(man)
                    lines[line] = drawn
                boards[club] = {
                    "coach": info.get("coach"), "new_coach": info.get("new_coach"),
                    "formation_typical": info.get("formation_typical"),
                    "coach_shapes": info.get("coach_shapes"),
                    "board_shape": shape, "why": why, "picture": picture,
                    "odds": {s: round(p, 3) for s, p in list(odds.items())[:4]},
                    "lines": lines,
                }
            except Exception as exc:    # noqa: BLE001 - one broken club must not hide the other 19
                boards[club] = {"error": repr(exc)}
        return boards
    finally:
        root.destroy()


def counts_of(picture: str | None) -> dict[str, int] | None:
    """The module's numbers as the LINES they are, keeper excluded.

    The operator's rule, written down because a drawing that guesses it is a drawing nobody can check: each
    number is how many men stand on that line; three numbers are defence / midfield / attack; four are
    defence / midfield / trequarti / attack, and the LAST is always the attack. The keeper is never one of
    them and always occupies one slot in front of the defence.
    """
    if not picture:
        return None
    parts = [part for part in str(picture).split("-") if part.strip().isdigit()]
    numbers = [int(part) for part in parts]
    if len(numbers) == 3:
        keys = ("D", "M", "A")
    elif len(numbers) == 4:
        keys = ("D", "M", "T", "A")
    else:
        return None
    return {"P": 1, **dict(zip(keys, numbers, strict=True))}


def disagreements(board: dict) -> list[str]:
    """Where the drawn men and the module's own numbers do not say the same thing.

    Reported rather than hidden, and rather than trusted: the numbers come from `picture` and the men from
    `lanes`, which are produced by the same call, so a mismatch is a defect and not a rounding. This is the
    project's «verify the FUNCTION, not the column that looks like it» applied to a drawing.
    """
    counts = counts_of(board.get("picture"))
    if not counts:
        return [f"picture illeggibile: {board.get('picture')!r}"]
    out = []
    for line in LINES:
        wanted = counts.get(line, 0)
        drawn = len(board.get("lines", {}).get(line) or [])
        if wanted != drawn:
            out.append(f"linea {line}: il modulo dice {wanted}, i disegnati sono {drawn}")
    return out


def write_boards(config, folder: Path, mode: str = "typical") -> dict:
    """Write `boards.json` beside the sheet it describes, and say what it contains.

    Beside the sheet ON PURPOSE: a board that could come from a different sheet than the one exported is a
    mismatch nobody would ever see. So it is produced from the folder just written and lives in it.
    """
    boards = extract_boards(config, folder, mode=mode, apply_rulings=True, with_rivals=True)
    payload = {
        "sheet": Path(folder).name,
        "mode": mode,
        # Declared where a reader will look for it: these boards HONOUR the operator's rulings, unlike the
        # ones the two judges read. Same function, opposite flag.
        "apply_rulings": True,
        "clubs": boards,
    }
    (Path(folder) / "boards.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    drawn = {club: board for club, board in boards.items() if "error" not in board}
    men = sum(len(line) for board in drawn.values() for line in board["lines"].values())
    duels = sum(len(man.get("duels") or [])
                for board in drawn.values() for line in board["lines"].values() for man in line)
    blind = sum(1 for board in drawn.values() for line in board["lines"].values()
                for man in line if not man.get("duels_known"))
    problems = {club: disagreements(board) for club, board in drawn.items()}
    return {
        "clubs": len(boards),
        "drawn": len(drawn),
        "failed": {club: board["error"] for club, board in boards.items() if "error" in board},
        "men": men,
        "duels": duels,
        "no_granular_role": blind,
        "disagreements": {club: why for club, why in problems.items() if why},
    }
