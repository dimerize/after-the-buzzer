import type { Game, PlayerLine } from './types';

export interface BoxScorePlayer extends PlayerLine {
  threesAttempted: number | null;
  offensiveRebounds: number | null;
  defensiveRebounds: number | null;
  fouls: number | null;
  didNotPlayReason: string | null;
  starterKnown: boolean;
}

export interface BoxScoreTeam {
  team: string;
  players: BoxScorePlayer[];
}

export interface GameBoxScore {
  gameId: string;
  date: string;
  game: Game;
  source: 'espn';
  sourceUrl: string;
  fetchedAt: string | null;
  stale: boolean;
  availability: 'available' | 'not-started' | 'unavailable';
  teams: BoxScoreTeam[];
  warnings: string[];
}
