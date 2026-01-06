const CACHE_NAME = 'jeev-cpr-cache-v1';
const urlsToCache = [
  'login.html',
  'index.html',
  'manifest.json',
  'icon.png'
  // add any other static assets you need cached (fonts, images, CSS, etc.)
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response =>
      response || fetch(event.request)
    ).catch(() => {
      // fallback could be added here, like return caches.match('offline.html')
    })
  );
});
