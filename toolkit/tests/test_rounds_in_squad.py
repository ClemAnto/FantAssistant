"""R26: le giornate viste sono quelle in cui era IN ROSA, e le tre cose che tengono in piedi la regola.

La prima protegge i numeri pubblicati - inerte su una pre-stagione, come le R20 - e la seconda protegge
chi c'era: una giornata passata in panchina resta sua, perche' e' una prova su di lui. La terza e' la
guardia che e' costata la prima implementazione: se di un club la fonte non ha guardato la prima
giornata, la prima riga di OGNI suo tesserato cade piu' tardi e l'intera rosa leggerebbe «arrivato
dopo» - misurato sulla stagione viva, 187 uomini su 532 prima della guardia e 15 dopo.
"""

from __future__ import annotations

from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.engine import evaluate, features

DATES = ((1, "2025-08-24"), (2, "2025-08-31"), (3, "2025-09-14"), (4, "2025-09-21"))


def _db(tmp_path, watched=True):
    """1 = c'era da agosto · 2 = arrivato alla seconda · 3 = di un club che la fonte non ha guardato."""
    conn = init_db(tmp_path / "t.db")
    for club, name in ((10, "Inter"), (20, "Como")):
        conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, 'serie_a')",
                     (club, name))
    for fc_id, club in ((1, 10), (2, 10), (3, 20)):
        conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", (fc_id, f"P{fc_id}"))
        for season in ("2024-25", "2025-26"):
            conn.execute(
                "INSERT INTO rosters(fc_id, season, fc_club_id, league, role_classic, price_initial) "
                "VALUES (?, ?, ?, 'serie_a', 'C', 20)", (fc_id, season, club))
            conn.execute("INSERT INTO listone_quotes(fc_id, season, platform, price_initial) "
                         "VALUES (?, ?, 'default', 20)", (fc_id, season))
        conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) "
                     "VALUES (?, '2024-25', 'default', 30, 6.0, 6.5)", (fc_id,))
        conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) "
                     "VALUES (?, '2025-26', 'default', 2, 6.0, 6.0)", (fc_id,))
    # LE DATE DELLE GIORNATE VENGONO DAL LIVELLO PER-PARTITA, che e' cio' che `matchday_dates` legge:
    # senza queste righe non esiste nessuna «giornata gia' giocata» e la finestra e' una pre-stagione.
    for md, date in DATES:
        conn.execute(
            "INSERT INTO external_match_stats(fc_id, match_id, season, source, competition, "
            "real_md, match_date, started, minutes) VALUES (1, ?, '2025-26', 'sofascore', "
            "'serie_a', ?, ?, 1, 90)", (f"m{md}", md, date))
    # I VOTI SONO COERENTI CON L'ARRIVO, o il test passerebbe per la ragione sbagliata: chi arriva alla
    # seconda giornata non puo' avere un voto alla prima, e se ce l'avesse sarebbe la guardia «un voto
    # riporta indietro» a escluderlo - non quella sul club, che e' cio' che il caso 3 deve provare.
    for md, date in DATES:
        for fc_id in (1, 2, 3):
            if fc_id in (2, 3) and md == 1:
                continue
            conn.execute(
                "INSERT INTO match_ratings(fc_id, season, matchday, platform, status, mv, fantavoto) "
                "VALUES (?, '2025-26', ?, 'default', 'played', 6.0, 6.0)", (fc_id, md))
    # Il livello di carriera: una riga per ogni tesserato a ogni partita del suo club. L'Inter e'
    # guardata dalla prima giornata; il Como solo dalla seconda, quindi di lui non si deduce niente.
    rosa = {10: list(range(100, 125)), 20: list(range(200, 225))}
    for filler in rosa.values():       # i comprimari esistono, o la chiave esterna rifiuta le righe
        for fc_id in filler:
            conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                         (fc_id, f"F{fc_id}"))
    for club, filler in rosa.items():
        for md, date in DATES:
            if club == 20 and (md == 1 or not watched):
                continue
            for fc_id in filler:
                conn.execute(
                    "INSERT INTO tm_appearances(fc_id, tm_game_id, played_on, season, competition, "
                    "club_id, state) VALUES (?, ?, ?, '2025-26', 'IT1', ?, 'in squad')",
                    (fc_id, f"g{club}{md}", date, str(club)))
    for md, date in DATES:
        conn.execute("INSERT INTO tm_appearances(fc_id, tm_game_id, played_on, season, competition, "
                     "club_id, state) VALUES (1, ?, ?, '2025-26', 'IT1', '10', 'in squad')",
                     (f"g10{md}", date))
        if md >= 2:   # il 2 arriva alla seconda giornata
            conn.execute("INSERT INTO tm_appearances(fc_id, tm_game_id, played_on, season, competition, "
                         "club_id, state) VALUES (2, ?, ?, '2025-26', 'IT1', '10', 'in squad')",
                         (f"g10{md}", date))
        if md >= 2:
            conn.execute("INSERT INTO tm_appearances(fc_id, tm_game_id, played_on, season, competition, "
                         "club_id, state) VALUES (3, ?, ?, '2025-26', 'IT1', '20', 'in squad')",
                         (f"g20{md}", date))
    conn.commit()
    return conn


def _mine(conn, auction_date="2025-09-05"):
    window = features.Window("W", "2024-25", "2025-26", auction_date)
    seen = features.matchdays_before(conn, "default", "2025-26", auction_date)
    return seen, features.rounds_in_squad(conn, window, "default", seen)


def test_chi_ce_da_sempre_non_compare_e_chi_arriva_dopo_ha_meno_giornate(tmp_path):
    seen, mine = _mine(_db(tmp_path))
    assert len(seen) == 2
    # Chi c'era da agosto non e' nel dizionario: il chiamante usa lo scalare, cioe' il comportamento
    # di oggi. «Nessuna prova» e «era in rosa da sempre» devono dare lo stesso numero.
    assert 1 not in mine
    assert mine[2] == 1


def test_un_club_che_la_fonte_non_ha_guardato_dallinizio_non_produce_nessun_ingresso(tmp_path):
    """La guardia che vale 187 uomini su 532: senza, l'intera rosa del Como leggerebbe «arrivato dopo»."""
    seen, mine = _mine(_db(tmp_path))
    assert 3 not in mine
    assert not any(fc >= 200 for fc in mine), "nessun tesserato del club non guardato"


def test_e_inerte_su_una_finestra_pre_stagione(tmp_path):
    """Senza giornate viste non c'e' denominatore da correggere: e' cio' che tiene fermi i numeri pubblicati."""
    conn = _db(tmp_path)
    window = features.Window("W", "2024-25", "2025-26", "2025-08-15")
    assert features.rounds_in_squad(conn, window, "default", set()) == {}


def test_la_regola_legge_il_denominatore_di_ciascuno_e_R20_quello_del_calendario(tmp_path):
    """Il numeratore non si muove: cio' che cambia e' per quante giornate gliene chiediamo conto."""
    conn = _db(tmp_path)
    window = features.Window("W", "2024-25", "2025-26", "2025-09-05")
    data = features.prepare(conn, window, "default", "classic")
    rounds = {obs.fc_id: obs.rounds_mine for obs in data.observations}
    assert rounds[1] is None and rounds[2] == 1
    assert data.matchdays_seen == 2
    # e le due griglie restano allineate, o «quale K» smetterebbe di essere lo stesso verdetto
    assert set(evaluate.R26_ROUNDS) == {f"R26K{k[4:]}" for k in evaluate.R20_ROUNDS}
    assert list(evaluate.R26_ROUNDS.values()) == list(evaluate.R20_ROUNDS.values())
