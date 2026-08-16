"""La recenza del rientro: il canale, e le cose che deve NON fare.

Pre-registrato il 16/08/2026 e SPENTO di default - il verdetto lo da' lo sweep, non chi lo scrive.
"""

from __future__ import annotations

from dataclasses import replace

from euroleghe_ingest.engine import presence


def _inputs(**over) -> presence.Inputs:
    base = {"league_matches": 38.0, "known_injuries": True, "rounds_by_season": (4.0, 2.0, 0.0)}
    return presence.Inputs(**{**base, "minutes": 2000.0, "appearances": 25.0, **over})


ON = replace(presence.DEFAULTS, return_recency_days=90.0, return_recency_weight=0.10)


def test_nasce_spento_perche_nessuno_lo_ha_ancora_giudicato():
    """L'unico default onesto per un'ipotesi senza verdetto - come i canali dell'investimento."""
    assert presence.DEFAULTS.return_recency_weight == 0.0
    hurt = _inputs(days_since_return=1.0)
    assert presence.return_penalty(hurt) == 0.0
    assert presence.availability(hurt) == presence.availability(_inputs(days_since_return=None))


def test_toglie_di_piu_a_chi_e_tornato_ieri_che_a_chi_e_tornato_due_mesi_fa():
    ieri = presence.return_penalty(_inputs(days_since_return=0.0), ON)
    due_mesi = presence.return_penalty(_inputs(days_since_return=60.0), ON)
    assert ieri > due_mesi > 0
    assert ieri == 0.10                      # pieno il giorno del rientro


def test_fuori_dalla_finestra_non_dice_niente():
    assert presence.return_penalty(_inputs(days_since_return=90.0), ON) == 0.0
    assert presence.return_penalty(_inputs(days_since_return=400.0), ON) == 0.0


def test_chi_non_ha_un_rientro_noto_non_paga_niente():
    """«Vuoto = ignoto»: non sapere quando e' tornato non e' «e' integro da sempre», ma nemmeno una colpa."""
    assert presence.return_penalty(_inputs(days_since_return=None), ON) == 0.0


def test_si_somma_agli_infortuni_invece_di_sostituirli():
    """Sono due fatti diversi - quanto si e' fatto male e da quanto e' tornato - e valgono insieme."""
    solo_infortuni = presence.availability(_inputs(days_since_return=None), ON)
    anche_rientro = presence.availability(_inputs(days_since_return=10.0), ON)
    assert anche_rientro < solo_infortuni


def test_il_pavimento_resta_un_pavimento():
    """Una storia brutta e' uno sconto, non un verdetto: nemmeno i due insieme scendono sotto."""
    forte = replace(presence.DEFAULTS, return_recency_days=90.0, return_recency_weight=0.9)
    disastro = _inputs(rounds_by_season=(30.0, 30.0, 30.0), days_since_return=0.0)
    assert presence.availability(disastro, forte) == forte.availability_floor


def test_parla_anche_a_chi_non_ha_storia_di_infortuni_ma_e_appena_tornato():
    senza = presence.Inputs(league_matches=38.0, known_injuries=False, days_since_return=5.0)
    assert presence.availability(senza, ON) < 1.0
    assert presence.availability(replace(senza, days_since_return=None), ON) == 1.0
