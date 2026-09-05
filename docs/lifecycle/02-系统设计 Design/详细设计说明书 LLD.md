# 详细设计说明书 LLD (Low-Level Design)

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | 2026-09-05 |
| 最后修改 Last Modified | 2026-09-05 |
| 设计师 Designer | HeYS-Snowe |
| 对应HLD版本 HLD Version | v1.0.0 |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | 2026-09-05 | HeYS-Snowe | HeYS-Snowe | 初始版本 Initial Version（组件语义=草案基线，Spike 项显式标注） |

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

本文档为「溯源 Trace」实现提供直接依据：模块/类/接口/数据结构/算法/异常的落地设计。**前置约定：组件语义=草案基线（用户"使用中验证"策略，2026-09-05）；技术实现中标注 `[SPIKE]` 的项以开发首周 Spike 结论为准，接口层已预留。**

### 1.2 参考文档 References

| 文档名称 Document | 版本 Version |
|----------------|-------------|
| 概要设计说明书 HLD | v1.0.0 |
| 产品需求文档 PRD | v1.0.0 |
| 存储格式契约（数据库设计说明书） | v1.0.0（契约 v1） |
| 接口设计文档（IPC 白名单） | v1.0.0（契约 v1） |
| UI 设计规范 | v1.0.0 |
| 技术选型报告 | v1.0.0（Electron 44 / React 19 / antd 5 / TS 5） |

---

## 2. 模块详细设计 Module Detail Design

### 2.1 模块1：存储服务模块 Storage Module（主进程）

#### 2.1.1 模块概述 Module Overview

| 属性 Attribute | 值 Value |
|-------------|---------|
| 模块ID Module ID | M-001 |
| 模块名称 Module Name | StorageService |
| 负责人 Owner | HeYS-Snowe |
| 包 Package | `src/main/services/storage` |

#### 2.1.2 类图 Class Diagram

```
┌───────────────────────────────────────────────────────────────┐
│                     storage:channel 层（IPC 入口）              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ StorageIpc                                            │  │
│  │ + handle(c: Channel, p: Payload): Promise<TraceResult> │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                       StorageService                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ - repo: PlanRepository                                  │  │
│  │ - cache: TreeCache                                      │  │
│  │ - index: SearchIndexPort (接口，注入)                    │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ + treeGetChildren(parentPath)                          │  │
│  │ + createPlan / renamePlan / deletePlan / movePlan      │  │
│  │ + resortChildren / readPlan / savePlan                 │  │
│  │ + appendComponent / removeComponent / moveComponent    │  │
│  │ + updateTask                                           │  │
│  │ - validateName / validatePathSafe / validateStatus     │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                 PlanRepository（文件访问层）                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ + readPlan(path): PlanDocument                         │  │
│  │ + writePlanAtomic(path, doc): void  (tmp→fsync→rename) │  │
│  │ + readPlanLibrary(): PlanLibraryMeta                   │  │
│  │ + ensureRootStructure(rootDir)                         │  │
│  │ + listChildren(dir): DirEntry[]                        │  │
│  │ + mkdir / rename / rmRecursive / move                  │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

#### 2.1.3 时序图 Sequence Diagram

**保存计划 savePlan 时序（含 CAS）：**

```
渲染器           StorageIpc        StorageService      PlanRepository    SearchIndex
 │─ savePlan ───▶│                │                     │                │
 │                │─ validate ────▶│ (参数/路径/确认)     │                │
 │                │                │─ readPlan(prev) ──▶│                │
 │                │                │◀ prev ──────────────│                │
 │                │                │─ CAS: expected_updated_at == prev.updated_at? │
 │                │                │  └─ NO → code 22 ─────────────────────│
 │                │                │─ writePlanAtomic(updated) ────────────▶│
 │                │                │                                  ✓      │
 │                │                │─ notify(plan-changed) ──────────────────│─▶ index.add() ──▶
 │                │◀ TraceResult ─│                                    ✓      │
 │◀ TraceResult ─│                │                                    │      │
```

#### 2.1.4 核心流程 Core Flows

**创建计划 createPlan:**

```
BEGIN
  INPUT: parent_path, name
  ├─ 1. 校验: name 非空/≤255/非法字符 → code 20
  ├─ 2. 校验: parent_path 安全（resolve 后位于根目录内）→ code 11
  ├─ 3. 校验: 同级同名 → code 12
  ├─ 4. mkdir(parent/path/name)
  ├─ 5. writePlanAtomic(新 plan.json: {format_version:"1", created_at, updated_at, components:[]})
  ├─ 6. cache 失效(父路径) + 事件 plan-changed
  └─ 7. 返回 { path, name }
END
```

**删除计划 deletePlan:**

```
BEGIN
  INPUT: path, confirmed
  ├─ 1. confirmed !== true → code 24
  ├─ 2. 路径安全校验 → code 11；存在性 → code 10
  ├─ 3. rmRecursive（含子文件夹；App 内无引用完整性负担）
  ├─ 4. cache/index 失效（路径前缀 → 全部） + 事件
  └─ 5. 返回 ok
END
```

**移动 plan movePlan（含循环校验）：**

```
BEGIN
  INPUT: path, target_parent_path, order_index
  ├─ 1. isDescendant(target, path): 目标 ∈ 自身/子孙 → code 13
  ├─ 2. 物理 move（同盘 rename；跨盘 [SPIKE-3: 移动策略，默认拒绝+提示]）
  ├─ 3. 更新 父/新父 children_order
  ├─ 4. cache/index 增量 + 事件
  └─ 5. 返回 ok
END
```

### 2.2 模块2：检索服务模块 Search Module（主进程）

#### 2.2.1 模块概述 Module Overview

| 属性 Attribute | 值 Value |
|-------------|---------|
| 模块ID Module ID | M-002 |
| 模块名称 Module Name | SearchService |
| 负责人 Owner | HeYS-Snowe |
| 包 Package | `src/main/services/search` |

#### 2.2.2 类图 Class Diagram

```
┌───────────────────────────────────────────────────────────────┐
│                        SearchService                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ - index: FlexSearchPort（接口；[SPIKE-1] 实现注入）      │  │
│  │ - mountedDocs: Map<hitKey, DocRef>                      │  │
│  │ - state: "building"|"ready"|"error"                     │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ + buildFull()   : 启动/重建（进度事件）                   │  │
│  │ + applyChange(path, kind) : 增量（事件驱动）              │  │
│  │ + query(keywords): SearchResult[]                       │  │
│  │ + locate(hit): LocateRef                                 │  │
│  │ + persist() : 写 index.json                             │  │
│  │ + restore() : 读 index.json（损坏→重建）                 │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

#### 2.2.3 时序图 Sequence Diagram

**检索 query + 回溯 locate：**

```
渲染器          SearchService        Index(FlexSearch)      StorageService
 │─ query ────▶│                    │                      │
 │             │─ state ready? ─────│                      │
 │             │─ search(kw) ──────▶│                      │
 │             │◀ hits ─────────────│                      │
 │             │─ 组装(含 path/component_id/task_id) ──────────────────────────▶ 读取映射（缓存）
 │◀ hits ──────│                    │                      │
 │─ locate ───▶│─ resolveHit ───────────────────────────────▶ readPlan(path)
 │◀ locateRef ─│─ (path + component_id + snippet)           │
```

#### 2.2.4 核心流程 Core Flows

**增量维护 applyChange:**

```
BEGIN
  INPUT: { path, kind: created|changed|removed }
  ├─ removed → index.removeByPathPrefix(path)；mountedDocs.delete
  ├─ created/changed → readPlan(path) → 提取索引项（plan_name/task_title/task_note/note_content）
  │   └─ 索引项 attach: path + component_id + task_id（回溯锚点）
  ├─ 持久化（防抖 5s 合并，后台）
  └─ 状态: index 大小≤上限（1000×…）保持 ready
END
```

---

### 2.3 模块3：渲染器界面模块 Renderer Module（渲染进程）

#### 2.3.1 模块概述 Module Overview

| 属性 Attribute | 值 Value |
|-------------|---------|
| 模块ID Module ID | M-003 |
| 模块名称 Module Name | Renderer UI |
| 负责人 Owner | HeYS-Snowe |
| 包 Package | `src/renderer/` |

#### 2.3.2 类图 Class Diagram

```
┌───────────────────────────────────────────────────────────────┐
│ App 组件树（React）                                            │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ │
│  │ PlanTree    │ │ Content     │ │ SearchPanel │ │ Onboard    │ │
│  │ (antd Tree) │ │ (组件渲染区) │ │             │ │ 引导页      │ │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ │
│        │              │              │              │        │
│  ┌─────┴──────────────┴──────────────┴──────────────┴──────┐ │
│  │   Stores（Zustand）：treeStore / planStore / searchStore  ││
│  │   / appStore（bootstrap/索引/保存状态）                    ││
│  └──────────────────────────┬───────────────────────────────┘│
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ ipc-client（唯一 IPC 调用层，类型=契约）                   │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

#### 2.3.3 核心流程 Core Flows

**组件渲染器 dispatch（渲染即编辑）：**

```
BEGIN
  INPUT: component { type, payload }
  ├─ type=single_plan  → SinglePlanCard
  ├─ type=multi_plan   → MultiPlanCard（选项增删 + 独立勾选 + 已选 x/n）
  ├─ type=task_list    → TaskListCard（行三态 + 勾选 + 排序 [SPIKE-2]）
  ├─ type=task_detail  → TaskDetailCard（五字段 + 状态）
  ├─ type=note         → NoteBlock（引用样式）
  └─ unknown           → FallbackBlock（降级占位 + 警标；payload 原样）
END
```

**编辑保存（防抖 + 局部刷新）：**

```
组件编辑 → onChange → 编辑态本地更新（即时）
  └─ 500ms 防抖 → ipc storage:savePlan(document, expected_updated_at)
       → 成功: trace:save-status(已保存) + store 更新 updated_at
       → code 22: 拉取最新 → 合并提示（"内容将在保存后刷新"）
END
```

---

## 3. 类设计 Class Design

### 3.1 实体类设计 Entity Classes（=契约类型，`src/shared/`）

#### plan-types.ts（契约 v1）

```ts
// 存储契约 v1（数据库设计说明书 §5.2）——渲染/主进程共享
export type ComponentType = "single_plan" | "multi_plan" | "task_list" | "task_detail" | "note";
export type TaskStatus = "not_started" | "in_progress" | "done";

export interface PlanDocument {
  format_version: "1";
  created_at: string;          // ISO8601 UTC
  updated_at: string;          // CAS 锚点
  children_order?: string[];   // 缺席=按名升序
  components: Component[];
}

export interface Component {
  id: string;                  // uuid32
  type: ComponentType;
  payload: ComponentPayload;
}
export type ComponentPayload =
  | { title: string; done: boolean; summary?: string; created_at: string }            // single_plan
  | { title: string; summary?: string; options: Option[] }                             // multi_plan
  | { title: string; items: TaskItem[] }                                               // task_list
  | { title: string; description?: string; planned_at?: string; status: TaskStatus;    // task_detail
      completed_at?: string; note?: string; created_at: string }
  | { content: string; created_at: string };                                           // note
export interface Option { id: string; text: string; checked: boolean }
export interface TaskItem { id: string; title: string; status: TaskStatus; planned_at?: string; completed_at?: string; note?: string }
```

#### ipc-contract.ts（通道/载荷/结果）

```ts
export type TraceResult<T> =
  | { ok: true; code: 0; message: "ok"; data: T }
  | { ok: false; code: number; message: string; data: null };

export interface Channels {
  "app:getAppInfo": { req: void; res: AppInfo };
  "app:bootstrap": { req: void; res: BootstrapInfo };
  "app:setRootDir": { req: { dirPath: string; confirmed: boolean }; res: { rootDir: string } };
  "app:reportError": { req: { context: string; message: string; stack?: string }; res: null };
  "storage:treeGetChildren": { req: { parent_path: string }; res: PlanTreeNode[] };
  "storage:createPlan": { req: { parent_path: string; name: string }; res: PlanTreeNode };
  "storage:renamePlan": { req: { path: string; new_name: string }; res: { path: string } };
  "storage:deletePlan": { req: { path: string; confirmed: boolean }; res: null };
  "storage:movePlan": { req: { path: string; target_parent_path: string; order_index: number }; res: null };
  "storage:resortChildren": { req: { parent_path: string; ordered_names: string[] }; res: null };
  "storage:readPlan": { req: { path: string }; res: PlanDocument };
  "storage:savePlan": { req: { path: string; document: PlanDocument; expected_updated_at: string }; res: { updated_at: string } };
  "storage:appendComponent": { req: { path: string; component: Component }; res: null };
  "storage:removeComponent": { req: { path: string; component_id: string }; res: null };
  "storage:moveComponent": { req: { path: string; component_id: string; target_index: number }; res: null };
  "storage:updateTask": { req: { path: string; component_id: string; task_id: string; patch: { status?: TaskStatus; title?: string; planned_at?: string; note?: string } }; res: null };
  "search:query": { req: { keywords: string[] }; res: SearchHit[] };
  "search:getStatus": { req: void; res: IndexStatus };
  "search:rebuildIndex": { req: { confirmed: boolean }; res: null };
  "config:get": { req: { key: string }; res: unknown };
  "config:set": { req: { key: string; value: unknown }; res: null };
}
```

### 3.2 DTO类设计 DTO Classes

| DTO | 用途 | 字段（摘要） |
|-----|------|-------------|
| `PlanTreeNode` | 树节点（懒加载子级） | `{ path, name, has_children, order }` |
| `SearchHit` | 检索命中项 | `{ scope: "plan"|"task"|"note", path, component_id?, task_id?, snippet, matched_field }` |
| `LocateRef` | 回溯定位载荷 | `{ path, component_id?, snippet }` |
| `IndexStatus` | 索引状态 | `{ state: "building"|"ready"|"error", indexed_plans, last_built_at }` |
| `AppInfo / BootstrapInfo` | 应用信息 | 版本/根目录/索引状态/根目录失效标记 |

### 3.3 服务类设计 Service Classes（主进程）

#### SearchPort（接口，[SPIKE-1] 注入实现）

```ts
export interface SearchPort {
  add(doc: IndexDoc, tags: string[]): void;     // tags=字段名（分词字段由实现决定）
  removeByPathPrefix(path: string): void;
  search(keywords: string[]): Array<{ id: string; match: string; field: string }>;
  persist(): Promise<void>;
  load(): Promise<boolean>;                      // false=损坏/缺失 → 全量重建
}
// IndexDoc: { id: hitKey, path, component_id?, task_id?, plan_name, task_title, ... 可检索字段 }
```

#### PlanRepository（文件访问层）

```ts
export interface PlanRepository {
  readPlan(path: string): Promise<PlanDocument>;         // 坏文件 → throw ErrFormat(14)
  writePlanAtomic(path: string, doc: PlanDocument): Promise<void>;
  listChildren(parentPath: string): Promise<DirEntry[]>;
  mkdir / rename / rmRecursive / move(path...): Promise<void>;
}
```

---

## 4. 接口详细设计 API Detail Design

> 通道清单/参数/错误码以《接口设计文档》为准（本设计不重复全表）；此处展开**实现层关键契约**三条。

### 4.1 storage:savePlan（CAS 防冲突）

**请求 Request:**

| 字段 Field | 类型 Type | 必填 Required | 验证规则 Validation |
|----------|---------|------------|-------------------|
| path | String | 是 | 根目录内（resolve 前缀） |
| document | PlanDocument | 是 | 契约 Schema 校验（格式 v1） |
| expected_updated_at | String | 是 | 与磁盘 `updated_at` 精确匹配 |

**处理过程：** 读当前文件 → 若 `updated_at !== expected_updated_at` → code 22 → 否则写（原子）→ 更新 `updated_at` → 返回新值。渲染器收到 22 时重取并提示。

### 4.2 storage:updateTask（状态机）

| 字段 Field | 类型 Type | 验证规则 Validation |
|----------|---------|-------------------|
| patch.status | TaskStatus | 邻接规则：not_started↔in_progress↔done；done→写 completed_at；回退→清除 completed_at |
| patch.title/planned_at/note | 任意 | 长度/格式校验（§7 表） |

### 4.3 search:locate（回溯）

`search:query` 返回的 Hit 已携带 `path + component_id + task_id`；渲染器回放= `treeStore.expandTo(path)` + `planStore.open(path, locateAnchor)` + 组件高亮（UI 规范：Primary 30% 描边渐隐 2s）。

---

## 5. 数据结构详细设计 Data Structure Design

### 5.1 计划库文件结构（契约 v1，已在 DB 设计说明书定稿）

| 结构 Structure | 内容 Content | 说明 Notes |
|--------------|-------------|----------|
| `<root>/.trace/plan-library.json` | 库元数据（format_version/library_id/created_at） | 根契约版本载体 |
| `<root>/<计划文件夹>/plan.json` | PlanDocument | 每计划一文件（读=整读，写=原子整写） |
| `<root>/<计划文件夹>/<子文件夹>/plan.json` | 嵌套子计划 | 任意层级 |

### 5.2 内存缓存结构 Cache Data Structure

**TreeCache（进程内）：**

```
Key: parent_path（绝对规范化）
Value: DirEntry[]  { name, fullPath, isDir, hasChildren, order }
失效：create/rename/delete/move/resort → 相关路径级失效
```

**IndexCache（进程内 + index.json）：**

```
元数据: { format_version:"1", built_at, doc_count }
文档:   { id: hitKey, path, component_id?, task_id?, fields: string[] }
/ 实现细节由 SearchPort 决定（FlexSearch 序列化格式 [SPIKE-1] 锁定）
```

**文档读取缓存 ContentCache（LRU，上限 200 项）：**

```
Key: path → { document: PlanDocument, updated_at }
失效：savePlan/外部 change/remove
```

### 5.3 配置结构 app config.json

```json
{
  "format_version": "1",
  "root_dir": "D:\\Plans\\Trace",
  "window": { "width": 1200, "height": 800, "maximized": false },
  "ui": { "zoom_factor": 1.0, "tree_width": 280 }
}
```

---

## 6. 算法设计 Algorithm Design

### 6.1 原子写 Atomic Write

```
BEGIN
  INPUT: dirPath, fileName, document
  ├─ 1. tmpName = `.${fileName}.${process.pid}.${crypto.randomUUID().slice(0,8)}.tmp`
  ├─ 2. writeFile(tmpPath, JSON.stringify(document, null, 2), {encoding:"utf8"})
  ├─ 3. fsync(tmpFileHandle)（Windows 下 file.sync()）
  ├─ 4. rename(tmpPath, targetPath)（同目录 = 原子）
  ├─ 5. 失败清理 tmp（finally）
  └─ 6. 更新进程态 updated_at
END
保证：崩溃/断电 → 目标文件要么旧要么新，无半写（容灾方案见 HLD §8.3）
```

### 6.2 循环嵌套校验 Circular Check

```
BEGIN
  INPUT: targetParent, movingPath
  ├─ 1. 若 targetParent 为空（根层）→ 允许
  ├─ 2. walked = targetParent（规范化）
  └─ 3. WHILE walked != "" :
        IF walked == movingPath → code 13（拖入自身/子孙）
        walked = dirname(walked)
END（O(深度)，≤路径上限）
```

### 6.3 任务状态机 Task Status Machine

```
BEGIN
  INPUT: current, patch
  ├─ transitions = { not_started:[in_progress], in_progress:[not_started,done], done:[in_progress] }
  └─ IF patch ∉ transitions[current] → code 21
END
（done: completed_at = now UTC → 回退时清空 completed_at）
```

### 6.4 检索实现 [SPIKE-1]

| 项 Item | 计划 A：FlexSearch | 计划 B：退化方案（内存扫包含匹配） |
|--------|-------------------|--------------------------------|
| 原理 | 自定义 tokenizer（中文按字/词 [SPIKE-1 定]） | 预提取字段 → `includes()`（小写化） |
| 复杂度 | O(索引) | O(全字段扫描)，万级文档毫秒级 |
| 判定基准 | 中文示例集检索命中率 100%（TC-01/TC-04 用例） | 同上 |
| 决策点 | **Spike 首日（开发周 D1-D2）**；接口 `SearchPort` 已隔离，换实现不动服务层 | 同 |

### 6.5 防抖保存 Debounced Save

```
编辑器 onChange → 刷新编辑态（响应即时）
  └─ 防抖 500ms → savePlan（带 updated_at CAS）
       └─ 期间再有变更 → 重置定时器（合并）
END（用户感知：状态栏"编辑中/已保存"）
```

### 6.6 路径安全校验 Path Safety Check

```
BEGIN
  INPUT: p
  ├─ 1. abs = path.resolve(rootDir, p)
  ├─ 2. abs 必须以 rootDir 开头（或 abs == rootDir）→ 否则 code 11
  └─ 3. 校验名称段（非法字符/长度）→ code 20
END（所有 storage:*/search: 通道入口统一执行）
```

### 6.7 逾期判定 Overdue Calculation

```
IF planned_at 存在 且 planned_at < 今天(本地日期) 且 status != done → 标记逾期（展示层，不写盘）
END
```

### 6.8 组件/任务 id 生成 UUID

```
crypto.randomUUID().replace(/-/g, "")  // uuid32（契约 pattern 匹配）
END
```

---

## 7. 异常处理设计 Exception Handling

### 7.1 异常层次结构 Exception Hierarchy

```
TraceError（基类：code/message/userMessage）
  ├── ValidationError(20)        参数/名称/格式
  ├── PathUnsafeError(11)        路径越界/只读
  ├── NotFoundError(10)          路径不存在
  ├── ConflictError(12/22)       重名 / CAS 冲突
  ├── CircularError(13)          循环嵌套
  ├── FormatError(14)            契约损坏
  ├── IoError(15)                保存失败（可重试）
  ├── StateMachineError(21)      状态机拒绝
  ├── IndexNotReady(23)          索引未就绪
  ├── ConfirmationError(24)      需确认
  └── InternalError(50)          兜底
```

### 7.2 异常处理流程 Exception Handling Flow

```
异常抛出
  │
  ▼
IPC 入口统一包装（wrapHandler）
  ├─ 记录日志（脱敏：异常类型/通道/路径，不含 plan 正文）
  ├─ 映射 trace error → TraceResult{ok:false, code, message}
  └─ 未知异常 → InternalError(50) + 界面友好提示
```

### 7.3 错误码定义 Error Code Definition

| 错误码 Error Code | 类型 Type | 消息 Message | 触发示例 Example |
|----------------|-----------|-------------|---------------|
| 10 | NOT_FOUND | 目标位置不存在 | 计划被外部删除 |
| 11 | PATH_UNSAFE/READONLY | 目录不可用或路径越界 | 只读盘/../遍历 |
| 12 | NAME_CONFLICT | 同名文件夹已存在 | 新建重名 |
| 13 | CIRCULAR_NESTING | 不能移动到自身或子计划 | 拖拽循环 |
| 14 | FORMAT_INVALID | 内容格式异常（降级显示） | plan.json 损坏 |
| 15 | SAVE_FAILED | 保存失败（内容保留可重试） | IO 临时失败 |
| 20 | VALIDATION | 参数校验失败 | 名称超长/非法字符 |
| 21 | STATE_MACHINE | 任务状态不允许 | 非法状态跳变 |
| 22 | CONFLICT | 数据已被修改（请刷新重试） | CAS 冲突 |
| 23 | INDEX_NOT_READY | 索引构建中（完成后自动补查） | 首次启动 |
| 24 | CONFIRMATION_REQUIRED | 危险操作需确认 | 删除未带 confirm |
| 50 | INTERNAL | 内部错误（已记录日志） | 兜底 |

---

## 附录 Appendix

### 附录A：代码规范 Code Standards

| 规范项 Standard | 规范内容 Specification |
|--------------|---------------------|
| 命名规范 Naming | TS：camelCase 变量/方法，PascalCase 类/接口；枚举常量 SCREAMING_SNAKE；文件 kebab-case |
| 注释规范 Comment | 公共契约类型/服务方法 JSDoc；中文注释；执行 `D:\Code\.Rules\common\core\code-style.md` §5.2（TS） |
| 异常处理 Exception | 业务异常 throw TraceError（带 code）；IPC 层统一包装（§7.2） |
| 日志规范 Logging | 主进程 console+文件；脱敏规则（不含计划正文）；renderer 仅 console |
| lint | ESLint + Prettier（electron-vite 生成配置即可）；TS strict 开启 |

### 附录B：单元测试规范 Unit Test Standards

| 测试类型 Test Type | 覆盖要求 Coverage | 工具 |
|-----------------|-----------------|------|
| Service 层（存储/检索） | ≥ 80%（纯逻辑，mock fs） | vitest |
| 算法（状态机/循环校验/路径安全/逾期） | 100%（表驱动用例） | vitest |
| 契约类型 | 编译期（tsc strict） | - |
| Renderer 组件 | 关键路径（树/渲染/编辑） | vitest + RTL（可选） |
| IPC 集成 | 通道冒烟（electron 启动后 invoke 各通道） | M5 手工/脚本 |

### 附录C：Spike 验证清单（开发首周）

| ID ID | 验证项 Item | 判定 Criteria | 影响 Impact |
|-------|-----------|--------------|-----------|
| SPIKE-1 | 检索实现：FlexSearch 中文分词 vs 内存扫包含 | 中文检索命中率 100%（快照样例）；≤1s | 锁定 SearchPort 实现 |
| SPIKE-2 | 树拖拽：antd Tree 内建 vs dnd-kit 自建 | 跨层移动+插入线+循环红显 完整可用 | 锁定 M-003 树组件实现 |
| SPIKE-3 | 跨盘移动/超长路径策略 | Windows 实测（<260 限制与长路径开关） | 移动语义细化 |
| SPIKE-4 | 本地搜索高亮/IO 性能基准 | 万级任务场景冷启动/检索实测 | 校准 §1.1 性能承诺 |

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 设计师 Designer | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 开发负责人 Dev Lead | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 代码审查人 Reviewer | HeYS-Snowe | 电子批准 | 2026-09-05 |

---

**文档结束 End of Document**
