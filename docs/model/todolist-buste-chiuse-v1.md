# Todolist BUSTE CHIUSE v1 — la pagina delle aste a busta chiusa

**Nata il 24-25/08/2026**, dalla richiesta dell'operatore di una pagina dedicata alle **aste a busta
chiusa** della sua lega («chiagnister 26-27», Serie A classic, 10 squadre). Gli item sono **ordinati per
resa attesa**, come `todolist-draft-v1.md` e `todolist-formazioni-tipo-v1.md`. Le misure stanno qui dentro
perché non esiste ancora un documento loro; quando ce ne sarà uno, **citare da lì e non da qui**.

---

## Il gioco, e perché è diverso dagli altri due che il progetto già conosce

Non è l'asta dal vivo del pannello né il draft del banco. Ogni fantallenatore scrive un'offerta in una
busta senza vedere le altre; alla scadenza si aprono tutte, **vince l'offerta più alta e paga il proprio
numero** (primo prezzo), chi perde non spende niente, e **in parità non lo prende nessuno** — il
calciatore torna bustabile al round successivo. Il regolamento dell'operatore, dichiarato il 24/08/2026:

- **1000 crediti** a squadra, rose **Classic 3-8-8-6** (25 uomini);
- **9 round** previsti, **una busta per slot libero**;
- **ruolo pieno = fuori dal mercato di quel ruolo** — che è il fatto più sfruttabile che il regolamento
  regali su un rivale, perché non è un'ipotesi;
- la competizione va dalla **2ª alla 38ª giornata di Serie A**, cioè **37 giornate su 38**.

Quindi la quantità che decide una busta non è «quanto vale» ma **«quanto ci vuole»**, e sono due domande
diverse con due risposte diverse — la stessa forma dei due zeri del surplus.

---

## Quello che c'è già (fatto il 24-25/08/2026)

Codice: **`app/src/app/core/sealed-bid.ts`** (dominio, zero Angular, 55 prove nel suo spec),
**`app/src/app/views/sealed-bid/`** (la pagina, rotta `/sealed-bid`),
**`app/scripts/e2e-sealed-bid.mjs`** (arnese e2e a zero dipendenze, sullo schema di `e2e-table.mjs`).
Alla chiusura della sessione: **406 prove verdi**, `ng build` verde, e2e **senza problemi** — e a
fine giornata **482** (i §7-8 qui sotto), sempre col build verde e l'e2e senza problemi.

- **Lo stato di ogni squadra** dal CSV delle rose che la lega esporta: speso, residuo, slot liberi per
  ruolo, e il **tetto** (il massimo che può stare in UNA busta lasciando un credito per ogni altro slot).
- **La pressione** — quanto in profondità arriva la domanda ancora aperta del suo ruolo. Nata come
  surrogato di «quanti lo vogliono», misurata sul round 1: predice il prezzo pagato **meglio dell'FVM**
  (Spearman **+0,738** contro **+0,719**) ed è la stessa quantità in ogni round, mentre un conteggio di
  rivali interessati non lo è (nel round 1 tutti avevano 25 slot, quindi ogni buona lista era lunga).
- **Il prezzo consigliato per analogia**: i casi simili davvero accaduti, non una curva. Il modello ovvio
  (spartire i crediti in proporzione all'FVM) è stato scritto per primo e **misurato sul round 1**:
  errore relativo mediano **58%**, solo **54%** delle aggiudicazioni dentro una forchetta 0,5×-2×. Un
  prezzo vincente non è un prezzo, è il **massimo** di quante buste sono arrivate.
- **La probabilità di vincere** ogni busta, letta con `<` stretto perché **pareggiare non è vincere**, e
  da lì **spesa attesa** e **buste attese** — che non sono il tetto.
- **Il registro delle nostre buste**, con la probabilità che portavano **al momento della spedizione**
  (non ricalcolata dopo, o si giudicherebbe il modello con una scala che ha già letto il round da
  giudicare), e il riepilogo del round successivo: vinte, perse, e **parità** dedotte (se abbiamo bustato
  su un uomo e non risulta a nessuno, qualcuno ha scritto il nostro stesso numero).
- **L'offerta modificabile a mano**, con la percentuale che la segue mentre la scrivi.
- **Le alternative** per ogni slot, perché una scelta automatica dev'essere dubitabile.

### Due difetti trovati costruendo, che valgono oltre questa pagina

- **Un prezzo IGNOTO non è un prezzo zero.** 82 righe del foglio su 605 non hanno una quotazione sul
  listone Serie A; leggendo quel vuoto come FVM 0 finivano «fuori dalla domanda» e quindi nella banda più
  economica, cioè **consigliati a 2 crediti come occasioni**. Uno era entrato nel piano vero. Ora la
  pressione è `null` per loro, non entrano nel piano automatico, restano scegliibili a mano con un `?`.
- **L'orizzonte della competizione è un'UNITÀ, non un segnale.** 37 giornate su 38 moltiplicano ogni
  numero per 0,974 **per tutti**: stessi nomi, stesse offerte, stesso ordine. Una prova lo afferma, così
  nessuno lo scambia per un canale.

---

## Le misure del round 1 (125 aggiudicazioni + 31 offerte vere)

**Cosa compra la stanza.** Il prezzo pagato ordina con l'**FVM** a +0,719 e col **surplus del motore** a
+0,508: bustano sul prezzo. Non è una lamentela, è il margine — dove il nostro numero e il loro
divergono, la divergenza si compra al prezzo dell'opinione più economica.

**Quanto è costato vincere**, per posizione dentro la domanda del ruolo:

| banda | n | a 1-2 cr | mediana |
|---|---|---|---|
| testa (67-100%) | 62 | 7 | 49 |
| metà (33-67%) | 32 | 10 | 11 |
| coda (0-33%) | 11 | 6 | 2 |
| fuori dalla domanda | 20 | 14 | 2 |

**37 aggiudicazioni su 125 sono costate 1-2 crediti**, e fra quelle Mora (FVM 100), Zaniolo (90),
Da Cunha (90), Vlasic (75), Dybala (70).

### Le 31 offerte vere (10 giocatori, dagli screenshot «Busta conclusa» del 25/08/2026)

Validate prima di usarle: **vincitori e prezzi coincidono uno per uno col CSV delle rose**, e
Gudmundsson A. «Non assegnata» è proprio il giocatore che risultava ancora libero nel pool.
Dati grezzi: `scratchpad/bids_round1.json` (non in git — sono contenuti della lega).

1. **Il campo è minuscolo.** Da 2 a 6 offerenti su 10 squadre, mediana 2,5. Su **Thuram** (FVM 280) hanno
   bustato in **tre**, due dei quali a 2 e 3 crediti.
2. **Il margine di vittoria è bimodale.** La seconda offerta è **≤3 in cinque casi su nove**; quando non
   lo è vale 17, 28, 111, 186. Fra 3 e 17 non c'è niente. Zaccagni vinto **112 contro 111**, Paz N. **188
   contro 186**; e all'opposto Thuram 182 contro 3, Scamacca 71 contro 2.
3. **La parità esiste**: Gudmundsson A., due offerte da 2, a nessuno.
4. **La disponibilità a pagare di un rivale non è la sua spesa.** AngeloAzzurro ha offerto **550** crediti
   su quattro nomi e ne ha portati a casa **253**, perdendo due volte per 1 e 2 crediti. Si vede solo con
   le perdenti.
5. **Le nostre buste del round 1 su quei dieci: 10 spedite, 0 vinte** (1,1,1,2,2,2,2,3,17,173), vicini una
   volta sola (Paz N., mancavano 16). **Attenzione: quei dieci non sono un campione casuale** — sono
   presumibilmente i contesi, e con le stesse buste da 1-2 crediti abbiamo vinto 13 uomini altrove.

### Un'idea MISURATA E SCARTATA, da non riprovare

**«La stanza busta a numeri tondi, quindi offrire 51 invece di 50 evita le parità e costa un credito.»**
Falso: sui 125 aggiudicati sopra i 5 crediti i multipli di 10 sono il **13%**, i dispari il **54%**, e
l'ultima cifra più frequente è già `...1`. Il trucco lo fanno di loro. Restano vere le parità in fondo
(Gudmundsson a 2), ma la cura è **alzare** la busta bassa, non renderla dispari — item 1.6, già fatto.

---

## Gli item aperti, per resa attesa

### 1 — Il campo, che è l'unica cosa da battere

**1.1 · Recuperare le buste di TUTTO il round 1.** *Acquisizione, e moltiplica ogni item sotto.* Le
offerte sono **pubbliche** (l'operatore, 25/08/2026). Con tutte: la contesa si **conta** invece di
stimarla (la `pressione` è nata come surrogato proprio di quello), il campione passa da 125 vincenti a
~250 offerte per round, e la funzione di valutazione di ogni rivale diventa osservabile. Precedente
buono: sul draft, leggere la testa di un rivale dalle sue scelte azzecca l'**82,8%** contro il 69,2%, e
**bastano due scelte** (`todolist-draft-v1.md`). Oggi si hanno solo 10 giocatori via screenshot; serve
una via più veloce (pagina, export, o lettura sistematica delle schermate).

**1.2 · Prevedere la SECONDA offerta, non il prezzo.** Per vincere basta battere il massimo degli altri,
e con la distribuzione bimodale (§2 sopra) la domanda giusta non è «quanto vale» ma «c'è qualcuno che fa
sul serio, e a quanto». Il consiglio dovrebbe avere due rami dichiarati — «se sei solo bastano 4; se
c'è un serio, per un FVM come il suo sono serviti 17/28/111/186» — invece di un percentile solo.
Dipende da 1.1 per avere abbastanza casi.

**1.3 · La disponibilità a pagare di ogni rivale, dalle sue offerte.** Il caso AngeloAzzurro: 550 offerti,
253 vinti, 411 crediti ancora in mano. La classifica per spesa lo sottovaluta. Dipende da 1.1.

### 2 — Difetti veri nella pagina di oggi

**2.1 · ~~Il tasso di conversione del giudizio deve essere vincolato agli slot.~~ FATTO il 25/08/2026.**
`verdicts` moltiplicava i crediti di ciascuno per **un unico tasso di lega**, ignorando quanti slot e
quali ruoli gli restassero: MaCheMollo (361 crediti, **5** slot, di cui 3 attaccanti) leggeva 106,
Andreolana (377 crediti, **13** slot) 111. Due situazioni opposte, praticamente lo stesso numero.
Adesso si calcolano tutt'e due le metà e **vince la più piccola**: quello che i crediti comprano al
tasso della stanza, e quello che i suoi slot ancora aperti possono assorbire alla profondità che quel
ruolo ha adesso (`marketRate.perSlot`, per ruolo perché un credito non è fungibile quando gli slot non
lo sono). Un credito senza uno slot dove spenderlo vale esattamente zero — è lo stesso argomento che
rende lo zaino un problema di SLOT e non di efficienza. Ne esce anche `Verdict.reach`, «i soldi che ha
tenuto sul lavoro che gli resta», che è il numero che la classifica non sapeva dire.

**2.2 · ~~Lo stato del giocatore in riga.~~ FATTO il 25/08/2026.** `ui-flags` con `[playerId]` nelle
buste, nelle alternative e nella modale: infortunio aperto, rientro recente, fragilità, note dichiarate.
Riuso vero — stesso componente e **stesso servizio** della tabella calciatori, quindi «è infortunato» ha
una definizione sola: due risposte diverse alla stessa domanda si scoprirebbero al tavolo.

**2.3 · La giornata già giocata accanto al nome. BLOCCATO sul BUNDLE, non sul codice** (verificato
25/08/2026: `match_ratings` nel bundle si ferma a **2025-26**, 12.686 righe `default` e 17.800 `euro`,
zero righe 2026-27 — il pacchetto è del 20/08, la giornata si è giocata dopo). Serve un `export` nuovo
dalla sessione che possiede il DB; il codice dell'app non c'entra. Quando arriva:
la giornata 1 di Serie A 2026-27 è in DB (339 righe,
20 club, recuperata il 25/08 dopo che il resume dell'update l'aveva saltata). Quattro delle dodici buste
del piano sono su uomini **non convocati** alla prima. Attenzione al limite: `started` e `minutes` sono
NULL su tutte le righe (l'Excel dei voti non li porta), quindi l'unica frase disponibile è «ha preso il
voto» o no — e **sotto le quattro giornate non esiste regola misurata** (la regola a due-tre giornate
vale 81% contro una base del 58%).

**2.4 · ~~L'SpM accanto all'offerta.~~ FATTO il 25/08/2026**, come PASSO del ragionamento e non come
tooltip. «Il motore, convertito in crediti su una lega come la tua, lo prezza N: con la tua offerta stai
pagando sopra / restando sotto il suo metro», con l'avvertenza attaccata — è tarato sul listone intero
**prima** che il mercato cominciasse, quindi come confronto sì e come verità no.
**E il posto in cui NON metterlo l'ha deciso una misura**: infilato nel tooltip dell'offerta, quella
frase lo faceva diventare alto abbastanza da **coprire il campo che spiegava** —
`document.elementFromPoint` sul numero rispondeva `div.ant-tooltip-inner`, e la suite leggeva «ho
scritto 55 e il campo legge 1». Un tooltip resta di due righe; il resto va dove c'è spazio.

### 3 — Struttura

**3.1 · I nove round, non uno. META' FATTO il 25/08/2026, e la metà giusta.** Quello che si poteva
fare senza inventare un parametro è **dire dove ti lascia questo round**: «dopo questo round 66 crediti
per 3,2 slot ancora da riempire — 20 a slot contro i 35 che paga il mercato adesso — e 7 round dopo
questo», letto dalle stesse frequenze (perdere non costa niente, quindi le buste che ti aspetti di
PERDERE sono slot che resteranno aperti). Più una manopola **dichiarata**, «tieni da parte N crediti»,
di serie a zero. Quello che resta aperto è la parte che vuole una misura: quanto valga davvero un
credito tenuto per il round 5, che nessuno ha ancora misurato — e senza misura non entra.
Il testo originale resta qui sotto perché la prova che il vincolo morde è ancora valida.

**~~3.1 (originale)~~ · I nove round, non uno — e c'è una prova che il vincolo di oggi morde.** Il piano ottimizza questo
round come se fosse l'ultimo. Perdere non costa niente e il pool si assottiglia mentre i soldi no: la
domanda vera è quanto tenere per il round 3.
**Il caso concreto, misurato il 25/08.** Il budget deve reggere il **tetto** (quello che spendi se vinci
tutto), non la spesa attesa — non puoi pagare più di quello che hai. Ma il piano del round 2 impegna
**257 di 257** con una spesa attesa di **163**: non resta un credito per alzare niente, e le due buste da
2 crediti restano al **33%** e **44%** *per vincolo*, non per scelta. Il rilancio per chance-per-credito
(item 1.6, fatto) quindi **non scatta affatto** su questo piano. La leva non è alzarle: è **bustare su
meno slot** questo round e mettere di più su ciascuno, tenendo il resto per i round dopo. È esattamente
la domanda multi-round, e finché non è risolta il piano è schiacciato contro il proprio tetto.

**3.2 · ~~«Escludi e ricalcola»~~ FATTO il 25/08/2026.** Un gesto suo, distinto dai due che c'erano:
«togli la busta» svuota uno slot e lascia stare le altre, «escludi» toglie l'uomo dal **tabellone** e il
piano si rifà intorno agli altri — quindi le altre righe cambiano, che è esattamente il punto. Gli
esclusi restano in una striscia di chip e si rimettono con un click; «torna ai consigli» azzera anche
quelli. L'escluso sparisce anche dalle alternative, dagli obiettivi dei rivali e dalla modale: una
frase sull'uomo, non su una busta.

**3.3 · Il foglio in-season. BLOCCATO sulla stessa cosa di 2.3** (serve uno `snapshot --date` dentro la
stagione dalla sessione che possiede il DB, poi `export` e `data:pull`).
Quello nel bundle è del 20/08, **pre-stagione**: non legge la giornata 1.
R20 esiste per questo (adottata 16/08 su `default` con K=10) ma vuole uno snapshot con data DENTRO la
stagione. **Da verificare**, non è un fatto accertato: che `snapshot --date` di oggi attivi davvero il
ramo in-season. E la resa è modesta con una sola giornata giocata — più il fatto che le presenze
osservate sono un segnale **pubblico**, quindi non un nostro vantaggio.

### 4 — Presentazione

**4.1 · ~~Le alternative col MOTIVO.~~ FATTO il 25/08/2026.** Sotto ogni alternativa una riga in
parole: «costa 30 crediti in meno, lo vogliono in meno, gioca quasi ogni giornata · il tetto scende di
30». L'effetto sul budget si legge **prima** del click, invece di arrivare come avviso di sforamento
dopo.

**4.2 · ~~Ribaltare i bersagli dei rivali.~~ FATTO il 25/08/2026**, card «I nomi contesi»: per ogni
nome, quanti rivali possono davvero bustarci (ruolo aperto **e** tetto sopra il prezzo tipico), chi non
ci arriva, e **chi è il favorito**. Una cura è nata dal disegno: col favorito definito come «il più
ricco fra quelli che possono pagarlo», tutte e dieci le righe rispondevano *Fc Pollice*, che è un fatto
su di lui e non sulla contesa. Adesso è **chi ce l'ha più in alto nella propria lista** (il tetto rompe
solo la parità), e le righe si differenziano.

**4.3 · ~~Una schermata.~~ FATTO il 25/08/2026, spostando invece di comprimere.** Le tre card di
LETTURA (rosa per reparto, chi ha speso, nomi contesi) sono uscite dalla colonna di sinistra e stanno in
una riga sotto: era la colonna a decidere l'altezza della pagina, quindi con dentro anche quelle «le
buste + le rose» non entravano più in una schermata. Adesso l'area di lavoro apre senza scorrere e la
lettura sta sotto. La suite misura il rapporto e il budget dichiarato è **2,2 schermate** per la pagina
intera: quello che resta a guardia è la fuga, non il pixel.

---

## 25/08/2026 — la strategia dettata dall'operatore, il GAIN, e la pagina che spiega

Sessione nata da una domanda sola («qual è la moneta migliore per dare un valore assoluto ai calciatori
in questo contesto?») e cresciuta con **le sue obiezioni ai consigli veri**, che sono la parte che vale.
Tutto quello che segue è codice in `app/src/app/core/sealed-bid.ts` più la sua pagina; 439 test verdi,
`ng build` verde, e2e **senza problemi** sul round vero.

### La moneta si chiama GAIN, e le due alternative sono respinte per iscritto

`GAIN = surplus × (giornate della competizione / 38) × (Pv/38) ^ 0,5`. Non è nuova — è quello che la
pagina già ordinava — ma adesso ha un nome, quindi si può citare. Le due rivali sono state escluse per
ragioni già scritte altrove:

- **non l'OVERALL**, che per definizione dell'operatore (18/08/2026) è un TOTALE **senza zero**: in
  un'asta si compra sempre *al posto di qualcun altro*, e senza rimpiazzo la colonna incorona chi gioca
  e non dice cosa guadagna lo SLOT (`letture-app-v1.md` §9: con il rimpiazzo sottratto le mediane per
  ruolo si spostano di trenta punti);
- **non il SURPLUS nudo**: è già la sottrazione giusta, ma è una previsione su 38 giornate mentre questo
  mercato ne compra 37, e prezza una stagione che devi poter SCHIERARE — la formazione si fa prima di
  sapere se gioca, quindi quello che incassi sono le presenze che si vedevano arrivare.

Disegnato **sempre allo stesso modo** (`ui/gain-chip`, richiesta dell'operatore): un quadrato smussato
col fondo colorato — ottimo, buono, medio, scarso — e le fasce sono **percentili del listone intero**,
tagliati una volta sola (`gainScale`). Sul tabellone dei liberi si muoverebbero sotto i piedi: lo stesso
uomo diventerebbe «ottimo» perché qualcuno *altro* è stato comprato, che è una frase sul mercato e non su
di lui. Un gain che non c'è disegna un trattino: «vuoto = ignoto, mai zero».

### Le tre regole che l'operatore ha dettato, e il difetto che ognuna ha corretto

Non sono gusti: ognuna è arrivata come obiezione a un consiglio vero, e ognuna è un fatto sull'INSIEME
che nessun numero per-uomo può esprimere. Tutte **dichiarate** (nessun gate le possiede) e tutte
**riportate quando non si riesce a rispettarle**, perché un vincolo che si arrende in silenzio si legge
come un vincolo rispettato.

1. **«Per completare un reparto meglio calciatori che devono giocare SEMPRE, anche se in squadre
   minori»** — nato su **Cabal**, `panchina` alla Juventus, 17,6 presenze attese di 38, consigliato a 2
   crediti. Il gain lo sconta già; quello che non può dire è che uno slot riempito con chi gioca mezza
   stagione è uno slot che nell'altra metà copri dalla panchina. Diventa `SURE_PER_ROLE = 2`: almeno due
   uomini per ruolo che il voto lo prendono quasi ogni giornata, contando quelli già in rosa.
2. **«In una rosa completa ci vogliono almeno un paio di titolarissimi per ruolo, gente che porta sempre
   il 6 a casa e costa poco»** — la stessa regola, detta come minimo che è.
3. **I PORTIERI sono un gioco diverso**, e l'ha spiegato su **Di Gregorio**: «quasi sicuramente sarà
   Vicario il titolare, e prenderne solo uno dei due è una scommessa troppo rischiosa (abbiamo solo 3
   slot)». Ne schieri UNO, quindi quello che deve presentarsi è la MAGLIA e non l'uomo: o possiedi
   tutt'e due i contendenti, o ne possiedi uno che non è in ballottaggio. `ensureKeepers` prova le sue
   tre vie in ordine — la coppia dello stesso club, un primo portiere vero, e solo allora lascia la
   scommessa e la CONTA. Per questo la porta è **esente** dalla regola 1: una coppia è fatta apposta di
   due uomini di cui gioca uno.

Effetto sul piano vero del round 2: **Cabal e Di Gregorio spariscono**, e i due portieri diventano
Falcone (Lecce) e Palmisani (Frosinone), che è la seconda delle sue strategie — due titolari da alternare.

### E poi la strategia delle buste, che è la modifica più profonda

«Non devi pensare di chiudere subito la rosa ma di provare, con le buste a disposizione, a piazzare
qualche colpo a sorpresa... invece di puntare a un forte C con una busta da 100, meglio 2/3 offerte da 1
o 2 crediti a calciatori dal profilo più basso ma forti», e «le offerte devono essere un misto di
offerte toste e offerte cheap».

Tradotto in una riga di codice e in una sola: **l'obiettivo dello zaino non è più il gain, è il gain per
la probabilità che quella cifra basti** (`value = gain × chance(prezzo)`), e il risolutore sceglie fra
tre prezzi per ogni uomo — il **colpo** a 2 crediti, il **consigliato** (75° percentile dei casi simili)
e il **quasi sicuro** (90°). Non è un gusto, è l'aritmetica che lui aveva già visto: **perdere non costa
niente**, quindi quello che vale una busta non è quanto vale l'uomo, è quanto vale l'uomo per quante
volte un numero così è bastato.

Il mix esce **da solo** e per una ragione, invece che per una manopola: su un uomo che vogliono tutti due
crediti non bastano quasi mai (il colpo vale ~zero e il piano paga il prezzo vero o lo lascia); su un
uomo FORTE che la stanza non insegue — che è esattamente «profilo più basso ma forte», cioè gain alto e
pressione bassa — due crediti bastano spesso, e il biglietto della lotteria batte un riempitivo sicuro.
Le prove che è vero e non furbo stanno nel round 1 di questa lega: **37 aggiudicazioni su 125 sono
costate 1-2 crediti**, e fra quelle Mora (FVM 100), Zaniolo (90), Da Cunha (90), Vlasic (75), Dybala (70).

Due conseguenze di forma: il rilancio finale non tocca mai un **colpo** (alzarlo disfa la scelta che lo
ha reso economico) e serve solo a spendere il resto degli interi; e il piano adesso porta il **gain
atteso** accanto al gain «se le vincessi tutte», che è il numero onesto di un piano che mescola.

### Quello che la pagina fa vedere adesso

Undici richieste dell'operatore, tutte sullo schermo: il **giudizio in stelline** per ogni squadra (rosa
e condotta d'asta — RANGHI dentro questa lega, mai un voto assoluto, e chi non ha ancora speso sta a
metà della classifica dell'efficienza invece che in cima); il **tooltip su ogni etichetta** (le fasce di
prezzo con i casi veri dentro, le quattro strategie con i loro numeri, «torna ai consigli»); la **rosa
formattata** passando sul nome di una squadra (ruolo, nome, sigla del club, gain, prezzo) e lo stesso
elenco per intero con un interruttore, coi **buchi dichiarati**; i **nostri obiettivi** nella nostra card
(che non sono una previsione: sono le buste); il **gain in ogni lista**, alternative comprese, con un
**popover** che apre le statistiche delle due stagioni (media voto, fantamedia, partite a voto, minuti a
partita, gol coi rigori — o gol subiti e porte inviolate per un portiere — xG, xA, FVM, surplus); la
**busta che si toglie** e quella che si **aggiunge** (con la validità detta riga per riga: gli slot sono
il regolamento e si rifiutano, il budget è una sua decisione e si segnala); **tutto il ruolo** in una
modale con la ricerca; il **giudizio per reparto** con il consiglio scritto rispetto a quello che è
ancora libero; e la card **«chi ha speso e chi ha fatto l'affare»**.

E il **ragionamento sul prezzo in parole**, che è la richiesta con la portata più lunga: «spiega come lo
spiegheresti a un ragazzo che di statistica non sa niente, con esempi veri». Quattro passi dentro il
pannello della riga — quanti lo vogliono, quanto sono costati quelli come lui (**coi nomi e i crediti**),
perché proprio quel numero («con 15 avresti battuto 6 di quei 9: circa 67 volte su 100»), quanto costa
la tranquillità — più la parità, che porta il **nostro** caso vero quando ce n'è uno nei log.

### Tre lezioni sull'arnese, e una vale oltre questa pagina

- **Un puntatore CDP si TELETRASPORTA, quindi un overlay resta aperto dove una mano lo avrebbe chiuso.**
  Il popover del gain, aperto dal passo precedente, copriva il campo dell'offerta: la suite leggeva «ho
  scritto 95 e il campo legge 55» e «sull'offerta nessuna spiegazione», cioè due difetti dell'app che
  l'app non aveva. Si è visto solo chiedendo `document.elementFromPoint` **sotto il campo** — che
  rispondeva `div.min-w-64`, il pannello delle statistiche. Adesso ogni passo comincia posando il
  puntatore da un'altra parte, che è quello che fa una mano.
- **Una modale che resta aperta falsa tutto quello che viene dopo**: la stessa corsa dichiarava «2,82
  schermate» e «l'interruttore non disegna niente» mentre misurava l'overlay. Chiusa con Esc e
  verificato che si chiuda.
- **Un'audit conta gli ELEMENTI, non i contenitori**: «10 stelline su 20 attese» era `filter(tile =>
  tile.querySelector('nz-rate'))`, che conta le card e non le stelline.

E un difetto vero trovato dalla suite: **«Aggiungi» apriva il ruolo sbagliato**. Apriva il primo ruolo
con uno slot libero, e se il piano aveva già una busta per quello slot ogni riga della modale diceva
«non valida» — una porta su un muro. Adesso apre il primo ruolo che può davvero prendere un'altra busta.

### 4-bis — Due richieste del 25/08/2026 (pomeriggio), e una regola nuova

**Il `title` del riquadro GAIN è stato TOLTO.** Ogni riquadro sta dentro un popover che apre le due
stagioni, e il tooltip nativo del browser gli si accavallava sopra: una cosa sola sotto il dito. Quello
che diceva il `title` — cos'è il GAIN per QUEL giocatore, la sua fascia e su quale pool è tagliata — è
finito **dentro** il popover, dove c'è lo spazio per scriverlo per intero. Con lui sono spariti
l'input `hint` del componente e `GAIN_WORD`, che era una mappa da ogni parola a sé stessa.

**«Non suggerire calciatori che hanno infortuni lunghi in corso (≥ 1 mese)».** `LONG_OUT_DAYS` = 30, e
tre cose vanno dette perché la regola è chirurgica per scelta:
- **Conta quanto RESTA fuori, non quanto è già stato fuori.** Chi ha saltato due mesi e rientra sabato è
  un uomo che vuoi; chi è fuori da una settimana con rientro previsto a novembre non lo è. Quindi si
  legge la data di rientro quando c'è, e quando non c'è si legge quanto è già durata — che è anche il
  caso che nessuno sa datare, cioè l'assenza aperta.
- **Esce dai CONSIGLI, non dal tabellone.** `priced` è il filtro (lo leggono il risolutore, le due
  riparazioni e la tariffa di mercato), mentre il tabellone, gli obiettivi dei rivali, le alternative e
  la modale continuano a mostrarlo: la stanza può bustarci, e l'operatore può sapere che rientra sabato.
  Resta scegliibile a mano e il popover scrive perché non è consigliato.
- **La soglia NON è quella dell'icona** (45 giorni in `player-status`): quella decide quando disegnare un
  avviso accanto a un nome, questa decide se un uomo entra in un piano, e una soglia presa in prestito da
  un'altra domanda è il difetto che questo progetto paga da sempre.

Misurata prima di tenerla, sul bundle vero: **16 righe su 605** vengono escluse (mediana 77 giorni fuori,
una sola sopra i 180, cioè probabilmente uno spell mai chiuso alla fonte), e sul piano del round 2 tolgono
**Konè I.** (fuori da 131 giorni) e Perrone, sostituiti da Fagioli e Bernardeschi. Il limite dichiarato:
uno spell aperto senza data di rientro si crede come lo dice la fonte — la stessa fonte che disegna
l'icona — quindi un infortunio mai chiuso alla fonte tiene un uomo fuori dai consigli finché non lo
chiudono. È il prezzo di avere UNA definizione di «è fuori oggi» invece di due.

E un effetto collaterale corretto subito: la card «con un numero» contava `priced`, quindi dopo la regola
avrebbe detto 295 dove il tabellone ne ha 308 — un'etichetta che non torna col suo numero. Adesso il
tabellone si conta con `numbered` (i due numeri, infortunio o no) e il tooltip dice quanti sono fuori.

### 4-ter — «Come mai non mi esce il portiere Martinez dell'Inter?» (25/08/2026)

La domanda dell'operatore ha trovato un difetto vero, e la risposta comincia con un numero: **Josep
Martínez è atteso in 10,6 giornate su 38, cioè il 28% contro la soglia di presenze della lega che sta al
35%**. Sotto quella soglia `gainOf` non risponde — «un uomo che ha giocato una volta non è un uomo che
avresti potuto schierare», ed è una scelta del config della lega, non nostra — quindi non ha un GAIN.

Che non sia nel PIANO è giusto. Che non fosse nemmeno nelle **alternative** e nella **modale** era un
difetto, e di quelli che il commento del codice smentiva da sé: `boardFor` prometteva «un uomo senza
quotazione resta qui, la riga dice che il prezzo è ignoto e non lo nasconde» e poi filtrava `gain != null`,
che nasconde un'incognita diversa (il VALORE) da quella che il commento nominava (il PREZZO). E i rivali
continuavano a mostrarlo, perché `rivalPlan` chiede la quotazione e non il gain: la stessa persona era sul
tabellone loro e non sul nostro.

Curato: dalla lista da cui si scegli **a mano** non si filtra più niente tranne chi è già nel piano. Gli
uomini senza numero finiscono in coda (l'ordinamento mette i null per ultimi, e fra loro per FVM), col
trattino dove starebbe il gain. Misurato in pagina: la porta passa da 29 a **59 nomi liberi, 43 senza
numero**, e Martínez è il primo di quelli — pressione 100%, prezzo tipico 78 crediti. Con lui la
differenza di gain in colonna diventa **vuota e non zero**: `(gain ?? 0) - gain` diceva «vale esattamente
l'altro in meno», che è una misura che nessuno ha fatto.

E il terzo portiere adesso ha un nome: il consiglio sulla porta, quando è coperta, **nomina il compagno di
squadra del portiere che hai già** con il suo prezzo — era la terza delle regole dell'operatore sui
portieri e finora era solo una frase, per la ragione che la rende necessaria: un terzo portiere sta sotto
la soglia delle presenze per definizione, quindi nessuna lista filtrata sul gain poteva proporlo.

Due lezioni sull'arnese, tutte e due dello stesso tipo: un passo e2e che non trova il suo bersaglio deve
DIRLO (il controllo sulla porta si saltava in silenzio, e «zero problemi» si legge come «tutto bene»), e
uno STATO del DOM si legge invece di dedurlo da una stringa — quale ruolo la modale sta mostrando è il
radio con la classe `-checked`, e due tentativi di parsarlo dal titolo hanno risposto `null`.

### 5 — Nato il 25/08/2026: quello che adesso va MISURATO

**5.1 · Scorare la strategia del misto sul round 2.** L'obiettivo del piano è cambiato — da «massimo
gain» a «massimo gain × probabilità» — e la ragione è aritmetica (perdere non costa niente), non una
misura. Il registro delle buste salva la probabilità **al momento della spedizione**, quindi quando
arriva l'export del round 3 si può fare il conto onesto: quante ne prevedeva, quante ne ha vinte, e
quanto gain è entrato davvero contro quello che avrebbe portato il piano vecchio (stessa funzione,
`offersFor` con il solo prezzo consigliato). È la prima volta che questa pagina può giudicare sé stessa.

**5.2 · Scorare le tre regole dichiarate.** `SURE_PER_ROLE` / `sureTarget`, la coppia di portieri e il
colpo a 2 crediti sono DICHIARATE: nessun gate le possiede. Le prime due si giudicano a fine mercato
(quante giornate hai davvero coperto con uomini che giocano), la terza già dal round dopo — quanti dei
colpi da 2 crediti sono passati, e quanti erano parità.

**5.3 · Il valore di un credito tenuto.** La metà aperta di 3.1. Serve una serie: quanto rende un
credito speso al round k contro uno speso al round k+2, sul pool che si assottiglia. Con un solo round
di storia non è misurabile; con quattro lo diventa.

## Lo stato al momento della chiusura (25/08/2026, notte)

- Piano round 2 verificato sul bundle vero: 12 buste, **257 di 257** di tetto, **spesa attesa 163**,
  **buste attese 7,2 di 12**, worth **215** contro **144** del null di mercato (+49%).
- Il null non è un fantoccio: stesso risolutore, stesso budget, stessi slot, crede solo che il prezzo
  sia il valore.
- Un `update` completo era in corso dalle 22:09 del 24/08 (piano da 31 passi, ~22h34; al passo 18/31 alle
  01:10). Quando finisce: rifare i fogli, `export`, `npm run data:pull`. **Il bundle che l'app legge è
  del 20/08** e l'FVM si è già mosso (Rabiot 128 nel bundle contro 145 nel DB riscaricato).
- Niente è stato committato: in questo repository si committa solo su richiesta.

### Aggiornamento del 25/08/2026 (mattina): la todolist è stata COMPLETATA per quello che il codice può fare

Chiusi in questa sessione: **2.1** (il tasso vincolato agli slot), **2.2** (lo stato in riga), **2.4**
(l'SpM come passo del ragionamento), **3.2** (escludi e ricalcola), **4.1** (le alternative col motivo),
**4.2** (i nomi contesi), **4.3** (l'area di lavoro in una schermata) e **metà di 3.1** (dove ti lascia
questo round, più la riserva dichiarata).

Restano aperti **solo** gli item che dipendono da un'ACQUISIZIONE e non dal codice, e ognuno è verificato
e non supposto: **1.1-1.3** vogliono le buste perdenti di tutto il round 1 (oggi ne abbiamo dieci da
screenshot); **2.3** e **3.3** vogliono un bundle che contenga la stagione in corso — misurato:
`match_ratings` nel pacchetto si ferma a 2025-26, quindi non è una funzione mancante, è un `export` da
rifare dalla sessione che possiede il DB. Più i tre item nuovi del §5, che sono misure e non lavori.

Verificato alla chiusura: `ng build` verde, **444 test** verdi, e2e **senza problemi** sul round vero
(12 buste, i due hover, togli/aggiungi/escludi, le rose per intero, 420 elementi con tooltip, nessuna
eccezione in console).

---

## Chiusura del 25/08/2026 — dove sta tutto, e cosa resta

**Codice**: `app/src/app/core/sealed-bid.ts` (dominio), `app/src/app/core/season-line.ts` (le due
stagioni del popover), `app/src/app/ui/gain-chip/` (il riquadro del GAIN),
`app/src/app/views/sealed-bid/` (la pagina), `app/scripts/e2e-sealed-bid.mjs` (l'arnese).
`PlayerStatus.openInjury` è l'unico posto che dice «è fuori oggi», in numeri.

**Verificato alla chiusura**: `ng build` verde, **456 test** (31 file), e2e **senza problemi** sul round
vero — 12 buste, i due hover, togli / aggiungi / escludi, la porta per intero con 43 nomi senza numero, le
rose per intero, nessuna eccezione in console.

**Commit**: `a0f249d` (la pagina: GAIN, strategia, todolist), `7772493` (i sette difetti della
code-review più quello introdotto dalla correzione), `165dc27` (chi il motore non prezza torna nella lista
a mano, e il terzo portiere per nome), più `52404da`, `6916058`, `befbdda`, `5bbf98e` (i bump delle
quattro pubblicazioni). Branch `motore/reparto-e-tasso-titolarita`, sito **v0.1.25**.

**Cosa resta, in ordine di resa attesa**: il §5 (misurare la strategia nuova contro quella vecchia col
round 3, che il registro delle buste rende possibile), gli item 1.1-1.3 (vogliono le buste perdenti di
tutto il round 1), e 2.3 / 3.3 (vogliono un `export` con la stagione in corso: verificato, il bundle si
ferma a 2025-26). Nessuno dei tre dipende da codice di questa pagina.

---

## 6 — Il reparto portieri è UN POSTO SOLO (25/08/2026, sera)

**Nato da una domanda dell'operatore su un piano vero**: la busta consigliava **Falcone (81) +
Palmisani (15)** e lui ha chiesto «non sarebbe meglio puntare su Provedel+Martinez o Meret+Milinkovic?».
L'intuizione era giusta e il difetto stava sotto, nell'aritmetica: **in porta si schiera UN uomo**, e
niente in `sealed-bid.ts` lo sapeva. `gainOf` è un fatto su UN uomo, lo zaino somma i suoi oggetti, e la
regola della coppia (`ensureKeepers`) parla della MAGLIA, non del conto. Sui due nomi del piano:
**42,8 di gain sommati contro 32,9 che se ne incassano** — le giornate in cui giocano tutt'e due valgono
una volta sola, e Palmisani entrava nel piano prezzato **14,2** per portarne **4,3**.

### Il modello, dichiarato perché sia rifiutabile

Non prevede calcio, che è il confine di questo file: le presenze sono quelle del foglio (`expected`), il
valore di una di esse è quello del foglio (`surplus / expected`), e quello che si deduce qui è **quali di
quelle presenze sei in campo a incassare**. Tre assunzioni e una regola:

- gioca una data giornata con probabilità `expected / matchdays`;
- **due portieri di UN club non giocano la stessa partita** — è il regolamento, non un'ipotesi — e le
  loro quote si riscalano quando le due previsioni del foglio sfondano il calendario. Napoli 2026-27:
  Milinkovic-Savic 25,0 + Meret 14,6 + Contini 8,0 = **47,6 presenze su 38**, cioè il motore che dice di
  non sapere chi vince quella maglia;
- portieri di club DIVERSI sono indipendenti;
- e incassi il migliore di chi si presenta, che è quello che compra l'ordine della panchina.

**Misurato e scartato**: riscalare le quote di un club su TUTTI i suoi portieri invece che su quelli che
possiedi. Si legge come la versione più rigorosa — un club schiera esattamente un portiere a giornata —
e a pagarla è il **riempitivo** del foglio: le quattro riserve non misurate del Lecce portano 3,7
presenze a testa, che è «vuoto = ignoto» e non una previsione, e dividere per il loro 46,9 manda Falcone
da **0,845 a 0,684** di stagione. Un uomo con una stagione misurata non lo sgonfiano uomini che nessuno
ha misurato.

### Lo sconto di «catchability» sta sul REPARTO, e la prima versione lo aveva sull'uomo

È la correzione che il foglio VERO ha smentito entro l'ora, ed è la parte che vale oltre la porta.
`gainOf` sconta `quota ^ reliability` perché «schieri prima di sapere se gioca» — **una frase su uno slot
con nessuno dietro**. In porta ne elenchi tre e la sostituzione automatica prende il primo con un voto,
quindi quello che devi vedere arrivare è se avrai UN portiere, non se avrai QUEL portiere. Addebitato per
uomo conta due volte proprio il rischio che una coppia serve a togliere: **Meret + Milinkovic leggevano
26,4 contro i 35,5 che valgono**, cioè meno di un Falcone da solo, e la busta avrebbe continuato a
sconsigliare l'unica cosa che funziona. Preso una volta sola, su quello che il reparto COPRE, un uomo
solo riproduce `gainOf` alla virgola — e dice una cosa vera che la versione per-uomo non poteva dire:
**comprare un vice fa salire il portiere che hai già** (Falcone da solo è scontato a 0,919 del suo
surplus, Falcone con un secondo a 0,969).

### La soglia delle presenze NON si applica dentro il reparto

E la distinzione è quella che dice il commento della soglia stessa: **gatta il RANKING** — chi si può
proporre — e `priced` continua a farlo a monte, quindi niente che prima non potesse essere proposto lo
diventa. Quello che copre un uomo che hai **già** è un'altra domanda, e un portiere che gioca un terzo di
stagione è esattamente la seconda metà di una coppia (§4-ter: Martínez è atteso in 10,6 giornate su 38,
il 28% contro il 35% della lega).

### I reparti veri, letti dalla funzione che spedisce (foglio Serie A rev. 36)

| reparto | gain del reparto | gain sommati | FVM |
|---|---|---|---|
| Falcone da solo | 28,6 | 28,6 | 25 |
| **Falcone + Palmisani (la busta)** | **32,9** | 42,8 | 33 |
| Provedel + Martinez | 25,6 | 16,2 | **68** |
| Meret + Milinkovic | **35,5** | 27,5 | **55** |
| Provedel + Milinkovic | 30,3 | 35,7 | **15** |
| **Falcone + Provedel** | **34,9** | 44,8 | **30** |
| Palmisani + Desplanches | 29,8 | 27,7 | 16 |
| Falcone + Provedel + Milinkovic | **37,5** | 64,3 | 40 |

Dove «sommati» è la vecchia aritmetica, che oltre a contare due volte le giornate condivise **non
contava affatto** chi sta sotto la soglia — per questo su due righe è più bassa e non più alta.

### La risposta all'operatore, che sta in piedi sul prezzo e non sul motore

Nelle due coppie che proponeva, **il mercato paga la metà che il motore dice che NON gioca**: Martínez
Qt.I 17 / FVM 63 contro Provedel 2 / 5, Meret 11 / 45 contro Milinkovic-Savic 5 / 10 — mentre il motore
disegna Provedel e Milinkovic titolari (claim 0,664 e 0,669, `ballottaggio` tutt'e due) e legge gli altri
due `riserva`. Da dire per intero, perché il nostro claim legge **i minuti dell'anno scorso**
(`standing_weights` = 0/1) e quelli di Provedel sono della Lazio: il Qt.I dei redattori è un'opinione su
quanto giocherà, e qui dice il contrario. Quello che si può affermare non è chi ha ragione, è **quanto
costa scommetterci**: le metà a sconto costano FVM 5 e 10.

E un fatto **misurato sul DB** su Palmisani, che il foglio non può leggere: la sua FM è **4,911 =
esattamente l'ancora di ruolo**, perché il Frosinone non ha una stagione di Serie A e quindi del suo club
nel numero non entra niente. Su **21 portieri titolari di neopromosse in 10 stagioni** (`season_stats`,
platform `default`, pv ≥ 25) lo scarto dalla media portieri della loro stagione è **−0,370** (mediana
−0,373, **17 su 21 sotto**) — il Frosinone stesso: Sportiello 2018-19 **4,16**, Turati 2023-24 **4,42**.
È una misura, non un canale: nessun gate la possiede e niente la legge, sta qui perché la prossima
sessione non la rifaccia da capo.

### Cosa si è mosso nel codice

`keeperGain` (il reparto), `squadGain` (le tre somme più il reparto) e `marginalGains` (la catena che
somma ESATTAMENTE alla differenza fra due reparti, così una riga e il totale sotto non possono
raccontare due storie). Li leggono: **l'obiettivo** dello zaino — `exact` prezza dentro lo STATO e
`greedy` riprezza a ogni passo, perché un difetto corretto solo nel resoconto rietichetta una scelta già
fatta su un numero 15 punti troppo grande — **le righe della busta** (`Bid.gain`, ricalcolate anche dopo
ogni modifica a mano), **la spesa attesa in gain** (2^k esiti dei portieri, enumerati e non pesati uno a
uno), il **null di mercato**, la **classifica** (`verdicts`) e la **tabella per ruolo** (`strengthsOf`),
dove tre portieri non sono più tre reparti. `LeagueRules` è diventato un parametro OBBLIGATORIO di
`allocate`: un piano non si può valutare senza sapere in che lega sta, e lasciare il vecchio conto come
ripiego sarebbe «una scorciatoia giusta per un chiamante e muta per un altro».

### Dove questo modello CONTRADDICE una misura, e la misura è la prova più forte

`metrica-asta-surplus-v1.md` **§24.5**, committata la stessa mattina (`b627c33`, 11 stagioni di Serie A,
coppie appaiate contro controlli di due club diversi), legge la coppia di portieri dello stesso club a
**−0,59 punti a stagione, intervallo che contiene lo zero, e lo stesso club vince nel 41% dei casi** —
mentre questa deduzione le dà **+6/+10** sopra il diversificare a pari qualità. Sulla COPERTURA le due
vanno d'accordo (5,2 giornate scoperte in meno su 38 nella misura, 4,8 in questo modello); il disaccordo
è se quella copertura diventi punti, e la risposta misurata è **no, perché quel buco lo copriva già il
TERZO portiere, che è in rosa comunque**.

Non è stato tarato niente per chiudere la distanza: tarare una deduzione su una misura che la smentisce è
il modo di smettere di essere verificabili. **Spedisce la metà che nessuna delle due contesta** — due
portieri non si SOMMANO — e la metà aperta sta scritta nel commento della funzione, così il prossimo
lettore non prende il bonus della coppia per misurato. Per consigliare vale §24.6: **prenderli entrambi va
bene se il secondo lo si paga da secondo**; il club non è un criterio d'asta, lo sconto sì.

**Non è misurato e lo dice**: è aritmetica più un modello dichiarato, nessun gate lo possiede,
`engine_*` non si muove di un decimale. Da aggiungere al §5: **5.4 · le coppie che il nuovo obiettivo
propone coprono davvero più giornate, e diventano punti?** — il piano scrive già quello che si aspettava,
quindi a fine mercato si contano le giornate coperte e i punti incassati, coppie contro diversificate. È
il modo di chiudere il disaccordo qui sopra, ed è un conteggio, non una stima.

**Verificato**: 467 test verdi (31 file), `tsc` pulito. e2e non rilanciato — vuole il bundle vero e una
sessione del browser.

---

## 7 — Un compagno di club non è l'altro lato di una LOTTA (25/08/2026, sera tarda)

**Trovato dall'operatore su un piano suo, e ha nominato l'uomo che mancava**: «Di Gregorio e Perin sono
riserve e senza Vicario non ha senso offrire delle buste per loro». La regola era **già scritta** nel
commento di `KEEPER_DISPUTE` — «a `riserva` is never the mate that covers it: he is the third keeper,
which is a different job» — e applicata soltanto dove il compagno si CERCA. I tre posti che decidono se
una coppia ESISTE guardavano il club e nient'altro, quindi due compagni erano una coppia qualunque fosse
il loro gradino.

**Cosa leggeva lo schermo** (chiamando le funzioni vere sui numeri veri del foglio Serie A rev. 36):

| insieme | `keeperGamble` prima | dopo | reparto |
|---|---|---|---|
| Di Gregorio (`panchina`, 26,9) + Perin (`riserva`, 13,3) | **0** | **2** | 33,9 pt |
| Di Gregorio + Vicario (`ballottaggio`, 23,6) | 0 | **0** | 30,7 pt |
| Vicario + Perin | 0 | **2** | 24,5 pt |

Cioè: il pannello diceva «reparto risolto» su un piano che non possedeva **nessuno dei due lati** della
lotta su cui stava scommettendo, e la maglia era di Vicario, che non era in nessuna busta.

**L'aritmetica non è quello che li rifiuta: li PREFERISCE.** `keeperPlaces` spartisce il calendario di un
club fra i portieri che POSSIEDI, quindi 26,9 + 13,3 presenze piastrellano una stagione da 38 mentre
26,9 + 23,6 si sovrappongono — la coppia sbagliata legge **33,9 punti contro 30,7**. È esattamente quello
che il commento di `keeperGain` diceva di sé («that one is about the SHIRT, not about arithmetic»): il
vincolo è il posto dove si cura, e una prova lo afferma.

### La regola, e le due metà che servono entrambe

`ownsShirt(insieme, club)`: servono **DUE pretendenti** a quella maglia, e **uno dei due la board lo deve
disegnare**. Nessuna soglia nuova — è il **gate del toolkit**, citato: un uomo che l'undici tipo schiera
non scende sotto `ballottaggio` e uno che non schiera non può essere `titolare`, quindi `ballottaggio` o
meglio *è* «la board lo disegna» (`KEEPER_SHIRT` = 3) e `panchina` *è* «al suo posto disegna un altro».
La prima versione chiedeva solo «un uomo disegnato più chiunque» e lo stesso portone della Juventus l'ha
ripresa: Vicario + Perin sarebbe passata, e se la maglia la vince Di Gregorio in porta non c'è nessuno.

**Un gradino IGNOTO non rifiuta una coppia**, e l'asimmetria col posto dove il compagno si cerca (là
`?? 99`, cioè l'ignoto è escluso) è voluta: **per AGIRE su un uomo serve una prova, per RIFIUTARLO serve
una prova**. Un foglio costruito dove le board non si potevano disegnare non porta nessun gradino, e
trasformare lì ogni coppia in un avviso — o peggio scambiare uomini su quella base — sarebbe «vuoto =
ignoto» rotto dal lato opposto. Il prezzo è detto: un piano fatto a mano che affianca a un portiere non
disegnato un terzo portiere illeggibile passa ancora.

Quattro chiamanti, una definizione: il riparo (`ensureKeepers.paired`), la ricerca del compagno, il
contatore che lo schermo legge (`strategyCheck`) e le coppie offerte dal consiglio di reparto
(`keeperOptions`, che ora costruisce la coppia **intorno all'uomo disegnato** invece di prendere i due
migliori per gain — con tre pretendenti poteva pescarne due che stanno dietro a un terzo). Le cinque
coppie del tabellone Serie A restano tutte e cinque, adesso col disegnato in testa.

**E la frase a schermo è cambiata con la regola**: «N portiere in ballottaggio comprato da solo» non era
più esatta, perché in quel conto finisce anche il terzo portiere preso accanto a chi non è il disegnato, e
un'etichetta che non torna col numero accanto è il difetto che questo progetto paga più spesso.

### 7-bis · APERTO, e va deciso non misurato: fuori dalla porta un reparto NON è un posto solo

Nato dalla domanda dell'operatore la stessa sera: «rispetto ai consigli per reparto, l'attacco è coperto
ma nelle offerte consigli di spendere di più per un attaccante, è normale?». **Sì, ed è il modello di
oggi**: `squadGain` somma i reparti di fuori uomo per uomo e la correzione «il reparto è un posto solo»
esiste solo per i portieri, quindi il quinto attaccante entra nello zaino al suo prezzo pieno. Il giudizio
di reparto risponde a un'altra domanda («l'undici lo copro con gente che gioca?»), quindi le due
schermate non si contraddicono — ma una delle due sa una cosa che l'altra non sa.

Misurato con la stessa aritmetica di `keeperGain` generalizzata a `m` maglie, sul tabellone vero (uomini
che GIOCANO, `FIELDED_PLACES`, quello che l'ennesimo aggiunge diviso quello che il piano gli accredita).
**Attenzione: questa tabella è misurata su A = 2, cioè sull'1-4-4-2 che era cablato, e il §8-bis la
CORREGGE** — i due moduli che l'operatore gioca schierano tre attaccanti, e con tre maglie il terzo vale
il 100%. Resta come la misura che era, perché il numero non è sbagliato: è la domanda che aveva il
riferimento sbagliato.

| ruolo | 3º uomo | 4º | 5º | 6º | 7º |
|---|---|---|---|---|---|
| A (2 maglie) | **44%** | 12% | 8% | 1% | 0% |
| C (4 maglie) | 100% | 100% | **69%** | 52% | 21% |
| D (4 maglie) | 100% | 100% | **65%** | 28% | 11% |

Tre ragioni per NON adottarlo di corsa, e sono la ragione per cui questo è un item e non una modifica.
**Muove ogni numero della pagina** (`squadGain` lo leggono la classifica, le stelle, la tabella per ruolo,
l'obiettivo dello zaino), e una modifica così si fa quando la si può giudicare. **Il modello è più severo
del gioco**: dà per fissa una maglia per ruolo, mentre il classic sceglie il MODULO — 3-4-3 schiera tre
attaccanti — quindi il terzo e il quarto attaccante hanno un valore d'OPZIONE che questo conto azzera, ed
è proprio quello che il banco del draft aveva misurato come `COVER_COPIES` = 2 (coprire il modulo due
volte, +10,6 punti a giornata). **E il precedente più vicino contraddice le deduzioni di questa
famiglia**: §24.5 legge la coppia di portieri a −0,59 contro i +6/+10 che la deduzione le dava. Quindi la
strada è misurarlo sul banco (una politica «sconta la profondità» contro il piano di oggi, sulle finestre
del gate) prima di toccare la pagina.

### 7-ter · Chi non è più in Serie A: la prova è nel bundle, e non basta come REGOLA

«Vedo Lukaku nei nomi contesi ma ormai non è più in serie A». Il foglio lo tiene, e la ragione è
`snapshot._still_buyable`: un uomo esce dal foglio solo se ha un **marchio di partenza**
(`desc_left_for`, cioè un trasferimento che dice DOVE è andato) *e* la lettura della rosa lo vede fuori
dal perimetro. La lettura viva invece **non lo vede più affatto**, e `live_club_of` restituisce l'ULTIMO
avvistamento col suo giorno: Lukaku legge `desc_live_club` = Napoli **10/08**, su un foglio del 20/08 in
cui il Napoli è stato riletto (30 righe su 34) senza di lui. Cioè la data c'è e la funzione guarda solo il
club.

Misurato sul foglio Serie A rev. 36: **40 righe su 605** hanno l'ultimo avvistamento più vecchio della
lettura più recente del loro club (Dallinga, Lukaku, Mosconi, Posch, Circati...). **E non si adotta come
regola**: fra quelle 40 ci sono Djimsiti, Bennacer e Angelino, che quasi certamente ci sono ancora — un
payload è «la prima squadra come la fonte ha deciso di pubblicarla», e la precisione dell'assenza era
misurata **83,1%** col gate di completezza (`SQUAD_COMPLETENESS` 0.90), che l'app non può vedere. Una
regola nuova qui vuole la sua misura, non una deduzione.

**Quello che è stato fatto invece è il canale che esiste per i fatti che il modello non può raggiungere**:
`config/player_notes.json`, `kind: 'out_of_squad'` — Lukaku c'era già come `dispute` dal 15/08 e adesso è
la dichiarazione dell'operatore del 25/08, datata e revocabile. La pagina delle buste **non leggeva le
note**, ed è il pezzo che mancava: ora `Bidder.outOfSquad` viaggia con la riga (come i giorni di
infortunio, «`buyable` si chiede dentro il solver dove nessun servizio arriva») e `buyable` lo rifiuta,
quindi esce dal piano automatico **e dai nomi contesi**, resta sul tabellone e resta offerbile a mano.
**Solo `out_of_squad`**: `dispute` e `wants_out` sono stati di un RAPPORTO e chi è in rotta domenica gioca
ancora, quindi leggerli come un'assenza sarebbe inventare un fatto da un altro — che è la frase con cui si
apre il file delle note.

Resta aperto per il toolkit, con la sua popolazione già contata: **`_still_buyable` deve leggere la DATA
dell'avvistamento**, non solo il club, e la forma giusta («era nell'ultimo payload completo del suo
club?») va misurata come fu misurata la precisione dell'assenza. Finché non lo è, la nota dichiarata è la
cura, e un `export` + `data:pull` è quello che serve comunque: il foglio è del 20/08 e il mercato è vivo.

**Verificato**: 472 test verdi (31 file), `ng build` verde. Le tre tabelle qui sopra vengono da sonde che
chiamano le funzioni spedite sul bundle vero, non da una copia dell'aritmetica.

---

## 8 — Il modulo di riferimento si SCEGLIE, e un reparto è un insieme (25/08/2026, notte)

Due richieste dell'operatore nella stessa serata, e sono **una correzione sola** — la seconda smonta la
prima se la prima arriva da sola.

> «confermo che il 3-4-3 nel classic è una formazione molto gettonata ma per chi usa il modificatore di
> difesa (o altri tipi di modificatore) anche il 4-3-3 è molto frequente ... devi tarare le buste
> scegliendo quali dei due moduli prendere come riferimento in base ai calciatori già in rosa e quelli
> rimanenti»

> «però non capisco perché nei consigli di reparto dici che la difesa è SCOPERTA — Molina N., Solet, Di
> Lorenzo, Kalulu, Bisseck sono 5 ottimi difensori (quasi tutti titolarissimi), quindi la difesa va solo
> puntellata e non vale la pena spendere crediti che possono essere usati in altri reparti»

### Cosa c'era, e perché le due cose sono la stessa

Il riferimento era **cablato a 1-4-4-2** (`FIELDED_PLACES`, citato da `features.fielded_places` del
toolkit), che non è nessuno dei due moduli che gioca la stanza; e «coperto» era il **conteggio degli uomini
col gradino `titolare` o meglio**. Misurato sui suoi cinque, dal foglio Serie A rev. 36:

| | gradino | quota di calendario |
|---|---|---|
| Solet | `bandiera` | 0,87 |
| Kalulu | `bandiera` | 0,81 |
| Di Lorenzo | `bandiera` | 0,67 |
| Bisseck | `ballottaggio` | 0,66 |
| Molina N. | `ballottaggio` | 0,50 |

`playsOften` risponde **false** a un `ballottaggio`, quindi 3 titolari su 4 maglie → `scoperto`. Vero su
ogni uomo e **la domanda sbagliata sull'insieme**: quelle cinque quote coprono **3,36 posti su 4**, cioè
**0,64 di buco a giornata**. È la stessa lezione dei portieri di due ore prima, un piano più su: *un
binario per uomo non risponde a una domanda su un reparto*.

E qui sta l'incastro: **col modificatore attivo il riferimento giusto ha QUATTRO difensori**, quindi la
sola scelta del modulo avrebbe lasciato «scoperto» dov'era. Serviva l'altra metà.

### Le tre decisioni dell'operatore, registrate come input e non dedotte

- **Il modificatore di difesa è ATTIVO e «deve essere una informazione da mettere come input (come le
  impostazioni delle rose)»**: `LeagueRules.defenceModifier`, interruttore nella barra delle impostazioni
  accanto a «ruolo pieno = fuori», ricordato come le altre. Decide la **forma** e **non entra in nessuna
  valutazione**: quanto valga il modificatore — paga sulla media voto del blocco difensivo — non è
  misurato da nessuna parte in questo progetto, e dirlo è il punto.
- **I suoi due moduli vengono primi**, e gli **altri cinque del regolamento** si consultano solo quando
  nessuno dei due è copribile («sì, gli altri cinque»). Un pareggio non muove il bersaglio: si cambia
  modulo solo se un altro è **strettamente** meglio, altrimenti il riferimento ballerebbe mentre compra.
- **Le maglie si leggono dal regolamento** (`classic_modules.json`, letto dal bundle e mai trascritto: è
  configurazione, e porta la sua verifica di trascrizione). Senza quel file la pagina taro sull'undici
  standard **e lo dice a schermo**, perché un ripiego silenzioso è indistinguibile da una funzione rotta.

### Come si sceglie, e cosa costa una forma

`expectedHoles(uomini, ruolo, maglie)`: le quote di presenza dei suoi uomini sono estrazioni indipendenti
(`expected / matchdays`), quindi «quanti hanno il voto» è una convoluzione e i posti vuoti attesi sono una
somma su di essa. **Esatto, non simulato**, e nulla è tarato: l'unica scelta è `HOLE_TARGET` = **1**, cioè
«una maglia intera vuota in una giornata tipo», **dichiarata** e non misurata — quanto COSTA un buco si sa
(la panchina, mezzo punto di fantamedia sotto il rimpiazzo), quando valga la pena spendere un credito per
chiuderlo è una preferenza.

Il costo di una forma è la somma dei suoi buchi, e i moduli si confrontano **prima** su quello che non si
può riempire (`unfillable`: buchi meno gli uomini che giocano ancora raggiungibili col suo tetto — è la
metà «e quelli rimanenti» della sua frase) e **poi** sui buchi stessi.

**Una definizione, tre lettori**: il verdetto a schermo, il vincolo del piano (`ensureSure`) e la scelta
del modulo. Che è anche il modo in cui la sua regola del mattino — «le buste consigliate devono
rispecchiare i consigli che dai reparto per reparto» — **resta in piedi mentre il meccanismo cambia**:
`sureTarget` torna a essere il suo **pavimento** («un paio per ruolo») invece di `max(2, maglie)`, ed è
proprio quello che smette di chiedere un quarto difensore a chi ne ha cinque.

### Verificato sui numeri veri

Chiamando le funzioni spedite sul bundle vero, con la sua difesa e il modificatore acceso:

```
moduli letti dal regolamento: 3-4-3 (D3C4A3) · 3-5-2 · 4-3-3 (D4C3A3) · 4-4-2 · 4-5-1 · 5-3-2 · 5-4-1
modificatore ATTIVO -> 4-3-3   (secondo 5-3-2)
  buchi: D 0,64 su 4
  difesa: SOLIDO · titolari 3 · «le 4 maglie del 4-3-3 le copri (0,6 di buco a giornata, 5 uomini in
          rosa): qui non serve altro. I crediti rendono di più dove sei scoperto.»
```

Prima: `scoperto`, «ti manca 1 titolare per coprire l'undici (3 su 4)». E sulla pagina vera (e2e col round
seminato): il modulo è **dichiarato accanto al titolo del piano** col perché e col secondo nel tooltip, e
**4 reparti su 4** portano a schermo il numero da cui il verdetto esce — due passi nuovi dell'arnese, così
«scoperto» non è più una parola senza il suo numero.

### 8-bis · E questo CORREGGE la tabella del §7-bis

Quel conto («il 3º attaccante aggiunge il 44% di quello che il piano gli accredita») era misurato su
**A = 2**, cioè sull'1-4-4-2 cablato. Entrambi i moduli che l'operatore gioca schierano **TRE**
attaccanti, e con tre maglie il terzo attaccante è un **titolare**:

| ruolo · maglie | 3º uomo | 4º | 5º | 6º |
|---|---|---|---|---|
| A · 3 maglie | **100%** | 52% | 30% | 8% |
| C · 3 maglie (4-3-3) | 100% | 58% | 26% | 24% |
| C · 4 maglie (3-4-3) | 100% | 100% | 69% | 52% |
| D · 4 maglie | 100% | 100% | 65% | 28% |

Quindi «l'attacco è coperto ma consigli di spendere di più per un attaccante» era in buona parte **il
riferimento sbagliato**, non lo zaino: con due maglie il terzo attaccante sembrava profondità, con tre è
uno che scende in campo. Quello che resta aperto del §7-bis è solo la **coda** — dal quinto in poi, in ogni
ruolo, il piano accredita a un uomo più di quello che l'undici raccoglie — e resta un item da misurare sul
banco, non una modifica da fare a mano.

**Verificato**: 482 test verdi (31 file), `ng build` verde, e2e sulla pagina vera «nessun problema» con i
due passi nuovi. I numeri di questa sezione vengono da sonde che chiamano le funzioni spedite sul bundle
vero.
