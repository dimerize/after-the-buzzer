import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../worker/auth';
import type { Env } from '../worker/env';

const origin = 'https://recap.example';
const password = 'test-only-schedule-password';
const now = new Date('2026-10-11T04:30:00Z');
function event(id = '401900123', values: Record<string, unknown> = {}) {
  return { id, date: '2026-10-12T00:00Z', season: { year: 2027, type: 1 },
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false, detail: 'Sun, October 11th at 8:00 PM EDT' } },
    competitions: [{ competitors: [
      { homeAway: 'away', team: { abbreviation: 'SA' }, score: '' },
      { homeAway: 'home', team: { abbreviation: 'GS' }, score: '' },
    ] }], ...values };
}
function board(events: unknown[] = [event()]) {
  return { leagues: [{ season: { year: 2027, type: { type: 1 } } }], events };
}
let worker: typeof import('../worker/index').default;
let provider: ReturnType<typeof vi.fn<typeof fetch>>;
let databaseAccess: ReturnType<typeof vi.fn>;
let cookie: string;
let env: Env;

beforeEach(async () => {
  vi.resetModules();
  worker = (await import('../worker/index')).default;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  provider = vi.fn<typeof fetch>(async () => Response.json(board()));
  vi.stubGlobal('fetch', provider);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  databaseAccess = vi.fn(() => { throw new Error('Schedule requests must not touch private D1 state'); });
  env = { APP_PASSWORD: password, DB: { prepare: databaseAccess } as unknown as D1Database, ASSETS: {} as Fetcher };
  cookie = `buzzer_session=${await createSession(password)}`;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const request = (query = '?date=2026-10-11', authenticated = true) => worker.fetch(new Request(`${origin}/api/schedule${query}`, {
  headers: authenticated ? { Cookie: cookie } : {},
}), env);

describe('authenticated scoreboard-only schedule', () => {
  it('requires a private session before consulting ESPN', async () => {
    expect((await request(undefined, false)).status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
  });

  it('returns normalized actual tipoffs and matchups without recap/boxscore side effects', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ date: '2026-10-11', source: 'espn', updatedAt: '2026-10-11T04:30:00.000Z', warnings: [], games: [{
      id: '401900123', away: 'SAS', home: 'GSW', awayScore: null, homeScore: null,
      status: 'scheduled', statusText: 'Sun, October 11th at 8:00 PM EDT', startsAt: '2026-10-12T00:00Z',
      sourceUrl: 'https://www.espn.com/nba/game/_/gameId/401900123', broadcasts: [],
    }] });
    expect(provider).toHaveBeenCalledOnce();
    expect(String(provider.mock.calls[0][0])).toBe('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261011&limit=100');
    expect(databaseAccess).not.toHaveBeenCalled();
  });

  it('does not fetch boxscores even if the requested schedule contains live or final games', async () => {
    provider.mockImplementation(async () => Response.json(board([event('123', { status: { type: { name: 'STATUS_FINAL', completed: true, state: 'post' } } })])));
    const response = await request();
    expect(response.status).toBe(200);
    expect((await response.json() as { games: { status: string }[] }).games[0].status).toBe('final');
    expect(provider).toHaveBeenCalledOnce();
    expect(databaseAccess).not.toHaveBeenCalled();
  });

  it('returns a genuine empty future date as 200 rather than a provider failure', async () => {
    provider.mockResolvedValue(Response.json(board([])));
    const response = await request('?date=2027-08-15');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ date: '2027-08-15', games: [], source: 'espn', updatedAt: now.toISOString(), warnings: [] });
  });

  it.each(['', '?date=', '?date=not-a-date', '?date=2026-02-30', '?date=2025-02-29', '?date=1999-12-31', '?date=2026-10-11&date=2026-10-12'])('rejects missing, duplicate or invalid date before any provider call: %s', async query => {
    expect((await request(query)).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
    expect(databaseAccess).not.toHaveBeenCalled();
  });

  it('accepts a real leap day', async () => {
    provider.mockResolvedValue(Response.json(board([])));
    expect((await request('?date=2028-02-29')).status).toBe(200);
  });

  it.each([503, 404])('reports provider HTTP %i as a failure, never an empty slate', async status => {
    provider.mockImplementation(async () => new Response('provider-detail-not-for-client', { status }));
    const response = await request();
    expect(response.status).toBe(502);
    const value = await response.json() as { error: string; games?: unknown[] };
    expect(value.error).toMatch(/schedule|feed/i);
    expect(value.error).not.toContain('provider-detail-not-for-client');
    expect(value.games).toBeUndefined();
    expect(provider.mock.calls.length).toBe(status === 404 ? 1 : 2);
  });

  it('treats malformed top-level data as a provider failure', async () => {
    provider.mockResolvedValue(Response.json({ error: 'unexpected provider shape' }));
    expect((await request()).status).toBe(502);
  });

  it('warns about malformed events without inventing an unknown tipoff', async () => {
    provider.mockResolvedValue(Response.json(board([event(), event('456', { date: '' }), event('789', { date: '2026-10-12' }), {}])));
    const response = await request();
    expect(response.status).toBe(200);
    const value = await response.json() as { games: { id: string }[]; warnings: string[] };
    expect(value.games.map(game => game.id)).toEqual(['401900123']);
    expect(value.warnings).toHaveLength(3);
    expect(value.warnings.join(' ')).toMatch(/malformed/i);
  });

  it('briefly caches normalized schedules by date without D1 writes, then refreshes after expiry', async () => {
    const first = await (await request()).json();
    expect(await (await request()).json()).toEqual(first);
    expect(provider).toHaveBeenCalledOnce();
    await request('?date=2026-10-12');
    expect(provider).toHaveBeenCalledTimes(2);
    vi.setSystemTime(now.getTime() + 61000);
    const fresh = await request();
    expect((await fresh.json() as { updatedAt: string }).updatedAt).toBe('2026-10-11T04:31:01.000Z');
    expect(provider).toHaveBeenCalledTimes(3);
    expect(databaseAccess).not.toHaveBeenCalled();
  });

  it('does not cache a provider failure as an empty schedule', async () => {
    provider.mockResolvedValueOnce(new Response('unavailable', { status: 404 }));
    expect((await request()).status).toBe(502);
    expect((await request()).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(2);
  });
});
