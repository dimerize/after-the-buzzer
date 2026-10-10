import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { createSession } from '../worker/auth';
import * as historyStore from '../worker/history-store';
import type { Env } from '../worker/env';

const password = 'history-route-test-only';
const env = { APP_PASSWORD: password, DB: {}, ASSETS: {} } as Env;
async function request(path: string, authenticated = true) {
  const headers = authenticated ? { Cookie: `buzzer_session=${await createSession(password)}` } : undefined;
  return worker.fetch(new Request(`https://recap.example${path}`, { headers }), env);
}
afterEach(() => vi.restoreAllMocks());

describe('private historical API', () => {
  it.each(['/api/history/career?id=1966', '/api/history/games?id=1966&season=2026', '/api/history/honors?season=2026'])('requires authentication for %s', async path => {
    const response = await request(path, false);
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each([
    '/api/history/career', '/api/history/career?id=../bad', '/api/history/career?id=1234567890123',
    '/api/history/games?id=1966', '/api/history/games?id=1966&season=2026.5', '/api/history/games?id=1966&season=1946',
    '/api/history/honors?season=abc', '/api/history/honors?season=3000', '/api/history/honors?season='
  ])('rejects invalid history input before accessing storage: %s', async path => {
    expect((await request(path)).status).toBe(400);
  });

  it('returns direct typed payloads from the authenticated cached routes', async () => {
    const career = vi.spyOn(historyStore, 'loadCareerHistory').mockResolvedValue({ playerId: '1966', source: 'espn' } as Awaited<ReturnType<typeof historyStore.loadCareerHistory>>);
    const games = vi.spyOn(historyStore, 'loadSeasonLog').mockResolvedValue({ playerId: '1966', season: 2026, source: 'espn' } as Awaited<ReturnType<typeof historyStore.loadSeasonLog>>);
    const honors = vi.spyOn(historyStore, 'loadSeasonHonors').mockResolvedValue({ season: 2026, source: 'espn' } as Awaited<ReturnType<typeof historyStore.loadSeasonHonors>>);
    const a = await request('/api/history/career?id=1966'); const b = await request('/api/history/games?id=1966&season=2026'); const c = await request('/api/history/honors?season=2026');
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(await a.json()).toEqual({ playerId: '1966', source: 'espn' });
    expect(career).toHaveBeenCalledWith(env.DB, '1966'); expect(games).toHaveBeenCalledWith(env.DB, '1966', 2026); expect(honors).toHaveBeenCalledWith(env.DB, 2026);
  });
});
