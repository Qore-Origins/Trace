# Trace 当前协作状态

> 此文件是两个开发智能体的**当前唯一协作状态源**。历史交接文件保留为当时快照，不可用其判断当前任务。
>
> 更新：2026-09-23（Codex：Task 9 已按用户选项 1 合入本地 main）

## 接手前必做

### Task 9 本地集成完成（2026-09-23，Codex；当前状态）

- 用户选择选项 1；实测 main 从 `ac0623c` fast-forward 到 `29305f6`，其中代码提交 `0fe64f2`、隔离计划提交 `29305f6`。合并后 main ahead origin/main 33，未 pull、未 push；工作区只有用户 `Resource/pic/` 与 `Resource/vid/` 未跟踪，未触碰。
- main 合并后实跑 `npm run typecheck` 0 错、`npm run test` 28 文件 244/244、`npm run build` 成功。Task 9 功能边界与 CDP 单轮性能证据见下方隔离快照和共享计划；真实 Electron/DPI 仍未验收，小树收拢 P95 约 50ms 不标为达标。
- Task 9 源码与测试文件所有权释放；接下来可登记 Task 10 真实 Electron 性能报告。等待正式 Muya NoteCard 人工体验结论；剩余 Task 10、Task 11、真实 Electron/DPI 验收。

### Task 9 隔离实施快照（2026-09-23，Codex；历史）

- 最新隔离代码提交经 `git log` 实测为 `0fe64f2`（`perf(tree): 收窄树订阅与搜索渲染`），位于 `.worktrees/frontend-foundation-task9` / `codex/frontend-foundation-task9`，尚未合入 main、未推送；本段以下启动时 main `edd7176` 是历史基点而非当前分支 HEAD。共享计划 MD 五步已勾选，原生 `plan.json` 因待集成仍标 `in_progress`。
- 已实现：行节点仅订阅自身选中、展开、加载，组只订阅自身展开及直接子项；Panel 不再订阅全量树状态，交互 Context 使用稳定 callback + memo。1000 行展开局部子树时无关行重渲染由诊断红灯 999 次降到 0。300 行以上折叠跳过全树收牌广播、直接卸载子组，小树发牌/收牌保留。搜索首批最多 100 条、逐批加载、显示已显示/总数，结果改原生 button；`tree-store.ts`、IPC、Muya 均未修改。
- 已验证：`npm run typecheck` 0 错，`npm run test` 28 文件 244/244，`npm run build` 主进程/预加载/renderer 成功，`git diff --cached --check` 无内容错误；Chrome CDP 内存宿主 `tree-perf-check.mjs`、`search-paging-check.mjs` 通过。最近一次 1000 行收拢 P95 帧间隔 16.8ms，降级前曾见约 548ms；100 行原动画收拢单轮 P95 50.1ms，真实 Electron 性能仍待 Task 10。Tracing 风格+布局阶段累计 0.59–0.68ms，CDP `LayoutDuration` 读数恒 0，不能作为布局实测值。
- 工作区：隔离分支代码与共享文档均已提交，工作区干净；用户 `Resource/pic/`、`Resource/vid/` 始终未触碰。下一步按用户选项本地集成或保留分支；等待正式 Muya NoteCard 人工体验结论。剩余 Task 10 真实 Electron 性能报告、Task 11 文档闭环、真机/DPI 验收。

- 实测 main HEAD `edd7176`、ahead origin/main 30；工作区仅用户资源 `Resource/pic/`、`Resource/vid/` 未跟踪，另无在用 worktree。正式 Muya NoteCard 已合入 main，人工体验验收仍待用户反馈，不把该门槛写为通过。
- 执行真源：`docs/Plan/Future_Plan/Qore/Trace/Plan-260915-01-前端体验与地基整改/Frontend-Experience-Foundation-Implementation-Plan.md` Task 9；镜像为同目录 `plan.json`。
- Codex 所有权：`src/renderer/src/components/PlanTreePanel.tsx`、`src/renderer/src/stores/tree-store.ts`（若需新增局部 selector）、`src/renderer/src/components/SearchOverlay.tsx`、`src/renderer/src/styles/search.css`、`src/renderer/src/i18n/locales/zh-CN.ts` 与 `en-US.ts` 的 search 文案、对应新测试和 `demo/frontend-foundation/` 的性能验收脚本、共享计划/HANDOFF。Claude Code 避开这些精确文件或先显式交接；Muya/NoteCard 不在本任务范围。
- 实施目标：1000 可见节点展开叶级父节点时，无关树行不因全量 `expandedKeys` 订阅重渲染；搜索结果首批至多 100 条，可逐批查看更多并展示总数，结果项使用原生 button；保留发牌/收牌交互并据实际 100/1000 节点采样决定大树动画降级。
- 下一步：建立隔离 worktree、复验基线、先做计数诊断，再按测试先行实施。等待：正式 Muya 卡片的用户体验结论；剩余 Task 9–11 与 Electron 真机/DPI 验收。

### Muya 正式集成代码完成（2026-09-17，Codex；当前最高优先级）

- 用户“Demo 手感可以”已解锁正式集成；代码提交 `d0acd3b`（`feat(note): 集成 Muya 实时注释编辑器`）及计划提交 `1a33af6` 已按用户选择 1 fast-forward 到本地 main，合并时 main HEAD `1a33af6`、ahead origin/main 29，未推送，仍只有用户 `Resource/pic/`、`Resource/vid/` 未跟踪。
- 已实现：NoteCard 移除旧 textarea/七按钮/预览编辑双态；点击静态 Markdown 激活真实 Muya；独立 store 保证单活动实例；150ms Markdown 桥接且切卡/卸载 flush 最终内容并 destroy；加载失败保留 textarea；非活动卡继续轻量 `NoteMarkdown`。
- 设置：实时渲染、自动换行默认开启；PlantUML 默认空 Server 离线；三项持久化且所有设置标签悬停 2 秒显示描述；错误提示走 `getMessage()`。Muya 异步加载期间读取最新设置，主题类使用语义 token。
- 安全自审：Muya 链接回调仅放行 HTTP(S)；阅读态旧 `NoteMarkdown` 的 `javascript:`、`data:` 和相对目标不再生成 `<a>`，代码高亮继续转义；renderer 未引入文件系统访问，IPC/计划格式/vendor 未改。
- TDD/验证：三批正式集成测试均先红后绿；危险链接测试先红后绿。最终 `npm run typecheck` 0 错，`npm run test` 28 文件 244/244，`npm run build` 成功（renderer 7151 模块；入口 644.91 kB；Muya 2,548.81 kB 与 190.61 kB CSS 保持异步），`npm run demo:muya:build` 3998 模块成功。全量并行测试曾因测试内动态 import 超过 5 秒出现 1 次超时，改为顶层导入后重新全量 244/244。
- 文件所有权继续由 Codex 持有直至正式卡片验收/合并：`MuyaNoteEditor.tsx`、`note-editor-store.ts`、`muya-note-integration.spec.tsx`、`cards.tsx` NoteCard、`note-md.tsx`/测试、pref-store、App 设置宿主、双语 i18n、cards/Muya CSS、共享计划/HANDOFF。Claude Code 继续避开这些边界。
- 下一步：用户在正式 NoteCard 验收 IME、剪贴板、语言选择、连续删除、切卡 flush、亮暗主题和窄窗口；等待该结论后选择合并或修正。剩余：正式卡片真机验收、前端地基 Task 9–11、Electron 真机/DPI 与真实性能验收。

### Task 8 启动（2026-09-17，Codex；优先于下方完成快照）

- 隔离实现 `14cef79`（`perf(bundle): 延迟加载页面与 Muya 运行时`）已按用户选项 1 fast-forward 到 main；集成时实测 main HEAD `14cef79`、ahead origin/main 25，未推送。本文档提交后最新 HEAD/领先数以 `git log`、`git status` 为准。Task 8 本批完成，验收门槛内的正式 NoteCard/Muya 激活仍未实施。
- 已实现：Diary/Memories 使用 React.lazy + Suspense，Workspace 保持首屏；fallback 使用 `--paper`/`--text-2`；React/Antd/dnd 稳定分包；Muya 适配层改为动态 import，真实 Demo 入口只在启动编辑器时加载运行时，退出仍 destroy；vendor Mermaid/Vega/PlantUML 边界未改。
- 构建结果：renderer 从单一 2,645,435 B 入口拆为入口 634.15 kB、React 555.79 kB、Antd 1,315.45 kB、dnd 116.05 kB、Diary 14.98 kB、Memories 9.44 kB；Task 4–7 遗留的三条 store 混合导入警告已清零，无循环 chunk 警告。Muya Demo 入口 4.86 kB，Muya 核心 1,492.52 kB 为异步块，Mermaid/Vega 继续独立延迟加载。
- TDD/验证：预算、懒页面、Muya 边界及 store 导入测试均先红后绿；最终 `npm run typecheck` 0 错，`npm run test` 27 文件 234/234，`npm run build` 成功且 renderer 无警告，`npm run demo:muya:build` 3998 模块成功。Demo 大块警告仍来自获准启用的完整 Muya/图表能力，不等同正式首屏回归。
- 基线异常记录：新 worktree 首次检出把 Muya 源码换行为 LF，导致字节指纹测试误报；同步主目录已验证的快照字节后 230/230 基线恢复且 Git 内容无差异。该换行/指纹一致性债务未用改指纹掩盖，后续应独立修正检出策略。
- 主目录合并后复验：`npm run typecheck` 0 错；`npm run test` 27 文件 234/234；`npm run build` 成功且 renderer 3174 模块、10.14s、零警告；`npm run demo:muya:build` 3998 模块、18.82s 成功，完整 Muya/图表异步块仍有预期的大块提示。
- 下一步：正式 NoteCard/Muya 接入继续等待真实 Demo 中文输入法、剪贴板、语言选择和连续删除手感的用户验收；若暂不验收，可先推进不占用 Muya 边界的 Task 9。剩余 Task 8 验收门槛、Task 9–11、Electron 真机/DPI 与真实性能验收。

- 用户“继续”确认进入 Task 8；实测 main HEAD `3b98bb8`、ahead origin/main 24，工作区仅用户 `Resource/pic/`、`Resource/vid/` 未跟踪，保留且不触碰。
- 隔离位置：`.worktrees/frontend-foundation-task8`，分支 `codex/frontend-foundation-task8`。Codex 所有权：`src/renderer/src/App.tsx`、`src/renderer/src/components/muya-note/muya-runtime.ts`、`src/renderer/src/stores/app-store.ts`、`src/renderer/src/components/TopBar.tsx`、`electron.vite.config.ts`、`demo/muya-note-editor/main.ts`、`test/app-shell.spec.tsx`、`test/muya-demo.spec.ts`、新建 `test/bundle-budget.spec.ts`；Claude Code 避开这些边界。补充两个文件仅用于清除 Task 4–7 持续登记给 Task 8 的三条无效混合导入警告，不改变 store 行为。
- 实施契约：Workspace 保持首屏，Diary/Memories 采用 React.lazy + Suspense；Muya 适配层改为显式异步加载并由真实 Demo 验证，保留 vendor 图表动态 import。正式 NoteCard/Muya 接入仍以真实 Demo 用户体验验收为门槛，本任务不修改 `cards.tsx`、`note-md.tsx`、`pref-store.ts` 或设置宿主，也不把 Demo 当正式集成。
- 构建策略：先以失败预算测试复现单一约 2.63MB renderer chunk，再评估自然动态 import；仅在无循环 chunk 警告且确有收益时稳定拆分 React/Antd/dnd，不拆散 Muya 内部依赖。
- 下一步：建立 Task 8 隔离 worktree、跑基线并写红灯测试。等待 Muya Demo 用户体验验收；剩余 Task 8–11、Electron 真机/DPI 与真实性能验收。

### Task 7 完成交接（2026-09-16，Codex；优先于下方启动快照）

- 用户选择本地合并；代码提交 `0590671`（`perf(editor): 隔离组件级编辑更新`）已 fast-forward 到 main。代码集成后实测 main HEAD `0590671`、ahead origin/main 23；本文档提交后须再次以 `git log` 为准，未推送。
- 已实现：高频卡片编辑仅复制 PlanDocument、components 数组、目标组件及 payload，其余组件引用保持稳定；卡片注册表统一提供 React.memo 包装。结构变更仍保留完整文档更新路径，500ms 防抖和 IPC/CAS 合约不变。
- 保存地基：用计划会话代次和编辑修订号隔离旧异步结果；保存中继续输入保持 editing 并自动续存；切换/删除计划不会被旧保存污染；CAS 冲突以服务端新文档为基底重放未落盘操作，且冻结组件快照，避免 uuid 等非确定 patch 回调执行第二次。
- TDD 证据：引用稳定性与 memo 首轮 2 项按预期全红；保存中输入、切计划、CAS 三项按预期全红；加载期旧文档与非确定 patch 各自先红后绿。最终主目录复验 typecheck 0 错、26 文件 230/230、build 成功（renderer 3174 模块、9.09s、JS 2645.44kB、CSS 53.21kB）。既有三组 store 混合导入警告未扩大，留待 Task 8。
- 实际文件：仅 `plan-store.ts`、`card-registry.tsx`、`test/plan-editing.spec.ts`、`test/card-registry.spec.tsx`；ContentArea 与六个卡片文件经审查无需为清单机械改动。NoteCard/Muya/pref/settings 未改。
- 所有权：Task 7 文件边界释放；用户 `Resource/pic/`、`Resource/vid/` 保持未跟踪且未触碰。完成收尾后删除已合并隔离 worktree/分支。
- 下一步：Task 8 页面与 Muya 懒加载、构建预算；开工前必须与 Muya 正式集成边界协调。等待 Muya Demo 用户验收；剩余 Task 8–11、Electron 真机/DPI、真实数据视觉与真实性能验收。

### Task 7 启动（2026-09-16，Codex；优先于下方完成快照）

- 隔离分支实现已提交为 `0590671`（`perf(editor): 隔离组件级编辑更新`），尚未合并 main，等待完成分支选项。实际改动仅 `plan-store.ts`、`card-registry.tsx`、`test/plan-editing.spec.ts`、`test/card-registry.spec.tsx`；计划列出的 ContentArea/六个卡片文件经审查无需机械改动。
- 已验证：引用稳定性、memo 契约、连续输入、保存中继续输入、切换/删除计划、外部变更、CAS 重放和非确定 patch 单次执行均覆盖；最终 typecheck 0 错、26 文件 230/230、build 成功（renderer 3174 模块、9.71s、JS 2645.44kB、CSS 52.99kB）。既有三组 store 混合导入警告留待 Task 8。
- 用户“继续”确认 Task 7；实测 main/worktree HEAD 均为 `95339dc`，main ahead origin/main 22；main 仅用户 `Resource/pic/`、`Resource/vid/` 未跟踪，隔离 worktree 干净，基线 25 文件 221/221。
- 在 `.worktrees/frontend-foundation` / `codex/frontend-foundation` 实施。Codex 所有权：`src/renderer/src/stores/plan-store.ts`、`src/renderer/src/components/ContentArea.tsx`、`src/renderer/src/components/cards/card-registry.tsx`、`SinglePlanCard.tsx`、`MultiPlanCard.tsx`、`TaskListCard.tsx`、`TaskDetailCard.tsx`、`MoodCard.tsx`、`HeadingCard.tsx`、新建 `test/plan-editing.spec.ts`；全量回归要求同步更新 `test/card-registry.spec.tsx` 的组件身份断言为 memo 包装内层身份。若实测无需修改计划列出的组件文件，不为满足清单机械改动。
- 实现契约：组件编辑只复制 PlanDocument、components 数组、目标 Component 与目标 payload，其他组件引用保持稳定；完整文档快照仍走 500ms 防抖保存和既有 CAS 锚点。卡片注册表统一提供 React.memo 包装，稳定 comp/index/total/today 时跳过无关卡片重渲染。
- 竞态范围：测试至少 100 个组件引用稳定性，并覆盖连续输入、保存中继续输入、切计划/关闭、外部变更和 CAS 冲突；最后一次输入不得被旧保存结果覆盖。Muya/NoteCard 编辑体、pref-store、设置宿主继续冻结。
- TDD：先新增失败测试并确认当前完整 `structuredClone(document)` 导致 100 个组件引用全部变化，再做最小实现；最终执行 focused test、typecheck、全量 test、build 与自审。
- 下一步：Task 7 红灯测试；等待 Muya Demo 用户验收。剩余 Task 7–11、Electron 真机/DPI 与真实数据视觉/性能验收。

### Task 6 完成交接（2026-09-16，Codex；优先于下方启动快照）

- 代码提交 `1483d6e`（`refactor(renderer): 拆分样式与卡片职责`）已 fast-forward 到 main；代码集成后实测 main HEAD `1483d6e`、ahead origin/main 21。本文档提交后须再次以 `git log` 为准，未推送。
- 已实现：`workspace.css` 收敛为九个有序领域入口；tree/cards/search/diary/memories 样式独立；CardShell、七类业务卡片和 FallbackBlock 分文件；ComponentRenderer 通过穷尽注册表分发，未知/`custom` 仍保留内容回退。
- 边界验证：NoteCard 函数体与基线逐字符一致；Muya、`note-md.tsx`、pref-store、设置宿主未改。CSS 除媒体查询因分文件增加闭合边界外为机械迁移；ActionButton 旧局部 `actions.css` 导入通过先红后绿测试删除，最终构建产物 `.trace-action` 根规则仅一份。
- 主智能体最终实测：`npm run typecheck` 0 错；25 文件 221/221；`npm run build` 成功，renderer 3174 模块、10.00s、JS 2642.17kB、CSS 52.99kB；`git diff --check` 无内容错误。既有三组 store 混合导入警告未扩大，留待 Task 8。
- 浏览器限制：本机 Chrome/Edge GPU/CDP 启动异常，现有浏览器脚本未能形成新的完整通过证据；同一隐藏 Electron 宿主对 Task 6 与基线在相同固定等待断言处均失败，稳定后 DOM 布局与焦点终态正确，因此没有发现 Task 6 独有回归，但不得写成真实 Electron/DPI 验收通过。
- 协作：Claude Code 近期无新增工作，未发生并行文件冲突；Task 6 文件所有权现释放。用户 `Resource/pic/`、`Resource/vid/` 保持未跟踪且未触碰。
- 下一步：Task 7 将高频编辑收敛到组件级更新；开工前重新登记 `plan-store.ts`、`ContentArea.tsx` 等精确边界。等待 Muya Demo 用户验收；剩余 Task 7–11、Electron 真机/DPI、真实数据视觉与真实性能验收。

### Task 6 启动（2026-09-16，Codex；优先于下方完成快照）

- 用户“继续”确认 Task 6；实测 main/worktree HEAD 均为 `645e0cd`，main ahead 20，工作区仅用户 `Resource/pic/`、`Resource/vid/` 未跟踪。
- 在 `.worktrees/frontend-foundation` / `codex/frontend-foundation` 实施。Codex 所有权：新建 `styles/tree.css`、`styles/cards.css`、`styles/diary.css`、`styles/memories.css`、`styles/search.css`、`components/cards/{CardShell,card-registry,SinglePlanCard,MultiPlanCard,TaskListCard,TaskDetailCard,MoodCard,HeadingCard,FallbackBlock}.tsx` 及对应结构/注册表测试；修改 `styles/workspace.css`、`styles/shell.css`、`components/cards.tsx`；为消除统一入口后的重复样式，仅删除 `components/ui/ActionButton.tsx` 旧的 `actions.css` 局部导入。必要时只读复用 `demo/frontend-foundation/` 回归，不先改 QA。
- CSS 契约：只机械移动既有规则，不改选择器和值；`workspace.css` 最终仅保留有序 `@import` 入口。shell/tree/cards/search/diary/memories 各自承担单一职责，保持既有 cascade 与 720/959/960/1200 行为。
- 卡片契约：抽出 CardShell、七类精确命名卡片与穷尽注册表；未知/`custom` 仍走 FallbackBlock 且数据不丢。`NoteCard` 函数体留在 `cards.tsx`，通过注册表工厂注入，避免循环依赖；Muya、`note-md.tsx`、pref-store、设置宿主和编辑行为不改。
- TDD：先写文件边界/注册表失败测试并确认因拆分尚不存在而红，再实现。完成后 typecheck/test/build、现有真实组件浏览器回归、规格审查与质量审查。
- 下一步：Task 6 实施；等待 Muya Demo 用户验收。剩余 Task 6–11、Electron 真机/DPI 与真实数据视觉/性能验收。

### Task 5 完成交接（2026-09-16，Codex；优先于下方历史快照）

- 用户“继续”确认后完成 Task 5；代码提交 `5659fe4`（`refactor(ui): 统一应用壳与三视图响应式骨架`）已 fast-forward 到 main。实测代码集成后 main HEAD `5659fe4`；本交接文档提交后须再次以 `git log` 为准。
- 已实现：`AppShell` 单点编排 TopBar、主内容与可选 StatusBar；仅 workspace 显式显示状态栏。三个 view 只返回内容，App 级 NameDialog/Search/Undo/Settings 位于 active view 外。窄于 960px 时日记时间线/回忆预览排到主内容后，960px 起保持双栏。
- TDD：首轮 AppShell 5 项测试按预期全红；720px 顶栏回归也先红后修。最终新增 6 项契约测试。`TopBar.tsx`、`StatusBar.tsx` 经检查无需修改，未为满足计划机械改动。
- 主智能体最终实测：typecheck 0 错；23 文件 216/216；main/preload/renderer build 成功，renderer 3166 模块、8.30s，JS 2642.81kB、CSS 52.39kB。既有三条 store 混合导入警告未扩大，留待 Task 8。
- Chrome/CDP 内存 IPC 宿主实测 720/959/960/1200：无横向溢出；单一 TopBar；StatusBar 仅 workspace；中英文顶栏不换行；日记/回忆次级内容临界布局正确；全局宿主 DOM 身份保持；runtime exception 0。独立规格审查、质量审查均通过。
- 限制：浏览器宿主不等于完整 Electron 真机，Windows 标题栏拖拽、窗口控制、100%/125%/150% DPI 与真实计划库仍待后续验收。源码/CSS 正则契约测试及“宿主身份而非逐浮层身份”属于非阻塞测试债务。
- 所有权：Task 5 源码与 QA 已提交，通用边界释放；用户 `Resource/pic/`、`Resource/vid/` 保留未跟踪且未触碰。Muya/NoteCard/pref-store/设置宿主既有所有权不变。
- 下一步：Task 6 拆分 `workspace.css` 与 `cards.tsx` 职责，开工前需重新登记精确文件边界；等待 Task 6 确认与 Muya Demo 用户验收。剩余 Task 6–11、Electron 真机/DPI 与真实数据视觉/性能验收。

### Task 4 完成交接（2026-09-16；优先于下方启动/暂停快照）

- 正式代码提交 `5275a26`（git log 实测），已从隔离分支快进 main；代码集成时 main ahead origin/main 17，未推送。之后仅共享文档收尾，最终文档 HEAD/领先数用 git log/git status 核对。
- 已实现：token/base 拆分与兼容入口、可读信息/链接/高亮色、动态分数主题文字色与徽标墨色、antd 文字/实心填充分离；输入/菜单/树/文件夹/搜索键盘焦点，树快捷操作聚焦可见，结果 Escape 关闭，状态 polite，明确过渡属性及减弱动效。普通树高度动画、原分数装饰色阶/滚动、Muya/NoteCard 业务未改。
- 已验证：主智能体隔离复验 typecheck 0 错、22 文件 210/210；规格复核通过，质量审查无 Critical/Important/Minor；两套 Chrome 内存宿主回归修后连续两轮串行通过，主智能体另独立串行通过，运行时异常为空。
- 主目录快进后实际三跑：typecheck 0 错；22 文件 210/210；main/preload/renderer build 成功，renderer 3165 模块、8.54s，JS 2643.18kB、CSS 52.18kB（构建输出舍入值）。既有三条 store 混合导入警告留待 Task 8。
- 对比度：静态信息/高亮 token、动态分数 0–100 每 0.01 分在双主题四底色与徽标均达到 4.5:1；浏览器实际按钮/读数样本最低 4.82497:1，不称全页面真机覆盖。
- QA 根因已修：子菜单 DOM 存在但尺寸为零时误发 hover；脚本现等待可见尺寸、动画结束与坐标命中。生产 hover 未改，临时诊断没有进入正式功能。
- 工作区保留用户 `Resource/pic/`、`Resource/vid/`，不暂存/改名/删除。21 个源/测试/QA 文件全部提交，Task 4 通用边界释放，未来任务先重新登记；原 Muya/NoteCard/pref-store/设置宿主所有权仍由 Codex 保留。
- 下一步：Task 5 AppShell 统一三视图顶栏/可选状态栏，依既有规则实施前须确认已验收视图骨架变更；本轮不提前启动。等待 Muya Demo 用户验收及 Task 5 确认；剩余 Task 5–11、Electron 真机/DPI 与完整回忆页视觉验收。
- 收尾沉淀：共享计划、镜像与交接已更新；本轮缺陷及 hover 解决方案已记实施记录，无新的独立 ERROR/跨项目方案/规则/习惯记忆条目需追加。

### Task 4 恢复（2026-09-16，Codex；优先于下方暂停快照）

- 用户“继续吧”恢复开发；实测 main HEAD `c51c3a5`、ahead 16，仅用户 `Resource/pic/`、`Resource/vid/` 未跟踪。
- 在 `.worktrees/frontend-foundation` / `codex/frontend-foundation` 实施 Task 4，不启动 Task 5 或 Muya 正式集成。
- Codex 所有权：`styles/tokens.css`、`styles/base.css`、`styles/workspace.css`、`styles/actions.css`、`main.tsx`、`views/WorkspaceView.tsx`、`components/StatusBar.tsx`；为补键盘语义可改 `components/TopBar.tsx`、`components/SearchOverlay.tsx`、`components/ContentArea.tsx`、`components/PlanTreePanel.tsx`、`components/cards.tsx`（仅非 NoteCard 段）、`views/DiaryView.tsx`、`views/MemoriesView.tsx`；对应新增测试及 `demo/frontend-foundation/` 回归脚本。Claude 避开上述边界。
- 本任务代码由 Codex 子智能体实施，主智能体只维护本文件及共享计划；既有 Muya/NoteCard/pref-store/设置逻辑不动。
- 同根因可读性复核补充所有权：`styles/antd-theme.ts`（必要时抽取主题语义色读取桥，供正式 main 与 QA 共用），相应动态颜色测试；仅调整颜色，不改弹层宿主或设置逻辑。
- 阶段：实施中；隔离基线已复验 typecheck 0 错、20 文件 200/200。先补失败测试与实现，最后三跑和浏览器验收。
- 下一步：主题/可读性/焦点/reduced-motion 收敛；等待 Muya Demo 用户体验验收；剩余 Task 4–11 及 Electron 真机/DPI。

### Task 3 暂停历史交接（2026-09-16；仅作追溯）

- 用户已确认动作 Demo，随后要求“干完最近的一个任务就先停”；本次只完成 Task 3，现在停止自主开发。
- 记录时主目录/隔离分支代码 HEAD `9478fb9`（git log 实测），main ahead origin/main 15；已快进主目录，未推送。文档收尾提交不改变该代码基线。
- 暂停文档收尾后已核验 main ahead 16；工作区仅 `Resource/pic/`、`Resource/vid/` 用户资源未跟踪。正式代码基线仍为 `9478fb9`，最新文档提交请用 `git log -1` 核对。
- 已实现：ActionButton、主题宿主确认、单槽 5 秒 UndoNotice/undo-store；卡片/树/预设确认删除，任务/选项原位撤销；焦点恢复、计时器/订阅清理、切计划/重载/外部变化旧撤销失效、切计划/切库旧确认失效；保留树收拢动画。NoteCard/Muya 编辑逻辑未改。
- 已验证（隔离）：typecheck 0 错、20 文件 200/200 测试、三段 build 成功（renderer 3164 模块/8.57s）；真实 React/antd Chrome 回归通过任务/选项/预设/Enter/Space/Escape/暗色/焦点/过期/四档宽度/reduced-motion，没有运行时异常。
- 主目录集成后复验：`npm run typecheck` 0 错；`npm run test` 20 文件 200/200；`npm run build` 三段成功，renderer 3164 模块、8.94s；代码未再改动。
- `demo/frontend-foundation/` 原型独立实现已移除并吸收，当前为复用正式组件的内存验收宿主；原型可从 `000e48f` 追溯。旧 52820 服务已停止，新验收宿主运行于 `http://127.0.0.1:52822/integration.html`。
- 尚未验证 Windows Electron 真机/DPI，不把 Chrome 回归称作真机通过。既有分包警告待 Task 8。
- 所有权：本轮源文件已提交，暂停后释放 Task 3 通用动作边界；后续改动需重新登记。Codex 原有 Muya/NoteCard/pref-store/设置宿主所有权仍保留，Claude 继续避开。
- 下一步：用户恢复后从 Task 4 继续；等待恢复指令，剩余 Task 4–11 与真机/DPI 验收。不会睡眠期间自动续跑。
- 收尾沉淀：共享计划/交接已更新，旧确认竞态与解决策略已登记在实施记录；无新的跨项目规则、ERROR 条目或用户习惯记忆需追加。

### Task 3 启动（2026-09-16，Codex）

- 用户“可以，继续”确认动作系统 Demo；Task 2 用户验收通过，进入 Task 3。
- 主目录 HEAD `eb441e3`、ahead 12；现存三份提交后同步文档与用户资源不覆盖。
- 实施仍在 `.worktrees/frontend-foundation`，所有权：`components/ui/`、`stores/undo-store.ts`、`components/ContentArea.tsx`、`components/cards.tsx`（仅 CardShell/MultiPlan/TaskList，禁止改 NoteCard）、`stores/ui-store.ts`（树确认入口）、`App.tsx`（仅 UndoNotice 宿主）、`styles/actions.css`、i18n 新动作文案、`test/action-policy.spec.ts`、`test/accessibility-contract.spec.tsx`、vitest include 配置及共享计划文档。Claude 避开上述边界。
- 使用 TDD：先失败测试，再实现；待三跑和实际交互验证后集成交付。Task 4 暂不实施。

### 第一批启动（2026-09-16，Codex）

- 用户已授权直接执行第一批：Task 1 基线、Task 2 动作系统 Demo；不越过用户验收进入 Task 3。
- 实测 HEAD `6113dbc`，main 领先 origin/main 10；已有审计/计划/规则文档改动及用户资源均保留。
- 所有权：`.gitignore`、`demo/frontend-foundation/`、本文件、共享计划 README/实施 MD/plan.json；正式 src 文件不修改。
- 隔离位置：`.worktrees/frontend-foundation`，分支 `codex/frontend-foundation`。共享状态继续在主目录维护；Demo 验收后删除或吸收原型，不保留为正式功能。
- 下一检查点：基线三跑与 Demo 构建完成；等待用户体验验收。

#### 第一批完成记录

- 提交后同步：主目录最新 HEAD `eb441e3`（git log 实测），main 领先 origin/main 12；审计/计划/规则/基线记录已提交。Task 1 完成；Task 2 待用户验收。当前未提交项仅本次提交后状态同步的三份文档及用户资源，另一智能体勿覆盖。

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
| 分支 | `main`；Muya 正式集成已 fast-forward |
| 代码基线 | `d0acd3b` — Muya 正式 NoteCard 集成；计划交接提交 `1a33af6` |
| 同步时远端 | 合并时 main ahead origin/main 29，未推送；本轮未访问远端 |
| 已发布版本 | v0.12.0 Beta 4（2026-09-12） |
| 工作区非代码文件 | `Resource/pic/`、`Resource/vid/` 未跟踪，属用户资源，禁止暂存、删除或重命名 |

## 当前工作项：注释 Muya 正式集成（代码完成，待正式卡片验收）

| 字段 | 状态 |
|---|---|
| 阶段 | Demo 已验收；正式 NoteCard 代码 `d0acd3b` 已完成自动验证并合入本地 main，等待正式卡片体验验收 |
| 产物 | 单活动真实 Muya、Markdown 字符串真源、实时渲染/自动换行/PlantUML 设置、静态安全预览与 textarea 降级 |
| 已验证 | typecheck 0 错；28 文件 244/244；正式项目与真实 Muya Demo 均构建成功；首屏仍不预载 Muya |
| 未验证 | 正式 NoteCard 真机：中文输入法、剪贴板、语言选择浮层、连续删除、切卡 flush、亮暗主题、窄窗口 |
| 文件所有权 | Codex 保持本轮精确边界至用户验收与合并；Claude 避开这些文件及 Muya/vendor 边界 |

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
| 当前阶段 | Task 1–5 完成；Task 6 样式与卡片职责拆分待确认 |
| 本轮文件所有权 | Task 5 全部提交，通用边界已释放；Muya 既有所有权不变 |
| 实测证据 | typecheck 0；23 文件 216/216；build 成功（renderer 3166 modules、8.30s、JS 2642.81kB、CSS 52.39kB）；四档 Chrome/CDP QA 通过 |
| 高优先问题 | 删除语义不一致、文字对比度/焦点不足、整文档高频 clone + 全卡重渲染、单一 renderer chunk、AppShell/CSS/cards 职责未收口 |

计划执行规则：Codex 与 Claude Code 接手任何 Task 前先读取 `docs/Plan/README.md`、执行计划和本文件；在本文件登记执行者与精确文件边界后，才允许修改正式代码。每个提交后同步 Markdown 复选框、`plan.json` 状态、实际验证结果和提交 hash。

## 下一动作与阻塞

- 下一动作 A（Muya 主线）：用户在正式 NoteCard 验收 IME、剪贴板、语言选择、连续删除、切卡 flush、亮暗主题和窄窗口；通过后关闭该独立计划。
- 下一动作 B（前端地基）：Task 1–8 已完成；Task 9 搜索性能可在避开 Muya 所有权边界的前提下错峰推进。
- 等待：正式 NoteCard 真机验收；不把 Demo 通过写成正式卡片通过。
- F2 已闭环，不再构成阻塞或并行边界。
- 待推送：Task 5 已快进主目录；未经用户授权不推送远端，ahead 数以最终 `git status` 实测为准。

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
