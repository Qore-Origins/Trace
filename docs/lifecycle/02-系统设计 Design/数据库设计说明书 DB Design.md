# 数据库设计说明书 Database Design Document（存储格式契约）

> 本项目无数据库（技术选型定案：明文件 JSON + 进程内索引）。本文档承担 **存储格式契约** 角色：定义计划库根目录的目录布局、文件格式、字段、版本与迁移规则。开发实现与数据迁移均以此为准。契约 v1.0 由本项目决策（2026-09-05）。

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | 2026-09-05 |
| 最后修改 Last Modified | 2026-09-05 |
| 数据库设计师 DB Designer | HeYS-Snowe |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | 2026-09-05 | HeYS-Snowe | HeYS-Snowe | 初始版本 Initial Version（存储格式契约 v1 定稿） |

---

## 目录 Table of Contents

1. [概述 Overview](#1-概述-overview)
2. [存储选型 Storage Selection](#2-存储选型-storage-selection)
3. [设计原则 Design Principles](#3-设计原则-design-principles)
4. [逻辑设计 Logical Design](#4-逻辑设计-logical-design)
5. [物理设计 Physical Design](#5-物理设计-physical-design)
6. [索引设计 Index Design](#6-索引设计-index-design)
7. [分区与归档 Partition & Archive](#7-分区与归档-partition--archive)
8. [数据字典 Data Dictionary](#8-数据字典-data-dictionary)

---

## 1. 概述 Overview

### 1.1 文档目的 Document Purpose

本文档定义「溯源 Trace」的**存储格式契约**：计划库根目录的目录布局、文件格式、字段与枚举、版本化与迁移规则。它取代传统数据库设计（表/DDL），成为开发、迁移、备份与第三方互操作的唯一数据依据。

### 1.2 存储体系概述 Storage Overview

| 属性 Attribute | 内容 Content |
|-------------|-----------|
| 存储体系名称 Storage Name | Trace 计划库（明文件）+ 应用数据目录 |
| 存储类型 Storage Type | ☑ 其他：文件系统明文件（JSON 契约）；□ MySQL □ PostgreSQL □ Oracle |
| 字符集 Character Set | UTF-8（JSON 标准） |
| 文件编码 File Encoding | UTF-8（无 BOM） |
| 时间格式 Time Format | ISO 8601 UTC（`YYYY-MM-DDTHH:mm:ssZ`）；日期字段可用 `YYYY-MM-DD` |
| 换行 Newline | LF（写入统一 LF） |

**存储分区约定：**

| 分区 Partition | 位置 Location | 内容 Content | 可重建 Rebuildable |
|--------------|-------------|-------------|-----------------|
| 计划库（用户数据） | 用户指定根目录（明文件，本契约主体） | 计划文件夹树 + `plan.json` + `.trace/` | 否（核心数据） |
| 应用配置 | `%APPDATA%\trace\` | `config.json`（根目录、窗口状态、格式版本） | 否（丢失=重新配置） |
| 索引缓存 | `%APPDATA%\trace\index.json` | 检索索引持久化缓存 | 是（可由计划库重建） |
| 日志 | `%APPDATA%\trace\logs\` | 脱敏应用日志 | 是 |

---

## 2. 存储选型 Storage Selection

### 2.1 主存储选型 Main Storage

| 选型 Selection | 版本 Version | 用途 Usage |
|--------------|-------------|----------|
| 文件系统明文件（JSON 契约） | 契约 v1 | 计划/组件/任务/注释全部数据（计划=文件夹） |

依据（技术选型报告 §5.1）：数据=文件夹明文件是项目第一约束（可整库备份、可迁移、不锁定）；规模上限（≤1000 计划/≤10000 任务）下表/文件内读写性能富余；无数据库服务进程依赖。

### 2.2 其他数据存储 Other Storage

| 存储类型 Storage Type | 技术选型 Technology | 用途 Usage |
|-------------------|-------------------|----------|
| 缓存 Cache | 进程内缓存 | 树枚举/内容对象/索引（内存态，无外部服务） |
| 文档存储 Document | 不适用（==主存储） | - |
| 搜索引擎 Search | FlexSearch（候选）记忆体 + `index.json` 缓存 | 全文检索（缓存可重建） |
| 文件存储 File | 本地计划库根目录（无 OSS/云） | 数据不出设备硬约束 |

---

## 3. 设计原则 Design Principles

### 3.1 命名规范 Naming Conventions

| 对象类型 Object Type | 命名规则 Naming Rule | 示例 Example |
|-------------------|-------------------|------------|
| 计划文件夹（物理目录） | 计划名（utf-8，≤255 字符，禁系统非法字符） | `2026-A 学期` |
| 计划内容文件 | 固定 `plan.json`（每计划一个） | `plan.json` |
| 库元数据目录 | `.trace/`（隐藏目录，保留字） | `.trace/plan-library.json` |
| 库元数据文件 | `plan-library.json` | - |
| 组件类型枚举 | 下划线小写（snake_case） | `task_list` |
| 字段名 | 下划线小写（snake_case），与 01 文档一致 | `created_at` |
| 组件/任务标识 | uuid v4 短版（无连字符 32 hex） | `3b9a1c2e5f6d7c8b9a0f1e2d3c4b5a6f` |

### 3.2 设计原则 Design Principles

| 原则 Principle | 说明 Description |
|--------------|---------------|
| 明文件 Plain Files | 数据一望即知：所有内容为 JSON/目录，任何文本工具可读；不引入二进制私有格式 |
| 原子写 Atomic Write | 所有落盘 = 同目录临时文件写 → fsync → rename 原子替换；绝无半写（崩溃安全） |
| 路径即 ID Path is ID | 计划唯一标识 = 相对根目录的路径（01 文档定）；重命名/移动 = ID 变更（无跨计划引用 → 无引用完整性负担）；组件/任务以文件内 id 定位 |
| 单文件每计划 One File per Plan | 组件序列、任务、注释全部存于该计划 `plan.json`；进程内缓存树+内容，读取即时 |
| 向前兼容 Forward Compat | 读取方必须容忍未知字段（保留不丢）；未知组件 type → 降级渲染但数据原样保留（不写入丢失） |
| 版本号 Versioned | 根契约版本载体：`.trace/plan-library.json.format_version`；升级=迁移脚本 + 备份（附录C） |
| 空值最小化 | 可选字段缺席即默认值（避免写 null 噪声）：如 `planned_at` 缺席=无计划时间 |
| 软删除 Soft Delete | 本版本不适用：删除=移除文件夹（二次确认）；撤销/回收站为 v1.1 引入 `.trash`（届时本契约升级） |

---

## 4. 逻辑设计 Logical Design

### 4.1 ER图 Entity-Relationship Diagram

```
┌──────────────────────┐
│  计划库 Plan Library   │
│  ├─ format_version   │──（根目录 = 一库）
└──────────┬───────────┘
           │ 1
┌──────────▼───────────┐
│   计划 Plan（=文件夹） │
│  id=相对路径(主键)     │
│  childrenOrder(排序)  │──┐ 1:N（子计划=子文件夹）
│  components[ ]（序列） │  │ 任意层级嵌套（受文件系统路径限制）
└──────────┬───────────┘  └──┘
           │ 1:N
┌──────────▼───────────┐
│  计划单片组件 Component │
│  type (5 枚举)         │
│  payload（类型化内容）  │
└──────┬───────────┬──┘
       │1:N        │1:N
┌──────▼─────┐ ┌───▼────────┐
│  任务 Task   │ │  注释 Note  │
│ status(三态)│ │ content    │
└────────────┘ └────────────┘
注：任务列表组件 1:N 任务；任务详情组件 1:1 单任务（嵌入 payload）
```

### 4.2 数据模型 Data Models

| 实体 Entity | 物理形态 Physical | 说明 Description |
|-----------|-----------------|---------------|
| 计划库 Plan Library | 根目录 + `.trace/plan-library.json` | 单用户单库（v1.0），`format_version` 唯一事实源 |
| 计划 Plan | 文件夹（可嵌套）+ `plan.json` | id=相对根目录路径 |
| 组件 Component | `plan.json.components[]` 元素 | type 枚举 + payload（组件顺序=数组顺序=渲染顺序） |
| 任务 Task | `task_list.payload.items[]` / `task_detail.payload` | 状态三态 |
| 注释 Note | `note.payload` | 内容参与检索 |
| 排序 Order | 计划层：父计划 `plan.json.children_order`；同计划组件：components[] 顺序 | 文件夹天然无序，顺序由契约表达 |

---

## 5. 物理设计 Physical Design

### 5.1 目录布局 Directory Layout

```
<计划库根目录>/
├── .trace/                          # 库级元数据（保留目录）
│   └── plan-library.json            # format_version / library_id / created_at
├── 2026-A 学期/                     # 计划 = 文件夹
│   ├── plan.json                    # 本计划全部数据（元数据 + 组件序列）
│   └── Web 全栈实训/                # 子计划 = 子文件夹（可任意嵌套）
│       └── plan.json
├── Trace 开发计划/
│   └── plan.json
└── ...
```

### 5.2 文件格式 File Formats

#### plan-library.json

| 字段 Field | 类型 Type | 必填 Required | 说明 Description |
|-----------|---------|------------|---------------|
| format_version | String | 是 | 契约版本，当前 `"1"` |
| library_id | String | 是 | uuid v4，分配于初始化，固定不变 |
| created_at | String(ISO8601) | 是 | 库创建时间 |
| schema_info | String[] | 是 | 描述 [\"min\",\"v1\"]（预留扩展，见附录C） |

#### plan.json（计划文件，每计划一个）

| 字段 Field | 类型 Type | 必填 Required | 说明 Description |
|-----------|---------|------------|---------------|
| format_version | String | 是 | 与库一致（向上兼容） |
| created_at | String(ISO8601) | 是 | 计划创建时间 |
| updated_at | String(ISO8601) | 是 | 最近修改时间（每次原子写更新） |
| children_order | String[] | 否 | 子计划文件夹名的有序列表；缺席=子目录按名称升序 |
| components | Component[] | 是 | 组件序列（渲染顺序 = 数组顺序）；可为空数组 |

#### 组件组件结构 Component（plan.json.components[i]）

| 字段 Field | 类型 Type | 必填 Required | 说明 Description |
|-----------|---------|------------|---------------|
| id | String(uuid32) | 是 | 组件标识（文件内唯一；用于检索定位/局部更新） |
| type | String | 是 | 枚举：single_plan / multi_plan / task_list / task_detail / note |
| payload | JSON Object | 是 | 类型化内容（见 5.3 各类型 payload 表） |

#### payload 字段表（按类型）

**single_plan（单选计划）**

| 字段 Field | 类型 Type | 必填 Required | 说明 Description |
|-----------|---------|------------|---------------|
| title | String(≤200) | 是 | 单一目标标题 |
| done | Boolean | 是 | 完成标记（默认 false） |
| summary | String(≤2000) | 否 | 摘要备注 |
| created_at | String(ISO8601) | 是 | 创建时间 |

**multi_plan（多选计划）**

| 字段 Field | 类型 Type | 必填 Required | 说明 Description |
|-----------|---------|------------|---------------|
| title | String(≤200) | 是 | 计划标题 |
| summary | String(≤2000) | 否 | 摘要 |
| options | Option[] | 是 | 选项列表（至少 1 项） |
| Option: id / text(≤200) / checked(Boolean) | - | 是 | 选项项：id 唯一、文本、勾选态 |

**task_list（任务列表）**

| 字段 Field | 类型 Type | 必填 Required | 说明 Description |
|-----------|---------|------------|---------------|
| title | String(≤200) | 是 | 列表标题 |
| items | TaskItem[] | 是 | 任务集（≥0） |

**TaskItem（任务行）**

| 字段 Field | 类型 Type | 必填 Required | 说明 Description |
|-----------|---------|------------|---------------|
| id | String(uuid32) | 是 | 任务标识 |
| title | String(≤200) | 是 | 任务标题 |
| status | String | 是 | not_started / in_progress / done |
| planned_at | String(YYYY-MM-DD) | 否 | 计划时间（缺席=无） |
| completed_at | String(ISO8601) | 否 | 完成时间（done 时写入） |
| note | String(≤20000) | 否 | 任务备注 |

**task_detail（任务详情）**

| 字段 Field | 类型 Type | 必填 Required | 说明 Description |
|-----------|---------|------------|---------------|
| title | String(≤200) | 是 | 任务名 |
| description | String(≤20000) | 否 | 描述（纯文本多行） |
| planned_at | String(YYYY-MM-DD) | 否 | 计划时间 |
| status | String | 是 | 三态枚举 |
| completed_at | String(ISO8601) | 否 | 完成时间 |
| note | String(≤20000) | 否 | 备注 |
| created_at | String(ISO8601) | 是 | 创建时间 |

**note（注释）**

| 字段 Field | 类型 Type | 必填 Required | 说明 Description |
|-----------|---------|------------|---------------|
| content | String(≤20000) | 是 | 注释正文 |
| created_at | String(ISO8601) | 是 | 创建时间 |

### 5.3 示例 JSON（plan.json，一个典型计划）

```json
{
  "format_version": "1",
  "created_at": "2026-09-05T08:00:00Z",
  "updated_at": "2026-09-05T12:30:00Z",
  "children_order": ["Web 全栈实训", "周计划"],
  "components": [
    {
      "id": "3b9a1c2e5f6d7c8b9a0f1e2d3c4b5a6f",
      "type": "single_plan",
      "payload": { "title": "本学期主线：技能大赛备赛", "done": true, "summary": "国赛方向", "created_at": "2026-09-05T09:00:00Z" }
    },
    {
      "id": "8f2e0d1c3b4a59687f6e5d4c3b2a1908",
      "type": "task_list",
      "payload": {
        "title": "本周任务",
        "items": [
          { "id": "a1", "title": "功能规格评审", "status": "done", "planned_at": "2026-09-05", "completed_at": "2026-09-05T11:00:00Z" },
          { "id": "a2", "title": "技术选型 Spike", "status": "in_progress", "planned_at": "2026-09-06" }
        ]
      }
    },
    {
      "id": "c7f6b5a4ffff333dee11aa22bb33cc44",
      "type": "note",
      "payload": { "content": "评审前置，返工减半。", "created_at": "2026-09-05T10:00:00Z" }
    }
  ]
}
```

### 5.4 类型契约（TypeScript 视图，等效 DDL）

> 契约实现层 = `src/shared/contract.ts`（渲染器/主进程共享）。由 JSON Schema（5.5）派生为 TS 类型；以 Schema 为唯一准绳。

### 5.5 JSON Schema（契约机器可读形态，存入 `src/shared/schema/plan-schema.json`）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "com.qore.trace/plan/v1",
  "title": "Trace Plan File v1",
  "type": "object",
  "required": ["format_version", "created_at", "updated_at", "components"],
  "properties": {
    "format_version": { "const": "1" },
    "created_at": { "type": "string" },
    "updated_at": { "type": "string" },
    "children_order": { "type": ["array", "null"], "items": { "type": "string" } },
    "components": { "type": "array", "items": { "$ref": "#/$defs/component" } }
  },
  "$defs": {
    "component": {
      "type": "object",
      "required": ["id", "type", "payload"],
      "properties": {
        "id": { "type": "string", "pattern": "^[0-9a-f]{32}$" },
        "type": { "enum": ["single_plan", "multi_plan", "task_list", "task_detail", "note"] },
        "payload": { "type": "object" }
      }
    }
  }
}
```

> payload 内部进一步约束（各类型字段表见 5.2）；读取方以 "未知字段容忍 + 未知 type 降级" 为最低契约。

---

## 6. 索引设计 Index Design

### 6.1 索引策略 Index Strategy

| 索引项 Index Item | 范围 Scope | 说明 Description |
|------------------|-----------|----------------|
| 主索引 Primary | 计划路径 | 内存树对象（懒加载子树） |
| 唯一约束 Unique | 计划：同级文件夹名唯一 | 应用层校验（R-007），文件系统层面为物理路径唯一 |
| 检索索引 Search | 计划名 + 任务 title/note + 注释 content | FlexSearch 候选内存索引；`index.json` 缓存可重建（损坏仅重建，不损数据） |
| 快速索引 Quick | `updated_at`（树缓存失效判定）/ `status`（状态列表） | 内存索引增量维护 |

### 6.2 索引清单 Index List

| 索引名 Index Name | 类型 Type | 字段 Fields | 说明 Description |
|----------------|-------------|-----------|---------------|
| tree_cache | 内存 | path/name/children/children_order | 树枚举缓存（懒加载） |
| search_index | FlexSearch | plan_name / task_title / task_note / note_content | 检索索引（含 path 映射） |
| status_index | 内存 | plan_path/component_id/task_id/status | 状态筛选（v1.1 高级筛选复用） |
| meta_ver | 文件 | format_version | 契约版本校验（升级判定） |

### 6.3 索引优化建议 Index Optimization

| 优化项 Optimization | 建议 Recommendation |
|------------------|-------------------|
| 缓存失效 | 变更事件精确失效（路径级），避免全量刷新；外部变动由 chokidar 事件驱动 |
| 索引重建 | `index.json` 损坏 → 自动全量重建（≤1s 规模承诺）；不阻塞浏览（降级提示） |
| 写放大控制 | `plan.json` 整写（单计划单文件），防抖 500ms 合并（组件局部编辑不触发整库重扫） |
| 检索规模 | ≤1000 计划/10000 任务：内存索引持续秒级可接受；超限再评估（技术选型报告 §5.4） |

---

## 7. 分区与归档 Partition & Archive

### 7.1 分区策略 Partition Strategy

**不适用**：无数据库表，无分区需求。等价物：

| 场景 Scenario | 策略 Strategy |
|-------------|--------------|
| 数据规模分隔 | 计划库文件树天然分层（根目录 → 计划 → 子计划），无需额外分区 |
| 冷热数据 | 不做冷热分层（规模内全量常驻内存可承受） |

### 7.2 归档与备份 Archive & Backup

| 场景 Scenario | 机制 Mechanism |
|-------------|-------------|
| 备份 | 整库拷贝 = 备份（明文件承诺）；用户文档/手册给出拷贝路径与注意事项 |
| 归档（远期） | 计划库根目录整体复制即归档；不提供内置归档功能（v1.0 不做） |
| 删除保护 | 删除=二次确认（v1.0）；`.trash` 回收站 = v1.1 契约升级项 |

---

## 8. 数据字典 Data Dictionary

### 8.1 枚举值定义 Enum Definitions

#### 组件类型 Component Type

| 值 Value | 常量 Constant | 名称 Name | 说明 Description |
|---------|-------------|---------|---------------|
| single_plan | COMPONENT_SINGLE_PLAN | 单选计划 | 单一目标计划单片 |
| multi_plan | COMPONENT_MULTI_PLAN | 多选计划 | 多并列可选项计划单片 |
| task_list | COMPONENT_TASK_LIST | 任务列表 | 任务集合组件 |
| task_detail | COMPONENT_TASK_DETAIL | 任务详情 | 单任务详情组件 |
| note | COMPONENT_NOTE | 注释 | 自由文本备注块 |

#### 任务状态 Task Status

| 值 Value | 常量 Constant | 名称 Name | 说明 Description |
|---------|-------------|---------|---------------|
| not_started | STATUS_NOT_STARTED | 未开始 | 初始态 |
| in_progress | STATUS_IN_PROGRESS | 进行中 | 可回退 |
| done | STATUS_DONE | 完成 | 写入 completed_at |

#### 状态机 State Machine

```
not_started → in_progress → done（写入 completed_at）
      ↑             ↑            ↓
      └────── 允许回退（保留原完成时间记录？→ 定稿：回退清除 completed_at，时间线 v1.1 引入）──────┘
```

> 逾期 = 展示层计算（planned_at < 今天 且 status != done），不落盘。

### 8.2 字段约束说明 Field Constraints

| 约束项 Constraint | 规则 Rule |
|-----------------|----------|
| 名称长度 | 计划/任务 title ≤200；注释 content ≤20000 |
| 非法字符 | `\ / : * ? " < > |` 禁止（计划文件夹名） |
| 路径上限 | 受 Windows 路径/名称限制（长路径策略 02 LLD 评估；达到限制阻止创建并提示） |
| 时间格式 | ISO 8601 UTC；日期字段 `YYYY-MM-DD` |
| 空值语义 | 缺席 = 默认值（planned_at 缺席=无；done 默认 false） |

---

## 附录 Appendix

### 附录A：初始化脚本 Initialization Script（首次启动模拟）

首次启动（选定根目录后）创建：

```
<根>/.trace/plan-library.json          # {"format_version":"1","library_id":"<uuid>","created_at":"...","schema_info":["min","v1"]}
<根>/欢迎!.json? 否 —— 示例：不创建示例数据（纯净初始化）
```

空白库 = 根目录 + `.trace/`；第一个计划由用户创建。

### 附录B：测试数据 Test Data（样例集）

| 用例 Case | 内容 Content | 边界验证 |
|----------|-------------|---------|
| TC-01 | 全 5 类组件混合计划（含中英文、emoji、多行文本） | 渲染/检索/回溯 |
| TC-02 | 嵌套 3 级 + 深命名（100+ 字符） | 路径与树构建 |
| TC-03 | 空计划（components=[]） | 空态渲染 |
| TC-04 | 未知组件 type（注入 `type:"future_component"`） | 降级渲染且原 payload 保留 |
| TC-05 | 超额任务列表（单文件 3000 项） | 读性能/虚拟化 |
| TC-06 | 非法/损坏 JSON（截断） | 原子写不产生半写；损坏则拒读提示 |

### 附录C：格式升级与迁移规则 Format Migration Rules

1. `format_version` 为纯递增字符串（"1" → "2"…），库元数据为准
2. 升级流程：读取旧版本 → 备份（`.trace/migration/plan-library-<date>.json` 或整库提示） → 迁移脚本（幂等） → 写新版本 → 校验
3. 迁移失败回滚：备份恢复；迁移脚本重试
4. 兼容次序：**程序永远可读旧版本**（读旧迁移在写路径上先行）；未知字段/未知组件在编写时保留原样
5. 重大不兼容升级（如目录布局变更）：对外以"库迁移工具"交付（脚本），文档化步骤

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 数据库设计师 DB Designer | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 数据库管理员 DBA | -（单人项目，由设计师兼任） | - | - |
| 技术负责人 Tech Lead | HeYS-Snowe | 电子批准 | 2026-09-05 |

---

**文档结束 End of Document**
