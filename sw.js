// Service worker de Admin 1405
// Estrategia: cache del "cascarón" de la app (shell) para que abra
// offline; los datos (Firestore) se manejan en línea por el SDK.
const CACHE = "admin1405-v1";
const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/firebase-config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Nunca cachear Firebase / Google (auth y datos siempre en línea)
  if (url.hostname.includes("firebase") ||
      url.hostname.includes("google") ||
      url.hostname.includes("gstatic")) {
    return; // deja pasar a la red
  }
  // Para los archivos propios: cache primero, luego red
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});
