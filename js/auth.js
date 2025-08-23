// 认证系统配置
const AUTH_CONFIG = {
    API_BASE_URL: '/proxy/api', // 通过代理访问后端API
    TOKEN_KEY: 'libretv_jwt_token',
    USER_KEY: 'libretv_user_info',
    TOKEN_REFRESH_INTERVAL: 5 * 60 * 1000, // 5分钟检查一次令牌
};

// 全局变量
let isLoginMode = true;
let tokenRefreshTimer = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    initAuth();
    checkExistingAuth();
});

// 初始化认证系统
function initAuth() {
    // 绑定表单提交事件
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    
    // 绑定用户名检查事件（实时检查）
    document.getElementById('registerUsername').addEventListener('blur', checkUsernameAvailability);
    
    // 设置令牌刷新定时器
    startTokenRefreshTimer();
}

// 检查现有认证状态
function checkExistingAuth() {
    const token = getStoredToken();
    if (token && !isTokenExpired(token)) {
        // 如果令牌有效，重定向到首页
        window.location.href = 'index.html';
    }
}

// 切换登录/注册模式
function switchAuthMode() {
    isLoginMode = !isLoginMode;
    
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const switchText = document.getElementById('loginSwitchText');
    const switchBtn = document.getElementById('authSwitchBtn');
    
    if (isLoginMode) {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        switchText.textContent = '还没有账号？';
        switchBtn.textContent = '立即注册';
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        switchText.textContent = '已有账号？';
        switchBtn.textContent = '立即登录';
    }
    
    // 清空消息
    hideMessages();
}

// 处理登录
async function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!username || !password) {
        showError('请填写完整的登录信息');
        return;
    }
    
    setButtonLoading('loginBtn', true);
    
    try {
        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // 登录成功
            storeAuthData(data.token, data.user);
            showSuccess('登录成功，正在跳转...');
            
            // 延迟跳转，让用户看到成功消息
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);
        } else {
            showError(data.error || '登录失败');
        }
    } catch (error) {
        console.error('登录错误:', error);
        showError('网络错误，请检查网络连接');
    } finally {
        setButtonLoading('loginBtn', false);
    }
}

// 处理注册
async function handleRegister(event) {
    event.preventDefault();
    
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    // 验证输入
    if (!username || !password || !confirmPassword) {
        showError('请填写完整的注册信息');
        return;
    }
    
    if (username.length < 3 || username.length > 20) {
        showError('用户名长度必须在3-20个字符之间');
        return;
    }
    
    if (password.length < 6) {
        showError('密码长度至少6个字符');
        return;
    }
    
    if (password !== confirmPassword) {
        showError('两次输入的密码不一致');
        return;
    }
    
    setButtonLoading('registerBtn', true);
    
    try {
        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // 注册成功
            storeAuthData(data.token, data.user);
            showSuccess('注册成功，正在跳转...');
            
            // 延迟跳转
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);
        } else {
            showError(data.error || '注册失败');
        }
    } catch (error) {
        console.error('注册错误:', error);
        showError('网络错误，请检查网络连接');
    } finally {
        setButtonLoading('registerBtn', false);
    }
}

// 检查用户名是否可用
async function checkUsernameAvailability() {
    const username = document.getElementById('registerUsername').value.trim();
    
    if (!username || username.length < 3) {
        return;
    }
    
    try {
        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/check-username`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (data.available) {
                // 用户名可用，可以添加视觉提示
                document.getElementById('registerUsername').style.borderColor = '#22c55e';
            } else {
                // 用户名不可用
                document.getElementById('registerUsername').style.borderColor = '#ef4444';
                showError('用户名已被使用');
            }
        }
    } catch (error) {
        console.error('检查用户名错误:', error);
    }
}

// 存储认证数据
function storeAuthData(token, user) {
    localStorage.setItem(AUTH_CONFIG.TOKEN_KEY, token);
    localStorage.setItem(AUTH_CONFIG.USER_KEY, JSON.stringify(user));
}

// 获取存储的令牌
function getStoredToken() {
    return localStorage.getItem(AUTH_CONFIG.TOKEN_KEY);
}

// 获取存储的用户信息
function getStoredUser() {
    const userStr = localStorage.getItem(AUTH_CONFIG.USER_KEY);
    return userStr ? JSON.parse(userStr) : null;
}

// 检查令牌是否过期
function isTokenExpired(token) {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp * 1000 < Date.now();
    } catch (error) {
        return true;
    }
}

// 刷新令牌
async function refreshToken() {
    const token = getStoredToken();
    if (!token) return false;
    
    try {
        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            storeAuthData(data.token, getStoredUser());
            return true;
        } else {
            // 刷新失败，清除存储的认证数据
            clearAuthData();
            return false;
        }
    } catch (error) {
        console.error('刷新令牌错误:', error);
        clearAuthData();
        return false;
    }
}

// 清除认证数据
function clearAuthData() {
    localStorage.removeItem(AUTH_CONFIG.TOKEN_KEY);
    localStorage.removeItem(AUTH_CONFIG.USER_KEY);
}

// 启动令牌刷新定时器
function startTokenRefreshTimer() {
    if (tokenRefreshTimer) {
        clearInterval(tokenRefreshTimer);
    }
    
    tokenRefreshTimer = setInterval(async () => {
        const token = getStoredToken();
        if (token && isTokenExpired(token)) {
            await refreshToken();
        }
    }, AUTH_CONFIG.TOKEN_REFRESH_INTERVAL);
}

// 设置按钮加载状态
function setButtonLoading(buttonId, loading) {
    const button = document.getElementById(buttonId);
    const btnText = button.querySelector('.btn-text');
    const loadingSpinner = button.querySelector('.loading');
    
    if (loading) {
        button.disabled = true;
        btnText.style.display = 'none';
        loadingSpinner.style.display = 'inline-block';
    } else {
        button.disabled = false;
        btnText.style.display = 'inline';
        loadingSpinner.style.display = 'none';
    }
}

// 显示错误消息
function showError(message) {
    const errorElement = document.getElementById('errorMessage');
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    
    // 自动隐藏
    setTimeout(() => {
        hideMessages();
    }, 5000);
}

// 显示成功消息
function showSuccess(message) {
    const successElement = document.getElementById('successMessage');
    successElement.textContent = message;
    successElement.style.display = 'block';
}

// 隐藏所有消息
function hideMessages() {
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('successMessage').style.display = 'none';
}

// 页面卸载时清理定时器
window.addEventListener('beforeunload', () => {
    if (tokenRefreshTimer) {
        clearInterval(tokenRefreshTimer);
    }
});

// 导出认证相关函数供其他页面使用
window.AuthSystem = {
    getStoredToken,
    getStoredUser,
    isTokenExpired,
    refreshToken,
    clearAuthData,
    storeAuthData
};
