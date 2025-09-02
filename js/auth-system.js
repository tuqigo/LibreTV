// LibreTV JWT认证系统核心模块
// 专注于认证状态管理和令牌处理

const AUTH_CONFIG = {
    API_BASE_URL: '/proxy/api',
    TOKEN_KEY: 'libretv_jwt_token',
    USER_KEY: 'libretv_user_info',
    TOKEN_REFRESH_INTERVAL: 4 * 60 * 1000, // 4分钟检查一次令牌
    USER_CONFIG_DETAIL: 'USER_CONFIG_DETAIL', // 用户信息详情
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
            localStorage.clear()
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
                if (data.token && data.user) {
                    return authStorage.setAuth(data.token, data.user);
                }
            }
            
            // 刷新失败，清除认证状态
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
                console.log('Access token已过期，尝试刷新...');
                const success = await this.refresh();
                if (!success) {
                    console.log('刷新失败，需要重新登录');
                    // 只有在刷新失败且不在认证页面时才跳转
                    if (utils.getPageType() !== PAGE_TYPES.AUTH) {
                        utils.redirect(utils.getRedirectUrl('auth'));
                    }
                } else {
                    console.log('Token刷新成功');
                }
            }
        }, AUTH_CONFIG.TOKEN_REFRESH_INTERVAL);
    }
};

// 认证状态检查
const authChecker = {
    async check() {
        const token = authStorage.getToken();
        const user = authStorage.getUser();
        
        if (token && user && !tokenManager.isExpired(token)) {
            isAuthenticated = true;
            currentUser = user;
            return { isValid: true, token, user };
        }
        
        // 如果token过期，尝试刷新
        if (token && tokenManager.isExpired(token)) {
            console.log('Token已过期，尝试刷新...');
            const refreshSuccess = await tokenManager.refresh();
            if (refreshSuccess) {
                console.log('Token刷新成功');
                isAuthenticated = true;
                currentUser = authStorage.getUser();
                return { isValid: true, token: authStorage.getToken(), user: currentUser };
            } else {
                console.log('Token刷新失败，清除认证状态');
                authStorage.clear();
            }
        }
        
        isAuthenticated = false;
        currentUser = null;
        
        return { isValid: false, token, user };
    },

    async checkExisting() {
        const result = await this.check();
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
        // 检查是否已经认证，如果是则跳转到主页
        authChecker.checkExisting();
        tokenManager.startRefreshTimer();
    },

    async initMainPage() {
        const authStatus = await authChecker.check();
        if (authStatus.isValid) {
            tokenManager.startRefreshTimer();
            // 新增：获取用户配置
            await this.loadUserConfig();
            this.updateUserDisplay();
        } else {
            redirectManager.toAuth();
        }
    },

    // 新增：加载用户详细信息
    async loadUserConfig() {
        try {

            const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/user-info`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });

            if (response.ok) {
                const userDetail = await response.json();
                
                // 存储用户配置到 localStorage
                localStorage.setItem(AUTH_CONFIG.USER_CONFIG_DETAIL, JSON.stringify(userDetail));
                
                // 根据配置更新页面
                // await this.applyUserConfig(userDetail);
                
                console.log('用户详细信息加载成功:', userDetail);
            } else {
                console.warn('获取用户详细信息失败:', response.status);
                // 尝试使用缓存的配置
                await this.loadCachedConfig();
            }
        } catch (error) {
            console.error('加载用户详细信息时出错:', error);
            // 尝试使用缓存的配置
            await this.loadCachedConfig();
        }
    },


        // 新增：加载缓存的配置
        async loadCachedConfig() {
            try {
                const cachedConfig = localStorage.getItem(AUTH_CONFIG.USER_CONFIG_DETAIL);
                if (cachedConfig) {
                    const userConfig = JSON.parse(cachedConfig);

                    // await this.applyUserConfig(userConfig);
                    console.log('使用缓存的用户详细信息:', userConfig);
                }
            } catch (error) {
                console.error('加载缓存用户详细信息时出错:', error);
            }
        },



    updateUserDisplay() {
        const settingTitle = document.getElementById('settingTitle');
        if (settingTitle && currentUser?.username) {
            settingTitle.innerText = `${currentUser.username}的设置`;
        }
    }
};



// 公共函数
const publicAPI = {
    // 认证状态
    async isUserAuthenticated() {
        const token = authStorage.getToken();
        if (!token) return false;
        
        // 如果token过期，尝试刷新
        if (tokenManager.isExpired(token)) {
            console.log('Token已过期，尝试刷新...');
            const refreshSuccess = await tokenManager.refresh();
            if (refreshSuccess) {
                console.log('Token刷新成功');
                return true;
            } else {
                console.log('Token刷新失败');
                return false;
            }
        }
        
        return true;
    },

    // 同步版本的认证检查（用于不需要等待的场景）
    isUserAuthenticatedSync() {
        const token = authStorage.getToken();
        return !!(token && !tokenManager.isExpired(token));
    },

    getCurrentUser() {
        return this.isUserAuthenticatedSync() ? currentUser : null;
    },

    // 获取存储的token（用于其他模块）
    getStoredToken() {
        return authStorage.getToken();
    },

    getAuthHeaders() {
        const token = authStorage.getToken();
        return token && !tokenManager.isExpired(token) 
            ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json' };
    },

    // 操作
    async logout() {
        try {
            // 先调用后端登出接口
            const token = authStorage.getToken();
            if (token) {
                const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include'
                });
                
                if (response.ok) {
                    console.log('后端登出成功');
                } else {
                    console.warn('后端登出失败，但继续清理本地状态');
                }
            }
        } catch (error) {
            console.warn('调用登出接口时出错，但继续清理本地状态:', error);
        } finally {
            // 无论后端是否成功，都清理本地状态
            localStorage.clear();
            authStorage.clear();
            
            // 清理认证页面可能存在的状态
            if (utils.getPageType() === PAGE_TYPES.AUTH) {
                // 表单清理现在由auth-form.js处理
                if (window.AuthForm && window.AuthForm.cleanup) {
                    window.AuthForm.cleanup();
                }
            }
            
            if (window.showToast) {
                window.showToast('已成功登出', 'success');
            }
            
            setTimeout(() => redirectManager.toAuth(), 500);
        }
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
        authStorage.clear();
    },

    storeAuthData(token, user) {
        return authStorage.setAuth(token, user);
    },

    // 用于表单成功登录/注册后的处理
    handleAuthSuccess(token, user) {
        if (authStorage.setAuth(token, user)) {
            setTimeout(() => redirectManager.toMain(), 1000);
            return true;
        }
        return false;
    },

    // 显示认证弹框（用于播放器页面）
    showAuthModal() {
        this.goToAuth();
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

    async forceCheckAuth() {
        const pageType = utils.getPageType();
        return pageType === PAGE_TYPES.AUTH ? await authChecker.checkExisting() : await authChecker.check();
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
            // 错误显示现在由auth-form.js处理
            if (window.AuthForm && window.AuthForm.showError) {
                window.AuthForm.showError('系统检测到异常，已自动停止。请刷新页面重试。');
            }
        }
    }
};



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
window.logout = async () => await publicAPI.logout();
window.emergencyStop = publicAPI.emergencyStop;

console.log('LibreTV认证系统已加载，版本: 3.0.0');
