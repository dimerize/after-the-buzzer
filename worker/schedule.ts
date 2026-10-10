import type { Preferences } from '../src/shared/types';

function localParts(now: Date, timezone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

/** Overnight games belong to the previous slate until 06:00 in the user's timezone. */
export function basketballDate(now: Date, timezone: string): string {
  const parts = localParts(now, timezone);
  // Calendar arithmetic avoids subtracting 24 elapsed hours across a DST transition.
  const day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1,
    Number(parts.day) - (Number(parts.hour) < 6 ? 1 : 0)));
  return day.toISOString().slice(0, 10);
}

export function localTime(now: Date, timezone: string): string {
  const { hour, minute } = localParts(now, timezone);
  return `${hour}:${minute}`;
}

function minutes(time: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

/** The beginning is inclusive; the end is exclusive. Equal values disable quiet hours. */
export function isQuietHour(now: Date, prefs: Preferences): boolean {
  const current = minutes(localTime(now, prefs.timezone));
  const start = minutes(prefs.quietStart);
  const end = minutes(prefs.quietEnd);
  if (start === end || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** Callers must persist a per-day delivery marker to make repeated cron runs idempotent. */
export function isBedtimeDue(now: Date, prefs: Preferences): boolean {
  const elapsed = (minutes(localTime(now, prefs.timezone)) - minutes(prefs.bedtime) + 1440) % 1440;
  return elapsed >= 0 && elapsed < 10;
}
