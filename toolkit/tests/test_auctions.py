"""The clearing price of real auctions: what gets pooled, in which units, and under which month."""

from __future__ import annotations

import csv
import inspect
import io

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import auctions

HEADER = ["asta_id", "stagione", "gioco", "listone", "squadre", "budget_iniziale",
          "slot_P", "slot_D", "slot_C", "slot_A", "id_calciatore", "calciatore", "ruolo_classic",
          "crediti_pagati", "fvm", "qt_i", "acquirente", "timestamp_italia"]


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


def _session(asta, *, teams=10, budget=1000, paid=100, listone="default", game="classic",
             slots=("3", "8", "8", "6"), day="2026-09-04", players=(101,)):
    return [dict(zip(HEADER, [asta, "2026-27", game, listone, str(teams), str(budget),
                              *slots, str(fc), f"Uomo{fc}", "A", str(paid), "200", "30",
                              "SQUADRA SEGRETA", f"{day} 21:00:00"], strict=True))
            for fc in players]


def _write(path, sessions):
    with io.open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(HEADER)
        for session in sessions:
            writer.writerows([[row[c] for c in HEADER] for row in session])
    return path


def test_the_price_is_a_share_of_the_montepremi_so_league_size_does_not_change_it():
    """The same share of the prize pool must read as the same price in every league.

    This is the whole reason the column can be pooled at all: 100 credits of a ten-squad, 1000-credit
    league and 100 of an eight-squad one are not the same money, and a table that mixed them would be
    describing two markets with one number.
    """
    sessions = [_session(f"a{i}", teams=10, budget=1000, paid=100) for i in range(5)]
    sessions += [_session(f"b{i}", teams=8, budget=500, paid=40) for i in range(5)]
    # 100 / (10 x 1000) == 40 / (8 x 500): the same share, so the same normalised price.
    measured = auctions.measure(sessions)
    (row,) = measured.values()
    assert row["price_med"] == 100.0
    assert row["price_min"] == row["price_max"] == 100.0


def test_only_our_roster_shape_and_a_real_listone_are_pooled():
    """A different shape buys a different set of men, and a hand-made listone has arbitrary prices."""
    assert auctions.eligible(_session("ok"))
    assert not auctions.eligible(_session("custom", listone="custom"))
    assert not auctions.eligible(_session("shape", slots=("6", "8", "8", "6")))
    assert not auctions.eligible(_session("tiny", teams=4))


def test_a_row_needs_enough_sessions_behind_it():
    """Under `MIN_AUCTIONS` a median is one manager's evening, so no row is written at all."""
    assert auctions.measure([_session(f"a{i}") for i in range(auctions.MIN_AUCTIONS - 1)]) == {}
    assert auctions.measure([_session(f"a{i}") for i in range(auctions.MIN_AUCTIONS)])


def test_the_month_is_the_median_award_and_not_the_first():
    """One export in fifty opened on 17 August and closed on 8 September.

    Filed on its FIRST award, three weeks of bidding land in a month that saw eight of its 250 lots.
    """
    session = _session("long", players=(101,) * 9)
    session[0]["timestamp_italia"] = "2026-08-17 22:18:00"
    for row in session[1:]:
        row["timestamp_italia"] = "2026-09-08 20:00:00"
    assert auctions._month_of(session) == "2026-09"


def test_sold_counts_only_the_reference_size_sessions():
    """`sold_of` is «out of how many auctions whose denominator means the same thing».

    A six-squad league buys 150 men of the listone instead of 250, so a name missing from it is not
    evidence that the room let him go - it is evidence about the size of the room.
    """
    sessions = [_session(f"ten{i}", teams=10) for i in range(3)]
    sessions += [_session(f"six{i}", teams=6, budget=1000, paid=60) for i in range(3)]
    (row,) = auctions.measure(sessions).values()
    assert row["auctions"] == 6
    assert (row["sold"], row["sold_of"]) == (3, 3)


def test_the_archive_drops_the_buyer_and_still_reproduces_the_measurement(tmp_path):
    """The raw export carries other people's team names; the archive must not, and `rebuild` replays
    the ARCHIVE - so what it reproduces has to be the same number to the decimal."""
    ctx = _ctx(tmp_path)
    sessions = [_session(f"a{i}", paid=90 + i) for i in range(6)]
    before = auctions.measure(sessions)
    written = auctions.archive(ctx, sessions)
    assert written and all(p.exists() for p in written)
    text = written[0].read_text(encoding="utf-8")
    assert "SQUADRA SEGRETA" not in text and "acquirente" not in text
    replayed = auctions.measure(
        [s for p in written for s in auctions._sessions_from_archive(p)])
    assert replayed == before


def test_import_writes_the_table_and_the_archive_round_trips(tmp_path):
    ctx = _ctx(tmp_path)
    ctx.conn.execute("INSERT OR IGNORE INTO players(fc_id, canonical_name) VALUES (101, 'Uomo101')")
    path = _write(tmp_path / "export.csv", [_session(f"a{i}", paid=100 + i) for i in range(6)])
    auctions.run(ctx, import_files=[str(path)])
    row = ctx.conn.execute(
        "SELECT season, platform, game, month, auctions, price_med FROM auction_prices").fetchone()
    assert tuple(row) == ("2026-27", "default", "classic", "2026-09", 6, 102.5)
    ctx.conn.execute("DELETE FROM auction_prices")
    auctions.run(ctx)                                  # the replay `rebuild` runs, offline
    assert ctx.conn.execute("SELECT COUNT(*) FROM auction_prices").fetchone()[0] == 1


def test_an_export_missing_a_column_we_read_fails_loudly(tmp_path):
    """A source that changes shape must stop the run, not write a table of zeros."""
    path = tmp_path / "short.csv"
    path.write_text("asta_id,gioco\nx,classic\n", encoding="utf-8")
    try:
        auctions.read_export(path)
    except ValueError as exc:
        assert "id_calciatore" in str(exc)
    else:                                              # pragma: no cover - the guard is the test
        raise AssertionError("a truncated export was accepted")


def test_the_dispatcher_passes_every_option_the_parser_declares():
    """Third instance of one defect in this dispatcher (`--tournament`, then `--days`): a flag the
    parser accepts and the dispatcher drops produces a wrong run that looks like a right one."""
    from euroleghe_ingest import cli
    source = inspect.getsource(cli)
    declared = 'if name == "auctions":'
    assert declared in source
    call = source.split('elif args.command == "auctions":', 1)[1].split("elif args.command")[0]
    assert "import_files=args.import_files" in call
