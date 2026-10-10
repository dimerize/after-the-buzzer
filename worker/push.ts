import { buildPushPayload } from '@block65/webcrypto-web-push';

interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface PushEnvironment {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

const safeErrorNames = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'InvalidCharacterError', 'DataError',
  'OperationError', 'NotSupportedError', 'InvalidAccessError', 'AbortError', 'TimeoutError',
]);

// https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
const appleReasons = new Set([
  'BadTtl', 'BadUrgency', 'BadWebPushRequest', 'BadWebPushTopic', 'VapidPkHashMismatch',
  'IdleTimeout', 'BadAuthorizationHeader', 'BadJwtToken', 'BadVapidPublicKey', 'BadPath',
  'MethodNotAllowed', 'PayloadTooLarge', 'TooManyRequests', 'InternalServerError',
  'ServiceUnavailable', 'Shutdown',
]);

async function appleFailureReason(response: Response): Promise<string> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = response.body?.getReader();
    if (!reader) return 'Unknown';
    const body = new Uint8Array(1024);
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > body.byteLength - length) return 'Unknown';
      body.set(value, length);
      length += value.byteLength;
    }
    const reason: unknown = JSON.parse(new TextDecoder().decode(body.subarray(0, length)))?.reason;
    return typeof reason === 'string' && appleReasons.has(reason) ? reason : 'Unknown';
  } catch {
    return 'Unknown';
  } finally {
    // Do not retain oversized response bodies or wait for remote cancellation.
    void reader?.cancel().catch(() => {});
  }
}

/** Only browser-owned push infrastructure may be used as an outbound destination. */
export function validPushEndpoint(value: string): boolean {
  if (value.length > 2048 || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    const host = url.hostname;
    return host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
      || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com')
      || host.endsWith('.wns.windows.com');
  } catch {
    return false;
  }
}

export async function sendPush(
  subscription: Subscription,
  payload: { title: string; body: string; url: string; tag: string },
  env: PushEnvironment,
): Promise<{ ok: boolean; expired: boolean }> {
  const failed = { ok: false, expired: false };
  if (!validPushEndpoint(subscription.endpoint) || !env.VAPID_PUBLIC_KEY
    || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return failed;
  const host = new URL(subscription.endpoint).hostname;
  const provider = host.endsWith('.push.apple.com') ? 'Apple'
    : host === 'fcm.googleapis.com' ? 'Google'
    : host === 'updates.push.services.mozilla.com' ? 'Mozilla' : 'Windows';
  let phase: 'payload-build' | 'fetch-transport' = 'payload-build';
  try {
    const request = await buildPushPayload({ data: payload, options: { ttl: 900, urgency: 'normal' } },
      { ...subscription, expirationTime: null }, {
        publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT,
      });
    phase = 'fetch-transport';
    const response = await fetch(subscription.endpoint, {
      // Workers supports manual redirects; reject 3xx below without following their Location.
      ...request, redirect: 'manual', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error('push_delivery_failed', {
        phase: 'http-rejection', provider, status: response.status,
        ...(provider === 'Apple' ? { reason: await appleFailureReason(response) } : {}),
      });
    }
    return { ok: response.ok, expired: response.status === 404 || response.status === 410 };
  } catch (error) {
    const errorName = (error instanceof Error || error instanceof DOMException) && safeErrorNames.has(error.name)
      ? error.name : 'UnknownError';
    console.error('push_delivery_failed', { phase, provider, errorName });
    // Transport, configuration, and key errors are not proof that a browser unsubscribed.
    return failed;
  }
}
