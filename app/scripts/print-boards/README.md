# print-boards — i campetti STAGIONE di tutti i club su UN A4 orizzontale

Un foglio da stampare e portare al tavolo: per ogni club il modulo e la formazione tipo, e per ogni
uomo (titolare o alternativo) ruolo classic, nome, quota da titolare, `Pv Mv Fm` della stagione
scorsa, gli ultimi quattro fantavoti col verso (entrato / uscito), il surplus e la max offerta.

**Nessun numero nasce qui.** Ogni cifra viene da dove è già decisa — il foglio, la board, i voti, la
plancia — e questi quattro script impaginano e basta. È la ragione per cui la max offerta si LEGGE
dalla pagina vera invece di essere ricalcolata: `offerBand` ha dieci ingressi (lo slot, la mediana del
blocco, il budget, la quota di calendario, la confidenza, lo sconto stesso-club, il tetto della
scommessa…) e riscriverli qui sarebbe un uomo con due prezzi.

## Come si rifà

Serve un `dist/` aggiornato (`npm run build` in `app/`) e un bundle fresco in `app/public/data/`
(`npm run data:pull`). Poi, **da dentro questa cartella**:

```sh
node collect-offers.mjs offers.json     # apre /plancia headless e legge le 249 max offerte
python build_pdf.py                     # unisce board + foglio + voti + infortuni -> rows.json
python render_html.py 5.0 5 campetti.html 1.12   # font pt, colonne, file, interlinea
node to_pdf.mjs campetti.html campetti.pdf --shot
```

L'ultimo passo STAMPA le misure che decidono se il foglio è buono: `pdfPages` deve essere 1,
`overflowRight` 0 e `clippedNames` 0. `--shot` lascia un PNG della pagina come sarà stampata;
`--zoom` lo rifà su un angolo a scala 9, che è l'unico modo di giudicare i triangolini.

Il PDF **non va messo nel repository**: `data/` non è ignorata per intero (l'ignore elenca `raw/`,
`export/`, `timepacks/`, `reports/`, `logs/` e i file db), il repo è pubblico e il foglio porta nomi,
voti e prezzi. Si consegna fuori — il Desktop dell'operatore.

## Le misure che hanno deciso la forma, per non rifarle

- **5,0pt · 5 colonne · interlinea 1,12** è il massimo che entra con tredici campi per riga. Il
  vincolo è la LARGHEZZA e non l'altezza: a 5,2pt si tagliano 6 nomi, a 5,4pt novantatré. Le colonne
  numeriche sono in `em` proprio per questo — in `mm` non scalerebbero col corpo.
- **Una riga per uomo, dedotta per club**: il toolkit elenca lo stesso rivale su più posti, quindi
  628 voci diventano **422 righe** (18-24 per club).
- **I campetti sono SCRITTI e non disegnati**: 422 righe × 13 campi non stanno in venti campi da
  calcio su un A4. Quello che resta del campetto è l'ordine — porta → attacco, e dentro la linea da
  sinistra a destra secondo la `x` che la board assegna.
- **Le offerte si leggono a TAVOLO VUOTO** (il default della plancia dal 23/09/2026): lì la colonna
  è la max offerta per tutti, mentre su un tavolo giocato porta il prezzo PAGATO sulle righe di
  qualcuno, che è un altro numero. 232 dei 422 hanno la cifra della mappa; 183 sono in coda (fuori
  dai 250 slot) e la plancia lì offre il minimo, scritto `1` in grigio; 7 non sono quotati e leggono
  `–`.
- **Il join per nome è esatto QUI e lo è perché è stato misurato**: zero omonimi nel listone Serie A
  e fra i 422 della board, e i 249 nomi della plancia sono tutti `canonical_name`. La controprova che
  conta è dal lato dello schermo: zero righe marcate a un credito che la plancia prezza diversamente.
- **«Uscito» è `< 90'`** e non una soglia scelta: la fonte tronca i recuperi e il massimo misurato
  per un titolare è esattamente 90. `started` viene dal livello per-partita perché nel bundle
  `match_ratings.started` è NULL su tutte le righe.
- **Il verso sta DOPO il voto e in apice**: davanti, un triangolo piccolo si legge come un segno meno
  (visto ingrandendo, non ragionando).
- **Il surplus è riportato su stagione piena** (×38/33), come fa `core/season-scale.ts`: il foglio
  prevede le giornate che restano e le pagine leggono sulla stagione.

## Due difetti che questa catena ha già pagato

- **Il calendario nomina i club per CHIAVE** (`parma`) e la board per NOME (`Parma`): unendoli per
  nome, la guardia «ha già rigiocato» rispondeva `None` su tutti e venti i club, cioè era spenta in
  silenzio. Il ponte si prende dalla coppia `(key, name)` che il calendario stesso dichiara, e lo
  script ORA si ferma con un errore se un club non aggancia.
- **Lo stesso match arriva da due sorgenti** (`sofascore` e `sofascore_recent`): senza deduplicare
  per `match_id`, Sugawara leggeva 51 partite di Bundesliga su 32 giocate — e il doppio conteggio
  pesava anche nelle medie, dove nessun totale impossibile lo avrebbe tradito.
