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
