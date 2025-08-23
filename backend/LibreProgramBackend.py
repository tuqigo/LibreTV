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

app = Flask(__name__)
CORS(app)

# 设置 JSON 编码为 UTF-8
app.config['JSON_AS_ASCII'] = False
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False

# 配置
app.config['SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', '88366ca6e0a15c8d113028498a7f44b9cabed3ead55dcfeb68021da278c9fe3e')
app.config['JWT_ALGORITHM'] = 'HS256'
app.config['JWT_EXPIRATION_HOURS'] = 24 * 7

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
        
        # 用户配置表
        conn.execute('''
            CREATE TABLE IF NOT EXISTS user_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                config_key TEXT NOT NULL,
                config_value TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                UNIQUE(user_id, config_key)
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

def generate_jwt_token(user_id, username):
    payload = {
        'user_id': user_id,
        'username': username,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=app.config['JWT_EXPIRATION_HOURS']),
        'iat': datetime.datetime.utcnow()
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm=app.config['JWT_ALGORITHM'])

def verify_jwt_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=[app.config['JWT_ALGORITHM']])
        return payload
    except:
        return None

def check_rate_limit(ip_address, action_type):
    with sqlite3.connect(DB_PATH) as conn:
        window_start = datetime.datetime.utcnow() - datetime.timedelta(minutes=RATE_LIMIT['window_minutes'])
        conn.execute('DELETE FROM login_attempts WHERE attempt_time < ?', (window_start,))
        
        limit = RATE_LIMIT['login_attempts_per_ip'] if action_type == 'login' else RATE_LIMIT['register_attempts_per_ip']
        
        cursor = conn.execute(
            'SELECT COUNT(*) FROM login_attempts WHERE ip_address = ? AND attempt_time > ?',
            (ip_address, window_start)
        )
        count = cursor.fetchone()[0]
        
        return count < limit

def record_attempt(ip_address, username, success):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            'INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, ?)',
            (ip_address, username, success)
        )
        conn.commit()

def get_client_ip():
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0]
    return request.remote_addr

# JWT认证装饰器
def jwt_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'error': '缺少认证令牌'}), 401
        
        if token.startswith('Bearer '):
            token = token[7:]
        
        payload = verify_jwt_token(token)
        if not payload:
            return jsonify({'error': '无效或过期的令牌'}), 401
        
        request.user = payload
        return f(*args, **kwargs)
    return decorated_function

# 用户注册
@app.route('/api/auth/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        email = data.get('email', '').strip()
        
        if not username or not password:
            return jsonify({'error': '用户名和密码不能为空'}), 400
        
        if len(username) < 3 or len(username) > 50:  # 增加长度限制，支持邮箱地址
            return jsonify({'error': '用户名长度必须在3-50个字符之间'}), 400
        
        if len(password) < 6:
            return jsonify({'error': '密码长度至少6个字符'}), 400
        
        client_ip = get_client_ip()
        if not check_rate_limit(client_ip, 'register'):
            return jsonify({'error': '注册请求过于频繁，请稍后再试'}), 429
        
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute('SELECT id FROM users WHERE username = ?', (username,))
            if cursor.fetchone():
                record_attempt(client_ip, username, False)
                return jsonify({'error': '用户名已存在'}), 409
            
            # 邮箱字段可选，如果提供则检查唯一性
            if email:
                cursor = conn.execute('SELECT id FROM users WHERE email = ? AND email != ""', (email,))
                if cursor.fetchone():
                    record_attempt(client_ip, username, False)
                    return jsonify({'error': '邮箱已被使用'}), 409
            
            password_hash = hash_password(password)
            cursor = conn.execute(
                'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
                (username, password_hash, email)
            )
            user_id = cursor.lastrowid
            conn.commit()
            
            record_attempt(client_ip, username, True)
            token = generate_jwt_token(user_id, username)
            
            return jsonify({
                'message': '注册成功',
                'token': token,
                'user': {'id': user_id, 'username': username, 'email': email}
            }), 201
            
    except Exception as e:
        return jsonify({'error': f'注册失败: {str(e)}'}), 500

# 用户登录
@app.route('/api/auth/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        if not username or not password:
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
                return jsonify({'error': '用户名或密码错误'}), 401
            
            user_id, db_username, password_hash, login_attempts, locked_until, is_active = user
            
            if not is_active:
                record_attempt(client_ip, username, False)
                return jsonify({'error': '账户已被禁用'}), 403
            
            if locked_until and datetime.datetime.utcnow() < datetime.datetime.fromisoformat(locked_until):
                return jsonify({'error': '账户已被锁定，请稍后再试'}), 423
            
            if hash_password(password) != password_hash:
                new_attempts = login_attempts + 1
                if new_attempts >= 5:
                    lock_until = datetime.datetime.utcnow() + datetime.timedelta(minutes=30)
                    conn.execute(
                        'UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?',
                        (new_attempts, lock_until.isoformat(), user_id)
                    )
                else:
                    conn.execute(
                        'UPDATE users SET login_attempts = ? WHERE id = ?',
                        (new_attempts, user_id)
                    )
                conn.commit()
                
                record_attempt(client_ip, username, False)
                return jsonify({'error': '用户名或密码错误'}), 401
            
            conn.execute(
                'UPDATE users SET login_attempts = 0, locked_until = NULL, last_login = ? WHERE id = ?',
                (datetime.datetime.utcnow().isoformat(), user_id)
            )
            conn.commit()
            
            record_attempt(client_ip, username, True)
            token = generate_jwt_token(user_id, username)
            
            return jsonify({
                'message': '登录成功',
                'token': token,
                'user': {'id': user_id, 'username': username}
            }), 200
            
    except Exception as e:
        return jsonify({'error': f'登录失败: {str(e)}'}), 500

# 检查用户名是否可用
@app.route('/api/auth/check-username', methods=['POST'])
def check_username():
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        
        if not username:
            return jsonify({'error': '用户名不能为空'}), 400
        
        if len(username) < 3:
            return jsonify({'error': '用户名长度至少3个字符'}), 400
        
        client_ip = get_client_ip()
        if not check_rate_limit(client_ip, 'register'):
            return jsonify({'error': '请求过于频繁，请稍后再试'}), 429
        
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute('SELECT id FROM users WHERE username = ?', (username,))
            exists = cursor.fetchone() is not None
            
            return jsonify({
                'username': username,
                'available': not exists
            }), 200
            
    except Exception as e:
        return jsonify({'error': f'检查失败: {str(e)}'}), 500

# 获取用户信息
@app.route('/api/auth/profile', methods=['GET'])
@jwt_required
def get_profile():
    try:
        user_id = request.user['user_id']
        
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute(
                'SELECT id, username, email, created_at, last_login FROM users WHERE id = ?',
                (user_id,)
            )
            user = cursor.fetchone()
            
            if not user:
                return jsonify({'error': '用户不存在'}), 404
            
            return jsonify({
                'user': {
                    'id': user[0],
                    'username': user[1],
                    'email': user[2],
                    'created_at': user[3],
                    'last_login': user[4]
                }
            }), 200
            
    except Exception as e:
        return jsonify({'error': f'获取用户信息失败: {str(e)}'}), 500

# 观看历史
@app.route('/api/viewing-history/keys', methods=['GET'])
@jwt_required
def get_user_history_keys():
    try:
        user_id = request.user['user_id']
        
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute(
                'SELECT key FROM viewing_history WHERE user_id = ? ORDER BY created_at DESC',
                (user_id,)
            )
            keys = [row[0] for row in cursor.fetchall()]
            
            return jsonify({'keys': keys}), 200
            
    except Exception as e:
        return jsonify({'error': f'获取历史记录失败: {str(e)}'}), 500

@app.route('/api/viewing-history/operation', methods=['GET', 'POST'])
@jwt_required
def user_viewing_history():
    try:
        user_id = request.user['user_id']
        key = request.args.get('key', '').strip()
        
        if not key:
            return jsonify({'error': '缺少URL参数key'}), 400
        
        if request.method == 'GET':
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.execute(
                    'SELECT data FROM viewing_history WHERE user_id = ? AND key = ?',
                    (user_id, key)
                )
                row = cursor.fetchone()
                
                if not row:
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

# 用户配置
@app.route('/api/user-config/<config_key>', methods=['GET', 'POST'])
@jwt_required
def user_config(config_key):
    try:
        user_id = request.user['user_id']
        
        if request.method == 'GET':
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.execute(
                    'SELECT config_value FROM user_configs WHERE user_id = ? AND config_key = ?',
                    (user_id, config_key)
                )
                row = cursor.fetchone()
                
                if not row:
                    return jsonify({'error': '配置不存在'}), 404
                
                return jsonify({'value': row[0]}), 200
        
        elif request.method == 'POST':
            data = request.get_json()
            if not data or 'value' not in data:
                return jsonify({'error': '缺少配置值'}), 400
            
            config_value = json.dumps(data['value'], separators=(',', ':'))
            
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute(
                    'INSERT OR REPLACE INTO user_configs (user_id, config_key, config_value, updated_at) VALUES (?, ?, ?, ?)',
                    (user_id, config_key, config_value, datetime.datetime.utcnow().isoformat())
                )
                conn.commit()
            
            return jsonify({'message': '配置保存成功'}), 200
            
    except Exception as e:
        return jsonify({'error': f'配置操作失败: {str(e)}'}), 500

# 刷新令牌
@app.route('/api/auth/refresh', methods=['POST'])
@jwt_required
def refresh_token():
    try:
        user_id = request.user['user_id']
        username = request.user['username']
        
        new_token = generate_jwt_token(user_id, username)
        
        return jsonify({
            'message': '令牌刷新成功',
            'token': new_token
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'令牌刷新失败: {str(e)}'}), 500

# 登出
@app.route('/api/auth/logout', methods=['POST'])
@jwt_required
def logout():
    return jsonify({'message': '登出成功'}), 200

# 健康检查
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': datetime.datetime.utcnow().isoformat()}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002, debug=False)
