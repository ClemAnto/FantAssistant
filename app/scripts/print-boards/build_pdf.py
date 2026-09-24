# -*- coding: utf-8 -*-
"""
Un A4 orizzontale con i campetti STAGIONE di tutti i club, scritti come li legge la board.

Ogni numero viene da dove e' gia' deciso e non si ricalcola niente:
  * il campetto, il modulo, il ruolo classic, il claim  -> boards/leghe.json (mode `typical`)
  * il surplus                                          -> sheets/leghe.json.gz, engine ?? est,
                                                           riportato su stagione piena come fa l'app
  * gli ultimi 4 fantavoti                              -> match_ratings (default, giornate 2-5)
  * la MAX OFFERTA                                      -> letta dalla plancia VERA (offers.json)
  * la croce                                            -> injuries, spell aperto oltre 14 giorni
"""
import json
import gzip
import datetime as dt
from html import escape

DATA = 'D:/Projects/FantAssistant/app/public/data/'
TODAY = dt.date(2026, 9, 24)
LONG_DAYS = 14          # la soglia chiesta: «infortunio > 2 settimane»
LAST_ROUNDS = 4


def gz(name):
    with gzip.open(DATA + name, 'rt', encoding='utf-8') as handle:
        return json.load(handle)


def plain(name):
    with open(DATA + name, encoding='utf-8') as handle:
        return json.load(handle)


def indexed(table):
    at = {c: i for i, c in enumerate(table['columns'])}
    return at, table['rows']


# ---------------------------------------------------------------- il foglio: surplus
sheet = gz('sheets/leghe.json.gz')
si = {c: i for i, c in enumerate(sheet['columns'])}
md = sheet['matchdays']
# La stessa scala di `core/season-scale.ts`: il foglio prevede le giornate che restano, lo schermo
# legge su stagione piena.
SCALE = (md['platform_input'] / md['platform_target']) if md.get('platform_target') else 1.0
SEASON_ROUNDS = md['platform_input']
surplus_of = {}
sheet_by_id = {}
for row in sheet['rows']:
    fid = row[si['fc_id']]
    if not fid:
        continue
    value = row[si['engine_surplus']]
    if value is None:
        value = row[si['est_surplus']]
    surplus_of[int(fid)] = None if value is None else value * SCALE
    sheet_by_id[int(fid)] = row

# ------------------------------------------- ENTRATO o USCITO: lo dice il livello per-partita
# `match_ratings.started` e `minutes` sono NULL su tutte le righe del bundle (05/09/2026), quindi
# la distinta viene da qui. La fonte TRONCA i recuperi: il massimo misurato per un titolare e' 90,
# quindi «e' stato sostituito» e' `< 90` e non una soglia scelta.
FULL_MATCH = 90
per_match = gz('external_match_stats.json.gz')
pmi, pmrows = indexed(per_match)
shift = {}
abroad_rows = {}
for row in pmrows:
    if row[pmi['season']] == '2026-27' and row[pmi['competition']] == 'serie_a':
        shift[(int(row[pmi['fc_id']]), row[pmi['real_md']])] = (row[pmi['started']], row[pmi['minutes']])
    elif row[pmi['season']] == '2025-26':
        abroad_rows.setdefault(int(row[pmi['fc_id']]), []).append(row)

# ------------------------------------------- Pv | Mv | Fm della stagione SCORSA
season_stats = gz('season_stats.json.gz')
ssi, ssrows = indexed(season_stats)
LAST_SEASON = '2025-26'
last_season = {
    int(r[ssi['fc_id']]): (r[ssi['pv']], r[ssi['mv']], r[ssi['fm']])
    for r in ssrows
    if r[ssi['season']] == LAST_SEASON and r[ssi['platform']] == 'default'
}

# ------------------------------------------- ...e dove la Serie A non c'e', il SINTETICO
# Stessa aritmetica di `core/match-bonuses.ts` (`syntheticFantavoto`): il voto convertito piu' i
# bonus che il file dei punteggi paga. Non si inventa nessun coefficiente - `scoring_config.json`
# viaggia nel pacchetto - e il voto e' il COALESCE dichiarato il 10/09: `mv_synth` dove la retta e'
# calibrata, `mv_est` dove non lo e', mai due opinioni sulla stessa riga.
SCORING = plain('scoring_config.json')['default']
FRIENDLY = 'club-friendly-games'


def synthetic_season(fid, role):
    """Pv | Mv | Fm della sua stagione 2025-26 fuori dalla Serie A, o None."""
    rows = [r for r in (abroad_rows.get(fid) or []) if r[pmi['competition']] != FRIENDLY]
    if not rows:
        return None
    # UNA PARTITA, UNA RIGA: lo stesso match arriva da due sorgenti (`sofascore` e
    # `sofascore_recent`) e contarlo due volte gonfia le presenze E pesa doppio nella media -
    # Sugawara leggeva 51 partite di Bundesliga su 32 giocate. Si tiene la riga che porta un voto.
    unique = {}
    for row in rows:
        key = row[pmi['match_id']]
        current = unique.get(key)
        if current is None or (current[pmi['mv_synth']] is None and row[pmi['mv_synth']] is not None):
            unique[key] = row
    rows = list(unique.values())
    # LA SUA LEGA E NON LE COPPE: la competizione che ricorre di piu', come fa `abroad.py`. Una
    # media su campionato e coppe insieme non e' la stessa frase di un `season_stats`.
    counted = {}
    for row in rows:
        counted[row[pmi['competition']]] = counted.get(row[pmi['competition']], 0) + 1
    league = max(counted, key=lambda key: (counted[key], key))
    votes, fantas = [], []
    for row in rows:
        if row[pmi['competition']] != league:
            continue
        vote = row[pmi['mv_synth']]
        if vote is None:
            vote = row[pmi['mv_est']]
        if vote is None:
            continue
        votes.append(vote)
        bonus = (row[pmi['goals']] or 0) * SCORING['goal_bonus']
        bonus += (row[pmi['assists']] or 0) * SCORING['assist_bonus']
        if role == 'P':
            conceded = row[pmi['opponent_goals']]
            # IL PORTIERE SI SOMMA SOLO SE SI SANNO I GOL SUBITI, che sono il termine che decide il
            # suo fantavoto: senza, la somma gli darebbe fantavoto uguale al voto.
            if conceded is None:
                continue
            bonus -= conceded * SCORING['goal_conceded_malus_gk']
        fantas.append(vote + bonus)
    if not votes:
        return None
    return (
        len(votes),
        round(sum(votes) / len(votes), 2),
        round(sum(fantas) / len(fantas), 2) if fantas else None,
        league,
    )


# ---------------------------------------------------------------- i voti: ultime 4 giornate
ratings = gz('match_ratings.json.gz')
ri, rrows = indexed(ratings)
votes = {}
for row in rrows:
    if row[ri['season']] != '2026-27' or row[ri['platform']] != 'default':
        continue
    votes.setdefault(int(row[ri['fc_id']]), {})[row[ri['matchday']]] = (
        row[ri['fantavoto']],
        row[ri['status']],
    )
played_rounds = sorted({r[ri['matchday']] for r in rrows
                        if r[ri['season']] == '2026-27' and r[ri['platform']] == 'default'})
ROUNDS = played_rounds[-LAST_ROUNDS:]

# quando si e' giocata ogni giornata, per club: serve a non mettere la croce a chi ha RIGIOCATO
calendar = plain('calendar.json')['leagues']['serie_a']
ci = {c: i for i, c in enumerate(calendar['columns'])}
# IL PONTE FRA I DUE MODI DI NOMINARE UN CLUB LO DICHIARA IL CALENDARIO STESSO: le partite scrivono
# la chiave (`parma`) e la board il nome (`Parma`). Unire per nome faceva rispondere `None` a ogni
# club, cioe' spegneva in silenzio la guardia qui sotto - il difetto che questo repo ha gia' pagato.
club_key = {club['name']: club['key'] for club in calendar['clubs']}
played_on = {}
for match in calendar['matches']:
    day = match[ci['date']]
    if not day:
        continue
    for side in ('home', 'away'):
        played_on.setdefault(match[ci[side]], {})[match[ci['round']]] = day

# ---------------------------------------------------------------- gli infortuni aperti
injuries = gz('injuries.json.gz')
ii, irows = indexed(injuries)
today = TODAY.isoformat()


def days_between(start, end):
    return (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days


open_injury = {}
for row in irows:
    start, end = row[ii['start_date']], row[ii['end_date']]
    if not start or start > today:
        continue
    if end is not None and end < today:
        continue
    # La durata piu' lunga fra quello che la fonte conta, quello che il calendario dice e il rientro
    # previsto: un'assenza in corso e' durata almeno quanto il calendario, e una che dichiara di
    # finire a novembre supera le due settimane dal primo giorno.
    length = max(row[ii['days_out']] or 0, days_between(start, today),
                 days_between(start, end) if end else 0)
    fid = int(row[ii['fc_id']])
    if fid not in open_injury or length > open_injury[fid][0]:
        open_injury[fid] = (length, start, end, row[ii['detail']])


def hurt(fid, club):
    """Croce se l'assenza aperta supera le due settimane e lui non ha gia' rigiocato."""
    spell = open_injury.get(fid)
    if not spell or spell[0] <= LONG_DAYS:
        return None
    start = spell[1]
    # HA GIOCATO DOPO = e' rientrato (la pagina degli indisponibili non toglie chi rientra, 11/09).
    fixtures = played_on.get(club_key.get(club, '')) or {}
    if not fixtures:
        raise SystemExit(f'nessun calendario per {club}: il ponte dei nomi non aggancia')
    for md_played, day in fixtures.items():
        if day > start and (votes.get(fid) or {}).get(md_played, (None, None))[0] is not None:
            return None
    return spell


# ---------------------------------------------------------------- la max offerta della plancia
offers = json.load(open('offers.json', encoding='utf-8'))
offer_of = {row['name']: (row['block'], int(row['offer'])) for row in offers['rows']}

quotes = gz('listone_quotes.json.gz')
qi, qrows = indexed(quotes)
quoted = {int(r[qi['fc_id']]) for r in qrows
          if r[qi['season']] == '2026-27' and r[qi['platform']] == 'default' and not r[qi['sold']]}

# ---------------------------------------------------------------- i campetti
boards = plain('boards/leghe.json')
LINES = ['P', 'D', 'M', 'T', 'A']


def cell_votes(fid):
    out = []
    got = votes.get(fid) or {}
    for round_no in ROUNDS:
        entry = got.get(round_no)
        if entry is None:
            out.append(('', 'no', ''))             # nessuna riga: non convocato
        elif entry[0] is None:
            out.append(('–', 'no', ''))            # riga senza voto: in panchina
        else:
            value = entry[0]
            tone = 'good' if value >= 6.5 else ('bad' if value < 6 else 'mid')
            started, minutes = shift.get((fid, round_no), (None, None))
            # su = e' entrato a gara in corso · giu' = e' uscito prima della fine · niente = ha
            # giocato tutta la partita, o la distinta non lo dice (e allora non si inventa un verso)
            if started == 0 and (minutes or 0) > 0:
                mark = 'up'
            elif started == 1 and (minutes or 0) < FULL_MATCH:
                mark = 'down'
            else:
                mark = ''
            out.append((f'{value:.1f}', tone, mark))
    return out


def row_of(man, club, starter):
    fid = man['fc_id']
    spell = hurt(fid, club)
    surplus = surplus_of.get(fid)
    name = man['name']
    if name in offer_of:
        offer, tail = str(offer_of[name][1]), False
    elif fid in quoted:
        offer, tail = '1', True                    # fuori dai 250 slot: la plancia offre il minimo
    else:
        offer, tail = '–', True                    # il listone non lo quota: niente da offrire
    sheet_row = sheet_by_id.get(fid)
    # LE GIORNATE CHE SALTA: quelle che il FOGLIO ha gia' contato sul calendario del suo club
    # (`desc_out_rounds`), non un secondo conto nostro. Chi non ha una data di rientro non ne ha
    # nessuna, e allora il segno resta nudo: «vuoto = ignoto, mai zero».
    misses = None
    if sheet_row is not None and sheet_row[si['desc_out_rounds']] is not None:
        misses = int(round(sheet_row[si['desc_out_rounds']]))
    pv, mv, fm = last_season.get(fid, (None, None, None))
    # IL SINTETICO E' UN RIPIEGO E LO DICE (corsivo): si accende solo dove la Serie A non c'e',
    # mai accanto a un numero vero - due letture della stessa stagione sullo stesso foglio.
    synthetic = False
    if pv is None:
        made = synthetic_season(fid, man['classic'])
        if made:
            pv, mv, fm, _league = made
            synthetic = True
    return {
        'misses': misses,
        'last': {'pv': pv, 'mv': mv, 'fm': fm, 'synthetic': synthetic},
        'role': man['classic'],
        'name': name,
        'claim': round((man.get('claim') or 0) * 100),
        'votes': cell_votes(fid),
        'surplus': None if surplus is None else round(surplus),
        'offer': offer,
        'tail': tail,
        'hurt': spell,
        'starter': starter,
    }


clubs = []
for club_name in sorted(boards['clubs']):
    board = boards['clubs'][club_name]
    seen = set()
    groups = []
    for line in LINES:
        men = board['lines'].get(line) or []
        rows = []
        for man in sorted(men, key=lambda m: m.get('x') if m.get('x') is not None else 0.5):
            if man['fc_id'] in seen:
                continue
            seen.add(man['fc_id'])
            rows.append(row_of(man, club_name, True))
            for rival in (man.get('duels') or []):
                if rival['fc_id'] in seen:
                    continue
                seen.add(rival['fc_id'])
                rows.append(row_of(rival, club_name, False))
        if rows:
            groups.append(rows)
    clubs.append({'name': club_name, 'shape': board['board_shape'], 'groups': groups})

total_rows = sum(len(g) for c in clubs for g in c['groups'])
crosses = sum(1 for c in clubs for g in c['groups'] for r in g if r['hurt'])
ups = sum(1 for c in clubs for g in c['groups'] for r in g for v in r['votes'] if v[2] == 'up')
downs = sum(1 for c in clubs for g in c['groups'] for r in g for v in r['votes'] if v[2] == 'down')
windows = sum(1 for c in clubs for g in c['groups'] for r in g if r['misses'] is not None)
withlast = sum(1 for c in clubs for g in c['groups'] for r in g if r['last']['pv'] is not None)
synth = sum(1 for c in clubs for g in c['groups'] for r in g if r['last']['synthetic'])
print(f'club {len(clubs)} - righe {total_rows} - segni + {crosses} (con giornate {windows})')
print(f'entrati {ups} - usciti {downs} - con {LAST_SEASON} {withlast}/{total_rows} (di cui sintetici {synth}) - scala {SCALE:.3f}')

with open('rows.json', 'w', encoding='utf-8') as handle:
    json.dump({'clubs': clubs, 'rounds': ROUNDS, 'season_rounds': SEASON_ROUNDS,
               'generated_at': sheet['generated_at'], 'revision': sheet['sheet_revision'],
               'today': today, 'rows': total_rows, 'crosses': crosses, 'last_season': LAST_SEASON}, handle, ensure_ascii=False)
print('scritto rows.json')
