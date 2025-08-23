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

// 启用 CORS
app.use(cors());
app.use(express.json()); // 支持 application/json
app.use(express.urlencoded({ extended: true })); // 支持 form

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

// 新增：代理到后端服务器的简化路径
app.use('/proxy/api', async (req, res) => {
  try {
    const backendUrl = process.env.BACKEND_URL || 'https://libretv.092201.xyz';
    
    // 保留 query string
    const apiPath = req.originalUrl.replace(/^\/proxy\/api/, '');
    const targetUrl = `${backendUrl}/api${apiPath}`;

    console.log(`代理请求: ${req.method} ${req.originalUrl} -> ${targetUrl}`);

    // 构造 axios 配置
    const axiosConfig = {
      method: req.method,
      url: targetUrl,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json'
      },
      timeout: 10000
    };

    // 仅 POST/PUT/PATCH 方法才发送 body
    if (['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase())) {
      axiosConfig.data = req.body;
    }

    // 发送请求
    const response = await axios(axiosConfig);

    // 设置响应头，删除敏感头
    const headers = { ...response.headers };
    delete headers['content-security-policy'];
    delete headers['set-cookie'];
    delete headers['cookie'];
    res.set(headers);

    // 返回响应内容
    if (headers['content-type']?.includes('application/json')) {
      res.status(response.status).json(response.data);
    } else {
      res.status(response.status);
      response.data.pipe(res);
    }

  } catch (error) {
    console.error('代理错误:', error.message);
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
        error.response.data.pipe(res);
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
});
