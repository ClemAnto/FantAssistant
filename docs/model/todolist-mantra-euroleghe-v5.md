# Todolist — Allineamento Mantra & EuroLeghe (v5)
**Progetto:** App EuroLega Fantacalcio · **Rif.:** modello-previsionale v3.8 · **Aggiornata: 26 luglio 2026 (v5 — SOSTITUISCE la v4)**
Convenzione: [ ] da fare · [x] fatto · [!] bloccato · *Sigle: fc_id = id fantacalcio.it · FM = fantamedia · T1/T2 = finestre di test 23/24->24/25 e 24/25->25/26 · 2.5 pieno = backtest motore completo con flag.*

## FASE 0 — Fattibilita' [x] (21/7)
Invariata (storico 9 stagioni, endpoint Excel, fallback SofaScore, scala ricalibrata, ruoli Mantra). Rif: dataset-euroleghe-README.md.

## FASE 2 — Mantra core [x] salvo 2.5 pieno (21/7)
- [x] 2.1 Ancore Mantra frazionarie + BETA 0.42 -> ancore-mantra-fase2_1.md
- [x] 2.2 Portieri M2e (decomposto + ClubElo; gate -25%/-20%) -> modulo-portieri-fase2_2.md, clubelo-gate.md
- [x] 2.3 FM per ruolo posseduto + rank + flessibilita' (fuori FM) -> fm-per-ruolo-fase2_3-2_4.md
- [x] 2.4 Cambi ruolo = cambi d'ancora ASIMMETRICI -> idem
- [x] 2.5-lite backtest core (Mantra non-inferiore a Classic) -> backtest-mantra-fase2_5lite.md
- [ ] **2.5 pieno (con flag)** — [!] dipende da arrivi/flag e propensione (Fase 1). Include le ipotesi pre-registrate set-pieces.

## MODULO PRESENZE ATTESE [x] (22/7)
- [x] share_att = 0.26 + 0.50*share_prec + 0.14*(Mv-6.2) + 0.04*cambio; bias titolari +5.2 azzerato; **VALORE = FM_pred x Pv_att** -> presenze-attese-v1.md

## FASE 3 — EuroLeghe core
- [x] 3.1 Ancore/BETA per lega: RESPINTE (gate) · PSG = effetto club · Bundesliga+ pre-registrata -> ancore-lega-forzaclub-fase3_1.md
- [ ] 3.2 Club-a-club ARRIVI con Elo — [!] dati dal toolkit (arrivals + FM-equivalente estera); elo-asta-mappa-club.csv pronto
- [ ] 3.3 Orizzonti di convergenza — richiede ratings (toolkit) [ora disponibili]
- [ ] 3.4 Config calendario per lega · 3.5 Curve eta' (richiede storico 1.4)

## FASE 1 — TOOLKIT euroleghe-ingest (spec v9 = riferimento) <- LAVORO IN CORSO
- [x] **1.0 Implementazione primo giro**: rosters + stats + validate + rebuild (idempotente, reset in-place) sulle 3 stagioni (zero rete) + **GUI** operatore (vista calciatori: pillole ruolo colorate, ordinamento persistente per ruolo, toggle Fantavoti a griglia, icona campetto).
- [x] **ratings** (scraping Excel autenticato fantacalcio.it, credenziali in .env): login + endpoint Excel, interrompibile senza perdere dati + resume dai mancanti, rate-limit educato. EuroLeghe (euro) e Serie A classica (default) scaricati, profondita' storica. Aggregazione opzione A (canoniche + match_rating_bonuses grezzo). rebuild conserva i voti (reingest_from_cache).
- [x] **listone (quotazioni)**: GET /api/v1/Excel/prices/{cid}/1 (stesso id dei voti), fogli Tutti+Ceduti -> ruoli Mantra (RM) + prezzi per TUTTE le squadre; riempie i non-top di Serie A. Scaricato dentro ratings, ri-applicato nel rebuild.
- [x] **platform = euro | default** in PK (calendari diversi) · **gameType = classic | mantra** (motore) · **season_stats per piattaforma** (euro target + default propensione) · backfill club/rose dai voti · check coerenza voti vs Mv/FM.
- [ ] **fbref**: gol/assist/minuti/xG/xA per lega/stagione -> external_stats(source='fbref'); risoluzione identita' player_xref (nome+club+stagione); **validazione su Serie A** (gol FBref ~ gol default) + report copertura.
- [ ] **positions** (Sofascore): rating per-partita -> external_stats(source='sofascore') + heatmap -> positions (fattore 21, off_role_usage asimmetrico gia' validato).
- [ ] **voto sintetico calibrato**: fit rating Sofascore -> Mv base sulla sovrapposizione (non a bucket), applicato alle partite mancanti; mai nel target euro.
- [ ] **matchday_map(season, euro_md, league, real_md)** (per lega) + evidenziazione nella vista delle giornate euro effettive vs sintetiche.
- [ ] **fc_site** (rigoristi, probabili, indisponibili) · **transfers** (Transfermarkt) · **tournaments** (Wikidata).
- [ ] 1.4 Storico 2017-2023 (ri-test baseline multi-stagione e Bundesliga+; curve eta').

## PRE-REGISTRAZIONI (verifica giugno 2027, senza ritaratura)
arrivo_intra_lega · regola U22 · Bundesliga+ · beta attacco alto/difesa bassa · ancora pc con recenza · correttivo elite condizionale · ancora B dedicata · **penalty_ev** · **set_piece_duty (solo upside)**

## RESPINTE dal gate (non riproporre senza nuove finestre)
beta per gruppo di ruolo · baseline multi-stagione 62/38 · ancore per lega · forza-club interna statica · Elo additivo movimento

## Percorso critico
**Fase 1 toolkit (ratings + listone [x] -> fbref/sofascore + propensione) -> arrivals+flags generati -> 2.5 pieno + 3.2 -> ALGORITMO COMPLETO per asta 26/27.** In parallelo: whitelist domini. Scadenze: modulo amichevoli agosto (fattore 21 via positions) · casi Vergara/Baturina/Malen · post_torneo.
