export interface SeasonHonorLeader {
  playerId: string;
  name: string;
  team: string;
  value: number;
  displayValue: string;
  rank: number;
}
export interface SeasonHonorCategory {
  id: string;
  label: string;
  unit: string;
  leaders: SeasonHonorLeader[];
}
export interface SeasonHonors {
  season: number;
  label: string;
  seasonType: 'regular';
  source: 'espn';
  sourceUrl: string;
  updatedAt: string;
  categories: SeasonHonorCategory[];
  warnings: string[];
}
