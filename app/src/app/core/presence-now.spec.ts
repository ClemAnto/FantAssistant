import { PresenceNowFile, paOnSeason, presenceNowShares } from './presence-now';

const row = (fcId: number, pa: number, share: number | null) => ({
  fcId, name: `x${fcId}`, role: 'C', context: 'serie A, stesso club', pa, share, seenVotes: 3, outOpen: 0,
});

describe('presence-now: the new formula Pa on a full season', () => {
  it('reads the share by fc_id and skips a man without one', () => {
    const file = { rows: [row(1, 16.5, 0.5), row(2, 0, null)] } as unknown as PresenceNowFile;
    const shares = presenceNowShares(file);
    expect(shares.get(1)).toBe(0.5);
    expect(shares.has(2)).toBe(false);
    expect(presenceNowShares(null).size).toBe(0);
  });

  it('puts the share on the platform season, not on the rounds left', () => {
    // 16.5 of the 33 rounds left is half a season: 19 of 38, 15.5 of 31.
    expect(paOnSeason(0.5, 38)).toBe(19);
    expect(paOnSeason(0.5, 31)).toBe(15.5);
  });

  it('is unknown, never zero, without a share or a calendar', () => {
    expect(paOnSeason(null, 38)).toBeNull();
    expect(paOnSeason(0.5, null)).toBeNull();
    expect(paOnSeason(0, 38)).toBe(0);
  });
});
