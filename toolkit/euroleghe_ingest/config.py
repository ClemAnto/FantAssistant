"""Configuration: paths, domain whitelist, per-league scoring, league setup.

Paths are relative to the repo root and can be overridden via environment variables.
Credentials are NOT stored here: they are read from `.env` only where needed (the `ratings` module).
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path

# Repo root = two levels above this file (toolkit/euroleghe_ingest/config.py).
REPO_ROOT = Path(__file__).resolve().parents[2]

# Domains allowed for scraping (spec v8). Everything else falls back to the inbox.
WHITELIST_DOMAINS: tuple[str, ...] = (
    "fantacalcio.it",
    "api.clubelo.com",
    "fbref.com",
    "transfermarkt.com",
    "transfermarkt.it",
    "query.wikidata.org",
    "sofascore.com",
    "api.sofascore.com",
)

# The 5 leagues in scope (keys in English/snake_case).
LEAGUES: tuple[str, ...] = (
    "serie_a",
    "premier_league",
    "la_liga",
    "bundesliga",
    "ligue_1",
)


# NOTE: MANTRA_BY_CLASSIC lives in `sources`, next to CLASSIC_ROLES / MANTRA_ROLES, so the mapping
# cannot drift away from the roles it partitions. It is imported lazily where needed: `sources` imports
# Config, so a module-level import here would close the cycle.

# Used when config/league_config.json is missing or says nothing: a standard 8-team fantacalcio league
# with the fantacalcio.it 25-man squad. Reasonable, not sacred - the file is there to be edited.
DEFAULT_TEAMS = 8
DEFAULT_SQUAD_SLOTS: dict[str, int] = {"P": 3, "D": 8, "C": 8, "A": 6}
# How hard an unreliable player is discounted (see the note in league_config.json). MEASURED, not a
# taste: 0.5 reproduces the share of his own appearances a manager can actually catch, band by band.
DEFAULT_RELIABILITY = 0.5
# Below this share of the season a player is not ranked at all. A discount can be out-earned by one
# spectacular match; a man who played once was never fieldable, which is a different statement.
DEFAULT_MIN_AVAILABILITY = 0.35


def _env_path(var: str, default: Path) -> Path:
    value = os.environ.get(var)
    return Path(value).resolve() if value else default


@dataclass(frozen=True)
class Config:
    """Paths and parameters resolved at runtime."""

    repo_root: Path = REPO_ROOT
    data_dir: Path = field(default_factory=lambda: _env_path("EUROLEGHE_DATA_DIR", REPO_ROOT / "data"))
    db_path: Path = field(default_factory=lambda: _env_path("EUROLEGHE_DB_PATH", REPO_ROOT / "data" / "euroleghe.db"))
    scoring_config_path: Path = field(default_factory=lambda: REPO_ROOT / "config" / "scoring_config.json")
    league_config_path: Path = field(default_factory=lambda: REPO_ROOT / "config" / "league_config.json")

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def inbox_dir(self) -> Path:
        return self.data_dir / "inbox"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    def load_scoring(self, league: str | None = None) -> dict[str, float]:
        """Effective scoring for a league = defaults + that league's overrides."""
        raw = json.loads(self.scoring_config_path.read_text(encoding="utf-8"))
        merged = dict(raw.get("default", {}))
        if league:
            merged.update(raw.get("leagues", {}).get(league, {}))
        return merged

    def load_league(self) -> dict:
        """League setup: {'teams': int, 'squad_slots': {classic role: int}}.

        Never raises on a missing or malformed file - the defaults are usable on their own, and a panel
        that refuses to open because a config file is absent is worse than one using 8 teams.
        """
        raw: dict = {}
        try:
            raw = json.loads(self.league_config_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        teams = raw.get("teams")
        slots = {**DEFAULT_SQUAD_SLOTS, **(raw.get("squad_slots") or {})}
        gamma = raw.get("reliability_exponent")
        floor = raw.get("min_availability")
        return {
            "teams": int(teams) if isinstance(teams, int | float) and teams > 0 else DEFAULT_TEAMS,
            "squad_slots": {role: int(slots[role]) for role in DEFAULT_SQUAD_SLOTS},
            "mantra_slots": dict(raw.get("mantra_slots") or {}),
            "reliability_exponent": (float(gamma) if isinstance(gamma, int | float) and gamma >= 0
                                     else DEFAULT_RELIABILITY),
            "min_availability": (float(floor) if isinstance(floor, int | float) and 0 <= floor < 1
                                 else DEFAULT_MIN_AVAILABILITY),
        }

    def roster_slots(self, game: str) -> dict[str, int]:
        """How many players of each role this league rosters, in the vocabulary `game` uses.

        Classic reads squad_slots straight, which is the league's actual rule.

        Mantra is the OFFLINE FALLBACK only: each Classic group's slots split evenly over its Mantra
        roles, rounded up with a floor of 1. Even is known to be wrong - no module fields 3 'pc' or 4
        'dc', so the roles of a group are not interchangeable - and the engine derives the shape from
        the fielding caps measured off real lineups instead (`features.derive_mantra_slots`). This stays
        for the case where there are no lineups to measure, and an explicit `mantra_slots` entry in
        league_config.json overrides both.
        """
        from euroleghe_ingest.sources import MANTRA_BY_CLASSIC

        setup = self.load_league()
        if game == "classic":
            return dict(setup["squad_slots"])
        derived = {
            role: max(1, math.ceil(setup["squad_slots"][classic] / len(roles)))
            for classic, roles in MANTRA_BY_CLASSIC.items() for role in roles
        }
        return {**derived, **{role: int(count)
                              for role, count in setup["mantra_slots"].items() if role in derived}}
