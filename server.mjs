import axios from 'axios';
import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 8080;

const password = process.env.PASSWORD || 'tuqi';
const DEBUG_ENABLED = process.env.DEBUG === 'true';

// 启用 CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
  allowedHeaders: '*',
  credentials: true
}));

app.use(express.json()); // 支持 application/json
app.use(express.urlencoded({ extended: true })); // 支持 form

// 调试日志函数
function logDebug(message) {
  if (DEBUG_ENABLED) {
    console.log(`[Proxy Server] ${message}`);
  }
}

app.get(['/', '/index.html', '/player.html'], async (req, res) => {
  try {
    let content;
    switch (req.path) {
      case '/':
      case '/index.html':
        content = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
        break;
      case '/player.html':
        content = fs.readFileSync(path.join(__dirname, 'player.html'), 'utf8');
        break;
    }
    if (password !== '') {
      const sha256 = await sha256Hash(password);
      content = content.replace('{{PASSWORD}}', sha256);
    }
    res.send(content)
  } catch (error) {
    console.error(error)
    res.status(500).send('读取静态页面失败')
  }
})

// 代理所有方法
app.all('/proxy/:encodedUrl', async (req, res) => {
  try {
    const encodedUrl = req.params.encodedUrl;
    const targetUrl = decodeURIComponent(encodedUrl);

    // 安全验证
    const isValidUrl = (urlString) => {
      try {
        const parsed = new URL(urlString);
        const allowedProtocols = ['http:', 'https:'];
        const blockedHostnames = ['localhost', '127.0.0.1'];
        return allowedProtocols.includes(parsed.protocol) &&
          !blockedHostnames.includes(parsed.hostname);
      } catch {
        return false;
      }
    };

    if (!isValidUrl(targetUrl)) {
      return res.status(400).send('Invalid URL');
    }

    logDebug(`收到通用代理请求: ${targetUrl}`);

    // 构造请求
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: { ...req.headers, host: undefined }, // 透传客户端 header，但去掉 host
      data: req.body,
      responseType: 'stream',
      timeout: 10000
    });

    // 转发响应头
    const headers = { ...response.headers };
    delete headers['content-security-policy'];
    delete headers['cookie'];
    res.set(headers);

    // 转发响应流
    response.data.pipe(res);

  } catch (error) {
    if (error.response) {
      res.status(error.response.status);
      error.response.data.pipe(res);
    } else {
      res.status(500).send(error.message);
    }
  }
});

// 新增：代理到后端服务器的简化路径 - 与Cloudflare版本保持一致
app.use('/proxy/api', async (req, res) => {
  try {
    const backendUrl = process.env.BACKEND_URL || 'https://libretv.092201.xyz';

    // 保留 query string
    const apiPath = req.originalUrl.replace(/^\/proxy\/api/, '');
    const targetUrl = `${backendUrl}/api${apiPath}`;

    logDebug(`API代理请求: ${req.method} ${req.originalUrl} -> ${targetUrl}`);
    logDebug(`查询参数: ${req.url.split('?')[1] || '无'}`);

    // 获取客户端请求的Cookie
    const clientCookies = req.headers.cookie || '';
    logDebug(`客户端Cookie: ${clientCookies}`);

    // 构造到后端的同方法请求
    const forwardedHeaders = {};

    // 复制所有原始头，但排除一些可能引起问题的头
    for (const [key, value] of Object.entries(req.headers)) {
      // 只排除host头，其他头都转发
      if (key.toLowerCase() !== 'host') {
        forwardedHeaders[key] = value;
      }
    }

    // 设置必要的头，确保后端能正确处理
    forwardedHeaders['Host'] = new URL(backendUrl).host;
    forwardedHeaders['X-Forwarded-For'] = req.ip || req.connection.remoteAddress || '';
    forwardedHeaders['X-Forwarded-Host'] = req.get('Host') || '';
    forwardedHeaders['X-Forwarded-Proto'] = req.protocol;

    // 传递Cookie - 这是关键！
    if (clientCookies) {
      forwardedHeaders['Cookie'] = clientCookies;
    }

    // 构造 axios 配置
    const axiosConfig = {
      method: req.method,
      url: targetUrl,
      headers: forwardedHeaders,
      timeout: 10000
    };

    // 仅 POST/PUT/PATCH 方法才发送 body
    if (['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase())) {
      axiosConfig.data = req.body;
      
      // 确保Content-Type正确设置
      if (!forwardedHeaders['Content-Type']) {
        forwardedHeaders['Content-Type'] = 'application/json';
      }
    }

    logDebug(`转发请求: ${axiosConfig.method} ${axiosConfig.url}`);
    logDebug(`转发头: ${JSON.stringify(forwardedHeaders)}`);

    // 发送请求
    const response = await axios(axiosConfig);

    // 获取后端设置的Cookie
    const setCookieHeader = response.headers['set-cookie'];
    logDebug(`后端Set-Cookie: ${setCookieHeader}`);
    logDebug(`响应状态: ${response.status}`);

    // 构建响应头
    const responseHeaders = { ...response.headers };

    // 处理后端设置的Cookie
    if (setCookieHeader) {
      // 处理可能的多个Cookie（Set-Cookie头可能有多个值）
      const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      const adjustedCookies = [];

      for (const cookie of cookies) {
        let adjustedCookie = cookie;

        // 替换路径 - 处理所有可能的API路径
        if (adjustedCookie.includes('Path=/api/')) {
          adjustedCookie = adjustedCookie.replace(
            /Path=\/api\//g,
            'Path=/proxy/api/'
          );
        } else if (!adjustedCookie.includes('Path=')) {
          // 如果后端没有设置Path，则设置为代理路径
          adjustedCookie += '; Path=/proxy/api';
        }

        // 处理Domain - 移除后端特定的Domain设置
        if (adjustedCookie.includes('Domain=')) {
          const backendDomain = new URL(backendUrl).hostname;
          const proxyDomain = req.get('Host')?.split(':')[0] || 'localhost';

          // 如果Domain设置的是后端域名，替换为代理域名
          if (adjustedCookie.includes(`Domain=${backendDomain}`)) {
            adjustedCookie = adjustedCookie.replace(
              `Domain=${backendDomain}`,
              `Domain=${proxyDomain}`
            );
          } else {
            // 否则完全移除Domain设置，让浏览器使用当前域名
            adjustedCookie = adjustedCookie.replace(/Domain=[^;]+;?/i, '');
          }
        }

        adjustedCookies.push(adjustedCookie);
        logDebug(`调整后的Cookie: ${adjustedCookie}`);
      }

      // 设置调整后的Cookie头
      responseHeaders['Set-Cookie'] = adjustedCookies;
    }

    // 设置响应头，删除敏感头
    delete responseHeaders['content-security-policy'];
    delete responseHeaders['set-cookie']; // 我们已经处理过了
    delete responseHeaders['cookie'];
    res.set(responseHeaders);

    // 返回响应内容
    if (responseHeaders['content-type']?.includes('application/json')) {
      res.status(response.status).json(response.data);
    } else {
      res.status(response.status).send(response.data);
    }

  } catch (error) {
    logDebug(`代理错误: ${error.message}`);
    if (error.response) {
      const headers = { ...error.response.headers };
      delete headers['content-security-policy'];
      delete headers['set-cookie'];
      delete headers['cookie'];
      res.set(headers);
      res.status(error.response.status);
      if (headers['content-type']?.includes('application/json')) {
        res.json(error.response.data);
      } else {
        res.send(error.response.data);
      }
    } else {
      res.status(500).send(`代理错误: ${error.message}`);
    }
  }
});

// 静态文件路径
app.use(express.static('./'));

// 计算 SHA-256 哈希值
export async function sha256Hash(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

app.listen(port, () => {
  console.log(`服务器运行在 http://localhost:${port}`);
  if (password !== '') {
    console.log('登录密码为：', password);
  }
  if (DEBUG_ENABLED) {
    console.log('调试模式已启用');
  }
});
