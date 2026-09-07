"""«Nessuno con cui fare il ballottaggio»: chi conta come contendente, e quando non lo sappiamo.

La regola vive in `engine/status.py` (dichiarata dall'operatore, 08/09/2026); qui si pinna il PREDICATO,
che e' la meta' che decide su chi scatta - e la definizione e' deliberatamente il vocabolario della scala
e non una soglia nostra, quindi un test che la fissa a un numero sarebbe il difetto che si vuole evitare.
"""

from __future__ import annotations

from euroleghe_ingest.modules import boards


class _View:
    """Un pannello finto: risponde con il gradino che il caso vuole, per `fc_id`."""

    def __init__(self, rungs: dict[int, str | None], explodes: set[int] | None = None):
        self.rungs = rungs
        self.explodes = explodes or set()

    def titolarita_status(self, row, in_eleven, contended=None):
        fid = int(row["fc_id"])
        if fid in self.explodes:
            raise RuntimeError("un rivale che non so giudicare")
        return self.rungs.get(fid)


def _man(fid: int, roles: str = "ST") -> dict:
    return {"fc_id": fid, "desc_real_roles": roles}


def test_a_rival_the_ladder_calls_riserva_is_not_a_contender():
    """Il caso vero: Ramos G. con il solo Camarda, che la scala legge `riserva`."""
    view = _View({2: "riserva"})
    assert boards._contended(view, _man(1), [_man(2)], set()) is False


def test_a_rival_the_ladder_calls_ballottaggio_or_better_IS_a_contender():
    for rung in boards.CONTENDER_RUNGS:
        view = _View({2: rung})
        assert boards._contended(view, _man(1), [_man(2)], set()) is True, rung


def test_the_answer_is_unknown_and_never_false_when_the_duels_cannot_be_expressed():
    """Senza ruolo granulare non c'e' nessun ballottaggio che il foglio sappia dire: ignoto, mai zero."""
    view = _View({})
    assert boards._contended(view, _man(1, roles=""), [], set()) is None
    assert boards._contended(view, {"fc_id": 1}, [], set()) is None


def test_no_rivals_at_all_is_FALSE_once_we_know_his_role():
    """Vuoto e ignoto sono due cose diverse, ed e' `desc_real_roles` a separarle."""
    view = _View({})
    assert boards._contended(view, _man(1), [], set()) is False
    assert boards._contended(view, _man(1), None, set()) is False


def test_every_rival_is_asked_and_not_only_the_two_a_pitch_can_show():
    """`MAX_DUELS` e' un limite di DISEGNO: tagliare prima di chiedere promuoverebbe chi non deve."""
    rivals = [_man(2), _man(3), _man(4)]
    assert len(rivals) > boards.MAX_DUELS
    view = _View({2: "riserva", 3: "panchina", 4: "titolare"})
    assert boards._contended(view, _man(1), rivals, set()) is True


def test_a_rival_we_cannot_judge_leaves_the_answer_UNKNOWN():
    """Un gradino che esplode non e' un rivale in meno: e' una cosa che non sappiamo."""
    view = _View({2: "riserva"}, explodes={3})
    assert boards._contended(view, _man(1), [_man(2), _man(3)], set()) is None
