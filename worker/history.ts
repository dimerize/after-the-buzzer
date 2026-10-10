import type {
  CareerHistorySection, HistoricalAggregate, HistoricalPerformance, HistoricalSeason,
  HistoricalStats, HistorySeasonType, PlayerCareerHistory, PlayerSeasonLog, SeasonLogSection
} from '../src/shared/history-types';

const BASE = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes';
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const seasonLabel = (season: number) => `${season - 1}-${String(season).slice(-2)}`;
const teamCode = (value: unknown) => ({ SA: 'SAS', NY: 'NYK', GS: 'GSW', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' }[string(value)] ?? string(value));
const emptyStats = (): HistoricalStats => ({ points: null, rebounds: null, assists: null, steals: null, blocks: null, threes: null, turnovers: null, minutes: null, fgMade: null, fgAttempted: null, ftMade: null, ftAttempted: null, fgPct: null, threePct: null, ftPct: null });
const countFields = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'threes', 'turnovers', 'fgMade', 'fgAttempted', 'ftMade', 'ftAttempted'] as const;

function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.replaceAll(',', '').trim())) return null;
  return Number(value.replaceAll(',', '').trim());
}

function rowMap(names: unknown, values: unknown): ObjectValue {
  const cells = array(values);
  return Object.fromEntries(array(names).map((name, index) => [string(name), cells[index]]));
}

function normalizeStats(values: ObjectValue): HistoricalStats {
  const normalized = Object.fromEntries(Object.entries(values).map(([name, value]) => [name.replace(/^avg([A-Z])/, (_, initial: string) => initial.toLowerCase()), value]));
  const value = (...names: string[]) => number(names.map(name => normalized[name]).find(item => item !== undefined));
  const pair = (name: string): [number | null, number | null] => {
    // Combined average names contain "avg" on both sides; normalize both halves.
    const key = Object.keys(values).find(key => key.replaceAll('avg', '').toLowerCase() === name.toLowerCase());
    const parts = string(key ? values[key] : normalized[name]).split('-');
    return parts.length === 2 ? [number(parts[0]), number(parts[1])] : [null, null];
  };
  const fg = pair('fieldGoalsMade-fieldGoalsAttempted');
  const three = pair('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
  const ft = pair('freeThrowsMade-freeThrowsAttempted');
  return {
    points: value('points'), rebounds: value('totalRebounds', 'rebounds'), assists: value('assists'),
    steals: value('steals'), blocks: value('blocks'), threes: three[0], turnovers: value('turnovers'),
    minutes: value('minutes'), fgMade: fg[0], fgAttempted: fg[1], ftMade: ft[0], ftAttempted: ft[1],
    fgPct: value('fieldGoalPct'), threePct: value('threePointFieldGoalPct', 'threePointPct'), ftPct: value('freeThrowPct')
  };
}

function validateNBA(data: ObjectValue): void {
  const league = array(data.filters).map(object).find(filter => filter.name === 'league');
  if (league?.value !== 'nba') throw new Error('ESPN did not return verified NBA history.');
}

function category(data: ObjectValue, name: string): ObjectValue {
  return array(data.categories).map(object).find(item => item.name === name) ?? {};
}

function aggregate(data: ObjectValue, select: (category: ObjectValue) => unknown): HistoricalAggregate {
  const map = (name: string) => { const item = category(data, name); return rowMap(item.names, select(item)); };
  const averages = map('averages'); const totals = map('totals'); const misc = map('miscellaneous');
  return {
    games: number(averages.gamesPlayed), starts: number(averages.gamesStarted),
    averages: normalizeStats(averages), totals: normalizeStats(totals),
    doubleDoubles: number(misc.doubleDouble), tripleDoubles: number(misc.tripleDouble)
  };
}

function completeAggregate(value: HistoricalAggregate): boolean {
  return value.games !== null && countFields.every(field => value.totals[field] !== null) && value.averages.points !== null;
}

export function parseCareerStats(raw: unknown, seasonType: HistorySeasonType, sourceUrl: string): CareerHistorySection {
  const data = object(raw); validateNBA(data);
  const sections = array(data.categories);
  const result: CareerHistorySection = { seasonType, coverage: 'no-data', seasons: [], career: null, sourceUrl, warnings: [] };
  if (sections.length === 0) return result;
  const selectedType = array(data.filters).map(object).find(filter => filter.name === 'seasontype')?.value;
  if (selectedType !== (seasonType === 'regular' ? '2' : '3')) throw new Error('ESPN returned a different season type.');
  const allRows = array(category(data, 'averages').statistics).map(object);
  const seasons = [...new Set(allRows.map(row => number(object(row.season).year)).filter((year): year is number => year !== null && Number.isInteger(year)))].sort((a, b) => b - a);
  for (const year of seasons) {
    const rows = allRows.filter(row => object(row.season).year === year);
    const select = (item: ObjectValue) => {
      const candidates = array(item.statistics).map(object).filter(row => object(row.season).year === year);
      // Traded players have per-team rows followed by an explicit combined row.
      const combined = candidates.find(row => /\btotals?\b/i.test(`${string(row.displayName)} ${string(row.teamSlug)}`));
      if (!combined && candidates.length > 1) {
        result.warnings.push(`${seasonLabel(year)} has no combined ${string(item.name)} row.`);
        return [];
      }
      return (combined ?? candidates[0])?.stats;
    };
    const stats = aggregate(data, select);
    const teams = [...new Set(rows.filter(row => row.teamId).map(row => teamCode(object(object(data.teams)[string(row.teamSlug)]).abbreviation) || string(row.teamSlug)))];
    const season: HistoricalSeason = { season: year, label: string(object(rows[0]?.season).displayName) || seasonLabel(year), teams, ...stats };
    if (!completeAggregate(season)) result.warnings.push(`${season.label} statistics are incomplete.`);
    result.seasons.push(season);
  }
  if (seasons.length === 0) throw new Error('ESPN career history has no usable season rows.');
  result.career = aggregate(data, item => item.totals);
  if (!completeAggregate(result.career)) result.warnings.push('Career statistics are incomplete.');
  if (result.seasons.reduce((sum, season) => sum + (season.games ?? 0), 0) !== result.career.games
    || countFields.some(field => result.seasons.some(season => season.totals[field] === null)
      || result.seasons.reduce((sum, season) => sum + (season.totals[field] ?? 0), 0) !== result.career!.totals[field])) {
    result.warnings.push('Season rows could not be reconciled with ESPN career totals.');
  }
  result.warnings = [...new Set(result.warnings)];
  result.coverage = result.warnings.length ? 'partial' : 'complete';
  return result;
}

function emptySection(seasonType: HistorySeasonType): SeasonLogSection {
  return { seasonType, coverage: 'no-data', games: [], topPerformances: [], excludedGames: 0, warnings: [] };
}

function emptyLog(playerId: string, season: number): PlayerSeasonLog {
  return {
    playerId, season, label: seasonLabel(season), updatedAt: new Date().toISOString(), source: 'espn',
    sourceUrl: `${BASE}/${playerId}/gamelog?season=${season}`, availableSeasons: [],
    regular: emptySection('regular'), postseason: emptySection('postseason')
  };
}

function excludedEvent(event: ObjectValue): boolean {
  const note = string(event.eventNote);
  return object(event.team).isAllStar === true || object(event.opponent).isAllStar === true
    || /all[ -]?star|rising stars|play[ -]?in/i.test(note)
    || /(?:nba cup|in-season tournament).*\b(?:championship|final|finals)\b/i.test(note);
}

function milestones(stats: HistoricalStats): string[] {
  const result: string[] = [];
  const categories = [stats.points, stats.rebounds, stats.assists, stats.steals, stats.blocks];
  if (stats.points !== null && stats.points >= 40) result.push(`${Math.floor(stats.points / 10) * 10}+ points`);
  if (categories.every(value => value !== null && value >= 5)) result.push('5×5');
  const doubles = categories.filter(value => value !== null && value >= 10).length;
  if (doubles >= 4) result.push('quadruple-double');
  else if (doubles === 3) result.push('triple-double');
  else if (doubles === 2) result.push('double-double');
  return result;
}

export function parseSeasonLog(raw: unknown, playerId: string, season: number): PlayerSeasonLog {
  const data = object(raw); validateNBA(data);
  const result = emptyLog(playerId, season);
  const seasonFilter = array(data.filters).map(object).find(filter => filter.name === 'season');
  const types = array(data.seasonTypes).map(object);
  if (!seasonFilter && !types.length && !data.names) return result;
  if (number(seasonFilter?.value) !== season) throw new Error('ESPN returned a different game-log season.');
  result.availableSeasons = array(seasonFilter?.options).map(option => number(object(option).value)).filter((value): value is number => value !== null && Number.isInteger(value)).sort((a, b) => b - a);
  if (!Array.isArray(data.names) || !Array.isArray(data.seasonTypes)) throw new Error('ESPN game log is malformed.');
  for (const type of types) {
    const displayName = string(type.displayName);
    if (/preseason/i.test(displayName)) continue;
    if (/play[ -]?in/i.test(displayName)) {
      result.regular.excludedGames += array(type.categories).map(object).reduce((count, group) => count + array(group.events).length, 0);
      continue;
    }
    const seasonType = /postseason|playoffs/i.test(displayName) ? 'postseason' : /regular season/i.test(displayName) ? 'regular' : null;
    if (!seasonType) continue;
    if (!displayName.startsWith(result.label)) throw new Error('ESPN game-log section has a different season.');
    const section = result[seasonType];
    const seen = new Set<string>();
    for (const group of array(type.categories).map(object)) {
      for (const row of array(group.events).map(object)) {
        const id = string(row.eventId);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const event = object(object(data.events)[id]);
        if (excludedEvent(event) || /play[ -]?in/i.test(`${string(group.displayName)} ${string(group.splitType)}`)) { section.excludedGames++; continue; }
        if (row.didNotPlay === true) continue;
        const stats = normalizeStats(rowMap(data.names, row.stats));
        const date = string(event.gameDate);
        const team = teamCode(object(event.team).abbreviation); const opponent = teamCode(object(event.opponent).abbreviation);
        if (!date || Number.isNaN(Date.parse(date)) || !team || !opponent || countFields.some(field => stats[field] === null)) {
          section.warnings.push(`Game ${id} has incomplete statistics or context.`);
          continue;
        }
        section.games.push({
          gameId: id, date, season, seasonType, team, opponent,
          home: event.atVs === 'vs' ? true : event.atVs === '@' ? false : null,
          result: event.gameResult === 'W' || event.gameResult === 'L' ? event.gameResult : null,
          stats, milestones: milestones(stats), sourceUrl: `https://www.espn.com/nba/boxscore/_/gameId/${id}`
        });
      }
    }
    const summary = array(object(type.summary).stats).map(object).find(item => item.type === 'total');
    const expected = summary ? normalizeStats(rowMap(data.names, summary.stats)) : emptyStats();
    if (!summary || countFields.some(field => expected[field] === null || section.games.reduce((sum, game) => sum + (game.stats[field] ?? 0), 0) !== expected[field])) {
      section.warnings.push('Game-log totals could not be reconciled with the ESPN season totals.');
    }
    section.games.sort((a, b) => b.date.localeCompare(a.date) || a.gameId.localeCompare(b.gameId));
    section.topPerformances = [...section.games].sort((a, b) => (b.stats.points ?? 0) - (a.stats.points ?? 0) || (b.stats.rebounds ?? 0) - (a.stats.rebounds ?? 0) || (b.stats.assists ?? 0) - (a.stats.assists ?? 0) || a.gameId.localeCompare(b.gameId)).slice(0, 10);
    section.coverage = section.warnings.length ? 'partial' : section.games.length ? 'complete' : 'no-data';
  }
  return result;
}

function validateArguments(playerId: string, season?: number): void {
  if (!/^\d{1,12}$/.test(playerId)) throw new Error('Invalid ESPN player ID.');
  if (season !== undefined && (!Number.isInteger(season) || season < 1947 || season > new Date().getUTCFullYear() + 1)) throw new Error('Invalid NBA season.');
}

async function request(url: string): Promise<unknown> {
  // Each exported fetch has a fixed request count; caller owns durable cache/retry policy.
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`ESPN history request failed (${response.status}).`);
  return response.json();
}

export async function fetchPlayerCareer(playerId: string): Promise<PlayerCareerHistory> {
  validateArguments(playerId);
  const load = async (seasonType: HistorySeasonType): Promise<CareerHistorySection> => {
    const sourceUrl = `${BASE}/${playerId}/stats?seasontype=${seasonType === 'regular' ? 2 : 3}`;
    try { return parseCareerStats(await request(sourceUrl), seasonType, sourceUrl); }
    catch (error) { return { seasonType, coverage: 'unavailable', seasons: [], career: null, sourceUrl, warnings: [error instanceof Error ? error.message : 'ESPN history unavailable.'] }; }
  };
  const [regular, postseason] = await Promise.all([load('regular'), load('postseason')]);
  return { playerId, updatedAt: new Date().toISOString(), source: 'espn', regular, postseason, availableSeasons: [...new Set([...regular.seasons, ...postseason.seasons].map(item => item.season))].sort((a, b) => b - a) };
}

export async function fetchPlayerSeasonLog(playerId: string, season: number): Promise<PlayerSeasonLog> {
  validateArguments(playerId, season);
  const result = emptyLog(playerId, season);
  try { return parseSeasonLog(await request(result.sourceUrl), playerId, season); }
  catch (error) {
    for (const section of [result.regular, result.postseason]) {
      section.coverage = 'unavailable';
      section.warnings = [error instanceof Error ? error.message : 'ESPN game log unavailable.'];
    }
    return result;
  }
}
