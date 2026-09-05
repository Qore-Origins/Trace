# 可行性分析报告 Feasibility Analysis Report

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | 2026-09-05 |
| 最后修改 Last Modified | 2026-09-05 |
| 编制作者 Author | HeYS-Snowe |
| 审核人员 Reviewer | HeYS-Snowe（单人项目自审） |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 修改内容 Description |
|-------------|---------|---------------|-------------------|
| v1.0.0 | 2026-09-05 | HeYS-Snowe | 初始版本 Initial Version |

---

## 目录 Table of Contents

1. [执行摘要 Executive Summary](#1-执行摘要-executive-summary)
2. [项目概述 Project Overview](#2-项目概述-project-overview)
3. [技术可行性 Technical Feasibility](#3-技术可行性-technical-feasibility)
4. [经济可行性 Economic Feasibility](#4-经济可行性-economic-feasibility)
5. [操作可行性 Operational Feasibility](#5-操作可行性-operational-feasibility)
6. [时间可行性 Schedule Feasibility](#6-时间可行性-schedule-feasibility)
7. [法律与合规性 Legal & Compliance](#7-法律与合规性-legal--compliance)
8. [风险分析 Risk Analysis](#8-风险分析-risk-analysis)
9. [结论与建议 Conclusion & Recommendations](#9-结论与建议-conclusion--recommendations)

---

## 1. 执行摘要 Executive Summary

### 1.1 可行性结论 Summary Conclusion

| 可行性维度 Feasibility Dimension | 结论 Conclusion | 评分 Score (1-10) |
|-------------------------------|---------------|-----------------|
| 技术可行性 Technical | ☑ 可行 □ 不可行 | 9 |
| 经济可行性 Economic | ☑ 可行 □ 不可行 | 10 |
| 操作可行性 Operational | ☑ 可行 □ 不可行 | 9 |
| 时间可行性 Schedule | ☑ 可行 □ 不可行 | 7 |

**总体建议 Overall Recommendation:**

☑ **建议立项 Recommend**
□ **有条件立项 Conditional Recommend**
□ **不建议立项 Not Recommend**

> 四维度均可行。时间维度评分较低（7）仅因"单人 + 业余时间"这一变量，属可控风险而非决策阻断。

### 1.2 关键发现 Key Findings

1. 核心需求自洽：五大痛点来自长期个人实践、方案已书面化（2026-08-25），且应用命名（溯源 Trace，2026-09-05）与第一痛点「溯源、查询困难」直接呼应，需求真实性无风险。
2. 技术壁垒低：本地单机桌面应用，无后端、无服务器、无账号体系需求；候选框架（Tauri/Electron/Flutter/原生）均为成熟方案。
3. 最大不确定性在"设计前置问题"：技术栈与存储格式未定（候选差异大），存储格式与组件渲染存在耦合——必须在 02 系统设计阶段先行决策，不可拖延。
4. 唯一真实成本是个人时间（现金投入 ¥0），开发期为估算 13 周业余时间（约 195h），收益为年节省 100h+ 的自用效率与 Qore 品牌作品。

---

## 2. 项目概述 Project Overview

### 2.1 项目背景 Project Background

用户日常使用笔记软件、Markdown 文档、聊天记录等多类载体管理个人计划，暴露五类痛点：计划排版乱、集成管理差、任务管理差、溯源/查询困难、计划编辑难。现有产品（笔记类、任务类）均未按"计划"这一对象的完整生命周期设计，故立项自研桌面端个人计划管理软件「溯源 Trace」（Qore 出品）。方案与命名详见附录参考材料。

### 2.2 项目目标 Project Objectives

| 目标类型 Objective Type | 具体描述 Description |
|---------------------|-------------------|
| 业务目标 Business | 完成个人计划管理工具的"痛点全覆盖"（5/5 缓解）；作为 Qore 个人工具线作品（远期可选开源） |
| 技术目标 Technical | 本地优先（无服务器、无账号）；文件夹化存储（数据明文件、可备份可迁移）；组件化自定义渲染；检索与来源回溯可按"千级计划/万级任务"规模毫秒级响应 |
| 用户目标 User | 用户（开发者本人）以单一应用承载全部个人计划，连续使用 ≥ 4 周；任何计划/任务随时可"溯源"找到源头 |

### 2.3 项目范围 Project Scope

**主要功能 Major Features:**
1. 存储模块：计划库根目录管理、计划文件夹创建/重命名/删除、嵌套结构、拖拽移动/排序
2. 页面渲染模块：计划单片组件自定义渲染（单选计划、多选计划、任务列表、任务详情、注释）、组件内编辑
3. 溯源查询模块（基础版）：关键词检索（计划/任务/注释）、来源回溯定位

**目标用户 Target Users:**

v1.0 为单一用户：开发者本人（HeYS-Snowe，学生 + 个人开发者，多项目/学业/生活计划并行）。远期若开源，目标扩展至同类"自用计划管理"需求人群（学生、开发者、知识工作者），但本期不做用户调研与市场验证。

---

## 3. 技术可行性 Technical Feasibility

### 3.1 技术需求分析 Technical Requirements

| 功能模块 Module | 技术需求 Technical Requirement | 难度等级 Difficulty |
|--------------|---------------------------|-------------------|
| 存储模块 | 文件系统抽象（目录树读写、嵌套、重命名、删除、移动）；拖拽（Drag & Drop）事件集成 | 中 |
| 页面渲染模块 | 自定义渲染引擎（5 类结构化组件的渲染 + 组内编辑）；渲染与存储格式的解耦 | 中 |
| 溯源查询模块 | 本地索引（名称/内容/任务状态）；关键词检索；命中项 → 所属计划路径回溯 | 中 |
| 桌面端打包分发 | 安装包制作、分发（应用签名为远期项，本期可无签名本地安装） | 低 |

> 没有高难度项。常见技术难点集中在"拖拽与树组件交互""自定义渲染与编辑双态"两点，均为成熟前端/桌面框架可覆盖的既有问题域。

### 3.2 技术方案评估 Technical Solution Evaluation

> 平台范围：未定，先按候选评估（本项目决策：正式选型在 02 系统设计-技术选型报告中完成）。

| 技术选型 Tech Stack | 优势 Advantages | 劣势 Disadvantages | 成熟度 Maturity |
|-------------------|---------------|------------------|---------------|
| 前端框架 Frontend：Tauri 2.x（Rust 内核 + Web UI） | 包体小（约 10MB）、内存占用低、性能好、Rust 后端适合文件系统/索引 | Rust 学习成本（若开发者 Rust 初级）、生态较 Electron 小、拖拽等部分能力需自实现 | 中高 |
| 前端框架 Frontend：Electron（Node + Chromium） | 生态最大、Node 全栈一致、Chrome 渲染行为一致、插件资源最丰富 | 包体大（100MB+）、内存占用高（冷启动慢） | 高 |
| 前端框架 Frontend：Flutter Desktop（Dart） | 单一语言跨桌面平台、UI 性能好、开发者已有 Flutter 生态经验 | 桌面端插件生态较弱（文件系统/拖拽需第三方插件）、Windows 桌面渲染稳定性略逊 Web 栈 | 中 |
| 前端框架 Frontend：原生 WinUI 3 / WPF（C#） | 性能最佳、Windows 深度集成、系统原生观感 | 仅 Windows、开发速度相对慢、无跨平台能力 | 高 |
| 后端框架 Backend | 不适用：无后端服务——本地文件系统即"后端"，全部数据本地 | - | - |
| 数据库 Database | 不适用：数据为文件夹 + 内容文件（明文本地）；检索索引可选内嵌（如 SQLite/排序索引包，02 决策） | - | - |
| 部署方案 Deployment | 本机安装包分发（MSI/NSIS 或框架自带安装器）；无服务器、无云服务 | Windows 未签名安装包 SmartScreen 提示属预期现象（远期签名） | 高 |

### 3.3 技术风险评估 Technical Risk Assessment

| 风险项 Risk | 影响 Impact | 概率 Probability | 应对策略 Mitigation |
|-----------|----------|---------------|------------------|
| 存储格式与渲染耦合：文件内格式变更导致旧数据不可读 | 高 | 中 | 02 设计首周定义"存储格式契约"（内容文件 + 元数据 + 格式版本号），渲染层只读契约 |
| 技术栈选错（包体/性能/生态不适配） | 中 | 低 | 00/01 只做候选评估不锁死；02 首周出选型报告并立项对齐；原型与架构不绑定框架 API |
| 拖拽嵌套交互复杂（文件树 DnD） | 低 | 中 | 使用成熟树组件 + 受限拖拽规则（悬停展开、禁止循环嵌套校验） |
| 检索性能：计划/任务量大后变慢 | 低 | 中 | 索引方案 02 定明（文本索引 + 增量更新）；规模承诺值 ≤ 千级计划/万级任务，常规方案足以覆盖 |

### 3.4 团队能力评估 Team Capability Assessment

| 技术领域 Technology | 团队水平 Team Level | 项目要求 Required | 差距 Gap |
|------------------|------------------|-----------------|---------|
| Web/前端开发 | 中级（全栈经验） | 中级 | 无 |
| 桌面应用开发 | 初级-中级（无正式桌面产品交付经历） | 中级 | 小（框架约定可快速补课） |
| Rust（仅当选 Tauri 时） | 初级 | 中级 | 有（需 ~2 周学习曲线，时间风险已计入 6 节） |
| Dart/Flutter（仅当选 Flutter 时） | 中级（既有生态经验） | 中级 | 无 |
| AI 代理编码协作 | 高级（日常惯用 CC/Codex 等） | 高级 | 无 |
| 项目管理/文档 | 高级（成熟 Rules/prompt 体系） | 高级 | 无 |

### 3.5 技术可行性结论 Technical Feasibility Conclusion

☑ **可行 Feasible** - 技术方案成熟，团队能力足够
□ **部分可行 Partially Feasible** - 存在技术挑战，需要补充资源
□ **不可行 Infeasible** - 技术风险过高，建议重新评估

---

## 4. 经济可行性 Economic Feasibility

### 4.1 成本估算 Cost Estimation

#### 4.1.1 一次性成本 One-time Costs

| 成本项目 Cost Item | 金额 Amount (¥) | 说明 Notes |
|-----------------|----------------|----------|
| 需求分析 Requirements | 0 | 自执行（时间约 2 周，不计现金） |
| 系统设计 Design | 0 | 自执行（时间约 3 周） |
| 开发实施 Development | 0 | 自执行（时间约 5 周） |
| 测试验收 Testing | 0 | 自执行（时间约 2 周） |
| 硬件设备 Hardware | 0 | 现有开发机 |
| 软件许可 Software | 0 | 全部免费/开源工具链 |
| 培训费用 Training | 0 | 自学习（Rust 若需要则自费时间） |
| 其他 Others | 0 | 无 |
| **小计 Subtotal** | **¥0** | 现金成本为零 |

#### 4.1.2 运营成本 Operating Costs (年度/Annual)

| 成本项目 Cost Item | 金额 Amount (¥/年) | 说明 Notes |
|-----------------|------------------|----------|
| 服务器/云服务 Servers | 0 | 无服务器（本地应用） |
| 维护人员 Maintenance | 0 | 自维护 |
| 第三方服务 3rd Party Services | 0 | 无云服务依赖 |
| 网络带宽 Network | 0 | 仅本地操作 |
| **小计 Subtotal** | **¥0** | - |

#### 4.1.3 总成本汇总 Total Cost Summary

| 成本类型 Cost Type | 金额 Amount |
|-----------------|----------|
| 第一年总成本 Year 1 Total | ¥0（现金）+ ≈195h（个人时间，估算） |
| 三年总成本 3-Year Total | ¥0（现金）+ 持续维护时间（未定，估算 <20h/年） |

### 4.2 收益分析 Benefit Analysis

| 收益类型 Benefit Type | 金额估算 Amount (¥/年) | 说明 Notes |
|-------------------|---------------------|----------|
| 直接收益 Direct Revenue | 0 | 自用工具，无销售计划 |
| 成本节约 Cost Savings | 0（现金口径） | 替代既有笔记/任务软件订阅支出（约几十元/年级别，忽略） |
| 效率提升 Efficiency Gains | 不折算现金；时间口径 ≈100h/年 | 估算约 2h/周（写计划、查计划、复盘无效时间的压缩），待实测校准 |
| **年收益总计 Annual Total** | **时间 ≈100h** | - |

### 4.3 经济指标分析 Economic Indicators

| 指标 Indicator | 计算值 Value | 说明 Description |
|--------------|-----------|----------------|
| 投资回报率 ROI | 不适用 | 无现金投入，无现金产出；以"时间回报"衡量：195h 投入 vs 100h/年 节省，年回报率 ≈51% |
| 净现值 NPV | 不适用 | 无现金流 |
| 内部收益率 IRR | 不适用 | 无现金流 |
| 投资回收期 Payback Period | ≈ 2 年（时间口径） | 195h 投入 ÷（100h/年）- 维护时间 20h/年 ≈ 2.4 年（粗算） |

### 4.4 经济可行性结论 Economic Feasibility Conclusion

☑ **可行 Feasible** - 经济效益明显，ROI合理
□ **有条件可行 Conditional** - 需要控制成本或增加收益
□ **不可行 Infeasible** - 成本过高或收益不足

> 零现金成本 + 长周期个人效率收益，经济上不存在决策阻碍；时间投入是机会成本，已纳入时间可行性评估。

---

## 5. 操作可行性 Operational Feasibility

### 5.1 组织适应性 Organizational Fit

| 评估维度 Dimension | 现状 Current | 项目要求 Required | 匹配度 Match |
|-----------------|------------|-----------------|-----------|
| 管理流程 Management | 单人项目 + 成熟文档体系（.Rules/lifecycle 模板） | 里程碑 + 文档交付 | 高 |
| 人员技能 Staff Skills | 全栈 + AI 协作熟练 | 前端/桌面/检索/测试 | 高 |
| 工作方式 Work Style | AI 代理主导开发 + 人工把关（"思考不能外包"） | 与现状一致 | 高 |

### 5.2 用户接受度 User Acceptance

**目标用户群体 Target User Groups:**

| 用户组 User Group | 影响程度 Impact | 预期接受度 Acceptance | 风险 Risk |
|-----------------|--------------|-------------------|---------|
| 本人（HeYS-Snowe，唯一用户） | 高 | 高（痛点即自身实践，需求为自述） | 低（开发中随时试错） |
| 类别同类用户（远期开源后） | 低（本期不投入） | 待验证 | 中（未做用户调研；如决定开源需补充调研） |

### 5.3 运营维护能力 Operations & Maintenance Capability

| 能力项 Capability | 现有水平 Existing | 需求水平 Required | 差距 Gap |
|----------------|----------------|----------------|---------|
| 技术支持 Technical Support | 高（开发者即用户） | 高 | 无 |
| 故障处理 Troubleshooting | 高（本人处理） | 高 | 无 |
| 数据备份 Data Backup | 高（明文件文件夹，任意时刻可整库拷贝） | 高 | 无 |

### 5.4 操作可行性结论 Operational Feasibility Conclusion

☑ **可行 Feasible** - 组织准备充分
□ **需要改进 Needs Improvement** - 需要加强培训或调整流程
□ **不可行 Infeasible** - 组织阻力过大

---

## 6. 时间可行性 Schedule Feasibility

### 6.1 项目时间规划 Project Schedule

| 阶段 Phase | 工期 Duration | 起止日期 Dates | 关键路径 Critical Path |
|----------|-------------|-------------|---------------------|
| 需求分析 | 2 周 | 2026-09-05 ~ 09-19 | ☑ 是 □ 否 |
| 系统设计 | 3 周 | 2026-09-19 ~ 10-10 | ☑ 是 □ 否 |
| 开发实施 | 5 周 | 2026-10-10 ~ 11-14 | ☑ 是 □ 否 |
| 测试验收 | 2 周 | 2026-11-14 ~ 11-28 | ☑ 是 □ 否 |
| 部署上线 | 1 周 | 2026-11-28 ~ 12-05 | □ 是 ☑ 否（本地无部署复杂度） |

**总工期 Total Duration:** 约 13 周（估算，已含 2 周缓冲；依据：个人业余投入约 15h/周）

### 6.2 时间约束分析 Schedule Constraints

| 约束类型 Constraint Type | 描述 Description | 影响程度 Impact |
|----------------------|----------------|--------------|
| 外部截止日期 External Deadline | 无（MVP 日期为自定目标，无强行期限） | 低 |
| 资源可用性 Resource Availability | 个人业余时间（工作日 2h/晚、周末约 5h/天 估算），学业/其他项目并行 | 中-高 |
| 依赖关系 Dependencies | 关键路径 = 01 文档 → 02 选型/设计（首周） → 开发 → 测试；选型拖延会整体滞后 | 高（设计先行是硬约束） |

### 6.3 时间可行性结论 Schedule Feasibility Conclusion

□ **可行 Feasible** - 时间充足
☑ **紧张但可行 Tight but Feasible** - 需要精心管理
□ **不可行 Infeasible** - 时间不足

> 时间可行，但依赖两项纪律：① 01 需求文档按时冻结；② 02 首周锁定技术选型与存储格式。

---

## 7. 法律与合规性 Legal & Compliance

### 7.1 知识产权 Intellectual Property

| 检查项 Check Item | 状态 Status | 说明 Notes |
|----------------|-----------|----------|
| 专利风险 Patent Risk | ☑ 无 □ 有 | 无新技术发明，自研常规应用 |
| 版权风险 Copyright Risk | ☑ 无 □ 有 | 全部代码自研；应用署名/版权归属 Qore：Copyright (c) 2026 Qore（依据 OrganizationAndUser.md §五） |
| 开源协议 Open Source License | □ 无 ☑ 需审查 | 本轮仅使用 MIT/Apache-2.0 类候选框架与库；若远期开源发布，需按 SPDX 清单审查第三方依赖 |

### 7.2 数据隐私 Data Privacy

| 法规 Regulation | 适用性 Applicability | 合规措施 Compliance Measures |
|--------------|------------------|--------------------------|
| GDPR | □ 是 ☑ 否 | 无欧洲用户，无收集、无上传 |
| 个人信息保护法 | □ 是 ☑ 否 | 数据为本人本地文件，无采集、无跨境；应用功能设计为无网络上传（v1.0 硬约束） |
| 数据安全法 | □ 是 ☑ 否 | 数据完全不离开用户设备，不涉及数据处理者角色 |

### 7.3 其他合规性 Other Compliance

| 类别 Category | 要求 Requirements | 合规状态 Status |
|-------------|----------------|---------------|
| 行业法规 Industry Regs | 无适用行业规制 | 合规 |
| 竞赛规则 Competition Rules | 无 | 合规 |

### 7.4 法律合规结论 Legal Compliance Conclusion

☑ **合规 Compliant** - 无法律障碍
□ **有风险 Risk Exists** - 需要法律咨询
□ **不合规 Non-compliant** - 存在重大法律风险

---

## 8. 风险分析 Risk Analysis

### 8.1 风险汇总表 Risk Summary

| 风险ID Risk ID | 风险类别 Category | 风险描述 Description | 影响程度 Impact | 发生概率 Probability | 风险等级 Level |
|--------------|----------------|------------------|---------------|-------------------|-------------|
| R001 | 技术 | 存储格式未定型导致后期迁移返工 | 高 | 中 | 高 |
| R002 | 技术 | 技术栈选型延迟/选错 | 中 | 低 | 中 |
| R003 | 需求 | 组件语义无定义，规格返工 | 高 | 中 | 高 |
| R004 | 时间 | 单人投入不足导致里程碑滑移 | 中 | 中 | 中 |
| R005 | 运营 | 个人计划数据误删/损坏 | 高 | 低 | 中 |

### 8.2 高风险应对措施 High-Risk Mitigation

| 风险 Risk | 应对策略 Strategy | 责任人 Owner |
|----------|----------------|------------|
| R001/R003 | 缓解：02 设计首周锁定"存储格式契约 + 组件行为定义"，评审后固化；01 文档列为"设计必须回答的问题" | HeYS-Snowe |
| R002 | 提前：00/01 完成候选矩阵（见 3.2），02 首周决策，不给未定选项留余地 | HeYS-Snowe |
| R004 | 缓解：范围冻结 + 2 周缓冲 + 里程碑核销；若滑移则按"存储→渲染→溯源"优先级顺序降级功能交付 | HeYS-Snowe |
| R005 | 缓解：明文件存储 + 设计约束"破坏性操作二次确认 + 可恢复路径" + 文档化备份说明 | HeYS-Snowe |

---

## 9. 结论与建议 Conclusion & Recommendations

### 9.1 综合评估结论 Comprehensive Assessment

基于以上分析，本项目在以下方面的可行性评估如下：

Based on the analysis above, the feasibility assessment for this project is:

| 评估维度 Dimension | 可行性结论 Feasibility | 权重 Weight | 加权得分 Weighted Score |
|-----------------|---------------------|-----------|---------------------|
| 技术可行性 Technical | ☑ 可行 □ 不可行 | 30% | 9.0 |
| 经济可行性 Economic | ☑ 可行 □ 不可行 | 30% | 10.0 |
| 操作可行性 Operational | ☑ 可行 □ 不可行 | 20% | 9.0 |
| 时间可行性 Schedule | ☑ 可行 □ 不可行 | 10% | 7.0 |
| 法律合规 Legal | ☑ 合规 □ 不合规 | 10% | 10.0 |
| **综合得分 Total Score** | | **100%** | **9.2 / 10** |

### 9.2 最终建议 Final Recommendation

☑ **建议立项 APPROVE** - 项目可行，建议启动
□ **有条件立项 CONDITIONAL APPROVE** - 满足特定条件后可启动
□ **不建议立项 REJECT** - 风险过高，不建议启动

### 9.3 前置条件 Pre-conditions (如有条件立项)

> 虽为"建议立项"，以下三项作为项目执行的纪律性前置（避免立项后返工）：

1. 01 需求文档（M2，2026-09-19）完成「计划单片组件」语义定义初稿并评审冻结
2. 02 系统设计首周完成技术选型（3.2 候选内决策）与存储格式契约定义
3. MVP 范围冻结在"存储 + 渲染 + 溯源查询（基础版）"，新增需求走变更控制流程（见项目章程 §12）

### 9.4 关键成功因素 Critical Success Factors

1. 设计前置决策不拖延：存储格式与技术选型在 02 首周定案（本次会话已通过问答确认候选思路）
2. 组件语义早冻结：5 类组件的"渲染 + 编辑"行为在 01 文档内明确，避免开发期返工
3. 时间投入可预期：以"里程碑核销"制度管理进度，滑移时按优先级降级而非扩期
4. 数据安全设计约束：明文件化存储 + 二次确认，保证个人数据"可备份、可恢复"

---

## 附录 Appendix

### 附录A：详细成本计算表 Detailed Cost Calculation

单项目无现金流，仅时间成本：需求 2 周 + 设计 3 周 + 开发 5 周 + 测试 2 周 + 上线 1 周 = 13 周 × 15h/周 ≈ 195h（全部由本人投入，无外包、无采购）。

### 附录B：技术调研报告 Technical Research Report

候选框架（Tauri 2.x / Electron / Flutter Desktop / WinUI 3-WPF）对"文件树拖拽、自定义组件渲染、本地检索"三能力的覆盖评估已在 §3.2 列表给出；深度调研、版本对比与最终决策（含包体/内存基准数据）在 02-系统设计-技术选型报告完成。

### 附录C：竞品分析 Competitive Analysis

竞品简析（下一步细化为正式竞品分析，归入 02 设计阶段或开源决策前）：

| 竞品 Competitor | 优势 Strengths | 劣势 Weaknesses（相对本需求） | 我们的机会 Our Opportunity |
|-----------------|--------------|----------------|------------------------|
| Notion | 通用笔记+数据库、生态大 | 重、需订阅/联网、计划即文档而非结构化 | 「计划即文件夹 + 组件渲染」更贴计划语义 |
| 滴答清单 | 任务清单轻量、体验好 | 无"计划"容器概念，无计划排版/溯源 | 计划级组织与溯源查询 |
| Obsidian | 本地文件、markdown | 非计划语义、markdown 编辑难（正是本方案弃 markdown 的理由） | 组件化免 markdown 编辑 |
| 印象笔记 | 老牌、同步 | 计划排版乱、结构化弱 | 同"计划语义"差异化 |

> 竞品结论：需求差异化明确（计划单片组件 + 文件夹即存储 + 溯源查询）；v1.0 无市场风险（自用），竞品分析仅服务"远期开源价值评估"。

---

**文档结束 End of Document**
