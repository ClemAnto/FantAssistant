# Fase 3.1 — Àncore per lega e forza-club: esiti del gate
**Chiusa:** 21 luglio 2026 · Gate cross-fitted su due finestre (coefficienti stimati sempre sull'altra finestra)

## Àncore per lega — RESPINTE
Delta ambiente per lega (movimento, Pv≥20, vs media perimetro):
| Lega | 23/24 | 24/25 | 25/26 |
|---|---|---|---|
| Bundesliga | +0.07 | +0.07 | +0.20 |
| Premier | +0.12 | +0.01 | −0.03 |
| Liga | −0.09 | −0.01 | +0.07 |
| Serie A | −0.05 | −0.05 | −0.13 |
| Ligue 1 | −0.09 | −0.01 | −0.04 |

Piccoli (quasi tutti <0.1) e **instabili di segno** (Premier e Liga si invertono). Coefficiente cross-fitted: peggiora il MAE in entrambe le finestre (+22% T1, +1.3% T2). Il ricalcolo stagionale delle àncore globali già assorbe la deriva d'ambiente. **Unica candidata a pre-registrazione: Bundesliga+ (coerente 3 su 3), verifica giugno 2027.**

## Àncora forza-club (versione interna statica) — RESPINTA, ma diagnosi CONFERMATA
- Offset-club dalla stagione precedente (residui FM vs àncora, shrunk n/(n+8), club di destinazione): coefficiente instabile tra finestre (0.01 vs 1.08), cross-fitted peggiora T1 (+9.4%) e non muove T2.
- **Però il problema esiste ed è misurato**: sul segmento club-forti della T2 (53 giocatori) il bias della previsione base è **−0.29** — la sottostima élite-in-big di Lautaro/Dimarco è sistematica, non aneddotica.
- Conclusione: la cura non può essere retrospettiva (i residui FM del club non persistono abbastanza). Serve una misura *prospettica* di forza club → **ClubElo, esattamente come da progetto v4**. Il gate è già pronto: stessa pipeline, si sostituisce l'offset interno con l'Elo del club alla data dell'asta.

## PSG
Confermato effetto club in tutte e tre le stagioni (+0.38/+0.38/+0.17 vs resto Ligue 1): è un caso del problema forza-club, non un'eccezione di lega. Nessuna regola dedicata: rientra nel correttivo ClubElo.

## Scoreboard del gate (sessione 21/7)
| Ipotesi | Esito |
|---|---|
| Àncore Mantra frazionarie | ✅ adottate |
| BETA Mantra 0.42 | ✅ adottato |
| Modulo portieri decomposto | ✅ adottato (−20/−25% vs naive) |
| Cambio ruolo asimmetrico | ✅ adottato (2 finestre concordi) |
| Beta per gruppo di ruolo | ❌ respinto |
| Baseline multi-stagione 62/38 | ❌ respinta |
| Àncore per lega | ❌ respinte |
| Forza-club interna statica | ❌ respinta (diagnosi confermata → ClubElo) |

## Priorità dati aggiornate
1. **ClubElo** (API gratuita): sblocca il correttivo forza-club — l'unico buco sistematico misurato del core (bias −0.29 su élite-in-big) — e l'upgrade del modulo portieri. Costo minimo.
2. **Voti per giornata** (login utente): fattore 17, orizzonti di convergenza, mappa SofaScore.
3. Storico 2017-2023: più finestre per ri-testare baseline multi-stagione e Bundesliga+.
