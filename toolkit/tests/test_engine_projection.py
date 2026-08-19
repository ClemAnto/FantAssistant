"""Test di sola formula per `engine/projection.py`: nessun DB, nessuna I/O.

Tre di questi esistono per fermare un'IDEA e non per fissare un'aritmetica: il calendario applicato come
LIVELLO invece che come deviazione (conterebbe due volte la forza del club), il ramo estero acceso per i
portieri (misurato -0.9%, e con b = 0 non deve nemmeno dichiarare di aver risposto) e una nota dichiarata
letta da dentro `engine/`, che la firma di `projection` rende impossibile perche' non ha di che leggerla.
"""

from __future__ import annotations

from euroleghe_ingest.engine import projection

ANCHOR_C = 6.10          # l'ancora di un centrocampista, dell'ordine di quella vera
EQUIV_GOOD = 6.80        # un equivalente sintetico sopra l'ancora
EQUIV_POOR = 5.40        # ...e uno sotto, perche' la regressione deve tirare in tutt'e due i versi


def test_lo_storico_pieno_regredisce_verso_l_ancora_e_non_la_sostituisce():
    """R1 aveva ragione sul grezzo: l'equivalente non si spedisce cosi' come e'.

    Con dieci partite il peso e' pieno, quindi quello che resta e' esattamente `b` dell'eccesso.
    """
    fm, confidence, matches = projection.fm_from_abroad(
        EQUIV_GOOD, 10, ANCHOR_C, "default", "classic", "C")
    beta = projection.BETA_ABROAD["default"]["classic"]
    assert abs(fm - (ANCHOR_C + beta * (EQUIV_GOOD - ANCHOR_C))) < 1e-9
    assert ANCHOR_C < fm < EQUIV_GOOD, "sta fra l'ancora e il suo equivalente, mai fuori"
    assert matches == 10
    assert abs(confidence - (projection.CONFIDENCE_ABROAD_FLOOR
                             + projection.CONFIDENCE_ABROAD_SPAN)) < 1e-9


def test_regredisce_anche_al_rialzo_cosi_non_e_una_potatura():
    """Uno sconto che puo' solo abbassare sarebbe una tosatura, non una previsione."""
    fm, _, _ = projection.fm_from_abroad(EQUIV_POOR, 10, ANCHOR_C, "default", "classic", "C")
    assert EQUIV_POOR < fm < ANCHOR_C


def test_sotto_dieci_partite_il_resto_lo_mette_l_ancora():
    """«Dobbiamo sempre avere uno storico di almeno 10 partite verosimili» (operatore, 19/08/2026).

    Otto partite sue e due dell'ancora: e' `estimate.shrink` applicato qui, e il numero deve stare fra
    l'ancora e quello che avrebbe con dieci partite proprie.
    """
    thin, thin_confidence, matches = projection.fm_from_abroad(EQUIV_GOOD, 8, ANCHOR_C, "default", "classic", "C")
    full, full_confidence, _ = projection.fm_from_abroad(EQUIV_GOOD, 10, ANCHOR_C, "default", "classic", "C")
    assert ANCHOR_C < thin < full
    assert thin_confidence < full_confidence, "meno partite, meno confidenza, e la riga lo dice"
    assert matches == 8, "e le partite viaggiano col numero: nessuno legga otto come una stagione"
    assert projection.fm_from_abroad(EQUIV_GOOD, 0, ANCHOR_C, "default", "classic", "C") is None, (
        "zero partite non sono un ramo che ha risposto: sono l'ancora, e la dichiara il gradino dopo")


def test_il_portiere_non_passa_da_questo_ramo():
    """Misurato: euro n=54, ancora 0.3190 contro 0.3217 (-0.9%), ottimo suo 0.30 e nessun guadagno.

    Con b = 0 il ramo restituirebbe l'ancora sotto l'etichetta `abroad`, cioe' una riga che dichiara una
    fonte che non ha usato. Quindi torna None e risponde il gradino dopo.
    """
    assert projection.fm_from_abroad(EQUIV_GOOD, 30, 5.10, "default", "classic", "P") is None
    assert projection.fm_from_abroad(EQUIV_GOOD, 30, 5.10, "euro", "classic", "P") is None
    assert projection.BETA_ABROAD_KEEPER == 0.0


def test_i_quattro_beta_sono_per_piattaforma_E_GIOCO_e_interni_alla_griglia():
    """Quattro valori perche' a mantra l'ancora e' un'altra (frazionaria per slot), quindi l'eccesso che b
    misura e' un altro. Interni a (0, 1) per costruzione: 0 sarebbe l'ancora e 1 l'equivalente grezzo, e la
    misura respinge tutt'e due gli estremi.

    NESSUN ORDINAMENTO E' ASSERITO, ed e' deliberato: la prima versione di questo test pretendeva
    `mantra > classic` sulla base di una storia inventata attorno a una misura contaminata (vedi il commento
    di `BETA_ABROAD`). I quattro valori sono quello che dice la tabella e nient'altro.
    """
    assert projection.BETA_ABROAD == {"default": {"classic": 0.40, "mantra": 0.45},
                                      "euro": {"classic": 0.50, "mantra": 0.45}}, (
        "se questi cambiano, cambia la tabella misurata nel commento - non solo il test")
    for platform, per_game in projection.BETA_ABROAD.items():
        assert set(per_game) == {"classic", "mantra"}, f"{platform} non copre entrambi i giochi"
        for game, beta in per_game.items():
            assert 0.0 < beta < 1.0, f"{platform}/{game} adotterebbe un estremo della griglia"


def test_tutte_e_quattro_le_combinazioni_rispondono_e_ognuna_col_suo_numero():
    """Il difetto che questo test esiste per fermare: una coppia piattaforma-gioco che torna None e lascia
    Fpi sull'ancora senza dirlo, cioe' una colonna che su meta' dei fogli non fa niente."""
    answers = {}
    for platform in ("default", "euro"):
        for game in ("classic", "mantra"):
            answer = projection.fm_from_abroad(EQUIV_GOOD, 12, ANCHOR_C, platform, game, "C")
            assert answer is not None, f"{platform}/{game} non risponde"
            answers[(platform, game)] = answer[0]
    # TRE numeri distinti e non quattro, e non e' un difetto: i due fogli mantra hanno misurato lo stesso
    # 0.45 per strade indipendenti (piattaforme diverse, popolazioni diverse). Scritto qui perche' la prima
    # versione di questo test pretendeva quattro valori e ha preso se stessa.
    assert len(set(answers.values())) == 3
    assert answers[("default", "mantra")] == answers[("euro", "mantra")]
    assert answers[("default", "classic")] < answers[("euro", "classic")]


def test_un_gioco_che_non_esiste_non_inventa_un_coefficiente():
    assert projection.fm_from_abroad(EQUIV_GOOD, 12, ANCHOR_C, "default", "fantasy", "C") is None
    assert projection.fm_from_abroad(EQUIV_GOOD, 12, ANCHOR_C, "nowhere", "classic", "C") is None


def test_i_dodici_codici_mantra_arrivano_tutti_a_un_macro_ruolo():
    """Su un foglio mantra il ruolo e' `por`/`dc`/`pc`: senza la traduzione il portiere passerebbe da un
    ramo misurato a -0.9% e il calendario sarebbe zero per tutti, in silenzio."""
    from euroleghe_ingest.engine.model import MANTRA_BY_CLASSIC, MANTRA_ROLES

    for code in MANTRA_ROLES:
        assert projection.macro_role(code) in ("P", "D", "C", "A"), code
    for classic, codes in MANTRA_BY_CLASSIC.items():
        for code in codes:
            assert projection.macro_role(code) == classic
    # ...e il vocabolario classic passa da se', in tutt'e due i casi di maiuscola.
    for role in ("P", "D", "C", "A"):
        assert projection.macro_role(role) == role
        assert projection.macro_role(role.lower()) == role
    assert projection.macro_role("Dc") == "D", "l'app scrive i codici con la maiuscola"
    assert projection.macro_role("centrocampista") is None
    assert projection.macro_role(None) is None


def test_su_mantra_il_portiere_resta_fuori_e_l_attaccante_prende_il_suo_coefficiente():
    """Le due conseguenze della traduzione, misurate sul ruolo e non sulla stringa."""
    assert projection.fm_from_abroad(EQUIV_GOOD, 30, 5.10, "default", "mantra", "por") is None
    assert projection.fm_from_abroad(EQUIV_GOOD, 30, 5.10, "euro", "mantra", "por") is None
    assert projection.fm_from_abroad(EQUIV_GOOD, 30, ANCHOR_C, "euro", "mantra", "m") is not None
    # il calendario di un centravanti e' quello degli attaccanti, scritto `pc` o scritto `A`
    assert (projection.calendar_lift("pc", 100.0, 0.0)
            == projection.calendar_lift("A", 100.0, 0.0)
            == projection.CALENDAR_PER_100["A"])
    assert projection.calendar_lift("por", 100.0, 0.0) == projection.CALENDAR_PER_100["P"]
    for code in ("dc", "dd", "ds", "b"):
        assert projection.calendar_lift(code, 100.0, 0.0) == projection.CALENDAR_PER_100["D"]


def test_a_girone_completo_il_calendario_non_vale_niente():
    """La proprieta' che tiene onesto il selettore, e la ragione per cui e' una DEVIAZIONE.

    Il margine medio di un club su tutta la stagione E' la sua forza, che sta gia' dentro la fantamedia dei
    suoi giocatori. Applicarlo come livello darebbe un bonus permanente ai forti - lo stesso difetto del
    canale eta' e della costanza. Su tutta la stagione finestra e stagione coincidono: zero.
    """
    assert projection.calendar_lift("A", 120.0, 120.0) == 0.0
    assert projection.calendar_lift("A", None, 120.0) == 0.0, "un calendario ignoto non e' un calendario medio"
    assert projection.calendar_lift(None, 200.0, 0.0) == 0.0


def test_una_finestra_facile_paga_secondo_il_ruolo_e_il_portiere_paga_di_piu():
    """Il coefficiente e' misurato sul fantavoto VERO: la prima misura, senza i gol subiti, dava -0.006
    alla P e avrebbe spedito zero nel ruolo dove il calendario conta il doppio."""
    easier = 100.0                      # cento punti di Elo in piu' che nel resto della stagione
    keeper = projection.calendar_lift("P", easier, 0.0)
    forward = projection.calendar_lift("A", easier, 0.0)
    midfield = projection.calendar_lift("C", easier, 0.0)
    assert abs(keeper - projection.CALENDAR_PER_100["P"]) < 1e-9
    assert keeper > forward > midfield > 0
    # ...e simmetrico: una finestra difficile toglie quanto quella facile aggiunge.
    assert abs(projection.calendar_lift("C", -easier, 0.0) + midfield) < 1e-9


def test_lo_zero_e_quello_di_lead_e_il_macinatore_non_vince_per_volume():
    """Il caso dell'operatore: «non supervaluti chi ha delle fantamedie basse (Kelly, Pongracic)».

    Un difensore da 6.07 su 29 giornate contro un attaccante da 6.85 su 19: il TOTALE premia il primo,
    il margine sul rimpiazzo il secondo. E' la sola cura che non introduce parametri nuovi.
    """
    replacement = 5.87
    grinder_total = 29.1 * 6.07
    signing_total = 18.8 * 6.85
    assert grinder_total > signing_total, "sul totale (che e' Overall) vince il macinatore"
    grinder = projection.projection(29.1, 6.07, replacement)
    signing = projection.projection(18.8, 6.85, replacement)
    assert signing > grinder, "sul margine vince chi rende di piu' a partita"


def test_una_nota_dichiarata_entra_solo_dal_chiamante():
    """`projection` non ha di che leggere una nota, ed e' deliberato: «nothing under `engine/` reads a
    declared note». Quello che il chiamante sa entra come FATTORE sulla stagione che resta."""
    full = projection.projection(20.0, 6.50, 5.90)
    halved = projection.projection(20.0, 6.50, 5.90, availability=0.5)
    assert abs(halved - full * 0.5) < 1e-9


def test_vuoto_e_ignoto_anche_qui():
    assert projection.projection(None, 6.5, 5.9) is None
    assert projection.projection(20.0, None, 5.9) is None
    assert projection.projection(20.0, 6.5, None) is None, (
        "senza zero non c'e' margine: uno zero mancante non e' uno zero uguale a zero")


def test_i_tre_punti_fissi_della_scala():
    """Peggiore -> 1, media dei primi 250 -> 50, migliore -> 99. I numeri veri del foglio di Serie A."""
    worst, mean, best = 38.0, 158.0, 213.0
    assert projection.scale99(worst, mean, best, worst) == 1
    assert projection.scale99(mean, mean, best, worst) == 50
    assert projection.scale99(best, mean, best, worst) == 99


def test_nessuno_legge_zero_e_la_coda_resta_distesa():
    """Il difetto che ha fatto cambiare la scala: «uno come Stones con 6.4x16 non puo' avere Fpi=0».

    Con una retta sola fra i due soli punti alti, prolungata all'ingiu', lo zero cadeva a 102 fantapunti e
    183 uomini su 600 leggevano 0 insieme. Stones ne fa 103 ed e' il 417° di 600.
    """
    worst, mean, best = 38.0, 158.0, 213.0
    assert projection.scale99(103.0, mean, best, worst) == 28       # Stones
    assert projection.scale99(102.0, mean, best, worst) == 27       # Skorupski, portiere titolare
    assert projection.scale99(70.0, mean, best, worst) == 14        # Pisseri, terzo portiere
    assert projection.scale99(91.0, mean, best, worst) == 23
    # ...e sopra l'ancora non cambia NIENTE rispetto alla retta sola: stesso segmento, stessi numeri.
    assert projection.scale99(176.0, mean, best, worst) == 66       # Kelly
    assert projection.scale99(164.0, mean, best, worst) == 55       # Pongracic
    assert projection.scale99(207.0, mean, best, worst) == 94       # Yildiz


def test_le_due_pendenze_sono_diverse_ed_e_deliberato():
    """Il prezzo della scala a due tratti, fissato perche' nessuno lo scopra leggendo un grafico: sopra
    l'ancora un fantapunto vale piu' che sotto. L'argomento sta nel commento - sotto ci sono 108 uomini
    ammassati dalle costanti di ripiego, cioe' una zona senza informazione da preservare."""
    worst, mean, best = 38.0, 158.0, 213.0
    sopra = projection.scale99(mean + 20, mean, best, worst) - 50
    sotto = 50 - projection.scale99(mean - 20, mean, best, worst)
    assert sopra > sotto, "sopra l'ancora la scala e' piu' fine, ed e' la zona che decide un'asta"


def test_vuoto_resta_vuoto_anche_sulla_scala():
    assert projection.scale99(None, 158.0, 213.0, 38.0) is None
    assert projection.scale99(150.0, None, 213.0, 38.0) is None
    assert projection.scale99(150.0, 158.0, None, 38.0) is None
    assert projection.scale99(150.0, 158.0, 213.0, None) is None
    assert projection.scale99(150.0, 213.0, 158.0, 38.0) is None, "media sopra il massimo: pool incoerente"
    assert projection.scale99(150.0, 20.0, 213.0, 38.0) is None, "media sotto il minimo: pool incoerente"


def test_l_ancora_e_la_media_dei_primi_250_e_non_di_tutti():
    """La precisazione dell'operatore, e la ragione per cui conta: con la media di TUTTI il riferimento
    e' 121 e un difensore mediocre che gioca sempre legge 73; con quella dei primi 250 e' 158 e legge 56."""
    pool = [float(200 - i) for i in range(300)]          # 200, 199, ... 
    assert projection.anchor_value(pool) == sum(pool[:250]) / 250
    assert projection.anchor_value(pool) > sum(pool) / len(pool), (
        "la media dei primi e' per forza sopra quella di tutti: e' il punto")
    assert projection.anchor_value(pool[:100]) is None, "pool piu' corta del riferimento: non si risponde"
    assert projection.anchor_value([None, None]) is None
    assert projection.ANCHOR_TOP == 250


def test_chi_sceglie_i_250_e_una_colonna_e_chi_li_media_e_un_altra():
    """«I primi 250 per OVERALL» (operatore): la selezione la fa Overall, la media si prende su Fpi.

    Serve perche' un'ancora definita dalla colonna che sta scalando si sposta da sola a ogni ritocco di
    quella colonna. Qui Fpi e Overall sono deliberatamente in ordine OPPOSTO, cosi' se la selezione
    tornasse a farla Fpi il test se ne accorge.
    """
    overall = [float(i) for i in range(300)]          # il migliore per Overall e' l'ultimo
    fpi = [float(300 - i) for i in range(300)]        # ...e per Fpi e' il primo
    picked = projection.anchor_value(fpi, ranked_by=overall)
    alone = projection.anchor_value(fpi)
    assert picked < alone, "scegliendo per Overall si prendono uomini con Fpi basso, ed e' il punto"
    assert abs(picked - sum(fpi[50:]) / 250) < 1e-9
