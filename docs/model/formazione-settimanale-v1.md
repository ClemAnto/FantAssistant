# Formazione settimanale — chi gioca davvero, e da dove lo sappiamo (v1, progetto)

**Stato: PROGETTO, nessuna riga di codice.** Nasce da un'indicazione dell'operatore del 7 agosto 2026:
«quando dovremo valutare la formazione fanta da schierare e quindi sarà fondamentale sapere se un calciatore
gioca o meno, piuttosto di consultare la pagina web sulle probabili formazioni, conviene fare una ricerca
approfondita sui quotidiani o siti locali/nazionali giocatore per giocatore».

Questo documento serve a non perdere l'indicazione e a fissare i vincoli **prima** di scrivere codice. Non è
la fase d'asta: là la domanda è quanto vale un calciatore per una stagione, qui è se gioca **domenica**.

## Perché la pagina delle probabili non basta, misurato e non supposto

1. **È inaffidabile per giudizio dell'operatore**, ed è la ragione per cui esiste questo documento.
2. **È inaffidabile anche in un modo peggiore, che abbiamo misurato**: fino al 04/08/2026 la pagina Serie A
   serviva l'ultima giornata del **2025-26** — 810 href, tutti `2025-26`, con probabilità **1.0**, cioè
   formazioni già GIOCATE. Su un foglio 2026-27 quelle righe erano la cosa più fresca disponibile: 428 su 648
   `desc_starter_prob`, 415 duelli, 442 asserzioni di rosa. Curato con `probable_starter.season` (spec «Novità
   v9.32»), ma la lezione resta: **una fonte editoriale può essere corrente e parlare d'altro.**
3. **Aggiunge tardi ciò che aggiunge**: quello che non possiamo calcolare arriva dalle parole
   dell'allenatore, in conferenza, il giorno prima. Una lettura utile è quindi **vicina al calcio d'inizio**,
   e una storicizzazione non serve a niente (le probabili sono uno dei tre fatti non backfillabili).

Le pagine EuroLeghe (`probabili_euro`, `indisponibili_euro`) sono ora catturate ogni giorno — servono comunque
come rete, e oggi sono vuote — ma restano `desc_*`: nessuna regola le legge.

## Cosa deve fare la ricerca per giocatore, e cosa NON deve fare

**Deve** cercare ciò che il toolkit non calcola:
- le **parole dell'allenatore** (conferenza, rifinitura, «recuperato/non convocato»);
- la **condizione tardiva** (affaticamento, rientro da infortunio, provino del sabato);
- le **voci di mercato** in corso, che tolgono un uomo dalla lista dei convocati prima di ogni referto.

**Non deve** ricalcolare ciò che è già misurato — minuti, titolarità sul campionato, duelli per ruolo reale,
infortuni datati, forma del club sulle ultime dieci. Un articolo che «conferma» un dato che abbiamo lo
peggiora: aggiunge rumore con l'aria dell'evidenza.

## Vincoli che valgono già oggi, perché il progetto li ha già pagati altrove

- **Datare con l'ORA, non col giorno.** `valid_from` e i file di cache delle probabili sono per-giorno, quindi
  due letture nello stesso giorno si sovrascrivono e un match delle 20:45 leggerebbe lo stato delle 15:00.
  Una serie pre-partita ha senso solo con l'ora.
- **Dire di quale PARTITA e di quale stagione si parla**, non solo quando si è letto (§ sopra).
- **Fonte per affermazione.** Ogni riga porta la sua URL e la sua data: una previsione senza provenienza non è
  verificabile a posteriori, e qui non esiste un gate che possa smentirla fuori campione.
- **Resta `desc_*`.** Non è gatabile: non c'è storia, e non ci sarà mai per il passato. Quindi entra come
  descrizione al servizio della decisione dell'operatore, mai come regola del motore né come peso.
- **Vuoto = ignoto.** «Nessuna notizia su questo giocatore» non è «gioca» e non è «non gioca».

## Forma tecnica probabile (da decidere quando si farà)

È un lavoro di **ricerca e lettura**, non uno scraper: query per giocatore, ristrette alle testate che seguono
quel club, con lettura e sintesi. Quindi è un agente, non un parser — e il costo cresce col numero di uomini,
non col numero di club: la rosa fanta (~25) e non il perimetro (~1000). Il posto naturale in cui salvarlo è
una tabella datata sul modello di `probable_starter`, con l'ora e la fonte, e il consumo è la vista
settimanale dell'assistente (`assistente-asta-v1.md` è la fase d'asta: questa è l'altra).

Nessuna scadenza: prima serve la stagione avviata, perché una ricerca sulla formazione di una giornata che non
esiste ancora non ha niente da leggere.
