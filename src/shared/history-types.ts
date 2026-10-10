export type HistorySeasonType = 'regular' | 'postseason';
export type HistoryCoverage = 'complete' | 'partial' | 'unavailable' | 'no-data';

/** Missing provider fields stay null; percentages are on a 0–100 scale. */
export interface HistoricalStats {
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  threes: number | null;
  turnovers: number | null;
  minutes: number | null;
  fgMade: number | null;
  fgAttempted: number | null;
  ftMade: number | null;
  ftAttempted: number | null;
  fgPct: number | null;
  threePct: number | null;
  ftPct: number | null;
}

export interface HistoricalAggregate {
  games: number | null;
  starts: number | null;
  averages: HistoricalStats;
  totals: HistoricalStats;
  doubleDoubles: number | null;
  tripleDoubles: number | null;
}

export interface HistoricalSeason extends HistoricalAggregate {
  /** ESPN uses the ending year: 2026 is the 2025–26 season. */
  season: number;
  label: string;
  teams: string[];
}

export interface CareerHistorySection {
  seasonType: HistorySeasonType;
  coverage: HistoryCoverage;
  seasons: HistoricalSeason[];
  career: HistoricalAggregate | null;
  sourceUrl: string;
  warnings: string[];
}

export interface PlayerCareerHistory {
  playerId: string;
  updatedAt: string;
  source: 'espn';
  /** Years with actual NBA season statistics, not a guessed career span. */
  availableSeasons: number[];
  regular: CareerHistorySection;
  postseason: CareerHistorySection;
}

export interface HistoricalPerformance {
  gameId: string;
  date: string;
  season: number;
  seasonType: HistorySeasonType;
  team: string;
  opponent: string;
  home: boolean | null;
  result: 'W' | 'L' | null;
  stats: HistoricalStats;
  /** Computed box-score thresholds, never official awards. */
  milestones: string[];
  sourceUrl: string;
}

export interface SeasonLogSection {
  seasonType: HistorySeasonType;
  coverage: HistoryCoverage;
  games: HistoricalPerformance[];
  /** Top 10 scoring games; ties use rebounds, assists, then game ID. */
  topPerformances: HistoricalPerformance[];
  excludedGames: number;
  warnings: string[];
}

export interface PlayerSeasonLog {
  playerId: string;
  season: number;
  label: string;
  updatedAt: string;
  source: 'espn';
  sourceUrl: string;
  availableSeasons: number[];
  regular: SeasonLogSection;
  postseason: SeasonLogSection;
}
