"""Una costante trascritta nei DUE linguaggi e' un fatto con due lettori, e i due devono dire lo stesso.

Il motore vive in Python e l'app in TypeScript, quindi un numero che serve a tutti e due non si puo'
importare: si trascrive. Questo repository ha gia' pagato la forma peggiore di quel problema - «due
definizioni finiscono per dare a un uomo due numeri» - e ci aveva gia' risposto due volte, ma una alla
volta: `test_engine_projection` legge la scala di `projection.ts` invece di copiarla (la copia di
riferimento in `engine/` era divergiata dalla spedita DENTRO L'ORA in cui era stata scritta), e
`test_swing_ladder` fa lo stesso per la scala dei gol.

Qui la stessa domanda si fa una volta per tutte e senza un elenco da mantenere: si prendono le costanti
NUMERICHE che portano lo STESSO NOME nei due alberi e si chiede che valgano lo stesso. Misurato il
23/09/2026: tredici nomi condivisi, **dodici concordi** - `ANCHOR_SCORE`, `ANCHOR_TOP`, `LOW_CURVE`,
`CLUB_PRIOR`, `DEPTH_TIER`, `DEPTH_HANDS`, `DEPTH_WEIGHT`, `QUOTA_DEPTH`, `PASS_MARK`,
`PERIMETER_SQUAD_MIN`, `REF_TEAMS`, `REF_BUDGET` - e uno diverso apposta, dichiarato qui sotto.

Il test NON dice che una costante debba stare in due posti: dice che finche' ci sta, i due posti sono
d'accordo. E prende da se' quelle che qualcuno aggiungera' domani, che e' la differenza fra un guardiano
e una lista.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from euroleghe_ingest.config import REPO_ROOT

#: Lo stesso NOME per due domande diverse, e i due alberi lo sanno. In Python `FULL_MATCH` e' il pavimento
#: dei minuti della scala della titolarita' («e' stata una sua partita?», 75); nell'app e' «quanto dura una
#: partita intera», cioe' «e' stato sostituito?» (90). Il fatto che il Python chiama `FULL_MATCH` nell'app
#: si chiama `PLAYED_THE_MATCH` e vale 75, e `match-bonuses.ts` lo dichiara per esteso accanto a tutt'e
#: due. Non e' un disaccordo: e' una collisione di nomi attraverso il confine, scritta invece che curata
#: perche' rinominare una costante dell'engine per un'omonimia dell'app costerebbe piu' di quanto valga.
DIFFERENT_ON_PURPOSE: dict[str, str] = {
    "FULL_MATCH": "75 in engine/status.py = «e' stata una sua partita?» (l'app lo chiama "
                  "PLAYED_THE_MATCH); 90 nell'app = «e' stato sostituito?»",
}

PY_CONST = re.compile(r"^([A-Z][A-Z0-9_]{3,})(?::\s*[^=]+)?\s*=\s*(-?\d+(?:\.\d+)?)\s*(?:#.*)?$")
TS_CONST = re.compile(r"^\s*(?:export )?const ([A-Z][A-Z0-9_]{3,})\s*(?::\s*[^=]+)?=\s*"
                      r"(-?[\d_]+(?:\.\d+)?)\s*;")


def _python() -> dict[str, set[tuple[str, float]]]:
    out: dict[str, set[tuple[str, float]]] = {}
    for path in sorted((REPO_ROOT / "toolkit").rglob("*.py")):
        if ".venv" in path.parts or "tests" in path.parts:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            found = PY_CONST.match(line)
            if found:
                out.setdefault(found.group(1), set()).add(
                    (f"{path.name}:{number}", float(found.group(2))))
    return out


def _typescript() -> dict[str, set[tuple[str, float]]]:
    out: dict[str, set[tuple[str, float]]] = {}
    for path in sorted((REPO_ROOT / "app" / "src").rglob("*.ts")):
        if path.name.endswith(".spec.ts"):
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            found = TS_CONST.match(line)
            if found:
                out.setdefault(found.group(1), set()).add(
                    (f"{path.name}:{number}", float(found.group(2).replace("_", ""))))
    return out


def test_a_constant_transcribed_into_BOTH_languages_says_the_same_number():
    if not (REPO_ROOT / "app" / "src").exists():
        pytest.skip("app/src not present")
    python, typescript = _python(), _typescript()
    shared = sorted(set(python) & set(typescript))
    # Se la lettura si rompe, un test verde su zero nomi direbbe «nessun problema» dopo aver guardato
    # niente: il difetto che questo repository si e' gia' scritto due volte.
    assert len(shared) >= 10, f"solo {len(shared)} nomi condivisi trovati: il lettore non morde"
    disagree = {}
    for name in shared:
        if name in DIFFERENT_ON_PURPOSE:
            continue
        values = {value for _, value in python[name]} | {value for _, value in typescript[name]}
        if len(values) > 1:
            disagree[name] = sorted(python[name] | typescript[name])
    assert not disagree, "stesso nome, numeri diversi:\n  " + "\n  ".join(
        f"{name}: " + ", ".join(f"{where}={value:g}" for where, value in sites)
        for name, sites in sorted(disagree.items()))


def test_a_declared_exception_is_still_a_SHARED_name_and_still_differs():
    """Un'eccezione che non serve piu' e' un buco con un commento sopra.

    Se `FULL_MATCH` smette di esistere da una delle due parti, o se i due valori tornano a coincidere,
    l'eccezione va tolta invece di restare a coprire il prossimo disaccordo sullo stesso nome.
    """
    if not (REPO_ROOT / "app" / "src").exists():
        pytest.skip("app/src not present")
    python, typescript = _python(), _typescript()
    for name in DIFFERENT_ON_PURPOSE:
        assert name in python and name in typescript, f"{name} non e' piu' condiviso: togli l'eccezione"
        values = {value for _, value in python[name]} | {value for _, value in typescript[name]}
        assert len(values) > 1, f"{name} ora concorda: togli l'eccezione invece di lasciarla coprire"
