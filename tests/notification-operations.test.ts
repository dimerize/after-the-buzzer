import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotificationOperations, notificationErrorMessage, sendCurrentDeviceTest } from '../src/notification-navigation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const device = { endpoint: 'https://web.push.apple.com/test-device' };
afterEach(() => vi.useRealTimers());

describe('notification result feedback', () => {
  it.each(['', '   '])('turns an empty native failure %j into a useful test result', async message => {
    await expect(sendCurrentDeviceTest('granted', async () => { throw new Error(message); }, async () => {})).rejects.toThrow(/test notification failed/i);
  });

  it.each([new Error(''), new Error(' \n '), new DOMException('', 'AbortError'), undefined])('keeps setup feedback nonempty for %s', error => {
    expect(notificationErrorMessage(error, 'Notifications could not be enabled.')).toBe('Notifications could not be enabled.');
  });

  it('reports progress before subscription lookup settles, then retains provider acceptance', async () => {
    const statuses: string[] = [];
    const notifications = createNotificationOperations(message => statuses.push(message));
    const operation = notifications.begin('Checking this device’s notifications…');
    const lookup = deferred<typeof device>();
    const sent: string[] = [];
    const pending = sendCurrentDeviceTest('granted', () => lookup.promise, async endpoint => { sent.push(endpoint); }, operation);
    expect(statuses.at(-1)).toMatch(/checking/i);
    lookup.resolve(device);
    await pending;
    operation.end();
    expect(sent).toEqual([device.endpoint]);
    expect(statuses.at(-1)).toMatch(/test submitted/i);
  });

  it('preserves a provider rejection as the terminal status', async () => {
    const statuses: string[] = [];
    const operation = createNotificationOperations(message => statuses.push(message)).begin('Checking notifications…');
    await expect(sendCurrentDeviceTest('granted', async () => device, async () => {
      throw new Error('The test notification was not accepted by the push service.');
    }, operation)).rejects.toThrow(/not accepted/);
    operation.end();
    expect(statuses.at(-1)).toMatch(/not accepted/);
    expect(statuses.some(message => /test submitted/i.test(message))).toBe(false);
  });

  it('cancels a session change before sending even if native lookup finishes later', async () => {
    const statuses: string[] = [], sent: string[] = [];
    const notifications = createNotificationOperations(message => statuses.push(message));
    const operation = notifications.begin('Checking notifications…');
    const lookup = deferred<typeof device>();
    const pending = sendCurrentDeviceTest('granted', () => lookup.promise, async endpoint => { sent.push(endpoint); }, operation);
    const rejected = expect(pending).rejects.toThrow(/session changed/i);
    notifications.cancel('Notification request cancelled because your session changed.');
    await rejected;
    expect(statuses.at(-1)).toMatch(/session changed/i);
    lookup.resolve(device);
    await Promise.resolve();
    expect(sent).toEqual([]);
  });

  it('does not let an old operation overwrite a newer notification result', async () => {
    const statuses: string[] = [];
    const notifications = createNotificationOperations(message => statuses.push(message));
    const first = notifications.begin('First test…');
    const lookup = deferred<typeof device>();
    const old = sendCurrentDeviceTest('granted', () => lookup.promise, async () => {}, first);
    const rejected = expect(old).rejects.toThrow(/newer request/i);
    const second = notifications.begin('Second test…');
    await sendCurrentDeviceTest('granted', async () => device, async () => {}, second);
    await rejected;
    lookup.resolve(device);
    first.report('Old result'); first.end();
    expect(second.isCurrent()).toBe(true);
    expect(statuses.at(-1)).toMatch(/test submitted/i);
    second.end();
  });

  it('times out a stalled native lookup without sending after it eventually resolves', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [], sent: string[] = [];
    const operation = createNotificationOperations(message => statuses.push(message), 100).begin('Checking notifications…');
    const lookup = deferred<typeof device>();
    const pending = sendCurrentDeviceTest('granted', () => lookup.promise, async endpoint => { sent.push(endpoint); }, operation);
    const rejected = expect(pending).rejects.toThrow(/timed out.*subscription/i);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(operation.signal.aborted).toBe(true);
    lookup.resolve(device);
    await Promise.resolve();
    expect(sent).toEqual([]);
    expect(statuses.at(-1)).toMatch(/timed out.*subscription/i);
  });

  it('aborts a stalled API request and never reports its late acceptance', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const operation = createNotificationOperations(message => statuses.push(message), 100).begin('Checking notifications…');
    const response = deferred<void>();
    let requestSignal: AbortSignal | undefined;
    const pending = sendCurrentDeviceTest('granted', async () => device, async (_endpoint, signal) => {
      requestSignal = signal;
      await response.promise;
    }, operation);
    const rejected = expect(pending).rejects.toThrow(/timed out.*submitting/i);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
    response.resolve();
    await Promise.resolve();
    expect(statuses.at(-1)).toMatch(/timed out.*submitting/i);
    expect(statuses.some(message => /test submitted/i.test(message))).toBe(false);
  });
});
