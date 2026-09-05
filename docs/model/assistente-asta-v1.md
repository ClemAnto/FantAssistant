# Assistente d'asta — v1 (5 agosto 2026)

**Cos'è**: le decisioni di progetto fissate con l'operatore **prima di scrivere codice**, su come l'app
accompagna un'asta vera. Non è un documento di gate: dove dichiara un numero che tocca una *previsione*,
quel numero passa dal gate o dallo sweep come qualunque altro. Dove dichiara una **funzione obiettivo** —
l'ordinamento, il tetto di rilancio — vale la porta del §10 di
[metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md): forma e metrica dichiarate prima, misura dopo,
verdetto a verbale qualunque sia.

Fratello di `metrica-asta-surplus-v1.md`: quello dice **con che valuta si ordina**, questo dice **cosa
l'assistente ne fa al tavolo**.

⚠️ **Il primo step è SOLO il DRAFT** (decisione dell'operatore, 5/08/2026). I §1-§10 sono scritti per
l'asta a rilanci e restano validi come destinazione; **il §11 dice cosa cambia, e soprattutto cosa NON
serve costruire adesso** — dove i due si contraddicono, per il primo step vince il §11.

---

## 1. Il flusso: cinque momenti, e i primi tre stanno PRIMA

1. **Setup lega** — piattaforma, game, numero di partecipanti, slot di rosa.
2. **Modalità d'asta** — a rilanci / draft, budget iniziale, ordine di chiamata.
3. **Strategia / obiettivi**.
4. **Suggerimento** — chi prendere, e che operazione fare (prendere, rilanciare fino a X, lasciare).
5. **Seguire l'asta** — registrare i movimenti propri e altrui, in modo asincrono e reversibile.

**La regola dura che ne esce: 1-3 sono pre-asta, 4-5 sono in diretta, e durante l'asta non si configura
niente.** Un'asta è difficile da seguire *anche senza* un pannello da impostare: una strategia che chiede
input mentre l'asta corre è un errore di design, non una feature. L'unico comando vivo durante l'asta è il
**toggle di preferenza su un nome** (§3), che non è un settaggio ma un evento.

Il punto 1 non è contorno: è ciò che **fissa il livello di rimpiazzo**, cioè lo zero del surplus
(`config/league_config.json`, `my_leagues`: platform, game, teams, squad_slots). Cambiarlo cambia ogni
numero mostrato, quindi va chiesto prima di mostrare qualsiasi numero — e un surplus senza la sua lega non
è confrontabile con quello di un'altra lega. Il punto 2 è nuovo per il motore: budget iniziale × numero di
partecipanti è il **monte crediti** della lega, che è ciò che converte un surplus in euro spendibili.

**Default, per non rallentare le prove**: la lega dichiarata in `league_config.json` (oggi *EuroLeghe*,
euro/classic), 8 squadre, 3P/8D/8C/6A, **draft** con le regole d'ordine del §11 (per il primo step è
l'unica modalità; l'asta a rilanci col suo budget arriva dopo). Tutti modificabili, nessuno da riempire per
vedere il primo suggerimento.

## 2. Le «strategie» non sono strategie: sono un obiettivo più dei vincoli

Le cinque opzioni discusse dall'operatore, mappate:

| Opzione discussa | Cos'è davvero |
|---|---|
| 1. nessuna, decide l'assistant | **nessun vincolo** — il baseline, e il metro con cui si misura il costo di ogni vincolo |
| 2. calciatori chiave da prendere | vincolo **soft** su individui (con un sovrapprezzo massimo) |
| 4. calciatori da evitare | vincolo **hard** su individui |
| 3. budget/priorità per ruolo | forma della spesa **fra** i reparti |
| 5. top+scartine vs tanti medi | forma della spesa **dentro** un reparto (concentrazione) |

Conseguenza architetturale, ed è il motivo per cui la distinzione conta: **un ottimizzatore più vincoli
dichiarativi**, non cinque modalità. Cinque modalità sono cinque percorsi di codice che si contraddicono
appena l'operatore ne vuole due insieme (chiavi *e* blacklist *e* budget per reparto); i vincoli si
combinano gratis, e ognuno ha un costo misurabile in surplus atteso, che è il numero che l'app deve saper
dire.

Due avvertenze che restano scritte anche se v1 non le implementa:

- **«prendere a ogni costo» non è specificabile.** Un target senza tetto distrugge il resto della rosa,
  quindi la forma onesta è «target con sovrapprezzo massimo accettato» + la visualizzazione di **cosa ti
  costa altrove**.
- **La concentrazione (opzione 5) non è una preferenza: è misurabile, e in v1 EMERGE da sola** (§4.4).
  Conviene concentrare dove la curva surplus/prezzo del reparto è convessa e spalmare dove è piatta, e la
  forma della curva dipende da reparto, lega e numero di squadre — cose che il livello di rimpiazzo già
  conosce. Se un giorno diventa un parametro, è un parametro da sweep e non una scelta di UI.

## 3. Decisione v1: guida l'assistant, l'operatore tocca solo le preferenze sui nomi

**Nessuna customizzazione della strategia in v1.** Restano fuori budget per ruolo, concentrazione,
obiettivi dichiarati. Vive un solo comando, ed è disponibile **anche durante l'asta**: la **preferenza per
giocatore**, selezionabile e deselezionabile.

Lettura operativa della preferenza, con due segni (assunzione dichiarata, perché collassa le opzioni 2 e 4
in un unico controllo):

- **«lo voglio»** → non cambia la previsione di nessuno. Alza il tetto di rilancio del sovrapprezzo
  accettato e tiene il nome in vista; accanto, **quanto costa** in surplus atteso rinunciato.
- **«evitalo»** → esce dal pool. Non è cosmetico: uscendo dal pool smette di essere il *mio piano B*, e
  questo alza il tetto di chi lo sostituisce (§4.2). Un vincolo hard è gratis da implementare e non è
  gratis da esercitare, e l'app deve dire la differenza.

Perché questo è il v1 giusto e non pigrizia: il costo di un vincolo lo sappiamo *definire* (§2) ma non
ancora *prezzare in diretta*, e la regola di UI del §1 dice che durante l'asta non si configura. Un toggle
su un nome è un evento, come registrare un acquisto: sta dentro la regola.

## 4. Cosa deve rispondere: tre domande, tre numeri, e non sono lo stesso numero

> **02/09/2026 — la quarta domanda ha ora una risposta misurata, e sta altrove.** «Fino a quanto posso
> offrire per questo?» non è una delle tre di questa sezione, e il banco d'asta l'ha misurata sulle aste
> vere: `simulatore-asta-rilanci-v1.md` **§19.3** porta un LISTINO per fascia di ruolo, in crediti, per
> una lega da dieci squadre e mille crediti — con accanto quanto ci paga di solito il mercato, che è
> l'informazione che dice se alzare o lasciare. È il candidato naturale per una colonna di questa pagina,
> e non è ancora nell'app.


Le tre attese dell'operatore — *valutare cosa mi serve per completare una rosa competitiva*, *dare il
giusto prezzo*, *approfittare degli affari* — sono tre quantità distinte. Mostrarne una sola, o fonderle in
un punteggio, è il modo di perderle tutte e tre.

### 4.1 «Cosa mi serve» → il rimpiazzo diventa PERSONALE

Il surplus spedito oggi è `(FM − rimpiazzo) × Pv × beccabilità`, dove il rimpiazzo è **il giocatore
marginale che la lega mette in rosa** in quel ruolo. È la valuta giusta per una graduatoria pre-asta.

Durante l'asta la domanda cambia: l'alternativa a schierare quest'uomo non è il marginale della lega, è
**l'uomo che ho già in rosa in quel ruolo**. Quindi

> il numero che guida un acquisto è il **surplus marginale rispetto alla MIA rosa**: quanto alza l'undici
> che mi aspetto di schierare, non quanto vale in astratto.

Conseguenze immediate, e sono esattamente le cose che l'operatore chiede all'app di vedere:

- il quarto centrocampista forte vale **meno** del primo, perché starebbe in panchina — il rimpiazzo
  personale sale mano a mano che il reparto si riempie;
- uno slot ancora vuoto vale **più** del suo surplus nominale, perché la sua alternativa è il peggior
  riempitivo disponibile;
- il valore di un giocatore **cambia a ogni acquisto**, mio e altrui. Non è una rifinitura: è il motivo per
  cui il punto 5 del flusso (seguire l'asta) alimenta il punto 4 e non è solo contabilità.

### 4.2 «Il giusto prezzo» → tre ingredienti, e il terzo è un tasso di cambio

Il tetto di rilancio non si legge dal surplus: il surplus è in fantamedie, un rilancio è in crediti. La
forma dichiarata:

> **tetto(i) = costo del mio piano B per quello slot + (surplus marginale di i − surplus del piano B) / λ**

- **piano B** = il migliore uomo alternativo per quello slot, al suo prezzo atteso. È ciò che rende il
  numero un *prezzo di indifferenza*: pagare il tetto mi lascia indifferente fra prendere lui e eseguire il
  piano B.
- **λ** = il **prezzo ombra del credito**: quanto surplus marginale un credito compra altrove, dato il
  budget residuo, gli slot residui e il pool rimasto. Si ottiene ordinando il pool residuo per surplus
  marginale per credito e scendendo finché budget e slot si esauriscono.
- Degenera bene: se il giocatore *è* il mio piano B, il tetto è il suo prezzo atteso di mercato. Se il pool
  è ricco (λ alto), i tetti si abbassano da soli; se sto restando senza alternative, salgono.

**λ è una stima, e all'inizio dell'asta è la stima peggiore che l'app produce** (dipende dai prezzi attesi
di tutto il pool, che nessuno ha ancora visto battere). Quindi il tetto si mostra come **banda**, non come
cifra secca, e la banda si stringe mano a mano che l'asta fornisce prezzi veri. Precisione finta su questo
numero è la bugia più costosa che il pannello potrebbe dire.

### 4.3 «L'affare» → due prezzi, mai fusi in uno

Un affare è `tetto − prezzo corrente sul tavolo`. Serve un **secondo modello, descrittivo**: non «quanto
vale per me» ma «quanto pagherà il mercato». Sono numeri diversi e la loro **differenza è l'affare**;
fonderli in un unico score cancella l'informazione che serve.

Il prior dichiarato per il prezzo di mercato, e le sue ragioni:

- si parte dal **FVM**, non dalla Qt.I: è la valutazione più fresca («varia ogni settimana o quando ci sono
  eventi particolari») ed è dieci volte più fine (Qt.I di un attaccante 1-40, FVM 1-430);
- **riscalato sul monte crediti** della lega. È una legge di conservazione e ha denti: la somma di ciò che
  si paga è la somma dei budget, quindi se i primi attaccanti vanno sopra il prior, **il resto deve andare
  sotto**. È questo che rende dicibile «il mercato sta pagando gli attaccanti fuori valore, sposta budget
  sui centrocampisti» — l'opportunismo, che in un'asta a rilanci è dove sta il guadagno più grosso;
- si aggiorna in diretta con un fattore di inflazione osservato per reparto (pagato / prior sui nomi già
  usciti).

E il **budget residuo degli avversari** va tracciato, perché sapere che tre squadre hanno finito i crediti
cambia ogni prezzo atteso e quindi ogni tetto. Nell'asta a rilanci è l'informazione che si guadagna con
meno lavoro.

### 4.4 Perché «top+scartine o tanti medi» non serve chiederlo

Con il §4.1 (rimpiazzo personale) e il §4.2 (vincolo di budget con prezzo ombra), la concentrazione **cade
fuori dalla contabilità**: se in un reparto due uomini staccano davvero, il loro surplus marginale batte λ e
li si compra; se il reparto è piatto, nessuno lo batte e si spalma. È il caso in cui una scelta di strategia
è la conseguenza di una misura, non un'opzione da spuntare — e vale la pena verificare *a posteriori* che
l'assistente produca forme di rosa diverse nei reparti in cui la curva è diversa. Se non lo fa, è un difetto
del §4.1, non una strategia che manca.

## 5. Il vincolo sempre acceso: chiudere la rosa

Non è strategia, è **fattibilità**, e vale in ogni configurazione: bisogna riempire N slot con almeno 1
credito ciascuno.

> tetto effettivo = min( tetto del §4.2 , budget residuo − (slot residui dopo questo − 1) )

Senza questo il consiglio diventa inutilizzabile **negli ultimi venti minuti d'asta**, che è quando serve
di più. E va mostrato quando è lui a mordere: un tetto tagliato dalla fattibilità e uno tagliato dal valore
dicono all'operatore due cose diverse.

## 6. Cosa esiste già, e cosa manca

Esiste (e va riusato, non riscritto):

- il **SURPLUS** per lega, con livelli di rimpiazzo, profondità di rosa e beccabilità misurate
  (`engine/features.py`, `engine/evaluate.py:auction_view`);
- **ogni giocatore ha un numero** dal 5/08/2026: le righe fuori dal dominio del core (`MIN_PV_PREV` = 15)
  hanno una **stima** dichiarata con penalità e nota in parole (`engine/estimate.py`, colonne `est_*`, spec
  «Novità v9.24»). Prerequisito d'asta già chiuso: su un giocatore senza numero non si può rilanciare, e
  Serie A è passata da 346/629 a 629/629;
- la colonna **Pair** (K, co-start, ΔQt.I), che porta l'evidenza dell'affollamento al decisore senza
  riordinare nulla;
- **una lista sola di tutti i giocatori** dall'8/08/2026, ordinabile per ogni colonna e filtrabile per
  ruolo e per squadra (spec «Novità v9.45»), con dentro anche chi la classifica non può tenere;
- **SpM/dVM**, il surplus riespresso nella moneta del listone e la differenza con l'FVM
  (`evaluate.market_rates`, [metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md) §14). È la versione
  **statica** del §4.3: stessa legge di conservazione, letta però dal mercato invece che dal monte crediti,
  e senza asta in corso — quindi dice chi è caro *fra i suoi pari ruolo*, mai quanto spendere per reparto;
- il **bundle** `data/export/<season>/` come unico canale dati dell'app, con `manifest.json` normativo.

Manca, in ordine di quanto blocca:

1. **La modalità live.** Tutto l'harness assume che l'esito esista: `_window_is_usable` vuole almeno 50
   fantamedie vere e `auction_view` confronta **due** liste. Un'asta ha **una** lista, e il pannello ora la
   mostra così su ogni stagione (spec «Novità v9.45»), stagione LIVE compresa; quello che resta — il tavolo
   in diretta — è dell'app, ed è scritto in `app/README.md`.
2. **Il rimpiazzo personale** (§4.1): oggi il rimpiazzo è di lega e statico.
3. **λ e il tetto di rilancio** (§4.2): non esistono, in nessuna forma.
4. **Il modello di prezzo di mercato** e il budget residuo degli avversari (§4.3).
5. **Il log eventi d'asta**: nel database non c'è nulla che registri un'asta (nessuna tabella di crediti,
   budget o prezzi pagati — verificato su `db/schema.sql`).
6. **L'app**: `app/` è un placeholder, il prossimo passo è lo scaffolding Angular/Electron e il port di
   `engine/model.py` + `engine/features.py` contro `bundle.sqlite`.

## 7. Cosa non è misurabile offline — e va detto, non aggirato

- **Non esistono prezzi d'asta storici.** Lo schema non ha nessuna tabella di aste, budget o cifre pagate:
  ci sono solo le quotazioni del listone. Quindi il modello di prezzo di mercato del §4.3 **non è
  backtestabile**: nasce da un prior dichiarato e si calibra **dentro l'asta stessa**. Conseguenze da
  accettare in anticipo: l'app deve riportare il proprio errore di calibrazione in diretta (prior vs
  pagato, per reparto), e «affare» non è un verdetto validato ma la differenza fra due stime, di cui una
  non ha storia. Il primo effetto collaterale utile della v1 è che **da quest'anno quei prezzi esistono**:
  il log eventi è anche il primo dataset d'asta del progetto.
- **`probable_starter` è vuoto per costruzione** sulle finestre passate, e non è un buco che aspetta di
  essere colmato: un'asta iniziale si fa in agosto, quando la pagina non esiste ancora. Se un giorno si
  legge, si legge **appena prima del calcio d'inizio** e si usa subito.
- **`exit_risk` / `contract_until`** è uno snapshot di oggi: usabile per l'asta che viene, mai mostrabile
  come fatto storico.

## 8. Disciplina che resta valida al tavolo

- **La quotazione entra solo come prezzo d'ingaggio.** «Utilizziamo la quotazione quando non abbiamo altre
  risorse oggettive» (regola dell'operatore, 04/08/2026): il *valore* viene dal calcio giocato, il prezzo
  del tavolo è ciò contro cui si fa un'offerta. Le due irriducibili restano il **ruolo** del listone e la
  **cifra chiesta**; fra le due, il **FVM** viene prima della Qt.I perché è il giudizio più fresco.
- **Un parametro che tocca una previsione passa dal gate o dallo sweep**, anche se nasce come opzione di
  UI. Nessun numero di strategia si tara guardando l'esito.
- **Una cella vuota è una dichiarazione**: motivo esplicito, mai uno zero travestito.
- **Un numero fittato si cita con piattaforma, baseline residuale e data**, o si cita il report.

## 9. Regole di interfaccia — requisiti, non gusto

L'operatore ha posto la reattività come condizione: «è complicato seguire un'asta dovendo anche impostare e
selezionare i vari movimenti».

- **Tutta la configurazione prima, durante l'asta nessuna.**
- **Un nome, un tetto, un motivo in una riga.** Non una tabella da leggere: il pannello risponde alla
  domanda «cosa faccio adesso», e il resto è approfondimento su richiesta.
- **Registrare un acquisto altrui costa due click, e i dettagli sono opzionali.** L'informazione
  obbligatoria è *esce dal pool*; *a chi* e *a quanto* migliorano il modello (§4.3) ma non devono bloccare
  la registrazione. Un'app che chiede tre campi per togliere un nome verrà abbandonata a metà asta.
- **Ogni movimento è un evento reversibile.** Log di eventi, non campi sovrascritti: annulla e modifica in
  qualunque momento, su qualunque movimento, anche vecchio. Stessa lezione dei `valid_from` e di
  `fvm_history` — uno stato volatile tenuto come campo statico è uno stato che si perde.
- **Il ricalcolo è a ogni evento e deve essere istantaneo**, quindi λ e i rimpiazzi personali vanno
  progettati **incrementali** dall'inizio: un ricalcolo pieno del pool a ogni click non regge il ritmo di
  un'asta.
- **La geometria è una misura**: qualunque affermazione sul layout si verifica leggendo
  `winfo_height`/`winfo_rooty` (o l'equivalente nel DOM) e si asserisce come **rapporto**, così il test
  sopravvive a un altro display. Lezione pagata: una status bar collassata a 1×1 px è sopravvissuta dal
  giorno in cui è stata scritta.

## 10. Parcheggiato, con la ragione

Non «da fare»: **da fare quando la ragione qui sotto decade.**

- **Budget per reparto, concentrazione, blacklist come strategia** (§2) → quando l'app sa prezzare in
  diretta il costo di un vincolo, così l'operatore lo sceglie sapendo cosa paga.
- **L'obiettivo dichiarato: FM attesa totale vs probabilità di vittoria** → non sono la stessa cosa (chi
  parte sfavorito vuole varianza), ma servirebbe un modello di varianza della rosa che non abbiamo.
- **Massimo giocatori per club** (rischio correlato: un attacco della stessa squadra si azzera insieme) e le
  coppie di portieri dove il regolamento le premia → vincoli di rosa che non passano dal valore.
- **Avversione all'incertezza** come leva esplicita → in parte già fatta dalla penalità delle righe `est_*`,
  quindi prima si misura quanto ne resta.
- **Ordine di chiamata** → leva a costo zero dove la lega lascia chiamare, ma richiede il modello di prezzo
  di mercato (§4.3) per sapere chi gli altri non hanno ancora valutato.
- ~~**Modalità draft**~~ → **promossa a primo step il 5/08/2026, §11.** Ciò che resta parcheggiato è
  l'**asta a rilanci**: budget in crediti, λ da stimare, modello di prezzo di mercato. Il draft chiede la
  stessa contabilità marginale (§4.1) e non chiede nessuna delle due stime.
- **Riaprire `surplus_pressure`** → resta spenta finché non arrivano `injuries` o lo storico settimanale di
  `probable_starter`; comprava 0 bust in meno (`metrica-asta-surplus-v1.md` §11).

---

## 11. Primo step: SOLO draft (5 agosto 2026)

Decisione dell'operatore: si costruisce **prima il draft**, con le regole d'ordine della sua lega. Non è un
sottoinsieme dell'asta a rilanci: è un gioco diverso, e sotto c'è la ragione per cui è anche il passo giusto
da fare per primo.

### 11.1 Le regole d'ordine, come dettate

1. **Primo giro: ordine custom** — lo decide la lega, l'app lo prende come input.
2. **Dal secondo giro** si calcola il **valore rosa** di ogni squadra (somma degli FVM dei giocatori presi)
   e sceglie primo **il più basso**. Il giro è una **barriera**: tutti scelgono prima che il giro successivo
   cominci.
3. **Parità di valore rosa** → sceglie **dopo** chi possiede il singolo calciatore dal valore più alto.
4. **Ulteriore parità** → si adotta **l'ordine del primo giro**.

Tre letture che il codice deve rispettare, e che non sono ovvie:

- **Il primo giro non è solo il primo giro: è il tie-break permanente.** Va registrato esattamente, per
  tutte le squadre, e non è un dettaglio di avvio.
- **La regola 3 non morde al secondo giro** — con un solo giocatore a testa, il valore rosa *è* il valore
  del giocatore più alto, quindi due squadre in parità restano in parità e decide la 4. Comincia a contare
  **dal terzo giro**, dove {200, 50} e {150, 100} valgono entrambe 250 ma la prima sceglie dopo.
- **Quindi la regola 3 è un meccanismo anti-concentrazione**, e tassa la strategia «top+scartine» una
  seconda volta oltre al valore rosa. In questo formato la scelta fra concentrare e spalmare è in parte
  decisa **dal regolamento**, non solo dalla curva del surplus (§4.4).

### 11.2 Non è «un'asta senza soldi»: è un'asta col prezzo PUBBLICO e FISSO

**La valuta è l'FVM, e non si contratta: si paga il prezzo di listino, in ritardo di scelta.** Prendere un
uomo da FVM alto alza il valore rosa e mi sposta indietro nei giri seguenti; prendere a poco mi tiene
davanti. Conseguenze, e sono tutte semplificazioni:

- **Il §4.2 (tetto di rilancio) e il §4.3 (modello di prezzo di mercato) non servono.** Il prezzo non va
  stimato: è scritto sul listone, uguale per tutti, noto in anticipo. Quindi **il buco dichiarato al §7 —
  nessun prezzo d'asta storico nel database — non morde qui**, ed è la ragione tecnica per cui il draft è
  il primo step giusto: è la modalità in cui l'app non deve indovinare niente sui prezzi.
- **Il budget esiste, è implicito, e la regola lo EQUALIZZA**: ordinare per valore rosa crescente spinge
  tutte le squadre verso lo stesso totale FVM. Stima a priori: `FVM totale dei giocatori che verranno presi
  / numero di squadre`, raffinabile a ogni giro. Nessuno lo dichiara e tutti ce l'hanno.
- **λ resta, e non va stimato in diretta**: diventa **surplus marginale per unità di FVM**, calcolabile sul
  pool residuo con prezzi certi.
- **Un vincolo di fattibilità c'è ancora** (§5), ma non è di crediti: è di **slot per reparto**. La rosa
  deve chiudere legale, quindi negli ultimi giri i ruoli scoperti diventano obbligatori e il consiglio deve
  dirlo prima che sia tardi, non quando è tardi.

### 11.3 La tesi del progetto, in una riga

L'FVM è il giudizio di qualcuno, il surplus è calcio misurato. A prezzi fissi e uguali per tutti, **il draft
premia esattamente i punti in cui i due sono in disaccordo**: la valuta operativa è il **surplus marginale
per FVM**, e «approfittare degli affari» significa prendere gli uomini che il listone prezza sotto quello che
il calciatore ha reso, lasciando che gli altri paghino posizione per i nomi. È la forma più pulita in cui la
regola dell'operatore («la quotazione quando non abbiamo altre risorse oggettive») diventa un vantaggio
competitivo invece di una precauzione.

**Prima misura da fare, e si può fare oggi senza simulare nulla**: il surplus per unità di prezzo **per
decile di prezzo**. Dice dove il mercato paga troppo — se l'inefficienza sta sui big, la strategia è il
centro del listino; se sta in fondo, è l'opposto. Va misurata su **Qt.I**, che è l'unico prezzo auction-safe:
l'`fvm` archiviato è di fine stagione e conoscerebbe l'esito. Che la conclusione si trasferisca dalla Qt.I
all'FVM è un'assunzione da dichiarare (correlati ma la Qt.I è dieci volte più grossolana), non un dato.

### 11.4 La domanda cambia: non «quanto», ma QUANDO

Senza rilanci non esiste un tetto. Esiste la **sopravvivenza**: la probabilità che un uomo arrivi al mio
prossimo turno. La decisione è *prenderlo ora* contro *prenderne un altro ora e lui più tardi*, e i pezzi
sono tre:

- **quante scelte mancano al mio prossimo turno.** Grazie alla barriera di giro è un numero esatto e non una
  stima: le squadre che scelgono dopo di me in questo giro, più quelle che mi precedono nel prossimo — e
  l'ordine del prossimo giro dipende dagli acquisti in corso, quindi si ricalcola **a ogni pick** (§9: il
  ricalcolo va incrementale).
- **chi sparirà nel frattempo**, che richiede un'ipotesi sul comportamento degli avversari — l'unica cosa
  che va assunta in questo formato, ed è dichiarabile (prende il miglior FVM disponibile, il miglior surplus,
  copre il ruolo scoperto).
- **il dislivello di reparto fra i sopravvissuti**: se restano cinque difensori equivalenti posso aspettare,
  se resta un solo portiere che stacca no. È lo stesso conto del §4.1 (rimpiazzo personale) applicato al
  pool residuo invece che alla mia rosa.

### 11.5 Il costo che non è FVM: la posizione

Il prezzo di listino non è tutto il prezzo. Prendere un uomo caro mi manda indietro, e stare davanti ha
**valore di opzione**: più scelte precoci vogliono dire accesso ai migliori rimasti. Quindi un uomo
sottoprezzato vale un po' più del suo rapporto surplus/FVM, perché conserva anche la priorità. Se valga la
pena modellarlo esplicitamente **è una domanda misurabile**, e va misurata prima di codificarla — non è
un'intuizione da mettere in una formula.

### 11.6 Un draft è SIMULABILE, e questo ribalta la validazione

Prezzi pubblici e fissi + regola d'ordine deterministica = **il draft si può rigiocare offline dall'inizio
alla fine**, contro politiche avversarie dichiarate, e le rose che ne escono si valutano coi **fantapunti
veri** di quella stagione. Cioè: a differenza dell'asta a rilanci, qui una politica di scelta si può
**pre-registrare e misurare fuori campione**, con lo stesso protocollo del gate. È il secondo motivo per cui
il draft è il primo step giusto.

I limiti vanno dichiarati adesso, non dopo il primo risultato:

- **il prezzo storico non c'è nella forma giusta.** L'ordine ha bisogno dell'FVM **alla data del draft**;
  `fvm_history` accumula solo da oggi, e prima del 2022-23 la sorgente scrive **0 e non NULL**. L'`fvm`
  archiviato è di fine stagione, quindi **conosce l'esito**.
- **la direzione del bias è però conservativa**, e va detto perché rende la simulazione comunque utile: con
  prezzi che conoscono l'esito il mercato è più accurato del vero, quindi il vantaggio «surplus per FVM»
  risulta **sottostimato**. Una politica che vince con prezzi post-esito dovrebbe vincere di più con quelli
  reali. Il confronto fra politiche resta interno e onesto perché tutte pagano gli stessi prezzi.
- **le politiche avversarie sono un'assunzione**: si varia e si riporta il risultato per politica, mai un
  numero unico.

### 11.7 Cosa cambia nella UI, e una regola del §9 si INVERTE

- **«a quanto» sparisce**: il prezzo è l'FVM del listone, non c'è niente da digitare. Un campo in meno.
- **«a chi» diventa obbligatorio.** Nell'asta a rilanci era opzionale (§9); qui la squadra che prende
  determina il valore rosa e quindi **l'ordine dei giri successivi**, cioè il numero da cui dipende ogni
  consiglio. Netto: restano due click, ma sono due click diversi.
- **Lo schermo mostra tre cose**: il mio turno fra N scelte, il consiglio con una riga di motivo, e per i
  primi nomi la **probabilità di arrivare al mio prossimo turno**.
- **L'ordine del giro successivo è sempre visibile e già calcolato**, con il mio posto dentro — è
  l'informazione che il regolamento rende prevedibile e che al tavolo nessuno tiene a mente.
- Il resto del §9 vale identico: tutto reversibile, log di eventi, ricalcolo istantaneo, geometria misurata.

### 11.8 Aperto, e cambia il codice: da chiedere all'operatore

1. **Quale FVM, e congelato quando?** `fvm` o `fvm_mantra` secondo il game — e soprattutto: il valore rosa
   si ricalcola col listone del giorno (l'FVM è uno **stato volatile**, riscritto a ogni download: per questo
   esiste `fvm_history`) o si **congela alla data del draft**? Se non si congela, l'ordine di domani cambia
   per giocatori presi ieri.
2. **Quanti giri e con che vincoli**: 25 giri (uno per slot)? Si può prendere qualunque ruolo a qualunque
   turno purché la rosa chiuda legale, o i reparti hanno un ordine?
3. **Cosa fa l'app quando una scelta rende la rosa non chiudibile** — avvisa o impedisce.
4. La dettatura delle regole si chiudeva con un «3)» troncato: verificare che non manchi una regola.

---

## 12. In Mantra il valore di una rosa non è la somma dei suoi giocatori (5 agosto 2026)

**Osservazione dell'operatore**: «avere 5 PC eccezionali e poterne schierare al massimo due significa aver
perso l'opportunità di prendere calciatori forti in altri ruoli». Non è un vincolo da aggiungere a margine:
**cambia la funzione obiettivo**, e la cambia nel punto in cui tutto il resto del documento si appoggia.

### 12.1 L'obiettivo giusto: l'undici schierabile, per tutta la stagione

Il gioco assegna punti all'**undici che schieri**, non ai 25 che possiedi. Quindi:

> **valore di una rosa = somma sulle giornate del valore atteso del MIGLIOR UNDICI LEGALE schierabile** —
> massimo sui moduli ammessi, massimo sulle assegnazioni dei disponibili alle caselle del modulo.
>
> **valore marginale di un candidato = valore della rosa con lui − valore della rosa senza lui.**

Questa definizione **assorbe tutto** ciò che nel documento era trattato a pezzi, ed è il motivo per cui vale
la pena adottarla invece di sommare correzioni:

- **il caso dei 5 PC** cade da sé: il terzo PC non alza il massimo, perché nessun modulo ha una terza casella
  da centravanti. Non vale zero — vale l'**assicurazione**, cioè quanto copre le due caselle nelle giornate in
  cui i primi due non ci sono, che è esattamente la quantità che la beccabilità già misura;
- **il rimpiazzo personale del §4.1 diventa esatto** invece di approssimato per conteggio: non «ho già tre
  centrocampisti», ma «questa casella è già coperta in quasi tutti gli stati di disponibilità»;
- **la flessibilità acquista un prezzo**: un uomo listato `Dc;Dd` copre due tipi di casella, quindi alza il
  massimo in più stati di un uomo pari-fantamedia listato su un solo ruolo (listature per giocatore ≈1.5 in
  media — già misurato per la profondità di rosa, qui diventa una leva strategica);
- **la scarsità di ruolo diventa un numero e non un'impressione**: una casella scoperta ha un marginale
  enorme, e lo perde appena è coperta;
- **concentrare o spalmare** (§4.4) continua a emergere invece di essere scelto.

### 12.2 Nel draft lo spreco costa DUE volte, e la flessibilità è il vantaggio

Il §11.2 dice che la regola d'ordine **equalizza** il valore rosa in FVM: tutti spendono lo stesso. Allora la
partita è tutta su **quanto undici schierabile ricavi dallo stesso FVM** — e un uomo che non puoi schierare
non è solo surplus buttato: l'FVM che è costato ti ha anche **spostato indietro** nei giri seguenti. Il terzo
PC si paga due volte.

Conseguenza forte per il primo step: **in un draft Mantra la flessibilità di ruolo è LA fonte di vantaggio**,
perché è ciò che converte lo stesso prezzo in più undici legali. La valuta operativa del §11.3 va corretta di
conseguenza — non «surplus per FVM» ma **valore marginale di rosa per FVM** — e gli uomini multi-ruolo salgono
da soli, senza nessun bonus inventato.

### 12.3 Il vincolo è il MODULO, e i tetti per ruolo non bastano a esprimerlo

Qui c'è un buco vero, trovato guardando il repo: **non esiste una tabella dei moduli Mantra legali.** Ciò che
esiste è di natura diversa e non la sostituisce:

- gli schemi che il pannello disegna sono **osservati** dagli undici reali dei club (Arsenal 4-5-1 e 4-3-3
  ventotto volte ciascuno), cioè *cosa fa un allenatore*, non *cosa il gioco mi permette di schierare*;
- `features.simultaneous_caps` misura i tetti per ruolo al p90 (`dc` 3, `pc` 2, …) e quella misura ha superato
  un controllo indipendente **contro le regole del gioco** — il che dice proprio che le regole erano la verità
  di riferimento anche allora.

E un tetto per ruolo **non può esprimere il vincolo**, perché il vincolo è congiunto: «3 `dc` **oppure** una
certa configurazione di `e`, non entrambe» non è scrivibile come limite indipendente per ruolo. Quindi:

> **la lista dei moduli ammessi entra come CONFIGURAZIONE, non come misura.** È un artefatto di
> *regolamento* — dato, pubblico, piccolo — e misurarlo sarebbe stimare una cosa che è scritta.

**Colmato lo stesso giorno: §13**, `config/mantra_modules.json`.

È la stessa distinzione che il progetto fa già altrove: si misura ciò che il calcio fa, si legge ciò che il
gioco impone.

### 12.4 Due vocabolari che non vanno mescolati

Il progetto ha già pagato per confusioni di questo tipo (lega/campionato, platform/gameType), quindi va detto
prima di scrivere codice:

- i **dodici codici misurati** (`GK | DL DC DR | DM | ML MC MR | AM | LW RW | ST`, fonte `sofascore`) dicono
  **dove un uomo gioca davvero**, e servono a *prevedere* e a *disegnare* un undici reale;
- i **ruoli Mantra del listone** (`Por Dd Dc Ds B E M C W T A Pc`) dicono **come il gioco mi permette di
  schierarlo**, e sono l'unica cosa che decide la legalità della mia rosa. Sono anche una delle due
  irriducibili: il gioco assegna punti per ruolo.

Quindi la legalità si decide sui ruoli del listone. I codici misurati restano dove già pagano (la fantamedia
prevista, la quota da titolare, il fianco), e non entrano nel vincolo.

### 12.5 L'algoritmo esiste già, ma nel posto sbagliato

L'assegnazione «uomini → caselle di un modulo» è risolta come **un solo problema di assegnamento**
(`gui._matching`, un Hungarian scritto in casa) perché un passaggio greedy deve fissare una priorità e
**tutti gli ordini sono sbagliati su qualche undici**. Quel pezzo serve identico al draft — e sta dentro
`gui.py`, 5.100 righe di vista Tk.

Il progetto ha già imparato questa lezione una volta, con `engine/presence.py`: **un parametro che nessun
harness può raggiungere è un parametro che nessuno può sweeppare.** Vale uguale qui, e con più forza, perché
il draft ha bisogno di chiamare l'assegnamento **migliaia di volte per scelta** e il simulatore del §11.6 ne
ha bisogno offline. Quindi il primo pezzo di codice del primo step è un **refactor**: l'assegnamento va
nell'engine, dependency-free, con la vista Tk come *uno* dei chiamanti. Ha già la sua garanzia — i 394 board
di regressione, che devono uscire identici prima e dopo.

Attenzione a cosa si trasferisce: **l'algoritmo sì, la griglia no.** `REAL_ROLE_DEPTH`, `SIDE_WEIGHT`,
`_reshape` sono la geometria dei dodici codici, cioè il problema del *disegno*. La legalità Mantra ha bisogno
di una **relazione di compatibilità fra ruolo del listone e casella del modulo**, che viene dal regolamento
(§12.3) e non da una distanza sul campo.

### 12.6 Il costo di calcolo, e l'approssimazione va dichiarata

Il valore esatto somma su stati di disponibilità × moduli × assegnamenti, e il §9 chiede un ricalcolo
istantaneo a ogni evento. I pezzi per una versione praticabile esistono: l'Hungarian (§12.5), i tetti
misurati come pre-filtro, la beccabilità come peso per uomo. La strada probabile è **Monte Carlo su qualche
centinaio di stati di disponibilità**, con caching per candidato.

La disciplina, però, è la solita: **l'approssimazione è una scelta di modello**, quindi si dichiara e si
misura che ordini come la versione esatta — e il simulatore del §11.6 è il posto dove misurarlo, offline,
prima che serva al tavolo.

### 12.7 Cosa aggiunge alla UI

- la **forma** verso cui la mia rosa sta andando (quali moduli restano raggiungibili), non i conteggi per
  ruolo;
- l'avviso sul caso dell'operatore, prima della scelta e non dopo: *«sarebbe il tuo terzo Pc e nessun modulo
  ne schiera tre»*;
- e negli ultimi giri, i **ruoli che devono essere coperti** perché la rosa chiuda legale (§11.2), detti
  prima che sia tardi.

### 12.8 Aperto, da chiedere

1. **Quale lista di moduli ammette la lega** — quella ufficiale Mantra o un sottoinsieme? È l'artefatto del
   §12.3 e senza di esso il vincolo non è scrivibile.
2. **La rosa deve poter schierare un modulo legale in ogni momento**, o basta a fine draft?
3. **Il fantavoto Mantra dipende dalla casella** in cui schiero l'uomo (modificatori di reparto)? Se sì,
   l'obiettivo dell'assegnamento non è la somma delle fantamedie ma la somma **valutata per casella**, e
   `scoring_config` è già parametrico per gestirlo.

*Risposte dell'operatore, 5/08/2026: (1) solo le formazioni ufficiali Mantra; (2) l'undici legale si valuta a
rosa completa; (3) letto dal regolamento — §13. E sul draft: il draft si fa in una giornata, quindi vale
**l'FVM di quel momento** (congelato di fatto); si scegli fino a completare la rosa e la rosa deve restare
**sempre legale**; l'app **impedisce** la scelta che la renderebbe non chiudibile. Le due risposte «sempre
legale» e «a fine draft» rispondono a domande diverse e sono coerenti: l'**invariante** a ogni scelta è che la
rosa resti completabile in modo legale, mentre **schierare** un modulo si valuta a rosa completa.*

---

## 13. Il regolamento Mantra, letto e codificato (5 agosto 2026)

Il buco del §12.3 è colmato: la tabella ufficiale **edizione 2026/2027** è ora in
**`config/mantra_modules.json`**, con la provenienza dentro il file. È il regolamento *pubblico* (pagina
aperta, non il contenuto a pagamento come listone e voti), quindi sta nel repo — che è pubblico — senza
problemi di licenza; il PDF e le immagini di origine no, restano fuori.

### 13.1 Trascrizione verificata, non asserita

Il regolamento dichiara che ogni schema impiega **5 uomini di stampo difensivo** (Dd, Ds, Dc, B, E, M) e **5
di stampo offensivo** (C, T, W, A, Pc). Contato sulle caselle trascritte: **5 e 5 su tutti gli undici
moduli**, con le caselle ibride sempre sul lato offensivo. E i conteggi di linea riproducono **il nome di ogni
modulo**. Due controlli indipendenti, 0 anomalie: la tabella non è stata letta male.

### 13.2 Le caselle sono TIPATE, e molte accettano una scelta

Diciotto tipi di casella: `P · DD · DS · DC · DC/B · E · M · C · W · T · M/C · E/W · C/T · W/T · W/A · T/A ·
A/PC · T/A/PC`. Il vincolo è tutto qui, e la cosa che conta è **cosa manca**: non esiste **nessuna casella
pura `A` e nessuna pura `Pc`** in tutto il gioco. Ogni posto d'attacco è `A/PC` (o `T/A/PC`), per questo un A
e un Pc sono interscambiabili là — mentre una casella `W/A` prende un A e **non** un Pc.

### 13.3 L'osservazione dell'operatore, ora quantificata dal regolamento

Quante caselle può occupare ciascun ruolo, modulo per modulo (calcolato sul file, portiere escluso perché è
fuori dalle quattro linee):

| ruolo | 3-4-3 | 3-4-1-2 | 3-4-2-1 | 3-5-2 | 3-5-1-1 | 4-3-3 | 4-3-1-2 | 4-4-2 | 4-1-4-1 | 4-4-1-1 | 4-2-3-1 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Pc** | 1 | 2 | 1 | 2 | 1 | 1 | 2 | 2 | 1 | 1 | 1 |
| **A** | **3** | 2 | 2 | 2 | 2 | **3** | 2 | 2 | 1 | 2 | 2 |
| **Dc** | 3 | 3 | 3 | 3 | 3 | 2 | 2 | 2 | 2 | 2 | 2 |
| **B** | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Dd / Ds** | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 | 1 | 1 |
| **E** | 2 | 2 | 2 | 2 | 2 | 0 | 0 | 2 | 1 | 2 | 0 |
| **M** | 1 | 1 | 2 | 2 | 2 | 2 | 2 | 1 | 1 | 1 | 2 |
| **C** | 2 | 2 | 1 | 2 | 1 | 2 | 2 | 2 | 1 | 1 | 1 |
| **W** | 2 | 0 | 1 | 1 | 2 | 2 | 0 | 1 | 2 | 2 | 2 |
| **T** | 0 | 1 | 2 | 0 | 1 | 0 | 2 | 0 | 2 | 1 | 2 |

Cinque fatti che da qui escono **senza fittare niente**:

1. **Un `Pc` sta in al massimo DUE caselle, e in SETTE moduli su undici in una sola.** L'osservazione
   dell'operatore era esatta e ora è un numero: il terzo Pc non è «meno utile», è **inschierabile** in
   qualunque schema, e il secondo è già condizionato alla scelta del modulo.
2. **Un `A` arriva a tre** (3-4-3, 4-3-3) e non è mai a zero: 23 caselle totali contro le 15 di un Pc. Quindi
   **a pari fantamedia un `A` vale più di un `Pc`, per regolamento** — non per una preferenza di modello.
3. **La difesa è dove una rosa si IMPEGNA, e l'impegno è quasi binario**: `B` esiste solo nei cinque moduli
   a tre, `Dd`/`Ds` solo nei sei a quattro. Comprare un Dd e un B significa che **uno dei due è morto**, e
   questa è la decisione di forma più pesante di un draft Mantra — conoscibile prima di qualunque previsione.
4. **`Dc` è l'unico difensore con un posto in ogni schema** (3 dietro a tre, 2 dietro a quattro): è la valuta
   difensiva flessibile, gli altri tre ruoli sono specifici di famiglia.
5. **Alcuni ruoli sono a mezzo campionato**: `T` è a zero in quattro moduli, `E` in tre, `W` in due. Solo
   `Dc`, `M`, `C`, `A`, `Pc` hanno sempre almeno un posto.

Ed è la forma generale del §12.1: una rosa vale l'undici che riesce a schierare, e queste sono le regole con
cui quell'undici si compone. La conclusione del §12.2 — **la flessibilità di ruolo è il vantaggio** — smette di
essere un'intuizione e diventa un conto.

### 13.4 Il valore della panchina è governato da una tabella, non dalla mia scelta

La **matrice delle sostituzioni** è nel file, e va letta come non è ovvio: la **riga è il ruolo di chi esce**
(cioè quale casella si apre) e la **colonna è il ruolo di chi entra**. Non è simmetrica, e le due asimmetrie
verificano la lettura: `Pc` fuori / `A` dentro è **OK** sempre (ogni casella da Pc è `A/PC`, che accetta già un
A), mentre `A` fuori / `Pc` dentro è **condizionato**, perché quell'A poteva stare in una `W/A`, che un Pc non
può occupare. Idem per B e Dc: la casella `DC/B` è aperta a un Dc, una `DC` pura prende un B solo a malus.

Tre valori: **OK** senza penalità, **−1** ammesso col malus di fuori ruolo, **NO** vietato. E la sostituzione
segue una **gerarchia ordinata** — *ottimale* (schema invariato), *efficiente* (schema cambiato), *adattata*
(malus pagato). Conseguenza per il §12.1: **la copertura di una rosa non è una scelta libera fra i panchinari,
è ciò che quella gerarchia riesce a raggiungere**, e il valore-assicurazione del terzo Pc va calcolato lì.
Nota che il fatto che lo schema possa **cambiare in sostituzione** conferma la funzione obiettivo del §12.1:
massimizzare sull'insieme degli undici moduli, giornata per giornata, è ciò che il gioco stesso fa.

### 13.5 Il fantavoto dipende dalla casella in un solo modo, e i modificatori classici sono RIFIUTATI

Risposta alla domanda §12.8.3, e viene dal regolamento con la sua ragione: «*l'incompatibilità tra il sistema
Mantra e i modificatori classici è concettuale e non tecnica*» — gli schemi sono già bilanciati, quindi un
modificatore di difesa prezzerebbe un equilibrio che il modulo già impone. Restano opzionali e dichiarati
**R-Factor** e **D-Factor** (quest'ultimo sui 5 difensivi migliori, o 5+1 col portiere).

Quindi l'unico modo in cui il voto dipende dal posto è il **malus di fuori ruolo, −1**. Basta però a cambiare
l'obiettivo dell'assegnamento: **somma valutata per casella**, non somma di fantamedie. E un corollario per il
§10: senza modificatore di difesa **non c'è ragione di accumulare difensori dello stesso club**.

### 13.6 Due insiemi di vincoli per due momenti diversi

Il regolamento vieta certi adattamenti **solo in fase di inserimento formazione** («per scoraggiare un uso poco
consono dello strumento»): un `B`, un `Dd` o un `Ds` non si schierano in una casella `Dc`; un `Dd` non gioca
`Ds` e viceversa; una `E` non prende una `M` pura (la `M/C` resta aperta); una `M` non prende una `E` pura (la
`E/W` resta aperta); una `W` non prende una `T` pura (la `T/A` resta aperta). In **sostituzione** gli stessi
movimenti diventano possibili col malus.

Quindi il codice ha bisogno di **due** relazioni di compatibilità e non una: quella di **formazione**, che
decide se la rosa è legale (e quindi l'invariante del draft), e quella di **sostituzione**, che decide quanto
vale la panchina. Confonderle sovrastimerebbe la legalità e sottostimerebbe la copertura.

### 13.7 Resta aperto, e sono numeri di lega, non di regolamento

1. **Quanti giocatori compone la rosa, e con quali quote?** Il regolamento ufficiale parla di **11 titolari +
   12 di panchina = 23**; `config/league_config.json` oggi dichiara 25 (3P/8D/8C/6A, che è la regola Classic);
   una lega Mantra vista in giro chiede 26 (3 portieri + 23). Sono tre numeri diversi e servono al draft due
   volte: fissano **quanti giri** e fissano il **livello di rimpiazzo**. Serve il regolamento della lega.
2. **Le quote sono per macro-ruolo (P/D/C/A) o libere?** Cambia completamente cosa significa «rosa legale»
   durante il draft, e quindi cosa l'app deve impedire.
3. **Su quale piattaforma e game gira questa lega**: `euro/mantra` o `default/mantra`? È una lega nuova da
   dichiarare in `my_leagues` — misurato, 904 valori di surplus su 916 cambiano fra classic e mantra, e le due
   piattaforme danno fantamedia, presenze e surplus diversi anche sui club in comune.
4. **R-Factor e D-Factor sono attivi?** Se sì, entrano in `scoring_config` e cambiano il valore di un reparto.

*Risposte dell'operatore, 5/08/2026 → §14: rosa di **25** con **2 «porte»** (non portieri: la porta è un CLUB,
tutti i suoi portieri) e **nessun'altra restrizione**; si usa l'**R-Factor**.*

---

## 14. Le regole di QUESTA lega, e le due che cambiano il modello (5 agosto 2026)

### 14.1 La porta non è un giocatore: è un club

La rosa ha **2 porte**, e una porta è **tutti i portieri del club scelto**; ognuna occupa uno slot `Por`. Ogni
modulo ha esattamente **una** casella `P`, quindi ogni giornata se ne schiera una delle due. Da qui, quattro
conseguenze, e la prima cancella il rischio dominante del progetto:

1. **Una porta non salta praticamente mai.** Chiunque il club schieri in porta conta, quindi il rischio di
   presenza — che su un giocatore è il termine dominante (`Var(ln pv)` è il 90% di `Var(ln fantapunti)`) —
   **sparisce**. La beccabilità `(Pv/giornate)^0.5` va a ≈1: la porta è l'unico asset della rosa il cui valore
   è fantamedia quasi pura. Tutto ciò che il progetto ha imparato sul rischio presenze **non si applica qui**.
2. **Cambia l'unità di previsione**: non la fantamedia di un portiere ma quella della **porta di un club**,
   cioè l'aggregato sui portieri che quel club ha schierato. È derivabile da ciò che c'è già — il layer per
   partita porta le righe `role='P'` per club e giornata — ed è **più facile** della versione per giocatore:
   niente logica di riserva, niente arrivi, niente `probable_starter`.
3. **È la terza volta che questo progetto incontra la stessa forma di errore**, e vale scriverlo: un fatto di
   CLUB non deve passare per l'imbuto dell'identità del giocatore (già visto con `player_xref` e con
   `club_match_lineups`). Il modulo portieri esistente (`modulo-portieri-fase2_2.md`) prevede un *portiere*:
   non è sbagliato, è l'**unità sbagliata** per questa lega.
4. **La seconda porta non è un'assicurazione: è un'OPZIONE.** Non c'è nulla da assicurare (la prima non salta),
   quindi il valore della coppia non è il migliore dei due ma il **massimo atteso giornata per giornata** —
   E[max] > max(E) — cioè si schiera la porta col turno migliore. Il che rovescia come si prezzano: conviene
   una coppia di club **complementari** (calendari e profili diversi), non i due migliori in assoluto. È
   quantificabile, e dipende dallo spread e dalla correlazione fra le due.

E una scarsità che va detta subito: **le porte pescano da un pool di CLUB**, non di giocatori. Con 8
partecipanti servono 16 porte: su `default` (Serie A, 20 club) il rimpiazzo è la 17ª porta su 20 — quasi
inelastico; su `euro` (~35 top club) è la 17ª su 35, molto meno stretto. È la risorsa più rigida del draft su
Serie A, e la differenza è tutta di piattaforma.

### 14.2 L'R-Factor prezza la COSTANZA, e prezza il voto BASE

Quotato dal regolamento: l'R-Factor «*premia (o penalizza) la qualità complessiva espressa dalla fantasquadra
in campo misurando il numero di calciatori con **voto di base** almeno sufficiente*». I due fattori si
**escludono a vicenda**, quindi usando l'R-Factor il D-Factor è spento — e con esso ogni ragione di accumulare
difensori dello stesso club (§13.5).

Due conseguenze, e la seconda è il vero cambio di funzione obiettivo:

- **Il voto BASE, non il fantavoto.** Un attaccante da 5,5 + gol porta 7,5 di fantavoto e un voto base
  *insufficiente*: **non alimenta l'R-Factor**. Quindi il fattore sposta valore dai giocatori che vivono di
  bonus a quelli con voto alto — difensori e centrocampisti solidi da 6/6,5, e le porte, che stanno
  strutturalmente intorno alla sufficienza.
- **Per la prima volta in questo progetto la VARIANZA è prezzata, e nella direzione della costanza.** Due
  uomini con la stessa fantamedia non sono più equivalenti: vale più quello con più 6 e meno picchi. La
  quantità che serve è la **quota di partite con voto base ≥ 6**, ed è già calcolabile — l'aggregazione
  «opzione A» tiene le colonne canoniche di `match_ratings` separate dai bonus in `match_rating_bonuses`,
  quindi il voto base è un dato e non una sottrazione da stimare.

**Ciò che manca è il quanto**: la scala numerica dell'R-Factor **non è sulla pagina pubblica del
regolamento**, quindi il segno è certo e la magnitudine no. Fino a quando la scala non è letta dalle
impostazioni della lega, nessun numero va calcolato con l'R-Factor dentro — e quando arriverà, è un **cambio di
funzione obiettivo**, quindi passa dalla porta del §10 di `metrica-asta-surplus-v1.md`: forma dichiarata prima,
misura dopo.

### 14.3 Rosa di 25 senza quote: cosa resta come vincolo

25 = **2 porte + 23 di movimento**, quindi **25 giri** e nessuna quota per macro-ruolo. Il vincolo di legalità
non svanisce, si concentra: dei 23 di movimento **solo 10 scendono in campo**, e l'invariante «rosa sempre
completabile» si riduce a poter coprire le dieci caselle di *almeno uno* degli undici moduli.

**Il pavimento duro, ricavato dalla tabella e non da un'opinione: almeno 2 `Dc`.** Ogni difesa è `DC DC DC/B`
(a tre) o `DD DC DC DS` (a quattro), quindi due caselle `DC` **pure** in tutti gli undici moduli — e il
regolamento vieta di schierare `B`, `Dd` o `Ds` in una casella `Dc` (§13.6). È l'unico ruolo con una
molteplicità inevitabile: tutti gli altri hanno alternative, e per loro la legalità è un problema di
accoppiamento, non di conteggio. Quindi ciò che l'app deve garantire con «impedisce» è esattamente: **2 porte,
2 Dc, e un modulo copribile**.

E un numero che cambia la strategia: **13 dei 23 di movimento non giocano mai da titolari**. Con la porta che
non salta e le sostituzioni regolate da tabella, il valore marginale crolla dopo l'undicesimo-dodicesimo uomo.
Nel draft questo spinge a **concentrare** l'FVM sui titolari e a prendere gratis in fondo — mentre il
tie-break della regola 3 spinge nella direzione opposta (§11.1). Le due forze esistono entrambe e **quale
domina è una domanda per il simulatore** (§11.6), non da decidere adesso.

### 14.4 Resta aperto, e ora sono tre numeri

1. **Quanti partecipanti?** Fissa il monte FVM, il livello di rimpiazzo e la scarsità delle porte (16 su 20
   club è un altro gioco rispetto a 16 su 35).
2. **`euro/mantra` o `default/mantra`?** È una lega nuova da dichiarare in `my_leagues`, e cambia ogni numero.
   Sulle porte cambia perfino la natura del vincolo (vedi §14.1).
3. **Quanto vale una porta in FVM?** Il listone quota **portieri**, non porte, e la regola d'ordine del draft
   somma gli FVM dei presi (§11.1). Quindi serve la definizione della lega: l'FVM del primo portiere, la somma
   dei portieri del club, il massimo? Senza questo **l'ordine dei giri non è calcolabile**, ed è la domanda più
   urgente delle tre.
4. **La scala dell'R-Factor** (§14.2), dalle impostazioni della lega.

*Risposte dell'operatore, 5/08/2026 → §15: la porta vale **come il primo portiere**; **12** partecipanti;
**euro/mantra**.*

---

## 15. I numeri di questa lega, misurati (5 agosto 2026)

**12 partecipanti · euro/mantra · 25 giocatori (2 porte + 23) · draft in una giornata · R-Factor.**
Da cui: **25 giri, 300 scelte, 24 porte, 276 uomini di movimento, 120 titolari.**

### 15.1 Il formato è possibile SOLO su euro, e non è una preferenza

12 squadre × 2 porte = **24 porte**, e la Serie A ha **20 club**. Quindi un formato a due porte con dodici
partecipanti **non può esistere su `default`**: la risposta «euro/mantra» era forzata dall'aritmetica, non
scelta. Sul perimetro euro invece il pool è il numero di club del listone, e va misurato.

### 15.2 Il pool, misurato sul DB — e il listone che serve non c'è ancora

- il listone **2026-27 in DB è solo Serie A**: 494 righe, 20 club, 60 portieri. **Il listone euro 26/27 non è
  ancora stato ingerito**, ed è il presupposto di ogni numero di questo draft;
- l'ultimo listone euro completo (2025-26) porta **1453 giocatori su 46 club** — serie_a 20, premier_league 10,
  bundesliga 6, la_liga 6, ligue_1 5. Non i «~35» che la knowledge base cita a memoria: 46, contati.

Con quella forma: **300 scelte su ~1453 = il 21% del pool**, e **24 porte su 46 = il 52% delle porte
esistenti**. Il rimpiazzo di una porta è quindi ≈ la **25ª miglior porta su 46**: scarsità reale ma non
inelastica — mentre su Serie A lo stesso formato sarebbe impossibile (§15.1).

### 15.3 «La porta vale come il primo portiere»: computabile, e con un difetto già visibile

Operativamente: FVM della porta = **il massimo `fvm_mantra` fra i portieri del club** (il primo portiere è
quello quotato di più; dove due portieri sono quotati uguale c'è un ballottaggio vero, ed è l'unico caso in cui
«massimo» e «titolare» divergono).

Misurato sul listone Serie A 2026-27, funziona su **19 club su 20**. Fallisce sul **Torino**: tutti e tre i
portieri (Mascardi, Paleari, Siviero) a **FVM 1 e Qt.I 1**, mentre Paleari nel 2025-26 stava a 9 — la porta del
Torino non è quotata in questo listone. E la conseguenza non è cosmetica: **l'FVM della porta ora guida
l'ORDINE dei giri** (§11.1), quindi un club non quotato non è una porta «economica», è un **dato mancante che
falsa l'ordine di tutto il draft**. L'app deve dichiararlo, non prezzarlo: una porta senza quotazione va
marcata, come una cella di surplus vuota (§8).

### 15.4 Senza quote per ruolo, lo ZERO del surplus non è più configurazione

Verificato nel codice, non supposto: `features.roster_depth` per il Mantra deriva la profondità per ruolo dai
**totali per macro-ruolo** (`derive_mantra_slots` su `squad_slots` P/D/C/A). Una lega «25 senza altre
restrizioni» non ha quei totali — e un `squad_slots` parziale non solleverebbe un errore: `squad_slots.get(
classic, 0)` restituirebbe **zeri in silenzio**, cioè livelli di rimpiazzo sbagliati senza nessun sintomo.

Per questo la lega **non è ancora stata aggiunta a `my_leagues`**: scriverla adesso significherebbe spedire un
numero muto. La strada, ed è il primo vero compito di modello del primo step: la domanda di ruolo non viene
più da una quota ma **dalla tabella dei moduli** — 12 squadre × 10 caselle, con la distribuzione degli schemi
che le squadre giocheranno. Il pavimento è già noto e duro (2 `Dc` per squadra, §14.3, quindi ≥24 in lega), il
resto è un punto fisso: si assume una forma, si simula il draft, si ri-deriva la forma. Ed è misurabile nel
simulatore del §11.6, che è esattamente il posto giusto.

### 15.5 La porta non è architettura nuova

`features.goalkeeper_club_rates` **già aggrega i portieri per CLUB** (gol subiti per partita, sommando le
presenze di tutti i portieri del club — è l'input di M2e). Quindi l'unità «porta» esiste già nel motore per una
quantità diversa: serve la stessa aggregazione applicata alla **fantamedia** invece che ai gol subiti. È
un'estensione di un pattern presente, non un modulo nuovo — che è anche la ragione per cui il §14.1 chiama la
cosa un errore di *unità* e non di modello.

---

## 16. La superficie dei parametri: questa lega come ISTANZA (5 agosto 2026)

**Decisione dell'operatore**: si costruisce sulle impostazioni della sua lega, ma ogni combinazione deve
restare esprimibile. È la disciplina che il progetto applica già a `scoring_config` («per-league parametric:
no hard-coded +3/-3/+1») estesa al formato d'asta, e la regola operativa è una:

> **una dimensione per regola, letta dalla configurazione. Il regolamento del gioco sta in
> `config/mantra_modules.json`, le scelte della lega in `config/league_config.json`, e il motore non
> ramifica mai su «la mia lega».**

Con il freno contro la generalità prematura: **una dimensione è reale solo se si sa nominare una seconda lega
che ci differisce.** Per tutte quelle sotto la seconda lega esiste già — `EuroLeghe` classic, dichiarata nello
stesso file. Non si costruisce invece un sistema a plugin per formati d'asta arbitrari: «modalità» è un campo
con due valori, non un'architettura.

### 16.1 Le dimensioni, il valore di questa lega, e dove oggi sono ASSUNTE

| dimensione | questa lega | altro legale | stato oggi |
|---|---|---|---|
| `platform` | `euro` | `default` | **parametrico** (parte della PK di mezzo DB) |
| `game` | `mantra` | `classic` | **parametrico** |
| `teams` | 12 | qualunque | **parametrico** |
| **dimensione rosa** | **25** | 23 (ufficiale), 26… | **non esprimibile**: esistono solo le quote |
| **quote per macro-ruolo** | **nessuna** | 3/8/8/6, … | **normalizzata via** — vedi §16.2 |
| **unità del portiere** | **porta = club**, 2 slot, prezzo = primo portiere | portiere-giocatore, N slot | **assunta giocatore** |
| **fattore** | **R-Factor** | D-Factor, nessuno (si escludono) | **assente** da `scoring_config` |
| **modalità d'asta** | **draft** | rilanci | **nessun concetto** nel codice |
| **regole d'ordine** | giro 1 custom · poi FVM rosa crescente · parità → chi ha il singolo più alto sceglie dopo · parità → ordine giro 1 · barriera di giro | qualunque | da esprimere come **lista ordinata di chiavi**, non come codice |
| **valuta dell'ordine** | `fvm_mantra`, congelato alla data del draft | Qt.I, fvm classic | il campo esiste, il congelamento no |
| **legalità** | **impedisce**; invariante di completabilità + undici a rosa completa | avvisa; solo a fine draft | da costruire |
| `reliability_exponent` · `min_availability` | 0.5 · 0.35 | qualunque | **parametrici** — ma vedi sotto |
| scoring per campionato | 5 campionati (euro) | 1 (default) | **parametrico**, e questa lega lo esercita davvero |

Una sfumatura che la tabella non contiene e che il §14.1 impone: la **beccabilità non è una proprietà della
lega ma della CLASSE DI ASSET**. Su una porta vale ≈1 per costruzione, quindi `reliability_exponent` non deve
toccarla: applicarlo anche là sconterebbe un rischio che non esiste. Non è un parametro nuovo, è il perimetro
di uno che c'è.

### 16.2 Il difetto che questa richiesta ha fatto emergere: la configurazione CANCELLA la dimensione

Non è un'assenza, è una normalizzazione, e produce numeri plausibili invece di un errore. Dimostrato
eseguendo il codice:

```
Config._league_setup('X', {'platform':'euro','game':'mantra','teams':12, 'squad_slots': {}})
  -> squad_slots = {'P': 3, 'D': 8, 'C': 8, 'A': 6}
```

`_league_setup` fonde sempre `DEFAULT_SQUAD_SLOTS` e poi impone la presenza di tutti e quattro i ruoli
(`config.py:128,137`), quindi **una lega non può dichiarare «senza quote»**: la nostra rosa da 25 con 2 porte
verrebbe letta come 3 portieri + 8/8/6. E a valle `derive_mantra_slots` deriva la profondità Mantra proprio da
quei totali, così il livello di rimpiazzo — **lo zero del surplus** — sarebbe calcolato per una rosa che questa
lega non ha.

Due gradini di gravità, e il secondo è quello che conta:

1. con `squad_slots` davvero vuoto la profondità diventa **zero su ogni ruolo** (`budget = 0 × listature`), e
   il fallback «divisione equa» non scatta perché il dizionario non è vuoto, è pieno di zeri;
2. con la normalizzazione attuale non si vede nemmeno lo zero: si ottengono **livelli di rimpiazzo
   verosimili e sbagliati**. È il caso peggiore dei due, ed è la ragione per cui la lega **non è ancora in
   `my_leagues`**: dichiararla oggi significherebbe spedire un numero muto (§8: una cella vuota è
   un'affermazione, un numero inventato non lo è).

### 16.3 Generalizzare qui costa MENO che specializzare

Vale la pena dirlo perché è controintuitivo: la forma generale del livello di rimpiazzo è anche **l'unica
corretta per questa lega**. La domanda di ruolo non viene da una quota ma dalla **tabella dei moduli** — 12
squadre × 10 caselle, con la distribuzione degli schemi giocati — e una lega *con* quote è semplicemente lo
stesso conto con un vincolo in più. Quindi non c'è un caso semplice da spedire prima e un caso generale da
rimandare: c'è un conto solo, e la quota è un dettaglio del più generale.

### 16.4 Il primo passo di codice, che ora è definito

Tre modifiche piccole e una sola per file, da fare insieme perché separate lasciano il numero muto:

1. **`config.py`** — `squad_slots` (FATTO: la chiave esiste e `config.py` la legge), quote **opzionali** (assenti = libere), blocco `keeper`
   (`unit: player | club_goal`, `slots`, `price`), `factor`, blocco `auction` (`mode` + le chiavi d'ordine).
   Additivo: le leghe già dichiarate leggono esattamente come oggi.
2. **`features.roster_depth`** — una lega Mantra senza quote **rifiuta** di derivare la profondità invece di
   inventarla: `{}` in uscita, che il percorso «niente lega → niente rimpiazzo» già gestisce dicendolo.
3. **`league_config.json`** — la lega dichiarata con i suoi valori, che dopo (1) sono esprimibili.

Poi, e solo poi, il refactor dell'assegnamento fuori da `gui.py` (§12.5) e il simulatore (§11.6).

---

## 17. Il modulo come direzione, e le tre strisce (5 agosto 2026)

Due richieste dell'operatore: **indirizzare le scelte verso il modulo più adatto a chi si è già preso, senza
escludere gli altri**; e vedere **tre strisce da cinque giocatori** — la scelta di adesso più le quattro
successive suggerite, coi turni contati e le scelte altrui simulate.

### 17.1 Il modulo non si scegli e non si ignora: è una POSTERIORE, e c'è già

La prima richiesta non ha bisogno di uno strato di strategia nuovo, perché **l'obiettivo del §12.1 la contiene
già**: se una rosa vale il *massimo sui moduli* dell'undici schierabile, allora una rosa buona in tre moduli
vale più di una chiusa in uno — non per prudenza, ma perché infortuni e turnover cambiano ogni settimana quale
modulo è schierabile, e la tabella delle sostituzioni permette esplicitamente di **cambiare schema** (§13.4).
Quindi «non escludere completamente gli altri moduli» non è un vincolo da aggiungere: è ciò che l'obiettivo
fa, se lo si calcola bene. Ciò che va costruito è il modo di **mostrarlo**: non un modulo scelto ma un
punteggio per ognuno degli undici, che è la posteriore di dove la rosa sta andando.

Con due avvertenze che vengono dalla cultura del progetto:

- **finché non è informativa va detto che non lo è.** Alle prime scelte ogni modulo è ancora raggiungibile e
  la posteriore è piatta: mostrare un favorito lì sarebbe inventare una direzione. Stessa regola della cella
  vuota (§8).
- **si calcola sui ruoli del LISTONE**, non sui dodici codici misurati (§12.4): qui la domanda è la legalità.

### 17.2 La direzione è quasi un BIT solo, e sta in difesa

Struttura ricavata dalla tabella, e semplifica tutto: gli undici moduli si dividono in **5 a tre dietro** e
**6 a quattro**, e dentro ciascuna famiglia il requisito difensivo è **identico** (`DC DC DC/B` contro
`DD DC DC DS`). Quindi:

> **la difesa non scegli un modulo, scegli una FAMIGLIA — e dentro la famiglia è libera.** Quale dei cinque
> (o dei sei) si giocherà lo decidono centrocampo e attacco.

E il prezzo dell'opzionalità diventa un numero invece di un'impressione: **2 `Dc` + 1 `B` + 1 `Dd` + 1 `Ds` =
5 difensori tengono in vita entrambe le famiglie**; quattro comprano solo la difesa a quattro, tre solo quella
a tre (i 2 `Dc` sono condivisi). Un difensore multi-ruolo abbassa ancora il conto. Davanti invece la libertà è
quasi totale — la casella `A/PC` esiste in tutti gli undici moduli — mentre i ruoli da tenere d'occhio sono
`T` (assente in quattro moduli) e `W` (in due).

Da qui la forma generale della quantità che serve: **il costo dell'opzionalità** = valore della miglior rosa
che tiene vive almeno K famiglie/moduli, meno il valore della miglior rosa senza vincoli. Se è vicino a zero
si resta aperti, se è alto si decide — e non è una preferenza dell'operatore, è misurabile nel simulatore
(§11.6).

### 17.3 Le tre strisce: un beam search, e vanno scelte per DIVERGENZA

La seconda richiesta è, tecnicamente, una **ricerca a fascio di ampiezza 3 e profondità 5** sull'albero del
draft, con le scelte avversarie simulate nel mezzo. I pezzi:

- **il conteggio dei turni è esatto** entro il giro (barriera + ordine noto), e va **ricalcolato a ogni giro**
  perché l'ordine dipende dall'FVM di rosa, che dipende dalle scelte simulate. Deterministico, quindi
  calcolabile: non è una stima.
- **conseguenza dell'ordine che le strisce faranno vedere da sole**: la regola «FVM di rosa crescente» rende il
  draft quasi un serpente, ma **endogeno** — prendere l'uomo caro ti manda in fondo al giro dopo, prendere a
  poco ti tiene davanti. Quindi la distanza fra due mie scelte non è un pattern fisso, è **una variabile di
  decisione**, ed è esattamente il valore di opzione del §11.5 reso visibile.
- **la politica avversaria è l'unica assunzione**, quindi va scritta nella UI accanto alle strisce e non
  nascosta («assumendo che gli altri prendano il miglior FVM disponibile»). Meglio: la sopravvivenza di un
  nome mostrata sotto due o tre politiche, così l'operatore vede quando il piano è robusto e quando dipende
  da come giocano gli altri.

**E la decisione di design che conta: le tre strisce non sono le prime tre della stessa classifica.** Tre
scelte quasi equivalenti darebbero tre strisce quasi identiche — tre attaccanti, nessuna informazione. La
richiesta stessa dice cosa serve: «*che mi faccia comprendere in che direzione andrebbe la rosa*». Quindi le
tre strisce si selezionano per **divergenza di direzione**, e l'asse naturale è quello del §17.2 — per esempio
difesa a tre, difesa a quattro, e la variante che tiene vive entrambe — ognuna col suo numero in testa
(valore di rosa proiettato) e col suo costo di opzionalità. Si confrontano direzioni, non nomi.

### 17.4 Onestà delle strisce, e un regalo che si portano dietro

- **Le scelte 2-5 sono previsioni condizionate, non impegni**, e la loro affidabilità decade lungo la striscia:
  vanno mostrate con la probabilità di sopravvivenza e con un'evidenza grafica calante. La quinta non può avere
  l'aria della prima.
- **Il costo di calcolo va diviso in due**, e la divisione è una scelta di modello da dichiarare: il *lookahead*
  gira sui valori attesi (assegnamento Hungarian, che è piccolo e veloce), il Monte Carlo sugli stati di
  disponibilità (§12.6) si spende solo sulla **scelta immediata**, dove decide davvero. Con caching per
  candidato, e da misurare che non riordini le strisce.
- **Il regalo**: una striscia è una previsione registrata. Il log eventi (§9) permette di confrontare, in
  diretta, i nomi che l'app diceva sopravvissuti con quelli che sono davvero arrivati al turno — **calibrazione
  misurata durante l'asta**, con la stessa logica con cui il §14.2 chiede la scala dell'R-Factor prima di
  usarla. È gratis e nessun'altra parte del sistema può misurarsi così.

---

## 18. Calibrare gli avversari, e la scarsità che cambia ogni stagione (5 agosto 2026)

### 18.1 La politica avversaria non si assume: si impara, e metà è già deterministica

Il §17.3 dichiarava la politica avversaria come l'unica assunzione. La richiesta dell'operatore la trasforma:
**si parte da un prior dichiarato e si aggiorna con le scelte osservate**. Con 12 squadre e 25 giri sono **300
scelte**, quindi entro il quinto giro ne sono state viste ~55: campione reale, non aneddoto.

La forma naturale è un **modello di scelta discreta**: ogni pick è una scelta da un insieme disponibile *noto*,
quindi `P(prende x | disponibili)` cresce con le caratteristiche di x — rango di FVM, ruolo che gli manca,
scarsità, club. E la cosa che rende questo problema più facile del solito:

> **metà della previsione non è statistica, è deterministica.** Le rose avversarie sono osservabili e le regole
> sono le stesse per tutti, quindi i loro vincoli si calcolano esattamente con la macchina del §12: il loro
> pavimento di 2 `Dc`, le loro 2 porte, quali famiglie di moduli hanno ancora aperte. Sappiamo di loro ciò che
> sanno loro.

Tre discipline, tutte già pagate altrove in questo progetto:

- **confrontare col null giusto.** Una politica appresa vale solo se batte «prende il miglior FVM
  disponibile», misurato in diretta. Una calibrazione confrontata con zero non è una calibrazione.
- **misurarla sulla quantità per cui la si usa.** Non l'accuratezza su tutte e 300 le scelte, ma la
  **sopravvivenza dei nomi della mia lista**: è il numero che entra nelle strisce, ed è molto più facile da
  azzeccare.
- **per-avversario solo con evidenza.** Al quinto giro ci sono ~4 scelte per squadra: si tiene una politica
  comune più una deviazione per squadra che si accende quando i dati la reggono, e finché non la reggono lo si
  dice.

E la separazione onesta fra due affermazioni diverse: il simulatore (§11.6) valida **l'apprenditore** contro
avversari sintetici; non può validarlo contro esseri umani. Quello lo dirà solo il draft, in diretta.

### 18.2 La numerosità dei ruoli cambia davvero, e di quanto — misurato

L'intuizione dell'operatore («in certe stagioni ci sono poche M, in altre pochi Dc, in altre poche E») è
verificata sul listone euro. Listature per ruolo Mantra (un `dc;dd` conta in due — 1.523 listature per
giocatore nel 2025-26), contro la domanda dei titolari di 12 squadre, che la tabella dei moduli fissa come
intervallo fra il modulo che ne usa meno e quello che ne usa più:

| ruolo | domanda 12 sq. | 2022-23 | 2023-24 | 2024-25 | 2025-26 |
|---|---|---|---|---|---|
| por | 12 | 169 | 169 | 179 | 164 |
| dd | 0-12 | 157 | 153 | 170 | 146 |
| **dc** | **24-36** | 295 | 299 | 271 | 272 |
| ds | 0-12 | 163 | 157 | 159 | 150 |
| **b** | 0-12 | **0** | **0** | **43** | **28** |
| **e** | 0-24 | 253 | 241 | 249 | **224** |
| **m** | 12-24 | 185 | 185 | 192 | **171** |
| c | 12-24 | 290 | 328 | 325 | 294 |
| w | 0-24 | 144 | 172 | 167 | 173 |
| t | 0-24 | 174 | 185 | 161 | 172 |
| a | 12-36 | 198 | 183 | 193 | 187 |
| pc | 12-24 | 141 | 159 | 140 | 144 |

Quattro letture:

1. **La variazione è reale e vale circa il 10%**: `m` −11% e `e` −11% nel 2025-26, `dc` −9% nel 2024-25. Una
   scarsità presa dall'anno prima sbaglia di quell'ordine, quindi **va ricalcolata sul listone corrente** — che
   è un'altra ragione per cui il listone euro 26/27 va ingerito prima di ogni numero (§15.2).
2. **`b` non esisteva prima del 2024-25**: zero listature su due stagioni, poi 43, poi 28. È un cambio di
   **vocabolario del listone**, non un cambio di calcio — da confermare alla fonte, e da sapere prima di
   confrontare braccetti fra stagioni: chi lo facesse concluderebbe una cosa falsa. Conseguenza pratica:
   qualunque affermazione sui braccetti ha **due stagioni** di storia, non dieci.
3. **La scarsità è concentrata in due punti soli, e sono i due che il formato crea o il listone nega**: la
   domanda massima consuma il 13-17% del pool per quasi ogni ruolo, ma **il 43% dei `b`** (12 su 28) e **il 52%
   delle porte** (24 club su 46, §15.2). Tutto il resto è abbondante.
4. **E il `b` scarso non è vincolante**, perché la casella è `DC/B` e un `Dc` la copre: la scarsità morde solo
   se si vuole *quel* profilo. Al contrario delle porte, dove non esiste alternativa.

Due precisazioni perché i numeri non vengano usati male: la **domanda è fissa** (la fissano le regole e il
numero di squadre) mentre la **supply varia**, quindi l'indice di scarsità è interamente guidato dal listone; e
questi sono conteggi **grezzi**, che includono i fuori-rosa — la versione che conta userà il filtro di
utilizzabilità già in uso per le àncore (`Pv ≥ 20`), e sarà più stretta di così.

---

## 19. Il draft è A CAMPIONATO INIZIATO, e questo è il vantaggio (5 agosto 2026)

**Informazione dell'operatore**: quando si farà il draft ci saranno già **3-4 giornate giocate**, e gli
avversari scegleranno su *FVM*, *conoscenza personale* e *calciatori che hanno overperformato all'inizio*.
Non è un dettaglio di calendario: cambia il bersaglio, il vantaggio e — soprattutto — crea **una cosa che va
fatta adesso o è perduta**.

### 19.1 Una misura che credevo non recuperabile: il ΔFVM

⚠️ **Superato lo stesso giorno dal §20.1: lo storico FVM è PUBBLICO** (dal dettaglio calciatore, §20.4), quindi
non è una cattura da rincorrere ma una fonte da ingerire — e diventa perfino backtestabile su una stagione. Il
resto di questa sezione resta valido come descrizione di *cosa* misura il ΔFVM e di com'era lo stato di
`fvm_history` il 5/08/2026; l'urgenza no.

L'FVM «varia ogni settimana o quando ci sono eventi particolari», ed è per questo che esiste
`fvm_history(fc_id, season, observed_on, …)`, che **accumula da oggi** e non ha passato. Se il draft avviene
dopo 3-4 giornate, allora:

> **la differenza fra l'FVM di pre-campionato e quello del giorno del draft È la misura di quanto il mercato
> ha ri-prezzato le prime giornate** — cioè la misura diretta del bias che l'operatore si aspetta dagli
> avversari.

Osservabile solo se la si cattura. Stato al 5/08/2026, verificato: `fvm_history` ha **988 righe su due date**
(04 e 05 agosto), **494 giocatori ciascuna — il solo listone Serie A**; il listone euro non è mai entrato nella
storia. Quindi l'azione con una scadenza, e non è codice: **catturare il listone euro con regolarità da ora
fino al draft**. Ogni settimana non catturata è un pezzo di quella misura che non esiste più. (Da controllare
anche perché gli ultimi quattro run di `snapshot` risultano in `error`: una cattura che non gira è una cattura
che non c'è.)

### 19.2 L'asimmetria che rende il bias sfruttabile, e non è un'opinione

Le prime 3-4 giornate sono **sotto il dominio su cui il core è fittato** (`MIN_PV_PREV` = 15 voti): il motore
là non prevede, per costruzione. Ma il progetto ha già misurato *cosa* contengono quelle partite, e la risposta
è asimmetrica:

- **sul voto: quasi nulla.** L'eccesso di autocorrelazione del fantavoto contro il null rimescolato è **+0.012**
  (`gate-motore-v1.md` §5-duodecies punto 4): l'«ha la mano calda» non si trasferisce. Quattro gol in quattro
  giornate sono in larghissima parte rumore.
- **sulle presenze: molto.** `Var(ln pv)` è il **90%** di `Var(ln fantapunti)`, e chi ha giocato 4 partite su 4
  essendo una riserva l'anno prima è un'informazione che il listone di pre-campionato **non aveva**: un ruolo
  cambiato, un trasferimento atterrato, una gerarchia risolta.

Da cui la regola operativa, e è l'esatto opposto di come si comporta un avversario che «segue chi ha
overperformato»: **leggere le prime giornate per i MINUTI, scontarle per il VOTO.** È l'arbitraggio di questo
draft, e non è una scommessa sul comportamento altrui: è una misura contro un rumore.

### 19.3 E il formato tassa il bias da solo

Il pezzo elegante: dopo 3-4 giornate l'FVM di chi ha iniziato forte **è già salito**. Quindi un avversario che
lo prende alza il proprio valore rosa più del dovuto e **scivola indietro nell'ordine dei giri** (§11.1). Il
formato **punisce automaticamente** l'inseguimento della forma, e chi non inseguisse incassa la posizione senza
fare niente di astuto. Corollario per la ricerca del valore: non sta nei nomi caldi — sta in quelli il cui
**FVM non si è mosso** mentre la loro titolarità sì. Ed è esattamente ciò che il ΔFVM del §19.1 rende visibile,
incrociato coi minuti delle prime giornate.

### 19.4 Cosa deve essere pronto prima, e cosa NON va costruito

Serve, come pipeline: i **voti della stagione corrente** fino alla giornata del draft (modulo `ratings`, API
Excel autenticata — è il caso per cui è stato scritto), `recent_form` aggiornato, e l'**età dell'evidenza per
fonte** già introdotta in v9.23, perché un draft in corsa vive di dati freschi e va detto quanto sono freschi.

Non va costruita, invece, una **regola di forma iniziale** adottata perché «è ovvio che conta»: sarebbe una
regola previsionale nuova, quindi passa dal gate, e il prior dalle misure di cui sopra è **presenze sì, voto
no**. Va pre-registrata in quella forma — separando i due bersagli — e non riformulata dopo aver visto il dato.

### 19.5 Due conseguenze minori da non sbagliare

- **L'orizzonte si accorcia**: il calendario euro è di 31 giornate, quindi un draft dopo la 3ª-4ª lascia ~27-28
  giornate. Il fattore è quasi uniforme, quindi tocca poco l'*ordinamento*, ma ogni numero **assoluto** (valore
  di rosa, valore di una porta, proiezione di una striscia) va calcolato sul calendario **residuo** — e
  l'orizzonte diventa un parametro, dove oggi è implicitamente la stagione intera.
- **La «conoscenza personale» è il residuo irriducibile**: è ciò che la deviazione per-avversario del §18.1
  assorbe se i dati la reggono, e nient'altro. Non si inventano feature per rappresentarla; si dice che quella
  parte non è predetta.

---

## 20. Lo storico FVM è pubblico, e il vantaggio ha un numero (5 agosto 2026)

### 20.1 Correzione al §19.1: è una fonte da ingerire, non una scadenza — e la buona notizia è limitata

L'operatore segnala che **lo storico degli FVM è pubblico su fantacalcio.it**, e la fonte lo conferma: dal
2025-26 il sito ha introdotto la **storicizzazione del dato stagionale** — «*nella scheda del calciatore un
grafico e, se si vuole, una tabella con tutte le variazioni dell'FVM*», con la nota che l'FVM, a differenza
delle quotazioni, «*può variare in qualsiasi momento e non su scala di giornate*». Quindi il ΔFVM non va
rincorso in tempo reale: si ingerisce. E in più diventa **backtestabile**, non solo osservabile: si può
misurare *prima* del draft quanto il mercato ha ri-prezzato le prime giornate di una stagione passata.

Due limiti che vanno detti subito, perché la notizia è buona ma non illimitata:

- **la storicizzazione parte dal 2025-26**, quindi c'è **una** stagione di storia. Per gli standard di questo
  progetto una finestra è l'evidenza più debole possibile (§gate: T1/T2 sono nominate proprio perché sono le
  finestre su cui le ipotesi sono nate). Una misura di overreaction su una stagione è un indizio, non un
  verdetto — e va dichiarata come tale.
- **la superficie esatta va indicata dall'operatore.** Il pattern della scheda è
  `fantacalcio.it/euroleghe/squadre/{club}/{giocatore}/{fc_id}/{stagione}` (l'id nell'URL sembra proprio il
  nostro `fc_id`, quindi le pagine sono costruibili dal DB), e quella pagina porta le medie e la **tabella per
  giornata con titolare/subentrato** — ma il grafico delle variazioni FVM non è raggiungibile con un fetch
  semplice: o è reso lato client, o vive su un'altra superficie. Chiedere il puntatore costa un minuto e vale
  più di qualunque tentativo a indovinare.

`fvm_history(fc_id, season, observed_on, fvm, fvm_mantra)` è già la forma giusta per accoglierlo, il che è una
conferma indiretta: la tabella è nata perché si era notato che l'FVM era uno stato volatile tenuto come campo
statico, e la fonte dice la stessa cosa con le sue parole.

### 20.2 «Tutte le partite giocate, non solo quelle di EuroLeghe»: 1.64× di campione

L'operatore indica il vantaggio strutturale del progetto: le statistiche sono costruite su **tutte** le partite
di un giocatore, non sul solo calendario EuroLeghe. Misurato sul 2025-26, sui 907 giocatori che hanno entrambe
le misure:

| | presenze medie |
|---|---|
| calendario **euro** | **18.36** |
| **tutte** le competizioni (minuti > 0) | **24.50** |
| rapporto | **1.64 medio · 1.30 mediano** |

Il layer per partita copre i 5 campionati **più** Champions, Europa League, coppe nazionali, Serie B,
Championship. E il punto non è la media annuale: è **dove** il vantaggio si applica.

> Al draft gli avversari ragioneranno su 3-4 presenze EuroLeghe. Noi ne avremo **il 30-60% in più**, e proprio
> nel momento in cui il campione è così piccolo che il rumore domina: 4 partite contro 6 è un campione del 50%
> più grande esattamente dove serve.

E le partite in più non sono partite qualsiasi: sono in buona parte **gli infrasettimanali europei**, che sono
la misura più diretta della **politica di rotazione** — di chi l'allenatore si fida, chi gioca la coppa, chi
viene risparmiato. Cioè il segnale presenze (§19.2), su una superficie che chi guarda le statistiche EuroLeghe
non vede affatto.

Il vantaggio poi non è solo di *quantità* ma di *tipo*: propensione e xG per 90 da FBref, rating e **heatmap**
da Sofascore, i **dodici codici di ruolo misurati** (che battono il codice del listone nel nominare un fianco,
97.9% contro 93.9%) e `club_match_lineups`, completa su **tutte** le formazioni perché non passa dall'imbuto
dell'identità. Per un draft Mantra quest'ultimo blocco pesa il doppio: dice *dove un uomo gioca davvero*, che è
la domanda da cui dipende se terrà il posto.

### 20.3 La disciplina che accompagna il vantaggio: i FATTI viaggiano, i VOTI no

Il vantaggio va usato per ciò per cui è calibrato. `synth` fitta la sua retta sull'**overlap** e l'eleggibilità
è **della competizione** (`synth.calibrated_competitions`, derivata dall'overlap stesso): il progetto ha già
pagato per aver applicato quella retta a 4784 righe di Serie B, Championship e Coppa Italia che non aveva mai
visto. Quindi:

> **minuti, gol, assist, xG e posizione viaggiano da qualunque competizione; il VOTO solo dove la calibrazione
> esiste.** «Tutte le partite» non significa «tutte le partite producono una fantamedia».

Ed è una convergenza che vale registrare: il §19.2 conclude «leggere le prime giornate per i minuti, scontarle
per il voto» partendo da una misura sull'autocorrelazione; il §20.3 arriva alla stessa regola partendo dalla
calibrazione delle fonti. **Due strade indipendenti, una conclusione** — che è il tipo di accordo che rende una
regola meno probabilmente un artefatto.

### 20.4 Lo storico FVM si prende dal DETTAGLIO CALCIATORE

Confermato dall'operatore. Bersaglio d'ingestione fissato: la scheda del giocatore,
`fantacalcio.it/euroleghe/squadre/{club}/{giocatore}/{fc_id}/{stagione}` — una pagina per calciatore
(~1453 su euro), costruibile dal DB perché l'id nell'URL è il nostro `fc_id`. Il grafico delle variazioni non
compare in un fetch semplice, quindi è reso lato client: l'implementazione dovrà leggere la sorgente che lo
alimenta, non l'HTML. Stessa disciplina del resto del progetto: la pagina scaricata va in **cache come sorgente
di verità**, così `rebuild` la ri-ingerisce offline, e la destinazione è `fvm_history`, che esiste già con la
forma giusta.

---

## 21. Le partite facili: misurato, e l'aritmetica del calendario la uccide (dove non serve) — 5 agosto 2026

**Idea dell'operatore**: valutare quali partite facili ha un giocatore dall'asta a fine campionato — «un
giocatore forte che giocherà solo contro squadre forti non rende come un giocatore medio che giocherà solo
contro squadre scarse».

### 21.1 Prima: NON è la famiglia già bocciata tre volte, e la distinzione conta

Il gate ha respinto tre volte la **forza del club DI APPARTENENZA**: forza-club interna, Elo additivo per il
movimento (T1 +1.1%, T2 −1.0%), e **R5** àncora forza-club da ClubElo — «*il segno è giusto su entrambe le
finestre — l'intuizione Kane è corretta — ma il MAE di T1 peggiora ogni volta*». Quella è una proprietà
stagionale di *dove gioca*. L'idea dell'operatore è un'altra quantità: **chi affronterà**, aggregato su una
finestra specifica. Trattarla come già risolta sarebbe sbagliato.

### 21.2 Ma muore per aritmetica, prima di qualunque gate: 6.7 contro 147.0

Misurato sul calendario Serie A 2025-26 (coppie giornata-club-avversario dal layer per partita, forza =
ClubElo). Spread **fra club** dell'Elo medio degli avversari, per orizzonte — *numeri rimisurati dopo il difetto
di join del §21.7, su 20 club e 38 partite ciascuno*:

| orizzonte | sd | min | max | range |
|---|---|---|---|---|
| prossime **3** giornate | **63.6** | 1573 | 1801 | **228** |
| prossime **5** | **39.6** | 1626 | 1765 | 139 |
| prossime **10** | 28.0 | 1653 | 1758 | 105 |
| **residuo 34** (dalla 5ª alla fine) | **6.7** | 1683 | 1714 | **31** |
| stagione intera | 6.0 | 1686 | 1707 | 21 |
| *(riferimento)* Elo **dei club stessi** | **147.0** | | | |

> Sul **residuo di 34 giornate** la differenza di calendario fra club vale **6.7 punti Elo di sd contro i 147.0
> della forza dei club: un fattore 22.** Il girone all'italiana ri-bilancia quasi perfettamente — tutti giocano
> con tutti — quindi «che partite gli restano da qui alla fine» è **praticamente lo stesso per tutti**.

E si vede anche il confondente che aveva sporcato i test precedenti: fra i calendari residui più **facili** ci
sono Inter (1688) e Bologna (1692), fra i più **duri** Cremonese (1714) e Verona (1706) — perché nessuno gioca
contro se stesso, quindi essere forte *alleggerisce* il proprio calendario. Forza propria e difficoltà del
calendario sono **anti-correlate per costruzione**: un termine additivo sulla prima porta dentro un pezzo della
seconda, ed è una ragione in più per non impilarle.

### 21.3 Dove invece vive, e questa lega ne ha bisogno per forza

Lo spread decade come la media di n estrazioni, quindi **il segnale è tutto sull'orizzonte breve** — 63.6 su
tre giornate, con un range di **228 punti Elo** fra il calendario più duro e il più morbido, che è come la
distanza fra una squadra di metà classifica e una da titolo. E dentro **una singola giornata** lo spread
dell'Elo avversario è **113.2**, cioè il **77%** della dispersione della forza dei club.

Quindi la difficoltà del calendario è una quantità **settimanale**, non stagionale. E la lega dell'operatore ne
crea un uso settimanale obbligato:

> **la scelta di quale delle due PORTE schierare ogni giornata** (§14.1) è governata quasi interamente dalla
> difficoltà del turno — spread 113.2 dentro la giornata, più il **vantaggio campo misurato in 29 punti Elo**
> (§23.1), che il layer per partita sa applicare perché porta il flag `home`. È lì che il valore d'opzione della
> coppia di porte si realizza, ed è anche l'unico posto dove la forza-squadra è **già passata dal gate**: il
> modulo portieri **M2e prezza la difesa del club** (`GsRate_pred = mu + 0.40·(tasso gol subiti del club − mu)`).
> ⚠️ **Precisazione del 07/08/2026**: la quantità che il motore usa lì sono i **gol subiti misurati**, non
> l'Elo. Il mix 50/50 persistenza+Elo di `clubelo-gate.md` ha vinto il gate Colab e **non è mai stato
> portato** in `engine/model.py`. Resta vero che per i portieri la forza-squadra è l'unica versione della
> famiglia mai adottata; falso che sia adottata *nella forma Elo*.

Il che chiude il cerchio in modo pulito: **per ordinare il draft la difficoltà del calendario non serve** (6.7
su 147.0), **per scegliere la porta ogni settimana è il meccanismo principale**, e per i portieri la forza
avversaria è l'unica versione della famiglia che il gate abbia mai adottato.

> ⚠️ **Precisazione del 07/08/2026, e cambia il verbo.** Quell'adozione è avvenuta **in Colab**, non in questo
> motore: `predict_fm_goalkeeper` calcola il tasso gol subiti dalla sola persistenza dei
> `season_stats.goals_conceded` misurati, e la metà Elo del mix M2e **non è mai stata portata** — è viaggiato
> il nome (registrato in [gate-motore-v1.md](gate-motore-v1.md) §3-quinquies (a) il 27/07/2026, e rimasto
> scritto al contrario in mezzo repository fino all'audit dei lettori di `club_elo`). Quindi la frase corretta
> è: la forza-squadra per i portieri è l'unica versione della famiglia **che abbia mai passato un gate**, e
> resta **da portare**. Non cambia il ragionamento sulla scelta settimanale della porta — cambia da cosa
> partirebbe l'implementazione, che è una proposta per il gate su dieci finestre e non un travaso.

### 21.4 Cosa manca per farlo, e due cautele sulla misura

- **Nel DB non esiste il calendario FUTURO.** `external_match_stats` contiene le partite *giocate*, quindi le
  coppie fixture si ricavano solo a posteriori; e `club_elo` ha **921 righe su 99 club con un solo scatto per
  anno** (15 agosto, dal 2016 al 2025). Per usare la difficoltà del turno servono due ingestioni nuove: il
  **calendario** della stagione e un **Elo più fresco** dello scatto annuale (l'API ClubElo è gratuita e
  giornaliera — il `clubelo-gate` chiedeva già di aggiungere il dominio ai consentiti).
- **Cautele su questo numero**: è misurato su **Serie A 2025-26** con un unico scatto Elo di pre-stagione, e
  misura la **geometria del calendario** — non è una previsione, ed è esattamente ciò che la domanda richiede.
  Su euro il calendario è un sottoinsieme (31 giornate su 38) e mescola cinque campionati, quindi il
  ri-bilanciamento potrebbe essere **meno** perfetto: vale rifarlo sul calendario euro prima di dare il 6.7 per
  buono là. ✅ **Controllo eseguito lo stesso giorno, §21.5: il ri-bilanciamento è effettivamente meno perfetto e
  lo spread raddoppia** (6.0 → 11.8 sulla stagione intera). Il rapporto con la forza dei club resta però di un
  ordine di grandezza, quindi la conclusione per il draft non si muove.

### 21.5 Rifatto sul calendario EURO: il controllo del §21.4 era necessario, e RADDOPPIA il numero

**Osservazione dell'operatore**: la difficoltà futura conta molto più per la **riparazione di febbraio** e per
le **competizioni di poche giornate**, e in particolare su euro, «*dove alcune giornate vengono saltate e magari
vengono saltate partite molto facili o molto difficili che cambiano nettamente l'appeal di un calciatore*».

Misurato con `matchday_map` (2025-26 Serie A: il calendario euro mappa **31 giornate reali su 38**, quindi ne
salta **sette**), spread fra club dell'Elo medio degli avversari **sulle sole giornate euro**:

*(numeri corretti il 5/08/2026 dopo il difetto di join del §21.7 — copertura 20/20, 38 gare reali e 31 euro per
club. Le conclusioni aggregate non si muovono, i nomi per club sì.)*

| finestra | giornate euro residue | sd | range |
|---|---|---|---|
| calendario **reale** intero *(rif. §21.2)* | 38 reali | **6.0** | 21 |
| **stagione euro intera** | 31 | **11.8** | 47 |
| **dal draft** (≈ 4ª-5ª euro) | ~26 | **12.5** | 51 |
| metà stagione | 21 → 16 | 12.9 → 13.5 | 59 → 53 |
| **riparazione di febbraio** | 11 | **19.6** | **89** |
| **coda / mini-competizione** | 6 | **33.8** | **111** |
| una singola giornata *(rif. §21.3)* | 1 | 113.2 | — |
| *(riferimento)* forza **dei club** | | **147.0** | |

**L'operatore ha ragione su entrambi i punti, e ognuno ha la sua misura:**

1. **Le giornate saltate NON si cancellano fra loro**: restringersi al calendario euro porta lo spread da
   **6.0 a 11.8**, cioè lo **raddoppia**. Il girone all'italiana ri-bilancia solo se lo si guarda intero; il
   sottoinsieme euro no.
2. **Sulle finestre corte diventa di primo ordine**: 19.6 con 11 giornate (febbraio), **33.8 con 6** — e a quel
   punto il range di **111 punti Elo** è dello stesso ordine dello spread dentro una singola giornata (113.2) e
   si avvicina alla dispersione della forza dei club (147.0). Su una competizione di poche giornate il
   calendario **è** il fattore.

E l'effetto ha nomi. Differenza fra l'Elo medio degli avversari *visibili su euro* e quello del calendario
reale, per club (sd **10.5**, range **36** punti):

| il calendario euro mostra le partite più DIFFICILI | | il calendario euro mostra le più FACILI | |
|---|---|---|---|
| Lazio | **+22.0** | Verona | **−14.4** |
| Cagliari | +17.1 | Lecce | −13.5 |
| Como | +16.0 | Inter | −12.7 |
| Juventus | +12.9 | Parma | −12.1 |

Cioè esattamente il meccanismo descritto: un giocatore del Verona è **più appetibile su euro** di quanto il suo
calendario reale suggerisca, perché il calendario euro gli salta le partite difficili; uno della Lazio il
contrario. Ed è una distorsione **invisibile** a chi guarda la stagione reale, e altrettanto invisibile a chi
guarda solo le medie euro senza sapere quali giornate sono state saltate. ⚠️ Questa è anche la tabella che il
difetto del §21.7 aveva sbagliato di più: **Fiorentina e Atalanta erano artefatti** e sono uscite dalla lista,
Verona e Parma sono entrate. Le medie aggregate tolleravano il buco, i singoli club no.

**Conseguenza per il primo step, che resta invariata**: al draft l'orizzonte è ~26 giornate euro, quindi 12.5
contro 147.0 — un dodicesimo, ancora secondario per *ordinare* i giocatori. Ciò che cambia è dove il lavoro va
speso appena il draft è chiuso: **la scelta settimanale della porta** (§21.3) e, se un giorno si gioca una
riparazione o una competizione breve, **là il calendario va prezzato**.

### 21.6 Il buco che questa misura ha scoperto: fuori dalla Serie A l'avversario non ha un Elo

Copertura dell'Elo **degli avversari**, 2025-26, contata sulle squadre effettivamente affrontate:

| campionato | avversari distinti | con Elo | *(prima del fix §21.7)* |
|---|---|---|---|
| serie_a | 20 | **20** | 16 |
| premier_league | 20 | **15** | 10 |
| la_liga | 20 | **10** | 5 |
| bundesliga | 24 | **10** | 1 |
| ligue_1 | 18 | **9** | 2 |

**Metà del buco era mio e metà è reale.** Il pezzo reale è strutturale: `clubs` contiene il **perimetro** (i top
club del gioco) e `club_elo` mappa quelli, ma gli avversari di un club del perimetro sono in buona parte
**fuori** dal perimetro — quindi fuori dalla Serie A la difficoltà del calendario resta calcolabile solo per
metà delle partite, che è precisamente dove l'operatore dice che conta di più. ClubElo copre tutte quelle
squadre (Elo europeo completo, API gratuita), quindi è **ingestione + mappatura**, non un limite della fonte, e
va accanto alle due acquisizioni del §21.4 (calendario futuro, Elo giornaliero).

### 21.7 Il difetto: un fatto di CLUB non si unisce per NOME

Domanda dell'operatore: «immagino che l'Elo mancante sia solo delle squadre più scarse, o sbaglio?». **Sbagliava
la misura, non l'intuizione — e nel modo peggiore.** I quattro avversari di Serie A senza Elo erano **AC Milan,
AS Roma, SSC Napoli e Hellas Verona**: tre dei più forti del campionato più uno debole. E non era Elo mancante:
il provider scrive `AC Milan`, `clubs.canonical_name` dice `Milan`, e il join era **per nome grezzo**.

Il progetto ha già lo strumento — `matching.CLUB_ALIASES` + `matching.club_key()`, usati in tutto
`positions.py` — e la misura lo aveva scavalcato. Con il fix: **20/20 avversari, 38 gare reali e 31 euro per
club**, cioè il calendario completo.

Perché va scritto e non solo corretto:

- **la direzione del bias era la peggiore possibile.** Non rumore: sparivano dalla media di *ogni* club le
  partite contro le tre squadre più forti, e sparivano in modo **disuguale** — a seconda di se i confronti con
  Milan, Roma e Napoli cadessero dentro o fuori il calendario euro, che è esattamente la quantità misurata.
- **le medie aggregate hanno tenuto, i singoli club no** (Fiorentina e Atalanta erano artefatti). È una lezione
  su cosa fidarsi in una misura parziale: un rapporto fra ordini di grandezza sopravvive, una graduatoria di
  nomi no.
- **è la terza volta che questo progetto incontra la stessa forma**: `player_xref` scritto dentro il ciclo per
  stagione, i fatti di club fatti passare per l'imbuto dell'identità, e ora un join per nome. La regola
  generale, da applicare senza pensarci: **un'entità si unisce attraverso la sua chiave canonica** —
  `club_key`/`CLUB_ALIASES` per i club, `fc_id`/`player_xref` per le persone — **mai attraverso la stringa che
  una fonte usa per chiamarla.**

---

## 22. «% di partite facili» nello snapshot: la definizione decide se informa (5 agosto 2026)

**Richiesta dell'operatore**: nello snapshot, per ogni squadra indicare una percentuale di partite facili sul
totale. Implementabile — ma la misura dice *quale* percentuale, e dice che oggi non si può ancora riempire.

### 22.1 La definizione RELATIVA è l'Elo travestito da percentuale

Due candidate, misurate su Serie A 2025-26 (facile = avversario sotto l'Elo mediano del campionato, contro
facile = almeno 50 punti Elo sotto **il mio** club):

| definizione | correlazione con l'Elo del club STESSO | sd fra club | range |
|---|---|---|---|
| **relativa** (differenza col mio Elo) | **+0.987** | 29.6 pp | 100 pp |
| **assoluta** (sotto la mediana di lega) | +0.405 | 4.3 pp | 16 pp |
| **Δ euro − reale** (assoluta) | **−0.145** | 4.1 pp | 15 pp |

La relativa dà Inter **100%** e Cremonese **0%**: non è una colonna sul calendario, è **l'Elo ristampato in
percentuale** (0.987). E sarebbe la peggiore da mettere in un foglio d'asta, perché infilerebbe di nascosto
esattamente il predittore che il gate ha respinto **tre volte** (forza-club interna, Elo additivo movimento, R5).

L'assoluta è onesta ma quasi costante sul calendario reale (sd **2.6 pp**, range 5.3): è il girone all'italiana,
tutti incontrano più o meno gli stessi deboli. Sul calendario **euro** la dispersione raddoppia (4.3 pp), com'era
prevedibile dal §21.5.

> **Sulla STAGIONE INTERA la colonna che porta informazione è il Δ fra il calendario euro e quello reale**:
> correlazione **−0.145** con la forza del club, cioè praticamente **indipendente** da ciò che il foglio già
> dice, e range di 15 punti percentuali. È l'unica delle tre che aggiunge un fatto: *quanto il calendario euro
> rende questo club più facile o più difficile di quanto la sua stagione reale suggerisca.*

⚠️ **E questo vale solo sulla stagione intera.** Su una finestra corta la conclusione si rovescia e la `% facili`
liscia diventa *più* pulita del Δ: vedi §22.4, che è la forma decisa.

Verona **+7.5**, Inter e Atalanta +5.4, Udinese e Parma +4.2 · contro Lazio **−7.5**, Como e Cagliari −5.4,
Napoli/Roma/Juventus −4.2. E concorda col §21.5 misurato in punti Elo, che è un controllo interno superato.

### 22.2 Ma NON si può mostrare prima di conoscere il calendario della stagione: persistenza +0.058

La domanda che decide se la colonna può essere riempita oggi: il Δ è un **attributo del club** o del
**sorteggio di quell'anno**? Correlazione del Δ per club fra 2024-25 e 2025-26, 17 club presenti in entrambe:

> **+0.058.** Indistinguibile da zero. Como passa da **+7.5 a −5.4**, Inter da **−4.2 a +5.4**.

Quindi il Δ è una proprietà del **calendario di quella stagione**, non della squadra: calcolarlo sull'anno
scorso e mostrarlo per il draft di quest'anno sarebbe esibire un numero **senza contenuto predittivo**. Stessa
forma del verdetto sulla persistenza per-giocatore (`metrica-asta-surplus-v1.md` §10): domanda di trasferimento,
risposta zero, famiglia chiusa sul lato previsionale.

**Conseguenza operativa**: la colonna **nasce vuota, con la ragione dichiarata**, e si riempie quando il
**calendario della stagione** è ingerito (§21.4). Non si riempie con l'anno prima.

### 22.3 Come va fatta, quando si farà

- **Due numeri affiancati**: `% facili (euro)` e `Δ vs reale`, con la soglia scritta. Una percentuale senza la
  sua soglia non è un fatto, quindi soglia, data dell'Elo e finestra vanno nel `manifest.json` e nel tooltip.
- **Numeratore e denominatore sullo stesso calendario.** È la lezione di `league_XIs`: contare i facili su euro e
  il totale sul reale è lo stesso errore che portò la correlazione titolarità-club da +0.796 a −0.172.
- **La cella dichiara la sua copertura.** Fuori dalla Serie A solo ~metà degli avversari ha un Elo (§21.6), e una
  percentuale su metà delle partite è un'altra quantità: o porta il conteggio delle partite classificate, o resta
  vuota.
- **È un fatto di CLUB su una riga di GIOCATORE**, come la colonna Pair: si unisce attraverso `club_key`, mai per
  nome (§21.7).
- **Finestra = dalla data dello snapshot alla fine**, non la stagione intera: è quella la domanda dell'asta, ed è
  anche dove il numero è più grande (§21.5).

### 22.4 Decisione: si mostra **«% facili» e basta** — ed è la finestra corta che la rende pulita

**Decisione dell'operatura, 5/08/2026**: si mostra la `% facili` e nient'altro; la ragione è che «*se faccio
un'asta di riparazione (non euro) a 8 giornate dalla fine il valore può essere rilevante*».

Misurato esattamente su quello scenario — Serie A, `platform='default'`, **ultime 8 giornate reali**:

| finestra | sd fra club | range | **corr. con l'Elo del club stesso** |
|---|---|---|---|
| **ultime 8** (24-25) | **16.3 pp** | **12% – 75%** | **−0.017** |
| **ultime 8** (25-26) | **12.5 pp** | **25% – 75%** | **−0.063** |
| ultime 12 | 9.1 / 9.9 pp | 25% – 75% | −0.026 / +0.130 |
| stagione intera | 2.6 pp | 47% – 53% | **+0.881** |

Tre cose, e tutte e tre danno ragione alla semplificazione:

1. **Su 8 giornate la dispersione è 5-6 volte quella della stagione intera** (16.3 e 12.5 contro 2.6 pp), da
   **1 partita facile su 8** (Roma 12%) a **6 su 8** (Como, Napoli, Torino: 75%). Un fattore sei fra club: a otto
   giornate dalla fine la `% facili` è un fatto di primo ordine, non una rifinitura.
2. **E la mia obiezione del §22.1 cade proprio là.** La correlazione con la forza del club è **+0.881 sulla
   stagione intera** — dove la colonna sarebbe quasi solo un altro modo di dire l'Elo — e **−0.017 / −0.063 sulle
   ultime otto**: sulla finestra corta la `% facili` liscia è **più ortogonale** di quanto fosse il Δ (−0.145) e
   non serve più nessuna seconda colonna. La semplificazione non è un compromesso: sulla finestra che conta è la
   forma migliore.
3. **Il blocco del §22.2 non si applica a una riparazione.** Là il calendario residuo non è un sorteggio da
   prevedere, è **pubblicato**: a metà stagione le partite che restano si sanno, e otto giornate sono ~80
   incontri, un'ingestione minima. Resta invece vero per il draft di agosto, dove l'orizzonte lungo rende la
   colonna quasi costante *e* il calendario non è ancora noto — cioè le due ragioni cadono insieme.

Da cui una lettura che vale la pena tenere: **il contenuto informativo della colonna e la sua calcolabilità si
muovono insieme.** Finestra lunga → quasi costante e calendario ignoto; finestra corta → molto variabile e
calendario già pubblicato. `% facili` è quindi propriamente una **colonna da asta di riparazione**, e nel foglio
di agosto starà vuota per costruzione (§8: e lo dirà).

**Una nota di forma, dalla misura stessa**: su 8 partite la percentuale si muove a scatti di 12.5 punti e assume
solo i valori `k/8`. Mostrare **«6/8 (75%)»** è più onesto di «75%», perché dice anche su quante partite il
numero è calcolato — che è la stessa informazione che il §22.3 chiede alla cella di dichiarare.

---

## 23. «Facile» = sono molto più forte, col bonus casa — misurato (5 agosto 2026)

**Definizione dell'operatore**: facile significa che *il mio* Elo è molto superiore a quello dell'avversario, e
giocando in casa il mio Elo prende un bonus. Formato deciso: **`6/8 (75%)`**.

### 23.1 Il vantaggio campo misurato: 29 punti Elo, non i 60-100 di convenzione

Misurato su **2657 partite di Serie A ricostruite offline** (7 stagioni, risultato derivato da `match_ratings`
`platform='default'`: gol netti + rigori segnati, incrociato col flag casa/trasferta del layer per partita).
Quota di punteggio della squadra di casa **0.5359** → vantaggio campo **25 punti Elo**; gol medi 1.42 contro 1.23.

| stagione | 19-20 | 20-21 | 21-22 | 22-23 | 23-24 | 24-25 | 25-26 |
|---|---|---|---|---|---|---|---|
| Elo casa | 22 | 22 | 12 | 33 | 44 | 27 | 15 |

Ultime tre stagioni insieme (1140 partite): **29 punti**. Due letture da tenere:

- **è molto meno del 60-100 che la letteratura sul calcio cita di solito**, quindi la convenzione era la scelta
  sbagliata e valeva misurarlo;
- **non va fittato per stagione**: 380 partite danno un errore standard di circa **±18 punti Elo** sulla quota,
  quindi l'oscillazione 12→44 è rumore, non un vantaggio campo che cambia. Si spedisce il valore aggregato (29
  sulle ultime tre, 25 su sette) come **costante misurata con la sua data**, non una serie.

Conseguenza aritmetica da non ignorare: 29 punti contro una dispersione di forza fra club di **147** sono 0.2
deviazioni standard, quindi il bonus casa **ribalta solo le partite già vicine alla soglia**. È giusto includerlo
— è la definizione dell'operatore ed è misurato — ma non aspettarsi che muova molte celle.

### 23.2 La colonna come sarà, e la soglia

`facile ⇔ (mio Elo + 29 se in casa) − Elo avversario > soglia`. Sulle ultime 8 giornate di Serie A:

| soglia | punteggio atteso | sd fra club | range | corr. con l'Elo proprio | club **saturi** (0/8 o 8/8) |
|---|---|---|---|---|---|
| **0** («sono favorito») | 0.50 | 31.7 | 0-100% | +0.79 / +0.91 | **4/20** |
| +50 | 0.57 | 34.0 | 0-100% | +0.91 / +0.92 | 6/20 |
| **+100** («molto più forte») | 0.64 | 30.7 | 0-100% | +0.91 / +0.93 | 7-9/20 |
| +150 | 0.70 | 28.3 | 0-88% | +0.84 / +0.93 | 11-12/20 |
| +200 | 0.76 | 21.6 | 0-75% | +0.79 / +0.87 | 12/20 |

Con soglia +100, 2025-26: Inter **8/8** · Napoli 6/8 · Milan 5/8 · Lazio/Torino/Juventus 4/8 … Verona, Cagliari,
Lecce, Cremonese, Pisa, Sassuolo **0/8**.

### 23.3 Due cose da sapere su questa colonna, e nessuna la squalifica

1. **Correla +0.92 con la forza del club stesso**, quindi va letta per quello che è: *«quanto è favorevole il
   finale di stagione di questo club»*, **non** «chi ha avuto fortuna col calendario» (quella è la deviazione, cioè
   il Δ del §22.1). Per una decisione d'acquisto è l'input giusto — un giocatore del Verona ha partite difficili
   davanti, e il motivo per cui le ha non cambia il suo rendimento atteso. ⚠️ Ma proprio perché ricalca la forza
   del club, **resta una colonna da MOSTRARE e non un ingrediente di previsione**: la famiglia forza-club è stata
   respinta dal gate tre volte (§21.1), e farla rientrare per la porta di servizio di una percentuale sarebbe lo
   stesso errore con un altro nome. Come la colonna Pair: porta l'evidenza al decisore senza riordinare nulla.
2. **Satura.** A +100 fra 7 e 9 club su 20 stanno a 0/8 o 8/8, e per loro la colonna non porta **nessuna**
   informazione di calendario: il Cagliari legge 0/8 sia con un finale morbido sia con uno brutale. La soglia che
   satura meno è **0** («sono favorito»): 4 club su 20, e non richiede di scegliere quanto valga «molto». Se si
   preferisce restare aderenti a «molto superiore», **+100** è il punto naturale (punteggio atteso 0.64) al prezzo
   di un terzo del campionato appiattito.

### 23.4 Forma congelata (scelta dell'operatore, 5 agosto 2026)

> **STATO: progetto, non codice** (audit del 05/08/2026). `EASY_MARGIN` e `HOME_ADVANTAGE` non compaiono nei
> sorgenti: nessun foglio calcola oggi la quota di partite facili. La costante `HOME_ADVANTAGE = 29` è
> misurata e resta valida come specifica; va citata come «da costruire», mai come comportamento.

**Soglia = +100.** Costanti dichiarate, zero fit:

```
facile(partita)  ⇔  (elo_club + HOME_ADVANTAGE·[gioca in casa]) − elo_avversario > EASY_MARGIN

EASY_MARGIN     = 100     punteggio atteso 0.64 — scelta dell'operatore, 05/08/2026
HOME_ADVANTAGE  = 29      MISURATO: 1140 partite di Serie A 23-24…25-26, quota casa 0.5412
                          (25 su 2657 partite e sette stagioni; errore standard per stagione ±18,
                           quindi è una costante e NON una serie annuale)
finestra        = dalla data dello snapshot alla fine del calendario della piattaforma
formato         = "k/n (p%)"   — il conteggio prima della percentuale, perché su 8 partite
                                 la percentuale si muove a scatti di 12.5 punti
```

**Quanto conta il bonus casa a questa soglia, misurato invece di supposto**: su **320** coppie (club, partita)
delle ultime 8 giornate di due stagioni, il bonus di 29 punti **cambia 11 classificazioni** — **3.4%** del totale
e **6.9%** delle gare in casa, cioè la banda decisiva è la differenza Elo fra 71 e 100 (Fiorentina-Genoa +93,
Atalanta-Bologna +91, Torino-Verona +80, Parma-Pisa +72…). Piccolo e reale, com'era l'aritmetica del §23.1: in una
finestra di 8 partite riclassifica circa un club su quattro, per una partita.

**Il manifest deve portare tutti e cinque** — soglia, bonus casa con la sua data di misura, data dello scatto Elo,
finestra, e conteggio delle partite classificate — perché una percentuale senza di essi non è un fatto (§22.3). E
la colonna resta **display-only**: mai un ingrediente di previsione senza gate (§23.3 punto 1).

**Stato**: definizione congelata, **non ancora calcolabile** — aspetta l'ingestione del calendario (§21.4) e, fuori
dalla Serie A, l'Elo degli avversari non-perimetro (§21.6). Fino ad allora la cella è vuota e lo dice.

---

## 24. Il tavolo in diretta è collegato, e la registrazione manuale sparisce (9 agosto 2026)

**Cosa esiste da oggi**: l'app legge una sessione **fanta-asta-live** in diretta. Il codice della sessione si
digita, ci si collega, si sceglie quale squadra è la propria, e da lì il pannello segue l'asta da solo.
Tutto in `app/src/app/core/auction-feed.ts` (il feed) e `app/src/app/views/auction/` (la vista).

**Come**: fanta-asta-live tiene ogni sessione su un Realtime Database Firebase. Ci si autentica in anonimo —
è quello che fa il sito stesso al caricamento — e si resta agganciati allo stream SSE di
`sessions/<codice>/state`, applicando gli eventi `put`/`patch` a uno specchio locale. Nessuna dipendenza
nuova: `fetch` e `EventSource` bastano. **Si legge e basta**: l'assistente non registra un peer, quindi non
compare fra i partecipanti e non può alterare l'asta che guarda.

### 24.1 Una regola del §9 e del §11.7 decade: non ci sono più due click

Il §9 chiedeva che registrare un movimento altrui costasse due click, e il §11.7 rendeva **obbligatorio**
il «a chi» perché la squadra che prende determina l'ordine dei giri. Col feed in diretta **non si registra
niente**: chi ha preso chi, a quanto, e l'ordine ricalcolato arrivano dal banditore nell'istante in cui li
scrive. Il requisito non è stato soddisfatto, è stato **eliminato** — ed era il punto più a rischio di far
abbandonare l'app a metà asta.

Resta valido tutto il resto del §9: ricalcolo istantaneo (i derivati sono `computed` su signal), e la
reversibilità che ora è del banditore, non nostra — un pick rilasciato arriva con `released` e il feed lo
scarta.

### 24.2 Due fatti misurati sul campo, non supposti

1. **`teams[].currentBudget` è in ritardo, i `picks` no.** Osservato in diretta il 9/08/2026: due giocatori
   già assegnati per 370 e 280, e il campo `currentBudget` di tutte e dieci le squadre ancora a 1000.
   L'host lo ricalcola e lo ripubblica dopo. Il feed quindi **deriva la spesa dai pick** e non legge quel
   campo. È fissato in un test di regressione con lo stato reale.
2. **La regola d'ordine del §11.1 è confermata contro i dati.** Con `pickOrderType: "default"` l'ordine è
   ricalcolato dopo ogni pick: prima chi ha meno pick (`maxAheadPicks: 1` = giro secco), a parità chi ha il
   **valore rosa più basso**. Verificato: `pickOrder [2,3,4,5,6,7,8,9,1,0]` con le otto squadre a zero
   davanti, poi chi aveva speso 280, poi chi aveva speso 370. E poiché `cost == FVM`, il valore rosa
   **coincide con la spesa**: l'ordine di scelta è l'esatto inverso della classifica di spesa. È il §11.5
   («il costo che non è FVM: la posizione») con un numero sotto.

### 24.3 Cosa il pannello NON dice, e lo dichiara

Dei tre numeri del §11.7 ce ne sono **due**: *tocca a te fra N scelte* e *l'ordine del giro con il mio posto
dentro*. Manca il terzo — **il consiglio con la riga di motivo** — perché il SURPLUS vive nel motore Python
e non è ancora portato (§6, punto 6). Il pannello lo **dichiara con un avviso** invece di mostrare una
raccomandazione senza numeri dietro: un consiglio inventato al tavolo è peggio di nessun consiglio.
Manca per la stessa ragione la **probabilità di arrivare al proprio turno**.

Quello che il pannello mostra oggi è la **meccanica** del draft: turno, ordine, budget residuo, tetto sul
prossimo nome (budget meno un credito per ogni slot ancora da riempire), slot mancanti per reparto, rosa,
ultimi movimenti e il listone ancora libero per reparto.

### 24.4 Stato di verifica, onesto

- **Verificato** (9/08/2026): `ng build` verde; 10 test sul feed passano; autenticazione anonima e lettura
  del listone provate **contro il server reale**, entrambe 200; il rendering della card di collegamento
  controllato a schermo; il percorso d'errore visto funzionare (sessione inesistente → messaggio corretto).
- **NON verificato**: selezione squadra e pannello **con dati veri**. La sessione osservata è stata
  cancellata dall'host a fine asta mentre il lavoro era in corso (`sessions/FA-y6k-vg9` → `null`), e non ne
  è stata aperta un'altra. Lo stato reale catturato prima della cancellazione è fissato nelle fixture di
  `auction-feed.spec.ts`, ma **una fixture non è il tavolo**: al primo draft vero questo va guardato.

### 24.5 Tre decisioni che restano dell'operatore

1. **L'app ora parla con la rete.** `app/README.md` dice che cosa l'app può scaricare è una decisione, non
   un dettaglio da infilare: questa è una deroga a «legge il bundle e mai il web», confinata a un file solo
   e commentata sul posto. Lo stato di una sessione in diretta non è una cosa che un export offline possa
   portare, ma la deroga va accettata esplicitamente o rifiutata.
2. **La web API key di fanta-asta-live è nel repo, che è pubblico.** È pubblica per costruzione — sta nel
   bundle di ogni client del sito — quindi non è un segreto esposto; è però ora anche su GitHub.
3. **Resta aperta la §11.8 punto 1**: l'FVM si congela alla data del draft o si rilegge dal listone del
   giorno? Oggi il feed usa quello che la sessione si porta dietro. Se non si congela, l'ordine di domani
   cambia per giocatori presi ieri.

---

## 25. Il pannello del tavolo, completo: porte, surplus vivo, orizzonte e la scelta consigliata (10 agosto 2026)

Il §24 aveva collegato il feed e dichiarato che mancava il terzo numero — **il consiglio**. Adesso c'è, e
con lui tutto il resto che serviva per usare il pannello a un tavolo vero. Il codice sta in
`app/src/app/core/` (`auction-feed.ts` il feed, `auction-value.ts` l'aritmetica pura, `auction-advice.ts`
la giunzione col motore, `auction-plan.ts` il lookahead) e `app/src/app/views/auction/`.

### 25.1 Il motore arriva nel bundle, e la giunzione è per `fc_id`

`export` scrive un **foglio per lega dichiarata** (`engine_sheets` nel manifest) con `engine_fm_pred`,
`engine_pv_pred`, `engine_role_slot`, `engine_replacement_fm`, `engine_surplus`,
`engine_unpriced_reason`, gli `est_*` e le colonne misurate. L'app li unisce al listone della sessione
**sull'id**, che è `fc_id` — verificato 5 su 5 contro `players` — e mai su un nome.

Il foglio si scegli per **sovrapposizione di id**, non per piattaforma: quando l'host carica una lista
propria `playerListType` dice `custom` e le righe possono non portare nessun campionato, quindi la
piattaforma non è leggibile (osservato in diretta: il pannello prezzava nessuno). Il gioco invece filtra
davvero — 904 valori su 916 si muovono fra classic e mantra. La **copertura è riportata**, non supposta:
«N giocatori su M non sono nel foglio», e per loro la riga lo dice invece di valere zero.

### 25.2 Il rimpiazzo è VIVO, e per questo l'export manda fm e pv e non il surplus

Il surplus del foglio è al rimpiazzo **di lega**; al tavolo il pool si svuota e può essere una lista
personalizzata. Quindi il pannello ricalcola: per slot, la fantamedia dell'**ultimo libero per cui il
tavolo ha ancora posto** (`liveReplacements`). Si muove nella direzione giusta da sé — se chi è stato
preso stava tutto sopra la linea lo zero non cambia, se qualcuno scava sotto la panchina migliora e ogni
surplus si accorcia. Uno zero che non può muoversi risponde a una domanda che nessuno al tavolo sta
facendo.

La **domanda per slot** viene dai moduli del gioco (`mantra_modules.json` → `slotShares`), non dalle quote
per macro-ruolo: quelle rispondevano «la lega comprerà tutti i 124 terzini sinistri» e raddoppiavano il
surplus del miglior `ds` del listone (misurato 10/08/2026, caso Grimaldo: 28,0 → 15,5). È una **scelta di
modello dichiarata**, non una misura: ogni posto vale un'unità di domanda divisa fra i ruoli ammessi, e
gli undici moduli pesano uguale perché nessuno ha misurato quali un tavolo giochi. Il punto fisso del
§15.4 resta la risposta giusta; questo è il segnaposto che ne sostituisce uno peggiore.

### 25.3 I tre numeri sulla riga, e cosa ciascuno risponde

- **Valore, 0-99.** Fantamedia × presenze attese, lordo: nessuna sottrazione. Su scala relativa al
  listone, **99 = il migliore della sessione, presi compresi**, così la scala non si muove durante l'asta
  (un 60 detto alla prima scelta è un 60 all'ultima). Lineare e non percentile: il doppio dei fantapunti
  legge il doppio. Richiesto dall'operatore il 10/08 per leggibilità, e giustificato dal
  [metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md) §15: in un draft è la moneta che ha vinto.
- **+/10g** = il surplus in **punti ogni dieci giornate** dell'orizzonte. Un totale di stagione non è una
  quantità che qualcuno sente; «+3 ogni 10 giornate» sì. È una costante per tutti, quindi non riordina
  nessuno, ed è lo **stesso numero in qualunque competizione** — che è ciò che rende confrontabili due
  aste diverse. Le sue assenze attese sono già dentro, perché il surplus sta sulle presenze e non sul
  calendario.
- **Netto/10g** = gli stessi punti dopo aver pagato il prezzo al cambio corrente. In un draft λ non si
  stima: si ordina i liberi per surplus per credito, si cammina finché la domanda residua è esaurita, e
  l'ultimo che ci sta fissa il tasso (§11.2). Nessun tasso ⇒ nessun netto, e la riga mostra il surplus.

L'ordine di default resta il **netto/surplus**; ogni intestazione è cliccabile e il tooltip di riga porta
i secondari (fantamedia e presenze, il rimpiazzo che ha fatto da zero, «alza il TUO undici di N», il
qualità/prezzo, e la base della stima con `~` quando non è misurata). **Trenta** nomi per reparto, su
richiesta dell'operatore: otto finivano appena partivano i primi giri.

### 25.4 La regola delle PORTE, che la piattaforma non sa esprimere

Questa lega gioca **2 porte**, non 3 portieri: si prende la porta di un club prendendone un portiere
qualsiasi. fanta-asta-live non lo esprime, quindi il pannello lo modella sopra: un interruttore
**Portieri / Porte**, e con le porte attive l'unità diventata il club — una riga per porta, prezzo = l'FVM
del portiere più caro, cioè quello su cui si fa l'offerta. **La porta è del PRIMO che ha preso un portiere
qualsiasi di quel club**; un secondo o terzo portiere dello stesso club non dà niente e il pannello lo
segnala come tale invece di contarlo (`strayKeeperPicks`, con i nomi, così l'avviso è azionabile).

### 25.5 L'orizzonte è un'impostazione, perché n/N non è un'assunzione

Prima e ultima giornata si dichiarano (`from`/`to`, ricordate fra le sessioni). Un draft giocato alla
terza giornata è un orizzonte diverso e ogni numero ASSOLUTO deve starci sopra (§19.5). Il fattore è
`n/N`, uguale per tutti: **muove le cifre e non può riordinare una sola riga** — proprietà che vale la
pena affermare perché è ciò che rende l'impostazione innocua.

### 25.6 La scelta consigliata: quattro giri, tre direzioni, e il «e se prendessi lui?»

La carta simula il proprio pick, poi **tutti gli altri fino alla fine del giro**, poi il giro successivo
fino al proprio turno, per **quattro giri interi**. L'ordine non è supposto: è la regola della piattaforma
riprodotta dalla sua sorgente (meno pick, poi valore rosa più basso, poi il pick più caro in ordine
lessicografico, poi l'ordine del primo giro). La politica dei rivali **è dichiarata** (§17.3 lo richiede):
prende il più caro fra i ruoli che la sua rosa non ha ancora coperto, e **in coda al giro** — ultimo o
penultimo — passa a punti-per-credito, perché lì conviene tenere la scelta alta del giro dopo. Con un
pavimento sul prezzo (`TAIL_PRICE_FLOOR`), altrimenti il rivale in coda prende il riempi-rosa da 1 credito.

Tre **direzioni divergenti** invece delle prime tre di una lista: il massimo netto, un altro reparto, e il
più caro che *tiene la posizione* — misurata sull'ORDINE e non sul prezzo (`positionAfterSpending`), che
è la correzione di un difetto reale: col prezzo mediano del pool la carta offriva un uomo da 11 crediti
al posto dell'ultima scelta vera del giro. Ogni radice porta la **media della catena** in punti ogni dieci
giornate, che è ciò che rende confrontabili tre opzioni — la radice sola direbbe «vince il più caro»,
che è esattamente ciò con cui la lista di opzioni discute.

Due viste della stessa simulazione: **estesa** (per giro, chi sceglie attorno a te) e **compatta** (una
riga per squadra nell'ordine di scelta corrente, con la catena `Pc Kane 123 > C Valverde 345 > …`, la
media delle scelte e la **posizione di scelta del giro successivo**). E cliccando qualunque nome in una
delle due viste si ottiene «e se prendessi lui?»: la scelta manuale diventa una quarta opzione **accanto**
alle tre dichiarate, non al posto loro, e le due viste seguono.

### 25.7 Lo stato sopravvive a un refresh, e un salvato non legge mai come live

Il codice di sessione e la squadra seguita restano nel browser, così un refresh a metà asta non costa un
setup. Ma serviva di più: lo **stato** dell'asta è messo in cache e **ridipinto subito**, in sola lettura,
mentre il riaggancio va in corso sotto. Tre cose imparate facendolo, tutte da difetti veri:

1. **La cache si dimentica solo se la sessione NON esiste.** Un `forget()` su qualunque collegamento
   fallito cancellava l'unica copia dell'operatore appena cadeva la rete: `failure` distingue `missing` da
   `network`, e solo il primo dimentica. Trovato bloccando il RTDB nel browser.
2. **Un salvataggio a throttle va scritto sul fronte di DISCESA.** Col solo fronte di salita restava in
   memoria `state: {}`, perché una sessione ferma non manda altri eventi.
3. **Il pannello non si apre sul socket, si apre sulla TABELLA.** Con i dati in memoria mostrava ancora la
   card del codice: la condizione è «ho una tabella», non «sono collegato». E il marcatore dice quale dei
   due è (`salvato · riaggancio in corso` / `riaggancio non riuscito`, con l'ora).

### 25.8 Cosa resta dichiarato come mancante

- La **probabilità di arrivare al proprio turno** (§11.7, terzo numero) non c'è ancora.
- La lega `default`/mantra non è dichiarata, quindi un draft mantra su listone Serie A ha **250 giocatori
  su 503 senza numero**: [todolist-draft-v1.md](todolist-draft-v1.md) item 0.2.
- Il consiglio ordina per netto/surplus e sceglie di fatto «il meglio» (pavimento ∞) — misurato come la
  variante peggiore delle tre in [metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md) §15.2. La moneta
  ibrida e la copertura come vincolo sono gli item 1.1 e 1.2 della todolist: **misurare prima di cambiare
  il pannello**.
- Resta aperta la §11.8 punto 1 (l'FVM si congela alla data del draft o si rilegge?).

## 26. La moneta dipende dal FORMATO, e ora il pannello ne raziona una sola (10 agosto 2026, sera)

Chiude gli item **1.1, 1.2, 1.3, 2.6** di [todolist-draft-v1.md](todolist-draft-v1.md). I numeri stanno in
[metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md) §16 e si citano da lì, non da qui: questo file porta
la FORMA della conclusione e cosa fa il pannello, quello porta la misura con la sua data.

### 26.1 Tre formati, tre monete — e non è un difetto del surplus da correggere

Non esiste «la moneta giusta»: esiste la risorsa scarsa del formato, e la moneta è quella che la sottrae.

| formato | risorsa scarsa | moneta | perché |
|---|---|---|---|
| asta a CREDITI | il budget | **SURPLUS** (e `SpM`/`dVM` per leggerlo in crediti) | paghi per l'uomo, quindi conta quanto rende **sopra chi giocherebbe al suo posto**: tutto il resto di questo documento parla di questa |
| DRAFT mantra | le SCELTE | **VALORE** = fm × presenze | il regolamento vincola 3 portieri + 22 di movimento e **nessuna quota per slot**, quindi il surplus sconta una scarsità che il gioco non impone (§15.3) |
| la PORTA (§14.1) | ne schieri uno | **SURPLUS**, e l'unità è il club | lo zero del `por` è 4,36 di fantamedia contro 7,29 di un `pc`: qui la scarsità è reale |

Due precisazioni che la misura ha aggiunto e che cambiano la riga della porta:

1. **In un draft il valore vince anche in porta.** L'ibrida «valore sul movimento, surplus in porta» è stata
   pre-registrata e **respinta**: −4,88%, 0/5 finestre. Non perché l'idea sia falsa, ma perché le due
   grandezze non stanno sulla stessa scala e in un solo argmax l'effetto non è «prezzare la porta», è
   **rimandare i portieri** — la copertura dell'undici scende di 8 punti perché il posto del portiere resta
   scoperto. La forma onesta sulla scala (il valore decide SE, il surplus decide QUALE portiere) non è
   peggiore ma non guadagna niente (−0,23%, sotto il pavimento), quindi non è adottata. La riga della porta
   nella tabella resta vera **per un'asta a crediti**, non per la scelta di un draft.
2. **Il netto non è una moneta di draft, e non è una taratura da correggere.** λ è il tasso di cambio fra un
   credito e un fantapunto; in un draft non spendi crediti, spendi scelte (§11.2), quindi `surplus − λ×prezzo`
   premia l'essere quasi gratis: **−52,3% sui rivali, 0/5, 34 crediti in 25 giri, metà undici scoperto.**
   Era la chiave con cui questo pannello consigliava.

### 26.2 Cosa fa il pannello adesso

Tre cambi, e ognuno porta la sua misura nel codice dove sta:

- **`ranked` ordina per VALORE** (`auction-advice.ts`). Netto, surplus, `ratio` e `SpM` restano colonne: sono
  i numeri giusti in un'asta a rilanci e sono quello che si legge per capire un prezzo. Quello che è cambiato
  è la chiave, e il commento dice quale formato sta prezzando — il giorno che qui si gioca un'asta a rilanci,
  quella riga va riletta e non copiata.
- **`pickForUs` raziona per COPERTURA** (`auction-plan.ts` + il nuovo `mantra-legal.ts`): un uomo vale 1 se
  copre un posto che la rosa non copre ancora su **due undici legali**, `DEPTH_WEIGHT` = 0,35 se no. È la
  leva più grossa di tutto il consiglio (+1,47%, robust, copertura 93,4% → 97,4%, 30 crediti in meno) e
  chiude l'item 1.1 con una correzione: **il bersaglio non è `startingPlaces × 2`**, perché quelle quote sono
  il *ceil* di una media e sommano 16 contro i 10 posti di un modulo, quindi raddoppiarle spegne la regola
  invece di stringerla. Quello che il regolamento raziona è un POSTO.
  **Su MANTRA soltanto** (misurato la notte stessa, §17.3): sotto legalità classic la stessa regola perde
  (−1,00%, 4/10) perché lì `startingPlaces` somma già esattamente dieci, e quello che spedisce è la **quota
  graduata** (1 fino alla quota, `QUOTA_DEPTH` = 0,7 fino al doppio, 0,35 dopo): +0,77% robust su classic,
  +0,70% robust su mantra, l'unica delle due con un verdetto su entrambi i giochi. Il razionamento è deciso
  dal GIOCO e non da quali forme sono state caricate — leggere «nessuna forma» come «nessun razionamento»
  aveva lasciato classic senza razionamento per un giorno, che il banco prezza −**4,93%**.
- **La testa di ogni rivale è stimata dai suoi pick** (`classifyRivals`): prevede la sua scelta successiva
  l'**82,8%** delle volte contro il 69,2% della politica unica, 5/5 finestre, e su un tavolo dove solo un
  quarto delle sedie è guidata dal prezzo la politica unica crolla al 28,4% contro il 74,8%. Due pick bastano
  (`HEAD_WARMUP` = 2, misurato: il warmup più lungo è peggiore). Un rivale che non ha mostrato abbastanza
  resta sulla testa di default, che è «il più caro che gli serve»: è un «non lo sappiamo» e non una scoperta.
- **Un campetto della squadra REALE, sotto i suggerimenti** (richiesta dell'operatore, 10/08/2026): selettore
  dei club e **la board del TOOLKIT**, con i giocatori già presi ad **alpha 0,3**. La prima versione disegnava
  un undici calcolato nell'app (i più presenti previsti) e l'operatore l'ha corretta lo stesso giorno: «il
  campetto deve utilizzare le informazioni del db generato dal toolkit». Aveva ragione, e la via giusta era
  più corta di quanto sembrasse — **esisteva già**: `press.extract_boards` guidava il pannello VERO senza
  finestra (Tk nascosto, il loader del pannello, `board_shape` / `eleven` / `lanes_for` / `_placed`) per i due
  giudici, e i **ballottaggi** li calcolava già e li **buttava via** (`_placed` restituisce
  `(x, titolare, rivali)`).
  Ora: `modules/boards.py` è l'UNICA definizione di una board e ha due chiamanti con bisogni opposti — i
  giudici con `apply_rulings=False` (un giudice non deve punteggiare le risposte dell'operatore), il pannello
  e da lì il bundle con `apply_rulings=True` (le tue decisioni hanno la precedenza massima sulla board
  disegnata). Lo `snapshot` scrive `boards.json` **dentro la cartella del foglio appena scritto**, così una
  board non può descrivere un foglio diverso da quello esportato, e l'`export` lo copia dove il manifest lo
  dichiara (`engine_sheets[].boards`).
  Per club: modulo disegnato (`picture`, dopo `_reshape`) e quello su cui il fit è stato risolto quando
  differiscono, modulo tipico, allenatore, probabilità dei moduli; per uomo: `fc_id`, **x** (la posizione
  orizzontale del pannello, fasce già ordinate), **ruoli reali** granulari, minuti e partite del suo
  campionato, quota da titolare, e **fino a due ballottaggi**. Verificato sul bundle: 37 + 20 + 20 club, 407 + 220 +
  220 uomini, 649 + 378 + 378 ballottaggi, **zero** disaccordi fra i numeri del modulo e i disegnati, zero
  uomini senza `x` o senza `fc_id`.
  Il disegno è la tua regola: ogni numero è quanti uomini stanno su quella linea, il portiere non è mai uno di
  quei numeri e sta sempre solo davanti alla difesa, con quattro numeri il terzo è la trequarti e l'ultimo è
  sempre l'attacco. Una linea con meno uomini di quanti il modulo chiede si disegna comunque e il difetto
  **si dice** (⚠ sotto il campetto), perché riempirla sarebbe inventare un uomo che il toolkit non ha messo.
  Tre cose che restano dichiarate: un uomo che la board disegna e il listone di sessione non ha **non è
  «libero»**, è fuori tavolo (bordo tratteggiato, nessun prezzo); «ballottaggio ignoto» non è «nessun rivale»
  (un titolare senza ruolo reale granulare non ha duelli esprimibili — 1 su 407); e un foglio costruito prima
  delle board non ne ha, e la carta lo dice invece di disegnare un altro undici sotto lo stesso nome.
- **Ogni pick previsto dice quanto TOGLIEREBBE quel giocatore al rivale che lo prende** (`denies`, mostrato
  sopra i 50 fantapunti). È una NOTA e non un cambio di scelta, ed è la misura stessa a dirlo: al tasso più
  generoso difendibile per questo gioco il denial ripaga il suo costo nel 63-70% dei pick dei primi quindici
  giri e nello **0%** dopo il sedicesimo.
- **Le tre strisce sono razionate come il nostro pick** (`planRoots` riceve lo stesso `need`), altrimenti
  «un altro reparto» offriva un quarto centrale che il piano sotto rifiutava di prendere — una lista mostrata
  le cui metriche descrivono un'altra lista, che è un difetto già pagato una volta.

E un cambio che NON è stato fatto, con la ragione: **nessun pavimento prezzo**. Il cross-fit leave-one-out
(item 1.3) non ne promuove nessuno — media held-out −0,05%, 3/5 — e col vincolo di copertura acceso il
«pavimento 200» vale −0,30%: comprava copertura per via del prezzo, e adesso la copertura si compra diretta.
Restano il tie-break «a parità prendi il meno quotato» e la coda punti-per-credito, già misurate.

### 26.3 Il banco è nel repo, e legge il codice del pannello

`toolkit/bench/draft/` è il terzo attrezzo di misura del progetto: `backtest` giudica le regole, `sweep` le
costanti, **questo giudica le POLITICHE** — cosa prendere adesso, in quale moneta, con quale razionamento.
Non tiene una copia del pannello: `entry.ts` ri-esporta `needFor`, `predictRivalPick`, `startingPlaces`,
`lambdaOf`, `netOf`, `coverNeedOf`, `needForUs` e tutta la legalità mantra da `app/src/app/core/`, e
`build.mjs` li impacchetta con l'esbuild dell'app. Una riga del banco (`APP: adottata, letta dal pannello`)
esiste solo per verificare che il codice che spedisce riproduca la misura che lo ha adottato.

L'ordine è quello della regola d'oro applicata al consiglio: **si misura sul banco, poi si cambia il
pannello, poi il banco lo rilegge dal pannello.** Un candidato vive in `policies.mjs` e non nell'app finché
non ha un verdetto.

### 26.4 Cosa resta dichiarato come mancante (aggiorna la §25.8)

- La **probabilità di arrivare al proprio turno** (§11.7, terzo numero) non c'è ancora.
- ~~La lega `default`/mantra non è dichiarata~~ → dichiarata il 10/08/2026 come **`Leghe Mantra`** (10
  squadre, 2 portieri + 21 di movimento, quindi 23 giri) e il suo foglio è nel bundle: 635 righe, 310
  prezzate dal motore e 325 stimate. Nota da non perdere: su `default` non è adottato R0c, quindi chi ha meno
  di 15 voti **non ha `engine_*` e ha `est_*`** — la colonna è vuota per costruzione, non per omissione.
- ~~Il consiglio ordina per netto/surplus~~ → ordina per valore e raziona per copertura (§26.2).
- ~~La testa dei rivali è una sola politica per tutti~~ → stimata per rivale (§26.2). Quello che resta
  NON misurato è la regola della **coda** del giro: i due bracci della misura la condividono, quindi non dice
  niente su di essa, e resta sulla nostra valutazione con l'assunzione dichiarata.
- ~~Il valore di BLOCCO non è misurato~~ → misurato e mostrato come nota (§26.2). Non entra nella scelta.
- ~~La strategia porta in modalità porte~~ → fatta (una riga per porta, §26.4 dell'elenco precedente).
- **Il calendario dentro l'orizzonte** (item 2.5) NON è misurabile sul banco, e le due ragioni sono misurate:
  su una stagione intera il calendario è identico per tutti (girone all'italiana), e `fixtures` contiene solo
  2026-27, quindi per le finestre storiche non esiste nessun calendario. Avvertimento che ne deriva per il
  pannello: `desc_easy_matches` e `desc_calendar_margin` hanno senso sulla finestra `from`–`to`, mai sulla
  stagione.
- **Un candidato nuovo, segnato e non adottato**: fra gli uomini che stanno per sparire, nel **57,3%** dei
  nostri pick ce n'è uno che alza il nostro undici almeno quanto la scelta della politica — cioè «valore ×
  copertura» e «il massimo guadagno marginale sull'undici» non sono lo stesso obiettivo, e il secondo non è
  mai stato misurato come politica.
- Resta aperta la §11.8 punto 1 (l'FVM si congela alla data del draft o si rilegge?).

---

## 27. Cosa un nome porta con sé, e l'undici che la MIA rosa schiera (11 agosto 2026)

Due richieste dell'operatore, nella stessa mattina, e sono la stessa domanda posta da due lati: **guardando un
nome, cosa mi manca per decidere?** La prima è un fatto che nessuna fantamedia può esprimere (chi è fuori da
mesi, chi è appena rientrato, chi ha rotto con la società); la seconda è che il pannello mostrava l'undici della
squadra REALE e non quello della rosa che sto costruendo al tavolo.

Il lavoro è dell'11/08/2026; **è stato committato e documentato il 14/08**, e i tre giorni di ritardo sono
registrati qui perché sono l'unica cosa che è andata storta: codice verde e non spedito è codice che nessuno
può correggere (§27.4).

### 27.1 I marchi accanto al nome: due misurati, uno dichiarato, un solo componente

`ui-flags` disegna quello che un nome porta, **dovunque quel nome sia disegnato** — la richiesta era «nei
suggerimenti ma anche dalle altre parti», e oggi sono quattro liste: le strisce del consiglio, il feed del
tavolo, la tabella di consultazione e i due campetti. Un solo componente e **un solo servizio**
(`PlayerStatus`), perché il difetto che questo progetto ha già pagato è *una lista mostrata i cui numeri
descrivono una lista diversa* (§05/08): due definizioni di «è infortunato» finirebbero per non essere
d'accordo, e la prima volta lo scoprirei a un'asta.

**I due marchi misurati** vengono dalla tabella `injuries` del bundle — gli stessi spell datati che la tabella
di consultazione già legge per spiegare una giornata vuota, quindi in questa app c'è **una** definizione di
infortunio e non due:

| marchio | cos'è | come si legge |
|---|---|---|
| `long_injury` | uno spell **aperto** che ha già superato la soglia | icona piena, ambra |
| `back_from_long` | rientrato **di recente** da uno spell lungo | **stessa icona a metà opacità** |

La stessa icona a due intensità è una scelta dell'operatore e porta il messaggio: «ci è passato» è lo stesso
fatto visto da dopo. Ambra e non rosso — un infortunio è un fatto su un giocatore, non un fallimento, e in
questa app il rosso è per il pericolo.

**Le due soglie sono scelte di DISPLAY, non parametri del modello**, e sono dichiarate in un punto solo
(`player-status.ts`): **45 giorni** perché un'assenza smetta di essere una botta e diventi un fatto che cambia
un'offerta, **60 giorni** di «è appena rientrato». Nessun gate le tocca perché non c'è niente da giudicare:
non entrano in nessuna valutazione e non spostano una graduatoria di un decimale. Scriverlo è il punto —
altrimenti il prossimo che le legge le prende per misurate.

Tre regole che il codice rispetta e che valgono oltre questo caso:
1. **Lo spell aperto VINCE sul rientro.** Chi è rientrato in giugno e si è rotto in agosto è fuori ADESSO, e
   un «appena rientrato» sbiadito accanto a lui direbbe l'opposto del vero. Quindi `back_from_long` riguarda
   solo un uomo che non ha niente di aperto.
2. **Fra il conteggio della fonte e il calendario si prende il PIÙ LUNGO.** `days_out` è scritto quando la
   pagina viene letta, e la pagina può essere più vecchia del bundle: un'assenza ancora in corso è durata
   almeno quanto dice il calendario.
3. **Il dato ha l'età del bundle, la domanda è su adesso**, quindi contano due date e nessuna è assunta: il
   marchio si calcola sull'orologio, e il tooltip dichiara **il giorno in cui il dato è stato letto**
   (`manifest.generated_at`). Uno spell aperto in un bundle di un mese può essersi chiuso il giorno dopo.

**Quanto tocca, misurato sul bundle del 10/08 letto al 14/08/2026** (32.891 righe di `injuries`, 3.081 uomini
con almeno uno spell): **134 infortuni lunghi aperti** e **73 rientri recenti** in tutta la tabella; sui
**1.413** uomini distinti dei tre fogli, **54** lunghi e **39** rientrati — foglio euro 42 e 28 su 1.085 righe,
i due fogli `default` 18 e 18 su 635. Cioè il marchio parla di circa **il 6,6% del listone**, che è la densità
giusta per una segnalazione: se dicesse qualcosa su un nome su tre non sarebbe una segnalazione.

**Il terzo marchio non è misurabile e quindi è DICHIARATO**: `config/player_notes.json`
(spec «Novità v9.49»), `{stagione: {fc_id: {kind, note, decided_on}}}`, con `kind` = `out_of_squad` |
`dispute` | `wants_out`. Niente qui osserva un litigio: `exit_risk` è un CONTRATTO che scade, un trasferimento
è un movimento avvenuto, una riga di rosa mancante è indizio di una partenza — leggere uno dei tre come una
rottura sarebbe inventare un fatto da un fatto diverso. **Una icona per tutti e tre** (raggruppamento
dell'operatore: al tavolo sono una domanda sola, «questo giocherà?») e la parola decide cosa dice il tooltip,
insieme alla data della dichiarazione, così chi legge vede quanto è vecchia invece di fidarsi per sempre.
Oggi il file per 2026-27 è **vuoto**: zero nomi dichiarati, quindi quell'icona non compare da nessuna parte —
ed è «niente dichiarato», mai «niente da dichiarare».

### 27.2 Il campetto FANTA: qui l'undici si CALCOLA, e non è una contraddizione

Accanto al campetto della squadra reale c'è ora quello della rosa al tavolo, e i due rispondono a domande
**opposte**:

| | squadra REALE | squadra FANTA |
|---|---|---|
| la domanda | quale undici schiererà quell'allenatore? | quale undici può schierare questa rosa? |
| chi risponde | il **toolkit** (`modules/boards.py`), l'app legge e non ricalcola | l'**app**, sul regolamento |
| perché | è una PREVISIONE su una persona, quindi una misura | non c'è nessun allenatore da prevedere |

La regola «il campetto legge la board del toolkit e mai un undici suo» (10/08) **resta intera**, e questo non
la viola: là c'è un allenatore da prevedere e prevederlo è una misura, che vive dove vivono le misure; qui non
c'è nessuno da prevedere, solo il **regolamento** — quali schemi legali fanno entrare questi uomini — quindi
la risposta è una deduzione e sta dove sta la domanda. Scritto anche nel `CLAUDE.md` di radice, perché una
sessione futura che leggesse solo la prima regola cancellerebbe questo campetto citandola.

Come è fatto:
- **La moneta è il VALORE** (fm × presenze attese), che è quello che il banco a cinque finestre ha misurato
  come moneta di questo formato (§26.1) — non il surplus, non il netto. Serviva il numero in fantapunti e non
  il rango: `value99` è un rango e **non si somma**, un undici è una somma, quindi `valueBy` è la definizione
  in fantapunti e `value99By` è quella stessa mappa sulla scala della sessione. Due modi di prezzare lo stesso
  uomo finirebbero per non essere d'accordo su quale undici è il più forte.
- **Il modulo è scelto, non chiesto**: è quello i cui posti fanno entrare l'undici più forte fra gli schemi
  legali del gioco che si sta giocando. La carta mostra i **runner-up col loro punteggio**, perché una scelta
  automatica deve poter essere dubitata; il **pareggio va al primo dichiarato**, che è lo stesso tie-break di
  `bestCovered` ed è asserito in un test invece di essere nascosto (con una rosa incompleta il pareggio è
  frequente).
- **Chi il foglio non sa prezzare NON è schierato e non è uno zero**: è elencato a parte, così «questo undici
  ha dieci uomini» si legge per quello che è invece che come una rosa con un buco. È «vuoto = ignoto» applicato
  a un disegno.
- **Il ballottaggio è esatto, non un'euristica**: il più forte della panchina che quel posto accetterebbe.
  Scambiarlo col titolare di un posto lascia intatti tutti gli altri posti, quindi l'undici resta legale
  **se e solo se** i suoi ruoli stanno in quel posto — nessun secondo abbinamento da rifare. Lo stesso uomo
  può essere il ballottaggio di due posti: è quello che «è la prima alternativa lì» significa, e non è un
  piano di sostituzioni.
- **Su classic il macro-ruolo si LEGGE dalla zona** che il feed usa già per contare i suoi slot, e non si
  piega un codice mantra per analogia: è l'avvertimento dell'operatore del 10/08 e la ragione per cui i due
  regolamenti sono due file.

`mantra-legal.ts` resta l'**unica** definizione della legalità (la legge anche il banco del draft) e si è
allargata invece di essere duplicata: `placesIn` porta ora la **linea** e il **nome del posto** del
regolamento, `placesOf` è la sua proiezione sui soli ruoli, `bestEleven` restituisce chi sta su ogni posto e
`bestElevenWorth` è il suo totale — cioè la funzione che il valore di blocco (§26.2) usava già continua a
esistere come una riga sopra la nuova. **L'ordine dentro una linea è quello del regolamento**, dalla destra
della squadra alla sua sinistra: è la sola informazione di lato che un modulo porta, e un disegno che la
ignorasse metterebbe il terzino destro a sinistra.

### 27.3 Verifica

`ng build` verde; test dell'app **da 107 a 132** — i 25 nuovi sono tutti nei due file nuovi
(`fanta-eleven.spec.ts` 11, `player-status.spec.ts` 14) — toolkit **366 + 1 skipped**, `engine_*` non toccato
e `SHEET_REVISION` invariato a 15, quindi nessun foglio diventa stantio.

**Cosa NON è verificato, e va detto**: la verifica visiva dei due campetti affiancati vive dentro un'asta
seguita, esattamente come quella del campetto reale (§26.4 dell'elenco precedente). Nessuno screenshot è stato
preso, quindi la geometria a due colonne (`xl:grid-cols-2`) è dichiarata e non misurata.

### 27.4 La cosa andata storta, che è di metodo e non di codice

Questo lavoro è stato scritto l'11/08 la mattina ed è rimasto **tre giorni nel working tree**: non committato,
non documentato in `docs/model/` e non pubblicato. Nel frattempo il sito pubblico è restato al deploy del
**09/08**, cioè indietro di **due** sessioni intere — mancavano sia i campetti reali del 10/08 sia tutto
questo. Due conseguenze da tenere:

1. **Codice verde e non spedito è codice che nessuno può correggere.** Un difetto che vive solo sulla macchina
   dell'operatore non produce nemmeno la segnalazione che lo farebbe trovare — la stessa forma di «uno zero
   silenzioso è indistinguibile da una funzione rotta», un livello sopra.
2. **Il `chiudi` va fatto quando il lavoro finisce, non quando la sessione finisce.** Le due funzioni erano
   complete e verdi alle 08:11 dell'11/08; il documento che le spiega è di tre giorni dopo, ricostruito
   leggendo i diff. Ha funzionato perché i commenti nel codice portavano i «perché» e le date; sarebbe
   fallito senza.

## 28. Il TREND delle ultime dieci REALI, e il giudizio 0-99 che lo ordina (14 agosto 2026)

Richiesta dell'operatore (item 5 di [todolist-draft-v1.md](todolist-draft-v1.md)), nata dal suo metodo
personale. Numeri e costruzione: spec **«Novità v9.50»**; qui c'è cosa il tavolo ci legge.

### 28.1 Perché la finestra è il CAMPIONATO e non «le ultime dieci»

Il calendario EuroLeghe salta **3-7 giornate reali per lega ogni stagione**, quindi un uomo giudicato sulla
sua fantamedia euro è giudicato sull'82% del suo calcio. Quelle giornate sono nel layer per-partita, hanno un
voto sintetico **calibrato**, e la striscia le marca con una sottolineatura: sulle finestre scritte oggi sono
**940 partite su 9.657 (9,7%)**. La finestra `desc_form_*` — ogni competizione, amichevoli comprese — resta
dov'era e risponde a un'altra domanda; il popup del pannello legge SOLO i contatori della sua, perché una
figura spiegata dai numeri di un'altra finestra è il difetto che questo progetto ha già pagato.

### 28.2 Cosa dice una barra, e cosa non dirà mai

L'ALTEZZA è il voto, da una cascata dichiarata in un punto solo: **voto vero → `mv_synth` → niente**. Mai uno
zero — una partita che nessuno ha votato non è una brutta partita, ed è la stessa regola di «vuoto = ignoto».
Una barra **vuota** dice che quel voto è il sintetico. Uno **zoccolo** di due pixel al posto della barra è una
partita non giocata, e il colore dice quale delle cinque ragioni: panchina, infortunio, squalifica, fuori dai
convocati, nessun dato. **La panchina è MISURATA** (la riga del sostituto non utilizzato esiste da sempre nel
provider) e **vince su uno spell** che copra quel giorno: un uomo in distinta era disponibile e non è stato
scelto, che è l'unica delle due frasi che cambia un'offerta. Accanto alla barra, mai dentro la sua altezza, la
colonnina di **xG+xA**: uno può giocare bene e finalizzare male, e sommare le due cose nasconderebbe proprio
quello. Gol, assist e cartellini sono icone, e i cartellini solo dove la partita è stata davvero votata —
lo strato per-partita non ha ammonizioni, e disegnarne una sarebbe inventare una misura.

### 28.3 Il numero: 0-99 dentro il ruolo, e la frase che deve accompagnarlo

`desc_trend_fp` è la **media dei fantapunti** su quelle dieci: una partita non giocata vale **0** (la
disponibilità è metà di quello che vale una fantamedia — `Var(ln pv)` è il 90% di `Var(ln fantapunti)`), una
che nessuno può punteggiare **non entra nel denominatore**, e `desc_trend_matches` dice quante ci sono
entrate. Il 0-99 è lineare contro il migliore **del suo ruolo** sul listone in gioco: «va forte» è una frase
relativa a quello che il ruolo può produrre, e un pool sotto gli 8 uomini non è una distribuzione, quindi la
colonna resta vuota.

**È una DESCRIZIONE e non una previsione, e il tooltip lo dice.** Misurato lo stesso giorno su ~65.000
finestre col null rimescolato, lo scostamento dalle proprie medie non predice le giornate successive: eccesso
vero **+0,0167 / +0,0072 / −0,0007** a 2, 3 e 5 giornate, **col segno che cambia**. Ordinare per trend è
ordinare per «cosa ha fatto» — legittimo, veloce, e quello che l'operatore ha chiesto; venderlo come «cosa
farà» sarebbe la terza forma respinta della stessa idea. Nessuna valutazione, nessun piano e nessun undici lo
legge.

### 28.4 Verificato come, e cosa resta dichiarato

La figura è stata **guardata** (le strisce scritte a 6x direttamente da Tk, non uno screenshot della finestra)
e la prima versione è stata corretta su quello che si vedeva: la colonnina xG+xA invadeva la barra, e uno zero
disegnava un pixel indistinguibile da un valore piccolo. Poi il pannello vero, fotografato: la colonna TREND
tiene i suoi 102px in 106 e il 0-99 le sta accanto. Nell'app la striscia è un componente unico (`ui-trend`,
SVG) verificato **sulla geometria** e non a occhio - cinque test che leggono altezze, colori e posizioni,
perché uno screenshot non dimostra che un'assenza non sia stata disegnata come una barra bassa. Quello che
resta non verificato è la riga d'asta **dentro una sessione viva**: come per i campetti, serve un'asta seguita.

## 29. Chi ha guadagnato il posto e chi l'ha perso, col controllo sul reparto (14 agosto 2026, sera)

Item 6 di [todolist-draft-v1.md](todolist-draft-v1.md). Costruzione e numeri: spec **«Novità v9.51»**.

### 29.1 Cosa dice l'icona, e perché ce ne sono due

`↑` ha guadagnato il posto, `↓` l'ha perso — nel pannello Tk fra i flag, nell'app come marchio accanto al
nome (`ui-flags`, la stessa pipeline dei marchi di infortunio, così una lista non può contraddirne un'altra).
Il fatto è il GIORNO in cui i suoi minuti cambiano stabilmente durante la stagione misurata: media prima,
media dopo, almeno cinque partite per lato e trenta minuti di scalino. Sulle 635 righe di Serie A sono **243
cambi, 128 guadagnati e 115 persi**.

### 29.2 Il controllo sul reparto, che è tutto il valore della cosa

**Un uomo che gioca perché il titolare davanti a lui è rotto non ha vinto il posto**: torna indietro quando
l'altro rientra, e al tavolo è una differenza che cambia un'offerta. Quindi il tooltip non dice «ha
guadagnato il posto» e basta, dice **quale delle sei cose** è successa:

| codice | cosa dice al tavolo |
|---|---|
| `front_injured` | è entrato mentre X era GIÀ fuori — il posto può tornare indietro |
| `won_then_injury` | ha preso il posto PRIMA, X si è fatto male dopo: l'infortunio l'ha consolidato |
| `won_it` | nessuno della sua linea era fuori quel giorno |
| `own_injury` | l'ha perso perché era fuori lui |
| `benched` | era DISPONIBILE e non schierato |
| `fewer_minutes` | è ancora in squadra e gioca meno — che non è perdere la maglia |

Il confronto è fra **DATE** e mai fra stagioni, ed è la ragione per cui l'item esisteva: il primo 90' di
Bartesaghi è la giornata del 3-5 ottobre e la caviglia di Estupiñán è del 12. La sola co-occorrenza avrebbe
detto «gioca perché manca Estupiñán», che è il contrario di quello che è successo. La LINEA è il ruolo
granulare (`DL`, non `D`), perché un terzino destro non copre un centrale.

### 29.3 Quello che NON si può controllare, detto invece che sottinteso

Le **squalifiche**: `availability` è uno snapshot di due settimane e `reds` è 0 su tutto il 2025-26 nel layer
per-partita. La nota di ogni riga dove la domanda si pone finisce con «le squalifiche non sono controllate»,
che è diverso da «non era squalificato». È la stessa regola dei duelli e delle presenze: vuoto = ignoto.

### 29.4 Perché è un'icona e non una colonna ordinabile

Perché la forma predittiva è stata misurata e vale poco: «promozione nei minuti», controllando prezzo e
minuti già visti, legge **+0,049 su 8 istanze, 6/8**. Mostrarlo è utile — è un fatto che l'operatore vuole
vedere prima di puntare — e ordinarci sopra una valutazione no. Niente sotto `engine/` lo legge, non è una
chiave di ordinamento e non entra in nessun undici.

## 30. «Preso per titolare, ruotato di fatto»: il caso Lewandowski (14 agosto 2026, notte)

Secondo caso portato dall'operatore, e la domanda era operativa: un uomo dato titolare a inizio anno che
titolare non è stato, e un'icona che dopo un tot di giornate lo dica. Item 7 di
[todolist-draft-v1.md](todolist-draft-v1.md), numeri in spec «Novità v9.52».

### 30.1 Perché serviva un secondo indicatore

Lewandowski 2025-26 legge `14 12 22 90* 25 90* 90* 16 90*…`: gioca ogni settimana e non è il titolare —
17 partenze su 35 e **47 minuti a partita**, dopo un 2024-25 di 32 su 36 e **74 minuti**. Non c'è nessun
gradino, quindi il changepoint dell'item 6 non vede niente; e il Qt.I era 34, cioè il mercato lo dava
titolare. È la differenza fra **perdere il posto** (un giorno, un prima e un dopo) ed **essere ruotato**
(nessun giorno, e ogni domenica costa).

### 30.2 La regola e il suo pool

Ultime **5 giornate del CLUB**, media sotto i **45 minuti**, al più **una da titolare**, e solo per chi è
quotato nel **top 15% del suo ruolo**. Quest'ultima non è una restrizione prudenziale: è la popolazione su
cui la soglia è tarata, e «venduto come titolare» è la premessa della frase — chi il mercato non ha
venduto così non può fallire di esserlo.

### 30.3 Quanto vale, misurato sulla funzione che spedisce

**3.711 letture, 471 segnalate (12,7%), precisione 90,4% contro una base del 59,5% — 1,52x**; per stagione
91,0% / 95,9% / 86,7% / 87,3%. Nove su dieci chiudono davvero il resto della stagione sotto i 60 minuti a
partita del club; il decimo diventa titolare.

**La correzione vale più del numero.** Una prima calibrazione scorreva le RIGHE di ciascun uomo e leggeva
84,5% contro una base del 34,9% (2,42x). La funzione vera scorre i **fixture del club** e conta come zero
le giornate saltate: un'altra finestra e un altro denominatore, quindi quei numeri non erano suoi. Sono
stati rifatti **chiamando `rotation_watch`** a sei date di ogni stagione e punteggiando quello che
restituisce. È la stessa lezione del null del §20, un livello sopra: cambiando il denominatore la base
passa dal 35% al 60% e il lift da 2,42x a 1,52x — e il numero onesto è il secondo.

### 30.4 Due silenzi, e uno stato che non esiste ad agosto

Chi era **infortunato** in quella finestra non è ruotato: lo screen punteggia uguale con o senza la
guardia (86,3% contro 85,7%), quindi non costa precisione e toglie una frase falsa a un uomo che porta già
il marchio dell'infortunio. E l'icona **legge la stagione che si gioca**: cinque giornate dietro, otto
davanti. Su un foglio di agosto la colonna è vuota **per costruzione** — non è una segnalazione negativa,
è che non c'è ancora niente da leggere; comparirà al quinto turno. Dichiarato e non aggiustato: lo screen
si indebolisce a fine stagione (l'ultima lettura del 2025-26 vale 70,0% contro una base del 72,0%, cioè
niente), e la soglia non si muove dopo aver visto quella curva.

### 30.5 «Anche prima della quinta giornata»: due marchi, non uno anticipato

Richiesta dell'operatore la sera stessa, e la risposta è misurata invece che concessa. Sulla finestra
d'apertura, con l'unica soglia che un campione corto regge (**non ha MAI iniziato una partita**):

| dopo | segnalati | precisione | base | lift |
|---|---|---|---|---|
| 1 giornata | 130 | 76,9% | 56,3% | 1,37x |
| 2 | 99 | 78,8% | 57,5% | 1,37x |
| 3 | 70 | 84,3% | 57,8% | 1,46x |
| **4** | 54 | **96,3%** | 58,1% | **1,66x** |
| 5 | 78 | 94,9% | 58,6% | 1,62x |

**Alla quarta si può dire tutto**: vale quanto alla quinta, quindi il marchio pieno scatta lì e non si
perde niente. A due e tre giornate vale l'81% contro una base del 58%, che è **«guardalo»** e non «non è
il titolare» — e il contro-esempio decide la questione: dopo due giornate del 2025-26 la lettura avrebbe
segnalato **Donnarumma** al Manchester City con 0 minuti, e lui ha chiuso a **85** di media; sei dei suoi
diciassette nomi sono diventati titolari. Su quella stagione il marchio debole prende **10 nomi su 15** e
quello pieno **4 su 4**.

Quindi due icone e due frasi: `◑` piena dalla quarta giornata, `◔` a metà opacità dalla seconda, ognuna
col proprio numero nel tooltip. Lewandowski prende quella debole alla 2ª e quella piena alla 4ª — che è
esattamente la domanda da cui è partita.

## 31. Lo specchio: dato per riserva, gioca da titolare (14 agosto 2026, notte)

Domanda inversa dell'operatore, coi suoi tre casi: **Ferran Torres** e **Douvikas** 2025-26, **Castro**
2024-25. Item 8 di [todolist-draft-v1.md](todolist-draft-v1.md), numeri in spec «Novità v9.53».

### 31.1 La regola, e perché la fascia ha due bordi

Quotato fra il **30° e l'85° percentile del suo ruolo** — una riserva, non un riempitivo — con almeno
**65 minuti di media** e l'**80% delle ultime cinque iniziate**, e niente prima della quarta giornata.
Sopra l'85° era venduto come titolare, ed è la popolazione dell'altro marchio: «gioca» non è una
notizia. Sotto il 30° è un riempitivo, e quattro buone partite sono una coppa.

### 31.2 Cosa vuol dire «è diventato titolare», corretto dai casi

Il primo punteggio riusava la soglia dell'altro screen (60 minuti a partita del club) e dava
**sbagliati tutti e due i nomi segnalati**: Castro legge 58, Ferran 49. Ma Castro ha **iniziato 27
partite su 37**. Il rovescio di «non è titolare» non è «lo è»: la parola dice **quante volte inizia**,
ed è così che l'esito viene contato. Contato così l'icona è giusta il **79,1%** delle volte contro una
base del **40,9%** (1,94x), stabile su tutte e quattro le stagioni (81/80/80/76%). La lettura sui minuti
resta a verbale (54,9% contro 22,2%, 2,47x) così il cambio non nasconde niente.

### 31.3 Il portiere è il caso più forte, e il sospetto era sbagliato

La testa della lista è tutta portieri, perché un portiere è quotato poco per costruzione — sembrava un
difetto. Misurato: la fascia «riserva» dei portieri è fatta **davvero** di riserve (base 22,3% contro il
42,3% degli uomini di movimento), quindi uno che parte titolare nelle prime giornate lo resta
nell'**81,9%** dei casi, **3,68x**. Per lui il marchio vuol dire «è il numero uno» e non «sta
crescendo», e la frase cambia di conseguenza — che è la classica occasione da tavolo, il portiere
titolare di una piccola a cinque crediti.

### 31.4 Quello che si perde, e la simmetria che ne esce

**Douvikas non spara**: 3 titolarità su 5 e 49 minuti, sotto entrambe le soglie, e ha poi iniziato il
67% del resto. Lo screen è severo di proposito, e un uomo che parte lentamente è il prezzo del 79%.

E il risultato che vale oltre i due marchi: **perdere il posto è più prevedibile che conquistarlo** —
90,4% contro 76,8%. Un uomo che smette di giocare di solito è stato tolto per una ragione che dura; uno
che ne inizia cinque può stare coprendo qualcuno.

---

## 32. La pagina STRATEGIA: cosa si prepara PRIMA di sedersi (26-27 agosto 2026)

Documento proprio: **`pagina-strategia-v1.md`**. Qui il posto che occupa fra le altre pagine, che è la
domanda a cui questo documento risponde.

Le tre pagine d'asta rispondono a tre domande diverse e nessuna può sostituire un'altra:

| pagina | quando | domanda | moneta |
|---|---|---|---|
| `/auction` | al tavolo, in diretta | «chi prendo ADESSO, e fino a quanto» | valore/netto sul pool vivo |
| `/sealed-bid` | fra due tornate | «che numero scrivo nella busta» | GAIN × probabilità di vincerla |
| `/strategy` | **prima** | «quanti uomini per reparto, e quali nomi devo avere in testa» | surplus (rilanci) o valore (draft) |

Quello che aggiunge è **la lunghezza di una lista**, che nessun'altra pagina calcolava: la domanda della
stanza intera per quel ruolo — `slot × partecipanti` su classic (8 difensori per 8 partecipanti = 64), le
quote delle forme su mantra, dove la rosa non ha quote per ruolo. È la sola cosa che dice quando una lista
è finita: sotto quella lunghezza, «ho un'alternativa» è una speranza.

Due regole di UI che sono requisiti, entrambe già scritte altrove e riconfermate qui: **il regolamento
dichiarato sta SEMPRE a schermo** (barra fissa: listone, gioco, rose, budget, partecipanti, tipo d'asta e
quale valuta ordina), e **una scelta automatica deve essere dubitabile** — il foglio che prezza le liste è
nominato con la sua revisione, e dove la lega dichiarata non coincide con quella del foglio la pagina
lo dice invece di riallineare da sola.

## La PLANCIA a slot: FVM e MAX OFFERTA su ogni riga, e la coppia sull'hover

**03/09/2026, decisione dell'operatore dopo la sessione di misura del banco d'asta
(`simulatore-asta-rilanci-v1.md` §23-26).** La forma: quattro linee, una per ruolo; su ogni linea un
blocco per ogni posto in rosa (3 · 8 · 8 · 6, che lui chiama **slot**, ed è la parola del gioco quindi
è quella che si usa); dentro ogni slot **dieci calciatori, uno per partecipante**; su ogni riga
**FVM e MAX OFFERTA**, e sull'hover **la coppia dello slot successivo da prendere al suo posto**.

**Perché quella griglia è la struttura del mercato e non un'impaginazione.** Una rosa è di 25 uomini e
un listone contiene esattamente 25 slot da `TEAMS` uomini, perché uno slot è un rango diviso il numero
di squadre: quindi *una rosa è un uomo per slot*, ed è su quella griglia che vive ogni misura del banco
— i consigli del motore valgono dentro uno slot (§25), lo sconto di fine fase esiste dallo slot 3 in giù
(§23) e il tempismo adottato è una regola sugli slot (§24).

**Il taglio è per FVM, congelato alla data dell'asta.** Misurato sulle 20 aste vere della sua lega,
raggruppando gli uomini per quanto costeranno davvero: FVM 0,350 · Qt.A 0,358 · Qt.I 0,382 di
dispersione dentro lo slot, e l'FVM del giorno dell'asta vince in 14 aste su 20. Ma la ragione migliore
è la sua: **il blocco deve raggruppare gli uomini che la STANZA tratta come equivalenti, e la stanza
legge l'FVM.** Congelato perché una coordinata che si rimescola fra due sessioni è una cattiva
coordinata: passando da Qt.I a FVM oggi, 154 uomini su 527 cambiano slot e 50 entrano o escono dalla
mappa.

### Quattro cose che la misura impone, e la quarta corregge la richiesta

1. **LA MAX OFFERTA È PER RUOLO, non una formula sola.** Misurata come «uno del primo slot contro due
   del secondo», dieci stagioni vere, in quota del budget: **portiere ~13%** (il mercato chiede il 6%:
   si compra), **centrocampista ~6,5%** (il mercato chiede il 9%), **attaccante ~18%** (il mercato
   chiede il 25%), **difensore: nessun prezzo** — la coppia vince a ogni quota provata, già a 30
   crediti (−0,10 a giornata) e −0,48 a 50. Una formula unica sarebbe sbagliata su due ruoli di quattro.
2. **LA COPPIA SI CALCOLA SU CHI È ANCORA NELL'URNA, non sui due migliori di sempre.** L'alternativa
   degrada mentre l'asta va avanti, ed è proprio quel conto che alla quarta ora non si tiene più a
   mente: è il lavoro per cui la plancia esiste.
3. **E DEVE ESSERE PAGABILE.** Una coppia da 160 crediti non è un'alternativa per chi ne ha 100: la max
   offerta va sempre limitata a quello che la borsa consente (`min(quota misurata, room)`), altrimenti
   la plancia consiglia un tetto che non si può nemmeno raggiungere.
4. **PER IL PORTIERE LA COPPIA NON ESISTE, e l'hover deve dire un'altra cosa.** Ne schieri UNO: «due
   dello slot successivo invece di uno» non è un'alternativa, è una panchina. Là l'alternativa è un
   ALTRO PORTIERE dello stesso slot — ed è anche il ruolo dove il motore vale il doppio, perché a pari
   prezzo la domanda è solo quale dei dieci gioca. Quindi l'hover del portiere mostra il secondo e il
   terzo del suo stesso slot, non una coppia dello slot dopo.

### E una regola su come si SCRIVE il numero

**La max offerta va mostrata come BANDA e non come cifra esatta.** Le soglie sono misurate su dieci
stagioni con 3-8 stagioni concordi su 10: la direzione è netta (il segno gira sempre fra il 13% e il
19%, su tre slot e su tre ruoli indipendenti) e il punto esatto no. Scrivere «180» su una riga che
decide un acquisto è una precisione che il dato non ha; «~170-190», o un colore che sfuma, dice la
stessa cosa senza mentire. Quello che è solido e si può scrivere secco: **sopra il 20% del budget si
sbaglia in qualunque slot** (da −0,3 a −1,2 punti a giornata) e **sotto il 10% non si sbaglia mai.**

### Cosa la plancia NON deve dire

**«Fuori dalla mappa» non vuol dire «inutile».** Sul foglio di oggi ci sono 527 acquistabili e la mappa
ne contiene 250, ma nelle aste vere **5 uomini su 25 di ogni rosa vengono da sotto la mappa**, pagati un
credito. Serve una 26ª striscia — la coda — col solo conto di quanti ne restano: una plancia che li
nasconde convince ad aspettare, e aspettare fino a lasciare posti vuoti è l'errore più caro che questo
banco abbia misurato.


## 33. La PLANCIA, scritta (3 settembre 2026)

`/plancia` — `views/plancia/` (la pagina, la riga del lotto, la mappa a slot, la griglia delle squadre),
`core/plancia.ts` (il dominio, puro e testato), `core/plancia-store.ts` (le due sorgenti),
`core/plancia-demo.ts` (il tavolo finto). Build verde, **568 test su 36 file**, pagina misurata in un
browser vero: nessuna eccezione, la pagina non scorre, 215 righe hoverabili.

### 33.1 La forma, decisa dall'operatore guardando la prima versione

Tre zone, e la disposizione è sua (03/09/2026, dopo aver visto il primo layout):

- **Il LOTTO è una RIGA sotto l'intestazione**, non una colonna: si legge da sinistra a destra come una
  frase — chi è, quanto vale, perché, cosa compreresti invece — e lascia tutta la larghezza alla plancia,
  che è la cosa che ha bisogno di spazio.
- **Le SQUADRE sono una COLONNA a destra, a griglia** (2 × 5). Sigla, crediti grandi, quattro numerini
  P·D·C·A: si accende solo il ruolo del lotto e solo su chi può ancora prenderlo. Il nome per esteso sta
  nel tooltip, perché a 116px una sigla si riconosce e una frase no.
- **La plancia è tutto il resto, e porta TUTTE le 250 righe.** Niente si apre e niente si chiude: alla
  quarta ora «chi è rimasto in questo slot» si risponde guardando, non cliccando — e la scorciatoia che
  l'ordine a reparti avrebbe dato («apri la fase in cui siamo») non esiste, perché la sua estrazione è
  libera e tutti e quattro i ruoli sono vivi a ogni istante (§29 del banco).

**Ogni blocco è largo uguale, i tre dei portieri compresi**: uno slot è un rango diviso il numero di
squadre, quindi un blocco è **un'unità di mercato** qualunque ruolo porti, e disegnare i portieri più
larghi direbbe che valgono più schermo di un difensore. Le linee corte si tagliano su una griglia di otto
come le altre e lo spazio che avanza porta la **coda**, la **legenda** e **la tua borsa** (crediti, posti,
*crediti per posto* — il vincolo che a estrazione libera si perde di vista) invece di allargare i blocchi.

### 33.2 Una riga, un numero — e il numero ha due significati

Una riga porta il nome e **un** numero: la **max offerta** finché è nell'urna, il **prezzo pagato** una
volta che è di qualcuno. Due significati in una colonna è una cosa che questo progetto normalmente
rifiuta, e qui è tenuta con la sua ragione detta: togliere il prezzo pagato costerebbe la metà più utile,
perché **quello che la stanza ha davvero pagato per quello slot è l'unica lettura viva del mercato che
esista**. Quale dei due è, lo dicono l'inchiostro della riga, la barra del colore del proprietario a
sinistra e la legenda in chiaro sulla linea dei portieri.

**Sull'hover, la coppia** — i due dello slot sotto che compreresti al suo posto, **ciascuno col suo costo
max** e col totale. È su ogni riga e non solo sul lotto perché è il conto che nessuno tiene a mente, ed è
calcolato **su chi è ancora nell'urna**: l'alternativa degrada mentre l'asta va avanti, ed è quello il
lavoro per cui la plancia esiste. Costa 25 conti e non 250, perché la coppia è un fatto sul BLOCCO e non
sull'uomo — i due migliori rimasti uno slot sotto sono gli stessi per tutti e dieci.

### 33.3 Le quattro cose che la misura impone, tutte e quattro applicate

Il §32bis le aveva scritte prima che esistesse il codice; nessuna è stata negoziata.

1. **La max offerta è per RUOLO**, dalla `LADDER` del §19.3 tenuta come **quota del budget** e non in
   crediti, perché il tetto scala col budget (verificato a 500 · 1000 · 2000).
2. **La coppia si calcola su chi è ancora nell'urna.**
3. **È pagabile**: sempre `min(quota misurata, borsa)`, e la riga lo dichiara con un lucchetto quando è la
   borsa a decidere.
4. **Per il portiere la coppia non esiste** — e qui la prima stesura ha sbagliato: mostrava il 2º e il 3º
   del suo slot **sommati**. Ne schieri uno, quindi quei due sono alternative *fra loro* e il totale non
   significa niente. `Alternative.together` decide se un totale esiste; dove non esiste non si stampa.

E la regola su come si scrive il numero: **banda, mai una cifra secca**, con le due righe che la misura sa
dire piatte disegnate sulla scala del budget (sotto il 10% non si sbaglia mai, sopra il 20% si sbaglia in
qualunque slot).

### 33.4 La connessione è FACOLTATIVA, e vale per tutt'e due le pagine d'asta

Decisione dell'operatore, 03/09/2026: **`/plancia` e `/auction` aprono su un tavolo inventato con i
settaggi standard** (10 · 1000 · 3/8/8/6) e il collegamento a fanta-asta-live è un bottone che apre una
modale. Una pagina che apre su un campo codice mostra il layout della cosa invece della cosa, e i numeri
si giudicano solo con i numeri accesi. Una sola modale per le due pagine (`ui/live-connect`): due copie
avrebbero finito per validare il codice in due modi, e il formato **è** la ragione per cui il collegamento
funziona (il codice È la chiave del database).

L'ordine è forzato su `/auction`: prima `feed.restore()`, e la finzione parte **solo se non c'è niente da
riprendere** — altrimenti sovrascriverebbe un'asta vera che l'operatore sta giocando.

### 33.5 Quello che il tavolo vero non dice, dichiarato invece che indovinato

fanta-asta-live pubblica la meccanica dei rilanci (`options.bids`: countdown, offerta minima, buzzer) e
**nessun nodo che nomini il lotto attualmente in asta** è mai stato osservato da questo progetto. Quindi
il lotto lo estrae la finzione in demo e **lo nomina l'operatore** da collegato, con un click sul nome
nella plancia; `lotSource` dice quale dei due sta parlando. Un campo indovinato su un payload che nessuno
ha letto è il difetto che questo repository ha già pagato più volte.

### 33.6 Un lettore solo delle colonne del motore

`core/engine-sheet.ts` (`engineNumbersFrom`) è stato estratto da `auction-advice.ts` e le due pagine lo
condividono: tre viste stanno ormai sugli stessi `engine_*`, e due lettori di `engine_fm_pred` finiscono
per dare a un uomo due valutazioni. Il primo posto in cui qualcuno se ne accorgerebbe è un tavolo.

## 34. Accoppiare due portieri: il calendario, e cosa «facile» vuol dire davvero (3 settembre 2026)

**Richiesta dell'operatore**: cliccando un portiere sulla plancia si apre una modale coi migliori
accoppiamenti con altri portieri; si guarda il calendario ristretto alle **impostazioni della
competizione**, per ogni giornata si vede quali portieri hanno una partita **facile** («una partita dove
la squadra in cui gioca il portiere è probabile che subirà 0 gol», valutando l'avversario e il
casa/trasferta), e la giornata conta come FACILE per la coppia **se almeno uno dei due** ce l'ha. I tre
portieri con più giornate FACILI vanno indicati. Poi un tasto «mostra griglia» apre una seconda modale
con squadre su righe e colonne (col portiere titolare sulle colonne), il numero di partite facili in
ogni casella e, sull'hover, il calendario di tutte e due con una **V** sulle facili.

### 34.1 La sua definizione di «facile» è stata VALIDATA, non riutilizzata sulla fiducia

`EASY_MARGIN` = 200 (§23.4) era stato congelato da lui su un criterio diverso — «il club più forte deve
smettere di leggere *tutte*» — mentre la frase di oggi è un'altra affermazione: *è probabile che non
subisca gol*. Due frasi, quindi si misura.

Misurato su **5354 partite-club di Serie A, 2019-20…2026-27**: avversario e campo dal layer per partita
(`external_match_stats`), gol subiti dalle righe `role='P'` dei voti — quindi il conteggio non passa dal
funnel delle identità — e i due livelli da `club_levels`. Logistica sullo **stesso** vantaggio che
`easy_matches` già calcola:

| vantaggio Elo | −200 | 0 | +100 | **+200** | +300 | +400 |
|---|---|---|---|---|---|---|
| P(porta inviolata) | 0.141 | 0.249 | 0.320 | **0.401** | 0.487 | 0.575 |

**Il margine congelato È la sua frase**: a 200 la probabilità è **0.401**, e il livello 40% si raggiunge a
un vantaggio di **199**. Quel 40% è anche `club_defence.CLEAN_SHEET_SHARE`, misurato un mese prima su un
criterio del tutto scorrelato («da quale quota una porta resta inviolata spesso»). Due strade indipendenti
sullo stesso numero — che è evidenza, non una coincidenza da conservare per fortuna, ed è per questo che un
test la fissa. Verifica dell'etichetta: le partite classificate facili chiudono a zero il **42,8%** delle
volte contro il **23,9%** delle altre.

Calibrazione per decile della probabilità prevista: entro 0,03 dappertutto **tranne l'ultimo decimo**, che
il modello **sovrastima** (0,473 previsto contro 0,423 reale). Va detto perché è proprio il decile di cui
sono fatte le coppie migliori.

### 34.2 Misurato e NON adottato: il vantaggio campo della porta inviolata è più grande

Per una **porta inviolata** il campo si fitta a un semi-scarto di **30-35** punti Elo, non ai 14,5 che
questo modulo usa e che §23.1 ha misurato sul **RISULTATO**. Log-loss fuori campione su 2320 partite:
**0,57796** a H=35 contro **0,57839** a H=14,5 e **0,57936** senza nessun effetto campo — ottimo interno,
quindi la **direzione** è identificata (tenere la porta inviolata dipende dal campo più di quanto ci
dipenda vincere). Vale però **0,0004 di log-loss e il 3% delle classificazioni**, e sarebbe una **seconda**
costante di campo dentro un modulo il cui output è tutto reporting: due costanti per un solo campo è come
uno schermo finisce con due risposte a «questa partita è in casa». Scritto qui perché nessuno lo rimisuri.

### 34.3 IL CONTEGGIO SATURA IN BASSO, e per questo le due colonne sono due

Alla soglia congelata, sul calendario 2026-27, **dodici club di venti non hanno NESSUNA partita facile in
tutta la stagione** (Inter 25, Napoli 15, Milan 14, Juventus 14, Roma 13, Atalanta 13, Lazio 2, Bologna 2,
gli altri 0). È la saturazione che §23.3 aveva già scritto — «il conteggio satura a OGNI soglia, è una
proprietà di un conteggio e non del valore» — vista dall'altro capo: quasi tutte le coppie pareggiano a
zero, e una classifica su quel solo numero direbbe «compra il portiere dell'Inter» a chiunque.

Decisione dell'operatore, messa davanti alla misura: **la soglia 200 resta e decide, e a rompere il
pareggio è una colonna continua**. Le due sono nominate a schermo e non si mescolano mai in una cifra sola:

- **FACILI** = la sua regola alla lettera, giornate in cui almeno uno dei due supera il margine;
- **coperte** = le stesse giornate contate con la probabilità al posto della monetina, cioè
  `Σ_giornata 1 − (1−p_A)(1−p_B)`.

**Respinta** l'alternativa di abbassare la soglia a 138 (P=35%), che farebbe tornare a discriminare il
conteggio (165 facili contro 98, 11 club a zero contro 12): sarebbe una soglia scelta perché il conteggio
non piaceva, che è esattamente ciò che questo progetto vieta.

### 34.3-bis …e la sera dello stesso giorno è scesa a **100**, su TRE ESEMPI dell'operatore

Il rifiuto qui sopra regge come è scritto — una soglia scelta guardando il *conteggio* — e non è quello
che è successo poche ore dopo: l'operatore ha portato tre partite («ATALANTA vs CAGLIARI è facile per
l'Atalanta · COMO vs GENOA è facile per il Como · ATALANTA vs LECCE») e poi la sua lettura di una casella,
con un puntino su ogni partita che secondo lui è facile e un trattino sulle giornate che di conseguenza lo
sono. **Un giudizio dell'operatore su casi concreti è un dato**, e si misura contro il codice.

**Misurati per primi gli ESEMPI e non la soglia**, che è la parte che ha ridotto la questione a un
decimale: due dei tre erano **già facili a 200** — Atalanta-Cagliari +236,9 (g4) e Atalanta-Lecce +270,8
(g37) / +241,8 (g13) — quindi la sua lista vincolava **una partita sola**, Como-Genoa a **+104,2** (Como
in casa, g38; la stessa sfida alla g3 è Genoa-Como e il Como è in trasferta, +75,2).

**La sua stessa casella come giudice.** Sulle 19 giornate visibili di Como + Fiorentina, contro i suoi
segni:

| soglia | giornate d'accordo con lui | le sue 7 giornate segnate |
|---|---|---|
| 200 | 12/19 | 0 facili |
| **100** | **17/19** | **7 facili** |

Le due divergenze a 100 sono spiegate e non tolte: la g5 (Como **@ Frosinone**, +169,8) è una trasferta
che lui non ha segnato, e la g19 (Fiorentina-Lecce, +112,4) è fuori dallo screenshot. Il suo puntino più
basso è a **+78,5** (Fiorentina-Cagliari): sotto la soglia adottata, e quella giornata resta comunque
facile per l'altra partita, quindi **nessun trattino cambia**.

**Il prezzo dell'etichetta, tenuto fuori campione sullo stesso campione di 5354 partite-club:**

| soglia | P(cs) alla soglia | classificate facili | cs \| facili | cs \| altre | lift |
|---|---|---|---|---|---|
| 200 | 0.401 | 13,0% | 0,427 | 0,239 | 1,79 |
| **100** | **0.320** | 28,7% | **0,395** | 0,210 | **1,88** |
| 75 | 0.301 | 33,2% | 0,387 | 0,202 | 1,91 |

Il potere separante **non scende** — è piatto fra 50 e 250 e legge un filo meglio in basso — quindi non è
un allargamento che svuota l'etichetta: quello che cambia è cosa promette la parola, 39,5% di porte
inviolate invece di 42,7%. Per questo è una SCELTA e non un fit.

**Ed è 100 e non 75**, che pure passerebbe il suo secondo esempio nella versione in trasferta: a 75
tornano a leggere **tutta** la stagione facile Inter 38/38, Bayern 34/34 e PSG 35/35, cioè risorge il
difetto che il 10/08 gli aveva fatto congelare 200. *Una soglia che resuscita il difetto che lui ha
chiesto di spegnere è una soglia da fermare un gradino prima.* A 100 nessun club di Serie A legge tutte
le sue partite come facili (Inter 34/38) e i club a zero passano da 12 a 8 su 20; sulla finestra 3-5 la
griglia passa da **136 caselle di 190 a zero** a 45.

**L'accordo col 40% è finito, e il test non si cancella: si spacca in due.** Il livello 40% a un
vantaggio di 199 è un invariante della CURVA e resta asserito (è anche `club_defence.CLEAN_SHEET_SHARE`);
la soglia è una dichiarazione e si asserisce al valore che promette davvero, **0,32**. Così nessuno legge
0,40 su una griglia costruita a 0,32 — e chi muove la costante deve ridichiarare la frase invece di
ereditarne una vera per un'altra soglia. Vale per i tre lettori: `fixtures.EASY_MARGIN`,
`test_fixtures_schedule.py` e l'arnese e2e, che ora controlla che il **bundle** porti 100 (un pacchetto
più vecchio della decisione è la cosa che l'operatore ha visto per prima: la colonna «ok» vuota).

### 34.3-ter I GOL ENTRANO NEL MODELLO, e la sua frase era il meccanismo (3 settembre 2026, sera)

**Sua richiesta**: «oltre all'elo valutassi anche la media gol dell'attacco e i gol subiti in media
della difesa … potresti prendere le ultime 5 o 10 partite di ogni squadra». E il meccanismo l'ha detto
lui: **«una squadra forte non è detto che segni tanto, e una squadra debole non è detto che segni
poco»** — l'Elo è un rating di RISULTATI, quindi non distingue chi vince 3-2 da chi vince 1-0, e una
porta inviolata è esattamente quella differenza.

**MISURATO E ADOTTATO.** Log-loss leave-one-season-out su 4.940 partite-club e 8 stagioni: **0,54749
(solo Elo) → 0,54282**, migliore in **7 stagioni su 8**. Sull'etichetta alla sua soglia il lift passa
da 1,95 a **2,01** e il **9%** delle partite cambia lato. Quanto vale il canale, in chiaro: a parità di
Elo, un avversario che segna 0,8 a partita contro uno che segna 2,0 porta la probabilità da **0,289 a
0,199** — nove punti che il livello non vedeva.

| | intercetta | per 100 di edge | gol subiti da me | gol fatti da loro |
|---|---|---|---|---|
| coefficienti | −0,140474 | +0,278270 | −0,319126 | −0,410066 |

**Tre cose che la misura ha deciso CONTRO il modo in cui la richiesta era formulata**, e sono la parte
che vale la pena scrivere:
- **la finestra è DIECI e non cinque.** Una media su 5 partite è quasi rumore: fuori campione vale
  −0,0024 contro −0,0044 delle 10, e la curva è **piatta da 10 a 38** (−0,0044 · −0,0047 · −0,0050) col
  minimo nominale **sul bordo della griglia** — che questo progetto non adotta, e che qui vorrebbe dire
  «tutta la stagione», cioè non forma. Dieci è anche la finestra che il progetto già chiama recente per
  un club, quindi è una definizione riusata e non una nuova.
- **il casa/fuori NON paga**: «media gol casa/fuori» legge −0,0021 contro −0,0035 delle dieci semplici
  sulle stesse righe — cinque partite in casa sono metà campione per un termine che l'edge già porta.
- **le due metà non valgono uguale**: l'attacco avversario da solo −0,0030, la mia difesa **−0,0005**
  (5 stagioni su 8). Restano entrambe perché insieme fanno −0,0047 e 7/8, ma la frase da ricordare è
  che **quello che decide una porta inviolata è soprattutto chi hai davanti**.

**E LA PRIMA MISURA ERA SBAGLIATA NELLE MIE MANI**, il che è la ragione per cui i numeri qui sopra sono
i secondi: camminando le partite-club in ordine di data e aggiungendo ciascun risultato alla storia del
club man mano, **le due righe di UNA partita condividono la data**, quindi la seconda leggeva una storia
che conteneva già quella partita. Leggeva un guadagno **quattro volte** più grande e «più la finestra è
corta meglio è», in modo monotono fino al bordo della griglia — e quella monotonia è il campanello che
questo progetto si è già scritto. La storia ora si costruisce PRIMA, intera, e ogni riga legge solo le
partite con data **strettamente precedente** alla propria.

**Due conseguenze di struttura, entrambe dichiarate nell'artefatto.** La soglia si sposta sulla
PROBABILITÀ (`EASY_PROBABILITY` = 0,3002, che è la sua soglia di 75 di edge letta sul modello a solo
Elo): con tre predittori un margine sull'edge non può più esprimere «facile», perché due partite allo
stesso edge contro attacchi diversi non sono la stessa partita — e le due soglie sono **appaiate per
costruzione**, così un club senza forma è etichettato esattamente come prima invece di cambiare colore
per essere stato promosso. E **le dieci partite hanno un ORIZZONTE di quindici mesi**: le ultime dieci
di Serie A del Frosinone sono di due stagioni fa (leggeva 0,90/0,90 dal 2023-24), e una lettura così
vecchia non è una lettura di oggi — «vuoto = ignoto» applicato al tempo. In settembre le tre promosse
non hanno forma e vengono prezzate dal solo Elo, che è la risposta onesta su una squadra che nessuno ha
visto in questo campionato: 272 partite su 380 leggono i gol.

**Cosa cambia sullo schermo, sui due club che l'operatore ha segnalato come assurdi** («Udinese e Lecce
hanno 0 partite facili»): l'**Udinese passa da 0 (margine 200) a 3 (margine 75) a 10 su 38**, perché ha
la miglior difesa delle ultime dieci (0,90 gol subiti) e l'Elo non lo vedeva. Il **Lecce resta a 0**, e
non è un difetto: è 18° su 20 per livello, i soli club sotto di lui valgono 19 punti Elo, la sua partita
migliore è Lecce-Monza a **+56** e il suo margine medio di stagione è **−135**. La verifica è stata
fatta chiamando la funzione che spedisce sul database vero e stampando i due calendari interi, non
leggendo il JSON che lo schermo aveva in mano.

### 34.3-quater IL TOTALE DI UNA COPPIA NASCONDE CHI L'HA PORTATO (3 settembre 2026, sera)

**Sua osservazione, e vale più di un difetto**: «il Napoli e la Juve, singolarmente, hanno 31 partite
facili; il Como ne ha 22 e solo insieme al Bologna arriva a 33». Verificata sul pacchetto corrente
(Napoli 32 · Juventus 32 · Como 23 · Bologna 21 · Como+Bologna 34), e il fatto generale è più forte
dell'esempio:

- **111 caselle su 190 aggiungono due giornate o meno** al migliore dei propri due club;
- **5 su 190** battono il miglior club singolo (Inter 35) di tre o più giornate.

Quindi il secondo portiere è quasi tutto ridondanza, ed è la stessa forma che il progetto ha già
misurato dall'altro lato: **un'assicurazione si prezza contro quello che ti copre già, non contro
niente** (`metrica-asta-surplus-v1.md` §24, i due portieri dello stesso club). Il numero della casella
è una copertura vera e resta; quello che mancava è il MARGINALE, e adesso è a schermo in tre punti — la
colonna «aggiunte» sui tre consigli, la stessa cifra sulla lista completa, e la scomposizione in cima
al pannello di una casella («ATA da solo 28 · CAG da solo 6 · insieme 30, quindi il secondo ne aggiunge
+2»).

**E LO ZERO È LA DOMANDA, quindi sono DUE e hanno due nomi**, che è la cosa che questo caso insegna al
di là dei portieri. Nella LISTA l'uomo che ho è fissato — è quello che ho cliccato — quindi il
riferimento è il MIO calendario (`PairSuggestion.gain`), e con quello il marginale **non riordina
niente**: il mio «da solo» è una costante, e ordinare per unione o per unione-meno-una-costante dà la
stessa lista. Sulla GRIGLIA nessuno dei due club è mio, quindi il riferimento è il **migliore dei due**
(`GridCell.gain`) — e quello riordina, che è esattamente la lettura di cui parla la sua osservazione.
La prima versione sottraeva il massimo anche nella lista, e **un test l'ha rifiutata**: con quello zero
un compagno forte finisce sotto uno debole, perché la formula risponde di nascosto a «quanto aggiungo
IO a lui».

### 34.3-quinquies La griglia: colori a classi, e il pannello sul CLICK

Tre richieste della stessa sera, tutte misurate a schermo e non guardate.

**«Ora sembra tutto verde e non risalta niente.»** La causa non era la tinta ma la SCALA: la
distribuzione di questa griglia è ammassata in alto — più di cento caselle su 190 stanno fra il 68% e
il 100% del massimo — quindi una scala lineare le dipingeva tutte fra il 48% e il 70% di verde,
indistinguibili proprio dove si decide. Cinque **classi per quantile** (un quinto delle caselle
ciascuna per costruzione, la più bassa senza tinta) e i PARI sempre nella stessa classe, perché la
classe si assegna al VALORE col suo percentile medio e non alla cella — due caselle che dicono 32 con
due colori sarebbero peggio di nessun colore. Misurato dall'arnese: **5 tinte distinte**, nessuna che
copra più del 45% delle caselle, il numero leggibile su ognuna (contrasto ≥ 4,5:1 su tutte) e la
legenda a schermo, perché una scala a classi senza legenda è una figura che nessuno può controllare.

**«Fai comparire la lista dei match solo sul click.»** `nzPopoverTrigger` su `click`, e la cella si
registra su **`pointerdown` e non su `click`**: `nz-popover` apre sul click stesso, e due ascoltatori
sullo stesso elemento scattano nell'ordine in cui sono stati registrati — scrivere il segnale nel
`(click)` è una corsa il cui premio è il calendario della casella PRECEDENTE. `pointerdown` precede
sempre il click, e questo rende l'ordine un fatto invece di una speranza (stessa famiglia dei due
dropdown che si litigavano un template il 20/08). L'arnese ora misura anche che **il puntatore che
passa NON apra niente**, prima di cliccare: «zero problemi» e «non ho guardato» non devono leggersi
uguale.

**«Compatta la modale, non farla uscire in basso.»** Il paragrafo è diventato UNA riga con la legenda
dentro e il resto nel tooltip di un'icona (16px misurati, con l'asserto che se torna un paragrafo il
banco lo dice), la modale è `nzCentered` col riquadro tagliato su `calc(100vh - 190px)`, e il banco
misura il dialogo contro la finestra **su tutt'e due gli assi**: 1137 × [141..766] su 1574 × 907. La
versione precedente guardava solo la larghezza, che è il motivo per cui «esce in basso» è arrivato come
segnalazione e non come asserto.

**E un flag dell'arnese è stato scritto e tolto nella stessa ora**: `--light` emulava
`prefers-color-scheme`, e questa app non ha un tema chiaro che segue il sistema — ha temi NOMINATI su
`:root[data-theme]`. Misurato, le celle restavano identiche: **un flag che non muove niente è peggio di
nessun flag**, perché leggerebbe «nessun problema» su una cosa che non ha guardato. Sostituito con
`--theme <nome>`, che la scala dei colori la rimisura davvero (verificata su `magenta`).

### 34.3-sexies La riga della plancia: due numeri, nessun tooltip, e i suoi in cima
**(3 settembre 2026, sera tardi — cinque sue istruzioni di seguito, tutte verificate a schermo.)**

**«Togliamo il tooltip sui calciatori, è fastidioso … all'hover evidenzia la coppia che posso comprare
al suo posto.»** Su 250 righe un pannello che si apre passando copre proprio le righe che stai
leggendo, e l'informazione è la stessa: quindi la coppia alternativa non si RISCRIVE in un riquadro, si
ACCENDE dove i due uomini già stanno. **Con uno SFONDO e non un bordo** (sua seconda istruzione: un
bordo su una riga alta dieci pixel sposta il testo e si legge come un salto), rosso al 10% e come
stile INLINE, perché quelle righe hanno già una classe di sfondo per lo stato — due utility sulla
stessa proprietà si decidono sull'ordine del CSS generato e non su quale delle due è legata (il
difetto del 27/08), mentre un inline condizionale vince quando c'è e lascia dipingere la classe
quando non c'è.

**E il gesto è su `mouseenter` e non su `pointerenter` per una MISURA**: col pointer event il banco
leggeva ZERO righe accese dopo un hover vero. *Un gesto che il banco non riesce a far scattare è un
gesto che non si può verificare, quindi non si spedisce* — su un touch un hover non esiste comunque.
Verificato: passando su Malen si accendono **Simeone e Laurientè** (i due di A2), e uscendo si
spengono tutt'e due.

**«Ogni calciatore, oltre alla max offerta, un numerino che mi indichi il suo valore a colpo
d'occhio: quanti punti (tra media voto e bonus) a partita fa guadagnare rispetto al 6.»** Fatto — e
la prima versione, `fm − 6` per partita giocata, è durata pochi minuti perché lui ha trovato il
difetto guardando lo schermo: **«perché Hojlund (+1,1) sta prima di Martinez (+1,6)? Immagino per le
presenze»**. Sì: dentro uno slot la plancia ordina per VALORE ATTESO (§23.2), e un numero che non sa
niente delle presenze non può che contraddire quell'ordine.

*Una colonna che spiega un ordinamento deve ESSERE quello stesso ordinamento, o è un terzo punteggio
che si contraddice col secondo.* Quindi il numero è `fm × pv / giornate − 6` — la stessa quantità
dell'ordine, traslata di sei, quindi monotona con essa per costruzione — **per cento e senza virgola,
sua scelta** (`+23` invece di `+0,23`). Le altre due forme sono state misurate e messe davanti a lui
prima di scegliere: `fm − 6` non sa delle presenze, e `(fm − ricambio) × pv / giornate` ha una scala
più bella (Malen +1,82 · Martinez +1,56 · Hojlund +1,30) ma **riordina** — metterebbe Martinez sopra
Hojlund, cioè un numero più alto sotto uno più basso, a meno di cambiare l'ordine dello slot, che è
un'adozione misurata (+18,1 ± 3,4 fantapunti per scelta, 10 stagioni su 10).

Il prezzo della forma scelta è dichiarato e si vede: il riferimento è «6 in TUTTE le giornate», che
nessuno raggiunge, quindi la colonna è in gran parte negativa (Malen **+23**, Hojlund +17, Martinez
−2, e i portieri intorno a −150/−300, che è vero — un portiere rende meno punti a giornata). Dentro
uno slot discrimina bene, ed è lì che il confronto si fa.

**«I calciatori presi nella tua rosa, spostali in alto nel blocco e cambia lo sfondo in un grigio un
po' più chiaro.»** Fatto, e l'ordine sotto di loro **non si muove**: `sort` in JS è stabile, quindi
questo è un PREFISSO e non un riordino — la stessa forma dell'ordine personale dei blocchi della
pagina strategia. Il grigio al posto del primario ha anche una ragione che vale oltre il colore: il
primario è il colore con cui questa pagina segna quello su cui si sta DECIDENDO, e un uomo già preso
non è una decisione, è un fatto.

**E il banco ha imparato due cose su come si misura una tinta.** Contare i bordi leggeva 250 su 250
(ogni bottone ne ha uno: lo strumento che dice «è marcato tutto», cioè niente), e leggere il canale
rosso leggeva 0, perché Chrome computa un `color-mix(in srgb …)` come `color(srgb 1 0.17 0.47 / 0.1)`
e non come `rgb()` — un test sui canali confronta 1 con 8. **Quello che conta è quello che CAMBIA**:
il banco ora fotografa lo sfondo di tutte le 250 righe prima e dopo, e conta le differenze, che non
ha bisogno di conoscere nessun formato. E la riga sotto il puntatore si toglie dal conto, perché
cambia da sé per il suo `hover:` di stato — non alzare la soglia, togliere il caso noto.

### 34.3-septies LA CARD DI UN CALCIATORE, e il click che fa una cosa sola (4 settembre 2026)

**Sua richiesta**: «quando clicco su un calciatore nella plancia si deve aprire una card compatta
draggabile e chiudibile con le info principali del calciatore e le sue statistiche essenziali. Se è un
portiere aggiungi un tastino "abbinamenti"».

`views/plancia/man-card/`, 288px misurati, trascinabile dall'intestazione (`cdkDrag` +
`cdkDragHandle`: una card che si sposta afferrandola in mezzo a un numero è una card in cui non si può
selezionare un numero), chiudibile, e in `fixed` FUORI dalla griglia della plancia — dentro
erediterebbe il suo `overflow` e si taglierebbe al primo trascinamento.

**IL CLICK ORA FA UNA COSA SOLA.** Prima nominava il LOTTO per un uomo di movimento e apriva gli
accoppiamenti per un portiere: due comportamenti sullo stesso gesto, a seconda del ruolo. Adesso apre
la card, e le altre due sono BOTTONI suoi — «è il lotto in asta» e, per un portiere, «abbinamenti».
*Un gesto che fa due cose diverse a seconda del ruolo è un gesto che va imparato; un gesto che apre
una card no.* Resta asserito quello che il click non deve fare (istruzione del 03/09): non mette
niente in asta.

**LA CARD NON RICALCOLA NIENTE**, ed è la ragione per cui è una card e non una pagina. Ogni numero
viene dal foglio attraverso l'unico lettore (`engine-sheet.ts`), che ha guadagnato due colonne che già
viaggiavano — `desc_titolarita` (il gradino della sua scala a sei parole) e `desc_minutes_next` (i
minuti attesi per partita) — e la banda dalla stessa funzione che disegna la riga: `BoardMan` porta
ora la banda INTERA invece del solo massimo, perché due chiamate a `offerBand` con due insiemi di
parametri sono come un uomo finisce con due prezzi. La card tiene un ID e non una copia dell'uomo:
la riga si ricostruisce a ogni aggiudicazione, e una card con la copia mostrerebbe il prezzo di dieci
minuti prima.

**E NESSUNA RIGA È PIÙ SPENTA**: lo erano quelle di chi ha un padrone e non è portiere, perché non si
potevano nominare come lotto e non c'era altro da fare. Ma la card si chiede anche di un uomo già
venduto — a che prezzo è andato, quanto rendeva, chi ce l'ha — e i due gesti che dipendono dallo stato
sono ora bottoni che appaiono quando hanno senso. *Disabilitare una riga per un'azione che non è più
quella del click è una riga spenta per un motivo che non c'è più.*

Due difetti trovati misurando, non guardando. **Un campo ricordato invece che letto**: il template
diceva `man.outOfSquad`, che su `BoardMan` non esiste — la nota dichiarata si legge dal servizio
`PlayerStatus`, come fa la pagina delle buste — «verifica la FUNZIONE, non la colonna che le somiglia»,
in casa mia e a un'ora di distanza dall'averlo scritto nel verbale. E **un'icona non registrata**
(`link`): `nz-icon` la va a cercare in rete, fallisce e urla in console, dove solo un arnese che
raccoglie quello che la pagina urla la vede.

Verificato in un browser vero: la card si apre a 288px con cinque voci di statistica, il trascinamento
la porta da (643, 96) a (783, 166) — «draggabile» è una domanda su dei PIXEL, e un `cdkDrag` che non si
muove lascia il DOM identico — il bottone apre «Con chi accoppiare Svilar Roma», e il lotto non cambia.

**E LE CARD SONO PIÙ DI UNA, perché servono a CONFRONTARE** (sua richiesta immediatamente dopo): lo
store tiene un ELENCO di id in ordine di apertura, la pagina disegna una card per uomo aperto, e
ri-cliccare un nome già aperto non fa un doppione e non lo chiude — lo porta in primo piano, che è
quello che un confronto chiede.

Due cose che la richiesta ha deciso e che valgono oltre le card. **AFFIANCATE E NON A CASCATA**: la
prima versione le sfalsava di 28px, e due card da 288px sfalsate così **si coprono per il 90%** —
sarebbero due card che valgono una. Quattro per riga a 300px di passo, poi si scende di 44, dal bordo
sinistro così la posizione non dipende dalla larghezza della finestra. **E NESSUN TETTO al numero**:
il ciclo ricomincia invece di fermarsi, perché lui non ha chiesto un limite e una soglia su «quante
card si possono aprire» sarebbe una soglia scelta da me e misurata da nessuno — la via d'uscita è un
bottone «chiudi le N card» che appare quando ce n'è più di una.

E il probe le CONTA invece di leggerne la prima: un `querySelector` direbbe «una card» sia con una che
con sei. Misurato: due click su due nomi danno **2 card** a (16, 96) e (316, 96), la prima resta dove
l'avevi trascinata, e il banco asserisce che la seconda non nasca sopra la prima.

### 34.3-octies L'OFFERTA SCENDE SU UN CLUB CHE HO GIÀ (4 settembre 2026)

**Sua istruzione**: «sarebbe preferibile avere calciatori di squadre diverse per differenziare il
rischio … vorrei che la max-offerta per un calciatore della stessa squadra reale di un altro
calciatore in rosa diminuisca, e peggiori ancora di più se in rosa abbiamo già 2 calciatori della
stessa squadra». Fatto: `sameClubDiscount`, letto da TUTT'E DUE i posti che chiamano `offerBand` — la
riga della plancia e il lotto — perché due chiamate con due parametri diversi sono come un uomo
finisce con due prezzi.

**LA FORMA È SUA E I VALORI SONO DICHIARATI, e vale la pena dire contro cosa.** Una misura su questo
esiste e dice una cosa diversa: il banco ha adottato `CLUB_FREE` = 2 e `CLUB_PENALTY` = 0,45, cioè i
primi DUE di un club non costano niente e la penalità scatta dal TERZO (02/09: 4,1 punti di costo
contro il 4,4% di dispersione in meno). La sua regola comincia un uomo prima. E c'è una ragione,
misurata dall'altro lato, per cui il banco non può decidere qui: **la sua sd è FRA STAGIONI mentre il
rischio che si compra diversificando è DENTRO una** (`metrica-asta-surplus-v1.md` §24, «questo banco
non può vedere il beneficio che compra»). Quindi la scala è la sua, i due numeri sono cauti apposta —
**−10% sul secondo** (dove il banco non toglierebbe niente) e **−25% dal terzo** (dove il banco
toglierebbe il 45%) — e non peggiora oltre il terzo, perché una scala che continua a scendere
finirebbe a zero su una rosa che pesca molto da un club e nessuno ha misurato quel fondo.

**È uno sconto sull'OFFERTA e non sul VALORE**, che è esattamente quello che ha chiesto: il giocatore
vale quello che vale, cambia quanto sono disposto a pagarlo. Il conteggio è di uomini della MIA rosa
(il club di un rivale non è un rischio mio) e i test lo asseriscono alle due quote dichiarate invece
che come un ordine qualsiasi.

### 34.4 Dove vive cosa, e perché

Il **toolkit** decide se una partita è facile e con che probabilità (`fixtures.schedule` → `calendar.json`
nel bundle): è una previsione sul calcio, quindi sta dove le previsioni si misurano. L'**app** conta
(`core/keeper-pairs.ts`): quali giornate cadono nella finestra dichiarata e cosa coprono due club. Lo
stesso confine che mette la board di un club vero in `boards.py` e l'undici della MIA rosa in
`fanta-eleven.ts`.

Ed è anche l'unica cosa che l'app non potrebbe dedursi: `fixtures` e `club_levels` sono chiavati su
`matching.club_identity`, che è una tabella di alias in Python — rifarne il join in un browser vorrebbe
dire ripetere quello che una volta ha perso Milan, Roma e Napoli dal calendario di tutti. Risolto una
volta là, e l'app unisce sul nome canonico che già legge su una riga del foglio (verificato: 20 club di
20 risolti sul foglio Serie A).

Tre cose che il conto dichiara invece di riempirle:
- **un club di un altro campionato non è accoppiabile**: una giornata di fantacalcio cade su un turno
  diverso in ogni lega, e per la stagione bersaglio `matchday_map` ne copre **cinque su trentuno** —
  allinearli sarebbe inventare un calendario. Quelli lasciati fuori sono contati e la modale lo dice;
- **la probabilità esiste solo dove i coefficienti sono stati stimati** (Serie A): fuori, il vantaggio
  Elo c'è e la probabilità è `null`, perché una trasformazione fittata appartiene alla popolazione su cui
  è stata fittata;
- **una giornata che nessuno dei due gioca non è una giornata mancata**: il denominatore sono le giornate
  che i due hanno davvero, mai `to − from`.

### 34.5 Il portiere titolare della griglia NON è scelto qui

È il primo della linea P della board che il toolkit disegna (`boards.json`). «L'app legge la board e mai
la propria» vale per l'undici di un club vero, e sceglierlo in un secondo modo darebbe a un club due
portieri titolari. Un club senza board porta la colonna senza nome.

La **diagonale è VUOTA**, per decisione dell'operatore del 03/09/2026 sera («gli incroci ATA/ATA, BOL/BOL
dovrebbero essere caselle vuote»): un club con sé stesso non è una coppia, e una casella col numero dentro
si legge come se lo fosse. Quello che quella casella misurava — il club **da solo**, cioè il termine di
paragone della sua riga — non si butta: è un fatto su UN club e non su una coppia, quindi sta accanto al
suo nome sull'intestazione della riga, che è il posto dove i fatti su un club vivono. Un asserto dell'arnese
lo controlla: la diagonale non scrive niente e **ogni** riga porta il suo «da solo», o il numero è stato
perso invece che spostato.

### 34.6 Il click su un portiere NON mette il calciatore in asta

Istruzione dell'operatore, sulla proposta opposta: «cliccare non deve mettere il calciatore in asta, non è
un comportamento che ho chiesto». Sono due gesti distinti — su un uomo di movimento il click nomina il
lotto, su un portiere apre gli accoppiamenti — e la ragione è che una rosa schiera **un** portiere: la
domanda che si fa sulla sua riga non è «quanto offro» ma «quale dei dieci». Una riga di portiere già presa
resta cliccabile, perché «con chi lo accoppio» ha senso anche sui presi.

### 34.7 Verificato in un browser vero, e i due difetti che ha trovato

`app/scripts/e2e-plancia-keepers.mjs`, con un puntatore vero e contando quello che ARRIVA. Legge
`calendar.json` dallo stesso server dell'app e **ricalcola** cosa dovrebbe dire la riga in cima: 28
giornate facili per Svilar (Roma) + Martinez Jo. (Inter), e lo schermo dice 28. Griglia 20×20, 20 colonne
col portiere titolare, 400/400 caselle con uno sfondo dipinto, popover con 4 colonne e le V pari al numero
della casella, console pulita.

Due difetti trovati dalla misura e non dallo sguardo:
- **due utility di sfondo sullo stesso elemento**: `bg-surface` scritta fissa e `bg-primary` legata sono
  nello stesso layer, e a decidere è l'ordine del CSS generato. Lo sfondo restava `--color-surface` mentre
  il TESTO passava a `--color-on-primary`: scuro su scuro, **1,08:1**. Curato legando **una** classe sola.
  È la lezione di `app/CLAUDE.md` del 27/08 incontrata dal lato peggiore — la metà che dipingeva era
  quella sbagliata, quindi il difetto rendeva il testo illeggibile invece di lasciarlo com'era;
- **due icone non registrate** (`table`, `info-circle`): `nz-icon` le va a cercare in rete, fallisce e
  urla in console. Trovate perché l'arnese raccoglie quello che la pagina urla, non perché si vedesse.

E un difetto **dell'arnese** che vale la pena segnare: il primo passo che ricalcolava le giornate attese
le **stampava** accanto a quelle dello schermo senza confrontarle — cioè un audit che risponde «nessun
problema» dopo aver guardato niente. Messo il confronto, ha subito trovato il proprio bug di parsing
(`Number("28 facili")`), che è la prova che è vivo.

### 34.8 UNA CASELLA CONDIVISA NON SI PUÒ ETICHETTARE DAGLI ASSI (3 settembre 2026, sera)

Il difetto più grosso di questa modale, trovato dall'operatore su una casella e non da nessun test:
nel popover di «Com + Ata» **le partite dell'Atalanta erano disegnate sotto Como e quelle del Como sotto
Atalanta**, e con esse il segno di «facile». Le sue parole: «quii non mi trovo».

La causa è una scelta giusta pagata al piano di sopra. `coverGrid` calcola **metà** griglia e fa leggere
alla casella e alla sua speculare **lo stesso oggetto** — «due passate su una domanda sola è come una
casella e la sua speculare finiscono per non essere d'accordo», che è la ragione per cui è scritta così —
e il prezzo è che `PairRow.a` e `.b` sono l'ordine in cui la **COPPIA** è stata costruita, non la riga e
la colonna di chi la guarda. Sotto la diagonale i due sono invertiti, e il template le etichettava dagli
assi.

Curato dove non si può più sbagliare: la casella **dichiara di chi è ciascuna colonna** (`GridCell.clubA`
/ `clubB`), il popover intitola le colonne con quelle e non con `row`/`column`, e anche il titolo della
casella («Ata + Cag») segue lo stesso ordine — due ordini per una coppia sono come qualcuno rilegge le
colonne al rovescio. Due prove, non una: uno spec sull'oggetto (sotto la diagonale la casella è la stessa
e i suoi due nomi sono nell'ordine vero) e un asserto dell'arnese che **ricalcola l'attribuzione dal
bundle**, colonna per colonna, su una casella scelta **sotto** la diagonale — cioè nella metà dove il
difetto viveva: `Atalanta 37/37 righe · Cagliari 37/37`.

Le altre quattro richieste della stessa sera, tutte misurate a schermo:
- **la tabella deve stare nella modale.** Venti colonne da 74px più l'intestazione chiedevano ~1610px
  contro i ~1430 che 96vw lascia: le colonne portano ora la **sigla** (`shortNames`, una definizione
  sola per tutta l'app, che sa che il pool fa parte dell'etichetta) col nome intero nel `title` — un
  ATTRIBUTO e non un nodo, perché un elemento che non è una `<th>` dentro la riga di intestazione si
  mangia una colonna della griglia (gli 84px del 20/08). Misurato: tabella **1065px in un riquadro da
  1461px**, modale 1506 su 1574 di finestra, e il riquadro scorre comunque perché uno schermo più
  piccolo esiste;
- **la spunta al posto della «V»** (`nz-icon` `check`), che ha portato con sé un asserto da riscrivere:
  l'arnese contava il TESTO «V» e con l'icona avrebbe letto zero dando la colpa alla regola;
- **niente scorrimento laterale nella lista delle partite**: larghezza dichiarata, `table-fixed`, nomi
  troncati col nome intero nel `title`, e la misura è `scrollWidth − clientWidth` = **0px**;
- **la regola della spunta letta riga per riga** e non come totale: «c'è quando almeno una delle due è
  facile, ed è evidenziata solo la partita facile». L'arnese confronta le due cose su ogni riga (0
  discordanze su 37), che è più di quanto dica il totale già asserito.


## 35. L'ASTERISCO del listone: chi non gioca piu' in questo campionato (3 settembre 2026, sera)

Dalla segnalazione dell'operatore su una schermata della plancia — **Lukaku nello slot A3 del Napoli**,
max offerta 30 crediti — e dalla sua correzione, che e' la meta' importante: «Lukaku non deve essere
tolto per la nota "fuori rosa" ma perche' **non gioca piu' in serie A**», e poi la regola per intero:
«i calciatori acquistabili sulla plancia devono essere presenti nel listone (serie-a o euroleghe) e non
devono avere l'asterisco».

**La prima cura era la meta' sbagliata, ed e' stata ritirata.** Una nota DICHIARATA (`out_of_squad`)
c'era dal 25/08 e la plancia non la leggeva; farla rifiutare l'uomo lo toglieva dallo schermo con la
ragione sbagliata — «fuori rosa» e' uno stato DENTRO un club, «non gioca piu' qui» e' un fatto sul
CAMPIONATO, e leggere il primo come il secondo e' inventare un fatto da un altro, che e' esattamente
la regola per cui `dispute` e `wants_out` non toccano niente. La nota e' tornata a essere quello che
e': un'icona.

**L'ASTERISCO ESISTE NEI DATI E LO SCARICAVAMO GIA'.** Il file delle quotazioni ha sei fogli e due
contano: `Tutti` e **`Ceduti`** — sul sito la stessa cosa e' l'asterisco accanto al nome. Lukaku era
fra i ceduti su TUTT'E DUE i listoni. `parse_listone` leggeva entrambi i fogli e li FONDEVA, con una
buona ragione scritta nel suo docstring (un ceduto ha comunque giocato e i suoi voti vanno attribuiti)
e una conseguenza mai notata: la domanda «si puo' ancora comprare?» non stava in nessuna colonna.
Cura: `listone_quotes.sold`, scritto da `ratings`, letto da `snapshot`, con la migrazione additiva.
**E' un fatto per PIATTAFORMA** come il prezzo e il club (regola del 07/08, ora incontrata una terza
volta): sul listone Serie A sono ceduti **57** uomini, su quello EuroLeghe **79**, e sette di quelli —
Di Gregorio, Suzuki, El Aynaoui, Nkunku, Dia, David, Gutierrez — sono ceduti in Serie A e **comprabili
su euro**, perche' sono andati in un campionato che euro gioca. Non e' irreversibile: l'ultima lettura
decide, quindi chi rientra in `Tutti` torna comprabile (nessun `COALESCE`, che congelerebbe il primo
`1` — il difetto gia' pagato da `rosters.league`).

Effetto misurato, `SHEET_REVISION` 40: **36 righe fuori dal foglio Serie A** (Leao, Gimenez, Morata,
Lukaku, Buksa, Kuhn...), 36 dal mantra Serie A, **48** dal foglio euro; il bundle dell'app non porta
piu' Lukaku su nessuno dei tre.

**I due segnali che il foglio gia' consultava non potevano supplire**, ed e' la ragione per cui questo
canale serviva davvero: il TRASFERIMENTO al Fenerbahce e' entrato nel DB solo la sera del 03/09
(`first_seen`), e `_still_buyable` chiede comunque che la fonte lo VEDA in un club fuori perimetro —
cosa impossibile per chi va in un campionato che non leggiamo. L'ultima lettura utile lo dava al Napoli
il **10/08**, e il Napoli e' stato riletto ogni giorno fino al 03/09 senza di lui. Resta a verbale
l'item gia' aperto («`_still_buyable` deve leggere la DATA dell'avvistamento»): con l'asterisco non e'
piu' urgente, e la ragione per cui non lo si e' fatto stasera e' che il segnale automatico da solo
nomina **104 quotati su 590**, con Leao, David e Nkunku in cima.

**Le ICONCINE sulle righe, e un menu' per spegnerle** (sua richiesta, stessa sera). `ui-flags` sulla
riga della plancia, **due al massimo** perche' una riga e' alta 17px: il taglio e' in coda — dove
`marksFor` mette gia' i marchi in ordine di importanza — e quante ne restano fuori e' DETTO (`+N`),
perche' una riga che ne disegna due su cinque senza dirlo si legge come un uomo che ne ha due. Quali
disegnare lo decide `core/flag-prefs.ts`, una preferenza sola per tutta l'app (in `localStorage`, come
`view-state.ts` prescrive per «come si legge»), col menu' in barra: ogni voce porta la SUA icona col
suo inchiostro, piu' «tutti» e «nessuno». **Si tiene la lista degli SPENTI e non degli accesi**, cosi'
un marchio nuovo nasce acceso invece di essere spento in silenzio da una preferenza salvata mesi prima
— «vuoto = ignoto» applicato a una preferenza. Un test lega il menu' al vocabolario: se qualcuno
aggiunge un `PlayerFlag` e non lo mette in un gruppo, l'icona comparirebbe sulle righe senza un
interruttore.

Misurato in un browser vero, con un puntatore vero: 250 righe, **62 icone su 55 righe**; il bottone non
e' coperto (`elementFromPoint`); il menu' apre **23 voci** (21 marchi + le due vie); «nessuno» porta le
icone a **0**, «tutti» le riporta a 62, spegnere «Si infortuna spesso» le porta a **25**, e dopo un
RICARICAMENTO restano 25. Zero errori in console. Suite: 603 test app, 650 toolkit.

## 36. UNA DATA DI RIENTRO E' UN NUMERO: il riprezzo di chi torna a novembre (4 settembre 2026)

Dal caso McTominay, e dalle due richieste dell'operatore: «il suo infortunio non e' ancora
quantificabile con certezza, ma dovrebbe portarlo a rientrare a novembre o dicembre — questa
informazione l'ho recuperata leggendo articoli di giornale, come possiamo rendere questa operazione
automatica?», poi «per i calciatori il cui infortunio e' accertato (Yildiz, Thuram K., Kone' I.) non
mostrare anche l'icona "La stampa lo da' indisponibile", e' ridondante; e in base alla data di ritorno
ricalcola le partite attese e di conseguenza anche la massima offerta».

### 36.1 Il dato c'era, e nessun numero lo leggeva

**La domanda «come lo rendiamo automatico» aveva gia' una risposta in archivio.** Transfermarkt
pubblica, per uno spell ancora APERTO, la data di rientro STIMATA nella colonna «fino al»; il parser la
legge da sempre, `injuries.end_date` la porta, il bundle la esporta e l'app la STAMPAVA gia' nel
tooltip — «rientro previsto il ...» — senza che una sola cifra la usasse. Al 04/09/2026: **243 spell
aperti, 71 con una data**; sui quotati di Serie A, **27 su 44**. Quinta istanza della famiglia «il dato
c'era; nessuno lo ha chiesto», dopo i campetti, `availability` e l'asterisco.

Quello che davvero manca e' l'altra meta', ed e' misurata: la pagina *indisponibili* di
fantacalcio.it — che scarichiamo OGNI GIORNO su tutti e cinque i campionati — porta accanto a ogni nome
una riga di prosa che spesso dice quando l'uomo e' atteso. ⚠️ **IL NUMERO CHE SEGUIVA QUI ERA SBAGLIATO E
E' CORRETTO IN §38.1**: «42 su 45» veniva da una regex larga che accettava qualunque parola temporale, e
in quelle righe un mese sta quasi sempre sull'INFORTUNIO. Con la regola stretta sono **23 su 45**. Sono esattamente gli articoli di giornale che l'operatore stava leggendo a mano:

> **McTominay** — «...ha deciso di sottoporsi a un intervento di correzione tramite ablazione.
> **Rientro in campo da inizio ottobre.**»
> **Buongiorno** — «...sta recuperando lentamente, **ipotizziamo possa tornare arruolabile da meta'
> novembre**.»
> **Marianucci** — «Tempi di recupero da valutare, ma **rischia uno stop di almeno due mesi**.»

`upsert_availability` tiene lo `status` e butta la prosa. Il canale e' anche il PIU' FRESCO dei due:
`injuries` e' un archivio settimanale e sta fuori da `update --daily` (la camminata e' di ore), mentre
questa pagina e' un passo quotidiano. **Item aperto e non fatto stasera**: parsare la prosa in una data
(«inizio ottobre» -> 2026-10-01, «almeno due mesi» -> start + 60), archiviarla datata accanto allo
status, e darle la precedenza sulla stima di Transfermarkt quando e' piu' recente. Costo zero di rete.

Nota di merito sui due casi: per McTominay **le nostre due fonti dicono inizio ottobre** (TM 01/10, la
prosa «inizio ottobre») e non novembre-dicembre. Quello che l'operatore ricordava collima invece con
**Buongiorno** («meta' novembre»), che e' del suo stesso club e nella stessa lista.

### 36.2 Come si riprezza: si contano GIORNATE, e la quota e' lineare

`core/injury-window.ts`, letto dalla plancia. Tre decisioni, e due sono misure.

**Si contano le giornate del SUO club, mai i giorni.** Due mesi di novembre non valgono due mesi di
gennaio; il `calendar.json` del bundle porta ogni partita con la sua data, quindi le giornate perse
sono quelle vere. Un club che il calendario non conosce non si riprezza affatto — «vuoto = ignoto», e
una quota costruita su una media di campionato sarebbe un numero che nessuno ha misurato.

**Il denominatore parte da OGGI.** Le giornate gia' giocate le hanno perse tutti, quindi contarle
sconterebbe l'infortunato per una cosa che non e' sua. La quota e' «delle giornate che restano, quante
ne gioca», ed e' l'unica forma che si puo' moltiplicare per un `pv` di stagione intera senza spostare
la posizione relativa di nessun altro.

**E LA QUOTA E' LINEARE PERCHE' IL RODAGGIO NON ESISTE, che e' una misura e non una semplificazione.**
Il sospetto naturale — «appena rientrato giochera' meno per qualche giornata» — e' stato misurato sui
**2872 rientri** da spell di almeno 45 giorni che il layer per-partita copre (cinque campionati, dal
2019-20): quota di partite giocate nelle prime 5 giornate dopo il rientro **0,400**, contro **0,402**
nelle giornate 6-20 **dello stesso uomo**. Differenza appaiata **-0,002 +/- 0,006 (t -0,34)**. Quindi
nessun coefficiente: quello che perde sono le giornate prima del rientro, e basta.

Numeri veri, al 04/09/2026 (giornate rimaste: 36):

| uomo | rientro | perde | gioca | presenze piene | presenze attese |
|---|---|---|---|---|---|
| McTominay (Napoli) | 01/10 | 3 | 33 | 30,7 | 28,1 |
| Buongiorno (Napoli) | 31/10 | 7 | 29 | 22,4 | 18,0 |
| Yildiz (Juventus) | 25/11 | 10 | 26 | 27,3 | **19,7** |
| Thuram K. (Juventus) | 01/01/27 | 14 | 22 | 22,2 | 13,6 |
| Kone' I. (Sassuolo) | 03/01/27 | 15 | 21 | 24,4 | **14,2** |

### 36.3 La massima offerta: una QUOTA DI CALENDARIO non e' un'opinione

`points` e `pv` della riga sono ridotti UNA VOLTA SOLA, dove la riga nasce, cosi' l'ordine dentro lo
slot, la banda e i due numeri a schermo leggono tutti la stessa valutazione — e i due numeri accanto
(`+1,1` e `(20)`) continuano a SPIEGARE l'ordine invece di contraddirlo, che e' la regola che
l'operatore aveva imposto il 03/09.

Dentro `offerBand` la quota entra anche a parte, per una ragione precisa. La clamp a +/-35% esiste per
limitare quanto la NOSTRA opinione puo' muovere una banda misurata sullo SLOT; **un infortunio non e'
un'opinione, e' una quota di calendario**, quindi il pavimento della clamp scende fino a quella quota e
non oltre. Senza, a Thuram K. (0,61) e a Kone' I. (0,58) la banda direbbe «paga il 65%» a chi gioca il
58% delle giornate: un tetto misurato su uomini presenti tutta la stagione applicato a chi non c'e'.

**E il VINCOLO si spegne dove il numero arriva.** Il 03/09 «oggi non gioca» mandava l'uomo in fondo al
suo slot, e la ragione era scritta: «non sappiamo per quanto stara' fuori, quindi riprezzarlo sarebbe
inventare». Dove una data c'e', quella ragione cade — e il numero fa lo stesso lavoro meglio, perche'
dice DI QUANTO. I due non convivono mai su una riga (`outNow` e' falso quando `out` esiste), o lo stesso
fatto punirebbe l'uomo due volte; la riga di chi rientra non e' nemmeno **barrata**, perche' un uomo
cancellato e uno riprezzato sono due cose diverse e devono vedersi diverse. Il verdetto del lotto resta
un PREZZO — un'asta iniziale compra la stagione, non sabato — e la ragione comincia dalla finestra:
«Fuori fino al 25/11/2026: gioca 26 giornate su 36.»

### 36.4 Due icone per una notizia sola

`pressSaysTheSame`: dove il canale ufficiale gia' DISEGNA «Infortunio lungo in corso», il marchio della
stampa non si disegna. Deduplica **stretta**, infortunio contro infortunio: una squalifica o un dubbio
della vigilia restano, perche' non sono la stessa notizia. E se l'ufficiale non disegna niente — uno
spell aperto piu' corto di `LONG_INJURY_DAYS`, che e' il caso McTominay del 03/09 — la stampa resta:
altrimenti la riga perderebbe l'unico marchio che ha, e quello e' il motivo per cui il canale veloce
esiste.

### 36.5 Quello che questo numero NON sa, detto invece che nascosto in un decimale

La data e' una PREVISIONE della fonte, ed e' **ottimistica per costruzione**. Sui 35.792 spell chiusi in
archivio la durata residua CRESCE con quella gia' trascorsa: chi e' fuori da 7 giorni ne ha ancora 14 di
mediana, chi e' fuori da 30 ne ha 23, da 60 ne ha 38, da 120 ne ha **62**. Gli sforamenti sono la norma
e i rientri anticipati l'eccezione — quindi «rientro a inizio ottobre» detto di un uomo fermo da tre
giorni e' una frase piu' fragile della stessa frase detta di uno fermo da due mesi.

**Di QUANTO sia ottimistica non e' misurabile oggi**, e la ragione e' nostra: la riga di `injuries` e'
sostituita a ogni lettura (`INSERT OR REPLACE` su `(fc_id, start_date)`), quindi in archivio resta solo
l'esito e mai la previsione che era stata fatta. Diventa misurabile il giorno in cui la si data — la
forma di `fvm_history` e di `injuries.observed_on` — e fino ad allora **nessun margine di sicurezza
inventato entra nel codice**: un coefficiente scelto a occhio su una direzione nota e' un numero che
nessuno potra' smentire.

### 36.6 Verificato in un browser vero

`scripts/e2e-plancia-injury.mjs`, e l'aritmetica e' confrontata **contro il bundle** e non contro una
copia sua: l'arnese legge `injuries`, `calendar.json` e il FOGLIO dallo stesso server della pagina,
ricalcola le giornate giocabili e confronta col numero della card. L'uomo lo sceglie dal bundle e non da
una lista scritta a mano, o il banco morirebbe alla prossima guarigione leggendo «nessun problema».

Misurato: Kone' I. (Sassuolo, rientro 03/01/27) — card **14 su 38**, foglio 24,4 x 21/36 = **14,2**, un
marchio invece di due, riga non barrata; Yildiz (Juventus, 25/11) — card **20 su 38** (27,3 x 26/36 =
19,7) e **max offerta 60-74 cr**, dove senza la finestra la stessa aritmetica ne centrerebbe una novantina; un uomo sano sulla stessa
card legge 33 su 38, che e' il passo che distingue «il numero e' cambiato» da «la card non si e'
aggiornata». Zero errori in console; il banco dei portieri resta verde.

**Due difetti dell'arnese, corretti prima di fidarsene, e sono due regole di casa incontrate da capo.**
La prima asserzione ricavava le presenze piene DIVIDENDO il numero della card per la quota — cioe'
confrontava la card con se stessa e sarebbe passata qualunque cosa mostrasse: le presenze piene devono
venire dal FOGLIO. E il club veniva cercato dentro il testo della riga, che porta un nome e due numeri e
basta: rispondeva sempre «non conosco il suo club», cioe' l'arnese accusava la pagina del proprio
difetto. Il club si legge dal bundle (`fc_id` -> `fc_club_id` -> nome canonico), che e' il join che il
toolkit ha gia' risolto.

Suite: **617 test app** (39 file), tutti verdi.

## 37. LE ROSE SI SCRIVONO A MANO: azzerarle, e assegnare il lotto col doppio click (4 settembre 2026)

Tre richieste dell'operatore nella stessa serata — «aggiungi un tasto per resettare le rose», «quando
faccio doppio click sulla card di una squadra, assegna il calciatore estratto a quella squadra», «togli
il title dai calciatori in plancia, da' fastidio» — e le prime due sono **una cosa sola**: sono quello
che rende la plancia usabile alla SUA asta. Là l'urna la gira il software di qualcun altro e questo
pannello non è collegato (la connessione è un bottone, §33), quindi il tavolo inventato non è una demo
da guardare: è il **foglio su cui si segna l'asta vera**. E un foglio che parte con un terzo dell'asta
già giocata da un fixture (`DEMO_PROGRESS` 0,35) non serve a niente finché non lo si può azzerare.

**QUELLO CHE SI AZZERA SONO LE ROSE, NON IL REGOLAMENTO.** `AuctionFeed.emptySquads` toglie i pick e
lascia in piedi sedie, budget, posti e le dieci etichette: sono le impostazioni della lega, e
riscriverle sarebbe un'altra funzione con un altro nome. Dietro una conferma, perché a metà asta quel
tasto butta via tutto quello che l'operatore ha segnato fin lì, e la conferma DICE cosa tocca e cosa no.
Nessun tooltip sul tasto: tooltip e popconfirm sullo stesso bottone sono due overlay e il primo copre i
tasti del secondo — la misura del 20/08 sugli imbuti della tabella, applicata prima di pagarla di nuovo.

**IL PREZZO NON HA UN VALORE DI CORTESIA, ed è la sola regola nuova di questa serata.** Zero vuol dire
«nessuno ha ancora offerto», non «un credito»: i crediti di ogni rosa sono la quantità su cui poggiano
tutti i tetti di questa pagina (la banda, le mani alzate, l'alternativa), quindi assegnare a un prezzo
che nessuno ha scritto sarebbe **inventare un acquisto** e falsare ogni numero sotto. Si rifiuta, e si
dice perché. Gli altri due rifiuti sono del regolamento e non miei — un reparto già completo, una borsa
che non arriva — perché un doppio click è un gesto grosso e un acquisto impossibile lasciato passare
darebbe a una rosa ventisei posti o crediti negativi, cioè un tavolo che non esiste.

**E un rifiuto muto è indistinguibile da un gesto rotto**, quindi ognuno dei tre scrive la sua ragione
nell'avviso della pagina, che da oggi si chiude (`nzCloseable`): quel canale portava solo guasti di
costruzione, adesso porta anche un no a un gesto, e un no non deve restare a schermo per sempre.
Simmetricamente, l'assegnazione riuscita **svuota il lotto** — l'uomo non è più nell'urna, e lasciarlo
«in asta» farebbe dire due cose diverse alla stessa riga, perché lo stato del lotto viene letto prima di
quello del proprietario.

**Il confine con l'asta vera è lo stesso di sempre, e vale per tutt'e due i gesti**: si scrive solo sul
tavolo inventato. I pick di una sessione vera sono del banditore, la prima riga in arrivo cancellerebbe
quello che scrivessimo noi, e nel frattempo il pannello mostrerebbe una rosa che al tavolo non esiste.
La guardia sta nel FEED (una definizione, non una condizione ripetuta in due viste) e l'interfaccia si
limita a non promettere quello che non può fare: il cursore e il tooltip cambiano solo dove il gesto
funziona, mentre il gesto arriva comunque allo store, che è l'unico a saper dire perché no.

**IL `title` NATIVO SE N'È ANDATO, e con lui le due funzioni che lo scrivevano.** Su 250 righe alte
diciassette pixel il tooltip del browser spuntava sotto il puntatore — cioè esattamente dove si sta
leggendo — e copriva le righe vicine mentre si scorre un reparto. Quello che diceva non è perso e non è
stato riscritto altrove: il prezzo e la banda stanno sulla **card** che il click apre da sé (§36 della
sessione parallela), e l'alternativa è l'**evidenziazione all'hover**, gli stessi due uomini mostrati
dove vivono. Due canali per una frase sono come una riga finisce per dirne due versioni.

**MISURATO IN UN BROWSER VERO, perché un doppio click è un gesto**: `scripts/e2e-plancia-award.mjs`,
puntatore CDP con `clickCount` 1 e 2 alle coordinate che il browser dichiara. Dopo l'azzeramento: 10
rose su 10 a **1000 cr** e **3·8·8·6**, avanzamento **P 0/30 · D 0/80 · C 0/80 · A 0/60**, **0** righe
con la barra di un proprietario; **0** attributi `title` su **250** righe; doppio click a prezzo zero →
nessun acquisto e l'avviso che dice perché; prezzo 45 scritto nella riga del lotto → doppio click → la
rosa paga **45**, ha **un** posto in meno nel ruolo del lotto, il lotto è vuoto e la riga dell'uomo porta
la barra del suo colore. Zero errori in console, e il banco dei portieri resta verde. Suite: **621 test
app** (39 file).

**Due lezioni dall'arnese, tutt'e due già scritte in questo repository e incontrate di nuovo.** Le
coordinate del campo del prezzo erano lette PRIMA del rifiuto, e il rifiuto aggiunge un avviso che
sposta la riga del lotto più in basso: il banco cliccava dove il campo ERA e accusava la pagina di non
prendere il prezzo — un difetto inventato dallo strumento. E la cura non è solo rileggerle: è che
«scrivo il prezzo» e «il doppio click assegna» sono **due passi separati**, o un passo che misura due
incognite attribuisce il guasto a quella sbagliata (20/08, il varco in coda della tabella).

**E un difetto trovato nei test di casa, che vale oltre questa feature: un fixture condiviso che un
altro test MUTA non è un fixture.** `applyStreamEvent(mirror, 'put', '/', STATE)` restituisce l'oggetto
stesso, e i `put` successivi scrivevano un terzo pick dentro lo `STATE` dichiarato in cima al file: ogni
test eseguito dopo vedeva un tavolo diverso da quello che il file dichiara. Se ne sono accorti i due
test nuovi (leggevano 3 pick su un fixture che ne dichiara 2). Curato dai due lati — quel test lavora su
una copia, e i test nuovi scrivono i propri pick invece di ereditarli.

**Due sessioni sullo stesso albero, ancora**, e stavolta l'altra ha committato anche questa metà
(21e7d2e, il cui messaggio descrive solo la sua): il codice di `awardByHand`, `resetSquads` e del doppio
click è dentro quel commit senza esservi nominato. Va detto qui, perché è esattamente il motivo per cui
la regola esiste — una storia che non dice cosa porta non si può bisezionare. L'albero combinato è
comunque verde e misurato: 621 test e i due banchi e2e della plancia.

## 37. PRUDENZA, ESCLUSIONE, TETTO: quanto vale davvero un uomo che non c'e' (4 settembre 2026)

Quattro richieste dell'operatore nella stessa sera, tutte sullo stesso uomo e tutte con la stessa
forma — una direzione giusta, che il codice deve tradurre in un numero senza fingere di averlo
misurato. §36 aveva riprezzato le giornate perse; qui si prezza il RISCHIO che la data sia sbagliata.

> «Se la data di rientro e' "ottimistica" noi dobbiamo valutare il rientro effettivo, quindi dobbiamo
> togliere piu' giorni di quelli dichiarati.» · «Nella nostra plancia non dobbiamo inserire calciatori
> che tornano a gennaio.» · «Prima che torni in forma ci vorra' qualche partita e spendere un massimo
> di 65 crediti mi sembra tanto ... fino a 20 o 30 crediti si possono impegnare per una scommessa del
> genere, non di piu'.» · «Troviamo un modo per penalizzare McTominay e Orsolini, con il loro
> infortunio non possono essere da primo slot.»

### 37.1 Il margine di prudenza: `RETURN_SLIP` = 0,25, DICHIARATO

La direzione e' misurata e non e' in discussione: sui **35.792 spell chiusi** in archivio la durata
residua CRESCE con quella gia' trascorsa — fuori da 7 giorni ne restano 14 di mediana, da 30 ne
restano 23, da 60 ne restano 38, da 120 ne restano **62**. Gli sforamenti sono la norma.

L'ENTITA' no, e non lo puo' essere: la riga di `injuries` e' sostituita a ogni lettura, quindi in
archivio resta l'esito e mai la stima che era stata fatta. **Quindi il margine e' dichiarato**, come
`board_rulings.json` e le soglie di visualizzazione, e si cambia in una riga. Per quanto si puo'
argomentare senza fingere una misura: nello stesso archivio la durata residua MEDIA e' **1,27-2,20
volte la MEDIANA**, e una previsione medica si comporta come una mediana — se la data non sapesse
niente della diagnosi il margine implicito sarebbe fra +27% e +120%, e la data la diagnosi la sa,
quindi si sta al pavimento di quella banda.

**PROPORZIONALE all'assenza che RESTA**, e questo lo decide l'azzardo crescente: uno dato per fuori tre
settimane e uno per fuori quattro mesi non sbagliano dello stesso numero di giorni. Su Yildiz fa
esattamente quello che l'operatore ha chiesto a voce: dichiarato **25/11**, prudente **15/12**.

La riga porta TUTT'E DUE le date, sempre. Una sola direbbe una bugia in un senso o nell'altro:
stampare la prudente attribuirebbe alla fonte una data che non ha scritto, stampare la dichiarata
farebbe leggere un numero di giornate che non torna con quella data.

### 37.2 «Non inserire chi torna a gennaio»: `MIN_PLAY_SHARE` = 0,60

La sua frase e' un MESE, e un mese non e' confrontabile fra una stagione e l'altra ne' fra un'asta di
agosto e una di novembre — «una soglia assoluta non si confronta fra budget diversi», applicata al
calendario. Quindi la regola vive nell'unita' invariante, la quota di giornate rimaste che giocherebbe.

**0,60 perche' e' il punto che NON dipende dal margine.** Sui 27 quotati di Serie A con una data di
rientro al 04/09/2026, la soglia 0,60 lascia fuori esattamente i due che rientrano nell'anno nuovo
(**Kone' I.** 03/01, **Thuram K.** 01/01) e tiene dentro il primo di dicembre (Yildiz) per **ogni**
margine fra 0 e 40%. La soglia 0,65 invece cambia risposta col margine — a 0,25 si porta via anche
Yildiz. *Fra due soglie che dicono la stessa cosa oggi, si sceglie quella che non dipende da un'altra
costante.*

**Esce la RIGA, non il POSTO.** Il numero di slot e' un fatto sul mercato — un rango diviso il numero
di squadre — e la stanza quei nomi li compra ancora: toglierli dalla graduatoria sposterebbe tutti di
un posto e la plancia parlerebbe di slot diversi da quelli su cui la scala e' misurata. Quindi restano
nel rango, il blocco ha nove righe invece di dieci, e **lo dice**: il conto in barra («2 fuori lista»),
i nomi nel suo tooltip, la ragione sul blocco. La mediana del PREZZO li conta ancora (risponde a
«quanto paga la stanza per questo slot»), quella dei PUNTI no (risponde a «quanto vale il medio di
quelli che posso comprare»): due mediane, due domande.

### 37.3 «Non da primo slot»: una DEMOZIONE di un gradino, non una costante nuova

La quota di calendario da sola non tocca McTominay e Orsolini — perdono tre giornate su 36, l'8% —
perche' risponde a un'altra domanda: **quante giornate perde** e' un conto, **quanto e' solida la
data** e' un rischio, e i due non si sommano dentro una cifra sola.

`HURT_SLOT_STEP` = 1: chi ha un infortunio aperto **oggi** legge il gradino di sotto della scala. E' la
sua frase detta nella valuta che la scala parla gia', ed e' l'unica forma disponibile che non
introduca un numero che nessuno ha misurato. Costa quanto vale il gradino — molto in cima (C1 0,107 ->
C2 0,048) e quasi niente in fondo, dove il prezzo e' gia' piatto — che e' anche il comportamento
giusto: un rischio del genere si paga sui top. **Non tocca l'ORDINE dentro lo slot**, che resta il
valore atteso: quello e' misurato (§25) e un gradino binario lo rovinerebbe.

Scatta su «oggi non gioca», **con o senza una data**. Legarla alla quota avrebbe lasciato il tetto
pieno del primo slot proprio a chi non dice quando torna — il premio all'ignoranza, cioe' il difetto
opposto a quello che si stava curando.

### 37.4 Il tetto della scommessa: le sue due cifre, `BET_SHARE` = 0,70

Sotto il 70% delle giornate rimaste un acquisto e' una scommessa, e una scommessa ha un tetto suo:
**20-30 crediti su 1000**, che sono le sue due cifre tenute come QUOTE del budget (§27.2, verificato a
500 · 1000 · 2000). Abbassa e non alza mai: chi vale gia' meno resta dov'e'.

0,70 e' il centro di un VUOTO nell'archivio piu' che una scelta: fra 0,64 (Yildiz col margine) e 0,75
(Buongiorno, Pessina, Ekhator) non c'e' nessuno, quindi qualunque soglia in mezzo separa gli stessi
uomini e questa non dipende dal margine.

### 37.5 «Prima che torni in forma ci vorra' qualche partita»: vero, misurato, e vale l'1,3%

L'obiezione e' giusta e la prima misura di §36 rispondeva alla domanda sbagliata. Sono TRE quantita'
diverse e vanno misurate a parte, ognuna contro il suo null — **lo stesso uomo, piu' avanti nella
stessa stagione**:

| cosa | prime presenze dopo il rientro | dopo | differenza appaiata |
|---|---|---|---|
| **SE gioca** (quota di partite del club, n=2872) | 0,400 | 0,402 | **−0,002 ± 0,006** (t −0,34) |
| **QUANTO gioca** (minuti a presenza, n=2043) | 53,0' | 61,7' | **−8,72' ± 0,43** (t −20,1) |
| **prende il VOTO** (quota di giornate, Serie A, n=637) | 0,872 | 0,908 | **−0,037 ± 0,007** (t −4,98) |
| **quanto rende** (voto base, n=1097) | 5,917 | 5,953 | −0,036 ± 0,006 (t −6,13) |
| **bonus a presenza** (n=2043) | 0,287 | 0,349 | −0,062 ± 0,011 (t −5,75) |

Il rodaggio **c'e', ed e' nei MINUTI**: alla prima presenza gioca **20,2 minuti in meno** (t −29,4), e
l'effetto si spegne lentamente (−15,3' su due, −12,2' su tre, −5,9' ancora sull'ottava). Alla prima
giornata dopo il rientro prende il voto nell'**80,8% dei casi contro il 90,8%**.

**Ma sommato in fantapunti vale circa 1,8 su ~140, cioe' l'1,3%** — 0,49 fra voto base e bonus sulle
prime cinque presenze, piu' ~0,19 giornate di voto mancate. Cinque centesimi di punto a giornata. **Il
rodaggio esiste e NON e' quello che porta un uomo da 65 crediti a 30**: quello e' un'avversione al
rischio, ed e' sua da dichiarare. Tenerli separati e' il punto — *un termine misurato che vale l'1% non
deve prendersi il merito di una decisione che ne vale il 60%.* Per questo il rodaggio e' **misurato e
NON implementato**: una costante che sposta un uomo dell'1,3% mentre il tetto dichiarato lo sposta del
60% servirebbe solo a far sembrare il tetto piu' preciso di quanto sia. La ragione per cui il gioco lo
assorbe e' nel suo regolamento: il fantavoto e' dominato dal VOTO, che si prende giocando, non dai
minuti.

### 37.6 «Mora o Pulisic con meno di 20 partite previste»: due cause, e una sola e' sul calciatore

| uomo | presenze | base | confidenza | cos'e' quel numero |
|---|---|---|---|---|
| **Pulisic** | 19,1 | `core` | 1,00 | una MISURA: lui le partite le salta davvero |
| **Kolo Muani** | 19,6 | `older` | 0,85 | l'ultima stagione misurata e' di DUE anni fa (euro) |
| **Molina N.** | 18,9 | `older` | 0,55 | l'ultima stagione misurata e' del **2021-22**, cinque anni fa |
| **Mora** | 12,6 | `anchor` | 0,50 | «nothing measured anywhere»: e' la COSTANTE del ruolo |

Tre dei quattro non sono previsioni su di loro: sono «vuoto = ignoto» che prende la forma di un numero
basso. `est_confidence` viaggia sul foglio da sempre e **ogni altro lettore la applica** (`worthOf`,
`gainOf`: «la penalita' moltiplica il numero perche' l'indeterminatezza e' un fatto sul NUMERO») — la
plancia era l'unica a ignorarla, quindi offriva su una costante con la stessa autorita' di una misura.
Due letture dello stesso foglio che davano a un uomo due valutazioni.

Adesso entra nel TETTO: **Mora da 70 a 35 crediti**, Pulisic invariato a 79 perche' il suo numero e'
misurato. **Nel tetto e non nell'ordine**, ed e' una decisione: l'ordine dentro lo slot e' il valore
atteso, e i due numeri della riga devono SPIEGARLO (sua regola, 03/09) — metterci una confidenza li
farebbe contraddire. L'incertezza limita quanto sono disposto a ESPORMI, che e' la stessa forma del
tetto della scommessa.

E la risposta alla domanda «come mai sono nel primo slot»: **perche' ce li mette il MERCATO**. Lo slot
e' il rango per FVM, che e' la coordinata della stanza; l'ordine dentro e' nostro, ed e' li' che la
continuita' e' gia' premiata — dentro C1, Paz N. (30,9 presenze) sta primo con un tetto di 131 e
Pulisic (19,1) penultimo con 79.

### 37.7 Cosa si vede a schermo, misurato in un browser vero

`scripts/e2e-plancia-injury.mjs`, tutto confrontato col bundle (foglio + calendario letti dallo stesso
server della pagina) e col MARGINE letto dalla pagina invece che ricopiato:

| uomo | dichiarato | prudente | presenze | max offerta | perche' |
|---|---|---|---|---|---|
| McTominay | 01/10 | 08/10 | 30,7 → **28** | 128 → **49-60** | demozione C1 → C2 |
| Orsolini | 22/09 | 27/09 | 27,6 → **25** | 112 → **43-52** | demozione |
| Yildiz | 25/11 | **15/12** | 27,3 → **17** | ~90 → **20-30** | tetto dichiarato della scommessa |
| Thuram K. | 01/01 | — | — | — | **fuori lista** |
| Kone' I. | 03/01 | — | — | — | **fuori lista** |

«2 fuori lista» in barra, 2 sotto la soglia sul foglio, **0 disegnati**. Suite: **632 test app**, banco
portieri verde.

**Tre difetti dell'ARNESE trovati e corretti prima di fidarsene, e tutti e tre dicevano «la pagina e'
rotta» su una pagina che non lo era.** Cercava la nota col COLORE (`.text-danger`) e leggeva vuoto su
una card che la nota ce l'ha eccome — *il colore e' una proprieta' del tema, il testo e' quello che
l'operatore legge*. Leggeva il titolo del tooltip da un ATTRIBUTO, che con `[nzTooltipTitle]` non
esiste: un tooltip si verifica aprendolo, con un hover vero. E contava gli esclusi del BUNDLE (18)
contro quelli della pastiglia (2), che sono due popolazioni e non due risposte — il bundle porta gli
infortuni di cinque campionati e la plancia disegna un listone solo; la forma che regge e' l'asserzione
dal lato dello schermo, «nessuna riga disegnata e' di un uomo sotto la soglia».

### 37.8 Resta aperto: la data di rientro dalla PROSA

«Se poi riusciamo a essere piu' precisi e a recuperare la data di rientro e' meglio.» Il canale e'
identificato e misurato (§36.1) e non e' ancora scritto: la pagina *indisponibili* di fantacalcio.it,
che scarichiamo ogni giorno, porta il rientro in prosa per **42 voci su 45** in Serie A e 78 su 94 su
euro, e `upsert_availability` la scarta. E' anche il canale piu' FRESCO — `injuries` e' un archivio
settimanale, fuori da `update --daily`. Costo zero di rete: parsare la frase in una data, archiviarla
datata accanto allo status, darle la precedenza su Transfermarkt quando e' piu' recente.

## 38. LA DATA DI RIENTRO DALLA PROSA: gli articoli che leggeva a mano (4 settembre 2026)

«Ok lavora sul toolkit», dopo l'item lasciato aperto in §37.8. Il canale e' scritto per intero: parser
puro nel toolkit, tre colonne su `availability`, migrazione, export, bundle, e la precedenza fra le due
fonti in un posto solo nell'app. `fc_site.parse_return`, spec «Novita' v9.71».

### 38.1 Prima di tutto, una CORREZIONE a un numero che avevo pubblicato

§36.1 diceva «42 voci su 45 in Serie A contengono l'indicazione del rientro». **Falso, ed era un difetto
di misura mio**: quella conta veniva da una regex larga che accettava qualunque parola temporale, e in
quelle righe un nome di mese sta quasi sempre sull'INFORTUNIO e non sul rientro («KO l'8 agosto»,
«operato il 3 settembre»). Con la regola stretta - un verbo di rientro che governa un «da/dal/dalla» che
governa un'ancora di mese - sono **23 su 45** in Serie A e **14 su 94** su euro. La meta', non il 93%.
*Un numero che sembra troppo bello e' il primo da rimisurare, e questo lo era.*

### 38.2 La regola e' stretta perche' le trappole sono nella stessa pagina

Una data sbagliata e' peggio di nessuna data: qui alimenta una valutazione. Tutte e tre queste frasi
portano un'ancora di mese e nessuna e' un rientro, e stavano tutte sulla pagina del 03/09/2026:

| frase | cos'e' davvero |
|---|---|
| «il difensore **ai box da inizio settembre** per una lesione...» (Cabal) | l'INIZIO dell'assenza |
| «**operato a fine giugno** per una lesione...» (Hien) | il giorno dell'OPERAZIONE |
| «**a meta' settembre verra' sottoposto** a nuovi esami» (Ekhator) | il giorno di un CONTROLLO |

Un lettore piu' largo avrebbe filato la prima come «rientra a inizio settembre», che e' **l'opposto** di
quello che la pagina dice. Ognuna delle tre ha il suo test, e Cabal e Hien hanno anche la frase VERA piu'
avanti nella stessa riga, quindi il passo verifica che il parser scelga quella giusta e non la prima.

**Le DURATE sono rifiutate**, non dimenticate: «stop di almeno due mesi» si conta dall'infortunio, e la
prosa l'infortunio lo data solo a volte - una durata ancorata a un giorno che non sappiamo e' esattamente
il modo in cui si inventa una data. «Vuoto = ignoto».

**«Stagione finita» viaggia SENZA data**, ed e' la frase piu' decisiva che la pagina possa portare:
`return_basis = 'season_over'`, `expected_return` NULL. Nell'app diventa una finestra COMPLETA (perde
tutte le giornate che restano, quota 0) e la soglia della plancia lo lascia fuori da se'. Mettere qui
l'ultima giornata del calendario avrebbe stampato una precisione che nessuno ha scritto.

### 38.3 Le convenzioni sono dichiarate, e la prudenza sta da un'altra parte

`MONTH_PART_DAY`: **inizio 5 · meta' 15 · fine 25 · prima meta' 8 · seconda meta' 23**. I punti medi dei
terzi e delle meta' di un mese, e il punto MEDIO e non il primo giorno perche' «inizio ottobre» e' una
banda e la lettura neutra di una banda e' il suo centro. Il pessimismo vive in `RETURN_SLIP` (§37.1), che
sta nell'app ed e' dichiarato la': **una seconda prudenza qui conterebbe la stessa paura due volte.**

L'ANNO lo decide il giorno della LETTURA - la frase nomina un mese e mai un anno, quindi «gennaio» letto
a settembre e' l'anno prossimo. Stessa regola di tutto il resto di questo modulo.

### 38.4 Due fonti per un fatto solo: vince la LETTURA PIU' RECENTE

`PlayerStatus.openInjury` e' l'unico posto in cui la scelta si fa. La regola non e' «la prosa e' meglio»,
perche' **non lo e'**: sui 15 uomini che entrambe le fonti datano, la differenza mediana e' **+1 giorno** e
10 su 15 stanno dentro una settimana (due fonti indipendenti, nessuna ragione di concordare, concordi).
Si scelgono per FRESCHEZZA, e la freschezza si confronta sulle DATE dell'osservazione e non ricordandosi
quale canale gira piu' spesso: uno e' un archivio settimanale e l'altro una pagina quotidiana, ma dopo un
`rebuild` sono lo stesso giorno. Per questo `injuries.observed_on` doveva arrivare fino all'app
(`Spell.observedOn`) - senza, la regola sarebbe stata un'assunzione travestita da confronto.

E **una lettura senza data non scavalca una che ce l'ha** (la regola del 20/08 su `load_reference`, dal
lato del lettore). Quello che la prosa aggiunge non e' un'opinione migliore, sono **8 uomini su 23 che
Transfermarkt non data affatto** (Boloca, Cabal, Cataldi, Chakvetadze, Giovane, Moreno M., Venturino,
Walukiewicz) e la freschezza.

### 38.5 Quattro cose che sono costate qualcosa

**LA «A» ACCENTATA SI SCRIVE IN DUE MODI, e per una regex sono stringhe diverse.** Trovato scrivendo il
test: la pagina vera usa la forma precomposta (`U+00E0`), il caso scritto a mano era venuto decomposto
(`a` + accento combinante), e lo stesso parser leggeva «meta' novembre» su una e niente sull'altra. Cura:
`unicodedata.normalize("NFC")` prima di guardare, e il test tiene le due forme accanto. *Una fonte che
cambiasse forma spegnerebbe il canale in silenzio* - stessa famiglia del tag rinominato che il 01/09 ha
azzerato la lista degli infortunati.

**UN CANALE NUOVO CHE FINISCE A ZERO IN SILENZIO E' IL DIFETTO DI QUEL GIORNO**, quindi la corsa lo
STAMPA: `upsert_availability` restituisce anche quante date ha trovato e il log dice «23 con una data di
rientro dalla prosa». Il conteggio e' nella firma e non calcolato dal chiamante, perche' due conti dello
stesso numero finiscono per dirne due.

**UNA COLONNA NUOVA VUOLE LA CACHE RIGIOCATA, e non tutta.** `reingest_from_cache(pages=...)` - la forma
che `positions` aveva gia' - rigioca solo gli indisponibili: rileggere i probabili per riempire una
colonna di `availability` sarebbe qualche migliaio di righe riscritte per niente. Backfill offline, zero
richieste: **27 snapshot dal 19/08 al 03/09, 186 date e 11 righe «stagione finita»**.

**LA NOTA DEVE DIRE QUALE FONTE, e l'ha trovato il banco.** Con due fonti «La fonte dice il 5 ottobre»
non dice niente: la card ora scrive «La stampa di oggi dice» o «L'archivio infortuni dice», e
`OutWindow.source` porta quel fatto invece di farlo dedurre. Il banco lo ha scoperto accusando la card di
attribuire alla fonte una data sbagliata - la data era giusta, era dell'ALTRA fonte, e il difetto era che
la frase non lo diceva.

### 38.6 Cosa cambia a schermo, misurato

McTominay: la prosa dice **05/10** dove l'archivio diceva 01/10, la lettura e' dello stesso giorno e la
stampa vince sul pari - presenze attese **28 → 27**, max offerta **49-60 → 47-58 crediti**. Yildiz: le due
fonti dicono la stessa data (25/11) e non si muove niente, che e' il caso normale e va detto. Suite:
**635 test app, 665 toolkit**, banco portieri e banco infortuni verdi.

### 38.7 Una decisione che e' sua: la PROSA viaggia nel bundle

`note` e' la riga editoriale di fantacalcio.it, verbatim, e ora sta in `data/export/` - cioe' nel
pacchetto che va sul sito PUBBLICO di GitHub Pages. Non e' diversa in natura dal resto del bundle (che e'
contenuto a pagamento, e pubblicarlo e' una sua decisione del 09/08/2026 presa due volte), ma e' TESTO
editoriale e non un numero, il che e' un'altra cosa dal punto di vista di chi lo ha scritto. **Se
preferisce non pubblicarla, la cura e' una riga**: togliere `note` dalle colonne esportate e lasciare
viaggiare solo `expected_return` e `return_basis` - il prezzo e' il tooltip, che perde la diagnosi e le
sfumature («ipotizziamo», «da valutare») che una data non sa dire.

## 39. DUE TAGLI DELLA PLANCIA: slot MERCATO e slot PERSONALI (4 settembre 2026)

Sua richiesta: «vorrei un tasto che mi permetta di cambiare visualizzazione da slot MERCATO a slot
PERSONALI. a) slot MERCATO è la visualizzazione corrente. b) quando seleziono slot PERSONALI invece mi
devi ripopolare gli slot ordinando i calciatori per offerta massima».

Fatto: `core/plancia.regroupByOffer` + `PlanciaStore.slotView` / `viewBlocks` / `viewLotBlockId`, il
tasto in barra (`nz-radio-group`, i due nomi sono i suoi), e l'intestazione del blocco che dichiara di
chi è il taglio. Banco: `scripts/e2e-plancia-slots.mjs`, sette passi, verde.

### 39.1 Il TETTO non si ricalcola sulla griglia nuova, ed è una decisione

La scala delle offerte è una quota del budget per (ruolo, **slot**) misurata con lo slot definito come
un rango **PER PREZZO** (§19.3 del simulatore). Rileggerla su un rango costruito sulla nostra offerta
sarebbe due difetti in uno: **un parametro applicato fuori dalla popolazione su cui è stato misurato**,
e una **circolarità** — l'offerta decide lo slot che decide l'offerta. Quindi il taglio personale è un
RIORDINO dei tetti che il mercato ha già prodotto: ogni uomo si tiene la banda che la misura gli ha
dato, e la card continua a nominare lo slot su cui quella banda è stata letta.

Conseguenza da leggere così e non altrimenti: sulla griglia personale un uomo può stare in `D1` con un
tetto letto sul gradino di `D3`. È voluto. Quello che la griglia personale risponde è «di tutti i
difensori, quali sono i dieci che pagherei di più», che a estrazione libera è la domanda che decide se
il nome appena uscito è uno dei miei; non risponde «quanto lo pago», che è la banda e non si muove.

### 39.2 UN'ESCLUSIONE CHIESTA E RITIRATA IN UN'ORA, e la causa era l'INCHIOSTRO

La sequenza vale più della regola, perché è il modo in cui si è trovato il difetto vero.

1. «Negli slot personali devi anche toglirmi calciatori come Bernabe e Casadei». Misurato prima di
   scegliere il predicato: quei due, e i **dodici** che il tavolo dichiarato porta, sono esattamente le
   righe che la plancia **barrava** — `outNow`, ciòè «oggi non gioca e nessuna delle due fonti dice fino
   a quando» (Bernabè e Casadei dalla pagina *indisponibili* riletta il 03/09, Cambiaso e Gabbia da uno
   spell aperto **senza** `end_date`). Implementato con quel predicato: nessuna costante nuova.
2. Guardando il risultato l'ha **ritirata**: «"chi oggi non gioca" non è molto rilevante ai fini del
   mercato, è solo una gara saltata, mostrarlo addirittura barrato mi ha tratto in inganno».

**La causa stava a monte della lista: stava nell'inchiostro.** Un fatto che vale UNA giornata su 36 era
disegnato come una **cancellazione**, quindi chiedere di togliere quei nomi era la conseguenza
ragionevole di quello che lo schermo diceva. *Quando l'operatore chiede di eliminare qualcosa, vale la
pena chiedersi se sia la cosa a essere sbagliata o il modo in cui la si mostra* — e qui la risposta era
la seconda, quindi la cura giusta non era la sua richiesta letterale ma quello che la aveva provocata.

Cosa resta, e sono tre cose che si tengono in piedi insieme:

- **`outNow` non sposta e non tinge più niente**, su nessuna delle due griglie. Il fatto lo porta
  l'ICONA della riga (che ha la sua ragione nel tooltip) e la card. Anche il gradino «in fondo al suo
  slot» del 03/09 è andato via **con** l'inchiostro e non separatamente: senza il barrato quel gradino
  sarebbe stato un riordino MUTO, che è il difetto che questa pagina non fa per principio.
- **Il tetto d'offerta invece scende ancora di un gradino** (`HURT_SLOT_STEP`), perché chi non dice
  quando torna non può avere il tetto pieno del suo slot — e lì la penalità produce un **numero**, che
  la riga mostra, invece di un decreto che nessuno può leggere. È la distinzione del §36 applicata a se
  stessa: si vincola solo dove non si ha un numero.
- **La pastiglia in barra resta un CONTEGGIO** («12 saltano la prossima», in tono neutro e non nel rosso,
  che ora è l'inchiostro del barrato), e il suo tooltip dichiara di non aver spostato niente: *una barra
  che promette un ordinamento che non c'è più è peggio di una barra che non c'è.*

### 39.2-bis IL BARRATO È L'INFORTUNATO DI LUNGA DATA

Sua istruzione, subito dopo: «lo stile barrato utilizziamolo per gli infortunati di lunga data». Un
inchiostro si sceglie sulla **taglia del fatto** e non sulla sua freschezza — e quello che lo aveva
tratto in inganno era esattamente uno scarto di taglia.

La soglia è quella che c'è già (`player-status.LONG_INJURY_DAYS` = 45), e non è un prestito da
un'altra domanda: è la stessa domanda. `injuryMark` decide da sempre se disegnare l'icona «infortunio
lungo in corso», quindi **un'icona e un inchiostro per una frase sola, e un lettore solo**
(`PlayerStatus.longInjury`) — due definizioni di «è fuori da tanto» darebbero a un uomo due risposte, e
la prima volta che qualcuno se ne accorge è a un tavolo.

Misurato sul tavolo dichiarato: le righe barrate passano da **12 a 2** — Buongiorno e Yildiz, gli unici
due con uno spell aperto da 45 giorni o più, e sono anche gli unici due la cui stagione è davvero
compromessa (Yildiz: rientro 25/11, 17 presenze attese su 38). Il barrato **non riordina e non riprezza**
niente da sé: quei due hanno una data, quindi `points` e `pv` portano già le giornate perse e scendono
per conto loro.

E i due rossi ora dicono due cose diverse e la legenda le dichiara entrambe: **barrato** = infortunato da
45 giorni o più; **rosso senza taglio** = torna a una data, le giornate che perde sono già nei suoi
numeri. Chi salta solo la prossima non è in legenda perché non ha un inchiostro: ha un'icona.

**E un'asserzione del banco è stata GIRATA invece che cancellata.** `e2e-plancia-injury` pretendeva che un
uomo riprezzato **non** fosse barrato — giusto quando il barrato era un vincolo, perché allora lo stesso
fatto lo puniva due volte. Ora il barrato è un'etichetta di taglia, e quell'uomo (fuori da mesi, con una
data) è esattamente chi deve portarla: il difetto è il contrario, e il banco asserisce quello. *Quando
un inchiostro cambia significato, le asserzioni scritte sul significato vecchio non si cancellano: si
rileggono, e alcune si invertono.*

### 39.3 L'intestazione porta la mediana della coordinata su cui ha TAGLIATO

Tre cifre in nove pixel, quindi una sola delle due mediane: sul mercato il prezzo (che è anche ciò che
rende quei dieci uomini equivalenti per la stanza), sulla griglia personale la **mia max offerta**. La
mediana del prezzo resterebbe un numero vero che non descrive il blocco che sta sopra. E l'etichetta del
blocco è nel primario invece che nel muto, col tooltip che porta la frase intera («il tuo D1: i 10 per
cui offrirei di più dopo i precedenti»): **un blocco chiamato `D1` che porta due insiemi diversi a
seconda di uno stato invisibile si legge come un tabellone rotto**, ed è il difetto che questa pagina si
è già scritta due volte.

### 39.4 Cosa il taglio NON fa, detto invece di lasciato dedurre

- **Non promuove la coda.** Ritaglia gli uomini che la mappa già porta: chi sta sotto i 25 slot non ha
  una banda affatto, e prezzarlo qui vorrebbe dire leggergli un gradino della scala che per lui non
  esiste.
- **Non riordina niente di misurato.** Verdetto del lotto, alternativa, banda, evidenziazione all'hover
  e slot sulla card leggono `blocks()`, che resta la griglia del mercato. `viewLotBlockId` esiste solo
  perché l'evidenziazione deve trovare il lotto sulla griglia che si sta guardando.
- **Non ordina sulla colonna a schermo** ma sul tetto misurato: la colonna porta due significati (max
  offerta finché è nell'urna, prezzo pagato dopo) e una graduatoria su una colonna che ne mescola due
  darebbe due letture in una. Chi il foglio non prezza ha confidenza zero, quindi tetto zero, quindi
  affonda — «vuoto = ignoto» che prende la forma di un rango invece di un numero.
- **La forma dei blocchi non è la stessa, e la differenza è giusta.** Sul mercato chi rientra troppo
  tardi (`MIN_PLAY_SHARE`) lascia il suo POSTO vuoto, perché lì lo slot è un rango della stanza e far
  salire tutti di uno parlerebbe di slot diversi da quelli su cui la scala è misurata; sulla griglia
  personale quell'uomo non ha un tetto, quindi non ha un rango MIO da tenere, e le righe che mancano si
  vedono in fondo al ruolo invece di lasciare un buco in mezzo. Misurato: 248 righe in tutt'e due, e
  l'unico blocco corto passa da dentro il ruolo a `C8`.

### 39.5 Il banco, e il null che lo rende non vuoto

`e2e-plancia-slots.mjs` misura l'ARITMETICA sullo schermo: scendendo un reparto la max offerta non può
risalire, né dentro un blocco né fra due. La prima cosa che stampa è il **null**: sulla plancia del
mercato quella discesa è rotta in **49 punti**, sulla personale in **0** — senza quel primo numero il
passo passerebbe anche se il tasto non facesse niente. Poi: i **barrati sono gli stessi uomini** nei due
tagli (2 e 2, Buongiorno e Yildiz), e si confrontano i NOMI e non il conteggio, perché due insiemi della
stessa taglia possono essere due insiemi diversi; gli **stessi 248 nomi** nei due tagli, che è la prova
della restituzione del §39.2; la mediana dichiarata contro quella delle righe che il blocco disegna (D1
dichiara 107, le sue righe danno 107); e il ritorno al mercato **riga per riga identico**.

Una nota sull'arnese che vale in generale: il passo della discesa aveva un'**esenzione** per le righe
barrate, giusta finché il barrato era un vincolo che spostava una riga. Con il vincolo ritirato
l'esenzione è stata **togliuta** e non lasciata lì per sicurezza: *un'esenzione sopravvissuta alla regola
che la giustificava nasconde un difetto vero proprio sulle righe che più contano.*

Tre lezioni sull'arnese, e due sono errori commessi scrivendolo.
- **Un tooltip di ng-zorro resta nel DOM dopo che il puntatore è andato via**, quindi il primo
  `.ant-tooltip-inner` era il pannello del TASTO premuto due passi prima: il banco leggeva il suggerimento
  del bottone e lo attribuiva al blocco. Cura: solo gli overlay non `ant-tooltip-hidden`, con un
  rettangolo vero, e il puntatore portato altrove prima di andare sull'intestazione.
- **Il passo pretendeva una forma di blocchi identica** e leggeva un difetto che non c'è (§39.4). Un
  banco che asserisce il contrario di quello che la feature promette è un banco che va corretto, non una
  feature da piegare.
- **Il vincolo è parte della promessa**: una discesa rotta conta solo dove la pagina non ha BARRATO la
  riga, perché quella è la regola che funziona.

### 39.6 Un difetto PREESISTENTE trovato dall'altro banco, e non toccato

`e2e-plancia-award.mjs` legge «l'avanzamento non è tornato a zero: **C 2/80**» dopo un azzeramento.
Attribuito muovendo una cosa sola — stessa corsa a HEAD senza queste modifiche: **identico**, quindi non
è di questo cambio. La causa è che `progress` conta `done = total − left` e `left` non può raggiungere
`teams` in un blocco a cui `MIN_PLAY_SHARE` ha togliuto una riga: i due esclusi si leggono come due
posti già assegnati. La cura sarebbe contare le righe con un padrone invece di sottrarre, ed è una
decisione su cosa quel contatore deve dire — quindi è scritta qui e non infilata dentro una richiesta
che non la contiene.

### 39.7 «Perché McKennie e Cambiaso sono cancellati?» — e la risposta ha cambiato l'inchiostro

Sua domanda, e la prima risposta è stata guardare **cosa la pagina non diceva**: la plancia aveva
**quattro inchiostri e una legenda per tre**. La legenda dichiara il pallino vuoto (nell'urna: max
offerta), quello pieno (di un altro: prezzo pagato) e il primario (mio); i due ROSSI non c'erano affatto.
La ragione del singolo era raggiungibile — l'icona sulla riga ha il suo tooltip, e la card che il click
apre porta la frase intera della fonte — ma **cosa vuol dire l'inchiostro** non stava scritto in nessun
posto, e le righe non hanno un tooltip per sua istruzione del 03/09 («da' fastidio»).

La legenda ora porta tutt'e due i rossi (§39.2-bis). Ma la risposta più utile alla sua domanda non è
stata scrivere la legenda: è stata **cambiare il fatto che il barrato dice**, perché la domanda stessa
era la prova che l'inchiostro era troppo grosso per il fatto. *Una legenda spiega un inchiostro; non lo
giustifica.*

### 39.8 Il «bordo sinistro blu» del toggle erano DUE blu di antd, e li ha trovati la misura

Sua segnalazione. Il tema override-a `.ant-radio-button-wrapper` su sfondo, bordo e testo dal 09/08/2026
— e antd dipinge altre due cose che quei tre selettori non toccano, misurate sul controllo vero:

| cosa | prima | dopo |
|---|---|---|
| il DIVISORE fra i due bottoni, `::before` 1px × 22px a `left: -1px` | `rgb(22, 89, 150)` | `var(--color-primary)` (o `--color-border` quando nessuno dei due vicini è selezionato) |
| l'alone del FUOCO, `box-shadow` | `rgba(23, 125, 220, 0.12) 0 0 0 3px` | il primario al 20% |

Due cose che restano oltre il caso. **Un tema che ridipinge sfondo, bordo e testo e lascia lo PSEUDO
all'autore della libreria sbaglia in un posto solo, e in quel posto si vede** — il seme è alto 22px su
un controllo alto 24, quindi è la cosa più visibile del bottone dopo il testo. E **il secondo blu non
compare in nessuno screenshot dello stato iniziale**: è l'alone del fuoco, che esiste solo dopo un
click, quindi si trova soltanto pilotando il controllo e leggendo `boxShadow` — misurato con un
puntatore vero, come ogni altra cosa di questa pagina. L'alone non è stato spento ma ricolorato: dice a
chi naviga da tastiera dov'è.

Verificato dopo: `audit-contrast` **60 coppie, 0 sotto soglia** (il cambio non tocca i colori che quella
misura del 09/08 aveva scelto), e i banchi `e2e-strategy`, `e2e-plancia-keepers`, `e2e-plancia-injury`
verdi — il selettore è globale, quindi le altre pagine col radio group vanno guardate anche loro.

### 39.9 UNA COLONNA PUÒ PORTARE DUE SIGNIFICATI SOLO DOVE NON È ANCHE LA CHIAVE DELL'ORDINE

Sua domanda, guardando lo schermo: «come mai negli slot personali Hojlund sta prima di Martinez?
L'ordine non dovrebbe essere per max-offerta?». Sì, e la fotografia del blocco A1 gli dà ragione:

```
Hojlund      333   urna
Martinez L.  403   DI QUALCUNO   <- 403 sotto un 333
Malen        298   urna
...
Kean         126   DI QUALCUNO
Kolo Muani   169   urna          <- 169 sotto un 126
Woltemade    175   DI QUALCUNO
```

La discesa si rompeva **esattamente e solo sulle righe di chi è già di qualcuno**, cinque su dieci in
quel blocco. Causa: la colonna della plancia porta **due** significati - max offerta finché è nell'urna,
**prezzo pagato** quando è di qualcuno - e sono due di proposito, perché quello che la stanza ha davvero
pagato per uno slot è la sola lettura viva del mercato che questa pagina abbia (§33). Ma l'ordine usava
il MIO tetto misurato, quindi Martinez L. mostrava i 403 che un rivale ha pagato e veniva ordinato su
una banda di 322.

**La cura è nel numero e non nell'ordine**, e la ragione è quale delle due cose la griglia promette: il
taglio personale *è* la colonna ordinata, quindi lì la cifra è SEMPRE il mio tetto, anche per un uomo che
non posso più comprare, e chi lo ha se lo legge dalla barra del proprietario o dalla griglia del mercato
(la legenda lo dice, ed è diversa nei due tagli). Ordinare invece per il prezzo pagato avrebbe reso la
colonna monotona e la GRADUATORIA priva di senso: «un uomo comprato a 403» non è «l'uomo che pagherei
403». Dopo: 333 · 322 · 298 · 293 · 262 · 253 · 225 · 169 · 124 · 109, e Hojlund sta davanti a
Martinez L. per 11 crediti di tetto.

**E lo stesso argomento ha portato via «i miei in cima al blocco» da questa griglia** (la sua richiesta
del 03/09, che resta intatta sulla plancia del mercato): un prefisso appuntato in cima rimette
esattamente la contraddizione che si stava togliendo - una riga sopra un'altra con un numero più basso.
Sul mercato il prefisso convive con l'ordine perché lì l'ordine è il valore atteso e il prefisso è
un'aggiunta dichiarata sopra di esso; sulla griglia personale la promessa è la colonna. *Due tagli, due
promesse, e una regola sta dove la promessa la regge.* I miei restano visibili dallo sfondo grigio, che
è il canale che avevano già.

### 39.10 NORMALIZZARE LO STATO PER POTER MISURARE PUÒ NASCONDERE IL DIFETTO CHE VIVE SOLO NELLO STATO VERO

È la lezione più utile di questo giro, ed è sull'arnese. Il banco premeva «azzera le rose» **prima** di
ogni lettura, per una ragione buona e scritta: la colonna del mercato mescola due cifre e una
graduatoria costruita su una colonna mescolata non misura niente. Solo che quel reset rimette ogni nome
nell'urna, cioè **elimina le sole righe su cui il difetto esisteva**. Il passo leggeva «0 punti rotti» e
lo schermo dell'operatore ne aveva 39.

Ora la discesa si misura **due volte**: sul tavolo come arriva, giocato (41 righe di qualcuno), e di
nuovo dopo l'azzeramento. Il primo passo porta il suo null - «quante righe sono di qualcuno», perché
«zero punti rotti» su una plancia senza padroni non prova niente - e **è stato provato rimettendo il
difetto**: con la colonna vecchia legge 39 punti rotti e li nomina, con quella nuova 0. La regola
generale: *quando un passo normalizza lo stato per rendere possibile una misura, chiedersi quali righe
quella normalizzazione fa sparire, e misurare anche prima.*

## 40. LA LENTE SU UNA ROSA: un click, e la plancia mostra cosa ha comprato (4 settembre 2026)

Sua richiesta: «quando faccio click su un box di una squadra -> "attiva quella squadra" ed evidenzia
sulla plancia tutti i calciatori comprati da quella squadra mettendo opacità 30% a tutti gli altri
calciatori». Fatto: `PlanciaStore.activeTeamId` / `toggleTeam` / `activeCount`, `BoardTeam.active`,
`SlotMatrix.dimmed`, e il banco `scripts/e2e-plancia-lens.mjs` (sei passi).

### 40.1 È UNA LENTE E NON UN FILTRO

Le righe restano tutte al loro posto e si smorzano: togliere quelle degli altri cambierebbe i blocchi, e
i blocchi sono la struttura del mercato - un rango diviso il numero di rose. Quindi la plancia non si
muove di una riga, cambia solo cosa si legge. Una sola rosa alla volta, perché la domanda è «cosa ha
preso QUESTO qui»: due rose accese insieme rispondono a una domanda che nessuno ha fatto.

**Nessuna eccezione allo smorzamento** - ce n'erano due, erano mie, e sono durate un'ora: vedi §40.8.

**E la lente si DICHIARA in barra, con la via d'uscita accanto alla ragione**: smorza duecentocinquanta
righe, quindi uno schermo mezzo spento senza una parola in cima si legge come un guasto. La pastiglia
porta la sigla della rosa e **DUE numeri** - quante righe la plancia sta evidenziando e quanti uomini ha
comprato in tutto - perché differiscono quando ha preso qualcuno dalla CODA, che non è disegnata, e
dirne uno solo farebbe leggere l'altro come un difetto (misurato sul tavolo dichiarato: 2 su 8 per la
mia rosa, cioè sei acquisti a un credito). La forma è quella dell'ordine personale della pagina
Strategia: la crocetta esiste solo quando c'è qualcosa da annullare.

### 40.2 IL GUARD SU `MouseEvent.detail` FERMAVA METÀ DEL GESTO, e l'ha bocciato il banco

Sulla stessa card c'era già un DOPPIO click che assegna il lotto (§37), e un doppio click emette prima
un `click`. La prima versione filtrava `MouseEvent.detail` - 1 per un click, 2 per il secondo di un
doppio - e sembrava la soluzione esatta, perché la distinzione è nell'evento e non serve nessun timer.
**Non lo era: il PRIMO click di un doppio ha `detail` 1 come qualunque altro**, quindi un doppio click
su una card con la lente accesa la spegneva prima di assegnare. Misurato dal banco, che per questo ha il
passo: lente sulla card 2 prima del gesto, **nessuna** dopo.

Cura: l'accensione **aspetta** 250 ms e il doppio click la annulla. Il ritardo sta sul gesto RARO
(guardo cosa ha comprato una rosa) e non su quello frequente (le assegno il lotto), che resta
istantaneo - il contrario di quello che il commento della prima versione sosteneva, perché pesava la
latenza sul gesto sbagliato. *Un guard che ferma metà di un gesto lo rende metà rotto, e la metà che
passa è quella che fa danno.*

### 40.3 Il banco: un JOIN e non un conteggio, e due incognite mai in un passo solo

Tre cose che questo banco fa e che valgono oltre la lente.

**Il join per COLORE invece del conteggio.** Una riga è «sua» quando il colore della barra del
proprietario è uguale al colore che la card dipinge sulla propria sigla - la stessa stringa letterale
nei due posti - quindi «tutti i calciatori che ha comprato sono in chiaro» si verifica uomo per uomo
invece che contando fino a tre. Contare avrebbe passato anche una lente accesa sulla rosa sbagliata.

**L'opacità si legge da `getComputedStyle`, mai dalle classi**: una utility è una dichiarazione, il
valore calcolato è quello che lo schermo fa. E il passo asserisce che qualche riga sia **esattamente** a
0,30, non solo che sia smorzata: «meno di 1» passerebbe anche con un'opacità che nessuno ha chiesto.

**Quale card è la mia lo dice la PAGINA, non il fixture**: il banco passa sulle dieci card e legge il
tooltip finché una dice «La tua rosa». Serve perché i miei restano leggibili sotto la lente di un
rivale, quindi senza saperlo l'aritmetica non chiude - e prenderlo dal fixture legherebbe il banco a
una demo che cambia.

E il passo del doppio click misura **due** incognite con **due** asserzioni: che la lente non si muova, e
che il doppio click ARRIVI comunque - la prova è il rifiuto a prezzo zero, che la pagina scrive. Un
ritardo che annullasse troppo si leggerebbe come «la lente è ferma» ed è invece un'assegnazione persa,
che è il difetto peggiore dei due.

### 40.4 NIENTE TOOLTIP SULLE CARD, e la frase resta dove non si disegna

Sua istruzione, subito dopo: «togli il tooltip dalle card delle squadre». Stessa ragione delle righe
della plancia il giorno prima («da' fastidio»): dieci card in colonna sono dieci pannelli che si aprono
passando sopra, e si aprono proprio dove si sta guardando.

Quello che il tooltip diceva è in gran parte già sulla card (crediti, posti, chi rilancia, chi è
acceso). Quello che non ci sta - il nome per esteso quando è troncato, e i due gesti - resta
nell'`aria-label`, che non si disegna: **togliere un canale visivo non è una ragione per togliere il
fatto a chi non lo vede**, e questa card è un controllo con due gesti e nessun testo che li annunci. Non
un `title` nativo, che sarebbe lo stesso pannello con un altro nome.

E l'`aria-label` ha ripagato subito da un lato inatteso: il banco cercava «quale card è la mia»
passando su tutte e dieci e leggendo il tooltip, e ora la legge dall'attributo - una lettura sola,
stabile, e senza dieci hover.

### 40.5 L'assenza si MISURA, da due lati

Il passo che la verifica non si accontenta di guardare il DOM: conta gli attributi di tooltip sulle
dieci card (**0 su 10**) *e* passa su ognuna con un puntatore vero contando quanti pannelli si aprono
davvero (**0**). Il primo da solo non basterebbe - un `title` nativo, o una direttiva su un figlio,
aprirebbero comunque qualcosa sullo schermo - ed è la stessa disciplina di «0 `title` su 250 righe» del
04/09. Terza asserzione, sull'altro lato dello stesso cambio: **ogni card ha un nome accessibile**, o
togliere il tooltip sarebbe stato togliere il fatto.

### 40.6 Due etichette in barra togliute, e solo una lascia un buco

«Queste due etichette non servono» (04/09/2026): «N saltano la prossima» e «N fuori lista».

La prima esisteva per DICHIARARE un vincolo - «li ho fatti scendere in fondo al loro slot e li ho
barrati» - e quel vincolo era stato ritirato lo stesso giorno (§39.2): era **una barra che annunciava un
ordinamento che non c'è più**, quindi non lascia niente.

La seconda dichiara un vincolo che C'È: chi rientra troppo tardi non si disegna, e un blocco con nove
righe invece di dieci senza una parola si legge come un tabellone rotto. La sua frase è stata spostata
nel tooltip del **blocco corto**, che ora porta conto, nomi *e soglia* - la soglia era solo nella
pastiglia. Il posto è migliore di prima: la domanda «perché questo blocco ha nove righe» si fa guardando
il blocco. *Un vincolo si dichiara dove si vede, non necessariamente in cima allo schermo.*

E il codice è andato via col markup (`outNowCount`, `outNowNote`, `excluded`, `excludedNote`): un
calcolo che nessuna vista legge è un contratto che mente a chi lo trova, la stessa regola dell'output
che nessuno emette.

### 40.7 TRE VERSIONI PER UN CONTEGGIO, e le due sbagliate insegnano di più

Il banco degli infortuni leggeva quel conteggio dalla pastiglia, quindi andava riscritto. Le prime due
forme erano sbagliate e in due modi diversi, entrambi già scritti in questo repository:

1. **il buco del blocco più corto** - leggeva **1** dove gli esclusi erano 2, perché sulla griglia del
   MERCATO ogni escluso resta nel suo slot (il posto non si sposta, si svuota), quindi due esclusi sono
   due blocchi da nove e non uno da otto. *Un massimo non è un conteggio*, terza istanza.
2. **la somma sui blocchi corti, esentando l'ultimo di ogni ruolo** - l'esenzione c'era per una ragione
   vera (l'ultimo blocco può essere corto perché il listone non contiene un multiplo di dieci uomini in
   quel ruolo) e nascondeva il secondo escluso, che stava proprio lì. *Un'esenzione che non sa
   distinguere due cause ne perde una.*

La forma che regge non deduce niente dalle altezze: apre il tooltip di ogni blocco corto e **somma il
numero che il blocco DICE**. Legge la pagina invece di rifare il suo conto - che è anche il solo modo di
accorgersi se la pagina lo sbaglia. Risultato: **2 fuori lista sui blocchi C6+C8**, contro i 2 che il
foglio porta sotto soglia.

### 40.8 UN'ASSERZIONE CHE PORTA DENTRO DI SÉ L'ECCEZIONE NON PUÒ FALLIRE SU QUELL'ECCEZIONE

Sua segnalazione: «quando seleziono una squadra e poi ne seleziono un'altra, i calciatori della squadra
precedente restano "accesi"». Il banco leggeva **otto passi verdi**, incluso uno che si chiamava
«cliccando un'altra card la lente si SPOSTA» e contava **0 residui**.

Riprodotto in un browser, e il caso è preciso:

```
CASO 1: prima la MIA rosa, poi un rivale
  dopo la mia        La mia rosa   sue 2 - accese 2   (Corvi, Camarda)
  dopo il rivale     La mia rosa   sue 2 - accese 2   <- restano
                     Bar Centrale  sue 3 - accese 3
CASO 2: due rivali di fila
  dopo il 1o         Tridente      sue 7 - accese 7
  dopo il 2o         Tridente      sue 7 - accese 0   <- puliti
```

La causa è **una delle due eccezioni che avevo aggiunto io** e dichiarato come mie: «i MIEI restano
leggibili sotto la lente di un rivale». La prima rosa che uno guarda è la propria, quindi il caso che
lui incontra per primo è esattamente quello che l'eccezione rompe - e **dal di fuori una riga accesa che
non è della rosa accesa è indistinguibile da una lente che non si è pulita.**

**E il banco era cieco per costruzione**: nei suoi filtri «nient'altro resta in chiaro» aveva scritto
`row.owner !== mineColour && row.name !== lotName`, cioè le stesse due eccezioni della pagina. *Un'asserzione
che porta dentro di sé l'eccezione che dovrebbe provare non può fallire su quell'eccezione*, e nessun
numero di passi verdi lo dice. È la stessa famiglia dell'«asserzione circolare» del 04/09 (le presenze
piene ricavate dalla card che si stava verificando) vista da un angolo peggiore, perché qui la
circolarità era fra il banco e una decisione di design.

Cura: **tutt'e due le eccezioni togliute**, dalla pagina e dai filtri. I due argomenti restano veri - la
riga del lotto è quella per cui la pagina esiste, e «cosa ha preso lui» si chiede insieme a «e io cosa
ho» - e non valgono il prezzo. *Il valore di un'eccezione si paga in confusione, e la confusione la vede
solo chi guarda lo schermo senza aver scritto il codice.* Il lotto resta comunque riconoscibile: la sua
riga ha lo sfondo verde e il suo nome è in cima alla pagina.

Il passo che mancava esiste ora e segue la SUA sequenza, non una comoda: **prima la mia, poi un rivale**,
zero residui. Provato rimettendo il difetto: con le eccezioni dentro, tre passi su nove diventano rossi e
nominano Butez, Corvi e Camarda; senza, nove verdi.

### 40.9 SMORZARE IL RESTO NON BASTA SE QUELLO CHE RESTA ERA GIÀ GRIGIO

Sua istruzione: «l'ink dei nomi accesi per la squadra selezionata deve essere bianco altrimenti non
risalta». Ed è vero per una ragione strutturale che la richiesta iniziale non poteva prevedere: gli
uomini di una rosa accesa sono, **per lo stato della riga**, «di un altro» - e quello stato è disegnato
`text-muted/60` di proposito, perché chi è già stato comprato non è più una decisione. Con la lente lo
ridiventa, e allora l'opacità al 30% sul resto lavorava contro un inchiostro che partiva già spento.

Cura: `LIT_TONE`, che è `ROW_TONE` con il solo stato `altro` portato a `text-fg`. Tre dettagli che
valgono oltre il caso:

- **una MAPPA e non una classe aggiunta** a quella dello stato: due utility sulla stessa proprietà si
  decidono sull'ordine del CSS generato e non su quale delle due è legata (il difetto del 27/08/2026);
- **`text-fg` e non un bianco letterale**: il tema ha due versi, e in quello chiaro il «bianco» è nero;
- **i due rossi vincono comunque**, e non è un'eccezione alla sua richiesta ma il suo senso: l'ink pieno
  serve alle righe che non risaltavano, e una riga rossa e barrata risalta già - ridipingerla costerebbe
  l'unico canale che dice «la sua stagione è compromessa».

**E il colore si misura confrontando righe della STESSA pagina**, mai contro un letterale: i token sono
`color-mix` e il tema ha due versi, quindi la sola affermazione verificabile è «questa riga ha lo stesso
colore di quella». Il passo prende il pieno da una riga ancora nell'urna e il grigio da una riga di un
ALTRO padrone, **e pretende che i due siano diversi** - se coincidessero non proverebbe niente. Misurato:
pieno `rgb(242, 242, 247)`, grigio `oklab(0.7015 ... / 0.6)`, **3 righe accese su 3** col pieno; e con il
difetto rimesso a mano, 0 su 3 con i tre nomi stampati. È la stessa lezione del 03/09 sul canale rosso
letto a mano, che leggeva 0 su una cella dipinta: *l'unità di un colore è parte della misura del colore.*

## 41. CODE REVIEW DELLA PLANCIA (4 settembre 2026)

Su sua richiesta, a effort alto: 14 findings, **12 corretti**, uno rimandato per una decisione di
prodotto, uno rifiutato - e **uno era sbagliato nella sua conseguenza**, che è la ragione per cui una
review si verifica come qualunque altra cosa (la stessa disciplina del §13 del simulatore, dove un
finding su otto non compilava).

### 41.1 I quattro che valgono oltre il caso

- **Una lente che punta a una rosa che non esiste piu' smorza 250 righe senza pastiglia e senza via
  d'uscita.** `activeTeamId` sopravviveva al cambio di tavolo: `activeTeam()` diventa `null` (quindi
  niente pastiglia e niente crocetta) mentre `dimmed()` resta vero per ogni riga. Cura: `lensId`, un
  computed che ritorna `null` quando l'id non è fra le rose del tavolo, letto da tutt'e tre i posti che
  ne avevano bisogno - e `startDemo`/`connect` spengono la lente, perché un tavolo nuovo è gente nuova.
  *La stessa abitudine che `AuctionFeed.followed` documenta già di sé: «risponde null se l'id non c'è
  piu'».*
- **`opacity` si MOLTIPLICA lungo l'albero.** `blockTone` mette `opacity-50` sul blocco esaurito, e un
  blocco esaurito è il posto normale dove vivono gli uomini già comprati: le righe che la lente
  accendeva leggevano al 50% proprio dove la lente serve. Invisibile al banco, che legge l'opacità
  della RIGA (1) e non quella effettiva. Cura: un blocco non si sbiadisce se la lente sta accendendo
  qualcosa dentro di lui.
- **250 ms sono meno della soglia di doppio click del sistema, e il secondo click non annullava.** Con
  ~300 ms fra i due click (dentro i 500 di default di Windows, che il commento stesso citava) il timer
  scattava, la lente si girava, e poi arrivava l'assegnazione: esattamente il difetto che la riscrittura
  diceva di aver curato. Cura: `press` annulla il timer anche sul secondo click.
- **`aria-label` su un `div` non lo legge nessuno.** Togliendo il tooltip, l'unica documentazione a
  schermo del doppio click era finita su un elemento con ruolo implicito `generic` e non focalizzabile.
  Cura: `role="button"`, `tabindex="0"` e `keydown.enter` - il nome accessibile ora è esposto e la card
  si raggiunge senza mouse. *Mettere una frase in un attributo non è renderla raggiungibile.*

Gli altri otto corretti: gli esclusi della griglia personale tornano sull'ultimo blocco del ruolo (dove
il buco cade davvero) restituendo conto, nomi e soglia a `blockTip`; `medianOffer` calcolata con lo
stesso `middleOf` null-aware dei due lati, invece di una `median` su un sentinella `-1`; la nota della
lente non attribuisce piu' alla coda tutto lo scarto fra disegnati e comprati (un escluso è comprato e
non disegnato); la seconda voce rossa della legenda dice «e non è fuori da 45 giorni», perché `rowTone`
dà la precedenza al barrato; `@let` per `headline` e `shown`, che erano chiamate due volte a
interpolazione (500 chiamate per ciclo di CD su 250 righe); un import morto; e un JSDoc orfano che si
attaccava a `tail`.

### 41.2 IL FINDING SBAGLIATO, e la misura che lo dice

Il primo finding diceva che `nzType="eye"` non è in `NZ_ICONS`, quindi «la lente non disegna mai il suo
occhio»: la direttiva mette la classe comunque, tenta un fetch da `assets/`, prende 404 e lascia una
casella vuota. La **prima metà è vera** (l'allowlist non lo portava) e **la conseguenza no**: togliendo
di nuovo la registrazione e rimisurando, **73 icone a schermo, 0 vuote, occhio disegnato**. La ragione è
che `ng-zorro-antd/icon` ha una sua lista di default che include `EyeOutline`, quindi l'icona si
risolveva senza di noi.

La correzione resta adottata - un'app che dipende da cosa un'altra libreria patcha per sé è fragile, e
il commento del file dice che un TestBed su un'icona non registrata si appende - ma il verbale porta il
numero e non la storia. *Una review è un'ipotesi con un argomento, non una misura: la metà verificabile
si verifica.*

### 41.3 E il banco ha guadagnato il passo che non aveva

Il difetto sopra, vero o no, ha nominato un buco reale: **una classe che una direttiva mette comunque
non è la prova che qualcosa si veda**, e ogni passo che cercava `.anticon-eye` leggeva «c'è» anche su
una casella vuota. Il passo nuovo è nella forma GENERALE e non in quella particolare - non «l'occhio
c'è» ma **«nessuna icona della pagina è vuota»**, perché una registrazione dimenticata è sempre lo
stesso difetto e questa pagina disegna una dozzina di tipi - con `waitFor` invece di un'attesa fissa,
perché la risoluzione di un'icona è asincrona e si POLLA. Legge **73 icone, 0 vuote**, e il suo null è
il conteggio stesso (sotto le dieci icone il passo si dichiara inutile).

### 41.4 E una sonda che serve un ciclo di attesa deve poter dire «non ancora»

Fuori dalla plancia, trovato correndo tutti i banchi: `e2e-options` moriva **2 volte su 6** con
`Cannot read properties of null (reading 'innerText')`. Non era l'app: `countLine` legge
`document.body.innerText` dentro un ciclo che polla finché una riga appare, e fra la navigazione e il
primo frame **il documento non ha ancora un body** - quindi la sonda LANCIAVA invece di rispondere «non
ancora», e `evaluate` trasformava quel lancio in un errore che uccideva la corsa. Cura: `document.body?`.
Cinque corse su cinque verdi dopo. *Un ciclo di attesa non aspetta niente se la sonda che interroga può
morire.*

## 42. LA CARD DI UN CALCIATORE ESCE DALLA PLANCIA (5 settembre 2026)

L'operatore ha chiesto la stessa card sulla Strategia («se draggo un calciatore ordino, se invece clicco
solo si apre la card con il dettaglio del calciatore — la stessa della plancia»), quindi
`views/plancia/man-card/` è diventata **`ui/player-card/`**, con `core/player-card.ts` a portare il
modello (`CardMan`) e la pila (`CardStack`).

**Per la plancia non cambia una riga a schermo**, e cambia una cosa nel codice: la card non legge più lo
store: riceve un `CardMan` che `plancia-store.cardManOf` costruisce dalla riga del blocco. È la stessa
disciplina di sempre — ogni numero è già stato deciso dalla riga (`men`, `buildMap`, `offerBand`), e la
card ne è il terzo lettore dopo il blocco e il lotto.

Tre cose che la separazione ha reso esplicite.

- **La META' D'ASTA è un `CardMarket` opzionale.** Max offerta, prezzo pagato, padrone, «è il lotto in
  asta» e «abbinamenti» sono fatti su un TAVOLO, e la Strategia è quello che si prepara PRIMA di
  sedersi: lì è `null`, e i due bottoni li PROIETTA la pagina (`[card-actions]`) perché sono gesti suoi.
  Mostrare una banda inventata accanto a una lista che non riguarda nessun tavolo sarebbe la stessa
  famiglia della demo che prezzava il listone euro con la scala di Serie A (§33).
- **La piattaforma sta nel modello.** `cardManOf` scrive `platform: 'default'` con la sua ragione: la
  plancia prezza sempre il listone classic di Serie A (`loadSheet`), e da oggi quel campo decide anche
  DI QUALI PARTITE la card parla — passarne una sbagliata mostrerebbe le giornate di un altro gioco
  sotto lo stesso nome.
- **Una pila per pagina, una regola sola.** `new CardStack()` due volte: le card della plancia non
  devono seguirti sulla Strategia, ma dove nasce una card e chi sta davanti è una definizione sola, o
  due pagine disporrebbero le stesse card in due modi. Il posto libero più basso, l'ordine di apertura
  separato dall'ultima toccata: tutto quello che il §39 aveva misurato, spostato senza toccarlo (test
  in `core/player-card.spec.ts`).

**E la card ha una parte nuova che vale su tutt'e due le pagine**: le ULTIME PARTITE (cinque colonne, il
chevron che le apre tutte). Dettaglio, misure e le righe che deliberatamente non si disegnano:
`letture-app-v1.md` §24.

Verificato coi banchi che già c'erano, dopo aver puntato i loro selettori sul nuovo nome
(`plancia-man-card` → `ui-player-card`): `e2e-plancia-injury`, `e2e-plancia-keepers`,
`e2e-plancia-slots`, `e2e-plancia-award`, `e2e-plancia-lens` tutti verdi.
