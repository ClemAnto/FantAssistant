import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  APP_BRIDGE,
  APP_TIMEOUT_MS,
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

describe('legheCall through the Android app (`APP_BRIDGE`)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** A fake `window.FantAssistantApp`: records what the page sent and answers the way the app does. */
  function fakeApp(answer: (request: Record<string, unknown>) => [number, string] | null) {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal('FantAssistantApp', {
      request(id: string, json: string) {
        const request = JSON.parse(json) as Record<string, unknown>;
        sent.push(request);
        const reply = answer(request);
        // The app answers LATER, from its own thread, by evaluating the callback in the page.
        const page = globalThis as { __fantassistantBridge?: (id: string, status: number, text: string) => void };
        if (reply) setTimeout(() => page.__fantassistantBridge?.(id, reply[0], reply[1]), 10);
      },
    });
    return sent;
  }

  it('sends a platform and a path - never a URL - with the four headers, and reads the answer', async () => {
    vi.useFakeTimers();
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    const sent = fakeApp(() => [200, '{"ok":3}']);
    const call = legheCall({
      base: APP_BRIDGE,
      platform: 'euro',
      method: 'POST',
      path: '/onboarding/v1/login',
      jwt: TOKEN,
      body: { username: 'u' },
    });
    await vi.advanceTimersByTimeAsync(20 * SPACING_MS);
    expect(await call).toEqual({ ok: 3 });
    expect(fetched).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ platform: 'euro', method: 'POST', path: '/onboarding/v1/login', body: '{"username":"u"}' });
    expect(Object.keys(sent[0]['headers'] as object).sort()).toEqual(['Authorization', 'accept', 'app_key', 'content-type']);
    expect(JSON.stringify(sent[0])).not.toContain('https://');
  });

  it('an answer of Leghe that is a refusal reads as the same error a browser would get', async () => {
    vi.useFakeTimers();
    fakeApp(() => [200, '{"success":false,"code":"ATH018"}']);
    const call = legheCall({ base: APP_BRIDGE, platform: 'euro', method: 'POST', path: '/p' }).catch((err) => err);
    await vi.advanceTimersByTimeAsync(20 * SPACING_MS);
    expect(((await call) as LegheError).kind).toBe('credentials');
  });

  it('status 0 is the app saying the network failed: «unreachable», with its reason', async () => {
    vi.useFakeTimers();
    fakeApp(() => [0, 'timeout']);
    const call = legheCall({ base: APP_BRIDGE, platform: 'classic', method: 'GET', path: '/p' }).catch((err) => err);
    await vi.advanceTimersByTimeAsync(20 * SPACING_MS);
    const err = (await call) as LegheError;
    expect(err.kind).toBe('unreachable');
    expect(err.message).toContain('timeout');
  });

  it('an app that never answers does not hang the page: it gives up after APP_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    fakeApp(() => null);
    const call = legheCall({ base: APP_BRIDGE, platform: 'classic', method: 'GET', path: '/p' }).catch((err) => err);
    await vi.advanceTimersByTimeAsync(APP_TIMEOUT_MS + 20 * SPACING_MS);
    expect(((await call) as LegheError).kind).toBe('unreachable');
  });

  it("the app's base without the app is a failure that says so, not a fetch to a non-URL", async () => {
    vi.useFakeTimers();
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    const call = legheCall({ base: APP_BRIDGE, platform: 'classic', method: 'GET', path: '/p' }).catch((err) => err);
    await vi.advanceTimersByTimeAsync(20 * SPACING_MS);
    const err = (await call) as LegheError;
    expect(err.kind).toBe('unreachable');
    expect(err.message).toContain("l'app");
    expect(fetched).not.toHaveBeenCalled();
  });
});
