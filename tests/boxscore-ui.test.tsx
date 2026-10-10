import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GameBoxScore, BoxScorePlayer } from '../src/shared/boxscore-types';
import type { Game } from '../src/shared/types';
import { beginBoxScoreRefresh, completeBoxScoreRefresh, failBoxScoreRefresh, fetchGameBoxScore, sortBoxScorePlayers, visibleBoxScoreRequest, watchPlayerFromBoxScore } from '../src/boxscore-view';
import { BoxScoreBody } from '../src/BoxScore';
import GameReport from '../src/GameReport';

const game: Game = { id: '401', away: 'SAS', home: 'LAL', awayScore: 112, homeScore: 108, status: 'final', statusText: 'Final', startsAt: '2026-10-10T23:00:00Z', sourceUrl: 'https://www.espn.com/nba/game/_/gameId/401' };
const line = (id: string, name: string, changes: Partial<BoxScorePlayer> = {}): BoxScorePlayer => ({
  id, name, team: 'SAS', opponent: 'LAL', gameId: '401', rookie: false, status: 'final', starter: false, starterKnown: true,
  didNotPlay: false, didNotPlayReason: null, headshot: `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`,
  points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, threes: 0, threesAttempted: null, minutes: 0,
  fgMade: 0, fgAttempted: 0, ftMade: 0, ftAttempted: 0, offensiveRebounds: null, defensiveRebounds: null,
  turnovers: 0, fouls: null, plusMinus: null, ...changes,
});
const report: GameBoxScore = { gameId: '401', date: '2026-10-10', game, source: 'espn', sourceUrl: game.sourceUrl, fetchedAt: '2026-10-11T02:00:00Z', stale: false, availability: 'available', warnings: [], teams: [
  { team: 'SAS', players: [line('1', 'Starter', { starter: true, minutes: 35.5, points: 24, fgMade: 9, fgAttempted: 16, threes: 3, threesAttempted: 6, offensiveRebounds: 2, defensiveRebounds: 7, fouls: 3 }), line('2', 'Bench', { points: 10, minutes: 12 }), line('3', 'Unknown', { starterKnown: false, points: 8 }), line('4', 'DNP', { didNotPlay: true, didNotPlayReason: 'Coach decision' })] },
  { team: 'LAL', players: [line('5', 'Home player', { team: 'LAL', opponent: 'SAS', points: 18, starter: true })] },
] };

describe('box score request', () => {
  it('uses the selected date and game with same-origin credentials', async () => {
    const loaded = await fetchGameBoxScore(game, report.date, new AbortController().signal, async (url, init) => {
      expect(url).toBe('/api/boxscore?date=2026-10-10&gameId=401');
      expect(init?.credentials).toBe('same-origin');
      return Response.json(report);
    });
    expect(loaded.teams[0].players[0].name).toBe('Starter');
  });

  it('rejects a previous game, date, team or malformed player', async () => {
    const bad = [
      { ...report, gameId: '402' }, { ...report, date: '2026-10-09' },
      { ...report, teams: [{ ...report.teams[0], team: 'BOS' }, report.teams[1]] },
      { ...report, teams: [] },
      { ...report, teams: [{ ...report.teams[0], players: [{ ...report.teams[0].players[0], team: 'LAL' }] }, report.teams[1]] },
    ];
    for (const payload of bad) await expect(fetchGameBoxScore(game, report.date, new AbortController().signal, async () => Response.json(payload))).rejects.toThrow('could not be verified');
  });

  it('keeps earlier rows out of a new game and keeps same-game rows after failure', () => {
    const old = { key: '2026-10-10:401', data: report, loading: false, error: '' };
    expect(visibleBoxScoreRequest(old, '2026-10-10:402').data).toBeNull();
    const refreshing = beginBoxScoreRefresh(old, old.key);
    const failed = failBoxScoreRefresh(refreshing, old.key, 'Network unavailable');
    expect(failed.data?.fetchedAt).toBe('2026-10-11T02:00:00Z');
    expect(failed.error).toBe('Network unavailable');
    expect(completeBoxScoreRefresh(failed, '2026-10-10:402', { ...report, fetchedAt: 'later' })).toBe(failed);
  });
});

describe('box score presentation', () => {
  it('sorts numeric values within groups and keeps DNP and missing values at bottom', () => {
    const rows = [line('1', 'Ten', { points: 10 }), line('2', 'Two', { points: 2 }), line('3', 'DNP first', { didNotPlay: true }), line('4', 'Missing', { plusMinus: null }), line('5', 'Five', { points: 5, plusMinus: 4 }), line('6', 'DNP second', { didNotPlay: true, points: 99 })];
    expect(sortBoxScorePlayers(rows, 'points', 'desc').map(player => player.name)).toEqual(['Ten', 'Five', 'Two', 'Missing', 'DNP first', 'DNP second']);
    expect(sortBoxScorePlayers(rows, 'plusMinus', 'asc').map(player => player.name)).toEqual(['Five', 'Ten', 'Two', 'Missing', 'DNP first', 'DNP second']);
  });

  it('adds a player as an interest without opting into either alert type', () => {
    expect(watchPlayerFromBoxScore(report.teams[0].players[0])).toEqual({ id: '1', name: 'Starter', team: 'SAS', tier: 'interest', alerts: false });
  });

  it('renders both teams, starter/bench/unknown/DNP groups and unavailable extras as dashes', () => {
    const html = renderToStaticMarkup(<BoxScoreBody game={game} report={report} timezone="America/New_York" loading={false} error="" demo={false} hideScores={false} watchedIds={[]} onWatch={() => {}} onRetry={() => {}} onConnectLive={() => {}} />);
    for (const value of ['SAS', 'LAL', 'Starter', 'Bench', 'Unknown', 'DNP', 'Coach decision', 'Starters', 'Bench', 'Starter unknown', 'Did not play', '35.5', '9-16', '3-6']) expect(html).toContain(value);
    expect(html).toContain('Add Starter to Watchlist');
    expect(html).toContain('>—<');
  });

  it('shows watched state and masks scores until an explicit local reveal', () => {
    const hidden = renderToStaticMarkup(<BoxScoreBody game={game} report={report} timezone="America/New_York" loading={false} error="" demo={false} hideScores watchedIds={['1']} onWatch={() => {}} onRetry={() => {}} onConnectLive={() => {}} />);
    expect(hidden).toContain('Reveal box score');
    expect(hidden).not.toContain('>24<');
    const shown = renderToStaticMarkup(<BoxScoreBody game={game} report={report} timezone="America/New_York" loading={false} error="" demo={false} hideScores watchedIds={['1']} revealed onWatch={() => {}} onRetry={() => {}} onConnectLive={() => {}} />);
    expect(shown).toContain('>24<');
    expect(shown).toContain('Already on Watchlist');
  });

  it('distinguishes sample, unavailable, not-started and stale refresh states', () => {
    const props = { game, timezone: 'America/New_York', watchedIds: [], hideScores: false, onWatch: () => {}, onRetry: () => {}, onConnectLive: () => {} };
    expect(renderToStaticMarkup(<BoxScoreBody {...props} report={null} loading={false} error="" demo />)).toContain('Sample mode');
    expect(renderToStaticMarkup(<BoxScoreBody {...props} report={{ ...report, availability: 'not-started', teams: [] }} loading={false} error="" demo={false} />)).toContain('not started');
    expect(renderToStaticMarkup(<BoxScoreBody {...props} report={{ ...report, availability: 'unavailable', teams: [] }} loading={false} error="" demo={false} />)).toContain('unavailable');
    const stale = renderToStaticMarkup(<BoxScoreBody {...props} report={{ ...report, stale: true }} loading={false} error="Refresh failed" demo={false} />);
    expect(stale).toContain('Starter');
    expect(stale).toContain('Previously checked');
    expect(stale).toContain('Oct 10');
  });

  it('uses one native dialog with both report tabs', () => {
    const html = renderToStaticMarkup(<GameReport game={game} date={report.date} timezone="America/New_York" demo hideScores={false} watchedIds={[]} initialTab="boxscore" onWatch={() => {}} onClose={() => {}} onConnectLive={() => {}}/>);
    expect(html.match(/<dialog/g)).toHaveLength(1);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Injuries');
    expect(html).toContain('Box score');
    expect(html).toContain('aria-selected="true"');
  });
});
