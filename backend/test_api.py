#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LibreTV API 测试脚本
"""

import requests
import json
import time

# 测试配置
BASE_URL = "http://localhost:5002"
TEST_USER = {
    "username": "testuser",
    "password": "testpass123",
    "email": "test@example.com"
}

def test_health_check():
    """测试健康检查接口"""
    print("🔍 测试健康检查接口...")
    try:
        response = requests.get(f"{BASE_URL}/api/health")
        if response.status_code == 200:
            print("✅ 健康检查通过")
            return True
        else:
            print(f"❌ 健康检查失败: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ 健康检查异常: {e}")
        return False

def test_username_check():
    """测试用户名检查接口"""
    print("🔍 测试用户名检查接口...")
    try:
        response = requests.post(
            f"{BASE_URL}/api/auth/check-username",
            json={"username": TEST_USER["username"]},
            headers={"Content-Type": "application/json"}
        )
        if response.status_code == 200:
            data = response.json()
            print(f"✅ 用户名检查通过: {data}")
            return True
        else:
            print(f"❌ 用户名检查失败: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ 用户名检查异常: {e}")
        return False

def test_user_registration():
    """测试用户注册接口"""
    print("🔍 测试用户注册接口...")
    try:
        response = requests.post(
            f"{BASE_URL}/api/auth/register",
            json=TEST_USER,
            headers={"Content-Type": "application/json"}
        )
        if response.status_code == 201:
            data = response.json()
            print("✅ 用户注册成功")
            print(f"   用户ID: {data['user']['id']}")
            print(f"   用户名: {data['user']['username']}")
            return data.get("token")
        else:
            print(f"❌ 用户注册失败: {response.status_code}")
            data = response.json()
            print(f"   错误信息: {data.get('error', '未知错误')}")
            return None
    except Exception as e:
        print(f"❌ 用户注册异常: {e}")
        return None

def test_user_login():
    """测试用户登录接口"""
    print("🔍 测试用户登录接口...")
    try:
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={
                "username": TEST_USER["username"],
                "password": TEST_USER["password"]
            },
            headers={"Content-Type": "application/json"}
        )
        if response.status_code == 200:
            data = response.json()
            print("✅ 用户登录成功")
            return data.get("token")
        else:
            print(f"❌ 用户登录失败: {response.status_code}")
            data = response.json()
            print(f"   错误信息: {data.get('error', '未知错误')}")
            return None
    except Exception as e:
        print(f"❌ 用户登录异常: {e}")
        return None

def test_user_profile(token):
    """测试获取用户信息接口"""
    print("🔍 测试获取用户信息接口...")
    try:
        response = requests.get(
            f"{BASE_URL}/api/auth/profile",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
        )
        if response.status_code == 200:
            data = response.json()
            print("✅ 获取用户信息成功")
            print(f"   用户名: {data['user']['username']}")
            print(f"   邮箱: {data['user']['email']}")
            return True
        else:
            print(f"❌ 获取用户信息失败: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ 获取用户信息异常: {e}")
        return False

def test_viewing_history(token):
    """测试观看历史接口"""
    print("🔍 测试观看历史接口...")
    try:
        # 测试获取历史记录
        response = requests.get(
            f"{BASE_URL}/api/viewing-history/keys",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
        )
        if response.status_code == 200:
            data = response.json()
            print("✅ 获取观看历史成功")
            print(f"   历史记录数量: {len(data.get('keys', []))}")
        else:
            print(f"❌ 获取观看历史失败: {response.status_code}")
            return False
        
        # 测试保存观看历史
        test_data = {
            "title": "测试视频",
            "url": "https://example.com/test",
            "timestamp": int(time.time())
        }
        
        response = requests.post(
            f"{BASE_URL}/api/viewing-history/operation?key=test_history",
            json=test_data,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
        )
        if response.status_code == 200:
            print("✅ 保存观看历史成功")
            return True
        else:
            print(f"❌ 保存观看历史失败: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ 观看历史测试异常: {e}")
        return False

def test_user_config(token):
    """测试用户配置接口"""
    print("🔍 测试用户配置接口...")
    try:
        # 测试保存配置
        test_config = {
            "value": {
                "theme": "dark",
                "language": "zh-CN"
            }
        }
        
        response = requests.post(
            f"{BASE_URL}/api/user-config/preferences",
            json=test_config,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
        )
        if response.status_code == 200:
            print("✅ 保存用户配置成功")
        else:
            print(f"❌ 保存用户配置失败: {response.status_code}")
            return False
        
        # 测试获取配置
        response = requests.get(
            f"{BASE_URL}/api/user-config/preferences",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
        )
        if response.status_code == 200:
            data = response.json()
            print("✅ 获取用户配置成功")
            print(f"   配置内容: {data['value']}")
            return True
        else:
            print(f"❌ 获取用户配置失败: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ 用户配置测试异常: {e}")
        return False

def test_rate_limiting():
    """测试频率限制"""
    print("🔍 测试频率限制...")
    try:
        # 快速发送多个请求测试频率限制
        for i in range(6):
            response = requests.post(
                f"{BASE_URL}/api/auth/login",
                json={
                    "username": f"testuser{i}",
                    "password": "wrongpassword"
                },
                headers={"Content-Type": "application/json"}
            )
            print(f"   请求 {i+1}: {response.status_code}")
            if response.status_code == 429:
                print("✅ 频率限制生效")
                return True
        
        print("⚠️  频率限制可能未生效")
        return True
        
    except Exception as e:
        print(f"❌ 频率限制测试异常: {e}")
        return False

def main():
    """主测试函数"""
    print("=" * 60)
    print("LibreTV API 测试开始")
    print("=" * 60)
    
    # 检查服务是否运行
    if not test_health_check():
        print("❌ 后端服务未运行，请先启动服务")
        return
    
    print()
    
    # 测试用户名检查
    test_username_check()
    print()
    
    # 测试用户注册
    token = test_user_registration()
    if not token:
        print("❌ 用户注册失败，跳过后续测试")
        return
    
    print()
    
    # 测试用户登录
    login_token = test_user_login()
    if not login_token:
        print("❌ 用户登录失败，跳过后续测试")
        return
    
    print()
    
    # 测试获取用户信息
    test_user_profile(login_token)
    print()
    
    # 测试观看历史
    test_viewing_history(login_token)
    print()
    
    # 测试用户配置
    test_user_config(login_token)
    print()
    
    # 测试频率限制
    test_rate_limiting()
    print()
    
    print("=" * 60)
    print("✅ 所有测试完成！")
    print("=" * 60)

if __name__ == "__main__":
    main()
