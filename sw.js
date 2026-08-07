/* Minimal offline cache so the app keeps working without a network
 * connection once it has been loaded/installed. */
const CACHE = "picture-frame-v3";
const FILES = ["./", "./index.html", "./style.css", "./app.js", "./quotes.js",
               "./manifest.json", "./icon-192.png", "./icon-512.png",
               "./fonts/cormorant-garamond-latin.woff2",
               "./fonts/cormorant-garamond-latin-ext.woff2",
               "./fonts/cormorant-garamond-italic-latin.woff2",
               "./fonts/cormorant-garamond-italic-latin-ext.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
});

/* Network-first: updates are picked up whenever the device is online;
 * the cache only serves as an offline fallback. */
self.addEventListener("fetch", (e) => {
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
