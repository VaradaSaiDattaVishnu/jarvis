// J.A.R.V.I.S Service Worker — Push Notifications + Offline + Background Sync

const CACHE_NAME = 'jarvis-v2';
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
];

// Install — cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first with offline fallback
self.addEventListener('fetch', (event) => {
  // Skip non-GET, audio files (temporary), API calls, and WebSocket
  if (
    event.request.method !== 'GET' ||
    event.request.url.includes('/audio/') ||
    event.request.url.includes('/api/') ||
    event.request.url.includes('ws:') ||
    event.request.url.includes('wss:')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful HTML/JS/CSS responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline — serve from cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;

          // For navigation requests, serve the app shell
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
        });
      })
  );
});

// Push notification received
self.addEventListener('push', (event) => {
  let data = { title: 'J.A.R.V.I.S', body: 'You have a reminder' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    vibrate: [200, 100, 200],
    tag: data.tag || 'jarvis-notification',
    renotify: true,
    data: {
      url: data.url || '/',
      reminderId: data.reminderId,
    },
    actions: [
      { action: 'open', title: 'Open JARVIS' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'J.A.R.V.I.S', options)
  );
});

// Notification clicked — focus or open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(event.notification.data.url || '/');
    })
  );
});

// Background sync — queue messages sent while offline
self.addEventListener('sync', (event) => {
  if (event.tag === 'jarvis-sync') {
    event.waitUntil(
      // Replay queued messages when back online
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'sync-ready' });
        });
      })
    );
  }
});
