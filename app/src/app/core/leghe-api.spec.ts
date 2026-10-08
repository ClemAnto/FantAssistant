import { describe, expect, it } from 'vitest';

import { LegheError, accountFromEmbed, accountFromLogin, readAnswer } from './leghe-api';

/**
 * THE WIRE TO LEGHE. The payloads here are SYNTHETIC with the real SHAPES - read off the operator's own
 * account on 08/10/2026 - because the real ones carry his tokens and his leagues and this repository is
 * public. A token below is three base64 segments and nothing more.
 */

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';

describe('accountFromEmbed', () => {
  it('reads the embedded login: user id and the per-league tokens', () => {
    const account = accountFromEmbed('classic', {
      id: 101,
      jwt: TOKEN,
      leagues: [{ id: 2001, name: 'Lega di prova', alias: 'lega-di-prova', jwt: TOKEN }],
    });
    expect(account?.userId).toBe(101);
    expect(account?.via).toBe('embed');
    expect(account?.leagues).toEqual([
      { platform: 'classic', id: 2001, name: 'Lega di prova', alias: 'lega-di-prova', jwt: TOKEN, game: null },
    ]);
  });

  it('refuses what is not that shape instead of returning an account with no leagues', () => {
    expect(accountFromEmbed('classic', null)).toBeNull();
    expect(accountFromEmbed('classic', { error: 'x' })).toBeNull();
    expect(accountFromEmbed('classic', { id: 1 })).toBeNull();
  });

  it('drops a league whose token is not a JWT', () => {
    const account = accountFromEmbed('classic', { id: 1, leagues: [{ id: 2, name: 'x', jwt: 'nope' }] });
    expect(account?.leagues).toEqual([]);
  });
});

describe('accountFromLogin', () => {
  it('reads the direct login: `leghe` is a dictionary, and `tipo_gioco` names the game', () => {
    const account = accountFromLogin('euro', {
      success: true,
      data: {
        utente: { id: 101 },
        leghe: {
          '0': { id: 3001, nome: 'Lega Mantra', alias: 'lega-mantra', tipo_gioco: 2, jwt: TOKEN },
          '1': { id: 3002, nome: 'Lega Classic', alias: 'lega-classic', tipo_gioco: 1, jwt: TOKEN },
        },
      },
    });
    expect(account?.userId).toBe(101);
    expect(account?.leagues.map((l) => [l.name, l.game])).toEqual([
      ['Lega Mantra', 'mantra'],
      ['Lega Classic', 'classic'],
    ]);
  });
});

describe('readAnswer', () => {
  it('passes a 2xx body through', () => {
    expect(readAnswer(200, { mday: 6 })).toEqual({ mday: 6 });
  });

  it('gives each cause its own error: wrong credentials, expired token, anything else', () => {
    const kind = (status: number, body: unknown) => {
      try {
        readAnswer(status, body);
        return null;
      } catch (err) {
        return err instanceof LegheError ? [err.kind, err.code] : 'other';
      }
    };
    expect(kind(400, { code: 'ATH018', message: 'Invalid username or password' })).toEqual(['credentials', 'ATH018']);
    expect(kind(400, { code: 'ATH004' })).toEqual(['expired', 'ATH004']);
    expect(kind(401, null)).toEqual(['expired', null]);
    expect(kind(400, { code: 'CE26', message: 'Calendar matchday not found.' })).toEqual(['refused', 'CE26']);
    expect(kind(200, { success: false, code: 'X1' })).toEqual(['refused', 'X1']);
  });
});
