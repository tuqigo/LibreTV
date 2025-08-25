# LibreTV JWT认证系统使用说明

## 概述

LibreTV现已升级为JWT认证系统，提供完整的用户注册、登录、认证功能，替代了原有的简单密码保护机制。

## 新功能特性

### 🔐 用户认证
- **用户注册**: 支持用户名、密码、邮箱注册
- **用户登录**: 安全的用户名密码登录
- **JWT令牌**: 7天有效期的JWT认证令牌
- **自动刷新**: 令牌自动刷新机制

### 🛡️ 安全特性
- **密码加密**: SHA-256密码哈希存储
- **防刷机制**: 登录/注册频率限制
- **账户锁定**: 多次失败登录后自动锁定
- **IP记录**: 记录登录尝试的IP地址

### 📱 用户体验
- **响应式设计**: 美观的登录注册界面
- **实时验证**: 用户名可用性实时检查
- **错误提示**: 友好的错误信息显示
- **自动跳转**: 认证成功后自动跳转

## 系统架构

### 后端API (Python Flask)
```
/api/auth/register          # 用户注册
/api/auth/login            # 用户登录
/api/auth/check-username   # 检查用户名可用性
/api/auth/profile          # 获取用户信息
/api/auth/refresh          # 刷新令牌
/api/auth/logout           # 用户登出
/api/viewing-history/*     # 观看历史管理
/api/user-config/*         # 用户配置管理
```

### 前端页面
- `auth.html` - 登录注册页面
- `index.html` - 主页面（需要认证）
- `player.html` - 播放页面（需要认证）

## 快速开始

### 1. 启动后端服务

```bash
cd backend
python start.py
```

或者手动安装依赖并启动：

```bash
cd backend
pip install -r requirements.txt
python LibreProgramBackend.py
```

### 2. 访问前端页面

- 打开 `auth.html` 进行用户注册/登录
- 认证成功后自动跳转到主页面
- 所有需要认证的页面都会自动检查JWT令牌

### 3. 环境变量配置

```bash
# 设置JWT密钥（生产环境必须）
export JWT_SECRET_KEY="your-secret-key-here"

# 启动服务
python start.py
```

## 数据库结构

系统使用SQLite数据库，自动创建以下表：

### users - 用户表
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    is_active BOOLEAN DEFAULT 1
);
```

### viewing_history - 观看历史表
```sql
CREATE TABLE viewing_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    UNIQUE(user_id, key)
);
```

### user_configs - 用户配置表
```sql
CREATE TABLE user_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    config_key TEXT NOT NULL,
    config_value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    UNIQUE(user_id, config_key)
);
```

### login_attempts - 登录尝试记录表
```sql
CREATE TABLE login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL,
    username TEXT,
    attempt_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT 0
);
```

## 防刷配置

系统内置防刷机制，可在 `LibreProgramBackend.py` 中调整：

```python
RATE_LIMIT = {
    'login_attempts_per_ip': 5,      # 每个IP每分钟最多5次登录尝试
    'register_attempts_per_ip': 3,   # 每个IP每分钟最多3次注册尝试
    'window_minutes': 1              # 时间窗口（分钟）
}
```

## 部署说明

### 生产环境部署

1. **设置环境变量**
   ```bash
   export JWT_SECRET_KEY="your-secure-secret-key"
   export FLASK_ENV="production"
   ```

2. **使用生产级WSGI服务器**
   ```bash
   pip install gunicorn
   gunicorn -w 4 -b 0.0.0.0:5001 LibreProgramBackend:app
   ```

3. **配置反向代理（Nginx）**
   ```nginx
   location /api/ {
       proxy_pass http://127.0.0.1:5001;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   ```

### Docker部署

```dockerfile
FROM python:3.9-slim

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY backend/ .
EXPOSE 5001

CMD ["python", "LibreProgramBackend.py"]
```

## 前端集成

### 认证状态检查

```javascript
// 检查用户是否已认证
if (window.AuthSystem && window.AuthSystem.isUserAuthenticated()) {
    const user = window.AuthSystem.getCurrentUser();
    console.log('当前用户:', user.username);
}

// 获取认证头
const headers = window.AuthSystem.getAuthHeaders();
```

### API请求示例

```javascript
// 获取用户观看历史
const response = await fetch('/api/viewing-history/keys', {
    headers: window.AuthSystem.getAuthHeaders()
});

// 保存用户配置
await fetch('/api/user-config/theme', {
    method: 'POST',
    headers: window.AuthSystem.getAuthHeaders(),
    body: JSON.stringify({ value: 'dark' })
});
```

## 故障排除

### 常见问题

1. **JWT令牌过期**
   - 系统会自动刷新令牌
   - 如果刷新失败，用户需要重新登录

2. **数据库连接错误**
   - 检查 `data/` 目录权限
   - 确保SQLite数据库文件可写

3. **CORS错误**
   - 后端已启用CORS支持
   - 检查前端请求URL是否正确

4. **认证失败**
   - 检查JWT_SECRET_KEY是否一致
   - 查看后端日志获取详细错误信息

### 日志查看

```bash
# 查看Flask应用日志
tail -f backend/data/libretv.log

# 查看系统日志
journalctl -u libretv -f
```

## 升级说明

### 从旧版本升级

1. **备份数据**
   ```bash
   cp -r backend/data backend/data_backup
   ```

2. **更新代码**
   - 替换所有相关文件
   - 重启后端服务

3. **数据迁移**
   - 旧密码保护数据无法自动迁移
   - 用户需要重新注册登录

### 兼容性

- 新系统完全替代旧密码保护
- 观看历史数据格式保持不变
- 用户配置需要重新设置

## 技术支持

如有问题，请：

1. 查看后端日志获取错误信息
2. 检查浏览器控制台错误
3. 确认环境变量配置正确
4. 提交Issue到项目仓库

---

**注意**: 在生产环境中，请务必设置安全的JWT_SECRET_KEY，并定期更换以提高安全性。
