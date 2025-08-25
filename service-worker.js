/*
 * LibreTV Service Worker - 带 LRU 的离线缓存（不缓存 HLS 分片）
 * 修复：install 阶段 addAll 失败（任一资源 404/跨域就会整个失败），改为“逐个抓取 + 忽略失败”。
 */

const PRECACHE = 'libretv-precache-v2';
const RUNTIME = 'libretv-runtime-v1';
const MAX_BYTES = 200 * 1024 * 1024; // 200MB
const API_TTL_MS = 5 * 60 * 1000; // API 缓存 5 分钟

// 只放“确定存在的”资源，避免 404 造成安装失败。
// 其他静态资源由运行时 Cache First 自动填充。
const PRECACHE_URLS = [
  // '/css/player.css',
  // '/css/styles.css',
  // '/js/player.js',
  // '/player.html',
  // '/index.html',
  // // '/favicon.ico',
  // // '/manifest.webmanifest',
  // // 其他存在的文件再按需打开
  // '/libs/DPlayer.min.js',
  // '/libs/sha256.min.js',
  // '/libs/tailwindcss.min.js',
  // '/libs/hls.min.js'
];

// ---- IndexedDB 简单封装（记录条目大小、时间戳，实现 LRU）----
const DB_NAME = 'libretv-sw';
const STORE = 'entries';
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'url' });
        s.createIndex('time', 'time');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(url) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const r = store.get(url);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function idbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(url) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.delete(url);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const items = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        items.push(cursor.value);
        cursor.continue();
      } else {
        resolve(items);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// 估算响应大小：优先 content-length，没有则读为 blob
async function getResponseSize(resp) {
  const len = resp.headers.get('content-length');
  if (len && !isNaN(+len)) return +len;
  try {
    const blob = await resp.clone().blob();
    return blob.size || 0;
  } catch (e) {
    return 0;
  }
}

// 计算总占用
async function getTotalBytes() {
  const all = await idbAll();
  return all.reduce((acc, x) => acc + (x.size || 0), 0);
}

// 触发 LRU 淘汰（按 time 升序删除最老的）
async function enforceLRU(cache) {
  let total = await getTotalBytes();
  if (total <= MAX_BYTES) return;
  const all = await idbAll();
  all.sort((a, b) => (a.time || 0) - (b.time || 0));
  for (const entry of all) {
    if (total <= MAX_BYTES) break;
    await cache.delete(entry.url);
    await idbDelete(entry.url);
    total -= entry.size || 0;
  }
}

// 记录/刷新条目（访问时间与大小）
async function touchEntry(url, size) {
  const now = Date.now();
  const old = (await idbGet(url)) || { url, size: 0, time: 0, meta: {} };
  const record = {
    url,
    size: typeof size === 'number' ? size : old.size,
    time: now,
    meta: old.meta || {},
  };
  await idbPut(record);
}

// 工具：是否媒体/HLS 请求（交给 hls-cache.js，SW 不缓存）
function isMediaRequest(req) {
  const url = new URL(req.url);
  const p = url.pathname.toLowerCase();
  if (p.endsWith('.m3u8') || p.endsWith('.ts') || p.endsWith('.mp4') || p.endsWith('.m4s')) return true;
  return req.destination === 'video' || req.destination === 'audio';
}

// 工具：是否 API 请求（按你的后端代理前缀）
function isApiRequest(req) {
  const url = new URL(req.url);
  return url.pathname.startsWith('/proxy/');
}

// 工具：是否静态资源（常见扩展名）
function isStaticAsset(req) {
  const url = new URL(req.url);
  const p = url.pathname.toLowerCase();
  return /\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|webp|ico)$/.test(p);
}

// 逐个预缓存（忽略失败项，避免整个 install 失败）
async function precacheSafe() {
  const cache = await caches.open(PRECACHE);
  for (const path of PRECACHE_URLS) {
    try {
      const req = new Request(path, { cache: 'reload' });
      const resp = await fetch(req);
      if (resp.ok) {
        await cache.put(req, resp.clone());
      } else {
        console.warn('[SW] precache skip', path, resp.status);
      }
    } catch (e) {
      console.warn('[SW] precache fail', path, e);
    }
  }
}

// 注册与激活
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precacheSafe());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => ![PRECACHE, RUNTIME].includes(n)).map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// 运行时请求拦截
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;
  if (isMediaRequest(req)) return; // 媒体交给 hls-cache.js

  if (req.destination === 'document' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  if (isStaticAsset(req)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // api先注释了 不使用缓存
  // if (isApiRequest(req)) {
  //   event.respondWith(apiWithTTL(req));
  //   return;
  // }

  event.respondWith(networkFirst(req));
});

/**
 * cacheFirst (缓存优先)

策略：对于匹配的请求（主要是静态资源，如 JS、CSS、图片字体等），首先尝试从缓存中返回响应。如果缓存命中，则在后台发起网络请求更新缓存（fetchAndUpdateCache）。如果缓存未命中，则直接请求网络，并将成功的响应放入缓存。

适用场景：不会频繁变化的静态资源。优先从缓存读取可以极大提升加载速度，后台更新确保了用户下次访问时能获取到最新版本。
 */
async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) {
    touchEntry(new URL(request.url).href);
    fetchAndUpdateCache(request, cache).catch(() => { });
    return cached;
  }
  try {
    const resp = await fetch(request);
    if (isCacheableResponse(resp)) {
      const size = await getResponseSize(resp);
      await cache.put(request, resp.clone());
      await touchEntry(new URL(request.url).href, size);
      await enforceLRU(cache);
    }
    return resp;
  } catch (e) {
    const fallback = await caches.match(request);
    return fallback || new Response('Offline', { status: 503 });
  }
}


/**
 * networkFirst (网络优先)

策略：对于匹配的请求（主要是 HTML 文档和其他未明确分类的请求），首先尝试从网络获取最新响应。如果网络请求成功，则用新响应更新缓存。如果网络请求完全失败（例如用户离线），则回退到查找缓存中的旧版本。

适用场景：需要优先获取最新内容的资源，如 HTML 页面、动态数据。它保证了在线时用户总能拿到最新内容，离线时又能有兜底方案。
 */
async function networkFirst(request) {
  const cache = await caches.open(RUNTIME);
  try {
    const resp = await fetch(request);
    if (isCacheableResponse(resp)) {
      const size = await getResponseSize(resp);
      await cache.put(request, resp.clone());
      await touchEntry(new URL(request.url).href, size);
      await enforceLRU(cache);
    }
    return resp;
  } catch (e) {
    const cached = await cache.match(request, { ignoreVary: true }) || await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}


/**
 * apiWithTTL (带过期时间的 API 缓存)

策略：这是对 networkFirst 策略的增强，专门用于处理 API 请求。

它首先检查缓存中是否有该 API 的响应。

如果有，它会立即在后台发起网络请求以更新缓存（fetchAndUpdateCache），同时检查缓存元数据中的 cachedAt 时间戳。

如果缓存未过期（Date.now() - cachedAt < API_TTL_MS），则立即返回缓存的旧数据。如果已过期，则等待网络请求的新结果。

如果缓存中没有，则直接请求网络，成功后将响应和当前时间戳 cachedAt 一起存入缓存。

适用场景：后端 API 接口。TTL（生存时间）机制确保了缓存的数据不会过于陈旧（最多5分钟），同时“后台更新+立即返回旧数据”的模式（也称为“Stale-While-Revalidate”）既保证了页面的快速响应（直接显示上次的数据），又能在后台静默更新数据。
 */
async function apiWithTTL(request) {
  const cache = await caches.open(RUNTIME);
  const key = new URL(request.url).href;
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) {
    const meta = await idbGet(key);
    const fresh = meta && meta.meta && meta.meta.cachedAt && (Date.now() - meta.meta.cachedAt < API_TTL_MS);
    fetchAndUpdateCache(request, cache, { recordMeta: true }).catch(() => { });
    if (fresh) {
      touchEntry(key);
      return cached;
    }
    touchEntry(key);
    return cached;
  }
  try {
    const resp = await fetch(request);
    if (isCacheableResponse(resp)) {
      const size = await getResponseSize(resp);
      const clone = resp.clone();
      await cache.put(request, clone);
      await touchEntry(key, size);
      const meta = (await idbGet(key)) || { url: key, size, time: Date.now(), meta: {} };
      meta.meta.cachedAt = Date.now();
      await idbPut(meta);
      await enforceLRU(cache);
    }
    return resp;
  } catch (e) {
    const fallback = await cache.match(request, { ignoreVary: true });
    return fallback || new Response('Offline', { status: 503 });
  }
}

async function fetchAndUpdateCache(request, cache, { recordMeta = false } = {}) {
  const resp = await fetch(request);
  if (isCacheableResponse(resp)) {
    const size = await getResponseSize(resp);
    await cache.put(request, resp.clone());
    const key = new URL(request.url).href;
    await touchEntry(key, size);
    if (recordMeta) {
      const meta = (await idbGet(key)) || { url: key, size, time: Date.now(), meta: {} };
      meta.meta.cachedAt = Date.now();
      await idbPut(meta);
    }
    await enforceLRU(cache);
  }
}

function isCacheableResponse(resp) {
  if (!resp || resp.status !== 200) return false;
  const cc = resp.headers.get('cache-control') || '';
  if (/no-store|no-cache/i.test(cc)) return false;
  return true;
}

self.addEventListener('message', (event) => {
  const { type } = event.data || {};
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'PURGE_CACHE') {
    event.waitUntil((async () => {
      const cache = await caches.open(RUNTIME);
      const keys = await cache.keys();
      await Promise.all(keys.map((req) => cache.delete(req)));
      const all = await idbAll();
      await Promise.all(all.map((x) => idbDelete(x.url)));
    })());
  }
});