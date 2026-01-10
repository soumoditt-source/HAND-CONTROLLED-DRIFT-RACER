
/*
 * Service Worker for Gesture Racer 3D
 * Enables Offline Play after first load.
 */

const CACHE_NAME = 'gesture-racer-v1-megatronix';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/favicon.ico'
];

// Domains we want to cache assets from dynamically
const EXTERNAL_DOMAINS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'esm.sh',
  'cdn.jsdelivr.net',
  'storage.googleapis.com', // MediaPipe models
  'raw.githubusercontent.com' // Audio
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Check if request is for an external CDN we want to cache
  const isExternalAsset = EXTERNAL_DOMAINS.some(domain => url.hostname.includes(domain));

  if (event.request.method === 'GET' && (isExternalAsset || url.origin === self.location.origin)) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request)
          .then((response) => {
            // Check if valid response
            if (!response || response.status !== 200 || response.type !== 'basic' && response.type !== 'cors' && response.type !== 'opaque') {
              return response;
            }

            // Clone response to put in cache
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });

            return response;
          })
          .catch((err) => {
            console.warn('Fetch failed for ' + event.request.url, err);
            // Return a fallback response so the app doesn't crash on "Failed to fetch"
            // We return a 408 to indicate timeout/offline without breaking the promise chain hard
            return new Response('Offline', { status: 408, statusText: 'Offline/Fetch Failed' });
          });
      })
    );
  }
});
