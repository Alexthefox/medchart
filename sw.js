const CACHE = 'medchart-v2';
const CORE = [
  '/medchart/',
  '/medchart/index.html',
  '/medchart/manifest.json',
  '/medchart/icon-192.png',
  '/medchart/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Skip Google API, OAuth, CDN calls — let them go to network directly
  const url = e.request.url;
  if (url.includes('googleapis.com') || url.includes('accounts.google') ||
      url.includes('gstatic.com') || url.includes('unpkg.com') ||
      url.includes('cdnjs.cloudflare') || url.includes('fonts.googleapis')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
