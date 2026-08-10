# Todolist DRAFT v1 — migliorare i suggerimenti e le formule di valore/surplus

**Nata il 10/08/2026** dalla campagna di misure sulle strategie di draft (banco: replay delle 5 finestre
euro/mantra del gate — Tm4, Tm3, T0, T1, T2, bersagli 2019-20 → 2025-26 — prezzo Qt.I, undici LEGALE sui
moduli del regolamento, confronto appaiato dentro lo stesso draft). Le conclusioni misurate stanno in
fondo a questo file; gli item sono **ordinati per resa attesa**, come `todolist-formazioni-tipo-v1.md`.

**Prima passata di esecuzione: 10/08/2026, sera.** Chiusi 0.1, 0.2, 0.3, 1.1, 1.2, 1.3, 1.6, 2.1, 2.6, 3.2,
3.3. I numeri di tutto quello che segue stanno in
[metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md) §16 (politiche del draft),
[assistente-asta-v1.md](assistente-asta-v1.md) §26 (moneta per formato e cosa fa il pannello) e
[gate-motore-v1.md](gate-motore-v1.md) §7-octovicies (il collo di bottiglia `pv`, e la pre-registrazione del
Qt.I). **Citare da lì, non da qui:** questo file porta lo stato, non la misura.

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
  sotto — è la ricaduta se un giorno il matroide diventasse un costo.
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
- [ ] **1.4 — Identificare la testa di ogni rivale DAI PICK CHE HA FATTO.** NON misurata. Oggi
  `predictRivalPick` usa una sola politica («il più caro che gli serve», più la coda punti-per-credito) per
  tutti. Dopo k scelte si può classificare ogni avversario (prezzo / giudizio / surplus / valore) da quale
  moneta prevede meglio le sue scelte passate, e far usare al lookahead la testa stimata. Misura sul banco:
  tavolo con teste vere miste, la previsione dei pick altrui deve migliorare rispetto alla politica unica.
  **Il banco ora sa già fare metà del lavoro** — `engine.mjs` assegna una `KIND` diversa a ogni sedia e la
  restituisce (`kinds`), quindi la verità è disponibile per punteggiare un classificatore.
- [ ] **1.5 — Il valore di BLOCCO** (idea dell'operatore, 10/08/2026, segnata e non implementata):
  `miglior XI(rivale + X) − miglior XI(rivale)` — prendere l'ultimo `Dc` forte che completerebbe l'undici di
  un avversario, anche a reparto pieno. Il banco sa già calcolarlo (`legal.mjs` + le rose che il draft tiene
  per ogni squadra, ora complete di ruoli). PRIMA misurare se e quando il denial batte il proprio best pick;
  solo dopo, la nota nel consiglio («toglie N punti a squadra Y»).
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
  una conclusione: rimisurata sulle cinque finestre (`signal.py`), `pv_pred` batte `fm_pred` su **5/5**,
  Spearman +0,459 contro +0,259, Pearson +0,465 contro +0,303 — e i due numeri che l'item citava (+0,545 e
  +0,313) sono esattamente la colonna T2 di Pearson. La decomposizione della varianza dà la stessa risposta
  da un'altra strada: `Var(ln pv)` è l'86,8%-90,6% di `Var(ln fantapunti)` su tutte e cinque. Conseguenza
  sull'ORDINE del lavoro: a parità di plausibilità, una regola candidata che tocca le presenze merita il gate
  prima di una che tocca la fantamedia.
- [ ] **2.2 — PRE-REGISTRATA, non misurata: il Qt.I come segnale di titolarità (lato pv SOLTANTO).**
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
- [ ] **2.5 — Il calendario dentro l'orizzonte del consiglio.** NON misurata. `desc_easy_matches` e
  `desc_calendar_margin` sono già nel foglio (display-only). Misurare sul banco se pesare il pv
  DELL'ORIZZONTE col calendario del club (finestra `from`–`to` del pannello) migliora il consiglio.
  Non tocca `engine_*`; se mai dovesse entrarci, gate.
- [x] **2.6 — Documentare la moneta per formato.** Fatto in `assistente-asta-v1.md` §26.1, con la tabella
  formato → risorsa scarsa → moneta (crediti → surplus; draft mantra → valore; porta → surplus e l'unità è il
  club) e le due precisazioni che la misura ha aggiunto: in un **draft** il valore vince anche in porta, e il
  **netto** non è una moneta di draft e non è una taratura da correggere.

## 3. Consolidamenti rimasti aperti

- [ ] **3.1 — Il giro su CLASSIC.** Le due dipendenze sono chiuse (0.2 e 0.3), la misura NO. Sotto legalità
  classic la quota per ruolo è un vincolo di regolamento, quindi la gerarchia delle monete va rimisurata —
  l'ipotesi è che il surplus vi si comporti molto meglio che su mantra, ed è un'ipotesi, non una conclusione.
  È l'item più interessante rimasto. Serve: `extract.py serie-a.json "Leghe Mantra"` (già parametrico) e un
  `legal.mjs` che sappia leggere `classic_modules.json` (i moduli hanno la stessa forma, ma la legalità è per
  conteggio di macro-ruolo e **non va dedotta per analogia**).
- [x] **3.2 — Stagioni-bersaglio in più per il banco.** Misurato e la risposta è NO da `default`: il
  bersaglio euro 2018-19 ha 566 giocatori con voti, e l'input 2017-18 da `default` ne copre **88 (15,5%)** —
  gli italiani; i 478 che mancano sono esattamente gli stranieri per cui euro esiste. Da `external_stats` la
  copertura è **501 (88,5%)**, quindi la finestra è *costruibile* ma con l'input sintetico per la totalità
  della popolazione: aggiungere una finestra muove OGNI verdetto del gate, quindi è una **pre-registrazione**
  e non è stata fatta. Trappola trovata strada facendo, e vale più della finestra: `match_ratings` per euro
  2021-22 ha **17.825 righe con tutti i bonus pieni e `mv` a 0 su 17.825** — chi conta le righe conclude
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
