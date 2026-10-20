# Widget Android «FantAssistant Partite» — stato e roadmap (v1, 10/10/2026)

> **Dal 14/10/2026 (v0.3.0) l'app non è più solo il widget**: si apre sulla webapp, in una WebView col ponte a Leghe
> che sostituisce l'intermediario. Vedi §7.

Richiesta dell'operatore (10/10/2026): «un widget android che mostri sempre la lista delle partite reali che
interessano i miei calciatori ... data/orario di inizio quando non sono iniziate oppure il risultato live e minuto
(durante la partita) o definitivo (quando sono terminate). Cliccando sulla partita vorrei si aprisse la pagina del
dettaglio della partita su SofaScore», con aggiornamento ogni 5 minuti («non ho bisogno di un livescore in tempo
reale») e un **toggle** che mostra o nasconde i suoi calciatori sotto ogni partita.

Questa pagina è il punto d'ingresso per riprendere il lavoro sul widget in un'altra chat.

---

## 1. Architettura — tre metà, e chi possiede ciascuna

```
 webapp (pagina Formazione)        Apps Script (foglio probabili)            telefono
 ───────────────────────────        ─────────────────────────────            ────────
 «Invia al widget»  ──POST──▶  widget.gs: doPost  → rosa salvata
                                  trigger ogni 5' → SofaScore API
                                  doGet ?what=widget  ──JSON──▶  app Android (widget nativo)
                                  doGet ?what=widgetPage (pagina HTML, ripiego)
```

1. **CHI sono i miei calciatori** — la webapp. `app/src/app/core/widget-feed.ts` (`WidgetFeed`, `widgetMen`),
   bottone **Widget** nell'intestazione di `views/lineup/`. Manda per la fantasquadra a schermo: nome, ruolo,
   club di Leghe e **id SofaScore del club**. Niente dell'account Leghe esce dal browser. POST `text/plain`
   (richiesta «semplice», senza preflight CORS). La chiave segreta sta in `localStorage` (`widget-secret`).
   L'indirizzo è lo stesso del foglio probabili (`NextRoundStore.url`), una sola distribuzione.
2. **L'id SofaScore dei club** — il toolkit. `export.write_sofascore_clubs` scrive
   `data/export/<stagione>/sofascore_clubs.json` (`fc_club_id → team id`, da `club_xref` source `sofascore`,
   93 club al 10/10/2026); `app/scripts/pull-bundle.mjs` lo copia; `Bundle.sofascoreClubs()` lo legge.
   Derivato e stretto apposta: `club_xref` resta in `EXCLUDED`. Il join è per **id nostro**, mai per nome.
3. **COSA giocano i loro club** — `scripts/gas/widget.gs`, terzo file del progetto Apps Script delle probabili
   (accanto a `probabili-sheet.gs` e `odds.gs`). SofaScore risponde ai server Google (misurato 10/10/2026: 200),
   mentre al PC dell'operatore risponde 403 da agosto. Il trigger `refreshWidget` (ogni 5'):
   - calendario di ogni club riletto ogni `WIDGET_SCHEDULE_TTL_H` = 6 h (`/team/{id}/events/last/0` e `next/0`);
   - partite in corso (o a 5' dal fischio, fino a 4 h dopo) rilette a ogni giro (`/event/{id}`): zero richieste
     in una giornata senza partite;
   - **solo campionato** (`WIDGET_LEAGUES` = uniqueTournament 23 Serie A, 17 Premier, 8 Liga, 35 Bundesliga,
     34 Ligue 1), finestra ultime 48 h + prossimi 7 giorni, **tetto 30 righe**;
   - serve `?what=widget`: JSON già formattato (`title`, `score`, `when` = «Oggi 20:45» / «67'» / «45+2'» /
     «HT» / «FT» / «Annullata», `league`, `home`/`away` con `homeId`/`awayId` (id SofaScore, per gli stemmi), `players`, `homePlayers`, `awayPlayers`, `url`, `state`
     pre|live|done), più `text`/`textShort` e `rich`/`richShort` (tag Kustom, per KWGT);
   - serve `?what=widgetPage`: la stessa lista come pagina HTML (link `target="_top"` a SofaScore, casella
     «calciatori»). Era il ripiego per KWGT; resta disponibile.
   - minuto: `(now − time.currentPeriodStartTimestamp + time.initial)/60 + 1`, «limite+N'» oltre `time.max`.
   - link: `https://www.sofascore.com/football/match/{slug}/{customId}#id:{id}`.
4. **COME si vede** — `android/` (app Java, nessuna dipendenza esterna). Vedi §2.

## 2. L'app Android (`android/`)

- Versione: `versionName` in `app/build.gradle` (0.2.0 dall'11/10/2026), scritta nell'intestazione del widget
  accanto a «agg.» e nella schermata dell'app; l'APK in `android/builds/` porta la versione nel nome. Va alzata
  (con `versionCode`) a ogni APK dato all'operatore, o uno screenshot non dice quale versione l'ha disegnato.
- Build: `cd android; $env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"; .\gradlew.bat assembleDebug`
  → `app/build/outputs/apk/debug/app-debug.apk`. AGP 9.4.1, Gradle 9.8.0 (wrapper), compileSdk/targetSdk 35,
  minSdk 26. `local.properties` punta all'SDK locale ed è gitignorato.
- Classi (`it.fantassistant.widget`):
  - `MatchesWidget` (AppWidgetProvider): header «Partite», «agg. hh:mm» (ora in cui il FOGLIO ha costruito la
    lista, con «!» se l'ultima lettura è fallita), bottone **Nomi ✓/Nomi** (toggle), **↻** (rileggi ora),
    `ListView` scorrevole;
  - `MatchesListService`: le righe (bordo rosa e minuto rosa se live, nomi nascosti dal toggle) **raggruppate per
    giorno** con un'etichetta fra due righe sottili come divisore (`layout/group.xml`), secondo lo schema
    dell'operatore del 10/10/2026: `giovedì 8/10` · `ieri, venerdì 9/10` · `oggi, sabato 10/10` (giocate e in
    corso, col risultato e FT/minuto) · `più tardi` (le partite di oggi non ancora iniziate, «ore 18:00» sulla riga)
    · `domani, domenica 11/10` e i giorni seguenti («ore 12:00» sulla riga). Le etichette le calcola il telefono
    (`Matches.label`, sull'orologio del telefono) da `start` e `state`; «Team A vs Team B», risultato «2-1»;
  - `Crests`: stemmi dei club scaricati dal telefono da `img.sofascore.com/api/v1/team/{id}/image` (risponde 200
    anche dove l'API dà 403), ridotti a 48 px, in `files/crests/{id}.png`, riletti dopo 30 giorni; scaricati dopo
    ogni lettura riuscita (`Refresher`). Uno stemma mancante = riga senza immagine, mai un errore;
  - `Refresher`: GET con 3 tentativi (il secondo salto di Apps Script fallisce da sé ogni tanto), catena di
    allarmi inesatti non-wakeup: **5' se c'è una partita live**, fino al prossimo calcio d'inizio se è entro 30',
    altrimenti 30'; `updatePeriodMillis` 30' come rete di sicurezza;
  - `OpenActivity`: trampolino del tocco su una riga. **Necessario**: da Android 14 un PendingIntent MUTABLE con
    intent implicito è vietato (crash misurato sull'emulatore), quindi il template è esplicito verso questa
    activity che apre il link;
  - `WidgetActivity` (fino al 13/10/2026 si chiamava `MainActivity`): istruzioni, indirizzo del foglio
    modificabile, «Salva e aggiorna», «Aggiungi il widget alla home» (`requestPinAppWidget`), stato dell'ultima
    lettura e, dal 14/10/2026, l'indirizzo della webapp. Si apre toccando il titolo del widget o dal menu della
    pressione lunga sull'icona («Widget», `res/xml/shortcuts.xml`);
  - `MainActivity` dal 14/10/2026 è la WEBAPP in una WebView col ponte a Leghe: vedi §7;
  - `Store` (SharedPreferences): url, ultima lista come testo, errore, toggle; `Matches`: parse del JSON.
- **Verificato sull'emulatore** (AVD `fa-widget-test`, Android 14, creato a mano in `~/.android/avd`): lista coi
  dati veri, live in rosa, toggle che nasconde i nomi, tocco su una riga → `OpenActivity` → Chrome sull'URL
  SofaScore. **Non verificato**: che l'URL apra la partita giusta (Chrome era al primo avvio), il comportamento
  su un telefono vero (Doze, launcher diversi), l'app SofaScore che intercetta il link.

## 3. Setup lato operatore (fatto il 10/10/2026)

1. Apps Script: file `widget` = `scripts/gas/widget.gs`; in `probabili-sheet.gs` il `doGet` instrada
   `what === 'widget' || what === 'widgetPage'` a `widgetGet_(e)`; proprietà script `WIDGET_SECRET`; eseguito
   `widgetInstall`; ridistribuito come **Nuova versione sulla distribuzione `AKfycbz2zd…`** (quella che l'app usa;
   una «Nuova distribuzione» cambia indirizzo — è successo una volta, versione 9 finita su `AKfycbzsP1…`).
2. Webapp: Formazione → Widget → chiave → «Invia questa squadra» (prima prova: 36 calciatori, 20 partite).
3. Telefono: installare l'APK (origini sconosciute), aprire l'app una volta, «Aggiungi il widget alla home».

**Ogni modifica a `widget.gs` va incollata nell'editor e ridistribuita** (Nuova versione, stessa distribuzione):
il repository non pubblica niente su Apps Script da solo.

## 4. Decisioni prese (e perché)

- **Nativo e non KWGT**: KWGT gratuito non ha liste dinamiche (una riga a mano per partita) e non disegna HTML;
  un `.kwgt` scritto a mano era un formato non documentato e il caricamento da file probabilmente richiede Pro.
  Un widget snapshot di pagina web (es. WebSnap) è un'immagine: link non cliccabili.
- **Ionic non serve**: il widget della home è comunque codice nativo; per un'app che è solo widget aggiunge un
  livello senza toglierne.
- **Java e non Kotlin**: meno plugin da scaricare e configurare; nessuna dipendenza oltre l'SDK.
- **Il foglio fa da server**, il telefono legge solo un JSON piccolo: il lavoro (SofaScore, filtri, formati) sta
  in un posto, e la stessa lista serve widget, pagina HTML ed eventuali client futuri.

## 5. Roadmap (aperti, in ordine di valore)

1. ~~**Prova sul telefono vero**~~ — **fatta il 10/10/2026**: l'operatore conferma che sul suo Android il widget
   «funziona egregiamente». Se un giorno il link non aprisse la partita esatta: correggere il formato URL in
   `widget.gs` (alternativa `https://www.sofascore.com/event/{id}`).
2. ~~**Pubblicare e committare**~~ — fatto il 10/10/2026: tutto committato e pushato, app web pubblicata su
   GitHub Pages col bottone Widget e `sofascore_clubs.json` nel bundle.
3. **Export completo**: `sofascore_clubs.json` è stato scritto a mano nell'export del 10/10 con la funzione nuova;
   il prossimo `export` lo produce da sé — verificare che compaia nel manifest (`sofascore_clubs`).
4. ~~**Stemmi, font più piccoli, FT/HT, raggruppamento per giorno**~~ — fatto il 10/10/2026 (sera), verificato
   sull'emulatore con un JSON di prova servito in locale (stemmi presenti, gruppi e «ore» giusti). **Richiede di
   incollare `widget.gs` e ridistribuire** (Nuova versione, stessa distribuzione): senza, la lista non porta
   `homeId`/`awayId` e gli stemmi non compaiono (il resto funziona già: FT/HT e i gruppi hanno un ripiego sul
   telefono). Reinstallare l'APK sopra quello vecchio.
4-bis. **Cosa hanno fatto i miei calciatori** (10/10/2026, sera): squadra senza miei calciatori in trasparenza;
   per le partite in corso o finite, chi non ha giocato al 50%, ▲ verde col minuto per chi è entrato, ▼ rosso col
   minuto per chi è uscito, un pallone per ogni gol (rigori compresi, autogol no) e una scarpetta per ogni assist; dall'11/10 anche ❌ per un rigore sbagliato e 🧤 per un rigore parato, letti dalle statistiche per
   calciatore delle formazioni (`penaltyMiss`, `penaltySave`, verificate su un turno di Serie A in cache).
   Catena: il toolkit aggiunge `players` (`fc_id → id SofaScore`, da `player_xref`) a `sofascore_clubs.json`
   (4026 calciatori; stesso file, così nessuna allowlist deve imparare un nome nuovo); la webapp manda `id` per
   ogni uomo (`WidgetMan.id`, join per `fcId`, mai per nome); `widget.gs` legge `/event/{id}/lineups` (titolari) e
   `/event/{id}/incidents` (cambi, gol, assist) a ogni giro finché la partita è in corso e UNA volta a partita
   finita (`widget:detail:<id>`, `final`), e scrive `men: [{name, played, on, off, goals, assists}]` per riga;
   il telefono li disegna con span colorati (le immagini in un testo di RemoteViews non passano, quindi pallone e
   scarpetta sono emoji). `played` null = non si sa (partita non iniziata o uomo senza id) → nome normale.
   **Serve, nell'ordine**: pubblicare la webapp, rimandare la squadra dalla pagina Formazione (per gli id), incollare
   e ridistribuire `widget.gs`, installare l'APK. Anteprima verificata sull'emulatore con dati inventati.
   Verificato poi sui dati VERI (10/10/2026 18:32: Gusto ▲88', Grimaldo un gol, Nyland e Baum non schierati).
   I calciatori di ogni squadra stanno dietro un pallino del colore predominante del suo stemma (20/10/2026,
   `Crests.color`: il colore cromatico più frequente, il grigio solo per uno stemma bianco-nero, schiarito fino a luminanza 0,12; `side` nel JSON, con ripiego sul conto di `homePlayers`); sostituisce il bianco più scuro della trasferta. I gruppi sono ordinati per giorno con
   «più tardi» subito dopo «oggi» (`Row.rank`), così una partita delle 18:30 non ancora iniziata non spezza in due
   il gruppo di oggi. APK copiato in `android/builds/` (gitignorato da `*.apk`).
   **Code review del 10/10/2026 (sera), corretti:** il tetto di righe da 30 a 60 (con due account la lista finiva
   al sabato dopo); la lista salvata in proprietà a pezzi da 8 KB (`widgetStore_`/`widgetStored_`, il limite di una
   proprietà è 9 KB) con la cache come scorciatoia e non come unica copia; gli stemmi scaricati DOPO aver disegnato
   la lista e rilasciato il broadcast, ogni club una volta per giro, e un secondo disegno solo se ne è arrivato uno;
   gli stemmi decodificati una volta per lettura e non due per riga a ogni ridisegno; i nomi delle squadre con
   `maxWidth` 110dp perché un nome lungo non spinga fuori la squadra ospite; una riga senza calcio d'inizio in
   fondo e non sopra il giorno più vecchio; nell'export, un calciatore con DUE id SofaScore vivi è lasciato fuori
   (8 su 4026) invece di prenderne uno a caso, che lo farebbe leggere «non ha giocato» in ogni partita.
5. **Densità delle righe**: oggi ~6 righe visibili su un 4×3; valutare campionato sulla stessa riga del titolo,
   righe più basse, o un layout compatto opzionale.
5-bis. **Solo i calciatori schierati** (chiesto e rimandato dall'operatore l'11/10/2026): la pagina Formazione legge
   già da Leghe la formazione salvata (`current().saved.starts` / `.bench`, fc_id); basta mandare per ogni uomo
   titolare/panchina/fuori e decidere come disegnarli (solo titolari · titolari pieni e panchina sbiadita · un
   segno). Limite: il widget sa ciò che la webapp gli ha mandato all'ultimo «Invia».
6. **Anteprima nel selettore widget** (`previewLayout`/`previewImage`): oggi mostra l'icona.
7. **Più fantasquadre**: il foglio unisce già le squadre inviate (chiave = lega); il widget non dice di quale
   fantasquadra è ogni calciatore. Eventuale etichetta o filtro.
8. **Firma release**: oggi APK debug. Per aggiornamenti senza disinstallare serve sempre la stessa chiave: la
   debug key di questo PC va bene finché si compila qui; altrimenti creare un keystore (fuori dal repo).
9. **Gol dei miei calciatori** nella riga (incidents dell'evento) — costo: una richiesta in più per partita live.

## 6. Trappole incontrate (da non ripetere)

- La distribuzione Apps Script congela il codice: «Funzione script non trovata: doPost» = versione vecchia online.
- Un PendingIntent mutabile implicito crasha su Android 14+ (vedi `OpenActivity`).
- `local.properties` su Windows vuole i backslash raddoppiati (`C\:\\Users\\...`), altrimenti
  «La sintassi del nome del file ... non è corretta».
- Uno screenshot headless stretto (Edge a 412 px) non è affidabile per verificare il layout mobile.
- **Solo la giornata corrente** (11/10/2026, `widgetCurrentRounds_` in `widget.gs`, richiede la ridistribuzione):
  «la giornata corrente dura fino a tutto il giorno in cui c'è almeno una partita da giocare o giocata». Per
  campionato, il turno corrente è il più basso il cui ultimo giorno (ora italiana) è oggi o dopo; poi UNA giornata
  fra i cinque: i turni già cominciati fissano l'orizzonte (il loro ultimo giorno) e un turno entra solo se comincia
  entro quello, così la domenica non compare la Premier della settimana dopo mentre la Serie A gioca ancora il
  lunedì; senza turni cominciati (infrasettimanale) l'orizzonte lo fa il turno che comincia prima, con quelli entro
  tre giorni. Rinviate e annullate non allungano un turno.
  **Corretta lo stesso giorno**: la prima forma prendeva per ogni campionato il turno non ancora finito, quindi la
  domenica la Bundesliga (giocata venerdì e sabato) spariva dalla lista anche con «Passate» acceso. Ora la giornata
  è UNA settimana di calcio: si ancora sui turni in corso oggi (o, a metà settimana, sui prossimi), vi aggiunge i
  turni non finiti che cominciano entro tre giorni, e vi fa rientrare qualunque turno che si sovrapponga a quel
  periodo, con due giorni di margine prima. Il calendario in cache senza `round` viene riletto.
- **v0.2.2 (11/10/2026)**: il tasto ↻ scrive subito «aggiornamento…» in rosa finché la lettura non finisce; a
  partita finita i calciatori che non hanno giocato non si mostrano (in corso restano sbiaditi, possono ancora
  entrare); frecce e minuti di entrata/uscita in grigio chiaro.
- **v0.2.3-0.2.5 (11/10/2026)**: il divisore «oggi, più tardi» in verde (le partite di oggi ancora da giocare);
  le partite finite (e annullate/rinviate) nascoste di default, con un interruttore nell'intestazione; dalla
  0.2.7 «Passate» e «Nomi» sono due ICONE (orologio all'indietro e gruppo di persone, `drawable/ic_past.xml`,
  `ic_men.xml`), piene se accese e sbiadite se spente. Prima era stato provato lo scorrimento automatico su «oggi» (0.2.4) e l'operatore l'ha
  scartato: un widget a lista si scorre solo con `smoothScrollToPosition`, che porta l'elemento in vista col
  minimo movimento, quindi «oggi» in cima era solo una stima.
- **«aggiornamento…» non resta più appeso** (v0.2.8): il segno è l'ORA in cui il tocco è partito e vale 60 secondi,
  un allarme ridisegna comunque dopo 62, e la lettura intera sta dentro 40 secondi (timeout 10+15 s, tre tentativi
  finché c'è tempo). Prima un broadcast ucciso dal sistema a metà lettura lasciava il segno per sempre.
- **Code review dell'11/10/2026 (v0.2.9), corretti:** la durata VERA di un turno si legge dal calendario del
  campionato (`widgetRoundSpans_`, `/unique-tournament/{ut}/season/{s}/events/round/{n}`, una richiesta per turno
  ogni 6 ore) e non dalle sole partite dei miei club, che una domenica senza miei club chiudeva il turno in
  anticipo; una partita rinviata e rigiocata settimane dopo non allunga più il suo turno (`widgetCoreSpan_`: solo i
  giorni entro 4 dalla mediana); finestra di lettura 96 h, o la partita del venerdì usciva domenica sera; un evento
  in cache senza `round` non forma più un turno «undefined»; telefono: una lettura sola alla volta, ogni tentativo
  parte solo se il suo caso peggiore sta nei 45 secondi, diagnostica e presenza degli stemmi lette una volta per
  aggiornamento e non per riga, un ramo morto tolto. L'allarme di riserva resta inesatto (uno esatto vuole un
  permesso) e lo dice il codice.
- **Gli stemmi per URI e mai come bitmap** (`CrestProvider`, 11/10/2026, v0.2.1). TROVATA sul telefono vero
  (moto g85 5G, Android 16, launcher Motorola) collegato in debug wireless: la lista si fermava alla 13ª riga di 48
  (`listServed` 12 nella diagnosi) e `dumpsys appwidget` dava `views_bitmap_memory=764928` per il nostro widget;
  sull'emulatore andava tutto. Con le immagini passate come `content://it.fantassistant.widget.crests/{id}` la
  memoria è 0 e il launcher chiede tutte le 48 righe. *Un widget a lista non porta pixel nelle righe.*
  Per collegare il telefono: Opzioni sviluppatore → Debug wireless → «Associa con codice», poi `adb pair IP:porta
  codice` e il dispositivo compare da solo (mDNS).
- **Un solo tipo di riga nella lista** (`layout/item.xml`, etichetta e partita nello stesso layout, l'altra metà
  GONE): sul telefono dell'operatore, dopo l'APK che dichiarava due tipi di riga, il widget mostrava una partita
  sola e un lampo delle altre che sparivano. Una lista di RemoteViews si ricorda quanti tipi aveva quando il
  widget è stato messo; con un tipo solo non può mai essere in disaccordo con un widget più vecchio. Causa
  plausibile, non riprodotta sull'emulatore (lì andava con entrambe le versioni).
- In un commento XML la sequenza `--` è vietata (build fallita su `group.xml`).
- L'emulatore non riaggiunge il widget al riavvio (`-no-snapshot-save`): «Aggiungi il widget alla home» dall'app.
  Per provare con un JSON locale serve temporaneamente `usesCleartextTraffic` (non va lasciato nel manifest).
- `cat > file` senza heredoc in un comando Bash resta in attesa di stdin e blocca la corsa.

## 7. L'app apre la WEBAPP: WebView col ponte a Leghe (v0.3.0, 14/10/2026)

Richiesta dell'operatore (13/10/2026): «un'app di facile consultazione per inserire la formazione e proporre scambi
guardando le statistiche». Messe a confronto le due strade - pagine native in Java oppure la webapp in una WebView -
ha scelto (14/10/2026) **«webview con bridge su app nativa»**. Prima era stata cominciata una pagina NATIVA dei
calciatori sul solo foglio del motore: sospesa senza commit, è in `git stash` («WIP 13/10/2026: pagina nativa
Calciatori…»), e con la WebView non serve più.

**Perché la WebView** (ragioni date all'operatore): la pagina Formazione esiste già (login Leghe, rosa, FVA,
consiglio, controllo delle regole, salvataggio verificato, quote) e riscriverla in Java vorrebbe dire due definizioni
dello stesso consiglio; i numeri sono quelli della webapp per costruzione (stampa, dritte, base 38); gli scambi si
scrivono una volta per PC e telefono; `deploy:pages` aggiorna anche il telefono senza un APK nuovo.

**Com'è fatta.**
- `MainActivity` (resta l'attività del lanciatore, così un'icona già sulla home continua a funzionare) apre
  `Store.webappUrl` (predefinito `https://clemanto.github.io/FantAssistant/`, modificabile dalla schermata del
  widget) sulla pagina `lineup`, oppure sull'ultima pagina vista se è ancora dentro la webapp. JavaScript e DOM
  storage accesi, accesso ai file spento, user agent con ` FantAssistantApp/<versione>`.
- **Il ponte** (`LegheBridge`, `addJavascriptInterface` col nome `FantAssistantApp`): la pagina chiama
  `request(id, json)` con `{platform, method, path, headers, body}` e l'app risponde valutando
  `window.__fantassistantBridge(id, status, text)` nel frame principale; status 0 = nessuna risposta. Lato webapp:
  `leghe-api.ts` (`APP_BRIDGE`, `appBridge`, `viaApp`) e `LegheSession.base`, che dentro l'app vale `APP_BRIDGE` e
  vince su un intermediario incollato. Il contratto è quello del Worker: due host scelti dalla PIATTAFORMA, la lista
  `PATHS` (copia di quella di `app/proxy/leghe-worker.mjs`: vanno tenute allineate, e gli SCAMBI la dovranno
  allargare), solo GET/POST, solo `accept`, `app_key`, `authorization`, `content-type`. Una richiesta fuori regola
  torna 403 `APP403` col motivo. Niente si registra nei log.
- **Chi può chiamarlo**: `addJavascriptInterface` lo espone a ogni frame, quindi il FRAME PRINCIPALE è chiuso sulla
  webapp (`shouldOverrideUrlLoading`: un link fuori dalla webapp si apre nel browser del telefono); gli unici frame
  sono la webapp e il login integrato di Leghe. La risposta arriva solo al frame principale.
- **La rotazione non ricrea la WebView** (`configChanges` nel manifest): i token di lega stanno nel `sessionStorage`
  della pagina, che una WebView ricreata perderebbe. Il tasto Indietro percorre la cronologia della webapp.
- Senza rete apre l'ultima copia delle pagine (`LOAD_CACHE_ELSE_NETWORK`, permesso `ACCESS_NETWORK_STATE`); una
  pagina che non si apre lo dice a parole con «tocca per riprovare»; un **WebView troppo vecchio** per il bundle
  (sull'emulatore Android 11 il WebView 83 non lo analizza nemmeno: `SyntaxError`) lo dice col numero di versione e
  rimanda al Play Store, invece di una pagina bianca.
- Edge-to-edge (Android 15+ con targetSdk 35): la pagina è distanziata da barre di sistema, ritaglio e tastiera.

**Verificato (14/10/2026).**
- Webapp: 1536 test verdi (5 nuovi sul ponte in `leghe-api.spec.ts`; togliendo il ramo del ponte ne cadono 4);
  `e2e-lineup-offline.mjs --via-app` fa passare tutta la pagina Formazione da un finto ponte con lo stesso
  contratto - letture, drag & drop, salvataggio col corpo controllato - con 24 richieste dal ponte e 0
  dall'intermediario, e cade se la pagina ignora il ponte; senza `--via-app` resta verde.
- App, su un emulatore Android 11 (AVD `fa-test`, WebView 83) con una pagina di prova ES5 servita in locale (APK di
  prova con `usesCleartextTraffic`, mai nel manifest): ponte presente, user agent giusto, una GET vera a Leghe senza
  token torna 401 `ATH008` alla pagina (cioè niente CORS di mezzo), percorso/piattaforma/metodo fuori regola
  rifiutati con `APP403`; due rotazioni senza ricaricare la pagina (`sessionStorage` intatto); un link esterno apre
  Chrome e Indietro torna alla pagina com'era; la scorciatoia «Widget» della pressione lunga apre `WidgetActivity`
  anche se l'attività non è esportata.
- **NON verificato**: la webapp VERA dentro la WebView (il WebView 83 dell'emulatore non la esegue: sul telefono
  dell'operatore, Android 16, il WebView è aggiornato), il login integrato di Leghe dentro la WebView (cookie di terze
  parti accettati per quel frame, `setAcceptThirdPartyCookies`), il login EuroLeghe e il salvataggio veri.

**Limiti e cose da sapere.**
- **Serve pubblicare la webapp** (`npm run deploy:pages`): finché il sito non ha il codice del ponte, la Formazione
  dentro l'app dice «Manca l'intermediario». Il deploy va fatto dalla macchina col pacchetto più fresco: su
  WS-Clemente `app/public/data` è del 09/10 mentre il sito pubblica quello del 10/10, quindi pubblicare da lì
  riporterebbe indietro i dati.
- **I token muoiono col processo dell'app**: sono nel `sessionStorage` (scelta dell'08/10/2026), quindi quando Android
  chiude l'app in background serve rifare il login; le letture salvate restano visibili senza login.
- La firma: un APK compilato su una macchina diversa da quella dell'APK installato ha un'altra chiave debug e si
  installa solo disinstallando prima (§5 punto 8). Su WS-Clemente la chiave è nuova.
- `<input type="file">` dentro la WebView non apre nulla (nessun `onShowFileChooser`): le pagine che caricano un
  file (es. le rose esportate) vanno usate dal PC finché non serve.
- La pagina Formazione è disegnata per lo schermo del PC: la versione da telefono è il passo successivo, poi gli
  scambi.

## Le squadre del widget hanno un ID (19/10/2026)

Il foglio tiene le squadre per CHIAVE, e la chiave la manda la pagina Formazione. Fino al 16/10 era quella del login a
Leghe (`euro:<utente>:<lega>`), da allora è l'id della rosa caricata dal CSV (`formazione-leghe-v1.md` §4-undecies):
la stessa squadra reinviata è arrivata come seconda voce e il widget mostrava ogni uomo due volte. Il nome non decide
niente (una prima cura per nome è stata ritirata), e le voci dell'epoca del login si tolgono una volta lanciando
`widgetRemoveLoginTeams` dall'editor dell'Apps Script, che le riconosce dalla forma della chiave e scrive nel log cosa ha
tolto. Poi le squadre si reinviano dalla pagina.
