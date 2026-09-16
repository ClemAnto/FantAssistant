"""UN OROLOGIO SOLO, e il test legge il SORGENTE perche' nessuna corsa lo puo' vedere.

Decisione dell'operatore, 16/09/2026: le date di questo progetto sono in UTC. Non era una preferenza
fra due convenzioni equivalenti - il toolkit gia' datava in UTC quasi ovunque e l'app legge il suo
`realToday` in UTC, quindi le cinque righe rimaste sull'orologio locale erano una SECONDA convenzione
dentro un progetto che confronta date fra moduli e attraverso il bundle.

Due orologi divergono per le due ore dopo la mezzanotte italiana (una in inverno), che e' esattamente
la finestra in cui nessuno guarda - quindi un difetto del genere non si manifesta mai davanti a chi
potrebbe riconoscerlo, e si presenta come un giorno di scarto in un numero che nessuno sa spiegare.
Per questo la guardia e' un test sul sorgente e non un controllo a runtime: non c'e' un momento in cui
fallirebbe a comando.
"""

from __future__ import annotations

import re
from pathlib import Path

TOOLKIT = Path(__file__).resolve().parents[1]

#: Le forme che leggono l'orologio LOCALE. `date.today()` e `date.fromtimestamp(x)` senza fuso
#: restituiscono il giorno della macchina; le loro controparti con `tz=dt.UTC` no.
LOCAL_CLOCK = re.compile(r"date\.today\(\)|date\.fromtimestamp\([^)]*\)")


def _offenders() -> list[str]:
    found = []
    for path in sorted((TOOLKIT / "euroleghe_ingest").rglob("*.py")):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if "tz=dt.UTC" in line or "tz=timezone.utc" in line:
                continue
            if LOCAL_CLOCK.search(line):
                found.append(f"{path.relative_to(TOOLKIT)}:{number}: {line.strip()}")
    return found


def test_the_toolkit_keeps_ONE_clock_and_it_is_UTC():
    """Nessuna riga legge il giorno della macchina.

    Se questo test cade, la domanda non e' «va bene lo stesso?»: e' se quella data venga mai
    CONFRONTATA con una scritta altrove - nel DB, nel bundle, o dall'app - perche' allora i due
    orologi si incontrano. Le cinque righe trovate il 16/09/2026 lo erano tutte e cinque:
    `calendar.observed_on` (che l'app confronta col proprio `realToday`), `injuries.observed_on` (che
    viaggia nel bundle), l'ancora della forma, il riferimento della curva di mercato e la finestra del
    prossimo turno.

    L'eccezione legittima esiste e non e' stata trovata: una data che nessuno confronta con niente. Se
    ne nasce una, si aggiunge qui con la ragione accanto invece di allentare la regola.
    """
    offenders = _offenders()
    assert not offenders, (
        "orologio locale in un progetto che data in UTC:\n  " + "\n  ".join(offenders))
