"""press - the press's typical formations as a DATED reference, and the boards judged against it.

Item 0 of docs/model/todolist-formazioni-tipo-v1.md, born from the 08/08/2026 comparison (20 clubs,
4-6 sources each) that lived in scratchpad scripts and hand-copied JSON files. The standing rule
travels with the module: THE PRESS IS A JUDGE, NEVER AN INPUT OF THE CLAIM - nothing the engine or
the panel computes reads `press_formations`; the one reader is this module's own comparison report.

Three entry points, one module:
- IMPORT (`--import FILE --season YYYY-YY`): a JSON list of per-club entries lands in
  `press_formations` as a per-DAY fact (never backfillable, like `probable_starter`) and is archived
  under data/raw/press/ so the table survives `rebuild`.
- REINGEST (no options - what `rebuild` runs): replay every archived reference offline.
- COMPARE (`--sheet DIR`): extract, headlessly, what the Snapshot panel would draw for every club of
  the sheet - through the panel's own loader and the REAL functions (`board_shape` / `eleven` /
  `lanes_for`), never the columns that look like them (v9.38) - and score modules and shared XI men
  against the stored reference. Report: data/reports/press_comparison.json.

The module verdict is judged on the DRAWN picture (`lanes_for` after `_reshape`), never on the raw
board string: the provider's vocabulary counts wingers as midfielders, so our 4-5-1 IS the press's
4-2-3-1 only after the transformation has spoken (formazioni-tipo-v1.md §1). MATCH = the picture is
the press's module; ALT = it is one of the alternatives the press itself declares; DIFF = neither.
"""

from __future__ import annotations

import datetime as dt
import json
import unicodedata
from pathlib import Path

from euroleghe_ingest.context import Context
from euroleghe_ingest.matching import club_identity

NAME = "press"
DESCRIPTION = "press typical formations: dated reference (import/reingest) + the board comparison"
DEPENDS_ON: list[str] = []          # reads only its own raw files; the comparison reads a sheet folder
RAW_INPUTS: list[str] = ["press/press_<season>_<day>_<source>.json (written by --import)"]
NETWORK = False

# What a per-club entry may call its fields: the collector's vocabulary (typical_xi, ballottaggi,
# coach_web) is accepted on import and normalized to the table's own names.
_ENTRY_KEYS = {
    "coach": ("coach", "coach_web"),
    "module": ("module",),
    "module_alternatives": ("module_alternatives",),
    "xi": ("xi", "typical_xi"),
    "duels": ("duels", "ballottaggi"),
    "notes": ("notes",),
    "confidence": ("confidence",),
}
_JSON_COLUMNS = ("module_alternatives", "xi", "duels")


def _entry_value(entry: dict, field: str):
    for key in _ENTRY_KEYS[field]:
        if key in entry:
            return entry[key]
    return None


# ---------- import / archive / reingest ----------
def import_reference(ctx: Context, path: Path | str, *, season: str | None = None,
                     source: str | None = None,
                     observed_on: str | None = None) -> tuple[str, str, str, int]:
    """One JSON file -> `press_formations`. Returns (season, observed_on, source, clubs written).

    Accepts the collector's format (a bare LIST of per-club entries, metadata from the arguments) and
    the self-describing archive wrapper ({season, observed_on, source, clubs}) - which is what makes
    `rebuild`'s replay need no arguments at all.
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        season = data.get("season") or season
        observed_on = data.get("observed_on") or observed_on
        source = data.get("source") or source
        entries = data.get("clubs") or []
    else:
        entries = data
    if not season:
        raise ValueError(f"{path}: the season the XI predicts is required (--season YYYY-YY)")
    observed_on = observed_on or dt.datetime.now(tz=dt.UTC).date().isoformat()
    source = source or "press"
    for entry in entries:
        values = {field: _entry_value(entry, field) for field in _ENTRY_KEYS}
        for field in _JSON_COLUMNS:
            if values[field] is not None and not isinstance(values[field], str):
                values[field] = json.dumps(values[field], ensure_ascii=False)
        ctx.conn.execute(
            "INSERT OR REPLACE INTO press_formations(club, season, observed_on, source, coach,"
            " module, module_alternatives, xi, duels, notes, confidence)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (entry["club"], season, observed_on, source, values["coach"], values["module"],
             values["module_alternatives"], values["xi"], values["duels"], values["notes"],
             values["confidence"]))
    ctx.conn.commit()
    return season, observed_on, source, len(entries)


def archive(ctx: Context, season: str, observed_on: str, source: str) -> Path:
    """Write data/raw/press/press_{season}_{observed_on}_{source}.json FROM the table.

    Rebuilt from the rows rather than copied from the import file, so the archive and the table can
    never disagree - and so two group files imported the same day MERGE into one archive per
    (season, day, source), which is the fact's own grain.
    """
    rows = ctx.conn.execute(
        "SELECT club, coach, module, module_alternatives, xi, duels, notes, confidence"
        " FROM press_formations WHERE season = ? AND observed_on = ? AND source = ? ORDER BY club",
        (season, observed_on, source)).fetchall()
    clubs = []
    for row in rows:
        entry = dict(zip(("club", "coach", "module", "module_alternatives", "xi", "duels", "notes",
                          "confidence"), row, strict=True))
        for field in _JSON_COLUMNS:
            if entry[field]:
                entry[field] = json.loads(entry[field])
        clubs.append(entry)
    folder = ctx.config.raw_dir / "press"
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"press_{season}_{observed_on}_{source}.json"
    dest.write_text(json.dumps({"season": season, "observed_on": observed_on, "source": source,
                                "clubs": clubs}, ensure_ascii=False, indent=1), encoding="utf-8")
    return dest


def reingest_from_raw(ctx: Context) -> tuple[int, int]:
    """Replay every archived reference (offline). Returns (files, club rows)."""
    folder = ctx.config.raw_dir / "press"
    files = sorted(folder.glob("press_*.json")) if folder.exists() else []
    total = 0
    for path in files:
        _, _, _, count = import_reference(ctx, path)
        total += count
    return len(files), total


# ---------- the comparison ----------
def load_reference(conn, season: str, source: str | None = None) -> dict[str, dict]:
    """Per club IDENTITY, the latest dated reading for the season.

    Ordered by (observed_on, source) with the last row winning, so when two sources publish the same
    day the choice is deterministic and the report can say which reading judged each club.
    """
    sql = ("SELECT club, observed_on, source, coach, module, module_alternatives, xi, duels,"
           " confidence FROM press_formations WHERE season = ?")
    params: list = [season]
    if source:
        sql += " AND source = ?"
        params.append(source)
    out: dict[str, dict] = {}
    for row in conn.execute(sql + " ORDER BY observed_on, source", params):
        entry = dict(zip(("club", "observed_on", "source", "coach", "module",
                          "module_alternatives", "xi", "duels", "confidence"), row, strict=True))
        for field in _JSON_COLUMNS:
            if entry.get(field):
                entry[field] = json.loads(entry[field])
        out[club_identity(entry["club"])] = entry
    return out


def _name_tokens(name: str) -> set[str]:
    """Surname tokens, accent- and punctuation-free, initials dropped."""
    flat = unicodedata.normalize("NFKD", name or "")
    flat = "".join(ch for ch in flat if not unicodedata.combining(ch))
    flat = flat.replace("'", "").replace("-", " ").replace(".", " ").lower()
    return {token for token in flat.split() if len(token) > 2}


def _names_match(one: str, other: str) -> bool:
    return bool(_name_tokens(one) & _name_tokens(other))


def extract_boards(config, sheet: Path, mode: str = "typical") -> dict[str, dict]:
    """What the panel would draw for every club of the sheet, by calling the REAL functions.

    A headless Tk instance of the panel's own class, loaded through the panel's own loader
    (`SnapshotView.load_sheet`), so the population statistics, the caches and the elevens are exactly
    the screen's - the 08/08/2026 defect was precisely a harness whose rows were a different
    population from the panel's (CLAUDE.md, «Drive the REAL panel»).
    """
    import tkinter as tk

    from euroleghe_ingest.gui import SnapshotView

    root = tk.Tk()
    root.withdraw()
    try:
        view = SnapshotView(root, config)
        view.load_sheet(Path(sheet))
        boards: dict[str, dict] = {}
        for club in sorted(view.clubs):
            info = view.clubs[club]
            try:
                odds = view.shape_odds(club, info, mode)
                shape, why = view.board_shape(club, info, mode)
                eleven = view.eleven(club, shape, mode)
                lanes, _geometry, picture = view.lanes_for(eleven)
                lines = {}
                for line in ("P", "D", "M", "T", "A"):
                    placed = view._placed(lanes.get(line) or [], line)
                    lines[line] = [{"name": row.get("name"), "x": round(x, 2),
                                    "codes": row.get("desc_real_roles"),
                                    "claim": round(view.claim(row, "season"), 3)}
                                   for x, row, _rivals in placed]
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


def compare(boards: dict[str, dict], reference: dict[str, dict]) -> tuple[list[dict], dict]:
    """Score the boards against the reference: per club, the module verdict and the XI overlap.

    Clubs join by IDENTITY (`club_identity`), never by the string a source spelled - the join that
    silently lost Milan, Roma and Napoli once already. XI names match on shared surname tokens, both
    directions, so 'Martinez L.' finds 'Lautaro Martinez'.
    """
    by_identity = {club_identity(club): (club, board) for club, board in boards.items()}
    rows: list[dict] = []
    for identity in sorted(reference, key=lambda key: reference[key]["club"]):
        entry = reference[identity]
        _club, board = by_identity.get(identity, (entry["club"], None))
        base = {"club": entry["club"], "observed_on": entry["observed_on"],
                "source": entry["source"], "press_module": entry["module"],
                "press_alt": entry.get("module_alternatives") or [],
                "press_confidence": (entry.get("confidence") or "")[:6]}
        if board is None or "error" in board:
            rows.append({**base, "status": "NO BOARD",
                         "error": (board or {}).get("error", "club not on the sheet")})
            continue
        press_xi = [name for line in (entry.get("xi") or {}).values() for name in line]
        our_names = [man["name"] for line in ("P", "D", "M", "T", "A")
                     for man in (board["lines"].get(line) or [])]
        shared = [name for name in press_xi if any(_names_match(name, ours) for ours in our_names)]
        drawn = board["picture"]
        # an alternative may carry a free-text qualifier («4-2-3-1 (in partita)»): the module is its
        # first token
        verdict = ("MATCH" if drawn == entry["module"] else
                   "ALT" if any(drawn == alt.split(" ")[0] for alt in base["press_alt"]) else
                   "DIFF")
        rows.append({**base, "our_board": board["board_shape"], "our_drawn": drawn,
                     "module": verdict, "xi_shared": len(shared), "xi_of": len(press_xi),
                     "only_press": [name for name in press_xi if name not in shared],
                     "only_ours": [ours for ours in our_names
                                   if not any(_names_match(name, ours) for name in press_xi)]})
    scored = [row for row in rows if "module" in row]
    summary = {
        "clubs": len(rows),
        "no_board": len(rows) - len(scored),
        "module_match": sum(1 for row in scored if row["module"] == "MATCH"),
        "module_alt": sum(1 for row in scored if row["module"] == "ALT"),
        "module_diff": sum(1 for row in scored if row["module"] == "DIFF"),
        "xi_shared": sum(row["xi_shared"] for row in scored),
        "xi_of": sum(row["xi_of"] for row in scored),
    }
    return rows, summary


def compare_sheet(ctx: Context, sheet: Path, *, mode: str = "typical", source: str | None = None,
                  report: bool = True) -> dict | None:
    """The repeatable judgement: sheet folder in, per-club verdicts and one summary out."""
    manifest = json.loads((sheet / "manifest.json").read_text(encoding="utf-8"))
    season = manifest.get("target_season")
    reference = load_reference(ctx.conn, season, source=source)
    if not reference:
        print(f"[press] no reference stored for {season}"
              + (f" from source {source}" if source else "")
              + " - import one first (press --import FILE --season ...)")
        return None
    boards = extract_boards(ctx.config, sheet, mode=mode)
    rows, summary = compare(boards, reference)
    print(f"[press] {sheet.name} vs {len(reference)} press club(s):"
          f" module MATCH {summary['module_match']}, ALT {summary['module_alt']},"
          f" DIFF {summary['module_diff']}"
          + (f", NO BOARD {summary['no_board']}" if summary["no_board"] else "")
          + f" | men {summary['xi_shared']}/{summary['xi_of']}")
    for row in rows:
        if "module" not in row:
            print(f"  {row['club']:14s} NO BOARD (press: {row['press_module']}) - {row['error']}")
            continue
        print(f"  {row['club']:14s} press {row['press_module']:8s} ours {row['our_drawn']:8s}"
              f" [{row['module']:5s}] XI {row['xi_shared']:2d}/{row['xi_of']:2d}"
              f" | press-only: {', '.join(row['only_press']) or '-'}"
              f" | ours-only: {', '.join(row['only_ours']) or '-'}")
    payload = {
        "generated_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
        "sheet": sheet.name, "season": season, "mode": mode,
        "summary": summary, "clubs": rows,
    }
    if report:
        dest = ctx.config.data_dir / "reports" / "press_comparison.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[press] report -> {dest}")
    return payload


def run(ctx: Context, *, import_files: list[str] | None = None, season: str | None = None,
        source: str | None = None, observed_on: str | None = None, sheet: str | None = None,
        report: bool = True, **_kwargs) -> None:
    if import_files:
        for path in import_files:
            file_season, day, src, count = import_reference(
                ctx, path, season=season, source=source, observed_on=observed_on)
            archived = archive(ctx, file_season, day, src)
            print(f"[press] {path}: {count} club(s) -> press_formations"
                  f" ({file_season}, {day}, {src}) · archived {archived.name}")
    elif not sheet:
        files, clubs = reingest_from_raw(ctx)
        if files:
            print(f"[press] {files} archived reference file(s) re-ingested ({clubs} club rows)")
        else:
            print("[press] nothing to do: no archived reference under data/raw/press/. Import one "
                  "with --import FILE --season YYYY-YY, or judge a sheet with --sheet DIR.")
    if sheet:
        compare_sheet(ctx, Path(sheet), source=source, report=report)
