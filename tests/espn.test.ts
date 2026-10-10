import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/shared/defaults';
import type { Game } from '../src/shared/types';
import { fetchNight, parseRookieRoster, parseScoreboard, parseSummary } from '../worker/espn';

const game: Game = { id: '101', away: 'SAS', home: 'LAL', awayScore: 110, homeScore: 100, status: 'final', statusText: 'Final', startsAt: '2025-10-25T02:00Z', sourceUrl: 'https://www.espn.com/nba/game/_/gameId/101' };
const labels = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'];
const stats = ['30:30', '32', '12-20', '4-8', '4-5', '11', '6', '2', '1', '5', '3', '8', '2', '+10'];
function row(id = '5104157', values = stats) { return { athlete: { id, displayName: id === '5104157' ? 'Victor Wembanyama' : 'Other Player' }, starter: true, didNotPlay: false, stats: values }; }
function summary(rows: unknown[] = [row()]) {
  return { header: { id: '101', season: { year: 2026, type: 2 } }, boxscore: { players: [
    { team: { abbreviation: 'SA' }, statistics: [{ labels, athletes: rows }] },
    { team: { abbreviation: 'LAL' }, statistics: [{ labels, athletes: [row('1966')] }] }
  ] } };
}
function event(id = '101', type: Record<string, unknown> = { name: 'STATUS_FINAL', state: 'post', completed: true }) {
  return { id, date: '2025-10-25T02:00Z', season: { year: 2026, type: 2 }, status: { type }, competitions: [{ competitors: [
    { homeAway: 'away', team: { abbreviation: 'SA' }, score: '110' },
    { homeAway: 'home', team: { abbreviation: 'LAL' }, score: '100' }
  ] }] };
}
function board(events: unknown[] = [event()]) { return { leagues: [{ season: { year: 2026, displayName: '2025-26', type: { type: 2 } } }], events }; }

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('ESPN normalization', () => {
  it('preserves basketball-date overnight games and normalizes team abbreviations', () => {
    const result = parseScoreboard(board(), '2025-10-24');
    expect(result.games[0]).toMatchObject({ id: '101', away: 'SAS', home: 'LAL', awayScore: 110, homeScore: 100, status: 'final' });
    expect(result.games[0].startsAt).toBe('2025-10-25T02:00Z');
    expect(result).toMatchObject({ season: '2025-26', seasonType: 'regular', warnings: [] });
  });
  it('preserves absent scores as unknown rather than fabricated zeroes', () => {
    const e = event();
    e.competitions[0].competitors[0].score = '';
    const result = parseScoreboard(board([e]), '2025-10-24');
    expect(result.games[0].awayScore).toBeNull();
    expect(result.warnings.some(warning => /score/i.test(warning))).toBe(true);
  });
  it.each([
    [{ name: 'STATUS_SCHEDULED', state: 'pre', completed: false }, 'scheduled'],
    [{ name: 'STATUS_IN_PROGRESS', state: 'in', completed: false }, 'live'],
    [{ name: 'STATUS_POSTPONED', state: 'post', completed: true }, 'postponed'],
    [{ name: 'STATUS_CANCELED', state: 'post', completed: true }, 'postponed']
  ])('distinguishes provider status %j', (status, expected) => {
    expect(parseScoreboard(board([event('101', status)]), '2025-10-24').games[0].status).toBe(expected);
  });
  it('rejects a malformed scoreboard and skips malformed individual events with a warning', () => {
    expect(() => parseScoreboard({}, '2025-10-24')).toThrow(/scoreboard/i);
    const result = parseScoreboard(board([{}, event()]), '2025-10-24');
    expect(result.games).toHaveLength(1);
    expect(result.warnings).not.toHaveLength(0);
  });
  it('parses reordered statistics by their labels, fractions and signed plus/minus', () => {
    const data = summary();
    data.boxscore.players[0].statistics[0].labels = [...labels].reverse();
    data.boxscore.players[0].statistics[0].athletes = [row('5104157', [...stats].reverse())];
    const result = parseSummary(data, game);
    expect(result.players[0]).toMatchObject({ id: '5104157', points: 32, minutes: 30.5, rebounds: 11, assists: 6, blocks: 5, threes: 4, fgMade: 12, fgAttempted: 20, ftMade: 4, ftAttempted: 5, plusMinus: 10, team: 'SAS', opponent: 'LAL', rookie: false });
    expect(result.warnings).toEqual([]);
  });
  it('retains explicit DNP but does not infer DNP from zero minutes or player name', () => {
    const result = parseSummary(summary([
      { ...row(), didNotPlay: true, stats: [] },
      row('2', ['0', '0', '0-0', '0-0', '0-0', '0', '0', '0', '0', '0', '0', '0', '0', '--'])
    ]), game);
    expect(result.players[0]).toMatchObject({ didNotPlay: true, points: 0, minutes: 0 });
    expect(result.players[1]).toMatchObject({ didNotPlay: false, minutes: 0, rookie: false, plusMinus: null });
  });
  it('does not turn absent or malformed player statistics into a real stat line', () => {
    const broken = [...stats]; broken[1] = '32oops';
    const result = parseSummary(summary([row('bad', broken), row('missing', []), row()]), game);
    expect(result.players.map(player => player.id)).toEqual(['5104157', '1966']);
    expect(result.warnings).toHaveLength(2);
  });
  it('flags missing team box scores and rejects a mismatched summary', () => {
    expect(parseSummary({}, game).warnings).not.toHaveLength(0);
    expect(() => parseSummary({ ...summary(), header: { id: '999' } }, game)).toThrow(/match/i);
  });
  it('requires season-specific roster evidence for rookie status', () => {
    const roster = { season: { year: 2027 }, athletes: [
      { id: '5254165', experience: { years: 0 } }, { id: '5037871', experience: { years: 2 } }, { id: 'unknown' }
    ] };
    const rookies = parseRookieRoster(roster, 2027);
    expect(rookies.get('5254165')).toBe(true);
    expect(rookies.get('5037871')).toBe(false);
    expect(rookies.has('unknown')).toBe(false);
    expect(() => parseRookieRoster(roster, 2026)).toThrow(/season/i);
    expect(() => parseRookieRoster({ season: { year: 2027 }, athletes: [] }, 2027)).toThrow(/roster/i);
  });
});

describe('dated ESPN fetching', () => {
  it('retains successful box scores when one summary fails after bounded retry', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input); requests.push(url);
      if (url.includes('/scoreboard')) return Response.json(board([event(), event('202')]));
      if (url.includes('event=101')) return Response.json(summary());
      return new Response('temporary failure', { status: 503 });
    });
    const night = await fetchNight('2025-10-24', DEFAULT_PREFERENCES);
    expect(requests[0]).toContain('dates=20251024');
    expect(night.games).toHaveLength(2);
    expect(night.players.map(player => player.id)).toEqual(['5104157', '1966']);
    expect(night.partial).toBe(true);
    expect(night.edition).toBe('live');
    expect(night.summary).toMatch(/incomplete|partial|unavailable/i);
    expect(night.warnings.join(' ')).toContain('202');
    expect(requests.filter(url => url.includes('event=202')).length).toBeLessThanOrEqual(3);
  });
  it('rejects total provider failure instead of publishing an empty final recap', async () => {
    vi.stubGlobal('fetch', async () => new Response('unavailable', { status: 503 }));
    await expect(fetchNight('2025-10-24', DEFAULT_PREFERENCES)).rejects.toThrow(/ESPN|scoreboard/);
  });
  it('does not request summaries before tipoff, and an empty date is not a final edition', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      if (!String(input).includes('/scoreboard')) throw new Error('No box score expected before tipoff');
      return Response.json(board([event('101', { name: 'STATUS_SCHEDULED', state: 'pre' })]));
    });
    const scheduled = await fetchNight('2025-10-24', DEFAULT_PREFERENCES);
    expect(scheduled.partial).toBe(false);
    expect(scheduled.players).toEqual([]);
    vi.stubGlobal('fetch', async () => Response.json(board([])));
    const empty = await fetchNight('2025-10-24', DEFAULT_PREFERENCES);
    expect(empty.edition).toBe('live');
    expect(empty.headline).toMatch(/no games/i);
  });
  it('rejects an invalid date before fetching', async () => {
    await expect(fetchNight('2025-02-30', DEFAULT_PREFERENCES)).rejects.toThrow(/date/i);
  });
  it('enriches rookie status from the matching season and leaves historical labels unguessed', async () => {
    const e = event(); e.season.year = 2027;
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/scoreboard')) return Response.json(board([e]));
      if (url.includes('/summary')) return Response.json(summary());
      if (url.includes('/teams/sas/roster?season=2027')) return Response.json({ season: { year: 2027 }, athletes: [{ id: '5104157', experience: { years: 0 } }] });
      if (url.includes('/teams/lal/roster?season=2027')) return Response.json({ season: { year: 2027 }, athletes: [{ id: '1966', experience: { years: 23 } }] });
      return new Response('unavailable', { status: 404 });
    });
    const night = await fetchNight('2026-10-10', DEFAULT_PREFERENCES);
    expect(night.players.find(player => player.id === '5104157')?.rookie).toBe(true);
    expect(night.players.find(player => player.id === '1966')?.rookie).toBe(false);
    // Rookie metadata survives even when a stronger standout story wins the player's single slot.
    expect(night.highlights.filter(highlight => highlight.playerId === '5104157')).toHaveLength(1);
    expect(night.partial).toBe(false);
    expect(night.edition).toBe('final');
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/scoreboard')) return Response.json(board());
      if (url.includes('/summary')) return Response.json(summary());
      return Response.json({ season: { year: 2026 }, athletes: [] });
    });
    const historical = await fetchNight('2025-10-24', DEFAULT_PREFERENCES);
    expect(historical.players.every(player => !player.rookie)).toBe(true);
    expect(historical.edition).toBe('final');
    expect(historical.warnings.join(' ')).toMatch(/rookie.*unavailable/i);
  });
  it('times out a hanging scoreboard and stops after its bounded retry', async () => {
    vi.useFakeTimers();
    let requests = 0;
    vi.stubGlobal('fetch', (_input: unknown, init: RequestInit) => {
      requests++;
      return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('Timeout'))));
    });
    const rejection = expect(fetchNight('2025-10-24', DEFAULT_PREFERENCES)).rejects.toThrow(/ESPN/);
    await vi.advanceTimersByTimeAsync(14000);
    await rejection;
    expect(requests).toBe(2);
  });
  it('caps external requests on a full slate with transient failures and uncached rosters', async () => {
    const events = Array.from({ length: 15 }, (_, index) => {
      const e = event(String(500 + index));
      e.season.year = 2028;
      e.competitions[0].competitors[0].team.abbreviation = `A${index}`;
      e.competitions[0].competitors[1].team.abbreviation = `H${index}`;
      return e;
    });
    const attempts = new Map<string, number>();
    let requests = 0;
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      requests++;
      const url = new URL(String(input));
      if (url.pathname.endsWith('/scoreboard')) return Response.json(board(events));
      if (url.pathname.endsWith('/summary')) {
        const id = url.searchParams.get('event')!;
        const count = (attempts.get(id) ?? 0) + 1; attempts.set(id, count);
        if (count === 1) return new Response('retry', { status: 503 });
        const data = summary(); data.header.id = id;
        const index = Number(id) - 500;
        data.boxscore.players[0].team.abbreviation = `A${index}`;
        data.boxscore.players[1].team.abbreviation = `H${index}`;
        return Response.json(data);
      }
      return Response.json({ season: { year: 2028 }, athletes: [] });
    });
    const night = await fetchNight('2027-10-24', DEFAULT_PREFERENCES);
    expect(night.games).toHaveLength(15);
    expect(night.players).toHaveLength(30);
    expect(night.edition).toBe('final');
    expect(requests).toBeLessThanOrEqual(40);
    expect(night.warnings.join(' ')).toMatch(/rookie status unavailable/i);
  });
});
