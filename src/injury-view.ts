import type { GameInjuryReport } from './shared/injury-types';
import type { Game } from './shared/types';

export interface InjuryRequestState { key: string; data: GameInjuryReport | null; loading: boolean; error: string }

export function injuryRequestKey(game: Game, date: string): string { return `${date}:${game.id}`; }

/** A changed selection is hidden during the render before its effect can start. */
export function visibleInjuryRequest(state: InjuryRequestState, key: string): InjuryRequestState {
  return state.key === key ? state : { key, data: null, loading: true, error: '' };
}

export function beginInjuryRefresh(state: InjuryRequestState, key: string): InjuryRequestState {
  return state.key === key ? { ...state, loading: true } : { key, data: null, loading: true, error: '' };
}

export function completeInjuryRefresh(state: InjuryRequestState, key: string, data: GameInjuryReport): InjuryRequestState {
  return state.key === key ? { key, data, loading: false, error: '' } : state;
}

/** Match the server's two-minute cache, fifteen-minute feed, and five-minute future-source limits. */
export function isInjuryReportStale(report: GameInjuryReport, now = new Date()): boolean {
  if (report.stale) return true;
  const fetched = Date.parse(report.fetchedAt || '');
  const updated = Date.parse(report.feedUpdatedAt || '');
  if (!Number.isFinite(fetched) || !Number.isFinite(updated)) return true;
  const sourceAge = now.getTime() - updated;
  return now.getTime() - fetched > 2 * 60_000 || sourceAge > 15 * 60_000 || sourceAge < -5 * 60_000;
}

function isReport(value: unknown, game: Game, date: string): value is GameInjuryReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<GameInjuryReport>;
  return report.gameId === game.id && report.date === date && report.source === 'espn'
    && report.game?.id === game.id && report.game.away === game.away && report.game.home === game.home
    && ['current', 'historical-unavailable', 'unavailable'].includes(report.availability ?? '')
    && typeof report.sourceUrl === 'string' && typeof report.officialSourceUrl === 'string'
    && (report.fetchedAt === null || typeof report.fetchedAt === 'string')
    && (report.feedUpdatedAt === null || typeof report.feedUpdatedAt === 'string')
    && typeof report.stale === 'boolean' && Array.isArray(report.warnings)
    && Array.isArray(report.teams) && report.teams.length === 2
    && report.teams[0].team === game.away && report.teams[1].team === game.home
    && report.teams.every(team => typeof team.displayName === 'string'
      && ['reported', 'not-listed', 'unavailable'].includes(team.coverage)
      && Array.isArray(team.players)
      && team.players.every(player => typeof player.id === 'string' && typeof player.name === 'string' && typeof player.status === 'string' && typeof player.reason === 'string'));
}

export async function fetchGameInjuries(game: Game, date: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<GameInjuryReport> {
  const response = await request(`/api/injuries?date=${encodeURIComponent(date)}&gameId=${encodeURIComponent(game.id)}`, { credentials: 'same-origin', signal });
  const data = await response.json().catch(() => null) as (GameInjuryReport & { error?: string }) | null;
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to load injury reports.' : data?.error || 'The injury report could not be loaded.');
  if (!isReport(data, game, date)) throw new Error('Injury report data could not be verified.');
  return data;
}

function easternDate(now: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Protect older games if a stale or malformed response claims current coverage. */
export function displayInjuryReport(report: GameInjuryReport, game: Game, date: string, now = new Date()): GameInjuryReport {
  if (report.availability === 'historical-unavailable' || game.status === 'final' || game.status === 'postponed' || date < easternDate(now)) {
    return { ...report, availability: 'historical-unavailable', teams: report.teams.map(team => ({ ...team, players: [] })) };
  }
  return report;
}

export function formatInjuryTime(value: string | null, timezone: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  try { return new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date); }
  catch { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date); }
}
