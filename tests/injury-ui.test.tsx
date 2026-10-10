import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameInjuryReport } from '../src/shared/injury-types';
import type { Game } from '../src/shared/types';
import { fetchGameInjuries, visibleInjuryRequest, displayInjuryReport, beginInjuryRefresh, completeInjuryRefresh, isInjuryReportStale } from '../src/injury-view';
import { InjuryReportBody } from '../src/InjuryReport';
import { ScheduleTable } from '../src/Schedule';
import { GameRow } from '../src/App';

const game: Game = { id: '401', away: 'SAS', home: 'LAL', awayScore: null, homeScore: null, status: 'scheduled', statusText: 'Scheduled', startsAt: '2026-10-11T01:00:00Z', sourceUrl: 'https://www.espn.com/nba/game/_/gameId/401' };
const players = Array.from({ length: 7 }, (_, index) => ({ id: String(1000 + index), name: `Player ${index + 1}`, status: index ? 'Day-To-Day' : 'Out', reason: index ? 'Ankle' : 'Knee', updatedAt: '2026-10-10T15:20:00Z', estimatedReturn: null }));
const report: GameInjuryReport = { gameId: game.id, date: '2026-10-10', game, source: 'espn', sourceUrl: 'https://www.espn.com/nba/injuries', officialSourceUrl: 'https://official.nba.com/nba-injury-report-2026-27-season/', fetchedAt: '2026-10-10T15:30:00Z', feedUpdatedAt: '2026-10-10T15:10:00Z', stale: false, availability: 'current', teams: [{ team: 'SAS', displayName: 'San Antonio Spurs', coverage: 'reported', players }, { team: 'LAL', displayName: 'Los Angeles Lakers', coverage: 'not-listed', players: [] }], warnings: [] };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T15:31:00Z')); });
afterEach(() => vi.useRealTimers());

describe('injury request boundary', () => {
  it('sends the selected game and slate date with same-origin credentials', async () => {
    const loaded = await fetchGameInjuries(game, '2026-10-10', new AbortController().signal, async (url, init) => {
      expect(url).toBe('/api/injuries?date=2026-10-10&gameId=401');
      expect(init?.credentials).toBe('same-origin');
      return Response.json(report);
    });
    expect(loaded.teams[0].players).toHaveLength(7);
  });

  it('rejects a report belonging to another game or date', async () => {
    for (const payload of [{ ...report, gameId: '402' }, { ...report, date: '2026-10-09' }, { ...report, game: { ...game, home: 'BOS' } }]) {
      await expect(fetchGameInjuries(game, '2026-10-10', new AbortController().signal, async () => Response.json(payload))).rejects.toThrow('could not be verified');
    }
  });

  it('surfaces expired auth and server errors without pretending the feed is empty', async () => {
    await expect(fetchGameInjuries(game, '2026-10-10', new AbortController().signal, async () => Response.json({ error: 'Unauthorized' }, { status: 401 }))).rejects.toThrow('Sign in');
    await expect(fetchGameInjuries(game, '2026-10-10', new AbortController().signal, async () => Response.json({ error: 'ESPN feed unavailable.' }, { status: 503 }))).rejects.toThrow('ESPN feed unavailable.');
  });

  it('never displays an earlier game while a different request starts', () => {
    const state = { key: '2026-10-10:401', data: report, loading: false, error: '' };
    expect(visibleInjuryRequest(state, '2026-10-10:402')).toEqual({ key: '2026-10-10:402', data: null, loading: true, error: '' });
    expect(visibleInjuryRequest(state, state.key).data?.gameId).toBe('401');
  });

  it('keeps prior same-game rows marked stale when a refresh fails', () => {
    const state = { key: '2026-10-10:401', data: report, loading: false, error: 'Refresh failed.' };
    const visible = visibleInjuryRequest(state, state.key);
    expect(visible.data?.teams[0].players).toHaveLength(7);
    expect(visible.error).toBe('Refresh failed.');
  });

  it('keeps a failed same-game refresh warning visible until a successful response replaces it', () => {
    const failed = { key: '2026-10-10:401', data: report, loading: false, error: 'ESPN feed unavailable.' };
    const retrying = beginInjuryRefresh(failed, failed.key);
    expect(retrying).toMatchObject({ data: report, loading: true, error: 'ESPN feed unavailable.' });
    const refreshed = completeInjuryRefresh(retrying, failed.key, { ...report, fetchedAt: '2026-10-10T15:35:00Z' });
    expect(refreshed).toMatchObject({ loading: false, error: '', data: { fetchedAt: '2026-10-10T15:35:00Z' } });
    expect(completeInjuryRefresh(retrying, '2026-10-10:402', report)).toBe(retrying);
  });

  it('marks saved data stale after fetch or source age limits and for an unverified future source time', () => {
    const fresh = { ...report, fetchedAt: '2026-10-10T15:30:00Z', feedUpdatedAt: '2026-10-10T15:29:00Z' };
    expect(isInjuryReportStale(fresh, new Date('2026-10-10T15:31:59Z'))).toBe(false);
    expect(isInjuryReportStale(fresh, new Date('2026-10-10T15:32:01Z'))).toBe(true);
    expect(isInjuryReportStale({ ...fresh, fetchedAt: '2026-10-10T15:44:00Z' }, new Date('2026-10-10T15:45:01Z'))).toBe(true);
    expect(isInjuryReportStale({ ...fresh, fetchedAt: '2026-10-10T15:54:00Z', feedUpdatedAt: '2026-10-10T16:00:02Z' }, new Date('2026-10-10T15:54:00Z'))).toBe(true);
    expect(isInjuryReportStale({ ...fresh, feedUpdatedAt: null }, new Date('2026-10-10T15:31:00Z'))).toBe(true);
  });
});

describe('injury report content', () => {
  it('renders all seven entries, both team sections, statuses, reason, separate timestamps and sources', () => {
    const html = renderToStaticMarkup(<InjuryReportBody game={game} report={report} timezone="America/New_York" loading={false} error="" demo={false} onRetry={() => {}} onConnectLive={() => {}} />);
    for (const player of players) expect(html).toContain(player.name);
    for (const value of ['San Antonio Spurs', 'Los Angeles Lakers', 'Day-To-Day', 'Knee', 'ESPN injuries', 'NBA official injury report', 'Source updated', 'Checked', 'Entry updated']) expect(html).toContain(value);
    expect(html).toContain('No ESPN entries listed');
    expect(html).toContain('does not confirm');
  });

  it('marks a failed refresh stale without erasing the saved report', () => {
    const html = renderToStaticMarkup(<InjuryReportBody game={game} report={report} timezone="America/New_York" loading={false} error="ESPN feed unavailable." demo={false} onRetry={() => {}} onConnectLive={() => {}} />);
    expect(html).toContain('Player 7');
    expect(html).toContain('Previously checked data');
    expect(html).toContain('ESPN feed unavailable.');
  });

  it('labels an aging same-game report stale during a refresh even when the server had marked it fresh earlier', () => {
    const html = renderToStaticMarkup(<InjuryReportBody game={game} report={{ ...report, fetchedAt: '2026-10-10T15:30:00Z', feedUpdatedAt: '2026-10-10T15:29:00Z' }} now={new Date('2026-10-10T15:33:00Z')} timezone="America/New_York" loading error="" demo={false} onRetry={() => {}} onConnectLive={() => {}} />);
    expect(html).toContain('Player 7');
    expect(html).toContain('Saved report may be outdated');
  });

  it('offers sign-in when an expired session prevents a report refresh', () => {
    const html = renderToStaticMarkup(<InjuryReportBody game={game} report={null} timezone="America/New_York" loading={false} error="Sign in to load injury reports." demo={false} onRetry={() => {}} onConnectLive={() => {}} />);
    expect(html).toContain('Sign in to load injury reports.');
    expect(html).toContain('>Sign in<');
  });

  it('does not show current rows for a final or past game', () => {
    expect(displayInjuryReport(report, { ...game, status: 'final' }, '2026-10-10', new Date('2026-10-10T15:45:00Z')).teams[0].players).toHaveLength(0);
    expect(displayInjuryReport(report, game, '2026-10-10', new Date('2026-10-12T15:45:00Z')).teams[0].players).toHaveLength(0);
    const html = renderToStaticMarkup(<InjuryReportBody game={{ ...game, status: 'final' }} report={report} timezone="America/New_York" loading={false} error="" demo={false} onRetry={() => {}} onConnectLive={() => {}} />);
    expect(html).not.toContain('Player 7');
    expect(html).toContain('Historical injury report unavailable');
  });

  it('distinguishes unavailable coverage and sample mode from a clean injury list', () => {
    const unavailable = renderToStaticMarkup(<InjuryReportBody game={game} report={{ ...report, availability: 'unavailable', teams: report.teams.map(team => ({ ...team, coverage: 'unavailable', players: [] })) }} timezone="America/New_York" loading={false} error="" demo={false} onRetry={() => {}} onConnectLive={() => {}} />);
    expect(unavailable).toContain('Injury data unavailable');
    expect(unavailable).not.toContain('No ESPN entries listed');
    const demo = renderToStaticMarkup(<InjuryReportBody game={game} report={null} timezone="America/New_York" loading={false} error="" demo onRetry={() => {}} onConnectLive={() => {}} />);
    expect(demo).toContain('Sample mode');
    expect(demo).toContain('Connect live data');
  });
});

describe('game entry points', () => {
  it('makes the schedule matchup an accessible button while preserving its ESPN source link', () => {
    const html = renderToStaticMarkup(<ScheduleTable games={[game]} date="2026-10-10" timezone="America/New_York" hideScores={false} onOpenGame={() => {}} />);
    expect(html).toContain('<button');
    expect(html).toContain('Open injury report for SAS at LAL');
    expect(html).toContain(game.sourceUrl);
  });

  it('makes a recap game open the report with its original ESPN source still visible', () => {
    const html = renderToStaticMarkup(<GameRow game={game} hideScores={false} onOpen={() => {}} />);
    expect(html).toContain('<button');
    expect(html).toContain('Open injury report for SAS at LAL');
    expect(html).toContain(game.sourceUrl);
  });
});
