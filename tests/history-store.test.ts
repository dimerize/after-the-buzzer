import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerCareerHistory, PlayerSeasonLog } from '../src/shared/history-types';
import type { SeasonHonors } from '../src/shared/honors-types';
import * as history from '../worker/history';
import * as honors from '../worker/season-honors';
import { loadCareerHistory, loadSeasonLog, loadSeasonHonors } from '../worker/history-store';

const NOW = new Date('2026-10-10T16:00:00Z');
function career(): PlayerCareerHistory {
  const section = (seasonType: 'regular' | 'postseason') => ({ seasonType, coverage: 'complete' as const, seasons: [], career: null, sourceUrl: 'https://espn.com/stats', warnings: [] });
  return { playerId: '1966', source: 'espn', updatedAt: NOW.toISOString(), availableSeasons: [2026], regular: section('regular'), postseason: section('postseason') };
}
function log(season = 2026): PlayerSeasonLog {
  const section = (seasonType: 'regular' | 'postseason') => ({ seasonType, coverage: 'complete' as const, games: [], topPerformances: [], excludedGames: 0, warnings: [] });
  return { playerId: '1966', season, label: '2025-26', source: 'espn', sourceUrl: '', updatedAt: NOW.toISOString(), availableSeasons: [season], regular: section('regular'), postseason: section('postseason') };
}
const leaders = (): SeasonHonors => ({ season: 2026, label: '2025-26', seasonType: 'regular', source: 'espn', sourceUrl: '', updatedAt: NOW.toISOString(), warnings: [], categories: [{ id: 'pointsPerGame', label: 'Scoring', unit: 'PPG', leaders: [] }] });

function database() {
  const rows = new Map<string, { payload: string; updated_at: number }>();
  const locks = new Map<string, number>();
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async first() { return rows.get(String(args[0])) ?? null; },
        async run() {
          const id = String(args[0]); let changes = 1;
          if (sql.startsWith('INSERT INTO historical_cache')) rows.set(id, { payload: String(args[1]), updated_at: Number(args[2]) });
          else if (sql.startsWith('INSERT INTO locks')) {
            if ((locks.get(id) ?? 0) >= Number(args[2])) changes = 0;
            else locks.set(id, Number(args[1]));
          } else if (sql.startsWith('DELETE FROM locks')) locks.delete(id);
          return { success: true, meta: { changes } };
        }
      };
    }
  } as unknown as D1Database;
  return { db, rows, locks };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('durable historical cache', () => {
  it('reuses career statistics for 24 hours and refreshes after expiration', async () => {
    const { db } = database(); const fetch = vi.spyOn(history, 'fetchPlayerCareer').mockResolvedValue(career());
    await loadCareerHistory(db, '1966');
    vi.setSystemTime(NOW.getTime() + 23 * 3600000); await loadCareerHistory(db, '1966');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW.getTime() + 25 * 3600000); await loadCareerHistory(db, '1966');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('caches completed-season logs and honors for 30 days, but current-season logs only 24 hours', async () => {
    const { db } = database();
    const games = vi.spyOn(history, 'fetchPlayerSeasonLog').mockImplementation(async (_id, season) => log(season));
    const fetchHonors = vi.spyOn(honors, 'fetchSeasonHonors').mockResolvedValue(leaders());
    await loadSeasonLog(db, '1966', 2026); await loadSeasonLog(db, '1966', 2027); await loadSeasonHonors(db, 2026);
    vi.setSystemTime(NOW.getTime() + 2 * 86400000);
    await loadSeasonLog(db, '1966', 2026); await loadSeasonLog(db, '1966', 2027); await loadSeasonHonors(db, 2026);
    expect(games).toHaveBeenCalledTimes(3); expect(fetchHonors).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW.getTime() + 31 * 86400000);
    await loadSeasonLog(db, '1966', 2026); await loadSeasonHonors(db, 2026);
    expect(games).toHaveBeenCalledTimes(4); expect(fetchHonors).toHaveBeenCalledTimes(2);
  });

  it('retries partial histories after five minutes instead of treating them as complete for a month', async () => {
    const { db } = database(); const value = log(); value.regular.coverage = 'partial'; value.regular.warnings = ['Missing game.'];
    const fetch = vi.spyOn(history, 'fetchPlayerSeasonLog').mockResolvedValue(value);
    await loadSeasonLog(db, '1966', 2026);
    vi.setSystemTime(NOW.getTime() + 4 * 60000); await loadSeasonLog(db, '1966', 2026);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW.getTime() + 6 * 60000); await loadSeasonLog(db, '1966', 2026);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps cached good data and its original timestamp when a refresh throws, with a short retry interval', async () => {
    const { db } = database(); const fetch = vi.spyOn(history, 'fetchPlayerCareer').mockResolvedValueOnce(career()).mockRejectedValue(new Error('outage'));
    await loadCareerHistory(db, '1966');
    vi.setSystemTime(NOW.getTime() + 2 * 86400000);
    const result = await loadCareerHistory(db, '1966');
    expect(result.updatedAt).toBe(NOW.toISOString());
    expect(result.regular.coverage).toBe('complete');
    expect(result.regular.warnings.join(' ')).toMatch(/saved/i);
    await loadCareerHistory(db, '1966'); expect(fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(NOW.getTime() + 2 * 86400000 + 6 * 60000);
    await loadCareerHistory(db, '1966'); expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('preserves the successful cached section when an adapter returns an unavailable replacement', async () => {
    const { db } = database(); const fresh = career(); fresh.regular.coverage = 'unavailable'; fresh.regular.warnings = ['503']; fresh.updatedAt = '2026-10-12T16:00:00Z';
    vi.spyOn(history, 'fetchPlayerCareer').mockResolvedValueOnce(career()).mockResolvedValueOnce(fresh);
    await loadCareerHistory(db, '1966'); vi.setSystemTime(NOW.getTime() + 2 * 86400000);
    const result = await loadCareerHistory(db, '1966');
    expect(result.regular.coverage).toBe('complete');
    expect(result.regular.warnings.join(' ')).toMatch(/saved/i);
    expect(result.updatedAt).toBe(NOW.toISOString());
  });

  it('uses a per-key lock, fails boundedly without a snapshot, and releases on loader failure', async () => {
    const { db, locks } = database();
    let reject!: (error: Error) => void;
    const fetch = vi.spyOn(history, 'fetchPlayerCareer').mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const first = loadCareerHistory(db, '1966');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await expect(loadCareerHistory(db, '1966')).rejects.toThrow(/updating/i);
    expect(fetch).toHaveBeenCalledTimes(1);
    reject(new Error('outage')); await expect(first).rejects.toThrow('outage');
    expect(locks.size).toBe(0);
  });

  it('does not cache non-ESPN data or allow unsafe cache identifiers', async () => {
    const { db, rows } = database();
    const bad = { ...career(), source: 'demo' } as unknown as PlayerCareerHistory;
    vi.spyOn(history, 'fetchPlayerCareer').mockResolvedValue(bad);
    await expect(loadCareerHistory(db, '1966')).rejects.toThrow(/verified/i);
    expect(rows.size).toBe(0);
    await expect(loadCareerHistory(db, '../')).rejects.toThrow(/Invalid/i);
    await expect(loadSeasonLog(db, '1966', 2026.5)).rejects.toThrow(/Invalid/i);
  });

  it('ignores corrupted or mismatched cached payloads and refuses a mismatched new payload', async () => {
    const { db, rows } = database();
    rows.set('career:1966', { payload: JSON.stringify({ ...career(), playerId: '5104157' }), updated_at: NOW.getTime() });
    const fetch = vi.spyOn(history, 'fetchPlayerCareer').mockResolvedValue(career());
    expect((await loadCareerHistory(db, '1966')).playerId).toBe('1966');
    expect(fetch).toHaveBeenCalledTimes(1);
    rows.set('career:1966', { payload: '{broken', updated_at: NOW.getTime() });
    await loadCareerHistory(db, '1966'); expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockResolvedValue({ ...career(), playerId: 'different' });
    await expect(loadCareerHistory(db, '5104157')).rejects.toThrow(/verified/i);
  });

  it('retains cached season leaders on a provider outage without advancing the source timestamp', async () => {
    const { db } = database();
    vi.spyOn(honors, 'fetchSeasonHonors').mockResolvedValueOnce(leaders()).mockRejectedValueOnce(new Error('offline'));
    await loadSeasonHonors(db, 2026); vi.setSystemTime(NOW.getTime() + 31 * 86400000);
    const result = await loadSeasonHonors(db, 2026);
    expect(result.categories).toEqual(leaders().categories);
    expect(result.updatedAt).toBe(NOW.toISOString());
    expect(result.warnings.join(' ')).toMatch(/saved/i);
  });

  it('merges equal-sized partial honors refreshes by category ID without losing cached leaders', async () => {
    const { db } = database();
    const prior = leaders(); prior.warnings = ['Rebounds leaders unavailable.'];
    const fresh = leaders();
    fresh.categories = [{ id: 'reboundsPerGame', label: 'Rebounds', unit: 'RPG', leaders: [] }];
    fresh.warnings = ['Scoring leaders unavailable.']; fresh.updatedAt = '2026-10-10T16:06:00Z';
    vi.spyOn(honors, 'fetchSeasonHonors').mockResolvedValueOnce(prior).mockResolvedValueOnce(fresh);
    await loadSeasonHonors(db, 2026); vi.setSystemTime(NOW.getTime() + 6 * 60000);
    const result = await loadSeasonHonors(db, 2026);
    expect(result.categories.map(category => category.id).sort()).toEqual(['pointsPerGame', 'reboundsPerGame']);
    expect(result.updatedAt).toBe(prior.updatedAt);
    expect(result.warnings.join(' ')).toMatch(/saved/i);
  });
});
