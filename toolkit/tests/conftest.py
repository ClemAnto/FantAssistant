"""Shared test helpers.

One helper, and it exists because of a rule the DB now enforces: a QUOTATION IS A FACT ABOUT A PLATFORM.
A listone ingest writes it twice - into `rosters`, which keeps the last read and cannot say which listone
wrote it, and into `listone_quotes`, which is keyed on the platform and is what every platform-specific
reader uses. A fixture that seeds only `rosters` is describing a DB that `ratings` cannot produce.
"""

from __future__ import annotations

import pytest


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
