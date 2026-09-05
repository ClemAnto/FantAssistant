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

#: WHEN A SECOND MODULE IS WORTH DRAWING TOO: the operator's own bar, «due o piu' moduli con percentuali
#: importanti (>30%)» (18/08/2026). The app draws little buttons to switch between them, and it can only do
#: that if the ELEVEN of each one travels: an eleven of a real club is a prediction about a person, so it is
#: drawn HERE by the panel's own functions and never recomputed in the app («A drawing is a claim too»).
#: Measured on the shipped bundle: 8 clubs of 37 on euro and 3 of 20 on Serie A have two shapes over the
#: bar, so this adds an eleven to a fifth of the clubs and nothing to the rest.
ALTERNATIVE_MIN_ODDS = 0.30

#: How many rivals a starter may carry. The operator's own bound: «eventualmente uno o due ballottaggi».
#: A man with NONE is not a man without rivals - a starter whose granular role is unknown has no duel the
#: sheet can express, and `duels_known` says which of the two it is («vuoto = ignoto, mai zero»).
MAX_DUELS = 2


def _fc_id(row: dict) -> int | None:
    """The row's `fc_id` as the integer everything joins on. One reader, because three callers need it."""
    try:
        return int(float(row.get("fc_id")))
    except (TypeError, ValueError):
        return None


def _man(view: Any, row: dict, x: float | None = None, in_eleven: bool = False) -> dict:
    """One drawn man: his identity, where he is drawn, what he is, and how much he plays."""
    out: dict[str, Any] = {}
    for key, column in MAN_COLUMNS.items():
        value = row.get(column)
        out[key] = value if value not in ("", None) else None
    out["fc_id"] = _fc_id(row)
    if x is not None:
        out["x"] = round(float(x), 3)
    # The claim is the panel's own standing - who starts when everybody is fit - and it is what picked him.
    try:
        out["claim"] = round(view.claim(row, "season"), 3)
    except Exception:                                   # noqa: BLE001 - a claim we cannot read is not a zero
        out["claim"] = None
    # ...and how long he is expected to stay ON THE PITCH next season, which is a different question from
    # how often he plays and the one the card's chip answers (`engine/minutes.py`, measured +7.5%/+7.6%
    # against showing last season's average unchanged). It is written HERE and not recomputed in the app
    # for the same reason the board is: it is a prediction about a person. Unknown stays None.
    try:
        predicted = view.minutes_next(row)
        out["minutes_next"] = None if predicted is None else round(predicted, 0)
    except Exception:                                   # noqa: BLE001 - one man, never the board
        out["minutes_next"] = None
    # ...and WHICH OF THE SIX WORDS he is (`engine/status.py`). Written on the man the pitch draws so a
    # card is self-contained, and computed from the same call as the sheet-wide map below - one answer per
    # player, not one per place. `in_eleven` is the DRAWN board's, never an alternative shape's: the label
    # is a fact about the man, and it must not change because a button was pressed.
    try:
        out["status"] = view.titolarita_status(row, in_eleven)
    except Exception:                                   # noqa: BLE001 - one man, never the board
        out["status"] = None
    return out


def _drawn(view: Any, club: str, shape: str, mode: str, with_rivals: bool,
           eleven_ids: set[int] | None = None) -> tuple[str, dict, set[int]]:
    """The PICTURE, the drawn lines and WHO IS IN THEM, by calling the panel's own functions.

    Extracted so that the drawn board and the ALTERNATIVE modules cannot drift: the app switches between
    them with a button, and two shapes drawn by two pieces of code would be two definitions of a board -
    the very thing this module exists to prevent. Nothing here decides WHICH shape: that is
    `view.board_shape` for the drawn one, and the odds for the others.

    `eleven_ids` is whose titolarita counts as «in the eleven». It is left None for the DRAWN board, which
    is its own answer, and passed explicitly for the alternatives so that a man the club fields only in a
    shape it probably will not play does not read `titolare` off a button.
    """
    eleven = view.eleven(club, shape, mode)
    lanes, _geometry, picture = view.lanes_for(eleven)
    # WHO is placed has to be known before the first man is built: `in_eleven` is a property of the board
    # and not of the row, and a rival for one place can be a starter at another.
    placed_by_line = {}
    for line in LINES:
        slots = view._lane(lanes.get(line) or [], line)
        placed_by_line[line] = view._placed(slots, line)
    own_ids = {fid for placed in placed_by_line.values() for _x, row, _rivals in placed
               if (fid := _fc_id(row)) is not None}
    ids = own_ids if eleven_ids is None else eleven_ids
    lines: dict[str, list] = {}
    for line in LINES:
        # The panel's EXACT sequence: `_lane` puts the line in screen order (and decides the side of the
        # men whose side is unknown, alternately), `_placed` spreads them, `_line_codes` names the marker
        # each of them wears - with the corrections that make a centre-forward a `Pc` and not an `As`.
        # Skipping `_lane` was a latent divergence from the screen: it does not change WHO is in the
        # eleven (so no published judge number moves) but it can change the side an unknown-side man is
        # drawn on, and the marker is read off that side.
        placed = placed_by_line[line]
        markers = view._line_codes(placed, line)
        drawn = []
        for index, (x, row, rivals) in enumerate(placed):
            man = _man(view, row, x, in_eleven=_fc_id(row) in ids)
            # The role he wears IN THIS MODULE, which is one code and not his whole list: that is what the
            # pitch shows, and it is the panel's own answer rather than a re-derivation.
            man["badge"] = markers[index] if index < len(markers) else None
            if with_rivals:
                # The panel's own order, capped: the first two are the ones a pitch can show.
                man["duels"] = [_man(view, rival, in_eleven=_fc_id(rival) in ids)
                                for rival in (rivals or [])[:MAX_DUELS]]
                # A starter whose granular real role is unknown has no duel the sheet can express: that
                # is «unknown», never «no rival», and the flag says which.
                man["duels_known"] = bool(row.get("desc_real_roles"))
            drawn.append(man)
        lines[line] = drawn
    return picture, lines, own_ids


def _statuses(view: Any, drawn: dict[str, set[int]]) -> dict[int, dict]:
    """Which of the six words describes every man of the sheet, plus the two numbers behind the word.

    Sheet-wide and not eleven-wide, because the question is asked of every row an auction can bid on -
    and produced HERE, from the same loaded view as the boards, because the ladder READS the drawing
    (`engine/status.py`): a state computed anywhere else could describe a different eleven than the one
    exported, which is the reason `boards.json` already lives inside the sheet's own folder.

    A club whose board could not be drawn gets NO state at all rather than the ungated ladder: without the
    eleven, «is he in it» is unknown, and calling a starter `panchina` because a drawing failed is exactly
    the kind of silent wrongness this project keeps paying for. Empty is unknown, never a rung.
    """
    out: dict[int, dict] = {}
    for row in view.players:
        fid = _fc_id(row)
        club = row.get("club") or ""
        if fid is None or club not in drawn:
            continue
        try:
            play = view.play_share(row)
            predicted = view.minutes_next(row)
            out[fid] = {
                "status": view.titolarita_status(row, fid in drawn[club]),
                # The two numbers the word is made of, so a row can explain its own label - «a number must
                # say what it is measured against». `play` is a share of the matches he is FIT for.
                "play": None if play is None else round(play, 3),
                "minutes": None if predicted is None else round(predicted, 0),
                "in_eleven": fid in drawn[club],
            }
        except Exception:                                   # noqa: BLE001 - one man, never the sheet
            continue
    return out


def extract_boards(config, sheet: Path, mode: str = "typical", *,
                   apply_rulings: bool = False,
                   with_rivals: bool = False,
                   matchdays: float | None = None,
                   statuses: dict[int, dict] | None = None) -> dict[str, dict]:
    """What the panel would draw for every club of `sheet`, by calling the REAL functions.

    `apply_rulings` defaults to FALSE, which is the judges' setting and the safe one: a caller that forgets
    to think about it gets the model's own answer and not the operator's. The panel's data path opts in.

    Pass a dict as `statuses` to get the sheet-wide titolarita ladder filled into it. It is an output
    parameter rather than a second return value so the two judges, which do not want it, keep calling this
    exactly as they did - and it is produced here rather than in a pass of its own because it reads the
    DRAWN eleven, and a second load of the sheet could draw a different one.
    """
    import tkinter as tk

    from euroleghe_ingest.gui import SnapshotView

    root = tk.Tk()
    root.withdraw()
    try:
        view = SnapshotView(root, config)
        view.load_sheet(Path(sheet), apply_rulings=apply_rulings)
        # IL CALENDARIO DELLA PIATTAFORMA, DETTO invece che riletto. `snapshot` chiama questa funzione
        # PRIMA di scrivere il manifest, quindi su una cartella nuova `view.manifest` non ha `matchdays`
        # e `platform_matchdays()` risponde zero: `minutes_next` perde allora la meta' del suo `P` che
        # viene dal modello, e la colonna esce diversa da quella che lo stesso foglio ricalcola. Su una
        # cartella riusata e' peggio, perche' legge il manifest della corsa precedente senza dirlo. Il
        # chiamante quel numero lo SA; qui si iniettA solo dove manca, cosi' i due giudici - che passano
        # un foglio gia' scritto e completo - continuano a leggere il suo.
        if matchdays and not (view.manifest.get("matchdays") or {}).get("platform_target"):
            view.manifest.setdefault("matchdays", {})["platform_target"] = matchdays
        boards: dict[str, dict] = {}
        drawn_ids: dict[str, set[int]] = {}
        for club in sorted(view.clubs):
            info = view.clubs[club]
            try:
                odds = view.shape_odds(club, info, mode)
                shape, why = view.board_shape(club, info, mode)
                picture, lines, eleven_ids = _drawn(view, club, shape, mode, with_rivals)
                drawn_ids[club] = eleven_ids
                # ...AND THE OTHER MODULES THE CLUB REALLY MIGHT DRAW, so the app can switch between them
                # instead of showing one answer as if it were the only one. Same functions, same flags: the
                # alternative is a board like the drawn one, and the only thing that changes is the shape
                # it is solved on. A shape that reshapes into the same picture is dropped - it would be a
                # button that changes nothing - and a broken one is skipped without taking the club down.
                alternatives = {}
                for other, p in (odds or {}).items():
                    if other == shape or p < ALTERNATIVE_MIN_ODDS:
                        continue
                    try:
                        other_picture, other_lines, _ = _drawn(view, club, other, mode, with_rivals,
                                                               eleven_ids=eleven_ids)
                    except Exception:                       # noqa: BLE001 - one shape, not the club
                        continue
                    if other_picture == picture:
                        continue
                    alternatives[other] = {"picture": other_picture, "p": round(p, 3),
                                           "lines": other_lines}
                boards[club] = {
                    "coach": info.get("coach"), "new_coach": info.get("new_coach"),
                    "formation_typical": info.get("formation_typical"),
                    "coach_shapes": info.get("coach_shapes"),
                    "board_shape": shape, "why": why, "picture": picture,
                    "odds": {s: round(p, 3) for s, p in list(odds.items())[:4]},
                    "lines": lines,
                    # The other modules over the bar, each with its own eleven and its own probability.
                    # Empty for four clubs of five, which is the point: a button that offers a shape
                    # nobody expects would be an invitation to doubt the right answer.
                    "alternatives": alternatives,
                }
            except Exception as exc:    # noqa: BLE001 - one broken club must not hide the other 19
                boards[club] = {"error": repr(exc)}
        if statuses is not None:
            statuses.update(_statuses(view, drawn_ids))
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


def write_boards(config, folder: Path, mode: str = "typical",
                 matchdays: float | None = None) -> dict:
    """Write `boards.json` beside the sheet it describes, and say what it contains.

    Beside the sheet ON PURPOSE: a board that could come from a different sheet than the one exported is a
    mismatch nobody would ever see. So it is produced from the folder just written and lives in it.
    """
    statuses: dict[int, dict] = {}
    boards = extract_boards(config, folder, mode=mode, apply_rulings=True, with_rivals=True,
                            matchdays=matchdays,
                            statuses=statuses)
    payload = {
        "sheet": Path(folder).name,
        "mode": mode,
        # Declared where a reader will look for it: these boards HONOUR the operator's rulings, unlike the
        # ones the two judges read. Same function, opposite flag.
        "apply_rulings": True,
        "clubs": boards,
        # THE TITOLARITA LADDER for every man of the sheet, keyed by `fc_id` (`engine/status.py`). It
        # travels here and not only in the sheet's own column because the pitch shows it on a card, and a
        # reader that has the board already has the state - one file, one drawing, one set of words.
        "titolarita": {str(fid): one for fid, one in sorted(statuses.items())},
    }
    (Path(folder) / "boards.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    drawn = {club: board for club, board in boards.items() if "error" not in board}
    men = sum(len(line) for board in drawn.values() for line in board["lines"].values())
    # How many clubs offer a second module and how many elevens that is: a count nobody prints is a
    # feature nobody can tell from a broken one (the lesson of the badges the bundle already carried).
    with_alternatives = sum(1 for board in drawn.values() if board.get("alternatives"))
    alternative_shapes = sum(len(board.get("alternatives") or {}) for board in drawn.values())
    duels = sum(len(man.get("duels") or [])
                for board in drawn.values() for line in board["lines"].values() for man in line)
    blind = sum(1 for board in drawn.values() for line in board["lines"].values()
                for man in line if not man.get("duels_known"))
    problems = {club: disagreements(board) for club, board in drawn.items()}
    ladder: dict[str, int] = {}
    for one in statuses.values():
        ladder[one["status"] or "unknown"] = ladder.get(one["status"] or "unknown", 0) + 1
    return {
        "clubs": len(boards),
        "drawn": len(drawn),
        "failed": {club: board["error"] for club, board in boards.items() if "error" in board},
        "men": men,
        "clubs_with_alternatives": with_alternatives,
        "alternative_shapes": alternative_shapes,
        "duels": duels,
        "no_granular_role": blind,
        "disagreements": {club: why for club, why in problems.items() if why},
        # The ladder, so `snapshot` can put it in the sheet's own column and print how it fell out. A rung
        # nobody counts is a rung nobody can tell from a broken one.
        "statuses": statuses,
        "ladder": ladder,
    }
