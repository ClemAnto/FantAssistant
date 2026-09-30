"""R28 (gate §7-quinsexagies): R25 con il K del RUOLO, letto da `categories.BLEND_K` e mai fittato qui.

Due affermazioni: la miscela e' quella di R25 esattamente, con il K del ruolo classic al posto di quello
unico; e se R28 e R25 sono nello stesso set R28 la SOSTITUISCE invece di sommarsi.
"""

from __future__ import annotations

import pytest

from euroleghe_ingest.engine import categories, evaluate, model

from test_bonus_luck import _db, _fm, _prepare


def test_la_miscela_e_r25_col_k_del_ruolo(tmp_path):
    data = _prepare(_db(tmp_path))
    prior = _fm(data, ())
    r28 = _fm(data, ("R28",))
    obs = {o.fc_id: o for o in data.observations}
    k = categories.BLEND_K["A"]                      # il fixture e' fatto di attaccanti
    for fc_id, o in obs.items():
        assert r28[fc_id] == pytest.approx(
            model.blend_with_seen(prior[fc_id], o.fm_seen, float(o.pv_seen), k))
    assert r28[1] != pytest.approx(_fm(data, ("R25K40",))[1])


def test_r28_sostituisce_r25_e_non_si_somma(tmp_path):
    data = _prepare(_db(tmp_path))
    assert _fm(data, ("R25K40", "R28")) == pytest.approx(_fm(data, ("R28",)))
