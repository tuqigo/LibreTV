// functions/proxy/[[path]].js

// --- 配置 (现在从 Cloudflare 环境变量读取) ---
// 在 Cloudflare Pages 设置 -> 函数 -> 环境变量绑定 中设置以下变量:
// CACHE_TTL (例如 86400)
// MAX_RECURSION (例如 5)
// FILTER_DISCONTINUITY (不再需要，设为 false 或移除)
// USER_AGENTS_JSON (例如 ["UA1", "UA2"]) - JSON 字符串数组
// DEBUG (例如 false 或 true)
// --- 配置结束 ---

/**
 * 主要的 Pages Function 处理函数
 * 拦截发往 /proxy/* 的请求
 */
export async function onRequest(context) {
    const { request, env, next, waitUntil } = context; // next 和 waitUntil 可能需要
    const url = new URL(request.url);

    // --- 从环境变量读取配置 ---
    const DEBUG_ENABLED = (env.DEBUG === 'true');
    // 广告过滤已移至播放器处理，代理不再执行
    let USER_AGENTS = [ // 提供一个基础的默认值
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    try {
        // 尝试从环境变量解析 USER_AGENTS_JSON
        const agentsJson = env.USER_AGENTS_JSON;
        if (agentsJson) {
            const parsedAgents = JSON.parse(agentsJson);
            if (Array.isArray(parsedAgents) && parsedAgents.length > 0) {
                USER_AGENTS = parsedAgents;
            } else {
                logDebug("环境变量 USER_AGENTS_JSON 格式无效或为空，使用默认值");
            }
        }
    } catch (e) {
        logDebug(`解析环境变量 USER_AGENTS_JSON 失败: ${e.message}，使用默认值`);
    }
    // --- 配置读取结束 ---


    // --- 辅助函数 ---

    // 输出调试日志 (需要设置 DEBUG: true 环境变量)
    function logDebug(message) {
        if (DEBUG_ENABLED) {
            console.log(`[Proxy Func] ${message}`);
        }
    }

    // 从请求路径中提取目标 URL
    function getTargetUrlFromPath(pathname) {
        // 路径格式: /proxy/经过编码的URL
        // 例如: /proxy/https%3A%2F%2Fexample.com%2Fplaylist.m3u8
        const encodedUrl = pathname.replace(/^\/proxy\//, '');
        if (!encodedUrl) return null;
        try {
            // 解码
            let decodedUrl = decodeURIComponent(encodedUrl);

            // 简单检查解码后是否是有效的 http/https URL
            if (!decodedUrl.match(/^https?:\/\//i)) {
                // 也许原始路径就没有编码？如果看起来像URL就直接用
                if (encodedUrl.match(/^https?:\/\//i)) {
                    decodedUrl = encodedUrl;
                    logDebug(`Warning: Path was not encoded but looks like URL: ${decodedUrl}`);
                } else {
                    logDebug(`无效的目标URL格式 (解码后): ${decodedUrl}`);
                    return null;
                }
            }
            return decodedUrl;

        } catch (e) {
            logDebug(`解码目标URL时出错: ${encodedUrl} - ${e.message}`);
            return null;
        }
    }

    // 创建标准化的响应
    function createResponse(body, status = 200, headers = {}) {
        const responseHeaders = new Headers(headers);
        // 关键：添加 CORS 跨域头，允许前端 JS 访问代理后的响应
        responseHeaders.set("Access-Control-Allow-Origin", "*"); // 允许任何来源访问
        responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS"); // 允许的方法
        responseHeaders.set("Access-Control-Allow-Headers", "*"); // 允许所有请求头
        responseHeaders.set("Access-Control-Allow-Credentials", "true"); // 允许携带凭证

        // 处理 CORS 预检请求 (OPTIONS) - 放在这里确保所有响应都处理
        if (request.method === "OPTIONS") {
            // 使用下面的 onOptions 函数可以更规范，但在这里处理也可以
            return new Response(null, {
                status: 204, // No Content
                headers: responseHeaders // 包含上面设置的 CORS 头
            });
        }

        return new Response(body, { status, headers: responseHeaders });
    }

    // --- 主要请求处理逻辑 ---
    try {
        // 检查是否是简化的API代理路径
        if (url.pathname.startsWith('/proxy/api/')) {
            // 从环境变量获取后端服务器地址
            const backendUrl = env.BACKEND_URL || 'https://libretv.092201.xyz';

            // 提取API路径和查询参数
            const apiPath = url.pathname.replace('/proxy/api', '');

            // 构建目标URL，包含原始查询参数
            let targetUrl = `${backendUrl}/api${apiPath}`;

            // 添加原始查询参数
            if (url.search) {
                targetUrl += url.search;
            }

            logDebug(`API代理请求: ${request.method} ${url.pathname} -> ${targetUrl}`);
            logDebug(`查询参数: ${url.search}`);

            // 获取客户端请求的Cookie
            const clientCookies = request.headers.get('Cookie') || '';
            logDebug(`客户端Cookie: ${clientCookies}`);

            // 构造到后端的同方法请求
            const forwardedHeaders = new Headers();

            // 复制所有原始头，但排除一些可能引起问题的头
            for (const [key, value] of request.headers.entries()) {
                // 只排除host头，其他头都转发
                if (key.toLowerCase() !== 'host') {
                    forwardedHeaders.set(key, value);
                }
            }

            // 设置必要的头，确保后端能正确处理
            forwardedHeaders.set('Host', new URL(backendUrl).host);
            forwardedHeaders.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || '');
            forwardedHeaders.set('X-Forwarded-Host', request.headers.get('Host') || '');
            forwardedHeaders.set('X-Forwarded-Proto', new URL(request.url).protocol.replace(':', ''));

            // 传递Cookie - 这是关键！
            if (clientCookies) {
                forwardedHeaders.set('Cookie', clientCookies);
            }

            // 对于GET/HEAD请求，不应该有body
            let requestBody = null;
            if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
                requestBody = request.body;

                // 确保Content-Type正确设置
                if (!forwardedHeaders.has('Content-Type')) {
                    forwardedHeaders.set('Content-Type', 'application/json');
                }
            }

            const forwarded = new Request(targetUrl, {
                method: request.method,
                headers: forwardedHeaders,
                body: requestBody,
                redirect: 'follow',
            });

            logDebug(`转发请求: ${forwarded.method} ${forwarded.url}`);
            logDebug(`转发头: ${JSON.stringify(Object.fromEntries(forwardedHeaders))}`);

            const resp = await fetch(forwarded);
            const body = await resp.text();

            // 获取后端设置的Cookie
            const setCookieHeader = resp.headers.get('Set-Cookie');
            logDebug(`后端Set-Cookie: ${setCookieHeader}`);
            logDebug(`响应状态: ${resp.status}`);

            // 构建响应头
            const responseHeaders = new Headers(resp.headers);

            // 处理后端设置的Cookie
            if (setCookieHeader) {
                // 处理可能的多个Cookie（Set-Cookie头可能有多个值）
                const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
                const adjustedCookies = [];

                for (const cookie of cookies) {
                    let adjustedCookie = cookie;

                    // 处理其他Cookie的路径
                    if (adjustedCookie.includes('Path=/api/')) {
                        adjustedCookie = adjustedCookie.replace(
                            /Path=\/api\//g,
                            'Path=/proxy/api'
                        );
                    } else if (!adjustedCookie.includes('Path=')) {
                        // 如果后端没有设置Path，则设置为代理路径
                        adjustedCookie += '; Path=/proxy/api';
                    }

                    // 处理Domain - 移除后端特定的Domain设置
                    if (adjustedCookie.includes('Domain=')) {
                        const backendDomain = new URL(backendUrl).hostname;
                        const proxyDomain = new URL(request.url).hostname;

                        // 如果Domain设置的是后端域名，替换为代理域名
                        if (adjustedCookie.includes(`Domain=${backendDomain}`)) {
                            adjustedCookie = adjustedCookie.replace(
                                `Domain=${backendDomain}`,
                                `Domain=${proxyDomain}`
                            );
                            logDebug(`已替换Domain: ${backendDomain} -> ${proxyDomain}`);
                        } else {
                            // 否则完全移除Domain设置，让浏览器使用当前域名
                            adjustedCookie = adjustedCookie.replace(/Domain=[^;]+;?/i, '');
                            logDebug('已移除Domain设置');
                        }
                    }

                    adjustedCookies.push(adjustedCookie);
                    logDebug(`调整后的Cookie: ${adjustedCookie}`);
                }

                for (const adjusted of adjustedCookies) {
                    // 设置调整后的Cookie头
                    responseHeaders.append('Set-Cookie', adjusted);
                }

                logDebug(`最终Set-Cookie头: ${adjustedCookies.join(', ')}`);
            }

            // 返回响应并添加CORS头
            return createResponse(body, resp.status, Object.fromEntries(responseHeaders));
        }

        // 原有的通用代理逻辑
        const targetUrl = getTargetUrlFromPath(url.pathname);

        if (!targetUrl) {
            logDebug(`无效的代理请求路径: ${url.pathname}`);
            return createResponse("无效的代理请求。路径应为 /proxy/<经过编码的URL>", 400);
        }

        logDebug(`收到通用代理请求: ${targetUrl}`);

        // 构造到后端的同方法请求
        const forwarded = new Request(targetUrl, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            redirect: 'follow',
        });
        const resp = await fetch(forwarded);
        const body = await resp.text();
        // 原样返回状态码和头，并加上 CORS
        return createResponse(body, resp.status, Object.fromEntries(resp.headers));
    } catch (error) {
        logDebug(`处理代理请求时发生严重错误: ${error.message} \n ${error.stack}`);
        return createResponse(`代理处理错误: ${error.message}`, 500);
    }
}

// 添加一个专门的OPTIONS处理函数
export async function onRequestOptions(context) {
    const { request } = context;
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Max-Age': '86400',
        }
    });
}