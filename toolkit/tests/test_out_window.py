"""La finestra d'infortunio aperta e la regola dell'operatore sull'undici tipo (05/09/2026).

«Nelle formazioni tipo non vanno ignorati tutti gli infortuni, solo quelli di poco conto: se ad esempio
un calciatore non puo' giocare 6 mesi, non puo' rientrare nella formazione tipo ... se un calciatore non
puo' giocare 3 mesi puo' rientrare nella formazione tipo ma con tanti dubbi e la sua percentuale deve
diminuire nettamente.»

E' una DICHIARAZIONE e cambia la definizione che il pannello portava dall'08/08/2026 - «la squadra che
schiera quando sono tutti disponibili» - quindi quello che si prova qui e' l'aritmetica e le due soglie,
non il calcio: il disegno ha il suo giudice esterno (`press --against press`).
"""

from __future__ import annotations

from euroleghe_ingest.modules import snapshot

#: Le giornate della Juventus dopo il 05/09/2026, dal calendario vero (`fixtures`): 36 fino a maggio.
JUVE = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-10-10", "2026-10-17", "2026-10-24",
        "2026-10-27", "2026-10-31", "2026-11-07", "2026-11-21", "2026-11-28", "2026-12-05",
        "2026-12-12", "2026-12-19"] + [f"2027-{month:02d}-{day:02d}"
                                       for month, day in ((1, 2), (1, 5), (1, 9), (1, 16), (1, 23),
                                                          (1, 30), (2, 6), (2, 13), (2, 20), (2, 27),
                                                          (3, 6), (3, 13), (3, 20), (4, 3), (4, 10),
                                                          (4, 17), (4, 24), (5, 1), (5, 8), (5, 15),
                                                          (5, 22), (5, 29))]


def test_a_missing_return_date_is_not_a_discount():
    """«Vuoto = ignoto»: senza una data non c'e' una quota, e il vincolo del 03/09 resta la risposta."""
    assert snapshot.out_window(None, JUVE) is None
    assert snapshot.out_window("2026-11-25", None) is None
    assert snapshot.out_window("2026-11-25", []) is None


def test_the_two_real_cases_land_on_the_two_sides_of_the_operators_rule():
    """Yildiz (rientro 25/11, tre mesi) resta e paga; Thuram (gennaio, quattro mesi) e' al limite.

    Sono i due nomi da cui la richiesta e' nata, con le date che le due fonti scrivono davvero.
    """
    assert len(JUVE) == 36                                         # il calendario vero dopo il 05/09/2026
    missed, share = snapshot.out_window("2026-11-25", JUVE)
    assert missed == 10                                            # 10 giornate della Juve prima del 25/11
    assert abs(share - 26 / 36) < 1e-9                             # 0,722: dentro, e paga un quarto
    missed, share = snapshot.out_window("2027-01-01", JUVE)
    assert missed == 14
    assert abs(share - 22 / 36) < 1e-9                             # 0,611: dentro, e paga il 39%


def test_six_months_is_out_and_three_months_is_in():
    """La soglia dichiarata separa i suoi due casi, che e' tutto quello che una soglia dichiarata fa."""
    from euroleghe_ingest.gui import SnapshotView

    _missed, three = snapshot.out_window("2026-12-05", JUVE)       # ~tre mesi
    _missed, six = snapshot.out_window("2027-03-06", JUVE)         # ~sei mesi
    assert three >= SnapshotView.BOARD_OUT_SHARE                   # «puo' rientrare, con tanti dubbi»
    assert six < SnapshotView.BOARD_OUT_SHARE                      # «non puo' rientrare»


def test_the_denominator_starts_today_and_never_from_august():
    """Le giornate GIA' GIOCATE le hanno perse tutti: contarle sconterebbe una cosa che non e' sua.

    Il verso in cui si legge e' quello che questa asserzione ha sbagliato la prima volta, ed e' il punto:
    la STESSA data di rientro, letta piu' TARDI nella stagione, da' una quota MIGLIORE - non peggiore -
    perche' la gran parte delle giornate che quel rientro costa sono ormai dietro, e non sono sue da
    perdere. Un denominatore che partisse da agosto lo pagherebbe due volte, una da infortunato e una da
    tutti gli altri.
    """
    late = JUVE[20:]                                               # come se fossimo a fine gennaio
    _missed, from_today = snapshot.out_window("2027-03-06", late)
    _missed, from_august = snapshot.out_window("2027-03-06", JUVE)
    assert from_today > from_august
    assert snapshot.out_window(late[0], late)[0] == 0              # un rientro alla prima: niente saltate


def test_the_board_pass_is_told_the_platform_calendar_instead_of_re_reading_it():
    """`write_boards` accetta le giornate della piattaforma, perche' il manifest si scrive DOPO di lui.

    Il difetto, misurato il 05/09/2026: `minutes_next` legge `manifest.matchdays.platform_target` per la
    meta' del suo `P` che viene dal MODELLO, e `snapshot` scrive il manifest DOPO la passata dei campetti.
    Su una cartella NUOVA quel numero era zero e la colonna usciva sulla sola misura; su una cartella
    RIUSATA la passata leggeva il manifest della corsa PRECEDENTE senza dirlo. Due valori per una colonna,
    decisi da se la cartella esisteva prima - Malen 74.0 col manifest e 78.0 senza, 241 righe su 602 in
    mezzo, e i tre gradini alti riordinati perche' i loro pavimenti stanno a 75' e 65' (`titolare` letto
    2 invece di 33). NON era rumore: era deterministico, e per un'ora l'ho attribuito all'ordine di
    iterazione delle stringhe perche' le due corse che confrontavo avevano cartelle di stato diverso.

    Si prova sulla FIRMA e non sul valore: un banco che rifacesse la passata avrebbe bisogno di un
    display e di un foglio, e quello che deve restare vero e' che il numero si PASSI invece di rileggerlo.
    """
    import inspect

    from euroleghe_ingest.modules import boards

    assert "matchdays" in inspect.signature(boards.write_boards).parameters
    assert "matchdays" in inspect.signature(boards.extract_boards).parameters
    # ...e che il chiamante lo passi davvero: e' il difetto del flag che il dispatcher scarta, e questo
    # repository lo ha gia' pagato due volte.
    from euroleghe_ingest.modules import snapshot

    source = inspect.getsource(snapshot)
    assert "write_boards(ctx.config, folder," in source
    assert "matchdays=float(data.matchdays_target" in source
