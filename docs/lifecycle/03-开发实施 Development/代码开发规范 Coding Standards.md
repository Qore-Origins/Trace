# 代码开发规范 Coding Standards

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | YYYY-MM-DD |
| 技术负责人 Tech Lead | |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | YYYY-MM-DD | [Name] | | 初始版本 Initial Version |

---

## 目录 Table of Contents

1. [规范概述 Standards Overview](#1-规范概述-standards-overview)
2. [通用编码规范 General Coding Standards](#2-通用编码规范-general-coding-standards)
3. [命名规范 Naming Conventions](#3-命名规范-naming-conventions)
4. [注释规范 Comment Standards](#4-注释规范-comment-standards)
5. [代码格式化 Code Formatting](#5-代码格式化-code-formatting)
6. [错误与异常处理 Error & Exception Handling](#6-错误与异常处理-error--exception-handling)
7. [安全编码规范 Security Coding](#7-安全编码规范-security-coding)
8. [测试规范 Testing Standards](#8-测试规范-testing-standards)

---

## 1. 规范概述 Standards Overview

### 1.1 规范目的 Purpose

本文档定义项目中使用的编码规范，确保代码的一致性、可读性和可维护性。

### 1.2 适用范围 Scope

| 语言/平台 Language/Platform | 适用 Applicable |
|--------------------------|----------------|
| Java | ✅ 是 |
| JavaScript/TypeScript | ✅ 是 |
| SQL | ✅ 是 |
| HTML/CSS | ✅ 是 |

---

## 2. 通用编码规范 General Coding Standards

### 2.1 基本原则 Basic Principles

| 原则 Principle | 说明 Description |
|--------------|---------------|
| KISS Keep It Simple | 保持简单，避免过度设计 |
| DRY Don't Repeat Yourself | 避免重复代码 |
| YAGNI You Aren't Gonna Need It | 只实现当前需要的功能 |
| SOLID | 遵循SOLID原则 |

### 2.2 代码质量标准 Code Quality Standards

| 指标 Metric | 标准 Standard |
|----------|-------------|
| 函数长度 Function Length | ≤ 50行 |
| 文件长度 File Length | ≤ 500行 |
| 圈复杂度 Cyclomatic Complexity | ≤ 10 |
| 代码重复率 Duplication | < 5% |
| 测试覆盖率 Test Coverage | ≥ 70% |

---

## 3. 命名规范 Naming Conventions

### 3.1 通用命名规则 General Naming Rules

| 规则 Rule | 说明 Description | 示例 Example |
|---------|---------------|-------------|
| 有意义 Meaningful | 名称应描述用途 | `getUserInfo()` ✅ / `getData()` ❌ |
| 避免缩写 Avoid Abbreviations | 除通用缩写外 | `userId` ✅ / `uid` ❌ |
| 避免中文 No Chinese | 使用英文 | `userName` ✅ / `yongHuMing` ❌ |

### 3.2 Java命名规范 Java Naming

| 类型 Type | 规范 Convention | 示例 Example |
|----------|---------------|-------------|
| 类名 Class | PascalCase | `UserService`, `OrderController` |
| 接口 Interface | PascalCase, 可选I前缀 | `UserService`, `IUserService` |
| 方法 Method | camelCase | `getUserById()`, `calculateTotal()` |
| 变量 Variable | camelCase | `userName`, `orderCount` |
| 常量 Constant | UPPER_SNAKE_CASE | `MAX_COUNT`, `DEFAULT_PAGE_SIZE` |
| 包名 Package | 小写点分隔 | `com.example.project.service` |

### 3.3 JavaScript/TypeScript命名规范 JS/TS Naming

| 类型 Type | 规范 Convention | 示例 Example |
|----------|---------------|-------------|
| 类/组件 Class/Component | PascalCase | `UserService`, `UserProfile` |
| 函数/方法 Function | camelCase | `getUserInfo()`, `handleSubmit()` |
| 常量 Const | UPPER_SNAKE_CASE | `API_BASE_URL`, `MAX_RETRY` |
| 变量/属性 Variable/Property | camelCase | `userName`, `isLoading` |
| 接口 Interface | PascalCase, I前缀可选 | `IUser`, `UserService` |
| 类型 Type | PascalCase | `UserType`, `OrderStatus` |
| 布尔值 Boolean | is/has/should前缀 | `isValid`, `hasPermission` |

### 3.4 数据库命名规范 Database Naming

| 类型 Type | 规范 Convention | 示例 Example |
|----------|---------------|-------------|
| 表名 Table | 小写下划线, t_前缀 | `t_user`, `t_order_item` |
| 字段名 Column | 小写下划线 | `user_id`, `created_at` |
| 索引 Index | idx_表名_字段名 | `idx_t_user_email` |
| 唯一索引 Unique | uk_表名_字段名 | `uk_t_user_username` |
| 主键 Primary | pk_表名 | `pk_t_user` |
| 外键 Foreign | fk_表名_引用表 | `fk_t_order_t_user` |

### 3.5 API命名规范 API Naming

| 类型 Type | 规范 Convention | 示例 Example |
|----------|---------------|-------------|
| RESTful路径 Path | 小写短横线 | `/api/v1/user-profiles` |
| Query参数 | camelCase | `?pageNo=1&pageSize=20` |
| Header | 短横线 | `X-Request-ID`, `Content-Type` |

---

## 4. 注释规范 Comment Standards

### 4.1 注释原则 Comment Principles

| 原则 Principle | 说明 Description |
|--------------|---------------|
| 为什么 Why | 注释解释"为什么"而非"是什么" |
| 及时 Timely | 代码修改时同步更新注释 |
| 准确 Accurate | 注释必须与代码一致 |
| 不过度 No Over-comment | 代码自解释时无需注释 |

### 4.2 Java注释规范 Java Comments

**类注释 Class Comment:**

```java
/**
 * 用户服务实现类
 *
 * <p>提供用户相关的业务逻辑处理，包括用户注册、登录、信息管理等功能。</p>
 *
 * @author 张三
 * @version 1.0.0
 * @since 2024-01-01
 */
public class UserServiceImpl implements UserService {
    // ...
}
```

**方法注释 Method Comment:**

```java
/**
 * 根据用户ID获取用户信息
 *
 * @param userId 用户ID，不能为null
 * @return 用户信息，如果不存在返回null
 * @throws IllegalArgumentException 如果userId为null
 * @see User
 */
public User getUserById(Long userId) {
    // ...
}
```

**字段注释 Field Comment:**

```java
/** 默认页面大小 */
private static final int DEFAULT_PAGE_SIZE = 20;

/** 用户数据访问对象 */
private final UserRepository userRepository;
```

### 4.3 JavaScript/TypeScript注释规范 JS/TS Comments

**函数注释 Function Comment (JSDoc):**

```typescript
/**
 * 根据用户ID获取用户信息
 *
 * @param {number} userId - 用户ID
 * @returns {Promise<User>} 用户信息
 * @throws {Error} 当用户不存在时抛出错误
 *
 * @example
 * ```typescript
 * const user = await getUserById(123);
 * ```
 */
async function getUserById(userId: number): Promise<User> {
    // ...
}
```

### 4.4 行内注释 Inline Comments

```java
// ✅ 好的注释：解释为什么
// 使用缓存减少数据库查询
String cachedUser = redis.get("user:" + userId);

// ❌ 不好的注释：重复代码含义
// 将userId赋值给userId变量
String userId = userId;
```

---

## 5. 代码格式化 Code Formatting

### 5.1 缩进与空格 Indentation & Spacing

| 语言 Language | 缩进 Indent | 空格 Spacing |
|-------------|-----------|------------|
| Java | 4空格 | 运算符两边加空格 |
| JavaScript | 2空格 | 运算符两边加空格 |
| SQL | 2空格 | 关键字大写，缩进对齐 |

### 5.2 行长度 Line Length

| 语言 Language | 最大长度 Max Length |
|-------------|-------------------|
| Java | 120字符 |
| JavaScript | 100字符 |
| SQL | 80字符（推荐） |

### 5.3 大括号 Braces

**K&R风格（推荐）:**

```java
// ✅ 推荐
public void method() {
    if (condition) {
        doSomething();
    }
}

// ❌ 不推荐
public void method()
{
    if (condition)
    {
        doSomething();
    }
}
```

### 5.4 配置工具 Configuration Tools

| 语言 Language | 工具 Tool | 配置文件 Config |
|-------------|---------|---------------|
| Java | Checkstyle, Google Java Format | `checkstyle.xml` |
| JavaScript | ESLint, Prettier | `.eslintrc.js`, `.prettierrc` |
| TypeScript | ESLint, Prettier | `.eslintrc.js` |

---

## 6. 错误与异常处理 Error & Exception Handling

### 6.1 Java异常处理 Java Exception Handling

| 规则 Rule | 说明 Description |
|------|---------------|
| 具体异常 Specific | 使用具体异常而非Exception |
| 早期失败 Fail Fast | 尽早检测和抛出异常 |
| 日志记录 Log | 记录异常堆栈信息 |
| 消息有意义 Meaningful Message | 提供清晰的错误消息 |

```java
// ✅ 好的做法
public User getUserById(Long userId) {
    if (userId == null) {
        throw new IllegalArgumentException("用户ID不能为空");
    }
    if (userId <= 0) {
        throw new IllegalArgumentException("用户ID必须为正数");
    }
    try {
        return userRepository.findById(userId)
            .orElseThrow(() -> new BusinessException("用户不存在: " + userId));
    } catch (DataAccessException e) {
        log.error("数据库访问异常, userId={}", userId, e);
        throw new SystemException("系统错误，请稍后重试", e);
    }
}

// ❌ 不好的做法
public User getUserById(Long userId) {
    try {
        return userRepository.findById(userId).get();
    } catch (Exception e) {
        // 吞掉异常
        return null;
    }
}
```

### 6.2 JavaScript错误处理 JS Error Handling

```typescript
// ✅ 好的做法
async function getUserById(userId: number): Promise<User> {
    if (!userId || userId <= 0) {
        throw new Error('Invalid user ID');
    }
    try {
        const user = await apiClient.get(`/users/${userId}`);
        return user.data;
    } catch (error) {
        logger.error('Failed to fetch user', { userId, error });
        throw new Error(`Failed to get user: ${error.message}`);
    }
}
```

---

## 7. 安全编码规范 Security Coding

### 7.1 输入验证 Input Validation

| 规则 Rule | 说明 Description |
|------|---------------|
| 白名单 Whitelist | 使用白名单验证而非黑名单 |
| 长度限制 Length Limit | 限制输入字符串长度 |
| 类型验证 Type Check | 验证数据类型 |
| 编码 Encoding | 正确处理编码 |

```java
// ✅ 输入验证
public void setUsername(String username) {
    if (username == null || username.length() < 3 || username.length() > 50) {
        throw new ValidationException("用户名长度必须在3-50字符之间");
    }
    if (!username.matches("^[a-zA-Z0-9_]+$")) {
        throw new ValidationException("用户名只能包含字母、数字和下划线");
    }
    this.username = username;
}
```

### 7.2 SQL注入防护 SQL Injection Prevention

```java
// ❌ 危险：SQL注入风险
String query = "SELECT * FROM users WHERE username = '" + username + "'";

// ✅ 安全：使用参数化查询
String query = "SELECT * FROM users WHERE username = ?";
User user = jdbcTemplate.queryForObject(query, User.class, username);
```

### 7.3 XSS防护 XSS Prevention

```java
// ✅ 输出编码
String safeOutput = HtmlUtils.htmlEscape(userInput);
```

### 7.4 敏感数据处理 Sensitive Data Handling

| 规则 Rule | 说明 Description |
|------|---------------|
| 不记录日志 No Logging | 敏感信息不写入日志 |
| 加密存储 Encrypted Storage | 密码等加密存储 |
| 传输加密 Encrypted Transmission | 使用HTTPS |
| 脱敏展示 Masking | 日志和展示时脱敏 |

```java
// ✅ 日志脱敏
log.info("用户登录成功, userId={}, username={}", user.getId(), maskEmail(user.getEmail()));

private String maskEmail(String email) {
    if (email == null) return null;
    int at = email.indexOf('@');
    if (at <= 2) return "***" + email.substring(at);
    return email.substring(0, 2) + "***" + email.substring(at);
}
```

---

## 8. 测试规范 Testing Standards

### 8.1 单元测试规范 Unit Test Standards

| 规范 Specification | 要求 Requirement |
|-----------------|--------------|
| 命名 Naming | 应该描述被测试方法和场景 |
| 独立性 Independence | 测试之间相互独立 |
| 可重复 Repeatable | 多次运行结果一致 |
| 快速 Fast | 单元测试应该快速执行 |

**命名格式:** `methodName_scenario_expectedResult`

```java
@Test
@DisplayName("根据ID获取用户 - 用户存在 - 返回用户信息")
void getUserById_whenUserExists_thenReturnUser() {
    // Given
    Long userId = 1L;
    User expectedUser = new User(userId, "test@example.com");
    when(userRepository.findById(userId)).thenReturn(Optional.of(expectedUser));

    // When
    User actualUser = userService.getUserById(userId);

    // Then
    assertThat(actualUser).isNotNull();
    assertThat(actualUser.getId()).isEqualTo(userId);
    assertThat(actualUser.getUsername()).isEqualTo("test@example.com");
    verify(userRepository).findById(userId);
}
```

### 8.2 测试覆盖率要求 Coverage Requirements

| 覆盖类型 Coverage Type | 要求 Requirement |
|-------------------|--------------|
| 行覆盖率 Line Coverage | ≥ 70% |
| 分支覆盖率 Branch Coverage | ≥ 60% |
| 核心业务模块 Core Modules | ≥ 90% |

---

## 附录 Appendix

### 附录A：代码审查清单 Code Review Checklist

**功能性 Functionality:**

- [ ] 代码实现符合需求
- [ ] 边界条件处理正确
- [ ] 错误处理完善

**可读性 Readability:**

- [ ] 命名清晰有意义
- [ ] 代码逻辑清晰
- [ ] 注释恰当

**安全性 Security:**

- [ ] 输入验证充分
- [ ] 无SQL注入风险
- [ ] 敏感数据处理正确

**性能 Performance:**

- [ ] 无明显性能问题
- [ ] 数据库查询优化
- [ ] 资源正确释放

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 技术负责人 Tech Lead | | | |
| 架构师 Architect | | | |

---

**文档结束 End of Document**
