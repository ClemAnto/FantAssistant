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
Alla chiusura della sessione: **406 prove verdi**, `ng build` verde, e2e **senza problemi**.

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
