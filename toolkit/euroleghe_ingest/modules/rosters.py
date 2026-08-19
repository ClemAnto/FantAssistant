"""rosters - ALWAYS first. Normalizes the roster lists into players / clubs / rosters.

Source: season Excel/CSV files in data/raw (see DRIVE-MANIFEST). Establishes the registry
with fc_id as primary key and the club x season perimeter. Mantra roles in `roles`
(lowercase, ';'-separated), Classic role in `role_classic`.

Notes from the real data: price is not in the current roster lists -> NULL; nationality is
provided by no source -> NULL; in 2024-25 the club column is empty -> club NULL.
"""

from __future__ import annotations

import sqlite3

from euroleghe_ingest import config
from euroleghe_ingest.context import Context
from euroleghe_ingest.matching import club_identity
from euroleghe_ingest.sources import SEASON_SOURCES, iter_records

NAME = "rosters"
DESCRIPTION = "Roster lists -> players, clubs, rosters (fc_id primary key)"
DEPENDS_ON: list[str] = []
# The actual source file names (single source of truth: sources.SEASON_SOURCES).
RAW_INPUTS: list[str] = [filename for _season, filename, _fmt in SEASON_SOURCES]
NETWORK = False


# "Konè I." arrives from the Drive CSV exports as "Kon�� I." (documented in `sources`): the
# accent was destroyed BEFORE our decode, so no codec recovers it and only another source can supply
# the spelling. Hence one rule, shared by every writer of canonical_name: a damaged name never
# displaces an intact one, and an intact one always repairs a damaged one. char(65533) is U+FFFD, the
# replacement character. Idempotent, so a `rebuild` - or a single listone re-ingest - heals the row on
# its own, and re-running the CSV-backed modules can no longer break it again.
UPSERT_PLAYER = """
    INSERT INTO players(fc_id, canonical_name, birth_year, nationality)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(fc_id) DO UPDATE SET
        canonical_name = CASE
            WHEN instr(excluded.canonical_name, char(65533)) > 0
                 AND instr(players.canonical_name, char(65533)) = 0
            THEN players.canonical_name
            ELSE excluded.canonical_name END,
        nationality = COALESCE(players.nationality, excluded.nationality)
"""


def _get_or_create_club(conn: sqlite3.Connection, name: str | None, league: str | None) -> int | None:
    """The club id for this name, minting one only when it is really a club we have never seen.

    `fc_club_id` is NOT fantacalcio's id - it is a surrogate this function hands out - so matching on the
    exact STRING is what created twin identities for one club: `Newcastle` and `Newcastle United`,
    `Eintracht` and `Eintracht Francoforte`, `Paris Saint Germain` and `Paris Saint-Germain`, each pair
    splitting rosters, xref, elo, coaches and the penalty hierarchy down the middle. Resolve on
    `club_identity` instead, which routes through the alias table that already knows they are one club
    (`db.database.merge_twin_clubs` cleans up the three that exist).
    """
    if not name:
        return None
    row = conn.execute("SELECT fc_club_id FROM clubs WHERE canonical_name = ?", (name,)).fetchone()
    if row:
        return row[0]
    mine = club_identity(name)
    for club_id, existing in conn.execute(
            "SELECT fc_club_id, canonical_name FROM clubs WHERE canonical_name IS NOT NULL"):
        if club_identity(existing) == mine:
            return club_id
    new_id = conn.execute("SELECT COALESCE(MAX(fc_club_id), 0) + 1 FROM clubs").fetchone()[0]
    conn.execute(
        "INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, ?)",
        (new_id, name, league),
    )
    return new_id


def run(ctx: Context, **kwargs) -> None:
    conn = ctx.require_conn()
    seasons: set[str] = set()
    for rec in iter_records(ctx.config):
        conn.execute(UPSERT_PLAYER, (rec.fc_id, rec.name, None, rec.nationality))
        club_id = _get_or_create_club(conn, rec.club, rec.league)
        # UPSERT, not INSERT OR REPLACE: a field the source leaves empty must keep whatever the rest
        # of the pipeline learned. The 2024-25 roster list has NO club column, so a plain REPLACE
        # wiped the ~1000 clubs recovered by backfill_clubs/the listone every time this module was
        # run on its own (it is a button in the panel), and those players vanished from the views.
        conn.execute(
            """
            INSERT INTO rosters(fc_id, season, fc_club_id, roles, role_classic, league, price)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fc_id, season) DO UPDATE SET
                fc_club_id   = COALESCE(excluded.fc_club_id, rosters.fc_club_id),
                roles        = COALESCE(excluded.roles, rosters.roles),
                role_classic = COALESCE(excluded.role_classic, rosters.role_classic),
                league       = COALESCE(excluded.league, rosters.league),
                price        = COALESCE(excluded.price, rosters.price)
            """,
            (rec.fc_id, rec.season, club_id, ";".join(rec.roles) or None, rec.role_classic,
             rec.league, None),
        )
        seasons.add(rec.season)

    n_players = conn.execute("SELECT COUNT(*) FROM players").fetchone()[0]
    n_clubs = conn.execute("SELECT COUNT(*) FROM clubs").fetchone()[0]
    n_rosters = conn.execute("SELECT COUNT(*) FROM rosters").fetchone()[0]
    print(f"[rosters] seasons={sorted(seasons)} · players={n_players} clubs={n_clubs} rosters={n_rosters}")


def backfill_clubs(ctx: Context) -> None:
    """Fill rosters that have no club by learning the player's team from the scraped ratings
    (match_ratings.team, most frequent) + the league already on the roster row. Reuses existing
    clubs by name, so it also fixes seasons whose listone had an empty club column (e.g. 2024-25)."""
    conn = ctx.require_conn()
    missing = conn.execute("SELECT fc_id, season, league FROM rosters WHERE fc_club_id IS NULL").fetchall()
    filled = 0
    for fc_id, season, league in missing:
        row = conn.execute(
            "SELECT team FROM match_ratings WHERE fc_id = ? AND season = ? AND team IS NOT NULL "
            "GROUP BY team ORDER BY COUNT(*) DESC LIMIT 1",
            (fc_id, season),
        ).fetchone()
        if row is None:
            continue
        club_id = _get_or_create_club(conn, row[0], league)
        conn.execute("UPDATE rosters SET fc_club_id = ? WHERE fc_id = ? AND season = ?",
                     (club_id, fc_id, season))
        filled += 1
    print(f"[rosters] backfilled {filled} missing clubs from ratings")


def backfill_rosters_from_ratings(ctx: Context) -> None:
    """Create roster entries for players present in the ratings but not in a listone, so the Players
    view can show them: the full Serie A teams (the 'default' platform) and older voti-only seasons.
    League = serie_a for the 'default' (classic Serie A) platform; otherwise inferred from the team's clubs entry.
    Mantra roles stay NULL (ratings only give the Classic role)."""
    conn = ctx.require_conn()
    pairs = conn.execute(
        "SELECT DISTINCT fc_id, season FROM match_ratings mr WHERE mr.role IN ('P','D','C','A') "
        "AND NOT EXISTS (SELECT 1 FROM rosters r WHERE r.fc_id = mr.fc_id AND r.season = mr.season)"
    ).fetchall()

    def _mode(fc_id, season, column, where=""):
        row = conn.execute(
            f"SELECT {column} FROM match_ratings WHERE fc_id=? AND season=? {where} "
            f"GROUP BY {column} ORDER BY COUNT(*) DESC LIMIT 1", (fc_id, season)).fetchone()
        return row[0] if row else None

    created = 0
    for fc_id, season in pairs:
        team = _mode(fc_id, season, "team", "AND team IS NOT NULL")
        if not team:
            continue
        role = _mode(fc_id, season, "role", "AND role IN ('P','D','C','A')")
        if _mode(fc_id, season, "platform") == "default":
            league = "serie_a"
        else:
            lk = conn.execute("SELECT league FROM clubs WHERE canonical_name=? AND league IS NOT NULL "
                              "LIMIT 1", (team,)).fetchone()
            league = lk[0] if lk else None
        club_id = _get_or_create_club(conn, team, league)
        conn.execute(
            "INSERT OR IGNORE INTO rosters(fc_id, season, fc_club_id, role_classic, league) "
            "VALUES (?, ?, ?, ?, ?)",
            (fc_id, season, club_id, role, league),
        )
        created += 1
    print(f"[rosters] created {created} roster entries from ratings")


# La quota di partite che un campionato deve avere perche' sia IL campionato del club. Alta di
# proposito: un club sta in una lega sola, e le poche righe che dicono un'altra cosa sono un uomo
# trasferito a stagione in corso. Sui sei club che questa funzione ha corretto il 19/08/2026 l'evidenza
# era 100% su tutti e sei, quindi la soglia non decide niente qui - esiste per il caso che non c'e'.
CLUB_LEAGUE_SHARE = 0.6


def fix_club_leagues(ctx: Context) -> None:
    """La lega di un club, DALLE PARTITE CHE HA GIOCATO - non dalle righe di `rosters`.

    LA VERSIONE PRECEDENTE LEGGEVA LA MAGGIORANZA DELLE SUE RIGHE DI `rosters`, e con
    `_backfill_from_ratings` che scrive nelle righe la lega del CLUB era un anello: la lega del club
    veniva dalle righe, le righe la prendevano dal club, e bastava un uomo passato in Serie A per farci
    entrare tutta la squadra. Costo misurato il 19/08/2026: **sei club stranieri archiviati come
    `serie_a`** - Leicester City, Everton, Nizza, Valencia, Wolfsburg, Hertha Berlino - con **419 righe di
    `rosters`** fra 2018-19 e 2022-23, tutti con ZERO partite in `match_ratings` su `default` e migliaia
    su `euro`. Non e' cosmetico: `features.load` filtra la popolazione di Serie A con
    `r.league = 'serie_a'`, quindi quelle righe entravano nelle finestre vecchie del gate su `default` -
    Maddison, Tielemans, Castagne e i loro compagni misurati come se giocassero in Italia. Trovato
    guardando SETTE zeri sospetti in una misura: erano uomini del Leicester che quella stagione avevano
    giocato 30, 37, 35 partite, in Premier.

    La fonte nuova non puo' chiudere l'anello perche' non passa da `rosters`: e' il CAMPIONATO delle
    partite che i suoi giocatori hanno giocato per lui (`external_match_stats`), unito per CHIAVE
    CANONICA e non per la stringa che la fonte usa - senza quella, tre club dei sei non si trovavano
    affatto (`Nizza`/`Nice`, `Wolfsburg`/`VfL Wolfsburg`).

    E UN CLUB CHE LE PARTITE NON SANNO NOMINARE NON DIVENTA SERIE A PER DIFETTO. Hertha Berlino non ha
    partite in nessuna delle cinque leghe (gioca in seconda divisione) e restava `serie_a`: qui diventa
    NULL, che e' vero e che la tiene fuori dal filtro di Serie A. Un club di Serie A ha partite di Serie A;
    dichiararsi tale con zero righe su `default` e' una contraddizione, non un'incertezza.
    """
    conn = ctx.require_conn()
    matches: dict[str, dict[str, int]] = {}
    for club, competition, played in conn.execute(
            "SELECT club, competition, COUNT(*) FROM external_match_stats "
            "WHERE club IS NOT NULL AND competition IS NOT NULL GROUP BY club, competition"):
        key = club_identity(club)
        if key:
            bucket = matches.setdefault(key, {})
            bucket[competition] = bucket.get(competition, 0) + played
    in_scope = set(config.CHAMPIONSHIPS)

    named, emptied = [], []
    for club_id, name, current in conn.execute(
            "SELECT fc_club_id, canonical_name, league FROM clubs").fetchall():
        counts = {competition: played for competition, played in
                  (matches.get(club_identity(name or "")) or {}).items() if competition in in_scope}
        total = sum(counts.values())
        best = max(counts, key=counts.get) if counts else None
        if best and counts[best] / total >= CLUB_LEAGUE_SHARE:
            if best != current:
                conn.execute("UPDATE clubs SET league = ? WHERE fc_club_id = ?", (best, club_id))
                named.append((name, current, best, counts[best], total))
            continue
        # Nessuna partita che lo nomini. Si tocca SOLO la contraddizione: dice Serie A e su `default`
        # non ha giocato mai. Un club senza evidenza e senza contraddizione resta com'e' - non sapere
        # non e' una ragione per riscrivere.
        if current == "serie_a" and not conn.execute(
                "SELECT 1 FROM match_ratings WHERE platform = 'default' AND team = ? LIMIT 1",
                (name,)).fetchone():
            conn.execute("UPDATE clubs SET league = NULL WHERE fc_club_id = ?", (club_id,))
            emptied.append(name)

    # ...e le righe di `rosters` seguono il club, o il filtro le lascerebbe passare lo stesso: la lega
    # su una riga e' una COPIA di quella del club, e una copia che non si aggiorna e' il difetto.
    moved = 0
    for club_id, league in conn.execute(
            "SELECT fc_club_id, league FROM clubs WHERE league IS NOT NULL").fetchall():
        moved += conn.execute(
            "UPDATE rosters SET league = ? WHERE fc_club_id = ? AND (league IS NULL OR league != ?)",
            (league, club_id, league)).rowcount
    orphaned = conn.execute(
        "UPDATE rosters SET league = NULL WHERE league IS NOT NULL AND fc_club_id IN "
        "(SELECT fc_club_id FROM clubs WHERE league IS NULL)").rowcount

    for name, was, now, played, total in named:
        print(f"[rosters] {name}: {was} -> {now} ({played}/{total} partite)")
    for name in emptied:
        print(f"[rosters] {name}: serie_a -> ignota (nessuna partita che la nomini, zero su `default`)")
    print(f"[rosters] {len(named)} leghe di club corrette dalle PARTITE, {len(emptied)} svuotate · "
          f"{moved} righe di rosters allineate, {orphaned} svuotate")
    if named or emptied:
        # Una migrazione dichiara cosa ri-derivare: e' la regola nata dai trasferimenti fantasma.
        print("[rosters] da rifare, in ordine: arrivals -> i FOGLI -> estimates -> export. E le "
              "finestre vecchie del gate su `default` cambiano POPOLAZIONE: i numeri pubblicati su "
              "Tm3/Tm2/Tm1 sono stati misurati con quelle righe dentro.")
