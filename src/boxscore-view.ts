import type { BoxScorePlayer, GameBoxScore } from './shared/boxscore-types';
import type { Game, WatchPlayer } from './shared/types';

export interface BoxScoreRequestState { key: string; data: GameBoxScore | null; loading: boolean; error: string }
export type BoxScoreSortKey = 'minutes' | 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'fgMade' | 'threes' | 'ftMade' | 'offensiveRebounds' | 'defensiveRebounds' | 'turnovers' | 'fouls' | 'plusMinus';
export type SortDirection = 'asc' | 'desc';

export function boxScoreRequestKey(game: Game, date: string): string { return `${date}:${game.id}`; }
export function visibleBoxScoreRequest(state: BoxScoreRequestState, key: string): BoxScoreRequestState {
  return state.key === key ? state : { key, data: null, loading: true, error: '' };
}
export function beginBoxScoreRefresh(state: BoxScoreRequestState, key: string): BoxScoreRequestState {
  return state.key === key ? { ...state, loading: true } : { key, data: null, loading: true, error: '' };
}
export function completeBoxScoreRefresh(state: BoxScoreRequestState, key: string, data: GameBoxScore): BoxScoreRequestState {
  return state.key === key ? { key, data, loading: false, error: '' } : state;
}
export function failBoxScoreRefresh(state: BoxScoreRequestState, key: string, error: string): BoxScoreRequestState {
  return state.key === key ? { ...state, loading: false, error } : state;
}

function validPlayer(value: unknown, game: Game, team: string): value is BoxScorePlayer {
  if (!value || typeof value !== 'object') return false;
  const player = value as Partial<BoxScorePlayer>;
  const other = team === game.away ? game.home : game.away;
  return typeof player.id === 'string' && !!player.id && typeof player.name === 'string' && !!player.name
    && player.team === team && player.opponent === other && player.gameId === game.id
    && typeof player.starter === 'boolean' && typeof player.starterKnown === 'boolean' && typeof player.didNotPlay === 'boolean'
    && (player.didNotPlayReason === null || typeof player.didNotPlayReason === 'string')
    && ['minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'fgMade', 'fgAttempted', 'threes', 'ftMade', 'ftAttempted', 'turnovers'].every(key => typeof player[key as keyof BoxScorePlayer] === 'number' && Number.isFinite(player[key as keyof BoxScorePlayer]))
    && ['threesAttempted', 'offensiveRebounds', 'defensiveRebounds', 'fouls', 'plusMinus'].every(key => player[key as keyof BoxScorePlayer] === null || (typeof player[key as keyof BoxScorePlayer] === 'number' && Number.isFinite(player[key as keyof BoxScorePlayer])));
}

function validReport(value: unknown, game: Game, date: string): value is GameBoxScore {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<GameBoxScore>;
  return report.gameId === game.id && report.date === date && report.source === 'espn'
    && report.game?.id === game.id && report.game.away === game.away && report.game.home === game.home
    && ['available', 'not-started', 'unavailable'].includes(report.availability ?? '')
    && typeof report.sourceUrl === 'string' && (report.fetchedAt === null || typeof report.fetchedAt === 'string')
    && typeof report.stale === 'boolean' && Array.isArray(report.warnings) && report.warnings.every(w => typeof w === 'string')
    && Array.isArray(report.teams) && report.teams.length === 2 && report.teams[0].team === game.away && report.teams[1].team === game.home
    && report.teams.every(team => Array.isArray(team.players) && team.players.every(player => validPlayer(player, game, team.team)));
}

export async function fetchGameBoxScore(game: Game, date: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<GameBoxScore> {
  const response = await request(`/api/boxscore?date=${encodeURIComponent(date)}&gameId=${encodeURIComponent(game.id)}`, { credentials: 'same-origin', signal });
  const data = await response.json().catch(() => null) as (GameBoxScore & { error?: string }) | null;
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to load the box score.' : data?.error || 'The box score could not be loaded.');
  if (!validReport(data, game, date)) throw new Error('Box score data could not be verified.');
  return data;
}

export function sortBoxScorePlayers(players: BoxScorePlayer[], key: BoxScoreSortKey, direction: SortDirection): BoxScorePlayer[] {
  return players.map((player, index) => ({ player, index })).sort((a, b) => {
    if (a.player.didNotPlay !== b.player.didNotPlay) return a.player.didNotPlay ? 1 : -1;
    if (a.player.didNotPlay) return a.index - b.index;
    const av = a.player[key], bv = b.player[key];
    if (av === null || !Number.isFinite(av)) return bv === null || !Number.isFinite(bv) ? a.index - b.index : 1;
    if (bv === null || !Number.isFinite(bv)) return -1;
    const delta = direction === 'asc' ? av - bv : bv - av;
    return delta || a.index - b.index;
  }).map(({ player }) => player);
}

export function watchPlayerFromBoxScore(player: BoxScorePlayer): WatchPlayer {
  return { id: player.id, name: player.name, team: player.team, tier: 'interest', alerts: false };
}
