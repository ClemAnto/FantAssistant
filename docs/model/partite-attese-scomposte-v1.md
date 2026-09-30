# Partite attese ricostruite dai loro motivi — v1 (30/09/2026)

**Nata dalla richiesta dell'operatore** («facciamo un nuovo ragionamento partendo da zero e poi alla fine lo
confrontiamo con il vecchio»): la stagione di ogni calciatore scomposta nei motivi per cui ha preso il voto o no, e
le partite attese (Pa) ricostruite come prodotto di quei motivi, così ognuno si ritara per conto suo. È un **banco di
prova e non una regola del motore**: `engine_*` non si muove, e niente di questo entra nel gate finché non lo batte.

## 1. La scomposizione

Per ogni partita di campionato del club mentre lui c'era, uno stato solo: **infortunato · squalificato · assente per
altro · non convocato · in panchina senza entrare · subentrato · titolare**. La fonte è il payload per partita di
Transfermarkt, già in cache (`data/cache/transfermarkt_perf_<id>.json`): porta `participationState`, `isStarting`,
`playedMinutes`, l'allenatore, e **`absenceId`, il motivo dell'assenza**. Il nostro parser (`modules/performance.py`)
salva lo stato e i minuti e butta via il motivo e il titolare: la scomposizione li rilegge dalla cache.

**La squalifica ha una fonte vera**, misurata sui cartellini della partita prima su tutta la cache:

| `absenceId` | Partita prima | Significato |
|---|---|---|
| 1 | giallo nel 93% | squalifica per somma di ammonizioni |
| 2 | doppio giallo nel 94% | squalifica per doppia ammonizione |
| 3 | rosso, o già assente (più giornate) | squalifica per rosso diretto |
| 4-13 | niente cartellini | altre assenze, non disciplinari |

Dybala 2025-26, controllato a mano partita per partita: 38 della Roma = 15 da titolare + 7 subentrato + 2 panchine +
14 infortunato. Un campione di dieci profili (Svilar, Perin, Dimarco, Romagnoli, Dybala, Pulisic, Lautaro, Malen,
Bernasconi, Palestra) su due stagioni è in chat del 30/09; Romagnoli è il più squalificato della Serie A nelle due
stagioni (5 partite).

## 2. La formula (v1)

**Pa = N × D × S × europa × c**, dalla stagione prima (e da quella prima ancora per D):
- **D, disponibilità**: 1 − (infortuni + squalifiche + altre assenze) / partite, su due stagioni (la più vecchia
  pesata `w2`), tirata verso la media della popolazione con peso `kD`;
- **S, scelto se disponibile**: miscela di quota partite, quota minuti (`alpha`) e quota da titolare (`gamma`),
  tirata verso una media del CONTESTO (Serie A stesso club, Serie A cambio club, estero top 5, altro campionato,
  portiere) con peso `kS`, per la qualità `1 + q (MV − 6)`;
- **europa**: `(1 − b E_out) / (1 − b E_in)`, E = il club gioca una coppa europea (fase principale di Champions,
  Europa League o Conference: ad agosto è nota) l'anno previsto / l'anno misurato. **Canale nuovo**: in
  `copertura-eventi-motore-v1.md` era «ASSENTE, mai misurato»;
- chi non ha nessuna stagione su file prende una costante.

Taratura per coordinate su **T1 (2023-24 → 2024-25)**, giudizio su **T2 (2024-25 → 2025-26)**, contro la previsione
pre-stagione del motore costruita come il gate la costruisce (tutte le finestre stimate, quella giudicata coi
parametri della vicina), sugli stessi uomini.

## 3. Il risultato

| | Formula | Motore |
|---|---|---|
| T1 2024-25 (taratura), 389 uomini | 8,64 | 8,24 |
| **T2 2025-26 (fuori campione), 403 uomini** | **8,18** | **8,02** |

Errore medio in partite. **La formula perde del 2,1% fuori campione.** Tre cose, in ordine di peso:
- **chi è rimasto tutta la stagione** (339 su 403): formula 7,59, motore 7,19 (−5,5%). Il motore è migliore dove la
  stagione è stabile: la sua regressione è stimata direttamente sull'esito;
- **chi è partito o arrivato a stagione in corso** (64): formula **11,33**, motore 12,38 (**+8,5%**), e chi non ha
  nessuna stagione su file (18): 9,26 contro 11,60. La scomposizione regge meglio dove il motore non ha storia;
- **l'Europa vale poco**: 8,23 → 8,18 (+0,6%), `b` = 0,05, cioè −5% di S per chi gioca le coppe;
- **i portieri** perdono (8,72 contro 7,81): il motore ha una retta loro (R7), la formula no.

Due parametri stanno sul bordo della griglia (`kD` 160, `w2` 2): la disponibilità di una stagione dice poco, e la
regola di casa vieta di adottare un bordo. Non sono stati adottati: è la taratura di un banco.

## 4. Dove si vede

`toolkit/scripts/presence_test/build.py` (sola lettura su DB e cache) scrive `presence_test.json` nella cartella di
export più recente; `app/scripts/pull-bundle.mjs` lo copia; la pagina **/why → «Partite attese»** lo mostra (una riga per
uomo e finestra: la stagione prima nelle sette voci, D, S, Europa, MV, Pa formula, Pa motore, Pa vere, i due errori e
il guadagno). L'app non ricalcola niente: sottrae due numeri del file. Banco: `app/scripts/e2e-why-presence.mjs`.

## 5. Aperti

1. Il parser salvi `absenceId`, `isStarting` e l'allenatore (rilettura offline della cache, nessuna richiesta).
2. Una retta per i portieri; la quota di chi a gennaio cambia campionato; la qualità misurata meglio di MV.
3. Più finestre (2022-23 → 2023-24 per tarare, poi due giudici) prima di qualunque verdetto.
4. La miscela con le giornate già giocate della stagione in corso (il ruolo di R20 nel motore), per l'asta di oggi.
