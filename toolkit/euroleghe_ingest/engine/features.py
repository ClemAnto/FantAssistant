"""DB -> per-window observations, with the look-ahead discipline enforced in ONE place.

A backtest is only worth as much as its inputs are honest, and the easiest way to fool ourselves is
to feed the model something that was not knowable on auction day. So every read lives here and is
tagged:

  ALLOWED  input-season aggregates (season_stats, external_stats, flags, positions) · the TARGET
           listone's roles / prices / club (published before the auction, which is already how
           `arrivals` computes its tiers) · `arrivals` of the target season (it describes a move that
           happened before the auction, and its foreign FM-equivalent is built from the input season)
           · club_elo at the auction date · dated states (probable_starter, penalty_hierarchy) with
           valid_from <= auction date
  FORBIDDEN anything of the target season except the listone: target ratings, target flags/positions,
           target mv_synth, dated states after the auction. The target aggregates ARE loaded, but
           only into the `*_act` fields, which exist for scoring and are never passed to the model.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from itertools import pairwise

from euroleghe_ingest.engine.model import (
    ANCHOR_FALLBACK,
    ANCHOR_MIN_PV,
    MANTRA_BY_CLASSIC,
    MANTRA_ROLES,
    MIN_PV_PREV,
    split_roles,
)

# ---------------------------------------------------------------- windows


@dataclass(frozen=True)
class Window:
    """One prediction exercise: predict `target_season` knowing only `input_season`."""

    key: str
    input_season: str
    target_season: str
    auction_date: str        # everything dated after this is invisible to the model

    @property
    def label(self) -> str:
        return f"{self.key} {self.input_season}->{self.target_season}"


# Chronological order, oldest first. T1/T2 are the two windows the project's gate was originally
# written against; T0 and Tm1 were added on 27/07/2026 once the authenticated votes API turned out to
# serve 2022-23 and 2021-22 (championship ids euro 105/104, Serie A 17/16) - the raw Drive datasets
# still start at 2023-24, so those two seasons exist in the DB from the API alone.
#
# ⚠️ The older windows are NOT equally instrumented. `external_stats` (SofaScore minutes, xG),
# `arrivals`, `club_elo` and the `new_coach` flag start at 2023-24, so on anything older than T1 the
# rules that read them have no sample at all. The gate reports that as NOT MEASURABLE, never as a
# failure: a window that cannot see a feature says nothing about the hypothesis. What the old windows DO
# test is the part of the engine that only needs the votes - the anchors, the beta, the appearances
# share, the keepers - which is most of it.
#
# ⚠️ Tm3 and Tm4 straddle COVID: 2019-20 was suspended in March and finished in the summer, 2020-21 was
# played behind closed doors with no home advantage. Both are legitimate windows and both are unusual
# football. A rule that holds across them is better tested; one that fails ONLY there deserves the
# question asked out loud rather than a silent rejection.
# Which of these are usable depends on the PLATFORM, and `_window_is_usable` decides it from the data
# rather than from a list kept by hand. Serie A has votes in every one of them; EuroLeghe is split in two
# by a hole at 2021-22 (votes exist for 2020-21 and for 2022-23, not in between): on euro Tm2 (whose
# target is the empty season) and Tm1 (whose input is) are not windows, and Tm5-Tm7 have no euro seasons
# behind them at all. Confirmed by the ingest, not assumed: euro 2019-20 has 803 season rows all with a
# fantamedia, 2020-21 has 904 of 938, 2021-22 has 954 rows and NOT ONE.
# Serie A has votes in all eleven seasons from 2015-16, so it gets ten windows; euro gets five.
WINDOWS: dict[str, Window] = {
    "Tm7": Window("Tm7", "2015-16", "2016-17", "2016-08-15"),
    "Tm6": Window("Tm6", "2016-17", "2017-18", "2017-08-15"),
    "Tm5": Window("Tm5", "2017-18", "2018-19", "2018-08-15"),
    "Tm4": Window("Tm4", "2018-19", "2019-20", "2019-08-15"),
    "Tm3": Window("Tm3", "2019-20", "2020-21", "2020-09-15"),   # COVID: 20/21 kicked off in September
    "Tm2": Window("Tm2", "2020-21", "2021-22", "2021-08-15"),
    "Tm1": Window("Tm1", "2021-22", "2022-23", "2022-08-15"),
    "T0": Window("T0", "2022-23", "2023-24", "2023-08-15"),
    "T1": Window("T1", "2023-24", "2024-25", "2024-08-15"),
    "T2": Window("T2", "2024-25", "2025-26", "2025-08-15"),
}

# The two windows the published gate numbers refer to. Kept as a name so `verify_baseline` and any
# comparison against the documents stays pinned to them however many windows exist.
PUBLISHED_WINDOWS: tuple[str, ...] = ("T1", "T2")

# LE FINESTRE IN-SEASON: l'asta giocata a stagione iniziata (gate §7-duotricies).
#
# TENUTE FUORI da `WINDOWS` di proposito. Sono un esercizio DIVERSO - si prevede il resto della stagione,
# non la stagione - e mescolarle alle dieci vorrebbe dire che una corsa qualunque del gate cambierebbe di
# significato senza che nessuno l'abbia chiesto. Si scelgono con `backtest --in-season`, e ogni numero
# pubblicato resta quello che era.
#
# Le due date per stagione sono quelle che il progetto ha già scelto due volte oggi, per la stessa
# ragione: il **5 settembre** e il **5 febbraio** sono i due giorni in cui il mercato ha appena chiuso e
# la rosa è quella vera. Sono anche i due REGIMI diversi della domanda - l'asta tardiva di settembre
# (k = 2-5 giornate) e quella di riparazione (k = 19-23) - e una finestra per giornata direbbe soprattutto
# quanto è liscia l'interpolazione fra i due.
#
# Dal 2019-20 perché il layer per-partita comincia lì, ed è quello che data le giornate: senza le date non
# si sa quali erano già giocate, e senza quello la finestra non esiste.
INSEASON_WINDOWS: dict[str, Window] = {
    f"{key}{tag}": Window(f"{key}{tag}", f"{start - 1}-{str(start)[2:]}", f"{start}-{str(start + 1)[2:]}",
                          f"{start if tag == 'set' else start + 1}-{day}")
    for start, key in ((2019, "I19"), (2020, "I20"), (2021, "I21"), (2022, "I22"),
                       (2023, "I23"), (2024, "I24"), (2025, "I25"))
    for tag, day in (("set", "09-05"), ("feb", "02-05"))
}


#: Ogni finestra che il gate sappia nominare. NON è il set di default di nessuna corsa: quello resta
#: `WINDOWS`, e le in-season si prendono nominandole. Serve solo a risolvere una chiave in un oggetto.
ALL_WINDOWS: dict[str, Window] = {**WINDOWS, **INSEASON_WINDOWS}


def window(key: str) -> Window:
    """La finestra con quel nome, pre-stagione o in-season che sia."""
    try:
        return ALL_WINDOWS[key]
    except KeyError:
        raise KeyError(f"finestra sconosciuta: {key!r}. "
                       f"Disponibili: {', '.join(ALL_WINDOWS)}") from None


def cross_fit_source(key: str, available: tuple[str, ...] | None = None) -> str:
    """Which window's parameters score `key`. Never `key` itself - that is the whole point.

    With exactly two windows this is "the other one", which is what the pre-registered protocol says
    and what every published number was produced with. With more, it is the CHRONOLOGICALLY ADJACENT
    window, preferring the later one: an older, thinly instrumented window is then scored with
    parameters fitted on better data, and - crucially - T1/T2 keep pairing with each other, so adding
    windows does not silently restate the published results.
    """
    # Le in-season si accoppiano FRA LORO e mai con una pre-stagione: sono un altro esercizio (si
    # prevede il resto della stagione), quindi un parametro fittato su una non descrive l'altra. È lo
    # stesso motivo per cui T1/T2 continuano ad accoppiarsi fra loro quando si aggiungono finestre.
    pool = INSEASON_WINDOWS if key in INSEASON_WINDOWS else WINDOWS
    order = [name for name in pool if available is None or name in available]
    if key not in order:
        raise KeyError(f"unknown window {key}")
    index = order.index(key)
    later, earlier = order[index + 1:], order[:index]
    return later[0] if later else earlier[-1]


# ---------------------------------------------------------------- observations


@dataclass(frozen=True)
class Observation:
    """Everything known about one player for one window, plus his actual outcome (for scoring)."""

    fc_id: int
    name: str
    role_classic: str | None
    roles_mantra: tuple[str, ...]
    league: str | None
    # Qt.A of the target season: revised all season long, so for a past season it already knows the
    # outcome. Kept for description only - no rule may read it (`price_initial` is the usable one).
    price: float | None
    club_prev: str | None
    club_target: str | None
    # input season: the model may use all of this
    pv_prev: int | None
    mv_prev: float | None
    fm_prev: float | None
    # The measured seasons themselves, MOST RECENT FIRST, so a rule can weight them instead of taking
    # the flat mean `fm_5y` already carries. R18b (pre-registered 10/08/2026) is the reason they exist.
    fm_seasons: tuple[float, ...] = ()
    mv_seasons: tuple[float, ...] = ()
    minutes_prev: int | None = None
    starts_prev: int | None = None
    matches_prev: int | None = None
    goals_prev: int | None = None
    assists_prev: int | None = None
    xg_prev: float | None = None
    xa_prev: float | None = None
    rating_prev: float | None = None
    minutes_share_euro_prev: float | None = None    # minutes on the euro calendar's own rounds
    # Qt.I, the pre-auction quotation: the market's EXPECTATION for the target season, and the same
    # quantity a year earlier - so the engine can read how the market REVISED him before the auction.
    price_initial: float | None = None
    price_initial_prev: float | None = None
    # FVM of the target season, Classic and Mantra. Served in the listone's current state, so for a
    # finished season it is the END-OF-SEASON market value: scoring and reporting only, like `price`.
    # No rule may read it - it is on the wrong side of the auction date by construction.
    fvm: float | None = None
    fvm_mantra: float | None = None
    # the same quotations in the Mantra currency: a Mantra auction is bought with Qt.I M and valued
    # against FVM M. Reporting only, like the Classic pair above.
    price_mantra: float | None = None
    price_initial_mantra: float | None = None
    # `recent_form`: a small dated sample for players with no history at all. Ratings from a
    # competition the synthetic voto was never fitted on, so kept as its own thing.
    recent_matches: int = 0
    recent_minutes: int = 0
    # None, not 0, when the sample's bonuses were never fetched - `recent_bonus_matches` says how many
    # of the matches actually carry them. A rule must check it before reading either total.
    recent_goals: int | None = None
    recent_assists: int | None = None
    recent_bonus_matches: int = 0
    recent_rating: float | None = None
    # how many days his sample spans: with the match count it says how OFTEN he played, which is a
    # different thing from how long he stayed on the pitch when he did (R13)
    recent_span_days: int | None = None
    # inactivity, from the dated per-match layer: the injury PROXY. `injuries` is no longer empty
    # (the module landed 28/07/2026), but swapping a proxy for the facts is a new hypothesis and
    # has to be pre-registered like any other - so this stays until that gate is run.
    # R15: how much MEMORY his availability had last season - P(plays | played last matchday) minus
    # P(plays | missed it), on the platform's own calendar. Two players can share a Pv and be different
    # animals: nineteen appearances in a row is a settled starter who got hurt, nineteen scattered over
    # the season is a rotation player. None when the sequence is too short to say.
    persistence_prev: float | None = None
    # R16: the TARGET club's goals per eleven appearances last season, and his share of that club's
    # attacking production. Their product is what the goal budget hypothesis is about: two forwards of
    # a mid-table side cannot both be priced as the sole claimant of a top side's goals.
    club_goals_prev: float | None = None
    attack_share_target: float | None = None
    # R5b: the TARGET club's EXPECTED assists per eleven players' minutes last season. Measured, not
    # assumed, to be the better read on a club's attack than what it actually scored - see the note on
    # `club_strength_adjustment`. Only exists from 2022-23, when the provider's xG/xA start.
    club_expected_assists_prev: float | None = None
    longest_gap_days: int | None = None
    days_since_last_match: int | None = None
    minutes_last_3: float | None = None
    birth_year: int | None = None
    derived_role_prev: str | None = None
    off_role_prev: bool = False
    # target season, but known before the auction
    arrival_type: str | None = None
    arrival_tier: str | None = None
    origin_league: str | None = None
    foreign_fm_equiv: float | None = None
    elo_target: float | None = None
    # ...and where he PLAYED it. `elo_target` says how strong the side he joins is; this says how
    # strong the football behind his minutes was, which is a different sentence and the one the
    # level channel reads (`presence.level_lift`).
    elo_prev: float | None = None
    # The mean fantamedia of up to five seasons UP TO AND INCLUDING the input one, each with at least
    # `MIN_PV_PREV` votes - R18's second term. Never a season after the input one: that would be the
    # outcome wearing a feature's name.
    fm_5y: float | None = None
    fm_5y_seasons: int = 0
    # ...and the same over the MEDIA VOTO, which is what M2e shrinks for a keeper (R18-GK).
    mv_5y: float | None = None
    # The mean fantamedia of the seasons STRICTLY BEFORE the input one - what a coach had already seen of
    # him before last year. Distinct from `fm_5y`, which includes the input season and is R18's term.
    fm_career: float | None = None
    new_coach_target: bool = False        # derived at 1 August, so known on auction day
    same_role_arrivals: int = 0           # new team-mates competing for the same Classic role
    starter_prob: float | None = None
    penalty_rank: int | None = None
    penalty_confidence: float | None = None
    # QUELLO CHE HA GIÀ FATTO NELLA STAGIONE BERSAGLIO, per le sole finestre IN-SEASON: le presenze a
    # voto nelle giornate già giocate alla data d'asta. È un INPUT - a differenza di tutto il resto della
    # stagione bersaglio - perché quel giorno era pubblico: lo vede chiunque sieda al tavolo.
    # None (e non 0) su una finestra pre-stagione, dove la domanda non esiste: «vuoto = ignoto».
    pv_seen: int | None = None
    # LA COPPA CONTINENTALE che cade dentro la stagione bersaglio, per lui: la confederazione della sua
    # nazionale, se il provider lo file fra i nazionali, e la QUOTA della stagione del suo campionato che
    # sta dentro le finestre di quella coppa. Tre input legittimi il giorno dell'asta - un calendario
    # pubblicato, un passaporto e una presenza in nazionale - e zero per chiunque non sia esposto, che è
    # anche il modo in cui R21 è inerte dove nessuna coppa tocca la stagione.
    cup_conf: str | None = None
    cup_capped: bool = False
    cup_at_risk: float = 0.0
    # actual outcome - SCORING ONLY, never an input.
    # Su una finestra IN-SEASON queste tre sono le giornate DOPO la data d'asta e non il totale di
    # stagione: l'esito conterrebbe altrimenti le giornate che il modello ha appena letto, e ricopiarle
    # sembrerebbe previsione (gate §7-duotricies, «quello che è già successo non si prevede»).
    pv_act: int | None = None
    mv_act: float | None = None
    fm_act: float | None = None

    @property
    def club_change(self) -> bool:
        """An unknown previous club counts as "stayed": the module was fitted that way."""
        if not self.club_prev or not self.club_target:
            return False
        return self.club_prev != self.club_target

    @property
    def value_act(self) -> float | None:
        if self.fm_act is None or self.pv_act is None:
            return None
        return self.fm_act * self.pv_act

    def share_prev(self, matchdays: int) -> float:
        return (self.pv_prev or 0) / matchdays if matchdays else 0.0

    def age(self, window: Window) -> int | None:
        if not self.birth_year:
            return None
        return int(window.target_season.split("-")[0]) - self.birth_year

    def minutes_share_prev(self, rounds: int) -> float | None:
        """Minutes over the club's available minutes: the titolare/spezzonista separator (R3)."""
        if self.minutes_prev is None or not rounds:
            return None
        return self.minutes_prev / (90.0 * rounds)


# ---------------------------------------------------------------- loaders


def matchday_count(conn: sqlite3.Connection, platform: str, season: str) -> int:
    """Matchdays actually published for that platform/season (euro is 30-31, `default` is 38)."""
    row = conn.execute(
        "SELECT COUNT(DISTINCT matchday) FROM match_ratings WHERE season = ? AND platform = ?",
        (season, platform)).fetchone()
    return int(row[0] or 0)


def matchday_dates(conn: sqlite3.Connection, platform: str, season: str) -> dict[int, str]:
    """Quando ogni giornata di questa piattaforma è stata giocata: giornata -> ultimo giorno.

    Serve alle finestre IN-SEASON (gate §7-duotricies), cioè quelle la cui data d'asta cade dentro la
    stagione bersaglio: senza le date non si può dire quali giornate erano già state giocate quel giorno,
    e quindi nemmeno separare quello che il modello può leggere da quello che deve prevedere.

    Le due piattaforme sono due calendari e si leggono in due modi. Su `default` la giornata È il turno di
    Serie A. Su `euro` un turno impacchetta un turno REALE diverso in ognuna delle cinque leghe
    (`matchday_map`), quindi la sua data è l'ULTIMA di quelle - un turno euro è finito quando è finita
    anche la lega che gioca per ultima, e prenderne la prima direbbe «giocata» di una giornata ancora
    aperta altrove.

    Il giorno è l'ULTIMO e non il primo per la stessa ragione per cui l'unità è la partita e non la
    giornata (`CLAUDE.md`): un rinvio sposta una partita di settimane, e una giornata «giocata» a metà non
    è un fatto compiuto.
    """
    if platform == "euro":
        rows = conn.execute(
            """SELECT m.euro_md, MAX(e.match_date) FROM matchday_map m
               JOIN external_match_stats e ON e.season = m.season AND e.competition = m.league
                                          AND e.real_md = m.real_md AND e.source = 'sofascore'
               WHERE m.season = ? AND e.match_date IS NOT NULL
               GROUP BY m.euro_md""", (season,))
    else:
        rows = conn.execute(
            """SELECT real_md, MAX(match_date) FROM external_match_stats
               WHERE season = ? AND competition = 'serie_a' AND source = 'sofascore'
                 AND real_md IS NOT NULL AND match_date IS NOT NULL
               GROUP BY real_md""", (season,))
    return {int(md): date for md, date in rows if md is not None and date}


def matchdays_before(conn: sqlite3.Connection, platform: str, season: str, date: str) -> set[int]:
    """Le giornate della stagione bersaglio già giocate alla data d'asta. Vuoto = finestra pre-stagione.

    Un insieme e non un conteggio: le giornate rinviate fanno sì che «le prime k» non siano le prime k, e
    contarle basterebbe solo in un calendario che nessuno sposta.

    Il criterio è l'ULTIMA partita della giornata (`matchday_dates`), quindi una giornata è «vista» solo
    se è finita: nessuna partita giocata DOPO la data può entrare in quello che il modello legge.
    """
    return {md for md, played in matchday_dates(conn, platform, season).items() if played <= date}


def matchdays_straddling(conn: sqlite3.Connection, platform: str, season: str,
                         date: str) -> set[int]:
    """Le giornate A CAVALLO della data d'asta: cominciate prima, finite dopo.

    Sono il buco fra le due metà di una finestra in-season, e vanno tolte da TUTT'E DUE. Non stanno fra
    quelle viste - il modello non può leggere una giornata che non è finita - ma se restassero nell'ESITO
    porterebbero dentro le partite di quella giornata già giocate il giorno dell'asta, cioè un pezzo di
    risultato già noto contato come previsione. Piccolo (al più una giornata) e nella direzione che
    favorisce la regola, che è la peggiore in cui sbagliare.

    Un rinvio è la ragione per cui esistono: «l'unità è la partita, mai la giornata» (`CLAUDE.md`), e qui
    la giornata è l'unità che il voto usa - quindi quella che non si può spezzare si butta.
    """
    if platform == "euro":
        rows = conn.execute(
            """SELECT m.euro_md, MIN(e.match_date), MAX(e.match_date) FROM matchday_map m
               JOIN external_match_stats e ON e.season = m.season AND e.competition = m.league
                                          AND e.real_md = m.real_md AND e.source = 'sofascore'
               WHERE m.season = ? AND e.match_date IS NOT NULL
               GROUP BY m.euro_md""", (season,))
    else:
        rows = conn.execute(
            """SELECT real_md, MIN(match_date), MAX(match_date) FROM external_match_stats
               WHERE season = ? AND competition = 'serie_a' AND source = 'sofascore'
                 AND real_md IS NOT NULL AND match_date IS NOT NULL
               GROUP BY real_md""", (season,))
    return {int(md) for md, first, last in rows if md is not None and first and last
            and first <= date < last}


def league_rounds(conn: sqlite3.Connection, season: str) -> dict[str, int]:
    """Real rounds per league from the provider layer (34 in the Bundesliga, 38 elsewhere)."""
    return {league: int(rounds) for league, rounds in conn.execute(
        "SELECT competition, MAX(real_md) FROM external_match_stats "
        "WHERE season = ? AND competition IS NOT NULL AND real_md IS NOT NULL "
        "GROUP BY competition", (season,))}


def euro_minutes_shares(conn: sqlite3.Connection, season: str) -> dict[int, float]:
    """Minutes played IN THE ROUNDS THE EURO CALENDAR ACTUALLY USES, as a share of those rounds.

    The reason R3 (minutes over the full real season) failed on the euro platform: the target is
    appearances in a 27-31 round SUBSET of a 34-38 round league, and a player's minutes in the rounds
    the game ignores say nothing about the rounds it scores. `matchday_map` knows which real round
    each euro round bundles, per league, so the minutes can be measured on the same calendar as the
    target. Summed across competitions for players who changed league mid-season.
    """
    mapped_rounds = {league: count for league, count in conn.execute(
        "SELECT league, COUNT(*) FROM matchday_map WHERE season = ? GROUP BY league", (season,))}
    if not mapped_rounds:
        return {}
    totals: dict[int, float] = {}
    for fc_id, competition, minutes in conn.execute(
            """SELECT e.fc_id, e.competition, SUM(COALESCE(e.minutes, 0))
               FROM external_match_stats e
               JOIN matchday_map m ON m.season = e.season AND m.league = e.competition
                                  AND m.real_md = e.real_md
               WHERE e.season = ? AND e.source = 'sofascore'
               GROUP BY e.fc_id, e.competition""", (season,)):
        rounds = mapped_rounds.get(competition)
        if rounds:
            totals[fc_id] = totals.get(fc_id, 0.0) + minutes / (90.0 * rounds)
    return {fc_id: min(share, 1.0) for fc_id, share in totals.items()}


def anchors(conn: sqlite3.Connection, platform: str, seasons: tuple[str, ...], game: str,
            min_pv: int = ANCHOR_MIN_PV, min_weight: float = 3.0) -> dict[str, float]:
    """Role anchors recomputed from the DB, averaged over `seasons` (task 3.1's own procedure).

    `game='classic'` -> one anchor per P/D/C/A. `game='mantra'` -> the FRACTIONAL variant: a
    multi-role player's fantamedia counts 1/k on each of his k roles, so the thin roles are not
    dominated by whoever happens to also be listed elsewhere.

    Roles with less than `min_weight` of effective sample fall back through `ANCHOR_FALLBACK`
    (that is how 'b' borrows 'dc' until the braccetto sample matures).
    """
    per_season: dict[str, list[float]] = {}
    for season in seasons:
        rows = conn.execute(
            """SELECT r.role_classic, r.roles, ss.fm
               FROM season_stats ss
               JOIN rosters r ON r.fc_id = ss.fc_id AND r.season = ss.season
               WHERE ss.season = ? AND ss.platform = ? AND ss.pv >= ? AND ss.fm IS NOT NULL""",
            (season, platform, min_pv)).fetchall()
        totals: dict[str, list[float]] = {}
        for role_classic, roles_raw, fm in rows:
            if game == "classic":
                keys = [role_classic] if role_classic else []
                weight = 1.0
            else:
                keys = split_roles(roles_raw)
                weight = 1.0 / len(keys) if keys else 0.0
            for key in keys:
                bucket = totals.setdefault(key, [0.0, 0.0])
                bucket[0] += weight * fm
                bucket[1] += weight
        for key, (weighted_sum, weight_total) in totals.items():
            if weight_total >= min_weight:
                per_season.setdefault(key, []).append(weighted_sum / weight_total)
    out = {key: sum(values) / len(values) for key, values in per_season.items() if values}
    for role, source in ANCHOR_FALLBACK.items():
        if role not in out and source in out:
            out[role] = out[source]
    return out


# Which competitions a platform's perimeter is played in - the lineups the fielding caps are measured
# on. `euro` spans the 5 leagues, `default` is Serie A only.
PLATFORM_COMPETITIONS: dict[str, tuple[str, ...]] = {
    "euro": ("serie_a", "premier_league", "la_liga", "bundesliga", "ligue_1"),
    "default": ("serie_a",),
}
STARTERS = 11               # a starting eleven, which is what a fielding cap is a cap on
CAP_PERCENTILE = 0.9        # see `simultaneous_caps`: the median hides the roles used sparingly


def simultaneous_caps(conn: sqlite3.Connection, platform: str, seasons: tuple[str, ...],
                      percentile: float = CAP_PERCENTILE) -> dict[str, float]:
    """How many players listed at each Mantra role a side actually FIELDS at once.

    This is the constraint a Mantra module expresses - no scheme lets you field 3 'pc' or 4 'dc' - and
    it is measured rather than taken from the official module table: reconstruct every complete starting
    eleven from the stored lineups, and for each role count the starters whose listing includes it.

    Two properties make the number usable. A multi-role starter counts in EVERY role he is listed with,
    so a per-role figure is an upper bound - which is why the 90th percentile is read and not the max
    (on Serie A the max says 5 'dc', the p90 says 3, and 3 is the real cap). And the median is too low
    for the roles a league uses sparingly: 'b' has a median of 0 because most sides play a back four,
    yet a squad that ever plays a back three does roster a braccetto. Floored at 1 for that reason.

    Cross-checked against the game's own rules on the two roles they are usually quoted for: p90 gives
    dc = 3 and pc = 2, which is exactly what the modules allow.
    """
    competitions = PLATFORM_COMPETITIONS.get(platform, PLATFORM_COMPETITIONS["default"])
    rows = conn.execute(
        f"""SELECT e.match_id, e.club, r.roles
            FROM external_match_stats e
            JOIN rosters r ON r.fc_id = e.fc_id AND r.season = e.season
            WHERE e.started = 1 AND e.source = 'sofascore' AND r.roles IS NOT NULL
              AND e.season IN ({','.join('?' * len(seasons))})
              AND e.competition IN ({','.join('?' * len(competitions))})""",
        (*seasons, *competitions)).fetchall()
    lineups: dict[tuple, list[set[str]]] = {}
    for match_id, club, roles_raw in rows:
        lineups.setdefault((match_id, club), []).append(set(split_roles(roles_raw)))
    complete = [xi for xi in lineups.values() if len(xi) == STARTERS]
    if not complete:
        return {}
    out: dict[str, float] = {}
    for role in MANTRA_ROLES:
        counts = sorted(sum(1 for player in xi if role in player) for xi in complete)
        out[role] = max(1.0, float(counts[min(int(len(counts) * percentile), len(counts) - 1)]))
    return out


def _club_name_map(conn: sqlite3.Connection, season: str,
                   competitions: tuple[str, ...]) -> dict[str, str]:
    """{provider club spelling: canonical club name}, by season-level majority vote.

    The provider spells clubs its own way ("AC Milan", "SSC Napoli"); rather than import the
    matching layer, every resolved starter of a provider club votes with his roster club, over the
    whole season. A majority over hundreds of rows shrugs off January transfers, and a provider
    club with no resolved starters at all (fully outside the listone perimeter) stays unmapped -
    absent, not misassigned.
    """
    rows = conn.execute(
        f"""SELECT e.club, c.canonical_name, COUNT(*)
            FROM external_match_stats e
            JOIN rosters r ON r.fc_id = e.fc_id AND r.season = e.season
            JOIN clubs c ON c.fc_club_id = r.fc_club_id
            WHERE e.started = 1 AND e.source = 'sofascore' AND e.season = ?
              AND e.competition IN ({','.join('?' * len(competitions))})
            GROUP BY e.club, c.canonical_name""",
        (season, *competitions)).fetchall()
    votes: dict[str, dict[str, int]] = {}
    for provider, canonical, count in rows:
        votes.setdefault(provider, {})[canonical] = count
    out: dict[str, str] = {}
    for provider, ballot in votes.items():
        winner, count = max(ballot.items(), key=lambda item: item[1])
        if count * 2 > sum(ballot.values()):
            out[provider] = winner
    return out


def club_forward_caps(conn: sqlite3.Connection, platform: str,
                      season: str) -> dict[str, tuple[float, float, int]]:
    """Forwards each club actually FIELDS at once: {club: (mean, p90, elevens measured)}.

    The club's revealed shape read off its own starting elevens - a 3-5-2 side hands two forward
    slots to the listone's strikers, a 4-3-3 side one - like `simultaneous_caps` but PER CLUB and
    on the provider slot ('F'), because the listone role cannot tell the two strikers of a
    two-striker side apart (Inter 24/25 lists four 'pc'). The MEAN is the club's start-budget for
    forwards per matchday - the quantity a group of predicted shares must not exceed; the p90 is
    returned alongside for reporting only.

    Counts come from `club_match_lineups`, which is built over EVERY lineup entry rather than the
    identity-resolved ones: requiring 11 resolved starters left Juventus 24/25 with zero measurable
    elevens, because it is exactly the clubs with unquoted fringe players that never resolve in
    full. Only pre-match elevens with all 11 slot positions known are read.
    """
    competitions = PLATFORM_COMPETITIONS.get(platform, PLATFORM_COMPETITIONS["default"])
    names = _club_name_map(conn, season, competitions)
    marks = ",".join("?" * len(competitions))
    rows = conn.execute(
        f"""SELECT club, forwards
            FROM club_match_lineups
            WHERE source = 'sofascore' AND season = ? AND starters = ?
              AND goalkeepers + defenders + midfielders + forwards = ?
              AND competition IN ({marks})""",
        (season, STARTERS, STARTERS, *competitions)).fetchall()
    per_club: dict[str, list[int]] = {}
    for provider, forwards in rows:
        canonical = names.get(provider)
        if canonical is not None:
            per_club.setdefault(canonical, []).append(forwards)
    out: dict[str, tuple[float, float, int]] = {}
    for club, counts in per_club.items():
        counts.sort()
        p90 = float(counts[min(int(len(counts) * CAP_PERCENTILE), len(counts) - 1)])
        out[club] = (sum(counts) / len(counts), p90, len(counts))
    return out


def forward_co_starts(conn: sqlite3.Connection, platform: str,
                      season: str) -> dict[tuple[int, int], int]:
    """XIs in which two resolved forwards started TOGETHER: {(fc_id, fc_id) sorted: matches}.

    The pairwise companion of `club_forward_caps`: Lautaro+Thuram co-started 23 times in 24/25 (a
    genuine two-striker system), Lautaro+Taremi 3 (a backup behind him). Incomplete XIs still
    count - a missing defender says nothing about the two forwards who did start - and a pair that
    never shared a pitch (e.g. one of them arrived this summer) is simply absent, not zero.
    """
    competitions = PLATFORM_COMPETITIONS.get(platform, PLATFORM_COMPETITIONS["default"])
    rows = conn.execute(
        f"""SELECT e.match_id, e.club, e.fc_id
            FROM external_match_stats e
            WHERE e.started = 1 AND e.position = 'F' AND e.source = 'sofascore' AND e.season = ?
              AND e.competition IN ({','.join('?' * len(competitions))})""",
        (season, *competitions)).fetchall()
    forwards: dict[tuple, list[int]] = {}
    for match_id, club, fc_id in rows:
        forwards.setdefault((match_id, club), []).append(fc_id)
    out: dict[tuple[int, int], int] = {}
    for group in forwards.values():
        group.sort()
        for index, low in enumerate(group):
            for high in group[index + 1:]:
                out[(low, high)] = out.get((low, high), 0) + 1
    return out


def listings_per_player(conn: sqlite3.Connection, season: str,
                        roles: Sequence[str]) -> float:
    """Listings / distinct players over a set of Mantra roles: the multi-role inflation factor.

    A squad rule counts PLAYERS ("eight defenders"), a role pool counts LISTINGS, and a defender listed
    'dc;dd' is one of the eight but two of the listings. About 1.5 league-wide, and it has to be applied
    per group: the attacking roles overlap much more than the goalkeeping one does.
    """
    listings = players = 0
    for (roles_raw,) in conn.execute(
            "SELECT roles FROM rosters WHERE season = ? AND roles IS NOT NULL", (season,)):
        held = [role for role in split_roles(roles_raw) if role in roles]
        if held:
            players += 1
            listings += len(held)
    return listings / players if players else 1.0


def derive_mantra_slots(conn: sqlite3.Connection, platform: str, seasons: tuple[str, ...],
                        squad_slots: Mapping[str, int]) -> dict[str, float]:
    """How deep a league rosters each Mantra role, from the league's rule and the measured caps.

    Three inputs, no fitted coefficient:

    * the Classic squad rule fixes each GROUP's total ("eight defenders") - that is the real rule the
      league plays by, and it is the only thing that comes from configuration;
    * the measured fielding caps fix the SHAPE inside the group, because the group's roles are not
      interchangeable: 'dc' 3 against 'b' 1 says a defensive slot is far more likely to be a centre-back
      than a braccetto, and no proportion-of-the-pool argument can know that;
    * the group's listings-per-player converts the rule's PLAYERS into the pool's LISTINGS.

    Returns fractional slots on purpose - rounding 1.5 to 2 for four attacking roles would invent a
    quarter of a squad - and `replacement_levels` rounds once, at the rank.
    """
    caps = simultaneous_caps(conn, platform, seasons)
    if not caps:
        return {}
    latest = max(seasons)
    out: dict[str, float] = {}
    for classic, roles in MANTRA_BY_CLASSIC.items():
        total_cap = sum(caps.get(role, 0.0) for role in roles)
        if not total_cap:
            continue
        budget = squad_slots.get(classic, 0) * listings_per_player(conn, latest, roles)
        for role in roles:
            out[role] = budget * caps.get(role, 0.0) / total_cap
    return out


def replacement_levels(conn: sqlite3.Connection, platform: str, seasons: tuple[str, ...],
                       game: str, slots: Mapping[str, float], teams: int,
                       min_pv: int = ANCHOR_MIN_PV) -> dict[str, float]:
    """Fantamedia of the MARGINAL ROSTERED player at each role: the replacement level.

    Rank `teams * slots[role]` in that role's own population, sorted by fantamedia - the man you would
    have fielded instead of the one who did not play. Averaged over the same input seasons and read on
    the same Pv >= 20 domain as `anchors`, so the two are commensurable and neither peeks at the target
    season. A role whose pool is thinner than its rank uses its own last man rather than nothing.

    This is NOT a fitted parameter: `teams` and `slots` are league configuration (config/league_config
    .json). It is what turns "sum of a season's fantavoti" into "points over what the bench gives you".

    Coming out ABOVE the role anchor is expected, not a bug: the anchor is the perimeter's mean, this is
    the marginal ROSTERED player, and a league picking from 39 usable 'pc' rosters above-average
    strikers. Where the pool is thinner than its own rank ('b', and Serie A keepers) the level is that
    role's last regular - the honest answer when the league cannot roster that deep.
    """
    per_season: dict[str, list[float]] = {}
    for season in seasons:
        rows = conn.execute(
            """SELECT r.role_classic, r.roles, ss.fm
               FROM season_stats ss
               JOIN rosters r ON r.fc_id = ss.fc_id AND r.season = ss.season
               WHERE ss.season = ? AND ss.platform = ? AND ss.pv >= ? AND ss.fm IS NOT NULL""",
            (season, platform, min_pv)).fetchall()
        pools: dict[str, list[float]] = {}
        for role_classic, roles_raw, fm in rows:
            keys = [role_classic] if game == "classic" else split_roles(roles_raw)
            for key in keys:
                if key:
                    pools.setdefault(key, []).append(fm)
        for role, values in pools.items():
            # rounded ONCE, here: the slots are fractional (1.5 attacking slots over four roles is a
            # real number, 2 would invent a quarter of a squad) and the rank is the only integer needed.
            rank = round(teams * slots.get(role, 0))
            if rank < 1 or not values:
                continue
            values.sort(reverse=True)
            per_season.setdefault(role, []).append(values[min(rank, len(values)) - 1])
    out = {role: sum(values) / len(values) for role, values in per_season.items() if values}
    for role, source in ANCHOR_FALLBACK.items():
        if role not in out and source in out:
            out[role] = out[source]
    return out


def fielded_places(rulebook: Mapping, game: str) -> dict[str, float]:
    """How many places of each role an eleven FIELDS, averaged over the rulebook's own shapes.

    THE OTHER DEPTH, and the reason it exists is that «rimpiazzo» answers two different questions
    (`docs/model/metrica-asta-surplus-v1.md` §21). `roster_depth` says how many men of a role a league
    ROSTERS - 8 defenders of 10 teams, so the marginal one is the 80th - and that is the right zero for
    «who is worth buying». What a missed round actually costs is measured against the man who ENTERS,
    and he is not the 80th of the listone: with `teams x fielded places` the same rank lands on the
    40th, half a fantavoto higher (P 5.03 · D 5.81 · C 6.30 · A 6.87 against the sheet's
    4.13 / 5.66 / 5.87 / 5.61, cross-checked against a season SIMULATION that agrees to the second
    decimal - `docs/model/letture-app-v1.md` §4-bis).

    Not a fitted number and not a chosen one: it is the GAME's own rulebook, counted. The classic file's
    seven modules give exactly P 1 · D 4 · C 4 · A 2, the eleven Mantra schemes give the twelve codes,
    and both sum to eleven - which is the same transcription check the two files carry.

    Two conventions, declared because they are conventions:

    * a HYBRID place is split evenly among the roles it accepts ('W/A' is half a `w` and half an `a`).
      The rulebook says the place takes either, so anything else would be a claim about which of the two
      a coach picks - a measurement, and this file is not measuring.
    * no listings inflation, unlike `derive_mantra_slots`. That factor exists to convert a rule stated
      in PLAYERS ("eight defenders") into the pool's LISTINGS; a typed Mantra place is already a place
      for one listing of that role, so converting it again would count the same thing twice.
    """
    shapes = rulebook.get("modules") or {}
    slot_roles = rulebook.get("slot_roles") or {}
    if not shapes or not slot_roles:
        return {}

    def key(role: str) -> str:
        return role.lower() if game == "mantra" else role.upper()

    total: dict[str, float] = {}
    for lines in shapes.values():
        for slots in lines.values():
            for slot in slots:
                accepted = slot_roles.get(slot) or ()
                for role in accepted:
                    total[key(role)] = total.get(key(role), 0.0) + 1.0 / len(accepted)
    # The keeper is implicit in both files - the shapes are the four lines BEYOND him - and he is the
    # same single place in every one of them.
    for role in slot_roles.get("P") or ():
        total[key(role)] = total.get(key(role), 0.0) + len(shapes)
    return {role: places / len(shapes) for role, places in total.items()}


def goalkeeper_club_rates(conn: sqlite3.Connection, platform: str,
                          season: str) -> tuple[dict[str, float], float]:
    """{club: goals conceded per game} from its keepers, plus the population mean (M2e's mu_rate)."""
    rows = conn.execute(
        """SELECT c.canonical_name, SUM(ss.goals_conceded), SUM(ss.pv)
           FROM season_stats ss
           JOIN rosters r ON r.fc_id = ss.fc_id AND r.season = ss.season
           JOIN clubs c ON c.fc_club_id = r.fc_club_id
           WHERE ss.season = ? AND ss.platform = ? AND r.role_classic = 'P' AND ss.pv > 0
           GROUP BY 1""", (season, platform)).fetchall()
    rates = {club: conceded / appearances for club, conceded, appearances in rows
             if appearances and conceded is not None}
    mean = sum(rates.values()) / len(rates) if rates else 1.3
    return rates, mean


def _external(conn: sqlite3.Connection, season: str) -> dict[int, tuple]:
    """Input-season provider aggregates: the per-match layer OR the season aggregates, whichever has
    more evidence for that player.

    Both sources are incomplete in different ways. The per-match layer resolves identity through
    `player_xref`, which is season-agnostic, so it reaches players who were outside the fc listone that
    season - the population R1 exists for (Ezzalzouli: 33 matches in the layer, no aggregate row at
    all). But it is only complete where `positions --layer complete` has run: before that pass a
    non-perimeter club had 18 of its 38 matches, and nothing in the schema records whether a
    league-season was completed. Preferring it unconditionally would therefore HALVE the minutes of a
    whole population wherever the pass has not run.

    So the choice is per player and by evidence: more matches wins. Where the layer is complete it has
    at least as many as the aggregate; where it is not, the aggregate does.

    Ratings use AVG, which ignores NULLs. Dividing SUM(COALESCE(rating, 0)) by COUNT(*) counted an
    unrated cameo as a 0.0 - four of them among thirty matches pulled a 7.0 average down to 6.18.
    """
    out: dict[int, tuple] = {}
    for fc_id, matches, starts, minutes, goals, assists, xg, xa, rating in conn.execute(
            """SELECT fc_id, COUNT(*), SUM(COALESCE(started, 0)), SUM(COALESCE(minutes, 0)),
                      SUM(COALESCE(goals, 0)), SUM(COALESCE(assists, 0)), SUM(COALESCE(xg, 0)),
                      SUM(COALESCE(xa, 0)), AVG(rating)
               FROM external_match_stats
               WHERE season = ? AND source = 'sofascore' AND COALESCE(minutes, 0) > 0
               GROUP BY fc_id""", (season,)):
        out[fc_id] = (matches, starts, minutes, goals, assists, xg, xa, rating)

    for fc_id, matches, starts, minutes, goals, assists, xg, xa, rating_weighted in conn.execute(
            """SELECT fc_id, SUM(COALESCE(matches, 0)), SUM(COALESCE(starts, 0)),
                      SUM(COALESCE(minutes, 0)), SUM(COALESCE(goals, 0)), SUM(COALESCE(assists, 0)),
                      SUM(COALESCE(xg, 0)), SUM(COALESCE(xa, 0)),
                      SUM(COALESCE(rating, 0) * COALESCE(matches, 0))
               FROM external_stats WHERE season = ? AND source = 'sofascore' GROUP BY fc_id""",
            (season,)):
        existing = out.get(fc_id)
        if existing is None or (matches or 0) > (existing[0] or 0):
            out[fc_id] = (matches, starts, minutes, goals, assists, xg, xa,
                          (rating_weighted / matches) if matches else None)
    return out


def _recent_form(conn: sqlite3.Connection, window: Window) -> dict[int, dict]:
    """The last matches of players with no history, from `recent_form`, STRICTLY before the auction.

    A separate source on purpose (`sofascore_recent`): these matches are in competitions the synthetic
    voto was never calibrated on, so their rating is a rating and not a base voto. What the engine gets
    is a small, honest sample - how many matches, how many minutes, what the provider thought of him -
    for players it would otherwise price on a role anchor alone.

    Bounded on BOTH sides, and the floor matters as much as the ceiling: the rows are scraped once and
    serve every window, so without it T2 would aggregate T1's matches too and the same feature would
    mean "one season" in one window and "two seasons" in the other - exactly the cross-window
    comparability the gate rests on. The floor is the input season's July.

    The ceiling is what makes the rows legal in a backtest at all: the scraper is anchored to today,
    the engine only ever looks at what predated that window's auction.

    Goals and assists are None when NOT ONE row of the sample carries them, never 0. The bonuses cost
    one request per match and are stored separately from the match, so most of this population has rows
    with NULL goals - and summing those with COALESCE(...,0) turned "we never measured it" into "he
    scored nothing", which is a fabricated measurement, not a conservative one. Lauriente' came out with
    0 goals and 0 assists in 715 minutes; he was a Serie B top scorer. `bonus_matches` says how much of
    the sample is actually measured, and no rule may read the totals without checking it.
    """
    floor = f"{window.input_season.split('-')[0]}-07-01"
    return {fc_id: {"matches": matches, "minutes": minutes,
                    "goals": goals if bonus_matches else None,
                    "assists": assists if bonus_matches else None,
                    "bonus_matches": bonus_matches,
                    "rating": rating, "first": first, "last": last}
            for (fc_id, matches, minutes, goals, assists, bonus_matches, rating, first,
                 last) in conn.execute(
                """SELECT fc_id, COUNT(*), SUM(COALESCE(minutes, 0)), SUM(COALESCE(goals, 0)),
                          SUM(COALESCE(assists, 0)), SUM(goals IS NOT NULL),
                          AVG(rating), MIN(match_date), MAX(match_date)
                   FROM external_match_stats
                   WHERE source = 'sofascore_recent' AND match_date >= ? AND match_date < ?
                     AND COALESCE(minutes, 0) > 0
                   GROUP BY fc_id""", (floor, window.auction_date))}


ATTACKING_ROLES: frozenset[str] = frozenset({"C", "A"})   # who competes for a club's goal budget


def _attack_budget(conn: sqlite3.Connection, window: Window,
                   platform: str) -> tuple[dict[str, float], dict[int, float],
                                              dict[str, float]]:
    """R16: a club's goals are a BUDGET, and its attackers share it.

    Returns {club: goals per match last season} and {fc_id: his share of his TARGET club's attacking
    production}. Both legal on auction day: the goals are the input season's, the squad is the target
    listone's, which is published before the auction.

    The hole this addresses, in one case: Fiorentina scored 57 goals in 2024-25, sixth in Serie A and
    level with Lazio and Milan. The engine had Kean 1st and Piccoli 4th among the forwards - both of
    them, because it regresses each one to the role anchor as if they played for different clubs.
    Between them, with Solomon, they scored 12. The share is measured on goals PLUS assists, because a
    team-mate who sets up the goals is claiming the same budget from the other end.
    """
    expected_per_match: dict[str, float] = {}
    for club, xa, xg, minutes in conn.execute(
            """SELECT c.canonical_name, SUM(e.xa), SUM(e.xg), SUM(COALESCE(e.minutes, 0))
               FROM external_stats e
               JOIN rosters r ON r.fc_id = e.fc_id AND r.season = e.season
               JOIN clubs c ON c.fc_club_id = r.fc_club_id
               WHERE e.season = ? AND e.xa IS NOT NULL
               GROUP BY c.canonical_name""", (window.input_season,)):
        if club and minutes:
            # per eleven players' worth of minutes, so a club is comparable whatever its calendar
            expected_per_match[club] = (xa or 0.0) * 11.0 * 90.0 / minutes

    goals_per_match: dict[str, float] = {}
    for club, goals, appearances in conn.execute(
            """SELECT c.canonical_name, SUM(COALESCE(ss.goals, 0)), SUM(COALESCE(ss.pv, 0))
               FROM season_stats ss
               JOIN rosters r ON r.fc_id = ss.fc_id AND r.season = ss.season
               JOIN clubs c ON c.fc_club_id = r.fc_club_id
               WHERE ss.season = ? AND ss.platform = ?
               GROUP BY c.canonical_name""", (window.input_season, platform)):
        if club and appearances:
            # per ELEVEN outfield appearances, so a club is comparable whatever its calendar length
            goals_per_match[club] = goals * 11.0 / appearances

    produced: dict[int, float] = {}
    by_club: dict[str, float] = {}
    for fc_id, club, role, goals, assists in conn.execute(
            """SELECT r.fc_id, c.canonical_name, r.role_classic,
                      COALESCE(ss.goals, 0), COALESCE(ss.assists, 0)
               FROM rosters r
               JOIN clubs c ON c.fc_club_id = r.fc_club_id
               LEFT JOIN season_stats ss ON ss.fc_id = r.fc_id AND ss.season = ?
                    AND ss.platform = ?
               WHERE r.season = ?""",
            (window.input_season, platform, window.target_season)):
        if club and role in ATTACKING_ROLES:
            produced[fc_id] = goals + assists
            by_club[club] = by_club.get(club, 0.0) + goals + assists
    shares: dict[int, float] = {}
    for fc_id, club, in_club in conn.execute(
            """SELECT r.fc_id, c.canonical_name, 1 FROM rosters r
               JOIN clubs c ON c.fc_club_id = r.fc_club_id WHERE r.season = ?""",
            (window.target_season,)):
        total = by_club.get(club or "", 0.0)
        if fc_id in produced and total > 0 and in_club:
            shares[fc_id] = produced[fc_id] / total
    return goals_per_match, shares, expected_per_match


# Below this, a played/missed sequence has no structure to measure - both conditional probabilities
# would rest on a couple of observations each.
MIN_SEQUENCE = 8


def availability_persistence(conn: sqlite3.Connection, platform: str, season: str,
                             min_sequence: int = MIN_SEQUENCE) -> dict[int, float]:
    """P(plays matchday k | played k-1) - P(plays k | missed k-1), per player, for one season.

    The difference between HOW MUCH a player was available and how PREDICTABLE that availability was.
    You set a lineup before knowing whether he plays, so what you collect is the appearances you could
    see coming - and measured on the population it is a real effect: persistence averages 0.29-0.36 on
    every platform-season, never near zero, and the share of his own appearances a naive "field him if
    he played last week" rule catches runs from 0.40 in the under-20% band to 0.89 in the over-80% one.

    Read on the platform's OWN calendar (`match_ratings`), inside a single season - the same discipline
    `_inactivity` needs: pooling seasons would make the regressor's distribution depend on how many
    seasons a window happens to have behind it. Players with both conditional probabilities defined
    only, so a man who played every single matchday returns None rather than a fabricated 0.
    """
    matchdays = [md for (md,) in conn.execute(
        "SELECT DISTINCT matchday FROM match_ratings WHERE season = ? AND platform = ? "
        "ORDER BY matchday", (season, platform))]
    if len(matchdays) < min_sequence:
        return {}
    played: dict[int, set[int]] = {}
    for fc_id, matchday in conn.execute(
            "SELECT fc_id, matchday FROM match_ratings WHERE season = ? AND platform = ? "
            "AND mv IS NOT NULL", (season, platform)):
        played.setdefault(fc_id, set()).add(matchday)
    out: dict[int, float] = {}
    for fc_id, days in played.items():
        after_played = after_missed = n_played = n_missed = 0
        for previous, current in pairwise(matchdays):
            if previous in days:
                n_played += 1
                after_played += current in days
            else:
                n_missed += 1
                after_missed += current in days
        if n_played and n_missed:
            out[fc_id] = after_played / n_played - after_missed / n_missed
    return out


def _inactivity(conn: sqlite3.Connection, window: Window) -> dict[int, dict]:
    """How long a player went without playing, from the dated per-match layer. The injury proxy.

    The per-match layer already says when a player did NOT appear: a gap of 90+ days inside a season is
    a spell out, whatever its cause. `injuries` now carries the real absences (dated, with the matches
    actually missed), which makes "proxy vs fact" a testable question - and therefore a PRE-REGISTERED
    one. Until that gate runs, this is what the adopted set uses, and it is what the published numbers
    were produced with. Measured on
    both providers' rows (the 5 leagues and `recent_form`), always before the auction date.

    Restricted to the INPUT SEASON, not to everything before the auction: pooling seasons makes the
    maximum a max over twice as many gaps in T2 as in T1, so the regressor's distribution would differ
    by window by construction and a coefficient fitted on one window would be applied to a shifted one
    on the other.

    Gaps that straddle 1 July are DISCARDED too, and that correction is the whole difference between a
    signal and noise: measured across the close season, "longest gap" ranked 520 players in the
    over-90-days band and the relationship with next season's appearances inverted. Measured inside a
    season it is monotone on both windows - over 90 days out means about 13 appearances the year after
    against 18 for a normal 21-45 day gap.
    """
    import datetime

    floor = f"{window.input_season.split('-')[0]}-07-01"
    # `source <> 'sofascore_extra'`: the friendlies and cup ties that layer brings in are descriptive,
    # and a pre-season friendly inside a gap would erase exactly the gap this measures. `sofascore_recent`
    # stays IN - a match in another championship is still a match he played.
    rows = conn.execute(
        """SELECT fc_id, match_date, COALESCE(minutes, 0) FROM external_match_stats
           WHERE match_date IS NOT NULL AND match_date >= ? AND match_date < ?
             AND COALESCE(minutes, 0) > 0 AND source <> 'sofascore_extra'
           ORDER BY fc_id, match_date""", (floor, window.auction_date)).fetchall()
    auction = datetime.date.fromisoformat(window.auction_date)
    played: dict[int, list] = {}
    for fc_id, date, minutes in rows:
        played.setdefault(fc_id, []).append((datetime.date.fromisoformat(date), minutes))

    def crosses_july(start: datetime.date, end: datetime.date) -> bool:
        for year in range(start.year, end.year + 1):
            if start < datetime.date(year, 7, 1) <= end:
                return True
        return False

    out: dict[int, dict] = {}
    for fc_id, appearances in played.items():
        if len(appearances) < 3:
            continue
        dates = [date for date, _minutes in appearances]
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)
                if not crosses_july(dates[i], dates[i + 1])]
        out[fc_id] = {
            "longest_gap": max(gaps) if gaps else 0,
            # to the auction it is always at least a close season, so this reads as "did he finish
            # the season playing" rather than as an absolute
            "days_since_last": (auction - dates[-1]).days,
            "minutes_last_3": sum(minutes for _date, minutes in appearances[-3:]) / 3,
        }
    return out


def _span_days(first: str | None, last: str | None) -> int | None:
    if not first or not last:
        return None
    import datetime
    return (datetime.date.fromisoformat(last) - datetime.date.fromisoformat(first)).days


def _probable_starters(conn: sqlite3.Connection, auction_date: str,
                       season: str | None = None) -> dict[int, float]:
    """Auction-day view of a dated series: the last row with valid_from <= the auction date.

    `season` is the season being predicted, and it is a FILTER and not a label: the page states which
    season its line-ups belong to, and a reading taken today can describe the one that just ended (see
    `probable_starter.season`). A row that does not say which season it is about is not read at all -
    same rule as every other unknown here.
    """
    out: dict[int, float] = {}
    for fc_id, probability in conn.execute(
            "SELECT fc_id, probability FROM probable_starter WHERE valid_from <= ? "
            + ("AND season = ? " if season else "")
            + "ORDER BY valid_from", (auction_date, season) if season else (auction_date,)):
        out[fc_id] = probability
    return out


def _penalty_state(conn: sqlite3.Connection, auction_date: str) -> dict[int, tuple]:
    out: dict[int, tuple] = {}
    for fc_id, rank, confidence in conn.execute(
            "SELECT fc_id, rank, confidence FROM penalty_hierarchy WHERE valid_from <= ? "
            "ORDER BY valid_from", (auction_date,)):
        out[fc_id] = (rank, confidence)
    return out


# The row set of a window is normally the TARGET LISTONE: a player is in it because he is quoted.
# `squad_source='real'` swaps that for the REAL squads (`squad_snapshot`, observed at a date), which is
# what an auction prepared BEFORE the listone comes out has to work from. Off by default, so every
# published gate number keeps the population it was produced on - a test asserts it.
# The QUOTATIONS come from `listone_quotes` and not from `rosters`: there are two listoni, they disagree
# on 202 Qt.I and 226 FVM for the players quoted in both, and `rosters` keeps whichever was downloaded
# last (schema.sql). The row SET still comes from `rosters` - who is quoted at all - so no published gate
# number changes population; what changes is that the price on a euro window is the EuroLeghe price.
_TARGET_FROM_LISTONE = """
    SELECT r.fc_id, r.role_classic, r.roles, r.league, q.price, r.fc_club_id,
           q.price_initial, q.fvm, q.fvm_mantra, q.price_mantra, q.price_initial_mantra
    FROM rosters r
    LEFT JOIN listone_quotes q ON q.fc_id = r.fc_id AND q.season = r.season
                             AND q.platform = :platform
    WHERE r.season = :target
"""
# The real squad, with what the listone would have supplied taken from the player's LAST known listone
# row (his role travels with him; his price does not - there is no quotation yet, and inventing one
# would be the very look-ahead the whole project is built to avoid).
# ...e il TERZO modo, `squad_source='squad'`, che è la regola dell'operatore del 17/08/2026 portata alle sue
# conseguenze: «l'autorità di chi è in rosa è sofascore» e «quando fai lo snapshot devi vedere tutti i
# calciatori in rosa a prescindere se è quotato o meno nel listone». Quindi qui il CLUB e il CAMPIONATO
# vengono dalla rosa osservata e non dal listone, e le quotazioni dal listone se c'è: Molina è quotato
# all'Atlético su EuroLeghe e la fonte lo vede alla Roma dal 14/08, quindi va sul foglio Serie A (dove il
# listone non lo porta affatto) e su quello euro con il suo prezzo, in tutt'e due i casi alla ROMA.
# Chi la fonte non ha mai visto tiene il club del listone - ignoto non è partito - ed è il secondo ramo.
# Il gate non lo usa: il suo default resta `listone` e un test lo asserisce, quindi nessun numero pubblicato
# cambia popolazione.
_TARGET_FROM_AUTHORITY = """
    SELECT s.fc_id,
           COALESCE(rt.role_classic,
                    (SELECT r2.role_classic FROM rosters r2 WHERE r2.fc_id = s.fc_id
                      AND r2.role_classic IS NOT NULL ORDER BY r2.season DESC LIMIT 1)) AS role_classic,
           COALESCE(rt.roles,
                    (SELECT r3.roles FROM rosters r3 WHERE r3.fc_id = s.fc_id
                      AND r3.roles IS NOT NULL ORDER BY r3.season DESC LIMIT 1)) AS roles,
           (SELECT c2.league FROM clubs c2 WHERE c2.canonical_name = s.club) AS league,
           q.price, (SELECT c3.fc_club_id FROM clubs c3 WHERE c3.canonical_name = s.club) AS fc_club_id,
           q.price_initial, q.fvm, q.fvm_mantra, q.price_mantra, q.price_initial_mantra
    FROM (SELECT fc_id, club, MAX(valid_from) FROM squad_snapshot
          WHERE valid_from <= :auction AND source = 'sofascore' GROUP BY fc_id) s
    LEFT JOIN rosters rt ON rt.fc_id = s.fc_id AND rt.season = :target
    LEFT JOIN listone_quotes q ON q.fc_id = s.fc_id AND q.season = :target AND q.platform = :platform
    WHERE s.club IN (SELECT DISTINCT team FROM match_ratings
                     WHERE platform = :platform AND team IS NOT NULL)
    UNION ALL
    -- ...e i quotati che la fonte non ha mai visto: tengono il club del listone, perché un uomo che il
    -- provider non riesce a identificare non è un uomo senza squadra (`observed_players`, la stessa regola).
    SELECT r.fc_id, r.role_classic, r.roles, r.league, q.price, r.fc_club_id,
           q.price_initial, q.fvm, q.fvm_mantra, q.price_mantra, q.price_initial_mantra
    FROM rosters r
    LEFT JOIN listone_quotes q ON q.fc_id = r.fc_id AND q.season = r.season AND q.platform = :platform
    WHERE r.season = :target
      AND r.fc_id NOT IN (SELECT fc_id FROM squad_snapshot WHERE source = 'sofascore'
                          AND valid_from <= :auction)
"""


_TARGET_FROM_SQUAD = """
    SELECT s.fc_id,
           (SELECT r2.role_classic FROM rosters r2 WHERE r2.fc_id = s.fc_id AND r2.role_classic IS NOT NULL
             ORDER BY r2.season DESC LIMIT 1) AS role_classic,
           (SELECT r3.roles FROM rosters r3 WHERE r3.fc_id = s.fc_id AND r3.roles IS NOT NULL
             ORDER BY r3.season DESC LIMIT 1) AS roles,
           (SELECT c2.league FROM clubs c2 WHERE c2.canonical_name = s.club) AS league,
           NULL AS price,
           (SELECT c3.fc_club_id FROM clubs c3 WHERE c3.canonical_name = s.club) AS fc_club_id,
           NULL AS price_initial, NULL AS fvm, NULL AS fvm_mantra,
           NULL AS price_mantra, NULL AS price_initial_mantra
    FROM (SELECT fc_id, club, MAX(valid_from) FROM squad_snapshot
          WHERE valid_from <= :auction GROUP BY fc_id) s
    WHERE s.fc_id NOT IN (SELECT fc_id FROM rosters WHERE season = :target)
      -- and only a club THIS PLATFORM plays: EuroLeghe carries the top clubs, so adding a Verona or a
      -- Cagliari squad to a euro sheet lists players nobody in that league can buy. The platform's own
      -- ratings are the definition of its perimeter.
      AND s.club IN (SELECT DISTINCT team FROM match_ratings
                     WHERE platform = :platform AND team IS NOT NULL)
"""


def load(conn: sqlite3.Connection, window: Window, platform: str,
         squad_source: str = "listone") -> list[Observation]:
    """All observations of a window. `platform='default'` is the Serie A game (Serie A players only).

    `squad_source='real'` adds the players who are in a club's real squad but not (yet) in the target
    listone: their role comes from their last listone row and their price is NULL, which is exactly
    what R0c already handles. Used by the auction snapshot before a listone exists.
    """
    league_filter = " AND r.league = 'serie_a'" if platform == "default" else ""
    target = _TARGET_FROM_LISTONE
    if squad_source == "real":
        target = f"{_TARGET_FROM_LISTONE} UNION ALL {_TARGET_FROM_SQUAD}"
    elif squad_source == "squad":
        # L'autorità decide il club: vedi `_TARGET_FROM_AUTHORITY`. Il filtro per campionato di `default`
        # lavora poi sul campionato del club OSSERVATO, che è il punto - Molina legge `serie_a` perché la
        # fonte lo vede alla Roma, mentre la sua riga di listone dice ancora `la_liga`.
        target = _TARGET_FROM_AUTHORITY
    elif squad_source != "listone":
        raise ValueError(f"unknown squad_source {squad_source!r}; choose listone|real|squad")
    rows = conn.execute(
        f"""WITH r AS ({target})
            SELECT r.fc_id, p.canonical_name, r.role_classic, r.roles, r.league, r.price,
                   ct.canonical_name, cp.canonical_name, p.birth_year,
                   sp.pv, sp.mv, sp.fm, st.pv, st.mv, st.fm,
                   r.price_initial, qp.price_initial, r.fvm, r.fvm_mantra,
                   r.price_mantra, r.price_initial_mantra
            FROM r
            JOIN players p ON p.fc_id = r.fc_id
            LEFT JOIN clubs ct ON ct.fc_club_id = r.fc_club_id
            LEFT JOIN rosters rp ON rp.fc_id = r.fc_id AND rp.season = :input
            -- last season's Qt.I (R12b, the expectation REVISION) from the same platform's listone: a
            -- revision measured between two currencies would be an exchange rate, not a revision
            LEFT JOIN listone_quotes qp ON qp.fc_id = r.fc_id AND qp.season = :input
                                       AND qp.platform = :platform
            LEFT JOIN clubs cp ON cp.fc_club_id = rp.fc_club_id
            LEFT JOIN season_stats sp ON sp.fc_id = r.fc_id AND sp.season = :input
                                     AND sp.platform = :platform
            LEFT JOIN season_stats st ON st.fc_id = r.fc_id AND st.season = :target
                                     AND st.platform = :platform
            WHERE 1 = 1{league_filter}""",
        {"input": window.input_season, "target": window.target_season, "platform": platform,
         "auction": window.auction_date}).fetchall()

    external = _external(conn, window.input_season)
    # ...of THIS platform: the tier is a percentile inside a listone (schema.sql, `arrivals`).
    arrivals = {fc_id: (kind, tier, origin, equivalent) for fc_id, kind, tier, origin, equivalent
                in conn.execute("SELECT fc_id, type, tier, origin_league, foreign_fm_equiv "
                                "FROM arrivals WHERE season = ? AND platform = ?",
                                (window.target_season, platform))}
    elo_date = conn.execute("SELECT MAX(date) FROM club_elo WHERE date <= ?",
                            (window.auction_date,)).fetchone()[0]
    elo = {club: value for club, value in conn.execute(
        "SELECT c.canonical_name, e.elo FROM club_elo e JOIN clubs c USING(fc_club_id) "
        "WHERE e.date = ?", (elo_date,))} if elo_date else {}
    # ...and, for a club `club_elo` cannot hold at all, the level from `club_levels` - every club ClubElo
    # publishes rather than the ~97 that a listone carries. Strictly a FILL: where `club_elo` has a value
    # it wins, so no published number changes on a club we already priced, and the two agree by
    # construction (same series, `club_elo` at the auction DATE and this at the year).
    # Measured before wiring it, because the todolist called this the binding constraint and it is not:
    # per window it recovers 4, 1, 0, 0, 0, 0 origin clubs. The limit is `club_prev`, which comes from the
    # PREVIOUS LISTONE - a man arriving from Salzburg has no previous club here at all, so no Elo table can
    # see him. Widening the table is right and cheap; the coverage it buys the GATE is nearly nil, and
    # saying so is the point of having measured it.
    for name, value in conn.execute(
            """SELECT c.canonical_name, l.elo FROM club_levels l JOIN clubs c USING(fc_club_id)
               WHERE l.year = ? AND l.fc_club_id IS NOT NULL AND c.canonical_name IS NOT NULL""",
            (window.input_season.split("-")[0],)):
        elo.setdefault(name, value)
    off_role = {fc_id for (fc_id,) in conn.execute(
        "SELECT fc_id FROM flags WHERE season = ? AND flag = 'off_role_usage'",
        (window.input_season,))}
    derived = {fc_id: role for fc_id, role in conn.execute(
        "SELECT fc_id, derived_role FROM positions WHERE season = ?", (window.input_season,))}
    recent = _recent_form(conn, window)
    inactivity = _inactivity(conn, window)
    persistence = availability_persistence(conn, platform, window.input_season)
    starters = _probable_starters(conn, window.auction_date, window.target_season)
    penalties = _penalty_state(conn, window.auction_date)
    euro_minutes = euro_minutes_shares(conn, window.input_season)
    # new_coach is a TARGET-season flag and still auction-safe: `transfers.derive_new_coach` compares
    # who was in charge on 1 August with a year earlier, so a mid-season sacking only surfaces on the
    # following season - which is when it becomes priceable anyway.
    new_coach = {fc_id for (fc_id,) in conn.execute(
        "SELECT fc_id FROM flags WHERE season = ? AND flag = 'new_coach'", (window.target_season,))}
    # Positional competition, straight from the target listone: how many players are NEW at this club
    # in this role. The listone is published before the auction, and `arrivals` is a roster diff.
    competition: dict[tuple[str, str], int] = {}
    arrived: set[int] = set()
    for fc_id, club, role in conn.execute(
            """SELECT a.fc_id, c.canonical_name, r.role_classic
               FROM arrivals a
               JOIN rosters r ON r.fc_id = a.fc_id AND r.season = a.season
               LEFT JOIN clubs c ON c.fc_club_id = r.fc_club_id
               WHERE a.season = ? AND a.platform = ?""", (window.target_season, platform)):
        if club and role:
            competition[(club, role)] = competition.get((club, role), 0) + 1
            arrived.add(fc_id)

    goal_budget, attack_share, club_expected = _attack_budget(conn, window, platform)

    # R18's second term: the mean fantamedia of up to five seasons UP TO AND INCLUDING the input one, each
    # with a full set of votes, whichever platform measured it best. Bounded at the input season on purpose
    # - a season after it is the outcome, and a feature that reads the outcome is not a feature.
    history: dict[int, list[tuple[str, int, float]]] = {}
    for fc_id, season, pv, fm, mv in conn.execute(
            "SELECT fc_id, season, pv, fm, mv FROM season_stats "
            "WHERE fm IS NOT NULL AND pv >= ? AND season <= ?",
            (MIN_PV_PREV, window.input_season)):
        history.setdefault(fc_id, []).append((season, pv, fm, mv))
    fm_history: dict[int, tuple[float, int, float | None]] = {}
    fm_seasons: dict[int, tuple[float, ...]] = {}
    mv_seasons: dict[int, tuple[float, ...]] = {}
    career: dict[int, float | None] = {}
    for fc_id, seen in history.items():
        best: dict[str, tuple[int, float, float | None]] = {}
        for season, pv, fm, mv in seen:
            if season not in best or pv > best[season][0]:
                best[season] = (pv, fm, mv)
        earlier = [best[s][1] for s in sorted(best) if s < window.input_season][-5:]
        career[fc_id] = (sum(earlier) / len(earlier)) if earlier else None
        chosen = sorted(best)[-5:]
        recent_five = [best[season][1] for season in chosen]
        votes = [best[season][2] for season in chosen if best[season][2] is not None]
        if recent_five:
            fm_history[fc_id] = (sum(recent_five) / len(recent_five), len(recent_five),
                                 (sum(votes) / len(votes)) if votes else None)
        # Reversed: index 0 is the most recent season, which is what a decay is written against.
        fm_seasons[fc_id] = tuple(reversed(recent_five))
        mv_seasons[fc_id] = tuple(
            reversed([best[season][2] for season in chosen if best[season][2] is not None]))

    # LA FINESTRA IN-SEASON, se lo è: quali giornate della stagione bersaglio erano già giocate il giorno
    # dell'asta. Vuoto per tutte e dieci le finestre pubblicate (data d'asta al 15 agosto), quindi qui
    # sotto non cambia un decimale di niente - `backtest --verify` resta 22/22.
    seen_rounds = matchdays_before(conn, platform, window.target_season, window.auction_date)
    # ...e la giornata A CAVALLO della data, che non appartiene a nessuna delle due metà.
    straddling = matchdays_straddling(conn, platform, window.target_season, window.auction_date)
    seen_totals, rest_totals = _split_target_season(conn, window, platform, seen_rounds, straddling)

    observations: list[Observation] = []
    for (fc_id, name, role_classic, roles_raw, league, price, club_target, club_prev, birth_year,
         pv_prev, mv_prev, fm_prev, pv_act, mv_act, fm_act,
         price_initial, price_initial_prev, fvm, fvm_mantra,
         price_mantra, price_initial_mantra) in rows:
        matches, starts, minutes, goals, assists, xg, xa, rating = external.get(fc_id, (None,) * 8)
        kind, tier, origin, equivalent = arrivals.get(fc_id, (None, None, None, None))
        sample = recent.get(fc_id) or {}
        idle = inactivity.get(fc_id) or {}
        rank, confidence = penalties.get(fc_id, (None, None))
        observations.append(Observation(
            fc_id=fc_id, name=name, role_classic=role_classic,
            roles_mantra=tuple(split_roles(roles_raw)), league=league, price=price,
            club_prev=club_prev, club_target=club_target,
            pv_prev=pv_prev, mv_prev=mv_prev, fm_prev=fm_prev,
            fm_5y=(fm_history.get(fc_id) or (None, 0, None))[0],
            fm_5y_seasons=(fm_history.get(fc_id) or (None, 0, None))[1],
            mv_5y=(fm_history.get(fc_id) or (None, 0, None))[2],
            fm_career=career.get(fc_id),
            fm_seasons=fm_seasons.get(fc_id, ()),
            mv_seasons=mv_seasons.get(fc_id, ()),
            minutes_prev=minutes, starts_prev=starts, matches_prev=matches,
            goals_prev=goals, assists_prev=assists, xg_prev=xg, xa_prev=xa, rating_prev=rating,
            minutes_share_euro_prev=euro_minutes.get(fc_id),
            price_initial=price_initial, price_initial_prev=price_initial_prev,
            fvm=fvm, fvm_mantra=fvm_mantra,
            price_mantra=price_mantra, price_initial_mantra=price_initial_mantra,
            recent_matches=sample.get("matches", 0), recent_minutes=sample.get("minutes", 0),
            recent_goals=sample.get("goals"), recent_assists=sample.get("assists"),
            recent_bonus_matches=sample.get("bonus_matches", 0) or 0,
            recent_rating=sample.get("rating"),
            recent_span_days=_span_days(sample.get("first"), sample.get("last")),
            persistence_prev=persistence.get(fc_id),
            club_goals_prev=goal_budget.get(club_target or ""),
            club_expected_assists_prev=club_expected.get(club_target or ""),
            attack_share_target=attack_share.get(fc_id),
            longest_gap_days=idle.get("longest_gap"),
            days_since_last_match=idle.get("days_since_last"),
            minutes_last_3=idle.get("minutes_last_3"),
            birth_year=birth_year, derived_role_prev=derived.get(fc_id),
            off_role_prev=fc_id in off_role,
            arrival_type=kind, arrival_tier=tier, origin_league=origin,
            foreign_fm_equiv=equivalent, elo_target=elo.get(club_target or ""),
            elo_prev=elo.get(club_prev or ""),
            new_coach_target=fc_id in new_coach,
            # a player who arrived himself is not his own competition
            same_role_arrivals=max(0, competition.get((club_target or "", role_classic or ""), 0)
                                   - (1 if fc_id in arrived else 0)),
            starter_prob=starters.get(fc_id), penalty_rank=rank, penalty_confidence=confidence,
            pv_seen=seen_totals.get(fc_id, 0 if seen_rounds else None),
            # Su una finestra in-season l'esito è il RESTO della stagione; su una pre-stagione resta il
            # totale, che è quello che i dieci numeri pubblicati misurano.
            **(dict(zip(("pv_act", "mv_act", "fm_act"),
                        rest_totals.get(fc_id, (0, None, None)), strict=True)) if seen_rounds
               else {"pv_act": pv_act, "mv_act": mv_act, "fm_act": fm_act})))
    return observations


def _split_target_season(conn: sqlite3.Connection, window: Window, platform: str,
                         seen: set[int],
                         straddling: set[int] | None = None) -> tuple[dict[int, int], dict[int, tuple]]:
    """Le presenze della stagione bersaglio spezzate dalla data d'asta: (viste, resto).

    Serve solo alle finestre IN-SEASON e su una pre-stagione non fa nemmeno la query. Il resto porta
    anche media voto e fantamedia di quelle giornate, perché una finestra che prevede il RESTO della
    stagione dev'essere giudicata sul resto anche sul lato voto: la fantamedia di tutta la stagione
    contiene le giornate che il modello ha appena letto.

    Chi non ha nessuna giornata dopo la data resta con **zero presenze e nessuna media**, e i due sono
    fatti diversi: zero presenze future è un ESITO (si è fatto male, è partito, non gioca più), mentre
    una media su zero partite non esiste - «vuoto = ignoto, mai zero».
    """
    if not seen:
        return {}, {}
    # La giornata a cavallo esce da tutt'e due i lati: il modello non la vede (non era finita) e l'esito
    # non la conta (una parte era gia' giocata). Un buco dichiarato vale una perdita nascosta.
    excluded = sorted(seen | (straddling or set()))
    marks = ",".join("?" * len(seen))
    marks_out = ",".join("?" * len(excluded))
    played: dict[int, int] = {}
    for fc_id, count in conn.execute(
            f"""SELECT fc_id, COUNT(*) FROM match_ratings
                WHERE season = ? AND platform = ? AND status = 'played'
                  AND matchday IN ({marks}) GROUP BY fc_id""",
            (window.target_season, platform, *sorted(seen))):
        played[int(fc_id)] = int(count)
    rest: dict[int, tuple] = {}
    for fc_id, count, mv, fm in conn.execute(
            f"""SELECT fc_id, COUNT(*), AVG(mv), AVG(fantavoto) FROM match_ratings
                WHERE season = ? AND platform = ? AND status = 'played'
                  AND matchday NOT IN ({marks_out}) GROUP BY fc_id""",
            (window.target_season, platform, *excluded)):
        rest[int(fc_id)] = (int(count), mv, fm)
    return played, rest


# ---------------------------------------------------------------- input inventory

# What each pre-registered rule needs, so the report can state its feasibility instead of guessing.
FEATURE_CHECKS: tuple[tuple[str, str], ...] = (
    ("fm_prev", "previous fantamedia - the core's only input today"),
    ("minutes_prev", "provider minutes - R3 titolare vs spezzonista"),
    ("minutes_share_euro_prev", "minutes on the euro calendar's rounds - R3c"),
    ("xg_prev", "provider xG/xA - R2 per-90 propensity"),
    ("foreign_fm_equiv", "foreign FM-equivalent - R1 arrivals"),
    ("recent_rating", "last matches elsewhere (recent_form) - R13 no-history players"),
    ("longest_gap_days", "longest spell without playing - R14 inactivity"),
    # a PRICE on the listone's reference-auction scale (Serie A: 10 teams x 1000 credits),
    # and a VOLATILE state - it moves at every salient event, so on a past season the value
    # stored is a read taken after that season and already knows its outcome
    ("fvm", "market value, last read for that listone - REPORTING ONLY, never an input"),
    ("price_initial", "pre-auction quotation Qt.I - R12 market expectation"),
    ("price_initial_prev", "last season's Qt.I - R12b expectation revision"),
    ("birth_year", "birth year - R4 age curve"),
    ("elo_target", "destination club Elo - R5 (backlog)"),
    # kept in the inventory to show it is EMPTY in every past window - no rule reads it, and the
    # pre-registered R7 that would have needed it is therefore untestable until weekly snapshots exist
    ("starter_prob", "probable starter at auction date - unused: 0 rows before any past auction"),
    ("penalty_rank", "penalty hierarchy at auction date - R6/R8"),
)


def feature_availability(observations: list[Observation]) -> dict[str, dict[str, int]]:
    """How many observations actually carry each feature: the next phases' feasibility, measured."""
    return {name: {"present": sum(1 for obs in observations if getattr(obs, name) is not None),
                   "total": len(observations)}
            for name, _description in FEATURE_CHECKS}


@dataclass
class WindowData:
    """A window plus everything the model is allowed to know. Built only by `prepare`."""

    window: Window
    platform: str
    game: str
    observations: list[Observation]
    anchors: dict[str, float] = field(default_factory=dict)
    gk_rates: dict[str, float] = field(default_factory=dict)
    mu_rate: float = 1.3
    matchdays_prev: int = 0
    # Le giornate che il modello sta prevedendo. Su una finestra IN-SEASON sono quelle che RESTANO, non
    # quelle della stagione: la previsione è sul resto, e dividere per il totale direbbe che un uomo
    # arrivato a febbraio può giocare trentotto partite in tre mesi.
    matchdays_target: int = 0
    # ...e quelle già giocate alla data d'asta, che sono l'altro pezzo della stessa somma. 0 = finestra
    # pre-stagione, cioè tutte e dieci quelle pubblicate.
    matchdays_seen: int = 0
    rounds: dict[str, int] = field(default_factory=dict)
    # Input-season lineup structure (auction-safe: the lineups are last season's). Per club the
    # (mean, p90, complete-XI count) of simultaneously fielded forwards, and per sorted fc_id pair
    # how many XIs the two forwards started together. A club/pair with no measurable lineups is
    # ABSENT - None to the reader, never a fabricated zero.
    forward_caps: dict[str, tuple[float, float, int]] = field(default_factory=dict)
    co_starts: dict[tuple[int, int], int] = field(default_factory=dict)
    # Replacement level per role, from `replacement_levels`. EMPTY unless the caller supplied the
    # league setup: the engine core must not reach for a config file, and the pre-registered gate path
    # deliberately runs without it, so its VALUE = FM x Pv numbers stay exactly what was published.
    replacement: dict[str, float] = field(default_factory=dict)
    # The same levels read on the TARGET season's own population, for scoring what actually happened.
    # Not look-ahead and not optional: the predicted list is strictly input-season, but the actual list
    # is a REPORT on target-season outcomes, and measuring 2025-26 fantamedie against a baseline built
    # from 2023-24 is a level error, not conservatism. The euro 'pc' distribution fell half a fantavoto
    # between the two (rank 13: 8.02 -> 7.80 -> 7.38), which on 28 appearances is 14 points - enough to
    # rank a striker who played 28 matches below one who played a single match well.
    replacement_actual: dict[str, float] = field(default_factory=dict)
    # ...e lo STESSO livello contato sui posti che un undici SCHIERA invece che sugli slot di rosa
    # (`fielded_places`): il rimpiazzo che entra davvero, non il marginale di rosa. È l'altra domanda -
    # «quanto costa una giornata saltata» contro «chi conviene comprare» - e per questo è una seconda
    # mappa e non una sostituzione. Vuota se il chiamante non passa il regolamento, come sopra: il gate
    # non ne sa niente e nessuna riga di `engine_*` la legge.
    replacement_fielded: dict[str, float] = field(default_factory=dict)
    # Reliability exponent: SURPLUS x (Pv / matchdays)^reliability. 0 = off, which is the mathematically
    # pure setting. Above 0 it trades exact expected points for utility - a slot you cannot count on is
    # worth less than its expectation. A user PREFERENCE carried through, never fitted here.
    reliability: float = 0.0
    # Below this share of the calendar a player is not RANKED in a surplus top ten. Not a discount: a
    # discount can be out-earned by one spectacular match, and a man who played once was never someone
    # you could have fielded. 0 = no floor, which is what the pre-registered VALUE lists always use.
    min_availability: float = 0.0
    # scratch space for quantities derived from this window's own population (evaluate.derive).
    # Computing them is a full pass over ~1500 observations and the gate asks for the same window
    # dozens of times, so they are memoised here rather than recomputed per rule.
    cache: dict = field(default_factory=dict, repr=False)

    def rounds_for(self, league: str | None) -> int:
        """Real rounds of the player's league, with the 38-round default for unknown leagues."""
        return self.rounds.get(league or "", 38) or 38


def roster_depth(conn: sqlite3.Connection, platform: str, seasons: tuple[str, ...], game: str,
                 league: Mapping) -> dict[str, float]:
    """The slot counts `replacement_levels` needs, in `game`'s own vocabulary.

    Classic is the league's rule verbatim. Mantra is derived from the fielding caps unless the league
    states its own `mantra_slots`, and falls back to an even split of each group only when there are no
    lineups to measure the caps on.
    """
    squad_slots = league.get("squad_slots") or {}
    if game == "classic":
        return {role: float(count) for role, count in squad_slots.items()}
    stated = league.get("mantra_slots") or {}
    derived = derive_mantra_slots(conn, platform, seasons, squad_slots)
    if not derived:
        derived = {role: max(1.0, squad_slots.get(classic, 0) / len(roles))
                   for classic, roles in MANTRA_BY_CLASSIC.items() for role in roles}
    return {**derived, **{role: float(count) for role, count in stated.items() if role in derived}}


def cup_exposure(conn: sqlite3.Connection, season: str, cups: Mapping,
                 membership: Mapping[str, str]) -> dict[int, tuple[str, bool, float]]:
    """{fc_id: (confederation, capped, share of HIS league's season inside the cup windows)}.

    The share and not the rounds, because a share needs no calendar conversion: R21 subtracts inside the
    share of the season the appearances model already works in.

    The rounds inside a window are COUNTED from the calendar, and there are two sources by necessity:
    `fixtures` for a season not yet played (the only place a future January exists) and the lineups that
    were actually parsed for a season already played (`fixtures` is scraped for the season in play, so it
    is empty for 2021-22). One function, precedence declared, and neither is a guess.

    `cups` and `membership` come from `engine.cups.parse` - plain mappings, so this file still knows
    nothing about config files, the same rule `league` and `rulebook` follow.
    """
    windows = [cup for cup in cups.values() if not cup.seasons or season in cup.seasons]
    if not windows:
        return {}
    total: dict[str, int] = {}
    for source in ("fixtures", "club_match_lineups"):
        column = "round" if source == "fixtures" else "real_md"
        date = "date" if source == "fixtures" else "match_date"
        for league, rounds in conn.execute(
                f"SELECT {'league' if source == 'fixtures' else 'competition'}, "
                f"COUNT(DISTINCT {column}) FROM {source} WHERE season = ? GROUP BY 1", (season,)):
            if rounds and league not in total:      # fixtures wins where it has the season
                total[league] = int(rounds)
        inside: dict[tuple[str, str], int] = {}
        for cup in windows:
            for league, rounds in conn.execute(
                    f"SELECT {'league' if source == 'fixtures' else 'competition'}, "
                    f"COUNT(DISTINCT {column}) FROM {source} WHERE season = ? AND {date} BETWEEN ? AND ? "
                    f"GROUP BY 1", (season, cup.start, cup.end)):
                inside.setdefault((cup.key, league), int(rounds or 0))
        if inside:
            break
    at_risk: dict[tuple[str, str], float] = {}
    for (key, league), rounds in inside.items():
        cup = next(one for one in windows if one.key == key)
        if total.get(league):
            at_risk[(cup.confederation, league)] = (at_risk.get((cup.confederation, league), 0.0)
                                                    + rounds / total[league])
    if not at_risk:
        return {}
    out: dict[int, tuple[str, bool, float]] = {}
    for fc_id, country, capped, league in conn.execute(
            "SELECT p.fc_id, p.nationality, p.capped_on, c.league FROM players p "
            "JOIN rosters r ON r.fc_id = p.fc_id AND r.season = ? "
            "LEFT JOIN clubs c ON c.fc_club_id = r.fc_club_id WHERE p.nationality IS NOT NULL",
            (season,)):
        confederation = membership.get(country or "")
        share = at_risk.get((confederation or "", league or ""))
        if confederation and share:
            out[fc_id] = (confederation, capped is not None, share)
    return out


def prepare(conn: sqlite3.Connection, window: Window, platform: str, game: str, *,
            league: Mapping | None = None, squad_source: str = "listone",
            rulebook: Mapping | None = None, cups: Mapping | None = None,
            confederations: Mapping[str, str] | None = None) -> WindowData:
    """Load a window and everything the model needs, using only seasons <= the input season.

    `league` is the league setup as `Config.load_league()` returns it - a plain mapping, so the engine
    still knows nothing about config files. Optional on purpose: without it the replacement levels stay
    empty and the window is exactly the one every published gate number was produced on. The Auction
    panel supplies it; the gate does not.

    `rulebook` is the GAME's own modules file, parsed (`Config.load_modules`) - again a plain mapping,
    for the same reason. It buys the second replacement level, the one counted on the places an eleven
    FIELDS (`fielded_places`), which is REPORTING: no rule reads it, so passing it or not cannot move a
    gated number.

    `squad_source='real'` widens the row set to the real squads (see `load`), for an auction prepared
    before the listone exists. Default 'listone', so nothing in the gate moves.
    """
    seasons = tuple(season for (season,) in conn.execute(
        "SELECT DISTINCT season FROM season_stats ORDER BY season") if season <= window.input_season)
    # Le giornate della stagione bersaglio già giocate alla data d'asta: vuote per ogni finestra
    # pre-stagione, cioè per tutte quelle su cui il gate ha pubblicato i suoi numeri.
    seen = matchdays_before(conn, platform, window.target_season, window.auction_date)
    gk_rates, mu_rate = goalkeeper_club_rates(conn, platform, window.input_season)
    replacement: dict[str, float] = {}
    replacement_actual: dict[str, float] = {}
    replacement_fielded: dict[str, float] = {}
    if league and league.get("teams"):
        # ONE depth - how deep the league rosters is its rule, not a property of a season - read in two
        # populations: the seasons the auction could know about, and the season being scored.
        depth = roster_depth(conn, platform, seasons, game, league)
        teams = int(league["teams"])
        replacement = replacement_levels(conn, platform, seasons, game, depth, teams)
        replacement_actual = replacement_levels(
            conn, platform, (window.target_season,), game, depth, teams)
        # La seconda profondità: stessa funzione, stessa pool, stesso dominio - cambia solo il rango,
        # che qui viene dai posti SCHIERATI. Sulle seasons di input soltanto: è una colonna d'asta e non
        # un metro di scoring, quindi non le serve la popolazione della stagione bersaglio.
        places = fielded_places(rulebook, game) if rulebook else {}
        if places:
            replacement_fielded = replacement_levels(conn, platform, seasons, game, places, teams)
    observations = load(conn, window, platform, squad_source)
    # LA COPPA, sulle osservazioni: assegnata qui e non dentro `load` perché è un fatto sulla stagione
    # BERSAGLIO (un calendario e una nazionalità di oggi), mentre `load` legge le stagioni <= input. Senza
    # `cups` non tocca niente, che è come ogni finestra pubblicata del gate resta identica.
    if cups and confederations:
        exposed = cup_exposure(conn, window.target_season, cups, confederations)
        if exposed:
            # `Observation` è frozen - un'osservazione è un fatto e non un accumulatore - quindi si
            # RICOSTRUISCE invece di essere modificata.
            observations = [
                replace(obs, cup_conf=exposed[obs.fc_id][0], cup_capped=exposed[obs.fc_id][1],
                        cup_at_risk=exposed[obs.fc_id][2]) if obs.fc_id in exposed else obs
                for obs in observations]
    return WindowData(
        window=window, platform=platform, game=game,
        observations=observations,
        anchors=anchors(conn, platform, seasons, game),
        gk_rates=gk_rates, mu_rate=mu_rate,
        matchdays_prev=matchday_count(conn, platform, window.input_season),
        # Su una finestra in-season il bersaglio è il RESTO: il totale meno quelle già giocate. Su una
        # pre-stagione `seen` è vuoto e questa riga è il conteggio di sempre.
        matchdays_target=(matchday_count(conn, platform, window.target_season) - len(seen)),
        matchdays_seen=len(seen),
        rounds=league_rounds(conn, window.input_season),
        forward_caps=club_forward_caps(conn, platform, window.input_season),
        co_starts=forward_co_starts(conn, platform, window.input_season),
        replacement=replacement,
        replacement_actual=replacement_actual,
        replacement_fielded=replacement_fielded,
        reliability=float((league or {}).get("reliability_exponent") or 0.0),
        min_availability=float((league or {}).get("min_availability") or 0.0),
    )
