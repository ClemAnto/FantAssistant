"""Context: shared state passed to every pipeline module."""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from euroleghe_ingest.config import Config


@dataclass
class Context:
    """Object passed to `module.run(ctx)`.

    `conn` is the open SQLite connection (or None until the DB is initialized).
    `dry_run` skips network/disk writes for tests.
    `cancel_event` lets long-running modules (e.g. ratings) stop gracefully; already-committed
    data is kept. The GUI/CLI sets it; modules check `ctx.cancelled()` between steps.
    """

    config: Config
    conn: sqlite3.Connection | None = None
    dry_run: bool = False
    cancel_event: threading.Event | None = None
    # WHEN THE REFRESH THIS RUN BELONGS TO BEGAN (operator, 27/10/2026: «quando un'operazione si
    # interrompe a meta' possa essere ripresa successivamente, anche il giorno dopo»). A refresh walk
    # cut off halfway used to start again from the first page, so a walk longer than its window never
    # finished. `update` sets this from its own record of the step: a NEW cycle starts now (every
    # cached page is older, so everything is re-read, exactly the old `refresh`), a RESUMED one keeps
    # the time it began, and what was read since then is not paid for twice. None outside `update`.
    refresh_since: datetime | None = None

    def needs_download(self, path: Path, refresh: bool) -> bool:
        """THE one predicate of a refreshable cache: absent, or refreshed and read before this cycle."""
        if not path.exists():
            return True
        if not refresh:
            return False
        if self.refresh_since is None:
            return True
        return datetime.fromtimestamp(path.stat().st_mtime, tz=UTC) < self.refresh_since

    def require_conn(self) -> sqlite3.Connection:
        if self.conn is None:
            raise RuntimeError("DB not initialized: run `initdb` or `rebuild` first.")
        return self.conn

    def cancelled(self) -> bool:
        return self.cancel_event is not None and self.cancel_event.is_set()

    def progress(self, module: str, count: int, total: int, label: str = "") -> None:
        """Say how much of the work is behind us, in the ONE format the panel already parses.

        `[module] NN% · label`, which is what `snapshot.Progress` prints and what `SnapshotView.building`
        turns into a determinate bar. It lives here because every module already receives the context, and
        because a second progress format would mean a second parser: the panel's bar reads one line shape
        and only one.

        A COUNTED total and never a spinner dressed up as a number - if the total is unknown there is
        nothing honest to print, and the bar stays indeterminate, which is itself the truth. Capped at 99
        so the last line of a run is the only 100%.
        """
        if total <= 0:
            return
        share = min(round(100 * count / total), 99)
        tail = f" · {label}" if label else ""
        print(f"[{module}] {share:2.0f}%{tail}", flush=True)
