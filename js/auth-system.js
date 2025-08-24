// LibreTV JWT认证系统集成
// 这个文件用于在现有页面中集成JWT认证功能

const AUTH_CONFIG = {
    API_BASE_URL: '/proxy/api', // 通过代理访问后端API
    TOKEN_KEY: 'libretv_jwt_token',
    USER_KEY: 'libretv_user_info',
    TOKEN_REFRESH_INTERVAL: 5 * 60 * 1000, // 5分钟检查一次令牌
};

// 全局认证状态
let isAuthenticated = false;
let currentUser = null;
let tokenRefreshTimer = null;

// 初始化认证系统
function initAuthSystem() {
    checkAuthStatus();
    startTokenRefreshTimer();

    // 添加用户信息显示
    updateUserDisplay();

    // 绑定弹框表单事件
    bindAuthModalEvents();
}

// 检查认证状态
function checkAuthStatus() {
    const token = getStoredToken();
    const user = getStoredUser();

    if (token && user && !isTokenExpired(token)) {
        isAuthenticated = true;
        currentUser = user;
        hideAuthModal();
        updateUserDisplay();
        return true;
    } else {
        isAuthenticated = false;
        currentUser = null;
        if (token && isTokenExpired(token)) {
            clearAuthData();
        }
        showAuthModal();
        return false;
    }
}

// 显示认证弹窗
function showAuthModal() {
    const authModal = document.getElementById('authModal');
    if (authModal) {
        authModal.style.display = 'flex';
    }
}

// 隐藏认证弹窗
function hideAuthModal() {
    const authModal = document.getElementById('authModal');
    if (authModal) {
        authModal.style.display = 'none';
    }
}

// 前往认证页面（已废弃，现在使用弹框）
function goToAuth() {
    // 不再跳转，直接显示弹框
    showAuthModal();
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
    console.log("refresh之前的token： " + token)
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
            console.log("refresh之后的token： " + token)
            storeAuthData(data.token, getStoredUser());
            return true;
        } else {
            clearAuthData();
            return false;
        }
    } catch (error) {
        console.error('刷新令牌错误:', error);
        clearAuthData();
        return false;
    }
}

// 存储认证数据
function storeAuthData(token, user) {
    localStorage.setItem(AUTH_CONFIG.TOKEN_KEY, token);
    localStorage.setItem(AUTH_CONFIG.USER_KEY, JSON.stringify(user));
    isAuthenticated = true;
    currentUser = user;
}

// 清除认证数据
function clearAuthData() {
    localStorage.removeItem(AUTH_CONFIG.TOKEN_KEY);
    localStorage.removeItem(AUTH_CONFIG.USER_KEY);
    isAuthenticated = false;
    currentUser = null;
}

// 用户登出
function logout() {
    localStorage.clear();
    clearAuthData();
    showAuthModal();
    updateUserDisplay();

    // 显示登出成功消息
    if (window.showToast) {
        window.showToast('已成功登出', 'success');
    }
}

// 更新用户显示
function updateUserDisplay() {
    // 更新设置标题
    const settingTitle = document.getElementById('settingTitle');
    if (settingTitle && currentUser) {
        settingTitle.innerText = currentUser.username + '的设置';
    }

    // // 添加用户信息到设置面板
    // const settingsPanel = document.getElementById('settingsPanel');
    // if (settingsPanel && currentUser) {
    //     // 检查是否已经添加了用户信息区域
    //     let userInfoSection = settingsPanel.querySelector('.user-info-section');
    //     if (!userInfoSection) {
    //         userInfoSection = document.createElement('div');
    //         userInfoSection.className = 'user-info-section p-3 bg-[#151515] rounded-lg shadow-inner mb-5';
    //         userInfoSection.innerHTML = `
    //             <label class="block text-sm font-medium text-gray-400 mb-3 border-b border-[#333] pb-1">用户信息</label>
    //             <div class="space-y-2 text-sm">
    //                 <div class="flex justify-between">
    //                     <span class="text-gray-400">用户名:</span>
    //                     <span class="text-white">${currentUser.username}</span>
    //                 </div>
    //                 ${currentUser.email ? `
    //                 <div class="flex justify-between">
    //                     <span class="text-gray-400">邮箱:</span>
    //                     <span class="text-white">${currentUser.email}</span>
    //                 </div>
    //                 ` : ''}
    //                 <div class="pt-2">
    //                     <button onclick="logout()" class="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors">
    //                         退出登录
    //                     </button>
    //                 </div>
    //             </div>
    //         `;

    //         // 插入到设置面板的开头
    //         const firstChild = settingsPanel.querySelector('.space-y-5');
    //         if (firstChild) {
    //             firstChild.insertBefore(userInfoSection, firstChild.firstChild);
    //         }
    //     } else {
    //         // 更新现有用户信息
    //         const usernameSpan = userInfoSection.querySelector('.text-white');
    //         if (usernameSpan) {
    //             usernameSpan.textContent = currentUser.username;
    //         }
    //     }
    // }
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

// 获取认证头（用于API请求）
function getAuthHeaders() {
    const token = getStoredToken();
    if (token) {
        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
    }
    return {
        'Content-Type': 'application/json'
    };
}

// 检查是否已认证
function isUserAuthenticated() {
    return isAuthenticated && currentUser;
}

// 获取当前用户
function getCurrentUser() {
    return currentUser;
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function () {
    initAuthSystem();
});

// 页面卸载时清理定时器
window.addEventListener('beforeunload', () => {
    if (tokenRefreshTimer) {
        clearInterval(tokenRefreshTimer);
    }
});

// 导出认证相关函数供其他脚本使用
window.AuthSystem = {
    checkAuthStatus,
    isUserAuthenticated,
    getCurrentUser,
    getStoredToken,
    getStoredUser,
    getAuthHeaders,
    logout,
    goToAuth,
    refreshToken,
    clearAuthData,
    storeAuthData
};

// 绑定弹框表单事件
function bindAuthModalEvents() {
    // 绑定登录表单
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // 绑定注册表单
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }

    // 绑定用户名检查事件
    const registerUsername = document.getElementById('registerUsername');
    if (registerUsername) {
        registerUsername.addEventListener('blur', checkUsernameAvailability);
    }
}

// 切换登录/注册模式
function switchAuthMode() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const switchText = document.getElementById('loginSwitchText');
    const switchBtn = document.getElementById('authSwitchBtn');

    if (loginForm && registerForm && switchText && switchBtn) {
        if (loginForm.style.display !== 'none') {
            // 切换到注册模式
            loginForm.style.display = 'none';
            registerForm.style.display = 'block';
            switchText.textContent = '已有账号？';
            switchBtn.textContent = '立即登录';
        } else {
            // 切换到登录模式
            loginForm.style.display = 'block';
            registerForm.style.display = 'none';
            switchText.textContent = '还没有账号？';
            switchBtn.textContent = '立即注册';
        }

        // 清空消息
        hideMessages();
    }
}

// 处理登录
async function handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById('loginUsername')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;

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
            showSuccess('登录成功！');
            hideAuthModal();
            syncConfig()

            // 触发认证成功事件，让播放器页面初始化
            document.dispatchEvent(new CustomEvent('authVerified'));

            // 延迟更新UI
            setTimeout(() => {
                updateUserDisplay();
            }, 1000);
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

    const username = document.getElementById('registerUsername')?.value.trim();
    const password = document.getElementById('registerPassword')?.value;
    const confirmPassword = document.getElementById('confirmPassword')?.value;

    // 验证输入
    if (!username || !password || !confirmPassword) {
        showError('请填写完整的注册信息');
        return;
    }

    if (username.length < 3 || username.length > 50) {
        showError('用户名长度必须在3-50个字符之间');
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
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            // 注册成功
            storeAuthData(data.token, data.user);
            showSuccess('登录成功！');
            hideAuthModal();

            // 触发认证成功事件，让播放器页面初始化
            document.dispatchEvent(new CustomEvent('authVerified'));

            // 延迟更新UI
            setTimeout(() => {
                updateUserDisplay();
            }, 1000);
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
    const username = document.getElementById('registerUsername')?.value.trim();

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
                const input = document.getElementById('registerUsername');
                if (input) input.style.borderColor = '#22c55e';
            } else {
                // 用户名不可用
                const input = document.getElementById('registerUsername');
                if (input) input.style.borderColor = '#ef4444';
                showError('用户名已被使用');
            }
        } else {
            showError(data.error || '注册失败');
        }
    } catch (error) {
        console.error('检查用户名错误:', error);
    }
}

// 设置按钮加载状态
function setButtonLoading(buttonId, loading) {
    const button = document.getElementById(buttonId);
    if (!button) return;

    const btnText = button.querySelector('.btn-text');
    const loadingSpinner = button.querySelector('.loading');

    if (loading) {
        button.disabled = true;
        if (btnText) btnText.style.display = 'none';
        if (loadingSpinner) loadingSpinner.style.display = 'inline-block';
    } else {
        button.disabled = false;
        if (btnText) btnText.style.display = 'inline';
        if (loadingSpinner) loadingSpinner.style.display = 'none';
    }
}

// 显示错误消息
function showError(message) {
    const errorElement = document.getElementById('errorMessage');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';

        // 自动隐藏
        setTimeout(() => {
            hideMessages();
        }, 5000);
    }
}

// 显示成功消息
function showSuccess(message) {
    const successElement = document.getElementById('successMessage');
    if (successElement) {
        successElement.textContent = message;
        successElement.style.display = 'block';
    }
}

// 隐藏所有消息
function hideMessages() {
    const errorElement = document.getElementById('errorMessage');
    const successElement = document.getElementById('successMessage');

    if (errorElement) errorElement.style.display = 'none';
    if (successElement) successElement.style.display = 'none';
}

// 全局函数，供HTML中的onclick调用
window.goToAuth = goToAuth;
window.checkAuthStatus = checkAuthStatus;
window.logout = logout;
window.switchAuthMode = switchAuthMode;
