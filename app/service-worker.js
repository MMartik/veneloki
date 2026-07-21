
const APP_VERSION = "0.2.9";
const CACHE_NAME = `veneloki-v${APP_VERSION}`;
const APP_BASE_URL = new URL("./", self.location.href);
const APP_FILES = [
  "./index.html",
  `./css/app.css?v=${APP_VERSION}`,
  `./js/storage.js?v=${APP_VERSION}`,
  `./js/api.js?v=${APP_VERSION}`,
  `./js/app.js?v=${APP_VERSION}`
];
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
  const requestUrl = new URL(event.request.url);

  event.respondWith((async () => {
    if (event.request.method === "GET" &&
        requestUrl.origin === self.location.origin &&
        event.request.mode === "navigate") {
      const appShell = await caches.match(INDEX_URL);
      if (appShell) return appShell;
    }

    const cached = event.request.method === "GET"
      ? await caches.match(event.request, { ignoreSearch: true })
      : null;
    if (cached) return cached;

    // v0.2.9 on tarkoituksella täysin verkkoliikenteetön rajaustesti.
    // Myös välimuistista puuttuva pyyntö päätetään paikallisesti, jotta selain
    // ei voi yrittää Wi-Fiä tai mobiilidataa Venelokin puolesta.
    return new Response("Verkkopyynnöt on estetty Venelokin testitilassa.", {
      status: 503,
      statusText: "Network diagnostic mode",
      headers: { "Content-Type": "text/plain;charset=utf-8" }
    });
  })());
});
