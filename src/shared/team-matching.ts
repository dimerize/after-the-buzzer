import type { Game, PlayerInjury, PlayerLine, WatchPlayer } from './types';

export function canonicalTeam(team: string): string {
  const code = team.trim().toUpperCase();
  return ({ SA: 'SAS', GS: 'GSW', NY: 'NYK', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' } as Record<string, string>)[code] ?? code;
}

const favoritesFirst = (players: WatchPlayer[]) => [...new Map(players.map(player => [player.id, player])).values()]
  .sort((a, b) => Number(b.tier === 'favorite') - Number(a.tier === 'favorite'));

export function watchedPlayersForGame(game: Game, players: WatchPlayer[]): WatchPlayer[] {
  const teams = [canonicalTeam(game.away), canonicalTeam(game.home)];
  return favoritesFirst(players.filter(player => teams.includes(canonicalTeam(player.team))));
}

/** Watched players per side. A team match means the player's team plays, not that the player does. */
export interface GameWatch { away: WatchPlayer[]; home: WatchPlayer[]; level: 'none' | 'interest' | 'favorite'; marquee: boolean }
export function gameWatch(game: Game, players: WatchPlayer[]): GameWatch {
  const side = (team: string) => favoritesFirst(players.filter(player => canonicalTeam(player.team) === canonicalTeam(team)));
  const away = side(game.away), home = side(game.home);
  const all = [...away, ...home];
  return { away, home, level: all.some(player => player.tier === 'favorite') ? 'favorite' : all.length ? 'interest' : 'none', marquee: away.length > 0 && home.length > 0 };
}
export const sideLevel = (players: WatchPlayer[]): GameWatch['level'] => players.some(player => player.tier === 'favorite') ? 'favorite' : players.length ? 'interest' : 'none';

/** Current teams for watched players from tonight's box scores or injury listings; null when nothing changed. */
export function syncedTeams(players: WatchPlayer[], lines: PlayerLine[], injuries: Record<string, PlayerInjury> = {}): WatchPlayer[] | null {
  let changed = false;
  const next = players.map(player => {
    const current = lines.find(line => line.id === player.id)?.team || injuries[player.id]?.team;
    if (!current || !/^[A-Z]{2,4}$/.test(current) || canonicalTeam(current) === canonicalTeam(player.team)) return player;
    changed = true;
    return { ...player, team: canonicalTeam(current) };
  });
  return changed ? next : null;
}
