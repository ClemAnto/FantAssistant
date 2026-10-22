# Roadmap scambi — v1 (22/10/2026)

Come trasformare in codice quello che convince un altro fanta-allenatore a fare uno scambio. Nasce dalla domanda
dell'operatore del 22/10/2026 sera («cosa può convincere qualcuno a fare uno scambio?») e dalla sua istruzione:
**casi semplici, a compartimenti stagni, per vedere man mano i risultati**. Il punto di partenza è la pagina che c'è
(`scout-scambi-v1.md`): `/scout`, scambi 1x1 e 2x2, aritmetica in `app/src/app/core/scout.ts`.

## 0. Le premesse

- **Lui non pensa in punti a giornata.** Guarda il nome, il prezzo (FVM), le ultime partite e i problemi che sente.
  I nostri guadagni restano il FILTRO (uno scambio che non migliora la tua rosa non si propone); quello che si
  aggiunge è come l'offerta APPARE a lui.
- **Nessun dato su scambi accettati o rifiutati.** Ogni regola sotto è un'ipotesi plausibile finché il registro
  (passo 1) non dice altro. Per questo il registro viene per primo: i dati si accumulano solo col tempo.
- **Lo scambio parte da un 1x1 (o 2x2) e si allarga dopo** (appunto dell'operatore, per esperienza): gli altri
  attori si aggiungono in un secondo momento, per sistemare quello che la base non convince. Quindi «allargare»
  è un'operazione SU UN'OFFERTA SCELTA, non una ricerca su tutto lo spazio: costa poco e si fa a richiesta.
- **Ogni passo è un'aggiunta che si accende e si spegne da sola**, senza toccare le regole già scritte, e ognuno ha la
  sua verifica. Un passo che non serve si toglie senza toccare gli altri.
- **Vincoli e non pesi**, come tutte le regole della pagina: un criterio che lui dichiara filtra o ordina, non entra
  nei guadagni.

## 1. Il registro delle offerte — RIMANDATO (operatore, 22/10/2026: «la 1 non serve al momento»)

Resta scritto perché è l'unica strada per il passo 8; il prezzo del rinvio è che i dati cominciano ad accumularsi
più tardi.

**Cosa.** Su ogni riga un bottone «proposto». Lo stato si cambia dalla riga stessa: proposto · accettato ·
rifiutato · controproposta (con una nota libera). La pagina mostra in un pannello le offerte registrate.

**Cosa si salva al momento della proposta** (una FOTOGRAFIA, perché forma e FVM cambiano ogni settimana): gli id
dei calciatori, la squadra, i due guadagni, il saldo FVM, la forma, e da quando ci sono (passi 3-4) il bisogno e la
frase.

**Dove.** `core/trade-log.ts` (puro: tipi, lettura, scrittura) + `localStorage`, chiave per fantasquadra come
la ricerca 2x2 salvata. In un secondo momento lo stesso foglio Google delle rose (`scripts/gas/rosters.gs`) per
averlo su tutti i dispositivi: non serve per partire.

**Verifica.** Test unitario sul formato; il banco `e2e-scout` registra una proposta, ricarica, la ritrova con i
numeri del momento e non quelli di oggi.

**Costo.** Piccolo. Nessun calcolo nuovo.

## 2. FVM a suo favore — FATTO (22/10/2026 sera)

Interruttore «FVM a suo favore» accanto all'ordinamento, ricordato fra le visite (`scout.fvmFair`); acceso, lascia
solo le righe dove il FVM di chi dai è almeno quello di chi chiedi, e una riga senza FVM da una parte RESTA FUORI
(un ignoto non è un favore). Stampa «k di n». Misurato sull'export chiagnister (Serie A classic), 2x2:
MAJINBUSIO 15 di 42, EV-United 12 di 22, AngeloAzzurro **2 di 20**, MaCheMollo 12 di 31, Temptation Haaland 32 di 46
- su alcune rose il nostro vantaggio sta quasi tutto dove il mercato paga meno, come previsto.

Testo originale del passo:

**Cosa.** Un interruttore «solo se il FVM lo favorisce»: chi dai vale, a FVM, almeno quanto chi chiedi (con una
tolleranza dichiarata, di partenza 0). Il saldo FVM è già calcolato su ogni riga (`fvmGive`, `fvmTake`): oggi si
mostra e basta.

**Dove.** Un filtro nella vista, come quello sulla squadra. Niente in `core/`.

**Verifica.** Quante righe sopravvivono, stampato accanto all'interruttore («12 di 40»). Se ne sopravvivono
pochissime è un'informazione: il nostro vantaggio sta proprio dove il mercato paga meno.

**Costo.** Minimo.

## 3. Allargare un'offerta — FATTO (22/10/2026 sera)

`scout.extendOffer`: su una riga, «+ aggiungi» prova UN calciatore in più - nostro, suo, o uno per parte (su una rosa
classic piena solo uno per parte, dello stesso ruolo: le quote) - e tiene le aggiunte che migliorano per LUI almeno
una di tre cose (il suo guadagno di `EXTEND_STEP.theirs` 0,1, il saldo FVM a suo favore di 5, la forma di 0,1:
soglie dichiarate, la taglia di una differenza che un fanta-allenatore nota) senza peggiorarne nessuna, con tutte le
regole di sempre (guadagni ≥ +0,1 e paragonabili, quote, forma). Ordine: più cose sistemate, poi il nostro guadagno
sull'undici, poi - a parità - la rosa intera, così il «contentino» dalla nostra panchina che ci manca meno viene
prima (i guadagni contano solo l'undici, e un panchinaro ceduto costa la copertura che dava). Le prime 3, ognuna
una riga come le altre: si apre la tabella, e si può allargare ancora. Calcolato solo quando lo si chiede, su
quella riga. Misurato sui 2x2 dell'export chiagnister: 3, 3, 2 aggiunte sulle prime righe di tre rose, 0 su altre tre
(dove nessun uomo in più migliora per lui senza peggiorare un'altra cosa).

Testo originale del passo:

**Cosa.** Su una riga scelta, «+ aggiungi»: la pagina cerca UN calciatore in più da una parte o dall'altra per
sistemare il punto debole dell'offerta, nell'ordine:
1. **il guadagno di LORO è troppo basso o sbilanciato** → aggiungiamo un nostro calciatore che alza il loro undici
   (un «contentino» dalla nostra panchina);
2. **il FVM non lo favorisce** → aggiungiamo un nostro calciatore che sposta il saldo a suo favore senza costarci
   l'undici (uno che da noi non gioca);
3. **la forma è al limite** → aggiungiamo un nostro calciatore in forma.

Un passo alla volta: da un 1x1 si arriva a un 2x1 o a un 1x2, poi eventualmente a un 2x2, e si può ripetere. Le
regole di sempre restano vincoli (il nostro guadagno resta ≥ +0,1, le quote di rosa reggono). Si mostrano le
2-3 aggiunte migliori, ognuna con cosa sistema («per loro +0,4», «FVM +12 a suo favore»).

**Dove.** `core/scout.ts`: `extendOffer(offer, input)`, che riusa il calcolo dei guadagni di `pairSwaps` su UNA
base. Gli scambi asimmetrici (2 per 1) oggi non esistono: le quote di rosa vanno controllate anche lì, e su
classic una rosa piena non può ricevere un uomo in più senza cederne uno.

**Verifica.** Test sui casi tipici (base sbilanciata → l'aggiunta la riequilibra; nessuna aggiunta peggiora il
nostro guadagno sotto la soglia); `e2e-scout` apre «+ aggiungi» su una riga vera e controlla i vincoli sulle
proposte.

**Costo.** Medio. Il calcolo è a richiesta su una riga sola: decine di confronti, non migliaia.

## 4. Il suo bisogno, visto da lui — FATTO (22/10/2026 sera)

`scout.rivalReports` porta `needs`: un bisogno per posto del loro undici, il più forte prima - `out` (titolare fuori
oggi: la finestra di `ExpectedPlay`, quindi solo chi ha un rientro datato o la stagione finita), `novote` (nessun voto
in almeno `NO_VOTE_MIN` = 3 delle sue ultime 5 partite di club: soglia DICHIARATA, una maggioranza), `weak` (i buchi
già calcolati). La card di ogni rivale li elenca sotto «Problemi»; una riga di scambio che ne risolve uno lo dice con
un'etichetta, e l'ordinamento «Bisogno» le mette in cima.

**Cosa vuol dire «risolve» è costato due tentativi, e il secondo era sbagliato in modo istruttivo.**
- Prima: «chi dai può giocare in quel posto». Vero di quasi ogni offerta (**27 righe di 30**): un'etichetta su ogni
  riga non dice niente.
- Poi: «chi dai spinge fuori dal loro undici il titolare in difficoltà». **0 righe di 30**: l'undici dello scout è
  quello della STAGIONE, e un titolare fuori quattro giornate ci resta comunque sul resto della stagione - nessuno
  scambio lo spinge fuori. Anzi, alcune offerte lo PRENDEVANO (Yildiz, fuori 8 g): spostano il suo problema, non lo
  risolvono.
- Adottato (`scout.needMet`): per `out`/`novote`, chi dai gioca nell'undici che il rivale schiera SENZA i titolari in
  difficoltà, in un posto di quella linea («mentre X è fuori, gioca il tuo»); per `weak`, spinge fuori il titolare
  (o, per un posto vuoto, può occuparlo); prendere il calciatore in difficoltà non risolve niente. Misurato:
  **1/2 · 14/30 · 13/19 · 7/12 · 11/22 · 8/13** righe 2x2 sulle sei rose provate - discrimina.
- Limite detto: gli 1x1 su questa lega classic sono **zero per ogni rosa** (con le quote piene 3/8/8/6 un 1x1 deve
  essere dello stesso ruolo, e le altre regole fanno il resto), quindi i passi 2 e 4 si vedono oggi solo sui 2x2.

Testo originale del passo:

**Cosa.** Per ogni squadra avversaria, i problemi che SENTE già, in tre forme semplici:
- un suo titolare **è fuori oggi** (infortunio o squalifica: la finestra di `ExpectedPlay`, già nel bundle);
- un suo posto **non ha preso il voto** in più partite recenti (le ultime partite del titolare: le celle della
  striscia, già nel foglio);
- un suo reparto **è sotto la mediana della lega** (i «buchi» di `rivalReports`, già calcolati).

Una riga che risolve uno di questi problemi lo DICE («gli manca un D: Tizio fuori 4 giornate») e un ordinamento
«Bisogno» le mette in cima.

**Dove.** `core/scout.ts`: `needsOf(squad)` → elenco di bisogni per ruolo; `meets(swap, needs)`. La vista
aggiunge l'etichetta e l'ordinamento.

**Verifica.** Test sui tre casi; nel banco, ogni bisogno nominato corrisponde a un fatto del bundle (l'infortunio,
le partite senza voto).

**Costo.** Medio-piccolo: sono letture di dati che ci sono già.

## 5. La frase dell'offerta

**Cosa.** Ogni riga porta una frase pronta da copiare nel messaggio all'altro: «A te serve un difensore (Tizio è
fuori), io ho un attaccante di troppo: Caio per Sempronio». Costruita dai passi 2 e 4, mai dai nostri punti a
giornata. Un bottone «copia».

**Dove.** `core/trade-pitch.ts`, puro, con i suoi test sulle frasi.

**Verifica.** Test sulle frasi; lettura dell'operatore su qualche caso vero.

**Costo.** Piccolo.

## 6. Le eccedenze — FATTO (22/10/2026 sera)

`scout.surplusOf`: sulle sue riserve che ci servono, «4 A da titolare per 3 posti» quando quel ruolo (P/D/C/A del
listone) ha più uomini a livello da titolare che posti nel suo undici; quelle riserve vengono prima nell'elenco.
«A livello da titolare» = almeno `VALUE_RATIO` (0,8) del titolare più debole di quel ruolo. La prima versione
chiedeva «almeno quanto lui» ed era **muta per costruzione** (0 etichette su ogni rosa): chi fuori dall'undici vale
almeno un titolare del suo stesso ruolo sarebbe nell'undici. Con 0,8 escono **15-25 etichette su 9 rivali**, e sulle
prime 4 riserve di una card quasi tutte la portano (le difese sono compresse: «7 D da titolare per 4 posti»): oggi
dice poco più di «è una riserva buona». Se serve più selettiva, la soglia è una dichiarazione da rivedere.

Testo originale del passo:

**Cosa.** Segnalare quando la squadra avversaria ha più calciatori buoni che posti in un ruolo (lo sa anche lui, e
cedere chi resta in panchina gli costa poco). Le «riserve che ci servono» ci sono già: si aggiunge il motivo
(«4 attaccanti titolari per 3 posti») e una preferenza nell'ordinamento per chi viene da un'eccedenza.

**Dove.** `rivalReports` già conosce panchina e undici: si aggiunge il conteggio per ruolo.

**Costo.** Piccolo.

## 7. Il momento giusto

**Cosa.** Un avviso quando, dall'ultima visita, un titolare di un avversario è diventato indisponibile o la sua
squadra ha perso: è il momento in cui la stessa offerta vale di più. La pagina ricorda lo stato visto l'ultima
volta (per fantasquadra) e segnala cosa è cambiato.

**Dove.** Uno stato salvato come la ricerca 2x2; il confronto è con i bisogni del passo 4.

**Costo.** Medio: richiede di tenere una fotografia per squadra.

## 8. Tarare col registro

**Cosa.** Quando il registro ha almeno una ventina di esiti: confrontare accettate e rifiutate su FVM, forma,
bisogno, guadagno di loro, numero di calciatori. Diventa una MISURA, e decide quali dei vincoli dei passi 2-7
stringere, allentare o togliere.

**Costo.** Nessun codice nuovo, a parte un riepilogo nella pagina.

## Ordine e criterio per passare al passo dopo

| Passo | Cosa | Dipende da | Si chiude quando |
|---|---|---|---|
| 1 | Registro | — | una proposta salvata sopravvive al refresh coi numeri del momento |
| 2 | Filtro FVM | — | il conteggio delle righe filtrate è a schermo |
| 3 | Allargare un'offerta | — | da una riga vera esce un'aggiunta che sistema il punto debole senza violare i vincoli |
| 4 | Bisogno | — | ogni bisogno nominato corrisponde a un fatto del bundle |
| 5 | Frase | 2, 4 | la frase è copiabile e non cita mai i nostri punti |
| 6 | Eccedenze | — | il motivo è scritto sulle riserve |
| 7 | Momento | 4 | un cambiamento dall'ultima visita produce l'avviso |
| 8 | Taratura | 1 + tempo | almeno 20 esiti registrati |

I passi 1, 2, 3 e 4 sono indipendenti fra loro e si possono fare in qualunque ordine; 1 per primo solo perché i
suoi dati hanno bisogno di tempo. Dopo ognuno l'operatore prova la pagina su una lega vera e decide se andare
avanti, cambiare l'ordine o togliere il passo.

## Impaginazione — APERTA (22/10/2026 sera)

Richiesta dell'operatore: «troppo confusionario ... fare rientrare tutto in una schermata, focus sulle cose principali,
dettagli ed alternative solo a richiesta». Proposte tre impaginazioni (A lista + pannello, B un avversario alla
volta, C le migliori in carte); scelta **A**, e sulla riga della lista **solo i nomi**. Implementata in `a24bc49`:
una barra sola, la lista a sinistra (una riga per offerta, la sua linea migliore), a destra l'offerta scelta (chi
dai/ricevi, guadagni, forma, FVM, bisogno risolto, tabella di confronto, «Aggiungi un calciatore», «altri modi di
pagarlo»), la rosa e le card degli avversari in due cassetti; il banco `e2e-scout` è riscritto su questa forma.

**Verdetto dell'operatore: «non ci siamo ancora, troppo confusionario»** - ci pensa e si riprende nella prossima
chat. Da chiedergli prima di toccare il codice: cosa confonde (il pannello di destra, la tabella a 20 colonne, la
barra, i cassetti?) e cosa vuole vedere per primo. Due candidati già detti: la tabella di confronto con la sola
stagione corrente (l'altra a richiesta), un segnale minimo sulla riga per l'offerta che risolve un suo problema.
