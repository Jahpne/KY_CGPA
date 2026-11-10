// ════════════════════════════════════════════════════════
//  SERVICE WORKER  —  sw.js
//  Keeps the app on the phone so it opens on weak or no network.
//  - Your own files: try the network for up to 3.5 s, otherwise use the saved copy
//    (the saved copy is refreshed in the background, so updates still arrive).
//  - Firebase / chart / font libraries: saved once, then served from the phone.
//  - Database and sign-in traffic is never touched here.
//  Change VERSION whenever you release an update.
// ════════════════════════════════════════════════════════
const VERSION = 'gp-v4';

const CORE = [
  '/', '/index.html', '/admin',
  '/css/style.css', '/css/nav.css', '/css/tools.css', '/css/stats.css', '/css/account.css',
  '/js/config.js', '/js/data.js', '/js/calculator.js', '/js/render.js', '/js/nav.js',
  '/js/timetable.js', '/js/compare.js', '/js/stats.js', '/js/target.js',
  '/js/app.js', '/js/account.js', '/js/library.js', '/js/cloud.js', '/js/admin.js',
  '/image/logo-128.png', '/image/icon-192.png', '/image/icon-512.png', '/manifest.webmanifest'
];

const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-chart-financial@0.2.1/dist/chartjs-chart-financial.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=DM+Serif+Display&display=swap'
];

const FIREBASE = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
];

const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

// Firebase files import other Firebase files; save those too
async function saveModule(cache, url, seen) {
  if (seen.has(url)) return;
  seen.add(url);
  const res = await fetch(url);
  if (!res.ok) return;
  await cache.put(url, res.clone());
  const text = await res.text();
  const re = /(?:from|import)\s*["']([^"']+\.js)["']/g;
  const subs = [];
  let m;
  while ((m = re.exec(text))) {
    try { subs.push(new URL(m[1], url).href); } catch (e) {}
  }
  await Promise.all(subs
    .filter(u => u.startsWith('https://www.gstatic.com/firebasejs/'))
    .map(u => saveModule(cache, u, seen).catch(() => {})));
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(CORE.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await Promise.all(LIBS.map(u => cache.add(u).catch(() => {})));
    const seen = new Set();
    await Promise.all(FIREBASE.map(u => saveModule(cache, u, seen).catch(() => {})));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return Response.error();
  }
}

async function networkFirst(event) {
  const req = event.request;
  const cache = await caches.open(VERSION);
  const nav = req.mode === 'navigate';
  const cached = await cache.match(req, { ignoreSearch: nav });

  const net = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  event.waitUntil(net.catch(() => {}));

  if (!cached) {
    try { return await net; }
    catch (e) {
      const fallback = nav ? await cache.match('/index.html') : null;
      return fallback || Response.error();
    }
  }
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 3500));
  const res = await Promise.race([net.catch(() => null), timeout]);
  return res || cached;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/__/')) return;

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(event));
  } else if (CDN_HOSTS.includes(url.hostname) ||
             (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))) {
    event.respondWith(cacheFirst(req));
  }
  // everything else (database, sign-in, WhatsApp...) goes straight to the network
});
