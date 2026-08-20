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
tavolo ha davanti la squadra che giocherà. Le due date sono una CONVENZIONE dichiarata e verificata sul
calendario - vedi `WINDOWS`, dove sta anche il tentativo sbagliato di leggerle dai trasferimenti.

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

#: I due giorni dell'anno in cui si scatta, e sono una CONVENZIONE DICHIARATA - non un fatto letto dai
#: dati, e il perché va scritto qui perché la prima versione ci ha provato e ha sbagliato.
#:
#: `transfers_history` NON può dire quando chiude una finestra: misurato, le sue 5.371 righe portano tutte
#: la data del **1º luglio** (1.692 nel 2024, 1.657 nel 2025, 789 nel 2026) - è un diff fra rose, non un
#: registro datato dei movimenti, e un'euristica «l'ultimo giorno affollato» ci legge il 1º luglio, cioè il
#: giorno in cui partono i contratti. Quindi la data la si DICHIARA, e si verifica sul calendario, che
#: invece è datato davvero.
#:
#: Il 5 settembre e il 5 febbraio: le cinque grandi leghe chiudono l'estiva il 1º-2 settembre e
#: l'invernale il 2-3 febbraio, e cinque giorni di margine servono a essere dopo la chiusura ovunque.
#: Verificato sul nostro calendario - al 2024-09-05 la Serie A aveva giocato 3 giornate (le altre quattro
#: fra 2 e 4), al 2025-02-05 ne aveva 23. Quante ne aveva giocate ogni campionato finisce nel manifest del
#: pacchetto, così il numero si legge invece di darlo per buono.
WINDOWS: tuple[tuple[str, str], ...] = (
    ("estiva", "09-05"),
    ("invernale", "02-05"),
)


def rounds_played(conn, season: str, date: str) -> dict[str, int]:
    """Quante giornate ogni campionato aveva giocato a quella data, dal calendario vero.

    È la VERIFICA della convenzione: la data è dichiarata, questo dice che cosa c'era davvero in campo
    quel giorno, e finisce nel manifest del pacchetto. Una fotografia «dopo il mercato» che risultasse
    scattata prima della prima giornata si vedrebbe subito da qui.
    """
    return {league: rounds for league, rounds in conn.execute(
        """SELECT competition, MAX(real_md) FROM external_match_stats
           WHERE season = ? AND source = 'sofascore' AND real_md IS NOT NULL AND match_date <= ?
           GROUP BY competition ORDER BY competition""", (season, date))}


def significant_dates(conn, seasons: list[str]) -> list[dict]:
    """Le date da impacchettare: per ogni stagione, il giorno dopo ognuna delle due finestre di mercato.

    Ognuna porta con sé quante giornate erano state giocate, perché una data senza il suo contesto è un
    numero scritto a mano - e fra un anno nessuno saprebbe più perché è quella.
    """
    out: list[dict] = []
    for season in seasons:
        start = int(season.split("-")[0])
        for name, day in WINDOWS:
            date = f"{start if name == 'estiva' else start + 1}-{day}"
            out.append({
                "date": date,
                "season": season,
                "window": name,
                "rounds_played": rounds_played(conn, season, date),
            })
    return sorted(out, key=lambda one: one["date"])


def pack_revision(payload: dict) -> int | None:
    """A che `SHEET_REVISION` stanno i fogli di questo pacchetto, o None se non lo dichiara.

    UNA definizione, letta da `build`, da `--plan` e da `export.write_timepacks`: due copie darebbero due
    risposte sullo stesso pacchetto, e la prima a sbagliare sarebbe quella che l'app mostra. Preferisce il
    campo del pacchetto e ricade sulla prima lega, perché i pacchetti scritti prima del campo (20/08/2026)
    la portano solo là dentro - e non dichiararla è diverso da essere aggiornati.
    """
    mine = payload.get("sheet_revision")
    if mine is not None:
        return mine
    return next(((one.get("manifest") or {}).get("sheet_revision")
                 for one in (payload.get("leagues") or []) if (one.get("manifest") or {})), None)


def _pack_dir(ctx: Context, date: str) -> Path:
    return ctx.config.data_dir / "timepacks" / date


def build(ctx: Context, entry: dict, leagues: dict, *, refresh: bool = False) -> dict:
    """Costruisce il pacchetto di UNA data: un foglio per lega dichiarata, coi suoi campetti.

    Chiama `snapshot.run` con `--date`, che è la stessa strada del gate: niente qui sa come si prezza un
    giocatore. I fogli restano anche in `data/reports/`, dove `snapshot` li scrive; qui se ne copia quello
    che serve all'app, in modo che il pacchetto sia una cartella sola da spedire.
    """
    from euroleghe_ingest.modules import snapshot

    date, season = entry["date"], entry["season"]
    folder = _pack_dir(ctx, date)
    if folder.exists() and not refresh:
        # I FOGLI non si rifanno (costano una corsa a lega), il CONTESTO della data sì: è una query, e
        # tenerlo vecchio vorrebbe dire che una riga del manifest descrive un'altra misura.
        payload = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        payload.update(window=entry.get("window"), rounds_played=entry.get("rounds_played"))
        # ...e la revisione si RECUPERA da quello che i fogli dichiarano, mai si riscrive con quella di
        # oggi: i fogli non sono stati rifatti, e scriverci la revisione corrente sarebbe la bugia esatta
        # che il campo esiste per impedire. Un pacchetto scritto prima del campo lo prende cosi'.
        payload["sheet_revision"] = pack_revision(payload)
        (folder / "manifest.json").write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"[timepack] {date}: già costruito ({folder}) - `--refresh` per rifare i fogli")
        return payload
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
            "teams": (manifest.get("league") or {}).get("teams"),
            "squad_slots": (manifest.get("league") or {}).get("squad_slots"),
            "matchdays_target": (manifest.get("matchdays") or {}).get("platform_target"),
            # Quello che serve a `export` per serializzare il foglio ESATTAMENTE come quello di oggi:
            # è il manifest dello snapshot ridotto ai suoi campi di intestazione. Copiato qui perché il
            # pacchetto resti leggibile da solo, senza dover ritrovare la cartella in `data/reports`.
            "manifest": {key: manifest.get(key) for key in
                         ("league", "platform", "game", "target_season", "input_season",
                          "auction_date", "sheet_revision", "generated_at", "matchdays", "folder")},
        })

    payload = {
        "date": date,
        "target_season": season,
        # LA REVISIONE DEI FOGLI, al livello del pacchetto e non dentro una lega. Sale qui per la stessa
        # ragione di `input_season` in `export.write_timepacks`: una corsa di `timepack` scrive le tre
        # leghe con la stessa `SHEET_REVISION`, quindi cercarla dentro una di esse farebbe credere al
        # lettore che potrebbero dichiararne tre diverse. Serve a UNA cosa e va detto: un pacchetto sotto
        # la revisione corrente porta il motore di allora, e senza questo campo l'unico modo di scoprirlo
        # era guardare la data del file - che e' la definizione del difetto per cui `SHEET_REVISION`
        # esiste («un foglio non puo' dire se e' scaduto, quindi glielo si fa dire»).
        "sheet_revision": next((one["manifest"].get("sheet_revision") for one in built
                                if one.get("manifest")), None),
        # Perché è QUESTA data, e che cosa c'era in campo quel giorno: senza, fra un anno il numero non
        # si spiega più da solo.
        "window": entry.get("window"),
        "rounds_played": entry.get("rounds_played"),
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
    # `my_leagues()` è un METODO e non una property: chiamarlo senza parentesi restituisce la funzione,
    # e l'errore arriva un secondo dopo su `.items()`. Costato una corsa di quattro pacchetti.
    leagues = config.my_leagues()
    seasons = [row[0] for row in conn.execute(
        "SELECT DISTINCT season FROM rosters ORDER BY season DESC LIMIT ?", (SEASONS_BACK + 1,))]
    # La stagione in corso non si impacchetta: il suo mercato non è chiuso, ed è quella che l'app mostra
    # già dal vivo. Le due precedenti sì.
    past = sorted(seasons)[:-1][-SEASONS_BACK:]
    wanted = significant_dates(conn, past)
    if plan or not (date or build_all):
        print(f"[timepack] stagioni: {', '.join(past)}")
        from euroleghe_ingest.modules import snapshot
        for one in wanted:
            folder = _pack_dir(ctx, one["date"])
            built = "già costruito" if folder.exists() else "da costruire"
            played = ", ".join(f"{league} {rounds}"
                               for league, rounds in sorted(one["rounds_played"].items()))
            # Un pacchetto INDIETRO di revisione porta il motore di allora: non è un errore, è un fatto
            # da vedere senza andare a leggere la data di un file. `--refresh` è quello che lo rifà.
            if folder.exists():
                mine = pack_revision(
                    json.loads((folder / "manifest.json").read_text(encoding="utf-8")))
                if mine is None:
                    built += ", revisione non dichiarata (pacchetto scritto prima del campo)"
                elif mine < snapshot.SHEET_REVISION:
                    built += (f", revisione {mine} contro {snapshot.SHEET_REVISION} di oggi - "
                              f"INDIETRO, `--refresh` per rifarlo")
                else:
                    built += f", revisione {mine}"
            print(f"  {one['date']}  {one['season']}  finestra {one['window']} - {built}")
            print(f"      giornate giocate: {played or 'nessuna'}")
        return {"dates": wanted}
    if build_all:
        done = [build(ctx, one, leagues, refresh=refresh) for one in wanted]
        return {"packs": done}
    chosen = next((one for one in wanted if one["date"] == date), None)
    if chosen is None:
        raise RuntimeError(f"{date} non è una delle date significative - `timepack --plan` le elenca")
    return build(ctx, chosen, leagues, refresh=refresh)
