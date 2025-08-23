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
            const backendUrl = env.BACKEND_URL || 'https://aa.bb.com';
            
            // 提取API路径
            const apiPath = url.pathname.replace('/proxy/api', '');
            const targetUrl = `${backendUrl}/api${apiPath}`;
            
            logDebug(`API代理请求: ${request.method} ${url.pathname} -> ${targetUrl}`);

            // 构造到后端的同方法请求
            const forwarded = new Request(targetUrl, {
                method: request.method,
                headers: request.headers,
                body: request.body,
                redirect: 'follow',
            });
            
            const resp = await fetch(forwarded);
            const body = await resp.text();
            
            // 返回响应并添加CORS头
            return createResponse(body, resp.status, Object.fromEntries(resp.headers));
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