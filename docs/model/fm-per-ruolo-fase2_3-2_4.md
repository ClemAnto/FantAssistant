# Fase 2.3 + 2.4 — FM per ruolo, rank Mantra, cambi di ruolo come cambi d'àncora
**Chiusa (specifica + validazione empirica):** 21 luglio 2026 · Regole testate su due finestre indipendenti

## 2.3 — FM per ruolo posseduto e rank
Per ogni giocatore con ruoli listone {r1..rk}:
```
offset      = FM_prec − media(ANCORA_M(ruoli posseduti stagione prec))   # abilità individuale
FM_pred(ri) = ANCORA_M(ri) + 0.42 × offset      per ciascun ruolo posseduto
FM_engine   = FM_pred(ruolo di impiego previsto)   # default: ruolo primario listone
```
- **Rank Mantra**: per ogni ruolo, classifica di tutti i possessori per FM_pred(ruolo). Sanity check sul prototipo (base 25/26): Kane/Mbappé/Haaland guidano Pc; Dimarco/Grimaldo la E; Bruno Fernandes la T — coerente.
- **Portieri**: FM_pred dal modulo M2 (fase 2.2), non dalla formula sopra.
- **Bonus flessibilità multi-ruolo**: NON entra nella FM (non altera la previsione di rendimento). È una metrica di valore-rosa separata per l'asta, pesata sulla scarsità del ruolo. Scarsità misurata (possessori Pv≥15, 25/26): b 12 · por 36 · dd 50 · pc 55 · ds 60 · w 74 · t 75 · m 79 · a 89 · e 90 · dc 104 · c 127. Un Dd o un Pc in più valgono; un C in più no.

## 2.4 — Cambio ruolo listone = cambio d'àncora ASIMMETRICO ✅ (validato 2 finestre)
~11-16% dei giocatori cambia ruolo Mantra tra stagioni. Test su entrambe le finestre (T1: 65 cambi, T2: 39):

| Caso | Regola adottata | Evidenza (MAE àncora nuova vs vecchia) |
|---|---|---|
| **Arretramento** (àncora nuova < vecchia) | **àncora NUOVA, piena** | T1: 0.297 vs 0.315 · T2: 0.368 vs 0.449 |
| **Avanzamento** (àncora nuova > vecchia) | **àncora VECCHIA** (Δ=0) | T1: 0.318 vs 0.385 · T2: 0.374 vs 0.435 |

Lettura calcistica: l'arretramento nel listone certifica un impiego tattico già in atto (persa la licenza offensiva → la FM cala subito); l'avanzamento è spesso ricognitivo — la produzione del giocatore è già dentro la sua FM_prec, alzare anche l'àncora la conta due volte.

Conseguenze sui flag v3.8:
- Il vecchio flag `avanzamento +0.3` (Classic) **non si traduce** nel cambio d'àncora Mantra: per i cambi listone il bonus è zero. Resta legittimo solo come flag *tattico* da notizie (allenatore che ridisegna il ruolo in campo a listone invariato) — da ridefinire numericamente nel task "flag soggettivi" e ripassare dal gate.
- `fuori_ruolo −0.3` → assorbito dall'arretramento d'àncora quando è il listone a certificarlo; resta flag-notizie nel caso tattico.

## Implicazioni per il prediction-engine (TypeScript)
1. Tabella àncore per stagione (ricalcolo automatico su dati stagione precedente, variante frazionaria).
2. Funzione `predict(player)`: offset su àncora-media ruoli prec → FM per ogni ruolo target, con regola asimmetrica sui cambi.
3. Modulo portieri separato (M2) con tabella rate squadre.
4. Output PlayerCard: FM per ruolo, rank per ruolo, indice flessibilità (separato), driver testuali.

## Verso il 2.5 pieno
Manca solo l'assegnazione dei flag storici (arrivi, rigoristi, infortuni) alle due finestre per il backtest a regole complete — recuperabile dalla suite backtest_completo.py + listoni. Il core (àncore, BETA, portieri, cambi ruolo) è tutto validato.
