import {
  CARD_WIDTH,
  CLUB_CARD_WIDTH,
  CardStack,
  cardLeft,
  cardTop,
  clubCard,
  clubCardLeft,
  clubCardTop,
  clubOfCard,
  playerCard,
  playerOfCard,
} from './player-card';

describe('CardStack', () => {
  it('la prima card prende il posto zero e sta davanti', () => {
    const stack = new CardStack();
    stack.openCard(playerCard(7));
    expect(stack.cards()).toEqual([{ key: 'p7', slot: 0 }]);
    expect(stack.front()).toBe('p7');
  });

  it('CHIUDERE NON SPOSTA NESSUNO, e la prossima riempie il buco', () => {
    // È la richiesta dell'operatore del 04/09/2026: con la posizione letta dall'indice, chiudere la
    // prima faceva scalare tutte le altre - e una card che si sposta da sé rompe il confronto.
    const stack = new CardStack();
    stack.openCard(playerCard(1));
    stack.openCard(playerCard(2));
    stack.openCard(playerCard(3));
    stack.closeCard(playerCard(2));
    expect(stack.cards()).toEqual([
      { key: 'p1', slot: 0 },
      { key: 'p3', slot: 2 },
    ]);
    stack.openCard(playerCard(4));
    expect(stack.cards().find((one) => one.key === 'p4')?.slot).toBe(1);
  });

  it('ri-cliccare un uomo già aperto non fa un doppione e non gli cambia posto: lo porta davanti', () => {
    const stack = new CardStack();
    stack.openCard(playerCard(1));
    stack.openCard(playerCard(2));
    stack.openCard(playerCard(1));
    expect(stack.cards()).toEqual([
      { key: 'p1', slot: 0 },
      { key: 'p2', slot: 1 },
    ]);
    expect(stack.front()).toBe('p1');
  });

  it('chi sta davanti è un\'ALTRA domanda dall\'ordine di apertura, e portarne una avanti non muove niente', () => {
    const stack = new CardStack();
    stack.openCard(playerCard(1));
    stack.openCard(playerCard(2));
    stack.raiseCard(playerCard(1));
    expect(stack.front()).toBe('p1');
    expect(stack.cards().map((one) => one.slot)).toEqual([0, 1]);
  });

  it('chiudere quella davanti lascia la pila senza nessuno davanti, e non ne elegge un\'altra', () => {
    const stack = new CardStack();
    stack.openCard(playerCard(1));
    stack.openCard(playerCard(2));
    stack.closeCard(playerCard(2));
    expect(stack.front()).toBeNull();
  });

  it('`null` chiude tutto', () => {
    const stack = new CardStack();
    stack.openCard(playerCard(1));
    stack.openCard(playerCard(2));
    stack.openCard(null);
    expect(stack.count()).toBe(0);
    expect(stack.front()).toBeNull();
  });

  it('chi non è più in mappa esce da sé invece di mostrare i numeri di dieci minuti prima', () => {
    const stack = new CardStack();
    stack.openCard(playerCard(1));
    stack.openCard(playerCard(2));
    const live = new Map([['p2', 'vivo']]);
    expect(stack.place((key) => live.get(key))).toEqual([
      { man: 'vivo', slot: 1, key: 'p2' },
    ]);
  });

  it('LE DUE SPECIE STANNO IN UNA PILA SOLA, e non si prendono mai lo stesso posto', () => {
    // Con due pile, la card di un club e quella del calciatore da cui e' stata aperta prenderebbero
    // tutt'e due il posto zero - cioe' la seconda nascerebbe esattamente sopra la prima - e sarebbero
    // due «davanti» contemporanei: una card toccata che non passa davanti alle altre.
    const stack = new CardStack();
    stack.openCard(playerCard(7));
    stack.openCard(clubCard('default', 'Napoli'));
    expect(stack.cards()).toEqual([
      { key: 'p7', slot: 0 },
      { key: 'cdefault|Napoli', slot: 1 },
    ]);
    expect(stack.front()).toBe('cdefault|Napoli');
  });
});

describe('la chiave di una card', () => {
  it("dice di che specie e', e l'altra risponde null invece di indovinare", () => {
    expect(playerOfCard(playerCard(42))).toBe(42);
    expect(clubOfCard(playerCard(42))).toBeNull();
    expect(clubOfCard(clubCard('euro', 'Bayern Monaco'))).toEqual({
      platform: 'euro', club: 'Bayern Monaco',
    });
    expect(playerOfCard(clubCard('euro', 'Bayern Monaco'))).toBeNull();
  });

  it("porta la PIATTAFORMA, perche' lo stesso club ha due board", () => {
    // I due listoni sono due domande: una chiave che lasciasse fuori la piattaforma mostrerebbe
    // l'undici dell'altro listone sotto lo stesso nome.
    expect(clubCard('default', 'Juventus')).not.toBe(clubCard('euro', 'Juventus'));
  });

  it('regge un nome di club con uno spazio e un punto', () => {
    expect(clubOfCard(clubCard('default', 'Hellas Verona'))?.club).toBe('Hellas Verona');
  });
});

describe('dove nasce una card', () => {
  it('quattro per riga e poi si scende: affiancate, non a cascata', () => {
    expect([0, 1, 2, 3].map(cardLeft)).toEqual([16, 348, 680, 1012]);
    expect([0, 1, 2, 3].map(cardTop)).toEqual([96, 96, 96, 96]);
    expect(cardLeft(4)).toBe(16);
    expect(cardTop(4)).toBe(140);
  });

  it('il passo viene dalla larghezza della card e non da un numero scritto a mano', () => {
    // Due numeri per una cosa sola si scoprono diversi quando due card cominciano a coprirsi, che è
    // tardi: il passo è la larghezza più l'aria, e questo lo asserisce invece di sperarci.
    expect(cardLeft(1) - cardLeft(0)).toBe(CARD_WIDTH + 12);
    // Quattro card devono entrare nella finestra su cui i banchi misurano (1600px).
    expect(cardLeft(3) + CARD_WIDTH).toBeLessThan(1600);
  });
});

describe('dove nasce una card di CLUB', () => {
  it('non cade MAI su una casella della griglia dei calciatori', () => {
    // Una card di club che nascesse sopra la card dell'uomo da cui e' stata aperta si leggerebbe come
    // una card sparita. Le x dei calciatori sono 16/348/680/1012 e le loro y 96/140/184.
    const playerLefts = new Set([0, 1, 2, 3, 4, 5].map(cardLeft));
    const playerTops = new Set([0, 1, 2, 3, 4, 5, 8, 12].map(cardTop));
    for (let slot = 0; slot < 12; slot++) {
      expect(playerLefts.has(clubCardLeft(slot)) && playerTops.has(clubCardTop(slot))).toBe(false);
    }
  });

  it('la prima nasce a destra della prima colonna di calciatori e ci sta nella finestra', () => {
    expect(clubCardLeft(0)).toBeGreaterThan(cardLeft(0) + CARD_WIDTH);
    for (let slot = 0; slot < 4; slot++) {
      expect(clubCardLeft(slot) + CLUB_CARD_WIDTH).toBeLessThan(1600);
    }
  });

  it("e' larga abbastanza da non tagliare una riga da cinque", () => {
    // Una riga del modulo ne mette fino a cinque: a `CARD_WIDTH` ogni casella avrebbe ~52px e i nomi
    // sarebbero ASSENTI, non stretti. Qui ne ha ~96, come nella colonna della vista Squadre.
    expect(CLUB_CARD_WIDTH).toBeGreaterThan(CARD_WIDTH);
    expect((CLUB_CARD_WIDTH - 32) / 5).toBeGreaterThan(90);
  });
});
