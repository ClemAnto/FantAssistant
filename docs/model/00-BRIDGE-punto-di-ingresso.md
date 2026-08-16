# 00 — BRIDGE · Punto d'ingresso del progetto (leggere per primo)
**Aggiornato: 16 agosto 2026, sera tardi (i DUE ZERI sul foglio e in tabella — `SHEET_REVISION` 22, colonna «Margine» accanto a «Surplus» — e i posti schierati contati dal regolamento)** · precedente: 16 agosto 2026 (le CINQUE LETTURE dell'app con un documento proprio, lo zero che diventa il rimpiazzo che ENTRA, due dati nuovi — porte inviolate e curva del valore — e tre ipotesi rifiutate dalla misura; v0.1.11)** · precedente: 14 agosto 2026, notte (il TREND delle ultime dieci, CHI HA GUADAGNATO IL POSTO, «preso per titolare ruotato di fatto» e il suo SPECCHIO: item 5, 6, 7 e 8 chiusi lo stesso giorno)** · precedente: 10 agosto, notte tarda (la todolist del draft ESEGUITA, il campetto legge la board del toolkit ed e' rifinito, v0.1.8 pushata)** · precedente: 10 agosto, giorno (l'assistente d'asta e' completo — porte, surplus vivo, scelta consigliata — e la campagna sulle strategie di draft ha RITIRATO due conclusioni)** · precedente: 9 agosto (l'app esiste: Angular, pubblicata su GitHub Pages, legge il bundle del toolkit)** · 8 agosto (DUE GIUDICI per le formazioni tipo — la stampa e l'ESITO reale — e la todolist formazioni tipo chiusa: cinque adozioni, sei rifiuti misurati)** · Questo file inizializza qualsiasi sessione/strumento nuovo. Il prefisso "00" lo tiene in cima alla cartella.

## Il progetto in breve
Motore previsionale per fantacalcio **EuroLeghe** (fantacalcio.it): valutazione calciatori Classic e Mantra sui 5 grandi campionati europei (Serie A, Premier, Liga, Bundesliga, Ligue 1 — perimetro: i ~35 top club del gioco). Prevede fantamedia (FM), presenze attese e VALORE stagionale = FM × presenze. Metodo scientifico: **ogni regola entra nel motore solo se batte il baseline fuori campione su finestre indipendenti** (gate pre-registrato). Stato: core validato (Mantra, Classic, portieri, presenze); manca lo strato flag/arrivi, sbloccato dal toolkit dati `euroleghe-ingest` (in implementazione).

## Casa dei documenti: GIT (non più Drive)
La knowledge base è ora nel repo git **`FantAssistant`**, cartella **`docs/model/`** (italiano, casa canonica; git gestisce il versioning). La cartella Drive "Modello Previsionale Fantacalcio" resta come **mirror/archivio** e ospita i **dataset** (xlsx/csv, non in git); c'è un marker `00-MOVED-TO-GIT.md`. Mappa ID Drive in `docs/DRIVE-MANIFEST.md`.

| Sorgente | Ruolo | Affidabilità |
|---|---|---|
| **git `docs/model/`** | FONTE DI VERITÀ: documenti consolidati, decisioni, ipotesi respinte/pre-registrate | Permanente, versionata |
| **GitHub `ClemAnto/FantAssistant`** | remote `origin` (repo **pubblico**), branch `master` | Copia remota della verità |
| **Drive (cartella progetto)** | Archivio/mirror + dataset (xlsx/csv) | Non più aggiornato (solo su richiesta esplicita) |
| **Memoria Claude del progetto** | Riassunto automatico per ripartire in fretta | Cache: comoda ma MAI fonte di verità |
| **Credenziali fantacalcio.it** | Solo in `.env` locale | MAI su Drive/chat/repo/log |

## Ordine di lettura per una nuova sessione
`00-BRIDGE` (questo) → `stato-progetto-continuita-v5.md` → `todolist-mantra-euroleghe-v5.md` →
**`gate-motore-v1.md`** (protocollo del gate, verdetti, ipotesi falsificate: leggerlo prima di
proporre qualsiasi regola) → **`metrica-asta-surplus-v1.md`** (con cosa il pannello ordina, e perché non
è VALORE) → **`letture-app-v1.md`** (le cinque colonne 0-99 della consultazione: reporting, senza gate,
ogni soglia misurata — e le alternative RIFIUTATE coi loro numeri, che è la parte che fa risparmiare una
serata) → **`assistente-asta-v1.md`** (cosa l'assistente fa al tavolo: tre domande, tre numeri, e le
regole di UI che sono requisiti) → **`todolist-draft-v1.md`** (il piano per i suggerimenti del draft e per le
formule di valore/surplus, nato dalla campagna a cinque finestre del 10/08/2026, ordinato per resa misurata:
leggerlo prima di riproporre una strategia) → `spec-euroleghe-ingest-v9.md` → `nota-modello-set-pieces-v2.md` →
`modello-previsionale-v3.8.md` → consolidati di dettaglio. Tutti in `docs/model/`.
Per la BOARD (formazioni tipo): **`formazioni-tipo-v1.md`** (come nasce: modulo, claim, fit — formule e
costanti) e **`todolist-formazioni-tipo-v1.md`** (il piano per renderle più veritiere, nato dal confronto
con la stampa dell'08/08/2026, ordinato per resa misurata).
L'altra fase, quella settimanale, è **`formazione-settimanale-v1.md`** (progetto): chi gioca domenica, perché
la pagina delle probabili non basta e quali vincoli valgono già oggi.

## STATO AL 16 AGOSTO 2026, SERA — LEGGI QUESTO PRIMA DI TUTTO

Le sezioni sotto sono un **registro cronologico**: dove una contraddice questo blocco, vince questo.

**La SERA TARDI del 16/08, in tre righe.** I due zeri sono sul foglio e in tabella (blocco qui sotto):
`SHEET_REVISION` **22**, toolkit **414 test**, app **263**, `backtest --verify` **22/22** — non si muove
un decimale di quello che è gated, perché la seconda colonna nasce reporting. Resta aperto il prior
personale del pannello a stagione iniziata, poi la tendenza della curva del valore.

**Il pomeriggio del 16/08 in cinque righe.** Dieci commit, **v0.1.13 pubblicata**, e tre voci del gate
mosse: due CHIUSE con un no e una aperta che vale un ordine di grandezza più di qualunque canale
adottato. Toolkit **411 test**, app **261**, `backtest --verify` **22/22** — nessun numero pubblicato si
muove. La curva del valore è acquisita per intero (**3.323 quotati, 85.061 punti**), il surplus in
crediti è uscito dal pannello ed è sul foglio (`SHEET_REVISION` **20**), e l'app ha un **viaggio nel
tempo** con quattro date che retrodatano anche il motore.

**Le tre voci del gate, in ordine di quanto pesano.**
1. **R20 — le giornate già giocate entrano nelle presenze attese** (§7-duotricies): pre-registrata,
   harness in-season costruito, misurata e **ADOTTATA con un K per PIATTAFORMA — `R20K10` su
   `default`, `R20K6` su `euro`**. L'accuratezza è unanime (3/3 finestre su ogni punto e ogni regime,
   da +3,8% a +29,2%); a dividersi sono le guardie, e quella che morde è sempre quella sui NOMI in
   cima, che è un conteggio su dieci. Su euro il 6 le supera tutte e il 10 perde una posizione in una
   finestra di tre; su Serie A è l'opposto — quindi l'evidenza è per piattaforma e lo è l'adozione,
   come già per R19. **Non muove un decimale di quello che esiste**: la regola è inerte a zero giornate
   viste, `--verify` resta 22/22 e i fogli d'agosto sono identici; si muovono i quattro pacchetti del
   viaggio nel tempo, e per quello `SHEET_REVISION` è 21 e **v0.1.14 è pubblicata**.
   Lungo la strada un difetto dell'attrezzo che vale oltre R20: **una soglia di scoring è una QUOTA del
   calendario previsto, non un numero**. `MIN_PV_ACT` = 15 è il 39% di una stagione da 38; su una
   finestra in-season ne restano quattordici, quindi era irraggiungibile e la guardia sulla fantamedia
   **smetteva di misurare** invece di fallire — col gate che contava «non verificata» come «peggiorata»
   e bocciava una regola da +23,7% (`evaluate.scoring_floor`).
2. **Il canale dell'investimento con l'input riparato** (§7-untricies): **no**. Serie A +0,26% con
   ottimo interno e ogni fold positivo, sotto il pavimento dello 0,5%; la forma condizionale adesso
   COSTA. Chiude la voce «sistemare l'input prima di toccare il peso», aperta da agosto.
3. **La griglia allargata del canale rientro** (§7-tricies): **no, e per sempre**. L'ottimo scappa al
   bordo anche a 240 giorni, e a quella distanza il canale compra la storia infortuni che
   `injury_weights` legge già (giornate perse in mediana: 12,9 chi rientra entro 120 giorni, 1,9 chi
   oltre 240).

**La lezione della giornata, e ricorre tre volte:** *il POOL decide metà del numero.* La copertura della
curva sembrava un dato e era un **filtro di sopravvivenza** (7% su Tm7, 60% su T2, e la mancanza
correlata con l'esito da predire); il colore delle celle misurato sulle righe a schermo avrebbe detto «il
migliore di questi ventisei»; e la stima di fattibilità di R20 dava **+42%** su chiunque avesse una
stagione precedente contro **+24,8%** sul listone. Ogni volta la correzione ha tolto fra il 40% e il 100%
del risultato apparente.

**I DUE ZERI SONO SUL FOGLIO** (16/08 sera tardi, metrica **§21.3**, spec «Novità v9.55»).
`desc_replacement_fielded` e `desc_surplus_fielded`, `SHEET_REVISION` **22**, `engine_*` invariato
(`--verify` 22/22), toolkit **414 test**, app **263**, in tabella la colonna **«Margine»** accanto a
«Surplus». Tre cose da sapere prima di rileggerle:
1. **i posti si CONTANO dal regolamento** (`features.fielded_places`, un solo lettore per i due file):
   classic riproduce P 1 · D 4 · C 4 · A 2, mantra dà i dodici codici, e **tutt'e due sommano 11** —
   che è il test, la stessa verifica di trascrizione che i due file fanno su sé stessi;
2. **la pool è quella dello zero gated** (undici stagioni, non l'ultima), perché si muove UNA variabile:
   la profondità. Conseguenza da non scoprire per caso: i primi 25 cambiano **più** del preventivo di
   §21 (P3 D8 C11 A3 e 7 nomi in comune, contro P3 D5 C8 A9 e 13) e la differenza è tutta l'attacco,
   6,99 in pool contro 6,71 nel 2025-26. Sulla SINGOLA stagione il conto riproduce la simulazione
   dell'app al secondo decimale, che era la verifica promessa;
3. **lo slot si decide una volta sola**: lasciando riscegliere la cascata, al secondo zero tutti i
   `dd`/`ds` dei fogli mantra passano nella lista dei `dc`, e la riga dichiarerebbe uno slot portando il
   livello di un altro. I quattro pacchetti del viaggio nel tempo sono stati ricostruiti, o l'export li
   saltava per colonne mancanti — che è il contratto che fa il suo mestiere.

**I DUE ZERI del foglio, misurati e con un progetto deciso** (metrica §21, §21.1, §21.2). Il surplus
conta dal marginale di ROSA e i primi 25 del foglio sono **P5 D1 C0 A19** — diciannove attaccanti e zero
centrocampisti — mentre col rimpiazzo che ENTRA diventano P3 D5 C8 A9, con solo 13 nomi su 25 in comune.
E il caso che l'operatore aveva chiuso non si riapre (Simeone 7°→23°, Esposito F.P. 20°→57°: restano
nell'ordine giusto). **Deciso di averle tutt'e due**: `engine_surplus` non si tocca perché è gated, la
seconda nasce REPORTING col suo zero dichiarato in cella, si sceglie solo per quale si ORDINA e le
statistiche del blocco seguono. Il toggle NON si chiama «rilanci/draft»: quella è la MONETA e ha già una
misura, A/B è «rispetto a chi misuri» ed è un'altra domanda. La ricetta tecnica è in §21.2.

**E una premessa mia che era sbagliata, verificata chiamando il codice**: il pannello le giornate giocate
**le legge già** (su un foglio in-season `measured_season` sposta tutti gli strati sulla stagione in
corso: mediana 15 partite misurate al 5 febbraio). Il difetto vero è più piccolo — a stagione iniziata
butta via la stagione precedente e restringe verso la media di POPOLAZIONE invece che verso il prior di
quell'uomo — e giudicarlo costa finestre in-season anche nello sweep, non «una riga di griglia» come
avevo stimato.

**Cosa resta aperto**, in ordine: il **prior personale** del pannello a stagione iniziata; la TENDENZA della curva
del valore, acquisita e non letta da nessuno; i minuti per competizione e in nazionale (muro di consenso
su Transfermarkt) e le coppe da Sofascore (403).

**Dove siamo, in cinque righe.** La giornata del 15-16/08 è stata quasi tutta **sull'app**: la tabella di
consultazione ha ora **cinque letture 0-99** con un documento proprio,
[letture-app-v1.md](letture-app-v1.md), che è dove va guardato prima di toccarle. `engine_*` invariato
(`backtest --verify` **22/22**), **407 test toolkit + 248 app**, **v0.1.11 pubblicata** con bundle reale.
Due dati NUOVI in casa: `season_stats.clean_sheets` (970 stagioni-portiere, 4.872 porte inviolate) e
`market_value_history` (**1.055 quotati, 22.269 punti** dal 2005, la CURVA del valore e non un punto per
stagione). Un canale pre-registrato e **rifiutato** (§7-tricies del gate). E un difetto di identità curato
che toccava il tavolo: **28 id Transfermarkt di omonimi scartati, 3.951 giorni di infortunio tolti a chi
non li aveva**.

**Le quattro decisioni sull'Overall**, tutte misurate e tutte in `letture-app-v1.md`:
1. la **costanza** è centrata sul RUOLO e non sul listone (mediane 0,86 / 0,65 / 0,61 / 0,57: il centro
   unico regalava +0,11 di fantamedia a ogni portiere per il fatto di essere un portiere) e pesa 2;
2. i **ruoli sono allineati** con uno z dentro il ruolo classificato su tutto il listone — e la
   standardizzazione è a **mediana e MAD**, perché con lo zero nuovo le distribuzioni si sbilanciano;
3. la base è **`FM att.`** e non la fantamedia di carriera (caso Gila: 45 → 55);
4. lo zero è il **rimpiazzo che ENTRA** e non il marginale di rosa — misurato per due strade
   indipendenti (P 5,01/5,03 · D 6,11/5,81 · C 6,37/6,30 · A 6,79/6,87 contro 4,13/5,66/5,87/5,61 del
   foglio) e derivato dalla pool, non incollato.

**Tre cose rifiutate dalla misura**, e vanno lette prima di riproporle: la porta inviolata come merito
dell'**allenatore** (scarto 0,155 contro un null di 0,094); il **calo di FM dopo un lungo infortunio**
(−0,034 di eccesso su 310 rientri, mediana 0,000 — Chiesa e De Bruyne sono la coda); la **recenza del
rientro** sulle presenze (robust su euro ma al BORDO della griglia, e negativa su `default`, che è la
piattaforma del caso che l'ha generata).

⚠️ **Un numero RITIRATO il 16/08**: il confronto delle board con l'articolo Transfermarkt del 14/08 (7/20,
e i due giudici 7/20 fra loro). Verificato scaricando la pagina: **non contiene i moduli**, e l'elenco su
cui i conti erano fatti veniva dal riassunto automatico del fetch, che li aveva *dedotti*. Quello che la
pagina porta davvero — ballottaggi, rigoristi, giocatori in bilico — è un giudice diverso e ancora da
archiviare.

**Cosa resta aperto**, in ordine di quanto costa: il SURPLUS del foglio usa ancora il marginale di rosa e
quindi **sopravvaluta di mezzo punto** quello che un giocatore aggiunge (è lavoro di motore su dieci
finestre); l'item **4.5** (`engine_pv_pred` deve leggere le giornate giocate se l'asta è a stagione
iniziata: +0,443, il segnale più grosso della campagna draft); i minuti per competizione e in nazionale,
**bloccati da un muro di consenso** su Transfermarkt (il valore invece passa da un endpoint JSON); le
coppe da Sofascore, **403 da tutti gli endpoint**; la TENDENZA della curva del valore, che è acquisita e
non la legge ancora nessuno.
**Due voci si sono CHIUSE il pomeriggio del 16/08, e tutte e due con un no**: il canale
dell'investimento con l'input riparato (gate §7-untricies: Serie A +0,26% con ottimo interno e ogni fold
positivo, sotto il pavimento dello 0,5%; la forma condizionale adesso COSTA) e la griglia allargata del
rientro (§7-tricies: l'ottimo scappa al bordo anche a 240 giorni, e a quella distanza il canale sta
comprando la storia infortuni che `injury_weights` legge già — mediana delle giornate perse 12,9 contro
1,9 fra chi rientra entro 120 giorni e chi oltre 240).

**Dove siamo, in cinque righe.** Il 14/08 ha chiuso **quattro item in un giorno** (5, 6, 7, 8 di
`todolist-draft-v1.md`): il TREND delle ultime dieci REALI col giudizio 0-99, chi ha guadagnato o perso
il posto col controllo sul reparto, «preso per titolare ruotato di fatto» e il suo specchio. Sono
**tutti reporting** — `engine_*` non è stato toccato e `backtest --verify` è 22/22 — e `SHEET_REVISION`
è passato da **15 a 17**, quindi ogni cartella di foglio precedente è da ricostruire. Toolkit **388
test**, app **162**, **v0.1.10 pubblicata** con bundle reale. **Cosa resta aperto**: item **4.5** (se
l'asta è a stagione iniziata `engine_pv_pred` deve leggere le giornate giocate — tocca il motore, quindi
GATE), poi **1.5b**, **2.2**, **2.3**.

**La lezione della giornata, che vale più dei quattro item**: **tre volte su tre il numero è cambiato
cambiando il NULL**, e ogni volta verso il basso — il pool degli screen del mattino (5-10x → 1,0-2,4x),
il denominatore dello screen di rotazione (2,42x → 1,52x), la definizione di esito dello specchio (base
dal 22% al 41%). Due di quelle tre volte il difetto era una misura fatta su una **reimplementazione**
invece che sulla funzione che spedisce. Regole nuove nel `CLAUDE.md` di radice.

### ULTIMO IN ORDINE DI TEMPO — 16/08/2026, pomeriggio e sera: il viaggio nel tempo, e tre voci del gate

Dieci commit (`f46dc28` → `d4b213f`), **v0.1.12 e v0.1.13 pubblicate**. Dettaglio nel gate
**§7-untricies**, **§7-tricies** (follow-up) e **§7-duotricies**, in [letture-app-v1.md](letture-app-v1.md)
§4-ter/§4-quater/§4-quinquies e in spec «Novità v9.54».

1. **La curva del valore acquisita per intero e collegata**. Il perimetro «quotati di oggi» era un
   **filtro di sopravvivenza** — copriva il 7% dei quotati di Tm7 e il 60% di quelli di T2, con la
   mancanza correlata all'esito da predire — quindi `market --all-seasons`: 2.200 curve in più, 61.894
   punti, zero fallite, copertura 77-97% piatta su ogni finestra. Il valore di mercato si legge ora **al
   giorno dell'asta** e non sulla fotografia della stagione di input.
2. **SpM e dVM sul foglio** (`SHEET_REVISION` 20), che risponde alla domanda dell'operatore «l'FVM va
   confrontata coi fantapunti o col surplus?»: **col surplus**, perché quello che un credito compra è il
   margine sopra chi giocherebbe al posto suo. L'app colora l'FVM col dVM (verde = occasione, ambra =
   caro) e le quattro colonne di fantamedia col posto **dentro il ruolo**.
3. **Le quattro letture sulla scala del surplus**: voti, bonus e costanza standardizzati dentro il ruolo
   (scarti per ruolo 51/83/67 punti → **1**), le presenze deliberatamente no, perché una quota di
   calendario è lo stesso fatto per tutti. Colonna **Fantapunti** (era «Valore») e **Bonus** (era
   «Bonus/Malus»).
4. **Il VIAGGIO NEL TEMPO**, con quattro date che retrodatano anche il MOTORE: `timepack` gira
   `snapshot --date` sulle tre leghe e impacchetta fogli e campetti (~1,3 MB a data), l'app li carica e
   il box dichiara sempre le tre cose che nessuno può retrodatare (probabili, ruolo granulare, scadenza
   di contratto). Le date sono il giorno dopo ogni finestra di mercato delle ultime due stagioni — e
   **non** si leggono dai trasferimenti, che portano tutti la data del 1º luglio.
5. **Tre voci del gate**: R20 pre-registrata e misurata (passa su Serie A, aperta su euro), il canale
   dell'investimento chiuso con un no, il canale rientro chiuso con un no definitivo.

### 14/08/2026, notte: **lo SPECCHIO** (dato per riserva, gioca da titolare)

Item **8** di [todolist-draft-v1.md](todolist-draft-v1.md), spec **«Novità v9.53»**,
[assistente-asta-v1.md](assistente-asta-v1.md) **§31**. Toolkit **388 test**, app **162**.

1. **La regola**: fascia 30°-85° percentile del ruolo, ultime 5 del club, ≥65 minuti e 80% iniziate,
   niente prima della quarta. Entrambi i bordi della fascia lavorano.
2. **L'ESITO è stato corretto dai casi dell'operatore, non dallo screen.** La soglia dei 60 minuti
   dava sbagliati sia Castro sia Ferran Torres, ma Castro ha iniziato 27 partite su 37: «titolare»
   dice quante volte INIZIA. Contato così: **79,1% contro una base del 40,9% (1,94x)**, e la lettura
   sui minuti resta a verbale.
3. **Il portiere è il caso più forte e il sospetto era sbagliato**: sembrava un difetto che la lista
   fosse piena di portieri (sono quotati poco per costruzione), ma la loro fascia riserve è fatta
   davvero di riserve — base 22,3% contro 42,3% — quindi **81,9% e 3,68x**, e per lui vuol dire «è il
   numero uno».
4. **Douvikas non spara** ed è dichiarato: 3 titolarità su 5, sotto soglia, e ha poi iniziato il 67%.
5. **Perdere il posto è più prevedibile che conquistarlo**: 90,4% contro 76,8%.

### 14/08/2026, notte: **«preso per titolare, ruotato di fatto»** (caso Lewandowski)

Item **7** di [todolist-draft-v1.md](todolist-draft-v1.md), spec **«Novità v9.52»**,
[assistente-asta-v1.md](assistente-asta-v1.md) **§30**. Toolkit **385 test**, app **159**.

1. **Una forma diversa da quella dell'item 6**: `14 12 22 90* 25 90* 90* 16 90*…` — gioca ogni settimana
   e non è il titolare (17 su 35 e 47 minuti, dopo 32 su 36 e 74 minuti). Nessun gradino da trovare,
   quindi il changepoint legge zero mentre al tavolo si perdono punti ogni domenica.
2. **La regola, calibrata**: ultime 5 giornate del CLUB, sotto i 45 minuti di media, al più una da
   titolare, dentro il pool dei quotati nel top 15% del ruolo (che è cosa vuol dire «venduto come
   titolare», ed è la popolazione su cui la soglia è tarata).
3. **I numeri sono quelli della funzione che spedisce, ed è la metà interessante.** Una prima
   calibrazione scorreva le RIGHE (84,5% contro 34,9%, 2,42x); la funzione vera scorre i FIXTURE del
   club. Rimisurata chiamandola: **3.711 letture, 471 segnalati, 90,4% contro una base del 59,5% —
   1,52x**. Cambiando il denominatore la base passa dal 35% al 60%: il null è la misura, ancora.
4. **Due silenzi**: chi era infortunato in quella finestra non è «ruotato» (la guardia non costa
   precisione, 86,3% contro 85,7%, e toglie una frase falsa), e chi non era quotato titolare non entra.
5. **Ad agosto la colonna è VUOTA per costruzione**: legge le giornate giocate e otto ancora davanti.
   Comparirà dalla seconda — è l'item 4.4 visto dall'altro lato.
6. **E due marchi, non uno anticipato** (richiesta della sera stessa: «anche prima della quinta»).
   Misurato: alla QUARTA la lettura vale quanto alla quinta (96,3% contro 94,9%), a due e tre vale
   l'81% contro una base del 58%. Quindi il pieno scatta alla quarta e il DEBOLE dalla seconda, con una
   frase diversa — il contro-esempio è **Donnarumma**, segnalato a due giornate con 0 minuti e poi 85 di
   media. Su quella stagione: debole 10 nomi su 15, pieno 4 su 4.

### 14/08/2026, sera tardi: **chi ha guadagnato il posto e chi l'ha perso**

Item **6** di [todolist-draft-v1.md](todolist-draft-v1.md) **chiuso** (6.1-6.6). Spec **«Novità v9.51»**,
[assistente-asta-v1.md](assistente-asta-v1.md) **§29**. `SHEET_REVISION` 16 → **17** (nove colonne
`desc_place_*`), `engine_*` invariato, toolkit **383 test**, app **157**.

1. **Il fatto è un GIORNO**: quello in cui i minuti di un uomo cambiano stabilmente (media prima, media
   dopo, cinque partite per lato, trenta minuti di scalino — soglie di display). 635 righe di Serie A:
   **243 cambi, 128 guadagnati e 115 persi**.
2. **Il controllo sul reparto si fa sulle DATE**, ed è tutto il valore della cosa: un uomo che gioca
   perché il titolare davanti a lui è rotto **non ha vinto il posto**. La sola co-occorrenza risponde al
   contrario sul caso dell'operatore — Bartesaghi prende il posto il 5 ottobre e la caviglia di Estupiñán
   è del 12 — quindi due frasi diverse per due fatti diversi. La linea è il ruolo GRANULARE.
3. **Il lato «perso» risponde sulla FINESTRA e non sul giorno**: Angeliño legge «era DISPONIBILE e non
   schierato, in panchina per 20 delle 31 che ha saltato», che è la sua storia; guardando solo il giorno
   del cambio la risposta sarebbe «influenza» (sei giorni) e si fermerebbe lì.
4. **Due difetti trovati guardando l'OUTPUT**: «era fuori lui» detto di chi aveva giocato 5 partite su 6
   (da cui `fewer_minutes` — giocare meno non è perdere la maglia), e il TRASFERIMENTO DI GENNAIO, che
   senza vincolo dà 76 partite di cui metà di una squadra in cui non era e legge il trasferimento come una
   panchina (7,3% dei giocatori di una stagione).
5. **Le squalifiche non sono controllabili** e la nota lo dice invece di sottintenderlo.

### 14/08/2026, sera: **il TREND delle ultime dieci REALI**, e la panchina che era già nel dato

Costruzione e numeri in spec **«Novità v9.50»**, cosa il tavolo ci legge in
[assistente-asta-v1.md](assistente-asta-v1.md) **§28**, item **5** di
[todolist-draft-v1.md](todolist-draft-v1.md) **chiuso** (5.1, 5.2, 5.3, 5.4). `SHEET_REVISION` **15 → 16**
(undici colonne nuove: ogni cartella precedente è da ricostruire), `engine_*` **invariato**, toolkit
**373 → 379 test**, app **142 → 153**, `ng build` verde.

1. **La finestra è il CAMPIONATO**, non «le ultime dieci»: il calendario euro salta 3-7 giornate reali per
   lega a stagione, quindi chi legge solo la fantamedia euro legge l'82% del calcio giocato. Sulle finestre
   scritte oggi sono **940 partite su 9.657 (9,7%)**, marcate una per una.
2. **La panchina NON andava recuperata: era già nel database, sotto un NULL.** L'item 5.3 prevedeva un
   re-parse offline di 1.373 payload perché «il parse scarta la panchina»; misurato prima di scrivere una
   riga, un sostituto non utilizzato porta `statistics` senza `minutesPlayed`, quindi la riga c'è sempre
   stata — **79.437 righe**, `started` = 0 e `minutes` NULL. L'osservazione era vera (nessuna riga ha
   `minutes = 0`), la conclusione attaccata era falsa. Mancava un LETTORE. **Un re-parse risparmiato da una
   query**, e la panchina VINCE su uno spell che copra quel giorno: chi è in distinta era disponibile e non
   è stato scelto.
3. **La cascata del voto è dichiarata in un punto solo**: voto vero → `mv_synth` calibrato → niente. Mai uno
   zero. Copertura: **4.179 voti reali e 1.356 sintetici**. Due limiti dichiarati invece che approssimati:
   niente cartellini sul ramo sintetico (lo strato per-partita non ha ammonizioni) e **niente fantapunti per
   un portiere** sintetico (il suo fantavoto è dominato dai gol subiti, che non abbiamo per-partita).
4. **Il giudizio 0-99 è dentro il RUOLO** e sul foglio intero, ed è una DESCRIZIONE: lo scostamento dalle
   proprie medie non predice le giornate successive (+0,0167 / +0,0072 / −0,0007 a 2, 3, 5 giornate, segno
   che cambia). Il tooltip lo dice; nessuna valutazione lo legge.
5. **Un difetto trovato CHIAMANDO la funzione**, e sarebbe finito nel foglio: un uomo arrivato in estate
   aveva la primavera del club NUOVO nella sua finestra e ci prendeva zero (Doekhi 2,742 invece di 6,159).
   Curato con `snapshot.player_clubs` — un club è suo per le stagioni in cui il listone ce lo mette **o** le
   sue presenze dicono che ci ha giocato, e servono entrambe. **173 finestre su 1.085 cambiano, 99 guadagnano
   più di mezzo fantapunto a partita.**

**Cosa resta aperto**, in ordine: i vecchi **4.5** (`engine_pv_pred` deve leggere le giornate giocate se
l'asta e' a stagione iniziata — tocca `engine_*`, quindi GATE), **1.5b** e **2.2**.

### 14/08/2026: **chi ha sbagliato il mercato**, e tre refutazioni che valgono più delle adozioni

Numeri in [metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md) **§20** (citare da lì), piano del toolkit in
spec **«Novità v9.49»**, requisiti nuovi negli item **5 e 6** di
[todolist-draft-v1.md](todolist-draft-v1.md). Commit: `89f64fd` (piano per stagione, toolkit 366 → **372 test**),
`1adb4eb` (le due icone, app 132 → **142 test**), `b3da2f4` e `35d39cb` (i requisiti). `engine_*` **non
toccato**, `SHEET_REVISION` fermo a 15.

**La domanda dell'operatore era: chi il Qt.I e l'FVM hanno sbagliato la stagione scorsa, e con che cosa lo si
vedeva dopo due giornate.** Misurato su 4 stagioni × 2 piattaforme, taglio al **31 agosto**.

1. **Sull'FVM non è rispondibile, e va detto prima**: ogni lettura che il DB ha per una stagione passata è del
   07/08/2026, quindi correla **+0,78/+0,80** con l'esito contro il **+0,56/+0,58** del Qt.I. Non è un prezzo
   d'asta, è un numero che ha visto com'è finita.
2. **I due lati sono problemi diversi, ed è la conclusione principale.** Dei 200 casi estremi per lato:
   **43% dei sopravvalutati era già noto il giorno dell'asta** (infortunio aperto 23,5%, già partito dalle
   cinque leghe 16,5%), mentre i sottostimati sono **92% «chi prende la maglia»** e solo 2,5% noti. Il ribasso è
   DISPONIBILITÀ (cioè i marchi spediti l'11/08); il rialzo è previsione.
3. **Una correzione che ha rimosso metà dei sopravvalutati estremi**: il **13-18% di ogni listone** ha un Qt.I,
   un FVM, il club VECCHIO in `rosters` e **zero righe di voto** in tutta la stagione. Il loro zero non è il
   mercato che sbaglia, è la nostra riga stantia — contarlo sarebbe inventare l'errore altrui da un difetto
   nostro.
4. **Quello che intercetta ciò che il prezzo non vede sono le RATE per 90 della finestra**, 8 istanze su 8:
   xG+xA/90 **+0,198**, xA/90 +0,194, passaggi chiave/90 +0,165, tiri/90 +0,162, rating +0,147.
5. **Tre refutazioni**: «crea e non segna ancora» −0,046 (3/8); «fortuna da correggere» **0,000** (3/8), che su
   una finestra sola valeva −0,181; e «sopra le proprie medie quindi scenderà» **falsificato in entrambe le
   direzioni** su ~65.000 finestre col null rimescolato (eccesso vero +0,0167 / +0,0072 / −0,0007 a 2, 3, 5
   giornate, segno che cambia). Il grezzo a 5 giornate è +0,204 ed è tutto artefatto: **il null non è un
   dettaglio, è la misura**.
6. **Due screen spediti come icone** (`ui-flags`): difensore economico con xG+xA/90 ≥ 0,25 → 50% contro 28,9% di
   base (**1,89×**); attaccante caro con xG+xA/90 ≤ 0,25 → 21,9% contro 9,1% (**2,41×**). Per il rialzo si
   guardano i difensori, per il ribasso gli attaccanti. **La prima versione dava 5-10× perché il null era
   sbagliato** (confrontava anche coi costosi, che per definizione non possono «esplodere»): dentro il pool in
   cui si sceglie davvero sono 1,0-2,4×.
7. **Il toolkit sa dire cosa manca PER STAGIONE**, e classificare il buco in dichiarato / convenzione / limite
   di fonte / mancante. Risultato su sei stagioni: **zero buchi che un comando possa colmare**. Le tre assenze
   reali sono di FONTE e ora sono scritte con la prova (voti euro 2021-22 con `mv` NULL su 17.825 righe; xG
   assente fino al 2021-22 — 0 giocatori su 446 nel payload in cache; `matchday_map` 2021-22 a valle dei voti).
   E `fetch --plan` da solo diceva «every source is populated».

**Cosa restava aperto quel pomeriggio**: item **5** (chiuso la sera stessa, blocco sopra), item **6**, poi i
vecchi **4.5**, **1.5b**, **2.2**.

### 11/08/2026 (committato e documentato il 14/08): **cosa un nome porta con sé**, e l'undici che la MIA rosa schiera

Documenti: [assistente-asta-v1.md](assistente-asta-v1.md) **§27**, spec **«Novità v9.49»**.
`engine_*` non toccato, `SHEET_REVISION` **invariato a 15** (nessun foglio diventa stantio), toolkit **366 test
+ 1 skipped**, app **da 107 a 132 test**, `ng build` verde.

**Due richieste dell'operatore, la stessa mattina, e sono la stessa domanda da due lati: guardando un nome,
cosa mi manca per decidere?**

1. **I marchi accanto al nome** (`ui-flags`, un solo componente e un solo servizio, disegnato in **quattro**
   liste: consiglio, feed, tabella di consultazione, i due campetti — «nei suggerimenti ma anche dalle altre
   parti»). Due sono **misurati** dalla tabella `injuries` del bundle, che è la stessa definizione di
   infortunio che la tabella di consultazione già usa: **infortunio lungo aperto** (icona piena) e **rientrato
   da poco** (stessa icona a metà opacità — «ci è passato» è lo stesso fatto visto da dopo). Le soglie **45** e
   **60 giorni** sono scelte di **DISPLAY** dichiarate in un punto solo: non entrano in nessuna valutazione,
   quindi nessun gate le tocca. Misurato sul bundle: **134** lunghi aperti e **73** rientri recenti su 3.081
   uomini con almeno uno spell; sui 1.413 dei tre fogli, **54** e **39**, cioè circa il **6,6%** del listone —
   la densità giusta per una segnalazione.
2. **Il terzo marchio non è misurabile, quindi è DICHIARATO**: `config/player_notes.json`, quarto file
   dichiarato con lo standing di `board_rulings.json` — fuori rosa / rottura con la società / ha chiesto di
   andare via. **Niente in questo progetto osserva un litigio**: `exit_risk` è un contratto che scade, un
   trasferimento è un movimento avvenuto, una riga di rosa mancante è indizio di una partenza; leggere uno dei
   tre come una rottura sarebbe **inventare un fatto da un fatto diverso**. Solo REPORTING (niente sotto
   `engine/` lo legge), giunzione per `fc_id`, e un test asserisce **due** cose: che il file dichiarato arrivi
   nel bundle e che la sua **assenza sia silenzio** e non un warning. Oggi per 2026-27 è vuoto: zero nomi, cioè
   «niente dichiarato», mai «niente da dichiarare».
3. **Il campetto FANTA accanto a quello reale, e qui l'undici si CALCOLA.** Non contraddice la regola del
   10/08: là c'è un **allenatore da prevedere** e prevederlo è una misura, che vive nel toolkit; qui non c'è
   nessuno da prevedere, solo il **regolamento**, quindi la risposta è una deduzione e sta nell'app. Miglior
   undici legale sulla moneta che il banco ha misurato (il **VALORE**, non il surplus), **modulo scelto** da
   quale schema fa entrare l'undici più forte, coi **runner-up mostrati** perché una scelta automatica deve
   poter essere dubitata, **ballottaggi esatti** (scambiare un uomo su un posto lascia intatti gli altri, quindi
   basta che i ruoli stiano in quel posto — nessun secondo abbinamento), e **chi il foglio non sa prezzare è
   elencato a parte e non schierato**: «vuoto = ignoto» applicato a un disegno. `mantra-legal.ts` resta l'unica
   definizione della legalità e si è **allargata** (`placesIn` con linea e nome del posto, `bestEleven`) invece
   di essere duplicata; il banco continua a leggerla.

**La cosa andata storta è di metodo.** Questo lavoro è rimasto **tre giorni nel working tree** — verde, non
committato, non documentato, non pubblicato — e il sito pubblico è restato al deploy del **09/08**, indietro di
**due** sessioni (mancavano anche i campetti reali del 10/08). **Codice verde e non spedito è codice che nessuno
può correggere**: un difetto che vive solo sulla macchina dell'operatore non produce nemmeno la segnalazione che
lo farebbe trovare. E **il `chiudi` va fatto quando finisce il lavoro, non quando finisce la sessione**: la §27
è stata ricostruita dai diff, ed è andata bene solo perché i commenti nel codice portavano i «perché» e le date.

### 10/08/2026, NOTTE: **la todolist del draft eseguita**, e il consiglio del pannello riscritto su misure

Sei commit in una sera (`eed0c56`, `1bbe45c`, `32bf89e`, `55cd319`, `c1f499a`, `9951a83`). Documenti:
[metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md) **§16 §17 §18 §19**,
[assistente-asta-v1.md](assistente-asta-v1.md) **§26**, [gate-motore-v1.md](gate-motore-v1.md)
**§7-octovicies**, e [todolist-draft-v1.md](todolist-draft-v1.md) aggiornata item per item.
`engine_*` **invariato** (nessun file del motore toccato), `backtest --verify` tutti OK, **366 test toolkit +
105 test app** verdi.

**Il difetto più grosso non era nella lista.** Il pannello consigliava ordinando per **netto**
(`surplus − λ×prezzo`) e non razionava per ruolo: misurato come politica fa **−52,3% sui rivali, 0/5, 34
crediti spesi in 25 giri, metà undici scoperto**. λ è il tasso fra un credito e un fantapunto, e in un draft
non spendi crediti, spendi **scelte**. Era la causa comune di due sintomi già rattoppati sul bordo — quando lo
stesso sintomo va rattoppato due volte in punti diversi, il difetto è nella grandezza che entrambi leggono.

**Cosa il pannello fa adesso** (tutto misurato sul banco a cinque finestre, verdetti del gate):
1. **ordina per VALORE** (fm × presenze). Netto e surplus restano colonne: sono i numeri giusti in un'asta a
   rilanci, non in un draft.
2. **raziona per COPERTURA**, e la regola è **per GIOCO**: su mantra due undici legali contati sui POSTI
   (`COVER_COPIES` = 2, +1,47% robust); su classic la quota graduata (`QUOTA_DEPTH` = 0,7, +0,77% robust),
   perché là la versione sui posti **perde** (−1,00%). Il bersaglio `startingPlaces × 2` della todolist NON
   vincola: quelle quote sommano 16 contro i 10 posti di uno schema.
3. **stima la testa di ogni rivale dai suoi pick** (82,8% contro 69,2%, 5/5; due pick bastano).
4. **prende chi sparirà e raccoglie chi resta** (`SURVIVOR_DISCOUNT` = 0,7): **+4,54%, 5/5, STRICT** — la leva
   più grossa della campagna, tre volte la copertura, e non usa nessun vantaggio informativo.
5. **dice quanto toglieresti al rivale** che stava per prenderlo (nota, non cambio di scelta).

**Cosa è stato RESPINTO con la misura** (non riproporre senza rileggere): la moneta ibrida (−4,88%, difetto di
SCALA), ogni pavimento prezzo (cross-fit held-out −0,05%), il blend prezzo+nostro **sommato** alla
sopravvivenza (peggio della sopravvivenza sola), e la coppia «bonus e poche presenze + riserva affidabile»
(forma forte −4,69%, forma ristretta −0,40%: la moneta la contiene già, e il metro regala già il beneficio).

**La domanda dell'operatore sull'asimmetria, e la risposta ribalta la premessa.** Il nostro vantaggio
incrementale sul prezzo esiste (+0,214 euro, +0,246 Serie A) ma **il loro è quasi il doppio su euro** (+0,388),
ed è largo **un numero solo: le presenze** (la fantamedia +0,046/−0,032, il surplus +0,006/−0,077). Su euro i
nostri disaccordi col prezzo sono in media **nostri errori**. E «il mercato ci batte» è una frase su una
PIATTAFORMA: su Serie A lo battiamo noi. **L'asta a stagione iniziata** non ci favorisce: le presenze VISTE
valgono +0,443 (k=2) e +0,536 (k=6) sopra il prezzo — il segnale più grosso di tutto il file — e sono
PUBBLICHE; l'incertezza ERA il nostro vantaggio.

**Il campetto della squadra reale legge la BOARD del toolkit.** La prima versione calcolava un undici
nell'app e l'operatore l'ha corretta: `modules/boards.py` è ora l'unica definizione di una board e guida il
pannello vero senza finestra, con **le sue decisioni per club applicate** (i due giudici la leggono senza);
lo `snapshot` scrive `boards.json` dentro la cartella del foglio appena scritto e l'`export` la porta nel
bundle. Per club: modulo disegnato, 11 titolari con la `x` del pannello, **fino a due ballottaggi** ciascuno,
ruoli reali e minuti. Verificato sul bundle: 77 club, 847 uomini, 1405 ballottaggi, **zero** disaccordi.

**SEGUITO DELLA STESSA SERATA — il campetto rifinito su sei richieste dell'operatore, e due difetti trovati
dove nessuno guardava.** Commit `f8c4466` → `e1a084b`, **v0.1.8 pushata** (15 commit su `origin/master`).

Il campetto come e' adesso: **portiere in alto** e attacco in basso (ed e' come il pannello disegna da sempre —
`_lane` lo dice nel suo docstring); **un solo ruolo**, quello che il modulo gli ha dato, che non e' `badge` da
solo ma `_line_codes`, il quale lo CORREGGE per riga (un centravanti resta `Pc` e non diventa `As`); il **ruolo
mantra** su una riga sua, perche' e' quello che il gioco punteggia; i minuti sempre come **media a partita**
(minuti diviso le partite giocate); il **valore in 99esimi** in un quadratino dopo il nome, sulla stessa scala
della tabella; larghezza massima **500px**; i presi ad **alpha 0,3**.

**Due difetti che il dato non aveva, ma il cablaggio si.**
1. **«Non vedo i campetti»**: il bundle portava le board, `app/public/data` no — `pull-bundle.mjs` copiava
   `sheets/` e `mantra_modules.json` e non `boards/` ne' `classic_modules.json`, aggiunti quel giorno. La carta
   diceva CORRETTAMENTE di non avere board. Regola: **una cartella aggiunta all'export va aggiunta al pull**, e
   ora il riassunto del pull le CONTA e avvisa quando sono zero — uno zero silenzioso e' indistinguibile da una
   funzione rotta.
2. **«Recupera gli stemmi»**: gli stemmi c'erano già. 93 file, e **tutti i 47 club** che il pannello puo'
   mostrare ne hanno uno; i 13 senza sono fuori perimetro (Chievo, Huddersfield, Hertha, Maiorca…) e **non
   hanno un id sofascore** — zero club hanno l'id e non il file, quindi la cura sarebbe l'IDENTITA' e non
   un'API. Il difetto era che il campetto chiamava `ui-crest` col solo nome, e senza `clubId` + l'indice quel
   componente disegna sempre il monogramma. **Il dato c'era, nessuno lo chiedeva** — misurare prima di scaricare
   ha risparmiato uno scraping intero.

E una divergenza latente chiusa: saltavo `_lane` fra `lanes_for` e `_placed`. Non cambia CHI e' nell'undici
(nessun numero pubblicato dei giudici si muove) ma decide il lato di chi non ce l'ha, e il marcatore si legge
da quel lato.

**Fondamenta nuove**: il **banco del draft è nel repo** (`toolkit/bench/draft/`) ed è il **terzo attrezzo di
misura** — `backtest` giudica le regole, `sweep` le costanti, questo le POLITICHE — e **legge il codice vero
dell'app** via esbuild, con una riga che verifica che il codice spedito riproduca la misura che lo ha adottato.
Più `config/classic_modules.json` (i sette moduli, letti dal regolamento) e la lega **`Leghe Mantra`**
(default/mantra, 10 squadre, 2+21) col suo foglio nel bundle.

**Cosa resta aperto**, in ordine di resa: item **4.5** (se l'asta è a stagione iniziata, `engine_pv_pred` deve
LEGGERE le giornate giocate — il numero più grande della campagna, tocca `engine_*` quindi gate), **1.5b** (il
guadagno marginale sull'undici come obiettivo: nel 57,3% dei pick sceglie un altro uomo), **2.2** (il Qt.I sul
lato presenze, pre-registrato nel gate), **3.1 rimane misurato** ma su classic il nostro posto perde contro la
media dei rivali (−2,6%) e nessuno sa ancora perché, **2.3** (buchi di input), **2.5** (calendario: NON
misurabile, `fixtures` ha solo 2026-27), **2.4** (rinviata dall'operatore). E **la verifica visiva del
campetto**, che vive dentro un'asta seguita: è la prima cosa da aprire al prossimo draft.

### 10/08/2026, giorno: **l'assistente d'asta è completo**, e due conclusioni sono state RITIRATE

Un solo filo, dalla mattina alla notte: portare il pannello d'asta a essere usabile a un tavolo vero, e poi
**mettere alla prova contro l'esito** ciò con cui consiglia. Documenti: pannello in
[assistente-asta-v1.md](assistente-asta-v1.md) §25, moneta in
[metrica-asta-surplus-v1.md](metrica-asta-surplus-v1.md) §15, gate in
[gate-motore-v1.md](gate-motore-v1.md) §7-septvicies, toolkit in spec «Novità v9.48», piano di seguito in
**[todolist-draft-v1.md](todolist-draft-v1.md)**. `SHEET_REVISION` **15**, `engine_*` invariato,
`backtest --verify` **22/22**, 75 test app + suite toolkit verdi.

1. **Il pannello d'asta fa i tre numeri.** Il motore viaggia nel bundle (un foglio per lega dichiarata),
   la giunzione è per `fc_id` e la copertura è **riportata**; il rimpiazzo è **vivo** (l'ultimo libero per
   cui il tavolo ha ancora posto) e la domanda per slot viene dai **moduli del gioco** — non dalle quote
   per macro-ruolo, che rispondevano «la lega comprerà tutti i 124 terzini sinistri» e raddoppiavano il
   surplus del miglior `ds` (Grimaldo 28,0 → 15,5). Sulla riga: **Valore 0-99**, **+/10g** (surplus in
   punti ogni dieci giornate) e **Netto/10g** (dopo aver pagato al cambio corrente λ).
2. **La regola delle PORTE**, che la piattaforma non sa esprimere: interruttore Portieri/Porte, l'unità
   diventa il club, la porta è del **primo** che prende un portiere qualsiasi di quel club e un secondo
   portiere dello stesso club è segnalato come inutile invece di essere contato.
3. **Lo stato sopravvive a un refresh**: cache dello stato, ridipinto subito in sola lettura mentre il
   riaggancio va sotto. Tre difetti veri pagati per arrivarci — un `forget()` che cancellava l'unica copia
   quando cadeva la rete, un throttle sul solo fronte di salita che salvava `state: {}`, e un pannello che
   si apriva sul socket invece che sulla tabella.
4. **La scelta consigliata**: quattro giri interi, tre direzioni divergenti (massimo netto, altro reparto,
   il più caro che *tiene la posizione* — misurata sull'ORDINE e non sul prezzo), vista **estesa** o
   **compatta**, e il «e se prendessi lui?» cliccando qualunque nome, che si aggiunge alle tre opzioni
   invece di sostituirle.
5. **Il calendario entra nel DB** (`fixtures`, chiave `event_id`, club per id provider) e le **partite
   facili** arrivano nel foglio come k/n più coefficiente. Il vantaggio campo è **misurato**: **29 punti
   Elo additivi**, dopo che la versione moltiplicativa ×1,1/×0,8 aveva ridotto la colonna a «in casa o
   fuori» (0 partite facili in trasferta su 1111, log-loss 1,258 contro 0,628).
6. **La storia pluriennale su Serie A: respinta due volte.** L'intuizione dell'operatore è vera e misurata
   (+0,33 chi sbaglia l'ultima di cinque, −0,51 chi azzecca solo l'ultima), ma R18b (recenza dichiarata) e
   R18c (split dichiarato) danno **+0,3/0,4%** contro un pavimento dello 0,5%. La diagnosi vale più del
   verdetto: la **somma** delle due lambda di R18 è stabile (0,662, sd/media 21%), la **ripartizione** no
   (da 0,13 a 41,38) — il +1,9% di R18 era il fit che comprava quella libertà. E il **trim** dell'operatore
   come predittore non aggiunge niente (−0,0012 ± 0,0077 contro la media piena): resta robustezza
   dichiarata per le descrittive, prima applicazione il margine di calendario.
7. **La campagna sulle strategie di draft, e le due conclusioni ritirate.** Cinque finestre euro/mantra,
   prezzo Qt.I, undici **legale** sui moduli, confronto appaiato. Restano in piedi: «giocare per scegliere
   primo» è **rovinoso** (−45,8%, 0/5); il **SURPLUS è la moneta sbagliata per un draft** (−4,0%, e −15,7%
   su una finestra) perché sconta una scarsità che il regolamento mantra non impone; la **copertura per
   ruolo vale dieci volte la moneta** (+10,6 punti a giornata contro 0,8 fra le monete). Cadute: il «+92
   della via di mezzo» (sulle cinque finestre **+0,0%**) e «il motore batte il mercato» (Qt.I **+0,545**
   contro VALORE **+0,514**; il valore vince solo sulla finestra su cui era stato misurato). **Una
   conclusione su una finestra non è una conclusione**, ed è la lezione di metodo della giornata.

### 9/08/2026: **l'app esiste** — Angular, pubblicata, e legge il bundle

Spec «Novità v9.47» per la parte toolkit. Convenzioni della app in **`app/CLAUDE.md`**, stato e comandi in
**`app/README.md`**. 29 commit, **362 test**, `SHEET_REVISION` invariata, `engine_*` invariato: nulla di
questa giornata tocca il motore.

1. **`app/` non è più un README.** Angular 22 + ng-zorro 22 + Tailwind v4 (zoneless, standalone, signals),
   il workspace è `app/` senza sottocartella `client/`. Le convenzioni sono state importate dal progetto
   Jingle Machine dell'operatore, con **tre scostamenti dichiarati**: la UI di `app/` è in ITALIANO (il
   resto del repo resta inglese), `committa` NON diventa commit+push perché il repo è pubblico, e il
   version bumping parte da subito.
2. **La pagina Calciatori**: nome, ruolo, ruolo mantra, squadra e una colonna per giornata. In cella il
   voto — fantacalcio, o sintetico calibrato marcato `~`, o il rating del provider marcato `*` perché è
   **un'altra scala** — con gol/assist compatti, tooltip e un dettaglio partita al click (competizione,
   squadre con stemma, risultato, minuti, bonus/malus letti da `scoring_config.json` e mai scritti a
   mano). Filtri: listone, ruolo, squadra, stagione, finestra di giornate, ordinamento; competizioni da
   includere.
3. **Una cella vuota dice PERCHÉ.** Cinque stati misurati sui 499 quotati per 38 giornate di Serie A
   2025-26: giocata o s.v. 45,9% · panchina 14,9% · mai in quel campionato 24,6% (123 uomini) ·
   infortunato 7,6% · e solo il **6,9%** senza spiegazione, che è quello che dice l'ultima icona. L'ordine
   è deliberato: «non in questo campionato» batte «infortunato», perché l'infortunio di un uomo della
   Ligue 1 non deve leggersi come una giornata di Serie A saltata.
4. **Con coppe o amichevoli la colonna diventa una SETTIMANA condivisa**, da giovedì a mercoledì — misurato:
   un'ancora al lunedì spezza 28 giornate su 38 fra due colonne, quella al giovedì ne spezza 4; il
   raggruppamento «per buchi» è stato provato e scartato (240 date collassano in 14 gruppi, uno lungo 59
   giorni). L'asse nasce dai calciatori **filtrati**, così le colonne descrivono la tabella che guardi.
5. **La pagina è pubblica**: `https://clemanto.github.io/FantAssistant/`, branch `gh-pages`, pubblicata
   **da questa macchina** con `npm run deploy:pages` (che fa il bump di versione da solo). Non da CI: il
   bundle non è in git, quindi un runner non può averlo, e un secondo pubblicatore ripubblicherebbe il
   sito senza dati.
6. ⚠️ **Decisione dell'operatore, non una misura**: online ci sono i **dati veri** del toolkit, cioè
   contenuto a pagamento di fantacalcio.it, su un URL che chiunque può scaricare. Gliel'ho detto due volte
   — una pagina Pages su repo pubblica non è protetta da «uso personale» e `robots.txt` è solo una
   richiesta ai crawler — e la scelta è sua. Il `CLAUDE.md` di radice registra l'eccezione alla propria
   regola; `master` continua a non portare il bundle.

### 8/08/2026 (8): il pannello Asta è UNA lista, e il surplus in crediti

Spec «Novità v9.45» (pannello) e «v9.46» (stima), metro in `metrica-asta-surplus-v1.md` §14, gate
§7-sexvicies e §7-octodecies. `SHEET_REVISION` **13 → 14**, **362 test**, `--verify` 22/22: niente di
gated si muove, tutto quello che cambia è VISTA o STIMA.

1. **Una lista sola di tutti i calciatori**, ordinabile per ogni colonna e filtrabile per ruolo e club
   (richiesta dell'operatore). `evaluate.auction_view(full=True)` restituisce ogni riga senza
   troncamento, **compresi quelli che la classifica non può tenere** (sotto la soglia di disponibilità,
   o mai prezzati ma con una stagione giocata). Su mantra la riga è UNA e lo slot lo decide
   `snapshot.auction_level`, non un secondo criterio. Chi il listone non porta non ha codice mantra e
   resta fuori: **61 su 1895** su euro, 1 su 851 su Serie A, e la riga di conteggio lo dice.
2. **I due ruoli sono palline colorate** (R = classic, M = mantra, piena = lo slot in cui è prezzato) e
   il filtro ruolo è **multiplo** con tutti e dodici i codici su mantra, letto sui CODICI e non sullo
   slot (`b`+`e` → 314 righe su 1834). Questo ha cambiato il widget: un Treeview in Tk 8.6 colora la
   riga e non la cella, quindi la tabella è ora una canvas come quella della rosa.
3. **SpM / dVM: il surplus in crediti.** Due correzioni dell'operatore hanno cambiato la taratura, non
   solo le parole — **l'FVM non è di fine stagione** (cambia a ogni evento saliente) ed **è un PREZZO**,
   tarato su un'asta di riferimento a 10 squadre × 1000 (verificato: i primi 250 del listone Serie A
   2025-26 fanno 1.032 crediti a squadra). Quindi il tasso è un budget: per ruolo di listone, `FVM degli
   N che il mercato rosterizza / surplus degli N che il motore rosterizzerebbe`. Tararlo su tutti i
   quotati leggeva i rosterati **sopravvalutati del 23%** per costruzione.
4. **Un nuovo acquisto non è un uomo sconosciuto** (segnalazione dell'operatore su Ramos, sul numero e
   non sul codice). `est_pv` per chi non ha stagione qui usava la quota di chi **non ha misura da nessuna
   parte** (0.29): 11 presenze su 38 per un attaccante da 74M con 1320 minuti di Ligue 1 misurati. Ora
   una retta fittata su quella popolazione (minuti di lega / giornate di quella lega), giudicata
   leave-one-SEASON-out: **+17.9%** su default, **+5.1%** su euro. **192 righe** Serie A e **418** euro.
   La FANTAMEDIA resta l'àncora — R1 le ha perse cinque volte su sei — perché il calcio giocato altrove
   predice **quanto gioca**, non quanto vale a voto.
5. **Due misure che chiudono altrettante domande, senza codice.** Il *coefficiente di campionato* sui
   voti euro (gate §7-sexvicies): esiste solo per la **Premier** (+0.62, t +3.8, 17 casi su 21), è zero
   per Ligue 1/Bundesliga/Liga, e per Ramos lo ABBASSEREBBE — R1c è pre-registrata, non adottata. E
   R18 (le ultime cinque stagioni) **è già adottata su euro** e legge le tre stagioni di Ramos: b2 > b1
   su quattro finestre di cinque, 407 righe mosse su 1834. Avevo scritto «il core legge una sola
   stagione»: vero su `default`, falso su euro, corretto in gate §7-octodecies.

**Aperto**: la griglia finestra × decadimento di R18 (n ∈ {2..5}, decay ∈ {1.0, 0.75, 0.5}) e R1c, tutte
e due pre-registrate e da far girare col gate. Attesa dichiarata: il decadimento abbassa Ramos.

### ULTIMO IN ORDINE DI TEMPO — 8/08/2026 (7): quattro domande sulle board, e il giudizio dichiarato

Spec «Novità v9.44», dettaglio in `formazioni-tipo-v1.md` §1/§3/§6-ter e nella **manutenzione** in testa
a `todolist-formazioni-tipo-v1.md`. `SHEET_REVISION` resta **13** (cambia il disegno, non una colonna
del foglio), **356 test**, `--verify` 22/22 non toccato. Quattro segnalazioni dell'operatore, ognuna
misurata prima di decidere: **due hanno prodotto codice, due un rifiuto con il numero davanti**.

1. **Il posto UNICO davanti è di una punta** (`_off_the_front(..., lone=True)`, regola dell'operatore:
   «nel 4-5-1 o 4-2-3-1 ci vuole una Pc, o al massimo una A»). Il Bologna schierava Odgaard (`AM;RW`,
   0.429) invece di Dovbyk (`ST`, 0.382) e **nessuna guardia poteva obiettare** — `RW` lo rendeva uomo
   d'attacco per `_fronted`, `AM` uomo centrale per `_pointed`. Sta DENTRO l'unica definizione di «non è
   il suo mestiere»: il primo tentativo era una guardia nuova alla sola selezione, e `_settle` — che
   prezza i posti senza conoscerla — la aggirava RICOLLOCANDO la punta a centrocampo. Costo misurato:
   **1 board su 57**, i due giudici IDENTICI prima e dopo (11/5/4 · 166/220 e 13/1/6 · 137/220).
2. **Il giudizio dell'operatore sul modulo è ora un fatto persistente** (`config/board_rulings.json`):
   datato, per (stagione, club), joinato per IDENTITÀ, **revocabile** («auto» nel selettore) e — il
   punto che conta — **invisibile ai due giudici** (`load_sheet(apply_rulings=False)`), perché un
   giudizio è spesso preso guardando la stampa e un giudice non può valutare le risposte dell'operatore.
   Prima riga: **Napoli 2026-27 = 4-3-3**.
3. **Due rifiuti misurati.** La famiglia di DIFESA del ritiro (3 dietro vs 4, proposta dell'operatore:
   «è la base su cui si monta il resto») indovina **11/16** contro **14/16** della board: vince dove lui
   diceva (Napoli, Juventus) e perde su cinque, con Genoa e Udinese che hanno letture forti quanto
   quella del Napoli in direzione opposta — sui soli allenatori nuovi è 4/4, una moneta.
   E `PRESEASON_WEIGHT` rimisurato: a 0.30 il Napoli gira sul 4-3-3 e **la Fiorentina gira al
   contrario**, saldo 0 moduli e −1 uomo. Limite dichiarato: il giudice forte non può pronunciarsi (nel
   DB non c'è ritiro 2025), quindi **M4-bis è pre-registrata per maggio 2027**, quando l'esito 2026-27
   misurerà il ritiro 2026 già archiviato (310 undici, 20/20 club).
4. **La regola di metodo, ed è nuova**: *un giudizio dell'operatore che il modello non può raggiungere
   non si adotta come parametro, si dichiara come fatto*. Sul Napoli i tre indizi erano veri (amichevoli
   4-3-3; rosa di esterni; e — verificato — un 2025-26 partito a QUATTRO per 11 giornate prima di 27 di
   3-4-3, cioè l'abitudine di Conte), e ogni canale che li leggerebbe è già stato bocciato dai giudici.
   Adottarne uno sarebbe stato allargare un criterio perché un caso lo fallisce; lasciare la board
   sbagliata sarebbe stato ignorare chi sa qualcosa di vero. La terza via è dichiarare, fuori da ogni
   misura. **Due voci restano APERTE** per lo sweep, non per una sessione: il denominatore del
   trasferimento di GENNAIO (il caso Malen, 0.405 letti su una mezza stagione da titolare vero) e il
   prior personale su t−2 per chi ha la t−1 mangiata da un infortunio (il caso Dovbyk).

### 8/08/2026 (6): DUE GIUDICI per le board, e una lista chiusa

Spec «Novità v9.43», verdetti nel gate **§7-quinvicies**, dettaglio per voce in
`todolist-formazioni-tipo-v1.md` (**chiusa**). `SHEET_REVISION` **13**, **354 test**, `--verify` 22/22 a
ogni passaggio: nulla di gated si è mosso.

1. **Le board hanno DUE giudici, e il secondo è il più severo.** `press --sheet DIR --against
   press|outcome`: la previsione di terzi (l'unica che esiste prima che si giochi) e **quello che i club
   hanno fatto** (forma modale della stagione + gli undici più schierati), che vuole un foglio
   retrodatato. La referenza è un DATO (`press_formations`, per-GIORNO, archiviata e rigiocata da
   `rebuild`) e **un GIUDICE mai un input**. Bilancio: stampa **11/5/4 e 166/220** (da 9/5/6 e 160),
   esito **13/1/6 e 137/220** contro un null di 9/2/6 e 104.
2. **Cinque adozioni**: il modulo `press`; i campionati d'ORIGINE (`FEEDER_LEAGUES`, Serie B — Frosinone
   4/11 → 10/11); l'identità già nota che attribuisce la stagione nascosta dal perimetro (+5.238 righe di
   `external_stats`) con `player_xref.resolved_by`; i transfers per chiave canonica (irrisolti 4.422 →
   2.508) e il terzo ripiego del livello (67 → 74 arrivi coperti); il trequartista candidato al
   centrocampo (Como DIFF → MATCH) e il **SUR** nel selettore modulo.
3. **Sei rifiuti MISURATI** — e contano quanto le adozioni: la co-titolarità come regola (la stampa
   schiera l'uomo che toglieva), il modulo del ritiro (ottimo al bordo), il SUR come discrimine di
   modulo (4/3/13 contro 11/5/4), il declino d'età oltre i 30 (bocciato da entrambi i giudici),
   scontare il claim per la disponibilità, e il salto di livello senza cambio club — **non misurabile**,
   3-7 uomini per stagione.
4. **Cinque regole di metodo**, e sono la parte durevole: *un numero senza il suo null non è
   interpretabile* · *quale rappresentazione si confronta lo decide la referenza* · *una differenza fra
   due gruppi non è un canale finché non verifichi che il modello non la stia già leggendo* · *una quota
   si cita dal report o si rimisura, mai dal documento* · **e le regole scritte non bastano: bisogna
   chiamare la funzione** — le due violazioni di oggi sono mie, dopo averle riscritte.

### 8/08/2026 (5): il perimetro era la stagione FINITA, e la stampa come giudice

Spec «Novità v9.42». **332 test, ruff pulito, `--verify` 22/22** — niente di gated si muove —
`SHEET_REVISION` **10**, fogli rigenerati (default + euro).

1. **Le promosse non erano nel foglio d'asta.** `perimeter_clubs` («i club da cui puoi comprare») leggeva
   `match_ratings` di (input, target); in agosto il target non ha partite, quindi il foglio 26/27 teneva
   Cremonese/Pisa/Verona (94 righe senza Qt.I) e scartava i **74 quotati di Frosinone, Monza e Venezia**.
   Ora il perimetro è il **listone bersaglio** (contingente ≥ `PERIMETER_SQUAD_MIN` = 11), ratings come
   ripiego per le finestre senza backfill. Anche euro era fermo alla selezione dell'anno prima: **35 → 37
   club** (+Bournemouth, Como, Strasburgo, Rennes; −Lilla, West Ham).
2. **La stampa come GIUDICE delle board** (mai input del claim): 20 club, 4-6 fonti (3-7 agosto) —
   **moduli 9 uguali + 5 sull'alternativa dichiarata, uomini 160/220 = 73%**. Il meccanismo è consolidato
   in `formazioni-tipo-v1.md`, il piano in `todolist-formazioni-tipo-v1.md` (giudice-come-dato, aggregati
   Serie B, risoluzione transfers, il trequartista di Como, la co-titolarità, il modulo del ritiro).
3. **`_wing_back_trade`**: «Malen dovrebbe giocare come Pc e non come centrocampista esterno» — in una
   difesa a tre la fascia del centrocampo non si contende con soli codici d'attacco. 3 board si muovono,
   tutte verso la stampa (**Juventus 11/11**); Bologna/Orsolini (difesa a 4) intatto e nel test.
4. Misurati e non cablati: Giovane al Napoli è il MODULO (nel 4-3-3 i claim già disegnano
   Politano-Hojlund-Neres), Scamacca+Krstovic sono UNA maglia (co-start 5/24; Lautaro+Thuram, la coppia
   vera, 18/23).

### 8/08/2026 (4): i tre punti aperti, chiusi — e una diagnosi ribaltata

Spec «Novità v9.41», gate §7-quinvicies. **330 test, `--verify` 22/22, gate completo rieseguito senza che
nessuna regola si muova**, fogli e bundle rigenerati.

1. **La mappa Elo del gate** è cablata su `club_levels` (un FILL: dove `club_elo` ha un valore vince lui),
   **ma misurata prima di cablarla vale quasi nulla** — 4, 1, 0, 0, 0, 0 club di provenienza per finestra.
   Il vincolo non è la tabella Elo: è **`club_prev`, che viene dal listone precedente**, quindi chi arriva
   dal Salisburgo non ha un club precedente qui e nessuna tabella può vederlo. Il punto era vero e non era
   il collo di bottiglia — ed è la stessa lezione del giorno: misurare prima di rimediare.
2. **Il campionato austriaco** non sta più sotto lo slug della Bundesliga: ClubElo porta da sempre la colonna
   `Country` e nessuno la leggeva. Ora `retag_foreign_competitions` ri-etichetta ogni riga il cui club gioca
   in un paese diverso da quello della competizione — un test, non una lista di club. Salzburg 26 +
   Klagenfurt 10 → `bundesliga-aut`, `mv_synth` a NULL, residuo zero.
3. **`COACH_SHAPE_MIN`/`FULL` rimisurate e lasciate a 20/60**: con un giudice interno la forma
   dell'allenatore **non batte mai** l'abitudine del club (17% contro 50% sotto i 20 undici, pari a 57%
   sopra gli 80). La ragione della soglia regge, la direzione indicata è di ALZARLA, e le fasce hanno 6-17
   casi — troppo poco per muovere un parametro, e dirlo è meglio che ritoccarlo.

Resta aperto solo `app/`: un README e zero TypeScript. Non è un difetto, è la fase successiva.

### 8/08/2026 (3, chiusura): il pannello misurava su UN CLUB e nessun test poteva vederlo

L'operatore ha ripetuto tre volte «nel toolkit vedo ancora le formazioni tipo non aggiornate» e aveva ragione
ogni volta. Il foglio era giusto; **il pannello no**, e i due erano d'accordo con nessuno.

`SnapshotView.rows` è la ROSA DEL CLUB selezionato (25-43 uomini), e le cinque statistiche di popolazione che
lo leggono — il prior dello shrinkage e i quattro z-score — dicono tutte «this sheet». Quindi
`standing_prior_rounds` tirava verso il rumore di 32 uomini e `level_z`/`level_gap_z` avevano sd quasi nulla:
**tre parametri ADOTTATI storti insieme**. E le cache non si invalidavano mai, quindi il primo club aperto
fissava le medie per tutta la sessione. Sullo schermo: Maignan **99%** di claim contro l'85% di ogni calcolo
fuori dal pannello, e il tabellone col **3-5-2 del predecessore** invece del 3-4-3 di Amorim — ecco perché
Ramos non compariva. Curato con `population()` (il FOGLIO) più l'invalidazione delle cache; verificato
riavviando e **fotografando il pannello vero**: Milan 3-4-3 · 44% con Ramos G. 56%.

**La lezione, che è la più importante della giornata**: ogni test costruiva la view con `rows` = il foglio
intero, quindi l'harness era giusto e il pannello sbagliato, e **la divergenza è invisibile da entrambi i lati
presi da soli**. Quando l'operatore dice «non lo vedo», si fotografa la SUA finestra prima di rispiegargli il
codice.

**Chiusura della sessione (5 commit)**: `2ae2b13` i due denominatori · `31dda8b` il repertorio allenatore per
nome · `52be9a5` `club_levels` · `64b2bcc` la popolazione del pannello · più questa consolidazione.
`SHEET_REVISION` **9**, 330 test, ruff pulito, `backtest --verify` **22/22**, entrambi i fogli e il bundle
(362.069 righe) rigenerati. **Nessuna regola è entrata nel motore**: tutto quello che si è mosso è il
PANNELLO.

**Aperti, in ordine di leva**: la mappa Elo del gate è ancora quella dei 97 club (todolist 9-bis) · 36 righe
del campionato austriaco sotto lo slug `bundesliga` con un voto sintetico tedesco (9-ter) · `COACH_SHAPE_MIN`
/`FULL` tarati sui campioni sbagliati · e `app/`, che resta un README e zero TypeScript.

### 8/08/2026 (2): ogni calciatore deve avere il suo livello, e il Salisburgo è un club vero

Tre richieste dell'operatore, e l'ultima ha risposto alle prime due meglio di come chiedevano (spec «Novità
v9.39»). **Kolo Muani, Ramos e Atta sono titolari; Alajbegovic no, e a dirlo è il dato che l'operatore ha
chiesto di correggere.**

1. **Un club che lo RICOMPRA non è un club che lo ha scaricato.** Kolo Muani pagava lo sconto «prestito»
   0.60 — motivazione: «lo ha mandato via, ed è un suo giudizio» — mentre era lui il prestato e la Juve ha
   speso **41,2 M** per prenderlo. Ora `was_here_before` + **un fee in questa finestra** prende lo sconto
   d'arrivo. Si legge che il fee ESISTE, mai quanto: l'importo è falsificato due volte, l'esistenza è
   un'altra affermazione. Claim 0.414 → **0.515, titolare**.
2. **Il livello dietro una FINESTRA**: `desc_level_elo` esisteva solo per chi cambia club fra due listoni,
   quindi chi non è mai stato in un listone non portava nessun livello, e il ramo «finestra» non prendeva
   neanche i lift adottati. Ora sì.
3. **E il difetto che i primi due hanno scoperto: `club_elo` sono 97 club su 1092.** La sua chiave è
   `fc_club_id`, che esiste solo per chi è stato in un listone — una tabella sul nostro PERIMETRO usata come
   tabella sul CALCIO. Nuova **`club_levels`**: ogni club pubblicato, per anno, chiave canonica di ogni
   grafia, risolta all'ingest. **7.825 righe su 1.092 club**, e i club dei nostri dati senza livello passano
   allo **0,11% delle righe per-partita**. Resa possibile da una REGOLA e non da una lista: ClubElo scrive
   `Koeln`/`Fuerth`/`Suedtirol`, noi teniamo l'umlaut, e una riga di traslitterazione recupera l'intera
   famiglia tedesca (più quattro alias nuovi, ciascuno con le righe che recupera).

**E l'esito è il contrario di quello che la richiesta si aspettava**: Alajbegovic **scende**, 0.476 →
**0.272**, perché il suo livello vero è quello del **Red Bull Salzburg, 1.558**, contro i 1.819 della
Juventus — sale di 260 punti e il canale adottato lo penalizza. Prima non lo penalizzava perché non aveva
livello affatto. *Dare a ogni calciatore il suo livello vero non è un premio: è una misura, e su questo
uomo dice di no.*

⚠️ Due cose dichiarate e non fatte: la mappa Elo che il **gate** legge è ancora quella dei 97 club
(allargarla muove numeri pubblicati e vuole una corsa sua); e **36 righe del campionato austriaco** stanno
sotto lo slug `bundesliga` con un voto sintetico tarato sulla Bundesliga tedesca.

### 8/08/2026: «applica coach_shapes» — era già applicato, e sotto c'era un join sbagliato

Richiesta dell'operatore dopo aver visto le formazioni tipo. **Verificato prima di eseguire, e la diagnosi
del giorno prima era FALSA**: `coach_shapes` entra in `shape_odds` dal **04/08** (commit `4d979c3`, verdetto
misurato 8/17 → 9/17), `_shape_for` **non esiste nel codice**, e la misura che accusava gli «8 club col
modulo del predecessore» leggeva la COLONNA `formation_typical` invece della funzione che disegna. Dei
presunti 8, **tre erano già corretti** (Atalanta il 4-3-3 di Sarri, Milan il 3-4-3 di Amorim, Napoli il 3-5-2
di Allegri) e cinque tenevano l'abitudine del club **per progetto**, col campione del nuovo allenatore a 1-3
undici. **Si verifica la FUNZIONE, non la colonna che le somiglia** — seconda volta in due giorni.

**MA cercando la conferma è saltato fuori il difetto vero, un livello sotto**: `coach_repertoire` joinava
`club_match_lineups.club` — la stringa del parser, «AC Milan», «RB Leipzig», «SSC Napoli» — a
`clubs.canonical_name` con `=`. **13.830 undici completi su 24.042** stanno sotto una stringa che non è un
nome canonico, e il costo cadeva esattamente dove il canale decide: **Gattuso 2 → 79** undici, **Tedesco
3 → 28**, **Spalletti 31 → 107**, e Simeone, Flick, Kompany, Pellegrini, Hütter, Genesio, Mourinho da zero
o uno a carriere intere. Tre allenatori sotto `COACH_SHAPE_MIN` col campione vero molto sopra. **Quarta
istanza** di «un'entità si joina per CHIAVE CANONICA, mai per la stringa con cui una fonte la nomina», e la
più a buon mercato da evitare: `club_context` aveva già `lineup_spellings` in mano per le forme del club.

**Effetto**: Serie A **0 board su 20**, **euro 3 su 35** — Chelsea 4-5-1 → 3-4-3 (Xabi Alonso 20 → 114
undici), Eintracht 4-5-1 → 3-4-3 (Hütter 0 → 119), Real Madrid 4-4-2 → 4-5-1 (Mourinho 1 → 155).
`SHEET_REVISION` **8**, entrambi i fogli e il bundle rigenerati, 329 test. Cade anche una riga di commento:
«Iraola a zero perché la sua carriera sta fuori dai cinque campionati» era il join e non la carriera (il
Bournemouth è in Premier: 115 undici). ⚠️ `COACH_SHAPE_MIN`/`FULL` = 20/60 sono stati tarati sui campioni
sbagliati: la ragione della soglia regge, i numeri vanno rivisti quando ci sarà di nuovo una referenza esterna.

### 7/08/2026 (notte, 4): l'ELO personale non li fa entrare negli undici, DUE DIFETTI sì

Richiesta dell'operatore: **usare l'ELO personale per valutare i nuovi acquisti, così che Ramos, Kolo Muani e
Atta rientrino negli 11**. Portato allo sweep una seconda volta — **ristretto agli acquisti**, che è la
popolazione su cui era misurato, mentre lo sweep lo applicava a tutti e tre scorati su quattro non si erano
mossi (parziale col minutaggio dell'anno dopo: **+0.169** su chi cambia, **+0.039** su chi resta) — ed è
**falsificato anche così**: `default` ottimo pooled 0.10 con guadagno **+0.03%**, un sedicesimo del
pavimento, euro **−0.13%**. `level_rank_weight` resta 0.0. E sul PRODOTTO fa peggio che niente: porta dentro
solo Ramos e ad Atta **toglie** claim (0.576 → 0.511), perché il suo Elo personale è il più basso fra i
centrocampisti viola — cioè peggiora l'uomo che era «l'unico errore grossolano». Gate §7-tervicies, «RIPRESA».

**Girata la domanda — *perché* sono fuori? — la risposta sono DUE DIFETTI di regole già adottate qui**
(spec «Novità v9.37»), e portano dentro due dei tre **senza leggere un Elo**:
1. **il campione di dieci partite era il solo esente dallo shrinkage**: `presence.standing` esce col `return`
   nel ramo della finestra, prima di `standing_prior_rounds` = 10. **Oulai** — zero minuti in archivio, dieci
   partite in Turchia — leggeva **0.609** e prendeva la maglia di **Atta**, 2563 minuti misurati e 0.576. Il
   campione più corto che il pannello calcola era l'unico non ridotto. Curato su `sample_rounds` (dieci
   partite, non le 38 del nuovo club), letto anche da chi sceglie la FASCIA del prior — metà nascosta del
   difetto: chiesta a `contested`, quell'uomo finiva fra i titolari di stagione;
2. **una stagione giocata all'estero era una quota del calendario sbagliato**: i 1320 minuti di **Ramos** sono
   di Ligue 1 (**34** giornate) e venivano divisi per le **38** del Milan — 0.386 dove aveva giocato 0.431, il
   12% di sé regalato, e lo teneva fuori per **0.013** di claim. È «una quota di stagione è una quota del
   CAMPIONATO» (v9.11) rotta per gli uomini per cui la regola era stata scritta. Curato con
   `desc_arrival_origin_rounds` (**`SHEET_REVISION` 7**), letto dal pannello e dallo sweep con la stessa regola.

**FATTO IN PRODUZIONE**: **Ramos dentro** (0.501 → 0.559), **Atta dentro**, **6 formazioni tipo su 20**
cambiate, entrambi i fogli rigenerati e il bundle (361.406 righe). `backtest --verify` **22/22**: `engine_*`
non muove un decimale, perché le presenze del motore sono R13 e non `presence`. **Kolo Muani resta fuori**, e
la ragione è misurata: 1670 minuti al Tottenham e la Juve lo aveva già avuto, quindi paga il `loan_discount`
= 0.60 mentre David gioca 1795 minuti a Torino senza sconto. È una decisione su un parametro APERTO, non un
difetto, e non è stata presa.

**Due lezioni di metodo:**
- **quando un canale non risolve il caso da cui nasce, cerca la CAUSA e non un rimedio più grosso**: il
  livello del calcio giocato non era il problema di nessuno dei tre; due denominatori sbagliati sì;
- **per attribuire un cambiamento serve muovere UNA variabile**: fra il report dello sweep delle 20:29 e
  quello di stanotte erano cambiate due cose (il mio fix e `level_gap_weight` = 0.06 entrato in `DEFAULTS`,
  che è la base di **ogni** altro parametro), quindi ho corso lo sweep una terza volta al codice di HEAD per
  isolare. Esito: **nessun parametro adottato cambia verdetto** per i due fix, e dove un ottimo pooled deriva
  (`standing_prior_rounds` 10 → 6, `standing_weights` 0/1 → 0.35/0.65, `level_weight` 0.06 → 0.04) il guadagno
  out-of-sample dello spostamento è negativo o sotto un decimo del pavimento. Non si tocca niente.

### 7/08/2026 (notte, 3): «cosa differenzia chi riempie la rosa da chi è preso per giocare?»

Una domanda dell'operatore, e cinque ore per rispondere. **Una adozione, tre falsificazioni, e un pezzo di
infrastruttura che resta anche dopo che il suo canale è caduto.**

**ADOTTATO — `level_gap_weight` = 0.06, il SALTO** (gate §7-duovicies). `Elo(club da cui viene) − Elo(club che
lo compra)`: **chi scende di livello sale di ruolo**, e il simmetrico — il titolare di un club piccolo che
sale non gioca. Serie A robust PASS, media **+0.77%** con il **peggior fold POSITIVO** (+0.13%) e 0.06
scelto da tutte e sei le pieghe; euro positivo (+0.35%) e sotto il pavimento. `backtest --verify` **22/22,
zero fallimenti**. Muove 107 righe su 649 (Serie A) e 77 su 1031 (euro), in entrambe le direzioni. Seconda
adozione senza `passes` dopo R19, **meno delicata di quella** — R19 su euro era contro, questa è solo
piccola, e 0.06 è l'ottimo di entrambe le piattaforme.

**FALSIFICATE — tre, e ognuna con un numero:**
1. **il Qt.I come segnale di titolarità**: escluso dall'operatore con un argomento che regge — *è già
   l'opinione dell'autore sulla titolarità*, quindi predirla con quello è circolare;
2. **la quota di partenze di chi cambia campionato** (§7-unvicies), morta **al controllo pre-registrato,
   prima dello sweep**: `eleven()` non legge `desc_start_share`, legge `claim` → `standing`, che il
   denominatore giusto ce l'ha già;
3. **il rango nel reparto per ELO personale** (§7-tervicies): il cross-fit lo azzera su entrambe le
   piattaforme, su euro all'unanimità.
E una direzione dei documenti cade con loro: **il FEE non separa** (6.5 M contro 30 M danno lo stesso esito).

**RESTA L'ELO PERSONALE, per decisione presa prima del verdetto** (spec «Novità v9.36»): 2.796 giocatori,
**99% dei minuti**, e soprattutto la **squadra risolta per ID e non per nome** — `external_stats.club_id`
(backfill offline, 99.8%) più `club_levels_xref`, dove ClubElo è appaiato UNA VOLTA all'ingest. È falsificato
usarlo per le presenze, non averlo.

**FATTO IN PRODUZIONE**: `elo` con il ripiego (il mirror è entrato, snapshot **2026-01-14** archiviato sotto
la sua data osservata — Milan 1787.2 → **1816.5**), **entrambi i fogli rigenerati** e il bundle (361.406
righe, 24 tabelle). Nessun `SHEET_REVISION`: `snapshot.py` non importa `presence`, quindi il foglio non porta
nessun valore che l'adozione muova — si è rigenerato per l'Elo, non per il parametro.

**E LA COSA PIÙ GRANDE CHE QUESTA SESSIONE HA TROVATO NON È UN CANALE**: ricalcolate tutte e venti le
formazioni tipo, **8 club su 20 sono disegnati col modulo del PREDECESSORE** — Atalanta (Sarri), Bologna
(Tedesco), Fiorentina (Grosso), Lazio (Gattuso), Milan (Amorim), Napoli (Allegri), Sassuolo (Aquilani),
Torino (Abate). Il 40% del campionato ha la forma di un allenatore che non c'è più, e il dato per correggerlo
(`coach_shapes`: i 45 undici in 3-4-3 di Amorim) **è già nel foglio**, solo che `_shape_for` ritorna
`formation_typical` e lo dichiara in didascalia invece di usarlo. **È il prossimo lavoro con la leva più
alta.**

**Tre lezioni di metodo, e la prima è costata una pre-registrazione:**
- **un segnale si giudica contro l'ESITO, controllando per ciò che già si sa — mai contro il RESIDUO** di un
  modello che quel «già si sa» lo contiene: una r di +0.204 sul residuo era la regressione verso la media del
  modello stesso, riscritta;
- **un appaiamento di nomi ambiguo è peggio di uno mancante**: «Paris FC» ridotto al token `paris` è
  sottoinsieme di «Paris Saint-Germain», e tre stagioni di Ramos sono state prezzate a una squadra di Ligue 2
  (1.405 invece di 1.970). Trovato perché il numero era impossibile, non perché il codice fosse sospetto;
- **una verifica troppo debole può falsificare una cosa vera**: il quartile-split su 113 righe di una stagione
  dava 39% contro 38%, la parziale su 601 acquisti dava +0.218. Ho bocciato e poi corretto, ed è a verbale.

### 7/08/2026 (notte): sul foglio mantra il SURPLUS era il VALORE

Nata da «verifica che ci siano tutti i dati». Le fonti c'erano — `fetch --plan` dice *every source is
populated* su 19 tabelle, `listone_quotes` copre 12 stagioni Serie A e 9 EuroLeghe con **zero roster 2026-27
senza quotazione** — e quello che la verifica ha trovato non è un buco di acquisizione ma **due difetti nel
deliverable**, visibili solo confrontando i due fogli fra loro. Dettaglio: spec «Novità v9.34» e
[metrica-asta-surplus-v1.md §13](metrica-asta-surplus-v1.md).

- **CHIUSO — il foglio EuroLeghe non aveva alcun livello di rimpiazzo**: `engine_replacement_fm` **0 su
  1031**, `engine_surplus` identico a `engine_value` su **tutte e 1007** le righe prezzate, mentre sul foglio
  Serie A i livelli c'erano (648 su 649). Un'asimmetria fra due fogli che eseguono lo stesso codice è sempre
  **una chiave che non combacia**: i livelli tornano nel vocabolario del **gioco** (`por` 4.33 … `pc` 7.19) e
  cinque punti del codice li cercavano con `role_classic` (`P/D/C/A`), che su mantra non è chiave di niente.
  Ogni lettore prendeva allora il ramo documentato «nessun livello ⇒ ripiega su VALORE» — corretto per il
  gate, che prepara le finestre **senza lega** apposta, e silenzioso per il pannello, che una lega ce l'ha.
  Non era cosmetico: il livello cambia per ruolo, quindi ordinare per VALORE è ordinare un'altra domanda —
  nelle top-10 per ruolo **sopravvivevano 1 o 2 posizioni su 10**. Ora una definizione sola
  (`snapshot.auction_level`) letta da foglio, rango, `est_surplus`, pannello e armonica `estimates`, più la
  colonna **`engine_role_slot`** che dice contro quale slot il numero è misurato.
- **…e correggerlo ha scoperto lo strato che nascondeva**: chi il listone non lo porta non ha codice mantra,
  quindi restava senza livello anche dopo il fix e il suo `est_surplus` continuava a essere un VALORE in una
  colonna di surplus — **11 delle prime 12 righe** del foglio corretto erano uomini stimati. Ora prende la
  **media** del suo gruppo di listone e non il minimo (scegliere il proprio slot migliore è un'affermazione
  su chi gli slot li ha): Cioffi da +48.9 a −4.5, e la top-12 torna fatta di uomini misurati.
- **CHIUSO — `club_elo` fermo a un anno prima dell'asta**: `elo.auction_dates` offriva per la stagione più
  recente solo il 15 agosto convenzionale, che **in preseason non è ancora successo**, quindi tutta la
  finestra 2026-27 leggeva `2025-08-15` — la forza dei club di una stagione e un mercato fa, cioè ciò su cui
  poggiano `desc_level_elo` (R19, adottata il 06/08) e la scheda club. Ora, finché quel giorno è nel
  futuro, si prende lo snapshot di **oggi**: mai una lettura sotto una data che non è arrivata.
- **CHIUSO — chi legge davvero `club_elo`**: chiederselo per scrivere la riga qui sopra ha falsificato una
  frase ripetuta per settimane. **Il modulo portieri NON legge l'Elo**: `predict_fm_goalkeeper` prende il
  tasso gol subiti da `season_stats.goals_conceded` misurati, e il mix 50/50 persistenza+Elo che
  `clubelo-gate.md` adottò in Colab (M2 → M2e) **non è mai stato portato** — è viaggiato il nome, non la metà
  Elo (già registrato in `gate-motore-v1.md` §3-quinquies (a) il 27/07, e rimasto in quattro commenti e nel
  contratto di `export` fino ad oggi). Nemmeno il coefficiente club-a-club degli arrivi (task 3.2) esiste:
  `arrivals.py` non nomina l'Elo. Gli usi veri sono **due**: R19 e la scheda club. `elo.py` si apre ora con
  l'elenco verificato dei suoi lettori; portare la metà Elo è una **proposta per il gate**, non una svista da
  chiudere in silenzio.

`SHEET_REVISION` **5 → 6**, **320 test** (319 passati, 1 skipped), `backtest --verify` **22/22**, e il foglio
`default/classic` non muove un decimale — là i due vocabolari sono lo stesso.

**Poi ClubElo è risultato MORTO e non lento** (`ECONNREFUSED` sull'API *e* sul sito, da due reti diverse), e
ha un **ripiego cablato** — spec «Novità v9.35», **323 test**. Il perimetro prima della cura: le dieci
finestre del gate sono **già in cache**, `rebuild` le rilegge offline, e ciò che manca è **una fotografia
sola**, quella dell'asta 2026-27, letta dal pannello e non da `evaluate`. Il ripiego è deliberatamente un
**mirror della stessa serie** (`tonyelhabr/club-rankings`, colonne di ClubElo intatte, `parse_snapshot`
invariato) e non un altro fornitore: `level_weight` 0.06 è stato spazzolato sulla distribuzione di ClubElo, e
cambiare scala su una finestra di dieci è «una trasformata appartiene alla popolazione su cui è stata
fittata». Archivia la data **osservata** (14/01/2026, non «oggi»), scrive la forma che l'API avrebbe
restituito più un `.origin.txt` accanto, e una data che il mirror non raggiunge **non c'è** invece di essere
approssimata. Verificato contro il file vero: 3.3 s, 630 club, 96 in prima divisione delle cinque leghe.
**Da decidere, non da eseguire**: lanciare `elo` muove `desc_level_elo` sul pannello e vuole fogli e bundle
rigenerati.

**La verifica ha invece confermato sano**: `probable_starter` vuoto è corretto (dal 05/08 la pagina non
contiene **nessun href** di giocatore — non «dati non disponibili»: proprio zero), e le 5.162 righe di
`fvm_history` con `platform='unknown'` sono la migrazione che dichiara ciò che non può attribuire, non uno
scrittore che sbaglia.

### 7/08/2026 (notte, 2): Football Manager come fonte — valutato e scartato, senza misurare nulla

Domanda dell'operatore: le fonti del videogame sono affidabili grazie alla community, si può attingere? È
**ricerca a tavolino e non porta nessun verdetto di gate** — nulla è stato misurato né ingerito. Verdetto
negativo per due ragioni indipendenti dalla qualità del dato:

1. **FM non ha PARTITE.** Il database contiene *entità e struttura*, mai *eventi*: niente calendari reali,
   niente risultati, niente strato per-partita — quelli il gioco li **genera** simulando. L'unità su cui
   questo progetto è costruito è esattamente ciò che FM non può fornire, e nessun canale di estrazione lo
   cambia. Sulle statistiche di squadre e giocatori l'apporto è **zero**.
2. **Il calendario è sbagliato per un'asta di agosto.** FM26 è uscito a novembre 2025, winter update il
   09/03 e il 30/03/2026, FM27 arriva a novembre: il DB più fresco al momento dell'asta ha 4+ mesi e
   **precede tutto il mercato estivo** — quindi proprio per il caso che servirebbe meglio (l'arrivo senza
   storia misurata) conosce il club vecchio. E **FM25 è stato cancellato**, quindi non esiste un database
   2024-25: un buco in mezzo a qualunque serie di finestre.

Non ridondante ci sarebbe poco, e tutto è **giudizio** (quindi ultimo per la regola del 04/08, con
l'argomento di R12/R12b che vale a maggior ragione: lo scout guarda le stesse partite di `fm_prev`): il ruolo
granulare **datato** — Sofascore ignora `seasonId`, i dump FM sono datati per versione, e `player_roles` ha
già PK `(fc_id, valid_from, source)` quindi una source `fm` non richiederebbe migrazione — la scadenza
contratto sulle stagioni passate (`exit_risk` oggi non è gatabile), e injury proneness, l'unico punto dove il
progetto non ha **nessuna** fonte. Per i fatti di club le sorgenti già cablate (FBref, Transfermarkt,
Wikidata, ClubElo) sono migliori e gratis: gli unici esclusivi FM sono le **finanze di club** e le **regole
di tesseramento**. Da tenere a mente perché è la stessa distinzione di sempre: `reputation` è un'opinione,
mentre ClubElo è **misurato dai risultati** ed è adottato (`level_weight` 0.06) — non sono intercambiabili.

Canali censiti (per non doverlo rifare): export dell'intero DB dal gioco in esecuzione — il precedente
documentato è FUTEK su FM24, 474k giocatori e 371 attributi — via plugin BepInEx/IL2CPP o
`FMScoutFramework.dll`; lettori di salvataggio (Genie Scout, che espone gli attributi *nascosti*); il print
della scouting view, parsato da `football-manager-scouting` / `pyscoutfm`; i dump pubblici su Kaggle
(FM21/22/23), unica via che non richiede il gioco. I `.fmf` sono un **vicolo cieco**: sono zip di XML ma
contengono i data update della community, non il DB master. I due fansite sono **canali chiusi e lo dicono**:
`fminside.net` blocca ClaudeBot per nome nel robots.txt (`ai-train=no`), `sortitoutsi.net` ha robots
permissivo ma risponde **403** agli automatismi; nessuno dei due è stato aggirato. Vincolo su tutto: è
contenuto proprietario SI/SEGA e **la repo è pubblica**, quindi qualunque cosa entrasse andrebbe trattata
come la cache fantacalcio.it — gitignorata, mai committata.

### 7/08/2026: «anche la lista euro dovrebbe essere aggiornata»

Sessione di aggiornamento dati, nata da una domanda di controllo. Il foglio euro **era** aggiornato; provando
a dimostrarlo sono venuti fuori **quattro difetti**, tre chiusi e uno lasciato come decisione. Nessuna regola
nel motore: `backtest --verify` **22/22**, **318 test**, `SHEET_REVISION` **2 → 5**. Dettaglio: spec «Novità
v9.32» e «Novità v9.33».

- **CHIUSO la sera stessa, con la migrazione completa** (spec «Novità v9.33»): la **quotazione è un fatto di
  PIATTAFORMA** — i due listoni discordano su **202 Qt.I e 226 FVM** per i ~249 italiani quotati in entrambi
  (Svilar 18/65 Serie A contro 15/56 EuroLeghe) e vinceva l'ultimo che scriveva. Ora `listone_quotes` con
  `platform` nella chiave, più `fvm_history` e **`arrivals`** allargati (un tier è un percentile dentro un
  listone: 82 arrivi su 330 cambiano fascia fra le piattaforme), e il backfill di **tutta la storia** dalla
  cache — 16.375 righe, 12 stagioni Serie A e 9 EuroLeghe, zero richieste. Il rituale «rileggi il listone
  giusto prima di costruire» è morto: `rosters` porta 15/56 e il foglio Serie A stampa 18/65.
- **CHIUSO**: la **rosa live** veniva letta prima del run che la scarica → ogni foglio portava quella del
  giorno prima (35 payload alle 14:24, rose derivate alle 14:22).
- **CHIUSO**: una lettura ora dice **di quale stagione parla** (`probable_starter.season`). La pagina
  probabili serviva l'ultima giornata del 2025-26 a probabilità 1.0, e quelle righe erano 428 su 648 di
  `desc_starter_prob` su un foglio 2026-27, più 415 duelli e 442 asserzioni di rosa. Ora 0 e dichiarato.
- **CHIUSO**: le pagine editoriali **EuroLeghe** (`-euro-leghe`) esistono e nessuno le leggeva — quattro
  leghe su cinque senza segnale editoriale. Ora catturate ogni giorno (oggi ancora vuote: 0 link giocatore).
- **Fonti giù quel giorno**: Transfermarkt irraggiungibile (nessuna pagina rosa dal 29/07 → contratti,
  valori di mercato e infortuni fermi lì) e ClubElo in timeout. fantacalcio.it e il provider funzionano.

**Tre commit, tutti su `master` e pushati**: `dd5d675` (i tre difetti + le pagine euro), `010af4a` (la
migrazione della quotazione per piattaforma), `8ed81e8` (una correzione: dove finisce il tier).
**318 test**, `backtest --verify` **22/22**, `validate` pulito. Dati aggiornati nella catena giusta: listone
(entrambe le piattaforme), `arrivals`, `stats`, `matchdays`, `synth`, `transfers` (+145 righe risolte dal
listone nuovo), `recent_form` sul 2026-27 (25/25 identità, 250 righe), i due fogli (**1031 EuroLeghe / 649
Leghe**, revision 5) e il bundle (24 tabelle, 361.320 righe, `sheet_revision` dentro).

**UNA CORREZIONE DA PORTARSI DIETRO**, perché era mia e cambia una misura: avevo detto che il tier d'arrivo
arriva al surplus attraverso lo sconto di `presence`. Non è vero — lo sconto si basa sull'aver cambiato
CAMPIONATO e `evaluate` non legge `arrival_tier` affatto. Gli 82 arrivi che cambiano fascia fra le
piattaforme finiscono nella colonna `desc_arrival_tier` e nel braccio tier dello sweep, e lì si fermano.
Quindi la v9.33 muove **ciò che l'operatore vede** (quotazione e fascia), non `engine_*`.

**COSA MANCA, in ordine di costo** (dettaglio nella todolist, sezione «Aperti alla chiusura del 7 agosto»):
fonti giù (Transfermarkt, ClubElo) che vanno riprovate a ogni sessione · **803 giocatori** in coda per
`recent_form`, che è una notte · il blocco **tier** dello sweep scaduto (i pool sono cambiati) · le probabili
vuote finché la stagione non parte · e il pezzo grosso: **`app/` è un README e zero file TypeScript**, mentre
il contratto dati è pronto e verificato. Se conta il prodotto all'asta, la cosa da fare è l'assistente
(`assistente-asta-v1.md`); se contano i dati, è la notte di `recent_form`.

### 6/08/2026: quattro adozioni, sei falsificazioni, e il gate che ora vincola il prodotto

Dodici commit, tutti su `master` e **pushati**. **313 test**, `backtest --verify` **22/22**.
Dettaglio: spec «Novità v9.30», gate §7-duodecies → §7-vicies (ogni sezione ha la griglia scritta PRIMA e il
verdetto DOPO).

**ADOTTATE — quattro, tutte da un harness e mai a mano:**
1. `presence.level_weight` = **0.06** — l'Elo del club dove ha giocato i minuti, solo per chi ha cambiato
   club. Serie A robust (+0.93%), euro positivo su tutte e 4 le finestre. Minimo interno su entrambe.
2. `presence.standing_prior_rounds` = **10** — lo standing non sapeva su quante giornate era misurato.
   euro **strict E robust** (+2.82%), Serie A robust. Il risultato più forte della giornata. Col prior
   **condizionato alle giornate**, che corregge la lettura (Milik 26% → 10%) senza migliorare la previsione.
3. **R19** su `default` — il livello dentro `engine_pv_pred`, cioè la strada perché l'esperienza arrivi al
   SURPLUS. **Prima regola adottata sul solo verdetto ROBUST**: 9 finestre su 10 migliorano, media +1.7%,
   liste d'asta più lunghe. Su euro è contro e resta fuori. Da riguardare a ogni gate: se peggiora, esce.
4. **R18** su `euro` — la carriera nella fantamedia prevista (`fm_prev` + media 5 anni, entrambe ristrette
   verso l'àncora). 420 righe su 979 si muovono: Kane 8.758 → 9.215, Haaland +0.48, e chi ha avuto una
   stagione sola scende. Adottata perché **euro/mantra passava già coi criteri vecchi e senza i portieri**.

**FALSIFICATE e scritte — sei**: il bonus qualità fra stagioni · l'esperienza da panchina · l'Elo della
competizione · il bonus ai nuovi acquisti (a cinque sigma, il contrario dell'ipotesi) · lo sdoppiamento del
discount cross/intra · la qualità di carriera in selezione. E tre delle mie previsioni pre-registrate erano
sbagliate, lasciate agli atti.

**IL GATE È CAMBIATO, e va saputo prima di leggere qualunque verdetto vecchio:**
- lo **strict** ha la soglia sulla MEDIA e non su ogni finestra (prima bocciava R3, R7 e R3c, che sono in
  produzione);
- **FM e VALUE** sono letti sull'aggregato, alla tolleranza che avevano già;
- **`captured_not_harmed`**: il gate ora vincola anche **quanto valgono** le liste, non solo quanti nomi.
  Chiude il buco che R3d aveva esposto. Misurato prima di accenderlo: **0 verdetti su 120 cambiano**.
- ⚠️ **Una contaminazione dichiarata**: il criterio su FM/VALUE è nato guardando R18 bocciata. I criteri
  restano (giusti per ragioni indipendenti); il verdetto di R18 su euro/classic no — è per questo che
  l'adozione poggia su euro/mantra, che passava prima.

**DATI E ROSE**: identità gemelle dei club **fuse** (109 → 106), con i trasferimenti fantasma che ne
derivavano **ri-derivati** (Newcastle 26 → 3 arrivi, Eintracht 28 → 12). La rosa live del provider è
l'autorità, con due guardiani (`_club_key` e `SQUAD_COMPLETENESS` 0.90). **Chi è partito non è più nella rosa
del suo club** né nell'undici né nel claim — resta solo nella lista d'asta col `⇥`, perché è contro il listone
che si offre.

**FOGLI PRONTI**: `auction-snapshot-2026-27-euro-mantra-euroleghe-2026-08-06` (979) e
`...default-classic-leghe-2026-08-06` (645), revisione **2**, con indisponibili e rose live al 06/08.

**COSA RESTA APERTO** (nessuno con scadenza):
- `window_standing` non è scoreabile: lo sweep non ricostruisce la finestra di forma per una stagione
  passata (`KNOWN_GAPS`, gate §7-octies ferma per un'omissione dichiarata).
- Transfermarkt non serve più le pagine rosa e lo fa **in silenzio** (`if html:` inghiotte il fallimento):
  la data resta al 29/07 mentre le altre due fonti sono al 06/08.
- R18 non è adottata su `default` e R19 non lo è su `euro`: le due piattaforme si comportano diversamente
  e ogni conclusione va detta al plurale.
- L'assistente d'asta (`assistente-asta-v1.md`) resta **progetto e non codice**, calendario facile incluso.

## STATO AL 5 AGOSTO 2026 (fine sessione) — LEGGI QUESTO PRIMA DI TUTTO

Le sezioni sotto sono un **registro cronologico**: dove una contraddice questo blocco, vince questo.

### ULTIMO IN ORDINE DI TEMPO — 5/08/2026 sera (2): la rosa LIVE decide chi è in rosa, e un audit dei .md contro il codice

Dettaglio in spec **«Novità v9.30»**. 306 test, `backtest --verify` **22/22**. **Nessuna regola del motore
tocca, nessun verdetto del gate cambia** — è tutto strato descrittivo, pannello e documentazione.

1. **La rosa live del provider è la fonte sulle rose, con due guardiani.** Si aggancia con `_club_key` (prima
   con la stringa) e parla solo se il payload copre `SQUAD_COMPLETENESS` = **0.90** della rosa identificata:
   misurata su 172 assenze, precisione 57.6% → 83.1%. Righe marcate 93 → 48, zero nuove.
2. **L'undici non schiera un partito** (`eligible`), in entrambi i modi; la riga resta al suo club col `⇥`.
3. **Identità gemelle in `clubs`: FUSE** (Newcastle 12/60, Eintracht 22/59, PSG 4/37). `fc_club_id` era un
   surrogato coniato sulla stringa esatta; ora `matching.club_identity` + `merge_twin_clubs` in
   `apply_schema`. 109 → 106 club, 4 righe `club_elo` duplicate perse e contate, Eintracht da 0 a 70 spell.
5. **La colonna FM mostra la stima col `~`** quando il core non può prevedere, ordinamento incluso.
6. **`other_platform` applicata fuori popolazione** (Kolo Muani, euro 25-26 = Tottenham): eleggibilità ora
   dal campionato del roster, 13 righe su 651, errori in entrambe le direzioni.
4. **Audit**: 1083 nomi di codice citati dai .md verificati + 30 conclusioni; tutte le costanti pubblicate
   riprodotte; corretti `squad_size`→`squad_slots`, `match_votes`→`match_ratings`, i nomi del pricer greedy
   (`SIDE_PRICE`/`_fit_across`), README 232→306; il calendario facile marcato **progetto e non codice**.

### ULTIMO IN ORDINE DI TEMPO — 5/08/2026 sera: l'ASSISTENTE D'ASTA, progettato prima di scrivere codice

Sessione interamente di ragionamento e misura, **zero codice di prodotto**. Tutto in
**[assistente-asta-v1.md](assistente-asta-v1.md)** (23 sezioni — il documento da leggere prima di toccare l'app)
più il nuovo **`config/mantra_modules.json`**.

**La lega dell'operatore, dichiarata**: 12 partecipanti · **euro/mantra** · rosa di **25 = 2 «porte» + 23** senza
quote per ruolo · **R-Factor** (quindi D-Factor spento) · **draft** con ordine per FVM di rosa crescente, barriera
di giro, parità risolta sul singolo più caro e poi sull'ordine del primo giro · si scegli fino a completare la
rosa, e l'app **impedisce** la scelta che la renderebbe non chiudibile.

**Tre conclusioni di modello, in ordine di peso:**
1. **Una rosa non vale la somma dei suoi giocatori**: vale la somma sulle giornate del **miglior undici LEGALE
   schierabile** (massimo sui moduli × massimo sulle assegnazioni). Una definizione che assorbe rimpiazzo
   personale, scarsità di ruolo, flessibilità e il caso «5 Pc».
2. **Il regolamento Mantra è configurazione, non misura** — undici moduli, caselle **tipate** e ibride, matrice
   delle sostituzioni; trascrizione **verificata 11/11** contro la regola ufficiale 5+5 e contro i nomi dei moduli.
   Da qui, senza fittare niente: un **`Pc` sta in massimo 2 caselle** (in 7 moduli su 11 in una sola) contro le 3
   di un `A`; la **difesa scegli una FAMIGLIA** (5 moduli a tre dietro, 6 a quattro) e **5 difensori le tengono
   vive entrambe**; `Dc` è l'unico difensore con un posto in ogni schema.
3. **In un draft il prezzo è pubblico e fisso** (l'FVM), quindi cadono tetto di rilancio e modello di prezzo di
   mercato — e il draft, a differenza dell'asta a rilanci, **è simulabile, quindi pre-registrabile**.

**Misure nuove** (cautele nel documento): vantaggio campo Serie A **29 punti Elo** su 1140 partite — non i 60-100
di convenzione, ed è una **costante, non una serie annuale** · difficoltà del calendario **6.7 contro 147** su una
stagione (morta per ordinare il draft) ma **113 dentro una singola giornata** (viva per la scelta settimanale della
porta), e il calendario euro **raddoppia** lo spread saltando 7 giornate su 38 · vantaggio di campione **1.64×**
(24.5 presenze contro 18.4) · numerosità dei ruoli che varia ~10% a stagione, e **`b` non esisteva prima del
2024-25** · 24 porte su 46 club = **52% del pool**, e il formato è **impossibile su Serie A** (24 > 20).

**Due difetti trovati, entrambi silenziosi**: `Config._league_setup` **cancella** la dimensione «senza quote»
(fonde sempre `DEFAULT_SQUAD_SLOTS`, quindi la rosa da 25 con 2 porte verrebbe letta 3P/8D/8C/6A → livelli di
rimpiazzo verosimili e **sbagliati**; per questo la lega **non è ancora in `my_leagues`**); e un **join per NOME**
in una mia misura aveva perso Milan, Roma e Napoli (`AC Milan` ≠ `Milan`) — le medie aggregate hanno tenuto, la
graduatoria per club no. Lezione promossa in `CLAUDE.md`.

**Prossimo passo definito** (§16.4): tre modifiche piccole e insieme — `config.py` (`squad_slots` — FATTO, quote opzionali,
blocco `keeper`, `factor`, blocco `auction`), `features.roster_depth` che **rifiuta** invece di inventare, poi la
lega dichiarabile. Dopo: il refactor dell'assegnamento fuori da `gui.py` e il simulatore di draft.

**Acquisizioni che bloccano numeri veri**: listone **euro 26/27** · **calendario** della stagione · **ClubElo
giornaliero + club fuori perimetro** (fuori dalla Serie A l'avversario ha un Elo in ~metà dei casi) · la **scala
dell'R-Factor** dalle impostazioni di lega · lo **storico FVM** dal dettaglio calciatore.

### 5/08/2026 sera: UNA lista sola, filtrabile — la decisione presa col numero davanti

Spec **«Novità v9.29»**, gate §7-undecies. Rovescia il punto 2 del blocco sotto, e lo rovescia **l'operatore, non
una misura**: «*stimati e misurati vanno insieme ma aggiungiamo la possibilità di filtrare gli uni e gli altri*».
`auction_view(..., include=...)` con `all` (come apre il pannello) · `measured` · `estimated`; il selettore
**Include** **ri-disegna e non ricalcola** (l'aritmetica gira su dati già preparati), quindi il filtro è
istantaneo e la scelta torna reversibile *a ogni sguardo* invece che a ogni build. Il **gate non passa mai**
`estimates` né `include`: i suoi percorsi restano quelli di sempre.

- **Il costo resta a verbale e il pannello continua a dirlo**: ordinarli insieme abbassava il SURPLUS catturato
  su **10 finestre su 10**, media **−12.40%**, peggiore **−30.34%** (gate §7-undecies). La decisione è stata
  presa con quel numero davanti, che è esattamente il modo in cui questo progetto vuole che si decida.
- **Il modo in cui falliscono è VARIANZA, non bias**: Douglas Luiz previsto +28.6 e reso **−3.2**, contro
  McTominay +16.0 e reso **+50.2**. Media negativa, dispersione enorme — quindi un filtro serve più di un
  divieto.
- **Invariante che sopravvive al filtro**: qualunque sia `include`, **ogni cifra del blocco è calcolata sulla
  lista che il filtro ha prodotto**. È la lezione del punto 3 sotto, che aveva già morso una volta: una lista
  mostrata le cui metriche descrivono un'altra lista *sembra* misurata, ed è peggio di nessuna metrica.

### 5/08/2026: stimati e misurati INSIEME, con un filtro (decisione dell'operatore)

«Stimati e misurati vanno insieme ma aggiungiamo la possibilità di filtrare gli uni e gli altri» — spec
**«Novità v9.29»**. Presa **col numero davanti**: la misura di §7-undecies (insieme costa −12.40% di SURPLUS
catturato su 10 finestre su 10) resta scritta accanto alla scelta, non cancellata.

1. **`auction_view(..., include=)`**: `all` (default) · `measured` · `estimated`. Il filtro decide chi entra in
   classifica, e **ogni cifra del blocco è calcolata dalla lista che il filtro produce** — il vincolo che la
   sezione qui sotto ha imparato a caro prezzo.
2. **Tre liste in una passata**, quindi il selettore **Include** ri-disegna e non ricalcola: istantaneo.
3. **La scelta è visibile mentre la si usa**: la riga di stato dice quale filtro è attivo, l'intestazione del
   ruolo quanti dei dieci sono stimati (`~`).
4. **Il gate non passa mai** `estimates` né `include`: `backtest --verify` 22/22.

### 5/08/2026: la stima messa alla prova (la parte «non classificata» è superata dal blocco sopra) *(punto 2 superato dal blocco sopra)*

Nuovo comando **`estimates`**, gate **§7-undecies**, e un verdetto che ha cambiato il disegno fatto un'ora prima.

1. **La misura**: la vista d'asta due volte su ogni finestra, con e senza stime. Su Serie A il SURPLUS catturato
   **peggiora su 10 finestre su 10**, media **−12.40%**, peggiore **−30.34%**, e i nomi in comune scendono
   (Tm4 17 → 12). Il criterio scritto prima non è soddisfatto: gli stimati **scalzano** uomini misurati. Su euro
   **0 stimabili** su ogni finestra, quindi quel +0.00% **non è un PASS** — R0c prezza già tutti.
2. **Applicato**: gli stimati escono dalla classifica e sono **offerti a parte**, sotto i dieci, con `~`, base e
   penalità. Ogni riga continua ad avere un numero (foglio e tabella rosa): quello che la misura ha rifiutato è
   che un numero ricostruito prenda il posto di un uomo misurato. Casi: Douglas Luiz +28.6 → **−3.2 reale**,
   Rugani → **non ha mai giocato**, contro McTominay +16.0 → **+50.2**. Media negativa, varianza enorme.
3. ⚠️ **Lezione, e ha morso nella stessa ora**: la prima implementazione univa gli stimati alle righe MOSTRATE
   lasciando `captured`/`hits` sulla lista gatata, e la misura stampava **+0.00% su 10 su 10**. Una lista
   mostrata le cui metriche descrivono un'altra lista è peggio di nessuna metrica: *sembra* misurata.

### 5/08/2026: la LISTA d'asta ordina anche gli stimati (superato dal blocco sopra)

Spec **«Novità v9.27»**. Completa «ogni calciatore DEVE avere il suo SURPLUS» **dove si decide**: il foglio
dava 629 numeri su 629 e la lista d'asta ne ordinava **346**.

1. **Un solo ranker**: `auction_view(..., estimates=None)`, e il gate non le passa mai — `backtest --verify`
   22/22, più un test che pretende la vista **identica** senza stime. Le costruisce il layer del foglio, non
   una seconda cascata.
2. **Marcate**: `~` davanti al numero, l'intestazione dichiara i due insiemi («of 134 the engine could price
   **+ 109 estimated (~)**») e la riga di stato conta entrambi (361 prezzati, **488 stimati**).
3. **Misurato**: gli stimati che entrano in una top ten sono **quattro** — Martinez Quarta #5 (`older`),
   Berisha #4 e Kostic #7 (`shrunk`), Santos A. #7 (`shrunk`). Gli altri restano sotto: la penalità li ordina
   dove la loro incertezza li mette.

### 5/08/2026: NESSUN job settimanale, e la richiesta è chiusa

Decisione dell'operatore: «il job ogni settimana non serve, elimina questa richiesta». È la logica del 29/07
sulle probabili portata a conclusione: un'asta iniziale è in **agosto**, quando la pagina non esiste ancora, e
quello che gli editor aggiungono arriva **tardi** (le parole dell'allenatore) — quindi la lettura che vale è
quella presa **subito prima** della sessione. `starter_prob` 0/1453 sul gate è **vuoto per scelta**.
Applicato: `scripts/weekly-snapshot.ps1` → **`scripts/refresh-editorial.ps1`** (rilancio a mano, via la
macchina dello scheduled task), e `bootstrap`/README non chiedono più di registrare niente. Quello che
sostituisce il job è **dichiarare l'età** dell'evidenza (`evidence_age`) e leggere la **rosa viva** del
provider: una rosa vecchia si vede come una data invece di essere creduta.

### 5/08/2026 notte: la fonte «in tempo reale» sulle rose era già in cache

Richiesta dell'operatore («troviamo un ente affidabile e aggiornato in tempo reale»), spec **«Novità v9.26»**.

1. **L'ente esisteva**: `/team/{id}/players` del provider, **una richiesta per club**, scaricata **ogni giorno**
   per i ruoli granulari e **datata**. Il payload del **28/07** per il Napoli ha 46 giocatori e **non**
   Gutierrez, mentre `fc_site` lo elencava il **04/08** e la pagina Transfermarkt il **29/07**: sapeva della
   partenza una settimana prima. Ora è la **quarta fonte** di `squad_snapshot` (1546 righe), letta dallo stesso
   parser dei ruoli — zero richieste nuove.
2. **Il suo potere è l'ASSENZA**, che nessun'altra fonte nostra sa esprimere: una pagina rosa dice chi c'è, un
   trasferimento dice un evento, solo una rosa intera dice «non c'è più». Due segnali indipendenti: **46** dal
   trasferimento + **47** dall'assenza; il foglio passa da 629 a **651** righe.
3. ⚠️ **La guardia**: chi non ha identità del provider manca da ogni payload per costruzione, quindi l'assenza
   è evidenza solo per chi il provider sa identificare — «vuoto = ignoto, mai zero». E un acquisto fatto dopo
   la data del payload legge come assente finché non lo si rilegge: per questo il flag porta **la data**.
4. **Il foglio dichiara e non sposta**: il listone resta l'autorità del gioco su chi è in rosa.

### 5/08/2026 notte: le rose contro i trasferimenti, e una PK che perdeva un evento

Spec **«Novità v9.25»**, nata da «Gutierrez non è più nel Napoli». `backtest --verify` 22/22.

1. **Ogni fonte diceva Napoli** (listone 26/27, `fc_site` 04/08, `transfermarkt` 29/07) e a sapere era il
   **trasferimento** — Napoli → Bayer 04 Leverkusen, 01/07/2026, 26M — che non era nel DB perché `transfers`
   non era stato rilanciato per l'estate 2026. Rilanciato.
2. ⚠️ **Un OUT non è una partenza**: leggendo il solo OUT il foglio inventava **82** partenze, fra cui Hojlund
   («Napoli → Manchester United») e Malen, perché la pagina di un club porta lo **stesso uomo due volte** con
   la data del 1 luglio — rientro dal prestito (OUT) e acquisto definitivo (IN). Regola corretta: OUT dal suo
   club **e nessun arrivo che lo riporta lì** → **51** righe, Hojlund e Malen fuori, Gutierrez dentro.
3. **La causa era la PRIMARY KEY**: `(fc_id, date)` con tutti i movimenti estivi datati `YYYY-07-01` schiacciava
   le due righe e teneva l'ultima scritta. Ora la chiave porta il **controparte**, con migrazione esplicita
   (`widen_transfers_pk`); re-ingest offline dalla stessa cache: **2949 → 4383** trasferimenti, **399 → 523**
   datati 2026. Stessa forma del difetto già scritto per `match_ratings`.
4. **Come si vede**: `desc_left_for` / `desc_left_on`, una nota di foglio, e il marchio **⇥** nel pannello. Il
   foglio **non sposta** il giocatore: il listone è l'autorità del gioco su chi è in rosa, e dove due fonti
   discordano si dichiara, non si indovina.

### 5/08/2026 notte: OGNI calciatore ha un SURPLUS, penalizzato e dichiarato

Regola dell'operatore, spec **«Novità v9.24»**. `engine_*` non si muove di un decimale (`backtest --verify`
22/22): la stima è una **quarta** classe di colonne, `est_*`, in `engine/estimate.py`.

1. **Cinque gradini, ognuno con la sua misura**: l'altra piattaforma (differenza media **+0.001**, 92% entro
   0.3 su 870 stagioni-giocatore) · una stagione più vecchia (MAE 0.396 a t-2 contro 0.368 a t-1) · la
   stagione sottile **mescolata** col livello del club per quel ruolo (spread 1.36 sugli attaccanti, 0.25 sui
   portieri: Juve-contro-Verona, quantificato) · l'àncora di club come pavimento. ⚠️ L'FM-equivalente estero
   **non** è un gradino: R1 ha perso contro l'àncora su cinque finestre su sei.
2. **Stessa aritmetica del motore × la confidenza**, quindi una riga gatata esce identica e una stimata è
   confrontabile; la penalità moltiplica il **surplus** e non la fantamedia; e ogni riga stimata porta base,
   penalità e **nota in parole** (nel pannello: `~` più tooltip).
3. **Un numero inventato sostituito da una misura**: mezzo calendario di presenze per un ignoto faceva valere
   un portiere sconosciuto più del terzo portiere del suo club. Misurato: **0.289** del calendario (default) per
   chi non ha stagione precedente, **0.421** per chi ne ha una sottile — il sottile gioca più dell'ignoto.
4. **Effetto**: Serie A da **346 su 629** righe con un surplus a **629 su 629**; euro tutte `core`, perché là
   R0c prezza già tutti.

### 5/08/2026 sera-notte: tre segnalazioni dell'operatore sul foglio

Spec **«Novità v9.23»**. Una ha trovato un buco vero.

1. **Il nome del foglio dice piattaforma e game** (`29/07 · 2026-27 · euro/classic`): una lega dichiarata fissa
   entrambe, quindi il selettore League non ne mostrava nessuna. Combobox da 44 a 58: Tk taglia.
2. ⚠️ **`evidence_age` — e il buco**: «Gutierrez non è più nel Napoli». Il foglio aveva ragione su quello che
   AVEVA (entrambe le fonti dicevano Napoli: `fc_site` 04/08, `transfermarkt` **29/07**) e nessuno diceva che
   quell'evidenza era vecchia. Peggio: **`transfers_history` non aveva un solo movimento datato 2026** — il più
   recente è **2025-07-01** — quindi l'intero mercato estivo che ha costruito queste rose non era nel DB, e con
   esso origine e cifra di ogni arrivo. Ora il manifest e le note dicono l'età dell'evidenza **per fonte** e se
   il layer trasferimenti ha almeno un movimento nella finestra. `transfers` è stato rilanciato.
3. **`engine_unpriced_reason` — una cella vuota dice QUALE affermazione è**: «molti giocatori senza Surplus (es:
   Boga, Kolo Muani) … oppure Stones, Pavard». Sono **due** fatti diversi: «only N votes of 15» (misurato qui e
   troppo poco: Boga 13, Pavard **1**) e «no season on this platform» (il suo calcio è sull'altro calendario:
   Kolo Muani **23 voti euro** e zero Serie A, Stones 3). Sul foglio Serie A: **283 righe su 629 = 157 + 126**.
   Su euro non si vede perché **R0c** li prezza all'àncora; su default R0c non è adottata. Convertire il secondo
   caso è **R1**, respinta due volte dal gate.

### 5/08/2026 notte (2): un posto in attacco è il lavoro di un attaccante

Spec **«Novità v9.22»**. Chiude l'ultimo caso della famiglia «attacchi senza un attaccante».

1. **La misura ha ridefinito il numero prima della regola.** «4 board su 394» mescolava i board che il MODELLO
   seleziona con quelli che la **fonte dichiara**: in `next`, con almeno 11 probabili, il board **è l'undici
   degli editor**. Separati: **516 del modello** contro **150 dichiarati**, e sui primi gli offender erano
   **6 attacchi senza attaccante** (tutti il **Lilla**, lo stesso uomo) e **1 centrale su una fascia** della
   trequarti (Manchester United — `_flanked` copre M e A, non T: aperto e scritto). ⚠️ Attribuire al modello un
   board dichiarato gli attribuisce scelte degli editor: l'Atalanta `next` schiera Sportiello (0.03) con
   Carnesecchi (0.82) fuori, ed è la probabile.
2. **`_fronted`**: il MESTIERE decide chi è eleggibile per un posto d'attacco (`_off_the_front`, la definizione
   che già esisteva) e il claim decide fra i candidati, col tetto dei due override esistenti. ⚠️ **Non** è la
   strada che la todolist proponeva («la riga di centrocampo cede un posto, il modulo esce 4-4-1-1»): cedere un
   posto cambia la FORMA, che ha già un unico proprietario (`_reshape`), e restare nella stessa valuta evita un
   terzo metro. Il Lilla esce 4-5-1 con **Fernandez-Pardo** davanti.
3. **Costo, misurato disegnando ogni board due volte**: **67 su 666 cambiati**, claim medio **−0.108**, peggiore
   −0.480. Attacchi senza attaccante **6 → 0**, e le asserzioni dei board già giudicati dall'operatore restano
   verdi — quella è la guardia, non il conteggio.

### 5/08/2026 notte: l'investimento erano due metà, e nessuna arriva al pavimento

Gate **§7-septies**, follow-up pre-registrato ed eseguito. **NON ADOTTATA, famiglia CHIUSA**: `value_weight` e
`shrink_weight` restano **0.0**.

1. **Il bordo era la griglia, non la curva.** Estesa a 0.50 → 3.00 (tetto motivato: un titolare è ~0.09 del
   valore della sua rosa, quindi 3.0 aggiunge 0.27 di stagione), la curva **gira dentro** il misurato: migliore
   **0.75** su `default` (robust PASS, +0.56%) e **0.50** su euro (+0.34%, sotto il pavimento). A 3.0 il termine
   costa più che essere spento.
2. **E il marginale dice che quel PASS non è l'investimento.** Col null accesa al suo migliore e il valore
   spazzato sopra, misurato **per fold contro il punto solo-null**: **+0.41%** su `default`, **+0.045%** su
   euro, entrambi **sotto il pavimento** di 0.5%. I conti tornano: null +0.37% + valore +0.41% = il +0.78% che
   la forma grezza otteneva in robust PASS — **era la somma di due effetti entrambi sotto il pavimento**, che è
   esattamente ciò che il pavimento esiste per rifiutare. Quel poco che si vede sopra i minuti è **ritorno alla
   media**.
3. **Due cose di metodo**: `sweep.BASELINES` — una famiglia può dichiarare contro quale punto si misura, e il
   marginale si misura **per fold** contro il solo-null (sottrarre due medie pooled darebbe un altro numero); e
   ⚠️ **un errore mio nella pre-registrazione**, scritto invece che aggirato — «margine sul secondo positivo»
   non era esprimibile con le metriche del report, perché quel margine confronta il valore **in uso** (spento)
   col miglior rivale. Un criterio va scritto prima **e** va verificato che sia esprimibile.
4. **Cosa la riaprirebbe**: non un'altra griglia (due corse coprono 0.005 → 3.0), ma un proxy che **non sia già
   nei minuti** — gli ingaggi, che nessuna fonte pubblica — o la **variazione** del valore dentro la stagione.

### 5/08/2026 sera: il portiere ha un FM-equivalente, e serviva un numero solo

Gate **§7-decies**, spec **«Novità v9.21»**. **ADOTTATO** — non è una regola del motore, è il layer che
instrada i tier degli arrivi — e `backtest --verify` resta **22/22**.

1. **Il fantavoto di un portiere è un'IDENTITÀ, non una stima**: su **16.017** righe con entrambi i voti, su
   entrambe le piattaforme, `mv − gol_presi + 3·rigori_parati − cartellini` ha residuo **0.000 nel 100% dei
   casi**. E il **bonus imbattibilità non esiste** (residuo 0.000 anche sulle 4.872 partite chiuse a zero),
   mentre `config/scoring_config.json` lo dichiara 1.0: `ratings._fantavoto` già lo escludeva, e ora il
   commento del config porta la misura. Quindi mancava **un numero solo**: i gol presi.
2. **Erano già in cache.** `goalsConceded` e `saves` sono chiesti al provider dal primo giorno e **buttati al
   parse**, perché `external_stats` non aveva le colonne. Migrazione + parse + re-ingest **offline**: 11.725
   righe su 11.732.
3. **Verdetto, col criterio scritto prima**: PASSA su **201** portieri-stagione (euro) e 51 (default) — bias
   **−0.00…−0.18**, MAE **0.084-0.191** contro **0.214-0.336** dell'àncora, **89-100% entro 0.3** contro lo
   **0%** della formula dei movimenti (che sugli stessi uomini rifà +0.82…+1.22: escluderli era giusto).
4. **Il guadagno è piccolo e la sezione lo aveva dichiarato prima**: arrivi che guadagnano un equivalente
   **1/15/19/8** per stagione, totale **2045 → 2128**, e parte di quei portieri il core li prezza già.
5. ⚠️ **Daffara resta NULL, e servono DUE cose** (corretto la sera stessa: la prima stesura ne dichiarava una
   e sarebbe stata una promessa falsa). I **gol presi**, che esistono solo come aggregato di stagione delle 5
   leghe e per partita non più — le cache di giornata e di giocatore sono **distillate**, lo score è stato
   scartato; **e** un **voto base convertibile**, che per la Serie B il gate ha **rifiutato** (§7-nonies, δ
   −0.181 battuto dall'àncora). Quindi un portiere fuori perimetro resta NULL per **due decisioni misurate**,
   non per codice mancante. Conservare lo score resta giusto e serve dove le due si incontrano: le **coppe**.
6. **§7-sexies rimisurata** sulla popolazione nuova (707 → 2128 arrivi con equivalente), ed è la prima verifica
   quantitativa di «il collo di bottiglia è la copertura»: su **euro** `measured_first` resta CONFIRMED col
   margine **cresciuto** (+0.89% → **+1.00%**, 7 fold su 7), su **default** la quotazione scende da +0.42% a
   **+0.32%** — sempre sotto il pavimento, margine negativo sul secondo. Più calcio misurato, meno vantaggio
   alla quotazione, senza che nessuno abbia ritoccato un parametro. Non adottato nella stessa corsa:
   `t3_price` prende un robust PASS a **0.20** su euro (bordo della griglia, margine negativo sul secondo)
   mentre su `default` il migliore è **0.60**, il bordo opposto — i due estremi della stessa griglia sono come
   si presenta un parametro senza segnale.
7. **La catena, di nuovo**: `positions --layer reparse` azzera `mv_synth`, e gli arrivi con equivalente sono
   crollati a **716** finché `synth` non è stato rilanciato. Chi rifà `positions` rifà `synth` e poi `arrivals`.

### 5/08/2026 pomeriggio: esiste UNA lista con cui andare all'asta

Spec **«Novità v9.20»**. Toolkit **0.9.0**, **297 test verdi**. **Nessun verdetto del gate cambia e nessun
numero del motore si muove**: stesso prezzatore, stessi parametri fittati su un'altra finestra. Chiude la voce
che questo file portava aperta da tre sessioni come «la più importante».

1. **Il blocco non era il modello, era il CALENDARIO — e stava nel chiamante.** Le presenze sono una **quota**
   del calendario bersaglio e una stagione mai giocata ha `matchdays_target = 0`: ogni `pv_pred` era 0, quindi
   VALORE e SURPLUS erano 0 e la lista era **ordinata da niente** (misurato: Svilar `pv 0.0`, ordine per
   `fc_id`). Il ripiego «il calendario è quello dell'anno scorso» esisteva già, ma viveva in `snapshot.build`,
   cioè in **UN** chiamante — e il secondo chiamante, il tab Auction, si prendeva un listone intero a zero. Ora
   sta in `snapshot.engine_predictions`, **dove si decide il prezzo**. Dopo: Svilar `pv 32.1`.
2. **La lista LIVE**: prima voce del selettore Season, **`2026-27 · LIVE`**, una tabella sola per ruolo,
   prezzata dalla **stessa funzione del foglio Snapshot** (fit iniettati per non preparare due volte le undici
   finestre; la **scelta** del fit resta là dentro) su **rose reali**, perché il listone di agosto è parziale.
   Non dichiara nomi in comune né quota del top-10 perfetto — nessuno ha giocato, sarebbero zeri travestiti da
   punteggio — e dichiara invece `357 of 806 players priced`, le note del motore **a schermo** e la profondità
   prezzabile per ruolo. Le colonne dell'esito sono **assenti**, non vuote. Serie A/classic per SURPLUS: Svilar
   32 · Dimarco 27 · Paz N. 21 · **Malen 45**.
3. **Tre misure di layout, due direzioni scartate**: entrambe le colonne elastiche lascia 300 px vuoti a
   `Player`; nessuna elastica **taglia** `Pair` a 170 px (via il ΔQt.I) — «non stretta, assente», difetto già
   pagato; `Pair` elastica è la giusta, una volta allineata l'intestazione alle sue celle.
4. ⚠️ **Difetto nei TEST trovato da un crash**: `Config(data_dir=tmp_path)` **non sposta `db_path`** (campi
   indipendenti), quindi un test di geometria apriva il **DB reale da 313 MB** e il thread del tab Auction
   sopravviveva al test morendo nel garbage collector. Quattro punti reindirizzati.

### 5/08/2026 notte: il listone di AGOSTO, il buco che si vede, e tre muri identici

Spec **«Novità v9.19»**, verdetti nuovi nel gate **§7-septies**, **§7-octies**, **§7-nonies**. Commit
`5123413` → `38e5210` (dieci). Toolkit **0.8.0**, **295 test verdi** (1 skip: chiede un display), ruff pulito. **Nessuna regola è entrata
nel motore**: i set adottati restano `euro R0c+R3c` · `Serie A R3+R7+R13`.

1. **Il listone Serie A 2026-27 è dentro** — 494 giocatori, 20 club, 154 arrivi riclassificati — e il blocco
   non era il file: l'**id campionato** si leggeva **solo** dalla pagina dei voti, che per una stagione senza
   giornate non ne ha nessuno, cioè **ogni agosto**. Fallback sulla pagina delle **quotazioni** (Serie A 26/27
   = 21), con la **guardia** che serve perché quelle pagine servono «la lista corrente» qualunque stagione
   chiedi: il workbook dichiara la sua stagione nella prima cella e uno che non dichiara quella richiesta viene
   **rifiutato**. ⚠️ Il listone **euro** 26/27 non è ancora pubblicato (la pagina risponde 108 = 25/26 e la
   guardia lo rifiuta, correttamente): va riprovato, non forzato.
2. **TRE MURI IDENTICI IN UN GIORNO, e sono lo stesso muro.** **R1** ri-misurata con la copertura **tripla**
   (`mv_synth` era fermo: gli arrivi con FM-equivalente passano da **707 a 2045**) **non passa** su **sei**
   finestre, peggio dell'àncora di ruolo su cinque; **R13c** resta ferma sul campione; lo **scostamento della
   Serie B** esiste, vale **−0.181**, riduce del **20%** l'errore contro la retta nuda — ed è la prima volta che
   «un 7.0 in Serie B non è un 7.0 in Serie A» è un numero — e **perde contro l'àncora** (0.1631 vs 0.1786).
   Lettura: **la fantamedia di chi non ha storico qui non si prevede; le sue PRESENZE sì**, ed è R13, già
   adottata. Alajbegovic passa da nessuna riga a FM **6.245** (l'àncora, dichiarata tale), PV **20.2**, surplus
   **4.1** — non una regola nuova: le sue dieci partite adesso **esistono** nel DB.
3. **`synth` converte solo dove è CALIBRATO.** La conversione seguiva il **tag** (`source='sofascore'`) e non la
   calibrazione, quindi 3756 righe di Serie B, 570 di Championship e 458 di Coppa Italia prendevano un voto da
   una retta che non le ha mai viste, mentre 10 partite di **Bundesliga** ne restavano fuori. Ora l'idoneità è
   della **competizione** (`calibrated_competitions`, letta dai dati): **241.913 su 250.678** convertite, le
   altre NULL. `APPLY_OFFSETS = False` e gli offset misurati restano **nel report**.
4. **Un buco che il toolkit può ancora chiudere si VEDE**: marchi **⧖** → **⟳** → **→** sulla stessa lista di
   stati per-giocatore, con il tooltip che dice **con cosa** il buco si è chiuso («10 partite, 693 minuti in
   bundesliga»). La regola è quella del modulo che va a prenderli (`recent_form.awaiting_data`): **una
   definizione, letta da due lati**, e si autocancella. Più la barra **determinata** da qualunque modulo
   (`Context.progress`). Misurato: **6 righe su 629**, corsa che le chiude 11/11 identità e 110 partite.
5. **Il tabellone: un 4-5-1 con tre uomini d'attacco è un 4-2-3-1** (`_two_rows`, sulla **maggioranza** della
   riga e non su «almeno uno»: la fonte pubblica tre linee, quindi 4-5-1 è 1746 stringhe su 4812). Più
   `_flanked` esteso al tridente, `_pointed` sul centro dell'attacco, la targhetta che legge il **posto**. **17
   disegni cambiati su 108 board**, invarianti **4+7+4 → 0**. ⚠️ **Revocato e scritto**: far pagare al modulo i
   posti che la rosa non copre — disfaceva Barcellona e Napoli per aggiustare il Marsiglia.
6. **L'investimento condizionale passa robust su Serie A e NON è adottato** (§7-septies): +0.79% medio, 5 fold
   su 6, e `value_weight` resta **0.0** perché **ogni fold scegli il bordo della griglia** (0.5 su 0.5). Il
   **NULL** è la parte che conta: su Serie A il valore batte la costante di **+0.42 punti**, su euro i due sono
   identici — quel poco che c'è è **ritorno alla media**. Il braccio **cartellino** è morto su entrambe.
7. **Due decisioni dell'operatore in sospeso**: `APPLY_OFFSETS` (la Champions passa il criterio pre-registrato
   **e** ha MAE media peggiore dell'àncora: raccomandazione, spento). ⚠️ Il **job settimanale** non è più
   una voce aperta: l'operatore ha deciso il 05/08 che **non serve** (vedi il blocco in cima). E i **portieri** restano fuori dall'FM-equivalente
   comunque (+1.06/+1.08/+1.12 sopra la fantamedia reale, perché non sottrae i gol presi): lavoro in `arrivals`.
8. ⚠️ **Trovato chiudendo la sessione, e va rimisurato**: **§7-sexies** (i tier degli arrivi) ha girato su un
   `mv_synth` **fermo**, quindi la copertura del misurato che quel verdetto dà come collo di bottiglia era un
   **pavimento** — 707 arrivi con equivalente contro 2045 di oggi. Il verso non cambia, il **+0.42% della
   quotazione su `default` non è il numero di oggi**. Un coefficiente porta la sua data perché l'input sotto si
   muove.

### 4/08/2026: un modulo disegnato è un modulo VERO, e la heatmap al suo posto

Spec **«Novità v9.17»**, misure nuove nel gate **§5-quaterdecies**. Commit `1108803` (le regole) e `51d069e`
(le misure). **Nessun verdetto del gate cambia: nessuna regola del motore è entrata.** Toolkit **0.7.0**, 278 test verdi.

1. **Il difetto era uno solo, e non era nelle regole: era un secondo parere non prezzato.** L'undici viene
   assegnato ai posti del modulo e ogni posto è prezzato (`_assign`), poi `lanes_for` rileggeva la corsia dal
   **primo codice** di ciascuno e disfaceva la decisione. Liverpool 4-5-1, misurato: il fit aveva dato a Gakpo
   (`LW`) la fascia **sinistra dei cinque** e a Gravenberch (`MC;DM`) il **secondo centrale della difesa a
   quattro**, e la rilettura li spediva in attacco e a centrocampo → **difesa a tre**, cinque schiacciati
   nella metà destra con la touchline sinistra vuota, attacco di due mancini. «Il modulo non può perdere la
   simmetria». Ora quella rilettura fa **solo** la mossa per cui esiste: un **centrale** una riga avanti,
   sulla trequarti (il 4-5-1 che è un 4-4-1-1). Le altre tre direzioni erano tutte sbagliate e tutte
   misurate: attraverso le linee (Liverpool), fuori da una fascia (Bayer, usciva 3-3-3-1), indietro sulla
   riga (Verona 3-5-1-1 → sei in fila e trequarti vuota).
2. **`_reshape` è LA trasformazione: cinque regole, nell'ordine in cui le verifica un allenatore**, ognuna
   con le parole dell'utente come definizione. (1) nessuno a due linee da casa; (2) una fascia la copre un
   esterno, il centrale si disloca sul codice **più avanzato** (difesa esente: i braccetti); (3) **la fascia
   svuotata la copre l'attaccante esterno che arretra** — era la metà mancante della frase; (4a) **un posto
   in attacco è il lavoro di un attaccante** (Roma: «Malen ha giocato solo come Pc, Dybala e Soulé sono
   trequartisti» → il 3-4-3 esce **3-4-2-1**, la forma che le sue probabili dichiarano) e (4b) l'attacco
   assottigliato tiene le punte («3-4-3 non può diventare 3-4-1-2», «Sp + Pc non può avere un esterno
   d'attacco»); (5) **la riga di centrocampo è cinque al massimo**, e il tetto è l'ultimo passo perché la
   regola 4 può consegnarle un uomo.
3. **Le fasce vanno in coppia, e una punta non diventa un'ala.** «Se c'è un Ed ci deve essere anche una Es»
   (idem Ad/As, Td/Ts): un codice di fascia **spaiato** ripiega sul mestiere centrale della linea. «Krstovic e
   Scamacca non possono trasformarsi in As, sono Pc e basta»: `ST` è l'eccezione alla regola «la fascia
   appartiene alla maglia», e chi non è il centravanti legge `Ad`/`As` **solo se gioca lì**, altrimenti `Sp`.
   E **entrambe le touchline o nessuna**: la riga sbilenca (uno sulla vernice, la touchline opposta vuota)
   era difesa come informazione e l'utente l'ha superata.
4. **Un solo listino.** `slot_cost` **eliminato**: restava usato solo il suo terzo termine (ora `_line_gap`),
   era un secondo listino accanto a `_slot_price` e i due **discordavano** — ed è così che Gosens (`ML;DL`, 6)
   ha scalzato Piccoli (`ST`, 7) sulla fascia del tridente della Fiorentina e **la terza punta è uscita dagli
   undici**. La regola sta dove si decide il prezzo (`_off_the_front`). La griglia è **raddoppiata** perché
   mezzo passo faccia da spareggio sul **primo** codice (Olivera `DL;DC` a sinistra), spareggio tenuto fuori
   dai confronti di `_settle`.
5. **`_flanked`: le fasce di una riga le contende chi le gioca**, non solo il pool della sua linea — la
   regola 3 un passo prima, alla **selezione**. Bologna: i cinque prendevano un `MR` a 0.44 e **un centrale di
   difesa** per le ali mentre Orsolini (`RW`, 0.64) e Cambiaghi (`LW`, 0.53) non concorrevano. Resta la
   domanda del claim: si prende la maglia solo a chi ha claim più basso.
6. **La heatmap: modello dell'utente («posizione effettiva» contro «in potenza», con pesi diversi),
   validato e già al suo posto.** Sui 52 uomini di cui le fonti dichiarano la fascia: primo codice **93.9%**,
   **centroide 97.9%**, banda dominante del cloud 97.8%. La misura batte il codice, il cloud **non** batte il
   centroide — che è già ciò che `lateral` legge per primo. Quattro tentativi di usarla altrove, **tutti
   piatti**: riordino dei codici (3 bracci), pesi per asse (12 punti di griglia, e ogni peso sulla
   **profondità** costa perché quell'asse **satura** — punta 62, ali 61-63), fascia dalle bande (0 forme, 2
   targhette su 1782 e in peggio), fascia misurata in `sides_of` (4 soglie). La ragione, che chiude la
   famiglia: **quello che il codice PRIMARIO perde, la LISTA dei codici ce l'ha già** (Zé Pedro `DC;DR`, 75%
   dei tocchi a destra). Gate §5-quaterdecies.
7. **Verifica**: **394 board** (ogni club × ogni forma del repertorio × 2 modalità × 2 fogli) con **0 righe
   oltre il massimo, 0 codici spaiati, 0 righe asimmetriche**, ogni forma disegnata è un modulo reale. Contro
   le formazioni tipo pubblicate della stessa finestra: **83% degli uomini** e **16/20** conteggi di linea
   (era 15). Verificato anche **sul canvas vero** leggendo gli item disegnati.
8. ✅ **Chiuso uno dei due punti aperti del blocco precedente**: i **centrali su una fascia** sono **3 → 0**.
   ⚠️ **Ridotto e capito il secondo**: gli **attacchi senza un attaccante** sono **9/340 → 4/394**, e i
   quattro sono lo stesso club e lo stesso uomo — Lilla, con l'unico posto d'attacco di un 4-5-1 assegnato a
   Haraldsson (`AM`, claim **0.83**) invece che a Fernandez-Pardo (`ST`, **0.83**): un **pari merito** rotto
   sui minuti, e poi la guardia «mai l'ultimo uomo dell'attacco» lo tiene là davanti. Il seguito naturale è
   la regola 4a alla **selezione**: se l'unico posto d'attacco andrebbe a un trequartista, la riga cede un
   posto e il modulo esce 4-4-1-1 — la stessa forma di `_flanked`, ma sulla profondità invece che sulla
   fascia.

### ...e il POMERIGGIO del 4/08: la quotazione all'ultimo posto (spec «Novità v9.18»)

9. **La QUOTAZIONE è l'ultima risorsa** (gate **§7-sexies**), decisione dell'operatore: «è il giudizio
   soggettivo di chi quota». Il motore adottato **non la leggeva già** — R12/R12b/R17 falsificate e fuori dai
   set, il livello di rimpiazzo dalla fantamedia del rostered marginale, `stature` a zero, `arrival_tier`
   letto solo dalla GUI. L'unico punto vivo era quale percentile instrada un arrivo, e ora ha **tre livelli**:
   **calcio giocato** (FM-equivalente nella lega di provenienza, percentile nel ruolo) → **fantavalore** (il
   giudizio più fresco: «varia ogni settimana o quando ci sono eventi particolari») → **quotazione**. Su euro
   `measured_first` vince **7 fold su 7** (CONFIRMED, +0.89%); su Serie A la quotazione guadagnerebbe +0.42%,
   sotto il pavimento, e la causa è la **copertura** del misurato (25-29% contro 14-20%). ⚠️ Il seguito NON è
   tornare al prezzo: è **allargare il misurato** alla Serie B e ai campionati non coperti.
10. **`fvm_history`**: il fantavalore era uno **stato volatile tenuto come campo statico**, sovrascritto a
   ogni scarico del listone. Ora è una serie datata che **accumula da oggi** — la storia settimanale
   precedente non esiste in nessun posto raggiungibile. E prima del **2022-23** è **0 e non NULL**, quindi la
   «copertura 1395 su 1395» era illusoria.
11. **Regola di metodo nuova, e l'ha trovata un numero**: inserendo il fantavalore la quotazione otteneva un
   `robust PASS` su `default`, che era **falso** — lo sweep giudicava i tier su tutti gli arrivi mentre un
   tier instrada solo chi il **core non può prezzare**. **Un parametro va giudicato sulla popolazione su cui
   agisce** (in CLAUDE.md).
12. **`market_values`** (9388 valori · 3180 giocatori · 11 stagioni, gratis dalla pagina rosa già scaricata) e
   il verdetto §7-quinquies: **non adottato**, e la sfumatura è il risultato — il proxy migliore ha comprato
   **il verso e non la taglia**.

### La sessione precedente — la sessione del 3-4/08/2026: quindici richieste sul PANNELLO

Dettaglio in [stato-progetto-continuita-v5.md](stato-progetto-continuita-v5.md) sezione «Sessione
03-04/08/2026», spec **«Novità v9.16»** (dieci punti), misure nuove nel gate **§5-terdecies**.
**Nessun verdetto del gate cambia: qui non è entrata nessuna regola.** Toolkit **0.6.0**, 271 test verdi.

1. **La build dello snapshot dice a che punto è.** `[snapshot] 46% · descriptive layers`, barra determinata
   nel tab. I pesi sono **secondi misurati** (predict 37s, squads 14s, `roles` 293s dai timestamp della
   cache di una refresh vera), ogni run stampa `[snapshot] stages:` per rimisurarli, e una fase che non
   gira **esce dal denominatore**.
2. **Lo schieramento TIPO non si sceglie con lo sconto infortuni** (`claim` ≠ `presence`). De Bruyne
   standing 1.00 × disponibilità 0.53 perdeva il posto da Elmas 0.62 × 0.92. Il tipo è «la squadra con
   tutti disponibili» e adesso lo è: `claim` = standing, `presence` resta la domanda d'asta.
3. **Il claim scegli CHI gioca, la calzata solo DOVE**, e la disposizione si risolve **come un tutto**
   (`_matching`, Hungarian in casa). Una greedy per casella deve fissare la priorità fra fascia e linea, e
   **entrambi gli ordini sono sbagliati sullo stesso undici**; il prezzo di una casella è la distanza sulla
   griglia dei codici con la fascia pesata **per linea** (`SIDE_WEIGHT` 8 su D/M, 3 su T/A), perché a
   centrocampo l'esterno è un ruolo e in attacco i tre si scambiano. Riparazione **Pareto** (`_settle`,
   `CLAIM_MARGIN` 0.05) e trasformazione del modulo **solo se obbligata** (`_reshape`).
4. **Il badge dice la fascia della MAGLIA**: in una linea a quattro i due esterni sono `Ts`/`Td` anche se
   sono centrali di ruolo (e in una difesa a **tre** restano `Dc`, che non ha fasce).
5. **Il piede preferito, misurato prima di usarlo**: DL 96% sinistro, DR 96% destro, ma `LW` **86% destro** e
   `RW` 69% sinistro (ali invertite), e i `DC` mancini stanno a sinistra nel **93%**. Entra come spareggio
   dentro la linea, mai su chi gioca.
6. **Il CORPO (altezza/peso) c'era già nella cache** e nessuno lo leggeva; ora è nel foglio e sul tooltip.
   Ipotesi «si schiera la punta alta» **misurata e respinta**: la più usata di due punte è la più alta
   **44 volte su 92 = 48%**, una monetina (gate §5-terdecies).
7. **La tabella rosa è una canvas**: in Tk 8.6 un Treeview colora la riga e niente di più fine. Pillole di
   ruolo nella palette del campetto, ogni numero **verde sopra la media del foglio e rosso sotto** (media su
   tutti i giocatori di tutte le squadre, `inj` invertito), e un **check per calciatore** che rifà gli undici
   senza di lui, modulo compreso.
8. **Un SURPLUS vuoto è una dichiarazione**: sotto `MIN_PV_PREV = 15` voti il core non prevede, e su
   `default` non c'è R0c su cui ripiegare — **253 righe su 598** in quel foglio. Ora lo dicono manifest e
   tooltip.
9. ⚠️ **Aperto e misurato**: su 340 undici restano **9 attacchi senza un attaccante** e **3 centrali su una
   fascia** (la linea `T` è in pool con l'attacco, quindi un trequartista batte una punta sul claim); e **gli
   undici di un allenatore NUOVO non pesano da nessuna parte** — l'Atalanta ha Sarri e
   `formation_typical_under_coach = 0`, il suo 4-3-3 è misurabile (**162 undici su 188 = 86%**) e le sue due
   amichevoli con Raspadori titolare sono in cache.

### La sessione precedente — quattro passate del 29/07/2026, in ordine di conseguenza

Dettaglio in [stato-progetto-continuita-v5.md](stato-progetto-continuita-v5.md) sezioni «(5)» → «(8)»,
verdetti in [gate-motore-v1.md](gate-motore-v1.md) **§7-ter** e **§7-quater**, spec «Novità v9.11»→«v9.14».

1. **Una quota di stagione si conta sul CAMPIONATO.** I numeratori erano sempre di campionato
   (`external_stats` ha una riga per campionato) e il denominatore era ogni undici parsato in qualsiasi
   competizione: Arsenal 58, Bayern 50, Napoli 38. Kane leggeva **49%** con 25 titolarità su 34 giornate;
   correlazione fra la quota di campionato del club e la titolarità media dei suoi **+0.796 → −0.172**. Le
   assenze si **contano** in giornate dentro l'unione degli spell, e `contested` usa quello che ha davvero
   saltato e non la previsione — che, sottratta e rimoltiplicata, si annullava: giocatori appiattiti sul
   pavimento **da 201 a 9**.
2. **`sweep` — il gate delle COSTANTI** (`python -m euroleghe_ingest sweep`). Formule estratte in
   `engine/presence.py`: un parametro che nessun harness raggiunge non si può spazzare. **Adottato**:
   `STANDING_WEIGHTS = (0, 1)` — la titolarità si prevede dai **minuti**, strict e robust su tutti e dieci i
   fold. **Confermati**: forma di `contested`, `ARRIVAL_DISCOUNT` 0.80, decay rigoristi 0.75 (dopo aver
   scoperto che **ogni rigore di Serie A era contato due volte**, che dimezzava la memoria della gerarchia
   per i club italiani). **Aperti col motivo**: `LOAN_DISCOUNT` (platform-dependent), inclinazione
   infortuni, pavimento, quarantena, soglie dei tier.
3. **Le probabili non si storicizzano** (decisione dell'utente): sono poco affidabili e ragionano con i
   nostri stessi fattori; il valore aggiunto arriva a ridosso del calcio d'inizio. Quindi rilevazione su
   OGGI, e per un foglio **retrodatato** si guarda l'undici **schierato** — colonne `actual_*`, terza classe
   del CSV, misurate DOPO la data d'asta e di sola rendicontazione. `starter_prob` 0/1453 nel gate =
   **vuoto per scelta**, e il cron settimanale non serve.
4. **L'investimento del club: ipotesi misurata e NON adottata.** Due canali (quota della spesa del club, e
   Qt.I percentile nel ruolo — necessario perché **Modrić e De Bruyne sono arrivati a parametro zero**), due
   forme pre-registrate, bersaglio le titolarità. `fee_weight` peggiora monotonamente, `stature_weight`
   peggiora in entrambe le direzioni, la forma `arrival` è pari a spento in quarta cifra. Lettura: il
   meccanismo **è già assorbito dai minuti**. ⚠️ **Da ritestare col proxy giusto**: il valore di mercato
   Transfermarkt è **già nella cache** (561 pagine rosa, 51 club × 11 stagioni) e gli **ingaggi non
   esistono** in nessuna fonte in whitelist (verificato: zero occorrenze di Gehalt/salary/stipendio).
5. **L'unità è la PARTITA, non la giornata**: (giocatore, giornata) non è unica — con un rinvio più un
   trasferimento un uomo gioca la stessa giornata per due club — e la **PK di `match_ratings` non può
   rappresentarlo**, quindi una presenza si perde. Decisione aperta: cambiare la PK = migrazione + re-ingest.
6. **Il pannello: l'altezza si spende sul campetto, non sul suo bordo** (richiesta dell'utente sul layout;
   spec «Novità v9.15», stato sezione «(9)»). Nessun numero del motore cambia. A parità di finestra il
   campetto passa da **388 a 493px** e la rosa da 448 a 534; la finestra ora si apre **massimizzata**
   (campetto 449x506) e ricorda la scelta dell'operatore. Misurando sono venuti fuori due difetti che
   nessuno vedeva: la **status bar era invisibile da sempre** (packata dopo uno shell che espande: 1x1
   pixel) e la **targhetta dell'attaccante veniva disegnata sopra la didascalia**; e **276px di colonne
   della rosa non erano strette, erano assenti** — Tk taglia e non offre come raggiungere. Lezione, ora con
   un test in rapporti: **una tesi sul layout va misurata** (`winfo_height`) come qualunque altra.

### La passata precedente — il denominatore di una quota, e lo sweep delle costanti

Sessione del 29/07/2026, ultime due passate (spec «Novità v9.11» e «v9.12»; dettaglio in
[stato-progetto-continuita-v5.md](stato-progetto-continuita-v5.md), sezioni «(5)» e «(6)», verdetti in
[gate-motore-v1.md](gate-motore-v1.md) **§7-ter**). I due punti che «cosa manca al toolkit» dava per aperti:

1. **Una quota di stagione si conta sul CAMPIONATO.** I numeratori erano sempre di campionato
   (`external_stats` ha una riga per campionato) e il denominatore era ogni undici parsato in qualsiasi
   competizione: Arsenal 58, Bayern 50, Napoli 38. Quota di campionato **66%-100%** sui 45 club, quindi Kane
   leggeva **49%** con 25 titolarità su 34 giornate. Correlazione fra la quota del club e la titolarità media
   dei suoi giocatori: **+0.796 → −0.172**. Dentro: le assenze si **contano** in giornate dentro l'unione
   degli spell (niente più conversioni), e `contested` usa quello che ha davvero saltato e non la previsione
   — che, sottratta e rimoltiplicata, si annullava. Giocatori appiattiti sul pavimento: **da 201 a 9**.
2. **`python -m euroleghe_ingest sweep` — il gate delle COSTANTI.** Formule estratte in
   `engine/presence.py` (un parametro che nessun harness raggiunge non si può spazzare). **Adottato**:
   `STANDING_WEIGHTS = (0, 1)`, la titolarità si prevede dai **minuti** — strict e robust su tutti e dieci i
   fold. **Confermati**: forma di `contested`, `ARRIVAL_DISCOUNT` 0.80, decay rigoristi 0.75. **Aperti col
   motivo**: `LOAN_DISCOUNT` (platform-dependent), inclinazione infortuni, pavimento, quarantena, tier.
   Trovato per strada: **ogni rigore di Serie A era contato due volte**, il che dimezzava la memoria della
   gerarchia per i club italiani — ed è per questo che 0.5 sembrava battere 0.75 (0.75² = 0.56).

### La passata precedente — il foglio d'asta dice di CHI era la stagione, e chi compete davvero

Sessione del 29/07/2026 (tre passate, spec «Novità v9.8» e «v9.9»; dettaglio e numeri in
[stato-progetto-continuita-v5.md](stato-progetto-continuita-v5.md), sezioni «Sessione 29/07/2026 (2)» e
«(3)»). Nessun giro di gate, nessun verdetto cambiato: è tutto sul **foglio d'asta** e sui **dati**.

1. **La stagione misurata arriva spaccata fra il club attuale e altrove** (`desc_minutes_club` /
   `_elsewhere`, dallo strato per-partita) e la standing **pesa** la metà fatta altrove: `LOAN_DISCOUNT
   0.60` se questo club lo aveva e lo ha mandato via, `ARRIVAL_DISCOUNT 0.80` se non lo ha mai giudicato —
   differenza **misurata** da `desc_at_club_before` (nessuna fonte nostra marca un prestito). Marin R.
   0.57 → **0.34**, dietro Rrahmani. Entrambe provvisorie: gate §7-bis.
2. **Un ballottaggio è un duello fra RUOLI REALI, mai fra ruoli fanta.** Serve un codice granulare
   condiviso; chi non ha codici osservati **esce dalle colonne** (vuoto = ignoto, mai «0 rivali»).
3. **E quel vincolo ha scoperto il buco più grosso della giornata**: 827 `fc_id` avevano gli aggregati
   sofascore e **nessun id** in `player_xref` — invisibili a ruoli granulari, heatmap e strato per-partita
   insieme. Causa: l'identità era scritta dentro il giro per stagione. **815 recuperate** offline; il
   foglio passa da 152 a 32 giocatori senza codice, il layer per-partita da ~270k a **334.795** righe.
4. **Uno slot sa la sua linea, non solo la fascia**: la fascia sul badge è quella della maglia, una linea
   a corto di uomini prende dal **surplus** di un'altra (il Bayern disegnava dieci uomini) e `LANE_DEPTH`
   impedisce che il quinto centrocampista sia un centrale difensivo. **0 undici incompleti su 68.**

Toolkit **v0.3.0**, spec **v9.9**, 232 test verdi. `fetch --plan` dice «every source is populated»: quello
che manca non è più dato — vedi «cosa resta, in ordine di leva» in fondo allo stato.

### quattro credenze del fantacalcio MISURATE: un solo canale, e non è il voto

Domande dell'utente (29/07/2026): il riposo corto peggiora la resa? «vincere aiuta a vincere»? una
vittoria fa confermare l'undici? il nuovo allenatore dà una sferzata? Misurate su
`platform='default'` (Serie A), 7 stagioni, **106.977 partite-giocatore**, esiti demeaned dentro
(giocatore, stagione). **Descrittivo: nessun giro di gate, nessun verdetto cambia, nessuna regola entra.**
Rapporto completo: [turnover-atteso-v1.md](turnover-atteso-v1.md); sintesi nel gate §5-duodecies.

1. **Tutte e quattro hanno un effetto reale, e in tutte e quattro è su CHI GIOCA.** Riposo ≤3 giorni:
   **P(titolare) −9,8pp**, **P(voto) −4,4pp**, negativo **7 stagioni su 7** — e **fantavoto −0,014
   (t −0,5)**, con segno instabile fra stagioni. Dopo una vittoria contro dopo una sconfitta: **+5,0 /
   −4,1pp** per chi era titolare, specchiato sui panchinari, **XI confermato 78,2% vs 71,0%** (≈2,4 maglie
   cambiate dopo una vittoria, 3,2 dopo una sconfitta), **7 su 7**.
2. **Le credenze sul RENDIMENTO cadono, una col segno rovesciato.** Dopo una vittoria il fantavoto fa
   **−0,046** (−0,032 corretto per l'avversario): ritorno alla media, non inerzia — e **regge al proprio
   null rimescolato** (null −0,002, contrasto W−L −0,074 contro −0,002, t −3,4). Però un punto di fantavoto
   in t−1 vale **+2,35pp** di titolarità in t: l'informazione viaggia **attraverso la scelta
   dell'allenatore**, non le gambe.
2-bis. **«Ha segnato, si ripeterà?» — misurato con 300 rimescolamenti per sequenza** (il test ingenuo è
   distorto: `P(hit|hit)−P(hit|miss)` è negativa anche su dati casuali, bias di Miller–Sanjurjo). **Il gol
   è senza memoria**: su Serie A tutte e quattro le statistiche di raggruppamento sono a zero (1.260
   giocatore-stagione). **Il livello di prestazione ha un filo di memoria**: il quartile alto di fantavoto
   si raggruppa su entrambe le piattaforme (t +2,7…+6,5) ma vale **+0,014 su un tasso base di 0,408**, cioè
   42% contro 40% — solido e non scommettibile. ⚠️ E la correzione che ne è venuta: la «mano calda a
   −0,035» della prima stesura era **la distorsione**, non un effetto; col null giusto è **+0,012 (+3,4 sd)**,
   cioè positiva e minuscola. Regola di metodo: un'autocorrelazione ritardata dentro un gruppo demeaned si
   confronta con la sequenza **rimescolata**, non con zero.
3. **Nuovo allenatore: metà sferzata è aritmetica.** Grezzo +0,481 punti/partita; controlli appaiati con la
   stessa forma di partenza +0,253 → **netto +0,227 (SE 0,118, t 1,9)**, cioè **53% ritorno alla media** e
   il resto non risolvibile con 31 eventi. Quello che fa davvero: **conferma il 64,4% dell'undici** contro
   il 75,1% delle settimane normali = **1,2 maglie subito**. Coerente con la caduta di R10.
4. **La cornice, che spiega il resto del motore**: **Var(ln pv) = 90,5%** di Var(ln fantapunti) su
   `default` (89,9% su `euro`) contro **~2%** di Var(ln fm). Il 90% di una stagione **sono** le presenze —
   per questo tutto ciò che è entrato nel motore (R3, R3c, R7, R13) è una regola di presenze o minuti.
5. **Difetto di dati chiuso senza rete**: il **risultato** di una partita di Serie A è derivabile offline.
   `goals` è al netto di rigori **e** autogol (`goals+own_goals+pen_scored` pareggia i gol subiti dei
   portieri su **386 giornate su 418**), quindi gol fatti = `SUM(goals)+SUM(pen_scored)`, gol subiti dalle
   righe `role='P'`; screening severo (bilancio **e** vittorie == sconfitte) → **278/418 (66,5%)**.
6. **Cosa manca per farne una regola**: un **gate per-giornata**, che non esiste — il gate attuale giudica
   un bersaglio stagionale all'asta. E i **dati di coppa/Europa**, senza cui la congestione vera resta non
   misurata (il bucket ≤4 giorni è pulito, quello 5+ è contaminato per le squadre europee → si **sottostima**).

### il RUOLO REALE granulare: 12 codici, e dove si collocano (spec «Novità v9.7»)

Richiesta dell'utente: ogni calciatore deve avere il suo **ruolo reale**, recuperato **quando gira lo
snapshot**, per sapere orientativamente dove collocarlo in campo.

1. **Dodici codici, enumerati e non ricordati** — `GK` · `DL DC DR` · `DM` · `ML MC MR` · `AM` · `LW RW` ·
   `ST`, da uno a tre per giocatore. 128 giocatori campionati non hanno restituito nient'altro; un
   tredicesimo codice a monte finisce **nel log**, non assorbito. Italiano: `Ts` terzino sinistro, `Dc`
   centrale, `Td` terzino destro, `M` mediano, `C` centrocampista, `T` trequartista, `Es/Ed` esterno,
   `As/Ad` ala, `Pc` punta. **Nessuna colonna esistente lo sostituisce**: `role_classic` chiama `D` sia un
   terzino sinistro sia un centrale, e `positions.derived_role` **li chiama `D` entrambi anche lui**.
2. **È una griglia, quindi si posiziona**: lato (−1 sinistra … +1 destra) e profondità (0 porta propria …
   1 porta avversaria, **lo stesso asse di `avg_x`**). `DM` → `MC` → `AM` sono tre posti in campo che per
   il listone sono tutti e tre `C`. I numeri sono posizioni di **disegno**, non quantità fittate.
3. **Una richiesta per CLUB**, non per giocatore: `/team/{id}/players` porta `positionsDetailed` +
   `preferredFoot` per l'intera rosa → 35 club invece di ~1500 giocatori, ~2 minuti, e **zero** richieste
   rieseguendo lo stesso giorno (cache datata). Nuovo `positions --layer roles`; i **team id** del provider
   sono dedotti *offline* dalle cache già presenti (92 club) — nessuna fonte nostra ne portava uno.
4. ⚠️ **TERZO fatto non backfillabile**, e va saputo: il provider serve solo «adesso» — `?seasonId=`
   risponde **200 e lo IGNORA** (Dimarco torna `['ML']` sia per 25/26 sia per 23/24). Quindi
   `player_roles` è **datata** e sta accanto a `probable_starter` e `contract_until`: ogni giorno non
   osservato è un giorno che non esisterà. Storiche e intatte: `derived_role` e `avg_x/avg_y`.
5. **Precedenza sul lato decisa misurando**: heatmap e codice concordano su **196/219** laterali (89%);
   nei 23 restanti vince il codice, perché un `DL` non è un centrale — ma un codice **centrale** non è una
   pretesa sulla fascia, e lì resta la misura (Bastoni `DC;DR` → −0.53, il sinistro di una difesa a tre).
6. **Misurato**: 1372 osservazioni datate, **745/883 righe del foglio (84%)**, 221 mancanti su 1343 sono
   identità non risolte (la linea resta nota, manca la fascia). Dimarco `D/e` → `ML` badge `Es`, lato
   −0.62, profondità 0.60; Calhanoglu `C/m;c` → `DM;MC` badge `M`, profondità 0.45.

7. **I dodici codici → il vocabolario MANTRA** (mappatura dell'utente, `desc_mantra_real`): il Mantra
   **semplifica**, quindi `ML`/`MR` collassano su **`e`** e `LW`/`RW` su **`w`** (non nomina la fascia a
   centrocampo), mentre in difesa la nomina (`DL`→`ds`, `DR`→`dd`). Due ruoli che **nessun codice singolo**
   dà — ed è per questo che avere fino a tre codici vale più che averne uno: **`b` braccetto** = codice di
   fascia difensiva **insieme** a `DC` (139 giocatori, il listone ne segna 28: è una *capacità*, i due non
   devono coincidere), e **`AM` → `t` o `a`** deciso dalla linea larga del provider (63 `M`→`t`, 19
   `F`→`a`). ⚠️ Non sostituisce mai `rosters.roles`: **esiste per quando non esistono**, che a luglio è la
   norma (26/27: 1343 su 1343 senza riga di listone). Dove entrambi ci sono: **48% identici, 44%
   condividono un ruolo, 8% disgiunti** — e le disgiunte sono quasi tutte `a` del listone contro `w` del
   provider, cioè la distinzione stessa fra **per cosa lo compri** e **dove gioca**.

8. ✅ **DECISO il 05/08/2026: nessun job settimanale.** La voce diceva «ogni settimana che passa costa» e
   l'operatore ha chiuso la richiesta: «il job ogni settimana non serve». Un'asta iniziale è in agosto, quando
   la pagina delle probabili non esiste, e il valore aggiunto degli editor arriva a ridosso del calcio
   d'inizio — quindi si legge **subito prima** della sessione. `player_roles` continua ad accumularsi quando
   gira `snapshot`, che è il momento in cui serve; e ciò che protegge da una rosa vecchia non è un job ma la
   **data dichiarata** (`evidence_age`) più la rosa viva del provider come fonte.

**Nessun verdetto del gate cambia**: fatto descrittivo + layout. Il vincolo è registrato in
`gate-motore-v1.md` §5 punto 6, fra i fatti utilizzabili *live* e non nel gate retrospettivo.

### lo snapshot lavora sulle ROSE REALI e ha una VISTA (spec «Novità v9.6»)

1. **Rose reali, listone o non listone.** Nuova `squad_snapshot` (fc_site → transfermarkt → apparizioni,
   ognuna datata **con la propria data**) e `features.load(squad_source='real')`, default `'listone'`
   così **nessun numero del gate si muove**. Il target di default è **la stagione a cui appartiene
   oggi**: a luglio si prepara l'asta di una stagione il cui listone non esiste. Misurato: 26/27 = **890
   giocatori, 34 club**, senza quotazioni, con SURPLUS. ⚠️ Tre difetti trovati **provando** il foglio:
   il backstop apparizioni senza limite metteva Handanovic nell'Inter 2026; le rose venivano ridatate
   alla data d'asta (**look-ahead**); il foglio euro elencava Verona e Cagliari → filtro di perimetro
   **in uscita**, non nel modello, così ogni numero resta quello dell'harness.
2. **Forma sulle ultime 10 del CLUB**, non del giocatore: `played/measured/unused/unknown`, gol spezzati
   `league`/`other`, e chi non è nel layer legge **UNKNOWN, non zero**. Nella vista sono **dieci
   pallini**: `b` (panchina) e `n` (nessun dato) sono colori diversi di proposito.
3. **Vista `Snapshot`**: club a sinistra, box + **campetto** (portiere in alto) con undici e ballottaggi,
   rosa ordinabile con tooltip su ogni colonna e colonna **`real`** (il ruolo in cui è stato davvero
   usato). Gli 11: le probabili se ci sono, altrimenti il SURPLUS previsto — e il campetto dice quale.
4. **Campetto = MODULO TIPO**: la **moda** degli undici realmente schierati (Atalanta 3-4-3 al 97%), non
   la media delle linee, che arrotonda a moduli mai giocati.

### lo SNAPSHOT D'ASTA: un tasto, e il foglio da cui si prepara un'asta

`snapshot` (comando + tasto «Auction snapshot (today)» nel pannello): scelti **piattaforma** e **game**,
aggiorna le probabili/indisponibili di oggi e scrive un foglio per giocatore e uno per club —
**1453 giocatori, 46 club** al primo giro. Spec «Novità v9.5».

**La cosa importante è come è diviso il foglio**, e si vede nell'header: `engine_*` è la valutazione che
**ha passato il gate** (FM prevista, presenze, VALORE, SURPLUS, rank di ruolo), prodotta **chiamando
`engine/`** col set adottato e parametri fittati su un'altra finestra; `desc_*` è **descrittivo e NON
gatato** — forma sulle ultime 10, minutaggio presunto, ballottaggi, propensione infortuni, rigorista,
propensione ai bonus, correttezza, contratto/exit risk. **Nessuna colonna `desc_` può diventare un
coefficiente senza gate pre-registrato**: sei famiglie di ipotesi sulla FM sono già morte così.

E quello che le fonti non dicono è **dichiarato**: «rapporto con la società» non è misurabile (esistono
i proxy: contratto, exit risk, cifra, anni al club), i piazzati oltre i rigori non sono attribuibili
(`assists_set_piece` è NULL alla fonte), le «idee dell'allenatore» non sono scritte da nessuna parte —
misurati chi è, da quando, se è nuovo, il modulo di oggi e le linee realmente schierate. La data d'asta
è `min(15 agosto della stagione, oggi)`, così una prova a vuoto non legge il futuro; e se i parametri
sono fittati sulla stagione bersaglio il manifest scrive **DRY RUN**.

### il TOOLKIT è completo, esporta, si ricostruisce da zero, e ha una UI nuova

Quattro richieste dell'utente in una sessione (28/07 sera-notte). Dettaglio tecnico:
`spec-euroleghe-ingest-v9.md` «**Novità v9.4**» e `toolkit/README.md` (che ora è anche la guida
d'installazione su una macchina nuova). **Nessun verdetto del gate cambia: qui non è entrata nessuna
regola.** Sono dati, strumenti e infrastruttura.

1. **I due buchi dichiarati sono chiusi.** `injuries` (nuovo modulo Transfermarkt: assenze datate con
   **`matches_missed`**, non solo i giorni) e la **heatmap** → `positions.avg_x/avg_y`. ⚠️ Scoperta che
   vincola il gate: la scadenza contratto **esiste solo sulla rosa di oggi** (la pagina di una stagione
   passata non porta quella colonna), quindi `exit_risk` è utilizzabile per l'asta che viene e **non è
   gatabile su T1/T2**. Registrato tra i `known_gaps` del bundle, non nascosto.
2. **La domanda aperta sui reparti D e C ha una risposta misurata** (`positions --layer crosstab`, su
   149 585 presenze): provider **G→P 100%**, **D→D 97%**, **M→C 80%**, **F→A 80%**. Estendere i
   conteggi di reparto ai **difensori è pulito**; per i centrocampisti costa la stessa ambiguità già
   accettata sugli attaccanti. Era il prerequisito dichiarato in todolist.
3. **`export`: il bundle dell'app esiste.** 229 116 righe, **29 MB** SQLite + 2,5 MB JSON gzip, 21
   tabelle. Il contratto è **derivato da quello che `engine/features.py` interroga davvero**, e il
   `manifest.json` porta provenienza (commit + data), **quali prezzi sono auction-safe**, i parametri
   provvisori **con i loro valori**, il set adottato e i buchi noti. `--verify` ri-apre il bundle e
   distingue *bundle rotto* da *buco del mondo*. `data/export/` è gitignored: **il repo è pubblico**.
   ⚠️ **Verificato eseguendo il motore SUL bundle**: output identico al DB. Ha trovato due difetti che
   rileggere il contratto non avrebbe visto — le righe `sofascore_recent` sono etichettate con la
   stagione del listone (570 buttate) e **`--history` deve coprire la finestra di cross-fit**, perché i
   coefficienti sono fittati là: con 2 stagioni le metriche del gate combaciavano tutte e **la lista
   d'asta no**. Default 3, bundle 39 MB. E inseguendo quella differenza è saltato fuori che **il
   ranking d'asta non era deterministico** (decine di giocatori prezzati all'àncora a pari VALORE,
   ordinati dall'ordine fisico delle righe): tie-break su `fc_id`, nessuna previsione cambia, `--verify`
   resta 15/18, e si sposta **un** portiere da miss «near» a «regime» — che per i prezzati all'àncora
   era un'etichetta già arbitraria.
4. **Ricostruibile da zero su un'altra macchina.** `bootstrap --plan` = 15 passi, ordine, opzioni e
   costo (**~17 h**, ripartibile), e rifiuta di partire senza credenziali. Tre buchi reali chiusi per
   arrivarci: `elo` non legge più un CSV fatto a mano ma l'**API ClubElo** (effetto: `club_elo` da 76
   righe su 2 date a **921 su 10 date, 99 club**), la **lega di un club** si deriva dalla cache
   provider (il listone euro non la dice, e gli export Drive una macchina nuova non li ha), e `fetch`
   non è più uno stub (`--plan` = «cosa manca qui», `--inbox` = l'unico passo manuale, opzionale).
   Aggiunti `.env.example` (era citato e non esisteva) e `config.SEASONS` come fonte unica.
   **`ingest_runs` finalmente si scrive**: una riga per run, dalla CLI, dal rebuild e dalla GUI.
4-bis. **Cinque club del perimetro non combaciavano con Transfermarkt** — trovato misurando la
   copertura degli infortuni (55% del perimetro, squadre intere assenti). La tabella di competizione
   scrive il nome ufficiale («ACF Fiorentina», «LOSC Lilla», «Real Betis Balompié») e un listone mai.
   `match_club` ora fa passi ordinati con unicità obbligatoria: **club_xref 46 → 51**, spell allenatori
   2273 → 2316, **trasferimenti 1919 → 3038**. ⚠️ Un passo per sottoinsieme di parole è stato scritto,
   misurato e **cancellato**: dava «Paris FC» → PSG e «Espanyol» → Barcellona. Lezione registrata: un
   pool a cui manca la risposta giusta non si salva col tie-break, solo rifiutando di indovinare.
5. **UI rifatta** (`ui_theme.py`): palette semantica light/**dark** con toggle ricordato, icone per
   operazione, card per cadenza, striscia di metriche, log colorato per severità, status bar con
   l'ultimo run. Aggiunti i pulsanti che mancavano: **Bootstrap**, **What is missing?**, **Export**.
   Pillole ruolo e celle-stato dei fantavoti **non** sono tematizzate di proposito: sono codifiche di
   dato. **194 test verdi, ruff pulito, nessun test tocca la rete.**

### due attaccanti dello stesso club nelle top-10: chiuso in tre pezzi

La domanda («è discutibile avere Kean+Piccoli o Marmoush+Haaland nei top 10: uno farà più bonus
dell'altro») è stata attaccata direttamente, con dati nuovi presi **senza una richiesta di rete**, e ha
prodotto **un verdetto negativo, una valuta spenta e una colonna che spedisce**. Doc:
`attacco-affollato-r17-v1.md` (pre-registrazione + esito), `metrica-asta-surplus-v1.md` §11,
`spec-euroleghe-ingest-v9.md` «Novità v9.3».

1. **Dati (v9.3, offline)**: sei colonne di tiro su `external_match_stats` e la tabella nuova
   **`club_match_lineups`** (quanti G/D/C/A schiera ogni club, per undici). Erano nei blob già in cache.
   Da qui **K = attaccanti per undici** (Inter 24/25 = 2.05, Fiorentina = 1.71) e i **co-start**
   (Lautaro+Thuram 23, Lautaro+Taremi 3). ⚠️ Difetto trovato **misurando**: contare i reparti passando
   per l'imbuto dell'identità distruggeva il campione (Serie A 24/25: 233 undici su 774, Juventus
   **zero**) — perciò i conteggi di club stanno fuori da quell'imbuto.
2. **R17 (affollamento come regola d'errore): NON PASSA**, ed è la bocciatura più istruttiva del set.
   Il coefficiente è **negativo e stabile ovunque** (Serie A −0.055…−0.097, dispersione 0.24, 6/6 ·
   euro −0.047…−0.067, dispersione 0.15, 4/4): il meccanismo **c'è**. Ma i giocatori che sposta
   **peggiorano su 9 combinazioni finestra×piattaforma su 10** (Serie A robusto 1/6, media −7.3%,
   peggiore −14.9%). **Quinta** formulazione dell'affollamento a cadere sull'errore (R11, R11b, R16,
   R16b, R17). E il diagnostico dice perché: su T1/T2 le coppie top-15 dello stesso club hanno reso
   entrambe **23 volte su 23** (Kean 175 su 199 previsti + Piccoli 170 su 189; Marmoush 272 su 189 +
   Haaland 204 su 188), e il «numero 2» che R17 avrebbe punito ha reso **1.04×** il previsto contro
   1.07× di chi risparmiava. I flop veri (Lukaku, Dovbyk, Mosquera) stavano **fuori** dalle coppie.
3. **Pressione di reparto (valuta d'asta, non gate): misurata e SPENTA.** Su richiesta esplicita
   dell'utente — «il rischio di comprare quello scadente deve penalizzarne il valore, e il posto
   garantito per carenza di concorrenza merita un premio» — con protocollo dichiarato prima:
   VALORE catturato **−0.61%** (limite −2%: passa) ma **tasso di bust 10.1% → 10.1%, identico su ogni
   singola finestra** (non passa). La spiegazione vale più del verdetto: **i flop dei reparti contesi
   non stanno nelle top-10 predette** — Openda e David erano **imprezzabili** per il motore, quindi
   nessuna lista li proponeva e nessuno sconto poteva salvare da un acquisto che il motore non
   suggeriva. Il fattore resta nel motore (`surplus_pressure`, testato) e **non è offerto dal pannello**.
4. **Quello che spedisce è la colonna `Pair`** nel tab Auction: per ogni nome in coppia, il compagno,
   K, i co-start e il ΔQt.I — la stessa evidenza al decisore **senza riordinare niente**.

⚠️ **Da qui la voce a leva più alta di tutto il progetto, che non era in cima all'elenco**: finché i
**nuovi arrivi senza storico non sono prezzabili**, nessuna metrica d'asta li tocca — né in bene né in
male. È il buco che ha reso inutile la pressione di reparto, e ha già una strada pre-registrata
(R13c, ferma su un muro di campione, non di ipotesi).

### È cambiata la VALUTA dell'asta, non il motore: `metrica-asta-surplus-v1.md`

Il pannello Auction ordina per **SURPLUS = (FM − rimpiazzo) × Pv × beccabilità**, con una soglia minima di
schierabilità, e apre su quella. `VALORE = FM × Pv` resta disponibile e resta il deliverable
pre-registrato: `auction_view` ha default `metric='value'` e `prepare()` non calcola alcun livello di
rimpiazzo se non gli passi la configurazione di lega, che il gate non fa. **I numeri del gate sono
invariati al numero.**

Perché: misurato, `VALORE` era quasi solo presenze — CV(FM prevista) 0.012-0.032 contro CV(Pv previste)
0.24-0.44, e ρ di rango con VALORE 0.19-0.44 contro 0.92-1.00. Nessun coefficiente fittato: la profondità
di rosa viene dalla regola di lega (`config/league_config.json`, 8 squadre 3/8/8/6) più i **tetti di
schieramento misurati** su 2903 undici titolari (p90: `dc` 3, `pc` 2 — esattamente i limiti dei moduli).
L'esponente di beccabilità 0.5 **non è una preferenza**: riproduce la curva misurata della quota di
presenze che un manager riesce a beccare (0.40 sotto il 20% di disponibilità → 0.89 sopra l'80%).

Esito: **23 nomi su 70 contro i 22 di VALORE** — non costa nomi — e Dimarco 1°, Rice dentro, Haaland 5°,
Politano/L.Henrique/De Roon/Colombo/Lauriente/Piccoli fuori, Lukaku non classificato.

### Sei candidate provate il 28/07: **zero adottate**. I set adottati NON cambiano
*(contando anche le tre registrate a parte — R13c, R5b, R3d — e **R17** della sera, la giornata chiude a
**dieci provate, zero adottate**, e i set restano `euro R0c+R3c` · `Serie A R3+R7+R13`.)*

Dettaglio e numeri in `gate-motore-v1.md` §5-quinquies. In sintesi: **R15** (persistenza disponibilità) è
il quasi-passaggio più vicino di tutto il set e su euro ha un coefficiente **stabile** (+0.074…+0.096 su 5
finestre) — là il quasi-fallimento è l'**ampiezza**, non l'instabilità, e il gate oggi non sa distinguere
i due casi. **R16/R16b** (affollamento) bocciate, e R16b ha il **segno opposto all'ipotesi**: misura forza
offensiva del club, non affollamento. **R13c** (produzione misurata) batte la sua predecessora R13b ma ha
14-21 osservazioni valutabili per finestra. **R5b** (forza-club dagli xA) **passa formalmente su Serie A
3/3 e non è adottata**, perché era pre-registrato che un passaggio sulle sole T0/T1/T2 — le finestre di
generazione dell'ipotesi — non confermi nulla.

⚠️ **Famiglia «persistenza» CHIUSA sul lato previsionale** (28/07 sera): la persistenza della
disponibilità è reale **dentro** una stagione (0.29-0.36) e **non si trasferisce** a quella dopo — ρ
indistinguibile da zero su 15 finestre su 15, contro 0.29-0.47 della curva di popolazione già spedita. La
costanza è una proprietà della stagione, non del giocatore, e questo spiega anche la caduta di R15.

⚠️ **Da non rifare**: una correlazione a livello di **club** (misura di input ↔ gol del club l'anno dopo)
**non predice** quale misura aiuti la fantamedia di un giocatore. È contro-informativa: xA sembrava la
migliore su euro (0.66) e la regola là fallisce; su Serie A tutto sembrava debole e la regola là passa.

### Il gate ha cambiato criteri due volte, ed entrambe le volte prima di rilanciare

1. **Stabilità del coefficiente** (§5-sexies): *classifica* e non giudica — separa «piccolo e stabile» da
   «rumoroso» senza cambiare nessun verdetto. Ha subito trovato che **R3, che è adottata, ha il coefficiente
   instabile** — che non è un difetto ma collinearità: il coefficiente non è *interpretabile*, la regola
   funziona (10/10).
2. **Non-danno elastico** (§5-undecies): prima tollerava zero, ora tollera un **2% sull'aggregato** — lo
   stesso `MAX_WINDOW_LOSS` del verdetto robusto — ed è **vincolante anche per l'accuratezza**. Nessuna
   adottata disarcionata (euro 121→127, Serie A 136→149).

### Due famiglie CHIUSE, non sospese

- **Forza-club** (§5-nonies), su decisione presa ad alta voce dopo la quarta bocciatura. Segno giusto tutte
  e quattro le volte; l'input è derivabile dalla fantamedia del giocatore stesso, quindi **non
  incrementale** — come R14 e R16. Costo accettato: Kane +2.35 di errore resta senza spiegazione per questa
  via, e il residuo indica **beta non costante**, che è un meccanismo diverso e già pre-registrato.
  Riapribile **solo** con una misura prospettica, non con finestre nuove.
- **Persistenza sul lato previsionale**: la costanza è una proprietà della **stagione**, non del giocatore —
  ρ indistinguibile da zero su 15 finestre su 15 fra persistenza di input e beccabilità bersaglio.

### Regola nuova, applicata a tutto il documento

**Un coefficiente senza piattaforma, baseline dei residui e data non è un fatto** (§5-septies, §5-octies).
Audit: **5 su 12** dei λ citati si riproducono, due solo contro la baseline pre-due-passate — e uno di quelli
portava un'interpretazione che il segno corretto **ribalta** (R11 *conferma* la sua ipotesi). Trovate anche
due conclusioni scritte al singolare su una quantità che dipende dalla piattaforma (R2, R6).

### Il caso Kean + Piccoli è aperto in modo DIVERSO da come sembrava

Non è «in attesa di uno stimatore migliore»: la penalizzazione per attacco condiviso **non è nei dati** —
il segno misurato va nell'altro verso. Separare forza-club da affollamento richiede i due termini in un
fit solo, che è in parte la quarta corsa a una famiglia bocciata tre volte: decisione da prendere ad alta
voce, non rifinitura da infilare.

**Aggiornato la sera del 28/07 (blocco in cima)**: la separazione è stata fatta, con l'uso rivelato
(attaccanti schierati per undici) al posto della produzione. Il segno esce **giusto e stabile** — quindi
l'affermazione «il segno va nell'altro verso» valeva per R16b, che misurava i gol, non per K. Ma R17 cade
**sull'errore**, e il diagnostico ha ribaltato la premessa del caso: su T1/T2 Kean **e** Piccoli hanno
reso entrambi, come 23 coppie su 23.

### Il gate gira su 10 finestre (Serie A) e 5 (euro)

L'API dei voti autenticata serve stagioni che i dataset Drive non hanno mai coperto. Nel DB: **Serie A
dal 15/16 al 25/26** (11 stagioni → 10 finestre, Tm7…T2) e **euro dal 18/19 al 25/26** (il 21/22 è
**vuoto alla sorgente** — id risolto, 30 giornate scaricate, ogni cella `Voto` = `'-'` — e costa due
finestre: 5 utilizzabili). Una finestra richiede voti su **entrambi** i lati, ingresso e bersaglio.

### Set adottati: `euro → R0c + R3c` · `Serie A → R3 + R7 + R13`

| | tiene su | media | peggior finestra |
|---|---|---|---|
| euro R0c+R3c | **4/4** misurabili | +2.4% | +1.0% |
| Serie A R3+R7+R13 | **10/10** | +4.3% | +1.2% |

- **R7** (persistenza portieri) e **R3** (minuti) non hanno **una sola finestra contro** su 10; il
  criterio stretto le boccia solo per una finestra a +0.1%/+0.2%, sotto la soglia dello 0.5% → si leggono
  con il verdetto **robusto**.
- **R7 era uno stimatore sbagliato, non una scommessa**: la persistenza esce 0.505-0.798 su sette
  finestre (sempre sopra lo 0.50 condiviso), ma valutare ogni finestra col coefficiente della *singola*
  vicina — fittata su ~30 portieri — la faceva cadere. `POOLED_PARAMS` mette in comune le altre finestre
  (leave-one-out): da 4/7 a **10/10**.
- **R0c è il modello nullo dichiarato** (àncora di ruolo + quota media): porta la copertura euro dal 30%
  al **100%** e nessuno stimatore sofisticato lo batte sui giocatori che aggiunge.

### Cadute quando le finestre sono diventate dieci (non riproporre senza finestre NUOVE)

**R4** età (1/10, peggiore −19.6%) · **R10** nuovo allenatore (4/10, peggiore −6.3%) · **R8** fuori-ruolo
(1/6, peggiore −19.2%) · R4b (1/10, −56.6%) · R11/R11b (0/10 — ma il coefficiente **conferma** l'ipotesi ed è stabile su 10/10: cadono sull'errore, non sul meccanismo, `gate-motore-v1.md` §5-septies) · R12/R12b (4-5/10, media ≈0) · R1b (3/10) ·
R2 · R5 (**terza** bocciatura della famiglia forza-club, ora **CHIUSA** dopo la quarta: §5-nonies — corretto il 28/07: `gate-motore-v1.md` §4 nomina le due precedenti, forza-club interna ed Elo additivo movimento) · R6 · R13b · R14/R14b (sfora il non-danno) ·
**R1** (non batte la risposta banale: 0.391 contro 0.373 della sola àncora).

R4, R10 e R8 sembravano fra le migliori del motore a due finestre. **T1 e T2 sono le finestre di
generazione delle ipotesi: passare lì è la prova più debole possibile.**

### Cosa manca, in ordine (aggiornato 4/08/2026)

0. ✅ **Il nuovo allenatore pesa, per la FORMA** (fatto il 4/08, spec «Novità v9.17» §6): `coach_shapes` /
   `coach_shapes_of` nel foglio contano le forme che quell'allenatore ha schierato in ogni sua panchina, ed
   entrano in `shape_odds` **al posto della lega**, pesate da soglia e rampa sul proprio campione
   (`COACH_SHAPE_MIN` 20, `FULL` 60) perché va da 188 undici a zero. Giudicato sulla previsione 26/27:
   **8/17 → 9/17**, Atalanta passa al **4-3-3 di Sarri** (difesa a quattro, 9 uomini su 11 come la fonte) e
   il Milan porta il 3-4-2-1 dal 13% al 41%.
   ✅ **E l'altra metà, il CLAIM, è misurata e NON adottata**: il foglio porta `desc_preseason_starts` /
   `..._matches` e la targhetta li dice, ma niente che scelga un undici li legge (test:
   `test_the_preseason_is_a_reading_and_never_a_criterion`). Sembra decisivo — le due amichevoli di Sarri le
   iniziano Gaetano, Samardzic, Scamacca e **Raspadori**, e De Roon/Ederson/Krstovic **nessuna** — e non è
   usabile: **una sola** pre-season di dati per-giocatore (1696 righe contro 37), 1-3 partite, **Milan e
   Napoli a zero**, minuti assenti in 1399 righe su 1716, avversari l'**U23 del club** e l'Arezzo, e la fonte
   che concorda ha letto le stesse amichevoli. Pre-registrato per giugno 2027 (gate §7), quando per la prima
   volta ci sarà un fuori campione.
0-bis. **Il residuo del board, uno solo e capito** (4/08, dettaglio nel blocco ULTIMO IN ORDINE DI TEMPO
   §8): 4 attacchi su 394 senza un attaccante, tutti Lilla, un **pari merito di claim** (0.83) fra un
   trequartista e una punta per l'**unico** posto d'attacco di un 4-5-1. La strada è la regola 4a portata
   alla selezione: se quel posto andrebbe a un trequartista, la riga di centrocampo cede un posto e il modulo
   esce 4-4-1-1. I centrali su una fascia sono **chiusi** (3 → 0).
0-ter. **Le bande della heatmap, validate e NON in pipeline** (gate §5-quaterdecies): separano chi gioca su
   **entrambe** le fasce da chi gioca al **centro** (Malen 0.37/**0.50**/0.14 contro Pulisic 0.46/0.30/0.24,
   centroidi quasi identici), il payload è già in cache e l'ingest già lo parsa per il centroide. Sul
   **modulo** non spostano nulla, misurato. Se si riaprono, la domanda è un'altra — «copre davvero l'altra
   fascia?», cioè i **ballottaggi** — e va definita prima la metrica, perché le fonti li pubblicano a
   singhiozzo. Costo: migrazione di `positions` + colonna d'ingest + colonna nel foglio.
1. ✅ **Il valore di mercato: FATTO e MISURATO il 4/08 — non adottato** (gate **§7-quinquies**). Sta nella
   pagina rosa di Transfermarkt che già scarichiamo e parsiamo, quindi **zero richieste nuove**, ed è
   **storico**: la pagina di una stagione passata porta il valore di QUELLA stagione (verificato su undici
   stagioni di un club: 225 / 175 / 150 / 100 / 200 mila per lo stesso uomo). Tabella nuova
   `market_values(fc_id, season, source, value)`, **9388 valori · 3180 giocatori · 11 stagioni**, nel
   contratto d'export. Forma misurata: il valore come **quota del valore della rosa**, sulla stagione di
   input — lo stesso argomento del cartellino con un proxy che esiste anche per chi arriva **gratis**, che
   era il buco per cui §7-quater aveva fallito su Modric e De Bruyne.
   **Verdetto: `value_weight` resta 0.0**, e il risultato è **dipendente dalla piattaforma**: su **euro** il
   migliore in pool è **zero** (piatto); su **Serie A** tutti e **sei** i fold scelgono un peso non nullo
   (0.10-0.20) e la curva in pool è una U pulita, ma il guadagno medio è **+0.08%** contro un pavimento di
   **0.5%**, con due fold negativi. Il proxy migliore ha comprato **il verso, non la taglia** — e il
   cartellino non aveva nemmeno quello. Conferma la lettura di §7-quater: **il meccanismo è già nei minuti**.
   ⚠️ Non riproporre nella stessa forma: la riaprirebbero gli **ingaggi** (nessuna fonte li porta) o la
   **variazione** del valore dentro la stagione, che è un'altra domanda e serve la serie per data.

### Cosa manca, il resto (invariato dal 29/07)

0. **I nuovi arrivi senza storico non sono prezzabili** (salito in cima la sera del 28/07, vedi il blocco
   ULTIMO IN ORDINE DI TEMPO): Openda e David non stavano in nessuna top-10 predetta, quindi nessuna
   metrica d'asta — sconto, premio o riordino — può proteggere da loro. Sblocca insieme la copertura
   Serie A (punto 3) e la pressione di reparto. Strada già pre-registrata: R13c, che è ferma per
   **campione** (14-21 osservazioni valutabili per finestra), non per ipotesi → il 26/27 la sblocca da sé.
1. **Prezzare l'asta che viene.** `rosters 2026-27` = 0 (il listone non è ancora uscito) *e* l'harness non
   ha una modalità **live**: ogni percorso assume un esito (`_window_is_usable` pretende ≥50 `fm_act`, il
   tab Auction elenca solo stagioni concluse, `auction_view` confronta due liste). Per un'asta serve **una
   lista sola**. È il lavoro più importante e non è iniziato.
2. **Il lato fantamedia non ha un solo miglioramento validato.** Delle cinque regole adottate quattro sono
   presenze e una è copertura: la FM è ancora esattamente il core pubblicato (àncore + beta + M2e). Sei
   famiglie di ipotesi sulla FM sono state provate e sono cadute.
3. **Copertura Serie A**: 8 posti su 40 nelle top-10 reali irraggiungibili, **4 attaccanti su 10** — quel
   ruolo è tappato a 6/10. R0c non passa lì (il core è a 0.281 e una stima di qualità-àncora sfora il +30%
   di un punto): serve uno stimatore che batta l'àncora.
4. ~~**`injuries` = 0 righe**~~ **modulo scritto il 28/07 notte** (Transfermarkt, assenze datate +
   `matches_missed`): la fonte è agganciata e la camminata per-giocatore gira. Resta da **usarlo**, che
   è una domanda da gate: `_inactivity` oggi stima le assenze dai buchi del layer per-partita
   («l'injury proxy»), e sostituire una stima con un fatto è un'ipotesi nuova, da pre-registrare.
5. **Storia di `probable_starter`/`availability`**: esiste solo lo snapshot 2026-07-26, **impossibile a
   posteriori**. Il job settimanale ora c'è (`scripts/weekly-snapshot.ps1 -Register`) — **va registrato
   sulla macchina**, ed è la forma pre-registrata di R7. Ogni settimana non registrata è una finestra ⛔ **SUPERATO il 05/08/2026**: nessun job, decisione dell'operatore (vedi il blocco in cima).
   che non tornerà.
6. A rendimento calante: voti Serie A prima del 15/16 (non sondati), layer per-partita per 15/16-18/19
   (servirebbe solo a ri-testare R8 e R14, già bocciate). ~~`club_elo` oltre le 2 date~~ **risolto**:
   l'API ClubElo dà tutte e 10 le date d'asta (921 righe, 99 club). **A chi serve, corretto il
   07/08/2026**: a **R19**, il canale livello (l'Elo del club di PROVENIENZA muove le presenze di chi ha
   cambiato squadra, adottato su `default` il 06/08) e alla scheda club. **Non ai portieri** — M2e legge i
   gol subiti misurati, mai `club_elo` — e non a R5, famiglia chiusa.
7. **La conferma pulita resta la finestra 26/27, giugno 2027**: tutto l'adottato è stato generato
   guardando gli esiti di T1/T2.

### Dati e strumenti

`validate`: **5759 giocatori Mv- e FM-consistenti, 0 FM-off**. 218k+ righe `match_ratings`, 2.28M bonus
grezzi, `external_stats` su 11 stagioni, `external_match_stats` su 7 (109k righe dal layer per-partita
completato), `matchday_map` per lega anche sulle stagioni vecchie, voto sintetico ricalibrato
(MAE fuori campione **0.369**), FM-equivalente su 1482 arrivi.

Dalla v9.3: sei colonne di tiro su `external_match_stats` e **`club_match_lineups`** (conteggi di reparto
per undici, fuori dall'imbuto dell'identità); `probable_starter` tiene modulo, squadra e panchine;
`positions --layer reparse` ri-parsa la cache senza rete.

Dalla **v9.4**: `injuries` (assenze datate + `matches_missed` + `contract_until`/`exit_risk`),
`positions.avg_x/avg_y` dalla heatmap, `club_elo` **921 righe su 10 date** dall'API, `ingest_runs`
scritta, `config.SEASONS` fonte unica, `bootstrap` (acquisizione da zero, ~17 h ripartibili),
`fetch --plan/--inbox`, **`export`** (bundle app: 229k righe, 29 MB, manifest con provenienza e buchi
noti), UI con tema light/dark. Cross-tab ruoli: **D→D 97%**, M→C 80%, F→A 80%, G→P 100%.

**232 test verdi, ruff pulito** (nessuno tocca la rete). Toolkit **v0.3.0**, spec **v9.9**. `recent_form` ha `--bonuses-only`
(arricchisce i bonus delle partite già salvate, una richiesta per partita, senza ri-risolvere l'identità):
**1195/1196** partite arricchite, **122/123** giocatori completi. `python -m euroleghe_ingest backtest [--verify] [--gate] [--auction]
[--cases] [--pairs] [--window Tm7..T2] [--platform euro|default] [--game classic|mantra]`. GUI: tre tab, il terzo è
**Auction** (stagione/piattaforma/game/**Rank by**, per ruolo i 10 migliori previsti con l'FVM reale
accanto e i 10 reali col previsto — nella valuta scelta, SURPLUS per default, più la colonna **Pair**
per i compagni di reparto in classifica). Backup: `scripts/backup-data.ps1` specchia `data/` fuori dal
repo — la cache **deve** restare in `.gitignore` (gli Excel vietano la ripubblicazione, il repo è pubblico).

## STATO PRECEDENTE (primo giro toolkit, 26 luglio 2026)
**Toolkit `euroleghe-ingest` — primo giro IMPLEMENTATO** (Python 3.13, venv in `toolkit/.venv`, SQLite `data/euroleghe.db`, GUI Tkinter `python -m euroleghe_ingest gui`):
- **Operativi**: `rosters`, `stats`, `ratings` (scraping Excel autenticato **+ listone quotazioni**), `arrivals`, `elo`, `validate`, `rebuild` (idempotente, reset in-place). GUI: vista calciatori (pillole ruolo colorate, ordinamento persistente per ruolo, toggle Fantavoti a griglia, icona campetto).
- **Dati scaricati e riallineati**: voti EuroLeghe (`platform='euro'`) + Serie A classica (`platform='default'`) per 2023-24/24-25/25-26; **listoni** (ruoli Mantra + prezzi, fogli Tutti+Ceduti) per entrambe le piattaforme → Serie A copertura Mantra ~96%, prezzi anche su Premier/Liga/Bundes/Ligue1. `rebuild` verde (allora 234 FM-off nel soft check: causa individuata e corretta in fase 1, ora 0).
- **Decisioni chiave** (dettaglio in `spec-euroleghe-ingest-v9.md`): `platform` = euro|default in PK (calendari diversi) · `gameType` = classic|mantra (motore) · aggregazione opzione A · `season_stats` per piattaforma · propensione stagione piena (FBref fatti + Sofascore rating/heatmap + **voto sintetico calibrato**, mai nel target euro; tutto passa dal gate) · mappa giornate euro↔reali **per lega**.
- **Code review** fatta (robustezza: utf-8-sig/BOM, scritture atomiche + try/except nei reingest, retry di rete, indici DB; consolidamenti). Scartato l'aggiunta del bonus imbattibilità al fantavoto grezzo (verificato: peggiora la coerenza FM). Ruff pulito, 25 test verdi (+1 skip GUI headless).

**Commit** (branch `master`): `0bceb23` platform · `85b7a09` season_stats per-piattaforma · `258905e` listone · `7619d27` listone Ceduti · `e7e2394` migrazione doc in git · `b831f5f` code review.

## FASE 1 — FATTA (26 luglio 2026), con SofaScore al posto di FBref
Dettaglio tecnico e numeri in `spec-euroleghe-ingest-v9.md` → «Novità v9.1».
- **FBref è bloccato** (interstitial Cloudflare: 403 su ogni path anche con impersonation TLS) → **SofaScore
  è la fonte primaria dei fatti**: stessi dati (gol/assist/minuti/xG/xA) **più il rating per-partita** che
  serve al voto sintetico. FBref resta arricchimento futuro (rigori di carriera, piazzati) via browser
  headless o inbox manuale. Client `curl_cffi` (impersonate chrome): `requests` prende 403.
- **Nuove tabelle**: `external_stats`, `external_match_stats`, `matchday_map`. **Nuovi moduli**: `matchdays`
  (calendario euro↔reale) e `synth` (voto sintetico); `positions` è il modulo SofaScore
  (`--layer season|match|all`). Identità in `matching.py` (tier + pool club→lega→stagione, iniettività
  fc_id↔id provider, `manual_overrides` con precedenza, non risolti nel `coverage_report`).
- **BUG CORRETTO: rigori invertiti** nell'Excel dei voti (`Rf` = fatti, `Rs` = sbagliati; erano scambiati) →
  ai rigoristi il fantavoto applicava −3 invece di +3. **Il check FM è passato da 234 fuori tolleranza a 0.**
- **Validazioni**: gol SofaScore vs Serie A `default` **100% esatti** su 3 stagioni · copertura perimetro
  **96–100%** · la mappa giornate da SofaScore concorda **29/29** con quella dai nostri voti.
- **Voto sintetico**: retta per ruolo sul Mv euro (pendenza 0.52 P → 0.84 A), MAE 0.358 vs 0.460 baseline.
- **Vista calciatori**: griglia sul calendario **reale** con le giornate fuori dal calendario euro colorate
  a parte (valore = voto sintetico). Test: 52 verdi. `rebuild` offline verde.

## STRATO FLAG/ARRIVI — FATTO (27 luglio 2026)
Dettaglio e numeri in `spec-euroleghe-ingest-v9.md` → «Novità v9.2». In sintesi, le tabelle che erano
vuote ora ci sono: `penalty_hierarchy` 1463 · `probable_starter` 442 · `availability` 103 ·
`positions` 3862 · `flags` 837 · `arrivals.tier` 1390 e `foreign_fm_equiv` 655 · `birth_year` 1861 ·
`tournaments_squads` (Mondiale 2026: 344 giocatori del perimetro, 95 247 minuti) · `coaches` e
`transfers_history` da Transfermarkt.
- **Rigoristi**: la pagina ufficiale è ancora vuota (preseason) → implementata la **gerarchia
  rivelata** dai nostri voti, che lo spec mette comunque al primo posto (918 rigori).
- **Ruolo reale gratis**: il layer per-partita aveva già la posizione su 100% delle righe → 312 flag
  `off_role_usage` senza una richiesta in più.
- **FM-equivalente estera**: calcolata sulla stagione reale piena, **+0.035 di scarto medio** dalla
  FM euro reale dove possiamo confrontarle. È l'input che mancava al gate 3.2.
- ⚠️ **Parametri provvisori** (`DECAY`/`MISS_PENALTY` dei rigoristi, soglie di tier): sono scelte di
  modello, le possiede il gate. Non usarli come stabiliti.

## HARNESS DEL GATE — ESISTE (27 luglio 2026)
Il collo di bottiglia storico è stato affrontato: la regola d'oro ora ha **forma eseguibile**.
`toolkit/euroleghe_ingest/engine/` (model · fitting · features · evaluate) + comando
`python -m euroleghe_ingest backtest`, **read-only** sul DB, scrive solo
`data/reports/engine_backtest.json`. È anche il **riferimento da cui portare il motore TypeScript**
in `app/prediction-engine`, quindi resta senza dipendenze ed esplicito.
- `backtest --verify` **riproduce 22 numeri su 22** (dal 4/08/2026; era 15/18, e i tre che mancavano
  erano tutti del modulo presenze su T1: il documento che li pubblica è del **22 luglio**, cioè
  **prima** che `platform` esistesse, quindi erano misurati su un dataset che mescolava i due
  calendari. La conclusione era anche data al singolare su una quantità **dipendente dalla
  piattaforma**: su `default` il modulo batte il naive su entrambe le finestre (−5.2% / −2.9%), su
  `euro` solo su T2. Il criterio di adozione — il **bias**, 4-6 giornate fantasma azzerate — si
  riproduce su tutto. Dettaglio in `presenze-attese-v1.md`, blocco «RIMISURATO»)
- ...e i numeri pubblicati che verifica (ancore Classic/Mantra, beta Mantra,
  coefficienti Pv, portieri M2e su entrambe le finestre, bias titolari T2).
- **3 da rivedere, tutti sul modulo presenze in T1**: `pv_gain_vs_naive_T1` (atteso −0.016, ottenuto
  +0.018), `pv_bias_naive_starters_T1` (5.2 → 4.17), `pv_gain_crossfit_T1` (−0.016 → +0.013). In T2
  tornano. **Finché non è chiarito, il guadagno del modulo presenze su T1 non è confermato.**
- L'**inventario input** stampato dice cosa manca al motore: su T2/euro `starter_prob` è **0/1453**
  (le probabili sono di oggi, non della stagione passata → servono snapshot settimanali).

## GATE — il registro di come ci si è arrivati (27 luglio 2026)
*Lo stato corrente è nel blocco in cima; qui sotto la cronologia, che in punti è superata.*
Documento dedicato, con tutti i numeri e le ipotesi falsificate: **`gate-motore-v1.md`**. In sintesi:
- **Adottate per piattaforma**: **euro → R0c** (copri i non prezzati con l'àncora di ruolo e la quota
  media) **+ R3c** (minuti sulle giornate del calendario euro) **+ R4** (età sulla FM) **+ R7**
  (persistenza portieri) **+ R10** (nuovo allenatore) · **Serie A → R3 + R7 + R13**.
- ⚠️ **R1 e R13-euro sono USCITE**: una code review ha mostrato che il criterio di copertura si
  soddisfaceva **prevedendo una costante**. Ora una regola di copertura deve battere la risposta banale
  (àncora di ruolo + quota media) sui giocatori che aggiunge, e R1 non la batte (0.391 contro 0.373 su
  T1). Al loro posto **R0c**, la risposta banale dichiarata come tale: costa niente e porta la copertura
  euro **dal 31% al 100%**. Le regole di accuratezza si giudicano ora sui giocatori che **spostano**, con
  una soglia dello 0.5%: R4 e R10 ne escono molto più forti (−3.8% e −3.5% sul loro sottoinsieme), R14
  ne esce bocciata.
- **Risultato**: euro VALORE **−1.7% / −1.5%**, top-10 6→8 e 12→**15**, copertura **31%→100%** ·
  Serie A VALORE **−4.2% / −2.8%**, top-10 11→13 e 14→15. Portieri: presenze −17%.
- **DUE STAGIONI IN PIÙ (sera del 27/07, §3-ter)**: l'API dei voti serve anche 22/23 e 21/22 (e 20/21),
  con layout identico → **euro passa a 3 finestre** (T0 = 22/23→23/24) e **Serie A a 4**
  (Tm1 = 21/22→22/23). *EuroLeghe 2021-22 non ha voti*: l'id si risolve e le 30 giornate si scaricano,
  ma ogni cella `Voto` è `'-'` — quindi l'euro guadagna una finestra, non due.
  **Cosa cambia nei verdetti**: **R10 confermata su tutte e tre** (Pv MAE −5.2%/−3.5%/−4.9%, ed è il
  maggior contributore alle top-10: +3 su T1) · **R0c confermata** · **R4 ESCE** (contraddetta su T0,
  coefficiente da −0.004 a −0.018 fra le finestre) · **R7 resta con riserva scritta**: non passa il
  criterio «migliora su ogni finestra» perché la sua *premessa* — il modello condiviso perde contro la
  persistenza pura sui portieri — è vera su tre finestre e **falsa sulla quarta**, e non è valutabile il
  giorno dell'asta. È una scommessa 3 su 4 che rende −12%…−20% e costa +1.2%.
- **TUTTO L'ARCHIVIO (§3-quater)**: i voti Serie A arrivano almeno al 2015-16 ed **euro 2020-21 ha i
  voti** (il 21/22 è un buco di una stagione). Ingerite altre 5 coppie stagione-piattaforma →
  **7 finestre su Serie A, 4 su euro**. E il risultato più importante di tutta la giornata:
  **R7 non era una scommessa, era uno stimatore sbagliato.** La persistenza dei portieri esce
  0.505-0.798 su sette finestre, sempre sopra lo 0.50 condiviso — il meccanismo è confermato ovunque —
  ma ogni finestra veniva valutata col coefficiente della *singola* finestra vicina, fittato su ~30
  portieri. Mettendo in comune le altre finestre (leave-one-out, `POOLED_PARAMS`): **da 4/7 a 7/7
  finestre vinte, media +9.8%, peggior finestra +1.6%**. R7 su Serie A è adottata senza riserve; su euro
  esce (3/4 ma solo +1.9-3.3%, sfora il non-danno, pareggio sulla metrica d'asta).
  Set adottati ora: **euro R0c+R3c+R10 · Serie A R3+R7+R13**. Il set Serie A migliora il MAE di VALORE
  su **tutte e sette** le finestre e non perde mai una posizione top-10 (91→96 nomi).
- **PASSATA ESEGUITA (§3-sexies)**: voti euro 18/19 + Serie A 17/18-15/16 e **layer stagionale
  SofaScore su 19/20-22/23**. Ora **10 finestre su Serie A e 5 su euro**. Il layer stagionale è costato
  **20 minuti**, non ore: `download_season_stats` è paginata, 6 richieste per lega-stagione — la stima
  «~1300 richieste/stagione» era sbagliata di due ordini di grandezza, e per quella stima la passata era
  stata rinviata. Esito: **il set Serie A (R3+R7+R13) tiene su tutte e 10 le finestre** (media +7.4%,
  peggiore +2.5%, top-10 mai peggiore) · **R3 passa 6/6** (era misurata su 2) · **R7 non ha una sola
  finestra contro** su 10 (media +8.3%; il criterio stretto la boccia solo per una finestra a +0.1%,
  sotto la soglia dello 0.5%) · **R4 bocciata 1/10** e **R10 7/10 con una finestra a −6.3%**: due regole
  che a due finestre sembravano fra le migliori. Sull'euro restano R0c+R3c, e R3c è cieca su 3 finestre
  su 5 finché il **layer per-partita** (in corso, ore) non copre le stagioni vecchie.
  **Layer per-partita COMPLETATO**: 734 round (la Ligue 1 19/20 finì al 28°, COVID), **109.126** righe
  `external_match_stats`, `matchday_map` per lega anche sulle stagioni vecchie, voto sintetico
  ricalibrato (MAE fuori campione 0.369) e FM-equivalente su 1482 arrivi invece di 267. Esito finale:
  **euro R0c+R3c tiene 4/4** (media +2.4%) e **Serie A R3+R7+R13 tiene 10/10** (media +4.3%). R3c passa
  4/4 dove è misurabile; **R3 e R7 non hanno una sola finestra contro** (robuste sì, strette no, per una
  finestra a +0.1%); **R8 ora misurabile e bocciata 1/6** con la peggiore a −19.2%. Asta: Serie A
  **136→149 nomi su 400** con VALORE catturato su 8 finestre su 10, euro 42→44 su 200.
  Backup: `scripts/backup-data.ps1` specchia `data/` fuori dal repo — la cache è in `.gitignore`
  (e deve restarci: gli Excel vietano la ripubblicazione e questo repo è pubblico).
- **AUDIT DEI DATI (§3-quinquies)**: lo strato voti è completo (15 coppie stagione-piattaforma,
  218.672 righe, `validate` a 5195 giocatori consistenti) e **non serve altro scraping per i voti**.
  Due input non mancavano, erano solo **non ricalcolati**: `flags.new_coach` (da `coaches`, che risale
  al 1886) e `arrivals` (diff fra listoni) — ora 8 e 7 stagioni invece di 3 e 2, **senza una richiesta
  di rete**. E col test finalmente eseguibile **R10 cade** (3/4 finestre su euro, 4/7 su Serie A,
  peggior finestra −6.7%): aiutava sulle finestre su cui era stata inventata. Terza volta in un giorno
  che il gate trova lo stesso schema, dopo R4 e R7-euro.
  **Set adottati: `euro → R0c + R3c` · `Serie A → R3 + R7 + R13`.** Sull'euro restano due
  miglioramenti dimostrati, uno dei quali è il modello nullo; su Serie A il set tiene 7/7.
  **La sola passata di scraping che conta**: SofaScore su 19/20-22/23, perché senza i minuti storici le
  finestre vecchie sono cieche esattamente sulle regole che il motore usa. Poi, a costo quasi nullo:
  euro 18/19 (~5 min) e Serie A 17/18-15/16 (~20 min) per quattro finestre in più.
  Impossibili: voti EuroLeghe 21/22 (file vuoti alla sorgente) e la storia di `probable_starter`.
- **Vista «Auction» nella GUI** (terzo tab, spec §Vista Auction): stagione / piattaforma / game
  selezionabili e, per ogni ruolo, i 10 di VALORE previsto più alto con l'**FVM effettivo di fine
  stagione** accanto, più i 10 realmente migliori con il **VALORE che il motore aveva previsto**.
  Passa dalla stessa `evaluate.auction_view` del gate, quindi pannello e `backtest --auction` non
  divergono. Nuove colonne `rosters.fvm` / `fvm_mantra` (rendicontazione, mai input).
- **Simulazione dell'asta 25/26** (`backtest --auction`, §3-bis del documento del gate): 15/40 nomi
  azzeccati, ma **80% (euro) e 81% (Serie A) del VALORE** che avrebbero reso le top 10 perfette. La
  metrica dei nomi tratta ogni errore allo stesso modo; quella dei punti dice che gli errori del motore
  sono fra giocatori comparabili. Gli errori residui si dividono in **cambio di regime** (14 sull'euro,
  giocatori esplosi da un anno all'altro) e **mai prezzati** (8 su Serie A, di cui 4 attaccanti su 10 →
  quel ruolo è tappato a 6/10 finché la copertura Serie A non migliora).
- **I 3 numeri presenze/T1 sono spiegati** (era il blocco n.1): i coefficienti rifittati coincidono col
  pubblicato entro 0.015, quindi non è il codice; non è nemmeno la definizione dei segmenti (testata);
  è la **composizione del campione** (764/774 giocatori contro 750/754) su un effetto da −1.6%. Del
  modulo presenze è confermato il **bias**, non il guadagno di MAE su T1.
- **9 ipotesi falsificate con motivo registrato**, fra cui: sconto adattamento cross-lega (segno opposto
  fra finestre), propensione per-90 (γ≈0 di segno sbagliato), **àncora forza-club da Elo ri-bocciata la
  terza volta**, rigoristi in forma ridotta, concorrenza posizionale (migliora il MAE **col segno
  contrario all'ipotesi**), attesa di mercato e sua revisione.
- **Due difetti dei dati corretti dal gate**: l'FM-equivalente dei **portieri** era gonfio di +1.06
  (nessun termine gol subiti → ora NULL) e il **prezzo era di fine stagione** (`Qt.A`): ora c'è
  `rosters.price_initial` = `Qt.I`, la quotazione d'asta, e i tier degli arrivi la usano.

## LAYER PER-PARTITA COMPLETATO — FATTO (27 luglio 2026)
`positions --layer complete` (merge incrementale sulla cache) ha portato il layer da 3.314 a **5.254
partite su 5.256 = 100%** di tutte e 5 le leghe × 3 stagioni; `external_match_stats` a 110.597 righe.
**Il bias di selezione è sparito**: 0 club con layer incompleto contro 12/12/11. L'FM-equivalente degli
attaccanti dimezza il MAE (0.249 → 0.133) e passa dal 67% al **94%** entro 0.3 dalla fantamedia reale.
Le feature di input del motore ora si aggregano dal layer per-partita (identità indipendente dalla
stagione) e non dagli aggregati stagionali: **copertura euro dal 31% al 42-43%** del listone, **β_new
raddoppia** (0.19 → 0.43), Ezzalzouli passa da fuori-classifica a VALORE 110. Set adottati invariati.
Due verdetti corretti (R2 e R8: l'instabilità di segno era dei dati) e un effetto vero con l'etichetta
sbagliata da ri-pre-registrare — tutto in `gate-motore-v1.md` §5-bis.

## GIOCATORI PREZZATI SENZA STORICO — FATTO (27 luglio 2026)
Nuovo modulo **`recent_form`**: per i giocatori che il listone prezza sopra la mediana del loro ruolo e
di cui non abbiamo niente (arrivano da Eredivisie, Championship, Liga Portugal, Serie B, Süper Lig…),
scarica le ultime N partite di club con rating e minuti, **datate**, sotto `source='sofascore_recent'`
per non contaminare la retta del voto sintetico. **113 giocatori, 1.094 partite, 89% di identità
risolte.** Il gate ha spezzato la regola che le usa: **quanto** gioca si trasferisce (R13, presenze dai
minuti al vecchio club: ✅ su tutte e tre le piattaforme, adottata), **quanto bene** gioca no (R13b,
rating confrontato fra campionati: ❌, λ −0.45/+0.05). Copertura del motore sull'euro **dal 31% al
45-49%** del listone. Dettaglio in `gate-motore-v1.md` §5-ter.

## PROSSIMO LAVORO
1. **Storico `injuries`**: l'unico input della Priorità 1 ancora assente (Transfermarkt, una richiesta
   per giocatore). Metà dei buchi nelle top-10 dei difensori sono infortuni.
3. **Terza finestra**: verificare quanto indietro va l'API Excel dei voti. Con T0 = 22/23→23/24 i
   parametri che oggi oscillano (età −0.006/−0.016, δ_cross −0.04/+0.16) diventerebbero identificabili.
4. **Ad agosto, quando esce**: listone/quotazioni 26/27 → aggiungere `2026-27` alle costanti `SEASONS`
   (`ratings.py`, `positions.py`, `transfers.py`), scaricare voti e Elo alla data d'asta 2026-08.
   Salvare anche `Qt.A M`/`Qt.I M`/`FVM`, già presenti nel file.
5. **Non misurabile con i dati attuali** (registrato, non da riproporre): il modello piazzati — la
   colonna `assists_set_piece` è NULL su tutte le righe di voti di ogni stagione, la sorgente non ha mai
   splittato gli assist. E `probable_starter`/`availability` esistono solo come snapshot di oggi:
   usabili live per l'asta 26/27, inutili nel gate retrospettivo.
6. Poi: algoritmo completo asta 26/27.

## Convenzioni operative
git = casa canonica (Drive solo su richiesta esplicita) · risposte in chat in **italiano**, tutto il repo (codice, commenti, log, nomi file, .md) in **inglese**; i doc KB in `docs/model/` restano in italiano · `fc_id` chiave primaria · credenziali solo in `.env` · **quando l'utente scrive "chiudi"**: consolidare tutti gli .md di `docs/model/` (+ CLAUDE.md se serve) con stato/decisioni/commit/prossimi passi e committare.

**Ultima sessione (29/07/2026)**: lo snapshot d'asta e' ora un tavolo di lavoro - percentuale = quota di
giornate (standing x availability), campetto a griglia che rispecchia il modulo, precampionato ingerito
(`positions --layer extra`, tag `sofascore_extra`, descrittivo e mai gated), snapshot AS OF una data e per
un singolo club. Poi, nella seconda passata dello stesso giorno: la stagione misurata arriva **spaccata fra
il club attuale e altrove** e la standing pesa la seconda meta' a `LOAN_DISCOUNT = 0.60` (Marin R. 0.57 ->
0.34); un **ballottaggio e' posizionale e parla solo il ruolo REALE** - un codice granulare condiviso, mai
il ruolo Classic, che al Napoli metteva Politano in duello con un regista; e quel vincolo ha scoperto che
**827 fc_id avevano gli aggregati sofascore e nessun id in `player_xref`** (Saka, Guirassy, Torres F.),
quindi erano invisibili a ruoli granulari, heatmap e strato per-partita insieme. Causa: l'identita' era
scritta dentro il giro per stagione, e la decideva l'ultima stagione processata. Recuperate **815
identita'** offline; ora il foglio ha 32 giocatori senza codice invece di 152. Terza passata: **prestito
contro acquisto** con la differenza misurata dalla storia delle rose (`LOAN_DISCOUNT 0.60` se questo club lo
aveva e lo ha mandato via, `ARRIVAL_DISCOUNT 0.80` se non lo ha mai giudicato), e **uno slot sa la sua
linea** e non solo la fascia - la fascia sul badge e' quella della maglia, una linea a corto di uomini
prende dal surplus di un'altra invece di lasciare la maglia vuota (il Bayern disegnava dieci uomini), e
`LANE_DEPTH` impedisce che il quinto centrocampista sia un centrale difensivo. Il punto di ripresa, con
«cosa resta in ordine di leva», e' la sezione di chiusura di
[stato-progetto-continuita-v5.md](stato-progetto-continuita-v5.md).
