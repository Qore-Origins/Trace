# 测试用例模板 Test Case Template

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | YYYY-MM-DD |
| 最后修改 Last Modified | YYYY-MM-DD |
| 测试人员 Tester | |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 修改内容 Description |
|-------------|---------|---------------|-------------------|
| v1.0.0 | YYYY-MM-DD | [Name] | 初始版本 Initial Version |

---

## 目录 Table of Contents

1. [测试用例概述 Test Case Overview](#1-测试用例概述-test-case-overview)
2. [用户模块测试用例 User Module Test Cases](#2-用户模块测试用例-user-module-test-cases)
3. [订单模块测试用例 Order Module Test Cases](#3-订单模块测试用例-order-module-test-cases)
4. [产品模块测试用例 Product Module Test Cases](#4-产品模块测试用例-product-module-test-cases)
5. [性能测试用例 Performance Test Cases](#5-性能测试用例-performance-test-cases)

---

## 1. 测试用例概述 Test Case Overview

### 1.1 用例编号规则 Case Numbering Rule

```
TC-[模块代码]-[序号]

模块代码:
- USER: 用户模块
- ORDER: 订单模块
- PRODUCT: 产品模块
- PAYMENT: 支付模块
- PERF: 性能测试
```

### 1.2 优先级定义 Priority Definition

| 优先级 Priority | 定义 Definition | 说明 Description |
|--------------|-------------|---------------|
| P0 | 核心业务 | 不通过则无法上线 |
| P1 | 重要功能 | 影响用户体验 |
| P2 | 辅助功能 | 可延期修复 |

---

## 2. 用户模块测试用例 User Module Test Cases

### TC-USER-001: 用户正常注册

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-USER-001 |
| **用例名称 Case Name** | 用户正常注册 |
| **优先级 Priority** | P0 |
| **前置条件 Precondition** | 注册页面可访问 |
| **测试步骤 Test Steps** | 1. 输入用户名: newuser<br>2. 输入邮箱: newuser@example.com<br>3. 输入密码: Password123<br>4. 输入确认密码: Password123<br>5. 点击"注册"按钮 |
| **预期结果 Expected Result** | 注册成功，提示注册成功，跳转登录页面 |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

### TC-USER-002: 用户名重复注册

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-USER-002 |
| **用例名称 Case Name** | 用户名重复注册 |
| **优先级 Priority** | P0 |
| **前置条件 Precondition** | 已存在用户 testuser |
| **测试步骤 Test Steps** | 1. 输入用户名: testuser<br>2. 输入邮箱: test@example.com<br>3. 输入密码: Password123<br>4. 点击"注册"按钮 |
| **预期结果 Expected Result** | 提示"用户名已存在" |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

### TC-USER-003: 用户正常登录

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-USER-003 |
| **用例名称 Case Name** | 用户正常登录 |
| **优先级 Priority** | P0 |
| **前置条件 Precondition** | 用户已注册 |
| **测试步骤 Test Steps** | 1. 输入用户名/邮箱: testuser<br>2. 输入密码: Password123<br>3. 点击"登录"按钮 |
| **预期结果 Expected Result** | 登录成功，跳转首页，显示用户信息 |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

### TC-USER-004: 用户密码错误登录

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-USER-004 |
| **用例名称 Case Name** | 用户密码错误登录 |
| **优先级 Priority** | P0 |
| **前置条件 Precondition** | 用户已注册 |
| **测试步骤 Test Steps** | 1. 输入用户名: testuser<br>2. 输入错误密码: WrongPassword<br>3. 点击"登录"按钮 |
| **预期结果 Expected Result** | 提示"用户名或密码错误"，登录失败 |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

### TC-USER-005: 获取用户信息

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-USER-005 |
| **用例名称 Case Name** | 获取用户信息 |
| **优先级 Priority** | P1 |
| **前置条件 Precondition** | 用户已登录 |
| **测试步骤 Test Steps** | 1. 点击"个人中心"<br>2. 查看个人信息 |
| **预期结果 Expected Result** | 正确显示用户信息（用户名、邮箱等） |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

---

## 3. 订单模块测试用例 Order Module Test Cases

### TC-ORDER-001: 创建订单-正常流程

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-ORDER-001 |
| **用例名称 Case Name** | 创建订单-正常流程 |
| **优先级 Priority** | P0 |
| **前置条件 Precondition** | 用户已登录，购物车有商品 |
| **测试步骤 Test Steps** | 1. 进入购物车<br>2. 点击"结算"<br>3. 填写收货信息<br>4. 确认订单<br>5. 提交订单 |
| **预期结果 Expected Result** | 订单创建成功，跳转支付页面，订单状态为"待支付" |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

### TC-ORDER-002: 创建订单-库存不足

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-ORDER-002 |
| **用例名称 Case Name** | 创建订单-库存不足 |
| **优先级 Priority** | P0 |
| **前置条件 Precondition** | 用户已登录，选择库存不足商品 |
| **测试步骤 Test Steps** | 1. 选择商品加入购物车<br>2. 点击"结算"<br>3. 提交订单 |
| **预期结果 Expected Result** | 提示"库存不足"，订单创建失败 |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

### TC-ORDER-003: 订单支付-成功

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-ORDER-003 |
| **用例名称 Case Name** | 订单支付-成功 |
| **优先级 Priority** | P0 |
| **前置条件 Precondition** | 存在待支付订单 |
| **测试步骤 Test Steps** | 1. 进入订单支付页面<br>2. 选择支付方式<br>3. 点击"支付"<br>4. 完成支付 |
| **预期结果 Expected Result** | 支付成功，订单状态变为"已支付" |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

### TC-ORDER-004: 订单列表-分页查询

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-ORDER-004 |
| **用例名称 Case Name** | 订单列表-分页查询 |
| **优先级 Priority** | P1 |
| **前置条件 Precondition** | 用户已登录，有多个订单 |
| **测试步骤 Test Steps** | 1. 进入"我的订单"<br>2. 查看第1页订单<br>3. 点击"下一页"<br>4. 查看第2页订单 |
| **预期结果 Expected Result** | 正确显示分页信息，订单列表正确 |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

### TC-ORDER-005: 取消订单

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-ORDER-005 |
| **用例名称 Case Name** | 取消订单 |
| **优先级 Priority** | P1 |
| **前置条件 Precondition** | 存在待支付订单 |
| **测试步骤 Test Steps** | 1. 进入订单详情<br>2. 点击"取消订单"<br>3. 选择取消原因<br>4. 确认取消 |
| **预期结果 Expected Result** | 订单状态变为"已取消" |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

---

## 4. 产品模块测试用例 Product Module Test Cases

### TC-PRODUCT-001: 产品列表-正常显示

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-PRODUCT-001 |
| **用例名称 Case Name** | 产品列表-正常显示 |
| **优先级 Priority** | P1 |
| **前置条件 Precondition** | 系统有产品数据 |
| **测试步骤 Test Steps** | 1. 进入产品列表页面<br>2. 查看显示的产品 |
| **预期结果 Expected Result** | 正确显示产品列表，包含图片、名称、价格 |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

### TC-PRODUCT-002: 产品搜索-关键词搜索

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-PRODUCT-002 |
| **用例名称 Case Name** | 产品搜索-关键词搜索 |
| **优先级 Priority** | P1 |
| **前置条件 Precondition** | 系统有产品数据 |
| **测试步骤 Test Steps** | 1. 在搜索框输入关键词<br>2. 点击"搜索" |
| **预期结果 Expected Result** | 显示包含关键词的产品 |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

### TC-PRODUCT-003: 产品详情-查看详情

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-PRODUCT-003 |
| **用例名称 Case Name** | 产品详情-查看详情 |
| **优先级 Priority** | P1 |
| **前置条件 Precondition** | 产品列表可访问 |
| **测试步骤 Test Steps** | 1. 点击任意产品<br>2. 查看产品详情 |
| **预期结果 Expected Result** | 正确显示产品详情（图片、价格、描述、规格） |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

---

## 5. 性能测试用例 Performance Test Cases

### TC-PERF-001: 首页加载性能

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-PERF-001 |
| **用例名称 Case Name** | 首页加载性能测试 |
| **优先级 Priority** | P0 |
| **测试目标 Test Goal** | 页面加载时间 < 2秒 |
| **测试步骤 Test Steps** | 1. 打开浏览器<br>2. 输入首页URL<br>3. 记录加载时间 |
| **预期结果 Expected Result** | 页面完全加载时间 < 2秒 |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

### TC-PERF-002: 并发登录性能

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-PERF-002 |
| **用例名称 Case Name** | 并发登录性能测试 |
| **优先级 Priority** | P0 |
| **测试目标 Test Goal** | 支持1000并发用户登录 |
| **测试步骤 Test Steps** | 1. 启动1000并发用户<br>2. 同时执行登录操作<br>3. 记录成功率和响应时间 |
| **预期结果 Expected Result** | 成功率 > 99%，平均响应时间 < 500ms |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

### TC-PERF-003: 接口响应时间

| 字段 Field | 内容 Content |
|----------|-----------|
| **用例ID Case ID** | TC-PERF-003 |
| **用例名称 Case Name** | API接口响应时间测试 |
| **优先级 Priority** | P0 |
| **测试目标 Test Goal** | API响应时间 < 200ms (P95) |
| **测试步骤 Test Steps** | 1. 调用产品列表接口<br>2. 记录响应时间<br>3. 重复1000次 |
| **预期结果 Expected Result** | P95响应时间 < 200ms |
| **实际结果 Actual Result** | |
| **状态 Status** | □ 通过 □ 失败 □ 阻塞 □ 跳过 |

---

## 附录 Appendix

### 附录A: 测试数据 Test Data

| 数据类型 Data Type | 数据内容 Data Content |
|-----------------|---------------------|
| 测试用户 | testuser1, testuser2, testuser3 |
| 测试密码 | Test@12345 |
| 测试邮箱 | test@example.com |
| 测试手机号 | 13800138000 |

### 附录B: 测试环境 Test Environment

| 环境项 Environment Item | 值 Value |
|---------------------|---------|
| 测试URL | https://test.example.com |
| 数据库 | test_db |
| 浏览器 | Chrome 120 |

---

**文档结束 End of Document**
