"""engine - reference implementation of the prediction model and the out-of-sample GATE harness.

This package is NOT part of the ingest pipeline: it reads the DB and writes nothing but reports.
It exists because the project's golden rule (no rule enters the engine without beating the baseline
out of sample on two independent windows) had no executable form - the model lived in the documents
and in one-off notebooks, so nothing could actually be gated.

Layout:
    model.py     pure formulas and published reference values (no DB, no I/O)
    fitting.py   least squares, stdlib only
    features.py  DB -> per-window observations, with the look-ahead discipline enforced in one place
    evaluate.py  windows, cross-fit, metrics, gate, report

The shippable engine will be TypeScript in `app/prediction-engine`; this is the reference it gets
ported from, so the code stays dependency-free and explicit on purpose.
"""

from __future__ import annotations
