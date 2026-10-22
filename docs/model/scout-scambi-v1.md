# Scout scambi — v1 (22/10/2026)

La pagina `/scout` dell'app (`app/src/app/views/scout/`, aritmetica in `app/src/app/core/scout.ts`) propone gli
scambi con le altre squadre della lega. Le rose sono quelle caricate per la pagina Formazione (`core/roster-file.ts`):
l'export della lega contiene TUTTE le squadre. Ogni calciatore è prezzato come in ogni altra pagina: la fantamedia
del foglio e le presenze attese di `ExpectedPlay`. Nessun numero del motore si muove, nessun gate è coinvolto:
è una pagina di REPORTING e di decisione, costruita in una sessione di correzioni dell'operatore su nomi veri.

## 1. La forza di una rosa

`strengthOf`: miglior undici legale sul regolamento (classic o mantra, `mantra-legal.bestEleven`) pesato su
fantamedia × presenze, più i RICAMBI (ogni posto riceve al più una riserva della panchina che può occuparlo, e conta
la sua fantamedia nelle giornate in cui il titolare manca). In punti A GIORNATA, sulle giornate che restano.

Ma **i guadagni di uno scambio si misurano sul solo undici** (`.starters`): l'operatore ha chiesto il
«miglioramento immediato», e il contributo dei ricambi aveva fatto apparire buono per loro uno scambio (Guler per
Chabot) che sul solo undici li faceva perdere 0,33 a giornata.

## 2. Le regole di uno scambio (tutte VINCOLI, mai pesi)

Ciascuna nata da una correzione dell'operatore su un caso concreto:

| Regola | Costante | Caso che l'ha prodotta |
|---|---|---|
| Chi DAI è cedibile: fuori dal tuo undici, o titolare con una riserva del suo ruolo base che vale ≥ 3/4 di lui e la cui uscita costa ≤ 1/4 | `REPLACEABLE_SHARE` 0,25 | «partire da forti poco schierati»; Kane non è cedibile dietro Romulo |
| Chi RICEVI è migliore di un TUO titolare che RESTA, in un posto che può occupare | `MIN_GAIN` 0,1 | Semenyo confrontato con Barnes, cioè col calciatore che davi |
| Chi DAI è migliore di un LORO titolare in un posto che può occupare | `MIN_GAIN` | la regola originale del 1x1 |
| Entrambi gli UNDICI migliorano di almeno +0,1, contando chi arriva E chi parte | `MIN_GAIN` | Cunha per Marmoush (loro perdevano), Rice per Stiller (perdevi tu) |
| I due guadagni sono paragonabili (nessuno oltre il doppio) | `BALANCE_RATIO` 0,5 | Yamal per Rice |
| I due calciatori valgono più o meno lo stesso (il minore ≥ 80% del maggiore) | `VALUE_RATIO` 0,8 | Olise (7,82) per Baku (5,13): erano entrambi `super` nel proprio ruolo |
| Un supertop solo per un supertop | `SUPER` | «nessuno si toglie un supertop se non per un altro» |
| La FORMA: media voto ultime 5 di chi offri meno quella di chi chiedi ≥ −0,25 | `FORM_TOLERANCE` | Ezzalzouli, barrette tutte azzurre: «impossibile convincerlo» |
| Quote di rosa: classic 3/8/8/6, mantra i 3 portieri | `CLASSIC_QUOTAS` | — |

**Un filtro sulla CATEGORIA è stato provato e tolto la sera stessa**: era nato per Gvardiol (`top`) contro Veiga
(`scarto`), ma la causa vera era il bug delle 2 giornate (§5); intanto nascondeva gli scambi giusti, perché la
categoria si misura sulle sbarre del ruolo BASE (Pedro Neto, W/A con fantamedia 7,08, è `scarto` fra gli attaccanti).
«Una parola costruita per un'altra domanda non è una guardia su questa.»

## 3. Il 2x2 (`pairSwaps`)

Stesse regole sulle COPPIE (somme per il valore, conteggio dei super), più due:
- **non è un 1x1 con un passeggero**: se uno dei quattro 1x1 interni dà già tanto (entro `PAIR_EXTRA` 0,05 sul
  minore dei due guadagni), si propone il 1x1;
- **ogni calciatore scambiato entra o esce da un undici**: la prima corsa elencava «Ezzalzouli + Sorloth, + Eze…»,
  riserve che non spostavano niente.

Ricerca a fascio (`PAIR_BEAM` 12): ogni 1x1 che migliora il NOSTRO undici, poi un uomo in più per parte, con il
secondo preso fra i loro titolari o chi migliora noi. ~7-8 s su 12 squadre, in fette con la barra.
L'ultima ricerca si salva per fantasquadra (`localStorage` `scout.pairs`, per id) e torna al refresh; la forma si
ricalcola su quella di oggi e le righe diventate impossibili escono.

## 4. Come si legge

- Una riga per scambio: **«chi dai × chi ricevi»**, guadagno per te e per loro, forma, FVM. Raggruppate per squadra
  e per obiettivo (il calciatore più forte che ricevi); in un'offerta nessun calciatore compare due volte su righe
  diverse (`groupTrades`).
- Ordine: **Fattibili** (forma, di default) o **Guadagno** (il minore dei due).
- **«+ dettagli»** apre la tabella a quattro lati: MIEI a sinistra, SUOI a destra, una riga per sostituzione
  («— meglio di →» / «← meglio di —», «al posto di» se non è vero, «in panchina» se chi arriva non entra
  nell'undici), con FM/MV/Pv delle due stagioni (righe del gioco, corsivo se ricostruite), il gradino della
  STAMPA (asterisco = nostro foglio) e le barrette del trend. Linee verticali fra le stagioni.
- Colonna sinistra: «Forti ma poco schierati» (resa da titolare / valore oggi per la rosa) e «Titolari con riserva
  all'altezza». Sotto: per ogni rivale le riserve che ci servono e i «buchi» (posti sotto la mediana di lega).

## 5. Il bug trovato dallo Scout: le presenze su 2 giornate

`features.target_matchdays` leggeva il conteggio delle giornate IN ARCHIVIO come il totale della stagione: alla 7a
di Serie A, con le date per-partita ferme alla 5a (SofaScore 403 dal 24/09), il bersaglio era 7 − 5 = **2** su tutti
e tre i fogli, e ogni `engine_pv_pred` una previsione su due giornate arrotondata a un decimale e poi riportata su
38 (passi del 5% di stagione). Curato il 22/10/2026:
- una stagione con meno dell'80% delle giornate della precedente è IN CORSO e il suo totale è quello della
  precedente (`IN_PROGRESS_SHARE`; le stagioni complete differiscono di al più 2 giornate, quindi il gate non cambia);
- `matchday_dates` ripiega sulle date programmate di `fixtures` per le giornate che il livello per-partita non porta.
Effetto: Serie A 31 giornate da prevedere (7 viste), EuroLeghe 25 (6 viste). `backtest --verify` 22/22, test
toolkit 1042 verdi, fogli + export + `data:pull` rifatti il 22/10 sera. **Non pubblicato su Pages.**

## 6. Aperti

- Pubblicare (`npm run deploy:pages`) l'app con lo Scout e i dati rigenerati: decisione dell'operatore.
- Le soglie `FORM_TOLERANCE` (−0,25), `VALUE_RATIO` (0,8), `BALANCE_RATIO` (0,5) sono scelte DICHIARATE, non misure.
- Nel 2x2 le varianti con la stessa coppia data e un secondo ricevuto diverso sono ancora molte (es. «Anton + Maguire
  × Stiller + …»): il nucleo comune non le fonde.
- La ricerca 2x2 dura ~8 s nel browser; 3x3 non è esposto (il codice `searchTrades` resta).
- Banco: `node app/scripts/e2e-scout.mjs <export.csv> <squadra> [classic|mantra] [classic|euro]`.
