// LibreTV JWT认证系统集成
// 重构版本：Cookie-based认证系统

const AUTH_CONFIG = {
    API_BASE_URL: '/proxy/api',
    TOKEN_REFRESH_INTERVAL: 4 * 60 * 1000, // 4分钟检查一次令牌（比5分钟过期时间提前1分钟）
};

// 全局状态
let isAuthenticated = false;
let currentUser = null;
let tokenExpiresAt = 0; // 存储token过期时间戳
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

// 认证状态管理
const authState = {
    // 初始化认证状态（从localStorage恢复）
    init() {
        const storedExpiresAt = localStorage.getItem('tokenExpiresAt');
        const storedAuth = localStorage.getItem('isAuthenticated');

        if (storedExpiresAt && storedAuth === 'true') {
            const expiresAt = parseInt(storedExpiresAt);
            // 使用UTC时间进行比较，避免时区问题
            const nowUTC = Math.floor(Date.now() / 1000) * 1000;

            // 检查是否过期
            if (nowUTC < expiresAt) {
                tokenExpiresAt = expiresAt;
                isAuthenticated = true;
                return true;
            } else {
                this.clear();
                return false;
            }
        }
        return false;
    },

    // 检查token是否过期
    isTokenExpired() {
        // 使用UTC时间进行比较，避免时区问题
        const nowUTC = Math.floor(Date.now() / 1000) * 1000;
        return nowUTC >= tokenExpiresAt;
    },

    // 设置认证状态
    setAuth(expiresAt) {
        tokenExpiresAt = expiresAt;
        isAuthenticated = true;

        // 持久化存储过期时间
        localStorage.setItem('tokenExpiresAt', expiresAt.toString());
        localStorage.setItem('isAuthenticated', 'true');

        return true;
    },

    // 清除认证状态
    clear() {
        isAuthenticated = false;
        currentUser = null;
        tokenExpiresAt = 0;
        // 清除持久化存储
        localStorage.clear();
    },

    // 获取认证状态
    getAuthStatus() {
        return {
            isAuthenticated,
            currentUser,
            expiresAt: tokenExpiresAt,
            isExpired: this.isTokenExpired()
        };
    }
};

// 令牌管理
const tokenManager = {
    async refresh() {
        try {
            const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include' // 确保发送Cookie
            });

            if (response.ok) {
                const data = await response.json();
                if (data.expires_at) {
                    return authState.setAuth(data.expires_at);
                }
            }

            // 刷新失败，清除认证状态
            authState.clear();
            return false;
        } catch (error) {
            console.error('Token刷新请求失败:', error);
            utils.handleError(error, '刷新令牌失败');
            authState.clear();
            return false;
        }
    },

    startRefreshTimer() {
        if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);

        tokenRefreshTimer = setInterval(async () => {
            if (authState.isTokenExpired()) {
                const success = await this.refresh();
                if (!success) {
                    // 只有在刷新失败且不在认证页面时才跳转
                    if (utils.getPageType() !== PAGE_TYPES.AUTH) {
                        utils.redirect(utils.getRedirectUrl('auth'));
                    }
                }
            }
        }, AUTH_CONFIG.TOKEN_REFRESH_INTERVAL);
    }
};

// 用户信息管理
const userManager = {
    async fetchUserInfo() {
        try {
            const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/user-info`, {
                method: 'GET',
                credentials: 'include'
            });

            if (response.ok) {
                const userData = await response.json();
                currentUser = userData;
                return userData;
            } else {
                console.error('获取用户信息失败:', response.status);
                return null;
            }
        } catch (error) {
            utils.handleError(error, '获取用户信息失败');
            return null;
        }
    },

    async updateUserDisplay() {
        if (!currentUser) {
            currentUser = await this.fetchUserInfo();
        }

        const settingTitle = document.getElementById('settingTitle');
        if (settingTitle && currentUser?.username) {
            settingTitle.innerText = `${currentUser.username}的设置`;
        }
    }
};

// 认证状态检查
const authChecker = {
    async check() {
        // 如果内存中没有状态，尝试从localStorage恢复
        if (!isAuthenticated && tokenExpiresAt === 0) {
            authState.init();
        }

        // 首先检查内存中的状态
        if (isAuthenticated && !authState.isTokenExpired()) {
            return { isValid: true, user: currentUser };
        }

        // 如果内存中没有有效状态，尝试刷新token
        const refreshSuccess = await tokenManager.refresh();
        if (refreshSuccess) {
            // 获取用户信息
            const userInfo = await userManager.fetchUserInfo();
            return { isValid: true, user: userInfo };
        } else {
            return { isValid: false, user: null };
        }
    },

    async checkExisting() {
        const result = await this.check();
        if (result.isValid) {
            // 如果用户已认证，跳转到主页
            redirectManager.toMain();
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
    async init() {
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
            await this.initMainPage();
        }

        window.authSystemInitialized = true;
    },

    initAuthPage() {
        // 清理之前可能存在的状态
        cleanupFormState();
        authChecker.checkExisting();
        this.bindEvents();
        tokenManager.startRefreshTimer();
    },

    async initMainPage() {
        const authStatus = await authChecker.check();

        if (authStatus.isValid) {
            tokenManager.startRefreshTimer();
            await userManager.updateUserDisplay();
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
                body: JSON.stringify({ username, password }),
                credentials: 'include' // 确保发送和接收Cookie
            });

            const data = await response.json();

            if (response.ok && data.expires_at) {
                const authResult = authState.setAuth(data.expires_at);

                if (authResult) {
                    this.showSuccess('登录成功，正在跳转...');
                    setTimeout(() => {
                        redirectManager.toMain();
                    }, 1000);
                } else {
                    this.showError('登录成功但保存信息失败');
                }
            } else {
                this.showError(data.error || data.message || '登录失败');
            }
        } catch (error) {
            console.error('登录错误:', error);
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

        if (username.length < 3 || username.length > 50) {
            this.showError('用户名长度必须在3-50个字符之间');
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
                body: JSON.stringify({ username, email, password }),
                credentials: 'include' // 确保发送和接收Cookie
            });

            const data = await response.json();

            if (response.ok && data.expires_at) {
                const authResult = authState.setAuth(data.expires_at);

                if (authResult) {
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
                    input.classList.add('success');
                    input.classList.remove('error');
                    // 用户名可用时不显示错误消息
                    this.hideMessages();
                } else {
                    input.style.borderColor = '#ef4444';
                    input.title = '用户名已被使用';
                    input.classList.add('error');
                    input.classList.remove('success');
                    // 只在注册表单显示时才显示错误消息
                    const registerForm = document.getElementById('registerForm');
                    if (registerForm && registerForm.style.display !== 'none') {
                        this.showError('用户名已被使用');
                    }
                }
            } else {
                input.style.borderColor = '#ef4444';
                input.title = '检查失败';
                input.classList.add('error');
                input.classList.remove('success');
                // 只在注册表单显示时才显示错误消息
                const registerForm = document.getElementById('registerForm');
                if (registerForm && registerForm.style.display !== 'none') {
                    this.showError(data.error || '检查失败');
                }
            }
        } catch (error) {
            const input = document.getElementById('registerUsername');
            input.style.borderColor = '#ef4444';
            input.title = '网络错误';
            input.classList.add('error');
            input.classList.remove('success');
            // 只在注册表单显示时才显示错误消息
            const registerForm = document.getElementById('registerForm');
            if (registerForm && registerForm.style.display !== 'none') {
                this.showError('网络错误，请检查网络连接');
            }
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
    async isUserAuthenticated() {
        // 首先检查内存中的状态
        if (isAuthenticated && !authState.isTokenExpired()) {
            return true;
        }

        // 如果内存中没有有效状态，尝试刷新token
        const refreshSuccess = await tokenManager.refresh();
        if (refreshSuccess) {
            // 获取用户信息
            await userManager.fetchUserInfo();
            return true;
        } else {
            return false;
        }
    },

    // 同步版本的认证检查（用于不需要等待的场景）
    isUserAuthenticatedSync() {
        // 同步检查只能基于内存状态，如果需要准确状态请使用异步版本
        return isAuthenticated && !authState.isTokenExpired();
    },

    getCurrentUser() {
        return this.isUserAuthenticatedSync() ? currentUser : null;
    },

    // 获取认证头（现在通过Cookie自动发送）
    getAuthHeaders() {
        return { 'Content-Type': 'application/json' };
    },

    // 操作
    async logout() {
        try {
            // 调用后端logout接口
            const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/logout`, {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                console.log('后端logout成功');
            } else {
                console.warn('后端logout失败，状态码:', response.status);
            }
        } catch (error) {
            console.error('调用logout接口失败:', error);
        }

        // 清除前端状态
        authState.clear();

        // 清理认证页面可能存在的状态
        if (utils.getPageType() === PAGE_TYPES.AUTH) {
            cleanupFormState();
        }

        if (window.showToast) {
            window.showToast('已成功登出', 'success');
        }

        setTimeout(() => redirectManager.toAuth(), 500);
    },

    goToAuth() {
        redirectManager.toAuth();
    },

    // 跳转到主页
    redirectToMain() {
        redirectManager.toMain();
    },

    refreshToken() {
        return tokenManager.refresh();
    },

    clearAuthData() {
        authState.clear();
    },

    // 存储认证数据（现在通过Cookie自动管理）
    storeAuthData(expiresAt) {
        return authState.setAuth(expiresAt);
    },

    // 显示认证弹框（用于播放器页面）
    showAuthModal() {
        this.goToAuth();
    },

    // 调试
    getAuthState() {
        return {
            ...authState.getAuthStatus(),
            pageType: utils.getPageType(),
            isProduction: utils.isProduction()
        };
    },

    async forceCheckAuth() {
        const pageType = utils.getPageType();
        return pageType === PAGE_TYPES.AUTH ? await authChecker.checkExisting() : await authChecker.check();
    },

    // 紧急停止
    emergencyStop() {
        sessionStorage.setItem('auth_emergency_stop', 'true');
        authState.clear();
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

        // 完全清理所有状态
        cleanupFormState();
    }
}

// 清理表单状态的函数
function cleanupFormState() {
    // 隐藏所有消息
    formHandler.hideMessages();

    // 清空所有输入框
    const inputs = document.querySelectorAll('.form-input');
    inputs.forEach(input => {
        input.value = '';
        input.style.borderColor = '';
        input.title = '';
        input.classList.remove('error', 'success');
    });

    // 重置按钮状态
    const buttons = document.querySelectorAll('.auth-btn');
    buttons.forEach(button => {
        button.disabled = false;
        const btnText = button.querySelector('.btn-text');
        const loadingSpinner = button.querySelector('.loading');
        if (btnText) btnText.style.display = 'inline';
        if (loadingSpinner) loadingSpinner.style.display = 'none';
    });

    // 重置表单验证状态
    const forms = document.querySelectorAll('.auth-form');
    forms.forEach(form => {
        if (form.classList.contains('was-validated')) {
            form.classList.remove('was-validated');
        }
    });
}

// 事件绑定
document.addEventListener('DOMContentLoaded', async () => await pageInitializer.init());

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

// 绑定表单处理函数到pageInitializer对象
pageInitializer.handleLogin = formHandler.handleLogin.bind(formHandler);
pageInitializer.handleRegister = formHandler.handleRegister.bind(formHandler);
pageInitializer.checkUsername = formHandler.checkUsername.bind(formHandler);

// 确保所有必要的方法都被正确绑定
pageInitializer.showError = formHandler.showError.bind(formHandler);
pageInitializer.showSuccess = formHandler.showSuccess.bind(formHandler);
pageInitializer.hideMessages = formHandler.hideMessages.bind(formHandler);
pageInitializer.setLoading = formHandler.setLoading.bind(formHandler);

console.log('LibreTV认证系统已加载，版本: 4.0.0 (Cookie-based)');
