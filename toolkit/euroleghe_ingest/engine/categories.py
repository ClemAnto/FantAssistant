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
dopo, dove il gradino esiste: nessuna parola sopra `riserva` si da' a un uomo che l'undici tipo non
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

The mechanism is in the error itself: a forward's fantamedia is volatile (0.63 of MAE against a
defender's 0.28), so last season's signal is weaker and the new matches matter more. WITHOUT THIS the
scale cannot tell `solido` from `riserva`: Varela and Pinamonti have the same expected fantamedia
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
#: sotto `riserva` e sopra di lei - un uomo che gioca tutte le settimane vale piu' di uno che nessuno
#: ha ancora prezzato. La misura lo diceva gia' e la dichiarazione l'ha raggiunta: i nove uomini che
#: cattura giocano lo 0,81-0,90 del calendario, cioe' piu' della riserva media.
LADDER: tuple[str, ...] = (
    "super", "top", "semi", "promessa", "solido", "riserva", "boa", "scommessa", "scarto", "incognita")

#: Le stesse sette parole per NOME, cosi' la cascata non si scrive con gli indici: riordinarle - e lui
#: l'ha gia' fatto una volta, spostando `scommessa` sopra `scarto` - rinumerava ogni `LADDER[n]` e il
#: compilatore non avrebbe detto niente. Con i nomi un riordino non puo' cambiare quale parola torna.
SUPER, TOP, SEMI, PROMESSA, SOLIDO, RISERVA, BOA, SCOMMESSA, SCARTO, INCOGNITA = LADDER

#: «gioca sempre», the gate of `super`. DECLARED from two of his own cases and not fitted: De Bruyne
#: at 0.70 is OUT («e' fragile e non puo' darti tante presenze») and Martinez at 0.74 is IN, so the bar
#: is between them. It is deliberately stricter than the 0.70 the six-word scale used.
PLAYS_ALWAYS = 0.72

#: «gioca spesso», the floor under which a man is a `scarto` whatever his level. His decision of
#: 22/09/2026, taken to let Varela (0.54) be a `solido`: half the calendar.
PLAYS_OFTEN = 0.50

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
#: 0,72 il 23/09/2026, chiuso dai suoi due `riserva` dichiarati: Pinamonti gioca lo 0,721 e Douglas Luiz
#: lo 0,742, e la loro promessa di ieri - «gioca, ed e' per quello che lo compri» - e' parola per parola
#: quello che `boa` dice oggi. A 0,80 restavano fuori tutti e due e finivano in `scarto`: la sbarra e'
#: fissata dai suoi nomi, che e' come sono state fissate tutte le altre di questo modulo.
BOA_PLAYS = 0.72

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
BLEND_K: Mapping[str, float] = {"P": 16.6, "D": 32.6, "C": 43.5, "A": 18.5}

#: (riserva, solido, semitop, top, supertop) of EXPECTED FANTAMEDIA, per PLATFORM and listone role.
#:
#: LA PRIMA E' NATA IL 23/09/2026 PERCHE' `riserva` ERA LA DISCARICA: 233 righe di 562 su Serie A contro
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
LEVEL_BARS: Mapping[str, Mapping[str, tuple[float, float, float, float, float]]] = {
    "default": {
        "P": (4.820, 5.07, 5.16, 5.24, 5.32),
        "D": (6.078, 6.11, 6.16, 6.26, 6.35),
        "C": (6.294, 6.35, 6.42, 6.53, 6.71),
        "A": (6.698, 6.87, 6.97, 7.09, 7.61),
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
            role: str | None, sheet_k: float | None) -> float | None:
    """The expected fantamedia re-blended with this ROLE's K instead of the sheet's single one.

    `fm_pred` already blends the season in progress with `sheet_k` (R25's, forty for every role), so
    the base is recovered before re-blending - undoing exactly what is about to be redone differently,
    which is the only way the two do not count the same matches twice.

    Returns `fm_pred` untouched when there is nothing to re-blend: no matches played yet, no K on the
    sheet (a pre-season sheet, where R25 is inert by construction), or a role with no measured K. That
    is not a fallback that hides a hole - on a pre-season sheet the two blends ARE the same number.
    """
    if fm_pred is None:
        return None
    k = BLEND_K.get((role or "").upper())
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
    2026-27 Serie A sheet, 147 rows sat on the anchor and were handed 103 `scarto`, 31 `riserva`
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
        # aveva una mini-cascata sua che finiva con `return RISERVA`, quindi la sbarra nuova non lo
        # toccava e **23 difensori senza storico** entravano in `riserva` col livello sotto la banda -
        # un terzo della classe che lui aveva appena chiesto di stringere. Due cascate per una domanda
        # finiscono per non essere d'accordo, ed e' esattamente cosa era successo.
        if level >= low:
            return RISERVA
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
    # presenze su cinque giornate) e Pavard fra i `top` di Serie A. Il pavimento NON e' stato messo qui,
    # perche' nessuna quota di presenze separa i suoi casi da Calhanoglu: la risposta e' `gated`, che
    # cappa la parola quando l'undici tipo non lo schiera. Questo ramo resta senza pavimento apposta -
    # il livello e' quello che dice, e a dire «non gioca» e' il cancello.
    if level >= top:
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
    # ...E DA QUI IN GIU' `riserva` HA UNA SBARRA SUA (23/09/2026). Prima era il fondo della cascata e
    # raccoglieva 233 righe di 562 - «le 233 riserve sono troppe» - cioe' l'unica parola che non
    # affermava niente: bastava giocare meta' calendario. Adesso dice quello che lui le fa dire, «da
    # schierare come riserva nella propria rosa»: il livello ci sarebbe, il posto nel suo club no.
    if level >= low:
        return RISERVA
    # ...E `boa` E' RITAGLIATA DA `riserva`, sua parola del 23/09/2026: «gioca quasi sempre con una media
    # voto dignitosa». Sotto la sbarra di `solido` il livello non basta a distinguere nessuno, e questi
    # sono gli uomini che quel posto lo reggono comunque tutte le settimane.
    #
    # LUI L'HA MESSA SOTTO `riserva` E IL DISEGNO SEGUE LUI, ma la misura dice il contrario e va detta: i
    # dieci uomini che cattura sul foglio di Serie A (Falcone, De Gea, Ramos G., Muric, Cristante,
    # Simeone, Obert, Laurientè, Celik, Okoye) giocano lo 0,81-0,90 del calendario, cioe' PIU' della
    # riserva media, quindi la parola piu' bassa tocca ai titolari piu' continui di quella fascia. E' una
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
    Calhanoglu e Hojlund `top`, Scamacca `semi`, Kvernadze `solido`, Pinamonti e Douglas Luiz `riserva` -
    con gli otto tetti rispettati. Osmajic e Romero D. scendono a `riserva` e non e' una rottura: la sua
    regola del 22/09 su di loro era un TETTO («non possono essere SEMITOP»), non un'affermazione, e
    `riserva` lo rispetta.

    UN GRADINO IGNOTO NON RETROCEDE NESSUNO. Senza display la board non si disegna e `desc_titolarita`
    resta vuota per costruzione, e un club la cui board non e' stata disegnata non ha gradini: li'
    «l'undici non lo schiera» e «non abbiamo guardato» leggerebbero uguale, che e' la cosa che questo
    progetto non fa. Il prezzo va detto: su una macchina senza display la colonna resta quella di prima,
    cioe' non gatata.

    IL FONDO E' LA CASCATA STESSA e non una parola scelta: chi scende prende `scarto` se sta sotto
    `PLAYS_OFTEN` e `riserva` se ci sta sopra, che e' cio' che `category_of` gli avrebbe dato se il suo
    livello non avesse superato nessuna sbarra. `scommessa` non si tocca - non e' un giudizio, e
    retrocederla direbbe «misurato e non gioca» di un uomo che nessuno ha misurato.
    """
    if category is None or not rung:
        return category
    if rung in status.CONTENDER_RUNGS:
        return category
    if category in (RISERVA, SCOMMESSA, BOA, SCARTO, INCOGNITA):
        return category
    return RISERVA if play_share is not None and play_share >= PLAYS_OFTEN else SCARTO


def rank_of(category: str | None) -> int | None:
    """Where a word sits in the list, 0 = `super`. None for a row with no word, never a number."""
    if category is None:
        return None
    try:
        return LADDER.index(category)
    except ValueError:
        return None
