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
