import type { Game, PlayerLine, WatchPlayer } from './shared/types';
import { canonicalTeam } from './shared/team-matching';
export type RosterScope = 'favorite' | 'interest' | 'all';
const teams = new Set('ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split(' '));
export function rosterPlayers(players: WatchPlayer[], scope: RosterScope): WatchPlayer[] {
  return players.filter(player => scope === 'all' || (scope === 'favorite' ? player.tier === 'favorite' : player.tier !== 'favorite'));
}
export function rosterPlayerStatus(player: WatchPlayer, line: PlayerLine | undefined, games: Game[], scheduleVerified: boolean, timezone: string): string {
  if (!/^[1-9]\d{0,11}$/.test(player.id)) return 'Unverified';
  if (line?.didNotPlay) return 'DNP';
  if (line && line.minutes > 0 && ['live', 'final'].includes(line.status)) return line.status === 'live' ? 'Live' : 'Final';
  const team = canonicalTeam(line?.team || player.team);
  if (!teams.has(team)) return 'Team unverified';
  const game = games.find(game => line?.gameId === game.id || [canonicalTeam(game.home), canonicalTeam(game.away)].includes(team));
  if (!game) return scheduleVerified ? 'No game scheduled' : 'Schedule unavailable';
  if (game.status === 'postponed') return 'Postponed';
  if (game.status === 'live') return 'Live · Stats pending';
  if (game.status === 'final') return 'Final · Stats unavailable';
  const home = canonicalTeam(game.home) === team;
  const date = new Date(game.startsAt);
  const tipoff = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-US', {timeZone:timezone, hour:'numeric',minute:'2-digit'}).format(date) : 'TBD';
  return `${home ? 'vs' : '@'} ${home ? game.away : game.home} · ${tipoff}`;
}
