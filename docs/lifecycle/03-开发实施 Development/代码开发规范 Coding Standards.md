# 代码开发规范 Coding Standards

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | 2026-09-05 |
| 技术负责人 Tech Lead | HeYS-Snowe |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | 2026-09-05 | HeYS-Snowe | HeYS-Snowe | 初始版本（引用 .Rules 全局规范 + 本项目补充） |

---

## 目录 Table of Contents

1. [规范概述 Standards Overview](#1-规范概述-standards-overview)
2. [全局规范引用 Global References](#2-全局规范引用-global-references)
3. [本项目补充约定 Project-Specific Rules](#3-本项目补充约定-project-specific-rules)
4. [测试规范 Testing Standards](#4-测试规范-testing-standards)

---

## 1. 规范概述 Standards Overview

### 1.1 规范目的 Purpose

本文档约定「溯源 Trace」的编码规范。**原则：不重复造规范**——全局规范以 `D:\Code\.Rules` 为唯一事实源，本文档只记录本项目特定的补充约定（第 3 节）。

### 1.2 适用范围 Scope

| 语言/平台 Language/Platform | 适用 Applicable |
|--------------------------|----------------|
| TypeScript（主进程/渲染器/共享契约） | ✅ 是（本项目唯一语言） |
| Java / SQL | ❌ 否（不适用） |
| CSS/样式 | ✅（antd token 约束，见 UI 规范） |

---

## 2. 全局规范引用 Global References

> 以下规则**直接生效**，以 `D:\Code\.Rules\` 对应文件为准（版本随其升级）：

| 领域 Area | 规范文件 Reference |
|----------|-------------------|
| TypeScript 编码 | `common/core/code-style.md` §5.2 |
| 命名/格式/注释/代码组织 | `common/core/code-style.md` §1-4 |
| 三条底线（禁 emoji / 有意义命名 / 早返回） | `CLAUDE.md` 全局 §三 |
| 安全红线（密钥/注入/输入验证/日志脱敏） | `CLAUDE.md` 全局 §二 + `common/core/security.md` |
| 架构原则（SOLID/KISS/YAGNI） | `common/core/principles.md` |
| 提交规范 | `common/core/workflow.md` §3 + 本项目 Git 协作规范 |

---

## 3. 本项目补充约定 Project-Specific Rules

### 3.1 工程约定

| 项 Item | 约定 Rule |
|--------|----------|
| 严格模式 | TS `strict: true` 双端（tsconfig.node/web），**禁止关闭**；第三方 d.ts 兼容问题用 `skipLibCheck`（勿放宽自有代码） |
| 文件命名 | kebab-case（`ipc-contract.ts` / `plan-repository.ts`）；组件文件 PascalCase（`TreeDndPoc.tsx`） |
| 目录职责 | `src/main`（主进程）/ `src/preload`（桥）/ `src/renderer`（UI）/ `src/shared`（契约，双进程共享，**唯一类型来源**） |
| 依赖纪律 | 新增依赖须有明确理由并记录（本次 flexsearch 因 Spike 不达标已移除——依赖最小化实例） |

### 3.2 数据与安全红线（本项目特化）

| 红线 Rule | 说明 Description |
|----------|-----------------|
| 一切落盘走原子写 | 禁止直接 `writeFile` 到目标文件；必须经 `PlanRepository.writePlanAtomic`（临时文件+fsync+rename，LLD §6.1） |
| 路径必检 | 渲染器传入的任何路径在主进程入口先过路径安全校验（LLD §6.6），禁止信任渲染器 |
| IPC 最小暴露 | 新能力先在 `ipc-contract.ts` 加类型 → 主进程注册 → preload 暴露；**禁止**绕过白名单直开通道 |
| 渲染即编辑 | 组件编辑禁止引入"编辑模式"切换（产品约束，ADR-005） |
| 日志脱敏 | 日志不含计划正文/任务标题全文（只含元数据：路径/通道/异常类型），LLD §7.2 |
| 无网络代码 | 禁止引入任何网络请求代码/依赖（项目硬约束 BR-004/R-004）；如需联网能力走变更流程 |
| 未知组件容忍 | 渲染分发对未知 type 必须降级占位（不许抛错崩溃），未知字段保留不丢（契约向前兼容） |

### 3.3 算法实现锚点

状态机（LLD §6.3）/循环嵌套校验（§6.2）/路径安全（§6.6）/逾期判定（§6.7）以 LLD 算法节为唯一实现依据；修改算法先改 LLD 再改码。

---

## 4. 测试规范 Testing Standards

| 层 Layer | 要求 Requirement | 工具 |
|---------|-----------------|------|
| 服务层（存储/检索） | 覆盖 ≥ 80%（mock fs） | vitest |
| 算法（状态机/循环/路径/逾期） | 表驱动 100% 分支 | vitest |
| 契约 | `npm run typecheck` CI 强制 | tsc |
| UI 关键路径 | 树/渲染/编辑冒烟 | vitest+RTL（可选） |
| IPC 集成 | M5 通道冒烟 | 脚本/手工 |

AAA 模式（Arrange-Act-Assert）遵循 `D:\Code\.Rules\common\core\workflow.md` §4。

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 技术负责人 Tech Lead | HeYS-Snowe | 电子批准 | 2026-09-05 |

---

**文档结束 End of Document**
