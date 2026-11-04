/* ═══════════════════════════════════════════════════════════════════════════
   КАРАОКЕ МЕЧТЫ 2.0 · прототип СЦЕНА · sw.js
   Service Worker: cache-first + поколение кэша.
   Канон дома СИНГУЛЯР: любой такт поднимает поколение — не поднять
   = жилец ходит по старому дому и думает, что правка не работает.
   Поколение: prototip-scena-v2 (волна №33: конвейер 5/5)
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

var ПРОТОТИП_КЭШ = 'prototip-scena-v2';

var ПРЕКЭШ = [
  './',
  './index.html',
  './css/style.css',
  './js/lrc-core.js',
  './js/wsola-core.js',
  './js/opfs-core.js',
  './js/pitch-core.js',
  './js/score-core.js',
  './js/song.js',
  './js/stage-core.js',
  './js/app.js',
  './minus/n01.lrc',
  './minus/n02.lrc',
  './minus/n03.lrc',
  './minus/n04.lrc',
  './minus/n05.lrc',
  './minus/ahmGGM-P0CA.mp3',
  './minus/R0SOJreGbhM.mp3',
  './minus/cFHsQ-LP3ns.mp3',
  './minus/kziwaat2nu4.mp3',
  './minus/WMU46n--Z-s.mp3'
];

self.addEventListener('install', function (событие) {
  событие.waitUntil(
    caches.open(ПРОТОТИП_КЭШ).then(function (кэш) {
      return кэш.addAll(ПРЕКЭШ);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (событие) {
  событие.waitUntil(
    caches.keys().then(function (имена) {
      return Promise.all(имена.map(function (имя) {
        if (имя !== ПРОТОТИП_КЭШ) return caches.delete(имя);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (событие) {
  if (событие.request.method !== 'GET') return;
  событие.respondWith(
    caches.match(событие.request, { ignoreSearch: true }).then(function (изКэша) {
      if (изКэша) return изКэша;
      return fetch(событие.request).then(function (ответ) {
        /* дубли (blob:) и прочее не кэшируем; минус кэшируем на первом прослушивании */
        var урл = событие.request.url;
        if (ответ.ok && (урл.indexOf('/minus/') !== -1 || урл.indexOf('/js/') !== -1 || урл.indexOf('/css/') !== -1)) {
          var копия = ответ.clone();
          caches.open(ПРОТОТИП_КЭШ).then(function (кэш) { кэш.put(событие.request, копия); });
        }
        return ответ;
      }).catch(function () {
        /* офлайн и не в кэше — честное лицо тупика */
        return new Response('Офлайн: этого файла нет в кэше. Ядро дома цело, страница доступна.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});
