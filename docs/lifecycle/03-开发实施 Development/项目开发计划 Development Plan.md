# 项目开发计划 Project Development Plan

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | 2026-09-05 |
| 计划周期 Planning Period | 2026-09-05 ~ 2026-12-05（M1-M6） |
| 项目经理 Project Manager | HeYS-Snowe |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | 2026-09-05 | HeYS-Snowe | HeYS-Snowe | 初始版本 Initial Version |

---

## 目录 Table of Contents

1. [项目概述 Project Overview](#1-项目概述-project-overview)
2. [开发阶段划分 Development Phases](#2-开发阶段划分-development-phases)
3. [详细开发计划 Detailed Development Plan](#3-详细开发计划-detailed-development-plan)
4. [资源计划 Resource Plan](#4-资源计划-resource-plan)
5. [风险管理 Risk Management](#5-风险管理-risk-management)
6. [质量管理 Quality Management](#6-质量管理-quality-management)
7. [沟通管理 Communication Management](#7-沟通管理-communication-management)

---

## 1. 项目概述 Project Overview

### 1.1 项目基本信息 Project Basic Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 项目名称 Project Name | 溯源 Trace（· by Qore） |
| 项目代号 Project Code | QORE-TRACE-2026-001 |
| 开发周期 Development Period | 2026-09-05 ~ 2026-12-05（M2-M6 于本计划展开；M1 已于 09-05 完成） |
| 项目经理 Project Manager | HeYS-Snowe |
| 技术负责人 Tech Lead | HeYS-Snowe |

### 1.2 开发目标 Development Goals

| 目标类型 Goal Type | 目标描述 Goal Description | 成功标准 Success Criteria |
|----------------|---------------------|------------------------|
| 功能目标 Functional Goal | MVP 三模块（存储/渲染/溯源查询基础版）落地；5 类组件草案语义可真实使用 | 功能完成率 100%（01 PRD F-001~F-008） |
| 质量目标 Quality Goal | 无 P0/P1 缺陷遗留；数据安全（原子写无半写） | P0/P1=0；异常注入测试通过 |
| 性能目标 Performance Goal | 冷启动<3s / 常规<1s / 检索≤1s（规模内） | M5 实测达标 |
| 交付目标 Delivery Goal | 2026-12-05 ±1 周发布 v1.0（NSIS 安装包） | M6 核销 |

---

## 2. 开发阶段划分 Development Phases

### 2.1 阶段总览 Phase Overview

| 阶段 Phase | 名称 Name | 工期 Duration | 起止日期 Dates | 产出 Output |
|----------|---------|-------------|--------------|-----------|
| Phase 1 | 需求确认 Requirements Confirmation | 2周 | 2026-09-05 ~ 09-19 | 01 五文档（已完成）+ 语义草案定稿 |
| Phase 2 | 系统设计 System Design | 3周 | 2026-09-19 ~ 10-10 | 02 七文档（已完成 6/7；LLD 已于 09-05 完成基线稿，Spike 后更新 3 处） |
| Phase 3 | 开发实施 Development | 5周 | 2026-10-10 ~ 11-14 | Sprint 0-4（§3）可运行系统 |
| Phase 4 | 测试验证 Testing | 2周 | 2026-11-14 ~ 11-28 | 测试报告（04 文档） |
| Phase 5 | 部署上线 Deployment | 1周 | 2026-11-28 ~ 12-05 | NSIS 安装包 + Release Notes |

### 2.2 依赖关系 Dependencies

```
[Phase 1] ──▶ [Phase 2] ──▶ [Phase 3] ──▶ [Phase 4] ──▶ [Phase 5]
   需求确认       系统设计        开发实施       测试验证       部署上线
   （09-19）      （10-10）      （11-14）      （11-28）      （12-05）
                 │
                 └─ 开发首周 Spike（SPIKE-1~4） 与 Phase 3 Sprint 0 合并执行，
                    结果回写 LLD 附录C（3 处 [SPIKE] 项锁定）
```

---

## 3. 详细开发计划 Detailed Development Plan

### 3.1 迭代规划 Iteration Planning

| 迭代 Iteration | 周期 Duration | 开始日期 Start | 结束日期 End | 主要功能 Main Features |
|--------------|-------------|--------------|------------|---------------------|
| Sprint 0 | 1周 | 2026-10-10 | 2026-10-16 | 环境/脚手架 + Spike 1-4 |
| Sprint 1 | 1.5周 | 2026-10-17 | 2026-10-27 | 主进程存储服务 + IPC 骨架 + 配置/监视 |
| Sprint 2 | 1.5周 | 2026-10-28 | 2026-11-07 | 渲染器：树 + 5 类组件 + 组件内编辑 |
| Sprint 3 | 1周 | 2026-11-08 | 2026-11-14 | 溯源查询 + 打包（NSIS）+ Alpha |
| Sprint 4 | 2周 | 2026-11-15 | 2026-11-28 | 测试（04）+ 缺陷修复 |
| Sprint 5 | 1周 | 2026-11-29 | 2026-12-05 | 发布准备 + Release Notes + 用户手册 |
| **Total** | **8周** | | | （M2-M6 窗口内；日历见附录A） |

### 3.2 Sprint 0: 环境与 Spike（2026-10-10 ~ 10-16）

| 任务 Task | 负责人 Owner | 工作量 Estimate | 状态 Status |
|----------|------------|---------------|-----------|
| 脚手架：electron-vite + React + TS + antd 空壳（HMR 通过） | HeYS-Snowe（AI 协助） | 1天 | |
| IPC 骨架：contextBridge + 白名单注册/校验中间件（空通道 throw NotImplemented） | HeYS-Snowe | 1天 | |
| **SPIKE-1 检索**：FlexSearch 中文分词 PoC vs 内存扫包含（TC-01 样集命中率 + 性能基准） | HeYS-Snowe | 1天 | |
| **SPIKE-2 树拖拽**：antd Tree 内建拖拽 PoC（跨层/插入线/循环红显） | HeYS-Snowe | 1天 | |
| **SPIKE-3 跨盘/长路径**：移动策略与 Windows 长路径实测 | HeYS-Snowe | 0.5天 | |
| **SPIKE-4 性能基准**：万级任务场景冷启动/检索基线采集 | HeYS-Snowe | 0.5天 | |
| CI 骨架：GitHub Actions（typecheck + 单测 + electron-builder 打包冒烟） | HeYS-Snowe | 0.5天 | |
| LLD 回写：3 处 [SPIKE] 项按结论锁定 + 契约类型落位 `src/shared/` | HeYS-Snowe | 0.5天 | |

### 3.3 Sprint 1: 主进程基石（2026-10-17 ~ 10-27）

| 功能模块 Module | 任务 Task | 负责人 Owner | 工作量 Estimate | 优先级 Priority |
|--------------|---------|------------|---------------|--------------|
| 存储服务 | PlanRepository：原子写引擎（tmp→fsync→rename）+ 单测 | HeYS-Snowe | 2天 | P0 |
| 存储服务 | 树枚举/缓存（TreeCache）+ 懒加载 | HeYS-Snowe | 1.5天 | P0 |
| 存储服务 | 计划 CRUD + 移动/排序（含循环校验/重名/confirm 校验） | HeYS-Snowe | 2天 | P0 |
| 存储服务 | savePlan CAS + 组件/任务通道（append/remove/move/updateTask 状态机） | HeYS-Snowe | 1.5天 | P0 |
| IPC 层 | 全部 storage:* 通道注册 + 路径安全校验/错误映射 + 日志脱敏 | HeYS-Snowe | 1天 | P0 |
| 配置服务 | rootDir 流程（bootstrap/setRootDir/.trace 初始化）+ 窗口状态 | HeYS-Snowe | 1天 | P0 |
| 监视服务 | chokidar 接入 + 外部变更事件 + 缓存失效联动 | HeYS-Snowe | 0.5天 | P1 |
| 数据安全 | 异常注入测试（模拟 IO 失败/崩溃恢复） | HeYS-Snowe | 0.5天 | P0 |

### 3.4 Sprint 2: 渲染器（2026-10-28 ~ 11-07）

| 功能模块 Module | 任务 Task | 负责人 Owner | 工作量 Estimate | 优先级 Priority |
|--------------|---------|------------|---------------|--------------|
| 主界面 | 布局骨架（顶栏/树/内容/状态栏 + 窗口尺寸/抽屉断点） | HeYS-Snowe | 1天 | P0 |
| 计划树 | antd Tree 集成：懒加载/展开/选中/右键菜单（新建子计划/重命名/删除） | HeYS-Snowe | 1.5天 | P0 |
| 计划树 | 拖拽（SPIKE-2 结论落定）+ 循环红显 | HeYS-Snowe | 1天 | P0 |
| 组件渲染 | 5 类组件卡片（single_plan/multi_plan/task_list/task_detail/note）+ Fallback 降级 | HeYS-Snowe | 2.5天 | P0 |
| 组件编辑 | 渲染即编辑（防抖保存 + CAS 冲突处理 + ESC 语义） | HeYS-Snowe | 1.5天 | P0 |
| 状态管理 | Zustand stores（tree/plan/search/app）+ ipc-client 层 | HeYS-Snowe | 1天 | P0 |
| 引导 | 首次启动（无根目录）+ 根目录切换确认 | HeYS-Snowe | 0.5天 | P0 |
| 组件测试 | 关键路径单测（渲染/状态机 UI 联动） | HeYS-Snowe | 1天 | P1 |

### 3.5 Sprint 3: 溯源与打包（2026-11-08 ~ 11-14）

| 功能模块 Module | 任务 Task | 负责人 Owner | 工作量 Estimate | 优先级 Priority |
|--------------|---------|------------|---------------|--------------|
| 检索服务 | 索引构建（启动全量+增量）+ index.json 持久化/重建 | HeYS-Snowe | 1.5天 | P0 |
| 检索服务 | query（多词 AND/分段/命中片段）+ locate 回溯载荷 | HeYS-Snowe | 1天 | P0 |
| 检索 UI | 搜索框（防抖 300ms）/结果分段/空态/索引状态提示 | HeYS-Snowe | 1天 | P0 |
| 回溯定位 | 树路径展开 + 内容区定位 + 高亮渐隐（2s） | HeYS-Snowe | 0.5天 | P0 |
| 打包 | electron-builder NSIS（appId com.qore.trace/productName 溯源 Trace）+ 安装验证 | HeYS-Snowe | 1天 | P0 |
| CI | 打包 workflow（Release 触发）+ 产物说明 | HeYS-Snowe | 0.5天 | P1 |
| Alpha 版本 | 全流程自用演练：新库→建计划→组件→检索→回溯→备份恢复 | HeYS-Snowe | 0.5天 | P0 |

### 3.6 Sprint 4-5: 测试与发布（2026-11-15 ~ 12-05）

| 任务 Task | 负责人 Owner | 工作量 Estimate | 说明 Description |
|----------|------------|---------------|-----------------|
| 测试计划/用例（04 文档） | HeYS-Snowe | 1天 | M5 前置 |
| 功能测试（TC-01~06 + 业务用例） | HeYS-Snowe | 3天 | 功能/异常/边界 |
| 性能/数据测试（SPIKE-4 基准复测/异常注入/备份演练） | HeYS-Snowe | 1.5天 | 校准目标 |
| 缺陷修复 | HeYS-Snowe | 2天 | P0/P1 清零 |
| 测试报告 | HeYS-Snowe | 1天 | 04-测试报告 |
| 发布说明 + 用户手册（07） | HeYS-Snowe | 1.5天 | 含备份/迁移指引 |
| 上线检查清单（05） | HeYS-Snowe | 0.5天 | 核销 Release |

---

## 4. 资源计划 Resource Plan

### 4.1 人员分配 Staff Allocation

| 角色 Role | 人员姓名 Name | 投入比例 Allocation (%) | 主要职责 Responsibilities |
|----------|-------------|----------------------|------------------------|
| 项目经理 PM | HeYS-Snowe | 100%（兼任） | 里程碑核销、范围冻结 |
| 产品经理 PO | HeYS-Snowe | 30%（兼任） | 语义草案维护、验收 |
| 技术负责人 Tech Lead | HeYS-Snowe | 100%（兼任） | 技术决策、代码审查 |
| 前端开发 Frontend | HeYS-Snowe | 100%（兼任） | 渲染器全部 |
| 后端开发 Backend | HeYS-Snowe | 100%（兼任） | 主进程全部 |
| 测试工程师 QA | HeYS-Snowe | 50%（兼任） | 测试执行 |
| AI 代理 | Claude Code 等 | 辅助 | 编码执行/文档草稿（人复核） |

### 4.2 环境资源 Environment Resources

| 环境类型 Environment | 配置 Specification | 用途 Usage | 成本 Cost |
|-----------------|------------------|----------|---------|
| 开发环境 Dev | 本机 Windows 11（既有开发机） | 日常开发 | ¥0 |
| CI 环境 | GitHub Actions `windows-latest` | 检查+打包 | ¥0（公共额度） |
| 测试环境 Test | 本机 + 备用数据目录 | 测试验证 | ¥0 |
| 生产环境 Production | 发布包（NSIS）+ GitHub Release | 正式交付 | ¥0 |
| 应用签名 | 无证书（SmartScreen 提示属预期） | - | ¥0 |

---

## 5. 风险管理 Risk Management

### 5.1 风险识别 Risk Identification

| 风险ID Risk ID | 风险描述 Risk Description | 概率 Probability | 影响程度 Impact | 风险等级 Risk Level |
|--------------|----------------------|---------------|---------------|------------------|
| R001 | 组件语义随真实使用迭代（用户未用过同类应用） | 高 | 中 | 高（预期，非异常） |
| R002 | Spike 结论与设计假设不符（中文分词/拖拽/跨盘） | 中 | 中 | 中 |
| R003 | 单人进度滑移（学业/其他项目并行） | 中 | 中 | 中 |
| R004 | 第三方服务不稳定 | 低 | 低 | 低（无依赖） |
| R005 | 数据误删/损坏 | 低 | 高 | 中 |

### 5.2 风险应对计划 Risk Response Plan

| 风险ID Risk ID | 应对策略 Strategy | 具体措施 Actions | 责任人 Owner |
|--------------|----------------|----------------|------------|
| R001 | 接受+迭代 | 草案基线；使用中痛点→`.issues`→v1.1 变更流程；架构已兜底（降级/版本化/迁移） | HeYS-Snowe |
| R002 | 规避 | Spike 前移（Sprint 0 首日）；接口层已隔离（SearchPort），换实现不动服务 | HeYS-Snowe |
| R003 | 接受+减轻 | MVP 范围冻结；缓冲 2 周；滑移时按 存储→渲染→溯源 降级（溯源基础版可转 v1.1） | HeYS-Snowe |
| R004 | 减轻 | 无第三方依赖；仅 GitHub Actions（弱依赖，失败不阻塞本地开发） | HeYS-Snowe |
| R005 | 减轻 | 原子写 + 二次确认 + 整库备份指引 + 变更/恢复路径 | HeYS-Snowe |

---

## 6. 质量管理 Quality Management

### 6.1 质量目标 Quality Goals

| 指标 Indicator | 目标值 Target | 测量方式 Measurement |
|--------------|------------|-------------------|
| 代码覆盖率 Code Coverage | Service/算法 ≥ 80%（关键 100%） | vitest coverage |
| Bug密度 Bug Density | P0/P1 发布前 = 0 | 缺陷跟踪 |
| 代码审查覆盖率 Review Coverage | 100%（提交前自查 + AI 审 + 每周复核） | 人工统计 |
| 静态分析通过率 Static Analysis Pass | 100%（tsc strict + ESLint 0 error） | CI |
| 契约一致性 | IPC/存储契约类型同源（src/shared） | tsc 编译期 |

### 6.2 质量保证活动 QA Activities

| 活动 Activity | 频率 Frequency | 负责人 Owner | 参与人 Participants |
|-----------|--------------|------------|------------------|
| 代码审查 Code Review | 每次提交 | HeYS-Snowe | AI 代理（复核） |
| 单元测试 Unit Test | 随 Sprint（逻辑先行） | HeYS-Snowe | - |
| 集成测试/冒烟 Integration Test | CI 每日 | - | GitHub Actions |
| 功能测试 Functional Test | Sprint 末 | HeYS-Snowe | - |
| 回归测试 Regression Test | 发版前 | HeYS-Snowe | - |

---

## 7. 沟通管理 Communication Management

### 7.1 会议计划 Meeting Plan

> 单人项目：不做会议性沟通，以文档 + 里程碑核销为主。

| 会议类型 Meeting Type | 频率 Frequency | 参与人 Participants | 议程 Agenda |
|------------------|--------------|------------------|------------|
| 里程碑核销 | 每周（自核） | HeYS-Snowe | 计划 vs 实际、风险、下周 |
| Spike/评审结论记录 | 事件式 | HeYS-Snowe | 写入 LLD 附录C / 变更文档 |

### 7.2 汇报机制 Reporting Mechanism

| 报告类型 Report Type | 频率 Frequency | 接收人 Recipient | 内容 Content |
|-----------------|--------------|---------------|-----------|
| 开发日志（commit 信息） | 每次提交 | Git 日志 | 按约定式提交 |
| 里程碑核销记录 | 每周 | 本项目文档库 | 核销表 |
| 进度报告 | 里程碑 | Qore 组织（文档） | M2-M6 达成 |

---

## 附录 Appendix

### 附录A：项目日历 Project Calendar

| 日期 Date | 事件 Event | 说明 Notes |
|----------|---------|-----------|
| 2026-09-05 | 项目启动 Kickoff（M1） | ✅ 已完成 |
| 2026-09-19 | 需求确认（M2） | 语义草案定稿同步 |
| 2026-10-10 | 设计评审（M3） | 02 七文档齐 + Spike 启动 |
| 2026-10-16 | Sprint 0 结束 | SPIKE 1-4 结论落 LLD |
| 2026-10-27 | Sprint 1 结束 | 主进程基石 |
| 2026-11-07 | Sprint 2 结束 | 渲染器 |
| 2026-11-14 | 开发完成（M4） | Alpha 可演示 |
| 2026-11-28 | 测试完成（M5） | 测试报告 |
| 2026-12-05 | 正式发布 Launch（M6） | v1.0 NSIS |

### 附录B：里程碑 Milestones

| 里程碑 Milestone | 日期 Date | 交付物 Deliverables | 验收标准 Acceptance |
|--------------|---------|-------------------|-------------------|
| M2 需求确认 | 2026-09-19 | 01 文档 + 语义草案定稿 | 文档齐 + 草案定稿记录 |
| M3 设计完成 | 2026-10-10 | 02 七文档 | 设计评审（自审）通过 |
| M4 Alpha | 2026-11-14 | 三模块可运行版本 | 核心场景可演示 |
| M5 测试完成 | 2026-11-28 | 测试报告 + 缺陷清零 | P0/P1=0 |
| M6 正式发布 | 2026-12-05 | NSIS 安装包 + Release Notes | 安装/运行/备份迁移验证 |

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 项目经理 PM | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 技术负责人 Tech Lead | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 产品负责人 PO | HeYS-Snowe | 电子批准 | 2026-09-05 |

---

**文档结束 End of Document**
