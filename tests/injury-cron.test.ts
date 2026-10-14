import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import { night, notificationDb, preferences } from './notification-fixtures';

const injuryPoll = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}));
vi.mock('../worker/injury-alerts', async importOriginal => ({
  ...(await importOriginal<typeof import('../worker/injury-alerts')>()),
  runInjuryAlerts: injuryPoll,
}));
import { runScheduled } from '../worker/index';

const now = new Date('2026-10-10T18:01:00Z');
const opted = () => preferences({ injuryAlerts: true, players: [{ id: '5104157', name: 'Victor Wembanyama', team: 'SAS', tier: 'favorite', alerts: false, injuryAlerts: true }] });
function readyEnv(prefs = opted()) {
  const state = notificationDb(night({ updatedAt: now.toISOString() }), prefs);
  const env: Env = { APP_PASSWORD: 'test-only', DB: state.db, ASSETS: {} as Fetcher };
  return { state, env };
}

beforeEach(() => { injuryPoll.mockReset(); injuryPoll.mockResolvedValue(undefined); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('injury poll cron integration', () => {
  it('calls the injury poll before daytime recap recovery returns early', async () => {
    const recoveryNow = new Date('2026-10-10T14:10:00Z');
    vi.setSystemTime(recoveryNow);
    const prefs = opted();
    const previous = night({ date: '2026-10-09', updatedAt: recoveryNow.toISOString(), partial: true });
    const current = night({ updatedAt: recoveryNow.toISOString() });
    const events: string[] = [];
    injuryPoll.mockImplementation(async () => { events.push('injury'); });
    const db = { prepare(sql: string) {
      let args: unknown[] = [];
      return { bind(...values: unknown[]) { args = values; return this; },
        async first() {
          if (sql.includes('FROM preferences')) { events.push('preferences'); return { value: JSON.stringify(prefs) }; }
          if (sql.includes('FROM editions')) { events.push(String(args[0]) === '2026-10-09' ? 'old-night' : 'current-night'); return { payload: JSON.stringify(String(args[0]) === '2026-10-09' ? previous : current) }; }
          throw new Error(`Unexpected read: ${sql}`);
        },
        async all() {
          if (sql.includes('FROM editions WHERE date <')) { events.push('recovery-scan'); return { results: [{ payload: JSON.stringify(previous) }] }; }
          throw new Error(`Unexpected scan: ${sql}`);
        },
      };
    } } as unknown as D1Database;
    const env: Env = { APP_PASSWORD: 'test-only', DB: db, ASSETS: {} as Fetcher };
    await runScheduled(env, recoveryNow);
    expect(injuryPoll).toHaveBeenCalledOnce();
    expect(injuryPoll).toHaveBeenCalledWith(env, prefs, recoveryNow, expect.any(Function));
    expect(events).toEqual(['preferences', 'injury', 'current-night', 'recovery-scan', 'old-night']);
  });

  it.each([
    ['global disabled', preferences({ injuryAlerts: false, players: opted().players })],
    ['no player opted', preferences({ injuryAlerts: true, players: [{ ...opted().players[0], injuryAlerts: false }] })],
  ])('skips the injury poll when %s', async (_label, prefs) => {
    const { env } = readyEnv(prefs);
    await runScheduled(env, now);
    expect(injuryPoll).not.toHaveBeenCalled();
  });

  it('preserves an explicit injury opt-in when a legacy League player moves to Following', async () => {
    const { env } = readyEnv(preferences({injuryAlerts:true,players:[{...opted().players[0],tier:'league'}]}));
    await runScheduled(env, now);
    expect(injuryPoll).toHaveBeenCalledOnce();
    expect(injuryPoll).toHaveBeenCalledWith(env, expect.objectContaining({players:[expect.objectContaining({tier:'interest',injuryAlerts:true})]}), now, expect.any(Function));
  });

  it('continues the normal recap path after an injury poll failure', async () => {
    const { env } = readyEnv();
    injuryPoll.mockRejectedValueOnce(new Error('ESPN injury feed unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const batch = vi.spyOn(env.DB, 'batch');
    await expect(runScheduled(env, now)).resolves.toBeUndefined();
    expect(injuryPoll).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('Injury alert poll failed:', 'ESPN injury feed unavailable');
  });
});
