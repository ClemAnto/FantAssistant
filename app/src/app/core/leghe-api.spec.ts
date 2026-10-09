import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LegheError,
  SPACING_MS,
  accountFromEmbed,
  accountFromLogin,
  legheCall,
  legheRequestsSent,
  readAnswer,
} from './leghe-api';

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

describe('legheCall', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('asks Leghe ONE thing at a time, SPACING_MS apart, and counts what really left', async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    let open = 0;
    let most = 0;
    vi.stubGlobal('fetch', async () => {
      starts.push(Date.now());
      open += 1;
      most = Math.max(most, open);
      await new Promise((go) => setTimeout(go, 50));
      open -= 1;
      return new Response('{"ok":1}', { status: 200 });
    });
    const before = legheRequestsSent();
    const calls = [1, 2, 3].map(() => legheCall({ base: '/x', platform: 'classic', method: 'GET', path: '/p' }));
    await vi.advanceTimersByTimeAsync(20 * SPACING_MS);
    expect(await Promise.all(calls)).toEqual([{ ok: 1 }, { ok: 1 }, { ok: 1 }]);
    expect(most).toBe(1);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(SPACING_MS);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(SPACING_MS);
    expect(legheRequestsSent() - before).toBe(3);
  });

  it('a failed request does not stop the ones queued behind it', async () => {
    vi.useFakeTimers();
    let n = 0;
    vi.stubGlobal('fetch', async () => {
      n += 1;
      if (n === 1) throw new TypeError('Failed to fetch');
      return new Response('{"ok":2}', { status: 200 });
    });
    const first = legheCall({ base: '/x', platform: 'euro', method: 'GET', path: '/p' }).catch((err) => err);
    const second = legheCall({ base: '/x', platform: 'euro', method: 'GET', path: '/p' });
    await vi.advanceTimersByTimeAsync(20 * SPACING_MS);
    expect(((await first) as LegheError).kind).toBe('unreachable');
    expect(await second).toEqual({ ok: 2 });
  });

  it('without a pass-through nothing leaves, and nothing is counted', async () => {
    const before = legheRequestsSent();
    await expect(legheCall({ base: null, platform: 'classic', method: 'GET', path: '/p' })).rejects.toMatchObject({
      kind: 'no-proxy',
    });
    expect(legheRequestsSent()).toBe(before);
  });
});
