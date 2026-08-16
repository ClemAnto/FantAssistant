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


def run(ctx: Context, **kwargs) -> None:
    conn = ctx.require_conn()
    for rec in iter_records(ctx.config):
        # safety when run standalone (without rosters): satisfy the player FK
        conn.execute(
            "INSERT OR IGNORE INTO players(fc_id, canonical_name) VALUES (?, ?)",
            (rec.fc_id, rec.name),
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO season_stats(
                fc_id, season, platform, pv, mv, fm, goals, assists, yellows, reds, own_goals,
                pen_scored, pen_missed, goals_conceded, pen_saved)
            VALUES (?, ?, 'euro', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rec.fc_id, rec.season, rec.pv, rec.mv, rec.fm, rec.goals, rec.assists,
                rec.yellows, rec.reds, rec.own_goals, rec.pen_scored, rec.pen_missed,
                rec.goals_conceded, rec.pen_saved,
            ),
        )

    n = conn.execute("SELECT COUNT(*) FROM season_stats").fetchone()[0]
    print(f"[stats] season_stats={n}")


def derive_from_ratings(ctx: Context) -> None:
    """Compute season_stats (Pv, Mv, FM, and the bonus sums) from the per-matchday match_ratings,
    for any (player, season) NOT already covered by the listone. This gives seasons that have no
    listone (older voti-only seasons) their aggregates, and fills players missing from the listone.
    The listone-backed seasons are left untouched (authoritative). No Mantra roles / prices here."""
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
          AND NOT EXISTS (SELECT 1 FROM season_stats s
                          WHERE s.fc_id = mr.fc_id AND s.season = mr.season AND s.platform = mr.platform)
        GROUP BY mr.fc_id, mr.season, mr.platform
        """
    ).fetchall()

    def r2(v):
        return round(v, 2) if v is not None else None

    for row in rows:
        fc_id, season, platform, pv, mv, fm, g, a, y, red, og, ps, pm, gc, psv = row
        conn.execute(
            """
            INSERT OR REPLACE INTO season_stats(
                fc_id, season, platform, pv, mv, fm, goals, assists, yellows, reds, own_goals,
                pen_scored, pen_missed, goals_conceded, pen_saved)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
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
