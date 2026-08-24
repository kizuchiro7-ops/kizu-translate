/* KIZU 翻訳 — オフライン用 Service Worker
   フレーズ集は完全オフラインで動く必要がある（院内でWi-Fiが切れても使えるように）。
   AI翻訳だけは通信が必須なので、キャッシュ対象から外す。 */
const CACHE = "kizu-tr-v1";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                       /* 翻訳API(POST)は素通し */
  if (new URL(req.url).origin !== self.location.origin) return;

  /* HTML は network-first にして、更新したフレーズがすぐ届くようにする。
     オフライン時のみキャッシュへフォールバック。 */
  if (req.mode === "navigate" || req.destination === "document"){
    e.respondWith(
      fetch(req)
        .then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res; })
        .catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
    );
    return;
  }

  /* それ以外(アイコン等)は cache-first */
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res;
    }))
  );
});
