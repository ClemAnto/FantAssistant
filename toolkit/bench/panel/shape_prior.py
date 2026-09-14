# -*- coding: utf-8 -*-
"""QUANTO VALE, IN PARTITE DI PRIOR, IL MODULO GIA' VISTO DI QUESTA STAGIONE.

Sola lettura sul DB, una corsa e tre tabelle: `python toolkit/bench/panel/shape_prior.py` dalla radice
del repository. Sta nel repo perche' una misurazione che nessuno puo' ripetere e' un'opinione - e questa
va RIFATTA quando `positions --layer formations` avra' finito, per la ragione scritta nel verdetto.

DOMANDA (operatore, 14/09/2026): «se non ci sono state partite giocate e' ragionevole usare la moda, ma
se la stagione comincia e la formazione e' la stessa per 3 giornate e' ragionevole pensare che lo schema
sia quello per tante altre partite».

FORMA   p(modulo) proporzionale a  k_visti * f_visti + K * f_prior - la stessa di `presence.blend_seasons`
        e di `blend_recent`: k osservate contro K di prior, inerte a k = 0 (li' resta la moda, il suo
        primo comma).

PRIOR   La distribuzione della LEGA quella stagione, ESCLUSO il club. NON il repertorio dell'allenatore,
        e la ragione e' una trappola vista prima della corsa: quello e' dichiarato al 20% (`formation` e'
        in `club_match_lineups` solo dal 12/09/2026 e la rilettura d'archivio si e' fermata all'11%),
        quindi non sa dire un 4-2-3-1 e perderebbe PER COSTRUZIONE - misurerei il vocabolario invece
        della finestra.

POPOLAZIONE  2025-26, cinque campionati, i club con almeno 28 partite di campionato dichiarate.
BERSAGLIO    Le partite di campionato DOPO il taglio: Brier sulla distribuzione, e quota di volte in cui
             l'argmax nomina la moda di quelle che restano.
CRITERIO     Ottimo INTERNO alla griglia, cross-fit leave-one-league-out, e l'INCUMBENT come arm.

===============================================================================================
VERDETTO (14/09/2026)

  K = 5 e' l'ottimo, INTERNO, su tutt'e due le letture, scelto da tutte e cinque le pieghe, e batte
  l'incumbent del 34% di Brier (0,1784 contro 0,2704) e di tre punti sulla moda (65,8% contro 62,5%).
  L'incumbent non e' un punto della griglia: `gui.shape_odds` usa `trust` = 0,90 fisso, che in forma di
  miscela e' K = k/9 - un prior il cui peso CRESCE con l'evidenza, cioe' il contrario di un prior.

  E NON E' ADOTTATO, perche' il prior di questo banco non e' il prior del codice. Provato sul pannello
  vero (A/B costruito E giudicato con lo stesso codice per ogni braccio): K = 5 muove 3 club su 20 e
  TUTTI E TRE tornano al vocabolario a tre linee - Como 4-2-3-1 -> 4-5-1, Genoa 3-4-2-1 -> 3-5-2, Roma
  3-4-2-1 -> 3-4-3 - e il giudice stampa peggiora (moduli MATCH 12 -> 10, uomini 154 -> 152 su 220).
  Il meccanismo e' aritmetico: K = 5 rende il prior piu' pesante, e il prior del codice e' in parte il
  repertorio dell'allenatore, dichiarato all'80% ancora a tre linee. Un prior piu' forte su un
  vocabolario stantio e' peggio di un prior debole.

  SI RIAPRE quando `positions --layer formations` ha finito l'archivio: allora questa misura va rifatta
  con il prior del CODICE (allenatore + lega) invece che con quello di lega, che e' l'unico modo di
  sapere se il 5 vale anche li'.

ALTRI DUE ARM, misurati e riportati perche' un rifiuto cancellato non si puo' ri-correre:

  «SOLO CAMPIONATO» RESPINTO: Brier 0,1870 contro 0,1784 con le coppe dentro, a ogni taglio e su tutti e
  cinque i campionati. L'ipotesi era che in coppa si ruoti e quindi le coppe sporchino; il numero dice
  il contrario - una coppa e' calcio vero e informa.

  IL RITIRO: NON DECIDIBILE su questo archivio, e va detto invece di prendersi il numero comodo. L'arm
  che lo esclude perde (0,1834 contro 0,1784), ma nel 2025-26 la quota di amichevoli nella finestra alla
  terza giornata ha MEDIANA 0% e solo 5 club su 96 stanno sopra il 50% - dove il Milan sta oggi al 57%.
  La popolazione non contiene il regime. Il ritiro e' stato tolto lo stesso dal termine di club
  (`SHEET_REVISION` 68) su un argomento che non ha bisogno di questo banco: entrava DUE VOLTE nella
  stessa miscela.
"""
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from euroleghe_ingest.config import Config  # noqa: E402
from euroleghe_ingest.modules.snapshot import competition_class  # noqa: E402

LEAGUES = ("serie_a", "premier_league", "la_liga", "bundesliga", "ligue_1")
SEASON = "2025-26"
GRID = (0.0, 0.5, 1.0, 2.0, 3.0, 5.0, 8.0, 12.0, 20.0, 40.0)
CUTS = (1, 2, 3, 4, 5, 6, 8, 10, 15, 20)
MIN_LEAGUE_MATCHES = 28
INCUMBENT_TRUST = 0.90        # gui.SHAPE_TRUST_FLOOR + gui.SHAPE_TRUST_RANGE, con his = 1


def load(conn):
    rows = conn.execute(
        """SELECT club, competition, match_date, formation FROM club_match_lineups
           WHERE season = ? AND formation IS NOT NULL AND TRIM(formation) <> ''
             AND match_date IS NOT NULL
           ORDER BY club, match_date""", (SEASON,)).fetchall()
    out = defaultdict(list)
    for club, comp, date, shape in rows:
        out[club].append((date, comp, shape.strip()))
    return out


def league_of(entries):
    """Il campionato del club: quello in cui gioca di piu'. Le coppe non lo definiscono."""
    counts = Counter(comp for _d, comp, _s in entries if comp in LEAGUES)
    return counts.most_common(1)[0][0] if counts else None


def brier(pred, truth):
    return sum((pred.get(k, 0.0) - truth.get(k, 0.0)) ** 2 for k in set(pred) | set(truth))


def population(raw):
    """{club: (lega, partite di campionato, {arm: finestra vista})}"""
    clubs = {}
    for club, entries in raw.items():
        lg = league_of(entries)
        if not lg:
            continue
        league = [(d, s) for d, c, s in entries if c == lg]
        if len(league) < MIN_LEAGUE_MATCHES:
            continue
        clubs[club] = (lg, league, {
            "L": league,
            "LC": sorted((d, s) for d, c, s in entries if competition_class(c) != "friendly"),
            "ALL": sorted((d, s) for d, c, s in entries),
        })
    return clubs


def walk(clubs, arm, weight):
    """weight(k_obs) -> K. Restituisce {lega: [(brier, hit, cut)]}."""
    per_league = defaultdict(Counter)
    for _c, (lg, league, _s) in clubs.items():
        per_league[lg].update(s for _d, s in league)
    out = defaultdict(list)
    for _club, (lg, league, seqs) in clubs.items():
        prior_counts = per_league[lg] - Counter(s for _d, s in league)
        ptot = sum(prior_counts.values()) or 1
        prior = {k: v / ptot for k, v in prior_counts.items()}
        for cut in CUTS:
            if len(league) < cut + 5:
                continue
            cut_date = league[cut - 1][0]
            seen = Counter(s for d, s in seqs[arm] if d <= cut_date)
            k_obs = sum(seen.values())
            if not k_obs:
                continue
            rest = Counter(s for _d, s in league[cut:])
            rtot = sum(rest.values())
            truth = {k: v / rtot for k, v in rest.items()}
            mode = rest.most_common(1)[0][0]
            f_seen = {k: v / k_obs for k, v in seen.items()}
            K = weight(k_obs)
            den = k_obs + K
            pred = {k: (k_obs * f_seen.get(k, 0.0) + K * prior.get(k, 0.0)) / den
                    for k in set(f_seen) | set(prior)}
            top = max(pred.items(), key=lambda x: x[1])[0]
            out[lg].append((brier(pred, truth), 1.0 if top == mode else 0.0, cut))
    return out


def agg(res, leagues=None):
    vals = [v for lg, lst in res.items() if leagues is None or lg in leagues for v in lst]
    return sum(x[0] for x in vals) / len(vals), sum(x[1] for x in vals) / len(vals), len(vals)


def main():
    conn = sqlite3.connect("file:%s?mode=ro" % Config().db_path, uri=True)
    clubs = population(load(conn))
    print("%d club, %s, cinque campionati." % (len(clubs), SEASON))

    print("\n=== la griglia di K (finestra vista = tutto il calcio giocato) ===")
    print("%7s %9s %9s" % ("K", "Brier", "moda ok"))
    scores = {}
    for K in GRID:
        b, h, _n = agg(walk(clubs, "ALL", lambda k, K=K: K))
        scores[K] = b
        print("%7s %9.4f %8.1f%%" % (K, b, 100 * h))
    b_inc, h_inc, n = agg(walk(clubs, "ALL", lambda k: k * (1 - INCUMBENT_TRUST) / INCUMBENT_TRUST))
    print("%7s %9.4f %8.1f%%   <- il codice di oggi (trust 0,90 fisso, cioe' K = k/9)"
          % ("inc", b_inc, 100 * h_inc))
    best = min(scores, key=scores.get)
    edge = GRID.index(best) in (0, len(GRID) - 1)
    print("   -> ottimo K = %s (%s), %+.1f%% di Brier sull'incumbent, n = %d"
          % (best, "SUL BORDO" if edge else "INTERNO", 100 * (scores[best] - b_inc) / b_inc, n))

    print("\n=== cross-fit leave-one-league-out ===")
    for held in sorted(LEAGUES):
        train = [lg for lg in LEAGUES if lg != held]
        pick = min(GRID, key=lambda K: agg(walk(clubs, "ALL", lambda k, K=K: K), train)[0])
        b_out = agg(walk(clubs, "ALL", lambda k, K=pick: K), [held])[0]
        b_ref = agg(walk(clubs, "ALL", lambda k: k / 9.0), [held])[0]
        print("  %-16s scelto sulle altre quattro K = %-5s -> fuori %.4f contro %.4f (%+.1f%%)"
              % (held, pick, b_out, b_ref, 100 * (b_out - b_ref) / b_ref))

    print("\n=== quale calcio conta come finestra vista (a K = %s) ===" % best)
    for arm, label in (("L", "solo campionato"), ("LC", "campionato + coppe"),
                       ("ALL", "tutto, ritiro compreso")):
        b, h, _n = agg(walk(clubs, arm, lambda k, K=best: K))
        print("  %-24s Brier %.4f  moda %.1f%%" % (label, b, 100 * h))

    share = []
    for _club, (_lg, league, seqs) in clubs.items():
        if len(league) < 3:
            continue
        cut = league[2][0]
        seen = [d for d, _s in seqs["ALL"] if d <= cut]
        camp = len(seen) - len([d for d, _s in seqs["LC"] if d <= cut])
        if seen:
            share.append(camp / len(seen))
    share.sort()
    print("  ...e la quota di RITIRO nella finestra alla 3a giornata: mediana %.0f%%, p90 %.0f%%, "
          "sopra il 50%% %d club su %d - il regime di settembre 2026 (Milan 57%%) NON e' in questa "
          "popolazione." % (100 * share[len(share) // 2], 100 * share[int(len(share) * .9)],
                            sum(1 for x in share if x > .5), len(share)))


if __name__ == "__main__":
    main()
