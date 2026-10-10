function validDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

/** Retained across authentication; only a new date selection or Latest replaces it. */
export function createNotificationNavigation(search: string) {
  const params = new URLSearchParams(search);
  const single = (key: string) => params.getAll(key).length === 1 ? params.get(key) : null;
  let date = validDate(single('date'));
  const player = single('player');
  const game = single('game');
  const view = single('view');
  let gameTarget = date && game && /^[1-9]\d{0,11}$/.test(game) && (view === 'injuries' || view === 'boxscore')
    ? { date, gameId: game, view } as { date: string; gameId: string; view: 'injuries' | 'boxscore' } : undefined;
  return {
    forceLive: ['date', 'player', 'latest', 'game', 'view'].some(key => params.has(key)),
    playerId: player && /^[1-9]\d{0,11}$/.test(player) ? player : undefined,
    get date() { return date; },
    get gameTarget() { return gameTarget; },
    clearGameTarget: () => { gameTarget = undefined; },
    dashboardPath: () => `/api/dashboard${date ? `?date=${date}` : ''}`,
    selectDate: (value: string) => { date = validDate(value); gameTarget = undefined; },
    openLatest: () => { date = undefined; gameTarget = undefined; },
  };
}

export function notificationErrorMessage(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message.trim() : '') || fallback;
}

export interface NotificationOperation {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  report(message: string): void;
  step<T>(stage: string, work: (signal: AbortSignal) => Promise<T>, timeoutMs?: number): Promise<T>;
  end(): void;
}

/** Notification attempts have their own lifetime, independent of preference saves. */
export function createNotificationOperations(onStatus: (message: string) => void, timeoutMs = 15_000) {
  let current: { operation: NotificationOperation; controller: AbortController } | undefined;
  return {
    begin(message: string): NotificationOperation {
      current?.controller.abort(new Error('Notification request replaced by a newer request.'));
      const controller = new AbortController();
      const { signal } = controller;
      const operation: NotificationOperation = {
        signal,
        isCurrent: () => current?.operation === operation,
        report(value) {
          if (operation.isCurrent()) onStatus(signal.aborted
            ? notificationErrorMessage(signal.reason, 'Notification request cancelled.') : value);
        },
        step(stage, work, deadline = timeoutMs) {
          if (signal.aborted) return Promise.reject(signal.reason);
          operation.report(`${stage}…`);
          return new Promise((resolve, reject) => {
            const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); };
            const aborted = () => { cleanup(); reject(signal.reason); };
            const timer = setTimeout(() => controller.abort(new Error(`Timed out while ${stage.toLowerCase()}.`)), deadline);
            signal.addEventListener('abort', aborted, { once: true });
            try {
              Promise.resolve(work(signal)).then(value => {
                cleanup();
                if (signal.aborted) reject(signal.reason); else resolve(value);
              }, error => { cleanup(); reject(error); });
            } catch (error) { cleanup(); reject(error); }
          });
        },
        end() { if (operation.isCurrent()) current = undefined; },
      };
      current = { operation, controller };
      operation.report(message);
      return operation;
    },
    cancel(message: string) {
      if (!current) return;
      current.controller.abort(new Error(message));
      current.operation.report(message);
    },
  };
}

/** Reads an existing subscription only: this action never asks permission or subscribes. */
export async function sendCurrentDeviceTest(
  permission: NotificationPermission,
  getSubscription: (signal: AbortSignal) => Promise<{ endpoint: string } | null>,
  send: (endpoint: string, signal: AbortSignal) => Promise<void>,
  operation?: NotificationOperation,
) {
  const attempt = operation ?? createNotificationOperations(() => {}).begin('Checking this device’s notifications…');
  try {
    if (permission === 'denied') throw new Error('Allow notifications in browser or app settings, then enable bedtime notifications.');
    if (permission !== 'granted') throw new Error('Enable bedtime notifications first.');
    const subscription = await attempt.step('Checking this device’s notification subscription', getSubscription);
    if (!subscription?.endpoint) throw new Error('Enable bedtime notifications first.');
    await attempt.step('Submitting test notification', signal => send(subscription.endpoint, signal));
    attempt.report('Test submitted. Check this device’s notifications.');
  } catch (error) {
    const message = notificationErrorMessage(error, 'Test notification failed. Please try again.');
    attempt.report(message);
    throw new Error(message);
  } finally { if (!operation) attempt.end(); }
}
