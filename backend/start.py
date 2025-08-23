#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LibreTV 后端服务启动脚本
"""

import os
import sys
import subprocess
import time

def install_requirements():
    """安装依赖包"""
    print("正在检查并安装依赖包...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("依赖包安装完成！")
    except subprocess.CalledProcessError as e:
        print(f"依赖包安装失败: {e}")
        return False
    return True

def start_server():
    """启动Flask服务器"""
    print("正在启动LibreTV后端服务...")
    
    # 设置环境变量
    env = os.environ.copy()
    env['FLASK_ENV'] = 'production'
    
    # 如果没有设置JWT密钥，生成一个随机密钥
    if 'JWT_SECRET_KEY' not in env:
        import secrets
        env['JWT_SECRET_KEY'] = secrets.token_hex(32)
        print(f"已生成随机JWT密钥: {env['JWT_SECRET_KEY']}")
        print("注意：在生产环境中，请设置固定的JWT_SECRET_KEY环境变量")
    
    try:
        # 启动Flask应用
        from LibreProgramBackend import app
        print(f"服务器启动成功！")
        print(f"访问地址: http://localhost:5002")
        print(f"API文档: http://localhost:5002/api/health")
        print("按 Ctrl+C 停止服务器")
        
        app.run(host='0.0.0.0', port=5002, debug=False)
        
    except ImportError as e:
        print(f"导入模块失败: {e}")
        print("请确保所有依赖包已正确安装")
        return False
    except Exception as e:
        print(f"启动服务器失败: {e}")
        return False

def main():
    """主函数"""
    print("=" * 50)
    print("LibreTV 后端服务启动器")
    print("=" * 50)
    
    # 检查Python版本
    if sys.version_info < (3, 7):
        print("错误：需要Python 3.7或更高版本")
        print(f"当前版本: {sys.version}")
        return
    
    print(f"Python版本: {sys.version}")
    print(f"工作目录: {os.getcwd()}")
    
    # 安装依赖
    if not install_requirements():
        print("依赖安装失败，程序退出")
        return
    
    # 启动服务器
    start_server()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n服务器已停止")
    except Exception as e:
        print(f"程序运行出错: {e}")
        sys.exit(1)
