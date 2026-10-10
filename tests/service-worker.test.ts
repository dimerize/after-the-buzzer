import { describe, expect, it, vi } from 'vitest';
import source from '../public/sw.js?raw';
import manifest from '../public/manifest.webmanifest?raw';

function serviceWorker() {
  const handlers: Record<string, (event: any) => void> = {};
  const cache = { addAll: vi.fn(async () => {}), put: vi.fn(async () => {}) };
  const client = { url: 'https://recap.example/?old=1', navigate: vi.fn(async () => client), focus: vi.fn(async () => client) };
  const self = {
    location: { origin: 'https://recap.example' },
    addEventListener: (type: string, callback: (event: any) => void) => { handlers[type] = callback; },
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(async (_title: string, _options: NotificationOptions) => {}) },
    clients: { matchAll: vi.fn(async () => [client]), openWindow: vi.fn() }
  };
  const fetch = vi.fn(async () => new Response('<html><script src="/assets/app-abc.js"></script><link rel="stylesheet" href="/assets/app-def.css"><script src="https://other.example/third-party.js"></script></html>'));
  const caches = {
    open: vi.fn(async (_name: string) => cache),
    match: vi.fn(async (_request: Request) => new Response('cached icon')),
    keys: vi.fn(async () => ['after-the-buzzer-shell-2k7-v5', 'unrelated-cache']),
    delete: vi.fn(async (_name: string) => true),
  };
  Object.assign(self.clients, { claim: vi.fn(async () => {}) });
  new Function('self', 'URL', 'fetch', 'caches', source)(self, URL, fetch, caches);
  return { handlers, cache, caches, client, self, fetch };
}

describe('offline shell and notification navigation', () => {
  it('preserves a validated game report route through notification clicks', async () => {
    const { handlers, client } = serviceWorker();
    let pending: Promise<unknown> = Promise.resolve();
    handlers.notificationclick({ notification: { data: { url: '/?date=2026-10-10&game=401898399&view=injuries' }, close: vi.fn() }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    expect(client.navigate).toHaveBeenCalledWith('/?date=2026-10-10&game=401898399&view=injuries');
  });
  it.each(['/?date=2026-10-10&game=0&view=injuries', '/?date=2026-10-10&game=1&view=admin', '/?date=2026-10-10&game=1&view=injuries&view=boxscore', '/?date=2026-10-10&view=injuries'])('rejects unsafe game report routes: %s', async url => {
    const { handlers, client } = serviceWorker();
    let pending: Promise<unknown> = Promise.resolve();
    handlers.notificationclick({ notification: { data: { url }, close: vi.fn() }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    expect(client.navigate).toHaveBeenCalledWith('/?latest=1');
  });
  it('caches first-load hashed JS and CSS during installation, not just HTML', async () => {
    const { handlers, cache } = serviceWorker();
    let pending: Promise<unknown> = Promise.resolve();
    handlers.install({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    const assets = cache.addAll.mock.calls.flatMap(call => (call as unknown as [string[]])[0]);
    expect(assets).toContain('/assets/app-abc.js');
    expect(assets).toContain('/assets/app-def.css');
    expect(assets).toContain('/city-night.svg');
    expect(assets).toContain('/wordmark.svg');
    const iconUrls = JSON.parse(manifest).icons.map((icon: { src: string }) => icon.src);
    expect(assets).toEqual(expect.arrayContaining(iconUrls));
    expect(assets).not.toContain('https://other.example/third-party.js');
  });

  it('opens the latest live recap when a notification focuses an existing tab', async () => {
    const { handlers, client, self } = serviceWorker();
    let pending: Promise<unknown> = Promise.resolve();
    const close = vi.fn();
    handlers.notificationclick({ notification: { close }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    expect(close).toHaveBeenCalledOnce();
    expect(client.navigate).toHaveBeenCalledWith('/?latest=1');
    expect(client.focus).toHaveBeenCalledOnce();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it.each(['/?date=2026-10-10&player=5104157', 'https://recap.example/?date=2026-10-10&player=5104157'])('preserves a safe source-night/player link through push and tap: %s', async url => {
    const { handlers, client, self } = serviceWorker();
    let pending: Promise<unknown> = Promise.resolve();
    const waitUntil = (promise: Promise<unknown>) => { pending = promise; };
    handlers.push({ data: { json: () => ({ title: 'Player', body: '34 PTS', url }) }, waitUntil });
    await pending;
    const options = self.registration.showNotification.mock.calls[0][1] as any;
    expect(options.data.url).toBe('/?date=2026-10-10&player=5104157');
    expect(new URL(options.icon, 'https://recap.example').pathname).toBe('/icon-192.png');
    handlers.notificationclick({ notification: { data: options.data, close: vi.fn() }, waitUntil });
    await pending;
    expect(client.navigate).toHaveBeenCalledWith('/?date=2026-10-10&player=5104157');
  });

  it.each(['https://evil.example/?date=2026-10-10', '//evil.example/', '/api/logout', '/?date=2026-02-30', '/?player=123', '/?date=2026-10-10&player=abc', '/?date=2026-10-10&player=0', '/?date=2026-10-10&player=01', '/?date=2026-10-10&player=1234567890123', '/?date=2026-10-10&player=1&player=2', '/?date=2026-10-10&sample=1', '/?date=2026-10-10#hidden', 'javascript:alert(1)', '/?date=2026-10-10&latest=1'])('rejects malformed/hostile stored notification routes: %s', async url => {
    const { handlers, client } = serviceWorker();
    let pending: Promise<unknown> = Promise.resolve();
    handlers.notificationclick({ notification: { data: { url }, close: vi.fn() }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    expect(client.navigate).toHaveBeenCalledWith('/?latest=1');
  });

  it('opens the source night in a new window when no app tab is open', async () => {
    const { handlers, self } = serviceWorker();
    self.clients.matchAll.mockResolvedValue([]);
    let pending: Promise<unknown> = Promise.resolve();
    handlers.notificationclick({ notification: { data: { url: '/?date=2026-10-10' }, close: vi.fn() }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    expect(self.clients.openWindow).toHaveBeenCalledWith('/?date=2026-10-10');
  });

  it('opens a new window if a previously matched tab closes before navigation', async () => {
    const { handlers, client, self } = serviceWorker();
    client.navigate.mockRejectedValue(new Error('Tab closed'));
    let pending: Promise<unknown> = Promise.resolve();
    handlers.notificationclick({ notification: { data: { url: '/?date=2026-10-10&player=5104157' }, close: vi.fn() }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    expect(self.clients.openWindow).toHaveBeenCalledWith('/?date=2026-10-10&player=5104157');
  });

  it('displays safe defaults for malformed push data and never stores an external click target', async () => {
    const { handlers, self } = serviceWorker();
    let pending: Promise<unknown> = Promise.resolve();
    const waitUntil = (promise: Promise<unknown>) => { pending = promise; };
    handlers.push({ data: { json: () => { throw new Error('Invalid JSON'); } }, waitUntil });
    await pending;
    expect(self.registration.showNotification).toHaveBeenCalledWith('Buzzer', expect.objectContaining({ body: 'NBA recap available.', data: { url: '/?latest=1' } }));
    handlers.push({ data: { json: () => ({ title: 42, body: {}, url: 'https://evil.example/' }) }, waitUntil });
    await pending;
    expect(self.registration.showNotification).toHaveBeenLastCalledWith('Buzzer', expect.objectContaining({ data: { url: '/?latest=1' } }));
  });

  it('keeps private API and cross-origin requests out of the offline cache', () => {
    const { handlers } = serviceWorker();
    for (const url of ['https://recap.example/api/dashboard', 'https://evil.example/icon.svg']) {
      const respondWith = vi.fn();
      handlers.fetch({ request: { url, method: 'GET', mode: 'navigate' }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });

  it('retires the previous logo cache without deleting unrelated caches', async () => {
    const { handlers, caches } = serviceWorker();
    let pending: Promise<unknown> = Promise.resolve();
    handlers.activate({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    expect(caches.delete).toHaveBeenCalledWith('after-the-buzzer-shell-2k7-v5');
    expect(caches.delete).not.toHaveBeenCalledWith('unrelated-cache');
  });

  it('uses a fresh, precached notification icon instead of the old unversioned URL', async () => {
    const { handlers, self, cache } = serviceWorker();
    let pending: Promise<unknown> = Promise.resolve();
    const waitUntil = (promise: Promise<unknown>) => { pending = promise; };
    handlers.install({ waitUntil });
    await pending;
    handlers.push({ data: { json: () => ({}) }, waitUntil });
    await pending;
    const { icon, badge } = self.registration.showNotification.mock.calls[0][1];
    expect(icon).not.toBe('/icon-192.png');
    expect(badge).toBe(icon);
    const assets = cache.addAll.mock.calls.flatMap(call => (call as unknown as [string[]])[0]);
    expect(assets).toContain(icon);
  });

  it('serves the versioned Apple icon offline without falling through to the network', async () => {
    const { handlers, fetch } = serviceWorker();
    let response: Promise<Response> | undefined;
    handlers.fetch({
      request: new Request('https://recap.example/apple-touch-icon.png?v=2'),
      respondWith: (pending: Promise<Response>) => { response = pending; },
    });
    expect(response).toBeDefined();
    expect(await (await response!).text()).toBe('cached icon');
    expect(fetch).not.toHaveBeenCalled();
  });
});
