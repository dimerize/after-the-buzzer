import type { Game, StatLine } from '../src/shared/types';
import type { BoxScorePlayer, GameBoxScore } from '../src/shared/boxscore-types';

type Data = Record<string, unknown>;
const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=';
const MAX_BYTES = 1_500_000;
const LIVE_TTL = 45_000;
const FINAL_TTL = 24 * 60 * 60_000;
const object = (value: unknown): Data => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
function teamName(value: unknown): string {
  const code = string(value).toUpperCase();
  return ({ SA: 'SAS', GS: 'GSW', NY: 'NYK', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' } as Record<string, string>)[code] ?? code;
}
function integer(value: unknown): number | null {
  const raw = string(value).trim();
  return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}
function minutes(value: unknown): number | null {
  const raw = string(value).trim();
  const clock = /^(\d+):(\d{2})$/.exec(raw);
  if (clock) return Number(clock[2]) < 60 ? Number(clock[1]) + Number(clock[2]) / 60 : null;
  const decimal = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(decimal) ? decimal : null;
}
function shooting(value: unknown): [number, number] | null {
  const match = /^(\d+)\s*[-–]\s*(\d+)$/.exec(string(value).trim());
  if (!match) return null;
  const made = Number(match[1]); const attempts = Number(match[2]);
  return Number.isSafeInteger(made) && Number.isSafeInteger(attempts) && made <= attempts ? [made, attempts] : null;
}
function statMap(block: Data, row: Data): Map<string, unknown> {
  const values = array(row.stats);
  const result = new Map<string, unknown>();
  for (const field of ['labels', 'names', 'keys']) {
    array(block[field]).forEach((label, index) => {
      const key = string(label).toUpperCase();
      if (key) result.set(key, values[index]);
    });
  }
  return result;
}
function cell(map: Map<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (map.has(key)) return map.get(key);
  return undefined;
}
function parseLine(map: Map<string, unknown>): (StatLine & Pick<BoxScorePlayer, 'threesAttempted' | 'offensiveRebounds' | 'defensiveRebounds' | 'fouls'>) | null {
  const get = (...keys: string[]) => cell(map, ...keys);
  const min = minutes(get('MINUTES', 'MIN'));
  const fg = shooting(get('FIELDGOALSMADE-FIELDGOALSATTEMPTED', 'FG'));
  const three = shooting(get('THREEPOINTFIELDGOALSMADE-THREEPOINTFIELDGOALSATTEMPTED', '3PT', '3P'));
  const ft = shooting(get('FREETHROWSMADE-FREETHROWSATTEMPTED', 'FT'));
  const points = integer(get('POINTS', 'PTS'));
  const rebounds = integer(get('REBOUNDS', 'REB'));
  const assists = integer(get('ASSISTS', 'AST'));
  const steals = integer(get('STEALS', 'STL'));
  const blocks = integer(get('BLOCKS', 'BLK'));
  const turnovers = integer(get('TURNOVERS', 'TOV', 'TO'));
  if (min === null || !fg || !three || !ft || points === null || rebounds === null || assists === null || steals === null || blocks === null || turnovers === null) return null;
  const rawPlusMinus = string(get('PLUSMINUS', '+/-')).trim();
  const plusMinus = /^[+-]?\d+$/.test(rawPlusMinus) ? Number(rawPlusMinus) : null;
  const optional = (...keys: string[]): number | null => integer(get(...keys));
  return { minutes: min, points, rebounds, assists, steals, blocks, turnovers,
    fgMade: fg[0], fgAttempted: fg[1], threes: three[0], threesAttempted: three[1], ftMade: ft[0], ftAttempted: ft[1],
    offensiveRebounds: optional('OFFENSIVEREBOUNDS', 'OREB'), defensiveRebounds: optional('DEFENSIVEREBOUNDS', 'DREB'),
    fouls: optional('FOULS', 'PF'), plusMinus: Number.isSafeInteger(plusMinus) ? plusMinus : null };
}
const DNP_STATS: StatLine = { minutes: 0, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0,
  fgMade: 0, fgAttempted: 0, threes: 0, ftMade: 0, ftAttempted: 0, plusMinus: null };
function empty(game: Game, date: string, availability: GameBoxScore['availability'], warnings: string[] = []): GameBoxScore {
  return { gameId: game.id, date, game, source: 'espn', sourceUrl: `https://www.espn.com/nba/boxscore/_/gameId/${game.id}`,
    fetchedAt: null, stale: false, availability, teams: [{ team: game.away, players: [] }, { team: game.home, players: [] }], warnings };
}

/** Normalize one ESPN summary. The game/date pair must come from the server's verified schedule. */
export function parseGameBoxScore(value: unknown, game: Game, date: string, fetchedAt: string): GameBoxScore {
  const root = object(value);
  const header = object(root.header);
  if (string(header.id) !== game.id) throw new Error(`ESPN summary id does not match game ${game.id}.`);
  const competitions = array(header.competitions).map(object);
  for (const competition of competitions) {
    if (string(competition.id) && string(competition.id) !== game.id) throw new Error(`ESPN competition id does not match game ${game.id}.`);
    for (const competitor of array(competition.competitors).map(object)) {
      const side = string(competitor.homeAway);
      const team = teamName(object(competitor.team).abbreviation);
      if ((side === 'home' && team !== game.home) || (side === 'away' && team !== game.away)) throw new Error(`ESPN header team does not match game ${game.id}.`);
    }
  }
  const rawTeams = object(root.boxscore).players;
  if (!Array.isArray(rawTeams)) throw new Error('ESPN box score is unavailable.');
  const result = empty(game, date, 'unavailable');
  result.fetchedAt = fetchedAt;
  const seen = new Set<string>();
  for (const rawTeam of rawTeams) {
    const teamBlock = object(rawTeam);
    const team = teamName(object(teamBlock.team).abbreviation);
    const target = result.teams.find(item => item.team === team);
    if (!target) { result.warnings.push(`Unrecognized team in box score ${game.id}.`); continue; }
    for (const rawBlock of array(teamBlock.statistics)) {
      const block = object(rawBlock);
      for (const rawRow of array(block.athletes)) {
        const row = object(rawRow);
        const athlete = object(row.athlete);
        const id = string(athlete.id);
        const name = string(athlete.displayName ?? athlete.fullName).trim();
        if (!/^\d+$/.test(id) || !name) { result.warnings.push(`Player identity missing in game ${game.id}.`); continue; }
        if (seen.has(id)) continue;
        const stats = array(row.stats);
        const didNotPlay = row.didNotPlay === true || /^DNP\b/i.test(string(stats[0]));
        const line = didNotPlay ? { ...DNP_STATS, threesAttempted: null, offensiveRebounds: null, defensiveRebounds: null, fouls: null } : parseLine(statMap(block, row));
        if (!line) { result.warnings.push(`Incomplete or malformed statistics for ${name} (${game.id}); line excluded.`); continue; }
        const reason = string(row.reason).trim() || string(stats[0]).replace(/^DNP\s*[-–:]?\s*/i, '').trim();
        const headshot = string(object(athlete.headshot).href);
        target.players.push({ ...line, id, name, team, opponent: team === game.away ? game.home : game.away,
          gameId: game.id, status: game.status, rookie: athlete.rookie === true || object(athlete.experience).years === 0,
          starter: row.starter === true, starterKnown: typeof row.starter === 'boolean', didNotPlay,
          didNotPlayReason: didNotPlay && reason ? reason : null,
          ...(headshot.startsWith('https://') ? { headshot } : {}) });
        seen.add(id);
      }
    }
  }
  for (const team of result.teams) if (!team.players.length) result.warnings.push(`Box score unavailable for ${team.team} (${game.id}).`);
  result.availability = result.teams.some(team => team.players.length) ? 'available' : 'unavailable';
  return result;
}

async function fetchSummary(id: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(`${API}${id}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`ESPN returned HTTP ${response.status}.`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_BYTES) throw new Error('ESPN box score exceeded the response limit.');
    if (!response.body) throw new Error('ESPN box score had no response body.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('ESPN box score exceeded the response limit.'); }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(body));
  } finally { clearTimeout(timeout); }
}

/** Load a verified game's full box score with durable D1 fallback on provider failures. */
export async function loadGameBoxScore(db: D1Database, game: Game, date: string): Promise<GameBoxScore> {
  if (!/^\d+$/.test(game.id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid game or date.');
  if (game.status === 'scheduled' || game.status === 'postponed') return empty(game, date, 'not-started');
  const key = `${date}:${game.id}`;
  const row = await db.prepare('SELECT payload, updated_at FROM boxscore_cache WHERE id=?').bind(key).first<{ payload: string; updated_at: number }>();
  let cached: GameBoxScore | null = null;
  if (row) {
    try {
      const parsed = JSON.parse(row.payload) as GameBoxScore;
      if (parsed.gameId === game.id && parsed.date === date && parsed.teams?.[0]?.team === game.away && parsed.teams?.[1]?.team === game.home) cached = parsed;
    } catch { /* Invalid cache is ignored and replaced by a fresh fetch. */ }
  }
  const ttl = game.status === 'final' ? FINAL_TTL : LIVE_TTL;
  if (cached && row && cached.game.status === game.status && Date.now() - row.updated_at < ttl) return { ...cached, game, stale: false,
    teams: cached.teams.map(team => ({ ...team, players: team.players.map(player => ({ ...player, status: game.status })) })) };
  try {
    const value = await fetchSummary(game.id);
    const result = parseGameBoxScore(value, game, date, new Date().toISOString());
    if (result.availability === 'unavailable') throw new Error('ESPN box score has no player coverage.');
    try {
      await db.prepare('INSERT INTO boxscore_cache(id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at')
        .bind(key, JSON.stringify(result), Date.now()).run();
    } catch { result.warnings.push('Box score cache could not be updated.'); }
    return result;
  } catch {
    if (cached) return { ...cached, game, stale: true, warnings: [...cached.warnings, 'ESPN box score refresh failed; showing stale saved data.'] };
    return empty(game, date, 'unavailable', ['ESPN box score unavailable.']);
  }
}
