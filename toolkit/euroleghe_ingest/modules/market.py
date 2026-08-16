"""market - lo STORICO del valore di mercato, punto per punto, da Transfermarkt.

Che cosa aggiunge a quello che c'era. `market_values` tiene UN valore per stagione, ed è la fotografia
che la pagina della rosa mostra: buona per dire «quanto valeva quell'anno», muta su tutto il resto. Qui
arriva la CURVA - ogni variazione con la sua data, il club di allora e l'età di allora - e sono due cose
diverse: un valore per stagione non sa dire se un uomo stava salendo o scendendo quando lo hai comprato,
e non sa dire quanto valeva IL GIORNO DELL'ASTA, che è la domanda che il canale dell'investimento pone
(gate §7-quater: «sistemare l'input prima di toccare il peso»).

LA STRADA, misurata il 16/08/2026 e non indovinata. Le pagine HTML del rendimento e della nazionale
rispondono 200 e non portano la tabella: c'è un muro di consenso e i dati arrivano dopo. Il grafico del
valore invece ha un endpoint JSON suo - `ceapi/marketValueDevelopment/graph/{id}` - che risponde senza
muro, 6,5 KB, e porta la serie già pronta. Non si scrive un parser HTML per una cosa che il sito serve
in JSON.

IL CLIENT È QUELLO DEGLI INFORTUNI, e non per pigrizia: Transfermarkt guarda l'impronta TLS, e solo un
client che si finge un browser prende un 200 (`injuries._client`). Anche le identità sono quelle: i
`tm_id` stanno già in `player_xref` perché il modulo infortuni li paga da mesi, quindi qui non si
risolve un nome - si legge un id.

LA CACHE HA UNA SCADENZA IN MANO AL CHIAMANTE. La serie CRESCE - un valore nuovo esce ogni pochi mesi -
quindi un file già scaricato è vecchio per costruzione: `--refresh` lo rifà, e senza si tiene quello che
c'è. È la regola di casa su una cache sopra un fatto che cambia; la storia PASSATA invece non si riscrive
mai, quindi il file vecchio non è sbagliato, è solo corto.
"""

from __future__ import annotations

import json
import random
import re
import time

from euroleghe_ingest.context import Context
from euroleghe_ingest.modules.injuries import (
    BASE_URL,
    REQUEST_DELAY,
    REQUEST_JITTER,
    _client,
)

NAME = "market"
DESCRIPTION = "Transfermarkt -> market_value_history (la curva del valore, non un punto per stagione)"
DEPENDS_ON: list[str] = ["injuries"]      # i tm_id li risolve lui
RAW_INPUTS: list[str] = []
NETWORK = True

GRAPH_ENDPOINT = BASE_URL + "/ceapi/marketValueDevelopment/graph/{pid}"

_CACHE = re.compile(r"transfermarkt_mv_(\d+)\.json$")
_DATE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")


def _polite_sleep(cancel_event=None) -> None:
    delay = REQUEST_DELAY + random.random() * REQUEST_JITTER
    if cancel_event is not None:
        cancel_event.wait(delay)
    else:
        time.sleep(delay)


def _iso(datum: str | None) -> str | None:
    """«15/08/2011» -> «2011-08-15». Una data che non si legge non diventa oggi: diventa niente."""
    if not datum:
        return None
    found = _DATE.search(datum)
    if not found:
        return None
    day, month, year = found.groups()
    return f"{year}-{month}-{day}"


def parse_graph(payload: dict | list) -> list[dict]:
    """La serie del grafico ridotta a righe. Una riga senza data o senza valore si scarta.

    Il valore è `y`, in euro, ed è un numero: `mw` è la stessa cosa scritta per un umano («50 mila €»)
    e non si parsa, perché una stringa localizzata è un modo di sbagliare un numero che si ha già.
    """
    points = payload.get("list") if isinstance(payload, dict) else payload
    out: list[dict] = []
    for one in points or []:
        if not isinstance(one, dict):
            continue
        when = _iso(one.get("datum_mw"))
        value = one.get("y")
        if when is None or value is None:
            continue
        age = one.get("age")
        try:
            age = int(str(age).strip()) if age not in (None, "") else None
        except ValueError:
            age = None
        out.append({
            "observed_on": when,
            "value": float(value),
            "club": (one.get("verein") or None),
            "age": age,
        })
    return out


def _cache_path(ctx: Context, tm_id: str):
    return ctx.config.cache_dir / f"transfermarkt_mv_{tm_id}.json"


def ambiguous(conn) -> set[int]:
    """Chi ha PIÙ di un id Transfermarkt, e per questo non si scarica affatto.

    Misurato il 16/08/2026: **31 fc_id su 3.407 mappature** ne hanno due o più - Sergio Ramos ne ha
    quattro, che sono quattro omonimi finiti su una persona sola. La chiave di questa tabella è
    `(fc_id, observed_on)`, quindi due carriere sullo stesso fc_id non si affiancano: si SOVRASCRIVONO
    a vicenda sulle date in comune, e quello che resta è una curva che nessuno ha vissuto - vista alla
    prima corsa pilota, con il Real Madrid a 27 anni e il Lilla a 19 nella stessa serie.

    Si salta e si conta, perché «un'incrocio ambiguo è peggio di uno mancante» (CLAUDE.md): una curva
    assente è una cella vuota, una curva mescolata è una bugia che nessuno vede.
    """
    return {
        int(row[0]) for row in conn.execute(
            """SELECT fc_id FROM player_xref WHERE source = 'transfermarkt'
               GROUP BY fc_id HAVING COUNT(DISTINCT source_id) > 1"""
        )
    }


def _targets(conn, limit: int | None = None, all_seasons: bool = False) -> list[tuple[int, str]]:
    """(fc_id, tm_id) per chi è QUOTATO oggi, il più caro per primo - o per chi lo è MAI STATO.

    Il perimetro di default è il listone di oggi e non l'anagrafica intera: la curva di un uomo che
    nessuno può comprare non serve al pannello e costa una richiesta come le altre. `--limit` prende i
    primi N, che è quello che rende possibile una corsa di prova prima di lanciarne mille.

    QUEL PERIMETRO PERÒ È UN FILTRO DI SOPRAVVIVENZA, e per l'harness è il difetto (misurato il
    16/08/2026, prima di scrivere una riga). «Quotato oggi» vuol dire «ha ancora una carriera nel 2026»,
    quindi guardando indietro la curva c'è solo per chi ce l'ha fatta: dei quotati della stagione
    bersaglio ne copre il **59% su T2, il 48% su T1 e il 7% su Tm7** contro il 48-60% di `market_values`,
    e la mancanza NON è casuale - è correlata proprio con l'esito che il canale dell'investimento predice
    (quanto giocherà). Sul foglio di OGGI vale il contrario ed è il motivo per cui l'acquisizione è stata
    fatta: 96% su Serie A e 89% su euro contro il 76%/82% di `market_values`. Quindi l'input è riparato
    per il foglio e non per lo sweep, che giudica sulle finestre passate - e un canale giudicato su una
    copertura che seleziona i sopravvissuti sarebbe un canale che si dà ragione da solo.

    `all_seasons=True` è la cura: chiunque sia stato quotato in una qualsiasi stagione (2.267 curve in
    più al 16/08/2026). L'ordine è per stagione più recente in cui è stato quotato, discendente, e non
    per capriccio: una corsa interrotta a metà lascia le finestre recenti COMPLETE invece di lasciarle
    tutte bucate a metà, e un buco parziale è la cosa che rende una finestra non giudicabile.
    """
    skip = ambiguous(conn)
    rows = conn.execute(
        """
        SELECT DISTINCT x.fc_id, x.source_id
        FROM player_xref x
        JOIN rosters r ON r.fc_id = x.fc_id
        WHERE x.source = 'transfermarkt'
          AND r.season = (SELECT MAX(season) FROM rosters)
        ORDER BY COALESCE(r.fvm, r.price_initial, 0) DESC
        """
    ).fetchall()
    if all_seasons:
        # ...e dietro ai quotati di oggi, tutti gli altri, il più recentemente quotato per primo. Il
        # prezzo qui non ordina: un Qt.I del 2016 e uno del 2025 non sono la stessa moneta.
        rows += conn.execute(
            """
            SELECT x.fc_id, x.source_id
            FROM player_xref x
            JOIN listone_quotes q ON q.fc_id = x.fc_id
            WHERE x.source = 'transfermarkt' AND q.price_initial IS NOT NULL
            GROUP BY x.fc_id, x.source_id
            ORDER BY MAX(q.season) DESC
            """
        ).fetchall()
    wanted: list[tuple[int, str]] = []
    seen: set[int] = set()
    for fc_id, tm_id in rows:
        fc_id = int(fc_id)
        if fc_id in skip or fc_id in seen:
            continue
        seen.add(fc_id)
        wanted.append((fc_id, str(tm_id)))
    dropped = len({int(fc_id) for fc_id, _ in rows} & skip)
    if dropped:
        print(f"[market] saltati {dropped} quotati con più di un id Transfermarkt (omonimi da sciogliere)")
    return wanted[: limit or None]


def upsert(conn, fc_id: int, points: list[dict]) -> int:
    for one in points:
        conn.execute(
            """INSERT OR REPLACE INTO market_value_history(
                   fc_id, observed_on, source, value, club, age)
               VALUES (?, ?, 'transfermarkt', ?, ?, ?)""",
            (fc_id, one["observed_on"], one["value"], one["club"], one["age"]),
        )
    return len(points)


def run(ctx: Context, limit: int | None = None, refresh: bool = False,
        all_seasons: bool = False, **kwargs) -> dict[str, int]:
    conn = ctx.require_conn()
    targets = _targets(conn, limit, all_seasons)
    counts = {"players": 0, "points": 0, "requests": 0, "misses": 0}
    if not targets:
        print("[market] nessun tm_id in player_xref - lancia prima `injuries --layer ids`")
        return counts
    todo = len(targets) if refresh else sum(
        1 for _fc_id, tm_id in targets if not _cache_path(ctx, tm_id).exists())
    print(f"[market] curva del valore per {len(targets)} quotati"
          + (" di ogni stagione" if all_seasons else " di oggi")
          + (" (--refresh)" if refresh else f" - {todo} da scaricare")
          + f" (~{todo * (REQUEST_DELAY + REQUEST_JITTER / 2) / 60:.0f} min)")
    session = _client()
    try:
        for fc_id, tm_id in targets:
            if ctx.cancelled():
                raise KeyboardInterrupt
            cache = _cache_path(ctx, tm_id)
            if cache.exists() and not refresh:
                continue
            _polite_sleep(ctx.cancel_event)
            counts["requests"] += 1
            try:
                response = session.get(GRAPH_ENDPOINT.format(pid=tm_id), timeout=30)
                payload = response.json() if response.status_code == 200 else None
            except Exception:   # noqa: BLE001 - curl_cffi ha la sua gerarchia, e un id non deve
                payload = None  #                fermare gli altri mille
            if not payload:
                # Scritto lo stesso e vuoto: «questo id non ha una curva» è un FATTO, e senza il
                # marcatore ogni ri-lancio lo ripaga.
                counts["misses"] += 1
                cache.write_text(json.dumps({"list": []}), encoding="utf-8")
                continue
            cache.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            points = parse_graph(payload)
            counts["players"] += 1
            counts["points"] += upsert(conn, fc_id, points)
    except KeyboardInterrupt:
        print("[market] interrotto - quello che è in cache resta")
    finally:
        session.close()
    print(f"[market] {counts['players']} curve, {counts['points']} punti, "
          f"{counts['requests']} richieste, {counts['misses']} senza serie")
    return counts


def reingest_from_cache(ctx: Context) -> int:
    """Rilegge i file già scaricati, senza rete: è quello che rende `rebuild` ricostruibile da zero."""
    conn = ctx.require_conn()
    skip = ambiguous(conn)
    known = {str(tm): fc for fc, tm in conn.execute(
        "SELECT fc_id, source_id FROM player_xref WHERE source = 'transfermarkt'")
        if fc not in skip}
    points = 0
    seen = 0
    for path in sorted(ctx.config.cache_dir.glob("transfermarkt_mv_*.json")):
        found = _CACHE.search(path.name)
        if not found:
            continue
        fc_id = known.get(found.group(1))
        if fc_id is None:
            continue           # un id che oggi non è mappato: si salta, non si indovina
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:   # noqa: BLE001 - un file corrotto non deve fermare il rebuild,
            print(f"[market] {path.name} illeggibile: {exc}")   # ma nemmeno sparire in silenzio
            continue
        seen += 1
        points += upsert(conn, fc_id, parse_graph(payload))
    print(f"[market] rilette {seen} curve dalla cache, {points} punti")
    return points
