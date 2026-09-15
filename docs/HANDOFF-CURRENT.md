# Trace 当前协作状态

> 此文件是两个开发智能体的**当前唯一协作状态源**。历史交接文件保留为当时快照，不可用其判断当前任务。
>
> 更新：2026-09-16（Codex：第一批动作系统 Demo 已实现/自动验证，待用户体验；正式 src 未改）

## 接手前必做

### 第一批启动（2026-09-16，Codex）

- 用户已授权直接执行第一批：Task 1 基线、Task 2 动作系统 Demo；不越过用户验收进入 Task 3。
- 实测 HEAD `6113dbc`，main 领先 origin/main 10；已有审计/计划/规则文档改动及用户资源均保留。
- 所有权：`.gitignore`、`demo/frontend-foundation/`、本文件、共享计划 README/实施 MD/plan.json；正式 src 文件不修改。
- 隔离位置：`.worktrees/frontend-foundation`，分支 `codex/frontend-foundation`。共享状态继续在主目录维护；Demo 验收后删除或吸收原型，不保留为正式功能。
- 下一检查点：基线三跑与 Demo 构建完成；等待用户体验验收。

#### 第一批完成记录

- 主目录 HEAD `cfb34eb`，main 领先 origin/main 11；隔离分支 HEAD `000e48f`，工作区干净。Demo 未合并、未推送。
- 所有权补充：隔离分支 `.gitattributes`，固定 Muya 文本 LF；vendor 逻辑没有改动。初次检出导致 27 个文本 CRLF 指纹漂移，已恢复原字节，临时格式化已清理。
- 已实现：`demo/frontend-foundation/` 五类动作、原生 dialog 确认、单槽 5 秒撤销、原位恢复、主题、焦点、减弱动效。
- 已验证：`npm run typecheck` 0 错；`npm run test` 18 文件 185/185；`npm run build` 成功（renderer 3157 模块/9.12s/JS 2,629,864 B）；`npx vite build demo/frontend-foundation --outDir ../../out/demo/frontend-foundation` 成功；独立 Demo tsc 成功；Chrome/CDP 脚本删除/撤销/超时/Escape/四档宽度/暗色/减弱动效通过。
- 体验入口 `http://127.0.0.1:52820/`，Vite 在隔离工作区运行；README 含一命令启动方法。
- 下一步：用户验收 Demo；等待按钮密度/危险色/确认范围/5 秒期限结论；剩余 Task 3–11 及 Windows DPI/完整键盘人工验收。正式集成不提前实施。

1. 阅读本文件、仓库根 `AGENTS.md` 或 `CLAUDE.md`。
2. 执行 `git status --short --branch`，核对本文件的基线提交、分支领先状态与未跟踪文件；不一致时先更新本文件，禁止直接开始实现。
3. 对将修改的文件写明所有权；另一智能体占用或工作区存在相关未提交改动时，不得覆盖，先交接或拆分文件边界。

## 代码库基线

| 项 | 当前状态 |
|---|---|
| 分支 | `main` |
| 代码基线 | `e9a38b5` — 真实 Muya 全功能 Demo；已由 `git log` 实测 |
| 同步时远端 | `origin/main` / `gitee/main`=`5058037`；本地 `main` 含协作状态、缺陷修复、Muya 规格、快照、运行时与 Demo，领先 10 个提交，尚未推送 |
| 已发布版本 | v0.12.0 Beta 4（2026-09-12） |
| 工作区非代码文件 | `Resource/pic/`、`Resource/vid/` 未跟踪，属用户资源，禁止暂存、删除或重命名 |

## 当前工作项：注释格式工具栏 + 自动换行（已完成）＋ 注释 Markdown 深度改造（移交 Codex）

| 字段 | 状态 |
|---|---|
| 阶段 | 工具栏/折行已完成；Muya 深度改造的真实 Demo 已完成，等待用户验收后进入正式集成 |
| 产物 | NoteCard 编辑态格式工具栏（7 钮选区包裹）+ 渲染态折行（默认折行、无横向滚动条；开关可切回原始排版）+ 渲染器扩展（~~删除线~~ / <u>下划线</u>） |
| 已验证 | 当前基线：typecheck 0 错；test 185/185；真实 Muya Demo 和项目构建均成功；浏览器自动验收通过 |
| 未验证 | 用户手动体验：中文输入法、剪贴板、语言选择浮层、连续删除手感与最终视觉 |
| 文件所有权 | Codex 继续持有 Muya 快照/适配层/Demo，以及后续 `cards.tsx` NoteCard 段、`note-md.tsx`、pref-store 和设置宿主；Claude 避开这些边界 |

## 已闭环：F2 回忆视图

- `9d4663e` 已实现 F2：那年今日、里程碑、随机回忆、右列当日预览、树定位与第三顶栏导航；主进程日记查询、IPC、视图、i18n、样式与 diary-service 单测均已落盘。
- 后续高度与顶栏缺失问题已分别在 `3475317`、`99e3be1` 修复；用户真机验收已由 `edc12e0` 记录为通过。
- F2 不再是待实施项。除维护/缺陷修复外，不得以“继续 F2”为由重复改造其已登记文件。
- **缺陷修复（Codex，本轮）**：`b5fea55` 已修复 `MemoriesView.tsx`、`diary-service.ts`、`ipc-contract.ts`、`diary-service.spec.ts`：当日预览按 kind 映射 i18n 标签；“抽一天”使用完整历史池；错误提示接入主题宿主；分数/组件数/年前文案本地化。完整验证：typecheck 0 错、test 179/179。

## 移交 Codex：注释 Markdown 深度改造（用户 2026-09-14 指令）

| 字段 | 内容 |
|---|---|
| 意图 | 完整移植 MarkText/Muya 注释编辑体验：同一编辑面实时渲染、自动补全与代码语言选择，替代当前"预览/编辑双态"；设置中只保留「实时渲染」开关 |
| 设置交互规范 | 设置弹窗中的配置项：**鼠标悬停 2 秒显示该项的描述**（tooltip 延迟 2s；建议对所有配置项补描述文案，统一交互） |
| 参考源码 | `D:\Code\Project\marktext-develop\packages\muya`（`@muyajs/core 0.2.0`；当前目录不是 Git 工作树，首次快照以版本、锁文件和内容 SHA-256 建立来源基线） |
| 现状基础 | note-md.tsx 自研渲染器（块：code/list/quote/hr/table/para；行内：粗/斜/删/下划线/行内码/链接；代码高亮 highlight.js lib/common）；NoteCard 双态卡 + 格式工具栏（7 钮选区包裹）+ wrap 折行 |
| 建议文件边界 | `src/renderer/src/components/note-md.tsx`、`cards.tsx`（NoteCard 段）、`views/WorkspaceView.tsx` 或设置宿主（新配置项）、`i18n/locales/*`、对应新测试。与 Claude 在办工作无重叠 |
| 验收标准 | 用户真机：输入即在当前编辑面排版；删除时仅正在删除的格式 token 回退源码；设置「实时渲染」可配；配置项悬停 2s 出描述 |
| 已确认 | 「实时渲染」默认**开启**，不再并列「自动渲染」概念；关闭时显示完整 Markdown 标记，不退回 textarea 双态。 |

### 2026-09-15 范围升级

- 用户明确要求完整移植 MarkText/Muya 的实时渲染与自动补全，不接受 textarea/预览切换式模拟。
- 已批准启用全部 Muya 功能，包括 Mermaid、Vega、PlantUML、Flowchart、Sequence 等重型图表；采用单活动编辑器控制资源占用。
- 已批准内置 Muya 源码快照；PlantUML 默认不连接公共服务器，配置本地或自有 Server 后才渲染。
- 用户根据 v3 截图确认模拟 Demo 与 MarkText 差距过大：输入没有真实实时渲染；「实时渲染/自动渲染」语义冲突；删除格式内容时缺少 token 级局部源码回退。该模拟 Demo 作废，后续 Demo 必须运行真实 Muya 内核。
- 设计规格：`docs/superpowers/specs/2026-09-15-muya-note-editor-design.md`；实施计划：`docs/superpowers/plans/2026-09-15-muya-note-editor.md`。
- `2d87af7` 引入可核验 Muya 0.2.0 源码快照；`330d3df` 建立完整运行依赖、选项、插件注册与语义主题桥；`e9a38b5` 交付 `demo/muya-note-editor/` 真实 Demo。
- Demo 已自动验证：真实编辑面与 Markdown 真源同步；4 个本地图表生成 SVG；PlantUML 默认离线；实时渲染/自动换行开关生效；输入 `*` 自动配对为 `**`；粗体内 Backspace 后仅当前粗体 token 变为源码标记，紧邻链接仍保持渲染。

## 结构性待办（地基欠账登记）

- **视图骨架提升**：TopBar/StatusBar 目前由各视图自行渲染（WorkspaceView/DiaryView/MemoriesView 三份）——新增视图必漏顶栏（MemoriesView 2026-09-12 实证漏配，已补）。正解 = TopBar（与 StatusBar）提升到 App 层单点渲染，与弹层底座（评审 Important-1 已做）同批；涉及两个已验收视图的骨架调整，实施前须用户确认。

## 2026-09-15 前端综合审计与整改计划

| 字段 | 状态 |
|---|---|
| 审计范围 | 前端视觉/UI/排版、同功能组件、动画动效、renderer 性能和前端架构 |
| 审计报告 | `docs/audit/2026-09-15-frontend-ui-performance-architecture-audit.md` |
| 计划索引 | `docs/Plan/README.md` |
| 执行计划 | `docs/Plan/Future_Plan/Qore/Trace/Plan-260915-01-前端体验与地基整改/Frontend-Experience-Foundation-Implementation-Plan.md` |
| Trace 镜像队列 | 同目录 `plan.json`，结构参考 `D:\Desktop\Plan\Future_Plan\Qore\Trace\Plan-260911-01\plan.json` |
| 当前阶段 | 第一批 Demo 已实现并自动验证，待用户验收；正式实现未开始，计划状态为“实施中” |
| 本轮文件所有权 | Codex 仅持有上述审计/计划文档、本 HANDOFF 及 `AGENTS.md`/`CLAUDE.md` 的共享计划规则更新；未声明任何正式前端源文件所有权 |
| 实测证据 | `npm run build` 成功；renderer 3157 modules，JS 2,629,864 B（gzip 547,329 B），CSS 46,358 B，renderer build 8.38s |
| 高优先问题 | 删除语义不一致、文字对比度/焦点不足、整文档高频 clone + 全卡重渲染、单一 renderer chunk、AppShell/CSS/cards 职责未收口 |

计划执行规则：Codex 与 Claude Code 接手任何 Task 前先读取 `docs/Plan/README.md`、执行计划和本文件；在本文件登记执行者与精确文件边界后，才允许修改正式代码。每个提交后同步 Markdown 复选框、`plan.json` 状态、实际验证结果和提交 hash。

## 下一动作与阻塞

- 下一动作 A（Muya 主线）：用户打开真实 Muya Demo，重点验收中文输入法、剪贴板、语言选择浮层、视觉与连续删除手感。Claude 继续避开 vendor/muya、Muya 适配层、`cards.tsx` NoteCard 区段、`note-md.tsx`、pref-store 和设置宿主。
- 下一动作 B（前端地基）：第一批动作系统 Demo 已交付，打开 `http://127.0.0.1:52820/` 验收；确认后登记 Task 3 正式组件文件所有权。
- 等待：Muya Demo 和动作系统 Demo 用户验收。确认前不进入正式 NoteCard 集成，也不修改审计涉及的正式前端代码。
- F2 已闭环，不再构成阻塞或并行边界。
- 待推送：主目录领先 11 个提交；Demo 独立在 `codex/frontend-foundation`，未经用户授权不推送远端。

## 核验记录

| 时间 | 智能体 | 动作与验证 |
|---|---|---|
| 2026-09-14 | Codex | 接手核验：建立本文件，确认原型 node --check 通过 |
| 2026-09-14 | Claude | `git status --short --branch` 实测：ahead 2（65571da + 4018864），工作区仅用户资源未跟踪 ✓；HEAD hash 核正（35d85fd→4018864，git log 实测）；登记 F2 实施所有权（文件边界见上表）；推送双端（含本核正提交） |
| 2026-09-14 | Codex | 完整读取主智能体 96 条真人用户消息（约 1.37 万字），以 `git log`/`git status` 核正：HEAD/双端=`5058037`、F2 已实现且真机验收通过；确认注释 Markdown 深度改造移交 Codex。 |
| 2026-09-14 | Codex | 针对 Claude 当日 F2 增量完成安全审查：未发现可利用漏洞；功能审查确认四项缺陷。`b5fea55` 已修复，定向回归 21/21、完整测试 179/179、typecheck 0 错。 |
| 2026-09-15 | Codex | 真实 Muya Demo 完成：`npm run typecheck` 0 错；`npm run test` 18 文件、185/185；`npm run demo:muya:build` 成功（3998 模块）；`npm run build` 主/预载/渲染三段成功；隔离 Chrome/CDP 自动断言实时编辑、4 类本地图表、PlantUML 离线、开关、自动配对和 token 级删除隔离全部通过。 |
| 2026-09-15 | Codex | 完成前端 UI/视觉/动画、性能、架构综合审计并落盘；按 `D:\Desktop\Plan` 层级建立 `docs/Plan/Future_Plan/Qore/Trace/Plan-260915-01-前端体验与地基整改/`，同时生成 Markdown 执行真源与 Trace `plan.json` 镜像。实测 `npm run build` 成功：renderer 3157 modules、JS 2,629,864 B、CSS 46,358 B、8.38s。正式代码未修改。 |
| 2026-09-15 | Codex | 计划落盘校验通过：Node JSON.parse 成功、16 个唯一 32 位 ID、Markdown 与 JSON 均为 11 个有序任务；占位词扫描无命中；`git diff --check` 通过。共享计划读取/更新规则已同步到 `AGENTS.md` 和 `CLAUDE.md`；本轮仅文档变更，未提交、未推送。 |

## Claude 致 Codex 的交接备忘（长期有效的技术约定）

1. **基线**：typecheck 0 错 + test 172/172（v0.12.0 后）。接手后先跑一遍对齐；低于此数说明环境/代码被动过。
2. **深色主题已全量落地**——新写 UI **必须用 workspace.css 的语义 token**（--paper/--text-*/--warn-bg/--danger-text/--hl-* 等），**禁硬编码色**（本会话刚完成 40 处收敛，别再新增）。原生控件（date picker/滚动条）靠 `color-scheme` 已兜住。
3. **弹层禁用 antd 静态方法**（`message.*`/`Modal.confirm`）——它们不吃主题算法，暗色下发白。一律经 `src/renderer/src/antd-host.ts` 的 `getMessage()`/`getModal()`（antd App 组件绑定，全库 24 处已迁移）。
4. **ERROR 库高价值条目**（`D:\Code\.Rules\ERROR\entries\`）：`inline-span-transform-ignored`（动画容器必须 block/inline-flex，裸 span transform 静默失效）、`catch-comment-claims-phantom-mechanism`（注释声称"由别处处理"的兜底，先验证机制真实存在）、`gitee-release-chinese-garbled`（Gitee 发布四坑：SSH 推送/`target_commitish` 参数/中文走 UTF-8 JSON 文件传输/附件 100MB 上限）。
5. **发布惯例**：版本三件套（package.json + package-lock + CLAUDE.md 当前版本行 + CHANGELOG）→ build:win → 归档 builds/windows/ + SHA-256（pwsh Get-FileHash）→ build_history/release_notes/release_history 三账本 → GitHub `gh release create + upload` → Gitee API（payload 文件法）→ 双端 push。
6. **排序契约**：树子项 = `localeCompare(b, 'zh-CN', { ignorePunctuation: true })`——混用分隔符的命名按日期直觉序（2026-09-12 修复，勿回退为无参 localeCompare）。

## 稳定用户偏好与设计理念（历史蒸馏）

1. **产品方向**：Trace 是本地优先、明文件可迁移的计划管理器；可逐步长成日记工具，但当前决策应优先服务计划管理主线。
2. **交互标准**：禁止突兀的属性切换和布局顶动；位置、透明度、尺寸、状态变化均须有合适过渡。若视觉效果不对，先复现并追到系统性根因，不能只补表面。
3. **设计方法**：涉及新形态、动画或复杂交互，先在 `demo/` 出可体验原型，用户定稿后再移植；demo 不放 `docs/`。用户会以截图/录屏验收，必须检查遮挡、溢出、拖拽裁切及真实动线。
4. **界面取向**：简洁、留白、语义清晰；可以借鉴 VS Code/MarkText 的行为逻辑，但不照搬视觉。计划与文件夹、计划与日记等不同语义必须在视觉和操作上可区分。
5. **编辑体验**：组件渲染即编辑；Markdown 应可读、可即时预览，并逐步向 MarkText 的所见即所得体验靠拢。格式工具服务真实编辑，不引入无关富文本架构。
6. **数据语义**：用户可选字段必须允许清空；预设插入是快照，不应反向影响已插入内容；本地数据安全、可备份、可恢复优先。
7. **工程协作**：范围不足时先澄清，不自行假设；实现后必须给出实际验证证据。多智能体采用“潮汐雁阵 Tidal Echelon”错峰协作：先登记文件所有权、状态与验证，再改代码。
8. **交付习惯**：版本按 Git 里程碑推进；发布须双端同步并保存构建账本。用户确认“继续/无异议”后可推进下一阶段，但涉及设计选择时仍先给可验收方案。

## 更新协议

每次开始、完成、暂停或移交一个工作项时，实施智能体必须原子更新本文件，至少写清：

- 当前 HEAD、远端领先/落后状态、工作区例外；
- 阶段、已完成项、尚未完成项、验证命令及其实际结果；
- 当前文件所有权和下一动作；
- 已知阻塞、用户待确认事项。

不得把“已讨论”“已写原型”“测试应当会通过”写成“已实现”或“已验证”。
