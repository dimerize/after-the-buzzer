import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/shared/defaults';
import type { Preferences } from '../src/shared/types';
import { buildRecap } from '../worker/recap';
import { getPreferences } from '../worker/store';
import { game, line } from './notification-fixtures';
import { validatePreferences } from '../worker/validation';

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

  it.each(['quick', 'normal'] as const)('upgrades a saved %s preference to Full Detail without losing other settings', async (length) => {
    const preferences = await getPreferences(preferenceDb({ ...structuredClone(DEFAULT_PREFERENCES), length }));
    expect(preferences.length).toBe('nerd');
    expect(recap(preferences).highlights).toHaveLength(12);
    expect({...preferences,length}).toEqual({...DEFAULT_PREFERENCES,length});
  });
  it('accepts an old client save while converting League to Following without changing alert choices', () => {
    const original = {...structuredClone(DEFAULT_PREFERENCES),length:'quick',players:[{...DEFAULT_PREFERENCES.players[0],tier:'league',injuryAlerts:true}]};
    const result = validatePreferences(original);
    expect(result.length).toBe('nerd');
    expect(result.players[0]).toEqual({...original.players[0],tier:'interest'});
    expect(result.bedtime).toBe(original.bedtime); expect(result.quietStart).toBe(original.quietStart);
  });
  it('does not truncate recap candidates even when a legacy caller supplies Quick', () => {
    expect(recap({...DEFAULT_PREFERENCES,length:'quick'}).highlights).toHaveLength(12);
  });
});
