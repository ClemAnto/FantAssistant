# Widget Android «FantAssistant Partite» — stato e roadmap (v1, 10/10/2026)

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
     «Intervallo» / «Finale» / «Annullata», `league`, `players`, `homePlayers`, `awayPlayers`, `url`, `state`
     pre|live|done), più `text`/`textShort` e `rich`/`richShort` (tag Kustom, per KWGT);
   - serve `?what=widgetPage`: la stessa lista come pagina HTML (link `target="_top"` a SofaScore, casella
     «calciatori»). Era il ripiego per KWGT; resta disponibile.
   - minuto: `(now − time.currentPeriodStartTimestamp + time.initial)/60 + 1`, «limite+N'» oltre `time.max`.
   - link: `https://www.sofascore.com/football/match/{slug}/{customId}#id:{id}`.
4. **COME si vede** — `android/` (app Java, nessuna dipendenza esterna). Vedi §2.

## 2. L'app Android (`android/`)

- Build: `cd android; $env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"; .\gradlew.bat assembleDebug`
  → `app/build/outputs/apk/debug/app-debug.apk`. AGP 9.4.1, Gradle 9.8.0 (wrapper), compileSdk/targetSdk 35,
  minSdk 26. `local.properties` punta all'SDK locale ed è gitignorato.
- Classi (`it.fantassistant.widget`):
  - `MatchesWidget` (AppWidgetProvider): header «Partite», «agg. hh:mm» (ora in cui il FOGLIO ha costruito la
    lista, con «!» se l'ultima lettura è fallita), bottone **Nomi ✓/Nomi** (toggle), **↻** (rileggi ora),
    `ListView` scorrevole;
  - `MatchesListService`: le righe (bordo rosa e minuto rosa se live, nomi nascosti dal toggle);
  - `Refresher`: GET con 3 tentativi (il secondo salto di Apps Script fallisce da sé ogni tanto), catena di
    allarmi inesatti non-wakeup: **5' se c'è una partita live**, fino al prossimo calcio d'inizio se è entro 30',
    altrimenti 30'; `updatePeriodMillis` 30' come rete di sicurezza;
  - `OpenActivity`: trampolino del tocco su una riga. **Necessario**: da Android 14 un PendingIntent MUTABLE con
    intent implicito è vietato (crash misurato sull'emulatore), quindi il template è esplicito verso questa
    activity che apre il link;
  - `MainActivity`: istruzioni, indirizzo del foglio modificabile, «Salva e aggiorna», «Aggiungi il widget alla
    home» (`requestPinAppWidget`), stato dell'ultima lettura;
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
4. **Densità delle righe**: oggi ~6 righe visibili su un 4×3; valutare campionato sulla stessa riga del titolo,
   righe più basse, o un layout compatto opzionale.
5. **Anteprima nel selettore widget** (`previewLayout`/`previewImage`): oggi mostra l'icona.
6. **Più fantasquadre**: il foglio unisce già le squadre inviate (chiave = lega); il widget non dice di quale
   fantasquadra è ogni calciatore. Eventuale etichetta o filtro.
7. **Firma release**: oggi APK debug. Per aggiornamenti senza disinstallare serve sempre la stessa chiave: la
   debug key di questo PC va bene finché si compila qui; altrimenti creare un keystore (fuori dal repo).
8. **Badge/stemmi** dei club nelle righe (SofaScore serve `/team/{id}/image`) — solo se la densità lo permette.
9. **Gol dei miei calciatori** nella riga (incidents dell'evento) — costo: una richiesta in più per partita live.

## 6. Trappole incontrate (da non ripetere)

- La distribuzione Apps Script congela il codice: «Funzione script non trovata: doPost» = versione vecchia online.
- Un PendingIntent mutabile implicito crasha su Android 14+ (vedi `OpenActivity`).
- `local.properties` su Windows vuole i backslash raddoppiati (`C\:\\Users\\...`), altrimenti
  «La sintassi del nome del file ... non è corretta».
- Uno screenshot headless stretto (Edge a 412 px) non è affidabile per verificare il layout mobile.
- `cat > file` senza heredoc in un comando Bash resta in attesa di stdin e blocca la corsa.
