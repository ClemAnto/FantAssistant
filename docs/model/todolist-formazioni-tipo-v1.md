# Todolist — formazioni tipo più veritiere (v1, 08/08/2026)

*Nata dal confronto con le fonti giornalistiche dell'08/08/2026 (20 club, 4-6 fonti ciascuno:
moduli 10 uguali + 5 sull'alternativa dichiarata + 5 divergenti; uomini 159/220 = 72%). Ogni voce
porta la sua evidenza misurata, il giudice con cui si decide, e la resa attesa. Ordinata per resa.
Meccanismo e formule: [formazioni-tipo-v1.md](formazioni-tipo-v1.md). Dati del confronto:
`data/reports/press-formations-2026-08-08/`.*

**Regola che vale per tutta la lista**: la stampa è un GIUDICE, mai un input del claim — leggerla
dentro il modello renderebbe circolare proprio il confronto che la usa. E nessun criterio si
allarga perché un caso l'ha fallito (CLAUDE.md, 06/08/2026).

---

## 0. Il giudice: la referenza stampa come DATO, e il confronto ripetibile
**Perché**: le voci 3, 4 e 5 si decidono «contro la stampa», quindi la referenza deve essere un
dato datato e il confronto una misura ripetibile — oggi vive in tre script di scratchpad e sei
JSON copiati a mano. La spec v9.38 chiedeva esattamente questo: «i valori vanno rimisurati quando
ci sarà di nuovo una referenza esterna sulla stagione che si asta».
**Cosa fare**: (a) tabella `press_formations(club, season, observed_on, source, module,
module_alternatives, xi, confidence)` — un fatto per-GIORNO come `probable_starter`, mai
backfillabile; (b) portare nel toolkit l'estrazione headless delle board (oggi
`extract_boards.py`) e il confronto (`compare.py`), come harness richiamabile — gli stessi test
del pannello già costruiscono viste headless; (c) il report dice moduli-uguali / alternativa /
divergenti e uomini condivisi, per club.
**Giudice**: n/a — è il giudice.
**Resa**: abilita tutto il resto; costo un pomeriggio.

## 1. Aggregati Serie B per i club promossi («il claim di una promossa è rumore»)
**Perché, misurato**: Frosinone XI disegnato con claim 0.07-0.43 → **4/11** contro la stampa;
Venezia 7/11, Monza 8/11. Il MODULO invece esce giusto su tutte e tre (i lineups di B ci sono:
24-30 undici; Venezia 3-5-2 al 94% come la stampa). Manca il campionato `serie-b` in
`external_stats` (l'aggregato per-campionato che riempie starts/minuti), il per-partita ne ha
12-15 partite su 38, e `clubs.league_XIs` = 0 per tutte e tre.
**Cosa fare**: acquisire gli aggregati stagionali serie-b per le rose promosse (stessa via di
`positions`/fbref, source-tagged); compilare `league_XIs` per il campionato d'origine; NON serve
il voto sintetico (il claim legge starts/minuti, non il rating — e serie-b non è tra le
competizioni calibrate di `synth`, v9.19: non va convertita).
**Giudice**: il confronto (voce 0) sui tre club promossi; nessun `engine_*` si muove.
**Resa attesa**: le tre XI peggiori del confronto; ricorre ogni estate (3 club/anno).

## 2. Transfers: risoluzione dei nomi e freschezza («i nuovi acquisti restano in panchina»)
**Perché, misurato**: Lazio **4/11** con tre titolari attesi che sono arrivi di luglio (Doekhi,
Pedraza, Taylor); Fiorentina 7/11 (Mastantuono, Valdepenas, Oulai attesi titolari); Roma: la
stampa schiera Molina e **Molina N. non ha NESSUNA riga in `transfers_history`** pur avendo
l'identità (fc_id 4998). Il refresh dell'08/08 riporta «4.422 nomi irrisolti», e ogni data è
01/07 (semantica inizio-contratto di Transfermarkt: le operazioni di fine luglio non si
distinguono).
**Cosa fare**: (a) misurare il tasso di risoluzione del parser transfers contro `player_xref`
e recuperare la coda (stessa famiglia della matching per club: chiave canonica, mai la
stringa); (b) valutare una data-osservazione accanto alla data-contratto; (c) i canali
d'arrivo adottati (level 0.06, level_gap 0.06) raggiungono un uomo solo se l'arrivo ESISTE nel
dato — prima il dato, poi ogni discussione sui pesi (regola di §7-quater: «fix the input before
tuning the weight»).
**Giudice**: tasso di risoluzione prima/dopo + il confronto (voce 0) sui club di mercato pesante.
**Resa attesa**: Lazio/Fiorentina/Roma; tocca anche desc_arrival, sconti d'arrivo, partenze.

## 3. La selezione e il trequartista («Paz fuori dall'undici»)
**Perché, misurato**: Como — Paz N. ha **il claim più alto della rosa (0.753, 33 start) e non è
nell'undici disegnato**: primo codice AM → pool d'attacco; l'unico posto davanti del 4-5-1 va
alla punta per `_fronted` (gap 0.155 < 0.40, la regola funziona come scritto); non essendoci riga
di trequarti, cade tra le linee mentre un terzino a claim-prior 0.562 gioca esterno di
centrocampo. `_two_rows` (la riga a 5 che si spezza in 2+3) arriva DOPO la selezione, quando Paz
è già fuori. Stessa famiglia del «Touré a 0.00» che generò `_flanked` — la domanda del claim
posta un passo prima.
**Cosa fare**: progettare la regola alla SELEZIONE (candidate: il pool della riga a 5 considera
gli AM quando la maggioranza della riga «gioca avanti»; oppure `_fronted` che retrocede un uomo
deve lasciarlo in gara per M/T, mai fuori dall'undici). Una proposta per volta, in Pareto come
`_settle`.
**Giudice**: invarianti sulle 394 board (0 rotture) + il confronto (voce 0): Como 9→10-11, forse
Lecce 8→9-10. Attenzione alla lezione v9.16: se aggiustare un club ne rompe un altro, è il
MODELLO sbagliato, si annota e si torna indietro.
**Resa attesa**: 1-2 club oggi, ma è la classe di difetto più visibile all'operatore.

## 3-bis. Co-titolarità misurata: due che non coesistono non si disegnano insieme
**Perché, misurato (08/08/2026, su richiesta dell'operatore: «Scamacca e Krstovic giocheranno
entrambi ma non contemporaneamente — due Pc difficilmente coesistono in campo»)**: la board
dell'Atalanta disegna un 4-3-1-2 con Krstovic (0.484) E Scamacca (0.452) davanti, ma nel 2025-26 —
già sotto il predecessore — hanno iniziato insieme **5 partite su 24 start a testa** (47 partite
comuni: una maglia in rotazione). Il controesempio che la regola deve rispettare è l'Inter:
Lautaro+Thuram **18 co-start su 23** — le due punte che coesistono davvero. «Mai due Pc» sarebbe
falso; «due che non hanno mai coesistito non si disegnano insieme» è misurabile e ha i due ancoraggi.
**Cosa fare**: (a) portare sul foglio la co-titolarità per coppie dello stesso club/linea (dal
per-partita `external_match_stats.started`, per la stagione di input) — es. `desc_costart_top`:
per ciascuno, il compagno di linea con cui ha co-iniziato di più e la quota; (b) regola alla
SELEZIONE: se i due candidati alla stessa linea hanno co-start sotto una soglia (da griglia
pre-registrata; gli ancoraggi dicono che sta fra 0.21 e 0.78), entra il claim più alto e l'altro è
il PRIMO rivale sulla targhetta; (c) limite dichiarato: per un cambio allenatore la co-titolarità
misurata è del predecessore — qui però il segnale era già giusto.
**Giudice**: referenza stampa (voce 0) + 394 board (l'Inter, il Venezia e il Torino non devono
muoversi) + gli ancoraggi.
**Resa attesa**: Atalanta (davanti resta UNA punta e il 4-3-3 recluta le ali: Zalewski/Raspadori
sono i nomi che la stampa schiera), e ogni coppia in rotazione che oggi viene disegnata coppia.

## 4. `COACH_SHAPE_MIN` / `COACH_SHAPE_FULL` (20/60): la verifica ESTERNA del giudice interno
**Perché**: la rimisurazione col giudice INTERNO è già stata fatta (v9.41 §3, gate §7-quinvicies,
48 casi: la forma dell'allenatore non batte mai l'abitudine del club — 17% contro 50% sotto i 20
undici; direzione indicata: ALZARE, non abbassare; fasce con 6-17 casi, troppo poco per muovere).
Le soglie restano 20/60 con la misura accanto. Quello che il giudice interno non può dire è come
le soglie rendono contro una PREVISIONE sulla stagione che si asta — la referenza stampa (voce 0)
è quel giudice, ed è quella che v9.38 aspettava.
**Cosa fare**: stessa griglia, giudicata sui 20 moduli stampa + pazzidifanta 03/08 (già usata per
adottare `coach_shapes`, 8/17 → 9/17). Punteggio: moduli-uguali-o-alternativa. Se conferma il
giudice interno (tenere o alzare), la questione si chiude con due misure concordi.
**Giudice**: le due referenze 26/27, riportate separate; mai adottare sul bordo della griglia.
**Resa attesa**: piccola; il valore è chiudere la domanda con due giudici indipendenti.

## 5. Il modulo del RITIRO dentro `shape_odds` (i casi Napoli e Juventus)
**Perché, misurato**: le due divergenze «vere» di modulo sono repertorio-contro-annuncio:
Allegri ha 3-5-2 in 94/152 undici di carriera e la stampa dà unanime il 4-3-3 provato in ritiro;
Spalletti ha il 3-4-3 misurato alla Juve (29/46) e la stampa dà 4-2-3-1. Il repertorio risponde
«cosa fa l'uomo», non «cosa ha annunciato per QUESTA squadra». Le amichevoli sono già in
`club_match_lineups` dove catturate, e per il CLAIM sono state misurate e rifiutate con cinque
ragioni (v9.17 §6) — ma il MODULO di un'amichevole è un segnale diverso e più povero di rumore
per-giocatore: la forma schierata è una dichiarazione dell'allenatore.
**Cosa fare**: quinta fonte di `shape_odds`, pre-registrata: le forme schierate nelle amichevoli
della stagione-bersaglio sotto l'allenatore attuale, pesate dal loro (piccolo) campione. Prima di
scrivere codice: misurare QUANTE amichevoli 26/27 abbiamo per club (nel 25/26 erano 1-3, e Milan
e Napoli zero — se la copertura è ancora quella, la voce si ferma lì e lo si scrive).
**Giudice**: il confronto (voce 0); l'anno prossimo, la pre-registrazione di giugno 2027 già
aperta per la parte claim.
**Resa attesa**: Napoli, Juventus, forse Udinese (il cambio intra-allenatore è la stessa specie).
**Caso di studio misurato (08/08/2026, «Giovane sarà quasi certamente una riserva, Alisson e Neres
dovrebbero essere i titolari»)**: nel 4-3-3 della stampa i NOSTRI claim disegnano già
Politano (0.65)–Hojlund (0.76)–Neres (0.50) e Giovane (0.435) resta fuori da solo — Giovane entra
solo nel 3-5-2, dove le ali non hanno posto. L'intero caso è il MODULO, non un parametro sul
giocatore. Santos A. resta a 0.264 con 836 minuti misurati: la stampa si fida del ritiro, il dato
non ancora — se sarà titolare lo diranno le prime giornate, e nel frattempo la scelta modulo per
club (`_shape_choice`) e l'esclusione manuale (`_excluded`) sono le leve del pannello per il giorno
d'asta.

## 6. Letture, non regole (a costo quasi zero)
- **Ballottaggi quasi-pari**: Gila/Tomori, Thuram K./McKennie, Isaksen/Cancellieri sono duelli
  sotto 0.1 di claim dove la stampa sceglie l'altro lato — il pannello già disegna i rivali;
  verificare che la targhetta dica il MARGINE (un undici che mostra 0.72 vs 0.67 è
  un'informazione, uno che mostra solo il vincitore è un'affermazione).
- **Vocabolario in uscita**: Milan 3-4-3 nostro vs 3-4-2-1 stampa e Lecce 4-5-1 vs 4-2-3-1 sono
  in parte notazione (il provider conta ali e trequartisti nel centrocampo). Quando la voce 0
  esiste, il confronto può dichiarare le classi di equivalenza invece di contarle divergenze.
- **`evidence_age` davanti**: Lazio e Fiorentina divergono anche perché il foglio dice onestamente
  che le rose hanno 4-10 giorni e i transfers un mese — la data dell'evidenza è già sul foglio,
  tenerla vicina alla board quando si giudica un undici «sbagliato».

## Fatto in questa sessione (per riferimento)
- **Perimetro = listone bersaglio** (`perimeter_clubs`, SHEET_REVISION 10): le promosse erano
  ASSENTI dal foglio (74 quotati) e le retrocesse presenti (94 righe). Corretto, testato, fogli
  ricostruiti (default + euro), `backtest --verify` 22/22.
- **La fascia posseduta intera è un mestiere D/M** (`_wing_back_trade` in `_flanked`): «Malen
  dovrebbe giocare come Pc e non come centrocampista esterno» — in un modulo a difesa a tre la
  fascia del centrocampo non si contende con soli codici d'attacco. Effetto misurato: 3 board su
  20 si muovono, tutte verso la stampa sui nomi (Roma: Rensch dentro, Malen rivale del Pc;
  **Juventus 11/11** con Thuram K.; Monza recupera Pessina, il picture scivola al gemello
  3-4-1-2). Il caso Bologna/Orsolini (difesa a 4) è nel test e non si muove. 332 test verdi.
- Refresh `transfers` eseguito (nessuna riga post-01/07: v. voce 2).
- Il meccanismo consolidato in [formazioni-tipo-v1.md](formazioni-tipo-v1.md); referenza stampa
  e confronto salvati in `data/reports/press-formations-2026-08-08/`.
