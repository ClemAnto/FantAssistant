"""Tests for the fc_site editorial pages: the probabili parser and its persistence.

The full record (team, formation, starter, role, status) must survive the round trip: these
fields accumulate as weekly snapshots and cannot be backfilled for a date nobody stored.
"""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import fc_site, snapshot

_PROBABILI_HTML = """
<html><body>
<div class="team-card">
  <div class="team-name">Fiorentina</div>
  <div class="team-formation">3-5-2</div>
  <ul class="player-list starters">
    <li class="player-item" data-status="ok">
      <a class="player-link" href="/squadre/fiorentina/kean/5000/2026-27">Kean</a>
      <span class="role" data-value="a"></span>
      <span class="progress-value">85%</span>
    </li>
  </ul>
  <ul class="player-list">
    <li class="player-item" data-status="doubt">
      <a class="player-link" href="/squadre/fiorentina/piccoli/5001/2026-27">Piccoli</a>
      <span class="role" data-value="a"></span>
    </li>
  </ul>
</div>
</body></html>
"""


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


def test_probabili_parser_reads_the_whole_card():
    records = fc_site.parse_probable_starters(_PROBABILI_HTML)
    assert [rec["fc_id"] for rec in records] == [5000, 5001]
    starter, bench = records
    assert (starter["team"], starter["formation"], starter["role"]) == ("Fiorentina", "3-5-2", "A")
    assert (starter["starter"], starter["probability"], starter["status"]) == (True, 0.85, "ok")
    # the bench row has no percentage but carries the hierarchy signal
    assert (bench["starter"], bench["probability"], bench["status"]) == (False, None, "doubt")


def test_probabili_upsert_stores_bench_rows_and_the_full_record(tmp_path):
    ctx = _ctx(tmp_path)
    records = fc_site.parse_probable_starters(_PROBABILI_HTML)
    stored = fc_site.upsert_probable_starters(ctx.conn, records, "2026-07-26")
    assert stored == 2, "a NULL probability must be stored, not skipped"
    rows = ctx.conn.execute(
        "SELECT fc_id, probability, team, formation, starter, role, status "
        "FROM probable_starter ORDER BY fc_id").fetchall()
    assert [tuple(row) for row in rows] == [
        (5000, 0.85, "Fiorentina", "3-5-2", 1, "A", "ok"),
        (5001, None, "Fiorentina", "3-5-2", 0, "A", "doubt"),
    ]


def test_a_reading_says_which_season_it_is_about_and_not_only_when_it_was_taken(tmp_path):
    """The page keeps serving the last round of the season that ENDED until the new one starts, and the
    day of the reading cannot tell the two apart: on 07/08/2026 the probabili fetched that morning were
    810 hrefs of `2025-26` at probability 1.0 - line-ups already played - and they were the freshest
    thing a 2026-27 sheet could find (428 of 648 Serie A rows). The season is in every href, so it is
    stored and the readers filter on it.
    """
    ctx = _ctx(tmp_path)
    old = _PROBABILI_HTML.replace("2026-27", "2025-26")
    fc_site.upsert_probable_starters(ctx.conn, fc_site.parse_probable_starters(old), "2026-08-04")
    fc_site.upsert_probable_starters(
        ctx.conn, fc_site.parse_probable_starters(_PROBABILI_HTML), "2026-08-07")
    assert {row[0] for row in ctx.conn.execute(
        "SELECT season FROM probable_starter")} == {"2025-26", "2026-27"}
    seen, day = snapshot.latest_starters(ctx.conn, "2026-08-07", "2026-27")
    assert day == "2026-08-07" and set(seen) == {5000, 5001}
    # and the trap: asked for a season the page never described, it answers nothing at all
    assert snapshot.latest_starters(ctx.conn, "2026-08-04", "2026-27") == ({}, None), (
        "the last round of the season that ended is not a forecast for the next one")


_PROBABILI_NEW_HREF = """
<html><body>
<a class="match-score" href="https://www.fantacalcio.it/serie-a/calendario/1/2026-27/inter-monza/17959">1</a>
<div class="team-card">
  <div class="team-name">Inter</div>
  <div class="team-formation">3-5-2</div>
  <ul class="player-list starters">
    <li class="player-item" data-status="success">
      <a class="player-link" href="https://www.fantacalcio.it/serie-a/squadre/inter/martinez-jo/5116">M.</a>
      <span class="role" data-value="p"></span>
      <span class="progress-value">90%</span>
    </li>
  </ul>
</div>
</body></html>
"""


def test_the_probabili_survive_the_site_dropping_the_season_from_the_href():
    """05/08/2026: the player href went from `.../{slug}/{fc_id}/{season}` to `.../{slug}/{fc_id}`, and a
    pattern that REQUIRED the season stopped matching. Measured on the cache the day it was found: 442
    records on 04/08, then ZERO every day from 05/08 to 18/08 - two weeks of a state that cannot be
    backfilled, paid for over the network and thrown away, while the log said "no player links yet".

    The season still has to come from the PAGE and never from the clock (the 07/08/2026 rule: the page
    keeps serving the last round of the season that ended). It is in every fixture link, and one page is
    one round - so `page_round` is the anchor and the href's own segment, when it is there, still wins.
    """
    assert fc_site.page_round(_PROBABILI_NEW_HREF) == (1, "2026-27")
    records = fc_site.parse_probable_starters(_PROBABILI_NEW_HREF)
    assert [rec["fc_id"] for rec in records] == [5116], "the new href shape must be read"
    assert records[0]["season"] == "2026-27", "the season comes from the page's own fixture links"

    # A page from BEFORE the change is still read exactly as it was: `rebuild` replays those files, and a
    # parser that changed its mind about them would rewrite history. Here the href says 2025-26 while the
    # fixture link says 2026-27 - the href wins, because it is the more specific statement.
    mixed = _PROBABILI_HTML.replace("2026-27", "2025-26").replace(
        "</body>",
        '<a href="https://www.fantacalcio.it/serie-a/calendario/1/2026-27/inter-monza/1"></a></body>')
    assert {rec["season"] for rec in fc_site.parse_probable_starters(mixed)} == {"2025-26"}, (
        "the href of an archived page states its own season and must keep deciding it")

    # ...and a page that says nothing at all leaves the season unknown, never today's: an unknown season
    # is filtered out by every reader, which is the safe direction.
    bare = _PROBABILI_NEW_HREF.replace("/serie-a/calendario/1/2026-27/inter-monza/17959", "/x")
    assert fc_site.parse_probable_starters(bare)[0]["season"] is None
