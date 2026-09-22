"""Le SETTE parole dentro il ruolo: i verdetti dell'operatore sono la specifica.

I quindici casi di `test_i_verdetti_dettati_finiscono_dove_li_ha_messi_lui` sono nomi che lui ha
etichettato a voce il 22/09/2026, coi numeri che il foglio Serie A di quel giorno portava. Non sono
esempi scelti per far passare il codice: il codice e' stato tarato su di loro, e se uno cade e' una
cosa da ridiscutere con lui e non un test da aggiornare.
"""
import pytest

from euroleghe_ingest.engine import categories as cat


# (nome, ruolo, livello ri-miscelato, quota di calendario, ha una stagione precedente, la sua parola)
DETTATI = [
    # SUPER TOP: fuori scala nel ruolo E gioca. Sei uomini, due per ruolo.
    ("Malen", "A", 8.487, 0.79, True, "super"),
    ("Martinez L.", "A", 7.873, 0.74, True, "super"),   # il piu' BASSO per presenze che entra
    ("Paz N.", "C", 6.867, 0.85, True, "super"),
    ("Dimarco", "D", 6.764, 0.83, True, "super"),
    ("Bremer", "D", 6.521, 0.78, True, "super"),
    ("Svilar", "P", 5.329, 0.90, True, "super"),        # un portiere PUO' essere supertop (sua parola)
    # TOP: il meglio del ruolo, oppure fuori scala ma troppo fragile per giocare.
    ("De Bruyne", "C", 6.800, 0.70, True, "top"),          # «fragile, non puo' darti tante presenze»
    ("Calhanoglu", "C", 6.987, 0.60, True, "top"),         # 1o centrocampista del listone, gioca 0.60
    ("Rabiot", "C", 6.692, 0.79, True, "top"),
    ("Hojlund", "A", 7.105, 0.86, True, "top"),
    # SEMITOP, BUONO, TAPPABUCHI.
    ("Scamacca", "A", 6.982, 0.718, True, "semi"),  # 0,718 e non 0,72: vedi sotto
    ("Kvernadze", "A", 6.911, 0.77, False, "solido"),
    ("Varela G.", "A", 6.878, 0.54, False, "solido"),        # gioca poco e resta `solido`: sua decisione
    ("Pinamonti", "A", 6.528, 0.72, True, "riserva"),   # stessa FMa di Varela sul foglio, parola diversa
    ("Douglas Luiz", "C", 6.049, 0.74, False, "riserva"),  # gioca: chi gioca non e' mai uno `scarto`
]


@pytest.mark.parametrize("name, role, level, play, history, expected", DETTATI)
def test_i_verdetti_dettati_finiscono_dove_li_ha_messi_lui(name, role, level, play, history,
                                                           expected):
    got = cat.category_of(play, level, cat.bars_for("default", role), history=history, seen=True)
    assert got == expected, name


def test_la_sbarra_delle_presenze_sta_fra_i_suoi_due_casi():
    """De Bruyne FUORI a 0,70 e Martinez DENTRO a 0,74: la sbarra e' un intervallo che lui ha chiuso.

    Non e' un test sul valore (0,72 si puo' spostare dentro la banda) ma sui due casi che la fissano,
    che e' la cosa che non deve cambiare senza risentire lui.
    """
    assert 0.70 < cat.PLAYS_ALWAYS <= 0.74
    fuori_scala = cat.LEVEL_BARS["default"]["C"][3] + 0.1
    assert cat.category_of(0.70, fuori_scala, cat.bars_for("default", "C")) == "top"
    assert cat.category_of(0.74, fuori_scala, cat.bars_for("default", "C")) == "super"


def test_chi_non_gioca_abbastanza_e_uno_scarto_ma_chi_gioca_non_lo_e_mai():
    """«Chi gioca non e' mai uno scarto» (sua risposta su Douglas Luiz, 18o percentile e 0,74)."""
    infimo = cat.LEVEL_BARS["default"]["C"][0] - 2.0
    assert cat.category_of(0.74, infimo, cat.bars_for("default", "C")) == "riserva"
    assert cat.category_of(0.49, infimo, cat.bars_for("default", "C")) == "scarto"


def test_chi_non_ha_un_livello_e_una_incognita_e_mai_uno_scarto():
    """«Vuoto = ignoto, mai zero» sulla parola: i due dicono il contrario l'uno dell'altro."""
    assert cat.category_of(0.80, None, cat.bars_for("default", "A")) == "scommessa"
    assert cat.category_of(0.80, 7.0, None) == "scommessa"
    # ...e senza nemmeno la previsione di presenze non c'e' parola, che e' un terzo stato ancora.
    assert cat.category_of(None, 7.0, cat.bars_for("default", "A")) is None


def test_senza_STORICO_non_si_sale_sopra_solido():
    """Sua regola del 22/09/2026 (sera): «Osmajic e Romero D. non possono essere SEMITOP perche'
    hanno uno storico poco definito».

    I due leggevano 6,996 - il PLATEAU dell'ancora di ruolo, che il motore serve come `core` a
    confidenza piena quando non ha una fantamedia precedente da regredire - appena sopra la sbarra
    `semi` di 6,97. Il tetto e' consistente con tutti e quindici i verdetti precedenti: chi sta da
    `semi` in su ha lo storico, e i tre che non ce l'hanno (Kvernadze, Varela, Douglas Luiz) stanno a
    `solido` o sotto.
    """
    bars = cat.bars_for("default", "A")
    fuori_scala = bars[3] + 1.0
    assert cat.category_of(0.90, fuori_scala, bars, history=False, seen=True) == "solido"
    assert cat.category_of(0.56, 6.996, bars, history=False, seen=True) == "solido"   # Romero D.
    # ...ma NON e' una `scommessa`: il calcio di quest'anno ce l'ha e si vede
    assert cat.category_of(0.56, 6.996, bars, history=False, seen=True) != "scommessa"
    # ...e con lo storico quello stesso livello sale
    assert cat.category_of(0.90, fuori_scala, bars, history=True, seen=True) == "super"


def test_semi_vuole_le_PRESENZE_e_non_solo_il_livello():
    """«Adams C. non puo' essere un SEMITOP perche' ha troppe poche partite attese» (22/09/2026).

    Lo storico ce l'ha (6,67 su 33 presenze), quindi il difetto non e' il livello: e' 0,630 di
    calendario. La banda e' chiusa da lui e da Scamacca, 0,718.
    """
    bars = cat.bars_for("default", "A")
    assert cat.category_of(0.630, 6.995, bars) == "solido"     # Adams C., FUORI
    assert cat.category_of(0.718, 6.982, bars) == "semi"       # Scamacca, DENTRO
    # LA SBARRA STA IN MEZZO AI DUE E NON SU UN BORDO. La prima stesura la metteva su `PLAYS_ALWAYS`
    # (0,72) leggendo «0,72» da una tabella ARROTONDATA: il valore vero di Scamacca e' 0,718 e la
    # sbarra lo tagliava fuori per due millesimi - lo stesso errore delle due sbarre di Svilar e
    # Varela, commesso una seconda volta da chi l'aveva appena scritto.
    assert 0.630 < cat.PLAYS_A_LOT < 0.718
    assert cat.PLAYS_A_LOT != cat.PLAYS_ALWAYS


def test_chi_sta_sulla_COSTANTE_di_ruolo_e_una_incognita_e_non_uno_scarto():
    """Senza questa domanda `scommessa` era VUOTA per costruzione: il foglio una fantamedia la da' a
    tutti, perche' `est_fm` ripiega sull'ancora del ruolo.

    Misurato sul foglio Serie A del 22/09/2026: 147 righe stavano sull'ancora e prendevano 103
    `scarto`, 31 `riserva` e 7 `solido` - un giudizio su uomini che nessuno ha visto giocare.
    """
    bars = cat.bars_for("default", "A")
    # l'ancora da sola non e' calcio: qualunque livello porti, la parola e' `scommessa`
    assert cat.category_of(0.80, 7.50, bars, history=False, seen=False) == "scommessa"
    assert cat.category_of(0.20, 6.00, bars, history=False, seen=False) == "scommessa"
    # ...ma l'ancora PIU' le giornate di quest'anno si': chi stiamo guardando adesso non e' ignoto
    assert cat.category_of(0.80, 7.50, bars, history=True, seen=True) == "top"


def test_la_ri_miscela_pesa_la_stagione_in_corso_piu_per_gli_attaccanti():
    """La K per ruolo e' la ragione per cui `solido` e `riserva` si separano.

    Due uomini con la STESSA fantamedia sul foglio (6,60) e due stagioni in corso opposte devono
    finire lontani: e' il caso Varela/Pinamonti, che sul foglio distano un centesimo.
    """
    bene = cat.relevel(6.60, 4, 9.5, "A", 40.0)      # Varela: sta rendendo adesso
    male = cat.relevel(6.61, 4, 5.75, "A", 40.0)     # Pinamonti: no
    assert bene > 6.87 > male
    # ...e lo stesso scarto pesa MENO per un centrocampista, che e' la misura
    scarto_a = cat.relevel(6.60, 5, 9.0, "A", 40.0) - 6.60
    scarto_c = cat.relevel(6.60, 5, 9.0, "C", 40.0) - 6.60
    assert scarto_a > scarto_c * 1.5


def test_la_ri_miscela_non_tocca_niente_dove_non_c_e_niente_da_ri_miscelare():
    """Su una pre-stagione le due miscele SONO lo stesso numero, e la funzione lo dice restituendo
    il valore intatto invece di inventare una correzione."""
    assert cat.relevel(7.0, 0, None, "A", 40.0) == 7.0      # nessuna giornata giocata
    assert cat.relevel(7.0, 5, 9.0, "A", None) == 7.0       # R25 non adottata (euro)
    assert cat.relevel(7.0, 5, 9.0, "X", 40.0) == 7.0       # ruolo senza K misurata
    assert cat.relevel(None, 5, 9.0, "A", 40.0) is None


def test_ogni_ruolo_ha_le_sue_quattro_sbarre_ordinate_su_ogni_piattaforma():
    for platform in ("default", "euro"):
        for role in ("P", "D", "C", "A"):
            bars = cat.bars_for(platform, role)
            assert bars is not None and len(bars) == 4, (platform, role)
            # STRETTAMENTE crescenti: due sbarre uguali svuotano la fascia in mezzo, che e' il
            # difetto di `bandiera` (20/08). Su euro due plateau le facevano coincidere - 80 portieri
            # su 110 con la stessa fantamedia attesa - e la sbarra sopra e' stata spostata al primo
            # valore che separa davvero.
            assert list(bars) == sorted(set(bars)), (platform, role)
    assert cat.bars_for("default", None) is None
    assert cat.bars_for("default", "Z") is None
    assert cat.bars_for("stellare", "A") is None      # una piattaforma senza tabella non inventa
    assert cat.bars_for(None, "A") is None
    # il caso e' indifferente: altrove il repository scrive gli slot minuscoli
    assert cat.bars_for("default", "a") == cat.bars_for("default", "A")


def test_le_due_piattaforme_hanno_sbarre_DIVERSE_e_euro_sta_piu_in_alto():
    """La scala euro e' piu' alta perche' EuroLeghe e' una selezione di top club.

    Una tabella sola metterebbe meta' degli attaccanti euro almeno `semi` per costruzione: e' «un
    parametro appartiene alla popolazione su cui e' misurato», e la piattaforma e' una popolazione.
    """
    for role in ("D", "C", "A"):
        euro = cat.bars_for("euro", role)
        default = cat.bars_for("default", role)
        assert euro != default, role
        assert euro[0] > default[0], role      # anche la sbarra piu' bassa sta piu' in alto


def test_le_sbarre_crescono_col_ruolo_e_il_portiere_sta_su_un_altra_scala():
    """Un portiere non si confronta con un attaccante: la sua fantamedia vive intorno al 5."""
    assert cat.LEVEL_BARS["default"]["P"][3] < cat.LEVEL_BARS["default"]["D"][0]
    for i in range(4):
        assert cat.LEVEL_BARS["default"]["D"][i] < cat.LEVEL_BARS["default"]["C"][i] < cat.LEVEL_BARS["default"]["A"][i]


def test_la_scala_ha_un_ordine_solo():
    assert cat.rank_of("super") == 0
    assert cat.rank_of("scarto") == 6
    assert cat.rank_of("scommessa") == 5      # sopra lo scarto: promette piu' di lui
    assert cat.rank_of("oro") is None          # la scala del 01/09 non risponde piu'
    assert cat.rank_of("supertop") is None     # ...ne' i nomi di stamattina
    assert cat.rank_of(None) is None
    assert len(set(cat.LADDER)) == len(cat.LADDER) == 7
