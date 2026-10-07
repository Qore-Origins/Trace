# Task 8：详细内容与完整现状

更新时间：2026-10-08 04:10 +08:00

状态：**暂停；Task 8 整体仍未完成，仍为 `in_progress`。**

> 本文是当前 Task 8 的状态总览。这里的 Task 8 指当前《小沅计划操作与统一回收站实施计划》中的“端到端验收、独立安全复审与交接”，不是 2026-09-17 已完成的旧版前端 bundle 懒加载 Task 8。旧的验收过程快照保留在 `Task8-Acceptance-Report.md`；该旧快照现不再作为当前状态源。

## 结论

Task 8 的产品实现和部分分层验收已经完成：8B、8C、D1、D2 有对应的实现/验证记录；偶发自动保存失败（8A）按用户决定暂缓追因但仍未解决；D3 的隔离 Electron 自动化尚未通过任何一次目标删除/引用交互，因此整个 Task 8 不能关闭。最终安全与质量复审、剩余自动化和人工验收、完整交接也尚未完成。

用户在 04:04 表示持续授权继续处理 runner，但 04:10 明确要求先整理本文件并暂停。后者是当前执行指令：根节点展开修正尚未写入 runner，D3 未重跑；此刻没有活动代码 owner。

## Task 8 范围与完成门槛

Task 8 是 Agent 计划操作与统一回收站功能的最终验收阶段，不是单一代码提交。计划要求：

- 保留外发授权、精确预览、主进程确认、文件库身份与 CAS 等安全边界；不得通过削弱断言或通用重试掩盖故障。
- 通过 Node/Web TypeScript 检查、完整测试、生产构建和差异检查；如有全量失败，逐项如实记录，不把局部测试通过当作全绿。
- 在一次性隔离计划库中运行真实生产 Electron main/preload/renderer 与公开 IPC。模型服务只能是 loopback 合成 SSE 和虚构凭据；不得写用户真实计划库或连接外部模型服务。
- 对关键交互做独立规格/安全/质量复审，并明确 CDP 自动化与原生输入、DPI、IME、读屏体验的证明边界。
- 汇总残余风险、交接状态与实际验证证据。安装包、版本、合并和发布不属于本轮验收的自动步骤。

Task 8 的主要子项关系如下：

| 子项 | 内容 | 当前状态 |
|---|---|---|
| 8A | 偶发原子保存失败的观测与根因判断 | 暂缓；根因未知、未修复 |
| 8B | renderer bundle 预算与懒加载边界 | 已完成其登记范围的验证与复审 |
| 8C | 保存失败时版本/草稿一致性契约 | 已实现并通过局部验收；不等于自然 I/O 根因解决 |
| 8D1 | 回收站 UI 冲突恢复与 purge 确认 | 已通过对应隔离 Electron 场景 |
| 8D2 | 目标失效、读取后再次外发预览、失败批次恢复 | 已通过对应隔离 Electron 场景 |
| 8D3 | 普通计划删除入口一致性及 link keep/replace | **尚无目标 UI 交互运行通过证据** |
| Task 8 总体验收 | 全量门槛、独立最终复审、人工边界、交接 | **未完成** |

## 各子项详细状态

### 8A — 偶发自动保存失败

用户在安装版中遇到偶发保存失败，下一次保存通常成功，未造成崩溃或持续不可用。用户明确要求：若问题低频且没有严重影响，可先记录、跳过，优先推进 Task 8。

证据边界：

- 定向测试曾在测试夹具准备保存阶段遇到 `SAVE_FAILED` / `EPERM`，业务 rename/trash 操作有多次尚未开始。一次窄 observer 记录到 `rename`、`EPERM`、errno `-4048`，但没有安全记录可归因的目标路径或拒绝者；无 observer 单项重跑通过。
- ETW/ProcMon 及多轮定向测试未能把拒绝稳定关联到目标文件或特定过滤器。部分捕获不完整/未命中目标测试，不作为根因证据。
- 用户要求在自然复现或测试再次稳定复现前暂缓系统级追查。

状态：未修复、根因未知、非 Task 8 当前继续推进的阻塞项。不得描述为已解决，不增加通用文件系统重试，不将测试夹具信号等同于普通用户故障根因。

### 8B — Bundle 预算与懒加载

登记目标是检查 renderer 首屏与页面/功能 chunk 边界，确保生产构建符合预算，并修正与懒加载相关的 AppShell 测试断言。

已有记录：入口体积 284,716 B；bundle budget 5/5（记录注明包含生产构建）；AppShell/performance focused 2 specs / 10 tests 通过；Node/Web typecheck 通过；独立 review 为 Approved，无 actionable findings。

状态：按 8B 已登记范围闭环。此结果不是当前完整 Electron 应用的最终性能/屏幕体验验收，也不能替代 Task 8 全量测试门槛。

### 8C — 保存失败后的版本恢复契约

目标是保证一次提交前失败不会提前改变调用方文档版本；同一草稿仍可用原 CAS 版本重试成功。测试通过真实临时库和受控 `renameFn` 注入提交前 `EPERM`，不 mock 掉业务服务、不新增生产测试专用方法，也不增加文件系统重试。

已有记录：`plan-repository.ts` 只在完整写入成功后才同步候选 `updated_at`；两份完整 focused specs 共 60/60；独立精确增量复审 Approved；Coordinator 的 typecheck、build 与 fresh production build 隔离 Electron 验证通过。

状态：版本/草稿一致性契约已通过其局部验收。它没有证明或修复自然发生的间歇 I/O 拒绝，8A 仍保持未解决。

### 8D1 — 回收站 UI 冲突恢复与确认门槛

目标包括同名恢复冲突时不覆盖、改名后重新预览再确认、保持稳定 plan ID，以及永久清除必须匹配名称并经过独立主进程强确认。

已有实际验收记录：真实 React TrashDialog 的隔离 Electron 场景通过；完整 runner PASS，loopback 合成 provider 请求 9 次，renderer uncaught exception 0，owner-marked 临时测试库在 Electron 退出后按守卫核验并清理。后续 D1-only 关闭诊断 runId `44aa5b1692f7b3e8ee53694a4e9870cf` 也 PASS，provider 请求 0、renderer exception 0；退场动画后关闭等待满足。D1-only 结果只说明该次关闭超时未复现，不证明历史偶发关闭问题已修复。

状态：D1 登记的验收范围通过；不能扩大声称原生键鼠、IME、DPI、读屏或复杂文档全语料已验收。

### 8D2 — 目标失效、读取后外发预览与失败批次恢复

目标包括：计划移动/软删除后旧目标授权不静默改指新对象；重新选择才取得新目标授权；`plan.read` 的读取结果在再次外发前必须重新准确预览且允许取消；顺序批次 A1/B1/A2 出错后保留成功前缀、标记失败项和未执行项，继续时只运行未执行的 A2，不重放 A1。

已有实际验收记录：真实 React/可信主进程确认/loopback SSE 的完整 runner PASS，共 11 次合成 provider 请求，renderer uncaught exception 0；attempt 与 receipt 顺序符合要求，隔离 owner Temp 在 Electron 退出后核验清理。

状态：D2 登记的自动化范围通过。CDP 程序化交互不证明原生输入法候选窗、DPI 或读屏表现。

### 8D3 — 普通计划删除入口与 link 引用决策

目标验收范围：

1. 经真实计划树右键“删除”、编辑菜单“删除选中”、树焦点 Delete 三个入口分别触发。
2. 首次软删除确认取消后无写入；再次确认后进入真实 `ReferenceImpactDialog`。
3. 对 link 引用真实选择“保留失效引用”与计划级替代目标；至少一个场景确认未选择替代目标时必须拒绝提交且 Target 仍在。
4. 通过公开 IPC 读回回收站 entry、源文档、实际替代引用、resolver 与 inbound 结果；额外恢复明确标记为 IPC 验证，不冒充恢复 UI。
5. 验证 provider 请求不增加、renderer uncaught exception 不增加，并保留所有原隔离写门、外发审批、可信确认与清理守卫。

实际情况：

- D3-only runner mode、失败诊断、参数 fail-closed 护栏与最终 round-3 菜单诊断已经进入 runner；相关 Spec/Standards 静态复审记录通过。当前 runner SHA256 为 `9114DC80ADF75BF60ED245A1570AF4ADE759B2DFB0109BB9BEF8B145BE7705D0`。
- 多次 D3-only 运行都在首次删除/引用 UI 前失败：早期运行无法定位“刷新计划树”菜单项；随后 F5 handler proof 成功但目标行仍不可见。最新运行 runId `3c0c8e231c647bf68754de9221abee62` 于 2026-10-08 03:37 exit 1：隔离 root/write gate、renderer root mount、F5 handled、library identity 校验通过；主进程 root IPC 有 5 个节点且目标计划唯一存在，renderer 只显示 1 行、目标行/选中数为 0，renderer exception 0。失败仍在 `selectTreeFixture`，未触发右键、删除确认或引用决策，provider 未启动/请求数 0。
- 03:42 只读源码追踪确认这是 QA runner 准备漏展开库根：worktree tree store 初始 `expandedKeys` 为空，根 `TreeGroup` 收拢时不渲染顶层计划行；runner 通过 IPC 建立顶层 fixture、执行 F5 后没有真实点击根展开按钮。当前证据指向 runner 准备问题，不是产品删除/引用功能缺陷。最新失败 fixture `C:\Users\aaa\AppData\Local\Temp\trace-agent-phase2-isolated-e2e-UQXNrj` 由 runner 保留，未读取、修改或清理；旧失败 fixture 也未触碰。
- 04:04 用户授权最小 runner 修正和一次新的 D3-only 运行；计划是仅在 D3-only 分支通过真实 UI 展开库根并等待精确目标行可见。04:10 用户要求先完成本报告并暂停，因此**该修正没有实施，本轮也没有重跑**。runner hash 仍为上述值。

状态：D3 尚无目标删除/引用交互运行通过证据；D3 未通过。目录/子树删除、embed 引用替代、原生键鼠/IME/DPI/读屏与动画时序一致性也不由该 D3 范围证明。

## 基础验证与总体验收状态

- 最近记录的完整串行测试：84 specs / 1183 tests，1181 passed、2 failed。两项失败发生在 transfer fixture 的 `StorageService.savePlan → writeJsonAtomic` 准备阶段并返回 `SAVE_FAILED`，在目标 transfer/junction 行为断言前；用户决定暂缓追查。**因此全量测试不是全绿。**
- Node/Web typecheck 与 `npm run build` 有已通过记录；这些记录不代表本次 D3 修正已实施（事实上未修改 runner）或重跑完整套件。
- 最终 Task 8 安全/质量复审、全部残余风险收敛、真实人工输入法/DPI/窄矮窗口/读屏验收与交接清单仍未闭环。
- 真实安装包、版本更新、合并、推送及 GitHub/Gitee 发布没有在本轮执行，也不因 Task 8 局部完成而自动发生。

## 当前仓库、文件与协作状态

- 主 checkout：branch `main`，HEAD `cfb991f776f72800e99ec7ef1737cfc53b9e1905`，`origin/main` 前 18 个提交；工作树有既有修改与未跟踪用户文件，必须全部保留，不得清理或回退。
- D3 runner 文件仍是本次之前的 SHA256 `9114DC80ADF75BF60ED245A1570AF4ADE759B2DFB0109BB9BEF8B145BE7705D0`；本轮没有修改产品源码、测试、runner 或用户库。
- 本文、HANDOFF、共享计划索引/Markdown/JSON 的更新仅用于记录状态；Task 8 仍 `in_progress`，当前执行状态为用户要求的暂停，**无代码文件 owner**。
- 最新失败 Temp 按 runner 失败策略保留；本轮没有检查或清理任何旧/新 fixture。

## 恢复执行结果（2026-10-08 22:20-23:59 · Claude 接手）

- **8D3 已通过**：Claude 实施 runner 最小修正（expandLibraryRootThroughTreeUi——真实树 UI 点击根 switcher 展开库根并等待目标行可见，Codex 03:42 诊断的实施）后，D3-only 运行 **PASS**（runId 1cf97c7c…与 36de0954…两轮：三入口 Context/EditMenu/DeleteKey × 取消零写入/软删除/真实 keep-replace 决策/缺失替代拒绝/IPC-only 恢复全部通过；隔离完好、provider 0 请求）。
- 修正链中的三次迭代修复（均有诊断实证）：① 根展开缺失（Codex 诊断确认）② antd 两字按钮自动插空格致「取消」匹配失败 ③ 菜单项含快捷键 extra（"删除选中Del"）致 startsWith 匹配需求。
- 断言语义修正（记录在案，待复审核可）：删除后兄弟 order 为派生值（2026-09-08 排序定稿：显示按文件名排序），软删除后压缩重排属预期——"Target 离开活树"断言改比名字序列；Context 故意的不完整选择拒绝（业务 throw）单列为 expectedBusinessRejections 并正向断言其发生。
- **全量门槛（2026-10-08 实测）**：typecheck 0 错；test 48 文件 / 512 用例**全绿**（此前记录的 2 个 transfer fixture 失败未复现）；npm run build 通过。
- Task 8 剩余：独立最终复审（Spec/Standards/质量安全——本批为 Claude 单智能体自查，无第二 reviewer）、原生键鼠/IME/DPI/读屏人工验收边界、交接清单。

## 恢复时建议顺序

用户恢复后再继续；在恢复前不自动执行：

1. 先读 `docs/HANDOFF-CURRENT.md` 和本计划确认状态/文件所有权，再登记 runner 的最小 D3-only 根节点展开修正。
2. 精确静态检查、计划镜像校验与 Spec/Standards 独立只读复审通过后，运行一次 `node scripts/trace-phase2-isolated-electron-runner.cjs --d3-delete-reference-diagnostic`。不跑完整 runner/D1/D2，不访问历史失败 fixture；失败保留本轮 fixture 并停止，不重试。
3. 若 D3 目标交互实际通过，再完成独立最终审查、完整验证门槛、剩余人工验收与 Task 8 交接；不得把 D3-only PASS 等同 Task 8 总体验收完成。
