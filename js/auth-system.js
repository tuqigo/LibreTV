// LibreTV JWT认证系统核心模块
// 专注于认证状态管理和令牌处理

// 自定义错误类 - 用于API请求的错误处理
class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthError';
    }
}

class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

class NetworkError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NetworkError';
    }
}

const AUTH_CONFIG = {
    API_BASE_URL: '/proxy/api',
    TOKEN_REFRESH_INTERVAL: 4 * 60 * 1000, // 4分钟检查一次令牌
    // 移除不安全的localStorage存储配置
    // TOKEN_KEY、USER_KEY 和 USER_CONFIG_DETAIL 不再需要，因为我们使用HttpOnly Cookie
};

// 全局状态
let isAuthenticated = false;
let currentUser = null;
let tokenRefreshTimer = null;
let userInfoLoaded = false; // 标记用户信息是否已加载

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

// 认证数据管理 - 基于Cookie的安全策略
const authStorage = {
    // 检查认证状态 - 通过调用后端接口验证（带缓存）
    async checkAuthStatus() {
        try {
            // 如果用户信息已加载且仍然有效，直接返回
            if (userInfoLoaded && currentUser && isAuthenticated) {
                return { isValid: true, user: currentUser };
            }

            const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/user-info`, {
                method: 'GET',
                credentials: 'include' // 包含HttpOnly Cookie
            });

            if (response.ok) {
                const userData = await response.json();
                isAuthenticated = true;
                currentUser = userData;
                userInfoLoaded = true; // 标记已加载
                return { isValid: true, user: userData };
            } else {
                isAuthenticated = false;
                currentUser = null;
                userInfoLoaded = false;
                return { isValid: false, user: null };
            }
        } catch (error) {
            console.error('检查认证状态失败:', error);
            isAuthenticated = false;
            currentUser = null;
            userInfoLoaded = false;
            return { isValid: false, user: null };
        }
    },

    // 设置认证成功状态 - 不再存储敏感信息到localStorage
    setAuthSuccess() {
        isAuthenticated = true;
        // currentUser 将通过 loadUserInfo 异步获取
        return true;
    },

    // 清除认证状态
    clear() {
        try {
            localStorage.clear()
            isAuthenticated = false;
            currentUser = null;
            userInfoLoaded = false; // 重置加载标记
        } catch (error) {
            utils.handleError(error, '清除认证数据失败');
        }
    }
};

// 令牌管理 - 基于Cookie的策略
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
                // 后端现在只返回过期时间，不返回敏感信息
                if (data.expires_in) {
                    isAuthenticated = true;
                    // 重新加载用户信息
                    await this.loadUserInfo();
                    return true;
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

    async loadUserInfo() {
        try {
            // 如果用户信息已加载，直接返回
            if (userInfoLoaded && currentUser) {
                return currentUser;
            }

            const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/user-info`, {
                method: 'GET',
                credentials: 'include'
            });

            if (response.ok) {
                const userData = await response.json();
                currentUser = userData;
                userInfoLoaded = true; // 标记已加载
                return userData;
            }
            return null;
        } catch (error) {
            console.error('加载用户信息失败:', error);
            return null;
        }
    },

    startRefreshTimer() {
        if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);
        
        tokenRefreshTimer = setInterval(async () => {
            // 定期刷新token以保持认证状态
            if (isAuthenticated) {
                console.log('定期刷新token...');
                const success = await this.refresh();
                if (!success) {
                    console.log('定期刷新失败，需要重新登录');
                    // 只有在刷新失败且不在认证页面时才跳转
                    if (utils.getPageType() !== PAGE_TYPES.AUTH) {
                        utils.redirect(utils.getRedirectUrl('auth'));
                    }
                } else {
                    console.log('定期刷新成功');
                }
            }
        }, AUTH_CONFIG.TOKEN_REFRESH_INTERVAL);
    }
};

// 认证状态检查
const authChecker = {
    async check() {
        // 检查认证状态（带缓存优化）
        const authStatus = await authStorage.checkAuthStatus();
        
        if (authStatus.isValid) {
            return authStatus;
        } else {
            // 认证无效，尝试刷新token
            console.log('认证状态无效，尝试刷新...');
            const refreshSuccess = await tokenManager.refresh();
            if (refreshSuccess) {
                console.log('Token刷新成功');
                return await authStorage.checkAuthStatus();
            } else {
                console.log('Token刷新失败，清除认证状态');
                authStorage.clear();
                return { isValid: false, user: null };
            }
        }
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

    // 加载用户信息 - 不再使用localStorage缓存
    async loadUserConfig() {
        try {
            const userData = await tokenManager.loadUserInfo();
            if (userData) {
                console.log('用户信息加载成功:', userData);
                this.updateUserDisplay();
            } else {
                console.warn('获取用户信息失败');
            }
        } catch (error) {
            console.error('加载用户信息时出错:', error);
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
// 保留简化的认证检查器 - 仅用于UI状态控制
const authHelper = {
    // 如果已认证则执行，否则静默跳过（用于UI状态控制）
    ifAuthenticated(fn) {
        if (isAuthenticated && currentUser) {
            return fn();
        }
        return null;
    },

    // 同步检查认证状态（基于缓存）
    isAuthenticatedSync() {
        return isAuthenticated;
    }
};

const publicAPI = {
    // 认证状态
    async isUserAuthenticated() {
        const authStatus = await authStorage.checkAuthStatus();
        return authStatus.isValid;
    },

    // 同步版本的认证检查（用于不需要等待的场景）
    isUserAuthenticatedSync() {
        return isAuthenticated;
    },

    getCurrentUser() {
        return isAuthenticated ? currentUser : null;
    },

    // 简化的认证助手（仅用于UI状态控制）
    auth: authHelper,

    // 获取认证头（不再需要存储token）
    getAuthHeaders() {
        return { 'Content-Type': 'application/json' };
    },

    // 统一的API请求包装器 - 业界标准方案
    async apiRequest(url, options = {}) {
        const defaultOptions = {
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        try {
            const response = await fetch(url, { ...defaultOptions, ...options });
            
            // 处理认证失败
            if (response.status === 401) {
                this.handleUnauthorized();
                throw new AuthError('认证失败，请重新登录');
            }
            
            // 处理其他HTTP错误
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new ApiError(errorData.message || `HTTP ${response.status}`, response.status);
            }
            
            return response;
        } catch (error) {
            if (error instanceof AuthError || error instanceof ApiError) {
                throw error;
            }
            throw new NetworkError('网络请求失败: ' + error.message);
        }
    },

    // 处理认证失败的统一逻辑
    handleUnauthorized() {
        // 清理认证状态
        authStorage.clear();
        
        // 只有不在认证页面时才跳转
        if (utils.getPageType() !== PAGE_TYPES.AUTH) {
            if (window.showToast) {
                window.showToast('登录已过期，请重新登录', 'warning');
            }
            setTimeout(() => redirectManager.toAuth(), 1000);
        }
    },

    // 操作
    async logout() {
        try {
            // 调用后端登出接口（使用HttpOnly Cookie）
            const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/auth/logout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include' // 发送HttpOnly Cookie
            });
            
            if (response.ok) {
                console.log('后端登出成功');
            } else {
                console.warn('后端登出失败，但继续清理本地状态');
            }
        } catch (error) {
            console.warn('调用登出接口时出错，但继续清理本地状态:', error);
        } finally {
            // 无论后端是否成功，都清理本地状态
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

    // 用于表单成功登录/注册后的处理
    async handleAuthSuccess() {
        try {
            authStorage.setAuthSuccess();
            
            // 尝试加载用户信息，但不阻塞跳转
            try {
                await tokenManager.loadUserInfo();
            } catch (error) {
                console.warn('加载用户信息失败，但继续跳转:', error);
            }
            
            // 无论用户信息是否加载成功都进行跳转
            setTimeout(() => redirectManager.toMain(), 1000);
            return true;
        } catch (error) {
            console.error('处理登录成功时出错:', error);
            return false;
        }
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
