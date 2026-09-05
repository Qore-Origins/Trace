# 技术选型报告 Technology Selection Report

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | 2026-09-05 |
| 最后修改 Last Modified | 2026-09-05 |
| 技术负责人 Tech Lead | HeYS-Snowe |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | 2026-09-05 | HeYS-Snowe | HeYS-Snowe | 初始版本 Initial Version（Electron + Windows 单端定案 2026-09-05） |

---

## 目录 Table of Contents

1. [选型概述 Selection Overview](#1-选型概述-selection-overview)
2. [选型原则 Selection Principles](#2-选型原则-selection-principles)
3. [前端技术选型 Frontend Selection](#3-前端技术选型-frontend-selection)
4. [后端技术选型 Backend Selection](#4-后端技术选型-backend-selection)
5. [数据存储选型 Data Storage Selection](#5-数据存储选型-data-storage-selection)
6. [基础设施选型 Infrastructure Selection](#6-基础设施选型-infrastructure-selection)
7. [选型汇总 Selection Summary](#7-选型汇总-selection-summary)

---

## 1. 选型概述 Selection Overview

### 1.1 选型目标 Selection Goals

> 项目约束（源自 00/01 文档）：本地优先单机桌面应用（无服务器、无网络功能、无账号体系）；数据=用户指定根目录下的明文件文件夹；MVP=存储/渲染/溯源查询三模块；本阶段平台承诺=Windows 10/11 x64（macOS/Linux 代码层天然覆盖但不承诺；移动端本阶段不做、远期 Android 原生 Kotlin，见 §3.3）。

| 目标维度 Goal Dimension | 说明 Description |
|---------------------|---------------|
| 业务匹配 Business Fit | 满足"计划=文件夹 + 组件化渲染 + 溯源查询"的全部功能需求 |
| 团队能力 Team Capability | 复用既有 Web 技能栈（本机 Node 24.18 已装）；避免需要长学习期的 Rust/原生桌面 |
| 成本控制 Cost | 零现金（免费/开源全链）；无服务器、无第三方付费服务 |
| 生态支持 Ecosystem | 桌面壳 + 热重载 + 打包分发 + 检索/拖拽/树：JS 生态覆盖最全 |
| 稳定性 Stability | 框架层稳定（长期存在的大规模案例），升级节奏可跟踪（8 周一版） |

### 1.2 选型流程 Selection Process

```
需求分析 → 方案调研 → 对比评估 → PoC验证 → 决策落地
   │          │          │         │         │
01文档    2026-09-05 候选矩阵    本机环境   本文档
          Web 调研     (§3.4)     探测已做     (定案)
```

> 本项目的"PoC 验证"以本机工具链探测完成（Flutter 3.41.6 已装、cargo 1.91.1、Node 24.18.0、VS 2026 均在）；方案级 PoC（最小窗口 + 文件树读写）列为 LLD 后开发首周的首个任务（Spike），不在选型阶段阻塞。

---

## 2. 选型原则 Selection Principles

### 2.1 评估维度 Evaluation Dimensions

| 维度 Dimension | 权重 Weight | 说明 Description |
|--------------|-----------|---------------|
| 功能性 Functionality | 25% | 是否满足功能需求（文件树/拖拽/组件渲染/本地检索/打包分发） |
| 性能 Performance | 20% | 启动时间、内存占用、操作响应（本地应用不追求云端吞吐） |
| 可维护性 Maintainability | 15% | 单语言程度、代码可读性、调试便利性 |
| 学习成本 Learning Curve | 15% | 团队上手难度（AI 协作下的可达性） |
| 生态社区 Ecosystem | 15% | 社区活跃度、文档质量、第三方库覆盖 |
| 成本 Cost | 10% | 零现金约束、升级/维护成本 |

### 2.2 评分标准 Scoring Criteria

| 分数 Score | 评价 Evaluation |
|----------|--------------|
| 5分 Excellent | 完全满足，表现优异 |
| 4分 Good | 满足需求，表现良好 |
| 3分 Average | 基本满足，表现一般 |
| 2分 Fair | 部分满足，存在不足 |
| 1分 Poor | 不满足需求 |

---

## 3. 前端技术选型 Frontend Selection

### 3.1 Web前端框架选择 Web Framework Selection（渲染器层）

> Electron 渲染器 = Web 前端技术栈。选型结论：**React 19 + TypeScript**（备选 Vue 3）。

| 对比项 Comparison | React | Vue.js | 原生 DOM/无框架 |
|-----------------|-------|--------|---------------|
| **功能性 Functionality (25%)** | | | |
| 组件化/渲染虚拟化 | 5 | 5 | 3 |
| 树/拖拽生态（dnd-kit、rc-tree 等） | 5 | 4 | 2 |
| Toast/表格/树组件库成熟度 | 5 | 5 | 2 |
| **性能 Performance (20%)** | | | |
| 渲染性能（虚拟列表/树懒加载） | 5 | 5 | 4 |
| 包体积/可分包 | 4 | 4 | 5 |
| **可维护性 Maintainability (15%)** | | | |
| TypeScript 全栈一致 | 5 | 5 | 3 |
| 调试工具（DevTools/热重载） | 5 | 4 | 2 |
| **学习成本 Learning Curve (15%)** | | | |
| 团队熟悉度（AI 生态 React 占优） | 5 | 3 | 3 |
| **生态社区 Ecosystem (15%)** | | | |
| 第三方库（索引/拖拽/图标/日期） | 5 | 4 | 2 |
| **成本 Cost (10%)** | | | |
| 开发效率 | 4 | 4 | 2 |
| **总分 Total Score** | **4.75** | **4.30** | **2.55** |

**选择结果 Decision:** **React 19 + TypeScript**

| 理由 Rationale |
|--------------|
| 树/拖拽/检索的 React 生态（dnd-kit、antd Tree、FlexSearch、TanStack）与桌面组件需求最贴合 |
| 团队 AI 协作生态以 React 为主（skill/agent 体系），产出质量与效率高 |
| TS 全栈（渲染器 + 主进程）单语言，可维护性好 |
| 备选注：若开发期发现更偏好 Vue 3 中文生态，属"仅渲染器层替换"的小型变更（不影响其他层选型），走变更流程评估 |

### 3.2 前端技术栈 Frontend Tech Stack

| 技术 Technology | 选型 Choice | 版本 Version | 说明 Notes |
|--------------|-----------|------------|----------|
| UI 框架 Framework | React | 19.x | 渲染器层框架 |
| 语言 Language | TypeScript | 5.x | 全栈（渲染器+主进程）单语言 |
| UI 组件库 UI Library | Ant Design（antd） | 5.x | Tree（内置可拖拽）、表格、组件齐全；内置中文 locale |
| 构建/脚手架 Build Tool | electron-vite + Vite | 当前稳定版（脚手架生成时锁定） | 主进程/渲染器一体化开发、HMR |
| 状态管理 State | Zustand | 4.x（LLD 锁定） | 轻量，桌面本地状态足够 |
| 打包分发 Packaging | electron-builder | 当前稳定版（LLD 锁定） | NSIS 安装包（Windows）、将来可扩展 MSI |
| 拖拽 Drag & Drop | dnd-kit（或 antd Tree 内建拖拽） | 当前稳定版（LLD 锁定） | 树节点拖放/排序 |
| 本地索引 Search | 内存扫包含匹配（自研，SPIKE-1 定案） | - | 万级 docs 实测 avg 1.65ms/max 5.46ms、零漏检；FlexSearch 中文子串漏检 487 条被否决（2026-09-05 Spike，脚本存档 `scripts/spike/`） |
| 文件监视 File Watch | chokidar | 4.x（LLD 锁定） | 计划库外部变更检测 |

### 3.3 移动端技术选型 Mobile Selection

| 对比项 Comparison | React Native | Flutter | 原生开发（Kotlin / Swift） |
|-----------------|-------------|---------|-------------------------|
| 开发效率 Development Efficiency | 4 | 5 | 3 |
| 性能表现 Performance | 4 | 5 | 5 |
| 热更新 Hot Update | 支持 | 支持 | 不支持 |
| 学习成本 Learning Cost | 3（需 React） | 3 | 5 |
| 与桌面栈复用度 Reuse | 低（需 Bridge） | 中（单代码库可含桌面） | 低 |
| **总分 Total** | **19** | **20** | **23** |

**选择结果 Decision:** **原生开发（远期，本阶段不做）** —— 与开发者既定策略一致："桌面 Electron + 移动端各自原生"。

| 理由 Rationale |
|--------------|
| 移动端不在本阶段范围（无 Apple 设备；iOS 后置；黑苹果仅"可能"，不作计划依据） |
| 远期 Android = 原生 Kotlin；iOS = 原生 Swift（硬件条件成熟时启动） |
| 时间点：v2.0 之后评估；v1.0 不预留主进程外任何移动代码 |

### 3.4 桌面端技术选型 Desktop Selection

> 本机环境探测（2026-09-05，实测）：Node 24.18.0 ✓、Flutter 3.41.6 ✓、rustc 1.91.1 ✓、VS 2026（v18）✓。客户端框架对比得分（计权，按 §2.1 维度）：

| 对比项 Comparison | Electron | Tauri | Flutter Desktop | 原生 WinUI/WPF |
|-----------------|---------|-------|-----------------|---------------|
| **功能性 Functionality (25%)** | | | | |
| 文件系统/拖拽/检索/打包覆盖 | 4 | 4 | 4 | 4 |
| **性能 Performance (20%)** | | | | |
| 冷启动/内存/包体（口径见下） | 3 | 5 | 4 | 5 |
| **可维护性 Maintainability (15%)** | | | | |
| 单语言/调试便利 | 5 | 3（Rust+TS 双轨） | 4（Dart+桌面插件） | 3 |
| **学习成本 Learning Curve (15%)** | | | | |
| 技能栈匹配（Web 中级） | 5 | 3（Rust 初级） | 4（有 Flutter 基础，但需从手机转桌面） | 3 |
| **生态社区 Ecosystem (15%)** | | | | |
| 文档/三方库/桌面案例 | 5 | 3 | 3（桌面插件生态弱于 Web） | 4 |
| **成本 Cost (10%)** | | | | |
| 开发效率 | 5 | 3 | 4 | 3 |
| | | | | |
| 2026-09 稳定版本 | **44.0.0**（2026-08-25；Chromium 152 / Node 24.18.1；支持窗口=最新 3 个大版本） | **2.11.5**（2026-07-01；MSRV Rust 1.77+） | **3.47.0**（2026-08-12；Dart 3.13；Impeller 设为 Windows/Linux 桌面默认渲染；本机当前 3.41.6 需升级） | VS 2026（v18） |
| 包体/内存实测参考 | 包体 80-200MB；闲置内存显著高于其他（量级 ~200MB+） | 包体 3-10MB；闲置 42-50MB；冷启动约 380ms | 包体 20-40MB 级；桌面渲染 3.47 后 Impeller 消除抖动 | 包体最小；系统原生 |
| **加权总分 weighted** | **4.25** | **3.75** | **3.85** | **3.80** |

> 加权算法：Σ(维度得分×权重)。Electron 得分 = 4×0.25 + 3×0.20 + 5×0.15 + 5×0.15 + 5×0.15 + 5×0.10 = 4.25；Tauri = 3.75；Flutter = 3.85；原生 = 3.80。

**选择结果 Decision:** **Electron 44**（最终定案，2026-09-05）

| 理由 Rationale |
|--------------|
| 1. 开发者既定多端策略（桌面 Electron + 移动端原生）与本选型一致；移动端"各自原生"前提下 Flutter 单代码库优势失效 |
| 2. 功能需求（文件夹树/拖拽/组件渲染/本地检索/NSIS 打包）在 JS 生态覆盖最全，AI 协作生态同为 React 主轴，开发效率最高 |
| 3. 明文件计划库可被主进程（Node）直读直写，与"计划=文件夹"模型天然吻合 |
| 4. 学习成本最低（Web 技能直接迁移），差距项（包体/内存）对本项目（单用户本地工具）影响有限 |
| 5. Tauri/Flutter 各有强项（轻量/跨语言），记为 v2.0 换栈评估候选，本期不做 |
| 6. 升级节奏：Electron 每 8 周一版，本团队承诺"跟随最新稳定大版本（保持 1 个版本内延迟）+ 每年至少一次升级" |

---

## 4. 后端技术选型 Backend Selection

### 4.1 后端语言和框架选择 Backend Language & Framework

**结论：无独立后端。** 本项目为本地单机应用（约束：无服务器、无网络功能、无账号体系）。Electron 主进程（Node.js）承担"后端"职责：文件系统服务、检索索引维护、配置持久化、日志。

| 后端职责 Backend Duty | 选型 Choice | 说明 Notes |
|-----------------|------------------|----------|
| 语言 Language | TypeScript（与渲染器同语言） | Web 全栈（React+TS）技能直接复用 |
| 运行时 Runtime | Electron 主进程（Node.js 24） | 随 Electron 44 内置（Node 24.18.1） |
| 业务框架 Framework | Electron + 轻量分层（服务层，见架构设计文档 §3.1） | 不引入 NestJS 等重型框架（单机项目，YAGNI） |
| API 风格 API Design | 进程内 IPC（contextBridge 白名单 API），无 REST/gRPC | 渲染器与主进程隔离边界，最小暴露 |

### 4.2 后端技术栈 Backend Tech Stack

| 技术 Technology | 选型 Choice | 版本 Version | 说明 Notes |
|--------------|-----------|------------|----------|
| 运行环境 Runtime | Node.js（Electron 内置） | 24.18.x（随 Electron 44） | 本机 Node 24.18.0 已装（并行开发验证） |
| 语言 Language | TypeScript | 5.x | - |
| IPC IPC | contextBridge + ipcRenderer（白名单） | Electron 44 API | 安全边界（见架构文档 §6） |
| 文件系统 FS | Node fs/promises | 内置 | 原子写（临时文件+rename） |
| 文件监视 Watch | chokidar | 4.x（LLD 锁定） | 外部改动检测 |
| 日志 Logging | 自研轻量日志（console + 文件） | v1.0 | 脱敏规则见架构文档 §6 |

### 4.3 API设计风格 API Design Style

| 风格 Style | 优点 Pros | 缺点 Cons | 选择 Selection |
|----------|---------|---------|--------------|
| 进程内 IPC 事件 | 安全隔离（contextIsolation）+ 声明式 API | 跨进程调试稍复杂 | ☑ 选择 |
| RESTful | - | 无服务端场景不适用 | |
| GraphQL / gRPC | - | 无服务端场景不适用 | |

**选择结果:** 进程内 IPC（渲染器 → 主进程 白名单方法调用；主进程 → 渲染器 事件推送，如索引进度）

---

## 5. 数据存储选型 Data Storage Selection

> 项目定位约束：数据 = 用户指定根目录下的**明文件文件夹**（可整库备份、可任意工具读取）。因此不选传统数据库（服务进程依赖、数据锁定），选"文件系统 + 明文件 + 轻索引"。

### 5.1 关系型数据库选择 Relational Database

| 对比项 Comparison | MySQL / PostgreSQL | SQLite（嵌入式） | 前端文件方案（JSON 明文件） |
|-----------------|--------|-----------|--------|
| 服务进程依赖 | 需要 | 无需 | 无需 |
| 数据可直接备份/迁移 | 需导出 | 单文件 | ☑ 整库拷贝即备份 |
| 运维复杂度 | 高 | 低 | 低 |
| 与"计划=文件夹"模型匹配度 | 低（模型需映射） | 中 | ☑ 高（直读直写） |
| 数据规模适配（≤1000 计划/10000 任务） | 富余 | 富余 | ☑ 富余 |

**选择结果 Decision:** **明文件 JSON（计划库根目录）+ 应用级轻索引；不使用数据库**

| 理由 Rationale |
|--------------|
| 项目第一约束即"数据=文件夹、明文件可迁移"，数据库方案与之冲突 |
| 规模上限（千级计划/万级任务）下，JSON 明文件 + 内存索引性能富余 |

### 5.2 缓存数据库选择 Cache Database

| 对比项 Comparison | Redis / Memcached | 进程内缓存 |
|-----------------|-------|-----------|
| 数据来源 | 外部服务进程 | 应用内存（树/内容/索引对象缓存） |
| 失效机制 | 需显式过期 | 文件监视（chokidar）+ 变更事件驱动失效 |
| 运维 | 需起服务 | 无 |

**选择结果 Decision:** **进程内缓存（无外部缓存服务）** —— 单机单进程，内存区即缓存；数据规模下无缓存穿透风险。

### 5.3 消息队列选择 Message Queue

**不适用**：单机单进程内的异步（索引增量、日志落盘）用进程内事件/定时器实现，无 MQ。

### 5.4 搜索引擎选择 Search Engine

| 对比项 Comparison | Elasticsearch | SQLite FTS | FlexSearch（纯 JS 内存索引） |
|-----------------|---------------|------|----------------|
| 服务进程依赖 | 需要（JVM） | 嵌入式 | 无（包内） |
| 中文支持 | 好（需插件） | 需分词器 | 自定义分词回调（LLD 验证；退化方案见 §3.2 备注） |
| 运维复杂度 | 高 | 低 | 无 |
| 规模适配（万级文档） | 富余 | 富余 | 富余 |

**选择结果 Decision:** **FlexSearch（候选）+ 退化方案（内存扫包含匹配）** —— 万级文档规模无需重型搜索引擎；"启动构建 + 变更增量 + 内存态"即可满足 ≤1s 承诺。

### 5.5 文件存储选择 File Storage

| 对比项 Comparison | 对象存储 OSS / 云盘 | 本地明文件（项目根目录） |
|-----------------|-----------|---------|
| 数据出设备 | 上传 = 违反"数据不出设备"约束 | ☑ 本地 |
| 成本 | 云费用（与¥0 预算冲突） | 0 |
| 备份 | 依赖云 | ☑ 拷贝即备份（且文档化指引） |

**选择结果 Decision:** **本地文件存储（用户指定的计划库根目录）** × 无云。

---

## 6. 基础设施选型 Infrastructure Selection

### 6.1 容器化选择 Containerization

**不适用**：无服务端，Docker/K8s 无承载对象。开发期可选容器化做交叉构建环境（如 Windows 打包需 Windows 本机；不做容器方案）。

### 6.2 容器编排选择 Container Orchestration

**不适用**（单机本地应用，无编排对象）。

### 6.3 CI/CD选择

| 对比项 Comparison | GitHub Actions | GitLab CI | 本地脚本 |
|-----------------|---------|-----------|---------|
| 触发场景 | 代码托管 `Qore-Origins/Trace` + PR 检查 + 打包 Windows 安装包 | 需自建 GitLab | 手动 |
| Windows 构建支持 | 原生 runner（windows-latest） | 部分自托管 | 本机 |
| 成本 | 公共仓库免费额度 | 自建/免费额度 | - |

**选择结果 Decision:** **GitHub Actions（`Qore-Origins/Trace`）** —— 主用 CI：TypeScript 检查 + 单测 + electron-builder 打包（Windows）；发布阶段 M6 使用。仓库创建与远端推送列为本期工程事项（见架构设计文档 §9）。

### 6.4 监控方案选择 Monitoring

**不适用**（本地应用，无运行监控体系）。对应能力 = 应用日志（`logs/` 本地文件，脱敏）+ 启动自检（根目录完整性、索引状态提示）。

---

## 7. 选型汇总 Selection Summary

### 7.1 技术栈全景图 Tech Stack Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                     溯源 Trace（Electron 44 · Windows）             │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 渲染进程 Renderer（React 19 + TS）                            │   │
│ │  ┌───────────┐ ┌───────────┐ ┌───────────┐                 │   │
│ │  │ 计划树 UI  │ │ 组件渲染区 │ │ 溯源查询UI │  ← antd + Zustand │   │
│ │  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘                 │   │
│ │        └───────  contextBridge 白名单 API ───────┘          │   │
│ └──────────────────────────────────────────────────────────────┘   │
│  ──────────────────── IPC（安全边界） ──────────────────────         │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 主进程 Main（Node 24.18.1）                                   │   │
│ │  StorageService  SearchService  ConfigService  WatchService   │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                    │ fs（原子写）/ chokidar（监视）                │   │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 计划库根目录（用户指定，明文件）→ schema.json/components 等      │   │
│ │ 应用配置（%APPDATA%\trace\）→ 索引缓存 → logs\（脱敏）          │   │
│ └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### 7.2 最终技术选型 Final Technology Stack

| 层级 Layer | 技术选型 Technology | 版本 Version |
|----------|-------------------|------------|
| **桌面壳 Desktop Shell** | Electron | 44.x（2026-08-25 起稳定） |
| **渲染器 Renderer** | | |
| UI框架 | React | 19.x |
| UI组件库 | Ant Design（antd） | 5.x |
| 构建 | electron-vite + Vite | 脚手架当前稳定版 |
| 状态管理 | Zustand | 4.x |
| 拖拽 | dnd-kit / antd Tree 内建拖拽 | 当前稳定版 |
| **主进程 Main Process** | | |
| 语言 | TypeScript | 5.x |
| 文件操作 | Node fs + chokidar | 内置 / 4.x |
| 检索索引 | FlexSearch（候选+退化方案） | 当前稳定版 |
| 日志 | 自研轻量日志 | v1.0 |
| **数据 Data** | 明文件 JSON（计划库根目录）+ 进程内缓存 | - |
| **分发 Packaging** | electron-builder（NSIS） | 当前稳定版 |
| **CI/CD** | GitHub Actions | - |
| **移动端 Mobile（远期，未排期）** | 原生 Kotlin（Android） | v2.0 后评估 |

### 7.3 技术风险与应对 Tech Risks & Mitigation

| 风险 Risk | 影响 Impact | 应对措施 Mitigation |
|----------|-----------|------------------|
| Electron 升级节奏快（8 周一版，Chromium 安全生命周期） | 维护负担、安全过期 | 跟随最新稳定大版本（≤1 版延迟）+ 每年升级一次；升级列入里程碑核销 |
| 包体/内存相对大 | 认知观感（非功能缺陷） | 明确接受（自用工具）；M5 性能测试记录实际数据；开启延迟加载/懒渲染控制运行内存 |
| 中文检索分词质量 | 检索命中率（KPI=100% 无漏检） | LLD 期对 FlexSearch 中文分词组 PoC；不达标退化为"内存扫包含匹配"（规模内毫秒级） |
| 明文件被外部工具改/误删 | 数据损坏 | chokidar 监视 + 冲突提示 + 二次确认 + 原子写 + 文档化备份指引 |
| antd/React 生态版本漂移 | 构建兼容 | package-lock 锁定；升级走变更流程 |
| 被拒原样重试不适用项 | - | - |

---

## 附录 Appendix

### 附录A：参考文档 References

| 文档 Document | 链接 Link |
|-------------|---------|
| Electron Releases / Schedule | https://releases.electronjs.org/schedule |
| Tauri Core Releases | https://v2.tauri.app/release/core/ |
| Flutter 3.47.0 发布（Impeller 桌面默认） | https://dev.to/ishaquehassan/run-flutter-upgrade-nine-of-my-commits-ship-inside-flutter-347-533f |
| electron-vite / electron-builder | https://electron-vite.org / https://www.electron.build |
| FlexSearch | https://github.com/nextapps-de/flexsearch |

### 附录B：技术调研报告 Research Reports

| 技术点 Technology | 调研报告 Research Report | 链接 Link |
|----------------|----------------------|---------|
| Electron 44（2026-08-25，Chromium 152 / Node 24.18.1，EOL 2027-03-02，官方支持最新 3 个大版本） | 官方 Release + Schedule 抓取 | https://releases.electronjs.org / https://endoflife.date/electron |
| Tauri 2.11.5（2026-07-01；MSRV 1.77.2+；包体 ~3-10MB；闲置 42-50MB；冷启动 ~380ms） | 官方 Release + 2026 对比文 | https://tauri.app/release/tauri/v2.11.0/ |
| Flutter 3.47.0（2026-08-12；Dart 3.13；Impeller Windows/Linux 桌面默认；本机已装 3.41.6 需升级） | 官方 Release 新闻 | https://gamesinflutter.com/news/flutter-3-47-0-stable-impeller-desktop-default |

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 技术负责人 Tech Lead | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 架构师 Architect | HeYS-Snowe | 电子批准 | 2026-09-05 |
| CTO | -（单人项目，由技术负责人兼任） | - | - |

---

**文档结束 End of Document**
