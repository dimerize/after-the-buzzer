const CACHE = 'after-the-buzzer-shell-2k7-v6';
const NOTIFICATION_ICON = '/icon-192.png?v=2';
const SHELL = ['/', '/icon.svg?v=2', NOTIFICATION_ICON, '/icon-512.png?v=2', '/apple-touch-icon.png?v=2', '/wordmark.svg', '/city-night.svg', '/manifest.webmanifest'];
const SHELL_PATHS = new Set(SHELL.map(path => path.split('?')[0]));
function notificationUrl(value) {
  const fallback = '/?latest=1';
  if (typeof value !== 'string' || value.length > 512 || /[\s\\]/.test(value)) return fallback;
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || url.pathname !== '/' || url.username || url.password || url.hash) return fallback;
    const keys = [...url.searchParams.keys()];
    if (keys.length === 1 && url.searchParams.get('latest') === '1') return fallback;
    if (keys.some(key => !['date', 'player', 'game', 'view'].includes(key)) || new Set(keys).size !== keys.length) return fallback;
    const date = url.searchParams.get('date');
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date || '')) return fallback;
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return fallback;
    const player = url.searchParams.get('player');
    if (player !== null && !/^[1-9]\d{0,11}$/.test(player)) return fallback;
    const game = url.searchParams.get('game');
    const view = url.searchParams.get('view');
    if ((game === null) !== (view === null) || (game !== null && (!/^[1-9]\d{0,11}$/.test(game) || !['injuries', 'boxscore'].includes(view)))) return fallback;
    return `/?date=${date}${player === null ? '' : `&player=${player}`}${game === null ? '' : `&game=${game}&view=${view}`}`;
  } catch { return fallback; }
}
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch('/', { cache: 'reload' });
    if (!response.ok) throw new Error('Offline shell unavailable');
    const html = await response.clone().text();
    // First-visit bundles load before this worker controls the page.
    const bundles = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map(match => match[1]);
    await cache.addAll([...new Set([...SHELL.filter(path => path !== '/'), ...bundles])]);
    await cache.put('/', response);
  })());
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key.startsWith('after-the-buzzer-shell-')).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Private dashboard, archive and player data must never enter the offline cache.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then((cache) => cache.put('/', copy))); }
      return response;
    }).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || SHELL_PATHS.has(url.pathname) || /^\/icon-\d+\.png$/.test(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy))); }
      return response;
    })));
  }
});
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json() || {}; } catch { /* Use a safe default for malformed payloads. */ }
  const title = typeof data.title === 'string' ? data.title.slice(0, 100) : 'Buzzer';
  const body = typeof data.body === 'string' ? data.body.slice(0, 200) : 'NBA recap available.';
  const tag = typeof data.tag === 'string' ? data.tag.slice(0, 128) : 'buzzer-edition';
  event.waitUntil(self.registration.showNotification(title, { body, icon: NOTIFICATION_ICON, badge: NOTIFICATION_ICON, tag, data: { url: notificationUrl(data.url) } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Revalidate on click as notifications may outlive this worker version.
  const target = notificationUrl(event.notification.data?.url);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        try {
          const navigated = await client.navigate(target);
          if (navigated) return await navigated.focus();
        } catch { /* A tab may have closed; try another or open a new one. */ }
      }
    }
    return self.clients.openWindow(target);
  }));
});
