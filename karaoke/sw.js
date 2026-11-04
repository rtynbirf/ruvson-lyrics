/* КАРАОКЕ МЕЧТЫ 2.0 — service worker: офлайн-кэш ядра приложения */
const CACHE = 'km2-v3.2';
const CORE = [
  './',
  'index.html',
  'style.css',
  'songs.js',
  'engine.js',
  'app.js',
  'manifest.webmanifest',
  'icon.svg',
  'lrc/n01.lrc',
  'lrc/n02.lrc',
  'lrc/n03.lrc',
  'lrc/n04.lrc',
  'lrc/n05.lrc',
  'lrc/n06.lrc',
  'lrc/n07.lrc',
  'lrc/n08.lrc',
  'lrc/n09.lrc',
  'lrc/n10.lrc',
  'lrc/n11.lrc',
  'lrc/n12.lrc',
  'lrc/n13.lrc',
  'lrc/n14.lrc',
  'lrc/n15.lrc',
  'lrc/n16.lrc',
  'lrc/n17.lrc',
  'lrc/n18.lrc',
  'lrc/n19.lrc',
  'lrc/n20.lrc',
  'lrc/n21.lrc',
  'lrc/n22.lrc',
  'lrc/n23.lrc',
  'lrc/n24.lrc',
  'lrc/n25.lrc',
  'lrc/n27.lrc',
  'lrc/n28.lrc',
  'lrc/n29.lrc',
  'lrc/n30.lrc',
  'lrc/n31.lrc',
  'lrc/n32.lrc',
  'lrc/n33.lrc',
  'lrc/n34.lrc',
  'lrc/n35.lrc',
  'lrc/n36.lrc',
  'lrc/n37.lrc',
  'lrc/n39.lrc',
  'lrc/n40.lrc',
  'lrc/n41.lrc',
  'lrc/n42.lrc',
  'lrc/n43.lrc',
  'lrc/n44.lrc',
  'lrc/n45.lrc',
  'lrc/n46.lrc',
  'lrc/n47.lrc',
  'lrc/n48.lrc',
  'lrc/n49.lrc',
  'lrc/n50.lrc',
  'lrc/n51.lrc',
  'lrc/n52.lrc',
  'lrc/n53.lrc',
  'lrc/n54.lrc',
  'lrc/n55.lrc',
  'lrc/n56.lrc',
  'lrc/n57.lrc',
  'lrc/n58.lrc',
  'lrc/n59.lrc',
  'lrc/n60.lrc',
  'lrc/n61.lrc',
  'lrc/n62.lrc',
  'lrc/n63.lrc',
  'lrc/n64.lrc',
  'lrc/n65.lrc'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit => {
      const net = fetch(e.request).then(resp => {
        if (resp && resp.ok && e.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
