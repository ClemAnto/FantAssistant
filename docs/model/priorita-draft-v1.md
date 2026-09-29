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
