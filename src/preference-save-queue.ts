import type { Preferences } from './shared/types';

export type PreferenceUpdate = Preferences | ((current: Preferences) => Preferences);
export interface PreferenceSaveQueue {
  /** Resolves false after a save failure or disposal; save failures also call onError. */
  update(next: PreferenceUpdate): Promise<boolean>;
  current(): Preferences;
  whenIdle(): Promise<void>;
  /** Stops callbacks and unsent writes. Await whenIdle first to finish intentional edits. */
  dispose(): void;
}
/** One queue per reader session/mode. Keep it stable across renders and page navigation. */
export function createPreferenceSaveQueue(options: {
  initial: Preferences;
  save: (next: Preferences) => Promise<unknown>;
  onChange: (next: Preferences) => void;
  onError: (error: unknown) => void;
}): PreferenceSaveQueue {
  let confirmed = structuredClone(options.initial);
  let optimistic = structuredClone(options.initial);
  let revision = 0;
  let disposed = false;
  let tail: Promise<void> = Promise.resolve();

  return {
    update(input) {
      if (disposed) return Promise.resolve(false);
      const snapshot = structuredClone(typeof input === 'function' ? input(structuredClone(optimistic)) : input);
      const ownRevision = ++revision;
      optimistic = snapshot;
      const result = tail.then(async () => {
        if (disposed) return false;
        try {
          await options.save(structuredClone(snapshot));
          confirmed = snapshot;
          return !disposed;
        } catch (error) {
          if (!disposed) {
            // A later full snapshot already represents the user's current intent.
            if (ownRevision === revision) {
              optimistic = confirmed;
              options.onChange(structuredClone(confirmed));
            }
            options.onError(error);
          }
          return false;
        }
      });
      // A callback exception must not permanently poison later queued saves.
      tail = result.then(() => undefined, () => undefined);
      options.onChange(structuredClone(snapshot));
      return result;
    },
    current() { return structuredClone(optimistic); },
    async whenIdle() {
      let observed: Promise<void>;
      do { observed = tail; await observed; } while (observed !== tail);
    },
    dispose() { disposed = true; }
  };
}
