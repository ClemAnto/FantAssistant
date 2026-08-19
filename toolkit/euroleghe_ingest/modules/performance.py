"""performance - i MINUTI PARTITA PER PARTITA di Transfermarkt: coppe, europee e NAZIONALE.

COME E' STATA TROVATA LA ROTTA, perche' il modo conta piu' dell'endpoint. La pagina «Rendimento
dettagliato» risponde 200 e non porta la tabella: la si e' inseguita per settimane leggendo l'HTML, con
quattro forme tentate a mano e 4 404 su 6. Il 17/08/2026 si e' fatto quello che il todolist prescriveva -
guidare un browser headless (CDP) e REGISTRARE le chiamate che la pagina fa - e la risposta e' che i dati
non sono in quella pagina affatto: stanno su un HOST DIVERSO che nessuno aveva provato,
`tmapi.transfermarkt.technology`, che serve JSON pulito **senza muro di consenso**. Non c'era niente da
aggirare; c'era da guardare. Corollario che vale oltre questo modulo: indovinare endpoint non e' cercare.

CHE COSA PORTA, verificato su un quotato (`tm_id` 1004301: 238 partite su 5 stagioni): per ogni partita la
competizione con l'id della fonte, la giornata, la data, il club e l'avversario, i MINUTI GIOCATI, lo stato
di partecipazione (`played`, `injured`, ...), gol, assist, rigori, cartellini, duelli e passaggi - e il
flag `isNationalGame`, che su quel giocatore marca 44 partite delle 238. Quindi «minuti per competizione» e
«minuti in nazionale» arrivano dalla STESSA chiamata, ed erano due voci separate del todolist.

PERCHE' UNA TABELLA SUA E NON `external_match_stats`. Quella tabella e' il layer che il motore legge, con
le nostre chiavi di campionato e con `mv_synth` calibrato sopra; qui la competizione e' l'id della FONTE
(`IT1`, `CL`, `FS`) e non un nostro slug, non c'e' un rating sulla scala di Sofascore, e la semantica dello
stato e' un'altra. Scriverci dentro righe di un'altra fonte vorrebbe dire far girare trasformazioni fittate
su una popolazione che non e' la loro - il difetto che questo progetto ha gia' pagato con Serie B e Coppa
Italia (§7-nonies). La traduzione in chiavi nostre si fa quando qualcuno LEGGE, e allora si dichiara.

LA CACHE HA UNA SCADENZA IN MANO AL CHIAMANTE, come per la curva del valore: la serie CRESCE a ogni
giornata, quindi un file scaricato ieri e' corto per costruzione. `--refresh` lo rifa'; senza, si tiene.
"""

from __future__ import annotations

import json
import random
import time

from euroleghe_ingest.context import Context
from euroleghe_ingest.db import database
from euroleghe_ingest.modules.injuries import REQUEST_DELAY, REQUEST_JITTER, _client

NAME = "performance"
DESCRIPTION = "Transfermarkt -> tm_appearances (minuti per competizione e in nazionale, partita per partita)"
DEPENDS_ON: list[str] = ["injuries"]      # i `tm_id` li paga lui
RAW_INPUTS: list[str] = []
NETWORK = True

API = "https://tmapi.transfermarkt.technology"
GAMES_ENDPOINT = API + "/player/{tm_id}/performance-game"


def _polite_sleep(cancel_event=None) -> None:
    delay = REQUEST_DELAY + random.random() * REQUEST_JITTER
    if cancel_event is not None:
        cancel_event.wait(delay)
    else:
        time.sleep(delay)


def season_of(season_id) -> str | None:
    """`2025` -> `2025-26`. L'id di stagione della fonte e' l'anno d'inizio, e una stagione senza id e' ignota."""
    try:
        start = int(season_id)
    except (TypeError, ValueError):
        return None
    if start < 1900 or start > 2100:
        return None
    return f"{start}-{str(start + 1)[-2:]}"


def parse_games(payload: dict | None) -> list[dict]:
    """Il payload ridotto a righe. Una partita senza id o senza data si scarta: non si sa di che parla.

    I MINUTI SONO NULL E NON ZERO quando la fonte non li porta, ed e' la differenza che decide tutto: un
    convocato che non entra ha `playedMinutes` assente e uno stato che lo dice, mentre uno zero direbbe
    «e' sceso in campo per zero minuti». Chi legge distingue con lo STATO, che viaggia accanto.
    """
    data = (payload or {}).get("data") or {}
    out: list[dict] = []
    for game in data.get("performance") or []:
        info = game.get("gameInformation") or {}
        stats = game.get("statistics") or {}
        general = stats.get("generalStatistics") or {}
        goals = stats.get("goalStatistics") or {}
        cards = stats.get("cardStatistics") or {}
        timing = stats.get("playingTimeStatistics") or {}
        clubs = (game.get("clubsInformation") or {}).get("club") or {}
        game_id = info.get("gameId")
        when = ((info.get("date") or {}).get("dateTimeUTC") or "")[:10]
        if not game_id or not when:
            continue
        out.append({
            "tm_game_id": str(game_id),
            "played_on": when,
            "season": season_of(info.get("seasonId")),
            "competition": info.get("competitionId") or None,
            "is_national": 1 if info.get("isNationalGame") else 0,
            "club_id": str(clubs.get("clubId")) if clubs.get("clubId") else None,
            "minutes": timing.get("playedMinutes"),
            "state": general.get("participationState") or None,
            "goals": goals.get("goalsScoredTotal"),
            "assists": goals.get("assists"),
            "yellows": cards.get("yellowCards"),
            "reds": cards.get("redCards"),
        })
    return out


def download(session, tm_id: str) -> dict | None:
    response = session.get(GAMES_ENDPOINT.format(tm_id=tm_id), timeout=30)
    if response.status_code != 200:
        return None
    try:
        payload = response.json()
    except ValueError:
        return None
    return payload if payload.get("success") else None


def targets(conn, seasons: tuple[str, ...] | None, limit: int | None) -> list[tuple[int, str]]:
    """Chi ha un `tm_id`, fra i quotati delle stagioni chieste: (fc_id, tm_id), i piu' quotati per primi.

    L'ordine per prezzo non e' un vezzo: una corsa pilota deve toccare gli uomini che contano al tavolo,
    non i primi venti per id.
    """
    wanted = seasons or ("2026-27",)
    placeholders = ",".join("?" * len(wanted))
    rows = conn.execute(
        f"""SELECT x.fc_id, x.source_id, MAX(COALESCE(q.price_initial, r.price_initial, 0))
            FROM player_xref x
            JOIN rosters r ON r.fc_id = x.fc_id AND r.season IN ({placeholders})
            LEFT JOIN listone_quotes q ON q.fc_id = x.fc_id AND q.season = r.season
            WHERE x.source = 'transfermarkt' AND x.source_id IS NOT NULL
            GROUP BY x.fc_id, x.source_id
            ORDER BY 3 DESC""", wanted).fetchall()
    out = [(int(row[0]), str(row[1])) for row in rows]
    return out[:limit] if limit else out


def store(conn, fc_id: int, games: list[dict]) -> int:
    """Scrive le righe di un giocatore, ASPETTANDO se il DB e' occupato invece di morire.

    Misurato il 17/08/2026 e non previsto: questa corsa e quella delle coppe scrivono nello stesso SQLite,
    e la seconda chiude con un reparse che tiene il lock piu' dei 5 secondi di `busy_timeout`. Il risultato
    e' stato un'ora di download buttata su un `database is locked` alla prima scrittura. La cache per
    giocatore rende la ripresa gratis, ma una corsa lunga che muore per un lock e' una corsa che nessuno
    lancia due volte: quindi si riprova con attesa crescente, e se davvero non si puo' scrivere lo si dice.

    L'attesa NON e' piu' scritta qui (19/08/2026): stava in questo modulo e solo questo modulo la aveva,
    quindi `snapshot.derive_squads` e' morto per lo stesso lock due giorni dopo. Adesso e' una definizione
    sola in `db.database.retry_on_lock`, che e' dove un secondo chiamante puo' trovarla.
    """
    return database.retry_on_lock(lambda: _store_once(conn, fc_id, games),
                                  what=f"Transfermarkt appearances of {fc_id}")


def _store_once(conn, fc_id: int, games: list[dict]) -> int:
    conn.executemany(
        """INSERT OR REPLACE INTO tm_appearances(
               fc_id, tm_game_id, played_on, season, competition, is_national, club_id,
               minutes, state, goals, assists, yellows, reds)
           VALUES (:fc_id, :tm_game_id, :played_on, :season, :competition, :is_national, :club_id,
                   :minutes, :state, :goals, :assists, :yellows, :reds)""",
        [{**game, "fc_id": fc_id} for game in games])
    return len(games)


def run(ctx: Context, **kwargs) -> dict[str, int]:
    conn = ctx.require_conn()
    refresh = bool(kwargs.get("refresh"))
    limit = kwargs.get("limit")
    people = targets(conn, tuple(kwargs.get("seasons") or ()) or None, limit)
    counts = {"players": 0, "games": 0, "requests": 0, "failed": 0}
    if not people:
        print("[performance] nessun `tm_id`: lancia prima `injuries --layer ids`")
        return counts
    print(f"[performance] {len(people)} giocatori con id Transfermarkt"
          f"{' (pilota)' if limit else ''}")
    session = _client()
    try:
        for fc_id, tm_id in people:
            if ctx.cancelled():
                raise KeyboardInterrupt
            cache = ctx.config.cache_dir / f"transfermarkt_perf_{tm_id}.json"
            if cache.exists() and not refresh:
                payload = json.loads(cache.read_text(encoding="utf-8"))
            else:
                _polite_sleep(ctx.cancel_event)
                payload = download(session, tm_id)
                counts["requests"] += 1
                if payload is None:
                    counts["failed"] += 1
                    continue
                cache.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            games = parse_games(payload)
            if not games:
                continue
            counts["players"] += 1
            counts["games"] += store(conn, fc_id, games)
            conn.commit()
    except KeyboardInterrupt:
        print("[performance] interrotto - quello che e' in cache resta")
    finally:
        session.close()
    national = conn.execute("SELECT COUNT(*) FROM tm_appearances WHERE is_national = 1").fetchone()[0]
    print(f"[performance] {counts['players']} giocatori · {counts['games']} partite · "
          f"{counts['requests']} richieste · {counts['failed']} senza risposta · "
          f"{national} righe di nazionale in tabella")
    return counts
