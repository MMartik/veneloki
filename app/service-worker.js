
const APP_VERSION = "0.2.2";
const CACHE_NAME = `veneloki-v${APP_VERSION}`;
const APP_FILES = [
  "./",
  "./index.html",
  `./css/app.css?v=${APP_VERSION}`,
  `./js/storage.js?v=${APP_VERSION}`,
  `./js/api.js?v=${APP_VERSION}`,
  `./js/app.js?v=${APP_VERSION}`,
  `./manifest.webmanifest?v=${APP_VERSION}`
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(
      APP_FILES.map(url => new Request(url, { cache: "reload" }))
    ))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request, { cache: "no-store" });

      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }

      return response;
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      if (event.request.mode === "navigate") {
        return caches.match("./index.html");
      }

      throw error;
    }
  })());
});
