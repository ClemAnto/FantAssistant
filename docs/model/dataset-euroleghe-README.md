# Dataset Euroleghe — Manifesto (v2, 21 luglio 2026 sera)
**Progetto:** App EuroLega Fantacalcio · **Scala:** fantacalcio.it Euroleghe (⚠️ mai mischiare con fantacalcio.dev)

## Stato: DATASET A 3 STAGIONI COMPLETO ✅

| Stagione | File | Copertura | Fonte |
|---|---|---|---|
| 2025/26 | `Statistiche_..._2025_26.xlsx` (caricare qui l'originale utente) | 1014 giocatori, 35 club, schema pieno con Rm Mantra | export Excel autenticato |
| 2024/25 | `euroleghe-stats-2024-25.csv` (da outputs sessione 21/7) | 1060 giocatori, ruoli Classic+Mantra 100%, tutte le statistiche | MHT pagina pubblica, estrazione da attributi strutturati |
| 2023/24 | `euroleghe-stats-2023-24.csv` (sostituisce il -parziale) | 1125 giocatori, idem, stagione certificata dagli URL interni | MHT pagina pubblica |

Formula verificata su tutte: `Fm = Mv + (3·Gf + Ass − 0.5·Amm − Esp − 2·Au − 3·R−)/Pv`
Nota estrazione MHT: i dati stanno negli ATTRIBUTI delle righe (`data-filter-role-mantra`, `data-col-key`), non nel testo → scraper robusto.

## Parametri ricalibrati sulla scala vera (21/7/26)

- **Àncore (Pv≥20), stabili su 3 stagioni**: A 7.28/7.34/7.16 · C 6.52/6.51/6.49 · D 6.08/6.07/6.07 · P 4.98/5.01/4.99
- **BETA**: 0.45 (317 coppie 23/24→24/25) e 0.53 (326 coppie 24/25→25/26) — due stime indipendenti a perimetro pieno; il 0.50 di v3 confermato
- **Test solo-regressione senza casi scelti a mano** (tutte le coppie Pv≥15, no survivorship): MAE −17.7% e −13.6% vs naive nelle due finestre, **bias ≈ 0** (+0.055 e +0.007) → il "modello troppo prudente" dei vecchi test era artefatto della top-50; sulla popolazione il modello è centrato. La sottostima resta LOCALE al segmento élite-in-squadre-dominanti (Lautaro −1.31, Dimarco −0.96 nel 25/26) → correttivo àncora forza-squadra confermato come mirato, non globale
- **Àncore per ruolo vs unica**: MAE 0.370 vs 0.404 → confermate

## Scoperte da mettere nel modello

1. **`arrivo_intra_lega`** (nuovo flag): chi entra nel perimetro da club medio-piccolo della STESSA lega (Krstović, Esposito, Orsolini nel 25/26) atterra ≈ àncora, NON àncora+0.6 — errore sistematico +0.85/0.90 con la vecchia regola. Delta proposto ≈ 0/−0.2, da pre-registrare per il 26/27.
2. **Arrivi→trasferimenti**: le star che cambiano lega dentro il perimetro (De Bruyne, Modrić, Højlund, McTominay) hanno storia FM → usare regressione+flag, non àncore d'arrivo.
3. **Perimetro mobile**: 23/24 con Union Berlino/Lens/Lione/Rennes/Siviglia/Real Sociedad; 24/25 con Stoccarda/Lille/Bilbao; 25/26 senza Como. Tracciare sempre stagione×club.

## Backtest a regole complete sulla scala vera (casi storici)
T1 23/24→24/25: MAE 0.495 vs naive 0.742 (−33%); Retegui arrivo+rigorista previsto 8.24, reale 8.19.
T2 24/25→25/26: MAE 0.599 vs naive 0.586 (pareggio) — errori concentrati dove i correttivi v4 già puntano.

## Prossimi passi dati
Voti PER GIORNATA (fattore 17, costanza, orizzonti fattore 22) · stagioni 2017-2023 (curve età) · smoke-test fonti Fase 1.
