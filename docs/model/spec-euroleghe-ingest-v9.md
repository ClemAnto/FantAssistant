# Spec — Toolkit `euroleghe-ingest` v9 (task 1.0 della roadmap)
**Aggiornata: 27 luglio 2026 (v9.2 — strato flag/arrivi; v9 SOSTITUISCE la v8)** · Python · Output: SQLite `euroleghe.db` + CSV normalizzati
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

## Novità v9.2 (strato flag/arrivi, 27 luglio 2026)
1. **`fc_site` implementato** — tre stati volatili come serie datate. La pagina **probabili formazioni**
   porta il **fc_id negli href** (`.../{slug}/{fc_id}/{season}`) → identità esatta, nessun matching:
   442 probabilità su 20 squadre. **Indisponibili**: 151/152 risolti (infortunati→`availability`,
   squalificati→`availability`, **diffidati→`flags(booking_risk)`**, che non è indisponibilità).
   Ogni fetch è uno **snapshot datato** in `data/cache/fc_site_{page}_{date}.html`: quegli snapshot
   *sono* la serie storica e `rebuild` li rigioca in ordine, perché il sito mostra solo "adesso".
2. **Rigoristi: la pagina ufficiale dice ancora "Dati non ancora disponibili"** (preseason 26/27).
   Implementata quindi la fonte che lo spec mette al primo posto — la **gerarchia RIVELATA** dai
   nostri voti: 918 rigori su 140 club-stagione → 1463 righe datate, con peso che decade per recenza
   (`DECAY`) e **quarantena dopo un errore** (`MISS_PENALTY`). ⚠️ Quei due parametri sono
   **provvisori**: decidono quanto la gerarchia crede alla recenza, cioè una scelta di modello →
   li possiede il gate `penalty_ev`. Non leggerli come stabiliti.
3. **Ruolo reale a costo zero**: il layer per-partita ha `position` su **100%** delle 87k righe →
   `positions.derived_role` per 3862 giocatore-stagione e **312 flag `off_role_usage`**
   (222 promozioni, 90 retrocessioni) *offline*, invece di ~2400 richieste heatmap. La heatmap resta
   utile solo per `avg_x/avg_y` (granularità Mantra dd vs dc), non fatta.
4. **Date di nascita dalla cache**: le formazioni SofaScore portano `dateOfBirthTimestamp` →
   `players.birth_year` per 1861/2528 (74%), che sblocca **U22** (479 flag) e in futuro le curve età.
5. **`tournaments` via SofaScore, non Wikidata**: una lista di convocati dice chi è stato chiamato,
   le formazioni dicono **chi ha giocato e quanto** — e l'effetto post-torneo riguarda i minuti.
   Mondiale 2026: 104 partite, **344 giocatori del perimetro, 95 247 minuti** → `tournaments_squads`
   + `flags(post_torneo)` sulla stagione **2026-27** (Premier 100, Serie A 72, Bundes 52, Liga 51,
   Ligue1 36). I tornei di metà stagione (Africa/Asia Cup) usano la stagione in cui si giocano.
6. **`transfers` (Transfermarkt)**: club id dalla tabella di ogni competizione (autorevole, non dalla
   ricerca) → `club_xref`; storico allenatori → `coaches` e **flag `new_coach`** letto al 1° agosto
   (un esonero a stagione in corso emerge sulla stagione DOPO, che è quando è prezzabile); pagina
   trasferimenti per club-stagione → `transfers_history` con le cifre. La data del trasferimento è
   **approssimata alla finestra** (la pagina non ne porta una) e `injuries`/`exit_risk` **non** sono
   coperti: servirebbe una richiesta per giocatore e i dati di scadenza contratto.
7. **`arrivals` completato**: **tier** T1=76 / T2=656 / T3=658 e **FM-equivalente estera** su 610
   arrivi. L'equivalente è calcolato sulla **stagione reale piena** con voto reale euro dove c'è e
   `mv_synth` altrove, sotto lo scoring euro; i cartellini sono l'unica approssimazione (il layer
   per-partita non li ha → totali stagionali distribuiti). **Sanity check**: su 294 giocatori dove
   conosciamo anche la FM euro reale la differenza media è **+0.035** (mediana +0.027).

   ⚠️ **Due correzioni dal gate (27/07)** — quel +0.035 vale per i **giocatori di movimento del
   perimetro**, non in generale:
   - **portieri esclusi**: l'equivalente non ha il termine gol subiti (il layer per-partita ha i gol
     *fatti* e non il risultato), quindi per un portiere manca tutto il lato negativo del fantavoto.
     Misurato su Serie A: **+1.117 / +1.076 / +1.064** sopra la fantamedia reale, **0% entro 0.3** sulle
     tre stagioni. 45 righe lo portavano → ora NULL. Un equivalente per i portieri richiede i gol
     subiti, che questa fonte non dà.
   - **i tier ora usano `Qt.I`, non `Qt.A`**: il percentile di prezzo era calcolato sulla quotazione
     **attuale**, cioè di fine stagione per una stagione già giocata. Era look-ahead in ogni uso
     retrospettivo (Openda 25/26: Qt.I 20 prima dell'asta, Qt.A 3 dopo 12 presenze).
   - ⚠️ **bias di selezione a monte**: il layer per-partita è scaricato seguendo le partite dei club del
     perimetro, quindi chi sta **fuori** perimetro è misurato solo contro le squadre forti (9 club Serie
     A con 38 giornate, gli altri 11 con esattamente 18). L'equivalente ne esce distorto al ribasso:
     **A −0.224 · P −0.164 · C −0.076 · D −0.053**. Vedi `gate-motore-v1.md` §5.
   Soglie di tier (`T1_PRICE_PCT`, `FULL_HISTORY_MATCHES`, `U22_AGE`) **provvisorie, del gate**.
8. **Il matcher ora gestisce anche la NOSTRA convenzione** in ingresso ("Fofana Y."): le liste
   editoriali di fantacalcio.it la usano, e senza questo 25 nomi su 152 restavano fuori.

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
- Fogli: `Tutti` (rose correnti) + `Ceduti` (ceduti a stagione in corso, comunque a voto) → si leggono **entrambi** (i fogli per-ruolo sono sottoinsiemi di `Tutti`). Colonne: `Id, R, RM, Nome, Squadra, Qt.A, Qt.I, Diff., Qt.A M, Qt.I M, FVM, FVM M`.
- ⚠️ **`Qt.A` è la quotazione ATTUALE, `Qt.I` quella INIZIALE, e non sono interscambiabili.** Qt.A viene
  rivista tutta la stagione: per una stagione già giocata **incorpora il risultato** e non può predire
  nulla (Milinković-Savić 25/26: Qt.I 4 → Qt.A 17). Qt.I è fissata **prima dell'asta** — l'attesa del
  mercato — ed è l'unica che un backtest può leggere. Dal 27/07 entrambe in `rosters`: `price` = Qt.A
  (solo descrittiva), **`price_initial` = Qt.I** (copertura 1515/1467/1395). `Qt.A M`/`Qt.I M`/`FVM`
  sono nel file e non ancora salvate.
- Uso: arricchisce `rosters` (ruoli Mantra, ruolo classic, prezzo, club) per **tutte** le squadre — riempie i giocatori non-top di Serie A ricostruiti dai soli voti (che avevano solo il ruolo classic). Scaricato dentro `ratings.run` e ri-applicato offline nel `rebuild` (`reingest_listone_from_cache`).

## Gerarchia rigoristi — stato dinamico
Tabella `penalty_hierarchy(fc_club_id, valid_from, fc_id, rank, confidence, source, trigger_event)`, aggiornata giornata per giornata: gerarchia RIVELATA (chi ha calciato l'ultimo rigore, dai nostri `match_ratings` + FBref) > liste ufficiali (`fc_site`) > amichevoli (`positions`). Trigger che invalidano lo stato: rigore sbagliato (quarantena confidence), infortunio/indisponibilità (promozione rank 2), cessione, panchine consecutive. Uso nel motore: bonus pesato per `confidence` × quota rigori attesa del club, mai binario. Stesso pattern per `probable_starter` e `availability`.

## Policy NUOVI ARRIVI (tre tier, guidata dalla quotazione)
T1 importanti → storia completa → FM-equivalente estera → club-a-club con Elo · T2 giovani → dati parziali → trigger U22 + NT-fallback · T3 marginali → àncora di ruolo scontata. Sotto soglia → tier inferiore + `coverage_report.csv`.

## Moduli (ordine rebuild)
`fetch` → `rosters` (SEMPRE primo) → `stats` → `ratings` (Excel autenticato, incrementale + backfill + resume + listone) → `matchdays` (calendario euro↔reale) → `fc_site` (rigoristi, probabili, indisponibili) → `transfers` → `fbref` (opzionale/bloccato) → `positions` (SofaScore: aggregati stagione + rating per-partita; heatmap→ruolo reale ancora da fare) → `synth` (voto sintetico calibrato) → `arrivals` → `tournaments` → `elo` → `validate`.
Stato implementazione v9.2: **tutti i moduli operativi tranne `fbref`** — rosters, stats, ratings (+ listone), matchdays, fc_site, transfers, positions, synth, tournaments, arrivals, elo, validate, rebuild + GUI. Da fare: **heatmap SofaScore** per `avg_x/avg_y` (granularità Mantra), **`injuries` + flag `exit_risk`** (una richiesta per giocatore + scadenze contratto), **`fbref`** (bloccato da Cloudflare: serve browser headless o inbox manuale), e soprattutto l'**harness del gate** (vedi sotto).

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
6. ✅ **Ruolo reale + `off_role_usage`**: derivati offline dal layer per-partita (v9.2 §3). Resta da
   fare solo `avg_x/avg_y` via heatmap, per la granularità Mantra.

## `engine/` + `backtest` — l'harness del gate (27 luglio 2026)
Non fa parte della pipeline di ingestione: **legge il DB e scrive solo report**. Esiste perché la
regola d'oro non aveva forma eseguibile — il modello viveva nei documenti e in notebook usa-e-getta,
quindi nulla poteva essere davvero gated. È anche il **riferimento da cui portare il motore
TypeScript** in `app/prediction-engine`, quindi resta senza dipendenze ed esplicito.
- `engine/model.py` formule pure + valori pubblicati come costanti di RIFERIMENTO (le ancore si
  **ricalcolano** dal DB con sole stagioni ≤ input: le medie a 3 stagioni del motore includono la
  stagione target, e usarle sarebbe look-ahead) · `fitting.py` minimi quadrati stdlib ·
  `features.py` DB → osservazioni per finestra, con la disciplina anti-look-ahead in un solo punto ·
  `evaluate.py` finestre, cross-fit, metriche, gate, report.
- `backtest` è in **STANDALONE**, non in `PIPELINE` (non produce tabelle di ingestione).
- `--verify` riproduce **15/18** numeri pubblicati; i 3 da rivedere sono tutti sul modulo presenze in
  T1 (`pv_gain_vs_naive_T1`, `pv_bias_naive_starters_T1`, `pv_gain_crossfit_T1`); in T2 tornano.
- L'inventario input stampato per finestra dice cosa manca al MOTORE (non al DB): `starter_prob`
  0/1453 su T2/euro, perché le probabili sono uno stato di oggi e servono snapshot settimanali.

## Quello che manca per l'asta 26/27
- **Bloccato dal calendario**: listone/quotazioni 26/27 (esce ad agosto; aggiungere `2026-27` a
  `SEASONS` in `ratings.py`/`positions.py`/`transfers.py`), voti 26/27, Elo alla data d'asta 2026-08.
- **Lavoro vero**: `injuries` + `exit_risk`; heatmap per `avg_x/avg_y`; e il **collo di bottiglia**:
  un **harness di backtest cross-fitted** sulle due finestre (T1 23/24→24/25, T2 24/25→25/26) per
  eseguire il **gate 3.2** (club-a-club con ClubElo, il cui input — la FM-equivalente — ora esiste)
  e il **2.5 pieno con i flag**. I gate precedenti sono stati eseguiti fuori dal codice: nel repo
  non esiste ancora nulla che li riproduca, ed è ciò che serve prima di far entrare qualunque
  parametro provvisorio di v9.2 nel motore.

## Whitelist
`fantacalcio.it` e sottodomini · `api.clubelo.com` · `fbref.com` (403 Cloudflare) · `transfermarkt.com/.it` · `query.wikidata.org` · `sofascore.com` + `api.sofascore.com`. Client: `requests` per fantacalcio.it, `curl_cffi` (impersonate chrome) per SofaScore. Rate-limiting educato, cache grezzi, hash per aggiornamenti.

## Vista «Auction» nella GUI (27 luglio 2026)

Terzo tab del pannello operatore (`python -m euroleghe_ingest gui`), read-only sul DB. Selettori
**stagione / piattaforma (`euro` | `default`) / game (`classic` | `mantra`)** e, **per ogni ruolo del
game scelto** (4 Classic, 12 Mantra), due tabelle affiancate:

- **Predicted at the auction** — i 10 con il VALORE previsto più alto a inizio stagione, con Qt.I,
  FM e presenze previste, VALORE previsto, **VALORE realmente realizzato**, **FVM di fine stagione** e
  la posizione reale a fine anno.
- **Actual, end of season** — i 10 che hanno realmente reso di più, con FM/presenze/VALORE reali,
  l'FVM, **il VALORE che il motore aveva previsto** e la sua posizione nella classifica prevista
  («not priced» se il motore non lo prezzava affatto).

L'intestazione di ogni ruolo riporta nomi in comune, VALORE catturato e la scomposizione degli errori
(vicini / oltre il rango 50 / mai prezzati).

Tre vincoli che la vista rispetta per costruzione:
1. **Stessa strada del gate**: chiama `evaluate.auction_view` con il set adottato e i parametri
   cross-fitted (compreso il pooling di `POOLED_PARAMS`), quindi pannello e `backtest --auction` non
   possono divergere.
2. **Entrambi i game su entrambe le piattaforme.** Il Mantra si gioca anche sul campionato classico di
   Serie A: il suo listone porta l'intero apparato Mantra (`RM`, `Qt.A M`, `Qt.I M`, `FVM M`) e
   `rosters.roles` tiene i ruoli Mantra di 641-751 giocatori di Serie A ogni stagione dal 18/19.
   L'affermazione «i ruoli Mantra esistono solo sul listone euro» era **sbagliata** e spegneva una
   combinazione che i dati supportano interamente: il gate la saltava, la GUI non la offriva. Corretta
   in tutti e tre i punti. Serie A/Mantra su T2: **52/120 nomi, 82% del VALORE perfetto**.
3. **Solo le stagioni con una finestra utilizzabile**: servono voti su *entrambi* i lati (ingresso e
   bersaglio). Serie A ne ha 7, euro 4 — il buco EuroLeghe del 21/22 ne toglie due.

Il calcolo gira in un thread (il motore stima i parametri di ogni finestra) ed è messo in cache per
piattaforma+game, che è l'unità in cui il costo si paga: cambiare stagione dopo è istantaneo.

### Nuove colonne `rosters.fvm` / `fvm_mantra` / `price_mantra` / `price_initial_mantra`

L'Excel del listone porta **FVM** e **FVM M** accanto a `Qt.A`/`Qt.I` (già letti e scartati).
Ora sono in `rosters`, con migrazione additiva (`ADDED_COLUMNS`) e riapplicati offline dalla cache.
Come `Qt.A`, per una stagione conclusa l'FVM è il valore di **fine stagione**: colonna di
**rendicontazione, mai un input del modello** — sta dalla parte sbagliata della data d'asta per
costruzione, ed è per questo che `feature_availability` la elenca con quell'etichetta.
Salvate anche le due quotazioni in **valuta Mantra** (`Qt.A M` / `Qt.I M`): un'asta si compra nella
valuta del proprio game, e la vista Mantra mostra Qt.I M e FVM M invece dei corrispondenti Classic.
Non sono identiche a quelle Classic (Douvikas 25/26: Qt.I 8, Qt.I M 7). Anche queste sono di sola
rendicontazione: `price_initial_mantra` **sarebbe** l'input onesto per una regola di attesa di mercato
sotto Mantra, e agganciarla a una regola è una **pre-registrazione**, non un dettaglio da far passare
dietro un cambio di visualizzazione.
Copertura, identica per tutte e quattro: 641/1291/1383/1471/1459/1515/1467/1395 righe dal 18/19 al 25/26.
