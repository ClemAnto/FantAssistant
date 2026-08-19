"""Shared test helpers.

Two, and the second one is about the suite itself: this project tests a lot of RULES by reading the
source of the function that implements them (`inspect.getsource`), which is the only way to assert
things like «this refresh is never called straight from `run`». That idiom reads through `linecache`,
which caches a file's lines by name and revalidates them only when asked - so a session that imported a
module BEFORE its file was edited keeps handing out the old lines at the new line numbers, and
`getsource` returns a fragment of some neighbouring function. It fails as a wrong assertion, which sends
the reader to the rule instead of to the cache. Measured on 18-19/08/2026: green in isolation, seven
red in a full run launched right after an edit, green again on the next run with nothing changed.

One helper, and it exists because of a rule the DB now enforces: a QUOTATION IS A FACT ABOUT A PLATFORM.
A listone ingest writes it twice - into `rosters`, which keeps the last read and cannot say which listone
wrote it, and into `listone_quotes`, which is keyed on the platform and is what every platform-specific
reader uses. A fixture that seeds only `rosters` is describing a DB that `ratings` cannot produce.
"""

from __future__ import annotations

import linecache

import pytest


@pytest.fixture(autouse=True)
def _source_is_read_from_disk():
    """Drop any stale line cache before each test, so `inspect.getsource` reads today's file.

    Autouse and cheap (a `stat` per cached file): the alternative is remembering to do it in every
    source-reading test, which is the kind of thing a suite forgets exactly once.
    """
    linecache.checkcache()


def _mirror_quotes(conn, platform: str = "euro") -> None:
    """Publish every roster row's quotation as `platform`'s listone, the way `upsert_listone` does."""
    conn.execute(
        """
        INSERT OR REPLACE INTO listone_quotes(fc_id, season, platform, price, price_initial, fvm,
                                              fvm_mantra, price_mantra, price_initial_mantra)
        SELECT fc_id, season, ?, price, price_initial, fvm, fvm_mantra, price_mantra,
               price_initial_mantra
        FROM rosters
        """,
        (platform,),
    )
    conn.commit()


@pytest.fixture
def quotes_from_rosters():
    """`quotes_from_rosters(conn)` - or `(conn, 'default')` - after seeding `rosters` in a fixture."""
    return _mirror_quotes
