# 代理配置说明

## 概述
已修改 `server.mjs` 和 `functions/proxy/[[path]].js` 文件，支持简化的API代理路径，可以直接代理到后端服务器。

## 配置说明

### 1. 本地测试配置 (`server.mjs`)

在本地启动服务器时，可以通过环境变量配置后端服务器地址：

```bash
# Windows PowerShell
$env:BACKEND_URL="https://aa.bb.com"
node server.mjs

# Windows CMD
set BACKEND_URL=https://aa.bb.com
node server.mjs

# Linux/Mac
export BACKEND_URL=https://aa.bb.com
node server.mjs
```

如果不设置环境变量，将使用默认值 `https://aa.bb.com`。

### 2. Cloudflare Pages 配置

在 Cloudflare Pages 的设置中，添加环境变量：

1. 进入项目设置 → 函数 → 环境变量
2. 添加变量：
   - **变量名**: `BACKEND_URL`
   - **值**: `https://aa.bb.com`

## 使用方法

### 1. 简化API代理路径

现在可以直接使用以下格式的请求：

```
http://localhost:8080/proxy/api/auth/login
http://localhost:8080/proxy/api/auth/register
http://localhost:8080/proxy/api/viewing-history/operation
```

这些请求会自动代理到：
```
https://aa.bb.com/api/auth/login
https://aa.bb.com/api/auth/register
https://aa.bb.com/api/viewing-history/operation
```

### 2. 原有代理功能

原有的通用代理功能仍然保留：

```
http://localhost:8080/proxy/https%3A%2F%2Fexample.com%2Fapi%2Fendpoint
```

## 技术实现

### 1. `server.mjs` 修改

- 新增 `/proxy/api/*` 路由处理
- 自动提取API路径并代理到后端服务器
- 支持环境变量配置后端地址

### 2. `functions/proxy/[[path]].js` 修改

- 检测 `/proxy/api/` 开头的请求
- 自动代理到配置的后端服务器
- 保持原有的通用代理功能

## 测试验证

### 1. 本地测试

```bash
# 启动服务器
node server.mjs

# 测试API代理
curl -X POST http://localhost:8080/proxy/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"123456"}'
```

### 2. Cloudflare Pages 测试

部署后，测试以下URL：

```
https://your-domain.pages.dev/proxy/api/auth/login
https://your-domain.pages.dev/proxy/api/auth/register
```

## 注意事项

1. **安全性**: 确保后端服务器 `https://aa.bb.com` 是可信的
2. **CORS**: 代理会自动添加CORS头，解决跨域问题
3. **超时**: 请求超时设置为10秒
4. **错误处理**: 代理错误会返回500状态码和错误信息

## 故障排除

### 1. 代理失败

- 检查后端服务器是否可访问
- 验证环境变量配置是否正确
- 查看控制台错误日志

### 2. CORS 问题

- 确保使用 `/proxy/api/` 路径
- 检查后端服务器响应头
- 验证请求方法是否正确

## 总结

现在您的系统支持两种代理方式：

1. **简化API代理**: `/proxy/api/*` → 自动代理到后端服务器
2. **通用代理**: `/proxy/<encoded-url>` → 代理到任意URL

这样既简化了前端代码，又保持了灵活性。
