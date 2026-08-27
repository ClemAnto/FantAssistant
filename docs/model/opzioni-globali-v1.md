# Opzioni globali dell'app — v1

**Aggiornato: 27 agosto 2026.** Verbale della sessione che ha portato nell'app una **dichiarazione sola
per tutte le viste** (il regolamento della lega) e un **perimetro che si può restringere** (le squadre
reali da escludere), più l'icona dell'app generata dal tema.

Richiesta dell'operatore, in due messaggi dello stesso momento: «inseriamo delle opzioni globali dove è
possibile selezionare le squadre reali da escludere: tutti i calciatori appartenenti alle squadre escluse
non devono essere visibili e considerati nei calcoli» e «in queste opzioni globali deve essere possibile
impostare i settaggi di lega che poi devono valere per ogni vista».

Niente di quello che sta qui è misurato dal gate e niente entra nel motore: sono due DICHIARAZIONI
dell'operatore, come `board_rulings.json` e `player_notes.json` un piano più sotto. `engine_*`, i fogli e
le revisioni non si muovono.

---

## 1. Cosa c'è, e dove

`core/global-options.ts` (il servizio) + `ui/global-options/` (il pannello), montato **fuori
dall'outlet** in `app.html` accanto al viaggio nel tempo e per la stessa ragione: quello che dichiara vale
per ogni vista, quindi chi cambia pagina deve continuare a vederlo — e soprattutto a vedere che è
**attivo**.

Due schede in una finestra:

- **Lega** — listone, gioco, tipo d'asta, rose (nei due vocabolari: P/D/C/A su classic, portieri +
  movimento su mantra), budget, partecipanti, «ruolo pieno = fuori», modificatore di difesa, tornate delle
  buste, finestra di giornate. Più la riga che dice **quale foglio** prezzerà le liste con quella scelta, e
  «allinea squadre e rose al foglio», che sono arrivati qui dalla finestra della Strategia.
- **Squadre escluse** — le 47 squadre che i due listoni quotano, per campionato, ognuna con quanti uomini
  porta su ciascun listone; ricerca per nome e «escludi il campionato» intero, che su euro è la differenza
  fra cinque clic e trentasette.

Quello che **non** è entrato, perché è di una vista sola e non è il regolamento: come si legge un blocco
della Strategia (`strategy.view`, preferenza di lettura) e i crediti che le Buste tengono da parte per la
tornata dopo (`sealedBid.reserve`, una scelta di quel momento).

## 2. Dove sta il taglio, e perché lì

Nel **perimetro**, cioè prima di ogni numero che l'app calcola: `PlayersStore.roster` e
`ValuationStore.rosters`.

La ragione non è comodità. Le fasce di colore (`toneScores`), la profondità di un ruolo (`rolePool`) e le
quattro letture a stelline sono **percentili**, e un percentile è un fatto su un POOL. Lasciare gli esclusi
nel pool e toglierli solo dalla tabella darebbe una lista i cui numeri descrivono un'altra lista — il
difetto che il pannello del toolkit ha già pagato una volta (`SnapshotView.rows`, 08/08/2026). Col taglio
nel perimetro le quattro letture si **rifanno**: `ValuationStore` le chiede da un effetto solo, che
dipende dal pool e dalle attese del motore, quindi una squadra esclusa è una domanda nuova e non una
risposta riusata.

Conseguenza voluta, e va detta: escludere una squadra costa un ricalcolo dello strato per-partita. Per
questo il pannello è **una finestra con Applica e Annulla** e non una fila di interruttori che scrivono
subito: un clic per squadra vorrebbe dire un ricalcolo per squadra, e «annulla» deve annullare davvero.

## 3. Quello che NON si ricalcola, dichiarato invece di scoperto

Le colonne del **motore** — surplus, rimpiazzo, Fantapunti, SpM/dVM — le scrive il toolkit per una lega
intera (`snapshot`), e l'app non ha un motore: rifarle qui sarebbe una seconda risposta a una domanda che
il toolkit già dà. Quindi un listone senza una squadra tiene il rimpiazzo di quando quella squadra c'era.

È lo stesso limite dichiarato del viaggio nel tempo, e come là **si scrive a schermo**: il tooltip
dell'etichetta lo dice per intero. Se un giorno l'esclusione dovesse entrare nei numeri del motore, il
posto è il toolkit (una lega dichiarata con meno club), non l'app.

## 4. Il pannello d'asta: esce il pool LIBERO, non la stanza

In `auction-advice.ts` il taglio è su una definizione sola (`free`), letta da `priced` e da `listone`, e
tocca **solo i liberi**: chi è escluso è uno che io non comprerò, quindi esce da quello che mi viene
proposto e dalle scale che parlano della mia lista. Chi i rivali hanno **già preso** resta dov'è, perché è
un fatto sulla stanza e non sulla mia lista — e il classificatore dei rivali rigioca il draft su quello.

Il club si risolve con `clubIds`, cioè la chiave canonica: un nome non è una chiave. Finché quell'indice
non è arrivato (lo legge la stessa passata che sceglie il foglio) nessuno viene escluso, che è meglio di una
lista tagliata da un join a metà.

## 5. Le scelte dichiarate

- **La chiave è `fc_club_id`**, mai il nome. Misurato sul bundle prima di scriverlo: **0** righe di rosa
  della stagione bersaglio senza `fc_club_id`, e **0** nomi di club dei tre fogli assenti dalla tabella
  `clubs`. Quindi il ramo «senza id» oggi non scatta mai, ed è una guardia e non un ripiego.
- **Senza club non si esclude nessuno.** «Vuoto = ignoto, mai zero»: non sapere di che squadra è un uomo
  non è una prova che sia di una squadra esclusa.
- **Il catalogo si costruisce dal listone GREZZO**, non da quello già tagliato: un pannello che leggesse la
  lista filtrata non saprebbe più nominare le squadre escluse, e non ci sarebbe modo di riammetterle.
- **Un filtro globale è invisibile per costruzione**, quindi il bottone porta addosso quante squadre stanno
  fuori, e il tooltip i nomi più quanti uomini nasconde su ciascun listone. È la stessa regola dei filtri
  per colonna della tabella (20/08/2026): un filtro attivo porta la sua etichetta fuori da ogni pannello
  che si chiude.

## 6. La migrazione delle due dichiarazioni che c'erano già

Prima di oggi il regolamento stava in **due** posti: `strategy.setup` (listone, gioco, rose, budget,
partecipanti, tipo d'asta) e `sealedBid.rules` (budget, tornate, ruolo pieno, modificatore, finestra). Due
dichiarazioni della stessa lega prima o poi si contraddicono.

`migrateLegacy` le legge **una volta sola**, e solo quando la chiave nuova non c'è ancora — quindi non può
sovrascrivere una dichiarazione fatta col pannello. Dove i due si sovrappongono (il budget) **vince la
Strategia**, perché dichiarava la lega per intero mentre le Buste ne dichiaravano una fetta; i campi che
solo le Buste avevano vengono da lì, perché nessun altro li aveva. Non leggerli sarebbe stato un
azzeramento silenzioso, che si legge come «non c'era niente da tenere».

## 7. Le misure

**Arnese nuovo: `app/scripts/e2e-options.mjs`** (browser vero, puntatore vero, zero dipendenze, la stessa
forma degli altri tre e2e). Sette passi, tutti verdi:

| passo | numero |
|---|---|
| la tabella apre | 618 calciatori |
| il bottone è sullo schermo | 86×24px, `elementFromPoint` sul centro risponde il bottone stesso |
| il pannello offre le squadre | **47**, nessuna già spuntata |
| escluso il Napoli | 618 → **583** (**35** uomini), etichetta «1 squadra esclusa» |
| ogni vista si apre | Calciatori · Squadre · Strategia · Buste · Grafici, nessuna nomina più il Napoli, zero eccezioni |
| il regolamento è uno | budget **777** scritto sulle Buste, la Strategia legge «777 crediti» |
| sopravvive al refresh | «1 squadra esclusa» |

Più `core/global-options.spec.ts` (9 prove: la chiave, il vuoto, l'identità della lista quando non c'è
niente da escludere, il conteggio nascosto, la casella svuotata, il salvataggio di una versione precedente,
la migrazione e il suo limite). **533 prove su 34 file**, `ng build` verde.

Il catalogo, misurato sul bundle del 27/08: **47 club** — 20 serie_a, 10 premier_league, 6 bundesliga, 6
la_liga, 5 ligue_1.

**E una lezione dall'arnese, non dall'app.** Il conteggio degli uomini di un club preso dal bundle a mano
dice **29** per il Napoli; quello che l'app misura è **35**, e la differenza non è un errore: `buildRosters`
completa e CORREGGE il listone col foglio (chi il listone non ha entra, chi ha cambiato club prende quello
che la fonte gli dà). Quindi il numero giusto è quello della funzione che spedisce, e non quello di una
query che somiglia — sesta istanza della stessa regola, questa volta commessa mentre scrivevo il verbale.

**E due difetti dell'arnese stesso, che valgono più dei passi che ha superato.** Con una porta di debug
fissa la seconda corsa si è attaccata al browser della PRIMA, che non era stato ucciso: ha letto 583
calciatori invece di 618, la squadra già esclusa, e ha riportato quattro «problemi» che non esistevano —
un arnese che misura la sessione sbagliata è peggio di un arnese che non gira. Curato con
`--remote-debugging-port=0` (la porta la sceglie il sistema e la si rilegge dal profilo) e ammazzando
l'ALBERO dei processi, perché un headless si sdoppia in figli.

## 8. L'icona dell'app

`app/scripts/make-favicon.mjs` (`npm run favicon`, zero dipendenze: il `zlib` di Node basta a scrivere un
PNG e la directory di un ICO sono sedici byte per immagine). Scrive `favicon.svg` **e** `favicon.ico`
16/32/48/64 dalla **stessa geometria**: il vettore la scrive, il rasterizzatore la campiona 4×4 per pixel.
Disegnarla due volte — una in SVG a mano e una nel rasterizzatore — vorrebbe dire due icone che prima o poi
non sono la stessa.

I colori **vengono dal tema** e non sono trascritti: `--color-primary` e `--color-on-primary` di
`magenta.css`, letti da `scripts/theme-tokens.mjs`, che è lo stesso lettore di `audit-contrast.mjs` (una
definizione sola di «quali colori dichiara questo tema»; l'audit continua a riportare 60 coppie, 54
valutate, 0 sotto soglia). Un token che manca fa fallire la corsa invece di prendere un ripiego: un'icona
disegnata con un colore inventato è indistinguibile da una disegnata bene.

Misurato dal generatore: ico **2751 byte** (contro i 15086 del default Angular), 4 immagini **rilette come
PNG della misura dichiarata** (una directory che punta male dà un'icona vuota, non un errore), contrasto
sagoma/tinta **5,56:1**, e a 16px **142 pixel di tinta e 38 di sagoma** su 180 opachi — la sagoma
sopravvive alla misura in cui serve.

**E il disegno è stato GUARDATO, ingrandito, non dedotto** — le prime due versioni erano sbagliate e
nessun numero lo diceva:

1. cuciture larghe **fino al bordo** (tagliate dal pallone stesso): tagliano il cerchio in cinque petali,
   e a 128px si legge **un fiore**;
2. cuciture larghe attaccate ai vertici del pentagono: si fondono con lui in **una stella** a cinque punte;
3. quella che resta: cuciture sottili che si fermano prima del bordo, anello di tinta intatto — la sagoma
   circolare è la prima cosa che si riconosce, e se si rompe non resta niente.

Per guardare i 16 pixel VERI bisogna incollare il PNG da 16 nella pagina di prova: dentro un ICO il
browser sceglie da sé quale immagine usare, quindi chiedergliene una da 256 gli fa disegnare quella da 64 e
la misura che conta non si vede mai. La pagina di prova (`--shot`) si scrive in `%TEMP%` e **non** in
`public/`: là dentro finisce tutto nel sito pubblicato, e una pagina di debug su GitHub Pages è una pagina
di debug su GitHub Pages.

## 9. Aperti

1. **Il rewiring della Strategia non è nel commit.** `views/strategy/strategy.ts` e `.html` sono stati
   toccati da due mani nella stessa ora (vedi §10): la mia parte — la pagina legge il regolamento globale
   invece di tenerne una copia, la sua finestra apre il pannello unico — è nell'albero di lavoro e
   funziona (l'e2e la verifica), ma il commit di questa sessione la lascia fuori per non portarsi dietro il
   lavoro in corso dell'altra. Finché resta fuori, il RECORD committato ha ancora due dichiarazioni.
2. **Questo verbale non è linkato dal BRIDGE**, per la stessa ragione: quel file era in scrittura
   dall'altra sessione mentre chiudevo. Una riga nell'ordine di lettura, quando è libero.
3. **L'esclusione non arriva al toolkit.** Una lega con meno club è una lega diversa anche per il
   rimpiazzo: se l'operatore volesse i numeri del motore coerenti con l'esclusione, la strada è dichiararla
   in `config/league_config.json` e rifare `snapshot`, non ricalcolare nell'app.
4. **La finestra si apre da due maniglie** (il bottone globale e il bottone della Strategia) e la seconda
   passa dal servizio: il difetto è già stato trovato e curato, ma un terzo chiamante deve usare
   `GlobalOptions.open()` e non montare un secondo pannello.
5. **Nessuna vista dice ancora quanti uomini l'esclusione le ha tolto**, a parte l'etichetta globale. La
   tabella dei calciatori ha già il suo conteggio e cambia da sé; la Strategia e le Buste no.

## 10. Due sessioni sullo stesso albero, e il conto di questa

Il 27/08 due sessioni hanno lavorato in parallelo sulla stessa copia di lavoro. Il prezzo pagato, scritto
perché la regola esiste già (`CLAUDE.md`, «Due sessioni su un repository è ormai il caso normale») e non è
bastata:

- un mio taglio su `views/strategy/strategy.ts`, fatto su marcatori di testo, ha rimosso **cinque
  costanti** che l'altra sessione aveva appena aggiunto in quella zona (`PRIORITY_KEY`, `readPriority`,
  `DRAG_THRESHOLD_PX`, `DRAG_EDGE_PX`, `DRAG_SCROLL_STEP_PX`). Ricostruite: i tre valori del drag copiati
  dalle costanti gemelle di `squad-table.ts`, **`PRIORITY_KEY` e il corpo di `readPriority` sono una
  ricostruzione dall'uso** e vanno riviste da chi le ha scritte;
- l'altra sessione ha trovato e curato un difetto **mio**: `GlobalOptions.open()` alzava `panelOpen` e il
  pannello non lo leggeva, quindi il bottone della Strategia non apriva niente — due maniglie su una porta
  e nessuna che aprisse.

La lezione operativa non è mnemonica: **un taglio per marcatori su un file che un'altra mano sta scrivendo
non è un'operazione sicura**, perché i marcatori sono ancora là e in mezzo c'è roba nuova. Un `git diff`
prima e dopo l'avrebbe visto; il worktree l'avrebbe evitato del tutto.

---

## Le lezioni, in una riga ciascuna

- **Un perimetro si restringe dove è DEFINITO**, non dove sta la tabella: un percentile è un fatto sul
  pool, e un pool che non è la lista dà numeri che descrivono un'altra lista.
- **Una dichiarazione in due posti è due dichiarazioni**, e la prima a divergere è quella che nessuno
  guarda.
- **Un filtro globale è invisibile per costruzione**: chi lo tiene deve dire che c'è e quanto grande.
- **Quello che non si può ricalcolare si dichiara**, come per il viaggio nel tempo: il motore resta quello
  della lega intera e il pannello lo scrive.
- **Un disegno si guarda ingrandito**: un fiore e una stella hanno superato tutti i controlli numerici.
- **Un arnese che misura la sessione sbagliata è peggio di un arnese che non gira.**
