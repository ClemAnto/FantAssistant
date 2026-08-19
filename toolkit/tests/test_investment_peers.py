"""Il reparto PESATO e la retta dell'investimento: test di sola formula, nessun DB.

Due esistono per fermare un'idea invece che per fissare un'aritmetica: il reparto che conta i rivali
invece di pesarli (era il macro-ruolo, e leggeva Leao come rivale pieno di Ramos - misurato -0.6% su
default con una finestra a -7.3%), e la retta dell'investimento usata come SOSTITUTO di quella sui minuti
invece che come raffinamento, che con un ingrediente mancante darebbe uno zero al posto di un ignoto.
"""

from __future__ import annotations

from euroleghe_ingest.engine import estimate as est

# I profili veri, contati sulle partite di club delle ultime due stagioni (Transfermarkt, 19/08/2026).
RAMOS = {14: 0.68, 13: 0.10, 10: 0.03}          # 68% centravanti
LEAO = {11: 0.60, 14: 0.27, 13: 0.06}           # 60% esterno sinistro, 27% centravanti
GIMENEZ = {14: 1.00}                            # centravanti puro
BASTONI = {3: 0.94, 4: 0.06}                    # difensore centrale


def test_la_rivalita_e_una_quota_e_non_un_si_o_un_no():
    """Il caso che ha aperto tutto: «e' vero che hanno giocato in quel ruolo ma in pochissime situazioni».

    E si somma su TUTTE le posizioni, non solo sulla dominante: Ramos e Leao si contendono il centravanti
    (min 0.68, 0.27 = 0.27) E la seconda punta (min 0.10, 0.06 = 0.06), quindi 0.33. La prima versione di
    questo test pretendeva 0.27 ragionando su una maglia sola e ha preso se stessa - due uomini che si
    incrociano in due posti si contendono piu' di due che si incrociano in uno.
    """
    assert abs(est.rivalry(RAMOS, GIMENEZ) - 0.68) < 1e-9, "due centravanti si contendono tutto"
    assert abs(est.rivalry(RAMOS, LEAO) - 0.33) < 1e-9
    assert est.rivalry(RAMOS, LEAO) < est.rivalry(RAMOS, GIMENEZ), (
        "e comunque Leao morde meno di un centravanti puro, che e' il punto")
    assert est.rivalry(RAMOS, BASTONI) == 0.0, "un centravanti e un centrale non si contendono niente"


def test_la_rivalita_e_simmetrica_e_sta_fra_zero_e_uno():
    for a, b in ((RAMOS, LEAO), (LEAO, GIMENEZ), (RAMOS, BASTONI)):
        assert abs(est.rivalry(a, b) - est.rivalry(b, a)) < 1e-9
        assert 0.0 <= est.rivalry(a, b) <= 1.0
    assert abs(est.rivalry(GIMENEZ, GIMENEZ) - 1.0) < 1e-9


def test_un_rivale_al_27_percento_conta_il_27_percento_del_suo_valore():
    """E' cosi' che Leao esce dal reparto di Ramos senza doverlo dichiarare a mano.

    Milan 2026-27 ai valori veri: Ramos 50M, Leao 50M al 27%, Nkunku 25M al 68%, Gimenez 18M al 100%.
    Il rivale che morde e' Gimenez (18) contro Nkunku (17) e Leao (13,5), non il piu' caro.
    """
    rivals = [(0.27, 50.0), (0.68, 25.0), (1.00, 18.0)]
    top = est.weighted_top(50.0, rivals)
    assert abs(top - 50.0 / 18.0) < 1e-9
    # ...e contandoli invece di pesarli vincerebbe Leao, che e' la lettura che la misura ha respinto.
    naive = 50.0 / max(worth for _weight, worth in rivals)
    assert naive < top, "il reparto pesato riconosce che non ha un rivale vero, quello contato no"


def test_chi_non_ha_rivali_leggibili_prende_il_tappo_e_non_un_ignoto():
    assert est.weighted_top(50.0, []) == est.INVESTMENT_TOP_CAP
    assert est.weighted_top(50.0, [(0.0, 90.0)]) == est.INVESTMENT_TOP_CAP
    assert est.weighted_top(None, [(1.0, 10.0)]) is None, "senza il suo valore non c'e' rapporto"


def test_il_tappo_morde_e_non_lascia_scappare_il_rapporto():
    assert est.weighted_top(500.0, [(1.0, 1.0)]) == est.INVESTMENT_TOP_CAP


def test_la_retta_dell_investimento_e_un_raffinamento_e_non_un_sostituto():
    """Senza i due termini nuovi non ha niente da aggiungere: torna None e il chiamante tiene la retta
    sui minuti. Uno zero direbbe «non giochera'», che e' un'altra frase."""
    assert est.presences_from_investment(38, "default", 0.476, None, 0.9) is None
    assert est.presences_from_investment(38, "default", 0.476, 2.78, None) is None
    assert est.presences_from_investment(38, "default", None, 2.78, 0.9) is None
    assert est.presences_from_investment(None, "default", 0.476, 2.78, 0.9) is None
    assert est.presences_from_investment(38, "nowhere", 0.476, 2.78, 0.9) is None


def test_essere_il_piu_pagato_del_reparto_alza_le_presenze_e_l_ultimo_le_abbassa():
    """La discriminazione che l'operatore chiedeva, nelle due direzioni."""
    for platform, calendar in (("default", 38), ("euro", 31)):
        first = est.presences_from_investment(calendar, platform, 0.476, 2.78, 0.95)
        last = est.presences_from_investment(calendar, platform, 0.476, 0.20, 0.30)
        assert first > last, platform
        assert 0 <= last and first <= calendar


def test_i_coefficienti_sono_per_piattaforma_e_pesano_ancora_i_minuti():
    """Il termine sui minuti resta il piu' grande: l'investimento aggiunge quello che i minuti non dicono,
    e se un giorno lo scavalcasse vorrebbe dire che la misura e' cambiata, non il test."""
    assert set(est.INVESTMENT_SHARE) == {"default", "euro"}
    for platform, (_intercept, on_abroad, on_top, on_value) in est.INVESTMENT_SHARE.items():
        assert on_abroad > on_value > on_top > 0, platform


def test_la_quota_di_ripiego_e_del_RUOLO_e_non_di_tutti_i_ruoli():
    """«Un terzo portiere dovrebbe avere pv=0, perche' risulta 15?» (operatore, 19/08/2026).

    Aveva ragione: la costante era misurata a ruoli mescolati e per un portiere era tre volte troppo alta.
    Il 77% dei portieri di quella popolazione non gioca affatto e la loro mediana e' zero.
    """
    for platform, calendar in (("default", 38), ("euro", 31)):
        keeper = est.default_presences(calendar, platform, "unmeasured", "P")
        midfielder = est.default_presences(calendar, platform, "unmeasured", "C")
        pooled = est.default_presences(calendar, platform, "unmeasured")
        assert keeper < pooled < midfielder, platform
        assert keeper < calendar * 0.15, f"{platform}: un portiere di ripiego non fa un sesto di stagione"


def test_senza_ruolo_risponde_l_aggregato_che_e_ancora_vero():
    """Il ruolo e' opzionale di proposito: un chiamante che non lo sa riceve la quota della popolazione
    intera, che e' quello che spediva prima ed e' ancora vera SU DI ESSA."""
    assert (est.default_presences(38, "default", "unmeasured")
            == round(38 * est.PRESENCE_SHARE["unmeasured"]["default"], 1))
    assert est.default_presences(38, "default", "unmeasured", "ruolo-che-non-esiste") == \
        est.default_presences(38, "default", "unmeasured")


def test_i_quattro_ruoli_pesati_ridanno_l_aggregato_in_vigore():
    """Il controllo che rende la divisione adottabile: non si sta cambiando la misura, la si sta
    DIVIDENDO. Pesati sulla loro numerosita' i quattro ruoli danno 0.272 su default e 0.207 su euro,
    cioe' lo 0.29 e lo 0.19 che erano in vigore. Se un giorno divergessero, e' la misura da rifare."""
    counts = {"default": {"P": 178, "D": 298, "C": 296, "A": 211},
              "euro": {"P": 186, "D": 234, "C": 269, "A": 177}}
    for platform, sizes in counts.items():
        shares = est.PRESENCE_SHARE_BY_ROLE["unmeasured"][platform]
        weighted = sum(shares[role] * n for role, n in sizes.items()) / sum(sizes.values())
        assert abs(weighted - est.PRESENCE_SHARE["unmeasured"][platform]) < 0.03, platform
