import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/shared/defaults';
import type { Preferences } from '../src/shared/types';
import { createPreferenceSaveQueue } from '../src/preference-save-queue';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('preference save queue', () => {
  it('saves full snapshots one at a time while displaying the newest optimistic edit', async () => {
    const first = deferred(), second = deferred();
    const started: Preferences[] = [];
    const initial: Preferences = { ...structuredClone(DEFAULT_PREFERENCES), length: 'normal' };
    let displayed = structuredClone(initial);
    let stored = structuredClone(initial);
    const queue = createPreferenceSaveQueue({
      initial,
      save: async (next) => { started.push(next); await (started.length === 1 ? first.promise : second.promise); stored = next; },
      onChange: (next) => { displayed = next; }, onError: () => { throw new Error('Unexpected save failure'); }
    });
    const one = queue.update((current) => ({ ...current, hideScores: true }));
    const two = queue.update((current) => ({ ...current, length: 'nerd' }));
    expect(displayed).toMatchObject({ hideScores: true, length: 'nerd' });
    await Promise.resolve();
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ hideScores: true, length: 'normal' });
    first.resolve();
    expect(await one).toBe(true);
    await Promise.resolve();
    expect(started).toHaveLength(2);
    expect(started[1]).toMatchObject({ hideScores: true, length: 'nerd' });
    expect(displayed).toMatchObject({ hideScores: true, length: 'nerd' });
    second.resolve();
    expect(await two).toBe(true);
    expect(stored).toEqual(displayed);
  });

  it('does not roll back a newer optimistic edit when an older save fails', async () => {
    const first = deferred(), second = deferred();
    const changes: Preferences[] = [];
    const errors: unknown[] = [];
    let started = 0;
    const queue = createPreferenceSaveQueue({ initial: DEFAULT_PREFERENCES,
      save: async () => { await (++started === 1 ? first.promise : second.promise); },
      onChange: (next) => changes.push(next), onError: (error) => errors.push(error) });
    const one = queue.update((current) => ({ ...current, bedtime: '22:00' }));
    const two = queue.update((current) => ({ ...current, timezone: 'America/Chicago' }));
    first.reject(new Error('First save failed'));
    expect(await one).toBe(false);
    expect(changes).toHaveLength(2);
    expect(queue.current()).toMatchObject({ bedtime: '22:00', timezone: 'America/Chicago' });
    expect(errors).toHaveLength(1);
    second.resolve();
    expect(await two).toBe(true);
    expect(queue.current()).toMatchObject({ bedtime: '22:00', timezone: 'America/Chicago' });
  });

  it('rolls the latest failed edit back to the last successfully saved snapshot', async () => {
    const first = deferred(), second = deferred();
    let started = 0;
    const queue = createPreferenceSaveQueue({ initial: DEFAULT_PREFERENCES,
      save: async () => { await (++started === 1 ? first.promise : second.promise); },
      onChange: () => {}, onError: () => {} });
    const one = queue.update((current) => ({ ...current, hideScores: true }));
    const two = queue.update((current) => ({ ...current, bedtime: '22:00' }));
    first.resolve();
    expect(await one).toBe(true);
    second.reject(new Error('Second save failed'));
    expect(await two).toBe(false);
    expect(queue.current()).toMatchObject({ hideScores: true, bedtime: '23:30' });
  });

  it('restores the original confirmed state when successive saves fail and permits a later retry', async () => {
    let attempts = 0;
    const queue = createPreferenceSaveQueue({ initial: DEFAULT_PREFERENCES,
      save: async () => { if (++attempts < 3) throw new Error('Offline'); }, onChange: () => {}, onError: () => {} });
    const one = queue.update((current) => ({ ...current, length: 'quick' }));
    const two = queue.update((current) => ({ ...current, hideScores: true }));
    expect(await one).toBe(false);
    expect(await two).toBe(false);
    expect(queue.current()).toEqual(DEFAULT_PREFERENCES);
    expect(await queue.update((current) => ({ ...current, length: 'nerd' }))).toBe(true);
    expect(queue.current().length).toBe('nerd');
  });

  it('captures nested preference snapshots without sharing mutable state with callers', async () => {
    const ready = deferred();
    let sent: Preferences | undefined;
    const initial = structuredClone(DEFAULT_PREFERENCES);
    const queue = createPreferenceSaveQueue({ initial, save: async (next) => { sent = next; await ready.promise; }, onChange: () => {}, onError: () => {} });
    const next = structuredClone(initial);
    next.players[0].alerts = false;
    const saving = queue.update(next);
    next.players[0].alerts = true;
    initial.players[0].name = 'Changed outside queue';
    const exposed = queue.current(); exposed.players[0].name = 'Mutated getter';
    await Promise.resolve();
    expect(sent?.players[0]).toMatchObject({ name: 'Victor Wembanyama', alerts: false });
    expect(queue.current().players[0]).toMatchObject({ name: 'Victor Wembanyama', alerts: false });
    ready.resolve();
    await saving;
  });

  it('silences old callbacks and drops unsent saves after the view is disposed', async () => {
    const first = deferred();
    let starts = 0, changes = 0, errors = 0;
    const queue = createPreferenceSaveQueue({ initial: DEFAULT_PREFERENCES,
      save: async () => { starts++; await first.promise; }, onChange: () => { changes++; }, onError: () => { errors++; } });
    const one = queue.update((current) => ({ ...current, hideScores: true }));
    const two = queue.update((current) => ({ ...current, length: 'nerd' }));
    await Promise.resolve();
    queue.dispose();
    first.reject(new Error('Old view request failed'));
    expect(await one).toBe(false);
    expect(await two).toBe(false);
    expect(await queue.update(DEFAULT_PREFERENCES)).toBe(false);
    expect(starts).toBe(1);
    expect(changes).toBe(2);
    expect(errors).toBe(0);
  });

  it('waits for queued saves before reporting idle', async () => {
    const first = deferred(), second = deferred();
    let started = 0, idle = false;
    const queue = createPreferenceSaveQueue({ initial: DEFAULT_PREFERENCES,
      save: async () => { await (++started === 1 ? first.promise : second.promise); }, onChange: () => {}, onError: () => {} });
    void queue.update((current) => ({ ...current, hideScores: true }));
    const waiting = queue.whenIdle().then(() => { idle = true; });
    void queue.update((current) => ({ ...current, length: 'nerd' }));
    first.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(idle).toBe(false);
    second.resolve();
    await waiting;
    expect(idle).toBe(true);
  });
});
