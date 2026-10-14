export type Tier = 'favorite' | 'interest' | 'league';
export type GameStatus = 'scheduled' | 'live' | 'final' | 'postponed';
export interface WatchPlayer { id: string; name: string; team: string; tier: Tier; alerts: boolean; injuryAlerts?: boolean; }
export interface Preferences {
  players: WatchPlayer[]; bedtime: string; timezone: string;
  length: 'quick' | 'normal' | 'nerd'; hideScores: boolean;
  liveAlerts: boolean; injuryAlerts?: boolean; quietStart: string; quietEnd: string;
}
export interface StatLine {
  points: number; rebounds: number; assists: number; steals: number; blocks: number;
  threes: number; minutes: number; fgMade: number; fgAttempted: number;
  ftMade: number; ftAttempted: number; turnovers: number; plusMinus: number | null;
}
export interface PlayerLine extends StatLine {
  id: string; name: string; team: string; opponent: string;
  gameId: string; rookie: boolean; status: GameStatus; starter: boolean;
  didNotPlay: boolean; headshot?: string;
}
export interface Game {
  id: string; away: string; home: string; awayScore: number | null; homeScore: number | null;
  status: GameStatus; statusText: string; startsAt: string; sourceUrl: string;
}
export interface Highlight {
  id: string; playerId?: string; title: string; detail: string;
  category: 'standout' | 'rookie' | 'efficiency' | 'milestone' | 'favorite';
  score: number; statLabel: string; statValue: string; sourceUrl: string;
}
export interface Leader { category: string; value: number; playerIds: string[]; names: string[]; }
export interface Night {
  date: string; updatedAt: string; edition: 'live' | 'bedtime' | 'final';
  season: string; seasonType: 'preseason' | 'regular' | 'postseason';
  games: Game[]; players: PlayerLine[]; highlights: Highlight[]; leaders: Leader[];
  headline: string; summary: string; source: 'espn' | 'demo';
  partial: boolean; warnings: string[];
  scheduleComplete?: boolean;
}
export interface Tracker {
  playerId: string; name: string; games: number; points: number; rebounds: number;
  assists: number; blocks: number; pointsHigh: number; lastFive: number[];
  scope: string;
}
export interface Dashboard {
  night: Night; preferences: Preferences; archive: { date: string; headline: string; edition: string }[];
  trackers: Tracker[];
  capabilities: { liveData: boolean; persistent: boolean; push: boolean; ai: boolean };
  budget: { used: number; limit: number; month: string };
}
