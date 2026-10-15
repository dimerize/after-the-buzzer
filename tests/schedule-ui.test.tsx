import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScheduleTable } from '../src/Schedule';
import { fetchSchedule, formatScheduleDate, formatScheduleTipoff, nextScheduleDate, shiftScheduleDate, visibleScheduleRequest } from '../src/schedule-view';
import type { Game } from '../src/shared/types';
import { currentSlateDate, resolveScheduleDate } from '../src/schedule-view';

const game: Game = { id: '1', away: 'SAS', home: 'LAL', awayScore: 123, homeScore: 99, status: 'final', statusText: 'Final', startsAt: '2026-10-11T02:30:00Z', sourceUrl: 'https://www.espn.com/nba/game/_/gameId/1' };

describe('schedule calendar', () => {
  it('rolls the default date forward while retaining an explicitly selected archive day', () => {
    expect(resolveScheduleDate(null, new Date('2026-10-14T04:01:00Z'))).toBe('2026-10-14');
    expect(resolveScheduleDate('2026-10-01', new Date('2026-10-14T04:01:00Z'))).toBe('2026-10-01');
  });
  it('shows multiple watched players by team, distinguishing favorites from following', () => {
    const html = renderToStaticMarkup(<ScheduleTable games={[game]} date="2026-10-10" timezone="America/New_York" hideScores={false} players={[
      { id: '1', name: 'Favorite Spur', team: 'SA', tier: 'favorite', alerts: false },
      { id: '2', name: 'Followed Spur', team: 'SAS', tier: 'interest', alerts: false },
      { id: '3', name: 'Other Team', team: 'NY', tier: 'favorite', alerts: false },
    ]}/>);
    expect(html).toContain('Favorite Spur'); expect(html).toContain('Followed Spur');
    expect(html).not.toContain('Other Team'); expect(html).toContain('Favorite: Favorite Spur');
    expect(html).toContain('Following: Followed Spur'); expect(html).toContain('/headshots/nba/players/full/1.png');
  });
  it('turns a game with watched players on both teams into a marquee matchup with a TV chip', () => {
    const players = [{ id: '1', name: 'Favorite Spur', team: 'SAS', tier: 'favorite' as const, alerts: false }, { id: '2', name: 'Followed Laker', team: 'LAL', tier: 'interest' as const, alerts: false }];
    const marquee = renderToStaticMarkup(<ScheduleTable games={[{ ...game, status: 'scheduled', broadcasts: [{ market: 'national', type: 'tv', name: 'Prime Video' }] }]} date="2026-10-10" timezone="America/New_York" hideScores={false} players={players} tvMarket="NY"/>);
    expect(marquee).toContain('Marquee matchup');
    expect(marquee).toContain('watch-accent-marquee');
    expect(marquee).toContain('watch-chip-national');
    expect(marquee).toContain('>Prime Video<');
    const oneSide = renderToStaticMarkup(<ScheduleTable games={[game]} date="2026-10-10" timezone="America/New_York" hideScores={false} players={[players[1]]}/>);
    expect(oneSide).not.toContain('Marquee matchup');
    expect(oneSide).toContain('watch-accent-interest');
    expect(oneSide).not.toContain('watch-chip');
  });
  it.each([
    ['2026-10-15T04:30:00Z', '2026-10-14'],
    ['2026-10-15T10:00:00Z', '2026-10-15'],
    ['2026-11-01T10:30:00Z', '2026-10-31'],
    ['2026-11-01T11:30:00Z', '2026-11-01'],
  ])('keeps the recap slate on the previous night until 6 AM Eastern at %s', (now, expected) => {
    expect(currentSlateDate(new Date(now))).toBe(expected);
  });
  it.each([
    ['2026-10-10T09:59:59Z', '2026-10-10'],
    ['2026-10-10T10:00:00Z', '2026-10-10'],
    ['2026-03-08T09:59:59Z', '2026-03-08'],
    ['2026-03-08T10:00:00Z', '2026-03-08'],
    ['2026-11-01T10:59:59Z', '2026-11-01'],
    ['2026-11-01T11:00:00Z', '2026-11-01'],
    ['2026-12-31T12:00:00Z', '2026-12-31'],
    ['2027-01-01T04:59:59Z', '2026-12-31'],
    ['2027-01-01T05:00:00Z', '2027-01-01'],
  ])('defaults to the current Eastern calendar date at %s', (now, expected) => {
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
