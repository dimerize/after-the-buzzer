import { byAverage, byTotal, rankTop } from './shared/records-rank';
import type { LiveRow, LiveSeason, RecordCategory, RecordLeader, RecordMeasure, RecordPlayer, RecordSeason, RecordStat, RecordsData, RecordsView } from './shared/records-types';

export const MIN_GAMES = 20;
const META: Record<RecordStat, { label: string; perGame: string; total: string }> = {
  points: { label: 'Scoring', perGame: 'PPG', total: 'PTS' }, rebounds: { label: 'Rebounds', perGame: 'RPG', total: 'REB' },
  assists: { label: 'Assists', perGame: 'APG', total: 'AST' }, blocks: { label: 'Blocks', perGame: 'BPG', total: 'BLK' },
  steals: { label: 'Steals', perGame: 'SPG', total: 'STL' }, threes: { label: '3-Pointers', perGame: '3PM', total: '3PM' },
};
export const RECORD_STATS: RecordStat[] = ['points', 'rebounds', 'assists', 'blocks', 'steals', 'threes'];
const SINCE: Record<RecordStat, number> = { points: 1947, rebounds: 1951, assists: 1947, blocks: 1974, steals: 1974, threes: 1980 };
const BBREF = /^[a-z][a-z0-9.'-]{1,14}\d{2}$/;

export const seasonLabel = (year: number) => `${year - 1}–${String(year).slice(-2)}`;
export function sinceLabel(stat: RecordStat) { return seasonLabel(SINCE[stat]); }
const unit = (stat: RecordStat, measure: RecordMeasure) => measure === 'per-game' ? META[stat].perGame : META[stat].total;
const display = (value: number, measure: RecordMeasure) => measure === 'per-game' ? value.toFixed(1) : value.toLocaleString('en-US');

let loaded: Promise<RecordsData> | null = null;
/** Lazy chunk: the historical dataset only downloads when the Hall of Fame opens. */
export function loadRecordsData(): Promise<RecordsData> {
  loaded ??= import('./data/records.json').then(module => module.default as unknown as RecordsData).catch(error => { loaded = null; throw error; });
  return loaded;
}

export function recordPlayer(data: RecordsData, key: string): RecordPlayer {
  const [name, nbaId, espnId] = data.players[key] ?? [key, null, null];
  return { key, name, nbaId, espnId, bbrefId: BBREF.test(key) ? key : null };
}
export function snapshotSeasons(data: RecordsData): number[] { return Object.keys(data.seasons).map(Number).sort((a, b) => b - a); }

function category(stat: RecordStat, measure: RecordMeasure, leaders: RecordLeader[]): RecordCategory {
  return { id: stat, label: META[stat].label, unit: unit(stat, measure), since: SINCE[stat], leaders };
}
function leader(key: string, rank: number, player: RecordPlayer, team: string, season: number, games: number | null, total: number, measure: RecordMeasure, extra: Partial<RecordLeader> = {}): RecordLeader {
  const value = measure === 'per-game' && games ? total / games : total;
  return { key, rank, player, team, season, games, total, value, display: display(value, measure), ...extra };
}
/** Re-derive competition ranks from stored values (dataset rows are already ordered best-first). */
function ranks<T>(rows: T[], compare: (a: T, b: T) => number): number[] {
  const result: number[] = [];
  rows.forEach((row, index) => result.push(index > 0 && compare(rows[index - 1], row) === 0 ? result[index - 1] : index + 1));
  return result;
}

const sourceFor = (data: RecordsData, season?: number) => ({
  label: data.sources.seasons.label,
  url: season ? `https://www.basketball-reference.com/leagues/${season < 1950 ? 'BAA' : 'NBA'}_${season}_totals.html` : data.sources.seasons.url,
  verifiedAt: data.sources.seasons.verifiedAt,
});

export function seasonView(data: RecordsData, season: number, measure: RecordMeasure): RecordsView {
  const entry = data.seasons[season];
  if (!entry) throw new Error('No verified statistics for that season.');
  const compare = measure === 'totals' ? (a: [string, string, number, number], b: [string, string, number, number]) => b[3] - a[3] : (a: [string, string, number, number], b: [string, string, number, number]) => b[3] * a[2] - a[3] * b[2];
  const categories = RECORD_STATS.map(stat => {
    const rows = entry[measure][stat] ?? [];
    const rowRanks = ranks(rows, compare);
    return category(stat, measure, rows.map(([key, team, games, total], index) => leader(`${key}:${season}`, rowRanks[index], recordPlayer(data, key), team, season, games, total, measure)));
  });
  return { mode: 'season', measure, season, minGames: measure === 'per-game' ? data.minGames : null, categories, source: sourceFor(data, season),
    scope: `${seasonLabel(season)} regular season · ${entry.players} players`, notes: [] };
}

export function singleSeasonView(data: RecordsData, measure: RecordMeasure, completedLive: LiveSeason[] = []): RecordsView {
  const categories = RECORD_STATS.map(stat => {
    const stored = data.singleSeason[measure][stat].map(([key, season, team, games, total]) => ({ key: `${key}:${season}`, player: recordPlayer(data, key), season, team, games, total }));
    const live = completedLive.flatMap(item => item.rows.map(row => ({ key: `espn:${row[0]}:${item.season}`, player: livePlayer(row), season: item.season, team: row[2], games: row[3], total: liveTotal(row, stat) })))
      .filter(row => measure === 'totals' || row.games >= MIN_GAMES);
    const ranked = rankTop([...stored, ...live], measure === 'totals' ? byTotal : byAverage);
    return category(stat, measure, ranked.map(row => leader(row.key, row.rank, row.player, row.team, row.season, row.games, row.total, measure)));
  });
  const newest = Math.max(...snapshotSeasons(data), ...completedLive.map(item => item.season));
  return { mode: 'single-season', measure, season: null, minGames: measure === 'per-game' ? MIN_GAMES : null, categories, source: sourceFor(data),
    scope: `All regular seasons 1946–47 to ${seasonLabel(newest)}`, notes: completedLive.length ? [`${completedLive.map(item => seasonLabel(item.season)).join(', ')} from ESPN season totals.`] : [] };
}

export function singleGameView(data: RecordsData): RecordsView {
  const categories = RECORD_STATS.map(stat => {
    const rows = data.singleGame[stat];
    const rowRanks = ranks(rows, (a, b) => b[1] - a[1]);
    return category(stat, 'totals', rows.map(([key, value, date, team, opponent, score], index) => leader(`${key}:${date}`, rowRanks[index], recordPlayer(data, key), team, seasonOf(date), null, value, 'totals', { date, opponent, score })));
  });
  return { mode: 'game', measure: 'totals', season: null, minGames: null, categories,
    source: { label: data.sources.games.label, url: data.sources.games.revisions.points.url, verifiedAt: data.sources.games.verifiedAt },
    scope: 'All-time regular-season games', notes: [] };
}
function seasonOf(date: string) { const [year, month] = date.split('-').map(Number); return month >= 7 ? year + 1 : year; }

// ESPN seasons after the dataset (the in-progress season, then future completed seasons) ---------
const liveTotal = (row: LiveRow, stat: RecordStat): number => row[4 + RECORD_STATS.indexOf(stat)] as number;
const livePlayer = (row: LiveRow): RecordPlayer => ({ key: `espn:${row[0]}`, name: row[1], nbaId: null, espnId: row[0], bbrefId: null });
export function liveMinimum(live: LiveSeason): number {
  if (!live.inProgress) return MIN_GAMES;
  return Math.max(1, Math.min(MIN_GAMES, Math.floor(Math.max(0, ...live.rows.map(row => row[3])) / 2)));
}
export function liveSeasonView(live: LiveSeason, measure: RecordMeasure): RecordsView {
  const minGames = liveMinimum(live);
  const categories = RECORD_STATS.map(stat => {
    const rows = live.rows.filter(row => measure === 'totals' || row[3] >= minGames).map(row => ({ key: `espn:${row[0]}:${live.season}`, row, games: row[3], total: liveTotal(row, stat) }));
    return category(stat, measure, rankTop(rows, measure === 'totals' ? byTotal : byAverage).map(item => leader(item.key, item.rank, livePlayer(item.row), item.row[2], live.season, item.games, item.total, measure)));
  });
  return { mode: 'season', measure, season: live.season, minGames: measure === 'per-game' ? minGames : null, categories,
    source: { label: 'ESPN season totals', url: `https://www.espn.com/nba/stats/player/_/season/${live.season}/seasontype/2`, verifiedAt: live.fetchedAt },
    scope: `${seasonLabel(live.season)} regular season${live.inProgress ? ' · in progress' : ''} · ${live.rows.length} players`,
    notes: live.inProgress && minGames < MIN_GAMES ? [`Early season: per-game minimum is ${minGames} GP (half the most games played) until players reach ${MIN_GAMES}.`] : [] };
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const ESPN_FIELDS: [string, string][] = [['general', 'gamesPlayed'], ['offensive', 'points'], ['general', 'rebounds'], ['offensive', 'assists'], ['defensive', 'blocks'], ['defensive', 'steals'], ['offensive', 'threePointFieldGoalsMade']];
export function parseEspnSeason(value: unknown, season: number, now = new Date()): LiveSeason {
  const root = obj(value), requested = obj(root.requestedSeason), type = obj(requested.type);
  if (requested.year !== season || type.type !== 2) throw new Error('ESPN season could not be verified.');
  const names = new Map(list(root.categories).map(item => [String(obj(item).name), list(obj(item).names).map(String)]));
  const rows: LiveRow[] = [];
  for (const raw of list(root.athletes)) {
    const athlete = obj(obj(raw).athlete);
    const id = String(athlete.id ?? ''), name = typeof athlete.displayName === 'string' ? athlete.displayName.trim() : '';
    const totals = new Map(list(obj(raw).categories).map(item => [String(obj(item).name), list(obj(item).totals)]));
    const numbers = ESPN_FIELDS.map(([group, field]) => {
      const text = String(totals.get(group)?.[names.get(group)?.indexOf(field) ?? -1] ?? '').replaceAll(',', '');
      return /^\d+$/.test(text) ? Number(text) : NaN;
    });
    if (!/^[1-9]\d{0,11}$/.test(id) || !name || numbers.some(number => !Number.isInteger(number)) || numbers[0] < 1) continue;
    rows.push([id, name, typeof athlete.teamShortName === 'string' ? athlete.teamShortName : '', ...numbers] as LiveRow);
  }
  const ends = Date.parse(String(type.endDate ?? ''));
  return { season, inProgress: !Number.isFinite(ends) || now.getTime() < ends, fetchedAt: now.toISOString(), rows };
}

const ESPN_STATS = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&sort=offensive.avgPoints:desc&seasontype=2';
function readCache<T>(key: string): T | null { try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null; } catch { return null; } }
function writeCache(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage can be full or blocked; the data still renders. */ } }

/** Full regular-season totals for one newer season. Cached on the device: 30 minutes in progress, 30 days once complete. */
export async function fetchLiveSeason(season: number, signal?: AbortSignal, request: typeof fetch = fetch): Promise<LiveSeason> {
  const cacheKey = `buzzer:records-live:${season}`;
  const cached = readCache<LiveSeason>(cacheKey);
  if (cached?.season === season && Array.isArray(cached.rows) && Date.now() - Date.parse(cached.fetchedAt) < (cached.inProgress ? 30 * 60_000 : 30 * 86_400_000)) return cached;
  const response = await request(`${ESPN_STATS}&season=${season}&page=1&limit=1000`, { signal });
  if (!response.ok) throw new Error('ESPN season statistics are unavailable.');
  const live = parseEspnSeason(await response.json(), season);
  if (!live.rows.length) throw new Error('ESPN has no regular-season statistics yet.');
  writeCache(cacheKey, live);
  return live;
}

/** Seasons after the dataset that ESPN has regular-season statistics for (one small request per season, cached 6 hours). */
export async function availableLiveSeasons(data: RecordsData, now = new Date(), signal?: AbortSignal, request: typeof fetch = fetch): Promise<RecordSeason[]> {
  const current = now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const result: RecordSeason[] = [];
  for (let season = Math.max(...snapshotSeasons(data)) + 1; season <= current; season++) {
    const cacheKey = `buzzer:records-probe:${season}`;
    let probe = readCache<{ checkedAt: number; count: number; inProgress: boolean }>(cacheKey);
    if (!probe || now.getTime() - probe.checkedAt > 6 * 3_600_000) {
      try {
        const response = await request(`${ESPN_STATS}&season=${season}&page=1&limit=1`, { signal });
        const body = obj(await response.json());
        const type = obj(obj(body.requestedSeason).type);
        const verified = response.ok && obj(body.requestedSeason).year === season && type.type === 2;
        const ends = Date.parse(String(type.endDate ?? ''));
        probe = { checkedAt: now.getTime(), count: verified ? Number(obj(body.pagination).count) || 0 : 0, inProgress: !Number.isFinite(ends) || now.getTime() < ends };
        writeCache(cacheKey, probe);
      } catch (error) { if (signal?.aborted) throw error; continue; }
    }
    if (probe.count > 0) result.push({ season, label: seasonLabel(season), inProgress: probe.inProgress });
  }
  return result.sort((a, b) => b.season - a.season);
}

export function recordSeasons(data: RecordsData, live: RecordSeason[]): RecordSeason[] {
  return [...live, ...snapshotSeasons(data).map(season => ({ season, label: seasonLabel(season), inProgress: false }))];
}
