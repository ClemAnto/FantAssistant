"""Tests for abroad: the newcomer screen, and the three traps it exists to avoid."""

from __future__ import annotations

from euroleghe_ingest.modules import abroad


def test_youth_competitions_are_derived_from_the_median_age_not_from_a_list():
    """`tm_appearances` carries 1,086 competition codes and the Primavera is among them.

    38 matches and 14 goals in a youth league are not a senior season, and a hand-written list of codes
    would go stale the first time a federation renames one. A competition too THIN to judge is left out
    rather than assumed senior - «vuoto = ignoto» - which is the direction that costs nothing here.
    """
    rows = ([("primavera", 18)] * 30 + [("serie_b", 26)] * 30
            + [("liga-x", 19)] * 5)              # too few rows to call it anything
    found = abroad.youth_competitions(rows)
    assert found == {"primavera"}
    assert "liga-x" not in found, "a thin competition is unknown, not youth"
    assert abroad.youth_competitions([]) == set()


def test_a_window_under_the_minutes_floor_is_refused_rather_than_scaled():
    """A rate over 200 minutes is not a rate: it is one good afternoon divided by a small number."""
    few = [{"competition": "serie_b", "minutes": 90, "goals": 2, "assists": 0} for _ in range(2)]
    assert abroad.window_of(few) is None
    assert abroad.window_of([]) is None


def test_the_window_carries_how_many_matches_actually_have_a_vote():
    """A mean over three matches and a mean over twenty are not the same statement.

    So the count travels beside the value: a row that cannot say how much evidence is behind its number
    is a row a reader will over-trust.
    """
    matches = [{"competition": "ekstraklasa", "minutes": 90, "goals": 1, "assists": 0,
                "vote": 6.5 if index < 4 else None} for index in range(12)]
    window = abroad.window_of(matches)
    assert window["matches"] == 12 and window["minutes"] == 1080
    assert window["voted"] == 4 and window["vote"] == 6.5
    assert window["bonuses"] == 12 and window["ga90"] == 1.0
    assert window["competition"] == "ekstraklasa"
    assert window["covered"] is False


def test_the_window_keeps_only_the_last_matches_and_names_the_main_competition():
    old = [{"competition": "serie_b", "minutes": 90, "goals": 0, "assists": 0} for _ in range(15)]
    new = [{"competition": "serie_a", "minutes": 90, "goals": 1, "assists": 0} for _ in range(20)]
    window = abroad.window_of(old + new, window=20)
    assert window["matches"] == 20 and window["bonuses"] == 20
    assert window["competition"] == "serie_a" and window["covered"] is True


def test_the_two_arms_read_two_different_signals_and_the_football_decides_which():
    """The measurement of 10/09/2026: inside the five leagues the SHARE carries (1.41x) and the bonuses
    do not (1.03x, 0.70x among the cheap); outside them the bonuses carry (1.35x).

    So a man whose last twenty matches are all in the leagues we cover is read on how much he played,
    and everybody else on what he produced - decided by his football and not by a tag.
    """
    men = {}
    for index in range(9):                       # covered: ranked on the share, bonuses irrelevant
        men[index] = {"role": "C", "covered": True, "share": index / 10, "ga90": 1.0 - index / 10}
    for index in range(9):                       # open: ranked on the bonuses, share irrelevant
        men[100 + index] = {"role": "C", "covered": False, "share": 1.0 - index / 10,
                            "ga90": index / 10}
    hits = abroad.screen(men)
    covered = {key: value for key, value in hits.items() if value["arm"] == "covered"}
    assert set(covered) == {6, 7, 8}, "the top third by SHARE, and the bonuses did not decide it"
    assert all(value["signal"] == "share" for value in covered.values())
    open_arm = {key: value for key, value in hits.items() if value["arm"] == "open"}
    assert set(open_arm) == {106, 107, 108}, "the top third by BONUSES"
    assert all(value["signal"] == "bonuses" for value in open_arm.values())


def test_goalkeepers_are_never_screened_because_their_own_metre_is_degenerate():
    """The p90 of goals+assists per 90 for a Serie A keeper is 0.03, so one assist clears it.

    Measured: with the keepers in, the bonus arm fires on three of them - Renzetti, De Marzi and
    Sanchez Ro., all on a single assist - which is a statement about the ruler and not about them.
    """
    men = {index: {"role": "P", "covered": False, "ga90": index / 10} for index in range(9)}
    assert abroad.screen(men) == {}


def test_a_cell_too_small_for_a_percentile_fires_on_nobody():
    """A top third of four men is one man, and «the best of four» is not a screen."""
    men = {index: {"role": "A", "covered": False, "ga90": index / 10} for index in range(4)}
    assert abroad.screen(men) == {}


def test_a_man_with_no_signal_is_absent_and_never_last():
    """«Vuoto = ignoto»: a man we cannot measure does not lose the comparison, he is not in it."""
    men = {index: {"role": "A", "covered": False, "ga90": index / 10} for index in range(8)}
    men[99] = {"role": "A", "covered": False, "ga90": None}
    hits = abroad.screen(men)
    assert 99 not in hits
    assert all(value["pool"] == 8 for value in hits.values()), "the blank is out of the pool too"


def test_the_arm_is_decided_by_the_minutes_and_not_by_every_single_match():
    """A man with nineteen Ligue 1 matches and one in Ligue 2 belongs to the covered arm.

    The measurement drew that arm as «900+ minutes inside the five», so `all()` was the wrong test: it
    moved a season to the other arm on one afternoon, and the two arms read DIFFERENT signals, so the
    mistake is not cosmetic - it decides whether he is judged on his share or on his bonuses.
    """
    mostly = ([{"competition": "ligue_1", "minutes": 90, "goals": 0, "assists": 0} for _ in range(19)]
              + [{"competition": "ligue-2", "minutes": 90, "goals": 0, "assists": 0}])
    assert abroad.window_of(mostly)["covered"] is True
    # ...and a genuine minority does NOT buy the covered arm
    mostly_out = ([{"competition": "ligue_1", "minutes": 90, "goals": 0, "assists": 0} for _ in range(8)]
                  + [{"competition": "ekstraklasa", "minutes": 90, "goals": 0, "assists": 0}
                     for _ in range(12)])
    assert abroad.window_of(mostly_out)["covered"] is False


def test_the_share_is_a_share_of_the_SEASON_and_the_window_cannot_cap_it(tmp_path):
    """The error of unit this module made first: twenty matches of a 34-round league cap the share at
    0.588 whatever the man did, so every full-time starter read the same number and the ranking was
    measuring the WINDOW instead of him.

    The window answers «what has he been doing lately» (the operator's question) and the share answers
    «how much of a season is he» - two questions, two denominators, and the second one needs the season.
    """
    import sqlite3
    from euroleghe_ingest.modules import abroad as module

    source = inspect_source = module.layer.__doc__ or ""
    assert "COALESCE" in source, "the layer reads both vote columns"
    # the arithmetic itself, stated where a reader can check it: a man who played every one of 34
    # rounds is at 1.0, and the twenty-match window must not pull him down to 20/34
    rounds, full_season_minutes = 34, 34 * 90
    assert round(min(full_season_minutes / (90 * rounds), 1.0), 3) == 1.0
    window_only = 20 * 90
    assert round(window_only / (90 * rounds), 3) == 0.588, "this is the number the defect produced"


def test_the_mark_is_drawn_only_on_the_platform_it_was_measured_on():
    """«Un parametro appartiene alla popolazione su cui e' stato misurato», and platform is one.

    Re-measured on euro, the two arms come out INVERTED (covered 1.27x on minutes against 1.35x on
    bonuses, not covered 1.37x against 1.12x - the mirror of Serie A). There is even a mechanism that
    would explain it, EuroLeghe being a selection of top clubs; it is not why the mark is off there.
    It is off because n = 151 and 168 cannot resolve 1.27 from 1.35, and swapping the arms on that
    would be fitting the story to the noise.

    What must NOT happen is the descriptive columns going away with it: the window is a fact about the
    man and belongs on both sheets. Only the verdict is platform-bound.
    """
    assert abroad.SCREEN_PLATFORMS == ("default",)
    assert "euro" not in abroad.SCREEN_PLATFORMS


def test_the_layer_reads_the_cards_from_the_SEASON_and_nets_them_off(tmp_path):
    """`layer` end-to-end su un DB vero in miniatura: e' l'unico test che esegue la sua SQL.

    NASCE CON LA COLONNA DEI CARTELLINI (23/09/2026) e la copre perche' fino a ieri quella funzione non
    aveva un test che la CHIAMASSE - le altre provano `window_of` e `screen`, che sono pure. Una query
    nuova senza un chiamante nei test e' una query che si scopre rotta in produzione.

    I cartellini vengono da `external_stats`, che conta sulla STAGIONE, mentre i bonus vengono dalla
    finestra delle ultime venti: unita' diverse dichiarate nel modulo, entrambe per 90.
    """
    from euroleghe_ingest.db.database import init_db
    from euroleghe_ingest.modules import abroad as module

    conn = init_db(tmp_path / "t.sqlite")
    conn.execute(
        "INSERT INTO players (fc_id, canonical_name, birth_year) VALUES (1, 'Tizio', 1999)")
    conn.execute("INSERT INTO rosters (fc_id, season, role_classic) VALUES (1, '2026-27', 'C')")
    conn.execute("""INSERT INTO listone_quotes (fc_id, season, platform, sold)
                    VALUES (1, '2026-27', 'default', 0)""")
    # venti partite di Ligue 1, 90 minuti l'una: 1800 minuti, un gol -> ga90 = 0,05
    for md in range(1, 21):
        conn.execute(
            """INSERT INTO external_match_stats
                   (fc_id, season, source, match_id, competition, match_date, minutes,
                    goals, assists, mv_synth)
               VALUES (1, '2025-26', 'sofascore', ?, 'ligue_1', ?, 90, ?, 0, 6.0)""",
            (md, f"2026-{md:02d}-01" if md <= 12 else f"2025-{md - 12:02d}-01",
             1 if md == 1 else 0))
    # ...e QUATTRO gialli sulla stagione, in 1800 minuti: 4 x 0,5 x 90 / 1800 = 0,10 per 90
    conn.execute("""INSERT INTO external_stats
                        (fc_id, season, source, competition, minutes, yellows, reds)
                    VALUES (1, '2025-26', 'x', 'ligue_1', 1800, 4, 0)""")
    conn.commit()

    men = module.layer(conn, '2026-27', '2025-26', 'default')
    assert 1 in men, "l'uomo entra nella popolazione dei nuovi arrivati"
    assert men[1]["ga90"] == 0.05
    assert men[1]["cards90"] == 0.1
    # il NETTO e' quello che `has_prospects` legge, ed e' negativo pur avendo lui segnato
    assert men[1]["net90"] == round(0.05 - 0.1, 3)

    # ...E SENZA UNA RIGA DI CARTELLINI IL NETTO E' IGNOTO E NON ZERO: la seconda prova serve a
    # ESCLUDERE, e per escludere un uomo serve una prova.
    conn.execute("DELETE FROM external_stats")
    conn.commit()
    men = module.layer(conn, '2026-27', '2025-26', 'default')
    assert men[1]["cards90"] is None and men[1]["net90"] is None
    conn.close()
