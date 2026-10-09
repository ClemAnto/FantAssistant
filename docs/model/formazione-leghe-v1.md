# La pagina FORMAZIONE e il collegamento a Leghe — v1

**Aperto: 8 ottobre 2026.** Richiesta dell'operatore: «una nuova pagina che ti aiuti ad inserire la
formazione per la prossima giornata ... troviamo il modo migliore per caricare la tua rosa e magari le
regole per inserire formazione/panchina e competizione». Pagina `/lineup` dell'app, codice in
`app/src/app/core/leghe-*.ts`, `ui/leghe-connect/`, `views/lineup/`.

**Decisioni dell'operatore (08/10/2026):**
1. login col **login embed** di Leghe; dove non c'è (EuroLeghe) **login diretto in ogni caso**;
2. le leghe sono **EuroLeghe Mantra e Leghe Classic**;
3. **per il momento basta il consiglio**: niente scrittura della formazione su Leghe.

Stato (chiusura del 09/10/2026): **fase 1 fatta** (collegamento, lettura di rosa, regole, competizioni,
avversario e formazione inviata, `0a88a1a`); **la pagina si chiama LINEUP** e ha tabella della rosa, campo,
panchina e un PRIMO TAGLIO del consiglio (§4-bis, `bde447f`); **le quote dei bookmaker** sono catturate dal
foglio probabili e mostrate a fianco di ogni uomo (§4-ter, `bde447f` + `b8ec932`, foglio ridistribuito
dall'operatore e verificato). Commit su `master`, NON ancora pushati. Il motore vero del consiglio resta la
fase 2. **Il sito pubblicato NON ha ancora la pagina funzionante**: manca l'intermediario (§2) e la pagina
non è stata ripubblicata - la si usa sotto `ng serve`.

Questa pagina realizza la «fase settimanale» che `formazione-settimanale-v1.md` (07/08/2026) aveva solo
progettato: i vincoli scritti là — datare con l'ORA, una fonte per affermazione, `vuoto = ignoto`, niente di
questo diventa una regola del motore — valgono qui e la fase 2 li deve rispettare.


## §1. Il dato non serve dedurlo: Leghe lo serve

✅ Verificato dal vivo l'08/10/2026 sull'account dell'operatore (due leghe classic, una Mantra), leggendo
da Node con il token di lega.

| Cosa | Endpoint | Note |
|---|---|---|
| Rosa + prossima partita di ognuno | `GET /gaming/v1/teamLineup/visualizza/{divisione}/{idComp}` | `lineUpInfo[]`: `pid`, ruoli, club, `teamH-teamA`, `hoaw`, **`percent`** (probabili di fantacalcio.it, per TUTTI i campionati), `status` (2 indisponibile, 3 squalificato, 4 non convocato), `comment` (la nota sull'infortunio). Più `teamLineupDto`: la formazione già inviata. `CE26` = nessuna giornata in corso per quella competizione. |
| Regole della formazione | `GET /onboarding/v1/league/settings/lineup` | moduli (`mods`), panchina (`fbench`, `tbench`, `brdrs`, `bseq`), capitano (`lcap`), switch (`lswi`), chiusura (`elnp` minuti), ripescaggio (`rlnp`) |
| Regole di calcolo | `GET /onboarding/v1/league/settings/calculate` | sostituzioni (`subst.sstype` 1-6, `ssnum` con 11 = illimitate), riserva d'ufficio, mod. difesa (`smodd`), fattore rendimento (`smodp`, indicizzato su quanti sufficienti), soglie gol (`step`), scala bonus (`bnMls`) |
| Gioco della lega | `GET /onboarding/v1/league/settings/rosters` | `sroles` 2 = Mantra |
| Competizioni, calendario, avversario | `/onboarding/v1/league/competitions`, `/competition/calendar/{id}` | tipo 1 campionato, 2 a punti, 3 F1, 10 Battle Royale, 11 Highlander… |
| Squadre della lega | `/onboarding/v1/league/teams?division=…` | nome, allenatore, rosa (`cal`) di tutti |
| Chiusura | `POST /gaming/v1/league/timing` (body `{}`) | millisecondi alla prima partita; meno `elnp` |

**Il `pid` di Leghe È il nostro `fc_id`** (verificato su sei nomi): la rosa si unisce al pacchetto per
identità, mai per nome.

Le tre leghe lette: Dynamic con 5 cambi e mod. difesa fino a +3 (classic); Master con cambi illimitati e
fattore rendimento fino a +3 (Mantra); switch Plus e niente capitano in tutte e tre.


## §2. Il blocco del browser, misurato e non supposto

- Le API di Leghe rispondono CORS **solo a `https://*.fantacalcio.it`**: preflight da
  `clemanto.github.io` = 204 senza `Access-Control-Allow-Origin`, su `apileague` e `apieuroleague`.
- Nel backend la lista è **scritta nel codice** (una politica condivisa da cinque servizi): ammettere il
  nostro sito sarebbe una modifica al codice, non una configurazione.
- Il server **non controlla l'origine**: solo `app_key` + Bearer. Da Node le stesse chiamate rispondono
  200. Quindi serve un **intermediario** che inoltri: `app/proxy.conf.mjs` sotto `ng serve` (attivo),
  `app/proxy/leghe-worker.mjs` per il sito pubblicato (Cloudflare Worker, **non ancora pubblicato**:
  serve l'account dell'operatore). Il Worker è provato a livello di codice in Node (rifiuta origini
  estranee e percorsi fuori lista, inoltra login e letture): il runtime di Cloudflare no.
- `app_key` **non è un segreto**: sta nel bundle pubblico di Leghe e la loro documentazione lo chiama
  «noise filter, non una protezione di sicurezza». I segreti sono i token di lega: solo in
  `sessionStorage`, perché `clemanto.github.io` è UNA origine per tutti i siti Pages dell'account.


## §3. Il login embed: cosa fa e dove non c'è

- ✅ Si incornicia da qualunque sito e consegna con `postMessage('fc-login-success')`
  `{id, jwt, leagues[{id, name, alias, jwt}]}`: i token di lega ci sono. La password resta sulla pagina
  di fantacalcio.it.
- Restituisce **solo le leghe con almeno una competizione visibile ai partner**: sull'account due classic
  su sei (una delle escluse controllata: nessuna competizione quest'anno).
- **Su EuroLeghe non esiste**: il servizio partner non è mai stato rilasciato in produzione (risponde 503,
  zero tag di rilascio euro), e la pagina embed in errore lancia un `DataCloneError` invece di avvisare.
  Da qui il login diretto, per decisione dell'operatore: utente e password passano dall'intermediario in
  una richiesta e non vengono salvati.
- Da segnalare al team Leghe: invio con destinatario `'*'` da una pagina incorniciabile ovunque (chiunque
  ospiti il vero login riceve i token), scadenza del token di lega non controllata dal servizio partner,
  il 503 e il `DataCloneError` su EuroLeghe.


## §4. Fase 2 — il consiglio (da fare)

**Una tensione da sciogliere con l'operatore PRIMA di scrivere il motore.** Il 07/08/2026 aveva giudicato la
pagina delle probabili inaffidabile e indicato la ricerca giocatore per giocatore sui quotidiani
(`formazione-settimanale-v1.md`); dal 21/09 il foglio delle probabili misura le fonti e fantacalcio.it,
sosfanta e Sky stanno insieme, una decina di punti sopra il null (`attendibilita-probabili-v1.md` §5). La
`percent` che Leghe serve è quella di fantacalcio.it. Quindi: la base è la `percent` (fresca, su tutti e
cinque i campionati), il consenso delle quattro fonti la affianca dove c'è (solo Serie A, solo all'apertura
del turno), e la ricerca per giocatore — gli agenti di `toolkit/scripts/press_survey/` esistono già per la
titolarità — è il terzo strato da decidere, perché costa per uomo e per giornata.

Per ogni uomo: probabilità di prendere il voto (dalla `percent` della piattaforma e dalle quattro fonti del
foglio probabili, con la curva di `rosa-3-giornate-v1.md` §2 **da rimisurare** sulle giornate giocate) e
fantavoto atteso in quella partita (motore + calendario; per i portieri la porta inviolata). Poi modulo,
undici, ordine della panchina e switch che rendono di più **con le sostituzioni automatiche del regolamento
letto** (Dynamic/Hybrid/Traditional; Basic/Easy/Master con la matrice di `mantra_modules.json`), mod.
difesa e fattore rendimento compresi. Obiettivo v1: punti attesi; scontri diretti contro l'avversario
letto: dopo. Giudice prima di fidarsi: rigiocare le giornate già giocate contro le formazioni che
l'operatore ha davvero schierato (Leghe le serve).


## §4-bis. La pagina LINEUP e il primo taglio del consiglio (08/10/2026, sera)

Richieste dell'operatore, in sequenza: la pagina si chiama **LINEUP**; «una tabella con i calciatori della
tua rosa (simile a quella nella pagina draft) e un campo che mostra i calciatori schierati e sotto una
griglia con quelli in panchina»; «le Regole della lega mettili in un box collassabile». Fatto:

- **Tabella della rosa** come quella del draft (intestazioni che ordinano, stemma, marchi): titolare % di
  Leghe, probabilità del voto, fantamedia prevista (dal foglio; dove il foglio non lo prezza, la media di
  stagione di Leghe in corsivo), **punti attesi**, dove lo mette la formazione consigliata e dove quella
  inviata.
- **Campo + griglia della panchina**, con un interruttore **Consigliata / Inviata**: la stessa rosa, due
  formazioni sullo stesso disegno.
- **Regole della lega** piegate di default.

**Il consiglio è un PRIMO TAGLIO e lo dice a schermo** (`core/lineup-advice.ts`): punti attesi =
P(voto) × fantamedia prevista, con P(voto) letta dalla `percent` di Leghe sulla curva di
`rosa-3-giornate-v1.md` §2 (piatta oltre gli estremi misurati, 0 se Leghe lo segna fuori, 0,063 se la
pagina non lo elenca); undici = il migliore sui moduli che la LEGA ammette, con la legalità del
regolamento (`mantra-legal.bestEleven`, classic o Mantra); panchina = classic per ruolo P/D/C/A e
migliore prima, Mantra una coda unica, coi minimi per ruolo e la taglia letti da Leghe. **Non conta**
sostituzioni automatiche, modificatori, avversario, consenso del foglio probabili né la stampa: è il
pavimento che il banco (§5 punto 3) giudicherà, non il motore del §4.

**Decisione dell'operatore sulla fonte (08/10/2026): percent + foglio probabili + stampa** (il terzo
strato del §4 è scelto). Il primo taglio usa solo la `percent`; gli altri due sono da collegare.

Verificato dal vivo sull'account (`scripts/e2e-lineup-live.mjs`, ora legge campo, panchina e regole
piegate per ogni lega): classic 4-3-3 con 11 posti pieni e 12 in panchina, Mantra 3-4-2-1 con 11 e 12
(almeno un portiere in panchina rispettato); nessuna eccezione in pagina. `ng test` 1427/1427.

## §4-ter. Le quote dei bookmaker (08/10/2026, notte)

Richiesta: «per ogni calciatore di movimento la quota gol (media da più siti di scommesse); per i portieri
la quota porta inviolata», poi «se troviamo api gratis ok, altrimenti i bookmaker italiani: 3 adatti
bastano». **Misurato prima di scrivere** e la risposta è una terza strada:

| Fonte | Esito |
|---|---|
| API gratuite | The Odds API ha `player_goal_scorer_anytime` sui cinque campionati ma solo con bookmaker USA, e niente porta inviolata; le altre sono a pagamento |
| Sisal, Snai, Lottomatica, Goldbet, Eurobet | dietro Akamai/Cloudflare: 403 o connessione chiusa a tutto ciò che non è un browser vero |
| **oddschecker.com/it** | **una pagina per partita, scritta lato server, con i bookmaker ITALIANI che confronta**: 26 elencati, 12-13 per ogni «marcatore in qualsiasi momento», 3-4 per la porta inviolata. Copre i cinque campionati (la Liga sta su `spagna/liga`) |

**La porta inviolata** non ha le quote nella pagina sotto il suo nome, ma lo stesso evento è prezzato
sotto altri tre: «Total Away Goals» Under 0,5 e «Total Away Goals Exact» 0 (= la squadra di CASA non
subisce), e i due specchi. Si sommano i bookmaker di tutti e tre.

**Dove gira: nel foglio delle probabili**, come secondo file dello stesso progetto Apps Script
(`scripts/gas/odds.gs`): due catture al giorno (8 e 19), la riga di ogni cattura in un tab `Quote`
(**si accumula**: è la serie che un giorno permetterà di giudicare le quote), e `doGet?what=odds` serve
l'ultima cattura delle partite non ancora iniziate. La stessa distribuzione del foglio, quindi l'app non
ha un indirizzo nuovo da conoscere. Una passata da ~50 pagine non sta nei sei minuti di Apps Script: si
ferma a 4,5 minuti e riparte da sola un minuto dopo sulle leghe rimaste, sotto lo stesso `taken_utc`.

**Nell'app** (`core/bookmaker-odds.ts`, `core/bookmaker-odds-store.ts`): colonna **Quota** nella tabella
di LINEUP (gol per i movimento, porta inviolata in verde per i portieri; il tooltip dice su quanti
bookmaker e la forbice). È un PREZZO e qui è reporting: il consiglio non lo legge.

**L'unione per nome è la parte delicata, e si decide a VOTI.** Non c'è un id comune: oddschecker scrive
«Mateo Pellegrino», Leghe «Pellegrino M.». Misurato sulle rose vere: i codici a tre lettere coincidono
in Serie A e non all'estero (Leghe `LIV-MCI`, oddschecker `LFC`/`MCI`; `FCB` contro `BAR`), e Leghe
scrive i club stranieri in italiano («Barcellona», «Stoccarda»). Quindi la partita di un gruppo di
uomini la decidono tre indizi sommati - codici (3), nome del club (2), ogni suo uomo che compare fra i
marcatori (1) - e il nome si accetta solo se il candidato è UNO. Risultato sulle rose dell'operatore con
un pacchetto costruito in locale dagli stessi parser: **Serie A 27 di 28** (manca Yildiz, che i
bookmaker non quotano), **EuroLeghe 29 di 36**, e i 7 mancanti sono tutti di Ligue 1, dove la passata
locale era stata rallentata dal sito (2 partite su 10).

**Verificato in un browser vero contro l'indirizzo del foglio (08/10/2026, `scripts/e2e-lineup-live.mjs`, che ora
lo controlla ogni volta).** Tre domande, ognuna contro qualcosa che la pagina non calcola da sé: (1) tutte le
quote a schermo cadono in UNA giornata - EuroLeghe dal 9/10 18:30 al 12/10 19:00 UTC, 3,0 giorni, Serie A
2,2; (2) tutti gli uomini di una stessa partita Leghe leggono la STESSA partita dei bookmaker, e le 18 + 9
corrispondenze stampate tornano tutte (`SCP-STU` → Paderborn v Stuttgart, `ALV-ATM` → Alaves v Atletico);
(3) il prezzo a schermo è quello che oddschecker mostra ADESSO, riletto dai parser di `odds.gs`: 20
selezioni, **0 fuori del 15%**, quasi tutte identiche al centesimo. Un prezzo che sembra strano va
guardato prima di chiamarlo un difetto: Bensebaini a 3,98 è davvero il prezzo dei bookmaker.

**E il difetto che il controllo (1) ha trovato, e le due regole dell'operatore che lo curano.** La
finestra di otto giorni prende anche l'apertura del turno SUCCESSIVO in quattro leghe (Frankfurt, Toulouse,
Frosinone, Le Mans... due volte). La prima cura - «solo la prossima partita di ogni club» - è stata
ritirata la sera stessa: «per euroleghe non è sempre semplice capire quale giornata dei singoli campionati
bisogna prendere in considerazione: devi prendere dal sito euroleghe per ogni calciatore quale è la sua
"prossima partita" e da lì confrontare le partite corrette». E la seconda forma, che riconosceva la
partita dai codici a tre lettere, è stata ritirata subito dopo: «tre lettere sono poche visto l'enorme
numero di squadre, cerchiamo di rendere il controllo solido».

**Ora la partita la nomina Leghe e la si riconosce dagli UOMINI.** Per ogni giocatore Leghe dà il suo club
(`tid`), l'avversario (`tidOp`), le sigle e il lato (`hoaw`). Una partita dei bookmaker è quella di un
club solo se fra i suoi marcatori quotati ci sono almeno **5** uomini della rosa di quel club nel listone
(`SQUAD_EVIDENCE`). Misurato sul pacchetto dell'08/10 (52 partite, due turni in quattro leghe, ogni club
dei due listoni contro ogni partita): la partita vera di un club ne quota **da 16 a 23**, un club che non
c'entra **mai più di 2** (un omonimo). L'avversario si conferma allo stesso modo con la SUA rosa, quando
il pacchetto conosce il club (trovato per identità: un uomo della rosa Leghe con quel `tid`; o dal nome
che `championship/teams` di Leghe gli dà, rifiutato se due club combaciano). Solo dove l'avversario è
fuori dal perimetro EuroLeghe e il pacchetto non ha la sua rosa (Toulouse, Paderborn) si accetta il suo
nome o la sua sigla - e se nemmeno quelli tornano, servono tre fatti insieme: la rosa del suo club nella
partita, il suo club dal lato che dice Leghe, e nessun'altra partita del suo club nella finestra. Due
candidati, o nessuno: niente quota. Il foglio serve TUTTE le partite in arrivo e la scelta è dell'app.

Provato con un pacchetto che contiene due turni: **36 su 36** su EuroLeghe e **27 su 28** sulla Serie A,
tutte le 27 partite Leghe sulla partita giusta e tutte le quote dentro tre giorni.

**Due fatti da sapere, pagati.** Cloudflare di oddschecker riconosce il client dalla sua impronta TLS:
`curl` di Git (OpenSSL) passa, `curl` di Windows e `fetch` di Node ricevono 403 con gli stessi header.
Quindi **se il server di Google passa non si sa finché non si prova**: `oddsProbe()` è la prima cosa da
lanciare. E a 1,5 secondi fra le pagine l'ultima lega di una passata viene rifiutata: la pausa è 3 s.

## §4-quater. La tabella e il campo, ritoccati, e la formula dell'FVA (09/10/2026)

Sette richieste dell'operatore sulla pagina, tutte di app e nessuna di motore (`engine_*` fermo,
nessun `SHEET_REVISION`).

- **Il riquadro della giornata si piega** come quello delle regole: parte aperto, e da chiuso tiene a
  schermo la giornata e la chiusura, l'unica cosa che non deve sparire.
- **Colonna Partita**: niente più «casa»/«fuori», la squadra del calciatore è in GRASSETTO - la partita
  è scritta con la squadra di casa per prima, quindi il grassetto dice anche il campo. Se Leghe non dice
  il campo, nessuna delle due è in grassetto.
- **Colonna Tit tolta** (con il suo ordinamento): la `percent` resta l'ingresso di «Voto».
- **Due colonne nuove, ordinabili**: **Trend** (le ultime 5 del suo club, `ui-vote-trend`, lo stesso
  disegno della Strategia, da `recentVotes` del foglio) e **G:A** (gol e assist di campionato della
  stagione in corso, contati da `seasonTotals` come la card).
- **Qualsiasi modulo** del regolamento è selezionabile per la consigliata (anche quelli che la lega non
  ammette, marcati «non ammesso»), più «automatico». Ogni voce porta la **FMA totale** dei titolari che
  schiererebbe (gli indisponibili esclusi), le voci sono ordinate per quella, e il **migliore** (più posti
  coperti, poi FMA totale più alta) è evidenziato nell'elenco e accanto al selettore.
  **Tensione detta**: l'automatico sceglie ancora sui PUNTI (P(voto) × FM) fra i soli ammessi, quindi può
  non coincidere col «migliore» per FMA.
- **I posti larghi stanno sulle fasce** (`toTheFlanks`, «E/W e W devono essere ai lati»): il regolamento
  scrive alcune righe senza ordine di lato (`4-1-4-1` porta `C/T, T, E/W, W`), quindi il DISEGNO manda gli
  slot fatti solo di `E`/`W` agli estremi, alternati, e tiene i centrali nell'ordine del regolamento. Le
  righe col lato nel nome (`DD … DS`) non si toccano. Il limite: `E`/`W` non dicono quale lato, quindi il
  primo va a sinistra dello schermo.

**L'FVA (Fanta Voto Atteso)** — *proposto il 09/10 e IMPLEMENTATO la notte stessa in `core/fva.ts`, al posto di PT; `a` e `b` misurati il 10/10, §4-quinquies* — a sostituire PT. La forma concordata per i
giocatori di movimento, con le sue tre decisioni («la probabilità di prendere voto ci interessa poco»,
«il minutaggio un contributo minimo, decisivo solo fra due situazioni simili», «le quote fotografano meglio
la capacità di segnare in quella partita che non la fantamedia»):

- **FVA = MV\* + G\* + A\***, cioè il fantavoto atteso SE GIOCA (niente P(voto) dentro);
- `MV* = 6 + (MV − 6) × k + a × Δ`, con Δ lo scostamento della partita dalla media (la probabilità di porta
  inviolata del calendario, che contiene Elo, forma su 10 partite e campo);
- `G* = bonus gol × λ × k`, `λ = −ln(1 − p)` con `p` dalla quota marcatore senza margine; senza quota, i
  suoi gol per presenza. La quota SOSTITUISCE la parte gol della fantamedia;
- `A* = [(FM − MV) − parte gol storica] × (1 + b × Δ) × k` (assist, cartellini, il resto);
- `k = 1 − 0,15 × (1 − minuti previsti / 90)`: al massimo −7% a 45', una SCELTA e non una misura;
- `a`, `b` da MISURARE sui voti veri, a zero finché non lo sono; il TREND fuori dalla formula (la mano calda
  misurata vale zero, e la stagione in corso è già nella fantamedia: R25/R28);
- la quota marcatore si annulla se non gioca, quindi è già «se gioca» come l'FVA.

**Portieri** (la sua domanda «il FVA per i portieri è giusto?», ed è stato detto che sul campo c'era ancora
PT): `FVA = MV − λ` con `λ = −ln(p)` dalla quota porta inviolata, più `p × bonus` se la lega lo dà; senza
quota, la fantamedia del foglio. Proposta, non decisa.

## §4-quinquies. L'FVA legge la partita, e il trend resta fuori per misura (10/10/2026)

Domanda dell'operatore: «verifica se trend e avversario hanno il giusto peso nella formula per FMA», poi
«applica tutti e 4 e verifica sulle stagioni scorse». Il trend era fuori, l'avversario entrava solo dalle quote.

**Trend: zero, misurato.** Fuori campione (leave-one-season-out, Serie A dal 2015-16 ed EuroLeghe), con la
fantamedia della stagione in corso dentro, le ultime 5 pesano **0,03** (Serie A) e **0,07** (EuroLeghe); la
mano calda contro il null rimescolato vale +0,014 (dentro il rumore) e +0,06. La forma informa sul LIVELLO
di quest'anno, che la fantamedia del foglio legge già (R25/R28).

**Avversario: quattro termini** (`core/fva.ts`), tutti su `delta` = edge della partita (Elo + campo −
avversario, dal `calendar.json`) MENO l'edge ordinario del suo club (il suo Elo contro la media degli altri
club del campionato, `LeagueCalendar.ordinaryEdge`): la fantamedia contiene già la forza del club, quindi
conta solo lo scostamento di QUESTA partita.
- voto base `a` = **+0,059** ogni 100 di delta; altri bonus `b` = **+0,018**; gol `×(1 + 0,127 × delta/100)`
  **solo senza quota** (la quota conosce già avversario e campo); fittati su 63.222 voti di movimento, uguali
  per ruolo (a 0,054-0,063) e quindi un valore solo;
- portiere senza quota: la probabilità di porta inviolata del calendario prende il posto della quota,
  `FVA = MV + ln(p)` (solo Serie A, dove è fittata), invece della FM piatta.
- la partita del calendario vale solo se È quella di Leghe (stesso campo, stesso avversario dove Leghe lo
  nomina); altrimenti nessun termine.

**Verifica sulle stagioni passate** (senza quote storiche, quindi sul ramo «storico»; base = stagione
precedente con ≥15 voti, leave-one-season-out, Elo del 15 agosto):

| | MAE prima → dopo | stagioni migliori | ordine giusto nelle coppie stesso ruolo e giornata |
|---|---|---|---|
| movimento Serie A (35.635) | 1,0420 → 1,0370 (+0,48%) | 6/6 | 55,5% → 56,5% |
| movimento EuroLeghe (27.587) | 1,2364 → 1,2285 (+0,64%) | 5/5 | 54,5% → 55,7% |
| portieri Serie A, calendario (2.906) | 1,1896 → 1,1737 (+1,34%) | 5/6 | 54,0% → 58,3% |
| portieri Serie A su EuroLeghe (708) | 1,1284 → 1,0857 (+3,78%) | 5/5 | 46,5% → 54,2% |

Ognuno dei tre termini di movimento migliora anche da solo (voto base +0,31/+0,34%, gol +0,35/+0,40%, altri
+0,14/+0,13%). Limiti: la probabilità di porta inviolata del banco è il modello con il solo Elo e i suoi
coefficienti sono fittati sulle stesse stagioni (contaminazione dichiarata, a favore); il ramo con le quote
non è verificabile all'indietro; l'appaiamento del nome dell'avversario fra Leghe e calendario non è stato
visto dal vivo. Nessun gate: è una lettura dell'app.

## §5. Aperti, in ordine

0. **Quote (§4-ter): FATTO lato operatore** il 08-09/10/2026 - `odds.gs` incollato, `oddsProbe()` passa
   da Google (20 partite, 48 righe su Genoa-Fiorentina), `oddsInstall()` arma 8:00 e 19:00, prima cattura
   52 partite, distribuzione aggiornata due volte (l'ultima serve TUTTE le partite in arrivo). Restano:
   (a) **guardare nel `Log` del foglio che le catture automatiche girino** (alle 8 e alle 19 righe
   `odds | <lega> | N matches read of M`); (b) se un giorno oddschecker rifiuta Google (filtra per impronta
   TLS, vedi sotto), la cattura va spostata sul portatile col `curl` di Git; (c) non è ancora contato
   quanti uomini passano dalla via debole di `matchFor` (rosa + lato + partita unica) invece che dalla
   conferma dell'avversario - aggiungerlo all'e2e se serve. Verifica offline dei parser:
   `node scripts/gas/verify-odds.mjs <cartella con league.html e match*.html>`; verifica dal vivo:
   `node app/scripts/e2e-lineup-live.mjs <porta> [pacchetto-quote.json]` sotto `ng serve`.
0-bis. **Push** dei commit `bde447f` e `b8ec932` (fatto solo il commit, su richiesta).
0-ter. **FVA: FATTO** (`core/fva.ts`, colonna al posto di PT, la consigliata sceglie su P(voto) × FVA) e con
   la partita dentro (§4-quinquies, 10/10). Restano: (a) **guardarla in un browser collegato a Leghe**, e
   in particolare CONTARE quanti uomini ricevono il termine partita - l'appaiamento del nome dell'avversario
   fra Leghe e calendario (`sameClub`) non è mai stato visto dal vivo, e se fallisce la correzione tace in
   silenzio; (b) confrontare l'FVA con PT sulle giornate già giocate; (c) decidere se l'automatico sceglie il
   modulo per FMA totale. Nel tooltip della partita c'è anche la POSIZIONE IN CLASSIFICA dei due club
   (`core/standings.ts`, tabella ESPN `league_standings` scritta da `fixtures` dentro `calendar.json`),
   mai vista dal vivo nemmeno lei.
1. **Pubblicare l'intermediario**: account Cloudflare dell'operatore (gratuito; che non chieda la carta lo
   dicono fonti non ufficiali), `npx wrangler deploy` da `app/proxy/` (comando nel file), poi incollare
   l'indirizzo nella pagina («Account»). Poi ripubblicare il sito (`npm run deploy:pages`) e verificarlo
   col browser.
2. **Fase 2, il motore del consiglio** (§4), Leghe Classic per prima. La tensione del §4 è DECISA
   (08/10/2026): **percent + foglio probabili + stampa**. Il primo taglio (§4-bis) usa solo la `percent`;
   da collegare il consenso del foglio (Serie A) e la ricerca giocatore per giocatore. Le quote (§4-ter)
   sono reporting: entrarci nel consiglio è una decisione da misurare, non da dare per scontata.
3. **Il banco**: rigiocare le giornate già giocate contro le formazioni vere dell'operatore. Era la
   priorità scelta l'08/10 ed è stata scavalcata dalle richieste sulla pagina: è il prossimo passo. Il dato
   c'è: `GET /gaming/v1/teamLineup/{comp}/{giornata}/{giornataCampionato}/{casa}/{trasferta}` dà per ogni
   partita giocata la formazione schierata, voti, fantavoti, entrati/usciti e modificatori (mappatura in
   `FCLeaguesFrontend/WEB/src/app/services/lineups.ts`, `toLineupInfoModel`). Il limite da dire subito: la
   `percent` di Leghe è una fotografia di «adesso», quindi per le giornate passate non c'è - il banco può
   giudicare l'undici e la panchina su probabilità ricostruite, oppure aspettare le giornate che verranno
   salvando la `percent` a ogni lettura.
4. **Segnalazioni al team Leghe** (§3, ultimo punto): sono quattro.
5. **L'operatore deve cambiare la password di fantacalcio.it**: è passata dalla chat l'08/10/2026.
6. Da verificare sul campo: `hoaw` è letto come 0 = casa (torna sui casi guardati, non controllato su
   tutti); `index` (la posizione nelle probabili) NON è letto, perché alcuni valori non tornano (0 su un
   titolare al 90%, 11 su un terzo portiere al 5%) e un campo che non si capisce non si usa.


## §6. Lezioni pagate nella sessione

- **Una scelta dell'operatore va misurata prima di costruirla**: il login embed sembrava risolvere tutto,
  e risolve la password e non il CORS. Detto prima di scrivere codice.
- **Una ragione verificata nel codice altrui si riverifica dal vivo**: il backend diceva che i token di
  lega c'erano; è stata la prova con l'account a confermarlo.
- **Le credenziali non passano dalla chat**: la prima prova è stata fatta con quelle scritte in chat ed è
  fallita (ATH018); quelle nel `.env` funzionano. Due tentativi per piattaforma e poi stop, per non
  bloccare l'account. Quelle della chat vanno considerate bruciate.
- **Backslash e heredoc, di nuovo** (§7 delle istruzioni globali): un `str.replace` in Python dentro un
  heredoc ha rotto due regex di uno script; si scrive col file, non con la shell.
