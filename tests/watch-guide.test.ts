import { describe, expect, it } from 'vitest';
import { parseBroadcasts } from '../worker/espn';
import { watchGuide } from '../src/shared/watch-guide';
import { gameWatch, syncedTeams } from '../src/shared/team-matching';
import { rosterStatus } from '../src/roster-view';
import { validatePreferences } from '../worker/validation';
import { normalizePreferences } from '../src/shared/normalize-preferences';
import { DEFAULT_PREFERENCES } from '../src/shared/defaults';
import { game, line } from './notification-fixtures';
import type { Broadcast, WatchPlayer } from '../src/shared/types';

const listed = (broadcasts: Broadcast[], values = {}) => game({ status: 'scheduled', away: 'BOS', home: 'DEN', broadcasts, ...values });
describe('ESPN broadcast listings', () => {
  it('keeps US TV and streaming listings by market and drops radio and other regions', () => {
    expect(parseBroadcasts({ geoBroadcasts: [
      { type: { shortName: 'TV' }, market: { type: 'National' }, media: { shortName: 'ESPN' }, region: 'us' },
      { type: { shortName: 'TV' }, market: { type: 'Home' }, media: { shortName: 'MSG' } },
      { type: { shortName: 'Streaming' }, market: { type: 'Away' }, media: { shortName: 'Suns Live' } },
      { type: { shortName: 'Radio' }, market: { type: 'National' }, media: { shortName: 'ERADM' } },
      { type: { shortName: 'TV' }, market: { type: 'National' }, media: { shortName: 'TSN' }, region: 'ca' },
    ] })).toEqual([{ market: 'national', type: 'tv', name: 'ESPN' }, { market: 'home', type: 'tv', name: 'MSG' }, { market: 'away', type: 'streaming', name: 'Suns Live' }]);
    expect(parseBroadcasts({ broadcasts: [{ market: 'national', names: ['NBA TV'] }] })).toEqual([{ market: 'national', type: 'tv', name: 'NBA TV' }]);
    expect(parseBroadcasts({})).toEqual([]);
  });
});

describe('League Pass verdicts', () => {
  it('blacks out national exclusives and names how to stream them', () => {
    const guide = watchGuide(listed([{ market: 'national', type: 'tv', name: 'Prime Video' }]));
    expect(guide).toMatchObject({ status: 'national', chip: 'Prime Video', headline: 'Not on League Pass live' });
    expect(guide.lines[0]).toEqual({ network: 'Prime Video', detail: 'Prime Video app', scope: 'National' });
    expect(watchGuide(listed([{ market: 'national', type: 'tv', name: 'NBC' }])).lines[0].detail).toContain('Peacock');
  });
  it('blacks out Knicks and Nets local broadcasts in the New York market', () => {
    const knicks = watchGuide(listed([{ market: 'home', type: 'tv', name: 'MSG' }, { market: 'away', type: 'tv', name: 'NBC Sports BO' }], { home: 'NYK' }), 'NY');
    expect(knicks).toMatchObject({ status: 'local', chip: 'MSG', headline: 'Blacked out on League Pass' });
    expect(knicks.reason).toContain('Knicks');
    expect(knicks.lines[0]).toMatchObject({ network: 'MSG', scope: 'NYK local' });
    const nets = watchGuide(listed([], { away: 'BKN' }), 'NY');
    expect(nets).toMatchObject({ status: 'local', chip: 'YES' });
    expect(nets.reason).toContain('on YES');
    expect(watchGuide(listed([], { away: 'BKN' }), 'NONE').status).toBe('listings-pending');
  });
  it('keeps out-of-market and NBA TV games on League Pass and flags missing listings', () => {
    expect(watchGuide(listed([{ market: 'home', type: 'tv', name: 'Altitude' }]), 'NY')).toMatchObject({ status: 'available', chip: 'League Pass' });
    expect(watchGuide(listed([{ market: 'national', type: 'tv', name: 'NBA TV' }]), 'NY').reason).toContain('NBA TV');
    expect(watchGuide(listed([{ market: 'national', type: 'tv', name: 'NBA TV' }], { home: 'NYK' }), 'NY').status).toBe('local');
    expect(watchGuide(listed([])).status).toBe('listings-pending');
    expect(watchGuide(game({ status: 'scheduled' }), 'NY').status).toBe('listings-pending');
  });
});

const favorite: WatchPlayer = { id: '5104157', name: 'Victor Wembanyama', team: 'SA', tier: 'favorite', alerts: true };
const following: WatchPlayer = { id: '3112335', name: 'Nikola Jokic', team: 'DEN', tier: 'interest', alerts: false };
describe('watched games', () => {
  it('marks one-sided games by best tier and marquee games when both teams have a watched player', () => {
    expect(gameWatch(game(), [favorite])).toMatchObject({ level: 'favorite', marquee: false, home: [favorite], away: [] });
    expect(gameWatch(game(), [following])).toMatchObject({ level: 'interest', marquee: false });
    expect(gameWatch(game(), [favorite, following])).toMatchObject({ level: 'favorite', marquee: true });
    expect(gameWatch(game({ home: 'LAL', away: 'BOS' }), [favorite, following]).level).toBe('none');
  });
  it('moves a traded player to the team in tonight’s box score or injury listing only when it changed', () => {
    expect(syncedTeams([favorite], [line({ team: 'SAS' })])).toBeNull();
    expect(syncedTeams([{ ...favorite, team: 'NYK' }], [line({ team: 'SAS' })])?.[0].team).toBe('SAS');
    expect(syncedTeams([following], [], { [following.id]: { status: 'Out', reason: 'Knee', updatedAt: null, team: 'WSH' } })?.[0].team).toBe('WAS');
  });
});

describe('roster status plates', () => {
  const scheduled = [game({ status: 'scheduled', startsAt: '2026-10-14T23:30:00Z' })];
  it('shows Out and questionable listings for today with the matchup', () => {
    expect(rosterStatus(favorite, undefined, scheduled, true, 'America/New_York', { status: 'Out', reason: 'Knee', updatedAt: null, team: 'SAS' })).toMatchObject({ tone: 'out', label: 'Out', detail: 'Knee', matchup: 'vs DEN' });
    expect(rosterStatus(favorite, undefined, scheduled, true, 'America/New_York', { status: 'Day-To-Day', reason: 'Rest', updatedAt: null, team: 'SAS' })).toMatchObject({ tone: 'questionable', label: 'Day-To-Day', detail: '7:30 PM · Rest' });
    expect(rosterStatus(favorite, undefined, scheduled, true, 'America/New_York')).toMatchObject({ tone: 'scheduled', label: '7:30 PM', detail: 'vs DEN' });
  });
  it('keeps live stats but flags a player listed Out after tipoff', () => {
    const live = [game({ status: 'live', startsAt: '2026-10-14T23:30:00Z' })];
    const status = rosterStatus(favorite, line({ status: 'live' }), live, true, 'UTC', { status: 'Out', reason: 'Ankle', updatedAt: '2026-10-15T00:40:00Z', team: 'SAS' });
    expect(status).toMatchObject({ tone: 'stats', ruledOut: true });
    expect(rosterStatus(favorite, line({ status: 'live' }), live, true, 'UTC', { status: 'Out', reason: 'Ankle', updatedAt: '2026-10-14T18:00:00Z', team: 'SAS' }).ruledOut).toBeUndefined();
  });
  it('never claims "no game" on a past night, where only the current team is known', () => {
    expect(rosterStatus(favorite, undefined, [], true, 'UTC', undefined, false)).toMatchObject({ tone: 'off', label: 'No stats' });
    expect(rosterStatus(favorite, undefined, [], true, 'UTC', undefined, true)).toMatchObject({ tone: 'off', label: 'No game' });
  });
});

describe('TV market preference', () => {
  it('defaults old saves to New York and rejects unknown markets', () => {
    const { tvMarket, ...old } = DEFAULT_PREFERENCES;
    expect(tvMarket).toBe('NY');
    expect(normalizePreferences(old).tvMarket).toBe('NY');
    expect(validatePreferences({ ...old, tvMarket: 'LA' }).tvMarket).toBe('LA');
    expect(validatePreferences(old).tvMarket).toBe('NY');
    expect(() => validatePreferences({ ...old, tvMarket: 'Mars' })).toThrow('Invalid TV market.');
  });
});

describe('dashboard injury listings', () => {
  it('returns only watched players from the saved league feed, with their current team', async () => {
    const { loadPlayerInjuries } = await import('../worker/injuries');
    const checked = Date.now();
    const feed = { feedUpdatedAt: new Date(checked).toISOString(), warnings: [], teams: [
      { team: 'SAS', displayName: 'San Antonio Spurs', coverage: 'reported', players: [{ id: '5104157', name: 'Victor Wembanyama', status: 'Out', reason: 'Left knee', updatedAt: null, estimatedReturn: null }, { id: '1', name: 'Someone Else', status: 'Out', reason: 'Back', updatedAt: null, estimatedReturn: null }] },
    ] };
    const db = { prepare: () => ({ bind: () => ({ first: async () => ({ payload: JSON.stringify(feed), checked_at: checked, attempted_at: checked }) }) }) } as unknown as D1Database;
    const result = await loadPlayerInjuries(db, ['5104157', '3112335']);
    expect(result?.players).toEqual({ '5104157': { status: 'Out', reason: 'Left knee', updatedAt: null, team: 'SAS' } });
    expect(result?.stale).toBe(false);
    expect(await loadPlayerInjuries(db, [])).toBeNull();
  });
});
