import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScheduleTable } from '../src/Schedule';
import { fetchSchedule, formatScheduleDate, formatScheduleTipoff, nextScheduleDate, shiftScheduleDate, visibleScheduleRequest } from '../src/schedule-view';
import type { Game } from '../src/shared/types';

const game: Game = { id: '1', away: 'SAS', home: 'LAL', awayScore: 123, homeScore: 99, status: 'final', statusText: 'Final', startsAt: '2026-10-11T02:30:00Z', sourceUrl: 'https://www.espn.com/nba/game/_/gameId/1' };

describe('schedule calendar', () => {
  it.each([
    ['2026-10-10T09:59:59Z', '2026-10-10'],
    ['2026-10-10T10:00:00Z', '2026-10-11'],
    ['2026-03-08T09:59:59Z', '2026-03-08'],
    ['2026-03-08T10:00:00Z', '2026-03-09'],
    ['2026-11-01T10:59:59Z', '2026-11-01'],
    ['2026-11-01T11:00:00Z', '2026-11-02'],
    ['2026-12-31T12:00:00Z', '2027-01-01'],
  ])('defaults to the next Eastern basketball date at %s', (now, expected) => {
    expect(nextScheduleDate(new Date(now))).toBe(expected);
  });

  it('moves calendar dates across leap days and year boundaries without local DST arithmetic', () => {
    expect(shiftScheduleDate('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftScheduleDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftScheduleDate('2026-03-08', 1)).toBe('2026-03-09');
    expect(shiftScheduleDate('2026-02-30', 1)).toBeNull();
  });

  it('formats an explicit slate date without shifting it into the viewer timezone', () => {
    expect(formatScheduleDate('2026-10-10')).toBe('Saturday, October 10, 2026');
  });

  it('converts tipoff to the preferred timezone and marks a different local calendar day', () => {
    expect(formatScheduleTipoff(game.startsAt, 'America/Los_Angeles', '2026-10-10')).toEqual({ time: '7:30 PM', date: null });
    expect(formatScheduleTipoff(game.startsAt, 'Europe/London', '2026-10-10')).toEqual({ time: '3:30 AM', date: 'Oct 11' });
    expect(formatScheduleTipoff('', 'America/New_York', '2026-10-10')).toEqual({ time: 'TBD', date: null });
  });
});

describe('schedule request boundary', () => {
  it('requests the chosen date with authentication and no recap/summary fetches', async () => {
    const response = await fetchSchedule('2026-10-10', new AbortController().signal, async (url, init) => {
      expect(url).toBe('/api/schedule?date=2026-10-10');
      expect(init?.credentials).toBe('same-origin');
      return Response.json({ date: '2026-10-10', source: 'espn', games: [game], updatedAt: '2026-10-10T12:00:00Z' });
    });
    expect(response.games[0].home).toBe('LAL');
  });

  it('rejects expired sessions and server failures instead of inventing a schedule', async () => {
    await expect(fetchSchedule('2026-10-10', new AbortController().signal, async () => Response.json({ error: 'Unauthorized' }, { status: 401 }))).rejects.toThrow('Sign in');
    await expect(fetchSchedule('2026-10-10', new AbortController().signal, async () => Response.json({ error: 'ESPN is unavailable.' }, { status: 503 }))).rejects.toThrow('ESPN is unavailable.');
  });

  it('rejects a response for a different day or a fictional source', async () => {
    for (const payload of [
      { date: '2026-10-09', source: 'espn', games: [game], updatedAt: '2026-10-10T12:00:00Z' },
      { date: '2026-10-10', source: 'demo', games: [game], updatedAt: '2026-10-10T12:00:00Z' },
    ]) await expect(fetchSchedule('2026-10-10', new AbortController().signal, async () => Response.json(payload))).rejects.toThrow('Schedule data could not be verified');
  });

  it('does not flash a prior date or prior error while the new date request starts', () => {
    const previous = { key: '2026-10-10:0', data: { date: '2026-10-10', source: 'espn' as const, games: [game], updatedAt: '' }, loading: false, error: 'Old error' };
    expect(visibleScheduleRequest(previous, '2026-10-11:0')).toEqual({ key: '2026-10-11:0', data: null, loading: true, error: '' });
  });
});

describe('schedule grid', () => {
  it('renders real teams, a local tipoff, final scores, and the provider source', () => {
    const html = renderToStaticMarkup(<ScheduleTable games={[game]} date="2026-10-10" timezone="America/Los_Angeles" hideScores={false} />);
    for (const value of ['<table', 'SAS', 'LAL', '7:30 PM', '123', '99', 'Final', game.sourceUrl]) expect(html).toContain(value);
  });

  it('removes game scores from the rendered markup when hidden, without inventing scheduled zeros', () => {
    const hidden = renderToStaticMarkup(<ScheduleTable games={[game]} date="2026-10-10" timezone="America/New_York" hideScores />);
    expect(hidden).not.toContain('123');
    expect(hidden).not.toContain('99');
    expect(hidden).toContain('••');
    const scheduled = renderToStaticMarkup(<ScheduleTable games={[{ ...game, status: 'scheduled', statusText: 'Scheduled', awayScore: 0, homeScore: 0 }]} date="2026-10-10" timezone="America/New_York" hideScores={false} />);
    expect(scheduled).toContain('—');
    expect(scheduled).not.toContain('0 – 0');
  });

  it('keeps zero live scores distinct from missing scores', () => {
    const html = renderToStaticMarkup(<ScheduleTable games={[{ ...game, status: 'live', statusText: '12:00 - 1st', awayScore: 0, homeScore: null }]} date="2026-10-10" timezone="America/New_York" hideScores={false} />);
    expect(html).toContain('0 – —');
  });
});
