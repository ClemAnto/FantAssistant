# Todolist — Allineamento Mantra & EuroLeghe (v5)

## Aperti alla chiusura del 7 agosto 2026 (notte) — nessuno con scadenza

Ordinati per COSTO, non per importanza: prima ciò che non dipende da noi, poi il lavoro misurato, poi le
decisioni. I quattro difetti del pomeriggio sono chiusi (spec «Novità v9.32» e «v9.33») e i due della notte
pure (spec «Novità v9.34»): il SURPLUS mantra che era il VALORE, e `club_elo` fermo a un anno prima dell'asta.

**A. Fonti giù, e va riprovato prima di ogni sessione**
- **Transfermarkt: timeout totale** (curl 28, 0 byte, riprodotto a mano fuori dal modulo) → `contract_until`,
  `market_values` e gli infortuni sono fermi al **29/07**, e il walk per giocatore non riparte. Vedi il
  punto 2 sotto: il modulo deve anche DIRLO.
- **ClubElo: read timeout, riprovato alla chiusura del 07/08 e ancora giù** (25 s, zero byte). La *causa* per
  cui la finestra 2026-27 leggeva uno snapshot vecchio di una stagione è però risolta nel codice
  (`elo.auction_dates` non chiede più una data futura): appena l'host risponde basta rilanciare **`elo`** e la
  serie si allinea da sola. Finché non risponde, `desc_level_elo` e il modello dei portieri leggono
  `2025-08-15`, e questo va detto a chi guarda il foglio.
- **FBref: 403** anche impersonando. Fuori dalla catena di oggi.

**B. Coda di lavoro, misurata il 07/08 — è tutto ripartibile**
- **`recent_form`: 803 giocatori** su tutte le stagioni (2018-19 ne ha 256 da solo; il 2026-27 ne ha 31, e
  sono NUOVI perché la coda ora calcola le mediane per listone e ne fa l'unione). ~2 minuti a testa: è una
  notte. Un solo match senza bonus.
- **`positions --layer season`** non rigirato il 07/08 (~90 richieste, aggregati che si muovono poco).
- **`sweep_presence.json` è scaduto in UN blocco**: il braccio **tier** legge i pool di percentili, che con
  la v9.33 sono per piattaforma. Le costanti no.
- **`backtest --gate`** non rigirato dopo la v9.33: le adottate non leggono il prezzo (`--verify` 22/22 lo
  conferma), ma R12/R12b — falsificate — avrebbero cifre diverse.

**C. Il pezzo grosso che non è iniziato**
- **`app/` è un README e ZERO file TypeScript.** Il contratto dati è pronto e verificato (bundle 24 tabelle,
  361.320 righe, `sheet_revision` **6**): manca il porting del motore da `engine/`.

**D. Chiuso senza misurare, e da non riaprire senza un motivo nuovo**
- **Football Manager come fonte: valutato il 07/08 e scartato** (BRIDGE, blocco «7/08/2026 notte, 2»). Non è
  un verdetto di gate — non è stato misurato nulla — ma le due ragioni non dipendono dalla qualità del dato e
  non cambiano da sole: **FM non contiene partite** (entità e struttura, mai eventi: il gioco i risultati li
  simula) e il suo database più fresco **precede il mercato estivo**, con FM25 cancellato che apre un buco su
  2024-25. Quello che avrebbe di non ridondante — ruolo granulare datato, scadenza contratto storica, injury
  proneness — è tutto **giudizio**, quindi ultimo per la regola del 04/08. Il censimento dei canali di
  estrazione è nel BRIDGE, così non va rifatto. Riaprirlo ha senso solo se cambia una di queste due cose:
  serve un fatto che **solo** FM ha (finanze di club, regole di tesseramento), oppure si accetta di pagare
  gioco + licenza per un canale di opinioni.

0. ~~**LA QUOTAZIONE NON HA UNA PIATTAFORMA**~~ — **FATTO il 07/08/2026** (spec «Novità v9.33»):
   `listone_quotes` con `platform` nella chiave, `fvm_history` e `arrivals` allargati, backfill di tutta la
   storia dalla cache (16.375 righe). Resta da sapere una cosa sola, e solo se qualcuno vorrà rifare il
   gate: i numeri del **§7-sexies** (tier `measured_first` contro la quotazione) sono stati misurati sul
   pool MESCOLATO, quindi un ri-run oggi darebbe cifre diverse — la conclusione ha una ragione che non
   dipende dal pool («la strada è allargare ciò che è misurato»), ma le cifre sì.
0-bis. **Le probabili EuroLeghe esistono ma sono vuote** (07/08): `probabili_euro` / `indisponibili_euro`
   sono ora catturate ogni giorno e oggi rispondono 200 con zero link giocatore. Quando si riempiranno va
   verificato che il markup sia lo stesso (il parser è condiviso) — e ricordare il giudizio dell'operatore:
   sono **poco affidabili**, quindi restano `desc_*`. Per la formazione settimanale la sua indicazione è
   un'altra: ricerca giocatore per giocatore su stampa locale/nazionale, vicina al calcio d'inizio, salvata
   datata **con l'ora** (due letture nello stesso giorno si sovrascrivono) e con la fonte per affermazione.
1. **`window_standing` non è scoreabile**: lo sweep non ricostruisce la finestra di forma per una stagione
   passata, quindi il gate §7-octies è fermo per un'OMISSIONE dichiarata (`KNOWN_GAPS` nel test degli
   allineamenti) e non per una decisione. Sbloccarlo vuol dire ricostruire quella finestra da
   `external_match_stats`.
2. **Transfermarkt non serve più le pagine rosa, e in silenzio**: `injuries.fetch_squads` scrive dentro un
   `if html:`, quindi una richiesta respinta non lascia né file né messaggio. La data resta al 29/07 mentre
   sofascore e appearances sono al 06/08. Va fatto parlare. **Diagnosi del 07/08**: non è un 403, è un
   **timeout totale** (curl 28, 0 byte ricevuti, riprodotto a mano fuori dal modulo), e nella stessa
   condizione **ClubElo** non risponde — quindi la data d'asta 2026-08-15 non esiste in `club_elo`. Il run
   `injuries --layer ids --refresh` di ieri è registrato `ok` avendo scaricato **zero** pagine: un modulo di
   rete che non scarica niente deve dirlo e finire diversamente da uno che ha lavorato.
3. **R18 non è su `default`, R19 non è su `euro`**: le piattaforme si comportano diversamente e ogni
   conclusione su questi due canali va detta al plurale.
4. **L'assistente d'asta è progetto e non codice** (`assistente-asta-v1.md`), calendario facile incluso
   (`EASY_MARGIN` / `HOME_ADVANTAGE`, zero occorrenze nei sorgenti).
5. **Cinque cartelle di snapshot sono sparite** durante la sessione del 06/08 e nel toolkit non c'è nulla
   che cancelli cartelle. Se non è stato l'operatore dal pannello, va capito.

**Progetto:** App EuroLega Fantacalcio · **Rif.:** modello-previsionale v3.8 · **Aggiornata: 5 agosto 2026**
Convenzione: [ ] da fare · [x] fatto · [!] bloccato · *Sigle: fc_id = id fantacalcio.it · FM = fantamedia · T1/T2 = finestre di test 23/24->24/25 e 24/25->25/26 · 2.5 pieno = backtest motore completo con flag.*

## FASE 0 — Fattibilita' [x] (21/7)
Invariata (storico 9 stagioni, endpoint Excel, fallback SofaScore, scala ricalibrata, ruoli Mantra). Rif: dataset-euroleghe-README.md.

## FASE 2 — Mantra core [x] salvo 2.5 pieno (21/7)
- [x] 2.1 Ancore Mantra frazionarie + BETA 0.42 -> ancore-mantra-fase2_1.md
- [x] 2.2 Portieri M2e (decomposto + ClubElo; gate -25%/-20%) -> modulo-portieri-fase2_2.md, clubelo-gate.md
- [x] 2.3 FM per ruolo posseduto + rank + flessibilita' (fuori FM) -> fm-per-ruolo-fase2_3-2_4.md
- [x] 2.4 Cambi ruolo = cambi d'ancora ASIMMETRICI -> idem
- [x] 2.5-lite backtest core (Mantra non-inferiore a Classic) -> backtest-mantra-fase2_5lite.md
> ⚠️ Stato corrente: `00-BRIDGE-punto-di-ingresso.md`, blocco «STATO AL 5 AGOSTO 2026». Set
> adottati **euro R0c+R3c · Serie A R3+R7+R13** su **10 finestre (Serie A) e 5 (euro)**; R4, R10 e R8 sono
> cadute quando le finestre sono diventate dieci, e **tutte le dieci candidate del 28/07** (R17 compresa)
> sono cadute.

- [x] **2.5 pieno (con flag) — ESEGUITO il 27/07**: 17 ipotesi passate dal gate, **6 adottate**
  (euro R0c+R3c+R7+R10 · Serie A R3+R7+R13), 12 falsificate con motivo registrato. Rigirato la sera
  stessa su **4 finestre (euro) e 7 (Serie A)** dopo aver scoperto che l'API dei voti arriva almeno al
  2015-16: R4 esce, R10 rafforzata (§3-ter), e **R7 confermata 7/7 su Serie A** una volta messo in
  comune il coefficiente fra le finestre invece di prenderlo dalla vicina (§3-quater). Esito completo,
  protocollo e numeri per ruolo in **`gate-motore-v1.md`**. Le ipotesi set-pieces pre-registrate:
  `penalty_ev` in forma ridotta **bocciata**, `set_piece_duty` **non misurabile**
  (`assists_set_piece` NULL su tutte le righe di voti).

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
- [x] **v9.4 (28/07 sera-notte) — IL TOOLKIT È COMPLETO** (spec «Novità v9.4», `toolkit/README.md`):
  `injuries` (Transfermarkt: assenze datate, `matches_missed`, `contract_until`/`exit_risk` — ⚠️ la
  scadenza contratto esiste **solo per oggi**, quindi `exit_risk` non è gatabile sul passato) ·
  **heatmap** → `positions.avg_x/avg_y` · **cross-tab ruoli** (D→D **97%**, M→C 80%, F→A 80%, G→P 100%:
  estendere i conteggi ai difensori è pulito) · `ingest_runs` finalmente scritta · `config.SEASONS`
  fonte unica · job settimanale `scripts/weekly-snapshot.ps1`.
- [x] **v9.4 — `export`: il bundle dell'app**. 229 116 righe, 29 MB SQLite + 2,5 MB JSON, 21 tabelle,
  contratto **derivato da `engine/features.py`**, manifest con provenienza / prezzi auction-safe /
  parametri provvisori / buchi noti, e `--verify` che ri-apre quello che ha scritto.
  `data/export/` è gitignored (repo pubblico).
- [x] **v9.4 — ricostruibile da ZERO su un'altra macchina**: `bootstrap --plan` (15 passi, ~17 h,
  ripartibile, rifiuta di partire senza credenziali) · `elo` dall'**API ClubElo** (76 righe/2 date →
  **921/10 date, 99 club**) · lega del club derivata dalla cache provider · `fetch --plan` (cosa manca)
  e `--inbox` · `.env.example`.
- [x] **v9.4 — UI rifatta**: `ui_theme.py` (palette light/dark, icone, scala tipografica), card per
  cadenza, metriche, log colorato, status bar con l'ultimo run; pulsanti Bootstrap / What is missing? /
  Export. Pillole ruolo e celle-stato **non** tematizzate di proposito (sono codifiche di dato).
- [x] **positions** (SofaScore): aggregati stagione + rating per-partita (87k righe, 5 leghe x 3 stagioni) + **ruolo reale dal layer per-partita** (100% di copertura, 312 flag off_role_usage) + date di nascita (1861 giocatori). Manca solo la heatmap per `avg_x/avg_y`.
- [x] **voto sintetico calibrato** (`synth`): retta per ruolo sul Mv euro; MAE **0.370 fuori campione** vs 0.466 baseline, bias -0.065.
- [x] **matchday_map** per lega (449 righe) + griglia sul calendario reale con le giornate sintetiche evidenziate. Cross-check: la mappa da SofaScore concorda **29/29** con quella dai nostri voti.
- [x] **fc_site**: probabili (442, fc_id esatto dagli href) · indisponibili (151/152) · **gerarchia rigoristi RIVELATA** dai nostri voti (918 rigori -> 1463 righe datate), perche' la pagina ufficiale dice ancora "dati non disponibili". Snapshot datati in cache, rigiocati dal rebuild.
- [x] **transfers** (Transfermarkt): 46 club in club_xref · 2273 spell allenatori -> **1491 flag new_coach** · 1919 trasferimenti con cifre.
- [x] **tournaments** (SofaScore, non Wikidata: le formazioni dicono chi ha GIOCATO e quanto): Mondiale 2026, 346 giocatori del perimetro, 95 425 minuti -> flag post_torneo su 2026-27.
- [x] **arrivals completato**: tier T1=57/T2=660/T3=673 + FM-equivalente estera su 656 (scarto medio **+0.035** dalla FM euro reale dove confrontabile).
- [x] **HARNESS DEL GATE** (`engine/` + `backtest`): riproduce **22/22** numeri (4/08/2026; era 15/18). I
      tre che mancavano erano tutti del modulo presenze su T1, e la causa è la **data**: il documento che li
      pubblica è del 22 luglio, `platform` è entrata il 25-26, quindi erano misurati su un dataset che
      mescolava i due calendari («34 vs 38 giornate»). La conclusione era data al **singolare** su una
      quantità dipendente dalla piattaforma: su `default` il modulo batte il naive su entrambe le finestre
      (−5.2% / −2.9%), su `euro` solo su T2. Il criterio di adozione — il **bias**, da 4-6 giornate fantasma
      a ~0 — si riproduce su tutto. I check sul Pv sono ora **controlli di regressione** e non test sul
      segno, ed è stato aggiunto il MAE del segmento **titolari**, che il documento citava e nessuno
      verificava. Dettaglio: `presenze-attese-v1.md` blocco «RIMISURATO». E' il riferimento da cui portare il motore TypeScript.
- [ ] 1.4 Storico 2017-2023 (ri-test baseline multi-stagione e Bundesliga+; curve eta').

## PRE-REGISTRAZIONI (verifica giugno 2027, senza ritaratura)
arrivo_intra_lega · regola U22 · Bundesliga+ · beta attacco alto/difesa bassa · ancora pc con recenza · correttivo elite condizionale · ancora B dedicata · **penalty_ev** · **set_piece_duty (solo upside)**

## RESPINTE dal gate (non riproporre senza nuove finestre)
beta per gruppo di ruolo · baseline multi-stagione 62/38 · ancore per lega · **FAMIGLIA FORZA-CLUB: CHIUSA il 28/07/2026** (forza-club interna statica · Elo additivo movimento · R5 · R5b) — riapribile solo con una misura *prospettica*, non con nuove finestre: `gate-motore-v1.md` §5-nonies ·
**AFFOLLAMENTO DEL REPARTO: cinque forme, cinque no** (R11 arrivi nello stesso ruolo · R11b · R16 con la propria quota · R16b con quella dei compagni · **R17 con i posti realmente schierati**, 28/07 notte). Il coefficiente esce col segno dell'ipotesi e stabile — il meccanismo esiste **dentro** la stagione e **non si trasferisce**. Sul lato d'asta la stessa idea è stata misurata come valuta di ordinamento e nasce spenta: `metrica-asta-surplus-v1.md` §11

- [x] **v9.5 (28/07 notte) — SNAPSHOT D'ASTA** (richiesta dell'utente): `snapshot` + tasto nel
  pannello. Scelti piattaforma e game, aggiorna le probabili di oggi e scrive un foglio per giocatore
  (1453) e uno per club (46). Header diviso: **`engine_*` gatato** (FM, presenze, VALORE, SURPLUS, rank)
  chiamando `engine/`, **`desc_*` descrittivo e NON gatato** (forma ultime 10, minutaggio presunto,
  ballottaggi, propensione infortuni, rigorista, bonus per 90, correttezza, contratto/exit risk).
  Dichiarato non misurabile: rapporto con la società (solo proxy), piazzati oltre i rigori, idee
  dell'allenatore. Data d'asta `min(15 agosto, oggi)`; se i parametri vengono dalla stagione bersaglio
  il manifest scrive **DRY RUN**.

- [x] **v9.6 (28/07 notte) — precisazioni sullo snapshot + VISTA**: `squad_snapshot` (rose reali, ogni
  fonte datata con la propria data) e `features.load(squad_source='real')` → il foglio funziona **senza
  listone** (26/27: 890 giocatori, 34 club, prezzi vuoti per costruzione); forma sulle **ultime 10 del
  CLUB** con `played/measured/unused/unknown` e gol spezzati league/other; **striscia di 10 pallini**
  (`b` panchina ≠ `n` nessun dato); vista `Snapshot` (club a sinistra, campetto + rosa ordinabile a
  destra, colonna `real`); campetto = **modulo tipo** (moda degli undici, non media delle linee).
  Difetti trovati provandolo: backstop apparizioni illimitato (Handanovic nell'Inter 2026), rose
  ridatate = look-ahead, perimetro euro non filtrato, anello bianco su riga bianca, tooltip muti
  (chiave sul testo invece che sull'id di colonna).

- [x] **v9.7 (28/07 notte tarda) — il RUOLO REALE granulare, e dove si colloca in campo**: richiesta
  dell'utente, recuperato **a ogni snapshot**. **Dodici codici** `GK` · `DL DC DR` · `DM` · `ML MC MR` ·
  `AM` · `LW RW` · `ST` — **enumerati misurando** (128 giocatori campionati, nessun tredicesimo; un codice
  nuovo a monte va **nel log**, non assorbito) — con etichetta italiana e badge, e sono una **griglia**:
  lato (−1…+1) + profondità (0 porta propria … 1 avversaria, lo stesso asse di `avg_x`). Serviva perché
  `role_classic` chiama `D` sia un terzino sinistro sia un centrale e **`derived_role` li chiama `D`
  entrambi anche lui**; `DM`/`MC`/`AM` sono tre posti che il listone chiama tutti `C`.
  Nuova `player_roles` **datata**, nuovo `positions --layer roles`, **una richiesta per CLUB**
  (`/team/{id}/players`: 35 club invece di ~1500 giocatori, ~2 min, **zero** rieseguendo in giornata),
  team id del provider dedotti *offline* dalle cache (92 club), sette colonne `desc_real_role*`/`desc_foot`
  nel foglio, e nella vista fascia + profondità + badge (colonna `real` = `DL/ML`).
  ⚠️ **TERZO fatto non backfillabile**: `?seasonId=` risponde 200 e lo **ignora**. Precedenza sul lato
  decisa misurando: heatmap e codice concordano su **196/219** (89%), nei 23 restanti vince il codice — ma
  un codice **centrale** non pretende nulla sulla fascia e lì resta la misura (Bastoni `DC;DR` → −0.53).
  **1372 osservazioni, 745/883 righe (84%)**. Difetti trovati provandolo: il top-up per giocatore
  camminava su tutte le 77 squadre di `squad_snapshot` invece delle 38 comprabili; righe doppie in `clubs`
  si rubavano a vicenda il team id **in silenzio** (ora vince la riga con più rose, e le perdenti sono nel
  log). **Nessun verdetto del gate cambia.**
- [x] **v9.7b — i dodici codici → il vocabolario MANTRA** (mappatura dell'utente, `desc_mantra_real`):
  il Mantra **semplifica**, quindi `ML`/`MR` → **`e`** e `LW`/`RW` → **`w`** (fascia non nominata a
  centrocampo, nominata in difesa: `DL`→`ds`, `DR`→`dd`), `DM`→`m`, `MC`→`c`, `ST`→`pc`, `GK`→`por`.
  Due ruoli che **nessun codice singolo** produce: **`b` braccetto** = fascia difensiva **+** `DC`
  (139 giocatori contro i 28 del listone — è una *capacità*, registrata e non tarata) e **`AM` → `t`|`a`**
  dalla linea larga del provider (63 `M`, 19 `F`). ⚠️ Non sostituisce `rosters.roles`: esiste per quando
  non esistono (26/27: **1343 su 1343** senza listone). Confronto dove ci sono entrambi: **48% identici,
  44% condividono un ruolo, 8% disgiunti**, e le disgiunte sono quasi tutte `a` (listone) vs `w`
  (provider) — la distinzione fra per cosa lo compri e dove gioca, non un errore della mappatura.

## Percorso critico (aggiornato 28/07 notte)
La parte dati e' fatta **e ora è anche esportabile e ricostruibile da zero** (v9.4): il toolkit non è
più sul percorso critico. Il percorso ora e': **modalità LIVE del motore (una lista sola, non due) ->
chiarire i 3 numeri presenze/T1 -> gate 3.2 -> 2.5 pieno con i flag -> taratura dei parametri
provvisori -> listone 26/27 ad agosto (una modifica: `config.SEASONS`) -> ALGORITMO COMPLETO asta 26/27.**
Nota: **nessuna delle feature generate il 27/07 e' entrata nel motore**, e **nessuna delle sei candidate del 28/07** — esistono come dati, e il gate decide se e come usarle. Parametri esplicitamente provvisori: decadimento/quarantena rigoristi, soglie tier T1/T3, soglia U22.

### Coppie d'attacco — CHIUSO il 28/07 notte (richiesta dell'utente, tre pezzi)
- [x] **Dati (spec «Novità v9.3», zero rete)**: sei colonne di tiro su `external_match_stats` +
  **`club_match_lineups`** (G/D/C/A schierati per undici) → **K** = attaccanti per undici e **co-start**.
  ⚠️ Lezione di metodo: i conteggi di club stanno **fuori** dall'imbuto dell'identità, che da solo
  distruggeva il campione (Serie A 24/25: 233 undici su 774 risolti, Juventus **zero**). Difetto trovato
  misurando, non rileggendo il codice. `probable_starter` ora tiene modulo/squadra/panchine (accumula da
  adesso) e `positions --layer reparse` ri-parsa la cache offline.
- [x] **R17 (regola d'errore): BOCCIATA**, pre-registrata prima della corsa
  (`attacco-affollato-r17-v1.md`). Coefficiente negativo e **stabile su tutte le finestre di entrambe le
  piattaforme** → il meccanismo esiste; i giocatori che sposta **peggiorano su 9 su 10** → cade
  sull'errore. **Quinta** forma dell'affollamento a cadere: R11, R11b, R16, R16b, R17. **Non riproporla.**
- [x] **Pressione di reparto (valuta d'asta, non gate): misurata e SPENTA**
  (`metrica-asta-surplus-v1.md` §11). Include il **premio** al posto garantito che l'utente ha chiesto.
  VALORE catturato −0.61% (limite −2%: ok) ma **bust 10.1% → 10.1%, identico su ogni finestra**.
  Riaccenderla è una decisione da prendere ad alta voce, sapendo che compra 0 bust in meno.
- [x] **Colonna `Pair` nel tab Auction** (compagno, K, co-start, ΔQt.I): quello che spedisce davvero —
  stessa evidenza al decisore, ordinamento intatto.
- [ ] **Raffinamento dichiarato, SBLOCCATO il 28/07 notte**: compagni **lungodegenti** (un concorrente
  fuori a lungo non è un pretendente serio → premio a chi resta). `injuries` non è più vuota: il modulo
  c'è e la camminata per-giocatore gira. Resta da scriverne la forma e pre-registrarla.
- [x] **Altri ruoli — cross-tab MISURATO il 28/07 notte** (`positions --layer crosstab`, 149 585
  presenze): **G→P 100% · D→D 97% · M→C 80% · F→A 80%**. Il prerequisito è soddisfatto: estendere i
  conteggi di reparto ai **difensori** è pulito, ai centrocampisti costa la stessa ambiguità già
  accettata per gli attaccanti. Resta da **formulare l'ipotesi** e pre-registrarla — ma attenzione:
  cinque forme di affollamento in attacco sono già cadute, e nulla dice che in difesa il meccanismo si
  trasferisca meglio.

### Famiglia TURNOVER ATTESO — misurata il 29/07 (descrittiva), NON pre-registrabile ancora
- [x] **FATTO 29/07 — quattro credenze misurate**: riposo corto, «vincere aiuta a vincere», l'undici che si
  conferma, la sferzata del nuovo allenatore. [turnover-atteso-v1.md](turnover-atteso-v1.md) ·
  `gate-motore-v1.md` §5-duodecies. **Tutte e quattro hanno un effetto reale e in tutte e quattro è su CHI
  GIOCA**: riposo ≤3 giorni → P(titolare) −9,8pp e P(voto) −4,4pp (7 stagioni su 7) contro fantavoto −0,014
  (t −0,5); dopo una vittoria vs una sconfitta → +5,0/−4,1pp e XI confermato 78,2% vs 71,0% (7 su 7) mentre
  il fantavoto ha **segno rovesciato** (−0,046). Cornice: **Var(ln pv) = 90,5%** di Var(ln fantapunti).
- [x] **FATTO 29/07 — «ha segnato, si ripeterà?» misurato per permutazione** (300 rimescolamenti per
  sequenza, perché il test ingenuo è distorto: bias di Miller–Sanjurjo). **Il gol è senza memoria** (Serie A:
  tutte e quattro le statistiche a zero su 1.260 giocatore-stagione); **il livello di prestazione ha un filo
  di memoria** (quartile alto di fantavoto, t +2,7…+6,5 su entrambe le piattaforme, ma +0,014 su tasso base
  0,408). ⚠️ **Correzione**: la «mano calda a −0,035» era la distorsione, col null giusto è **+0,012**.
  Regola di metodo ora scritta nel gate §5-duodecies punto 4.
- [x] **FATTO 29/07 senza rete — il risultato di una partita di Serie A è derivabile offline**: `goals` è al
  netto di rigori **e** autogol, quindi gol fatti = `SUM(goals)+SUM(pen_scored)` e gol subiti dalle righe
  `role='P'`; pareggia su 386 giornate su 418, screening severo → **278/418 (66,5%)**.
- [ ] **BLOCCANTE per farne una regola: manca un GATE PER-GIORNATA.** Il gate attuale giudica un bersaglio
  stagionale all'asta, quindi nulla di questo è adottabile. È il lavoro vero, non la regola. Forma
  legittima: **una** famiglia (turnover atteso dell'undici), tre input (risultato precedente, riposo,
  impegni), bersaglio `P(voto)` e minuti attesi — **mai la fantamedia** — identificazione **within-club**.
- [ ] **Prerequisito di dati n.1: le partite di COPPA ed EUROPEE.** Senza di esse la congestione vera non è
  misurata: il bucket ≤4 giorni è pulito, quello «riposo normale» è contaminato per le squadre europee, e il
  bias **sottostima** l'effetto.
- [ ] **Prerequisito di dati n.2: i punteggi delle altre 4 leghe** — una richiesta **per giornata** (non per
  partita) sull'endpoint dei round, per uscire da una sola piattaforma. `positions.download_round` scarta
  `homeScore`/`awayScore` al parse e `_get_json` non cachea il raw, quindi non è recuperabile offline.
- [ ] **Attenzione al confine già battuto**: «vincere aiuta a vincere» come regressore **d'asta** *è* la
  famiglia forza-club, **CHIUSA** (§5-nonies), sullo stesso difetto — input derivabile dalla fantamedia del
  giocatore. Diventa un'ipotesi nuova **solo** con identificazione within-club.

### Aperto dopo la passata del 28/07, in ordine di leva
- [ ] **LEVA MASSIMA — prezzare i nuovi arrivi senza storico.** È il vincolo che ha reso inutile la
  pressione di reparto: Openda e David non stavano in **nessuna** top-10 predetta, quindi nessuna metrica
  d'asta può proteggere da loro. Non serve un'ipotesi nuova (R13c è ferma per campione, 14-21 osservazioni
  per finestra): il 26/27 la sblocca a costo zero.
- [x] **FATTO 28/07 sera — i criteri del gate ora distinguono «piccolo e stabile» da «rumoroso»**, come *classifica* e non come giudizio: `gate-motore-v1.md` §5-sexies. Pre-registrata prima di eseguirla, applicata a tutte le candidate, **non cambia nessun verdetto**. Esito scomodo e utile: R10 e R11/R11b hanno coefficiente coerente su **10 finestre su 10** in Serie A pur essendo respinte, e **R3 — che è ADOTTATA — esce instabile**. Da cui il limite trovato alla prima corsa: la dispersione ha due cause, assenza di effetto *e* collinearità fra regressori, e la misura non le distingue → affidabile per le regole a λ singolo, non per quelle che rifanno la regressione delle quote.
- [ ] ~~I criteri del gate non distinguono «piccolo e stabile» da «rumoroso».~~ Sostituito dal punto sopra. Resta aperta la **decisione di prodotto**, che è diversa dalla misura: R15 su euro migliora tutte e cinque le finestre con un coefficiente stabile entro ±0.011 (+0.074…+0.096) ed e' esclusa da un pavimento sull'**ampiezza**; R15 su Serie A cambia segno quattro volte e viene giudicata con lo stesso metro. Aggiungere un criterio di **stabilita' del coefficiente** e' un miglioramento vero dell'harness — ma va specificato **prima** di ri-lanciare, altrimenti e' spostare i pali per una regola che ci piace.
- [x] **FATTO 28/07 sera — audit dei coefficienti citati**: `gate-motore-v1.md` §5-octies. **5 su 12** si riproducono; due solo contro la baseline pre-due-passate. La deriva e' legittima (i dati sono migliorati molto il 27/07), la mancanza di provenienza no. Trovate anche **due interpretazioni scritte al singolare su una quantita' che dipende dalla piattaforma** (R2 vale su Serie A, R6 su euro). Convenzione adottata e messa in `CLAUDE.md`: un coefficiente senza piattaforma, baseline e data non e' un fatto.
- [x] **CHIUSA 28/07 sera — famiglia forza-club**, decisione dell'utente, `gate-motore-v1.md` §5-nonies. Quattro tentativi, segno giusto ogni volta, input derivabile dalla storia del giocatore → non incrementale, come R14 e R16. Costo accettato e misurato: Kane +2.35 di errore su T2 resta senza spiegazione per questa via. Il residuo indica **beta non costante**, che è un meccanismo diverso e sta gia' fra le pre-registrazioni. Riapribile **solo** con una misura prospettica e ortogonale alla sua storia. L'argomento che c'era CONTRO la chiusura e' registrato e resta vero: R5b aveva vinto 3/3 su Serie A senza danni collaterali. Ha perso perche' quelle tre finestre erano le finestre di generazione dell'ipotesi.
- [x] **CHIUSA 28/07 sera — persistenza per-giocatore nell'obiettivo d'asta**: pre-registrata e poi archiviata sul prerequisito (`metrica-asta-surplus-v1.md` §10). La persistenza **non si trasferisce** fra stagioni: rho fra persistenza di input e beccabilita' bersaglio e' indistinguibile da zero su **15 finestre su 15** e cambia segno, mentre la curva di popolazione gia' spedita predice la stessa cosa a rho 0.29-0.47 positiva su tutte. La costanza e' una proprieta' della **stagione**, non del giocatore — che spiega anche R15. **La famiglia «persistenza» si chiude sul lato previsionale**: due bersagli indipendenti, quindici finestre, zero segnale trasferito.
- [x] **FATTO 28/07 — non-danno elastico e vincolante anche per l'accuratezza**, soglia 2% sull'aggregato (lo stesso `MAX_WINDOW_LOSS` del verdetto robusto), letta su `auction_view` e non sui ruoli Classic. Nessuna adottata disarcionata. `gate-motore-v1.md` §5-undecies.
- [ ] **ALTA LEVA — il gate non riporta l'effetto MARGINALE sopra il set adottato**, solo quello da sola contro B0. E' la causa comune dei due errori di adozione del 28/07: R3d da sola fa +3.3% sul deliverable e sopra R3c fa −3.8%. Finche' non c'e', ogni adozione richiede una verifica di configurazione a mano.
- [ ] ~~il non-danno sui top-10 non vincola le regole di accuratezza~~ `passes` lo impone solo alle regole di COPERTURA, quindi una regola puo' passare il gate e **peggiorare la lista che il prodotto consuma**: R3d lo fa (passa, e porta i nomi da 157 a 151 su cinque finestre, con T2 da 36 a 32). Estendere il vincolo ri-esaminerebbe R3, R7 e R3c, gia' adottate → decisione da prendere per se'. `gate-motore-v1.md` §5-decies.
- [ ] **Non aggiungere ipotesi allo stesso campione.** Tre dei sei no del 28/07 sono per mancanza di finestre indipendenti, non di effetto: R13c ha 14-21 osservazioni valutabili, R5b tre finestre contaminate, R15 sta sotto il pavimento. Due si risolvono da soli col 26/27 a costo zero.
- [ ] **euro non guadagna finestre a poco prezzo** (ri-verificato il 28/07): il 2021-22 e' vuoto **alla sorgente** — la colonna `Voto` del file in cache e' `-` per ogni giocatore mentre i fatti ci sono. Il voto sintetico potrebbe riempirlo, ma per Tm2 il 2021-22 **e' il target** e lo spec vieta al sintetico di contaminare il target euro; resterebbe solo Tm1 con input sintetici. Una finestra sola in cambio di un cambio di regola: non conviene.

## Ripresa 29/07/2026 (dettaglio in `stato-progetto-continuita-v5.md`, sezione di chiusura)
- [x] **FATTO 29/07 — standing sul club attuale + `LOAN_DISCOUNT = 0.60`.** La stagione misurata arriva
      nel foglio **spaccata in due**: `desc_minutes_club` / `desc_minutes_elsewhere` (e le stesse due per
      le presenze da titolare), da `at_current_club`, l'unico strato che ha un club per presenza. La vista
      non sceglie un ramo, **pesa**: `at_club_weight` = quota minuti al club attuale + `LOAN_DISCOUNT` per
      il resto, applicato sia a `standing` sia a `voto_share` (leggere il `tit` a valore pieno mentre il
      campetto lo scontava sarebbe una tabella che risponde due volte alla stessa domanda). Chi non si e'
      mosso e' identico a prima, chi ha giocato altrove vale 0.60, un trasferimento di gennaio sta in
      mezzo. Marin R. **0.57 -> 0.34**, dietro Rrahmani (0.81) come previsto. Su euro: 710 giocatori con
      lo split noto, **118 scontati**, 69 interamente altrove. Split ignoto (nessuna riga nello strato
      per-partita) = **nessuno sconto**: non sapere non e' sapere.
- [x] **CHIUSA di conseguenza — «sconto decrescente con le partite al club attuale»**: la quota minuti lo
      fa da se', una partita alla volta, senza un secondo parametro.
- [x] **FATTO 29/07 sera — prestito contro acquisto, con la differenza MISURATA.** Nessuna fonte nostra
      marca un prestito (`arrivals.type` non lo ha, `transfers_history.fee` e' NULL per gratuito e prestito
      allo stesso modo e non copre la finestra 2026). Lo dice la storia delle rose:
      `snapshot.previously_at_club` → `desc_at_club_before` = l'ultima stagione in cui il listone di QUESTO
      club lo aveva. Quindi **`LOAN_DISCOUNT = 0.60`** (misurato altrove **e** mandato via da qui) e
      **`ARRIVAL_DISCOUNT = 0.80`** (solo misurato altrove). Su euro: 145 scontati, **69 gia' stati qui**
      (Rashford, Jackson, Nelson, Cheddira), **76 mai**. Entrambe provvisorie: le possiede il gate.
- [x] **SPAZZATO 29/07 — `INJURY_WEIGHTS`**: la FORMA a tre stagioni e' confermata (le due degeneri, solo
      ultima stagione e tutte uguali, sono peggiori su entrambe le piattaforme), l'inclinazione resta
      aperta: fra 1/0.6/0.35, 1/0.75/0.5 e 1/0.45/0.2 ci sono 0.3% e le due piattaforme preferiscono
      l'opposto. ~~Verificare le ricadute duplicate su Transfermarkt~~ **CHIUSA**: le assenze si CONTANO in
      giornate dentro l'UNIONE degli spell (`snapshot.rounds_missed`), che non puo' contare due volte una
      ricaduta; e l'eccesso della fonte non e' duplicazione (74% ≈ 38/50 sugli italiani = le coppe che non
      parsiamo). `AVAILABILITY_FLOOR` resta aperto ma per un motivo misurato: l'intera griglia 0.0-0.6 vale
      **0.6%**, sotto il pavimento del gate.
- [x] **FATTO 29/07 notte — `sweep`, il gate delle COSTANTI** (punto 3 di «cosa manca»; gate §7-ter, spec
      v9.12). Formule estratte in `engine/presence.py` (un parametro che nessun harness raggiunge non si
      puo' spazzare), tre famiglie con lo stesso protocollo del gate delle regole. **Adottato**:
      `STANDING_WEIGHTS` = (0, 1), la titolarita' si prevede dai MINUTI — strict e robust su tutti e dieci i
      fold, +1.55% euro / +1.32% default, 10 club su 34 cambiano l'undici disegnato. **Confermati**: forma
      di `contested`, `ARRIVAL_DISCOUNT` 0.80, decay rigoristi 0.75. **Aperti col motivo**: `LOAN_DISCOUNT`
      (platform-dependent), inclinazione infortuni, pavimento, quarantena, soglie dei tier.
      Difetto trovato per strada: **ogni rigore di Serie A era contato due volte** (una riga per
      piattaforma), che dimezzava la memoria della gerarchia per i club italiani.
- [x] **FATTO 29/07 notte — il denominatore di una quota e' il CAMPIONATO** (punto 2 di «cosa manca»; spec
      v9.11). I numeratori erano di campionato e il denominatore ogni undici parsato in qualsiasi
      competizione (Arsenal 58, Bayern 50, Napoli 38): quota di campionato **66%-100%** sui 45 club, quindi
      Kane leggeva 49% con 25 titolarita' su 34 giornate. Correlazione fra quota del club e titolarita'
      media **+0.796 → −0.172**. Con dentro tre difetti minori trovati misurando: il percorso datato di
      `titolarita`/`propensity`/`at_current_club` contava le coppe mentre l'aggregato no; la `%` delle
      presenze previste va sul calendario della PIATTAFORMA (31 euro, 38 default), ora nel manifest; e
      `contested` usava la **previsione** a tre stagioni, la stessa che `availability` moltiplica, quindi si
      annullavano (giocatori sul pavimento **da 201 a 9** una volta separati).
- [x] **FATTO 29/07 sera — centrocampo a 5, e i due difetti sotto.** La richiesta (quale fascia all'ala,
      quale al terzino) era impossibile prima di questi: (1) il **badge prendeva la fascia dal codice** e
      non dallo slot disegnato — l'Inter leggeva `Es` due volte nel 3-5-2, con Carlos Augusto esterno
      destro; ora quando lo slot contraddice il codice vince lo slot (`MIRROR`), il ruolo resta suo;
      (2) una **linea senza uomini propri lasciava la maglia vuota** — il Bayern disegnava DIECI uomini
      (4-4-1 invece di 4-5-1) con ali e trequartisti fuori; ora prende dal resto della rosa, ma una linea
      presta **solo il surplus** e **dalla panchina, mai la prima scelta** (entrambe trovate rompendole);
      (3) e allora `slot_cost`, che sapeva solo la fascia, ha messo un **centrale difensivo** quinto
      centrocampista → terzo termine **`LANE_DEPTH`**, distanza fra la profondità della linea e quella del
      codice, ultimo nella tupla: separa solo chi le regole di fascia lasciano pari. **0 undici incompleti**
      su 68 (34 club x 2 modi).
- [x] **VERIFICATO 29/07 — il top-up infortuni era già completo**: 3273 id Transfermarkt, 3273 pagine in
      cache, **0 mai visitate**. I 94 di rosa senza righe sono «visitati e puliti» e il foglio lo dice
      (`desc_injury_source`). Voce stantia, chiusa senza eseguire nulla.
- [x] **FATTO 29/07 — recuperate 815 identita' sofascore.** Erano 827 fc_id con gli aggregati di stagione e
      **nessuna** riga in `player_xref` (Saka, Guirassy, Torres F., Sorloth, Mbeumo, Cunha): invisibili a
      ogni strato datato, che passa tutto da quella tabella. Causa: l'identita' era scritta **dentro il giro
      per stagione**, quindi la decideva quale stagione veniva processata per ultima - chi era respinto
      nella sua stagione piu' recente perdeva l'id stabilito da una precedente. Fix: `_store_identities`,
      un passaggio unico su tutte le stagioni del run, con `authoritative` che distingue «tutta la cache»
      (puo' cancellare: non rivendicato E' un verdetto) da «alcune stagioni» (non cancella mai). Recupero
      offline: xref 3021 -> **3836**, orfani 827 -> **7**, per-partita ~270k -> **334.795** righe, giocatori
      del foglio senza codice granulare **152 -> 32**, maglie senza alternativa **228 -> 129** su 685.
      I 7 residui sono omonimi vecchi il cui provider id ora appartiene a un altro fc_id: esito giusto.
- [x] **FATTO 29/07 — i ballottaggi mancanti** (Napoli: Vergara, Neres, Lukaku, De Bruyne, Anguissa fuori
      anche dalle alternative). Tre cause, una sola radice — un ballottaggio non era **posizionale**:
      1. `snapshot.duels` raggruppava per ruolo Classic, e al Napoli Politano, Lobotka, Elmas, McTominay,
         Anguissa, De Bruyne, Vergara e Neres sono **tutti 'C'** → Politano «in ballottaggio» con un
         regista. Ora serve **un codice reale condiviso**, e per decisione dell'utente **senza alcun
         ripiego sul ruolo fanta** (ne' sul ruolo Classic ne' sulla fascia che implica): chi non ha codici
         osservati non e' in nessun ballottaggio, e le colonne restano **vuote** = ignoto, mai «0 rivali».
         Stessa regola in `SnapshotView.can_replace`. Prezzo misurato: le maglie senza alternativa passano
         da 106 a 228 su 680, perche' 152 giocatori su 905 non hanno codici - e 151 di loro non hanno
         nemmeno un id sofascore in `player_xref`, quindi il rimedio e' l'IDENTITA', non un run dei ruoli.
      2. in `eleven` il ballottaggio dichiarato aveva **precedenza** sul bench posizionale: quando non
         nominava nessuno di quella maglia l'intersezione era vuota e le alternative vere sparivano. Ora
         **filtra**, mai sostituisce.
      3. le alternative erano scelte **dentro** il giro degli slot e ripulite dopo (`un rivale non e' un
         titolare`), quindi una maglia i cui due migliori sfidanti diventavano titolari restava **senza
         nessuno** invece di prendere il successivo. Ora si scelgono a undici formati.
      Piu' `_declared` (modo *prossima giornata*): le alternative vengono da **tutta la rosa** ordinata per
      `presence(recent)` e non solo dai nominati dai probabili (Neres infortunato non e' nei probabili ed
      e' comunque l'uomo che prende il posto di Politano), senza secchiello di linea (i trequartisti erano
      arenati in un undici che non schiera trequartisti) e con un uomo offerto una volta sola.

## Ripresa 29/07/2026 sera-notte (dettaglio: stato-progetto «(5)»→«(8)» e la chiusura)
- [x] **Il denominatore di una quota è il CAMPIONATO** (spec v9.11): correlazione quota-club / titolarità
      media **+0.796 → −0.172**, giocatori sul pavimento di disponibilità **da 201 a 9**.
- [x] **`sweep`, il gate delle COSTANTI** (spec v9.12, gate §7-ter). Adottato `STANDING_WEIGHTS = (0, 1)`;
      confermati la forma di `contested`, `ARRIVAL_DISCOUNT` 0.80 e il decay rigoristi 0.75; trovato che
      **ogni rigore di Serie A era contato due volte**.
- [x] **Le probabili non si storicizzano** (decisione dell'utente): rilevazione su oggi, e per un foglio
      retrodatato l'undici **schierato** (`actual_*`, spec v9.13). Il cron settimanale non serve e
      `starter_prob` 0/1453 è **vuoto per scelta**.
- [x] **Ipotesi INVESTIMENTO del club: misurata e BOCCIATA** (gate §7-quater, spec v9.14). Due canali (quota
      della spesa del club, Qt.I percentile nel ruolo), due forme, bersaglio le titolarità: pesi a zero.
      Il meccanismo è già assorbito dai **minuti**.
- [x] **Il pannello spende l'altezza sul CAMPETTO** (richiesta dell'utente sul layout, spec v9.15). A parità
      di finestra campetto **388 → 493px**, rosa 448 → 534; la finestra si apre **massimizzata** (campetto
      449x506) e ricorda la scelta dell'operatore. Misurando: la **status bar era invisibile da sempre**
      (1x1 px, packata dopo uno shell che espande — ora visibile su richiesta), la targhetta
      dell'attaccante era disegnata **sopra la didascalia**, e **276px di colonne della rosa erano assenti**
      (Tk taglia e non offre come raggiungere). Nuovo test in **rapporti**, perché nessuno guardava la
      geometria.
- [ ] **PROSSIMO — ritestare l'investimento col VALORE DI MERCATO Transfermarkt.** Il proxy debole era il
      Qt.I (mercato del fantacalcio); il valore Transfermarkt è quello del calcio, sta **già nella cache**
      (561 pagine rosa, 51 club × 11 stagioni) e abilita la **quota del valore della rosa**, che è la
      normalizzazione «relativa alle casse» che l'ipotesi chiedeva. Tutto offline. Gli **ingaggi NON
      esistono** in whitelist: verificato, zero occorrenze di Gehalt/salary/stipendio nelle pagine che
      scarichiamo.
- [ ] **Decisione aperta: la PK di `match_ratings`** `(fc_id, season, matchday, platform)` non può
      rappresentare due partite della stessa giornata (rinvio + trasferimento), quindi per quei casi una
      presenza si perde. Cura = PK che porta la partita: migrazione + re-ingest.
- [x] **FATTO il 05/08 — `transfers` rilanciato**: +399 movimenti datati 2026 al primo giro, poi la PK allargata
      (il controparte entra nella chiave) e un re-ingest offline ha portato la tabella da **2949 a 4383** righe,
      523 datate 2026. Senza quel rilancio il canale `fee` era cieco sulla finestra che si sta prezzando — e
      soprattutto le rose non avevano modo di sapere chi era partito.


## Aperto dopo la sessione del 04/08/2026 (pannello Snapshot, spec «Novità v9.17»)
- [ ] **ALLARGARE il misurato ai campionati non coperti** — è il seguito vero della regola sulla quotazione,
      e la misura dice perché: `foreign_fm_equivalent` copre il **25-29%** degli arrivi su euro e il **14-20%**
      su Serie A, perché legge solo i cinque campionati che parsiamo. La maggior parte degli acquisti di Serie
      A viene da **Serie B** e da leghe fuori perimetro, e là la quotazione resta l'unica affermazione
      esistente. Ampliare la copertura è ciò che farebbe pagare la regola anche su `default`, dove oggi la
      quotazione guadagna +0.42% (sotto il pavimento). ⚠️ NON riproporre «torniamo al prezzo»: è già misurato.
      ⚠️ **Aggiornato il 05/08**: una strada per allargarlo è stata provata e chiusa — **convertire il voto**
      delle competizioni non calibrate (gate §7-nonies). Lo scostamento della Serie B **esiste** (−0.181,
      −20% di errore contro la retta nuda) e **perde contro l'àncora di ruolo**, quindi non converte niente.
      Quello che resta da allargare è il **calcio misurato** (parsare altre leghe), non la conversione.
- [ ] **La SERIE del fantavalore, quando sarà una serie** — `fvm_history` accumula da oggi (4/08/2026) e una
      riga non è una serie. Quando ce ne saranno abbastanza, la domanda misurabile è: «il mercato ha cambiato
      idea su di lui» dice qualcosa che i **minuti** non dicono? Bersaglio `P(titolare)`, mai la fantamedia,
      e il confronto è con `standing` — il predittore che lo sweep ha già adottato. ⚠️ Da non confondere col
      LIVELLO del fantavalore, che è §7-quinquies e ha comprato solo il verso.
- [x] **FATTO il 04/08 — la QUOTAZIONE è l'ultima risorsa** (gate **§7-sexies**), decisione dell'utente. Il
      motore adottato non la leggeva già (R12/R12b/R17 falsificate, livello di rimpiazzo dalla fantamedia,
      `stature` a zero); l'unico punto vivo erano i **tier degli arrivi**, che ora sono guidati dalla
      **FM-equivalente misurata** nella lega di provenienza (percentile nel ruolo) con la quotazione come
      ripiego. Misurato: su **euro** vince 7 fold su 7 (**CONFIRMED**, +0.70%), su **default** la quotazione
      guadagnerebbe +0.41% — sotto il pavimento — e la causa è la **copertura** del misurato (25-29% euro
      contro 14-20% Serie A). ⚠️ Il seguito NON è tornare al prezzo: è **allargare il misurato** alla Serie B
      e ai campionati non coperti, da cui arriva la maggior parte degli acquisti di Serie A.
- [x] **FATTO il 05/08 (notte) — la regola 4a alla SELEZIONE** (`_fronted`, spec «Novità v9.22»): il mestiere
      decide chi è eleggibile per un posto d'attacco e il claim decide fra loro, col tetto degli altri due
      override e la definizione unica di `_off_the_front`. Misurato: **6 → 0** attacchi senza attaccante sui
      **516 board che il modello seleziona** (il Lilla era l'unico caso rimasto), 67 board su 666 cambiati,
      costo medio in claim −0.108. ⚠️ **La misura ha ridefinito il numero**: la conta precedente («4 su 394»)
      mescolava i board che il MODELLO seleziona con i **150** che la **fonte dichiara** (modalità `next` con
      almeno 11 probabili) — in quelli chi occupa un posto è una scelta degli editor, non del modulo. Resta
      aperto e scritto: **1 centrale su una fascia della TREQUARTI** (Manchester United), perché `_flanked`
      copre M e A e non T.
> ⚠️ **La strada dichiarata NON è quella presa, e vale scriverlo**: la todolist proponeva «se l'unico posto
> d'attacco andrebbe a un trequartista, la **riga di centrocampo cede un posto** e il modulo esce 4-4-1-1».
> Implementata invece la stessa regola come **override di selezione** (chi è eleggibile per quel posto), per
> due ragioni misurabili: cedere un posto **cambia la forma**, e la forma ha già il suo unico proprietario
> (`_reshape`, che la trasforma solo quando è obbligata); e l'override sta nella **stessa valuta e col
> tetto** dei due che esistevano già, quindi non introduce un terzo metro. Effetto sui board: il Lilla esce
> 4-5-1 con **Fernandez-Pardo** davanti, non 4-4-1-1 con Haraldsson dietro — cioè la squadra schiera la sua
> punta, che è la frase dell'operatore.

- [ ] **Le bande della heatmap, SE si riapre la domanda giusta** (gate §5-quaterdecies). Validate come
      segnale — separano chi gioca su **entrambe** le fasce da chi gioca al **centro**, che una media non può
      (Malen 0.37/**0.50**/0.14 contro Pulisic 0.46/0.30/0.24, centroidi −0.149 e −0.163) — e **misurate come
      inutili sul modulo** (0 forme cambiate su 162 board, 2 targhette su 1782 e in peggio). La domanda per
      cui valgono è «copre **davvero** l'altra fascia?», cioè `sides_of` → i **ballottaggi** e la riga dei
      rivali: metrica da definire prima (le fonti pubblicano i ballottaggi a singhiozzo). Costo: migrazione
      `positions` + colonna d'ingest (il payload è già in cache e già parsato per il centroide) + colonna nel
      foglio. ⚠️ Non riaprirla come «diamo più peso alla heatmap»: quattro famiglie di pesi sono già state
      swippate e sono piatte o negative.
- [x] **FATTO per la FORMA il 04/08** (spec «Novità v9.17» §6): `coach_repertoire` conta le forme di
      quell'allenatore in ogni sua panchina (`coaches` × `club_match_lineups`, una passata SQL offline), il
      foglio le porta in `coach_shapes`/`coach_shapes_of` e `shape_odds` le usa **al posto della lega**,
      pesate da `COACH_SHAPE_MIN` 20 / `COACH_SHAPE_FULL` 60 sul proprio campione — che va da Sarri 188
      (4-3-3 86%) a Iraola 0. Giudizio sulla previsione 26/27: **8/17 → 9/17**, Atalanta al 4-3-3 con la
      difesa a quattro (9 uomini su 11 come la fonte), Milan col 3-4-2-1 dal 13% al 41%, nessun board
      peggiorato e 0 rotture di invariante su 394.
- [x] **MISURATO E NON ADOTTATO il 04/08 — il CLAIM del nuovo allenatore**: la pre-season è nel foglio
      (`desc_preseason_starts`/`..._matches`) e sulla targhetta, e non entra in niente che scelga un undici.
      Sembra decisivo (le due amichevoli di Sarri le iniziano Gaetano, Samardzic, Scamacca e Raspadori; De
      Roon, Ederson e Krstovic nessuna) e non è usabile: **una sola** pre-season per-giocatore, 1-3 partite,
      Milan e Napoli a zero, minuti assenti in 1399 righe su 1716, avversari l'U23 del club stesso, e la
      fonte che concorda ha letto le stesse amichevoli. **Pre-registrato per giugno 2027** (gate §7):
      bersaglio `P(titolare)` e minuti, confronto con `standing`, e se passa entra in `engine.presence`.
- [x] **FATTO E MISURATO il 04/08 — il VALORE DI MERCATO, terzo canale dell'investimento** (gate
      **§7-quinquies**): sta nella pagina rosa di Transfermarkt che già parsiamo (zero richieste nuove) ed è
      **storico** — la pagina di una stagione passata porta il valore di quella stagione. Tabella
      `market_values`, **9388 valori · 3180 giocatori · 11 stagioni**, nel contratto d'export; forma
      misurata = valore come **quota del valore della rosa**, sulla stagione di input. **Non adottato**:
      su euro il migliore in pool è **zero**; su Serie A tutti e sei i fold scelgono 0.10-0.20 ma il
      guadagno medio è **+0.08%** contro un pavimento di 0.5%. Il proxy migliore ha comprato **il verso e
      non la taglia** — il cartellino non aveva nemmeno il verso. Da NON riproporre così: servirebbero gli
      ingaggi (nessuna fonte) o la variazione del valore dentro la stagione (altra domanda, serie per data).
- [x] **FATTO il 03-04/08** — percentuale della build, `claim` ≠ `presence`, assegnazione globale col prezzo
      per linea, badge dei terzini, piede, corpo (misurato e non usato), tabella su canvas con
      pillole/colori/check, tooltip nello schermo, SURPLUS vuoto spiegato. Dettaglio: spec «Novità v9.16».
- [x] **FATTO il 04/08 — il modulo disegnato è un modulo VERO** (spec «Novità v9.17», commit `1108803`): le
      cinque regole di `_reshape` in cascata (nessuno a due linee da casa · la fascia la copre un esterno · la
      fascia svuotata la copre l'attaccante che arretra · un posto in attacco è di un attaccante, e
      l'attacco assottigliato tiene le punte · la riga di centrocampo è cinque al massimo); le **fasce in
      coppia** sulla targhetta e la punta che non diventa mai un'ala; **entrambe le touchline o nessuna**; un
      **solo listino** (`slot_cost` eliminato, `_off_the_front` al suo posto, griglia raddoppiata per lo
      spareggio sul primo codice); `_flanked`, cioè le fasce di una riga contese da chi le gioca. Verifica:
      **394 board** con 0 righe oltre il massimo, 0 codici spaiati, 0 righe asimmetriche; **83% degli uomini**
      e **16/20** conteggi di linea contro le formazioni tipo pubblicate; 278 test.
- [x] **MISURATO E NON ADOTTATO il 04/08 — «posizione effettiva» contro «in potenza»** (gate
      §5-quaterdecies, commit `51d069e`): la heatmap **batte** il codice nel nominare una fascia (97.9% contro
      93.9% su 52 uomini di cui le fonti dichiarano il lato) ed è **già** letta dove serve (`lateral`).
      Quattro modi di usarla altrove, tutti piatti o negativi; ogni peso sulla **profondità** peggiora, perché
      quell'asse **satura** (punta 62, ali 61-63, terzino 47, centrale 34). Pesi a **zero**, bracci
      raggiungibili, numeri nei commenti.

## Aperto dopo la sessione del 05/08/2026 (spec «Novità v9.19», gate §7-septies/octies/nonies)
- [x] **FATTO il 05/08 (pomeriggio) — LA LISTA CON CUI SI VA ALL'ASTA** (spec «Novità v9.20»): il tab
      Auction offre **`2026-27 · LIVE`** come prima voce, una tabella sola per ruolo, prezzata da
      `snapshot.engine_predictions` - la stessa funzione del foglio, con i fit iniettati e la scelta del fit
      lasciata là dentro - su rose reali, senza conteggio di nomi in comune né quota del top-10 perfetto
      (nessuno ha giocato) e con le colonne dell'esito **assenti** invece che vuote. Il blocco era il
      **calendario**: `matchdays_target = 0` prezzava tutti a zero presenze, e il ripiego viveva in
      `snapshot.build`, cioè in UN chiamante. Serie A/classic per SURPLUS: Svilar 32 · Dimarco 27 · Paz N.
      21 · Malen 45; profondità prezzabile 26 · 132 · 135 · 64. Trovati misurando: tre allocazioni di
      larghezza (una taglia il ΔQt.I) e quattro test che aprivano il **DB reale** perché `Config(data_dir=)`
      non sposta `db_path`.
## Aperto dopo la sessione del 05/08/2026 (asta, stima, rose)
- [ ] **PRIMO, e blocca numeri veri sulla lega dell'operatore**: `Config._league_setup` **cancella** la
      dimensione «rosa senza quote per ruolo» (fonde sempre 3/8/8/6), quindi per la lega dichiarata — 12
      partecipanti, euro/mantra, **25 = 2 porte + 23** — i livelli di rimpiazzo sono verosimili e **sbagliati**,
      e con essi ogni surplus. È il primo dei tre passi di `assistente-asta-v1.md` §16.4 (config con
      `squad_slots` (FATTO)/quote opzionali/`keeper`/`factor`/`auction`, `features.roster_depth` che **rifiuta** invece di
      inventare, poi la lega dichiarabile in `my_leagues`).
- [ ] **La stima è viva e non è gatabile come regola**: `est_*` esiste per una regola di prodotto e la sua scala
      di confidenza è **dichiarata**, non fittata. Quello che si può rifare quando le finestre crescono è la
      misura del deliverable (`python -m euroleghe_ingest estimates`): oggi dice che mescolarla costa −12.40% di
      SURPLUS catturato su 10 finestre su 10, e l'operatore ha scelto di vederla comunque, col filtro.
      ⚠️ Da NON fare: ritarare le confidenze su quelle stesse dieci finestre — sarebbe fittare sul deliverable.
- [ ] **L'ASTA È ADESSO, ed è la voce a leva più alta.** Il listone Serie A 26/27 esce a **scaglioni** (494 su
      ~1450 il 05/08) e `fvm_history` ha **una** rilevazione: serve una **cadenza** dichiarata di rilancio
      (`ratings` → `arrivals`, e `recent_form` → `synth` → `arrivals`, la catena che il 05/08 ha chiuso) e poi
      la **modalità LIVE** del motore — per sedersi a un'asta serve **una lista sola**. ⚠️ Il listone **euro**
      26/27 non è pubblicato: la pagina serve 25/26 e la guardia della stagione lo **rifiuta**, che è il
      comportamento giusto. Va riprovato, mai forzato.
- [x] **FATTO E ADOTTATO il 05/08 (sera) — I PORTIERI hanno un FM-equivalente** (gate **§7-decies**, spec
      «Novità v9.21»): il fantavoto di un portiere è un'**identità** (`mv − gol_presi + 3·rigori_parati −
      cartellini`, residuo 0.000 su **16.017** righe e su entrambe le piattaforme) e il **bonus imbattibilità
      non esiste** — quindi mancava **un numero solo**, i gol presi, che erano **già in cache** e venivano
      buttati al parse (`goalsConceded`/`saves` → due colonne nuove su `external_stats`, re-ingest offline,
      11.725 righe su 11.732). `arrivals.keeper_fm_equivalent` **PASSA** il criterio pre-registrato su 201
      portieri-stagione (euro) e 51 (default): bias −0.00…−0.18, MAE 0.084-0.191 contro 0.214-0.336
      dell'àncora, 89-100% entro 0.3 contro lo **0%** della formula dei movimenti. Copertura nuova 1/15/19/8
      per stagione, totale con equivalente **2045 → 2128**, `backtest --verify` 22/22.
- [ ] **CONSERVARE LO SCORE quando lo si riceve** — follow-up di §7-decies, e ⚠️ **da solo NON chiude
      Daffara**: per un portiere fuori dalle 5 leghe servono **due** cose, i gol presi *e* un voto base
      convertibile, e il secondo per la Serie B il gate lo ha **rifiutato** (§7-nonies). Lo score serve dove le
      due si incontrano — le **coppe** — e resta comunque la cosa giusta da fare, perché è un campo che passa
      già dalle nostre mani e viene scartato: le cache di giornata (`positions`) e di giocatore
      (`recent_form`) sono distillate. Non è retroattivo e non è un parse: la cache non ce l'ha.
- [ ] **DECISIONE DELL'OPERATORE — `APPLY_OFFSETS`**: la Champions (98 uomini, δ +0.123) **passa** il criterio
      pre-registrato (maggioranza dei suoi uomini) **e** ha una MAE media **peggiore** dell'àncora (0.2103
      contro 0.1938): vince spesso di poco e perde raramente di molto. Raccomandazione: **lasciarlo spento**,
      anche perché convertire le coppe farebbe entrare partite di coppa nell'FM-equivalente, che «una quota di
      stagione è una quota del CAMPIONATO» dice di tenere fuori. Cosa lo riaprirebbe, dichiarato: più uomini
      nel braccio dentro-la-stagione, oppure un criterio più severo scritto prima («batte l'àncora anche in
      media»), che oggi nessuna competizione supererebbe.
- [x] **DECISO il 05/08 — NESSUN job settimanale, e la richiesta è chiusa**: «il job ogni settimana non
      serve». Coerente con la decisione del 29/07 sulle probabili, e ora completa: un'asta iniziale è in
      agosto, quando la pagina delle probabili non esiste ancora, e quello che gli editor aggiungono arriva
      **tardi**, dalle parole dell'allenatore — quindi la lettura che vale è quella presa **subito prima**
      della sessione e usata subito. `starter_prob` 0/1453 sulle finestre del gate è **vuoto per scelta** e
      nessuna regola d'asta lo aspetta. Conseguenze applicate: `scripts/weekly-snapshot.ps1` diventa
      `scripts/refresh-editorial.ps1` (rilancio **a mano**, senza la parte di pianificazione), `bootstrap` e
      il README non chiedono più di registrare niente. Quello che sostituisce il job è **dichiarare l'età**:
      ogni foglio riporta per fonte quando è stata osservata la rosa (`evidence_age`), quindi un board
      disegnato su rose della settimana scorsa si vede come una data invece di essere creduto.
- [ ] **Di quel follow-up resta solo la (3): la conferma indipendente sulla finestra 26/27**, l'unica che non
      ha partecipato a niente — e arriva a **giugno 2027**. I punti (1) griglia estesa e (2) canale al netto del
      null sono stati eseguiti il 05/08 notte (riga sopra) e hanno chiuso la famiglia.
- [x] **FATTO il 05/08 — il listone di AGOSTO entra** (spec v9.19 §1, commit `709bde7`): l'id campionato ha il
      fallback sulla pagina delle **quotazioni** (Serie A 26/27 = 21), con la guardia del **workbook che
      dichiara la sua stagione** perché quelle pagine servono «la lista corrente» qualunque stagione chiedi.
      Dentro: 494 giocatori, 20 club, 154 arrivi riclassificati. `SEASONS` accoglie `"2026-27"`.
- [x] **FATTO il 05/08 — un buco che il toolkit può ancora chiudere si vede, e si vede riempirsi** (spec v9.19
      §3, commit `1538dc1` · `62040e9` · `1cf75f8`): marchi **⧖ → ⟳ → →** sulla stessa lista di stati
      per-giocatore, con la **regola del modulo** che va a prenderli (`recent_form.awaiting_data`, una
      definizione letta da due lati) e il tooltip che dice **con cosa** il buco si è chiuso. Più la barra
      **determinata** da qualunque modulo (`Context.progress`, totali contati). Misurato: 6 righe su 629, e la
      corsa che le chiude ha risolto 11/11 identità con 110 partite salvate.
- [x] **MISURATO E NON ADOTTATO il 05/08 — R1 con la copertura tripla** (gate **§7-octies**, commit `fe26c39`):
      `synth` converte per **COMPETIZIONE** e non per fonte (241.913 su 250.678; le 3756 righe di Serie B
      restano NULL), `mv_synth` rilanciato porta gli arrivi con FM-equivalente da **707 a 2045** — e R1 **non
      passa** su sei finestre, peggio dell'àncora di ruolo su cinque. Dove il criterio dell'utente **è**
      soddisfatto: le **presenze**, da R13 che è già adottata (Alajbegovic FM 6.245 = l'àncora, PV 20.2,
      surplus 4.1). Sul tabellone entra `window_standing`, spento nel motore e pre-registrato.
- [x] **MISURATO E NON ADOTTATO il 05/08 — l'investimento condizionale** (gate **§7-septies**, commit
      `5123413` · `69f644d`): `investment_shape="unplayed"`, braccio **cartellino morto** su entrambe le
      piattaforme, braccio **valore/rosa** robust **PASS** su Serie A (+0.79%, 5/6, peggiore −0.09%) e sotto il
      pavimento su euro. Il **NULL** dice quanto: su Serie A il valore batte la costante di +0.42 punti, su euro
      i due sono identici (ritorno alla media). `value_weight` resta **0.0** perché ogni fold scegli il **bordo**
      della griglia.
- [x] **MISURATO E NON APPLICATO il 05/08 — una retta per le competizioni non calibrate** (gate **§7-nonies**,
      commit `62dbaf2` · `38e5210`): scostamento per competizione, `MIN_MEN_PER_OFFSET` 10, leave-one-out sugli
      uomini contro **due** nulli. **Serie B δ = −0.181**, e la correzione non è rumore (0.1631 contro 0.2039
      della retta nuda) ma perde contro l'**àncora** (0.1786). `APPLY_OFFSETS = False`, offset comunque nel
      report. Terzo muro identico in un giorno.
- [x] **FATTO il 05/08 — il tabellone distingue un 4-5-1 da un 4-2-3-1** (spec v9.19 §2, commit `fc6bbd4`):
      `_two_rows` spezza la riga quando la **maggioranza** di essa gioca più avanti (la fonte pubblica tre linee,
      quindi 4-5-1 è 1746 stringhe su 4812); `_flanked` esteso al tridente e `_pointed` per il centro
      dell'attacco (tetto `FLANK_OVERRIDE_GAP` 0.40); la targhetta legge il **posto** dove il posto decide. 17
      disegni cambiati su 108 board, invarianti **4+7+4 → 0**. ⚠️ **Revocato**: far pagare al modulo i posti che
      la rosa non copre (disfaceva Barcellona e Napoli per aggiustare il Marsiglia).
