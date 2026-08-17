"""Tests for the `zeros` harness: WHICH replacement level makes the auction list better.

What is worth asserting here is the defect the harness produced on its first run and the one it exists to
avoid. It read −66% on ten windows out of ten and was measuring nothing: a surplus counted from a higher
zero is smaller BY CONSTRUCTION, so the two totals were in two different units. The comparable figure is a
QUOTA — how much of the perfect list, scored with the same zero, the predicted list captured — plus the
names, which never had a unit. A regression on that is a regression on the whole point.
"""

from __future__ import annotations

from euroleghe_ingest.modules import zeros


def _view(captured: float, perfect: float, hits: int) -> dict:
    """An `auction_view` block reduced to what `_totals` reads."""
    return {"P": {"captured_value": captured, "perfect_value": perfect, "hits": hits, "predicted": []}}


def test_the_comparison_is_a_quota_and_not_a_sum_of_surpluses():
    """Two zeros, the same list: the raw totals differ by the unit, the efficiency does not."""
    roster = zeros._totals(_view(1000.0, 1500.0, 18))
    # Lo stesso ordine di nomi, contato da uno zero piu' alto: entrambi i numeri si rimpiccioliscono.
    fielded = zeros._totals(_view(300.0, 450.0, 18))
    assert roster["captured"] > fielded["captured"], "il grezzo cala per costruzione: e' il difetto"
    # ...e la quota resta la stessa, che e' esattamente quello che «nessuna differenza» deve leggere.
    assert roster["efficiency"] == fielded["efficiency"]


def test_efficiency_is_captured_over_perfect_and_a_missing_perfect_is_not_a_division():
    assert zeros._totals(_view(300.0, 600.0, 5))["efficiency"] == 0.5
    # Nessuna lista perfetta (una finestra senza esito): quota 0 e non un errore di divisione.
    assert zeros._totals(_view(0.0, 0.0, 0))["efficiency"] == 0.0


def test_the_verdict_needs_the_names_too_and_not_only_the_quota():
    """La guardia sui NOMI decide quando le due si dividono: la stessa regola di R19 e R20."""
    block = {"windows": {
        "A": {"efficiency_delta": 0.01, "roster": {"hits": 10}, "fielded": {"hits": 7}},
        "B": {"efficiency_delta": 0.01, "roster": {"hits": 10}, "fielded": {"hits": 8}},
    }}
    deltas = [one["efficiency_delta"] for one in block["windows"].values()]
    gained = sum(one["fielded"]["hits"] - one["roster"]["hits"] for one in block["windows"].values())
    adopt = (bool(deltas) and sum(1 for one in deltas if one >= 0) * 2 >= len(deltas)
             and min(deltas) > -zeros.MAX_WINDOW_LOSS and gained >= 0)
    assert not adopt, "la quota migliora su tutte e due, ma cinque nomi giusti in meno la bocciano"


def test_the_fielded_window_swaps_BOTH_levels_or_it_compares_two_metres():
    """Il livello di scoring va spostato con quello di previsione, o il confronto e' truccato.

    Non serve un DB: si controlla che la funzione rifiuti di rispondere quando non ha regolamento o lega,
    che e' il caso in cui l'unico esito onesto e' «niente da confrontare» invece di una vista a meta'.
    """
    assert zeros.fielded_data(None, None, "classic", None, None) is None
    assert zeros.fielded_data(None, None, "classic", {"teams": 10}, {}) is None
