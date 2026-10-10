import type { SeasonHonors, SeasonHonorCategory, SeasonHonorLeader } from '../src/shared/honors-types';
export function lastCompletedSeason(now = new Date()): number { return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1; }
const CATEGORIES = [
  ['pointsPerGame', 'Scoring', 'PPG'], ['reboundsPerGame', 'Rebounds', 'RPG'],
  ['assistsPerGame', 'Assists', 'APG'], ['blocksPerGame', 'Blocks', 'BPG'],
  ['stealsPerGame', 'Steals', 'SPG'], ['3PointsMadePerGame', 'Three-pointers', '3PM/G']
] as const;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export function honorsSourceUrl(season: number): string {
  return `https://site.api.espn.com/apis/site/v3/sports/basketball/nba/leaders?season=${season}&seasontype=2`;
}
export function parseSeasonHonors(input: unknown, season: number): SeasonHonors {
  const root = record(input), requested = record(root.requestedSeason);
  if (requested.year !== season || record(requested.type).type !== 2) throw new Error('Historical leader season could not be verified.');
  const sourceCategories = array(record(root.leaders).categories).map(record);
  const categories: SeasonHonorCategory[] = [];
  const warnings: string[] = [];
  for (const [id, label, unit] of CATEGORIES) {
    const source = sourceCategories.find(category => category.name === id);
    const seen = new Set<string>();
    const leaders: SeasonHonorLeader[] = [];
    for (const entry of array(source?.leaders).map(record)) {
      const athlete = record(entry.athlete), team = record(entry.team);
      if (typeof athlete.id !== 'string' || !/^\d+$/.test(athlete.id) || typeof athlete.displayName !== 'string' || !athlete.displayName.trim() || seen.has(athlete.id)) continue;
      if (typeof entry.value !== 'number' || !Number.isFinite(entry.value) || entry.value < 0) continue;
      seen.add(athlete.id);
      leaders.push({ playerId: athlete.id, name: athlete.displayName, team: typeof team.abbreviation === 'string' ? team.abbreviation : '', value: entry.value, displayValue: entry.value.toFixed(1), rank: 0 });
    }
    leaders.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    const top = leaders.slice(0, 10);
    top.forEach((leader, index) => { leader.rank = index > 0 && leader.value === top[index - 1].value ? top[index - 1].rank : index + 1; });
    if (!top.length) { warnings.push(`${label} leaders unavailable.`); continue; }
    categories.push({ id, label, unit, leaders: top });
  }
  return { season, label: typeof requested.displayName === 'string' ? requested.displayName : `${season - 1}-${String(season).slice(-2)}`, seasonType: 'regular', source: 'espn', sourceUrl: honorsSourceUrl(season), updatedAt: new Date().toISOString(), categories, warnings };
}
export async function fetchSeasonHonors(season: number): Promise<SeasonHonors> {
  const response = await fetch(honorsSourceUrl(season), { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Season leaders unavailable.');
  const result = parseSeasonHonors(await response.json(), season);
  if (!result.categories.length) throw new Error('Season leaders unavailable.');
  return result;
}
