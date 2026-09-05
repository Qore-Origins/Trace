# 项目立项申请书 Project Proposal

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | 2026-09-05 |
| 最后修改 Last Modified | 2026-09-05 |
| 作者 Author | HeYS-Snowe |
| 审核人 Reviewer | HeYS-Snowe（单人项目自审） |
| 批准人 Approver | HeYS-Snowe |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 修改内容 Description |
|-------------|---------|---------------|-------------------|
| v1.0.0 | 2026-09-05 | HeYS-Snowe | 初始版本 Initial Version |

---

## 目录 Table of Contents

1. [项目背景 Project Background](#1-项目背景-project-background)
2. [项目目标 Project Objectives](#2-项目目标-project-objectives)
3. [项目范围 Project Scope](#3-项目范围-project-scope)
4. [预期收益 Expected Benefits](#4-预期收益-expected-benefits)
5. [资源需求 Resource Requirements](#5-资源需求-resource-requirements)
6. [风险评估 Risk Assessment](#6-风险评估-risk-assessment)
7. [时间计划 Timeline](#7-时间计划-timeline)

---

## 1. 项目背景 Project Background

### 1.1 立项背景 Initiation Background

本项目来源：个人长期计划管理实践中的真实痛点。现有方案（笔记软件、Markdown 文档、聊天记录、任务 App 混用）无法满足"计划集中管理、排版清晰、任务可追踪、来源可溯源"的完整需求。相关规划见《Future_Plan-20260825-桌面端计划管理软件》，应用已于 2026-09-05 定名**溯源（Trace）**，由 Qore（叩心）出品。

**当前问题 Current Issues:**
- 计划分散存储：计划散落在笔记、文档、聊天记录中，无统一归属，集成管理差
- 计划排版乱：手工用 Markdown / 文档排版，不同计划格式五花八门
- 任务管理差：任务与计划脱节，无状态追踪，完成情况无法一目了然
- 溯源、查询困难：想找到"某个任务的来源 / 某个计划的源头"时无从下手，检索无门
- 计划编辑难：直接编辑 Markdown 成本高、易出错，轻度修改也要面对整篇语法

**业务痛点 Business Pain Points:**
- 计划排版乱 → 难以阅读、难以复盘
- 集成管理差 → 计划碎片化，无单一入口
- 任务管理差 → 计划与执行脱节，无闭环
- 溯源、查询困难 → 历史计划不可找回，经验无法复用
- 计划编辑难 → 更新计划的心理门槛高，计划容易过期

### 1.2 项目来源 Project Source

| 来源类型 Source Type | 具体说明 Description |
|-------------------|-------------------|
| □ 客户需求 Customer Request | |
| ☑ 战略规划 Strategic Plan | Qore 产品版图个人工具线（个人项目战略） |
| □ 技术升级 Technology Upgrade | |
| □ 比赛竞赛 Competition | |
| ☑ 其他 Other | 个人生活需求：自用计划管理工具（痛点来自个人实践） |

---

## 2. 项目目标 Project Objectives

### 2.1 总体目标 Overall Objective

**项目愿景 Project Vision:**

打造一款个人桌面计划管理软件「溯源 Trace」——计划以文件夹为单位统一存储、以计划单片组件方式渲染与编辑、支持溯源查询，做到"计划有迹可循，随时回到源头"（呼应 Qore 口号「叩问本心，不忘初心」，即对应 Qore Origins 产品定位）。

### 2.2 具体目标 Specific Objectives

| 序号 ID | 目标描述 Objective | 成功标准 Success Criteria | 优先级 Priority |
|--------|-----------------|------------------------|---------------|
| 1 | 文件夹化存储：计划=文件夹，可嵌套 | 计划以文件夹为单位创建/移动/嵌套，拖拽可用 | P0 |
| 2 | 计划单片组件化渲染：5 类组件（单选计划、多选计划、任务列表、任务详情、注释） | 5 类组件均可正常渲染并编辑 | P0 |
| 3 | 溯源查询基础版：关键词检索 + 来源回溯 | 可检索计划/任务/注释，并从命中项回溯至所属计划 | P0 |
| 4 | 桌面端可运行 v1.0 | 目标平台（Windows 10/11，跨平台候选中，待 02 选型确认）可安装并稳定运行 | P0 |
| 5 | 数据本地化、可迁移 | 数据根目录即文件夹，可直接拷贝备份、迁移 | P0 |

### 2.3 关键成功指标 KSI (Key Success Indicators)

| 指标 Indicator | 目标值 Target | 当前值 Current |
|--------------|-------------|--------------|
| MVP 功能覆盖率（范围 vs 实现） | 100% | 0%（未启动） |
| 痛点覆盖数（5 大痛点） | 5/5 缓解 | 0/5 |
| 检索命中率（本地既有内容，经测试验证） | 100% 无漏检 | 未验证 |
| 首位里程碑（需求确认） | ≤ 2026-09-19 | 未开始 |
| MVP 交付日期（估算） | ≤ 2026-12-05 | 未开始 |

---

## 3. 项目范围 Project Scope

### 3.1 项目边界 Project Boundaries

#### 包含范围 In Scope

- 存储模块：计划库根目录管理（用户指定数据根目录）；计划文件夹创建/重命名/删除；文件夹嵌套；拖拽移动/排序
- 页面渲染模块：计划单片组件自定义渲染（单选计划、多选计划、任务列表、任务详情、注释）；组件内内容编辑（渲染即编辑）
- 溯源查询模块（基础版）：关键词检索（计划/任务/注释）；来源回溯定位（从命中项定位到所属计划）
- 生命周期文档集：00 项目启动、01 需求分析、02 系统设计、03-07 各阶段文档（随阶段产出）

#### 不包含范围 Out of Scope

- 用户登录注册、多用户、账号体系（方案中已注释删除，不做）
- 云端同步、云端服务（v1.0 完全本地，数据不出设备）
- 移动端 / Web 端（v1.0 仅桌面）
- Markdown 直接编辑（已被「自定义渲染模块」方案取代）
- 系统设置（主题、偏好等，远期 P2）
- 团队协作、多端协同
- AI 辅助能力（远期再议）

### 3.2 交付物 Deliverables

| 序号 ID | 交付物名称 Deliverable | 交付时间 Due Date | 负责人 Owner |
|--------|---------------------|-----------------|------------|
| 1 | 00 项目启动文档（立项/可行性/章程） | 2026-09-05 | HeYS-Snowe |
| 2 | 01 需求分析文档（调研/BRD/PRD/功能规格/原型） | 2026-09-19 | HeYS-Snowe |
| 3 | 02 系统设计文档（含技术选型报告） | 2026-10-10 | HeYS-Snowe |
| 4 | MVP 可运行版本 v1.0（三模块） | 2026-11-14 | HeYS-Snowe |
| 5 | 测试报告 | 2026-11-28 | HeYS-Snowe |
| 6 | 安装包 + 发布说明 Release Notes | 2026-12-05 | HeYS-Snowe |
| 7 | 用户手册（07 用户文档） | 2026-12-05 | HeYS-Snowe |

---

## 4. 预期收益 Expected Benefits

### 4.1 业务价值 Business Value

| 收益类型 Benefit Type | 描述 Description | 量化指标 Metric |
|-------------------|----------------|---------------|
| 经济效益 Economic | 无直接货币收益（自用工具） | ¥0（现金投入为 ¥0，参见 5.3） |
| 效率提升 Efficiency | 计划集中管理、排版规范化、任务带状态、检索秒级定位 | 预期年节省 ≥ 100 小时（估算：约 2 小时/周，待实测校准） |
| 用户体验 User Experience | 五痛点全部获得方案级覆盖，计划管理从"负担"变"有迹可循" | 自用连续使用 ≥ 4 周无弃用 |

### 4.2 成本效益分析 Cost-Benefit Analysis

| 项目 Item | 金额/描述 Amount | 说明 Notes |
|----------|----------------|----------|
| 预计总成本 Total Cost | 现金 ¥0；时间约 13 周 × 15h/周（估算） | 单人业余时间投入，设备/工具链均为既有 |
| 预计收益 Expected Return | 时间收益：年节省 ≥ 100h（估算）；品牌收益：Qore 个人工具线作品 | 收益以时间与品牌计，不折算现金 |
| 投资回报率 ROI | 不适用（无现金口径） | 以"省时 + 自用工具自足"为目标 |
| 回收周期 Payback Period | 预期当年内回本 | 13 周开发期 ≤ 首年 100h 节省 |

---

## 5. 资源需求 Resource Requirements

### 5.1 人力资源 Human Resources

项目为单人项目（事实来源：`D:\Code\.Rules\OrganizationAndUser.md` §二 唯一开发者、合作伙伴暂无）。全部角色由 HeYS-Snowe 兼任，开发过程由 AI 代理（Claude Code 等）提供编码辅助。

| 角色 Role | 人数 Count | 技能要求 Skills | 工作内容 Work Content |
|----------|----------|---------------|-------------------|
| 项目经理 PM | 1（兼任） | 全栈经验、AI 协作熟练 | 范围冻结、里程碑核销、文档产出 |
| 前端开发 Frontend | 1（兼任） | 桌面端 UI 开发、自定义渲染 | 渲染模块、组件编辑、原型落地 |
| 后端开发 Backend | 1（兼任） | 文件系统抽象、检索实现 | 存储模块、索引与检索、数据契约 |
| 设计师 Designer | 1（兼任） | 信息架构、低保真原型 | 布局、导航、组件交互定义 |
| 测试工程师 QA | 1（兼任） | 功能测试、数据安全测试 | MVP 测试、异常场景验证、发布检查 |

### 5.2 技术资源 Technical Resources

| 资源类型 Resource Type | 具体内容 Details | 数量 Quantity |
|---------------------|----------------|-------------|
| 服务器 Servers | 无（本地应用，无需服务器） | 0 |
| 开发工具 Tools | 开发机（现有 Windows PC）、编辑器/IDE（GitHub Copilot 类、CC 等 AI 代理） | 1 套（既有） |
| 第三方服务 3rd Party Services | 无（本地优先，不依赖网络服务） | 0 |
| 域名/证书 Domains/Certificates | 无（本地应用；若远期发布 GitHub 仓库 `qore/trace` + 开源，无额外费用） | 0 |

### 5.3 预算估算 Budget Estimate

| 类别 Category | 金额 Amount | 说明 Description |
|-------------|----------|----------------|
| 人力成本 Labor | ¥0 | 业余时间投入不计现金；估算 195h（13 周 × 15h） |
| 硬件设备 Hardware | ¥0 | 使用现有设备 |
| 软件许可 Software | ¥0 | 使用免费/开源工具链（候选框架均 MIT/Apache 类许可，详见可行性报告） |
| 服务费用 Services | ¥0 | 无服务器、无云服务 |
| 其他 Others | ¥0 | 无 |
| **总计 Total** | **¥0** | 现金成本为零 |

---

## 6. 风险评估 Risk Assessment

### 6.1 风险识别 Risk Identification

| 风险ID Risk ID | 风险描述 Risk Description | 影响程度 Impact | 发生概率 Probability | 风险等级 Risk Level | 应对措施 Mitigation |
|--------------|----------------------|---------------|-------------------|------------------|------------------|
| R001 | 存储格式未定型：文件夹内文件格式后期变更，迁移成本高 | 高 | 中 | 中 | 02 设计阶段尽早定型格式，带格式版本号，保证程序可读旧格式 |
| R002 | 技术栈未定：候选（Tauri/Electron/Flutter/原生）差异大，选错返工 | 中 | 低 | 中 | 00/01 仅做候选评估；02 首周锁定选型；原型不绑定选型 |
| R003 | 组件语义未定义：「计划单片组件」5 类型只有名称无行为定义 | 高 | 中 | 高 | 01 按字面拟定义初稿，评审后冻结为规格 |
| R004 | 进度延期：单人 + 多项目并行 | 中 | 中 | 中 | MVP 范围冻结；日程留 2 周缓冲；里程碑逐项核销 |
| R005 | 个人数据误删/损坏：计划文件夹被误操作或程序缺陷破坏 | 高 | 低 | 中 | 数据即明文件文件夹（可随时拷贝备份）；异常操作提供二次确认（设计约束） |

### 6.2 关键风险分析 Critical Risk Analysis

**技术风险 Technical Risks:**
存储格式与渲染耦合风险最高：决定"文件夹内放什么"必须先行（02 设计）。技术栈选项均成熟，无技术壁垒性风险。

**资源风险 Resource Risks:**
无外部资源依赖（0 服务器、0 第三方），唯一资源约束为个人时间投入。

**时间风险 Schedule Risks:**
MVP 里程碑排期基于"每周约 15 小时业余投入"估算，已含 2 周缓冲；学习 Rust（若选 Tauri）会占用额外时间，是本排期最大变量。

**市场/竞争风险 Market Risks:**
无（自用工具，无目标市场；远期若开源，同类产品有 Notion、滴答清单、Obsidian 等，差异化点在"计划单片组件 + 文件夹即存储 + 溯源定位"，详见 01-2 BRD 竞品简析）。

---

## 7. 时间计划 Timeline

### 7.1 项目里程碑 Project Milestones

| 序号 ID | 里程碑 Milestone | 计划日期 Planned Date | 关键交付物 Key Deliverables |
|--------|----------------|---------------------|--------------------------|
| M1 | 项目启动 Project Kickoff | 2026-09-05 | 项目章程、开发计划（00 文档） |
| M2 | 需求确认 Requirements Approval | 2026-09-19 | PRD、功能规格明细、原型（01 文档） |
| M3 | 设计完成 Design Complete | 2026-10-10 | 设计文档（02 文档，含技术选型报告） |
| M4 | 开发完成 Development Complete | 2026-11-14 | 可演示版本（MVP 三模块） |
| M5 | 测试完成 Testing Complete | 2026-11-28 | 测试报告 |
| M6 | 正式上线 Launch | 2026-12-05 | 发布说明 Release Notes |

### 7.2 总体时间表 Overall Schedule

> 排期为估算初稿（个人业余时间投入，已含 2 周缓冲），实际以里程碑核销结果校准。

| 阶段 Phase | 开始日期 Start | 结束日期 End | 工期 Duration | 依赖关系 Dependencies |
|----------|--------------|------------|-------------|-------------------|
| 需求分析 Requirements | 2026-09-05 | 2026-09-19 | 2 周 | 无 |
| 系统设计 Design | 2026-09-19 | 2026-10-10 | 3 周 | 需求完成 |
| 开发实施 Development | 2026-10-10 | 2026-11-14 | 5 周 | 设计完成 |
| 测试验收 Testing | 2026-11-14 | 2026-11-28 | 2 周 | 开发完成 |
| 部署上线 Deployment | 2026-11-28 | 2026-12-05 | 1 周 | 测试通过 |

---

## 8. 审批记录 Approval Record

> 单人项目：审批链各角色均由项目发起人（开发者本人）担任，自审自批；如后续引入协作者，需重新走本审批链。

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 项目申请人 Project Applicant | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 部门经理 Department Manager | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 技术负责人 Tech Lead | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 最终审批人 Final Approver | HeYS-Snowe | 电子批准 | 2026-09-05 |

---

## 附录 Appendix

### 附录A：参考资料 Reference Materials

- `D:\Desktop\Plan\Future_Plan\Future_Plan-20260825-桌面端计划管理软件.md`（需求方案，已镜像至 `docs\Plan\`）
- `D:\Desktop\Plan\Future_Plan\Future_Plan-20260905-桌面计划管理软件-命名设计.md`（命名定案）
- `D:\Code\.Rules\OrganizationAndUser.md`（组织/开发者身份 SSOT）

### 附录B：相关文档 Related Documents

- 00-项目启动 Initiation：可行性分析报告、项目章程（本阶段首批产出）
- 01-需求分析 Requirements：用户需求调研、BRD、PRD、功能规格说明书、原型设计文档（M2 前产出）

### 附录C：术语表 Glossary

| 术语 Term | 定义 Definition |
|----------|---------------|
| 计划（Plan） | 用户管理的对象，以文件夹为单位存储，可嵌套、可包含任务与注释 |
| 任务（Task） | 计划下的执行单元，具状态（未开始/进行中/完成） |
| 计划单片组件 | 计划渲染的最小单元，共 5 类：单选计划、多选计划、任务列表、任务详情、注释 |
| 溯源查询 | 对计划/任务/注释的检索与来源回溯能力；应用名"溯源"即源于此 |
| 计划库根目录 | 用户指定的数据根目录，计划文件夹树挂载于此，可整体拷贝备份 |
| MVP | Minimum Viable Product 最小可行产品，此处=存储+渲染+溯源查询三模块 |

---

**文档结束 End of Document**
