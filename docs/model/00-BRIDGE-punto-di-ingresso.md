# 00 — BRIDGE · Punto d'ingresso del progetto (leggere per primo)
**Aggiornato: 27 luglio 2026** · Questo file inizializza qualsiasi sessione/strumento nuovo. Il prefisso "00" lo tiene in cima alla cartella.

## Il progetto in breve
Motore previsionale per fantacalcio **EuroLeghe** (fantacalcio.it): valutazione calciatori Classic e Mantra sui 5 grandi campionati europei (Serie A, Premier, Liga, Bundesliga, Ligue 1 — perimetro: i ~35 top club del gioco). Prevede fantamedia (FM), presenze attese e VALORE stagionale = FM × presenze. Metodo scientifico: **ogni regola entra nel motore solo se batte il baseline fuori campione su finestre indipendenti** (gate pre-registrato). Stato: core validato (Mantra, Classic, portieri, presenze); manca lo strato flag/arrivi, sbloccato dal toolkit dati `euroleghe-ingest` (in implementazione).

## Casa dei documenti: GIT (non più Drive)
La knowledge base è ora nel repo git **`FantAssistant`**, cartella **`docs/model/`** (italiano, casa canonica; git gestisce il versioning). La cartella Drive "Modello Previsionale Fantacalcio" resta come **mirror/archivio** e ospita i **dataset** (xlsx/csv, non in git); c'è un marker `00-MOVED-TO-GIT.md`. Mappa ID Drive in `docs/DRIVE-MANIFEST.md`.

| Sorgente | Ruolo | Affidabilità |
|---|---|---|
| **git `docs/model/`** | FONTE DI VERITÀ: documenti consolidati, decisioni, ipotesi respinte/pre-registrate | Permanente, versionata |
| **GitHub `ClemAnto/FantAssistant`** | remote `origin` (repo **pubblico**), branch `master` | Copia remota della verità |
| **Drive (cartella progetto)** | Archivio/mirror + dataset (xlsx/csv) | Non più aggiornato (solo su richiesta esplicita) |
| **Memoria Claude del progetto** | Riassunto automatico per ripartire in fretta | Cache: comoda ma MAI fonte di verità |
| **Credenziali fantacalcio.it** | Solo in `.env` locale | MAI su Drive/chat/repo/log |

## Ordine di lettura per una nuova sessione
`00-BRIDGE` (questo) → `stato-progetto-continuita-v5.md` → `todolist-mantra-euroleghe-v5.md` →
**`gate-motore-v1.md`** (protocollo del gate, verdetti, ipotesi falsificate: leggerlo prima di
proporre qualsiasi regola) → `spec-euroleghe-ingest-v9.md` → `nota-modello-set-pieces-v2.md` →
`modello-previsionale-v3.8.md` → consolidati di dettaglio. Tutti in `docs/model/`.

## STATO PRECEDENTE (primo giro toolkit, 26 luglio 2026)
**Toolkit `euroleghe-ingest` — primo giro IMPLEMENTATO** (Python 3.13, venv in `toolkit/.venv`, SQLite `data/euroleghe.db`, GUI Tkinter `python -m euroleghe_ingest gui`):
- **Operativi**: `rosters`, `stats`, `ratings` (scraping Excel autenticato **+ listone quotazioni**), `arrivals`, `elo`, `validate`, `rebuild` (idempotente, reset in-place). GUI: vista calciatori (pillole ruolo colorate, ordinamento persistente per ruolo, toggle Fantavoti a griglia, icona campetto).
- **Dati scaricati e riallineati**: voti EuroLeghe (`platform='euro'`) + Serie A classica (`platform='default'`) per 2023-24/24-25/25-26; **listoni** (ruoli Mantra + prezzi, fogli Tutti+Ceduti) per entrambe le piattaforme → Serie A copertura Mantra ~96%, prezzi anche su Premier/Liga/Bundes/Ligue1. `rebuild` verde (allora 234 FM-off nel soft check: causa individuata e corretta in fase 1, ora 0).
- **Decisioni chiave** (dettaglio in `spec-euroleghe-ingest-v9.md`): `platform` = euro|default in PK (calendari diversi) · `gameType` = classic|mantra (motore) · aggregazione opzione A · `season_stats` per piattaforma · propensione stagione piena (FBref fatti + Sofascore rating/heatmap + **voto sintetico calibrato**, mai nel target euro; tutto passa dal gate) · mappa giornate euro↔reali **per lega**.
- **Code review** fatta (robustezza: utf-8-sig/BOM, scritture atomiche + try/except nei reingest, retry di rete, indici DB; consolidamenti). Scartato l'aggiunta del bonus imbattibilità al fantavoto grezzo (verificato: peggiora la coerenza FM). Ruff pulito, 25 test verdi (+1 skip GUI headless).

**Commit** (branch `master`): `0bceb23` platform · `85b7a09` season_stats per-piattaforma · `258905e` listone · `7619d27` listone Ceduti · `e7e2394` migrazione doc in git · `b831f5f` code review.

## FASE 1 — FATTA (26 luglio 2026), con SofaScore al posto di FBref
Dettaglio tecnico e numeri in `spec-euroleghe-ingest-v9.md` → «Novità v9.1».
- **FBref è bloccato** (interstitial Cloudflare: 403 su ogni path anche con impersonation TLS) → **SofaScore
  è la fonte primaria dei fatti**: stessi dati (gol/assist/minuti/xG/xA) **più il rating per-partita** che
  serve al voto sintetico. FBref resta arricchimento futuro (rigori di carriera, piazzati) via browser
  headless o inbox manuale. Client `curl_cffi` (impersonate chrome): `requests` prende 403.
- **Nuove tabelle**: `external_stats`, `external_match_stats`, `matchday_map`. **Nuovi moduli**: `matchdays`
  (calendario euro↔reale) e `synth` (voto sintetico); `positions` è il modulo SofaScore
  (`--layer season|match|all`). Identità in `matching.py` (tier + pool club→lega→stagione, iniettività
  fc_id↔id provider, `manual_overrides` con precedenza, non risolti nel `coverage_report`).
- **BUG CORRETTO: rigori invertiti** nell'Excel dei voti (`Rf` = fatti, `Rs` = sbagliati; erano scambiati) →
  ai rigoristi il fantavoto applicava −3 invece di +3. **Il check FM è passato da 234 fuori tolleranza a 0.**
- **Validazioni**: gol SofaScore vs Serie A `default` **100% esatti** su 3 stagioni · copertura perimetro
  **96–100%** · la mappa giornate da SofaScore concorda **29/29** con quella dai nostri voti.
- **Voto sintetico**: retta per ruolo sul Mv euro (pendenza 0.52 P → 0.84 A), MAE 0.358 vs 0.460 baseline.
- **Vista calciatori**: griglia sul calendario **reale** con le giornate fuori dal calendario euro colorate
  a parte (valore = voto sintetico). Test: 52 verdi. `rebuild` offline verde.

## STRATO FLAG/ARRIVI — FATTO (27 luglio 2026)
Dettaglio e numeri in `spec-euroleghe-ingest-v9.md` → «Novità v9.2». In sintesi, le tabelle che erano
vuote ora ci sono: `penalty_hierarchy` 1463 · `probable_starter` 442 · `availability` 103 ·
`positions` 3862 · `flags` 837 · `arrivals.tier` 1390 e `foreign_fm_equiv` 655 · `birth_year` 1861 ·
`tournaments_squads` (Mondiale 2026: 344 giocatori del perimetro, 95 247 minuti) · `coaches` e
`transfers_history` da Transfermarkt.
- **Rigoristi**: la pagina ufficiale è ancora vuota (preseason) → implementata la **gerarchia
  rivelata** dai nostri voti, che lo spec mette comunque al primo posto (918 rigori).
- **Ruolo reale gratis**: il layer per-partita aveva già la posizione su 100% delle righe → 312 flag
  `off_role_usage` senza una richiesta in più.
- **FM-equivalente estera**: calcolata sulla stagione reale piena, **+0.035 di scarto medio** dalla
  FM euro reale dove possiamo confrontarle. È l'input che mancava al gate 3.2.
- ⚠️ **Parametri provvisori** (`DECAY`/`MISS_PENALTY` dei rigoristi, soglie di tier): sono scelte di
  modello, le possiede il gate. Non usarli come stabiliti.

## HARNESS DEL GATE — ESISTE (27 luglio 2026)
Il collo di bottiglia storico è stato affrontato: la regola d'oro ora ha **forma eseguibile**.
`toolkit/euroleghe_ingest/engine/` (model · fitting · features · evaluate) + comando
`python -m euroleghe_ingest backtest`, **read-only** sul DB, scrive solo
`data/reports/engine_backtest.json`. È anche il **riferimento da cui portare il motore TypeScript**
in `app/prediction-engine`, quindi resta senza dipendenze ed esplicito.
- `backtest --verify` **riproduce 15 numeri pubblicati su 18** (ancore Classic/Mantra, beta Mantra,
  coefficienti Pv, portieri M2e su entrambe le finestre, bias titolari T2).
- **3 da rivedere, tutti sul modulo presenze in T1**: `pv_gain_vs_naive_T1` (atteso −0.016, ottenuto
  +0.018), `pv_bias_naive_starters_T1` (5.2 → 4.17), `pv_gain_crossfit_T1` (−0.016 → +0.013). In T2
  tornano. **Finché non è chiarito, il guadagno del modulo presenze su T1 non è confermato.**
- L'**inventario input** stampato dice cosa manca al motore: su T2/euro `starter_prob` è **0/1453**
  (le probabili sono di oggi, non della stagione passata → servono snapshot settimanali).

## GATE ESEGUITO — 7 REGOLE ADOTTATE SU 17 (27 luglio 2026, criteri irrigiditi la sera dello stesso giorno)
Documento dedicato, con tutti i numeri e le ipotesi falsificate: **`gate-motore-v1.md`**. In sintesi:
- **Adottate per piattaforma**: **euro → R0c** (copri i non prezzati con l'àncora di ruolo e la quota
  media) **+ R3c** (minuti sulle giornate del calendario euro) **+ R4** (età sulla FM) **+ R7**
  (persistenza portieri) **+ R10** (nuovo allenatore) · **Serie A → R3 + R7 + R13**.
- ⚠️ **R1 e R13-euro sono USCITE**: una code review ha mostrato che il criterio di copertura si
  soddisfaceva **prevedendo una costante**. Ora una regola di copertura deve battere la risposta banale
  (àncora di ruolo + quota media) sui giocatori che aggiunge, e R1 non la batte (0.391 contro 0.373 su
  T1). Al loro posto **R0c**, la risposta banale dichiarata come tale: costa niente e porta la copertura
  euro **dal 31% al 100%**. Le regole di accuratezza si giudicano ora sui giocatori che **spostano**, con
  una soglia dello 0.5%: R4 e R10 ne escono molto più forti (−3.8% e −3.5% sul loro sottoinsieme), R14
  ne esce bocciata.
- **Risultato**: euro VALORE **−1.7% / −1.5%**, top-10 6→8 e 12→**15**, copertura **31%→100%** ·
  Serie A VALORE **−4.2% / −2.8%**, top-10 11→13 e 14→15. Portieri: presenze −17%.
- **DUE STAGIONI IN PIÙ (sera del 27/07, §3-ter)**: l'API dei voti serve anche 22/23 e 21/22 (e 20/21),
  con layout identico → **euro passa a 3 finestre** (T0 = 22/23→23/24) e **Serie A a 4**
  (Tm1 = 21/22→22/23). *EuroLeghe 2021-22 non ha voti*: l'id si risolve e le 30 giornate si scaricano,
  ma ogni cella `Voto` è `'-'` — quindi l'euro guadagna una finestra, non due.
  **Cosa cambia nei verdetti**: **R10 confermata su tutte e tre** (Pv MAE −5.2%/−3.5%/−4.9%, ed è il
  maggior contributore alle top-10: +3 su T1) · **R0c confermata** · **R4 ESCE** (contraddetta su T0,
  coefficiente da −0.004 a −0.018 fra le finestre) · **R7 resta con riserva scritta**: non passa il
  criterio «migliora su ogni finestra» perché la sua *premessa* — il modello condiviso perde contro la
  persistenza pura sui portieri — è vera su tre finestre e **falsa sulla quarta**, e non è valutabile il
  giorno dell'asta. È una scommessa 3 su 4 che rende −12%…−20% e costa +1.2%.
- **TUTTO L'ARCHIVIO (§3-quater)**: i voti Serie A arrivano almeno al 2015-16 ed **euro 2020-21 ha i
  voti** (il 21/22 è un buco di una stagione). Ingerite altre 5 coppie stagione-piattaforma →
  **7 finestre su Serie A, 4 su euro**. E il risultato più importante di tutta la giornata:
  **R7 non era una scommessa, era uno stimatore sbagliato.** La persistenza dei portieri esce
  0.505-0.798 su sette finestre, sempre sopra lo 0.50 condiviso — il meccanismo è confermato ovunque —
  ma ogni finestra veniva valutata col coefficiente della *singola* finestra vicina, fittato su ~30
  portieri. Mettendo in comune le altre finestre (leave-one-out, `POOLED_PARAMS`): **da 4/7 a 7/7
  finestre vinte, media +9.8%, peggior finestra +1.6%**. R7 su Serie A è adottata senza riserve; su euro
  esce (3/4 ma solo +1.9-3.3%, sfora il non-danno, pareggio sulla metrica d'asta).
  Set adottati ora: **euro R0c+R3c+R10 · Serie A R3+R7+R13**. Il set Serie A migliora il MAE di VALORE
  su **tutte e sette** le finestre e non perde mai una posizione top-10 (91→96 nomi).
- **PASSATA ESEGUITA (§3-sexies)**: voti euro 18/19 + Serie A 17/18-15/16 e **layer stagionale
  SofaScore su 19/20-22/23**. Ora **10 finestre su Serie A e 5 su euro**. Il layer stagionale è costato
  **20 minuti**, non ore: `download_season_stats` è paginata, 6 richieste per lega-stagione — la stima
  «~1300 richieste/stagione» era sbagliata di due ordini di grandezza, e per quella stima la passata era
  stata rinviata. Esito: **il set Serie A (R3+R7+R13) tiene su tutte e 10 le finestre** (media +7.4%,
  peggiore +2.5%, top-10 mai peggiore) · **R3 passa 6/6** (era misurata su 2) · **R7 non ha una sola
  finestra contro** su 10 (media +8.3%; il criterio stretto la boccia solo per una finestra a +0.1%,
  sotto la soglia dello 0.5%) · **R4 bocciata 1/10** e **R10 7/10 con una finestra a −6.3%**: due regole
  che a due finestre sembravano fra le migliori. Sull'euro restano R0c+R3c, e R3c è cieca su 3 finestre
  su 5 finché il **layer per-partita** (in corso, ore) non copre le stagioni vecchie.
  Backup: `scripts/backup-data.ps1` specchia `data/` fuori dal repo — la cache è in `.gitignore`
  (e deve restarci: gli Excel vietano la ripubblicazione e questo repo è pubblico).
- **AUDIT DEI DATI (§3-quinquies)**: lo strato voti è completo (15 coppie stagione-piattaforma,
  218.672 righe, `validate` a 5195 giocatori consistenti) e **non serve altro scraping per i voti**.
  Due input non mancavano, erano solo **non ricalcolati**: `flags.new_coach` (da `coaches`, che risale
  al 1886) e `arrivals` (diff fra listoni) — ora 8 e 7 stagioni invece di 3 e 2, **senza una richiesta
  di rete**. E col test finalmente eseguibile **R10 cade** (3/4 finestre su euro, 4/7 su Serie A,
  peggior finestra −6.7%): aiutava sulle finestre su cui era stata inventata. Terza volta in un giorno
  che il gate trova lo stesso schema, dopo R4 e R7-euro.
  **Set adottati: `euro → R0c + R3c` · `Serie A → R3 + R7 + R13`.** Sull'euro restano due
  miglioramenti dimostrati, uno dei quali è il modello nullo; su Serie A il set tiene 7/7.
  **La sola passata di scraping che conta**: SofaScore su 19/20-22/23, perché senza i minuti storici le
  finestre vecchie sono cieche esattamente sulle regole che il motore usa. Poi, a costo quasi nullo:
  euro 18/19 (~5 min) e Serie A 17/18-15/16 (~20 min) per quattro finestre in più.
  Impossibili: voti EuroLeghe 21/22 (file vuoti alla sorgente) e la storia di `probable_starter`.
- **Vista «Auction» nella GUI** (terzo tab, spec §Vista Auction): stagione / piattaforma / game
  selezionabili e, per ogni ruolo, i 10 di VALORE previsto più alto con l'**FVM effettivo di fine
  stagione** accanto, più i 10 realmente migliori con il **VALORE che il motore aveva previsto**.
  Passa dalla stessa `evaluate.auction_view` del gate, quindi pannello e `backtest --auction` non
  divergono. Nuove colonne `rosters.fvm` / `fvm_mantra` (rendicontazione, mai input).
- **Simulazione dell'asta 25/26** (`backtest --auction`, §3-bis del documento del gate): 15/40 nomi
  azzeccati, ma **80% (euro) e 81% (Serie A) del VALORE** che avrebbero reso le top 10 perfette. La
  metrica dei nomi tratta ogni errore allo stesso modo; quella dei punti dice che gli errori del motore
  sono fra giocatori comparabili. Gli errori residui si dividono in **cambio di regime** (14 sull'euro,
  giocatori esplosi da un anno all'altro) e **mai prezzati** (8 su Serie A, di cui 4 attaccanti su 10 →
  quel ruolo è tappato a 6/10 finché la copertura Serie A non migliora).
- **I 3 numeri presenze/T1 sono spiegati** (era il blocco n.1): i coefficienti rifittati coincidono col
  pubblicato entro 0.015, quindi non è il codice; non è nemmeno la definizione dei segmenti (testata);
  è la **composizione del campione** (764/774 giocatori contro 750/754) su un effetto da −1.6%. Del
  modulo presenze è confermato il **bias**, non il guadagno di MAE su T1.
- **9 ipotesi falsificate con motivo registrato**, fra cui: sconto adattamento cross-lega (segno opposto
  fra finestre), propensione per-90 (γ≈0 di segno sbagliato), **àncora forza-club da Elo ri-bocciata la
  terza volta**, rigoristi in forma ridotta, concorrenza posizionale (migliora il MAE **col segno
  contrario all'ipotesi**), attesa di mercato e sua revisione.
- **Due difetti dei dati corretti dal gate**: l'FM-equivalente dei **portieri** era gonfio di +1.06
  (nessun termine gol subiti → ora NULL) e il **prezzo era di fine stagione** (`Qt.A`): ora c'è
  `rosters.price_initial` = `Qt.I`, la quotazione d'asta, e i tier degli arrivi la usano.

## LAYER PER-PARTITA COMPLETATO — FATTO (27 luglio 2026)
`positions --layer complete` (merge incrementale sulla cache) ha portato il layer da 3.314 a **5.254
partite su 5.256 = 100%** di tutte e 5 le leghe × 3 stagioni; `external_match_stats` a 110.597 righe.
**Il bias di selezione è sparito**: 0 club con layer incompleto contro 12/12/11. L'FM-equivalente degli
attaccanti dimezza il MAE (0.249 → 0.133) e passa dal 67% al **94%** entro 0.3 dalla fantamedia reale.
Le feature di input del motore ora si aggregano dal layer per-partita (identità indipendente dalla
stagione) e non dagli aggregati stagionali: **copertura euro dal 31% al 42-43%** del listone, **β_new
raddoppia** (0.19 → 0.43), Ezzalzouli passa da fuori-classifica a VALORE 110. Set adottati invariati.
Due verdetti corretti (R2 e R8: l'instabilità di segno era dei dati) e un effetto vero con l'etichetta
sbagliata da ri-pre-registrare — tutto in `gate-motore-v1.md` §5-bis.

## GIOCATORI PREZZATI SENZA STORICO — FATTO (27 luglio 2026)
Nuovo modulo **`recent_form`**: per i giocatori che il listone prezza sopra la mediana del loro ruolo e
di cui non abbiamo niente (arrivano da Eredivisie, Championship, Liga Portugal, Serie B, Süper Lig…),
scarica le ultime N partite di club con rating e minuti, **datate**, sotto `source='sofascore_recent'`
per non contaminare la retta del voto sintetico. **113 giocatori, 1.094 partite, 89% di identità
risolte.** Il gate ha spezzato la regola che le usa: **quanto** gioca si trasferisce (R13, presenze dai
minuti al vecchio club: ✅ su tutte e tre le piattaforme, adottata), **quanto bene** gioca no (R13b,
rating confrontato fra campionati: ❌, λ −0.45/+0.05). Copertura del motore sull'euro **dal 31% al
45-49%** del listone. Dettaglio in `gate-motore-v1.md` §5-ter.

## PROSSIMO LAVORO
1. **Storico `injuries`**: l'unico input della Priorità 1 ancora assente (Transfermarkt, una richiesta
   per giocatore). Metà dei buchi nelle top-10 dei difensori sono infortuni.
3. **Terza finestra**: verificare quanto indietro va l'API Excel dei voti. Con T0 = 22/23→23/24 i
   parametri che oggi oscillano (età −0.006/−0.016, δ_cross −0.04/+0.16) diventerebbero identificabili.
4. **Ad agosto, quando esce**: listone/quotazioni 26/27 → aggiungere `2026-27` alle costanti `SEASONS`
   (`ratings.py`, `positions.py`, `transfers.py`), scaricare voti e Elo alla data d'asta 2026-08.
   Salvare anche `Qt.A M`/`Qt.I M`/`FVM`, già presenti nel file.
5. **Non misurabile con i dati attuali** (registrato, non da riproporre): il modello piazzati — la
   colonna `assists_set_piece` è NULL su tutte le righe di voti di ogni stagione, la sorgente non ha mai
   splittato gli assist. E `probable_starter`/`availability` esistono solo come snapshot di oggi:
   usabili live per l'asta 26/27, inutili nel gate retrospettivo.
6. Poi: algoritmo completo asta 26/27.

## Convenzioni operative
git = casa canonica (Drive solo su richiesta esplicita) · risposte in chat in **italiano**, tutto il repo (codice, commenti, log, nomi file, .md) in **inglese**; i doc KB in `docs/model/` restano in italiano · `fc_id` chiave primaria · credenziali solo in `.env` · **quando l'utente scrive "chiudi"**: consolidare tutti gli .md di `docs/model/` (+ CLAUDE.md se serve) con stato/decisioni/commit/prossimi passi e committare.
