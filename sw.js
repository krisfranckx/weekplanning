/* Eenvoudige service worker: eerst het netwerk proberen, anders de bewaarde kopie (offline). */
const CACHE = 'weekplanning-v2';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const BESTANDEN = ['./', 'index.html', 'css/stijl.css', 'js/logica.js', 'js/app.js', 'manifest.webmanifest', 'icoon.svg', 'js/sync.js'];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(BESTANDEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(namen => Promise.all(namen.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  if (ev.request.method !== 'GET') return;
  // De Supabase-bibliotheek (vaste versie) mag uit de cache komen, zodat de app offline start.
  if (ev.request.url === SUPABASE_JS) {
    ev.respondWith(caches.match(ev.request).then(c => c || fetch(ev.request).then(a => {
      const kopie = a.clone();
      caches.open(CACHE).then(cache => cache.put(ev.request, kopie));
      return a;
    })));
    return;
  }
  if (new URL(ev.request.url).origin !== location.origin) return;
  ev.respondWith(
    fetch(ev.request)
      .then(antwoord => {
        const kopie = antwoord.clone();
        caches.open(CACHE).then(c => c.put(ev.request, kopie));
        return antwoord;
      })
      .catch(() => caches.match(ev.request))
  );
});
