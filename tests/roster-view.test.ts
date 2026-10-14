import { describe, expect, it } from 'vitest';
import { rosterPlayerStatus, rosterPlayers } from '../src/roster-view';
import { game, line } from './notification-fixtures';
import type { WatchPlayer } from '../src/shared/types';
const player: WatchPlayer = { id: '5104157', name: 'Victor Wembanyama', team: 'SA', tier: 'favorite', alerts: true };
describe('schedule-aware roster', () => {
  it('distinguishes verified off days from unavailable schedule data', () => {
    expect(rosterPlayerStatus(player, undefined, [], true, 'America/New_York')).toBe('No game scheduled');
    expect(rosterPlayerStatus(player, undefined, [], false, 'America/New_York')).toBe('Schedule unavailable');
    expect(rosterPlayerStatus({...player,team:'TBD'}, undefined, [], true, 'America/New_York')).toBe('Team unverified');
  });
  it('uses team aliases for scheduled opponents without claiming participation', () => {
    const status = rosterPlayerStatus(player, undefined, [game({status:'scheduled', startsAt:'2026-10-13T23:00:00Z'})], true, 'America/New_York');
    expect(status).toContain('DEN'); expect(status).toContain('7:00 PM');
    expect(status).not.toContain('No game');
  });
  it('does not infer DNP or off-day from an absent box score', () => {
    expect(rosterPlayerStatus(player, undefined, [game()], true, 'UTC')).toBe('Final · Stats unavailable');
    expect(rosterPlayerStatus(player, undefined, [game({status:'live'})], true, 'UTC')).toBe('Live · Stats pending');
    expect(rosterPlayerStatus(player, undefined, [game({status:'postponed'})], true, 'UTC')).toBe('Postponed');
    expect(rosterPlayerStatus(player, line({didNotPlay:true}), [game()], true, 'UTC')).toBe('DNP');
  });
  it('uses historical line team instead of current team for an older game', () => {
    expect(rosterPlayerStatus({...player,team:'NYK'}, line({team:'SAS'}), [game()], false, 'UTC')).toBe('Final');
  });
  it('includes following and legacy league entries without losing favorites', () => {
    const following = {...player,id:'2',tier:'interest' as const};
    const legacy = {...player,id:'3',tier:'league' as const};
    expect(rosterPlayers([player,following,legacy], 'interest').map(p=>p.id)).toEqual(['2','3']);
    expect(rosterPlayers([player,following,legacy], 'all')).toHaveLength(3);
    expect(rosterPlayers([player,following,legacy], 'favorite').map(p=>p.id)).toEqual(['5104157']);
  });
});
