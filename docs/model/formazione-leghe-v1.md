# La pagina FORMAZIONE e il collegamento a Leghe — v1

**Aperto: 8 ottobre 2026.** Richiesta dell'operatore: «una nuova pagina che ti aiuti ad inserire la
formazione per la prossima giornata ... troviamo il modo migliore per caricare la tua rosa e magari le
regole per inserire formazione/panchina e competizione». Pagina `/lineup` dell'app, codice in
`app/src/app/core/leghe-*.ts`, `ui/leghe-connect/`, `views/lineup/`.

**Decisioni dell'operatore (08/10/2026):**
1. login col **login embed** di Leghe; dove non c'è (EuroLeghe) **login diretto in ogni caso**;
2. le leghe sono **EuroLeghe Mantra e Leghe Classic**;
3. ~~**per il momento basta il consiglio**: niente scrittura della formazione su Leghe.~~ **Superata il 09/10/2026
   (sera)** dalla sua richiesta «nella pagina Lineup permettimi di salvare sul leghe la formazione»: §4-decies.

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
migliore prima (**sbagliato per Dynamic e Hybrid, corretto il 09/10: §4-octies**), Mantra una coda unica, coi
minimi per ruolo e la taglia letti da Leghe. **Non conta**
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

**L'FVA (Fanta Voto Atteso)** — *proposto il 09/10 e IMPLEMENTATO la notte stessa in `core/fva.ts`, al posto di PT; `a` e `b` misurati il giorno dopo, §4-quinquies* — a sostituire PT. La forma concordata per i
giocatori di movimento, con le sue tre decisioni («la probabilità di prendere voto ci interessa poco»,
«il minutaggio un contributo minimo, decisivo solo fra due situazioni simili», «le quote fotografano meglio
la capacità di segnare in quella partita che non la fantamedia»):

- **FVA = MV\* + G\* + A\***, cioè il fantavoto atteso SE GIOCA (niente P(voto) dentro);
- `MV* = 6 + (MV − 6) × k + a × Δ`, con Δ lo scostamento della partita dalla media (la probabilità di porta
  inviolata del calendario, che contiene Elo, forma su 10 partite e campo);
- `G* = bonus gol × λ × k`, `λ = −ln(1 − p)` con `p` dalla quota marcatore senza margine; senza quota, i
  suoi gol per presenza. La quota SOSTITUISCE la parte gol della fantamedia;
- `A* = [(FM − MV) − parte gol storica] × (1 + b × Δ) × k` (assist, cartellini, il resto); **corretto il
  09/10/2026 (§4-septies): con la quota, «altri» si MISURA sulle stesse partite dei gol** (fantavoto − voto −
  3 × gol per partita votata) invece di ricavarlo dalla FM del foglio, che è regredita;
- `k = 1 − 0,15 × (1 − minuti previsti / 90)`: al massimo −7% a 45', una SCELTA e non una misura;
- `a`, `b` da MISURARE sui voti veri, a zero finché non lo sono; il TREND fuori dalla formula (la mano calda
  misurata vale zero, e la stagione in corso è già nella fantamedia: R25/R28);
- la quota marcatore si annulla se non gioca, quindi è già «se gioca» come l'FVA.

**Portieri** (la sua domanda «il FVA per i portieri è giusto?», ed è stato detto che sul campo c'era ancora
PT): `FVA = MV − λ` con `λ = −ln(p)` dalla quota porta inviolata, più `p × bonus` se la lega lo dà; senza
quota, la fantamedia del foglio. Proposta, non decisa.

## §4-quinquies. L'FVA legge la partita, e il trend resta fuori per misura (09/10/2026, giorno)

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

## §4-sexies. Poche richieste a Leghe: la cache locale e la coda (09/10/2026)

Regola dell'operatore: «dobbiamo evitare di fare troppe chiamate a euroleghe.fantacalcio.it o
leghe.fantacalcio.it altrimenti la sicurezza ci blocca, limitiamo al minimo le richieste e utilizziamo la
cache locale». Vale per l'app E per chi la verifica (banchi, sonde da Node).

**Prima**: ogni sguardo alla pagina costava ~12 richieste (7 in parallelo, poi squadre reali, squadre della
lega, e per ogni competizione la rosa e il calendario) - e così ogni cambio di lega, ogni «rileggi» e ogni
ricarica di `ng serve` dopo un file salvato, che in una sessione di lavoro sono la maggior parte. Ogni corsa
di `e2e-lineup-live.mjs` partiva da un profilo vuoto: due login e ~36 richieste.

**Ora** (`app/src/app/core/leghe-cache.ts`, letta da `LegheSession.readMatchday`):
- **ogni lettura passa prima dalla cache** (`localStorage`, chiave piattaforma:utente:lega:percorso, MAI il
  token), e Leghe si interroga solo quando la lettura in mano è più vecchia di quanto il suo fatto regga:

  | Classe | Durata | Cosa |
  |---|---|---|
  | `live` | 1 ora | rosa con `percent`, indisponibili e formazione inviata (`visualizza`), `status`, `timing` |
  | `day` | 24 ore | competizioni, la mia squadra, le squadre della lega |
  | `season` | 7 giorni | regole (`settings/lineup`, `calculate`, `rosters`), squadre reali, calendari |

  Durate DICHIARATE, non misurate: nessuno sa ogni quanto la redazione muove una `percent`. Una risposta
  `CE26` (nessuna giornata in corso) è una lettura e si tiene; un errore no.
- **«Rileggi» rilegge solo la parte `live`** (3-5 richieste invece di ~12); **«Svuota»** nella modale
  Account dimentica tutto e rilegge anche le regole. La pagina dice quando ha letto («letta alle 14:32»,
  con il giorno se non è oggi) e «dalla cache» quando lo sguardo non è costato nessuna richiesta
  (`data-leghe-requests` per i banchi). La chiusura si conta dal momento in cui Leghe ha dato i
  millisecondi, che la cache conserva.
- **Una richiesta alla volta, 400 ms fra due** (`leghe-api.ts`, `SPACING_MS`): una passata a freddo non è
  più una raffica di sette richieste insieme. Anche questa è una scelta dichiarata, non una soglia misurata.
- **Il banco dal vivo tiene il profilo** fra una corsa e l'altra (`<temp>/e2e-lineup-live-profile`), quindi
  la seconda corsa legge dalla cache; `--fresh` riparte da vuoto. In fondo riapre la prima lega e pretende
  **zero** richieste. I due login restano a ogni corsa: i token vivono in `sessionStorage`.

✅ Verificato il 09/10/2026 SENZA toccare Leghe: `leghe-session.spec.ts` guida il vero `LegheSession` contro
un Leghe finto che conta cosa gli si chiede - passata a freddo 12 richieste (una per fatto, nessuna
doppia), pagina ricaricata **0**, «rileggi» esattamente le 4 `live`, «svuota» di nuovo 12, nessun token in
`localStorage`; controprova: forzando anche le non `live` cade solo il test di «rileggi». `leghe-api.spec.ts`
prova la coda con orologio finto (mai due richieste aperte, 400 ms fra due partenze; controprova: senza coda
cade). Nel browser vero, sulla build: la riga della cache nella modale, una lettura di 8 giorni scartata
all'apertura, «Svuota» con un puntatore vero, **0 richieste a Leghe**. `ng test` 1471/1471, `ng build` verde.
**Non** verificato dal vivo con l'account (`e2e-lineup-live.mjs` non è stato lanciato apposta: costa due
login e una passata a freddo per lega).

**Lasciati aperti, e sono decisioni dell'operatore:**
- **i login.** A ogni scheda nuova (e a ogni corsa del banco) si rifà il login, e su EuroLeghe è un POST
  con utente e password. Tenere i token in `localStorage` lo eviterebbe, ma è la scelta contraria a quella
  fatta l'08/10 di proposito (`clemanto.github.io` è UNA origine per tutti i siti Pages dell'account).
- **un freno ai login falliti** (dopo due `ATH018` di fila fermare il bottone per qualche minuto), che è la
  regola «due tentativi e poi stop» del §6 scritta nel codice invece che nella disciplina.
- **la cache sta in `localStorage`**, quindi un altro dei suoi siti Pages potrebbe leggerla: sono rose e
  regole già mostrate, non credenziali.


## §4-septies. Il nome dell'avversario, l'ordine delle quote dei portieri, il filtro per ruolo (09/10/2026)

Tre richieste dell'operatore sulla tabella, nessuna di motore (`engine_*` fermo, nessun `SHEET_REVISION`).

- **«PSG-MAN ... MAN che squadra è?»**: Le Mans. Su EuroLeghe `championship/teams` elenca solo i 37 club del
  perimetro, quindi un avversario fuori perimetro arrivava come `tidOp` e tre lettere, e il tooltip stampava
  la sigla. Su suo suggerimento la fonte è la pagina probabili: il toolkit ne legge le intestazioni delle
  partite in `fc_teams` (spec «Novità v9.106») per ID di fantacalcio.it, che è lo stesso spazio di Leghe
  (✅ Atalanta 1 e Chelsea 26 sulla pagina e nella fixture del front-end di Leghe). Il tooltip prende il nome
  da Leghe se lo elenca, da `fc_teams` se no, la sigla solo se nessuno dei due lo sa. **Solo il tooltip**:
  l'aggancio al calendario e alle quote resta sui nomi di Leghe, su cui è stato misurato. **Arriva a schermo
  dopo** una corsa di `fc_site` e un `export` sulla macchina col DB.
- **Quote dei portieri ×(−1) nell'ordinamento** («in modo che gli ordinamenti siano sempre separati, ma non
  visualizzare il −»): `bookmaker-odds.oddsSortValue`. La porta inviolata e il gol sono due grandezze, quindi
  i portieri fanno un blocco a sé in tutt'e due i versi; la cella stampa la quota senza segno. Conseguenza
  della regola alla lettera, detta: in crescente i portieri vengono PRIMA e dal più alto al più basso
  (−4 < −2), in decrescente vengono per ultimi dal più basso al più alto.
- **Filtro per ruolo multiplo** sopra la tabella, «esattamente lo stesso» del Draft Assistant (sua correzione
  della stessa ora, dopo una prima versione a tendina): i chip colorati, un componente solo per le due pagine
  (`ui/role-filter`, che il Draft Assistant ora legge al posto della sua copia). P D C A su classic, su Mantra
  il vocabolario del regolamento nel suo ordine (`mantra_modules.json` → `roles`). Un uomo passa con QUALUNQUE
  dei suoi ruoli; filtra la sola tabella - consiglio, campo e conteggio delle quote leggono tutta la rosa - e
  «N di M» compare solo quando nasconde qualcuno.
- **La consigliata sceglie sulla SOMMA DEGLI FVA** («il modulo migliore è semplicemente la somma dei singoli
  FVA, non pensare alla probabilità di prendere il voto»): `points` = FVA, non più P(voto) × FVA, e nullo solo
  per chi Leghe dà fuori (indisponibile, squalificato, non convocato: un fatto, non una probabilità). Il menù dei
  moduli e il «★ migliore» leggono lo stesso numero (prima leggevano la FMA), quindi menù e campo non possono più
  dare due moduli migliori diversi. **Il prezzo, detto**: un uomo che Leghe dà al 5% con un buon FVA ora può
  scavalcare un titolare - ~~la colonna Voto continua a mostrare quella probabilità~~ chiuso un'ora dopo dal
  pavimento del 15% (sotto), sul caso Lienard. Nata dalla formazione che
  l'operatore si aspettava (4-2-3-1: Hradecky; Baku, Anton, Gvardiol, Grimaldo; Rice, Prömel o Merino; Barnes,
  F. Lopez, D. Douè; Kane) - **non verificata contro la sua rosa**, che vive nel suo browser.

- **«Perché Gabriel Jesus ha un FVA > di Kane?»** Rifatto con la funzione dell'app e le quote di quel giorno
  (Kane 1,40 ad Augsburg, Jesus 1,76 contro il Getafe): «altri» valeva **−1,00** per Kane e **+0,42** per Jesus.
  Non erano assist né cartellini: era la regressione della FM del foglio verso l'ancora del ruolo (Kane 10,6 →
  9,2, Jesus 6,38 → 7,24), che finiva tutta nel resto perché `altri = FM − MV − 3 × gol` sottrae gol VERI da
  una FM REGREDITA. Misurati sulle loro partite gli altri bonus valgono +0,05 e 0,00. Con la quota la parte gol
  è quella della partita, quindi la regressione dei gol vecchi non deve restare dietro: ora «altri» si misura
  (`fva.restPerMatch`, sulle stesse partite di campionato di questa stagione e della scorsa su cui si contano i
  gol). Senza quota non cambia niente (gol storici + resto ridanno la FM del foglio). Effetto sui due: con il
  fattore di scala delle quote a 0,7, Kane 8,25 → **9,29** e Jesus 8,52 → **8,10**; prima Jesus passava davanti
  da una scala di 0,85 in giù. **Non verificabile all'indietro** (niente quote storiche): è una correzione di
  coerenza, decisa dall'operatore col conto davanti.
- **«Godts e Doue sono quasi pari ... di poco ma dovremmo privilegiare Doue»** (chi ha dati più effettivi:
  storico al PSG e più minuti). Il vantaggio di Godts veniva proprio dalla correzione qui sopra: «altri»
  misurato su **3** partite votate (un assist = +0,31 a partita) contro le **24** di Doue (+0,08). Un tasso
  misurato su poche partite ora pesa per il suo campione: `restPerMatch` = somma / (partite votate +
  `REST_PRIOR_MATCHES` = 10), cioè tende a zero finché il calciatore non l'ha dimostrato. Scelta dichiarata,
  non misurata. Effetto (quote 1,84 e 1,87 contro il Le Mans): Godts 8,66 → 8,42, Doue 8,53 → 8,51 con scala
  1; a 0,7 Godts 7,76 e Doue 7,85 - Doue davanti di circa un decimo. Kane perde un centesimo (33 partite).
- **Fuori dal campo chi è sotto il 15%** («togliamo dal campo i giocatori < 15% come Lienard», un terzo portiere
  all'1% con FVA 5,2 che la regola «solo FVA» schierava): `lineup-advice.MIN_CHANCE_ON_PITCH` = 0,15 sulla
  probabilità che la pagina MOSTRA, letta da `fieldWeight` per il campo E per i totali del menù dei moduli (una
  regola, due lettori). Resta in panchina in ordine di FVA. Soglia dichiarata, non misurata.
- **Le W ai lati, la Pc al centro**: un posto che OFFRE un ruolo largo (`W/A`, `W/T`, `E/W`) va sulle fasce,
  anche se ammette altro; prima doveva essere tutto largo, e il 3-4-3 disegnava `W/A, W/A, A/PC` con la punta su
  una fascia. Nessuno slot del regolamento offre insieme un ruolo largo e `PC`, quindi la punta non esce mai.
- **Il selettore del modulo era vuoto all'apertura**: «automatico» aveva valore `null`, che nz-select disegna
  come nessuna scelta. Ora è una stringa (`autoModule`).
- **La panchina copre ogni titolare** («essere CERTI che non ci siano buchi nel caso ci sia qualche infortunio
  all'ultimo»): `lineup-advice.coverOrder` dà a ogni titolare un sostituto SUO (due infortuni nello stesso
  reparto = due sostituti), contando solo chi gioca a sua volta (≥ 15%: Lienard all'1% non copre niente). Giri
  per reparto dal portiere in giù - il primo infortunio di ogni reparto prima del secondo di qualunque - e dentro
  il reparto prima il titolare con meno coperture possibili, a cui va il più probabile (poi l'FVA). Classic:
  stesso ruolo. Mantra: un ruolo che il posto accetta, o quello che la matrice ufficiale delle sostituzioni
  ammette dal ruolo che il titolare occupava, malus −1 compreso (un malus non è un buco; le note `*`/`**`/`***`
  lette come le scrive il file). I posti in panchina vanno PRIMA a queste coperture e poi all'FVA, nel rispetto
  dei minimi/esatti per ruolo della lega; l'ordine di entrata resta quello di prima. La pagina dice «copre N di 11»
  (verde se tutti, con i nomi scoperti nel tooltip). **Limiti detti**: il cambio modulo delle sostituzioni
  Dynamic/Hybrid/Basic non è modellato (si conta la sola copertura sicura); la probabilità di un sostituto è
  quella di oggi, non quella condizionata all'assenza del titolare - per un portiere di un altro club è giusta,
  per il vice dello stesso club la sottostima.
- **Senza login, i dati salvati** («una volta che fai login ... memorizza i dati scaricati e riutilizzali in
  seguito senza fare il login, mostra solo la data dell'ultimo aggiornamento»). Di un account si ricorda tutto
  TRANNE il token (`leghe-known` in `localStorage`: utente e leghe); una scheda senza login mostra le letture
  della cache qualunque età abbiano, con «dati aggiornati <giorno, ora>» al posto di «letta alle», e non fa
  NESSUNA richiesta; «rileggi» lì apre il login. Una lega mai letta in questo browser lo dice (`no-login`) invece
  di inventare. I token restano in `sessionStorage` (la scelta dell'08/10 non cambia, e un test lo asserisce);
  un token scaduto toglie solo il token, «Esci» toglie anche la memoria dell'account. Le letture si tengono
  **30 giorni** invece di 7 (`LEGHE_KEEP`): la freschezza online la decidono ancora le durate della tabella.

**Il banco senza Leghe**: `app/scripts/e2e-lineup-offline.mjs` serve `dist/` con un Leghe FINTO (due leghe,
classic e Mantra, calciatori veri coi loro id), le quote nella cache della pagina e `fc_teams` da una
tabellina, e blocca ogni richiesta a Google: zero richieste a Leghe, quindi si può lanciare quanto serve. ✅
09/10/2026: 22 controlli verdi (filtro con un puntatore vero, 7 di 12 su D+A; blocchi delle quote nei due
versi; selettore del modulo che dice «Modulo: automatico»; «copre N di M» in panchina; il 3-4-3 disegnato
`W/A · A/PC · W/A`; tooltip «Paris Saint-Germain - Le Mans» con la tabella e «- MAN» senza, ricaricando la
stessa pagina; senza login le stesse 11 righe, «dati aggiornati …» e 0 richieste). Controprove: con
l'ordinamento vecchio cadono esattamente i due controlli dei blocchi; senza il ramo «salvati» cade il test di
sessione; senza `restPerMatch`, senza il pavimento, senza le coperture e con la vecchia regola delle fasce cadono
esattamente i test che descrivono ciascuna cura.

## §4-octies. Le leghe CLASSIC: il regolamento di Leghe letto nel suo motore (09/10/2026, sera)

Richiesta dell'operatore: «la schermata LINEUP è stata pensata fino ad ora per una lega MANTRA, accertati che tutti
i ragionamenti ed i calcoli funzionino coerentemente anche per leghe CLASSIC». Non si è dedotto: si è letto il
motore di calcolo di Leghe (`Leghe Fantacalcio`, `origin/master` dell'08/10: `LegheCalcoloClassicHelper`,
`ModificatoriHelper`, `CalcoloHelper`, l'enum delle sostituzioni) e l'editor del front-end (`lineup-editor/
validation.ts`, `bench-fill.ts`). `engine_*` fermo, nessun `SHEET_REVISION`. Quattro difetti, tutti curati:

- **La panchina classic era scritta PER RUOLO, e sotto Dynamic è sbagliata.** `sstype` 1 è `ChangeModule`
  (Dynamic), 2 `RoleForRole` (Hybrid), 3 `OnlyChangeRole` (Traditional). Il motore: Traditional = solo il primo
  dello STESSO ruolo; Dynamic = cammina la panchina IN ORDINE, di qualunque ruolo, ed entra il primo con un voto che
  sta in un modulo ammesso (`CambioModulo`: D, C, A ciascuno ≤ quelli del modulo); Hybrid = prima un giro per ruolo,
  poi lo stesso cammino. Quindi con la panchina P-D-C-A, in una lega Dynamic (quella dell'operatore) il miglior
  difensore entrava per un attaccante mancante prima dell'attaccante dietro di lui. Ora (`lineup-advice.benchOf`):
  **Dynamic, Hybrid e tipo non letto = una coda unica per FVA**, Traditional = per ruolo (lo stesso ordine di
  entrata, più leggibile), Mantra invariato. Perché la coda per FVA e non per «punti attesi»: con X prima di Y il
  guadagno atteso batte Y-prima di P(X)·P(Y)·(FVA X − FVA Y), qualunque siano le due probabilità - aritmetica, non
  una scelta. La nota sotto il campo dice quale regola si sta seguendo.
- **Le coperture classic contavano solo lo stesso ruolo.** Con Dynamic/Hybrid un uomo di un altro ruolo copre se il
  modulo che ne esce è fra quelli della LEGA (non quello scelto a mano): in un 4-4-2 un centrocampista copre un
  difensore se la lega ammette il 3-5-2 (`lineup-advice.classicCover`). E i cambi modulo **si sommano**: due
  difensori coperti da due centrocampisti fanno un 2-6-2, quindi ogni copertura incrociata si misura sui conteggi
  già promessi dalle precedenti (la promessa regge anche se cadono tutti insieme). Lo stesso ruolo resta preferito.
  Il portiere solo col portiere; tipo o moduli non letti = solo stesso ruolo.
- **Un modulo classic che il file del regolamento non scrive spariva.** Leghe permette a una lega classic diciotto
  moduli oltre i sette (`EXTRA_FORMATIONS` del front-end: 4-2-4, 3-6-1, 6-3-1…); `allowedRules` li buttava, e una
  lega con soli moduli sconosciuti tornava al regolamento intero, cioè si vedeva consigliare moduli che non ha. Un
  modulo classic è i suoi tre numeri (`classic_modules.json`: «legale se i CONTEGGI tornano»), quindi ora si
  costruisce dalle cifre (`withLeagueModules`, anche per la formazione inviata); Mantra no, i suoi posti sono tipati.
- **La panchina fissa con un ruolo a zero si fermava alle quote.** In Leghe, con `fbench` vero, un numero positivo è
  ESATTO e uno zero vuol dire «ruolo variabile» (default del backend e `canDropOnBench`): `[1,2,0,0]` su sette posti
  dava tre uomini. E `bseq` (un ruolo per posto) non era letto: ora riempie ogni posto col primo del suo ruolo, in
  quell'ordine.

**Il modificatore di difesa classic, detto e non ancora contato.** Leghe lo paga solo se hanno giocato almeno
**4 difensori** (e il portiere, se la lega lo conta): la media è portiere + 3 migliori difensori, voti base, a fasce di
0,25 da `smodld`. Quindi un 3-x-x lo perde sempre, e nella lega dell'operatore vale fino a +3. Il consiglio non
somma modificatori in nessuno dei due giochi (lo dice la nota); su Mantra conta meno perché ogni schema ha 5 posti
difensivi, su classic invece **sposta la scelta del modulo**. Per ora il menu dei moduli marca «senza mod. difesa» i
moduli con meno di 4 difensori e le Regole lo scrivono; contarlo (valore atteso dai voti base attesi) è una regola
nuova da misurare sulle giornate giocate: §5.

Verifica: 6 test nuovi in `lineup-advice.spec.ts` (+ uno aggiornato in `leghe-rules.spec.ts`), ognuno con la sua
controprova (rimessa la panchina per ruolo, tolti i conteggi cumulativi, tolti i moduli costruiti, rimessa la
quota esatta su tutti: cade esattamente il test che descrive la cura); `e2e-lineup-offline.mjs` con una lega classic
Dynamic + mod. difesa + 4-2-4: panchina `C 6.8 · C 6.4 · D 6.3 · P 5.1` (per ruolo sarebbe un altro ordine, il banco
lo controlla), 4-2-4 offerto e ammesso, 3-4-3 e 3-5-2 «senza mod. difesa». `ng test` 1494/1494.

## §4-nonies. Più account, più fantasquadre (09/10/2026, sera)

Richiesta: «piuttosto che loggarti su un'unico account, dammi la possibilità di aggiungere più fantasquadre ognuna
con il suo account o dello stesso account». Prima la sessione teneva UN account per piattaforma (`{classic, euro}`),
e un secondo login Leghe sostituiva il primo.

- **Un account è un login**, chiave `piattaforma:utente` (`accountKey`); la sessione ne tiene una LISTA, in
  `sessionStorage` coi token e in `leghe-known` senza (la scelta dell'08/10 sui token non cambia). Un login già
  presente si aggiorna al suo posto, uno nuovo si aggiunge; «Esci» toglie solo quello.
- **Una fantasquadra è una lega di un account**: ogni lega porta il suo `userId`, la chiave diventa
  `piattaforma:utente:lega` (`keyOf`), quindi la stessa lega raggiunta da due account sono due voci con due «mia
  squadra» - la cache era già per utente. Il selettore dice «Leghe · Lega · Squadra», col nome della squadra preso
  dalla lettura salvata di `teams/my` (nessuna richiesta) e «utente N» solo dove due voci leggerebbero uguali.
- **La modale «Account e fantasquadre»** elenca ogni login (collegato o solo con i dati salvati) con le sue leghe e il
  suo «Esci»; i due login sotto AGGIUNGONO sempre un account. Il login embed mostra ogni volta il form vuoto (letto nel
  front-end di Leghe: `login.component`, ramo `embeddedLogin`), quindi un secondo account Leghe si aggiunge dallo
  stesso bottone. Riconoscere un account: «utente N» e i nomi delle sue squadre - lo username non si salva.
- **Niente da rifare per chi era già collegato**: la lista vecchia `{classic, euro}` si legge come i suoi valori, e una
  lega scelta con la chiave vecchia (`classic:2001`) si ritrova.

Verifica: 2 test nuovi in `leghe-session.spec.ts` (due account Leghe nella stessa lega e in una terza: tre voci, la
cache sotto l'utente giusto, il nome della squadra, nessun gemello al secondo login, «Esci» di uno solo; il formato
vecchio letto) - controprova: con l'aggiornamento per piattaforma cade il primo; nel banco offline tre login (due Leghe
nella stessa lega + EuroLeghe), il selettore con tre voci distinte e la modale con i tre account.

## §4-decies. Si modifica col drag & drop, si SALVA su Leghe, e i modificatori pagano la costanza (09/10/2026, notte)

Quattro richieste dell'operatore in fila: «permettimi di salvare sul leghe la formazione»; «cambiare i calciatori nel
campetto utilizzando il drag&drop ... dalla tabella al campo (o alla panchina e viceversa) che dalla panchina al campo
(e viceversa) ... riordinare la panchina ... "scambiare" due calciatori in campo»; «se nelle regole della lega è
disponibile lo SWITCH (DEFAULT o PLUS) permettimi anche di impostarli (nello spazio sotto la panchina) con possibilità
di Drag&Drop»; «se il modificatore di rendimento è attivo aggiungi una valutazione migliore per quelli che hanno una
continuità migliore ... se il modificatore di difesa è attivo ... ai difensori ... e ricorda che le difese con < 4
difensori non ottengono questo bonus». `engine_*` fermo, nessun `SHEET_REVISION`: è tutto app.

**Il salvataggio, letto nel codice di Leghe e non indovinato** (`core/leghe-lineup.ts`, backend `origin/master`
dell'08/10: `TeamLineupService.Save`, `ValidateTeamLineup`, `ControlloSwitch`; front-end `Lineups.saveLineup`,
`lineup-switch.ts`):
- `POST /gaming/v1/teamLineup/{divisione}`, la squadra la prende Leghe dal token di lega; corpo `{starts, bench, capt,
  mdl, idcomp, mday, cmday, tid, allComp, visb, act, swtcA, swtcB, swtc, swtcMdl, pos}`, `act` 0 = dal web.
- **`starts` è ordinato per POSTO**: indice 0 il portiere, poi i posti del modulo nell'ordine di LEGHE. Su Mantra il
  backend controlla l'uomo in `starts[i]` contro il posto `i` (`RitornaMalus`), e quell'ordine non è quello di
  `mantra_modules.json`: la tabella è trascritta in `LEGHE_MANTRA_SLOTS` dal `MantraStaticData` del backend. ✅
  Verificato il 09/10/2026 con uno script: **gli undici moduli hanno gli STESSI posti** del regolamento, in un altro
  ordine, quindi la tabella decide l'ordine e nient'altro. Classic: portiere, poi D, C, A (il backend conta i ruoli).
- `mdl` è il codice della LEGA (`343`) e deve essere fra quelli ammessi. Panchina: Mantra esattamente `tbench` con
  almeno un portiere; classic fissa esattamente `tbench` (quote esatte dove positive, `bseq` in ordine), variabile al
  massimo `tbench` con le quote come minimi. **Per questo la panchina consigliata su Mantra tiene ora sempre almeno un
  portiere** (`benchOf`), anche dove la lega non lo scrive: Leghe rifiuterebbe il salvataggio (LUP011).
- Ogni regola che si può controllare qui si controlla PRIMA della richiesta (`saveBody`, una frase per causa a fianco
  del bottone): una richiesta che Leghe rifiuterebbe di sicuro è una richiesta da non mandare. I rifiuti di Leghe
  arrivano in inglese col loro codice (`LUP0xx`) e la pagina li dice in italiano (`saveRefusal`).
- **Il capitano non si sceglie ancora**: una lega che lo usa riceve «salvala da Leghe» invece di un capitano messo a
  caso (le leghe dell'operatore non lo hanno).
- Dopo il 200 la pagina **rilegge** la parte `live` (4 richieste in tutto: 1 scrittura + stato, timing, rosa) e mostra
  «Inviata», con «Leghe la conferma» solo se modulo, undici in ordine e panchina sono quelli mandati: si crede a quello
  che Leghe ha registrato, non al codice di risposta. «In tutte le competizioni» compare se ce n'è più di una attiva
  (default: quello della formazione già inviata, altrimenti no, come Leghe); la visibilità resta quella già inviata.
- L'intermediario pubblicato ammette ora anche questo percorso (`proxy/leghe-worker.mjs`); sotto `ng serve` passa già.

**Il drag & drop** (`core/lineup-edit.ts`): la formazione modificata è una BOZZA fatta di soli id - chi tiene ogni posto
del modulo, la panchina in ordine, lo switch - disegnata ogni volta coi numeri del momento, e ogni gesto è UNA funzione
pura (`move`) che restituisce la bozza nuova o la frase che dice perché no. Il primo gesto sulla consigliata (o
sull'inviata) la copia nella sua («Mia», terza voce del selettore); la freccia torna alla consigliata. Le regole:
- **in campo un uomo va solo in un posto di un suo ruolo** (la legalità del regolamento, la stessa dell'advice): Leghe
  ammetterebbe anche il fuori ruolo Mantra col malus, questa pagina no, e lo dice rifiutando;
- sul posto di un altro: chi c'era va dove stava quello trascinato (scambio in campo, se anche lui ci sta; il suo posto
  in panchina; fuori formazione se veniva dalla tabella); in panchina si inserisce dove CDK mette il segnaposto, e un
  titolare lascia il posto vuoto; sulla tabella esce dalla formazione;
- mentre un uomo è in aria i posti dove può andare si accendono e gli altri si spengono: la luce e il rilascio leggono
  la stessa `move`, e CDK rifiuta l'ingresso prima del rilascio (`cdkDropListEnterPredicate`);
- cambiare modulo sulla sua formazione dispone gli stessi uomini sul nuovo, e chi non ci sta va in TESTA alla panchina.
La colonna «Consiglio» della tabella diventa «Mia» quando la bozza c'è. **La bozza non sopravvive a un ricaricamento**.

**Lo switch** (sotto la panchina, solo se la lega lo ha): «Esce» accetta un titolare, «Entra» un panchinaro, entrambi
col drag & drop. **Basic**: chi entra prende il POSTO di chi esce (la regola del front-end di Leghe, QIT-1721: un B
sostituisce un Dc che sta sul posto Dc/B), quindi l'ordine di `starts` mette chi esce su un posto che anche l'altro può
tenere (`orderWithSwitch`). **Plus**: qualunque modulo della lega su cui gli undici DOPO lo switch riempiono ogni posto
(`FindLineup` del backend su Mantra, i conteggi su classic), portiere solo per portiere; la pagina offre i moduli
possibili e manda quello scelto (`swtcMdl`) con la posizione di chi esce (`pos`).

**I modificatori pagano la costanza** (`steadiness` nella pagina, `lineup-advice.weightOn`/`bestOnModules`): la COSTANZA
è quella dell'app (`steadyOf`, quota di voti base ≥ 6, la mediana del ruolo dove manca), il peso è lo `STEADY_SHARE`
dell'operatore con la TAGLIA letta da Leghe (`swing.steadyShareFor`: il valore massimo del modificatore su undici; a 2
punti è proprio 2/11). Fattore rendimento: a tutti. Modificatore di difesa: agli uomini che il motore di Leghe legge
(`ModificatoriHelper`: classic i difensori, Mantra `Dd Ds Dc B E M`; il portiere solo se la lega lo mette nella media)
e, su classic, **solo nei moduli con almeno 4 difensori** - quindi l'undici si sceglie modulo per modulo col peso di quel
modulo, e un 3-4-3 è pesato senza. Il menu dei moduli chiama «valore» il totale quando c'è un modificatore, il campo dice
«+ costanza X» a parte dall'FVA, e il tooltip dell'FVA scrive quanto vale per lui. È un peso DICHIARATO, non misurato;
la panchina resta ordinata sull'FVA.

**Verificato** (09/10/2026, tutto SENZA toccare il Leghe vero): `leghe-lineup.spec.ts` (ordine dei posti, codice del
modulo, rifiuti, panchina, switch Basic/Plus, frasi dei rifiuti), `lineup-edit.spec.ts` (ogni gesto e ogni rifiuto),
`lineup-advice.spec.ts` (i modificatori: 4 difensori, chi legge il mod. difesa, il back four che vince col bonus),
`leghe-session.spec.ts` (UNA scrittura sulla divisione, poi solo la parte live; senza token nessuna richiesta);
controprove: tolto il controllo dei 4 difensori o l'ordine dei posti cadono esattamente i tre test che li descrivono.
`ng test` **1527/1527**, `ng build` pulito. `e2e-lineup-offline.mjs` con un PUNTATORE VERO contro un Leghe finto che
REGISTRA il corpo ricevuto e lo riserve: tabella → campo, scambio in campo, attaccante rifiutato sul posto di un
difensore, panchina riordinata, campo → panchina e ritorno, switch A → C (Plus, 4-3-3), salvataggio (11 titolari col
portiere primo e in ordine P-D-C-A, `mdl` della lega, panchina come disegnata, switch con `pos`), «Leghe la conferma»,
4 richieste - **59 controlli, nessun problema**. Una lezione del banco: attraversando la panchina il segnaposto di CDK
la allunga di una riga e sposta in basso lo switch, quindi il puntatore deve inseguire il bersaglio (`dragTo` rilegge
la posizione prima di rilasciare), come farebbe un occhio.

**Non verificato**: il salvataggio contro il Leghe VERO. È una scrittura sull'account dell'operatore e la fa lui la
prima volta; il confronto «Leghe la conferma» è fatto apposta per dirgli subito se è andata.

## §5. Aperti, in ordine

**Dal 9 ottobre 2026 (notte), in cima:**
- **Il primo salvataggio vero**, sotto `ng serve` (il sito pubblicato non ha ancora l'intermediario): guardare che la
  riga dica «Leghe la conferma» e aprire Leghe. Se Leghe rifiuta, la frase porta il codice `LUP0xx`.
- **Il capitano** (leghe con `lcap` 1 o 2): oggi la pagina rifiuta di salvare invece di sceglierlo.
- **La bozza si perde a un ricaricamento**: si può tenere in `localStorage` per fantasquadra e giornata, se serve.
- **Il fuori ruolo Mantra col malus** non è ammesso dal drag & drop (Leghe lo ammette).
- **La panchina ignora i modificatori** nell'ordine: è una coda per FVA; il peso della costanza entra solo nella scelta
  dell'undici e del modulo.

**Dal 9 ottobre 2026 (sera tardi):**
- **Il modificatore di difesa classic** (§4-octies): oggi solo marcato nel menu. Contarlo nel modulo automatico
  vuol dire un valore atteso dai voti base attesi di portiere e difensori, a fasce - una regola nuova, da misurare sul
  banco delle giornate giocate (item 3) prima di farle scegliere il modulo.
- **I bonus della LEGA non sono letti, in nessuno dei due giochi**: Leghe serve `bnMls.bmgs` (gol PER RUOLO, P/D/C/A
  su classic), `bmcsh` (porta inviolata, +1 di default) e `motm` (+1 di default su Leghe, 0 su EuroLeghe); l'FVA usa
  +3 fisso, al portiere non somma `p × bmcsh`, a nessuno il man of the match. Il commento di `fva.GOAL_BONUS` che
  diceva «Leghe non lo serve» era falso ed è corretto.
- **Il massimo di sostituzioni** (`ssnum`, 5 nella lega Dynamic) non entra in «copre N di 11»: la promessa vale per
  ogni assenza, non per sei insieme.
- **Più account dal vivo**: provato contro un Leghe finto; due login embed di fila nel browser vero no.

**Dal 9 ottobre 2026 (sera), in cima:**
- **Sulla macchina col DB**: `git pull`, `python -m euroleghe_ingest fc_site` (riempie `fc_teams`), `export`,
  poi `npm run data:pack` e qui `npm run data:import -- <file>` (o `deploy:pages` là). Finché non succede il
  tooltip dice ancora «MAN».
- **La consigliata contro la sua attesa** (4-2-3-1: Hradecky; Baku, Anton, Gvardiol, Grimaldo; Rice, Prömel o
  Merino; Barnes, F. Lopez, D. Douè; Kane): mai confrontata con la sua rosa vera, che vive nel suo browser. Le
  quattro cure della sera (somma degli FVA, «altri» misurati e pesati sul campione, 15%, coperture) vanno
  guardate lì.
- ~~**I cambi modulo delle sostituzioni** (Dynamic/Hybrid/Basic) non sono nelle coperture~~ - classic Dynamic/Hybrid
  FATTO (§4-octies); il Basic di Mantra resta fuori. La probabilità di un vice dello STESSO club non è condizionata
  all'assenza del titolare.
- `REST_PRIOR_MATCHES` = 10 e `MIN_CHANCE_ON_PITCH` = 0,15 sono dichiarati; da guardare quando ci sarà il banco
  delle giornate giocate (item 3).

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
0-bis. ~~**Push** dei commit `bde447f` e `b8ec932`~~ - FATTO: sono su `origin/master` (verificato 09/10/2026), e con
   il push del 09/10 sera ci sono anche `f3e710c`, `98b4202` e il commit delle classic e dei più account.
0-ter. **FVA: FATTO** (`core/fva.ts`, colonna al posto di PT, la consigliata sceglie su P(voto) × FVA) e con
   la partita dentro (§4-quinquies). Restano: (a) **guardarla in un browser collegato a Leghe**, e
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
