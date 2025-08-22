/*
 HLS 分片本地缓存与并发预取
 - IndexedDB 固定容量 LRU（默认 500MB）+ TTL 过期
 - 自定义 Loader：分片命中缓存直接返回；未命中则网络获取并写入缓存
 - 预取器：基于 Hls 事件按窗口并发预取后续分片
 - 兼容 Chrome/Safari；超出配额或异常时自动降级为内存缓存
*/

(function(){
    const DEFAULT_DB_NAME = 'libretv-hls-cache';
    const DEFAULT_STORE = 'segments';
    const DEFAULT_MAX_BYTES = (window.HLS_CACHE_CONFIG && window.HLS_CACHE_CONFIG.maxBytes) || (200 * 1024 * 1024);
    const DEFAULT_TTL_MS = (window.HLS_CACHE_CONFIG && window.HLS_CACHE_CONFIG.ttlMs) || (6 * 60 * 60 * 1000);

    function nowTs(){ return Date.now(); }

    function openIdb(dbName) {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) {
                return reject(new Error('IndexedDB 不可用'));
            }
            const req = indexedDB.open(dbName, 1);
            req.onupgradeneeded = function(e){
                const db = e.target.result;
                if (!db.objectStoreNames.contains(DEFAULT_STORE)) {
                    const store = db.createObjectStore(DEFAULT_STORE, { keyPath: 'key' });
                    store.createIndex('lastAccess', 'lastAccess', { unique: false });
                    store.createIndex('expiresAt', 'expiresAt', { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('打开 IndexedDB 失败'));
        });
    }

    async function digestSha256Hex(str) {
        try {
            if (window._jsSha256) return window._jsSha256(str);
        } catch(_) {}
        // fallback to SubtleCrypto
        const enc = new TextEncoder();
        const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
        const arr = Array.from(new Uint8Array(buf));
        return arr.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    class InMemoryCache {
        constructor(maxBytes){
            this.maxBytes = maxBytes;
            this.map = new Map(); // key -> { data:ArrayBuffer, size:number, lastAccess:number, expiresAt:number }
            this.total = 0;
        }
        async get(key) {
            const item = this.map.get(key);
            if (!item) return null;
            if (item.expiresAt && item.expiresAt < nowTs()) {
                this.total -= item.size;
                this.map.delete(key);
                return null;
            }
            item.lastAccess = nowTs();
            return item.data;
        }
        async set(key, data, ttlMs) {
            const size = data.byteLength || (data.size || 0);
            if (this.map.has(key)) {
                const old = this.map.get(key);
                this.total -= old.size;
            }
            const obj = { data, size, lastAccess: nowTs(), expiresAt: ttlMs ? nowTs() + ttlMs : 0 };
            this.map.set(key, obj);
            this.total += size;
            await this.evictIfNeeded();
        }
        async evictIfNeeded(){
            // LRU 删除
            while (this.total > this.maxBytes && this.map.size > 0) {
                let oldestKey = null, oldestTs = Infinity;
                for (const [k, v] of this.map) {
                    if (v.lastAccess < oldestTs) { oldestTs = v.lastAccess; oldestKey = k; }
                }
                if (oldestKey) {
                    const it = this.map.get(oldestKey);
                    this.total -= it.size;
                    this.map.delete(oldestKey);
                } else break;
            }
        }
        async countItems(){ return this.map.size; }
        async clearAll(){ this.map.clear(); this.total = 0; }
        async getStats(ttlMs){
            return {
                backend: 'memory',
                totalBytes: this.total,
                items: this.map.size,
                maxBytes: this.maxBytes,
                ttlMs: ttlMs
            };
        }
    }

    class IdbCache {
        constructor(options){
            this.dbName = options.dbName || DEFAULT_DB_NAME;
            this.maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
            this.ttlMs = options.ttlMs || DEFAULT_TTL_MS;
            this.dbp = openIdb(this.dbName);
        }
        async _db(){ return this.dbp; }
        async getTotalBytes(){
            const db = await this._db();
            return new Promise((resolve) => {
                const tx = db.transaction(DEFAULT_STORE, 'readonly');
                const store = tx.objectStore(DEFAULT_STORE);
                const req = store.getAll();
                req.onsuccess = () => {
                    const list = req.result || [];
                    resolve(list.reduce((sum, x) => sum + (x.size || 0), 0));
                };
                req.onerror = () => resolve(0);
            });
        }
        async get(key){
            try {
                const db = await this._db();
                return await new Promise((resolve) => {
                    const tx = db.transaction(DEFAULT_STORE, 'readwrite');
                    const store = tx.objectStore(DEFAULT_STORE);
                    const req = store.get(key);
                    req.onsuccess = () => {
                        const val = req.result;
                        if (!val) return resolve(null);
                        if (val.expiresAt && val.expiresAt < nowTs()) {
                            store.delete(key);
                            return resolve(null);
                        }
                        val.lastAccess = nowTs();
                        store.put(val);
                        resolve(val.data);
                    };
                    req.onerror = () => resolve(null);
                });
            } catch(_) { return null; }
        }
        async set(key, data, ttlMs){
            try {
                const db = await this._db();
                const size = data.byteLength || (data.size || 0);
                const rec = { key, data, size, lastAccess: nowTs(), expiresAt: ttlMs ? nowTs() + ttlMs : 0 };
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(DEFAULT_STORE, 'readwrite');
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                    const store = tx.objectStore(DEFAULT_STORE);
                    store.put(rec);
                });
                await this._evictIfNeeded();
            } catch(e) {
                // 可能是配额问题，忽略
            }
        }
        async _evictIfNeeded(){
            const total = await this.getTotalBytes();
            if (total <= this.maxBytes) return;
            const db = await this._db();
            await new Promise((resolve) => {
                const tx = db.transaction(DEFAULT_STORE, 'readwrite');
                const store = tx.objectStore(DEFAULT_STORE);
                const idx = store.index('lastAccess');
                const cursorReq = idx.openCursor();
                let bytes = total;
                cursorReq.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (!cursor) { resolve(); return; }
                    const val = cursor.value;
                    bytes -= (val.size || 0);
                    store.delete(cursor.primaryKey);
                    if (bytes <= this.maxBytes) { resolve(); return; }
                    cursor.continue();
                };
                cursorReq.onerror = () => resolve();
            });
        }
        async countItems(){
            try {
                const db = await this._db();
                return await new Promise((resolve) => {
                    const tx = db.transaction(DEFAULT_STORE, 'readonly');
                    const store = tx.objectStore(DEFAULT_STORE);
                    const req = store.count();
                    req.onsuccess = () => resolve(req.result || 0);
                    req.onerror = () => resolve(0);
                });
            } catch(_) { return 0; }
        }
        async clearAll(){
            try {
                const db = await this._db();
                await new Promise((resolve) => {
                    const tx = db.transaction(DEFAULT_STORE, 'readwrite');
                    const store = tx.objectStore(DEFAULT_STORE);
                    const req = store.clear();
                    req.onsuccess = () => resolve();
                    req.onerror = () => resolve();
                });
            } catch(_) {}
        }
        async getStats(){
            const [totalBytes, items] = await Promise.all([this.getTotalBytes(), this.countItems()]);
            return {
                backend: 'indexeddb',
                totalBytes,
                items,
                maxBytes: this.maxBytes,
                ttlMs: this.ttlMs
            };
        }
    }

    class HlsSegmentCache {
        constructor(options){
            this.maxBytes = options?.maxBytes || DEFAULT_MAX_BYTES;
            this.ttlMs = options?.ttlMs || DEFAULT_TTL_MS;
            this._backend = null;
            try {
                this._backend = new IdbCache({ maxBytes: this.maxBytes, ttlMs: this.ttlMs });
            } catch(_) {
                this._backend = new InMemoryCache(this.maxBytes);
            }
        }
        async keyForUrl(url){ return 'seg_' + await digestSha256Hex(url); }
        async getByUrl(url){
            const key = await this.keyForUrl(url);
            return await this._backend.get(key);
        }
        async putByUrl(url, data){
            const key = await this.keyForUrl(url);
            await this._backend.set(key, data, this.ttlMs);
        }
        async getStats(){
            if (this._backend.getStats) return await this._backend.getStats(this.ttlMs);
            return { backend: 'unknown', totalBytes: 0, items: 0, maxBytes: this.maxBytes, ttlMs: this.ttlMs };
        }
        async clearAll(){ if (this._backend.clearAll) return this._backend.clearAll(); }
    }

    function toArrayBuffer(data) {
        if (data instanceof ArrayBuffer) return data;
        if (data instanceof Uint8Array) return data.buffer;
        if (data instanceof Blob) return data.arrayBuffer();
        return data;
    }

    function filterAdsFromM3U8Text(content) {
        if (!content) return content;
        const lines = content.split('\n');
        const out = [];
        let inAd = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const t = line.trim();
            if (t.startsWith('#EXT-X-CUE-OUT') || (t.startsWith('#EXT-X-DATERANGE') && /CLASS="?ad/i.test(t))) {
                inAd = true; out.push('#EXT-X-DISCONTINUITY'); continue;
            }
            if (t.startsWith('#EXT-X-CUE-IN')) { inAd = false; out.push('#EXT-X-DISCONTINUITY'); continue; }
            if (inAd) {
                if (t.startsWith('#')) { continue; }
                else { continue; }
            }
            out.push(line);
        }
        return out.join('\n');
    }

    class HybridHlsJsLoader extends (window.Hls ? window.Hls.DefaultConfig.loader : class {}) {
        constructor(config) {
            super(config);
            this._inner = new (window.Hls ? window.Hls.DefaultConfig.loader : class {})(config);
            this._cache = window.__hlsSegmentCache || new HlsSegmentCache({});
            this._adFilterEnabled = !!config?.adFilterEnabled;
        }
        destroy() { if (this._inner && this._inner.destroy) this._inner.destroy(); }
        abort(context) { if (this._inner && this._inner.abort) this._inner.abort(context); }
        async load(context, config, callbacks) {
            const type = context?.type;
            const url = context?.url;
            if (!url) { return this._inner.load(context, config, callbacks); }

            // 处理 m3u8 文本：按需过滤广告标签
            if (type === 'manifest' || type === 'level') {
                const onSuccess = callbacks.onSuccess;
                callbacks.onSuccess = (response, stats, ctx) => {
                    try {
                        if (this._adFilterEnabled && response && typeof response.data === 'string') {
                            response.data = filterAdsFromM3U8Text(response.data);
                        }
                    } catch(_) {}
                    onSuccess && onSuccess(response, stats, ctx);
                };
                return this._inner.load(context, config, callbacks);
            }

            // 分片缓存：fragment/initSegment
            if (type === 'fragment' || type === 'initSegment') {
                try {
                    const cached = await this._cache.getByUrl(url);
                    if (cached) {
                        const ab = await toArrayBuffer(cached);
                        const fakeStats = { trequest: nowTs(), tfirst: nowTs(), tload: nowTs(), loaded: ab.byteLength, total: ab.byteLength }; 
                        callbacks.onSuccess && callbacks.onSuccess({ data: ab, url }, fakeStats, context);
                        return;
                    }
                } catch(_) {}

                const onSuccess = callbacks.onSuccess;
                callbacks.onSuccess = async (response, stats, ctx) => {
                    try {
                        const ab = await toArrayBuffer(response.data);
                        // 存入缓存（异步，不阻塞）
                        this._cache.putByUrl(url, ab).catch(()=>{});
                        response.data = ab;
                    } catch(_) {}
                    onSuccess && onSuccess(response, stats, ctx);
                };
                return this._inner.load(context, config, callbacks);
            }

            return this._inner.load(context, config, callbacks);
        }
    }

    class HlsSegmentPrefetcher {
        constructor(hls, cache, options){
            this.hls = hls;
            this.cache = cache;
            this.concurrent = Math.max(1, Math.min(8, options?.concurrent || 4));
            this.windowSize = Math.max(2, Math.min(30, options?.windowSize || 8));
            this.queue = new Set();
            this.running = 0;
            this.levelDetails = null;
            this.currentSn = null;
            this.controller = new AbortController();
            this._bind();
            this._recentDurations = []; // 近 N 片下载耗时
            this._adjustTimer = null;
            this._startAutoAdjust();
        }
        _bind(){
            this.hls.on(window.Hls.Events.LEVEL_LOADED, (_, data) => {
                this.levelDetails = data?.details || null;
                this._schedule();
            });
            this.hls.on(window.Hls.Events.FRAG_CHANGED, (_, data) => {
                const frag = data?.frag; if (!frag) return;
                this.currentSn = typeof frag.sn === 'number' ? frag.sn : null;
                this._schedule();
            });
            this.hls.on(window.Hls.Events.DESTROYING, () => {
                this.controller.abort();
                this.queue.clear();
            });
        }
        _schedule(){
            if (!this.levelDetails) return;
            const fragments = this.levelDetails.fragments || [];
            if (!fragments.length) return;
            const currIndex = (this.currentSn != null)
                ? fragments.findIndex(f => f.sn === this.currentSn)
                : 0;
            const start = Math.max(0, currIndex + 1);
            const end = Math.min(fragments.length, start + this.windowSize);
            for (let i = start; i < end; i++) {
                const frag = fragments[i];
                const url = frag?.url || frag?.relurl || null;
                if (!url) continue;
                this._enqueue(url);
            }
            this._drain();
        }
        _enqueue(url){
            this.queue.add(url);
        }
        async _drain(){
            while (this.running < this.concurrent && this.queue.size > 0) {
                const url = this.queue.values().next().value;
                this.queue.delete(url);
                this.running++;
                this._prefetch(url).finally(()=>{ this.running--; this._drain(); });
            }
        }
        async _prefetch(url){
            try {
                const hit = await this.cache.getByUrl(url);
                if (hit) return; // 已缓存
                const t0 = performance.now();
                const resp = await fetch(url, { signal: this.controller.signal, cache: 'no-store' });
                if (!resp.ok) return;
                const buf = await resp.arrayBuffer();
                await this.cache.putByUrl(url, buf);
                const t1 = performance.now();
                this._recentDurations.push(t1 - t0);
                if (this._recentDurations.length > 30) this._recentDurations.shift();
            } catch(_) { /* 忽略预取错误 */ }
        }
        _startAutoAdjust(){
            const adjust = () => {
                if (this._recentDurations.length >= 5) {
                    const avg = this._recentDurations.reduce((a,b)=>a+b,0)/this._recentDurations.length;
                    // 粗略根据耗时调整预取并发/窗口：慢则降并发，小幅扩大窗口；快则升并发
                    if (avg > 4000) {
                        this.concurrent = Math.max(3, this.concurrent - 1);
                        this.windowSize = Math.max(3, this.windowSize - 1); // <--收缩窗口
                    } else if (avg < 1500) {
                        this.concurrent = Math.min(10, this.concurrent + 1);
                        this.windowSize = Math.min(30, this.windowSize + 1);
                    }
                    // 清空历史，下一轮重新评估
                    this._recentDurations.length = 0;
                }
                this._adjustTimer = setTimeout(adjust, 5000);
            };
            this._adjustTimer = setTimeout(adjust, 5000);
        }
        getStats(){
            return {
                queueSize: this.queue.size,
                running: this.running,
                windowSize: this.windowSize,
                concurrent: this.concurrent
            };
        }
    }

    // 暴露到全局
    window.HlsSegmentCache = HlsSegmentCache;
    window.HybridHlsJsLoader = HybridHlsJsLoader;
    window.HlsSegmentPrefetcher = HlsSegmentPrefetcher;

})();


