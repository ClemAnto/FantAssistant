# Assistente d'asta — v1 (5 agosto 2026)

**Cos'è**: le decisioni di progetto fissate con l'operatore **prima di scrivere codice**, su come l'app
accompagna un'asta vera. Non è un documento di gate: dove dichiara un numero che tocca una *previsione*,
quel numero passa dal gate o dallo sweep come qualunque altro. Dove dichiara una **funzione obiettivo** —
l'ordinamento, il tetto di rilancio — vale la porta del §10 di
[metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md): forma e metrica dichiarate prima, misura dopo,
verdetto a verbale qualunque sia.

Fratello di `metrica-asta-surplus-v1.md`: quello dice **con che valuta si ordina**, questo dice **cosa
l'assistente ne fa al tavolo**.

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
euro/classic), 8 squadre, 3P/8D/8C/6A, asta a rilanci, budget da confermare col regolamento della lega.
Tutti modificabili, nessuno da riempire per vedere il primo suggerimento.

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
- il **bundle** `data/export/<season>/` come unico canale dati dell'app, con `manifest.json` normativo.

Manca, in ordine di quanto blocca:

1. **La modalità live.** Tutto l'harness assume che l'esito esista: `_window_is_usable` vuole almeno 50
   fantamedie vere, la vista Auction elenca solo stagioni finite, `auction_view` confronta **due** liste.
   Un'asta ha **una** lista. È scritto in `app/README.md` come il lavoro aperto, e non è del toolkit.
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
- **Modalità draft** → la domanda cambia da «quanto vale» a «quando lo chiamo»: stesso surplus marginale,
  nessun λ.
- **Riaprire `surplus_pressure`** → resta spenta finché non arrivano `injuries` o lo storico settimanale di
  `probable_starter`; comprava 0 bust in meno (`metrica-asta-surplus-v1.md` §11).
