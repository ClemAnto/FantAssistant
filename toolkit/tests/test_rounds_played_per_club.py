"""Il denominatore della stagione IN CORSO si conta PER CLUB, e sulla tabella del numeratore.

Dal giudizio dell'operatore, 14/09/2026: «le giornate della nuova stagione dovrebbero valere molto di
piu' di quella passata». La costante che pesa le due stagioni (`presence.season_prior_rounds` = 5) e'
misurata e la sua direzione costa; quello che era rotto e' il DENOMINATORE - `rounds_played` contava le
giornate del CAMPIONATO, quindi al 13/09/2026 leggeva 4 anche per i diciotto club di Serie A che ne
avevano giocate 3, e Malen risultava 3 partite su 4 dopo averle giocate tutt'e tre.
"""
import inspect
import sqlite3

from euroleghe_ingest.modules import snapshot

BEFORE = "2026-09-13"
SEASON = "2026-27"


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE external_match_stats (fc_id INTEGER, season TEXT, source TEXT,
                    match_id TEXT, competition TEXT, real_md INTEGER, match_date TEXT, club TEXT)""")
    conn.execute("CREATE TABLE clubs (canonical_name TEXT)")
    for name in ("Fiorentina", "Roma", "Milan"):
        conn.execute("INSERT INTO clubs VALUES (?)", (name,))
    return conn


def _play(conn, club, md, date, fc_id=1, spelling=None):
    conn.execute("INSERT INTO external_match_stats VALUES (?,?,?,?,?,?,?,?)",
                 (fc_id, SEASON, "sofascore", f"{club}-{md}", "serie_a", md, date,
                  spelling or club))


def _three_and_four(conn):
    """Tre giornate per tutti, e l'anticipo della quarta giocato dalla sola Fiorentina."""
    for md, date in ((1, "2026-08-23"), (2, "2026-08-30"), (3, "2026-09-06")):
        for club in ("Fiorentina", "Roma", "Milan"):
            _play(conn, club, md, date)
    _play(conn, "Fiorentina", 4, "2026-09-11")


def test_a_round_in_progress_is_not_a_round_everybody_has_played():
    """IL DIFETTO, nella sua forma esatta: due club avanti non fanno il denominatore degli altri diciotto.

    Rimettendo il conteggio per competizione (`COUNT(DISTINCT real_md)` sul campionato) questa asserzione
    cade, ed e' la controprova - la Roma leggerebbe 4 come la Fiorentina.
    """
    conn = _conn()
    _three_and_four(conn)
    played = snapshot.rounds_played(conn, SEASON, BEFORE)
    assert played["Fiorentina"] == 4, "chi la quarta l'ha giocata la deve contare"
    assert played["Roma"] == 3 and played["Milan"] == 3, (
        "un anticipo di un altro club non e' una giornata che questo club ha giocato")


def test_the_denominator_is_counted_on_the_table_the_numerator_comes_from():
    """NON dal calendario pubblicato, che al 13/09/2026 era avanti di sei club sul livello per partita.

    `starting_record` conta le presenze su `external_match_stats`; una partita che quella tabella non ha
    ancora non puo' stare al numeratore, quindi non puo' stare nemmeno al denominatore. Se un domani
    qualcuno la contasse da `fixtures`, il difetto curato tornerebbe dall'altro lato.
    """
    source = inspect.getsource(snapshot.rounds_played)
    assert "external_match_stats" in source
    assert "fixtures" not in source.split('"""')[2], (
        "il conteggio deve restare sulla tabella del numeratore")
    numerator = inspect.getsource(snapshot.starting_record)
    for clause in ("source = 'sofascore'", "match_date < ?", "competition IN"):
        assert clause in numerator and clause in source, (
            f"numeratore e denominatore devono condividere il filtro {clause!r}")


def test_two_spellings_of_one_club_are_the_union_of_their_matches():
    """Risolte dal nome canonico, e contate come UNIONE: sommarle darebbe piu' del calendario, e tenere
    il massimo perderebbe le partite scritte con l'altra grafia."""
    conn = _conn()
    _three_and_four(conn)
    # La stessa Roma, due giornate scritte 'AS Roma' dalla fonte.
    conn.execute("DELETE FROM external_match_stats WHERE club = 'Roma' AND real_md IN (2, 3)")
    _play(conn, "Roma", 2, "2026-08-30", spelling="AS Roma")
    _play(conn, "Roma", 3, "2026-09-06", spelling="AS Roma")
    assert snapshot.rounds_played(conn, SEASON, BEFORE)["Roma"] == 3


def test_a_club_the_layer_does_not_know_has_no_window_at_all():
    """«Vuoto = ignoto, mai zero»: senza righe il club non e' nella mappa, quindi `blend_seasons` ha una
    finestra sola e legge la stagione precedente intatta.

    Il conteggio per campionato faceva il contrario e leggeva zero presenze su quattro giornate, cioe'
    `riserva` per una rosa intera le cui partite non erano ancora state acquisite.
    """
    conn = _conn()
    _three_and_four(conn)
    played = snapshot.rounds_played(conn, SEASON, BEFORE)
    # Le CHIAVI sono club e non campionati, o l'assenza di uno di loro non vorrebbe dire niente: col
    # conteggio per competizione «Venezia non c'e'» e' vero anche per la Roma, che ha giocato tre partite.
    assert set(played) == {"Fiorentina", "Roma", "Milan"}
    assert "Venezia" not in played and "serie_a" not in played


def test_a_preseason_sheet_has_no_current_window():
    """Inerte senza una data d'asta, che e' cio' che tiene ferma ogni finestra pubblicata dal gate."""
    conn = _conn()
    _three_and_four(conn)
    assert snapshot.rounds_played(conn, SEASON, None) == {}


def test_the_sheet_looks_the_denominator_up_by_club():
    """La mappa e' per club, quindi il punto di chiamata deve cercarla col club e non col campionato.

    Una mappa nuova letta con la chiave vecchia risponderebbe 0 su ogni riga, e uno zero uniforme e' la
    cosa che questo progetto ha imparato a non credere.
    """
    source = inspect.getsource(snapshot.build_rows)
    assigned = [line for line in source.splitlines() if "now_rounds = " in line]
    assert assigned, "build_rows deve leggere il denominatore della finestra in corso"
    assert "club_target" in assigned[0] and "obs.league" not in assigned[0], assigned[0]
