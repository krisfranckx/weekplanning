/* Eenvoudige service worker: eerst het netwerk proberen, anders de bewaarde kopie (offline). */
const CACHE = 'weekplanning-v1';
const BESTANDEN = ['./', 'index.html', 'css/stijl.css', 'js/logica.js', 'js/app.js', 'manifest.webmanifest', 'icoon.svg'];

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
  if (ev.request.method !== 'GET' || new URL(ev.request.url).origin !== location.origin) return;
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
