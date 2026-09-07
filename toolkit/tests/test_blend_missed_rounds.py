"""Le giornate saltate per infortunio si sottraggono sulla SCALA della miscela, non su quella di una stagione.

Dal caso Berardi (operatore, 07/09/2026): «mi dici panchina ma in realta' e' un titolarissimo che gioca
poco per via dei continui infortuni». `appearance_share` e' CONDIZIONALE per costruzione - «delle partite
in cui e' disponibile» - e la miscela del 04/09 aveva rotto quella condizionalita' per il prior: il
denominatore era diventato una miscela di due stagioni e la sottrazione era rimasta di una sola.
"""
import inspect

from euroleghe_ingest.engine import presence
from euroleghe_ingest.modules import snapshot

# 26 giornate a voto su 38, DIECI saltate per infortunio (il suo 2025-26 vero: stop di 6, 5 e 56 giorni).
BERARDI_PREV = presence.SeasonWindow(appearances=26, starts=26, minutes=1800, minutes_here=1800,
                                     rounds=38, missed=10)
# ...e quest'anno una delle due giornate l'ha saltata: lo stop 16/07 -> 26/08 copre la prima.
BERARDI_NOW = presence.SeasonWindow(appearances=1, starts=0, minutes=18, minutes_here=18,
                                    rounds=2, missed=1)


def _conditional(window: presence.SeasonWindow) -> float:
    """La quota che `presence.contested` produce: presenze sulle giornate in cui era disponibile."""
    return window.appearances / max(window.rounds - window.missed, 1.0)


def test_the_prior_keeps_its_own_conditional_reading():
    """26 su 38 con dieci saltate sono 26/28 = 0,929, e il prior deve entrare con QUELLA quota.

    E' il numero che l'operatore descrive: un uomo che gioca quasi sempre quando c'e'. La quota grezza
    (0,684) e' una frase su chi il suo allenatore sceglie due volte su tre, che e' un'altra cosa.
    """
    assert round(_conditional(BERARDI_PREV), 3) == 0.929
    assert round(BERARDI_PREV.appearances / BERARDI_PREV.rounds, 3) == 0.684


def test_the_prior_contributes_K_rounds_of_CONTENDED_football_and_not_of_calendar():
    """L'INVARIANTE del peso, che e' il cuore della correzione: `K` giornate di prova, non di calendario.

    `season_prior_rounds` = 5 e' stato misurato come «quante giornate di prova vale la stagione scorsa»
    per `appearance_share`, e la prova su quella quantita' sono le giornate in cui era DISPONIBILE:
    riscalare sul calendario mette le due meta' della miscela in due unita'. Berardi contende 28 giornate
    (38 meno dieci di infermeria), quindi il prior entra a 5/28 e porta esattamente CINQUE giornate
    contendibili - il che si asserisce come identita' e non come cifra, cosi' il test regge se la costante
    si muove.
    """
    prior_only = presence.blend_seasons(presence.SeasonWindow(), BERARDI_PREV)
    contended = prior_only.rounds - prior_only.missed
    assert round(contended, 6) == presence.DEFAULTS.season_prior_rounds
    # ...e la quota che porta e' la SUA, condizionale: 26 su 28.
    assert round(prior_only.appearances / contended, 3) == 0.929


def test_the_blend_scales_the_absences_with_the_denominator_they_come_off():
    """Dieci giornate in una stagione riscalata a cinque non sono dieci giornate della miscela.

    E' il verso opposto dello stesso errore di unita': sommate grezze, la sottrazione andrebbe sotto zero,
    `contested` tapperebbe a 1,0 e la quota leggerebbe 1,000 - cioe' `bandiera` per chiunque si sia rotto
    per due mesi. Con il peso del prior (5/28) sono 1 + 10 x (5/28) = 2,79.
    """
    blended = presence.blend_seasons(BERARDI_NOW, BERARDI_PREV)
    assert round(blended.missed, 2) == 2.79
    assert blended.missed < blended.rounds, "una sottrazione non puo' svuotare il proprio denominatore"
    assert round(_conditional(blended), 3) == 0.940
    # ...e senza il campo la stessa miscela leggeva due gradini piu' in basso (il foglio diceva 0,733).
    naked = presence.blend_seasons(
        presence.SeasonWindow(appearances=1, starts=0, minutes=18, minutes_here=18, rounds=2),
        presence.SeasonWindow(appearances=26, starts=26, minutes=1800, minutes_here=1800, rounds=38))
    assert round(naked.appearances / max(naked.rounds - 1, 1.0), 3) == 0.737


def test_a_prior_can_never_be_inflated_beyond_the_football_it_contains():
    """IL TAPPO A 1,0, e senza di lui il caso limite riapre il difetto per cui la miscela esiste.

    Chi era disponibile per tre giornate ne porterebbe cinque, cioe' due inventate; e chi ha saltato
    l'intera stagione sottrae tutto il proprio denominatore e si CANCELLA, lasciando l'uomo sulle due
    partite di quest'anno - `bandiera` su due partite, che e' quello che il foglio del 07/09 leggeva su
    Pieragnolo (0,300 -> 1,000) e Frigan (0,200 -> 0,700) con la prima versione di questa correzione.
    """
    thin = presence.SeasonWindow(appearances=2, starts=2, minutes=150, minutes_here=150,
                                 rounds=38, missed=35)
    prior_only = presence.blend_seasons(presence.SeasonWindow(), thin)
    assert prior_only.rounds == 38 and prior_only.missed == 35, "non si gonfia: entra per quello che e'"
    assert prior_only.rounds - prior_only.missed == 3 < presence.DEFAULTS.season_prior_rounds
    # ...e chi non ha nemmeno una giornata contendibile non entra affatto: la decisione di cosa metterci
    # al suo posto e' di `prior_window`, che gli da' il prior sintetico della sua popolazione.
    never = presence.SeasonWindow(appearances=0, rounds=38, missed=38)
    assert presence.blend_seasons(presence.SeasonWindow(appearances=2, rounds=2), never).rounds == 2.0


def test_a_man_who_was_never_hurt_is_untouched():
    """Il campo e' additivo e parte da zero: chi non ha assenze non paga niente per averle."""
    now = presence.SeasonWindow(appearances=2, starts=2, minutes=180, minutes_here=180, rounds=2)
    prev = presence.SeasonWindow(appearances=36, starts=30, minutes=2278, minutes_here=2278, rounds=38)
    assert presence.blend_seasons(now, prev).missed == 0.0


def test_the_synthetic_prior_carries_no_absences_because_the_median_already_paid_them():
    """La mediana di popolazione (0,282 per un attaccante) e' la quota REALIZZATA, infortuni compresi.

    Sottrarne altre conterebbe due volte cio' che quel numero ha gia' pagato - la stessa ragione per cui
    `est.presences_with_seen` non si applica dove R20 ha gia' mescolato le giornate viste.
    """
    window = snapshot.prior_window(None, {}, {}, 38.0, "A", "default", missed=7)
    assert window.appearances > 0, "il prior sintetico esiste"
    assert window.missed == 0.0, "la mediana contiene gia' gli infortuni della sua popolazione"


def test_an_unknown_absence_is_not_a_subtraction():
    """`None` significa «quella stagione non ha un calendario da contare», e un ignoto non si sconta.

    «Vuoto = ignoto, mai zero» applicato al verso prudente: sottrarre un'assenza che nessuno ha contato
    ALZEREBBE la quota, cioe' lusingherebbe l'uomo per un dato che non abbiamo.
    """
    window = snapshot.prior_window({"matches": 26, "starts": 26}, {"minutes": 1800},
                                   {"minutes": 1800}, 38.0, "A", "default", missed=None)
    assert window.missed == 0.0


def test_a_preseason_sheet_reads_the_raw_figure_exactly_as_before():
    """INERTE dove il gate ha pubblicato: li' il denominatore e' di una stagione sola.

    Su una pre-stagione `desc_season_rounds` resta `measured_rounds` e non `blended.rounds`, quindi la
    cifra da sottrarre deve restare grezza: due scale diverse nella stessa sottrazione sono il difetto
    che questa correzione cura. Si asserisce la CONDIZIONE nel codice, perche' e' cio' che tiene ferme le
    dieci finestre del gate - e le due righe devono stare sulla STESSA condizione, o una sottrarrebbe da
    un denominatore dell'altra.
    """
    source = inspect.getsource(snapshot.build_rows)
    assert '"desc_injury_rounds_measured": (_round(blended.missed, 2) if now_rounds' in source, \
        "in-season la cifra e' miscelata, in pre-stagione e' grezza"
    assert 'else injury.get("rounds_measured")' in source
    assert '"desc_season_rounds": (_round(blended.rounds, 1) if now_rounds' in source


def test_the_prior_season_absences_are_acquired_and_not_invented():
    """La cifra del prior viene da `injury_history`, che cammina le giornate: non e' una stima.

    `rounds_previous` e' contato da `snapshot.rounds_missed` sulle partite di campionato del suo club
    dentro l'unione dei suoi stop - la stessa funzione, la stessa unita' e lo stesso calendario di
    `rounds_measured`, cosi' le due meta' della sottrazione non possono venire da due misure diverse.
    """
    assert "previous" in inspect.signature(snapshot.injury_history).parameters
    source = inspect.getsource(snapshot.injury_history)
    assert 'entry["rounds_previous"] = mine.get(previous) if previous in mine else None' in source, \
        "una stagione senza calendario da contare resta ignota e non diventa uno zero"
    # ...e il chiamante passa la stagione di INPUT, che e' quella su cui il prior e' costruito.
    assert "previous=window.input_season" in inspect.getsource(snapshot.run)
