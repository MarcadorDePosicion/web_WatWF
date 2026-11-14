const scope = new URL(self.registration.scope);
const cachePrefix = `wat-wf:${scope.href}:`;
// Bump after changes to the app shell so older tabs keep a consistent release.
const CACHE_VERSION = 'v1';
const cacheName = `${cachePrefix}${CACHE_VERSION}`;
const shell = new Set([
  'index.html', 'app.js', 'styles/app.css',
  'js/schedule.js', 'js/personal-plan.js', 'js/install.js', 'js/pwa.js',
  'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
]);
const schedulePath = 'data/schedule.json';
const metadataPath = 'data/schedule.meta.json';
const dataFiles = new Set([schedulePath, metadataPath]);
const assetURL = path => new URL(path, scope).href;

async function isPlanData(path, response) {
  const type = response?.headers.get('Content-Type') ?? '';
  if (!response?.ok || !/^application\/json(?:\s*;|$)/i.test(type)) return false;
  const value = await response.json();
  if (path === metadataPath) {
    return value?.timezone === 'Europe/Warsaw' && Number.isInteger(value.report?.recordCount);
  }
  if (!Array.isArray(value) || !value.length) return false;
  const ids = new Set();
  const dates = new Set();
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  for (const lesson of value) {
    if (!lesson || !['id', 'date', 'startTime', 'endTime', 'company', 'platoon', 'topic', 'notes']
      .every(field => typeof lesson[field] === 'string')) return false;
    if (ids.has(lesson.id) || !clock.test(lesson.startTime) || !clock.test(lesson.endTime) ||
      lesson.startTime >= lesson.endTime || !['lecturer', 'location']
        .every(field => lesson[field] === null || typeof lesson[field] === 'string')) return false;
    if (!dates.has(lesson.date)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lesson.date)) return false;
      const date = new Date(`${lesson.date}T12:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== lesson.date) return false;
      dates.add(lesson.date);
    }
    ids.add(lesson.id);
  }
  return true;
}

async function installShell() {
  const cache = await caches.open(cacheName);
  const requests = [...shell, ...dataFiles].map(path => new Request(assetURL(path), {
    cache: 'reload', redirect: 'error',
  }));
  try {
    await cache.addAll(requests);
    for (const path of dataFiles) {
      if (!await isPlanData(path, await cache.match(assetURL(path)))) {
        throw new Error(`Invalid schedule data at ${path}`);
      }
    }
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
}

self.addEventListener('install', event => event.waitUntil(installShell()));

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(cachePrefix) && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function serveShell(path, request) {
  const saved = await caches.match(assetURL(path), {cacheName});
  return saved ?? fetch(request);
}

async function servePlan(path, request) {
  const key = assetURL(path);
  const cache = await caches.open(cacheName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(request, {
      cache: 'no-cache', redirect: 'error', signal: controller.signal,
    });
    if (!await isPlanData(path, response.clone())) throw new Error(`Invalid schedule data at ${path}`);
    // A storage failure must not interrupt access to valid live data.
    await cache.put(key, response.clone()).catch(() => {});
    return response;
  } catch {
    const saved = await cache.match(key);
    if (!saved) return new Response(null, {status: 503});
    const headers = new Headers(saved.headers);
    headers.delete('Content-Encoding');
    headers.delete('Content-Length');
    headers.set('X-WAT-Cache', 'fallback');
    return new Response(saved.body, {headers});
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET' || request.headers.has('Range')) return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (dataFiles.has(path)) {
    event.respondWith(servePlan(path, request));
  } else if (!path && request.mode === 'navigate') {
    event.respondWith(serveShell('index.html', request));
  } else if (shell.has(path)) {
    event.respondWith(serveShell(path, request));
  }
});
