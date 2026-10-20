// Service Worker: (1) macht die App offline startklar, (2) ergänzt die Header für
// "Cross-Origin Isolation", falls der Server sie nicht selbst sendet (z. B. GitHub Pages).
const CACHE = 'smaragd-touch-v14';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/emu.js', 'js/input.js', 'js/touch.js', 'js/view.js', 'js/world.js', 'js/stage.js', 'js/bridge.js', 'js/ui.js', 'js/data.js', 'js/menus.js', 'js/skins.js', 'js/textlayer.js', 'js/charmap.js', 'js/battle.js', 'js/scenery.js', 'js/frametap.js',
  'vendor/mgba.js', 'vendor/mgba.wasm', 'vendor/fonts/press-start-2p-latin-400-normal.woff2',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

function withIsolation(resp) {
  if (!resp || resp.status === 0 || resp.type === 'opaque') return resp;
  const h = new Headers(resp.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/__rom')) return;
  const isBig = url.pathname.endsWith('.wasm');
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (isBig) {
        const hit = await cache.match(req);
        if (hit) return withIsolation(hit);
      }
      try {
        const net = await fetch(req);
        if (net.ok) cache.put(req, net.clone());
        return withIsolation(net);
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return withIsolation(hit);
        throw err;
      }
    })()
  );
});
