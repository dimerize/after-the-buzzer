import type { Game, Night, PlayerLine, Preferences } from '../src/shared/types';
import { DEFAULT_PREFERENCES } from '../src/shared/defaults';

export const notificationNow = new Date('2026-10-11T03:45:00Z');
export const device = { endpoint: 'https://fcm.googleapis.com/fcm/send/current-device', keys: {
  p256dh: btoa(String.fromCharCode(4, ...Array(64).fill(1))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''),
  auth: btoa(String.fromCharCode(...Array(16).fill(2))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''),
} };
export const anotherDevice = { ...device, endpoint: 'https://fcm.googleapis.com/fcm/send/other-device' };
export const pushEnv = { APP_PASSWORD: 'test-only-notification-password', VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'mailto:owner@example.com' };
export function game(values: Partial<Game> = {}): Game {
  return { id: 'game-1', away: 'DEN', home: 'SAS', awayScore: 100, homeScore: 105, status: 'final', statusText: 'Final', startsAt: '2026-10-11T00:00:00Z', sourceUrl: 'https://www.espn.com/nba/game/_/gameId/1', ...values };
}
export function line(values: Partial<PlayerLine> = {}): PlayerLine {
  return { id: '5104157', name: 'Victor Wembanyama', team: 'SAS', opponent: 'DEN', gameId: 'game-1', rookie: false, status: 'final', starter: true, didNotPlay: false, points: 34, rebounds: 16, assists: 5, steals: 2, blocks: 7, threes: 3, minutes: 35, fgMade: 13, fgAttempted: 21, ftMade: 5, ftAttempted: 6, turnovers: 2, plusMinus: 18, ...values };
}
export function night(values: Partial<Night> = {}): Night {
  return { date: '2026-10-10', updatedAt: notificationNow.toISOString(), edition: 'final', season: '2026-27', seasonType: 'regular', games: [game()], players: [line()], highlights: [], leaders: [], headline: 'Secret result: SAS wins 105-100', summary: 'A result', source: 'espn', partial: false, warnings: [], ...values };
}
export function preferences(values: Partial<Preferences> = {}): Preferences {
  return { ...structuredClone(DEFAULT_PREFERENCES), bedtime: '23:45', timezone: 'America/New_York', quietStart: '00:00', quietEnd: '00:00', ...values };
}

/** Stateful fake of the external D1 boundary; real route/store/scheduler code stays active. */
export function notificationDb(savedNight = night(), prefs = preferences()) {
  const subscriptions = new Map([device, anotherDevice].map(value => [value.endpoint, JSON.stringify(value)]));
  const notifications = new Set<string>();
  const locks = new Map<string, number>();
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { args = values; return this; },
        async first() {
          if (sql.includes('FROM preferences')) return { value: JSON.stringify(prefs) };
          if (sql.includes('FROM editions')) return { payload: JSON.stringify(savedNight) };
          if (sql.includes('FROM notifications')) return notifications.has(String(args[0])) ? { id: args[0] } : null;
          if (sql.includes('FROM push_subscriptions')) return subscriptions.has(String(args[0])) ? { endpoint: args[0], payload: subscriptions.get(String(args[0])) } : null;
          throw new Error(`Unexpected first: ${sql}`);
        },
        async all() {
          if (sql.includes('FROM push_subscriptions')) return { results: [...subscriptions].map(([endpoint, payload]) => ({ endpoint, payload })) };
          throw new Error(`Unexpected all: ${sql}`);
        },
        async run() {
          let changes = 1;
          if (sql.startsWith('INSERT OR IGNORE INTO notifications')) {
            changes = notifications.has(String(args[0])) ? 0 : 1;
            notifications.add(String(args[0]));
          } else if (sql.startsWith('DELETE FROM notifications WHERE id')) notifications.delete(String(args[0]));
          else if (sql.startsWith('INSERT INTO locks')) {
            const key = String(args[0]);
            changes = (locks.get(key) ?? -1) < Number(args[2]) ? 1 : 0;
            if (changes) locks.set(key, Number(args[1]));
          } else if (sql.startsWith('DELETE FROM locks WHERE id')) locks.delete(String(args[0]));
          else if (sql.startsWith('DELETE FROM push_subscriptions')) subscriptions.delete(String(args[0]));
          else if (!sql.startsWith('DELETE FROM')) throw new Error(`Unexpected run: ${sql}`);
          return { success: true, meta: { changes } };
        },
      };
      return statement;
    },
    async batch(statements: { run(): Promise<unknown> }[]) { return Promise.all(statements.map(s => s.run())); },
  } as unknown as D1Database;
  return { db, subscriptions, notifications, locks };
}
