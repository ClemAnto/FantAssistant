"""Test the arrivals roster-diff classification."""

from __future__ import annotations

import pytest

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import arrivals


def test_no_foreign_equivalent_for_a_keeper_whose_goals_conceded_we_do_not_have(tmp_path):
    """The outfield formula has no goals-conceded term, so on a keeper it is inflated by about a goal a
    game (measured: +0.82 to +1.22, 0% within 0.3). A keeper gets his own arithmetic instead - and where
    the goals conceded do not exist in any source he still gets NOTHING, which is this fixture: per-match
    rows but no league aggregate, i.e. exactly the Serie B case that opened gate §7-nonies."""
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euroleghe.db")
    (tmp_path / "data").mkdir()
    conn = init_db(cfg.db_path)
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(1, "Keeper"), (2, "Striker")])
    conn.executemany("INSERT INTO rosters(fc_id, season, roles, role_classic, league) "
                     "VALUES (?, '2024-25', ?, ?, 'serie_a')",
                     [(1, "por", "P"), (2, "pc", "A")])
    conn.executemany(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, real_md, "
        "minutes, position, goals, assists, mv_synth) VALUES (?, '2024-25', 'sofascore', ?, "
        "'serie_a', ?, 90, ?, 0, 0, 6.0)",
        [(1, "k1", 1, "G"), (1, "k2", 2, "G"), (2, "s1", 1, "F"), (2, "s2", 2, "F")])
    conn.commit()

    equivalents = arrivals.foreign_fm_equivalent(conn, cfg.load_scoring("serie_a"), "2024-25")
    assert 1 not in equivalents, "no goals conceded anywhere -> no number, not an inflated one"
    assert equivalents[2][0] == pytest.approx(6.0)      # the outfielder still gets one


def test_a_keeper_is_priced_from_his_goals_conceded(tmp_path):
    """Gate §7-decies: `fantavoto = mv - goals_conceded + 3*pen_saved - cards`, exact on 16,017 of our
    own keeper rows and with NO clean-sheet bonus. So the equivalent is his base voto minus his season
    rate of goals conceded, read on the same COMPETITION that supplies the appearances - and the outfield
    formula, which would ignore the malus entirely, must not be what prices him."""
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euroleghe.db")
    (tmp_path / "data").mkdir()
    conn = init_db(cfg.db_path)
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'Keeper')")
    conn.execute("INSERT INTO rosters(fc_id, season, roles, role_classic, league) "
                 "VALUES (1, '2024-25', 'por', 'P', 'bundesliga')")
    conn.executemany(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, competition, real_md, "
        "minutes, position, goals, assists, mv_synth) VALUES (1, '2024-25', 'sofascore', ?, ?, ?, "
        "90, 'G', 0, 0, ?)",
        [("k1", "bundesliga", 1, 6.0), ("k2", "bundesliga", 2, 6.5),
         # a cup match, which the aggregate does not count: it must not enter the average either, or
         # numerator and denominator stop being the same competition
         ("k3", "dfb-pokal", None, 7.5)])
    conn.execute("INSERT INTO external_stats(fc_id, season, source, competition, matches, "
                 "goals_conceded, saves, yellows, reds) "
                 "VALUES (1, '2024-25', 'sofascore', 'bundesliga', 2, 3, 7, 2, 0)")
    conn.commit()

    equivalents = arrivals.foreign_fm_equivalent(conn, cfg.load_scoring("bundesliga"), "2024-25")
    # (6.0 + 6.5)/2 - 1.0 * 3/2 - 0.5 * 2/2 = 6.25 - 1.5 - 0.5
    assert equivalents[1][0] == pytest.approx(4.25)
    assert equivalents[1][1] == 2, "the match count travels with it, so nobody reads a window as a season"


def test_arrivals_classification(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euroleghe.db")
    (tmp_path / "data").mkdir()
    conn = init_db(cfg.db_path)
    conn.executemany("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, ?)",
                     [(1, "Inter", "serie_a"), (2, "Milan", "serie_a"), (3, "Bayern", "bundesliga")])
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(1, "P1"), (2, "P2"), (3, "P3")])
    conn.executemany("INSERT INTO rosters(fc_id, season, fc_club_id, league) VALUES (?, ?, ?, ?)", [
        (1, "2023-24", 1, "serie_a"),      # P1 at Inter
        (2, "2023-24", 3, "bundesliga"),   # P2 at Bayern
        (1, "2024-25", 2, "serie_a"),      # P1 -> Milan (same league)
        (2, "2024-25", 1, "serie_a"),      # P2 -> Inter (league change)
        (3, "2024-25", 1, "serie_a"),      # P3 new to the perimeter
    ])
    conn.commit()

    arrivals.run(Context(config=cfg, conn=conn))
    got = {fc_id: (typ, origin) for fc_id, typ, origin in conn.execute(
        "SELECT fc_id, type, origin_club FROM arrivals WHERE season = '2024-25'")}
    assert got[1] == ("transfer_intra_league", "Inter")
    assert got[2] == ("transfer_cross_league", "Bayern")
    assert got[3] == ("new", None)
    # a player who stayed put produces no arrival row
    assert 1 not in {r[0] for r in conn.execute("SELECT fc_id FROM arrivals WHERE season='2023-24'")}
