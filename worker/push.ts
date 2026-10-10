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
  try {
    const request = await buildPushPayload({ data: payload, options: { ttl: 900, urgency: 'normal' } },
      { ...subscription, expirationTime: null }, {
        publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT,
      });
    const response = await fetch(subscription.endpoint, {
      ...request, redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    return { ok: response.ok, expired: response.status === 404 || response.status === 410 };
  } catch {
    // Transport, configuration, and key errors are not proof that a browser unsubscribed.
    return failed;
  }
}
