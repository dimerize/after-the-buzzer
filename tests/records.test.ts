import { describe, expect, it } from 'vitest';
import dataset from '../src/data/records.json';
import { liveMinimum, liveSeasonView, parseEspnSeason, recordPlayer, recordSeasons, seasonView, singleGameView, singleSeasonView } from '../src/records-model';
import { byAverage, rankTop } from '../src/shared/records-rank';
import type { LiveRow, LiveSeason, RecordsData } from '../src/shared/records-types';

const data = dataset as unknown as RecordsData;
const top = (view: ReturnType<typeof seasonView>, stat: string) => view.categories.find(category => category.id === stat)!.leaders;

describe('record ranking', () => {
  it('ranks averages from exact totals and keeps every tie at the cutoff', () => {
    const rows = [{ key: 'a', total: 1000, games: 30 }, { key: 'b', total: 2001, games: 60 }, { key: 'c', total: 2000, games: 60 }, { key: 'd', total: 2000, games: 60 }];
    expect(rankTop(rows, byAverage, 2).map(row => [row.key, row.rank])).toEqual([['b', 1], ['a', 2], ['c', 2], ['d', 2]]);
  });
});

describe('historical record book', () => {
  it('covers every regular season from 1946–47 to the last completed season', () => {
    const seasons = Object.keys(data.seasons).map(Number);
    expect(Math.min(...seasons)).toBe(1947);
    expect(seasons).toHaveLength(Math.max(...seasons) - 1946);
    expect(recordSeasons(data, [])[0]).toMatchObject({ season: 2026, label: '2025–26', inProgress: false });
  });
  it('uses a 20-game minimum: Wembanyama leads 2024–25 blocks per game in 46 games', () => {
    const blocks = top(seasonView(data, 2025, 'per-game'), 'blocks');
    expect(blocks[0]).toMatchObject({ rank: 1, games: 46, total: 176, display: '3.8', player: { name: 'Victor Wembanyama' } });
    expect(blocks.every(row => (row.games ?? 0) >= 20)).toBe(true);
    expect(top(seasonView(data, 2025, 'totals'), 'blocks')[0].player.name).toBe('Victor Wembanyama');
  });
  it('shows 1961–62 per-game history and leaves unrecorded categories empty', () => {
    const view = seasonView(data, 1962, 'per-game');
    expect(top(view, 'points')[0]).toMatchObject({ display: '50.4', games: 80, team: 'PHW', player: { name: 'Wilt Chamberlain' } });
    expect(top(view, 'blocks')).toEqual([]);
    expect(top(view, 'threes')).toEqual([]);
    expect(view.minGames).toBe(20);
  });
  it('lists all-time single games with dates and opponents, regular season only', () => {
    const view = singleGameView(data);
    expect(top(view, 'points')[0]).toMatchObject({ total: 100, date: '1962-03-02', team: 'PHW', opponent: 'NYK', player: { name: 'Wilt Chamberlain' } });
    expect(top(view, 'rebounds')[0]).toMatchObject({ total: 55, player: { name: 'Wilt Chamberlain' } });
    expect(top(view, 'assists')[0]).toMatchObject({ total: 30, player: { name: 'Scott Skiles' } });
    expect(top(view, 'blocks')[0]).toMatchObject({ total: 17, player: { name: 'Elmore Smith' } });
    expect(top(view, 'steals').filter(row => row.rank === 1).map(row => row.player.name).sort()).toEqual(['Kendall Gill', 'Larry Kenon']);
    expect(top(view, 'threes')[0]).toMatchObject({ total: 14, player: { name: 'Klay Thompson' } });
    expect(top(view, 'rebounds').some(row => row.date === '1967-04-05')).toBe(false);
  });
  it('ranks all-time single seasons by totals and by 20-game averages', () => {
    expect(top(singleSeasonView(data, 'totals'), 'points')[0]).toMatchObject({ total: 4029, season: 1962 });
    expect(top(singleSeasonView(data, 'per-game'), 'assists')[0]).toMatchObject({ player: { name: 'John Stockton' }, season: 1990 });
  });
  it('maps identities to photo sources without mixing namespaces', () => {
    expect(recordPlayer(data, 'chambwi01')).toMatchObject({ nbaId: '76375', bbrefId: 'chambwi01' });
    expect(recordPlayer(data, 'wembavi01').nbaId).toBe('1641705');
    const wikidataOnly = Object.keys(data.players).find(key => key.startsWith('wd:'));
    if (wikidataOnly) expect(recordPlayer(data, wikidataOnly).bbrefId).toBeNull();
  });
});

const espnPage = (athletes: { id: string; name: string; gp: string; pts: string }[], endDate = '2027-04-12T06:59:00.000+00:00') => ({
  requestedSeason: { year: 2027, type: { type: 2, endDate } },
  categories: [{ name: 'general', names: ['gamesPlayed', 'rebounds'] }, { name: 'offensive', names: ['points', 'assists', 'threePointFieldGoalsMade'] }, { name: 'defensive', names: ['steals', 'blocks'] }],
  athletes: athletes.map(athlete => ({ athlete: { id: athlete.id, displayName: athlete.name, teamShortName: 'SA' }, categories: [{ name: 'general', totals: [athlete.gp, '40'] }, { name: 'offensive', totals: [athlete.pts, '10', '3'] }, { name: 'defensive', totals: ['2', '9'] }] })),
});
describe('newer seasons from ESPN', () => {
  it('reads integer totals and drops malformed or zero-game rows', () => {
    const season = parseEspnSeason(espnPage([{ id: '5104157', name: 'Victor Wembanyama', gp: '8', pts: '1,240' }, { id: 'x', name: 'Bad', gp: '3', pts: '9' }, { id: '2', name: 'No games', gp: '0', pts: '0' }]), 2027, new Date('2026-11-05T12:00:00Z'));
    expect(season).toMatchObject({ season: 2027, inProgress: true });
    expect(season.rows).toEqual([['5104157', 'Victor Wembanyama', 'SA', 8, 1240, 40, 10, 9, 2, 3]]);
    expect(() => parseEspnSeason({ requestedSeason: { year: 2026, type: { type: 2 } } }, 2027)).toThrow();
  });
  it('scales the per-game minimum early in a live season and labels it', () => {
    const row = (id: string, games: number, points: number): LiveRow => [id, id, 'SAS', games, points, 0, 0, 0, 0, 0];
    const live: LiveSeason = { season: 2027, inProgress: true, fetchedAt: '2026-11-05T12:00:00Z', rows: [row('1', 8, 300), row('2', 3, 150), row('3', 4, 100)] };
    expect(liveMinimum(live)).toBe(4);
    const view = liveSeasonView(live, 'per-game');
    expect(view.categories[0].leaders.map(leader => leader.player.name)).toEqual(['1', '3']);
    expect(view.notes[0]).toContain('4 GP');
    expect(liveMinimum({ ...live, rows: [row('1', 60, 1)] })).toBe(20);
    expect(liveMinimum({ ...live, inProgress: false })).toBe(20);
  });
  it('merges a completed newer season into all-time rankings', () => {
    const live: LiveSeason = { season: 2027, inProgress: false, fetchedAt: '2027-05-01T00:00:00Z', rows: [['9', 'New Scorer', 'SAS', 82, 4100, 0, 0, 0, 0, 0]] };
    expect(top(singleSeasonView(data, 'totals', [live]), 'points')[0]).toMatchObject({ total: 4100, season: 2027, player: { name: 'New Scorer', espnId: '9' } });
  });
});
