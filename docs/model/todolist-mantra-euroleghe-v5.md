# Todolist — Allineamento Mantra & EuroLeghe (v5)
**Progetto:** App EuroLega Fantacalcio · **Rif.:** modello-previsionale v3.8 · **Aggiornata: 28 luglio 2026 (notte)**
Convenzione: [ ] da fare · [x] fatto · [!] bloccato · *Sigle: fc_id = id fantacalcio.it · FM = fantamedia · T1/T2 = finestre di test 23/24->24/25 e 24/25->25/26 · 2.5 pieno = backtest motore completo con flag.*

## FASE 0 — Fattibilita' [x] (21/7)
Invariata (storico 9 stagioni, endpoint Excel, fallback SofaScore, scala ricalibrata, ruoli Mantra). Rif: dataset-euroleghe-README.md.

## FASE 2 — Mantra core [x] salvo 2.5 pieno (21/7)
- [x] 2.1 Ancore Mantra frazionarie + BETA 0.42 -> ancore-mantra-fase2_1.md
- [x] 2.2 Portieri M2e (decomposto + ClubElo; gate -25%/-20%) -> modulo-portieri-fase2_2.md, clubelo-gate.md
- [x] 2.3 FM per ruolo posseduto + rank + flessibilita' (fuori FM) -> fm-per-ruolo-fase2_3-2_4.md
- [x] 2.4 Cambi ruolo = cambi d'ancora ASIMMETRICI -> idem
- [x] 2.5-lite backtest core (Mantra non-inferiore a Classic) -> backtest-mantra-fase2_5lite.md
> ⚠️ Stato corrente: `00-BRIDGE-punto-di-ingresso.md`, blocco «STATO AL 29 LUGLIO 2026». Set
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
- [x] **HARNESS DEL GATE** (`engine/` + `backtest`): riproduce **15/18** numeri pubblicati; 3 da rivedere sul modulo presenze in T1. E' il riferimento da cui portare il motore TypeScript.
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
- [ ] `INJURY_WEIGHTS`: forma confermata (3 stagioni, l'ultima piu' pesante), valore aperto. Verificare le
      ricadute duplicate su Transfermarkt prima di ritarare `AVAILABILITY_FLOOR`.
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
