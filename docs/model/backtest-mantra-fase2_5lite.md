# Fase 2.5-lite — Backtest core Mantra + test baseline multi-stagione
**Chiuso:** 21 luglio 2026 · Due finestre, setup senza leakage (àncore dalla sola stagione precedente, BETA cross-fitted dall'altra finestra)

## Backtest core Mantra (solo regressione, nessun flag)
| Motore | T1 23/24→24/25 (n=349) | T2 24/25→25/26 (n=367) |
|---|---|---|
| naive | 0.440 | 0.419 |
| Classic (àncore Classic + 0.50) | 0.364 (−17.4%) | 0.366 (−12.7%) |
| Mantra (àncore fraz. + beta OOS) | 0.355 (−19.5%) | 0.367 (−12.3%) |
| **Mantra + modulo portieri M2** | **0.353 (−19.9%)** | **0.366 (−12.6%)** |

**Verdetto: ADOTTATO come non-inferiore.** Mantra batte Classic nella T1 (+2.5%) e pareggia nella T2 (breakdown per reparto: P leggermente meglio, D/C identici, A leggermente peggio). La precisione media non è il motivo del passaggio: il valore delle àncore Mantra è **strutturale** — previsioni per ruolo posseduto, rank Mantra, flag avanzamento/fuori_ruolo come cambi di àncora — e arriva a costo zero di MAE. Il modulo portieri aggiunge un guadagno piccolo ma coerente in entrambe le finestre.

Nota interpretativa: le àncore fini aiutano poco il MAE perché la regressione usa già la FM individuale precedente; l'àncora conta solo come bersaglio di shrinkage. I guadagni grossi restano dove puntano i correttivi v4 (forza-squadra, arrivi).

## Test baseline personale multi-stagione — RESPINTA (per ora)
Ipotesi v3.8: FM_prec come blend delle ultime stagioni (50/30/20). Test sull'unica finestra disponibile (T2, blend 62/38 rinormalizzato su due stagioni precedenti, 234 giocatori con storia doppia):
- Mantra 1-stagione: MAE 0.352 · Mantra blend 62/38: MAE 0.353 → **nessun guadagno**.

Il correttivo "costo basso/resa alta" della v3.8 fallisce il suo primo test fuori campione. Non adottato. Ricandidabile quando lo storico 2017-2023 (task 1.4) fornirà più finestre — con questa esatta specifica pre-registrata.

## Stato parametri motore Mantra (consolidato)
- Àncore: frazionarie per ruolo, ricalcolate a ogni stagione dalla precedente (tabella in ancore-mantra-fase2_1.md)
- BETA: 0.42 · Portieri: modulo M2 decomposto · Input storico: FM singola stagione precedente
- Multi-ruolo: àncora = media delle àncore dei ruoli posseduti nel listone target

## Restano (percorso 2.x)
2.3 FM per ruolo posseduto + rank + bonus flessibilità (ingegneria) · 2.4 flag a granularità Mantra (specifica) · 2.5 pieno con flag e ipotesi pre-registrate (richiede assegnazione flag storici dalla suite backtest_completo.py)
