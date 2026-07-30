// Хамгийн энгийн service worker — зөвхөн PWA "Install" боломжийг
// нээхэд шаардлагатай хамгийн бага код. Тусгай offline-кэш хийхгүй.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Сүлжээгээр шууд дамжуулна (кэш ашиглахгүй) — dashboard үргэлж
  // хамгийн шинэ мэдээллийг харуулах ёстой тул
  event.respondWith(fetch(event.request));
});