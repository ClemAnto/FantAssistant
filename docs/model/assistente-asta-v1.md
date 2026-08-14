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
prevista, la titolarità, il fianco), e non entrano nel vincolo.

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
  campionato, titolarità, e **fino a due ballottaggi**. Verificato sul bundle: 37 + 20 + 20 club, 407 + 220 +
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
