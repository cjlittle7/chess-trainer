// Offline support. Files are served from the cache first and refreshed in the background,
// so an update shows up the second time you open the app. Bump CACHE if you add or rename files.
const CACHE = "opening-trainer-v22";
const FILES = ["./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest",
               "./config.js", "./assets/study/photo.jpg", "./assets/study/tomato.gif", "./assets/study/tomato-last.png",
               "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const refresh = fetch(e.request, { cache: "no-cache" }).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(refresh); return hit; }
    return (await refresh) || (e.request.mode === "navigate" ? cache.match("./index.html") : Response.error());
  }));
});
