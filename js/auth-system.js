// LibreTV JWT认证系统集成
// 重构版本：简洁高效的认证系统

const AUTH_CONFIG = {
    API_BASE_URL: '/proxy/api',
    TOKEN_KEY: 'libretv_jwt_token',
    USER_KEY: 'libretv_user_info',
    TOKEN_REFRESH_INTERVAL: 5 * 60 * 1000, // 5分钟检查一次令牌
};

// 全局状态
let isAuthenticated = false;
let currentUser = null;
let tokenRefreshTimer = null;

// 页面类型
const PAGE_TYPES = {
    AUTH: 'auth',
    PLAYER: 'player',
    MAIN: 'main'
};

// 工具函数
const utils = {
    // 检测页面类型
    getPageType() {
        const pathname = window.location.pathname;
        if (pathname.includes('auth') || pathname.endsWith('/auth')) return PAGE_TYPES.AUTH;
        if (pathname.includes('player') || pathname.endsWith('/player')) return PAGE_TYPES.PLAYER;
        return PAGE_TYPES.MAIN;
    },

    // 检测环境
    isProduction() {
        return window.location.hostname !== 'localhost' && 
               window.location.hostname !== '127.0.0.1' &&
               !window.location.hostname.includes('localhost');
    },

    // 获取重定向URL
    getRedirectUrl(type) {
        if (utils.isProduction()) {
            return type === 'main' ? '/' : '/auth';
        }
        return type === 'main' ? 'index.html' : 'auth.html';
    },

    // 安全重定向
    redirect(url) {
        try {
            window.location.href = url;
        } catch (error) {
            console.error('重定向失败:', error);
        }
    },

    // 统一错误处理
    handleError(error, context) {
        console.error(`${context}:`, error);
        return false;
    }
};

// 认证数据管理
const authStorage = {
    getToken() {
        try {
            const token = localStorage.getItem(AUTH_CONFIG.TOKEN_KEY);
            if (!token || token.split('.').length !== 3) {
                if (token) localStorage.removeItem(AUTH_CONFIG.TOKEN_KEY);
                return null;
            }
            return token;
        } catch (error) {
            return utils.handleError(error, '获取令牌失败');
        }
    },

    getUser() {
        try {
            const userStr = localStorage.getItem(AUTH_CONFIG.USER_KEY);
            if (!userStr) return null;
            
            const user = JSON.parse(userStr);
            if (!user || typeof user !== 'object' || !user.username) {
                localStorage.removeItem(AUTH_CONFIG.USER_KEY);
                return null;
            }
            return user;
        } catch (error) {
            return utils.handleError(error, '获取用户信息失败');
        }
    },

    setAuth(token, user) {
        try {
            if (!token || !user || typeof user !== 'object' || !user.username) {
                throw new Error('无效的认证数据');
            }
            
            localStorage.setItem(AUTH_CONFIG.TOKEN_KEY, token);
            localStorage.setItem(AUTH_CONFIG.USER_KEY, JSON.stringify(user));
            isAuthenticated = true;
            currentUser = user;
            return true;
        } catch (error) {
            return utils.handleError(error, '存储认证数据失败');
        }
    },

    clear() {
        try {
            localStorage.removeItem(AUTH_CONFIG.TOKEN_KEY);
            localStorage.removeItem(AUTH_CONFIG.USER_KEY);
            isAuthenticated = false;
            currentUser = null;
        } catch (error) {
            utils.handleError(error, '清除认证数据失败');
        }
    }
};

// 令牌管理
const tokenManager = {
    isExpired(token) {
        try {
            if (!token || typeof token !== 'string') return true;
            
            const parts = token.split('.');
            if (parts.length !== 3) return true;
            
            const payload = JSON.parse(atob(parts[1]));
            if (!payload.exp || typeof payload.exp !== 'number') return true;
            
            return payload.exp < (Date.now() / 1000);
        } catch (error) {
            return true;
        }
    },

    async refresh() {
        const token = authStorage.getToken();
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
                if (data.token && data.user) {
                    return authStorage.setAuth(data.token, data.user);
                }
            }
            
            authStorage.clear();
            return false;
        } catch (error) {
            utils.handleError(error, '刷新令牌失败');
            authStorage.clear();
            return false;
        }
    },

    startRefreshTimer() {
        if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);
        
        tokenRefreshTimer = setInterval(async () => {
            const token = authStorage.getToken();
            if (token && this.isExpired(token)) {
                const success = await this.refresh();
                if (!success && utils.getPageType() !== PAGE_TYPES.AUTH) {
                    utils.redirect(utils.getRedirectUrl('auth'));
                }
            }
        }, AUTH_CONFIG.TOKEN_REFRESH_INTERVAL);
    }
};

// 认证状态检查
const authChecker = {
    check() {
        const token = authStorage.getToken();
        const user = authStorage.getUser();
        
        if (token && user && !tokenManager.isExpired(token)) {
            isAuthenticated = true;
            currentUser = user;
            return { isValid: true, token, user };
        }
        
        isAuthenticated = false;
        currentUser = null;
        
        if (token && tokenManager.isExpired(token)) {
            authStorage.clear();
        }
        
        return { isValid: false, token, user };
    },

    checkExisting() {
        const result = this.check();
        if (result.isValid) {
            utils.redirect(utils.getRedirectUrl('main'));
        }
        return result;
    }
};

// 重定向管理
const redirectManager = {
    toMain() {
        if (utils.getPageType() === PAGE_TYPES.MAIN) return;
        utils.redirect(utils.getRedirectUrl('main'));
    },

    toAuth() {
        if (utils.getPageType() === PAGE_TYPES.AUTH) return;
        utils.redirect(utils.getRedirectUrl('auth'));
    }
};

// 页面初始化
const pageInitializer = {
    init() {
        if (window.authSystemInitialized) return;
        
        const pageType = utils.getPageType();
        document.body.setAttribute('data-page-type', pageType);
        
        if (sessionStorage.getItem('auth_emergency_stop')) {
            sessionStorage.removeItem('auth_emergency_stop');
            return;
        }
        
        if (pageType === PAGE_TYPES.AUTH) {
            this.initAuthPage();
        } else {
            this.initMainPage();
        }
        
        window.authSystemInitialized = true;
    },

    initAuthPage() {
        authChecker.checkExisting();
        this.bindEvents();
        tokenManager.startRefreshTimer();
    },

    initMainPage() {
        const authStatus = authChecker.check();
        if (authStatus.isValid) {
            tokenManager.startRefreshTimer();
            this.updateUserDisplay();
        } else {
            redirectManager.toAuth();
        }
    },

    bindEvents() {
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        const registerUsername = document.getElementById('registerUsername');

        if (loginForm) loginForm.addEventListener('submit', this.handleLogin);
        if (registerForm) registerForm.addEventListener('submit', this.handleRegister);
        if (registerUsername) registerUsername.addEventListener('blur', this.checkUsername);
    },

    updateUserDisplay() {
        const settingTitle = document.getElementById('settingTitle');
        if (settingTitle && currentUser?.username) {
            settingTitle.innerText = `${currentUser.username}的设置`;
        }
    }
};

// 表单处理
const formHandler = {
    async handleLogin(event) {
        event.preventDefault();
        
        const username = document.getElementById('loginUsername')?.value.trim();
        const password = document.getElementById('loginPassword')?.value;
        
        if (!username || !password) {
            this.showError('请填写完整的登录信息');
            return;
        }

        this.setLoading('loginBtn', true);
        
        try {
            const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            
            if (response.ok && data.token && data.user) {
                if (authStorage.setAuth(data.token, data.user)) {
                    this.showSuccess('登录成功，正在跳转...');
                    setTimeout(() => redirectManager.toMain(), 1000);
                } else {
                    this.showError('登录成功但保存信息失败');
                }
            } else {
                this.showError(data.error || data.message || '登录失败');
            }
        } catch (error) {
            this.showError('网络错误，请检查网络连接');
        } finally {
            this.setLoading('loginBtn', false);
        }
    },

    async handleRegister(event) {
        event.preventDefault();
        
        const username = document.getElementById('registerUsername')?.value.trim();
        const email = document.getElementById('registerEmail')?.value.trim();
        const password = document.getElementById('registerPassword')?.value;
        const confirmPassword = document.getElementById('confirmPassword')?.value;

        if (!username || !password || !confirmPassword) {
            this.showError('请填写完整的注册信息');
            return;
        }

        if (username.length < 3 || username.length > 20) {
            this.showError('用户名长度必须在3-20个字符之间');
            return;
        }

        if (password.length < 6) {
            this.showError('密码长度至少6个字符');
            return;
        }

        if (password !== confirmPassword) {
            this.showError('两次输入的密码不一致');
            return;
        }

        this.setLoading('registerBtn', true);
        
        try {
            const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });

            const data = await response.json();
            
            if (response.ok && data.token && data.user) {
                if (authStorage.setAuth(data.token, data.user)) {
                    this.showSuccess('注册成功，正在跳转...');
                    setTimeout(() => redirectManager.toMain(), 1000);
                } else {
                    this.showError('注册成功但保存信息失败');
                }
            } else {
                this.showError(data.error || data.message || '注册失败');
            }
        } catch (error) {
            this.showError('网络错误，请检查网络连接');
        } finally {
            this.setLoading('registerBtn', false);
        }
    },

    async checkUsername() {
        const username = document.getElementById('registerUsername')?.value.trim();
        if (!username || username.length < 3) return;

        try {
            const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/check-username`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const data = await response.json();
            const input = document.getElementById('registerUsername');
            
            if (response.ok) {
                if (data.available) {
                    input.style.borderColor = '#22c55e';
                    input.title = '用户名可用';
                } else {
                    input.style.borderColor = '#ef4444';
                    input.title = '用户名已被使用';
                    this.showError('用户名已被使用');
                }
            } else {
                input.style.borderColor = '#ef4444';
                input.title = '检查失败';
                this.showError(data.error || '检查失败');
            }
        } catch (error) {
            const input = document.getElementById('registerUsername');
            input.style.borderColor = '#ef4444';
            input.title = '网络错误';
        }
    },

    setLoading(buttonId, loading) {
        const button = document.getElementById(buttonId);
        if (!button) return;

        const btnText = button.querySelector('.btn-text');
        const loadingSpinner = button.querySelector('.loading');

        button.disabled = loading;
        if (btnText) btnText.style.display = loading ? 'none' : 'inline';
        if (loadingSpinner) loadingSpinner.style.display = loading ? 'inline-block' : 'none';
    },

    showError(message) {
        const element = document.getElementById('errorMessage');
        if (element) {
            element.textContent = message;
            element.style.display = 'block';
            setTimeout(() => this.hideMessages(), 5000);
        }
    },

    showSuccess(message) {
        const element = document.getElementById('successMessage');
        if (element) {
            element.textContent = message;
            element.style.display = 'block';
        }
    },

    hideMessages() {
        ['errorMessage', 'successMessage'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.style.display = 'none';
        });
    }
};

// 公共函数
const publicAPI = {
    // 认证状态
    isUserAuthenticated() {
        const token = authStorage.getToken();
        return !!(token && !tokenManager.isExpired(token));
    },

    getCurrentUser() {
        return this.isUserAuthenticated() ? currentUser : null;
    },

    getAuthHeaders() {
        const token = authStorage.getToken();
        return token && !tokenManager.isExpired(token) 
            ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json' };
    },

    // 操作
    logout() {
        localStorage.clear();
        authStorage.clear();
        
        if (window.showToast) {
            window.showToast('已成功登出', 'success');
        }
        
        setTimeout(() => redirectManager.toAuth(), 500);
    },

    goToAuth() {
        redirectManager.toAuth();
    },

    refreshToken() {
        return tokenManager.refresh();
    },

    clearAuthData() {
        authStorage.clear();
    },

    storeAuthData(token, user) {
        return authStorage.setAuth(token, user);
    },

    // 调试
    getAuthState() {
        return {
            isAuthenticated,
            currentUser,
            pageType: utils.getPageType(),
            isProduction: utils.isProduction()
        };
    },

    forceCheckAuth() {
        const pageType = utils.getPageType();
        return pageType === PAGE_TYPES.AUTH ? authChecker.checkExisting() : authChecker.check();
    },

    // 紧急停止
    emergencyStop() {
        sessionStorage.setItem('auth_emergency_stop', 'true');
        authStorage.clear();
        if (tokenRefreshTimer) {
            clearInterval(tokenRefreshTimer);
            tokenRefreshTimer = null;
        }
        window.authSystemInitialized = false;
        
        if (utils.getPageType() === PAGE_TYPES.AUTH) {
            formHandler.showError('系统检测到异常，已自动停止。请刷新页面重试。');
        }
    }
};

// 切换登录/注册模式
function switchAuthMode() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const switchText = document.getElementById('loginSwitchText');
    const switchBtn = document.getElementById('authSwitchBtn');

    if (loginForm && registerForm && switchText && switchBtn) {
        const isLoginMode = loginForm.style.display !== 'none';
        
        loginForm.style.display = isLoginMode ? 'none' : 'block';
        registerForm.style.display = isLoginMode ? 'block' : 'none';
        switchText.textContent = isLoginMode ? '已有账号？' : '还没有账号？';
        switchBtn.textContent = isLoginMode ? '立即登录' : '立即注册';
        
        formHandler.hideMessages();
    }
}

// 事件绑定
document.addEventListener('DOMContentLoaded', () => pageInitializer.init());

window.addEventListener('beforeunload', () => {
    if (tokenRefreshTimer) {
        clearInterval(tokenRefreshTimer);
        tokenRefreshTimer = null;
    }
    window.authSystemInitialized = false;
});

// 导出API
window.AuthSystem = publicAPI;
window.goToAuth = publicAPI.goToAuth;
window.checkAuthStatus = publicAPI.forceCheckAuth;
window.logout = publicAPI.logout;
window.switchAuthMode = switchAuthMode;
window.emergencyStop = publicAPI.emergencyStop;

// 绑定表单处理函数
pageInitializer.handleLogin = formHandler.handleLogin.bind(formHandler);
pageInitializer.handleRegister = formHandler.handleRegister.bind(formHandler);
pageInitializer.checkUsername = formHandler.checkUsername.bind(formHandler);

console.log('LibreTV认证系统已加载，版本: 3.0.0');
