# 接口设计文档 API Design Document

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | YYYY-MM-DD |
| 最后修改 Last Modified | YYYY-MM-DD |
| 接口设计师 API Designer | |
| 基础URL Base URL | https://api.example.com |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | YYYY-MM-DD | [Name] | | 初始版本 Initial Version |

---

## 目录 Table of Contents

1. [接口概述 API Overview](#1-接口概述-api-overview)
2. [接口规范 API Specifications](#2-接口规范-api-specifications)
3. [通用接口 Common APIs](#3-通用接口-common-apis)
4. [用户模块 APIs](#4-用户模块-apis)
5. [订单模块 APIs](#5-订单模块-apis)
6. [产品模块 APIs](#6-产品模块-apis)
7. [错误码定义 Error Codes](#7-错误码定义-error-codes)

---

## 1. 接口概述 API Overview

### 1.1 接口设计原则 Design Principles

| 原则 Principle | 说明 Description |
|--------------|---------------|
| RESTful | 遵循REST架构风格 |
| 版本控制 | 通过URL进行版本控制，如 /api/v1/ |
| 统一响应 | 使用统一的响应格式 |
| 幂等性 | GET、PUT、DELETE操作保持幂等 |
| 安全性 | 敏感操作需认证授权 |

### 1.2 通用规范 General Specifications

| 规范项 Specification | 规范内容 Content |
|-------------------|----------------|
| 协议 Protocol | HTTPS |
| 数据格式 Data Format | JSON |
| 字符编码 Charset | UTF-8 |
| 时间格式 DateTime | ISO 8601 (yyyy-MM-dd'T'HH:mm:ss'Z') |
| 布尔值 Boolean | true / false |

### 1.3 接口分类 API Categories

| 分类 Category | 前缀 Prefix | 说明 Description |
|------------|-----------|---------------|
| 公开接口 Public | /api/v1/public/ | 无需认证即可访问 |
| 用户接口 User | /api/v1/user/ | 用户相关接口 |
| 订单接口 Order | /api/v1/order/ | 订单相关接口 |
| 产品接口 Product | /api/v1/product/ | 产品相关接口 |
| 管理接口 Admin | /api/v1/admin/ | 管理后台接口 |

---

## 2. 接口规范 API Specifications

### 2.1 请求规范 Request Specification

#### 请求头 Request Headers

| 头部 Header | 是否必需 Required | 说明 Description | 示例 Example |
|-----------|----------------|---------------|-------------|
| Content-Type | 是 | 请求内容类型 | application/json |
| Accept | 是 | 响应内容类型 | application/json |
| Authorization | 条件 | 认证令牌 | Bearer {token} |
| X-Request-ID | 否 | 请求追踪ID | uuid |
| X-Client-Version | 否 | 客户端版本 | 1.0.0 |
| User-Agent | 是 | 用户代理 | MyApp/1.0.0 (iOS) |

#### 请求方法 HTTP Methods

| 方法 Method | 说明 Description | 幂等性 Idempotent |
|-----------|---------------|----------------|
| GET | 获取资源 | 是 |
| POST | 创建资源 | 否 |
| PUT | 完整更新资源 | 是 |
| PATCH | 部分更新资源 | 否 |
| DELETE | 删除资源 | 是 |

#### 分页参数 Pagination

| 参数 Parameter | 类型 Type | 默认值 Default | 说明 Description |
|--------------|---------|--------------|---------------|
| page | Integer | 1 | 当前页码(从1开始) |
| size | Integer | 20 | 每页数量(1-100) |
| sort | String | created_at | 排序字段 |
| order | String | desc | 排序方向: asc/desc |

### 2.2 响应规范 Response Specification

#### 统一响应结构 Unified Response Structure

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

#### 分页响应结构 Pagination Response

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

### 2.3 认证授权 Authentication & Authorization

#### JWT令牌认证 JWT Authentication

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### 令牌刷新 Token Refresh

**请求:**

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refreshToken": "refresh_token_string"
}
```

**响应:**

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

---

## 3. 通用接口 Common APIs

### 3.1 文件上传 File Upload

#### POST /api/v1/common/upload

**请求:**

| 参数 Parameter | 类型 Type | 必填 Required | 说明 Description |
|--------------|---------|------------|---------------|
| file | File | 是 | 上传的文件 |
| type | String | 否 | 文件类型: image/document/other |

**响应:**

```json
{
  "code": 200,
  "message": "上传成功",
  "data": {
    "fileId": "f_1234567890",
    "fileName": "example.jpg",
    "fileSize": 102400,
    "fileType": "image/jpeg",
    "url": "https://cdn.example.com/files/f_1234567890.jpg",
    "thumbnail": "https://cdn.example.com/files/f_1234567890_thumb.jpg"
  }
}
```

### 3.2 获取配置 Get Configuration

#### GET /api/v1/common/config

**请求参数 Query Parameters:**

| 参数 Parameter | 类型 Type | 必填 Required | 说明 Description |
|--------------|---------|------------|---------------|
| keys | String | 否 | 配置键，多个用逗号分隔 |

**响应:**

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "siteName": "My Project",
    "siteLogo": "https://cdn.example.com/logo.png",
    "uploadMaxSize": 10485760
  }
}
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

**字段验证 Validation:**

| 字段 Field | 验证规则 Validation |
|----------|------------------|
| username | 3-50字符，字母数字下划线 |
| email | 有效邮箱格式 |
| password | 6-20字符 |
| phone | 有效手机号(可选) |

**响应:**

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

### 4.2 用户登录 Login

#### POST /api/v1/public/user/login

**请求体 Request Body:**

```json
{
  "account": "user@example.com",
  "password": "password123",
  "captcha": "1234",
  "captchaKey": "uuid"
}
```

**响应:**

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
      "email": "user@example.com",
      "avatar": "https://cdn.example.com/avatar/1001.jpg",
      "roles": ["USER"]
    }
  }
}
```

### 4.3 获取用户信息 Get User Profile

#### GET /api/v1/user/profile

**请求头 Headers:**

```
Authorization: Bearer {token}
```

**响应:**

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
    "createdAt": "2024-01-01T00:00:00Z",
    "lastLoginAt": "2024-01-15T12:30:00Z"
  }
}
```

### 4.4 更新用户信息 Update User Profile

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

**响应:**

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

### 4.5 修改密码 Change Password

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

**响应:**

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
    },
    {
      "productId": 1002,
      "skuId": 2002,
      "quantity": 1
    }
  ],
  "remark": "备注信息"
}
```

**响应:**

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
        "price": 99.00,
        "totalAmount": 198.00
      }
    ],
    "createdAt": "2024-01-15T12:34:56Z"
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

**响应:**

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "orderId": 5001,
    "orderNo": "202401151234567890123456",
    "userId": 1001,
    "totalAmount": 299.00,
    "discountAmount": 0.00,
    "payAmount": 299.00,
    "status": "PAID",
    "statusText": "已支付",
    "payType": "WECHAT",
    "payTime": "2024-01-15T12:35:00Z",
    "items": [
      {
        "itemId": 6001,
        "productId": 1001,
        "productName": "商品A",
        "productImage": "https://cdn.example.com/product/1001.jpg",
        "skuId": 2001,
        "skuSpecs": "颜色:红色;尺寸:L",
        "quantity": 2,
        "price": 99.00,
        "totalAmount": 198.00
      }
    ],
    "createdAt": "2024-01-15T12:34:56Z",
    "updatedAt": "2024-01-15T12:35:00Z",
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
| sort | String | 否 | 排序字段，默认created_at |
| order | String | 否 | 排序方向，默认desc |

**响应:**

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
      "totalPages": 3,
      "hasNext": true,
      "hasPrev": false
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

**响应:**

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

## 6. 产品模块 APIs

### 6.1 产品列表 Product List

#### GET /api/v1/products

**查询参数 Query Parameters:**

| 参数 Parameter | 类型 Type | 必填 Required | 说明 Description |
|--------------|---------|------------|---------------|
| categoryId | Long | 否 | 分类ID |
| keyword | String | 否 | 搜索关键词 |
| page | Integer | 否 | 页码，默认1 |
| size | Integer | 否 | 每页数量，默认20 |
| sort | String | 否 | 排序字段 |
| order | String | 否 | 排序方向 |

**响应:**

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [
      {
        "productId": 1001,
        "productName": "商品A",
        "subtitle": "商品副标题",
        "mainImage": "https://cdn.example.com/product/1001.jpg",
        "price": 99.00,
        "originalPrice": 129.00,
        "sales": 1000,
        "stock": 500
      }
    ],
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

### 6.2 产品详情 Product Detail

#### GET /api/v1/products/{productId}

**路径参数 Path Parameters:**

| 参数 Parameter | 类型 Type | 说明 Description |
|--------------|---------|---------------|
| productId | Long | 产品ID |

**响应:**

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "productId": 1001,
    "productName": "商品A",
    "subtitle": "商品副标题",
    "mainImage": "https://cdn.example.com/product/1001.jpg",
    "images": [
      "https://cdn.example.com/product/1001_1.jpg",
      "https://cdn.example.com/product/1001_2.jpg"
    ],
    "detail": "<p>产品详情HTML内容</p>",
    "price": 99.00,
    "originalPrice": 129.00,
    "sales": 1000,
    "stock": 500,
    "categoryId": 101,
    "categoryName": "分类名称",
    "skus": [
      {
        "skuId": 2001,
        "skuName": "红色-L",
        "specs": {
          "颜色": "红色",
          "尺寸": "L"
        },
        "price": 99.00,
        "stock": 200
      },
      {
        "skuId": 2002,
        "skuName": "蓝色-L",
        "specs": {
          "颜色": "蓝色",
          "尺寸": "L"
        },
        "price": 99.00,
        "stock": 300
      }
    ]
  }
}
```

### 6.3 产品分类 Product Categories

#### GET /api/v1/products/categories

**响应:**

```json
{
  "code": 200,
  "message": "success",
  "data": [
    {
      "categoryId": 101,
      "categoryName": "分类A",
      "parentId": 0,
      "level": 1,
      "sort": 1,
      "children": [
        {
          "categoryId": 102,
          "categoryName": "分类A-1",
          "parentId": 101,
          "level": 2,
          "sort": 1,
          "children": []
        }
      ]
    }
  ]
}
```

---

## 7. 错误码定义 Error Codes

### 7.1 HTTP状态码 HTTP Status Codes

| 状态码 Status Code | 说明 Description |
|-----------------|---------------|
| 200 | 成功 |
| 201 | 创建成功 |
| 204 | 成功，无返回内容 |
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 422 | 验证失败 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |
| 503 | 服务不可用 |

### 7.2 业务错误码 Business Error Codes

| 错误码 Error Code | HTTP状态 Status | 错误消息 Error Message | 说明 Description |
|----------------|---------------|---------------------|---------------|
| 0 | 200 | success | 成功 |
| 400 | 400 | 请求参数错误 | 参数错误 |
| 401 | 401 | 未认证 | 未登录或token失效 |
| 403 | 403 | 无权限 | 无权限访问 |
| 404 | 404 | 资源不存在 | 请求的资源不存在 |
| 10001 | 400 | 用户名已存在 | 用户名已被注册 |
| 10002 | 400 | 邮箱已存在 | 邮箱已被注册 |
| 10003 | 401 | 用户名或密码错误 | 登录凭证错误 |
| 10004 | 401 | 账号已被禁用 | 账号状态异常 |
| 10005 | 404 | 用户不存在 | 用户不存在 |
| 20001 | 400 | 库存不足 | 商品库存不足 |
| 20002 | 404 | 订单不存在 | 订单ID无效 |
| 20003 | 400 | 订单状态不允许此操作 | 订单状态校验失败 |
| 30001 | 404 | 商品不存在 | 商品ID无效 |
| 30002 | 400 | 商品已下架 | 商品已下架 |
| 50000 | 500 | 系统错误 | 服务器内部错误 |
| 50001 | 503 | 服务维护中 | 系统维护中 |

### 7.3 错误响应示例 Error Response Example

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

### 附录A：接口测试工具 API Testing Tools

| 工具 Tool | 说明 Description |
|---------|---------------|
| Postman | API测试工具 |
| cURL | 命令行工具 |
| Swagger/OpenAPI | API文档生成 |

### 附录B：接口版本管理 API Versioning

| 版本 Version | 状态 Status | 说明 Description |
|-----------|---------|---------------|
| v1 | 当前版本 Current | 稳定版本 |
| v2 | 开发中 In Development | 下一版本 |

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 接口设计师 API Designer | | | |
| 后端负责人 Backend Lead | | | |
| 前端负责人 Frontend Lead | | | |

---

**文档结束 End of Document**
