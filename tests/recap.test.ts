import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/shared/defaults';
import type { Game, PlayerLine } from '../src/shared/types';
import { buildRecap } from '../worker/recap';

const game: Game = { id: '101', home: 'LAL', away: 'SAS', homeScore: 100, awayScore: 110, startsAt: '2025-10-25T02:00Z', status: 'final', statusText: 'Final', sourceUrl: 'https://www.espn.com/nba/game/_/gameId/101' };
const meta = { date: '2025-10-24', season: '2025-26', seasonType: 'regular' as const };
const player = (overrides: Partial<PlayerLine> = {}): PlayerLine => ({ id: '1', name: 'Test Player', team: 'SAS', opponent: 'LAL', gameId: '101', rookie: false, status: 'final', starter: true, didNotPlay: false, points: 30, rebounds: 8, assists: 6, steals: 1, blocks: 2, threes: 3, minutes: 34, fgMade: 11, fgAttempted: 19, ftMade: 5, ftAttempted: 6, turnovers: 2, plusMinus: 10, ...overrides });

describe('evidence-based recap', () => {
  it.each([
    [{ points: 30, rebounds: 10, assists: 10 }, 'Test Player: triple-double'],
    [{ points: 45 }, 'Test Player: 45 points'],
    [{ points: 15, blocks: 7 }, 'Test Player: 7 blocks'],
    [{ points: 28, fgMade: 10, fgAttempted: 12 }, 'Test Player: 10/12 FG'],
    [{ id: '5104157', points: 4, rebounds: 1, assists: 0, steals: 0, blocks: 0 }, 'Test Player: 4 points']
  ])('uses factual titles without promotional filler', (stats, title) => {
    const night = buildRecap([game], [player(stats)], DEFAULT_PREFERENCES, meta);
    expect(night.headline).toBe(title);
    expect(night.summary).toBe('1 of 1 games final.');
  });
  it('preserves all ties and excludes DNPs and zero-minute lines from leaders', () => {
    const night = buildRecap([game], [player({ id: '1', name: 'A' }), player({ id: '2', name: 'B' }), player({ id: '3', points: 100, didNotPlay: true }), player({ id: '4', points: 100, minutes: 0 })], DEFAULT_PREFERENCES, meta);
    expect(night.leaders.find(leader => leader.category === 'Points')).toEqual({ category: 'Points', value: 30, playerIds: ['1', '2'], names: ['A', 'B'] });
    expect(night.highlights.some(highlight => highlight.playerId === '3' || highlight.playerId === '4')).toBe(false);
  });
  it('ranks a verified five-by-five and triple-double without historical record claims', () => {
    const night = buildRecap([game], [player({ id: '5104157', name: 'Victor Wembanyama', points: 32, rebounds: 12, assists: 10, steals: 5, blocks: 5 }), player({ id: '2', name: 'Scorer', points: 41 })], DEFAULT_PREFERENCES, meta);
    expect(night.highlights[0].playerId).toBe('5104157');
    expect(night.highlights.some(highlight => /5.by.5|five.by.five/i.test(highlight.title + highlight.detail))).toBe(true);
    expect(night.highlights.some(highlight => /triple.double/i.test(highlight.title + highlight.detail))).toBe(true);
    expect(JSON.stringify(night)).not.toMatch(/first.ever|career.high|season.high|record.breaking/i);
  });
  it('keeps the strongest story per player and game before applying the length limit', () => {
    const night = buildRecap([game], [
      player({ id: '1', name: 'All Around', points: 32, rebounds: 12, assists: 10, steals: 5, blocks: 5, fgMade: 12, fgAttempted: 15 }),
      player({ id: '2', name: 'Second Player', points: 30 }),
      player({ id: '3', name: 'Third Player', points: 29 }),
      player({ id: '4', name: 'Fourth Player', points: 28 }),
      player({ id: '5104157', name: 'Victor Wembanyama', points: 2, rebounds: 1, assists: 0, steals: 0, blocks: 0 })
    ], { ...DEFAULT_PREFERENCES, length: 'quick' }, meta);
    expect(night.highlights.slice(0, 4).map(highlight => highlight.playerId)).toEqual(['1', '2', '3', '4']);
    expect(night.highlights[0].title).toMatch(/five.by.five/);
    expect(night.highlights.filter(highlight => highlight.playerId === '1')).toHaveLength(1);
    expect(night.highlights.filter(highlight => highlight.playerId === '5104157')).toHaveLength(1);
    expect(night.highlights).toHaveLength(5);
  });
  it('retains distinct games by the same player while removing duplicate stories within each game', () => {
    const secondGame = { ...game, id: '102', sourceUrl: 'https://www.espn.com/nba/game/_/gameId/102' };
    const night = buildRecap([game, secondGame], [
      player({ id: '5104157', points: 32, rebounds: 12, assists: 10, steals: 5, blocks: 5, fgMade: 12, fgAttempted: 15 }),
      player({ id: '5104157', gameId: '102', points: 26, rebounds: 11, assists: 10, fgMade: 10, fgAttempted: 13 })
    ], { ...DEFAULT_PREFERENCES, length: 'nerd' }, meta);
    expect(night.highlights).toHaveLength(2);
    expect(night.highlights.map(highlight => highlight.sourceUrl)).toEqual([game.sourceUrl, secondGame.sourceUrl]);
  });
  it('qualifies live statistics and never calls an unfinished slate final', () => {
    const night = buildRecap([{ ...game, status: 'live', statusText: 'Q4 2:15' }], [player({ status: 'live' })], DEFAULT_PREFERENCES, meta);
    expect(night.edition).toBe('live');
    expect(night.summary).toMatch(/live|progress|unfinished/i);
    expect(night.highlights.every(highlight => /so far|live|in progress/i.test(highlight.detail))).toBe(true);
  });
  it('requires sample size before calling a shooting night efficient', () => {
    const night = buildRecap([game], [player({ id: '1', points: 3, fgMade: 1, fgAttempted: 1 }), player({ id: '2', points: 28, fgMade: 10, fgAttempted: 12 })], DEFAULT_PREFERENCES, meta);
    expect(night.highlights.filter(highlight => highlight.category === 'efficiency').map(highlight => highlight.playerId)).toEqual(['2']);
  });
  it('only describes a player as rookie when supplied verified rookie evidence', () => {
    const night = buildRecap([game], [player({ id: '5037871', name: 'Dylan Harper' }), player({ id: '2', name: 'Verified Rookie', rookie: true, points: 24 })], DEFAULT_PREFERENCES, meta);
    expect(night.highlights.filter(highlight => highlight.category === 'rookie').map(highlight => highlight.playerId)).toEqual(['2']);
  });
  it('honors recap length and the favorite tier while retaining complete stat lines', () => {
    const players = Array.from({ length: 12 }, (_, i) => player({ id: String(i + 1), name: `Player ${i + 1}`, points: 30 + i }));
    players.push(player({ id: '5104157', name: 'Victor Wembanyama', points: 10 }));
    const quick = buildRecap([game], players, { ...DEFAULT_PREFERENCES, length: 'quick' }, meta);
    const nerd = buildRecap([game], players, { ...DEFAULT_PREFERENCES, length: 'nerd' }, meta);
    expect(quick.highlights.length).toBeLessThan(nerd.highlights.length);
    expect(quick.players).toHaveLength(13);
    expect(nerd.highlights.some(highlight => highlight.playerId === '5104157' && highlight.category === 'favorite')).toBe(true);
  });
  it('cannot produce a completed recap from empty, postponed or absent box scores', () => {
    expect(buildRecap([], [], DEFAULT_PREFERENCES, meta).edition).toBe('live');
    expect(buildRecap([{ ...game, status: 'postponed' }], [], DEFAULT_PREFERENCES, meta).edition).toBe('live');
    const missing = buildRecap([game], [], DEFAULT_PREFERENCES, meta);
    expect(missing.partial).toBe(true);
    expect(missing.edition).toBe('live');
    expect(missing.leaders).toEqual([]);
  });
});
