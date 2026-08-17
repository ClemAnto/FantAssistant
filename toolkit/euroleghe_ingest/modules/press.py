"""press - the boards' EXTERNAL JUDGES: the press's dated forecast, and what the clubs actually did.

Item 0 of docs/model/todolist-formazioni-tipo-v1.md, born from the 08/08/2026 comparison (20 clubs,
4-6 sources each) that lived in scratchpad scripts and hand-copied JSON files. The standing rule
travels with the module: THE PRESS IS A JUDGE, NEVER AN INPUT OF THE CLAIM - nothing the engine or
the panel computes reads `press_formations`; the one reader is this module's own comparison report.

Three entry points, one module:
- IMPORT (`--import FILE --season YYYY-YY`): a JSON list of per-club entries lands in
  `press_formations` as a per-DAY fact (never backfillable, like `probable_starter`) and is archived
  under data/raw/press/ so the table survives `rebuild`.
- REINGEST (no options - what `rebuild` runs): replay every archived reference offline.
- COMPARE (`--sheet DIR`): extract, headlessly, what the Snapshot panel would draw for every club of
  the sheet - through the panel's own loader and the REAL functions (`board_shape` / `eleven` /
  `lanes_for`), never the columns that look like them (v9.38) - and score modules and shared XI men
  against the stored reference. Report: data/reports/press_comparison.json.

TWO JUDGES, and `--against` picks one.
- `press` is a FORECAST by other people, and the only judge that exists before a ball is kicked - which
  is why it is the one the auction sheet can be scored against.
- `outcome` is what the clubs DID: the modal shape of a finished season and its eleven most-started
  men (`outcome_reference`). Stronger evidence - nobody's opinion - and available only for a season
  already played, so it needs a back-dated sheet: `snapshot --season 2025-26 --date 2025-08-15`, then
  `press --sheet ... --against outcome`. It carries its own NULL MODEL, because 135 shared men of 220
  says nothing until «the same eleven as last year» is on the same page.

WHICH SHAPE STRING THE VERDICT USES IS DECIDED BY THE REFERENCE, not by preference (`compare(on=...)`).
The press writes four-number modules ('4-2-3-1'), so it is judged on the DRAWN picture after
`_reshape`: the provider's vocabulary counts wingers as midfielders, so our 4-5-1 IS the press's
4-2-3-1 only once the transformation has spoken (formazioni-tipo-v1.md §1). The outcome is counted off
`club_match_lineups`, which holds three lines and CANNOT say 4-2-3-1 at all - judged on the picture it
reads as a disagreement whenever a row was split, which is the same shape written twice (measured: 5
clubs of 20, the difference between 7 MATCH and 12). MATCH = the reference's module; ALT = one of the
alternatives it declares; DIFF = neither.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import random
import re
import unicodedata
from itertools import combinations
from pathlib import Path

from euroleghe_ingest.context import Context
from euroleghe_ingest.matching import build_pool_entry, club_identity, match_in_pool

NAME = "press"
DESCRIPTION = "the boards' external judges: the press's dated forecast, and the real outcome"
DEPENDS_ON: list[str] = []          # reads only its own raw files; the comparison reads a sheet folder
RAW_INPUTS: list[str] = ["press/press_<season>_<day>_<source>.json (written by --import)"]
NETWORK = False

# What a per-club entry may call its fields: the collector's vocabulary (typical_xi, ballottaggi,
# coach_web) is accepted on import and normalized to the table's own names.
_ENTRY_KEYS = {
    "coach": ("coach", "coach_web"),
    "module": ("module",),
    "module_alternatives": ("module_alternatives",),
    "xi": ("xi", "typical_xi"),
    "duels": ("duels", "ballottaggi"),
    "notes": ("notes",),
    "confidence": ("confidence",),
}
_JSON_COLUMNS = ("module_alternatives", "xi", "duels")


def _entry_value(entry: dict, field: str):
    for key in _ENTRY_KEYS[field]:
        if key in entry:
            return entry[key]
    return None


# ---------- il terzo giudice: i BALLOTTAGGI pubblicati (17/08/2026) ----------
# L'articolo delle «squadre-tipo» NON porta i moduli - verificato due volte scaricando la pagina: «modulo»,
# «3-5-2» e «4-3-3» compaiono zero volte, l'undici e' un grafico - e i numeri che nel 16/08 erano stati
# riportati su quel confronto sono stati RITIRATI perche' venivano dal riassunto automatico di un fetch, che
# li aveva dedotti. Quello che la pagina porta davvero, club per club, sono i BALLOTTAGGI e i RIGORISTI: due
# cose che il pannello produce, quindi due confronti veri. Entrano dalla stessa porta della stampa
# (`press_formations`, colonna `duels`), archiviati e datati come ogni riferimento, senza modulo ne' undici.
DUELS_FIELDS = ("Ballottaggi", "Rigoristi", "Punizioni e calci piazzati", "In bilico")
# L'ARTICOLO DELLA PREPOSIZIONE, e l'ordine delle alternative e' il difetto: con `del` per primo,
# «dell'Atalanta» veniva catturato come «l'Atalanta» e «della Roma» come «la Roma» - sette club su venti,
# cioe' esattamente quelli che nella prima misura «non si confrontavano». Le alternative vanno dalla piu'
# lunga alla piu' corta, e il `delI'` con la I maiuscola c'e' perche' la fonte lo scrive cosi' (Inter).
_CLUB_HEAD = re.compile(r"La probabile formazione (?:della|dell'|delI'|del|di)\s*(.+?)\s*20\d\d/\d\d")


def parse_duels_article(raw: str) -> list[dict]:
    """L'HTML dell'articolo -> le entry per club nel formato che `import_reference` accetta.

    Un club per `<h2>`, e i campi si prendono per ETICHETTA e non per posizione: la pagina si aggiorna e
    l'ordine dei paragrafi non e' una promessa. I nomi restano VERBATIM - la risoluzione in `fc_id` e' un
    problema di chi confronta, non di chi archivia, e un nome normalizzato in archivio e' un nome perso.
    """
    out: list[dict] = []
    for chunk in re.split(r"<h[23][^>]*>", raw)[1:]:
        head = re.sub(r"<[^>]+>", "", chunk.split("</h")[0]).strip()
        found = _CLUB_HEAD.match(head)
        if not found:
            continue
        text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", chunk)))
        fields: dict[str, list[str]] = {}
        for name in DUELS_FIELDS:
            # ...e il campo finisce a un'altra etichetta O ALLA FINE della sezione: l'ultimo paragrafo di
            # un club non ha un successore, e pretenderlo perdeva l'ultimo campo di quel club.
            hit = re.search(rf"{name}\s*:\s*(.+?)(?:{'|'.join(DUELS_FIELDS)}|Giovani in rampa"
                            rf"|Assenza prolungata|Rumor|Clicca qui|$)", text)
            if hit:
                fields[name] = [one.strip() for one in hit.group(1).split(",") if one.strip()]
        if not fields.get("Ballottaggi"):
            continue
        out.append({
            "club": found.group(1).strip(),
            # Ogni ballottaggio e' un GRUPPO di nomi, che sono due o tre: si tiene il gruppo e non le
            # coppie, perche' «A-B-C» dice che tre si giocano un posto e non che ci sono tre duelli.
            "duels": [[one.strip() for one in group.split("-") if one.strip()]
                      for group in fields["Ballottaggi"]],
            "notes": json.dumps({key.lower().replace(" ", "_"): value
                                 for key, value in fields.items() if key != "Ballottaggi"},
                                ensure_ascii=False),
            "confidence": "no module: the eleven is a graphic",
        })
    return out


def fetch_duels_url(ctx: Context, url: str, *, season: str, observed_on: str | None = None,
                source: str = "transfermarkt") -> tuple[str, int]:
    """Scarica l'articolo, lo parsa e lo importa come riferimento datato. Ritorna (giorno, club).

    Il client e' quello degli infortuni e non `requests` nudo: la fonte guarda l'impronta TLS. La pagina si
    AGGIORNA (l'edizione del 17/08 e' delle 11:10), quindi il giorno di osservazione e' parte del fatto.
    """
    from euroleghe_ingest.modules.injuries import _client

    session = _client()
    try:
        response = session.get(url, timeout=30)
    finally:
        session.close()
    if response.status_code != 200:
        print(f"[press] {url}: HTTP {response.status_code}, niente da importare")
        return "", 0
    entries = parse_duels_article(response.text)
    if not entries:
        print(f"[press] {url}: nessun club con ballottaggi - la pagina ha cambiato forma?")
        return "", 0
    day = observed_on or dt.datetime.now(tz=dt.UTC).date().isoformat()
    scratch = ctx.config.data_dir / "raw" / "press" / f"_incoming_{source}_{day}.json"
    scratch.parent.mkdir(parents=True, exist_ok=True)
    scratch.write_text(json.dumps({"season": season, "observed_on": day, "source": source,
                                   "clubs": entries}, ensure_ascii=False, indent=1), encoding="utf-8")
    import_reference(ctx, scratch, season=season, observed_on=day, source=source)
    archived = archive(ctx, season, day, source)
    scratch.unlink(missing_ok=True)
    print(f"[press] {len(entries)} club con ballottaggi -> press_formations ({season}, {day}, {source})"
          f" · archiviato {archived.name}")
    return day, len(entries)


# ---------- import / archive / reingest ----------
def import_reference(ctx: Context, path: Path | str, *, season: str | None = None,
                     source: str | None = None,
                     observed_on: str | None = None) -> tuple[str, str, str, int]:
    """One JSON file -> `press_formations`. Returns (season, observed_on, source, clubs written).

    Accepts the collector's format (a bare LIST of per-club entries, metadata from the arguments) and
    the self-describing archive wrapper ({season, observed_on, source, clubs}) - which is what makes
    `rebuild`'s replay need no arguments at all.
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        season = data.get("season") or season
        observed_on = data.get("observed_on") or observed_on
        source = data.get("source") or source
        entries = data.get("clubs") or []
    else:
        entries = data
    if not season:
        raise ValueError(f"{path}: the season the XI predicts is required (--season YYYY-YY)")
    observed_on = observed_on or dt.datetime.now(tz=dt.UTC).date().isoformat()
    source = source or "press"
    for entry in entries:
        values = {field: _entry_value(entry, field) for field in _ENTRY_KEYS}
        for field in _JSON_COLUMNS:
            if values[field] is not None and not isinstance(values[field], str):
                values[field] = json.dumps(values[field], ensure_ascii=False)
        ctx.conn.execute(
            "INSERT OR REPLACE INTO press_formations(club, season, observed_on, source, coach,"
            " module, module_alternatives, xi, duels, notes, confidence)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (entry["club"], season, observed_on, source, values["coach"], values["module"],
             values["module_alternatives"], values["xi"], values["duels"], values["notes"],
             values["confidence"]))
    ctx.conn.commit()
    return season, observed_on, source, len(entries)


def archive(ctx: Context, season: str, observed_on: str, source: str) -> Path:
    """Write data/raw/press/press_{season}_{observed_on}_{source}.json FROM the table.

    Rebuilt from the rows rather than copied from the import file, so the archive and the table can
    never disagree - and so two group files imported the same day MERGE into one archive per
    (season, day, source), which is the fact's own grain.
    """
    rows = ctx.conn.execute(
        "SELECT club, coach, module, module_alternatives, xi, duels, notes, confidence"
        " FROM press_formations WHERE season = ? AND observed_on = ? AND source = ? ORDER BY club",
        (season, observed_on, source)).fetchall()
    clubs = []
    for row in rows:
        entry = dict(zip(("club", "coach", "module", "module_alternatives", "xi", "duels", "notes",
                          "confidence"), row, strict=True))
        for field in _JSON_COLUMNS:
            if entry[field]:
                entry[field] = json.loads(entry[field])
        clubs.append(entry)
    folder = ctx.config.raw_dir / "press"
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"press_{season}_{observed_on}_{source}.json"
    dest.write_text(json.dumps({"season": season, "observed_on": observed_on, "source": source,
                                "clubs": clubs}, ensure_ascii=False, indent=1), encoding="utf-8")
    return dest


def reingest_from_raw(ctx: Context) -> tuple[int, int]:
    """Replay every archived reference (offline). Returns (files, club rows)."""
    folder = ctx.config.raw_dir / "press"
    files = sorted(folder.glob("press_*.json")) if folder.exists() else []
    total = 0
    for path in files:
        _, _, _, count = import_reference(ctx, path)
        total += count
    return len(files), total


# ---------- the comparison ----------
def load_reference(conn, season: str, source: str | None = None) -> dict[str, dict]:
    """Per club IDENTITY, the latest dated reading for the season.

    Ordered by (observed_on, source) with the last row winning, so when two sources publish the same
    day the choice is deterministic and the report can say which reading judged each club.
    """
    sql = ("SELECT club, observed_on, source, coach, module, module_alternatives, xi, duels,"
           " confidence FROM press_formations WHERE season = ?")
    params: list = [season]
    if source:
        sql += " AND source = ?"
        params.append(source)
    out: dict[str, dict] = {}
    for row in conn.execute(sql + " ORDER BY observed_on, source", params):
        entry = dict(zip(("club", "observed_on", "source", "coach", "module",
                          "module_alternatives", "xi", "duels", "confidence"), row, strict=True))
        for field in _JSON_COLUMNS:
            if entry.get(field):
                entry[field] = json.loads(entry[field])
        out[club_identity(entry["club"])] = entry
    return out


def outcome_reference(conn, season: str, clubs: list[str] | None = None,
                      alt_share: float = 0.20) -> dict[str, dict]:
    """THE SECOND JUDGE: what each club actually did, in the same shape as the press reference.

    Better than the press on two counts and worse on none. It is an OUTCOME rather than a forecast -
    nobody's opinion, just the elevens that were fielded - and it is counted in the SAME vocabulary as
    our own boards (`club_match_lineups` counts the provider's three lines, exactly as `lanes_for`
    does), so the 4-5-1/4-2-3-1 translation that muddies every press comparison does not exist here.

    - `module` = the modal shape of the season's complete elevens; `module_alternatives` = every other
      shape it fielded in at least `alt_share` of them, which is what makes ALT mean the same thing it
      means for the press («the alternative the source itself declares»).
    - `xi` = the ELEVEN MOST-STARTED men of the season. Not a line-by-line eleven: a club that changed
      shape has no single one, and the question the boards answer is «who plays», so the eleven men who
      played most is the honest target. Counted over the CHAMPIONSHIP alone, like every other share of
      a season in this project.
    """
    from euroleghe_ingest import config
    from euroleghe_ingest.modules.snapshot import lineup_spellings, typical_formation

    holes = ",".join("?" * len(config.CHAMPIONSHIPS))
    wanted = clubs or [row[0] for row in conn.execute(
        """SELECT DISTINCT c.canonical_name FROM rosters r JOIN clubs c USING(fc_club_id)
           WHERE r.season = ? AND c.canonical_name IS NOT NULL ORDER BY 1""", (season,))]
    # ...through the CANONICAL KEY, because `club_match_lineups` is keyed on the provider's spelling
    spellings = lineup_spellings(conn, lambda name: (club_identity(name), name))
    out: dict[str, dict] = {}
    for club in wanted:
        mine = spellings.get(club_identity(club), [club])
        shapes = typical_formation(conn, mine, season)
        if not shapes.shape:
            continue
        counts: dict[str, int] = {}
        for part in (shapes.shapes or "").split(";"):
            shape, _, count = part.partition(":")
            if shape.strip() and count.strip().isdigit():
                counts[shape.strip()] = int(count)
        total = sum(counts.values()) or 1
        alternatives = [shape for shape, count in counts.items()
                        if shape != shapes.shape and count / total >= alt_share]
        club_holes = ",".join("?" * len(mine))
        starters = [name for name, in conn.execute(
            f"""SELECT p.canonical_name FROM external_match_stats e
                JOIN players p USING(fc_id)
                WHERE e.season = ? AND e.started = 1 AND e.club IN ({club_holes})
                  AND e.competition IN ({holes})
                GROUP BY e.fc_id ORDER BY COUNT(*) DESC, SUM(COALESCE(e.minutes, 0)) DESC
                LIMIT 11""",
            (season, *mine, *config.CHAMPIONSHIPS))]
        if len(starters) < 11:
            continue
        out[club_identity(club)] = {
            "club": club, "observed_on": f"{season} (outcome)", "source": "outcome",
            "coach": None, "module": shapes.shape, "module_alternatives": alternatives,
            "xi": {"XI": starters}, "duels": [], "confidence": f"{shapes.counted} XIs",
        }
    return out


def null_model(conn, season: str, reference: dict[str, dict]) -> dict:
    """The baseline the outcome verdict has to beat: LAST SEASON'S answer, for the same clubs.

    «A statistic must be compared with the right null, never with zero» - the rule this project paid
    for on the hot-hand measurement. 135 shared men of 220 means nothing on its own: the question is
    whether the boards beat «the same eleven as last year, in the same shape», which is free and which
    the model's own strongest input (the club's habit) already contains.

    A promoted club has no previous season in this league at all, so the null cannot answer for it -
    counted and reported apart rather than scored as a miss, because «0 of 11» there is a property of
    the baseline and not evidence about it.
    """
    previous = f"{int(season[:4]) - 1}-{int(season[:4]) % 100:02d}"
    prior = outcome_reference(conn, previous, clubs=[entry["club"] for entry in reference.values()])
    out = {"season": previous, "module_match": 0, "module_alt": 0, "module_diff": 0,
           "xi_shared": 0, "xi_of": 0, "no_previous": 0}
    for key, entry in reference.items():
        out["xi_of"] += len(entry["xi"].get("XI") or [])
        mine = prior.get(key)
        if not mine:
            out["no_previous"] += 1
            continue
        out["xi_shared"] += sum(1 for name in (entry["xi"].get("XI") or [])
                                if any(_names_match(name, other)
                                       for other in (mine["xi"].get("XI") or [])))
        if mine["module"] == entry["module"]:
            out["module_match"] += 1
        elif mine["module"] in (entry.get("module_alternatives") or []):
            out["module_alt"] += 1
        else:
            out["module_diff"] += 1
    return out


def _name_tokens(name: str) -> set[str]:
    """Surname tokens, accent- and punctuation-free, initials dropped."""
    flat = unicodedata.normalize("NFKD", name or "")
    flat = "".join(ch for ch in flat if not unicodedata.combining(ch))
    flat = flat.replace("'", "").replace("-", " ").replace(".", " ").lower()
    return {token for token in flat.split() if len(token) > 2}


def _names_match(one: str, other: str) -> bool:
    return bool(_name_tokens(one) & _name_tokens(other))


# The board extraction lives in `boards.py`: it has two callers with OPPOSITE needs - the judges must not
# score the operator's own rulings, the panel's data path must honour them - and a shared function is the only
# way the two cannot drift. Imported rather than wrapped so `press.extract_boards` still resolves.
from euroleghe_ingest.modules.boards import extract_boards


def compare(boards: dict[str, dict], reference: dict[str, dict],
            on: str = "picture") -> tuple[list[dict], dict]:
    """Score the boards against the reference: per club, the module verdict and the XI overlap.

    `on` picks WHICH OF OUR TWO SHAPE STRINGS is comparable, and it is not a preference: it is decided
    by what the reference can express. The press writes four-number modules ('4-2-3-1'), so it is
    judged against the DRAWN picture after `_reshape`. The outcome is counted off `club_match_lineups`,
    which holds the provider's three lines and therefore CANNOT say 4-2-3-1 at all - judged on the
    picture it reads as a disagreement whenever the transformation split a row, which is the same shape
    written two ways: Atalanta's 3-4-3 drawn 3-4-1-2, Roma's 3-4-3 drawn 3-4-2-1, Como's 4-5-1 drawn
    4-4-1-1. Measured, that artifact alone was 5 clubs of 20 - the difference between 7 MATCH and 12.

    Clubs join by IDENTITY (`club_identity`), never by the string a source spelled - the join that
    silently lost Milan, Roma and Napoli once already. XI names match on shared surname tokens, both
    directions, so 'Martinez L.' finds 'Lautaro Martinez'.
    """
    by_identity = {club_identity(club): (club, board) for club, board in boards.items()}
    rows: list[dict] = []
    for identity in sorted(reference, key=lambda key: reference[key]["club"]):
        entry = reference[identity]
        _club, board = by_identity.get(identity, (entry["club"], None))
        base = {"club": entry["club"], "observed_on": entry["observed_on"],
                "source": entry["source"], "press_module": entry["module"],
                "press_alt": entry.get("module_alternatives") or [],
                "press_confidence": (entry.get("confidence") or "")[:6]}
        if board is None or "error" in board:
            rows.append({**base, "status": "NO BOARD",
                         "error": (board or {}).get("error", "club not on the sheet")})
            continue
        press_xi = [name for line in (entry.get("xi") or {}).values() for name in line]
        our_names = [man["name"] for line in ("P", "D", "M", "T", "A")
                     for man in (board["lines"].get(line) or [])]
        shared = [name for name in press_xi if any(_names_match(name, ours) for ours in our_names)]
        drawn = board["picture"] if on == "picture" else board["board_shape"]
        # an alternative may carry a free-text qualifier («4-2-3-1 (in partita)»): the module is its
        # first token
        verdict = ("MATCH" if drawn == entry["module"] else
                   "ALT" if any(drawn == alt.split(" ")[0] for alt in base["press_alt"]) else
                   "DIFF")
        rows.append({**base, "our_board": board["board_shape"], "our_drawn": drawn,
                     "module": verdict, "xi_shared": len(shared), "xi_of": len(press_xi),
                     "only_press": [name for name in press_xi if name not in shared],
                     "only_ours": [ours for ours in our_names
                                   if not any(_names_match(name, ours) for name in press_xi)]})
    scored = [row for row in rows if "module" in row]
    summary = {
        "judged_on": on,
        "clubs": len(rows),
        "no_board": len(rows) - len(scored),
        "module_match": sum(1 for row in scored if row["module"] == "MATCH"),
        "module_alt": sum(1 for row in scored if row["module"] == "ALT"),
        "module_diff": sum(1 for row in scored if row["module"] == "DIFF"),
        "xi_shared": sum(row["xi_shared"] for row in scored),
        "xi_of": sum(row["xi_of"] for row in scored),
    }
    return rows, summary


def _pool_of(conn, season: str, club_key_wanted: str):
    """Il pool di nomi di UN club per il matcher: (fc_id, nome, base, iniziale)."""
    rows = conn.execute(
        """SELECT r.fc_id, p.canonical_name, c.canonical_name FROM rosters r
           JOIN players p ON p.fc_id = r.fc_id
           LEFT JOIN clubs c ON c.fc_club_id = r.fc_club_id
           WHERE r.season = ?""", (season,)).fetchall()
    return [build_pool_entry(int(fc_id), name) for fc_id, name, club in rows
            if club_identity(club) == club_key_wanted]


def judge_duels(conn, boards: dict, reference: dict, season: str) -> dict:
    """I nostri BALLOTTAGGI contro quelli pubblicati, con il suo null. Un dizionario, non una stampa.

    LA RISOLUZIONE PASSA DAL MATCHER e non dal cognome esatto, e la differenza e' misurata: col cognome
    esatto dentro il club, 41 gruppi su 89 non si risolvevano affatto (la fonte scrive «Samardcic» dove il
    listone ha «Samardzic») e sette club su venti restavano fuori dal confronto. `match_in_pool` e' lo stesso
    imbuto che il modulo infortuni paga da mesi, e un nome ambiguo resta NON risolto invece di diventare il
    primo candidato: un abbinamento sbagliato e' peggio di uno mancante.

    IL NULL: al posto del nostro rivale si mette un uomo qualunque dello stesso club, e si guarda quante
    volte si beccherebbe comunque un loro ballottaggio. Senza quello, «18 coppie in comune» non e' un numero.
    """
    out = {"clubs": 0, "theirs": 0, "ours": 0, "shared": 0, "unresolved": 0,
           "null_hits": 0, "null_trials": 0, "per_club": {}}
    random.seed(20260817)
    for club, board in boards.items():
        key = club_identity(club)
        entry = reference.get(key)
        if not entry or not entry.get("duels"):
            continue
        groups = entry["duels"] if isinstance(entry["duels"], list) else json.loads(entry["duels"])
        pool = _pool_of(conn, season, key)
        if not pool:
            continue
        def resolve(name: str, pool=pool) -> int | None:
            # `pool` legato adesso e non alla chiamata: in un ciclo una chiusura che lo cerca fuori
            # risolverebbe i nomi di un club nel pool dell'ULTIMO, che e' il modo silenzioso di
            # abbinare la persona sbagliata.
            tier, found = match_in_pool(name, pool)
            return int(found[0][0]) if tier and len(found) == 1 else None
        theirs: set[frozenset] = set()
        for group in groups:
            people = [resolve(one) for one in (group if isinstance(group, list) else [group])]
            if any(one is None for one in people) or len(people) < 2:
                out["unresolved"] += 1
                continue
            theirs |= {frozenset(pair) for pair in combinations(people, 2)}
        ours: set[frozenset] = set()
        for line in (board.get("lines") or {}).values():
            for man in line:
                mine = man.get("fc_id")
                for rival in man.get("duels") or []:
                    if mine and rival.get("fc_id"):
                        ours.add(frozenset({int(mine), int(rival["fc_id"])}))
        if not theirs:
            continue
        out["clubs"] += 1
        out["theirs"] += len(theirs)
        out["ours"] += len(ours)
        out["shared"] += len(ours & theirs)
        out["per_club"][club] = {"theirs": len(theirs), "ours": len(ours),
                                 "shared": len(ours & theirs)}
        squad = [entry_row[0] for entry_row in pool]
        for pair in ours:
            first = min(pair)
            for _ in range(50):
                other = random.choice(squad)
                if other == first:
                    continue
                out["null_trials"] += 1
                out["null_hits"] += frozenset({first, other}) in theirs
    out["recall"] = round(out["shared"] / out["theirs"], 4) if out["theirs"] else None
    out["precision"] = round(out["shared"] / out["ours"], 4) if out["ours"] else None
    out["null"] = round(out["null_hits"] / out["null_trials"], 4) if out["null_trials"] else None
    return out


def compare_sheet(ctx: Context, sheet: Path, *, mode: str = "typical", source: str | None = None,
                  against: str = "press", report: bool = True) -> dict | None:
    """The repeatable judgement: sheet folder in, per-club verdicts and one summary out.

    Two judges, and `against` picks one. `press` is a FORECAST by other people, available for the
    season being auctioned - the only judge that exists before a ball is kicked. `outcome` is what the
    clubs actually did, available only for a season already played: it needs a back-dated sheet
    (`snapshot --season 2025-26 --date 2025-08-15`) and it is the stronger evidence of the two, because
    it is nobody's opinion and it is counted in the same vocabulary as our own boards.
    """
    manifest = json.loads((sheet / "manifest.json").read_text(encoding="utf-8"))
    season = manifest.get("target_season")
    if against == "outcome":
        reference = outcome_reference(ctx.conn, season)
    elif against == "duels":
        # IL RIFERIMENTO DEI BALLOTTAGGI HA UNA SUA FONTE, e prenderlo con `source=None` era il difetto:
        # `load_reference` restituiva l'ultima lettura QUALUNQUE - cioè le formazioni della stampa dell'08/08,
        # che portano i ballottaggi di un'altra stagione - e il giudice leggeva «0 club, 97 gruppi non
        # risolti», che suona come una fonte vuota e invece era la fonte sbagliata.
        reference = load_reference(ctx.conn, season, source=source or "transfermarkt")
    else:
        reference = load_reference(ctx.conn, season, source=source)
    if not reference:
        print(f"[press] no {against} reference for {season}"
              + (f" from source {source}" if source else "")
              + (" - import one first (press --import FILE --season ...)" if against == "press"
                 else " - the season has no complete elevens on file"))
        return None
    # WITHOUT the operator's rulings: a ruling is often made looking at this very judge, and a
    # judge must never score the operator's own answers. The default is False; saying it here
    # anyway is the point - this is the one call for which it is a decision and not a default.
    # I DUELLI VANNO CHIESTI, o la board li butta (`_placed` ritorna `(x, starter, rivals)` e senza il
    # flag i rivali non arrivano): il giudice dei ballottaggi leggeva «nostre 0» contro le loro 80, che è
    # esattamente lo zero uniforme che questo progetto ha imparato a NON credere - era la chiamata.
    boards = extract_boards(ctx.config, sheet, mode=mode, apply_rulings=False,
                            with_rivals=(against == "duels"))
    if against == "outcome":
        # the outcome reference covers every club with elevens on file (46 for 2025-26, all five
        # leagues); a sheet is one platform's perimeter, so score the intersection and say so
        wanted = {club_identity(club) for club in boards}
        reference = {key: entry for key, entry in reference.items() if key in wanted}
    if against == "duels":
        # Il TERZO giudice non parla di moduli: l'articolo non li porta (verificato due volte). Quindi non
        # si passa da `compare`, che conta forme e uomini, ma dal confronto sui BALLOTTAGGI col suo null.
        verdict = judge_duels(ctx.conn, boards, reference, season)
        print(f"[press] {sheet.name} vs {verdict['clubs']} club di «{source or 'transfermarkt'}»: "
              f"in comune {verdict['shared']} · loro {verdict['theirs']} (recall "
              f"{(verdict['recall'] or 0):.1%}) · nostre {verdict['ours']} (precisione "
              f"{(verdict['precision'] or 0):.1%}) · NULL {(verdict['null'] or 0):.1%} · "
              f"{verdict['unresolved']} gruppi non risolti")
        if report:
            out = ctx.config.data_dir / "reports" / "press_duels.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps({"sheet": sheet.name, "season": season, **verdict},
                                      indent=1, ensure_ascii=False), encoding="utf-8")
            print(f"[press] report -> {out}")
        return verdict
    on = "board" if against == "outcome" else "picture"
    rows, summary = compare(boards, reference, on=on)
    # ...and the SAME comparison on our other shape string, which quantifies how much of the
    # disagreement is VOCABULARY rather than disposition (item 6b). Not a tolerance and not a second
    # verdict: the verdict stays the one the reference can express (see `compare`). It is a reading -
    # our 4-5-1 and the press's 4-2-3-1 are the same eleven counted two ways, and the pair of numbers
    # says how many clubs sit on that difference instead of leaving it as an anecdote.
    other = "board" if on == "picture" else "picture"
    _rows_other, summary_other = compare(boards, reference, on=other)
    null = null_model(ctx.conn, season, reference) if against == "outcome" else None
    print(f"[press] {sheet.name} vs {len(reference)} {against} club(s):"
          f" module MATCH {summary['module_match']}, ALT {summary['module_alt']},"
          f" DIFF {summary['module_diff']}"
          + (f", NO BOARD {summary['no_board']}" if summary["no_board"] else "")
          + f" | men {summary['xi_shared']}/{summary['xi_of']}")
    print(f"[press] the same boards judged on the {other} instead:"
          f" MATCH {summary_other['module_match']}, ALT {summary_other['module_alt']},"
          f" DIFF {summary_other['module_diff']} - the difference is VOCABULARY, not disposition"
          f" (a reading, never the verdict)")
    if null:
        print(f"[press] NULL MODEL for the same clubs (last season's eleven most-started men, and its"
              f" modal shape): module MATCH {null['module_match']}, ALT {null['module_alt']},"
              f" DIFF {null['module_diff']} | men {null['xi_shared']}/{null['xi_of']}"
              f" · {null['no_previous']} club(s) had no previous season at all (promoted), which the"
              f" null cannot answer and the boards can")
    for row in rows:
        if "module" not in row:
            print(f"  {row['club']:14s} NO BOARD (press: {row['press_module']}) - {row['error']}")
            continue
        print(f"  {row['club']:14s} press {row['press_module']:8s} ours {row['our_drawn']:8s}"
              f" [{row['module']:5s}] XI {row['xi_shared']:2d}/{row['xi_of']:2d}"
              f" | press-only: {', '.join(row['only_press']) or '-'}"
              f" | ours-only: {', '.join(row['only_ours']) or '-'}")
    payload = {
        "generated_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
        "sheet": sheet.name, "season": season, "mode": mode, "against": against,
        "summary": summary, "summary_on_" + other: summary_other, "null_model": null,
        "clubs": rows,
    }
    if report:
        dest = ctx.config.data_dir / "reports" / (
            "press_comparison.json" if against == "press" else "board_outcome_check.json")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[press] report -> {dest}")
    return payload


def run(ctx: Context, *, import_files: list[str] | None = None, season: str | None = None,
        source: str | None = None, observed_on: str | None = None, sheet: str | None = None,
        against: str = "press", report: bool = True, fetch_duels: str | None = None,
        **_kwargs) -> None:
    if fetch_duels:
        if not season:
            raise ValueError("--fetch-duels needs the season the article predicts (--season YYYY-YY)")
        fetch_duels_url(ctx, fetch_duels, season=season, observed_on=observed_on,
                        source=source or "transfermarkt")
    if import_files:
        for path in import_files:
            file_season, day, src, count = import_reference(
                ctx, path, season=season, source=source, observed_on=observed_on)
            archived = archive(ctx, file_season, day, src)
            print(f"[press] {path}: {count} club(s) -> press_formations"
                  f" ({file_season}, {day}, {src}) · archived {archived.name}")
    elif not sheet:
        files, clubs = reingest_from_raw(ctx)
        if files:
            print(f"[press] {files} archived reference file(s) re-ingested ({clubs} club rows)")
        else:
            print("[press] nothing to do: no archived reference under data/raw/press/. Import one "
                  "with --import FILE --season YYYY-YY, or judge a sheet with --sheet DIR.")
    if sheet:
        compare_sheet(ctx, Path(sheet), source=source, against=against, report=report)
