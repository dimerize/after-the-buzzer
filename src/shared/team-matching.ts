import type { Game, WatchPlayer } from './types';

export function canonicalTeam(team: string): string {
  const code = team.trim().toUpperCase();
  return ({ SA: 'SAS', GS: 'GSW', NY: 'NYK', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' } as Record<string, string>)[code] ?? code;
}

export function watchedPlayersForGame(game: Game, players: WatchPlayer[]): WatchPlayer[] {
  const teams = [canonicalTeam(game.away), canonicalTeam(game.home)];
  return [...new Map(players.filter(player => teams.includes(canonicalTeam(player.team))).map(player => [player.id, player])).values()]
    .sort((a, b) => Number(b.tier === 'favorite') - Number(a.tier === 'favorite'));
}
