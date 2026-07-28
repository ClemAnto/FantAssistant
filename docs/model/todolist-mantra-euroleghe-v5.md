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
> ⚠️ Stato corrente: `00-BRIDGE-punto-di-ingresso.md`, blocco «STATO AL 28 LUGLIO 2026 (sera)». Set
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
