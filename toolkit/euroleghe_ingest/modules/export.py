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
              "identity + birth_year (the U22 trigger and, later, the age curves)"),
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
    TableSpec("arrivals", "full", "who is new, from where, at which tier, with the FM-equivalent"),
    TableSpec("club_elo", "full", "club strength at the auction dates (the goalkeeper module)"),
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
    "auction_safe": ["rosters.price_initial", "rosters.price_initial_mantra"],
    "reporting_only": ["rosters.price", "rosters.price_mantra", "rosters.fvm", "rosters.fvm_mantra"],
}


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

    # The two config files are part of the contract: the scoring is per league and the league setup
    # is what fixes the auction's replacement level. A bundle without them is not reproducible.
    config_out = folder / "config"
    config_out.mkdir(parents=True, exist_ok=True)
    for source in (ctx.config.scoring_config_path, ctx.config.league_config_path):
        try:
            _atomic_write_bytes(config_out / source.name, source.read_bytes())
        except OSError as exc:
            print(f"[export] WARNING: config {source.name} not copied ({exc})")

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
