# API接口文档 API Documentation

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | YYYY-MM-DD |
| 最后修改 Last Modified | YYYY-MM-DD |
| API版本 API Version | v1 |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改内容 Description |
|-------------|---------|-------------------|
| v1.0.0 | YYYY-MM-DD | 初始版本 Initial Version |

---

## 目录 Table of Contents

1. [API概述 API Overview](#1-api概述-api-overview)
2. [通用规范 General Specifications](#2-通用规范-general-specifications)
3. [认证授权 Authentication & Authorization](#3-认证授权-authentication--authorization)
4. [用户模块 APIs](#4-用户模块-apis)
5. [订单模块 APIs](#5-订单模块-apis)
6. [错误码 Error Codes](#6-错误码-error-codes)

---

## 1. API概述 API Overview

### 1.1 基本信息 Basic Information

| 项目 Item | 内容 Content |
|---------|-------------|
| API名称 API Name | |
| 基础URL Base URL | `https://api.example.com` |
| API版本 API Version | v1 |
| 数据格式 Data Format | JSON |
| 字符编码 Charset | UTF-8 |

### 1.2 接口列表概览 API List Overview

| 模块 Module | 接口数量 Count | 说明 Description |
|----------|-------------|---------------|
| 公共接口 Public | 3 | 无需认证 |
| 用户模块 User | 5 | 用户相关 |
| 订单模块 Order | 6 | 订单相关 |
| 产品模块 Product | 4 | 产品相关 |
| 支付模块 Payment | 2 | 支付相关 |

---

## 2. 通用规范 General Specifications

### 2.1 请求头 Request Headers

| 头部 Header | 类型 Type | 必填 Required | 说明 Description | 示例 Example |
|-----------|---------|------------|---------------|-------------|
| Content-Type | String | 是 | 请求内容类型 | application/json |
| Accept | String | 是 | 响应内容类型 | application/json |
| Authorization | String | 条件 | 认证令牌 | Bearer {token} |
| X-Request-ID | String | 否 | 请求追踪ID | uuid |
| User-Agent | String | 是 | 用户代理 | MyApp/1.0.0 |

### 2.2 统一响应格式 Response Format

```json
{
  "code": 200,
  "message": "success",
  "data": {},
  "timestamp": 1234567890,
  "requestId": "uuid"
}
```

| 字段 Field | 类型 Type | 说明 Description |
|----------|---------|---------------|
| code | Integer | 响应码，200表示成功 |
| message | String | 响应消息 |
| data | Object/Array | 响应数据 |
| timestamp | Long | 响应时间戳(秒) |
| requestId | String | 请求追踪ID |

### 2.3 分页参数 Pagination

| 参数 Parameter | 类型 Type | 默认值 Default | 说明 Description |
|--------------|---------|--------------|---------------|
| page | Integer | 1 | 当前页码(从1开始) |
| size | Integer | 20 | 每页数量(1-100) |
| sort | String | created_at | 排序字段 |
| order | String | desc | 排序方向: asc/desc |

### 2.4 分页响应格式 Pagination Response

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "size": 20,
      "total": 100,
      "totalPages": 5,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

---

## 3. 认证授权 Authentication & Authorization

### 3.1 获取访问令牌 Get Access Token

#### POST /api/v1/auth/login

**请求体 Request Body:**

```json
{
  "account": "user@example.com",
  "password": "password123"
}
```

**响应 Response:**

```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "refresh_token_string",
    "tokenType": "Bearer",
    "expiresIn": 7200,
    "user": {
      "id": 1001,
      "username": "user@example.com",
      "roles": ["USER"]
    }
  }
}
```

### 3.2 刷新令牌 Refresh Token

#### POST /api/v1/auth/refresh

**请求体 Request Body:**

```json
{
  "refreshToken": "refresh_token_string"
}
```

**响应 Response:**

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "accessToken": "new_access_token",
    "refreshToken": "new_refresh_token",
    "expiresIn": 7200
  }
}
```

### 3.3 使用令牌 Use Token

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 4. 用户模块 APIs

### 4.1 用户注册 Register

#### POST /api/v1/public/user/register

**请求体 Request Body:**

```json
{
  "username": "newuser",
  "email": "newuser@example.com",
  "password": "password123",
  "phone": "13800138000"
}
```

**响应 Response:**

```json
{
  "code": 200,
  "message": "注册成功",
  "data": {
    "userId": 1001,
    "username": "newuser",
    "email": "newuser@example.com"
  }
}
```

### 4.2 获取用户信息 Get User Profile

#### GET /api/v1/user/profile

**请求头 Headers:**

```
Authorization: Bearer {token}
```

**响应 Response:**

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": 1001,
    "username": "user",
    "email": "user@example.com",
    "phone": "13800138000",
    "avatar": "https://cdn.example.com/avatar/1001.jpg",
    "status": "ACTIVE",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### 4.3 更新用户信息 Update User Profile

#### PUT /api/v1/user/profile

**请求头 Headers:**

```
Authorization: Bearer {token}
```

**请求体 Request Body:**

```json
{
  "username": "newusername",
  "phone": "13900139000",
  "avatar": "https://cdn.example.com/new-avatar.jpg"
}
```

**响应 Response:**

```json
{
  "code": 200,
  "message": "更新成功",
  "data": {
    "id": 1001,
    "username": "newusername",
    "email": "user@example.com",
    "phone": "13900139000",
    "avatar": "https://cdn.example.com/new-avatar.jpg"
  }
}
```

### 4.4 修改密码 Change Password

#### POST /api/v1/user/change-password

**请求头 Headers:**

```
Authorization: Bearer {token}
```

**请求体 Request Body:**

```json
{
  "oldPassword": "oldPassword123",
  "newPassword": "newPassword123"
}
```

**响应 Response:**

```json
{
  "code": 200,
  "message": "密码修改成功",
  "data": null
}
```

---

## 5. 订单模块 APIs

### 5.1 创建订单 Create Order

#### POST /api/v1/orders

**请求头 Headers:**

```
Authorization: Bearer {token}
```

**请求体 Request Body:**

```json
{
  "items": [
    {
      "productId": 1001,
      "skuId": 2001,
      "quantity": 2
    }
  ],
  "remark": "备注信息"
}
```

**响应 Response:**

```json
{
  "code": 200,
  "message": "订单创建成功",
  "data": {
    "orderId": 5001,
    "orderNo": "202401151234567890123456",
    "totalAmount": 299.00,
    "payAmount": 299.00,
    "status": "PENDING",
    "items": [
      {
        "productId": 1001,
        "productName": "商品A",
        "skuId": 2001,
        "skuSpecs": "颜色:红色;尺寸:L",
        "quantity": 2,
        "price": 99.00
      }
    ]
  }
}
```

### 5.2 获取订单详情 Get Order Detail

#### GET /api/v1/orders/{orderId}

**请求头 Headers:**

```
Authorization: Bearer {token}
```

**路径参数 Path Parameters:**

| 参数 Parameter | 类型 Type | 说明 Description |
|--------------|---------|---------------|
| orderId | Long | 订单ID |

**响应 Response:**

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "orderId": 5001,
    "orderNo": "202401151234567890123456",
    "userId": 1001,
    "totalAmount": 299.00,
    "payAmount": 299.00,
    "status": "PAID",
    "statusText": "已支付",
    "items": [
      {
        "itemId": 6001,
        "productId": 1001,
        "productName": "商品A",
        "productImage": "https://cdn.example.com/product/1001.jpg",
        "skuId": 2001,
        "skuSpecs": "颜色:红色;尺寸:L",
        "quantity": 2,
        "price": 99.00
      }
    ],
    "timeline": [
      {
        "status": "PENDING",
        "statusText": "待支付",
        "time": "2024-01-15T12:34:56Z"
      },
      {
        "status": "PAID",
        "statusText": "已支付",
        "time": "2024-01-15T12:35:00Z"
      }
    ]
  }
}
```

### 5.3 订单列表 Order List

#### GET /api/v1/orders

**请求头 Headers:**

```
Authorization: Bearer {token}
```

**查询参数 Query Parameters:**

| 参数 Parameter | 类型 Type | 必填 Required | 说明 Description |
|--------------|---------|------------|---------------|
| status | String | 否 | 订单状态筛选 |
| page | Integer | 否 | 页码，默认1 |
| size | Integer | 否 | 每页数量，默认20 |

**响应 Response:**

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [
      {
        "orderId": 5001,
        "orderNo": "202401151234567890123456",
        "totalAmount": 299.00,
        "payAmount": 299.00,
        "status": "PAID",
        "statusText": "已支付",
        "items": [
          {
            "productName": "商品A",
            "productImage": "https://cdn.example.com/product/1001.jpg",
            "quantity": 2
          }
        ],
        "createdAt": "2024-01-15T12:34:56Z"
      }
    ],
    "pagination": {
      "page": 1,
      "size": 20,
      "total": 50,
      "totalPages": 3
    }
  }
}
```

### 5.4 取消订单 Cancel Order

#### POST /api/v1/orders/{orderId}/cancel

**请求头 Headers:**

```
Authorization: Bearer {token}
```

**请求体 Request Body:**

```json
{
  "reason": "不想要了"
}
```

**响应 Response:**

```json
{
  "code": 200,
  "message": "订单已取消",
  "data": {
    "orderId": 5001,
    "orderNo": "202401151234567890123456",
    "status": "CANCELLED"
  }
}
```

---

## 6. 错误码 Error Codes

### 6.1 HTTP状态码 HTTP Status Codes

| 状态码 Status Code | 说明 Description |
|-----------------|---------------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

### 6.2 业务错误码 Business Error Codes

| 错误码 Error Code | HTTP状态 Status | 错误消息 Error Message |
|----------------|---------------|---------------------|
| 0 | 200 | success |
| 400 | 400 | 请求参数错误 |
| 401 | 401 | 未认证 |
| 403 | 403 | 无权限 |
| 404 | 404 | 资源不存在 |
| 10001 | 400 | 用户名已存在 |
| 10002 | 400 | 邮箱已存在 |
| 10003 | 401 | 用户名或密码错误 |
| 10004 | 401 | 账号已被禁用 |
| 20001 | 400 | 库存不足 |
| 20002 | 404 | 订单不存在 |
| 30001 | 404 | 商品不存在 |
| 50000 | 500 | 系统错误 |

### 6.3 错误响应示例 Error Response Example

```json
{
  "code": 10001,
  "message": "用户名已存在",
  "data": null,
  "timestamp": 1234567890,
  "requestId": "uuid",
  "errors": [
    {
      "field": "username",
      "message": "该用户名已被注册，请更换"
    }
  ]
}
```

---

## 附录 Appendix

### 附录A：状态枚举 Status Enums

#### 订单状态 Order Status

| 值 Value | 状态 Status | 说明 Description |
|---------|-----------|---------------|
| PENDING | 待支付 | 订单已创建，等待支付 |
| PAID | 已支付 | 订单已支付 |
| SHIPPED | 已发货 | 订单已发货 |
| COMPLETED | 已完成 | 订单已完成 |
| CANCELLED | 已取消 | 订单已取消 |
| REFUNDED | 已退款 | 订单已退款 |

### 附录B：接口测试工具 API Testing Tools

| 工具 Tool | 说明 Description |
|---------|---------------|
| Postman | API测试工具 |
| cURL | 命令行工具 |
| Swagger UI | 在线API文档 |

---

**文档结束 End of Document**
