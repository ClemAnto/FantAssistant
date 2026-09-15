"""La FINESTRA CORTA: la lettura dell'ultimo periodo, la sua scala e la regola del padrone che rientra.

Richiesta dell'operatore del 10/09/2026 - «un algoritmo per valutare automaticamente le ultime 3 partite
... in questo modo possiamo ottenere la formazione tipo nell'ultimo periodo switchabile con quella a
lungo periodo». Qui si asseriscono le invarianti che tengono in piedi i numeri misurati quel giorno, e
ognuna dice PERCHE': un test che controlla un valore e non la ragione passa anche il giorno che la
ragione se ne va.
"""
from __future__ import annotations

import inspect
from dataclasses import replace

from euroleghe_ingest.engine import presence
from euroleghe_ingest.engine.status import LADDER, status_of
from euroleghe_ingest.modules import boards, snapshot


# --------------------------------------------------------------------- la finestra e la sua miscela

def test_una_finestra_vuota_restituisce_la_stagione_intatta():
    """Il fatto da cui dipende TUTTO il resto: su una pre-stagione la lettura corta e' inerte.

    Nessuna partita di campionato prima della data d'asta -> nessuna finestra -> la miscela rende la
    stagione senza toccarla. E' quello che rende ogni numero pubblicato dal gate immune a questa
    aggiunta, ed e' la quarta istanza in questo repository di «una finestra vuota non e' una finestra a
    zero» (le altre tre: il ritiro con zero minuti, `blend_seasons` a k=0, il prior senza giornate
    contendibili).
    """
    empty = presence.RecentWindow()
    assert presence.recent_share(empty, 0.42) == 0.42
    assert presence.recent_starting_share(empty, 0.42) == 0.42
    assert presence.recent_minutes(empty, 77.0) == 77.0
    # ...e senza NEMMENO la stagione resta ignoto, non zero.
    assert presence.recent_share(empty, None) is None


def test_la_miscela_e_k_osservate_contro_il_prior():
    """La forma misurata, e non due miscele in cascata come faceva il pannello.

    Tre partite piene contro un prior di 3 su una stagione da 0.50 danno la media esatta dei due: e' la
    forma `(k x corta + K x stagione) / (k + K)` che questo repository scrive per la shrinkage, per R20 e
    per `blend_seasons`, applicata alle quote.
    """
    full = presence.RecentWindow(available=3, starts=3, appearances=3,
                                 minutes_capped=270, full_matches=3)
    assert presence.recent_share(full, 0.50) == 0.75
    # ...e il prior si puo' spegnere, che e' come si legge la finestra nuda.
    naked = replace(presence.DEFAULTS, recent_prior=0.0)
    assert presence.recent_share(full, 0.50, naked) == 1.0


def test_la_finestra_e_tappata_a_recent_window():
    """Dieci partite non pesano dieci volte il prior: la misura dice che da 5 in su si peggiora.

    Senza il tappo una finestra lunga schiaccerebbe il prior, cioe' proprio la lettura nuda che e' stata
    misurata PEGGIO della miscela (Brier 0.1749 contro 0.1581).
    """
    long_window = presence.RecentWindow(available=10, starts=10, appearances=10,
                                        minutes_capped=900, full_matches=10)
    # 3 osservate (tappate) contro 3 di prior = meta' esatta.
    assert presence.recent_share(long_window, 0.0) == 0.5


def test_la_prova_di_una_quantita_e_la_quantita_stessa():
    """LA CORREZIONE DEL 10/09/2026, e il test che impedisce di rifarla.

    `recent_share` e' la quota delle partite in cui prende il VOTO, quindi la sua prova e' «ha preso il
    voto». E' stata spedita con i MINUTI - un parametro che aveva vinto una misura vera su un ALTRO
    bersaglio, «chi comincia la prossima» - e li' e' PEGGIO del non avere la finestra affatto: errore
    0.2073 contro 0.1716 della sola stagione, e 0.1614 con la prova giusta (76.315 osservazioni fuori
    campione). Le altre forme restano raggiungibili perche' un rifiuto cancellato non si ri-corre.

    Il test guarda la DISTINZIONE e non solo il valore: sulla finestra di un uomo che entra ogni partita
    per meno di un tempo, le due prove danno numeri diversi - ed e' esattamente la popolazione su cui il
    difetto costava.
    """
    assert presence.DEFAULTS.recent_evidence == "appearances"
    window = presence.RecentWindow(available=2, starts=2, appearances=2,
                                   minutes_capped=135, full_matches=1)   # 90' + 45'
    got = {shape: presence.recent_evidence(window, replace(presence.DEFAULTS,
                                                           recent_evidence=shape))
           for shape in ("appearances", "minutes", "start", "full")}
    assert got["appearances"] == 1.0        # ha giocato tutte e due
    assert got["minutes"] == 0.75           # 135 / 180 - la stessa finestra, un'altra quantita'
    assert got["start"] == 1.0              # due partenze su due
    assert got["full"] == 0.75              # una finita, una partenza sostituita
    # ...e il caso che il difetto schiacciava: entra sempre, mai per molto.
    cameo = presence.RecentWindow(available=3, starts=0, appearances=3,
                                  minutes_capped=60, full_matches=0)
    assert presence.recent_evidence(cameo, presence.DEFAULTS) == 1.0
    assert presence.recent_evidence(cameo, replace(presence.DEFAULTS,
                                                   recent_evidence="minutes")) < 0.3
    # ...e una forma che nessuno ha dichiarato non e' silenziosamente una delle tre.
    try:
        presence.recent_evidence(window, replace(presence.DEFAULTS, recent_evidence="nope"))
    except ValueError:
        pass
    else:                                                       # pragma: no cover
        raise AssertionError("una forma sconosciuta deve fallire, non scegliere per conto suo")


def test_i_minuti_hanno_il_denominatore_delle_presenze_e_non_delle_disponibili():
    """Per un portiere di rotazione i due rapporti stanno uno al doppio dell'altro (07/09, caso Meret).

    La quota legge le partite DISPONIBILI, i minuti le PRESENZE: sono due domande, e mettere lo stesso
    denominatore sotto le due farebbe leggere 30' a un uomo che quando gioca sta in campo 90.
    """
    once = presence.RecentWindow(available=3, starts=1, appearances=1,
                                 minutes_capped=90, full_matches=1)
    naked = replace(presence.DEFAULTS, recent_prior=0.0)
    assert presence.recent_minutes(once, None, naked) == 90.0     # 90 su UNA presenza
    assert presence.recent_share(once, None, naked) == 1 / 3      # una presenza su TRE disponibili
    # ...e i due numeri qui coincidono per caso (90/270 = 1/3): con due tempi giocati in due partite
    # diverse si separano, ed e' quello che il denominatore giusto deve mostrare.
    half = presence.RecentWindow(available=3, starts=0, appearances=2,
                                 minutes_capped=90, full_matches=0)
    assert presence.recent_share(half, None, naked) == 2 / 3
    assert presence.recent_minutes(half, None, naked) == 45.0


# --------------------------------------------------------------------- il tappo della scala

def test_il_padrone_che_rientra_tappa_a_ballottaggio_e_solo_chi_e_disegnato():
    """La regola dell'operatore del 10/09, e i suoi tre confini.

    Tappa al PAVIMENTO che i disegnati hanno gia' («chi la board schiera non scende sotto
    ballottaggio»), quindi non puo' portare nessuno fuori dal proprio perimetro; None NON retrocede,
    che e' lo specchio di «ignoto non promuove»; e non tocca chi la board non disegna, perche' la' il
    posto e' di un altro che E' il suo contendente.
    """
    assert status_of(0.95, 80, True) == "bandiera"
    assert status_of(0.95, 80, True, owner_returning=True) == "ballottaggio"
    assert status_of(0.95, 80, True, owner_returning=None) == "bandiera"
    assert status_of(0.95, 80, True, owner_returning=False) == "bandiera"
    # ...e nemmeno la promozione dell'08/09 lo scavalca: chi rientra la settimana prossima E' un
    # contendente, quindi «nessuno gli contende la maglia» non puo' valere insieme a questo.
    assert status_of(0.50, 40, True, contended=False) == "titolare"
    assert status_of(0.50, 40, True, contended=False, owner_returning=True) == "ballottaggio"
    # ...e il tappo e' un tappo: non promuove chi sta sotto.
    assert status_of(0.20, 40, False, owner_returning=True) == LADDER[5]


def test_la_regola_legge_le_due_board_e_la_riga_del_padrone():
    """Fuori dall'orizzonte si IGNORA, senza data NON si retrocede, e chi c'era prima non si tocca.

    Le tre righe della frase dell'operatore, una per asserzione. `desc_out_rounds` e' la quantita' che
    decide - quante giornate del suo club salta - perche' una soglia in GIORNI non si confronta fra due
    calendari (la lezione di R20 applicata a un rientro).
    """
    horizon = presence.DEFAULTS.recent_owner_matches
    holder = {"fc_id": 2}
    deputy = {"fc_id": 9}

    def owner(rounds):
        return [("D", {"fc_id": 1, "desc_out_rounds": rounds}, []), ("D", holder, [])]

    short = [("D", deputy, []), ("D", holder, [])]
    assert boards._returning_owner(owner(horizon - 2), short, presence.DEFAULTS) == {9: True}
    assert boards._returning_owner(owner(horizon + 8), short, presence.DEFAULTS) == {}
    assert boards._returning_owner(owner(None), short, presence.DEFAULTS) == {}
    # ...e chi la board lunga disegnava GIA' non e' un vice: il posto e' suo su tutt'e due gli orizzonti.
    assert 2 not in boards._returning_owner(owner(horizon - 2), short, presence.DEFAULTS)
    # ...e la LINEA conta: un padrone che rientra in difesa non retrocede un centrocampista.
    other_line = [("M", deputy, []), ("D", holder, [])]
    assert boards._returning_owner(owner(horizon - 2), other_line, presence.DEFAULTS) == {}


# --------------------------------------------------------------------- la camminata di snapshot

def _appearance(date: str, minutes: int, started: int,
               position: str | None = None, slot: int | None = None,
               shape: str | None = None) -> snapshot.Appearance:
    return snapshot.Appearance("Genoa", "serie_a", date, minutes, started, None, 0, 0,
                               None, None, None, None, None, None, None, position, slot, shape)


def test_lo_slot_viaggia_col_modulo_della_sua_partita():
    """`desc_recent_slots`: il POSTO, e senza il modulo quel numero non e' confrontabile.

    Con tre dietro lo slot 4 e' il primo centrocampista; con quattro dietro e' un difensore. Quindi la
    coppia, e chi legge tiene solo le partite del modulo che sta disegnando. Un uomo che ha cambiato
    modulo fra le due partite porta due coppie diverse e non un numero sommato.
    """
    window = [(f"2026-09-0{i}", str(i), "serie_a", "genoa") for i in (6, 5, 4)]
    mine = {"6": _appearance("2026-09-06", 90, 1, "M", 4, "3-4-2-1"),
            "5": _appearance("2026-09-05", 90, 1, "M", 4, "3-4-2-1"),
            "4": _appearance("2026-09-04", 90, 1, "D", 4, "4-3-3")}
    got = snapshot.recent_block(7, window, mine, {"6", "5", "4"}, {}, {}, {}, matches=3)
    # ...E LA PARTITA, che e' la terza cosa e non un ornamento: due uomini che possiedono due slot della
    # STESSA distinta hanno cominciato insieme, e su quel fatto la regola delle staffette distingue un
    # osservazione da un'inferenza sui minuti.
    # ...E LA DISTANZA, che e' la quarta (13/09/2026): quante partite fa, contate sulla finestra del
    # CLUB e non sulla lista dell'uomo - quella tiene le sole partite che ha cominciato, quindi la sua
    # testa e' «la sua piu' recente» e due uomini non sono confrontabili.
    assert got["recent_slots"] == "6:3-4-2-1:4:0;5:3-4-2-1:4:1;4:4-3-3:4:2"

    # ...e una partita senza modulo non porta uno slot orfano: un numero che nessuno puo' interpretare
    # e' peggio di un numero che manca.
    senza = {"6": _appearance("2026-09-06", 90, 1, "M", 4, None)}
    assert snapshot.recent_block(7, window, senza, {"6", "5", "4"}, {}, {}, {},
                                 matches=3)["recent_slots"] is None


def test_il_POSTO_viene_dalle_partite_che_ha_COMINCIATO_e_nessuna_colonna_ripete_la_linea():
    """Dal caso Chukwueze (operatore, 12/09/2026), e la colonna e' UNA.

    Il ruolo granulare legge `RW`/`F` su tutti i 26 giorni dal 28/07 all'11/09 - e' il profilo del
    giocatore e non cambia con l'uso - mentre nelle due partite che ha cominciato la fonte lo mette a
    CENTROCAMPO, slot 4. Chi entra a gara in corso prende il posto che si e' liberato, quindi la sua riga
    direbbe una cosa sull'avversario invece che su di lui: i subentri non entrano, ed e' proprio la sua
    terza partita (29 minuti da `F`).

    E una colonna gemella con la sola LINEA e' stata scritta e tolta lo stesso giorno: il POSTO la
    contiene, e due risposte a una domanda sola sono la cosa che questo repository evita altrove.
    """
    window = [(f"2026-09-0{i}", str(i), "serie_a", "genoa") for i in (6, 5, 4)]
    mine = {"6": _appearance("2026-09-06", 29, 0, "F", 9, "4-3-3"),   # subentrato: non dice dove gioca
            "5": _appearance("2026-09-05", 90, 1, "M", 4, "3-4-2-1"),
            "4": _appearance("2026-09-04", 90, 1, "M", 4, "3-4-2-1")}
    got = snapshot.recent_block(7, window, mine, {"6", "5", "4"}, {}, {}, {}, matches=3)
    # La distanza e' quella nella finestra del CLUB: il subentro della partita piu' recente non entra,
    # e le due partenze restano a una e due giornate fa invece di scalare a zero e uno. E' l'ancora che
    # rende confrontabili due uomini che hanno cominciato partite diverse.
    assert got["recent_slots"] == "5:3-4-2-1:4:1;4:3-4-2-1:4:2"
    assert got["recent_starts"] == 2
    assert "recent_line" not in got, "una risposta sola alla domanda «dove ha giocato»"

    # ...e VUOTA per chi non ha cominciato niente: li' non c'e' un'osservazione, e un ripiego sul
    # profilo sarebbe «vuoto = ignoto» rotto proprio dove la colonna nasce per non rompersi.
    bench = {"6": _appearance("2026-09-06", 29, 0, "F", 9, "4-3-3")}
    assert snapshot.recent_block(7, window, bench, {"6", "5", "4"}, {}, {}, {},
                                 matches=3)["recent_slots"] is None


def test_disponibile_e_chi_ha_giocato_o_era_in_panchina_e_nessun_altro():
    """Il DENOMINATORE della finestra corta, che e' la meta' su cui poggia tutto il resto.

    La panchina e' una prova su di lui e batte uno stop datato (14/08/2026): un uomo stampato in distinta
    era disponibile e non e' stato scelto. Uno stop, una squalifica e un fuori-rosa escono dal
    denominatore e non contano ZERO, perche' nessuna delle tre e' una preferenza dell'allenatore per un
    altro - «vuoto = ignoto» sulla quantita' in cui costa di piu'.
    """
    window = [(f"2026-09-0{i}", str(i), "serie_a", "genoa") for i in (5, 4, 3, 2)]
    mine = {"5": _appearance("2026-09-05", 90, 1), "4": _appearance("2026-09-04", 20, 0)}
    got = snapshot.recent_block(7, window, mine, {"5", "4", "3", "2"},
                                benched={7: {"3"}},                  # in panchina, mai entrato
                                lineup_only={},
                                spells={7: [("2026-09-01", "2026-09-03", "i")]},   # infortunato il 2
                                matches=4)
    assert got["recent_looked"] == 4
    # giocate 2 + panchina 1 = 3; la partita dentro lo stop NON e' nel denominatore
    assert got["recent_available"] == 3
    assert got["recent_played"] == 2
    assert got["recent_starts"] == 1
    assert got["recent_minutes"] == 110.0
    assert got["recent_full"] == 1


def test_i_minuti_si_tappano_a_novanta_prima_di_sommarli():
    """151 righe su 91.096 stanno sopra (i supplementari di una coppa), e un 120 renderebbe una partita
    una prova e un terzo - cioe' una quota sopra 1 da un solo match."""
    window = [("2026-09-05", "5", "serie_a", "genoa")]
    got = snapshot.recent_block(7, window, {"5": _appearance("2026-09-05", 120, 1)},
                                {"5"}, {}, {}, {}, matches=1)
    assert got["recent_minutes"] == 90.0


def test_la_camminata_guarda_le_ultime_e_non_le_prime():
    """`window` arriva dalla piu' recente, quindi le ultime `matches` sono le PRIME della lista.

    `trend_block` la scorre al contrario perche' disegna una striscia che si legge da sinistra; qui
    l'ordine non entra in nessun numero e prendere le ultime e' tutto il punto. Un taglio dal lato
    sbagliato leggerebbe le partite piu' VECCHIE e nessun conteggio se ne accorgerebbe.
    """
    window = [(f"2026-09-{day:02d}", str(day), "serie_a", "genoa") for day in (5, 4, 3)]
    mine = {"5": _appearance("2026-09-05", 90, 1), "3": _appearance("2026-09-03", 90, 1)}
    got = snapshot.recent_block(7, window, mine, {"5", "4", "3"}, {}, {}, {}, matches=1)
    assert got["recent_looked"] == 1 and got["recent_played"] == 1


# --------------------------------------------------------------------- una definizione, piu' lettori

def test_la_lunghezza_della_finestra_viene_dal_modello_e_non_da_snapshot():
    """Due copie di quel numero darebbero una finestra camminata su tre partite e miscelata su cinque.

    Cioe' la scala tarata su un campione diverso da quello che la produce - la stessa famiglia del
    manifest letto prima di essere scritto (05/09/2026, 241 righe su 602).
    """
    source = inspect.getsource(snapshot.club_form)
    assert "presence.DEFAULTS.recent_window" in source, \
        "la camminata deve leggere la lunghezza da `presence.Params`, non da una costante sua"


def test_il_pannello_non_tiene_piu_le_costanti_della_finestra():
    """`FORM_WEIGHT` e `RECENT_PRIOR` sono andate in `presence.Params`, dove uno sweep le raggiunge.

    Vivevano in `gui.py` da un anno, dichiarate scelte di visualizzazione e MAI misurate - cioe'
    esattamente il difetto che `presence.py` descrive a proposito di «un parametro che nessun banco puo'
    raggiungere», commesso su se stesso. Il test guarda gli ATTRIBUTI e non il testo: un commento che le
    nomina per spiegare dove sono andate e' legittimo.
    """
    from euroleghe_ingest.gui import SnapshotView

    assert not hasattr(SnapshotView, "FORM_WEIGHT")
    assert not hasattr(SnapshotView, "RECENT_PRIOR")
    for name in ("recent_window", "recent_prior", "recent_evidence", "recent_owner_matches"):
        assert hasattr(presence.DEFAULTS, name), f"{name} deve essere sweep-abile"


def test_ogni_modo_di_disegnare_dichiara_la_sua_finestra():
    """Una definizione, sei lettori: la riga `"recent" if mode == "next" else "season"` era scritta sei
    volte, e con un terzo modo sarebbe stata sbagliata in sei posti - un modo nuovo che nessuno aggiunge
    alla sesta copia disegna un undici sull'orizzonte di un altro."""
    from euroleghe_ingest import gui

    assert gui.HORIZON_OF == {"typical": "season", "next": "recent", "short": "short"}
    assert gui.horizon_of("short") == "short"
    # un modo che nessuno ha dichiarato non inventa una finestra
    assert gui.horizon_of("boh") == "season"
    source = inspect.getsource(gui)
    assert 'horizon = "recent" if' not in source, \
        "la mappa modo->finestra deve stare in un posto solo"


def test_i_due_modi_che_disegnano_oggi_escludono_gli_indisponibili():
    """`short` sta in `TODAY_MODES` e non e' una simmetria gratuita: e' la condizione perche' la board
    breve dica qualcosa.

    La finestra di un infortunato e' VUOTA (nessuna partita in cui era disponibile), quindi la miscela
    gli restituisce lo standing di stagione intatto e senza l'esclusione la board breve sarebbe identica
    alla lunga PROPRIO sugli uomini per cui l'operatore l'ha chiesta.
    """
    from euroleghe_ingest import gui

    assert gui.TODAY_MODES == frozenset({"next", "short"})
    assert "typical" not in gui.TODAY_MODES, \
        "l'undici tipo e' «la squadra con tutti disponibili»: la' un infortunato resta"


def test_le_due_board_viaggiano_nello_stesso_file():
    """Un file per ciascuna sarebbe una coppia che qualcuno un giorno riscrive per meta' - e la regola
    del padrone che rientra ha bisogno di tutt'e due per esistere."""
    source = inspect.getsource(boards.write_boards)
    assert 'payload["short"]' in source
    assert "extract_modes" in source, "una sessione Tk per i due modi, non due"
    # ...e la finestra si DICHIARA accanto ai numeri che ne escono, cosi' l'etichetta dell'app viene da
    # chi l'ha usata e non da una costante ricopiata in TypeScript.
    assert "presence.DEFAULTS.recent_window" in source


def test_la_colonna_del_foglio_resta_la_lettura_DI_STAGIONE():
    """Il gradino che il foglio porta e' quello lungo, e non e' un dettaglio: e' quello con cui si COMPRA.

    Un'asta si gioca per la stagione, quindi `desc_titolarita` deve continuare a dire cosa un uomo e' su
    una stagione intera; la lettura corta vive in `boards.json` sotto `short`, dove la legge chi guarda il
    campetto dell'ultimo periodo. Mescolarle nella stessa colonna darebbe alla Strategia e alla plancia
    una parola che cambia significato con un pulsante di un'altra pagina - e nessuno lo vedrebbe.
    """
    source = inspect.getsource(snapshot.run)
    assert 'board_summary.get("statuses")' in source, \
        "le colonne del foglio leggono la scala della board LUNGA"
    assert 'row["desc_titolarita"] = one.get("status")' in source


def test_un_test_che_legge_un_SORGENTE_va_riportato_dove_il_sorgente_e_andato():
    """Il guardiano degli undici alternativi e' caduto quando il corpo si e' spostato in `_boards_for`.

    L'invariante che protegge era e resta VERA - il modulo disegnato e gli alternativi passano dalla
    stessa funzione - e quello che si era rotto era il puntatore: e' «verifica la FUNZIONE, non la colonna
    che le somiglia» applicato a un test invece che a una colonna. Scritto qui perche' un guardiano
    spostato per far passare la suite e' esattamente il modo in cui un invariante muore: la nuova
    asserzione dice sulla stessa cosa quello che diceva la vecchia, e questo test lo lega al posto giusto
    cosi' che spostarlo di nuovo torni a fallire.
    """
    source = inspect.getsource(boards._boards_for)
    assert source.count("_drawn(view, club") == 2, "il secondo modulo non passa dallo stesso disegno"
    assert "ALTERNATIVE_MIN_ODDS" in source
    # ...e `extract_boards` e' ora un guscio: se ci tornasse un disegno, sarebbero due definizioni.
    shell = inspect.getsource(boards.extract_boards)
    assert "_drawn(" not in shell, "il guscio non disegna: chiama `extract_modes`"


def test_la_board_breve_viaggia_nel_bundle_senza_che_nessuno_la_debba_elencare():
    """`export` copia `boards.json` BYTE PER BYTE, quindi una chiave nuova arriva all'app da sola.

    E' la ragione per cui la board breve sta DENTRO quel file invece che accanto: la famiglia di difetti
    piu' ripetuta di questo repository e' «una cosa aggiunta all'export che nessuno ha aggiunto anche
    all'allowlist» (i campetti il 10/08, `availability` il 03/09, l'asterisco il 03/09), e un file nuovo
    avrebbe avuto bisogno di due righe in due posti. Il test guarda che la copia resti INTEGRALE: il
    giorno che qualcuno la trasformasse in una selezione di chiavi, `short` sparirebbe in silenzio.
    """
    from euroleghe_ingest.modules import export

    source = inspect.getsource(export)
    assert "boards.read_bytes()" in source, \
        "boards.json si copia intero: una selezione di chiavi perderebbe l'ultimo periodo senza dirlo"


def test_le_colonne_della_finestra_sono_sul_foglio_e_la_revisione_e_stata_alzata():
    """Una colonna che il foglio non porta e' una colonna che l'app non vede mai (i campetti, tre volte),
    e un foglio che non sa di essere vecchio e' quello che il numero di revisione esiste per impedire."""
    for column in ("desc_recent_looked", "desc_recent_available", "desc_recent_played",
                   "desc_recent_starts", "desc_recent_minutes", "desc_recent_full"):
        assert column in snapshot.PLAYER_COLUMNS, f"{column} non e' fra le colonne del foglio"
    assert snapshot.SHEET_REVISION >= 57


# --------------------------------------------------------------------- lo stato di indisponibilita'

def _availability_db():
    """Un DB minimo con la pagina *indisponibili* letta piu' volte, e un uomo che nel frattempo gioca."""
    import sqlite3
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE availability (fc_id INT, valid_from TEXT, status TEXT)")
    conn.execute("CREATE TABLE external_match_stats (fc_id INT, match_date TEXT, minutes INT)")
    return conn


def test_una_riga_di_indisponibilita_e_scontata_da_una_partita_giocata():
    """LA PROVA POSITIVA batte lo stato, che e' «la panchina batte uno stop datato» (14/08) da un altro lato.

    Il caso vero: Bremer leggeva `suspended` da una riga del 4 agosto - la squalifica dell'ultima giornata
    dell'anno prima, gia' scontata - mentre da allora aveva giocato 270 minuti su 270, e la board
    dell'ultimo periodo non lo disegnava. Trovato dall'operatore l'11/09/2026 guardando quella board.
    Sul bundle di quel giorno erano 49 uomini, fra cui Kean, Ostigard, Baldanzi e Messias.
    """
    conn = _availability_db()
    conn.execute("INSERT INTO availability VALUES (1, '2026-08-04', 'suspended')")
    conn.execute("INSERT INTO availability VALUES (2, '2026-08-04', 'injured')")
    # solo il primo e' sceso in campo dopo quella lettura
    conn.execute("INSERT INTO external_match_stats VALUES (1, '2026-08-23', 90)")
    got = snapshot.availability_now(conn, "2026-09-11")
    assert 1 not in got, "chi ha giocato dopo la riga non e' indisponibile"
    assert got.get(2) == "injured", "chi non ha giocato resta fuori: la riga vale ancora"


def test_cadere_dall_ELENCO_vuole_piu_di_una_lettura():
    """La seconda regola poggia su un'ASSENZA, quindi vuole piu' di una prova.

    La pagina si legge per CAMPIONATO e non tutti i giorni tutti - il 06/09/2026 fu letta la sola Serie A
    - quindi una lettura sola che non lo trova puo' essere una lettura che non lo ha guardato. Stessa
    forma di `ABSENT_READS` per le rose vive, e il valore e' DICHIARATO: la' e' misurato, qui e' preso in
    prestito e lo dice.
    """
    conn = _availability_db()
    conn.execute("INSERT INTO availability VALUES (3, '2026-09-01', 'injured')")
    # UNA sola lettura dopo la sua: non basta
    conn.execute("INSERT INTO availability VALUES (9, '2026-09-05', 'injured')")
    assert snapshot.availability_now(conn, "2026-09-11").get(3) == "injured"
    # ...la seconda si'
    conn.execute("INSERT INTO availability VALUES (9, '2026-09-07', 'injured')")
    assert 3 not in snapshot.availability_now(conn, "2026-09-11")
    assert snapshot.AVAILABILITY_READS == 2


# --------------------------------------------------------------------- le STAFFETTE

def test_l_intervallo_in_campo_si_ricava_dai_soli_minuti():
    """Un titolare comincia a zero, un subentrato finisce la partita: l'evento non serve.

    E' la formulazione dell'operatore (11/09/2026) - «devi intersecare i minuti dell'ingresso/uscita di
    entrambi» - e la sola assunzione e' che chi entra non esca di nuovo: MISURATA sulle 119 sostituzioni
    vere in cache, 1 ingresso su 37 (2,7%), e quelle sono amichevoli, cioe' il caso peggiore.
    """
    assert snapshot.pitch_span(1, 90) == (0.0, 90.0)      # ha giocato tutta la partita
    assert snapshot.pitch_span(1, 62) == (0.0, 62.0)      # titolare uscito al 62'
    assert snapshot.pitch_span(0, 28) == (62.0, 90.0)     # entrato al 62' e ha finito
    assert snapshot.pitch_span(0, None) is None           # in panchina: nessun intervallo
    assert snapshot.pitch_span(1, 0) is None
    # ...e il recupero non allunga la partita: 95 minuti restano 90, o due uomini si sovrapporrebbero
    # in un tempo che non e' mai esistito.
    assert snapshot.pitch_span(0, 95) == (0.0, 90.0)


def test_una_staffetta_e_separazione_PER_copertura():
    """Le due meta' della frase dell'operatore sono due numeri, e servono tutt'e due.

    Il caso che lo dimostra e' quello che la prima versione sbagliava: un uomo che gioca SEMPRE non si
    sovrappone mai con uno che non gioca MAI, quindi la sola separazione lo dichiarava una staffetta
    perfetta - sulla Juventus i primi tredici posti erano due uomini senza un minuto.
    """
    # tre partite: A titolare e sostituito, B entra e finisce. Mai insieme, e insieme coprono tutto.
    relay = [{1: (0.0, 60.0), 2: (60.0, 90.0)} for _ in range(3)]
    got = snapshot.relay_scores(relay)
    assert got[1] == [(2, 1.0)]
    # ...e chi non gioca MAI non e' la staffetta di nessuno, per quanto non si sovrapponga.
    never = [{1: (0.0, 90.0), 3: None} for _ in range(3)]
    assert 3 not in snapshot.relay_scores(never)
    # ...mentre due che giocano SEMPRE insieme leggono zero.
    always = [{1: (0.0, 90.0), 2: (0.0, 90.0)} for _ in range(3)]
    assert snapshot.relay_scores(always)[1] == [(2, 0.0)]


def test_chi_non_era_disponibile_non_e_una_staffetta_mancata():
    """Due uomini che non si sovrappongono perche' uno era FUORI non sono un'alternanza, sono un'assenza.

    E' la meta' che distingue le due cose, e si esprime nella FORMA del dato: chi non ha una voce in una
    partita non era disponibile, e quella partita non entra nella coppia. Senza questo, un infortunato
    di tre mesi risulterebbe la staffetta perfetta di chi ha giocato al posto suo.
    """
    # A gioca sempre; B e' fuori rosa per due partite e poi gioca mezz'ora accanto a lui.
    matches = [{1: (0.0, 90.0)}, {1: (0.0, 90.0)}, {1: (0.0, 90.0), 2: (60.0, 90.0)},
               {1: (0.0, 90.0), 2: (60.0, 90.0)}, {1: (0.0, 90.0), 2: (60.0, 90.0)}]
    got = snapshot.relay_scores(matches)
    # B non e' MAI in campo senza A: separazione zero. Il denominatore e' il minore dei due e non
    # l'unione - con l'unione i 60 minuti in cui A e' solo contavano come alternanza e la coppia
    # leggeva 0,667, che e' il difetto che questo caso ha trovato.
    assert got[1] == [(2, 0.0)]


def test_il_denominatore_della_separazione_e_quello_delle_partite_CONDIVISE():
    """Il difetto dell'11/09/2026: i minuti di ciascuno erano contati OVUNQUE, la sovrapposizione no.

    Un uomo che cambia squadra a meta' finestra porta al denominatore anche i minuti giocati con l'altro
    club, dove l'altro non c'era: la separazione tende a 1 per costruzione. Il sintomo era un PORTIERE
    che legge 0,99 con un centrocampista - e un portiere in campo 90' contiene per intero i minuti di
    chiunque, quindi la sua separazione non puo' che essere ZERO.

    Il caso qui sotto e' quello: A gioca sempre, B gioca mezz'ora accanto a lui in tre partite (mai
    senza) e poi altre cinque partite ALTROVE, dove A non compare. La risposta giusta e' zero; col
    denominatore vecchio erano `1 - 90/240 = 0,625`.
    """
    shared = [{1: (0.0, 90.0), 2: (60.0, 90.0)} for _ in range(3)]
    elsewhere = [{2: (0.0, 90.0)} for _ in range(5)]
    got = snapshot.relay_scores(shared + elsewhere)
    assert got[1] == [(2, 0.0)]
    # ...e la guardia «ciascuno dei due ci sia qualche volta» vale sulle partite condivise, non sulla
    # carriera: chi non gioca MAI accanto all'altro non e' la sua staffetta nemmeno se gioca altrove.
    absent = [{1: (0.0, 90.0), 2: None} for _ in range(4)] + [{2: (0.0, 90.0)} for _ in range(5)]
    assert snapshot.relay_scores(absent) == {}


def test_il_modulo_dell_ultimo_periodo_viene_dalle_ultime_tre_partite():
    """Regola dell'operatore (11/09/2026): «il modulo scelto dipende da quello usato nelle ultime tre».

    Prima la board corta prendeva il modulo dalla distribuzione di STAGIONE, cioe' diceva «ultimo
    periodo» e disegnava l'abitudine dell'anno. Le due colonne rispondono a due domande e restano due.
    """
    from euroleghe_ingest.gui import SnapshotView

    info = {"formation_shapes": "4-5-1:4;3-4-3:2", "formation_shapes_recent": "3-4-3:3"}
    assert SnapshotView.observed_shapes(info) == {"4-5-1": 4, "3-4-3": 2}
    assert SnapshotView.observed_shapes(info, "season") == {"4-5-1": 4, "3-4-3": 2}
    assert SnapshotView.observed_shapes(info, "short") == {"3-4-3": 3}

    # ...e un foglio scritto PRIMA di questa revisione disegna comunque: vuoto = ignoto non vuol dire
    # «nessun modulo», e una board vuota sarebbe peggio di una che legge la stagione.
    old = {"formation_shapes": "4-5-1:4"}
    assert SnapshotView.observed_shapes(old, "short") == {"4-5-1": 4}
    assert SnapshotView.observed_shapes({"formation_shapes_recent": "  "}, "short") == {}


def test_due_che_si_alternano_non_occupano_due_posti():
    """La regola dell'operatore (11/09/2026), e la sua ECCEZIONE nello stesso test.

    «Due che si alternano non occupano due posti, salvo buchi di formazione non riempibili da altri.»
    Il vincolo agisce sulla scelta, non sul claim: dei due resta quello con la quota piu' alta, perche' il
    serbatoio arriva gia' in ordine di claim.
    """
    from euroleghe_ingest.gui import SnapshotView

    def man(fid, name, relay=""):
        return {"fc_id": fid, "name": name, "desc_relay": relay}

    # A e B si alternano (0,80); C non c'entra niente. Due posti: entrano A e C, non A e B.
    a, b, c = man("1", "A", "2:0.80"), man("2", "B", "1:0.80"), man("3", "C")
    got = SnapshotView._apart(SnapshotView, [a, b, c], 2, set(), SnapshotView.relay_apart([a, b, c]))
    assert [row["name"] for row in got] == ["A", "C"]

    # ...ma se C non esiste il posto resterebbe VUOTO, e un posto vuoto e' peggio di due che si alternano.
    got = SnapshotView._apart(SnapshotView, [a, b], 2, set(), SnapshotView.relay_apart([a, b]))
    assert [row["name"] for row in got] == ["A", "B"]

    # ...e il vincolo attraversa le LINEE: chi e' gia' in campo conta anche se e' stato scelto altrove.
    got = SnapshotView._apart(SnapshotView, [b, c], 1, {"1"}, SnapshotView.relay_apart([a, b, c]))
    assert [row["name"] for row in got] == ["C"]

    # ...e la lettura e' SIMMETRICA anche se la colonna tiene solo i primi tre per uomo: qui B non
    # dichiara A, e il vincolo deve scattare lo stesso.
    lop = man("2", "B", "9:0.99;8:0.95;7:0.91")
    relays = SnapshotView.relay_apart([man("1", "A", "2:0.80"), lop, c])
    got = SnapshotView._apart(SnapshotView, [lop, c], 1, {"1"}, relays)
    assert [row["name"] for row in got] == ["C"]

    # ...e la soglia e' la MAGGIORANZA della frase dell'operatore, non un numero scelto.
    assert SnapshotView.RELAY_APART == 0.50

    # ...e SENZA una mappa il vincolo e' inerte, che e' come `eleven` lo spegne fuori dall'ultimo
    # periodo: una condizione sola al punto in cui la mappa si costruisce, invece di cinque sparse.
    got = SnapshotView._apart(SnapshotView, [a, b, c], 2, set(), {})
    assert [row["name"] for row in got] == ["A", "B"]
    assert SnapshotView._no_relay(SnapshotView, [a, b, c], {"1", "2", "3"}, {}) == [a, b, c]


def test_una_coppia_con_poco_calcio_insieme_resta_IGNOTA():
    """Sotto `RELAY_MIN_UNION` non si dice «non fanno staffetta»: non si dice niente."""
    thin = [{1: (0.0, 90.0), 2: None}]
    assert snapshot.relay_scores(thin) == {}
    assert snapshot.RELAY_MIN_UNION == 270.0


def test_il_cancello_toglie_dall_undici_e_non_dal_ballottaggio():
    """Un indisponibile esce dall'UNDICI di oggi e resta disegnabile come BALLOTTAGGIO.

    Richiesta dell'operatore, 11/09/2026: «nelle formazioni Ultimo Periodo sul campetto visualizza i
    calciatori che secondo l'algoritmo dovrebbero essere in ballottaggio ma sono infortunati». Una maglia
    che legge «nessun rivale» perche' il rivale e' in infermeria dice una cosa falsa sul POSTO: sul foglio
    Serie A del 10/09/2026 sono 59 posti senza nessun ballottaggio disegnato e 26 di quelli ne hanno uno
    che semplicemente oggi non puo' giocare.

    IN CODA E MAI AL POSTO DI UN SANO, che e' misurato e non una preferenza: a serbatoio unico gli
    assenti prenderebbero uno dei due posti su 81 maglie e ne caccerebbero 94 sani.
    """
    from euroleghe_ingest import gui

    source = inspect.getsource(gui.SnapshotView.eleven)
    assert "sidelined" in source, "il serbatoio degli indisponibili deve esistere"
    # il cancello agisce su `eligible` (chi puo' PARTIRE) e non sul serbatoio dei rivali
    assert "and not (today and self.out_today(row))" in source
    assert "if in_squad(row) and self.out_today(row)" in source
    # ...e i due insiemi non competono per gli stessi posti
    assert "able[:2] + hurt[:self.SIDELINED_DUELS]" in source
    assert gui.SnapshotView.SIDELINED_DUELS == 1


def test_una_definizione_sola_di_chi_oggi_non_puo_giocare():
    """`out_today` ha quattro lettori e la condizione si scrive in UN posto.

    Due copie di «e' fuori oggi» finiscono per rispondere in due modi il giorno in cui una delle due
    colonne cambia nome - ed e' esattamente la forma di difetto che questo repository ha gia' pagato con
    le due letture di `engine_fm_pred`.
    """
    from euroleghe_ingest import gui

    source = inspect.getsource(gui)
    spelled = source.count('"desc_availability_now") in ("injured", "suspended")')
    assert spelled == 1, f"la condizione e' scritta {spelled} volte invece che dentro `out_today`"
    assert '"desc_availability_now") not in ("injured", "suspended")' not in source, \
        "una copia negata della stessa condizione e' comunque una seconda definizione"
    assert 'in ("injured", "suspended")' in inspect.getsource(gui.SnapshotView.out_today)
    # ...e i lettori la CHIAMANO: il cancello dell'undici, il filtro dei top, la targa del pannello e
    # l'undici dichiarato dai probabili.
    for who in (gui.SnapshotView.eleven, gui.SnapshotView.top_players,
                gui.SnapshotView.plate_lines, gui.SnapshotView._declared):
        assert "out_today(" in inspect.getsource(who), who.__name__


def test_di_due_che_si_alternano_esce_il_peggiore_anche_fra_due_linee():
    """La promessa di `_apart` - «dei due resta quello con la quota piu' alta» - vale anche FRA le linee.

    Dentro una linea era vera per costruzione: il serbatoio arriva in ordine di claim, quindi chi e' gia'
    in campo e' per forza il migliore. Fra due linee l'ordine e' P, D, M, A e a decidere era CHI CAPITA
    PRIMA: alla Juventus il vincolo toglieva Conceicao (0,801, tre partite su tre da titolare) perche'
    Gonzalez N. (0,427) era entrato a centrocampo un giro prima.
    """
    from euroleghe_ingest.gui import SnapshotView

    relays = {"1": {"2": 0.80}, "2": {"1": 0.80}}
    # graduatoria: 0 = il migliore. "1" e' meglio di "2".
    better, worse = {"fc_id": "1", "name": "Il migliore"}, {"fc_id": "2", "name": "Il peggiore"}
    standing = {"1": 0, "2": 1}

    # il PEGGIORE e' gia' in campo: il migliore passa lo stesso
    assert not SnapshotView._relay_block(better, {"2"}, relays, standing)
    # il MIGLIORE e' gia' in campo: il peggiore no
    assert SnapshotView._relay_block(worse, {"1"}, relays, standing)
    # senza graduatoria la regola vale come prima, per tutt'e due i versi
    assert SnapshotView._relay_block(better, {"2"}, relays, None)
    # e un uomo che la graduatoria non conosce non scavalca nessuno
    assert SnapshotView._relay_block(better, {"2"}, relays, {"1": 0})


def test_la_finestra_corta_cammina_il_calendario_del_club_di_oggi():
    """«Lo sceglie» e' una domanda sul club per cui gioca ORA, quindi il denominatore e' il suo calendario.

    L'unione dei club serve al TREND - «quanto ha reso», una domanda su di LUI - e dentro una stagione sola
    un trasferimento estivo mette tutt'e due i club fra i suoi, quindi le ultime tre partite finivano per
    essere di due campionati diversi e la prova sua veniva buttata.
    """
    from euroleghe_ingest.modules import snapshot

    source = inspect.getsource(snapshot.observations_layer if hasattr(snapshot, "observations_layer")
                               else snapshot)
    assert "own_window = build(own, league_fixtures)" in source
    assert "**recent_block(obs.fc_id, own_window or league_window" in source
    # ...e il TREND continua a leggere l'unione: due domande, due denominatori
    assert "**trend_block(obs.fc_id, league_window" in source


def test_le_staffette_sono_fra_compagni_di_oggi():
    """Il taglio a `RELAY_KEEP` non puo' spendersi su coppie che nessuno chiedera' mai.

    Chi legge quella colonna - l'ordine dei ballottaggi e il vincolo dell'undici - chiede sempre di due
    uomini dello STESSO club; una coppia fra due club diversi occupa un posto e non risponde a niente.
    """
    from euroleghe_ingest.modules import snapshot

    # Uno gioca le prime due, gli altri due le ultime due: sono staffette di lui, tutt'e due.
    matches = [{1: (0.0, 90.0), 2: None, 3: None}] * 2 + [{1: None, 2: (0.0, 90.0), 3: (0.0, 90.0)}] * 2
    # ...ma solo il 2 e' un suo compagno OGGI.
    got = snapshot.relay_scores(matches, {1: "roma", 2: "roma", 3: "bologna"})
    assert any(other == 2 for other, _score in got.get(1, ())), "la coppia fra compagni deve restare"
    assert not any(other == 3 for other, _score in got.get(1, ())),         "una coppia fra due club diversi non serve a nessun lettore"
    # senza la mappa la funzione resta quella di prima, che e' quello che rende il filtro del CHIAMANTE
    assert any(other == 3 for other, _score in snapshot.relay_scores(matches).get(1, ()))


def test_il_modulo_dell_ultimo_periodo_viene_dalle_ultime_tre_partite():
    """Numeratore e denominatore dalla STESSA finestra, e in caso di pareggio decide l'ultima partita.

    Il prior del modulo leggeva il conteggio di STAGIONE (`plausible_shapes`) e lo divideva per il totale
    della finestra CORTA: sulla Fiorentina il rapporto diceva «2 su 3» per quattro moduli diversi, cioe' la
    colonna dell'ultimo periodo non entrava nel prior. La board disegnava 3-5-2 mentre le ultime tre erano
    4-3-3, 4-3-3, 4-5-1 (operatore, 11/09/2026: «quindi il risultante dovrebbe essere un 4-3-3»).
    """
    from euroleghe_ingest import gui

    source = inspect.getsource(gui.SnapshotView.shape_odds)
    assert "count = own.get(shape, 0)" in source, "il conteggio viene dalla finestra scelta"
    assert "for shape, (_season_count, league_share) in options.items():" in source
    # ...e lo spareggio dell'ultima partita non puo' scavalcare un modulo giocato una volta di piu'
    assert 0.0 < gui.SnapshotView.RECENT_SHAPE_TIE < 1.0


def test_le_ultime_partite_si_scrivono_dalla_piu_recente():
    """L'ordine della colonna E' un dato: `shape_odds` ci appoggia lo spareggio dell'operatore.

    `sorted` di Python e' stabile e le righe arrivano `ORDER BY match_date DESC`, quindi a parita' di
    conteggio il primo della colonna e' il modulo dell'ULTIMA partita. Se qualcuno riordina quella query
    la regola «in caso di dubbio dai maggior credito all'ultima partita» smette di funzionare in silenzio.
    """
    from euroleghe_ingest.modules import snapshot

    source = inspect.getsource(snapshot.recent_shapes)
    assert "ORDER BY match_date DESC" in source
    assert "key=lambda item: -item[1]" in source, "stabile: a parita' resta l'ordine delle partite"


def test_il_modulo_dell_ultimo_periodo_e_quello_dichiarato_dal_club():
    """«Utilizzare i moduli visti nelle ultime partite» (operatore, 12/09/2026), e quelli sono DICHIARATI.

    I tre conteggi di club hanno tre linee e non sanno dire un 4-2-3-1: leggendo loro, la board
    dell'ultimo periodo diceva 4-5-1 di un club che ha giocato 4-2-3-1. Il dichiarato vince; dove manca
    - un turno scaricato prima che il downloader tenesse quel campo - restano i conteggi, perche' tre
    linee sono meglio di niente.
    """
    from euroleghe_ingest.modules import snapshot

    source = inspect.getsource(snapshot.recent_shapes)
    assert "SELECT defenders, midfielders, forwards, formation" in source
    # UNA DEFINIZIONE, TRE LETTORI (14/09/2026): la regola viveva qui come espressione in linea ed e'
    # stata estratta quando `typical_formation` e `coach_repertoires` hanno dovuto leggerla anche loro.
    # L'asserzione segue il sorgente invece di essere indebolita, e ci guadagna: adesso pretende ANCHE
    # che la definizione sia una sola, che e' la meta' che tre copie avrebbero perso.
    assert "declared_or_counted(declared, defenders, midfielders, forwards)" in source
    rule = inspect.getsource(snapshot.declared_or_counted)
    assert '(declared or "").strip() or f"{defenders}-{midfielders}-{forwards}"' in rule
    for reader in (snapshot.typical_formation, snapshot.coach_repertoires):
        assert "declared_or_counted(declared" in inspect.getsource(reader), (
            f"{reader.__name__} deve leggere il modulo dichiarato dalla stessa definizione")


def test_l_ultimo_periodo_disegna_il_modulo_invece_di_dedurlo():
    """Un modulo OSSERVATO non si deduce dai codici degli uomini, e non si ripara.

    `_two_rows` spacca una linea «quando il modulo e' quello che la fonte non sa nominare» e `_reshape`
    ripara un modulo che la rosa non copre: sulla finestra corta la fonte il modulo lo NOMINA, e un
    modulo giocato la settimana scorsa la rosa lo copre per costruzione. Misurato A/B su una variabile
    sola: board di stagione ferma su 20 club di 20, board breve da 11 a 20 concordi col dichiarato.
    """
    from euroleghe_ingest import gui

    source = inspect.getsource(gui.SnapshotView.eleven)
    assert 'drawn_as_declared = horizon == "short"' in source
    assert "if not drawn_as_declared:" in source
    assert "self._lanes_final = True" in source, "i posti decisi non si rileggono dai codici"
    # ...e i moduli delle ultime partite devono essere SELEZIONABILI, o il prior li assegna a un modulo
    # che il club non ha mai giocato: le altre tre sorgenti parlano tutte a tre linee.
    assert "self.plausible_shapes(info, horizon_of(mode))" in inspect.getsource(
        gui.SnapshotView.shape_odds)


def test_una_staffetta_non_si_salta_per_uno_peggiore():
    """Queste vie SCAMBIANO, quindi togliere un compagno di staffetta deve lasciare qualcuno di MEGLIO.

    Alla Roma il vincolo toglieva Castro S. (che si alterna con Malen) e la riparazione scendeva ad
    Arena A., piu' debole di lui: l'eccezione dell'operatore dice «salvo buchi non riempibili da ALTRI», e
    un uomo peggiore non e' un altro che riempie.
    """
    from euroleghe_ingest.gui import SnapshotView

    relays = {"1": {"2": 0.80}, "2": {"1": 0.80}}
    partner = {"fc_id": "2", "name": "Il compagno di staffetta"}
    better = {"fc_id": "3", "name": "Uno migliore"}
    worse = {"fc_id": "4", "name": "Uno peggiore"}
    standing = {"1": 0, "2": 2, "3": 1, "4": 3}          # posizione: piu' bassa = migliore

    # c'e' chi e' meglio di lui: si salta
    got = SnapshotView._no_relay(SnapshotView, [partner, better], {"1"}, relays, standing)
    assert [row["name"] for row in got] == ["Uno migliore"]
    # restano solo uomini peggiori: rientra
    got = SnapshotView._no_relay(SnapshotView, [partner, worse], {"1"}, relays, standing)
    assert {row["name"] for row in got} == {"Il compagno di staffetta", "Uno peggiore"}


def test_il_lato_lo_dice_la_partita_e_non_la_stagione():
    """La heatmap non puo' rispondere «dove ha giocato nelle ultime tre», il posto in formazione si'.

    L'endpoint della heatmap e' per (giocatore, STAGIONE) e per il 2026-27 `positions.avg_y` e' vuoto su
    tutte le righe: `tm_appearances.position_id` invece c'e' per ogni partita giocata. Se ne legge il solo
    LATO, perche' la griglia della fonte divide le linee in un altro modo (il posto 8 e' un esterno destro
    che puo' essere terzino o mediano) mentre destra/centro/sinistra vuol dire la stessa cosa.
    """
    from euroleghe_ingest.modules import snapshot

    # ogni posto della griglia ha un lato, e i tre valori sono i soli ammessi
    assert set(snapshot.TM_SLOT_SIDE.values()) == {-1.0, 0.0, 1.0}
    assert set(snapshot.TM_SLOT_SIDE) == set(snapshot.TM_SLOT_NAME) == set(range(1, 15))
    # ...e il lato concorda col codice dominante di quel posto, che e' come la tabella e' stata derivata
    from euroleghe_ingest.modules.positions import REAL_ROLE_SIDE
    for slot, side in snapshot.TM_SLOT_SIDE.items():
        assert REAL_ROLE_SIDE[snapshot.TM_SLOT_NAME[slot]] == side, slot


def test_il_lato_giocato_lo_leggono_le_due_finestre_in_due_modi():
    """Le due finestre leggono DUE lati, e la scelta fra loro sta in UN posto solo (`fit_side`).

    Il 12/09/2026 il lato giocato era acceso sull'ultimo periodo e spento sulla stagione, con una
    ragione che valeva allora: «una finestra di tre partite non ha titolo a decidere un disegno
    d'annata». Il 15/09 l'operatore l'ha sostituita dicendo a quali condizioni quel titolo ce l'ha -
    «3 partite intere o quasi giocate in una nuova posizione sono una conferma che l'allenatore voglia
    utilizzarlo anche li'» - quindi sulla stagione entra `held_side`, che quella conferma la pretende,
    mentre l'ultimo periodo continua a leggere l'ultima partita giocata.

    La scelta viveva in DUE punti (`_slot_price` e `measured_across`), cioe' una riga che qualcuno
    avrebbe aggiornato per meta': ora e' una funzione, e questo test asserisce che nessuno dei due se
    ne tenga una copia.
    """
    import inspect

    from euroleghe_ingest import gui

    choice = inspect.getsource(gui.SnapshotView.fit_side)
    assert 'self.played_side(row) if self._fit_horizon == "short"' in choice
    assert "self.held_side(row)" in choice
    for reader in (gui.SnapshotView._slot_price, gui.SnapshotView.measured_across):
        source = inspect.getsource(reader)
        assert "held = self.fit_side(row)" in source, reader.__name__
        assert "played_side" not in source, f"{reader.__name__} tiene una copia della scelta"
    # ...e l'orizzonte lo dichiara `eleven`, che e' la porta d'ingresso del disegno
    assert "self._fit_horizon = horizon" in inspect.getsource(gui.SnapshotView.eleven)
    assert gui.SnapshotView._fit_horizon == "season", "una vista che non ha disegnato legge la stagione"


def test_la_fascia_intera_di_un_centrocampo_resta_un_lavoro_di_corsia():
    """`_wing_back_trade`: davanti a una difesa a tre le fasce del centrocampo sono tutta la corsia, e
    il rivale deve avere un codice di fascia della linea D o M.

    E' la sentenza dell'operatore sul caso Malen (08/08/2026), «un attaccante puro non diventa un
    esterno a tutta fascia per 0,03 di claim». Un ramo che leggeva anche la DISTINTA delle ultime tre
    partite e' stato aggiunto e tolto il 12/09/2026: serviva al caso Chukwueze, la lettura per slot lo
    supera - li' l'undici non passa piu' da qui - e quello che restava poteva scattare solo sulla board
    di STAGIONE, dove una finestra di tre partite non ha titolo a decidere un disegno d'annata.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    def row(codes: str, slots: str | None = None) -> dict:
        return {"desc_real_roles": codes, "desc_recent_slots": slots}

    assert View._wing_back_trade(row("DR;MR")) is True
    assert View._wing_back_trade(row("ML;DL")) is True
    # un'ala pura resta fuori, ed e' la sentenza su Malen
    assert View._wing_back_trade(row("RW;ST")) is False
    assert View._wing_back_trade(row("RW")) is False
    # ...e la DISTINTA non entra qui nemmeno quando c'e': un'ala che la fonte ha schierato a
    # centrocampo resta un'ala per questo cancello, che e' una domanda sul profilo
    assert View._wing_back_trade(row("RW", "16284970:3-4-2-1:4")) is False


def _slot_view(rows: list[dict], rulings: dict | None = None, floor: int = 1):
    """Una vista minima per `_from_slots`: il claim, `can_replace`, i due appigli - E LE DRITTE.

    `_player_rulings` non era impostato, quindi `ruling_of` rispondeva None su ogni riga e TUTTO il ramo
    delle dichiarazioni era scoperto: e' cosi' che il difetto dei due `starter` che si scacciavano a
    vicenda e' arrivato a HEAD. La vista del pannello lo imposta a `load_sheet`; qui si passa per NOME,
    e la chiave resta l'`fc_id` come nel file vero.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    view._slot_side, view._slot_order = {}, {}
    view.claim = lambda row, _horizon="short": float(row.get("claim") or 0.0)
    for row in rows:
        row.setdefault("desc_real_roles", "MC")
        row.setdefault("desc_titolarita", "riserva")
    view._player_rulings = {}
    for name, ruling in (rulings or {}).items():
        for row in rows:
            if row.get("name") == name:
                view._player_rulings[int(float(row["fc_id"]))] = ruling
    # ...e il PAVIMENTO sceso a uno, DICHIARATO: quasi ogni caso qui riempie tre posti di undici per
    # isolare una regola, e col pavimento vero leggerebbero tutti `None` - cioe' proverebbero il
    # pavimento e nient'altro. Quello lo prova il suo test, che usa la costante vera.
    view.SLOT_BOARD_MIN = floor
    return view


def test_l_undici_dell_ultimo_periodo_si_legge_posto_per_posto():
    """Le tre regole dell'operatore (12/09/2026), e questa funzione non ne aggiunge nessuna.

    «Devi vedere i calciatori che hanno giocato di piu' nelle ultime 3 partite e metterli DOVE hanno
    giocato in queste 3 partite. Se ci sono piu' giocatori per una stessa posizione li metti in
    ballottaggio.» Il claim entra SOLO a parita' di partite.
    """
    def man(name, claim, slots, rung="riserva"):
        return {"name": name, "fc_id": name, "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": rung, "desc_real_roles": "MC"}

    # un 1-1-1 fittizio non esiste: si usa un modulo vero e si riempie la DIFESA INTERA. Gli altri due
    # posti di difesa hanno un padrone di proposito: senza, chi perde un ballottaggio finisce sul posto
    # scoperto accanto (§12.8) e questo caso non potrebbe piu' dire niente sul ballottaggio.
    rows = [man("Por", 0.9, "m1:4-3-3:0"),
            man("Tiene", 0.2, "m1:4-3-3:1;m2:4-3-3:1"),        # due volte quel posto
            man("Perde", 0.9, "m1:4-3-3:1"),                 # claim piu' alto, UNA volta sola
            man("Pari", 0.4, "m1:4-3-3:2"), man("PariB", 0.7, "m1:4-3-3:2"),
            man("Terzo", 0.5, "m1:4-3-3:3;m2:4-3-3:3"), man("Quarto", 0.5, "m1:4-3-3:4;m2:4-3-3:4")]
    view = _slot_view(rows)
    drawn = view._from_slots(rows, [], "4-3-3", "short")
    by_slot = {row["name"]: (lane, [r["name"] for r in rivals]) for lane, row, rivals in drawn}
    where = {row["name"]: view._slot_order.get(id(row)) for _lane, row, _rivals in drawn}
    # LE PARTITE PRIMA DEL CLAIM: chi ha occupato il posto due volte lo tiene, anche con claim 0.2 -
    # e l'asserzione e' sul POSTO, perche' chi lo perde non sparisce dalla board: la sua riga ha altri
    # posti scoperti e lui li' ci sta bene (§12.8), il che e' un'altra regola e ha il suo test.
    assert where["Tiene"] == 1 and where.get("Perde") != 1
    assert by_slot["Tiene"][1][0] == "Perde"          # e l'altro e' il suo ballottaggio
    # ...e a PARITA' di partite decide il claim
    assert where["PariB"] == 2 and by_slot["PariB"][1][0] == "Pari"
    # il posto porta la LINEA del modulo: slot 0 il portiere, 1-4 la difesa
    assert by_slot["Por"][0] == "P" and by_slot["Tiene"][0] == "D"

    # ...E UNO SLOT DI UN ALTRO MODULO VOTA LO STESSO (regola dell'operatore, 12/09/2026), mappato sul
    # blocco di righe giusto: un difensore di un 3-4-2-1 resta un difensore in un 4-3-3.
    altro = [man("Estraneo", 0.9, "m1:3-4-2-1:1")]
    solo = view._from_slots(altro, [], "4-3-3", "short")
    assert [lane for lane, _row, _rivals in solo] == ["D"]
    # ...e senza NESSUNO slot leggibile non c'e' niente da leggere, e il chiamante torna al calcolo
    assert view._from_slots([man("Vuoto", 0.9, "")], [], "4-3-3", "short") is None


def test_il_posto_di_un_indisponibile_va_a_chi_puo_prenderlo_e_lui_resta_in_ballottaggio():
    """«Qualche calciatore che rientra da infortunio... ma li metti sempre in ballottaggio» - e undici
    uomini vanno messi in campo comunque. E' l'unica cosa che la lettura per slot SCEGLIE."""
    def man(name, claim, slots, rung="riserva"):
        return {"name": name, "fc_id": name, "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": rung, "desc_real_roles": "MC"}

    owner = man("Padrone", 0.9, "m1:4-3-3:1")
    stand_in = man("Riserva", 0.3, "", rung="panchina")
    rows = [man("Por", 0.9, "m1:4-3-3:0"), stand_in]
    view = _slot_view(rows + [owner])
    drawn = view._from_slots(rows, [owner], "4-3-3", "short")
    by_name = {row["name"]: [r["name"] for r in rivals] for _lane, row, rivals in drawn}
    assert "Riserva" in by_name, "il posto va comunque riempito"
    assert "Padrone" not in by_name, "chi oggi non puo' giocare non si disegna in campo"
    assert "Padrone" in by_name["Riserva"], "ma resta il ballottaggio che spiega quella maglia"


def test_le_righe_che_coincidono_valgono_uguale_le_altre_no():
    """La regola dell'operatore sul peso (12/09/2026), col suo stesso esempio - e la mappatura CONTATA.

    «Modulo scelto 3-4-1-2, modulo diverso 3-4-3: difesa e centrocampo sono uguali e i posti vanno
    trattati allo stesso livello; trequarti e attacco sono diversi e vanno trattati con pesi diversi.»

    E IL PRIMO ASSERTO E' UN CONTEGGIO, non un intervallo. La prima versione di questa mappatura
    decomponeva i due moduli in BLOCCHI di righe e diceva di mappare «per posizione relativa dentro il
    blocco»: i blocchi hanno per costruzione la stessa taglia sui due lati, quindi quel conto era
    l'IDENTITA' su 1331 combinazioni di 1331 - e i test passavano perche' asserivano INTERVALLI che
    l'identita' soddisfa. Un test che accetta l'identita' non e' un test di quella trasformazione.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    from euroleghe_ingest.config import Config

    # i moduli si LEGGONO dal regolamento, che e' configurazione e non si trascrive
    shapes = sorted(Config().load_modules("mantra").get("modules", {}))
    assert len(shapes) >= 11
    moved = sum(1 for played in shapes for drawn in shapes for slot in range(11)
                if (View._slot_across_shapes(played, slot, drawn) or (slot,))[0] != slot)
    assert moved > 0, "una mappatura che non sposta mai niente e' l'identita' con un docstring"
    # ...e quello che sposta e' la RIGA: un difensore resta un difensore. Lo slot 4 di un 4-3-3 e' il
    # quarto difensore e NON puo' finire sullo slot 4 di un 3-4-2-1, che e' il primo centrocampista.
    place, exact = View._slot_across_shapes("4-3-3", 4, "3-4-2-1")
    assert not exact and place == 3, "il quarto di una difesa a quattro e' il terzo di una a tre"
    for played in shapes:
        for drawn in shapes:
            lanes = {}
            index = 0
            for lane, count in View.shape_lanes(played):
                for _inside in range(count):
                    lanes[index] = lane
                    index += 1
            there = {}
            index = 0
            for lane, count in View.shape_lanes(drawn):
                for _inside in range(count):
                    there[index] = lane
                    index += 1
            for slot, lane in lanes.items():
                got = View._slot_across_shapes(played, slot, drawn)
                if got is None or lane not in set(there.values()):
                    continue
                assert there[got[0]] == lane, (
                    f"{played}:{slot} ({lane}) finisce in {there[got[0]]} di {drawn}")

    # il suo esempio: P, D e M coincidono riga per riga -> STESSO posto, peso pieno
    for slot in range(8):
        assert View._slot_across_shapes("3-4-3", slot, "3-4-1-2") == (slot, True)
    # trequarti + attacco (1+2) contro attacco (3): righe diverse -> peso ridotto, e la trequarti che
    # il modulo disegnato non ha cade nella riga piu' vicina che esiste
    for slot in (8, 9, 10):
        _place, exact = View._slot_across_shapes("3-4-3", slot, "3-4-1-2")
        assert not exact

    # un modulo identico non e' mai un'approssimazione
    assert View._slot_across_shapes("4-3-3", 5, "4-3-3") == (5, True)


def test_una_partita_con_un_altro_modulo_vota_e_non_decide_da_sola():
    """Peso dichiarato: due osservazioni approssimate valgono un'osservazione esatta, non di piu'."""
    from euroleghe_ingest.gui import SnapshotView as View

    def man(name, claim, slots):
        return {"name": name, "fc_id": name, "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": "riserva", "desc_real_roles": "MC"}

    # uno ha il posto UNA volta nel modulo disegnato, l'altro DUE volte in un modulo diverso, sulla
    # riga che non coincide: 1.0 contro 2 x OTHER_SHAPE_WEIGHT = 1.0, e allora decide il claim.
    esatto = man("Esatto", 0.2, "m1:3-4-1-2:9")
    altro = man("Altro", 0.9, "m1:3-4-3:9;m2:3-4-3:9")
    view = _slot_view([esatto, altro])
    drawn = view._from_slots([esatto, altro], [], "3-4-1-2", "short")
    assert View.OTHER_SHAPE_WEIGHT == 0.5
    at_nine = {view._slot_order.get(id(row)): row["name"] for _lane, row, _rivals in drawn}
    assert at_nine.get(9) == "Altro", "a parita' di peso decide il claim"
    # ...ma UNA sola partita in un altro modulo non scavalca una partita esatta
    solo_una = man("Altro", 0.9, "m1:3-4-3:9")
    view2 = _slot_view([esatto, solo_una])
    drawn2 = view2._from_slots([esatto, solo_una], [], "3-4-1-2", "short")
    at_nine2 = {view2._slot_order.get(id(row)): row["name"] for _lane, row, _rivals in drawn2}
    assert at_nine2.get(9) == "Esatto"


def test_un_calendario_NEGATIVO_e_una_stagione_senza_calendario_come_lo_zero():
    """La 4a giornata e' COMINCIATA e non ancora votata: 3 in archivio meno 4 viste fa **-1**.

    Trovato il 12/09/2026 sul foglio vero: `engine_pv_pred` da -0,8 a -0,1 su 393 righe, e con lui
    valore e surplus, perche' la guardia era `if not matchdays_target` - falsa per -1 - e il calendario
    negativo si moltiplicava dentro ogni colonna. Uno ZERO si vede; un meno uno passa e rende il foglio
    inutilizzabile senza che niente si lamenti.

    E LA CURA STA IN `features.prepare` E NON IN CHI LEGGE. Era nata dentro `snapshot.engine_predictions`,
    che e' un CONSUMATORE: il pannello d'asta, `estimates` e chiunque chiami `prepare` da se' leggevano il
    numero crudo. Qui si prova la FUNZIONE, e in coda si verifica che il consumatore non se ne sia tenuta
    una copia - due copie di questa sottrazione sono come il foglio e il pannello cominciano a rispondere
    due cose sullo stesso calendario.
    """
    import inspect

    from euroleghe_ingest.engine.features import target_matchdays
    from euroleghe_ingest.modules import snapshot as snap

    # pre-stagione: nessuna giornata vista, il conteggio di sempre, e NON e' un ripiego
    assert target_matchdays(38, 38, 0) == (38, False)
    # una finestra in-season del gate: la stagione bersaglio e' completa in archivio, 38 - 6
    assert target_matchdays(38, 38, 6) == (32, False)
    # LA STAGIONE VIVA: tre giornate votate, quattro giocate -> -1, e il ripiego e' il calendario
    # precedente meno quelle viste
    assert target_matchdays(3, 38, 4) == (34, True)
    # ...e lo zero che si vedeva gia'
    assert target_matchdays(0, 38, 0) == (38, True)
    # ...e un calendario che non esiste da nessuna parte non scende sotto UNA giornata: una previsione
    # si divide per quel numero
    assert target_matchdays(0, 0, 0) == (1, True)

    # il consumatore scrive la NOTA e non rifa' il conto
    source = inspect.getsource(snap.engine_predictions)
    assert "data.matchdays_from_prev" in source
    assert "matchdays_target <= 0" not in source and "not data.matchdays_target" not in source


def test_un_rivale_non_puo_essere_anche_un_titolare():
    """Trovato dall'operatore sullo schermo (12/09/2026): «nel Como N. Paz esce 2 volte».

    Paz N. era il titolare della trequarti e insieme il ballottaggio di Diao, Baturina titolare a
    sinistra e rivale della trequarti. Contare il claim di un compagno come concorrenza per un posto
    che non gli contende e' esattamente cio' che la coda di `eleven` evita da sempre, e la lettura per
    slot non lo faceva. Il filtro sta DOPO il ciclo, perche' chi e' titolare si sa solo quando tutte le
    maglie sono consegnate.
    """
    def man(name, claim, slots):
        return {"name": name, "fc_id": name, "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": "titolare", "desc_real_roles": "MC"}

    # due uomini, due posti: ognuno e' titolare del suo, quindi nessuno dei due e' rivale dell'altro
    uno = man("Uno", 0.9, "m1:4-3-3:5;m2:4-3-3:6")
    due = man("Due", 0.8, "m1:4-3-3:6;m2:4-3-3:5")
    rows = [uno, due]
    view = _slot_view(rows)
    drawn = view._from_slots(rows, [], "4-3-3", "short")
    on_pitch = {row["name"] for _lane, row, _rivals in drawn}
    assert on_pitch == {"Uno", "Due"}
    for _lane, row, rivals in drawn:
        assert not [r for r in rivals if r["name"] in on_pitch], (
            f"{row['name']} ha per rivale un titolare")


def test_nessuno_viene_consumato_da_un_posto_dove_vale_meno_che_a_casa_sua():
    """Trovato dall'operatore sullo schermo: «nella Juve hai invertito Koopmeiners con Conceicao».

    Conceicao ha lo slot 7 in tutt'e due i 4-2-3-1 e il 5 solo nel 4-4-2; il suo posto e' il 7. Ma
    Locatelli, padrone del 5, e' infortunato, e servendo i posti in ordine il 5 si prendeva Conceicao e
    lasciava il 7 a un ripiego. La prima passata salta chi vale di piu' su una maglia ancora libera.

    E il vincolo NON e' «solo i padroni», che e' stato scritto prima ed era troppo forte: al Milan lo
    slot 6 ha Jashari (una volta, casa sua) e Modric (una volta, casa altrove per spareggio), e cosi'
    Modric non era nemmeno candidato. A pesi uguali nessuno e' protetto e decide il claim.
    """
    def man(name, claim, slots):
        return {"name": name, "fc_id": name, "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": "titolare", "desc_real_roles": "MC"}

    # IL CASO JUVE: il padrone del 5 e' fuori, e il 5 non deve prendersi il padrone del 7
    padrone5 = man("Locatelli", 0.9, "m1:4-2-3-1:5;m2:4-2-3-1:5")
    suo7 = man("Conceicao", 0.8, "m1:4-2-3-1:7;m2:4-2-3-1:7;m3:4-4-2:5")
    ripiego = man("Koopmeiners", 0.4, "")
    view = _slot_view([suo7, ripiego, padrone5])
    drawn = view._from_slots([suo7, ripiego], [padrone5], "4-2-3-1", "short")
    where = {row["name"]: lane for lane, row, _rivals in drawn}
    assert where.get("Conceicao") == "T", "il suo posto e' il 7, cioe' la trequarti"
    assert where.get("Koopmeiners") == "M", "il ripiego prende la maglia del padrone infortunato"

    # IL CASO MILAN: due uomini una volta ciascuno sullo stesso posto, e decide il claim
    casa6 = man("Jashari", 0.3, "m1:3-4-2-1:6")
    altrove = man("Modric", 0.6, "m1:3-4-2-1:5;m2:3-4-2-1:6")
    forte5 = man("Musah", 0.9, "m1:3-4-2-1:5;m2:3-4-2-1:5")
    rows = [casa6, altrove, forte5]
    view2 = _slot_view(rows)
    drawn2 = view2._from_slots(rows, [], "3-4-2-1", "short")
    where2 = {row["name"]: view2._slot_order.get(id(row)) for _lane, row, _rivals in drawn2}
    assert where2["Musah"] == 5, "due volte quel posto, e nessuno lo protegge altrove"
    assert where2["Modric"] == 6, "a pesi uguali sullo stesso posto decide il claim"
    assert where2["Jashari"] != 6, "chi perde il suo posto non lo tiene comunque"



def test_la_staffetta_arriva_alla_board_breve_e_non_lascia_mai_un_posto_vuoto():
    """La regola dell'11/09/2026 era IRRAGGIUNGIBILE sulla board breve dal giorno dopo la sua adozione.

    Il ritorno anticipato di `_from_slots` esce prima del punto in cui `eleven` calcola `relays`: adottata
    e misurata l'11/09, spenta in silenzio il 12. Qui vive dentro la lettura, e con una differenza che e'
    il motivo per cui la colonna porta anche la PARTITA: due uomini che possiedono due slot della STESSA
    distinta hanno COMINCIATO insieme, e una misura a intervalli di minuti - che e' un'inferenza - non puo'
    contraddire un fatto osservato.

    E IL VETO NON LASCIA MAI UN POSTO VUOTO. Trovato all'Atalanta: lo slot 6 e' di Gaetano, indisponibile,
    e dei sei uomini liberi l'unico centrocampista era Kessie - tolto dal veto PRIMA del filtro di
    posizione, il posto restava vuoto e la board scendeva a dieci. Il veto si applica DOPO e cede se
    toglie l'ultimo candidato, che e' l'eccezione dell'operatore («a quel punto la linea sarebbe corta»).
    """
    from euroleghe_ingest.gui import SnapshotView as View

    def man(name, claim, slots, relay="", rung="titolare"):
        return {"name": name, "fc_id": name, "claim": claim, "desc_recent_slots": slots,
                "desc_relay": relay, "desc_titolarita": rung, "desc_real_roles": "MC"}

    # due uomini che non hanno MAI cominciato la stessa partita e che la colonna dichiara staffetta
    uno = man("Uno", 0.9, "m1:4-3-3:5;m2:4-3-3:5", relay=f"Due:{View.RELAY_APART + 0.2:.3f}")
    due = man("Due", 0.6, "m3:4-3-3:6;m4:4-3-3:6")
    terzo = man("Terzo", 0.5, "m1:4-3-3:6;m2:4-3-3:6")
    rows = [uno, due, terzo]
    view = _slot_view(rows)
    drawn = view._from_slots(rows, [], "4-3-3", "short")
    where = {row["name"]: view._slot_order.get(id(row)) for _lane, row, _rivals in drawn}
    assert where["Uno"] == 5
    assert where.get("Due") != 6, "una staffetta dichiarata non occupa il secondo posto"
    assert where["Terzo"] == 6, "...che va a chi quel posto lo ha occupato e non si alterna con lui"

    # ...MA SE HANNO COMINCIATO INSIEME, il fatto batte l'inferenza e il vincolo non si applica
    insieme = man("Due", 0.6, "m1:4-3-3:6;m2:4-3-3:6")
    rows2 = [uno, insieme]
    view2 = _slot_view(rows2)
    drawn2 = view2._from_slots(rows2, [], "4-3-3", "short")
    where2 = {row["name"]: view2._slot_order.get(id(row)) for _lane, row, _rivals in drawn2}
    assert where2["Uno"] == 5 and where2["Due"] == 6

    # ...e il veto CEDE prima di lasciare un posto vuoto: l'unico candidato resta l'unico candidato
    solo = man("Solo", 0.6, "m3:4-3-3:6")
    rows3 = [uno, solo]
    view3 = _slot_view(rows3)
    drawn3 = view3._from_slots(rows3, [], "4-3-3", "short")
    where3 = {row["name"]: view3._slot_order.get(id(row)) for _lane, row, _rivals in drawn3}
    assert where3["Solo"] == 6, "un posto vuoto e' peggio di due che si alternano"


def test_un_undici_a_META_non_si_disegna_e_il_chiamante_torna_al_calcolo():
    """`SLOT_BOARD_MIN`: la funzione lo DICHIARAVA nel suo docstring e non lo applicava.

    Un club le cui distinte sono riempite da uomini che il listone non quota poteva uscire con un uomo
    solo in campo. Nove di undici perche' un posto vuoto e' onesto - quel posto e' di un uomo fuori
    perimetro - e cinque non lo sono. Qui si usa la costante VERA: il pavimento della vista dei test e'
    sceso a uno apposta, e un test che lo abbassa non prova il pavimento.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    def man(name, slot):
        return {"name": name, "fc_id": name, "claim": 0.9,
                "desc_recent_slots": f"m1:4-3-3:{slot}", "desc_titolarita": "titolare",
                "desc_real_roles": "MC"}

    assert View.SLOT_BOARD_MIN == 9
    pochi = [man(f"M{slot}", slot) for slot in range(8)]
    view = _slot_view(pochi, floor=View.SLOT_BOARD_MIN)
    assert view._from_slots(pochi, [], "4-3-3", "short") is None, "otto posti non sono un undici"
    abbastanza = [man(f"M{slot}", slot) for slot in range(9)]
    view2 = _slot_view(abbastanza, floor=View.SLOT_BOARD_MIN)
    assert len(view2._from_slots(abbastanza, [], "4-3-3", "short")) == 9


def test_gli_indisponibili_sono_ballottaggi_in_coda_e_col_loro_tetto():
    """Come nella coda di `eleven`: sono un'altra domanda - «di chi e' la maglia quando torna».

    Un tetto solo sui due insiemi farebbe dipendere il secondo da quanti rivali sani ha quel posto, che
    e' proprio l'informazione che il marchio serve a dare dove manca (regola dell'11/09/2026).
    """
    from euroleghe_ingest.gui import SnapshotView as View

    def man(name, claim, slots="", rung="titolare"):
        return {"name": name, "fc_id": name, "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": rung, "desc_real_roles": "MC"}

    titolare = man("Titolare", 0.9, "m1:4-3-3:5;m2:4-3-3:5")
    sani = [man(f"Sano{i}", 0.5 - i / 100) for i in range(3)]
    fuori = [man(f"Fuori{i}", 0.8 - i / 100) for i in range(3)]
    rows = [titolare, *sani]
    view = _slot_view(rows + fuori)
    drawn = view._from_slots(rows, fuori, "4-3-3", "short")
    rivali = {row["name"]: [r["name"] for r in rivals] for _lane, row, rivals in drawn}
    hurt = [name for name in rivali["Titolare"] if name.startswith("Fuori")]
    assert len(hurt) == View.SIDELINED_DUELS, "gli indisponibili hanno un tetto loro"
    assert rivali["Titolare"][-len(hurt):] == hurt, "...e stanno in CODA ai sani"


def test_una_dritta_alternative_compare_fra_i_rivali_invece_di_finire_tagliata():
    """«Deve comparire sul campetto» (operatore, 07/09/2026), e sotto il tetto di `boards.MAX_DUELS` un
    ordine sbagliato equivale a non disegnarla."""
    # ...e una dritta si unisce per `fc_id`, come nel file vero: qui i fixture ne hanno uno NUMERICO
    ids = iter(range(100, 200))

    def man(name, claim, slots="", rung="riserva"):
        return {"name": name, "fc_id": next(ids), "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": rung, "desc_real_roles": "MC"}

    titolare = man("Titolare", 0.9, "m1:4-3-3:5;m2:4-3-3:5")
    # il centrocampo e' pieno di proposito: un posto libero della sua linea si prenderebbe uno dei
    # ripieghi, e un uomo in campo non e' piu' un rivale - questo caso misura l'ORDINE dei rivali
    compagni = [man(f"Compagno{slot}", 0.7, f"m1:4-3-3:{slot};m2:4-3-3:{slot}", rung="titolare")
                for slot in (6, 7)]
    forti = [man(f"Forte{i}", 0.8, rung="titolare") for i in range(3)]
    dichiarato = man("Dichiarato", 0.1)
    rows = [titolare, *compagni, *forti, dichiarato]
    senza = _slot_view(rows)
    prima = {row["name"]: [r["name"] for r in rivals]
             for _lane, row, rivals in senza._from_slots(rows, [], "4-3-3", "short")}
    assert prima["Titolare"][0] != "Dichiarato"
    con = _slot_view(rows, {"Dichiarato": "alternative"})
    dopo = {row["name"]: [r["name"] for r in rivals]
            for _lane, row, rivals in con._from_slots(rows, [], "4-3-3", "short")}
    assert dopo["Titolare"][0] == "Dichiarato", "la dritta viene prima del gradino di stagione"


def test_due_dritte_starter_non_si_scacciano_a_vicenda():
    """Verificato eseguendo, e la configurazione viva ne ha gia' DUE (Pinamonti e Berardi).

    Col secondo dichiarato, il primo usciva dall'undici e tornava come ballottaggio: un uomo appena
    inserito non ha occupato nessun posto, quindi segna zero sulla chiave del «piu' debole» ed e' sempre
    lui la maglia piu' facile da prendere. E il ramo era del tutto SCOPERTO dai test, perche' la vista
    che li serve non impostava `_player_rulings`: e' cosi' che il difetto e' arrivato a HEAD.
    """
    ids = iter(range(100, 200))

    def man(name, claim, slots="", rung="titolare"):
        return {"name": name, "fc_id": next(ids), "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": rung, "desc_real_roles": "MC"}

    campo = [man(f"Campo{slot}", 0.9 - slot / 100, f"m1:4-3-3:{slot};m2:4-3-3:{slot}")
             for slot in range(11)]
    primo, secondo = man("Primo", 0.2), man("Secondo", 0.1)
    rows = campo + [primo, secondo]
    view = _slot_view(rows, {"Primo": "starter", "Secondo": "starter"})
    drawn = view._from_slots(rows, [], "4-3-3", "short")
    in_campo = [row["name"] for _lane, row, _rivals in drawn]
    assert "Primo" in in_campo and "Secondo" in in_campo, "due dichiarazioni, due maglie"
    assert len(in_campo) == 11 and len(set(in_campo)) == 11


def test_un_posto_che_nessuno_ha_occupato_va_prima_alla_sua_RIGA():
    """Il COMPLETAMENTO, ed e' l'aritmetica della mappatura per riga e non un difetto dei dati.

    Una riga di `n` uomini letta dentro una di `m` piu' larga cade sui suoi ESTREMI: il centrocampo a
    due di un 4-2-3-1 vota gli slot 5 e 7 di un 4-3-3 e MAI il 6. Quindi il posto scoperto e' una cosa
    che la fonte non dice, e va a chi quella RIGA l'ha occupata e non ha ancora una maglia - la fonte
    dice che ha cominciato li', e quale dei tre posti sia e' esattamente cio' che la mappatura non sa
    dire. E' il caso Fiorentina: Fagioli secondo sul 5 e sul 7, e senza questo ramo non era disegnato
    affatto mentre la riga restava a due.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    # il 6 di un 4-3-3 non riceve nessun voto da un centrocampo a due
    assert View._slot_across_shapes("4-2-3-1", 5, "4-3-3")[0] == 5
    assert View._slot_across_shapes("4-2-3-1", 6, "4-3-3")[0] == 7

    def man(name, claim, slots, rung="titolare"):
        return {"name": name, "fc_id": name, "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": rung, "desc_real_roles": "MC"}

    ndour = man("Ndour", 0.9, "m1:4-2-3-1:5;m2:4-3-3:5")
    atta = man("Atta", 0.8, "m1:4-2-3-1:8;m2:4-3-3:7")
    fagioli = man("Fagioli", 0.7, "m1:4-2-3-1:6;m3:4-3-3:5")
    estraneo = man("Estraneo", 0.95, "", rung="bandiera")
    rows = [ndour, atta, fagioli, estraneo]
    view = _slot_view(rows)
    drawn = view._from_slots(rows, [], "4-3-3", "short")
    where = {row["name"]: view._slot_order.get(id(row)) for _lane, row, _rivals in drawn}
    assert where["Ndour"] == 5 and where["Atta"] == 7
    assert where["Fagioli"] == 6, "la RIGA viene prima di chi la finestra non ha visto giocare"
    assert where.get("Estraneo") != 6


def test_il_ripiego_di_un_posto_scoperto_accetta_la_fascia_SPECCHIATA():
    """`can_replace` col suo ripiego specchiato, che e' il filtro di ogni rivale del pannello: un destro
    fa la fascia mancina quando nessuno la gioca. Senza, il posto restava vuoto."""
    def man(name, claim, slots, codes, rung="titolare"):
        return {"name": name, "fc_id": name, "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": rung, "desc_real_roles": codes}

    padrone = man("Mancino", 0.9, "m1:4-3-3:4;m2:4-3-3:4", "DL")
    destro = man("Destro", 0.5, "", "DR")
    # gli altri posti della difesa hanno un padrone, o il ripiego cade sul primo libero e questo caso
    # misurerebbe l'ordine dei posti invece dello specchio
    altri = [man(f"Centrale{slot}", 0.8, f"m1:4-3-3:{slot};m2:4-3-3:{slot}", "DC")
             for slot in (1, 2, 3)]
    rows = [destro, *altri]
    view = _slot_view([padrone, destro, *altri])
    drawn = view._from_slots(rows, [padrone], "4-3-3", "short")
    where = {row["name"]: view._slot_order.get(id(row)) for _lane, row, _rivals in drawn}
    assert where.get("Destro") == 4, "nessun mancino libero: la fascia va allo specchio"


def test_una_partenza_RECENTE_batte_due_VECCHIE():
    """`RECENT_DECAY`, dal caso Rabiot dell'operatore (13/09/2026).

    Il Milan gioca tre giornate: Loftus-Cheek comincia le prime due e Rabiot la terza, sullo stesso
    posto. Contando le occorrenze il posto resta al primo, 2-1; misurato sulla domanda che questa board
    pone - chi lo occupera' alla PROSSIMA - contare e' il punto peggiore della griglia (0,5898 contro
    0,6077 di ogni peso sotto 0,618) e sui 13.979 posti dove le due regole non sono d'accordo il peso
    azzecca 0,375 contro 0,311. La stessa popolazione lo dice anche per pattern: chi ha cominciato solo
    l'ultima ricomincia il 56,3% delle volte, chi ha cominciato le prime due il 48,3%.
    """
    def man(name, claim, slots):
        return {"name": name, "fc_id": name, "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": "titolare", "desc_real_roles": "MC"}

    # distanze: 0 = la piu' recente. Il claim del vecchio padrone e' piu' ALTO, cosi' la parita' non
    # puo' spiegare il risultato: quello che decide e' il peso.
    nuovo = man("Rabiot", 0.30, "m3:4-3-3:5:0")
    vecchio = man("LoftusCheek", 0.90, "m2:4-3-3:5:1;m1:4-3-3:5:2")
    altri = [man(f"Mezzala{slot}", 0.8, f"m3:4-3-3:{slot}:0") for slot in (4, 6)]
    rows = [nuovo, vecchio, *altri]
    drawn = _slot_view(rows)._from_slots(rows, [], "4-3-3", "short")
    posto = [(row, rivals) for _lane, row, rivals in drawn if _lane == "M"]
    starter = next(row["name"] for row, _rivals in posto if row["name"] in ("Rabiot", "LoftusCheek"))
    assert starter == "Rabiot", "una partenza nell'ultima batte due nelle due precedenti"

    # ...E UN FOGLIO SENZA LA DISTANZA DEGRADA AL CONTEGGIO DI PRIMA, non a un ordine inventato: sotto
    # la revisione 65 la colonna ha tre campi, ogni partita pesa 1 e il posto torna al 2-1. E' anche il
    # modo in cui questo test rimette il difetto: con la stringa vecchia l'asserzione qui sopra cade.
    vecchio_foglio = [man("Rabiot", 0.30, "m3:4-3-3:5"),
                      man("LoftusCheek", 0.90, "m2:4-3-3:5;m1:4-3-3:5"),
                      *[man(f"Mezzala{slot}", 0.8, f"m3:4-3-3:{slot}") for slot in (4, 6)]]
    prima = _slot_view(vecchio_foglio)._from_slots(vecchio_foglio, [], "4-3-3", "short")
    chi = next(row["name"] for _lane, row, _rivals in prima
               if row["name"] in ("Rabiot", "LoftusCheek"))
    assert chi == "LoftusCheek", "tre campi = il conteggio di prima, non un ordine nuovo"


def test_la_staffetta_sceglie_chi_GIOCA_e_non_chi_e_un_RIVALE():
    """La regola dell'11/09 che questo secondo percorso non aveva ereditato (operatore, 13/09/2026).

    «Il vincolo riguarda chi e' in campo, mai chi gli sta dietro»: filtrare anche i ballottaggi fa
    diventare «non giocano insieme» un «non si contendono la maglia», che e' il contrario. Il veto
    toglieva il candidato da `men`, e da `men` uscivano tutt'e due i canali - il titolare E i rivali -
    quindi chi si alterna con un uomo gia' in campo spariva dal campetto invece di comparire in
    ballottaggio.
    """
    def man(name, claim, slots, relay=""):
        return {"name": name, "fc_id": name, "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": "titolare", "desc_real_roles": "MC", "desc_relay": relay}

    # Il modulo si riempie tutto: un posto scoperto pesca dal serbatoio e questo caso misurerebbe il
    # ripiego invece del veto. Lo slot 4 e' del Titolare; sul 5 si contendono Staffetta e Terzo, e
    # Staffetta si alterna con un uomo che a quel punto e' gia' in campo.
    rows = [man(f"Padrone{slot}", 0.8, f"m1:4-3-3:{slot}:0;m2:4-3-3:{slot}:1")
            for slot in (0, 1, 2, 3, 6, 7, 8, 9, 10)]
    titolare = man("Titolare", 0.9, "m1:4-3-3:4:0;m2:4-3-3:4:1")
    staffetta = man("Staffetta", 0.9, "m3:4-3-3:5:2", relay="Titolare:0.90")
    terzo = man("Terzo", 0.5, "m1:4-3-3:5:0;m2:4-3-3:5:1")
    rows += [titolare, staffetta, terzo]
    view = _slot_view(rows)
    drawn = view._from_slots(rows, [], "4-3-3", "short")
    posto = {row["name"]: [rival["name"] for rival in rivals] for _lane, row, rivals in drawn}
    assert "Terzo" in posto, "il veto deve ancora DECIDERE chi gioca: la maglia non e' della staffetta"
    assert "Staffetta" in posto["Terzo"], "…ma chi perde per il veto resta un ballottaggio"


def test_dove_era_nelle_ultime_partite_e_un_fatto_e_ordina_i_rivali():
    """`recent_state`, e «vuoto = ignoto» applicato a una finestra che non abbiamo guardato.

    Le tre parole non sono una scala inventata: sui 4.324 ex titolari fermi da due giornate (due
    stagioni, cinque campionati) chi subentra ricomincia a partire il 39,3% delle volte, chi e' in
    distinta e non gioca il 16,5%, chi non e' nemmeno disponibile il 12,7%. `bench` e' una PROVA e non
    un vuoto - era li' e non e' stato scelto - ed e' per questo che vale il doppio di `away`.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    def stato(looked, available, played, starts):
        return view.recent_state({"desc_recent_looked": looked, "desc_recent_available": available,
                                  "desc_recent_played": played, "desc_recent_starts": starts})
    assert stato(3, 3, 3, 1) == "started"
    assert stato(3, 3, 3, 0) == "sub"
    assert stato(3, 3, 0, 0) == "bench"
    assert stato(3, 0, 0, 0) == "away"
    # una pre-stagione non ha finestra: «non abbiamo guardato» non e' «non c'era»
    assert stato(0, 0, 0, 0) is None
    assert view.recent_state({}) is None

    # ...e a PARITA' DI GRADINO l'ordine dei rivali lo legge. Il gradino resta il primo criterio, che e'
    # il metro dell'operatore per «importante»: quella misura e' presa sugli ex titolari e non su tutta
    # la panchina, quindi non passa davanti alla parola.
    def man(name, slots, rung, looked=3, available=3, played=0, starts=0, claim=0.5):
        return {"name": name, "fc_id": name, "claim": claim, "desc_recent_slots": slots,
                "desc_titolarita": rung, "desc_real_roles": "MC", "desc_recent_looked": looked,
                "desc_recent_available": available, "desc_recent_played": played,
                "desc_recent_starts": starts}

    # …e di nuovo il modulo pieno: un posto scoperto si prende un uomo del serbatoio, e i tre che
    # questo caso vuole vedere in ballottaggio finirebbero disegnati invece che elencati.
    rows = [man(f"Padrone{slot}", f"m1:4-3-3:{slot}:0;m2:4-3-3:{slot}:1", "titolare",
                played=2, starts=2)
            for slot in range(11)]
    # Il claim dell'assente e' piu' ALTO, e non e' un dettaglio: e' l'ultima chiave dell'ordine,
    # quindi senza lo stato osservato questo caso si rovescia. Con due claim uguali l'ordinamento
    # stabile teneva l'ordine della lista e il test passava anche col difetto rimesso - che e'
    # un'asserzione che non puo' fallire.
    entra = man("Entra", "", "panchina", played=3, claim=0.4)      # subentra ogni domenica
    assente = man("Assente", "", "panchina", available=0, claim=0.6)   # non era in distinta
    sopra = man("Sopra", "", "titolare", available=0)              # gradino piu' alto, non c'era
    rows += [entra, assente, sopra]
    drawn = _slot_view(rows)._from_slots(rows, [], "4-3-3", "short")
    rivals = [rival["name"] for _lane, row, rivals in drawn if row["name"] == "Padrone4"
              for rival in rivals]
    assert rivals[0] == "Sopra", "il gradino viene prima: e' il metro dichiarato"
    assert rivals.index("Entra") < rivals.index("Assente"),         "…e dentro il gradino, chi la finestra ha visto in campo"


def test_il_posto_confermato_dalla_finestra_e_una_riga_e_un_fianco():
    """La regola dell'operatore del 15/09/2026, nelle sue due meta'.

    «Il ruolo di Celik e' terzino destro ma adesso sta giocando a sinistra ... 3 partite intere o quasi
    giocate in una nuova posizione sono una conferma che l'allenatore voglia utilizzarlo anche li' e
    quindi dobbiamo prenderne atto e rivalutare la formazione stagionale con questa nuova chiave di
    lettura.»

    Il posto si legge dal numero della distinta DENTRO il modulo di quella partita, quindi la riga e il
    fianco escono senza dedurli. La finestra e' `presence.recent_window` e non una costante nuova.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    # Celik: slot 4 di un 4-2-3-1 e di un 4-4-2 = l'ULTIMO difensore, cioe' il terzino sinistro. I suoi
    # codici lo dicono tutto a destra, ed e' il caso da cui la regola nasce.
    celik = {"desc_real_roles": "MR;DR;DC",
             "desc_recent_slots": "1:4-2-3-1:4:0;2:4-4-2:4:1;3:4-2-3-1:4:2"}
    assert View.held_lane(celik) == "D", "tre partite in difesa sono la sua riga"
    assert View.held_side(celik) == -1.0, "e le ha giocate a sinistra"
    assert View.sides_of(celik) == {"C", "R", "L"}, "il fianco confermato si AGGIUNGE ai suoi"

    # ...e una MAGGIORANZA basta, che e' la forma adottata: Baturina gioca due volte a sinistra e una
    # al centro, ed e' l'altro caso che l'operatore ha portato.
    baturina = {"desc_real_roles": "AM",
                "desc_recent_slots": "1:4-2-3-1:9:0;2:4-2-3-1:9:1;3:4-2-3-1:8:2"}
    assert View.held_side(baturina) == -1.0
    assert View.held_lane(baturina) == "T"

    # SOTTO LA FINESTRA NON C'E' CONFERMA: una partita sola non dice dove l'allenatore lo sta usando.
    assert View.held_side({"desc_real_roles": "LW", "desc_recent_slots": "1:4-2-3-1:9:2"}) is None
    assert View.held_lane({"desc_real_roles": "LW", "desc_recent_slots": "1:4-2-3-1:9:2"}) is None
    # ...e nemmeno un pareggio, ne' una maggioranza CENTRALE: il centro non e' un fianco da confermare.
    assert View.held_side({"desc_recent_slots": "1:4-3-3:9:0;2:4-3-3:10:1;3:4-3-3:8:2"}) is None
    # ...e senza colonna (un foglio sotto la revisione 64) si legge IGNOTO e non «al centro».
    assert View.held_side({"desc_real_roles": "DR"}) is None
    assert View.held_lane({}) is None
    assert View.sides_of({"desc_real_roles": "DR"}) == {"R"}, "senza conferma decidono i codici"


def test_una_riga_che_copre_gia_le_sue_fasce_non_scambia_nessuno(monkeypatch):
    """`_flanked` ripara le fasce SCOPERTE, non massimizza il claim su ogni corsia.

    Il caso della Juventus (operatore, 15/09/2026): la trequarti aveva Yildiz (`LW;AM`) sulla sinistra e
    la funzione lo scambiava con Cambiaso - un TERZINO sinistro con mezzo punto di claim in piu' - per
    una fascia che era gia' coperta. Da li' l'assegnazione mandava Celik in trequarti per far posto a
    Cambiaso in difesa, e il terzino destro finiva davanti.
    """
    from euroleghe_ingest.gui import SnapshotView as View

    view = View.__new__(View)
    view._fit_horizon = "season"
    take = [{"name": "Conceicao", "desc_real_roles": "RW;AM", "share": 0.60},
            {"name": "Gonzalez", "desc_real_roles": "RW;LW", "share": 0.48},
            {"name": "Yildiz", "desc_real_roles": "LW;AM", "share": 0.47}]
    rival = {"name": "Cambiaso", "desc_real_roles": "DL;ML", "share": 0.53}
    # con `monkeypatch` e non a mano: `del View.claim` non ripristina il metodo, lo CANCELLA dalla
    # classe, e da li' in poi ogni altro test che disegna un undici cade - misurato, 32 di loro.
    monkeypatch.setattr(View, "claim", lambda _self, row, _h="season": row.get("share", 0.0))
    kept = view._flanked(list(take), "T", 3, "season", [rival])
    assert [row["name"] for row in kept] == [row["name"] for row in take], kept
    # ...e dove una fascia MANCA davvero la riparazione fa ancora il suo lavoro
    narrow = [{"name": "Uno", "desc_real_roles": "AM", "share": 0.60},
              {"name": "Due", "desc_real_roles": "AM", "share": 0.50},
              {"name": "Tre", "desc_real_roles": "AM", "share": 0.40}]
    repaired = view._flanked(list(narrow), "T", 3, "season", [rival])
    assert "Cambiaso" in [row["name"] for row in repaired], repaired
