import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/shared/defaults';
import type { Preferences } from '../src/shared/types';
import { buildRecap } from '../worker/recap';
import { getPreferences } from '../worker/store';
import { game, line } from './notification-fixtures';

const performances = Array.from({ length: 12 }, (_, index) => line({
  id: String(900 + index), name: `League Player ${index + 1}`, points: 30 + index,
  rebounds: 6, assists: 4, blocks: 0, steals: 1,
}));
function preferenceDb(saved?: Preferences): D1Database {
  return { prepare: () => ({ bind() { return this; }, async first() { return saved ? { value: JSON.stringify(saved) } : null; } }) } as unknown as D1Database;
}
const recap = (preferences: Preferences) => buildRecap([game()], performances, preferences,
  { date: '2026-10-10', season: '2026-27', seasonType: 'regular' });

describe('new-owner Full Detail preference', () => {
  it('retains a full candidate slate instead of applying Standard truncation when no preference is saved', async () => {
    const preferences = await getPreferences(preferenceDb());
    const night = recap(preferences);
    expect(night.highlights).toHaveLength(12);
    expect(new Set(night.highlights.map(story => story.playerId))).toEqual(new Set(performances.map(player => player.id)));
  });

  it.each([['quick', 4], ['normal', 8]] as const)('preserves an explicitly saved %s preference and its story limit', async (length, count) => {
    const preferences = await getPreferences(preferenceDb({ ...structuredClone(DEFAULT_PREFERENCES), length }));
    expect(recap(preferences).highlights).toHaveLength(count);
  });
});
