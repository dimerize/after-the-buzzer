import type { Game } from './types';

export interface InjuryPlayer {
  id: string;
  name: string;
  status: string;
  reason: string;
  updatedAt: string | null;
  estimatedReturn: string | null;
}
export interface InjuryTeam {
  team: string;
  displayName: string;
  coverage: 'reported' | 'not-listed' | 'unavailable';
  players: InjuryPlayer[];
}
export interface GameInjuryReport {
  gameId: string;
  date: string;
  game: Game;
  source: 'espn';
  sourceUrl: string;
  officialSourceUrl: string;
  fetchedAt: string | null;
  feedUpdatedAt: string | null;
  stale: boolean;
  availability: 'current' | 'historical-unavailable' | 'unavailable';
  teams: InjuryTeam[];
  warnings: string[];
}
