"""`fetch --stale`: when did we last LOOK at each dated layer.

The reader was written 10/09/2026 after a morning spent finding by hand what it prints in a second -
`club_elo` at 239 days because ClubElo's API has been answering 502 since January, the Serie A listone
three days old while the euro one was of that morning, the injury archive at its weekly boundary. What
is guarded here is the part that would rot in silence: a layer whose table or column is misspelled
reads «ignoto» for ever and nobody notices, because a freshness report is exactly the thing nobody
double-checks.
"""
from __future__ import annotations

import os
import time

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db, table_names
from euroleghe_ingest.modules import fetch


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


def test_every_declared_layer_names_a_real_table_and_column(tmp_path):
    """A typo makes a layer read «ignoto» for ever, which is the one failure a report cannot show.

    The rest of this project catches a wrong key by a suspicious ZERO; here a wrong key produces a row
    that looks exactly like «this layer has never been read», i.e. the state the report exists to
    describe. So the names are checked against the schema instead of against a run.
    """
    ctx = _ctx(tmp_path)
    tables = set(table_names(ctx.conn))
    for label, kind, where, _expected, _why in fetch.FRESHNESS:
        if kind != "db":
            continue
        table, column = where
        assert table in tables, f"{label}: no table {table!r} in the schema"
        columns = {row[1] for row in ctx.conn.execute(f"PRAGMA table_info({table})")}
        assert column in columns, f"{label}: {table} has no column {column!r}"


def test_a_layer_nobody_has_read_is_IGNOTO_and_never_fresh(tmp_path):
    """«vuoto = ignoto, mai zero», applied to a CADENCE.

    An empty layer with no date is not «up to date»: it is unknown. Reading it as fresh would make a
    machine that has never acquired anything print a clean bill of health.
    """
    rows = fetch.freshness(_ctx(tmp_path), today="2026-09-10")
    assert rows, "the reader returned nothing at all"
    assert {one["verdict"] for one in rows} == {"ignoto"}
    assert all(one["age"] is None and one["seen"] is None for one in rows)


def test_the_listone_is_read_PER_PLATFORM_and_from_the_cache(tmp_path):
    """The row that would have caught the defect this reader was born from.

    `listone_quotes` keeps the LAST read and no date, so the only thing that can answer «when» is the
    cache file - and the two platforms are two files, because the two lists disagree on 202 Qt.I and
    226 FVM. A single pooled row would have read «fresh» on the morning when half of it was two days
    old, which is exactly what happened.
    """
    ctx = _ctx(tmp_path)
    fresh = ctx.config.cache_dir / "listone_euro_2026-27.xlsx"
    old = ctx.config.cache_dir / "listone_default_2026-27.xlsx"
    fresh.write_bytes(b"x")
    old.write_bytes(b"x")
    two_days = time.time() - 2 * 86400
    os.utime(old, (two_days, two_days))

    rows = {one["label"]: one for one in fetch.freshness(ctx)}
    assert rows["listone euro"]["age"] == 0
    assert rows["listone default"]["age"] == 2
    assert rows["listone euro"]["verdict"] == "fresco"
    assert rows["listone default"]["verdict"] == "vecchio"


def test_the_age_is_counted_from_the_day_it_is_asked_about(tmp_path):
    """The report is read in the morning, so «old» is a distance from TODAY and not from a run."""
    ctx = _ctx(tmp_path)
    # The player first: `injuries.fc_id` is a foreign key, and a fixture that fights the schema is a
    # fixture testing the wrong thing.
    ctx.conn.execute("INSERT INTO players (fc_id, canonical_name) VALUES (1, 'Tizio')")
    ctx.conn.execute("INSERT INTO injuries (fc_id, start_date, observed_on) VALUES (1, ?, ?)",
                     ("2026-09-01", "2026-09-03"))
    ctx.conn.commit()
    at_seven = {one["label"]: one for one in fetch.freshness(ctx, today="2026-09-10")}
    at_eight = {one["label"]: one for one in fetch.freshness(ctx, today="2026-09-11")}
    # Seven days is the declared cadence of an archive whose unit is the week: the boundary is IN.
    assert at_seven["archivio infortuni"]["age"] == 7
    assert at_seven["archivio infortuni"]["verdict"] == "fresco"
    assert at_eight["archivio infortuni"]["verdict"] == "vecchio"


def test_every_layer_carries_the_reason_for_its_cadence():
    """A declared number without its reason is one nobody can argue with - the rule `update.DAILY`
    already obeys. Nothing here is measured, so the reason is all there is to check."""
    for label, _kind, _where, expected, why in fetch.FRESHNESS:
        assert expected > 0, f"{label}: a cadence of zero days cannot be met by anything"
        assert why.strip(), f"{label}: no reason for its cadence"


def test_the_report_says_what_it_does_NOT_cover(tmp_path, capsys):
    """A picture that looks complete and is not is the defect this report exists to prevent.

    The votes, the per-match layer and `tm_appearances` have no observation date of their own, so
    their question is COVERAGE and `--plan` is what answers it. Saying so is not decoration: without
    it, «ogni strato e' dentro la sua cadenza» reads as «everything is up to date».
    """
    fetch.print_freshness(_ctx(tmp_path), today="2026-09-10")
    out = capsys.readouterr().out
    assert "fuori da questa tabella" in out
    assert "fetch --plan" in out
