import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game } from '../src/shared/types';
import { loadGameBoxScore, parseGameBoxScore } from '../worker/boxscores';

const now = new Date('2026-10-10T12:00:00.000Z');
const game: Game = { id: '401809949', away: 'SAS', home: 'NOP', awayScore: 120, homeScore: 116, status: 'final', statusText: 'Final', startsAt: '2025-10-24T23:00:00Z', sourceUrl: 'https://www.espn.com/nba/game/_/gameId/401809949' };
const keys = ['minutes', 'points', 'fieldGoalsMade-fieldGoalsAttempted', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted', 'rebounds', 'assists', 'turnovers', 'steals', 'blocks', 'offensiveRebounds', 'defensiveRebounds', 'fouls', 'plusMinus'];
const labels = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'];
const stats = ['30:30', '29', '13-23', '0-3', '3-4', '11', '2', '0', '1', '9', '3', '8', '6', '-12'];
function athlete(id: string, options: Record<string, unknown> = {}) {
  return { athlete: { id, displayName: `Player ${id}`, headshot: { href: `https://example.com/${id}.png` }, experience: { years: 2 } }, starter: true, didNotPlay: false, reason: "COACH'S DECISION", stats, ...options };
}
function summary(awayRows: unknown[] = [athlete('10'), athlete('11', { starter: false, didNotPlay: true, stats: [] })], homeRows: unknown[] = [athlete('20')]) {
  const block = (abbreviation: string, rows: unknown[]) => ({ team: { abbreviation }, statistics: [{ keys, labels, names: labels, athletes: rows }] });
  return { header: { id: game.id, competitions: [{ id: game.id, competitors: [
    { homeAway: 'home', team: { abbreviation: 'NO' } }, { homeAway: 'away', team: { abbreviation: 'SA' } }
  ] }] }, boxscore: { players: [block('SA', awayRows), block('NO', homeRows)] } };
}
function db() {
  const rows = new Map<string, { payload: string; updated_at: number }>();
  return { rows, database: { prepare(sql: string) {
    return { bind(...args: unknown[]) {
      return {
        async first() { if (!sql.startsWith('SELECT')) throw new Error(`Unexpected read: ${sql}`); return rows.get(String(args[0])) ?? null; },
        async run() { if (!sql.startsWith('INSERT')) throw new Error(`Unexpected write: ${sql}`); rows.set(String(args[0]), { payload: String(args[1]), updated_at: Number(args[2]) }); return { success: true }; }
      };
    } };
  } } as unknown as D1Database };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('full ESPN box score parser', () => {
  it('keeps away/home rows, starter and bench states, DNP reason, decimal minutes and shooting pairs', () => {
    const result = parseGameBoxScore(summary(), game, '2025-10-24', now.toISOString());
    expect(result.teams.map(team => team.team)).toEqual(['SAS', 'NOP']);
    expect(result.teams[0].players).toHaveLength(2);
    expect(result.teams[0].players[0]).toMatchObject({ id: '10', starter: true, starterKnown: true, didNotPlay: false, didNotPlayReason: null,
      minutes: 30.5, points: 29, fgMade: 13, fgAttempted: 23, threes: 0, threesAttempted: 3,
      ftMade: 3, ftAttempted: 4, offensiveRebounds: 3, defensiveRebounds: 8, fouls: 6, plusMinus: -12 });
    expect(result.teams[0].players[1]).toMatchObject({ id: '11', starter: false, starterKnown: true, didNotPlay: true, didNotPlayReason: "COACH'S DECISION" });
    expect(result.teams[1].players[0].id).toBe('20');
    expect(result).toMatchObject({ availability: 'available', stale: false, fetchedAt: now.toISOString() });
  });

  it('preserves missing extra stats as null and unknown starter state', () => {
    const limited = summary([athlete('10', { starter: undefined })]);
    const block = limited.boxscore.players[0].statistics[0];
    block.keys = keys.slice(0, 10); block.labels = labels.slice(0, 10); block.names = labels.slice(0, 10);
    const result = parseGameBoxScore(limited, game, '2025-10-24', now.toISOString());
    expect(result.teams[0].players[0]).toMatchObject({ starter: false, starterKnown: false, threesAttempted: 3,
      offensiveRebounds: null, defensiveRebounds: null, fouls: null });
  });

  it('rejects mismatched game header or competition teams', () => {
    const wrongId = summary(); wrongId.header.id = '999';
    expect(() => parseGameBoxScore(wrongId, game, '2025-10-24', now.toISOString())).toThrow(/match/i);
    const wrongTeam = summary(); wrongTeam.header.competitions[0].competitors[0].team.abbreviation = 'BOS';
    expect(() => parseGameBoxScore(wrongTeam, game, '2025-10-24', now.toISOString())).toThrow(/match/i);
  });

  it('skips unknown team and malformed rows and reports partial coverage', () => {
    const data = summary([athlete('10', { stats: ['bad'] }), athlete('12')], []);
    data.boxscore.players[1].team.abbreviation = 'BOS';
    const result = parseGameBoxScore(data, game, '2025-10-24', now.toISOString());
    expect(result.teams[0].players.map(player => player.id)).toEqual(['12']);
    expect(result.teams[1].players).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/malformed|incomplete/i);
    expect(result.warnings.join(' ')).toMatch(/NOP/);
  });
});

describe('box score loading', () => {
  it('does not fetch a scheduled game', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('unexpected fetch'); });
    const result = await loadGameBoxScore(db().database, { ...game, status: 'scheduled' }, '2025-10-24');
    expect(result).toMatchObject({ availability: 'not-started', fetchedAt: null, stale: false });
    expect(result.teams.map(team => team.players.length)).toEqual([0, 0]);
  });

  it('fetches only the verified ESPN event and caches it for a final game', async () => {
    const database = db().database;
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { calls.push(String(url)); return Response.json(summary()); });
    const first = await loadGameBoxScore(database, game, '2025-10-24');
    const second = await loadGameBoxScore(database, game, '2025-10-24');
    expect(calls).toEqual(['https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401809949']);
    expect(second.teams[0].players.map(player => player.id)).toEqual(['10', '11']);
    expect(second.fetchedAt).toBe(first.fetchedAt);
  });

  it('refreshes live scores after the short cache window', async () => {
    const database = db().database;
    let points = 29;
    vi.stubGlobal('fetch', async () => {
      return Response.json(summary([athlete('10', { stats: [stats[0], String(points), ...stats.slice(2)] })]));
    });
    const live = { ...game, status: 'live' as const };
    const first = await loadGameBoxScore(database, live, '2025-10-24');
    points = 31;
    vi.setSystemTime(new Date(now.getTime() + 46_000));
    const second = await loadGameBoxScore(database, live, '2025-10-24');
    expect(first.teams[0].players[0].points).toBe(29);
    expect(second.teams[0].players[0].points).toBe(31);
    expect(second.fetchedAt).not.toBe(first.fetchedAt);
  });

  it('refreshes a live snapshot when the verified game becomes final', async () => {
    const database = db().database;
    let points = 29;
    vi.stubGlobal('fetch', async () => {
      return Response.json(summary([athlete('10', { stats: [stats[0], String(points), ...stats.slice(2)] })]));
    });
    await loadGameBoxScore(database, { ...game, status: 'live' }, '2025-10-24');
    points = 31;
    vi.setSystemTime(new Date(now.getTime() + 10_000));
    const result = await loadGameBoxScore(database, game, '2025-10-24');
    expect(result.teams[0].players[0].points).toBe(31);
    expect(result.fetchedAt).toBe('2026-10-10T12:00:10.000Z');
  });

  it('returns stale cached rows and original timestamp when refresh fails', async () => {
    const database = db().database;
    vi.stubGlobal('fetch', async () => Response.json(summary()));
    const first = await loadGameBoxScore(database, { ...game, status: 'live' }, '2025-10-24');
    vi.setSystemTime(new Date(now.getTime() + 61_000));
    vi.stubGlobal('fetch', async () => new Response('unavailable', { status: 503 }));
    const fallback = await loadGameBoxScore(database, { ...game, status: 'live' }, '2025-10-24');
    expect(fallback).toMatchObject({ stale: true, availability: 'available', fetchedAt: first.fetchedAt });
    expect(fallback.teams[0].players.map(player => player.id)).toEqual(['10', '11']);
    expect(fallback.warnings.join(' ')).toMatch(/stale|refresh|unavailable/i);
  });

  it('keeps saved rows when a later ESPN response has no player coverage', async () => {
    const database = db().database;
    vi.stubGlobal('fetch', async () => Response.json(summary()));
    const first = await loadGameBoxScore(database, { ...game, status: 'live' }, '2025-10-24');
    vi.setSystemTime(new Date(now.getTime() + 61_000));
    vi.stubGlobal('fetch', async () => Response.json(summary([], [])));
    const fallback = await loadGameBoxScore(database, { ...game, status: 'live' }, '2025-10-24');
    expect(fallback).toMatchObject({ stale: true, availability: 'available', fetchedAt: first.fetchedAt });
    expect(fallback.teams[0].players.map(player => player.id)).toEqual(['10', '11']);
  });

  it('returns unavailable without a fabricated timestamp after malformed provider data', async () => {
    vi.stubGlobal('fetch', async () => Response.json({}));
    const result = await loadGameBoxScore(db().database, game, '2025-10-24');
    expect(result).toMatchObject({ availability: 'unavailable', fetchedAt: null, stale: false });
    expect(result.teams.map(team => team.players.length)).toEqual([0, 0]);
  });

  it('rejects an oversized response body and returns unavailable', async () => {
    vi.stubGlobal('fetch', async () => new Response('x'.repeat(1_500_001)));
    const result = await loadGameBoxScore(db().database, game, '2025-10-24');
    expect(result).toMatchObject({ availability: 'unavailable', fetchedAt: null });
    expect(result.teams.map(team => team.players.length)).toEqual([0, 0]);
  });
});
