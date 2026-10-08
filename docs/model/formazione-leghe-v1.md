# La pagina FORMAZIONE e il collegamento a Leghe — v1

**Aperto: 8 ottobre 2026.** Richiesta dell'operatore: «una nuova pagina che ti aiuti ad inserire la
formazione per la prossima giornata ... troviamo il modo migliore per caricare la tua rosa e magari le
regole per inserire formazione/panchina e competizione». Pagina `/lineup` dell'app, codice in
`app/src/app/core/leghe-*.ts`, `ui/leghe-connect/`, `views/lineup/`.

**Decisioni dell'operatore (08/10/2026):**
1. login col **login embed** di Leghe; dove non c'è (EuroLeghe) **login diretto in ogni caso**;
2. le leghe sono **EuroLeghe Mantra e Leghe Classic**;
3. **per il momento basta il consiglio**: niente scrittura della formazione su Leghe.

Stato: **fase 1 fatta** (collegamento, lettura di rosa, regole, competizioni, avversario e formazione
inviata), commit `0a88a1a` su `master`, pushato. Il motore del consiglio è la fase 2. **Il sito pubblicato
NON ha ancora la pagina funzionante**: manca l'intermediario (§2) e la pagina non è stata ripubblicata.

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

## §5. Aperti, in ordine

0. **Quote (§4-ter), lato operatore**: incollare `scripts/gas/odds.gs` come nuovo file nel progetto
   Apps Script del foglio probabili e aggiornare `probabili-sheet.gs` (una riga in `doGet`); lanciare
   `oddsProbe()` - se Google viene rifiutato da Cloudflare, la cattura va spostata sul portatile; poi
   `oddsInstall()` e una NUOVA VERSIONE della distribuzione. Verifica offline dei parser:
   `node scripts/gas/verify-odds.mjs <cartella con league.html e match*.html>`.
1. **Pubblicare l'intermediario**: account Cloudflare dell'operatore (gratuito; che non chieda la carta lo
   dicono fonti non ufficiali), `npx wrangler deploy` da `app/proxy/` (comando nel file), poi incollare
   l'indirizzo nella pagina («Account»). Poi ripubblicare il sito (`npm run deploy:pages`) e verificarlo
   col browser.
2. **Fase 2, il motore del consiglio** (§4), Leghe Classic per prima, con la tensione del §4 decisa prima.
3. **Il banco**: rigiocare le giornate già giocate contro le formazioni vere dell'operatore.
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
