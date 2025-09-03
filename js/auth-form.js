// LibreTV 登录注册表单处理模块
// 专门处理认证页面的表单逻辑

// 表单处理类
class AuthFormManager {
    constructor() {
        this.init();
    }

    init() {
        this.bindEvents();
        this.setupValidation();
    }

    // 绑定事件
    bindEvents() {
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        const registerUsername = document.getElementById('registerUsername');

        if (loginForm) {
            loginForm.addEventListener('submit', this.handleLogin.bind(this));
        }
        
        if (registerForm) {
            registerForm.addEventListener('submit', this.handleRegister.bind(this));
        }
        
        if (registerUsername) {
            registerUsername.addEventListener('blur', this.checkUsername.bind(this));
        }
    }

    // 设置表单验证
    setupValidation() {
        // 可以在这里添加实时验证逻辑
    }

    // 处理登录
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
            
            if (response.ok && data.expires_in) {
                // 🎯 传递过期时间给认证系统
                if (window.AuthSystem && await window.AuthSystem.handleAuthSuccess(data.expires_in)) {
                    this.showSuccess('登录成功，正在跳转...');
                } else {
                    this.showError('登录成功但处理失败');
                }
            } else {
                this.showError(data.error || data.message || '登录失败');
            }
        } catch (error) {
            console.error('登录请求失败:', error);
            this.showError('网络错误，请检查网络连接');
        } finally {
            this.setLoading('loginBtn', false);
        }
    }

    // 处理注册
    async handleRegister(event) {
        event.preventDefault();
        
        const username = document.getElementById('registerUsername')?.value.trim();
        const email = document.getElementById('registerEmail')?.value.trim();
        const password = document.getElementById('registerPassword')?.value;
        const confirmPassword = document.getElementById('confirmPassword')?.value;

        // 验证输入
        if (!username || !password || !confirmPassword) {
            this.showError('请填写完整的注册信息');
            return;
        }

        if (username.length < 5 || username.length > 50) {
            this.showError('用户名长度必须在5-50个字符之间');
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

        // 验证邮箱格式
        if (!this.isValidEmail(username)) {
            this.showError('用户名必须是有效的邮箱格式');
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
            
            if (response.ok && data.expires_in) {
                // 🎯 传递过期时间给认证系统
                if (window.AuthSystem && await window.AuthSystem.handleAuthSuccess(data.expires_in)) {
                    this.showSuccess('注册成功，正在跳转...');
                } else {
                    this.showError('注册成功但处理失败');
                }
            } else {
                this.showError(data.error || data.message || '注册失败');
            }
        } catch (error) {
            console.error('注册请求失败:', error);
            this.showError('网络错误，请检查网络连接');
        } finally {
            this.setLoading('registerBtn', false);
        }
    }

    // 检查用户名可用性
    async checkUsername() {
        const username = document.getElementById('registerUsername')?.value.trim();
        if (!username || username.length < 5) return;

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
            console.error('检查用户名失败:', error);
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
    }

    // 切换登录/注册模式
    switchMode() {
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
            this.cleanup();
        }
    }

    // 设置按钮加载状态
    setLoading(buttonId, loading) {
        const button = document.getElementById(buttonId);
        if (!button) return;

        const btnText = button.querySelector('.btn-text');
        const loadingSpinner = button.querySelector('.loading');

        button.disabled = loading;
        if (btnText) btnText.style.display = loading ? 'none' : 'inline';
        if (loadingSpinner) loadingSpinner.style.display = loading ? 'inline-block' : 'none';
    }

    // 显示错误消息
    showError(message) {
        const element = document.getElementById('errorMessage');
        if (element) {
            element.textContent = message;
            element.style.display = 'block';
            setTimeout(() => this.hideMessages(), 5000);
        }
    }

    // 显示成功消息
    showSuccess(message) {
        const element = document.getElementById('successMessage');
        if (element) {
            element.textContent = message;
            element.style.display = 'block';
        }
    }

    // 隐藏所有消息
    hideMessages() {
        ['errorMessage', 'successMessage'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.style.display = 'none';
        });
    }

    // 清理表单状态
    cleanup() {
        // 隐藏所有消息
        this.hideMessages();
        
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

    // 验证邮箱格式
    isValidEmail(email) {
        const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return pattern.test(email);
    }
}

// 全局函数，用于向后兼容
function switchAuthMode() {
    if (window.AuthForm) {
        window.AuthForm.switchMode();
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 只在认证页面初始化表单管理器
    if (window.location.pathname.includes('auth') || window.location.pathname.endsWith('/auth')) {
        window.AuthForm = new AuthFormManager();
    }
});

// 导出全局函数
window.switchAuthMode = switchAuthMode;

console.log('LibreTV 表单处理模块已加载');
