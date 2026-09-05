# 项目章程 Project Charter

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | 2026-09-05 |
| 生效日期 Effective Date | 2026-09-05 |
| 项目经理 Project Manager | HeYS-Snowe |
| 项目发起人 Project Sponsor | HeYS-Snowe（Qore 叩心） |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 修改内容 Description | 审核人 Reviewer |
|-------------|---------|---------------|-------------------|---------------|
| v1.0.0 | 2026-09-05 | HeYS-Snowe | 初始版本 Initial Version | HeYS-Snowe |

---

## 目录 Table of Contents

1. [项目概览 Project Overview](#1-项目概览-project-overview)
2. [项目目标与范围 Objectives & Scope](#2-项目目标与范围-objectives--scope)
3. [关键干系人 Stakeholders](#3-关键干系人-stakeholders)
4. [项目组织与团队 Organization](#4-项目组织与团队-organization)
5. [项目里程碑 Milestones](#5-项目里程碑-milestones)
6. [项目约束 Constraints](#6-项目约束-constraints)
7. [项目假设 Assumptions](#7-项目假设-assumptions)
8. [主要风险 Major Risks](#8-主要风险-major-risks)
9. [预算概要 Budget Summary](#9-预算概要-budget-summary)
10. [成功标准 Success Criteria](#10-成功标准-success-criteria)

---

## 1. 项目概览 Project Overview

### 1.1 项目基本信息 Project Basic Information

| 项目 Item | 信息 Information |
|---------|---------------|
| **项目名称 Project Name** | 溯源 Trace · by Qore（叩心出品） |
| **项目编号 Project ID** | QORE-TRACE-2026-001 |
| **项目类型 Project Type** | □ Web应用 □ 移动App ☑ 桌面应用 □ 其他 |
| **项目状态 Project Status** | ☑ 筹备中 □ 进行中 □ 已完成 |
| **开始日期 Start Date** | 2026-09-05 |
| **结束日期 End Date** | 2026-12-05（MVP 交付，估算） |
| **项目工期 Duration** | 约 13 周（估算，含 2 周缓冲） |

### 1.2 项目背景与意义 Background & Significance

个人计划管理存在五痛点：计划排版乱、集成管理差、任务管理差、溯源/查询困难、计划编辑难。开发者拟自研桌面端计划管理软件，命名为「溯源 Trace」（代表产品层面"计划有迹可循"的定位，也呼应组织 Qore 口号「叩问本心，不忘初心」）。项目意义：① 完成个人效率工具闭环；② 作为 Qore 个人工具线首作，远期可开源作为组织作品。

### 1.3 项目愿景 Project Vision

> 溯源，不失其本 —— 让每一份计划有迹可循，随时回到源头。

用户以单一应用管理全部个人计划：文件夹即计划、组件即排版、任务带状态、任何内容都可"溯源"找到出处。

---

## 2. 项目目标与范围 Objectives & Scope

### 2.1 项目目标 Project Objectives

#### 2.1.1 业务目标 Business Objectives

| 序号 ID | 业务目标 Business Objective | 衡量指标 Metric | 目标值 Target |
|--------|--------------------------|---------------|------------|
| 1 | 以单一应用承载全部个人计划（取代多工具混用） | 自用计划迁入率 | 100% 个人计划入溯源 |
| 2 | 五痛点全部缓解 | 痛点覆盖数 | 5/5 |
| 3 | 交付一款可发布的 Qore 桌面作品 | 安装包 + 开源草案（可选） | v1.0 可安装可分享 |

#### 2.1.2 用户目标 User Objectives

| 用户角色 User Role | 目标需求 User Need | 优先级 Priority |
|-----------------|-----------------|---------------|
| 个人用户（开发者本人） | 计划集中管理、组件化编辑、任务可追踪、内容可溯源 | P0 |
| 同类用户（远期开源后） | 同上的自用计划管理需求 | P1（本期不投入） |

#### 2.1.3 技术目标 Technical Objectives

| 技术指标 Technical Metric | 目标值 Target | 说明 Notes |
|----------------------|------------|----------|
| 响应时间 Response Time | 常规操作 < 1s | 树导航/渲染/编辑 |
| 冷启动时间 Startup Time | < 3s | 安装后首次启动（待 02 按框架实测） |
| 搜索响应 Search Response | ≤ 1s（千级计划/万级任务规模） | 本地索引 |
| 并发用户 Concurrent Users | 不适用 | 单机单用户 |
| 可用性 Availability | 单机 100%（无网络依赖） | 数据完全本地 |
| 兼容性 Compatibility | Windows 10/11（跨平台候选，待 02） | 与 02 选型结论联动 |
| 数据留存 Data Retention | 100% 不丢 | 明文件存储 + 破坏性操作二次确认 |

### 2.2 项目范围 Project Scope

#### 2.2.1 范围内 In Scope

| 序号 ID | 功能模块/交付物 Module/Deliverable | 描述 Description |
|--------|---------------------------|----------------|
| 1 | 存储模块 | 计划库根目录管理；计划文件夹创建/重命名/删除；嵌套；拖拽移动/排序 |
| 2 | 页面渲染模块 | 5 类计划单片组件（单选计划、多选计划、任务列表、任务详情、注释）渲染 + 组件内编辑 |
| 3 | 溯源查询模块（基础版） | 关键词检索（计划/任务/注释）；来源回溯定位 |
| 4 | 生命周期文档 00-02 | 立项/需求/设计文档（随里程碑交付） |
| 5 | 测试报告 + 安装包 + 发布说明 + 用户手册 | M5/M6 交付 |

#### 2.2.2 范围外 Out of Scope

| 序号 ID | 明确排除的内容 Excluded Item | 原因 Reason |
|--------|--------------------------|-----------|
| 1 | 用户登录注册/多用户/账号体系 | 方案中已删除；本地单用户应用 |
| 2 | 云端同步/云服务 | 本地优先原则，数据不出设备 |
| 3 | 移动端/Web 端 | v1.0 仅桌面 |
| 4 | Markdown 直接编辑 | 已被「自定义渲染模块」方案取代（编辑难是痛点） |
| 5 | 系统设置（主题等） | MVP 冻结；P2 远期 |
| 6 | 团队协作/多端协同 | 远期再议 |

### 2.3 范围管理原则 Scope Management Principles

- 所有范围变更必须经过评审和批准（单人项目：变更人 = 责任人 = HeYS-Snowe，评审 = 变更控制流程，见 §12）
- 变更影响分析必须包含对时间、成本、质量的影响
- MVP 范围（2.2.1 之 1-3）冻结后，新增需求默认进 v1.1+，不进当前里程碑

---

## 3. 关键干系人 Stakeholders

### 3.1 干系人登记表 Stakeholder Register

| 序号 ID | 干系人姓名 Name | 角色职位 Role | 利益相关度 Interest | 影响力 Influence | 沟通需求 Communication |
|--------|---------------|------------|------------------|----------------|-------------------|
| 1 | HeYS-Snowe | 唯一开发者/项目经理/项目发起人 | 高 | 高 | 无需结构化沟通（自执行） |
| 2 | Qore（叩心） | 出品组织（版权/署名/品牌） | 中 | 中 | 文档中署名归属遵循 OrganizationAndUser.md |
| 3 | AI 开发代理（Claude Code 等） | 编码与文档协助 | 中 | 中 | 指令 + 交付文档（本 lifecycle 文档即沟通载体） |
| 4 | 同类用户/开源社区（远期） | 潜在用户/贡献者 | 低 | 低 | 开源决策时另行建立 |

### 3.2 干系人职责矩阵 Stakeholder Responsibility Matrix

| 干系人 Stakeholder | 角色 Role | 主要职责 Key Responsibilities |
|------------------|-----------|-----------------------------|
| 项目发起人 Sponsor | HeYS-Snowe | 立项决策、资源（时间）承诺、问题升级 |
| 项目经理 PM | HeYS-Snowe | 范围冻结、里程碑核销、文档产出 |
| 产品负责人 PO | HeYS-Snowe | 需求定义（01 文档）、优先级排序、验收 |
| 技术负责人 Tech Lead | HeYS-Snowe | 技术决策（02 选型）、架构设计、代码审查 |
| AI 代理 | 开发支持 | 按指令实现编码/文档初稿，接受人工复核（"思考不能外包"） |

---

## 4. 项目组织与团队 Organization

### 4.1 组织结构图 Organizational Structure

```
                项目发起人/项目经理 Sponsor / PM（HeYS-Snowe）
                             |
              ┌──────────────┴──────────────┐
              产品/需求             技术/架构
             （HeYS-Snowe）        （HeYS-Snowe）
                                   |
          ┌────────────┬────────────┼────────────┐
        前端/渲染     存储/检索     测试/QA      文档/运维
      （HeYS-Snowe + AI 代理）        （HeYS-Snowe）
```

> 单人项目：五条线均由 HeYS-Snowe 兼任；AI 代理承担编码执行并在成果上由"人"把关。

### 4.2 团队成员列表 Team Members

| 序号 ID | 姓名 Name | 角色 Role | 职责 Responsibilities | 参与时间 Period |
|--------|---------|---------|---------------------|---------------|
| 1 | HeYS-Snowe | 项目经理 PM | 进度/范围/文档 | 全程 |
| 2 | HeYS-Snowe | 前端开发 Frontend | 渲染模块/编辑交互/原型落地 | 开发期 |
| 3 | HeYS-Snowe | 后端开发 Backend | 存储模块/检索索引/数据契约 | 开发期 |
| 4 | HeYS-Snowe | 设计师 Designer | 信息架构/低保真原型/组件定义 | 需求-设计期 |
| 5 | HeYS-Snowe | 测试工程师 QA | MVP 测试/异常场景验证 | 开发-测试期 |
| 6 | AI 代理 | 开发支持 Dev Support | 编码执行、文档草稿（人工复核） | 全程 |

### 4.3 角色与职责 Roles & Responsibilities (RACI)

| 任务活动 Task | 项目经理 PM | 产品负责人 PO | 技术负责人 Tech Lead | 开发团队 Dev | 测试团队 QA |
|-------------|-----------|-------------|-------------------|------------|-----------|
| 需求定义 Requirements | A/R | A/R | I | C | I |
| 架构设计 Architecture | A | I | R/C | C | I |
| 开发编码 Development | A | I | C | R（人+AI 代理） | I |
| 测试验收 Testing | A | I | C | I | R |
| 部署上线 Deployment | A | I | R/C | C | I |

**图例 Legend:**
- **R** = Responsible 负责执行
- **A** = Accountable 最终负责
- **C** = Consulted 需要咨询（此处为 AI 代理/组织规则库）
- **I** = Informed 需要知情

> 单人项目下：A/R 集中在 HeYS-Snowe；C 来自 AI 代理与既有的 `.Rules` / `.prompt` 体系。

---

## 5. 项目里程碑 Milestones

### 5.1 里程碑计划 Milestone Schedule

> 排期为估算初稿（个人业余时间约 15h/周，含 2 周缓冲），随里程碑核销校准。

| 序号 ID | 里程碑名称 Milestone | 里程碑日期 Target Date | 关键交付物 Deliverables | 负责人 Owner |
|--------|-----------------|---------------------|----------------------|------------|
| M1 | 项目启动 Kickoff | 2026-09-05 | 项目章程（本文档）、立项/可行性文档、开发计划 | HeYS-Snowe |
| M2 | 需求确认 Requirements Sign-off | 2026-09-19 | PRD、功能规格说明书、原型设计（01 文档） | HeYS-Snowe |
| M3 | 设计评审 Design Review | 2026-10-10 | 技术选型报告、架构/概要/详细设计、UI 规范（02 文档） | HeYS-Snowe |
| M4 | 开发完成 Code Complete | 2026-11-14 | MVP 三模块可演示版本 | HeYS-Snowe |
| M5 | 测试完成 Testing Complete | 2026-11-28 | 测试报告 | HeYS-Snowe |
| M6 | 产品上线 Launch | 2026-12-05 | 安装包、发布说明 v1.0、用户手册 | HeYS-Snowe |

### 5.2 里程碑详细描述 Milestone Details

#### M1: 项目启动 Project Kickoff
- **日期 Date:** 2026-09-05
- **目标 Objective:** 完成立项决策（00 文档）并建立项目纪律（范围/排期/风险/变更控制）
- **成功标准 Success Criteria:** 立项申请书、可行性分析、项目章程签署生效；MVP 范围冻结
- **依赖 Dependencies:** 无

#### M2: 需求确认 Requirements Sign-off
- **日期 Date:** 2026-09-19
- **目标 Objective:** 固化"做什么"——用户需求、业务需求、产品需求、功能规格、低保真原型
- **成功标准 Success Criteria:** 01 五份文档完成；「计划单片组件」5 类语义定义评审冻结
- **依赖 Dependencies:** M1 完成

#### M3: 设计评审 Design Review
- **日期 Date:** 2026-10-10
- **目标 Objective:** 固化"怎么做"——含两项前置决策：技术选型、存储格式契约
- **成功标准 Success Criteria:** 02 七份文档完成；选型与存储格式定案（首周完成选型，其余文档随交付）
- **依赖 Dependencies:** M2 完成；选型决策不晚于 M3 第一周

#### M4: 开发完成 Code Complete
- **日期 Date:** 2026-11-14
- **目标 Objective:** 三模块（存储/渲染/溯源查询）可运行、可演示
- **成功标准 Success Criteria:** MVP 范围功能 100% 实现；核心场景可走通
- **依赖 Dependencies:** M3 完成

#### M5: 测试完成 Testing Complete
- **日期 Date:** 2026-11-28
- **目标 Objective:** 功能/异常/数据安全验证
- **成功标准 Success Criteria:** 无 P0/P1 遗留缺陷；测试报告达标
- **依赖 Dependencies:** M4 完成

#### M6: 产品上线 Launch
- **日期 Date:** 2026-12-05
- **目标 Objective:** 产出可分发安装包与发布说明
- **成功标准 Success Criteria:** 安装包在本机安装 + 运行 + 数据可迁移验证通过
- **依赖 Dependencies:** M5 完成

---

## 6. 项目约束 Constraints

### 6.1 约束条件汇总 Constraints Summary

| 约束类型 Constraint Type | 约束描述 Description | 应对措施 Mitigation |
|----------------------|------------------|------------------|
| 时间约束 Schedule | 业余时间约 15h/周，13 周为估算 | 缓冲 2 周；里程碑核销；滑移按优先级降级功能 |
| 预算约束 Budget | 现金 ¥0 | 仅使用免费/开源工具链；任何采购需走变更 |
| 资源约束 Resources | 单人（并发多项目：学业/其他项目） | 范围冻结；单线程里程碑；AI 代理承担机械执行 |
| 技术约束 Technical | 候选框架/存储格式在 02 首周前未定 | 00/01 只评估候选；02 首周必决策；决策前不做代码 |
| 政策约束 Policy | 无 | - |

### 6.2 依赖关系 Dependencies

| 依赖项 Dependency | 类型 Type | 描述 Description | 影响分析 Impact |
|----------------|---------|----------------|---------------|
| 02 设计与选型先行 | 内部 | "存储格式契约 + 组件语义"是开发的前置输入 | 若推迟，开发期整体滑移（关键路径） |
| 组件语义冻结 | 内部 | 5 类组件行为定义（01 文档）决定渲染/编辑实现 | 语义反复=规格返工（高危） |
| 外部依赖 | 外部 | 无（无服务、无第三方 API、无合作方） | 无 |

---

## 7. 项目假设 Assumptions

| 序号 ID | 假设内容 Assumption | 影响分析 Impact | 验证方法 Verification |
|--------|-------------------|---------------|-------------------|
| 1 | 个人时间投入稳定：工作日约 2h/晚、周末约 5h/天 | 若低于预期，里程碑滑移 | 周度里程碑核销（git 提交 + 文档交付率） |
| 2 | 候选技术栈至少一种与既有经验匹配（Electron/Flutter 中级，Tauri 需补 Rust） | 若选 Tauri，+约 2 周学习时间 | 02 首周选型时评估 Rust 曲线 |
| 3 | 个人计划数据规模 ≤ 千级计划/万级任务 | 超出时检索性能需换方案 | 02 设计按此规模上限设计索引 |
| 4 | 无历史数据迁移需求（全新应用） | 若有旧数据（笔记/文档），需额外导入 | 02 确认无既有数据；若有则走变更 |

**重要提醒:** 如果假设不成立，需要重新评估项目可行性

---

## 8. 主要风险 Major Risks

### 8.1 高优先级风险 High Priority Risks

| 风险ID Risk ID | 风险描述 Risk Description | 影响等级 Impact | 概率 Probability | 风险 owner Risk Owner |
|--------------|----------------------|---------------|---------------|-------------------|
| R001 | 组件语义无定义 → 规格返工（渲染/编辑重复实现） | 高 | 中 | HeYS-Snowe |
| R002 | 存储格式未定型 → 开发期中途改格式迁移 | 高 | 中 | HeYS-Snowe |
| R003 | 选型拖延/选错 → 架构返工 | 中 | 低 | HeYS-Snowe |
| R004 | 时间滑移（单人+多项目） → 里程碑错过 | 中 | 中 | HeYS-Snowe |
| R005 | 个人数据误删/损坏 | 高 | 低 | HeYS-Snowe |

### 8.2 风险应对计划 Risk Response Plan

| 风险 Risk | 应对策略 Strategy | 具体措施 Actions | 触发条件 Trigger |
|----------|----------------|----------------|----------------|
| R001 | 减轻 | 01 阶段"按字面拟初稿"完成 5 类组件定义并评审冻结；写作即评审（文档与规格一致） | 组件行为有人提出修改时，走变更流程 |
| R002 | 减轻 | 02 首周发布"存储格式契约"（目录布局 + 内容文件 + 元数据 + 格式版本号），研发仅读契约 | 格式变更请求 → 版本升级 + 迁移脚本 |
| R003 | 转移/减轻 | 候选矩阵见可行性报告 §3.2；02 首周硬性决策，用"两轮对比 + 决策记录"收口 | 02 第一周结束仍未定 → 按矩阵默认选 Electron |
| R004 | 接受+减轻 | MVP 范围冻结；滑移时按 存储→渲染→溯源 优先级降级（溯源基础版可降为 v1.1） | 里程碑逾期 ≥ 1 周 |
| R005 | 减轻 | 明文件存储 + 破坏性操作二次确认 + 恢复路径（回收/撤销，P1）；文档化"整库拷贝即备份" | 数据目录发生写操作前 |

---

## 9. 预算概要 Budget Summary

### 9.1 预算分配 Budget Allocation

| 类别 Category | 预算金额 Budget (¥) | 占比 Percentage |
|-------------|-------------------|---------------|
| 人力成本 Human Resources | 0（业余时间另行核算，约 195h） | - |
| 硬件设备 Hardware | 0（现有设备） | - |
| 软件工具 Software | 0（免费/开源） | - |
| 服务费用 Services | 0 | - |
| 应急储备 Contingency | 0 | - |
| **总计 Total** | **¥0** | - |

### 9.2 预算授权 Budget Authorization

| 授权级别 Authorization Level | 授权金额 Limit | 说明 Notes |
|--------------------------|-------------|----------|
| 项目经理 PM | ¥0 | 无日常开支（零成本项目） |
| 项目发起人 Sponsor | ¥0 | 无大额支出；未来若需（签名证书/域名），需走变更并遵循组织资产约定 |
| 开源发布（远期） | 待定 | 若发布仓库/主页，费用经组织（Qore）确认 |

---

## 10. 成功标准 Success Criteria

### 10.1 项目成功标准 Project Success Criteria

| 类别 Category | 成功标准 Success Criteria | 衡量方式 Measurement |
|-------------|-------------------------|-------------------|
| 业务目标 Business | 五痛点 5/5 缓解；个人计划 100% 入溯源管理 | 功能覆盖 + 实际使用记录 |
| 用户满意度 User Satisfaction | 自用连续使用 ≥ 4 周不弃用 | 使用记录/周复盘 |
| 技术指标 Technical | 常规操作 < 1s；冷启动 < 3s；检索 ≤ 1s（目标规模内） | M5 性能测试 |
| 进度 Schedule | 2026-12-05 ±1 周内完成 MVP 交付 | 里程碑核销 |
| 质量 Quality | 无 P0/P1 缺陷遗留 | 测试报告 |

### 10.2 验收标准 Acceptance Criteria

| 验收项 Item | 标准 Criteria | 验收方式 Method |
|-----------|-------------|---------------|
| 功能完成度 Feature Completion | MVP 范围 100%（存储/渲染/溯源查询基础版） | 功能测试 |
| 缺陷密度 Defect Density | 发布前 P0/P1=0；P2 ≤ 5（累积） | 缺陷跟踪 |
| 性能指标 Performance | 达标（见 10.1 技术指标） | 性能测试 |
| 文档完整性 Documentation | 00-07 生命周期文档按里程碑齐备 | 文档评审 |
| 数据安全 Data Safety | 明文件可备份；破坏性操作有确认 | 数据测试/设计审查 |

---

## 11. 沟通管理 Communication Management

### 11.1 沟通计划 Communication Plan

> 单人项目：沟通以"文档 + 里程碑 + 开发日志"为核心，不做会议性沟通。

| 会议/报告 Meeting/Report | 频率 Frequency | 参与人 Participants | 时长 Duration |
|-----------------------|--------------|------------------|-------------|
| 里程碑核销 Milestone Check | 每周 Weekly | HeYS-Snowe | 15-30 分钟 |
| 文档评审 Doc Review | 里程碑时 | HeYS-Snowe + AI 代理（审校） | 按需 |
| 日报 Daily Report | 每日 Daily | -（commit 消息 + 开发日志） | - |
| 周报 Weekly Report | 每周 Weekly | HeYS-Snowe（自核） | - |

### 11.2 沟通工具 Communication Tools

| 用途 Purpose | 工具 Tool |
|-----------|---------|
| 即时沟通 IM | 无（单人） |
| 文档协作 Docs | `docs\lifecycle\`（本仓库文档集） |
| 任务管理 Task Management | Git 提交 + 里程碑清单 |
| 代码管理 Code | Git（仓库 `qore/trace`，沿用组织命名约定） |
| 视频会议 Video Meeting | 无 |

---

## 12. 变更管理 Change Management

### 12.1 变更控制流程 Change Control Process

```
变更请求提交 → 影响分析 → 变更评审 → 决策(批准/拒绝) → 实施 → 验证
Change Request → Impact Analysis → Review → Decision → Implement → Verify
```

单人项目执行方式：变更请求 = 需求/范围/技术决定的任何偏离 → 影响分析（时间/成本/质量）→ 记录在本章程修改记录或 `docs\Plan\` 补充文档 → 批准才实施。

### 12.2 变更控制委员会 Change Control Board (CCB)

| 成员 Member | 角色 Role | 职责 Responsibility |
|-----------|---------|-------------------|
| HeYS-Snowe | 唯一决策人 | 变更审批（单人项目，审批链合一） |
| OrganizationAndUser.md | 组织事实来源 | 影响署名/包名/版权时以它为准 |

---

## 13. 批准与授权 Approval & Authorization

### 13.1 项目章程批准 Charter Approval

本人确认并同意以上项目章程内容，并授权项目启动。

I confirm and agree to the contents of this Project Charter and authorize the project initiation.

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 项目发起人 Project Sponsor | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 项目经理 Project Manager | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 关键干系人 Key Stakeholder | Qore（叩心组织） | 以署名约定生效 | 2026-09-05 |
| 关键干系人 Key Stakeholder | - | - | - |

---

## 附录 Appendix

### 附录A：术语表 Glossary

| 术语 Term | 定义 Definition |
|----------|---------------|
| PRD | Product Requirements Document 产品需求文档 |
| UAT | User Acceptance Testing 用户验收测试 |
| MVP | Minimum Viable Product 最小可行产品 |
| 计划单片组件 | 计划渲染的最小单元（单选计划/多选计划/任务列表/任务详情/注释） |
| 溯源查询 | 对计划/任务/注释的检索与来源回溯能力 |
| 存储格式契约 | 02 设计定义的"文件夹 + 内容文件 + 元数据 + 格式版本号"的数据约定 |
| 计划库根目录 | 用户指定、计划文件夹树挂载的数据根目录 |

### 附录B：参考文档 Reference Documents

- `docs\Plan\Future_Plan-20260825-桌面端计划管理软件.md`（需求方案）
- `docs\Plan\Future_Plan-20260905-桌面计划管理软件-命名设计.md`（命名定案）
- `D:\Code\.Rules\OrganizationAndUser.md`（身份/包名/署名 SSOT）

### 附录C：项目编号规则 Project ID Rules

格式：`QORE-<项目缩写>-<年份>-<三位序号>`

| 字段 Field | 规则 Rule |
|-----------|----------|
| 组织前缀 | `QORE`（固定） |
| 项目缩写 | `TRACE`（本项目）/ 后续项目取英文名大写 |
| 年份 | 立项年份，如 `2026` |
| 序号 | 三位数字，同项目同年内递增，如 `001` |

示例：QORE-TRACE-2026-001（本周期内分支编号：001 立项，若年内二次立项则 002）。

---

**文档结束 End of Document**

**重要提示:** 本章程一经签署，即成为项目执行的正式依据。任何变更必须经过正式的变更控制流程。
