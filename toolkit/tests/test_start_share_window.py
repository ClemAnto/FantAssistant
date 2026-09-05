"""Le tre colonne della quota da titolare vengono dalla STESSA finestra, e non si possono piu' separare.

Nato dall'osservazione dell'operatore del 05/09/2026 su tre attaccanti in cima alla lista della
strategia: «i minuti previsti a partita da alcuni calciatori che sono nei primi posti sono molto bassi
(Thuram 39, Krstovic 36, Castro 38)». Non era un fatto sul calcio - Thuram nel 2025-26 ha giocato 29
partite, 24 da titolare, 1913 minuti - ma un difetto di FINESTRA:

    desc_season_starts    <- blended    (la miscela, 04/09/2026)
    desc_season_matches   <- blended    (la miscela)
    desc_start_share      <- season_play  <-- la sola stagione IN CORSO, due giornate

Le prime due sono una FRAZIONE e la terza e' il suo valore, quindi leggere la terza da un'altra finestra
e' un errore di unita': `minutes.per_appearance` prendeva i minuti dalla miscela e la quota da titolare
da due partite. Chi era entrato dalla panchina in quelle due leggeva 0,000 e i suoi minuti crollavano
verso la costante del subentrato (20,7' per un attaccante); chi le aveva cominciate leggeva 1,000 e i
suoi si gonfiavano. 267 righe su 602 sul foglio Serie A del 04/09, 100 a 0,000 esatto.

Il difetto e' arrivato perche' `d64ae0e` («due partite non sono una stagione») ha spostato due colonne su
tre. Questo file esiste per rendere impossibile la stessa svista: una assertion sulla SORGENTE, perche'
il difetto non e' in un valore ma in QUALE OGGETTO si legge, e nessuna asserzione su un numero lo avrebbe
visto - i tre valori erano tutti individualmente plausibili.
"""

from __future__ import annotations

import inspect
import re

from euroleghe_ingest.engine import minutes, presence
from euroleghe_ingest.modules import snapshot

#: Thuram sul foglio Serie A del 04/09/2026, le due finestre come `build_rows` le costruisce.
#: Due giornate giocate, una sola presenza e nessuna da titolare; la stagione prima, 29 partite di cui
#: 24 da titolare in 38 giornate.
THURAM_NOW = presence.SeasonWindow(appearances=1, starts=0, minutes=25, minutes_here=25, rounds=2)
THURAM_PREV = presence.SeasonWindow(appearances=29, starts=24, minutes=1913, minutes_here=1913,
                                    rounds=38)
#: La quota che la stagione in corso, da sola, dichiarava di lui.
THURAM_NOW_SHARE = 0.0


def _share(window: presence.SeasonWindow) -> float | None:
    return round(window.starts / window.appearances, 3) if window.appearances else None


def test_the_three_columns_are_read_from_one_window():
    """La sorgente: nessuna delle tre legge `season_play`, e tutte e tre nominano `blended`.

    Deliberatamente grezza, come il test che legge la sorgente del dispatcher: un `blended` scritto e non
    usato passerebbe. Prende esattamente il difetto che e' costato questa sessione - una delle tre
    lasciata indietro quando le altre due si sono spostate - e nient'altro.
    """
    source = inspect.getsource(snapshot.build_rows)
    for column in ("desc_season_starts", "desc_season_matches", "desc_start_share"):
        # Il valore assegnato alla colonna: dalla sua chiave fino alla riga della chiave successiva.
        assigned = re.search(rf'"{column}":(.*?)\n\s+(?:#|")', source, re.S)
        assert assigned, f"{column} non e' assegnata in build_rows"
        text = assigned.group(1)
        assert "blended" in text, (
            f"{column} non viene dalla miscela: le tre colonne sono una frazione e il suo valore, quindi"
            f" leggerne una da un'altra finestra e' un errore di unita' (vedi il docstring di questo file)")
        assert "season_play" not in text, (
            f"{column} legge di nuovo la sola stagione in corso: e' il difetto del 05/09/2026")


def test_the_current_season_is_still_readable_on_its_own():
    """...e non si perde niente: la meta' in corso resta dichiarata nelle sue due colonne.

    E' la condizione che rende la correzione una correzione e non una perdita di informazione: chi vuole
    sapere quante ne ha cominciate DAVVERO in questa stagione ha `desc_now_starts` su `desc_now_matches`,
    e quelle due continuano a leggere `season_play`.
    """
    source = inspect.getsource(snapshot.build_rows)
    for column in ("desc_now_starts", "desc_now_matches"):
        assigned = re.search(rf'"{column}": (.*?),\n', source)
        assert assigned and "season_play" in assigned.group(1), (
            f"{column} deve restare la META' IN CORSO dichiarata: senza di lei la miscela non e' leggibile")


def test_a_preseason_sheet_reads_exactly_the_share_it_read_before():
    """INERTE su una pre-stagione, che e' cio' che tiene ferme tutte le finestre pubblicate dal gate.

    La', `now_rounds` e' il calendario intero della stagione misurata, `prev_record` e' vuoto e la miscela
    ha una finestra sola: la quota che esce e' quella che entra, a qualunque K.
    """
    measured = presence.SeasonWindow(appearances=29, starts=24, minutes=1913, minutes_here=1913,
                                     rounds=38)
    empty = presence.SeasonWindow()
    for prior in (5.0, 10.0):
        params = presence.replace(presence.DEFAULTS, season_prior_rounds=prior)
        blended = presence.blend_seasons(now=measured, prev=empty, params=params)
        assert _share(blended) == _share(measured) == 0.828


def test_two_matches_from_the_bench_do_not_make_him_a_substitute():
    """Il caso vero: la quota della miscela sta fra le due finestre, quella di due partite e' un estremo.

    Non un numero scelto - e' l'aritmetica della miscela - ma vale la pena asserirlo, perche' e' la
    differenza fra «e' entrato due volte dalla panchina» e «non comincia mai una partita».
    """
    blended = presence.blend_seasons(now=THURAM_NOW, prev=THURAM_PREV)
    share = _share(blended)
    assert THURAM_NOW_SHARE < share < _share(THURAM_PREV)
    assert share > 0.5, "un uomo con 24 partite da titolare su 29 non e' una riserva dopo due panchine"


def test_what_the_wrong_window_cost_on_the_card():
    """E la CONSEGUENZA, perche' e' quella che l'operatore ha visto: i minuti previsti a partita.

    Stessi minuti, stesse presenze, stessa `presence_share`: cambia solo la finestra da cui viene la
    quota da titolare. Il pavimento della scala per `titolare` e' 65' (`status.MOST_OF_THE_MATCH`),
    quindi la finestra sbagliata non spostava solo un numero sulla card - spostava una parola.
    """
    blended = presence.blend_seasons(now=THURAM_NOW, prev=THURAM_PREV)
    args = ("A", blended.minutes, blended.appearances)
    rest = (0.36, 22.0 / 36.0)                     # la sua `presence_share` e la quota del motore
    with_two_matches = minutes.per_appearance(*args, THURAM_NOW_SHARE, *rest)
    with_the_blend = minutes.per_appearance(*args, _share(blended), *rest)
    assert with_the_blend - with_two_matches > 15.0
    assert with_two_matches < 45.0 < with_the_blend
