import type { CareerHistorySection, PlayerCareerHistory, PlayerSeasonLog, SeasonLogSection } from '../src/shared/history-types';
import type { SeasonHonors } from '../src/shared/honors-types';
import { fetchPlayerCareer, fetchPlayerSeasonLog } from './history';
import { fetchSeasonHonors, lastCompletedSeason } from './season-honors';
import { acquireLock, releaseLock } from './store';

type HistoryValue = PlayerCareerHistory | PlayerSeasonLog | SeasonHonors;
type HistorySection = CareerHistorySection | SeasonLogSection;
const DAY = 86_400_000;
const RETRY = 5 * 60_000;
const STALE = 'History refresh failed or was incomplete. Showing saved data with its original update time.';
const unique = (values: string[]) => [...new Set(values)];

export function validHistoryId(value: string | null): value is string {
  return value !== null && /^\d{1,12}$/.test(value);
}
export function validHistorySeason(value: number): boolean {
  return Number.isInteger(value) && value >= 1947 && value <= new Date().getUTCFullYear() + 1;
}

function verified(value: unknown): value is HistoryValue {
  if (!value || typeof value !== 'object') return false;
  const data = value as HistoryValue;
  if (data.source !== 'espn' || typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) return false;
  if ('categories' in data) return Array.isArray(data.categories) && Array.isArray(data.warnings);
  return !!data.regular && !!data.postseason && ['regular', 'postseason'].every(key => {
    const section = data[key as 'regular' | 'postseason'];
    return ['complete', 'partial', 'unavailable', 'no-data'].includes(section.coverage) && Array.isArray(section.warnings)
      && ('games' in section ? Array.isArray(section.games) : Array.isArray(section.seasons));
  });
}

function needsRetry(value: HistoryValue): boolean {
  if ('categories' in value) return value.warnings.length > 0;
  return [value.regular, value.postseason].some(section => ['partial', 'unavailable'].includes(section.coverage) || section.warnings.length > 0);
}

function stale<T extends HistoryValue>(value: T): T {
  const copy = structuredClone(value);
  if ('categories' in copy) copy.warnings = unique([...copy.warnings, STALE]);
  else for (const section of [copy.regular, copy.postseason]) section.warnings = unique([...section.warnings, STALE]);
  return copy;
}

function sectionSize(section: HistorySection): number {
  return 'games' in section ? section.games.length : section.seasons.length;
}

function shouldPreserve(old: HistorySection, fresh: HistorySection): boolean {
  if (old.coverage === 'unavailable') return false;
  if (fresh.coverage === 'unavailable') return true;
  if (fresh.coverage === 'no-data' && sectionSize(old) > 0) return true;
  if (old.coverage === 'complete' && fresh.coverage === 'partial') return true;
  return old.coverage === 'partial' && fresh.coverage === 'partial' && sectionSize(old) > sectionSize(fresh);
}

function preserveBetter<T extends HistoryValue>(old: T | null, fresh: T): T {
  if (!old) return fresh;
  if ('categories' in fresh && 'categories' in old) {
    const present = new Set(fresh.categories.map(category => category.id));
    const missing = old.categories.filter(category => !present.has(category.id));
    if (!missing.length) return fresh;
    const result = structuredClone(fresh) as T & SeasonHonors;
    result.categories.push(...structuredClone(missing));
    result.updatedAt = old.updatedAt;
    const recoveredWarnings = new Set(missing.map(category => `${category.label} leaders unavailable.`));
    result.warnings = unique([...result.warnings.filter(warning => !recoveredWarnings.has(warning)), STALE]);
    return result;
  }
  if (!('regular' in fresh) || !('regular' in old)) return fresh;
  const result = structuredClone(fresh);
  let preserved = false;
  for (const key of ['regular', 'postseason'] as const) {
    if (shouldPreserve(old[key], fresh[key])) {
      // Each wrapper always loads the same payload kind for its cache key.
      Object.assign(result, { [key]: { ...old[key], warnings: unique([...old[key].warnings, STALE]) } });
      preserved = true;
    }
  }
  if (preserved) {
    result.updatedAt = old.updatedAt;
    Object.assign(result, { availableSeasons: unique([...old.availableSeasons, ...fresh.availableSeasons].map(String)).map(Number).sort((a, b) => b - a) });
  }
  return result;
}

async function cached<T extends HistoryValue>(db: D1Database, id: string, ttl: number, load: () => Promise<T>, matches: (value: HistoryValue) => boolean): Promise<T> {
  const read = async () => {
    const row = await db.prepare('SELECT payload, updated_at FROM historical_cache WHERE id=?').bind(id).first<{ payload: string; updated_at: number }>();
    if (!row) return null;
    try {
      const value: unknown = JSON.parse(row.payload);
      return verified(value) && matches(value) ? { value: value as T, updatedAt: row.updated_at } : null;
    } catch { return null; }
  };
  let saved = await read();
  const fresh = (row: NonNullable<typeof saved>) => Date.now() - row.updatedAt < (needsRetry(row.value) ? RETRY : ttl);
  if (saved && fresh(saved)) return saved.value;
  const lockId = `history:${id}`;
  if (!(await acquireLock(db, lockId, 30))) {
    if (saved) return stale(saved.value);
    throw new Error('Historical statistics are updating. Try again shortly.');
  }
  try {
    // Another request may have populated the cache between our read and lock.
    saved = await read();
    if (saved && fresh(saved)) return saved.value;
    let value: T;
    try {
      const loaded = await load();
      if (!verified(loaded) || !matches(loaded)) throw new Error('Only verified ESPN data for the requested player and season may enter historical storage.');
      value = preserveBetter(saved?.value ?? null, loaded);
    } catch (error) {
      if (!saved) throw error;
      value = stale(saved.value);
    }
    // Cache-attempt time controls backoff; the payload retains the actual data timestamp.
    await db.prepare('INSERT INTO historical_cache (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at').bind(id, JSON.stringify(value), Date.now()).run();
    return value;
  } finally { await releaseLock(db, lockId); }
}

export async function loadCareerHistory(db: D1Database, id: string): Promise<PlayerCareerHistory> {
  if (!validHistoryId(id)) throw new Error('Invalid ESPN player ID.');
  return cached(db, `career:${id}`, DAY, () => fetchPlayerCareer(id), value => 'playerId' in value && !('season' in value) && value.playerId === id);
}
export async function loadSeasonLog(db: D1Database, id: string, season: number): Promise<PlayerSeasonLog> {
  if (!validHistoryId(id)) throw new Error('Invalid ESPN player ID.');
  if (!validHistorySeason(season)) throw new Error('Invalid NBA season.');
  return cached(db, `games:${id}:${season}`, season <= lastCompletedSeason() ? 30 * DAY : DAY, () => fetchPlayerSeasonLog(id, season), value => 'playerId' in value && 'season' in value && value.playerId === id && value.season === season);
}
export async function loadSeasonHonors(db: D1Database, season: number): Promise<SeasonHonors> {
  if (!validHistorySeason(season)) throw new Error('Invalid NBA season.');
  return cached(db, `honors:${season}`, season <= lastCompletedSeason() ? 30 * DAY : DAY, () => fetchSeasonHonors(season), value => 'categories' in value && value.season === season);
}
