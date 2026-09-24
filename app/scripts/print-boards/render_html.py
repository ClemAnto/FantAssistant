# -*- coding: utf-8 -*-
"""Da rows.json all'A4 orizzontale. Nessun numero nasce qui: si impagina e basta."""
import json
import sys
from html import escape

FONT = float(sys.argv[1]) if len(sys.argv) > 1 else 5.4
COLS = int(sys.argv[2]) if len(sys.argv) > 2 else 5
LH = float(sys.argv[4]) if len(sys.argv) > 4 else 1.08
OUT = sys.argv[3] if len(sys.argv) > 3 else 'campetti.html'

data = json.load(open('rows.json', encoding='utf-8'))
ROLE_INK = {'P': '#b45309', 'D': '#15803d', 'C': '#1d4ed8', 'A': '#b91c1c'}

CSS = """
@page { size: A4 landscape; margin: 4mm 4mm 5.5mm 4mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Arial Narrow', 'Liberation Sans Narrow', 'Helvetica Neue', Arial, sans-serif;
  font-size: %(font)spt;
  line-height: %(lh)s;
  color: #000;
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
}
.sheet { column-count: %(cols)d; column-gap: 2.4mm; column-fill: auto; height: 194mm; }
.club { break-inside: avoid; margin: 0 0 1.1mm 0; }
.head {
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 0.5pt solid #000; padding: 0.2mm 0.3mm 0.1mm;
  font-weight: 700; letter-spacing: 0.01em;
}
.head .shape { font-weight: 400; font-size: 0.92em; }
.cols { color: #888; font-size: 0.86em; border-bottom: 0.25pt dotted #ddd; }
.cols .n { text-align: left; }
.line { border-bottom: 0.25pt dotted #bbb; }
.line:last-child { border-bottom: 0; }
.row {
  display: grid;
  grid-template-columns:
    1.05em minmax(0, 1fr) 1.7em
    1.5em 2.05em 2.05em
    repeat(4, 2.6em)
    2.0em 2.0em;
  gap: 0 0.19em;
  padding: 0 0.2em;
  align-items: baseline;
}
.row > * { overflow: hidden; white-space: nowrap; }
.r { font-weight: 700; }
.n { text-overflow: ellipsis; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.alt { padding-left: 0.9em; color: #3a3a3a; }
.alt .r { font-weight: 400; }
.good { font-weight: 700; }
.bad { color: #555; }
.no { color: #b0b0b0; }
.claim { color: #333; }
.sur { font-weight: 600; }
.off { font-weight: 700; }
.tail { font-weight: 400; color: #8a8a8a; }
.cross { color: #c00; font-weight: 700; }
/* LA STAGIONE SCORSA, e il corsivo dice che e' un SINTETICO: il suo campionato convertito, non
   una Serie A. Due numeri della stessa colonna che vengono da due fonti devono vedersi diversi. */
.past { color: #333; }
.synth { font-style: italic; color: #4a4a4a; }
/* ENTRATO / USCITO: triangoli disegnati col bordo e non un carattere - un glifo geometrico non e'
   in ogni faccia, e una sostituzione di font cambierebbe la larghezza di ogni cella dei voti. */
.tri { display: inline-block; width: 0; height: 0; vertical-align: 0.42em; margin-left: 0.09em;
       border-left: 0.17em solid transparent; border-right: 0.17em solid transparent; }
.up { border-bottom: 0.26em solid #1d7a33; }
.down { border-top: 0.26em solid #b03030; }
.legend {
  position: fixed; bottom: 0; left: 0; right: 0; height: 4.2mm;
  border-top: 0.5pt solid #000; padding-top: 0.4mm;
  display: flex; justify-content: space-between; font-size: 0.92em; color: #333;
}
""" % {'font': FONT, 'cols': COLS, 'lh': LH}


def cell(value, klass, mark=''):
    tri = '<i class="tri %s"></i>' % mark if mark else ''
    return '<span class="num %s">%s%s</span>' % (klass, escape(value), tri)


def past(value, digits, synthetic):
    if value is None:
        return '<span class="num past"></span>'
    text = ('%%.%df' % digits) % value
    return '<span class="num past %s">%s</span>' % ('synth' if synthetic else '', text)


def row_html(row):
    classes = 'row' + ('' if row['starter'] else ' alt')
    name = escape(row['name'])
    if row['hurt']:
        misses = '' if row['misses'] is None else str(row['misses'])
        name = '<span class="cross">+%s</span>&#8202;' % misses + name
    votes = ''.join(cell(text, tone, mark) for text, tone, mark in row['votes'])
    last = row['last']
    synthetic = last.get('synthetic', False)
    history = (
        past(last['pv'], 0, synthetic) + past(last['mv'], 2, synthetic) + past(last['fm'], 2, synthetic)
    )
    surplus = '' if row['surplus'] is None else str(row['surplus'])
    offer = row['offer']
    return (
        '<div class="%s">'
        '<span class="r" style="color:%s">%s</span>'
        '<span class="n">%s</span>'
        '<span class="num claim">%s</span>'
        '%s%s'
        '<span class="num sur">%s</span>'
        '<span class="num off %s">%s</span>'
        '</div>'
    ) % (
        classes,
        ROLE_INK.get(row['role'], '#000'),
        escape(row['role'] or '?'),
        name,
        row['claim'],
        history,
        votes,
        escape(surplus),
        'tail' if row['tail'] else '',
        escape(offer),
    )


parts = ['<!doctype html><html lang="it"><head><meta charset="utf-8">',
         '<title>Campetti stagione</title><style>%s</style></head><body>' % CSS,
         '<div class="sheet">']
for club in data['clubs']:
    parts.append('<section class="club"><div class="head"><span>%s</span>'
                 '<span class="shape">%s</span></div>'
                 % (escape(club['name']), escape(club['shape'])))
    for group in club['groups']:
        parts.append('<div class="line">')
        parts.extend(row_html(row) for row in group)
        parts.append('</div>')
    parts.append('</section>')
parts.append('</div>')

rounds = '-'.join(str(r) for r in data['rounds'])
parts.append(
    '<div class="legend">'
    '<span><b>Campetti stagione</b> &middot; Serie A classic &middot; titolari e alternativi'
    ' rientrati</span>'
    '<span>ruolo &middot; nome &middot; %%tit &middot; <b>Pv Mv Fm %s</b>'
    ' (<i>corsivo</i> = sintetico, il suo campionato) &middot; <b>fantavoto g%s</b>'
    ' (<i class="tri up"></i> entrato <i class="tri down"></i> uscito) &middot; surplus su %d'
    ' giornate &middot; max offerta plancia</span>'
    '<span><span class="cross">+n</span> infortunio aperto oltre 2 settimane, n = giornate che'
    ' salta &middot; <span class="tail">1 grigio</span> = fuori dai 250 slot</span>'
    '<span>rev. %s &middot; %s</span>'
    '</div>' % (data['last_season'], rounds, data['season_rounds'], data['revision'], data['today'])
)
parts.append('</body></html>')

open(OUT, 'w', encoding='utf-8').write('\n'.join(parts))
print('scritto %s (font %.1fpt, %d colonne)' % (OUT, FONT, COLS))
