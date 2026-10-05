# Priorità del draft — specifica v1

**28-29/09/2026, dettata dall'operatore in una conversazione di progetto. Implementata e misurata SUL
BANCO (§7-§12); nell'app dal 29/09/2026 (§13).** Il valore si chiama **Draft Priority** (a schermo «priorità») e risponde a una domanda sola:
*quale calciatore prendo adesso, al mio turno*. Vale per la lega **EuroLeghe** (euro · mantra · 12
squadre · 2 **porte** + 30 di movimento, nessuna quota per ruolo, giocatori dei club italiani esclusi).
Il gioco di riferimento è il MANTRA: ogni «ruolo» qui sotto è un ruolo mantra.

Regola di casa che vale per tutto il documento: la priorità è una POLITICA, quindi si giudica sul banco del
draft (`toolkit/bench/draft/`) contro quella che il pannello usa oggi (`core/auction-plan.ts`,
`pickForUs`: VALORE × copertura di due undici × `SURVIVOR_DISCOUNT` 0,7) e solo dopo entra nell'app. Se
perde di poco, si spiega perché e decide l'operatore (sua istruzione: «potrei voler adottare comunque la
formula»).

## 1. Il regolamento dichiarato

| Voce | Valore | Fonte |
|---|---|---|
| Squadre | 12 | `league_config.json` |
| Rosa | 2 porte + 30 di movimento, senza quote per ruolo | operatore, 28/09 |
| Ordine | 1º giro sorteggiato (lui è **8º**); dal 2º chi ha meno scelte, poi **FVM totale di rosa più basso** | operatore; è il `compare()` di fanta-asta-live già in `auction-plan.ts` |
| Tetto dei primi turni | FVM ≥ 213 congelati per 5 turni (`draftCap`) | Opzioni, 28/09 |
| Sostituzioni | **illimitate**, secondo la matrice mantra (`mantra_modules.json`, `-1` = malus fuori ruolo) | operatore |
| Riserva d'ufficio | **disattivata**: un posto che nessuno può coprire vale **0** | operatore |
| R-Factor | sufficienza = **voto BASE ≥ 6**; 8 → +0,5 · 9 → +1 · 10 → +2 · 11 → +3; **un posto a 0 lo AZZERA** | operatore, 28/09 |

Quindi un buco costa due volte: lo 0 al suo posto e tutto l'R-Factor della giornata. È la ragione per cui
una riserva con molte presenze nel ruolo giusto vale più di quanto dica la sua FM.

## 2. Il valore di un uomo

**V = Pv × (FM − Z) + (N − Pv) × (R − Z)**

* **Pv** = presenze attese (foglio: `engine_pv_pred` / `est_pv`, col gradino della stampa dove c'è, lo
  storico, l'assicurazione infortuni).
* **FM** = fantamedia prevista (la cascata del foglio: stagioni passate + giornate di quest'anno, R25).
* **N** = giornate che restano.
* **Z** = FM media del suo **ruolo base**, cioè il suo ruolo mantra più DIFENSIVO (la linea più bassa in
  cui il rulebook lo mette: Dc/Dd/Ds/B → E/M/C/W → T/A → Pc; M, C ed E stanno alla stessa profondità e il
  pareggio lo decide l'ordine del rulebook). Serve a rendere comparabili i ruoli: un terzino che fa gol è
  insolito e vale più di un'ala che fa gli stessi gol. **Solo sugli ACQUISTABILI da una lega a 12** (sua
  correzione, 28/09): i primi 12 × 30 di movimento per resa attesa e le prime 24 porte, non tutto il
  listone. **Media troncata**: 10% in alto e 10% in basso; nell'app anche via gli infortunati pesanti
  (stop aperto ≥ 45 giorni, la soglia dell'icona), che le finestre storiche non sanno datare.
* **R** = FM della riserva che gioca al suo posto. **Prima** che la rosa ne abbia una compatibile, per
  fasce del titolare: super/top → mediana del ruolo (≈ Z) · semi/promessa → 25° percentile · solido, boa e
  sotto → 10° percentile («un TOP ha una riserva media, un SEMITOP una scarsa»). **Dopo**, la riserva
  VERA: sua probabilità di avere il voto × sua FM (con il −1 se entra fuori ruolo), e 0 se non c'è.

Esempio vero (foglio EuroLeghe del 28/09, club italiani esclusi, N = 27; Z: Pc 7,39 · A 7,17 · T 6,89 ·
W 6,78 · C 6,46 · M 6,22 · Dd 6,12 · Ds 6,12 · Dc 5,98 · Por 5,04): Saka (W, FM 7,25, Pv 23,1) legge
**10,8** di primo termine, Grimaldo (Ds, FM 6,87, Pv 24,0) **18,0**.

**La proprietà che l'operatore ha chiesto e confermato**: A segna sempre ma gioca 10 partite, B segna una
volta ogni due e ne gioca 20, stesso ruolo e stessa MV. A − B = 10 × (R − MV): sono equivalenti **solo se
la riserva vale il voto base di B**; con una riserva peggiore o un buco vince B. Caso vero dal banco
(Serie A): Anguissa 6,81 in 18 giornate e Barella 6,72 in 34 valgono 250 e 254 con una riserva, 28 e 210
senza. L'R-Factor rompe l'equivalenza a favore di B, di poco.

**Conseguenza di strategia, sua**: un calciatore con FM alta e poche presenze si può prendere da titolare,
ma la sua riserva deve avere MOLTE presenze. Esce dalla formula: una riserva vale le giornate che copre ×
la sua probabilità di avere il voto × la sua FM, quindi una riserva da FM alta e poche presenze vale poco
proprio dove serve (è `simulatore-asta-rilanci-v1.md` §26 visto dal draft).

## 3. La priorità

**Priorità(x) = G(x) + miglior G disponibile al prossimo turno, dopo aver preso x.**

* **G(x)** = quanto sale il valore della rosa, per strati: primo undici legale (peso pieno), seconda linea
  (peso minore), rincalzi (minore ancora). Il modulo di riferimento parte da **4-2-3-1 e 4-1-4-1** ma a
  ogni scelta si guardano **tutti** gli undici moduli mantra: un altro sostituisce i suoi due solo se è
  strettamente meglio. Il posto di ciascuno lo decide il matching mantra (un C/T va dove serve). Per
  scegliere il MODULO si usa il valore assoluto `Pv × FM + (N − Pv) × q × R`, perché moduli diversi hanno
  posti diversi per ruolo e la costante `N × Z` non si annulla.
* **R-Factor**: non sta sulla riga, è una soglia sull'undici. Si calcola il suo guadagno atteso esatto
  (Poisson-binomiale sulle sufficienze) mettendo x al posto dell'uomo peggiore del suo posto.
* **Secondo termine** (i suoi punti 2, 6, 7): si simulano gli `n` rivali fino al mio prossimo turno, e `n`
  si RICALCOLA dall'FVM di x, perché prendere un FVM alto mi manda più indietro nell'ordine. I rivali
  scelgono con `predictRivalPick`, pesato su quello che manca alle loro rose. La scarsità esce da sé: se
  restano molti equivalenti, il secondo termine è alto e x può aspettare. È la forma esatta di quello che
  oggi fa lo sconto costante 0,7.

## 4. Il doppione

Al massimo **2 per rosa**, solo **super** e **top**. Si prende se il guadagno futuro supera la perdita di
oggi:

* **perdita** = priorità della migliore scelta non-doppione − priorità del doppione;
* **guadagno** = **0,5** × [G del miglior uomo di un ALTRO ruolo con FVM pari o inferiore, nel ruolo di cui
  la rosa ha più bisogno − G del doppione tenuto in panchina]. Lo scambio si fa a pari FVM; lo sconto del
  50% è la sua stima di quanto sia difficile chiuderlo («dopo 1 o 2 giornate già sarebbe possibile ma
  dipende da tante condizioni»). Dichiarato: nessun banco misura uno scambio.

Il consiglio doppione si EVIDENZIA e si distingue da quello classico (etichetta e colore suoi, «scambiabile
per X, pari FVM»).

## 5. Il banco: cosa va esteso prima di misurare

Oggi il banco simula 3 portieri + 22 di movimento, schiera l'undici migliore A POSTERIORI fra chi ha preso
il voto, e non conosce porte né R-Factor. Per giudicare la priorità sul gioco dell'operatore:

1. **Porte**: una porta è un club; il suo voto di giornata è quello del portiere di quel club che ha giocato.
2. **12 squadre, 2 + 30**, club italiani fuori dal listone simulato.
3. **Formazione consegnata PRIMA** della giornata (sul valore atteso), poi sostituzioni illimitate secondo
   la matrice con il suo −1, 0 dove nessuno entra.
4. **R-Factor** sui voti base (`windows.json` li porta già, `base`).
5. Riprodurre la politica attuale sul banco esteso PRIMA di confrontarci qualunque cosa.

Limiti da dire: il gradino della stampa esiste solo da questa stagione, quindi le finestre storiche non
possono giudicarne il contributo; e le categorie (super/top/…) sulle stagioni passate vanno ricostruite
con lo stesso metro (`categories`), non lette dal foglio di oggi.

## 6. Ordine di lavoro

1. Estendere il banco (§5) e riprodurre la politica attuale.
2. Scrivere la priorità in `policies.mjs`, confrontarla in punti a giornata sulle 5 finestre euro.
3. Solo dopo: nell'app, con il consiglio doppione distinto e il modulo di riferimento scritto accanto.

## 7. Implementazione sul banco (28/09/2026) — cosa ha dovuto decidere

File: `toolkit/bench/draft/priority.mjs` (la politica), `lineup.mjs` (la giornata col suo regolamento),
`extract.py --porte --no-italian` (le finestre), `multi.mjs priority ... --declared` (la corsa). Il metro
pubblicato non si muove: A/B contro HEAD sulle stesse finestre, 3 politiche × 5 stagioni, **identico**.

**Il banco, per giocare il suo gioco.**
* **Porte**: una porta è un club, vale la media dei suoi portieri pesata sulle presenze attese (la sua
  definizione), e il suo voto di giornata è quello del portiere del club che ha giocato, letto per SQUADRA
  nei voti e non per rosa. **Prezzo = quello del portiere TITOLARE** (sua regola, 28/09: «si chiama il
  portiere titolare e non le riserve»), e il titolare è **il più caro per FVM** (sua regola, stessa sera).
  Sul banco «il più caro» legge la Qt.I, perché l'FVM archiviato di una stagione passata è l'ultima lettura
  e sa già chi ha giocato; l'app legge l'FVM. In un draft il prezzo è anche la posizione nell'ordine. La
  prima stesura usava il più economico, per ipotesi mia. Senza club italiani le porte sono **26-28 per 24 posti**: scarse.
* **Rosa esatta 2 + 30 per TUTTI** (`setup.exactKeepers`): i rivali simulati scelgono per prezzo e una
  porta costa 1, quindi senza la regola finivano il draft **senza nessuna porta** (0 su 10) — un buco a
  ogni giornata che avrebbe gonfiato ogni confronto a nostro favore.
* **Giornata**: undici consegnato prima (il migliore legale su `p × fm_pred`, e nessuno schierato fuori
  ruolo: sua regola), poi sostituzioni illimitate **nell'ordine del regolamento** — in ruolo nello stesso
  schema, altrimenti CAMBIO DI MODULO purché tutti restino in ruolo, e solo se nessun modulo lo permette
  l'ingresso fuori ruolo col −1 (sua precisazione, 28/09: «può accadere solo se una riserva entra e l'unico
  modulo ammesso è uno dove lui è fuori ruolo»). 0 dove nessuno entra, R-Factor sui voti base azzerato da
  un buco. Un'approssimazione detta: il −1 cade sul fantavoto e non sul voto base. E un'altra, nella
  VALUTAZIONE e non nel punteggio: la copertura di un posto in `squadWorth` legge il −1 della matrice senza
  provare il cambio di modulo, quindi stima una riserva fuori ruolo un po' peggio di quanto giocherà.

**Tre correzioni alla formula trovate dalla prima corsa, tutte nella stessa famiglia** — lo zero di un
posto:
1. un posto dell'undici **vuoto** valeva 0, quindi ogni titolare vero con qualche assenza sembrava una
   PERDITA rispetto a lasciarlo vuoto, e la prima rosa era fatta di centravanti con il 63% dei posti
   scoperti. Ora vale quanto un acquisto MEDIO del suo ruolo (fantamedia Z, presenze medie, riserva
   dell'ultima fascia) — **e quella promessa sfuma con le scelte che restano** (29/09), fino a valere un
   buco vero (0, e niente R-Factor) all'ultima scelta. Senza la dissolvenza un posto vuoto sembrava un uomo
   medio fino alla fine, e con il tetto dei primi turni attivo la priorità ha chiuso un draft con il terzo
   posto da centrale vuoto tutta la stagione (93 buchi: aveva preso Lewandowski E Kane). Le simulazioni sul
   listone di oggi del 28-29/09 (le 12 rose, le strategie S1-S3, le teste dei rivali, la profondità 3/6)
   girarono PRIMA di questa correzione;
2. la riserva ipotetica R era scontata una seconda volta per le sue assenze (`PRIOR_COVER` 0,75 sul
   VALORE): R è già «la riserva che avrai», e la probabilità entra solo nell'R-Factor;
3. la riserva ipotetica non scadeva mai, quindi qualunque riserva VERA leggeva peggio di lei e dalla
   dodicesima scelta si compravano punte che non cambiavano niente. Ora **sfuma** con le scelte che
   restano (`priorLeft`: piena finché l'undici non è fatto, zero all'ultima scelta) — una promessa che il
   draft non può più mantenere non vale niente.

**Z sugli acquistabili** (sua correzione): i primi `12 × 30` di movimento per resa attesa e le prime 24
porte, media troncata al 10% per lato. Le fasce (top ≥ 90° percentile della fantamedia del ruolo base,
semi ≥ 70°) si leggono sulla stessa popolazione.

**Il doppione è un top che RESTA FUORI dall'undici**, non «un secondo top dello stesso ruolo base»: la
prima definizione contava come doppioni due Dc top titolari insieme, che un 4-2-3-1 schiera entrambi.
Il tetto di 2 si legge sui top in panchina già in rosa.


## 8. Il verdetto sul banco (29/09/2026, PRIMA della review — da rileggere con §12)

Cinque stagioni euro (Tm4…T2) col suo regolamento (`multi.mjs … --declared`), guadagno sui punti a giornata
contro il pannello di oggi (`pickForUs`: valore × copertura × sopravvivenza, 73,9 punti a giornata):

| Politica | Posto 8 (8 seed) | Tutti i posti (2 seed) |
|---|---|---|
| priorità, sguardo di 1 turno **sempre** | +2,37% (4/5) | **+2,66% (5/5, strict)** |
| priorità, sguardo di 1 turno **fino al 7º turno** | +2,32% | **+2,69% (5/5, strict)** |
| inizio a profondità 6 + «primi 3» | +2,33% | +2,37% |
| inizio a profondità 3 + «primi 3» | +1,42% | +2,33% |
| nessuno sguardo avanti | +1,66% | +1,89% |

Con il tetto dei primi turni attivo (`--cap=12`: sulle finestre passate il prezzo è Qt.I, quindi «supertop» =
i 12 più cari di quel listone, quanti ne congela oggi il 213 FVM). R-Factor da 0,80 a ~1,0 a giornata, buchi
0,5-0,8 a stagione. Lettura: guardare avanti vale ~+0,5 punti a giornata e **un turno basta**; lo sguardo
solo fino al 7º turno rende uguale ed è più veloce. **Questi numeri precedono la review (§12)**, che ha
trovato due difetti proprio nello sguardo avanti: il confronto è stato rilanciato e il suo esito è l'aperto
numero uno.

## 9. Le prove sul listone di oggi (28-29/09) — con un difetto dentro, lette per il MECCANISMO

`show.mjs` e gli script di scratchpad simulano un draft a 12 sul listone EuroLeghe 2026-27 (`current.py`: il
foglio di oggi, l'FVM mantra come prezzo, club italiani fuori). Girarono **prima** della dissolvenza del posto
vuoto (§7), quindi le cifre non si citano; il meccanismo sì, perché si è visto in ogni prova:
* **il tetto dei 213 per 5 turni più l'ordine per FVM di rosa decidono la partita.** Chi spende poco nelle
  prime 5 scelte (terzini da bonus, Pedri, Joao Neves: la valutazione relativa a Z li preferisce DA SOLA a un
  attaccante da 180) sceglie per primo al 6º turno e prende il supertop che si sblocca (Kane, Mbappé,
  Haaland, Yamal). Forzare le prime 5 scelte sull'FVM più alto costò a una squadra ~4 punti a giornata in un
  draft;
* **le teste «FVM più alto nel ruolo» perdono per i BUCHI in difesa**, non per i titolari: comprano attaccanti
  che restano in panchina (fino a ~1.100 FVM) e lasciano posti di difesa senza riserva in ruolo;
* il «supertop da restare nei primi 3» come obiettivo esplicito non aggiunse niente oltre a quello che la
  valutazione fa già.

## 10. Prevedere i rivali: si riconoscono, e non serve

Sua domanda: «sarebbe possibile individuare le strategie degli avversari e prevenire le loro mosse?». Sua
lettura: difficile se scelgono per simpatia o giudizio, fattibile se seguono un criterio. **Misurato, ha
ragione su tutt'e due**: una testa a criterio (FVM, valore, surplus) si riconosce dal percentile delle sue
scelte sotto ciascun criterio al **92% dopo 2 scelte e al 99% dopo 3** (72 casi); chi sceglie «per giudizio»
(FVM + un parere privato) si legge come FVM e il parere non si vede. **Ma prevederli non paga, nemmeno con
l'oracolo** (le teste vere dentro la simulazione): 75,10 → 74,79 e 75,20 → 75,06 punti a giornata, dentro
un'oscillazione di ±0,7. La ragione: la testa di un rivale dice QUALE attaccante caro prende, e la priorità
quegli uomini non li vuole; quello che le serve — la posizione nell'ordine, che è FVM speso, e che gli uomini
forti e poco cari restino liberi — non dipende da quale testa ha il rivale. **Decisione: le previsioni sulle
strategie dei rivali si abbandonano**; nelle simulazioni interne i rivali restano «per FVM».

## 11. Cosa NON è ancora nell'app, e come ci arriva

La politica vive in `toolkit/bench/draft/priority.mjs`. Il passo successivo, dopo il verdetto di §12, è
`app/src/app/core/draft-priority.ts` (il banco la rileggerà da lì via `appcode.mjs`, come per `pickForUs`),
con: lo sguardo di un turno fino al 7º; il consiglio DOPPIONE distinto (etichetta e colore suoi, «scambiabile
per X, pari FVM»); il modulo di riferimento scritto accanto; Z sui soli acquistabili togliendo anche gli
infortunati pesanti (che l'app sa datare e le finestre storiche no); il prezzo di una porta = l'FVM del suo
portiere più caro. Il doppione sul banco costa ~0,4% **per costruzione** (il banco non simula scambi), quindi
acceso o spento è una sua scelta al tavolo.

## 12. La code-review del 29/09/2026 e il confronto rilanciato

Dieci rilievi, tutti applicati; i numeri pubblicati del banco si riproducono identici (A/B contro HEAD, 3
politiche × 5 stagioni). I due che toccano §8:
* nei turni col tetto la shortlist e i 10 candidati dello sguardo avanti venivano dal pool INTERO, quindi lo
  sguardo si spendeva su supertop non chiamabili;
* lo sguardo di un turno (`nextBest`) non applicava né il tetto né le porte esatte, per i rivali simulati e per
  la nostra scelta successiva.

Curati con UNA definizione delle regole (`engine.legalPoolFor`), letta dal motore, dai candidati della
priorità e da tutt'e due gli sguardi avanti. Gli altri: le varianti «inizio a profondità k» ora cambiano UNA
cosa (dopo l'inizio tengono lo sguardo di un turno invece di spegnerlo), il loro «hunting» usa il confine del
motore (`<`), la regola «primi 3» vale anche quando la simulazione è troppo corta per arrivare al 6º turno, il
ruolo base si legge dal regolamento invece che da una tabella scritta a mano, buchi e R-Factor restano «-» dove
il metro pubblicato non li misura, `multi.mjs` rifiuta i flag sconosciuti, il doppione e le statistiche per
ruolo si calcolano una volta per scelta e per finestra, `show.mjs` conta un posto vuoto come lo 0 che segna,
`extract.py` stampa le porte senza voti (su Tm4 sono club fuori dal perimetro di quella stagione, non grafie).

**APERTO numero uno**: `node multi.mjs until EuroLeghe windows-porte.json --declared --cap=12` (posto 8 con 8
seed e tutti i posti con 2 seed), lanciato alla chiusura: conferma o smentisce §8 dopo le correzioni.

**ESITO (29/09/2026, tutti i posti, 2 seed, `--declared --cap=12`)**, guadagno sui punti a giornata contro
`pickForUs` (73,9 punti a giornata):

| Politica | Tm4 | Tm3 | T0 | T1 | T2 | media | verdetto |
|---|---|---|---|---|---|---|---|
| nessuno sguardo | +1,43 | +4,71 | +1,85 | +0,23 | +0,98 | **+1,84%** | 5/5 strict |
| sguardo 1 sempre | +1,16 | +4,57 | +1,88 | +0,68 | +0,03 | +1,66% | 5/5 strict |
| sguardo 1 fino al 7º turno | +0,74 | +3,78 | +2,06 | +0,00 | +0,19 | +1,35% | 5/5 strict |
| inizio prof. 3 + primi 3 | +1,07 | +4,82 | +0,65 | −0,28 | +2,60 | +1,77% | 4/5 robust |
| inizio prof. 6 + primi 3 | +0,78 | +5,90 | +3,45 | −0,70 | +0,31 | +1,95% | 4/5 robust |

La priorità **resta sopra** la politica spedita su ogni finestra (75,2 contro 73,9 punti a giornata, R-Factor
0,92 contro 0,80), ma il guadagno si dimezza rispetto al +2,7% di §8 e **lo sguardo avanti smette di pagare**:
tolti i due difetti (i rivali simulati che violavano il tetto e le porte), «nessuno sguardo» vince 4 finestre
su 5 contro «fino al 7º turno». Quel mezzo punto dello sguardo in §8 era il difetto, non il meccanismo. L'app
(§13) usa lo sguardo fino al 7º turno come la specifica diceva: passare a nessuno sguardo è una riga
(`LOOKAHEAD_UNTIL` = 0) e più veloce, ed è una decisione dell'operatore davanti a questi numeri.

## 13. Nell'app (29/09/2026)

Richiesta dell'operatore («implementa il Draft Priority nella vista Draft Assistant»), presa prima che il
confronto rilanciato di §12 finisse: la decisione è sua, come l'introduzione prevedeva («potrei voler adottare comunque la
formula»), e il verdetto del rilancio si scrive qui sotto quando arriva.

**Dove vive.** `app/src/app/core/draft-priority.ts`, porting di `toolkit/bench/draft/priority.mjs` con la stessa
aritmetica (Z sugli acquistabili con media troncata, riserve a catena col −1 della matrice, prior delle fasce che
sfuma con le scelte, posto vuoto come promessa che diventa buco, R-Factor esatto sull'undici, doppione a metà
scambio). Nessun import di Angular, così il banco potrà rileggerlo da `appcode.mjs` come fa con `pickForUs`
(aperto: oggi il banco usa ancora la sua copia). Si accende da sé dove è stata scritta — **draft mantra con la
matrice delle sostituzioni nel regolamento** (`AuctionAdvice.priorityOn`); altrove resta `pickForUs`.

**Cosa la legge, una definizione e tre lettori.** La colonna «Prio» (`AuctionAdvice.priorities`), il consiglio
del turno e il giro previsto (`simulateRound`), i suggeriti del campetto (`projectOurPicks`): `auction-plan`
prende un `OurChooser` opzionale in `PlanInput`, così `plan`/`simulateRound` non sanno quale politica sceglie per
noi. Lo sguardo di un turno gira sui 10 migliori per G fino al 7º turno (`LOOKAHEAD_UNTIL`, la variante di §8
che rende uguale ed è più veloce); le scelte successive di una proiezione usano G da solo sulla lista corta
(6+3 per ruolo base), la scorciatoia del rollout del banco. ~~I rivali nelle simulazioni interne scelgono per FVM
(§10); il giro a schermo tiene le teste stimate, come prima.~~ Dal 29/09 (sera) lo sguardo avanti usa le STESSE
teste e la stessa regola di coda del giro a schermo: vedi §14.

**Cosa l'app aggiunge rispetto al banco, per la specifica.** Z esclude i club esclusi dalle opzioni e gli
infortunati pesanti (stop aperto ≥ 45 giorni, `PlayerStatus.longInjury`); con le porte una riga per club, col mix
dei portieri; la costanza viene da `PlayerRatingsStore` (voti base ≥ 6), mediana del ruolo dove manca;
`share` = presenze attese / giornate del foglio; l'R-Factor si spegne se la lega non lo paga
(`LeagueSettings.rFactor`).

**Il doppione a schermo.** Etichetta «doppione» accanto al consiglio e «⇄» sulla riga, colore suo
(`--color-double`), tooltip «scambiabile per X, pari FVM». **Solo dalla 7ª chiamata** (sua regola, 29/09/2026:
`DOUBLES_FROM_CALL`), e un interruttore «Consiglia doppioni (dalla 7ª chiamata)» sotto il consiglio, ricordato
nel browser: sul banco il doppione costa ~0,4% per costruzione, quindi è una scelta al tavolo. L'etichetta dice
la soglia perché prima della 7ª l'interruttore non può cambiare niente, e un controllo muto si legge come rotto.

**Misurato.** Sul listone EuroLeghe di oggi (617 uomini, 12 squadre, tetto 213/5) una valutazione piena dura
~60 ms e quella corta ~6 ms; la prima scelta al posto 8 è Undav (Kane in cima alla colonna, congelato). Banco
`e2e-draft` verde sulle due leghe; due sue asserzioni dipendevano da coincidenze delle scelte vecchie e sono
state riscritte sull'intento (AUTO può partire ovunque nell'ordine; il refresh confronta la MIA rosa, dichiarata
da `data-mine`, e non quella del campetto, che segue l'ultimo click e non si salva) — e il doppio click del banco
ora va sulla prima riga CHIAMABILE, perché la priorità mette un top congelato in testa alla lista.

**Limiti detti.** Fuori dai 10 della testa la colonna è G più lo sguardo avanti PIÙ BASSO dei dieci
(`nextFloor`, il caso Hakimi dello stesso giorno), cioè una stima prudente e non il suo sguardo. Presenze e fantamedia sono quelle del foglio: il gradino della stampa e le
dritte non entrano (come nel resto del pannello d'asta).

## 14. La code review della pagina (29/09/2026, sera)

Nove rilievi sulla pagina Draft Assistant e sui suoi `core/`. Sette sono corretti. I primi tre del codice hanno
un test che cade se si rimette il difetto, e con quei difetti rimessi cadono solo quei tre test.

- **Il doppione si scambia anche con un uomo di una rosa RIVALE.** L'app cercava il bersaglio dello scambio
  fra i soli liberi, mentre il banco lo cerca fra tutti gli uomini non nostri (`everybody`, liberi più rose
  rivali). Senza i rivali mancava proprio l'uomo con cui uno scambio si fa. Ora `PriorityInput.playerOf`
  risolve gli uomini delle rose, come fa il banco. Resta che un bersaglio può essere un libero: capita solo
  quando il libero non è chiamabile, perché altrimenti supera il doppione in graduatoria.
- **Lo sguardo avanti prevede i rivali come il giro a schermo**: stessa testa stimata (`PriorityInput.heads`) e
  stessa regola di coda contata dalla fine dell'ordine. Prima scelgevano per prezzo e senza coda, quindi un
  rivale prendeva due uomini diversi in due simulazioni dello stesso stato. **Questo rovescia una riga
  dichiarata del §13, e il numero non lo decide**: il §10 dice che conoscere le teste non paga, quindi fra i due
  modelli nessuno è migliore, e vince la coerenza. Il banco (`priority.mjs`) resta per prezzo, com'è stato
  misurato.
- **Lo zero di una rosa che nessuno può schierare sono undici posti vuoti**, non 0. Il G della prima scelta ora
  sta sullo stesso zero di quelle successive. La graduatoria della prima scelta non cambia, perché lo
  spostamento era una costante; cambia il numero mostrato. **Il banco ha lo stesso difetto e non è toccato.**
- **Squadra assente dall'ordine del giro** (ha già chiamato, o ha la rosa chiusa): `priorityRows` la leggeva come
  «chiamiamo per primi». Ora fa chiamare il resto del giro, poi chi la regola d'ordine mette davanti a noi nel
  giro successivo. Con la rosa chiusa la colonna è vuota.
- **Una valutazione per stato.** La memo è chiavata sull'ordine DAL nostro posto e non sull'ordine intero più
  l'indice, e la colonna legge la stessa memo del consiglio: prima lo stesso stato si ricalcolava tre volte a
  ogni evento dello stream.
- **La lista dei liberi si ordina sul punteggio vero**, anche nell'ordinamento per colonna «Prio». Il valore
  0-99 arrotondato pareggiava uomini distanti un punto e portava a 0 ogni punteggio negativo.
- **La riga del tetto senza squadra seguita** enuncia il regolamento («nei primi N turni») invece di un conto
  alla rovescia che non è di nessuno.
- **Docstring di `priorities`** aggiornato: diceva ancora che la Draft Priority non era passata dal banco.

**Non fatti, e perché.** I commenti in italiano non sono stati tradotti: tutta `app/` li ha, e una traduzione di
massa toccherebbe prosa di altre sessioni. La regola «solo porte» (`legalFor`) vale nello sguardo avanti ma non
in `simulateRound` e `projectOurPicks`, perché `predictRivalPick` non conosce la taglia della rosa. Pesa solo
nelle ultime scelte di una squadra a cui mancano porte, ed è aperto.

**Un difetto del banco e2e trovato strada facendo.** `e2e-draft` è andato rosso sul delta FVM in hover, verde su
HEAD. La pagina era corretta: il puntatore del passo precedente stava su una riga della lista, e ora che la
lista è ordinata sul punteggio vero quella riga è un'altra, con un tooltip che arriva sopra l'ordine. Un
puntatore teletrasportato che atterra su un tooltip lo tiene aperto. Il banco ora riparte da un punto neutro e
conta i tooltip rimasti aperti.


## 15. Il draft vero FA-jo5-zai (29/09/2026, sera) e la formula ridichiarata

**Ricostruito dalla produzione in sola lettura** (12 squadre, 32 scelte a testa, 384 scelte). La regola
d'ordine riproduce **384 scelte su 384**. Nei primi cinque giri nove squadre chiudono fra 275 e 376 di FVM
totale, e il 6° giro (lo sblocco dei ≥213) segue esattamente quei totali: le prime sei prendono Haaland,
Kane, Raphinha, Mbappé, Olise e Yamal. L'operatore sceglie 2° e prende Kane (490), poi aspetta **21
scelte**, durante le quali escono **19 attaccanti** (A/Pc/W). Le due squadre che spendono di più nei primi
cinque giri (566 e 611) arrivano ultime allo sblocco.

**Il difetto che lui ha visto al tavolo, misurato sulla pagina vera** (il draft troncato a ogni suo turno e
servito da un finto fanta-asta-live alla `/auction` del build): alle scelte 156 e 180 la colonna era VUOTA
perché tutti i punteggi erano negativi, alle 202 e 237 leggeva 0 su 56-57 righe di 60. La causa era la
promessa della riserva di §13 che sfuma con le scelte rimaste: ogni scelta addebitava all'uomo scelto lo
sfumare della promessa di tutti i posti che copriva. Con la promessa tenuta ferma i negativi scendevano da
511/487/462/426 a 250/132/52/61 - ma la correzione non è stata fatta, perché l'operatore ha ridichiarato la
formula.

**LA FORMULA DICHIARATA** (sua, 29/09/2026): `Priority = [P (Fm - Z) + (N - P) (R - Z)] / N`, in punti a
giornata, mostrata **per 100 e troncata** (0,15657 → 15; 1,1 → 110). P e Fm come in §2, N le giornate della
competizione. **«Z dovrebbe rappresentare un titolare e R una riserva»**: i comprati da una lega di questa
taglia di ogni ruolo base si dividono per FANTAMEDIA - i migliori `squadre × posti del ruolo nel regolamento`
(media sui moduli, una porta per squadra) sono i titolari, il resto le riserve - e Z è la media troncata dei
titolari, R la media delle riserve («l'ipotetico calciatore di ripiego che puoi avere in rosa, un fantavalore
medio di basso rango»). Un numero per ruolo base, uguale per tutte le rose. Dove la lega compra meno uomini di
un ruolo di quanti ne schiera, R ripiega sulla media del quartile basso del ruolo.

Misurato prima di adottarlo sul foglio EuroLeghe mantra (12 squadre): R − Z da −0,13 (por) a −0,81 (pc), con
Z 0,1-0,7 sopra la media di tutti i comprati; le 12 rose vere di FA-jo5-zai divise fra miglior undici e
panchina danno lo stesso verso (da −0,02 a −0,60). **Tre letture di R respinte sui loro numeri, nello stesso
pomeriggio**: (1) «la media dei tuoi uomini dello stesso ruolo base», alla lettera: dopo Kane R era Kane, e
dalla 84ª scelta alla fine il primo consiglio era Moumbagna (FVM 2, 2 presenze previste, Priority 170) - la
formula premia chi gioca meno quando R è un titolare; (2) i tuoi uomini fuori dal miglior undici: alla 237ª
Bensebaini in panchina (Ds, 6,43, sopra Z) portava in testa Mendy F. (FVM 2, 2,8 presenze) - il valore di una
riserva che la rosa ha già; (3) le riserve della lega divise per presenze × fantamedia: R = Z al decimo su ogni
ruolo, perché la fantamedia di chi gioca poco ripiega sull'ancora del ruolo. Anche il rimpiazzo del toolkit
(`engine_replacement_fm`) è respinto: è un'altra popolazione e un altro metro, e sugli attaccanti stava SOPRA Z.

Sostituisce il G sulla rosa, lo sguardo di un turno e il doppione (tolti dall'app, restano nella storia di
git); la colonna DP delle «Previste» è lo stesso numero. **Conseguenza da leggere bene**: con Z = un titolare,
a metà draft quasi ogni libero è NEGATIVO (sotto un titolare), e i numeri restano distinti (da −1 a −4 sulla
pagina rigiocata) invece di schiacciarsi a 0. Le conseguenze sull'ORDINE e sulla COPERTURA della rosa non sono
in questo numero: sono il compito degli scenari (richiesta dello stesso giorno).

## 16. La pagina dopo il draft vero (29/09/2026, sera)

Sue richieste dopo FA-jo5-zai: la colonna centrale serviva «solo ad indicare l'ordine di scelta», la tabella
degli svincolati è «fondamentale». Quindi: tre colonne a `1 · 0,55 · 1,6` (la lista da 783px); l'ordine è una
riga per squadra (posto, colore, nome, scelte fatte, FVM; il delta sull'hover resta) e la scelta prevista di
ognuno non sta più lì; sotto, **le ultime dieci scelte**, la più recente in cima. Nella lista l'intestazione
«Prio» si chiama **DP** e la colonna DP doppia delle «Previste» esce (è lo stesso numero). **Chi sparirà prima
del nostro turno** (`auction-plan.takenBeforeOurTurn`: le squadre che chiamano prima di noi in questo giro, o,
quando tocca a noi, quelle fino alla nostra prossima scelta, con la previsione dei rivali del consiglio) porta
una barra e una tinta del colore della squadra prevista, e il tooltip la nomina. Siccome i rivali chiamano per
prezzo, ordinati per DP quegli uomini stanno in basso: un interruttore «N prima di te» accanto al conteggio
mostra solo loro. Sul draft rigiocato, alla n. 100 ne segnava 4 (Doué, Doku, Foden, Cunha; di questi il vero
ha preso Foden), alla n. 84 undici.

## 17. Gli scenari, la freccetta, e il simulatore dei rivali corretto (29/09/2026, notte)

**Gli scenari** (`core/draft-scenarios.ts`, sua richiesta dopo FA-jo5-zai). La DIAGNOSI prende il miglior undici
legale della rosa (il modulo che schiera insieme i nostri migliori) e ne elenca i posti da sistemare: **vuoto**
(nessuno), **debole** (il titolare ha Draft Priority negativa, rende meno di un titolare medio del suo ruolo),
**senza riserva** (nessuno in panchina può prenderlo) - una PRIMA lettura dichiarata di «coperto male», da
tarare con lui sui casi veri. Per i tre posti più urgenti, uno SCENARIO è la catena A → dopo N scelte → A2: A è il
migliore per DP che può stare su quel posto; poi i rivali chiamano fino alla nostra scelta successiva, e quante
scelte siano dipende dall'FVM di A con la regola vera dell'ordine; A2 è il migliore rimasto per il posto più
urgente DOPO A. Un click su uno scenario lo disegna sul campetto (A e A2 al posto dei suggerimenti) e fa segnare
alla lista chi si perde nel frattempo; sul tavolo vero il doppio click su un calciatore costruisce la catena da
lui con un verdetto - **coerente** se entra nel miglior undici su un posto da sistemare, **inopportuna**
altrimenti (sul tavolo inventato il doppio click resta «sceglie la squadra di turno»). Sul draft rigiocato, alla
84ª scelta: porta del Barcellona (65) → 7 scelte, 8° → João Neves; João Neves (96) → 9 scelte, 10° → Barcellona.

**La freccetta**: passando il mouse su un calciatore, nella lista dell'ordine compare dove finirebbe la squadra di
turno se lo prendesse (l'ordine rifatto subito dopo quella scelta, come fa l'host).

**Il simulatore dei rivali aveva un difetto vecchio** (`auction-plan.goneBeforeOurNextTurn` e quindi lo sconto del
«prendi chi sparirà»): l'host pubblica `pickOrder` su TUTTE le squadre, quelle del giro dopo comprese, e il
cammino faceva chiamare tutte quelle dopo di noi nell'ordine vecchio prima di riordinare - l'attesa leggeva
sempre «undici scelte». Ora si cammina scelta per scelta (`nextCaller`, `walkToOurTurn`): a ogni passo chiama chi la
regola mette primo. `simulateRound` e `plan` (il giro mostrato e la proiezione dei suggerimenti) camminano ancora
l'ordine pubblicato e vanno rivisti con la stessa forma: aperto.

**Il filtro sul gradino** legge il gradino della colonna che si ha davanti: la stampa in «Default» e «Medie» (sua
regola del mattino), il motore in «Previste», dove prima filtrava su una parola diversa da quella stampata.

## 18. I piani come pacchetti, Z sui migliori tre, copertura e fertilità (29-30/09/2026, notte)

Una sessione di sue richieste sulla pagina Draft Assistant, dopo il draft vero. `engine_*` fermo, nessuna
`SHEET_REVISION`, il DB non toccato; tutto nell'app.

**Z, il titolare medio, sono i migliori tre del ruolo per partecipante** (`draft-priority.STARTERS_PER_TEAM` = 3,
sua regola: «prendendo le migliori 3 Pc per ogni partecipante, eliminando il 10% dei valori estremi e calcolando la
media delle fantamedie previste»). Prima Z era la media troncata dei migliori `squadre × posti del ruolo nei moduli`:
per i Pc 0,67 posti a modulo, cioè gli OTTO migliori di una lega a 12, Z ≈ 8,4, e Haaland (FM 8,45) leggeva DP 0.
Adesso Haaland 65, Kane 129, Mbappé 73. Due estensioni nostre e dichiarate: i tre per partecipante valgono per
**tutti** i ruoli di movimento (la sua frase nomina i Pc) e le **porte** restano a una per squadra; la troncatura è
10% sopra e 10% sotto, come la media troncata già in uso. R (la riserva) non cambia.

**Gli scenari partono dalla mossa che fa salire di più la rosa**, non dal posto più urgente (prima aprivano sempre
su «P vuoto»). `draft-scenarios.squadWorth` è la somma delle DP dell'undici migliore della rosa; un posto vuoto vale
0 finché le scelte rimaste possono riempirlo, poi costa il suo Z; la panchina non conta. `movesFor` dà il guadagno
di ogni candidato (i 40 migliori per DP più il migliore per ogni posto da sistemare); le prime 6 mosse diventano
catene e le catene si ordinano per il guadagno della rosa sulle DUE scelte — è lì che entra il prezzo, senza pesi
nostri: chi costa poco ci fa chiamare prima al giro dopo.

**Un piano è un pacchetto**: «N) rosa +x (difficoltà) +c% +f» e sotto «A +x — N scelte → A2 +y», coi ruoli in
piccolo. La **difficoltà** è la sua regola: 0 scelte in mezzo = **sicuro**; poi per ogni squadra che chiama in mezzo
si chiede se è interessata al secondo calciatore — nel suo ruolo base non ne ha **nessuno**, ne ha **pochi** (meno
dei posti titolari che i moduli danno al ruolo, `startingPlaces`), o sono **scarsi** (nessuno sopra il titolare
medio) — e solo se le regole le permettono di chiamarlo (`legalFor`: tetto dei primi turni, porte). Nessuna
interessata = **facile**, una = **medio**, due o più = **difficile** (il taglio a due è nostro). La valuta sulla
rosa di ciascuna nel momento in cui chiama, dentro lo stesso cammino dei rivali che decide la catena. Due forme
scritte prima e scartate su sua correzione: il margine di uomini più cari (per prezzo) e il rango del secondo nella
scelta di ogni rivale.

**Copertura e fertilità di ogni posizione del campetto** (`draft-pitch.placeYield`, sua regola: «copertura: una %
che dipende dalle partite previste di chi la occupa; fertilità: uno swing che dipende dai bonus previsti»). Si
sommano IN ORDINE, titolare e poi riserve, e ognuno aggiunge solo le giornate che chi viene prima lascia scoperte:
un titolare al 90% e una riserva all'80% fanno 98%. La fertilità è la stessa somma pesata sui bonus attesi a
presenza (FM − MV, `AuctionAdvice.bonusBy`), in centesimi a giornata come la DP; un bonus ignoto la rende «—».
Contano solo i calciatori veri. Colori: copertura rossa sotto il 50%, ambra fino all'85%, verde da lì (soglie
dichiarate); fertilità verde, rossa se negativa. I totali di un piano (`pitchYield`, stessa funzione del campetto)
sono la copertura in quota dell'undici e la fertilità in centesimi; selezionando un piano le posizioni che riempie
si evidenziano con i loro incrementi, quella del secondo acquisto al 50%. Nessun effetto in hover (sua richiesta).
Un calciatore occupa un posto solo: i suggeriti non ridisegnano chi è già in campo né due volte lo stesso.

**Il resto della pagina**: la DP al posto del valore nel box del campetto, la pill dei ruoli mantra più piccola
(`xxs`), il riquadro «Di turno / Consiglio / Top bloccati» tolto, il pallino nelle ultime scelte tolto, la colonna
centrale più larga (1,06 · 0,75 · 1,5), «da sistemare» che oltre tre posizioni dice «molte posizioni», il tooltip
del nome nella lista tolto, il TREND ordinato sulla media dei fantavoti col 5 al posto dei mancanti
(`player-trend.trendPointsMean`), e la freccetta del prossimo turno che segue la riga SELEZIONATA con un click invece
del mouse.

Verificato: 1246 test dell'app, `e2e-draft` verde su classic e su `--euro` (il banco ora legge il pacchetto e
seleziona un piano), build pulita. La code review ha corretto sei rilievi (interesse di chi non può chiamarlo, «scarsi»
su valori ignoti, il bonus delle porte, il modulo forzato nei totali, un cammino dei rivali di troppo, la fertilità
di un bonus ignoto) e ne ha lasciati due (commenti in italiano nei file che già li mescolano; il click sul nome che
seleziona anche la riga).

## 19. Rivedere un draft scelta per scelta, e le escluse che il tavolo non dichiara più (30/09/2026)

Cinque sue richieste sulla pagina Draft Assistant. `engine_*` fermo, nessuna `SHEET_REVISION`, il DB non toccato;
tutto nell'app.

**AVANTI, INDIETRO, INIZIO, FINE** («premendo indietro il cursore si sposta di una scelta indietro ignorando tutto
quello che succede dopo»). Il cursore vive nel FEED e non nella pagina (`AuctionFeed.cursor`, `rewindState`): ogni
numero del pannello si legge da `state`, quindi troncare a monte è il solo modo in cui nessuno sappia cosa è
successo dopo. `live` resta il tavolo intero, e lo stream e il salvataggio lo scrivono lì. Tre cose che il taglio
delle scelte non basta a dire, e come sono risolte:
- **L'ordine di chiamata di quel momento** l'host non lo pubblica (pubblica solo quello di adesso). Si ricostruisce
  dalla STORIA: l'ordine in cui le squadre richiamano per la prima volta dal cursore in poi È l'ordine del tavolo
  al cursore, perché sotto la regola della piattaforma (`auction-plan.ahead`) una scelta sposta solo chi la fa e
  non riordina gli altri. Legge il futuro solo per recuperare un fatto già fissato al cursore; chi non richiama più
  (rosa piena) va in coda nell'ordine pubblicato. Sul draft vero la regola riproduce 384 scelte su 384 (§15).
- **Lo stato** torna «in corso» e i due nodi dei rilanci (`selectedPlayerId`, `currentBid`) si tolgono.
- **La revisione non sopravvive a un refresh e finisce uscendo dalla pagina**: il feed è condiviso con la plancia,
  e una plancia aperta su un tavolo troncato mostrerebbe un'asta passata senza un controllo che lo dica. Sulla demo
  i tasti non ci sono (lì le scelte si scrivono a mano e l'annulla c'è già), e ogni scrittura a mano chiude una
  revisione.

Verificato con `app/scripts/e2e-draft-review.mjs`: un draft finito di dodici scelte a serpentina servito da un
finto fanta-asta-live, con l'ordine pubblicato di FINE draft; a ogni cursore il contatore, la squadra di turno, le
ultime scelte, gli uomini in rosa e i quattro tasti confrontati col FIXTURE. Controprova: rimesso l'ordine
pubblicato al posto di quello ricostruito, il banco nomina la squadra sbagliata di turno alla scelta 7, 8, 9, 10.
Due difetti del banco lungo la strada, tutt'e due noti: un tooltip che copriva il tasto accanto (ora sotto la
barra), e il passo che dice COSA copre un bottone invece di «coperto».

**COPERTURA E FERTILITÀ TOTALI nell'intestazione del campo**, accanto a «N in rosa»: la stessa `placeYield` delle
posizioni, sommata, sui soli uomini in rosa (i suggeriti sono quello che una scelta aggiungerebbe). La copertura è
una quota dell'undici con i tre colori delle posizioni; un posto con bonus ignoto esce dalla somma della fertilità
ed è contato (`*` e tooltip).

**IL MODULO DI UN RIVALE È IL PIÙ FERTILE** («quando seleziono una squadra di un partecipante che non sia te stesso,
devi selezionare in automatico il modulo migliore (fertilità + alto)»). `fertileModule` disegna il campetto su ogni
modulo e prende quello di fertilità più alta, a parità la copertura, poi l'ordine del regolamento coi consigliati
prima. Il modulo forzato sulla MIA rosa resta com'è (si salva ed è una decisione sulla rosa che costruisco); sulla
rosa di un rivale una scelta a mano vale finché si apre un'altra rosa, non si salva e non tocca la mia.

**LE SQUADRE ESCLUSE, tre difetti, e due li ha trovati il draft vero.**
- **Da `/plancia` il sync non partiva mai.** Aspetta il catalogo dei club, che riempie `ValuationStore.load()`, e la
  plancia il foglio lo legge da sé. Ora lo carica quando è collegata a un tavolo vero.
- **La guardia sul join taceva**: un club della sessione che il catalogo non riconosce lasciava le esclusioni come
  stavano senza dirlo. Ora la finestra del collegamento nomina i club non riconosciuti (`unmatchedClubs`).
- **Il sync CANCELLAVA quelle dichiarate.** FA-jo5-zai letto in sola lettura: 384 scelte e nessuna di Serie A, ma a
  draft finito `settings.inactiveTeams` non c'è più (Firebase toglie anche una lista vuota, quindi l'assenza non
  distingue «nessuna disattivata» da «non la pubblica più»). Il sync leggeva «nessuna esclusa» e azzerava la sua
  Serie A; curato quello, sostituiva le sue 25 con 7 — Cagliari, Monza, Parma, Sassuolo, Torino, Udinese, Venezia,
  che il catalogo EuroLeghe dell'app conosce e il listone della sessione no. **Solo la lista dell'host sostituisce**
  (`mergeTableExclusions`); senza, i club assenti dal listone si AGGIUNGONO e nessuno dei suoi torna dentro.
  Riprodotto in un browser headless sul tavolo vero: 25 → 7 prima, 25 → 25 dopo.

Due regole che restano oltre la pagina. **Un fatto che una sessione FINITA non pubblica più è ignoto, non falso**:
«vuoto = ignoto» applicato a una chiave che l'host toglie a fine partita. E **«assente dal listone» è evidenza su
quel club e su nessun altro**: prenderla come l'elenco intero trasforma un'aggiunta in una sostituzione.

Verificato: 1255 test dell'app, `e2e-draft` e `e2e-draft-review` verdi, build pulita.

## 20. RAR, la rarità (30/09/2026)

Sua osservazione: la Draft Priority è un fatto sull'UOMO (`manValue`) e non vede quanti altri come lui restano
liberi. Il suo esempio: sei partecipanti, sei attaccanti da FM 10, un difensore da 6,5 dove gli altri stanno a 6 o
meno - va preso il difensore, perché un attaccante così al giro dopo c'è ancora, e non vale il contrario.

**Colonna RAR** nella lista degli svincolati, in tutte e tre le viste subito dopo DP (`core/draft-rarity.ts`): il
numero degli ALTRI svincolati dello stesso ruolo base (in classic, del ruolo) di valore pari o superiore su TUTTE
e sei le sue letture - gradino di titolarità (quello che la lista mostra: la stampa, altrimenti il motore),
costanza, MV attesa, bonus attesi a presenza (FM − MV), quota di presenze attese, quota dei tre anni passata
infortunato (qui conta il più BASSO). «Simile» è una dominanza con tolleranza DICHIARATA, uno scalino
dell'unità di ogni lettura: stesso gradino o migliore, costanza −0,05, MV −0,1, bonus −0,1, presenze −0,05
(due giornate su 38), infortuni +0,05 (~55 giorni in tre anni). Una sua lettura mancante non vincola nessuno; a un
candidato a cui manca una lettura che lui ha si dà la MEDIA di quella lettura fra gli svincolati del gruppo (sua
correzione dello stesso giorno: «utilizziamo un dato medio calcolato per il confronto» - la prima stesura lo
escludeva). Una porta si confronta sulla fantamedia della porta (al posto della MV) e sulla quota. Zero in rosso =
l'ultimo del suo tipo; **oltre 10 si stampa in percentuale** (sua regola): «il x% degli altri svincolati del suo
gruppo è pari o migliore». Il conteggio resta nell'attributo della cella e l'ordinamento lo usa; il primo click
sull'intestazione ordina dal più raro.

**SeSw, Season Swing** (suo nome, stesso giorno): la DP di §15-§18 si chiama ora così, e ha una colonna sua PRIMA
di DP. Per ora DP = SeSw (il banco lo asserisce riga per riga); la DP nuova sarà l'unione di SeSw e RAR.

**Letto sul tavolo vuoto**: sui primi 60 per DP il RAR va da 0 a 4 (euro 14 a zero, classic 10). Con sei letture in
AND quasi nessuno in cima è dominato, quindi **la tolleranza di «simile» è la manopola che decide** il numero, ed è
sua (letto prima della media per i dati mancanti: dopo, euro 16 a zero). In coda al gruppo i conteggi arrivano al
58-80%. **La DP NON è cambiata**: come RAR entra nella priorità è aperto. La forma che il suo esempio suggerisce è il
confronto con le scelte che mancano al nostro prossimo turno (se RAR ≥ scelte in mezzo, uno come lui resta), cioè
lo sconto del «prendi chi sparirà» già misurato sul banco del draft (+4,54% strict, `todolist-draft-v1.md`).

## 21. Una DP bassa può essere un INGRESSO sbagliato (30/09/2026)

Sua segnalazione: Gvardiol, «un difensore TOP», leggeva DP −11. La formula non c'entrava: la fantamedia che le
arrivava era l'ancora dei Dc (6,062) perché il motore ignorava la carriera di chi ha una stagione corta. Due regole del
motore, entrambe passate al gate e adottate su euro (gate §7-quattuorsexagies R31, §7-quinsexagies R28): Gvardiol
6,062 → 6,301, DP da −11 a circa +10 (stima fuori dall'app), primo Dc e 9º difensore. Non è top 3 e la ragione è
della DP: davanti restano gli esterni da bonus (Grimaldo, Mittelstadt, Baku), e contro Gabriel Magalhaes pesano ~4
presenze attese in meno. *Prima di ritarare una formula, guarda se i suoi ingressi sono misure o ripieghi*: qui era
un ripiego (`why_fm_steps` = R0c e poi fermo) travestito da previsione.

## 21. Lo sconto di RAR sul banco: il 70% è troppo (30/09/2026)

Sua domanda: «dobbiamo capire se questo 70% è corretto». Politica nuova sul banco del draft
(`toolkit/bench/draft/rarity.mjs`, `node multi.mjs rarity|rarity-rationed EuroLeghe windows-porte.json --declared
--cap=12`, 8 seed × 12 posti × 5 stagioni euro), che legge dall'app `manValue` (SeSw) e `rarity` (RAR) senza
copie. **DP = SeSw − d · min(1, RAR/k) · (SeSw − B)**: k = scelte degli altri prima del nostro prossimo turno (il
resto del giro, più chi l'ordine per FVM mette davanti a noi dopo averlo pagato), B = la SeSw più bassa chiamabile.
Lo sconto va su SeSw − B e non su SeSw perché SeSw ha segno: il prodotto letterale `SeSw × (1 − d s)` alza un uomo
comune sotto zero, ed è misurato peggio (−0,49%, 1/5).

Guadagno sui punti a giornata contro SeSw da sola (la DP di oggi), per stagione:

| d | senza razionamento | con il razionamento dell'app (`needFor`) |
|---|---|---|
| 0,1 | +1,25% (2/5) | +0,66% (3/5, robust) |
| 0,2 | **+0,96% (4/5, robust)** | +0,47% (4/5) |
| 0,3 | +0,77% (3/5, robust) | **+0,71% (4/5, robust)** |
| 0,5 | −0,05% | +0,54% (3/5, robust) |
| **0,7** | **−0,49% (3/5)** | +0,42% (3/5) |
| 1,0 | −0,79% | +0,18% |

**Il 70% è sbagliato**: senza razionamento peggiora, e i buchi a stagione raddoppiano (6,8 → 11,6), perché si
rimandano troppi ruoli «tanto ne resta uno» e alla fine il posto resta vuoto. L'ottimo è interno e basso,
**d ≈ 0,2-0,3**, robusto su entrambe le famiglie, mai strict, +0,5-0,7 punti a giornata. Il gradino
(`RAR ≥ k`) è inerte in d - righe identiche per ogni d - perché scatta solo su chi è già fuori dalla contesa.
Letto a margine: il razionamento dell'app vale di suo 71,9 → 72,9 punti a giornata e dimezza i buchi, cioè più di
RAR; la DP dell'app oggi non lo ha.

Limiti detti: sulle finestre storiche RAR legge 3 letture su 6 (costanza, fantamedia al posto di MV + bonus,
presenze; gradino e infortuni di un agosto passato non ci sono), quindi è più largo che nell'app. In cima alla lista
i RAR sono comunque bassi (0-5 contro k di 10-20), cioè lo sconto morde proprio dove si sceglie. La DP dell'app NON è
cambiata: resta SeSw finché lui non decide d.

## 22. La DP nuova nell'app: SeSw abbassata dalla rarità (30/09/2026)

Suo via libera («ok procedi») sulla proposta di §21. **`draft-priority.priorities`** calcola ora
`DP = B + (1 − 0,25 · min(1, RAR/k)) · (SeSw − B)` (`RARITY_DISCOUNT` = 0,25, `picksBefore` per k,
`priorityParts` per le parti), e lo usano la colonna DP, il consiglio e le scelte simulate (`simulateRound`,
`projectOurPicks`): una definizione sola. Le letture di RAR stanno in `AuctionAdvice.rarityReadings`, lette
anche dalla colonna RAR. Gli **scenari** restano sulla SeSw: misurano il valore di un undici, e la rarità è
una domanda sull'ORDINE delle scelte, non sul valore. k non legge il giro simulato (lo simula con questa stessa
priorità): chi deve ancora chiamare nel giro prende i più cari rimasti, come sul banco.

**Il banco legge ora la funzione dell'app** (`rarity.mjs`, `appDP`, set `rarity-app`, 8 seed), e il verdetto ha
diviso le due metà proposte:

| contro SeSw da sola | media | stagioni | peggiore | verdetto |
|---|---|---|---|---|
| **solo RAR 0,25 (spedita)** | **+1,06%** | 4/5 | −0,12% | **robust** |
| solo razionamento | +2,00% | 3/5 | −3,39% | no |
| RAR + razionamento | +2,33% | 2/5 | −2,95% | no |

La media alta del razionamento viene da **una** stagione (Tm4 +14%, dove la SeSw pura era la peggiore del
tavolo): nelle altre costa fino a 3 punti percentuali. Quindi **il razionamento è scritto e SPENTO** (l'app non
passa `places`): accenderlo è un argomento in `AuctionAdvice.priorityEngine` ed è una sua decisione, coi numeri
qui. Nota: la forma misurata in §21 (il peso sul numero con segno, come fa `bestUnder`) e questa (il peso sulla
distanza dal minimo) non sono lo stesso razionamento: della prima c'è solo la media (71,9 → 72,9), non il verdetto per stagione, quindi non va citata come «passa».

## 23. Il draft CLASSIC (30/09/2026)

Richiesta dell'operatore prima di un draft Serie A classic: «aggiusta il layout e le funzioni che prevedono i
ruoli mantra ed adattiamoli ai ruoli classic». La formula (§2) non dipende dal mantra: servono un ruolo base e i
posti di un modulo, e sul classic il ruolo base **è il ruolo** (P/D/C/A) e i posti sono quelli dei sette moduli di
`classic_modules.json`. Da oggi Draft Priority, SeSw, RAR, piani e DP sul campetto valgono su tutt'e due i giochi
(`AuctionAdvice.priorityOn`: un draft con un regolamento di moduli; sul mantra serve ancora la matrice).

Cosa cambia sul classic, e perché.

| Pezzo | Mantra | Classic |
|---|---|---|
| Ruoli di un uomo | i codici mantra del listone | il macro-ruolo della zona (`AuctionFeed.gameRoles`) |
| Chi la lega compra (base di Z e R) | i migliori `squadre × movimento` di tutto il pool | `squadre × quota` di OGNI linea (8/8/6): letto sul pool intero gli attaccanti, che rendono di più, scalzerebbero i difensori che la lega deve comunque comprare |
| Z, il titolare medio | i migliori 3 per partecipante (sua frase sulla Pc, 29/09) | i migliori `squadre × posti` del ruolo: un modulo classic dà posti interi (4 D, 4 C, 2 A), e «3 a testa» leggerebbe il quarto difensore come una riserva — **estensione nostra, dichiarata** |
| Chi si può chiamare | tetto dei portieri | tetto dei portieri **e quote per linea** (`PlanTeam.limits`, `roleFull`) |

**Tre difetti del classic trovati facendolo** (tutti invisibili sul mantra):
- il portiere del foglio classic è `P` e non `por`, quindi `predictRivalPick` non contava i portieri di nessuno e
  poteva prevedere il quarto;
- nessuna previsione conosceva le quote: un nono difensore era una scelta prevista che il banditore rifiuta;
- sul tavolo live il listone porta i codici mantra su ogni riga qualunque sia il gioco: la lista li disegnava su un
  draft classic e il filtro P/D/C/A non trovava i difensori.

Sulla lista, chi ha la linea PIENA nella mia rosa resta in lista sbiadito con la pastiglia «pieno» (la stessa
guardia della scelta, `fullForMe`), e sul classic la colonna del ruolo è stretta a una lettera.

**Non misurato, ed è detto**: il banco del draft ha giudicato la DP sul mantra EuroLeghe; sul classic è la formula
applicata al gioco nuovo, e il consiglio di prima (`pickForUs` con la scala graduata, +0,77% robust sulle dieci
finestre Serie A) non è più quello che la pagina usa. Il banco oggi **non può** fare il confronto: `legalPoolFor`
non applica le quote 8/8/6 (il classic del §17 è stato giocato senza), e con le quote le finestre non bastano -
`serie-a.json` porta 15-24 portieri prezzati per stagione contro i 30 che dieci squadre da tre ne comprano, perché
`extract.py` tiene solo chi il motore prezza. Servono finestre col pool largo (le stime `est_*`) e le quote come
opzione di `legalPoolFor`; fino ad allora sul mantra non cambia niente per costruzione (niente `limits`, il
portiere era già `por`), e sul classic la scelta di usare la DP è dell'operatore. **Misurato la sera stessa: §24,
la DP perde −19,9% sul classic ed è spenta lì.**

Cosa resta, in ordine: [todolist-draft-classic-v1.md](todolist-draft-classic-v1.md).

## 24. Il verdetto del banco sul classic, e quello che ha trovato sul mantra (30/09/2026, sera)

**Pre-registrato** in [todolist-draft-classic-v1.md](todolist-draft-classic-v1.md) item 2.4 prima della corsa:
`node multi.mjs classic Leghe leghe-classic-wide.json --quotas`, dieci stagioni Serie A, 8 semi, tutte le sedie,
contro il consiglio di prima (`pickForUs` = valore × quote graduate × sopravvivenza). Tre cose sono servite prima,
e ognuna ha il suo controllo:
- **le quote 8/8/6 come regola del banco** (`legalPoolFor` legge `setup.quotas`, opt-in `--quotas`): i numeri
  pubblicati del classic (§17 di metrica-asta-surplus-v1.md) si riproducono **identici riga per riga** senza il flag;
- **il pool largo** (`extract.py --wide`): ogni quotato entra, chi il motore non prezza con la stima del gradino
  `shrunk`/`anchor` di `engine/estimate.py` e la sua confidenza calibrata, chi il motore prezza ma poi non ha
  giocato con il suo ZERO (il pool stretto era un filtro di sopravvivenza: tutti i suoi uomini erano scesi in
  campo). Portieri 30-46 per stagione contro i 30 che servono, attaccanti 70-89 contro 60; il file conta gli
  stimati per ruolo;
- **il baseline giusto**, e qui c'era un difetto del BANCO: `adoptedCover` chiamava `coverNeedOf` senza il gioco e
  `needForUs` senza la squadra, e sul classic quella funzione senza squadra risponde un peso uniforme - cioè la riga
  «il pannello» misurava un draft SENZA razionamento (−4,93%, il numero del classic scordato del §17). Corretto,
  riproduce la scala graduata **al decimale** (+0,77%, 6/10, robust). L'app non aveva il difetto: `pickForUs` la
  squadra la passa.

**Il verdetto** (guadagno sui punti a giornata contro il consiglio di prima, 74,0 punti a giornata):

| Politica | media | stagioni | copertura | spesa FVM |
|---|---|---|---|---|
| consiglio di prima | — | — | 98,7% | 291 |
| **DP spedita** (RAR 0,25, Z sui posti) | **−19,9%** | 0/10 | 84,7% | 205 |
| sconto di RAR 0 · 0,1 · 0,2 · 0,3 · 0,5 | −20,9 · −21,0 · −20,7 · −20,4 · −21,0% | 0/10 | 84% | 204 |
| Z = 3 per partecipante | −18,7% | 0/10 | 85,5% | 212 |
| col razionamento (posti) | −20,4% | 0/10 | 84,5% | 214 |

Contro il tavolo il consiglio di prima vince **10/10 (+2,7%)** e la DP perde 0/10 (−18,6%). Lo stesso segno sul pool
stretto senza quote (−19,3%), quindi non sono gli stimati. Il meccanismo si vede sulla rosa: la DP compra uomini da
fantamedia alta e presenze basse (su T1, 10 stimati su 25 contro 1) e undici posti restano scoperti una giornata su
sei, perché V = [P(Fm−Z)+(N−P)(R−Z)]/N mette sulle giornate che salta una riserva R che il classic, con 25 posti
contati per linea, non ha: **una formula per uomo non può esprimere un vincolo sulla rosa** (la stessa lezione della
Strategia e del valore di una soglia). **Quindi sul classic la DP è SPENTA** (`AuctionAdvice.priorityOn` chiede di
nuovo il mantra), come la regola pre-registrata diceva: il consiglio, le scelte simulate, la colonna e i piani tornano
a `pickForUs`; la SeSw resta a schermo come LETTURA (`priorityReadable`), perché è un fatto sull'uomo e non una scelta.
La colonna si chiama «Prio» dove non è la DP.

**E il confronto che mancava, sul mantra.** Dal 29/09 (§15) la DP dell'app è la formula ridichiarata, e da allora è
stata misurata contro la SeSw (§22) ma **mai contro il consiglio di prima**. Fatto ora (EuroLeghe, `--declared
--cap=12`, 4 semi, tutte le sedie): **DP app −1,59%, 2 finestre su 5, Tm4 −10,5%**, 5,3 buchi a stagione contro 0,6;
la priorità «completa» del banco (G sulla rosa, sguardo di un turno, ritirata dall'app il 29/09) **+1,59%, 4/5,
robust**. Sul mantra la DP perde di poco e la formula è sua: la decisione resta dell'operatore (§1, «potrei voler
adottare comunque la formula»), ed è l'aperto numero uno della todolist.

## 25. Due draft classic veri, e l'ordine a SERPENTONE (30/09/2026, sera)

L'operatore ha dato due draft classic conclusi: **FA-yei-458** (10 squadre, 250 scelte) e **FA-l1n-0pn** (8 squadre,
200 scelte; scritto FA-11n-0pn, che non esiste). Letti in sola lettura (`probe`/dump REST, nessun peer). Confermano
quello che la pagina classic assumeva - `game` 1, quote 3/8/8/6 **imposte** (18 rose su 18 esatte), prezzo = FVM
classic su 450 scelte su 450, codici mantra su ogni riga - e ne smentiscono una: **l'ordine di chiamata ha due
regole**, dichiarate in `state.pickOrderType`:

| Sessione | `pickOrderType` | L'app prima | L'app ora |
|---|---|---|---|
| FA-l1n-0pn (classic) | `default` | 200/200 | 200/200 |
| **FA-yei-458** (classic) | **`pingpong`** | **82/250** | **250/250** |
| FA-jo5-zai (mantra) | `default` | 384/384 | 384/384 |

(chiamate indovinate rigiocando ogni scelta con la `nextCaller` dell'app). Il `pingpong` è un serpentone puro: il
primo giro, rovesciato a ogni giro, e **il prezzo non sposta nessuno** - quindi su quel tavolo tutto ciò che la
pagina deduce dall'FVM delle rose (chi sceglie prima del mio turno, lo sconto di chi sparirà, la freccetta, k di
RAR) era sbagliato. Ora `auction-plan.ahead` prende il tipo (`PickOrderType`), il feed lo legge
(`AuctionFeed.orderType`) e ricava il primo giro dalla cronologia (`firstRoundOrder`, perché il `pickOrder`
pubblicato è il giro in corso), e l'advice lo passa a ogni simulazione; un valore sconosciuto è `default`.

**Il verdetto del §24 rimisurato col serpentone** (banco con `--pingpong`, stesso set, stessi file e semi): la DP
spedita **−19,7%, 0/10**, ogni variante fra −18,7% e −20,0%: regge su tutt'e due le regole. Quello che cambia è il
margine del consiglio di prima sul tavolo: **+0,6% (7/10)** contro +2,7% (10/10) con l'ordine per FVM - dove spendere
poco fa scegliere prima, il serpentone quel vantaggio non lo paga. Da misurare, se il suo draft è a serpentone: quanto
vale lì lo sconto «prendi chi sparirà», tarato con l'altro ordine.

## 26. La pagina collegata ai due draft classic veri (30/09/2026, notte)

Item 1.2 della todolist classic. `app/scripts/e2e-draft-classic.mjs` rigioca un draft classic concluso sulla
`/auction` del build, servito da un finto fanta-asta-live: il dump della sessione (`env.playerList` + `state`, letti
in sola lettura) sta FUORI dal repository e si passa con `--session`. La pagina si cammina coi suoi tasti di revisione
e si ferma a ogni turno della squadra seguita (25 per draft), e a ogni fermata confronta col TAVOLO VERO: chi è di
turno e l'ordine delle squadre, le rose, il campetto (titolari + riserve + senza posto = rosa), nessun preso fra gli
svincolati, «pieno» acceso esattamente sui nostri reparti pieni, e le previsioni «prima di te» lette subito dopo la
nostra scelta (nessuna per noi, nessun rivale oltre una quota contando rosa + previsti, e sul serpentone esattamente
tante chiamate per squadra quante ne ha fatte davvero). Più il filtro D una volta e la console.

**Tre difetti della pagina, tutti invisibili senza un tavolo vero, tutti curati:**

| Difetto | Sintomo sul tavolo | Causa | Cura |
|---|---|---|---|
| La squadra seguita si perdeva al ri-aggancio | nessuna previsione, nessun «pieno», nessun «tu» | `restore` la impostava e `connect` senza fotografia salvata partiva da `disconnect`, che la azzerava; poi `remember` scriveva `teamId: null` | `connect(code, preserve, follow)`; un test la pretende (senza la cura cade lui solo) |
| Rivali previsti oltre la quota | 29 previsioni su FA-yei-458 di un 7° attaccante su 6 (una scelta che l'host rifiuta) | le quote si contano sugli slot del FOGLIO, e chi il motore non prezza aveva slot vuoto e non contava | sul classic lo slot mancante è la ZONA del listone (`AuctionAdvice.slotFor`), che è la linea su cui l'host applica la quota; sul mantra invariato |
| Previsioni oltre la fine del draft | all'ultimo giro due squadre del serpentone previste a 2 scelte con 1 posto | `takenBeforeUs` camminava senza `rounds` | `rounds: priorityRounds()`, come gli scenari |

Il primo esisteva su ogni browser con il codice salvato e nessuna fotografia (la prima apertura dopo un `forget` della
fotografia, uno storage pieno): la pagina tornava a non seguire nessuno e lo restava, senza dirlo. Nessun banco lo
vedeva perché `e2e-draft` gioca la demo (che imposta la squadra da sé) e `e2e-draft-review` non guardava il «tu».

**Dopo le cure**: FA-yei-458 (serpentone) e FA-l1n-0pn (`default`) **nessun problema** su 25 turni ciascuno;
`e2e-draft`, `e2e-draft-review` e 1280 test unitari verdi.

**Quello che il banco MISURA e non asserisce, e non è buono:** delle previsioni «prima di te» escono davvero

| Sessione | Previste uscite | Dalla squadra prevista | Null: gli stessi N più cari per FVM classic |
|---|---|---|---|
| FA-yei-458 | 26,6% | 4,6% | **30,7%** |
| FA-l1n-0pn | 15,5% | 1,7% | 15,5% |

cioè sul classic il modello dei rivali **non batte «prendono i più cari»**, e quasi mai indovina chi. Su FA-l1n-0pn
sotto `default` il numero di chiamate per squadra prima del nostro turno è sbagliato in 3 finestre su 25 (lì è una
previsione: l'ordine del giro dopo dipende dai prezzi delle scelte non ancora fatte). Due draft sono pochi per un
verdetto, e il null non conosce le quote né chi chiama: è la direzione, non la taglia. Resta aperto (todolist
classic, item 1.3).

## 27. I rivali VERI, scelta per scelta, e tre decisioni dell'operatore (30/09/2026, notte)

**Le decisioni** (sue, stessa sera): sul classic i moduli di riferimento sono **3-4-3 e 4-3-3**
(`draft-pitch.RECOMMENDED_CLASSIC`, letti da `recommendedModules(mantra)`: stella nel selettore, pareggi e rosa vuota
disegnati su di loro); la **Z del classic** è dichiarata per reparto e per partecipante, **P 2 · D 4 · C 4 · A 3**
(`draft-priority.CLASSIC_STARTERS_PER_TEAM`, via `LeagueSize.startersPerLine`, che vince su `startersFromPlaces`; R
non cambia) - sostituisce i posti del modulo, che erano un'estensione nostra, e il portiere passa da una porta a due
per squadra; sul **mantra la DP resta** nonostante il −1,59% del §24 («dovremo rivedere delle dinamiche»).

**Il rigioco dei rivali veri** (`toolkit/bench/draft/real-rivals.mjs SESSIONE... [--phases]`, item 1.3). Il banco del
draft non può giudicare come prevediamo i rivali, perché il suo tavolo è DICHIARATO da noi: qui i rivali sono le
squadre di tre draft conclusi, e prima di ogni loro scelta ogni predittore vede il tavolo com'era. Esatto = ha nominato
proprio l'uomo preso:

| Draft | Scelte | Il più caro (legale) | App | App senza coda | App con le teste | Rango mediano del vero nel «più caro» |
|---|---|---|---|---|---|---|
| FA-yei-458 classic, serpentone | 250 | 6,0% | 4,4% | 5,2% | 4,8% | 17 |
| FA-l1n-0pn classic, **a reparti** (`--phases`) | 200 | 15,0% | 9,5% | 15,0% | 9,5% | 6 |
| FA-jo5-zai mantra, `default` | 384 | 2,1% | 2,3% | 3,1% | 2,3% | 59 |

Tre cose, in ordine di peso.
- **Nessun predittore nomina la scelta di un rivale vero**: 2-6% dove il reparto è libero, 15% quando lo fissa la fase.
  Le teste lette dalle scelte (`classifyRivals`, l'82,8% misurato sul banco) non aggiungono niente sui rivali veri: sul
  banco indovinavano teste che avevamo scritto noi. Il valore e il surplus predicono PEGGIO del prezzo (rango mediano
  42 e 41 contro 17 sul serpentone): chi sceglie al tavolo guarda il listone, non il nostro foglio.
- **La regola di coda peggiora su tutti e tre i draft**: senza, l'app indovina 55 scelte su 834 contro 39. È la regola
  che fa comprare surplus per credito agli ultimi due di un giro, nata sul tavolo dichiarato del banco. Sul serpentone
  la sua premessa è falsa per costruzione (il prezzo non sposta nessuno). **Non è stata tolta**: il banco la usa per i
  rivali simulati, e lo sconto «prendi chi sparirà» (+4,54% strict) è misurato con quelle previsioni, quindi toglierla
  va rimisurato lì con un tavolo che non la applica. Decisione aperta (todolist classic, item 1.4).
- **FA-l1n-0pn è stato giocato A REPARTI**: scelte 1-24 portieri, 25-88 difensori, 89-152 centrocampisti, 153-200
  attaccanti, e la sessione non lo scrive in nessun campo (`settings`, `options.draft` identici a un draft libero). La
  pagina non lo sa: in quella fase prevede attaccanti ai rivali e consiglia fuori reparto. Se il suo draft è a reparti,
  serve una dichiarazione (item 1.5).

Il pool di FA-jo5-zai è ristretto ai club da cui è stato scelto almeno un uomo: la sessione conclusa non pubblica più
`inactiveTeams`, e senza quel filtro il «più caro» era un uomo di un campionato escluso (rango mediano 123).

## 28. La regola di coda dei rivali: tolta (30/09/2026, notte)

Item 1.4. Criterio scritto prima della corsa: il candidato («previsione dei rivali senza coda») si adotta se sul banco
non peggiora lo sconto «prendi chi sparirà» spedito - punti a giornata appaiati, nessuna finestra sotto −2% - perché sui
rivali veri era già meglio (§27: 55 scelte vere su 834 contro 39). Set `tail` / `tail-classic` di `multi.mjs`, 8 semi,
tutte le sedie:

| Banco | Senza coda contro la spedita | Finestre | Peggiore |
|---|---|---|---|
| EuroLeghe mantra | **+2,56%** | 5/5, strict | +0,87% |
| Serie A classic, quote, `default` | +0,07% | 5/10 | −1,20% |
| Serie A classic, quote, serpentone | **+1,08%** | 9/10, robust | −0,37% |

Adottata: `RivalWalkInput.tail` è spenta salvo `true` (che resta per il banco). Sulla pagina le previsioni «prima di
te» salgono a 29,8% (FA-yei-458) e 16,7% (FA-l1n-0pn) di uscite vere, alla pari col null «i più cari».

**Il guasto dello strumento, trovato perché due righe erano identiche.** La prima corsa leggeva «con coda» e «senza
coda» uguali al decimale su 25 finestre: i giocatori del banco non portano `net`, la regola di coda li prezzava tutti a
zero e ricadeva sulla previsione normale. Quindi **la riga «APP: sopravvivenza dal pannello», che doveva provare che il
codice spedito riproduce la misura dell'adozione, la riproduceva perché la coda era inerte** - e lo sconto (+4,54%) era
stato adottato su una previsione senza coda (`survival`, `tail: false`) mentre l'app ne spediva una con. Curato dando
alla camminata `net = surplus`, come fa l'app. Con la coda davvero accesa la spedita perdeva il 2,5% sul mantra.

## 29. La DP accesa ovunque, la Pa nuova dentro, e lo zero per PREZZO (01/10/2026)

Quattro richieste dell'operatore nella stessa sessione, tutte DICHIARATE e nessuna giudicata dal banco del draft.

**La colonna Pa e la Pa nella DP.** `toolkit/scripts/presence_test/now.py` calcola la formula scomposta
(`partite-attese-scomposte-v1.md`, la lettura di settembre adottata: M1b + M4 + M7c + M7f, le giornate viste col K
del motore, lo stop aperto) per la stagione in corso, con l'asta a oggi e il prior tarato su tutte le finestre di
luglio: 599 quotati di Serie A, `presence_now.json` nel pacchetto. La funzione e' una sola (`build.september_pa_of`,
letta dal banco e da `now.py`). In draft e' la colonna dopo SeSw, su stagione piena. **SeSw e RAR leggono la sua
quota dove c'e' e quella del motore altrove** (`AuctionAdvice.draftShareBy`), su euro compreso: sua scelta col prezzo
detto - su EuroLeghe un uomo di Serie A e uno straniero sono valutati da due modelli, e a settembre la formula prevede
piu' del motore. La formula non e' passata al gate (R33) ed e' misurata solo sulla Serie A.

**La DP accesa sempre** («sia su Mantra che su Classic che su altro»), contro il verdetto del §24 (−19,9% sul classic):
`priorityOn` = `priorityReadable`. Il primo giro del banco con la DP sul classic ha trovato un difetto suo: a difesa e
attacco pieni la cima della lista restava fatta di uomini che la rosa non puo' piu' chiamare (col consiglio di prima
valevano zero e scendevano da soli), e il draft simulato si fermava a 133 scelte su 225. I «pieno» ora vanno in
fondo alla lista, visibili e smorzati.

**Lo zero della SeSw.** Con Z = media dei migliori tre attaccanti per partecipante (6,95 su Serie A) **24 dei 30
«titolari medi» avevano una SeSw negativa** (Esposito F.P., Davis, Scamacca, Simeone, Dybala): lo zero era un titolare
sopra la mediana che non salta una partita. I suoi riferimenti: A Pinamonti, C Lobotka/Perrone/Cristante, D
Marcandalli/Obert, P Okoye/Falcone; poi «un percentile unico per ruolo» e «R intorno ai 10 FVM». Misurato prima di
scriverlo, dentro ogni ruolo del listone Serie A: la Fm media degli uomini al **75° percentile di FVM** (banda 70-80)
legge P 4,92 · D 6,03 · C 6,30 · A 6,69 contro i suoi 4,91 · 5,96 · 6,30 · 6,61; nessuna regola sulla fantamedia (R, la
mediana o un percentile dei regolari) prendeva tutti e quattro. R = la Fm media dei 15 uomini del ruolo col FVM piu'
vicino a 10: 4,89 · 5,95 · 6,14 · 6,44, tenuto ≤ Z (sui portieri usciva 4,94). `draft-priority.priceZero`,
`ZERO_FVM_PERCENTILE`, `RESERVE_FVM`. Effetto sugli attaccanti: Esposito +24, Scamacca +22, Davis +19, Simeone +12,
Dybala +10, Pinamonti −11, Lucca −42 (centesimi a giornata). Un percentile di PREZZO vale identico su un listone le cui
fantamedie stanno su un'altra scala.

**Aperti**: nessuna delle quattro e' misurata sul banco del draft (Pa nuova solo Serie A; Z per prezzo; DP sul classic
gia' bocciata nella forma di prima): la prossima corsa del banco va fatta con tutte e tre insieme.

## 30. +Rosa, la copertura ridichiarata, i titolari per fertilità, le giornate della competizione, RAR su +Rosa (01/10/2026)

Una sessione di sue richieste sulla pagina Draft Assistant, in vista del **draft Serie A del 6 ottobre**. Niente nel
motore: `engine_*` fermo, nessuna `SHEET_REVISION`, nessuna di queste cose misurata sul banco del draft.

**La copertura di un posto, ridichiarata** («ogni calciatore in una certa posizione contribuisce in % alla copertura ...
38/38 × 0.8 = 80% ... 20 partite 42% ... entrambi 122% → 100%»): somma di quota × 0,8 (`COVER_AVAILABILITY`,
dichiarata) tagliata a 100%, dove la quota sono le partite attese della colonna Pa sulle giornate della competizione che
restano. Prima era una somma «sulle giornate che il precedente lascia scoperte» senza lo 0,8. La fertilità pesa ogni
bonus sulla parte di copertura che l'uomo porta davvero, nell'ordine (il taglio morde l'ultimo, non il titolare).
Prezzo detto: con lo 0,8 un titolare da solo non arriva al verde (85%) del campetto.

**Chi è titolare e dove vanno le riserve** («scegli come titolari quelli che danno un maggior contributo in fertilità e
poi distribuisci le riserve per copertura»): `draft-pitch.starterWeight` = bonus a partita × copertura che darebbe da
solo, con un pavimento (`STARTER_FLOOR`) perché `bestEleven` riempia prima tutti i posti che può; chi ha un bonus
ignoto viene dopo chi lo ha noto, chi non ha valore non è titolare. **Il portiere fa eccezione**: il suo «bonus» è il
malus dei gol subiti, quindi la regola alla lettera farebbe titolare chi gioca meno, e fra portieri parte chi copre di
più. Le riserve (e i suggerimenti) vanno dove aggiungono più copertura, su ogni gioco; il totale in fantapunti
dell'intestazione resta il valore dei titolari.

**+Rosa, la colonna** (dopo RAR, nelle tre viste): quanto uno svincolato aggiunge alla MIA rosa, copertura in % dell'intera
rosa (gli 11 posti) con un decimale e un carattere più piccolo, fertilità in centesimi a giornata. Il campetto si
disegna una volta, sul modulo forzato o su quello che i miei uomini schierano meglio (non sul piano selezionato, che la
farebbe muovere a ogni click), e ogni uomo si aggiunge a una copia (`addedYield`, la stessa funzione degli incrementi dei
piani). Ordina per fertilità e solo a parità di centesimi per copertura. Malen a rosa vuota: 13,8/18 × 0,8 = 61% di
un posto = +5,6% della rosa (la stampa per posto è durata un'ora, poi «all'intera rosa»).

**Le giornate della competizione** («ho impostato "giornate" 5-22 ... Pa e similari rimodulati su 18»):
`AuctionAdvice.competitionRounds` = `to − from + 1` dalle opzioni globali, tagliato sul calendario del foglio. La Pa, la
Pv delle «previste» e le partite della card del draft si contano lì; **supera, per questa pagina, la regola del 22/09
«tutto su base 38»** (Strategia e Plancia restano su 38: da decidere). Le quote non cambiano, quindi copertura, SeSw e
DP non si muovono.

**RAR su +Rosa** («il fattore RAR adesso valutalo su +ROSA»): dove seguo una squadra RAR confronta SOLO +Rosa (fertilità
e copertura, tolleranze dichiarate 0,05 punti e 0,05 di posto, `ROSA_TOLERANCE`) dentro il ruolo base; senza squadra
restano le sei letture. Il tooltip nomina fino a tre SIMILI, non i migliori («solo 3 simili (non superiori)»): fra i
contati, quelli entro la tolleranza anche dall'altro lato, i più vicini prima (`Rarity.similar`); se sono tutti
migliori, dice quanti. Due conseguenze dette: nei turni
SIMULATI dei piani RAR tiene +Rosa della rosa di adesso; e dove la rosa ha già coperto quasi tutto, molti uomini
aggiungono ~0 e RAR sale per tutti (sul banco «meno rari 99%»), cioè lo sconto della DP morde di più.

**Aperti**: (1) la copertura non legge la finestra della competizione per gli infortuni (chi è fuori fino alla 10ª in
una competizione 3-5 conta come se giocasse); (2) Strategia e Plancia su 18 o su 38; (3) i totali dei piani restano in %
dell'undici a numero intero; (4) nessuna di queste regole è misurata sul banco del draft, e RAR su +Rosa cambia la DP
che il banco aveva giudicato (+1,06% con le sei letture).

## 31. Il rimpiazzo di un portiere un gol sotto lo zero, e AUTO che gioca i nostri consigli (01/10/2026, sera)

Due sue richieste sul draft di test, tutte e due DICHIARATE e nessuna misurata sul banco.

**«Perché mi consigli Provedel o Milinkovic-Savic? Sono secondi portieri»**. La causa era nella formula: sul
portiere `priceZero` tiene R = Z (la FM di un portiere quasi non varia col prezzo: 4,94 a FVM 10, 4,92 al 75°
percentile), quindi il termine delle assenze si annullava e la DP diventava `quota × (Fm − Z)`. Sul foglio Serie A
classic (Z 4,923): Milinkovic-Savic +0,12 (18,8 Pa, FM 5,13) e Provedel +0,10 (12,2 Pa, FM 5,20, riserva all'Inter)
davanti a Palmisani +0,08, Falcone +0,04 e a Okoye, De Gea, Muric a zero o sotto. Negli scenari il guadagno sulla
rosa era 0 per tutti (un altro portiere non entra nel miglior undici), quindi decideva lo spareggio sulla DP, cioè
proprio quel termine. Cura: `draft-priority.KEEPER_RESERVE_GAP` = 1, **R del portiere = Z − 1** (un punto è un gol
subito, l'unità del malus del portiere), su ogni gioco e quindi anche per le porte del mantra. Ordine che ne esce:
Svilar, Carnesecchi, Maignan, Caprile, Butez, Vicario, Falcone, Palmisani; Provedel ~ −0,5. Test dedicato in
`draft-priority.spec.ts`. Non verificato sul suo tavolo live: se gli scenari propongono ancora un portiere con
guadagno 0, il nodo è lo spareggio dentro `movesFor` e va guardato lì.

**AUTO con i nostri consigli** («le scelte degli altri vengano fatte calcolando i consigli anche per le altre squadre
e scegliendo uno dei tre consigli a caso»): `AuctionAdvice.scenariosFor(teamId)` calcola i tre scenari spostando
`mineId` su quella squadra (stesse regole, stessa camminata dei rivali), e AUTO prende il primo calciatore di uno dei
tre estratto a caso; dove non ci sono scenari, il previsto della colonna centrale; se manca anche quello, AUTO si
ferma con un avviso. Prezzo detto: la colonna centrale continua a prevedere i rivali col modello vecchio
(prezzo/surplus/valore), quindi con AUTO quello che si vede previsto e quello che succede divergono; e una scelta
costa sei catene. Build e 1318 test verdi; non provato in un browser.

## 32. La copertura combinata, i piani sul campo e la porta valutata a parte (01-02/10/2026)

Una sessione lunga sul Draft Assistant, tutta guidata da sue domande e da simulazioni di draft interi sulla pagina vera.
Commit `a265270`, `186a72c`, `5a0caec` e quello di questa chiusura; niente pushato né pubblicato. Nessun numero del
motore si muove (`engine_*` fermo, nessuna `SHEET_REVISION`).

**La copertura di un posto non è una somma** («è corretto sommare le singole % di copertura?»). Due uomini di club
diversi mancano in modo indipendente, quindi la copertura è `1 − ∏(1 − quota)`: 80% e 42% fanno 88,4% e non 122% → 100%
(`draft-pitch.combinedCover`). Si sommano, col tetto al 100%, **solo due portieri dello stesso club** (una maglia; sua
correzione: «non è vero che uomini dello stesso club si contendono una maglia sola se non sono portieri»). Il margine
di sicurezza è passato per quattro forme in un'ora (×0,8 fisso, nessuno, ×0,9 sopra il 90%, poi questa): **sopra l'80%
uno sconto lineare fino al 10% al 100%** (`COVER_MARGIN_FROM` / `COVER_MARGIN_MAX`), monotono. Misurato sul banco delle
partite attese (5 settembre, 7 stagioni, 1.848 uomini): vere/previste 0,88-0,90 sopra il 70% di quota prevista,
1,03-1,08 sotto il 50% — lo 0,8 fisso era pessimista di ~10 punti sui titolari e 20-25 sulle riserve.

**+Rosa, campo e piani leggono una regola sola** (`withSuggestions` + `placeYield`). Un uomo migliore del titolare
(`starterWeight`) parte lui e il titolare scende a prima riserva, col contributo ripesato sulle giornate che restano
scoperte (sua regola). Il posto è quello dove aggiunge più fertilità (copertura per portieri e bonus ignoti), i vuoti
per primi. Sul campo il suggerito migliore sta in cima al 30% e il mio sotto, come prima riserva.

**La fertilità contiene i modificatori di lega** (`swing.draftFertility`): costanza × 2/11 una volta per modificatore
(R-Factor per tutti, mod. difesa per difensori e portieri: doppia con tutti e due, sua regola) e porta inviolata per il
portiere se la lega la paga.

**I piani sono ordinati sulla fertilità della rosa con le riserve**, copertura a parità (`draft-scenarios.SquadPitch`);
la diagnosi usa l'undici del campo e chiama «scoperto» un posto sotto `COVER_OK` = 0,85 (la soglia ambra/verde, ora una
costante sola). Il draft legge le **dritte** e il **gradino della stampa**, quest'ultimo solo se letto da 7 giorni o meno
(`PRESS_FRESH_DAYS`, in `PlayerRulings.all`: vale in tutta l'app); prima non leggeva né l'una né l'altro.

**La porta, cinque giri di simulazione** (`scripts/sim-draft-advice.mjs`, `?autoMe`: la mia squadra gioca il primo
piano, i rivali uno dei loro tre a caso; 2 o 10 draft per giro):
1. *Ordinata sulla fertilità*, la porta non veniva mai presa prima del 23° turno: la fertilità di un portiere è il
   malus dei gol subiti, sempre negativa. Porta al 37-38%.
2. *Calendario e abbinamenti* (le giornate della finestra una per una, ogni settimana gioca chi ha la partita più
   facile, `keeperYield`): decidono QUALE portiere, non QUANDO. Ancora tutti al 23°-25° (Svilar libero fino al 23°).
3. *Fertilità relativa al titolare medio* (sua: «scegliere quello forte significa subire meno malus»): i portieri
   forti escono a metà draft, porta 87-100%.
4. *Prezzo della porta scoperta* (`DOOR_HOLE_COST` = 4,73, il costo di un buco del banco d'asta) e *sconto per chi
   sopravvive* alla mia prossima scelta (`SURVIVOR_DISCOUNT` 0,7 sul guadagno quando si ordina, `rankGain`): il vice
   diventa conveniente. Ma senza sconto i rivali prendevano il portiere al PRIMO giro: un posto vuoto costava 4,73
   anche con 24 scelte davanti. Curato con `doorHolePrice` = 4,73 × posti portiere liberi / scelte rimaste (stesso
   prezzo prima e dopo una mossa) e con lo sconto anche per i rivali simulati.
5. *Sua taratura del comportamento* («il primo prima di completare gli undici; il secondo quando tra gli svincolati
   restano solo riserve; il terzo quasi sempre l'ultima chiamata»): abbinamenti e calendario SPENTI (`KEEPER_WEEKS`,
   una riga per riaccenderli), zero sul numero di stagione (`keeperZero`), e un non titolare del suo club si prende
   solo come vice di un portiere in rosa o alle ultime chiamate (`keeperAllowed`; il caso Sanchez Ro.).

Esito del giro 5 su 10 draft: primo titolare entro l'11ª scelta 7/10 (quasi sempre al 3°-5°), secondo portiere al 24°
in 8/10 con un solo titolare di movimento preso dopo, terzo all'ultima chiamata 9/10 e quasi sempre il vice del
proprio, porta 99-100%.

**Contro rivali «umani»** (`?rivals=human`, `--rivals human`: per FVM, per squadra del cuore, a istinto fra gli 8 più
cari, o coi consigli; 10 draft): la mia rosa è in media la migliore ma di poco — valore dell'undici 56,8 contro
54,2-55,1 (+3-4%), mediana 3° posto su 10 (fra 1° e 5°); fertilità +25% (il criterio dei consigli stesso, quindi non una
prova); buchi pari (0,50 contro 0,55). FVM, tifoso e istinto finiscono quasi pari fra loro. Contro chi prende per FVM il
secondo portiere arriva al 12°-15° in 6 draft su 10: i titolari spariscono presto e il piano anticipa.

**Limite detto**: valore e fertilità della simulazione sono le nostre stesse previsioni, quindi favoriscono chi segue i
consigli. La verifica vera è un draft rigiocato su una stagione finita contro presenze e voti reali.

**Aperti**:
- il secondo portiere contro rivali che prendono per FVM: anticipare è giusto o va trattenuto (sua regola)?
- abbinamenti e calendario dei portieri: riaccenderli quando lo zero è tarato (`KEEPER_WEEKS`);
- il prezzo dei buchi solo per la porta: sui posti di movimento la copertura resta senza prezzo;
- il primo portiere al 3°-5° nelle simulazioni dipende da quando i rivali simulati fanno la corsa, non è tarato su un
  tavolo vero;
- un draft rigiocato su una stagione finita come giudice dei consigli;
- «AUTO fermo: nessuna scelta per questa squadra» compare dopo la 250ª scelta: innocuo, da togliere;
- `e2e-draft` non rilanciato dopo le ultime modifiche ai portieri.

## 33. Quanto lontano guarda un piano: catena a 4 sull'ordine per FVM (02/10/2026)

Sua domanda, per il draft Serie A classic del 6 ottobre (ordine per FVM di rosa crescente): «dovrebbe aver maggiore
peso il fatto che un calciatore con un FVM alto ti può far andare indietro nella prossima scelta?». Il costo della
posizione era già nei piani (la catena A → A2 ricalcola l'attesa dall'FVM di A con la regola vera), ma a DUE scelte.
Misurato sul banco (`toolkit/bench/draft/chains.mjs`): dieci squadre classic, quote 8/8/6, dieci stagioni Serie A
(`leghe-classic-wide.json`), 8 semi, le tre teste ruotate sulle stesse tre sedie, sette rivali `MIXED`; la catena a N
prende un candidato, fa chiamare i rivali (testa prezzo) con l'ordine vero, poi prende il migliore per valore ×
copertura a ognuno dei suoi N−1 turni dopo, e vale la somma.

| catena | punti/giornata | vs tavolo | FVM speso | FVM prime 5 | posto nel 6º giro |
|---|---|---|---|---|---|
| 2 | 72,20 | +0,5% | 258 | 96 | 2,2 |
| 3 | 72,93 | +1,5% | 266 | 99 | 2,9 |
| 4 | **73,43** | **+2,2%** | 271 | 101 | 3,2 |

3 vs 2 +1,04% (8/10, robust) · 4 vs 2 +1,76% (8/10, robust) · 4 vs 3 +0,71% (7/10, robust). Seconda corsa 4/5/6:
5 vs 4 +0,22% (6/10), 6 vs 4 +0,43% (8/10), sotto il pavimento dello 0,5%: **4 è il ginocchio**.

**La risposta alla sua domanda è no**: la catena lunga NON si tiene davanti, spende di più e scivola più indietro.
Vince perché vede quando scivolare conviene; la catena a 2 vede solo il turno dopo e sopravvaluta la posizione persa.
Un peso in più sull'FVM andrebbe nella direzione sbagliata.

Con la testa della squadWorth del 29/09 (`--head=priority`) l'ordine è 3 > 2 (+0,92%, 4/10) e 4 ≈ 2, ma quella testa
perde ~8% contro il tavolo sul classic (§24), quindi non decide.

**Nell'app**: `draft-scenarios.CHAIN_TURNS` = 4. Il piano resta a due scelte a schermo (A → A2, attesa, difficoltà,
«spariti prima della prossima» invariati), le scelte dopo stanno in `Scenario.later` e l'ordine dei piani legge
`horizon`; il piano scrive «poi +X» col dettaglio nel tooltip, perché un ordine che i numeri a schermo non spiegano
è un difetto. Detto: il banco ha misurato la LUNGHEZZA su valore × copertura, l'app ordina sulla fertilità del campo;
`e2e-draft` verde, il draft completo passa da ~125 a ~133 s. Il banco era già instabile su HEAD (1 problema su 2
corse, ogni volta diverso), quindi un rosso isolato lì non è di questa modifica.

## 34. Un draft contro dieci teste «umane», e quando si prendono i portieri (02-03/10/2026)

Sua richiesta: «simulare un'asta a 10 dove gli altri partecipanti utilizzano scelte con ragionamenti vari ma senza
usare i consigli del motore, e a che giro vengono presi i portieri». `sim-draft-advice.mjs --rivals people --runs 6`
sulla `/auction` del build: classic Serie A, 3/8/8/6, ordine per FVM, noi sul primo piano consigliato (catena a 4,
§33); i nove rivali estraggono una testa fra **fvm** (il più caro), **tifoso** (il più caro del suo club se fra i primi
15), **istinto** (uno a caso fra gli 8 più cari) e **reparti** (il più caro del reparto più vuoto, portieri in fondo).
`?rivals=people` è nuovo; `?rivals=human` tiene anche la testa «consigli».

| | posto medio | resa rosa | 1º portiere | 2º | 3º |
|---|---|---|---|---|---|
| noi | **1,0 (6/6)** | 690 | giro 3,8 | 16,2 | 25 |
| reparti | 5,6 | 536 | 23,0 | 24,0 | 25 |
| fvm | 5,9 | 524 | 8,2 | 14,8 | 20,0 |
| tifoso | 6,1 | 518 | 10,8 | 15,6 | 21,6 |
| istinto | 6,3 | 524 | 9,2 | 16,4 | 22,6 |

(«resa rosa» = la fertilità del campetto sommata sui posti; copertura ~95% per tutti.) I nostri portieri: un
titolare forte al 2º-5º giro (Svilar, Mandas, Carnesecchi), il secondo a metà draft (Palmisani al ~15º, 5 volte su 6),
il terzo all'ultima chiamata. Le teste a prezzo ne accumulano due o tre presto (4/5/8), «reparti» li prende agli
ultimi tre giri.

**Detto prima del numero**: le rose sono giudicate con le NOSTRE previsioni, quindi +28% sul secondo è un tetto e non
una stima (la stessa riserva del §32); il giudice sui punti veri resta il banco sulle stagioni passate, dove il
vantaggio è di qualche punto percentuale. E le teste simulate sono semplici: nessuna legge presenze o fantamedia.

## 35. Chi sparisce prima del nostro turno, come scelgono le PERSONE (03/10/2026)

Richiesta dell'operatore, in tre passi: «verifica sull'asta FA-yei-458 la previsione delle scelte dei partecipanti», poi
«cerchiamo di avvicinarci alla logica delle persone usando l'FVM per il peso della scelta e il paradigma
fertilità/copertura», poi «ci serve un 80% almeno nei primi giri... non contiamo chi prende cosa ma che indoviniamo i
giocatori scelti prima del prossimo nostro turno». Scelta sua: una **probabilità per nome**, con i «sicuri» marcati.

**Lo stato di partenza, rigiocato sulla pagina vera** (FA-yei-458, tutte e 10 le squadre seguite a turno, 250 scelte, tetto
dei primi turni spento perché quel draft non l'aveva): dei nomi previsti «prima di te» esce davvero il **32,2%** contro il
**31,6%** del null «i più cari»; presi dalla squadra indicata il 5,9%. Le scelte dei rivali e i consigli del motore non si
somigliano: la scelta vera è il primo consiglio nel 7,2% dei casi, uno dei tre nel 14,4%, fra i primi 10 della lista nel
26,4% (fra i primi 10 per FVM nel 36,4%); rango mediano 32 nella nostra lista e 17 per prezzo. Atteso, e il punto
dell'operatore: le persone non hanno la logica del motore.

**Il modello**: un logit condizionale della scelta UMANA sugli uomini che la sua rosa può legalmente prendere, con quello
che il tavolo vede - FVM, posto nel reparto per FVM e distacco dal successivo, i numeri della stagione in corso del listone
della sessione (fantamedia, voto, presenze), stesso club di uno già preso, secondo portiere dello stesso club - e il
cammino fino al nostro turno CAMPIONATO 150 volte: la quota di cammini in cui un uomo è preso è la sua probabilità.
Dati: sette draft veri scaricati in sola lettura (FA-yei-458, FL-7zz-d10, FL-ixr-b6b classic; FA-blt-km4, FA-7xu-106 mantra
Serie A; FA-cdt-9q9, FA-lel-dfk mantra EuroLeghe), più FA-jo5-zai e FA-l1n-0pn (questo giocato a reparti, escluso). Le due
sessioni locali (FL-) non hanno listone: si usa quello di FA-yei-458, gli id coincidono 500 su 500.

**La lezione più utile: un tavolo nuovo non è il tavolo su cui si è tarato.** Allenato su FA-yei-458 stesso (lasciando
fuori la squadra prevista) leggeva 56,7% nei primi sei giri contro 53,7% del null - sembrava un passo verso l'80%. Allenato
sugli ALTRI draft e provato su uno che non ha visto, che è la situazione del 6 ottobre:

| Draft provato | Giri 1-6 modello / più cari | Tutto modello / più cari | Dato ≥0,8: uscito davvero |
|---|---|---|---|
| FA-yei-458 | 52,2% / 53,7% | **40,3%** / 32,3% | 90,0% (60 nomi) |
| FL-7zz-d10 | 43,9% / 44,9% | **38,3%** / 26,7% | 100% (41) |
| FL-ixr-b6b | 39,9% / 38,1% | **27,7%** / 19,0% | 86,7% (15) |

(tanti nomi quante le scelte vere nella finestra). **Nei primi giri nessuna lettura batte l'ordine per FVM**, quindi lì il
modello è il SOLO prezzo con la sua temperatura (`EARLY_PICKS` = 6 turni della squadra che chiama); dal settimo il modello
pieno vale 8-11 punti sul null su tutti e tre. L'80% con «tanti nomi quante le scelte» non c'è: nei giri 3-6 anche il
DOPPIO dei più cari contiene solo il 61-70% delle scelte vere, e un quinto sta oltre il triplo - sono scelte di pancia
sull'avvio di stagione (Moreira 9,67 di fantamedia, 60ª FVM libera; Kvernadze, Adzic, Maldini, Carlos Augusto). Dove l'80%
c'è è sui **sicuri**: da 0,8 in su, 87-100% fuori campione (a 0,7 era 77-92%, non stabile), al prezzo di pochi nomi a turno.

Cosa NON ha aiutato, misurato: la copertura dei reparti della rosa del RIVALE (quanti ne ha, quanti gliene mancano) - da
sola peggiora, insieme agli altri non aggiunge: le persone rispettano le quote e basta; l'età, la quotazione, la forza del
club; imparare il tavolo mentre il draft procede (rifit ogni 10 scelte pesando di più il tavolo in corso): nessun guadagno.
Una sorpresa: lo stesso club di uno già preso è PREFERITO (+0,28), le persone non diversificano, e il secondo portiere
dello stesso club ancora di più (+1,77).

**Nell'app** (`core/rival-odds.ts`, `AuctionAdvice.goneOdds`): una pastiglia con la percentuale accanto al nome da 0,3 in
su (`SHOWN_ODDS`, scelta di presentazione), marcata da 0,8 (`SURE_ODDS`, misurata). Solo REPORTING: non tocca la
camminata deterministica (`takenBeforeUs`), su cui piani e sconto del sopravvissuto sono misurati, né alcun consiglio. Il
listone del feed porta ora i numeri della stagione che il tavolo mostra (`AuctionPlayer.seen`); su un tavolo costruito dal
pacchetto mancano, e il modello ricade su FVM e reparto.

**Il codice spedito rigiocato** (`toolkit/bench/draft/rival-odds.mjs`, con le probabilità lette PRIMA della nostra scelta
e la nostra scelta tolta dal conteggio; pesi tarati anche su questi draft, quindi è una verifica e non un fuori campione):
FA-yei-458 sicuri 90,8% su 65 nomi (0,27 a turno), FL-7zz-d10 100% su 22, FL-ixr-b6b 1 su 1; la taratura regge (0,4 →
52%, 0,5 → 59-65%, 0,9 → 96-100%). Sui tavoli a ordine per FVM i sicuri sono rari perché l'ordine del giro dopo è esso
stesso una previsione. Sulla pagina vera rigiocata, FA-yei-458: nessun problema, pastiglie presenti.

**Aperti**: pochi tavoli (cinque per tarare), e del 6 ottobre non sappiamo l'ordine; i numeri della stagione nel listone
sono quelli del giorno della sessione; su mantra il modello usa la linea classic del listone.

## 36. Il quarto piano dal selezionato, la catena intera, i consigli piegabili, i codici FL- (03/10/2026)

Quattro richieste dell'operatore sulla pagina del draft. Il codice e' in `6886513`, committato da un'altra sessione insieme
alla pubblicazione v0.1.35 e dichiarato tale nel messaggio. Nessun numero del motore si muove.

- **Il quarto consiglio parte dal calciatore SELEZIONATO** («quando seleziono un calciatore della tabella, mostrami un quarto
  consiglio a partire dal calciatore selezionato»). Un click su una riga aggiunge in coda ai tre un piano costruito dalla
  stessa catena (`judge` → `chainFrom`), col suo verdetto «coerente / inopportuna» e la ragione nel tooltip; un secondo
  click lo toglie, e se era il piano disegnato sul campetto se ne va con lui. Non compare se il calciatore apre gia' uno
  dei tre (il piano e' a schermo) o se ora non lo si puo' chiamare (congelato dal tetto, reparto pieno): una catena che
  comincia con una scelta impossibile non e' un piano. Il doppio click sul tavolo vero continua a mettere il suo piano in
  cima. `auction.selectedChain`.
- **La catena intera, 4 scelte** («nei consigli, puoi farmi vedere tutta la catena prevista di 4 scelte?»): le scelte 3 e 4
  su una riga sotto, ognuna con quante scelte fanno i rivali prima. Quell'attesa e' nuova (`ScenarioStep.wait`, contata
  sul cammino dei rivali come quella fra la prima e la seconda); il «poi +N» resta la loro somma.
- **Il box dei consigli si piega**: resta la riga del modulo coi posti da sistemare, i piani spariscono; il piano scelto
  resta disegnato. Preferenza del browser (`fantassistant.draft.plansFolded`).
- **I codici FL-xxx-xxx delle aste locali** sono accettati, e il prefisso resta nella chiave (`auction-feed.sessionKey`).
  Al momento della modifica era un'IPOTESI che stessero nello stesso database; la §35 l'ha poi verificata scaricando
  FL-7zz-d10 e FL-ixr-b6b in sola lettura: ci sono, **senza listone**. Quindi `connect`, che legge prima
  `env/playerList` e si ferma se e' vuoto, su un'asta FL- risponde «nessuna asta trovata»: aperto, sotto.

**Una sua domanda che vale riportare** (perche' Svilar e non De Bruyne, DP 26 contro 37): i piani non ordinano per DP ma
per +Rosa, e li' Svilar valeva +81 contro +60 - la porta vuota costa `doorHolePrice` a giornata e lui la chiude quasi
tutta, De Bruyne e' `ballottaggio`. E le righe evidenziate della tabella sono i previsti presi da un rivale prima del
nostro turno, nel colore della squadra.

Verificato: banco `e2e-draft` con due passi nuovi (5e quarto piano: 3 → 4 → 3; 5f pieghevole: 3 → 0 → 3, catene 3), build e
`ng test` verdi. Un giro del banco ha letto una volta «piu' titolari suggeriti che posti vuoti» nel passo dei
suggerimenti, che queste modifiche non toccano, e al giro dopo no: probabilmente il caso di AUTO, **non verificato**.

**Aperti**: collegarsi a un'asta FL- vera fallisce perche' non porta il listone - va letta col listone di una sessione FA-
o del pacchetto, da decidere; il quarto piano non ha un test unitario (solo il banco).

## 37. La vista «Checks»: otto condizioni si'/no, lette da quando e' arrivato (04/10/2026)

Richiesta dell'operatore: una quarta vista della tabella degli svincolati (oltre a Default · Medie · Previste) con un
segno per ogni condizione vera, una colonna ciascuna. Arrivate in tre messaggi; nessun numero del motore si muove,
nessun `SHEET_REVISION`. Codice: `core/draft-checks.ts` (puro, con i test), la vista in `views/auction/`.

| colonna | icona | condizione |
|---|---|---|
| tit | team | gradino della STAMPA `titolare` o `bandiera` (il gradino del motore non conta) |
| mv | star | media voto della stagione scorsa >= 6 |
| fm | trophy | fantamedia della stagione scorsa (vera o sintetica) nel terzo migliore del ruolo |
| bonus | fire | quota di partite con bonus-malus >= 0 (fantavoto non sotto il voto), per tutti i ruoli |
| cont | safety | Costanza (quota di voti base >= 6) nel terzo migliore del ruolo |
| m | clock | minuti a presenza della stagione scorsa nel terzo migliore del ruolo |
| p | calendar | QUOTA di presenze sulle giornate del suo club da quando e' arrivato, terzo migliore del ruolo |
| trend | rise | media voto delle ultime 5 partite del club, 5 se non giocata o sv (`trendVoteMean`, la stessa della Strategia) |

Scelte mie, dichiarate e non misurate: «buono» = **terzo migliore del ruolo classic** (`GOOD_QUANTILE` 2/3, piu' o meno
gli uomini che una lega da dieci schiera); la soglia si taglia sul **listone intero**, presi compresi, cosi' non scende
mentre il pool si svuota; **sotto 10 partite** (`THIN_SAMPLE`) niente segno sulle letture di stagione e niente peso nella
soglia (vale anche per mv, che lui aveva chiesto alla lettera); le soglie di p e trend si tagliano su chi ha almeno una
presenza o un voto, e una quota a zero non prende mai il segno anche se la soglia cade a zero.

**«LA VALUTAZIONE VA FATTA SOLO DA QUANDO E' STATO ACQUISTATO»** (sua correzione su Malen, arrivato a gennaio dall'Aston
Villa, senza il segno di p e m). Le letture di stagione leggono ora l'ULTIMO PERIODO (`lastStint`): le partite di
campionato della competizione e del club con cui ha chiuso la stagione, dalla prima in cui e' a referto; chi non ha mai
cambiato si tiene la stagione intera, giornate saltate all'inizio comprese. Per questo p e' una QUOTA e non un
conteggio. Dopo: Malen ha tutti e otto i segni (m 82' su soglia 66', p 100% su 93%, fm 9,00 su 6,77).
**Il club si confronta SOLO fra partite giocate**: una riga di panchina scrive il club come il provider (`AC Milan`), una
giocata come i voti (`Milan`), e confrontarle tagliava a pezzi stagioni normali - misurato, i segni di mv, fm e bonus
calavano di un terzo. Settima istanza del join per nome, trovata perche' i conteggi del banco si sono mossi su colonne
che la modifica non doveva toccare.

Il pallino con l'icona e' sua richiesta («occupano troppo spazio»): 1,1rem a colonna, nome e regola nel tooltip.

Verificato: 1348 test unitari, build pulita, banco `e2e-draft` con quattro passi nuovi (checks: 60 righe, segni tit 46 ·
mv 13 · fm 8 · bonus 15 · cont 24 · m 22 · p 20 · trend 42, colonne centrate; Malen; portieri; ordinamento).

**Il bonus dei portieri e' «>= 0» e non «> 0»** (sua decisione, stesso giorno, coi numeri davanti): a «> 0» sulle 24
porte di Serie A 2025-26 con 10+ partite la quota media e' il **2%**, la soglia il 3%, la migliore l'11% (rigore parato o
assist senza gol subiti), cioe' non separa; a «>= 0» (in pratica porta inviolata senza malus) va dal 12% al 48%. Poi, subito dopo, **«vale per tutti»**: la colonna non conta piu' le partite con almeno un bonus ma quelle senza un
malus netto (niente ammonizione, autogol, rigore sbagliato non compensati), per ogni ruolo - per un attaccante e' quasi
«non si fa ammonire» (Malen 94% contro una soglia del 97%).

**Aperti**: cont e trend non sono ristretti
al periodo nel club; p e' generosa per chi giocava all'estero, dove il livello per-partita porta solo le partite in cui
era convocato.

## 38. Il draft vero FA-610-2ih e quello che ha cambiato (05/10/2026)

Un draft classic Serie A seguito dal vivo dall'operatore (10 squadre, 250 scelte, ordine `default` per FVM di rosa),
con la «stessa identica dinamica» del suo del 6 ottobre. Tutto app (`core/draft-pitch.ts`, `core/draft-scenarios.ts`,
`core/auction-advice.ts`, `views/auction/`), nessun numero del motore. v0.1.37 -> v0.1.44.

**38.1 La porta vuota conta UNA porta.** `doorHolePrice` contava i 3 posti portiere aperti: a 21 scelte dalla fine
3/21 x 4,73 = 0,68 a giornata, e il +Rosa di un portiere era quasi tutto buco coperto (Palmisani +51 di cui +59,
Falcone +40, contro +30/+38 dei migliori difensori). Ora `min(1, aperti)`. Banco `sim-draft-advice` 4+4 contro
rivali umani: primo portiere alla scelta 4-7 invece che alla 2, porta coperta 96-100% in tutti.

**38.2 Lezioni del tavolo** (surplus del NOSTRO motore, quindi un giudizio del modello e non l'esito):
- l'ordine per FVM si blocca dal giro 2 e costa poco: Edge Case ultima per 24 giri ha fatto la rosa migliore
  (undici atteso 57,7 contro 50-55), aperta da Malen (surplus 69 contro 37 del secondo);
- muro al giro 8: il migliore libero per ruolo P 30 · D 19 · C 21->15 · A 35->26, poi tutto quasi piatto
  (C 14-15 fino al giro 20, D in calo fino al 13);
- dopo il 7o giro una scelta vale in media A 18 · P 13 · C 9 · D 8,5, e gli attaccanti tardivi (Adams A., Yeboah,
  Castro S., Noslin, Santos A.) valgono 22-26 - ma un 4o-6o attaccante sta in panchina, quindi il surplus li
  sopravvaluta e la lezione NON e' stata portata nei consigli;
- portieri con calma: 5 presi al giro 4, Caprile (30) uscito alla 104.

**38.3 ROLE_WAIT (accesa per sua decisione, giudizio diviso).** Lo sconto di chi sopravvive al nostro turno ora vale
anche quando sopravvive un uomo DELLO STESSO RUOLO che da' quanto lui, mai oltre il 30% di prima
(`rankGain`, `ScenarioStep.waitAlt`). 6+6 draft simulati contro rivali umani: motore +1,25 contro +0,24 punti a
giornata sul tavolo (t ~1,7), FVM totale della rosa +3 contro +36 (sd 90-110), anche con gli infortuni importanti
deprezzati (+1 contro +33): **i due giudici sono discordi e dentro il rumore**. Accesa con un'icona su ogni piano che
la regola sposta (`Scenario.roleWait`: su o giu', e chi resta del suo ruolo). Rigiocando l'host, dalla 30 alla 61 i
consigli puntano spesso sul centrocampo: il contrario della lezione «centrocampo per ultimo».

**38.4 Una rosa si giudica due volte** (sua regola): punteggio del motore E FVM totale della rosa, affiancati. Il
giudice FVM porta una rifinitura: un infortunio importante (fuori 30+ giorni, o aperto 45+ giorni senza data, o
«heavy» nella pagina indisponibili) vale FVM/0,6 x la quota di stagione in cui sara' disponibile (rientro +25%), mai
sopra il suo FVM. Lo strumento e' in scratch (`simscore.py`), non nel repository.

**38.5 Il campo.**
- **Bonus prima, ma il campetto mostra il valore**: `bonusFirst` (dove gli uomini di una posizione arrivano insieme a
  `COVER_OK`, nel RENDIMENTO entra prima il bonus piu' alto: C x b2 + c1 x (b1 - b2)) resta nel calcolo di +Rosa e
  consigli; il DISEGNO invece mette titolari e riserve in ordine del numero del badge (DP nel draft, 0-99 altrove),
  porta compresa (`draftPitchOf(..., shown)`), sua regola: «in campo devono andare quelli con il valore mostrato piu'
  alto». Trovato su Ramon (DP 8) dietro Jimenez A. (-2) per 2 centesimi di bonus.
- **La porta al portiere che rende**: prima il titolare era chi copre di piu' (Palmisani 0,94 su Vicario 0,82).
- **Il portiere legge i gol subiti del club**: `keeperFmBy` = voto base atteso - gol subiti attesi a partita del suo
  club sulle partite reali delle giornate della competizione (-ln P di porta inviolata, `clubGoalsAgainst`). Juve
  1,11 contro Frosinone 1,75: Vicario DP -1 -> +22, Palmisani +2 -> -26. Entra in DP, fertilita' (anche settimana per
  settimana), +Rosa, consigli e «a partita»; NON nello 0-99 ne' nelle previsioni dei rivali (che scelgono per FVM).
  Non passa dal gate. Il motore lo sottovalutava per un promosso (fantamedia della B) e lo sopravvaluta poco altrove
  (Caprile 5,15 -> 4,77: la formula non vede parate e rigori parati).
- **Meno di 4 difensori: niente modificatore** (`DraftPlace.defenceOff`, `FantaMan.defenceBonus`): host 4-3-3 67,3 ->
  3-4-3 66,1 a partita.
- **«a partita»** = sum(posti) 6 x copertura + fertilita' + copertura della porta x malus del portiere medio
  (`keeperFertilityZero`): sua formula «fertilita'/100 + 66» con due correzioni (giornate scoperte a zero, e la porta
  letta contro il portiere medio). Edge Case 70,4 · lucariello 68,0 · host 66,6. E «FVM rosa» al posto di «11/11».

**38.6 La lista.** Esclusi dai consigli (icona per riga, per sessione, i rivali possono ancora prenderli: `movesFor`
salta gli esclusi solo per noi); selezione per il confronto (cerchietto o Ctrl+click, «solo i selezionati»); X sulle
soluzioni aggiuntive; «nascondi pieni»; «mostra gia' scelti» (`takenRanked`, stesse colonne); colonne SeSw/Pa/DP/RAR
nascondibili; tooltip (1s) sulla Titolarita' coi rivali del posto nella board di stagione (`placeRivals`); i ceduti
del listone (`gone: true`, 64 su 600) fuori dagli svincolati.

**Aperti**: ROLE_WAIT va rimisurata su piu' draft e coi due giudici; `keeperFmBy` va misurata sugli esiti (May); lo
0-99 dei portieri non legge ancora i gol subiti; nel campo interno ai consigli i titolari restano scelti sul
rendimento e non sul valore mostrato (sulla porta ora coincidono).

## 39. Zaccagni, Saelemaekers e lo scroll: R29, i subentrati, e un blocco di mezzo secondo (05/10/2026)

Dallo stesso draft FA-610-2ih (Serie A classic), sei domande dell'operatore. v0.1.44 -> v0.1.47.

**39.1 Il badge del campetto e' la DP in centesimi di punto a giornata** sopra il titolare medio del ruolo (Z per
prezzo, 75o percentile di FVM: C 6,29, A 6,73) con la riserva (R, FVM ~10: C 6,15, A 6,48) nelle giornate saltate.
Zaccagni -7 (FMa 6,26 < 6,29), Kvernadze -11 (6,65 < 6,73), Dovbyk -1/-4 (6,88 ma ~0,55 delle giornate): tornano.

**39.2 Le due domande dell'operatore, gia' misurate** (risposta senza codice): piu' stagioni invece dell'ultima e'
respinta tre volte su `default` (R18/R18b/R18c, gate §7-septvicies: segnale vero, ripartizione non identificata);
piu' peso alle partite di quest'anno no (R25K40 e' l'ottimo interno, R28 perde su default). La leva vera era **R29**
(la fortuna della stagione scorsa), STRICT su Serie A dal 27/09 e ferma sulla sua decisione: **ADOTTATA su
`default`** (`ADOPTED`, `SHEET_REVISION` 83, gate §7-tresexagies bis). `--verify` 22/22 e immobile. Zaccagni 6,26 ->
**6,42** (3 gol su 4,1 xG, 0 assist su 2,7 xA), Kean +0,56, Martinez L. -0,33; 240 righe di 293 si muovono. Kvernadze
e Dovbyk no: non hanno una stagione di Serie A, il foglio li prezza col ripiego `est_*`.

**39.3 Chi entra dalla panchina perde bonus** (`core/sub-bonus.ts`, solo nella fantamedia della DP come
`keeperFmBy`, non gatato). Sua obiezione: «Atta e' stato uno dei migliori centrocampisti della scorsa stagione e
Saelemaekers non e' un titolare». Con R29 Saelemaekers (sfortunato) +10 e Atta (fortunato: 5 gol su 4,0 xG) +5, e il
gradino di stampa vale 0,722 contro 0,78 in giornate col voto perche' anche il subentrato prende il voto. Il buco: chi
entra prende lo stesso voto con meno bonus (A -0,439 · C -0,129 · D -0,050 a partita, rosa-3-giornate-v1.md §2) e la
fantamedia viene da partite giocate col ruolo di ALLORA. Spostamento = -costo x (quota da subentrato ora - quota della
stagione di input); ora = 1 - `start_pct` della stampa / `desc_titolarita_play` (tutt'e due da sano); allora dalle
partenze in campionato di `external_match_stats` (5+ presenze). Portieri fermi; un numero mancante non sposta niente.
Saelemaekers ~+10 -> ~+5, Atta fermo. La stampa entra solo via `rulings.all()` (accesa e fresca, e una dritta
dell'operatore la scavalca: code review). Le partenze si caricano PRIMA dei numeri: caricate dopo, la lista si
riordinava sotto il puntatore e il doppio click prendeva un altro uomo (e2e-draft).

**39.4 Lo scroll che si incaglia**: ogni pezzo da 60 righe bloccava 465-785 ms. Profilo CPU sulla pagina vera: due
`nz-icon` per riga che a ogni nascita fanno un `detectChanges`, e `rivalsTip` legato come metodo che camminava tutte le
board per ogni riga a ogni change detection. SVG in linea e `rivalsTips` calcolato una volta: 60-75 ms. Una lista che
cresce scorrendo non deve avere nz-icon per riga ne' metodi costosi nei binding.

**39.5 Campetto**: l'FVM subito dopo il nome.

**Aperti**: R29 si rigiudica su T3 a stagione chiusa; il costo dei subentrati e' una misura per partita applicata come
media e non e' giudicato su un esito (lettura dell'app); `e2e-draft` resta rosso su due avvisi preesistenti (filtro
«fino al N°» con «nothing to click», e «piu' titolari suggeriti che posti vuoti»/incrementi dei piani, a seconda
dell'estrazione della demo); i commit locali non pushati su origin (fermo a v0.1.36).

## 40. I consigli vari, i preferiti, e la prima fase dei rivali rifittata (05/10/2026)

**Varietà nei tre piani** (sua richiesta: «o mi consigli ruoli diversi o difficoltà diversa»). `draft-scenarios.pickVaried`:
un piano entra fra i tre solo se, contro OGNUNO di quelli già presi, cambia il ruolo del primo acquisto o la difficoltà; il
primo resta il migliore. Se nei primi 6 piani la varietà non c'è se ne calcolano fino a 12 (`VARIETY_CHAINED`); se non basta,
si riempie con l'ordine normale. Il piano promosso porta un'icona (⑂) con quanti piani migliori ha saltato. Il `roleWait`
si misura ora sul posto in classifica e non su quello a schermo, così uno spostamento per varietà non si legge come uno
della regola d'attesa.

**Esclusi barrati, preferiti con allarme.** La stella marca un preferito (per sessione, come gli esclusi); se la probabilità
che sia preso prima del nostro turno arriva al **5%** (`FAVOURITE_AT_RISK`, soglia sua) il box dei consigli porta una riga
gialla, fuori dalla piega, che lo nomina; un click lo seleziona e costruisce il quarto piano da lui.

**Nei consigli niente uomini probabilmente già andati** (sua regola: «>50%»). `ScenarioInput.likelyGone`, da `goneOdds` >
`ADVICE_GONE_ODDS` 0,5. Le odds finiscono alla NOSTRA prossima chiamata, quindi l'effetto dipende dall'orologio: se non
tocca a noi non possono APRIRE un piano; se tocca a noi non possono essere la SECONDA scelta, mentre prenderli adesso è
proprio «prendi chi sparirà». I rivali simulati (AUTO) non la leggono.

**La prima fase dei rivali, rifittata.** La sua osservazione: «prendere come prima scelta il top del mercato è quasi sempre
la scelta presa dai partecipanti». Il modello del §35 leggeva le prime sei chiamate di una squadra con il solo prezzo,
exp(2,71 · log FVM), che alla prima chiamata dava a Malen il 26%. Sette draft recuperati dal server dell'host (lettura
anonima, salvati in `data/raw/draft-sessions/`, fuori da git: FA-610-2ih, FA-7xu-106, FA-blt-km4, FA-cdt-9q9, FA-lel-dfk,
FL-7zz-d10, FL-ixr-b6b; FA-yei-458, FA-jo5-zai e FA-l1n-0pn sul server non ci sono più). Banco:
`toolkit/bench/draft/rival-early-fit.mjs`, logit condizionale, L2 0,02, un tavolo fuori per volta.
- **Adottato**: log FVM, rango per FVM fra gli uomini che quella squadra può chiamare, le stesse due voci sulla PRIMA
  chiamata della squadra, e i numeri della stagione (fm − 6, fm mancante, presenze). Tutte RELATIVE al listone del
  momento (un logit condizionale ignora la scala dell'FVM; il rango dipende solo dall'ordine), quindi un listone nuovo non
  chiede una nuova taratura — è la richiesta («deve adattarsi anche in futuro»). Log-verosimiglianza fuori campione per
  scelta: −4,149 (solo prezzo, rifittato) → **−4,125**; nomi indovinati nei primi sei turni 17,8 → 18,3 · 32,2 → 33,5 ·
  46,9 → 50,2% sui tre tavoli Serie A (dentro il campione); «sicuri» su FA-blt-km4 87,5 → 81,8% (resta sopra l'80%).
- **Il dato smentisce a metà la frase**: Malen e Martinez sono andati alle prime due chiamate in 3 draft Serie A su 5;
  in FA-blt-km4 Martinez è uscito alla 7ª, in FL-7zz-d10 alla 9ª-10ª (draft che si apre con Baturina, probabilmente con
  una regola sua). Il modello nuovo dà «i due più cari già presi dopo 4 chiamate» al **72%** in Serie A (prima 52%)
  contro 3 su 5 veri, e al 48% sull'europeo (prima 16%) contro 1 su 2.
- Contaminazione dichiarata: le due sessioni FL- non portano un listone e sono lette su quello di FA-7xu-106, cioè con i
  numeri della stagione di un altro giorno.

## 41. I tre piani ruotano gli uomini, e ogni reparto vuole il suo top (06/10/2026)

Due correzioni dell'operatore sui consigli, a schermo sul draft Serie A classic. Solo app (`core/draft-scenarios.ts`),
`engine_*` e fogli fermi; il banco del draft non legge questi piani, quindi nessun suo numero si muove.

**Rotazione** («non mostrarmi Conceicao in tutti i 3 consigli, lo stesso valga per Martinez Jo. o Ramon»).
`rotateShown`: il primo piano resta com'è; il secondo e il terzo si ricostruiscono (`chainFrom(..., avoid)`) tenendo
fuori dalle scelte DOPO la prima gli uomini già nominati sopra, se esiste un uomo dello stesso slot entro
`ROTATE_SHARE` = 0,15 del guadagno del migliore (`rotated`); altrimenti il nome si ripete. La prima scelta di un piano
non si tocca (è il motivo per cui il piano è stato scelto); rango, varietà e segni della regola d'attesa restano quelli
decisi; i totali dei piani ruotati si ricalcolano e possono scendere. Soglia DICHIARATA: decide cosa ripete lo schermo,
non cosa vale di più.

**Ogni reparto vuole il suo top** (prima stesura sua: «3 difensori e un portiere ... non sarebbe una formazione
equilibrata»; poi corretta da lui: «"non più di 2 dello stesso reparto" deve essere solo un consiglio non una
imposizione ... la vera regola è che nella rosa per ogni reparto ci devono essere almeno 1 o 2 top/semitop. Se nelle
prime 4 scelte non ci sono A probabilmente non rimarrà niente nemmeno dopo»). Il vincolo rigido di 2 per reparto,
scritto e spedito per un'ora, è TOLTO. Al suo posto, sulla categoria del FOGLIO (super · top · semi,
`ScenarioInput.isTop`, mai ricalcolata):
- `bareLines`: un piano lascia un reparto SCOPERTO (portieri, difesa, centrocampo, attacco) se a fine catena la rosa
  non ha un top di quel reparto e la camminata dei rivali ne lascia liberi meno di `TOP_LEFT_MIN` = 2. Nel rango costa
  `BARE_WEIGHT` = 0,5 del guadagno che il miglior top di quel reparto darebbe ADESSO: un PESO, non un divieto, e il
  piano lo dice con un badge rosso (⚠ e l'iniziale del reparto).
- `urgentTops`: dentro una catena, un top di un reparto ancora scoperto i cui top liberi sono meno di `TOP_LEFT_MIN`
  più un giro di chiamate passa davanti se il suo guadagno ×1,5 raggiunge quello della mossa migliore.
- `crowdedSide`: più di `CHAIN_SIDE_MAX` = 2 scelte sullo stesso lato (porta e difesa insieme, centrocampo, attacco) è
  solo un'icona grigia sul piano.
Le tre soglie (2, 0,5, «un giro») sono dichiarate e non misurate: si ritarano guardando un draft vero.

**Verifica**: test diretti su `bareLines`, `urgentTops`, `crowdedSide` e sulla rotazione (la controprova fa cadere
esattamente il test descritto). Un test su tutta la catena non è stato possibile: il fixture a tre squadre svuota la
lista e le catene si fermano alla prima scelta. 1375 test app verdi su HEAD più questa metà (worktree), build pulito;
non ancora visto su un draft vero.

