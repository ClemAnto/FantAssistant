"""Common interface for pipeline modules.

Each module is a file in `modules/` exposing:
    NAME: str                 command/table name
    DESCRIPTION: str          short description (documentation)
    DEPENDS_ON: list[str]     modules that must run first
    RAW_INPUTS: list[str]     raw files expected in data/raw (for the `fetch` manifest)
    NETWORK: bool             whether it needs access to whitelisted domains
    run(ctx: Context, **kwargs) -> None

Convention: unimplemented stubs raise `NotImplementedError` with a TODO pointing to spec v8.
A module is "active" as soon as `run` does something real.
"""

from __future__ import annotations

from euroleghe_ingest.context import Context

__all__ = ["Context", "not_implemented"]


def not_implemented(module: str, what: str) -> NotImplementedError:
    return NotImplementedError(
        f"[{module}] not implemented yet - {what}. See spec-euroleghe-ingest-v8.md on Drive."
    )
