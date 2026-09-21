# Attendibilità delle probabili formazioni — chi dice cosa prima del fischio, e chi ci prende

**18/09/2026.** Dalla richiesta dell'operatore: «crea uno script anche su google-sheet che in automatico
per ogni giornata di serie-a segna (subito prima dell'inizio del primo anticipo) scansioni i siti
principali che mostrano le probabili formazioni (fantacalcio.it, sos fanta, gazzetta dello sport, ecc…)
e segni per ognuno le probabili indicate poi alla fine del turno crei un report con i calciatori
corretti e quelli sbagliati. A lungo termine verificheremo quale è il sito più attendibile», più la sua
seconda domanda della stessa sessione: «verifica se ci sono altre fonti autoritarie da valutare».

Codice: `scripts/gas/probabili-sheet.gs` (il foglio) e `scripts/gas/verify-parsers.mjs` (il banco che
lo verifica fuori da Google). Nessun percorso del motore legge quello che questo foglio scrive.

**È UN GIUDIZIO SULLE FONTI E NON UN CANALE DEL MOTORE**, ed è la stessa regola già scritta per
`press_formations` («la stampa è un GIUDICE, mai un input») incontrata dal verso opposto: là la stampa
giudica le nostre board, qui la realtà giudica la stampa.

**PERCHÉ UN FOGLIO E NON UN RUNNER.** Il piano cloud era morto su un'obiezione sola — l'unico posto in
cui un runner GitHub può scrivere è il repository **pubblico**, e una presa è contenuto a pagamento. Un
Drive è privato, quindi quell'obiezione qui non esiste. La seconda ragione decide il disegno: il foglio
deve rispondere alla domanda **a portatile spento**, perché una pagina di probabili mostra solo «adesso»
e un turno non preso è un turno perso per sempre.

---

## 1. La misura che ha deciso il lavoro — e il verdetto su SOS Fanta è stato RITIRATO

Una sonda per fonte, client anonimo, nessuna credenziale. **Quattro fonti su cinque si leggono.**

| fonte | HTTP | moduli veri | verdetto |
|---|---|---|---|
| **fantacalcio.it** | 200 · 765 KB | 7 | 20 schede, 477 giocatori, **l'`fc_id` nell'href**, % per uomo |
| **sport.sky.it** | 200 · 493 KB | 6 | 20 club, 10 tabelle, numero di maglia e id suo |
| **corrieredellosport.it** | 200 · 535 KB | 6 | 20 club, 110+110 titolari, dichiara **dati OPTA** |
| **sosfanta.com** | 200 · 547 KB | 6 | 20 club, % per uomo, **NOMINA i ballottaggi**, orari in ISO |
| gazzetta.it | 200 · 206 KB | **0** | la pagina **dichiara il proprio muro**: `"isAccessibleForFree":false` |

**IL PRIMO VERDETTO SU SOS FANTA ERA SBAGLIATO DUE VOLTE, e questa è la parte che vale più della
fonte.** Era archiviata come «login, e l'undici è disegnato su un CANVAS»:

- i **49 canvas** venivano da un `grep` della stringa `canvas`, che stava agganciando
  `offcanvas-menu`, il menu laterale. Guidata in un browser vero la pagina ha **ZERO** elementi
  canvas e non fa **nessuna** chiamata di dati (sei XHR, tutte pubblicità e consenso);
- e la pagina con gli undici **non era mai stata provata**: `/probabili-formazioni/` è un indice di
  **un articolo per partita**, mentre `/lista-formazioni/probabili-formazioni-serie-a/` è la
  tabella, server-rendered, che si legge **senza JavaScript**. Quella URL è **LINKATA dall'indice**,
  cioè la passata di scoperta che questo stesso lavoro aveva già fatto per gli altri siti l'avrebbe
  trovata.

La lezione: **una volta che una fonte è archiviata come rifiutata, il metodo che smentirebbe il
verdetto smette di esserle applicato.** Un no prematuro costa in un modo in cui un sì prematuro non
costa, perché niente, dopo, lo contraddice. La sonda resta in `probe()`, e va rilanciata sulle fonti
scartate invece che ricordata.

**UN 200 NON PROVA NIENTE, ed è per questo che accanto c'è un conteggio**: anche la fonte rifiutata
risponde 200. Il conteggio è sui **moduli del regolamento** (le cui cifre sommano dieci) e non su
qualunque cosa somigli a `n-n-n`, perché `3-2-4` e `4-2-1` erano passati su una pagina che non
porta nessun undici.

**E LE URL SI SCOPRONO, NON SI INDOVINANO.** Delle dieci fonti in più provate, sei hanno risposto 404
a una URL costruita da me; ripescate dall'HOME del sito, le URL vere esistevano per tutte e sei.
Gazzetta la sua ce l'ha ed è pure per turno (slug datato): quello che manca non è l'indirizzo, è
l'accesso.

Le altre otto provate e non entrate: tuttomercatoweb e fantamaster pubblicano **un articolo per
partita**; pianetafanta, fantapiu3, fantacalciopedia e sportmediaset rispondono 200 con 0-2 moduli;
calciomercato.com ha una lista per turno con slug datato; legaseriea.it redirige. Nessuna è chiusa per
sempre — sono **da riprovare**.

---|---|---|---|
| **fantacalcio.it** | 200 · 765 KB | 7 | **si legge** — 20 schede, 477 giocatori, e l'`fc_id` nell'href |
| **sport.sky.it** | 200 · 493 KB | 6 | **si legge** — 20 club, 10 tabelle, numero di maglia e id suo |
| **corrieredellosport.it** | 200 · 535 KB | 6 | **si legge** — 20 club, 110+110 titolari, dichiara **dati OPTA** |
| sosfanta.com | 200 · 258 KB | **0** | login: «Accedi» ×6, e l'undici è disegnato su un **canvas** |
| gazzetta.it | 200 · 206 KB | **0** | la pagina **dichiara il proprio muro**: `"isAccessibleForFree":false` |

**UN 200 NON PROVA NIENTE QUI, ed è per questo che accanto c'è un conteggio**: tutt'e due le fonti
rifiutate rispondono 200. Il conteggio è sui **moduli del regolamento** (le cui cifre sommano dieci) e
non su qualunque cosa somigli a `n-n-n`, perché `3-2-4` e `4-2-1` erano passati su una pagina che non
porta nessun undici — la trappola che questo progetto ha già pagato con SOS Fanta il 17/08.

**E LE URL SI SCOPRONO, NON SI INDOVINANO.** Delle dieci fonti in più provate, sei hanno risposto 404 a
una URL costruita da me; ripescate dall'HOME del sito, le URL vere esistevano per tutte e sei. Gazzetta
la sua ce l'ha ed è pure per turno (`…probabili-formazioni-per-la-5-giornata.shtml`, slug datato):
quello che manca non è l'indirizzo, è l'accesso. È la lezione di Transfermarkt, applicata prima di
concludere.

Le altre otto provate e non entrate, con la ragione: tuttomercatoweb e fantamaster pubblicano **un
articolo per partita** (l'hub non porta undici); pianetafanta, fantapiu3, fantacalciopedia e
sportmediaset rispondono 200 con 0-2 moduli (pagina costruita in JS o hub di notizie); calciomercato.com
ha una lista per turno con slug datato; legaseriea.it redirige. Nessuna è chiusa per sempre — sono
**da riprovare**, e la sonda è in `probe()`, non in un ricordo.

---

## 2. La verità è ESATTA e costa una richiesta

La pagina dei voti di fantacalcio.it per un turno giocato porta, **per club**, chi ha preso un voto, con
lo stesso `fc_id`, e un'icona `title="Subentrato"` su chi è entrato. Quindi **«ha cominciato» = ha un
voto e non è marcato come entrato**: è una lettura e non una deduzione.

Misurato sulle giornate 2, 3 e 4 del 2026-27: **20 blocchi di club, UNDICI titolari ciascuno, 220 in
totale, 220 id distinti — tre volte su tre.** L'invariante è **asserito a ogni scoring** e non creduto:
se cade, il turno **non** viene scorato e la ragione è scritta, perché un turno scorato contro una
pagina pubblicata a metà punirebbe tutte le fonti insieme.

Il parametro della giornata **è rispettato** (tre giornate diverse danno tre pagine diverse, md5 alla
mano): la trappola del parametro ignorato è già costata a questo progetto su un altro provider.

---

## 3. Le tre parti, e ognuna risponde a una domanda diversa

### QUANDO
Il turno è quello che **la pagina NUMERA** (`/calendario/{md}/{season}/`, il più frequente vince), mai
un blocco di giorni dedotto: fra due giornate consecutive lo scarto vale 1 giorno 124 volte e 7 giorni
90 — nessuna soglia separa «dentro un turno» da «fra due turni».

Gli **orari** si leggono da Corriere (`venerdì 18.09.2026 ore 20:45` accanto ai due club, con l'anno),
con Sky come ripiego. Fantacalcio **non** è usato per questo pur essendo l'ancora del turno: il suo
orario per partita è un segnaposto (`01/01 01:00`) e gli slot veri stanno in un blocco a parte, cioè il
giorno è dichiarato ma non attaccato alla partita.

**LE ENTITÀ SI DECODIFICANO PRIMA DI CERCARE, e non è un dettaglio**: il giorno arriva come
`venerd&#xEC;`, quindi un lettore ancorato al nome del giorno **perde ogni anticipo del venerdì** — cioè
esattamente la partita per cui questo foglio esiste. Trovato misurando: la mia prima lettura degli orari
dichiarava «il turno 5 non ha anticipo» mentre Monza-Sassuolo era in programma quella sera alle 20:45.

La presa è armata a `kickoff − 20'`, **una per SLOT** e non per partita (tre partite alle 15:00 sono una
presa sola), e i trigger del giorno prima si buttano: Apps Script ne consente venti per progetto.

### CHI
Una fonte = una riga in `SOURCES` più il suo parser. I parser sono espressioni regolari ancorate alla
parte **stabile** di una classe e mai a un hash di build, e `probe()` dice quanti club ognuno legge: un
sito che cambia marcatura legge **0 club** e **rifiuta di scrivere**, invece di scrivere un tipo di
errore più silenzioso.

**LA FOTOGRAFIA SI SALVA PRIMA DEL PARSING.** Ogni fetch va su Drive gzippata prima che una riga sia
letta, come fa `fc_site` sul portatile: le fotografie **sono** la serie storica e le righe del foglio ne
sono una LETTURA. Se un parser sbaglia, la prova è ancora su disco; senza la fotografia un difetto di
parsing distruggerebbe il turno che ha letto male.

**Una fonte che non risponde scrive una riga in `Log` e NESSUNA riga in `Probabili`**: un marcatore
vuoto che si legge come «questo sito non ha previsto nessuno» è il difetto che il 17/08/2026 è costato
91 file di cache buoni.

**E SI APPENDE, MAI SI SOSTITUISCE**: chi pubblica due volte lascia due righe, e scegliere fra loro è
mestiere dello SCORER. Sovrascrivere qui distruggerebbe la lettura precedente, e nessuno potrebbe più
chiedere quanto un sito cambia idea fra il venerdì e la domenica.

### L'IDENTITÀ, e il difetto che la misura ha trovato
Solo fantacalcio pubblica la nostra chiave, quindi la sua pagina **è** la tabella d'identità per gli
altri due. **Costruita su TUTTA la rosa della pagina, titolari E riserve**, e questo è il punto e non un
dettaglio: la prima versione indicizzava i soli undici di fantacalcio, quindi un uomo che un altro sito
schiera e fantacalcio panchina **non era risolvibile** — cioè l'identità falliva **esattamente sui
giocatori su cui le fonti dissentono**, che è tutta la domanda. Misurato: costava 31-32 nomi su 220 per
fonte, e **il metro avrebbe lusingato fantacalcio per costruzione**.

Il confronto è **per token** e non «la prima parola», perché i tre siti ordinano i pezzi in modo diverso
(`Varela G.` contro `Gustavo Varela`, `Mangas` contro `Ricardo Mangas`), con i diacritici nordici e
slavi ripiegati (`Højlund`, `Østigård`, `Bašić`) e l'apostrofo emesso in tutt'e due le forme
(`N'Dicka` / `Ndicka`). **Un token reclamato da due uomini dello stesso club viene rifiutato** — l'Inter
ha due Martinez — perché *un aggancio ambiguo è peggio di uno mancante*.

Effetto misurato: **da 85,5% a 98,6%** (434 su 440). I sei residui sono tutti legittimi e dichiarati:
quattro ambigui (i due Martinez, per fonte), `Valde` che Sky scrive dove fantacalcio scrive
`Valdepenas`, e `Basic` che fantacalcio non elenca affatto. **Un nome non risolto conta come errore**,
quindi è un costo della NOSTRA identità e non un fatto sulla fonte: sta in una colonna sua
(`unresolved`) invece di essere sciolto nel punteggio in silenzio.

### QUANTO CI PRENDE
Per fonte e per club: **quanti degli undici che hanno davvero cominciato erano stati nominati**, col
denominatore che è l'undici vero — la stessa domanda per ogni fonte e per il null.

**UNA PREVISIONE PER PARTITA, l'ultima prima del fischio.** Chi pubblica due volte non deve pesare due
volte, e una lettura presa **dopo** il fischio non è una previsione: viene scartata.

**IL NULL È L'UNDICI CHE HA COMINCIATO LA PARTITA PRECEDENTE DI QUEL CLUB** — gratis, pubblico, e
nessuna fonte merita un voto finché non lo batte. È **APPAIATO**: stesse righe, stesso denominatore.
Scorare una fonte su quattro turni e il suo null su tre le regala il turno in cui sbaglia di più (il
primo, dove una partita precedente non esiste), quindi dove il null non può esistere la coppia
(club, turno) esce da **tutt'e due**.

Quanto pesa questa disciplina è **misurato rimettendo il difetto**: con il null non appaiato il margine
della fonte di prova passa da **+18,2 a +59,1 punti**, triplicato, e cadono esattamente i due asserti
che descrivono la cura mentre gli altri quattro restano verdi.

**NESSUNA COLONNA SUL MODULO, ed è una decisione e non una dimenticanza.** La pagina della verità dà gli
undici uomini e non il modulo disegnato, quindi l'unico modulo che se ne ricava è il CONTEGGIO dei loro
ruoli — tre linee, che non sanno dire un 4-2-3-1. Confrontare il «4-2-3-1» di un sito con un «4-4-2»
contato misurerebbe il nostro vocabolario e non la sua previsione: sull'archivio di questo progetto quel
disaccordo vale il **68,5%** degli undici. Il modulo che ogni sito dichiara resta in `Probabili`, dove si
può confrontare **fra siti** senza fingere che esista una risposta giusta contro cui misurarlo.

---

## 3-bis. La corsa vera da Google, e il difetto che ha trovato

**L'unica incognita che non si poteva misurare dall'Italia ha una risposta, ed è sì.** `probe()`
eseguito dall'operatore sui server di Google il 18/09/2026 alle 17:16:

```
fantacalcio.it:        HTTP 200 | 747 KB | real shapes 7 | clubs parsed 20 -> READABLE
sport.sky.it:          HTTP 200 | 481 KB | real shapes 6 | clubs parsed 20 -> READABLE
corrieredellosport.it: HTTP 200 | 523 KB | real shapes 6 | clubs parsed 20 -> READABLE
schedule: 10 fixtures, first kick-off Fri 18/09 20:45
round the page numbers: 5 of 2026-27
truth page (round 4): 0 clubs | 0 starters | NOT USABLE: 200 without elevens (1227753 bytes)
```

Tutte e tre le fonti si leggono **anche dagli IP di Google**, con gli stessi conteggi misurati da
casa (i KB differiscono di poco: è una pagina che cambia). Il calendario e il turno si leggono.

**E L'ULTIMA RIGA È UN DIFETTO VERO, trovato dall'ambiente e non dal banco.** La guardia di `fetch_`
— «un 200 senza moduli non è una pagina di formazioni» — è **giusta per le tre pagine di probabili e
sbagliata per la pagina dei voti**, che è una tabella di VOTI e porta **zero** moduli per
costruzione (misurato: 0 su 1,2 MB di pagina perfettamente completa). È «un parametro applicato
fuori dalla popolazione su cui è stato misurato», ennesima istanza.

La cura non è togliere la guardia ma darla al CHIAMANTE (`fetch_(url, minShapes)`): le fonti passano
il pavimento misurato (5), la verità passa 0 — perché `truth_` ne ha già una **più severa**, venti
club e undici ciascuno, asserita, che rifiuta il turno quando cade. *Una guardia debole davanti a una
forte può solo intralciarla.*

**PERCHÉ IL BANCO NON POTEVA VEDERLO**, ed è la lezione che vale oltre il caso: il banco **stubbava
`fetch_`**, cioè sostituiva proprio la funzione che contiene la guardia, quindi provava il parser
della verità e mai la guardia davanti. *Un banco che rimpiazza la funzione che tiene il controllo non
può provare il controllo.* Ora stubba `UrlFetchApp`, un livello più sotto, e la sezione riproduce il
difetto: con la guardia di default la pagina dei voti è **rifiutata**, senza è accettata.

**E il FUSO del progetto è dichiarato invece che assunto.** Gli istanti di calcio d'inizio si
costruiscono con `new Date(y, m, d, h, min)`, che è il fuso dello SCRIPT, e `planToday` confronta il
giorno di una partita con «oggi» nello stesso fuso: un progetto lasciato su un altro fuso armerebbe
ogni presa sbagliata dell'offset, in silenzio e proprio della quantità che su un fischio delle 15:00
nessuno noterebbe. `probe()` lo stampa e lo segnala se non è `Europe/Rome`.

## 3-ter. Il quadro STATO, perché un foglio muto non si distingue da uno rotto

Richiesta dell'operatore la stessa sera: «fai scrivere nel foglio di lavoro delle informazioni per
capire che sta funzionando». Tutto quello che questo file fa succede **mentre nessuno guarda**, e il
log di Apps Script lo vede solo chi apre l'editor: un foglio che resta vuoto non si distingue da uno
che non è mai partito, che è il difetto del **conteggio silenzioso** visto dal lato dell'interfaccia.

Il tab `Stato` è la prima scheda, è riscritto **intero** da chiunque abbia cambiato qualcosa (presa,
scoring, piano, probe) e dice, in quest'ordine: **cosa è stato fatto, cosa è armato, cosa manca**.

**IL VERDETTO IN CIMA DICE LA CONSEGUENZA E NON L'ETÀ**, che è la regola già scritta per la pastiglia
di freschezza dell'app: «si gioca oggi e nessuna presa è armata» è una frase su cui si può agire,
«ultima corsa 3 ore fa» è un numero da interpretare. Il colore segue la stessa regola e non è un
ornamento — verde niente da fare, ambra guarda, rosso **questo turno si sta perdendo adesso** — e i
casi sono distinti e provati: appena incollato dice `NON INSTALLATO`, installato e armato dice
`A POSTO` con l'ora della prossima partita, installato ma senza presa nel giorno della partita dice
`SI GIOCA OGGI E NESSUNA PRESA È ARMATA`.

Due cose che il tab dichiara invece di lasciarle dedurre: **«non ancora» e «MANCA» sono due frasi
diverse** per una fonte senza presa (prima del fischio è normale, dopo è un turno perso per quella
fonte), e la classifica porta scritto **come si legge** — il margine sul null, mai la percentuale da
sola. E `refreshStatus` non può far cadere chi la chiama: è sempre in un `try`, perché un quadro che
non si disegna non deve portarsi via una presa.

## 3-quater. Il FOGLIO è un lettore, e riscrive quello che gli scrivi

**18/09/2026, trovato dall'operatore e da me sulla stessa colonna nello stesso minuto, alla prima
presa vera.** La colonna `formation` leggeva **`4-3-2003`** per il Sassuolo, `4-4-2002` per il
Cagliari, `3-5-2002` per l'Inter: Google Sheets interpreta `4-3-3` come una **data** (4 marzo 2003) e
memorizza quella. Il parser aveva letto giusto — la stringa è corretta fino al `setValues`.

**E LA PARTE PEGGIORE È QUALI RIGHE SI SALVANO**: i moduli a quattro cifre (`3-4-2-1`, `4-2-3-1`,
`4-3-2-1`, `3-5-1-1`) non somigliano a una data e passano intatti, quindi **la maggioranza dello
schermo sembra giusta** e l'errore si concentra proprio sulle tre forme più comuni. È la famiglia del
difetto che «si spiega da sé con una storia plausibile»: uno sguardo distratto legge un anno e pensa a
un refuso della fonte.

La cura è dichiarare le colonne che devono restare TESTO (`TEXT_COLUMNS`, formato `@`), applicata a
**ogni** chiamata di `tab_` e non solo alla creazione, così un foglio costruito prima si ripara da sé
alla prima cosa che gira. Gli istanti ISO ricevono lo stesso trattamento per una ragione diversa: una
stringa che Sheets trasformasse in data-ora verrebbe ri-rappresentata nel fuso del foglio, mentre
quell'istante è UTC per decisione e deve restare confrontabile.

Quello che la cura **non** può fare è disfare le righe già scritte: un valore che è diventato una data
non è più recuperabile, e col formato testo si vedrebbe il numero seriale. Quelle righe si cancellano,
e non costa niente — ogni presa riscrive **tutti e venti** i club, quindi la successiva le rifà.

Due cose che restano. **Il costo è nullo sul punteggio e non è per questo che si cura**: il modulo è
reporting per decisione (§3, «nessuna colonna sul modulo»), quindi nessun verdetto si muove — ma è un
dato sbagliato in un foglio, ed è esattamente quello che qualcuno confronterebbe fra i siti. E **un
archivio non è solo quello che ci scrivi: è quello che il contenitore fa di ciò che ci scrivi**, che
è la stessa regola del BOM davanti a un CSV e della «à» che si scrive in due modi.

## 3-quinquies. «Tieni la piu' recente» avrebbe perso il venerdi'

**18/09/2026, dalla richiesta dell'operatore: «se catturo piu' volte la stessa giornata, devono essere
eliminate le righe vecchie».** Giusta nella sostanza e **letale alla lettera**, per una ragione che sta
nel calendario e non nel codice: **le partite di un turno non cominciano tutte insieme.**

La presa buona per Monza-Sassuolo e' quella del venerdi' alle 20:25; quella buona per le 15:00 di
sabato e' di sabato pomeriggio. Se ogni presa cancellasse le precedenti, la domenica sera l'unica
lettura superstite per la partita del venerdi' sarebbe **posteriore al fischio** — e lo scorer la
scarta, perche' una lettura presa dopo il fischio non e' una previsione. Quella partita resterebbe
**senza previsione per tutte le fonti**, in silenzio.

Quindi non «tieni la piu' recente» ma **«tieni quella che conta»**: l'ultima prima del fischio **di
quel club**. E con **UNA definizione letta da due** (`chosenTakes_`): se il potatore tenesse un
criterio e lo scorer ne usasse un altro, il foglio e il verdetto finirebbero per non essere d'accordo
su quale lettura e' valsa — il difetto che questo progetto paga piu' spesso, qui evitato per
costruzione. La funzione distingue `use` (quella che scora, vuota se non ce n'e' nessuna prima del
fischio) da `keep` (quella che il foglio tiene comunque, perche' una fonte che ha pubblicato solo
tardi ha comunque detto qualcosa, e una riga tolta si leggerebbe come una fonte che non ha detto
niente).

**Provato rimettendo il caso**: tre prese sul club del venerdi' (una presto, una alle 18:25, una della
domenica) piu' una sul club della domenica — 36 righe -> 22, del club del venerdi' resta **solo** la
presa delle 18:25, e dopo la potatura quel club **scora ancora 11/11**. Con la regola letterale
sarebbe stato 0.

Il prezzo e' detto: si perde la SERIE, cioe' non si puo' piu' chiedere quanto un sito cambia idea fra
il venerdi' e la domenica. Era una domanda su cui si era deliberatamente tenuta aperta l'opzione, ed e'
scambiata con un foglio che resta della stessa taglia a ogni turno — reversibile non chiamando la
potatura.

**E UNA PAGINA PER GIORNATA NON SERVE, misurato invece che stimato.** Con la potatura una stagione
intera sta in **33.440 righe e 0,57M di celle, il 5,7%** del limite di dieci milioni per foglio; senza
potatura sarebbe 267.520 righe e il 38,4%. Il vincolo vero non e' il numero di celle ma la **lettura a
tutto campo** (`getDataRange`) che lo scoring, la potatura e il quadro fanno a ogni presa: la cura per
quella e' restringere la lettura, non spezzare il foglio — e spezzarlo costringerebbe lo scorer, che
cammina tutti i turni, ad aprire trentotto schede.

## 3-sexies. La review, e i tre rilievi che la misura ha ridimensionato

**18/09/2026, code-review su richiesta dell'operatore: quindici rilievi, nove adottati, tre
ridimensionati dalla misura, tre lasciati come decisioni.** La regola di casa vale per la review come
per tutto il resto: e' un'ipotesi con un argomento, e la meta' verificabile si verifica.

**Adottati, tutti verificati rimettendo il caso:**
- `truth_` non asseriva i VENTI CLUB che il suo stesso docstring prometteva. Una pagina dei voti
  pubblicata mentre un posticipo non e' ancora votato porta meno blocchi, ognuno con undici titolari
  regolari: il controllo per club passava e il turno sarebbe stato scorato su 14 club invece di 20, in
  silenzio e per tutte le fonti insieme. Provato su una pagina troncata: adesso e' respinta con la sua
  ragione.
- `captureSummary_` sottostimava dopo la potatura — **198 giocatori su 18 club** per un turno preso
  intero, perche' teneva solo le righe dell'unico istante piu' recente mentre la potatura ne lascia di
  diversi apposta. *Un quadro che sottostima e' peggio di nessun quadro: manda a cercare un guasto che
  non c'e'.* Adesso legge 220 su 20.
- **La fotografia veniva buttata proprio quando serve**: un 200 rifiutato dalla guardia (un sito che ha
  cambiato marcatura) usciva prima della scrittura su Drive, con l'HTML gia' in mano. Ora si salva per
  ogni pagina che ARRIVA, prima di sapere il turno e qualunque cosa la guardia dica dopo.
- **fantacalcio giu' costava il turno a tutte e quattro**: senza il suo numero di turno la presa
  usciva, e le altre tre pagine — scaricate e a posto — non venivano scritte. Ora il turno ripiega
  sull'ultimo che il foglio ha registrato, e la riga dice quale dei due e'.
- **`Veri` era riscritto per intero** dai soli turni ancora presenti in `Probabili`, quindi togliere le
  prese di un turno ne cancellava anche gli undici veri — contraddicendo il docstring di `write_`.
  Adesso si APPENDE, e `Veri` diventa **la cache della verita'**: un turno completo non si riscarica.
- **E quella cache e' anche il limite**: prima lo scoring riscaricava ogni turno a ogni corsa, e due
  volte ciascuno (come turno e come null del successivo). A fine stagione sarebbero 76 pagine da 1,2 MB
  in una corsa delle 09:00 — un problema di quota E di limite dei sei minuti. Adesso e' una pagina a
  turno nuovo.
- `chosenTakes_` trattava una riga senza calcio d'inizio come sempre valida, quindi con il calendario
  illeggibile una lettura del giorno DOPO la partita sarebbe passata per previsione. Il calcio d'inizio
  e' un fatto della PARTITA e non della fonte: ora si prende da qualunque riga lo conosca.
- Il formato testo si riapplicava a ogni riga di log (`log_` -> `appendRows_` -> `tab_`): una scrittura
  di colonna intera per ogni riga. Una volta per esecuzione basta.
- Due risposte a una domanda: `probe` stampava `cal[0]` come «prima partita» e il quadro prendeva il
  minimo. Una definizione (`firstFixture_`), perche' un sito che raggruppa per giorno con la domenica
  in cima avrebbe fatto stampare una domenica sulla riga che serve a controllare l'anticipo.
- E **`LEAD_MINUTES` da 20 a 30**, per il SCHEDULATORE e non per il calcio: i trigger a orario di Apps
  Script non sono precisi e possono partire in ritardo, e una presa che cade dopo il fischio non e'
  tardiva, e' **inutile** — quella partita non scora per nessuno. Dieci minuti in anticipo costano una
  previsione un po' piu' vecchia; dieci in ritardo costano la partita.

**Ridimensionati dalla misura, e sono i tre che valgono di piu':**
- «Sky accoppia teste e moduli per indice, quindi i club sono sfasati»: **contato, oggi no** — 20 teste,
  20 moduli, 10 tabelle, e Monza 3-4-2-1 con Sassuolo 4-3-3, giusti. I sei moduli che discordano da
  fantacalcio sono **disaccordi veri fra le fonti**, che e' cio' che questo foglio esiste per misurare.
  Resta un rischio latente e ha ora la sua guardia: se i conteggi non tornano il parser **rifiuta**.
- «`repairFormations` sbaglia su un foglio in locale americano»: vero in astratto e **non per questo
  foglio**, dove il dato osservato (`4-3-3` -> `4-3-2003`) dice giorno-mese-anno. Scritto come limite
  invece che curato, perche' una cura su un locale che non si puo' osservare da qui sarebbe una
  congettura.
- «`MIN_CLUBS` = 16 fa confrontare fonti su popolazioni diverse»: vero, ed e' una scelta da prendere in
  chiaro — il null e' gia' appaiato per (club, turno), le FONTI fra loro no. Finche' non lo e', vale la
  regola gia' scritta: **il confronto autorizzato e' il testa a testa sulle partite che tutte hanno
  previsto**, e la colonna `clubs` dice su quante ognuna ha parlato.

**E i numeri delle quote, misurati sul nostro consumo** (Apps Script e' gratuito su un account
consumer; i limiti sotto sono quelli documentati da Google, il consumo e' nostro):

| | nostro | limite | |
|---|---|---|---|
| chiamate UrlFetch, giorno piu' carico | 18 | 20.000/giorno | 0,09% |
| tempo di trigger, giorno piu' carico | 2,2 min | 90 min/giorno | 2,4% |
| durata di una presa | ~20 s | 6 min per esecuzione | 5,6% |
| trigger attivi | 6 | 20 | |
| celle a fine stagione | 0,57M | 10M | 5,7% |

## 3-septies. La linea e' il FISCHIO, e la domanda che si misura e' la SUA

**18/09/2026, tre messaggi dell'operatore in fila, e il terzo decide.** «Anche dieci minuti di ritardo
va bene» -> «mezz'ora prima danno le formazioni ufficiali» -> «va bene 15 minuti prima del fischio
iniziale, **le formazioni ufficiali rientrano nel computo**».

**IL SECONDO MESSAGGIO E' IL FATTO CHE MANCAVA.** Avevo scritto «circa un'ora prima» a memoria e
temporizzato la presa a venti minuti dal fischio: con le ufficiali a MEZZ'ORA, quella presa stava dieci
minuti **dentro** l'annuncio, cioe' la lettura della prima partita del turno non era una previsione ma
una copia della risposta — proprio sulla partita per cui il file esiste. *Il regolamento della cosa vera
si chiede all'operatore, non si ricorda.*

**E IL TERZO CAMBIA LA DOMANDA, che e' sua da cambiare.** Non «quale sito prevede meglio» ma **«quale
sito, quindici minuti prima che io debba decidere, mi dice chi gioca»** — e a quella domanda un sito che
ha gia' riportato l'undici annunciato sta dando la risposta giusta, che e' quello che gli serve in quel
momento. La conseguenza si dichiara invece di nasconderla: dentro quella finestra la classifica misura
in buona parte **chi aggiorna prima**, non chi prevede meglio.

Quindi la scadenza dello scorer torna a essere il **FISCHIO** (verificato: una presa a 1 minuto e'
usata, una a 0 e' rifiutata), `LEAD_MINUTES` = 15 e' il suo numero, e `OFFICIAL_MINUTES` = 30 resta
**DICHIARATO e solo come reporting**: ogni riga scorata porta `after_official`, il quadro somma quante
letture sono cadute dentro l'annuncio e lo scrive accanto alla classifica. Cosi' il fatto viaggia senza
decidere, e la domanda vecchia resta rispondibile sullo stesso archivio — sul sottoinsieme in cui quella
colonna e' zero — senza dover ricatturare niente.

**E il fischio resta un confine vero anche con la sua regola**: oltre quello la pagina ha smesso di
rispondere alla domanda e il termine per consegnare la formazione e' passato comunque. Una presa che
slitta oltre non e' scorata male, non e' scorata affatto per quella partita, e le altre nove del turno
non ne risentono.

Una nota di forma pagata nello stesso minuto: aggiungere `after_official` alla classifica ha spostato
`updated_utc` di una colonna, e il quadro leggeva ancora l'indice vecchio — avrebbe stampato un
conteggio al posto di una data. Gli indici si prendono ora da `TABS` per nome, perche' **una colonna
inserita non deve poter far stampare la cella sbagliata**.

## 3-octies. L'APP LEGGE IL FOGLIO DAL VIVO, e il quarto stato non e' un dettaglio

**18/09/2026, richiesta dell'operatore**: «oltre alla formazione stagionale e ultimo periodo, una nuova
"prossimo turno" dove inserisci la formazione piu' probabile elaborando le informazioni recuperate dal
google sheet». E' il terzo pulsante della sezione Squadre (`app/src/app/ui/next-round/`,
`core/next-round.ts`, `core/next-round-store.ts`).

**LETTURA DIRETTA E NON DAL PACCHETTO, ed e' una sua decisione con una ragione misurabile.** Il bundle lo
scrive `export` sul suo portatile; le prese avvengono a un quarto d'ora da ogni calcio d'inizio, col
portatile magari spento - che e' tutta la ragione per cui il foglio esiste. Una board consegnata dal
pacchetto sarebbe **vecchia di un giorno proprio per le partite per cui serve**. Che l'origine dell'app
possa davvero leggere quell'endpoint e' stato MISURATO prima di scrivere una riga di vista
(`app/scripts/probe-sheet-endpoint.mjs`): **200, `type: cors`, 39.768 byte e 20 club** sia da gh-pages
sia da localhost. Una risposta `opaque` sarebbe stata un 200 che la pagina non puo' leggere - e un 200
non prova niente.

**E' UNA TERZA COSA E NON UN TERZO ORIZZONTE.** `season` e `short` sono le NOSTRE board, disegnate dal
toolkit e scelte su `ValuationStore.boardHorizon`; `next` e' la STAMPA, che qui e' il **giudice** delle
prime due e mai un loro input. Per questo la scelta vive in un campo della vista e NON dentro
`BoardHorizon`: infilarla li' la farebbe arrivare a `boardViewOf`, cioe' al lettore di `boards.json`, che
una board della stampa non ce l'ha e non deve averla. La frase che lo dichiara viaggia nel payload
(`what`) e la pagina la ripete invece di riscriverla - due copie della stessa affermazione finirebbero
per dirne due versioni.

**IL CLUB SI AGGANCIA PER `fc_id` E MAI PER NOME** (`nextClubFor`). Il foglio chiama i club con la sua
tabella di alias e l'app col nome canonico del listone: due vocabolari, e un join per stringa fra i due
e' il difetto che questo repository ha gia' pagato quattro volte - l'ultima ha perso **Milan, Roma e
Napoli** dal calendario di tutti, in silenzio. Tre uomini in comune bastano (`CLUB_JOIN_MIN`: uno solo
puo' essere un'identita' risolta male), e un **pareggio si rifiuta** invece di essere rotto.

**~~E' UNA LISTA E NON UN CAMPETTO~~ — RIBALTATO DALL'OPERATORE LA SERA STESSA**, e la ragione per cui la
prima versione era una lista regge comunque: mettere undici uomini sulle righe di un modulo e' un'
ASSEGNAZIONE, e un'assegnazione inventata qui sarebbe un secondo posizionatore piu' povero di quello del
toolkit. Le sue due richieste — «dagli 11 eletti prova a determinare modulo e mostrali nel campetto», poi
«utilizza i nostri algoritmi delle formazioni» — dicono come farlo senza inventare niente: **l'assegnazione
e' quella che gia' decide la legalita' di un undici mantra** (`mantra-legal.assign`, Kuhn sui posti TIPATI
del regolamento), e i moduli sono quelli di `mantra_modules.json`, letti e mai trascritti.

**I MODULI SONO QUELLI VERI, e le due strade sbagliate sono state percorse tutt'e due prima di
arrivarci.** Contando i RUOLI DI LISTONE un 3-4-2-1 non esiste (i due trequartisti sono `C`, quindi il
Milan legge 1-3-6-1) e quattro club su venti non stanno in nessun modulo. Coi POSTI TIPATI del
regolamento mantra e' peggio in un modo diverso, e l'operatore l'ha detto in una riga - «non pensare ai
moduli mantra, devono essere moduli reali»: quella e' la legalita' di un undici al FANTACALCIO, e il
Monza lo dimostra - nessuno schema mantra ha cinque difensori, e i suoi undici ne portano cinque perche'
due sono i QUINTI, che in un 3-4-3 giocano a centrocampo. Misurato, quella strada lasciava **6 club su
20** con un modulo solo.

Quello che regge e' la LINEA: ogni codice dice su quali righe quell'uomo puo' stare (`e` in difesa o a
centrocampo, `w` a centrocampo o in attacco, `t` in trequarti o a centrocampo), che sono regole gia'
scritte nelle trasformazioni del pannello e non invenzioni di qui, e un modulo va bene se l'assegnazione
riempie tutte le sue righe.

**I CANDIDATI SONO I MODULI CHE QUEL CLUB GIOCA, che MISURIAMO gia' noi**: `odds` di `boards.json` da' a
ogni modulo la probabilita' che quel club lo giochi. Non una lista scritta a mano - sarebbe una seconda
copia di una misura. E quando il suo repertorio non basta (il Cagliari gioca quattro schemi, tutti con la
difesa a quattro, e la stampa gliene annuncia uno a tre) si ripiega sui moduli veri che il pacchetto ha
visto negli ALTRI club: misurati, senza probabilita', quindi sempre dopo i suoi, **e la carta dice che
non sono roba di quel club**.

**I POSTI VENGONO DAL NOSTRO CAMPETTO, che e' la domanda dell'operatore** («non possiamo sfruttare lo
stesso meccanismo del claim e della formazione stagionale?»): il meccanismo non si ri-esegue, perche' il
suo RISULTATO e' gia' nel pacchetto uomo per uomo - il toolkit quell'assegnazione l'ha gia' risolta con
la sua ungherese e le sue riparazioni. Quindi la riga e la `x` di chi la board disegna (ballottaggi
compresi) sono le sue, e i codici restano il ripiego per chi la board non nomina.
**E LA BOARD SI AGGIUNGE, NON RESTRINGE**: la prima versione inchiodava ognuno alla riga del nostro
campetto e ha fatto smettere di disegnare Roma e Milan, perche' la stampa schiera un modulo diverso dal
nostro e li' qualcuno deve stare altrove. Il suo posto e' un suggerimento su dove gioca, non un veto su
dove puo' giocare — e dove pesa davvero e' nell'ORDINE dentro la riga.

**Dove si arriva, misurato sulla presa del turno 5**: **19 club su 20** disegnano. L'unico che non
disegna e' l'Inter, dove due dei nominati non sono su questo listone — di loro non si sa nemmeno il
ruolo, e «vuoto = ignoto» vale anche per un posto in campo.

**E CHI E' 3 SU 4 PORTA SOTTO L'ALTERNATIVA 1 SU 4** (sua richiesta): se una fonte mette qualcun altro su
quella maglia, quel nome si vede sotto il titolare, piu' piccolo e in grigio. Si mostra SOLO dove chi
occupa il posto non e' unanime — sotto un 4/4 non c'e' niente da vedere, perche' nessuno ha messo li'
qualcun altro — e quale delle maglie della riga prenderebbe non lo dice nessuno, quindi e' attaccato a
tutti i posti non unanimi di quella riga invece di essere appaiato a uno solo.

**UN MATCHING MASSIMO RISPONDE A «QUANTI», NON A «DOVE», e le tre segnalazioni dell'operatore sono
arrivate nello stesso minuto** (Roma, Como e Juventus). A parita' di cardinalita' qualunque assegnazione
va bene al matcher, e fra quelle ce ne sono di assurde: un centrale in mezzo al campo e un quinto fra i
tre difensori. Tre cure, e nessuna aggiunge un parametro.
1. **Prima a casa sua**: si prova l'assegnazione che rispetta la riga di CASA di ognuno - quella in cui
   la nostra board lo disegna, o quella del suo codice primario - e la si tiene solo se piazza tanti
   uomini quanti ne piazzerebbe quella libera. **La cardinalita' non si sacrifica**: un posto vuoto e'
   una bugia piu' grossa di un uomo fuori posto.
2. **I contesi ENTRANO nell'assegnazione**, con un rappresentante per maglia in ballo, e solo dopo il
   loro posto si svuota per scriverci tutti i nomi. Senza, il loro posto era quello che AVANZAVA: alla
   Roma i due centrali finivano a centrocampo perche' un quinto si era preso l'ultimo posto in difesa, al
   Como i due attaccanti finivano in mezzo al campo **col posto d'attacco vuoto**. Chi giochera' non lo
   dice nessuno; DOVE si gioca quella maglia si'.
3. **L'etichetta non si presta a una riga che non e' la sua**: la parola della board dice «Dc» di un uomo
   che la board mette in difesa, e stamparla su un posto di centrocampo sarebbe un'etichetta falsa. Meglio
   nessuna.

**E UN NOME SI SCRIVE UNA VOLTA SOLA** (sua richiesta, due volte in dieci minuti). Un'alternativa che puo'
giocare due righe compariva sotto due titolari (Vergara, a Napoli, sotto De Bruyne e sotto Lang): ora va
nella riga di CASA sua, e li' sotto il titolare meno votato, che e' la maglia piu' contendibile. E i
contendenti di una maglia sono **un gruppo solo**: spartirli per riga - la prima cura scritta, e il banco
l'ha bocciata - direbbe che sono due ballottaggi separati, mentre si contendono le stesse maglie. Il
gruppo sta in un posto, gli altri portano «stessa contesa»: i nomi una volta sola, i posti tutti e
undici, e l'aritmetica (tre uomini per due maglie) leggibile.

**UNA RIGA SI DISPONE CERCANDO, NON ORDINANDO.** La prima versione ordinava per «quanto sta male
all'estrema destra», e `laneCost` risponde ZERO a chi non ha nessun codice che parli: zero, in un
ordinamento crescente, vuol dire «primo» invece di «dove capita», e due punte centrali finivano larghe
(Lazio, Noslin e Pinamonti, segnalati dall'operatore). Ora si cerca la disposizione che COSTA MENO sulla
riga intera - le righe sono di cinque uomini al massimo, quindi 120 permutazioni e il minimo esatto,
nessuna euristica e nessuna priorita' da fissare fra il lato e la linea, che e' proprio la scelta che il
pannello del toolkit ha misurato come sbagliata in tutt'e due gli ordini.

**E UNA MAGLIA IN BALLO E' UN OCCUPANTE COME GLI ALTRI.** Costruire prima i titolari e appendere le
caselle contese in coda le faceva finire sempre all'estremita' sinistra: una coppia di CENTRALI si
disegnava al posto del terzino (Fiorentina, Dragusin e Pongracic; poi la Roma, dove i due centrali
contesi stanno ora in MEZZO ai tre dietro). Adesso l'ordine di una riga si decide su tutti e tre i tipi
di casella insieme - un uomo, un gruppo di contendenti, un posto che nessuno riempie - e il lato di un
gruppo e' la media dei codici di tutti i suoi: due centrali tirano al centro, due esterni verso la loro
fascia. Un posto vuoto non ha preferenze e va dove gli altri non vogliono stare.

**E I CONTENDENTI SI DISTRIBUISCONO PER MESTIERE** (sua istruzione: «a difesa i difensori, a centrocampo
i centrocampisti, in attacco gli attaccanti... segui i ruoli reali e non i fanta»). Due maglie in ballo
sono due caselle tratteggiate, e ognuno va in quella della sua linea: alla Fiorentina due difensori e due
attaccanti finivano nella stessa casella. La compatibilita' la dicono le LINEE dei suoi codici granulari
- i ruoli osservati - e il macro-ruolo di listone interviene solo per chi non ne ha.

**E CHI NON E' SU QUESTO LISTONE VA DOVE RESTA POSTO, invece di far sparire il campetto.** Tenerlo fuori
da ogni riga costava l'INTERO disegno: l'Inter non lo aveva per due nomi su tredici. «Vuoto = ignoto» non
vuol dire «vuoto = impossibile» - quello che l'ignoto impone e' di non dire dove gioca, e infatti il suo
posto resta SENZA ETICHETTA, che lo dichiara da se'. La PORTA no: li' gioca uno solo e sbagliarlo si vede
da lontano, quindi un ignoto non ci finisce mai.

**DUE GRAFIE DI UN UOMO SOLO, quando nessuna delle due ha la nostra chiave** (`mergeInitials_` nel `.gs`):
Sky scrive `Haps R.` e il Corriere `Haps`, e il conteggio leggeva due uomini da 1/4 invece di uno da 2/4.
Succede quando la pagina di fantacalcio non lo nomina affatto - l'indice delle identita' nasce da li'.
Si uniscono SOLO gli irrisolti, solo dentro un club, solo se il nome corto e' il prefisso dell'altro e
l'altro aggiunge soltanto un'iniziale, e **mai se un terzo nome somiglia a uno dei due**: unire
`Esposito` a `Esposito S.` dove all'Inter ce ne sono due sarebbe inventare una persona, che e' peggio del
conteggio spezzato che si sta curando.

**E NESSUNO SPARISCE DALLO SCHERMO**: se il posto rimasto vuoto e' di una riga che i contesi non possono
giocare, i due nomi si mostrano sotto il campo invece di non comparire — con la lista tolta sarebbero
spariti del tutto, e chi guarda non saprebbe nemmeno che c'e' una maglia in ballo.

**E LA LISTA RESTA SOLO DOVE IL CAMPETTO NON C'E'** (sua richiesta: «puoi togliere la lista, basta il
campetto»). Dove il modulo non si riesce a dire — 7 club su 20 oggi — senza le liste non resterebbe niente
da guardare, che e' peggio di una lista in piu'. Quello che si perde dove il campetto c'e' sono «gli altri
nominati», cioe' chi una fonte sola mette fuori dagli undici.

**IL PAREGGIO SI MOSTRA E NON SI ROMPE.** La prima versione prendeva gli undici piu' votati e spareggiava
sulla probabilita' e poi sul NOME, cioe' decideva l'undicesima maglia in ordine alfabetico. Sulla presa
vera del turno 5 capitava davvero - al Monza Cutrone e Colpani leggevano 2/4 con la stessa probabilita',
una monetina - quindi la lettura porta `certain` / `contested` / `contestedPlaces` e **nomina tutti e due
senza scegliere**. Trovato da un test scritto da me e fallito, non da una rilettura.

**I QUATTRO STATI DI UNA LETTURA DALLA RETE SONO QUATTRO PERCHE' NESSUNO SI LEGGE COME UN ALTRO**:
`idle` (nessuno ha ancora chiesto - la rete si paga solo se si apre la sezione), `loading`, `read`,
`unreachable`. Una board vuota e una rete muta non devono leggersi uguali: e' «vuoto = ignoto, mai zero»
applicato a una risposta HTTP, e senza la distinzione uno schermo senza nomi direbbe «le fonti non
schierano nessuno» mentre il vero significato e' «non ho parlato con nessuno».

**IL SECONDO SALTO DI APPS SCRIPT FALLISCE DA SE', E LA CURA E' RITENTARE.** Misurato il 18/09/2026 su
sei richieste separate: `script.google.com` ha risposto **302 sei volte su sei**, e il secondo salto
(`script.googleusercontent.com`, che porta un gettone monouso) **404 due volte**, con 5-27 secondi di
attesa; su altre cinque richieste col redirect seguito, due 404 da 33 e 48 secondi. Una richiesta nuova
riparte dal primo salto e ottiene un gettone nuovo, quindi `TRIES` = 3 **non nasconde un guasto**:
richiede la stessa cosa a un trasporto che fallisce per conto suo. Quello che non si fa e' tacerlo - il
messaggio dice quanti tentativi sono caduti, o un endpoint rotto davvero si leggerebbe come uno lento.
**Prima della cura il banco era verde una corsa su due**, che e' il modo in cui un difetto del trasporto
si fa scambiare per un difetto della vista.

**LA LETTURA SI TIENE SUL DISCO E LA RETE E' UN GESTO** (sua richiesta: «quando leggi da google sheet metti
in local storage, l'aggiornamento poi lo possiamo fare con un apposito tastino»). La sezione si apre PIENA e
senza rete, il che qui conta davvero visto quanto il secondo salto fallisce da se'; il prezzo e' che una
presa salvata puo' essere di ieri o di un altro turno, quindi **il giorno viaggia con lei e la pagina lo
stampa** («letto oggi alle 21:25», «letto il 17/09 alle 22:40»). Una rilettura che parte non fa sparire
quello che si sta guardando e una rilettura fallita non cancella una presa buona: si disegna cio' che si
ha, e lo stato lo dice la riga sotto. **Provato nel modo in cui una cache si prova** — bloccando
`script.google.com` nel browser e ricaricando la pagina: se il turno e' ancora li', viene dal disco, e non
c'e' altra spiegazione possibile.

**L'INDIRIZZO SI RISCRIVE DALLA PAGINA.** Apps Script cambia l'indirizzo a **ogni nuova distribuzione** -
e' successo due volte mentre il foglio veniva messo in piedi - quindi senza quella casella una
ridistribuzione richiederebbe una ricompilazione dell'app. Il predefinito sta nel codice, il valore vivo
in `localStorage`: una definizione e non due. **E' PUBBLICO e va detto**: la distribuzione e' su
«Chiunque», quindi quell'indirizzo serve nomi e undici derivati da pagine a pagamento a chiunque lo apra.
E' la stessa decisione gia' presa per il pacchetto su gh-pages, che espone molto di piu' - li' c'e' il
listone intero, qui un turno di probabili.

## 4. Com'è verificato

`probe()` risponde alla metà che si può misurare solo da lassù — se quei siti servono un server di
Google — e conta gli undici invece di fidarsi del codice di stato. Eseguito il 18/09/2026: §3-bis.

`scripts/gas/verify-parsers.mjs` risponde all'altra metà, che è quella che si romperà davvero: se le
espressioni scritte oggi leggano la marcatura di oggi. Fa girare **le stesse funzioni del `.gs`** in
Node contro le pagine salvate (fuori dal repo: sono contenuto a pagamento). Al 18/09/2026, tutto verde:

```
fantacalcio.it        rows 220 | clubs 20 | clubs with 11 20 | with fc_id 220 | with a shape 20
sport.sky.it          rows 220 | clubs 20 | clubs with 11 20 | with fc_id   0 | with a shape 20
corrieredellosport.it rows 220 | clubs 20 | clubs with 11 20 | with fc_id   0 | with a shape 20
club keys shared by all three: 20/20
identity: 216/220 (98,2%) sky · 218/220 (99,1%) corriere
truth rounds 2, 3, 4: 20 clubs · 220 starters · 220 distinct ids
schedule: 10 fixtures from two independent readers, agreeing on the first kick-off instant
```

**I due lettori del calendario concordano sull'istante**, il che non è una formalità: la presa è armata
su quel numero e uno sbagliato manca un calcio d'inizio di ore. *(Quel blocco è di prima che SOS Fanta
entrasse fra le fonti, nel pomeriggio dello stesso giorno: da allora le fonti misurate sono quattro.)*

**E il lato APP ha il suo banco** (`app/scripts/e2e-next-round.mjs`), che guida un Chrome vero sulla
pagina Squadre e confronta ogni riga **col payload scaricato da Node** — confrontare la pagina con
qualcosa ricavato dalla pagina è l'asserzione circolare che questo repository ha già pagato due volte.
Quello che NON rifà è la riduzione (chi entra, chi contende): quella la provano i test su dato
sintetico, e riscriverla nel banco sarebbe una seconda implementazione che può divergere. Al
18/09/2026, tre corse di fila:

```
Roma · turno 5 · 20 club nel foglio · 13 uomini nominati (11 agganciati al pacchetto)
il selettore ha 3 voci (Stagione / Ultimo periodo / Prossimo turno) · accesa: Stagione
dopo il click: 13 righe disegnate · posti del campetto nostro ancora a schermo: 0
righe a schermo che il foglio non conferma: 0 · uomini del foglio non disegnati: 0
certi 10 · contesi 2 per 1 maglie · fuori 1
```

**E la controprova è stata sbagliata la prima volta**: il difetto rimesso (stampare `/4` invece del
denominatore vero) era **inerte** su quel club, dove tutte e quattro le fonti hanno letto — quindi il
banco restava verde e sembrava cieco. Un fixture che darebbe lo stesso risultato col difetto rimesso non
prova niente; col difetto che muove davvero i numeri (`of/of` al posto di `votes/of`) il banco nomina le
quattro righe che non combaciano.

---

## 5. Quello che il primo turno ha detto — e la regola che ha cambiato

**21/09/2026. Il turno 5 è stato scorato, e il primo risultato riguarda il METRO e non le fonti.**

| fonte | nominati | quota | null | margine | anticipo medio | dopo le ufficiali |
|---|---|---|---|---|---|---|
| fantacalcio.it | 220/220 | 100,0% | 80,9% | **+19,1** | 15 min | 9 club |
| sosfanta.com | 218/220 | 99,1% | 80,9% | +18,2 | 15 min | 9 |
| sport.sky.it | 203/220 | 92,3% | 80,9% | +11,4 | 15 min | 9 |
| corrieredellosport.it | 179/220 | 81,4% | 80,9% | **+0,5** | **1815 min** | 0 |

**TRE FONTI ENTRO DUE PUNTI DALLA PERFEZIONE NON SONO TRE FONTI BRAVE: SONO UN METRO CHE NON MISURA
QUELLO CHE CREDE.** Con la presa a quindici minuti dal fischio *di ogni club*, un club della domenica
veniva fotografato la domenica — a formazioni ufficiali già uscite — e il log del foglio lo dice con
parole sue, dieci volte: «100% of the men are given at 100%: this reading may be the OFFICIAL line-up
rather than a forecast, and a source scored on it is being credited for copying the answer». La
guardia aveva funzionato: nessuno l'aveva letta.

**E LA QUARTA FONTE NON ERA QUARTA: ERA FUORI GARA.** Dal 19/09 ogni presa del Corriere è stata
rifiutata — `NOT TAKEN - 200 without elevens`, con la pagina che si assottiglia 457K → 433K → 408K →
381K → 328K → 304K → 276K — perché **toglie le partite già giocate** e scende sotto il pavimento dei
cinque moduli. È «un parametro applicato fuori dalla popolazione su cui è stato misurato»: il pavimento
è misurato su una pagina di PRE-turno e applicato a una pagina di METÀ turno. Gli resta la fotografia
del venerdì sera, da 72 a 2894 minuti prima delle singole partite. Quindi l'81,4% **non è un giudizio
sul Corriere**, ed è invece l'unico numero del turno che misuri davvero una PREVISIONE: a trenta ore di
distanza una previsione vale **+0,5 punti sul null**, cioè quanto l'undici della giornata precedente,
che è gratis. Una finestra sola, quindi una direzione e non un verdetto.

### 5.1 La regola nuova, dichiarata

**L'operatore, 21/09/2026**: «il meccanismo di lettura deve avvenire solo fino a quando la prima
partita del turno non inizia, dopo non si deve più aggiornare: si deve prendere la fotografia delle
predizioni per ogni sito solo quando le partite non sono ancora giocate!»

**UNA FOTOGRAFIA PER FONTE PER TURNO, presa mentre il turno è interamente da giocare.** È la stessa
definizione che questo progetto usa già per i giudici delle board — la stampa è il solo giudice che
esista prima che si giochi una palla — e cambia la domanda che la classifica risponde: non più «chi mi
dice chi gioca quando devo decidere», ma «chi lo prevede».

**E NON È UN CAMBIO DI IDEA: È LA SUA RICHIESTA ORIGINALE, che il codice aveva perso per strada.** La
prima riga di tutte, 18/09, diceva «per ogni giornata di serie-a, **subito prima dell'inizio del primo
anticipo**, scansioni i siti principali»; la precisazione della sera diceva «va bene 15 minuti prima del
**fischio iniziale**», e l'implementazione ha letto «fischio iniziale» come il fischio di ogni partita.
La seconda frase è ambigua in italiano, la prima no — quindi *la deriva è cominciata da una
precisazione letta senza rileggere la richiesta che precisava.* Vale oltre il caso: quando una frase
nuova dell'operatore è ambigua, la disambigua quella vecchia, non la comodità di chi implementa.

**IL PREZZO È DICHIARATO E VA ASPETTATO**: contro l'apertura gli altri diciannove club sono lontani da
uno a tre giorni, quindi **tutte le quote scenderanno** e qualcuna arriverà al null. È il punto: il null
è quello che una previsione deve battere.

**E QUELLO CHE NON COMPRA**: i due club dell'apertura restano dentro la finestra delle ufficiali, perché
a quindici minuti la loro formazione è annunciata. Due club su venti, e non sono nascosti —
`after_official` marca esattamente quelle righe, ed è un numero da leggere e non un'avvertenza da
ricordare.

**Conseguenza sull'app, che va detta**: «Prossimo turno» smette di aggiornarsi quando il turno comincia,
perché non ci sono più prese. È quello che la regola chiede; se un giorno servisse la lettura fresca
durante il turno, la strada è che il pruner tenga anche l'ultima lettura oltre l'apertura, non che lo
scorer la legga.

### 5.2 I tre difetti che il primo turno ha trovato

- **UN ANTICIPO IGNOTO VENIVA LETTO COME «PRIMA DELLE UFFICIALI».** `after_official` è `lead_min <
  OFFICIAL_MINUTES`, e la cella è vuota quando la presa non riuscì a leggere il calendario in
  quell'istante: `Number('') < 30` è falso, quindi **33 letture su 80** risultavano previsioni senza che
  nessuno lo sapesse. Sul turno 5: 27 certamente dopo le ufficiali, 33 ignote, 20 (tutte del Corriere)
  previsioni vere. Peggio, la CAUSA è due letture della stessa cosa dentro una funzione sola —
  l'ammissibilità recuperava il calcio d'inizio da qualunque riga del turno lo conoscesse, il `lead` no.
  Curato dai due lati: il lead si recupera con lo stesso indice, e dove non si recupera
  `after_official` resta **vuoto**. «Vuoto = ignoto, mai zero», rotto nella sola colonna che esiste per
  distinguere una previsione da una copia.
- **«TURNO 6 PERSO» ERA UN FALSO ALLARME**, e in rosso. Il numero del turno lo dà fantacalcio, il
  calendario lo danno Corriere o Sky, e non cambiano nello stesso momento: lunedì mattina l'ancora
  diceva già 6 mentre le pagine portavano ancora le dieci partite del 5, tutte giocate. Il verdetto
  confrontava le due cose come se fossero la stessa. La discriminante è PROVABILE dal foglio invece che
  indovinata: se l'apertura che il calendario mostra è un calcio d'inizio **già archiviato sotto un
  turno precedente**, il calendario è quello vecchio — e la frase diventa «in attesa del calendario del
  turno 6». *Un allarme che suona sullo stato normale di un lunedì mattina è un allarme che si impara a
  ignorare.*
- **L'INTESTAZIONE DEL FOGLIO ERA VECCHIA DI UNA COLONNA.** `after_official` aveva spinto `updated_utc`
  di un posto e la scheda `Attendibilita` mostrava **`updated_utc: 9`**. Il codice era immune — ogni
  lettore passa da `TABS[...].indexOf(name)` — e la persona che legge il foglio no. Adesso `tab_`
  ripara l'intestazione una volta per esecuzione, come già faceva col formato TESTO delle colonne.
- Minore, e della stessa famiglia: un trigger chiama il suo handler **con un oggetto evento**, quindi
  `capture` stampava `[object Object]` come propria ragione in **25 delle 36 righe** che ne portano una
  — cioè diceva chi aveva lanciato la presa sulle corse fatte a mano e taceva su quelle che nessuno
  guardava, che è il verso sbagliato.

### 5.3 E il turno 5 si può rifare, perché le fotografie ci sono

`recover(round)` — voce di menù «Re-read a round from the photographs...».

**L'intestazione di questo file promette dal primo giorno che «le fotografie SONO la serie storica, e le
righe del foglio sono una lettura derivata che si può rifare», e niente le rifaceva.** Una replica
offline che nessuno chiama è una cache che non esiste, che è la regola che questo progetto ha già
scritto su `recent_form.reingest_from_cache`.

Quello che compra il giorno in cui è scritta: il turno 5 è stato preso con la regola vecchia e poi il
pruner ha tenuto **una lettura per fonte e per club**, la tardiva. Quindi nel foglio le letture
pre-apertura, che sono quelle che la regola nuova vuole, non ci sono per nessuna fonte su nove club di
venti. Su Drive ci sono: **43 fotografie** — e il conto torna esatto con le undici prese dei tre giorni
— quattro delle quali scattate alle **20:30 di venerdì 18/09**, quindici minuti prima di Monza-Sassuolo.

Tre proprietà, e la prima è quella che rende sicuro rigiocare: **è idempotente** (una riga già presente
a quel minuto non viene riscritta, quindi una fotografia le cui righe sono sopravvissute in parte
contribuisce solo quelle che mancano); **aggiunge e non toglie mai** — le letture tardive restano dove
sono, e sotto la scadenza nuova lo scorer semplicemente smette di leggerle, quindi adottare la regola
nuova non distrugge la misura fatta con quella vecchia; e **l'apertura si legge dal FOGLIO e non dal
calendario di oggi**, perché un turno si recupera mesi dopo che le sue partite hanno lasciato i siti —
un turno le cui righe non portano nessun calcio d'inizio non ha apertura, e lì `recover` **rifiuta**
invece di indovinare, o rigiocherebbe come previsioni delle fotografie scattate a turno in corso.

La stessa guardia della presa dal vivo decide se una fotografia è una pagina di formazioni
(`believable_`, estratta da `fetch_` e condivisa): *una replica che credesse a pagine che la presa aveva
rifiutato misurerebbe una regola diversa.*

**Come si rifà il turno 5**: incollare il file nell'editor, poi menù → *Re-read a round from the
photographs...* → `5`, poi *Score the played rounds*. Il Corriere rientra in gara con la stessa scadenza
degli altri tre, e per la prima volta le quattro fonti sono confrontabili.

### 5.5 Rifatto — e la classifica cambia

**21/09/2026, ore 22:00. `recover(5)` ha rigiocato DUE fotografie pre-apertura** (18/09 alle 17:33 e
alle 18:30 UTC) e rimesso **1452 righe**; l'idempotenza ha fatto il suo lavoro e lo dichiara nel Log
(«22 already there» per i due club dell'apertura, «nothing to add» per il Corriere sulla presa in cui
le sue righe c'erano già). Le altre due prese di quella sera non hanno una fotografia su disco: sono le
primissime, di quando il file salvava la pagina *dopo* il parsing invece che prima. Non costa niente —
quella che conta è l'ULTIMA prima dell'apertura, e c'è per tutte e quattro le fonti.

| fonte | prima (regola vecchia) | **adesso** | margine | non risolti | anticipo |
|---|---|---|---|---|---|
| sosfanta.com | 99,1% · +18,2 | **90,9%** (200/220) | **+10,0** | 2 | 14-2895 min |
| fantacalcio.it | 100,0% · +19,1 | **89,1%** (196/220) | +8,2 | 0 | 14-2895 |
| sport.sky.it | 92,3% · +11,4 | **89,1%** (196/220) | +8,2 | 5 | 14-2895 |
| corrieredellosport.it | 81,4% · +0,5 | **81,4%** (179/220) | +0,5 | 4 | 72-2894 |

**IL CONTROLLO CHE VALE PIÙ DELLA TABELLA È L'ULTIMA RIGA: il Corriere non si muove di un decimale.**
Era l'unica fonte già misurata così — le sue prese successive erano state tutte rifiutate, quindi
scorava sulla fotografia del venerdì — e infatti la regola nuova non la tocca. Le altre tre scendono di
3-11 punti. *Una correzione che muove tutto tranne il caso che era già corretto è una correzione che ha
mosso la cosa giusta.*

**E IL PRIMO POSTO CAMBIA MANO, ma non è quello il risultato.** Appaiando club per club, sosfanta batte
fantacalcio **6 a 3 con 11 pari** (p = 0,51) e Sky **4 a 1 con 15 pari** (p = 0,38): fra i tre non c'è
niente. C'è invece contro il Corriere, **12 a 0 con 8 pari** (p = 0,0005). E la distanza fra i tre è
**più piccola del costo della nostra identità**: se i nomi non risolti fossero tutti azzeccati, Sky
andrebbe a 91,4% e sosfanta a 91,8%, cioè appaiati. Quindi quello che questo turno dice è: **tre fonti
insieme, una staccata**, e non una graduatoria fra le prime tre.

**QUANTO VALE UNA BUONA FONTE, in chiaro**: +10 punti su 220 uomini in 20 club sono **1,1 uomini per
club** — leggere sosfanta invece di ricopiare l'undici della giornata prima ti dice un titolare in più
per squadra. Il Corriere a +0,5 ne dice **uno su tutto il turno**, cioè niente: a trenta ore
dall'apertura la sua previsione vale il null.

**Le due colonne curate lo dicono sui dati e non solo nel codice**: `after_official` **6 su 80** (i due
club dell'apertura per le tre fonti che li prendono a 14 minuti; il Corriere li prende a 72 e resta
fuori dalla finestra) contro le 27 di prima, e `lead_unknown` **0 su 80** contro 33 — la rilettura ha
riattaccato il calcio d'inizio a ogni riga, perché la fotografia porta con sé il calendario di quel
momento. Il verdetto in cima al foglio è «IN ATTESA DEL CALENDARIO DEL TURNO 6» e non più «TURNO 6
PERSO».

**Resta vero quello che §5.4 aveva scritto prima di giocare**: venti club sono venti osservazioni, e la
riga da leggere è il margine. Con un turno solo l'unica affermazione che regge il test dei segni è
quella sul Corriere.

### 5.4 Quello che il primo turno non potrà dire comunque

*Scritto il 18/09/2026, prima che si giocasse: tenuto com'era, perché è la previsione a cui i numeri di
§5 vanno confrontati. La riga «non c'è ancora nessun verdetto» descrive quel giorno e non oggi.*

Il foglio parte **vuoto**: la prima presa è quella del turno 5 (primo fischio venerdì 18/09 alle 20:45,
Monza-Sassuolo). Quindi **non c'è ancora nessun verdetto**, e questa è la metà da dire per prima.

Quello che si può già dire è che le fonti **dissentono davvero**, cioè che la domanda ha un contenuto:
sul Monza di quel turno Sky mette Törnqvist in porta e Corriere mette Thiam, e Corriere schiera
Bakoune, Colpani e Zeballos dove fantacalcio non li mette fra gli undici.

E quello che il primo turno **non** potrà dire: venti club sono venti osservazioni, e il null è forte —
sulla giornata 4 l'Atalanta ha tenuto **9 degli 11** titolari della giornata prima. Una fonte che ne
nomina 9 su 11 vale *esattamente il null*. Servono turni, e la classifica va letta col **margine sul
null** accanto alla percentuale, mai la percentuale da sola.

---

## 6. Aperti

- ~~**Le due fonti che l'operatore nomina e che restano fuori.**~~ **CHIUSA A METÀ il 18/09/2026**: SOS
  Fanta è DENTRO (§1 porta la ritrattazione del verdetto e perché era sbagliato due volte), quindi le
  fonti misurate sono **quattro**. Resta fuori la **Gazzetta**, che dichiara il proprio muro: entrerebbe
  con delle credenziali o con una trascrizione a mano.
- **Il campetto della stampa, se un giorno servisse.** Oggi «Prossimo turno» è una LISTA, per la ragione
  scritta in §3-octies. Disegnarlo su un campo vuole due cose che oggi non ci sono: il MODULO dichiarato
  dalle fonti dentro il payload (la colonna c'è nel foglio, `nextRound_` non la esporta) e una regola di
  posizionamento che non sia un secondo assegnatore più povero di quello del toolkit — con gli slot che
  non si riescono a riempire lasciati VISIBILMENTE vuoti, o il disegno direbbe più di quanto le fonti
  abbiano scritto.
- **Il lato toolkit non esiste in questo albero.** Una versione locale (modulo Python, guardiano
  PowerShell, prese pre-registrate) è stata scritta oggi da un'altra sessione e **non è più su disco né
  in git**: quello che c'è qui è il foglio, che è autosufficiente. Se quel lato torna, la regola da
  tenere è che i due **non devono scorare due volte la stessa cosa**: una definizione di «quanti undici
  ha indovinato», o una fonte finirà per avere due voti.
- **Le nostre previsioni come quarta fonte.** I campetti sono pubblici su gh-pages
  (`boards/leghe.json`, 393 KB, HTTP 200 in anonimo), quindi il foglio potrebbe leggerli e sedersi al
  confronto. Va fatto con le tre asimmetrie dichiarate: il campetto porta le dichiarazioni
  dell'operatore, è calcolato quando il portatile lo costruisce (non a ridosso del fischio, e l'anticipo
  va stampato), e l'orizzonte da usare è quello **corto**, perché è quello che risponde alla stessa
  domanda delle fonti.
- **Due letture nello stesso giorno.** Oggi vengono appese entrambe e lo scorer tiene l'ultima prima
  dell'APERTURA del turno, che è il comportamento voluto. La serie c'è se un giorno servisse.
- **IL TURNO 6 È IL PRIMO RISCHIO, e non è teorico** (22/09/2026). Alle 00:01 il foglio leggeva ancora
  il calendario del turno 5; il pianificatore gira alle 9:00 e se le pagine non hanno pubblicato il
  turno nuovo non arma niente. Lì **`recover` NON salva**, perché senza presa non esiste nemmeno la
  fotografia da rileggere: *una replica salva da una lettura sbagliata, non da una presa mancante.* La
  contromisura è una *Capture now* a mano prima del primo fischio. Una cura vera sarebbe un secondo
  tentativo del pianificatore nel pomeriggio, o leggere il calendario da SOS Fanta (che dichiara gli
  istanti in ISO) quando gli altri due sono fermi al turno passato — non misurato, quindi non scritto.
- **La lettura fresca durante il turno, per l'app.** «Prossimo turno» smette di aggiornarsi quando il
  turno comincia, perché non ci sono più prese: è quello che la regola chiede. Se un giorno servisse, la
  strada è il PRUNER — fargli tenere anche l'ultima lettura oltre l'apertura, che lo scorer già ignora
  per definizione — e mai lo scorer, o si rimette dentro la contaminazione appena tolta.
- **Il secondo turno è il primo preso davvero con la regola nuova.** Con uno solo, l'unica affermazione
  che regge il test dei segni è quella sul Corriere; il resto è una banda di tre fonti larga meno del
  costo della nostra identità.
