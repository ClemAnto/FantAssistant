# Fase 2.2 — Modulo portieri (bloccante Mantra) ✅ GATE SUPERATO
**Chiuso:** 21 luglio 2026 · Backtest su due finestre indipendenti · Scala Euroleghe

## Modello M2 (decomposto) — ADOTTATO
La FM dei portieri si decompone esattamente (verificato: residuo medio 0.008, solo arrotondamenti):
`FM = Mv − Gs/Pv + 3·Rp/Pv (− malus rari)`

Il modello prevede i componenti separatamente:
```
FM_pred = Mv_pred − GsRate_pred + 0.055
Mv_pred     = 6.15 + 0.40 × (Mv_prec − 6.15)          # abilità individuale
GsRate_pred = μ_rate + 0.40 × (rate_squadra_TARGET_prec − μ_rate)   # forza squadra
```
- `rate_squadra` = gol subiti/partita della squadra di DESTINAZIONE nella stagione precedente (transfer-aware: il portiere che cambia club eredita la difesa nuova). Fallback μ_rate per club nuovi nel perimetro.
- +0.055 = 3 × tasso medio rigori parati (0.018/partita, stabile su 3 stagioni: .016/.018/.020).
- Clean sheet: implicito nella formula (Gs=0), nessun termine dedicato necessario.

## Gate pre-registrato: MAE < naive — SUPERATO in entrambe le finestre
| Finestra | naive | M1 àncora+0.42 | **M2 decomposto** |
|---|---|---|---|
| 23/24→24/25 | 0.323 | 0.262 (−19%) | **0.242 (−25%)** |
| 24/25→25/26 | 0.336 | 0.281 (−16%) | **0.268 (−20%)** |

M2 batte naive E il modello semplice in entrambe le finestre indipendenti.

## Misure di supporto
- **Persistenza tasso gol squadra**: beta 0.34 / 0.47 (32-33 squadre comuni per finestra) → 0.40 adottato. Spread 25/26: Roma 0.71 → Eintracht 1.90 gol/partita = oltre 1 punto di FM tra migliore e peggiore difesa.
- **Persistenza Mv portieri**: instabile tra finestre (0.09 / 0.68, n=23-27) → 0.40 usato come prior di shrinkage, non come stima. Robusto: il gate passa comunque in entrambe le finestre.

## Limiti noti e upgrade path
1. **Errori peggiori tutti dello stesso segno**: portieri di squadre peggiorate anno-su-anno (Vicario, Pope, Lipsia, Liverpool nel T2) — la persistenza pura non vede i cambi di regime. **Upgrade: ClubElo** come predittore del rate (più reattivo del rate storico), da validare con lo stesso gate.
2. **μ_rate unico**: da splittare per lega (l'ambiente-gol Premier si muove diversamente) — si aggancia al task 3.1.
3. Rp individuale (para-rigori specialisti) ignorato: effetto ~±0.03, non prioritario.

## Scoperta data quality (per la pipeline)
Il CSV 24/25 da estrazione MHT ha la colonna `squadra` **vuota su tutte le 1060 righe** (attributo non catturato dallo scraper). Invisibile alle analisi per giocatore, blocca quelle per squadra. Fix: ri-estrarre o usare l'Excel ufficiale (qui usato l'Excel, già certificato identico sui numeri). Aggiungere test automatico "nessuna colonna interamente nulla" alla validazione all'ingresso (task 1.3).

## Stato percorso critico Mantra
2.1 àncore ✅ · 2.2 portieri ✅ · restano 2.3 (FM per ruolo posseduto + rank), 2.4 (flag a granularità Mantra), 2.5 (backtest Mantra completo con ipotesi pre-registrate).
