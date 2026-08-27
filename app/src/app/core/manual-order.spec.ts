import { orderedBy, rowGapAt, withRowMoved } from './manual-order';

const rows = (count: number, height = 20) =>
  Array.from({ length: count }, (_, at) => ({ top: at * height, bottom: (at + 1) * height }));

describe('rowGapAt', () => {
  it('conta le mezzerie e non i bordi, e un varco esiste sempre', () => {
    const list = rows(3); // 0-20, 20-40, 40-60
    expect(rowGapAt(list, 5)).toBe(0); // sopra la mezzeria della prima
    expect(rowGapAt(list, 15)).toBe(1); // sotto la sua mezzeria: dopo la prima
    expect(rowGapAt(list, 45)).toBe(2);
    expect(rowGapAt(list, 55)).toBe(3); // sotto l'ultima: il varco in coda esiste
    expect(rowGapAt(list, -100)).toBe(0); // fuori dalla lista, sopra tutte
    expect(rowGapAt(list, 9999)).toBe(3);
  });

  it('...e su una lista vuota non ha niente da cui uscire', () => {
    expect(rowGapAt([], 10)).toBe(0);
  });
});

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

describe('withRowMoved', () => {
  const shown = [10, 20, 30, 40, 50];

  it('portare un nome in cima sistema quel nome e nessun altro', () => {
    expect(withRowMoved([], shown, 30, 0)).toEqual([30]);
  });

  it('lasciarlo dove sta non scrive niente', () => {
    expect(withRowMoved([], shown, 30, 2)).toBeNull();
    expect(withRowMoved([], shown, 30, 3)).toBeNull(); // i due varchi ai suoi lati
  });

  it('il varco è contato sulla lista CON la riga dentro, quindi scendere non sbaglia di uno', () => {
    // 30 nel varco 4 = fra 40 e 50.
    expect(withRowMoved([], shown, 30, 4)).toEqual([10, 20, 40, 30]);
  });

  it('...e in coda ci si arriva', () => {
    expect(withRowMoved([], shown, 10, 5)).toEqual([20, 30, 40, 50, 10]);
  });

  it("un nome preso dalla parte a gain non butta fuori dall'ordine chi era già sistemato", () => {
    // Sistemati [10, 20, 30]; 40 arriva dalla parte a gain e va al secondo posto: il prefisso deve
    // contenere tutt'e quattro, o 30 tornerebbe a farsi ordinare dal gain.
    expect(withRowMoved([10, 20, 30], shown, 40, 1)).toEqual([10, 40, 20, 30]);
  });

  it('e un nome già suo spostato in basso porta nell\'ordine tutto quello che gli sta sopra', () => {
    expect(withRowMoved([10, 20], shown, 10, 4)).toEqual([20, 30, 40, 10]);
  });

  it('un nome che non è nella lista disegnata non muove niente', () => {
    expect(withRowMoved([], shown, 99, 0)).toBeNull();
  });
});
