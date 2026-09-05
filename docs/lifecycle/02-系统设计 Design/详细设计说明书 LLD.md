# 详细设计说明书 LLD (Low-Level Design)

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | YYYY-MM-DD |
| 最后修改 Last Modified | YYYY-MM-DD |
| 设计师 Designer | |
| 对应HLD版本 HLD Version | |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | YYYY-MM-DD | [Name] | | 初始版本 Initial Version |

---

## 目录 Table of Contents

1. [概述 Overview](#1-概述-overview)
2. [模块详细设计 Module Detail Design](#2-模块详细设计-module-detail-design)
3. [类设计 Class Design](#3-类设计-class-design)
4. [接口详细设计 API Detail Design](#4-接口详细设计-api-detail-design)
5. [数据结构详细设计 Data Structure Design](#5-数据结构详细设计-data-structure-design)
6. [算法设计 Algorithm Design](#6-算法设计-algorithm-design)
7. [异常处理设计 Exception Handling](#7-异常处理设计-exception-handling)

---

## 1. 概述 Overview

### 1.1 文档目的 Document Purpose

本文档提供系统的详细设计，包括类图、时序图、数据结构、算法逻辑等，作为开发实现的直接依据。

### 1.2 参考文档 References

| 文档名称 Document | 版本 Version |
|----------------|-------------|
| 概要设计说明书 HLD | |
| 产品需求文档 PRD | |

---

## 2. 模块详细设计 Module Detail Design

### 2.1 模块1：用户模块 User Module

#### 2.1.1 模块概述 Module Overview

| 属性 Attribute | 值 Value |
|-------------|---------|
| 模块ID Module ID | M-001 |
| 模块名称 Module Name | UserModule |
| 负责人 Owner | |
| 包 Package | com.example.project.module.user |

#### 2.1.2 类图 Class Diagram

```
┌───────────────────────────────────────────────────────────────┐
│                         UserController                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ + login(request: LoginRequest): Response               │  │
│  │ + register(request: RegisterRequest): Response         │  │
│  │ + getProfile(id: String): Response                     │  │
│  │ + updateProfile(request: UpdateRequest): Response      │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                         UserService                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ - userRepository: UserRepository                        │  │
│  │ - passwordEncoder: PasswordEncoder                      │  │
│  │ - tokenService: TokenService                            │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ + login(username, password): User                       │  │
│  │ + register(userDTO): User                               │  │
│  │ + getProfile(id): UserDTO                               │  │
│  │ + updateProfile(id, userDTO): User                      │  │
│  │ - validatePassword(raw, encoded): boolean               │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                      UserRepository                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ + findById(id: Long): Optional<User>                   │  │
│  │ + findByUsername(username: String): Optional<User>     │  │
│  │ + findByEmail(email: String): Optional<User>           │  │
│  │ + save(user: User): User                               │  │
│  │ + existsByUsername(username: String): boolean          │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

#### 2.1.3 时序图 Sequence Diagram

**登录流程 Login Flow:**

```
用户           Controller          Service        Repository       Database
 │                 │                 │                 │              │
 │─ login()  ─────▶│                 │                 │              │
 │                 │─ login()  ─────▶│                 │              │
 │                 │                 │─ findByUsername()──▶         │
 │                 │                 │                 │─ SELECT ──▶ │
 │                 │                 │                 │◀─ Result ───│
 │                 │                 │◀── User ────────│              │
 │                 │                 │─ validatePassword()            │
 │                 │                 │─ generateToken()              │
 │                 │◀── Response ───│                 │              │
 │◀── Response ───│                 │                 │              │
```

#### 2.1.4 核心流程 Core Flows

**登录流程 Login Flow:**

```
BEGIN
  INPUT: username, password
  │
  ├─ 1. 参数验证 Validate Parameters
  │   IF username or password is empty
  │     RETURN Error("用户名或密码不能为空")
  │   END IF
  │
  ├─ 2. 查找用户 Find User
  │   user = userRepository.findByUsername(username)
  │   IF user is null
  │     RETURN Error("用户不存在")
  │   END IF
  │
  ├─ 3. 验证密码 Validate Password
  │   IF NOT passwordEncoder.matches(password, user.password)
  │     RETURN Error("密码错误")
  │   END IF
  │
  ├─ 4. 检查状态 Check Status
  │   IF user.status != ACTIVE
  │     RETURN Error("账号已被禁用")
  │   END IF
  │
  ├─ 5. 生成令牌 Generate Token
  │   token = tokenService.generate(user)
  │
  ├─ 6. 更新登录时间 Update Last Login
  │   user.lastLoginTime = now()
  │   userRepository.save(user)
  │
  └─ 7. 返回结果 Return Result
      RETURN Success(token, userInfo)
END
```

**注册流程 Register Flow:**

```
BEGIN
  INPUT: username, password, email
  │
  ├─ 1. 参数验证
  │   IF any field is empty
  │     RETURN Error("参数不完整")
  │   END IF
  │
  ├─ 2. 检查用户名是否存在
  │   IF userRepository.existsByUsername(username)
  │     RETURN Error("用户名已存在")
  │   END IF
  │
  ├─ 3. 检查邮箱是否存在
  │   IF userRepository.existsByEmail(email)
  │     RETURN Error("邮箱已被注册")
  │   END IF
  │
  ├─ 4. 创建用户
  │   user = new User()
  │   user.username = username
  │   user.email = email
  │   user.password = passwordEncoder.encode(password)
  │   user.status = ACTIVE
  │   user.createTime = now()
  │
  ├─ 5. 保存用户
  │   user = userRepository.save(user)
  │
  └─ 6. 返回结果
      RETURN Success(userId)
END
```

### 2.2 模块2：订单模块 Order Module

#### 2.2.1 模块概述 Module Overview

| 属性 Attribute | 值 Value |
|-------------|---------|
| 模块ID Module ID | M-002 |
| 模块名称 Module Name | OrderModule |
| 负责人 Owner | |
| 包 Package | com.example.project.module.order |

#### 2.2.2 类图 Class Diagram

```
┌───────────────────────────────────────────────────────────────┐
│                       OrderController                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ + createOrder(request: CreateOrderRequest): Response   │  │
│  │ + getOrder(id: String): Response                       │  │
│  │ + listOrders(query: OrderQuery): Response              │  │
│  │ + cancelOrder(id: String): Response                    │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                        OrderService                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ - orderRepository: OrderRepository                      │  │
│  │ - productRepository: ProductRepository                  │  │
│  │ - inventoryService: InventoryService                    │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ + createOrder(userId, items): Order                     │  │
│  │ + getOrder(id): OrderDTO                                │  │
│  │ + cancelOrder(id): boolean                              │  │
│  │ - validateInventory(items): boolean                     │  │
│  │ - calculatePrice(items): BigDecimal                     │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

#### 2.2.3 时序图 Sequence Diagram

**创建订单流程 Create Order Flow:**

```
用户           Controller          Service       InventoryService    Repository
 │                 │                 │                  │                │
 │─ createOrder() ─▶│                 │                  │                │
 │                 │─ createOrder() ─▶│                  │                │
 │                 │                 │─ checkStock() ──▶│                │
 │                 │                 │                  │── Query ──────▶│
 │                 │                 │                  │◀─ Result ─────│
 │                 │                 │◀── boolean ───────│                │
 │                 │                 │─ deductStock() ──▶│                │
 │                 │                 │                  │── Update ─────▶│
 │                 │                 │                  │◀─ Success ────│
 │                 │                 │◀── void ─────────│                │
 │                 │                 │─ save() ────────────────────────▶│
 │                 │                 │                  │           ───▶│
 │                 │                 │◀─────────────────────────────────│
 │                 │◀── Response ───│                  │                │
 │◀── Response ───│                 │                  │                │
```

---

## 3. 类设计 Class Design

### 3.1 实体类设计 Entity Classes

#### User.java

```java
package com.example.project.entity;

import javax.persistence.*;
import java.time.LocalDateTime;

/**
 * 用户实体类
 * User Entity
 */
@Entity
@Table(name = "t_user")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 50)
    private String username;

    @Column(nullable = false, unique = true, length = 100)
    private String email;

    @Column(nullable = false)
    private String password;

    @Column(length = 20)
    private String phone;

    @Column(length = 100)
    private String avatar;

    @Column(length = 50)
    private String status = "ACTIVE"; // ACTIVE, INACTIVE, BANNED

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "last_login_at")
    private LocalDateTime lastLoginAt;

    // Constructors
    public User() {}

    public User(String username, String email, String password) {
        this.username = username;
        this.email = email;
        this.password = password;
        this.createdAt = LocalDateTime.now();
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    // ... 其他getter/setter
}
```

#### Order.java

```java
package com.example.project.entity;

import javax.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 订单实体类
 * Order Entity
 */
@Entity
@Table(name = "t_order")
public class Order {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "order_no", nullable = false, unique = true, length = 32)
    private String orderNo;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false, precision = 10, scale = 2)
    private BigDecimal totalAmount;

    @Column(length = 20)
    private String status = "PENDING"; // PENDING, PAID, SHIPPED, COMPLETED, CANCELLED

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL)
    private List<OrderItem> items = new ArrayList<>();

    // Constructors, Getters, Setters...
}
```

### 3.2 DTO类设计 DTO Classes

#### UserDTO.java

```java
package com.example.project.dto;

/**
 * 用户数据传输对象
 * User Data Transfer Object
 */
public class UserDTO {
    private Long id;
    private String username;
    private String email;
    private String avatar;
    private String status;
    private LocalDateTime createdAt;

    // Constructors
    // Getters and Setters
}
```

#### LoginRequest.java

```java
package com.example.project.dto;

import javax.validation.constraints.NotBlank;

/**
 * 登录请求DTO
 * Login Request DTO
 */
public class LoginRequest {

    @NotBlank(message = "用户名不能为空")
    private String username;

    @NotBlank(message = "密码不能为空")
    private String password;

    // Getters and Setters
}
```

### 3.3 服务类设计 Service Classes

#### UserService.java (接口)

```java
package com.example.project.service;

import com.example.project.dto.*;
import com.example.project.entity.User;

/**
 * 用户服务接口
 * User Service Interface
 */
public interface UserService {

    /**
     * 用户登录
     * @param request 登录请求
     * @return 登录响应
     */
    LoginResponse login(LoginRequest request);

    /**
     * 用户注册
     * @param request 注册请求
     * @return 用户信息
     */
    UserDTO register(RegisterRequest request);

    /**
     * 获取用户信息
     * @param userId 用户ID
     * @return 用户信息
     */
    UserDTO getProfile(Long userId);

    /**
     * 更新用户信息
     * @param userId 用户ID
     * @param request 更新请求
     * @return 更新后的用户信息
     */
    UserDTO updateProfile(Long userId, UpdateUserRequest request);
}
```

#### UserServiceImpl.java (实现)

```java
package com.example.project.service.impl;

import com.example.project.dto.*;
import com.example.project.entity.User;
import com.example.project.repository.UserRepository;
import com.example.project.service.UserService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

/**
 * 用户服务实现类
 * User Service Implementation
 */
@Service
public class UserServiceImpl implements UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final TokenService tokenService;

    public UserServiceImpl(UserRepository userRepository,
                          PasswordEncoder passwordEncoder,
                          TokenService tokenService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.tokenService = tokenService;
    }

    @Override
    public LoginResponse login(LoginRequest request) {
        // 1. 查找用户
        User user = userRepository.findByUsername(request.getUsername())
            .orElseThrow(() -> new BusinessException("用户不存在"));

        // 2. 验证密码
        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new BusinessException("密码错误");
        }

        // 3. 检查状态
        if (!"ACTIVE".equals(user.getStatus())) {
            throw new BusinessException("账号已被禁用");
        }

        // 4. 生成令牌
        String token = tokenService.generate(user);

        // 5. 更新登录时间
        user.setLastLoginAt(LocalDateTime.now());
        userRepository.save(user);

        // 6. 返回结果
        return new LoginResponse(token, convertToDTO(user));
    }

    // ... 其他方法实现

    private UserDTO convertToDTO(User user) {
        UserDTO dto = new UserDTO();
        dto.setId(user.getId());
        dto.setUsername(user.getUsername());
        dto.setEmail(user.getEmail());
        dto.setAvatar(user.getAvatar());
        dto.setStatus(user.getStatus());
        dto.setCreatedAt(user.getCreatedAt());
        return dto;
    }
}
```

---

## 4. 接口详细设计 API Detail Design

### 4.1 用户登录 API

#### POST /api/v1/user/login

**请求 Request:**

| 字段 Field | 类型 Type | 必填 Required | 说明 Description |
|----------|---------|------------|---------------|
| username | String | 是 | 用户名 |
| password | String | 是 | 密码 |

**请求示例:**

```json
{
  "username": "user@example.com",
  "password": "password123"
}
```

**响应 Response:**

| 字段 Field | 类型 Type | 说明 Description |
|----------|---------|---------------|
| code | Integer | 响应码，200表示成功 |
| message | String | 响应消息 |
| data | Object | 响应数据 |
| data.token | String | 认证令牌 |
| data.user | Object | 用户信息 |
| data.user.id | Long | 用户ID |
| data.user.username | String | 用户名 |
| data.user.email | String | 邮箱 |

**响应示例:**

```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1001,
      "username": "user@example.com",
      "email": "user@example.com",
      "avatar": "https://cdn.example.com/avatar/1001.jpg"
    }
  },
  "timestamp": 1234567890
}
```

**错误响应:**

```json
{
  "code": 401,
  "message": "用户名或密码错误",
  "data": null,
  "timestamp": 1234567890
}
```

### 4.2 用户注册 API

#### POST /api/v1/user/register

**请求 Request:**

| 字段 Field | 类型 Type | 必填 Required | 验证规则 Validation |
|----------|---------|------------|-------------------|
| username | String | 是 | 3-50字符，字母数字下划线 |
| email | String | 是 | 有效邮箱格式 |
| password | String | 是 | 6-20字符 |
| phone | String | 否 | 有效手机号 |

**请求示例:**

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
    "userId": 1002
  },
  "timestamp": 1234567890
}
```

---

## 5. 数据结构详细设计 Data Structure Design

### 5.1 数据库表详细设计 Database Table Design

#### t_user (用户表)

| 字段名 Field | 类型 Type | 长度 Length | 允许空 Null | 默认值 Default | 索引 Index | 说明 Description |
|------------|---------|----------|-----------|-------------|----------|---------------|
| id | BIGINT | - | NO | AUTO_INCREMENT | PK | 主键 |
| username | VARCHAR | 50 | NO | - | UK | 用户名 |
| email | VARCHAR | 100 | NO | - | UK | 邮箱 |
| password | VARCHAR | 255 | NO | - | - | 加密密码 |
| phone | VARCHAR | 20 | YES | NULL | - | 手机号 |
| avatar | VARCHAR | 255 | YES | NULL | - | 头像URL |
| status | VARCHAR | 20 | NO | 'ACTIVE' | IDX | 状态 |
| created_at | DATETIME | - | NO | CURRENT_TIMESTAMP | - | 创建时间 |
| updated_at | DATETIME | - | YES | NULL | - | 更新时间 |
| last_login_at | DATETIME | - | YES | NULL | - | 最后登录时间 |

**索引说明:**

| 索引名 Index Name | 类型 Type | 字段 Fields |
|-----------------|---------|-----------|
| PRIMARY | PRIMARY KEY | id |
| uk_username | UNIQUE | username |
| uk_email | UNIQUE | email |
| idx_status | INDEX | status |
| idx_created_at | INDEX | created_at |

#### t_order (订单表)

| 字段名 Field | 类型 Type | 长度 Length | 允许空 Null | 默认值 Default | 索引 Index | 说明 Description |
|------------|---------|----------|-----------|-------------|----------|---------------|
| id | BIGINT | - | NO | AUTO_INCREMENT | PK | 主键 |
| order_no | VARCHAR | 32 | NO | - | UK | 订单号 |
| user_id | BIGINT | - | NO | - | IDX | 用户ID |
| total_amount | DECIMAL | 10,2 | NO | 0.00 | - | 订单金额 |
| status | VARCHAR | 20 | NO | 'PENDING' | IDX | 订单状态 |
| created_at | DATETIME | - | NO | CURRENT_TIMESTAMP | IDX | 创建时间 |
| updated_at | DATETIME | - | YES | NULL | - | 更新时间 |

### 5.2 缓存数据结构 Cache Data Structure

#### Redis数据结构

**用户会话 User Session:**

```
Key: session:{token}
Type: Hash
TTL: 7200秒 (2小时)
Fields:
  - userId: 用户ID
  - username: 用户名
  - roles: 角色列表 (JSON)
  - expireAt: 过期时间戳
```

**用户信息缓存 User Cache:**

```
Key: user:{userId}
Type: Hash
TTL: 3600秒 (1小时)
Fields:
  - id: 用户ID
  - username: 用户名
  - email: 邮箱
  - avatar: 头像
  - status: 状态
```

---

## 6. 算法设计 Algorithm Design

### 6.1 密码加密算法 Password Encryption

**算法 Algorithm:** bcrypt

**参数 Parameters:**

| 参数 Parameter | 值 Value |
|------------|---------|
| 工作因子 Work Factor | 10 |
| 盐值 Salt | 自动生成 |

**实现:**

```java
public String encryptPassword(String rawPassword) {
    return BCrypt.hashpw(rawPassword, BCrypt.gensalt(10));
}

public boolean verifyPassword(String rawPassword, String encodedPassword) {
    return BCrypt.checkpw(rawPassword, encodedPassword);
}
```

### 6.2 令牌生成算法 Token Generation

**算法 Algorithm:** JWT (JSON Web Token)

**Header:**

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**Payload:**

```json
{
  "userId": "1001",
  "username": "user@example.com",
  "roles": ["USER"],
  "iat": 1234567890,
  "exp": 1234573890
}
```

**实现:**

```java
public String generateToken(User user) {
    Date now = new Date();
    Date expiry = new Date(now.getTime() + TOKEN_VALIDITY * 1000);

    return Jwts.builder()
        .setSubject(String.valueOf(user.getId()))
        .claim("username", user.getUsername())
        .claim("roles", user.getRoles())
        .setIssuedAt(now)
        .setExpiration(expiry)
        .signWith(SignatureAlgorithm.HS256, secretKey)
        .compact();
}
```

### 6.3 订单号生成算法 Order Number Generation

**算法:** 雪花算法 (Snowflake) 改进版

**格式 Format:** `{timestamp}{userId}{random}`

**实现:**

```java
public String generateOrderNo(Long userId) {
    // 时间戳: 13位 (毫秒)
    String timestamp = String.valueOf(System.currentTimeMillis());

    // 用户ID: 补齐到6位
    String userPart = String.format("%06d", userId % 1000000);

    // 随机数: 4位
    String random = String.format("%04d", random.nextInt(10000));

    return timestamp + userPart + random;
}
```

---

## 7. 异常处理设计 Exception Handling

### 7.1 异常层次结构 Exception Hierarchy

```
Exception
  │
  ├── RuntimeException
  │     │
  │     ├── BusinessException (业务异常)
  │     │     ├── ValidationException (验证异常)
  │     │     ├── AuthenticationException (认证异常)
  │     │     ├── AuthorizationException (授权异常)
  │     │     └── ResourceNotFoundException (资源未找到)
  │     │
  │     └── SystemException (系统异常)
  │           ├── DatabaseException (数据库异常)
  │           ├── NetworkException (网络异常)
  │           └── ExternalServiceException (外部服务异常)
  │
  └── Exception
        └── ...
```

### 7.2 异常处理流程 Exception Handling Flow

```
异常抛出
  │
  ▼
全局异常拦截器 @ControllerAdvice
  │
  ├─ 记录日志 Log Exception
  │
  ├─ 判断异常类型 Determine Type
  │  ├─ BusinessException → 业务错误码
  │  ├─ AuthenticationException → 401
  │  ├─ AuthorizationException → 403
  │  └─ SystemException → 500
  │
  └─ 返回统一错误响应 Return Error Response
```

### 7.3 错误码定义 Error Code Definition

| 错误码 Error Code | HTTP状态 Status | 错误类型 Type | 消息 Message |
|----------------|---------------|-------------|------------|
| 200 | 200 | SUCCESS | 操作成功 |
| 400 | 400 | BAD_REQUEST | 请求参数错误 |
| 401 | 401 | UNAUTHORIZED | 未认证 |
| 403 | 403 | FORBIDDEN | 无权限 |
| 404 | 404 | NOT_FOUND | 资源不存在 |
| 10001 | 400 | VALIDATION_ERROR | 数据验证失败 |
| 10002 | 400 | USER_EXISTS | 用户已存在 |
| 10003 | 400 | USER_NOT_FOUND | 用户不存在 |
| 10004 | 401 | INVALID_CREDENTIALS | 用户名或密码错误 |
| 20001 | 400 | ORDER_NOT_FOUND | 订单不存在 |
| 20002 | 400 | INSUFFICIENT_STOCK | 库存不足 |
| 50001 | 500 | SYSTEM_ERROR | 系统错误 |

---

## 附录 Appendix

### 附录A：代码规范 Code Standards

| 规范项 Standard | 规范内容 Specification |
|--------------|---------------------|
| 命名规范 Naming | 驼峰命名法，类名首字母大写 |
| 注释规范 Comment | 公共API必须添加Javadoc注释 |
| 异常处理 Exception | 业务异常使用BusinessException |
| 日志规范 Logging | 使用SLF4J，正确使用日志级别 |

### 附录B：单元测试规范 Unit Test Standards

| 测试类型 Test Type | 覆盖要求 Coverage |
|-----------------|-----------------|
| Service层 | ≥ 80% |
| Controller层 | ≥ 60% |
| 关键业务逻辑 | 100% |

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 设计师 Designer | | | |
| 开发负责人 Dev Lead | | | |
| 代码审查人 Reviewer | | | |

---

**文档结束 End of Document**
