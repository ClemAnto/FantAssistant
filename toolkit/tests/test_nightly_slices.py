"""The nightly's SLICES (`scripts/nightly-update.ps1`): every acquisition step in exactly one of them.

The slices group the plan by CADENCE (operator, 27/10/2026), and a list kept by hand in a PowerShell
script can lose a step in silence - a new step added to `bootstrap` would simply never run at night, and
nothing would say so. The script and the plan are in two languages, so the agreement lives here, read
from the script's source like the switch test does.
"""
from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

from euroleghe_ingest.modules import bootstrap

RUNNER = Path(__file__).resolve().parents[2] / "scripts" / "nightly-update.ps1"


def _slices() -> dict[str, list[str]]:
    source = RUNNER.read_text(encoding="utf-8")
    table = source.split("$Slices = @(", 1)[1].split("\n)\n", 1)[0]
    out: dict[str, list[str]] = {}
    for block in re.split(r"\[pscustomobject\]@\{", table)[1:]:
        name = re.search(r"Name = '([^']+)'", block).group(1)
        out[name] = re.findall(r"'--step', '([^']+)'", block)
    return out


def test_every_acquisition_step_is_in_exactly_one_slice():
    slices = _slices()
    counted = Counter(step for steps in slices.values() for step in steps)
    plan = [step.key for step in bootstrap.plan()]
    missing = [key for key in plan if counted[key] == 0]
    twice = [key for key, n in counted.items() if n > 1]
    unknown = [key for key in counted if key not in plan]
    assert not missing, f"never run at night: {missing}"
    assert not twice, f"in more than one slice: {twice}"
    assert not unknown, f"not a step of the plan: {unknown}"


def test_no_slice_is_longer_than_two_hours_and_the_build_runs_every_night():
    source = RUNNER.read_text(encoding="utf-8")
    minutes = [int(m) for m in re.findall(r"Minutes = (\d+)", source)]
    assert minutes and max(minutes) <= 120, "the operator's rule: at most a couple of hours a slice"
    build = source.split("Name = 'build'", 1)[1].split("Why", 1)[0]
    assert "Days = @()" in build, "the deliverable is built every night, whatever was acquired"
