"""cups - what a mid-season continental cup costs a player, in league rounds.

A tournament played in January is not a risk and not an opinion: it is a CALENDAR that overlaps the
league's own, and the only unknown is whether this man goes. That unknown is exactly what the number
below measures, so nothing here guesses a call-up list - «ivoriano» and «convocato» are different
sentences and the gap between them IS the coefficient.

MEASURED 17/08/2026 on the dated per-match layer, difference-in-differences over four tournament
windows (`data/reports/` has the run; the method is in gate-motore-v1.md §7-quattuortricies). For every
window: treated = the players whose nationality belongs to the confederation whose cup is on, control =
everybody else in the same league and season, outcome = the share of his CLUB'S league matches he was
on the pitch for, inside the window against outside it. The DiD subtracts what the window does to
everybody (winter fixtures, cup congestion, the calendar) and leaves the part that is about being away.

Restricted to players who were REGULARS outside the window (share >= 0.50), because that is the
population the sheet applies it to - on the whole listone the same numbers come out smaller and mean
something else, «including men who play a third of the season anyway».

    window            treated  DiD      capped   not capped
    CAN 2022 (Camerun)     56  -0.198   -0.283   -0.135
    CAN 2024 (Costa d'Av.) 90  -0.245   -0.294   -0.191
    Coppa d'Asia 2024      12  -0.593   -0.608   -0.564
    CAN 2026 (Marocco)     87  -0.405   -0.480   -0.262

Three things the table says and this module obeys:

  * being CAPPED matters for CAF and not for AFC. An African passport in Europe is common and a
    call-up is not (-0.28 against -0.14 in the same window); the handful of Asians who play in Europe
    are their national teams' starters almost without exception, so -0.608 and -0.564 are one number
    read twice. Hence two coefficients for CAF and one for AFC.
  * the AFC evidence is THIN - one window, 12 regulars, 8 of them capped - and it is stated here rather
    than smoothed away. It is also the only cup that touches 2026-27, so it is the coefficient that
    will be used; if a second Asian Cup lands inside a season, re-measure before trusting this decimal.
  * the CAF windows are not identical (-0.28, -0.29, -0.48) and the most recent is the worst. A likely
    reason is the measurement rather than football: nationality is read from TODAY's cached squads, so
    the further back a window is, the more of its treated group is made of men still in circulation and
    the fewer of its never-called ones survive. Recorded, not corrected: the mean over the windows is
    what ships, and the spread is the honest uncertainty around it.

This is REPORTING arithmetic. `engine_pv_pred` is gated and no rule here touches it: the sheet carries
the adjusted appearances in a column of its own beside the gated one, exactly as «Margine» sits beside
«Surplus». The gate candidate that would move the engine's own number is a separate decision.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace

#: Where the bands are cut, on his share of the club's matches OUTSIDE the window - the only thing about
#: him the sheet knows before the cup. Three populations, because the penalty is a difference in SHARES
#: and a man who plays a third of the season cannot lose 59 points of it.
BANDS: tuple[tuple[str, float], ...] = (("regular", 0.50), ("rotation", 0.25), ("fringe", 0.0))


def band_of(played_share: float | None) -> str | None:
    """Which population he belongs to, from his own share of the calendar. None when it is unknown."""
    if played_share is None:
        return None
    for name, floor in BANDS:
        if played_share >= floor:
            return name
    return "fringe"


#: Share of the rounds INSIDE a cup's window that a player of that profile loses to it, keyed by
#: (confederation, band, capped).
#:
#: MEASURED per band rather than capped by a rule of thumb, which is what «penalità a tutti» demanded and
#: also what it deserved: the cap this replaces would have charged a fringe African 0.10 of the window
#: where the measurement says 0.03, and a rotation man 0.37 where it says 0.07. Pooled over the windows
#: of each confederation (CAF 3, AFC 1), n per cell in the table below.
#:
#:     CAF  regular   capped -0.352 (n=128) · not capped -0.195 (n=105)
#:     CAF  rotation  capped -0.089 (n=29)  · not capped -0.073 (n=73)
#:     CAF  fringe    capped -0.026 (n=20)  · not capped -0.027 (n=50)
#:     AFC  regular   capped -0.607 (n=8)   · not capped -0.563 (n=4)
#:
#: The shape is the same in both confederations and it is the honest reason the old cap looked right: the
#: further down the calendar a man is, the less of a window he can lose. What differs is the LEVEL, and
#: the Asian Cup's is twice the Africa Cup's for the reason in the docstring.
WINDOW_LOSS: dict[tuple[str, str, bool], float] = {
    # Three windows each, every cell with n >= 20.
    ("CAF", "regular", True): 0.35,
    ("CAF", "regular", False): 0.20,
    ("CAF", "rotation", True): 0.09,
    ("CAF", "rotation", False): 0.07,
    ("CAF", "fringe", True): 0.03,
    ("CAF", "fringe", False): 0.03,
    # ONE window, 12 regulars, and capped/not capped do not separate there (-0.607 against -0.563) - so
    # one number for both instead of two decimals of noise.
    ("AFC", "regular", True): 0.59,
    ("AFC", "regular", False): 0.59,
    # ...and outside the regulars the Asian Cup has ONE and TWO observations, which is not a measurement.
    # The LEVEL stays the AFC's own and the SHAPE is borrowed from the CAF, where it rests on 172 men:
    # rotation is 0.25 of regular there and fringe 0.08, applied to 0.59 -> 0.15 and 0.05. A borrowed
    # shape is stated as such, and it is still better than the cap it replaces (which said 0.37 and 0.10).
    ("AFC", "rotation", True): 0.15,
    ("AFC", "rotation", False): 0.15,
    ("AFC", "fringe", True): 0.05,
    ("AFC", "fringe", False): 0.05,
}

#: A profile the measurement never covered gets nothing, not a borrowed coefficient: a confederation
#: whose senior cup has never been played inside a European season has no measured loss, and inventing
#: one would be applying a fitted number outside the population it was fitted on.
UNKNOWN_LOSS: float | None = None

#: What the window costs a regular who is KNOWN to be going, whatever his passport says.
#:
#: Measured on the men who actually played, over the FOUR tournaments whose squads we now hold
#: (`tournaments_squads`, downloaded 17/08/2026): CAN 2026 **-0.598** (n=60), CAN 2024 **-0.472** (n=74),
#: CAN 2022 **-0.643** (n=54), Coppa d'Asia 2024 **-0.633** (n=12). Mean **-0.586**, and for the men who
#: played 270+ minutes at the tournament - i.e. went deep in it - **-0.639**.
#:
#: The four numbers are the same football in Africa and in Asia, which is the whole point: it lands at
#: exactly the AFC's passport coefficient (0.59), because there a passport nearly implies the call-up.
#: It is deliberately kept apart from `WINDOW_LOSS`, because the two answer different questions and this
#: is what makes the whole family explainable rather than merely fitted:
#:
#:     WINDOW_LOSS  = P(he is called up | passport, band) x COST_IF_GOING
#:     CONFIRMED     =                                      COST_IF_GOING
#:
#: The call-up rate is measured too, on the same squads: of the CAF-flagged men playing in our five
#: leagues, **43% and 42%** went - 65% / 57% of the capped ones against 20% / 31% of the rest. Multiply
#: and the pooled CAF regular capped coefficient comes back (0.6 x 0.59 = 0.35 against the measured
#: 0.352), which is the arithmetic closing on itself from two independent directions.
#:
#: It also explains the one thing that looked odd about the AFC number being twice the CAF one: the COST
#: is identical and the difference is entirely P(called up).
#:
#: So the moment the squads for a live tournament are published - which for January 2027 is December
#: 2026 - `tournaments_squads` turns the average into the fact, and the sheet stops guessing about the
#: men it no longer has to guess about. The bands keep the CAF's measured shape (rotation 0.25 of
#: regular, fringe 0.08), because the confirmed group is too small to cut three ways.
CONFIRMED_LOSS: dict[str, float] = {"regular": 0.59, "rotation": 0.15, "fringe": 0.05}


@dataclass(frozen=True)
class Cup:
    """One tournament window, as `config/international_cups.json` declares it."""

    key: str
    name: str
    confederation: str
    start: str
    end: str
    #: The final tournament's field, in the provider's own country spelling. Empty = not known yet, and
    #: then nationality alone decides - a man whose country is not listed is not thereby excluded.
    qualified: frozenset[str]
    seasons: tuple[str, ...]
    source: str

    def covers(self, country: str | None) -> bool:
        """Would a player of this country be at this tournament's disposal?

        Two conditions, and the second one is skipped when the field is unknown rather than guessed:
        the country must belong to the confederation whose cup this is (the caller checks that, since
        it owns the membership map), and his national team must be in the field.
        """
        if not country:
            return False
        return not self.qualified or country in self.qualified


@dataclass(frozen=True)
class Exposure:
    """What a named player stands to lose to one cup, in his own league's rounds."""

    cup: Cup
    country: str
    capped: bool
    #: Rounds that fall inside the window, COUNTED from the calendar and never assumed - and expressed
    #: in the unit `pv_pred` lives on, which is the PLATFORM's calendar (31 euro rounds against 38 on
    #: default). The caller owns that conversion because it is the only one holding both calendars; a
    #: number here in the club's championship rounds would be subtracted from a different unit.
    rounds_at_risk: float
    #: The measured share of those rounds a player of this profile loses. None = never measured.
    share_lost: float | None
    #: WHICH population that share is about - `regular` | `rotation` | `fringe`, from his own expected
    #: share of the calendar. On the row it is what makes the number explainable: the same tournament
    #: takes 0.59 of the window off a Japanese starter and 0.05 off a Japanese squad player.
    band: str | None = None
    #: His name is in the tournament's own squad (`tournaments_squads`), so the penalty is the COST of
    #: going rather than that cost times a probability. False is the normal case before December.
    confirmed: bool = False

    @property
    def rounds_lost(self) -> float | None:
        """Expected rounds missed = rounds in the window x the measured share. None when unmeasured."""
        if self.share_lost is None:
            return None
        return self.rounds_at_risk * self.share_lost

    def note(self) -> str:
        """One line for a tooltip, in the operator's language: what, when, how much."""
        lost = self.rounds_lost
        window = f"{_it(self.cup.start)}-{_it(self.cup.end)}"
        who = "CONVOCATO" if self.confirmed else ("nazionale" if self.capped else "convocabile")
        if self.band and self.band != "regular":
            who = f"{who}, {self.band}"
        if lost is None:
            return (f"{self.cup.name} ({window}): {self.country}, {who} · "
                    f"{self.rounds_at_risk:.1f} giornate nella finestra, penalita' non misurata")
        return (f"{self.cup.name} ({window}): {self.country}, {who} · "
                f"{self.rounds_at_risk:.1f} giornate nella finestra, ~{lost:.1f} attese perse")


def _it(iso: str) -> str:
    """A date a person reads, not a parser: dd/mm."""
    parts = iso.split("-")
    return f"{parts[2]}/{parts[1]}" if len(parts) == 3 else iso


def excused(raw: Mapping) -> dict[int, str]:
    """{fc_id: reason} - the men the operator has DECLARED unavailable to their passport's national team.

    The provider's country is the nationality a man is filed under, which for a handful of players is
    where he was born rather than who he plays for: Dahoud reads Syria and has played for Germany. That
    choice is observed nowhere in this repository, and deriving it from a birthplace would be inventing
    one fact out of another - so it is declared, dated and revocable, exactly like a board ruling.

    It can only ever REMOVE an exposure. A declaration that ADDED one would be a call-up prediction,
    which is the thing the measured coefficient exists to avoid making.
    """
    out: dict[int, str] = {}
    for key, entry in (raw.get("exceptions") or {}).items():
        try:
            fc_id = int(key)
        except (TypeError, ValueError):
            continue                    # a key nobody can join is dropped, never guessed by name
        if isinstance(entry, Mapping):
            reason = str(entry.get("reason") or "").strip()
            decided = str(entry.get("decided_on") or "").strip()
            out[fc_id] = f"{reason} (dichiarato il {decided})" if decided else reason
        elif isinstance(entry, str):
            out[fc_id] = entry
    return out


def parse(raw: Mapping) -> tuple[dict[str, Cup], dict[str, str]]:
    """The declared file -> ({key: Cup}, {country: confederation}).

    Never raises on a malformed entry: a cup missing its dates or its confederation is DROPPED, because
    a window with half a date would silently expose nobody while looking like a working feature. The
    caller gets whatever was well-formed, and an empty pair reads as «no rulebook» - the same treatment
    `Config.load_modules` gives the two module files.
    """
    cups: dict[str, Cup] = {}
    for key, entry in (raw.get("cups") or {}).items():
        if not isinstance(entry, Mapping):
            continue
        start, end = entry.get("start"), entry.get("end")
        confederation = entry.get("confederation")
        if not (isinstance(start, str) and isinstance(end, str) and isinstance(confederation, str)):
            continue
        if start > end:
            continue
        cups[key] = Cup(
            key=key,
            name=str(entry.get("name") or key),
            confederation=confederation,
            start=start,
            end=end,
            qualified=frozenset(entry.get("qualified") or ()),
            seasons=tuple(entry.get("seasons") or ()),
            source=str(entry.get("source") or ""),
        )
    membership: dict[str, str] = {}
    for confederation, countries in (raw.get("confederations") or {}).items():
        if not isinstance(countries, Sequence) or isinstance(countries, str):
            continue
        for country in countries:
            if isinstance(country, str):
                membership[country] = confederation
    return cups, membership


def cups_between(cups: Iterable[Cup], start: str, end: str) -> list[Cup]:
    """The declared cups whose window overlaps [start, end] - a season, or the rest of one.

    Overlap and not containment: an auction held in December has to know about a tournament that
    started before the day it is played, and one that runs past the end of the league calendar still
    costs the rounds it covers.
    """
    return sorted((cup for cup in cups if cup.start <= end and cup.end >= start),
                  key=lambda cup: cup.start)


def loss_share(confederation: str, capped: bool, played_share: float | None = None,
               confirmed: bool = False) -> float | None:
    """The measured share for this profile, or None where nothing was ever measured for it.

    `played_share` is his own share of the calendar before the cup, which decides the BAND. Without it
    the regular's coefficient answers - the population the sheet mostly asks about, and the caller that
    omits it is saying «treat him as one».

    `confirmed` = his name is in the tournament's own squad, so there is nothing left to average over:
    the answer is the COST of going and not the cost times a probability. It is the same number for both
    confederations, which is the point.
    """
    band = band_of(played_share) or "regular"
    if confirmed:
        return CONFIRMED_LOSS.get(band)
    return WINDOW_LOSS.get((confederation, band, capped), UNKNOWN_LOSS)


def exposure_of(country: str | None, capped: bool, cups: Iterable[Cup],
                membership: Mapping[str, str], rounds_in_window,
                played_share: float | None = None,
                confirmed_in: Iterable[str] = ()) -> list[Exposure]:
    """Every cup a player of this country is exposed to, with what each is expected to cost.

    `rounds_in_window(cup)` answers «how many of HIS league's rounds fall inside this window», because
    that count is a property of his club's calendar and not of the tournament: the same Asian Cup costs
    4 Serie A rounds and 3 Premier ones. A cup the calendar cannot answer for yields no exposure at
    all - `vuoto = ignoto`, never a zero and never a guess.

    `played_share` is how much of the calendar he is expected to play, and it picks the BAND his
    coefficient comes from. Passing nothing treats him as a regular, which is the strongest penalty of
    the three - so a caller that does not know had better mean it.
    """
    confederation = membership.get(country or "")
    confirmed_keys = set(confirmed_in)
    out: list[Exposure] = []
    for cup in cups:
        confirmed = cup.key in confirmed_keys
        # A CONFIRMED squad member outranks every test below it: his name is on the list, so neither his
        # passport nor the qualified field is being asked any more. That also covers the one case the
        # nationality can get wrong in the other direction - a man the provider files under a country he
        # does not play for is in nobody's squad, and one who plays for a country he was not filed under
        # would otherwise be invisible.
        if not confirmed and (confederation is None or cup.confederation != confederation
                              or not cup.covers(country)):
            continue
        rounds = rounds_in_window(cup)
        if not rounds:
            continue
        # float and not int: on euro the count is a championship's rounds converted to the platform's
        # calendar (4 of 38 -> 3.3 of 31), and rounding it here would quietly throw a third of a round
        # away on every row.
        out.append(Exposure(cup=cup, country=country or "", capped=capped,
                            rounds_at_risk=float(rounds),
                            share_lost=loss_share(cup.confederation, capped, played_share, confirmed),
                            band=band_of(played_share), confirmed=confirmed))
    return out


def with_band(exposures: Iterable[Exposure], played_share: float | None) -> list[Exposure]:
    """The same exposures with their BAND (and therefore their coefficient) decided on `played_share`.

    It exists because the two facts are known at different moments and each must be read where it is
    true: the sheet builds the exposure while it walks the calendar - which is before the ESTIMATE that
    prices a man the engine refuses to price - and the band depends on the appearances actually used on
    the row. Deciding it once, early, gave a rotation player the regulars' coefficient (Jasim, 11 rounds
    of 38, charged 2.4 rounds instead of 0.6). One definition of the coefficients either way: this
    re-reads `WINDOW_LOSS`, it does not hold a second copy of it.
    """
    band = band_of(played_share)
    out = []
    for exposure in exposures:
        out.append(replace(
            exposure, band=band,
            share_lost=loss_share(exposure.cup.confederation, exposure.capped, played_share,
                                  exposure.confirmed)))
    return out


def adjusted_pv(pv_pred: float | None, exposures: Iterable[Exposure],
                calendar_rounds: int | None = None) -> float | None:
    """The predicted appearances with the cups taken out, or None when there is nothing to adjust.

    The coefficient is a DIFFERENCE IN SHARES - the treated regulars went from 0.80 of their club's
    matches to 0.19 - so the rounds lost are `share x rounds in the window`, and scaling that again by
    how often he plays would charge the discount twice.

    Which share, though, depends on WHICH POPULATION he is in, and that is now measured rather than
    capped: `exposure_of` picks the band from his own expected share of the calendar (`regular` /
    `rotation` / `fringe`), so a squad player gets the coefficient measured on squad players instead of
    the regulars' one trimmed by a rule of thumb. That rule of thumb used to live here, and it was
    generous in the wrong direction - it charged a fringe African 0.10 of the window where the
    measurement says 0.03.

    `calendar_rounds` therefore no longer carries the arithmetic; it is kept as a GUARD against the
    absurd (nobody loses more rounds than he was ever going to play), which is a statement no
    measurement should have to make and every subtraction should be unable to violate. Floored at zero
    for the same reason.
    """
    if pv_pred is None:
        return None
    lost = sum(exposure.share_lost * exposure.rounds_at_risk
               for exposure in exposures if exposure.share_lost is not None)
    if lost <= 0:
        return pv_pred
    if calendar_rounds:
        # the guard, not the model: he cannot miss rounds he was never going to be on the pitch for
        lost = min(lost, pv_pred)
    return max(0.0, pv_pred - lost)
