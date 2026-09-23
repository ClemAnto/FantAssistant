"""categories - which of seven words describes what a man is WORTH INSIDE HIS ROLE, for the season coming.

THE SEVEN WORDS ARE THE OPERATOR'S, dictated 22/09/2026, and they replace the six of 01/09 (oro,
argento, bronzo, cristallo, scommessa, scarto) on his instruction:

    supertop    he plays and is OFF THE SCALE in his role    (Malen, Martinez L., Dimarco, Paz N.)
    top         the best of his role, or off the scale but too fragile to play  (Calhanoglu, Hojlund)
    semitop     high in his role                             (Scamacca)
    promessa    un solido che nelle prime giornate ha gia' una buona media voto e qualche bonus
    buono       in the top quarter of his role, and he plays (Kvernadze, Varela)
    tappabuchi  he plays, and that is what you buy him for   (Pinamonti, Douglas Luiz)
    scarto      he does not even play - and it is MEASURED
    incognita   nothing to read: no expected fantamedia at all

TWO AXES, AND EVERY BAR COMES FROM A NAME HE GAVE. The nine verdicts he dictated are the
specification, exactly as the seven names of 01/09 were: they were all reproduced before this module
was written, and a change that breaks one of them is a change to re-discuss with him.

  * THE LEVEL is the expected fantamedia INSIDE THE ROLE. It has to be the forecast and not his
    record (Malen played 18 matches, all after January, and is the first `super`), and it has to be
    read inside the role because 6.78 is the best defender in the listone and the 44th forward.
    IT IS NOT THE BONUS RATE, which was tried first and REFUSED because it does not reproduce his
    names: Kvernadze and Varela sit under «qualche bonus» on both the historical and the expected
    scale and he calls them `solido`, while the expected fantamedia orders all six of his first names
    exactly as he labelled them (8.21 · 7.73 · 7.11 · 6.70 · 6.65 · 6.60 against supertop · supertop ·
    top · top · buono · buono). The fantamedia sums the base vote and the bonus, which is what he
    looks at.
  * WILL HE PLAY is `engine_pv_pred / matchdays`, titolarita in this project's only sense. It is what
    keeps Calhanoglu (the best midfielder of the listone, 0.60 of the calendar) and De Bruyne (0.70,
    «fragile, non puo' darti tante presenze») out of `super` - his own words, and the bar sits
    between De Bruyne at 0.70 and Martinez at 0.74.

L'OTTAVA PAROLA, 23/09/2026, E LA SUA E' L'UNICA PROVA SUL CALCIO GIA' GIOCATO. Le altre sette si
decidono su due PREVISIONI - la fantamedia attesa e la quota di calendario - e `promessa` aggiunge a
`solido` una domanda sul presente: «hanno gia' dimostrato nelle prime giornate di avere una buona media
voto e di aver fatto qualche bonus». Il suo riepilogo dello stesso giorno la colloca: «PROMESSE:
calciatori che hanno costanza e titolarita' e hanno gia' dimostrato nella stagione corrente di essere in
forma · SOLIDI: calciatori che hanno costanza e titolarita', ottimi comprimari». Misurata sul foglio del
22/09 prima di spedirla: 17 righe su 562 in Serie A e 17 su 953 su euro - una popolazione vera, che e' la
domanda che questo modulo si fa da se' da quando `scommessa` usci' vuota per costruzione.

...E IL SUO PREZZO E' CHE `solido` PERDE I DUE NOMI CON CUI ERA STATO DETTATO: Kvernadze (voto 7,00 e
+1,90 di bonus in cinque giornate) e Varela G. (6,62 e +2,88) diventano `promessa`. Non e' una
dichiarazione rotta - la parola non esisteva quando lui li nomino' - ed e' anzi la conferma che l'asse e'
quello giusto, perche' il docstring di `relevel` qui sotto separava GIA' Varela da Pinamonti dicendo
esattamente questo: «Varela sta giocando bene ORA». Va detto invece di lasciarlo scoprire.

IL CANCELLO DELL'UNDICI TIPO (`gated`, sua regola del 23/09/2026) sta FUORI dalla cascata e si applica
dopo, dove il gradino esiste: nessuna parola sopra `operaio` si da' a un uomo che l'undici tipo non
schiera. Vedi la funzione per i quattro nomi che l'hanno prodotta e per il costo misurato.

THE LEVEL IS RE-BLENDED WITH A K PER ROLE, and this is the one piece that is measured rather than
declared. The sheet's fantamedia blends the season in progress with the previous one using R25's K,
which is FORTY for every role; measured out of sample (leave-one-season-out, ten seasons of Serie A,
target = the matchdays AFTER the k-th so the ones already seen are not inside the outcome), the right
weight depends on the role - and by a factor of two:

    role   K     weight of 5 played matchdays   gain over last season alone   seasons better
    P      16.6  23%                            6.2%                          9/10
    D      32.6  13%                            2.4%                          9/10
    C      43.5  10%                            1.7%                          7/10
    A      18.5  21%                            6.0%                          10/10

...E DAL 24/09/2026 L'ATTACCANTE CHE HA UNO STORICO NON STA PIU' SU QUELL'OTTIMO: `DECLARED_K` lo
porta a 45, cioe' il 10%, su dichiarazione dell'operatore e con il prezzo misurato accanto (+4,4%
invece di +6,0%, 10 stagioni su 10 comunque migliori del baseline). LE DUE TABELLE SONO SEPARATE
APPOSTA - la misura resta leggibile accanto alla dichiarazione - e la dichiarata vale SOLO dove c'e'
uno storico da pesare: senza, le cinque giornate sono la sola prova che esista e la misura torna a
decidere. Vedi `relevel` per i due versi in cui la cosa e' stata misurata prima di scegliere.

The mechanism is in the error itself: a forward's fantamedia is volatile (0.63 of MAE against a
defender's 0.28), so last season's signal is weaker and the new matches matter more. WITHOUT THIS the
scale cannot tell `solido` from `operaio`: Varela and Pinamonti have the same expected fantamedia
(6.60 and 6.61) and he puts them in different words - what separates them is that Varela is playing
well NOW (+2.88 of bonus, 6.62 of base vote) and Pinamonti is not (0.00 and 5.75). Re-blended, they
sit 36 percentiles apart instead of 1.

THIS IS REPORTING AND THE ENGINE DOES NOT MOVE. `engine_fm_pred` keeps R25's K of 40: changing the
engine's own blend per role is a GATED question and is pre-registered separately. What happens here is
that a `desc_*` column reads the same numbers with a weight measured for the question it answers - and
if the gate ever adopts a per-role K, this correction becomes the identity and should be removed
rather than counted twice.

THE BARS ARE ABSOLUTE (his ruling of 01/09/2026, over percentiles recomputed per sheet): a bar that
moved with the sheet would make a word mean something different every week. They were measured ONCE,
on the 2026-27 Serie A sheet the nine verdicts were given on, at the percentiles his own names put
them: `super` 97, `top` 93.5, `semi` 85, `solido` 77. Re-measure them when the listone changes
shape, and say so when you do.

Dependency-free, like the rest of `engine/`: the shippable TypeScript engine gets ported from here.
"""

from __future__ import annotations

from collections.abc import Mapping

from euroleghe_ingest.engine import status

#: The seven words. Their INDEX is the order he dictated them in, so a screen that sorts by category
#: has ONE ordering - three copies of seven words would eventually disagree about one of them.
#: `scommessa` is last because it is not a judgement: it is the absence of one.
#: L'ORDINE E' IL SUO (22/09/2026, sera): `scommessa` sta SOPRA `scarto`, perche' «nessuno l'ha
#: ancora misurato» promette piu' di «e' misurato e non gioca» - la stessa ragione per cui le due
#: parole non si fondono. Nella prima stesura `scommessa` (allora `scommessa`) chiudeva la scala come
#: non-giudizio; lui l'ha messa davanti allo scarto, e la graduatoria e' sua.
#: `promessa` e' l'OTTAVA, aggiunta il 23/09/2026 su sua istruzione, fra `semi` e `solido`: «le PROMESSE
#: sono calciatori SOLIDI che hanno gia' dimostrato nelle prime giornate di avere una buona media voto e
#: di aver fatto qualche bonus».
#: `boa` e `incognita` sono la NONA e la DECIMA, 23/09/2026 sera. `incognita` chiude la scala perche' non
#: e' un giudizio ma l'assenza di uno - lo stesso posto in cui `scommessa` chiudeva prima che lui la
#: spostasse sopra lo scarto, con il suo stesso argomento: quella promette qualcosa, questa no.
#:
#: `boa` E' SALITA DI UN GRADINO LO STESSO GIORNO, e la ragione e' una CORREZIONE DI VOCABOLARIO che
#: cambia due parole insieme: «RISERVA non e' da intendersi "riserva nella sua squadra di serie A" ma
#: "da schierare come riserva nella propria rosa" ... BOA dovrebbe essere un gradino sotto: piuttosto
#: che affondare meglio averlo in squadra». Nata «prima di SCARTO», sotto `scommessa`; ora sta subito
#: sotto `operaio` e sopra di lei - un uomo che gioca tutte le settimane vale piu' di uno che nessuno
#: ha ancora prezzato. La misura lo diceva gia' e la dichiarazione l'ha raggiunta: i nove uomini che
#: cattura giocano lo 0,81-0,90 del calendario, cioe' piu' della operaio medio.
LADDER: tuple[str, ...] = (
    "super", "top", "semi", "promessa", "solido", "scommessa", "operaio", "boa", "scarto", "incognita")

#: Le stesse sette parole per NOME, cosi' la cascata non si scrive con gli indici: riordinarle - e lui
#: l'ha gia' fatto una volta, spostando `scommessa` sopra `scarto` - rinumerava ogni `LADDER[n]` e il
#: compilatore non avrebbe detto niente. Con i nomi un riordino non puo' cambiare quale parola torna.
SUPER, TOP, SEMI, PROMESSA, SOLIDO, SCOMMESSA, OPERAIO, BOA, SCARTO, INCOGNITA = LADDER

#: `operaio` SI CHIAMAVA `riserva` FINO AL 23/09/2026 (sera), e il nome e' suo come tutti gli altri.
#: La ragione e' che la parola vecchia prometteva una cosa e la classe ne conteneva un'altra: con la
#: scala a sette parole raccoglieva 233 righe di 562, cioe' meta' listone, e un undici da campione ne
#: schierava 3,4 - gente che gioca, non gente in panchina. La sbarra di quella stessa giornata ha
#: curato il CONTEGGIO (~15 per ruolo) e lui ha voluto curare anche il NOME.
#: Il disegno lo diceva gia' prima della parola: l'icona di questa classe e' l'ATTREZZO
#: (`categoria.ts`, «le icone dicono il MESTIERE ... riempie un posto»), non una mezza stella.
#: IL PREZZO E' DICHIARATO: la stringa viaggia sul foglio (`desc_category`) e quindi nel pacchetto, e
#: un bundle scritto prima di oggi porta ancora `riserva`. Finche' i fogli non sono rigenerati l'app
#: legge una parola che il suo vocabolario non ha - si vede, non si rompe - e la cura e' un `snapshot`.

#: «gioca sempre», the gate of `super`. DECLARED from two of his own cases and not fitted: De Bruyne
#: at 0.70 is OUT («e' fragile e non puo' darti tante presenze») and Martinez at 0.74 is IN, so the bar
#: is between them. It is deliberately stricter than the 0.70 the six-word scale used.
PLAYS_ALWAYS = 0.72

#: «gioca spesso», the floor under which a man is a `scarto` whatever his level. His decision of
#: 22/09/2026, taken to let Varela (0.54) be a `solido`: half the calendar.
PLAYS_OFTEN = 0.50

#: «UN TOP DEVE GARANTIRE ALMENO 25 PRESENZE», sua dichiarazione del 24/09/2026 dopo che la misura gli
#: aveva messo davanti il prezzo: la ragione che aveva dato per Esposito F.P. («ha poche presenze
#: previste») non era scrivibile senza toccare Calhanoglu, che lui aveva dichiarato `top` proprio come
#: «fuori scala e non gioca abbastanza» e che gioca MENO di lui - 22,8 presenze su 38 contro 25,3.
#: Messo davanti alla scelta, ha ritirato Calhanoglu: il pavimento vale e lui scende.
#:
#: E' UNA QUOTA E NON UNA CIFRA, la lezione di R20, e la base e' 38 come le due della banda delle
#: scommesse - «25 presenze» e' una frase su una stagione piena, e sul foglio di oggi sono 21,7
#: giornate di 33. Il ramo `top` era l'unico della cascata senza pavimento, e il commento che ci stava
#: chiedeva di CONTARE la popolazione prima di metterne uno: contata, su Serie A cadono **4 righe di
#: 27** (Calhanoglu 22,8 · Bisseck 23,5 · Adzic 23,8 · McTominay 24,5) e su euro **17 di 51**, che e'
#: un terzo e va detto invece di lasciarlo scoprire. Nessuna delle due tocca Esposito F.P. (25,3), che
#: esce da `top` per il livello e non per le presenze.
#:
#: NON TOCCA `super`, che ha gia' `PLAYS_ALWAYS` = 0,72, cioe' piu' severo: chi cade da li' incontra
#: comunque questo pavimento un gradino sotto. E chi non lo passa non precipita - prende la parola che
#: il suo livello gli da' senza il ramo `top`, cioe' `semi` se ha anche le presenze per quello e
#: `solido`/`promessa` altrimenti (Calhanoglu legge 6,987 contro un `good` di 6,35).
TOP_PLAYS = 25.0 / 38.0

#: «gioca parecchio», the floor of `semi`. His ruling of 22/09/2026 evening - «Adams C. non puo'
#: essere un SEMITOP perche' ha troppe poche partite attese» - and the band is closed by two cases:
#: Adams C. OUT at 0.630 (with a measured history behind him, so the level is not the problem) and
#: Scamacca IN at 0.718.
#:
#: IT IS NOT `PLAYS_ALWAYS`, and the first version made it so by reading «0,72» off a ROUNDED table:
#: Scamacca's real share is 0.718 and the bar cut him out by two thousandths, which is the same
#: mistake the two bars of Svilar and Varela had already cost - committed again, by whoever had just
#: written it down. The value sits in the middle of the band and not on either edge.
PLAYS_A_LOT = 0.68

#: LE DUE PROVE DI `promessa`, sulla STAGIONE IN CORSO e non sulla previsione: «una buona media voto»
#: e «qualche bonus», le sue due parole del 23/09/2026. Sono l'unica cosa in questo modulo che legge il
#: calcio GIA' GIOCATO invece di una previsione, ed e' quello che la parola dice di se': `solido` e
#: `promessa` promettono la stessa costanza e la stessa titolarita', e la seconda aggiunge «e lo sta
#: gia' facendo».
#:
#: IL SEI NON E' SCELTO: e' `PASS_MARK`, la sufficienza che il regolamento paga (`bench/auction/rules.py`
#: e `core/player-ratings.ts` lo portano gia' con quel nome e quel valore). Non si importa da li' perche'
#: `engine/` non dipende da un banco, e si dichiara qui con la sua provenienza invece di essere un numero
#: nuovo - due strade indipendenti sullo stesso valore sono evidenza, un secondo numero sarebbe un debito.
FORM_MARK = 6.0

#: «QUALCHE BONUS» letto alla lettera: il bonus NETTO a presenza e' positivo, cioe' sta aggiungendo
#: qualcosa. Netto e non lordo perche' e' `fantavoto - voto`, quindi un'ammonizione la paga: un uomo che
#: segna e si fa ammonire ogni domenica non «porta bonus» piu' di quanto li tolga. La banda misurata sul
#: foglio del 22/09/2026 e' piatta e non ha un salto su cui appoggiarsi - 18 uomini sopra lo zero, 17
#: sopra 0,25, 15 sopra 0,34 - quindi il valore resta la lettura LETTERALE della sua frase invece di un
#: percentile, e il costo di stringerlo e' scritto qui perche' lo possa spostare guardandolo.
FORM_BONUS = 0.0

#: QUANTO DEVE AVER GIOCATO perche' «ha gia' dimostrato» voglia dire qualcosa: meta' delle giornate che
#: si sono giocate. E' una QUOTA e non un numero di partite, per la ragione che R20 ha insegnato a questo
#: progetto - «tre presenze» e' severo a settembre e banale a marzo - e ha la sua costante invece di
#: riusare `PLAYS_OFTEN`, che risponde a un'altra domanda (quella e' una quota PREVISTA di calendario,
#: questa una quota VISTA di giornate gia' giocate): una soglia presa in prestito da un'altra domanda e'
#: un difetto che questo repository ha gia' pagato tre volte.
FORM_ROUNDS_SHARE = 0.5

#: LE DUE PROVE DI `scommessa`, sua condizione del 23/09/2026: «nessuno l'ha ancora prezzato MA ci sono
#: ottimi presupposti per fare bene (voto sintetico buono, tanti bonus in passato)». Senza di loro la
#: parola diceva solo «non misurato», che e' quello che ora dice `incognita`.
#:
#: SOGLIE ASSOLUTE E DICHIARATE, sua scelta fra tre forme messe davanti a lui con i nomi che producono.
#: Il marchio che esisteva gia' (`abroad.screen`, il terzo alto di TUTTI i nuovi arrivati) e' stato
#: provato per primo e RIFIUTATO dalla misura: su 83 scommesse di Serie A ne accende **zero**, cioe'
#: renderebbe la parola vuota per costruzione - il difetto che questo modulo ha gia' pagato con
#: `scommessa` stessa e che la scala a sei parole aveva pagato con `bandiera`.
#:
#: LE DUE CIFRE SONO SUE (23/09/2026): «per le scommesse la soglia voto deve essere 5,8 e bonus > -0,25
#: (escludiamo uno che si fa sempre ammonire)». Il voto NON e' `PASS_MARK` come le altre due sei di
#: questo modulo, ed e' giusto che non lo sia: li' si chiede una sufficienza REALIZZATA, qui un voto
#: SINTETICO convertito da un altro campionato, dove il sei e' gia' un uomo notevole - sul foglio del
#: 22/09 la sbarra a 6,00 teneva UN uomo su 83 e a 5,80 ne tiene sette.
PROSPECT_MARK = 5.8

#: ...E LA SECONDA CIFRA HA IMPOSTO LA QUANTITA', che e' la parte che vale piu' del numero. Un tetto
#: NEGATIVO su `ga90` sarebbe stato INERTE per costruzione - gol piu' assist per 90 non scende mai sotto
#: zero - quindi avrebbe detto «escludo chi si fa sempre ammonire» senza guardare un cartellino: la
#: famiglia del flag che stampa «nessun problema» dopo non aver guardato niente. La sua frase nomina i
#: cartellini, quindi si legge il NETTO (`abroad.net90`: bonus della finestra meno mezzo punto a giallo
#: e uno a rosso, entrambi per 90).
#:
#: OGGI NON ESCLUDE NESSUNO, e va detto invece di lasciarlo scoprire: il peggiore del foglio sta a
#: **-0,091** (Leite, quattro gialli in 1970 minuti e nessun bonus), quindi per arrivare a -0,25 senza
#: bonus servirebbe un giallo ogni due partite scarse. E' una guardia che esiste per un caso che questo
#: listone non contiene - come `BOARD_OUT_SHARE`, dichiarata inerte con il suo conteggio accanto - e non
#: una manopola che sposta qualcosa oggi.
PROSPECT_BONUS = -0.25

#: «GIOCA QUASI SEMPRE», il pavimento di `boa`. Nato come `status.PLAY_ALMOST_EVERY` (0,80) e SCESO a
#: 0,72 il 23/09/2026, chiuso dai suoi due `operaio` dichiarati: Pinamonti gioca lo 0,721 e Douglas Luiz
#: lo 0,742, e la loro promessa di ieri - «gioca, ed e' per quello che lo compri» - e' parola per parola
#: quello che `boa` dice oggi. A 0,80 restavano fuori tutti e due e finivano in `scarto`: la sbarra e'
#: fissata dai suoi nomi, che e' come sono state fissate tutte le altre di questo modulo.
#:
#: SCESA A 0,715 IL 24/09/2026, e la ragione e' che tagliava per DUE MILLESIMI. Piccoli («e' una BOA o
#: una SCOMMESSA?») gioca lo **0,7182** del calendario e ha la media voto attesa che serve (5,977
#: contro 5,94): mancava la quota, di 0,0018. E' la QUARTA volta che questo repository paga una sbarra
#: letta su un numero arrotondato - Scamacca (0,718 contro 0,72), Svilar e Varela sono le altre tre - e
#: la scelta fra le due sbarre che lui mancava e' sua: l'altra, il pavimento del potenziale, gli stava
#: cinque millesimi sopra. Il valore sta in mezzo fra lui e Pinamonti (0,721), non sul bordo, e
#: `PLAYS_ALWAYS` resta 0,72: due costanti con lo stesso numero rispondevano a due domande, e questa si
#: e' mossa da sola. Costo misurato prima: `boa` resta a 5 attaccanti su 96, cioe' e' uno scambio.
#: ...E SCESA ANCORA A 0,700 IL 24/09/2026 su un suo nome: «perche' Castro e' uno scarto? Dovrebbe
#: essere almeno una BOA». Castro S. ha la media voto che serve (6,168 contro 5,94) e gli mancava solo
#: la quota.
#:
#: IL VALORE STA AL CENTRO DI UN VUOTO, E IL VUOTO LO PRODUCE L'ARROTONDAMENTO. La quota e'
#: `engine_pv_pred / matchdays` e quella colonna e' arrotondata a UN DECIMALE, quindi due uomini
#: consecutivi distano sempre `1/matchdays` = 3 millesimi e in mezzo non c'e' nessuno: Castro legge
#: 23,2 su 33, cioe' un vero in [0,70152 · 0,70455], e Busio - il primo sotto di lui - legge 23,0,
#: cioe' [0,69545 · 0,69848]. La sbarra a **0,700** cade nel mezzo e non puo' sbagliare in nessuno dei
#: due versi.
#: LA PRIMA STESURA ERA 0,702 E HA FALLITO PROPRIO COSI', che e' la QUINTA istanza dell'arrotondamento
#: di questo repository commessa mentre si curava la quarta: 0,702 era stato scelto leggendo la quota
#: NOMINALE di Castro (23,2/33 = 0,70303) come se fosse il suo valore, e il valore vero gli e' caduto
#: sotto - il foglio rigenerato lo ha stampato `scarto` e la funzione chiamata a mano diceva `boa`.
#: *Su una quantita' che arriva da una colonna arrotondata non si fissano sbarre a millesimi: si mette
#: la sbarra nel vuoto che l'arrotondamento stesso garantisce.*
#: COSTO CONTATO SUL FOGLIO VERO: **una riga sola** di Serie A attraversa, Castro. Su euro nessuna -
#: la' i `boa` di quella fascia arrivano gia' dal pavimento degli operai di `as_bet`.
BOA_PLAYS = 0.700

#: «MEDIA VOTO DIGNITOSA», la MV ATTESA (`est_mv`) e non una misura. Sulla media voto e non sulla
#: fantamedia perche' e' la parola che lui ha usato, ed e' anche l'unica che funziona per un portiere: la
#: sua fantamedia porta i gol subiti, quindi De Gea legge 4,56 di livello e 6,05 di media voto.
#:
#: PER PIATTAFORMA dal 23/09/2026, e per la ragione di sempre: la MV attesa di euro sta piu' in alto
#: (un centrocampista di euro arriva a 6,29 dove uno di Serie A si ferma a 6,26) e una sbarra sola dava
#: 33 boe su default e 91 su euro. `default` = 5,94, chiusa da Douglas Luiz (5,940) - il piu' basso dei
#: suoi due nomi - e non piu' `PASS_MARK`: il sei era il valore di principio e la TAGLIA che lui ha
#: chiesto lo ha spostato («8/12 boe per ogni ruolo»). `euro` = 6,10, scelta sulla taglia sola, perche'
#: li' non ci sono suoi verdetti da riprodurre - e va detto che su euro i ruoli non escono uniformi
#: (i difensori arrivano a 6,16 di MV, quindi ne passa uno): una tabella per RUOLO e' il passo dopo, se
#: la vuole.
BOA_MARK: Mapping[str, float] = {"default": 5.94, "euro": 6.10}

#: «POCHI MALUS», la meta' della prova di `promessa` per un PORTIERE - sua correzione del 23/09/2026:
#: «per i portieri le PROMESSE sono semplicemente quelli che subiscono pochi gol, quindi piuttosto che
#: parlare di "qualche bonus" si parlerebbe di "pochi malus"».
#:
#: E' LA STESSA QUANTITA' DEGLI ALTRI RUOLI (`fm - mv`, il bonus netto a presenza) con l'altro segno
#: atteso, il che e' quello che la rende una correzione e non un'eccezione: per un uomo di movimento
#: quel numero e' cio' che AGGIUNGE, per un portiere cio' che COSTA. La prima stesura aveva tolto la
#: prova invece di cambiarla, e toglierla passava Butez (-1,25 a presenza, cioe' un gol e un quarto a
#: partita) sulla sola media voto.
#:
#: UN PUNTO E' UN GOL, quindi la soglia e' l'unita' del gioco e non un percentile: «meno di un malus a
#: presenza». Sul foglio del 22/09 tiene 6 portieri di 20 (Mandas, Caprile, Svilar, Maignan, Palmisani,
#: Vicario) e ne lascia fuori 14 - a -0,5 ne terrebbe 2 e a -1,5 ne terrebbe 9, quindi la banda e' larga
#: e il valore e' scelto sull'unita' e non sul conteggio.
#:
#: E NON E' ESATTAMENTE «I GOL SUBITI», che e' come lui l'ha detta prima di correggersi: misurato, il
#: malus netto discorda dal tasso di gol subiti su **4 portieri di 20** - Mandas ne prende 0,60 a
#: partita e legge 0,00, perche' ha parato un rigore. La differenza e' un merito suo, e il MALUS e'
#: comunque la quantita' che la rosa paga, cioe' quella su cui si decide un acquisto.
KEEPER_MALUS = -1.0

#: The blend constant PER ROLE for the level, measured leave-one-season-out on ten Serie A seasons.
#: See the module docstring for the table and the mechanism. `k/(k+K)` is the weight of the matchdays
#: already played, the same shape R25 uses in the engine.
#:
#: L'ATTACCANTE E' L'UNICO CHE NON STA SUL SUO OTTIMO DI PREVISIONE, ed e' una DICHIARAZIONE
#: dell'operatore (24/09/2026) messa davanti al prezzo misurato. Le sue quattro frasi di quel giorno
#: sono la stessa frase detta con nomi opposti: «Simeone e' un SEMITOP perche' ha molte presenze
#: previste e una ottima FM dell'anno scorso» (storico 7,25, cinque giornate a 5,70, leggeva
#: `operaio`) e «Maldini e' una PROMESSA perche' ha una FM dello scorso anno troppo bassa per essere
#: un SEMITOP» (storico 6,39, cinque giornate a 8,40, leggeva `semi`). A K = 18,5 le prime cinque
#: giornate pesano il 21% del livello di un attaccante, che basta a scavalcare quaranta centesimi di
#: storico - e i suoi quattro verdetti (piu' quello su Davis K. e quello su Esposito F.P.) sono
#: **SIMULTANEAMENTE IMPOSSIBILI**: misurata la finestra in cui esistono due sbarre che li
#: soddisfano tutti, e' `w` fra 0,075 e 0,125, mentre 0,213 non ne ammette nessuna (ne' su `semi`
#: ne' su `top`). 45 e' il centro di quella finestra, cioe' `w` = 0,10 a cinque giornate.
#:
#: IL PREZZO E' MISURATO E VA CITATO CON LA SUA DIREZIONE (stessa misura del docstring, riprodotta
#: prima di toccare il numero - P +6,8% · D +2,7% · C +1,8% · A +6,0%, che sono i valori pubblicati):
#: sul bersaglio «la fantamedia delle giornate DOPO la quinta», l'attaccante passa da **+6,0% a
#: +4,4%** di guadagno sulla sola stagione scorsa, cioe' MAE 0,5920 -> 0,6019. Un centesimo su una
#: dispersione di 0,63, e **10 stagioni su 10 restano migliori del baseline** in tutt'e due i casi.
#: La curva e' piatta fra 20 e 60 (0,5921 - 0,6065), quindi la direzione e' il risultato e i decimali
#: no - e' la stessa forma con cui questo modulo sceglie ogni sua sbarra.
#:
#: E LA RAGIONE PER CUI NON E' UN CAPRICCIO: la K e' misurata per PREVEDERE una fantamedia, mentre la
#: parola deve dire CHE GIOCATORE E'. Quello che sta facendo adesso ha gia' la sua parola - `promessa`
#: - quindi al peso vecchio la stagione in corso entrava DUE VOLTE, nel livello e in `in_form`, ed e'
#: «lo stesso fatto contato due volte» incontrato dentro una scala invece che dentro un canale. Gli
#: altri tre ruoli restano sul loro ottimo: lui ha parlato di attaccanti, e D e C hanno gia' una K
#: alta (35 e 45 all'ottimo). IL PORTIERE HA LA STESSA FORMA (16,6, il 23% a cinque giornate) e non e'
#: stato toccato perche' non ci sono suoi verdetti da riprodurre li': va detto invece di lasciarlo
#: scoprire.
BLEND_K: Mapping[str, float] = {"P": 16.6, "D": 32.6, "C": 43.5, "A": 18.5}

#: ...E LA K CHE L'OPERATORE HA DICHIARATO, che si applica SOLO a chi ha una stagione precedente da
#: pesare. Sta in una tabella sua e non dentro `BLEND_K` perche' sono due cose di natura diversa e la
#: misura deve restare leggibile accanto alla dichiarazione: quella sopra e' l'ottimo fuori campione,
#: questa e' la sua decisione con il prezzo scritto. Una sola riga, perche' una sola ne ha chiesta.
DECLARED_K: Mapping[str, float] = {"A": 45.0}

#: (operaio, solido, semitop, top, supertop) of EXPECTED FANTAMEDIA, per PLATFORM and listone role.
#:
#: LA PRIMA E' NATA IL 23/09/2026 PERCHE' `operaio` ERA LA DISCARICA: 233 righe di 562 su Serie A contro
#: 8-22 di ogni altra parola, cioe' l'unica classe senza una sbarra sua - tutto quello che giocava almeno
#: meta' calendario e non arrivava a `solido`. «Le 233 riserve sono troppe, la mia idea era qualcosa tipo
#: 15 circa per ogni ruolo». Le sbarre di D/C/A sono quindi il QUINDICESIMO livello del ruolo, che e' la
#: sua taglia; quello che ne resta sotto e' `boa` se gioca lo stesso, `scarto` altrimenti.
#:
#: E IL PORTIERE E' IL CASO IN CUI UNA SBARRA DI LIVELLO NON SEPARA, che va detto invece di forzarlo:
#: sopra `scarto` ce ne sono **11 su default e 13 su euro** - quindici non esistono, perche' il terzo
#: portiere di ogni club sta sotto - e i suoi `boa` hanno livelli INTERLACCIATI con le riserve (De Gea
#: gioca lo 0,88 e legge il livello piu' basso di tutti). Per lui l'asse che distingue e' la QUOTA e non
#: il livello, quindi la sua sbarra e' scelta per non svuotare `boa` dei portieri - dichiarato, e con il
#: conteggio accanto: default 3 riserve e 4 boe, euro 2 e 5.
#:
#: PER PLATFORM, and it is not a refinement: the euro sheet's fantamedia sits systematically higher
#: than Serie A's (median forward 7.14 against 6.61, keeper 5.05 against 4.96), because EuroLeghe is a
#: selection of top clubs. One table for both would have made half the euro forwards at least
#: `semi` by construction - «a parameter belongs to the population it was measured on», and the
#: platform is such a population, which this repository has written down for prices, tiers and K.
#:
#: DUE VALORI DI `default` SONO ABBASSATI DI UN CENTESIMO rispetto al percentile, e non e' un
#: ritocco: il percentile trova la ZONA, il CASO DICHIARATO fissa il valore. Svilar (livello 5,329) e'
#: un `super` per sua parola e il p97 arrotondato a 5,33 lo tagliava fuori di un millesimo; Varela
#: (6,878) e' un `solido` e il p77 a 6,88 lo tagliava per due.
#:
#: E LE DUE TABELLE NON SONO MISURATE SULLA STESSA QUANTITA', il che e' corretto e va detto: su
#: `default` sui livelli RI-MISCELATI (R25 e' adottata la', quindi `relevel` lavora), su `euro` sui
#: livelli come sono (R25 non e' adottata, quindi `relevel` restituisce il valore intatto). Le due
#: meta' di ogni confronto vengono dalla stessa quantita'; il giorno in cui il gate adottasse R25 su
#: euro, QUESTA TABELLA VA RIMISURATA - non e' una nota di cortesia, e' la condizione che la tiene in
#: piedi.
#:
#: UNA SBARRA DENTRO UN PLATEAU NON SEPARA NIENTE, e su euro ce ne sono due: 80 portieri su 110 (73%)
#: e 42 attaccanti su 173 portano la STESSA fantamedia attesa, tutti dal core - un fatto sul motore e
#: non su questa scala. Dove il p77 e il p85 cadevano sullo stesso valore la sbarra superiore e'
#: spostata al primo valore STRETTAMENTE maggiore, cosi' quei 42 uomini uguali restano tutti nella
#: stessa parola invece di essere spaccati in due da un arrotondamento. Resta vero, e va saputo, che
#: su euro la categoria di un PORTIERE distingue poco: il motore non li distingue.
#: LA BANDA DELLE PRESENZE DI UNA `scommessa`, sue due dichiarazioni del 23/09/2026: «le presenze
#: attese di una scommessa devono essere > 15» e «gli OPERAI devono avere almeno 25 partite previste».
#: QUOTE E NON CIFRE (la lezione di R20): 26 su 38 e 22,6 su 33 sono lo stesso fatto.
#: IL 26 E NON IL 25 CHE HA DETTO, e la ragione sono i suoi stessi nomi: Diao legge 25,8 ed e' una
#: scommessa dichiarata, quindi con 25 lui, Kean (25,7) ed Esposito F.P. (25,3) sarebbero operai. Il
#: confine cade nel VUOTO che i suoi dodici nomi lasciano fra Diao 25,8 e Davis K. 27,3 - gli esempi
#: sono la specifica, la cifra era un'approssimazione.
BET_FLOOR_SHARE = 15.0 / 38.0
BET_CEILING_SHARE = 26.0 / 38.0

#: LA SESTA SBARRA: «il potenziale e' la fantamedia attesa alta», precisata due volte - «va tarato per
#: ruolo» e «non e' alto in assoluto ma piu' alto rispetto a quel gruppo di calciatori che resta
#: escludendo i top». E' la MEDIANA del gruppo da `solido` in giu', che e' anche la popolazione da cui
#: la parola pesca: un metro solo per la soglia e per l'insieme. Misurata sui fogli del 23/09/2026 e
#: ASSOLUTA come le altre cinque - una sbarra che si muove col foglio fa dire a una parola una cosa
#: diversa ogni settimana.
#: IL PREZZO E' DICHIARATO: sei delle sue sette scommesse stanno fra il 51° e il 96° percentile del
#: ruolo, e la settima - Lang, 6,061, il **1° percentile** degli attaccanti - non la prende nessun
#: pavimento che non prenda mezzo listone: quello e' un caso da `player_rulings.json`.
#: ...E QUELLA DELL'ATTACCANTE E' RIMISURATA IL 24/09/2026 con le cinque del livello e per la stessa
#: ragione: `DECLARED_K` sposta ogni livello di quel ruolo, e una mediana calcolata su una quantita'
#: e confrontata con un'altra non e' una mediana. La nuova cade a 6,549 e il CASO DICHIARATO la fissa
#: appena sotto - Tourè E. legge esattamente 6,549 ed e' una sua scommessa del 24/09, quindi una
#: sbarra che gli cade addosso al millesimo e' la quarta istanza dell'arrotondamento che questo
#: repository ha gia' pagato con Scamacca, Svilar e Varela.
POTENTIAL_BARS: Mapping[str, Mapping[str, float]] = {
    "default": {"P": 4.992, "D": 5.951, "C": 6.151, "A": 6.540},
    "euro": {"P": 5.048, "D": 6.051, "C": 6.441, "A": 7.126},
}

#: LE PAROLE DA CUI `scommessa` PESCA, sua regola: «va bene pescare solo da SOLIDO in giu'». Nata da un
#: caso che la misura gli ha messo davanti: senza il limite scendevano a scommessa anche Calhanoglu e
#: McTominay, che non hanno un «potenziale ottimo proseguimento» - sono forti e giocano poco, che e'
#: un'altra frase, e la scala li tiene gia' fuori da `super` per quella. Il prezzo che ha accettato
#: guardandolo: Esposito F.P. (`top`, 25,3 presenze) resta dov'e'.
BET_FROM = (SOLIDO, OPERAIO, BOA, SCARTO)


def potential_bar(platform: str | None, slot: str | None) -> float | None:
    """La sbarra del potenziale per la sua piattaforma e il suo ruolo di LISTONE, o None."""
    if not slot or not platform:
        return None
    return POTENTIAL_BARS.get(platform, {}).get(slot.upper())


def as_bet(word: str | None, play_share: float | None, level: float | None,
           bar: float | None, history: bool = True) -> str | None:
    """«Partenza non eccezionale ma potenziale ottimo proseguimento» (operatore, 23/09/2026).

    DOPO il gate e non dentro la cascata, per la stessa ragione per cui il gate sta fuori: la parola su
    cui questa regola decide e' quella FINALE - Yildiz e' `solido` solo dopo che l'undici tipo ha detto
    la sua, e la scommessa deve vedere quella. Dentro la cascata leggerebbe una parola che poi cambia.

    E IL PAVIMENTO DEGLI OPERAI E' LA STESSA SOGLIA letta dall'altro lato, cosi' non ci sono due numeri
    per un confine solo: chi non arriva al tetto della banda non e' un `operaio` - quella parola dice
    «gioca sempre e rende il minimo» - quindi scende dove sarebbe senza di lei.

    IL TETTO NON VALE PER CHI NON HA UNO STORICO QUI (24/09/2026, sua scelta fra due forme misurate).
    Tre dei quattro nomi che chiedeva come scommesse - Kolo Muani, Adams A., Tourè E. - sono uomini
    che in Serie A non hanno mai giocato, e il tetto li escludeva tutti perche' il motore ne prevede
    26,7-28,8 presenze su 38 contro le 26 della banda. Il punto e' che quel tetto e' una PROVA SULLE
    SUE PRESENZE, e le presenze di chi non ha giocato qui non sono una misura su di lui: sono una
    previsione, cioe' la cosa stessa su cui si scommette. «Vuoto = ignoto» applicato a un confine
    invece che a una colonna, ed e' lo stesso `history` con cui la cascata gia' decide che sopra
    `solido` non si sale.
    QUELLO CHE RESTA FUORI E' DETTO: Castro S. ha una fantamedia precedente (6,71) e 26,7 presenze,
    quindi il tetto lo tiene `scarto` - lui lo aveva chiesto come scommessa e ha scelto questa forma
    sapendolo, contro l'altra (tetto a 29/38) che lo prendeva e faceva scendere `operaio` da 5
    attaccanti a 1, cioe' svuotava la parola che aveva stretto il giorno prima. La via per lui e' una
    dritta in `player_rulings.json`, non una sbarra.
    """
    if word not in BET_FROM or play_share is None:
        return word
    if play_share <= BET_FLOOR_SHARE:
        return word
    if history and play_share > BET_CEILING_SHARE:
        return word
    if level is not None and bar is not None and level >= bar:
        return SCOMMESSA
    return BOA if word == OPERAIO else word


LEVEL_BARS: Mapping[str, Mapping[str, tuple[float, float, float, float, float]]] = {
    "default": {
        "P": (4.820, 5.07, 5.16, 5.24, 5.32),
        "D": (6.078, 6.11, 6.16, 6.26, 6.35),
        "C": (6.294, 6.35, 6.42, 6.53, 6.71),
        # ...E LE CINQUE DELL'ATTACCANTE SONO RIMISURATE (24/09/2026) perche' la loro QUANTITA' e'
        # cambiata: `BLEND_K["A"]` da 18,5 a 45 sposta ogni livello di quel ruolo, e «le due meta' di
        # ogni confronto vengono dalla stessa quantita'» e' la condizione che tiene in piedi questa
        # tabella. Percentili identici agli altri tre ruoli (63,5 · 77 · 85 · 93,5 · 97 = 6,740 ·
        # 6,861 · 6,907 · 7,074 · 7,180), poi i CASI DICHIARATI fissano il valore, che e' come sono
        # state fissate tutte le sbarre di questo modulo:
        #   `semi`  6,90  fra Maldini 6,790 (che lui vuole `promessa`) e Simeone 6,907 (`semi`)
        #   `top`   7,10  fra Esposito F.P. 7,048 («non puo' essere un top») e Hojlund 7,106 (`top`)
        #   `sup`   7,55  fra Thuram 7,460 (`top`) e Martinez L. 7,712 (`super`) - il p97 sui livelli
        #                 nuovi cade a 7,180 e farebbe tre `super`, quindi qui il caso vince largo
        #   `good`  6,78  sotto Maldini 6,790, che e' l'unico vincolo: senza, lui sarebbe `operaio`
        #   `low`   6,742 il p63,5, nessun nome dichiarato lo tocca
        # Verificato sui 96 attaccanti del foglio del 23/09: **18 verdetti su 18**, cioe' i nove di
        # quel giorno piu' le nove dichiarazioni precedenti (i due `super`, Hojlund e Thuram `top`,
        # Scamacca `semi`, Pinamonti `boa`, Kvernadze e Varela G.), 16 righe mosse su 96.
        "A": (6.742, 6.78, 6.90, 7.10, 7.55),
    },
    "euro": {
        "P": (5.028, 5.048, 5.066, 5.140, 5.186),
        "D": (6.139, 6.163, 6.175, 6.285, 6.399),
        "C": (6.701, 6.708, 6.796, 6.891, 6.987),
        "A": (7.188, 7.424, 7.438, 7.728, 7.932),
    },
}


def bars_for(platform: str | None,
             slot: str | None) -> tuple[float, float, float, float, float] | None:
    """The five bars for a row's PLATFORM and listone role, or None when nothing can be said.

    The LISTONE role and not the mantra slot, unlike the bonus bars the six-word scale used: the level
    is a fantamedia, and a fantamedia is comparable across the twelve codes of one macro-role in a way
    a bonus rate is not (a `dc` and a `dd` bring different bonus and score the same marks). Read
    case-insensitively for the reason the previous version already stated: this repository lowercases
    slots elsewhere, and a caller that normalises must not silently get None.

    A platform with no measured table answers None - and a row with no bars is `scommessa`, which is
    the honest reading: a word measured against nobody is not a word.
    """
    if not slot or not platform:
        return None
    return LEVEL_BARS.get(platform, {}).get(slot.upper())


def relevel(fm_pred: float | None, seen_matches: int | None, seen_fm: float | None,
            role: str | None, sheet_k: float | None, history: bool = True) -> float | None:
    """The expected fantamedia re-blended with this ROLE's K instead of the sheet's single one.

    `fm_pred` already blends the season in progress with `sheet_k` (R25's, forty for every role), so
    the base is recovered before re-blending - undoing exactly what is about to be redone differently,
    which is the only way the two do not count the same matches twice.

    Returns `fm_pred` untouched when there is nothing to re-blend: no matches played yet, no K on the
    sheet (a pre-season sheet, where R25 is inert by construction), or a role with no measured K. That
    is not a fallback that hides a hole - on a pre-season sheet the two blends ARE the same number.

    LA K DICHIARATA VALE SOLO DOVE C'E' UNO STORICO DA PESARE (24/09/2026), e la ragione e' che senza
    di esso la domanda e' un'altra. Con una stagione precedente il peso risponde a «quanto contano
    cinque giornate CONTRO il suo passato», ed e' li' che l'operatore ha deciso il 10% (`DECLARED_K`);
    senza, risponde a «quanto contano cinque giornate CONTRO l'ancora del ruolo», cioe' contro la
    costante «nessuno l'ha mai visto giocare» - e li' quelle cinque giornate sono la SOLA prova che
    esista su di lui, quindi alzarne il prezzo vuol dire dare piu' peso al nulla.
    MISURATO IN TUTT'E DUE I VERSI, perche' la prima stesura aveva la direzione sbagliata: con la K
    dichiarata applicata a tutti, Kvernadze (6,911 -> 6,654) e Varela G. (6,878 -> 6,601) - i due
    `solido` che lui dichiaro' il 22/09 - cadevano in `scommessa`; togliendo del tutto il re-blend
    senza storico leggevano gli stessi due numeri, perche' il livello del foglio quel re-blend ce
    l'ha gia' dentro. Quello che li tiene dove lui li ha messi e' la K MISURATA, che per l'attaccante
    pesa le sue cinque giornate il 21%.
    """
    if fm_pred is None:
        return None
    role_key = (role or "").upper()
    k = (DECLARED_K.get(role_key) if history else None) or BLEND_K.get(role_key)
    if not seen_matches or seen_fm is None or k is None or not sheet_k:
        return fm_pred
    w_sheet = seen_matches / (seen_matches + sheet_k)
    if w_sheet >= 1.0:
        return fm_pred
    base = (fm_pred - w_sheet * seen_fm) / (1 - w_sheet)
    w_role = seen_matches / (seen_matches + k)
    return w_role * seen_fm + (1 - w_role) * base


def has_prospects(vote: float | None, net90: float | None) -> bool:
    """«Ottimi presupposti per fare bene»: un voto sintetico buono E qualche bonus, nell'ultima stagione
    che ha su file - che per questa popolazione e' sempre un altro campionato o una serie inferiore.

    I due numeri sono quelli che `abroad.layer` gia' calcola: `vote` e' la conversione di `synth` sulle
    sue ultime venti partite, `net90` sono i bonus di quella finestra AL NETTO dei cartellini. Quello che
    NON si riusa e' il suo VERDETTO: vedi `PROSPECT_MARK` per la misura che l'ha rifiutato.

    DOVE I CARTELLINI NON SI SANNO (`net90` None) SI RIPIEGA SUI SOLI BONUS, e non e' una svista: la
    seconda prova serve a ESCLUDERE chi si fa sempre ammonire, e per escludere un uomo serve una prova -
    la mancanza di una non lo e'. Stessa regola di `boards._contended` e di `ownsShirt`.

    FALSO E NON IGNOTO QUANDO NON C'E' NIENTE DA LEGGERE, e qui e' il punto della parola: chi non ha
    abbastanza calcio su file perche' quei due numeri esistano non ha «ottimi presupposti», ha un vuoto -
    e la parola per quello e' `incognita`. Sono due fatti diversi e da oggi hanno due parole.
    """
    if vote is None or net90 is None:
        return False
    return vote >= PROSPECT_MARK and net90 > PROSPECT_BONUS


def in_form(mv_seen: float | None, fm_seen: float | None,
            pv_seen: int | None, rounds_seen: int | None,
            role: str | None = None) -> bool:
    """Ha gia' dimostrato, nelle giornate giocate, di avere una buona media voto E qualche bonus.

    Le medie sono le SUE (`Observation.mv_seen` / `fm_seen`, la stessa query che conta `pv_seen`, quindi
    la media e la sua taglia non possono divergere) e il bonus a presenza e' la differenza fra le due.

    FALSO E NON IGNOTO QUANDO NON C'E' NIENTE DA LEGGERE, ed e' l'unico posto di questo modulo in cui
    «vuoto» diventa un no invece di un ignoto: la parola dice «ha GIA' dimostrato», quindi chi non ha
    dimostrato niente non la merita per definizione. Su un foglio di PRE-STAGIONE nessuno e' una
    `promessa`, per costruzione e correttamente - non e' un buco, e' cio' che la parola significa.
    """
    if not pv_seen or mv_seen is None or fm_seen is None:
        return False
    if rounds_seen and pv_seen < FORM_ROUNDS_SHARE * rounds_seen:
        return False
    if mv_seen < FORM_MARK:
        return False
    # PER UN PORTIERE LA PROVA E' «POCHI MALUS» E NON «QUALCHE BONUS» (sua correzione del 23/09/2026).
    # `fm - mv` per lui e' quello che COSTA e non quello che aggiunge, quindi «> 0» non chiede «ha
    # prodotto qualcosa», chiede «non ha mai preso un gol»: misurato sul foglio del 22/09, **0 portieri
    # su 25** che hanno giocato hanno un netto positivo, il migliore sta a -0,40. Senza la correzione
    # `promessa` era VUOTA PER COSTRUZIONE su un ruolo intero - il difetto di `bandiera` e della vecchia
    # `scommessa` - e l'ha trovato il CONTEGGIO PER PAROLA, non una rilettura.
    #
    # La stessa quantita' con l'altro segno atteso, non un'eccezione: vedi `KEEPER_MALUS` per la soglia,
    # per la misura che l'ha scelta e per il perche' il netto non e' esattamente il tasso di gol subiti.
    if (role or "").upper() == "P":
        return (fm_seen - mv_seen) >= KEEPER_MALUS
    return (fm_seen - mv_seen) > FORM_BONUS


def _is_boa(mv: float | None, play_share: float, boa_mark: float | None) -> bool:
    """«Gioca quasi sempre con una media voto dignitosa». Una definizione, due punti nella cascata.

    `boa_mark` e' la sbarra della PIATTAFORMA (`BOA_MARK`); senza, `boa` non si puo' dire - e la riga
    scende al gradino sotto invece di essere giudicata su una sbarra di un'altra popolazione.
    """
    if mv is None or boa_mark is None:
        return False
    return mv >= boa_mark and play_share >= BOA_PLAYS


def category_of(play_share: float | None, level: float | None,
                bars: tuple[float, float, float, float, float] | None,
                history: bool = True, seen: bool = False,
                form: bool = False, prospects: bool = False,
                mv: float | None = None, boa_mark: float | None = None) -> str | None:
    """One of `LADDER`, or None when not even the appearances are known.

    `play_share` is `engine_pv_pred / matchdays`, `level` is `relevel(...)`, `bars` is `bars_for(...)`.

    NO LEVEL IS `scommessa` AND NEVER `scarto`: «vuoto = ignoto, mai zero», met here on a word that
    would otherwise call a nineteen-year-old bad because nobody has priced him yet. The two are
    opposite statements, and he chose the word himself on 22/09/2026 rather than folding them together.

    `grounded` IS THE OTHER HALF OF THAT, and without it the word was empty by construction. The sheet
    gives EVERY row a fantamedia - where the engine cannot price a man, `est_fm` falls back to his
    role's anchor - so a level is never missing and `scommessa` described nobody: measured on the
    2026-27 Serie A sheet, 147 rows sat on the anchor and were handed 103 `scarto`, 31 `operaio`
    and even 7 `solido`, which is a judgement about men nobody has watched. It is the `bandiera` defect
    of 20/08 (a rung empty by construction) met on a word instead of a ladder.

    The caller says whether the level STANDS ON FOOTBALL: the anchor alone does not, but the anchor
    plus matchdays played THIS season does - a man we are watching right now is not an unknown, and
    that is also why 3 of those 147 read `top` legitimately.

    A ROW WITH NO APPEARANCE FORECAST AT ALL GETS NO WORD - the caller owes that distinction, exactly
    as it does for the six-rung ladder next door.

    THE ORDER OF THE TESTS IS THE CASCADE and it is not an implementation detail: his six definitions
    overlap (a man who plays often with a high level satisfies several at once), so «the first rule
    that matches» is what makes them exclusive, and it is the order he dictated them in.
    """
    if play_share is None:
        return None
    if level is None or bars is None or not (history or seen):
        # NESSUNO L'HA PREZZATO, e da oggi la frase si spacca in due (sua condizione del 23/09/2026):
        # `scommessa` se il calcio che ha su file dice qualcosa di buono, `incognita` se non c'e' niente
        # da leggere. Misurato prima di adottarlo: delle 83 righe che leggevano `scommessa` su Serie A,
        # **74 non hanno un solo numero** - 30 sono portieri, che `abroad` esclude per misura, e gli altri
        # stanno sotto i 900 minuti. Chiamarle tutte «ottimi presupposti» sarebbe una promessa falsa su
        # tre quarti di loro, e chiamarle `scarto` sarebbe «vuoto = ignoto» rotto nel modo piu' caro.
        return SCOMMESSA if prospects else INCOGNITA
    low, good, semi, top, sup = bars
    # SENZA STORICO NON SI SALE SOPRA `solido`, sua regola del 22/09/2026 sera: «Osmajic e Romero D.
    # non possono essere SEMITOP perche' hanno uno storico poco definito». I due leggevano 6,996 - il
    # PLATEAU dell'ancora di ruolo, che il motore serve come `core` a confidenza piena quando non ha
    # una fantamedia precedente da regredire - cioe' un numero che non parla di loro, appena sopra la
    # sbarra. Il tetto e' consistente con tutti e quindici i suoi verdetti: i tre uomini senza storico
    # (Kvernadze, Varela, Douglas Luiz) sono `solido` o sotto, e chiunque metta da `semi` in su ce
    # l'ha. NON e' `scommessa`: quelli il calcio di quest'anno ce l'hanno, e si vede.
    if not history:
        # ...E `promessa` E' RAGGIUNGIBILE ANCHE DA QUI, che e' una decisione e non una svista. Il tetto
        # del 22/09 («senza storico non si sale sopra `solido`») esiste perche' il LIVELLO di questi
        # uomini e' l'ancora del ruolo, «un numero che non parla di loro»; `promessa` non legge il
        # livello, legge le partite che ha giocato quest'anno, quindi la ragione del tetto non si
        # applica - e Kvernadze e Varela, i suoi due esempi di `solido`, sono senza storico ED erano i
        # due piu' in forma del foglio. Un tetto che escludesse proprio loro escluderebbe i nomi da cui
        # la parola nasce. `promessa` diventa il loro tetto nuovo, e sopra non si sale lo stesso.
        if play_share < PLAYS_OFTEN:
            return SCARTO
        if level >= good:
            return PROMESSA if form else SOLIDO
        # ...E QUESTO RAMO USA LE STESSE DUE SBARRE DI SOTTO, che e' la cura di un difetto del 23/09:
        # aveva una mini-cascata sua che finiva con `return OPERAIO`, quindi la sbarra nuova non lo
        # toccava e **23 difensori senza storico** entravano in `operaio` col livello sotto la banda -
        # un terzo della classe che lui aveva appena chiesto di stringere. Due cascate per una domanda
        # finiscono per non essere d'accordo, ed e' esattamente cosa era successo.
        if level >= low:
            return OPERAIO
        if _is_boa(mv, play_share, boa_mark):
            return BOA
        return SCARTO
    if level >= sup and play_share >= PLAYS_ALWAYS:
        return SUPER
    # ...off the scale but not playing enough is `top` and not `super`: Calhanoglu is the best
    # midfielder of the listone at 0.60 of the calendar, and the word has to say that he is worth it
    # AND that he will not be there. His ruling, 22/09/2026.
    #
    # `or level >= sup` used to be here and was REDUNDANT - the bars are sorted and a test asserts it,
    # so `level >= sup` implies `level >= top` - and removing it makes the real property visible: this
    # branch has NO appearance floor, so a man off the scale who plays 5% of the calendar reads `top`
    # and never `scarto`. That is Calhanoglu's case taken to its limit.
    #
    # SU QUESTO L'OPERATORE HA DECISO IL 23/09/2026, e il commento che stava qui chiedeva di CONTARE la
    # popolazione prima di mettere un pavimento: contata, erano Cabal (0,303 del calendario, zero
    # presenze su cinque giornate) e Pavard fra i `top` di Serie A. Il pavimento NON fu messo qui,
    # perche' nessuna quota di presenze separava i suoi casi da Calhanoglu: la risposta era `gated`,
    # che cappa la parola quando l'undici tipo non lo schiera.
    #
    # ...E IL 24/09/2026 LUI HA DECISO IL CONTRARIO, guardando il prezzo: «ok va bene se costa
    # Calhanoglu ... un top deve garantire almeno 25 presenze». Cioe' la ragione per cui il pavimento
    # non c'era - che avrebbe portato via il suo stesso nome dichiarato - e' stata messa davanti a lui
    # ed e' stata accettata. La dichiarazione del 22/09 su Calhanoglu `top` e' RITIRATA, con la data,
    # invece di essere lasciata a contraddire il codice. Vedi `TOP_PLAYS` per i quattro che cadono.
    # Il cancello resta dov'e': risponde a un'altra domanda («l'undici lo schiera?») e i due si
    # compongono.
    if level >= top and play_share >= TOP_PLAYS:
        return TOP
    if play_share < PLAYS_OFTEN:
        return SCARTO
    # ...e `semi` VUOLE LE PRESENZE, sua regola dello stesso giorno: «Adams C. non puo' essere un
    # SEMITOP perche' ha troppe poche partite attese» - 0,630 del calendario, con lo storico che ce
    # l'ha (6,67 su 33 presenze), quindi qui il difetto non e' il livello. La sbarra e' `PLAYS_A_LOT`,
    # chiusa fra lui e Scamacca (0,718), e NON `PLAYS_ALWAYS` - vedi la costante per il perche' la
    # prima stesura sbagliava.
    if level >= semi and play_share >= PLAYS_A_LOT:
        return SEMI
    if level >= good:
        return PROMESSA if form else SOLIDO
    # ...E DA QUI IN GIU' `operaio` HA UNA SBARRA SUA (23/09/2026). Prima era il fondo della cascata e
    # raccoglieva 233 righe di 562 - «le 233 riserve sono troppe» - cioe' l'unica parola che non
    # affermava niente: bastava giocare meta' calendario. Adesso dice quello che lui le fa dire, «da
    # schierare come riserva nella propria rosa»: il livello ci sarebbe, il posto nel suo club no.
    if level >= low:
        return OPERAIO
    # ...E `boa` E' RITAGLIATA DA `operaio`, sua parola del 23/09/2026: «gioca quasi sempre con una media
    # voto dignitosa». Sotto la sbarra di `solido` il livello non basta a distinguere nessuno, e questi
    # sono gli uomini che quel posto lo reggono comunque tutte le settimane.
    #
    # LUI L'HA MESSA SOTTO `operaio` E IL DISEGNO SEGUE LUI, ma la misura dice il contrario e va detta: i
    # dieci uomini che cattura sul foglio di Serie A (Falcone, De Gea, Ramos G., Muric, Cristante,
    # Simeone, Obert, Laurientè, Celik, Okoye) giocano lo 0,81-0,90 del calendario, cioe' PIU' della
    # operaio medio, quindi la parola piu' bassa tocca ai titolari piu' continui di quella fascia. E' una
    # sua dichiarazione e si applica come l'ha data - «l'ordine della scala non cede alla misura» - e
    # invertirla e' una riga sola in `LADDER` il giorno in cui lo decide.
    if _is_boa(mv, play_share, boa_mark):
        return BOA
    # IL FONDO E' `scarto`, e la parola cambia quello che promette (sua decisione del 23/09/2026 messa
    # davanti al conteggio): non piu' «non gioca abbastanza» ma «e' misurato, e non vale un posto». I
    # ~210 che scendono qui giocano il 50-80% del calendario, quindi la vecchia frase avrebbe mentito su
    # tutti loro; la nuova e' il significato letterale della parola. Chi non gioca abbastanza ci finisce
    # lo stesso, dal ramo `PLAYS_OFTEN` qui sopra: `scarto` ha due porte e una sola frase, che le copre
    # entrambe.
    return SCARTO


def gated(category: str | None, rung: str | None,
          play_share: float | None) -> str | None:
    """La parola CAPPATA se l'undici tipo non lo schiera. Solo verso il basso, mai verso l'alto.

    REGOLA DELL'OPERATORE, 23/09/2026, su quattro nomi trovati a schermo: «come e' possibile che Cabal
    sia un TOP? ... Pavard ormai non e' piu' titolare ... un TOP deve essere almeno titolare», e poi
    «Kempf non puo' essere SOLIDO, nelle prime giornate non e' stato abbastanza presente» e «anche
    Stones non ha giocato abbastanza in queste prime giornate per essere SOLIDO».

    IL RAMO CHE LI PRODUCEVA ERA GIA' SEGNALATO QUI SOTTO come la domanda aperta su cui lui non aveva
    ancora deciso: `level >= top` non ha nessun pavimento sulle presenze, quindi «fuori scala e non
    gioca» leggeva `top` a qualunque quota - Cabal a 0,303 del calendario, ZERO presenze su cinque
    giornate. Ora ha deciso, e la popolazione che il commento chiedeva di contare e' misurata sotto.

    NON E' UNA SOGLIA NUOVA, ED E' LA META' DEL LAVORO. «Almeno titolare» in prosa non puo' essere il
    GRADINO `titolare`, perche' il suo stesso Calhanoglu e' `top` dichiarato a `ballottaggio`: quello che
    la frase chiede e' che l'undici lo SCHIERI, che e' esattamente `status.CONTENDER_RUNGS` - il metro
    che la scala usa gia' per dire «lo schiera o no», citato invece di inventare un numero, come
    `boards._contended` e `ownsShirt`. Le due quantita' plausibili sono state provate prima e NON
    separano i suoi casi: la quota PREVISTA mette Kempf (0,576) sopra Osmajic (0,533) e Romero D.
    (0,561), e la quota VISTA mette Stones a 3/5 esattamente come Calhanoglu e Adams C. Il gradino li
    separa tutti e quattro senza eccezioni, perche' legge due assi e non uno.

    MISURATO SUL FOGLIO DEL 22/09/2026 prima di adottarlo, che e' la condizione che il modulo si da' da
    se' («i nove verdetti sono la specifica»): Serie A 20 righe di 562 scendono (16 `solido`, 4 `top`),
    euro 19 di 953, e **tutte e dodici le dichiarazioni positive restano in piedi** - i cinque `super`,
    Calhanoglu e Hojlund `top`, Scamacca `semi`, Kvernadze `solido`, Pinamonti e Douglas Luiz `operaio` -
    con gli otto tetti rispettati. Osmajic e Romero D. scendono a `operaio` e non e' una rottura: la sua
    regola del 22/09 su di loro era un TETTO («non possono essere SEMITOP»), non un'affermazione, e
    `operaio` lo rispetta.

    UN GRADINO IGNOTO NON RETROCEDE NESSUNO. Senza display la board non si disegna e `desc_titolarita`
    resta vuota per costruzione, e un club la cui board non e' stata disegnata non ha gradini: li'
    «l'undici non lo schiera» e «non abbiamo guardato» leggerebbero uguale, che e' la cosa che questo
    progetto non fa. Il prezzo va detto: su una macchina senza display la colonna resta quella di prima,
    cioe' non gatata.

    IL FONDO E' LA CASCATA STESSA e non una parola scelta: chi scende prende `scarto` se sta sotto
    `PLAYS_OFTEN` e `operaio` se ci sta sopra, che e' cio' che `category_of` gli avrebbe dato se il suo
    livello non avesse superato nessuna sbarra. `scommessa` non si tocca - non e' un giudizio, e
    retrocederla direbbe «misurato e non gioca» di un uomo che nessuno ha misurato.
    """
    if category is None or not rung:
        return category
    if rung in status.CONTENDER_RUNGS:
        return category
    if category in (OPERAIO, SCOMMESSA, BOA, SCARTO, INCOGNITA):
        return category
    return OPERAIO if play_share is not None and play_share >= PLAYS_OFTEN else SCARTO


def rank_of(category: str | None) -> int | None:
    """Where a word sits in the list, 0 = `super`. None for a row with no word, never a number."""
    if category is None:
        return None
    try:
        return LADDER.index(category)
    except ValueError:
        return None
