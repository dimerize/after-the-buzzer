import type { Game, GameStatus, Night, PlayerLine, Preferences, StatLine } from '../src/shared/types';
import { buildRecap } from './recap';

const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const abbreviation = (value: unknown): string => {
  const team = string(value).toUpperCase();
  return ({ SA: 'SAS', GS: 'GSW', NY: 'NYK', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' } as Record<string, string>)[team] ?? team;
};
function number(value: unknown, signed = false): number | null {
  const text = string(value).trim();
  if (!(signed ? /^[+-]?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/).test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
}
function statusOf(value: unknown): GameStatus {
  const type = object(object(value).type);
  if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED/.test(string(type.name))) return 'postponed';
  if (type.completed === true || type.name === 'STATUS_FINAL') return 'final';
  if (type.state === 'in') return 'live';
  return 'scheduled';
}

export function parseScoreboard(value: unknown, date: string): { games: Game[]; warnings: string[]; season: string; seasonType: Night['seasonType']; seasonYear: number | null } {
  if (!validDate(date)) throw new Error('Invalid basketball date; use YYYY-MM-DD.');
  const root = object(value);
  if (!Array.isArray(root.events)) throw new Error('ESPN scoreboard did not contain an events array.');
  const warnings: string[] = [];
  const games: Game[] = [];
  const leagueSeason = object(object(array(root.leagues)[0]).season);
  const eventSeason = object(object(root.events[0]).season);
  const seasonYear = number(eventSeason.year ?? leagueSeason.year);
  const type = number(eventSeason.type ?? object(leagueSeason.type).type ?? leagueSeason.type);
  const seasonType = type === 1 ? 'preseason' : type === 3 || type === 5 ? 'postseason' : 'regular';
  const season = seasonYear ? `${seasonYear - 1}-${String(seasonYear).slice(-2)}` : 'Unknown season';
  if (!seasonYear || ![1, 2, 3, 4, 5].includes(type ?? -1)) warnings.push('ESPN season metadata is unavailable; competition coverage is uncertain.');
  for (const raw of root.events) {
    const event = object(raw);
    const competition = object(array(event.competitions)[0]);
    const competitors = array(competition.competitors).map(object);
    const home = competitors.find(team => team.homeAway === 'home');
    const away = competitors.find(team => team.homeAway === 'away');
    const id = string(event.id);
    const startsAt = string(event.date ?? competition.date);
    const homeTeam = abbreviation(object(home?.team).abbreviation);
    const awayTeam = abbreviation(object(away?.team).abbreviation);
    // A date without a timezone-qualified clock is not a verified tipoff time.
    const timed = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(startsAt);
    if (!/^\d+$/.test(id) || !homeTeam || !awayTeam || !timed || !validDate(startsAt.slice(0, 10)) || !Number.isFinite(Date.parse(startsAt))) {
      warnings.push(`Skipped malformed ESPN event ${id || '(unknown id)'}.`); continue;
    }
    if (games.some(game => game.id === id)) { warnings.push(`Skipped duplicate ESPN event ${id}.`); continue; }
    const statusValue = event.status ?? competition.status;
    const status = statusOf(statusValue);
    const statusType = object(object(statusValue).type);
    const awayScore = number(away?.score);
    const homeScore = number(home?.score);
    if ((status === 'final' || status === 'live') && (awayScore === null || homeScore === null)) warnings.push(`Score unavailable for ${awayTeam} at ${homeTeam} (${id}).`);
    if (!statusType.name && !statusType.state) warnings.push(`Game status unavailable for event ${id}.`);
    games.push({ id, home: homeTeam, away: awayTeam, homeScore, awayScore, status, startsAt,
      statusText: string(statusType.shortDetail ?? statusType.detail ?? statusType.description) || ({ final: 'Final', live: 'In progress', scheduled: 'Scheduled', postponed: 'Postponed or canceled' }[status]),
      sourceUrl: `https://www.espn.com/nba/game/_/gameId/${id}` });
  }
  return { games, warnings, season, seasonType, seasonYear };
}

const ZERO_STATS: StatLine = { points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, threes: 0, minutes: 0, fgMade: 0, fgAttempted: 0, ftMade: 0, ftAttempted: 0, turnovers: 0, plusMinus: null };
const aliases: Record<string, string> = {
  MIN: 'minutes', PTS: 'points', REB: 'rebounds', AST: 'assists', STL: 'steals', BLK: 'blocks', TO: 'turnovers', TOV: 'turnovers', '+/-': 'plusMinus',
  FG: 'fieldGoalsMade-fieldGoalsAttempted', '3PT': 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', '3P': 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', FT: 'freeThrowsMade-freeThrowsAttempted'
};
function statLine(block: ObjectValue, row: ObjectValue): StatLine | null {
  const cells = array(row.stats);
  const map = new Map<string, unknown>();
  for (const labels of [array(block.keys), array(block.names), array(block.labels)]) labels.forEach((label, index) => {
    const key = string(label); map.set(aliases[key.toUpperCase()] ?? key, cells[index]);
  });
  const result = { ...ZERO_STATS };
  for (const key of ['points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers'] as const) {
    const parsed = number(map.get(key));
    if (parsed === null || !Number.isInteger(parsed)) return null;
    result[key] = parsed;
  }
  const rawMinutes = string(map.get('minutes'));
  if (/^\d+:\d{2}$/.test(rawMinutes)) {
    const [minutes, seconds] = rawMinutes.split(':').map(Number);
    if (seconds >= 60) return null;
    result.minutes = minutes + seconds / 60;
  } else {
    const parsed = number(map.get('minutes'));
    if (parsed === null) return null;
    result.minutes = parsed;
  }
  for (const [key, made, attempted] of [
    ['fieldGoalsMade-fieldGoalsAttempted', 'fgMade', 'fgAttempted'],
    ['freeThrowsMade-freeThrowsAttempted', 'ftMade', 'ftAttempted'],
    ['threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threes', null]
  ] as const) {
    const match = /^(\d+)\s*[-–]\s*(\d+)$/.exec(string(map.get(key)));
    if (!match || Number(match[1]) > Number(match[2])) return null;
    result[made] = Number(match[1]);
    if (attempted) result[attempted] = Number(match[2]);
  }
  result.plusMinus = number(map.get('plusMinus'), true);
  return result;
}

export function parseSummary(value: unknown, game: Game): { players: PlayerLine[]; warnings: string[] } {
  const root = object(value);
  const headerId = string(object(root.header).id);
  if (headerId && headerId !== game.id) throw new Error(`ESPN summary id does not match game ${game.id}.`);
  const warnings: string[] = [];
  const players: PlayerLine[] = [];
  const coveredTeams = new Set<string>();
  for (const rawTeam of array(object(root.boxscore).players)) {
    const teamBlock = object(rawTeam);
    const team = abbreviation(object(teamBlock.team).abbreviation);
    if (team !== game.home && team !== game.away) { warnings.push(`Unrecognized team in box score ${game.id}.`); continue; }
    for (const rawBlock of array(teamBlock.statistics)) {
      const block = object(rawBlock);
      for (const rawRow of array(block.athletes)) {
        const row = object(rawRow);
        const athlete = object(row.athlete);
        const id = string(athlete.id);
        const name = string(athlete.displayName ?? athlete.fullName);
        if (!id || !name) { warnings.push(`Player identity missing in game ${game.id}.`); continue; }
        if (players.some(player => player.id === id)) continue;
        const didNotPlay = row.didNotPlay === true || /^DNP\b/i.test(string(array(row.stats)[0]));
        const stats = didNotPlay ? { ...ZERO_STATS } : statLine(block, row);
        if (!stats) { warnings.push(`Incomplete or malformed statistics for ${name} (${game.id}); line excluded.`); continue; }
        coveredTeams.add(team);
        const headshot = string(object(athlete.headshot).href);
        players.push({ ...stats, id, name, team, opponent: team === game.home ? game.away : game.home,
          gameId: game.id, status: game.status, starter: row.starter === true, didNotPlay,
          rookie: athlete.rookie === true || object(athlete.experience).years === 0,
          ...(headshot.startsWith('https://') ? { headshot } : {}) });
      }
    }
  }
  if (game.status === 'final' || game.status === 'live') {
    for (const team of [game.away, game.home]) if (!coveredTeams.has(team)) warnings.push(`Box score unavailable for ${team} (${game.id}).`);
  }
  return { players, warnings };
}

/** Each request has a deadline and at most one retry; one failed game cannot erase the slate. */
async function requestJson(url: string, budget: { remaining: number }, attempts = 2): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (budget.remaining <= 0) throw new Error('ESPN request budget exhausted.');
    budget.remaining--;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) {
        const error = new Error(`ESPN returned HTTP ${response.status}.`);
        if (response.status < 500 && response.status !== 429) throw Object.assign(error, { permanent: true });
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (object(error).permanent) break;
    } finally { clearTimeout(timeout); }
  }
  throw new Error(`ESPN request failed: ${lastError instanceof Error ? lastError.message : 'unavailable'}`);
}

async function mapConcurrent<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      try { results[current] = { status: 'fulfilled', value: await run(items[current]) }; }
      catch (reason) { results[current] = { status: 'rejected', reason }; }
    }
  }));
  return results;
}

export function parseRookieRoster(value: unknown, seasonYear: number): Map<string, boolean> {
  const roster = object(value);
  if (number(object(roster.season).year) !== seasonYear) throw new Error('Roster season does not match the requested slate.');
  const athletes = array(roster.athletes);
  if (!athletes.length) throw new Error('ESPN roster data is unavailable.');
  const rookies = new Map<string, boolean>();
  for (const rawAthlete of athletes) {
    const athlete = object(rawAthlete);
    const id = string(athlete.id);
    const years = number(object(athlete.experience).years);
    if (id && years !== null) rookies.set(id, years === 0);
  }
  if (!rookies.size) throw new Error('ESPN roster experience is unavailable.');
  return rookies;
}

const rosterCache = new Map<string, { expires: number; rookies: Map<string, boolean> }>();
async function rookieRoster(team: string, seasonYear: number, budget: { remaining: number }): Promise<Map<string, boolean>> {
  const key = `${seasonYear}:${team}`;
  const cached = rosterCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.rookies;
  // Request the actual slate's season; current rosters cannot establish historical rookie status.
  const rookies = parseRookieRoster(await requestJson(`${API}/teams/${team.toLowerCase()}/roster?season=${seasonYear}`, budget, 1), seasonYear);
  if (rosterCache.size >= 80) rosterCache.delete(rosterCache.keys().next().value!);
  rosterCache.set(key, { expires: Date.now() + 6 * 60 * 60 * 1000, rookies });
  return rookies;
}

async function fetchScoreboard(date: string, budget: { remaining: number }) {
  if (!validDate(date)) throw new Error('Invalid basketball date; use YYYY-MM-DD.');
  return parseScoreboard(await requestJson(`${API}/scoreboard?dates=${date.replaceAll('-', '')}&limit=100`, budget), date);
}

export interface Schedule { date: string; games: Game[]; source: 'espn'; updatedAt: string; warnings: string[] }
const scheduleCache = new Map<string, { expires: number; value: Schedule }>();
/** Lightweight schedule lookup; never fetches boxscores/rosters or writes recap state. */
export async function fetchSchedule(date: string): Promise<Schedule> {
  if (!validDate(date)) throw new Error('Invalid basketball date; use YYYY-MM-DD.');
  const cached = scheduleCache.get(date);
  if (cached && cached.expires > Date.now()) return cached.value;
  const scoreboard = await fetchScoreboard(date, { remaining: 2 });
  const value: Schedule = { date, games: scoreboard.games, source: 'espn', updatedAt: new Date().toISOString(), warnings: scoreboard.warnings };
  // Public schedule facts are reusable across owner requests, but bounded per
  // isolate and short-lived so changed tipoffs are not hidden by stale data.
  if (scheduleCache.size >= 32) scheduleCache.delete(scheduleCache.keys().next().value!);
  scheduleCache.set(date, { expires: Date.now() + 60000, value });
  return value;
}

export async function fetchNight(date: string, preferences: Preferences): Promise<Night> {
  // Leave ten outgoing requests for the Worker's optional AI and push delivery.
  const budget = { remaining: 40 };
  const scoreboard = await fetchScoreboard(date, budget);
  const started = scoreboard.games.filter(game => game.status === 'live' || game.status === 'final');
  const results = await mapConcurrent(started, async game => parseSummary(await requestJson(`${API}/summary?event=${game.id}`, budget), game));
  const players: PlayerLine[] = [];
  const warnings = [...scoreboard.warnings];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') { players.push(...result.value.players); warnings.push(...result.value.warnings); }
    else warnings.push(`Box score unavailable for ${started[index].away} at ${started[index].home} (${started[index].id}); ESPN could not be reached.`);
  });
  const teams = [...new Set(players.map(player => player.team))];
  const rookieWarnings: string[] = [];
  if (scoreboard.seasonYear !== null && teams.length) {
    const seasonYear = scoreboard.seasonYear;
    const rosters = await mapConcurrent(teams, team => rookieRoster(team, seasonYear, budget));
    rosters.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        for (const player of players.filter(player => player.team === teams[index])) {
          if (result.value.has(player.id)) player.rookie = result.value.get(player.id)!;
        }
      } else rookieWarnings.push(teams[index]);
    });
  }
  const night = buildRecap(scoreboard.games, players, preferences, { date, season: scoreboard.season, seasonType: scoreboard.seasonType });
  night.scheduleComplete = scoreboard.warnings.length === 0;
  const rookieCoverage = rookieWarnings.length ? [`Rookie status unavailable for ${rookieWarnings.join(', ')} in ${scoreboard.season}; unverified rookie labels are omitted.`] : [];
  night.warnings = [...new Set([...warnings, ...night.warnings, ...rookieCoverage])];
  if (warnings.length) {
    night.partial = true;
    night.edition = 'live';
    if (!/coverage is incomplete/i.test(night.summary)) night.summary += ' Coverage is incomplete; leaders and highlights reflect only the available box scores.';
  }
  return night;
}
