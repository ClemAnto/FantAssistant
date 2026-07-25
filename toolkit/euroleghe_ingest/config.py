"""Configuration: paths, domain whitelist, per-league scoring.

Paths are relative to the repo root and can be overridden via environment variables.
Credentials are NOT stored here: they are read from `.env` only where needed (the `ratings` module).
"""

from __future__ import annotations

import json
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
