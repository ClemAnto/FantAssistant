# Spec — Toolkit `euroleghe-ingest` v9 (task 1.0 della roadmap)
**Aggiornata: 26 luglio 2026 (v9 — SOSTITUISCE la v8)** · Python · Output: SQLite `euroleghe.db` + CSV normalizzati
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
`fetch` → `rosters` (SEMPRE primo) → `stats` → `ratings` (Excel autenticato, incrementale + backfill + resume + listone) → `fc_site` (rigoristi, probabili, indisponibili) → `transfers` → `fbref` (rendimento estero: gol/assist/minuti/xG/xA, rigori carriera, set pieces) → `positions` (SofaScore: rating per-partita + heatmap→ruolo reale, anche amichevoli → fattore 21) → `arrivals` → `tournaments` → `elo` → `validate`.
Stato implementazione v9: **rosters, stats, ratings (+ listone), arrivals, elo, validate, rebuild + GUI** operativi (primo giro fatto sulle 3 stagioni; ratings euro+default scaricati). Da implementare: **fbref**, **positions** (Sofascore), **calibrazione voto sintetico**, **matchday_map**, evidenziazione euro/sintetico nella vista.

## Schema principale (v9)
`players(fc_id PK, canonical_name, birth_year, nationality)` · `clubs(fc_club_id PK, canonical_name, league)` · `player_xref/club_xref(source, source_id, valid_from, valid_to)` · `rosters(fc_id, season, fc_club_id, roles, role_classic, league, price)` · **`season_stats(fc_id, season, platform, pv, mv, fm, goals, assists, …)`** · **`match_ratings(fc_id, season, matchday, platform, role, team, mv, goals, assists, …, fantavoto, status)`** · **`match_rating_bonuses(fc_id, season, matchday, platform, bonus_key, value)`** · **`external_stats(fc_id, season, source, matches, minutes, goals, assists, xg, xa, …)`** *(nuova, FBref/Sofascore, propensione stagione piena)* · **`matchday_map(season, euro_md, league, real_md)`** *(nuova, allineamento euro↔reale per lega)* · `positions` · `transfers_history` · `injuries` · `coaches` · `tournaments_squads` · `club_elo(fc_club_id, date, elo)` · `arrivals(fc_id, season, type, tier, origin_club, origin_league, foreign_fm_equiv)` · `penalty_hierarchy(...)` · `probable_starter` · `availability` · `flags(fc_id, season, flag, value, source)` · `manual_overrides(entity, fc_id, season, field, value, reason, created_at)` · `ingest_runs`.

## Fase 1 (in corso) — FBref + Sofascore per la propensione delle leghe estere
1. **FBref (i fatti)**: scarica per lega/stagione gol/assist/minuti/xG/xA; risolve l'identità in `player_xref` (matching nome + club + stagione, +anno di nascita quando c'è; collisioni → `manual_overrides`); scrive `external_stats(source='fbref')`. **Report di copertura** (matchati/non) + **validazione su Serie A** (i gol FBref ≈ gol `default`) prima di fidarsi delle 4 leghe estere.
2. **Sofascore**: rating per-partita → `external_stats(source='sofascore')`; heatmap → `positions` (fattore 21).
3. **Voto sintetico calibrato**: fit rating Sofascore → Mv base sulla sovrapposizione; applicato alle partite mancanti; layer taggato, mai nel target `euro`.

## Whitelist
`fantacalcio.it` e sottodomini · `api.clubelo.com` · `fbref.com` · `transfermarkt.com/.it` · `query.wikidata.org` · `sofascore.com` + `api.sofascore.com`. Libreria candidata: soccerdata (PyPI). Rate-limiting educato, cache grezzi, hash per aggiornamenti.
