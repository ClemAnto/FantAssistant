"""Le DRITTE dell'operatore sui singoli calciatori: dichiarate, datate, revocabili, invisibili ai giudici.

Richiesta del 07/09/2026: «servirebbe qualche parte dove ti posso dare delle "dritte" che esulano dalle
statistiche... potrebbe essere utile che io ti indicassi se un certo calciatore è un titolare o una riserva
perché io ho delle conoscenze che i dati non hanno».

È la terza cosa DICHIARATA di questo progetto, con la stessa forma delle altre due (`board_rulings.json`
per il modulo di un club, `player_notes.json` per chi è fuori rosa): un file di configurazione, unito per
`fc_id`, con la data della decisione, e **invisibile ai due giudici** - una dritta si dà spesso guardando
il giudice, e un giudice non può correggere i compiti di chi lo scrive.

Tre valori e ognuno ha un effetto PRECISO, perché una dichiarazione che non si può applicare non si può
nemmeno smentire: `starter` entra nell'undici, `alternative` si vede fra i rivali di una maglia che può
indossare, `reserve` esce dai candidati (e resta disegnabile come alternativa, che è la differenza fra
«non lo schiera» e «non esiste»).
"""

from __future__ import annotations

import json

from euroleghe_ingest.gui import SnapshotView


class _View:
    """Il minimo che il lettore delle dritte tocca: un manifest e un config con il percorso."""

    _load_player_rulings = SnapshotView._load_player_rulings
    ruling_of = SnapshotView.ruling_of
    PLAYER_RULINGS = SnapshotView.PLAYER_RULINGS

    def __init__(self, config, season="2026-27"):
        self.config = config
        self.manifest = {"target_season": season}


class _Config:
    def __init__(self, path):
        self.player_rulings_path = path


def _write(tmp_path, payload):
    path = tmp_path / "player_rulings.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return _Config(path)


def test_a_ruling_is_read_for_this_sheets_season_and_joined_by_fc_id(tmp_path):
    view = _View(_write(tmp_path, {"2026-27": {"5273": {"standing": "alternative",
                                                        "decided_on": "2026-09-07"}}}))
    view._player_rulings = view._load_player_rulings()
    assert view.ruling_of({"fc_id": "5273"}) == "alternative"
    assert view.ruling_of({"fc_id": "5273.0"}) == "alternative", "il foglio scrive gli id come float"
    assert view.ruling_of({"fc_id": "9999"}) is None
    assert view.ruling_of({"fc_id": None}) is None


def test_another_seasons_ruling_does_not_apply(tmp_path):
    """Una rosa è di una stagione: una dritta dell'anno scorso non è una dritta su quest'anno."""
    view = _View(_write(tmp_path, {"2025-26": {"5273": {"standing": "starter"}}}))
    assert view._load_player_rulings() == {}


def test_a_word_nobody_can_apply_is_ignored_instead_of_interpreted(tmp_path):
    """Un file scritto a mano è una fonte come le altre, e una parola che non si sa applicare non deve
    cambiare un undici in silenzio."""
    view = _View(_write(tmp_path, {"2026-27": {
        "1": {"standing": "titolarissimo"},          # una parola del gioco, non di questo file
        "2": {"standing": "alternative"},
        "tre": {"standing": "starter"},              # una chiave che non è un fc_id
        "4": {},                                     # una riga senza dichiarazione
    }}))
    assert view._load_player_rulings() == {2: "alternative"}


def test_no_file_and_a_broken_file_are_both_silence(tmp_path):
    assert _View(_Config(tmp_path / "assente.json"))._load_player_rulings() == {}
    broken = tmp_path / "rotto.json"
    broken.write_text("{ questo non e' json", encoding="utf-8")
    assert _View(_Config(broken))._load_player_rulings() == {}


def test_the_judges_see_no_rulings_at_all(tmp_path):
    """`apply_rulings=False` è la posizione dei due giudici (`press`, `outcome`) e non deve poter
    leggere il file: la circolarità che si sta evitando è che l'operatore corregga il proprio compito."""
    view = _View(_write(tmp_path, {"2026-27": {"5273": {"standing": "starter"}}}))
    view._player_rulings = {}                       # ciò che `load_sheet(..., apply_rulings=False)` lascia
    assert view.ruling_of({"fc_id": "5273"}) is None


def test_the_three_values_are_declared_in_one_place():
    """Un quarto valore non si aggiunge senza dire cosa FA, quindi l'elenco è asserito e non implicito."""
    assert SnapshotView.PLAYER_RULINGS == ("starter", "alternative", "reserve")
