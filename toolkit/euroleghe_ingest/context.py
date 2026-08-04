"""Context: shared state passed to every pipeline module."""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass

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
