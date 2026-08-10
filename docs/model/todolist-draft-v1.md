# Todolist DRAFT v1 — migliorare i suggerimenti e le formule di valore/surplus

**Nata il 10/08/2026** dalla campagna di misure sulle strategie di draft (banco: replay delle 5 finestre
euro/mantra del gate — Tm4, Tm3, T0, T1, T2, bersagli 2019-20 → 2025-26 — prezzo Qt.I, undici LEGALE sui
moduli del regolamento, confronto appaiato dentro lo stesso draft). Le conclusioni misurate stanno in
fondo a questo file; gli item sono **ordinati per resa attesa**, come `todolist-formazioni-tipo-v1.md`.

**Regole che vincolano ogni item.** Qualunque cosa tocchi `engine_*` passa dal **gate** (regola d'oro);
i cambi al SOLO consiglio dell'app si misurano sul **banco** prima di cambiare il pannello (5 finestre,
entrambi i metri, verdetti strict/robust col pavimento 0,5% e nessuna finestra sotto −2%); un parametro
non si adotta al bordo della griglia né fittato sulla finestra che lo giudica. Prima di riproporre
un'idea, leggere «cosa è già stato respinto» in fondo.

---

## 0. Fondamenta: senza queste il resto non si misura

- [ ] **0.1 — Portare il banco dentro il repo.** Oggi vive nello scratchpad di UNA sessione
  (`.../scratchpad/sim/`: `engine.mjs` draft parametrico, `legal.mjs` undici legale con abbinamento su
  matroide trasversale, `table.mjs` prova di graduatoria, `multi.mjs` 5 finestre, `extract.py`
  estrazione dal DB) e **una chat nuova non lo trova**. Destinazione proposta: `toolkit/bench/draft/`
  (JS + lo script python), con i commenti tradotti in inglese (convenzione repo). `windows.json` NON va
  in git: porta nomi, prezzi e voti del contenuto a pagamento — si rigenera con `extract.py` (2 minuti,
  legge il DB in sola lettura).
- [ ] **0.2 — Dichiarare la lega `default`/mantra** in `config/league_config.json`, poi
  `snapshot --league NOME` ed `export`: oggi un draft mantra su listone Serie A ha **250 giocatori su
  503 senza numero**. Già in coda dalla sessione 09-10/08.
- [ ] **0.3 — I moduli CLASSIC in `config/`** (lista dal regolamento fantacalcio.it, come fu fatto per
  `mantra_modules.json`: configurazione, si legge, non si deduce). Serve all'item 3.1 e al pannello
  classic. Avvertimento dell'operatore, 10/08/2026: la legalità classic è per macro-ruolo e NON va
  dedotta per analogia da mantra.

## 1. Suggerimenti del draft (app, misurare sul banco prima di cambiare il pannello)

- [ ] **1.1 — La copertura per ruolo come VINCOLO del piano, non come peso.** È la leva più grossa
  misurata: coprire il modulo DUE volte (20 movimento + 2, 3 portieri) vale **+10,6 punti a giornata**,
  dieci volte la scelta della moneta. Oggi `auction-plan.needFor` dà 1 finché i posti base non sono
  coperti e poi `DEPTH_WEIGHT` 0,35 — il banco dice che il bersaglio del MIO pick dovrebbe essere
  `startingPlaces × 2`. Misura: la politica nuova contro quella attuale, 5 finestre, metro a giornata.
- [ ] **1.2 — Moneta ibrida: VALORE per il movimento, SURPLUS per la porta.** Il surplus come moneta
  generale di un draft è refutato (−4,0% medio, e −15,7% su Tm4); resta giusto dove il vincolo è reale
  — la porta (rimpiazzo por 4,36 contro pc 7,29), e ancora di più con la regola delle **porte**.
  Pre-registrare l'ibrida e misurarla sul banco; se passa, `pickForUs` e le radici del consiglio
  ordinano per valore con surplus solo su `por`. Il pannello mostra già entrambe le colonne
  (Valore 0–99 + surplus, 10/08/2026).
- [ ] **1.3 — Cross-fit leave-one-out del pavimento prezzo.** Il «pavimento 200» era stato scelto
  guardando T2: sulle 5 finestre la via di mezzo fa **+0,0%** (metro a giornata; +2,6% sui totali,
  4/5, nessun verdetto). Protocollo del `sweep`: si sceglie il pavimento su 4 finestre e si giudica
  sulla quinta. Se nessun valore passa held-out, il consiglio NON usa pavimenti: restano il tie-break
  «a parità prendi il meno quotato» e la coda punti-per-credito (`TAIL_*`, già misurata e già nel
  codice).
- [ ] **1.4 — Identificare la testa di ogni rivale DAI PICK CHE HA FATTO.** Oggi `predictRivalPick` usa
  una sola politica («il più caro che gli serve») per tutti. Dopo k scelte si può classificare ogni
  avversario (prezzo / giudizio / surplus / valore) da quale moneta prevede meglio le sue scelte
  passate, e far usare al lookahead la testa stimata. Misura sul banco: tavolo con teste vere miste,
  la previsione dei pick altrui deve migliorare rispetto alla politica unica.
- [ ] **1.5 — Il valore di BLOCCO** (idea dell'operatore, 10/08/2026, segnata e non implementata):
  `miglior XI(rivale + X) − miglior XI(rivale)` — prendere l'ultimo `Dc` forte che completerebbe
  l'undici di un avversario, anche a reparto pieno. Il banco sa già calcolarlo (`legal.mjs` +
  le rose stimate del lookahead). PRIMA misurare se e quando il denial batte il proprio best pick;
  solo dopo, la nota nel consiglio («toglie N punti a squadra Y»).
- [ ] **1.6 — La strategia porta in modalità porte.** Con la regola attiva l'unità è il club e il
  surplus è la grandezza giusta (caso Svilar: Qt.I 13, surplus 23,9). Il piano oggi tratta i portieri
  come slot: fargli leggere le porte quando `keeperMode = 'goals'`.

## 2. Formule di valore e surplus (toolkit/motore — tutto passa dal gate)

- [ ] **2.1 — Il collo di bottiglia è `pv_pred`, non `fm_pred`.** Misurato: la disponibilità separa i
  criteri (65,7 → 84,5 punti/giornata) mentre la fantamedia dell'undici no (7,05–7,56); su T2 le
  presenze previste correlano da sole **+0,545** col risultato vero contro **+0,313** della fantamedia
  prevista (provenienza: T2 sola); e `Var(ln pv)` è il 90% della varianza dei fantapunti (già nel
  gate). Un punto guadagnato su pv vale più di tre su fm: il lavoro sul motore si ordina di
  conseguenza.
- [ ] **2.2 — PRE-REGISTRARE: il Qt.I come segnale di titolarità (lato pv SOLTANTO).** Il mercato ci
  batte nel classificare (Qt.I +0,545 medio contro il nostro VALORE +0,514, 4 finestre su 5) e il Qt.I
  incorpora l'opinione del suo autore sulla titolarità — il lato dove siamo deboli. R12/R12b sono
  falsificate sul lato FANTAMEDIA («costruito sulla stessa storia»), il lato presenze non è mai stato
  misurato. Regola dell'operatore («la quotazione quando non abbiamo altre risorse oggettive») =
  precedenza, il gate decide. Giudicare anche sul deliverable (`captured_value`).
- [ ] **2.3 — I buchi di input che il gate ha già indicato**, in ordine: `value_share` mancante per gli
  arrivi (196 righe euro su 975 senza, e proprio sugli uomini per cui il canale esiste — caso Ramos);
  il braccio delle FEE ha solo 3 finestre (le fee esistono dal 2023); allargare la copertura
  dell'FM-equivalente (la direzione «il collo di bottiglia è la copertura» ha già due conferme).
- [ ] **2.4 — `FM 5a` in DISPLAY sulla riga d'asta** (media 5 stagioni + numero di stagioni, con la
  regola del trim ≥5). Rinviata dall'operatore il 10/08 («per il momento non fare niente») — è la via
  aperta della memoria `multi-season-fm-intuition`: mostrare, non prevedere. R18b/R18c sono già
  respinte: nessuna forma predittiva senza pre-registrazione.
- [ ] **2.5 — Il calendario dentro l'orizzonte del consiglio.** `desc_easy_matches` e
  `desc_calendar_margin` sono già nel foglio (display-only). Misurare sul banco se pesare il pv
  DELL'ORIZZONTE col calendario del club (finestra `from`–`to` del pannello) migliora il consiglio.
  Non tocca `engine_*`; se mai dovesse entrarci, gate.
- [ ] **2.6 — Documentare la moneta per formato** in `assistente-asta-v1.md`: il SURPLUS resta la
  grandezza giusta per le aste a CREDITI (budget scarso) e per la porta; il VALORE per il draft
  mantra. Non è un difetto del surplus da «correggere»: sono due domande diverse, e la scelta è per
  formato. Con i numeri e le date di questo file.

## 3. Consolidamenti rimasti aperti

- [ ] **3.1 — Il giro su CLASSIC** (dipende da 0.2 e 0.3): sotto legalità classic la quota per ruolo è
  un vincolo di regolamento, quindi la gerarchia delle monete va rimisurata — l'ipotesi è che il
  surplus vi si comporti molto meglio che su mantra, ed è un'ipotesi, non una conclusione.
- [ ] **3.2 — Stagioni-bersaglio in più per il banco.** Tm5 (2018-19) ha voti euro ma il suo INPUT
  2017-18 non ha righe euro: verificare se il foglio si può costruire da `default` (come fa il gate
  per le finestre lunghe di Serie A) e guadagnare una sesta finestra.
- [ ] **3.3 — Il banco assume 12 squadre / 25 giri / 3 portieri**: parametrizzarlo sulla lega dichiarata
  (`league_config.json`) quando entra nel repo (0.1).

---

## Le conclusioni misurate che questa lista dà per acquisite (10/08/2026)

1. **«Giocare per scegliere primo» è rovinoso**: −45,8% sui rivali, 0/5 finestre. Il risultato più
   solido della campagna.
2. **Il SURPLUS è la moneta sbagliata per un draft mantra** (−4,0%, 2/5): sconta una scarsità per slot
   che il regolamento non impone (3 P + 22 movimento, nessuna quota; 497 giocatori su 1014 con 2+
   codici). Resta giusto per la porta e per le aste a crediti.
3. **La copertura per ruolo vale più della moneta, di un ordine di grandezza** (+10,6 punti/giornata
   contro 0,8 fra le monete). I primi 25 di QUALUNQUE graduatoria non schierano un undici legale
   (4–10 posti su 11): la rosa si costruisce coprendo il modulo, due volte.
4. **La fantamedia dell'undici non separa i criteri** (7,05–7,56): separa la DISPONIBILITÀ. `FM −1` è
   il peggiore dei criteri onesti (65,7 punti/giornata), quindi motore e prezzo aggiungono qualcosa di
   reale sopra «la fantamedia dell'anno scorso».
5. **Il tetto è vicino**: l'FVM archiviato — che CONOSCE l'esito — correla +0,591 e fa 84–93,6
   punti/giornata; fra il Qt.I (+0,545) e il veggente ci sono 0,046 di correlazione. Aspettative
   calibrate su qualunque miglioria.
6. **Cadute due conclusioni di T2 sola**, e vanno ricordate come metodo: il «+92 della via di mezzo»
   (sulle 5 finestre: +0,0%) e «il motore batte il mercato» (il VALORE vince solo sulla finestra su cui
   era stato misurato). Una conclusione su una finestra non è una conclusione.

## Cosa è già stato RESPINTO — non riproporre senza rileggere

- **«Valore all'inizio, surplus quando gli slot scarseggiano»** (schedula θ): peggio in modo monotono
  quanto prima si cambia (lineare −36, gradino g6 −131, g11 −162 punti vs rivali sul metro a
  giornata); la schedula ROVESCIA pareggia il valore puro. Il meccanismo: la rosa sul valore copriva
  GIÀ meglio (98,8% dei posti contro 94,8%), perché la copertura È presenze.
- **Pavimenti prezzo come vantaggio trasferibile** (vedi 1.3): optimum interno per finestra, livello
  non trasferibile; e col prezzo come moneta il pavimento non compra niente (+30/+30/+29/+28 da 50 a
  400) — il vantaggio è l'ERRORE DI PREZZO, non la disciplina in sé.
- **FVM archiviato come prezzo nei replay storici**: conosce l'esito (con quello ogni politica
  perdeva). Solo Qt.I.
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
