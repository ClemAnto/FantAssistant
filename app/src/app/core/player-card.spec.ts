import { CardStack, cardLeft, cardTop } from './player-card';

describe('CardStack', () => {
  it('la prima card prende il posto zero e sta davanti', () => {
    const stack = new CardStack();
    stack.openCard(7);
    expect(stack.ids()).toEqual([{ id: 7, slot: 0 }]);
    expect(stack.front()).toBe(7);
  });

  it('CHIUDERE NON SPOSTA NESSUNO, e la prossima riempie il buco', () => {
    // È la richiesta dell'operatore del 04/09/2026: con la posizione letta dall'indice, chiudere la
    // prima faceva scalare tutte le altre - e una card che si sposta da sé rompe il confronto.
    const stack = new CardStack();
    stack.openCard(1);
    stack.openCard(2);
    stack.openCard(3);
    stack.closeCard(2);
    expect(stack.ids()).toEqual([
      { id: 1, slot: 0 },
      { id: 3, slot: 2 },
    ]);
    stack.openCard(4);
    expect(stack.ids().find((one) => one.id === 4)?.slot).toBe(1);
  });

  it('ri-cliccare un uomo già aperto non fa un doppione e non gli cambia posto: lo porta davanti', () => {
    const stack = new CardStack();
    stack.openCard(1);
    stack.openCard(2);
    stack.openCard(1);
    expect(stack.ids()).toEqual([
      { id: 1, slot: 0 },
      { id: 2, slot: 1 },
    ]);
    expect(stack.front()).toBe(1);
  });

  it('chi sta davanti è un\'ALTRA domanda dall\'ordine di apertura, e portarne una avanti non muove niente', () => {
    const stack = new CardStack();
    stack.openCard(1);
    stack.openCard(2);
    stack.raiseCard(1);
    expect(stack.front()).toBe(1);
    expect(stack.ids().map((one) => one.slot)).toEqual([0, 1]);
  });

  it('chiudere quella davanti lascia la pila senza nessuno davanti, e non ne elegge un\'altra', () => {
    const stack = new CardStack();
    stack.openCard(1);
    stack.openCard(2);
    stack.closeCard(2);
    expect(stack.front()).toBeNull();
  });

  it('`null` chiude tutto', () => {
    const stack = new CardStack();
    stack.openCard(1);
    stack.openCard(2);
    stack.openCard(null);
    expect(stack.count()).toBe(0);
    expect(stack.front()).toBeNull();
  });

  it('chi non è più in mappa esce da sé invece di mostrare i numeri di dieci minuti prima', () => {
    const stack = new CardStack();
    stack.openCard(1);
    stack.openCard(2);
    const live = new Map([[2, 'vivo']]);
    expect(stack.place((id) => live.get(id))).toEqual([{ man: 'vivo', slot: 1 }]);
  });
});

describe('dove nasce una card', () => {
  it('quattro per riga e poi si scende: affiancate, non a cascata', () => {
    expect([0, 1, 2, 3].map(cardLeft)).toEqual([16, 316, 616, 916]);
    expect([0, 1, 2, 3].map(cardTop)).toEqual([96, 96, 96, 96]);
    expect(cardLeft(4)).toBe(16);
    expect(cardTop(4)).toBe(140);
  });
});
