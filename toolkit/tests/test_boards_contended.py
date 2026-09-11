"""«Nessuno con cui fare il ballottaggio»: chi conta come contendente, e quando non lo sappiamo.

La regola vive in `engine/status.py` (dichiarata dall'operatore, 08/09/2026); qui si pinna il PREDICATO,
che e' la meta' che decide su chi scatta - e la definizione e' deliberatamente il vocabolario della scala
e non una soglia nostra, quindi un test che la fissa a un numero sarebbe il difetto che si vuole evitare.
"""

from __future__ import annotations

from euroleghe_ingest.modules import boards


class _View:
    """Un pannello finto: risponde con il gradino che il caso vuole, per `fc_id`."""

    def __init__(self, rungs: dict[int, str | None], explodes: set[int] | None = None,
                 out: set[int] | None = None):
        self.rungs = rungs
        self.explodes = explodes or set()
        self.out = out or set()

    def titolarita_status(self, row, in_eleven, contended=None):
        fid = int(row["fc_id"])
        if fid in self.explodes:
            raise RuntimeError("un rivale che non so giudicare")
        return self.rungs.get(fid)

    def out_today(self, row):
        return int(row["fc_id"]) in self.out


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


def test_a_rival_who_cannot_play_today_is_not_a_contender():
    """Il ballottaggio INDISPONIBILE della board breve spiega la maglia, non la contende.

    Dall'11/09/2026 `eleven` ne elenca uno in coda sui modi che disegnano l'undici di oggi (richiesta
    dell'operatore: «visualizza i calciatori che secondo l'algoritmo dovrebbero essere in ballottaggio ma
    sono infortunati»). Contarlo qui farebbe leggere `ballottaggio` a un uomo che la maglia se la gioca
    con nessuno - la parola cambierebbe per colpa di un uomo in infermeria.
    """
    view = _View({2: "titolare"}, out={2})
    assert boards._contended(view, _man(1), [_man(2)], set(), today=True) is False
    # ...e resta un contendente il giorno in cui rientra: e' la stessa riga, senza la marca.
    assert boards._contended(_View({2: "titolare"}), _man(1), [_man(2)], set(), today=True) is True
    # ...E SULLA BOARD DI STAGIONE NON CAMBIA NIENTE, che e' l'altra meta' della regola: la' un
    # infortunato e' un rivale a pieno titolo, perche' quella board e' «la squadra che schiera quando
    # sono tutti disponibili». Il default e' `today=False`, cioe' il caso che non deve muoversi.
    assert boards._contended(view, _man(1), [_man(2)], set()) is True


def test_an_unavailable_rival_does_not_hide_an_available_one():
    """Uno indisponibile non e' un rivale in meno per gli altri: si salta lui, non la lista."""
    view = _View({2: "titolare", 3: "ballottaggio"}, out={2})
    assert boards._contended(view, _man(1), [_man(2), _man(3)], set(), today=True) is True
