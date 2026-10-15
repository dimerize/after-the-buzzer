export type RecordStat = 'points' | 'rebounds' | 'assists' | 'blocks' | 'steals' | 'threes';
export type RecordMode = 'season' | 'game' | 'single-season';
export type RecordMeasure = 'per-game' | 'totals';

/** Compact, source-verified dataset built by scripts/history/build-records.mjs. */
export type SeasonRow = [player: string, team: string, games: number, total: number];
export type AllTimeSeasonRow = [player: string, season: number, team: string, games: number, total: number];
export type GameRow = [player: string, value: number, date: string, team: string, opponent: string, score: string | null];
export interface RecordsData {
  version: number; builtAt: string; minGames: number;
  stats: { id: RecordStat; since: number }[];
  seasons: Record<string, { players: number; verifiedAt: string } & Record<RecordMeasure, Partial<Record<RecordStat, SeasonRow[]>>>>;
  singleSeason: Record<RecordMeasure, Record<RecordStat, AllTimeSeasonRow[]>>;
  singleGame: Record<RecordStat, GameRow[]>;
  /** key (Basketball-Reference ID, or wd:Q… when none) → [name, NBA.com ID with a real photo, ESPN ID with a real photo] */
  players: Record<string, [name: string, nbaId: string | null, espnId: string | null]>;
  sources: {
    seasons: { label: string; url: string; verifiedAt: string };
    games: { label: string; verifiedAt: string; revisions: Record<RecordStat, { page: string; revision: number; url: string }> };
    identities: { label: string; url: string };
  };
}

export interface RecordPlayer { key: string; name: string; nbaId: string | null; espnId: string | null; bbrefId: string | null }
export interface RecordLeader {
  key: string; rank: number; player: RecordPlayer; team: string; season: number;
  games: number | null; total: number; value: number; display: string;
  date?: string; opponent?: string; score?: string | null;
}
export interface RecordCategory { id: RecordStat; label: string; unit: string; since: number; leaders: RecordLeader[] }
export interface RecordSeason { season: number; label: string; inProgress: boolean }
export interface RecordsView {
  mode: RecordMode; measure: RecordMeasure; season: number | null; minGames: number | null;
  categories: RecordCategory[]; source: { label: string; url: string; verifiedAt: string };
  scope: string; notes: string[];
}

/** One player's regular-season totals from ESPN, for seasons newer than the dataset. */
export type LiveRow = [espnId: string, name: string, team: string, games: number, points: number, rebounds: number, assists: number, blocks: number, steals: number, threes: number];
export interface LiveSeason { season: number; inProgress: boolean; fetchedAt: string; rows: LiveRow[] }
