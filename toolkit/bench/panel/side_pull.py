# -*- coding: utf-8 -*-
"""QUANTO IL LATO MISURATO DEVE SCAVALCARE IL CODICE, sull'orizzonte di STAGIONE.

Sola lettura sul DB, una corsa: `python toolkit/bench/panel/side_pull.py` dalla radice del repository.

PRE-REGISTRAZIONE, scritta prima della corsa.

  DA DOVE VIENE  Dal caso Juventus dell'operatore (14/09/2026): «la Juve ha Conceicao, Gonzalez,
    Zeghrova come AD, perche' invece c'e' Celik fuori ruolo?». Celik legge `MR;DR;DC` e il primo codice
    gli compra la fascia destra d'attacco; nelle ultime partite ha giocato 159 minuti da terzino
    SINISTRO. Sull'orizzonte di stagione il piazzamento sta sui SOLI codici - «cosa PUO' fare, letto
    oggi» - perche' l'unico canale di posizione misurata sarebbe la heatmap, che vive a peso zero.

  LA FORMA PROVATA E RESPINTA (`formazioni-tipo-v1.md` §15): sostituire il lato del codice con quello
    misurato. Sistema la Juventus e ROMPE Milan e Atalanta - 229 valori su 342 sono esattamente 0,0,
    quindi la sostituzione appiattisce quasi tutti al centro e lascia le fasce ai pochi che misurano
    +-1 anche con 55 minuti dietro (Saelemaekers, che cosi' toglieva al Milan la fascia destra).

  LA FORMA QUI  Un TIRAGGIO pesato sui MINUTI, nella forma di casa e con UNA manopola sola:

      lato = (1 - w) * lato_del_codice + w * lato_misurato,   w = minuti / (minuti + M)

    I due estremi della griglia SONO i due comportamenti gia' noti, il che e' quello che rende questa
    griglia leggibile: M -> infinito e' il codice da solo (il codice di oggi), M = 0 e' la sostituzione
    di §15. Se l'ottimo non e' INTERNO non si adotta.

  BERSAGLIO  Il lato che ha davvero tenuto alla partita SUCCESSIVA, fuori campione: alla partita m si
    legge solo il calcio < m. E' la stessa forma della misura del 10/09 su `recent_evidence`.

  METRICA  Errore assoluto medio sulla scala [-1, 1], che e' l'unita' in cui `_slot_price` lo paga
    (`abs(lato - voluto)`), con l'errore quadratico accanto. Cross-fit leave-one-league-out.

  POPOLAZIONE  Le stagioni 2022-23..2025-26, i cinque campionati, i giocatori che hanno un codice
    granulare. Due limiti dichiarati: i codici di `player_roles` sono letti OGGI anche per le stagioni
    vecchie (e' la stessa contaminazione che ha il pannello, che li legge oggi pure lui), e
    `tm_appearances` copre i giocatori che abbiamo chiesto, cioe' i quotati - non tutto il campionato.

  ATTESA DICHIARATA  M dell'ordine di una-tre partite piene (90-270 minuti): sotto, cinquantacinque
    minuti basterebbero a ribaltare un uomo, che e' il difetto misurato; sopra, il canale non arriva. Se
    l'ottimo cade sul bordo basso la diagnosi di §15 e' sbagliata e va riscritta.

===============================================================================================
VERDETTO (15/09/2026) - L'ATTESA E' FALSIFICATA, e §15 e' stato riscritto (vedi §16).

  107.034 previsioni fuori campione, quattro stagioni. L'ottimo e' M = 0, cioe' la SOSTITUZIONE PIENA,
  sul bordo basso e monotono: piu' ci si fida della misura, meglio va.

    M            0    22,5      45      90     180     270     450     900    1800   codici
    tutti   0.1517  0.1517  0.1519  0.1522  0.1525  0.1527  0.1529  0.1530  0.1528   0.1517
    discordi 0.579  0.597   0.616   0.645   0.687   0.716   0.758   0.819   0.875    0.985

  IL CANALE TOCCA IL 4,5% DELLE PREVISIONI - i casi in cui il codice e la misura dicono lati diversi di
  un gradino pieno (4.851 su 107.034) - e su QUELLI vale -41%. Sull'intera popolazione e' piatto alla
  quarta cifra, perche' il 95,5% concorda e li' la miscela non cambia niente. Le due letture vanno
  insieme: e' la forma «pochi uomini spostati di molto», la stessa di R26.

  QUINDI LA DIAGNOSI DI §15 ERA SBAGLIATA. Non e' che la sostituzione sia una forma troppo forte: come
  PREVISIONE DI DOVE GIOCHERA' UN UOMO e' la forma migliore che ci sia, e nessun tiraggio la batte.
  Quello che §15 ha osservato - il Milan che perde le fasce - e' vero e ha un'altra causa.

  LA CAUSA VERA: un prezzo PER UOMO non puo' esprimere un vincolo sull'UNDICI. Fotografato sul Milan:
  tre uomini misurati a sinistra (Saelemaekers 55', Bartesaghi 111', Estupinan 66') per una fascia
  sola, e l'unico misurato a destra - Chukwueze, `MR:90;MR:90`, la misura piu' solida della rosa - il
  claim NON lo disegna. Con i codici Saelemaekers copriva la destra; con la misura va a sinistra, e
  nell'undici disegnato non resta nessuno che misuri destra mentre tutti gli altri leggono 0,0. Il
  Kolasinac dell'Atalanta e' lo stesso caso un reparto piu' indietro.
  E' «le parti non fanno il tutto» (l'R-Factor) su una STRUTTURA invece che su una soglia: rendere piu'
  accurato ogni uomo separatamente peggiora l'undici, perche' l'undici deve coprire due fasce e la
  selezione - che e' del claim - non sa che deve farlo.

  DA MISURARE DOPO, e non e' un peso: o un vincolo strutturale (una riga raggiunge le due fasce, imposto
  nella SELEZIONE e non solo nel disegno), oppure la misura come SPAREGGIO fra uomini altrimenti pari,
  che e' la forma di `RECENT_SHAPE_TIE` («uno spareggio e mai un peso»). Questo banco non li puo'
  giudicare: misura la previsione del lato di un uomo, non l'assegnazione.
"""
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from euroleghe_ingest import config  # noqa: E402
from euroleghe_ingest.config import Config  # noqa: E402
from euroleghe_ingest.modules.positions import REAL_ROLE_SIDE  # noqa: E402
from euroleghe_ingest.modules.snapshot import TM_SLOT_SIDE  # noqa: E402

SEASONS = ("2022-23", "2023-24", "2024-25", "2025-26")
GRID = (0.0, 22.5, 45.0, 90.0, 180.0, 270.0, 450.0, 900.0, 1800.0)
MIN_PRIOR_MATCHES = 1          # serve almeno una partita prima, o non c'e' niente da pesare


def codes(conn):
    """{fc_id: lato del PRIMO codice} - il suo primo mestiere, che e' lo spareggio del pannello."""
    out = {}
    # La riga piu' RECENTE per uomo: `player_roles` e' datata (il ruolo granulare si osserva il giorno in
    # cui si corre) e il pannello legge l'ultima, quindi anche questo banco.
    for fc_id, roles, primary in conn.execute(
            """SELECT fc_id, roles, primary_role FROM player_roles
               WHERE roles IS NOT NULL ORDER BY fc_id, valid_from DESC"""):
        if fc_id in out:
            continue
        first = (primary or "").strip() or (roles or "").split(";")[0].strip()
        if first in REAL_ROLE_SIDE:
            out[fc_id] = REAL_ROLE_SIDE[first]
    return out


def appearances(conn):
    """{(fc_id, season): [(data, lato, minuti, campionato), ...]} in ordine di data."""
    marks = ",".join("?" * len(config.TM_CHAMPIONSHIPS))
    rows = conn.execute(
        f"""SELECT fc_id, season, played_on, position_id, minutes, competition
            FROM tm_appearances
            WHERE season IN ({",".join("?" * len(SEASONS))})
              AND state = 'played' AND is_national = 0
              AND position_id IS NOT NULL AND position_id != 0
              AND played_on IS NOT NULL AND competition IN ({marks})
            ORDER BY fc_id, season, played_on""",
        (*SEASONS, *config.TM_CHAMPIONSHIPS))
    out = defaultdict(list)
    for fc_id, season, date, slot, minutes, comp in rows:
        if slot in TM_SLOT_SIDE:
            out[(fc_id, season)].append((date, TM_SLOT_SIDE[slot], float(minutes or 0.0), comp))
    return out


def league_of(played):
    """Il campionato in cui ha giocato di piu' quella stagione."""
    tally = defaultdict(float)
    for _d, _s, minutes, comp in played:
        tally[comp] += minutes or 1.0
    return max(tally, key=tally.get)


def run():
    conn = sqlite3.connect("file:%s?mode=ro" % Config().db_path, uri=True)
    code_side = codes(conn)
    data = appearances(conn)
    print("%d (giocatore, stagione) con presenze; %d giocatori hanno un codice."
          % (len(data), len(code_side)))

    # per ogni M, per ogni campionato: [(errore assoluto, errore quadratico)]
    out = {M: defaultdict(list) for M in GRID}
    out["codici"] = defaultdict(list)
    n_pred = 0
    for (fc_id, _season), played in data.items():
        base = code_side.get(fc_id)
        if base is None:
            continue
        lg = league_of(played)
        seen_minutes = 0.0
        seen_side_num = 0.0
        for index, (_date, side, minutes, _comp) in enumerate(played):
            if index >= MIN_PRIOR_MATCHES and seen_minutes > 0:
                measured = seen_side_num / seen_minutes
                n_pred += 1
                for M in GRID:
                    w = seen_minutes / (seen_minutes + M) if (seen_minutes + M) else 1.0
                    pred = (1 - w) * base + w * measured
                    out[M][lg].append((abs(pred - side), (pred - side) ** 2))
                out["codici"][lg].append((abs(base - side), (base - side) ** 2))
            seen_minutes += minutes or 1.0
            seen_side_num += side * (minutes or 1.0)
    return out, n_pred


def agg(res, leagues=None):
    vals = [v for lg, lst in res.items() if leagues is None or lg in leagues for v in lst]
    return sum(x[0] for x in vals) / len(vals), sum(x[1] for x in vals) / len(vals), len(vals)


def main():
    out, n_pred = run()
    print("%d previsioni fuori campione.\n" % n_pred)
    print("%9s %9s %9s   %s" % ("M", "err.ass.", "err.quad.", "lettura"))
    scores = {}
    for M in GRID:
        a, q, _n = agg(out[M])
        scores[M] = a
        note = ("  <- la SOSTITUZIONE di §15" if M == 0 else "")
        print("%9s %9.4f %9.4f%s" % (M, a, q, note))
    a, q, _n = agg(out["codici"])
    scores_codes = a
    print("%9s %9.4f %9.4f   <- i soli codici (il codice di oggi)" % ("codici", a, q))

    best = min(scores, key=scores.get)
    edge = GRID.index(best) in (0, len(GRID) - 1)
    print("\n   -> ottimo M = %s (%s); contro i soli codici %+.1f%%, contro la sostituzione %+.1f%%"
          % (best, "SUL BORDO" if edge else "INTERNO",
             100 * (scores[best] - scores_codes) / scores_codes,
             100 * (scores[best] - scores[0.0]) / scores[0.0]))

    print("\n=== cross-fit leave-one-league-out ===")
    leagues = sorted({lg for lst in out[GRID[0]] for lg in [lst]} | set(out[GRID[0]]))
    for held in leagues:
        train = [lg for lg in leagues if lg != held]
        pick = min(GRID, key=lambda M: agg(out[M], train)[0])
        held_new = agg(out[pick], [held])[0]
        held_old = agg(out["codici"], [held])[0]
        print("  %-16s scelto sulle altre M = %-6s -> fuori %.4f contro %.4f dei codici (%+.1f%%)"
              % (held, pick, held_new, held_old, 100 * (held_new - held_old) / held_old))


if __name__ == "__main__":
    main()
