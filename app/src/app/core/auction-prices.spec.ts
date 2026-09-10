import { describe, expect, it } from 'vitest';

import { BundleTable } from './bundle';
import {
  REF_BUDGET,
  REF_TEAMS,
  buildAuctionPrices,
  latestMonths,
  scaleTo,
} from './auction-prices';

const TABLE: BundleTable = {
  table: 'auction_prices',
  columns: ['fc_id', 'season', 'platform', 'game', 'month', 'auctions', 'sold', 'sold_of',
            'price_p25', 'price_med', 'price_p75'],
  rows: [
    // Lo stesso uomo in due mesi: agosto ha visto un'altra stanza, e settembre è quella di adesso.
    [5585, '2026-27', 'default', 'classic', '2026-08', 6, 6, 6, 400, 430, 470],
    [5585, '2026-27', 'default', 'classic', '2026-09', 27, 14, 14, 472, 500, 611],
    [2764, '2026-27', 'default', 'classic', '2026-09', 27, 14, 14, 416, 460, 554],
    // Un altro LIBRO: stesso listone, gioco diverso, e il suo mese più recente è il suo.
    [5585, '2026-27', 'default', 'mantra', '2026-08', 5, 0, 0, 300, 330, 360],
  ],
};

describe('auction prices', () => {
  it('keeps only the most recent month, per (platform, game)', () => {
    // Due mesi sullo stesso uomo sono due fatti e non una media: agosto ha visto una stanza che
    // giocava una stagione non ancora cominciata. Quello che serve al tavolo è cosa costa ADESSO.
    const byBook = buildAuctionPrices(TABLE);
    const classic = byBook.get('default|classic')!;
    expect(classic.get(5585)!.median).toBe(500);
    expect(classic.get(5585)!.month).toBe('2026-09');
    expect(classic.size).toBe(2);
    // ...e il libro mantra tiene il SUO mese più recente, che è un mese diverso.
    expect(byBook.get('default|mantra')!.get(5585)!.month).toBe('2026-08');
    expect(latestMonths(TABLE).get('default|classic')).toBe('2026-09');
  });

  it('carries how often the room actually took him, which no quotation can say', () => {
    const man = buildAuctionPrices(TABLE).get('default|classic')!.get(2764)!;
    expect([man.sold, man.soldOf]).toEqual([14, 14]);
    expect(man.auctions).toBe(27);
  });

  it('scales the price to the DECLARED league, which is the inverse of how it was stored', () => {
    // Il prezzo è archiviato su una lega da 10 x 1000. In una da 500 crediti lo stesso uomo costa la
    // metà, e mostrargli 500 sarebbe una cifra che nel suo gioco nessuno può pagare.
    expect(scaleTo(500, REF_TEAMS, REF_BUDGET)).toBe(500);
    expect(scaleTo(500, 10, 500)).toBe(250);
    expect(scaleTo(500, 8, 1000)).toBe(400);
  });

  it('reads a table that has none of the optional columns without inventing a number', () => {
    // Un pacchetto più vecchio può non portare i quartili: la mediana resta, e i due estremi
    // diventano lei invece di uno zero - «vuoto = ignoto, mai zero» su una banda.
    const thin: BundleTable = {
      table: 'auction_prices',
      columns: ['fc_id', 'platform', 'game', 'month', 'auctions', 'price_med'],
      rows: [[5585, 'default', 'classic', '2026-09', 27, 500]],
    };
    const man = buildAuctionPrices(thin).get('default|classic')!.get(5585)!;
    expect([man.p25, man.median, man.p75]).toEqual([500, 500, 500]);
    expect([man.sold, man.soldOf]).toEqual([null, null]);
  });

  it('drops a row whose price cannot be read, instead of writing a zero', () => {
    const broken: BundleTable = {
      table: 'auction_prices',
      columns: ['fc_id', 'platform', 'game', 'month', 'auctions', 'price_med'],
      rows: [[5585, 'default', 'classic', '2026-09', 27, null]],
    };
    expect(buildAuctionPrices(broken).get('default|classic')).toBeUndefined();
  });
});
