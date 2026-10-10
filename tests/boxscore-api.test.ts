import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../worker/auth';
import type { Env } from '../worker/env';

let worker: typeof import('../worker/index').default;
let cookie: string;
let env: Env;
let calls: string[];
beforeEach(async () => {
  vi.resetModules(); worker = (await import('../worker/index')).default;
  const password = 'boxscore-route-test-only';
  cookie = `buzzer_session=${await createSession(password)}`;
  env = { APP_PASSWORD: password, DB: { prepare: () => { throw new Error('Pregame should not load boxscores'); } } as unknown as D1Database, ASSETS: {} as Fetcher };
  calls = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url));
    return Response.json({ leagues: [{ season: { year: 2027, type: 1 } }], events: [{ id: '401898399', date: '2026-10-11T00:30Z', status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } }, competitions: [{ competitors: [{ homeAway: 'away', team: { abbreviation: 'SAC' } }, { homeAway: 'home', team: { abbreviation: 'GS' } }] }] }] });
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const request = (query = '?date=2026-10-10&gameId=401898399', authenticated = true) => worker.fetch(new Request('https://recap.example/api/boxscore'+query, { headers: authenticated ? { Cookie: cookie } : {} }), env);

describe('private verified game boxscore route', () => {
  it('authenticates before any provider access', async () => {
    expect((await request(undefined, false)).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it.each(['', '?date=2026-02-30&gameId=1', '?date=2026-10-10&gameId=../x', '?date=2026-10-10&gameId=1&gameId=2', '?date=2026-10-10&date=2026-10-11&gameId=1'])('rejects invalid identity %s', async query => {
    expect((await request(query)).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it('rejects a game that is not on the selected schedule', async () => {
    expect((await request('?date=2026-10-10&gameId=123')).status).toBe(404);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/scoreboard?');
  });
  it('returns an honest not-started report with normalized verified teams', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ date: '2026-10-10', gameId: '401898399', availability: 'not-started', teams: [{ team: 'SAC', players: [] }, { team: 'GSW', players: [] }] });
    expect(calls).toHaveLength(1);
  });
});
