import { describe, expect, it } from 'vitest';
import { createSession, safeEqual, verifySession } from '../worker/auth';

const now = Date.parse('2026-10-10T12:00:00Z');
const secret = 'test-only-long-random-password-value';
const month = 30 * 24 * 60 * 60 * 1000;

describe('session authentication', () => {
  it('accepts a signed session until its thirty day expiration', async () => {
    const token = await createSession(secret, now);
    expect(await verifySession(token, secret, now)).toBe(true);
    expect(await verifySession(token, secret, now + month - 1000)).toBe(true);
    expect(await verifySession(token, secret, now + month)).toBe(false);
  });

  it('rejects changes to the token and invalidates sessions after password changes', async () => {
    const token = await createSession(secret, now);
    const parts = token.split('.');
    parts[1] = String(Number(parts[1]) + 86400);
    expect(await verifySession(parts.join('.'), secret, now)).toBe(false);
    expect(await verifySession(`${token.slice(0, -3)}xyz`, secret, now)).toBe(false);
    expect(await verifySession(token, 'changed-password', now)).toBe(false);
  });

  it('requires configured credentials and rejects malformed tokens', async () => {
    expect(await verifySession(undefined, secret, now)).toBe(false);
    expect(await verifySession('garbage', secret, now)).toBe(false);
    expect(await verifySession('1.1234567890.a.b', secret, now)).toBe(false);
    expect(await verifySession(await createSession(secret, now), undefined, now)).toBe(false);
    expect(await verifySession(await createSession(secret, now), '', now)).toBe(false);
    await expect(createSession('', now)).rejects.toThrow();
  });

  it('creates independent session tokens even when issued together', async () => {
    expect(await createSession(secret, now)).not.toBe(await createSession(secret, now));
  });
});

describe('safe string comparison', () => {
  it.each([
    ['correct', 'correct', true], ['', '', true],
    ['correct', 'incorrect', false], ['a', 'aa', false], ['aa', 'a', false],
    ['', 'x', false], ['x', '', false], ['🔒', '🔒', true], ['🔒', '🔓', false],
  ])('compares %s and %s', (a, b, equal) => {
    expect(safeEqual(a, b)).toBe(equal);
  });
});
