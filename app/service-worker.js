
const APP_VERSION = "0.2.4";
const CACHE_NAME = `veneloki-v${APP_VERSION}`;
const APP_BASE_URL = new URL("./", self.location.href);
const APP_FILES = [
  "./index.html",
  `./css/app.css?v=${APP_VERSION}`,
  `./js/storage.js?v=${APP_VERSION}`,
  `./js/api.js?v=${APP_VERSION}`,
  `./js/app.js?v=${APP_VERSION}`
];
const OPTIONAL_FILES = [`./manifest.webmanifest?v=${APP_VERSION}`];
const INDEX_URL = new URL("./index.html", APP_BASE_URL).href;
const APP_FILE_URLS = APP_FILES.map(path => new URL(path, APP_BASE_URL).href);

async function fetchIntoCache(cache, url) {
  const request = new Request(url, { cache: "reload" });
  const response = await fetch(request);

  if (!response.ok) {
    throw new Error(`Offline-tiedoston lataus epäonnistui (${response.status}): ${url}`);
  }

  await cache.put(url, response);
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);

  for (const url of APP_FILE_URLS) {
    await fetchIntoCache(cache, url);
  }

  for (const path of OPTIONAL_FILES) {
    const url = new URL(path, APP_BASE_URL).href;
    try {
      await fetchIntoCache(cache, url);
    } catch (error) {
      console.warn(error);
    }
  }

  return true;
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    await cacheAppShell();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type !== "CACHE_APP_SHELL") return;

  event.waitUntil((async () => {
    try {
      await cacheAppShell();
      event.ports[0]?.postMessage({ ok: true, version: APP_VERSION });
    } catch (error) {
      event.ports[0]?.postMessage({ ok: false, error: error?.message || String(error) });
    }
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    if (event.request.mode === "navigate") {
      const appShell = await caches.match(INDEX_URL);
      if (appShell) return appShell;
    }

    const cached = await caches.match(event.request, { ignoreSearch: false });
    if (cached) return cached;

    try {
      const response = await fetch(event.request, { cache: "no-store" });

      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }

      return response;
    } catch (error) {
      if (event.request.mode === "navigate") {
        const fallback = await caches.match(INDEX_URL);
        if (fallback) return fallback;
      }

      throw error;
    }
  })());
});
