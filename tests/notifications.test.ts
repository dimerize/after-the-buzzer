import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runScheduled } from '../worker/index';
import * as push from '../worker/push';
import type { Night, Preferences } from '../src/shared/types';
import { game, line, night, notificationDb, notificationNow, preferences, pushEnv } from './notification-fixtures';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(notificationNow); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function scheduled(value: Night, prefs = preferences()) {
  const state = notificationDb(value, prefs);
  const delivered: { title: string; body: string; url: string; tag: string }[] = [];
  vi.spyOn(push, 'sendPush').mockImplementation(async (_subscription, payload) => {
    delivered.push(payload); return { ok: true, expired: false };
  });
  const env = { ...pushEnv, DB: state.db, ASSETS: {} as Fetcher };
  await runScheduled(env, notificationNow);
  return { delivered, state, env };
}

describe('useful bedtime notifications', () => {
  it('sends two favorite lines before a higher-scoring league player and links the source night', async () => {
    const james = line({ id: '1966', name: 'LeBron James', points: 28, rebounds: 8, assists: 11, blocks: 0 });
    const { delivered } = await scheduled(night({ players: [line({ id: '999', name: 'League Star', points: 60 }), james, line()] }));
    expect(delivered[0].body).toMatch(/Wembanyama.*34 PTS.*16 REB.*5 AST.*James.*28 PTS.*8 REB.*11 AST/s);
    expect(delivered[0].body).not.toContain('League Star');
    expect(delivered[0].body).toContain('final');
    expect(delivered[0].url).toBe('/?date=2026-10-10&player=5104157');
  });

  it('falls back to actual performers when no favorites are configured', async () => {
    const { delivered } = await scheduled(night(), preferences({ players: [] }));
    expect(delivered[0].body).toContain('34 PTS');
    expect(delivered[0].body).toContain('vs DEN');
  });

  it('shows live timing, unfinished games and partial coverage without inventing finality', async () => {
    const { delivered } = await scheduled(night({ edition: 'live', partial: true, players: [line({ status: 'live' })], games: [game({ status: 'live', statusText: '4th · 8:42' }), game({ id: 'later', status: 'scheduled' })] }));
    expect(delivered[0].body).toContain('8:42');
    expect(delivered[0].body).toContain('1 live');
    expect(delivered[0].body).toContain('1 to start');
    expect(delivered[0].body).toMatch(/partial/i);
    expect(delivered[0].body).not.toContain('All games final');
  });

  it.each([
    line({ didNotPlay: true }), line({ minutes: 0 }), line({ points: NaN }),
    line({ rebounds: -1 }), line({ gameId: 'missing' }), line({ status: 'scheduled' }), line({ id: '0' }),
  ])('does not describe an ineligible row as a performance: %j', async bad => {
    const { delivered } = await scheduled(night({ players: [bad], partial: true }));
    expect(delivered[0].body).not.toContain('34 PTS');
    expect(delivered[0].body).not.toContain('Wembanyama');
    expect(delivered[0].body).toMatch(/unavailable|partial/i);
    expect(delivered[0].url).toBe('/?date=2026-10-10');
  });

  it('never leaks performance, participant selection, scores or game state with spoilers hidden', async () => {
    const hidden = preferences({ hideScores: true });
    const first = (await scheduled(night(), hidden)).delivered[0];
    const second = (await scheduled(night({ players: [line({ points: 60 })], games: [game({ status: 'live' })], partial: true, headline: 'A different winner' }), hidden)).delivered[0];
    expect(first).toEqual(second);
    expect(`${first.title} ${first.body}`).not.toMatch(/34|60|105|100|Wembanyama|final|live|winner|SAS/i);
    expect(first.url).toBe('/?date=2026-10-10');
  });

  it('bounds push text without clipping the remaining-game context', async () => {
    const { delivered } = await scheduled(night({ players: [line({ name: 'Very long player name '.repeat(5) }), line({ id: '1966', name: 'Another very long name '.repeat(5) })], games: [game(), game({ id: 'live', status: 'live' })] }));
    expect(delivered[0].body.length).toBeLessThanOrEqual(200);
    expect(delivered[0].body).toContain('1 live');
  });

  it('does not send sample performances, empty slates or quiet-hour alerts', async () => {
    expect((await scheduled(night({ source: 'demo' }))).delivered).toEqual([]);
    expect((await scheduled(night({ games: [], players: [] }))).delivered).toEqual([]);
    expect((await scheduled(night(), preferences({ quietStart: '23:00', quietEnd: '08:00' }))).delivered).toEqual([]);
  });

  it('keeps the once-per-night claim across scheduler invocations', async () => {
    const { delivered, env } = await scheduled(night());
    await runScheduled(env, notificationNow);
    expect(delivered).toHaveLength(2); // Exactly the two registered devices, once each.
  });

  it('keeps a bedtime send just after midnight tied to the preceding basketball night', async () => {
    const afterMidnight = new Date('2026-10-11T04:00:00Z');
    vi.setSystemTime(afterMidnight);
    const state = notificationDb(night({ updatedAt: afterMidnight.toISOString() }), preferences({ bedtime: '23:56' }));
    const sent = vi.spyOn(push, 'sendPush').mockResolvedValue({ ok: true, expired: false });
    await runScheduled({ ...pushEnv, DB: state.db, ASSETS: {} as Fetcher }, afterMidnight);
    expect(sent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ url: '/?date=2026-10-10&player=5104157' }), expect.anything());
    expect(state.notifications.has('bedtime:2026-10-10')).toBe(true);
  });
});

describe('opted-in milestone notification', () => {
  const liveNight = () => night({ edition: 'live', players: [line({ points: 40, status: 'live' })], games: [game({ status: 'live', statusText: '4th · 3:21' })] });
  const livePreferences = (values: Partial<Preferences> = {}) => preferences({ bedtime: '22:00', liveAlerts: true, ...values });

  it('contains the full basic stat line, opponent, live clock and deep link', async () => {
    const { delivered } = await scheduled(liveNight(), livePreferences());
    expect(delivered[0].body).toMatch(/40 PTS.*16 REB.*5 AST.*2 STL.*7 BLK/);
    expect(delivered[0].body).toContain('vs DEN');
    expect(delivered[0].body).toContain('3:21');
    expect(delivered[0].url).toBe('/?date=2026-10-10&player=5104157');
  });

  it('does not send without player opt-in or with spoiler hiding', async () => {
    const p = livePreferences();
    expect((await scheduled(liveNight(), { ...p, players: p.players.map(player => ({ ...player, alerts: false })) })).delivered).toEqual([]);
    expect((await scheduled(liveNight(), livePreferences({ hideScores: true }))).delivered).toEqual([]);
  });

  it('does not report live milestones from a final-game mismatch or sample data', async () => {
    expect((await scheduled(liveNight(), livePreferences({ quietStart: '23:00', quietEnd: '08:00' }))).delivered).toEqual([]);
    expect((await scheduled({ ...liveNight(), games: [game()] }, livePreferences())).delivered).toEqual([]);
    expect((await scheduled({ ...liveNight(), source: 'demo' }, livePreferences())).delivered).toEqual([]);
  });
});
