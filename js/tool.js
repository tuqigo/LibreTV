async function syncConfig(needShowToast = false) {
    const key = 'viewingHistory';
    const appTuqiConfigName = localStorage.getItem('appTuqiConfigName')
    if (!appTuqiConfigName) {
        if (needShowToast) {
            showToast(`请先设置配置标识！`, 'warning');
        }
        return
    }
    const baseURL = encodeURIComponent(`https://api.092201.xyz/my-db/viewingHistory/operation?key=${appTuqiConfigName}_viewingHistory`);
    // 1. 拉取远程配置
    let remoteList = [];
    try {
        const res = await fetch(PROXY_URL + baseURL);
        if (!res.ok) throw new Error(`GET ${res.status}`);
        remoteList = await res.json();
        if (!Array.isArray(remoteList)) remoteList = [];
    } catch (e) {
        console.warn('拉取远程 viewingHistory 失败，采用空列表：', e);
    }

    // 2. 读取本地配置
    let localList = [];
    try {
        localList = JSON.parse(localStorage.getItem(key) || '[]');
        if (!Array.isArray(localList)) localList = [];
    } catch {
        localList = [];
    }

    // 3. 合并去重：先比 episodeIndex，大的保留；若相同再比 playbackPosition
    let map = new Map();

    function ingest(list) {
        list.forEach(item => {
            const id = `${item.title}||${item.sourceName}`;
            const prev = map.get(id);
            if (!prev) {
                map.set(id, item);
            } else {
                // 先比较 episodeIndex
                const curEp = item.episodeIndex || 0;
                const prevEp = prev.episodeIndex || 0;
                if (curEp > prevEp) {
                    map.set(id, item);
                } else if (curEp === prevEp) {
                    // 再比较 playbackPosition
                    const curPos = item.playbackPosition || 0;
                    const prevPos = prev.playbackPosition || 0;
                    if (curPos > prevPos) {
                        map.set(id, item);
                    }
                }
            }
        });
    }

    ingest(remoteList);
    ingest(localList);
    // 4. 按 timestamp 降序
    let merged = Array.from(map.values())
        .sort((a, b) => b.timestamp - a.timestamp);

    // 👉 加入这段代码：过滤 deleteHistoryItems 中的 URL
    try {
        let deletedUrls = JSON.parse(localStorage.getItem('deleteHistoryItems') || '[]');
        if (Array.isArray(deletedUrls) && deletedUrls.length > 0) {
            merged = merged.filter(item => !deletedUrls.includes(item.url));
        }
        localStorage.removeItem('deleteHistoryItems');
    } catch (e) {
        console.warn('读取 deleteHistoryItems 失败：', e);
    }

    // 4. 写回本地和远程
    localStorage.setItem(key, JSON.stringify(merged));
    try {
        await fetch(PROXY_URL + baseURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(merged),
        });
    } catch (e) {
        console.error('同步远程 viewingHistory 失败：', e);
    }

    loadViewingHistory(); // 重新加载历史记录

    if (needShowToast) {
        showToast(`${appTuqiConfigName} 的历史播放记录已同步`, 'success');
        // showToast('配置文件同步成功，3 秒后自动刷新本页面。', 'success');
        // 5. 刷新页面
        // setTimeout(() => {
        //     window.location.reload();
        // }, 3000);
    }
}
