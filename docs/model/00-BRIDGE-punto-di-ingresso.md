# 00 — BRIDGE · Punto d'ingresso del progetto (leggere per primo)
**Aggiornato: 28 luglio 2026 (seconda chiusura della giornata: coppie d'attacco)** · Questo file inizializza qualsiasi sessione/strumento nuovo. Il prefisso "00" lo tiene in cima alla cartella.

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
proporre qualsiasi regola) → **`metrica-asta-surplus-v1.md`** (con cosa il pannello ordina, e perché non
è VALORE) → `spec-euroleghe-ingest-v9.md` → `nota-modello-set-pieces-v2.md` →
`modello-previsionale-v3.8.md` → consolidati di dettaglio. Tutti in `docs/model/`.

## STATO AL 28 LUGLIO 2026 (sera) — LEGGI QUESTO PRIMA DI TUTTO

Le sezioni sotto sono un **registro cronologico**: dove una contraddice questo blocco, vince questo.

### ULTIMO IN ORDINE DI TEMPO — il TOOLKIT è completo, esporta, si ricostruisce da zero, e ha una UI nuova

Quattro richieste dell'utente in una sessione (28/07 sera-notte). Dettaglio tecnico:
`spec-euroleghe-ingest-v9.md` «**Novità v9.4**» e `toolkit/README.md` (che ora è anche la guida
d'installazione su una macchina nuova). **Nessun verdetto del gate cambia: qui non è entrata nessuna
regola.** Sono dati, strumenti e infrastruttura.

1. **I due buchi dichiarati sono chiusi.** `injuries` (nuovo modulo Transfermarkt: assenze datate con
   **`matches_missed`**, non solo i giorni) e la **heatmap** → `positions.avg_x/avg_y`. ⚠️ Scoperta che
   vincola il gate: la scadenza contratto **esiste solo sulla rosa di oggi** (la pagina di una stagione
   passata non porta quella colonna), quindi `exit_risk` è utilizzabile per l'asta che viene e **non è
   gatabile su T1/T2**. Registrato tra i `known_gaps` del bundle, non nascosto.
2. **La domanda aperta sui reparti D e C ha una risposta misurata** (`positions --layer crosstab`, su
   149 585 presenze): provider **G→P 100%**, **D→D 97%**, **M→C 80%**, **F→A 80%**. Estendere i
   conteggi di reparto ai **difensori è pulito**; per i centrocampisti costa la stessa ambiguità già
   accettata sugli attaccanti. Era il prerequisito dichiarato in todolist.
3. **`export`: il bundle dell'app esiste.** 229 116 righe, **29 MB** SQLite + 2,5 MB JSON gzip, 21
   tabelle. Il contratto è **derivato da quello che `engine/features.py` interroga davvero**, e il
   `manifest.json` porta provenienza (commit + data), **quali prezzi sono auction-safe**, i parametri
   provvisori **con i loro valori**, il set adottato e i buchi noti. `--verify` ri-apre il bundle e
   distingue *bundle rotto* da *buco del mondo*. `data/export/` è gitignored: **il repo è pubblico**.
   ⚠️ **Verificato eseguendo il motore SUL bundle**: output identico al DB. Ha trovato due difetti che
   rileggere il contratto non avrebbe visto — le righe `sofascore_recent` sono etichettate con la
   stagione del listone (570 buttate) e **`--history` deve coprire la finestra di cross-fit**, perché i
   coefficienti sono fittati là: con 2 stagioni le metriche del gate combaciavano tutte e **la lista
   d'asta no**. Default 3, bundle 39 MB. E inseguendo quella differenza è saltato fuori che **il
   ranking d'asta non era deterministico** (decine di giocatori prezzati all'àncora a pari VALORE,
   ordinati dall'ordine fisico delle righe): tie-break su `fc_id`, nessuna previsione cambia, `--verify`
   resta 15/18, e si sposta **un** portiere da miss «near» a «regime» — che per i prezzati all'àncora
   era un'etichetta già arbitraria.
4. **Ricostruibile da zero su un'altra macchina.** `bootstrap --plan` = 15 passi, ordine, opzioni e
   costo (**~17 h**, ripartibile), e rifiuta di partire senza credenziali. Tre buchi reali chiusi per
   arrivarci: `elo` non legge più un CSV fatto a mano ma l'**API ClubElo** (effetto: `club_elo` da 76
   righe su 2 date a **921 su 10 date, 99 club**), la **lega di un club** si deriva dalla cache
   provider (il listone euro non la dice, e gli export Drive una macchina nuova non li ha), e `fetch`
   non è più uno stub (`--plan` = «cosa manca qui», `--inbox` = l'unico passo manuale, opzionale).
   Aggiunti `.env.example` (era citato e non esisteva) e `config.SEASONS` come fonte unica.
   **`ingest_runs` finalmente si scrive**: una riga per run, dalla CLI, dal rebuild e dalla GUI.
5. **UI rifatta** (`ui_theme.py`): palette semantica light/**dark** con toggle ricordato, icone per
   operazione, card per cadenza, striscia di metriche, log colorato per severità, status bar con
   l'ultimo run. Aggiunti i pulsanti che mancavano: **Bootstrap**, **What is missing?**, **Export**.
   Pillole ruolo e celle-stato dei fantavoti **non** sono tematizzate di proposito: sono codifiche di
   dato. **194 test verdi, ruff pulito, nessun test tocca la rete.**

### due attaccanti dello stesso club nelle top-10: chiuso in tre pezzi

La domanda («è discutibile avere Kean+Piccoli o Marmoush+Haaland nei top 10: uno farà più bonus
dell'altro») è stata attaccata direttamente, con dati nuovi presi **senza una richiesta di rete**, e ha
prodotto **un verdetto negativo, una valuta spenta e una colonna che spedisce**. Doc:
`attacco-affollato-r17-v1.md` (pre-registrazione + esito), `metrica-asta-surplus-v1.md` §11,
`spec-euroleghe-ingest-v9.md` «Novità v9.3».

1. **Dati (v9.3, offline)**: sei colonne di tiro su `external_match_stats` e la tabella nuova
   **`club_match_lineups`** (quanti G/D/C/A schiera ogni club, per undici). Erano nei blob già in cache.
   Da qui **K = attaccanti per undici** (Inter 24/25 = 2.05, Fiorentina = 1.71) e i **co-start**
   (Lautaro+Thuram 23, Lautaro+Taremi 3). ⚠️ Difetto trovato **misurando**: contare i reparti passando
   per l'imbuto dell'identità distruggeva il campione (Serie A 24/25: 233 undici su 774, Juventus
   **zero**) — perciò i conteggi di club stanno fuori da quell'imbuto.
2. **R17 (affollamento come regola d'errore): NON PASSA**, ed è la bocciatura più istruttiva del set.
   Il coefficiente è **negativo e stabile ovunque** (Serie A −0.055…−0.097, dispersione 0.24, 6/6 ·
   euro −0.047…−0.067, dispersione 0.15, 4/4): il meccanismo **c'è**. Ma i giocatori che sposta
   **peggiorano su 9 combinazioni finestra×piattaforma su 10** (Serie A robusto 1/6, media −7.3%,
   peggiore −14.9%). **Quinta** formulazione dell'affollamento a cadere sull'errore (R11, R11b, R16,
   R16b, R17). E il diagnostico dice perché: su T1/T2 le coppie top-15 dello stesso club hanno reso
   entrambe **23 volte su 23** (Kean 175 su 199 previsti + Piccoli 170 su 189; Marmoush 272 su 189 +
   Haaland 204 su 188), e il «numero 2» che R17 avrebbe punito ha reso **1.04×** il previsto contro
   1.07× di chi risparmiava. I flop veri (Lukaku, Dovbyk, Mosquera) stavano **fuori** dalle coppie.
3. **Pressione di reparto (valuta d'asta, non gate): misurata e SPENTA.** Su richiesta esplicita
   dell'utente — «il rischio di comprare quello scadente deve penalizzarne il valore, e il posto
   garantito per carenza di concorrenza merita un premio» — con protocollo dichiarato prima:
   VALORE catturato **−0.61%** (limite −2%: passa) ma **tasso di bust 10.1% → 10.1%, identico su ogni
   singola finestra** (non passa). La spiegazione vale più del verdetto: **i flop dei reparti contesi
   non stanno nelle top-10 predette** — Openda e David erano **imprezzabili** per il motore, quindi
   nessuna lista li proponeva e nessuno sconto poteva salvare da un acquisto che il motore non
   suggeriva. Il fattore resta nel motore (`surplus_pressure`, testato) e **non è offerto dal pannello**.
4. **Quello che spedisce è la colonna `Pair`** nel tab Auction: per ogni nome in coppia, il compagno,
   K, i co-start e il ΔQt.I — la stessa evidenza al decisore **senza riordinare niente**.

⚠️ **Da qui la voce a leva più alta di tutto il progetto, che non era in cima all'elenco**: finché i
**nuovi arrivi senza storico non sono prezzabili**, nessuna metrica d'asta li tocca — né in bene né in
male. È il buco che ha reso inutile la pressione di reparto, e ha già una strada pre-registrata
(R13c, ferma su un muro di campione, non di ipotesi).

### È cambiata la VALUTA dell'asta, non il motore: `metrica-asta-surplus-v1.md`

Il pannello Auction ordina per **SURPLUS = (FM − rimpiazzo) × Pv × beccabilità**, con una soglia minima di
schierabilità, e apre su quella. `VALORE = FM × Pv` resta disponibile e resta il deliverable
pre-registrato: `auction_view` ha default `metric='value'` e `prepare()` non calcola alcun livello di
rimpiazzo se non gli passi la configurazione di lega, che il gate non fa. **I numeri del gate sono
invariati al numero.**

Perché: misurato, `VALORE` era quasi solo presenze — CV(FM prevista) 0.012-0.032 contro CV(Pv previste)
0.24-0.44, e ρ di rango con VALORE 0.19-0.44 contro 0.92-1.00. Nessun coefficiente fittato: la profondità
di rosa viene dalla regola di lega (`config/league_config.json`, 8 squadre 3/8/8/6) più i **tetti di
schieramento misurati** su 2903 undici titolari (p90: `dc` 3, `pc` 2 — esattamente i limiti dei moduli).
L'esponente di beccabilità 0.5 **non è una preferenza**: riproduce la curva misurata della quota di
presenze che un manager riesce a beccare (0.40 sotto il 20% di disponibilità → 0.89 sopra l'80%).

Esito: **23 nomi su 70 contro i 22 di VALORE** — non costa nomi — e Dimarco 1°, Rice dentro, Haaland 5°,
Politano/L.Henrique/De Roon/Colombo/Lauriente/Piccoli fuori, Lukaku non classificato.

### Sei candidate provate il 28/07: **zero adottate**. I set adottati NON cambiano
*(contando anche le tre registrate a parte — R13c, R5b, R3d — e **R17** della sera, la giornata chiude a
**dieci provate, zero adottate**, e i set restano `euro R0c+R3c` · `Serie A R3+R7+R13`.)*

Dettaglio e numeri in `gate-motore-v1.md` §5-quinquies. In sintesi: **R15** (persistenza disponibilità) è
il quasi-passaggio più vicino di tutto il set e su euro ha un coefficiente **stabile** (+0.074…+0.096 su 5
finestre) — là il quasi-fallimento è l'**ampiezza**, non l'instabilità, e il gate oggi non sa distinguere
i due casi. **R16/R16b** (affollamento) bocciate, e R16b ha il **segno opposto all'ipotesi**: misura forza
offensiva del club, non affollamento. **R13c** (produzione misurata) batte la sua predecessora R13b ma ha
14-21 osservazioni valutabili per finestra. **R5b** (forza-club dagli xA) **passa formalmente su Serie A
3/3 e non è adottata**, perché era pre-registrato che un passaggio sulle sole T0/T1/T2 — le finestre di
generazione dell'ipotesi — non confermi nulla.

⚠️ **Famiglia «persistenza» CHIUSA sul lato previsionale** (28/07 sera): la persistenza della
disponibilità è reale **dentro** una stagione (0.29-0.36) e **non si trasferisce** a quella dopo — ρ
indistinguibile da zero su 15 finestre su 15, contro 0.29-0.47 della curva di popolazione già spedita. La
costanza è una proprietà della stagione, non del giocatore, e questo spiega anche la caduta di R15.

⚠️ **Da non rifare**: una correlazione a livello di **club** (misura di input ↔ gol del club l'anno dopo)
**non predice** quale misura aiuti la fantamedia di un giocatore. È contro-informativa: xA sembrava la
migliore su euro (0.66) e la regola là fallisce; su Serie A tutto sembrava debole e la regola là passa.

### Il gate ha cambiato criteri due volte, ed entrambe le volte prima di rilanciare

1. **Stabilità del coefficiente** (§5-sexies): *classifica* e non giudica — separa «piccolo e stabile» da
   «rumoroso» senza cambiare nessun verdetto. Ha subito trovato che **R3, che è adottata, ha il coefficiente
   instabile** — che non è un difetto ma collinearità: il coefficiente non è *interpretabile*, la regola
   funziona (10/10).
2. **Non-danno elastico** (§5-undecies): prima tollerava zero, ora tollera un **2% sull'aggregato** — lo
   stesso `MAX_WINDOW_LOSS` del verdetto robusto — ed è **vincolante anche per l'accuratezza**. Nessuna
   adottata disarcionata (euro 121→127, Serie A 136→149).

### Due famiglie CHIUSE, non sospese

- **Forza-club** (§5-nonies), su decisione presa ad alta voce dopo la quarta bocciatura. Segno giusto tutte
  e quattro le volte; l'input è derivabile dalla fantamedia del giocatore stesso, quindi **non
  incrementale** — come R14 e R16. Costo accettato: Kane +2.35 di errore resta senza spiegazione per questa
  via, e il residuo indica **beta non costante**, che è un meccanismo diverso e già pre-registrato.
  Riapribile **solo** con una misura prospettica, non con finestre nuove.
- **Persistenza sul lato previsionale**: la costanza è una proprietà della **stagione**, non del giocatore —
  ρ indistinguibile da zero su 15 finestre su 15 fra persistenza di input e beccabilità bersaglio.

### Regola nuova, applicata a tutto il documento

**Un coefficiente senza piattaforma, baseline dei residui e data non è un fatto** (§5-septies, §5-octies).
Audit: **5 su 12** dei λ citati si riproducono, due solo contro la baseline pre-due-passate — e uno di quelli
portava un'interpretazione che il segno corretto **ribalta** (R11 *conferma* la sua ipotesi). Trovate anche
due conclusioni scritte al singolare su una quantità che dipende dalla piattaforma (R2, R6).

### Il caso Kean + Piccoli è aperto in modo DIVERSO da come sembrava

Non è «in attesa di uno stimatore migliore»: la penalizzazione per attacco condiviso **non è nei dati** —
il segno misurato va nell'altro verso. Separare forza-club da affollamento richiede i due termini in un
fit solo, che è in parte la quarta corsa a una famiglia bocciata tre volte: decisione da prendere ad alta
voce, non rifinitura da infilare.

**Aggiornato la sera del 28/07 (blocco in cima)**: la separazione è stata fatta, con l'uso rivelato
(attaccanti schierati per undici) al posto della produzione. Il segno esce **giusto e stabile** — quindi
l'affermazione «il segno va nell'altro verso» valeva per R16b, che misurava i gol, non per K. Ma R17 cade
**sull'errore**, e il diagnostico ha ribaltato la premessa del caso: su T1/T2 Kean **e** Piccoli hanno
reso entrambi, come 23 coppie su 23.

### Il gate gira su 10 finestre (Serie A) e 5 (euro)

L'API dei voti autenticata serve stagioni che i dataset Drive non hanno mai coperto. Nel DB: **Serie A
dal 15/16 al 25/26** (11 stagioni → 10 finestre, Tm7…T2) e **euro dal 18/19 al 25/26** (il 21/22 è
**vuoto alla sorgente** — id risolto, 30 giornate scaricate, ogni cella `Voto` = `'-'` — e costa due
finestre: 5 utilizzabili). Una finestra richiede voti su **entrambi** i lati, ingresso e bersaglio.

### Set adottati: `euro → R0c + R3c` · `Serie A → R3 + R7 + R13`

| | tiene su | media | peggior finestra |
|---|---|---|---|
| euro R0c+R3c | **4/4** misurabili | +2.4% | +1.0% |
| Serie A R3+R7+R13 | **10/10** | +4.3% | +1.2% |

- **R7** (persistenza portieri) e **R3** (minuti) non hanno **una sola finestra contro** su 10; il
  criterio stretto le boccia solo per una finestra a +0.1%/+0.2%, sotto la soglia dello 0.5% → si leggono
  con il verdetto **robusto**.
- **R7 era uno stimatore sbagliato, non una scommessa**: la persistenza esce 0.505-0.798 su sette
  finestre (sempre sopra lo 0.50 condiviso), ma valutare ogni finestra col coefficiente della *singola*
  vicina — fittata su ~30 portieri — la faceva cadere. `POOLED_PARAMS` mette in comune le altre finestre
  (leave-one-out): da 4/7 a **10/10**.
- **R0c è il modello nullo dichiarato** (àncora di ruolo + quota media): porta la copertura euro dal 30%
  al **100%** e nessuno stimatore sofisticato lo batte sui giocatori che aggiunge.

### Cadute quando le finestre sono diventate dieci (non riproporre senza finestre NUOVE)

**R4** età (1/10, peggiore −19.6%) · **R10** nuovo allenatore (4/10, peggiore −6.3%) · **R8** fuori-ruolo
(1/6, peggiore −19.2%) · R4b (1/10, −56.6%) · R11/R11b (0/10 — ma il coefficiente **conferma** l'ipotesi ed è stabile su 10/10: cadono sull'errore, non sul meccanismo, `gate-motore-v1.md` §5-septies) · R12/R12b (4-5/10, media ≈0) · R1b (3/10) ·
R2 · R5 (**terza** bocciatura della famiglia forza-club, ora **CHIUSA** dopo la quarta: §5-nonies — corretto il 28/07: `gate-motore-v1.md` §4 nomina le due precedenti, forza-club interna ed Elo additivo movimento) · R6 · R13b · R14/R14b (sfora il non-danno) ·
**R1** (non batte la risposta banale: 0.391 contro 0.373 della sola àncora).

R4, R10 e R8 sembravano fra le migliori del motore a due finestre. **T1 e T2 sono le finestre di
generazione delle ipotesi: passare lì è la prova più debole possibile.**

### Cosa manca, in ordine

0. **I nuovi arrivi senza storico non sono prezzabili** (salito in cima la sera del 28/07, vedi il blocco
   ULTIMO IN ORDINE DI TEMPO): Openda e David non stavano in nessuna top-10 predetta, quindi nessuna
   metrica d'asta — sconto, premio o riordino — può proteggere da loro. Sblocca insieme la copertura
   Serie A (punto 3) e la pressione di reparto. Strada già pre-registrata: R13c, che è ferma per
   **campione** (14-21 osservazioni valutabili per finestra), non per ipotesi → il 26/27 la sblocca da sé.
1. **Prezzare l'asta che viene.** `rosters 2026-27` = 0 (il listone non è ancora uscito) *e* l'harness non
   ha una modalità **live**: ogni percorso assume un esito (`_window_is_usable` pretende ≥50 `fm_act`, il
   tab Auction elenca solo stagioni concluse, `auction_view` confronta due liste). Per un'asta serve **una
   lista sola**. È il lavoro più importante e non è iniziato.
2. **Il lato fantamedia non ha un solo miglioramento validato.** Delle cinque regole adottate quattro sono
   presenze e una è copertura: la FM è ancora esattamente il core pubblicato (àncore + beta + M2e). Sei
   famiglie di ipotesi sulla FM sono state provate e sono cadute.
3. **Copertura Serie A**: 8 posti su 40 nelle top-10 reali irraggiungibili, **4 attaccanti su 10** — quel
   ruolo è tappato a 6/10. R0c non passa lì (il core è a 0.281 e una stima di qualità-àncora sfora il +30%
   di un punto): serve uno stimatore che batta l'àncora.
4. ~~**`injuries` = 0 righe**~~ **modulo scritto il 28/07 notte** (Transfermarkt, assenze datate +
   `matches_missed`): la fonte è agganciata e la camminata per-giocatore gira. Resta da **usarlo**, che
   è una domanda da gate: `_inactivity` oggi stima le assenze dai buchi del layer per-partita
   («l'injury proxy»), e sostituire una stima con un fatto è un'ipotesi nuova, da pre-registrare.
5. **Storia di `probable_starter`/`availability`**: esiste solo lo snapshot 2026-07-26, **impossibile a
   posteriori**. Il job settimanale ora c'è (`scripts/weekly-snapshot.ps1 -Register`) — **va registrato
   sulla macchina**, ed è la forma pre-registrata di R7. Ogni settimana non registrata è una finestra
   che non tornerà.
6. A rendimento calante: voti Serie A prima del 15/16 (non sondati), layer per-partita per 15/16-18/19
   (servirebbe solo a ri-testare R8 e R14, già bocciate). ~~`club_elo` oltre le 2 date~~ **risolto**:
   l'API ClubElo dà tutte e 10 le date d'asta (921 righe, 99 club) — serve al modulo portieri, non a R5
   (famiglia chiusa).
7. **La conferma pulita resta la finestra 26/27, giugno 2027**: tutto l'adottato è stato generato
   guardando gli esiti di T1/T2.

### Dati e strumenti

`validate`: **5759 giocatori Mv- e FM-consistenti, 0 FM-off**. 218k+ righe `match_ratings`, 2.28M bonus
grezzi, `external_stats` su 11 stagioni, `external_match_stats` su 7 (109k righe dal layer per-partita
completato), `matchday_map` per lega anche sulle stagioni vecchie, voto sintetico ricalibrato
(MAE fuori campione **0.369**), FM-equivalente su 1482 arrivi.

Dalla v9.3: sei colonne di tiro su `external_match_stats` e **`club_match_lineups`** (conteggi di reparto
per undici, fuori dall'imbuto dell'identità); `probable_starter` tiene modulo, squadra e panchine;
`positions --layer reparse` ri-parsa la cache senza rete.

Dalla **v9.4**: `injuries` (assenze datate + `matches_missed` + `contract_until`/`exit_risk`),
`positions.avg_x/avg_y` dalla heatmap, `club_elo` **921 righe su 10 date** dall'API, `ingest_runs`
scritta, `config.SEASONS` fonte unica, `bootstrap` (acquisizione da zero, ~17 h ripartibili),
`fetch --plan/--inbox`, **`export`** (bundle app: 229k righe, 29 MB, manifest con provenienza e buchi
noti), UI con tema light/dark. Cross-tab ruoli: **D→D 97%**, M→C 80%, F→A 80%, G→P 100%.

**194 test verdi, ruff pulito** (nessuno tocca la rete). Toolkit **v0.2.0**. `recent_form` ha `--bonuses-only`
(arricchisce i bonus delle partite già salvate, una richiesta per partita, senza ri-risolvere l'identità):
**1195/1196** partite arricchite, **122/123** giocatori completi. `python -m euroleghe_ingest backtest [--verify] [--gate] [--auction]
[--cases] [--pairs] [--window Tm7..T2] [--platform euro|default] [--game classic|mantra]`. GUI: tre tab, il terzo è
**Auction** (stagione/piattaforma/game/**Rank by**, per ruolo i 10 migliori previsti con l'FVM reale
accanto e i 10 reali col previsto — nella valuta scelta, SURPLUS per default, più la colonna **Pair**
per i compagni di reparto in classifica). Backup: `scripts/backup-data.ps1` specchia `data/` fuori dal
repo — la cache **deve** restare in `.gitignore` (gli Excel vietano la ripubblicazione, il repo è pubblico).

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

## GATE — il registro di come ci si è arrivati (27 luglio 2026)
*Lo stato corrente è nel blocco in cima; qui sotto la cronologia, che in punti è superata.*
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
  **Layer per-partita COMPLETATO**: 734 round (la Ligue 1 19/20 finì al 28°, COVID), **109.126** righe
  `external_match_stats`, `matchday_map` per lega anche sulle stagioni vecchie, voto sintetico
  ricalibrato (MAE fuori campione 0.369) e FM-equivalente su 1482 arrivi invece di 267. Esito finale:
  **euro R0c+R3c tiene 4/4** (media +2.4%) e **Serie A R3+R7+R13 tiene 10/10** (media +4.3%). R3c passa
  4/4 dove è misurabile; **R3 e R7 non hanno una sola finestra contro** (robuste sì, strette no, per una
  finestra a +0.1%); **R8 ora misurabile e bocciata 1/6** con la peggiore a −19.2%. Asta: Serie A
  **136→149 nomi su 400** con VALORE catturato su 8 finestre su 10, euro 42→44 su 200.
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
