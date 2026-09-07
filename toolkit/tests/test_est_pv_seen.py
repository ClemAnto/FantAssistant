"""`est_pv` legge le giornate GIA' giocate, e la sua K e' quella della scala.

Nato dalla richiesta dell'operatore del 07/09/2026 («vorrei che le partite della stagione corrente
influenzino maggiormente le valutazioni») e dal difetto che quella richiesta ha fatto emergere: Varela del
Monza, 2 partite su 2 da titolare e 2 gol, leggeva `est_pv` 10,2 su 36 con una nota che diceva «nothing
measured anywhere». `presence.blend_seasons` legge la stagione in corso dal 04/09 e la cascata di ripiego
no, quindi due colonne dello stesso uomo rispondevano alla stessa domanda su due campioni diversi.
"""
import inspect

from euroleghe_ingest.engine import estimate as est
from euroleghe_ingest.engine import presence
from euroleghe_ingest.modules import snapshot


def test_the_blend_is_inert_before_a_ball_is_kicked():
    """A zero giornate viste il gradino esce INTATTO: e' cio' che tiene ferma ogni finestra del gate.

    La forma e' quella di R20 (`model.blend_with_seen`), che a `k` = 0 restituisce il prior senza toccarlo.
    Su una pre-stagione `matchdays_seen` e' 0 e `pv_seen` e' None - due guardie e non una, perche' «vuoto =
    ignoto» e uno zero misurato arrivano identici da una colonna assente.
    """
    assert est.presences_with_seen(10.2, 36, None, 0, 5.0) == 10.2
    assert est.presences_with_seen(10.2, 36, 0, 0, 5.0) == 10.2
    assert est.presences_with_seen(10.2, 36, None, None, 5.0) == 10.2
    # ...e un gradino senza previsione resta senza previsione: non si inventa un numero da due partite.
    assert est.presences_with_seen(None, 36, 2, 2, 5.0) is None


def test_the_blend_moves_toward_the_football_he_has_actually_played():
    """Il caso Varela, con i suoi numeri, e il verso in TUTT'E DUE le direzioni.

    Chi ha giocato tutto sale, chi non ha giocato niente scende: una miscela che potesse solo alzare
    sarebbe un premio e non una misura - la stessa ragione per cui la regressione di `est.regress` tira
    da entrambi i lati.
    """
    # 2 su 2 con la costante degli attaccanti (0.282 x 36 = 10.2): (2 x 1.000 + 5 x 0.283) / 7 = 0.488
    assert est.presences_with_seen(10.2, 36, 2, 2, 5.0) == 17.6
    # ...e lo stesso uomo che non e' mai sceso in campo nelle stesse due giornate
    assert est.presences_with_seen(10.2, 36, 0, 2, 5.0) == 7.3
    # Un titolare che il ripiego prezzava basso non arriva a 36: due giornate non sono una stagione.
    assert est.presences_with_seen(10.2, 36, 2, 2, 5.0) < 36


def test_a_share_can_never_exceed_the_calendar():
    """Il tappo e' quello che la retta dell'estero dichiara per se': un ingresso fuori range, non una pulizia."""
    assert est.presences_with_seen(36.0, 36, 2, 2, 5.0) == 36.0
    assert est.presences_with_seen(40.0, 36, 2, 2, 5.0) == 36.0


def test_the_prior_carries_information_so_reading_only_the_two_matches_is_refused():
    """K = 0 sarebbe un INTERRUTTORE, ed e' stato misurato NEGATIVO (-3.7% su `default`/anchor a k = 2).

    Il test non rimisura: protegge la FORMA. A K = 0 la funzione restituisce la quota osservata pura, cioe'
    la cosa che la misura ha respinto, quindi la costante adottata deve essere maggiore di zero e il
    chiamante deve leggere quella e non uno zero.
    """
    assert est.presences_with_seen(10.2, 36, 2, 2, 0.0) == 36.0, "a K = 0 due partite diventano una stagione"
    assert presence.DEFAULTS.season_prior_rounds > 0


def test_the_call_site_reads_the_ladder_own_K_and_never_a_number_of_its_own():
    """UNA definizione e DUE lettori: la scala della titolarita' e `est_pv` mescolano con la STESSA K.

    E' la ragione per cui la contraddizione fra `desc_titolarita_play` e `est_pv/36` si chiude per
    costruzione invece di rimpicciolirsi: con due K le due colonne resterebbero in disaccordo, e per un
    motivo che nessuno puo' leggere sulla riga. Un secondo numero scritto qui e' esattamente il difetto
    che questo repository paga da sempre (due letture dello stesso foglio, due valutazioni per un uomo),
    quindi si asserisce la SORGENTE e non il valore - cosi' uno sweep che muova la costante non rompe il
    test e muove entrambi i lettori.
    """
    source = inspect.getsource(snapshot.estimate_for)
    assert "presence.DEFAULTS.season_prior_rounds" in source, \
        "la K si legge da dove vive, non si riscrive qui"
    assert "presences_with_seen" in source
    # ...e SOLO dove il motore non prevede le presenze: dove le prevede, quel numero porta gia' le
    # giornate viste (R20) e rimescolarle le conterebbe due volte - vedi il test della guardia.
    assert "if guess.estimated and (" in source, "il core non passa da qui"


def test_the_two_readers_agree_on_the_same_man():
    """La prova che la cura CHIUDE la contraddizione invece di spostarla, sull'aritmetica e non su un foglio.

    La scala mescola `appearances/contested` con il prior di popolazione; `est_pv` mescola la costante di
    quel gradino con la stessa quota osservata e la stessa K. Dove il prior del gradino e' la mediana della
    stessa popolazione, le due letture devono coincidere - e Varela lo mostra: la scala legge 0,486 e
    `est_pv/36` leggeva 0,283, che era lo scarto piu' grosso della sua riga.
    """
    blended = est.presences_with_seen(10.2, 36, 2, 2, presence.DEFAULTS.season_prior_rounds)
    assert abs(blended / 36 - 0.486) < 0.02, \
        "con la stessa K e lo stesso osservato le due colonne devono dire la stessa cosa"


def test_the_blend_never_lands_on_top_of_R20():
    """DOVE IL MOTORE PREVEDE LE PRESENZE, la cascata restituisce la SUA previsione - e quella le giornate
    viste le porta gia' (R20, gate §7-duotricies). Rimescolarle qui e' lo stesso fatto contato due volte.

    Il caso non e' teorico e non e' raro: su `shrunk` il core rifiuta la FANTAMEDIA («only 11 votes of 15»)
    e le presenze le prevede comunque, quindi `est_pv` E' `engine_pv_pred` su 111 righe di 325 del foglio
    del 07/09 - Meret fra loro. Per questo la guardia guarda `prediction.pv_pred` e non il nome del
    gradino: `anchor` si spacca 166/14 su quella domanda, quindi il gradino non la risponde.
    """
    import inspect
    from types import SimpleNamespace

    from euroleghe_ingest.engine import features

    source = inspect.getsource(snapshot.estimate_for)
    assert "prediction is None or prediction.pv_pred is None" in source, \
        "la guardia e' sulla previsione del motore, non sul nome del gradino"

    layer = {"role_bonus": {"A": 0.74}, "club_level": {}, "players": {}, "elo_mean": 1690.0}
    window = features.Window("GUARD", "2025-26", "2026-27", "2026-09-07")
    data = SimpleNamespace(matchdays_target=36, matchdays_seen=2)
    obs = SimpleNamespace(fc_id=1, role_classic="A", club_target="Napoli", elo_target=1700.0,
                          fm_prev=None, mv_prev=None, pv_prev=11, mv_seen=None, pv_seen=2)
    # il motore prevede le presenze e NON la fantamedia: il gradino e' di ripiego, il pv e' suo
    prediction = SimpleNamespace(fm_pred=None, pv_pred=17.5, anchor=6.83)
    guess = snapshot.estimate_for(obs, prediction, layer, {"A": 6.83}, data, window, "default")
    assert guess.estimated, "senza fantamedia il gradino non e' il core"
    assert guess.pv == 17.5, "le presenze del motore restano quelle del motore: R20 le ha gia' mescolate"
