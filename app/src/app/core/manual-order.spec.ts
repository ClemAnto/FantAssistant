import { orderedBy, withRowAt } from './manual-order';

describe('orderedBy', () => {
  const men = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const idOf = (man: { id: number }) => man.id;

  it('senza un ordine suo la lista è quella che arriva, e non si copia niente di più', () => {
    const out = orderedBy(men, idOf, []);
    expect(out.men.map(idOf)).toEqual([1, 2, 3, 4]);
    expect(out.pinned).toBe(0);
  });

  it('i suoi nomi vanno in cima nel SUO ordine, gli altri restano nel loro', () => {
    const out = orderedBy(men, idOf, [3, 1]);
    expect(out.men.map(idOf)).toEqual([3, 1, 2, 4]);
    expect(out.pinned).toBe(2);
  });

  it('un nome che questa lista non ha più è ignorato, non è un buco', () => {
    const out = orderedBy(men, idOf, [99, 4, 99]);
    expect(out.men.map(idOf)).toEqual([4, 1, 2, 3]);
    expect(out.pinned).toBe(1);
  });
});

describe('withRowAt', () => {
  const shown = [10, 20, 30, 40, 50];

  it('portare un nome in cima sistema quel nome e nessun altro', () => {
    expect(withRowAt([], shown, 30, 0)).toEqual([30]);
  });

  it('lasciarlo dove sta non scrive niente', () => {
    expect(withRowAt([], shown, 30, 2)).toBeNull();
  });

  it("l'indice è quello di CDK: la posizione FINALE sulla lista senza di lui", () => {
    // 30 all'indice 3 = dopo 40, cioè fra 40 e 50.
    expect(withRowAt([], shown, 30, 3)).toEqual([10, 20, 40, 30]);
  });

  it('...e in coda ci si arriva', () => {
    expect(withRowAt([], shown, 10, 4)).toEqual([20, 30, 40, 50, 10]);
  });

  it("un nome preso dalla parte a gain non butta fuori dall'ordine chi era già sistemato", () => {
    // Sistemati [10, 20, 30]; 40 arriva dalla parte a gain e va al secondo posto: il prefisso deve
    // contenere tutt'e quattro, o 30 tornerebbe a farsi ordinare dal gain.
    expect(withRowAt([10, 20, 30], shown, 40, 1)).toEqual([10, 40, 20, 30]);
  });

  it("e un nome già suo spostato in basso porta nell'ordine tutto quello che gli sta sopra", () => {
    expect(withRowAt([10, 20], shown, 10, 3)).toEqual([20, 30, 40, 10]);
  });

  it('un nome che non è nella lista disegnata non muove niente', () => {
    expect(withRowAt([], shown, 99, 0)).toBeNull();
  });
});
