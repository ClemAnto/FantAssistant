# Todolist DRAFT CLASSIC v1 — il Draft Assistant su un draft Serie A classic

**Nata il 30/09/2026** dalla richiesta dell'operatore: prima un draft Serie A classic (non mantra), «verifica che la
pagina per seguire il draft funzioni perfettamente anche in questa configurazione», poi «adattiamo le funzioni che
prevedono i ruoli mantra ai ruoli classic». Quello che è stato fatto quel giorno, coi suoi numeri, sta in
[priorita-draft-v1.md](priorita-draft-v1.md) **§23**. **Citare da lì, non da qui:** questo file porta lo stato,
non la misura.

**Fatto il 30/09/2026 (non ancora committato alla nascita di questo file):**
- le squadre escluse sono **per listone** (quelle di EuroLeghe svuotavano un draft Serie A, riprodotto: 0 righe);
- sul tavolo live l'FVM segue il **gioco** del tavolo (prima era sempre quello mantra: 140 uomini su 535 diversi);
- Draft Priority, SeSw, RAR, piani e DP sul campetto accesi anche sul classic;
- portiere riconosciuto in ogni grafia (`P` del foglio classic), quote 3/8/8/6 in ogni previsione e scelta;
- ruoli del gioco dal feed (`gameRoles`), non i codici mantra che il listone live porta su ogni riga;
- pastiglia «pieno» sulla lista, colonna del ruolo stretta a una lettera sul classic;
- banco della revisione: aspettava troppo poco il foglio (rosso preesistente, era del banco).

Gli item sono **ordinati per urgenza rispetto al draft**, poi per resa attesa.

---

## 0. Prima del draft (operatore) — bloccanti

**0.1 Decidere quale consiglio usa la pagina sul classic.** Oggi la Draft Priority, che **non ha un verdetto sul
classic**; l'alternativa è il consiglio di prima (`pickForUs`: valore × quote graduate × «prendi chi sparirà»),
misurato +0,77% robust sulle dieci finestre Serie A (metrica-asta-surplus-v1.md §17). Tornare indietro è una riga:
la condizione di `AuctionAdvice.priorityOn` torna a chiedere `isMantra()`. Da decidere prima del draft, o dopo
l'item 2 se c'è tempo.

**0.2 Confermare Z sul classic.** Z = i migliori `squadre × posti del modulo` per ruolo (4 D, 4 C, 2 A a testa),
non i «3 per partecipante» della sua frase sulle Pc (`LeagueSize.startersFromPlaces`). È un'estensione nostra,
dichiarata; l'item 2.4 la misura.

**0.3 Controllare le Opzioni di lega nel SUO browser.** Il tavolo porta listone, gioco, squadre e rose; restano
DICHIARATI e oggi sono quelli della EuroLeghe:
- **porte** — spente, se la lega Serie A compra portieri e non porte;
- **tetto dei primi turni** (FVM ≥ 213 per 5 turni) — sul listone Serie A blocca 7 uomini; tenerlo solo se è il
  regolamento della nuova lega;
- **squadre** — il foglio classic `Leghe` è calcolato a 10: con un numero diverso il livello di rimpiazzo è di
  un'altra lega (la pagina lo dice);
- **esclusioni** — dopo il primo avvio della versione nuova, le esclusioni di EuroLeghe devono stare sul listone
  EuroLeghe e il listone Serie A deve partire senza (migrazione `readExcludedByPlatform`).

**0.4 Commit, bundle e pubblicazione.** Committare su richiesta; se il draft si segue dal sito, `npm run
deploy:pages` dopo un `export` del giorno (il deploy pubblica l'albero di lavoro, non `HEAD`).

## 1. Verifiche sul tavolo vero — appena esiste una sessione classic

**1.1 Leggere una sessione classic di fanta-asta-live** (`app/scripts/probe-live-session.mjs`, sola lettura). Mai
osservata finora: le due sessioni lette sul 09/08 e il draft FA-jo5-zai erano altro. Da verificare:
- cosa porta `playerList[].roles` su una sessione classic (l'ipotesi del 30/09: i codici mantra, per questo
  `gameRoles` legge la zona);
- `settings.game` = 1 e `settings.roles` con le quote `def`/`mid`/`atk` (lette da `lineQuotas`);
- che il prezzo di una scelta (`picks[].cost`) sia l'FVM **classic** (`stats.fmv.classic`), cioè quello che
  `pricedFor` ora usa;
- se la sessione pubblica `inactiveTeams` e come ordina `pickOrder` (stessa regola del draft mantra?).

**1.2 Guardare la pagina collegata a quella sessione**: lista, filtro P/D/C/A, campetto, ordine di chiamata,
previsioni «prima di te», nessuna scelta prevista fuori quota.

## 2. Misurare la DP sul classic — il banco del draft

Il banco oggi **non può** giudicare: niente quote e finestre troppo corte (priorita-draft-v1.md §23). Quattro
passi, in ordine.

**2.1 Quote come regola del banco.** `engine.legalPoolFor` accetta `setup.quotas` (da `squad_slots` della lega) e
toglie chi appartiene a una linea piena, per tutti i sedili. **Opt-in** (`--quotas` in `multi.mjs`), perché i
numeri pubblicati del classic (§17) sono stati giocati senza e devono riprodursi identici — verificarlo girando
`node multi.mjs published Leghe serie-a.json` prima e dopo.

**2.2 Finestre col pool largo.** `serie-a.json` / `leghe-classic.json` portano 15-24 portieri prezzati per
stagione contro i 30 che dieci squadre da tre ne comprano: `extract.py` tiene solo chi il motore prezza. Estrarre
anche le stime (`est_*`, col loro `est_confidence`) finché ogni ruolo ha almeno `squadre × quota` uomini; dichiarare
nel file quanti sono stimati per ruolo. I file restano fuori da git (contenuto a pagamento).

**2.3 Il baseline giusto.** `policies.adoptedCover` chiama `coverNeedOf(team.roster, ctx.shapes)` senza il gioco,
quindi sul classic calcola la regola dei POSTI del mantra e non la scala graduata che la pagina spedisce: passare
`ctx.setup.game`. Il baseline classic è `{ need: adoptedCover(), currency: withSurvival(VALUE) }`; verificare che
riproduca il +0,77% del §17 (a regole invariate) prima di usarlo come base.

**2.4 Il candidato e la griglia, pre-registrati prima della corsa.** `rarity.appDP` passa a `priorityRoleStats` una
`LeagueSize` senza `quotas` né `startersFromPlaces`: aggiungerle quando `ctx.setup.game === 'classic'`, così il banco
misura il codice che la pagina esegue. Bracci:
- DP spedita (RAR 0,25, senza razionamento) contro il baseline dell'item 2.3;
- sconto di RAR sul classic: 0 · 0,1 · 0,2 · 0,25 · 0,3 · 0,5 (misurato solo sul mantra, §21);
- Z sui posti del modulo contro i 3 per partecipante (item 0.2);
- la DP col razionamento acceso (`places`), spento sul mantra perché non robusto (§22).

Criterio (quello del banco): punti a giornata appaiati, dieci finestre Serie A, verdetto robust e strict affiancati,
pavimento 0,5% sulla media, nessuna finestra sotto −2%. **Se la DP perde**, sul classic si torna al consiglio di
prima (item 0.1) e lo si scrive; se perde di poco, decide l'operatore.

## 3. Pagina — quello che resta sul classic

**3.1 Il modulo del campetto.** A rosa vuota il campetto sceglie il modulo dove i suggeriti rendono di più (sul
banco del 30/09 un 5-4-1, perché la DP premia i difensori), mentre i piani leggono un 3-4-3. Sul mantra ci sono i
moduli consigliati (★, `RECOMMENDED_MANTRA`); sul classic nessuno. Chiedere all'operatore se la sua lega classic ha
moduli di riferimento: per le buste chiuse aveva dichiarato 3-4-3 e 4-3-3 (con il mod. difesa). Se sì, una lista
classic accanto a quella mantra, dichiarata.

**3.2 I piani sul classic.** Un piano letto a metà draft proponeva due portieri a DP 0 («senza riserva» sul posto del
portiere). Verificare che la diagnosi del classic (`draft-scenarios`) non chieda riserve per il portiere in un
formato dove i tre portieri sono comunque obbligatori, e che le catene rispettino le quote (usano `legalFor`, che le
legge: da confermare con un test).

**3.3 Banco e2e: la pastiglia «pieno».** Oggi nessun passo la vede, perché dopo 40 scelte la mia rosa non ha una
linea piena. Un passo che riempie un reparto (sei attaccanti) e pretende: i liberi di quel reparto hanno
`data-full`, quelli degli altri no, e il doppio click su uno di loro viene rifiutato con la ragione.

**3.4 Banco e2e: le previsioni rispettano le quote.** Il contatore «scelte rifiutate e ritentate» misura i doppi
click del banco sulla cima della lista, non le previsioni. Un passo che fa giocare AUTO fino a fine draft sul classic
e pretende zero stop per «reparto pieno» (AUTO sceglie l'uomo previsto per ogni rivale).

**3.5 Il testo dei tooltip.** `prioHint` e l'intestazione DP dicono «Draft Priority: la SeSw, abbassata…» su tutti e
due i giochi: da rileggere con l'operatore, sul classic la frase è corretta ma non dice che le quote limitano la
scelta.

## 4. Chiusura

**4.1** Aggiornare priorita-draft-v1.md §23 col verdetto del banco (item 2) e con quello che la sessione vera ha
mostrato (item 1). **4.2** Quando l'operatore dice «chiudi», riportare lo stato qui e nella nota di continuità.
