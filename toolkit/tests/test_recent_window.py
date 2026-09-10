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


def test_le_tre_forme_della_prova_esistono_tutte_e_quella_adottata_e_i_minuti():
    """Due sono state misurate e RESPINTE, e restano raggiungibili perche' un rifiuto si ri-corre.

    `start` legge +9,7% di errore e `full` - la lettura letterale di «giocare 90' e' un segnale molto
    forte» - legge peggio della binaria. Cancellarle renderebbe il rifiuto non riproducibile, che e'
    come una misura diventa un'opinione.
    """
    assert presence.DEFAULTS.recent_evidence == "minutes"
    window = presence.RecentWindow(available=2, starts=2, appearances=2,
                                   minutes_capped=135, full_matches=1)   # 90' + 45'
    got = {shape: presence.recent_evidence(window, replace(presence.DEFAULTS,
                                                           recent_evidence=shape))
           for shape in ("minutes", "start", "full")}
    assert got["minutes"] == 0.75           # 135 / 180
    assert got["start"] == 1.0              # due partenze su due
    assert got["full"] == 0.75              # una finita, una partenza sostituita
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
    assert presence.recent_minutes(once, None, naked) == 90.0
    assert presence.recent_share(once, None, naked) == 90 / 270


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

def _appearance(date: str, minutes: int, started: int) -> snapshot.Appearance:
    return snapshot.Appearance("Genoa", "serie_a", date, minutes, started, None, 0, 0,
                               None, None, None, None, None, None, None)


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
