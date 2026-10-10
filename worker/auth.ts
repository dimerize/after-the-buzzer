const SESSION_SECONDS = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Constant-work comparison for a fixed pair of input lengths; no mismatch short-circuit. */
export function safeEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

/** `now` is epoch milliseconds. Changing the configured password revokes existing sessions. */
export async function createSession(passwordSecret: string, now = Date.now()): Promise<string> {
  if (!passwordSecret || !Number.isFinite(now)) throw new Error('A session requires a configured password and valid time.');
  const expires = Math.floor(now / 1000) + SESSION_SECONDS;
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const message = `1.${expires}.${nonce}`;
  const signature = await crypto.subtle.sign('HMAC', await signingKey(passwordSecret), encoder.encode(message));
  return `${message}.${base64url(new Uint8Array(signature))}`;
}

export async function verifySession(token: string | undefined, secret: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !secret || !Number.isFinite(now) || token.length > 256) return false;
  const match = /^(1)\.(\d{1,13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[2]);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(now / 1000)) return false;
  try {
    const signature = decodeBase64url(match[4]);
    // Reject noncanonical encodings as well as modified MACs.
    if (base64url(signature) !== match[4]) return false;
    const message = token.slice(0, token.lastIndexOf('.'));
    return await crypto.subtle.verify('HMAC', await signingKey(secret), signature, encoder.encode(message));
  } catch {
    return false;
  }
}
