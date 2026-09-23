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
    ("Malen", "A", 8.487, 0.79, True, None, "super"),
    ("Martinez L.", "A", 7.873, 0.74, True, None, "super"),   # il piu' BASSO per presenze che entra
    ("Paz N.", "C", 6.867, 0.85, True, None, "super"),
    ("Dimarco", "D", 6.764, 0.83, True, None, "super"),
    ("Bremer", "D", 6.521, 0.78, True, None, "super"),
    ("Svilar", "P", 5.329, 0.90, True, None, "super"),        # un portiere PUO' essere supertop (sua parola)
    # TOP: il meglio del ruolo, oppure fuori scala ma troppo fragile per giocare.
    ("De Bruyne", "C", 6.800, 0.70, True, None, "top"),          # «fragile, non puo' darti tante presenze»
    # CALHANOGLU E' STATO RITIRATO DA LUI IL 24/09/2026, e la riga resta col suo nome invece di sparire:
    # «ok va bene se costa Calhanoglu ... un top deve garantire almeno 25 presenze». Era il caso su cui
    # il ramo `top` non aveva pavimento (1o centrocampista del listone e 22,8 presenze su 38); messo
    # davanti al prezzo di metterne uno, ha scelto il pavimento. Ora e' `solido` - il livello che ha,
    # senza il ramo `top` - e De Bruyne, che gioca 26,6, resta dove lui lo aveva messo.
    ("Calhanoglu", "C", 6.987, 0.60, True, None, "solido"),
    ("Rabiot", "C", 6.692, 0.79, True, None, "top"),
    ("Hojlund", "A", 7.105, 0.86, True, None, "top"),
    # SEMITOP, BUONO, TAPPABUCHI.
    ("Scamacca", "A", 6.982, 0.718, True, None, "semi"),  # 0,718 e non 0,72: vedi sotto
    ("Kvernadze", "A", 6.911, 0.77, False, None, "solido"),
    ("Varela G.", "A", 6.878, 0.54, False, None, "solido"),        # gioca poco e resta `solido`: sua decisione
    # I DUE `operaio` DEL 22/09 SONO DIVENTATI `boa` IL 23/09, e la parola non li tradisce: la loro
    # promessa di allora - «tappabuchi: gioca, ed e' per quello che lo compri» - e' parola per parola
    # quello che `boa` dice adesso. Quel giorno lui ha chiesto `operaio` a ~15 per ruolo, e con una
    # sbarra di livello Pinamonti (6,528, circa trentesimo fra gli attaccanti) e Douglas Luiz (6,049)
    # non ci stanno piu': a tenerli e' il gradino sotto, che e' nato per loro. Le sue due cifre di
    # `boa` sono chiuse proprio da questi due nomi - 0,721 di calendario e 5,940 di MV attesa.
    ("Pinamonti", "A", 6.528, 0.721, True, 5.993, "boa"),
    ("Douglas Luiz", "C", 6.049, 0.742, False, 5.940, "boa"),
]


@pytest.mark.parametrize("name, role, level, play, history, mv, expected", DETTATI)
def test_i_verdetti_dettati_finiscono_dove_li_ha_messi_lui(name, role, level, play, history, mv,
                                                           expected):
    got = cat.category_of(play, level, cat.bars_for("default", role), history=history, seen=True,
                          mv=mv, boa_mark=cat.BOA_MARK["default"])
    assert got == expected, name


def test_la_sbarra_delle_presenze_sta_fra_i_suoi_due_casi():
    """De Bruyne FUORI a 0,70 e Martinez DENTRO a 0,74: la sbarra e' un intervallo che lui ha chiuso.

    Non e' un test sul valore (0,72 si puo' spostare dentro la banda) ma sui due casi che la fissano,
    che e' la cosa che non deve cambiare senza risentire lui.
    """
    assert 0.70 < cat.PLAYS_ALWAYS <= 0.74
    # `[-1]` e non `[3]`: la tupla ha preso una sbarra il 23/09 e ogni indice scritto a mano si e'
    # spostato di uno - e il compilatore non dice niente. Si nomina la sbarra dal fondo.
    fuori_scala = cat.LEVEL_BARS["default"]["C"][-1] + 0.1
    assert cat.category_of(0.70, fuori_scala, cat.bars_for("default", "C")) == "top"
    assert cat.category_of(0.74, fuori_scala, cat.bars_for("default", "C")) == "super"


def test_chi_gioca_PUO_essere_uno_scarto_dal_23_09_2026_e_la_sua_regola_di_ieri_e_RITIRATA():
    """RIBALTA ESPLICITAMENTE una sua regola del 22/09/2026: «chi gioca non e' mai uno scarto» (detta
    su Douglas Luiz, 18o percentile e 0,74 di calendario).

    Il 23/09 ha chiesto che `operaio` scendesse a ~15 per ruolo - era 233 su 562, l'unica parola senza
    una sbarra sua - e ha scelto, messo davanti al conteggio, che `scarto` dicesse «e' MISURATO, e non
    vale un posto in rosa» invece di «non gioca abbastanza». Le due cose insieme mandano in `scarto`
    ~210 uomini che il calendario lo giocano al 50-80%: e' la conseguenza aritmetica della sua richiesta,
    non un effetto collaterale, ed e' registrata qui invece che sepolta.

    `scarto` ha quindi DUE porte e una sola frase che le copre entrambe.
    """
    infimo = cat.LEVEL_BARS["default"]["C"][0] - 2.0
    assert cat.category_of(0.74, infimo, cat.bars_for("default", "C")) == "scarto"
    assert cat.category_of(0.49, infimo, cat.bars_for("default", "C")) == "scarto"
    # ...e sopra la sua sbarra `operaio` c'e' ancora, che e' cio' che la parola dice adesso: il livello
    # ci sarebbe, il posto nel suo club no.
    appena_sopra = cat.LEVEL_BARS["default"]["C"][0]
    assert cat.category_of(0.74, appena_sopra, cat.bars_for("default", "C")) == "operaio"


def test_chi_non_ha_un_livello_e_una_incognita_e_mai_uno_scarto():
    """«Vuoto = ignoto, mai zero» sulla parola: i due dicono il contrario l'uno dell'altro.

    Dal 23/09/2026 la parola per il vuoto e' `incognita`: `scommessa` ha una CONDIZIONE («ottimi
    presupposti») e darla a chi non ha un numero sarebbe una promessa falsa. L'invariante che questo
    test difende non cambia - quello che cambia e' quale delle due parole tocca a chi non ha niente.
    """
    assert cat.category_of(0.80, None, cat.bars_for("default", "A")) == "incognita"
    assert cat.category_of(0.80, 7.0, None) == "incognita"
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
    `scarto`, 31 `operaio` e 7 `solido` - un giudizio su uomini che nessuno ha visto giocare.
    """
    bars = cat.bars_for("default", "A")
    # l'ancora da sola non e' calcio: qualunque livello porti, la parola non e' un giudizio
    assert cat.category_of(0.80, 7.50, bars, history=False, seen=False) == "incognita"
    assert cat.category_of(0.20, 6.00, bars, history=False, seen=False) == "incognita"
    # ...e diventa `scommessa` SOLO se il calcio che ha su file dice qualcosa di buono (23/09/2026)
    assert cat.category_of(0.80, 7.50, bars, history=False, seen=False,
                           prospects=True) == "scommessa"
    # ...ma l'ancora PIU' le giornate di quest'anno si': chi stiamo guardando adesso non e' ignoto
    assert cat.category_of(0.80, 7.50, bars, history=True, seen=True) == "top"


def test_la_ri_miscela_pesa_la_stagione_in_corso_piu_per_gli_attaccanti():
    """La K per ruolo e' la ragione per cui `solido` e `operaio` si separano.

    Due uomini con la STESSA fantamedia sul foglio (6,60) e due stagioni in corso opposte devono
    finire lontani: e' il caso Varela/Pinamonti, che sul foglio distano un centesimo.
    """
    # Tutt'e due senza una fantamedia precedente, che e' cio' che li mette sulla K MISURATA: sono
    # nuovi arrivati, e le cinque giornate sono la sola prova che esista su di loro.
    bene = cat.relevel(6.60, 4, 9.5, "A", 40.0, history=False)   # Varela: sta rendendo adesso
    male = cat.relevel(6.61, 4, 5.75, "A", 40.0, history=False)  # Pinamonti: no
    assert bene > 6.87 > male
    # ...E CON UNO STORICO DA PESARE LA RISPOSTA E' UN'ALTRA, dal 24/09/2026: gli stessi due numeri
    # sotto `DECLARED_K` si avvicinano fin quasi a scambiarsi, ed e' esattamente cio' che lui ha
    # chiesto guardando Maldini (8,40 in cinque giornate, storico 6,39) contro Simeone (5,70 e 7,25).
    assert cat.relevel(6.60, 4, 9.5, "A", 40.0) < cat.relevel(6.61, 4, 5.75, "A", 40.0)
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


def test_ogni_ruolo_ha_le_sue_CINQUE_sbarre_ordinate_su_ogni_piattaforma():
    for platform in ("default", "euro"):
        for role in ("P", "D", "C", "A"):
            bars = cat.bars_for(platform, role)
            # CINQUE dal 23/09/2026: `operaio` ha preso la sua, la piu' bassa.
            assert bars is not None and len(bars) == 5, (platform, role)
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
    assert cat.LEVEL_BARS["default"]["P"][-1] < cat.LEVEL_BARS["default"]["D"][0]
    for i in range(len(cat.LEVEL_BARS["default"]["D"])):
        assert cat.LEVEL_BARS["default"]["D"][i] < cat.LEVEL_BARS["default"]["C"][i] < cat.LEVEL_BARS["default"]["A"][i]


def test_la_scala_ha_un_ordine_solo():
    # Le posizioni si asseriscono come RELAZIONI e non come numeri: la scala ha gia' preso una parola in
    # piu' una volta (`promessa`, 23/09/2026) e un letterale l'aveva fatta cadere su un indice invece che
    # su cio' che difende. Quello che deve restare vero e' l'ordine, non il conteggio.
    assert cat.rank_of("super") == 0
    # `incognita` CHIUDE la scala perche' non e' un giudizio ma l'assenza di uno - lo stesso posto in cui
    # `scommessa` chiudeva prima che lui la spostasse sopra lo scarto, e per il suo stesso argomento.
    assert cat.rank_of("incognita") == len(cat.LADDER) - 1
    # `scommessa` sta SOPRA lo scarto (sua decisione): promette piu' di «e' misurato e non gioca».
    assert cat.rank_of("scommessa") < cat.rank_of("scarto")
    # ...e `promessa` sta fra `semi` e `solido`, che e' dove lui l'ha messa.
    assert cat.rank_of("semi") < cat.rank_of("promessa") < cat.rank_of("solido")
    # ...e `boa` sta UN GRADINO SOTTO `operaio` (sua correzione del 23/09/2026 sera).
    assert cat.rank_of("boa") == cat.rank_of("operaio") + 1
    # ...E `scommessa` E' RISALITA SOPRA `operaio` la sera del 23/09/2026, quando la parola ha smesso di
    # dire «nessuno l'ha prezzato» e ha cominciato a dire «partenza non eccezionale ma potenziale ottimo
    # proseguimento»: con quel significato vale piu' di chi gioca sempre e rende il minimo. Il suo
    # ordine, dettato in tre parole: PROMESSA > SCOMMESSA > OPERAIO.
    assert cat.rank_of("promessa") < cat.rank_of("scommessa") < cat.rank_of("operaio")
    assert cat.rank_of("oro") is None          # la scala del 01/09 non risponde piu'
    assert cat.rank_of("supertop") is None     # ...ne' i nomi di stamattina
    assert cat.rank_of(None) is None
    assert len(set(cat.LADDER)) == len(cat.LADDER)


# ---------------------------------------------------------------------------------------------
# IL CANCELLO DELL'UNDICI TIPO (operatore, 23/09/2026). I suoi quattro casi sono la specifica, come
# lo erano i nove verdetti di ieri: se uno di questi cade, e' una cosa da ridiscutere con lui e non
# un test da aggiornare.
# ---------------------------------------------------------------------------------------------

#: I quattro nomi che ha trovato a schermo, coi numeri del foglio del 22/09/2026 (Serie A classic):
#: parola che leggevano, gradino, quota di calendario prevista, parola che si aspetta.
HIS_FOUR = [
    ("Cabal", "top", "operaio", 0.303, cat.SCARTO),
    ("Pavard", "top", "operaio", 0.515, cat.OPERAIO),
    ("Kempf", "solido", "panchina", 0.576, cat.OPERAIO),
    ("Stones", "solido", "panchina", 0.509, cat.OPERAIO),
]

#: Le dichiarazioni POSITIVE che il cancello non deve toccare, stessi numeri e stesso foglio. Calhanoglu
#: e' quella che decide: e' `top` a `ballottaggio`, quindi «almeno titolare» non puo' essere il GRADINO
#: `titolare` - ed e' anche la ragione per cui il cancello cita `CONTENDER_RUNGS` invece di una soglia.
HIS_DECLARED = [
    ("Malen", "super", "titolare", 0.794),
    ("Martinez L.", "super", "titolare", 0.736),
    ("Dimarco", "super", "titolare", 0.833),
    ("Paz N.", "super", "titolare", 0.852),
    ("Svilar", "super", "bandiera", 0.897),
    ("Calhanoglu", "top", "ballottaggio", 0.600),
    ("Hojlund", "top", "titolare", 0.864),
    ("Scamacca", "semi", "titolare", 0.718),
    ("Kvernadze", "solido", "titolare", 0.767),
    ("Pinamonti", "operaio", "titolare", 0.721),
    ("Douglas Luiz", "operaio", "ballottaggio", 0.742),
]


def test_the_gate_answers_his_four_cases():
    for name, was, rung, share, expected in HIS_FOUR:
        assert cat.gated(was, rung, share) == expected, name


def test_the_gate_leaves_every_positive_declaration_standing():
    for name, word, rung, share in HIS_DECLARED:
        assert cat.gated(word, rung, share) == word, name


def test_an_unknown_rung_demotes_nobody():
    # Senza display la board non si disegna e il gradino resta vuoto: li' «l'undici non lo schiera» e
    # «non abbiamo guardato» leggerebbero uguale, che e' la cosa che questo progetto non fa.
    for rung in (None, ""):
        assert cat.gated("super", rung, 0.05) == "super"


def test_the_gate_only_ever_lowers():
    # Non promuove nessuno, e non tocca le tre parole in fondo: `scommessa` non e' un giudizio, quindi
    # retrocederla direbbe «misurato e non gioca» di un uomo che nessuno ha misurato.
    assert cat.gated(cat.OPERAIO, "bandiera", 0.99) == cat.OPERAIO
    for word in (cat.OPERAIO, cat.SCOMMESSA, cat.SCARTO):
        assert cat.gated(word, "operaio", 0.9) == word


def test_the_contender_rungs_are_the_ladder_s_own_and_not_a_copy():
    # Una definizione e tre lettori: la scala, la board e questa. Due copie finirebbero per non essere
    # d'accordo su «lo schiera o no», che e' esattamente cio' che il cancello decide.
    from euroleghe_ingest.engine import status
    from euroleghe_ingest.modules import boards
    assert boards.CONTENDER_RUNGS is status.CONTENDER_RUNGS
    assert status.CONTENDER_RUNGS == frozenset(("bandiera", "titolarissimo", "titolare", "ballottaggio"))
    # ...e sono ESATTAMENTE i gradini sopra `panchina`, dedotti dalla scala invece che riscritti.
    assert all(status.LADDER.index(r) < status.LADDER.index("panchina") for r in status.CONTENDER_RUNGS)


# ---------------------------------------------------------------------------------------------
# `promessa`, l'OTTAVA parola (operatore, 23/09/2026): «un SOLIDO che ha gia' dimostrato nelle prime
# giornate di avere una buona media voto e di aver fatto qualche bonus».
# ---------------------------------------------------------------------------------------------

def test_in_form_wants_BOTH_the_mark_and_the_bonus():
    # Varela G. sul foglio del 22/09: 4 presenze su 5 giornate, voto 6,62, bonus +2,88.
    assert cat.in_form(6.62, 9.50, 4, 5) is True
    assert cat.in_form(5.90, 8.80, 4, 5) is False     # bonus si', media voto no
    assert cat.in_form(6.50, 6.50, 4, 5) is False     # media voto si', nessun bonus
    assert cat.in_form(6.50, 6.40, 4, 5) is False     # ...e un bonus NETTO negativo non e' un bonus


def test_in_form_wants_enough_football_to_have_shown_anything():
    # Meta' delle giornate gia' giocate, come QUOTA e non come numero di partite: «tre presenze» e'
    # severo a settembre e banale a marzo.
    assert cat.in_form(7.0, 9.0, 1, 5) is False
    assert cat.in_form(7.0, 9.0, 3, 5) is True
    assert cat.in_form(7.0, 9.0, 3, 30) is False


def test_on_a_preseason_sheet_nobody_is_a_promessa():
    # Non e' un buco: la parola dice «ha GIA' dimostrato», e prima che si giochi nessuno ha dimostrato.
    assert cat.in_form(None, None, None, None) is False
    assert cat.in_form(None, None, 0, 0) is False


def test_the_form_only_ever_promotes_a_solido():
    bars = cat.bars_for("default", "A")
    # Kvernadze: `solido` senza forma, `promessa` con - ed e' senza storico, che e' il caso che decide.
    assert cat.category_of(0.767, 6.911, bars, history=False, seen=True, form=False) == cat.SOLIDO
    assert cat.category_of(0.767, 6.911, bars, history=False, seen=True, form=True) == cat.PROMESSA
    # ...e non tocca nessun'altra parola: chi e' gia' sopra non sale e chi e' sotto non risale.
    for share, level in ((0.80, 7.70), (0.60, 7.20), (0.75, 7.00), (0.60, 6.50), (0.30, 7.00)):
        without = cat.category_of(share, level, bars, form=False)
        with_it = cat.category_of(share, level, bars, form=True)
        assert with_it == (cat.PROMESSA if without == cat.SOLIDO else without), (share, level)


def test_the_gate_caps_a_promessa_too():
    # `promessa` sta sopra `operaio`, quindi l'undici tipo la cappa come cappa le altre.
    assert cat.gated(cat.PROMESSA, "panchina", 0.60) == cat.OPERAIO
    assert cat.gated(cat.PROMESSA, "ballottaggio", 0.60) == cat.PROMESSA


# ---------------------------------------------------------------------------------------------
# `scommessa` CONTRO `incognita` e la parola `boa` (operatore, 23/09/2026 sera).
# ---------------------------------------------------------------------------------------------

def test_prospects_wants_the_synthetic_vote_and_no_booking_habit():
    """Le due cifre sono sue (23/09/2026): voto >= 5,8 e netto > -0,25.

    La seconda e' su una quantita' che CONTIENE i cartellini: su `ga90`, che non scende mai sotto zero,
    un tetto negativo sarebbe inerte per costruzione e direbbe «escludo chi si fa ammonire» senza
    guardarne uno.
    """
    # Pessina sul foglio del 22/09: voto sintetico 6,18 in Serie B, 0,20 di bonus per 90, quattro
    # gialli in 2907 minuti -> netto +0,138.
    assert cat.has_prospects(6.18, 0.138) is True
    # ...e a 5,8 entrano anche quelli senza un bonus, se non si fanno ammonire: e' cio' che la sua
    # seconda cifra dichiara. Duncan legge -0,062.
    assert cat.has_prospects(5.87, -0.062) is True
    assert cat.has_prospects(5.70, 0.382) is False    # netto si', voto sotto la sua sbarra
    assert cat.has_prospects(6.18, -0.40) is False    # voto si', ma un giallo quasi ogni partita
    # E CHI NON HA NUMERI NON HA PRESUPPOSTI: e' il punto della parola, non un ripiego. 74 righe di 83
    # sul foglio di Serie A stanno qui.
    assert cat.has_prospects(None, None) is False
    assert cat.has_prospects(6.5, None) is False


def test_the_bar_would_be_INERT_on_a_quantity_that_cannot_go_negative():
    # La controprova della scelta: con `ga90` (gol+assist per 90, mai negativo) la seconda prova
    # passerebbe SEMPRE, cioe' la parola sarebbe decisa dal solo voto. Il test lo dice invece di
    # lasciarlo dedurre - e se qualcuno rimettesse `ga90` al posto del netto, questa riga resta vera
    # e le due sopra cadono.
    assert cat.PROSPECT_BONUS < 0
    for ga90 in (0.0, 0.099, 0.2, 0.894):
        assert ga90 > cat.PROSPECT_BONUS


def test_the_three_sixes_are_the_same_mark_on_three_questions():
    # `FORM_MARK` (media voto VISTA di quest'anno), `PROSPECT_MARK` (voto SINTETICO dell'ultima stagione
    # su file) e `BOA_MARK` (media voto ATTESA) sono tre domande diverse con lo stesso numero, che e'
    # `PASS_MARK`, la sufficienza che il regolamento paga. Tre nomi perche' una soglia presa in prestito
    # da un'altra domanda e' un difetto che questo repository ha gia' pagato; un test perche' chi ne
    # muove uno deve dire perche' gli altri non si muovono.
    assert cat.FORM_MARK == 6.0
    # ...e `BOA_MARK` NON e' piu' fra loro dal 23/09/2026: il sei era il valore di principio e la TAGLIA
    # che lui ha chiesto per `boa` («8/12 per ogni ruolo») lo ha spostato, per piattaforma.
    assert set(cat.BOA_MARK) == {"default", "euro"}
    # ...e `PROSPECT_MARK` NON e' fra loro (sua cifra del 23/09/2026): li' si chiede una sufficienza
    # REALIZZATA, qui un voto SINTETICO convertito da un altro campionato, dove il sei e' gia' un uomo
    # notevole - a 6,00 la parola teneva un uomo su 83.
    assert cat.PROSPECT_MARK == 5.8


def test_boa_is_carved_out_of_operaio_and_needs_BOTH_halves():
    bars = cat.bars_for("default", "P")
    # SOTTO la sbarra di `operaio` del ruolo, o la parola che tocca e' quella e non questa: `boa` e'
    # il gradino sotto, e la cascata rispetta l'ordine che lui ha dato alle due parole.
    # De Gea sul foglio del 22/09: gioca lo 0,88 del calendario con 6,05 di MV attesa e 4,56 di livello -
    # il livello e' basso perche' la fantamedia di un portiere porta i gol subiti, ed e' la ragione per
    # cui la prova e' sulla MEDIA VOTO e non sul livello.
    mark = cat.BOA_MARK["default"]
    assert cat.category_of(0.88, 4.563, bars, mv=6.048, boa_mark=mark) == "boa"
    assert cat.category_of(0.60, 4.563, bars, mv=6.048, boa_mark=mark) == "scarto"   # non gioca
    assert cat.category_of(0.88, 4.563, bars, mv=5.80, boa_mark=mark) == "scarto"    # voto non degno
    assert cat.category_of(0.88, 4.563, bars, mv=None, boa_mark=mark) == "scarto"    # vuoto = ignoto
    # ...e SENZA la sbarra della piattaforma `boa` non si puo' dire: si scende, non si indovina.
    assert cat.category_of(0.88, 4.563, bars, mv=6.048) == "scarto"


def test_the_boa_floor_is_closed_by_his_two_declared_operaio():
    """Pinamonti (0,721 di calendario, 5,993 di MV attesa) e Douglas Luiz (0,742 e 5,940) erano due suoi
    `operaio` del 22/09, e la loro promessa - «gioca, ed e' per quello che lo compri» - e' parola per
    parola quello che `boa` dice dal 23/09. A 0,80 di calendario restavano fuori tutti e due.
    """
    assert cat.BOA_PLAYS <= 0.721
    assert cat.BOA_MARK["default"] <= 5.940
    bars_a, bars_c = cat.bars_for("default", "A"), cat.bars_for("default", "C")
    mark = cat.BOA_MARK["default"]
    assert cat.category_of(0.721, 6.528, bars_a, mv=5.993, boa_mark=mark) == "boa"
    assert cat.category_of(0.742, 6.049, bars_c, history=False, seen=True,
                           mv=5.940, boa_mark=mark) == "boa"


def test_boa_never_eats_a_word_above_operaio():
    bars = cat.bars_for("default", "A")
    # Un uomo che gioca sempre e sta sopra le sbarre resta quello che era: `boa` e' il fondo di
    # `operaio` e non un cappello su tutta la scala.
    assert cat.category_of(0.90, 7.70, bars, mv=6.50) == "super"
    assert cat.category_of(0.90, 7.00, bars, mv=6.50) == "semi"


def test_the_gate_leaves_the_three_bottom_words_alone():
    # Il cancello cappa solo cio' che sta sopra `operaio`: `boa` e `incognita` ci stanno sotto, e
    # retrocedere una `incognita` direbbe «misurato e non gioca» di un uomo che nessuno ha misurato.
    for word in (cat.BOA, cat.INCOGNITA, cat.SCARTO, cat.SCOMMESSA, cat.OPERAIO):
        assert cat.gated(word, "panchina", 0.90) == word


def test_a_keeper_is_never_asked_for_bonuses_he_cannot_produce():
    """`promessa` era VUOTA PER COSTRUZIONE per i portieri, e l'ha trovato il conteggio per parola.

    `fm - mv` per un portiere e' il malus dei gol subiti: sul foglio del 22/09 **0 di 25** che hanno
    giocato hanno un bonus netto positivo (il migliore, Caprile, sta a -0,40). Chiedergli «qualche
    bonus» non e' una prova severa, e' la quantita' sbagliata - la stessa ragione per cui `abroad` lo
    esclude dal braccio dei bonus e per cui `BOA_MARK` legge la media voto e non la fantamedia.
    """
    # Palmisani: 5 presenze, 6,80 di media voto, -0,80 di malus a presenza -> dentro.
    assert cat.in_form(6.80, 6.00, 5, 5, "P") is True
    assert cat.in_form(6.80, 6.00, 5, 5, "C") is False
    # ...ma «POCHI malus» e non «nessun malus»: Butez, -1,25 a presenza, resta fuori. La prova si
    # CAMBIA di segno e non si toglie - toglierla lo passava sulla sola media voto.
    assert cat.in_form(6.00, 4.75, 4, 5, "P") is False
    # ...e la media voto la vuole lo stesso: le due meta' restano due.
    assert cat.in_form(5.70, 5.10, 5, 5, "P") is False
    # ...e senza ruolo la regola generale resta quella di prima, che e' il default sicuro.
    assert cat.in_form(6.80, 6.00, 5, 5) is False
    # UN PUNTO E' UN GOL: la soglia e' l'unita' del gioco.
    assert cat.KEEPER_MALUS == -1.0


def test_la_scommessa_riproduce_i_nomi_che_ha_dettato():
    """I DODICI NOMI DEL 23/09/2026 SONO LA SPECIFICA, come le nove parole lo erano il giorno prima.

    Le tre soglie non sono scelte: la banda delle presenze e' sua («> 15», «almeno 25»), il 26 e' il
    VUOTO che i suoi esempi lasciano fra Diao 25,8 e Davis 27,3, e la sbarra del potenziale e' la
    mediana del gruppo da cui la parola pesca. Qui si asserisce che i nomi tornano, cioe' l'unica cosa
    che li rende una specifica invece di un aneddoto - livelli e presenze sono quelli del foglio vero.
    """
    bar = cat.potential_bar("default", "A")          # 6.561
    assert bar is not None
    def word(now, pv38, level):
        return cat.as_bet(now, pv38 / 38.0, level, bar)

    # LE SCOMMESSE che la regola prende, con la parola da cui pescano
    assert word("solido", 21.8, 7.043) == cat.SCOMMESSA      # Yildiz
    assert word("solido", 24.4, 6.952) == cat.SCOMMESSA      # Esposito Se.
    assert word("operaio", 25.8, 6.821) == cat.SCOMMESSA     # Diao
    assert word("scarto", 25.7, 6.665) == cat.SCOMMESSA      # Kean
    assert word("scarto", 21.6, 6.610) == cat.SCOMMESSA      # Beto

    # GLI OPERAI: sopra il tetto della banda la parola resta, ed e' il pavimento che lui ha chiesto
    assert word("operaio", 31.2, 6.756) == cat.OPERAIO       # Simeone
    assert word("operaio", 31.0, 6.716) == cat.OPERAIO       # Lauriente'
    assert word("operaio", 27.3, 6.947) == cat.OPERAIO       # Davis K.

    # ...E I DUE PREZZI CHE HA ACCETTATO GUARDANDOLI, che il test tiene perche' non siano una sorpresa:
    # Esposito F.P. resta `top` (la scommessa pesca solo da `solido` in giu', sua regola) e Lang resta
    # dov'e' (6,061 e' il 1° percentile degli attaccanti: sotto qualunque pavimento di ruolo).
    assert word("top", 25.3, 7.174) == "top"
    assert word("scarto", 22.6, 6.061) == "scarto"

    # E IL PAVIMENTO DEGLI OPERAI MORDE ANCHE SENZA POTENZIALE: chi non arriva al tetto della banda non
    # e' un operaio, perche' quella parola dice «gioca sempre e rende il minimo».
    assert word("operaio", 22.0, 6.100) == cat.BOA
    # ...e sotto le 15 giornate non si e' nemmeno una scommessa, che e' l'altra sua dichiarazione.
    assert word("scarto", 14.0, 7.000) == "scarto"


def test_i_quattro_verdetti_del_24_settembre_sulla_parte_alta():
    """SIMEONE `semi`, DAVIS K. COME SCAMACCA, MALDINI `promessa`, ESPOSITO F.P. FUORI DA `top`.

    Sono una dichiarazione sola detta con nomi opposti - «Simeone ha una ottima FM dell'anno scorso» e
    «Maldini ha una FM dello scorso anno troppo bassa per essere un SEMITOP» - e al peso vecchio
    (`BLEND_K["A"]` = 18,5, cioe' il 21% alle cinque giornate) erano SIMULTANEAMENTE IMPOSSIBILI:
    Maldini leggeva 6,992 di livello e Simeone 6,756, cioe' l'ordine rovesciato rispetto al loro
    storico (6,61 contro 7,04). I livelli qui sono quelli che la K nuova produce sul foglio vero.

    RIMETTENDO IL DIFETTO (K = 18,5) questo test cade su Simeone e su Maldini, che e' il punto: la
    controprova e' che la coppia non si possa soddisfare senza la cura.
    """
    bars = cat.bars_for("default", "A")
    # i tre `semi`: Scamacca era gia' suo, Simeone e Davis K. arrivano con la cura
    assert cat.category_of(0.718, 7.080, bars) == cat.SEMI            # Scamacca
    assert cat.category_of(0.821, 6.907, bars) == cat.SEMI            # Simeone
    assert cat.category_of(0.718, 6.985, bars, form=True) == cat.SEMI  # Davis K., come Scamacca
    # Maldini: il livello alto e' la fiammata di cinque giornate, lo storico no -> `promessa`
    assert cat.category_of(0.688, 6.790, bars, form=True) == cat.PROMESSA
    # Esposito F.P.: «non puo' essere un top». Il suo 8,25 di fantavoto in quattro partite pesa meno,
    # e le 22 presenze previste lo tengono sotto `semi` (`PLAYS_A_LOT`), quindi cade su `promessa`.
    assert cat.category_of(0.667, 7.048, bars, form=True) == cat.PROMESSA
    # ...E LE DICHIARAZIONI DI IERI RESTANO IN PIEDI, che e' la meta' che rende la cura adottabile.
    assert cat.category_of(0.864, 7.106, bars) == cat.TOP             # Hojlund
    assert cat.category_of(0.688, 7.460, bars) == cat.TOP             # Thuram
    assert cat.category_of(0.736, 7.712, bars) == cat.SUPER           # Martinez L.
    assert cat.category_of(0.794, 8.184, bars) == cat.SUPER           # Malen


def test_la_k_dell_attaccante_e_una_dichiarazione_e_non_il_suo_ottimo():
    """L'unica riga di `BLEND_K` che non sta sull'ottimo misurato, e il test dice perche' esiste.

    A K = 18,5 le cinque giornate pesano il 21% e nessuna coppia di sbarre soddisfa i suoi nomi; a 45
    ne pesano il 10% e tutti e diciotto i verdetti tornano. Il prezzo e' scritto accanto alla costante
    (+4,4% invece di +6,0% sulla previsione, 10 stagioni su 10 comunque migliori del baseline).

    L'INVARIANTE ASSERITA E' QUELLA CHE DECIDE: a cinque giornate lo storico deve pesare almeno otto
    volte le partite viste, o Maldini (6,61 di base, 8,40 in cinque partite) torna sopra Simeone (7,04
    e 5,70) e la coppia di verdetti si rompe di nuovo.
    """
    k = 5.0
    peso = k / (k + cat.DECLARED_K["A"])
    assert peso <= 0.125, "sopra il 12,5% i verdetti del 24/09 non sono soddisfacibili"
    assert peso >= 0.075, "sotto il 7,5% Scamacca scavalca Hojlund e diventa `top`"
    maldini = peso * 8.40 + (1 - peso) * 6.611
    simeone = peso * 5.70 + (1 - peso) * 7.041
    assert maldini < simeone, "lo storico deve decidere l'ordine, non le cinque giornate"


def test_chi_non_ha_giocato_qui_non_ha_il_tetto_delle_presenze():
    """Sua scelta del 24/09/2026 fra due forme misurate: Kolo Muani, Adams A. e Tourè E. sono
    scommesse con 26,7-28,8 presenze previste su 38, cioe' oltre il tetto della banda, e non hanno una
    fantamedia precedente in Serie A. Il tetto e' una prova sulle SUE presenze e le presenze di chi non
    ha mai giocato qui sono una previsione, non una misura.

    IL PREZZO E' ASSERITO INSIEME AL GUADAGNO: Castro S. ha uno storico (6,71) e 26,7 presenze, quindi
    resta dove la cascata lo mette - lui lo aveva chiesto come scommessa e ha scelto questa forma
    sapendolo, contro l'altra che svuotava `operaio`.
    """
    bar = cat.potential_bar("default", "A")
    def word(now, pv38, level, history):
        return cat.as_bet(now, pv38 / 38.0, level, bar, history=history)

    assert word("boa", 28.8, 6.584, False) == cat.SCOMMESSA      # Kolo Muani
    assert word("operaio", 26.7, 6.698, False) == cat.SCOMMESSA  # Adams A.
    assert word("scarto", 25.9, 6.549, False) == cat.SCOMMESSA   # Tourè E., sulla sbarra al millesimo
    # ...e con lo storico lo stesso uomo alle stesse presenze resta dov'e': e' `history` a decidere
    assert word("scarto", 26.7, 6.656, True) == "scarto"         # Castro S., il prezzo dichiarato
    # IL PAVIMENTO INVECE VALE PER TUTTI, storico o no: sotto le 15 giornate non si scommette.
    assert word("scarto", 14.0, 7.000, False) == "scarto"
    # ...e senza potenziale l'esenzione non promuove nessuno, o direbbe «ottimi presupposti» di chi
    # non ne ha: un operaio senza storico scende, esattamente come dentro la banda.
    assert word("operaio", 30.0, 6.100, False) == cat.BOA


def test_piccoli_e_una_boa_e_la_sbarra_tagliava_per_due_millesimi():
    """Sua risposta del 24/09/2026 su «Piccoli e' una BOA o una SCOMMESSA?»: mancava DUE MILLESIMI di
    quota (0,7182 contro 0,72) e ne aveva la media voto (5,977 contro 5,94). Quarta volta che una
    sbarra di questo repository taglia su un numero arrotondato.

    La sbarra sta FRA lui e Pinamonti (0,721) e non sul bordo, e `PLAYS_ALWAYS` resta dov'era: due
    costanti con lo stesso numero rispondevano a due domande.
    """
    bars, mark = cat.bars_for("default", "A"), cat.BOA_MARK["default"]
    # Tutto l'intervallo che il suo 23,7 rappresenta, non il nominale: vedi il test di Castro per la
    # ragione, che e' costata una rigenerazione del foglio.
    for pv in (23.65, 23.70, 23.75):
        assert cat.category_of(pv / 33.0, 6.550, bars, mv=5.977, boa_mark=mark) == cat.BOA, pv
    assert cat.BOA_PLAYS < 23.65 / 33.0 < cat.PLAYS_ALWAYS
    # ...e non ha allargato la porta a chi gioca meno: 22,9 resta fuori in tutto il suo intervallo.
    for pv in (22.85, 22.90, 22.95):
        assert cat.category_of(pv / 33.0, 6.550, bars, mv=5.977, boa_mark=mark) == cat.SCARTO, pv


def test_un_top_garantisce_venticinque_presenze_e_calhanoglu_e_ritirato():
    """«Ok va bene se costa Calhanoglu ... un top deve garantire almeno 25 presenze» (24/09/2026).

    E' la prima dichiarazione di questo modulo che ne RITIRA una precedente: il 22/09 Calhanoglu era
    `top` proprio in quanto «fuori scala e non gioca abbastanza», e la misura gli ha messo davanti che
    nessun pavimento di presenze toglie Esposito F.P. (25,3 su 38) senza togliere anche lui (22,8).
    Messo davanti al prezzo, ha scelto il pavimento.

    IL TEST TIENE TUTT'E DUE LE META': chi cade e chi resta. Un pavimento asserito solo dai nomi che
    cadono passerebbe anche a 30 presenze, cioe' non direbbe dove sta.
    """
    bars_c, bars_a = cat.bars_for("default", "C"), cat.bars_for("default", "A")
    assert bars_c is not None and bars_a is not None
    # Calhanoglu: il livello da `top` ce l'ha (6,987 contro una sbarra di 6,53) e le presenze no
    assert 6.987 >= bars_c[3]
    assert cat.category_of(22.8 / 38.0, 6.987, bars_c) != cat.TOP
    # ...e non precipita: prende la parola che il suo livello gli da' senza quel ramo
    assert cat.category_of(22.8 / 38.0, 6.987, bars_c) == cat.SOLIDO
    # gli altri tre che cadono con lui, tutti sotto le 25 presenze
    for pv38 in (23.5, 23.8, 24.5):
        assert cat.category_of(pv38 / 38.0, 7.200, bars_a) != cat.TOP
    # E CHI RESTA: Esposito F.P. a 25,3 supera il pavimento - esce da `top` per il LIVELLO e non per
    # le presenze, che e' la ragione per cui questa cura e quella sulla K sono due cose diverse.
    assert 25.3 / 38.0 >= cat.TOP_PLAYS
    assert cat.category_of(25.3 / 38.0, 7.200, bars_a) == cat.TOP
    # ...e Hojlund, che gioca lo 0,864, non lo sfiora
    assert cat.category_of(0.864, 7.106, bars_a) == cat.TOP


def test_castro_e_almeno_una_boa():
    """«Perche' Castro e' uno scarto? Dovrebbe essere almeno una BOA» (operatore, 24/09/2026).

    Gioca **26,7 presenze su 38** e ha la media voto attesa che `boa` chiede (6,168 contro 5,94): gli
    mancava solo la quota, di dodici millesimi. La sbarra scende FRA lui e Locatelli (26,6), che e' il
    primo sotto di lui e che non ha nominato.
    """
    bars, mark = cat.bars_for("default", "A"), cat.BOA_MARK["default"]
    # LA QUOTA E' `engine_pv_pred / matchdays` E QUELLA COLONNA E' ARROTONDATA A UN DECIMALE, quindi il
    # suo valore VERO non e' 23,2/33 ma un punto qualsiasi dell'intervallo che quel 23,2 rappresenta.
    # La prima stesura metteva la sbarra a 0,702 leggendo il nominale, e sul foglio rigenerato Castro
    # usciva `scarto` mentre la funzione chiamata a mano diceva `boa`: il test asserisce quindi TUTTO
    # l'intervallo, che e' la sola cosa di cui si sappia che e' vera.
    for pv in (23.15, 23.20, 23.25):
        assert cat.category_of(pv / 33.0, 6.718, bars, mv=6.168, boa_mark=mark) == cat.BOA, pv
    # ...e la sbarra sta nel VUOTO che l'arrotondamento garantisce: fra il 23,0 di Busio e il 23,2 di
    # Castro non puo' esserci nessuno, perche' due valori consecutivi distano 1/33.
    assert 23.15 / 33.0 > cat.BOA_PLAYS > 23.05 / 33.0
    # ...e non ha aperto la porta a chi gioca meno: Busio, 23,0, resta fuori in tutto il suo intervallo
    for pv in (22.95, 23.00, 23.05):
        assert cat.category_of(pv / 33.0, 6.718, bars, mv=5.966, boa_mark=mark) == cat.SCARTO, pv
