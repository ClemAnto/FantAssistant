"""zeros - QUALE ZERO fa la lista d'asta migliore: il marginale di ROSA o il rimpiazzo che SCHIERI?

PERCHE' NON LO PUO' GIUDICARE IL GATE, ed e' la prima cosa da dire perche' la voce di todolist chiedeva
proprio quello («dieci finestre di gate, non una riga»). Il gate prepara le sue finestre SENZA lega
(`features.prepare(league=None)`), quindi `data.replacement` e' vuota e `auction_view` ordina per VALUE =
FM x Pv: la scelta dello zero non muove un decimale di nessun numero pubblicato, e `backtest --verify`
resterebbe 22/22 qualunque zero si adotti. Cambiare zero non cambia nemmeno l'ACCURATEZZA: le previsioni di
fm e pv sono le stesse, lo zero entra dopo. Quindi misurare qui l'errore sarebbe misurare zero per
costruzione - il difetto «verifica la FUNZIONE, non la colonna che le somiglia» applicato a un harness.

CHE COSA SI PUO' MISURARE, e questa e' la domanda vera: il DELIVERABLE. Le due liste - le prime dieci per
ruolo, ordinate per SURPLUS - si costruiscono due volte sullo stesso modello e sulle stesse previsioni,
cambiando solo lo zero, e si guarda quale delle due cattura piu' surplus VERO e piu' nomi giusti. Lo
stesso metro di `estimates` (§7-undecies) e le stesse due guardie del gate: la maggioranza delle finestre
non peggiora e nessuna perde piu' del 2%.

I DUE ZERI, e sono due domande e non due risposte alla stessa (`letture-app-v1.md` §4-bis):
  * ROSA: il rango `squadre x slot di rosa` - l'ottantesimo centrocampista di dieci squadre. E' quello che
    il foglio scrive oggi in `engine_replacement_fm` e la metrica con cui il pannello ordina l'asta.
  * SCHIERATO: il rango `squadre x posti che il regolamento SCHIERA` (`features.fielded_places`), cioe' il
    migliore dei tuoi che ha il voto quel giorno. Misurato mezzo punto di fantamedia piu' in alto per due
    strade indipendenti il 16/08/2026.

LA POPOLAZIONE DI SCORING VA CAMBIATA CON QUELLA DI PREVISIONE, o il confronto e' truccato: la lista
predetta usa lo zero delle stagioni di input, la lista REALE quello della stagione bersaglio
(`replacement_actual`), e chi sposta il primo senza spostare il secondo sta confrontando due metri.

READ-ONLY sul DB, scrive `data/reports/zeros_check.json`.
"""

from __future__ import annotations

import datetime as dt
import json
import statistics
from dataclasses import replace

from euroleghe_ingest.context import Context
from euroleghe_ingest.engine import evaluate, features

NAME = "zeros"
DESCRIPTION = "Which replacement level makes the auction list better: roster-marginal or fielded?"
DEPENDS_ON: list[str] = ["rosters", "stats", "ratings"]
RAW_INPUTS: list[str] = []
NETWORK = False

MAX_WINDOW_LOSS = 0.02          # la tolleranza del verdetto robusto, citata dal gate


def _totals(view: dict) -> dict:
    """Il deliverable, e la sola cifra confrontabile fra due zeri e' una QUOTA.

    IL SURPLUS CATTURATO NON SI CONFRONTA FRA ZERI DIVERSI, ed e' il primo difetto che questo harness ha
    prodotto: con uno zero piu' alto ogni surplus e' piu' piccolo per costruzione, quindi la prima corsa
    leggeva -66% su dieci finestre su dieci e non stava misurando la qualita' di nessuna lista - stava
    misurando che i due numeri sono in due unita' (la lezione «l'unita' di una sottrazione e' parte della
    sottrazione», applicata a noi stessi).

    Quello che si confronta e' l'EFFICIENZA: quanto della lista perfetta - quella scelta conoscendo l'esito,
    e scorata con LO STESSO zero - la lista predetta ha catturato. Una quota fra 0 e 1, senza unita'. E i
    NOMI, che di unita' non ne hanno mai avuta.
    """
    captured = sum(block["captured_value"] or 0.0 for block in view.values())
    perfect = sum(block["perfect_value"] or 0.0 for block in view.values())
    return {
        "captured": round(captured, 1),
        "perfect": round(perfect, 1),
        "efficiency": round(captured / perfect, 5) if perfect else 0.0,
        "hits": sum(block["hits"] for block in view.values()),
    }


def fielded_data(conn, data: features.WindowData, game: str, league, rulebook) -> features.WindowData | None:
    """Lo stesso window con i DUE livelli sostituiti da quelli sui posti schierati, o None se non si può.

    Non si ricalcola niente del modello: `dataclasses.replace` tiene osservazioni, previsioni e cache, e
    cambia soltanto le due mappe che `auction_view` legge. Cosi' il confronto muove UNA variabile.
    """
    # Senza regolamento non c'e' niente da contare, e senza lega non c'e' un rango: in tutt'e due i casi
    # l'unica risposta onesta e' «niente da confrontare», non una vista a meta'.
    teams = int(league["teams"]) if league and league.get("teams") else 0
    places = features.fielded_places(rulebook, game) if rulebook else {}
    if not places or not teams:
        return None
    seasons = tuple(season for (season,) in conn.execute(
        "SELECT DISTINCT season FROM season_stats ORDER BY season")
        if season <= data.window.input_season)
    on_input = features.replacement_levels(conn, data.platform, seasons, game, places, teams)
    on_target = features.replacement_levels(
        conn, data.platform, (data.window.target_season,), game, places, teams)
    if not on_input:
        return None
    # `cache` porta quantita' derivate dalla popolazione della finestra e nessuna dipende dallo zero:
    # si tiene, altrimenti la seconda vista pagherebbe una passata su 1500 osservazioni per niente.
    return replace(data, replacement=on_input, replacement_actual=on_target or on_input)


def check(ctx: Context, platform: str, game: str) -> dict:
    """Una piattaforma: ogni finestra utilizzabile, la lista due volte, un verdetto solo."""
    conn = ctx.require_conn()
    league = ctx.config.load_league(platform=platform, game=game)
    rulebook = ctx.config.load_modules(game)
    block: dict = {"platform": platform, "game": game, "metric": evaluate.SURPLUS,
                   "league": league.get("name"), "windows": {}}
    usable, fits = {}, {}
    for key, window in features.WINDOWS.items():
        data = features.prepare(conn, window, platform, game, league=league, rulebook=rulebook)
        if evaluate._window_is_usable(data, platform):
            usable[key] = data
            fits[key] = evaluate.fit_params(data, ("R0", *evaluate.CANDIDATES))
    for key, data in usable.items():
        # gli stessi parametri con cui il gate giudica questa finestra: mai i suoi
        source = features.cross_fit_source(key, tuple(usable))
        params = evaluate.pool_params(fits, key, fits[source])
        adopted = ("R0", *evaluate.ADOPTED.get(platform, ()))
        predictions = evaluate.predict_window(data, adopted, None, params)
        other = fielded_data(conn, data, game, league, rulebook)
        if other is None:
            print(f"[zeros] {platform}/{game} {data.window.label}: nessun regolamento o nessuna lega, "
                  "niente da confrontare")
            continue
        roster = evaluate.auction_view(data, predictions, metric=evaluate.SURPLUS)
        fielded = evaluate.auction_view(other, predictions, metric=evaluate.SURPLUS)
        before, after = _totals(roster), _totals(fielded)
        # La differenza fra due QUOTE, in punti percentuali di efficienza: ognuna e' misurata contro la
        # lista perfetta del SUO zero, quindi le due sono commensurabili e i surplus grezzi non lo sono.
        delta = after["efficiency"] - before["efficiency"]
        # I NOMI: quanti dei predetti restano gli stessi fra i due zeri, e quanti ne azzecca ognuno. Il
        # secondo e' la guardia che decide quando le due si dividono (la regola di R19 e R20).
        names_roster = {(role, row["name"]) for role, one in roster.items() for row in one["predicted"]}
        names_fielded = {(role, row["name"]) for role, one in fielded.items() for row in one["predicted"]}
        block["windows"][key] = {
            "label": data.window.label,
            "levels": {"roster": {role: round(value, 2) for role, value in sorted(data.replacement.items())},
                       "fielded": {role: round(value, 2)
                                   for role, value in sorted(other.replacement.items())}},
            "roster": before, "fielded": after,
            "efficiency_delta": round(delta, 5),
            "names_in_common": len(names_roster & names_fielded),
            "names_total": len(names_roster),
        }
        print(f"[zeros] {platform}/{game} {data.window.label}: efficienza "
              f"{before['efficiency']:.1%} -> {after['efficiency']:.1%} ({delta:+.1%} punti) · nomi giusti "
              f"{before['hits']} -> {after['hits']} · in comune {len(names_roster & names_fielded)}"
              f"/{len(names_roster)}")
    deltas = [one["efficiency_delta"] for one in block["windows"].values()]
    hits_delta = [one["fielded"]["hits"] - one["roster"]["hits"] for one in block["windows"].values()]
    block["verdict"] = {
        "windows": len(deltas),
        "not_worse": sum(1 for one in deltas if one >= 0),
        "worst": round(min(deltas), 5) if deltas else 0.0,
        "mean": round(statistics.mean(deltas), 5) if deltas else 0.0,
        "hits_gained": sum(hits_delta),
        # La condizione pre-registrata, la stessa di `estimates`: maggioranza non peggiore E nessuna
        # finestra che perde piu' di due punti di efficienza. Piu' la guardia sui NOMI, che e' quella che
        # decide quando le due si dividono (la regola di R19 e di R20).
        "adopt_the_fielded_zero": bool(deltas) and sum(1 for one in deltas if one >= 0) * 2 >= len(deltas)
                                  and min(deltas) > -MAX_WINDOW_LOSS and sum(hits_delta) >= 0,
    }
    return block


def run(ctx: Context, **kwargs) -> None:
    platforms = tuple(kwargs.get("platforms") or ("default", "euro"))
    game = kwargs.get("game") or "classic"
    report = {"generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
              "question": "roster-marginal vs fielded replacement, ranked by surplus",
              "blocks": []}
    for platform in platforms:
        report["blocks"].append(check(ctx, platform, game))
    for one in report["blocks"]:
        verdict = one["verdict"]
        print(f"[zeros] {one['platform']}/{one['game']}: {verdict['not_worse']}/{verdict['windows']} "
              f"non peggiori · media {verdict['mean']:+.2%} · peggiore {verdict['worst']:+.2%} · "
              f"nomi {verdict['hits_gained']:+d} → "
              f"{'ADOTTA lo zero schierato' if verdict['adopt_the_fielded_zero'] else 'RESTA il marginale di rosa'}")
    if kwargs.get("no_report"):
        return
    out = ctx.config.data_dir / "reports" / "zeros_check.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"[zeros] report -> {out}")
