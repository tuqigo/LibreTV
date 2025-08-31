
// 创建全局环境变量对象
window.__ENV__ = window.__ENV__ || {};

// 注入服务器端环境变量 (将由服务器端替换)
// PASSWORD 变量将在这里被服务器端注入
window.__ENV__.PASSWORD = "{{PASSWORD}}";

// =================================
// ============== PLAYER ==========
// =================================
// 全局变量
let currentVideoTitle = '';
let currentEpisodeIndex = 0;
let currentEpisodes = [];
let episodesReversed = false;
let dp = null;
let currentHls = null; // 跟踪当前HLS实例
// 自动连播功能已移除，默认始终为true
let episodesGridVisible = true; // 默认显示集数网格
let isUserSeeking = false; // 跟踪用户是否正在拖动进度条
let videoHasEnded = false; // 跟踪视频是否已经自然结束
let userClickedPosition = null; // 记录用户点击的位置
let shortcutHintTimeout = null; // 用于控制快捷键提示显示时间
let adFilteringEnabled = true; // 默认开启广告过滤
let progressSaveInterval = null; // 定期保存进度的计时器
// 初始化全局分片缓存（统一从 HLS_CACHE_CONFIG 读取）
window.__hlsSegmentCache = window.__hlsSegmentCache || (window.HlsSegmentCache ? new window.HlsSegmentCache({ maxBytes: (window.HLS_CACHE_CONFIG && window.HLS_CACHE_CONFIG.maxBytes) || undefined, ttlMs: (window.HLS_CACHE_CONFIG && window.HLS_CACHE_CONFIG.ttlMs) || undefined }) : null);

// 收藏相关变量
let currentVideoInfo = null; // 当前视频信息
let isCurrentVideoFavorited = false; // 当前视频是否已收藏


// 监听认证成功事件
document.addEventListener('authVerified', () => {
    document.getElementById('loading').style.display = 'block';
    initializePageContent();
});

// 页面加载完成后检查认证状态
document.addEventListener('DOMContentLoaded', async function () {
    // 检查认证状态
    if (window.AuthSystem) {
        try {
            const isAuthenticated = await window.AuthSystem.isUserAuthenticated();
            if (isAuthenticated) {
                // 用户已认证，直接初始化页面
                console.log('用户已认证，初始化页面');
                initializePageContent();
            } else {
                // 用户未认证，检查当前页面类型
                const currentPath = window.location.pathname;
                if (currentPath.includes('auth.html')) {
                    // 如果当前在认证页面，不需要跳转
                    console.log('当前在认证页面，等待用户认证');
                } else {
                    // 用户未认证且不在认证页面，显示认证弹框
                    console.log('用户未认证，跳转到认证页面');
                    window.AuthSystem.showAuthModal();
                }
            }
        } catch (error) {
            console.error('认证检查失败:', error);
            // 如果认证检查出错，跳转到认证页面
            window.AuthSystem.showAuthModal();
        }
    } else {
        console.error('认证系统未加载');
        // 如果认证系统未加载，显示错误
        showError('认证系统未加载，请刷新页面重试');
    }
});

// 初始化页面内容
function initializePageContent() {
    // 解析URL参数
    const urlParams = new URLSearchParams(window.location.search);
    const videoUrl = urlParams.get('url');
    const title = urlParams.get('title');
    const sourceCode = urlParams.get('source_code');
    let index = parseInt(urlParams.get('index') || '0');
    const episodesList = urlParams.get('episodes'); // 新增：从URL获取集数信息
    const vodId = urlParams.get('vod_id'); // 新增：从URL获取vod_id

    // 从localStorage获取数据
    currentVideoTitle = title || localStorage.getItem('currentVideoTitle') || '未知视频';
    currentEpisodeIndex = index;

    // 自动连播功能已移除，不再需要更新按钮状态

    // 获取广告过滤设置
    adFilteringEnabled = localStorage.getItem('adFilteringEnabled') !== 'false'; // 默认为true

    // 使用内存中的默认值，不再从localStorage读取
    updateEpisodesToggleButton(episodesGridVisible);

    // 优先使用URL传递的集数信息，否则从localStorage获取
    try {
        if (episodesList) {
            // 如果URL中有集数数据，优先使用它
            currentEpisodes = JSON.parse(decodeURIComponent(episodesList));
            console.log('从URL恢复集数信息:', currentEpisodes.length);
        } else {
            // 否则从localStorage获取
            currentEpisodes = JSON.parse(localStorage.getItem('currentEpisodes') || '[]');
            console.log('从localStorage恢复集数信息:', currentEpisodes.length);
        }

        // 检查集数索引是否有效，如果无效则调整为0
        if (index < 0 || (currentEpisodes.length > 0 && index >= currentEpisodes.length)) {
            console.warn(`无效的剧集索引 ${index}，调整为范围内的值`);

            // 如果索引太大，则使用最大有效索引
            if (index >= currentEpisodes.length && currentEpisodes.length > 0) {
                index = currentEpisodes.length - 1;
            } else {
                index = 0;
            }

            // 更新URL以反映修正后的索引
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('index', index);
            window.history.replaceState({}, '', newUrl);
        }

        // 更新当前索引为验证过的值
        currentEpisodeIndex = index;

        // 默认使用正序排列
        episodesReversed = false;
    } catch (e) {
        console.error('获取集数信息失败:', e);
        currentEpisodes = [];
        currentEpisodeIndex = 0;
        episodesReversed = false;
    }

    // 设置页面标题
    document.title = currentVideoTitle + ' - LibreTV播放器';
    document.getElementById('videoTitle').textContent = currentVideoTitle;

    // 构建当前视频信息用于收藏功能
    const sourceName = urlParams.get('source') || '';
    currentVideoInfo = {
        vod_id: vodId || '',
        source_code: sourceCode || '',
        vod_name: currentVideoTitle,
        vod_pic: '', // 播放页面暂时不需要封面
        type_name: '', // 暂时不获取类型
        vod_year: '', // 暂时不获取年份
        source_name: sourceName
    };

    // 检查当前视频是否已被收藏
    checkCurrentVideoFavoriteStatus();

    // 初始化播放器
    if (videoUrl) {
        initPlayer(videoUrl, sourceCode);

        // 尝试从URL参数中恢复播放位置
        const position = urlParams.get('position');
        if (position) {
            setTimeout(() => {
                if (dp && dp.video) {
                    const positionNum = parseInt(position);
                    if (!isNaN(positionNum) && positionNum > 0) {
                        dp.seek(positionNum);
                        showPositionRestoreHint(positionNum);
                    }
                }
            }, 1500);
        }
    } else {
        showError('无效的视频链接');
    }

    // 更新集数信息
    updateEpisodeInfo();

    // 渲染集数列表
    renderEpisodes();

    // 更新按钮状态
    updateButtonStates();

    // 更新排序箭头状态
    const episodesToggle = document.getElementById('episodesToggle');
    if (episodesToggle) {
        const orderArrow = episodesToggle.querySelector('.episode-order-arrow');
        updateOrderArrow(orderArrow);
    }

    // 控制单集视频时的UI显示
    toggleSingleEpisodeUI();

    // 添加对进度条的监听，确保点击准确跳转
    setTimeout(() => {
        setupProgressBarPreciseClicks();
    }, 1000);

    // 添加键盘快捷键事件监听
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // 添加页面离开事件监听，保存播放位置
    window.addEventListener('beforeunload', saveCurrentProgress);

    // 新增：页面隐藏（切后台/切标签）时也保存
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
            saveCurrentProgress();
        }
    });

    // 新增：视频暂停时也保存
    // 需确保 dp.video 已初始化
    const waitForVideo = setInterval(() => {
        if (dp && dp.video) {
            dp.video.addEventListener('pause', saveCurrentProgress);

            // 新增：播放进度变化时节流保存
            let lastSave = 0;
            dp.video.addEventListener('timeupdate', function () {
                const now = Date.now();
                if (now - lastSave > 5000) { // 每5秒最多保存一次
                    saveCurrentProgress();
                    lastSave = now;
                }
            });

            clearInterval(waitForVideo);
        }
    }, 200);

    // 添加超时清理
    setTimeout(() => {
        clearInterval(waitForVideo);
    }, 10000); // 10秒后无论如何都清理
}

// 处理键盘快捷键
function handleKeyboardShortcuts(e) {
    // 忽略输入框中的按键事件
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // 如果只有一集，禁用快捷键
    if (currentEpisodes.length <= 1) return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
        if (currentEpisodeIndex > 0) {
            playPreviousEpisode();
            showShortcutHint('上一集', 'left');
            e.preventDefault();
        }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
        if (currentEpisodeIndex < currentEpisodes.length - 1) {
            playNextEpisode();
            showShortcutHint('下一集', 'right');
            e.preventDefault();
        }
    }
}

// 显示快捷键提示
function showShortcutHint(text, direction) {
    const hintElement = document.getElementById('shortcutHint');
    const textElement = document.getElementById('shortcutText');
    const iconElement = document.getElementById('shortcutIcon');

    // 清除之前的超时
    if (shortcutHintTimeout) {
        clearTimeout(shortcutHintTimeout);
    }

    // 设置文本和图标方向
    textElement.textContent = text;

    if (direction === 'left') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>';
    } else {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>';
    }

    // 显示提示
    hintElement.classList.add('show');

    // 两秒后隐藏
    shortcutHintTimeout = setTimeout(() => {
        hintElement.classList.remove('show');
    }, 2000);
}

// 初始化播放器
function initPlayer(videoUrl, sourceCode) {
    if (!videoUrl) return;
    if (dp) {
        dp.destroy();
    }

    // 配置HLS.js选项
    const hlsConfig = {
        debug: false,
        loader: (window.HybridHlsJsLoader ? window.HybridHlsJsLoader : Hls.DefaultConfig.loader),
        adFilterEnabled: adFilteringEnabled,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        maxBufferLength: 90,
        maxMaxBufferLength: 120,
        maxBufferSize: 100 * 1000 * 1000,
        maxBufferHole: 0.5,
        fragLoadingMaxRetry: 6,
        fragLoadingMaxRetryTimeout: 64000,
        fragLoadingRetryDelay: 1000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        startLevel: -1,
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.95,
        abrBandWidthUpFactor: 0.7,
        abrMaxWithRealBitrate: true,
        stretchShortVideoTrack: true,
        appendErrorMaxRetry: 5,  // 增加尝试次数
        liveSyncDurationCount: 3,
        liveDurationInfinity: false
    };

    // 创建DPlayer实例
    dp = new DPlayer({
        container: document.getElementById('player'),
        autoplay: true,
        theme: '#00ccff',
        preload: 'auto',
        loop: false,
        lang: 'zh-cn',
        hotkey: true,        // 启用键盘控制，包括空格暂停/播放、方向键控制进度和音量
        mutex: true,
        volume: 0.7,
        screenshot: false,               // 禁用截图功能
        preventClickToggle: false,       // 允许点击视频切换播放/暂停
        airplay: false,                  // 禁用AirPlay功能
        chromecast: false,               // 禁用Chromecast投屏功能
        contextmenu: [                   // 自定义右键菜单
            {
                text: '关于 LibreTV',
                link: 'https://github.com/bestzwei/LibreTV'
            },
            {
                text: '问题反馈',
                click: (player) => {
                    window.open('https://github.com/bestzwei/LibreTV/issues', '_blank');
                }
            }
        ],
        video: {
            url: videoUrl,
            type: 'hls',
            pic: 'image/nomedia.png', // 设置视频封面图
            customType: {
                hls: function (video, player) {

                    // 清理之前的HLS实例
                    if (currentHls && currentHls.destroy) {
                        try {
                            currentHls.destroy();
                        } catch (e) {
                            console.warn('销毁旧HLS实例出错:', e);
                        }
                    }

                    // 创建新的HLS实例
                    const hls = new Hls(hlsConfig);
                    currentHls = hls;

                    // 跟踪是否已经显示错误
                    let errorDisplayed = false;
                    // 跟踪是否有错误发生
                    let errorCount = 0;
                    // 跟踪视频是否开始播放
                    let playbackStarted = false;
                    // 跟踪视频是否出现bufferAppendError
                    let bufferAppendErrorCount = 0;

                    // 监听视频播放事件
                    video.addEventListener('playing', function () {
                        playbackStarted = true;
                        document.getElementById('loading').style.display = 'none';
                        document.getElementById('error').style.display = 'none';
                    });

                    // 监听视频进度事件
                    video.addEventListener('timeupdate', function () {
                        if (video.currentTime > 1) {
                            // 视频进度超过1秒，隐藏错误（如果存在）
                            document.getElementById('error').style.display = 'none';
                        }
                    });

                    hls.loadSource(video.src);
                    hls.attachMedia(video);

                    // 移除 airplay 相关代码，因为已在 DPlayer 配置中禁用
                    // const source = document.createElement('source');
                    // source.src = videoUrl;
                    // video.appendChild(source);
                    // video.disableRemotePlayback = false;

                    hls.on(Hls.Events.MANIFEST_PARSED, function () {
                        video.play().catch(e => {
                            console.warn('自动播放被阻止:', e);
                        });

                        // ===============================
                        // 🔥 默认强制最高码率
                        // ===============================
                        if (hls.levels && hls.levels.length > 0) {
                            const maxLevel = hls.levels.length - 1;
                            hls.currentLevel = maxLevel;   // 👈 切最高
                            hls.autoLevelEnabled = false;  // 👈 禁止自动降级
                            console.log(`已切换最高码率: ${hls.levels[maxLevel].height || '?'}p`);
                        }

                        // 初始化分片预取器
                        try {
                            if (window.HlsSegmentPrefetcher && window.__hlsSegmentCache) {
                                // 默认并发 4，窗口 10 片
                                if (hls.__prefetcher) { /* 复用 */ } else {
                                    hls.__prefetcher = new window.HlsSegmentPrefetcher(hls, window.__hlsSegmentCache, { concurrent: 8, windowSize: 12 });
                                }
                            }
                        } catch (_) { }

                    });

                    hls.on(Hls.Events.ERROR, function (event, data) {
                        console.log('HLS事件:', event, '数据:', data);

                        // 增加错误计数
                        errorCount++;

                        // 处理bufferAppendError
                        if (data.details === 'bufferAppendError') {
                            bufferAppendErrorCount++;
                            console.warn(`bufferAppendError 发生 ${bufferAppendErrorCount} 次`);

                            // 如果视频已经开始播放，则忽略这个错误
                            if (playbackStarted) {
                                console.log('视频已在播放中，忽略bufferAppendError');
                                return;
                            }

                            // 如果出现多次bufferAppendError但视频未播放，尝试恢复
                            if (bufferAppendErrorCount >= 3) {
                                hls.recoverMediaError();
                            }
                        }

                        // 如果是致命错误，且视频未播放
                        if (data.fatal && !playbackStarted) {
                            console.error('致命HLS错误:', data);

                            // 尝试恢复错误
                            switch (data.type) {
                                case Hls.ErrorTypes.NETWORK_ERROR:
                                    console.log("尝试恢复网络错误");
                                    hls.startLoad();
                                    break;
                                case Hls.ErrorTypes.MEDIA_ERROR:
                                    console.log("尝试恢复媒体错误");
                                    hls.recoverMediaError();
                                    break;
                                default:
                                    // 仅在多次恢复尝试后显示错误
                                    if (errorCount > 3 && !errorDisplayed) {
                                        errorDisplayed = true;
                                        showError('视频加载失败，可能是格式不兼容或源不可用');
                                    }
                                    break;
                            }
                        }

                        // 👇 错误恢复逻辑，避免播放卡死
                        if (data.fatal) {
                            switch (data.type) {
                                case Hls.ErrorTypes.NETWORK_ERROR:
                                    hls.startLoad(); // 👈 重新加载
                                    break;
                                case Hls.ErrorTypes.MEDIA_ERROR:
                                    hls.recoverMediaError(); // 👈 恢复媒体错误
                                    break;
                                default:
                                    hls.destroy(); // 👈 彻底销毁
                                    break;
                            }
                        }
                    });

                    // 监听分段加载事件
                    hls.on(Hls.Events.FRAG_LOADED, function () {
                        document.getElementById('loading').style.display = 'none';
                    });

                    // 监听级别加载事件
                    hls.on(Hls.Events.LEVEL_LOADED, function () {
                        document.getElementById('loading').style.display = 'none';
                    });
                }
            }
        }
    });
    // 全屏模式下锁定横屏
    dp.on('fullscreen', () => {
        if (window.screen.orientation && window.screen.orientation.lock) {
            window.screen.orientation.lock('landscape')
                .then(() => {
                    console.log('屏幕已锁定为横向模式');
                })
                .catch((error) => {
                    console.warn('无法锁定屏幕方向，请手动旋转设备:', error);
                });
        } else {
            console.warn('当前浏览器不支持锁定屏幕方向，请手动旋转设备。');
        }
    });

    // 全屏取消时解锁屏幕方向
    dp.on('fullscreen_cancel', () => {
        if (window.screen.orientation && window.screen.orientation.unlock) {
            window.screen.orientation.unlock();
        }
    });

    dp.on('loadedmetadata', function () {
        document.getElementById('loading').style.display = 'none';
        videoHasEnded = false; // 视频加载时重置结束标志

        // 视频加载完成后重新设置进度条点击监听
        setupProgressBarPreciseClicks();

        // 视频加载成功后，在稍微延迟后将其添加到观看历史
        setTimeout(saveToHistory, 3000);

        // 启动定期保存播放进度
        startProgressSaveInterval();
    });

    dp.on('error', function () {
        // 检查视频是否已经在播放
        if (dp.video && dp.video.currentTime > 1) {
            console.log('发生错误，但视频已在播放中，忽略');
            return;
        }
        showError('视频播放失败，请检查视频源或网络连接');
    });

    // 添加移动端长按两倍速播放功能
    setupLongPressSpeedControl();

    // 添加seeking和seeked事件监听器，以检测用户是否在拖动进度条
    dp.on('seeking', function () {
        isUserSeeking = true;
        videoHasEnded = false; // 重置视频结束标志

        // 如果是用户通过点击进度条设置的位置，确保准确跳转
        if (userClickedPosition !== null && dp.video) {
            // 确保用户的点击位置被正确应用，避免自动跳至视频末尾
            const clickedTime = userClickedPosition;

            // 防止跳转到视频结尾
            if (Math.abs(dp.video.duration - clickedTime) < 0.5) {
                // 如果点击的位置非常接近结尾，稍微减少一点时间
                dp.video.currentTime = Math.max(0, clickedTime - 0.5);
            } else {
                dp.video.currentTime = clickedTime;
            }

            // 清除记录的位置
            setTimeout(() => {
                userClickedPosition = null;
            }, 200);
        }
    });

    // 改进seeked事件处理
    dp.on('seeked', function () {
        // 如果视频跳转到了非常接近结尾的位置(小于0.3秒)，且不是自然播放到此处
        if (dp.video && dp.video.duration > 0) {
            const timeFromEnd = dp.video.duration - dp.video.currentTime;
            if (timeFromEnd < 0.3 && isUserSeeking) {
                // 将播放时间往回移动一点点，避免触发结束事件
                dp.video.currentTime = Math.max(0, dp.video.currentTime - 1);
            }
        }

        // 延迟重置seeking标志，以便于区分自然播放结束和用户拖拽
        setTimeout(() => {
            isUserSeeking = false;
        }, 200);
    });

    // 修改视频结束事件监听器，添加额外检查
    dp.on('ended', function () {
        videoHasEnded = true; // 标记视频已自然结束

        // 视频已播放完，清除播放进度记录
        clearVideoProgress();

        // 自动连播功能已移除，默认始终为true，如果有下一集可播放，则自动播放下一集
        if (currentEpisodes.length > 1 && currentEpisodeIndex < currentEpisodes.length - 1) {
            console.log('视频播放结束，自动播放下一集');
            // 稍长延迟以确保所有事件处理完成
            setTimeout(() => {
                // 确认不是因为用户拖拽导致的假结束事件
                if (videoHasEnded && !isUserSeeking) {
                    playNextEpisode();
                    videoHasEnded = false; // 重置标志
                }
            }, 1000);
        } else {
            if (currentEpisodes.length <= 1) {
                console.log('视频播放结束，单集视频无需自动连播');
            } else {
                console.log('视频播放结束，无下一集可播放');
            }
        }
    });

    // 添加事件监听以检测近视频末尾的点击拖动
    dp.on('timeupdate', function () {
        if (dp.video && dp.duration > 0) {
            // 如果视频接近结尾但不是自然播放到结尾，重置自然结束标志
            if (isUserSeeking && dp.video.currentTime > dp.video.duration * 0.95) {
                videoHasEnded = false;
            }
        }
    });

    // 添加双击全屏支持
    dp.on('playing', () => {
        // 绑定双击事件到视频容器
        dp.video.addEventListener('dblclick', () => {
            dp.fullScreen.toggle();
        });
        // 更新暂停/播放按钮图标为暂停状态
        updatePlayPauseIcon(false);
    });

    // 添加暂停事件监听器
    dp.on('pause', () => {
        // 更新暂停/播放按钮图标为播放状态
        updatePlayPauseIcon(true);
    });

    // 10秒后如果仍在加载，但不立即显示错误
    setTimeout(function () {
        // 如果视频已经播放开始，则不显示错误
        if (dp && dp.video && dp.video.currentTime > 0) {
            return;
        }

        if (document.getElementById('loading').style.display !== 'none') {
            document.getElementById('loading').innerHTML = `
                <div class="loading-spinner"></div>
                <div>视频加载时间较长，请耐心等待...</div>
                <div style="font-size: 12px; color: #aaa; margin-top: 10px;">如长时间无响应，请尝试其他视频源</div>
            `;
        }
    }, 10000);

    // 绑定原生全屏：DPlayer 触发全屏时调用 requestFullscreen
    (function () {
        const fsContainer = document.getElementById('playerContainer');
        dp.on('fullscreen', () => {
            if (fsContainer.requestFullscreen) {
                fsContainer.requestFullscreen().catch(err => console.warn('原生全屏失败:', err));
            }
        });
        dp.on('fullscreen_cancel', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            }
        });
    })();
}



// 自定义M3U8 Loader用于过滤广告
class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config) {
        super(config);
        const load = this.load.bind(this);
        this.load = function (context, config, callbacks) {
            // 拦截manifest和level请求
            if (context.type === 'manifest' || context.type === 'level') {
                const onSuccess = callbacks.onSuccess;
                callbacks.onSuccess = function (response, stats, context) {
                    // 如果是m3u8文件，处理内容以移除广告分段
                    if (response.data && typeof response.data === 'string') {
                        // 过滤掉广告段 - 实现更精确的广告过滤逻辑
                        response.data = filterAdsFromM3U8(response.data, true);
                    }
                    return onSuccess(response, stats, context);
                };
            }
            // 执行原始load方法
            load(context, config, callbacks);
        };
    }
}

// M3U8清单广告过滤函数
function filterAdsFromM3U8(m3u8Content, strictMode = false) {
    if (!m3u8Content) return '';

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 只过滤#EXT-X-DISCONTINUITY标识
        if (!line.includes('#EXT-X-DISCONTINUITY')) {
            filteredLines.push(line);
        }
    }

    return filteredLines.join('\n');
}


// 显示错误
function showError(message) {
    // 在视频已经播放的情况下不显示错误
    if (dp && dp.video && dp.video.currentTime > 1) {
        console.log('忽略错误:', message);
        return;
    }

    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'flex';
    document.getElementById('error-message').textContent = message;
}

// 更新集数信息
function updateEpisodeInfo() {
    // 集数导航已移除，此函数保留但不执行任何操作
    // 集数信息现在通过下方的集数网格显示
}

// 更新按钮状态
function updateButtonStates() {
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');

    if (!prevButton || !nextButton) return;

    // 处理上一集按钮
    if (currentEpisodeIndex > 0) {
        prevButton.classList.remove('bg-gray-700', 'cursor-not-allowed');
        prevButton.classList.add('bg-[#222]', 'hover:bg-[#333]');
        prevButton.removeAttribute('disabled');
    } else {
        prevButton.classList.add('bg-gray-700', 'cursor-not-allowed');
        prevButton.classList.remove('bg-[#222]', 'hover:bg-[#333]');
        prevButton.setAttribute('disabled', '');
    }

    // 处理下一集按钮
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        nextButton.classList.remove('bg-gray-700', 'cursor-not-allowed');
        nextButton.classList.add('bg-[#222]', 'hover:bg-[#333]');
        nextButton.removeAttribute('disabled');
    } else {
        nextButton.classList.add('bg-gray-700', 'cursor-not-allowed');
        nextButton.classList.remove('bg-[#222]', 'hover:bg-[#333]');
        prevButton.setAttribute('disabled', '');
    }
}

// 控制单集视频时的UI显示
function toggleSingleEpisodeUI() {
    const isSingleEpisode = currentEpisodes.length <= 1;

    // 获取需要控制的元素
    const episodesToggle = document.getElementById('episodesToggle');
    const orderButton = document.querySelector('button[onclick="toggleEpisodeOrder()"]');
    const episodesGrid = document.getElementById('episodesGrid');
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');
    const lockToggle = document.getElementById('lockToggle');
    const playPauseButton = document.getElementById('playPauseButton');

    if (isSingleEpisode) {
        // 单集视频：隐藏相关元素
        if (episodesToggle) episodesToggle.style.display = 'none';
        if (orderButton) orderButton.style.display = 'none';
        if (episodesGrid) episodesGrid.style.display = 'none';
        if (prevButton) prevButton.style.display = 'none';
        if (nextButton) nextButton.style.display = 'none';
        if (lockToggle) lockToggle.style.display = 'none';
        if (playPauseButton) playPauseButton.style.display = 'none';

        console.log('单集视频，已隐藏剧集相关UI元素');
    } else {
        // 多集视频：显示所有元素
        if (episodesToggle) episodesToggle.style.display = '';
        if (orderButton) orderButton.style.display = '';
        if (episodesGrid) episodesGrid.style.display = '';
        if (prevButton) prevButton.style.display = '';
        if (nextButton) nextButton.style.display = '';

        console.log('多集视频，已显示所有UI元素');
    }
}

// 渲染集数按钮
function renderEpisodes() {
    const episodesList = document.getElementById('episodesList');
    if (!episodesList) return;

    if (!currentEpisodes || currentEpisodes.length === 0) {
        episodesList.innerHTML = '<div class="text-center text-gray-400 py-8">没有可用的集数</div>';
        return;
    }

    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    let html = '';

    episodes.forEach((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        const isActive = realIndex === currentEpisodeIndex;

        html += `
            <button id="episode-${realIndex}" 
                    onclick="playEpisode(${realIndex})" 
                    class="episode-btn ${isActive ? 'episode-active' : '!bg-[#222] hover:!bg-[#333] hover:!shadow-none'} !border ${isActive ? '!border-blue-500' : '!border-[#333]'} rounded-lg transition-colors text-center">
                ${realIndex + 1}
            </button>
        `;
    });

    episodesList.innerHTML = html;
}

// 播放指定集数
function playEpisode(index) {
    // 确保index在有效范围内
    if (index < 0 || index >= currentEpisodes.length) {
        console.error(`无效的剧集索引: ${index}, 当前剧集数量: ${currentEpisodes.length}`);
        showToast(`无效的剧集索引: ${index + 1}，当前剧集总数: ${currentEpisodes.length}`);
        return;
    }

    // 保存当前播放进度（如果正在播放）
    if (dp && dp.video && !dp.video.paused && !videoHasEnded) {
        saveCurrentProgress();
    }

    // 清除进度保存计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
    }

    // 首先隐藏之前可能显示的错误
    document.getElementById('error').style.display = 'none';
    // 显示加载指示器
    document.getElementById('loading').style.display = 'flex';
    document.getElementById('loading').innerHTML = `
        <div class="loading-spinner"></div>
        <div>正在加载视频...</div>
    `;

    const url = currentEpisodes[index];
    currentEpisodeIndex = index;
    videoHasEnded = false; // 重置视频结束标志

    // 获取当前URL参数，保留source参数
    const urlParams = new URLSearchParams(window.location.search);
    const sourceName = urlParams.get('source') || '';
    const sourceCode = urlParams.get('source_code') || '';

    // 更新URL，不刷新页面，保留source参数
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('index', index);
    newUrl.searchParams.set('url', url);
    if (sourceName) {
        newUrl.searchParams.set('source', sourceName);
    }
    if (sourceCode) {
        newUrl.searchParams.set('source_code', sourceCode);
    }
    window.history.pushState({}, '', newUrl);

    // 更新播放器
    if (dp) {
        try {
            dp.switchVideo({
                url: url,
                type: 'hls'
            });

            // 确保播放开始
            const playPromise = dp.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.warn('播放失败，尝试重新初始化:', error);
                    // 如果切换视频失败，重新初始化播放器
                    initPlayer(url, sourceCode);
                });
            }
        } catch (e) {
            console.error('切换视频出错，尝试重新初始化:', e);
            // 如果出错，重新初始化播放器
            initPlayer(url, sourceCode);
        }
    } else {
        initPlayer(url, sourceCode);
    }

    // 更新UI
    updateEpisodeInfo();
    updateButtonStates();
    renderEpisodes();

    // 控制单集视频时的UI显示
    toggleSingleEpisodeUI();

    // 重置用户点击位置记录
    userClickedPosition = null;

    // 三秒后保存到历史记录
    setTimeout(() => saveToHistory(), 5000);
}

// 播放上一集
function playPreviousEpisode() {
    if (currentEpisodeIndex > 0) {
        playEpisode(currentEpisodeIndex - 1);
    }
}

// 播放下一集
function playNextEpisode() {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        playEpisode(currentEpisodeIndex + 1);
    }
}

// 暂停/播放切换
function togglePlayPause() {
    if (!dp || !dp.video) return;

    if (dp.video.paused) {
        dp.play();
        updatePlayPauseIcon(false); // false表示正在播放
    } else {
        dp.pause();
        updatePlayPauseIcon(true); // true表示已暂停
    }
}

// 更新暂停/播放按钮图标
function updatePlayPauseIcon(isPaused) {
    const playPauseIcon = document.getElementById('playPauseIcon');
    if (!playPauseIcon) return;

    if (isPaused) {
        // 显示播放图标（三角形）
        playPauseIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3l14 9-14 9V3z"></path>';
    } else {
        // 显示暂停图标（两条竖线）
        playPauseIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"></path>';
    }
}

// 复制播放链接
function copyLinks() {
    // 尝试从URL中获取参数
    const urlParams = new URLSearchParams(window.location.search);
    const linkUrl = urlParams.get('url') || '';
    if (linkUrl !== '') {
        navigator.clipboard.writeText(linkUrl).then(() => {
            showToast('播放链接已复制', 'success');
        }).catch(err => {
            showToast('复制失败，请检查浏览器权限', 'error');
        });
    }
}

// 集数网格切换和排序一体化功能
function toggleEpisodesGridAndOrder() {
    const episodesGrid = document.getElementById('episodesGrid');
    const episodesToggle = document.getElementById('episodesToggle');
    const orderArrow = episodesToggle.querySelector('.episode-order-arrow');

    if (episodesGrid && episodesToggle) {
        const isVisible = !episodesGrid.classList.contains('hidden');
        
        if (isVisible) {
            // 如果网格已显示，隐藏网格
            episodesGrid.classList.add('hidden');
            episodesToggle.classList.remove('active');
            episodesGridVisible = false;
        } else {
            // 如果网格隐藏，显示网格
            episodesGrid.classList.remove('hidden');
            episodesToggle.classList.add('active');
            episodesGridVisible = true;
        }
    } else {
        console.error('找不到必要的元素:', { episodesGrid, episodesToggle });
    }
}

// 切换集数排序（点击箭头时调用）
function toggleEpisodeOrder(event) {
    // 阻止事件冒泡，避免触发父按钮的点击事件
    event.stopPropagation();
    
    // 切换排序状态
    episodesReversed = !episodesReversed;
    
    // 重新渲染集数列表
    renderEpisodes();
    
    // 更新箭头方向
    const episodesToggle = document.getElementById('episodesToggle');
    if (episodesToggle) {
        const orderArrow = episodesToggle.querySelector('.episode-order-arrow');
        updateOrderArrow(orderArrow);
    }
}

// 更新排序箭头状态
function updateOrderArrow(orderArrow) {
    if (orderArrow) {
        if (episodesReversed) {
            // 倒序状态：显示向下箭头
            orderArrow.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 10l-5 5-5-5"></path>';
        } else {
            // 正序状态：显示向上箭头
            orderArrow.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 14l5-5 5 5"></path>';
        }
    }
}

// 设置进度条准确点击处理
function setupProgressBarPreciseClicks() {
    // 查找DPlayer的进度条元素
    const progressBar = document.querySelector('.dplayer-bar-wrap');
    if (!progressBar || !dp || !dp.video) return;

    // 移除可能存在的旧事件监听器
    progressBar.removeEventListener('mousedown', handleProgressBarClick);

    // 添加新的事件监听器
    progressBar.addEventListener('mousedown', handleProgressBarClick);

    // 在移动端也添加触摸事件支持
    progressBar.removeEventListener('touchstart', handleProgressBarTouch);
    progressBar.addEventListener('touchstart', handleProgressBarTouch);

    console.log('进度条精确点击监听器已设置');
}

// 处理进度条点击
function handleProgressBarClick(e) {
    if (!dp || !dp.video) return;

    // 计算点击位置相对于进度条的比例
    const rect = e.currentTarget.getBoundingClientRect();
    const percentage = (e.clientX - rect.left) / rect.width;

    // 计算点击位置对应的视频时间
    const duration = dp.video.duration;
    let clickTime = percentage * duration;

    // 处理视频接近结尾的情况
    if (duration - clickTime < 1) {
        // 如果点击位置非常接近结尾，稍微往前移一点
        clickTime = Math.min(clickTime, duration - 1.5);
        console.log(`进度条点击接近结尾，调整时间为 ${clickTime.toFixed(2)}/${duration.toFixed(2)}`);
    }

    // 记录用户点击的位置
    userClickedPosition = clickTime;

    // 输出调试信息
    console.log(`进度条点击: ${percentage.toFixed(4)}, 时间: ${clickTime.toFixed(2)}/${duration.toFixed(2)}`);

    // 阻止默认事件传播，避免DPlayer内部逻辑将视频跳至末尾
    e.stopPropagation();

    // 直接设置视频时间
    dp.seek(clickTime);
}

// 处理移动端触摸事件
function handleProgressBarTouch(e) {
    if (!dp || !dp.video || !e.touches[0]) return;

    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const percentage = (touch.clientX - rect.left) / rect.width;

    const duration = dp.video.duration;
    let clickTime = percentage * duration;

    // 处理视频接近结尾的情况
    if (duration - clickTime < 1) {
        clickTime = Math.min(clickTime, duration - 1.5);
    }

    // 记录用户点击的位置
    userClickedPosition = clickTime;

    console.log(`进度条触摸: ${percentage.toFixed(4)}, 时间: ${clickTime.toFixed(2)}/${duration.toFixed(2)}`);

    e.stopPropagation();
    dp.seek(clickTime);
}

// 在播放器初始化后添加视频到历史记录
function saveToHistory() {
    // 确保 currentEpisodes 非空
    if (!currentEpisodes || currentEpisodes.length === 0) {
        console.warn('没有可用的剧集列表，无法保存完整的历史记录');
    }

    // 尝试从URL中获取参数
    const urlParams = new URLSearchParams(window.location.search);
    const sourceName = urlParams.get('source') || '';
    const sourceCode = urlParams.get('source_code') || '';
    const vod_id = urlParams.get('vod_id') || '';

    // 获取当前播放进度
    let currentPosition = 0;
    let videoDuration = 0;

    if (dp && dp.video) {
        currentPosition = dp.video.currentTime;
        videoDuration = dp.video.duration;
    }

    // 构建要保存的视频信息对象
    const videoInfo = {
        title: currentVideoTitle,
        // 创建基础URL，使用标题作为唯一标识符
        url: `player.html?title=${encodeURIComponent(currentVideoTitle)}&source=${encodeURIComponent(sourceName)}&source_code=${encodeURIComponent(sourceCode)}`,
        episodeIndex: currentEpisodeIndex,
        sourceName: sourceName,
        source_code: sourceCode,
        vod_id: vod_id, // 使用从URL参数获取的vodId
        timestamp: Date.now(),
        // 添加播放进度信息
        playbackPosition: currentPosition > 10 ? currentPosition : 0,
        duration: videoDuration,
        // 重要：保存完整的集数列表，确保进行深拷贝
        episodes: currentEpisodes && currentEpisodes.length > 0 ? [...currentEpisodes] : []
    };

    try {
        const history = JSON.parse(localStorage.getItem('viewingHistory') || '[]');

        // 检查是否已经存在相同标题的记录（同一视频的不同集数）
        const existingIndex = history.findIndex(item => item.title === videoInfo.title);
        if (existingIndex !== -1) {
            // 存在则更新现有记录的集数、时间戳和URL
            history[existingIndex].episodeIndex = currentEpisodeIndex;
            history[existingIndex].timestamp = Date.now();
            history[existingIndex].sourceName = sourceName;
            
            // 确保vod_id和source_code信息保留
            if (videoInfo.vod_id && !history[existingIndex].vod_id) {
                history[existingIndex].vod_id = videoInfo.vod_id;
            }
            if (videoInfo.source_code && !history[existingIndex].source_code) {
                history[existingIndex].source_code = videoInfo.source_code;
            }
            // 更新播放进度信息
            history[existingIndex].playbackPosition = currentPosition > 10 ? currentPosition : history[existingIndex].playbackPosition;
            history[existingIndex].duration = videoDuration || history[existingIndex].duration;
            // 同时更新URL以保存当前的集数状态
            history[existingIndex].url = window.location.href;
            // 更新集数列表（如果有且与当前不同）
            if (currentEpisodes && currentEpisodes.length > 0) {
                // 检查是否需要更新集数数据（针对不同长度的集数列表）
                if (!history[existingIndex].episodes ||
                    !Array.isArray(history[existingIndex].episodes) ||
                    history[existingIndex].episodes.length !== currentEpisodes.length) {
                    history[existingIndex].episodes = [...currentEpisodes]; // 深拷贝
                    console.log(`更新 "${currentVideoTitle}" 的剧集数据: ${currentEpisodes.length}集`);
                }
            }

            // 移到最前面
            const updatedItem = history.splice(existingIndex, 1)[0];
            history.unshift(updatedItem);
        } else {
            // 添加新记录到最前面，但保存完整URL以便能直接打开到正确的集数
            videoInfo.url = window.location.href;
            console.log(`创建新的历史记录: "${currentVideoTitle}", ${currentEpisodes.length}集`);
            history.unshift(videoInfo);
        }

        // 限制历史记录数量为50条
        if (history.length > 50) history.splice(50);

        localStorage.setItem('viewingHistory', JSON.stringify(history));
    } catch (e) {
        console.error('保存观看历史失败:', e);
    }
    // }
}

// 显示恢复位置提示
function showPositionRestoreHint(position) {
    if (!position || position < 10) return;

    // 创建提示元素
    const hint = document.createElement('div');
    hint.className = 'position-restore-hint';
    hint.innerHTML = `
        <div class="hint-content">
            已从 ${formatTime(position)} 继续播放
        </div>
    `;

    // 添加到播放器容器
    const playerContainer = document.querySelector('.player-container');
    playerContainer.appendChild(hint);

    // 显示提示
    setTimeout(() => {
        hint.classList.add('show');

        // 3秒后隐藏
        setTimeout(() => {
            hint.classList.remove('show');
            setTimeout(() => hint.remove(), 300);
        }, 3000);
    }, 100);
}

// 格式化时间为 mm:ss 格式
function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 开始定期保存播放进度
function startProgressSaveInterval() {
    // 清除可能存在的旧计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
    }

    // 每30秒保存一次播放进度
    progressSaveInterval = setInterval(saveCurrentProgress, 30000);

    // 每30秒同步一次播放历史
    setInterval(() => {
        syncConfig();
    }, 30000);
}

let lastSaveTime = 0;
// 保存当前播放进度
function saveCurrentProgress() {
    const now = Date.now();
    if (now - lastSaveTime < 3000) { // 至少3秒保存一次
        return;
    }
    lastSaveTime = now;
    if (!dp || !dp.video) return;
    const currentTime = dp.video.currentTime;
    const duration = dp.video.duration;
    if (!duration || currentTime < 1) return;

    // 在localStorage中保存进度
    const progressKey = `videoProgress_${getVideoId()}`;
    const progressData = {
        position: currentTime,
        duration: duration,
        timestamp: Date.now()
    };
    try {
        localStorage.setItem(progressKey, JSON.stringify(progressData));
        // --- 新增：同步更新 viewingHistory 中的进度 ---
        try {
            const historyRaw = localStorage.getItem('viewingHistory');
            if (historyRaw) {
                const history = JSON.parse(historyRaw);
                        // 用 title + 集数索引唯一标识
        const idx = history.findIndex(item =>
            item.title === currentVideoTitle &&
            (item.episodeIndex === undefined || item.episodeIndex === currentEpisodeIndex)
        );
        if (idx !== -1) {
            // 只在进度有明显变化时才更新，减少写入
            if (
                Math.abs((history[idx].playbackPosition || 0) - currentTime) > 2 ||
                Math.abs((history[idx].duration || 0) - duration) > 2
            ) {
                history[idx].playbackPosition = currentTime;
                history[idx].duration = duration;
                history[idx].timestamp = Date.now();
                
                // 确保vod_id和source_code信息保留
                if (vodId && !history[idx].vod_id) {
                    history[idx].vod_id = vodId;
                }
                if (sourceCode && !history[idx].source_code) {
                    history[idx].source_code = sourceCode;
                }
                
                localStorage.setItem('viewingHistory', JSON.stringify(history));
            }
        }
            }
        } catch (e) {
            // 忽略 viewingHistory 更新错误
        }
    } catch (e) {
        console.error('保存播放进度失败', e);
    }
}

// 设置移动端长按两倍速播放功能
function setupLongPressSpeedControl() {
    if (!dp || !dp.video) return;

    const playerElement = document.getElementById('player');
    let longPressTimer = null;
    let originalPlaybackRate = 1.0;
    let isLongPress = false;

    // 显示快速提示
    function showSpeedHint(speed) {
        showShortcutHint(`${speed}倍速`, 'right');
    }

    // 禁用右键
    playerElement.oncontextmenu = () => {
        // 检测是否为移动设备
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        // 只在移动设备上禁用右键
        if (isMobile) {
            document.querySelector(".dplayer-menu").style.display = "none";
            document.querySelector(".dplayer-mask").style.display = "none";
            return false;
        }
        return true; // 在桌面设备上允许右键菜单
    };

    // 触摸开始事件
    playerElement.addEventListener('touchstart', function (e) {
        // 检查视频是否正在播放，如果没有播放则不触发长按功能
        if (dp.video.paused) {
            return; // 视频暂停时不触发长按功能
        }

        // 保存原始播放速度
        originalPlaybackRate = dp.video.playbackRate;

        // 设置长按计时器
        longPressTimer = setTimeout(() => {
            // 再次检查视频是否仍在播放
            if (dp.video.paused) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                return;
            }

            // 长按超过500ms，设置为3倍速
            dp.video.playbackRate = 3.0;
            isLongPress = true;
            showSpeedHint(3.0);

            // 只在确认为长按时阻止默认行为
            e.preventDefault();
        }, 500);
    }, { passive: false });

    // 触摸结束事件
    playerElement.addEventListener('touchend', function (e) {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            dp.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            showSpeedHint(originalPlaybackRate);

            // 阻止长按后的点击事件
            e.preventDefault();
        }
        // 如果不是长按，则允许正常的点击事件（暂停/播放）
    });

    // 触摸取消事件
    playerElement.addEventListener('touchcancel', function () {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            dp.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
        }
    });

    // 触摸移动事件 - 防止在长按时触发页面滚动
    playerElement.addEventListener('touchmove', function (e) {
        if (isLongPress) {
            e.preventDefault();
        }
    }, { passive: false });

    // 视频暂停时取消长按状态
    dp.video.addEventListener('pause', function () {
        if (isLongPress) {
            dp.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
        }

        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
}

// 清除视频进度记录
function clearVideoProgress() {
    const progressKey = `videoProgress_${getVideoId()}`;
    try {
        localStorage.removeItem(progressKey);
        console.log('已清除播放进度记录');
    } catch (e) {
        console.error('清除播放进度记录失败', e);
    }
}

// 获取视频唯一标识
function getVideoId() {
    // 使用视频标题和集数索引作为唯一标识
    return `${encodeURIComponent(currentVideoTitle)}_${currentEpisodeIndex}`;
}

let controlsLocked = false;
function toggleControlsLock() {
    const container = document.getElementById('playerContainer');
    controlsLocked = !controlsLocked;
    container.classList.toggle('controls-locked', controlsLocked);
    const icon = document.getElementById('lockIcon');
    // 切换图标：锁 / 解锁
    icon.innerHTML = controlsLocked
        ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=\"M12 15v2m0-8V7a4 4 0 00-8 0v2m8 0H4v8h16v-8h-4z\"/>'
        : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=\"M15 11V7a3 3 0 00-6 0v4m-3 4h12v6H6v-6z\"/>';
}



// 自动连播功能已移除，默认始终为true

// 切换集数网格显示
function toggleEpisodesGrid() {
    const episodesGrid = document.getElementById('episodesGrid');
    const episodesToggle = document.getElementById('episodesToggle');

    if (episodesGrid && episodesToggle) {
        const isVisible = !episodesGrid.classList.contains('hidden');
        episodesGrid.classList.toggle('hidden');

        // 更新按钮状态和内存变量
        if (!isVisible) {
            episodesToggle.classList.add('active');
            episodesGridVisible = true;
        } else {
            episodesToggle.classList.remove('active');
            episodesGridVisible = false;
        }
    } else {
        console.error('找不到必要的元素:', { episodesGrid, episodesToggle });
    }
}

// 更新集数切换按钮状态
function updateEpisodesToggleButton(isVisible) {
    const episodesGrid = document.getElementById('episodesGrid');
    const episodesToggle = document.getElementById('episodesToggle');
    const orderArrow = episodesToggle.querySelector('.episode-order-arrow');

    if (episodesGrid && episodesToggle) {
        if (isVisible) {
            episodesGrid.classList.remove('hidden');
            episodesToggle.classList.add('active');
            // 更新箭头状态
            updateOrderArrow(orderArrow);
        } else {
            episodesGrid.classList.add('hidden');
            episodesToggle.classList.remove('active');
        }
    }
}

// =================================
// ========== 收藏功能 ===========
// =================================

// 检查当前视频是否已被收藏
async function checkCurrentVideoFavoriteStatus() {
    if (!currentVideoInfo || !currentVideoInfo.vod_id || !currentVideoInfo.source_code) {
        console.log('视频信息不完整，无法检查收藏状态');
        return;
    }

    try {
        // 生成收藏key
        const favoriteKey = `${currentVideoInfo.vod_id}_${currentVideoInfo.source_code}`;
        
        // 检查本地收藏状态
        const response = await fetch('/proxy/api/user-favorites/batch-check', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ keys: [favoriteKey] })
        });

        if (response.ok) {
            const data = await response.json();
            isCurrentVideoFavorited = data.favorites[favoriteKey] || false;
            updateFavoriteButtonState();
        }

        // 获取完整的视频信息来填充收藏数据
        await fetchAndFillVideoDetails();
    } catch (error) {
        console.error('检查收藏状态失败:', error);
    }
}

// 切换收藏状态
async function toggleFavorite() {
    if (!currentVideoInfo || !currentVideoInfo.vod_id || !currentVideoInfo.source_code) {
        console.log('视频信息不完整，无法收藏');
        return;
    }

    try {
        // 检查用户是否已登录
        if (!window.AuthSystem || !window.AuthSystem.getCurrentUser()) {
            alert('请先登录后再使用收藏功能');
            return;
        }

        // 生成收藏key
        const favoriteKey = `${currentVideoInfo.vod_id}_${currentVideoInfo.source_code}`;
        const action = isCurrentVideoFavorited ? 'remove' : 'add';

        const response = await fetch('/proxy/api/user-favorites', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: action,
                key: favoriteKey,
                data: action === 'add' ? currentVideoInfo : null
            })
        });

        if (response.ok) {
            isCurrentVideoFavorited = !isCurrentVideoFavorited;
            updateFavoriteButtonState();
        } else {
            const errorData = await response.json();
            showToast(`操作失败: ${errorData.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        console.error('收藏操作失败:', error);
        showToast('网络错误，请稍后重试', 'error');
    }
}

// 更新收藏按钮状态
function updateFavoriteButtonState() {
    const favoriteIcon = document.getElementById('favoriteIcon');
    if (favoriteIcon) {
        if (isCurrentVideoFavorited) {
            // 已收藏状态：实心五角星
            favoriteIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" fill="#fbbf24" stroke="#fbbf24" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.563 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />';
        } else {
            // 未收藏状态：空心五角星
            favoriteIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />';
        }
    }
}

// 获取并填充完整的视频信息
async function fetchAndFillVideoDetails() {
    if (!currentVideoInfo || !currentVideoInfo.vod_id || !currentVideoInfo.source_code) {
        console.log('视频信息不完整，无法获取详细信息');
        return;
    }

    try {
        // 构建API请求URL
        let apiUrl = `/api/detail?id=${encodeURIComponent(currentVideoInfo.vod_id)}`;
        
        // 处理自定义API源
        if (currentVideoInfo.source_code.startsWith('custom_')) {
            const customIndex = currentVideoInfo.source_code.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (customApi) {
                apiUrl += `&customApi=${encodeURIComponent(customApi.url)}`;
                if (customApi.detail) {
                    apiUrl += `&customDetail=${encodeURIComponent(customApi.detail)}`;
                }
                apiUrl += '&source=custom';
            }
        } else {
            // 内置API
            apiUrl += `&source=${encodeURIComponent(currentVideoInfo.source_code)}`;
        }

        const response = await fetch(apiUrl);
        if (response.ok) {
            const data = await response.json();
            // 检查不同的数据结构
            let videoDetail = null;
            
            if (data.videoInfo) {
                // 新结构：data.videoInfo
                videoDetail = data.videoInfo;
            } 
            
            if (videoDetail) {
                // 更新当前视频信息，填充缺失的字段
                const updatedInfo = {
                    ...currentVideoInfo,
                    vod_pic: videoDetail.cover || '',
                    type_name: videoDetail.type || '',
                    vod_year: videoDetail.year || '',
                    // 保持原有的必需字段
                    vod_id: currentVideoInfo.vod_id,
                    source_code: currentVideoInfo.source_code,
                    vod_name: currentVideoInfo.vod_name,
                    source_name: currentVideoInfo.source_name
                };
                // 更新全局变量
                currentVideoInfo = updatedInfo;
            } else {
                console.warn('无法从API返回数据中提取视频信息:', data);
            }
        } else {
            console.warn('获取视频详细信息失败:', response.status);
        }
    } catch (error) {
        console.error('获取视频详细信息出错:', error);
    }
}

// 获取自定义API信息的辅助函数
function getCustomApiInfo(index) {
    try {
        // 从localStorage获取自定义API配置
        const customApis = JSON.parse(localStorage.getItem('customApis') || '[]');
        const result = customApis[index] || null;
        return result;
    } catch (error) {
        console.error('获取自定义API信息失败:', error);
        return null;
    }
}

// 显示提示消息
function showToast(message, type = 'info') {
    // 简单的提示实现
    const toast = document.createElement('div');
    toast.className = `fixed top-4 right-4 px-4 py-2 rounded-lg text-white z-50 ${
        type === 'success' ? 'bg-green-500' : 
        type === 'error' ? 'bg-red-500' : 
        'bg-blue-500'
    }`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 3000);
}
