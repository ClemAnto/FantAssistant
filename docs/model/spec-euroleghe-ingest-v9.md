# Spec — Toolkit `euroleghe-ingest` v9 (task 1.0 della roadmap)
**Aggiornata: 29 luglio 2026 (v9.8 — stagione spaccata club/altrove, ballottaggi sul ruolo REALE, identità sofascore; v9 SOSTITUISCE la v8)** · Python · Output: SQLite `euroleghe.db` + CSV normalizzati
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
   **Un'identità non è un fatto di stagione** (v9.8, 29/07/2026): `player_xref` si scrive in **un unico
   passaggio** su tutte le stagioni del run (`positions._store_identities`), evidenza più forte e a pari
   merito la stagione più recente. Scritta dentro il giro per stagione la decideva l'ultima stagione
   processata, e 827 `fc_id` sono finiti con gli aggregati in tabella e **nessun** id — invisibili a ruoli
   granulari, heatmap e layer per-partita insieme, perché passano tutti da lì. Corollario: un run limitato
   a certe stagioni **non cancella** identità (non ha letto le stagioni che le stabiliscono), un run su
   tutta la cache sì.
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

## Novità v9.3 (uso rivelato del reparto, 28 luglio 2026 — tutto OFFLINE)

Nessuna richiesta di rete: i dati erano già in cache e il parser li buttava.

1. **Sei colonne di tiro su `external_match_stats`** (`shots`, `shots_on_target`,
   `big_chances_created`, `big_chances_missed`, `key_passes`, `touches`): stavano nei blob dei round
   SofaScore già scaricati e `parse_round` le scartava. `shots` è il segnale «chi è il riferimento
   offensivo» dentro un reparto, e c'è sul 100% delle righe.
2. **`club_match_lineups(season, source, match_id, club, competition, real_md, match_date, starters,
   goalkeepers, defenders, midfielders, forwards)`** — conteggi di formazione a livello di CLUB.
   ⚠️ Il motivo per cui è una tabella a sé è un difetto trovato **misurando, non rileggendo il
   codice**: contare quanti attaccanti un club schiera non ha bisogno dell'identità, ma passare per
   l'imbuto `matching.py` distorce esattamente i club i cui giocatori di frangia non sono quotati
   (Serie A 24/25: 233 undici su 774 completamente risolti, e la **Juventus zero**). Le righe si
   accumulano su TUTTE le voci di formazione, risolte o no; K = attaccanti per undici si legge solo
   dagli undici completi (`starters = 11` e somma dei reparti `= 11`), con soglia ≥10 undici per club.
3. **`probable_starter` tiene il record completo**: nuove colonne `team`, `formation` (il modulo
   dichiarato: 3-5-2 = due attaccanti contro 4-3-3), `starter`, `role`, `status`, e **le righe di
   panchina non si scartano più** (prima `probability IS NULL` = riga buttata: metà del segnale di
   gerarchia). Vale da adesso in avanti — è la forma pre-registrata di uno storico che si accumula.
4. **`positions --layer reparse`**: ri-parsa la cache e ricalcola i ruoli, senza toccare la rete
   (`--layer match` ri-sonda gli slot mancanti). ⚠️ Trovato un bug qui: la costante `SEASONS`, che è
   un default di *download*, limitava silenziosamente il reparse a 3 stagioni su 7.

Le tre feature del motore che leggono questo strato (`club_forward_caps`, `forward_co_starts`, il
cross-tab di vocabolario provider-`F` ↔ listone-`A`) stanno in `engine/features.py` e hanno prodotto
un verdetto negativo (R17) e una valuta d'asta spenta: `gate-motore-v1.md` §4 e
`metrica-asta-surplus-v1.md` §11. **I dati restano, e non erano costati niente.**

## Novità v9.4 (28 luglio 2026, sera-notte — «completiamo il toolkit»)

Quattro richieste dell'utente in una sessione: chiudere i buchi del toolkit, **esportare** tutto quello
che serve all'app, **ricostruire da zero** su un'altra macchina, e **rifare la UI**. Tutto fatto.

### 1. I due buchi dichiarati dalla v9.2 sono chiusi

- **`injuries` (nuovo modulo, Transfermarkt)**: `verletzungen/spieler/{id}` → assenze datate con
  `end_date`, `kind` normalizzato (16 categorie: knee/ankle/muscular/illness/...), `days_out`, e la
  colonna che serve davvero al modulo presenze — **`matches_missed`**, perché i giorni diventano
  partite solo passando per il calendario e la fonte quella traduzione l'ha già fatta. Più `detail`
  (l'etichetta originale) e `source`. Una pagina per giocatore, 15 righe per pagina, `/page/{n}` per
  il resto: **ore, ripartibile**. Gli id Transfermarkt arrivano dalle pagine `kader/verein/{id}/saison_id/{anno}`
  e — gratis, offline — dalle pagine trasferimenti già in cache.
- **⚠️ `exit_risk` è misurabile SOLO da adesso.** La pagina rosa di una stagione PASSATA non porta la
  colonna «Contratto» (verificato sulla fonte): la scadenza esiste solo sulla rosa corrente. Quindi
  `flags(contract_until)` (il fatto) e `flags(exit_risk)` (il giudizio, soglia **provvisoria** di 12
  mesi) sono uno **snapshot di oggi**, utilizzabili per l'asta che viene e **non gatabili** su T1/T2.
  Registrato nel manifest dell'export tra i `known_gaps`, non nascosto.
- **Heatmap → `positions.avg_x/avg_y`** (`positions --layer heatmap`): endpoint di stagione
  `player/{id}/unique-tournament/{t}/season/{s}/heatmap/overall`, **una richiesta per
  giocatore-stagione** (la variante per-partita ne costerebbe 30 volte tanto). Il centroide è pesato
  per `count`: una media non pesata conta un pallone toccato in area come i cento sulla fascia.
  Convenzione verificata su un portiere (avg_x 1.4): x = distanza dalla PROPRIA porta, y = larghezza.
  **Confine dichiarato**: il toolkit salva le coordinate, trasformarle in un ruolo Mantra (dd vs dc) è
  una scelta di modello e sta dietro al gate.

### 2. Cross-tab dei ruoli: la domanda aperta sui reparti D e C ha una risposta

`positions --layer crosstab` (offline) → `data/reports/role_crosstab.csv`. Misurato su 149 585
presenze: provider **G→P 100%**, **D→D 97%**, **M→C 80%** (11% D, 9% A), **F→A 80%** (20% C).
Quindi estendere i conteggi di reparto ai **difensori è pulito** (97%), ai centrocampisti costa la
stessa ambiguità già accettata per gli attaccanti. Era il prerequisito dichiarato in todolist.

### 3. Riproducibilità da zero (richiesta dell'utente)

- **`bootstrap` (nuovo)**: il piano di acquisizione ordinato, eseguibile e ripartibile —
  `bootstrap --plan` stampa 15 passi, le opzioni e il costo (**~17 ore**, quasi tutte di attesa
  educata). Rifiuta di partire senza credenziali invece di costruire mezzo DB. `--from/--to/--skip`
  per riprendere un pezzo.
- **`elo` non legge più un CSV fatto a mano**: `api.clubelo.com/YYYY-MM-DD` restituisce OGNI club
  d'Europa a QUALSIASI data in una richiesta. Le date vengono da `engine.features.WINDOWS` (così la
  data d'asta è definita in un solo posto, compreso il settembre 2020 del COVID). Effetto misurato:
  `club_elo` da **76 righe su 2 date a 921 su 10 date, 99 club** — e riproducibile da zero. Servono 16
  alias (ClubElo scrive «Bayern», «Man City», «Paris SG»: senza la mappa i club più forti di quattro
  leghe restano senza Elo, cioè esattamente la popolazione del modulo portieri). Il seed CSV storico
  resta letto con `INSERT OR IGNORE`, perché i numeri pubblicati sono stati prodotti con quello.
- **La lega di un club si deriva dalla rete** (`positions.derive_club_leagues`): su questa macchina
  `clubs.league` veniva dagli export Drive, che una macchina nuova non ha, e il listone euro **non
  dice in che lega gioca un club**. La cache provider lo dice per costruzione (un file = una lega).
  Riempie solo i NULL.
- **`fetch` non è più uno stub**: `--plan` è il referto «cosa manca qui», tabella per tabella, con il
  comando che colma ogni buco; `--inbox` importa gli export Drive da `data/inbox/` (unico passo
  manuale del progetto, e **opzionale**: il listone crea registry+rose da solo).
- **`.env.example` creato** (era citato da CLAUDE.md e non esisteva) e `config.SEASONS` è ora la
  **fonte unica** delle stagioni: aprire il 2026-27 ad agosto è UNA modifica, non tre.
- **`ingest_runs` finalmente scritta** (esisteva vuota): una riga per run — modulo, quando, esito,
  opzioni — dalla CLI, dal rebuild e dalla GUI. La scrive chi POSSIEDE l'invocazione, non il modulo,
  perché un modulo che si loggasse da solo perderebbe i run morti prima del log, che sono quelli che
  interessano.

### 3-bis. Cinque club del perimetro non combaciavano con Transfermarkt (trovato misurando la copertura)

`club_xref` aveva **46** club e la camminata infortuni copriva il **55%** del perimetro 2025-26, con
squadre intere assenti: **Fiorentina, Genoa, Lilla, Rennes, Betis**. Causa: la tabella di competizione
scrive il nome **ufficiale** («ACF Fiorentina», «LOSC Lilla», «Real Betis Balompié», «Stade Rennes FC»)
e un listone mai, e `resolve_clubs` faceva una lookup secca.

`matching.match_club` applica ora la stessa disciplina del matcher giocatori — passi ordinati, e **un
passo vale solo se la risposta è unica**: chiave esatta → parole di forma societaria rimosse da
**entrambi** i lati → fuzzy 0.88. Effetto: `club_xref` **46 → 51**, spell allenatori 2273 → **2316**,
trasferimenti 1919 → **3038**. Serie A ora 20/20.

⚠️ **Un passo per sottoinsieme di parole è stato scritto, misurato e CANCELLATO**: produceva due club
sbagliati — «Paris FC» → Paris Saint-Germain (club diverso, stessa città) e «RCD Espanyol Barcellona» →
Barcellona. Nessuno dei due è catturabile dall'unicità: nel perimetro non esistono né Paris FC né
Espanyol, e **un pool a cui manca la risposta giusta non si salva col tie-break, solo rifiutando di
tirare a indovinare**. Entrambi sono test negativi. Il **limite** del passo sopravvissuto è asserito,
non nascosto: un nome di sola città si attacca al club che si riduce a quella città («Madrid» → Real
Madrid), che è la stessa regola che fa trovare «Betis».

### 4. `export` (nuovo): il bundle dell'app

`export` scrive `data/export/<stagione>/`: `bundle.sqlite` (copia potata, **stesso schema**),
`json/*.json.gz` (una tabella per file, per un runtime senza SQLite), `config/` e `manifest.json`.
Misurato: **229 116 righe, 29 MB SQLite / 2,5 MB JSON gzip** su 21 tabelle.

- Il **contratto è derivato da quello che `engine/features.py` interroga davvero**, tabella per
  tabella, con il motivo scritto accanto: una regola futura che legga una tabella nuova va aggiunta
  lì. Escluse *con motivazione registrata*: `match_rating_bonuses` (2,8M righe che il motore non
  legge), `player_xref`/`club_xref` (l'app non ri-risolve identità), `ingest_runs`.
- Le tabelle per-partita viaggiano **solo per le ultime `--history` stagioni** (default 2): il motore
  le legge per la sola stagione di input, e questo è ciò che tiene il bundle a 29 MB invece di 284.
- Il **manifest porta ciò che un bundle senza manifest fa sbagliare**: provenienza (commit, data,
  versione), quali prezzi sono auction-safe (`price_initial`) e quali solo reporting (`price`, `fvm`),
  i **parametri provvisori con i loro valori** letti dai moduli, il set adottato per piattaforma, e i
  `known_gaps`.
- `--verify` **ri-apre** il bundle scritto: integrità referenziale, `foreign_key_check`, presenza
  della stagione di input per ogni piattaforma. Distingue **problema** (bundle rotto → l'export
  fallisce) da **nota** (buco del mondo: euro non ha stagioni prima del 2018-19). Un bundle è l'unico
  artefatto che nessuno rilegge prima di spedirlo.
- ⚠️ `data/export/` è in `.gitignore`: il bundle porta lo stesso contenuto a pagamento della cache e
  **il repo è pubblico**.

**Verifica empirica del contratto** (l'unica che conta): l'harness del gate è stato eseguito puntando
`EUROLEGHE_DB_PATH` **al bundle** invece che al DB. Output `backtest --window T2` **identico carattere
per carattere**. Due difetti trovati così, che nessuna rilettura del contratto avrebbe visto:

1. Le righe `sofascore_recent` (i giocatori senza storico) sono etichettate con la stagione del
   **listone** per cui sono state scaricate, non con quella della partita: una finestra di due stagioni
   ne buttava 570. Ora viaggiano sempre (`also` nella TableSpec).
2. **`--history` deve coprire anche la finestra di CROSS-FIT, non solo la stagione di input.** Con due
   stagioni le osservazioni erano identiche e **tutte le metriche del gate combaciavano**, e la lista
   d'asta era comunque diversa: i coefficienti erano fittati su una finestra il cui layer per-partita
   era assente. Default portato a **3**, con il motivo scritto nel manifest (`heavy_seasons_note`) e un
   test di regressione. Costo: 39 MB invece di 29.

**Effetto collaterale trovato inseguendo quella differenza — il ranking d'asta non era deterministico.**
Un giocatore senza storico è prezzato all'àncora del ruolo, quindi decine condividono lo stesso VALORE
previsto e l'ordine fra loro lo decideva l'ordine fisico delle righe di SQLite (un portiere: 35° su un
file, 60° sull'altro). Ora il tie-break è `fc_id`. **Nessuna previsione cambia**, e `--verify` resta a
**15/18** numeri pubblicati con gli stessi tre in revisione. Cambia UNA cosa: un portiere passa da miss
«near» a «regime» — e la lezione è che per i giocatori prezzati all'àncora quell'etichetta era **già**
arbitraria, perché sono tutti a pari merito.

### 5. UI rifatta (richiesta dell'utente)

Nuovo `ui_theme.py`: palette semantica (`surface`, `border`, `text_muted`, `accent`, ...) in due
varianti **light/dark**, scala tipografica, stili ttk (tema `clam`, l'unico che rispetti i colori su
Windows) e una **glifo-icona per operazione**. Il codice di disegno legge i colori **al momento del
disegno**, che è ciò che permette di cambiare tema senza riavviare; la preferenza è ricordata.
Pannello Operations ricostruito: card per cadenza, riga = pallino di stato + icona + nome, **striscia
di metriche** (tabelle popolate, giocatori, voti, righe per-partita), riga di dettaglio con le tabelle
vuote in chiaro, **log colorato per severità** con copy/clear, status bar con l'ultimo run letto da
`ingest_runs`. Aggiunti i pulsanti mancanti: **Bootstrap**, **What is missing?**, **Export app bundle**.
Non tematizzati **di proposito**: pillole ruolo e celle-stato dei fantavoti — sono codifiche di dato,
devono significare la stessa cosa nei due temi.

## Novità v9.5 (28 luglio 2026, notte — lo SNAPSHOT D'ASTA, richiesta dell'utente)

Un tasto e un comando: `snapshot` prepara, **alla data di oggi**, tutto quello che serve per costruire
il piano d'azione di un'asta iniziale. Dopo aver scelto **piattaforma** (euro|default) e **game**
(classic|mantra), scrive `data/reports/auction-snapshot-{stagione}-{piattaforma}-{game}-{data}/` con
`players.csv`, `clubs.csv` e `manifest.json`. Misurato al primo giro: **1453 giocatori, 46 club**.

### La regola che questo modulo rispetta, ed è visibile nell'header del CSV

- **`engine_*`** = la valutazione che **ha passato il gate**: FM prevista, presenze attese, VALORE,
  **SURPLUS**, livello di sostituzione del ruolo, rank nel ruolo. Prodotta **chiamando `engine/`** —
  mai riscritta qui — col set ADOTTATO della piattaforma e i parametri fittati su una finestra che non
  è quella che si sta prezzando. È ciò che impedisce al foglio e al gate di divergere.
- **`desc_*`** = colonne **DESCRITTIVE e NON gatate**, calcolate qui per l'umano che legge il foglio:
  forma sulle ultime 10 partite (rating, minuti/partita, gol, assist, titolarità), probabilità di
  titolarità dall'ultimo snapshot probabili, **minutaggio presunto**, **ballottaggi** (stesso club,
  stesso ruolo, probabilità entro 0.25), **propensione infortuni** (partite perse pesate per recenza
  1.0/0.6/0.35), infortunio aperto, disponibilità odierna, propensione ai bonus (gol/assist/xG/xA per
  90 sulla stagione reale piena), **rigorista** (gerarchia rivelata: rango + confidenza), correttezza
  (cartellini per presenza), contratto/exit risk/arrivo/cifra/anni al club/nuovo allenatore.
  ⚠️ **Nessuna di queste può diventare un coefficiente senza una corsa di gate pre-registrata**: sei
  famiglie di ipotesi sulla fantamedia sono già morte così.
- Per club: allenatore e da quando, flag nuovo allenatore, **modulo** dall'ultimo snapshot probabili,
  **linee realmente schierate** (media D/C/A per undici completo, con il numero di undici), arrivi, Elo.

### Quello che le fonti NON dicono, dichiarato invece di essere inventato

- **«rapporto con la società»**: nessuna fonte della whitelist lo afferma. Quello che è misurabile sono
  i *proxy* (`contract_until`, `exit_risk`, arrivo/tier/cifra, anni al club, nuovo allenatore).
- **piazzati oltre i rigori**: l'API dei voti non riempie mai `assists_set_piece`, quindi corner e
  punizioni non sono attribuibili. I rigori sì, e dalla gerarchia **rivelata** dai nostri voti.
- **«idee dell'allenatore»**: nemmeno quelle sono scritte da nessuna parte. Misurato: chi è, da quando,
  se è nuovo, il modulo di oggi e quante maglie per linea il club ha davvero schierato.

### Due date che rendono onesta una prova a vuoto

La data d'asta è **`min(15 agosto della stagione bersaglio, oggi)`**: per la stagione che si sta
comprando è oggi (quindi contano le probabili e gli infortuni di oggi); per una stagione **già giocata**
è il suo 15 agosto, così una prova a vuoto non può leggere il futuro che finge di non sapere. E se la
stagione bersaglio è la stessa su cui sono fittati i parametri, il manifest lo dice: **DRY RUN, non una
affermazione fuori campione**.

Colonne sottili sono elencate a fine corsa (`<20% riempite`), e il manifest porta la copertura di
**ogni** colonna: un foglio dove «titolarità» è vuota per tutti va saputo prima di decidere, non dopo.
Al primo giro sono vuote titolarità e ballottaggi — le probabili sono uno stato di **oggi** e la loro
storia parte dal giorno in cui il job settimanale ha iniziato a girare.

## Novità v9.7 (28 luglio 2026, notte tarda — il RUOLO REALE granulare: 12 codici, e dove si posiziona)

Richiesta dell'utente: «ogni calciatore deve avere il proprio ruolo reale … per sapere orientativamente
dove collocarlo in campo», recuperato **quando gira lo snapshot**.

### 1. Il vocabolario: dodici codici, ENUMERATI e non ricordati

`GK` · `DL DC DR` · `DM` · `ML MC MR` · `AM` · `LW RW` · `ST` — da uno a tre per giocatore, nell'ordine
del provider (il primo è quello con cui viene disegnato). Etichette italiane (`positions.REAL_ROLE_LABEL`,
italiano per lo stesso precedente dei badge del campetto: sono le parole con cui si prepara un'asta):

| codice | italiano | badge | codice | italiano | badge |
|---|---|---|---|---|---|
| `GK` | portiere | `P` | `MC` | centrocampista centrale | `C` |
| `DL` | terzino sinistro | `Ts` | `MR` | esterno di centrocampo destro | `Ed` |
| `DC` | difensore centrale | `Dc` | `AM` | trequartista | `T` |
| `DR` | terzino destro | `Td` | `LW` | ala sinistra | `As` |
| `DM` | mediano davanti alla difesa | `M` | `RW` | ala destra | `Ad` |
| `ML` | esterno di centrocampo sinistro | `Es` | `ST` | punta centrale | `Pc` |

**Enumerati misurando**: 128 giocatori campionati sulle quattro linee non hanno restituito nient'altro, e
tutti ne avevano almeno uno. Non esiste un codice «seconda punta»: torna come `AM` o `ST`. Un tredicesimo
codice a monte viene **stampato nel log** (`unknown_role_codes`) invece di essere assorbito in silenzio.

**Perché serve, e perché nessuna colonna esistente lo sostituisce**: `rosters.role_classic` chiama `D` sia
un terzino sinistro sia un centrale, e **`positions.derived_role` li chiama `D` entrambi anche lui**. Il
ruolo granulare è la sola cosa che li separa. Sullo stesso asse: `DM`/`MC`/`AM` sono tre posti diversi in
campo e per il listone sono tutti e tre `C`.

### 2. È una GRIGLIA: lato e profondità, quindi si posiziona

`REAL_ROLE_SIDE` (−1 la sinistra della squadra … +1 la sua destra) e `REAL_ROLE_DEPTH` (0 = porta propria,
1 = porta avversaria — **lo stesso asse su cui è misurato `positions.avg_x`**):

```
                    ST                      1.00
          LW        AM        RW            0.80
          ML        MC        MR            0.60
                    DM                      0.45
     DL         DC      DC         DR       0.25
                    GK                      0.00
   sinistra        centro         destra
```

A differenza del listone, **ognuno dei dodici o nomina una fascia o è centrale**: sono `e` (esterno) e `w`
(ala) del Mantra a lasciare il lato aperto. I numeri sono posizioni di **DISEGNO** — una scelta di layout,
non una quantità fittata: nulla di predittivo li legge, e `avg_x/avg_y` dalla heatmap è la versione
misurata che vince dove è riempita.

### 3. Precedenza sul lato, DECISA MISURANDO

`desc_side_measured` (centroide heatmap, asse calibrato sui terzini) e il codice concordano su **196 dei
219** laterali del foglio (**89%**). Regola adottata: dove il codice nomina una fascia si tiene il valore
misurato — che dice anche *quanto* stava largo — **a meno che** contraddica il codice o legga centrale
(|misura| < 0.1); là vince il codice, perché un `DL` non è un centrale. Un codice **centrale** invece non
è una pretesa sulla fascia: un nominale `DC` che ha fatto il sinistro di una difesa a tre esce a sinistra
dalla misura, ed è esattamente il caso che la heatmap prende bene. Verificato: Bastoni `DC;DR` → −0.53.

### 4. Come si recupera: una richiesta per CLUB, non per giocatore

**`/api/v1/team/{id}/players`** porta `positionsDetailed` + `preferredFoot` per l'INTERA rosa corrente in
**una** richiesta: 35 club di perimetro invece di ~1500 giocatori, ~2 minuti al primo giro. Trovato
sondando l'API: `positionsDetailed` sull'oggetto giocatore è identico a `characteristics.positions`
(38/38 sul campione), quindi una sola richiesta basta per entrambi.

- **`positions --layer roles`** (nuovo): `derive_club_xref` (i **team id** del provider dedotti *offline*
  dalle cache `sofascore_stats_*.json` già presenti — nessuna fonte nostra ne portava uno: **92 club**) →
  `fetch_roles` (passata per club, poi **top-up** per giocatore per chi nessuna pagina rosa copriva,
  ordinato per Qt.I e limitato) → `ingest_roles_from_cache`.
- Cache **datata** (`sofascore_squad_{team}_{data}.json`): rieseguire lo stesso giorno costa **zero**
  richieste, e la corsa del mese prossimo è una nuova osservazione, non una sovrascrittura.
- ⚠️ Il top-up è **legato agli stessi club** della passata per club. Senza quel vincolo camminava su tutte
  le 77 squadre di `squad_snapshot` contro le 38 comprabili, spendendo una richiesta per giocatore su rose
  la cui pagina di club, più economica, non era mai stata chiesta — per righe che il foglio poi filtrava.
- ⚠️ `clubs` ha righe doppie per lo stesso club reale (`Eintracht` / `Eintracht Francoforte`) e la PK di
  `club_xref` è `(source, source_id)`: entrambe reclamano lo stesso team id e l'ultima vinceva in
  silenzio. Risolto in chiaro — vince la riga con più giocatori in rosa — e le perdenti finiscono **nel
  log**, così un club che smette di avere la pagina rosa è una riga da leggere, non un buco da trovare.

### 5. Dove finisce: `player_roles`, DATATA — il TERZO fatto non backfillabile

`player_roles(fc_id, valid_from, source, roles, primary_role, line, foot)`. Datata **perché deve esserlo**:
il provider serve solo «adesso» — `?seasonId=` risponde **200 e lo IGNORA**, restituendo i codici di oggi
per una stagione di tre anni fa. Verificato: Dimarco torna `['ML']` sia per 25/26 sia per 23/24. Quindi si
affianca a `probable_starter` e `flags.contract_until`: **ogni giorno in cui non viene osservato è un
giorno che non esisterà mai**. Nei `known_gaps` del bundle e nel CONTRACT dell'export.

Storiche e non toccate, invece: `positions.derived_role` (G/D/M/F per stagione, dal layer per-partita) e
`positions.avg_x/avg_y` (heatmap di stagione).

Identità **solo** via `player_xref`, come il layer per-partita: chi non è risolto viene contato e saltato,
mai indovinato per nome — i fallback sul cognome sono ciò che ha fatto collassare dieci «Sanchez» in un
giocatore, e su un foglio il cui compito è dire dove gioca un uomo **un ruolo sbagliato è peggio di un
ruolo mancante**.

### 6. Nello snapshot e nella vista

`refresh_real_roles` gira a **ogni** snapshot, accanto alle probabili e per la stessa ragione. Sette
colonne nuove: `desc_real_roles`, `desc_real_role_primary`, `desc_real_role_line`,
**`desc_real_role_depth`**, **`desc_real_role_side`**, `desc_foot`, `desc_real_role_observed` — le
posizioni di disegno viaggiano nel CSV, così **chi legge il foglio lo colloca come il campetto** invece di
inventarsi una mappatura. Il piede arriva gratis nella stessa richiesta e distingue un `DL` mancino da uno
adattato.

Nella vista il codice granulare decide **fascia**, **profondità** (spostamento *dentro* la linea, limitato
a ±18 px: colloca un uomo nella sua linea e non lo sposta in un'altra — quale linea sia viene dal modulo e
dalla titolarità, e quella decisione non si riapre qui) e **badge**; la colonna `real` mostra `DL/ML`.
Dove manca, tutto ricade esattamente su prima (slot modale + ruolo Mantra con fascia).

**Misurato al 28/07**: 1372 osservazioni datate; **745/883 righe del foglio col ruolo granulare (84%)**;
i 221 mancanti su 1343 sono identità non risolte a un id provider — la linea resta nota, manca la fascia.
Piede: 506 destro, 204 sinistro, 35 ambidestro. Verificato sui casi reali: Dimarco `D/e` → `ML`, badge
`Es`, lato −0.62, profondità 0.60 (davanti alla difesa); Calhanoglu `C/m;c` → `DM;MC`, badge `M`,
profondità 0.45 (dietro le mezzali).

**Nessun verdetto del gate cambia**: è un fatto descrittivo e una scelta di layout.

### 7. I dodici codici → il vocabolario MANTRA (mappatura dell'utente)

Il Mantra **semplifica**, quindi la traduzione è lossy di proposito — il codice granulare resta la cosa
che colloca un uomo in campo, questo dice solo come lo chiamerebbe un'asta Mantra
(`positions.REAL_TO_MANTRA` + `mantra_roles()`, `desc_mantra_real` nel foglio):

| provider | Mantra | nota |
|---|---|---|
| `GK` | `por` | |
| `DL` / `DR` | `ds` / `dd` | in difesa la fascia il Mantra la nomina |
| `DC` | `dc` | |
| `DM` | `m` | |
| `ML` / `MR` | **`e`** | esterno: il Mantra **non** nomina la fascia → i due collassano |
| `MC` | `c` | |
| `LW` / `RW` | **`w`** | ala: idem |
| `AM` | **`t`** o **`a`** | trequartista se più centrocampista, attaccante se più avanti |
| `ST` | `pc` | |

Due ruoli che **nessun codice singolo** produce, e per questo avere fino a tre codici per giocatore vale
più che averne uno:

- **`b` (braccetto)** = un terzino che può giocare centrale in una difesa a tre. È una **combinazione**:
  codice difensivo di fascia **insieme** a `DC`. Misurato: **139** giocatori, dove il listone 25/26
  assegna `b` a **28**. Il listone è il più parsimonioso dei due e questo è una *capacità* («può giocare
  centrale»), quindi non è atteso che i numeri coincidano: registrato, non tarato.
- **`t` vs `a` per `AM`**: lo decide la **linea larga del provider**, già in `player_roles.line` — dei
  giocatori `AM`, **63 sono linea `M` → `t`** e **19 linea `F` → `a`**.

⚠️ Non sostituisce **mai** `rosters.roles`: quelli sono ciò per cui il listone lo vende e restano la
fonte di verità dove esistono. `desc_mantra_real` **esiste per il caso in cui non esistano**, che a luglio
è la norma: nel foglio 26/27 **1343 giocatori su 1343** non hanno una riga di listone.

Confronto dove entrambi ci sono (727 giocatori): **48% insieme identico**, **44% condividono almeno un
ruolo**, **8% disgiunti** — e le disgiunte sono quasi tutte `a` del listone contro `w` del provider (24 su
57). Non è un errore della mappatura: è esattamente la distinzione che questa colonna serve a rendere
visibile — il listone dice **per cosa lo compri**, il provider **dove gioca**. Riscontri esatti:
Calhanoglu `DM;MC` → `m;c` = listone `m;c`; Dimarco `ML` → `e` = `e`; Carlos Augusto `ML;DC;DR` →
`e;dc;dd;b` contro `b;ds;e`.

## Novità v9.8 (29 luglio 2026 — di chi era quella stagione, chi è in ballottaggio, e 815 identità)

Tre cose, in cascata: la terza è emersa perché la seconda l'ha resa misurabile.

### 1. La stagione misurata arriva SPACCATA fra il club attuale e altrove
I totali dicono quanto un allenatore lo ha usato; non dicono **di quale** allenatore. Solo il layer
per-partita ha un club per presenza, quindi `snapshot.at_current_club` scrive nel foglio le due metà:
`desc_season_starts_club` / `desc_season_starts_elsewhere`, `desc_minutes_club` / `desc_minutes_elsewhere`.
Sono metà di ciò che ha misurato **quel** layer — da leggere come quota, mai come conteggio da confrontare
con l'aggregato di stagione (divergono di un paio di partite: il layer porta competizioni che l'aggregato
non ha). Chi non ha righe per-partita resta **fuori** dal risultato: colonne vuote = ignoto.

La vista non scegli un ramo, **pesa**: `SnapshotView.at_club_weight` = quota minuti al club attuale +
**`LOAN_DISCOUNT = 0.60`** sul resto, applicato a `standing` **e** a `voto_share`. Chi non si è mosso è
identico a prima, chi ha giocato tutto altrove vale 0.60, un trasferimento di gennaio sta in mezzo — quindi
**lo sconto decresce da sé** con le partite al club, senza un secondo parametro. Marin R. 0.57 → **0.34**,
dietro Rrahmani (0.81). Su euro: 145 scontati su 842 con lo split noto, 88 interamente altrove.
`LOAN_DISCOUNT` è **provvisorio**, è una scelta di MODELLO → la possiede il gate. Aperto: prestito vs
acquisto (un comprato non è stato bocciato da QUESTO club).

### 2. Un ballottaggio è un duello fra RUOLI REALI, mai fra ruoli fanta
Decisione dell'utente. Serve un **codice granulare condiviso** (uno basta: `RW;AM` e `AM` competono), e
**nessun ripiego** sul ruolo Classic né sulla fascia che implica (senza codici `side_of` legge i ruoli
Mantra, che è di nuovo il listone). Il ruolo Classic diceva che al Napoli Politano, Lobotka, Elmas,
McTominay, Anguissa, De Bruyne, Vergara e Neres sono la stessa cosa — «Politano in ballottaggio con un
regista». Vale in `snapshot.duels` e in `SnapshotView.can_replace`. Chi non ha codici osservati **esce dalle
colonne**: vuoto = ignoto, mai «0 rivali».
Corretti nello stesso passaggio due modi di perdere un'alternativa vera: la lista dei probabili ora
**filtra** il bench posizionale invece di sostituirlo (quando non nominava nessuno di quella maglia,
l'intersezione era vuota e le alternative sparivano), e le alternative si scelgono **a undici formati** (una
maglia i cui due migliori sfidanti diventavano titolari restava senza nessuno). Nel modo *prossima
giornata* vengono da **tutta la rosa** ordinata per `presence(recent)`, senza secchiello di linea (i
trequartisti erano arenati in un undici che non ne schiera) e con un uomo offerto una volta sola.

### 3. Un'identità non è un fatto di stagione — 815 id sofascore recuperati
Il vincolo del ruolo reale ha reso visibile un buco preesistente: **827 `fc_id` avevano gli aggregati
`external_stats` (source `sofascore`) e nessuna riga in `player_xref`** — e ruoli granulari, heatmap e layer
per-partita passano tutti da lì, quindi erano invisibili a tutti e tre insieme (Saka, Guirassy, Torres F.,
Sorloth, Mbeumo, Cunha). Causa: l'identità era scritta **dentro il giro per stagione**, che prima cancellava
le xref dei provider id da ri-risolvere e poi riscriveva solo le claim sopravvissute di QUELLA stagione →
la decideva l'ultima stagione processata. Fix: **`positions._store_identities`**, un passaggio unico su
tutte le stagioni del run (evidenza più forte, a pari merito la stagione più recente), con `authoritative`
che distingue «tutta la cache» (può cancellare: non rivendicato **è** un verdetto) da «alcune stagioni»
(non cancella mai — non ha letto le stagioni che stabiliscono l'identità).

Recupero **interamente offline** (`reingest_from_cache` su 11 stagioni, ~460 s, + `positions --layer
reparse`): xref **3021 → 3836**, orfani **827 → 7**, `external_match_stats` **~270k → 334.795**, giocatori
del foglio euro senza codice granulare **152 → 32**, split club/altrove noto **710/905 → 842/916**, maglie
senza alternativa **228/680 → 129/685** con **843** alternative tutte su codice reale condiviso. I 7 residui
sono omonimi vecchi il cui provider id ora appartiene a un altro `fc_id`: esito giusto, solo uno può averlo.

**230 test verdi, ruff pulito.**

## Novità v9.6 (28 luglio 2026, notte — precisazioni sullo snapshot, e la VISTA)

Precisazioni dell'utente, tutte con conseguenze sui dati e non solo sulla UI.

### 1. Lo snapshot lavora sulle ROSE REALI, listone o non listone

Nuova tabella **`squad_snapshot(fc_id, valid_from, club, source, role_hint)`** — chi è davvero in rosa a
una DATA, da tre fonti in ordine di forza: **fc_site** (le probabili portano un fc_id esatto nell'href:
20 squadre di Serie A, certe), **transfermarkt** (la pagina rosa CORRENTE dei club del perimetro, già in
cache), **apparizioni** (chi ha giocato per il club negli ultimi 14 mesi, **solo** per i club senza
pagina rosa). Ogni fonte è datata **con la propria data**, non con quella della corsa.

`features.load` ha ora `squad_source='listone'|'real'` (default listone → **nessun numero del gate si
muove**). Con `'real'` il set di righe include chi è in rosa e **non** nel listone: il ruolo viene dalla
sua ultima riga di listone, il prezzo resta NULL — il caso che R0c già gestisce (prezza all'àncora).
Il target di default non è più «il listone più recente» ma **la stagione a cui appartiene oggi**: a
luglio si prepara l'asta di una stagione il cui listone non esiste, ed è il senso dell'esercizio.
Misurato: 26/27 = **890 giocatori, 34 club**, senza quotazioni, con FM/presenze/SURPLUS previsti.

⚠️ Tre difetti trovati **provando** il foglio, non rileggendolo:
- il backstop «apparizioni» senza limite temporale metteva **Handanovic e Cordaz nell'Inter 2026** e
  faceva del Lecce un club da 70 giocatori → finestra di 14 mesi, e la **pagina rosa vince** dove c'è;
- le rose venivano ridatate alla data d'asta: le probabili di luglio 2026 informavano un'asta di agosto
  2025. **Look-ahead**, corretto;
- il foglio euro elencava Verona, Genoa, Cagliari — in EuroLeghe non si comprano. Filtro sul **perimetro
  della piattaforma** applicato **in uscita**, non al modello: le standardizzazioni del motore restano
  sulla popolazione su cui le regole sono state validate, quindi ogni numero è quello dell'harness.

### 2. La forma è sulle ultime 10 partite DEL CLUB, non del giocatore

`desc_form_club_matches` (le ultime 10 del club: unione di `club_match_lineups` e del layer per-partita,
quindi coppe e amichevoli comprese), `desc_form_measured` (quante hanno dati per-giocatore),
`desc_form_played`, **`desc_form_unused`** (panchina o fuori rosa — il layer non distingue, e lo dice),
`desc_form_unknown`. Chi ha cambiato club dentro la finestra ha le partite del **club di allora** + quelle
del club di adesso (due passate: la finestra dipende dai club e i club rilevanti dalle date della
finestra). Gol e assist **spezzati** `league`/`other` — dieci gol in amichevole valgono qualcosa, e non
dieci in campionato. Chi non è nel layer per-partita legge **UNKNOWN, non zero** (233 su 1453 del
listone 25/26).

### 3. La striscia delle ultime 10

Colonna `desc_form_series` nel foglio e **dieci pallini** nella vista (dal più vecchio a sinistra). Un
token per partita: `p:<rating>:<minuti>` giocata · `b` panchina o fuori rosa · `i` dentro uno spell di
infortunio registrato · `n` **nessun dato per-giocatore** su quella partita. ⚠️ `b` e `n` sono fatti
diversi: il primo dice «non ha giocato», il secondo «non lo sappiamo» (e include il non convocato).
Colori per fascia di rating (ciano ≥8.0, azzurro ≥7.3, verde ≥6.8, grigio ≥6.3, giallo ≥5.8, rosso
sotto), assenze **sfumate al 30%** sul fondo riga (Tk non ha alpha: si miscela), **contorno** = almeno
75 minuti giocati. Il contorno è **a contrasto col tema** e non bianco fisso: un anello bianco su riga
bianca non è un anello — com'era uscito al primo giro, e come l'ingrandimento ha mostrato. Le soglie sono
**presentazione**, non parametri di modello, e un test lo fissa.

### 4. La vista `Snapshot` (quarto tab)

Legge la cartella che `snapshot` ha scritto — non ricalcola nulla, quindi lettura e corsa non possono
divergere. Club a sinistra; a destra il box del club, il **campetto** (portiere in alto, attacco in
basso) con l'undici e i **ballottaggi** sotto ogni titolare, e la rosa ordinata **per ruolo e poi per
SURPLUS previsto**, ordinabile su ogni colonna, con tooltip su tutte. Colonna **`real`** = il ruolo in
cui è stato davvero usato (dal layer per-partita) accanto a quello di listone: Dimarco è comprato D e
usato C. I giocatori stanno alla loro **posizione laterale reale**, che funziona anche in Classic perché
la lateralità viene dai ruoli **Mantra** che il listone porta comunque (`ds` sinistra, `dd` destra); la
precedenza costa un bug: Carlos Augusto è `b;ds;e` e leggere il primo ruolo metteva un terzino sinistro
al centro della difesa.

**Come si scelgono gli 11** (due regimi, mai mescolati): se esiste uno snapshot probabili alla data
d'asta sono eleggibili **solo** i giocatori con una probabilità di titolarità, ordinati per quella;
altrimenti la rosa ordinata per **SURPLUS previsto**. Il campetto scrive quale dei due sta mostrando.
Chi ha un infortunio aperto o è indisponibile oggi **non entra** nell'undici del motore. Un'alternativa
in ballottaggio è per definizione **fuori** dall'undici: una difesa a tre di titolari equivalenti si
citava a vicenda, che non dice niente su chi è in ballottaggio con chi.

### 5. Il campetto mostra il MODULO TIPO

La **moda** degli undici completi realmente schierati, con la sua quota (Atalanta **3-4-3 al 97% di 38**,
Arsenal **4-3-3 al 63%**, Bayern **4-5-1 al 97%**), non la media delle linee — Arsenal 4.0/3.74/2.26
arrotonda a 4-4-2, un modulo mai giocato. Tutti e 34 i club ne hanno uno: prima metà erano vuoti perché
`club_match_lineups` è indicizzata con la grafia del provider e la query usava la nostra.
⚠️ Le linee sono contate nel **vocabolario del provider**, dove un'ala è un centrocampista: un 4-3-3 con
due ali legge 4-5-1. Scritto nel manifest e nella UI, con la traduzione misurata (G→P 100%, D→D 97%,
M→C 80%, F→A 80%).

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
`rosters` (SEMPRE primo) → `stats` → `ratings` (Excel autenticato, incrementale + backfill + resume + listone) → `matchdays` (calendario euro↔reale) → `fc_site` (rigoristi, probabili, indisponibili) → `transfers` → **`injuries`** → `fbref` (stub/bloccato) → `positions` (SofaScore: aggregati stagione + per-partita + heatmap) → `recent_form` → `synth` (voto sintetico calibrato) → `arrivals` → `tournaments` → `elo` (API ClubElo) → `validate`.
Fuori dalla pipeline, perché non producono tabelle di ingestione: **`bootstrap`** (acquisizione da zero), `fetch` (referto + inbox), `rebuild`, `backtest` (harness del gate), **`export`** (bundle dell'app).
Stato implementazione **v9.8**: **tutti i moduli operativi tranne `fbref`** (bloccato da Cloudflare: servirebbe un browser headless, oppure l'inbox manuale). Chiusi in v9.4: `injuries` + `contract_until`/`exit_risk`, heatmap `avg_x/avg_y`, `elo` via API, `ingest_runs`, `fetch --plan/--inbox`, `bootstrap`, `export`. **230 test verdi, ruff pulito.**

## Comandi
```
python -m euroleghe_ingest bootstrap --plan                # NUOVA MACCHINA: piano, ordine, costo (~17 h)
python -m euroleghe_ingest fetch --plan                    # cosa manca qui, e il comando che lo colma
python -m euroleghe_ingest positions                       # aggregati stagione, 5 leghe (~90 richieste)
python -m euroleghe_ingest positions --layer match         # layer per-partita, club del perimetro (ore)
python -m euroleghe_ingest positions --layer complete      # le partite che il filtro perimetro salta
python -m euroleghe_ingest positions --layer heatmap       # avg_x/avg_y, 1 richiesta per giocatore-stagione
python -m euroleghe_ingest positions --layer crosstab      # ruolo provider vs listone (offline)
python -m euroleghe_ingest injuries --layer ids            # id Transfermarkt + scadenze contratto
python -m euroleghe_ingest injuries --layer injuries       # storico infortuni, 1 richiesta per giocatore
python -m euroleghe_ingest elo                             # ClubElo: 1 richiesta per data d'asta
python -m euroleghe_ingest matchdays                       # mappa giornate euro<->reali + cross-check
python -m euroleghe_ingest synth                           # calibra rating->Mv e riempie mv_synth
python -m euroleghe_ingest export                          # bundle dell'app + manifest (verifica compresa)
```
Tutto è ripartibile (la cache grezza è la fonte di verità) e interrompibile; `rebuild` ri-ingerisce
offline. Ogni run lascia una riga in `ingest_runs`. Settimanale e **non recuperabile a posteriori**:
`pwsh scripts/weekly-snapshot.ps1 -Register` (le probabili sono uno stato di oggi).

## Schema principale (v9)
`players(fc_id PK, canonical_name, birth_year, nationality)` · `clubs(fc_club_id PK, canonical_name, league)` · `player_xref/club_xref(source, source_id, valid_from, valid_to)` · `rosters(fc_id, season, fc_club_id, roles, role_classic, league, price)` · **`season_stats(fc_id, season, platform, pv, mv, fm, goals, assists, …)`** · **`match_ratings(fc_id, season, matchday, platform, role, team, mv, goals, assists, …, fantavoto, status)`** · **`match_rating_bonuses(fc_id, season, matchday, platform, bonus_key, value)`** · **`external_stats(fc_id, season, source, competition, matches, starts, minutes, goals, assists, pen_scored, pen_taken, xg, xa, rating, yellows, reds)`** *(propensione stagione piena, PK con `source`+`competition`)* · **`external_match_stats(fc_id, season, source, match_id, competition, real_md, match_date, club, opponent, home, position, started, minutes, rating, goals, assists, xg, xa, shots, shots_on_target, big_chances_created, big_chances_missed, key_passes, touches, mv_synth)`** *(layer per-partita + voto sintetico; le sei colonne di tiro dalla v9.3)* · **`club_match_lineups(season, source, match_id, club, …, starters, goalkeepers, defenders, midfielders, forwards)`** *(conteggi di formazione a livello di club, fuori dall'imbuto dell'identità — v9.3)* · **`matchday_map(season, euro_md, league, real_md, source, confidence)`** *(allineamento euro↔reale per lega)* · **`positions(fc_id, season, source, avg_x, avg_y, derived_role, n_matches, is_friendly)`** *(avg_x/avg_y dalla heatmap di stagione — v9.4)* · `transfers_history` · **`injuries(fc_id, start_date, end_date, kind, days_out, matches_missed, detail, source)`** *(v9.4)* · `coaches` · `tournaments_squads` · `club_elo(fc_club_id, date, elo)` · `arrivals(fc_id, season, type, tier, origin_club, origin_league, foreign_fm_equiv)` · `penalty_hierarchy(...)` · `probable_starter` · `availability` · `flags(fc_id, season, flag, value, source)` · `manual_overrides(entity, fc_id, season, field, value, reason, created_at)` · `ingest_runs`.

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

## Quello che manca per l'asta 26/27 (aggiornato v9.4)
- **Bloccato dal calendario**: listone/quotazioni 26/27 (esce ad agosto → aggiungere `2026-27` a
  **`config.SEASONS`**, che dalla v9.4 è la fonte unica: una modifica, non tre), voti 26/27, Elo alla
  data d'asta 2026-08 (una richiesta: `elo` la scarica da sola appena la stagione esiste in `rosters`).
- ~~`injuries` + `exit_risk`~~ **FATTI in v9.4** · ~~heatmap `avg_x/avg_y`~~ **FATTA in v9.4** ·
  ~~harness del gate~~ **FATTO il 27/07**.
- **Lavoro vero che resta**, e non è più del toolkit: la **modalità LIVE** del motore. Il DB e il
  bundle ora contengono tutto, ma ogni percorso del motore assume un esito — `_window_is_usable`
  pretende ≥50 `fm_act`, il tab Auction elenca solo stagioni concluse, `auction_view` confronta due
  liste. Per un'asta serve **una lista sola**. Più il **gate 3.2** (club-a-club con Elo, input pronto)
  e la **taratura dei parametri provvisori**.

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

Ogni riga porta anche la **squadra** come sigla (`matching.club_abbreviation`): tre giocatori del Napoli
in una top-10 di difensori è informazione, e il nome intero raddoppierebbe la larghezza della colonna.
La sigla è una **funzione pura del nome** — una parola dà le sue prime tre lettere, più parole danno
un'iniziale ciascuna riempita dall'ultima (`Manchester United` → MUN, `Schalke 04` → S04, `Hannover 96`
→ H96) — quindi lo stesso club si legge uguale in ogni vista. I soli casi che l'algoritmo non separa
stanno in `CLUB_ABBREVIATIONS`: cinque coppie di nomi di una parola con lo stesso prefisso
(Mainz/Maiorca, Monaco/Monza, Cardiff/Carpi, Valencia/Valladolid, Wolfsburg/Wolverhampton) più il PSG.
**108 club del perimetro → 108 sigle, zero collisioni**, e un test lo verifica: un club nuovo che
collide fa fallire il test invece di oscurarne un altro in silenzio.

Durante il calcolo c'è uno **spinner** (`ttk.Progressbar` indeterminata): valutare una piattaforma stima
i parametri di ogni finestra, sono decine di secondi, e prima l'unico segno di vita era una riga di testo
— una passata lenta era indistinguibile da una finestra bloccata. Viene impacchettato e disimpacchettato
invece di restare fermo sullo schermo, così una barra immobile non sembra mai una bloccata.

Ogni **intestazione di colonna ha un tooltip** che spiega cosa significa, e sono le colonne che ne hanno
più bisogno: `Qt.I` contro `Qt.A` è tutta la disciplina anti-look-ahead in due lettere, `FVM` è una
colonna di sola rendicontazione che non va confusa con un input, e `FM`/`Pv`/`VALORE` compaiono in
**entrambe** le tabelle con significato diverso (previsto a sinistra, reale a destra) — quindi l'aiuto è
per tabella, non per nome di colonna. Le intestazioni di un `Treeview` non sono widget, quindi
`HeadingTooltip` segue il movimento del puntatore, chiede all'albero quale regione e colonna sono sotto
il cursore e riprogramma il tip quando la colonna cambia. Le tuple di colonne sono costanti accanto ai
dizionari di aiuto e **un test verifica che i due coprano esattamente le stesse colonne**: una colonna
nuova non può entrare senza la sua spiegazione.

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
