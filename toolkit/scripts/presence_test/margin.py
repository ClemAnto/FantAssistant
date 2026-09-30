"""Where the margin is: per group, the formula's and the engine's error against the floor of a perfect formula."""
import json, sys
from collections import defaultdict
from statistics import mean
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE.parents[1]))
import floor as F
bench = json.load(open(HERE.parents[2] / 'data' / 'export' / '2026-27' / 'presence_test.json', encoding='utf-8'))
byk = {(r['window'], r['fcId']): r for r in bench['rows'] if r['moment'] == 'settembre'}
joined = []
for x in F.people:
    r = byk.get((x['window'], x['fc_id']))
    if r and r['paEngine'] is not None:
        joined.append((x, r))
def group_of(r, x):
    if r['context'] == 'nessuna': return 'nessuna stagione su file'
    if r['context'].startswith('portiere'): return r['context']
    if r['clubChange']: return 'cambio club (' + ('dalla Serie A' if r['context'].startswith('serie A') else 'dall\'estero') + ')'
    return 'stesso club, ' + ('titolare' if (r['s'] or 0) >= 0.6 else 'riserva/rotazione')
groups = defaultdict(list)
for x, r in joined:
    groups[group_of(r, x)].append((x, r))
tot_red = sum(abs(r['paFormula'] - r['paActual']) - x['floor'] for x, r in joined)
print(f"{'gruppo':38s} {'n':>5s} {'formula':>8s} {'motore':>7s} {'pavim.':>7s} {'margine':>8s} {'quota del margine':>18s}")
for g, items in sorted(groups.items(), key=lambda kv: -sum(abs(r['paFormula'] - r['paActual']) - x['floor'] for x, r in kv[1])):
    f = mean(abs(r['paFormula'] - r['paActual']) for x, r in items)
    e = mean(abs(r['paEngine'] - r['paActual']) for x, r in items)
    fl = mean(x['floor'] for x, r in items)
    red = sum(abs(r['paFormula'] - r['paActual']) - x['floor'] for x, r in items)
    print(f"{g:38s} {len(items):5d} {f:8.2f} {e:7.2f} {fl:7.2f} {f - fl:8.2f} {red / tot_red:17.1%}")
print('tutti', len(joined), round(mean(abs(r['paFormula'] - r['paActual']) for x, r in joined), 2),
      round(mean(abs(r['paEngine'] - r['paActual']) for x, r in joined), 2), round(mean(x['floor'] for x, r in joined), 2))
# direction of the error inside the margin: over- or under-prediction
over = sum(max(r['paFormula'] - r['paActual'], 0) for x, r in joined); under = sum(max(r['paActual'] - r['paFormula'], 0) for x, r in joined)
print(f"errore della formula: sopra il vero {over / (over + under):.0%}, sotto {under / (over + under):.0%}")
