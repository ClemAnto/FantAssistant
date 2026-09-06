"""SWING vive nell'app e gioca sulla SCALA DEI GOL di questa lega: il test lega le due copie.

`app/src/app/core/swing.ts` converte i fantapunti in GOL DI CLASSIFICA, e per farlo trascrive il
pavimento e il gradino che `bench/auction/rules.py` gioca. Copiarli e' legittimo - l'app non puo'
importare Python - RICOPIARLI e lasciarli divergere no: un gradino diverso di qua e di la' darebbe
allo stesso uomo due valutazioni, e la prima volta che qualcuno se ne accorge e' a un tavolo.

IL FILE E' DIMAGRITO IL 06/09/2026 e questo test con lui: portava anche `HOLE_COST` e `rules.FIELDED`,
perche' SWING sommava un termine di COPERTURA. Un giudice fuori campione (quattro rose costruite col
foglio retrodatato al 5 settembre 2025 e giocate sulle giornate vere) ha misurato che quel termine
COSTA in una graduatoria - peso 0 rende 63,0 punti e il 78% dei titoli, peso 1 ne rende 35,8 - e la
copertura e' tornata dove era stata misurata, cioe' dentro l'offerta. Le due costanti non sono piu'
nell'app, quindi non c'e' piu' niente da legare: e' un'asserzione tolta perche' il fatto e' sparito,
non perche' desse fastidio.

Il test sta QUI e non nell'app per una ragione meccanica: il costruttore di test di Angular non ha i
tipi di Node, quindi uno spec non puo' aprire un file. E' la stessa forma - e la stessa ragione - del
test che lega la scala di Fpi al sorgente dell'app (`test_engine_projection.py`).
"""
from __future__ import annotations

import pathlib
import re

import pytest

from bench.auction import rules


def _swing_source() -> str:
    shipped = (pathlib.Path(__file__).resolve().parents[2]
               / "app" / "src" / "app" / "core" / "swing.ts")
    if not shipped.exists():                        # un checkout del solo toolkit e' legittimo
        pytest.skip("l'app non e' in questo albero")
    return shipped.read_text(encoding="utf-8")


def test_la_scala_dei_gol_e_quella_del_regolamento():
    """Il pavimento e il gradino sono il REGOLAMENTO della lega, non una misura: qui si controlla solo
    che l'app li scriva come il banco li gioca, perche' un gradino diverso cambia ogni numero."""
    source = _swing_source()
    floor = re.search(r"export const LADDER_FLOOR = (\d+);", source)
    rung = re.search(r"export const LADDER_RUNG = (\d+);", source)
    assert floor and rung, "la scala non si legge piu' nel sorgente dell'app"
    assert (int(floor.group(1)), int(rung.group(1))) == (rules.GOAL_FLOOR, rules.GOAL_STEP)
