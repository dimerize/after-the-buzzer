import { describe, expect, it } from 'vitest';
import { lastCompletedSeason, parseSeasonHonors } from '../worker/season-honors';
const entry = (id: string, value: number) => ({ athlete: { id, displayName: `Player ${id}` }, team: { abbreviation: 'SAS' }, value, displayValue: value.toFixed(1) });
const fixture = (categories: unknown[]) => ({ requestedSeason: { year: 2026, displayName: '2025-26', type: { type: 2 } }, leaders: { categories } });
describe('historical season honors', () => {
  it('selects the last completed season, not the current preseason', () => {
    expect(lastCompletedSeason(new Date('2026-10-10T00:00Z'))).toBe(2026);
    expect(lastCompletedSeason(new Date('2026-03-10T00:00Z'))).toBe(2025);
  });
  it('requires explicit matching year and regular-season metadata', () => {
    expect(() => parseSeasonHonors(fixture([]), 2025)).toThrow();
    expect(() => parseSeasonHonors({ ...fixture([]), requestedSeason: { year: 2026, type: { type: 3 } } }, 2026)).toThrow();
    expect(() => parseSeasonHonors({ leaders: { categories: [] } }, 2026)).toThrow();
  });
  it('sorts numerical values, preserves ties and only includes supported scoring categories', () => {
    const result = parseSeasonHonors(fixture([
      { name: 'pointsPerGame', leaders: [entry('2', 20), entry('1', 30), entry('3', 30)] },
      { name: 'PER', leaders: [entry('4', 80)] }
    ]), 2026);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]).toMatchObject({ id: 'pointsPerGame', unit: 'PPG' });
    expect(result.categories[0].leaders.map(p => [p.playerId, p.rank])).toEqual([['1', 1], ['3', 1], ['2', 3]]);
    expect(result.label).toBe('2025-26');
    expect(result.sourceUrl).toContain('season=2026');
  });
  it('filters malformed values and warns on missing categories instead of filling zeroes', () => {
    const result = parseSeasonHonors(fixture([{ name: 'blocksPerGame', leaders: [entry('1', 3.1), entry('2', -5), { ...entry('3', 1), value: null }] }]), 2026);
    expect(result.categories[0].leaders).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
