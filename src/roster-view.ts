import type { Game, PlayerInjury, PlayerLine, WatchPlayer } from './shared/types';
import { canonicalTeam } from './shared/team-matching';
export type RosterScope = 'favorite' | 'interest' | 'all';
const teams = new Set('ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split(' '));
export function rosterPlayers(players: WatchPlayer[], scope: RosterScope): WatchPlayer[] {
  return players.filter(player => scope === 'all' || (scope === 'favorite' ? player.tier === 'favorite' : player.tier !== 'favorite'));
}

/** Plate tone: drives the colour of the status plate that replaces empty stat cells. */
export type RosterTone = 'stats' | 'scheduled' | 'live' | 'out' | 'questionable' | 'dnp' | 'off' | 'final' | 'unknown';
export interface RosterStatus { tone: RosterTone; label: string; detail: string; text: string; matchup?: string; ruledOut?: boolean }

const INJURY_OUT = /\b(out|suspen|inactive|not with team)\b/i;
const sentence = (value: string) => { const text = value.replace(/^DNP\s*[-–:]?\s*/i, '').trim(); return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : 'Did not play'; };
function tipoffTime(game: Game, timezone: string) {
  const date = new Date(game.startsAt);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(date) : 'TBD';
}

/**
 * What a roster row can truthfully say. A scheduled team game never implies the
 * player will play; missing data is "unavailable", never "no game". Injury
 * statuses only come from today's ESPN feed.
 */
export function rosterStatus(player: WatchPlayer, line: PlayerLine | undefined, games: Game[], scheduleVerified: boolean, timezone: string, injury?: PlayerInjury, today = true): RosterStatus {
  const make = (tone: RosterTone, label: string, detail: string, text: string, extra: Partial<RosterStatus> = {}): RosterStatus => ({ tone, label, detail, text, ...extra });
  if (!/^[1-9]\d{0,11}$/.test(player.id)) return make('unknown', 'Unverified', 'Identity pending', 'Unverified');
  const out = injury && INJURY_OUT.test(injury.status);
  const lineMatchup = line ? `${games.find(item => item.id === line.gameId)?.home === line.team ? 'vs' : '@'} ${line.opponent}` : undefined;
  if (line?.didNotPlay) return make('dnp', 'DNP', line.didNotPlayReason ? sentence(line.didNotPlayReason) : injury ? `${injury.status} · ${injury.reason}` : 'Did not play', 'DNP', { matchup: lineMatchup });
  if (line && line.minutes > 0 && ['live', 'final'].includes(line.status)) {
    const game = games.find(item => item.id === line.gameId);
    // Listed Out after tipoff while the game is live: keep the stats, flag it.
    const ruledOut = !!out && line.status === 'live' && !!game && Date.parse(injury?.updatedAt ?? '') > Date.parse(game.startsAt);
    return make('stats', line.status === 'live' ? 'Live' : 'Final', '', line.status === 'live' ? 'Live' : 'Final', { matchup: lineMatchup, ...(ruledOut ? { ruledOut } : {}) });
  }
  const team = canonicalTeam(line?.team || player.team);
  if (!teams.has(team)) return make('unknown', 'Team unknown', 'Team unverified', 'Team unverified');
  const game = games.find(item => line?.gameId === item.id || [canonicalTeam(item.home), canonicalTeam(item.away)].includes(team));
  // Past nights only know the player's current team, so "no game" could be a trade.
  if (!today) return make('off', 'No stats', 'Not in this night’s box scores', 'No stats this night');
  if (!game) return scheduleVerified ? make('off', 'No game', 'Off tonight', 'No game scheduled') : make('unknown', 'Unavailable', 'Schedule unavailable', 'Schedule unavailable');
  const home = canonicalTeam(game.home) === team;
  const matchup = `${home ? 'vs' : '@'} ${home ? game.away : game.home}`;
  if (game.status === 'postponed') return make('off', 'Postponed', matchup, 'Postponed', { matchup });
  if (game.status === 'final') return make('final', 'Final', 'No stats in box score', 'Final · Stats unavailable', { matchup });
  if (out) return make('out', 'Out', injury!.reason || injury!.status, game.status === 'live' ? 'Live · Out' : `Out · ${matchup}`, { matchup });
  if (injury) return make('questionable', injury.status, `${game.status === 'live' ? 'Live' : tipoffTime(game, timezone)} · ${injury.reason || matchup}`, `${injury.status} · ${matchup}`, { matchup });
  if (game.status === 'live') return make('live', 'Live', 'No stats yet', 'Live · Stats pending', { matchup });
  const time = tipoffTime(game, timezone);
  return make('scheduled', time, matchup, `${matchup} · ${time}`, { matchup });
}

/** Text form, kept for row labels and older callers. */
export function rosterPlayerStatus(player: WatchPlayer, line: PlayerLine | undefined, games: Game[], scheduleVerified: boolean, timezone: string): string {
  return rosterStatus(player, line, games, scheduleVerified, timezone).text;
}
