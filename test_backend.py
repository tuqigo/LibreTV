import requests
import json

# 后端服务器地址
BACKEND_URL = "http://localhost:5002"

def test_health():
    """测试健康检查"""
    try:
        response = requests.get(f"{BACKEND_URL}/api/health")
        print(f"健康检查: {response.status_code}")
        print(f"响应: {response.text}")
    except Exception as e:
        print(f"健康检查失败: {e}")

def test_register():
    """测试用户注册"""
    try:
        data = {
            "username": "testuser",
            "password": "123456"
        }
        response = requests.post(
            f"{BACKEND_URL}/api/auth/register",
            json=data,
            headers={'Content-Type': 'application/json'}
        )
        print(f"注册测试: {response.status_code}")
        print(f"响应: {response.text}")
        
        if response.status_code == 201:
            result = response.json()
            print(f"注册成功，用户ID: {result['user']['id']}")
            return result['token']
    except Exception as e:
        print(f"注册测试失败: {e}")
    return None

def test_login():
    """测试用户登录"""
    try:
        data = {
            "username": "testuser",
            "password": "123456"
        }
        response = requests.post(
            f"{BACKEND_URL}/api/auth/login",
            json=data,
            headers={'Content-Type': 'application/json'}
        )
        print(f"登录测试: {response.status_code}")
        print(f"响应: {response.text}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"登录成功，用户: {result['user']['username']}")
            return result['token']
    except Exception as e:
        print(f"登录测试失败: {e}")
    return None

def test_check_username():
    """测试用户名检查"""
    try:
        data = {"username": "testuser"}
        response = requests.post(
            f"{BACKEND_URL}/api/auth/check-username",
            json=data,
            headers={'Content-Type': 'application/json'}
        )
        print(f"用户名检查: {response.status_code}")
        print(f"响应: {response.text}")
    except Exception as e:
        print(f"用户名检查失败: {e}")

if __name__ == "__main__":
    print("开始测试后端API...")
    print("=" * 50)
    
    # 测试健康检查
    test_health()
    print()
    
    # 测试用户名检查
    test_check_username()
    print()
    
    # 测试注册
    token = test_register()
    print()
    
    # 测试登录
    if token:
        test_login()
    else:
        print("注册失败，跳过登录测试")
    
    print("=" * 50)
    print("测试完成")
