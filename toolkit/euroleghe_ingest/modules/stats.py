"""stats - season statistics aggregated into season_stats.

Source: the same roster-list files. Verified FM formula (EuroLeghe scale):
FM = Mv + (3*Gf + Ass - 0.5*Amm - Esp - 2*Au - 3*R-)/Pv. Penalties: pen_scored,
pen_missed (taken-scored in the CSVs, R- in the Excel), pen_saved.
NOTE: own_goals is absent from the CSVs (only in the 25/26 Excel).
"""

from __future__ import annotations

from euroleghe_ingest.context import Context
from euroleghe_ingest.sources import iter_records

NAME = "stats"
DESCRIPTION = "Season statistics -> season_stats"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []  # reuses the roster-list inputs
NETWORK = False


# The columns a season aggregate OBSERVES: everything an upsert may overwrite with what the source
# says. `clean_sheets` is deliberately not among them - see `_UPSERT`.
_OBSERVED = ("pv", "mv", "fm", "goals", "assists", "yellows", "reds", "own_goals",
             "pen_scored", "pen_missed", "goals_conceded", "pen_saved")

# UN AGGIORNAMENTO E NON UNA RIGA NUOVA, per la ragione che `positions._store_match_rows` scrive per
# esteso: `INSERT OR REPLACE` cancella la riga e ne scrive un'altra, quindi ogni colonna che
# l'istruzione non nomina torna NULL - e `clean_sheets` la scrive `derive_clean_sheets` dal layer per
# partita, mai una sorgente di aggregati. Un `stats` lanciato da solo (l'import del listone) svuotava
# cosi' le porte inviolate di ogni portiere euro, 509 stagioni sulla base viva, e nessuno se ne
# accorgeva perche' `rebuild` e `update` richiamano la derivazione subito dopo. E' un DERIVATO da un
# ALTRO strato, quindi non lo invalida un nuovo aggregato: si conserva e basta.
_UPSERT = (
    "INSERT INTO season_stats(fc_id, season, platform, " + ", ".join(_OBSERVED) + ") "
    "VALUES (" + ", ".join(["?"] * (3 + len(_OBSERVED))) + ") "
    "ON CONFLICT(fc_id, season, platform) DO UPDATE SET "
    + ", ".join(f"{name} = excluded.{name}" for name in _OBSERVED)
)


def run(ctx: Context, **kwargs) -> None:
    conn = ctx.require_conn()
    for rec in iter_records(ctx.config):
        # safety when run standalone (without rosters): satisfy the player FK
        conn.execute(
            "INSERT OR IGNORE INTO players(fc_id, canonical_name) VALUES (?, ?)",
            (rec.fc_id, rec.name),
        )
        conn.execute(
            _UPSERT,
            (
                rec.fc_id, rec.season, "euro", rec.pv, rec.mv, rec.fm, rec.goals, rec.assists,
                rec.yellows, rec.reds, rec.own_goals, rec.pen_scored, rec.pen_missed,
                rec.goals_conceded, rec.pen_saved,
            ),
        )

    n = conn.execute("SELECT COUNT(*) FROM season_stats").fetchone()[0]
    print(f"[stats] season_stats={n}")


def derive_from_ratings(ctx: Context) -> None:
    """Compute season_stats (Pv, Mv, FM, and the bonus sums) from the per-matchday match_ratings.

    This gives seasons that have no listone (older voti-only seasons) their aggregates, and fills
    players the listone does not carry. No Mantra roles / prices here.

    A DERIVED ROW IS RE-DERIVED WHEN ITS INPUT MOVES, which is the rule `_UPSERT` states for
    `clean_sheets` from the other side. It used to write only where the row did not EXIST, so a row
    created while the season was in progress was frozen at the count of that day and no later run
    could touch it: measured 22/09/2026, the whole target season read `pv` in {0, 1} on BOTH
    platforms - 574 euro rows and 319 default rows matching the votes of MATCHDAY 1 exactly, 100% of
    them - and 38 rows of two closed seasons carried the same freeze (fc_id 7287, euro 2025-26: `pv`
    5 against 22 votes, with the two Mv agreeing to a hundredth). It is «a stale derivative is worse
    than an empty one» (v9.73) applied to an aggregate instead of a column.

    THE CONDITION IS «THE VOTES COUNT MORE», never «the votes disagree», and the two directions are
    different facts. More votes than the row declares means the aggregate is behind what we have
    measured. FEWER means our own scrape is partial and the listone knows more - 111 rows of euro
    2024-25 - and there the listone stays authoritative, which is what `check_ratings_consistency`
    already says by skipping those and reporting only the other side. A row whose `pv` is NULL is
    left alone too: it cannot claim a count, but somebody wrote it."""
    conn = ctx.require_conn()
    # Aggregate PER platform (different calendars -> never mix). Fill each (player, season, platform)
    # not already present: the listone provides 'euro'; this adds 'default' (full-season propensity)
    # and 'euro' for players/seasons the listone doesn't cover.
    rows = conn.execute(
        """
        SELECT mr.fc_id, mr.season, mr.platform,
               COUNT(mr.mv), AVG(mr.mv), AVG(mr.fantavoto),
               SUM(mr.goals), SUM(mr.assists), SUM(mr.yellows), SUM(mr.reds), SUM(mr.own_goals),
               SUM(mr.pen_scored), SUM(mr.pen_missed), SUM(mr.goals_conceded), SUM(mr.pen_saved)
        FROM match_ratings mr
        WHERE mr.role IN ('P','D','C','A')
        GROUP BY mr.fc_id, mr.season, mr.platform
        HAVING NOT EXISTS (SELECT 1 FROM season_stats s
                           WHERE s.fc_id = mr.fc_id AND s.season = mr.season
                             AND s.platform = mr.platform)
            -- ...or the votes count MORE than the row declares. NULL `pv` compares false here, so a
            -- row that exists without a count is kept: see the docstring for why the two directions
            -- of the disagreement are not the same fact.
            OR COUNT(mr.mv) > (SELECT s.pv FROM season_stats s
                               WHERE s.fc_id = mr.fc_id AND s.season = mr.season
                                 AND s.platform = mr.platform)
        """
    ).fetchall()

    def r2(v):
        return round(v, 2) if v is not None else None

    for row in rows:
        fc_id, season, platform, pv, mv, fm, g, a, y, red, og, ps, pm, gc, psv = row
        conn.execute(
            _UPSERT,
            (fc_id, season, platform, pv, r2(mv), r2(fm), g, a, y, red, og, ps, pm, gc, psv),
        )
    print(f"[stats] derived {len(rows)} season_stats rows from ratings (per platform)")
    derive_clean_sheets(ctx)


def derive_clean_sheets(ctx: Context) -> int:
    """Le porte inviolate di ogni portiere, contate dal layer per partita.

    Va su TUTTE le righe e non solo su quelle che `derive_from_ratings` scrive: la maggioranza delle
    righe di `season_stats` viene dal listone, che questo numero non lo porta, quindi contarlo solo per
    le derivate lo lascerebbe vuoto proprio per i titolari.

    TRE GUARDIE, e senza la prima il numero sarebbe una bugia. Una riga di portiere che NON ha giocato
    porta `goals_conceded` a zero come chiunque altro: contata, darebbe una porta inviolata a ogni
    riserva a ogni giornata, cioè il contrario di quello che la colonna dice. Quindi solo `status =
    'played'`. Poi il VOTO (`mv IS NOT NULL`), che tiene il numeratore sullo stesso dominio di `pv`:
    un bonus si attacca a un fantavoto, e senza voto non c'è fantavoto a cui attaccarlo. E infine il
    numero si scrive solo per chi quel layer copre davvero (`EXISTS`): per gli altri resta NULL, perché
    «non l'abbiamo misurato» e «non ne ha tenuta nessuna» sono due frasi diverse e l'app le legge in due
    modi diversi.

    Il ruolo è quello della RIGA di quella giornata (`match_ratings.role`), non quello del listone: un
    uomo schierato in porta quel giorno è un portiere quel giorno.

    RESTA UN DISACCORDO FRA LE FONTI e non lo si nasconde: su 970 stagioni-portiere UNA legge più porte
    inviolate che presenze (Padilla, euro 2024-25: il listone gli dà `pv` = 0 e il layer per partita ha
    una giornata giocata e votata). Sono due sorgenti che dicono cose diverse su chi è sceso in campo -
    non un errore di questo conto - e ritagliare il numeratore sul denominatore nasconderebbe la
    contraddizione invece di mostrarla.
    """
    conn = ctx.require_conn()
    played = """
        SELECT 1 FROM match_ratings mr
        WHERE mr.fc_id = season_stats.fc_id AND mr.season = season_stats.season
          AND mr.platform = season_stats.platform
          AND mr.role = 'P' AND mr.status = 'played' AND mr.goals_conceded IS NOT NULL
    """
    conn.execute(
        f"""
        UPDATE season_stats SET clean_sheets = (
            SELECT COUNT(*) FROM match_ratings mr
            WHERE mr.fc_id = season_stats.fc_id AND mr.season = season_stats.season
              AND mr.platform = season_stats.platform
              AND mr.role = 'P' AND mr.status = 'played' AND mr.goals_conceded = 0
              AND mr.mv IS NOT NULL
        )
        WHERE EXISTS ({played})
        """
    )
    filled, total = conn.execute(
        "SELECT COUNT(clean_sheets), SUM(clean_sheets) FROM season_stats"
    ).fetchone()
    print(f"[stats] clean_sheets: {filled} stagioni-portiere · {total or 0} porte inviolate")
    return filled or 0
