from flask import Flask, request, make_response, jsonify
from flask_cors import CORS
import sqlite3
import os
import json
import jwt
import datetime
import hashlib
from functools import wraps
import time
import logging
from logging.handlers import RotatingFileHandler
import re


app = Flask(__name__)
CORS(app)

# 配置日志
if not os.path.exists('logs'):
    os.makedirs('logs')

# 创建日志记录器
handler = RotatingFileHandler('logs/app.log', maxBytes=10240, backupCount=10)
handler.setFormatter(logging.Formatter(
    '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
))
handler.setLevel(logging.INFO)
app.logger.addHandler(handler)
app.logger.setLevel(logging.INFO)

app.logger.info('应用启动')

# 设置 JSON 编码为 UTF-8
app.config['JSON_AS_ASCII'] = False
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False
app.config['JSONIFY_MIMETYPE'] = 'application/json; charset=utf-8'

# 配置
app.config['SECRET_KEY'] = os.environ.get(
    'JWT_SECRET_KEY', '88366ca6e0a15c8d113028498a7f44b9cabed3ead55dcfeb68021da278c9fe3e')
app.config['REFRESH_SECRET_KEY'] = os.environ.get(
    'JWT_REFRESH_SECRET_KEY', 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f')
app.config['JWT_ALGORITHM'] = 'HS256'
app.config['ACCESS_TOKEN_EXPIRATION_MINUTES'] = 5  # Access Token 5分钟过期
app.config['REFRESH_TOKEN_EXPIRATION_DAYS'] = 7  # Refresh Token 7天过期

DB_PATH = 'data/libretv.db'
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

# 初始化数据库


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        # 用户表
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP,
                login_attempts INTEGER DEFAULT 0,
                locked_until TIMESTAMP,
                is_active BOOLEAN DEFAULT 1
            )
        ''')

        # 刷新令牌表
        conn.execute('''
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                revoked BOOLEAN DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
        ''')

        # 登录尝试记录表
        conn.execute('''
            CREATE TABLE IF NOT EXISTS login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip_address TEXT NOT NULL,
                username TEXT,
                attempt_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN DEFAULT 0
            )
        ''')

        # 观看历史表
        conn.execute('''
            CREATE TABLE IF NOT EXISTS viewing_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                UNIQUE(user_id, key)
            )
        ''')

        conn.commit()


init_db()

# 防刷配置
RATE_LIMIT = {
    'login_attempts_per_ip': 5,
    'register_attempts_per_ip': 3,
    'window_minutes': 1
}

# 工具函数


def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def generate_access_token(user_id, username):
    payload = {
        'user_id': user_id,
        'username': username,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(minutes=app.config['ACCESS_TOKEN_EXPIRATION_MINUTES']),
        'iat': datetime.datetime.utcnow(),
        'type': 'access'
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm=app.config['JWT_ALGORITHM'])


def generate_refresh_token(user_id, username):
    payload = {
        'user_id': user_id,
        'username': username,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(days=app.config['REFRESH_TOKEN_EXPIRATION_DAYS']),
        'iat': datetime.datetime.utcnow(),
        'type': 'refresh'
    }
    return jwt.encode(payload, app.config['REFRESH_SECRET_KEY'], algorithm=app.config['JWT_ALGORITHM'])


def verify_access_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=[
                             app.config['JWT_ALGORITHM']])
        if payload.get('type') != 'access':
            return None
        return payload
    except jwt.ExpiredSignatureError:
        app.logger.warning(f"访问令牌已过期: {token}")
        return None
    except jwt.InvalidTokenError as e:
        app.logger.warning(f"无效的访问令牌: {token}, 错误: {str(e)}")
        return None
    except Exception as e:
        app.logger.error(f"验证访问令牌时出错: {str(e)}")
        return None


def verify_refresh_token(token):
    try:
        payload = jwt.decode(token, app.config['REFRESH_SECRET_KEY'], algorithms=[
                             app.config['JWT_ALGORITHM']])
        if payload.get('type') != 'refresh':
            return None

        # 检查令牌是否在数据库中且未撤销
        token_hash = hash_token(token)
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute(
                'SELECT id FROM refresh_tokens WHERE token_hash = ? AND revoked = 0 AND expires_at > ?',
                (token_hash, datetime.datetime.utcnow().isoformat())
            )
            if not cursor.fetchone():
                app.logger.warning(f"刷新令牌无效或已撤销: {token_hash}")
                return None

        return payload
    except jwt.ExpiredSignatureError:
        app.logger.warning(f"刷新令牌已过期: {token}")
        return None
    except jwt.InvalidTokenError as e:
        app.logger.warning(f"无效的刷新令牌: {token}, 错误: {str(e)}")
        return None
    except Exception as e:
        app.logger.error(f"验证刷新令牌时出错: {str(e)}")
        return None


def check_rate_limit(ip_address, action_type):
    with sqlite3.connect(DB_PATH) as conn:
        window_start = datetime.datetime.utcnow(
        ) - datetime.timedelta(minutes=RATE_LIMIT['window_minutes'])
        conn.execute(
            'DELETE FROM login_attempts WHERE attempt_time < ?', (window_start,))

        limit = RATE_LIMIT['login_attempts_per_ip'] if action_type == 'login' else RATE_LIMIT['register_attempts_per_ip']

        cursor = conn.execute(
            'SELECT COUNT(*) FROM login_attempts WHERE ip_address = ? AND attempt_time > ?',
            (ip_address, window_start)
        )
        count = cursor.fetchone()[0]

        if count >= limit:
            app.logger.warning(f"IP {ip_address} 的 {action_type} 请求过于频繁，已限制")

        return count < limit


def record_attempt(ip_address, username, success):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            'INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, ?)',
            (ip_address, username, success)
        )
        conn.commit()

    if success:
        app.logger.info(f"成功尝试: IP {ip_address}, 用户名 {username}")
    else:
        app.logger.warning(f"失败尝试: IP {ip_address}, 用户名 {username}")


def get_client_ip():
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0]
    return request.remote_addr


def set_refresh_token_cookie(response, token):
    response.set_cookie(
        'refreshToken',
        token,
        httponly=True,
        secure=False,  # 开发环境设为False，生产环境应设为True
        path='/proxy/api/auth/refresh',  # 确保路径与前端请求路径完全匹配
        samesite='Strict',  # 保持Strict以确保安全性
        max_age=app.config['REFRESH_TOKEN_EXPIRATION_DAYS'] * 24 * 3600
    )
    return response


def revoke_refresh_tokens(user_id):
    """撤销用户的所有刷新令牌"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?',
            (user_id,)
        )
        conn.commit()
    app.logger.info(f"已撤销用户 {user_id} 的所有刷新令牌")


def store_refresh_token(user_id, token):
    """存储刷新令牌的哈希值到数据库"""
    token_hash = hash_token(token)
    expires_at = datetime.datetime.utcnow(
    ) + datetime.timedelta(days=app.config['REFRESH_TOKEN_EXPIRATION_DAYS'])

    with sqlite3.connect(DB_PATH) as conn:
        # 先撤销用户的所有旧令牌
        conn.execute(
            'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?',
            (user_id,)
        )

        # 存储新令牌
        conn.execute(
            'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
            (user_id, token_hash, expires_at.isoformat())
        )
        conn.commit()
    app.logger.info(f"已为用户 {user_id} 存储新的刷新令牌")

# JWT认证装饰器
def jwt_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            app.logger.warning("请求缺少认证令牌")
            return jsonify({'error': '缺少认证令牌'}), 401

        if token.startswith('Bearer '):
            token = token[7:]

        payload = verify_access_token(token)
        if not payload:
            return jsonify({'error': '无效或过期的访问令牌'}), 401

        request.user = payload
        app.logger.info(
            f"用户 {payload['username']} (ID: {payload['user_id']}) 认证成功")
        return f(*args, **kwargs)
    return decorated_function


@app.route('/api/viewing-history/operation', methods=['GET', 'POST'])
@jwt_required
def user_viewing_history():
    try:
        user_id = request.user['user_id']
        key = request.args.get('key', '').strip()

        if not key:
            app.logger.warning("缺少URL参数key")
            return jsonify({'error': '缺少URL参数key'}), 400

        if request.method == 'GET':
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.execute(
                    'SELECT data FROM viewing_history WHERE user_id = ? AND key = ?',
                    (user_id, key)
                )
                row = cursor.fetchone()

                if not row:
                    app.logger.warning("该key不存在")
                    return jsonify({'error': '该key不存在'}), 404

                return jsonify({'data': row[0]}), 200

        elif request.method == 'POST':
            if not request.headers.get('Content-Type', '').startswith('application/json'):
                return jsonify({'error': '仅支持application/json'}), 415

            data = request.get_json()
            if not data:
                return jsonify({'error': '请求体不能为空'}), 400

            with sqlite3.connect(DB_PATH) as conn:
                conn.execute(
                    'INSERT OR REPLACE INTO viewing_history (user_id, key, data) VALUES (?, ?, ?)',
                    (user_id, key, json.dumps(data, separators=(',', ':')))
                )
                conn.commit()

            return jsonify({'message': '保存成功'}), 200

    except Exception as e:
        return jsonify({'error': f'操作失败: {str(e)}'}), 500


# 邮箱格式验证函数
def is_valid_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

# 检查用户名是否可用
@app.route('/api/auth/check-username', methods=['POST'])
def check_username():
    try:
        data = request.get_json()
        username = data.get('username', '').strip()

        if not username:
            return jsonify({'error': '用户名不能为空'}), 400

        # 验证用户名必须是邮箱格式
        if not is_valid_email(username):
            return jsonify({'error': '用户名必须是有效的邮箱格式'}), 400

        if len(username) < 5 or len(username) > 50:
            return jsonify({'error': '用户名长度必须在5-50个字符之间'}), 400

        client_ip = get_client_ip()
        if not check_rate_limit(client_ip, 'register'):
            return jsonify({'error': '请求过于频繁，请稍后再试'}), 429

        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute(
                'SELECT id FROM users WHERE username = ?', (username,))
            exists = cursor.fetchone() is not None

            return jsonify({
                'username': username,
                'available': not exists
            }), 200

    except Exception as e:
        return jsonify({'error': f'检查失败: {str(e)}'}), 500

# 用户注册
@app.route('/api/auth/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        email = data.get('email', '').strip()

        app.logger.info(f"注册请求: 用户名 {username}, 邮箱 {email}")

        if not username or not password:
            app.logger.warning("注册请求缺少用户名或密码")
            return jsonify({'error': '用户名和密码不能为空'}), 400

        # 验证用户名必须是邮箱格式
        if not is_valid_email(username):
            app.logger.warning(f"用户名格式无效: {username}")
            return jsonify({'error': '用户名必须是有效的邮箱格式'}), 400

        if len(username) < 5 or len(username) > 50:
            app.logger.warning(f"用户名长度不符合要求: {username}")
            return jsonify({'error': '用户名长度必须在5-50个字符之间'}), 400

        if len(password) < 6:
            app.logger.warning("密码长度不符合要求")
            return jsonify({'error': '密码长度至少6个字符'}), 400

        client_ip = get_client_ip()
        if not check_rate_limit(client_ip, 'register'):
            return jsonify({'error': '注册请求过于频繁，请稍后再试'}), 429

        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute(
                'SELECT id FROM users WHERE username = ?', (username,))
            if cursor.fetchone():
                record_attempt(client_ip, username, False)
                app.logger.warning(f"用户名已存在: {username}")
                return jsonify({'error': '用户名已存在'}), 409

            # 邮箱字段可选，如果提供则检查唯一性
            if email:  # 只有当提供了email时才检查
                # 验证邮箱格式（如果提供）
                if not is_valid_email(email):
                    app.logger.warning(f"邮箱格式无效: {email}")
                    return jsonify({'error': '邮箱格式无效'}), 400
                    
                cursor = conn.execute(
                    'SELECT id FROM users WHERE email = ?', (email,))
                if cursor.fetchone():
                    record_attempt(client_ip, username, False)
                    app.logger.warning(f"邮箱已被使用: {email}")
                    return jsonify({'error': '邮箱已被使用'}), 409

            password_hash = hash_password(password)

            # 根据是否提供email来构建不同的SQL语句
            if email:
                cursor = conn.execute(
                    'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
                    (username, password_hash, email)
                )
            else:
                cursor = conn.execute(
                    'INSERT INTO users (username, password_hash) VALUES (?, ?)',
                    (username, password_hash)
                )

            user_id = cursor.lastrowid
            conn.commit()

            record_attempt(client_ip, username, True)

            # 生成访问令牌和刷新令牌
            access_token = generate_access_token(user_id, username)
            refresh_token = generate_refresh_token(user_id, username)

            # 存储刷新令牌
            store_refresh_token(user_id, refresh_token)

            # 创建响应并设置刷新令牌Cookie
            response_data = {
                'message': '注册成功',
                'token': access_token,
                'user': {'id': user_id, 'username': username, 'email': email if email else None}
            }

            response = make_response(jsonify(response_data))
            response.headers['Content-Type'] = 'application/json; charset=utf-8'
            response = set_refresh_token_cookie(response, refresh_token)

            app.logger.info(f"用户注册成功: {username} (ID: {user_id})")
            return response, 201

    except Exception as e:
        app.logger.error(f"注册过程中出错: {str(e)}")
        return jsonify({'error': f'注册失败: {str(e)}'}), 500


# 用户登录
@app.route('/api/auth/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        password = data.get('password', '')

        app.logger.info(f"登录请求: 用户名 {username}")

        if not username or not password:
            app.logger.warning("登录请求缺少用户名或密码")
            return jsonify({'error': '用户名和密码不能为空'}), 400

        client_ip = get_client_ip()
        if not check_rate_limit(client_ip, 'login'):
            return jsonify({'error': '登录请求过于频繁，请稍后再试'}), 429

        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute(
                'SELECT id, username, password_hash, login_attempts, locked_until, is_active FROM users WHERE username = ?',
                (username,)
            )
            user = cursor.fetchone()

            if not user:
                record_attempt(client_ip, username, False)
                app.logger.warning(f"登录失败: 用户名不存在 {username}")
                return jsonify({'error': '用户名或密码错误'}), 401

            user_id, db_username, password_hash, login_attempts, locked_until, is_active = user

            if not is_active:
                record_attempt(client_ip, username, False)
                app.logger.warning(f"登录失败: 账户已被禁用 {username}")
                return jsonify({'error': '账户已被禁用'}), 403

            if locked_until and datetime.datetime.utcnow() < datetime.datetime.fromisoformat(locked_until):
                app.logger.warning(f"登录失败: 账户已被锁定 {username}")
                return jsonify({'error': '账户已被锁定，请稍后再试'}), 423

            if hash_password(password) != password_hash:
                new_attempts = login_attempts + 1
                if new_attempts >= 5:
                    lock_until = datetime.datetime.utcnow() + datetime.timedelta(minutes=30)
                    conn.execute(
                        'UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?',
                        (new_attempts, lock_until.isoformat(), user_id)
                    )
                    app.logger.warning(f"用户 {username} 因多次失败尝试被锁定")
                else:
                    conn.execute(
                        'UPDATE users SET login_attempts = ? WHERE id = ?',
                        (new_attempts, user_id)
                    )
                conn.commit()

                record_attempt(client_ip, username, False)
                app.logger.warning(f"登录失败: 密码错误 {username}")
                return jsonify({'error': '用户名或密码错误'}), 401

            conn.execute(
                'UPDATE users SET login_attempts = 0, locked_until = NULL, last_login = ? WHERE id = ?',
                (datetime.datetime.utcnow().isoformat(), user_id)
            )
            conn.commit()

            record_attempt(client_ip, username, True)

            # 生成访问令牌和刷新令牌
            access_token = generate_access_token(user_id, username)
            refresh_token = generate_refresh_token(user_id, username)

            # 存储刷新令牌
            store_refresh_token(user_id, refresh_token)

            # 创建响应并设置刷新令牌Cookie
            response_data = {
                'message': '登录成功',
                'token': access_token,
                'user': {'id': user_id, 'username': username}
            }

            response = make_response(jsonify(response_data))
            response.headers['Content-Type'] = 'application/json; charset=utf-8'
            response = set_refresh_token_cookie(response, refresh_token)

            app.logger.info(f"用户登录成功: {username} (ID: {user_id})")
            return response, 200

    except Exception as e:
        app.logger.error(f"登录过程中出错: {str(e)}")
        return jsonify({'error': f'登录失败: {str(e)}'}), 500

# 刷新令牌
@app.route('/api/auth/refresh', methods=['POST'])
def refresh_token():
    try:
        # 从Cookie中获取刷新令牌
        refresh_token = request.cookies.get('refreshToken')
        if not refresh_token:
            app.logger.warning("刷新令牌请求缺少Cookie")
            return jsonify({'error': '缺少刷新令牌'}), 401

        app.logger.info("收到刷新令牌请求")

        # 验证刷新令牌
        payload = verify_refresh_token(refresh_token)
        if not payload:
            return jsonify({'error': '无效或过期的刷新令牌'}), 401

        user_id = payload['user_id']
        username = payload['username']

        # 从数据库获取完整的用户信息
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute(
                'SELECT username, email FROM users WHERE id = ?', (user_id,)
            )
            user_data = cursor.fetchone()
            
            if not user_data:
                app.logger.error(f"用户 {user_id} 不存在")
                return jsonify({'error': '用户不存在'}), 404

        # 生成新的访问令牌
        new_access_token = generate_access_token(user_id, username)

        # 构建用户信息
        user_info = {
            'id': user_id,
            'username': user_data[0],
            'email': user_data[1]
        }

        response_data = {
            'message': '令牌刷新成功',
            'token': new_access_token,
            'user': user_info
        }

        response = make_response(jsonify(response_data))
        response.headers['Content-Type'] = 'application/json; charset=utf-8'

        app.logger.info(f"令牌刷新成功: 用户 {username} (ID: {user_id})")
        return response, 200

    except Exception as e:
        app.logger.error(f"刷新令牌过程中出错: {str(e)}")
        return jsonify({'error': f'令牌刷新失败: {str(e)}'}), 500

# 登出
@app.route('/api/auth/logout', methods=['POST'])
@jwt_required
def logout():
    try:
        user_id = request.user['user_id']
        username = request.user['username']

        # 撤销用户的所有刷新令牌
        revoke_refresh_tokens(user_id)

        # 创建响应并清除刷新令牌Cookie
        response_data = {'message': '登出成功'}
        response = make_response(jsonify(response_data))
        response.headers['Content-Type'] = 'application/json; charset=utf-8'
        response.set_cookie(
            'refreshToken',
            '',
            expires=0,
            path='/proxy/api/auth/refresh'
        )

        app.logger.info(f"用户登出成功: {username} (ID: {user_id})")
        return response, 200
    except Exception as e:
        app.logger.error(f"登出过程中出错: {str(e)}")
        return jsonify({'error': f'登出失败: {str(e)}'}), 500

# 健康检查端点
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'message': '服务正常运行'})


if __name__ == '__main__':
    app.logger.info('启动应用服务器...')
    app.run(host='0.0.0.0', port=5002, debug=False)
