"""Tests for the flag/arrival layer: revealed penalties, editorial lists, real role, tiers."""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import arrivals, fc_site, positions

# ---------- fc_site: revealed penalty hierarchy ----------


def test_rank_takers_follows_recency():
    # newest first: B took the last two, A the three before -> B leads despite fewer attempts
    ranked = fc_site.rank_takers([(2, False), (2, False), (1, False), (1, False), (1, False)])
    assert [fc_id for fc_id, _c, _t in ranked] == [2, 1]
    assert sum(confidence for _id, confidence, _t in ranked) <= 1.0


def test_rank_takers_quarantines_a_miss():
    clean = fc_site.rank_takers([(1, False)])
    missed = fc_site.rank_takers([(1, True)])
    assert missed[0][1] < clean[0][1]
    assert missed[0][2] == "pen_missed" and clean[0][2] is None


def test_derive_revealed_hierarchy_end_to_end(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (1,'Inter','serie_a')")
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", [(10, "A"), (11, "B")])
    conn.executemany("INSERT INTO rosters(fc_id, season, fc_club_id, league) VALUES (?,?,1,'serie_a')",
                     [(10, "2024-25"), (11, "2024-25")])
    # the per-match layer supplies the dates the hierarchy is keyed on
    conn.executemany(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, real_md,"
        " match_date, minutes) VALUES (10,'2024-25','sofascore',?, 'serie_a', ?, ?, 90)",
        [("e1", 1, "2024-08-18"), ("e2", 2, "2024-08-25")])
    conn.executemany(
        "INSERT INTO match_ratings(fc_id, season, matchday, platform, team, mv, pen_scored, pen_missed)"
        " VALUES (?, '2024-25', ?, 'default', 'Inter', 6.0, ?, ?)",
        [(10, 1, 1, 0), (11, 2, 0, 1)])          # A scored in round 1, B missed in round 2
    conn.commit()

    written = fc_site.derive_revealed_hierarchy(Context(config=cfg, conn=conn))
    assert written == 3        # round 1: A · round 2: A + B
    latest = conn.execute(
        "SELECT fc_id, rank, trigger_event FROM penalty_hierarchy WHERE valid_from = '2024-08-25' "
        "ORDER BY rank").fetchall()
    assert [row[0] for row in latest] == [10, 11]        # B's miss keeps A on top
    assert {row[0]: row[2] for row in latest}[11] == "pen_missed"


# ---------- fc_site: editorial pages ----------

_PROBABILI = """
<div class="team-card"><h3 class="team-name">Inter</h3><div class="team-formation">3-5-2</div>
  <ul class="player-list starters">
    <li class="player-item" data-status="success">
      <span class="role" data-value="a"></span>
      <a class="player-name player-link" href="/serie-a/squadre/inter/thuram/6316/2025-26"><span>Thuram</span></a>
      <div class="progress-value">100%</div>
    </li>
    <li class="player-item" data-status="warn">
      <span class="role" data-value="c"></span>
      <a class="player-name player-link" href="/serie-a/squadre/inter/zielinski/2841/2025-26"><span>Zielinski</span></a>
      <div class="progress-value">45%</div>
    </li>
  </ul>
</div>
"""

_INDISPONIBILI = """
<div class="team-card"><span class="team-name">Inter</span>
  <div class="col"><header><strong class="label label-primary">Infortunati</strong></header>
    <ul class="unstyled"><li><strong class="item-name">Thuram</strong>
      <div class="item-description"><p>lesione muscolare</p></div></li></ul>
  </div>
  <div class="col"><header><strong class="label label-danger">Squalificati</strong></header>
    <ul class="unstyled"><li><strong class="item-name">Zielinski</strong></li></ul>
    <header><strong class="label label-warn">Diffidati</strong></header>
    <ul class="unstyled"><li><strong class="item-name">Barella</strong></li></ul>
  </div>
</div>
"""


def test_parse_probable_starters_reads_the_fc_id_from_the_href():
    records = fc_site.parse_probable_starters(_PROBABILI)
    assert [rec["fc_id"] for rec in records] == [6316, 2841]
    assert records[0]["probability"] == 1.0 and records[1]["probability"] == 0.45
    assert records[0]["season"] == "2025-26" and records[0]["role"] == "A"
    assert all(rec["team"] == "Inter" and rec["formation"] == "3-5-2" for rec in records)


def test_parse_unavailable_splits_the_three_lists():
    records = fc_site.parse_unavailable(_INDISPONIBILI)
    assert {(rec["name"], rec["status"]) for rec in records} == {
        ("Thuram", "injured"), ("Zielinski", "suspended"), ("Barella", "booking_risk")}
    assert next(rec["note"] for rec in records if rec["name"] == "Thuram") == "lesione muscolare"


def test_not_published_page_is_detected():
    assert not fc_site.is_published("<p>😓 Dati non ancora disponibili</p>")
    assert fc_site.is_published(_PROBABILI)


def test_availability_and_booking_risk_land_in_the_right_tables(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (1,'Inter','serie_a')")
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(1, "Thuram"), (2, "Zielinski"), (3, "Barella")])
    conn.executemany("INSERT INTO rosters(fc_id, season, fc_club_id, league) "
                     "VALUES (?, '2025-26', 1, 'serie_a')", [(1,), (2,), (3,)])
    conn.commit()

    stored, unresolved = fc_site.upsert_availability(
        conn, fc_site.parse_unavailable(_INDISPONIBILI), "2025-26", "2026-07-26")
    assert (stored, unresolved) == (3, [])
    assert dict(conn.execute("SELECT fc_id, status FROM availability")) == {1: "injured", 2: "suspended"}
    assert conn.execute("SELECT fc_id FROM flags WHERE flag='booking_risk'").fetchone()[0] == 3


# ---------- positions: real role ----------


def test_off_role_usage_direction_and_threshold(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(1, "Wingback"), (2, "Striker"), (3, "Rotated")])
    conn.executemany("INSERT INTO rosters(fc_id, season, league, role_classic) "
                     "VALUES (?, '2025-26', 'serie_a', ?)", [(1, "D"), (2, "A"), (3, "A")])
    rows = ([(1, f"a{i}", "M") for i in range(10)]      # listed D, played M -> promotion
            + [(2, f"b{i}", "M") for i in range(10)]    # listed A, played M -> demotion
            + [(3, f"c{i}", "M") for i in range(2)]     # only twice -> below the threshold
            + [(3, f"d{i}", "F") for i in range(10)])
    conn.executemany(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, position,"
        " minutes) VALUES (?, '2025-26', 'sofascore', ?, 'serie_a', ?, 90)", rows)
    conn.commit()

    positions.derive_roles_from_match_layer(Context(config=cfg, conn=conn))
    flags = dict(conn.execute("SELECT fc_id, value FROM flags WHERE flag = 'off_role_usage'"))
    assert flags[1].startswith("D->C:promotion")
    assert flags[2].startswith("A->C:demotion")
    assert 3 not in flags                                # rotation, not usage
    assert dict(conn.execute("SELECT fc_id, derived_role FROM positions")) == {1: "C", 2: "C", 3: "A"}


# ---------- arrivals: tier + foreign FM-equivalent ----------


def test_classify_tier():
    assert arrivals.classify_tier(0.95, 30, u22=False) == "T1"
    assert arrivals.classify_tier(0.95, 3, u22=False) == "T2"     # important but no usable history
    assert arrivals.classify_tier(0.95, 30, u22=True) == "T2"     # young -> the U22 path
    assert arrivals.classify_tier(0.50, 30, u22=False) == "T2"
    assert arrivals.classify_tier(0.10, 30, u22=False) == "T3"
    assert arrivals.classify_tier(None, 30, u22=False) == "T3"    # no price at all


def test_foreign_fm_equivalent_mixes_real_and_synthetic_votes(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    conn = init_db(cfg.db_path)
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'X')")
    conn.execute("INSERT INTO matchday_map(season, euro_md, league, real_md, source) "
                 "VALUES ('2024-25', 7, 'premier_league', 3, 'sofascore')")
    # round 3 is in the euro calendar (real vote 7.0 + a goal), round 4 is not (synthetic 6.0)
    conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, platform, mv) "
                 "VALUES (1, '2024-25', 7, 'euro', 7.0)")
    conn.executemany(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, real_md,"
        " minutes, goals, assists, mv_synth) VALUES (1,'2024-25','sofascore',?,'premier_league',?,"
        " 90, ?, 0, ?)",
        [("e3", 3, 1, 6.5), ("e4", 4, 0, 6.0)])
    conn.commit()

    scoring = Config().load_scoring()
    equivalents = arrivals.foreign_fm_equivalent(conn, scoring, "2024-25")
    # (7.0 + 3 goal bonus) and 6.0 -> mean 8.0; the real euro vote wins over the synthetic one
    assert equivalents[1] == (8.0, 2)
