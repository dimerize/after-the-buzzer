// @ts-expect-error Worker tsconfig intentionally excludes Node built-in declarations.
import { DatabaseSync } from 'node:sqlite';
// @ts-expect-error Worker tsconfig intentionally excludes Node built-in declarations.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import type { Preferences } from '../src/shared/types';
import { runInjuryAlerts, resetInjuryAlertBaselines } from '../worker/injury-alerts';

const NOW = new Date('2026-10-10T18:00:00Z');
const GAME = '401898720';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const watched = (id = '5104157', team = 'SAS') => ({ id, name: id === '5104157' ? 'Victor Wembanyama' : 'Stephon Castle', team, tier: 'favorite' as const, alerts: false, injuryAlerts: true });
const prefs = (patch: Partial<Preferences> = {}): Preferences => ({ players: [watched()], bedtime: '23:30', timezone: 'America/New_York', length: 'quick', hideScores: false, liveAlerts: false, injuryAlerts: true, quietStart: '00:00', quietEnd: '09:00', ...patch });
function injury(id = '5104157', status = 'Questionable', team = '24') {
  return { status, date: '2026-10-10T17:50:00Z', athlete: { id, displayName: id === '5104157' ? 'Victor Wembanyama' : 'Stephon Castle', team: { id: team } }, details: { type: 'Knee' } };
}
function feed(entries: unknown[] = [injury()], timestamp = NOW.toISOString()) {
  return { timestamp, status: 'success', injuries: [{ id: '24', displayName: 'San Antonio Spurs', injuries: entries }, { id: '21', displayName: 'Phoenix Suns', injuries: [] }] };
}
function board(startsAt = '2026-10-10T20:00:00Z', team = 'SA') {
  return { leagues: [{ season: { year: 2027, type: 1 } }], events: [{ id: GAME, date: startsAt, season: { year: 2027, type: 1 }, status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } }, competitions: [{ competitors: [{ homeAway: 'away', team: { abbreviation: team } }, { homeAway: 'home', team: { abbreviation: 'PHX' } }] }] }] };
}
function sqliteD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0003_injury_cache.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0004_injury_alerts.sql', import.meta.url), 'utf8'));
  sql.exec('CREATE TABLE preferences (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE notifications (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)');
  const db = { prepare(statement: string) {
    return { bind(...values: unknown[]) {
      const query = sql.prepare(statement);
      const args = values as (string | number | null)[];
      return {
        first: async () => query.get(...args) ?? null,
        all: async () => ({ results: query.all(...args) }),
        run: async () => {
          if (statement.startsWith('DELETE FROM injury_alert_pending WHERE') && onPendingDelete) {
            const callback = onPendingDelete; onPendingDelete = null; callback();
          }
          if (statement.startsWith('INSERT INTO injury_alert_state') && onStateBeforeInsert) {
            const callback = onStateBeforeInsert; onStateBeforeInsert = null; await callback();
          }
          const result = query.run(...args);
          if (statement.startsWith('INSERT INTO injury_alert_pending') && onPendingInsert) {
            const callback = onPendingInsert; onPendingInsert = null; await callback();
          }
          return { meta: { changes: result.changes } };
        },
      };
    } };
  } } as unknown as D1Database;
  return { db, sql };
}

let source: unknown;
let schedule: unknown;
let state: ReturnType<typeof sqliteD1>;
let env: Env;
let delivered: Array<{ id: string; title: string; body: string; url: string; tag: string }>;
let onPendingInsert: (() => Promise<void>) | null;
let onStateBeforeInsert: (() => Promise<void>) | null;
let onPendingDelete: (() => void) | null;
function savePrefs(value: Preferences) { state.sql.prepare('INSERT INTO preferences(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run('owner', JSON.stringify(value)); }
const notify = async (id: string, payload: { title: string; body: string; url: string; tag: string }) => { delivered.push({ id, ...payload }); return true; };
async function poll(preferences = prefs(), now = NOW) { savePrefs(preferences); await runInjuryAlerts(env, preferences, now, notify); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  state = sqliteD1(); env = { DB: state.db, ASSETS: {} as Fetcher }; onPendingInsert = null; onStateBeforeInsert = null; onPendingDelete = null; savePrefs(prefs());
  source = feed(); schedule = board(); delivered = [];
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url.startsWith(`${ESPN}/scoreboard?`)) return Response.json(schedule);
    if (url === `${ESPN}/injuries`) return Response.json(source);
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { state.sql.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('durable injury alerts', () => {
  it('silently baselines a fresh explicit status, then delivers one attributed questionable to out change', async () => {
    await poll(); expect(delivered).toEqual([]);
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await poll(prefs(), new Date()); await poll(prefs(), new Date());
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ url: `/?date=2026-10-10&game=${GAME}&view=injuries` });
    expect(delivered[0].body).toMatch(/Victor Wembanyama.*Questionable.*Out.*ESPN/i);
  });
  it('does not infer a clear status from disappearance and keeps the baseline on reappearance', async () => {
    await poll(); source = feed([],'2026-10-10T18:02:00Z'); vi.setSystemTime(new Date('2026-10-10T18:02:00Z')); await poll(prefs(), new Date());
    source = feed([injury()], '2026-10-10T18:04:00Z'); vi.setSystemTime(new Date('2026-10-10T18:04:00Z')); await poll(prefs(), new Date());
    expect(delivered).toEqual([]);
  });
  it('ignores reason and entry timestamp changes when the explicit status is unchanged', async () => {
    await poll();
    source = feed([{ ...injury(), date: '2026-10-10T18:02:00Z', details: { type: 'Ankle' } }], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await poll(prefs(), new Date());
    expect(delivered).toEqual([]);
  });
  it('suppresses stale, malformed, and wrong-team observations', async () => {
    await poll();
    source = feed([injury('5104157', 'Out')], '2026-10-10T17:00:00Z'); vi.setSystemTime(new Date('2026-10-10T18:02:00Z')); await poll(prefs(), new Date());
    source = { injuries: 'bad' }; vi.setSystemTime(new Date('2026-10-10T18:04:00Z')); await poll(prefs(), new Date());
    source = feed([injury('5104157', 'Out', '21')], '2026-10-10T18:06:00Z'); vi.setSystemTime(new Date('2026-10-10T18:06:00Z')); await poll(prefs(), new Date());
    expect(delivered).toEqual([]);
  });
  it('consumes quiet-hour changes without backlogging them when quiet hours end', async () => {
    await poll(); source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await poll(prefs({ quietStart: '00:00', quietEnd: '23:59' }), new Date());
    vi.setSystemTime(new Date('2026-10-10T18:04:00Z'));
    await poll(prefs(), new Date());
    expect(delivered).toEqual([]);
  });
  it('never sends a change at or after tipoff', async () => {
    await poll(); source = feed([injury('5104157', 'Out')], '2026-10-10T20:00:00Z');
    vi.setSystemTime(new Date('2026-10-10T20:00:00Z'));
    await poll(prefs(), new Date());
    expect(delivered).toEqual([]);
  });
  it('drops global opt-out state and silently rebaselines on re-enable', async () => {
    await poll();
    await poll(prefs({ injuryAlerts: false }));
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await poll(prefs(), new Date());
    expect(delivered).toEqual([]);
  });
  it('requires the watched team to match the scheduled game and injury team', async () => {
    await poll();
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await poll(prefs({ players: [watched('5104157', 'LAL')] }), new Date());
    expect(delivered).toEqual([]);
  });
  it('does not alert from a team block when the athlete team cannot be verified', async () => {
    await poll();
    source = feed([{ ...injury('5104157', 'Out'), athlete: { id: '5104157', displayName: 'Victor Wembanyama' } }], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await poll(prefs(), new Date());
    expect(delivered).toEqual([]);
  });
  it('resets disabled and re-enabled player baselines', async () => {
    const enabled = prefs(); await poll(enabled);
    await resetInjuryAlertBaselines(state.db, enabled, prefs({ players: [] }));
    await resetInjuryAlertBaselines(state.db, prefs({ players: [] }), enabled);
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z'); vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await poll(enabled, new Date()); expect(delivered).toEqual([]);
  });
  it('groups two changes into one bounded notification under concurrent polls', async () => {
    const preferences = prefs({ players: [watched(), watched('5037871')] });
    source = feed([injury(), injury('5037871')]); await poll(preferences);
    source = feed([injury('5104157', 'Out'), injury('5037871', 'Probable')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await Promise.all([poll(preferences, new Date()), poll(preferences, new Date())]);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].body).toMatch(/Victor Wembanyama.*Stephon Castle.*ESPN/i);
    expect(delivered[0].body.length).toBeLessThanOrEqual(200);
    expect(delivered[0].title.length).toBeLessThanOrEqual(100);
  });
  it('retries a failed delivery while the same explicit status is fresh and pre-tipoff', async () => {
    await poll();
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    let attempts = 0;
    await runInjuryAlerts(env, prefs(), new Date(), async () => { attempts++; return false; });
    vi.setSystemTime(new Date('2026-10-10T18:04:00Z'));
    await poll(prefs(), new Date());
    expect(attempts).toBe(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].body).toMatch(/Questionable.*Out.*ESPN/);
  });
  it('cancels a failed delivery during quiet hours instead of backlogging it', async () => {
    await poll();
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await runInjuryAlerts(env, prefs(), new Date(), async () => false);
    vi.setSystemTime(new Date('2026-10-10T18:04:00Z'));
    await poll(prefs({ quietStart: '00:00', quietEnd: '23:59' }), new Date());
    vi.setSystemTime(new Date('2026-10-10T18:06:00Z'));
    await poll(prefs(), new Date());
    expect(delivered).toEqual([]);
  });
  it('cancels a failed delivery during quiet hours even if the feed is stale then', async () => {
    await poll();
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await runInjuryAlerts(env, prefs(), new Date(), async () => false);
    source = feed([injury('5104157', 'Out')], '2026-10-10T17:00:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:04:00Z'));
    await poll(prefs({ quietStart: '00:00', quietEnd: '23:59' }), new Date());
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:06:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:06:00Z'));
    await poll(prefs(), new Date());
    expect(delivered).toEqual([]);
  });
  it('cancels a failed delivery at tipoff', async () => {
    await poll();
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await runInjuryAlerts(env, prefs(), new Date(), async () => false);
    vi.setSystemTime(new Date('2026-10-10T20:00:00Z'));
    await poll(prefs(), new Date());
    expect(delivered).toEqual([]);
  });
  it('does not send after an opt-out completes during the pending write', async () => {
    const enabled = prefs(); await poll(enabled);
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    onPendingInsert = async () => {
      const disabled = prefs({ injuryAlerts: false }); savePrefs(disabled);
      await resetInjuryAlertBaselines(state.db, enabled, disabled);
    };
    await runInjuryAlerts(env, enabled, new Date(), notify);
    expect(delivered).toEqual([]);
  });
  it('does not send when tipoff passes during a fresh change write', async () => {
    await poll(); source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    onPendingInsert = async () => { vi.setSystemTime(new Date('2026-10-10T20:00:00Z')); };
    await poll(prefs(), new Date('2026-10-10T18:02:00Z'));
    expect(delivered).toEqual([]);
  });
  it('does not retry a pending change after quiet hours start during the write', async () => {
    const settings = prefs({ quietStart: '14:03', quietEnd: '14:04' });
    await poll(settings);
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await runInjuryAlerts(env, settings, new Date(), async () => false);
    vi.setSystemTime(new Date('2026-10-10T18:02:30Z'));
    onPendingInsert = async () => { vi.setSystemTime(new Date('2026-10-10T18:03:00Z')); };
    await poll(settings, new Date('2026-10-10T18:02:30Z'));
    expect(delivered).toEqual([]);
  });
  it('rejects an older source observation rather than reporting a false reverse transition', async () => {
    source = feed([injury()], '2026-10-10T17:55:00Z');
    await poll();
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:01:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await poll(prefs(), new Date());
    source = feed([injury()], '2026-10-10T17:57:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:04:00Z'));
    await poll(prefs(), new Date());
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:05:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:06:00Z'));
    await poll(prefs(), new Date());
    expect(delivered.map(item => item.body)).toEqual(['Victor Wembanyama: Questionable → Out. ESPN injuries.']);
  });
  it('invalidates a stale poll baseline after opt-out and re-enable complete during its write', async () => {
    const enabled = prefs(); const disabled = prefs({ injuryAlerts: false });
    onStateBeforeInsert = async () => {
      savePrefs(disabled); await resetInjuryAlertBaselines(state.db, enabled, disabled);
      savePrefs(enabled); await resetInjuryAlertBaselines(state.db, disabled, enabled);
    };
    await poll(enabled);
    source = feed([injury('5104157', 'Out')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    await poll(enabled, new Date());
    expect(delivered).toEqual([]);
  });
  it('does not regroup an already sent pending change after its cleanup fails', async () => {
    const settings = prefs({ players: [watched(), watched('5037871')] });
    source = feed([injury(), injury('5037871')]); await poll(settings);
    const sent: string[] = [];
    const claimingNotify = async (id: string, value: { body: string }) => {
      const result = state.sql.prepare('INSERT OR IGNORE INTO notifications(id,created_at) VALUES (?,?)').run(id, new Date().toISOString());
      if (!result.changes) return false;
      sent.push(value.body); return true;
    };
    source = feed([injury('5104157', 'Out'), injury('5037871')], '2026-10-10T18:02:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:02:00Z'));
    onPendingDelete = () => { throw new Error('D1 cleanup failed'); };
    await expect(runInjuryAlerts(env, settings, new Date(), claimingNotify)).rejects.toThrow('D1 cleanup failed');
    source = feed([injury('5104157', 'Out'), injury('5037871', 'Out')], '2026-10-10T18:04:00Z');
    vi.setSystemTime(new Date('2026-10-10T18:04:00Z'));
    await runInjuryAlerts(env, settings, new Date(), claimingNotify);
    expect(sent).toEqual([
      'Victor Wembanyama: Questionable → Out. ESPN injuries.',
      'Stephon Castle: Questionable → Out. ESPN injuries.',
    ]);
  });
});
