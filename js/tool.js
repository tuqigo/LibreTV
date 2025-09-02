async function syncConfig(needShowToast = false) {
    const key = 'viewingHistory';

    try {
        // 1. 获取用户信息并拉取远程配置 - 使用业界标准API调用
        const user = window.AuthSystem.getCurrentUser();
        if (!user) {
            if (needShowToast) {
                showToast('请先登录以同步播放历史！', 'warning');
            }
            return;
        }
        
        let remoteList = [];
        
        // 获取用户的观看历史
        try {
            const historyResponse = await window.AuthSystem.apiRequest(`/proxy/api/viewing-history/operation?key=${encodeURIComponent(user.username)}_viewingHistory`, {
                method: 'GET'
            });
            
            if (historyResponse.status === 404) {
                // 新用户，没有远程数据
                remoteList = [];
            } else {
                const historyData = await historyResponse.json();
                remoteList = historyData.data ? JSON.parse(historyData.data) : [];
                if (!Array.isArray(remoteList)) remoteList = [];
            }
        } catch (e) {
            console.warn('拉取远程 viewingHistory 失败，采用空列表：', e);
            remoteList = [];
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
        
        // 本地不为空，才需要写远程
        if (localList.length > 0) {
            await window.AuthSystem.apiRequest(`/proxy/api/viewing-history/operation?key=${encodeURIComponent(user.username)}_viewingHistory`, {
                method: 'POST',
                body: JSON.stringify(merged)
            });
        }

        loadViewingHistory(); // 重新加载历史记录

        if (needShowToast) {
            showToast(`${user.username} 的历史播放记录已同步`, 'success');
        }
        
    } catch (error) {
        // 统一的错误处理
        if (error instanceof AuthError) {
            if (needShowToast) {
                showToast('请先登录以同步播放历史！', 'warning');
            }
            return;
        }
        
        if (error instanceof ApiError) {
            console.error('同步配置失败:', error.message);
            if (needShowToast) {
                showToast('同步失败: ' + error.message, 'error');
            }
        } else if (error instanceof NetworkError) {
            console.error('网络错误:', error.message);
            if (needShowToast) {
                showToast('网络错误，请稍后重试', 'error');
            }
        } else {
            console.error('同步配置失败:', error);
            if (needShowToast) {
                showToast('同步失败，请稍后重试', 'error');
            }
        }
    }
}
