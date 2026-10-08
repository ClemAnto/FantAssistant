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
inviata). Il motore del consiglio è la fase 2.


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

Per ogni uomo: probabilità di prendere il voto (dalla `percent` della piattaforma e dalle quattro fonti del
foglio probabili, con la curva di `rosa-3-giornate-v1.md` §2 **da rimisurare** sulle giornate giocate) e
fantavoto atteso in quella partita (motore + calendario; per i portieri la porta inviolata). Poi modulo,
undici, ordine della panchina e switch che rendono di più **con le sostituzioni automatiche del regolamento
letto** (Dynamic/Hybrid/Traditional; Basic/Easy/Master con la matrice di `mantra_modules.json`), mod.
difesa e fattore rendimento compresi. Obiettivo v1: punti attesi; scontri diretti contro l'avversario
letto: dopo. Giudice prima di fidarsi: rigiocare le giornate già giocate contro le formazioni che
l'operatore ha davvero schierato (Leghe le serve).


## §5. Lezioni pagate nella sessione

- **Una scelta dell'operatore va misurata prima di costruirla**: il login embed sembrava risolvere tutto,
  e risolve la password e non il CORS. Detto prima di scrivere codice.
- **Una ragione verificata nel codice altrui si riverifica dal vivo**: il backend diceva che i token di
  lega c'erano; è stata la prova con l'account a confermarlo.
- **Le credenziali non passano dalla chat**: la prima prova è stata fatta con quelle scritte in chat ed è
  fallita (ATH018); quelle nel `.env` funzionano. Due tentativi per piattaforma e poi stop, per non
  bloccare l'account. Quelle della chat vanno considerate bruciate.
- **Backslash e heredoc, di nuovo** (§7 delle istruzioni globali): un `str.replace` in Python dentro un
  heredoc ha rotto due regex di uno script; si scrive col file, non con la shell.
