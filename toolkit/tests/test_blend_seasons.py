"""Due giornate non sono una stagione: la miscela delle finestre (`presence.blend_seasons`).

Nata dalle correzioni dell'operatore del 04/09/2026 su due nomi - «Kean e' riserva perche' e' appena
arrivato ... Pa = 22 e' troppo poco» e «Kolo Muani risulta una bandiera, quindi giochera' quasi sempre,
perche' risulta che Pa = 20 solo?» - e dall'audit che ne e' seguito: sul foglio del 03/09/2026, 313
righe su 358 avevano un gradino in disaccordo con il proprio Pa, perche' il gradino leggeva DUE partite
di questa stagione e il Pa leggeva quella scorsa.

La sua istruzione, che e' quello che questo file misura: «2 partite non devono valere una stagione ma
solo 2/38 di stagione ... troppo poco per bastare da sole. Quindi, partendo dal fatto che le 2 partite
della stagione corrente sono MOLTO significative, dobbiamo completare il quadro con le partite pregresse:
in maniera molto lieve con le amichevoli stagionali e con i valori della stagione scorsa.»
"""

from __future__ import annotations

from dataclasses import replace

from euroleghe_ingest.engine import presence

#: Le due finestre dei due casi veri, dal foglio del 03/09/2026.
DOUVIKAS_NOW = presence.SeasonWindow(appearances=2, starts=2, minutes=180, minutes_here=180, rounds=2)
DOUVIKAS_PREV = presence.SeasonWindow(appearances=36, starts=30, minutes=2278, minutes_here=2278,
                                      rounds=38)
#: Kean: un ingresso da 27 minuti, e quei minuti sono del club che ha LASCIATO.
KEAN_NOW = presence.SeasonWindow(appearances=1, starts=0, minutes=27, minutes_elsewhere=27, rounds=2)
KEAN_PREV = presence.SeasonWindow(appearances=26, starts=22, minutes=2047, minutes_elsewhere=2047,
                                  rounds=38)


def _share(window: presence.SeasonWindow) -> float:
    return window.appearances / window.rounds


def test_a_preseason_sheet_reads_exactly_what_it_read_before():
    """Nessuna finestra in corso = la stagione precedente, INTATTA come quota.

    E' la proprieta' che rende la miscela inerte su ogni finestra pubblicata dal gate: quelle sono tutte
    pre-stagione, `now.rounds` e' zero e la quota che esce e' identica a quella che entra. Senza questo,
    ogni numero pubblicato andrebbe rimisurato.
    """
    blended = presence.blend_seasons(presence.SeasonWindow(), DOUVIKAS_PREV)
    assert _share(blended) == _share(DOUVIKAS_PREV)
    assert blended.rounds == presence.DEFAULTS.season_prior_rounds
    assert blended.minutes / blended.appearances == DOUVIKAS_PREV.minutes / DOUVIKAS_PREV.appearances


def test_two_matches_do_not_make_a_season():
    """Due giornate su dieci di prior pesano un sesto, non tutto - e non 2/38.

    Il difetto curato aveva DUE facce opposte e questo test le tiene insieme: chi ha giocato tutte e due
    leggeva 1,000 (Douvikas `titolare` a 75') e chi ne ha giocata una da riserva leggeva quasi zero.
    """
    blended = presence.blend_seasons(DOUVIKAS_NOW, DOUVIKAS_PREV)
    assert blended.rounds == 2.0 + presence.DEFAULTS.season_prior_rounds
    assert 0.94 < _share(blended) < 0.97                           # era 1,000 su due partite
    weight = 2.0 / blended.rounds
    assert abs(_share(blended) - (weight * 1.0 + (1 - weight) * (36 / 38))) < 1e-9


def test_the_new_signing_keeps_the_football_he_played_elsewhere():
    """Kean: 0,65 di quota invece di 0,03, e i minuti restano ALTROVE.

    La meta' che conta e' la seconda: `at_club_weight` legge la divisione qui/altrove, quindi mescolare
    le presenze e non i minuti gli darebbe una quota da titolare senza lo sconto dell'arrivo. Le due
    metrics viaggiano insieme o la scala dell'una non e' la scala dell'altra.
    """
    blended = presence.blend_seasons(KEAN_NOW, KEAN_PREV)
    assert 0.60 < _share(blended) < 0.70
    assert blended.minutes_here == 0.0
    assert blended.minutes_elsewhere > 0.0


def test_the_friendlies_weigh_lightly_and_say_nothing_about_minutes():
    """«In maniera molto lieve»: un ritiro sposta la quota di poco, e non i minuti a presenza.

    Un'amichevole dice SE il ritiro lo usa: i minuti si spartiscono per farli giocare tutti, quindi la
    finestra del ritiro entra senza minuti e il rapporto minuti/presenza resta quello del campionato.
    """
    friendly = presence.SeasonWindow(appearances=4, starts=4, rounds=4)
    with_camp = presence.blend_seasons(DOUVIKAS_NOW, DOUVIKAS_PREV, friendly)
    without = presence.blend_seasons(DOUVIKAS_NOW, DOUVIKAS_PREV)
    assert with_camp.rounds == without.rounds + presence.DEFAULTS.friendly_rounds
    assert 0 < _share(with_camp) - _share(without) < 0.01
    # ...E NON SPOSTA I MINUTI DI UN DECIMALE, che e' quello che il commento al punto di chiamata
    # prometteva mentre il codice aggiungeva una giornata da ZERO minuti a tutti: misurato su un titolare
    # da 85', la quota di minuti che `standing` legge scendeva di 0.060 a K=10 e di 0.100 a K=5, cioe' il
    # difetto peggiorava con la K adottata il 05/09. I minuti del ritiro sono ora imputati al tasso delle
    # altre finestre, ed e' questa uguaglianza a dirlo.
    assert (abs(with_camp.minutes / with_camp.rounds - without.minutes / without.rounds) < 1e-9)
    # e a peso zero il ritiro non esiste affatto, che e' come si spegne un canale senza toglierlo
    off = replace(presence.DEFAULTS, friendly_rounds=0.0)
    assert presence.blend_seasons(DOUVIKAS_NOW, DOUVIKAS_PREV, friendly, off) == without


def test_the_prior_is_rescaled_so_a_shorter_championship_is_not_a_weaker_one():
    """34 giornate di Bundesliga valgono come 38 di Serie A: quello che conta e' la QUOTA, non la lunghezza."""
    long_season = presence.SeasonWindow(appearances=19, starts=19, minutes=1710, minutes_here=1710,
                                        rounds=38)
    short_season = presence.SeasonWindow(appearances=17, starts=17, minutes=1530, minutes_here=1530,
                                         rounds=34)
    now = presence.SeasonWindow(appearances=2, starts=2, minutes=180, minutes_here=180, rounds=2)
    assert (_share(presence.blend_seasons(now, long_season))
            == _share(presence.blend_seasons(now, short_season)))


def test_the_weight_is_measured_here_and_is_not_r20s():
    """K = 5, misurata su QUESTA domanda - e deliberatamente diversa da quella di R20.

    Fino al 05/09/2026 questo test asseriva l'opposto: che `season_prior_rounds` FOSSE la K adottata dal
    gate per R20 su `default`. Era un prestito, e la misura lo ha smentito. R20 tara il tasso di cambio
    per l'ACCURATEZZA di `engine_pv_pred` su finestre a sei e dieci giornate giocate; qui la quantita' e'
    `appearance_share` e il momento e' k = 2, e su quella domanda l'ottimo fuori campione e' 5 (interno,
    piatto fra 4 e 6, stabile per stagione, e le 10 costano +1.8% di errore) - «una costante appartiene
    alla domanda su cui e' stata misurata».

    L'asserzione e' scritta al ROVESCIO apposta: che i due numeri siano DIVERSI. Se un domani qualcuno li
    riallinea per simmetria, questo test cade e lo obbliga a rileggere la misura invece di ereditarla.
    """
    from euroleghe_ingest.engine import evaluate

    assert presence.DEFAULTS.season_prior_rounds == 5.0
    assert presence.DEFAULTS.season_prior_rounds != evaluate.R20_ROUNDS["R20K10"]
    assert "R20K10" in evaluate.ADOPTED["default"]


def test_a_man_nobody_has_seen_here_gets_his_populations_prior_and_not_a_zero():
    """`snapshot.prior_window`: un'assenza non e' uno zero misurato, e nemmeno una finestra assente.

    Le due facce del difetto del 04/09/2026, tenute insieme come nel test qui sopra. Con un prior a ZERO
    presenze su dieci giornate, chi la stagione scorsa qui non l'ha giocata aveva un TETTO di k/(k+K) -
    0,167 con due giornate - e tredici uomini che avevano cominciato da titolare tutte e due le prime
    giornate leggevano `riserva`. Togliendo la finestra invece leggerebbero 1,000 su due partite, che e'
    il difetto opposto e piu' grosso (Rrahmani Al. `bandiera` con 19 minuti giocati).

    E LA FINESTRA NE PORTA TRE, non una: `standing` legge i MINUTI, quindi un prior che desse le sole
    presenze farebbe leggere «due partite di minuti su otto giornate» proprio a questi uomini.
    """
    from euroleghe_ingest.engine import estimate as est
    from euroleghe_ingest.modules import snapshot

    now = presence.SeasonWindow(appearances=2, starts=2, minutes=173, minutes_here=173, rounds=2)
    prior = snapshot.prior_window(None, {}, {}, 38.0, "A", "default")
    assert prior.rounds == presence.DEFAULTS.season_prior_rounds
    assert prior.appearances == est.default_presences(prior.rounds, "default", "unmeasured", "A")
    # i tre numeri sono coerenti fra loro: minuti a presenza, non minuti a giornata
    assert abs(prior.minutes / prior.appearances - est.UNMEASURED_MINUTES_PER_APPEARANCE["A"]) < 1e-9
    blended = presence.blend_seasons(now, prior)
    assert 0.45 < _share(blended) < 0.75          # ne' 0,167 ne' 1,000
    assert blended.minutes > now.minutes          # e `standing` non legge due partite su sette giornate

    # UNO ZERO MISURATO NON E' UN'ASSENZA: chi una riga ce l'ha, con zero partite, la tiene. Era in un
    # campionato che leggiamo e non e' stato scelto, che vale piu' di qualunque costante di popolazione.
    measured_zero = snapshot.prior_window({"matches": 0, "starts": 0}, {}, {}, 38.0, "A", "default")
    assert measured_zero.appearances == 0.0
    assert measured_zero.rounds == 38.0
