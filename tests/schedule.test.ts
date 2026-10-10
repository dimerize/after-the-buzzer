import { describe, expect, it } from 'vitest';
import type { Preferences } from '../src/shared/types';
import { basketballDate, isBedtimeDue, isQuietHour, localTime } from '../worker/schedule';

const preferences: Preferences = {
  players: [], bedtime: '23:30', timezone: 'America/New_York', length: 'normal',
  hideScores: false, liveAlerts: true, quietStart: '23:45', quietEnd: '07:00',
};

describe('basketball calendar', () => {
  it.each([
    ['2026-10-11T03:59:00Z', '2026-10-10'],
    ['2026-10-11T04:00:00Z', '2026-10-10'],
    ['2026-10-11T09:59:00Z', '2026-10-10'],
    ['2026-10-11T10:00:00Z', '2026-10-11'],
    ['2027-01-01T06:00:00Z', '2026-12-31'],
    ['2026-03-08T09:59:00Z', '2026-03-07'],
    ['2026-03-08T10:00:00Z', '2026-03-08'],
    ['2026-11-01T10:59:00Z', '2026-10-31'],
    ['2026-11-01T11:00:00Z', '2026-11-01'],
  ])('assigns %s to the correct basketball date', (instant, date) => {
    expect(basketballDate(new Date(instant), preferences.timezone)).toBe(date);
  });

  it('uses the selected timezone instead of the server timezone', () => {
    expect(localTime(new Date('2026-10-11T04:00:00Z'), 'America/New_York')).toBe('00:00');
    expect(localTime(new Date('2026-10-11T04:00:00Z'), 'America/Los_Angeles')).toBe('21:00');
    expect(localTime(new Date('2026-10-11T04:00:00Z'), 'Asia/Kolkata')).toBe('09:30');
  });

  it('handles the repeated local hour at the end of daylight saving time', () => {
    expect(localTime(new Date('2026-11-01T05:30:00Z'), preferences.timezone)).toBe('01:30');
    expect(localTime(new Date('2026-11-01T06:30:00Z'), preferences.timezone)).toBe('01:30');
  });
});

describe('notification schedule', () => {
  it.each([
    ['2026-10-11T03:44:00Z', false],
    ['2026-10-11T03:45:00Z', true],
    ['2026-10-11T04:00:00Z', true],
    ['2026-10-11T10:59:00Z', true],
    ['2026-10-11T11:00:00Z', false],
  ])('handles quiet hours wrapping midnight at %s', (instant, quiet) => {
    expect(isQuietHour(new Date(instant), preferences)).toBe(quiet);
  });

  it('supports daytime quiet hours and treats equal endpoints as disabled', () => {
    const daytime = { ...preferences, quietStart: '12:00', quietEnd: '13:00' };
    expect(isQuietHour(new Date('2026-10-10T16:30:00Z'), daytime)).toBe(true);
    expect(isQuietHour(new Date('2026-10-10T17:00:00Z'), daytime)).toBe(false);
    expect(isQuietHour(new Date('2026-10-10T16:30:00Z'), { ...daytime, quietEnd: '12:00' })).toBe(false);
  });

  it.each([
    ['2026-10-11T03:29:59Z', false],
    ['2026-10-11T03:30:00Z', true],
    ['2026-10-11T03:39:59Z', true],
    ['2026-10-11T03:40:00Z', false],
  ])('uses a bounded ten minute bedtime window at %s', (instant, due) => {
    expect(isBedtimeDue(new Date(instant), preferences)).toBe(due);
  });

  it('allows the next cron tick across midnight for a late bedtime', () => {
    const late = { ...preferences, bedtime: '23:56' };
    expect(isBedtimeDue(new Date('2026-10-11T03:59:00Z'), late)).toBe(true);
    expect(isBedtimeDue(new Date('2026-10-11T04:00:00Z'), late)).toBe(true);
    expect(isBedtimeDue(new Date('2026-10-11T04:05:00Z'), late)).toBe(true);
    expect(isBedtimeDue(new Date('2026-10-11T04:06:00Z'), late)).toBe(false);
  });
});
