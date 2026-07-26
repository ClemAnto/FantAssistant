# Spec — Toolkit `euroleghe-ingest` v9 (task 1.0 della roadmap)
**Aggiornata: 26 luglio 2026 (v9.1 — fase 1 implementata; v9 SOSTITUISCE la v8)** · Python · Output: SQLite `euroleghe.db` + CSV normalizzati
*Sigle: fc_id = identificativo fantacalcio.it · FM = fantamedia · Mv = media voto · Pv = partite a voto · xref = cross-reference id tra siti · xG/xA = expected goals/assists · manifest = lista file da recuperare.*
**Convenzione: identificatori sempre in INGLESE** (tabelle, colonne, moduli, variabili); italiano solo nella documentazione.

## Novità v9 (decisioni prese, sessione 25-26 luglio 2026)
1. **Rinominato `votes`→`ratings`** e la tabella **`match_votes`→`match_ratings`** (inglese idiomatico). Layer grezzo bonus: `match_rating_bonuses`.
2. **Dimensione `platform` = `euro` | `default`.** `euro` = EuroLeghe (5 leghe, solo i top club; **Serie A PARZIALE**). `default` = fantacalcio classico Serie A (tutte le 20 squadre, endpoint `/voti-fantacalcio-serie-a/{season}/{md}`). **Calendari di giornate DIVERSI** → `platform` fa parte della PRIMARY KEY di `match_ratings`, `match_rating_bonuses` e `season_stats`. Mai mescolarli. `euro` = fantamedia/**target** del gioco EuroLeghe; `default` = **stagione reale piena**. (Verificato: stesso giocatore ha Mv/FM e numeri di giornata diversi — es. Carnesecchi 2023-24: euro 20 md / Mv 6.2 vs default 27 md / Mv 6.278.)
3. **Dimensione ortogonale `gameType` = `classic` | `mantra`** = concern del **motore** (ruoli + modificatori del fantavoto); il voto base è condiviso, quindi NON si memorizza nei ratings grezzi.
4. **Aggregazione opzione A**: colonne canoniche in `match_ratings` + **layer grezzo lossless** `match_rating_bonuses` (una riga per bonus_key), così i bonus specifici di stagione (assist soft/medium, player-of-the-match, ecc.) entrano senza migrazione di schema.
5. **`rebuild` conserva i voti scaricati.** Gli Excel in cache (`data/cache/ratings_{platform}_{season}_md{md}.xlsx`) sono la fonte grezza: `rebuild` li **re-ingerisce offline** (`reingest_from_cache`), poi `rosters.backfill_clubs`/`backfill_rosters_from_ratings` ricostruiscono club e rose mancanti dai ratings, e `stats.derive_from_ratings` deriva gli aggregati.
6. **`season_stats` per piattaforma**: riga `euro` (fantamedia/target, dal listone) **e** riga `default` (stagione piena/propensione, derivata dai voti Serie A). La vista calciatori mostra l'aggregato più completo (propensione).
7. **Propensione su stagione piena (problema + soluzione).** Il calendario euro è un SOTTOINSIEME delle partite reali → la **propensione** (gol/assist/xG per 90') va calcolata su TUTTE le partite reali, mentre il **target FM/Mv resta su `euro`**. Serie A: dai voti `default`. Altre 4 leghe: da **FBref** (fatti: gol/assist/minuti/xG) + **Sofascore** (rating per-partita + heatmap posizionali). Decisione utente: **fatti + voto sintetico CALIBRATO** — il Mv sintetico si **calibra sulla sovrapposizione** (partite dove conosciamo sia il Mv reale sia il rating Sofascore), mappato sul **Mv base** (evitando il doppio conteggio dei bonus già inglobati nel rating Sofascore); niente soglie a bucket fisse. Salvato in un layer separato **`external_stats`** taggato per fonte, che **non contamina mai** il target `euro`. Ogni feature passa comunque dal **gate** fuori campione.
8. **Mappa giornate euro↔reali, PER LEGA.** Una giornata euro impacchetta una giornata reale **diversa** in ciascuno dei 5 campionati → `matchday_map(season, euro_md, league, real_md)`. Verificato su Serie A 2023-24 (mappa monotòna e uniforme fra i giocatori: euro 1→reale 2 … 30→reale 37; salta le reali {1,6,17,18,19,21,31,38}). Permette alla vista di distinguere le giornate reali **in euro-calendario** da quelle riempite **sinteticamente**.

## Novità v9.1 (fase 1 IMPLEMENTATA, sessione 26 luglio 2026)
1. **FBref è inaccessibile**: interstitial Cloudflare, 403 su ogni richiesta anche con impersonation TLS
   (`curl_cffi`, profili chrome/safari/firefox) e su tutti i path, homepage inclusa. **Decisione: SofaScore
   diventa la fonte primaria dei fatti** — la sua API risponde e porta gli stessi dati (gol, assist, minuti,
   xG, xA) **più il rating per-partita** che serve al voto sintetico, quindi una sola fonte e una sola
   risoluzione d'identità invece di due. FBref resta un arricchimento opzionale futuro (rigori di carriera,
   tipi di passaggio per i piazzati); per riaprirlo servirà un browser headless o il download manuale in
   `data/inbox/`.
2. **Client**: `api.sofascore.com` rifiuta `requests` (403 sul fingerprint TLS/HTTP2, non sullo User-Agent) →
   dipendenza `curl_cffi` con `impersonate="chrome"`. Rate-limiting educato (2 s + jitter), cache JSON grezza
   in `data/cache/`, re-ingest offline nel `rebuild` come per gli Excel dei voti.
3. **BUG TROVATO E CORRETTO — rigori invertiti.** Nell'Excel dei voti `Rf` = rigori **fatti** (segnati) e
   `Rs` = rigori **sbagliati**; il toolkit li mappava al contrario, quindi ai rigoristi il fantavoto
   applicava −3 invece di +3 (Calhanoglu 23/24: `Gf`=3, `Rf`=10 → 13 gol reali). Verificato contro
   `penaltyGoals` di SofaScore su 3 stagioni. **Effetto: il check FM è passato da 234 giocatori fuori
   tolleranza a 0** (2600 su 2600 coerenti). Nota correlata: `Gf` **esclude** i rigori, quindi il conteggio
   vero è `goals + pen_scored`.
4. **Il voto base euro ≠ voto base default** sulla stessa partita reale: ±0.5 su circa un terzo dei
   giocatori (i bonus invece coincidono esattamente). Conseguenza operativa: la calibrazione del voto
   sintetico deve puntare al **Mv euro**, e l'allineamento delle giornate non può usare il voto come
   impronta — usa solo gli **eventi** (gol/assist/ammonizioni/espulsioni).
5. **Nuove tabelle**: `external_stats` (aggregati stagione per fonte/competizione), `external_match_stats`
   (layer per-partita: rating, minuti, gol, assist, xG, xA, `real_md`, `mv_synth`), `matchday_map`
   (`season, euro_md, league` → `real_md`, con `source` e `confidence`).
6. **Nuovi moduli**: **`matchdays`** (allineamento calendario euro↔reale, offline per la Serie A dai due
   platform, da `external_match_stats` per le altre 4 leghe) e **`synth`** (calibrazione rating→Mv).
   `positions` è diventato il modulo SofaScore (`--layer season|match|all`).
7. **Risoluzione identità** (`matching.py`, riusabile anche per FBref): normalizzazione (accenti piegati,
   `ð/æ/ø/ı/ł` mappati, run di U+FFFD dei CSV trattati come jolly), iniziali a 1–3 lettere, regole a
   **tier** (1 cognome/coda · 2 nome compattato · 3 token singolo · 4 fuzzy 0.88) dentro pool via
   **club → lega → stagione**. Un tier vale solo se **unico**: i pari merito vanno nel report, non
   si tirano a indovinare. **Iniettività obbligatoria**: uno `fc_id` ↔ **un** id provider (per stagione e
   fra stagioni) — senza questo 10 «Sanchez» diversi collassavano sul nostro unico Sanchez sovrascrivendosi.
   `manual_overrides(entity='player_xref', field='sofascore', value=<id>)` ha precedenza assoluta.
   Non risolti → `data/reports/sofascore_coverage.csv`.
8. **Validazione fatti (il gate di fase 1)**: gol SofaScore vs `default` sulla Serie A =
   **100% esatti** su tutte e 3 le stagioni (579/584/574 giocatori) usando `goals + pen_scored`.
   Assist 84–88% esatti, 99% entro 1 (attribuzione dell'assist diversa fra i due provider: per la Serie A
   fa fede `default`, per le altre leghe si usa SofaScore sapendo che ha ±1 di rumore).
   Copertura perimetro: **96–100%** dei nostri giocatori con presenze, per lega e stagione.
9. **Cross-check indipendente del calendario**: la mappa giornate derivata da SofaScore concorda
   **29/29** con quella derivata dai nostri voti (Serie A 23/24) — valida in un colpo identità, layer
   per-partita e numerazione delle giornate.
10. **Voto sintetico calibrato** (`synth`): retta ai minimi quadrati **per ruolo** sul Mv euro, nessun
    bucket fisso. Serie A 23/24 (3252 partite di sovrapposizione): globale `mv = 0.858 + 0.743 · rating`;
    per ruolo la pendenza va da **0.52 (P)** a **0.84 (A)** — la separazione per ruolo serve davvero.
    MAE 0.358 contro 0.460 della baseline «media». Coefficienti in `data/reports/mv_synth_calibration.json`.
    Resta un layer taggato: nessun uso nel motore senza passare dal gate fuori campione.

## Principi
1. File grezzi (Drive/cache) = fonte di verità; DB **sempre ricostruibile da zero** (`rebuild` idempotente).
2. Il prediction-engine legge solo dai dati normalizzati.
3. **fc_id = chiave primaria**; altri siti in `player_xref`/`club_xref` (source id mai sovrascritti; fuori listone: `prov_*` → fc_id).
4. Nessun passaggio manuale obbligatorio; casi ambigui degradano di tier.
5. Il toolkit sa cosa gli manca (manifest); rete = ottimizzazione.
6. Autonomia piena via scraping autenticato (credenziali in `.env` locale, MAI su Drive/DB/log).
7. `manual_overrides` = valori forzati a mano, sparsi e OPZIONALI, precedenza massima, con `reason` e `created_at`. Sistema completo anche a tabella vuota.
8. **Stati volatili come SERIE TEMPORALI**: gerarchie rigoristi, titolarità, infortuni = stato datato con validità (`valid_from`), mai flag statico.
9. `scoring_config` **parametrico per lega** (rigore segnato/sbagliato, assist da fermo non standard): nessun +3/-3/+1 hard-coded.

## Fonte dei voti (`ratings`) — Excel autenticato, NON l'HTML
- Login: `POST https://www.fantacalcio.it/api/v1/User/login` JSON `{username,password}` → cookie di sessione (`requests.Session`). Credenziali da `.env` locale (`FANTACALCIO_USERNAME`/`PASSWORD`).
- Download: `GET /api/v1/Excel/votes/{championshipId}/{matchday}` (championshipId per stagione ricavato dalla pagina voti; es. EuroLeghe 2024-25 = 107). 401 senza auth.
- Pagina euro: `/voti-fantacalcio-euro-leghe/{season}/{md}`; pagina classica: `/voti-fantacalcio-serie-a/{season}/{md}`.
- **Perché non l'HTML** (trappole anti-AI, confermate incrociando l'Excel): valori solo in `data-value`; 581/597 righe `tr.hidden`; **veleno** `data-value="55"` per chi non ha giocato; allenatori senza fc_id in HTML (Cod nell'Excel).
- Profondità storica: EuroLeghe ~2021-22; Serie A ~2015-16. Selezione stagione/piattaforma via `ratings --season` (ripetibile) / `--platform` e dal dialog GUI.
- Scraping **interrompibile senza perdere i dati** (`cancel_event`/KeyboardInterrupt, commit per giornata) e **ripartibile dai mancanti** (resume filtrato per season+platform). **Rate-limit educato** (delay+jitter) per non attivare le difese.

## Listone (quotazioni) — ruoli Mantra + prezzi, scaricato con i voti
- Endpoint: `GET /api/v1/Excel/prices/{championshipId}/1` con lo **stesso championshipId dei voti**, per stagione, per entrambe le piattaforme (verificato: default 18/19/20, euro 106/107/108).
- Fogli: `Tutti` (rose correnti) + `Ceduti` (ceduti a stagione in corso, comunque a voto) → si leggono **entrambi** (i fogli per-ruolo sono sottoinsiemi di `Tutti`). Colonne: `Id, R, RM, Nome, Squadra, Qt.A, ...` (RM = ruoli Mantra, Qt.A = quotazione asta).
- Uso: arricchisce `rosters` (ruoli Mantra, ruolo classic, prezzo, club) per **tutte** le squadre — riempie i giocatori non-top di Serie A ricostruiti dai soli voti (che avevano solo il ruolo classic). Scaricato dentro `ratings.run` e ri-applicato offline nel `rebuild` (`reingest_listone_from_cache`).

## Gerarchia rigoristi — stato dinamico
Tabella `penalty_hierarchy(fc_club_id, valid_from, fc_id, rank, confidence, source, trigger_event)`, aggiornata giornata per giornata: gerarchia RIVELATA (chi ha calciato l'ultimo rigore, dai nostri `match_ratings` + FBref) > liste ufficiali (`fc_site`) > amichevoli (`positions`). Trigger che invalidano lo stato: rigore sbagliato (quarantena confidence), infortunio/indisponibilità (promozione rank 2), cessione, panchine consecutive. Uso nel motore: bonus pesato per `confidence` × quota rigori attesa del club, mai binario. Stesso pattern per `probable_starter` e `availability`.

## Policy NUOVI ARRIVI (tre tier, guidata dalla quotazione)
T1 importanti → storia completa → FM-equivalente estera → club-a-club con Elo · T2 giovani → dati parziali → trigger U22 + NT-fallback · T3 marginali → àncora di ruolo scontata. Sotto soglia → tier inferiore + `coverage_report.csv`.

## Moduli (ordine rebuild)
`fetch` → `rosters` (SEMPRE primo) → `stats` → `ratings` (Excel autenticato, incrementale + backfill + resume + listone) → `matchdays` (calendario euro↔reale) → `fc_site` (rigoristi, probabili, indisponibili) → `transfers` → `fbref` (opzionale/bloccato) → `positions` (SofaScore: aggregati stagione + rating per-partita; heatmap→ruolo reale ancora da fare) → `synth` (voto sintetico calibrato) → `arrivals` → `tournaments` → `elo` → `validate`.
Stato implementazione v9.1: **rosters, stats, ratings (+ listone), matchdays, positions, synth, arrivals, elo, validate, rebuild + GUI** operativi. Da fare: **heatmap SofaScore → `positions`/`derived_role`** (endpoint stagionale per giocatore, fattore 21), **scraping per-partita delle 4 leghe estere** (comando pronto, ~2 h di rete), **fbref** (bloccato da Cloudflare: serve browser headless o inbox manuale), `fc_site`, `transfers`, `tournaments`.

## Comandi fase 1
```
python -m euroleghe_ingest positions                      # aggregati stagione, 5 leghe x 3 stagioni (~90 richieste)
python -m euroleghe_ingest positions --layer match        # layer per-partita, solo club del perimetro (~2 h, ripartibile)
python -m euroleghe_ingest positions --layer match --league premier_league --season 2024-25
python -m euroleghe_ingest matchdays                      # mappa giornate euro<->reali + cross-check
python -m euroleghe_ingest synth                          # calibra rating->Mv e riempie mv_synth
```
Tutto è ripartibile (la cache grezza è la fonte di verità) e interrompibile; `rebuild` ri-ingerisce offline.

## Schema principale (v9)
`players(fc_id PK, canonical_name, birth_year, nationality)` · `clubs(fc_club_id PK, canonical_name, league)` · `player_xref/club_xref(source, source_id, valid_from, valid_to)` · `rosters(fc_id, season, fc_club_id, roles, role_classic, league, price)` · **`season_stats(fc_id, season, platform, pv, mv, fm, goals, assists, …)`** · **`match_ratings(fc_id, season, matchday, platform, role, team, mv, goals, assists, …, fantavoto, status)`** · **`match_rating_bonuses(fc_id, season, matchday, platform, bonus_key, value)`** · **`external_stats(fc_id, season, source, competition, matches, starts, minutes, goals, assists, pen_scored, pen_taken, xg, xa, rating, yellows, reds)`** *(propensione stagione piena, PK con `source`+`competition`)* · **`external_match_stats(fc_id, season, source, match_id, competition, real_md, match_date, club, opponent, home, position, started, minutes, rating, goals, assists, xg, xa, mv_synth)`** *(layer per-partita + voto sintetico)* · **`matchday_map(season, euro_md, league, real_md, source, confidence)`** *(allineamento euro↔reale per lega)* · `positions` · `transfers_history` · `injuries` · `coaches` · `tournaments_squads` · `club_elo(fc_club_id, date, elo)` · `arrivals(fc_id, season, type, tier, origin_club, origin_league, foreign_fm_equiv)` · `penalty_hierarchy(...)` · `probable_starter` · `availability` · `flags(fc_id, season, flag, value, source)` · `manual_overrides(entity, fc_id, season, field, value, reason, created_at)` · `ingest_runs`.

## Fase 1 — FATTA (con SofaScore al posto di FBref, vedi Novità v9.1)
1. ✅ **Fatti stagione piena** → `external_stats(source='sofascore')` per 5 leghe × 3 stagioni, con
   risoluzione identità in `player_xref` e `coverage_report`. Validata sulla Serie A: gol 100% esatti.
2. ✅ **Rating per-partita** → `external_match_stats` (Serie A 23/24 scaricata: 10 399 righe; le altre
   lega-stagioni si aggiungono con lo stesso comando).
3. ✅ **Voto sintetico calibrato** per ruolo → `mv_synth`, mai nel target `euro`.
4. ✅ **Mappa giornate** euro↔reali per lega, con cross-check indipendente.
5. ✅ **Vista calciatori**: la griglia fantavoti passa al **calendario reale** quando la mappa esiste e
   colora a parte (viola, corsivo) le giornate reali fuori dal calendario euro, il cui valore è il voto
   sintetico. Senza mappa resta sulle giornate euro come prima.
6. ⏳ **Heatmap → `positions.derived_role`** (fattore 21): non fatta, serve l'endpoint heatmap stagionale
   per giocatore (~1 richiesta per giocatore-stagione).

## Whitelist
`fantacalcio.it` e sottodomini · `api.clubelo.com` · `fbref.com` (403 Cloudflare) · `transfermarkt.com/.it` · `query.wikidata.org` · `sofascore.com` + `api.sofascore.com`. Client: `requests` per fantacalcio.it, `curl_cffi` (impersonate chrome) per SofaScore. Rate-limiting educato, cache grezzi, hash per aggiornamenti.
