/**
 * CERCARE UN NOME COME LO SI SENTE, non come e' scritto.
 *
 * Richiesta dell'operatore (05/09/2026): «case insensitive, cercare i match anche all'interno e non solo
 * all'inizio, deve essere "intelligente" - deve acchiappare anche lettere accentate o caratteri strani,
 * i al posto della j o delle y, c al posto delle k o k invece che ck o ch». E' la stessa situazione del
 * tavolo: un nome si sente dire ad alta voce e si digita come suona, quindi «Hojlund» va trovato
 * scrivendo «oilund» e «Kean» scrivendo «cean».
 *
 * IL TRUCCO E' UNA SOLA CHIAVE, applicata AI DUE LATI. Non e' una distanza fra stringhe e non e' un
 * punteggio: e' una normalizzazione, quindi «contiene» resta un `includes` - deterministico, senza
 * soglie da tarare e senza il rischio di far comparire un nome che non c'entra. Una ricerca che indovina
 * e' una ricerca di cui non ci si puo' fidare a un'asta.
 *
 * LE REGOLE, e l'ORDINE conta:
 *  1. accenti via (NFD e poi i segni combinanti), minuscolo, e i legamenti che il tedesco scrive
 *     attaccati (`ß` -> `ss`, `ø` -> `o`, `đ` -> `d`), che nessuna decomposizione scioglie;
 *  2. `ck` e `ch` diventano `c` PRIMA che `k` diventi `c`, o `ck` finirebbe `cc`;
 *  3. `k` -> `c`, `j` e `y` -> `i`, `w` -> `v`, `x` -> `s`;
 *  4. la `h` rimasta sparisce: in italiano non si sente, ed e' quella che fa scrivere «Ojlund»;
 *  5. le doppie diventano singole, che e' l'errore piu' comune di chi scrive un cognome sentito;
 *  6. tutto quello che non e' una lettera o una cifra diventa uno spazio, e gli spazi si stringono.
 *
 * Quello che NON fa: non toglie le vocali, non accorcia e non fa metafone. Ogni regola in piu' aumenta
 * i falsi positivi, e in una lista di duecentocinquanta nomi un falso positivo costa piu' di un nome da
 * riscrivere.
 */

/** Le lettere che una decomposizione Unicode non scioglie: si dichiarano invece di sperarci. */
const LIGATURES: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 't',
  ł: 'l',
  ı: 'i',
};

export function looseKey(text: string | null | undefined): string {
  let out = (text ?? '')
    .normalize('NFD')
    // I segni combinanti: e' quello che toglie gli accenti da tutt'e due i lati.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  out = out.replace(/[ßæœøđðþłı]/g, (one) => LIGATURES[one] ?? one);
  // `ck` e `ch` PRIMA di `k`, o `ck` diventerebbe `cc` e poi `c` per un'altra strada.
  out = out.replace(/ck|ch/g, 'c');
  out = out.replace(/k/g, 'c').replace(/[jy]/g, 'i').replace(/w/g, 'v').replace(/x/g, 's');
  // La `h` che resta non si sente: `Hojlund` e `Ojlund` sono lo stesso nome detto ad alta voce.
  out = out.replace(/h/g, '');
  // Le doppie: chi scrive un cognome sentito le sbaglia, e sbagliarle nei due sensi costa un nome.
  out = out.replace(/(.)\1+/g, '$1');
  // Punti, apostrofi e trattini diventano spazio: `Esposito F.P.` resta due parole e non una.
  out = out.replace(/[^a-z0-9]+/g, ' ').trim();
  return out;
}

/**
 * Il testo cercato compare da qualche parte in uno dei campi? Vuoto = nessun filtro, quindi tutti.
 *
 * DENTRO e non in testa (sua richiesta): al tavolo si sente la seconda meta' di un cognome, e una
 * ricerca ancorata all'inizio non la trova.
 */
export function looseMatch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const wanted = looseKey(query);
  if (!wanted) return true;
  return fields.some((field) => looseKey(field).includes(wanted));
}
