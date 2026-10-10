import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPush, validPushEndpoint } from '../worker/push';

const b64url = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const payload = { title: 'Your NBA night', body: 'The bedtime recap is ready.', url: '/', tag: 'night-2026-10-10' };
let subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
let env: { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string };
let receiver: CryptoKeyPair;
let receiverPublic: ArrayBuffer;
let authSecret: Uint8Array<ArrayBuffer>;
let diagnostics: unknown[][];

beforeAll(async () => {
  receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  receiverPublic = await crypto.subtle.exportKey('raw', receiver.publicKey);
  authSecret = crypto.getRandomValues(new Uint8Array(16));
  subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-device',
    keys: { p256dh: b64url(receiverPublic), auth: b64url(authSecret.buffer) },
  };
  const sender = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  env = {
    VAPID_PUBLIC_KEY: b64url(await crypto.subtle.exportKey('raw', sender.publicKey)),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', sender.privateKey)).d!,
    VAPID_SUBJECT: 'mailto:notifications@example.com',
  };
});

beforeEach(() => {
  diagnostics = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => { diagnostics.push(args); });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('push endpoint policy', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/token',
    'https://updates.push.services.mozilla.com/wpush/v2/token',
    'https://web.push.apple.com/QH/token',
    'https://wns2-par02p.notify.windows.com/w/?token=example',
    'https://sinwns1011421.wns.windows.com/?token=example',
  ])('accepts the browser push service %s', (endpoint) => {
    expect(validPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/token',
    'https://fcm.googleapis.com.evil.example/token',
    'https://evilpush.apple.com/token',
    'https://example.com/push',
    'https://127.0.0.1/private',
    'https://[::1]/private',
    'https://169.254.169.254/latest/meta-data',
    'https://fcm.googleapis.com:8443/token',
    'https://username:password@fcm.googleapis.com/token',
    'https://fcm.googleapis.com/token#fragment',
    'not-a-url',
  ])('rejects an untrusted or malformed destination %s', (endpoint) => {
    expect(validPushEndpoint(endpoint)).toBe(false);
  });
});

describe('push delivery', () => {
  it('encrypts the exact notification for the subscribed device and prevents redirects', async () => {
    let sent: RequestInit | undefined;
    let target: string | undefined;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      target = url;
      sent = init;
      return new Response(null, { status: 201 });
    });
    expect(await sendPush(subscription, payload, env)).toEqual({ ok: true, expired: false });
    expect(diagnostics).toEqual([]);
    expect(target).toBe(subscription.endpoint);
    expect(sent?.redirect).toBe('manual');
    const headers = new Headers(sent?.headers);
    expect(headers.get('content-encoding')).toBe('aes128gcm');
    expect(headers.get('authorization')).toMatch(/^vapid t=.+, k=/);

    // Independently decrypt as a browser would (RFC 8291), using the receiver's private key.
    const body = new Uint8Array(sent!.body as Uint8Array<ArrayBuffer>);
    const serverPublic = body.slice(21, 21 + body[20]);
    const serverKey = await crypto.subtle.importKey('raw', serverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, receiver.privateKey, 256);
    const text = new TextEncoder();
    async function hkdf(input: ArrayBuffer, salt: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
      const key = await crypto.subtle.importKey('raw', input, 'HKDF', false, ['deriveBits']);
      return crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length);
    }
    const info = new Uint8Array([...text.encode('WebPush: info\0'), ...new Uint8Array(receiverPublic), ...serverPublic]);
    const intermediate = await hkdf(shared, authSecret, info, 256);
    const salt = body.slice(0, 16);
    const key = await crypto.subtle.importKey('raw', await hkdf(intermediate, salt, text.encode('Content-Encoding: aes128gcm\0'), 128), 'AES-GCM', false, ['decrypt']);
    const iv = await hkdf(intermediate, salt, text.encode('Content-Encoding: nonce\0'), 96);
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body.slice(21 + body[20])));
    let end = plaintext.length - 1;
    while (plaintext[end] === 0) end--;
    expect(plaintext[end]).toBe(2);
    expect(JSON.parse(new TextDecoder().decode(plaintext.slice(0, end)))).toEqual(payload);
  });

  it.each([404, 410])('marks HTTP %i subscriptions expired', async (status) => {
    vi.stubGlobal('fetch', async () => new Response(null, { status }));
    expect(await sendPush(subscription, payload, env)).toEqual({ ok: false, expired: true });
  });

  it.each([302, 400, 401, 429, 500])('keeps subscriptions after HTTP %i delivery failures', async (status) => {
    vi.stubGlobal('fetch', async () => new Response(null, { status }));
    expect(await sendPush(subscription, payload, env)).toEqual({ ok: false, expired: false });
  });

  it('does not follow a redirect or expire its subscription', async () => {
    const requests: { url: string; redirect: RequestRedirect | undefined }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, redirect: init.redirect });
      return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/private' } });
    });

    expect(await sendPush(subscription, payload, env)).toEqual({ ok: false, expired: false });
    expect(requests).toEqual([{ url: subscription.endpoint, redirect: 'manual' }]);
    expect(diagnostics).toEqual([['push_delivery_failed', {
      phase: 'http-rejection', provider: 'Google', status: 302,
    }]]);
  });

  it('rejects untrusted destinations and incomplete configuration before any network call', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', async () => { attempts++; return new Response(null, { status: 201 }); });
    expect(await sendPush({ ...subscription, endpoint: 'https://127.0.0.1/private' }, payload, env)).toEqual({ ok: false, expired: false });
    expect(await sendPush(subscription, payload, {})).toEqual({ ok: false, expired: false });
    expect(attempts).toBe(0);
  });

  it('reports a network failure without deleting the subscription', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Connection failed'); });
    expect(await sendPush(subscription, payload, env)).toEqual({ ok: false, expired: false });
    expect(diagnostics).toEqual([['push_delivery_failed', {
      phase: 'fetch-transport', provider: 'Google', errorName: 'TypeError',
    }]]);
  });
});

describe('private push failure diagnostics', () => {
  it('identifies a real payload-build failure before attempting delivery', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', async () => { attempts++; return new Response(null, { status: 201 }); });
    const invalidSubscription = { ...subscription, keys: { ...subscription.keys, p256dh: 'AQ' } };

    expect(await sendPush(invalidSubscription, payload, env)).toEqual({ ok: false, expired: false });
    expect(attempts).toBe(0);
    expect(diagnostics).toEqual([['push_delivery_failed', {
      phase: 'payload-build', provider: 'Google', errorName: 'Error',
    }]]);
  });

  it.each([
    ['https://web.push.apple.com/QH/private-device', 'Apple'],
    ['https://fcm.googleapis.com/fcm/send/private-device', 'Google'],
    ['https://updates.push.services.mozilla.com/wpush/v2/private-device', 'Mozilla'],
    ['https://wns2-par02p.notify.windows.com/w/?token=private-device', 'Windows'],
    ['https://sinwns1011421.wns.windows.com/?token=private-device', 'Windows'],
  ])('reports only the provider and HTTP status for %s', async (endpoint, provider) => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 403 }));

    expect(await sendPush({ ...subscription, endpoint }, payload, env)).toEqual({ ok: false, expired: false });
    expect(diagnostics).toEqual([['push_delivery_failed', {
      phase: 'http-rejection', provider, status: 403, ...(provider === 'Apple' ? { reason: 'Unknown' } : {}),
    }]]);
  });

  it.each(['AbortError', 'TimeoutError'])('retains the safe transport error name %s', async (name) => {
    vi.stubGlobal('fetch', async () => { throw new DOMException(`private endpoint: ${subscription.endpoint}`, name); });

    expect(await sendPush(subscription, payload, env)).toEqual({ ok: false, expired: false });
    expect(diagnostics).toEqual([['push_delivery_failed', {
      phase: 'fetch-transport', provider: 'Google', errorName: name,
    }]]);
  });

  it.each([
    Object.assign(new Error('private key and endpoint'), { name: 'private-device-token' }),
    'private-device-token',
    { name: 'private-device-token', message: 'private key and endpoint' },
  ])('redacts unrecognized thrown values and error names', async (error) => {
    vi.stubGlobal('fetch', async () => { throw error; });

    expect(await sendPush(subscription, payload, env)).toEqual({ ok: false, expired: false });
    expect(diagnostics).toEqual([['push_delivery_failed', {
      phase: 'fetch-transport', provider: 'Google', errorName: 'UnknownError',
    }]]);
  });

  it.each(['BadJwtToken', 'VapidPkHashMismatch'])('records the allowlisted Apple reason %s without other response data', async (reason) => {
    vi.stubGlobal('fetch', async () => Response.json({ reason, endpoint: subscription.endpoint, key: env.VAPID_PRIVATE_KEY }, { status: 403 }));

    expect(await sendPush({ ...subscription, endpoint: 'https://web.push.apple.com/QH/private-device' }, payload, env))
      .toEqual({ ok: false, expired: false });
    expect(diagnostics).toEqual([['push_delivery_failed', {
      phase: 'http-rejection', provider: 'Apple', status: 403, reason,
    }]]);
  });

  it.each([
    null,
    'not JSON with private-device-token',
    '{}',
    'null',
    '{"reason":"BadJwtToken private-device-token"}',
    '{"reason":{"message":"private-device-token"}}',
    '{"reason":"toString"}',
  ])('preserves expiry and redacts missing or unsafe Apple reasons in %s', async (body) => {
    vi.stubGlobal('fetch', async () => new Response(body, { status: 410 }));

    expect(await sendPush({ ...subscription, endpoint: 'https://web.push.apple.com/QH/private-device' }, payload, env))
      .toEqual({ ok: false, expired: true });
    expect(diagnostics).toEqual([['push_delivery_failed', {
      phase: 'http-rejection', provider: 'Apple', status: 410, reason: 'Unknown',
    }]]);
  });

  it('bounds Apple response parsing to 1 KiB of bytes and cancels an oversized stream', async () => {
    let reads = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++;
        controller.enqueue(new TextEncoder().encode(reads === 1 ? ' '.repeat(1024) : '{"reason":"BadJwtToken"}'));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    vi.stubGlobal('fetch', async () => new Response(body, { status: 403 }));

    expect(await sendPush({ ...subscription, endpoint: 'https://web.push.apple.com/QH/private-device' }, payload, env))
      .toEqual({ ok: false, expired: false });
    expect(reads).toBeLessThanOrEqual(2);
    expect(cancelled).toBe(true);
    expect(diagnostics).toEqual([['push_delivery_failed', {
      phase: 'http-rejection', provider: 'Apple', status: 403, reason: 'Unknown',
    }]]);
  });

  it('counts UTF-8 bytes when limiting an Apple response', async () => {
    const body = JSON.stringify({ reason: 'BadJwtToken', detail: 'é'.repeat(600) });
    vi.stubGlobal('fetch', async () => new Response(body, { status: 403 }));

    expect(await sendPush({ ...subscription, endpoint: 'https://web.push.apple.com/QH/private-device' }, payload, env))
      .toEqual({ ok: false, expired: false });
    expect(diagnostics).toEqual([['push_delivery_failed', {
      phase: 'http-rejection', provider: 'Apple', status: 403, reason: 'Unknown',
    }]]);
  });

  it('preserves an HTTP rejection when reading the Apple body fails', async () => {
    const body = new ReadableStream({ start(controller) { controller.error(new Error('private-device-token')); } });
    vi.stubGlobal('fetch', async () => new Response(body, { status: 410 }));

    expect(await sendPush({ ...subscription, endpoint: 'https://web.push.apple.com/QH/private-device' }, payload, env))
      .toEqual({ ok: false, expired: true });
    expect(diagnostics).toEqual([['push_delivery_failed', {
      phase: 'http-rejection', provider: 'Apple', status: 410, reason: 'Unknown',
    }]]);
  });
});
