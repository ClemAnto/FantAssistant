import { looseKey, looseMatch } from './loose-search';

describe('looseKey', () => {
  it('gli accenti spariscono da tutt\'e due i lati', () => {
    expect(looseKey('Pérez')).toBe(looseKey('Perez'));
    expect(looseKey('Højlund')).toBe(looseKey('Hojlund'));
  });

  it('la J e la Y diventano I: «Hojlund» si scrive «oilund»', () => {
    expect(looseKey('Hojlund')).toBe('oilund');
    expect(looseKey('Yildiz')).toBe('ildiz');
    expect(looseKey('Dybala')).toBe('dibala');
  });

  it('K, CK e CH diventano C - e l\'ordine conta, o «ck» finirebbe «cc»', () => {
    expect(looseKey('Kean')).toBe('cean');
    expect(looseKey('Lukaku')).toBe('lucacu');
    expect(looseKey('Mkhitaryan')).toBe('mcitarian');
    // `ck` -> `c` e non `cc`: se la sostituzione della K venisse per prima, questa sarebbe «locateli».
    expect(looseKey('Lockatelli')).toBe(looseKey('Locatelli'));
  });

  it('le doppie valgono una sola: è l\'errore di chi scrive un cognome sentito', () => {
    expect(looseKey('Zaccagni')).toBe('zacagni');
    expect(looseKey('Buongiorno')).toBe(looseKey('Buongiornno'));
  });

  it('punti, apostrofi e trattini diventano spazio, e gli spazi si stringono', () => {
    expect(looseKey('  Esposito  F.P. ')).toBe('esposito f p');
    expect(looseKey("N'Dicka")).toBe('n dica');
  });

  it('un testo vuoto resta vuoto e non diventa uno spazio', () => {
    expect(looseKey('')).toBe('');
    expect(looseKey(null)).toBe('');
  });
});

describe('looseMatch', () => {
  it('trova DENTRO e non solo in testa: al tavolo si sente la seconda metà di un cognome', () => {
    expect(looseMatch('lund', 'Hojlund', 'Napoli')).toBe(true);
    expect(looseMatch('poli', 'Hojlund', 'Napoli')).toBe(true);
  });

  it('cerca nel nome E nel club, e basta uno dei due', () => {
    expect(looseMatch('juve', 'Yildiz', 'Juventus')).toBe(true);
    expect(looseMatch('ildiz', 'Yildiz', 'Juventus')).toBe(true);
    expect(looseMatch('inter', 'Yildiz', 'Juventus')).toBe(false);
  });

  it('è la STESSA chiave sui due lati: si scrive come suona e si trova comunque', () => {
    expect(looseMatch('kean', 'Kean', 'Como')).toBe(true);
    expect(looseMatch('cean', 'Kean', 'Como')).toBe(true);
    expect(looseMatch('oilund', 'Hojlund', 'Napoli')).toBe(true);
  });

  it('una ricerca vuota non è un filtro: tiene tutti', () => {
    expect(looseMatch('', 'Chiunque', 'Club')).toBe(true);
    expect(looseMatch('   ', 'Chiunque', 'Club')).toBe(true);
  });

  it('...e non indovina: quello che non c\'entra resta fuori', () => {
    expect(looseMatch('lautaro', 'Hojlund', 'Napoli')).toBe(false);
  });
});
