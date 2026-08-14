# Todolist DRAFT v1 — migliorare i suggerimenti e le formule di valore/surplus

**Nata il 10/08/2026** dalla campagna di misure sulle strategie di draft (banco: replay delle 5 finestre
euro/mantra del gate — Tm4, Tm3, T0, T1, T2, bersagli 2019-20 → 2025-26 — prezzo Qt.I, undici LEGALE sui
moduli del regolamento, confronto appaiato dentro lo stesso draft). Le conclusioni misurate stanno in
fondo a questo file; gli item sono **ordinati per resa attesa**, come `todolist-formazioni-tipo-v1.md`.

**Prima passata di esecuzione: 10/08/2026, sera.** Chiusi 0.1, 0.2, 0.3, 1.1, 1.2, 1.3, 1.6, 2.1, 2.6, 3.2,
3.3. **Seconda passata, la notte stessa:** chiusi 1.4, 1.5, 3.1 e 2.5 — e la seconda passata ha **corretto
un'adozione della prima** (la copertura sui posti perde su classic). Dove stanno i numeri:
[metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md) **§16** (prima passata) e **§17** (seconda),
[assistente-asta-v1.md](assistente-asta-v1.md) **§26** (moneta per formato e cosa fa il pannello),
[gate-motore-v1.md](gate-motore-v1.md) **§7-octovicies** (il collo di bottiglia `pv` e la pre-registrazione
del Qt.I). **Citare da lì, non da qui:** questo file porta lo stato, non la misura.

**Il risultato più grosso della passata non era nella lista.** Il pannello consigliava ordinando per NETTO
(`surplus − λ × prezzo`) e senza razionare per ruolo: misurata come politica fa **−52,3% sui rivali, 0/5,
34 crediti spesi in 25 giri, metà undici scoperto**. Era la causa comune di due sintomi già rattoppati sul
bordo (i riempitivi da 1 credito in coda al giro, la terza striscia che offriva uno sconosciuto da 11
crediti). Lezione: **quando lo stesso sintomo va rattoppato due volte in punti diversi, il difetto è nella
grandezza che entrambi leggono.**

**Regole che vincolano ogni item.** Qualunque cosa tocchi `engine_*` passa dal **gate** (regola d'oro);
i cambi al SOLO consiglio dell'app si misurano sul **banco** prima di cambiare il pannello (5 finestre,
entrambi i metri, verdetti strict/robust col pavimento 0,5% e nessuna finestra sotto −2%); un parametro
non si adotta al bordo della griglia né fittato sulla finestra che lo giudica. Prima di riproporre
un'idea, leggere «cosa è già stato respinto» in fondo.

---

## 0. Fondamenta: senza queste il resto non si misura

- [x] **0.1 — Portare il banco dentro il repo.** Fatto: **`toolkit/bench/draft/`**, commenti in inglese,
  `windows.json` e `appcode.mjs` gitignorati (contenuto a pagamento / artefatto di build). Due cose in più
  rispetto alla richiesta: il banco **legge il codice vero dell'app** (`entry.ts` ri-esporta `needFor`,
  `predictRivalPick`, `startingPlaces`, `lambdaOf`, `netOf`, `coverNeedOf`, `needForUs` e la legalità mantra
  da `app/src/app/core/`, impacchettati da `build.mjs` con l'esbuild dell'app), e una riga del banco
  (`APP: adottata, letta dal pannello`) esiste solo per verificare che il codice spedito riproduca la misura
  che lo ha adottato. Verificato riproducendo i numeri del §15 **finestra per finestra**.
  Errore di porting pagato subito, e vale come regola: la firma nuova passa il GIOCATORE dove la vecchia
  passava lo slot, le politiche pubblicate passavano ancora `needFor`, `places.get(giocatore)` è `undefined`
  e il peso valeva 1 per tutti — la prima tabella diceva che il surplus era la moneta migliore. **Un porting
  si verifica sui numeri, non sulla compilazione.**
- [x] **0.2 — Dichiarare la lega `default`/mantra.** Fatto su risposta dell'operatore: **`Leghe Mantra`**,
  10 squadre, 2 portieri + 21 di movimento (quindi 23 giri). `snapshot --league "Leghe Mantra"` + `export`:
  il foglio è nel bundle, **635 righe, 310 prezzate dal motore e 325 stimate**, e ogni riga ha un numero.
  Due cose dichiarate invece che nascoste: la ripartizione D/C/A dei 21 è un **artefatto dello schema**
  (mantra non impone quote per slot) ed è letta dal regolamento — 3,545 / 4,727 / 1,727 posti medi sugli
  undici schemi, che su 21 fa 7/10/4; e su `default` **R0c non è adottato**, quindi chi ha meno di 15 voti
  non ha `engine_*` e ha `est_*` per costruzione, non per omissione.
- [x] **0.3 — I moduli CLASSIC in `config/`.** Fatto: **`config/classic_modules.json`**, letto dal
  regolamento leghe private (pubblico, senza paywall) — «Utilizzare i moduli standard e cioè: 3-4-3, 3-5-2,
  4-3-3, 4-4-2, 4-5-1, 5-3-2, 5-4-1». Trascrizione **verificata**: ogni modulo somma dieci posti di movimento
  e le tre linee riproducono il proprio nome. La legalità classic è per MACRO-RUOLO e il file lo dice in
  apertura: nessuna casella tipata, nessuna scelta di ruoli, niente matroide. Le formazioni d'emergenza
  (3-6-1, 6-3-1) sono registrate e **spente**: sono opzionali per lega.

## 1. Suggerimenti del draft (app, misurare sul banco prima di cambiare il pannello)

- [x] **1.1 — La copertura per ruolo come VINCOLO del piano, non come peso.** ADOTTATA, e con una
  correzione dell'item: **il bersaglio NON è `startingPlaces × 2`**, perché quelle quote sono il *ceil* di
  una media sugli undici moduli e sommano **16** contro i 10 posti di uno schema — raddoppiarle spegne la
  regola invece di stringerla (misurato: −4,20%, 0/5). Quello che il regolamento raziona è un **POSTO**.
  Adottato `COVER_COPIES = 2` in `auction-plan.ts` (+ il nuovo `mantra-legal.ts`, che è ora l'UNICA
  definizione della legalità mantra, letta anche dal banco): **+1,47% robust**, 4/5, copertura dell'undici
  93,4% → 97,4% delle giornate, 30 crediti in meno, e il parametro è interno alla griglia (un undici −5,34%,
  tre −4,31%). Il vincolo DURO perde (−1,44%): la copertura è un bisogno, non un divieto.
  Runner-up col suo margine: le quote ×2 **graduate** (1/0,7/0,35) passano robust a +0,70%, cioè 0,77 punti
  sotto. **Aggiornamento della notte (item 3.1): quella runner-up è diventata la regola adottata su CLASSIC**,
  dove la versione sui posti perde (−1,00%) — quindi il razionamento è per GIOCO, e la graduata è l'unica
  delle due con un verdetto su entrambi.
- [x] **1.2 — Moneta ibrida: VALORE per il movimento, SURPLUS per la porta.** Pre-registrata e
  **RESPINTA**: −4,88%, 0/5, e per la ragione dichiarata PRIMA della misura — il surplus di un portiere e il
  valore di un uomo di movimento non stanno sulla stessa scala, quindi in un solo argmax l'effetto non è
  prezzare la porta ma **rimandare i portieri**, e la copertura crolla di 8 punti. La forma onesta sulla
  scala (il valore decide SE, il surplus decide QUALE portiere) non è peggiore ma non guadagna niente
  (−0,23%, sotto il pavimento): **confermato niente da guadagnare**, che non è «trovato peggio». Quindi in un
  draft la moneta è il VALORE per tutti, portiere compreso — e `pickForUs`, le radici e `ranked` ora ordinano
  per valore. Nota di meccanismo: col vincolo di copertura imposto il surplus puro passa da −4,0% a −1,48%,
  cioè **quasi tutto quello che sembrava una questione di moneta era una questione di ripartizione**.
- [x] **1.3 — Cross-fit leave-one-out del pavimento prezzo.** Fatto (`floor.mjs`, griglia pre-registrata
  {0, 25, 50, 100, 200, 400, 800}): **nessun pavimento passa held-out**, media −0,05%, 3/5. Il cross-fit
  scegle 400 su tutte e cinque le pieghe (e 400 non è il bordo: 800 lo è), ma sopra 200 la curva è piatta a
  zero e sotto crolla. Quindi **il consiglio non usa pavimenti**, come l'item stesso prevedeva: restano il
  tie-break «a parità prendi il meno quotato» e la coda punti-per-credito. Meccanismo in regalo: il
  «pavimento 200» **comprava copertura** (col vincolo acceso vale −0,30%), quindi il §15.6 punto 1 si chiude
  non con «era un livello sbagliato» ma con «era un rimedio indiretto a un problema che ora ha il suo».
- [x] **1.4 — Identificare la testa di ogni rivale DAI PICK CHE HA FATTO.** ADOTTATA: `classifyRivals` +
  `predictRivalPick(..., head)`. La testa stimata prevede la scelta successiva del rivale l'**82,8%** delle
  volte contro il **69,2%** della politica unica, **5/5** finestre, e il warmup più corto è il migliore
  (`HEAD_WARMUP` = 2: 82,8% / 81,7% / 79,3% a 2, 4, 8 pick). Classificazione a fine draft: `prezzo`,
  `surplus` e `valore` al 100%; `giudizio` letto come `prezzo` nel 93-95%, che non è un errore ma
  l'informazione che il tavolo non emette (il suo rumore è privato).
  Tre cose che valgono più del numero. **Un buco invisibile da dentro la misura**: il tavolo di default non
  contiene nessuna testa a VALORE, quindi il classificatore non era mai stato interrogato su una — aggiunto
  `EVERY_KIND` la riconosce al 100%, e su quel tavolo la politica unica crolla al **28,4% contro il 74,8%**.
  **Una discrepanza fra misura e codice spedito, chiusa con un numero**: nell'app la posizione nel giro non è
  ricostruibile da una lista di pick, quindi il classificatore ignora la coda — misurato, **82,7% contro
  82,8%**, non costa niente. **E la regola della coda NON è stata toccata**: i due bracci la condividono,
  quindi la misura non dice niente su di essa, e «la sua moneta per credito» renderebbe un rivale a prezzo
  affamato del più caro proprio in coda, cioè l'opposto dell'incentivo per cui la regola esiste.
- [x] **1.5 — Il valore di BLOCCO.** Misurato (`block.mjs`) e consegnato come NOTA, che è esattamente
  l'ordine che l'item chiedeva. **Il denial paga presto e mai tardi**: al tasso più generoso difendibile
  (incontri ogni rivale una volta a giornata, quindi il denial deve essere 11× il costo) ripaga nel **62,9%**
  dei pick dei giri 1-5, nel **69,6%** dei giri 6-15 e nello **0,0%** dai 16 in poi. Da leggere sul
  meccanismo, non sul rapporto: 144/11 = 13,1 contro un costo mediano di 10,5 — un margine di un quarto,
  reale e non un ordine di grandezza; dopo il giro 16 il costo esplode a 119,7. Nel pannello: ogni pick
  previsto porta `denies`, mostrato sopra i 50 fantapunti, e NON cambia la scelta.
  **La prima versione della diagnostica era sbagliata e vale come lezione**: definiva il denial come «il
  massimo che qualunque rivale guadagnerebbe da lui» e faceva sembrare l'84% dei pick un caso da denial. Il
  denial esiste solo se quel giocatore **sparirebbe davvero** prima del nostro turno: se resta, lo prendiamo
  poi. Bias dichiarato: un uomo che il foglio non sa prezzare non è schierato nell'undici del rivale, quindi
  il denial è un limite superiore, tanto più largo quanto meno della sua rosa sappiamo prezzare.
- [ ] **1.5b — NUOVO, nato dalla misura di 1.5 e non adottato**: nel **57,3%** dei nostri pick, fra gli
  uomini che stanno per sparire ce n'è uno che alza il NOSTRO undici almeno quanto la scelta della politica.
  Non è un'evidenza sul denial: è che «valore × copertura» e «il massimo guadagno marginale sull'undici
  legale» non sono lo stesso obiettivo. Il secondo non è mai stato misurato come politica — ed è miope in
  un altro modo, quindi potrebbe essere peggio. Da pre-registrare e misurare, non da assumere.
- [x] **1.6 — La strategia porta in modalità porte.** Fatto, e non serviva una misura nuova: era la regola
  di lega della §14.1 che il piano non leggeva. Con `keeperMode = 'goals'` il pool offre **una riga per
  PORTA** e non una per portiere (`portaStandIns`, funzione pura e testata): il prezzo è quello del portiere
  più caro del club — la puntata che il tavolo riceverebbe — e chi rappresenta la porta è il **miglior
  portiere per SURPLUS**, perché ne schieri esattamente uno. Prima il piano credeva di poter comprare la
  stessa porta tre volte e spendeva scelte che non compravano niente. Il valore decide ancora SE spendere una
  scelta su una porta; il surplus decide solo QUALE portiere la rappresenta, e i due numeri non si confrontano
  mai (è la lezione dell'item 1.2).

## 2. Formule di valore e surplus (toolkit/motore — tutto passa dal gate)

- [x] **2.1 — Il collo di bottiglia è `pv_pred`, non `fm_pred`.** Era una conclusione su **T2 sola** e ora è
  una conclusione su **quindici istanze finestra**: rimisurata la notte stessa anche sulle dieci di `default`,
  dove `pv_pred` batte `fm_pred` **10/10** (Spearman +0,426 contro +0,283) e la varianza dice la stessa cosa
  (85-91%). Sulle cinque di euro (`signal.py`), `pv_pred` batte `fm_pred` su **5/5**,
  Spearman +0,459 contro +0,259, Pearson +0,465 contro +0,303 — e i due numeri che l'item citava (+0,545 e
  +0,313) sono esattamente la colonna T2 di Pearson. La decomposizione della varianza dà la stessa risposta
  da un'altra strada: `Var(ln pv)` è l'86,8%-90,6% di `Var(ln fantapunti)` su tutte e cinque. Conseguenza
  sull'ORDINE del lavoro: a parità di plausibilità, una regola candidata che tocca le presenze merita il gate
  prima di una che tocca la fantamedia.
- [ ] **2.2 — PRE-REGISTRATA, non misurata: il Qt.I come segnale di titolarità (lato pv SOLTANTO).**
  **Aggiornamento della notte 10/08, e cambia la motivazione:** «il mercato ci batte nel classificare» è una
  frase su una PIATTAFORMA. Su euro il Qt.I batte il nostro valore (+0,574 contro +0,499), su Serie A lo
  battiamo noi (+0,475 contro +0,463, dieci finestre). Terza volta che una conclusione di questo progetto
  viene scritta al singolare su una quantità che dipende dalla piattaforma. La pre-registrazione resta valida
  — dice già che un'adozione sarebbe per piattaforma — ma il fatto che la motiva vale su **euro**.
  Scritta in `gate-motore-v1.md` §7-octovicies (b) prima di toccare una riga del motore: forma (un termine
  sul solo `pv_pred`, sul percentile del Qt.I dentro il ruolo e dentro il listone), griglia pre-registrata,
  criteri (strict + robust, pavimento 0,5%, MAE mai peggiore, giudizio anche sul `captured_value`), e tre
  cose dichiarate prima — la precedenza della risorsa misurata, il rischio di circolarità **specifico** (il
  Qt.I è scritto da chi guarda le stesse formazioni tipo che il nostro `standing` legge, quindi va
  controllato per i minuti già in mano) e il fatto che un'adozione sarebbe per PIATTAFORMA. Il fatto che la
  motiva è nella tabella di 2.1: il Qt.I ci batte nel classificare 5/5 (+0,574 contro +0,499 sui ranghi).
- [ ] **2.3 — I buchi di input che il gate ha già indicato**, in ordine: `value_share` mancante per gli
  arrivi (196 righe euro su 975 senza, e proprio sugli uomini per cui il canale esiste — caso Ramos);
  il braccio delle FEE ha solo 3 finestre (le fee esistono dal 2023); allargare la copertura
  dell'FM-equivalente (la direzione «il collo di bottiglia è la copertura» ha già due conferme). NON fatto:
  è acquisizione di dati, non codice.
- [ ] **2.4 — `FM 5a` in DISPLAY sulla riga d'asta** (media 5 stagioni + numero di stagioni, con la
  regola del trim ≥5). **Rinviata dall'operatore il 10/08** («per il momento non fare niente») e lasciata
  ferma: è la via aperta della memoria `multi-season-fm-intuition` — mostrare, non prevedere. R18b/R18c sono
  già respinte: nessuna forma predittiva senza pre-registrazione.
- [ ] **2.5 — Il calendario dentro l'orizzonte del consiglio. NON MISURABILE sul banco attuale, e le due
  ragioni sono misurate.** (1) Su una stagione intera il calendario è **identico per tutti**: un girone
  all'italiana fa giocare ognuno contro tutti, quindi un peso di calendario può contare solo su un orizzonte
  PARZIALE, e il banco misura stagioni intere. (2) `fixtures` contiene 2.538 righe e sono **tutte 2026-27**:
  per le finestre del banco non esiste nessun calendario, quindi la politica non è nemmeno calcolabile.
  Prerequisiti nominati: un metro su orizzonte parziale, e l'acquisizione dei calendari storici. Avvertimento
  che ne deriva subito per il pannello: `desc_easy_matches` e `desc_calendar_margin` hanno senso sulla
  finestra `from`–`to`, mai sulla stagione.
- [x] **2.6 — Documentare la moneta per formato.** Fatto in `assistente-asta-v1.md` §26.1, con la tabella
  formato → risorsa scarsa → moneta (crediti → surplus; draft mantra → valore; porta → surplus e l'unità è il
  club) e le due precisazioni che la misura ha aggiunto: in un **draft** il valore vince anche in porta, e il
  **netto** non è una moneta di draft e non è una taratura da correggere.

## 4. Sfruttare l'asimmetria informativa (nata il 10/08/2026 dalla domanda dell'operatore)

«Noi conosciamo Qt.I, FVM, surplus e valore; gli altri solo Qt.I e FVM.» Misurato in
[metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md) §18, e la risposta ribalta la premessa.

- [x] **4.1 — Verificare che l'asimmetria esista, prima di sfruttarla.** Partial Spearman contro l'esito
  (`edge.py`): il nostro valore aggiunge **+0,214** (euro) e **+0,246** (Serie A) sopra il prezzo — ma il
  prezzo aggiunge **+0,388** (euro) sopra di noi, quasi il doppio. E il vantaggio è largo **un numero solo**:
  `pv_pred | Qt.I` +0,198/+0,243, `fm_pred | Qt.I` +0,046/**−0,032**, `surplus | Qt.I`
  +0,006/**−0,077**. Su euro i nostri disaccordi col prezzo sono in media **nostri errori** (l'esito cade al
  45,2° percentile contro il nostro 62,6 e il loro 31,8).
- [x] **4.2 — ADOTTATA: prendi chi sparirà, raccogli chi resta.** `SURVIVOR_DISCOUNT` = 0,7: un uomo che
  sopravvivrà al nostro prossimo turno vale 0,7 di uno che sparirà. **+4,54%, 5/5, STRICT** — la leva più
  grossa della campagna e l'unico strict che questo banco abbia prodotto, tre volte il vincolo di copertura.
  Parametro interno (0,85 → 0,70 → 0,50), spesa 299 → 345 (che È il meccanismo), e non usa **nessun**
  vantaggio informativo: solo la regola d'ordine della piattaforma e le rose pubbliche. Verificata riga per
  riga sul codice spedito. Nota: è il **rovescio esatto** del pavimento prezzo respinto nel §16.4, che
  spingeva verso gli economici, cioè verso i sopravvissuti.
- [x] **4.3 — MISURATO e NON adottato: il blend prezzo+nostro.** +2,35% strict a w=0,25 (interno), cioè metà
  della sopravvivenza — e **non si sommano**: sopravvivenza SU blend fa +2,52%, 4/5, peggio della
  sopravvivenza da sola. Sono lo stesso meccanismo contato due volte.
- [x] **4.4 — «L'asta due giornate dopo l'inizio favorisce surplus e valore»** (ipotesi dell'operatore):
  meccanismo giusto, **beneficiario sbagliato**. Spostando il bersaglio ai fantapunti dalla 3ª, il nostro
  vantaggio sul prezzo non si muove (+0,214 → +0,209; a k=6 → +0,204). Ma le presenze **VISTE** valgono
  **+0,443** sopra il prezzo (k=2) e **+0,536** a k=6 — il segnale più grosso di tutto il file — e sono
  PUBBLICHE: con prezzo e formazioni note, il nostro valore scende a +0,170, il pv a +0,127 e il surplus va
  **negativo (−0,028)**. L'incertezza ERA il nostro vantaggio.
- [x] **4.6 — La COPPIA «bonus e poche presenze + riserva affidabile»** (idea dell'operatore): misurata in
  DUE forme e respinta in entrambe (§19). Forma forte (la resa attesa del posto come moneta, senza parametri):
  **−4,69%, 0/5**, e la copertura scende 98,4% → 94,4% perché il fattore `(1 − p_tenuto)` raziona la
  profondità a 0,15-0,30 dove il `DEPTH_WEIGHT` che spedisce sta a 0,35 — inoltre tratta i posti come
  indipendenti, cioè è un tetto per ruolo travestito. Forma ristretta (solo la preferenza sulla riserva
  affidabile, moltiplicatore limitato): **−0,40% / −0,50% / −0,55%** al crescere di k, 0-1/5 — piatta e
  monotona nella direzione sbagliata, quindi «confermato niente da guadagnare». Perché: la moneta la contiene
  già (`valore = fm × pv` prezza entrambe le metà) e il metro regala già il beneficio della coppia (schiera il
  migliore fra i DISPONIBILI). E il metro era **generoso** con l'idea — concede previsione perfetta dentro la
  giornata dove il gioco dà una gerarchia di sostituzioni col malus — quindi nella realtà andrebbe peggio.
  **Cosa il rifiuto NON copre:** la QUOTA DI BONUS della fantamedia, separata dal suo livello. Il motore
  prevede un numero solo e non li distingue; le due strade per cui potrebbe contare sono l'R-Factor (conta i
  voti BASE, quindi spinge contro il bonus-man) e la varianza in un campionato a scontri diretti. Misurabile
  da `match_rating_bonuses`, non misurata.
- [ ] **4.5 — NUOVO e conseguenza diretta di 4.4, il numero più grande della campagna:** se l'asta è a
  stagione iniziata, `engine_pv_pred` deve LEGGERE le giornate giocate. Oggi è costruito sulla stagione
  precedente, quindi un pannello al terzo turno ignora un segnale da +0,443. Il foglio si sa già costruire a
  una data (`snapshot --date`); quello che manca è che il pv incorpori le presenze osservate. Tocca
  `engine_*`, quindi **gate**.

## 3. Consolidamenti rimasti aperti

- [x] **3.1 — Il giro su CLASSIC.** Fatto su **dieci** finestre Serie A, e ha **corretto un'adozione di
  poche ore prima**. L'ipotesi dell'item (il surplus si comporta molto meglio su classic) ha la direzione
  giusta e non basta: −**0,50%** contro il valore, 5/10 (contro −1,48% e 1/5 su mantra), nessun verdetto —
  quindi **la moneta resta il VALORE su entrambi i giochi**, e l'ibrida è respinta anche qui (−2,94%, 0/10).
  La correzione: la copertura contata sui POSTI, adottata su mantra a +1,47%, su classic **PERDE** (−1,00%,
  4/10), perché lì `startingPlaces` somma **esattamente dieci** (d4 c4 a2 — i posti di un modulo classic sono
  interi, non c'è il *ceil* che su mantra gonfia a sedici) e imporre due undici interi su un pool più grande
  della domanda solo del 20% compra uomini debolissimi. Adottata su classic la **quota graduata** (+0,77%
  robust, 6/10), che è l'unica regola con un verdetto su entrambi i giochi.
  Tre cose da tenere. Il **limite del pool**: il motore prezza 301 uomini su 433 (111 sotto i 15 voti, e su
  `default` R0c non è adottato) e il draft ne consuma 250, quindi gli ultimi giri sono quasi forzati.
  Un **difetto scoperto nel codice appena scritto**: l'app leggeva i moduli solo per mantra, quindi su classic
  non razionava affatto — la riga da −4,93%; ora il bundle porta anche `classic_modules.json` e il
  razionamento è deciso dal GIOCO. E un **fatto scomodo lasciato in piedi**: su classic il nostro posto perde
  contro la media dei rivali (−2,6% col valore, 2/10) mentre su mantra vince (+2,1%).
- [x] **3.2 — Stagioni-bersaglio in più per il banco.** Misurato e la risposta è NO da `default`: il
  bersaglio euro 2018-19 ha 566 giocatori con voti, e l'input 2017-18 da `default` ne copre **88 (15,5%)** —
  gli italiani; i 478 che mancano sono esattamente gli stranieri per cui euro esiste. Da `external_stats` la
  copertura è **501 (88,5%)**, quindi la finestra è *costruibile* ma con l'input sintetico per la totalità
  della popolazione: aggiungere una finestra muove OGNI verdetto del gate, quindi è una **pre-registrazione**
  e non è stata fatta. Trappola trovata strada facendo, e vale più della finestra: `match_ratings` per euro
  2021-22 ha **17.825 righe con tutti i bonus pieni e `mv` NULL su 17.825** (rimisurato il 14/08/2026: NULL,
  non `0` — e la distinzione è quella su cui gira «vuoto = ignoto, mai zero»; `fantavoto` è NULL sulle stesse
  righe, `goals` è pieno su tutte) — chi conta le righe conclude
  l'opposto del vero, il buco è il VOTO. Sintetizzarlo contaminerebbe il bersaglio euro: Tm2 e Tm1 restano
  fuori, e ora è scritto col numero.
- [x] **3.3 — Il banco assume 12 squadre / 25 giri / 3 portieri**: ora legge la lega dichiarata
  (`engine.setupFrom(league_config, nome)`, i giri sono la somma degli `squad_slots` — che è quello che i
  giri di un draft SONO), e `PUBLISHED_SETUP` resta come default perché i numeri pubblicati si riferiscono a
  quel tavolo. `extract.py` prende il nome della lega e legge piattaforma, gioco e valuta da lì.

---

## Le conclusioni misurate che questa lista dà per acquisite (10/08/2026)

1. **«Giocare per scegliere primo» è rovinoso**: −45,8% sui rivali, 0/5 finestre. Il risultato più
   solido della campagna.
2. **Il SURPLUS è la moneta sbagliata per un draft mantra** (−4,0%, 2/5): sconta una scarsità per slot
   che il regolamento non impone (3 P + 22 movimento, nessuna quota; 497 giocatori su 1014 con 2+
   codici). Resta giusto per la porta e per le aste a crediti. **Aggiornato 10/08 sera:** col vincolo di
   copertura imposto lo svantaggio scende a −1,48%, cioè era in buona parte copertura e non moneta.
3. **La copertura per ruolo vale più della moneta, di un ordine di grandezza** (+10,6 punti/giornata
   contro 0,8 fra le monete). I primi 25 di QUALUNQUE graduatoria non schierano un undici legale
   (4–10 posti su 11): la rosa si costruisce coprendo il modulo, due volte. **Adottata come vincolo del
   consiglio il 10/08 sera** (+1,47% robust sopra il razionamento che l'app aveva).
4. **La fantamedia dell'undici non separa i criteri** (7,05–7,56): separa la DISPONIBILITÀ. `FM −1` è
   il peggiore dei criteri onesti (65,7 punti/giornata), quindi motore e prezzo aggiungono qualcosa di
   reale sopra «la fantamedia dell'anno scorso».
5. **Il tetto è vicino**: l'FVM archiviato — che CONOSCE l'esito — correla +0,591 e fa 84–93,6
   punti/giornata; fra il Qt.I (+0,545) e il veggente ci sono 0,046 di correlazione. Aspettative
   calibrate su qualunque miglioria.
6. **Cadute due conclusioni di T2 sola**, e vanno ricordate come metodo: il «+92 della via di mezzo»
   (sulle 5 finestre: +0,0%) e «il motore batte il mercato» (il VALORE vince solo sulla finestra su cui
   era stato misurato). Una conclusione su una finestra non è una conclusione. **E il 10/08 sera la stessa
   disciplina ha PROMOSSO un item invece di ritirarlo**: il collo di bottiglia `pv` era anch'esso su T2 sola,
   rimisurato è 5/5 da due strade indipendenti.
7. **Il NETTO non è una moneta di draft** (10/08 sera): −52,3% sui rivali, 0/5, 34 crediti in 25 giri.
   λ è il tasso fra un credito e un fantapunto, e in un draft non spendi crediti, spendi SCELTE.

## Cosa è già stato RESPINTO — non riproporre senza rileggere

- **«Valore all'inizio, surplus quando gli slot scarseggiano»** (schedula θ): peggio in modo monotono
  quanto prima si cambia (lineare −36, gradino g6 −131, g11 −162 punti vs rivali sul metro a
  giornata); la schedula ROVESCIA pareggia il valore puro. Il meccanismo: la rosa sul valore copriva
  GIÀ meglio (98,8% dei posti contro 94,8%), perché la copertura È presenze.
- **Pavimenti prezzo come vantaggio trasferibile**: misurato col cross-fit leave-one-out il 10/08 sera,
  **nessuno passa** (media held-out −0,05%, 3/5) e col vincolo di copertura acceso il 200 vale −0,30%.
  Col prezzo come moneta il pavimento non compra niente (+30/+30/+29/+28 da 50 a 400): il vantaggio è
  l'ERRORE DI PREZZO, non la disciplina in sé.
- **La moneta ibrida letterale** (surplus in porta, valore sul movimento): −4,88%, 0/5. Difetto di SCALA,
  non di idea — e la forma onesta sulla scala non guadagna niente (−0,23%).
- **Il bersaglio `startingPlaces × 2`** come vincolo di copertura: non vincola (−4,20%, 0/5), perché quelle
  quote sommano 16 contro i 10 posti di un modulo. Si contano i POSTI.
- **La copertura come vincolo DURO** (niente fuori dai due undici): −1,44%. È un bisogno, non un divieto.
- **Tre undici** invece di due (−4,31%) e **un undici** solo (−5,34%): il 2 è interno alla griglia.
- **FVM archiviato come prezzo nei replay storici**: conosce l'esito (con quello ogni politica
  perdeva). Solo Qt.I.
- **Sintetizzare i voti euro 2021-22** per guadagnare due finestre: contaminerebbe il bersaglio euro con una
  trasformazione fittata, vietato da una regola che esiste già.
- Del motore, già respinte altrove e citate qui perché confinano: R12/R12b (prezzo lato fm), R18b/R18c
  (storia multi-stagione predittiva), il trim come predittore (−0,0012 ± 0,0077 contro la media
  piena).

## Errori di banco pagati, da non ripetere

- Un undici «i migliori 11» NON è legale: l'abbinamento è sui posti tipizzati del modulo (matroide
  trasversale, greedy esatto).
- Un posto scoperto vale ZERO e non azzera la giornata (come un «senza voto» senza panchinaro):
  l'errore opposto azzerava il 37% delle giornate e gonfiava i margini di un ordine di grandezza.
- Il confronto è APPAIATO (io meno la media dei rivali NELLO STESSO draft) e in PERCENTUALE (le
  stagioni hanno 29–31 giornate).
- I ruoli mantra vanno passati COMPLETI al matching (497/1014 con 2+ codici): col solo codice primario
  la flessibilità sparisce e le conclusioni cambiano.
- **Un porting si verifica sui NUMERI** (10/08 sera): la firma nuova passava il giocatore dove la vecchia
  passava lo slot, `places.get(giocatore)` è `undefined`, il peso valeva 1 per tutti e la tabella diceva che
  il surplus era la moneta migliore. Compilava.
- **Il file di lavoro va scritto in UTF-8 esplicito**: su Windows `open(out, "w")` scrive cp1252, quindi
  `windows.json` non era rileggibile dallo script che lo aveva scritto (innocuo per i numeri, e comunque un
  difetto latente).
- **Un pareggio di copertura fra due moduli è rotto dal primo**, e questo decide se un uomo «copre
  qualcosa»: è un limite reale, è asserito in un test e NON è stato «migliorato» dopo la misura — cambiare un
  tie-break dopo la corsa sarebbe spedire qualcosa che nessuno ha punteggiato.

---

## 5. Il TREND delle ultime 10 partite REALI (richiesta dell'operatore, 14/08/2026)

Nasce dal suo metodo personale, che ha una base misurabile: **il calendario EuroLeghe salta giornate**, quindi
chi guarda solo il voto euro perde partite vere. Misurato eseguendo `matchdays` il 14/08: nel 2025-26 le
giornate reali fuori dal calendario euro sono 7 su 38 in Serie A (la 9, 16, 17, 19, 20, 31, 38), 7 in Premier,
7 in Liga, 3 su 34 in Bundesliga, 4 su 34 in Ligue 1 — **il 18% delle partite di un uomo è invisibile nella sua
fantamedia euro**, e `matchday_map` sa esattamente quali.

- [ ] **5.1 — L'istogramma delle ultime 10 reali**, sia nell'app sia nel pannello Tk. Altezza = performance da
  una cascata DICHIARATA (voto vero se c'è → `mv_synth` se no → barra vuota, mai uno zero) e ogni barra dice su
  cosa sta; **xG+xA come SECONDO STRATO** sulla barra (scelta dell'operatore) e non dentro il numero;
  mini-icone gol/assist/giallo/rosso; e un segno sulle giornate che il calendario euro non ha contato.
- [ ] **5.2 — Gli stati della barra: due esistono, due no** (misurato 14/08). Disponibili: **≥75'** (netto:
  6.255 righe contro 5.646 spezzoni in Serie A 2025-26) e **infortunato** (da `injuries`, spell datato che
  copre la data). NON disponibili: **squalificato** (`availability` ha 633 righe e solo dal 26/07 al 10/08/2026
  — è uno snapshot, non una serie; e `reds` è 0 su tutto il 2025-26 nel layer per-partita) e **panchinato**
  (non esiste una riga con `minutes = 0`: sono tutte NULL, e il parse scarta la panchina senza ingresso).
  Quindi gli stati spedibili sono quattro — titolare pieno, spezzone, infortunato, **ignoto** — e «ignoto» non
  diventa «panchina» finché 5.3 non c'è.
- [ ] **5.3 — La panchina è recuperabile OFFLINE**: il parse ha già `keep_unplayed` (lo usa il layer `extra`) e
  i payload di tutte le giornate sono in cache, quindi `positions --layer reparse` con quell'opzione estesa al
  layer di lega crea le righe di panchina **senza una richiesta di rete**. La squalifica no: va derivata dai
  rossi di `match_ratings` e coprirebbe solo il calendario della piattaforma, non le giornate fuori.
- [ ] **5.4 — Il GIUDIZIO 0-99 del trend, per poterci ordinare** (richiesta del 14/08). Tre vincoli che il
  numero deve portare addosso, e il primo è il motivo per cui esiste questo item invece di una formula:
  **è una DESCRIZIONE, non una previsione.** Lo stesso giorno è stato misurato che lo scostamento dalle proprie
  medie non predice il rendimento successivo (eccesso vero +0,0167 / +0,0072 / −0,0007 a 2, 3 e 5 giornate, col
  segno che cambia, su ~65.000 finestre e col null rimescolato): quindi ordinare per trend è ordinare per
  «cosa ha fatto», che è legittimo e veloce, e vendere quel numero come «cosa farà» sarebbe la terza forma
  respinta della stessa idea. Il tooltip deve dirlo.
  Forma proposta: **la media dei fantapunti raccolti sulle sue ultime 10 partite REALI**, dove una partita non
  giocata conta 0 e una ignota non entra nel denominatore — così dentro ci sono sia la qualità sia la
  DISPONIBILITÀ, che è la metà grossa (`Var(ln pv)` è il 90% di `Var(ln fantapunti)`), esattamente come il
  valore che il pannello già usa. Poi `score99` sulla scala che l'app ha già, **con il pool dichiarato: dentro
  il RUOLO**, perché «va forte» è una frase relativa a quello che il suo ruolo può produrre e perché il pool di
  un percentile è parte della misura. Nessun gate: è reporting, non entra in nessuna valutazione.
