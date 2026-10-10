import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { createSession } from '../worker/auth';
import * as push from '../worker/push';
import { anotherDevice, device, notificationDb, notificationNow, pushEnv } from './notification-fixtures';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(notificationNow); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup() {
  const state = notificationDb();
  const env = { ...pushEnv, DB: state.db, ASSETS: {} as Fetcher };
  const cookie = `buzzer_session=${await createSession(pushEnv.APP_PASSWORD)}`;
  const sent = vi.spyOn(push, 'sendPush').mockResolvedValue({ ok: true, expired: false });
  const send = (input: unknown = { endpoint: device.endpoint }, headers = { Cookie: cookie, Origin: 'https://recap.example' }) =>
    worker.fetch(new Request('https://recap.example/api/push/test', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }), env);
  return { ...state, env, sent, send, cookie };
}

describe('private, current-device push test', () => {
  it('requires the private session and exact same-origin mutation', async () => {
    const { send, sent, cookie } = await setup();
    expect((await send({}, { Origin: 'https://recap.example', Cookie: '' })).status).toBe(401);
    expect((await send({}, { Origin: 'https://attacker.example', Cookie: cookie })).status).toBe(403);
    expect(sent).not.toHaveBeenCalled();
  });

  it('sends only stored current-device keys, never broadcasts or uses submitted keys', async () => {
    const { send, sent, env, notifications } = await setup();
    const response = await send({ endpoint: device.endpoint, keys: { p256dh: 'attacker', auth: 'attacker' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sent).toHaveBeenCalledExactlyOnceWith(device, expect.objectContaining({ url: '/?latest=1', body: expect.stringMatching(/test/i) }), env);
    expect(notifications.size).toBe(0); // Testing cannot consume a scheduled alert's dedup claim.
  });

  it.each([{}, null, { endpoint: 42 }, { endpoint: 'https://internal.example/send' }])('rejects invalid request %j', async input => {
    const { send, sent } = await setup();
    expect((await send(input)).status).toBe(400);
    expect(sent).not.toHaveBeenCalled();
  });

  it('rejects an unregistered browser endpoint', async () => {
    const { send, sent } = await setup();
    expect((await send({ endpoint: `${device.endpoint}-unknown` })).status).toBe(404);
    expect(sent).not.toHaveBeenCalled();
  });

  it('holds an atomic owner-wide 60-second cooldown across different registered devices', async () => {
    const { send, sent } = await setup();
    const responses = await Promise.all([send(), send({ endpoint: anotherDevice.endpoint })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 429]);
    const limited = responses.find(response => response.status === 429)!;
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(sent).toHaveBeenCalledOnce();
    vi.setSystemTime(notificationNow.getTime() + 61000);
    expect((await send()).status).toBe(200);
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it('removes only an expired current-device subscription and gives resubscribe guidance', async () => {
    const { send, sent, subscriptions } = await setup();
    sent.mockResolvedValue({ ok: false, expired: true });
    const response = await send();
    expect(response.status).toBe(410);
    expect((await response.json() as { error: string }).error).toMatch(/enable|subscribe/i);
    expect(subscriptions.has(device.endpoint)).toBe(false);
    expect(subscriptions.has(anotherDevice.endpoint)).toBe(true);
  });

  it('reports provider rejection without claiming delivery or removing usable subscriptions', async () => {
    const { send, sent, subscriptions } = await setup();
    sent.mockResolvedValue({ ok: false, expired: false });
    const response = await send();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/not accepted|could not/i) });
    expect(subscriptions.has(device.endpoint)).toBe(true);
    expect((await send()).status).toBe(429);
  });

  it('fails clearly when push is not configured', async () => {
    const { send, env, sent } = await setup();
    env.VAPID_PRIVATE_KEY = '';
    expect((await send()).status).toBe(503);
    expect(sent).not.toHaveBeenCalled();
  });

  it('rejects a corrupt stored subscription rather than sending to a different endpoint', async () => {
    const { send, subscriptions, sent } = await setup();
    subscriptions.set(device.endpoint, JSON.stringify(anotherDevice));
    const response = await send();
    expect(response.status).toBe(410);
    expect(sent).not.toHaveBeenCalled();
  });
});
