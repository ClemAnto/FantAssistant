# Todolist — Allineamento Mantra & EuroLeghe (v5)
**Progetto:** App EuroLega Fantacalcio · **Rif.:** modello-previsionale v3.8 · **Aggiornata: 27 luglio 2026 (v5 — SOSTITUISCE la v4)**
Convenzione: [ ] da fare · [x] fatto · [!] bloccato · *Sigle: fc_id = id fantacalcio.it · FM = fantamedia · T1/T2 = finestre di test 23/24->24/25 e 24/25->25/26 · 2.5 pieno = backtest motore completo con flag.*

## FASE 0 — Fattibilita' [x] (21/7)
Invariata (storico 9 stagioni, endpoint Excel, fallback SofaScore, scala ricalibrata, ruoli Mantra). Rif: dataset-euroleghe-README.md.

## FASE 2 — Mantra core [x] salvo 2.5 pieno (21/7)
- [x] 2.1 Ancore Mantra frazionarie + BETA 0.42 -> ancore-mantra-fase2_1.md
- [x] 2.2 Portieri M2e (decomposto + ClubElo; gate -25%/-20%) -> modulo-portieri-fase2_2.md, clubelo-gate.md
- [x] 2.3 FM per ruolo posseduto + rank + flessibilita' (fuori FM) -> fm-per-ruolo-fase2_3-2_4.md
- [x] 2.4 Cambi ruolo = cambi d'ancora ASIMMETRICI -> idem
- [x] 2.5-lite backtest core (Mantra non-inferiore a Classic) -> backtest-mantra-fase2_5lite.md
- [ ] **2.5 pieno (con flag)** — i dati non sono piu' un blocco (flag/arrivi generati il 27/07) e l'harness esiste (`backtest`). Resta da eseguire. Include le ipotesi pre-registrate set-pieces.

## MODULO PRESENZE ATTESE [x] (22/7)
- [x] share_att = 0.26 + 0.50*share_prec + 0.14*(Mv-6.2) + 0.04*cambio; bias titolari +5.2 azzerato; **VALORE = FM_pred x Pv_att** -> presenze-attese-v1.md

## FASE 3 — EuroLeghe core
- [x] 3.1 Ancore/BETA per lega: RESPINTE (gate) · PSG = effetto club · Bundesliga+ pre-registrata -> ancore-lega-forzaclub-fase3_1.md
- [ ] 3.2 Club-a-club ARRIVI con Elo — **input pronto** (27/07: `arrivals.tier` su 1390, `foreign_fm_equiv` su 656, `club_elo` alle date d'asta 24/25). Resta da eseguire il gate.
- [ ] 3.3 Orizzonti di convergenza — ratings disponibili (3 stagioni, 2 piattaforme)
- [ ] 3.4 Config calendario per lega · 3.5 Curve eta' (richiede storico 1.4)

## FASE 1 — TOOLKIT euroleghe-ingest (spec v9 = riferimento) <- LAVORO IN CORSO
- [x] **1.0 Implementazione primo giro**: rosters + stats + validate + rebuild (idempotente, reset in-place) sulle 3 stagioni (zero rete) + **GUI** operatore (vista calciatori: pillole ruolo colorate, ordinamento persistente per ruolo, toggle Fantavoti a griglia, icona campetto).
- [x] **ratings** (scraping Excel autenticato fantacalcio.it, credenziali in .env): login + endpoint Excel, interrompibile senza perdere dati + resume dai mancanti, rate-limit educato. EuroLeghe (euro) e Serie A classica (default) scaricati, profondita' storica. Aggregazione opzione A (canoniche + match_rating_bonuses grezzo). rebuild conserva i voti (reingest_from_cache).
- [x] **listone (quotazioni)**: GET /api/v1/Excel/prices/{cid}/1 (stesso id dei voti), fogli Tutti+Ceduti -> ruoli Mantra (RM) + prezzi per TUTTE le squadre; riempie i non-top di Serie A. Scaricato dentro ratings, ri-applicato nel rebuild.
- [x] **platform = euro | default** in PK (calendari diversi) · **gameType = classic | mantra** (motore) · **season_stats per piattaforma** (euro target + default propensione) · backfill club/rose dai voti · check coerenza voti vs Mv/FM.
- [x] **code review (26/07)**: robustezza (utf-8-sig/BOM, scritture atomiche + try/except reingest, retry rete, indici DB) + consolidamenti (table_names, split ruoli, RAW_INPUTS). Ruff pulito, 25 test verdi.
- [x] **schema**: `external_stats`, `external_match_stats`, `matchday_map` in schema.sql.
- [!] **fbref**: BLOCCATO da Cloudflare (403 su ogni path, anche con impersonation TLS). Sostituito da SofaScore come fonte primaria dei fatti; resta arricchimento futuro (rigori di carriera, piazzati) via browser headless o inbox manuale.
- [x] **positions** (SofaScore): aggregati stagione + rating per-partita (87k righe, 5 leghe x 3 stagioni) + **ruolo reale dal layer per-partita** (100% di copertura, 312 flag off_role_usage) + date di nascita (1861 giocatori). Manca solo la heatmap per `avg_x/avg_y`.
- [x] **voto sintetico calibrato** (`synth`): retta per ruolo sul Mv euro; MAE **0.370 fuori campione** vs 0.466 baseline, bias -0.065.
- [x] **matchday_map** per lega (449 righe) + griglia sul calendario reale con le giornate sintetiche evidenziate. Cross-check: la mappa da SofaScore concorda **29/29** con quella dai nostri voti.
- [x] **fc_site**: probabili (442, fc_id esatto dagli href) · indisponibili (151/152) · **gerarchia rigoristi RIVELATA** dai nostri voti (918 rigori -> 1463 righe datate), perche' la pagina ufficiale dice ancora "dati non disponibili". Snapshot datati in cache, rigiocati dal rebuild.
- [x] **transfers** (Transfermarkt): 46 club in club_xref · 2273 spell allenatori -> **1491 flag new_coach** · 1919 trasferimenti con cifre.
- [x] **tournaments** (SofaScore, non Wikidata: le formazioni dicono chi ha GIOCATO e quanto): Mondiale 2026, 346 giocatori del perimetro, 95 425 minuti -> flag post_torneo su 2026-27.
- [x] **arrivals completato**: tier T1=57/T2=660/T3=673 + FM-equivalente estera su 656 (scarto medio **+0.035** dalla FM euro reale dove confrontabile).
- [x] **HARNESS DEL GATE** (`engine/` + `backtest`): riproduce **15/18** numeri pubblicati; 3 da rivedere sul modulo presenze in T1. E' il riferimento da cui portare il motore TypeScript.
- [ ] 1.4 Storico 2017-2023 (ri-test baseline multi-stagione e Bundesliga+; curve eta').

## PRE-REGISTRAZIONI (verifica giugno 2027, senza ritaratura)
arrivo_intra_lega · regola U22 · Bundesliga+ · beta attacco alto/difesa bassa · ancora pc con recenza · correttivo elite condizionale · ancora B dedicata · **penalty_ev** · **set_piece_duty (solo upside)**

## RESPINTE dal gate (non riproporre senza nuove finestre)
beta per gruppo di ruolo · baseline multi-stagione 62/38 · ancore per lega · forza-club interna statica · Elo additivo movimento

## Percorso critico (aggiornato 27/07)
La parte dati e' fatta. Il percorso ora e': **chiarire i 3 numeri presenze/T1 -> gate 3.2 -> 2.5 pieno con i flag -> taratura dei parametri provvisori -> listone 26/27 ad agosto -> ALGORITMO COMPLETO asta 26/27.**
Nota: **nessuna delle feature generate il 27/07 e' entrata nel motore** — esistono come dati, e il gate decide se e come usarle. Parametri esplicitamente provvisori: decadimento/quarantena rigoristi, soglie tier T1/T3, soglia U22.
