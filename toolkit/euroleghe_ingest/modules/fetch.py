"""fetch - acquire raw files from the network (optimization, not mandatory).

`--plan`  compute the needs from the manifest and, for domains not yet reachable, write
          `whitelist_request.md` to forward to the workspace administrator (the user is
          NOT the owner). Does not touch the network.
`--run`   download what is reachable (polite rate-limiting, raw cache with hash).
`--inbox` import manual downloads placed in data/inbox/ (whitelist fallback).

Allowed domains: see config.WHITELIST_DOMAINS. Credentials (for fantacalcio.it) from .env.
"""

from __future__ import annotations

from euroleghe_ingest.context import Context
from euroleghe_ingest.modules.base import not_implemented

NAME = "fetch"
DESCRIPTION = "Acquire raw files from whitelisted domains; generate whitelist_request.md"
DEPENDS_ON: list[str] = []
RAW_INPUTS: list[str] = []
NETWORK = True


def run(ctx: Context, *, plan: bool = False, do_run: bool = False, inbox: bool = False) -> None:
    if plan:
        raise not_implemented(NAME, "needs manifest + whitelist_request.md")
    if inbox:
        raise not_implemented(NAME, "import manual downloads from data/inbox/")
    raise not_implemented(NAME, "download with cache and rate-limiting")
