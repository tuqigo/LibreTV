// --------------------------------以下代码全部为了处理/api/search 以及 /api/detail的首页搜索相关的请求------------------------------------------------
// 匹配常见视频直链 
const VIDEO_URL_RE = /https?:\/\/[^\s'"$#<>]+?\.(m3u8|mp4|flv|avi|mkv|mov|wmv)(\?[^'"\s#<>]*)?/ig;

function isBaseDomain(api) {
    try {
        const url = new URL(api);
        // 只有 hostname，pathname 等于 / 才算纯域名
        return url.pathname === '/' || url.pathname === '';
    } catch (e) {
        return false;
    }
}

function buildApiUrl(baseApi, pathWithQuery, value) {
    const base = (baseApi || '').replace(/\/+$/, ''); // 去掉尾斜杠
    const [_, queryTmpl = ''] = pathWithQuery.split('?'); // e.g. ac=videolist&wd=

    if (isBaseDomain(baseApi)) {
        // 域名型，直接拼 path
        return `${base}${pathWithQuery}${value}`;
    } else {
        // 已带路径型，直接拼 query 参数
        const sep = base.includes('?') ? (/[?&]$/.test(base) ? '' : '&') : '?';
        return `${base}${sep}${queryTmpl}${value}`;
    }
}

// 获取搜索API
function getSearchApi(source, searchQuery, customApi = null) {
    const baseApi = customApi || API_SITES[source].api;
    return buildApiUrl(baseApi, API_CONFIG.search.path, encodeURIComponent(searchQuery));
}

// 获取详情API
function getDetailApi(source, id, customApi = null) {
    const baseApi = customApi || API_SITES[source].api;
    return buildApiUrl(baseApi, API_CONFIG.detail.path, encodeURIComponent(id));
}

// 从单个源块中提取视频直链
function extractVideoEpisodesFromBlock(block) {
    if (!block) return [];
    const normalized = block.replace(/&amp;/g, '&');
    const pieces = normalized.split('#');
    const urls = [];

    for (const ep of pieces) {
        const lastPart = ep.includes('$') ? ep.split('$').pop().trim() : ep.trim();
        const match = lastPart.match(VIDEO_URL_RE);
        if (match && match.length) urls.push(...match);
    }

    const uniq = Array.from(new Set(urls.map(u => u.trim())));
    return uniq.filter(u => /^https?:\/\//i.test(u));
}

// 统计最多的后缀，返回该类型的链接
function filterByDominantExtension(urls) {
    if (!urls.length) return [];

    const counter = {};
    for (const u of urls) {
        const extMatch = u.match(/\.(m3u8|mp4|flv|avi|mkv|mov|wmv)(?=$|\?|#)/i);
        if (extMatch) {
            const ext = extMatch[1].toLowerCase();
            counter[ext] = (counter[ext] || 0) + 1;
        }
    }

    // 找到数量最多的后缀
    let dominantExt = null;
    let maxCount = 0;
    for (const [ext, count] of Object.entries(counter)) {
        if (count > maxCount) {
            dominantExt = ext;
            maxCount = count;
        }
    }

    if (!dominantExt) return [];

    // 只保留这种后缀的链接
    return urls.filter(u => u.toLowerCase().includes(`.${dominantExt}`));
}

// 主逻辑
function pickPrimaryVideoEpisodes(playUrl) {
    const blocks = playUrl.split('$$$').filter(Boolean);
    let best = [];

    for (const b of blocks) {
        const eps = extractVideoEpisodesFromBlock(b);
        if (eps.length > best.length) best = eps;
    }

    if (best.length === 0) {
        const all = (playUrl.replace(/&amp;/g, '&').match(VIDEO_URL_RE) || []);
        best = Array.from(new Set(all));
    }

    return filterByDominantExtension(best);
}


// 改进的API请求处理函数
async function handleApiRequest(url) {
    const customApi = url.searchParams.get('customApi') || '';
    const customDetail = url.searchParams.get('customDetail') || '';
    const source = url.searchParams.get('source') || 'heimuer';

    try {
        if (url.pathname === '/api/search') {
            const searchQuery = url.searchParams.get('wd');
            if (!searchQuery) {
                throw new Error('缺少搜索参数');
            }

            // 验证API和source的有效性
            if (source === 'custom' && !customApi) {
                throw new Error('使用自定义API时必须提供API地址');
            }

            if (!API_SITES[source] && source !== 'custom') {
                throw new Error('无效的API来源');
            }

            const apiUrl = getSearchApi(source, searchQuery, customApi)
            // 添加超时处理
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            try {
                const response = await fetch(PROXY_URL + encodeURIComponent(apiUrl), {
                    headers: API_CONFIG.search.headers,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`API请求失败: ${response.status}`);
                }

                const data = await response.json();

                // 检查JSON格式的有效性
                if (!data || !Array.isArray(data.list)) {
                    throw new Error('API返回的数据格式无效');
                }

                // 添加源信息到每个结果
                data.list.forEach(item => {
                    item.source_name = source === 'custom' ? '自定义源' : API_SITES[source].name;
                    item.source_code = source;
                    // 对于自定义源，添加API URL信息
                    if (source === 'custom') {
                        item.api_url = customApi;
                    }
                });

                return JSON.stringify({
                    code: 200,
                    list: data.list || [],
                });
            } catch (fetchError) {
                clearTimeout(timeoutId);
                throw fetchError;
            }
        }

        // 详情处理
        if (url.pathname === '/api/detail') {
            const id = url.searchParams.get('id');
            const sourceCode = url.searchParams.get('source') || 'heimuer'; // 获取源代码

            if (!id) {
                throw new Error('缺少视频ID参数');
            }

            // 验证ID格式 - 只允许数字和有限的特殊字符
            if (!/^[\w-]+$/.test(id)) {
                throw new Error('无效的视频ID格式');
            }

            // 验证API和source的有效性
            if (sourceCode === 'custom' && !customApi) {
                throw new Error('使用自定义API时必须提供API地址');
            }

            if (!API_SITES[sourceCode] && sourceCode !== 'custom') {
                throw new Error('无效的API来源');
            }

            // 对于有detail参数的源，都使用特殊处理方式
            if (sourceCode !== 'custom' && API_SITES[sourceCode].detail) {
                return await handleSpecialSourceDetail(id, sourceCode);
            }

            // 如果是自定义API，并且传递了detail参数，尝试特殊处理
            // 优先 customDetail
            if (sourceCode === 'custom' && customDetail) {
                return await handleCustomApiSpecialDetail(id, customDetail);
            }
            if (sourceCode === 'custom' && url.searchParams.get('useDetail') === 'true') {
                return await handleCustomApiSpecialDetail(id, customApi);
            }

            const detailUrl = getDetailApi(sourceCode, id, customApi)
            // 添加超时处理
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            try {
                const response = await fetch(PROXY_URL + encodeURIComponent(detailUrl), {
                    headers: API_CONFIG.detail.headers,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`详情请求失败: ${response.status}`);
                }

                // 解析JSON
                const data = await response.json();

                // 检查返回的数据是否有效
                if (!data || !data.list || !Array.isArray(data.list) || data.list.length === 0) {
                    throw new Error('获取到的详情内容无效');
                }

                // 获取第一个匹配的视频详情
                const videoDetail = data.list[0];

                // 提取播放地址
                let episodes = [];

                if (videoDetail.vod_play_url) {
                    episodes = pickPrimaryVideoEpisodes(videoDetail.vod_play_url);
                }

                if (episodes.length === 0 && videoDetail.vod_content) {
                    const matches = (videoDetail.vod_content.replace(/&amp;/g, '&').match(VIDEO_URL_RE) || []);
                    episodes = filterByDominantExtension(Array.from(new Set(matches)));
                }

                return JSON.stringify({
                    code: 200,
                    episodes: episodes,
                    detailUrl: detailUrl,
                    videoInfo: {
                        title: videoDetail.vod_name,
                        cover: videoDetail.vod_pic,
                        desc: videoDetail.vod_content,
                        type: videoDetail.type_name,
                        year: videoDetail.vod_year,
                        area: videoDetail.vod_area,
                        director: videoDetail.vod_director,
                        actor: videoDetail.vod_actor,
                        remarks: videoDetail.vod_remarks,
                        // 添加源信息
                        source_name: sourceCode === 'custom' ? '自定义源' : API_SITES[sourceCode].name,
                        source_code: sourceCode
                    }
                });
            } catch (fetchError) {
                clearTimeout(timeoutId);
                throw fetchError;
            }
        }

        throw new Error('未知的API路径');
    } catch (error) {
        console.error('API处理错误:', error);
        return JSON.stringify({
            code: 400,
            msg: error.message || '请求处理失败',
            list: [],
            episodes: [],
        });
    }
}

// 处理自定义API的特殊详情页
async function handleCustomApiSpecialDetail(id, customApi) {
    try {
        // 构建详情页URL
        const detailUrl = `${customApi}/index.php/vod/detail/id/${id}.html`;

        // 添加超时处理
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        // 获取详情页HTML
        const response = await fetch(PROXY_URL + encodeURIComponent(detailUrl), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`自定义API详情页请求失败: ${response.status}`);
        }

        // 获取HTML内容
        const html = await response.text();

        // 使用通用模式提取m3u8链接
        const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
        let matches = html.match(generalPattern) || [];

        // 处理链接
        matches = matches.map(link => {
            link = link.substring(1, link.length);
            const parenIndex = link.indexOf('(');
            return parenIndex > 0 ? link.substring(0, parenIndex) : link;
        });

        // 提取基本信息
        const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const titleText = titleMatch ? titleMatch[1].trim() : '';

        const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/);
        const descText = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : '';

        return JSON.stringify({
            code: 200,
            episodes: matches,
            detailUrl: detailUrl,
            videoInfo: {
                title: titleText,
                desc: descText,
                source_name: '自定义源',
                source_code: 'custom'
            }
        });
    } catch (error) {
        console.error(`自定义API详情获取失败:`, error);
        throw error;
    }
}

// 通用特殊源详情处理函数
async function handleSpecialSourceDetail(id, sourceCode) {
    try {
        // 构建详情页URL（使用配置中的detail URL而不是api URL）
        const detailUrl = `${API_SITES[sourceCode].detail}/index.php/vod/detail/id/${id}.html`;

        // 添加超时处理
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        // 获取详情页HTML
        const response = await fetch(PROXY_URL + encodeURIComponent(detailUrl), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`详情页请求失败: ${response.status}`);
        }

        // 获取HTML内容
        const html = await response.text();

        // 根据不同源类型使用不同的正则表达式
        let matches = [];

        if (sourceCode === 'ffzy') {
            // 非凡影视使用特定的正则表达式
            const ffzyPattern = /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
            matches = html.match(ffzyPattern) || [];
        }

        // 如果没有找到链接或者是其他源类型，尝试一个更通用的模式
        if (matches.length === 0) {
            const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
            matches = html.match(generalPattern) || [];
        }
        // 去重处理，避免一个播放源多集显示
        matches = [...new Set(matches)];
        // 处理链接
        matches = matches.map(link => {
            link = link.substring(1, link.length);
            const parenIndex = link.indexOf('(');
            return parenIndex > 0 ? link.substring(0, parenIndex) : link;
        });

        // 提取基本信息
        const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const titleText = titleMatch ? titleMatch[1].trim() : '';

        // 提取描述 - 从剧情介绍部分获取
        const descMatch = html.match(/<div[^>]*class=["']max-h-\[290px\][^>]*>([\s\S]*?)<\/div>/);
        let descText = '';
        if (descMatch) {
            const pMatch = descMatch[1].match(/<p>([\s\S]*?)<\/p>/);
            descText = pMatch ? pMatch[1].trim() : '';
        }

        // 提取封面URL - 直接匹配图片URL
        const coverMatch = html.match(/<main[\s\S]*?<img[^>]*src=["']([^"']+)["'][^>]*>/i);
        const coverUrl = coverMatch ? coverMatch[1] : '';


        // 提取年代和类型 - 从表格中提取
        let year = '';
        let type = '';

        // 提取年代
        const yearMatch = html.match(/<td[^>]*>\s*年代[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/);
        year = yearMatch ? yearMatch[1].trim() : '';

        // 提取类型
        const typeMatch = html.match(/<td[^>]*>\s*类型[^<]*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/);
        if (typeMatch) {
            // 移除HTML标签，只保留文本内容
            type = typeMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            // 移除可能的&nbsp;
            type = type.replace(/&nbsp;/g, '').trim();
        }

        return JSON.stringify({
            code: 200,
            episodes: matches,
            detailUrl: detailUrl,
            videoInfo: {
                title: titleText,
                desc: descText,
                source_name: API_SITES[sourceCode].name,
                source_code: sourceCode,
                cover: coverUrl,
                type: type,
                year: year
            }
        });
    } catch (error) {
        console.error(`${API_SITES[sourceCode].name}详情获取失败:`, error);
        throw error;
    }
}

// --------------------------------以上代码全部为了处理/api/search 以及 /api/detail的首页搜索相关的请求------------------------------------------------

// 拦截API请求
(function () {
    const originalFetch = window.fetch;

    window.fetch = async function (input, init) {
        const requestUrl = typeof input === 'string' ? new URL(input, window.location.origin) : input.url;

        if (requestUrl.pathname.startsWith('/api/')) {
            try {
                const data = await handleApiRequest(requestUrl);
                return new Response(data, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    },
                });
            } catch (error) {
                return new Response(JSON.stringify({
                    code: 500,
                    msg: '服务器内部错误',
                }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            }
        }

        // 非API请求使用原始fetch
        return originalFetch.apply(this, arguments);
    };
})();