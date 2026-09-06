"""Every `INSERT OR REPLACE` of the toolkit names every column of its table - or is DECLARED here.

`INSERT OR REPLACE` deletes the row and writes a new one, so every column the statement does not name
goes back to NULL. That cost two channels on 06/09/2026, both found by a script and not by a reading:
`recent_form.store` was throwing away `mv_synth` plus the four bonuses it pays one request a match for,
and `stats` was throwing away `clean_sheets` (509 keeper-seasons on the live DB), which
`derive_clean_sheets` writes from the per-match layer. A test per module cannot see either: the defect
is an ORDER BETWEEN MODULES - one module writes the row, another derives a column of it.

So the audit that found them lives here instead of in a chat's history, over all 36 tables, and the
sites that are partial ON PURPOSE are on a list somebody has to edit - a new line there is a decision
and not a silence. Two halves of it are deliberate:

* the reader is an AST walk and not a regex over lines, because Python joins ADJACENT string literals
  and the SQL in this repo is written that way (`press_formations` and `availability` below). The first
  pass of this audit split them and reported six statements that are whole - and a test that fails on
  healthy code is the fastest way to get itself switched off.
* an allowed site says on which BASIS it is allowed, and each basis is checked against something the
  code can be asked: `never_written` against every other write statement in the package (plus
  `validate.ALLOWED_EMPTY`, where the project already declares «nobody fills this»), `same_call`
  against the source of the pass that refills the column.
"""

from __future__ import annotations

import ast
import inspect
import re
import sqlite3
from pathlib import Path
from typing import NamedTuple

import euroleghe_ingest
from euroleghe_ingest.db import database
from euroleghe_ingest.modules import validate

PACKAGE = Path(euroleghe_ingest.__file__).resolve().parent

# What an f-string's `{...}` leaves behind: a hole the reader must refuse to guess at.
HOLE = "\x00"

_UPSERT = re.compile(r"INSERT\s+OR\s+REPLACE\s+INTO\s+", re.I)
_INSERT = re.compile(r"INSERT\s+(?:OR\s+\w+\s+)?INTO\s+", re.I)
_TABLE = re.compile(r'\s*"?([A-Za-z_][A-Za-z0-9_]*)"?')
_UPDATE = re.compile(r'UPDATE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+SET\s+(.*?)(?:\bWHERE\b|$)',
                     re.I | re.S)
_ASSIGNED = re.compile(r'"?([A-Za-z_][A-Za-z0-9_]*)"?\s*=')


class Site(NamedTuple):
    module: str                        # path relative to the package's parent, POSIX
    line: int
    table: str | None                  # None when the statement builds the name at runtime
    columns: tuple[str, ...] | None    # None when the column list is built at runtime


def _literals(source: str):
    """Every string literal of a module, with the line it starts on.

    An f-string is a LEAF: its `{...}` parts become HOLE and the walk does not descend into them -
    otherwise one statement is reported twice, once for the JoinedStr and once for a nested node.
    """
    stack = [ast.parse(source)]
    while stack:
        node = stack.pop()
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.lineno, node.value
            continue
        if isinstance(node, ast.JoinedStr):
            yield node.lineno, "".join(
                part.value if isinstance(part, ast.Constant) and isinstance(part.value, str)
                else HOLE for part in node.values)
            continue
        stack.extend(ast.iter_child_nodes(node))


def _column_list(text: str, opening: int) -> tuple[str, ...] | None:
    """The parenthesised column list that opens at `opening`, or None if it carries a HOLE."""
    depth = 0
    for i in range(opening, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                inner = text[opening + 1:i]
                if HOLE in inner:
                    return None
                return tuple(part.strip().strip('"') for part in inner.split(",") if part.strip())
    return None


def _statements(pattern: re.Pattern) -> list[Site]:
    """Every statement of the package matching `pattern`, read off its source."""
    found: list[Site] = []
    for path in sorted(PACKAGE.rglob("*.py")):
        module = path.relative_to(PACKAGE.parent).as_posix()
        for line, text in _literals(path.read_text(encoding="utf-8")):
            for match in pattern.finditer(text):
                rest = text[match.end():]
                name = _TABLE.match(rest)
                if not name:                      # the table itself is built at runtime
                    found.append(Site(module, line, None, None))
                    continue
                columns = None
                if rest[name.end():].lstrip().startswith("("):
                    columns = _column_list(rest, rest.index("(", name.end()))
                found.append(Site(module, line, name.group(1), columns))
    return found


def upsert_sites() -> list[Site]:
    return _statements(_UPSERT)


def schema_columns() -> dict[str, list[str]]:
    conn = sqlite3.connect(":memory:")
    database.apply_schema(conn)
    return {table: [row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')]
            for table in database.table_names(conn)}


def written_columns(schema: dict[str, list[str]]) -> dict[str, dict[str, set[str]]]:
    """Per table, which columns each write statement names: {table: {"module:line": {columns}}}.

    Both flavours, because «does anybody else fill this column» has to look at the UPDATEs too: the
    two defects of 06/09 were exactly a column that an UPDATE somewhere else was writing.
    """
    out: dict[str, dict[str, set[str]]] = {table: {} for table in schema}
    for site in _statements(_INSERT):
        if site.table in out and site.columns:
            out[site.table].setdefault(f"{site.module}:{site.line}", set()).update(site.columns)
    for path in sorted(PACKAGE.rglob("*.py")):
        module = path.relative_to(PACKAGE.parent).as_posix()
        for line, text in _literals(path.read_text(encoding="utf-8")):
            for match in _UPDATE.finditer(text):
                if match.group(1) not in out:
                    continue
                out[match.group(1)].setdefault(f"{module}:{line}", set()).update(
                    _ASSIGNED.findall(match.group(2)))
    return out


# ---------------------------------------------------------------------------
# The DECLARED list. Key: (module, table, the columns the statement leaves out).
# Line numbers are deliberately NOT part of the key - moving a function must not require editing this
# list, while adding a column to a table, or a partial site to a module, must.
#
# `basis` is what makes an entry checkable:
#   never_written - no other statement of the package fills those columns, so a REPLACE loses nothing.
#                   This is the entry to RE-DECIDE the day some module starts deriving one of them:
#                   that is precisely how `clean_sheets` became a defect.
#   same_call     - a later pass of the SAME call refills the column, so the row is never left half
#                   written. Asserted below against the source rather than trusted.
#   not_a_fact    - the branch writes a row for whom those columns cannot exist at all.
ALLOWED: dict[tuple[str, str, tuple[str, ...]], tuple[str, str]] = {
    ("euroleghe_ingest/modules/ratings.py", "match_ratings",
     ("assists_set_piece", "player_of_the_match", "started", "minutes")): (
        "never_written",
        "The votes Excel has none of the four: `minutes` is NULL on all 263,393 rows and `started` "
        "with it - the bench and the minutes are read from the per-match layer instead - while "
        "set-piece assists and man of the match only exist in seasons that publish them, which is "
        "none we hold. Nothing else in the toolkit writes them, so re-ingesting a round loses "
        "nothing. The day the per-match layer starts filling `started` here, this line is wrong.",
    ),
    ("euroleghe_ingest/modules/injuries.py", "player_xref", ("valid_from", "valid_to")): (
        "never_written",
        "A provider gives an id, never the window it is valid for: a mapping is dated only when a "
        "source says it changed, which has not happened yet (0 of 7,714 rows).",
    ),
    ("euroleghe_ingest/modules/positions.py", "player_xref", ("valid_from", "valid_to")): (
        "never_written", "Same statement and same reason, in the module that resolves most identities.",
    ),
    ("euroleghe_ingest/modules/positions.py", "club_xref", ("valid_from", "valid_to")): (
        "never_written", "Same for the club mapping (0 of 156 rows).",
    ),
    ("euroleghe_ingest/modules/transfers.py", "club_xref", ("valid_from", "valid_to")): (
        "never_written", "Same again: the fourth of the four xref writers.",
    ),
    ("euroleghe_ingest/modules/arrivals.py", "arrivals", ("tier", "foreign_fm_equiv")): (
        "same_call",
        "`run` empties the table - a roster diff is re-derived whole - and ends with `enrich`, which "
        "UPDATEs the tier and the FM-equivalent of every row it has just written.",
    ),
    ("euroleghe_ingest/modules/positions.py", "positions", ("avg_x", "avg_y")): (
        "same_call",
        "`derive_roles_from_match_layer` owns every `source='sofascore'` row (it DELETEs them first), "
        "and every caller follows it with `ingest_heatmaps_from_cache`, which puts the centroid back.",
    ),
    ("euroleghe_ingest/modules/positions.py", "positions", ("derived_role", "n_matches")): (
        "not_a_fact",
        "The heatmap fallback: a player-season with a touch cloud and NO per-match layer, so there is "
        "no derived role and no match count for him to lose - «vuoto = ignoto».",
    ),
}

# Statements this reader cannot resolve, and why each is fine as it stands. A skipped statement is a
# hole in the audit, so the holes are named instead of being silently not counted.
UNREADABLE: dict[tuple[str, str | None], str] = {
    ("euroleghe_ingest/db/database.py", "transfers_history__new"):
        "A migration's temporary table, dropped by the RENAME a few lines later.",
    ("euroleghe_ingest/db/database.py", "fvm_history__new"):
        "The same shape, for the quotation PK widening.",
    ("euroleghe_ingest/modules/export.py", None):
        "The bundle copier builds the table name and the column list at runtime from the CONTRACT, "
        "and what it names is the INTERSECTION of the two schemas - i.e. every column the destination "
        "has and the source can fill.",
}


def test_every_partial_upsert_is_on_the_declared_list():
    """The audit itself: the table's columns minus the statement's, over all 36 tables.

    A statement that stops naming a column starts emptying it in silence, and the only two places
    that ever notice are `validate` - and only if the column goes ENTIRELY empty - and an auction
    sheet.
    """
    schema = schema_columns()
    partial: dict[tuple[str, str, tuple[str, ...]], list[int]] = {}
    for site in upsert_sites():
        if site.table not in schema or site.columns is None:
            continue
        unknown = [column for column in site.columns if column not in schema[site.table]]
        assert not unknown, f"{site.module}:{site.line} names {unknown}, not columns of {site.table}"
        missing = tuple(column for column in schema[site.table] if column not in site.columns)
        if missing:
            partial.setdefault((site.module, site.table, missing), []).append(site.line)

    assert set(partial) == set(ALLOWED), (
        f"partial and not declared: {sorted(set(partial) - set(ALLOWED))} · "
        f"declared and no longer there: {sorted(set(ALLOWED) - set(partial))}")
    # ...and the same key twice is a second site hiding behind an allowed one.
    assert sum(len(lines) for lines in partial.values()) == len(ALLOWED), partial


def test_a_never_written_column_really_has_no_other_writer():
    """The basis of five of the eight entries, checked instead of believed.

    `validate.ALLOWED_EMPTY` alone would NOT be enough, and the project has the scar that proves it:
    `season_stats.clean_sheets` is allowed-empty AND derived by another module, i.e. it is exactly the
    column a REPLACE was throwing away. So the claim is also put to the source - every other INSERT
    and every UPDATE of that table.
    """
    writers = written_columns(schema_columns())
    for (module, table, missing), (basis, _reason) in ALLOWED.items():
        if basis != "never_written":
            continue
        declared = validate.ALLOWED_EMPTY.get(table, set())
        assert set(missing) <= declared, (
            f"{table}.{sorted(set(missing) - declared)} is left out by {module} and is not declared "
            f"empty in validate.ALLOWED_EMPTY: name the module that fills it, or fill it here")
        for where, columns in writers[table].items():
            if where.startswith(module):
                continue
            assert not columns & set(missing), (
                f"{where} writes {sorted(columns & set(missing))} of {table}, so the upsert in "
                f"{module} deletes it: this entry is not 'never_written' any more")


def test_the_two_same_call_refills_are_still_in_the_same_call():
    """`same_call` is an ORDER, and an order nobody asserts is an intention.

    Both are one line inside a function, which is exactly the kind of line a later refactor moves.
    """
    from euroleghe_ingest.modules import arrivals, positions

    assert "enrich(ctx)" in inspect.getsource(arrivals.run), (
        "`arrivals.run` no longer refills the tiers of the rows it has just re-created")

    calls = [line.strip() for line in inspect.getsource(positions).splitlines()
             if ("derive_roles_from_match_layer(" in line or "ingest_heatmaps_from_cache(" in line)
             and "def " not in line and not line.strip().startswith("#")]
    roles = [i for i, line in enumerate(calls) if "derive_roles_from_match_layer(" in line]
    assert roles, "the pass that deletes the sofascore rows has disappeared"
    for i in roles:
        assert i + 1 < len(calls) and "ingest_heatmaps_from_cache(" in calls[i + 1], (
            f"a caller of derive_roles_from_match_layer does not put the heatmap back: {calls[i]}")


def test_the_statements_this_reader_cannot_resolve_are_the_declared_three():
    """Two migration temp tables and the bundle copier, which builds its names at runtime.

    This is also where the reader's own limit is kept honest: a column list assembled with a `join`
    (as `stats._UPSERT` does) cannot be read either, so a future defect of that shape lands HERE
    instead of being quietly skipped - it fails this test and somebody has to decide what it is.
    """
    schema = schema_columns()
    unreadable = {(site.module, site.table if site.table not in schema else None)
                  for site in upsert_sites()
                  if site.table not in schema or site.columns is None}
    assert unreadable == set(UNREADABLE), (
        f"undeclared: {sorted(unreadable - set(UNREADABLE))} · "
        f"declared and gone: {sorted(set(UNREADABLE) - unreadable)}")


def test_the_reader_joins_adjacent_string_literals():
    """The half that makes the audit usable, and the reason the first pass had six false positives.

    Python concatenates adjacent literals, so `"...coach," " module, ..."` is ONE statement - and this
    repo writes long SQL that way. A line-by-line reader sees a column list that never closes and
    calls the statement partial, i.e. it fails on healthy code.
    """
    sites = {(site.module, site.table): site for site in upsert_sites()}
    press = sites[("euroleghe_ingest/modules/press.py", "press_formations")]
    assert press.columns is not None and {"coach", "module"} <= set(press.columns), (
        "the column list of press_formations is split across two literals and must read as one")
    availability = sites[("euroleghe_ingest/modules/fc_site.py", "availability")]
    assert availability.columns is not None and "return_basis" in availability.columns, (
        "the availability statement puts the table name and its columns in two literals")
