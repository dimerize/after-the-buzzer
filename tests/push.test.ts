import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sendPush, validPushEndpoint } from '../worker/push';

const b64url = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const payload = { title: 'Your NBA night', body: 'The bedtime recap is ready.', url: '/', tag: 'night-2026-10-10' };
let subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
let env: { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string };
let receiver: CryptoKeyPair;
let receiverPublic: ArrayBuffer;
let authSecret: Uint8Array<ArrayBuffer>;

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

afterEach(() => vi.unstubAllGlobals());

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
    expect(target).toBe(subscription.endpoint);
    expect(sent?.redirect).toBe('error');
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

  it.each([400, 401, 429, 500])('keeps subscriptions after HTTP %i delivery failures', async (status) => {
    vi.stubGlobal('fetch', async () => new Response(null, { status }));
    expect(await sendPush(subscription, payload, env)).toEqual({ ok: false, expired: false });
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
  });
});
