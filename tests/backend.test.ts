import { describe, expect, it } from 'vitest';
import { validatePreferences, validDate } from '../worker/validation';
import { DEFAULT_PREFERENCES } from '../src/shared/defaults';
import { buildTrackers } from '../worker/store';
import type { Night } from '../src/shared/types';

describe('settings validation', () => {
  it('accepts the default watchlist without changing its tiers', () => expect(validatePreferences(DEFAULT_PREFERENCES)).toEqual(DEFAULT_PREFERENCES));
  it('rejects duplicate IDs and unknown timezones', () => {
    expect(()=>validatePreferences({...DEFAULT_PREFERENCES, players: [DEFAULT_PREFERENCES.players[0],DEFAULT_PREFERENCES.players[0]]})).toThrow();
    expect(()=>validatePreferences({...DEFAULT_PREFERENCES, timezone: 'Mars/Olympus'})).toThrow();
  });
  it('rejects impossible clocks, string booleans and malformed tiers',()=> {
    expect(()=>validatePreferences({...DEFAULT_PREFERENCES, bedtime:'25:30'})).toThrow();
    expect(()=>validatePreferences({...DEFAULT_PREFERENCES, hideScores:'false'})).toThrow();
    expect(()=>validatePreferences({...DEFAULT_PREFERENCES, players:[{...DEFAULT_PREFERENCES.players[0],tier:'bogus'}]})).toThrow();
  });
  it('checks calendar dates rather than just their shape',()=> {
    expect(validDate('2026-02-29')).toBe(false); expect(validDate('2028-02-29')).toBe(true); expect(validDate('2026-10-09')).toBe(true);
  });
});

describe('honest tracker scope',()=> {
  it('does not mix preseason, live games, demos, or seasons',()=> {
    const n = {date:'2026-10-09', source:'espn', season:'2026-27', seasonType:'preseason', players:[{id:'5104157',points:30,rebounds:10,assists:4,blocks:6,status:'final',minutes:25,didNotPlay:false}]} as Night;
    const result=buildTrackers([n,{...n,source:'demo'},{...n,seasonType:'regular'},{...n,season:'2025-26'},{...n,players:[{...n.players[0],status:'live'}]}],DEFAULT_PREFERENCES,n)[0];
    expect(result.games).toBe(1); expect(result.points).toBe(30); expect(result.scope).toContain('not full-season totals');
  });
});
