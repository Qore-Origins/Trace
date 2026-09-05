# 数据库设计说明书 Database Design Document

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | YYYY-MM-DD |
| 最后修改 Last Modified | YYYY-MM-DD |
| 数据库设计师 DB Designer | |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | YYYY-MM-DD | [Name] | | 初始版本 Initial Version |

---

## 目录 Table of Contents

1. [概述 Overview](#1-概述-overview)
2. [数据库选型 Database Selection](#2-数据库选型-database-selection)
3. [数据库设计原则 Design Principles](#3-数据库设计原则-design-principles)
4. [逻辑数据库设计 Logical Design](#4-逻辑数据库设计-logical-design)
5. [物理数据库设计 Physical Design](#5-物理数据库设计-physical-design)
6. [索引设计 Index Design](#6-索引设计-index-design)
7. [分区设计 Partition Design](#7-分区设计-partition-design)
8. [数据字典 Data Dictionary](#8-数据字典-data-dictionary)

---

## 1. 概述 Overview

### 1.1 文档目的 Document Purpose

本文档定义系统的数据库设计，包括表结构、索引、约束、关系等，为数据库开发和维护提供依据。

### 1.2 数据库概述 Database Overview

| 属性 Attribute | 内容 Content |
|-------------|-----------|
| 数据库名称 Database Name | |
| 数据库类型 Database Type | □ MySQL □ PostgreSQL □ Oracle □ 其他 |
| 字符集 Character Set | utf8mb4 |
| 排序规则 Collation | utf8mb4_unicode_ci |

---

## 2. 数据库选型 Database Selection

### 2.1 关系型数据库 Relational Database

| 选型 Selection | 版本 Version | 用途 Usage |
|--------------|-------------|----------|
| MySQL / PostgreSQL | 8.0+ / 14+ | 主数据库，存储核心业务数据 |

### 2.2 其他数据存储 Other Storage

| 存储类型 Storage Type | 技术选型 Technology | 用途 Usage |
|-------------------|-------------------|----------|
| 缓存 Cache | Redis | 热点数据缓存、会话存储 |
| 文档存储 Document | MongoDB | 非结构化数据 |
| 搜索引擎 Search | Elasticsearch | 全文搜索 |
| 文件存储 File | OSS/S3 | 图片、视频等文件 |

---

## 3. 数据库设计原则 Design Principles

### 3.1 命名规范 Naming Conventions

| 对象类型 Object Type | 命名规则 Naming Rule | 示例 Example |
|-------------------|-------------------|------------|
| 数据库 Database | 小写，下划线分隔 | project_db |
| 表 Table | 小写，t_前缀，下划线分隔 | t_user, t_order |
| 字段 Column | 小写，下划线分隔 | user_id, create_time |
| 索引 Index | idx_表名_字段名 | idx_t_user_email |
| 唯一索引 Unique | uk_表名_字段名 | uk_t_user_username |
| 主键索引 Primary | pk_表名 | pk_t_user |
| 外键 Foreign Key | fk_表名_引用表名 | fk_t_order_t_user |

### 3.2 设计原则 Design Principles

| 原则 Principle | 说明 Description |
|--------------|---------------|
| 范式理论 Normalization | 遵循第三范式(3NF)，适当反范式化优化查询 |
| 主键设计 Primary Key | 使用自增BIGINT或UUID |
| 字段类型 Field Type | 选择最小够用的类型 |
| 字段长度 Field Length | 预留适当余量 |
| 默认值 Default | 字段尽量设置默认值 |
| NOT NULL约束 | 业务核心字段设置为NOT NULL |
| 软删除 Soft Delete | 使用deleted字段标记删除 |

---

## 4. 逻辑数据库设计 Logical Design

### 4.1 ER图 Entity-Relationship Diagram

```
┌──────────────────┐
│     User (用户)    │
│  ─────────────── │
│  PK id           │
│     username     │
│     email        │
│     password     │
│     status       │
│     created_at   │
└────────┬─────────┘
         │ 1
         │
         │ N
┌────────▼─────────┐         ┌──────────────────┐
│   Order (订单)    │    N    │  Product (产品)   │
│  ────────────── │─────────│  ────────────── │
│  PK id          │         │  PK id          │
│  FK user_id     │         │     name        │
│     order_no    │         │     price       │
│     total_amount│         │     stock       │
│     status      │         └──────────────────┘
│     created_at  │
└────────┬─────────┘
         │ 1
         │
         │ N
┌────────▼─────────┐
│ OrderItem (订单项)│
│  ─────────────── │
│  PK id          │
│  FK order_id    │
│  FK product_id  │
│     quantity    │
│     price       │
└──────────────────┘
```

### 4.2 数据模型 Data Models

#### 用户相关 User Related

| 表名 Table | 中文名 CN | 说明 Description |
|----------|---------|---------------|
| t_user | 用户表 | 存储用户基本信息 |
| t_user_profile | 用户详情表 | 存储用户扩展信息 |
| t_user_address | 用户地址表 | 存储用户收货地址 |

#### 订单相关 Order Related

| 表名 Table | 中文名 CN | 说明 Description |
|----------|---------|---------------|
| t_order | 订单表 | 存储订单基本信息 |
| t_order_item | 订单项表 | 存储订单明细 |
| t_order_status_log | 订单状态日志 | 记录订单状态变更 |

#### 产品相关 Product Related

| 表名 Table | 中文名 CN | 说明 Description |
|----------|---------|---------------|
| t_product | 产品表 | 存储产品基本信息 |
| t_product_category | 产品分类表 | 产品分类信息 |
| t_product_sku | 产品SKU表 | 产品规格信息 |

#### 系统相关 System Related

| 表名 Table | 中文名 CN | 说明 Description |
|----------|---------|---------------|
| t_config | 系统配置表 | 系统配置参数 |
| t_log | 日志表 | 系统操作日志 |
| t_file | 文件表 | 文件上传记录 |

---

## 5. 物理数据库设计 Physical Design

### 5.1 表结构详细设计 Table Design

#### t_user (用户表)

| 序号 # | 字段名 Field | 数据类型 Type | 长度 Length | 允许空 Null | 默认值 Default | 键 Key | 说明 Description |
|-------|------------|-------------|----------|-----------|-------------|------|---------------|
| 1 | id | BIGINT | - | NO | AUTO_INCREMENT | PK | 主键ID |
| 2 | username | VARCHAR | 50 | NO | - | UK | 用户名 |
| 3 | email | VARCHAR | 100 | NO | - | UK | 邮箱 |
| 4 | password | VARCHAR | 255 | NO | - | - | 加密密码 |
| 5 | phone | VARCHAR | 20 | YES | NULL | - | 手机号 |
| 6 | avatar | VARCHAR | 255 | YES | NULL | - | 头像URL |
| 7 | status | TINYINT | 1 | NO | 1 | IDX | 状态:1正常,0禁用 |
| 8 | deleted | TINYINT | 1 | NO | 0 | IDX | 删除标记:0正常,1删除 |
| 9 | created_at | DATETIME | - | NO | CURRENT_TIMESTAMP | IDX | 创建时间 |
| 10 | updated_at | DATETIME | - | YES | NULL | - | 更新时间 |
| 11 | last_login_at | DATETIME | - | YES | NULL | - | 最后登录时间 |

**建表语句 DDL:**

```sql
CREATE TABLE t_user (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    username VARCHAR(50) NOT NULL COMMENT '用户名',
    email VARCHAR(100) NOT NULL COMMENT '邮箱',
    password VARCHAR(255) NOT NULL COMMENT '加密密码',
    phone VARCHAR(20) DEFAULT NULL COMMENT '手机号',
    avatar VARCHAR(255) DEFAULT NULL COMMENT '头像URL',
    status TINYINT NOT NULL DEFAULT 1 COMMENT '状态:1正常,0禁用',
    deleted TINYINT NOT NULL DEFAULT 0 COMMENT '删除标记:0正常,1删除',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    last_login_at DATETIME DEFAULT NULL COMMENT '最后登录时间',
    PRIMARY KEY (id),
    UNIQUE KEY uk_username (username),
    UNIQUE KEY uk_email (email),
    KEY idx_status (status),
    KEY idx_deleted (deleted),
    KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';
```

#### t_order (订单表)

| 序号 # | 字段名 Field | 数据类型 Type | 长度 Length | 允许空 Null | 默认值 Default | 键 Key | 说明 Description |
|-------|------------|-------------|----------|-----------|-------------|------|---------------|
| 1 | id | BIGINT | - | NO | AUTO_INCREMENT | PK | 主键ID |
| 2 | order_no | VARCHAR | 32 | NO | - | UK | 订单号 |
| 3 | user_id | BIGINT | - | NO | - | FK,IDX | 用户ID |
| 4 | total_amount | DECIMAL | 10,2 | NO | 0.00 | - | 订单总金额 |
| 5 | discount_amount | DECIMAL | 10,2 | NO | 0.00 | - | 优惠金额 |
| 6 | pay_amount | DECIMAL | 10,2 | NO | 0.00 | - | 实付金额 |
| 7 | status | TINYINT | 2 | NO | 1 | IDX | 订单状态 |
| 8 | pay_type | VARCHAR | 20 | YES | NULL | - | 支付方式 |
| 9 | pay_time | DATETIME | - | YES | NULL | - | 支付时间 |
| 10 | deleted | TINYINT | 1 | NO | 0 | IDX | 删除标记 |
| 11 | created_at | DATETIME | - | NO | CURRENT_TIMESTAMP | IDX | 创建时间 |
| 12 | updated_at | DATETIME | - | YES | NULL | - | 更新时间 |

**订单状态枚举 Order Status Enum:**

| 值 Value | 状态 Status | 说明 Description |
|---------|-----------|---------------|
| 1 | PENDING | 待支付 |
| 2 | PAID | 已支付 |
| 3 | SHIPPED | 已发货 |
| 4 | COMPLETED | 已完成 |
| 5 | CANCELLED | 已取消 |
| 6 | REFUNDED | 已退款 |

**建表语句 DDL:**

```sql
CREATE TABLE t_order (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    order_no VARCHAR(32) NOT NULL COMMENT '订单号',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '订单总金额',
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '优惠金额',
    pay_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '实付金额',
    status TINYINT NOT NULL DEFAULT 1 COMMENT '订单状态:1待支付,2已支付,3已发货,4已完成,5已取消',
    pay_type VARCHAR(20) DEFAULT NULL COMMENT '支付方式',
    pay_time DATETIME DEFAULT NULL COMMENT '支付时间',
    deleted TINYINT NOT NULL DEFAULT 0 COMMENT '删除标记',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (id),
    UNIQUE KEY uk_order_no (order_no),
    KEY idx_user_id (user_id),
    KEY idx_status (status),
    KEY idx_created_at (created_at),
    CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES t_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单表';
```

#### t_order_item (订单项表)

| 序号 # | 字段名 Field | 数据类型 Type | 长度 Length | 允许空 Null | 默认值 Default | 键 Key | 说明 Description |
|-------|------------|-------------|----------|-----------|-------------|------|---------------|
| 1 | id | BIGINT | - | NO | AUTO_INCREMENT | PK | 主键ID |
| 2 | order_id | BIGINT | - | NO | - | FK,IDX | 订单ID |
| 3 | product_id | BIGINT | - | NO | - | FK,IDX | 产品ID |
| 4 | product_name | VARCHAR | 200 | NO | - | - | 产品名称(快照) |
| 5 | product_image | VARCHAR | 255 | YES | NULL | - | 产品图片(快照) |
| 6 | sku_id | BIGINT | YES | - | IDX | SKU ID |
| 7 | sku_specs | VARCHAR | 500 | YES | NULL | - | SKU规格(快照) |
| 8 | quantity | INT | - | NO | 1 | - | 购买数量 |
| 9 | price | DECIMAL | 10,2 | NO | 0.00 | - | 单价 |
| 10 | total_amount | DECIMAL | 10,2 | NO | 0.00 | - | 小计金额 |

**建表语句 DDL:**

```sql
CREATE TABLE t_order_item (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    order_id BIGINT UNSIGNED NOT NULL COMMENT '订单ID',
    product_id BIGINT UNSIGNED NOT NULL COMMENT '产品ID',
    product_name VARCHAR(200) NOT NULL COMMENT '产品名称',
    product_image VARCHAR(255) DEFAULT NULL COMMENT '产品图片',
    sku_id BIGINT UNSIGNED DEFAULT NULL COMMENT 'SKU ID',
    sku_specs VARCHAR(500) DEFAULT NULL COMMENT 'SKU规格JSON',
    quantity INT NOT NULL DEFAULT 1 COMMENT '购买数量',
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '单价',
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '小计金额',
    PRIMARY KEY (id),
    KEY idx_order_id (order_id),
    KEY idx_product_id (product_id),
    KEY idx_sku_id (sku_id),
    CONSTRAINT fk_order_item_order FOREIGN KEY (order_id) REFERENCES t_order(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_item_product FOREIGN KEY (product_id) REFERENCES t_product(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单项表';
```

#### t_product (产品表)

| 序号 # | 字段名 Field | 数据类型 Type | 长度 Length | 允许空 Null | 默认值 Default | 键 Key | 说明 Description |
|-------|------------|-------------|----------|-----------|-------------|------|---------------|
| 1 | id | BIGINT | - | NO | AUTO_INCREMENT | PK | 主键ID |
| 2 | category_id | BIGINT | - | NO | - | FK,IDX | 分类ID |
| 3 | name | VARCHAR | 200 | NO | - | IDX | 产品名称 |
| 4 | subtitle | VARCHAR | 200 | YES | NULL | - | 产品副标题 |
| 5 | main_image | VARCHAR | 255 | NO | - | - | 主图 |
| 6 | detail | TEXT | - | YES | NULL | - | 产品详情HTML |
| 7 | price | DECIMAL | 10,2 | NO | 0.00 | - | 销售价格 |
| 8 | original_price | DECIMAL | 10,2 | YES | NULL | - | 原价 |
| 9 | stock | INT | - | NO | 0 | - | 库存数量 |
| 10 | sales | INT | - | NO | 0 | - | 销量 |
| 11 | status | TINYINT | 1 | NO | 1 | IDX | 状态 |
| 12 | sort | INT | - | NO | 0 | - | 排序值 |
| 13 | deleted | TINYINT | 1 | NO | 0 | IDX | 删除标记 |
| 14 | created_at | DATETIME | - | NO | CURRENT_TIMESTAMP | IDX | 创建时间 |
| 15 | updated_at | DATETIME | - | YES | NULL | - | 更新时间 |

**建表语句 DDL:**

```sql
CREATE TABLE t_product (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    category_id BIGINT UNSIGNED NOT NULL COMMENT '分类ID',
    name VARCHAR(200) NOT NULL COMMENT '产品名称',
    subtitle VARCHAR(200) DEFAULT NULL COMMENT '产品副标题',
    main_image VARCHAR(255) NOT NULL COMMENT '主图',
    detail TEXT DEFAULT NULL COMMENT '产品详情HTML',
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '销售价格',
    original_price DECIMAL(10,2) DEFAULT NULL COMMENT '原价',
    stock INT NOT NULL DEFAULT 0 COMMENT '库存数量',
    sales INT NOT NULL DEFAULT 0 COMMENT '销量',
    status TINYINT NOT NULL DEFAULT 1 COMMENT '状态:1上架,0下架',
    sort INT NOT NULL DEFAULT 0 COMMENT '排序值',
    deleted TINYINT NOT NULL DEFAULT 0 COMMENT '删除标记',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (id),
    KEY idx_category_id (category_id),
    KEY idx_name (name),
    KEY idx_status (status),
    KEY idx_created_at (created_at),
    KEY idx_sort (sort)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品表';
```

#### t_config (系统配置表)

| 序号 # | 字段名 Field | 数据类型 Type | 长度 Length | 允许空 Null | 默认值 Default | 键 Key | 说明 Description |
|-------|------------|-------------|----------|-----------|-------------|------|---------------|
| 1 | id | BIGINT | - | NO | AUTO_INCREMENT | PK | 主键ID |
| 2 | config_key | VARCHAR | 100 | NO | - | UK | 配置键 |
| 3 | config_value | TEXT | - | YES | NULL | - | 配置值 |
| 4 | config_type | VARCHAR | 20 | NO | - | - | 类型:string/int/bool/json |
| 5 | group_name | VARCHAR | 50 | NO | - | IDX | 分组名称 |
| 6 | description | VARCHAR | 200 | YES | NULL | - | 描述说明 |
| 7 | created_at | DATETIME | - | NO | CURRENT_TIMESTAMP | - | 创建时间 |
| 8 | updated_at | DATETIME | - | YES | NULL | - | 更新时间 |

**建表语句 DDL:**

```sql
CREATE TABLE t_config (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    config_key VARCHAR(100) NOT NULL COMMENT '配置键',
    config_value TEXT DEFAULT NULL COMMENT '配置值',
    config_type VARCHAR(20) NOT NULL DEFAULT 'string' COMMENT '类型',
    group_name VARCHAR(50) NOT NULL DEFAULT 'default' COMMENT '分组名称',
    description VARCHAR(200) DEFAULT NULL COMMENT '描述说明',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (id),
    UNIQUE KEY uk_config_key (config_key),
    KEY idx_group_name (group_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';
```

#### t_log (操作日志表)

| 序号 # | 字段名 Field | 数据类型 Type | 长度 Length | 允许空 Null | 默认值 Default | 键 Key | 说明 Description |
|-------|------------|-------------|----------|-----------|-------------|------|---------------|
| 1 | id | BIGINT | - | NO | AUTO_INCREMENT | PK | 主键ID |
| 2 | user_id | BIGINT | - | YES | - | IDX | 操作用户ID |
| 3 | username | VARCHAR | 50 | YES | - | - | 操作用户名 |
| 4 | module | VARCHAR | 50 | NO | - | IDX | 模块名称 |
| 5 | action | VARCHAR | 50 | NO | - | - | 操作动作 |
| 6 | method | VARCHAR | 200 | NO | - | - | 请求方法 |
| 7 | params | TEXT | - | YES | NULL | - | 请求参数 |
| 8 | ip | VARCHAR | 50 | YES | - | IDX | 请求IP |
| 9 | location | VARCHAR | 100 | YES | NULL | - | IP地理位置 |
| 10 | user_agent | VARCHAR | 500 | YES | NULL | - | 用户代理 |
| 11 | status | TINYINT | 1 | NO | 1 | IDX | 状态:1成功,0失败 |
| 12 | error_msg | VARCHAR | 500 | YES | NULL | - | 错误信息 |
| 13 | execute_time | INT | - | YES | NULL | - | 执行时长(ms) |
| 14 | created_at | DATETIME | - | NO | CURRENT_TIMESTAMP | IDX | 创建时间 |

**建表语句 DDL:**

```sql
CREATE TABLE t_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    user_id BIGINT UNSIGNED DEFAULT NULL COMMENT '操作用户ID',
    username VARCHAR(50) DEFAULT NULL COMMENT '操作用户名',
    module VARCHAR(50) NOT NULL COMMENT '模块名称',
    action VARCHAR(50) NOT NULL COMMENT '操作动作',
    method VARCHAR(200) NOT NULL COMMENT '请求方法',
    params TEXT DEFAULT NULL COMMENT '请求参数',
    ip VARCHAR(50) DEFAULT NULL COMMENT '请求IP',
    location VARCHAR(100) DEFAULT NULL COMMENT 'IP地理位置',
    user_agent VARCHAR(500) DEFAULT NULL COMMENT '用户代理',
    status TINYINT NOT NULL DEFAULT 1 COMMENT '状态:1成功,0失败',
    error_msg VARCHAR(500) DEFAULT NULL COMMENT '错误信息',
    execute_time INT DEFAULT NULL COMMENT '执行时长(毫秒)',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (id),
    KEY idx_user_id (user_id),
    KEY idx_module (module),
    KEY idx_ip (ip),
    KEY idx_status (status),
    KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作日志表';
```

---

## 6. 索引设计 Index Design

### 6.1 索引策略 Index Strategy

| 索引类型 Index Type | 使用场景 Usage | 说明 Description |
|------------------|--------------|---------------|
| 主键索引 Primary Key | 主键字段 | 自动创建，聚簇索引 |
| 唯一索引 Unique | 唯一性字段 | 保证数据唯一性 |
| 普通索引 Normal | 高频查询字段 | 加速查询 |
| 联合索引 Composite | 多字段组合查询 | 注意最左前缀原则 |
| 全文索引 Fulltext | 文本搜索 | MySQL 5.6+支持 |

### 6.2 索引清单 Index List

#### t_user 索引

| 索引名 Index Name | 索引类型 Type | 字段 Columns | 说明 Description |
|----------------|-------------|------------|---------------|
| PRIMARY | PRIMARY KEY | id | 主键索引 |
| uk_username | UNIQUE | username | 用户名唯一索引 |
| uk_email | UNIQUE | email | 邮箱唯一索引 |
| idx_status | INDEX | status | 状态索引 |
| idx_deleted_status | INDEX | deleted, status | 联合索引(软删除查询) |

#### t_order 索引

| 索引名 Index Name | 索引类型 Type | 字段 Columns | 说明 Description |
|----------------|-------------|------------|---------------|
| PRIMARY | PRIMARY KEY | id | 主键索引 |
| uk_order_no | UNIQUE | order_no | 订单号唯一索引 |
| idx_user_id | INDEX | user_id | 用户ID索引 |
| idx_user_status | INDEX | user_id, status | 用户订单查询 |
| idx_status_created | INDEX | status, created_at | 订单列表查询 |

### 6.3 索引优化建议 Index Optimization

| 优化项 Optimization | 建议 Recommendation |
|------------------|-------------------|
| 避免冗余索引 | 定期检查并删除重复索引 |
| 联合索引顺序 | 按查询频率和区分度排序 |
| 索引选择性 | 选择性高的字段适合建索引 |
| 索引数量 | 单表索引不超过5个 |

---

## 7. 分区设计 Partition Design

### 7.1 分区策略 Partition Strategy

| 表名 Table | 分区类型 Partition Type | 分区字段 Partition Key | 说明 Description |
|----------|----------------------|---------------------|---------------|
| t_log | RANGE | created_at | 按月分区 |
| t_order | RANGE | created_at | 按月分区 |

### 7.2 分区定义 Partition Definition

**t_log 分区定义:**

```sql
ALTER TABLE t_log PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p202401 VALUES LESS THAN (TO_DAYS('2024-02-01')),
    PARTITION p202402 VALUES LESS THAN (TO_DAYS('2024-03-01')),
    PARTITION p202403 VALUES LESS THAN (TO_DAYS('2024-04-01')),
    PARTITION p202404 VALUES LESS THAN (TO_DAYS('2024-05-01')),
    PARTITION p202405 VALUES LESS THAN (TO_DAYS('2024-06-01')),
    PARTITION p202406 VALUES LESS THAN (TO_DAYS('2024-07-01')),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);
```

---

## 8. 数据字典 Data Dictionary

### 8.1 枚举值定义 Enum Definitions

#### 用户状态 User Status

| 值 Value | 常量 Constant | 名称 Name | 说明 Description |
|---------|-------------|---------|---------------|
| 0 | STATUS_INACTIVE | 禁用 | 账号已被禁用 |
| 1 | STATUS_ACTIVE | 正常 | 账号正常 |

#### 订单状态 Order Status

| 值 Value | 常量 Constant | 名称 Name | 说明 Description |
|---------|-------------|---------|---------------|
| 1 | STATUS_PENDING | 待支付 | 订单待支付 |
| 2 | STATUS_PAID | 已支付 | 订单已支付 |
| 3 | STATUS_SHIPPED | 已发货 | 订单已发货 |
| 4 | STATUS_COMPLETED | 已完成 | 订单已完成 |
| 5 | STATUS_CANCELLED | 已取消 | 订单已取消 |
| 6 | STATUS_REFUNDED | 已退款 | 订单已退款 |

#### 支付方式 Pay Type

| 值 Value | 名称 Name | 说明 Description |
|---------|---------|---------------|
| ALIPAY | 支付宝 | 支付宝支付 |
| WECHAT | 微信 | 微信支付 |
| BALANCE | 余额 | 账户余额 |
| CREDIT_CARD | 银行卡 | 银行卡支付 |

### 8.2 字段约束说明 Field Constraints

| 约束类型 Constraint | 说明 Description |
|-----------------|---------------|
| NOT NULL | 字段不允许为空 |
| DEFAULT | 字段默认值 |
| UNIQUE | 字段值唯一 |
| AUTO_INCREMENT | 字段自动递增 |
| UNSIGNED | 无符号整数 |
| ZEROFILL | 宽度不足时填充0 |

---

## 附录 Appendix

### 附录A：数据库初始化脚本 Initialization Script

```sql
-- 创建数据库
CREATE DATABASE IF NOT EXISTS project_db
    DEFAULT CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE project_db;

-- 执行建表语句
-- ...
```

### 附录B：测试数据 Test Data

```sql
-- 插入测试用户
INSERT INTO t_user (username, email, password, status) VALUES
('test01', 'test01@example.com', '$2a$10$xxxx', 1),
('test02', 'test02@example.com', '$2a$10$yyyy', 1);

-- 插入测试配置
INSERT INTO t_config (config_key, config_value, config_type, group_name, description) VALUES
('site.name', 'My Project', 'string', 'site', '网站名称'),
('site.logo', '/logo.png', 'string', 'site', '网站Logo'),
('user.default_avatar', '/default-avatar.png', 'string', 'user', '默认头像');
```

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 数据库设计师 DB Designer | | | |
| 数据库管理员 DBA | | | |
| 技术负责人 Tech Lead | | | |

---

**文档结束 End of Document**
