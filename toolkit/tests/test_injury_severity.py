"""LEGGERO O PESANTE dalla prosa della pagina indisponibili (operatore, 01/10/2026), sulle frasi vere del 01/10."""
from __future__ import annotations

import pytest

from euroleghe_ingest.modules.fc_site import parse_severity

CASES = [
    # pesanti: legamento, frattura, operazione, lungo stop, mesi, stagione finita
    ("il centrocampista KO il 7 settembre contro il Lecce in casa vittima della rottura del legamento crociato "
     "anteriore. Verrà operato e costretto a un lungo stop", "heavy"),
    ("Il centrocampista ha subito un brutto infortunio ai Mondiali riportando la rottura dei legamenti crociati "
     "del ginocchio. Stagione finita per lui.", "heavy"),
    ("L'attaccante ha riportato la frattura del quinto metatarso del piede ed è stato già operato.", "heavy"),
    ("Il brutto infortunio in amichevole vs la Roma lo costringerà a stare fuori per quasi tre mesi.", "heavy"),
    ("l'attaccante è in recupero dalla rottura del tendine d'Achille. Rientro previsto per fine novembre.", "heavy"),
    ("il metronomo del centrocampo bianconero ha rimediato la rottura del menisco esterno del ginocchio.", "heavy"),
    # leggeri
    ("Il terzino dei ciociari ai box per una lesione di basso grado del bicipite femorale", "light"),
    ("Il portiere sta curando una leggera distorsione alla caviglia, da valutare.", "light"),
    ("Il centrocampista out contro Lazio, Frosinone e Fiorentina per noie fisiche, rimane da valutare", "light"),
    ("Il giovane attaccante ha avuto un risentimento muscolare, dovrebbe tornare dopo la sosta nazionali.", "light"),
    # TRAPPOLE: la negazione spegne la parola, la fibra muscolare non e' un legamento, il silenzio resta ignoto
    ("Dagli esami non sarà necessario un intervento chirurgico ma solo un periodo riabilitativo.", None),
    ("Rottura della fibra muscolare", None),
    ("Il difensore ha riportato un infortunio muscolare alla coscia e non sarà disponibile.", None),
    ("L'attaccante sta recuperando da un infortunio al bicipite femorale. Da valutare.", None),
    (None, None),
]


@pytest.mark.parametrize(("note", "expected"), CASES)
def test_the_prose_says_light_or_heavy_and_silence_stays_unknown(note, expected):
    assert parse_severity(note) == expected


def test_a_heavy_word_beats_a_light_one():
    assert parse_severity("Un fastidio che gli esami hanno rivelato essere la rottura del crociato.") == "heavy"


def test_the_accent_can_come_in_two_forms():
    precomposed = "Verrà operato"
    decomposed = "Verrà operato"
    assert parse_severity(precomposed) == parse_severity(decomposed) == "heavy"
