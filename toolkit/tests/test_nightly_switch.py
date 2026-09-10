"""`config/nightly.json`: the declared on/off of the unattended update.

TWO READERS AND ONE MEANING. The panel writes it and shows it; the scheduled task (`scripts/
nightly-update.ps1`) obeys it. They are in two languages, so nothing but a test can keep them
agreeing - and the case where they could disagree in silence is the one that matters: a machine with
no file at all, and a file with a typo in it. Both mean ON, and if the two halves ever disagree the
panel would show a state the machine does not obey.
"""
from __future__ import annotations

import json
import types
from pathlib import Path

from euroleghe_ingest.config import Config
from euroleghe_ingest.gui import ToolkitGUI

RUNNER = Path(__file__).resolve().parents[2] / "scripts" / "nightly-update.ps1"


def _panel(tmp_path):
    """The three readers, bound to a config and nothing else: they touch no widget."""
    return types.SimpleNamespace(config=Config(data_dir=tmp_path / "data",
                                               nightly_path=tmp_path / "nightly.json"))


def test_no_file_means_ON_which_is_the_safe_direction(tmp_path):
    """A clone that has never been told anything keeps its data fresh.

    The other reading - «no file, no run» - would stop the acquisition on every fresh machine without
    anybody saying so, which is «vuoto = ignoto» read as a zero.
    """
    declared = ToolkitGUI._nightly_declared(_panel(tmp_path))
    assert declared["enabled"] is True
    assert declared["decided_on"] is None


def test_a_file_with_a_TYPO_is_not_a_declaration_to_obey(tmp_path):
    """A broken brace must not stop the acquisition, and must not pass unnoticed either."""
    panel = _panel(tmp_path)
    panel.config.nightly_path.write_text("{ questo non e' json", encoding="utf-8")
    declared = ToolkitGUI._nightly_declared(panel)
    assert declared["enabled"] is True
    assert declared.get("unreadable") is True, "the panel must be able to SAY that it could not read it"


def test_off_is_obeyed_and_carries_its_date(tmp_path):
    panel = _panel(tmp_path)
    panel.config.nightly_path.write_text(
        json.dumps({"enabled": False, "decided_on": "2026-09-10"}), encoding="utf-8")
    declared = ToolkitGUI._nightly_declared(panel)
    assert declared["enabled"] is False
    assert declared["decided_on"] == "2026-09-10"
    # `_nightly_enabled` reaches `_nightly_declared` through self, so the stub needs it bound - which
    # is the same reason these three methods live in ToolkitGUI and not beside a plausible neighbour.
    panel._nightly_declared = lambda: ToolkitGUI._nightly_declared(panel)
    assert ToolkitGUI._nightly_enabled(panel) is False


def test_the_RUNNER_reads_the_same_file_with_the_same_defaults():
    """Deliberately crude, like the dispatcher test: it reads the SOURCE of the other half.

    What it pins is the pair of decisions that can rot apart without a single error message - the
    file the two halves read, and what each does when it is missing or unreadable. A PowerShell script
    and a Python panel cannot share a constant, so this is the only place the agreement can live.
    """
    source = RUNNER.read_text(encoding="utf-8")
    assert "config\\nightly.json" in source, "the runner must read the file the panel writes"
    assert "$enabled = $true" in source, "a missing file means ON on the runner's side too"
    assert "proseguo come ACCESO" in source, "an unreadable file must not read as OFF"
    # ...and it must SAY it did nothing on purpose, or «spento apposta» and «rotto» look the same.
    assert "SPENTO per tua decisione" in source
