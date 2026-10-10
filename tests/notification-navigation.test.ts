import { describe, expect, it } from 'vitest';
import { createNotificationNavigation, sendCurrentDeviceTest } from '../src/notification-navigation';

describe('notification navigation', () => {
  it('opens the notified date and player rather than the current slate or saved sample mode', () => {
    const target = createNotificationNavigation('?date=2026-10-09&player=5104157');
    expect(target.forceLive).toBe(true);
    expect(target.playerId).toBe('5104157');
    expect(target.dashboardPath()).toBe('/api/dashboard?date=2026-10-09');
  });

  it('retains the exact date for a retry after sign-in, until Latest is explicitly selected', () => {
    const target = createNotificationNavigation('?date=2026-10-09&player=1966');
    expect(target.dashboardPath()).toBe('/api/dashboard?date=2026-10-09');
    // Authentication does not consume or replace the target; the resumed request is identical.
    expect(target.dashboardPath()).toBe('/api/dashboard?date=2026-10-09');
    target.openLatest();
    expect(target.dashboardPath()).toBe('/api/dashboard');
  });

  it('keeps a subsequently selected archive date through sign-in or reconnect', () => {
    const target = createNotificationNavigation('?latest=1');
    target.selectDate('2024-02-29');
    expect(target.dashboardPath()).toBe('/api/dashboard?date=2024-02-29');
    expect(target.date).toBe('2024-02-29');
  });

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-09', '2026-10-09T12:00:00Z', '//evil.example', ''])('ignores invalid date %j and opens live latest', (date) => {
    const target = createNotificationNavigation('?date=' + encodeURIComponent(date));
    expect(target.dashboardPath()).toBe('/api/dashboard');
    expect(target.forceLive).toBe(true);
  });

  it.each(['pending:unknown', 'sample-player', '../1966', '1966<script>', '-1', '0', '1.5', '1e3', '1234567890123', ''])('does not select an invalid player %j', (player) => {
    const target = createNotificationNavigation('?player=' + encodeURIComponent(player));
    expect(target.playerId).toBeUndefined();
    expect(target.forceLive).toBe(true);
    expect(target.dashboardPath()).toBe('/api/dashboard');
  });

  it('rejects ambiguous duplicates without dropping independently valid fields', () => {
    const target = createNotificationNavigation('?date=2026-10-09&date=2026-10-10&player=1966');
    expect(target.dashboardPath()).toBe('/api/dashboard');
    expect(target.playerId).toBe('1966');
    expect(createNotificationNavigation('?player=1966&player=5104157').playerId).toBeUndefined();
  });

  it('supports explicit latest/player-only launches and leaves ordinary launches unchanged', () => {
    expect(createNotificationNavigation('?latest=1').forceLive).toBe(true);
    expect(createNotificationNavigation('?player=1966').playerId).toBe('1966');
    expect(createNotificationNavigation('').forceLive).toBe(false);
    expect(createNotificationNavigation('?utm_source=home').forceLive).toBe(false);
  });
});

describe('manual device push test', () => {
  it('sends only the currently subscribed endpoint and never creates a subscription', async () => {
    const sent: string[] = [];
    await sendCurrentDeviceTest('granted', async () => ({ endpoint: 'https://push.example/current-device' }), async endpoint => { sent.push(endpoint); });
    expect(sent).toEqual(['https://push.example/current-device']);
  });

  it('does not request permission or send when permission is absent', async () => {
    let touched = false;
    await expect(sendCurrentDeviceTest('default', async () => { touched = true; return null; }, async () => { touched = true; })).rejects.toThrow('Enable bedtime notifications first.');
    expect(touched).toBe(false);
  });

  it('requires a current subscription and propagates server delivery failures', async () => {
    let sent = false;
    await expect(sendCurrentDeviceTest('granted', async () => null, async () => { sent = true; })).rejects.toThrow('Enable bedtime notifications first.');
    expect(sent).toBe(false);
    await expect(sendCurrentDeviceTest('granted', async () => ({ endpoint: 'https://push.example/current-device' }), async () => { throw new Error('Subscription expired. Enable notifications again.'); })).rejects.toThrow('Subscription expired');
  });

  it('directs blocked permission to settings without requesting or sending anything', async () => {
    let touched = false;
    await expect(sendCurrentDeviceTest('denied', async () => { touched = true; return null; }, async () => { touched = true; })).rejects.toThrow('Allow notifications in browser or app settings');
    expect(touched).toBe(false);
  });
});
