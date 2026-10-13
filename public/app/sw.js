/* Service worker mínimo: guarda só os arquivos estáticos do app para abrir rápido.
 * Nunca guarda respostas da API (api.php) nem de outros endereços. */
const CACHE = 'gn-app-v2';
const ARQUIVOS = ['./', 'index.html', 'app.css?v=20261013-1', 'app.js?v=20261013-1', 'manifest.json', 'icon-192.png', 'icon-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !u.pathname.startsWith('/app/') || u.pathname.endsWith('api.php')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
});
