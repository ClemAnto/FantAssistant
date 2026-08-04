"""Configuration: paths, domain whitelist, per-league scoring, league setup.

Paths are relative to the repo root and can be overridden via environment variables.
Credentials are NOT stored here: they are read from `.env` only where needed (the `ratings` module).
"""

from __future__ import annotations

import json
import math
import os
from collections.abc import Mapping
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

# The 5 CHAMPIONSHIPS in scope (keys in English/snake_case). These are the `leagues` of
# scoring_config.json: a championship has its own bonus/malus rules, and a player belongs to one.
# NOT to be confused with the leagues the operator PLAYS IN - those are `my_leagues` in
# league_config.json, they carry a platform, a game and a squad size, and one sheet is built per league.
LEAGUES: tuple[str, ...] = (
    "serie_a",
    "premier_league",
    "la_liga",
    "bundesliga",
    "ligue_1",
)

# The two dimensions a played league is defined on, and which one it is defaults to. `platform` decides
# which matches count toward the fantamedia (euro bundles a subset of the real rounds), `game` the role
# vocabulary and the currency - and both change every number in the sheet, so neither can be guessed.
PLATFORMS: tuple[str, ...] = ("euro", "default")
GAMES: tuple[str, ...] = ("classic", "mantra")
# The name a league gets when the config file predates `my_leagues` and states one unnamed setup.
DEFAULT_LEAGUE_NAME = "default"

# The seasons in scope, oldest first - SINGLE SOURCE OF TRUTH. It used to be a tuple repeated in
# `ratings`, `positions` and `transfers`, which is three places to forget when a season opens: adding
# "2026-27" here (August, when the listone comes out) is the whole change, and the engine's windows
# then pick it up on their own. Anything older than the first entry is still reachable with
# `--season`; the modules only use this to decide what a BARE run downloads.
SEASONS: tuple[str, ...] = (
    "2015-16", "2016-17", "2017-18", "2018-19", "2019-20", "2020-21",
    "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27",
)
# What a run with no --season downloads: the three most recent seasons. The full history is already
# in the cache, and re-walking eleven seasons of every source by default would be hours for nothing.
DEFAULT_SEASONS: tuple[str, ...] = SEASONS[-3:]


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

    def _raw_league_config(self) -> dict:
        """The file as it is on disk, or {}. Never raises: see `load_league`."""
        try:
            raw = json.loads(self.league_config_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return raw if isinstance(raw, dict) else {}

    @staticmethod
    def _league_setup(name: str, entry: Mapping) -> dict:
        """One league's setup, every field defaulted. `entry` is the file's values already merged."""
        teams = entry.get("teams")
        slots = {**DEFAULT_SQUAD_SLOTS, **(entry.get("squad_slots") or {})}
        gamma = entry.get("reliability_exponent")
        floor = entry.get("min_availability")
        platform, game = entry.get("platform"), entry.get("game")
        return {
            "name": name,
            "platform": platform if platform in PLATFORMS else PLATFORMS[0],
            "game": game if game in GAMES else GAMES[0],
            "teams": int(teams) if isinstance(teams, int | float) and teams > 0 else DEFAULT_TEAMS,
            "squad_slots": {role: int(slots[role]) for role in DEFAULT_SQUAD_SLOTS},
            "mantra_slots": dict(entry.get("mantra_slots") or {}),
            "reliability_exponent": (float(gamma) if isinstance(gamma, int | float) and gamma >= 0
                                     else DEFAULT_RELIABILITY),
            "min_availability": (float(floor) if isinstance(floor, int | float) and 0 <= floor < 1
                                 else DEFAULT_MIN_AVAILABILITY),
        }

    def my_leagues(self) -> dict[str, dict]:
        """The leagues the operator PLAYS IN, name -> setup, in the order the file declares them.

        A played league is what makes a sheet computable: `platform` fixes which matches count toward
        the fantamedia, `game` the roles and the currency, `teams` x `squad_slots` the REPLACEMENT LEVEL
        that surplus is measured against. Three choices that change every number, so they belong to a
        named league and not to the run - and a sheet records which league it was built for.

        Each entry inherits the file's top-level values and overrides what it states, so a league that
        rosters like every other only has to name its platform and game. A file with no `my_leagues` at
        all (the shape before this existed) reads as ONE league called `default`, which is why nothing
        that used to work needs the key.

        Never raises: a missing or malformed file yields the standard 8-team setup.
        """
        raw = self._raw_league_config()
        declared = raw.get("my_leagues")
        base = {key: value for key, value in raw.items() if not key.startswith("_")}
        if not isinstance(declared, dict) or not declared:
            return {DEFAULT_LEAGUE_NAME: self._league_setup(DEFAULT_LEAGUE_NAME, base)}
        out: dict[str, dict] = {}
        for name, entry in declared.items():
            if name.startswith("_") or not isinstance(entry, dict):
                continue   # `_note` keys are documentation, and the file is edited by hand
            merged = {**base, **entry}
            merged["squad_slots"] = {**(base.get("squad_slots") or {}),
                                     **(entry.get("squad_slots") or {})}
            out[str(name)] = self._league_setup(str(name), merged)
        return out or {DEFAULT_LEAGUE_NAME: self._league_setup(DEFAULT_LEAGUE_NAME, base)}

    def load_league(self, name: str | None = None, *,
                    platform: str | None = None, game: str | None = None) -> dict:
        """One league's setup. By NAME, else the one played on `platform`/`game`, else the first.

        `name` is looked up strictly and RAISES if it is not declared: a typo would otherwise silently
        hand back another league's replacement level, which is a wrong sort order nobody can see. The
        other two paths never raise - a panel that refuses to open because a config file is absent is
        worse than one using 8 teams - and fall back to the file's top-level values, which is exactly
        what this method returned before leagues had names.
        """
        leagues = self.my_leagues()
        if name is not None:
            if name not in leagues:
                raise RuntimeError(
                    f"unknown league {name!r}; declared in {self.league_config_path.name}: "
                    f"{', '.join(leagues) or '(none)'}")
            return leagues[name]
        if platform or game:
            for setup in leagues.values():
                if (platform is None or setup["platform"] == platform) and \
                        (game is None or setup["game"] == game):
                    return setup
            # An undeclared combination is still valuable to look at (the gate sweeps all four), so it
            # gets the file's numbers rather than nothing - flagged, so a caller can say it is not one
            # of the operator's leagues.
            base = {key: value for key, value in self._raw_league_config().items()
                    if not key.startswith("_")}
            setup = self._league_setup("", {**base, "platform": platform, "game": game})
            setup["declared"] = False
            return setup
        return next(iter(leagues.values()))

    def save_leagues(self, leagues: Mapping[str, Mapping]) -> None:
        """Rewrite `my_leagues` in place, leaving every other key - and every comment - untouched.

        The file is a hand-edited, heavily commented document: its `_comment` and `_note` blocks are
        part of the knowledge base, so this reads it, replaces one key and writes it back rather than
        regenerating it. Only what a league can OVERRIDE is written; anything equal to the file's own
        top-level value stays inherited instead of being duplicated into every entry.
        """
        raw = self._raw_league_config()
        base = {key: value for key, value in raw.items() if not key.startswith("_")}
        out: dict[str, dict] = {}
        for name, setup in leagues.items():
            entry: dict = {"platform": setup.get("platform", PLATFORMS[0]),
                           "game": setup.get("game", GAMES[0])}
            for key in ("teams", "reliability_exponent", "min_availability"):
                if key in setup and setup[key] != base.get(key):
                    entry[key] = setup[key]
            slots = dict(setup.get("squad_slots") or {})
            if slots and slots != {**DEFAULT_SQUAD_SLOTS, **(base.get("squad_slots") or {})}:
                entry["squad_slots"] = slots
            if setup.get("mantra_slots"):
                entry["mantra_slots"] = dict(setup["mantra_slots"])
            out[str(name)] = entry
        raw["my_leagues"] = out
        self.league_config_path.parent.mkdir(parents=True, exist_ok=True)
        self.league_config_path.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n",
                                           encoding="utf-8")

    def roster_slots(self, game: str, league: str | None = None) -> dict[str, int]:
        """How many players of each role a league rosters, in the vocabulary `game` uses.

        `league` names which of `my_leagues` to read; without it, the first declared one.

        Classic reads squad_slots straight, which is the league's actual rule.

        Mantra is the OFFLINE FALLBACK only: each Classic group's slots split evenly over its Mantra
        roles, rounded up with a floor of 1. Even is known to be wrong - no module fields 3 'pc' or 4
        'dc', so the roles of a group are not interchangeable - and the engine derives the shape from
        the fielding caps measured off real lineups instead (`features.derive_mantra_slots`). This stays
        for the case where there are no lineups to measure, and an explicit `mantra_slots` entry in
        league_config.json overrides both.
        """
        from euroleghe_ingest.sources import MANTRA_BY_CLASSIC

        setup = self.load_league(league)
        if game == "classic":
            return dict(setup["squad_slots"])
        derived = {
            role: max(1, math.ceil(setup["squad_slots"][classic] / len(roles)))
            for classic, roles in MANTRA_BY_CLASSIC.items() for role in roles
        }
        return {**derived, **{role: int(count)
                              for role, count in setup["mantra_slots"].items() if role in derived}}
