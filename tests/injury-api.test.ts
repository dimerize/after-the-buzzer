import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../worker/auth';
import type { Env } from '../worker/env';
import type { GameInjuryReport } from '../src/shared/injury-types';

const now = new Date('2026-10-10T18:00:00Z');
const origin = 'https://recap.example';
const password = 'injury-tests-only';
const gameId = '401898720';
function player(index = 0, values: Record<string, unknown> = {}) {
  const id = String(5104157 + index);
  return { id: String(530000 + index), status: 'Day-To-Day', date: '2026-10-09T21:00Z',
    athlete: { displayName: `Player ${index}`, links: [{ rel: ['playercard'], href: `https://www.espn.com/nba/player/_/id/${id}/player` }], team: { id: '24' } },
    details: { type: 'Knee', side: 'Left', detail: 'Soreness', returnDate: '2026-10-11' }, ...values };
}
function feed() {
  return { timestamp: now.toISOString(), status: 'success', season: { year: 2027, type: 1 }, injuries: [
    { id: '24', displayName: 'San Antonio Spurs', injuries: Array.from({ length: 8 }, (_, i) => player(i)) },
    { id: '21', displayName: 'Phoenix Suns', injuries: [] },
  ] };
}
function board(date = '2026-10-10', state = 'pre') {
  return { leagues: [{ season: { year: 2027, type: 1 } }], events: [{ id: gameId, date: `${date}T23:30:00Z`, season: { year: 2027, type: 1 },
    status: { type: { name: state === 'post' ? 'STATUS_FINAL' : state === 'postponed' ? 'STATUS_POSTPONED' : 'STATUS_SCHEDULED', state, completed: state === 'post' } },
    competitions: [{ competitors: [{ homeAway: 'away', team: { abbreviation: 'SA' } }, { homeAway: 'home', team: { abbreviation: 'PHX' } }] }],
  }] };
}
function memoryDb() {
  let row: { payload: string | null; checked_at: number | null; attempted_at: number } | null = null;
  const prepare = (sql: string) => ({ bind: (...args: unknown[]) => ({
    first: async () => { if (!sql.startsWith('SELECT') || !sql.includes('injury_cache')) throw new Error(`Unexpected read: ${sql}`); return row && { ...row }; },
    run: async () => {
      if (sql.startsWith('INSERT INTO injury_cache')) {
        const [attempted, cutoff] = args as number[];
        if (row && row.attempted_at > cutoff) return { meta: { changes: 0 } };
        row = { payload: row?.payload ?? null, checked_at: row?.checked_at ?? null, attempted_at: attempted };
      } else if (sql.startsWith('UPDATE injury_cache SET payload')) {
        if (!row) throw new Error('Missing reservation');
        row = { ...row, payload: String(args[0]), checked_at: Number(args[1]) };
      } else throw new Error(`Unexpected write: ${sql}`);
      return { meta: { changes: 1 } };
    },
  }) });
  return { db: { prepare } as unknown as D1Database, get row() { return row; } };
}
let worker: typeof import('../worker/index').default;
let cookie: string;
let env: Env;
let upstream: ReturnType<typeof vi.fn<typeof fetch>>;
let injuryData: unknown;
let scoreboard: ReturnType<typeof board>;
let injuryStatus: number;

beforeEach(async () => {
  vi.resetModules();
  worker = (await import('../worker/index')).default;
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  injuryData = feed(); scoreboard = board(); injuryStatus = 200;
  upstream = vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url.includes('/scoreboard?')) return Response.json(scoreboard);
    if (url === 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries') return Response.json(injuryData, { status: injuryStatus });
    throw new Error(`Unexpected upstream: ${url}`);
  });
  vi.stubGlobal('fetch', upstream);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  env = { APP_PASSWORD: password, DB: memoryDb().db, ASSETS: {} as Fetcher };
  cookie = `buzzer_session=${await createSession(password)}`;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const request = (query = `?date=2026-10-10&gameId=${gameId}`, authenticated = true) => worker.fetch(new Request(origin + '/api/injuries' + query, { headers: authenticated ? { Cookie: cookie } : {} }), env);
const report = async () => (await (await request()).json()) as GameInjuryReport;

describe('per-game injury reports', () => {
  it('requires authentication before accessing schedule or injuries', async () => {
    expect((await request(undefined, false)).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('returns all eight injuries, matching teams and distinct source/fetch timestamps', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const data = await response.json() as GameInjuryReport;
    expect(data).toMatchObject({ gameId, date: '2026-10-10', source: 'espn', availability: 'current', stale: false, fetchedAt: now.toISOString(), feedUpdatedAt: now.toISOString() });
    expect(data.teams.map(team => team.team)).toEqual(['SAS', 'PHX']);
    expect(data.teams[0].players).toHaveLength(8);
    expect(data.teams[0].players[0]).toEqual({ id: '5104157', name: 'Player 0', status: 'Day-To-Day', reason: 'Left Knee · Soreness', updatedAt: '2026-10-09T21:00:00.000Z', estimatedReturn: '2026-10-11' });
    expect(data.teams[1]).toMatchObject({ coverage: 'reported', players: [] });
    expect(data.officialSourceUrl).toMatch(/^https:\/\/official\.nba\.com\//);
    expect(data.sourceUrl).toBe('https://www.espn.com/nba/injuries');
    expect(upstream.mock.calls.some(([url]) => String(url).includes('/summary'))).toBe(false);
  });
  it('uses a Workers-supported redirect policy without following an upstream redirect', async () => {
    upstream.mockImplementation(async (input, init) => {
      if (String(input).includes('/scoreboard?')) return Response.json(scoreboard);
      if (init?.redirect === 'error') throw new TypeError('Workers supports follow or manual redirects only.');
      expect(init?.redirect).toBe('manual');
      return Response.json(injuryData);
    });
    expect((await report()).availability).toBe('current');
  });
  it.each(['', '?date=2026-02-30&gameId=1', '?date=2026-10-10&gameId=../api', '?date=2026-10-10&gameId=1&gameId=2', '?date=2026-10-10&date=2026-10-11&gameId=1'])('rejects invalid or duplicate identity: %s', async query => {
    expect((await request(query)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects a game not on the requested schedule', async () => {
    expect((await request('?date=2026-10-10&gameId=123')).status).toBe(404);
    expect(upstream.mock.calls.some(([url]) => String(url).endsWith('/injuries'))).toBe(false);
  });
  it.each([['2026-10-09', 'pre'], ['2026-10-10', 'post'], ['2026-10-10', 'postponed']])('never applies current injuries to past/final/postponed games: %s %s', async (date, state) => {
    scoreboard = board(date, state);
    const response = await request(`?date=${date}&gameId=${gameId}`);
    expect(response.status).toBe(200);
    const data = await response.json() as GameInjuryReport;
    expect(data.availability).toBe('historical-unavailable');
    expect(data.teams.every(team => team.players.length === 0)).toBe(true);
    expect(data.fetchedAt).toBeNull();
    expect(upstream.mock.calls.some(([url]) => String(url).endsWith('/injuries'))).toBe(false);
  });
  it('distinguishes missing team coverage from an explicitly empty injury list', async () => {
    injuryData = { ...feed(), injuries: feed().injuries.slice(0, 1) };
    expect((await report()).teams[1]).toMatchObject({ coverage: 'not-listed', players: [] });
  });
  it('does not coerce unknown status, infer a return date, or use injury IDs as player IDs', async () => {
    const data = feed();
    data.injuries[0].injuries = [player(0, { status: 'Questionable', date: 'garbage', details: { type: 'Undisclosed', returnDate: '2026-02-30' } }), player(1, { athlete: { displayName: 'Unverified identity' } })];
    injuryData = data;
    const value = await report();
    expect(value.teams[0].players).toEqual([{ id: '5104157', name: 'Player 0', status: 'Questionable', reason: 'Undisclosed', updatedAt: null, estimatedReturn: null }]);
    expect(value.warnings.join(' ')).toMatch(/incomplete|unverified|omitted/i);
  });
  it('rejects an athlete mapped to a different team instead of showing a traded player under the wrong team', async () => {
    const data = feed(); data.injuries[0].injuries = [player(0, { athlete: { id: '5104157', displayName: 'Wrong team', team: { id: '21' } } })]; injuryData = data;
    const value = await report();
    expect(value.teams[0].players).toEqual([]);
    expect(value.teams[0].coverage).toBe('unavailable');
  });
  it('scopes incomplete-team warnings to this matchup while keeping source-wide warnings', async () => {
    const data = feed();
    data.timestamp = '';
    data.injuries.push({ id: '12', displayName: 'Los Angeles Clippers', injuries: [player(0, { athlete: { displayName: 'Unverified player' } })] });
    injuryData = data;
    const value = await report();
    expect(value.warnings.some(warning => warning.startsWith('LAC:'))).toBe(false);
    expect(value.warnings.join(' ')).toContain('feed update time');
  });
  it.each([null, {}, { timestamp: now.toISOString(), injuries: 'bad' }])('reports malformed feeds as unavailable, not healthy', async input => {
    injuryData = input;
    const value = await report();
    expect(value.availability).toBe('unavailable');
    expect(value.teams.every(team => team.coverage === 'unavailable')).toBe(true);
    expect(value.fetchedAt).toBeNull();
  });
  it('marks an old provider timestamp stale even when just downloaded', async () => {
    injuryData = { ...feed(), timestamp: '2026-10-09T18:00:00Z' };
    expect(await report()).toMatchObject({ fetchedAt: now.toISOString(), feedUpdatedAt: '2026-10-09T18:00:00.000Z', stale: true });
  });
  it('reuses persisted cache within a minute without relabeling fetch time', async () => {
    await report(); vi.setSystemTime(now.getTime() + 30000);
    expect((await report()).fetchedAt).toBe(now.toISOString());
    expect(upstream.mock.calls.filter(([url]) => String(url).endsWith('/injuries'))).toHaveLength(1);
  });
  it('keeps the saved list and original timestamps visibly stale after a failed refresh, with backoff', async () => {
    await report(); vi.setSystemTime(now.getTime() + 61000); injuryStatus = 503;
    const value = await report();
    expect(value.stale).toBe(true);
    expect(value.fetchedAt).toBe(now.toISOString());
    expect(value.teams[0].players).toHaveLength(8);
    expect(value.warnings.join(' ')).toMatch(/saved|refresh/i);
    await report();
    expect(upstream.mock.calls.filter(([url]) => String(url).endsWith('/injuries'))).toHaveLength(2);
  });
  it('fetches the league list once for concurrent opens and never requests browser-supplied URLs', async () => {
    const values = await Promise.all([report(), report(), report()]);
    expect(values.every(value => value.teams[0].players.length === 8)).toBe(true);
    expect(upstream.mock.calls.filter(([url]) => String(url).endsWith('/injuries'))).toHaveLength(1);
  });
});
