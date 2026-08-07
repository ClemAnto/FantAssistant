# ClubElo — Esiti del gate (ingestione + due test)
**Chiuso:** 21 luglio 2026 · Elo alle date d'asta (15/8/2024, 15/8/2025), 38/38 club mappati · Gate cross-fitted

## Ingestione ✅
- Fonte: `api.clubelo.com/YYYY-MM-DD` (CSV, gratuito). File scaricati manualmente per questa sessione; **per l'app: aggiungere `api.clubelo.com` ai domini consentiti dell'ambiente** per l'ingestione automatica (anche settimanale).
- Mappa nomi Euroleghe→ClubElo costruita e verificata (38 club, nessun mancante): Bayern Monaco→Bayern, Lipsia→RB Leipzig, Siviglia→Sevilla, Eintracht→Frankfurt, ecc. Salvata in `elo_asta.csv`.

## Test 1 — Termine Elo additivo per giocatori di movimento: RESPINTO
`pred = base + λ·eloz(club target)` con λ cross-fitted: T1 +1.1%, T2 −1.0% → pareggio, gate fallito.
- λ almeno ha segno coerente tra finestre (0.027/0.070), a differenza dell'offset interno (0.01/1.08).
- **Scoperta importante**: il bias élite-in-big NON è strutturale. Nella T1 il segmento club-forti aveva bias +0.007 (inesistente); nella T2 −0.14. È un fenomeno del 25/26, non una costante del modello → un correttivo statico è la cura sbagliata per definizione. Ipotesi da pre-registrare: il bias emerge quando l'ambiente-gol di stagione cala (àncora pc 7.52→7.15) e i top club ne sono immuni → correttivo condizionale, non additivo.

## Test 2 — Elo nel modulo portieri: ADOTTATO ✅ (M2 → M2e) — **ma mai portato nel motore**

> ⚠️ **Nota del 07/08/2026, e la ragione per cui questo file resta com'era.** Quanto segue è il verdetto
> del gate Colab del 21/07 e va letto come tale. Nel motore Python (`engine/model.py`) è arrivata **solo
> la metà persistenza**: `predict_fm_goalkeeper` prende il tasso gol subiti da
> `features.goalkeeper_club_rates`, cioè `season_stats.goals_conceded` misurati, e **non tocca
> `club_elo`**. Il nome M2e ha viaggiato, la «e» no. Rilevato il 27/07 (gate-motore-v1 §3-quinquies (a)),
> e fino al 07/08 il docstring di `elo.py` continuava a citare i portieri come uso *validato* dell'Elo:
> commenti corretti in codice, spec, README e stato-continuità. Portare la metà Elo è una **proposta per
> il gate attuale** — dieci finestre e due piattaforme, non le due del run Colab — non un bug da chiudere
> in silenzio, e va misurata sapendo che la famiglia forza-club è stata bocciata quattro volte altrove.

Il tasso gol subiti della stagione target si prevede meglio col **mix 50/50 persistenza+Elo**:
- Tasso squadre: T1 mix 0.165 vs persistenza 0.180 (−9%) · T2 0.202 vs 0.205
- FM portieri end-to-end: T1 0.242 = 0.242 (pari) · T2 **0.258 vs 0.268 (−3.7%)**
Mai peggio, meglio dove conta (la T2 era la finestra debole). Formula aggiornata:
```
GsRate_pred = 0.5·[μ + 0.40·(rate_prev − μ)] + 0.5·[a + b·eloz_asta]
```
con (a,b) rifittati ogni stagione sui dati della precedente.

## Uso residuo di ClubElo (non testabile oggi)
> ⚠️ **07/08/2026: non è stato implementato.** `arrivals.py` non nomina l'Elo da nessuna parte, quindi il
> coefficiente club-a-club resta un'ipotesi. L'unico uso adottato di `club_elo` oggi è **R19**, il canale
> livello: l'Elo del club di PROVENIENZA che muove le presenze attese di chi ha cambiato squadra
> (`presence.level_lift`, `level_weight` 0.06, adottato su `default` il 06/08).

**Task 3.2 — coefficiente club-a-club per gli ARRIVI**: i nuovi arrivi non hanno coppie FM nel perimetro, quindi questo test richiede il dataset arrivi con flag storici (stesso prerequisito del 2.5 pieno). È l'ipotesi dove l'Elo di destinazione ha più senso teorico (sostituisce arrivo_top5/fascia2/dest_big/intra_lega con una scala continua).

## Scoreboard aggiornato sessione 21/7
Adottati: àncore Mantra ✅ · BETA 0.42 ✅ · portieri M2 ✅ → **M2e (Elo)** ✅ *(la metà Elo non è nel
motore — vedi la nota al Test 2)* · cambio ruolo asimmetrico ✅
Respinti: beta per ruolo ❌ · baseline multi-stagione ❌ · àncore per lega ❌ · forza-club interna ❌ · **Elo additivo movimento ❌**
Pre-registrati per giugno 2027: Bundesliga+ · beta attacco/difesa · àncora pc con recenza · correttivo élite condizionale all'ambiente-gol · arrivo_intra_lega

## Prossimo prerequisito comune
2.5 pieno e 3.2 richiedono entrambi il **dataset arrivi+flag storici** (da backtest_completo.py e listoni). È il prossimo collo di bottiglia dati insieme ai voti per giornata.
