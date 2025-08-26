# LibreTV 新认证系统说明

## 概述

LibreTV认证系统已升级为Cookie-based认证，提供更高的安全性和更好的用户体验。

## 主要改进

### 1. 安全性提升
- **Access Token**: 现在存储在HttpOnly Cookie中，路径为`/proxy/api`，过期时间5分钟
- **Refresh Token**: 继续存储在HttpOnly Cookie中，路径为`/proxy/api/auth/refresh`，过期时间7天
- **SameSite=Strict**: 防止CSRF攻击
- **Secure**: 生产环境自动启用HTTPS

### 2. 前端简化
- 移除localStorage存储
- 使用内存存储token过期时间
- 自动Cookie管理
- 简化的API调用

### 3. 后端优化
- 统一的Cookie设置函数
- 简化的响应格式
- 新增用户信息查询接口

## 配置说明

### 环境变量
```bash
# JWT密钥
JWT_SECRET_KEY=your_jwt_secret_key_here
JWT_REFRESH_SECRET_KEY=your_jwt_refresh_secret_key_here

# Cookie安全配置
COOKIE_SECURE=false  # 开发环境false，生产环境true
COOKIE_DOMAIN=       # 生产环境设置域名，开发环境留空
```

### Cookie路径配置
- **Access Token**: `/proxy/api` - 覆盖所有API请求
- **Refresh Token**: `/proxy/api/auth/refresh` - 仅刷新接口

## API接口变化

### 登录/注册响应
**之前:**
```json
{
  "message": "登录成功",
  "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "user": {"id": 1, "username": "user@example.com"}
}
```

**现在:**
```json
{
  "message": "登录成功",
  "expires_at": 1700000900
}
```

### 刷新令牌响应
**之前:**
```json
{
  "message": "令牌刷新成功",
  "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "user": {"id": 1, "username": "user@example.com"}
}
```

**现在:**
```json
{
  "message": "令牌刷新成功",
  "expires_at": 1700000900
}
```

### 新增接口

#### 用户信息查询
```
GET /api/auth/user-info
Authorization: Bearer {token} (可选，Cookie优先)
```

响应:
```json
{
  "id": 1,
  "username": "user@example.com",
  "email": "user@example.com",
  "created_at": "2024-01-01T00:00:00",
  "last_login": "2024-01-01T12:00:00"
}
```

## 前端使用

### 认证检查
```javascript
// 检查用户是否已认证
const isAuth = await AuthSystem.isUserAuthenticated();

// 同步检查（用于UI渲染）
const isAuthSync = AuthSystem.isUserAuthenticatedSync();

// 获取当前用户
const user = AuthSystem.getCurrentUser();
```

### API调用
```javascript
// 现在不需要手动添加Authorization header
// Cookie会自动发送
const response = await fetch('/proxy/api/some-endpoint', {
    method: 'GET',
    credentials: 'include'  // 重要：确保发送Cookie
});
```

### 登出
```javascript
// 清除内存状态并跳转到认证页面
AuthSystem.logout();
```

## 迁移指南

### 从旧版本升级
1. 更新后端代码
2. 更新前端auth-system.js
3. 清除旧的localStorage数据
4. 测试新的认证流程

### 注意事项
- 确保所有API请求都包含`credentials: 'include'`
- 检查Cookie路径配置是否正确
- 生产环境设置`COOKIE_SECURE=true`
- 设置正确的`COOKIE_DOMAIN`

## 测试

使用`test_new_auth.html`文件测试新认证系统：
- 认证状态检查
- Cookie状态检查
- API调用测试
- 用户信息获取

## 故障排除

### 常见问题

1. **Cookie不发送**
   - 检查`credentials: 'include'`
   - 验证Cookie路径配置

2. **认证失败**
   - 检查Cookie是否过期
   - 验证JWT密钥配置

3. **跨域问题**
   - 确保CORS配置正确
   - 检查Cookie域名设置

### 调试信息
```javascript
// 获取详细认证状态
const authState = AuthSystem.getAuthState();
console.log(authState);
```

## 版本历史

- **v4.0.0**: Cookie-based认证系统
- **v3.0.0**: 重构版本，localStorage存储
- **v2.0.0**: 基础JWT认证
- **v1.0.0**: 初始版本
