# 00 — BRIDGE · Punto d'ingresso del progetto (leggere per primo)
**Aggiornato: 7 agosto 2026 (quattro difetti trovati aggiornando i dati, tutti e quattro chiusi: l'ultimo con la migrazione della quotazione per piattaforma)** · Questo file inizializza qualsiasi sessione/strumento nuovo. Il prefisso "00" lo tiene in cima alla cartella.

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
è VALORE) → **`assistente-asta-v1.md`** (cosa l'assistente fa al tavolo: tre domande, tre numeri, e le
regole di UI che sono requisiti) → `spec-euroleghe-ingest-v9.md` → `nota-modello-set-pieces-v2.md` →
`modello-previsionale-v3.8.md` → consolidati di dettaglio. Tutti in `docs/model/`.
L'altra fase, quella settimanale, è **`formazione-settimanale-v1.md`** (progetto): chi gioca domenica, perché
la pagina delle probabili non basta e quali vincoli valgono già oggi.

## STATO AL 7 AGOSTO 2026 — LEGGI QUESTO PRIMA DI TUTTO

Le sezioni sotto sono un **registro cronologico**: dove una contraddice questo blocco, vince questo.

### ULTIMO IN ORDINE DI TEMPO — 7/08/2026: «anche la lista euro dovrebbe essere aggiornata»

Sessione di aggiornamento dati, nata da una domanda di controllo. Il foglio euro **era** aggiornato; provando
a dimostrarlo sono venuti fuori **quattro difetti**, tre chiusi e uno lasciato come decisione. Nessuna regola
nel motore: `backtest --verify` **22/22**, **318 test**, `SHEET_REVISION` **2 → 5**. Dettaglio: spec «Novità
v9.32» e «Novità v9.33».

- **CHIUSO la sera stessa, con la migrazione completa** (spec «Novità v9.33»): la **quotazione è un fatto di
  PIATTAFORMA** — i due listoni discordano su **202 Qt.I e 226 FVM** per i ~249 italiani quotati in entrambi
  (Svilar 18/65 Serie A contro 15/56 EuroLeghe) e vinceva l'ultimo che scriveva. Ora `listone_quotes` con
  `platform` nella chiave, più `fvm_history` e **`arrivals`** allargati (un tier è un percentile dentro un
  listone: 82 arrivi su 330 cambiano fascia fra le piattaforme), e il backfill di **tutta la storia** dalla
  cache — 16.375 righe, 12 stagioni Serie A e 9 EuroLeghe, zero richieste. Il rituale «rileggi il listone
  giusto prima di costruire» è morto: `rosters` porta 15/56 e il foglio Serie A stampa 18/65.
- **CHIUSO**: la **rosa live** veniva letta prima del run che la scarica → ogni foglio portava quella del
  giorno prima (35 payload alle 14:24, rose derivate alle 14:22).
- **CHIUSO**: una lettura ora dice **di quale stagione parla** (`probable_starter.season`). La pagina
  probabili serviva l'ultima giornata del 2025-26 a probabilità 1.0, e quelle righe erano 428 su 648 di
  `desc_starter_prob` su un foglio 2026-27, più 415 duelli e 442 asserzioni di rosa. Ora 0 e dichiarato.
- **CHIUSO**: le pagine editoriali **EuroLeghe** (`-euro-leghe`) esistono e nessuno le leggeva — quattro
  leghe su cinque senza segnale editoriale. Ora catturate ogni giorno (oggi ancora vuote: 0 link giocatore).
- **Fonti giù quel giorno**: Transfermarkt irraggiungibile (nessuna pagina rosa dal 29/07 → contratti,
  valori di mercato e infortuni fermi lì) e ClubElo in timeout. fantacalcio.it e il provider funzionano.

### 6/08/2026: quattro adozioni, sei falsificazioni, e il gate che ora vincola il prodotto

Dodici commit, tutti su `master` e **pushati**. **313 test**, `backtest --verify` **22/22**.
Dettaglio: spec «Novità v9.30», gate §7-duodecies → §7-vicies (ogni sezione ha la griglia scritta PRIMA e il
verdetto DOPO).

**ADOTTATE — quattro, tutte da un harness e mai a mano:**
1. `presence.level_weight` = **0.06** — l'Elo del club dove ha giocato i minuti, solo per chi ha cambiato
   club. Serie A robust (+0.93%), euro positivo su tutte e 4 le finestre. Minimo interno su entrambe.
2. `presence.standing_prior_rounds` = **10** — lo standing non sapeva su quante giornate era misurato.
   euro **strict E robust** (+2.82%), Serie A robust. Il risultato più forte della giornata. Col prior
   **condizionato alle giornate**, che corregge la lettura (Milik 26% → 10%) senza migliorare la previsione.
3. **R19** su `default` — il livello dentro `engine_pv_pred`, cioè la strada perché l'esperienza arrivi al
   SURPLUS. **Prima regola adottata sul solo verdetto ROBUST**: 9 finestre su 10 migliorano, media +1.7%,
   liste d'asta più lunghe. Su euro è contro e resta fuori. Da riguardare a ogni gate: se peggiora, esce.
4. **R18** su `euro` — la carriera nella fantamedia prevista (`fm_prev` + media 5 anni, entrambe ristrette
   verso l'àncora). 420 righe su 979 si muovono: Kane 8.758 → 9.215, Haaland +0.48, e chi ha avuto una
   stagione sola scende. Adottata perché **euro/mantra passava già coi criteri vecchi e senza i portieri**.

**FALSIFICATE e scritte — sei**: il bonus qualità fra stagioni · l'esperienza da panchina · l'Elo della
competizione · il bonus ai nuovi acquisti (a cinque sigma, il contrario dell'ipotesi) · lo sdoppiamento del
discount cross/intra · la qualità di carriera in selezione. E tre delle mie previsioni pre-registrate erano
sbagliate, lasciate agli atti.

**IL GATE È CAMBIATO, e va saputo prima di leggere qualunque verdetto vecchio:**
- lo **strict** ha la soglia sulla MEDIA e non su ogni finestra (prima bocciava R3, R7 e R3c, che sono in
  produzione);
- **FM e VALUE** sono letti sull'aggregato, alla tolleranza che avevano già;
- **`captured_not_harmed`**: il gate ora vincola anche **quanto valgono** le liste, non solo quanti nomi.
  Chiude il buco che R3d aveva esposto. Misurato prima di accenderlo: **0 verdetti su 120 cambiano**.
- ⚠️ **Una contaminazione dichiarata**: il criterio su FM/VALUE è nato guardando R18 bocciata. I criteri
  restano (giusti per ragioni indipendenti); il verdetto di R18 su euro/classic no — è per questo che
  l'adozione poggia su euro/mantra, che passava prima.

**DATI E ROSE**: identità gemelle dei club **fuse** (109 → 106), con i trasferimenti fantasma che ne
derivavano **ri-derivati** (Newcastle 26 → 3 arrivi, Eintracht 28 → 12). La rosa live del provider è
l'autorità, con due guardiani (`_club_key` e `SQUAD_COMPLETENESS` 0.90). **Chi è partito non è più nella rosa
del suo club** né nell'undici né nel claim — resta solo nella lista d'asta col `⇥`, perché è contro il listone
che si offre.

**FOGLI PRONTI**: `auction-snapshot-2026-27-euro-mantra-euroleghe-2026-08-06` (979) e
`...default-classic-leghe-2026-08-06` (645), revisione **2**, con indisponibili e rose live al 06/08.

**COSA RESTA APERTO** (nessuno con scadenza):
- `window_standing` non è scoreabile: lo sweep non ricostruisce la finestra di forma per una stagione
  passata (`KNOWN_GAPS`, gate §7-octies ferma per un'omissione dichiarata).
- Transfermarkt non serve più le pagine rosa e lo fa **in silenzio** (`if html:` inghiotte il fallimento):
  la data resta al 29/07 mentre le altre due fonti sono al 06/08.
- R18 non è adottata su `default` e R19 non lo è su `euro`: le due piattaforme si comportano diversamente
  e ogni conclusione va detta al plurale.
- L'assistente d'asta (`assistente-asta-v1.md`) resta **progetto e non codice**, calendario facile incluso.

## STATO AL 5 AGOSTO 2026 (fine sessione) — LEGGI QUESTO PRIMA DI TUTTO

Le sezioni sotto sono un **registro cronologico**: dove una contraddice questo blocco, vince questo.

### ULTIMO IN ORDINE DI TEMPO — 5/08/2026 sera (2): la rosa LIVE decide chi è in rosa, e un audit dei .md contro il codice

Dettaglio in spec **«Novità v9.30»**. 306 test, `backtest --verify` **22/22**. **Nessuna regola del motore
tocca, nessun verdetto del gate cambia** — è tutto strato descrittivo, pannello e documentazione.

1. **La rosa live del provider è la fonte sulle rose, con due guardiani.** Si aggancia con `_club_key` (prima
   con la stringa) e parla solo se il payload copre `SQUAD_COMPLETENESS` = **0.90** della rosa identificata:
   misurata su 172 assenze, precisione 57.6% → 83.1%. Righe marcate 93 → 48, zero nuove.
2. **L'undici non schiera un partito** (`eligible`), in entrambi i modi; la riga resta al suo club col `⇥`.
3. **Identità gemelle in `clubs`: FUSE** (Newcastle 12/60, Eintracht 22/59, PSG 4/37). `fc_club_id` era un
   surrogato coniato sulla stringa esatta; ora `matching.club_identity` + `merge_twin_clubs` in
   `apply_schema`. 109 → 106 club, 4 righe `club_elo` duplicate perse e contate, Eintracht da 0 a 70 spell.
5. **La colonna FM mostra la stima col `~`** quando il core non può prevedere, ordinamento incluso.
6. **`other_platform` applicata fuori popolazione** (Kolo Muani, euro 25-26 = Tottenham): eleggibilità ora
   dal campionato del roster, 13 righe su 651, errori in entrambe le direzioni.
4. **Audit**: 1083 nomi di codice citati dai .md verificati + 30 conclusioni; tutte le costanti pubblicate
   riprodotte; corretti `squad_size`→`squad_slots`, `match_votes`→`match_ratings`, i nomi del pricer greedy
   (`SIDE_PRICE`/`_fit_across`), README 232→306; il calendario facile marcato **progetto e non codice**.

### ULTIMO IN ORDINE DI TEMPO — 5/08/2026 sera: l'ASSISTENTE D'ASTA, progettato prima di scrivere codice

Sessione interamente di ragionamento e misura, **zero codice di prodotto**. Tutto in
**[assistente-asta-v1.md](assistente-asta-v1.md)** (23 sezioni — il documento da leggere prima di toccare l'app)
più il nuovo **`config/mantra_modules.json`**.

**La lega dell'operatore, dichiarata**: 12 partecipanti · **euro/mantra** · rosa di **25 = 2 «porte» + 23** senza
quote per ruolo · **R-Factor** (quindi D-Factor spento) · **draft** con ordine per FVM di rosa crescente, barriera
di giro, parità risolta sul singolo più caro e poi sull'ordine del primo giro · si scegli fino a completare la
rosa, e l'app **impedisce** la scelta che la renderebbe non chiudibile.

**Tre conclusioni di modello, in ordine di peso:**
1. **Una rosa non vale la somma dei suoi giocatori**: vale la somma sulle giornate del **miglior undici LEGALE
   schierabile** (massimo sui moduli × massimo sulle assegnazioni). Una definizione che assorbe rimpiazzo
   personale, scarsità di ruolo, flessibilità e il caso «5 Pc».
2. **Il regolamento Mantra è configurazione, non misura** — undici moduli, caselle **tipate** e ibride, matrice
   delle sostituzioni; trascrizione **verificata 11/11** contro la regola ufficiale 5+5 e contro i nomi dei moduli.
   Da qui, senza fittare niente: un **`Pc` sta in massimo 2 caselle** (in 7 moduli su 11 in una sola) contro le 3
   di un `A`; la **difesa scegli una FAMIGLIA** (5 moduli a tre dietro, 6 a quattro) e **5 difensori le tengono
   vive entrambe**; `Dc` è l'unico difensore con un posto in ogni schema.
3. **In un draft il prezzo è pubblico e fisso** (l'FVM), quindi cadono tetto di rilancio e modello di prezzo di
   mercato — e il draft, a differenza dell'asta a rilanci, **è simulabile, quindi pre-registrabile**.

**Misure nuove** (cautele nel documento): vantaggio campo Serie A **29 punti Elo** su 1140 partite — non i 60-100
di convenzione, ed è una **costante, non una serie annuale** · difficoltà del calendario **6.7 contro 147** su una
stagione (morta per ordinare il draft) ma **113 dentro una singola giornata** (viva per la scelta settimanale della
porta), e il calendario euro **raddoppia** lo spread saltando 7 giornate su 38 · vantaggio di campione **1.64×**
(24.5 presenze contro 18.4) · numerosità dei ruoli che varia ~10% a stagione, e **`b` non esisteva prima del
2024-25** · 24 porte su 46 club = **52% del pool**, e il formato è **impossibile su Serie A** (24 > 20).

**Due difetti trovati, entrambi silenziosi**: `Config._league_setup` **cancella** la dimensione «senza quote»
(fonde sempre `DEFAULT_SQUAD_SLOTS`, quindi la rosa da 25 con 2 porte verrebbe letta 3P/8D/8C/6A → livelli di
rimpiazzo verosimili e **sbagliati**; per questo la lega **non è ancora in `my_leagues`**); e un **join per NOME**
in una mia misura aveva perso Milan, Roma e Napoli (`AC Milan` ≠ `Milan`) — le medie aggregate hanno tenuto, la
graduatoria per club no. Lezione promossa in `CLAUDE.md`.

**Prossimo passo definito** (§16.4): tre modifiche piccole e insieme — `config.py` (`squad_slots` — FATTO, quote opzionali,
blocco `keeper`, `factor`, blocco `auction`), `features.roster_depth` che **rifiuta** invece di inventare, poi la
lega dichiarabile. Dopo: il refactor dell'assegnamento fuori da `gui.py` e il simulatore di draft.

**Acquisizioni che bloccano numeri veri**: listone **euro 26/27** · **calendario** della stagione · **ClubElo
giornaliero + club fuori perimetro** (fuori dalla Serie A l'avversario ha un Elo in ~metà dei casi) · la **scala
dell'R-Factor** dalle impostazioni di lega · lo **storico FVM** dal dettaglio calciatore.

### 5/08/2026 sera: UNA lista sola, filtrabile — la decisione presa col numero davanti

Spec **«Novità v9.29»**, gate §7-undecies. Rovescia il punto 2 del blocco sotto, e lo rovescia **l'operatore, non
una misura**: «*stimati e misurati vanno insieme ma aggiungiamo la possibilità di filtrare gli uni e gli altri*».
`auction_view(..., include=...)` con `all` (come apre il pannello) · `measured` · `estimated`; il selettore
**Include** **ri-disegna e non ricalcola** (l'aritmetica gira su dati già preparati), quindi il filtro è
istantaneo e la scelta torna reversibile *a ogni sguardo* invece che a ogni build. Il **gate non passa mai**
`estimates` né `include`: i suoi percorsi restano quelli di sempre.

- **Il costo resta a verbale e il pannello continua a dirlo**: ordinarli insieme abbassava il SURPLUS catturato
  su **10 finestre su 10**, media **−12.40%**, peggiore **−30.34%** (gate §7-undecies). La decisione è stata
  presa con quel numero davanti, che è esattamente il modo in cui questo progetto vuole che si decida.
- **Il modo in cui falliscono è VARIANZA, non bias**: Douglas Luiz previsto +28.6 e reso **−3.2**, contro
  McTominay +16.0 e reso **+50.2**. Media negativa, dispersione enorme — quindi un filtro serve più di un
  divieto.
- **Invariante che sopravvive al filtro**: qualunque sia `include`, **ogni cifra del blocco è calcolata sulla
  lista che il filtro ha prodotto**. È la lezione del punto 3 sotto, che aveva già morso una volta: una lista
  mostrata le cui metriche descrivono un'altra lista *sembra* misurata, ed è peggio di nessuna metrica.

### 5/08/2026: stimati e misurati INSIEME, con un filtro (decisione dell'operatore)

«Stimati e misurati vanno insieme ma aggiungiamo la possibilità di filtrare gli uni e gli altri» — spec
**«Novità v9.29»**. Presa **col numero davanti**: la misura di §7-undecies (insieme costa −12.40% di SURPLUS
catturato su 10 finestre su 10) resta scritta accanto alla scelta, non cancellata.

1. **`auction_view(..., include=)`**: `all` (default) · `measured` · `estimated`. Il filtro decide chi entra in
   classifica, e **ogni cifra del blocco è calcolata dalla lista che il filtro produce** — il vincolo che la
   sezione qui sotto ha imparato a caro prezzo.
2. **Tre liste in una passata**, quindi il selettore **Include** ri-disegna e non ricalcola: istantaneo.
3. **La scelta è visibile mentre la si usa**: la riga di stato dice quale filtro è attivo, l'intestazione del
   ruolo quanti dei dieci sono stimati (`~`).
4. **Il gate non passa mai** `estimates` né `include`: `backtest --verify` 22/22.

### 5/08/2026: la stima messa alla prova (la parte «non classificata» è superata dal blocco sopra) *(punto 2 superato dal blocco sopra)*

Nuovo comando **`estimates`**, gate **§7-undecies**, e un verdetto che ha cambiato il disegno fatto un'ora prima.

1. **La misura**: la vista d'asta due volte su ogni finestra, con e senza stime. Su Serie A il SURPLUS catturato
   **peggiora su 10 finestre su 10**, media **−12.40%**, peggiore **−30.34%**, e i nomi in comune scendono
   (Tm4 17 → 12). Il criterio scritto prima non è soddisfatto: gli stimati **scalzano** uomini misurati. Su euro
   **0 stimabili** su ogni finestra, quindi quel +0.00% **non è un PASS** — R0c prezza già tutti.
2. **Applicato**: gli stimati escono dalla classifica e sono **offerti a parte**, sotto i dieci, con `~`, base e
   penalità. Ogni riga continua ad avere un numero (foglio e tabella rosa): quello che la misura ha rifiutato è
   che un numero ricostruito prenda il posto di un uomo misurato. Casi: Douglas Luiz +28.6 → **−3.2 reale**,
   Rugani → **non ha mai giocato**, contro McTominay +16.0 → **+50.2**. Media negativa, varianza enorme.
3. ⚠️ **Lezione, e ha morso nella stessa ora**: la prima implementazione univa gli stimati alle righe MOSTRATE
   lasciando `captured`/`hits` sulla lista gatata, e la misura stampava **+0.00% su 10 su 10**. Una lista
   mostrata le cui metriche descrivono un'altra lista è peggio di nessuna metrica: *sembra* misurata.

### 5/08/2026: la LISTA d'asta ordina anche gli stimati (superato dal blocco sopra)

Spec **«Novità v9.27»**. Completa «ogni calciatore DEVE avere il suo SURPLUS» **dove si decide**: il foglio
dava 629 numeri su 629 e la lista d'asta ne ordinava **346**.

1. **Un solo ranker**: `auction_view(..., estimates=None)`, e il gate non le passa mai — `backtest --verify`
   22/22, più un test che pretende la vista **identica** senza stime. Le costruisce il layer del foglio, non
   una seconda cascata.
2. **Marcate**: `~` davanti al numero, l'intestazione dichiara i due insiemi («of 134 the engine could price
   **+ 109 estimated (~)**») e la riga di stato conta entrambi (361 prezzati, **488 stimati**).
3. **Misurato**: gli stimati che entrano in una top ten sono **quattro** — Martinez Quarta #5 (`older`),
   Berisha #4 e Kostic #7 (`shrunk`), Santos A. #7 (`shrunk`). Gli altri restano sotto: la penalità li ordina
   dove la loro incertezza li mette.

### 5/08/2026: NESSUN job settimanale, e la richiesta è chiusa

Decisione dell'operatore: «il job ogni settimana non serve, elimina questa richiesta». È la logica del 29/07
sulle probabili portata a conclusione: un'asta iniziale è in **agosto**, quando la pagina non esiste ancora, e
quello che gli editor aggiungono arriva **tardi** (le parole dell'allenatore) — quindi la lettura che vale è
quella presa **subito prima** della sessione. `starter_prob` 0/1453 sul gate è **vuoto per scelta**.
Applicato: `scripts/weekly-snapshot.ps1` → **`scripts/refresh-editorial.ps1`** (rilancio a mano, via la
macchina dello scheduled task), e `bootstrap`/README non chiedono più di registrare niente. Quello che
sostituisce il job è **dichiarare l'età** dell'evidenza (`evidence_age`) e leggere la **rosa viva** del
provider: una rosa vecchia si vede come una data invece di essere creduta.

### 5/08/2026 notte: la fonte «in tempo reale» sulle rose era già in cache

Richiesta dell'operatore («troviamo un ente affidabile e aggiornato in tempo reale»), spec **«Novità v9.26»**.

1. **L'ente esisteva**: `/team/{id}/players` del provider, **una richiesta per club**, scaricata **ogni giorno**
   per i ruoli granulari e **datata**. Il payload del **28/07** per il Napoli ha 46 giocatori e **non**
   Gutierrez, mentre `fc_site` lo elencava il **04/08** e la pagina Transfermarkt il **29/07**: sapeva della
   partenza una settimana prima. Ora è la **quarta fonte** di `squad_snapshot` (1546 righe), letta dallo stesso
   parser dei ruoli — zero richieste nuove.
2. **Il suo potere è l'ASSENZA**, che nessun'altra fonte nostra sa esprimere: una pagina rosa dice chi c'è, un
   trasferimento dice un evento, solo una rosa intera dice «non c'è più». Due segnali indipendenti: **46** dal
   trasferimento + **47** dall'assenza; il foglio passa da 629 a **651** righe.
3. ⚠️ **La guardia**: chi non ha identità del provider manca da ogni payload per costruzione, quindi l'assenza
   è evidenza solo per chi il provider sa identificare — «vuoto = ignoto, mai zero». E un acquisto fatto dopo
   la data del payload legge come assente finché non lo si rilegge: per questo il flag porta **la data**.
4. **Il foglio dichiara e non sposta**: il listone resta l'autorità del gioco su chi è in rosa.

### 5/08/2026 notte: le rose contro i trasferimenti, e una PK che perdeva un evento

Spec **«Novità v9.25»**, nata da «Gutierrez non è più nel Napoli». `backtest --verify` 22/22.

1. **Ogni fonte diceva Napoli** (listone 26/27, `fc_site` 04/08, `transfermarkt` 29/07) e a sapere era il
   **trasferimento** — Napoli → Bayer 04 Leverkusen, 01/07/2026, 26M — che non era nel DB perché `transfers`
   non era stato rilanciato per l'estate 2026. Rilanciato.
2. ⚠️ **Un OUT non è una partenza**: leggendo il solo OUT il foglio inventava **82** partenze, fra cui Hojlund
   («Napoli → Manchester United») e Malen, perché la pagina di un club porta lo **stesso uomo due volte** con
   la data del 1 luglio — rientro dal prestito (OUT) e acquisto definitivo (IN). Regola corretta: OUT dal suo
   club **e nessun arrivo che lo riporta lì** → **51** righe, Hojlund e Malen fuori, Gutierrez dentro.
3. **La causa era la PRIMARY KEY**: `(fc_id, date)` con tutti i movimenti estivi datati `YYYY-07-01` schiacciava
   le due righe e teneva l'ultima scritta. Ora la chiave porta il **controparte**, con migrazione esplicita
   (`widen_transfers_pk`); re-ingest offline dalla stessa cache: **2949 → 4383** trasferimenti, **399 → 523**
   datati 2026. Stessa forma del difetto già scritto per `match_ratings`.
4. **Come si vede**: `desc_left_for` / `desc_left_on`, una nota di foglio, e il marchio **⇥** nel pannello. Il
   foglio **non sposta** il giocatore: il listone è l'autorità del gioco su chi è in rosa, e dove due fonti
   discordano si dichiara, non si indovina.

### 5/08/2026 notte: OGNI calciatore ha un SURPLUS, penalizzato e dichiarato

Regola dell'operatore, spec **«Novità v9.24»**. `engine_*` non si muove di un decimale (`backtest --verify`
22/22): la stima è una **quarta** classe di colonne, `est_*`, in `engine/estimate.py`.

1. **Cinque gradini, ognuno con la sua misura**: l'altra piattaforma (differenza media **+0.001**, 92% entro
   0.3 su 870 stagioni-giocatore) · una stagione più vecchia (MAE 0.396 a t-2 contro 0.368 a t-1) · la
   stagione sottile **mescolata** col livello del club per quel ruolo (spread 1.36 sugli attaccanti, 0.25 sui
   portieri: Juve-contro-Verona, quantificato) · l'àncora di club come pavimento. ⚠️ L'FM-equivalente estero
   **non** è un gradino: R1 ha perso contro l'àncora su cinque finestre su sei.
2. **Stessa aritmetica del motore × la confidenza**, quindi una riga gatata esce identica e una stimata è
   confrontabile; la penalità moltiplica il **surplus** e non la fantamedia; e ogni riga stimata porta base,
   penalità e **nota in parole** (nel pannello: `~` più tooltip).
3. **Un numero inventato sostituito da una misura**: mezzo calendario di presenze per un ignoto faceva valere
   un portiere sconosciuto più del terzo portiere del suo club. Misurato: **0.289** del calendario (default) per
   chi non ha stagione precedente, **0.421** per chi ne ha una sottile — il sottile gioca più dell'ignoto.
4. **Effetto**: Serie A da **346 su 629** righe con un surplus a **629 su 629**; euro tutte `core`, perché là
   R0c prezza già tutti.

### 5/08/2026 sera-notte: tre segnalazioni dell'operatore sul foglio

Spec **«Novità v9.23»**. Una ha trovato un buco vero.

1. **Il nome del foglio dice piattaforma e game** (`29/07 · 2026-27 · euro/classic`): una lega dichiarata fissa
   entrambe, quindi il selettore League non ne mostrava nessuna. Combobox da 44 a 58: Tk taglia.
2. ⚠️ **`evidence_age` — e il buco**: «Gutierrez non è più nel Napoli». Il foglio aveva ragione su quello che
   AVEVA (entrambe le fonti dicevano Napoli: `fc_site` 04/08, `transfermarkt` **29/07**) e nessuno diceva che
   quell'evidenza era vecchia. Peggio: **`transfers_history` non aveva un solo movimento datato 2026** — il più
   recente è **2025-07-01** — quindi l'intero mercato estivo che ha costruito queste rose non era nel DB, e con
   esso origine e cifra di ogni arrivo. Ora il manifest e le note dicono l'età dell'evidenza **per fonte** e se
   il layer trasferimenti ha almeno un movimento nella finestra. `transfers` è stato rilanciato.
3. **`engine_unpriced_reason` — una cella vuota dice QUALE affermazione è**: «molti giocatori senza Surplus (es:
   Boga, Kolo Muani) … oppure Stones, Pavard». Sono **due** fatti diversi: «only N votes of 15» (misurato qui e
   troppo poco: Boga 13, Pavard **1**) e «no season on this platform» (il suo calcio è sull'altro calendario:
   Kolo Muani **23 voti euro** e zero Serie A, Stones 3). Sul foglio Serie A: **283 righe su 629 = 157 + 126**.
   Su euro non si vede perché **R0c** li prezza all'àncora; su default R0c non è adottata. Convertire il secondo
   caso è **R1**, respinta due volte dal gate.

### 5/08/2026 notte (2): un posto in attacco è il lavoro di un attaccante

Spec **«Novità v9.22»**. Chiude l'ultimo caso della famiglia «attacchi senza un attaccante».

1. **La misura ha ridefinito il numero prima della regola.** «4 board su 394» mescolava i board che il MODELLO
   seleziona con quelli che la **fonte dichiara**: in `next`, con almeno 11 probabili, il board **è l'undici
   degli editor**. Separati: **516 del modello** contro **150 dichiarati**, e sui primi gli offender erano
   **6 attacchi senza attaccante** (tutti il **Lilla**, lo stesso uomo) e **1 centrale su una fascia** della
   trequarti (Manchester United — `_flanked` copre M e A, non T: aperto e scritto). ⚠️ Attribuire al modello un
   board dichiarato gli attribuisce scelte degli editor: l'Atalanta `next` schiera Sportiello (0.03) con
   Carnesecchi (0.82) fuori, ed è la probabile.
2. **`_fronted`**: il MESTIERE decide chi è eleggibile per un posto d'attacco (`_off_the_front`, la definizione
   che già esisteva) e il claim decide fra i candidati, col tetto dei due override esistenti. ⚠️ **Non** è la
   strada che la todolist proponeva («la riga di centrocampo cede un posto, il modulo esce 4-4-1-1»): cedere un
   posto cambia la FORMA, che ha già un unico proprietario (`_reshape`), e restare nella stessa valuta evita un
   terzo metro. Il Lilla esce 4-5-1 con **Fernandez-Pardo** davanti.
3. **Costo, misurato disegnando ogni board due volte**: **67 su 666 cambiati**, claim medio **−0.108**, peggiore
   −0.480. Attacchi senza attaccante **6 → 0**, e le asserzioni dei board già giudicati dall'operatore restano
   verdi — quella è la guardia, non il conteggio.

### 5/08/2026 notte: l'investimento erano due metà, e nessuna arriva al pavimento

Gate **§7-septies**, follow-up pre-registrato ed eseguito. **NON ADOTTATA, famiglia CHIUSA**: `value_weight` e
`shrink_weight` restano **0.0**.

1. **Il bordo era la griglia, non la curva.** Estesa a 0.50 → 3.00 (tetto motivato: un titolare è ~0.09 del
   valore della sua rosa, quindi 3.0 aggiunge 0.27 di stagione), la curva **gira dentro** il misurato: migliore
   **0.75** su `default` (robust PASS, +0.56%) e **0.50** su euro (+0.34%, sotto il pavimento). A 3.0 il termine
   costa più che essere spento.
2. **E il marginale dice che quel PASS non è l'investimento.** Col null accesa al suo migliore e il valore
   spazzato sopra, misurato **per fold contro il punto solo-null**: **+0.41%** su `default`, **+0.045%** su
   euro, entrambi **sotto il pavimento** di 0.5%. I conti tornano: null +0.37% + valore +0.41% = il +0.78% che
   la forma grezza otteneva in robust PASS — **era la somma di due effetti entrambi sotto il pavimento**, che è
   esattamente ciò che il pavimento esiste per rifiutare. Quel poco che si vede sopra i minuti è **ritorno alla
   media**.
3. **Due cose di metodo**: `sweep.BASELINES` — una famiglia può dichiarare contro quale punto si misura, e il
   marginale si misura **per fold** contro il solo-null (sottrarre due medie pooled darebbe un altro numero); e
   ⚠️ **un errore mio nella pre-registrazione**, scritto invece che aggirato — «margine sul secondo positivo»
   non era esprimibile con le metriche del report, perché quel margine confronta il valore **in uso** (spento)
   col miglior rivale. Un criterio va scritto prima **e** va verificato che sia esprimibile.
4. **Cosa la riaprirebbe**: non un'altra griglia (due corse coprono 0.005 → 3.0), ma un proxy che **non sia già
   nei minuti** — gli ingaggi, che nessuna fonte pubblica — o la **variazione** del valore dentro la stagione.

### 5/08/2026 sera: il portiere ha un FM-equivalente, e serviva un numero solo

Gate **§7-decies**, spec **«Novità v9.21»**. **ADOTTATO** — non è una regola del motore, è il layer che
instrada i tier degli arrivi — e `backtest --verify` resta **22/22**.

1. **Il fantavoto di un portiere è un'IDENTITÀ, non una stima**: su **16.017** righe con entrambi i voti, su
   entrambe le piattaforme, `mv − gol_presi + 3·rigori_parati − cartellini` ha residuo **0.000 nel 100% dei
   casi**. E il **bonus imbattibilità non esiste** (residuo 0.000 anche sulle 4.872 partite chiuse a zero),
   mentre `config/scoring_config.json` lo dichiara 1.0: `ratings._fantavoto` già lo escludeva, e ora il
   commento del config porta la misura. Quindi mancava **un numero solo**: i gol presi.
2. **Erano già in cache.** `goalsConceded` e `saves` sono chiesti al provider dal primo giorno e **buttati al
   parse**, perché `external_stats` non aveva le colonne. Migrazione + parse + re-ingest **offline**: 11.725
   righe su 11.732.
3. **Verdetto, col criterio scritto prima**: PASSA su **201** portieri-stagione (euro) e 51 (default) — bias
   **−0.00…−0.18**, MAE **0.084-0.191** contro **0.214-0.336** dell'àncora, **89-100% entro 0.3** contro lo
   **0%** della formula dei movimenti (che sugli stessi uomini rifà +0.82…+1.22: escluderli era giusto).
4. **Il guadagno è piccolo e la sezione lo aveva dichiarato prima**: arrivi che guadagnano un equivalente
   **1/15/19/8** per stagione, totale **2045 → 2128**, e parte di quei portieri il core li prezza già.
5. ⚠️ **Daffara resta NULL, e servono DUE cose** (corretto la sera stessa: la prima stesura ne dichiarava una
   e sarebbe stata una promessa falsa). I **gol presi**, che esistono solo come aggregato di stagione delle 5
   leghe e per partita non più — le cache di giornata e di giocatore sono **distillate**, lo score è stato
   scartato; **e** un **voto base convertibile**, che per la Serie B il gate ha **rifiutato** (§7-nonies, δ
   −0.181 battuto dall'àncora). Quindi un portiere fuori perimetro resta NULL per **due decisioni misurate**,
   non per codice mancante. Conservare lo score resta giusto e serve dove le due si incontrano: le **coppe**.
6. **§7-sexies rimisurata** sulla popolazione nuova (707 → 2128 arrivi con equivalente), ed è la prima verifica
   quantitativa di «il collo di bottiglia è la copertura»: su **euro** `measured_first` resta CONFIRMED col
   margine **cresciuto** (+0.89% → **+1.00%**, 7 fold su 7), su **default** la quotazione scende da +0.42% a
   **+0.32%** — sempre sotto il pavimento, margine negativo sul secondo. Più calcio misurato, meno vantaggio
   alla quotazione, senza che nessuno abbia ritoccato un parametro. Non adottato nella stessa corsa:
   `t3_price` prende un robust PASS a **0.20** su euro (bordo della griglia, margine negativo sul secondo)
   mentre su `default` il migliore è **0.60**, il bordo opposto — i due estremi della stessa griglia sono come
   si presenta un parametro senza segnale.
7. **La catena, di nuovo**: `positions --layer reparse` azzera `mv_synth`, e gli arrivi con equivalente sono
   crollati a **716** finché `synth` non è stato rilanciato. Chi rifà `positions` rifà `synth` e poi `arrivals`.

### 5/08/2026 pomeriggio: esiste UNA lista con cui andare all'asta

Spec **«Novità v9.20»**. Toolkit **0.9.0**, **297 test verdi**. **Nessun verdetto del gate cambia e nessun
numero del motore si muove**: stesso prezzatore, stessi parametri fittati su un'altra finestra. Chiude la voce
che questo file portava aperta da tre sessioni come «la più importante».

1. **Il blocco non era il modello, era il CALENDARIO — e stava nel chiamante.** Le presenze sono una **quota**
   del calendario bersaglio e una stagione mai giocata ha `matchdays_target = 0`: ogni `pv_pred` era 0, quindi
   VALORE e SURPLUS erano 0 e la lista era **ordinata da niente** (misurato: Svilar `pv 0.0`, ordine per
   `fc_id`). Il ripiego «il calendario è quello dell'anno scorso» esisteva già, ma viveva in `snapshot.build`,
   cioè in **UN** chiamante — e il secondo chiamante, il tab Auction, si prendeva un listone intero a zero. Ora
   sta in `snapshot.engine_predictions`, **dove si decide il prezzo**. Dopo: Svilar `pv 32.1`.
2. **La lista LIVE**: prima voce del selettore Season, **`2026-27 · LIVE`**, una tabella sola per ruolo,
   prezzata dalla **stessa funzione del foglio Snapshot** (fit iniettati per non preparare due volte le undici
   finestre; la **scelta** del fit resta là dentro) su **rose reali**, perché il listone di agosto è parziale.
   Non dichiara nomi in comune né quota del top-10 perfetto — nessuno ha giocato, sarebbero zeri travestiti da
   punteggio — e dichiara invece `357 of 806 players priced`, le note del motore **a schermo** e la profondità
   prezzabile per ruolo. Le colonne dell'esito sono **assenti**, non vuote. Serie A/classic per SURPLUS: Svilar
   32 · Dimarco 27 · Paz N. 21 · **Malen 45**.
3. **Tre misure di layout, due direzioni scartate**: entrambe le colonne elastiche lascia 300 px vuoti a
   `Player`; nessuna elastica **taglia** `Pair` a 170 px (via il ΔQt.I) — «non stretta, assente», difetto già
   pagato; `Pair` elastica è la giusta, una volta allineata l'intestazione alle sue celle.
4. ⚠️ **Difetto nei TEST trovato da un crash**: `Config(data_dir=tmp_path)` **non sposta `db_path`** (campi
   indipendenti), quindi un test di geometria apriva il **DB reale da 313 MB** e il thread del tab Auction
   sopravviveva al test morendo nel garbage collector. Quattro punti reindirizzati.

### 5/08/2026 notte: il listone di AGOSTO, il buco che si vede, e tre muri identici

Spec **«Novità v9.19»**, verdetti nuovi nel gate **§7-septies**, **§7-octies**, **§7-nonies**. Commit
`5123413` → `38e5210` (dieci). Toolkit **0.8.0**, **295 test verdi** (1 skip: chiede un display), ruff pulito. **Nessuna regola è entrata
nel motore**: i set adottati restano `euro R0c+R3c` · `Serie A R3+R7+R13`.

1. **Il listone Serie A 2026-27 è dentro** — 494 giocatori, 20 club, 154 arrivi riclassificati — e il blocco
   non era il file: l'**id campionato** si leggeva **solo** dalla pagina dei voti, che per una stagione senza
   giornate non ne ha nessuno, cioè **ogni agosto**. Fallback sulla pagina delle **quotazioni** (Serie A 26/27
   = 21), con la **guardia** che serve perché quelle pagine servono «la lista corrente» qualunque stagione
   chiedi: il workbook dichiara la sua stagione nella prima cella e uno che non dichiara quella richiesta viene
   **rifiutato**. ⚠️ Il listone **euro** 26/27 non è ancora pubblicato (la pagina risponde 108 = 25/26 e la
   guardia lo rifiuta, correttamente): va riprovato, non forzato.
2. **TRE MURI IDENTICI IN UN GIORNO, e sono lo stesso muro.** **R1** ri-misurata con la copertura **tripla**
   (`mv_synth` era fermo: gli arrivi con FM-equivalente passano da **707 a 2045**) **non passa** su **sei**
   finestre, peggio dell'àncora di ruolo su cinque; **R13c** resta ferma sul campione; lo **scostamento della
   Serie B** esiste, vale **−0.181**, riduce del **20%** l'errore contro la retta nuda — ed è la prima volta che
   «un 7.0 in Serie B non è un 7.0 in Serie A» è un numero — e **perde contro l'àncora** (0.1631 vs 0.1786).
   Lettura: **la fantamedia di chi non ha storico qui non si prevede; le sue PRESENZE sì**, ed è R13, già
   adottata. Alajbegovic passa da nessuna riga a FM **6.245** (l'àncora, dichiarata tale), PV **20.2**, surplus
   **4.1** — non una regola nuova: le sue dieci partite adesso **esistono** nel DB.
3. **`synth` converte solo dove è CALIBRATO.** La conversione seguiva il **tag** (`source='sofascore'`) e non la
   calibrazione, quindi 3756 righe di Serie B, 570 di Championship e 458 di Coppa Italia prendevano un voto da
   una retta che non le ha mai viste, mentre 10 partite di **Bundesliga** ne restavano fuori. Ora l'idoneità è
   della **competizione** (`calibrated_competitions`, letta dai dati): **241.913 su 250.678** convertite, le
   altre NULL. `APPLY_OFFSETS = False` e gli offset misurati restano **nel report**.
4. **Un buco che il toolkit può ancora chiudere si VEDE**: marchi **⧖** → **⟳** → **→** sulla stessa lista di
   stati per-giocatore, con il tooltip che dice **con cosa** il buco si è chiuso («10 partite, 693 minuti in
   bundesliga»). La regola è quella del modulo che va a prenderli (`recent_form.awaiting_data`): **una
   definizione, letta da due lati**, e si autocancella. Più la barra **determinata** da qualunque modulo
   (`Context.progress`). Misurato: **6 righe su 629**, corsa che le chiude 11/11 identità e 110 partite.
5. **Il tabellone: un 4-5-1 con tre uomini d'attacco è un 4-2-3-1** (`_two_rows`, sulla **maggioranza** della
   riga e non su «almeno uno»: la fonte pubblica tre linee, quindi 4-5-1 è 1746 stringhe su 4812). Più
   `_flanked` esteso al tridente, `_pointed` sul centro dell'attacco, la targhetta che legge il **posto**. **17
   disegni cambiati su 108 board**, invarianti **4+7+4 → 0**. ⚠️ **Revocato e scritto**: far pagare al modulo i
   posti che la rosa non copre — disfaceva Barcellona e Napoli per aggiustare il Marsiglia.
6. **L'investimento condizionale passa robust su Serie A e NON è adottato** (§7-septies): +0.79% medio, 5 fold
   su 6, e `value_weight` resta **0.0** perché **ogni fold scegli il bordo della griglia** (0.5 su 0.5). Il
   **NULL** è la parte che conta: su Serie A il valore batte la costante di **+0.42 punti**, su euro i due sono
   identici — quel poco che c'è è **ritorno alla media**. Il braccio **cartellino** è morto su entrambe.
7. **Due decisioni dell'operatore in sospeso**: `APPLY_OFFSETS` (la Champions passa il criterio pre-registrato
   **e** ha MAE media peggiore dell'àncora: raccomandazione, spento). ⚠️ Il **job settimanale** non è più
   una voce aperta: l'operatore ha deciso il 05/08 che **non serve** (vedi il blocco in cima). E i **portieri** restano fuori dall'FM-equivalente
   comunque (+1.06/+1.08/+1.12 sopra la fantamedia reale, perché non sottrae i gol presi): lavoro in `arrivals`.
8. ⚠️ **Trovato chiudendo la sessione, e va rimisurato**: **§7-sexies** (i tier degli arrivi) ha girato su un
   `mv_synth` **fermo**, quindi la copertura del misurato che quel verdetto dà come collo di bottiglia era un
   **pavimento** — 707 arrivi con equivalente contro 2045 di oggi. Il verso non cambia, il **+0.42% della
   quotazione su `default` non è il numero di oggi**. Un coefficiente porta la sua data perché l'input sotto si
   muove.

### 4/08/2026: un modulo disegnato è un modulo VERO, e la heatmap al suo posto

Spec **«Novità v9.17»**, misure nuove nel gate **§5-quaterdecies**. Commit `1108803` (le regole) e `51d069e`
(le misure). **Nessun verdetto del gate cambia: nessuna regola del motore è entrata.** Toolkit **0.7.0**, 278 test verdi.

1. **Il difetto era uno solo, e non era nelle regole: era un secondo parere non prezzato.** L'undici viene
   assegnato ai posti del modulo e ogni posto è prezzato (`_assign`), poi `lanes_for` rileggeva la corsia dal
   **primo codice** di ciascuno e disfaceva la decisione. Liverpool 4-5-1, misurato: il fit aveva dato a Gakpo
   (`LW`) la fascia **sinistra dei cinque** e a Gravenberch (`MC;DM`) il **secondo centrale della difesa a
   quattro**, e la rilettura li spediva in attacco e a centrocampo → **difesa a tre**, cinque schiacciati
   nella metà destra con la touchline sinistra vuota, attacco di due mancini. «Il modulo non può perdere la
   simmetria». Ora quella rilettura fa **solo** la mossa per cui esiste: un **centrale** una riga avanti,
   sulla trequarti (il 4-5-1 che è un 4-4-1-1). Le altre tre direzioni erano tutte sbagliate e tutte
   misurate: attraverso le linee (Liverpool), fuori da una fascia (Bayer, usciva 3-3-3-1), indietro sulla
   riga (Verona 3-5-1-1 → sei in fila e trequarti vuota).
2. **`_reshape` è LA trasformazione: cinque regole, nell'ordine in cui le verifica un allenatore**, ognuna
   con le parole dell'utente come definizione. (1) nessuno a due linee da casa; (2) una fascia la copre un
   esterno, il centrale si disloca sul codice **più avanzato** (difesa esente: i braccetti); (3) **la fascia
   svuotata la copre l'attaccante esterno che arretra** — era la metà mancante della frase; (4a) **un posto
   in attacco è il lavoro di un attaccante** (Roma: «Malen ha giocato solo come Pc, Dybala e Soulé sono
   trequartisti» → il 3-4-3 esce **3-4-2-1**, la forma che le sue probabili dichiarano) e (4b) l'attacco
   assottigliato tiene le punte («3-4-3 non può diventare 3-4-1-2», «Sp + Pc non può avere un esterno
   d'attacco»); (5) **la riga di centrocampo è cinque al massimo**, e il tetto è l'ultimo passo perché la
   regola 4 può consegnarle un uomo.
3. **Le fasce vanno in coppia, e una punta non diventa un'ala.** «Se c'è un Ed ci deve essere anche una Es»
   (idem Ad/As, Td/Ts): un codice di fascia **spaiato** ripiega sul mestiere centrale della linea. «Krstovic e
   Scamacca non possono trasformarsi in As, sono Pc e basta»: `ST` è l'eccezione alla regola «la fascia
   appartiene alla maglia», e chi non è il centravanti legge `Ad`/`As` **solo se gioca lì**, altrimenti `Sp`.
   E **entrambe le touchline o nessuna**: la riga sbilenca (uno sulla vernice, la touchline opposta vuota)
   era difesa come informazione e l'utente l'ha superata.
4. **Un solo listino.** `slot_cost` **eliminato**: restava usato solo il suo terzo termine (ora `_line_gap`),
   era un secondo listino accanto a `_slot_price` e i due **discordavano** — ed è così che Gosens (`ML;DL`, 6)
   ha scalzato Piccoli (`ST`, 7) sulla fascia del tridente della Fiorentina e **la terza punta è uscita dagli
   undici**. La regola sta dove si decide il prezzo (`_off_the_front`). La griglia è **raddoppiata** perché
   mezzo passo faccia da spareggio sul **primo** codice (Olivera `DL;DC` a sinistra), spareggio tenuto fuori
   dai confronti di `_settle`.
5. **`_flanked`: le fasce di una riga le contende chi le gioca**, non solo il pool della sua linea — la
   regola 3 un passo prima, alla **selezione**. Bologna: i cinque prendevano un `MR` a 0.44 e **un centrale di
   difesa** per le ali mentre Orsolini (`RW`, 0.64) e Cambiaghi (`LW`, 0.53) non concorrevano. Resta la
   domanda del claim: si prende la maglia solo a chi ha claim più basso.
6. **La heatmap: modello dell'utente («posizione effettiva» contro «in potenza», con pesi diversi),
   validato e già al suo posto.** Sui 52 uomini di cui le fonti dichiarano la fascia: primo codice **93.9%**,
   **centroide 97.9%**, banda dominante del cloud 97.8%. La misura batte il codice, il cloud **non** batte il
   centroide — che è già ciò che `lateral` legge per primo. Quattro tentativi di usarla altrove, **tutti
   piatti**: riordino dei codici (3 bracci), pesi per asse (12 punti di griglia, e ogni peso sulla
   **profondità** costa perché quell'asse **satura** — punta 62, ali 61-63), fascia dalle bande (0 forme, 2
   targhette su 1782 e in peggio), fascia misurata in `sides_of` (4 soglie). La ragione, che chiude la
   famiglia: **quello che il codice PRIMARIO perde, la LISTA dei codici ce l'ha già** (Zé Pedro `DC;DR`, 75%
   dei tocchi a destra). Gate §5-quaterdecies.
7. **Verifica**: **394 board** (ogni club × ogni forma del repertorio × 2 modalità × 2 fogli) con **0 righe
   oltre il massimo, 0 codici spaiati, 0 righe asimmetriche**, ogni forma disegnata è un modulo reale. Contro
   le formazioni tipo pubblicate della stessa finestra: **83% degli uomini** e **16/20** conteggi di linea
   (era 15). Verificato anche **sul canvas vero** leggendo gli item disegnati.
8. ✅ **Chiuso uno dei due punti aperti del blocco precedente**: i **centrali su una fascia** sono **3 → 0**.
   ⚠️ **Ridotto e capito il secondo**: gli **attacchi senza un attaccante** sono **9/340 → 4/394**, e i
   quattro sono lo stesso club e lo stesso uomo — Lilla, con l'unico posto d'attacco di un 4-5-1 assegnato a
   Haraldsson (`AM`, claim **0.83**) invece che a Fernandez-Pardo (`ST`, **0.83**): un **pari merito** rotto
   sui minuti, e poi la guardia «mai l'ultimo uomo dell'attacco» lo tiene là davanti. Il seguito naturale è
   la regola 4a alla **selezione**: se l'unico posto d'attacco andrebbe a un trequartista, la riga cede un
   posto e il modulo esce 4-4-1-1 — la stessa forma di `_flanked`, ma sulla profondità invece che sulla
   fascia.

### ...e il POMERIGGIO del 4/08: la quotazione all'ultimo posto (spec «Novità v9.18»)

9. **La QUOTAZIONE è l'ultima risorsa** (gate **§7-sexies**), decisione dell'operatore: «è il giudizio
   soggettivo di chi quota». Il motore adottato **non la leggeva già** — R12/R12b/R17 falsificate e fuori dai
   set, il livello di rimpiazzo dalla fantamedia del rostered marginale, `stature` a zero, `arrival_tier`
   letto solo dalla GUI. L'unico punto vivo era quale percentile instrada un arrivo, e ora ha **tre livelli**:
   **calcio giocato** (FM-equivalente nella lega di provenienza, percentile nel ruolo) → **fantavalore** (il
   giudizio più fresco: «varia ogni settimana o quando ci sono eventi particolari») → **quotazione**. Su euro
   `measured_first` vince **7 fold su 7** (CONFIRMED, +0.89%); su Serie A la quotazione guadagnerebbe +0.42%,
   sotto il pavimento, e la causa è la **copertura** del misurato (25-29% contro 14-20%). ⚠️ Il seguito NON è
   tornare al prezzo: è **allargare il misurato** alla Serie B e ai campionati non coperti.
10. **`fvm_history`**: il fantavalore era uno **stato volatile tenuto come campo statico**, sovrascritto a
   ogni scarico del listone. Ora è una serie datata che **accumula da oggi** — la storia settimanale
   precedente non esiste in nessun posto raggiungibile. E prima del **2022-23** è **0 e non NULL**, quindi la
   «copertura 1395 su 1395» era illusoria.
11. **Regola di metodo nuova, e l'ha trovata un numero**: inserendo il fantavalore la quotazione otteneva un
   `robust PASS` su `default`, che era **falso** — lo sweep giudicava i tier su tutti gli arrivi mentre un
   tier instrada solo chi il **core non può prezzare**. **Un parametro va giudicato sulla popolazione su cui
   agisce** (in CLAUDE.md).
12. **`market_values`** (9388 valori · 3180 giocatori · 11 stagioni, gratis dalla pagina rosa già scaricata) e
   il verdetto §7-quinquies: **non adottato**, e la sfumatura è il risultato — il proxy migliore ha comprato
   **il verso e non la taglia**.

### La sessione precedente — la sessione del 3-4/08/2026: quindici richieste sul PANNELLO

Dettaglio in [stato-progetto-continuita-v5.md](stato-progetto-continuita-v5.md) sezione «Sessione
03-04/08/2026», spec **«Novità v9.16»** (dieci punti), misure nuove nel gate **§5-terdecies**.
**Nessun verdetto del gate cambia: qui non è entrata nessuna regola.** Toolkit **0.6.0**, 271 test verdi.

1. **La build dello snapshot dice a che punto è.** `[snapshot] 46% · descriptive layers`, barra determinata
   nel tab. I pesi sono **secondi misurati** (predict 37s, squads 14s, `roles` 293s dai timestamp della
   cache di una refresh vera), ogni run stampa `[snapshot] stages:` per rimisurarli, e una fase che non
   gira **esce dal denominatore**.
2. **Lo schieramento TIPO non si sceglie con lo sconto infortuni** (`claim` ≠ `presence`). De Bruyne
   standing 1.00 × disponibilità 0.53 perdeva il posto da Elmas 0.62 × 0.92. Il tipo è «la squadra con
   tutti disponibili» e adesso lo è: `claim` = standing, `presence` resta la domanda d'asta.
3. **Il claim scegli CHI gioca, la calzata solo DOVE**, e la disposizione si risolve **come un tutto**
   (`_matching`, Hungarian in casa). Una greedy per casella deve fissare la priorità fra fascia e linea, e
   **entrambi gli ordini sono sbagliati sullo stesso undici**; il prezzo di una casella è la distanza sulla
   griglia dei codici con la fascia pesata **per linea** (`SIDE_WEIGHT` 8 su D/M, 3 su T/A), perché a
   centrocampo l'esterno è un ruolo e in attacco i tre si scambiano. Riparazione **Pareto** (`_settle`,
   `CLAIM_MARGIN` 0.05) e trasformazione del modulo **solo se obbligata** (`_reshape`).
4. **Il badge dice la fascia della MAGLIA**: in una linea a quattro i due esterni sono `Ts`/`Td` anche se
   sono centrali di ruolo (e in una difesa a **tre** restano `Dc`, che non ha fasce).
5. **Il piede preferito, misurato prima di usarlo**: DL 96% sinistro, DR 96% destro, ma `LW` **86% destro** e
   `RW` 69% sinistro (ali invertite), e i `DC` mancini stanno a sinistra nel **93%**. Entra come spareggio
   dentro la linea, mai su chi gioca.
6. **Il CORPO (altezza/peso) c'era già nella cache** e nessuno lo leggeva; ora è nel foglio e sul tooltip.
   Ipotesi «si schiera la punta alta» **misurata e respinta**: la più usata di due punte è la più alta
   **44 volte su 92 = 48%**, una monetina (gate §5-terdecies).
7. **La tabella rosa è una canvas**: in Tk 8.6 un Treeview colora la riga e niente di più fine. Pillole di
   ruolo nella palette del campetto, ogni numero **verde sopra la media del foglio e rosso sotto** (media su
   tutti i giocatori di tutte le squadre, `inj` invertito), e un **check per calciatore** che rifà gli undici
   senza di lui, modulo compreso.
8. **Un SURPLUS vuoto è una dichiarazione**: sotto `MIN_PV_PREV = 15` voti il core non prevede, e su
   `default` non c'è R0c su cui ripiegare — **253 righe su 598** in quel foglio. Ora lo dicono manifest e
   tooltip.
9. ⚠️ **Aperto e misurato**: su 340 undici restano **9 attacchi senza un attaccante** e **3 centrali su una
   fascia** (la linea `T` è in pool con l'attacco, quindi un trequartista batte una punta sul claim); e **gli
   undici di un allenatore NUOVO non pesano da nessuna parte** — l'Atalanta ha Sarri e
   `formation_typical_under_coach = 0`, il suo 4-3-3 è misurabile (**162 undici su 188 = 86%**) e le sue due
   amichevoli con Raspadori titolare sono in cache.

### La sessione precedente — quattro passate del 29/07/2026, in ordine di conseguenza

Dettaglio in [stato-progetto-continuita-v5.md](stato-progetto-continuita-v5.md) sezioni «(5)» → «(8)»,
verdetti in [gate-motore-v1.md](gate-motore-v1.md) **§7-ter** e **§7-quater**, spec «Novità v9.11»→«v9.14».

1. **Una quota di stagione si conta sul CAMPIONATO.** I numeratori erano sempre di campionato
   (`external_stats` ha una riga per campionato) e il denominatore era ogni undici parsato in qualsiasi
   competizione: Arsenal 58, Bayern 50, Napoli 38. Kane leggeva **49%** con 25 titolarità su 34 giornate;
   correlazione fra la quota di campionato del club e la titolarità media dei suoi **+0.796 → −0.172**. Le
   assenze si **contano** in giornate dentro l'unione degli spell, e `contested` usa quello che ha davvero
   saltato e non la previsione — che, sottratta e rimoltiplicata, si annullava: giocatori appiattiti sul
   pavimento **da 201 a 9**.
2. **`sweep` — il gate delle COSTANTI** (`python -m euroleghe_ingest sweep`). Formule estratte in
   `engine/presence.py`: un parametro che nessun harness raggiunge non si può spazzare. **Adottato**:
   `STANDING_WEIGHTS = (0, 1)` — la titolarità si prevede dai **minuti**, strict e robust su tutti e dieci i
   fold. **Confermati**: forma di `contested`, `ARRIVAL_DISCOUNT` 0.80, decay rigoristi 0.75 (dopo aver
   scoperto che **ogni rigore di Serie A era contato due volte**, che dimezzava la memoria della gerarchia
   per i club italiani). **Aperti col motivo**: `LOAN_DISCOUNT` (platform-dependent), inclinazione
   infortuni, pavimento, quarantena, soglie dei tier.
3. **Le probabili non si storicizzano** (decisione dell'utente): sono poco affidabili e ragionano con i
   nostri stessi fattori; il valore aggiunto arriva a ridosso del calcio d'inizio. Quindi rilevazione su
   OGGI, e per un foglio **retrodatato** si guarda l'undici **schierato** — colonne `actual_*`, terza classe
   del CSV, misurate DOPO la data d'asta e di sola rendicontazione. `starter_prob` 0/1453 nel gate =
   **vuoto per scelta**, e il cron settimanale non serve.
4. **L'investimento del club: ipotesi misurata e NON adottata.** Due canali (quota della spesa del club, e
   Qt.I percentile nel ruolo — necessario perché **Modrić e De Bruyne sono arrivati a parametro zero**), due
   forme pre-registrate, bersaglio le titolarità. `fee_weight` peggiora monotonamente, `stature_weight`
   peggiora in entrambe le direzioni, la forma `arrival` è pari a spento in quarta cifra. Lettura: il
   meccanismo **è già assorbito dai minuti**. ⚠️ **Da ritestare col proxy giusto**: il valore di mercato
   Transfermarkt è **già nella cache** (561 pagine rosa, 51 club × 11 stagioni) e gli **ingaggi non
   esistono** in nessuna fonte in whitelist (verificato: zero occorrenze di Gehalt/salary/stipendio).
5. **L'unità è la PARTITA, non la giornata**: (giocatore, giornata) non è unica — con un rinvio più un
   trasferimento un uomo gioca la stessa giornata per due club — e la **PK di `match_ratings` non può
   rappresentarlo**, quindi una presenza si perde. Decisione aperta: cambiare la PK = migrazione + re-ingest.
6. **Il pannello: l'altezza si spende sul campetto, non sul suo bordo** (richiesta dell'utente sul layout;
   spec «Novità v9.15», stato sezione «(9)»). Nessun numero del motore cambia. A parità di finestra il
   campetto passa da **388 a 493px** e la rosa da 448 a 534; la finestra ora si apre **massimizzata**
   (campetto 449x506) e ricorda la scelta dell'operatore. Misurando sono venuti fuori due difetti che
   nessuno vedeva: la **status bar era invisibile da sempre** (packata dopo uno shell che espande: 1x1
   pixel) e la **targhetta dell'attaccante veniva disegnata sopra la didascalia**; e **276px di colonne
   della rosa non erano strette, erano assenti** — Tk taglia e non offre come raggiungere. Lezione, ora con
   un test in rapporti: **una tesi sul layout va misurata** (`winfo_height`) come qualunque altra.

### La passata precedente — il denominatore di una quota, e lo sweep delle costanti

Sessione del 29/07/2026, ultime due passate (spec «Novità v9.11» e «v9.12»; dettaglio in
[stato-progetto-continuita-v5.md](stato-progetto-continuita-v5.md), sezioni «(5)» e «(6)», verdetti in
[gate-motore-v1.md](gate-motore-v1.md) **§7-ter**). I due punti che «cosa manca al toolkit» dava per aperti:

1. **Una quota di stagione si conta sul CAMPIONATO.** I numeratori erano sempre di campionato
   (`external_stats` ha una riga per campionato) e il denominatore era ogni undici parsato in qualsiasi
   competizione: Arsenal 58, Bayern 50, Napoli 38. Quota di campionato **66%-100%** sui 45 club, quindi Kane
   leggeva **49%** con 25 titolarità su 34 giornate. Correlazione fra la quota del club e la titolarità media
   dei suoi giocatori: **+0.796 → −0.172**. Dentro: le assenze si **contano** in giornate dentro l'unione
   degli spell (niente più conversioni), e `contested` usa quello che ha davvero saltato e non la previsione
   — che, sottratta e rimoltiplicata, si annullava. Giocatori appiattiti sul pavimento: **da 201 a 9**.
2. **`python -m euroleghe_ingest sweep` — il gate delle COSTANTI.** Formule estratte in
   `engine/presence.py` (un parametro che nessun harness raggiunge non si può spazzare). **Adottato**:
   `STANDING_WEIGHTS = (0, 1)`, la titolarità si prevede dai **minuti** — strict e robust su tutti e dieci i
   fold. **Confermati**: forma di `contested`, `ARRIVAL_DISCOUNT` 0.80, decay rigoristi 0.75. **Aperti col
   motivo**: `LOAN_DISCOUNT` (platform-dependent), inclinazione infortuni, pavimento, quarantena, tier.
   Trovato per strada: **ogni rigore di Serie A era contato due volte**, il che dimezzava la memoria della
   gerarchia per i club italiani — ed è per questo che 0.5 sembrava battere 0.75 (0.75² = 0.56).

### La passata precedente — il foglio d'asta dice di CHI era la stagione, e chi compete davvero

Sessione del 29/07/2026 (tre passate, spec «Novità v9.8» e «v9.9»; dettaglio e numeri in
[stato-progetto-continuita-v5.md](stato-progetto-continuita-v5.md), sezioni «Sessione 29/07/2026 (2)» e
«(3)»). Nessun giro di gate, nessun verdetto cambiato: è tutto sul **foglio d'asta** e sui **dati**.

1. **La stagione misurata arriva spaccata fra il club attuale e altrove** (`desc_minutes_club` /
   `_elsewhere`, dallo strato per-partita) e la standing **pesa** la metà fatta altrove: `LOAN_DISCOUNT
   0.60` se questo club lo aveva e lo ha mandato via, `ARRIVAL_DISCOUNT 0.80` se non lo ha mai giudicato —
   differenza **misurata** da `desc_at_club_before` (nessuna fonte nostra marca un prestito). Marin R.
   0.57 → **0.34**, dietro Rrahmani. Entrambe provvisorie: gate §7-bis.
2. **Un ballottaggio è un duello fra RUOLI REALI, mai fra ruoli fanta.** Serve un codice granulare
   condiviso; chi non ha codici osservati **esce dalle colonne** (vuoto = ignoto, mai «0 rivali»).
3. **E quel vincolo ha scoperto il buco più grosso della giornata**: 827 `fc_id` avevano gli aggregati
   sofascore e **nessun id** in `player_xref` — invisibili a ruoli granulari, heatmap e strato per-partita
   insieme. Causa: l'identità era scritta dentro il giro per stagione. **815 recuperate** offline; il
   foglio passa da 152 a 32 giocatori senza codice, il layer per-partita da ~270k a **334.795** righe.
4. **Uno slot sa la sua linea, non solo la fascia**: la fascia sul badge è quella della maglia, una linea
   a corto di uomini prende dal **surplus** di un'altra (il Bayern disegnava dieci uomini) e `LANE_DEPTH`
   impedisce che il quinto centrocampista sia un centrale difensivo. **0 undici incompleti su 68.**

Toolkit **v0.3.0**, spec **v9.9**, 232 test verdi. `fetch --plan` dice «every source is populated»: quello
che manca non è più dato — vedi «cosa resta, in ordine di leva» in fondo allo stato.

### quattro credenze del fantacalcio MISURATE: un solo canale, e non è il voto

Domande dell'utente (29/07/2026): il riposo corto peggiora la resa? «vincere aiuta a vincere»? una
vittoria fa confermare l'undici? il nuovo allenatore dà una sferzata? Misurate su
`platform='default'` (Serie A), 7 stagioni, **106.977 partite-giocatore**, esiti demeaned dentro
(giocatore, stagione). **Descrittivo: nessun giro di gate, nessun verdetto cambia, nessuna regola entra.**
Rapporto completo: [turnover-atteso-v1.md](turnover-atteso-v1.md); sintesi nel gate §5-duodecies.

1. **Tutte e quattro hanno un effetto reale, e in tutte e quattro è su CHI GIOCA.** Riposo ≤3 giorni:
   **P(titolare) −9,8pp**, **P(voto) −4,4pp**, negativo **7 stagioni su 7** — e **fantavoto −0,014
   (t −0,5)**, con segno instabile fra stagioni. Dopo una vittoria contro dopo una sconfitta: **+5,0 /
   −4,1pp** per chi era titolare, specchiato sui panchinari, **XI confermato 78,2% vs 71,0%** (≈2,4 maglie
   cambiate dopo una vittoria, 3,2 dopo una sconfitta), **7 su 7**.
2. **Le credenze sul RENDIMENTO cadono, una col segno rovesciato.** Dopo una vittoria il fantavoto fa
   **−0,046** (−0,032 corretto per l'avversario): ritorno alla media, non inerzia — e **regge al proprio
   null rimescolato** (null −0,002, contrasto W−L −0,074 contro −0,002, t −3,4). Però un punto di fantavoto
   in t−1 vale **+2,35pp** di titolarità in t: l'informazione viaggia **attraverso la scelta
   dell'allenatore**, non le gambe.
2-bis. **«Ha segnato, si ripeterà?» — misurato con 300 rimescolamenti per sequenza** (il test ingenuo è
   distorto: `P(hit|hit)−P(hit|miss)` è negativa anche su dati casuali, bias di Miller–Sanjurjo). **Il gol
   è senza memoria**: su Serie A tutte e quattro le statistiche di raggruppamento sono a zero (1.260
   giocatore-stagione). **Il livello di prestazione ha un filo di memoria**: il quartile alto di fantavoto
   si raggruppa su entrambe le piattaforme (t +2,7…+6,5) ma vale **+0,014 su un tasso base di 0,408**, cioè
   42% contro 40% — solido e non scommettibile. ⚠️ E la correzione che ne è venuta: la «mano calda a
   −0,035» della prima stesura era **la distorsione**, non un effetto; col null giusto è **+0,012 (+3,4 sd)**,
   cioè positiva e minuscola. Regola di metodo: un'autocorrelazione ritardata dentro un gruppo demeaned si
   confronta con la sequenza **rimescolata**, non con zero.
3. **Nuovo allenatore: metà sferzata è aritmetica.** Grezzo +0,481 punti/partita; controlli appaiati con la
   stessa forma di partenza +0,253 → **netto +0,227 (SE 0,118, t 1,9)**, cioè **53% ritorno alla media** e
   il resto non risolvibile con 31 eventi. Quello che fa davvero: **conferma il 64,4% dell'undici** contro
   il 75,1% delle settimane normali = **1,2 maglie subito**. Coerente con la caduta di R10.
4. **La cornice, che spiega il resto del motore**: **Var(ln pv) = 90,5%** di Var(ln fantapunti) su
   `default` (89,9% su `euro`) contro **~2%** di Var(ln fm). Il 90% di una stagione **sono** le presenze —
   per questo tutto ciò che è entrato nel motore (R3, R3c, R7, R13) è una regola di presenze o minuti.
5. **Difetto di dati chiuso senza rete**: il **risultato** di una partita di Serie A è derivabile offline.
   `goals` è al netto di rigori **e** autogol (`goals+own_goals+pen_scored` pareggia i gol subiti dei
   portieri su **386 giornate su 418**), quindi gol fatti = `SUM(goals)+SUM(pen_scored)`, gol subiti dalle
   righe `role='P'`; screening severo (bilancio **e** vittorie == sconfitte) → **278/418 (66,5%)**.
6. **Cosa manca per farne una regola**: un **gate per-giornata**, che non esiste — il gate attuale giudica
   un bersaglio stagionale all'asta. E i **dati di coppa/Europa**, senza cui la congestione vera resta non
   misurata (il bucket ≤4 giorni è pulito, quello 5+ è contaminato per le squadre europee → si **sottostima**).

### il RUOLO REALE granulare: 12 codici, e dove si collocano (spec «Novità v9.7»)

Richiesta dell'utente: ogni calciatore deve avere il suo **ruolo reale**, recuperato **quando gira lo
snapshot**, per sapere orientativamente dove collocarlo in campo.

1. **Dodici codici, enumerati e non ricordati** — `GK` · `DL DC DR` · `DM` · `ML MC MR` · `AM` · `LW RW` ·
   `ST`, da uno a tre per giocatore. 128 giocatori campionati non hanno restituito nient'altro; un
   tredicesimo codice a monte finisce **nel log**, non assorbito. Italiano: `Ts` terzino sinistro, `Dc`
   centrale, `Td` terzino destro, `M` mediano, `C` centrocampista, `T` trequartista, `Es/Ed` esterno,
   `As/Ad` ala, `Pc` punta. **Nessuna colonna esistente lo sostituisce**: `role_classic` chiama `D` sia un
   terzino sinistro sia un centrale, e `positions.derived_role` **li chiama `D` entrambi anche lui**.
2. **È una griglia, quindi si posiziona**: lato (−1 sinistra … +1 destra) e profondità (0 porta propria …
   1 porta avversaria, **lo stesso asse di `avg_x`**). `DM` → `MC` → `AM` sono tre posti in campo che per
   il listone sono tutti e tre `C`. I numeri sono posizioni di **disegno**, non quantità fittate.
3. **Una richiesta per CLUB**, non per giocatore: `/team/{id}/players` porta `positionsDetailed` +
   `preferredFoot` per l'intera rosa → 35 club invece di ~1500 giocatori, ~2 minuti, e **zero** richieste
   rieseguendo lo stesso giorno (cache datata). Nuovo `positions --layer roles`; i **team id** del provider
   sono dedotti *offline* dalle cache già presenti (92 club) — nessuna fonte nostra ne portava uno.
4. ⚠️ **TERZO fatto non backfillabile**, e va saputo: il provider serve solo «adesso» — `?seasonId=`
   risponde **200 e lo IGNORA** (Dimarco torna `['ML']` sia per 25/26 sia per 23/24). Quindi
   `player_roles` è **datata** e sta accanto a `probable_starter` e `contract_until`: ogni giorno non
   osservato è un giorno che non esisterà. Storiche e intatte: `derived_role` e `avg_x/avg_y`.
5. **Precedenza sul lato decisa misurando**: heatmap e codice concordano su **196/219** laterali (89%);
   nei 23 restanti vince il codice, perché un `DL` non è un centrale — ma un codice **centrale** non è una
   pretesa sulla fascia, e lì resta la misura (Bastoni `DC;DR` → −0.53, il sinistro di una difesa a tre).
6. **Misurato**: 1372 osservazioni datate, **745/883 righe del foglio (84%)**, 221 mancanti su 1343 sono
   identità non risolte (la linea resta nota, manca la fascia). Dimarco `D/e` → `ML` badge `Es`, lato
   −0.62, profondità 0.60; Calhanoglu `C/m;c` → `DM;MC` badge `M`, profondità 0.45.

7. **I dodici codici → il vocabolario MANTRA** (mappatura dell'utente, `desc_mantra_real`): il Mantra
   **semplifica**, quindi `ML`/`MR` collassano su **`e`** e `LW`/`RW` su **`w`** (non nomina la fascia a
   centrocampo), mentre in difesa la nomina (`DL`→`ds`, `DR`→`dd`). Due ruoli che **nessun codice singolo**
   dà — ed è per questo che avere fino a tre codici vale più che averne uno: **`b` braccetto** = codice di
   fascia difensiva **insieme** a `DC` (139 giocatori, il listone ne segna 28: è una *capacità*, i due non
   devono coincidere), e **`AM` → `t` o `a`** deciso dalla linea larga del provider (63 `M`→`t`, 19
   `F`→`a`). ⚠️ Non sostituisce mai `rosters.roles`: **esiste per quando non esistono**, che a luglio è la
   norma (26/27: 1343 su 1343 senza riga di listone). Dove entrambi ci sono: **48% identici, 44%
   condividono un ruolo, 8% disgiunti** — e le disgiunte sono quasi tutte `a` del listone contro `w` del
   provider, cioè la distinzione stessa fra **per cosa lo compri** e **dove gioca**.

8. ✅ **DECISO il 05/08/2026: nessun job settimanale.** La voce diceva «ogni settimana che passa costa» e
   l'operatore ha chiuso la richiesta: «il job ogni settimana non serve». Un'asta iniziale è in agosto, quando
   la pagina delle probabili non esiste, e il valore aggiunto degli editor arriva a ridosso del calcio
   d'inizio — quindi si legge **subito prima** della sessione. `player_roles` continua ad accumularsi quando
   gira `snapshot`, che è il momento in cui serve; e ciò che protegge da una rosa vecchia non è un job ma la
   **data dichiarata** (`evidence_age`) più la rosa viva del provider come fonte.

**Nessun verdetto del gate cambia**: fatto descrittivo + layout. Il vincolo è registrato in
`gate-motore-v1.md` §5 punto 6, fra i fatti utilizzabili *live* e non nel gate retrospettivo.

### lo snapshot lavora sulle ROSE REALI e ha una VISTA (spec «Novità v9.6»)

1. **Rose reali, listone o non listone.** Nuova `squad_snapshot` (fc_site → transfermarkt → apparizioni,
   ognuna datata **con la propria data**) e `features.load(squad_source='real')`, default `'listone'`
   così **nessun numero del gate si muove**. Il target di default è **la stagione a cui appartiene
   oggi**: a luglio si prepara l'asta di una stagione il cui listone non esiste. Misurato: 26/27 = **890
   giocatori, 34 club**, senza quotazioni, con SURPLUS. ⚠️ Tre difetti trovati **provando** il foglio:
   il backstop apparizioni senza limite metteva Handanovic nell'Inter 2026; le rose venivano ridatate
   alla data d'asta (**look-ahead**); il foglio euro elencava Verona e Cagliari → filtro di perimetro
   **in uscita**, non nel modello, così ogni numero resta quello dell'harness.
2. **Forma sulle ultime 10 del CLUB**, non del giocatore: `played/measured/unused/unknown`, gol spezzati
   `league`/`other`, e chi non è nel layer legge **UNKNOWN, non zero**. Nella vista sono **dieci
   pallini**: `b` (panchina) e `n` (nessun dato) sono colori diversi di proposito.
3. **Vista `Snapshot`**: club a sinistra, box + **campetto** (portiere in alto) con undici e ballottaggi,
   rosa ordinabile con tooltip su ogni colonna e colonna **`real`** (il ruolo in cui è stato davvero
   usato). Gli 11: le probabili se ci sono, altrimenti il SURPLUS previsto — e il campetto dice quale.
4. **Campetto = MODULO TIPO**: la **moda** degli undici realmente schierati (Atalanta 3-4-3 al 97%), non
   la media delle linee, che arrotonda a moduli mai giocati.

### lo SNAPSHOT D'ASTA: un tasto, e il foglio da cui si prepara un'asta

`snapshot` (comando + tasto «Auction snapshot (today)» nel pannello): scelti **piattaforma** e **game**,
aggiorna le probabili/indisponibili di oggi e scrive un foglio per giocatore e uno per club —
**1453 giocatori, 46 club** al primo giro. Spec «Novità v9.5».

**La cosa importante è come è diviso il foglio**, e si vede nell'header: `engine_*` è la valutazione che
**ha passato il gate** (FM prevista, presenze, VALORE, SURPLUS, rank di ruolo), prodotta **chiamando
`engine/`** col set adottato e parametri fittati su un'altra finestra; `desc_*` è **descrittivo e NON
gatato** — forma sulle ultime 10, minutaggio presunto, ballottaggi, propensione infortuni, rigorista,
propensione ai bonus, correttezza, contratto/exit risk. **Nessuna colonna `desc_` può diventare un
coefficiente senza gate pre-registrato**: sei famiglie di ipotesi sulla FM sono già morte così.

E quello che le fonti non dicono è **dichiarato**: «rapporto con la società» non è misurabile (esistono
i proxy: contratto, exit risk, cifra, anni al club), i piazzati oltre i rigori non sono attribuibili
(`assists_set_piece` è NULL alla fonte), le «idee dell'allenatore» non sono scritte da nessuna parte —
misurati chi è, da quando, se è nuovo, il modulo di oggi e le linee realmente schierate. La data d'asta
è `min(15 agosto della stagione, oggi)`, così una prova a vuoto non legge il futuro; e se i parametri
sono fittati sulla stagione bersaglio il manifest scrive **DRY RUN**.

### il TOOLKIT è completo, esporta, si ricostruisce da zero, e ha una UI nuova

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
4-bis. **Cinque club del perimetro non combaciavano con Transfermarkt** — trovato misurando la
   copertura degli infortuni (55% del perimetro, squadre intere assenti). La tabella di competizione
   scrive il nome ufficiale («ACF Fiorentina», «LOSC Lilla», «Real Betis Balompié») e un listone mai.
   `match_club` ora fa passi ordinati con unicità obbligatoria: **club_xref 46 → 51**, spell allenatori
   2273 → 2316, **trasferimenti 1919 → 3038**. ⚠️ Un passo per sottoinsieme di parole è stato scritto,
   misurato e **cancellato**: dava «Paris FC» → PSG e «Espanyol» → Barcellona. Lezione registrata: un
   pool a cui manca la risposta giusta non si salva col tie-break, solo rifiutando di indovinare.
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

### Cosa manca, in ordine (aggiornato 4/08/2026)

0. ✅ **Il nuovo allenatore pesa, per la FORMA** (fatto il 4/08, spec «Novità v9.17» §6): `coach_shapes` /
   `coach_shapes_of` nel foglio contano le forme che quell'allenatore ha schierato in ogni sua panchina, ed
   entrano in `shape_odds` **al posto della lega**, pesate da soglia e rampa sul proprio campione
   (`COACH_SHAPE_MIN` 20, `FULL` 60) perché va da 188 undici a zero. Giudicato sulla previsione 26/27:
   **8/17 → 9/17**, Atalanta passa al **4-3-3 di Sarri** (difesa a quattro, 9 uomini su 11 come la fonte) e
   il Milan porta il 3-4-2-1 dal 13% al 41%.
   ✅ **E l'altra metà, il CLAIM, è misurata e NON adottata**: il foglio porta `desc_preseason_starts` /
   `..._matches` e la targhetta li dice, ma niente che scelga un undici li legge (test:
   `test_the_preseason_is_a_reading_and_never_a_criterion`). Sembra decisivo — le due amichevoli di Sarri le
   iniziano Gaetano, Samardzic, Scamacca e **Raspadori**, e De Roon/Ederson/Krstovic **nessuna** — e non è
   usabile: **una sola** pre-season di dati per-giocatore (1696 righe contro 37), 1-3 partite, **Milan e
   Napoli a zero**, minuti assenti in 1399 righe su 1716, avversari l'**U23 del club** e l'Arezzo, e la fonte
   che concorda ha letto le stesse amichevoli. Pre-registrato per giugno 2027 (gate §7), quando per la prima
   volta ci sarà un fuori campione.
0-bis. **Il residuo del board, uno solo e capito** (4/08, dettaglio nel blocco ULTIMO IN ORDINE DI TEMPO
   §8): 4 attacchi su 394 senza un attaccante, tutti Lilla, un **pari merito di claim** (0.83) fra un
   trequartista e una punta per l'**unico** posto d'attacco di un 4-5-1. La strada è la regola 4a portata
   alla selezione: se quel posto andrebbe a un trequartista, la riga di centrocampo cede un posto e il modulo
   esce 4-4-1-1. I centrali su una fascia sono **chiusi** (3 → 0).
0-ter. **Le bande della heatmap, validate e NON in pipeline** (gate §5-quaterdecies): separano chi gioca su
   **entrambe** le fasce da chi gioca al **centro** (Malen 0.37/**0.50**/0.14 contro Pulisic 0.46/0.30/0.24,
   centroidi quasi identici), il payload è già in cache e l'ingest già lo parsa per il centroide. Sul
   **modulo** non spostano nulla, misurato. Se si riaprono, la domanda è un'altra — «copre davvero l'altra
   fascia?», cioè i **ballottaggi** — e va definita prima la metrica, perché le fonti li pubblicano a
   singhiozzo. Costo: migrazione di `positions` + colonna d'ingest + colonna nel foglio.
1. ✅ **Il valore di mercato: FATTO e MISURATO il 4/08 — non adottato** (gate **§7-quinquies**). Sta nella
   pagina rosa di Transfermarkt che già scarichiamo e parsiamo, quindi **zero richieste nuove**, ed è
   **storico**: la pagina di una stagione passata porta il valore di QUELLA stagione (verificato su undici
   stagioni di un club: 225 / 175 / 150 / 100 / 200 mila per lo stesso uomo). Tabella nuova
   `market_values(fc_id, season, source, value)`, **9388 valori · 3180 giocatori · 11 stagioni**, nel
   contratto d'export. Forma misurata: il valore come **quota del valore della rosa**, sulla stagione di
   input — lo stesso argomento del cartellino con un proxy che esiste anche per chi arriva **gratis**, che
   era il buco per cui §7-quater aveva fallito su Modric e De Bruyne.
   **Verdetto: `value_weight` resta 0.0**, e il risultato è **dipendente dalla piattaforma**: su **euro** il
   migliore in pool è **zero** (piatto); su **Serie A** tutti e **sei** i fold scelgono un peso non nullo
   (0.10-0.20) e la curva in pool è una U pulita, ma il guadagno medio è **+0.08%** contro un pavimento di
   **0.5%**, con due fold negativi. Il proxy migliore ha comprato **il verso, non la taglia** — e il
   cartellino non aveva nemmeno quello. Conferma la lettura di §7-quater: **il meccanismo è già nei minuti**.
   ⚠️ Non riproporre nella stessa forma: la riaprirebbero gli **ingaggi** (nessuna fonte li porta) o la
   **variazione** del valore dentro la stagione, che è un'altra domanda e serve la serie per data.

### Cosa manca, il resto (invariato dal 29/07)

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
   sulla macchina**, ed è la forma pre-registrata di R7. Ogni settimana non registrata è una finestra ⛔ **SUPERATO il 05/08/2026**: nessun job, decisione dell'operatore (vedi il blocco in cima).
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

**232 test verdi, ruff pulito** (nessuno tocca la rete). Toolkit **v0.3.0**, spec **v9.9**. `recent_form` ha `--bonuses-only`
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
- `backtest --verify` **riproduce 22 numeri su 22** (dal 4/08/2026; era 15/18, e i tre che mancavano
  erano tutti del modulo presenze su T1: il documento che li pubblica è del **22 luglio**, cioè
  **prima** che `platform` esistesse, quindi erano misurati su un dataset che mescolava i due
  calendari. La conclusione era anche data al singolare su una quantità **dipendente dalla
  piattaforma**: su `default` il modulo batte il naive su entrambe le finestre (−5.2% / −2.9%), su
  `euro` solo su T2. Il criterio di adozione — il **bias**, 4-6 giornate fantasma azzerate — si
  riproduce su tutto. Dettaglio in `presenze-attese-v1.md`, blocco «RIMISURATO»)
- ...e i numeri pubblicati che verifica (ancore Classic/Mantra, beta Mantra,
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

**Ultima sessione (29/07/2026)**: lo snapshot d'asta e' ora un tavolo di lavoro - percentuale = quota di
giornate (standing x availability), campetto a griglia che rispecchia il modulo, precampionato ingerito
(`positions --layer extra`, tag `sofascore_extra`, descrittivo e mai gated), snapshot AS OF una data e per
un singolo club. Poi, nella seconda passata dello stesso giorno: la stagione misurata arriva **spaccata fra
il club attuale e altrove** e la standing pesa la seconda meta' a `LOAN_DISCOUNT = 0.60` (Marin R. 0.57 ->
0.34); un **ballottaggio e' posizionale e parla solo il ruolo REALE** - un codice granulare condiviso, mai
il ruolo Classic, che al Napoli metteva Politano in duello con un regista; e quel vincolo ha scoperto che
**827 fc_id avevano gli aggregati sofascore e nessun id in `player_xref`** (Saka, Guirassy, Torres F.),
quindi erano invisibili a ruoli granulari, heatmap e strato per-partita insieme. Causa: l'identita' era
scritta dentro il giro per stagione, e la decideva l'ultima stagione processata. Recuperate **815
identita'** offline; ora il foglio ha 32 giocatori senza codice invece di 152. Terza passata: **prestito
contro acquisto** con la differenza misurata dalla storia delle rose (`LOAN_DISCOUNT 0.60` se questo club lo
aveva e lo ha mandato via, `ARRIVAL_DISCOUNT 0.80` se non lo ha mai giudicato), e **uno slot sa la sua
linea** e non solo la fascia - la fascia sul badge e' quella della maglia, una linea a corto di uomini
prende dal surplus di un'altra invece di lasciare la maglia vuota (il Bayern disegnava dieci uomini), e
`LANE_DEPTH` impedisce che il quinto centrocampista sia un centrale difensivo. Il punto di ripresa, con
«cosa resta in ordine di leva», e' la sezione di chiusura di
[stato-progetto-continuita-v5.md](stato-progetto-continuita-v5.md).
