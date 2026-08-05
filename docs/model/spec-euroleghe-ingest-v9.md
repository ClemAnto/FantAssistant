# Spec — Toolkit `euroleghe-ingest` v9 (task 1.0 della roadmap)
**Aggiornata: 5 agosto 2026 (v9.28 — la stima messa alla prova: offerta, non classificata; v9 SOSTITUISCE la v8)** · Python · Output: SQLite `euroleghe.db` + CSV normalizzati
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
(classic|mantra) — **da v9.10 li dichiara la LEGA e si sceglie quella** — scrive
`data/reports/auction-snapshot-{stagione}-{piattaforma}-{game}[-{lega}][-{club}]-{data}/` con
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
storia parte dal giorno in cui il job settimanale ha iniziato a girare. ⛔ **Superato: nessun job — si legge il giorno della sessione (05/08/2026).**

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

## Novità v9.28 (5 agosto 2026 — la stima messa alla prova: OFFERTA, non classificata)

Nuovo comando **`estimates`** (read-only, `data/reports/estimates_check.json`) e un verdetto che ha **cambiato
il disegno** fatto un'ora prima. Gate **§7-undecies**. 304 test, `backtest --verify` 22/22.

### 1. La misura
La stessa vista d'asta due volte su ogni finestra usabile — senza stime e con stime — e il SURPLUS catturato dai
dieci nomi contro quello dei dieci migliori realmente. Su Serie A: **peggiora su 10 finestre su 10**, media
**−12.40%**, peggiore **−30.34%** (Tm2), e i nomi in comune scendono con esso (Tm4 17 → 12). Il criterio
pre-registrato («non peggiora sulla maggioranza, nessuna finestra sotto −2%») non è soddisfatto in nessuna delle
due metà. Su **euro 0 stimabili su ogni finestra**, quindi il +0.00% là **non è un PASS**: R0c prezza già tutti.

### 2. Il verdetto applicato
Gli stimati **escono dalla classifica** e vengono **offerti a parte**: nel blocco del ruolo, sotto i dieci
misurati, con la loro tabella («Estimated — offered, not ranked with the ten above»), il `~`, la base e la
penalità. La regola dell'operatore resta soddisfatta dove serve — **ogni riga ha un numero** — e quello che la
misura ha rifiutato non è il numero, è che un numero **ricostruito scalzi** un uomo misurato. I casi lo dicono
uno per uno: Douglas Luiz previsto +28.6 → **−3.2 reale**, Rugani +13.3 → **non ha mai giocato**, contro
McTominay +16.0 → **+50.2**. Media negativa e varianza enorme: il profilo peggiore per le prime dieci.

### 3. ⚠️ La lezione, che ha morso nella stessa ora
La prima implementazione univa gli stimati alle righe **mostrate** e lasciava `captured`/`hits` sulla lista
gatata: lo schermo metteva un uomo stimato al 4° posto mentre le statistiche si comportavano come se non ci
fosse, e la prima corsa della misura stampava **+0.00% su dieci finestre su dieci**. Una lista mostrata le cui
metriche descrivono un'altra lista è **peggio di nessuna metrica**, perché sembra misurata. Ora la lista scelta
è una e ogni numero del blocco viene da lei.

## Novità v9.27 (5 agosto 2026 — la LISTA d'asta ordina anche gli stimati — SUPERATA dalla v9.28, che li ha rimessi a parte dopo la misura)

Completa la regola «ogni calciatore DEVE avere il suo SURPLUS» **dove si decide**: il foglio dava 629 numeri
su 629, ma la lista d'asta ne ordinava **346**, cioè lo stesso buco nel posto che conta di più. 305 test,
`backtest --verify` **22/22**.

### 1. Un solo ranker, con un argomento che il gate non passa mai
`evaluate.auction_view(..., estimates=None)`: quando un chiamante le fornisce, gli uomini che il core non
prezza entrano **nella stessa classifica** sul loro punteggio già penalizzato. Il gate non le passa su nessun
percorso, quindi nessun numero pubblicato si muove (verificato: 22/22, e un test pretende che senza `estimates`
la vista sia identica riga per riga, campo per campo, sui uomini già prezzati). Le stime le costruisce il
**layer del foglio** (`engine/estimate.py` + `snapshot.estimation_layer`), non una seconda cascata: una
seconda copia di quella scala sarebbe una seconda risposta alla stessa domanda.

### 2. Cosa si vede
Ogni riga dice se è una stima (`estimated`, `est_basis`, `est_confidence`, `est_note`), la cella porta **`~`**
davanti al numero e l'intestazione del ruolo dichiara i due insiemi: «top 10 to bid on, of 134 the engine could
price **+ 109 estimated (~)**». La riga di stato conta entrambi: `361 of 849 players priced, 488 ESTIMATED
(marked ~, penalised)`.

### 3. Misurato: chi entra davvero
Su Serie A/classic ordinato per SURPLUS, gli stimati che raggiungono una top ten sono **quattro**, e ognuno
porta la sua base: **Martinez Quarta** #5 fra i difensori (`older`, conf 0.75), **Berisha M.** #4 e **Kostic**
#7 a centrocampo (`shrunk`, 0.93 e 0.87), **Santos A.** #7 in attacco (`shrunk`, 0.97). Gli altri 484 restano
sotto: la penalità li ordina dove la loro incertezza li mette, che è esattamente il suo compito - «se non ci
sono tutti i requisiti, penalizziamo il SURPLUS ... ma dobbiamo cmq avere un valore di riferimento».

## Novità v9.26 (5 agosto 2026 — la fonte «in tempo reale» sulle rose c'era già, e nessuno la leggeva come rosa)

Richiesta dell'operatore: «il listone può non essere aggiornato al minuto, troviamo un ente affidabile e
aggiornato in tempo reale che ci dia certezza sui trasferimenti e sulle rose effettive». 303 test, ruff pulito.

### 1. L'ente esisteva, ed era in cache
`/team/{id}/players` del provider — **una richiesta per club**, che lo snapshot scarica **ogni giorno** per i
ruoli granulari e che è **datata**. Misurato sul caso che ha generato la domanda: il payload del **28/07** per
il Napoli ha **46 giocatori e NON contiene Gutierrez**, mentre `fc_site` lo elencava ancora il **04/08** e la
pagina rosa Transfermarkt il **29/07**. Il provider sapeva della partenza **una settimana prima** di entrambe
le fonti che il foglio stava usando. Ora è una **quarta fonte** di `squad_snapshot` (`source='sofascore'`,
1546 righe alla prima passata), letta dallo **stesso parser** dei ruoli — zero richieste nuove, zero secondo
parser.

### 2. Il suo potere è l'ASSENZA, che nessun'altra nostra fonte sa esprimere
Una pagina rosa dice **chi c'è**, un trasferimento dice **un evento**; solo la lettura di una rosa **intera**
può dire «non c'è più». Quindi il flag ha ora **due segnali indipendenti**, il più forte prima: il trasferimento
che nomina la destinazione, e l'assenza dalla rosa viva. Sul foglio Serie A: **46 dal trasferimento + 47
dall'assenza**, e le righe del foglio passano da 629 a **651**, perché la fonte live porta uomini che le altre
non avevano.

### 3. ⚠️ La guardia, senza la quale il segnale si legge al rovescio
Un uomo **senza identità del provider** manca da ogni payload per costruzione: leggerlo come «andato via»
segnalerebbe metà campionato. Quindi l'assenza è evidenza **solo** per chi il provider sa identificare
(`observed_players`) — è la regola «vuoto = ignoto, mai zero» già pagata due volte. E resta dichiarato il
limite opposto: un acquisto fatto **dopo** la data del payload leggerà come assente finché non lo si rilegge,
ed è per questo che il flag riporta sempre **la data dell'osservazione**.

### 4. Cosa il foglio continua a NON fare
Non sposta il giocatore. Il listone è l'autorità del gioco su chi è in una rosa — è da lì che si compra — e
dove due fonti discordano il foglio **dichiara**: `desc_left_for` / `desc_left_on`, la nota di foglio, e il
marchio **⇥** col tooltip nel pannello.

## Novità v9.25 (5 agosto 2026 — le rose contro i trasferimenti: una PK che non rappresentava due eventi)

Nasce dalla segnalazione «Gutierrez non è più nel Napoli» e finisce su una chiave primaria. 302 test,
`backtest --verify` **22/22**.

### 1. Il caso, e cosa sapeva ciascuna fonte
Il foglio aveva ragione su quello che aveva: il listone 26/27 lo elenca al Napoli e le due fonti di rosa
dicevano Napoli (`fc_site` 04/08, `transfermarkt` 29/07). A sapere era il **trasferimento**: Napoli → Bayer
04 Leverkusen, 01/07/2026, 26M — che però **non era nel DB**, perché `transfers` non era mai stato rilanciato
per l'estate 2026 (v9.23 §2). Rilanciato: **+399** movimenti datati 2026.

### 2. ⚠️ Un OUT non è una partenza, e la prima versione ne ha inventate 82
Leggendo il solo OUT il foglio segnalava **82** partenze, fra cui **Hojlund** («Napoli → Manchester United»)
e **Malen** («Roma → Aston Villa») — l'opposto della realtà. Causa: la pagina di un club porta lo **stesso
uomo due volte** con la stessa data del 1 luglio, il **rientro dal prestito** (OUT verso il proprietario) e
l'**acquisto definitivo** (IN dallo stesso club). Regola corretta: uno è partito solo se la finestra ha un OUT
dal suo club **e nessun arrivo che lo riporta lì** (`left_his_club`). Risultato: **51** righe, Hojlund e Malen
fuori, Gutierrez dentro.

### 3. La causa vera era la PRIMARY KEY, e la migrazione la sistema
`transfers_history` era chiave `(fc_id, date)`, e Transfermarkt data **ogni** movimento estivo `YYYY-07-01`:
le due righe si schiacciavano e sopravviveva quella scritta per ultima (l'OUT, perché la tabella delle
partenze è parsata dopo). Ora la chiave porta anche il **controparte** — `(fc_id, date, from_club, to_club)`
— con una migrazione esplicita (`db.database.widen_transfers_pk`: crea, copia, droppa, rinomina, idempotente).
Effetto sul re-ingest **offline** dalla stessa cache: **2949 → 4383** trasferimenti, **399 → 523** datati 2026.
È la stessa forma del difetto già scritto per `match_ratings`: una chiave che non può rappresentare due eventi
veri ne perde uno in silenzio.

### 4. Come lo si vede, e cosa il foglio NON fa
Colonne `desc_left_for` / `desc_left_on`, una nota di foglio con i nomi, e nel pannello il marchio **⇥** col
tooltip («to Bayer 04 Leverkusen on 2026-07-01. He is still listed here, so treat the row as a question and
not as a squad»). Il foglio **non lo sposta**: il listone è l'autorità del gioco su chi è in una rosa, e dove
due fonti discordano la risposta è dirlo, non indovinare. Corretto anche un artefatto della fonte: il `title`
della pagina per «nessun club» legge `svincolatosvincolato`, e una stringa esattamente raddoppiata ora viene
richiusa a metà.

## Novità v9.24 (5 agosto 2026 — OGNI calciatore ha un SURPLUS, penalizzato e con la nota che dice perché)

Regola dell'operatore: «Ogni calciatore DEVE avere il suo SURPLUS altrimenti è impossibile valutarli
oggettivamente … se mancano dei valori, ricaviamoli/ricostruiamoli approssimativamente (ma razionalmente) …
se non ci sono tutti i requisiti, penalizziamo il SURPLUS (l'indeterminazione è comunque una nota negativa)
ma dobbiamo cmq avere un valore di riferimento (un attaccante titolare della Juve anche se sconosciuto è
sempre meglio di un attaccante sconosciuto del Verona)». 301 test, `backtest --verify` **22/22**.

### 1. Cosa NON è: `engine_*` non si muove di un decimale
Nuovo modulo **`engine/estimate.py`** e una **quarta** classe di colonne, `est_*` — stimate, né gatate
(`engine_*`) né misurate (`desc_*`), e il test che partiziona le colonne ora lo pretende. `engine_surplus`
resta esattamente quello che ha passato il gate, celle vuote comprese, e `backtest --verify` resta 22/22.

### 2. La cascata, e ogni gradino porta la misura che lo ha messo lì
| gradino | su cosa si appoggia | misura (5/08/2026, sul nostro DB) | conf |
|---|---|---|---|
| `core` | la sua stagione qui, ≥15 voti | è il motore, intatto | 1.00 |
| `other_platform` | la **stessa** stagione sull'altra piattaforma | su **870** stagioni-giocatore con ≥15 voti su entrambe: differenza media **+0.001**, sd 0.185, **92%** entro 0.3 (per ruolo entro 0.03). Non è una previsione: è la stessa stagione vista dall'altro calendario | 0.95 |
| `older` | la sua ultima stagione più indietro | usare una fantamedia vecchia come previsione dà MAE **0.396** a t-2 e 0.434 a t-3, contro **0.368** a t-1 (ρ 0.712 / 0.649 / 0.741) | 0.85 / 0.75 |
| `shrunk` | una stagione con 1-14 voti | la sua media **mescolata** con l'àncora del club in proporzione ai voti che ha: è la ricetta dell'operatore («aggiungiamo i voti che mancano come la media del ruolo») scritta come aritmetica | 0.50 + 0.50·w |
| `anchor` | niente di misurato | l'àncora di ruolo spostata verso il livello del **suo club** per quel ruolo: spread misurato fra il migliore e il peggiore club di Serie A 25/26 **1.36** sugli attaccanti (Inter 7.38, Pisa 6.02), 1.10 centrocampisti, 0.75 difensori, **0.25** portieri — cioè il punto Juve-contro-Verona, quantificato, ed è per questo che l'aggiustamento è **per ruolo** | 0.50 |

⚠️ **L'FM-equivalente estero NON è un gradino**, e la ragione è un verdetto: R1 lo ha messo contro l'àncora di
ruolo su sei finestre e ha perso su cinque (§7-octies). La scala è ordinata da quello che i numeri dicono, non
da quello che *sembra* più informativo.

### 3. La penalizzazione, e la nota che la dichiara
`est_surplus` = **la stessa aritmetica** di `engine_surplus` × la confidenza, quindi una riga `core` esce
esattamente al suo surplus gatato (verificato: 0 righe discordanti) e una stimata è confrontabile con essa —
la prima versione pesava anche la beccabilità e Hojlund passava da 28.4 a 24.6 senza che nulla di lui fosse
cambiato. Per riga: `est_basis`, `est_confidence`, `est_note` («solo 13 voti qui, quindi la sua media è
mescolata col livello degli A della Juventus (6.76)»), e nel pannello la cella porta **`~`** con il tooltip
che dice base, nota e penalità — «se il surplus è penalizzato aggiungere una nota a riguardo».

### 4. Un numero inventato trovato dalla prova, e sostituito con una misura
La prima versione dava a un uomo senza nulla di misurato **mezzo calendario** di presenze, e così un portiere
**ignoto** (est 9.3) valeva più del terzo portiere del suo club che aveva giocato una volta (4.4) — l'opposto
di quello che il foglio deve dire. Misurato su tre finestre: chi non ha stagione precedente su quella
piattaforma gioca una quota mediana di **0.289** (default, n=719) e 0.194 (euro, n=1174); chi ha una stagione
sottile **0.421** / 0.290. Il sottile gioca **più** dell'ignoto, e ora l'ordine viene dai dati (Rossi F. 5.4,
Sportiello 4.4, Carnesecchi 35.1).

### 5. Effetto sul foglio Serie A
Le righe con un surplus passano da **346 su 629** a **629 su 629**: 346 gatate + **283 stimate** (146
`shrunk` · 100 `anchor` · 28 `older` · 9 `other_platform`), confidenza fino a 0.48. Sul foglio **euro** tutte
924 righe sono `core`, perché là R0c è adottata e il motore prezza già tutti — la cascata non serve e non
tocca niente.

## Novità v9.23 (5 agosto 2026 — tre richieste dell'operatore sul foglio: il nome, l'età dell'evidenza, e il perché di una cella vuota)

Tutte e tre nate da segnalazioni, e la seconda ha trovato un buco vero. 299 test, ruff pulito.

### 1. Il nome del foglio dice PIATTAFORMA e GAME
«Nel nome dello snapshot selezionabile deve essere indicata anche se euro o default, mantra o classic». Una
lega dichiarata **fissa** entrambe, quindi il selettore League non ne mostrava nessuna: `29/07 · 2026-27 ·
euro/classic  (latest)`. Il combobox passa da 44 a **58** caratteri perché Tk **taglia** quello che non entra,
e un nome di foglio troncato è lo stesso difetto «non stretta, assente» già pagato dalla tabella rosa.

### 2. `evidence_age`: un foglio dice quanto è vecchia la sua evidenza su rose e trasferimenti
«Quando esegui uno snapshot verifica bene le rose delle squadre ed i trasferimenti: Gutierrez ad esempio non è
più nel Napoli». Misurato: il foglio aveva ragione su quello che **aveva** — entrambe le fonti di rosa dicevano
Napoli (`fc_site` osservata il 04/08, `transfermarkt` il **29/07**) — e nessuno diceva che quell'evidenza era
di giorni prima. ⚠️ E c'era di peggio, trovato guardando: **`transfers_history` non conteneva un solo movimento
datato 2026** (il più recente è del **2025-07-01**), cioè l'intero mercato estivo che ha costruito queste rose
non era nel DB, e con esso l'origine e la cifra di ogni arrivo. Ora ogni foglio riporta, nel manifest
(`evidence_age`) e nelle note: la data dell'ultima osservazione **per fonte** (una fresca non dice niente sulle
altre) e se il layer trasferimenti ha **almeno un movimento** nella finestra che ha costruito quelle rose.

### 3. `engine_unpriced_reason`: una cella vuota dice QUALE affermazione è
«Vedo molti giocatori senza il Surplus valorizzato (es: Boga, Kolo Muani) … oppure Stones, Pavard». La nota di
foglio esisteva e poteva dire **una** cosa sola, mentre la cella ne nascondeva due, che sono fatti diversi:
- **«only N votes of 15»** — misurato qui e troppo poco: Boga **13**, Dovbyk 12, Pavard **1**. Sotto
  `MIN_PV_PREV` il core rifiuta di prevedere, ed è il suo dominio, non un capriccio;
- **«no season on this platform»** — il suo calcio è stato giocato sull'altro calendario o fuori perimetro:
  Kolo Muani ha **23 voti euro** e nessuna stagione di Serie A (era al Tottenham), Stones **3**. Convertirlo in
  una previsione è **R1**, che il gate ha respinto due volte (§7-octies).
Misurato sul foglio Serie A: **283 righe su 629** senza valutazione = **157 + 126**, e la nota le riporta
divise. Su `euro` non si vede perché **R0c è adottata** e li prezza all'àncora di ruolo (Boga: fm 7.284 =
l'àncora, dichiarata come tale); su `default` R0c non è adottata, quindi non c'è niente su cui ripiegare.
Il tooltip della colonna porta gli stessi due casi con i nomi.

## Novità v9.22 (5 agosto 2026 — un posto in attacco è il lavoro di un attaccante, alla SELEZIONE)

Chiude l'ultimo caso della famiglia «attacchi senza un attaccante». 299 test, ruff pulito.

### 1. La misura prima della regola, e ha ridefinito il numero
La verifica delle sessioni precedenti contava «4 board su 394». Rimisurando sui fogli più recenti è venuto
fuori che la conta mescolava due cose diverse: in modalità **`next`**, dove le fonti dichiarano almeno 11
titolari, il board **È l'undici dichiarato** (`_declared`) e chi occupa un posto non è una scelta del modello.
Separati: **516 board che il modello seleziona** + **150 che la fonte dichiara**. Sui primi gli invarianti
erano **6 attacchi senza attaccante** — tutti il **Lilla**, lo stesso uomo — e **1 centrale su una fascia**
(Manchester United, fascia della **trequarti**: `_flanked` copre M e A, non T — resta aperto e scritto).
⚠️ Da tenere: contare un board dichiarato dalle fonti come se fosse un disegno del modello attribuisce al
modello scelte degli editor (Atalanta `next`: portiere Sportiello 0.03 con Carnesecchi 0.82 fuori — è la
probabile, non il modulo).

### 2. `_fronted`: la regola 4a un passo prima
`_reshape` la dice su una linea già disegnata e `_off_the_front` la prezza dove si prezza un posto; nessuna
delle due può fare niente se la **selezione** non ha mai offerto un attaccante alla linea — i trequartisti
concorrono per la linea d'attacco (`line_key`), quindi con un solo posto davanti un trequartista batte una
punta sul claim e poi la guardia «mai l'ultimo uomo dell'attacco» lo tiene là, giustamente. Ora il **mestiere**
decide chi è eleggibile e il claim decide fra loro, con il tetto degli altri due override
(`FLANK_OVERRIDE_GAP` 0.40) e la definizione **unica** di «non è il suo lavoro» (`_off_the_front`, che copre
anche chi non ha codici osservati). Dove la rosa non ha attaccanti non succede niente — «una squadra i cui
unici attaccanti sono trequartisti va disegnata con loro» (Roma: Malen legge `RW;ST` e il posto è suo).

### 3. Misurato dopo: **6 → 0**, e cosa è costato
Ogni board disegnato **due volte**, con la regola accesa e spenta: **67 board su 666 cambiati**, costo medio
in claim **−0.108**, peggiore **−0.480** (due scambi al tetto). I casi: Lilla `4-5-1` Haraldsson (`AM` 0.83)
→ **Fernandez-Pardo** (`ST` 0.83, pari claim); Atalanta `3-4-3` Pasalic (`MC;DM;AM` 0.56) → **Scamacca**
(`ST` 0.47); Lazio `3-3-4` Dele-Bashiru → **Cancellieri** (`RW` 0.62). Nessun uomo NON-attaccante entra in
una linea d'attacco (il pool lo esclude per costruzione), 0 righe oltre il massimo, e **le 298 asserzioni dei
board già giudicati dall'operatore** (Napoli, Atalanta, Roma, Fiorentina, Liverpool, Bologna) restano verdi:
è quella la guardia vera.

## Novità v9.21 (5 agosto 2026 — il portiere ha un FM-equivalente, e serviva un numero solo)

Gate **§7-decies**. Toolkit **0.9.0**, **298 test**, ruff pulito, `backtest --verify` **22/22**.

### 1. Due colonne che erano già in cache: `external_stats.goals_conceded` e `.saves`
Chieste al provider dal primo giorno (`positions.STAT_FIELDS`) e **buttate al parse**, perché la tabella non
le aveva. Migrazione in `db.database.ADDED_COLUMNS` + parse in `_store_claims`, re-ingest **offline**
(`positions.reingest_from_cache`, zero richieste): **11.725 righe su 11.732** hanno i gol presi, ~100-110
portieri per stagione sulle 5 leghe. Nota che vale per chi le leggerà: `goalsConceded` è popolato **anche per i
movimenti** (sono i gol presi dalla squadra mentre era in campo) — è solo il fantavoto del PORTIERE che li
legge come malus.

### 2. Il fantavoto di un portiere è un'identità, e il bonus imbattibilità non esiste
Misurato su **16.017** righe di `match_ratings` con entrambi i voti, su entrambe le piattaforme:
`fantavoto = mv − gol_presi + 3·rigori_parati − 0.5·gialli − rossi − 2·autogol + 3·gol + assist`, residuo
**0.000 nel 100% dei casi**, e residuo 0.000 anche sulle **4.872** partite chiuse a zero. `scoring_config`
dichiara `clean_sheet_bonus_gk: 1.0` che la fonte **non applica**: `ratings._fantavoto` lo escludeva già con
la sua nota di riconciliazione, e ora il commento del config porta la misura, perché un termine dichiarato e
non applicato è una trappola per il prossimo lettore.

### 3. `arrivals.keeper_fm_equivalent`
    fm = media(voto base sulle partite di CAMPIONATO) − malus × gol_presi/presenze − cartellini/presenze
Il voto base è lo stesso degli altri (Mv euro reale dove il calendario copriva la giornata, altrimenti il
`mv_synth` calibrato), e i gol presi vengono dall'aggregato **della stessa competizione** che dà le presenze —
una coppa non entra né al numeratore né al denominatore. Un portiere con due aggregati in una stagione (mercato
di gennaio fra due delle cinque leghe) tiene quello in cui ha giocato più partite: mediare due spell non
descriverebbe nessuno dei due. Il conteggio partite viaggia con l'equivalente, quindi il tier resta libero di
non trattare una finestra come una stagione.
**Verdetto (§7-decies): PASSA** su 201 portieri-stagione (euro) e 51 (default) — bias −0.00…−0.18, MAE
0.084-0.191 contro 0.214-0.336 dell'àncora, **89-100% entro 0.3** contro lo **0%** della formula dei
movimenti. Copertura nuova: **1 / 15 / 19 / 8** arrivi per stagione, totale con equivalente **2045 → 2128**.
⚠️ **Daffara resta NULL**: la Serie B non ha aggregato di stagione, e per partita lo score non c'è più (le
cache di giornata e di giocatore sono distillate). Il follow-up è **conservare lo score quando lo si riceve**,
e non è retroattivo.

### 4. La catena, di nuovo, e stavolta l'ha detta un numero
Rifare `positions --layer reparse` **azzera `mv_synth`** (vive in `external_match_stats`), quindi gli arrivi
con equivalente sono crollati a **716** finché `synth` non è stato rilanciato — poi 2128. È la stessa catena
di §7-octies (`positions` → `synth` → `arrivals`), e ora si è manifestata come regressione visibile invece che
come strato invecchiato in silenzio.

## Novità v9.20 (5 agosto 2026 — la LISTA con cui si va all'asta: una sola, e senza l'altro lato)

La voce che il documento chiamava «modalità LIVE del motore» da tre sessioni, e che era la più importante:
**per un'asta serve una lista sola**. Toolkit **0.8.0 → 0.9.0**, **297 test verdi**, ruff pulito.
**Nessun numero del motore cambia**: è lo stesso prezzatore, con gli stessi parametri fittati su un'altra
finestra — quello che mancava era che si potesse *chiedere* la stagione che si sta comprando.

### 1. Il blocco non era il modello, era il CALENDARIO — e stava nel chiamante
`features.prepare` legge `matchdays_target` dai voti della stagione bersaglio, e per una stagione mai
giocata sono **zero**. Le presenze sono previste come **quota** del calendario, quindi un calendario di zero
prezza tutti a **zero presenze** → VALORE e SURPLUS zero → la lista è ordinata da niente (misurato prima
della correzione: Svilar `pv 0.0`, tutti i surplus a 0.0, ordine per `fc_id`). Il ripiego «il calendario è
quello dell'anno scorso» **esisteva**, ma viveva in `snapshot.build`, cioè in **un chiamante**: il secondo
chiamante — il tab Auction — si prendeva un listone intero a zero. Ora sta in
`snapshot.engine_predictions`, **dove si decide il prezzo**, e la sua nota arriva con quelle del motore.
Stessa forma di difetto già pagata tre volte in questo progetto: la correzione va dove la decisione è presa.

### 2. La lista LIVE nel tab Auction
Prima voce del selettore Season, **`2026-27 · LIVE`** (mai una stagione nuda: accanto alle concluse
leggerebbe come una di loro). Prezzata da **`snapshot.engine_predictions`**, la stessa funzione del foglio,
con i **fit iniettati** (`fits=`) perché il pannello ha già preparato le undici finestre e prepararle due
volte sarebbe un minuto per niente — ma la **scelta** di quale fit prezza un bersaglio live resta dentro
`engine_predictions`, in un posto solo. `squad_source='real'`, perché ad agosto il listone è **parziale**
(494 di ~1450 il 5/08) e una lista dei soli quotati non è la lista del tavolo.
Cosa NON dice, e non per omissione: **nessun conteggio di nomi in comune e nessuna quota del top-10
perfetto**, perché nessuno ha ancora giocato e i due sarebbero zeri travestiti da punteggio. Cosa dice:
`357 of 806 players priced`, le **note del motore a schermo** (il calendario preso in prestito, i 312 senza
Qt.I prezzati all'àncora, l'eventuale DRY RUN) e per ruolo la **profondità** («top 10 to bid on, of 132 the
engine could price») con il livello di rimpiazzo. Le colonne dell'esito sono **assenti**, non vuote — una
cella vuota si legge come uno zero, ed è la stessa regola del surplus vuoto.
Misurato su Serie A/classic ordinato per SURPLUS: **P** Svilar 32 · Carnesecchi 32 · Maignan 31; **D**
Dimarco 27 · Pavlovic 14; **C** Paz N. 21 · Calhanoglu 17; **A** Malen 45 · Martinez L. 34 · Thuram 27.
Profondità prezzabile: 26 · 132 · 135 · 64.

### 3. Tre misure di layout, e due direzioni scartate
Una tabella sola in un box a piena larghezza ha ~800 px in più, e ogni modo di darli è stato **misurato**:
entrambe le colonne elastiche lascia a `Player` **300 px vuoti** accanto a nomi di nove lettere; **nessuna**
elastica **taglia** il testo di `Pair` a 170 px (spariva il ΔQt.I) — cioè «non era stretta, era assente», il
difetto già pagato dalla tabella rosa; `Pair` da sola prende 913 px ed è la giusta, **una volta** che
l'intestazione è allineata alle sue celle (prima, centrata, titolava mezzo schermo lontano dai valori).
Le tre misure sono nel test, non nel ricordo.

### 4. Difetto nei TEST trovato da un crash, e vale la pena saperlo
`Config(data_dir=tmp_path)` **non sposta `db_path`**: sono due campi indipendenti, ognuno col suo default
(`EUROLEGHE_DB_PATH` o `repo/data/euroleghe.db`). Quindi il test di geometria costruiva `ToolkitGUI` sul
**DB reale da 313 MB** e, poiché il tab Auction ricarica in un **thread**, quel thread sopravviveva al test e
moriva nel garbage collector (`Windows fatal exception 0x80000003`). Non si vedeva prima perché il thread
faceva meno lavoro. Quattro punti reindirizzati: un test di geometria non legge un database.

## Novità v9.19 (5 agosto 2026, notte-mattina — il listone di AGOSTO, il buco che si vede, e le competizioni non calibrate)

Commit `5123413` · `fc6bbd4` · `709bde7` · `69f644d` · `1538dc1` · `fe26c39` · `62040e9` · `1cf75f8` ·
`62dbaf2` · `38e5210`. Toolkit **0.7.0 → 0.8.0**, **295 test** (294 verdi + 1 skip: quello che chiede un display), ruff pulito.
**Nessuna regola nuova nel motore**: due sweep e una calibrazione misurate e non adottate (gate §7-septies,
§7-octies, §7-nonies), il resto è dati, tabellone e strumenti.

### 1. Il listone 26/27 entra, e il blocco era l'ID CAMPIONATO
Serie A 2026-27 dentro: **494 giocatori, 20 club**, Qt.A/Qt.I/FVM e ruoli Mantra, **154 arrivi**
riclassificati nei tier. Il blocco non era il file ma il suo id: l'id campionato si leggeva **solo** dalla
pagina dei voti, che per una stagione senza giornate non ne ha nessuno — cioè **ogni agosto**. Ora c'è il
fallback sulla pagina delle **quotazioni** (Serie A 2026-27 = **21**, 2025-26 era 20).
⚠️ **Con una guardia, perché quelle pagine servono «la lista corrente» qualunque stagione chiedi**: la pagina
euro risponde ancora **108 = 2025-26**. La guardia è il workbook stesso, che dichiara la sua stagione nella
prima cella, e uno che non dichiara la stagione richiesta viene **RIFIUTATO** invece di finire archiviato
sotto l'anno sbagliato (verificato: `ratings --platform euro --season 2026-27` non trova nulla, ed è giusto).
`config.SEASONS` accoglie `"2026-27"` — che il commento del file dichiarava essere l'unica modifica
necessaria, ed era vero.

### 2. Il tabellone: un 4-5-1 con TRE uomini d'attacco è un 4-2-3-1
Sette segnalazioni dell'operatore, e sotto ce n'era **una sola**: la fonte pubblica **tre linee** per undici,
quindi `4-5-1` è la stringa più comune del repertorio (**1746 su 4812**) e ogni squadra con due mediani dietro
tre trequartisti arriva così. I dodici codici sanno distinguerli (`_two_rows`): se la **MAGGIORANZA** della
riga schierata gioca più avanti, è un due più un tre. **Maggioranza e non «almeno uno»**, perché due esterni
che arretrano sono la regola 3 di `_reshape` e devono restare: Napoli, Bologna, Chelsea e Liverpool
intoccati; si muovono Bayern, Barcellona, Betis e Manchester United.
E **un POSTO è un MESTIERE, in entrambi i versi**: le fasce di un tridente e di una riga di centrocampo vanno
a chi le gioca anche **sotto il claim** (`_flanked`, tetto `FLANK_OVERRIDE_GAP` **0.40** di stagione), il
centro della linea d'attacco vuole un uomo che possa giocarci (`_pointed`, e di nuovo sull'undici **settled**,
perché `_settle` lo disfaceva), un esterno **non tiene un posto centrale** (regola 6) e sulla trequarti ci va
solo se c'è posto per due. Una fascia la prende chi ce l'ha nel **primo** codice: la profondità non distingue
un centrale da un terzino (entrambi 0.25). Il mediano sta al centro della riga. E la **targhetta legge il
posto** dove il posto decide (D/M/T), mai la linea: un mediano schierato centrale in difesa resta `C`.
**Difetto vero trovato per strada**: il termine di `_assign` che doveva far cadere il compromesso sul più
**debole** lo faceva cadere sul **migliore** (rank 0 è il primo) — il caso Liverpool passava per un altro
motivo.
⚠️ **Revocato e scritto**: far pagare al MODULO i posti che la rosa non copre. A 2 giornate per posto muove
13-19 board su 108, mette il Como su un «3-3-1-3» e **disfa Barcellona e Napoli per aggiustare il Marsiglia**.
Quando un numero aggiusta un club e ne rompe un altro il modello è sbagliato — terza volta, stessa risposta.
**Misura**: 108 board (54 club × 2 modalità), **17 disegni cambiati**, e gli invarianti passano da 4 tridenti
con due `Sp` + 7 codici di fascia su posti centrali + 4 righe con tre codici di fascia a **ZERO**.

### 3. Un buco che il toolkit può ancora chiudere si VEDE, e si vede riempirsi
Richiesta dell'operatore. Una cella vuota non lo può dire: sotto `MIN_PV_PREV` il core rifiuta di prevedere,
quindi il surplus di chi non ha niente di misurato è vuoto — e vuoto è anche come si vede uno zero. Perciò
quell'uomo porta un **marchio**, sulla stessa lista di stati per-giocatore dove vivono già infortunio,
ballottaggio e arrivo: **⧖** «niente misurato, il toolkit lo può ancora prendere» → **⟳** «lo sta prendendo
adesso» → **→** «prezzato da una finestra misurata altrove, non da una stagione qui», col tooltip che dice su
cosa sta («10 partite, 693 minuti in bundesliga»).
**La regola dietro il marchio è quella del modulo che va a prenderli** (`recent_form.awaiting_data`: prezzato
**sopra la mediana del suo ruolo** e niente di misurato): **una definizione sola, letta da due lati** — il
modulo scegli chi scaricare sul DB, il pannello segna chi si sta aspettando sul foglio. Due copie sarebbero
due popolazioni e il marchio smetterebbe di significare «questo è ciò che sto scaricando». Si **autocancella**:
le righe che lo scraping riempie non qualificano più al build successivo, e «misurato» per il pannello include
la finestra recuperata **altrove** (senza quello il tabellone avrebbe chiesto una corsa già fatta).
**Barra determinata da qualunque modulo**: `Context.progress` stampa la stessa forma che il pannello già
parsa (`[modulo] NN% · etichetta`), `recent_form`/`positions`/`injuries` la riportano sui loro totali
**contati**, e **totale zero non stampa niente** — di nessun lavoro non esiste una frazione onesta.
**Misurato sul foglio vero**: **6 righe su 629** portano il marchio (Alajbegovic, Oulai, Koulierakis, Kaiki,
Viery, Daffara), e la corsa che le chiude ha risolto **11/11** identità a livello 1 con **110 partite** salvate.

### 4. Il giovane senza storico ha una valutazione e CONCORRE (gate §7-octies)
Tre difetti di manutenzione, trovati **prima** di misurare:
- **la conversione seguiva il TAG e non la calibrazione**: `synth` fitta la retta sull'overlap (le cinque leghe
  che il calendario euro copre) e la applicava a ogni riga `source='sofascore'`, quindi **3756 righe di Serie
  B**, 570 di Championship e 458 di Coppa Italia ricevevano un voto sintetico da una retta che non le ha mai
  viste, mentre le 10 partite di **Bundesliga** recuperate da `recent_form` ne restavano fuori per il tag. Ora
  l'idoneità è della **COMPETIZIONE** (`synth.calibrated_competitions`, letta dai dati e non elencata a mano):
  **241.913 partite convertite su 250.678**, le altre NULL come il docstring diceva da sempre;
- **`mv_synth` era fermo**: nessuno rilanciava `synth` dopo `positions`, quindi l'FM-equivalente degli arrivi
  girava su un input pieno per un terzo — **707 arrivi** con equivalente prima, **2045** dopo (T1 da 72 a 271);
- **la catena è chiusa**: `recent_form` → `synth` → `arrivals`, e `ratings` → `arrivals` (un listone nuovo è un
  perimetro nuovo, quindi cambia chi è un arrivo).
Sul tabellone: `presence.window_standing` — il claim leggeva una **stagione** e per lui trovava **zero** (non
basso: assente) mentre il motore gli prevedeva 20 presenze. Ora la finestra ha il suo **denominatore** (693
minuti su 10 partite = 77% del calcio disponibile) per lo sconto d'arrivo 0.80 → **0.616**, e concorre.
**Spento nel motore** (`window_standing = 0.0` nei `DEFAULTS`), **acceso nel pannello** (`SnapshotView.PRESENCE`
a 1.0) e pre-registrato in §7-octies. Colonne nuove nel foglio: `desc_elsewhere_matches` /
`desc_elsewhere_minutes` / `desc_elsewhere_where`.
Due difetti veri li ha trovati il criterio di accettazione: lo sconto d'arrivo **non si applicava**
(`at_club_weight` legge uno split di minuti che lui non ha) e la Juve disegnava **due `As`** (ora un solo uomo
per fascia: chi ce l'ha dalla forma la tiene, l'altro legge il mestiere centrale).

### 5. Le competizioni NON calibrate: lo scostamento è misurato e non applicato (gate §7-nonies)
Il caso di Daffara — dieci partite di Serie B con rating 7.05 che non diventano un voto, perché la
sovrapposizione (rating del provider + voto reale) per la Serie B è **zero righe**. Un parametro nuovo solo,
lo **scostamento per competizione** (`synth`, `MIN_MEN_PER_OFFSET` = 10), con la retta delle cinque leghe
tenuta fissa; misurato leave-one-out sugli uomini contro **due** nulli (retta nuda e àncora di ruolo) e
riportato in `data/reports/mv_synth_calibration.json` → `offsets_measured`.
**`APPLY_OFFSETS = False`**: la Serie B ha δ **−0.181** e la correzione **non è rumore** (LOO 0.1631 contro
0.2039 della retta nuda, −20%: la prima volta che «un 7.0 in Serie B non è un 7.0 in Serie A» è un numero), ma
perde contro l'**àncora di ruolo** (0.1786 e sulla maggioranza degli uomini). La Champions (98 uomini, δ
+0.123) **passa il criterio pre-registrato** e ha una MAE media **peggiore** dell'àncora: accenderla è una
decisione dell'operatore, e la seconda ragione sul tavolo è che convertire le coppe farebbe entrare partite di
coppa nell'FM-equivalente. **Bug trovato dal test**: un offset non stimabile (δ `None`) mandava in **errore**
la conversione invece di rifiutarla.

### 6. L'investimento condizionale: robust PASS su Serie A e non adottato (gate §7-septies)
`presence.investment_shape = "unplayed"` — il lift che chiude parte del divario fra quanto un uomo ha giocato e
una stagione piena, nullo per costruzione su un titolare. Due bracci **mai sommati**: il **cartellino** è morto
su entrambe le piattaforme (i fold senza il dato marcati `folds_without_the_feature` nel report), il
**valore/rosa** passa **robust su Serie A** (+0.79% medio, 5 fold su 6, peggiore −0.09%) e sta sotto il
pavimento su euro (+0.38%). Il pezzo che conta è il **NULL** (`shrink_weight`, la stessa forma senza
investimento dentro): su Serie A il valore lo batte di **+0.42 punti**, su euro i due sono identici — quel poco
che c'è è **ritorno alla media**. **`value_weight` resta 0.0** perché ogni fold scegli il **bordo** della
griglia (0.5 su 0.5): un termine il cui optimum sta fuori dalla griglia misurata non si adotta al valore del
bordo, e la griglia non si allarga dopo aver visto la curva.

## Novità v9.18 (4 agosto 2026, pomeriggio — due tabelle nuove, e la quotazione scende all'ultimo posto)

Seguito della v9.17 nello stesso giorno, ma su un altro strato: **dati e gate**, non disegno. Commit
`4d979c3` · `c9b7b47` · `78be957` · `8d13b18` · `6682c3d` · `d163184`. Toolkit **0.7.0**, 285 test verdi,
`backtest --verify` **22/22**.

### 1. Tabelle nuove: `market_values` e `fvm_history`
- **`market_values(fc_id, season, source, value)`** — il valore di mercato **per stagione**, dalla pagina rosa
  di Transfermarkt che già scarichiamo (`injuries.parse_squad`, una colonna in più letta per nome
  dall'intestazione): **zero richieste nuove**. È **storico** — la pagina di una stagione passata porta il
  valore di quella stagione, verificato su undici stagioni di un club (225 / 175 / 150 / 100 / 200 mila per lo
  stesso uomo) — quindi una finestra legge la stagione di **input** per prevedere la **bersaglio**. Ingerito
  offline: **9388 valori · 3180 giocatori · 11 stagioni**, 75-80% dei listoni recenti. Nel contratto d'export.
- **`fvm_history(fc_id, season, observed_on, fvm, fvm_mantra)`** — il fantavalore come la **serie datata** che
  è: «varia ogni settimana o quando ci sono eventi particolari, infortuni e trasferimenti» (l'operatore). Era
  in `rosters.fvm`, **sovrascritto a ogni scarico del listone**, cioè uno stato volatile tenuto come campo
  statico — contro la regola del progetto. `rosters.fvm` resta l'ultimo valore (lo legge il foglio); la serie
  **accumula da oggi** e non è ricostruibile, perché la fonte serve un valore archiviato per stagione e non le
  sue settimane. ⚠️ Prima del **2022-23** l'FVM è **0 e non NULL**: `count(fvm)` leggeva copertura piena su
  valori assenti, e uno zero non è un fantavalore.

### 2. Colonne nuove nel foglio
`coach_shapes` / `coach_shapes_of` (le forme di **quell'allenatore**, ogni sua panchina, `coaches` ×
`club_match_lineups`) · `desc_preseason_starts` / `desc_preseason_matches` (le amichevoli della stagione
bersaglio iniziate sotto l'allenatore di adesso) · `desc_market_value` /
`desc_investment_value_share`.

### 3. Tre verdetti, e nessuno cambia il motore
- **la forma dell'allenatore nuovo ENTRA** (`shape_odds`, al posto della lega, pesata da soglia e rampa sul
  proprio campione): 12 club su 34 disegnavano il modulo del predecessore. Giudizio sulla previsione 26/27:
  **8/17 → 9/17** — Atalanta al **4-3-3 di Sarri**, difesa a quattro, 9 uomini su 11 come la fonte.
  Dettaglio: v9.17 §6.
- **la PRE-SEASON resta una LETTURA** (targhetta, mai un criterio): sembra decisiva — le due amichevoli di
  Sarri le iniziano Gaetano, Samardzic, Scamacca e Raspadori, e De Roon/Ederson/Krstovic nessuna — ed è
  inutilizzabile per cinque ragioni misurate (una sola pre-season di dati, 1-3 partite, due club su sette a
  zero, minuti assenti in 1399 righe su 1716, avversari l'U23 del club stesso). Pre-registrata per giugno
  2027: gate §7.
- **il VALORE DI MERCATO non entra** (gate **§7-quinquies**): su euro il migliore in pool è zero, su Serie A
  tutti e sei i fold scelgono 0.10-0.20 ma il guadagno medio è **+0.08%** contro un pavimento di 0.5%. Il
  proxy migliore ha comprato **il verso e non la taglia** — il cartellino non aveva nemmeno il verso — e
  conferma che il meccanismo è già assorbito dai **minuti**.

### 4. La QUOTAZIONE scende all'ultimo posto (gate §7-sexies)
Decisione dell'operatore: «utilizziamo la quotazione quando non abbiamo altre risorse oggettive». Verificato
che il **motore adottato non la leggeva già** (R12/R12b/R17 falsificate e fuori dai set, il livello di
rimpiazzo dalla fantamedia del rostered marginale, `stature` a zero, `arrival_tier` letto solo dalla GUI).
L'unico punto vivo — quale percentile instrada un arrivo — ora ha **tre livelli**: calcio giocato
(FM-equivalente nella lega di provenienza, percentile nel ruolo) → **fantavalore** (il giudizio più fresco) →
quotazione. Su euro `measured_first` vince **7 fold su 7** (CONFIRMED, margine **+0.89%**); su Serie A la
quotazione guadagnerebbe +0.42%, **sotto il pavimento**, e la causa è la **copertura** del misurato (25-29%
euro contro 14-20% Serie A).
**Difetto dell'harness trovato dal numero**: lo sweep giudicava i tier su **tutti** gli arrivi, e questo dava
alla quotazione un `robust PASS` falso su `default`; un tier instrada solo chi il **core non può prezzare**.
Corretto (2573 euro / 2180 default invece di 2963 / 2842). Lezione in CLAUDE.md: **un parametro va giudicato
sulla popolazione su cui agisce**.

### 5. L'harness riproduce 22 numeri su 22 (era 15/18)
I tre che mancavano erano tutti del modulo presenze su T1, e la causa era la **data**:
`presenze-attese-v1.md` è del 22 luglio e `platform` è entrata il 25-26, quindi erano misurati su un dataset
che mescolava i calendari. La conclusione era anche data al **singolare** su una quantità dipendente dalla
piattaforma. I check sul Pv sono ora **controlli di regressione** e non test sul segno, con `REFERENCE_GATE`
che porta la misura di oggi **con la sua piattaforma** e i numeri di luglio come superati; **aggiunto** il MAE
del segmento **titolari**, che il documento citava e nessuno verificava. Blocco «RIMISURATO» in
`presenze-attese-v1.md`.

## Novità v9.17 (4 agosto 2026 — un modulo disegnato è un modulo VERO: cinque regole, e la heatmap al suo posto)

Sessione interamente sul pannello Snapshot, guidata da sei osservazioni dell'utente sui board di Napoli,
Atalanta, Liverpool, Fiorentina e Roma. **Nessun numero del motore cambia**: cambiano quale maglia veste
ciascuno degli undici, come la linea è disegnata e cosa dice la targhetta. Commit `1108803` e `51d069e`.

### 1. Il difetto comune: un secondo parere non prezzato che disfaceva una decisione prezzata
L'undici viene **assegnato** ai posti del modulo e ogni posto è **prezzato** (`_assign` + `_slot_price`, una
sola assegnazione risolta come un tutto). Poi `lanes_for` **rileggeva la corsia dal primo codice di ciascuno**
e buttava via la decisione. Sul 4-5-1 del Liverpool, misurato: il fit aveva dato a Gakpo (`LW`) la **fascia
sinistra dei cinque** e a Gravenberch (`MC;DM`) il **secondo centrale della difesa a quattro** — un mediano
che scala costa 4, un terzino destro che cambia fascia 8 — e la rilettura spediva il primo in attacco e il
secondo a centrocampo. Risultato disegnato: **difesa a tre**, cinque schiacciati nella metà destra con la
fascia sinistra **vuota**, e un attacco di due mancini. «Il modulo non può perdere la simmetria».
Ora quella rilettura fa **solo la mossa per cui esiste**: un centrocampista **centrale** una riga avanti,
sulla trequarti (il 4-5-1 che in realtà è un 4-4-1-1). Ogni altra direzione svuota un posto che il modulo ha
assegnato, e tutte e tre le direzioni sbagliate sono state misurate: attraverso le **linee** (Liverpool),
fuori da una **fascia** (Bayer Leverkusen: Tella teneva la destra dei quattro e ha primo codice `AM`, usciva
un 3-3-3-1 con i quattro senza fascia destra), e **indietro** sulla riga (Verona 3-5-1-1: il modulo *nomina*
un trequartista, il fit vi metteva un `MC`, la rilettura lo riportava in linea → sei in fila **e** trequarti
vuota).

### 2. `_reshape`: la trasformazione, cinque regole nell'ordine in cui le verifica un allenatore
Ognuna con le parole dell'utente come definizione:
1. **nessuno gioca a due linee da casa** (`LINE_REACH`);
2. **una fascia la copre un esterno**: il centrale la lascia e si disloca nella riga centrale che il suo
   codice **più avanzato** indica («4 centrocampisti centrali non esistono... ai lati devono esserci due
   esterni, mai centrali»). La **difesa è esente**: i braccetti;
3. **una fascia di centrocampo svuotata la copre l'attaccante esterno che arretra** («i due attaccanti
   esterni possono arretrare e coprire il centrocampo») — era la metà mancante della frase, e senza di essa
   la riga perdeva semplicemente la fascia;
4. **la linea d'attacco è per gli attaccanti** (4a) e, una volta assottigliata, **tiene le punte centrali**
   (4b). 4a: chi ha come primo codice un posto che non è d'attacco è un trequartista che può anche salire —
   Roma («Malen ha giocato solo come Pc, dovrebbero giocare Dybala e Soulé come trequartisti»): il 3-4-3 esce
   **3-4-2-1** con la punta sola, che è la forma che le sue stesse probabili dichiarano. 4b: «3-4-3 non può
   diventare 3-4-1-2», «Sp + Pc non può avere un esterno d'attacco»;
5. **la riga di centrocampo è cinque al massimo** («una linea di centrocampo a 5 è già il massimo»): gli
   eccedenti **centrali** si dislocano sulla trequarti, i più avanzati per primi. Il tetto è l'**ultimo**
   passo, perché la regola 4 può consegnare alla riga un uomo (Genoa usciva 3-6-1 così).

### 3. Il vocabolario: una targhetta è un'affermazione, e le fasce vanno in coppia
- **le fasce sono una coppia di mestieri**: «se c'è un Ed ci deve essere anche una Es e viceversa», idem
  Ad/As e Td/Ts. Un codice di fascia **spaiato** ripiega sul mestiere centrale della sua linea (`_paired`).
  Ha corretto anche un caso vecchio: una difesa a **tre** con un `DR` come braccetto leggeva `Td` senza `Ts`,
  e ora legge `Dc Dc Dc` — che è la regola già scritta («una difesa a tre ha tre centrali e nessuna fascia»);
- **una punta centrale non diventa un'ala per il posto che le danno**: «Krstovic e Scamacca non possono
  trasformarsi in As, sono Pc e basta». `ST` è l'eccezione alla regola «la fascia appartiene alla maglia»
  (un terzino è un mestiere che si assegna, una punta è definita **dall'essere centrale**); chi non è il
  centravanti della linea legge `Ad`/`As` **solo se gioca davvero lì**, altrimenti `Sp`. In una coppia la
  maglia va alla punta **più pura** (`ST` da solo batte `AM;ST`: Krstovic davanti a De Ketelaere);
- **entrambe le touchline o nessuna**: una riga con meno di due uomini che giocano una fascia è un **blocco
  centrale**, simmetrico. La riga sbilenca — uno sulla riga di fondo, la touchline opposta vuota — era stata
  difesa come informazione («lopsided is information») e l'utente l'ha superata: non è una posizione che un
  modulo abbia. La Fiorentina lo diceva nel modo più chiaro (una seconda punta a 0.28, la punta a 0.58 e un
  esterno basso sulla vernice sinistra).

### 4. Un solo listino, e la selezione che considera chi gioca su quella fascia
- **`slot_cost` eliminato** (−45 righe). Restava usato solo il suo terzo termine, la distanza di linea, ora
  `_line_gap`: era un **secondo listino** accanto a `_slot_price` e i due **discordavano**. Diceva «un posto
  larghe della linea d'attacco è di un attaccante» e `_slot_price` no: è esattamente così che Gosens
  (`ML;DL`, 6) ha **scalzato Piccoli** (`ST`, 7) sulla fascia del tridente della Fiorentina, `_better_pair`
  ha rimesso Parisi a sinistra e **la terza punta è uscita dagli undici**, disegnata come `Sp + Pc + Es`. La
  regola ora sta dove si decide il prezzo (`_off_the_front`: chi non gioca nessuna linea d'attacco paga una
  linea intera per un posto là davanti — un costo, mai un veto);
- **la griglia è raddoppiata** così mezzo passo può fare da spareggio: a pari prezzo vince il **primo**
  codice, perché la maglia del terzino sinistro va all'uomo di cui è il primo mestiere (Olivera `DL;DC` a
  sinistra, il `DC;DL` dentro). Lo spareggio è tenuto **fuori** dai confronti «mai un fit peggiore» di
  `_settle`, dove faceva sparire una riparazione vera (Cagliari: Gaetano trequartista disegnato terzo
  centrale, e Zé Pedro a pari claim fuori);
- **`_flanked`**: le fasce di una riga sono contese da **tutti quelli che le giocano**, non solo dal pool
  della sua linea. È la stessa frase della regola 3 un passo prima, alla **selezione**. Bologna, misurato: i
  cinque prendevano un `MR` a 0.44 e **un centrale di difesa** per le ali, mentre Orsolini (`RW`, 0.64) e
  Cambiaghi (`LW`, 0.53) non concorrevano nemmeno, perché i codici di un'ala lo mettono solo nel pool
  d'attacco. Resta la domanda del **claim**: un rivale prende la maglia solo a chi ha claim più basso, solo
  se la sua linea può cederlo (`can_lend`) e mai lasciando scoperta l'altra fascia — è ciò che tiene fuori il
  Touré a 0.00 da cui questa famiglia di regole è nata.

### 5. Verifica: 394 board, e il confronto con le formazioni tipo pubblicate
Ogni club × ogni forma del suo repertorio × entrambe le modalità × i due fogli: **0 righe oltre il massimo,
0 codici di fascia spaiati, 0 righe asimmetriche**, e ogni forma disegnata è un modulo reale (prima uscivano
2-5-3, 4-2-4, 2-6-2, 3-3-3-1, 3-6-1). Contro le formazioni tipo pubblicate della **stessa finestra** (SOS
Fanta, metà 25/26): **183/220 = 83% degli uomini** e **16 su 20** con gli stessi conteggi di linea (era 15).
Sassuolo 11/11; Inter, Milan, Bologna, Como, Lecce, Roma, Torino, Udinese, Juventus 10/11. Le divergenze
residue sono leggibili: Cagliari e Juventus hanno **moduli** diversi perché il nostro viene dalle forme
*misurate* nella finestra e il loro da una previsione sulla stagione nuova; Napoli e Roma hanno gli stessi
9-10 uomini disegnati una riga più avanti. Verificato anche **sul canvas vero** del pannello, leggendo gli
item disegnati: Roma `Dc 0.28 | Dc 0.50 | Dc 0.72` / `Ed 0.11 | C 0.37 | C 0.63 | Es 0.89` / `T 0.39 | T
0.61` / `Pc 0.50`, punto medio di ogni riga a 0.50.
Quattro test nuovi, uno per regola-famiglia (simmetria, coppie di fascia, tetto a 5, fasce contese) più i due
sui casi Napoli/Atalanta/Roma: **278 in totale**.

### 6. L'allenatore NUOVO adesso pesa, e pesa quanto il suo campione (`coach_shapes`)

Punto aperto da due giri, chiuso qui per la metà che riguarda **quale forma disegnare**. Il problema, misurato:
**12 club su 34 in euro (7 su 20 in Serie A) hanno un allenatore con ZERO undici in quel club**, quindi il
board disegnava la forma del **predecessore** — e `formation_typical_basis` lo diceva a parole senza che
niente lo usasse.

**La terza fonte.** `snapshot.coach_repertoire` conta le forme che **quell'allenatore** ha schierato, in ogni
sua panchina e in ogni competizione che abbiamo parsato (`coaches` × `club_match_lineups`), e le scrive nel
foglio come `coach_shapes` / `coach_shapes_of`. Una passata SQL, offline. Il club risponde «cosa fa questa
squadra», la lega «cos'è un modulo»; nessuna delle due risponde «cosa fa l'uomo che c'è **adesso**», che per
un cambio estivo è l'unica domanda che conta.

**Entra al posto della LEGA, non del club** (`shape_odds`, quarta fonte): il repertorio di lega è la risposta
generica a «cosa farebbe una squadra qui», e 188 undici di un allenatore sono la risposta specifica alla
stessa domanda. Dove il campione del club **è** del suo allenatore, `SHAPE_TRUST_*` gli dà già 0.90 e questo
non si vede.

**Pesato dal proprio campione, con soglia e rampa** (`COACH_SHAPE_MIN` 20, `COACH_SHAPE_FULL` 60), perché il
campione è disomogeneo in modo estremo: Sarri arriva con **188** undici (4-3-3 all'**86%**), Maresca 57
(4-5-1 98%), Amorim 47 (3-4-3 96%), Allegri 112 (3-5-2 solo 53% — un allenatore davvero mutevole) contro
Tedesco 3, Gattuso 2, Mourinho 1, e **Iraola, Filipe Luís, Carles Martínez a zero**, perché le loro carriere
stanno fuori dai cinque campionati che copriamo. La soglia non è un dettaglio: con n = 2 la moda è rumore e
sovrascriverebbe un'abitudine di club **già giusta** (Lazio: il club dice 4-3-3, che è ciò che le fonti
prevedono, e i due undici di Gattuso dicono 3-3-4).

**Giudizio, e le due referenze non si mescolano.** La domanda «in che modulo si schiererà» riguarda la
stagione che si asta, quindi il giudice è la **previsione 26/27** (pazzidifanta, 03/08). Su 17 club di Serie A:
**8/17 → 9/17**. Cambiano due board e nessuno peggiora nel punteggio: **Atalanta 3-4-3 → 4-3-3** (53% contro
37%, come la fonte, che scrive «Sarri stravolgerà lo storico assetto a tre proponendo la difesa a quattro» —
e l'undici disegnato coincide in 9 uomini su 11), e **Napoli 3-4-3 → 3-5-2** (la fonte dice 4-3-3: sbagliato
prima e sbagliato adesso). Il **Milan** non cambia forma ma porta il 3-4-3 — cioè il 3-4-2-1 della fonte — dal
**13% al 41%**, a due punti dalla testa. Sulla referenza di **metà 25/26** (SOS Fanta) si perde **una** linea
su 193 (172 → 171), e sta dentro i club col nuovo allenatore: è attesa, perché quella fonte descrive la
squadra del **predecessore**. Le due referenze parlano di stagioni diverse e vengono riportate separate.
Invarianti: 394 board, **0 rotture** in entrambi i bracci.

**L'altra metà — il CLAIM (chi gioca) — è stata misurata e NON adottata**, ed è esposta come lettura. Il
foglio porta `desc_preseason_starts` / `desc_preseason_matches` (quante amichevoli della pre-season della
stagione-bersaglio ha iniziato) e la targhetta lo dice: «PRE-SEASON: started 2 of 2 friendlies under Maurizio
Sarri — a reading, not a criterion». Sul caso dell'utente sembra decisivo: le due amichevoli di Sarri le
hanno iniziate **Gaetano, Samardzic, Scamacca e Raspadori** — i quattro che la previsione pubblicata schiera e
che il nostro claim lascia fuori — mentre **De Roon, Ederson e Krstovic**, che il board schiera, non ne hanno
iniziata **nessuna**. Cinque ragioni misurate per cui non decide niente: (1) le amichevoli per-giocatore
esistono per **una sola** pre-season (1696 righe contro 37), quindi nessun fuori campione è costruibile; (2)
il campione è **1-3 partite** e **Milan e Napoli non ne hanno nessuna**; (3) minuti e rating mancano in **1399
righe su 1716**; (4) gli avversari dell'Atalanta sono la **sua U23** e l'Arezzo, dove un undici iniziale non è
un'affermazione competitiva; (5) la fonte esterna che concorda **ha letto le stesse amichevoli**. È il
trattamento del corpo (altezza/peso, gate §5-terdecies): un fatto vero, sulla targhetta, per chi rilancia — e
la spunta per agire c'è già. **Pre-registrato** per giugno 2027, quando l'esito esisterà (gate §7).

### 7. La heatmap: validata come segnale, e già al suo posto
Modello dell'utente, ed è quello giusto: un codice è una posizione che il giocatore **può** ricoprire (il
provider elenca quello che ha coperto o potrebbe coprire, e legge **oggi**), la heatmap è dove **ha
giocato**. Validata come compito di previsione sui **52 uomini di cui le formazioni pubblicate dichiarano la
fascia**: primo codice **93.9%** (46/49), **centroide 97.9%** (46/47), banda dominante del cloud 97.8%
(45/46). La misura batte il codice — e il **cloud non batte il centroide**, che è già quello che `lateral`
legge **per primo**, tenendo il codice solo come guardia contro una contraddizione. Dettaglio, e i quattro
tentativi di usarla altrove che sono risultati **piatti**, in [gate §5-quaterdecies](gate-motore-v1.md).
Nota di dato, riusabile: il payload della heatmap in cache è una griglia `points: [{x, y, count}]`, e le tre
**bande** (terzo sinistro/centrale/destro, orientate con la stessa calibrazione di `measured_sides`)
separano ciò che una media non può — chi gioca **su entrambe le fasce** da chi gioca **al centro**: Malen
0.37/**0.50**/0.14 contro Pulisic 0.46/0.30/0.24, centroidi −0.149 e −0.163. Non è in pipeline: costerebbe
una migrazione di `positions`, una colonna d'ingest e una nel foglio, e il disegno non la usa.

## Novità v9.16 (3 agosto 2026 — la percentuale di una build, il piede, e la tabella che colora le celle)

Quindici richieste dell'utente in una sessione, tutte sul pannello Snapshot, piu' un difetto che una di
esse ha fatto emergere (§5). **Nessun numero del motore cambia**: sono avanzamento, disegno, colore e una
domanda in piu' che il board sa rispondere. 271 test (11 nuovi), ruff pulito.

### 1. La build dello snapshot dice a che punto è (percentuale, non spinner)
Prima la barra era **indeterminata** con il commento «una percentuale sarebbe un numero inventato». Ora
`snapshot.Progress` la produce, e la differenza è che i pesi sono **misurati**: `STAGES` porta i **secondi**
di ogni fase, non delle quote, e la percentuale è la quota dei secondi già spesi. Misura del 03/08/2026
(euro/mantra 2026-27, 910 righe, 34 club): `squads` 14s · `prepare` 5s · **`predict` 37s** · `form` 4.4s ·
`layers` 4.3s · resto <1s, totale **65s** — dalla riga `[snapshot] stages:` che ogni run adesso stampa, che
è anche il modo di **rimisurarli**. Le due fasi di rete vengono dai timestamp della cache di una refresh
vera: 35 pagine club in **95s** più un top-up di 71 giocatori in **197s** = `roles` 293s (l'80% di una build
completa è l'osservazione dei ruoli granulari), `refresh` 8s.
Tre proprietà che i secondi comprano e le quote fisse no:
- una build **senza refresh** non si ferma al 20%: le due fasi di rete escono dal denominatore;
- `tick(0, 0)` = «niente da scaricare» (cache del giorno già piena) **toglie la fase** invece di accreditare
  alla cache un lavoro che non ha fatto;
- monotona per costruzione, e dentro `roles` interpola su un totale **contato** (`4/34 clubs`), non su un timer.
Il canale è una riga di stdout — `[snapshot] 46% · descriptive layers` — quindi CLI, log Operations e barra
del tab leggono lo stesso segnale; il pannello la parsa (`SnapshotView.PERCENT_LINE`) e passa la barra in
modalità determinata. Quello che la percentuale **non** è: una stima dei secondi rimasti.

### 2. Il campetto: chi sta a destra lo decide lo SLOT, non il suo codice
Domanda dell'utente: «perché Hojlund (Pc) a destra e Neres (Ad) al centro?». Difetto reale, e la catena è
istruttiva: `slot_cost` aveva già assegnato le tre maglie leggendo **tutti** i codici di ciascuno (Politano
`RW;MR` → destra, **Hojlund `ST` → centro**, Neres `RW;LW` → sinistra), poi il disegno ricalcolava il lato
dal **codice primario** — e Politano e Neres sono entrambi `RW`, quindi si prendevano le due fasce e il
centravanti finiva sull'ala sinistra. La risposta della forma era già calcolata e **buttata**.
Ora `across_bucket` legge lo slot vinto (`_slot_side`, scritto da `eleven`) e `_placed`/`_lane` ordinano su
quello; dove nessuno slot è stato assegnato — undici **dichiarato** dalle probabili, undici **schierato** —
resta la fascia del giocatore, come prima. Misurato sul foglio euro/mantra del 03/08: l'attacco del Napoli
passa da `Politano · Neres · Hojlund` a **`Politano · Hojlund · Neres`**, e la difesa non si muove.

### 3. Il PIEDE preferito: c'era già nel dato, non lo leggeva nessuno
`player_roles.foot` e la colonna `desc_foot` esistono dalla v9.7 (il provider le dà nella stessa richiesta
per club dei dodici codici) e **nessuna riga di pannello le usava**. Prima di usarle, misurato sul DB
(`desc_foot` contro il lato dalla heatmap; 2025-26, ripetuto su 2024-25 con gli stessi segni):

| dove | n | esito |
|---|---|---|
| `DL` | 103 | **96% sinistro** |
| `DR` | 126 | **96% destro** |
| `MR` / `ML` | 54 / 40 | 98% destro / 68% sinistro |
| `LW` | 95 | **86% DESTRO** (ala invertita) |
| `RW` | 90 | **69% SINISTRO** (ala invertita) |
| `DC` senza codice di fascia, mancini | 29 | lato medio **−0.309**, **93%** a sinistra del centro |
| `DC` senza codice di fascia, destri | 80 | lato medio +0.167, 69% a destra |

Quindi: fasce di **difesa e centrocampo sul proprio piede**, **ali invertite**, e fra due centrali il mancino
sta a sinistra — che è esattamente il caso dell'utente («nelle difese spesso si mettono difensori non tutti
con lo stesso piede») e l'unico in cui **nessun codice dice niente**. `FOOT_SIDE` + `foot_side(row, lane)`
codificano la tabella (lane `A` = invertita) e servono come **spareggio** dentro la linea, dopo lo slot e
dopo il lato misurato: decidono chi dei due sta da che parte, **mai chi gioca** — la maglia resta di chi ha
le presenze. Il piede è anche scritto sul tooltip della targhetta.
⚠️ Fatto **descrittivo**: non entra in nessuna colonna `engine_*`. Se un giorno il piede dovesse pesare su
una previsione, serve un giro di gate pre-registrato come per qualunque altra ipotesi.

### 4. La tabella rosa diventa una CANVAS: ruoli e segni colorati
Due richieste («colora i ruoli classic e mantra», «evidenzia i valori positivi e negativi») e un vincolo
verificato empiricamente: in **Tk 8.6 un Treeview colora la RIGA e niente di più fine** — `tag cell` non
esiste (`bad command "cell": must be add, bind, configure, has, names, or remove`). Quindi la tabella è ora
due canvas (header + corpo) che scorrono insieme, con un `kind` per colonna:
- `pill_classic` / `pill_mantra`: il ruolo come **pillola** nella stessa palette dei badge sul campetto
  (`CLASSIC_COLOUR`, `MANTRA_COLOUR`), così tabella e board nominano un ruolo nella stessa lingua;
- `num`: ogni numero **verde sopra la media del FOGLIO, rosso sotto** — e la media è su **tutti i
  calciatori di tutte le squadre** che il foglio porta, non sul club a schermo (essere il migliore di una
  rosa scarsa non è essere buono). Precisazione dell'utente, e cambia il senso: non è il segno del numero,
  è il confronto con la popolazione, che è ciò che rende leggibile una colonna (6.3 di fantamedia prevista
  non dice niente finché non sai che la media del foglio è 6.1). Le celle vuote **non entrano** nella media
  (un numero che manca non è uno zero), e `inj` è **invertito** (`HIGHER_IS_WORSE`): saltare più stagione
  della media è la cattiva notizia. Un foglio ristretto a un club è la propria popolazione — c'è solo lui
  nel file — e il tooltip dell'intestazione lo dice invece di far finta che la media sia di una lega;
- `real`: il testo nel colore della sua LINEA (le quattro famiglie del listone);
- `trend`: la striscia delle ultime dieci resta la stessa `PhotoImage` (`_sparkline`), disegnata sulla
  canvas — la logica dei pallini è misurata e testata, riscriverla sarebbe una seconda implementazione.
Quello che un Treeview dava gratis è ora scritto: segno di ordinamento sull'header, righe alternate,
tooltip per colonna e per cella (flags e trend), click sulla striscia, scrollbar orizzontale mostrata solo
quando le colonne non entrano (`xview` della canvas, non la somma delle larghezze).

### 5. Lo schieramento TIPO non si sceglie con lo sconto infortuni (`claim` ≠ `presence`)
Domanda dell'utente: «tra Elmas, De Bruyne e Anguissa, Elmas farebbe sicuramente la panchina». Aveva
ragione, e il difetto era una **contraddizione con la definizione stessa** del tab: il docstring diceva
«the side he fields when everyone is available: injuries and suspensions are deliberately IGNORED» ma
l'ordinamento usava `presence` = `standing × availability`, cioè lo sconto infortuni **dentro** il criterio.
Misurato sul Napoli (foglio euro/classic del 03/08/2026):

| | standing | availability | presence |
|---|---|---|---|
| McTominay | 1.00 | 0.88 | 0.88 |
| **De Bruyne** | **1.00** | **0.53** | **0.53** ← fuori dagli undici |
| Lobotka | 1.00 | 0.81 | 0.82 |
| Zambo Anguissa | 0.87 | 0.70 | 0.61 |
| **Elmas** | **0.62** | 0.92 | **0.57** ← dentro |

Un centrocampo McTominay-Lobotka-Elmas non è la squadra che il Napoli schiera quando ci sono tutti: è la
squadra pesata per chi tende a esserci, che è **un'altra frase** e che il foglio scrive già in
`engine_pv_pred` e nella colonna `inj`. Nuovo metodo **`claim(row, horizon)`** = `standing` per la
stagione (chi gioca quando è disponibile), `presence('recent')` per la prossima giornata — dove nulla
cambia, perché là infortunati e squalificati sono **esclusi a monte** e la probabilità degli editori vince.
Ordinamento degli undici, targhette, rivali, tooltip, scelta della forma e top player ora leggono `claim`;
la didascalia dice **«XI by % started when available»** e il tooltip della targhetta porta *entrambi* i
numeri («100% when available» + «expected to be there 53% of the season → 53% delle giornate»), perché la
disponibilità resta un fatto d'asta e non deve sparire. Esito: **De Bruyne dentro, Elmas fuori** (primo
alternativo sulle targhette insieme ad Anguissa).

### 6. Il check per calciatore: togli la spunta e gli undici si rifanno senza di lui
Richiesta dell'utente. Prima colonna della tabella, `☑`/`☐` cliccabile: la spunta è un **input**, non una
lettura. Toglierla ricostruisce **tutti** gli undici senza quel giocatore (tipo, prossima giornata,
dichiarato e schierato: l'operatore ha detto «disegnalo senza di lui»), **forma compresa** — la forma è
scelta valutando l'undici che riesce a schierare, quindi una rosa senza il suo centravanti può preferirne
un'altra, che è precisamente il senso della domanda. Chiave `fc_id`, quindi la scelta sopravvive
all'ordinamento e al cambio di club, e si azzera quando si carica un altro foglio. Il giocatore **resta in
tabella** e la didascalia del campetto conta quanti sono esclusi (`· without 2 unticked`): un undici
disegnato senza qualcuno deve dirlo. Non tocca né il foglio né un numero del motore.

### 7. Una linea può prendere il titolare di un'altra, se quel buco si richiude meglio (`_settle`)
Aspettativa dell'utente sul 4-4-2 del Napoli: «se deseleziono Gutierrez, Spinazzola va al suo posto e
Olivera gioca terzino». Non succedeva: le linee sono servite in ordine (P, D, M, A) e ognuna usa **i propri
uomini**, prendendo da un'altra solo quando li ha finiti — quindi il centrocampo sinistro andava a
**Mazzocchi (`MR;DR`, claim 0.13)** mentre Spinazzola (`ML;DL`, 0.78) restava terzino e Olivera (`DL;DC`,
0.52) stava fuori. Peggiore su **entrambi** gli assi.
Nuovo passaggio dopo la greedy: a ogni coppia di maglie si offre una mossa — dai alla maglia A l'uomo della
maglia B, e richiudi B con chi non è negli undici — accettata solo se è **PARETO**, non un compromesso:
1. la maglia che si aggiusta prende un uomo che la calza **strettamente meglio**;
2. la maglia liberata si richiude **non peggio** di com'era;
3. e gli undici **non perdono claim**.
Due lezioni misurate mentre lo scrivevo, entrambe registrate perché sono errori che il disegno mostra e il
codice no. **(a)** Una versione che pesava calzata e claim su una scala sola buttava fuori **Di Lorenzo**
(terzino destro al 100%) per guadagnare un passo di calzata altrove: non è un disegno migliore, è un altro.
**(b)** Il confronto **fra linee** va fatto con il **gap di linea per primo**, al contrario di dentro una
linea: `DR` copre la fascia destra, quindi la tupla di `slot_cost` leggeva `(0, 0, 13)` contro `(1, 2, 2)` di
un'ala e l'attacco dell'Atalanta si vedeva offrire **Scalvini, un difensore centrale**. Un centrale non è
un'ala, qualunque fascia sappia coprire (`_fit_across`). Ed è anche la ragione per cui si prende la mossa
**migliore** e non la prima trovata: il centrocampo sinistro del Napoli lo aggiusta anche Buongiorno
(`DC;DL`, sette passi di linea), e la prima trovata metteva lui.
Raggio d'azione **misurato** su 34 club × 3 moduli, con nessuno deselezionato: **8 undici su 102 cambiano**,
tutti nello stesso modo — Barcellona (Eric Garcia sale a destra, Koundé terzino: claim 9.41→9.43), Dortmund
(Sabitzer sale, Can in mezzo: 8.26→8.52), Chelsea (Reece James sale a destra, Fofana nei tre: 7.25→7.87).
Napoli con Gutierrez dentro **non si muove**; con lui fuori dà la catena che l'utente si aspettava.

### 8. Una linea raggiunge la fascia solo se ha un uomo che la gioca
Osservazione dell'utente sull'undici **dichiarato** (probabili, 3-4-2-1) del Napoli senza Gutierrez:
«risultano 4 centrocampisti centrali e Lobotka sembra giocare esterno — in un centrocampo a 4 due sono
sempre esterni, e devono essere esterni di ruolo». Il modulo dice che un quattro è due esterni e due
centrali, ma **la linea arrivava senza esterni** (`MC`, `MC;DM`, `MC;AM`, `MC;DM`) e la griglia veniva
stesa alle fasce comunque: Lobotka finiva sulla linea laterale. Gli esterni non si possono **inventare** —
in un undici dichiarato i nomi sono degli editori — quindi quello che il disegno deve fare è non
**pretendere** una fascia che nessuno gioca. Tre casi, un margine per bordo:
- **due o più uomini di fascia** (`sides_of` ha `R` o `L`): le linee laterali, come prima;
- **uno solo**: linea **sbilanciata** — lui prende la SUA fascia e gli altri tengono il passo del blocco
  (Aston Villa: Bailey a 0.11, gli altri tre a 0.31/0.52/0.72), che dice *sbilanciata* invece di dire
  *esterno*;
- **nessuno**: **blocco centrale**, e con un tetto nuovo (`CENTRAL_MARGIN_MIN` = 0.28) perché quattro
  centrali col passo di prima occupavano 0.17-0.83, cioè due terzi del campo, che è una linea con le ali.
  Napoli: il quattro ora sta a 0.28-0.72, nessuno sulla fascia. Una linea da tre o meno non si muove -
  ed è la maggioranza (`("D", 3)`, `("M", 3)`, i trequartisti).
Raggio d'azione **misurato**: su **703 linee disegnate** (34 club × 5 moduli), **48 non arrivano più alla
linea laterale** — tutte centrocampi con zero o un uomo di fascia, cioè tutte e sole le ali finte.

### 9. L'undici DICHIARATO va assegnato al modulo, e il modulo si trasforma se non lo regge
Il blocco centrale (§8) non bastava: la regola dell'utente è più forte — «4 centrocampisti centrali non
esistono, massimo 3; ai lati devono esserci due esterni (ali, terzini, esterni), mai centrali» — con il
rimedio già indicato: «un 3-4-3 con quattro CC si deve trasformare: i due attaccanti esterni arretrano a
coprire il centrocampo, e i quattro centrocampisti si dislocano un po' sulla tre quarti e sulla mediana».
Il difetto era **a monte del disegno**: l'undici dichiarato veniva solo **raggruppato per ruolo** proprio
(`lane_of`), non **assegnato** ai posti del modulo. Con i nomi degli editori — Politano `RW;MR` e Santos
`LW` in rosa — il quattro **aveva** i suoi esterni: venivano disegnati come tridente mentre quattro
centrali si dividevano la linea.
Tre pezzi nuovi:
- **`_assign`**: gli undici GIÀ SCELTI vengono distribuiti sui posti del modulo, usando le **linee proprie**
  del modulo (`shape_lanes`: 3-4-2-1 = D3 M4 T2 A1, non il sei collassato di `lines()`). Con tanti posti
  quanti uomini non può escludere né aggiungere nessuno: decide solo la disposizione — la differenza
  rispetto al «riempire un modulo scegliendo per linea», che una volta mise in campo una riserva al 35% con
  un terzino al 100% fuori.
- **`_matching`**: e la disposizione si risolve **come un tutto** (Hungarian O(n³), scritto in casa, zero
  dipendenze), non una maglia per volta. Questa è la lezione della giornata, sbagliata **tre volte** prima
  di capirla: una passata greedy deve fissare un ordine di priorità fra la FASCIA e la LINEA, e **entrambi
  gli ordini sono sbagliati sullo stesso undici**.
  - fascia per prima → la sinistra di un centrocampo a quattro va a un centrale invece che a un'ala
    («Lobotka sembra giocare esterno»);
  - linea per prima → il posto del trequartista va al **centravanti** invece che all'ala che ci gioca
    («Hojlund non può mai stare sulla trequarti»), e l'ala resta punta unica, che non è nemmeno lei.
  Sono la stessa tupla letta in due modi — `(0, 3, 0)` contro `(4, 0, 0)` — e quello che le separa è che la
  risposta giusta riguarda **l'undici intero**, non una maglia: Santos trequartista + Hojlund punta costa
  **7**, il contrario **11**. Prezzo di una casella = `SIDE_PRICE[fascia sbagliata] + allows + gap`, dove il
  gap è la distanza di linea sulla griglia `LANE_DEPTH`×20 (una linea piena = 7) e i tre gradini di fascia
  hanno **ognuno il suo prezzo, ognuno deciso da un caso**:

  | fascia sbagliata | prezzo | il caso che lo fissa |
  |---|---|---|
  | 1 · l'altra fascia (un terzino destro a sinistra) | **2** | meno di una linea: si invertono i terzini ogni settimana |
  | 2 · un uomo di fascia in mezzo (un'ala trequartista) | **5** | tiene il **centravanti** fuori dalla trequarti (7 contro 11) |
  | 3 · un centrale su una fascia | **8** | resta più economico che fare un mediano difensore centrale, altrimenti un 3-4-3 si disegna con due mediani nella difesa a tre e i terzini larghi a centrocampo (16 contro 28) |

- **`_reshape`**: e il cambio di linea resta **un passo obbligato**, come chiesto. Chi resta su una fascia
  senza giocarci, o in una linea in cui non gioca affatto, si sposta nella linea più vicina alla sua
  profondità e la linea che lascia si disegna con un uomo in meno. La difesa è **esente** dalla regola
  della fascia (i braccetti sono centrali per mestiere), e la scelta fra mediana e trequarti guarda il
  codice **più avanzato** (i due `MC;AM` salgono, i due `MC;DM` restano): sul più vicino pareggiavano tutti
  su `MC` e il quattro diventava un sei piatto.

Esito sull'undici dichiarato del Napoli (3-4-2-1, il modulo degli editori stessi): **Di Lorenzo · Rrahmani ·
Olivera** dietro; **Politano `Ed` · McTominay · Lobotka · Gutierrez `Es`** nel quattro (un'ala e un terzino
sulle fasce, come chiesto); **Elmas + Santos** sulla trequarti; **Hojlund** punta. Chiedendo un 3-4-3 allo
stesso undici si ottiene un 3-4-3 vero (le due ali larghe davanti) e non una trasformazione forzata: il
cambio di linea avviene **solo** quando il modulo chiede un ruolo che l'undici non ha.

Verifica **su tutto il perimetro**: 34 club × 5 moduli × 2 modalità = **340 undici**, e adesso **0 centrali
su una fascia, 0 uomini a due linee da casa, 0 portieri fuori dai pali, 0 undici incompleti**. Le 12 punte
disegnate a centrocampo hanno tutte un codice di centrocampo loro (Havertz `ST;MC`, Pepe `ST;MR;RW`).
Trovato per strada e chiuso: con **una sola** probabilità registrata (Eintracht) il board disegnava **un
uomo** su un campo vuoto — l'undici dichiarato ora richiede almeno 11 nomi, sotto quella soglia si torna
alle presenze misurate.

### 10-ter. In una linea a quattro i due esterni sono TERZINI, e il badge lo dice
Richiesta dell'utente sulla Juve disegnata 4-5-1: «in una linea a 4 di difensori, i due terzini esterni devi
segnarli come Ts e Td e non come Dc — lo stesso per McKennie, che in quella posizione deve essere segnato
come Ed». Prima il badge mirrorava **solo un codice che nominava già una fascia** (`DL` disegnato a destra →
`Td`), mentre un codice centrale non veniva toccato: quindi una difesa a quattro di quattro `DC` leggeva
**Dc quattro volte**. È la stessa regola un passo più avanti — *il ruolo resta suo, la FASCIA è della
maglia* — e la dice il modulo: una difesa a **quattro HA** due terzini, chiunque li giochi.
`badge(..., slot=)` legge il posto che la forma ha dato (`_slot_side`) e, dove quel posto è una fascia e il
codice non ne nomina nessuna, prende il codice di fascia di quella LINEA (`FLANK_OF_LANE`). Una difesa a
**tre** ha tre posti centrali e nessuna fascia, quindi i braccetti restano `Dc`: la regola non tocca nulla
che non sia una linea con le fasce. Misurato sulla Juve: `Td` Kalulu · Dc Bremer · Dc Gatti · `Ts` Kelly, e
in mezzo `Ed` McKennie · M Locatelli · C Thuram · C Koopmeiners · `Es` Cambiaso — con il 3-4-3 dello stesso
undici che continua a leggere tre `Dc`.

### 10-quinquies. Perché un SURPLUS può essere vuoto, e perché lo dice ora
Domanda dell'utente: «come mai Raspadori non ha un valore SURPLUS?». Due risposte, e nessuna delle due era
un difetto:
- sui fogli della **sua lega** (euro/classic EuroLeghe) il surplus **c'è** e vale **−3.7** (valore 102.7,
  rimpiazzo 7.053): è negativo, non assente — e da oggi si legge rosso;
- sul foglio **Serie A (`default`)** è vuoto, e la ragione è dichiarata nel motore: il suo 2025-26 su quella
  piattaforma è di **13 voti**, sotto `model.MIN_PV_PREV = 15`. Le beta sono state fittate su Pv≥15 e le
  àncore su Pv≥20; fuori da quel dominio il core non è mai stato validato e **l'harness si rifiuta di
  fingere** (`evaluate._predict_fm`). Su **euro** il set adottato contiene **R0c**, l'àncora di ruolo, che lo
  prezza comunque; su **default R0c non è adottata** (là non ha mai battuto l'àncora), quindi non c'è nulla su
  cui ripiegare. È il buco di copertura Serie A che il gate porta da sempre, e su quel foglio riguarda
  **253 righe su 598**.
Aggiunto perché una cella vuota non si spieghi da sé: una **nota nel manifest** con il conteggio, il perché e
cinque nomi d'esempio (Belotti, Balotelli, Milik, Pellegri, Lukaku) e una riga nel **tooltip della colonna
SUR**. Le colonne `desc_*` non sono toccate: quelle sono misurate, non previste.

### 10-sexies. Il modulo di un allenatore NUOVO: misurato, e non ancora usato
Osservazioni dell'utente sull'Atalanta: «lo schema preferito di Sarri dovrebbe essere il 4-3-3»; poi «dalle
amichevoli sembra che giochi 3-4-2-1, Raspadori sempre titolare». Il foglio dice che ha ragione, e mostra
dove il board oggi guarda il dato sbagliato:
- l'Atalanta ha **Sarri dal 15/06/2026** e `formation_typical_under_coach = **0**`: **nessuno** dei 46 undici
  misurati è suo. Il 3-4-3 al 93% è l'Atalanta di prima;
- il modulo di **Sarri** è misurabile dai NOSTRI dati — `coaches` (i suoi spell: Napoli 15-18, Chelsea 18-19,
  Juventus 19-20, Lazio 21-24 e 25-26) incrociato con `club_match_lineups`: **4-3-3 in 162 undici su 188 =
  86%**, 4-4-2 11%, tutto il resto sotto il 2%;
- e le sue **due amichevoli** con l'Atalanta (18 e 26/07/2026) sono in cache e parsate: leggono 2-5-3 e 2-6-2
  nel vocabolario del provider (che conta gli esterni come centrocampisti), cioè una difesa a tre con due
  braccetti — coerente con il 3-4-2-1 dell'utente. **Raspadori è titolare in entrambe** (come Scamacca,
  Djimsiti, Carnesecchi, Samardzic, Zalewski, Scalvini, Bernasconi).
Cosa ne consegue, e non è fatto: **gli undici del nuovo allenatore — amichevoli comprese — sono l'unica prova
di cosa fa lui**, sia per il modulo sia per chi gioca, e lo *schieramento tipo* li ignora per costruzione
(misura l'abitudine della stagione scorsa). Il tab **prossima giornata** invece li vede già, ed è la conferma:
là Raspadori è dentro, fra i due trequartisti del 3-4-2-1 dichiarato. Il lavoro da fare — con la testa fresca,
non alle tre di notte — è far pesare il campione del nuovo allenatore nel prior del modulo (c'è già
`SHAPE_TRUST_FLOOR` per questo, ma il campione dell'allenatore non entra da nessuna parte) e dire nel pannello
che il tipo è l'abitudine di **un'altra squadra** quando `under_coach` è zero.

### 10-quater. Il claim scegli CHI gioca, la calzata solo DOVE — e il prezzo di una casella per linea
Domande dell'utente sull'Atalanta: «come mai la formazione tipo passa dal 3-4-3 al 3-6-1? perché Raspadori e
Scamacca non giocano titolari?». Due difetti veri, uno di modello e uno di dato.

**1. La selezione non doveva essere della calzata.** Le maglie venivano date una casella per volta al
candidato che calzava meglio, quindi un uomo a **claim 0.00** (Touré) prendeva la sinistra del tridente
perché nasceva ala sinistra — e la riparazione, per rimediare, tirava due **terzini** dentro l'attacco; poi
`lanes_for` li ridisegnava dove giocano davvero e usciva il **3-6-1 con un attaccante**. Ora la selezione è
per linea e **solo sul claim** (chi gioca), e la calzata decide **solo la disposizione** (`_assign`, la
stessa assegnazione globale dell'undici dichiarato). Misurato su 340 undici: somma dei claim **2708 → 2932**,
cioè elevens più forti a parità di tutto il resto.

**2. Il prezzo di una casella dipende dalla LINEA.** Tarare un prezzo unico per la fascia rompeva un caso per
ogni correzione, e la ragione è che le due linee non chiedono la stessa cosa:
- a **centrocampo e in difesa la fascia è un ruolo** — un esterno e un mediano fanno due lavori — quindi
  stare una fascia fuori posto deve costare **più** che salire di una linea intera: è perché Gutierrez
  (terzino, una linea sotto) è l'esterno del quattro e un mediano no;
- nel **reparto avanzato i tre si scambiano** — una punta va sull'ala per un tratto e la targhetta lo dice
  (`Ad`/`As`/`Sp`) — quindi la fascia deve costare **meno** di una linea: è perché Krstovic tiene la sinistra
  del tridente contro un terzino sinistro, e la trequarti va a un'ala e non al centravanti.
Quindi `SIDE_WEIGHT` = **8** su D/M, **3** su T/A, con la distanza di linea sempre `20 x Δprofondità` (una
linea piena = 7), più due dettagli che i casi hanno imposto: un **centravanti preferisce il centro**
dell'attacco (sulla griglia un trequartista e una punta sono equidistanti, e senza quel termine un 3-4-3
disegnava McTominay punta con Hojlund larga) e **una linea sistema le proprie caselle prima di chiedere a
un'altra** (è la differenza fra Napoli — il centrocampo non ha un mancino suo, quindi Spinazzola sale e
Olivera entra — e Atalanta, dove l'attacco ha De Ketelaere per la sua sinistra e un terzino non ci deve
entrare). E una mossa a **calzata invariata** ora chiede `CLAIM_MARGIN = 0.05` (due giornate su 38): due
mosse da +0.01 in catena erano bastate a lasciare l'attacco dell'Atalanta con un uomo.

**Esito**: Atalanta 3-4-3 → disegnata **3-4-1-2** con De Ketelaere `Pc` e **Krstovic `As`** davanti;
Juventus 3-4-3 → `Ad` Conceicao · `Pc` Vlahovic · `As` Yildiz; Napoli 4-4-2 → Hojlund + Neres. Su 340
undici: **0 uomini a due linee da casa, 0 undici incompleti, 0 portieri fuori dai pali**.

**E la risposta di DATO alla seconda domanda**: Raspadori e Scamacca non giocano perché l'Atalanta ruota le
punte e il claim lo dice — Krstovic **0.54** (18 titolarità su 33 partite), Scamacca **0.49** (16 su 24, con
disponibilità 0.56 per gli infortuni), Raspadori **0.25** (7 su 13). Nessuna delle tre tiene la maglia: la
tipo prende la migliore e la seconda casella la vince un trequartista che gioca di più.

⚠️ **Aperto, misurato e non risolto**: su 340 undici restano **9 attacchi senza un attaccante** (Barcellona
schiera Olmo e Lopez davanti con una punta a 0.79 fuori) e **3 centrali su una fascia**. Vengono dallo stesso
punto: la linea `T` (i trequartisti, codice `AM`) è in pool con l'attacco, quindi per claim un numero dieci
batte una punta. Provato a mettere gli attaccanti in testa al pool per l'attacco: sistema Barcellona e
**rompe l'Atalanta** (torna il 3-6-1). Lasciato come è, scritto qui, invece di tarare un altro numero al
buio: la decisione giusta è probabilmente separare il pool `T` da quello `A` quando il modulo ha una linea
di trequartisti, e va fatta con calma.

### 10-bis. Il CORPO: torre o punta di movimento (misurato, non usato per scegliere)
Richiesta dell'utente: capire se l'allenatore preferisce una punta di movimento (L. Martinez, Boga) o una
punta fisica da torre (Hojlund, Vlahovic). Il dato era **già nella cache**: la pagina rosa del provider —
una richiesta per club, la stessa dei dodici codici e del piede — porta anche `height`, `weight`,
`dateOfBirth` e `proposedMarketValue`. Quindi migrazione (`player_roles.height`/`weight`), re-ingest
**offline**, e due colonne nuove nel foglio (`desc_height`, `desc_weight`): **953 altezze su 953**, 343 pesi
(il peso alla fonte è più raro). Hojlund 191 · Vlahovic 190 · Yildiz 187 · David 180 · Openda 177 · Boga 172
· Conceicao 166 — la distinzione si vede, ed è quella che il codice `ST` non dice.
Poi la misura, **prima** di usarla: su 92 coppie (club, stagione) in cui due punte hanno almeno 5 partite da
titolare ciascuna, la più usata è la **più alta 44 volte = 48%**, con le stagioni fra 14% e 69%. Una
monetina. Quindi il corpo **non entra in nessuna scelta** — non nel prezzo di una casella, non come spareggio
fra due punte, non in una colonna `engine_*` — e vive nel **tooltip** della targhetta e nella lista degli
alternativi (`SnapshotView.build`), dove serve a chi legge. La ragione per cui la misura non chiude
l'ipotesi è dichiarata: l'utente parla di **come gioca** una squadra (cross, duelli aerei, palle lunghe) e
quei dati **non sono** nello strato per-partita, mentre il canale che vediamo — chi schiera — non ha segnale.
Dettaglio e numeri: gate **§5-terdecies**. ⚠️ Nella stessa pagina c'è `proposedMarketValue`, cioè il proxy che
§7-quater aspettava per ri-testare l'investimento del club: nota per il prossimo giro.

### 10. Due difetti che l'operatore ha visto guardando il campetto
1. **«Yildiz perché è punta? non c'è altro di meglio?»** — sì: Vlahovic (claim **0.57**) e David (0.54)
   erano fuori dagli undici mentre il tridente leggeva Conceicao 0.75 · **Yildiz 0.90 al centro** · Gonzalez
   0.36. La greedy per casella non sbagliava la calzata — Yildiz al centro e Yildiz sull'ala sinistra
   calzano **identico** — quindi la riparazione, che pretendeva una calzata *migliore*, non poteva vederlo.
   Ora `_better_pair` accetta anche la mossa a **calzata invariata** se aggiunge claim: resta Pareto (la
   calzata non peggiora mai, il claim migliora strettamente), e la Juve esce **Conceicao `Ad` · Vlahovic
   `Pc` · Yildiz `As`** (+0.21 su quel tridente). Misurato su tutti i **340 undici**: somma dei claim
   **2708.5 → 2819.5 (+111)**, con **0** difetti di posizione (nessun centrale su una fascia, nessuno a due
   linee da casa, nessun portiere fuori dai pali, nessun undici incompleto). `SETTLE_ROUNDS` 3 → 6, perché
   una mossa a parità di calzata può aprirne un'altra.
2. **«spesso i tooltip escono fuori dalla schermata»** — e uscivano per costruzione: l'angolo del tip veniva
   messo sul puntatore senza sapere quanto fosse grande. Ora `Tooltip._show` lo **misura prima di mostrarlo**
   (piazzato fuori schermo, `update_idletasks`, `winfo_reqwidth/height`) e lo **ribalta** dall'altro lato del
   puntatore quando sfonderebbe il bordo, clampando solo se è più alto dello schermo. Ribaltato e non
   clampato perché un tip appoggiato al bordo copre esattamente la cella o la targhetta che sta spiegando.
   È il caso peggiore proprio su questo pannello: le colonne con l'aiuto più lungo stanno a **destra** della
   tabella e le targhette in **basso** nel campetto.

### 10. I test nuovi
`test_the_shape_decides_where_a_man_is_drawn_and_not_his_own_code` (il caso Napoli, per nome),
`test_the_preferred_foot_separates_two_centre_backs_and_is_inverted_in_attack`,
`test_the_build_percentage_is_measured_monotone_and_drops_what_it_skips`,
`test_the_table_colours_a_role_and_a_number_against_the_sheets_mean` (legge il `fill` degli item della
canvas, media iniettata, e verifica l'inversione di `inj`),
`test_unticking_a_player_rebuilds_the_eleven_without_him`,
`test_a_line_may_take_another_lines_starter_if_the_hole_closes_better` (il caso Gutierrez, per nome),
`test_a_line_only_reaches_the_touchline_where_it_has_a_man_who_plays_there` (i tre casi: due esterni, uno,
nessuno), `test_a_declared_eleven_is_assigned_to_the_shape_and_never_moves_a_man_for_nothing` (le tre regole insieme:
esterni sulle fasce del quattro, la punta punta e l'ala mai punta unica, e nessun cambio di linea non
obbligato), `test_a_tooltip_never_leaves_the_screen` (il puntatore nell'angolo in basso a destra),
`test_the_body_reaches_the_sheet_and_decides_nothing` (altezza e peso arrivano, e il prezzo di una casella
non li legge), `test_the_outer_men_of_a_back_four_are_full_backs_on_the_badge` (e una difesa a tre no).
**271 test verdi.**

## Novità v9.15 (29 luglio 2026, notte — il pannello: l'altezza si spende sul campetto, non sul suo bordo)

Richiesta dell'utente: «l'altezza del campetto è troppo sacrificata, riduci i tab e l'header, più spazio per
rosa e campetto — le altre informazioni sono di contorno». Tutto quello che segue è **misurato con una sonda
sulle geometrie dei widget** (`winfo_height`/`winfo_rooty` a finestra reale), non stimato a occhio: è la
ragione per cui sono venuti fuori anche due difetti che nessuno vedeva.

### 1. Il chrome era dimensionato un pezzo per volta
Sopra il campetto stanno l'header dell'app, la strip dei tab, la barra del foglio, la riga di provenienza e la
card del club: ognuno ragionevole da solo, tutti insieme **metà dell'altezza della finestra**. A parità di
finestra (1180x780): campetto **388 → 493px (+27%)**, tabella rosa **448 → 534px**, chrome del board
**242 → 165px** (rapporto campetto/chrome **1.6 → 3.0**). Da dove vengono:
- **header dell'app 75 → 43px**: una riga sola (icona, nome, versione, path del DB clippato con tooltip) e
  `h1` da `base+6` a `base+3`, perché gli unici due h1 del pannello stanno *sopra* la cosa che si legge.
- **strip dei tab 45 → 33px**: padding verticale 8→4, tabmargin superiore 6→2. Nomina quattro viste e si
  legge una volta per sessione.
- **card del club 94 → 31px**: nome e informazioni sulla **stessa riga**, e il modulo con il *perché* della
  scelta passano nell'hover — erano già nel selettore `modulo` e nella didascalia del campetto, cioè lo
  stesso fatto scritto **tre volte**. Il resto (probabili, allenatore, Elo, arrivi, linee) resta a vista.
- barra del foglio e riga di provenienza: una riga ciascuna, il testo intero nel tooltip.

### 2. La finestra: massimizzata, e poi la scelta dell'operatore
Era **1180x780 fissi**. Ora si apre **massimizzata** e alla chiusura ricorda cosa ha scelto l'operatore in
`ui-prefs.json` (`window`: `"zoomed"` o la geometria; una geometria che non entra più nello schermo — un
portatile senza dock — viene ignorata e si torna a massimizzata). Massimizzata e **non** «schermo meno un
margine di sicurezza» perché l'area di lavoro è un numero del window manager: la formula col margine, misurata,
lasciava **49px inutilizzati**. Su 1536x864 logici il client è 1536x793 e il campetto **449x506**.

### 3. La tabella rosa: 276px di colonne non erano strette, erano ASSENTI
Le 14 colonne sommano **766px** e la card ne aveva **471**: Tk taglia quello che non entra e non offre alcun
modo di raggiungerlo, quindi `inj` e `flags` semplicemente non c'erano. Tre correzioni:
- **split 1/3 – 2/3** invece di 50/50, con **pavimento 446px** per la colonna del campetto (la sua larghezza
  di disegno: sotto quella le targhette perdono lettere dei nomi) e un pavimento basso per la tabella, perché
  due pavimenti che sommano più della finestra MINIMA spingono la scrollbar fuori dallo schermo.
- **scrollbar orizzontale mostrata solo quando serve** (`_sync_hscroll`): interroga `xview` del tree, non la
  somma delle larghezze, perché le due colonne elastiche assorbono l'avanzo. Massimizzato il foglio entra
  tutto (tree 808px contro 766) e i 15px vanno alle righe.
- **larghezze rimisurate** sul valore più largo che ogni colonna porta davvero, su tutti i club del foglio
  (`dd/ds/e`, `MC/DM`, `Milinkovic-Savic V.`, `100%`) più il padding della cella, o sull'intestazione in
  grassetto dove è lei la più larga. Sfoltirle a occhio ne aveva **tagliate sei**: `real` scriveva `DC/D`
  al posto di `DC/DR`.

### 4. Due difetti che solo la misura ha fatto vedere
- **La status bar era invisibile da sempre.** Creata, riempita e aggiornata **a 1x1 pixel**: era packata
  *dopo* uno shell con `expand=True`, e il packer distribuisce la cavità in ordine di packing — a chi viene
  dopo non resta niente. Ora è packata prima (27px, padding verticale 3, perché quei pixel li paga ogni tab).
  Su richiesta dell'utente: «rendila visibile».
- **La targhetta dell'attaccante finiva SOPRA la didascalia.** `_shirt` la agganciava al fondo della canvas,
  che è dove stanno le due righe di testo (verso d'attacco e modulo disegnato). Ora la canvas ha una
  `CAPTION_BAND_PX = 34` e l'undici si dispone in `field = height − banda`: l'erba resta tutta, i giocatori
  no. Effetto collaterale **misurato**: con le corsie più distanziate `plate_rivals_for` passa da **1 a 2
  rivali nominati** per targhetta (il conteggio `+1` era un rivale non scritto).

### 5. Il test che mancava
`test_the_panel_spends_its_height_on_the_board_and_not_on_its_own_chrome`: la status bar deve avere altezza
> 10px (cioè essere davvero mappata), e il campetto deve valere più di **2.5×** il chrome sopra di lui.
Asserito in **rapporti e non in pixel**, così regge su un altro DPI. Nessun test guardava la geometria: è
esattamente per questo che una barra alta un pixel è sopravvissuta per settimane.

## Novita' v9.14 (29 luglio 2026 - quanto il club ha investito su di lui, e l'unita' e' la PARTITA)

### 1. L'investimento del club: tre colonne, due canali, verdetto NEGATIVO
Ipotesi dell'utente (societa' che ha speso -> vuole vederlo giocare -> l'allenatore perdona). Resa
misurabile con `desc_investment_fee`, `desc_investment_fee_share` (il cartellino come **quota di quanto quel
club ha speso** in quella finestra: Ndoye 42 M = **74%** della spesa del Bologna) e
`desc_investment_stature` (il percentile di **Qt.I dentro il ruolo**). Due canali perche' la misura lo ha
imposto: **Modric e De Bruyne sono arrivati a parametro zero**, quindi il solo cartellino dice «nessun
investimento» esattamente sui due nomi da cui l'ipotesi nasce, mentre il loro Qt.I e' al 77 e al 94
percentile. **Gli ingaggi non esistono in nessuna fonte in whitelist** e sono la misura migliore: e' un
limite dichiarato.
Il peso nella selezione e' un **parametro di `engine.presence`, a zero**, e lo sweep l'ha giudicato: **non
adottato**, dettaglio e numeri in [gate 7-quater](gate-motore-v1.md). In breve: il meccanismo e' gia'
assorbito dai **minuti** - lo stesso sweep ha adottato «i minuti sono il predittore della titolarita'» - e
l'unico posto dove resta un segno del verso previsto e' l'arrivo appena comprato, in quarta cifra.

### 2. L'unita' e' la PARTITA, non la giornata (osservazione dell'utente, verificata)
Le partite si rinviano: una giornata puo' giocarsi settimane dopo quella che la segue, e una data puo'
portare partite di una giornata piu' i recuperi di un'altra. Due conseguenze **misurate**:
- **una coppia (giocatore, giornata) NON e' unica**: con un rinvio piu' un trasferimento un uomo gioca la
  stessa giornata per due club diversi, in due date diverse. Serie A 23/24 giornata 21: fc_id 49 con
  l'Udinese il 20/01 e col Torino il 22/02. Dimarco, 19/20 giornata 17: Inter, poi Hellas Verona.
- **la PK di `match_ratings` `(fc_id, season, matchday, platform)` non puo' rappresentarlo**: per quei
  giocatori una presenza si perde in ingestione (i voti hanno 1 riga dove il layer per-partita ne ha 2).
  Oggi zero duplicati nella tabella - che e' esattamente cio' che mostrerebbe una PK che li vieta, quindi
  «non osservati» non e' prova che non capitino. Raro (una manciata di giocatori per stagione) e ora scritto
  invece che invisibile; la cura sarebbe una PK che porta la partita, cioe' migrazione + re-ingest: una
  decisione, non una correzione da infilare.
Quello che cammina su un calendario cammina su **date e match_id**: la finestra dei dieci di `club_form`,
`rounds_missed`, e `fielded_next` - «la prima partita dopo la data d'asta» e' per data e **porta la
giornata**, cosi' un recupero si vede (`2025-08-24 serie_a md1 vs Cagliari (A)`).

## Novita' v9.13 (29 luglio 2026 - un foglio nel passato non prevede: guarda l'undici SCHIERATO)

Decisione dell'utente, e cambia una classe di colonne. Le probabili pubblicate sono poco affidabili e
ragionano con gli **stessi fattori che già misuriamo**; il valore aggiunto arriva **a ridosso del calcio
d'inizio**, con le dichiarazioni dell'allenatore. Quindi: **un foglio su OGGI** le rileva (è la cosa più
recente che esiste, e `snapshot` già fa `refresh`); **un foglio nel PASSATO** non ne ha bisogno, perché per
quel giorno **l'undici schierato esiste**. Un pronostico interessa solo finché l'esito è ignoto.

### 1. Una TERZA classe di colonne, e il prefisso è la garanzia
`actual_next_match` · `actual_next_started` · `actual_next_minutes` (+ `formation_next_fielded` e
`next_match_date` in `clubs.csv`): la prima partita del club **dopo** la data d'asta, con chi è partito
titolare e quanti minuti ha fatto. Sono **misurate DOPO la data d'asta**, quindi non sono `desc_*` e non
sono `engine_*`: sono di **sola rendicontazione** e nessuna regola, nessuna previsione e nessuna colonna
`desc_*` le legge. Il prefisso è ciò che impedisce l'errore vero — versarle in `desc_starter_prob` avrebbe
reso un pronostico e una certezza indistinguibili nella stessa colonna. Vuote per costruzione sul foglio di
oggi: la prossima partita non è stata giocata. Un test verifica che ogni colonna del CSV appartenga a una
delle tre classi.

### 2. Il campetto disegna il fatto, e lo dice
`eleven(mode="next")` ha ora una precedenza dal fatto al pronostico: **undici schierato** (solo foglio
retrodatato) → **probabili** (foglio su oggi) → chi ha giocato ultimamente. La didascalia del modulo dice
`FIELDED on 2025-08-23 - a fact, not a forecast`. Le **alternative** restano nostre: la panchina di quella
partita non è nel layer (che tiene una riga per chi ha giocato), e va detto invece di lasciarlo intendere.

### 3. Due difetti trovati misurando, non rileggendo
- `external_match_stats.match_id` porta **entrambe** le squadre: letto senza il club, un uomo che il listone
  mette al Milan e che quel giorno ha giocato per l'avversario finiva fra i titolari del Milan (**dodici**),
  e Lukaku leggeva «vs SSC Napoli» come avversario del Napoli. Ora la riga vale solo se il club risolto
  coincide, e l'avversario viene dal FIXTURE del suo club.
- Su 21 club, **10 hanno tutti e undici** gli uomini fra le righe del foglio. Il motivo non è il fatto ma il
  **row set**: le rose sono quelle di OGGI (nemmeno la pagina rosa di un giorno passato si può rileggere),
  quindi chi da allora ha cambiato club non c'è — l'undici dell'Inter del 24/08/2025 è completo tranne
  Pavard. È nella nota del run, non nascosto.

### 4. Cosa NON serve più
Il **cron settimanale**: se la rilevazione utile è quella di adesso e il passato ha i fatti, storicizzare le
probabili non serve. `starter_prob` 0/1453 nel gate si legge come «vuoto per scelta». E la granularità per
GIORNO di `valid_from` va bene: quando si vuole sempre «la più recente», sovrascrivere è il comportamento
giusto — l'ora servirebbe solo per tenere una serie, che è esattamente ciò che si è deciso di non tenere.

**257 test verdi, ruff pulito.** Tre fogli rigenerati.

## Novità v9.12 (29 luglio 2026 — `sweep`: i parametri provvisori davanti al gate)

Punto **3** della lista «cosa manca». Il referto completo, con tutti i numeri e i verdetti, sta in
[gate-motore-v1.md §7-ter](gate-motore-v1.md); qui c'è cosa è stato costruito.

### 1. `engine/presence.py`: le formule fuori dalla vista Tk
Le costanti della titolarità vivevano dentro `gui.SnapshotView`, e **un parametro che nessun harness può
raggiungere è un parametro che nessuno può spazzare**. Ora le formule (`at_club_weight`, `availability`,
`contested`, `standing`, `voto_share`, `presence`) stanno in `engine/presence.py` — senza dipendenze come
tutto `engine/`, perché è da lì che il motore TypeScript verrà portato — con i parametri in una dataclass
`Params`. Il pannello costruisce un `presence.Inputs` dalla riga del foglio e chiama le stesse funzioni che
lo sweep giudica: pannello e gate non possono più divergere.
Conseguenza sul foglio: `desc_injury_rounds_by_season` (le giornate saltate per stagione, più recente
prima). Un totale già pesato **congelerebbe** i pesi con cui è stato scritto, e i pesi sono ciò che si sta
spazzando.

### 2. `python -m euroleghe_ingest sweep`
STANDALONE come `backtest`, read-only, scrive `data/reports/sweep_presence.json`. Tre famiglie, ognuna col
suo bersaglio, tutte con lo **stesso** protocollo del gate delle regole (griglie pre-registrate, un
parametro alla volta, cross-fit leave-one-out, verdetti strict e robust affiancati):
- **presenza** (i cinque parametri del foglio + la forma di `contested`): input ricostruiti al giorno d'asta
  di finestre già giocate, bersagli le PRESENZE (`pv`, calendario della piattaforma) e le TITOLARITÀ (le
  giornate del suo campionato in cui è partito, dal layer per-partita — i voti non portano `started`);
- **rigoristi** (decay + quarantena): ogni rigore del DB rigiocato, «chi tira il PROSSIMO?», 1433 rigori
  prevedibili su 7 stagioni;
- **tier d'arrivo** (tre soglie + età U22): la fantamedia realizzata dell'arrivo contro la media del suo
  tier fittata sulle ALTRE stagioni. Proxy dichiarato: un tier non prevede, instrada.

Due cose che il referto separa e che è la ragione per cui esiste: **«confermato» non è «niente trovato»**
(`confirmed` = la scelta fuori campione È il valore nel codice, su ogni fold), e ogni riga porta il
**margine sul secondo classificato**, perché per un valore già adottato il guadagno è 0 per costruzione.

### 3. Esito, in una riga per famiglia
**Adottato**: `STANDING_WEIGHTS` → **(0, 1)**, solo i minuti — strict e robust su tutti e dieci i fold,
+1.55% euro e +1.32% default, fold peggiore +0.70%. Conseguenza misurata sul campetto: **38 giocatori su
907** si muovono più di 5 punti e **10 club su 34** cambiano l'undici disegnato.
**Confermati**: la forma nuova di `contested` (v9.11), `ARRIVAL_DISCOUNT` 0.80, il decay dei rigoristi 0.75.
**Aperti**: `LOAN_DISCOUNT` (platform-dependent: euro tira a 0.2, default a 0.8), l'inclinazione di
`INJURY_WEIGHTS` (la forma a tre stagioni è confermata), `AVAILABILITY_FLOOR` (l'intera griglia vale 0.6%),
la quarantena, e le soglie dei tier — dove `t3_price` passa robust su euro e punta in direzione **opposta**
su default, quindi non si adotta.

### 4. Il bug che lo sweep ha trovato: un rigore di Serie A contato due volte
`fc_site.penalty_events` leggeva `match_ratings` su **entrambe** le piattaforme, e un rigore di Serie A ha
una riga in ciascuna — lo stesso calcio sotto due numerazioni di giornata che traducono alla stessa data.
**387 tuple (stagione, club, data, rigorista) su 1675** comparivano più di una volta; 2089 eventi contro
1745 reali. Con il peso del k-esimo rigore che decade come `DECAY**k`, la serie raddoppiata applicava il
decay **due volte per rigore reale**: la memoria della gerarchia era **metà** per un club italiano che per
uno estero. Alla prima passata lo sweep «bocciava» 0.75 preferendo 0.5 su tutti i fold (√0.5 = 0.707 ≈
0.75); deduplicato per calcio, il minimo torna esattamente su 0.75. `penalty_hierarchy` è riscritta (1745
rigori, 312 club-stagione, 3562 righe datate).

**256 test verdi, ruff pulito.**

## Novità v9.11 (29 luglio 2026 — la quota di una stagione si conta sul CAMPIONATO)

Il punto 2 della lista «cosa manca», che la v9.10 §8 lasciava aperto dichiarandolo tale: cambia ogni
percentuale su ogni maglia, quindi andava fatto di proposito e non dentro una feature di colore.

### 1. Il difetto, e perché era invisibile sui club italiani
I numeratori sono **sempre** di campionato: `external_stats` ha una riga per campionato e nient'altro
(verificato su tutte e 11 le stagioni: solo `serie_a`, `premier_league`, `la_liga`, `bundesliga`,
`ligue_1`). Il denominatore era `complete_XIs`, gli undici parsati in QUALSIASI competizione: Arsenal 58
(38 + 14 Champions + 6 coppe), Bayern 50 (34 + 12 + 4), **Napoli 38 = solo Serie A**. Sui 45 club del
perimetro la quota di campionato va da **66% a 100%**, quindi una titolarità non era confrontabile con
quella accanto: Kane leggeva **49%** con 25 titolarità su 34 giornate di Bundesliga.
Il bias, misurato: correlazione fra la quota di campionato di un club e la titolarità media dei suoi
giocatori **+0.796 prima, −0.172 dopo**. Il residuo negativo non è l'artefatto che resta: le rose più
profonde sono proprio quelle che giocano le coppe.

### 2. Tre correzioni di unità, non una
- `clubs.csv` porta **`league_XIs`** accanto a `complete_XIs`, più `league` (il campionato del club).
  `club_matches()` usa il primo — le giornate del campionato; `complete_XIs` resta perché è il calendario
  su cui una fonte esterna conta le assenze, e serve al fallback.
- **`titolarita`, `propensity` e `at_current_club` filtrano le competizioni di lega in ENTRAMBI i
  percorsi.** Il percorso datato (`--date` a stagione in corso) contava le coppe mentre l'aggregato no: la
  stessa colonna significava due cose diverse a seconda del giorno in cui il foglio veniva costruito, e
  nella stessa riga di Kane `desc_minutes_club` diceva 2994 e `desc_minutes_full_season` 2382.
- La colonna **`%` delle presenze previste** va sul calendario della **piattaforma** (31 giornate euro nel
  25/26, 38 su default), che è quello su cui `engine_pv_pred` è espresso; il manifest lo dichiara
  (`matchdays.platform_target`). Letta contro le 50 partite del Bayern, una previsione di 26,6 presenze su
  31 stampava 53%.

### 3. Le assenze si CONTANO in giornate, non si convertono
Transfermarkt conta le partite saltate su ogni competizione, e quel numero non si può né sottrarre da un
calendario di campionato né dividere per esso. Scalarlo con la quota di lega di ciò che abbiamo parsato
corregge i tedeschi e **lascia intatti gli italiani** (per loro il layer per-partita copre solo la Serie A,
quindi 38/38 = nessuno sconto): 8 giocatori del foglio euro finivano con più assenze che giornate.
Quindi **`rounds_missed()`**: le giornate di campionato del suo club, per data, dentro l'**unione** dei
suoi spell. Nessuna scala, nessun rapporto, confrontabile fra due club per costruzione. Coperti **868 su
907**; i 39 restanti sono stagioni in club fuori dai 5 campionati e `desc_injury_rounds_seasons = 0` dice
«ignoto, non zero» (lì si ripiega sullo scaling, dichiarandolo).
**E questo risponde alla domanda pre-registrata su Transfermarkt** (gate §7-bis, «verificare che una
ricaduta non sia contata due volte»): contare le giornate dentro l'UNIONE non può contarne una due volte,
qualunque cosa elenchi la fonte. Misura: TM 6489 partite contro **4485 giornate contate = 69%**, e sui club
il cui elenco parsato COINCIDE col campionato — gli italiani, dove lo scaling sarebbe 100% — 1465 contro
1079 = **74% ≈ 38/50**, cioè esattamente le coppe e l'Europa che non parsiamo. **Nessuna evidenza di
duplicazione.**

### 4. Il tasso e lo sconto erano lo stesso numero, e si annullavano
`contested`, il denominatore del tasso di titolarità, usava la **previsione a tre stagioni** — la stessa
che `availability` poi moltiplica. Sottrarre e rimoltiplicare la stessa stima **si annulla** quasi
esattamente in `presence`: la storia infortuni era decorativa e funzionava solo attraverso i clamp. Ora
sono due quantità diverse, come devono essere:
- `contested` = giornate del campionato − **`desc_injury_rounds_measured`**, quello che ha davvero saltato
  nella stagione misurata → un fatto sul CAMPIONE;
- `availability` = 1 − (**`rounds_weighted`**/3 stagioni) ÷ giornate → una PREVISIONE.

Esito: giocatori appiattiti sul pavimento `AVAILABILITY_FLOOR` **da 201 su 907 a 9**, `contested` che
collassava alla guardia 1.0 da 14 a 2, **zero** presenze oltre il 100%. Il 201 era il difetto vero:
`availability` divideva per le **presenze del giocatore stesso**, che si accorciano proprio quando è
infortunato (Rrahmani 24,1 assenze su 21 presenze = «1 − 115%»), quindi un terzo del foglio veniva
schiacciato sul pavimento da un denominatore sbagliato e non da una storia clinica.

Casi: Kane 49→**75%**, Haaland 61→**82%**, Saka 28→**62%**, Rrahmani 33→**71%**, Lamine Yamal 41→**77%**,
Van Dijk 76→**100%**. Chi scende è chi era tenuto in piedi dai clamp: Ouedraogo −13%, Teze −10%,
Militao −8%.

⚠️ La FORMA di `contested` (assenze misurate, non previste) è una scelta di **modello**: la possiede il
gate, insieme a `INJURY_WEIGHTS` e `AVAILABILITY_FLOOR` — vedi §7-bis e lo sweep. Quello che è cambiato qui
sono le **unità**, che non sono un'opinione.

**251 test verdi, ruff pulito.** Tre fogli rigenerati.

## Novità v9.10 (29 luglio 2026, notte — la LEGA come parametro del foglio, e la barra a due assi)

Richiesta dell'utente: semplificare l'azione BUILD e la selezione dello snapshot. Chiedendo «servono altro
che *quali squadre* e *quando*?» è venuto fuori che gli assi non erano quelli, e la misura lo dice.

### 1. «Quali squadre» non è un asse: lo è «quali partite contano»
euro e default condividono **9 club** (34 contro 20), e per i **265 giocatori** di quei 9 club **tutte** le
colonne engine cambiano fra i due fogli dello stesso giorno: Dimarco è `fm 6.789 / pv 24.7 / surplus 19.8`
su euro e `6.836 / 30.0 / 30.7` su default. Il perimetro di club è una *conseguenza* della piattaforma, non
la sua definizione. E `game` non è una valuta di visualizzazione: su euro 2026-27, **904 surplus su 916** e
**897 rank su 916** cambiano fra classic e mantra (ancora frazionaria sui ruoli Mantra, `roster_depth` nel
vocabolario del game, `BETA[game]`). Due dimensioni vere, nessuna delle due eliminabile.

### 2. Le tre cose che decidono i numeri sono ciò che una LEGA è
`platform` + `game` + (`teams` x `squad_slots`) — la terza fissa il livello di sostituzione, cioè **lo zero
del surplus**. Erano tre manopole libere del run, mentre sono proprietà della lega in cui si gioca. Quindi
`config/league_config.json` ha ora **`my_leagues`**: una voce per lega giocata, che dichiara i suoi due assi
ed **eredita** dai valori top-level tutto quello che non nomina (una lega che tessera come le altre scrive
solo platform e game). Un file **senza** la chiave si legge come UNA lega chiamata `default`: la forma
precedente continua a funzionare senza toccarla.
⚠️ Attenzione al nome: le `leagues` di `scoring_config.json` sono i **campionati** (serie_a, premier_league,
…), a cui appartiene un GIOCATORE e che hanno il loro bonus/malus. `my_leagues` sono le leghe dell'utente, e
si costruisce **un foglio per lega**. Un foglio euro contiene giocatori di 5 campionati con 5 regolamenti
diversi: è esattamente per questo che il punteggio sta per campionato e non può essere una scelta del foglio.
Il buco che questo chiude: `snapshot` passava `load_league()` qualunque fosse il game, quindi un foglio
euro/mantra poteva essere calcolato con le caselle di una lega di Serie A classic **senza che nulla lo
dicesse** — un ordinamento sbagliato invisibile, perché le colonne si riempiono comunque.

### 3. Provenienza: un foglio dice per quale lega è stato costruito
`manifest.json` porta un blocco **`league`** (nome, `declared`, teams, squad_slots, mantra_slots, esponente,
soglia) e la cartella porta lo **slug della lega**: `auction-snapshot-{stagione}-{piattaforma}-{game}
[-{lega}][-{club}]-{data}`. Senza lo slug due leghe sullo stesso platform+game si sovrascriverebbero a
vicenda pur avendo replacement level diversi. `declared: false` = combinazione che nessuno gioca (il gate
spazza tutt'e quattro): leggibile, ma non spacciata per una lega.
CLI: **`--league NOME`**, che è autorevole — dichiara platform e game, e i due argomenti vengono ignorati,
perché un nome non può significare due fogli. `load_league(nome)` **solleva** su un nome non dichiarato: un
typo che ripiegasse in silenzio darebbe a questo foglio il livello di sostituzione di un'altra lega.

### 4. La barra dello Snapshot: due assi, e Build non chiede più niente
`[Lega ▾] [Quando ▾] [Build] [...] [Delete] [Reload]`. **Build parte subito** con la lega della barra, oggi,
con refresh — nessuna modale, che era la richiesta; `...` apre il dialogo di prima per i casi rari (data
passata, un solo club, season forzata, refresh off) e vi mostra la precedenza invece di nasconderla: scelta
una lega, i selettori platform/game si **disabilitano**. Altri difetti corretti perché li ha rivelati la
riscrittura:
- il combobox elencava i nomi grezzi delle cartelle **ordinati per nome**, quindi all'apertura selezionava
  il massimo lessicografico (un foglio *mantra*) e non l'ultimo costruito. Ora l'etichetta è leggibile
  (`29/07/2026 · 2026-27 (latest)`, `01/03/2026 · 2025-26 · Napoli only`) e si apre sull'ultimo **costruito**;
  due fogli dello stesso giorno portano l'ora (`[built 06:59]`), altrimenti sarebbero indistinguibili.
- la lista mostra gli ultimi 8 per lega con «show all», e i fogli **pre-manifest** (senza blocco `league`)
  vengono archiviati sotto la lega giocata su quel platform+game — corretto, non indovinato: i loro numeri
  vengono dalla stessa configurazione top-level che una lega dichiarata eredita. La nota lo dice comunque
  («this sheet does not state its league»).
- **Delete** cancella un foglio, solo a mano e con conferma che ne nomina cartella, peso e ora di
  costruzione, con guard su `data/reports/` e sul prefisso (è una `rmtree`). Nessun auto-prune: un foglio è
  il **verbale** di cosa diceva il motore quel giorno (`generated_at`, `rules`, `params_from`), e
  ricostruire la stessa data dopo un rifit dà numeri diversi — legittimamente. Lo spazio non è comunque il
  problema: **868 KB** un foglio euro, 516 default, 37 KB uno per singolo club.
- la progressbar faceva `pack`/`pack_forget` e spostava tutto ciò che le stava a destra: ora vive in uno
  slot a larghezza fissa, con la riga di stato a larghezza fissa in caratteri.
- il pannello **Auction** leggeva `load_league()` (la prima lega) per qualunque platform/game: ora risolve
  per platform+game e la didascalia **nomina** la lega di cui sta mostrando il livello di sostituzione.

### 5. Gestione delle leghe dal pannello
`Lega > Manage leagues...`: una riga per lega (nome, platform, game, teams, P/D/C/A), tutto visibile insieme
— senza stato di selezione, così non si digita in un campo che poi appartiene alla riga da cui ti sei
spostato. Salva riscrivendo **solo** `my_leagues`: i blocchi `_comment`/`_note` del file sono parte della
knowledge base e restano dove sono, e un valore uguale al default del file resta **ereditato** invece di
essere copiato in ogni voce. Il dialogo avverte che il file è tracciato da git e la repo è pubblica, quindi
il nome di una lega si pubblica col commit successivo.

### 6. Più di un ballottaggio sul campetto (richiesta dell'utente)
Il dato portava già due rivali per maglia, **il disegno ne mostrava uno** («One rival is named, not two»).
Misura su euro 2026-27, 34 club x 2 modi = 602 targhette: **317 maglie hanno più di un rivale** e prima
nessuna lo diceva. Ora la targhetta mostra **tutti i nomi, tagliati alla stessa lunghezza** finché ne
sopravvivono almeno 5 caratteri (`vs Calaf/Mosqu`, `vs Nwaneri · Dowman`), altrimenti il primo nome e il
**conteggio** degli altri (`vs Nwane +1`): 176 targhette con tutti i nomi, 141 con nome+conteggio, **0 che
nascondono un rivale**. Il vincolo è orizzontale e resta: una maglia possiede al massimo 150 px.
- **Recuperato un quinto della larghezza**: il budget della riga rivali era calcolato con la costante del
  font **grassetto** del nome (7.2 px/carattere) mentre quella riga usa il font piccolo. Ora la larghezza
  del carattere è **misurata** (`char_width`, 6.67 px) invece che assunta → le targhette con tutti i nomi
  passano da 81 a 176.
- **Click sulla maglia = il ballottaggio completo** (stesso idioma della striscia TREND): ogni rivale con
  la sua quota di giornate e i suoi ruoli reali, più il ballottaggio **dichiarato** dai probabili accanto a
  quello **posizionale** che deduciamo noi — mai fusi. E soprattutto **rende conto dei nomi dichiarati che
  la maglia non offre**, con il motivo verificabile: su tutte le maglie di tutti i club, **208** casi sono
  «in the XI» (un rivale per definizione non è in campo: il terzo uomo di De Roon è titolare altrove) e 10
  «drawn in <linea>». Zero casi senza spiegazione. Senza questo, «dichiarato con tre» sopra una tabella di
  due righe si legge come una contraddizione.
- **Due difetti trovati misurando, non rileggendo.** `duels()` scriveva `names: "; ".join(rivals[:3])`
  mentre `rivals` è un conteggio esatto: 6 uomini del foglio euro leggevano «4 rivali» accanto a tre nomi,
  senza che nulla dicesse quale mancava. Il tetto era del DATO e non ci va — quanti se ne possono DISEGNARE
  è affare del campetto. E, introdotto da me in questa stessa sessione: l'attributo `self._declared` (le
  leghe dichiarate) **oscurava il metodo** `_declared` (l'undici dichiarato), quindi ogni undici «prossima
  giornata» sollevava `TypeError` mentre lo «schieramento tipo» continuava a funzionare. Rinominato
  `_my_leagues`, con un test che chiama `eleven(..., 'next')` perché nessuno lo faceva.

### 7. Ballottaggi impilati, e il modulo tipo che vira quando i ruoli non ci sono
Richiesta dell'utente, con un'osservazione che era un difetto vero: «nel Napoli come esterno destro di
centrocampo c'è solo Mazzocchi con una bassa %, è più probabile un 4-3-3». Riprodotto: col 3-4-3 misurato
(che il foglio stesso dice essere **del predecessore**, 0 XI su 38 con Allegri) il centrocampo a quattro
chiedeva un esterno destro e lo dava a **Mazzocchi al 5%**.

- **La targhetta impila i rivali**, uno per riga, ordinati per titolarità decrescente e con la loro
  percentuale accanto — un ballottaggio è una *classifica* e una classifica ha bisogno del numero. Massimo
  due, e non per gusto: è un budget VERTICALE (una riga ~13px, una targhetta sta fra due linee distanti
  ~94px, e una corsia affollata alterna le targhette sopra e sotto i marker). `plate_rivals_for` lo
  **deriva** dalla geometria invece di tararlo sui dati di oggi; il resto è contato (`+1`) e nominato nel
  **tooltip** della maglia. Verificato su 34 club x 2 modi: **0 sovrapposizioni, 0 targhette fuori dal
  campo, 0 righe su 1687 che escono dalla propria targhetta**, e il margine verticale peggiore passa da
  **1px a 9px** (banda delle linee allargata, più il clamp verticale che mancava).
- **Larghezze misurate, non assunte**: la costante 7.2 px/carattere era del grassetto; il font piccolo
  misura **6.67** e il grassetto **7.75**. Ogni riga ora chiede al font la sua larghezza (`char_width`).
- **Il modulo tipo vira**: `board_shape` sceglie fra i moduli che il club **ha davvero schierato**
  (`formation_shapes`, nuova colonna di `clubs.csv` — una formazione che nessuno ha messo in campo non è
  un'alternativa, è un'invenzione) quello il cui undici somma più giornate, con un margine che dipende da
  quanto vale il modale: `SHAPE_MARGIN_SETTLED` 0.60 per un'abitudine, 0.30 per un allenatore che sta
  scegliendo, `SHAPE_MARGIN_PREDECESSOR` **0.15** quando gli XI del tecnico attuale sono **zero** (segnale
  ora strutturato: `formation_typical_under_coach`, prima solo in prosa). Esito: **13 club su 34** virano,
  Napoli 3-4-3 → 4-5-1, e la didascalia dice quale e perché. Inter (3-5-2, 42 XI su 44) non si muove.
- **Tre difetti trovati misurando, tutti «ragiona coi ruoli reali»** — la regola era applicata a metà:
  1. l'**eleggibilità** di linea leggeva solo il codice PRIMARIO: Spinazzola è `ML;DL`, competeva solo con
     i mediani, perdeva al 54% e il terzino sinistro del Napoli diventava un uomo al 38%;
  2. il terzo termine di **`slot_cost`** (distanza di linea) leggeva anch'esso solo il primario e gli
     addebitava **7 passi** per uno slot difensivo, mentre il termine sulla fascia leggeva già tutti i
     codici — due letture diverse della stessa cosa nella stessa funzione;
  3. il **disegno** (`lanes_for`) e la **pillola** (`badge`) facevano lo stesso: scelto come terzino,
     Spinazzola veniva disegnato fra i centrocampisti e marcato `Es`, mentre Gutierrez in mezzo leggeva
     `Ts`. Ora la linea in cui è stato scelto decide quale dei suoi codici viene disegnato ed etichettato.
  Effetto aggregato su 34 club: somma delle presenze degli undici da **189.3 a 193.0**, maglie sotto il
  20% da 28 a 24, e il modulo disegnato coincide con quello scelto in 31 club su 34 (i 3 restanti sono la
  corsia dei trequartisti che spezza una linea, che è voluto).
- E `duels()` non tronca più i nomi a tre (`rivals[:3]`): 6 uomini leggevano «4 rivali» accanto a tre nomi.
- **Il modulo si può SCEGLIERE, con la sua probabilità** (richiesta dell'utente, in due passi): seconda
  riga sopra il campetto, `modulo [...]`, **un solo numero per forma** = quanto è probabile che quella
  squadra si schieri così. Napoli: `4-5-1 40% · 3-4-3 26% · 3-5-2 12% · 4-3-3 11% · 4-4-2 8% → 4-5-1 ·
  5-3-2 2% · 5-4-1 2%`. Inter: `3-5-2 92%`. Il caso che lo rende necessario non è il Napoli ma
  l'**Arsenal**: 4-5-1 e 4-3-3 **28 XI ciascuno**, dove nessuna misura può decidere.
  `shape_odds` mescola le tre cose che decidono, e nessuna basta da sola: quanto **quel club** schiera
  quella forma; quanto la schiera **la lega** (perché un allenatore può provare un modulo nuovo per quella
  squadra, e perché una storia che appartiene al PREDECESSORE descrive una squadra che non esiste più —
  `SHAPE_TRUST_*` pesa le due, e il peso si muove con la quota di undici che sono del tecnico attuale); e
  se la **rosa** riesce a coprirla, cioè quante giornate somma l'undici che ciascuna schiera
  (`SHAPE_FIT_SCALE` = quante giornate di scarto dimezzano le probabilità). È una **stima di display**, non
  gatata e non letta dal motore: serve a ordinare le forme fra cui un umano sta scegliendo. Con questo la
  scala di margini (`SHAPE_MARGIN*`, tre costanti) **è stata rimossa**: la board disegna semplicemente
  l'argmax, e il numero che decide è lo stesso che l'utente legge. Esito: 7 club su 34 hanno un modulo più
  probabile diverso dal misurato (era 13 con i margini: la stima è più conservativa perché la frequenza
  del club conta anche quando la rosa preferisce altro), e 7 club hanno una forma sopra l'80%.
  `<1%` invece di `0%` per i moduli offerti ma remoti: sono in lista perché sono possibili.
  La scelta manuale è per club, sopravvive alla navigazione, e la didascalia dice «your choice» con la sua
  probabilità, così scegliere il modulo meno probabile resta visibile. **Bloccato al 100%** in «prossima
  giornata» quando i probabili nominano un modulo: quella è la risposta dell'allenatore per quella partita.

### 8. I top player, e un difetto che è saltato fuori misurandoli
Richiesta dell'utente: evidenziare i top player di ogni squadra (massimo 3) **invertendo i colori** del
cerchio col ruolo — titolarità alta, surplus alto, minutaggio alto, «tutti i valori più che positivi e
ballottaggio quasi nullo». Fatto come **congiunzione** e non come punteggio: un surplus enorme non compra
il posto a chi gioca metà delle partite, e una certezza che non vale niente non è un top player. Esito su
euro 2026-27: **26 evidenziati su 34 club** (13 club nessuno, 16 uno, 5 due, 0 tre — il tetto è una
sicurezza, non un obiettivo), e i nomi sono Kane, Haaland, Van Dijk, Vinicius, Bruno Fernandes, Maignan,
Dimarco, McTominay+Hojlund, Raya, Svilar, Carnesecchi.

**Il criterio non è la titolarità ma i MINUTI, per partita e sulle sole partite di lega** (correzione
dell'utente: «piuttosto che la titolarità, è importante che un top giochi sempre un numero buono di minuti a
partita»). Letto dal dettaglio per-partita (`desc_form_detail`, che porta la competizione): **≥70 minuti nel
≥70% delle sue ultime partite di LEGA**, minimo 4 partite. Una media non basterebbe: 60 minuti di media sono
lo stesso numero per chi finisce ogni partita al 70' e per chi alterna 90 e 20, e solo il primo è un top.
Le coppe restano fuori perché non è lì che si segna la fantamedia. Le altre due condizioni: surplus ≥ **p90
del foglio** (5.5 qui) — è l'unica soglia league-wide, ed è un percentile perché il surplus è misurato
contro un replacement level che dipende dalla rosa di lega — e **primo rivale sotto il 60%** della sua
titolarità (un rapporto fra due uomini dello STESSO club, quindi il denominatore si annulla).

**Il difetto trovato per strada, e riguarda un numero che sta su OGNI maglia.** La prima versione usava
soglie assolute su titolarità e minuti-per-partita-del-club, e non evidenziava nessuno a Bayern, City,
Inter, Arsenal. Non era severità: Kane legge **49%** di titolarità e Haaland **61%** perché il denominatore
di `presence` è `club_matches` = gli undici del club che abbiamo parsato, e il mix di competizioni **cambia
da club a club**: Arsenal 58 = 38 di Premier + 14 di Champions + 6 di coppe, Bayern 50, City 52, Inter 44,
**Napoli 38 = solo Serie A** (per le italiane il per-match layer copre il campionato). Quindi la titolarità
mostrata sulle maglie **non è confrontabile fra club**: chi gioca più coppe legge meno. Passare ai minuti
per partita di lega chiude il problema per questo criterio — è il motivo per cui la correzione dell'utente
è anche la risposta tecnica giusta, non solo quella calcistica.
⚠️ **Il difetto resta aperto**: `club_matches` va contato sulle partite della COMPETIZIONE che definisce il
calendario della piattaforma (la lega), non su tutte quelle del club. È una correzione che cambia ogni
percentuale su ogni maglia e la somma-giornate su cui poggiano le probabilità dei moduli, quindi va fatta
di proposito e non dentro una feature di colore.

**245 test verdi, ruff pulito.** Verifica A/B: con e senza `--league`, sui 904 giocatori condivisi
`engine_fm_pred`, `engine_replacement_fm` e `engine_anchor` sono **identici** — la plumbing della lega non
ha toccato la valutazione.

## Novità v9.9 (29 luglio 2026, sera — prestito vs acquisto, e la linea che sapeva solo la fascia)

I tre punti minori aperti, e due difetti che sono emersi misurandoli.

### 1. Prestito contro acquisto: due sconti, e la differenza è MISURATA
Nessuna fonte nostra marca un prestito: `arrivals.type` conosce solo new/transfer_cross_league/
transfer_intra_league, `transfers_history.fee` è NULL per un transfer gratuito **e** per un prestito (1367
righe su 2067) e non copre affatto la finestra che si sta prezzando (0 righe dopo il 2026-06-01). La storia
delle rose invece lo dice: **`snapshot.previously_at_club`** = l'ultima stagione precedente in cui il
listone di QUESTO club lo aveva già (`desc_at_club_before`). Marin R. era del Napoli nel 24/25 e del
Villarreal nel 25/26 → il Napoli lo ha avuto e lo ha mandato via; Gila è stato della Lazio per quattro
stagioni ed è del Milan adesso → il Milan non lo ha mai giudicato.
Quindi due costanti, perché le ragioni per scontare sono due e non sempre valgono entrambe: **`LOAN_DISCOUNT
= 0.60`** (misurato altrove **e** mandato via da qui) e **`ARRIVAL_DISCOUNT = 0.80`** (solo misurato
altrove). Su euro: 145 scontati, **69 già stati qui** (Rashford, Jackson, Nelson, Cheddira) e **76 mai
stati qui**. Entrambe provvisorie, entrambe scelte di modello → le possiede il gate.

### 2. Uno slot sa la sua LINEA, non solo la sua fascia
La richiesta era distinguere, in un centrocampo a 5, quale fascia è dell'ala e quale del terzino. Misurando
sono venuti fuori due difetti che la rendevano impossibile:
- **il badge prendeva la fascia dal codice del giocatore e non dallo slot in cui è disegnato**: l'Inter
  leggeva `Es` **due volte** nel suo 3-5-2, perché Carlos Augusto è mancino di codice e gioca esterno
  destro. Ora, quando lo slot contraddice il codice, la fascia è quella dello slot (`MIRROR`): il ruolo
  resta suo, la fascia è della maglia. Un ruolo centrale non cambia mai.
- **una linea senza uomini propri lasciava la maglia VUOTA**: il 4-5-1 del Bayern aveva quattro
  centrocampisti in corsia M e disegnava **dieci** uomini chiamandolo 4-4-1, con ali e trequartisti fuori
  dagli undici. Ora la maglia va al resto della rosa, e con due regole trovate rompendole: una linea presta
  **solo il suo surplus** (servite in ordine, una difesa senza uomini si mangiava gli attaccanti e
  l'attacco restava vuoto) e presta **dalla panchina, mai la prima scelta**.
- e qui il punto vero: con il prestito fra linee attivo, `slot_cost` sapeva solo la fascia, quindi il
  quinto centrocampista del Bayern è diventato un **centrale difensivo**. Aggiunto un terzo termine,
  **`LANE_DEPTH`**, la distanza fra la profondità della LINEA e quella del suo codice sulla stessa griglia
  0..1 di `REAL_ROLE_DEPTH`: ultimo nella tupla, quindi separa solo chi le regole di fascia lasciano pari —
  fra due che possono fare quella fascia, il centrocampo prende quello la cui linea è più vicina (un'ala è
  a un passo, un centrale difensivo a due). Esito: **0 undici incompleti** su 34 club x 2 modi (era il
  Bayern a 10), e il Bayern si disegna 4-4-2 mentre i conteggi di linea dicono 4-5-1 — entrambi veri, e la
  didascalia porta entrambi.

### 3. Top-up infortuni: già completo
Il punto operativo era stantio. **3273 id Transfermarkt, 3273 pagine in cache, 0 mai visitate**: il walk è
finito. I 94 giocatori di rosa senza righe in `injuries` sono «visitati e puliti», e il foglio lo dice già
(`desc_injury_source` = «transfermarkt (no absence recorded)»), che è diverso da «nessun id: ignoto».

**232 test verdi, ruff pulito.**

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
Fuori dalla pipeline, perché non producono tabelle di ingestione: **`bootstrap`** (acquisizione da zero), `fetch` (referto + inbox), `rebuild`, `backtest` (harness del gate sulle REGOLE), **`sweep`** (l'altra metà del gate: le COSTANTI provvisorie), **`export`** (bundle dell'app).
Stato implementazione **v9.14**: **tutti i moduli operativi tranne `fbref`** (bloccato da Cloudflare: servirebbe un browser headless, oppure l'inbox manuale). Chiusi in v9.4: `injuries` + `contract_until`/`exit_risk`, heatmap `avg_x/avg_y`, `elo` via API, `ingest_runs`, `fetch --plan/--inbox`, `bootstrap`, `export`. **259 test verdi, ruff pulito.**

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
python -m euroleghe_ingest sweep                           # gate delle COSTANTI provvisorie (§7-ter)
python -m euroleghe_ingest sweep --platform euro           # una piattaforma sola, o --window per una finestra
```
Tutto è ripartibile (la cache grezza è la fonte di verità) e interrompibile; `rebuild` ri-ingerisce
offline. Ogni run lascia una riga in `ingest_runs`. Settimanale e **non recuperabile a posteriori**:
`pwsh scripts/weekly-snapshot.ps1 -Register` (le probabili sono uno stato di oggi). ⛔ **SUPERATO il 05/08/2026**: nessun job, decisione dell'operatore (vedi il blocco in cima).

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
  0/1453 su T2/euro, perché le probabili sono uno stato di oggi. **Dal 29/07/2026 quella riga si legge come
  "vuota per scelta"** e non come un buco da colmare: vedi la decisione sulle probabili in
  `stato-progetto-continuita-v5.md`, sessione «(7)». Nessuna regola d'asta la sta aspettando.

## Quello che manca per l'asta 26/27 (aggiornato v9.14)
- **Offline, ed è il prossimo passo**: il **valore di mercato Transfermarkt** è già in cache (561 pagine
  rosa, 51 club × 11 stagioni) e non è ancora parsato. È il proxy giusto per l'ipotesi investimento (gate
  §7-quater) e abilita la quota del valore della rosa. Gli **ingaggi non esistono** in whitelist.
- **Da rilanciare prima dell'asta**: `transfers` (i cartellini dell'estate 2026 non ci sono).

## Quello che mancava per l'asta 26/27 (aggiornato v9.4)
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
