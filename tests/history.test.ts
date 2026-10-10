import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPlayerCareer, fetchPlayerSeasonLog, parseCareerStats, parseSeasonLog } from '../worker/history';

// Reduced official ESPN response shapes, verified against 5104157 and 1966 on 2026-10-10.
const averageNames = ['gamesPlayed', 'gamesStarted', 'avgMinutes', 'avgFieldGoalsMade-avgFieldGoalsAttempted', 'fieldGoalPct', 'avgThreePointFieldGoalsMade-avgThreePointFieldGoalsAttempted', 'threePointFieldGoalPct', 'avgFreeThrowsMade-avgFreeThrowsAttempted', 'freeThrowPct', 'avgRebounds', 'avgAssists', 'avgBlocks', 'avgSteals', 'avgTurnovers', 'avgPoints'];
const averageStats = ['64', '55', '29.2', '8.6-16.9', '51.2', '1.9-5.5', '34.9', '5.8-7.0', '82.7', '11.5', '3.1', '3.1', '1.0', '2.4', '25.0'];
const totalNames = ['fieldGoalsMade-fieldGoalsAttempted', 'fieldGoalPct', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threePointFieldGoalPct', 'freeThrowsMade-freeThrowsAttempted', 'freeThrowPct', 'totalRebounds', 'assists', 'blocks', 'steals', 'turnovers', 'points'];
const totalStats = ['553-1080', '51.2', '122-350', '34.9', '372-450', '82.7', '736', '199', '197', '66', '155', '1600'];
const filters = [{ name: 'league', value: 'nba' }, { name: 'seasontype', value: '2' }];
function statsFixture(type = '2') {
  const row = (stats: string[]) => ({ teamId: '24', teamSlug: 'san-antonio-spurs', season: { year: 2026, displayName: '2025-26' }, stats });
  return {
    filters: [{ name: 'league', value: 'nba' }, { name: 'seasontype', value: type }],
    teams: { 'san-antonio-spurs': { abbreviation: 'SA' } },
    categories: [
      { name: 'averages', names: averageNames, statistics: [row(averageStats)], totals: averageStats },
      { name: 'totals', names: totalNames, statistics: [row(totalStats)], totals: totalStats },
      { name: 'miscellaneous', names: ['doubleDouble', 'tripleDouble'], statistics: [row(['42', '1'])], totals: ['42', '1'] }
    ]
  };
}
const logNames = ['minutes', 'fieldGoalsMade-fieldGoalsAttempted', 'fieldGoalPct', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threePointPct', 'freeThrowsMade-freeThrowsAttempted', 'freeThrowPct', 'totalRebounds', 'assists', 'blocks', 'steals', 'fouls', 'turnovers', 'points'];
const gameStats = ['26', '14-23', '60.9', '2-7', '28.6', '10-11', '90.9', '13', '5', '2', '1', '0', '2', '40'];
function logFixture() {
  return {
    filters: [{ name: 'league', value: 'nba' }, { name: 'season', value: '2026', options: [{ value: '2026' }, { value: '2025' }] }],
    names: logNames,
    events: { '401811035': { gameDate: '2026-04-11T00:00:00.000+00:00', atVs: 'vs', gameResult: 'W', team: { abbreviation: 'SA', isAllStar: false }, opponent: { abbreviation: 'DAL' } } } as Record<string, Record<string, unknown>>,
    seasonTypes: [{
      displayName: '2025-26 Regular Season',
      categories: [{ type: 'event', displayName: 'april', events: [{ eventId: '401811035', stats: gameStats }] }],
      summary: { stats: [{ type: 'total', stats: gameStats }] }
    }]
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('historical career aggregates', () => {
  it('reads actual totals, percentages, averages and ending-year seasons without inventing total minutes', () => {
    const result = parseCareerStats(statsFixture(), 'regular', 'source');
    expect(result.coverage).toBe('complete');
    expect(result.seasons[0]).toMatchObject({ season: 2026, label: '2025-26', teams: ['SAS'], games: 64, starts: 55, averages: { points: 25, rebounds: 11.5, fgPct: 51.2 }, totals: { points: 1600, blocks: 197, minutes: null }, doubleDoubles: 42, tripleDoubles: 1 });
    expect(result.career?.totals.points).toBe(1600);
  });

  it('uses supplied career averages, not an unweighted average of seasons', () => {
    const data = statsFixture();
    data.categories[0].totals = [...averageStats];
    data.categories[0].totals[0] = '181'; data.categories[0].totals[14] = '23.4';
    data.categories[1].totals = [...totalStats]; data.categories[1].totals[11] = '4238';
    expect(parseCareerStats(data, 'regular', '').career).toMatchObject({ games: 181, averages: { points: 23.4 }, totals: { points: 4238 } });
  });

  it('chooses explicit combined-season rows without double-counting traded team stints', () => {
    const data = statsFixture();
    for (const category of data.categories) {
      const original = category.statistics[0];
      category.statistics = [original, { ...original, teamId: '13', teamSlug: 'los-angeles-lakers' }, { ...original, teamId: '', teamSlug: '2025-26 Totals' }];
    }
    const result = parseCareerStats(data, 'regular', '');
    expect(result.seasons).toHaveLength(1);
    expect(result.seasons[0].games).toBe(64);
    expect(result.seasons[0].totals.points).toBe(1600);
  });

  it('rejects the wrong league or season type and distinguishes empty NBA history from malformed data', () => {
    expect(() => parseCareerStats({}, 'regular', '')).toThrow();
    expect(() => parseCareerStats(statsFixture('3'), 'regular', '')).toThrow(/type/i);
    expect(() => parseCareerStats({ filters: [{ name: 'league', value: 'mens-college-basketball' }] }, 'regular', '')).toThrow(/NBA/i);
    expect(parseCareerStats({ filters: [{ name: 'league', value: 'nba' }] }, 'regular', '')).toMatchObject({ coverage: 'no-data', seasons: [], career: null });
  });

  it('keeps missing values null and marks incomplete provider rows partial', () => {
    const data = statsFixture();
    data.categories[1].statistics[0].stats = [...totalStats];
    data.categories[1].statistics[0].stats[11] = '--';
    const result = parseCareerStats(data, 'regular', '');
    expect(result.seasons[0].totals.points).toBeNull();
    expect(result.coverage).toBe('partial');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('does not call an omitted season complete when career totals exceed the available rows', () => {
    const data = statsFixture();
    data.categories[1].totals = [...totalStats]; data.categories[1].totals[11] = '4238';
    expect(parseCareerStats(data, 'regular', '').coverage).toBe('partial');
  });
});

describe('historical game logs', () => {
  it('separates regular season from playoffs and verifies totals before asserting full log coverage', () => {
    const data = logFixture();
    data.seasonTypes.push({ ...data.seasonTypes[0], displayName: '2025-26 Postseason' });
    const result = parseSeasonLog(data, '5104157', 2026);
    expect(result.regular.coverage).toBe('complete');
    expect(result.postseason.games[0].seasonType).toBe('postseason');
    expect(result.regular.games[0]).toMatchObject({ team: 'SAS', opponent: 'DAL', home: true, stats: { points: 40, threes: 2, fgAttempted: 23 }, milestones: ['40+ points', 'double-double'] });
    expect(result.availableSeasons).toEqual([2026, 2025]);
  });

  it('excludes All-Star, Cup final, play-in and preseason games but keeps Cup semifinals', () => {
    const data = logFixture();
    const base = data.events['401811035'];
    for (const [id, extra] of Object.entries({ '11': { team: { abbreviation: 'WORLD', isAllStar: true } }, '12': { eventNote: 'NBA Cup Championship' }, '13': { eventNote: 'West Play-In - 8th Seed Game' } })) {
      data.events[id] = { ...base, ...extra };
      data.seasonTypes[0].categories[0].events.push({ eventId: id, stats: gameStats });
    }
    data.events['401811035'].eventNote = 'NBA Cup - Semifinals';
    data.seasonTypes.push({ ...data.seasonTypes[0], displayName: '2025-26 Preseason' });
    const result = parseSeasonLog(data, '5104157', 2026);
    expect(result.regular.games).toHaveLength(1);
    expect(result.regular.excludedGames).toBe(3);
    expect(result.regular.coverage).toBe('complete');
  });

  it('deduplicates repeated events and labels incomplete totals honestly', () => {
    const data = logFixture();
    data.seasonTypes[0].categories.push(data.seasonTypes[0].categories[0]);
    expect(parseSeasonLog(data, '5104157', 2026).regular.games).toHaveLength(1);
    data.seasonTypes[0].summary.stats[0].stats = [...gameStats];
    data.seasonTypes[0].summary.stats[0].stats[13] = '80';
    const result = parseSeasonLog(data, '5104157', 2026);
    expect(result.regular.coverage).toBe('partial');
    expect(result.regular.warnings.join(' ')).toMatch(/totals/i);
  });

  it('keeps a separate play-in section out of the regular-season reconciliation', () => {
    const data = logFixture();
    data.seasonTypes.unshift({ ...data.seasonTypes[0], displayName: '2025-26 Play In Regular Season', summary: { stats: [] } });
    const result = parseSeasonLog(data, '5104157', 2026);
    expect(result.regular.coverage).toBe('complete');
    expect(result.regular.games).toHaveLength(1);
    expect(result.regular.excludedGames).toBe(1);
  });

  it('skips explicit DNP rows and never promotes malformed points to zero', () => {
    const data = logFixture();
    data.events['20'] = { ...data.events['401811035'] };
    data.seasonTypes[0].categories[0].events.push({ eventId: '20', stats: ['DNP'], didNotPlay: true } as { eventId: string; stats: string[] });
    expect(parseSeasonLog(data, '5104157', 2026).regular.coverage).toBe('complete');
    const broken = [...gameStats]; broken[13] = '40oops';
    data.seasonTypes[0].categories[0].events.push({ eventId: '21', stats: broken });
    data.events['21'] = { ...data.events['401811035'] };
    const result = parseSeasonLog(data, '5104157', 2026);
    expect(result.regular.games).toHaveLength(1);
    expect(result.regular.coverage).toBe('partial');
  });

  it('computes factual milestone thresholds and preserves scoring ties as distinct games', () => {
    const data = logFixture();
    const values = [...gameStats]; values[7] = '12'; values[8] = '10'; values[9] = '5'; values[10] = '5';
    data.seasonTypes[0].categories[0].events[0].stats = values;
    data.events['22'] = { ...data.events['401811035'], gameDate: '2026-04-10T00:00:00Z' };
    data.seasonTypes[0].categories[0].events.push({ eventId: '22', stats: values });
    const result = parseSeasonLog(data, '5104157', 2026);
    expect(result.regular.topPerformances).toHaveLength(2);
    expect(result.regular.topPerformances[0].milestones).toEqual(['40+ points', '5×5', 'triple-double']);
  });

  it('does not replace missing event dates or malformed statistics with fabricated games', () => {
    const data = logFixture(); delete data.events['401811035'].gameDate;
    const result = parseSeasonLog(data, '5104157', 2026);
    expect(result.regular.games).toEqual([]);
    expect(result.regular.coverage).toBe('partial');
    expect(() => parseSeasonLog(logFixture(), '5104157', 2025)).toThrow(/season/i);
  });

  it('returns an explicit no-data NBA log for a player without NBA seasons', () => {
    const result = parseSeasonLog({ filters: [filters[0]] }, '5254165', 2026);
    expect(result).toMatchObject({ availableSeasons: [], regular: { coverage: 'no-data', games: [] }, postseason: { coverage: 'no-data', games: [] } });
  });
});

describe('bounded ESPN history fetching', () => {
  it('fetches whole career aggregates with two requests and preserves one side on partial failure', async () => {
    const request = vi.fn(async (url: string) => url.includes('seasontype=2') ? Response.json(statsFixture()) : new Response('', { status: 503 }));
    vi.stubGlobal('fetch', request);
    const result = await fetchPlayerCareer('5104157');
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.availableSeasons).toEqual([2026]);
    expect(result.regular.coverage).toBe('complete');
    expect(result.postseason.coverage).toBe('unavailable');
  });

  it('loads both season types in one dated gamelog request, never per-game summaries', async () => {
    const request = vi.fn(async (_url: string) => Response.json(logFixture())); vi.stubGlobal('fetch', request);
    const result = await fetchPlayerSeasonLog('5104157', 2026);
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toContain('/5104157/gamelog?season=2026');
    expect(result.regular.games).toHaveLength(1);
  });

  it('rejects unsafe IDs and invalid seasons before network access', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    await expect(fetchPlayerCareer('../bad')).rejects.toThrow();
    await expect(fetchPlayerSeasonLog('1966', 2026.5)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
