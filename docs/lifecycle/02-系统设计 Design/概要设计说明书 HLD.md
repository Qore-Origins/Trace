# 概要设计说明书 HLD (High-Level Design)

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | 2026-09-05 |
| 最后修改 Last Modified | 2026-09-05 |
| 架构师 Architect | HeYS-Snowe |
| 对应PRD版本 PRD Version | v1.0.0 |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | 2026-09-05 | HeYS-Snowe | HeYS-Snowe | 初始版本 Initial Version |

---

## 目录 Table of Contents

1. [概述 Overview](#1-概述-overview)
2. [系统架构 System Architecture](#2-系统架构-system-architecture)
3. [技术架构 Technical Architecture](#3-技术架构-technical-architecture)
4. [模块设计 Module Design](#4-模块设计-module-design)
5. [接口设计 Interface Design](#5-接口设计-interface-design)
6. [数据设计 Data Design](#6-数据设计-data-design)
7. [安全设计 Security Design](#7-安全设计-security-design)
8. [部署架构 Deployment Architecture](#8-部署架构-deployment-architecture)

---

## 1. 概述 Overview

### 1.1 文档目的 Document Purpose

本文档定义「溯源 Trace」的概要设计：系统架构、技术架构、模块划分与交互、接口边界、数据与安全策略，为《详细设计说明书 LLD》与开发实现提供指导。**技术栈/存储契约/IPC 契约已在前置文档定案，本文档只做承接与细化，不重新决策**（引用：技术选型报告、架构设计文档、数据库设计说明书、接口设计文档）。

### 1.2 系统概述 System Overview

| 属性 Attribute | 内容 Content |
|-------------|-----------|
| 系统名称 System Name | 溯源 Trace（· by Qore） |
| 系统类型 System Type | □ Web应用 □ 移动App ☑ 桌面应用（Windows 10/11 x64，本阶段唯一承诺平台） |
| 系统定位 System Positioning | 单用户本地优先的个人计划管理工具：计划=文件夹（明文件）、内容=5 类计划单片组件、支持溯源查询；无服务器/无网络功能/无账号 |

### 1.3 设计目标 Design Goals

| 目标类型 Goal Type | 目标描述 Description |
|-----------------|-------------------|
| 性能目标 Performance | 冷启动 < 3s；常规操作 < 1s；检索 ≤ 1s（≤1000 计划/≤10000 任务）；保存延迟 ≤ 500ms（防抖后） |
| 可用性目标 Availability | 单机 100%（无网络依赖）；崩溃不损数据（原子写）；重启即恢复 |
| 可扩展性 Scalability | 数据规模上限内无需改架构；macOS/Linux 同代码可打包（不承诺）；格式版本化支持长期演进 |
| 安全性 Security | 数据不出设备（无网络功能硬约束）；IPC 白名单最小暴露；日志脱敏 |
| 可维护性 Maintainability | 全栈 TypeScript 单语言；存储/RPC 契约文档化；无边框约束（antd 默认，随升级） |

---

## 2. 系统架构 System Architecture

### 2.1 总体架构 Overall Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         用户层 User Layer                            │
│                    （唯一用户：HeYS-Snowe 本机使用）                    │
└─────────────────────────────────────────────────────────────────────┘
                              ▲ UI 交互（无网络层）
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      渲染进程 Renderer Process                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                 │
│  │ 计划树视图    │ │ 组件渲染/编辑 │ │ 溯源查询视图   │                 │
│  ├──────────────┴─┴──────────────┴─┴──────────────┤                 │
│  │ UI 状态层（Zustand store）+ 视图组件（React 19）  │                 │
│  └──────────────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
                              ▲ IPC（contextBridge 白名单）
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        主进程 Main Process                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │ StorageService│ │SearchService │ │ConfigService │ │WatchService │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ │
│  ┌──────────────────────────────────────────────────────┐            │
│  │ IPC 注册/校验层（channel → handler；参数/路径快检）     │            │
│  └──────────────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────────┘
                              ▲ fs（原子写）/ chokidar 监视
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        数据层 Data Layer（本地）                      │
│  ┌──────────────────────┐ ┌──────────────────────┐                   │
│  │ 计划库根目录（明文件） │ │ %APPDATA%\trace\      │                   │
│  │ 文件夹树 + plan.json │ │ config.json + index   │                   │
│  │ .trace/plan-library │ │ .json + logs\          │                   │
│  └──────────────────────┘ └──────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 架构风格 Architecture Style

| 架构维度 Architecture Dimension | 选择 Choice | 理由 Rationale |
|------------------------------|-----------|---------------|
| 部署架构 Deployment | ☑ 单体（单机本地） □ 分层（逻辑分层） □ 微服务 | 单用户本地应用；"服务"为进程内模块（分层精神体现在进程内） |
| 数据架构 Data | ☑ 集中式（本机单一数据源） □ 分布式 | 单一计划库根目录 |
| 通信风格 Communication | ☑ 同步（请求-响应 IPC）+ 异步（事件推送/索引增量/防抖保存） | 请求主同步；索引/监视为异步事件（混合风格，取其轻） |

### 2.3 架构原则 Architecture Principles

1. **分层原则**: UI（渲染器）/ 服务（主进程）/ 数据（文件系统）三层分离
2. **单一职责**: 存储/检索/配置/监视 各司其职
3. **高内聚低耦合**: 服务间仅经共享类型 + 事件连接；渲染器只经 IPC 白名单服务
4. **本地优先（非水平扩展）**: 规模内单进程单机；扩展=同代码换壳打包（macOS/Linux），非服务扩容

---

## 3. 技术架构 Technical Architecture

### 3.1 技术栈总览 Technology Stack Overview

| 层级 Layer | 技术选型 Technology | 版本 Version | 说明 Notes |
|----------|-------------------|-------------|----------|
| 桌面壳 Desktop Shell | Electron | 44.x | Node 24.18.1 / Chromium 152 |
| 前端框架 Frontend | React | 19.x | 渲染器 UI |
| 语言 Language | TypeScript | 5.x | 全栈（渲染器+主进程） |
| UI 组件库 | Ant Design | 5.x | 默认主题（UI 规范 §2） |
| 构建脚手架 | electron-vite + Vite | 当前稳定（脚手架锁定） | 主/渲染一体开发、HMR |
| 状态管理 | Zustand | 4.x | 渲染器 UI 状态 |
| 拖拽 | dnd-kit / antd Tree 内建拖拽 | LLD 锁定 | 树排序/移动 |
| 后端框架 Backend | 无（主进程 Node） | - | 服务=进程内模块 |
| 数据库 Database | 无（明文件 JSON） | 契约 v1 | 计划库根目录 |
| 缓存 Cache | 进程内缓存 | - | 树/内容/索引对象 |
| 消息队列 Message Queue | 无（进程内事件） | - | 异步=事件+定时 |
| 搜索引擎 Search Engine | 内存扫包含（SPIKE-1 定案；FlexSearch 已否决） | - | 内存索引 + index.json 缓存 |
| 文件监视 | chokidar | 4.x | 外部变更检测 |
| 打包 Packaging | electron-builder（NSIS） | 当前稳定 | Windows 安装包 |
| 容器化 Container | 无 | - | 无服务端 |

### 3.2 前端技术架构 Frontend Architecture

#### 技术栈 Frontend Stack

| 技术 Technology | 选型 Choice | 用途 Usage |
|--------------|-----------|----------|
| 框架 Framework | React 19 | 视图层 |
| 状态管理 State Management | Zustand | 全局 UI 状态（树/当前计划/检索/保存态） |
| UI组件库 UI Library | antd 5 | 组件 + token 体系 |
| 构建工具 Build Tool | Vite（electron-vite 集成） | 打包/HMR |
| CSS方案 CSS Solution | antd token + 少量样式（less/css 变量），无 UnoCSS/原子化（低噪原则） | 样式 |

#### 前端架构模式 Frontend Pattern

| 模式 Pattern | 描述 Description |
|-----------|----------------|
| 组件化 + 单向数据流（Flux 式） | 视图组件（components/）→ store（Zustand）→ ipc-client（包装层，唯一 IPC 调用点）；无 MVC/MVVM 二开 |

**渲染器目录（LLD 细化）**：`src/renderer/`（views / components / stores / ipc-client / hooks）。

### 3.3 后端技术架构 Backend Architecture

#### 技术栈 Backend Stack（=主进程）

| 技术 Technology | 选型 Choice | 用途 Usage |
|--------------|-----------|----------|
| 开发语言 Language | TypeScript | 与前端同语言 |
| 框架 Framework | Electron 主进程 + 无重框架（YAGNI） | 服务层手工注册 |
| API规范 API Style | ☑ IPC（白名单）□ RESTful □ GraphQL □ RPC | 接口设计文档 §1 |
| 认证协议 Auth Protocol | □ JWT □ OAuth2 ☑ 无（单用户本地） | 无账号体系 |

#### 后端架构模式 Backend Pattern

| 模式 Pattern | 描述 Description |
|-----------|----------------|
| 分层架构 Layered | IPC 入口层 → 服务层（Service） → 数据访问（Repository：fs 原子写/读取） |
| 依赖注入 DI | 无框架 DI；主进程启动时按 context 对象组装（services 互借 ctx） |
| AOP切面 | 等价物：IPC 入口校验中间件（统一参数校验 + 异常转 TraceResult + 日志脱敏记录） |

### 3.4 数据存储架构 Data Storage Architecture

| 存储类型 Storage Type | 技术选型 Technology | 用途场景 Usage |
|-------------------|-------------------|--------------|
| 关系数据库 Relational DB | 不适用 | 数据=计划库明文件（契约 §5） |
| 缓存数据库 Cache | 不适用（进程内缓存） | 树/内容/索引内存态 |
| 文档存储 Document DB | 不适用（≈主存储：plan.json） | - |
| 时序数据库 Time Series DB | 不适用（日志=文件） | - |
| 文件存储 File Storage | 本地计划库根目录（无 OSS） | 全部业务数据 |

---

## 4. 模块设计 Module Design

### 4.1 模块划分 Module Breakdown

```
溯源应用 Trace
├── 渲染进程 Renderer
│   ├── 主界面视图（树 + 内容区 + 状态栏）
│   ├── 计划树组件（导航/重命名/拖拽）
│   ├── 组件渲染器（5 类组件 + 组件内编辑）
│   ├── 溯源查询视图（搜索框/结果/回溯）
│   ├── 首次启动引导
│   └── 状态同步（Zustand + ipc-client）
├── 主进程 Main
│   ├── IPC 层（channel 注册/校验/错误映射）
│   ├── 存储服务（树/计划/组件/任务读写 + 原子写）
│   ├── 检索服务（索引构建/增量/查询/回溯）
│   ├── 配置服务（根目录/窗口状态/版本）
│   ├── 文件监视服务（外部变更）
│   └── 日志服务（脱敏）
├── 共享 Shared
│   ├── ipc-contract（类型/通道名/错误码）
│   ├── 存储契约类型（PlanDocument 等）
│   └── 设计 token 常量
└── 数据 Data
    ├── 计划库根目录（明文件 + .trace）
    └── 应用数据目录（config/index/logs）
```

### 4.2 核心模块设计 Core Modules

#### 模块1：存储服务模块 Storage Module

| 属性 Attribute | 值 Value |
|-------------|---------|
| 模块ID Module ID | M-001 |
| 模块名称 Module Name | StorageService（主进程） |
| 负责人 Owner | HeYS-Snowe |

**功能列表 Functions:**

| 功能ID Function ID | 功能名称 Function Name | 描述 Description |
|------------------|---------------------|---------------|
| F-001 | 计划树枚举 | 懒加载（树 GetChildren）+ 树缓存（路径级失效） |
| F-002 | 计划 CRUD | 创建/重命名/删除（confirm 校验） |
| F-003 | 移动与排序 | move/order（循环校验 code 13） |
| F-004 | 计划读写 | readPlan / savePlan（CAS 防冲突 code 22） |
| F-005 | 组件/任务操作 | append/remove/move component、updateTask（状态机 code 21） |
| F-006 | 原子写引擎 | 临时文件+fsync+rename；失败重试/上报 |

**接口列表 Interfaces:** `storage:*` 通道（接口设计文档 §4，共 10 条）。

**依赖关系 Dependencies:**

| 依赖模块 Dependent Module | 依赖类型 Dependency Type |
|----------------------|----------------------|
| 检索服务（索引增量） | 弱依赖（事件通知，索引失败不影响存储主链路） |
| 配置服务（根目录） | 强依赖（根目录=数据入口） |
| 文件监视服务 | 弱依赖（缓存失效信号源） |

#### 模块2：检索服务模块 Search Module

| 属性 Attribute | 值 Value |
|-------------|---------|
| 模块ID Module ID | M-002 |
| 模块名称 Module Name | SearchService（主进程） |
| 负责人 Owner | HeYS-Snowe |

**功能列表 Functions:**

| 功能ID Function ID | 功能名称 Function Name | 描述 Description |
|------------------|---------------------|---------------|
| F-001 | 索引构建 | 启动全量（异步，进度推送）+ 变更增量（事件触发） |
| F-002 | 关键词查询 | AND 多词；分段（plan/task/note）；≤1s 承诺 |
| F-003 | 回溯定位 | 命中→路径/组件 id 映射返回 |
| F-004 | 索引持久化/重建 | index.json 缓存；损坏自动重建（code 23 化处理） |

**接口列表 Interfaces:** `search:*` 通道（接口设计文档 §5，共 3 条）。

**依赖关系 Dependencies:**

| 依赖模块 Dependent Module | 依赖类型 Dependency Type |
|----------------------|----------------------|
| 存储服务（数据源） | 强依赖（内容读取） |
| 文件监视服务 | 强依赖（外部变更触发重建） |

#### 模块3：渲染器界面模块 Renderer Module

| 属性 Attribute | 值 Value |
|-------------|---------|
| 模块ID Module ID | M-003 |
| 模块名称 Module Name | Renderer UI（渲染进程） |
| 负责人 Owner | HeYS-Snowe |

**功能列表 Functions:**

| 功能ID Function ID | 功能名称 Function Name | 描述 Description |
|------------------|---------------------|---------------|
| F-001 | 计划树视图 | 展开/选中/右键/拖拽（DnD 手势 + 插入线） |
| F-002 | 组件渲染器 | 5 类组件渲染 + 组件内编辑（防抖保存） |
| F-003 | 溯源查询视图 | 搜索输入（300ms 防抖）/结果/回溯高亮 |
| F-004 | 引导与状态栏 | 首启引导、索引/保存状态 |

**接口列表 Interfaces:** 消费 `app.*/storage.*/search.*/config.*`；订阅 `trace:*` 事件。

**依赖关系 Dependencies:**

| 依赖模块 Dependent Module | 依赖类型 Dependency Type |
|----------------------|----------------------|
| IPC 白名单（ipc-client） | 强依赖 |
| UI 规范（antd token） | 强依赖 |

#### 模块4：共享契约模块 Shared Module

| 属性 Attribute | 值 Value |
|-------------|---------|
| 模块ID Module ID | M-004 |
| 模块名称 Module Name | Shared Contracts（双进程共享） |
| 负责人 Owner | HeYS-Snowe |

**功能列表 Functions:** ipc-contract 类型 / 存储契约类型 / 错误码常量 / 设计 token。

### 4.3 模块间交互 Module Interaction

```
┌──────────────┐     IPC      ┌──────────────┐     fs      ┌──────────────┐
│  渲染器 UI    │─────────────▶│  主进程服务层  │─────────────▶│  计划库文件   │
│ M-003        │ TraceResult  │ M-001/M-002  │  原子写       │ (数据层)     │
└──────────────┘              └──────┬───────┘              └──────────────┘
       ▲                              │ 事件(索引/变更/保存)
       │ trace:* 事件推送              ▼
       │                    ┌──────────────────┐
       └────────────────────│ 文件监视 + 索引进度 │
                            └──────────────────┘
   共享契约：M-004（类型/常量，编译期绑定双方）
```

---

## 5. 接口设计 Interface Design

### 5.1 接口分类 Interface Categories

| 接口类型 Interface Type | 数量 Quantity | 说明 Description |
|---------------------|-------------|---------------|
| 外部API External API | 0 | 无（无网络功能、无服务端） |
| 内部API Internal API | 20 | 进程内 IPC 白名单（`app.*` 3 + `storage.*` 10 + `search.*` 3 + `config.*` 2 + `app:reportError` 等泛化 2），详见表 |
| 第三方接口 3rd Party API | 0 | 无 |

### 5.2 内部接口规范 Internal API Specification

| 规范项 Specification Item | 规范内容 Specification |
|----------------------|---------------------|
| 协议 Protocol | Electron IPC（invoke/事件） |
| 数据格式 Data Format | JSON（结构化克隆） |
| 认证方式 Authentication | 无（单用户）；等价=IPC 加固（contextIsolation/sandbox） |
| 请求方法 Methods | invoke(channel, payload) |
| 响应格式 Response Format | `TraceResult<T>`（接口设计文档 §2.2） |

### 5.3 内部接口列表 Internal API List

> 完整契约（参数/错误码/事件）见《接口设计文档 API Design》§3-§6；此处为清单视图。

| API ID | 接口名称 API Name | 通道 Channel | 说明 Description |
|--------|-----------------|-------------|---------------|
| API-001 | 应用信息 | `app:getAppInfo` | 版本/根目录/索引状态 |
| API-002 | 启动引导 | `app:bootstrap` | 根目录检测 |
| API-003 | 设置根目录 | `app:setRootDir` | confirm 校验 |
| API-004 | 错误上报 | `app:reportError` | 脱敏日志 |
| API-005~014 | 存储 10 通道 | `storage:*` | 树/CRUD/移动/读写/组件/任务 |
| API-015~017 | 检索 3 通道 | `search:*` | 查询/状态/重建 |
| API-018~019 | 配置 2 通道 | `config:*` | 读取/写入 |

### 5.4 第三方接口集成 3rd Party Integration

| 服务名称 Service | 接口类型 API Type | 用途 Purpose |
|--------------|----------------|------------|
| 无 | - | 无网络功能（硬约束） |

---

## 6. 数据设计 Data Design

### 6.1 数据模型概览 Data Model Overview

```
┌──────────────┐   1:N   ┌──────────────┐   1:N   ┌──────────────┐
│ 计划库        │─────────│ 计划(文件夹)  │─────────│ 组件(plan.json│
│ (根目录+元数据)│         │ id=相对路径    │         │  components[])│
└──────────────┘         └──────┬───────┘         └──────┬───────┘
       │ 1:N（子计划=子文件夹）     │ 1:N（组件）          │ 1:N/1:1
       └──────────────────────────┘                      ▼
                                              ┌──────────────┐
                                              │ 任务/注释     │
                                              │（payload 内） │
                                              └──────────────┘
```

### 6.2 核心数据实体 Core Data Entities

| 实体名称 Entity Name | 中文名 CN | 主要字段 Key Fields | 说明 Description |
|------------------|---------|------------------|---------------|
| PlanLibrary | 计划库 | format_version, library_id, created_at | `.trace/plan-library.json` |
| Plan | 计划 | path(id), created_at, updated_at, children_order | 文件夹 + plan.json |
| Component | 组件 | id, type(5), payload | plan.json 数组元素 |
| Task | 任务 | id, title, status, planned_at, completed_at, note | task_list/task_detail payload |
| Note | 注释 | content, created_at | note payload |

### 6.3 数据流 Data Flow

**写数据流（统一路径）：**

```
渲染器操作 → ipc-client（防抖合并） → IPC 校验(参数/confirm/CAS)
  → StorageService 变更执行（状态机/重名/循环校验）
  → 原子写（临时文件 → fsync → rename）
  → 返回 TraceResult → UI 刷新 + 事件（plan-changed/save-status）
  → SearchService 增量（异步，≤1s 追上）
```

**读数据流：**

```
UI 请求 → ipc-client → 主进程
  → 内存缓存（树/内容最近使用） → 命中返回
  → Miss → 文件读取 → 写缓存 → 返回
```

---

## 7. 安全设计 Security Design

### 7.1 安全架构 Security Architecture

| 安全层面 Security Layer | 安全措施 Security Measures |
|---------------------|-------------------------|
| 网络安全 Network | 无（无网络功能）；依赖清单定期审计（Electron/Chromium 已知漏洞跟踪） |
| 应用安全 Application | IPC 白名单最小暴露（contextIsolation + sandbox）；路径 resolve 后前缀校验（防穿越）；名称/长度验证；组件渲染=受控纯文本（禁 innerHTML） |
| 数据安全 Data | 数据不出设备；明文件（系统文件系统权限 即访问控制）；原子写防半写；日志脱敏（不含计划正文） |
| 认证授权 Auth | 无账号（不适用）；等价=系统文件权限 + 破坏性操作确认（code 24） |

### 7.2 认证授权设计 Authentication & Authorization

**不适用**（单机单用户、无账号、无远端）。本项目的"授权模型"：

| 模型类型 Model Type | 描述 Description |
|-----------------|----------------|
| 系统层 | 文件系统权限（只读目录 → 应用降级为提示，不写入） |
| 应用层 | 操作权限=用户本人（无多角色）；破坏性操作=显式确认标志（`confirmed`），缺失 → code 24 |

### 7.3 数据安全 Data Security

| 数据类型 Data Type | 加密方式 Encryption |
|-----------------|-------------------|
| 传输数据 Transit | 无传输（本地） |
| 存储密码 Password | 无密码/账号 |
| 敏感信息 Sensitive | 计划内容=本地明文件（文件系统权限保护；不做应用内加密，v2 评估）；日志脱敏 |

---

## 8. 部署架构 Deployment Architecture

### 8.1 部署拓扑 Deployment Topology

```
                      Windows 10/11 用户电脑
                            ▼
┌───────────────────────────────────────────────────────────────┐
│ 溯源 Trace 安装包（electron-builder NSIS）                      │
│  ├── 安装目录：Program Files\Trace\（应用二进制）                │
│  └── 用户数据：%APPDATA%\trace\（config/index/logs）            │
│       计划库：  用户指定根目录（明文件，独立于安装目录）            │
└───────────────────────────────────────────────────────────────┘
（无服务器/无 CDN/无负载均衡；发布渠道 = GitHub Release 附件）
```

### 8.2 环境划分 Environment Segregation

| 环境名称 Environment | 用途 Usage | 配置等级 Config Level |
|------------------|---------|-------------------|
| 开发环境 Development | 本机 `npm run dev`（HMR） | 低配置（调试日志全开） |
| 测试环境 Testing | 本机打包 + 手工/脚本测试 | 中（日志精简） |
| CI 构建环境 | GitHub Actions `windows-latest` 打包 | 与生产一致 |
| 生产环境 Production | Release 安装包（NSIS，未签名，SmartScreen 提示属预期） | 高（release 模式） |

### 8.3 容量规划 Capacity Planning

| 资源 Resource | 规划 Capacity | 说明 Notes |
|------------|-----------|----------|
| 应用服务器 App Server | 无 | 本地应用 |
| 数据库 Database | 无 | 明文件 |
| 本机资源（计划库） | ≤1000 计划 / ≤10000 任务；内存全量对象 <100MB（M5 实测校准） | 单用户规模 |
| 安装包体积 | 约 80-120MB（Electron 实测量级，M5 记录实测） | NSIS |

---

## 附录 Appendix

### 附录A：非功能需求 Non-Functional Requirements

| 需求类别 Category | 指标 Metric | 目标值 Target |
|----------------|-----------|-------------|
| 性能 Performance | 冷启动/操作/检索/保存 | <3s / <1s / ≤1s / ≤500ms |
| 可用性 Availability | 单机可用/数据安全 | 100%（无网络依赖）/ 无半写 |
| 并发 Concurrency | 用户并发 | 单用户（N/A） |
| 容量 Capacity | 计划/任务 | 1000 / 10000（上限设计） |

### 附录B：技术选型对比 Tech Stack Comparison

| 对比项 Comparison Item | 方案A Option A | 方案B Option B | 选择 Selection |
|---------------------|--------------|--------------|-------------|
| 桌面框架 Desktop | Electron 44（4.25 加权） | Tauri 2.11（3.75）/ Flutter 3.47（3.85） | Electron 44 |
| 数据存储 Data | 明文件 JSON（契约 v1） | SQLite 嵌入式 | 明文件 JSON |
| 检索 Search | FlexSearch（候选+退化） | Elasticsearch | FlexSearch 内存态 |
| 对比明细 | `02-系统设计\技术选型报告 Tech Stack.md` §3.4/§5 | - | - |

### 附录C：参考资料 References

- `02-系统设计\架构设计文档 Architecture.md`（工程画像/原则/决策记录 ADR 001-006）
- `02-系统设计\数据库设计说明书 DB Design.md`（存储契约 v1 全文）
- `02-系统设计\接口设计文档 API Design.md`（IPC 白名单契约全文）
- `02-系统设计\技术选型报告 Tech Stack.md`（选型依据）

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 架构师 Architect | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 技术负责人 Tech Lead | HeYS-Snowe | 电子批准 | 2026-09-05 |
| CTO/技术总监 | -（单人项目，由技术负责人兼任） | - | - |

---

**文档结束 End of Document**

**注意:** 本文档为概要设计，详细的技术实现请参考《详细设计说明书》。
