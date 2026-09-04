"""La DATA DI RIENTRO letta dalla prosa degli indisponibili (04/09/2026).

Puro e offline: la funzione prende una riga di testo e il giorno in cui la pagina e' stata letta, e
restituisce una data o niente. I casi sono presi VERBATIM dalla pagina del 03/09/2026 in cache -
inventarne di piu' facili proverebbe che il parser legge le frasi che gli abbiamo scritto noi.

Le tre trappole hanno un test ciascuna, perche' sono la ragione per cui la regola e' stretta: sulla
stessa pagina un'ancora di mese sta anche sull'INIZIO dell'assenza, sul giorno dell'OPERAZIONE e su
quello di un CONTROLLO medico, e nessuno dei tre e' un rientro.
"""

import datetime as dt
import unicodedata

from euroleghe_ingest.modules import fc_site

READ_ON = "2026-09-03"


def test_le_tre_forme_di_una_parte_di_mese():
    # «inizio» = 5, «meta'» = 15, «fine» = 25: i punti medi dei tre terzi del mese, dichiarati in
    # `MONTH_PART_DAY`. Il punto medio e non il primo giorno, perche' «inizio ottobre» e' una banda.
    assert fc_site.parse_return("Rientro in campo da inizio ottobre.", READ_ON) == (
        "2026-10-05", "month_part")
    assert fc_site.parse_return(
        "sta recuperando lentamente, ipotizziamo possa tornare arruolabile da metà novembre.",
        READ_ON) == ("2026-11-15", "month_part")
    assert fc_site.parse_return("recuperabile dalla fine di settembre.", READ_ON) == (
        "2026-09-25", "month_part")


def test_le_due_forme_della_a_accentata_leggono_la_stessa_frase():
    """La «a» accentata si scrive in due modi, e per una regex sono stringhe diverse.

    Non e' un caso di scuola: la pagina vera usa la forma PRECOMPOSTA e questo file, scritto a mano,
    aveva prodotto quella DECOMPOSTA - stessa frase, un parser che ne leggeva una e non l'altra. Da
    qui la normalizzazione in `parse_return`, e questo passo la tiene: sopra c'e' la forma composta,
    qui quella decomposta, e devono dare la stessa data.
    """
    frase = "tornare arruolabile da metà novembre."
    composta = unicodedata.normalize("NFC", frase)
    decomposta = unicodedata.normalize("NFD", frase)
    assert composta != decomposta
    assert fc_site.parse_return(composta, READ_ON) == ("2026-11-15", "month_part")
    assert fc_site.parse_return(decomposta, READ_ON) == ("2026-11-15", "month_part")


def test_le_meta_di_un_mese():
    assert fc_site.parse_return(
        "recuperabile dalla seconda metà di settembre.", READ_ON) == ("2026-09-23", "month_part")
    assert fc_site.parse_return(
        "può tornare arruolabile dalla prima metà di settembre.", READ_ON) == (
        "2026-09-08", "month_part")


def test_l_anno_lo_decide_il_giorno_della_lettura():
    # La frase nomina un mese e mai un anno: «gennaio» letto a settembre e' l'anno prossimo.
    assert fc_site.parse_return("rientro da inizio gennaio.", READ_ON)[0] == "2027-01-05"
    assert fc_site.parse_return("rientro da inizio settembre.", READ_ON)[0] == "2026-09-05"
    # ...e la stessa frase letta l'anno dopo scala di un anno, senza che nessuno tocchi niente.
    assert fc_site.parse_return("rientro da inizio gennaio.", "2027-02-01")[0] == "2028-01-05"


def test_l_inizio_dell_assenza_non_e_un_rientro():
    # Cabal, 03/09/2026: il primo «da inizio settembre» dice da quando E' FUORI. Un lettore piu'
    # largo lo avrebbe filato come «rientra a inizio settembre», cioe' l'opposto della pagina.
    note = ("il difensore ai box da inizio settembre per una lesione di basso grado del muscolo "
            "semimembranoso della coscia sinistra, recuperabile dalla seconda metà di settembre.")
    assert fc_site.parse_return(note, READ_ON) == ("2026-09-23", "month_part")


def test_il_giorno_dell_operazione_non_e_un_rientro():
    # Hien, 03/09/2026: «operato a fine giugno» - con «a» e non «da», e senza un verbo di rientro.
    note = ("il difensore operato a fine giugno per una lesione del tendine prossimale del muscolo "
            "semimembranoso della coscia sinistra, in recupero e pronto a tornare in campo "
            "dall'inizio di ottobre.")
    assert fc_site.parse_return(note, READ_ON) == ("2026-10-05", "month_part")


def test_il_giorno_di_un_controllo_medico_non_e_un_rientro():
    # Ekhator, 03/09/2026: «a meta' settembre verra' sottoposto a nuovi esami» non e' un rientro, e
    # senza la frase di rientro piu' avanti questa riga non deve produrre nessuna data.
    note = ("l'attaccante vittima di una lesione di medio grado del muscolo semitendinoso, a "
            "metà settembre verrà sottoposto a nuovi esami medici per stabilire i tempi di recupero.")
    assert fc_site.parse_return(note, READ_ON) == (None, None)


def test_una_durata_non_diventa_una_data():
    # «stop di almeno due mesi» e' contato dall'infortunio, e l'infortunio la prosa non sempre lo
    # data: una durata ancorata a un giorno che non sappiamo e' il modo in cui si inventa una data.
    note = "Tempi di recupero da valutare, ma rischia uno stop di almeno due mesi."
    assert fc_site.parse_return(note, READ_ON) == (None, None)


def test_stagione_finita_e_un_fatto_senza_una_data():
    # La frase piu' decisiva che la pagina possa portare, e non nomina nessun mese: il FATTO viaggia
    # e la data resta vuota, invece di essere inventata come un'ultima giornata che nessuno ha letto.
    date, basis = fc_site.parse_return(
        "Il centrocampista ha subito un brutto infortunio riportando la rottura dei legamenti "
        "crociati del ginocchio. Stagione finita per lui.", READ_ON)
    assert basis == "season_over"
    assert date is None


def test_una_riga_che_non_dice_niente_non_dice_niente():
    assert fc_site.parse_return(None, READ_ON) == (None, None)
    assert fc_site.parse_return("", READ_ON) == (None, None)
    assert fc_site.parse_return(
        "il centrocampista non al meglio per noie fisiche, forfait per domenica. Da valutare.",
        READ_ON) == (None, None)


def test_il_da_dentro_una_parola_non_fa_scattare_la_frase():
    # Senza un confine di parola, il «da» dentro «seconDA» basterebbe: la data uscirebbe da mezza
    # parola. Qui non c'e' nessun «da» che governi l'ancora, quindi non c'e' nessuna data.
    assert fc_site.parse_return(
        "il difensore alla seconda ricaduta di settembre, tempi da valutare.", READ_ON) == (None, None)


def test_le_convenzioni_sono_dichiarate_e_dentro_il_mese():
    # Una convenzione che uscisse dal mese darebbe una data di un mese diverso da quello nominato.
    for part, day in fc_site.MONTH_PART_DAY.items():
        assert 1 <= day <= 28, part


def test_la_pagina_vera_produce_le_date_che_ci_aspettiamo():
    """Il parser sulla pagina in cache: gli infortunati veri, le loro frasi vere.

    Ancorato ai NUMERI misurati prima di scriverlo (23 su 45), perche' un parser che smette di
    trovare le frasi legge «nessun problema» dopo aver guardato niente - lo stesso difetto per cui
    `parse_unavailable` ha un test sul conteggio dei nodi.
    """
    from pathlib import Path

    page = Path(__file__).resolve().parents[2] / "data" / "cache" / "fc_site_indisponibili_2026-09-03.html"
    if not page.exists():
        return  # la cache non e' in git: dove non c'e', il test non ha niente da dire
    records = fc_site.parse_unavailable(page.read_text(encoding="utf-8", errors="replace"))
    dated = {rec["name"]: fc_site.parse_return(rec["note"], READ_ON) for rec in records}
    found = {name: value for name, value in dated.items() if value[1]}
    assert len(records) == 45
    assert len(found) == 23
    # Tre nomi che l'operatore ha nominato quel giorno, con la data che la pagina dice di loro.
    assert found["McTominay"] == ("2026-10-05", "month_part")
    assert found["Yildiz"] == ("2026-11-25", "month_part")
    assert found["Buongiorno"] == ("2026-11-15", "month_part")
    # ...e ogni data e' nel futuro rispetto alla lettura, che e' quello che «rientro» vuol dire.
    for name, (date, _basis) in found.items():
        assert date is None or dt.date.fromisoformat(date) >= dt.date.fromisoformat(READ_ON), name
