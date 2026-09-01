"""Le sei parole dentro il ruolo, e la specifica sono i SETTE NOMI che l'operatore ha dettato.

01/09/2026. Non ha dato una soglia: ha dato Malen, Dimarco e Paz N. per `oro`, Lobotka e Cristante per
`bronzo`, Dybala e Berardi per `cristallo`. Quindi il test non e' che la funzione fa quello che dice il
suo docstring - e' che mette quei sette dove li ha messi lui, con i numeri veri del foglio 2026-27.

E la meta' che vale piu' dei sette casi e' la GUARDIA SULL'ASIMMETRIA: i due assi non sono la stessa
specie di numero, e scambiarli sembra una semplificazione. Non lo e', e cade su due dei suoi esempi.
"""

from __future__ import annotations

import pytest

from euroleghe_ingest.config import Config
from euroleghe_ingest.engine import categories

# (nome, gioco, slot, quota di calendario PREVISTA, tasso bonus MISURATO, la sua parola). I numeri sono
# quelli del foglio Serie A del 26/08/2026 e dello storico letto da `season_stats` (pv >= 15).
HIS_SEVEN = [
    ("Malen", "classic", "A", 0.77, 1.33, "oro"),
    ("Dimarco", "classic", "D", 0.81, 0.58, "oro"),
    ("Paz N.", "classic", "C", 0.84, 0.74, "oro"),
    ("Cristante", "classic", "C", 0.77, 0.12, "bronzo"),
    ("Lobotka", "classic", "C", 0.72, 0.04, "bronzo"),
    ("Dybala", "classic", "A", 0.61, 1.19, "cristallo"),
    ("Berardi", "classic", "A", 0.59, 1.54, "cristallo"),
]


@pytest.mark.parametrize("name,game,slot,play,rate,expected", HIS_SEVEN)
def test_i_sette_nomi_dettati_finiscono_dove_li_ha_messi_lui(name, game, slot, play, rate, expected):
    assert categories.category_of(play, rate, categories.bars_for(game, slot)) == expected, name


def test_scambiare_i_due_assi_fa_cadere_i_suoi_stessi_esempi():
    """Perche' i due assi restano due specie diverse di numero, e nessuno li «semplifichi» piu' avanti.

    Col tasso PREVISTO invece di quello misurato Dybala legge +0,48 - sotto la mediana degli attaccanti,
    perche' il motore regredisce un tasso che scende (1,72 -> 0,91 -> 0,45) - e non e' un cristallo.
    Con le presenze MISURATE invece di quelle previste Malen ne ha 18 su 38, cioe' 0,47, e non e' un oro.
    """
    forecast_rate_dybala = 0.48
    assert categories.category_of(0.61, forecast_rate_dybala, categories.bars_for("classic", "A")) \
        == "scarto", "col tasso previsto Dybala non e' un cristallo: l'asse del bonus va misurato"
    measured_play_malen = 18 / 38
    assert categories.category_of(measured_play_malen, 1.33, categories.bars_for("classic", "A")) \
        == "cristallo", "con le presenze misurate Malen non e' un oro: l'asse del gioco va previsto"


def test_chi_nessuno_ha_misurato_e_una_scommessa_e_mai_uno_scarto():
    """«Vuoto = ignoto, mai zero», su una parola che direbbe che un ragazzo e' scarso."""
    bars = categories.bars_for("classic", "A")
    assert categories.category_of(0.90, None, bars) == "scommessa"
    assert categories.category_of(0.20, None, bars) == "scommessa"
    # ...e senza nemmeno la previsione delle presenze non c'e' parola: e' il chiamante che deve la
    # distinzione, come per la scala a sei gradini accanto.
    assert categories.category_of(None, 1.50, bars) is None
    # Uno slot che non esiste non e' uno slot senza sbarre da inventare: nessuna sbarra, nessuna misura.
    assert categories.bars_for("classic", "XX") is None
    assert categories.category_of(0.90, 1.50, None) == "scommessa"


def test_la_media_del_tratto_scarta_massimo_e_minimo_da_cinque_stagioni_in_su():
    """La convenzione dell'operatore per una media che GIUDICA: cosi' una stagione sola non decide."""
    assert categories.bonus_rate([]) is None
    assert categories.bonus_rate([2.0]) == pytest.approx(2.0)
    assert categories.bonus_rate([1.0, 0.0, 2.0, 1.0]) == pytest.approx(1.0)
    # cinque stagioni: cadono il 9.0 e lo 0.0, restano 1.0 / 1.0 / 1.0
    assert categories.bonus_rate([1.0, 1.0, 1.0, 9.0, 0.0]) == pytest.approx(1.0)
    # ...e ne legge cinque, non sei: la sesta stagione e' fuori dalla finestra, non dentro la media
    assert categories.bonus_rate([1.0, 1.0, 1.0, 1.0, 1.0, 99.0]) == pytest.approx(1.0)


def test_ogni_ruolo_del_regolamento_ha_le_sue_due_sbarre():
    """Il regolamento dichiara dodici posti tipizzati: un codice senza sbarra sarebbe una riga muta.

    Letto dal file e non trascritto qui, che e' la stessa regola con cui il progetto legge i moduli.
    """
    declared = [role.lower() for role in Config().load_modules("mantra").get("roles", [])]
    assert len(declared) == 12, declared
    missing = [role for role in declared if categories.bars_for("mantra", role) is None]
    assert not missing, f"codici mantra senza sbarra: {missing}"
    for role in ("P", "D", "C", "A"):
        assert categories.bars_for("classic", role) is not None, role


def test_su_un_foglio_mantra_chi_non_ha_un_codice_ricade_sul_ruolo_del_listone():
    """Il terzo caso di `auction_level`, ripetuto qui perche' e' lo stesso uomo.

    Il suo `engine_role_slot` e' il ruolo del listone ('A'), che e' una chiave della tabella classic e
    mai di quella mantra: senza il ripiego porterebbe una parola misurata contro nessuno.
    """
    assert categories.bars_for("mantra", "A") == categories.bars_for("classic", "A")
    assert categories.bars_for("mantra", "pc") != categories.bars_for("classic", "A")


def test_le_sbarre_sono_ordinate_e_crescono_col_ruolo():
    """Una sbarra «tanti bonus» sotto la sua «porta bonus» renderebbe `argento` una classe vuota."""
    for game, table in categories.BONUS_BARS.items():
        for role, (some, many) in table.items():
            assert some < many, f"{game}/{role}: {some} >= {many}"
    # e l'ordine fra i ruoli e' quello del calcio: un centravanti porta piu' bonus di un centrale
    assert categories.BONUS_BARS["mantra"]["pc"][1] > categories.BONUS_BARS["mantra"]["dc"][1]
    assert categories.BONUS_BARS["classic"]["A"][1] > categories.BONUS_BARS["classic"]["D"][1]
    # il portiere e' l'unico ruolo con le sbarre NEGATIVE: per lui `fm - mv` e' dominato dai gol presi
    assert categories.BONUS_BARS["classic"]["P"][1] < 0


def test_la_scala_ha_un_ordine_solo():
    assert categories.rank_of("oro") == 0
    assert categories.rank_of("scarto") == len(categories.LADDER) - 1
    assert categories.rank_of(None) is None
    assert categories.rank_of("titolare") is None, "le sei parole non sono quelle dell'altra scala"


def test_le_due_lingue_si_incontrano_su_una_lettera_e_il_caso_e_il_discriminante():
    """Rilievo della review del 02/09/2026, PUNTATO perche' non si puo' curare dentro `bars_for`.

    Il rulebook mantra scrive minuscolo (`a` = ala, `c` = centrale) e il listone maiuscolo (`A` =
    attaccante, `C` = centrocampista): la stessa lettera porta due classi diverse, e l'unica cosa che le
    separa e' il CASO. Oggi ogni chiamante rispetta il contratto, ma questo repo altrove abbassa i ruoli
    (`bench/draft/extract.py` scrive `slot.lower()`), quindi chi un giorno "normalizzasse" leggerebbe una
    parola misurata sulla classe sbagliata. Questo test non lo impedisce: lo fa incontrare.
    """
    assert categories.bars_for("mantra", "A") == categories.BONUS_BARS["classic"]["A"]
    assert categories.bars_for("mantra", "a") == categories.BONUS_BARS["mantra"]["a"]
    assert categories.bars_for("mantra", "A") != categories.bars_for("mantra", "a")
    assert categories.bars_for("mantra", "C") != categories.bars_for("mantra", "c")
    # ...e sul foglio CLASSIC il caso non decide niente, perche' li' una lingua sola parla: un ruolo
    # minuscolo risponde invece di leggere None, che era il difetto piu' piccolo dei due.
    for role in ("P", "D", "C", "A"):
        assert categories.bars_for("classic", role.lower()) == categories.BONUS_BARS["classic"][role]
    # e un codice mantra non raggiunge MAI la tabella classic da un foglio mantra
    assert categories.bars_for("mantra", "dc") == categories.BONUS_BARS["mantra"]["dc"]
    assert categories.bars_for("mantra", "zz") is None
