// LibreTV JWT认证系统集成
// 修复版本：解决生产环境路径重写导致的无限循环问题

const AUTH_CONFIG = {
    API_BASE_URL: '/proxy/api', // 通过代理访问后端API
    TOKEN_KEY: 'libretv_jwt_token',
    USER_KEY: 'libretv_user_info',
    TOKEN_REFRESH_INTERVAL: 5 * 60 * 1000, // 5分钟检查一次令牌
    REDIRECT_DELAY: 1000, // 重定向延迟时间
};

// 全局认证状态
let isAuthenticated = false;
let currentUser = null;
let tokenRefreshTimer = null;

// 页面类型枚举
const PAGE_TYPES = {
    AUTH: 'auth',
    PLAYER: 'player',
    MAIN: 'main'
};

// 检测当前页面类型 - 修复生产环境路径检测
function getCurrentPageType() {
    const pathname = window.location.pathname;
    // 生产环境可能将 .html 重写，所以检查路径中是否包含关键字
    if (pathname.includes('auth') || pathname.endsWith('/auth')) {
        return PAGE_TYPES.AUTH;
    } else if (pathname.includes('player') || pathname.endsWith('/player')) {
        return PAGE_TYPES.PLAYER;
    } else {
        return PAGE_TYPES.MAIN; // index.html 或其他页面
    }
}

// 检测是否为生产环境
function isProductionEnvironment() {
    return window.location.hostname !== 'localhost' && 
           window.location.hostname !== '127.0.0.1' &&
           !window.location.hostname.includes('localhost');
}

// 初始化认证系统
function initAuthSystem() {
    const pageType = getCurrentPageType();
    console.log('当前页面类型:', pageType, '环境:', isProductionEnvironment() ? '生产' : '开发');

    // 防止重复初始化
    if (window.authSystemInitialized) {
        console.log('认证系统已初始化，跳过');
        return;
    }

    try {
        if (pageType === PAGE_TYPES.AUTH) {
            // 认证页面初始化
            initAuthPage();
        } else {
            // 主页面或播放器页面初始化
            initMainPage();
        }
        
        window.authSystemInitialized = true;
    } catch (error) {
        console.error('认证系统初始化失败:', error);
    }
}

// 认证页面初始化
function initAuthPage() {
    console.log('初始化认证页面');
    
    // 检查现有认证状态
    const authStatus = checkExistingAuth();
    
    // 只有在没有有效认证时才继续初始化
    if (!authStatus.isValid) {
        // 绑定表单事件
        bindAuthFormEvents();
        
        // 设置令牌刷新定时器
        startTokenRefreshTimer();
    }
}

// 主页面初始化
function initMainPage() {
    console.log('初始化主页面');
    
    const authStatus = checkAuthStatus();
    if (authStatus.isValid) {
        // 认证有效，继续初始化
        startTokenRefreshTimer();
        updateUserDisplay();
    } else {
        // 认证无效，跳转到认证页面
        redirectToAuth();
    }
}

// 检查现有认证状态（用于认证页面）
function checkExistingAuth() {
    const token = getStoredToken();
    const user = getStoredUser();
    
    if (token && user && !isTokenExpired(token)) {
        console.log('检测到有效认证，准备重定向到首页');
        // 延迟重定向，避免页面闪烁
        setTimeout(() => {
            redirectToMain();
        }, AUTH_CONFIG.REDIRECT_DELAY);
        return { isValid: true, token, user };
    }
    
    return { isValid: false, token: null, user: null };
}

// 检查认证状态（用于主页面）
function checkAuthStatus() {
    const token = getStoredToken();
    const user = getStoredUser();

    if (token && user && !isTokenExpired(token)) {
        isAuthenticated = true;
        currentUser = user;
        updateUserDisplay();
        return { isValid: true, token, user };
    } else {
        isAuthenticated = false;
        currentUser = null;
        
        // 清理过期的认证数据
        if (token && isTokenExpired(token)) {
            console.log('令牌已过期，清理认证数据');
            clearAuthData();
        }
        
        return { isValid: false, token, user };
    }
}

// 安全重定向到主页面
function redirectToMain() {
    console.log('重定向到主页面');
    
    try {
        // 根据环境选择合适的路径
        let targetUrl;
        if (isProductionEnvironment()) {
            // 生产环境：使用根路径，避免 .html 扩展名问题
            targetUrl = '/';
        } else {
            // 开发环境：使用相对路径
            targetUrl = 'index.html';
        }
        
        console.log('目标URL:', targetUrl);
        window.location.href = targetUrl;
    } catch (error) {
        console.error('重定向失败:', error);
    }
}

// 安全重定向到认证页面
function redirectToAuth() {
    // 检查当前是否已经在认证页面
    if (getCurrentPageType() === PAGE_TYPES.AUTH) {
        console.log('当前已在认证页面，跳过重定向');
        return;
    }
    
    console.log('重定向到认证页面');
    
    try {
        // 根据环境选择合适的路径
        let targetUrl;
        if (isProductionEnvironment()) {
            // 生产环境：使用根路径下的 auth，避免 .html 扩展名问题
            targetUrl = '/auth';
        } else {
            // 开发环境：使用相对路径
            targetUrl = 'auth.html';
        }
        
        console.log('目标URL:', targetUrl);
        window.location.href = targetUrl;
    } catch (error) {
        console.error('重定向失败:', error);
    }
}

// 显示认证弹窗（重定向到认证页面）
function showAuthModal() {
    redirectToAuth();
}

// 前往认证页面
function goToAuth() {
    redirectToAuth();
}

// 获取存储的令牌
function getStoredToken() {
    try {
        const token = localStorage.getItem(AUTH_CONFIG.TOKEN_KEY);
        if (!token) {
            console.log('未找到存储的令牌');
            return null;
        }
        
        // 验证令牌格式
        if (typeof token !== 'string' || token.split('.').length !== 3) {
            console.warn('令牌格式无效，清除存储的令牌');
            localStorage.removeItem(AUTH_CONFIG.TOKEN_KEY);
            return null;
        }
        
        return token;
    } catch (error) {
        console.error('获取存储令牌时出错:', error);
        return null;
    }
}

// 获取存储的用户信息
function getStoredUser() {
    try {
        const userStr = localStorage.getItem(AUTH_CONFIG.USER_KEY);
        if (!userStr) {
            console.log('未找到存储的用户信息');
            return null;
        }
        
        const user = JSON.parse(userStr);
        
        // 验证用户信息格式
        if (!user || typeof user !== 'object' || !user.username) {
            console.warn('用户信息格式无效，清除存储的用户信息');
            localStorage.removeItem(AUTH_CONFIG.USER_KEY);
            return null;
        }
        
        return user;
    } catch (error) {
        console.error('解析用户信息时出错:', error);
        localStorage.removeItem(AUTH_CONFIG.USER_KEY);
        return null;
    }
}

// 检查令牌是否过期
function isTokenExpired(token) {
    try {
        if (!token || typeof token !== 'string') {
            return true;
        }
        
        const parts = token.split('.');
        if (parts.length !== 3) {
            return true;
        }
        
        const payload = JSON.parse(atob(parts[1]));
        
        if (!payload.exp || typeof payload.exp !== 'number') {
            return true;
        }
        
        const currentTime = Date.now() / 1000; // 转换为秒
        const isExpired = payload.exp < currentTime;
        
        if (isExpired) {
            console.log('令牌已过期，过期时间:', new Date(payload.exp * 1000));
        }
        
        return isExpired;
    } catch (error) {
        console.error('检查令牌过期时出错:', error);
        return true;
    }
}

// 刷新令牌
async function refreshToken() {
    const token = getStoredToken();
    if (!token) {
        console.log('没有令牌可刷新');
        return false;
    }

    try {
        console.log('尝试刷新令牌...');
        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.token && data.user) {
                storeAuthData(data.token, data.user);
                console.log('令牌刷新成功');
                return true;
            } else {
                console.warn('刷新响应格式无效');
                clearAuthData();
                return false;
            }
        } else {
            console.warn('令牌刷新失败，状态码:', response.status);
            clearAuthData();
            return false;
        }
    } catch (error) {
        console.error('刷新令牌时网络错误:', error);
        clearAuthData();
        return false;
    }
}

// 存储认证数据
function storeAuthData(token, user) {
    try {
        if (!token || !user) {
            console.error('存储认证数据失败：缺少必要参数');
            return false;
        }
        
        // 验证数据格式
        if (typeof token !== 'string' || typeof user !== 'object' || !user.username) {
            console.error('存储认证数据失败：数据格式无效');
            return false;
        }
        
        localStorage.setItem(AUTH_CONFIG.TOKEN_KEY, token);
        localStorage.setItem(AUTH_CONFIG.USER_KEY, JSON.stringify(user));
        isAuthenticated = true;
        currentUser = user;
        
        console.log('认证数据存储成功，用户:', user.username);
        return true;
    } catch (error) {
        console.error('存储认证数据时出错:', error);
        return false;
    }
}

// 清除认证数据
function clearAuthData() {
    try {
        localStorage.removeItem(AUTH_CONFIG.TOKEN_KEY);
        localStorage.removeItem(AUTH_CONFIG.USER_KEY);
        isAuthenticated = false;
        currentUser = null;
        
        console.log('认证数据已清除');
    } catch (error) {
        console.error('清除认证数据时出错:', error);
    }
}

// 用户登出
function logout() {
    console.log('用户登出');
    
    try {
        // 清除所有本地存储
        localStorage.clear();
        clearAuthData();
        
        // 显示登出成功消息
        if (window.showToast) {
            window.showToast('已成功登出', 'success');
        }
        
        // 延迟跳转到认证页面
        setTimeout(() => {
            redirectToAuth();
        }, 500);
        
    } catch (error) {
        console.error('登出时出错:', error);
        // 即使出错也要跳转
        redirectToAuth();
    }
}

// 更新用户显示
function updateUserDisplay() {
    try {
        // 更新设置标题
        const settingTitle = document.getElementById('settingTitle');
        if (settingTitle && currentUser && currentUser.username) {
            settingTitle.innerText = currentUser.username + '的设置';
        }
    } catch (error) {
        console.error('更新用户显示时出错:', error);
    }
}

// 启动令牌刷新定时器
function startTokenRefreshTimer() {
    if (tokenRefreshTimer) {
        clearInterval(tokenRefreshTimer);
        console.log('清除现有令牌刷新定时器');
    }

    console.log('启动令牌刷新定时器，间隔:', AUTH_CONFIG.TOKEN_REFRESH_INTERVAL / 1000, '秒');
    
    tokenRefreshTimer = setInterval(async () => {
        try {
            const token = getStoredToken();
            if (token && isTokenExpired(token)) {
                console.log('检测到令牌过期，尝试刷新...');
                const success = await refreshToken();
                if (!success) {
                    console.log('令牌刷新失败，清除认证数据');
                    clearAuthData();
                    // 如果当前不在认证页面，跳转过去
                    if (getCurrentPageType() !== PAGE_TYPES.AUTH) {
                        redirectToAuth();
                    }
                }
            }
        } catch (error) {
            console.error('令牌刷新定时器执行出错:', error);
        }
    }, AUTH_CONFIG.TOKEN_REFRESH_INTERVAL);
}

// 获取认证头（用于API请求）
function getAuthHeaders() {
    try {
        const token = getStoredToken();
        if (token && !isTokenExpired(token)) {
            return {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            };
        }
        return {
            'Content-Type': 'application/json'
        };
    } catch (error) {
        console.error('获取认证头时出错:', error);
        return {
            'Content-Type': 'application/json'
        };
    }
}

// 检查是否已认证
function isUserAuthenticated() {
    try {
        // 双重检查：内存状态和存储状态
        if (isAuthenticated && currentUser) {
            const token = getStoredToken();
            if (token && !isTokenExpired(token)) {
                return true;
            } else {
                // 状态不一致，清理内存状态
                console.log('认证状态不一致，清理内存状态');
                isAuthenticated = false;
                currentUser = null;
                return false;
            }
        }
        return false;
    } catch (error) {
        console.error('检查用户认证状态时出错:', error);
        return false;
    }
}

// 获取当前用户
function getCurrentUser() {
    try {
        // 验证当前用户状态
        if (isUserAuthenticated()) {
            return currentUser;
        }
        return null;
    } catch (error) {
        console.error('获取当前用户时出错:', error);
        return null;
    }
}

// 绑定认证表单事件
function bindAuthFormEvents() {
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
    console.log('处理登录请求');

    const username = document.getElementById('loginUsername')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;

    if (!username || !password) {
        showError('请填写完整的登录信息');
        return;
    }

    setButtonLoading('loginBtn', true);

    try {
        console.log('发送登录请求...');
        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        console.log('登录响应:', { status: response.status, success: response.ok });

        if (response.ok && data.token && data.user) {
            // 登录成功
            const storeSuccess = storeAuthData(data.token, data.user);
            if (storeSuccess) {
                showSuccess('登录成功，正在跳转...');
                
                // 延迟跳转，让用户看到成功消息
                setTimeout(() => {
                    redirectToMain();
                }, AUTH_CONFIG.REDIRECT_DELAY);
            } else {
                showError('登录成功但保存信息失败，请重试');
            }
        } else {
            const errorMsg = data.error || data.message || '登录失败';
            console.warn('登录失败:', errorMsg);
            showError(errorMsg);
        }
    } catch (error) {
        console.error('登录网络错误:', error);
        showError('网络错误，请检查网络连接');
    } finally {
        setButtonLoading('loginBtn', false);
    }
}

// 处理注册
async function handleRegister(event) {
    event.preventDefault();
    console.log('处理注册请求');

    const username = document.getElementById('registerUsername')?.value.trim();
    const email = document.getElementById('registerEmail')?.value.trim();
    const password = document.getElementById('registerPassword')?.value;
    const confirmPassword = document.getElementById('confirmPassword')?.value;

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
        console.log('发送注册请求...');
        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();
        console.log('注册响应:', { status: response.status, success: response.ok });

        if (response.ok && data.token && data.user) {
            // 注册成功
            const storeSuccess = storeAuthData(data.token, data.user);
            if (storeSuccess) {
                showSuccess('注册成功，正在跳转...');
                
                // 延迟跳转
                setTimeout(() => {
                    redirectToMain();
                }, AUTH_CONFIG.REDIRECT_DELAY);
            } else {
                showError('注册成功但保存信息失败，请重试');
            }
        } else {
            const errorMsg = data.error || data.message || '注册失败';
            console.warn('注册失败:', errorMsg);
            showError(errorMsg);
        }
    } catch (error) {
        console.error('注册网络错误:', error);
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
        console.log('检查用户名可用性:', username);
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
                if (input) {
                    input.style.borderColor = '#22c55e';
                    input.title = '用户名可用';
                }
            } else {
                // 用户名不可用
                const input = document.getElementById('registerUsername');
                if (input) {
                    input.style.borderColor = '#ef4444';
                    input.title = '用户名已被使用';
                }
                showError('用户名已被使用');
            }
        } else {
            const input = document.getElementById('registerUsername');
            if (input) {
                input.style.borderColor = '#ef4444';
                input.title = '检查失败';
            }
            showError(data.error || '检查失败');
        }
    } catch (error) {
        console.error('检查用户名错误:', error);
        const input = document.getElementById('registerUsername');
        if (input) {
            input.style.borderColor = '#ef4444';
            input.title = '网络错误';
        }
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

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function () {
    console.log('页面加载完成，初始化认证系统...');
    
    try {
        // 添加页面类型标识到body
        const pageType = getCurrentPageType();
        document.body.setAttribute('data-page-type', pageType);
        
        // 检查是否有紧急停止标志
        if (sessionStorage.getItem('auth_emergency_stop')) {
            console.error('检测到紧急停止标志，跳过认证系统初始化');
            sessionStorage.removeItem('auth_emergency_stop');
            return;
        }
        
        // 初始化认证系统
        initAuthSystem();
        
        console.log('认证系统初始化完成');
    } catch (error) {
        console.error('页面初始化失败:', error);
        // 显示错误提示
        if (getCurrentPageType() === PAGE_TYPES.AUTH) {
            showError('系统初始化失败，请刷新页面重试');
        }
    }
});

// 页面卸载时清理定时器
window.addEventListener('beforeunload', () => {
    console.log('页面卸载，清理认证系统...');
    
    try {
        if (tokenRefreshTimer) {
            clearInterval(tokenRefreshTimer);
            tokenRefreshTimer = null;
            console.log('令牌刷新定时器已清理');
        }
        
        // 清除初始化标记
        window.authSystemInitialized = false;
        
        console.log('认证系统清理完成');
    } catch (error) {
        console.error('清理认证系统时出错:', error);
    }
});

// 页面可见性变化时处理
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        console.log('页面变为可见，检查认证状态...');
        
        try {
            // 如果用户已认证，检查令牌是否过期
            if (isUserAuthenticated()) {
                const token = getStoredToken();
                if (token && isTokenExpired(token)) {
                    console.log('页面可见时检测到令牌过期，尝试刷新...');
                    refreshToken();
                }
            }
        } catch (error) {
            console.error('页面可见性变化处理出错:', error);
        }
    }
});

// 添加紧急停止函数
function emergencyStop() {
    console.error('紧急停止认证系统');
    sessionStorage.setItem('auth_emergency_stop', 'true');
    
    // 清除所有认证数据
    clearAuthData();
    
    // 停止所有定时器
    if (tokenRefreshTimer) {
        clearInterval(tokenRefreshTimer);
        tokenRefreshTimer = null;
    }
    
    // 重置所有状态
    isAuthenticated = false;
    currentUser = null;
    window.authSystemInitialized = false;
    
    // 显示错误消息
    if (getCurrentPageType() === PAGE_TYPES.AUTH) {
        showError('系统检测到异常，已自动停止。请刷新页面重试。');
    }
}

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
    storeAuthData,
    emergencyStop, // 新增紧急停止函数
    // 新增调试函数
    getAuthState: () => ({
        isAuthenticated,
        currentUser,
        pageType: getCurrentPageType(),
        isProduction: isProductionEnvironment()
    }),
    // 强制重新检查认证状态
    forceCheckAuth: () => {
        console.log('强制重新检查认证状态');
        const pageType = getCurrentPageType();
        if (pageType === PAGE_TYPES.AUTH) {
            return checkExistingAuth();
        } else {
            return checkAuthStatus();
        }
    }
};

// 全局函数，供HTML中的onclick调用
window.goToAuth = goToAuth;
window.checkAuthStatus = checkAuthStatus;
window.logout = logout;
window.switchAuthMode = switchAuthMode;
window.emergencyStop = emergencyStop; // 新增紧急停止函数

// 添加全局错误处理
window.addEventListener('error', (event) => {
    console.error('全局错误:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('未处理的Promise拒绝:', event.reason);
});

// 调试信息
console.log('LibreTV认证系统已加载，版本:', '2.2.0');
console.log('配置:', AUTH_CONFIG);
console.log('当前环境:', isProductionEnvironment() ? '生产环境' : '开发环境');
