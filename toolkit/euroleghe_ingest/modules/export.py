"""export - the app's data bundle: everything the shippable engine needs, and nothing else.

Why this module exists. The toolkit's DB is 284 MB, most of it raw bonus rows nothing reads, and it
lives on one machine. The Electron app ships a PORT of `engine/` (see `engine/__init__`), so it needs
exactly the inputs `engine/features.py` reads - no more, or the bundle is unshippable; no less, or the
app silently predicts on missing data, which is the worse failure because it still produces a number.

So the contract below is DERIVED from what `features.load` actually queries, table by table, and each
entry says which engine step consumes it. If a future rule reads a new table, it has to be added here
too - and `--verify` is what makes that omission loud instead of silent: it re-opens the written
bundle, checks referential integrity and the presence of the seasons the engine will ask for, and
refuses the export otherwise.

Three things the manifest carries because a bundle without them invites a wrong reading:
  * PRICE DISCIPLINE. `price_initial` (Qt.I) is the pre-auction quotation and the only price a rule
    may read. `price` (Qt.A) is revised all season and, for a past season, embeds the outcome; `fvm`
    is end-of-season by the same argument. They are exported (the UI legitimately shows them) and
    listed as reporting-only, so the app cannot claim it did not know.
  * PROVISIONAL PARAMETERS. Constants that exist because a module needed a number, with their values,
    so nothing downstream quotes them as established.
  * KNOWN GAPS. What is missing and cannot be reconstructed (the starter-probability history, the
    contract expiry on past seasons, euro 2021-22 empty at the source).

Read-only on the DB, like `backtest`: it writes a folder under data/export/ and touches nothing else.
"""

from __future__ import annotations

import datetime as dt
import csv
import gzip
import json
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from euroleghe_ingest import __version__
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import apply_schema, connect

NAME = "export"
DESCRIPTION = "Write the app's data bundle (SQLite + JSON) from the engine's input contract"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
NETWORK = False

# Bump when the SHAPE of the bundle changes (a table added, a column removed): the app refuses a
# bundle whose schema_version it does not know, which is cheaper than debugging a silent mismatch.
SCHEMA_VERSION = 1

# How many seasons of the heavy per-match tables travel with the bundle. THREE, and the number was
# measured, not chosen: the engine reads them for the input season, but its COEFFICIENTS are fitted on
# the chronologically ADJACENT window (`features.cross_fit_source`), whose own input season is one
# further back. With two seasons the observations came out identical and the gate metrics matched
# exactly - and the auction list still differed, because the parameters had been fitted on a window
# whose per-match layer was missing. Caught by running the harness against the bundle instead of
# trusting the contract: three seasons make the two bit-identical.
DEFAULT_HISTORY = 3


@dataclass(frozen=True)
class TableSpec:
    """One table of the bundle: what it is for, and which rows travel.

    `scope` decides the row filter, and it is the whole cost model of the bundle:
      'full'    the table travels whole (small, and used across seasons)
      'season'  rows of every season up to and including the target
      'heavy'   rows of the last `history` seasons only - the per-match tables

    Whatever `scope` says, `also` rows always travel: see `_where`.
    """

    name: str
    scope: str
    why: str
    season_column: str = "season"
    extra: str = ""            # additional SQL predicate, ANDed
    also: str = ""             # rows to keep REGARDLESS of the season filter, ORed


# Ordered parents-first: the bundle's own foreign keys have to resolve as it is written.
CONTRACT: tuple[TableSpec, ...] = (
    TableSpec("players", "full",
              "identity + birth_year (the U22 trigger and, later, the age curves) + nationality and "
              "capped_on, which is what a mid-season continental cup is read off"),
    TableSpec("clubs", "full",
              "club identity and league; the engine keys strength and lineups by canonical name"),
    TableSpec("rosters", "season",
              "the listone: roles (Classic + Mantra) and the pre-auction price. features.load"),
    TableSpec("season_stats", "season",
              "pv/mv/fm per platform - the anchors recompute over every season <= input, so the "
              "whole history travels (it is small)"),
    TableSpec("external_stats", "season",
              "full-real-season facts for the 4 foreign leagues: the propensity per 90"),
    TableSpec("external_match_stats", "heavy",
              "the per-match layer: propensity, the inactivity proxy, mv_synth, and the "
              "`sofascore_recent` rows the no-history pricing reads before the auction",
              also="source = 'sofascore_recent'"),
    TableSpec("club_match_lineups", "full",
              "how many players of each line a club actually FIELDS: the Mantra slot caps and the "
              "attack-capacity denominator (22k rows in total, so it travels whole)"),
    TableSpec("match_ratings", "heavy",
              "the platform's own calendar: matchday counts, euro minute shares, the "
              "availability-persistence regressor"),
    TableSpec("matchday_map", "full", "euro <-> real matchday alignment, per league"),
    TableSpec("arrivals", "full",
              "who is new, from where, at which tier PER PLATFORM (a tier is a percentile inside a "
              "listone), with the FM-equivalent"),
    TableSpec("listone_quotes", "full",
              "THE QUOTATION PER PLATFORM: Qt.I/Qt.A/FVM as each listone states them. `rosters` keeps "
              "only the last download, and the two lists disagree on 202 Qt.I and 226 FVM for the "
              "players quoted in both - this is the table anything platform-specific must read"),
    TableSpec("club_elo", "full",
              "club strength at the auction dates - R19's level channel (the ORIGIN club's Elo) and "
              "the club card. NOT the goalkeeper module, which reads measured goals conceded"),
    TableSpec("flags", "full",
              "off_role_usage, new_coach, u22_trigger, post_torneo, booking_risk, contract_until, "
              "exit_risk - every derived boolean the engine or the UI reads"),
    TableSpec("positions", "full", "real role from the provider slot + avg_x/avg_y (Mantra detail)"),
    TableSpec("player_roles", "full",
              "the granular real role: GK | DL DC DR | DM | ML MC MR | AM | LW RW | ST, dated. The "
              "only thing that separates a left back from a centre back - the app draws the pitch "
              "from it. THE HISTORY IS THIN BY CONSTRUCTION - see known_gaps"),
    TableSpec("probable_starter", "full",
              "dated starting probabilities. THE HISTORY IS THIN BY CONSTRUCTION - see known_gaps"),
    TableSpec("availability", "full", "dated injured/suspended states, for the live auction view"),
    TableSpec("injuries", "full",
              "dated absences with the matches actually missed: the presences module's missing half, "
              "and the long-term-absent team-mate refinement of the forward pairs"),
    TableSpec("penalty_hierarchy", "full", "who takes the penalties, dated, revealed from our votes"),
    TableSpec("coaches", "full", "who is in charge and since when (the new_coach flag's provenance)"),
    TableSpec("transfers_history", "full", "where an arrival came from and for how much"),
    TableSpec("market_values", "season",
              "the market value per SEASON, from the source's own squad page of that season: the third "
              "channel of the investment hypothesis, and the only one that exists for a man who arrived "
              "free (a fee is NULL for a free transfer). Dated, so a window reads the input season"),
    TableSpec("tournaments_squads", "full", "who actually played at a tournament, minutes included"),
    TableSpec("manual_overrides", "full", "the highest-precedence layer; empty is the normal state"),
)

# Deliberately NOT exported, so the omission is a decision on the record and not an oversight:
EXCLUDED: dict[str, str] = {
    "match_rating_bonuses": "2.8M raw bonus rows; the canonical columns in match_ratings carry "
                            "everything the engine reads, and the raw layer exists only so a "
                            "season-specific bonus is never lost upstream",
    "player_xref": "provider ids: the app never re-resolves identity, it consumes fc_id",
    "club_xref": "same",
    "ingest_runs": "the toolkit's own audit trail, not data about football",
}

# Prices: which ones a rule may read, and which are reporting-only. This is not advice, it is the
# reason three of the columns exist at all (spec v9: everything but Qt.I embeds the outcome).
PRICE_DISCIPLINE: dict[str, list[str]] = {
    "auction_safe": ["listone_quotes.price_initial", "listone_quotes.price_initial_mantra"],
    "reporting_only": ["listone_quotes.price", "listone_quotes.price_mantra",
                       "listone_quotes.fvm", "listone_quotes.fvm_mantra"],
    # ...and WHERE TO READ THEM. `rosters` carries the same six columns and cannot say which listone
    # wrote them: for a player quoted in both, the last download wins. A price is a fact about a
    # platform, so the app reads `listone_quotes` and filters on the platform it is playing.
    "platform_note": ["rosters.* quotations are the last read, unattributed - do not decide on them"],
}


# The engine's own numbers, per player, taken from the sheet `snapshot` already writes. Only these
# columns travel: they are the INGREDIENTS the app needs to compute a surplus against the pool that is
# actually on the table, and nothing else on the sheet is an ingredient.
#
# Why the ingredients and not `engine_surplus` itself, which is right there. A surplus is measured
# against a REPLACEMENT LEVEL, and at a live auction that zero is the marginal man among the players
# still FREE - which moves at every pick, and moves again if the host uploads his own list instead of
# the listone (`playerListType: custom`, observed 09/08/2026). A frozen surplus answers the question
# the sheet was built for, not the one the table asks. `engine_surplus` travels anyway as the
# league-level reference the sheet stands behind, clearly named as such.
SHEET_COLUMNS: tuple[str, ...] = (
    "fc_id",
    "engine_fm_pred",        # the predicted fantamedia: the only quality term
    "engine_pv_pred",        # expected appearances ON THE PLATFORM CALENDAR (see `matchdays` below)
    "engine_role_slot",      # the role the two columns above are measured in - the game's own
    "engine_replacement_fm", # the sheet's own league zero, so the app can show what it recomputed against
    "engine_surplus",        # league-level reference, NOT the number a live panel should rank by
    "engine_anchor",
    "engine_unpriced_reason",
    "est_fm",                # the fallback for a man the core refuses to price, with its penalty
    "est_mv",                # ...and the base vote behind it: FM minus the bonus per appearance
    "est_pv",
    "est_surplus",
    "est_confidence",
    "est_basis",
    "est_note",
    # IL SURPLUS IN CREDITI e la sua distanza dal prezzo del listone, per la sola cosa che l'app non
    # poteva fare senza: confrontare l'FVM con qualcosa. È il confronto giusto - quello che un credito
    # compra è il margine sopra chi giocherebbe al posto suo, non i fantapunti, che contano da zero -
    # ed è tarato come un problema di budget («metrica-asta-surplus-v1.md» §14). Come `engine_surplus`
    # è un riferimento di LEGA e non il numero con cui un pannello vivo ordina.
    "desc_spm",
    "desc_dvm",
    # L'ALTRO ZERO, e l'app le mostra AFFIANCATE invece di sceglierne una: `engine_surplus` conta dal
    # marginale di ROSA («chi conviene comprare»), queste dal rimpiazzo che ENTRA («quanto costa una
    # giornata saltata»). Due domande, non due risposte alla stessa - quindi due colonne, e si sceglie
    # soltanto per quale delle due si ORDINA (metrica-asta-surplus-v1.md §21.1). Reporting: nessun
    # numero gated cambia perché queste esistono.
    "desc_replacement_fielded",
    "desc_surplus_fielded",
    # LA COPPA CONTINENTALE in mezzo al campionato: il torneo, il paese, se è già nazionale, le giornate
    # di QUESTO calendario dentro la finestra, e le presenze e i fantapunti al netto. Viaggiano perché
    # l'app disegna l'icona e scrive la penalità nel tooltip delle presenze attese, e nessuna delle due
    # cose può essere ricalcolata lì: chi va a un torneo è una previsione su una persona. Il file
    # dichiarato (`config/international_cups.json`) NON viaggia, di proposito - sarebbe una seconda fonte
    # per lo stesso fatto. Reporting: `engine_pv_pred` qui sopra non si muove di un decimale.
    "desc_cup",
    "desc_cup_country",
    "desc_cup_capped",
    "desc_cup_rounds",
    "desc_cup_share",
    "desc_cup_band",
    "desc_cup_confirmed",
    "desc_pv_cup",
    "desc_value_cup",
    "desc_surplus_cup",
    "desc_surplus_fielded_cup",
    "desc_cup_note",
    # MEASURED football, for the row to be judged and not only ranked: how much he actually played
    # last season, and over how many matches - the two together are minutes per match, and one
    # without the other is not a rate. Both counted on his own championship, never on our calendar.
    "desc_minutes_full_season",
    "desc_season_matches",
    # The calendar still to be played, as the sheet computed it: «k/n (p%)» and the mean Elo advantage.
    # DISPLAY-ONLY on the row too - the app shows them and no valuation reads them.
    "desc_easy_matches",
    "desc_calendar_margin",
    # THE TREND: the club's last ten CHAMPIONSHIP matches. The detail string is what the histogram is
    # drawn from - one record per match, with the vote, its source, the fantapunti, the bonuses, the
    # cards, xG+xA and whether the euro calendar counted that round - and the aggregate is the number
    # the panel can ORDER by. It travels whole rather than pre-rendered because the app draws it and
    # the toolkit's own panel draws it, and two pictures built from two summaries would drift.
    "desc_trend_fp",
    "desc_trend_matches",
    "desc_trend_window",
    "desc_trend_played",
    "desc_trend_bench",
    "desc_trend_outside_euro",
    "desc_trend_detail",
    # WHO GAINED A PLACE and who lost one during the measured season, with the department control. The
    # CODES travel and the sentence does not: the panel writes it in English for the CSV, the app writes
    # it in Italian for the table, and both build it from the same three fields - one FACT, two wordings.
    "desc_place_change",
    "desc_place_on",
    "desc_place_md",
    "desc_place_minutes",
    "desc_place_cause",
    "desc_place_who",
    # ...and the in-season screen: sold as a starter, rotated in fact. Empty until five rounds have been
    # played, which is what it reads.
    "desc_rotation_watch",
    "desc_rotation_minutes",
    "desc_rotation_starts",
    "desc_rotation_from",
    "desc_rotation_to",
    "desc_rotation_window",
    "desc_riser_watch",
    "desc_riser_minutes",
    "desc_riser_starts",
    "desc_riser_window",
    "desc_riser_keeper",
)


def _sheet_folders(reports: Path, target: str) -> list[Path]:
    """Every sheet folder of the target season, newest stamp last."""
    return sorted(path for path in reports.glob(f"auction-snapshot-{target}-*")
                  if path.is_dir() and (path / "players.csv").exists())


def _sheet_bytes(sheet: list[dict], manifest: dict, compress: bool) -> bytes | None:
    """Un foglio serializzato come l'app lo legge. None se gli mancano colonne che il contratto promette.

    Estratta perché ha DUE chiamanti che devono produrre lo stesso identico formato: il foglio di oggi e
    quelli dei pacchetti del viaggio nel tempo. Due serializzatori sarebbero due formati sotto un nome
    solo, e il lettore dell'app è uno.
    """
    missing = [column for column in SHEET_COLUMNS if sheet and column not in sheet[0]]
    if missing:
        print(f"[export] WARNING: sheet {manifest.get('folder')} lacks {missing} - skipped")
        return None
    payload = json.dumps({
        "table": "engine_sheet",
        "league": manifest.get("league"),
        "platform": manifest.get("platform"),
        "game": manifest.get("game"),
        "target_season": manifest.get("target_season"),
        "auction_date": manifest.get("auction_date"),
        "sheet_revision": manifest.get("sheet_revision"),
        "generated_at": manifest.get("generated_at"),
        "matchdays": manifest.get("matchdays"),
        "columns": list(SHEET_COLUMNS),
        "rows": [[_sheet_value(row.get(column)) for column in SHEET_COLUMNS] for row in sheet],
    }, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return gzip.compress(payload, mtime=0) if compress else payload


def write_timepacks(ctx: Context, folder: Path, compress: bool = True) -> list[dict]:
    """I PACCHETTI del viaggio nel tempo: il motore a una data passata, uno per data significativa.

    Solo fogli e campetti, perché sono le sole cose che con la data cambiano: voti, strato per-partita,
    listoni e infortuni sono identici a qualunque data e l'app li ritaglia da sé. Misurato - un pacchetto
    pesa ~1,3 MB contro i 5,4 del bundle intero.

    Li costruisce `timepack` (che chiama `snapshot --date`, cioè il motore vero e non una sua imitazione);
    qui si serializzano nello STESSO formato del foglio di oggi, con la stessa funzione.
    """
    source = ctx.config.data_dir / "timepacks"
    written: list[dict] = []
    if not source.exists():
        return written
    for pack in sorted(path for path in source.iterdir() if (path / "manifest.json").exists()):
        info = json.loads((pack / "manifest.json").read_text(encoding="utf-8"))
        out = folder / "timepacks" / info["date"]
        leagues: list[dict] = []
        for one in info.get("leagues", []):
            csv_path = pack / one["sheet"]
            if not csv_path.exists():
                continue
            with csv_path.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            payload = _sheet_bytes(rows, one.get("manifest") or {}, compress)
            if payload is None:
                continue
            (out / "sheets").mkdir(parents=True, exist_ok=True)
            name = one["league"].lower().replace(" ", "-")
            suffix = ".json.gz" if compress else ".json"
            _atomic_write_bytes(out / "sheets" / f"{name}{suffix}", payload)
            entry = dict(one)
            entry["sheet"] = f"sheets/{name}{suffix}"
            entry.pop("manifest", None)
            if one.get("boards") and (pack / one["boards"]).exists():
                (out / "boards").mkdir(parents=True, exist_ok=True)
                _atomic_write_bytes(out / "boards" / f"{name}.json", (pack / one["boards"]).read_bytes())
                entry["boards"] = f"boards/{name}.json"
            else:
                entry["boards"] = None
            leagues.append(entry)
        if not leagues:
            print(f"[export] note: timepack {info['date']} has no readable sheet - skipped")
            continue
        # La stagione di INPUT sale al livello del pacchetto: è la stagione che le colonne misurate
        # dell'app leggono (MV e FM), e cercarla dentro il manifest di una lega vorrebbe dire che due
        # leghe potrebbero dichiararne due diverse - non possono, ma il lettore non lo saprebbe.
        first = next((one for one in (info.get("leagues") or []) if one.get("manifest")), None)
        info = {**info, "leagues": leagues,
                "input_season": ((first or {}).get("manifest") or {}).get("input_season")}
        out.mkdir(parents=True, exist_ok=True)
        _atomic_write_bytes(out / "manifest.json",
                            json.dumps(info, indent=2, ensure_ascii=False).encode("utf-8"))
        written.append({"date": info["date"], "target_season": info.get("target_season"),
                        "input_season": info.get("input_season"),
                        "window": info.get("window"), "leagues": len(leagues),
                        "path": f"timepacks/{info['date']}/manifest.json"})
        print(f"[export] timepacks/{info['date']}: {len(leagues)} fogli")
    return written


def write_engine_sheets(ctx: Context, folder: Path, target: str,
                        compress: bool = True) -> list[dict]:
    """Copy the engine's per-player numbers into the bundle, one file per LEAGUE.

    Per league because a surplus without its league is not comparable with another league's: the
    replacement level is fixed by `teams x squad_slots` (`assistente-asta-v1.md` §1), so two sheets of
    the same platform and game can hold different numbers. The league setup travels next to the rows
    for the same reason, and so does `matchdays.platform_target` - `engine_pv_pred` is expressed on that
    calendar, so an app pricing a competition of n rounds has to scale by n/N and cannot guess N.

    A folder that is not a whole sheet is skipped rather than half-read: `snapshot --clubs X` writes one
    club's rows, and a one-club population is not a population (its own manifest says so).
    """
    reports = ctx.config.data_dir / "reports"
    written: list[dict] = []
    if not reports.exists():
        return written

    newest: dict[str, tuple[str, Path, dict]] = {}
    for path in _sheet_folders(reports, target):
        try:
            manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            print(f"[export] WARNING: sheet {path.name} has no readable manifest ({exc})")
            continue
        league = (manifest.get("league") or {}).get("name")
        if not league or not (manifest.get("league") or {}).get("declared"):
            continue        # a sheet built without a declared league has no replacement level to quote
        # `snapshot --clubs X` writes one club's rows, and one squad is not a population: its own
        # replacement level would be meaningless. `clubs` is the sheet's own count, so the guard reads
        # the artefact instead of parsing the folder name.
        if (manifest.get("clubs") or 0) < 2:
            continue
        stamp = manifest.get("generated_at") or ""
        if league not in newest or stamp > newest[league][0]:
            newest[league] = (stamp, path, manifest)

    if not newest:
        print(f"[export] note: no declared-league sheet for {target} in data/reports "
              f"(run `snapshot --league NAME`), so the app has no engine numbers to rank by")
        return written

    out = folder / "sheets"
    out.mkdir(parents=True, exist_ok=True)
    for league, (_stamp, path, manifest) in sorted(newest.items()):
        with (path / "players.csv").open(encoding="utf-8-sig", newline="") as handle:
            sheet = list(csv.DictReader(handle))
        missing = [column for column in SHEET_COLUMNS if sheet and column not in sheet[0]]
        if missing:
            print(f"[export] WARNING: sheet {path.name} lacks {missing} - skipped")
            continue
        rows = [[_sheet_value(row.get(column)) for column in SHEET_COLUMNS] for row in sheet]
        payload = json.dumps({
            "table": "engine_sheet",
            "league": manifest.get("league"),
            "platform": manifest.get("platform"),
            "game": manifest.get("game"),
            "target_season": manifest.get("target_season"),
            "auction_date": manifest.get("auction_date"),
            "sheet_revision": manifest.get("sheet_revision"),
            "generated_at": manifest.get("generated_at"),
            "matchdays": manifest.get("matchdays"),
            "columns": list(SHEET_COLUMNS),
            "rows": rows,
        }, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        name = league.lower().replace(" ", "-")
        suffix = ".json.gz" if compress else ".json"
        if compress:
            payload = gzip.compress(payload, mtime=0)
        _atomic_write_bytes(out / f"{name}{suffix}", payload)

        # The DRAWN BOARDS of this sheet: per club the module, the eleven where the PANEL places it, and up
        # to two ballottaggi per man. COPIED from what `snapshot` wrote next to this very sheet, never
        # recomputed here - a second eleven would be a second answer, which is the defect this project keeps
        # paying for. It is copied inside this loop on purpose: here the sheet and its own folder are both in
        # scope, so the boards cannot come from a different sheet than the rows.
        boards = path / "boards.json"
        board_path = None
        if boards.exists():
            (folder / "boards").mkdir(parents=True, exist_ok=True)
            _atomic_write_bytes(folder / "boards" / f"{name}.json", boards.read_bytes())
            board_path = f"boards/{name}.json"
            print(f"[export] boards/{name}.json: {league}")
        else:
            print(f"[export] note: {league} has no boards.json (the sheet predates it, or the machine that"
                  f" built it had no display): the app's pitch has no board for this league")

        priced = sum(1 for row in sheet if row.get("engine_fm_pred"))
        written.append({
            "league": league,
            # Null where the sheet carries none: the app then says it has no board rather than drawing
            # something else under the same name.
            "boards": board_path,
            "platform": manifest.get("platform"),
            "game": manifest.get("game"),
            "teams": (manifest.get("league") or {}).get("teams"),
            "squad_slots": (manifest.get("league") or {}).get("squad_slots"),
            "matchdays_target": (manifest.get("matchdays") or {}).get("platform_target"),
            "sheet_revision": manifest.get("sheet_revision"),
            "generated_at": manifest.get("generated_at"),
            "auction_date": manifest.get("auction_date"),
            "rows": len(rows),
            "priced": priced,
            "estimated": len(rows) - priced,
            "path": f"sheets/{name}{suffix}",
            "source": path.name,
        })
        print(f"[export] sheets/{name}{suffix}: {len(rows)} rows ({priced} priced, "
              f"{len(rows) - priced} estimated) · {league} {manifest.get('platform')}/"
              f"{manifest.get('game')} · sheet revision {manifest.get('sheet_revision')}")
    return written


def _sheet_value(raw: str | None) -> float | str | None:
    """A CSV cell back to what it was. An empty cell stays NULL - it is a statement, never a zero."""
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return raw


def _provisional_parameters() -> dict[str, object]:
    """The constants that exist because a module needed a number. Read from the modules themselves,
    so the manifest cannot drift away from the code the way a hand-written list would."""
    from euroleghe_ingest.modules import arrivals, fc_site, injuries

    return {
        "fc_site.DECAY": fc_site.DECAY,
        "fc_site.MISS_PENALTY": fc_site.MISS_PENALTY,
        "arrivals.U22_AGE": arrivals.U22_AGE,
        "arrivals.T1_PRICE_PCT": arrivals.T1_PRICE_PCT,
        "arrivals.T3_PRICE_PCT": arrivals.T3_PRICE_PCT,
        "arrivals.FULL_HISTORY_MATCHES": arrivals.FULL_HISTORY_MATCHES,
        "injuries.EXIT_RISK_MONTHS": injuries.EXIT_RISK_MONTHS,
        "_note": "MODEL choices, owned by the gate. Not established values - do not quote them as "
                 "facts and do not tune them outside a pre-registered sweep.",
    }


KNOWN_GAPS: tuple[str, ...] = (
    ("probable_starter: the site publishes only 'now', so the history starts the day the weekly "
     "snapshot job started running. Any rule reading starter_prob is untestable on past windows."),
    ("flags.exit_risk / contract_until: contract expiry exists only on the CURRENT squad page, so "
     "it is a snapshot of today and cannot be backfilled - unusable for a past-window gate."),
    ("player_roles: the granular real role is served only for NOW. The provider accepts a seasonId "
     "and ignores it (HTTP 200, today's codes for a season three years old), so the history starts "
     "the day the first snapshot ran. What IS historical: positions.derived_role (G/D/M/F per "
     "season, from the per-match layer) and positions.avg_x/avg_y (the season heatmap)."),
    ("euro 2021-22 is empty AT THE SOURCE (every Voto is '-'), which is why euro has five windows "
     "and Serie A ten."),
    "external_match_stats starts at 2019-20; older seasons have season aggregates only.",
    ("Goalkeepers have no foreign FM-equivalent: the per-match layer carries goals scored, not "
     "conceded, so the negative side of a keeper's fantavoto cannot be reconstructed."),
)


# ---------- helpers ----------
def _atomic_write_bytes(path: Path, payload: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(payload)
    os.replace(tmp, path)


def _git_commit(repo_root: Path) -> str | None:
    """The commit the bundle was produced at, read from .git without shelling out.

    Provenance, not decoration: a coefficient without its date is not a fact (CLAUDE.md), and the
    same goes for a bundle - "which code wrote this" is the only way back to the numbers.
    """
    head = repo_root / ".git" / "HEAD"
    try:
        content = head.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if content.startswith("ref: "):
        ref = repo_root / ".git" / content[5:].strip()
        try:
            return ref.read_text(encoding="utf-8").strip()[:40]
        except OSError:
            packed = repo_root / ".git" / "packed-refs"
            try:
                for line in packed.read_text(encoding="utf-8").splitlines():
                    if line.endswith(content[5:].strip()):
                        return line.split()[0][:40]
            except OSError:
                return None
            return None
    return content[:40]


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]


def _seasons(conn: sqlite3.Connection, target: str) -> list[str]:
    return [season for (season,) in conn.execute(
        "SELECT DISTINCT season FROM rosters WHERE season <= ? ORDER BY season", (target,))]


def resolve_target_season(conn: sqlite3.Connection, requested: str | None) -> tuple[str, str | None]:
    """(target season, warning). The target is the season being AUCTIONED, outcomes unknown.

    Defaults to the most recent season that has a listone, which in the preseason is the season
    coming up and after it the one being played - both correct, for opposite reasons.
    """
    latest = conn.execute("SELECT MAX(season) FROM rosters").fetchone()[0]
    if requested is None:
        return latest, None
    known = conn.execute("SELECT COUNT(*) FROM rosters WHERE season = ?", (requested,)).fetchone()[0]
    if known:
        return requested, None
    return latest, (f"{requested} has no listone yet (rosters = 0) - exported {latest} instead. "
                    f"The bundle for {requested} can only be produced once its listone is out.")


def _where(spec: TableSpec, seasons: list[str], heavy: list[str]) -> tuple[str, list]:
    if spec.scope == "full":
        clause, params = "", []
    else:
        wanted = seasons if spec.scope == "season" else heavy
        placeholders = ",".join("?" * len(wanted)) or "NULL"
        clause, params = f"{spec.season_column} IN ({placeholders})", list(wanted)
    if spec.extra:
        clause = f"({clause}) AND ({spec.extra})" if clause else spec.extra
    # `also` survives the season filter. Measured need, not a nicety: the no-history pricing reads the
    # `sofascore_recent` rows by MATCH DATE, and those rows are labelled with the season of the listone
    # they were fetched for - so a two-season window silently dropped 570 of them and changed the
    # predicted rank of exactly the players who have no history (a keeper moved from 35th to 60th).
    if spec.also:
        clause = f"({clause}) OR ({spec.also})" if clause else spec.also
    return (f" WHERE {clause}" if clause else ""), params


# ---------- writers ----------
def write_sqlite(ctx: Context, path: Path, seasons: list[str],
                 heavy: list[str]) -> dict[str, int]:
    """A pruned copy of the DB with the SAME schema, so the app sees identical shapes.

    Columns are named explicitly rather than `SELECT *`: an ALTER-TABLE migration appends a column at
    the END of the source table while schema.sql declares it in the middle, so positional copying
    would quietly shift values between columns of the same type.
    """
    if path.exists():
        path.unlink()
    out = connect(path)
    apply_schema(out)
    out.execute("PRAGMA foreign_keys = OFF")
    out.execute("ATTACH DATABASE ? AS src", (str(ctx.config.db_path),))
    counts: dict[str, int] = {}
    for spec in CONTRACT:
        source_columns = _columns(ctx.require_conn(), spec.name)
        columns = [column for column in _columns(out, spec.name) if column in source_columns]
        clause, params = _where(spec, seasons, heavy)
        names = ", ".join(f'"{column}"' for column in columns)
        out.execute(f'INSERT OR REPLACE INTO "{spec.name}"({names}) '
                    f'SELECT {names} FROM src."{spec.name}"{clause}', params)
        counts[spec.name] = out.execute(f'SELECT COUNT(*) FROM "{spec.name}"').fetchone()[0]
    out.commit()
    out.execute("DETACH DATABASE src")
    out.execute("PRAGMA foreign_keys = ON")
    out.commit()
    out.execute("VACUUM")
    out.close()
    return counts


def write_json(ctx: Context, folder: Path, seasons: list[str], heavy: list[str],
               compress: bool = True) -> dict[str, int]:
    """One file per table, so a runtime without SQLite (a browser, a worker) can read the bundle."""
    conn = ctx.require_conn()
    folder.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for spec in CONTRACT:
        columns = _columns(conn, spec.name)
        clause, params = _where(spec, seasons, heavy)
        names = ", ".join(f'"{column}"' for column in columns)
        rows = conn.execute(f'SELECT {names} FROM "{spec.name}"{clause}', params).fetchall()
        payload = json.dumps(
            {"table": spec.name, "columns": columns,
             "rows": [list(row) for row in rows]},
            ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        suffix = ".json.gz" if compress else ".json"
        if compress:
            payload = gzip.compress(payload, mtime=0)   # mtime=0 -> the same data hashes the same
        _atomic_write_bytes(folder / f"{spec.name}{suffix}", payload)
        counts[spec.name] = len(rows)
    return counts


# ---------- verification ----------
def verify_bundle(path: Path, seasons: list[str], target: str,
                  platforms: tuple[str, ...]) -> tuple[list[str], list[str]]:
    """Re-open the written bundle and check what the app will assume -> (problems, notes).

    Checked here rather than trusted: the export ran on a DB that may itself be mid-ingest, and a
    bundle is the one artefact nobody re-reads before shipping it.

    The split matters. A PROBLEM is a broken bundle (a dangling reference, an empty core table, the
    input season missing for a platform that does have the target season). A NOTE is a hole in the
    WORLD - euro simply has no seasons before 2018-19 and 2021-22 is empty at the source - and
    failing on those would mean no bundle can ever be produced. Exactly the distinction the gate's
    `_window_is_usable` makes: absent data is not the same as wrong data.
    """
    problems: list[str] = []
    notes: list[str] = []
    conn = connect(path)
    try:
        def scalar(sql: str, *params) -> int:
            return conn.execute(sql, params).fetchone()[0]

        if scalar("SELECT COUNT(*) FROM rosters WHERE season = ?", target) == 0:
            problems.append(f"rosters: nothing for the target season {target} - "
                            "the app would have no listone to price")
        orphan_players = scalar(
            "SELECT COUNT(*) FROM rosters r LEFT JOIN players p USING(fc_id) "
            "WHERE p.fc_id IS NULL")
        if orphan_players:
            problems.append(f"rosters: {orphan_players} rows point at a missing player")
        orphan_clubs = scalar(
            "SELECT COUNT(*) FROM rosters r LEFT JOIN clubs c ON c.fc_club_id = r.fc_club_id "
            "WHERE r.fc_club_id IS NOT NULL AND c.fc_club_id IS NULL")
        if orphan_clubs:
            problems.append(f"rosters: {orphan_clubs} rows point at a missing club")
        for table in ("players", "clubs", "rosters", "season_stats"):
            if scalar(f"SELECT COUNT(*) FROM {table}") == 0:
                problems.append(f"{table}: empty")

        # The anchors recompute over every season <= input, so a hole in season_stats changes them
        # instead of failing. The INPUT season is the one the engine cannot do without.
        input_season = seasons[-2] if len(seasons) > 1 else target
        for platform in platforms:
            covered = [season for season in seasons
                       if scalar("SELECT COUNT(*) FROM season_stats WHERE season = ? "
                                 "AND platform = ?", season, platform)]
            missing = [season for season in seasons if season not in covered]
            if not covered:
                problems.append(f"season_stats: platform {platform} is entirely absent")
                continue
            if input_season in missing:
                problems.append(f"season_stats: the INPUT season {input_season} is empty for "
                                f"{platform} - the engine has nothing to predict from")
            if missing:
                notes.append(f"season_stats {platform}: no rows for {', '.join(missing)} "
                             f"(source-side, not a bundle defect)")

        violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            problems.append(f"foreign_key_check: {len(violations)} violations "
                            f"(first: {tuple(violations[0])})")
    finally:
        conn.close()
    return problems, notes


# ---------- orchestration ----------
def run(ctx: Context, *, season: str | None = None, out: str | None = None,
        formats: tuple[str, ...] | str = ("sqlite", "json"), history: int = DEFAULT_HISTORY,
        compress: bool = True, verify: bool = True, **kwargs) -> dict:
    """Write the bundle for one target season. Read-only on the DB."""
    conn = ctx.require_conn()
    if isinstance(formats, str):
        formats = (formats,) if formats != "both" else ("sqlite", "json")
    unknown = [fmt for fmt in formats if fmt not in ("sqlite", "json")]
    if unknown:
        raise RuntimeError(f"Unknown format(s) {unknown}; choose from sqlite|json")

    target, warning = resolve_target_season(conn, season)
    if warning:
        print(f"[export] {warning}")
    if target is None:
        raise RuntimeError("no rosters in the DB - there is nothing to export")
    seasons = _seasons(conn, target)
    heavy = seasons[-max(1, history):]
    platforms = tuple(platform for (platform,) in conn.execute(
        "SELECT DISTINCT platform FROM season_stats ORDER BY platform"))
    folder = Path(out) if out else ctx.config.data_dir / "export" / target
    folder.mkdir(parents=True, exist_ok=True)
    print(f"[export] target {target} · {len(seasons)} seasons of history · heavy tables on "
          f"{', '.join(heavy)} · platforms {', '.join(platforms)} -> {folder}")

    counts: dict[str, int] = {}
    bundle = folder / "bundle.sqlite"
    if "sqlite" in formats:
        counts = write_sqlite(ctx, bundle, seasons, heavy)
        print(f"[export] bundle.sqlite: {sum(counts.values())} rows, "
              f"{bundle.stat().st_size / 1e6:.1f} MB")
    if "json" in formats:
        json_counts = write_json(ctx, folder / "json", seasons, heavy, compress)
        counts = counts or json_counts
        size = sum(path.stat().st_size for path in (folder / "json").iterdir())
        print(f"[export] json/: {len(json_counts)} tables, {size / 1e6:.1f} MB"
              f"{' (gzip)' if compress else ''}")

    # The config files are part of the contract: the scoring is per league, the league setup is what
    # fixes the auction's replacement level, and the Mantra modules are the GAME's own rules - which is
    # what says how many men of each role a squad actually fields (§13.3). Without the modules the app
    # can only split a roster by macro-role quotas, and that reads «the league will buy all 124 left
    # backs»: measured 10/08/2026, it doubled the surplus of the best `ds` in the listone. The CLASSIC
    # rulebook travels for the same reason and is not the same file: its places are macro-roles, and the
    # panel's own rationing was measured to need a different rule there (metrica-asta-surplus-v1 §17).
    config_out = folder / "config"
    config_out.mkdir(parents=True, exist_ok=True)
    for source in (ctx.config.scoring_config_path, ctx.config.league_config_path,
                   ctx.config.mantra_modules_path, ctx.config.classic_modules_path):
        try:
            _atomic_write_bytes(config_out / source.name, source.read_bytes())
        except OSError as exc:
            print(f"[export] WARNING: config {source.name} not copied ({exc})")

    # The operator's DECLARED player notes (fuori rosa, rottura con la societa', ha chiesto di andare
    # via). Optional by nature - a project with nothing to declare has no file - so a missing one is
    # silence and not a warning, unlike the four above, which are the contract. It is REPORTING only:
    # the app draws an icon with it, and no engine path reads it.
    if ctx.config.player_notes_path.exists():
        try:
            _atomic_write_bytes(config_out / ctx.config.player_notes_path.name,
                                ctx.config.player_notes_path.read_bytes())
        except OSError as exc:
            print(f"[export] WARNING: config player_notes.json not copied ({exc})")

    # `international_cups.json` deliberately does NOT travel. The app needs no window and no membership
    # list: the sheet's own `desc_cup*` columns already name the tournament, its dates and what it costs,
    # because who goes to a cup is a prediction about a person and those live in the toolkit. A copy in
    # the bundle would be a second source for the same fact - and the first reader to prefer it would be
    # showing a list whose figures describe a different list. The sheet's notes carry the provenance.

    # The engine's own numbers, so the app can rank by SURPLUS instead of by the listone's price. They
    # come from the sheet `snapshot` writes, not from a second engine run: the sheet is the artefact the
    # gate and the panel already agree on, and re-deriving it here would be a second implementation of
    # the same numbers - the defect this project keeps paying for.
    engine_sheets = write_engine_sheets(ctx, folder, target, compress)
    # ...e il MOTORE DELLE DATE PASSATE, se `timepack` ne ha costruite: stesse colonne, stesso formato,
    # una cartella per data. Poche e scelte - i due giorni in cui la rosa è quella vera - perché ognuna
    # costa una corsa di `snapshot` per lega e non ha senso averne una al giorno.
    timepacks = write_timepacks(ctx, folder, compress)

    # The clubs' badges, downloaded once by `positions --layer crests`. They travel with the
    # bundle for the same reason everything else does: the app reads what it is given and never
    # the web, so a page of ours never depends on a provider's CDN staying friendly.
    crests_in = ctx.config.cache_dir / "crests"
    if crests_in.exists():
        crests_out = folder / "crests"
        crests_out.mkdir(parents=True, exist_ok=True)
        copied = 0
        for source in crests_in.iterdir():
            if source.is_file():
                _atomic_write_bytes(crests_out / source.name, source.read_bytes())
                copied += 1
        size = sum(path.stat().st_size for path in crests_out.iterdir())
        print(f"[export] crests/: {copied} files, {size / 1024:.0f} KB")
    else:
        print("[export] note: no crests in the cache (run `positions --layer crests`)")

    problems: list[str] = []
    notes: list[str] = []
    if verify and "sqlite" in formats:
        problems, notes = verify_bundle(bundle, seasons, target, platforms)
        for note in notes:
            print(f"[export] note: {note}")
        for problem in problems:
            print(f"[export] PROBLEM: {problem}")
        if not problems:
            print("[export] verify: referential integrity ok, the input season is complete")

    from euroleghe_ingest.modules.snapshot import SHEET_REVISION

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
        "toolkit_version": __version__,
        "git_commit": _git_commit(ctx.config.repo_root),
        # WHICH MODEL wrote it, not only when. `generated_at` cannot say whether the code still computes
        # the same numbers - that is the whole reason `sheet_revision` exists for a sheet folder - and the
        # bundle was the one artefact that carried the date and not the revision, so an app could not tell
        # a stale bundle from a fresh one. Same number as the sheets: bumped when a value MOVES.
        "sheet_revision": SHEET_REVISION,
        "target_season": target,
        "input_season": seasons[-2] if len(seasons) > 1 else target,
        "history_seasons": seasons,
        "heavy_seasons": heavy,
        "heavy_seasons_note": "The per-match tables travel for these seasons only. It must cover the "
                              "input season AND the input season of the cross-fit window, because the "
                              "coefficients are fitted there: trimming it changes the auction list "
                              "while leaving every gate metric identical.",
        "platforms": list(platforms),
        "formats": list(formats),
        "tables": [{"name": spec.name, "scope": spec.scope, "rows": counts.get(spec.name, 0),
                    "why": spec.why} for spec in CONTRACT],
        "excluded": EXCLUDED,
        # WHICH engine numbers travel, and against which league they were measured. The app ranks by
        # surplus, and a surplus is only comparable inside one league: the entry carries the league, its
        # teams and slots, the sheet revision that produced it, and the platform calendar
        # `engine_pv_pred` is expressed on - so a competition of n rounds is scaled by n/N and never
        # guessed. Empty means the bundle carries no engine numbers, which the app must SAY rather than
        # fall back on the listone's price.
        "engine_sheets": engine_sheets,
        # LE DATE del viaggio nel tempo, ognuna col suo motore. Vuoto = l'app può retrodatare solo quello
        # che è datato nel bundle (letture, trend, marchi) e lo dichiara, invece di far credere il resto.
        "timepacks": timepacks,
        "timepacks_note": "Il motore a una data passata: fogli e campetti costruiti da `snapshot --date`, "
                          "cioè lo stesso codice con cui il gate replica le sue finestre. Le date sono "
                          "poche e scelte (dopo ogni finestra di mercato delle ultime due stagioni); "
                          "ognuna dichiara nel suo manifest che cosa nemmeno il toolkit può retrodatare "
                          "- probabili, ruoli granulari, scadenze di contratto.",
        "engine_sheets_note": "Per-player fm_pred/pv_pred (plus the est_* fallback), from the sheet of "
                              "each declared league. `engine_surplus` travels as the league-level "
                              "reference; a LIVE panel recomputes the replacement level over the players "
                              "still free, which is the only zero an auction is about.",
        "price_discipline": PRICE_DISCIPLINE,
        "provisional_parameters": _provisional_parameters(),
        "adopted_rules": _adopted_rules(),
        "known_gaps": list(KNOWN_GAPS),
        "verify": {"ran": bool(verify and "sqlite" in formats), "problems": problems},
    }
    _atomic_write_bytes(folder / "manifest.json",
                        json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8"))
    print(f"[export] manifest.json written ({sum(counts.values())} rows in "
          f"{len(CONTRACT)} tables)")
    if problems:
        raise RuntimeError(f"export verify failed: {len(problems)} problem(s) - see the log")
    return manifest


def _adopted_rules() -> dict:
    """The rule set the engine actually ships, per platform, with the citation rule attached."""
    from euroleghe_ingest.engine import evaluate

    return {
        "by_platform": {platform: ["R0", *rules] for platform, rules in evaluate.ADOPTED.items()},
        "_note": "A coefficient quoted without its platform, its residual baseline and its date is "
                 "not a fact: the numbers themselves live in the gate report "
                 "(data/reports/engine_backtest.json), not in this bundle.",
    }
