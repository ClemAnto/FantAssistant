"""timepack - il MOTORE di una data passata, impacchettato perché l'app possa caricarlo.

A che serve. L'app sa già retrodatare tutto quello che nel bundle porta una data - lo strato per-partita,
gli infortuni, i ruoli - ma NON le colonne del motore: quelle le scrive `snapshot` per un giorno preciso,
e ricalcolarle nell'app vorrebbe dire rimettere il motore là dentro. Qui non si aggiunge nessun motore
nuovo: si CHIAMA quello che c'è, alla data richiesta, e si mette il risultato dove l'app lo trova. È lo
stesso giro che il gate fa da mesi per replicare le sue dieci finestre.

QUANTO COSTA, misurato prima di decidere il formato: di un bundle da 5,4 MB, quello che cambia con la data
sono solo i FOGLI (272 KB per tre leghe) e i CAMPETTI (1 MB). Tutto il resto - voti, strato per-partita,
listoni, infortuni - è identico a qualunque data e l'app lo ritaglia da sola. Quindi un pacchetto pesa
~1,3 MB, e quattro date stanno in cinque megabyte.

LE DATE SONO POCHE E SCELTE (decisione dell'operatore, 16/08/2026): le ultime due stagioni, e per ognuna i
due momenti in cui la rosa è quella vera - **appena chiuso il mercato estivo** e **appena chiuso quello
invernale**. In mezzo il mercato è aperto e una fotografia dice poco; quelli sono i due giorni in cui un
tavolo ha davanti la squadra che giocherà. Le date esatte NON sono scritte a mano: si leggono dai
trasferimenti (`window_close`), perché una finestra chiude in un giorno diverso ogni anno e ogni lega.

TRE COSE CHE UN PACCHETTO NON PUÒ RESTITUIRE, e stanno scritte nel suo manifest invece che scoperte:
  * le PROBABILI di quel giorno (il sito pubblica solo «adesso»: la storia comincia il giorno in cui
    qualcuno l'ha catturata);
  * la SCADENZA DI CONTRATTO, che è una colonna della pagina rosa di oggi;
  * il RUOLO GRANULARE, perché il provider accetta il `seasonId` e lo ignora - un foglio del 2025 porta i
    codici di oggi.
E una contaminazione A FAVORE del modello, già dichiarata dal gate: trasferimenti, arrivi e rose sono
derivati OGGI, quindi la board conosce un mercato che quel giorno non era chiuso. Si può stringere, non
azzerare.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from euroleghe_ingest.context import Context

NAME = "timepack"
DESCRIPTION = "il motore di una data passata, impacchettato per il viaggio nel tempo dell'app"
DEPENDS_ON: list[str] = ["snapshot"]
RAW_INPUTS: list[str] = []
NETWORK = False

#: Quante stagioni indietro si impacchettano. Due, per decisione dell'operatore: più indietro il listone
#: è un'altra cosa e lo strato per-partita del bundle si assottiglia (`export --history`).
SEASONS_BACK = 2

#: Quanti giorni dopo l'ultimo movimento della finestra si scatta la fotografia. Uno: il giorno dopo la
#: chiusura la rosa è quella, e aspettarne di più vorrebbe dire far entrare giornate giocate senza motivo.
AFTER_CLOSE_DAYS = 1

#: Dove cercare la chiusura di ogni finestra: (nome, primo giorno, ultimo giorno) dentro l'anno solare.
#: Larghe apposta - una finestra chiude il 30 agosto o il 2 settembre a seconda dell'anno e del paese.
WINDOWS: tuple[tuple[str, str, str], ...] = (
    ("estiva", "07-01", "09-15"),
    ("invernale", "01-02", "02-20"),
)

#: Sotto quanti movimenti in un giorno non si parla di «finestra»: è rumore (un prestito, uno svincolato).
BUSY_DAY = 3


def _iso_plus(date: str, days: int) -> str:
    import datetime as dt

    return (dt.date.fromisoformat(date) + dt.timedelta(days=days)).isoformat()


def window_close(conn, season: str, which: str) -> str | None:
    """L'ultimo giorno AFFOLLATO della finestra, letto dai trasferimenti e non da una lista di date.

    Una finestra di mercato chiude in un giorno diverso ogni anno, e le cinque leghe non chiudono insieme.
    Prendere l'ultimo giorno con almeno `BUSY_DAY` movimenti è la definizione operativa: il singolo
    trasferimento tardivo (uno svincolato, un prestito fra società dello stesso gruppo) non è la finestra.

    `season` è «2025-26»: la finestra estiva è nel primo anno, l'invernale nel secondo.
    """
    start = int(season.split("-")[0])
    for name, first, last in WINDOWS:
        if name != which:
            continue
        year = start if name == "estiva" else start + 1
        rows = conn.execute(
            """SELECT date, COUNT(*) FROM transfers_history
               WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date""",
            (f"{year}-{first}", f"{year}-{last}"),
        ).fetchall()
        busy = [date for date, count in rows if count >= BUSY_DAY]
        return busy[-1] if busy else None
    return None


def significant_dates(conn, seasons: list[str]) -> list[dict]:
    """Le date da impacchettare: per ogni stagione, il giorno dopo la chiusura di ognuna delle due finestre.

    Ritorna anche la finestra da cui viene e quanti movimenti l'hanno decisa, perché una data senza la sua
    provenienza è un numero scritto a mano - e fra un anno nessuno saprebbe più perché è quella.
    """
    out: list[dict] = []
    for season in seasons:
        for name, _first, _last in WINDOWS:
            close = window_close(conn, season, name)
            if not close:
                continue
            out.append({
                "date": _iso_plus(close, AFTER_CLOSE_DAYS),
                "season": season,
                "window": name,
                "closed_on": close,
            })
    return sorted(out, key=lambda one: one["date"])


def _pack_dir(ctx: Context, date: str) -> Path:
    return ctx.config.data_dir / "timepacks" / date


def build(ctx: Context, date: str, season: str, leagues: dict, *, refresh: bool = False) -> dict:
    """Costruisce il pacchetto di UNA data: un foglio per lega dichiarata, coi suoi campetti.

    Chiama `snapshot.run` con `--date`, che è la stessa strada del gate: niente qui sa come si prezza un
    giocatore. I fogli restano anche in `data/reports/`, dove `snapshot` li scrive; qui se ne copia quello
    che serve all'app, in modo che il pacchetto sia una cartella sola da spedire.
    """
    from euroleghe_ingest.modules import snapshot

    folder = _pack_dir(ctx, date)
    if folder.exists() and not refresh:
        print(f"[timepack] {date}: già costruito ({folder}) - `--refresh` per rifarlo")
        return json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "sheets").mkdir(exist_ok=True)
    (folder / "boards").mkdir(exist_ok=True)

    built: list[dict] = []
    for name, setup in leagues.items():
        print(f"[timepack] {date} · {name} ({setup['platform']}/{setup['game']})")
        manifest = snapshot.run(
            ctx, season=season, platform=setup["platform"], game=setup["game"],
            league=name, date=date, refresh=False,
        )
        source = Path(manifest["folder"]) if manifest.get("folder") else None
        if source is None or not source.exists():
            print(f"[timepack] WARNING: {name} non ha scritto una cartella leggibile - saltata")
            continue
        key = name.lower().replace(" ", "-")
        shutil.copyfile(source / "players.csv", folder / "sheets" / f"{key}.csv")
        boards = source / "boards.json"
        if boards.exists():
            shutil.copyfile(boards, folder / "boards" / f"{key}.json")
        built.append({
            "league": name,
            "platform": setup["platform"],
            "game": setup["game"],
            "sheet": f"sheets/{key}.csv",
            "boards": f"boards/{key}.json" if boards.exists() else None,
            "rows": manifest.get("players"),
            "matchdays_target": (manifest.get("matchdays") or {}).get("platform_target"),
        })

    payload = {
        "date": date,
        "target_season": season,
        "leagues": built,
        # Quello che nemmeno il toolkit può retrodatare, scritto nel pacchetto perché l'app lo mostri.
        "known_gaps": [
            "probabili formazioni: il sito pubblica solo «adesso», quindi per una data passata non ce ne "
            "sono - le colonne dei titolari e dei ballottaggi da probabili sono vuote.",
            "ruolo granulare: il provider ignora la stagione richiesta, quindi i codici sono quelli di "
            "OGGI anche su un foglio del passato.",
            "scadenza di contratto: esiste solo sulla pagina rosa di oggi.",
            "contaminazione a favore del modello: trasferimenti, arrivi e rose sono derivati oggi, quindi "
            "la board conosce un mercato che quel giorno non era chiuso.",
        ],
    }
    (folder / "manifest.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[timepack] {date}: {len(built)} fogli -> {folder}")
    return payload


def run(ctx: Context, date: str | None = None, plan: bool = False,
        build_all: bool = False, refresh: bool = False, **kwargs) -> dict:
    conn = ctx.require_conn()
    config = ctx.config
    leagues = config.my_leagues if hasattr(config, "my_leagues") else {}
    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM rosters ORDER BY season DESC LIMIT ?", (SEASONS_BACK + 1,))]
    # La stagione in corso non si impacchetta: il suo mercato non è chiuso, ed è quella che l'app mostra
    # già dal vivo. Le due precedenti sì.
    past = sorted(seasons)[:-1][-SEASONS_BACK:]
    wanted = significant_dates(conn, past)
    if plan or not (date or build_all):
        print(f"[timepack] stagioni: {', '.join(past)}")
        for one in wanted:
            built = "già costruito" if _pack_dir(ctx, one["date"]).exists() else "da costruire"
            print(f"  {one['date']}  {one['season']}  finestra {one['window']}"
                  f" (chiusa il {one['closed_on']}) - {built}")
        return {"dates": wanted}
    if build_all:
        done = [build(ctx, one["date"], one["season"], leagues, refresh=refresh) for one in wanted]
        return {"packs": done}
    chosen = next((one for one in wanted if one["date"] == date), None)
    if chosen is None:
        raise RuntimeError(f"{date} non è una delle date significative - `timepack --plan` le elenca")
    return build(ctx, date, chosen["season"], leagues, refresh=refresh)
