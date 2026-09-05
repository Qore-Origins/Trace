# 接口设计文档 API Design Document（进程内 IPC 白名单契约）

> 本项目无服务端接口（本地单机、无网络功能）。本文档定义 **渲染进程 ↔ 主进程的 IPC 契约**：白名单通道、参数/返回结构、错误码与事件。以 `src/shared/ipc-contract.ts` 为类型实现层。

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | 2026-09-05 |
| 最后修改 Last Modified | 2026-09-05 |
| 接口设计师 API Designer | HeYS-Snowe |
| 基础URL Base URL | 无（无 HTTP；进程内 IPC） |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | 2026-09-05 | HeYS-Snowe | HeYS-Snowe | 初始版本 Initial Version（IPC 白名单契约 v1） |

---

## 目录 Table of Contents

1. [接口概述 API Overview](#1-接口概述-api-overview)
2. [接口规范 API Specifications](#2-接口规范-api-specifications)
3. [通用接口 Common APIs](#3-通用接口-common-apis)
4. [存储模块 APIs](#4-存储模块-apis)
5. [检索模块 APIs](#5-检索模块-apis)
6. [配置与应用 APIs](#6-配置与应用-apis)
7. [错误码定义 Error Codes](#7-错误码定义-error-codes)

---

## 1. 接口概述 API Overview

### 1.1 接口设计原则 Design Principles

| 原则 Principle | 说明 Description |
|--------------|---------------|
| 白名单最小暴露 | 渲染器只能调用 preload 显式暴露的方法；主进程不暴露原始 `fs`/`ipcRenderer`（Electron 默认 `contextIsolation: true` / `nodeIntegration: false`） |
| 命名空间化 | 通道按模块命名空间（`app.*` / `storage.*` / `search.*` / `config.*`），避免散乱 |
| 类型安全 | 全部 API 以 `src/shared/ipc-contract.ts` 定义 TS 类型，渲染器/主进程引用同一契约 |
| 统一返回 | 全部请求-响应遵循统一 `TraceResult<T>` 信封（见 2.2） |
| 主进程权限 | 所有路径/参数在主进程侧校验（渲染器输入不可信）；破坏性操作需显式确认标志 |
| 事件单向 | 推送类消息（索引进度/外部变更/保存状态）由主进程单向推送给渲染器（事件通道，见 2.4） |
| 无 REST | 本应用无 HTTP 层；REST/GraphQL/gRPC 均不适用（本文档替换标准 API 设计模板） |

### 1.2 通用规范 General Specifications

| 规范项 Specification | 规范内容 Content |
|-------------------|----------------|
| 协议 Protocol | Electron IPC（contextBridge + ipcRenderer.invoke / 事件） |
| 数据形式 Data Format | 结构化克隆（可序列化 JSON） |
| 字符编码 Charset | UTF-8 |
| 时间格式 DateTime | ISO 8601 UTC（与存储契约一致） |
| 布尔值 Boolean | true / false（JSON 原生） |
| 路径表示 Path | 相对计划库根目录（`/` 分隔）；越界路径一律拒绝（code 11） |

### 1.3 接口分类 API Categories

| 分类 Category | 前缀 Prefix | 说明 Description |
|------------|-----------|---------------|
| 通用接口 Common | `app.*` | 启动/引导/状态 |
| 存储接口 Storage | `storage.*` | 计划树/计划/组件/任务读写 |
| 检索接口 Search | `search.*` | 检索/回溯/索引状态 |
| 配置接口 Config | `config.*` | 应用参数（窗口状态等） |
| 事件通道 Events | `trace:*` | 主进程 → 渲染器单向推送 |

---

## 2. 接口规范 API Specifications

### 2.1 请求规范 Request Specification

#### 调用方式 Call Pattern

```ts
// 渲染器（经 preload 暴露）：
const res = await window.trace.storage.createPlan({ parent_path: "", name: "新学期" });
// 等价 IPC：ipcRenderer.invoke('storage:createPlan', { ... })
```

| 通道 Channel | 是否暴露给渲染器 Exposed | 说明 Description |
|-----------|------------------------|---------------|
| `app:getAppInfo` | 是 | 应用/库/索引状态快照 |
| 其余按模块（见 §3-§6） | 是 | 逐条白名单；未列入的一律不暴露 |

#### 参数校验 Parameter Validation

| 校验项 Item | 规则 Rule | 违规响应 Violation |
|----------|----------|-----------------|
| 路径 Safety | resolve 后必须位于根目录内 | code 11 |
| 名称 Name | 非空/≤255/禁非法字符 | code 20 |
| 破坏性标志 | `deletePlan`/`set_root_dir` 须传 `confirmed: true` | code 24 |
| 状态机 | `update_task` 状态变更合法（三态邻接） | code 21 |
| 并发快照 | `savePlan` 需携带 `expected_updated_at`（CAS） | code 22 |

### 2.2 响应规范 Response Specification

#### 统一响应结构 Unified Response Structure（`TraceResult<T>`）

```ts
type TraceResult<T> =
  | { ok: true; code: 0; message: "ok"; data: T }
  | { ok: false; code: number; message: string; data: null };
```

| 字段 Field | 类型 Type | 说明 Description |
|----------|---------|---------------|
| ok | Boolean | 成功标志 |
| code | Integer | 0=成功，其余=错误码（§7） |
| message | String | 用户可读消息（中文） |
| data | T/null | 载荷 |

> 无分页结构（本地内存/文件读取，一次性返回；规模上限内无需分页）。

### 2.3 认证授权 Authentication & Authorization

| 领域 Area | 方案 Scheme |
|----------|----------|
| 认证 | 不适用：单机单用户、无账号体系 |
| 授权 | 不适用：单用户（文件系统权限之外无授权层） |
| 等价物 = IPC 加固 | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`；preload 仅暴露白名单 API（本契约为唯一通道表） |

### 2.4 事件通道 Event Channels（主进程 → 渲染器）

| 事件 Event | 载荷 Payload | 说明 Description |
|-----------|-------------|---------------|
| `trace:index-status` | `{ state: "building"|"ready"|"error"; progress?: number }` | 索引进度（首次/重建时推送） |
| `trace:fs-external-change` | `{ paths: string[]; type: "created"|"changed"|"removed" }` | 计划库被外部工具修改 |
| `trace:save-status` | `{ path: string; saved: boolean; at: string }` | 保存结果反馈（状态栏） |
| `trace:plan-changed` | `{ path: string }` | 某计划变更（供渲染器局部刷新） |

---

## 3. 通用接口 Common APIs

### 3.1 应用信息应用获值 App Info

#### `app:getAppInfo`  请求载荷: `null`

**响应 Response:**

```json
{
  "ok": true, "code": 0, "message": "ok",
  "data": {
    "appVersion": "1.0.0",
    "formatVersion": "1",
    "rootDir": "D:\\Plans\\Trace",
    "rootConfigured": true,
    "indexStatus": { "state": "ready" }
  }
}
```

### 3.2 启动引导 Bootstrap

#### `app:bootstrap`  请求载荷: `null`

| 场景 Scenario | 处理 Logic |
|-----------|----------|
| 正常 | 返回 AppInfo（见上） |
| 根目录未配置 | `rootConfigured:false` → 渲染器引导页（取 `app:setRootDir`） |
| 根目录失效（路径被删） | `rootConfigured:true` + 根目录校验标记 `rootInvalid:true` → 引导重选（不删数据） |

### 3.3 设置根目录 Set Root Dir

#### `app:setRootDir`

**请求载荷 Request:**

```json
{ "dirPath": "D:\\Plans\\Trace", "confirmed": true }
```

**处理逻辑 Logic:**

| 条件 Condition | 结果 Result |
|--------------|-----------|
| 首次（未配置） | 校验可写 → 创建 `.trace/` → 生效 |
| 切换（已配置） | `confirmed` 必须为 true（提示不迁移）→ 校验 → 生效；旧库数据不动 |
| 校验失败 | code 11（路径不可用） |

**响应:** `TraceResult<{ rootDir: string }>`

---

## 4. 存储模块 APIs

### 4.1 树枚举 Tree Browse（懒加载）

#### `storage:treeGetChildren`

**请求载荷 Request:**

```json
{ "parent_path": "" }
```

`parent_path` 为空 = 根层（列出全部顶层计划）。响应含：名称、路径、是否为计划（含子计划指示）、名称排序序号。

**响应:** `TraceResult<Array<{ path: string; name: string; has_children: boolean; order: number }>>`

### 4.2 计划创建 Plan Create

#### `storage:createPlan`

**请求载荷 Request:**

```json
{ "parent_path": "", "name": "2026-A 学期" }
```

| 校验 Check | 违规 Violation |
|----------|--------------|
| 名称合法性（非空/≤255/非法字符） | code 20 |
| 同级重名 | code 12 |
| 父路径不存在 | code 10 |

**处理 Logic:** 物理创建文件夹 + `plan.json`（空组件）→ 返回新计划元数据。

### 4.3 计划重命名 Rename

#### `storage:renamePlan`

```json
{ "path": "2026-A 学期", "new_name": "2026-A2 学期" }
```

处理：物理重命名文件夹；更新父级 `children_order`；索引增量（路径映射更新）。违规：code 12（重名）/ code 20。

### 4.4 计划删除 Delete

#### `storage:deletePlan`

```json
{ "path": "2026-A 学期", "confirmed": true }
```

处理：递归删除（文件夹树）；`confirmed` 缺失 → code 24。**无撤销（v1.0）；v1.1 `.trash`（契约升级后）**。

### 4.5 拖拽移动与排序 Move & Order

#### `storage:movePlan`

```json
{ "path": "2026-A 学期", "target_parent_path": "旧计划", "order_index": 0 }
```

| 校验 Check | 违规 Violation |
|----------|--------------|
| 循环嵌套（目标为自身/子孙） | code 13 |
| 目标父路径存在 | code 10 |

处理：物理移动文件夹；更新两处 `children_order`；索引增量。

#### `storage:resortChildren`

```json
{ "parent_path": "2026-A 学期", "ordered_names": ["B", "A", "C"] }
```

处理：仅更新父级 `children_order`（同层排序，不移动物理目录）。

### 4.6 计划读取 Read Plan

#### `storage:readPlan`

```json
{ "path": "2026-A 学期" }
```

**响应:** `TraceResult<PlanDocument>`（契约见数据库设计说明书 §5.2：`format_version/created_at/updated_at/children_order/components`）。

### 4.7 组件级更新 Component Updates

> 组件/任务的增删改在渲染器侧完成编辑态后，经以下通道提交（主进程原子写，含 CAS 防冲突）。

#### `storage:savePlan`

```json
{ "path": "2026-A 学期", "document": { "...PlanDocument 完整" }, "expected_updated_at": "2026-09-05T12:30:00Z" }
```

| 校验 Check | 违规 Violation |
|----------|--------------|
| `expected_updated_at` 与磁盘快照不一致 | code 22（重新拉取合并） |
| 组件结构校验（type 枚举/字段） | code 20 |

处理：校验 → 原子写（临时文件 + rename）→ 推送 `trace:plan-changed` + `trace:save-status` → 索引增量。

#### `storage:appendComponent` / `storage:removeComponent` / `storage:moveComponent`

便捷通道（内部实现 = 读-改-原子写三明治，主进程保证互斥）：

| 通道 Channel | 载荷 Payload |
|-------------|-------------|
| `storage:appendComponent` | `{ path, component }` |
| `storage:removeComponent` | `{ path, component_id }` |
| `storage:moveComponent` | `{ path, component_id, target_index }` |

#### `storage:updateTask`

```json
{ "path": "…", "component_id": "…", "task_id": "…", "patch": { "status": "done" } }
```

| 校验 Check | 违规 Violation |
|----------|--------------|
| 状态机邻接（三态） | code 21 |
| 任务不存在 | code 10 |

处理：状态变更 + `completed_at` 维护（done 写入；回退清除）→ 原子写 + 索引增量。

---

## 5. 检索模块 APIs

### 5.1 关键词检索 Search Query

#### `search:query`

**请求载荷 Request:**

```json
{ "keywords": ["周计划", "溯源"] }
```

**响应 Response:**

```json
{
  "ok": true, "code": 0, "message": "ok",
  "data": {
    "hits": [
      { "scope": "plan",  "path": "2026-A 学期", "snippet": "2026-A 学期", "matchedField": "plan_name" },
      { "scope": "task",  "path": "Trace 开发计划", "component_id": "c7f6…", "task_id": "a1", "snippet": "…技术选型…", "matchedField": "task_title" },
      { "scope": "note",  "path": "Trace 开发计划", "component_id": "…", "snippet": "…评审前置…", "matchedField": "note_content" }
    ]
  }
}
```

| 说明 Item | 规则 Rule |
|----------|----------|
| 多词 | AND 匹配 |
| 范围 | 计划名/任务 title+note/注释 content |
| 分组 | 结果按 scope 分段（plan→task→note） |
| 规模 | ≤1s（1000 计划/10000 任务） |
| 索引未就绪 | code 23 + `trace:index-status` 进度推送（完成后自动重查） |

### 5.2 索引状态 Index Status

#### `search:getStatus`

```json
{ "state": "ready", "indexedPlans": 0, "lastBuiltAt": null }
```

### 5.3 重建索引 Rebuild

#### `search:rebuildIndex`

```json
{ "confirmed": true }
```

触发全量重建（`index.json` 损坏/外部大规模变更后）；期间推送 `trace:index-status`。

---

## 6. 配置与应用 APIs

### 6.1 配置读写 Config

#### `config:get` / `config:set`

| 键 Key | 类型 Type | 说明 Description |
|-------|----------|---------------|
| `window.state` | object | 窗口位置/尺寸/最大化 |
| `ui.zoomFactor` | number | 界面缩放（预留） |

> 根目录路径不走此通道（唯一事实 = `app:setRootDir`，与应用数据目录维护）。

### 6.2 日志与异常 Log & Crash

#### `app:reportError`

```json
{ "context": "search:query", "message": "…", "stack": "…" }
```

处理：脱敏写入日志（**不含计划正文**；上报前渲染器侧裁剪）；返回 `{ok:true}`。

---

## 7. 错误码定义 Error Codes

### 7.1 错误码表 Business Error Codes

> 无 HTTP 状态码（进程内调用）；错误码即业务码。

| 错误码 Error Code | 常量 Constant | 错误消息 Error Message | 说明 Description |
|----------------|--------------|---------------------|---------------|
| 0 | OK | ok | 成功 |
| 10 | ERR_PATH_NOT_FOUND | 目标位置不存在（可能已被移动或删除） | 路径不存在 |
| 11 | ERR_PATH_UNSAFE / ERR_READONLY | 目录不可用（只读/无权限，或路径越界被拒） | 安全/权限 |
| 12 | ERR_NAME_CONFLICT | 同名文件夹已存在 | 同级重名 |
| 13 | ERR_CIRCULAR_NESTING | 不能移动到自身或子计划中 | 循环嵌套 |
| 14 | ERR_FORMAT_INVALID | 内容格式异常，已降级显示 | 格式损坏 |
| 15 | ERR_SAVE_FAILED | 保存失败，内容已保留（编辑态可重试） | IO 失败 |
| 20 | ERR_VALIDATION | 参数校验失败（名称/枚举/长度） | 参数 |
| 21 | ERR_STATE_MACHINE | 任务状态不允许该变更 | 状态机拒绝 |
| 22 | ERR_CONFLICT | 数据已被修改（外部/并发），请刷新后重试 | CAS 冲突 |
| 23 | ERR_INDEX_NOT_READY | 索引构建中，完成后自动补查 | 索引未就绪 |
| 24 | ERR_CONFIRMATION_REQUIRED | 危险操作需确认后执行 | 未确认破坏性操作 |
| 50 | ERR_INTERNAL | 主进程内部错误（已记录日志） | 兜底 |

### 7.2 错误响应示例 Error Response Example

```json
{
  "ok": false,
  "code": 12,
  "message": "同名文件夹已存在，请换一个名称",
  "data": null
}
```

---

## 附录 Appendix

### 附录A：接口测试工具 API Testing Tools

| 工具 Tool | 说明 Description |
|---------|---------------|
| Electron DevTools | 渲染器端调试（`window.trace` 白名单 API 逐条验证） |
| 主进程断点/日志 | IPC 通道调用记录（仅元信息，不含正文） |
| 契约单测 | `src/shared/ipc-contract.ts` 类型检查 + 主进程服务单测（vitest） |

### 附录B：接口版本管理 API Versioning

| 版本 Version | 状态 Status | 说明 Description |
|-----------|---------|---------------|
| IPC v1 | 当前版本 Current | 与存储契约 v1 同步；改动=走变更流程（文档版本 + `ipc-contract.ts` 同修） |
| v1.1（预告） | 预计 Release | `.trash` 回收站（deletePlan 语义调整）、撤销/还原通道、高级筛选参数 |

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 接口设计师 API Designer | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 后端负责人 Backend Lead | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 前端负责人 Frontend Lead | HeYS-Snowe | 电子批准 | 2026-09-05 |

---

**文档结束 End of Document**
