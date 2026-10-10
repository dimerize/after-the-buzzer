import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { refresh, runScheduled } from '../worker/index';
import { createSession, verifySession } from '../worker/auth';
import { DEFAULT_PREFERENCES } from '../src/shared/defaults';
import type { Night } from '../src/shared/types';
import type { Env } from '../worker/env';
import * as store from '../worker/store';
import * as espn from '../worker/espn';
import * as push from '../worker/push';
import { editNight } from '../worker/ai';

const origin = 'https://recap.example.com';
const password = 'test-only-private-owner-password';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function environment(extra: Partial<Env> = {}): Env {
  const statement = {
    bind() { return this; },
    async first() { return null; },
    async run() { return { success: true, meta: { changes: 1 } }; },
    async all() { return { success: true, results: [] }; },
  };
  return {
    APP_PASSWORD: password,
    VAPID_PUBLIC_KEY: 'configured-public-key', VAPID_PRIVATE_KEY: 'configured-private-key',
    VAPID_SUBJECT: 'mailto:owner@example.com',
    DB: { prepare: () => statement, batch: async () => [] } as unknown as D1Database,
    ASSETS: { fetch: async () => new Response('App shell') } as unknown as Fetcher,
    ...extra,
  };
}

async function request(path: string, options: {
  method?: string; value?: unknown; authenticated?: boolean; requestOrigin?: string | null;
  host?: string; token?: string; env?: Env;
} = {}) {
  const headers = new Headers();
  const method = options.method ?? 'GET';
  if (options.requestOrigin !== null && method !== 'GET') headers.set('Origin', options.requestOrigin ?? origin);
  if (options.authenticated || options.token) headers.set('Cookie', `buzzer_session=${options.token ?? await createSession(password)}`);
  if (options.value !== undefined) headers.set('Content-Type', 'application/json');
  return worker.fetch(new Request(`${options.host ?? origin}${path}`, {
    method, headers, ...(options.value !== undefined ? { body: JSON.stringify(options.value) } : {}),
  }), options.env ?? environment());
}

describe('private API authentication', () => {
  it.each(['/api/dashboard', '/api/players?q=Victor', '/api/push/key'])(
    'requires an owner session for %s', async (path) => {
      const response = await request(path);
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    },
  );

  it('fails closed when no production password is configured', async () => {
    expect((await request('/api/dashboard', { env: environment({ APP_PASSWORD: undefined }) })).status).toBe(503);
  });

  it('does not grant a remote hostname the explicit localhost development bypass', async () => {
    expect((await request('/api/push/key', { env: environment({ LOCAL_DEV: 'true' }) })).status).toBe(401);
  });

  it('rejects an expired signed session', async () => {
    const token = await createSession(password, Date.now() - 31 * 86400000);
    expect((await request('/api/push/key', { token })).status).toBe(401);
  });

  it('issues an HttpOnly secure same-site cookie after correct login', async () => {
    const response = await request('/api/login', { method: 'POST', value: { password } });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('Set-Cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    const token = cookie.split(';')[0].slice('buzzer_session='.length);
    expect(await verifySession(token, password)).toBe(true);
    expect(await response.json()).toEqual({ ok: true });
  });

  it.each([null, 'https://attacker.example.com'])('rejects authenticated writes with origin %s', async (requestOrigin) => {
    const response = await request('/api/preferences', {
      method: 'PUT', authenticated: true, requestOrigin, value: DEFAULT_PREFERENCES,
    });
    expect(response.status).toBe(403);
  });
});

describe('API input validation', () => {
  it('stops reading oversized bodies even when no Content-Length header is provided', async () => {
    let cancelled = false;
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunks++ >= 100) return controller.close();
        controller.enqueue(new Uint8Array(16_000));
      },
      cancel() { cancelled = true; },
    });
    const options = { method: 'POST', headers: { Origin: origin }, body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' };
    const response = await worker.fetch(new Request(`${origin}/api/login`, options), environment());
    expect(response.status).toBe(400);
    expect(cancelled).toBe(true);
    expect(chunks).toBeLessThan(100);
  });

  it('saves valid preferences', async () => {
    const response = await request('/api/preferences', { method: 'PUT', authenticated: true, value: DEFAULT_PREFERENCES });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preferences: DEFAULT_PREFERENCES });
  });

  it('rejects an array masquerading as recap length', async () => {
    const response = await request('/api/preferences', {
      method: 'PUT', authenticated: true, value: { ...DEFAULT_PREFERENCES, length: ['normal'] },
    });
    expect(response.status).toBe(400);
  });

  it('rejects an array masquerading as a player tier', async () => {
    const response = await request('/api/preferences', {
      method: 'PUT', authenticated: true,
      value: { ...DEFAULT_PREFERENCES, players: [{ ...DEFAULT_PREFERENCES.players[0], tier: ['favorite'] }] },
    });
    expect(response.status).toBe(400);
  });

  it.each([{ p256dh: '', auth: '' }, { p256dh: 'not-a-P256-public-key', auth: 'not-an-auth-secret' }])(
    'rejects malformed browser encryption keys %j', async (keys) => {
      const response = await request('/api/push/subscribe', {
        method: 'POST', authenticated: true,
        value: { endpoint: 'https://fcm.googleapis.com/fcm/send/test-device', keys },
      });
      expect(response.status).toBe(400);
    },
  );

  it('refuses push registration when the required contact subject is missing', async () => {
    const response = await request('/api/push/subscribe', {
      method: 'POST', authenticated: true,
      value: { endpoint: 'https://fcm.googleapis.com/fcm/send/test-device', keys: { p256dh: '', auth: '' } },
      env: environment({ VAPID_SUBJECT: undefined }),
    });
    expect(response.status).toBe(503);
  });
});

const savedNight: Night = {
  date: '2026-10-10', updatedAt: '2026-10-11T04:00:00Z', edition: 'final', season: '2026-27', seasonType: 'preseason',
  source: 'espn', partial: false, warnings: [], players: [], leaders: [], headline: 'First story', summary: 'Verified summary',
  games: [{ id: 'game-1', away: 'SAS', home: 'LAL', awayScore: 115, homeScore: 111, status: 'final', statusText: 'Final', startsAt: '2026-10-11T00:00:00Z', sourceUrl: 'https://www.espn.com/nba/game/_/gameId/game-1' }],
  highlights: [
    { id: 'first', title: 'First story', detail: 'Verified first fact', category: 'standout', score: 90, statLabel: 'PTS', statValue: '40', sourceUrl: '' },
    { id: 'second', title: 'Second story', detail: 'Verified second fact', category: 'milestone', score: 80, statLabel: 'BLK', statValue: '7', sourceUrl: '' },
  ],
};

function unlocked() {
  vi.spyOn(store, 'acquireLock').mockResolvedValue(true);
  vi.spyOn(store, 'releaseLock').mockResolvedValue();
}

describe('archive correction and scheduled recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-11T14:00:00Z'));
  });

  it('retains a complete final snapshot and its original timestamp after a partial provider refresh', async () => {
    unlocked();
    vi.spyOn(store, 'getNight').mockResolvedValue(savedNight);
    vi.spyOn(espn, 'fetchNight').mockResolvedValue({ ...savedNight, partial: true, players: [], highlights: [], updatedAt: new Date().toISOString() });
    const saved = vi.spyOn(store, 'saveNight').mockResolvedValue();
    const result = await refresh(environment(), savedNight.date, DEFAULT_PREFERENCES);
    expect(result.highlights).toEqual(savedNight.highlights);
    expect(result.updatedAt).toBe('2026-10-11T04:00:00Z');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(saved).not.toHaveBeenCalled();
  });

  it('finishes an old unresolved night after the current basketball date has rolled over', async () => {
    unlocked();
    const unfinished = { ...savedNight, edition: 'live' as const, games: [{ ...savedNight.games[0], status: 'live' as const }] };
    vi.spyOn(store, 'getPreferences').mockResolvedValue(DEFAULT_PREFERENCES);
    vi.spyOn(store, 'getNight').mockImplementation(async (_db, date) => date === savedNight.date ? unfinished : null);
    vi.spyOn(espn, 'fetchNight').mockResolvedValue(savedNight);
    const saved = vi.spyOn(store, 'saveNight').mockResolvedValue();
    const statement = {
      bind() { return this; },
      async all() { return { results: [{ payload: JSON.stringify(unfinished) }] }; },
    };
    const env = environment({ DB: { prepare: () => statement } as unknown as D1Database });
    await runScheduled(env, new Date('2026-10-11T14:00:00Z'));
    expect(saved).toHaveBeenCalledWith(env.DB, expect.objectContaining({ date: '2026-10-10', edition: 'final' }));
  });

  it('uses the Eastern NBA slate even when the notification timezone is already on tomorrow’s date', async () => {
    const now = new Date('2026-10-10T21:00:00Z'); // 06:00 tomorrow in Tokyo, 17:00 today in New York.
    vi.spyOn(store, 'getPreferences').mockResolvedValue({ ...DEFAULT_PREFERENCES, timezone: 'Asia/Tokyo' });
    const getNight = vi.spyOn(store, 'getNight').mockResolvedValue({ ...savedNight, updatedAt: now.toISOString() });
    const env = environment();
    await runScheduled(env, now);
    expect(getNight).toHaveBeenCalledWith(env.DB, '2026-10-10');
  });

  it('delivers a new scoring milestone after a previously notified rebounding milestone', async () => {
    const now = new Date('2026-10-11T03:00:00Z');
    vi.setSystemTime(now);
    const preferences = { ...DEFAULT_PREFERENCES, liveAlerts: true, quietStart: '00:00', quietEnd: '00:00' };
    vi.spyOn(store, 'getPreferences').mockResolvedValue(preferences);
    const player = {
      id: '5104157', name: 'Victor Wembanyama', team: 'SAS', opponent: 'LAL', gameId: 'game-1', rookie: false,
      status: 'live' as const, starter: true, didNotPlay: false, points: 60, rebounds: 20, assists: 2, blocks: 3,
      steals: 1, threes: 6, minutes: 38, fgMade: 23, fgAttempted: 32, ftMade: 8, ftAttempted: 9, turnovers: 2, plusMinus: 10,
    };
    vi.spyOn(store, 'getNight').mockResolvedValue({ ...savedNight, edition: 'live', updatedAt: now.toISOString(), players: [player],
      games: savedNight.games.map(game => ({ ...game, status: 'live', statusText: '4th · 1:45' })) });
    const sent = vi.spyOn(push, 'sendPush').mockResolvedValue({ ok: true, expired: false });
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-device', keys: { p256dh: 'test', auth: 'test' } };
    const db = {
      prepare(sql: string) {
        let args: unknown[] = [];
        return {
          bind(...values: unknown[]) { args = values; return this; },
          async first() { return sql.includes('FROM notifications') && args[0] === 'live:game-1:5104157:rebounds:20' ? { id: args[0] } : null; },
          async all() { return { results: [{ endpoint: subscription.endpoint, payload: JSON.stringify(subscription) }] }; },
          async run() { return { meta: { changes: 1 } }; },
        };
      },
      async batch() { return []; },
    } as unknown as D1Database;
    const env = environment({ DB: db });
    await runScheduled(env, now);
    expect(sent).toHaveBeenCalledWith(subscription, expect.objectContaining({
      body: '60 PTS · 20 REB · 2 AST · 1 STL · 3 BLK · vs LAL · live 4th · 1:45',
      url: '/?date=2026-10-10&player=5104157',
    }), env);
  });
});

describe('AI spending and persisted story selection', () => {
  it('reapplies saved selection to current facts without another paid request', async () => {
    unlocked();
    const statement = { bind() { return this; }, async first() { return { id: '2026-10-10:final', result: '["second"]' }; } };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await editNight(savedNight, environment({
      OPENAI_API_KEY: 'test-only-key', DB: { prepare: () => statement } as unknown as D1Database,
    }));
    expect(result.headline).toBe('Second story');
    expect(result.highlights[0].detail).toBe('Verified second fact');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('makes no paid request when the atomic budget reservation is refused', async () => {
    unlocked();
    const statement = {
      bind() { return this; }, async first() { return null; },
      async run() { return { meta: { changes: 0 } }; },
    };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await editNight(savedNight, environment({
      OPENAI_API_KEY: 'test-only-key', DB: { prepare: () => statement } as unknown as D1Database,
    }));
    expect(result).toEqual(savedNight);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects oversized editorial input before reserving money or making a paid request', async () => {
    unlocked();
    const reserve = vi.fn();
    const statement = { bind() { return this; }, async first() { return null; }, run: reserve };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const oversized = { ...savedNight, highlights: savedNight.highlights.map(h => ({ ...h, detail: 'a'.repeat(13_000) })) };
    const result = await editNight(oversized, environment({
      OPENAI_API_KEY: 'test-only-key', DB: { prepare: () => statement } as unknown as D1Database,
    }));
    expect(result).toEqual(oversized);
    expect(reserve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
