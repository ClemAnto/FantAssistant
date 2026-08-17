"""Il PRIOR PERSONALE del pannello a stagione iniziata: quanto muoverebbe, e se migliora.

RESPINTO il 16/08/2026 su dodici fogli su dodici (gate §7-tretricies): questo file resta perche' una
misura che nessuno puo' rifare e' un'opinione, e perche' il prerequisito per riaprire la voce e' scritto
li' - il prior costruito con l'aritmetica COMPLETA del pannello, non un peso diverso su questa forma.

Una variabile sola - il prior verso cui `_shrunk` tira - sulla VISTA vera (`SnapshotView`, la stessa che
disegna la board), su ogni foglio retrodatato che esiste. Giudice: `actual_next_started`, che il foglio
gia' porta - chi ha davvero iniziato la prima partita del club DOPO quel giorno.

Il prior personale e' approssimato con i minuti della stagione precedente sul calendario del SUO
campionato: la stessa aritmetica dello standing (`standing_weights` = (0, 1)) senza i lift. La copertura
e' dichiarata a schermo perche' e' meta' del numero - 58-60% sui fogli Serie A, 19-20% su euro - e chi
non ce l'ha tiene il prior di banda, cioe' non si muove.

Sola lettura sul DB e su `data/reports/`: non scrive niente e non tocca il codice spedito. Serve un
display (Tk), come ogni cosa che guida il pannello.

    python toolkit/bench/panel/prior_personale.py
"""
import sqlite3, statistics
from pathlib import Path
import tkinter as tk
from euroleghe_ingest.config import Config
from euroleghe_ingest.gui import SnapshotView, _replace_params
from euroleghe_ingest.engine import presence

cfg = Config()
conn = sqlite3.connect(f"file:{cfg.db_path}?mode=ro", uri=True)
REPORTS = cfg.data_dir / "reports"

def own_priors(prev_season: str) -> dict[int, float]:
    rounds = {league: n for league, n in conn.execute(
        "SELECT c.league, COUNT(DISTINCT mr.matchday) FROM match_ratings mr"
        " JOIN clubs c ON c.canonical_name = mr.team"
        " WHERE mr.season = ? AND mr.platform = 'default' AND c.league IS NOT NULL GROUP BY 1",
        (prev_season,))}
    out: dict[int, float] = {}
    for fc_id, minutes, competition in conn.execute(
            "SELECT fc_id, SUM(COALESCE(minutes,0)), competition FROM external_stats"
            " WHERE season = ? AND source = 'sofascore' GROUP BY fc_id, competition", (prev_season,)):
        if minutes and competition in rounds:
            out[fc_id] = max(out.get(fc_id, 0.0), min(minutes / (rounds[competition] * 90.0), 1.0))
    return out

def elevens(view, mode="typical"):
    out = {}
    for club, info in view.clubs.items():
        try:
            shape, _why = view.board_shape(club, info, mode)
            out[club] = (shape, [r["name"] for _x, r, _o in view.eleven(club, shape, mode)])
        except Exception as exc:                                     # noqa: BLE001
            out[club] = (f"error {exc}", [])
    return out

SHEETS = [
    ("2024-25-default-classic-leghe-2024-09-05", "2023-24"),
    ("2024-25-default-mantra-leghemantra-2024-09-05", "2023-24"),
    ("2024-25-euro-mantra-euroleghe-2024-09-05", "2023-24"),
    ("2024-25-default-classic-leghe-2025-02-05", "2023-24"),
    ("2024-25-default-mantra-leghemantra-2025-02-05", "2023-24"),
    ("2024-25-euro-mantra-euroleghe-2025-02-05", "2023-24"),
    ("2025-26-default-classic-leghe-2025-09-05", "2024-25"),
    ("2025-26-default-mantra-leghemantra-2025-09-05", "2024-25"),
    ("2025-26-euro-mantra-euroleghe-2025-09-05", "2024-25"),
    ("2025-26-default-classic-leghe-2026-02-05", "2024-25"),
    ("2025-26-default-mantra-leghemantra-2026-02-05", "2024-25"),
    ("2025-26-euro-mantra-euroleghe-2026-02-05", "2024-25"),
]
priors_cache: dict[str, dict[int, float]] = {}
base_inputs = SnapshotView.presence_inputs
print(f"{'foglio':<46} {'cop.':>5} {'claim mossi':>12} {'|d|':>6} {'moduli':>7} {'uomini':>8}"
      f" {'oggi':>7} {'personale':>10}")
totals = [0, 0, 0, 0]
for name, prev in SHEETS:
    folder = REPORTS / f"auction-snapshot-{name}"
    if not folder.exists():
        print(f"{name:<46} manca"); continue
    own = priors_cache.setdefault(prev, own_priors(prev))
    root = tk.Tk(); root.withdraw()
    try:
        view = SnapshotView(root, cfg)
        view.load_sheet(folder, apply_rulings=False)
        rows = view.players
        covered = sum(1 for r in rows if int(r["fc_id"]) in own)

        def personal(self, row, _own=own):
            inputs = base_inputs(self, row)
            mine = _own.get(int(row.get("fc_id") or 0))
            return inputs if mine is None else _replace_params(inputs, standing_prior=mine)

        before, before_claim = elevens(view), {r["fc_id"]: view.claim(r, "season") for r in rows}
        SnapshotView.presence_inputs = personal
        view._standing_prior = "unset"; view._prior_by_band = {}
        after, after_claim = elevens(view), {r["fc_id"]: view.claim(r, "season") for r in rows}
        SnapshotView.presence_inputs = base_inputs
        moved = [abs(before_claim[k] - after_claim[k]) for k in before_claim
                 if abs(before_claim[k] - after_claim[k]) > 0.005]
        shapes = sum(1 for c in before if before[c][0] != after[c][0])
        men = sum(len(set(before[c][1]) - set(after[c][1])) for c in before)
        started = {r["name"] for r in rows
                   if str(r.get("actual_next_started") or "") in ("1", "1.0", "True")}
        hits = [sum(len(set(m) & started) for _s, m in boards.values()) for boards in (before, after)]
        drawn = 11 * len(before)
        totals[0] += hits[0]; totals[1] += hits[1]; totals[2] += drawn; totals[3] += men
        print(f"{name:<46} {covered/len(rows):>4.0%} {len(moved):>7}/{len(rows):<4}"
              f" {statistics.median(moved) if moved else 0:>6.3f} {shapes:>3}/{len(before):<3}"
              f" {men:>4}/{drawn:<3} {hits[0]:>7} {hits[1]:>10}"
              + ("" if started else "   (nessun esito)"))
    finally:
        SnapshotView.presence_inputs = base_inputs
        root.destroy()
print(f"\nTOTALE giudicato sull'esito: oggi {totals[0]}/{totals[2]} · prior personale {totals[1]}/{totals[2]}"
      f" · uomini spostati {totals[3]}")
