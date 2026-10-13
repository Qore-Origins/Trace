# Trace 计划目录

## v1.1.0 构建与发布（2026-10-13）

用户已确认 v1.1.0。发布前测试、安装包构建、GitHub/Gitee 发布和账本核验按[共享发布计划](./Future_Plan/Qore/Trace/Plan-261013-03-v1.1.0正式版发布/Trace-v1.1.0-Release-Plan.md)记录；目前全量测试连续两轮 1283/1283 通过，最终候选包与隔离 Electron 实窗主路径已核验，待固化代码并公开发布。Windows 间歇性 `rename EPERM` 的拒绝主体仍未知，现有有限重试增加一次退避，见问题记录。

## 工作流设置入口与名称编辑（2026-10-13）

工作流设置页现以预设概览为默认视图，明确选择预设后才进入编辑；编辑页持续显示当前名称、未保存状态和保存按钮，可返回列表。新建与复制预设自动给出可区分名称，内容模板和命名规则保持管理入口。文件树的新建计划行为未改。类型检查、构建与定向测试通过；最后一次全量测试 1279/1281，小沅 UI 等待超时和 Windows `EPERM` 两项失败，失败文件合并复跑 35/35 通过，全量仍未全绿。执行与未覆盖边界见[共享实施记录](./Future_Plan/Qore/Trace/Plan-261013-02-工作流设置入口与名称编辑/Workflow-Settings-Overview-Plan.md)。

## 个人计划库周日联动预设（2026-10-13）

已在 `D:\Desktop\Plan` 的 `.trace/plan-workflows.json` 配置“周日联动”：`Weekly_Plan` 分类默认匹配，单次生成周计划、按周期逐日生成最多七份日计划，目标分别为 `Weekly_Plan` 与 `Daily_Plan`；名称模板分别为 `{this.folder_name}_{week_start}-{week_end}` 和 `{this.folder_name}_{date}`。周/日内容模板由现有内置建议复制并独立保存。原有全局“新工作流”预设保持不变。服务保存与重新加载、匹配优先级、备份校验通过；尚未在真实库创建任何计划文件。详细证据与下一步见 [HANDOFF-CURRENT](../HANDOFF-CURRENT.md)。

## 设置使用说明（2026-10-13）

设置页的不常见选项已接入可展开的功能、目的、适用对象和效果说明，覆盖动画、Markdown、PlantUML、命名模板、工作流和小沅模型服务，共 14 个主题。中英文文案、定向测试、类型检查与构建已完成；全量测试 1278/1280，仍有既有 UI 等待超时与 Windows `EPERM` 两项失败。原生界面体验边界见[共享实施记录](./Future_Plan/Qore/Trace/Plan-261013-01-设置使用说明/Settings-Help-Implementation-Plan.md)。

## 可配置计划工作流（2026-10-12，实施任务 1–9 已接通，隔离验收进行中）

用户要让 Trace 和小沅遵循个人计划库的放置、命名及周日联动习惯。已只读对照 `D:\Desktop\Plan` 与现有实现，完成[工作流设计规格](../superpowers/specs/2026-10-11-plan-workflow-templates-design.md)和[设计执行记录](./Future_Plan/Qore/Trace/Plan-261011-01-计划工作流模板设计/Plan-Workflow-Templates-Design-Plan.md)。用户选择方案 B：可配置工作流预设；在文件树中按目录自动匹配、先展示可修改预览；`{this.folder_name}` 为各生成项最终目标父文件夹名，`{date}` 为计划目标日期。[技术实施计划](../superpowers/plans/2026-10-11-plan-workflow-presets-implementation.md)和[共享实施执行记录](./Future_Plan/Qore/Trace/Plan-261011-02-可配置计划工作流实施/Plan-Workflow-Presets-Implementation-Plan.md)记录阶段边界、实现与真实验证。任务 1–9 已接通：命名/配置/内容/文件树 UI、周日 1+7、跨周交接、关联导入导出和小沅受权工具。隔离 Electron 已实际点击单计划预览/创建，并通过生产 IPC 创建跨年 8 文件批次；任务 10 的其它原生界面路径与真实模型行为待验证。最新 typecheck/build 通过；最后一次全量测试 1276/1278，两个失败分别单独复跑通过，但全量未全绿。真实 `D:\Desktop\Plan` 未写入。

> 本目录是 Trace 项目计划的共享读取入口。Codex 与 Claude Code 在接手、实施、暂停和完成计划时必须同步更新对应计划文档，并在 `docs/HANDOFF-CURRENT.md` 登记当前所有权与验证结果。

## 小沅智能体 Phase 1/2 设计规格独立复核（2026-10-10，代码与自动化验证完成）

按已批准的[基础层设计规格](../superpowers/specs/2026-10-02-agent-foundation-design.md)与[计划操作设计规格](../superpowers/specs/2026-10-03-agent-plan-operations-design.md)重新审查并补齐 Phase 1/2：无参数只读回收站列表、策略化普通写确认、重启后的待确认与撤销恢复、单一操作确认入口，以及 reduced-motion 和隔离 runner 生命周期边界。实施与证据见[执行记录](./Future_Plan/Qore/Trace/Plan-261009-03-小沅设计规格独立复核与补全/Agent-Design-Conformance-Review-Plan.md)与[HANDOFF-CURRENT](../HANDOFF-CURRENT.md)。定向 7 files / 200 tests 通过；`npm run typecheck`、`npm run build` 通过；完整隔离 Electron runner 通过，11 次 loopback 合成请求、0 renderer 异常。串行全量测试 87 files / 1231 tests，1229 通过、2 个 DST 用例在 `TZ=Asia/Shanghai` 失败；自动化及实现验证完成，但真实 provider/模型续轮、原生键鼠/IME/DPI/读屏与真实用户库仍待用户验收。

## Task 8 / v1.0.0 最新状态（2026-10-09 05:26 +08:00）

Task 8 集成已包含在 Trace v1.0.0 正式版。GitHub 与 Gitee `main` 均核验为 `aa8c99c`，`v1.0.0` tag 指向发布提交 `7819ff6`；发布记录与下载链接提交为 `aa8c99c`。GitHub Release 已附 Windows x64 安装包（210,738,662 bytes，SHA-256 `76ED2D64F0313D0D9FDBE3333BDC306D6C10E839513BBE27D0328BDF1EA8157E`）；Gitee Release 仅说明、不含安装包。`typecheck`、`build`、`build:win` 通过。全量测试 1187/1190，用户批准跳过 3 项以继续发布；不记为全绿。完整过程见[ v1.0.0 发布计划](./Future_Plan/Qore/Trace/Plan-261009-01-v1.0.0正式版发布/Trace-v1.0.0-Release-Plan.md)及 [HANDOFF-CURRENT](../HANDOFF-CURRENT.md)。

剩余边界：用户侧安装/卸载、键鼠/IME/DPI/窄窗口/读屏验收；Task 8 CDP runner 实际运行证据；8A 保存失败的自然根因仍未知。下一步由用户决定是否进行安装包体验验收；上述事项不伪装成已验证。

### v1.0.0 发布后 UI 修复（2026-10-09，分类导航已实现）

设置弹窗已实现「常规 / 计划库 / 命名模板 / 小沅模型服务 / 关于与快捷键」分类导航：桌面左侧固定分类，右侧当前分类独立滚动；窄窗口切换为横向分类条，弹窗最大高度 760px。API Key 流程提示保留。验证：定向 3 files / 27 tests、`npm run typecheck`、`npm run build`、`git diff --check` 通过；未运行 Electron 实际视觉验证，未构建安装包、升版或发布。详见 [HANDOFF-CURRENT](../HANDOFF-CURRENT.md) 与[问题记录](../../.issues/2026-10-09-settings-dialog-overflow-api-key-discoverability.md)。

### 小沅请求错误详情与复制（2026-10-09，普通对话续轮诊断实施中）

目标：安全地展示并复制小沅错误诊断。已增加 HTTP 200 / SSE 与 JSON 结构化错误识别、凭据脱敏与 HTTP 状态保留。相关测试 4 files / 100 tests、`npm run typecheck`、`npm run build` 通过；完整测试 1208/1211，3 项失败详情见 [HANDOFF-CURRENT](../HANDOFF-CURRENT.md)。

真实模型诊断已于 2026-10-09 完成：使用默认 `智谱glm-4 / glm-4.7-Flash` 配置，1 次连通性请求在 60 秒后 timeout、无 HTTP 状态；随后按正式会话流程发送用户指定的单条 7 项事项消息，准确收到 HTTP 429，脱敏摘要为“该模型当前访问量过大，请您稍后再试”，Trace 会话保存为 `error-interrupted` 且正文为空。两次请求各 1 次、无重试；本轮确认的阻塞点为服务端高访问量/限流，但模型完整对话能力、API Key 认证结果及先前 HTTP 200 格式问题均未验证。会话标题为“小沅对话完整性测试”，ID `23d3ea7c-0131-4f4b-9e4a-112f9f48a99a`。详细边界和证据见 [HANDOFF-CURRENT](../HANDOFF-CURRENT.md)；历史代码计划与回归记录见 [计划文档](Future_Plan/Qore/Trace/Plan-261009-02-小沅请求错误诊断与复制/Agent-Request-Diagnostics-Plan.md)。

工具能力定位与最小修复（2026-10-09）：固定合成 GLM-4-Flash 探针的应用内诊断取得 HTTP 200 SSE 真实失败阶段。第一事件包含合法工具调用与 `finish_reason=tool_calls`，第二事件为同结束原因、delta 含 `role` 和空字符串 `content`，随后收到 `[DONE]`；旧解析器以 `sse.duplicate_terminal_mismatch` 拒绝。现仅接受完全空 delta 或严格 `{ role: 'assistant', content: '' }` 的同原因终止延续，仍拒绝非空尾文、工具调用/其他字段、role 不符及不同结束原因。新增真实形状接受与非空内容拒绝回归；Provider 定向测试 47/47、`npm run typecheck`、`git diff --check` 通过。新 Electron dev 窗口 session 17502、renderer `http://localhost:5174/`；应用 main 终端出现两组完整 `capability=passed` 序列，安全核验本机 profile 非敏感字段确认 `status=passed`、`errorCategory=null`。能力测试路径已通过；普通对话连续中断是否同因仍未验证，全量测试与安装包验证未执行。详见 [HANDOFF-CURRENT](../HANDOFF-CURRENT.md)、[问题记录](../../.issues/2026-10-09-agent-sse-empty-assistant-terminal-compat.md) 与[计划文档](Future_Plan/Qore/Trace/Plan-261009-02-小沅请求错误诊断与复制/Agent-Request-Diagnostics-Plan.md)。

普通对话续轮复现（2026-10-09 20:58）：用户确认隔离预览后，开发终端取得 HTTP 200 / SSE，单个 allowlist 工具调用通过 JSON/名称检查、收到 `[DONE]`，但在本地严格参数 schema 校验处以 `completion.arguments_schema` 中断；工具调用未执行，先前计划创建回执成功。多条本地 `code=21` 是独立的 `ERR.STATE_MACHINE` 门控日志，具体来源尚未区分。已在开发续轮诊断中补充安全 schema 摘要，只记录语法受限工具名、本地静态字段路径、有限失败类别/JSON 类型和未知字段数量，不记录参数值或未知字段名，不改变拒绝行为。Loopback 两项新隐私回归 RED→GREEN；Provider + request IPC 92/92、typecheck、build、diff-check 通过。实际字段仍待用户确认新隔离续轮预览后取得；未自动重试或再次外发。详见 [HANDOFF-CURRENT](../HANDOFF-CURRENT.md)、[问题记录](../../.issues/2026-10-09-agent-tool-continuation-protocol-interruption.md) 和[计划文档](Future_Plan/Qore/Trace/Plan-261009-02-小沅请求错误诊断与复制/Agent-Request-Diagnostics-Plan.md)。

单计划完整任务创建（2026-10-09）：按用户澄清，已支持 `plan.create` 在一次调用中携带严格校验的初始 `task_list`，主进程生成 ID/未开始状态并将计划与全部任务一次原子写入。多任务预览展示完整清单、需要确认，取消不落盘。四个相关 spec 145/145、typecheck、build、diff-check 通过；原始模型 mismatch 字段仍未知，未发送真实请求、未改此前创建的空计划。待 Electron/真实模型由用户侧复验。详见 [HANDOFF-CURRENT](../HANDOFF-CURRENT.md)、[问题记录](../../.issues/2026-10-09-agent-tool-continuation-protocol-interruption.md) 和[执行计划](Future_Plan/Qore/Trace/Plan-261009-02-小沅请求错误诊断与复制/Agent-Request-Diagnostics-Plan.md)。

### Task 8 集成状态快照（2026-10-09 04:54 +08:00；仅记录本地合入时状态）

### 本地正式合入完成（2026-10-09 04:54 +08:00）

Task 8 split 已通过本地 merge commit `7f120722df604420fdf21dfc09a8c46ad47fd6e4` 正式合入 `main`；父提交为原 `main` `369c5ff` 与 split `b4f52c1`。唯一冲突 `src/main/ipc/register.ts` 已解决，保留主线 `diary:year` 与 Agent IPC 注册。主 checkout 原有 dirty/untracked 内容未暂存、未提交。`origin/main` 与 `gitee/main` 仍停在 `369c5ff`；本轮未推送、未创建 PR、未升版、未打包或发布。验证：typecheck/build 通过；串行全量测试 85 files / 1190 tests，1187 passed / 3 failed（两个 DST 用例在 Asia/Shanghai 下失败；SearchService 一次 `SAVE_FAILED`）；`TZ=America/New_York` 对应两个 spec 定向 22/22 通过，SAVE_FAILED 重跑未复现但原因未明。详见 [HANDOFF-CURRENT](../HANDOFF-CURRENT.md) 与 [Task 8 当前状态](Future_Plan/Qore/Trace/Plan-261003-01-小沅计划操作与统一回收站/Task8-Current-Status-2026-10-08.md)。下一步等待用户决定是否推送或开始发布准备；人工键鼠/IME/DPI/窄窗口/读屏及真实安装包验收仍待用户侧安排。

### 正式合入过程记录（2026-10-09 04:53 +08:00）

用户授权的实施方案与开工前路径交集预检记录。实际完成结果见上方 04:54 状态；合并验证详情见下文 04:41 预演记录。

### 测试稳定性修复已拆分（2026-10-09 04:20 +08:00）

主线状态提交仍为 `369c5ff949d555e216c79e388637aeab35c13ba4`，原实现提交仍为 `9d3c4534fbdd1331ab803360a502e0e2c7a83703`。Codex 在实现 worktree 新建本地分支 `codex/xiaoyuan-plan-operations-split`，将 Task 8 基线与三处已登记测试稳定性修复整理为四个提交：`280fcdc3c44cb457c157d739996f042acce1e76d`（Task 8 实现基线）；`c9cba133f9f0af31f32dfa0cf4e8437c70c1ae5e`（agent-operation 清理对 ENOTEMPTY 有界重试）；`c2a15069b6ad19b339246b0471474fa2a997e9bd`（target-picker 超时）；`b4f52c1f34b775e7dbd6da054ea3afa25c7fa530`（plan-reference 超时）。未登记为 patch 的 `agent-operation-ipc.spec.ts` 顶部 20 秒配置留在 Task 8 基线。

验证：新分支 HEAD tree SHA 与原 `9d3c453` 均为 `ac5ea95f937c0f6590bff340189a4d1e54dfab70`，无文件内容差异；三份 focused specs 3 files / 99 tests passed（29.27s）；修复提交 `git diff --cached --check` 通过。本轮未跑全量测试、typecheck 或 build。用户回复“继续”后，新分支已推送至 GitHub `origin/codex/xiaoyuan-plan-operations-split`（HEAD `b4f52c1`）；原 `origin/codex/xiaoyuan-plan-operations` 仍保持 `9d3c453`，未创建 PR、未合并、未推送 Gitee、未强推或改写原历史。此整理不增加 plan.json 任务项。

### 交接工作流（2026-10-09 02:48 +08:00）

用户将当前 Task 1 CDP 阻塞交由另一位智能体继续。本轮 Codex 只整理了[诊断交接与执行工作流](Future_Plan/Qore/Trace/Plan-261008-01-Task8早期CDP自动附着/Task1-CDP-Diagnostic-Handoff-Workflow-2026-10-09.md)，没有运行 Electron 或修改诊断代码。最近差分失败在 Browser WebSocket 连接之前，`loadURL()` 干预未发生、具体阶段未知；Task 1 不通过，Task 8 未完成。接手者先复核 HANDOFF 与两个 worktree，再登记文件 owner；旧的一次性运行授权不延续。

Task 1 Browser CDP smoke 的最新真实通过证据仍为空：2026-10-08 的完整 smoke 首个场景失败，page session 的 `Runtime.enable` 无响应；既有单目标 probe 中 Browser 级 `Browser.getVersion` 可响应但 flattened page `Runtime.enable` 超时，根因未知。

用户批准的导航时序差分已在隔离 worktree 中唯一运行一次，命令 `node scripts/trace-phase2-cdp-navigation-timing-diagnostic.cjs` exit 1、分类 `runtime`。脱敏报告显示 observation=null、Browser WebSocket 未连接、page attach 数为 0；没有发送导航控制，故唯一干预 `loadURL('about:blank')` 未发生，不能判断该时序假设。fixture isolation-ready 后，清理流程发出 exit；Electron exit 0、stdio closed、FD3 EOF，运行后精确匹配隔离 Electron 进程数 0。新 owner-marked fixture `trace-cdp-navigation-timing-diagnostic-PBO9GQ` 已核验并保留。报告没有保存具体失败阶段/原始错误，因此准确触发点未知；不重跑、不归因。

脚本 SHA-256 为 `DE5B7B2FB448C90547723593C4B895CB9F9A18183A008F18D7B951ECFA218D5B`。独立 Spec 与 Standards/Security 双轴只读复审均 Ready、无未解决阻断；隔离 HEAD 为 `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`。外层和内嵌 fixture 的语法检查、PowerShell AST 检查、差分/隐私静态检查通过。完整记录见 [Task 8 详细状态](Future_Plan/Qore/Trace/Plan-261003-01-小沅计划操作与统一回收站/Task8-Current-Status-2026-10-08.md) 与 [Task 1 实施计划](Future_Plan/Qore/Trace/Plan-261008-01-Task8早期CDP自动附着/Task8-Early-CDP-Auto-Attach-Implementation-Plan.md)。本次单次授权已用尽；若要继续运行 Electron，须先设计并获得新的明确诊断范围。Task 1 硬门槛、Task 2+、D3 与 Task 8 人工验收/交接仍待办。

### 上轮完整 smoke 结果（2026-10-08 23:08）

用户授权的唯一完整 Browser CDP smoke 已执行并失败：运行前隔离 Electron executable 进程数为 0；`node scripts/trace-phase2-cdp-auto-attach-smoke.cjs` 整体 exit 1，首个 `protocol` 场景等待首批异常/继续超时，后续 fail-closed 场景未运行。FD 3/4 通道形状、Browser WebSocket、`Target.setAutoAttach` acknowledgement、continue 与四个 page target 创建均成功。新增有界诊断显示四个 page session 的 `Runtime.enable` 均无响应且仍 pending；没有进入 `Page.enable`、首脚本 guard 或 `Runtime.runIfWaitingForDebugger`，也没有 `Runtime.exceptionThrown`。Browser WebSocket 保持 OPEN、client failure 未置位。子进程清理后 exit 0 / stdio closed；runner 运行后精确进程数 0。

新 owner-marked fixture `trace-cdp-auto-attach-smoke-HwhH2j` 与旧 fixture `trace-cdp-auto-attach-smoke-wDk01l` 均保留，不覆盖、不复用、不清理。诊断已把卡点收窄到首个 page `Runtime.enable` 请求无响应，但原因仍未知；本轮 stderr 未重现此前 teardown 后的 iframe localhost 错误。协议资料确认 flattened session 以命令 envelope 中的 `sessionId` 路由、paused target 以 `Runtime.runIfWaitingForDebugger` 恢复，但不解释该命令为何无响应。[Target](https://chromedevtools.github.io/devtools-protocol/tot/Target/) · [Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/)。

本轮仅在隔离 worktree `codex/task8-cdp-auto-attach` 的 `scripts/trace-phase2-cdp-auto-attach-smoke.cjs` 增加上限 128 条的脱敏诊断；`node --check` exit 0、目标 `git diff --check` 无错误。唯一完整 smoke 授权已用尽，不重跑、不擅自改协议或产品。下一步需另行确定并授权新的最小诊断范围。Task 1 CDP 硬门槛未过；Task 2+、D3、Task 8 人工验收及最终交接仍待完成。

## 历史快照（2026-10-08 23:03 +08:00，完整 smoke 复测前）

## 历史快照（2026-10-08 21:49 +08:00）

Task 1 transport 修订已经用户批准：真实 Browser CDP smoke 使用 child FD 3 → parent 事件及 parent → child FD 4 控制；stdin 不参与握手，stdout/stderr 只作诊断，bootstrap gate 异步保持 Electron event loop。无回退到 stdin/TCP/named pipe/晚 attach。唯一实现 owner `/root/cdp_fd_smoke` 仅修改隔离 worktree 已跟踪的 `scripts/trace-phase2-cdp-auto-attach-smoke.cjs`，当前已释放所有权。Smoke 已补齐 9 个 pre-release fail-closed 场景；协调者 `node --check` 与目标 `git diff --check` 通过，tracked diff 仅目标脚本。Spec 与 Standards/Security 独立复审均 Ready，无 Critical/Important，另有一项 fixture 保留的非阻断 Minor。执行前隔离 worktree Electron executable 精确进程数为 0。唯一一次真实 smoke exit 1：首个 `protocol` 场景等待全部首脚本异常及继续执行超时，console 显示 exceptions=0、进程退出且 stdio closed。失败 fixture `trace-cdp-auto-attach-smoke-wDk01l` 保留；运行后精确 Electron 进程数为 0。按用户边界未检查或清理失败现场，不重试。此前 FD 3/4 app-mode probe 不等于 CDP smoke 通过。Task 1 未通过，唯一运行授权已用尽；等待用户决定是否授权只读诊断/下一步。Task 2+、D3 停止。

前一轮 Spec Not Ready finding 已按计划步骤 7 补齐并进入独立复审。本次新增场景覆盖错误 nonce、空帧、畸形 JSON、无效 UTF-8、超长帧、未知控制类型、FD4 纯 EOF、不完整帧 EOF、gate timeout；每个场景断言 fail-closed。协调者 `node --check` exit 0、目标文件 `git diff --check` 通过，tracked diff 仅目标脚本。主 checkout HEAD `7ced10c1371004e53452074ef812747c6493b710`；隔离 worktree HEAD `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`；已有未跟踪兼容探针及其他既有工作均保留。尚未运行 Electron/CDP smoke。Task 8 仍 `in_progress`，Task 1 仍 `in_progress`；人工验收与最终交接尚未完成。下一步：精确核验 Electron executable 进程为 0 后运行唯一授权的真实 Browser CDP smoke；失败即保留现场停止。Task 2+、D3 仍停止。

### 上一阶段（19:42）

timeout-path 唯一授权 follow-up 已完成：仅在隔离 worktree 新 smoke `scripts/trace-phase2-inherited-fd-smoke.cjs` 的 `runTimeoutScenario()` 确认 rejection 后、`awaitExit()` 前关闭父端 FD4。唯一代码 owner 只增加一行后释放；`node --check`、长度/空白检查、diff-check 通过，Spec/Standards 独立复审均 Ready。执行前精确 Electron 进程数 0；唯一完整运行 exit 0 / 4.184 秒，五场景均 PASS，所有 child exit code 与预期一致，stdio closed=true；成功 fixture 清理完成，运行后精确 Electron 进程数 0。授权已用尽，不再运行。

新运行通过支持“timeout rejection 后及时关闭父端 FD4，可避免之前的 15 秒 exit/stdio 等待超时”这一 harness 假设；但成功 stdout 未打印 timeout 场景的逐事件 end/close 时序，因此因果仍不称完全证明。上一轮五个失败 fixture 仍保留，不是本次成功清理对象。

Task 1 Browser CDP smoke 与 Task 8 仍未完成；Task 2+、D3 停止。FD 3/4 probe 即便本次通过，也不等于 Browser CDP Task 1 通过；仍需原硬门槛、后续逐步前置验收、D3 单独授权、人工验收和最终交接。

上轮复核：FD 3/4 smoke 两轮均未通过。复跑中 `fragmented-continue` 通过；`duplicate-continue` 正确拒绝重复且只放行/启动一次，最终自然以退出码 23 退出。诊断显示 app.exit 到 exit/stdio-close 为 15,251 ms，15 秒 awaitExit 超时；代码路径对照发现 duplicate 场景未在退出等待前结束父端 FD4 写流，而成功场景会先结束。该首要 harness 混淆假设尚未通过两端流事件时序证实。上轮复跑失败 fixture 保留、匹配 Electron 残留进程数 0。Task 1 Browser CDP 硬门槛仍未通过，Task 2+、D3 停止。

最新批次覆盖下方先前“具体方案尚待确认”的快照：用户已批准只在 Task 1 隔离 worktree 新增 `scripts/trace-phase2-inherited-fd-smoke.cjs`，验证 Electron 44.2.0 app-mode 的 FD 3/4 双向匿名管道。Smoke 测握手/分帧、EOF、超时、错误 nonce、首次一次性放行、随后重复失败及本次创建资源的有界清理；nonce 只是关联值，失败现场保留，不支持即停止且不自动 fallback。唯一实现 owner 只改该新增脚本；独立复审后主智能体运行。既有 CDP smoke、正式 runner/bootstrap、产品代码、测试和 package scripts 均排除；不接入 CDP/不创建应用页面，不进入 Task 2/D3。Task 1 协议门槛仍阻塞。

Task 8 仍为 `in_progress`。用户已批准早期 Browser CDP 自动附着规格、实施计划及子代理驱动。Task 1 初始提交 `67877f9611192665b96b1c0f2c31221a75281f2d`；修复提交 `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`，隔离分支 `codex/task8-cdp-auto-attach`，worktree clean。初审四项 findings 均经 scoped re-review 判定 addressed，无新 Critical/Important。最终语法检查 exit 0；Electron 44.2.0 smoke exit 1 / 4.18s，在 `isolation-ready` 后 stdin end 并 fail-closed 为 `runner-disconnected`，没有 continue、页面创建或 CDP 协议断言。另两个 no-CDP、无窗口最小 Electron app fixture 都在脚本入口后、`app.whenReady()` 之前收到 stdin end；父端未先写入或调用 end，`windowsHide:true/false` 一致。相同 Node 24.18.0 父进程到普通 Node 子进程的 overlapped stdin 控制探针则收发成功。这把失败定位到当前 Electron app-mode 标准输入生命周期/本机启动路径，但没有揭示 Electron 内部具体关闭原因，也不证明 CDP 不兼容。最终两项 no-CDP 诊断 Temp、两项修复 smoke Temp 与五项既有失败 smoke Temp 均保留，后查匹配 Electron 进程 0。用户确认的一次性放行已实现，但重复消息和 CDP 协议场景尚未运行。Task 2+ 保持停止；不擅自改握手通道、late attach 或扩大 target filter。隔离基线 `npm run typecheck` 通过；全量测试在 `TZ=America/New_York` 下 512 passed、2 个 `buildYearHeatmap` 失败，同一 diary view utils spec 默认时区 14/14 通过；用户同意记录后继续。**用户现已授权仅开展受限本机 IPC 的设计、威胁审查和最小隔离 smoke，但具体方案尚待确认。**两名只读审查者比较 inherited FD/Node IPC、loopback TCP、Windows named pipe；初步建议先用额外继承匿名管道 FD 3/4 做无 CDP/无窗口 Electron app-mode 兼容性 smoke。当前未改代码、未运行新 smoke、未启动 Electron。等待用户审阅并批准具体设计；批准前不实现或运行 spike、不改原 stdin/stdout smoke、不动正式 runner/bootstrap、不进入 Task 2/D3。Task 8 的历史报告对齐、人工验收及最终交接未完成；D3-only 仍需另行授权。详见 [HANDOFF-CURRENT.md](../HANDOFF-CURRENT.md)。

## 目录约定

结构参考用户计划库 `D:\Desktop\Plan`：

```text
docs/Plan/
├── README.md
├── Future_Plan/
│   └── Qore/
│       └── Trace/
│           └── Plan-YYMMDD-NN-名称/
│               ├── <Implementation-Plan>.md
│               └── plan.json
└── <历史平面计划文件>.md
```

- `Future_Plan/Qore/Trace/`：尚未完成或正在实施的 Trace 项目计划。
- 每个计划使用独立目录，目录名包含日期、序号和主题。
- Markdown 是人类与智能体共同阅读的执行真源。
- `plan.json` 是与 Trace 原生计划结构对齐的镜像队列；任务状态更新时必须与 Markdown 同步。
- `docs/HANDOFF-CURRENT.md` 仍是智能体当前工作状态与文件所有权的唯一真源；本目录不取代交接文件。

## 状态约定

| 状态 | 含义 |
|---|---|
| 待确认 | 已形成方案，尚未获得实施确认 |
| 待实施 | 已确认，尚未开始改代码 |
| 实施中 | 已在 `HANDOFF-CURRENT.md` 登记执行者和文件边界 |
| 阻塞 | 已写明阻塞条件、已完成部分和恢复入口 |
| 暂停 | 用户要求停工；已记录当前完成边界和恢复入口，不自动续跑 |
| 已完成 | 验收标准全部通过，并记录真实验证命令 |

## 当前计划索引

- **Task 8 当前执行（2026-10-08 23:08）：** [早期 CDP 自动附着设计规格](../superpowers/specs/2026-10-08-task8-early-cdp-auto-attach-design.md) 与 FD 3/FD 4 transport 修订均已获用户批准；[实施计划](Future_Plan/Qore/Trace/Plan-261008-01-Task8早期CDP自动附着/Task8-Early-CDP-Auto-Attach-Implementation-Plan.md) 和 [Task 8 完整现状](Future_Plan/Qore/Trace/Plan-261003-01-小沅计划操作与统一回收站/Task8-Current-Status-2026-10-08.md) 已同步本轮结果。唯一 Browser CDP smoke exit 1，卡在四个 page session 的 `Runtime.enable` 均无响应；原因未知，失败 fixture 保留、Electron 遗留进程 0，不重跑。正式 runner/bootstrap 未改；Task 1 未通过，Task 2+ 与 D3 停止。
- **Task 8 16:15 复审历史快照：** [完整现状记录](Future_Plan/Qore/Trace/Plan-261003-01-小沅计划操作与统一回收站/Task8-Current-Status-2026-10-08.md) 保留 renderer waiter 的直接事件/竞态/超时测试、三轮双轴复审结果及首次 attach 前异常边界；当前状态以本索引顶部实时状态及 HANDOFF 为准。
- **Task 8 历史暂停记录（04:10，后续已恢复）：** 该时点的“未实施/未重跑”及早期 D3 失败记录均保留在完整现状文档内，不代表当前交接状态。
- Task 8D3 runner 根节点展开修正已授权并登记（2026-10-08 04:04 +08:00）：用户确认持续授权继续推进。唯一 owner `/root`，仅持有隔离 Electron QA runner 与 HANDOFF/共享计划镜像；runner 基线 SHA256 `9114DC80ADF75BF60ED245A1570AF4ADE759B2DFB0109BB9BEF8B145BE7705D0`。只给 D3-only 准备流程补真实 UI 根节点展开，并等待精确目标行可见；不改产品/bootstrap/test 或默认完整 runner 路径。完成静态校验及 Spec/Standards 独立只读复审后，仅运行一次精确 D3-only 命令，不跑完整 runner/D1/D2、不接触历史失败 fixture；新失败 fixture 保留且停止，不重试。Task 8 仍进行中。
- Task 8D3 failure-only 诊断的静态追踪定位到 QA 准备缺口（2026-10-08 03:42 +08:00）：新 run 的 root IPC 含 5 项且精确目标唯一存在，renderer 仅 1 行可见。runner 使用的 worktree 源码中 `expandedKeys` 初始为空，库根仅在包含 `''` 时展开，`TreeGroup` 对收拢根返回 null；D3 runner 通过 IPC 建立顶层 fixture 后仅 F5 刷新、未展开库根便定位目标。root 层 IPC create/refresh 不会打开根，运行快照与默认收拢状态吻合。判定本次失败为 QA runner 准备漏展开，不是产品删除/引用缺陷。未读取失败 fixture、未改代码、未重跑；下一步需授权最小 runner 修正和新的单次 D3-only 验收。Task 8 仍进行中。
- Task 8D3-only 单次运行失败并停止（2026-10-08 03:37 +08:00）：精确运行命令 `node scripts/trace-phase2-isolated-electron-runner.cjs --d3-delete-reference-diagnostic`，runner SHA256 `9114DC80ADF75BF60ED245A1570AF4ADE759B2DFB0109BB9BEF8B145BE7705D0`，runId `3c0c8e231c647bf68754de9221abee62`，exit 1。root IPC 初始/复查均含唯一目标（5 个根节点，目标 kind=plan）；renderer root mounted、F5 handled，但可见树行仅 1，目标行/选中为 0，runtime exception 0。失败仍在首个精确树行定位、未进入删除/引用；provider 未启动/请求 0。新失败 fixture `C:\Users\aaa\AppData\Local\Temp\trace-agent-phase2-isolated-e2e-UQXNrj` 保留且未读取/清理；旧 fixture 未触碰。根因仍未确定，不归因产品故障；一次授权已用完，不重跑。Task 8 仍进行中。
- Task 8D3-only 新一轮运行已获用户“继续”授权，执行前登记（2026-10-08 03:34 +08:00）：单次执行 owner `/root`；精确运行命令 `node scripts/trace-phase2-isolated-electron-runner.cjs --d3-delete-reference-diagnostic`；runner SHA256 `9114DC80ADF75BF60ED245A1570AF4ADE759B2DFB0109BB9BEF8B145BE7705D0`。隔离 worktree、production main bundle、Electron 可执行文件存在；只跑 D3-only，不运行完整 runner/D1/D2，不碰历史失败 Temp。新 run 使用唯一 owner-marked `%TEMP%` fixture；失败保留，成功后只校验并清理本轮自有 fixture。当前可选本机 `.dbg` event listener 不接受连接。运行结果待记录；Task 8 仍进行中。
- Task 8D3 runner 失败诊断已实现，所有权已释放（2026-10-08 02:26 +08:00）：仅改隔离 QA runner，SHA256 `9114DC80ADF75BF60ED245A1570AF4ADE759B2DFB0109BB9BEF8B145BE7705D0`。D3 目标树行定位失败时记录初始/当前树 IPC 的精确目标摘要（当前 IPC 查询前校验 library identity）、导航视图、目标 DOM 可见性/数量与 renderer exception 数，不记录其他计划名称/正文或原始错误；非 D3 路径无额外诊断。`node --check`、runner 无尾随空白、`git diff --check`、计划 JSON/211 个唯一 ID 通过。未重跑或触碰 Temp；未做独立 reviewer 复审。需要用户另行授权 D3-only 运行。Task 8 仍进行中。
- Task 8D3 授权后的只读诊断（2026-10-08 01:52 +08:00）：runId `6e0479c0995621b61eea06a468c95eda` 的 owner marker 匹配；合成库内目标计划目录与 `plan.json` 存在，隔离日志目录为空。实际 runner worktree 源码中 F5 handler 只 `preventDefault()` 并 fire-and-forget `refreshAll()`；runner 只证明按键被处理，失败产物没有刷新后的 tree IPC/store/view/DOM 快照。因此证实磁盘 fixture 存在而 DOM 行未定位，具体运行根因仍未知，不判定产品 bug。未重跑、未写入/清理 fixture；若继续需先登记并复审有界诊断改动，再另行授权运行。Task 8 仍进行中。
- Task 8D3-only 最终复审通过后唯一获准运行失败（2026-10-08 01:27 +08:00）：runId `6e0479c0995621b61eea06a468c95eda`，exit 1。隔离 bootstrap/root/write gate 与 F5 handler proof 通过，但随后等待精确 fixture 树标题 `QA UI Delete Context Target` 超时；没有进入首次删除或引用 UI，provider 请求 0、renderer runtime exception 0。新失败 fixture `C:\Users\aaa\AppData\Local\Temp\trace-agent-phase2-isolated-e2e-eWQHQP` 保留不清理，旧 fixture 未触碰。一次运行授权已用完，不重跑；Task 8 仍进行中。
- Task 8D3-only 最终静态复审已通过，开始唯一授权运行（2026-10-08 01:25 +08:00）：Spec/Standards 两轴均 Ready Yes，runner SHA256 `F712A8769CEF0271C75B4582C2BEB283928186449E4DF5869786BC71154C4321`。仅运行 `node scripts/trace-phase2-isolated-electron-runner.cjs --d3-delete-reference-diagnostic` 一次；不跑默认完整 runner/D1/D2，不触碰旧失败 Temp。F5 仅用于 D3-only，失败保留本次新 fixture 并停止。Task 8 仍进行中。
- Task 8D3 F5 证明已限定在 D3-only 分支（2026-10-08 01:23 +08:00）：默认完整 runner 继续使用 View 菜单刷新；仅 D3-only 使用 F5，并要求焦点非输入态、App 对 F5 调用 preventDefault，5 秒硬 deadline 覆盖整个 helper。两轴 reviewer 正复核 SHA256 `F712A8769CEF0271C75B4582C2BEB283928186449E4DF5869786BC71154C4321`。语法、diff-check、计划 JSON/ID 校验通过，尚未运行 Electron/runner。用户授权双审通过后仅一次 D3-only；不跑完整 runner/D1/D2、不碰旧失败 Temp，失败保留新 fixture 并停止。Task 8 仍进行中。

- Task 8D3 第二次 D3-only 运行失败（2026-10-08 00:41 +08:00）：runId `be19e30810892d323419585853487ce4`。隔离 root/write gate 通过，但 QA runner 在首个 D3 删除交互前等待“刷新计划树”超时。failure-only snapshot 显示唯一 View trigger 可见、1 个可见 dropdown/2 个 menuitem，但精确 locator 与目标文案 popup 均未匹配；实际运行 worktree 的源码与 renderer bundle 都包含该静态文案，然而 popup 未关联 trigger 且菜单项文本未采集，故运行时差异根因尚未证实。D3 右键/删除/引用决策未执行，provider 请求 0、renderer runtime exception 0。本轮 fixture 由 owner marker 验证后保留；不得重跑，需诊断并重新获授权。Task 8 仍进行中。
- Task 8D3 round-3 精确复审通过（2026-10-08 00:30 +08:00）：Spec 与 Standards/Privacy 均 Ready Yes、0 findings；当前 runner SHA256 `7C96FC9AC281A540E73B9670BE6EB0FF0220C9F18BCDB0E2CC81EB8E46873C94`，delta 7+/5-。Unresolved 分支仅标量，目标 popup 与 View trigger 唯一时才输出 trigger 详情；round-2 bounds 和原始交互不变。未运行 Electron/runner/tests/build、未碰 Temp。D3 运行仍未验证，第二次 D3-only 运行需用户明确授权。
- Task 8D3 round-3 unresolved-trigger 修正已实现，等待新的双只读复审（2026-10-08 00:28 +08:00）：相对 round-3 snapshot 7+/5-，当前 runner SHA256 `7C96FC9AC281A540E73B9670BE6EB0FF0220C9F18BCDB0E2CC81EB8E46873C94`。未解析时仅输出标量；唯一目标 popup 且唯一 View trigger 时才输出 trigger 详情。node 语法与精确空白检查通过；不运行 Electron/runner/tests/build，不碰 Temp。D3 运行仍未验证，重跑另需用户授权。
- Task 8D3 round-2 双审均发现同一 unresolved trigger-state P2，round-3 精确修正已登记（2026-10-08 00:25 +08:00）：未唯一解析 popup 时仍输出 trigger rect/ARIA，可能取第一个 duplicate trigger。round-3 基线 `task-8D3-refresh-menu-round3-before-runner.cjs` SHA256 `0C8143CC066253CA5FC596645BD03BB1731A94A23F06B089552BFD73DCEE9111`；唯一 owner `/root/task8_d3_only_runner_impl` 仅改 runner，使未解析分支仅标量、唯一解析且 trigger 唯一时才输出详情。brief `task-8D3-refresh-menu-trigger-state-brief.md`。实施后需两名新 reviewer 复审；不运行 Electron/runner/tests/build、不碰 Temp，D3 重跑仍须用户授权。
- Task 8D3 诊断快照 round-2 精简实现已完成，等待双独立复审（2026-10-08 00:20 +08:00）：round-2 基线 SHA256 `BB40CEB7BD5BBDEF7CCE3387B71A011B2085C64093BAF36F686055BE8E6EE41F`，精确差异 110+/24-，当前 runner SHA256 `0C8143CC066253CA5FC596645BD03BB1731A94A23F06B089552BFD73DCEE9111`。只为唯一目标 View popup 输出详情，解析不唯一时仅输出聚合计数；明细上限 class 8/item 12。node 语法及精确快照检查通过；未运行 Electron/runner/tests/build、未触碰 Temp。双审通过也不代表 D3 运行通过，重跑仍需用户明确授权。
- Task 8D3 诊断快照精简修复已登记（2026-10-08 00:05 +08:00）：第一轮 Spec 复审通过，Standards/Privacy 提出 P2，因遍历全部 dropdown 且详情数组/无关标题长度无上限。修复 owner `/root/task8_d3_only_runner_impl` 仅改 runner 单文件；round-2 基线 `task-8D3-refresh-menu-round2-before-runner.cjs` SHA256 `BB40CEB7BD5BBDEF7CCE3387B71A011B2085C64093BAF36F686055BE8E6EE41F`。要求目标菜单限定、明细数组限长、保留标量总数；检查限 node 语法与精确快照，不运行 Electron/runner/tests/build，不碰 Temp。新双审后仍需用户明确授权 D3-only 重跑。
- Task 8D3 刷新菜单 timeout 的 failure-only 结构快照已实现，正在做两份独立静态复审（2026-10-08 00:03 +08:00）：相对实施前快照精确增量 58+/1-，当前 runner SHA256 `BB40CEB7BD5BBDEF7CCE3387B71A011B2085C64093BAF36F686055BE8E6EE41F`。只在原 locator timeout 时采集无正文结构信息；原点击/selector/等待/断言与错误传播不变。实施者 node 语法与精确快照空白检查通过；未运行 Electron/runner/tests/build。复审不自动授权重跑，D3-only 再运行仍待用户明确授权。
- Task 8D3 菜单超时只读诊断结论与 runner 快照边界（2026-10-07 23:53 +08:00）：两名诊断者一致认为现有证据只能定位到“查看”菜单点击后，精确可见菜单项查询未满足；静态源码存在对应菜单项，运行时 DOM 不可得，不能判定产品 bug。已登记实施者 `/root/task8_d3_refresh_menu_diagnostic_impl` 仅改 `scripts/trace-phase2-isolated-electron-runner.cjs`，以 `task-8D3-refresh-menu-before-runner.cjs`（SHA256 `F7040E5CB00F32A804F75AFA76FE09D6E6DD2CE4FA25655ABEC6645C76AC5B69`）为精确快照：仅该等待失败时捕获内容受限的触发按钮/Dropdown/菜单结构与入口名，不改点击、locator、等待/断言，不加 fallback/retry。仅可语法/精确 diff 检查；实施后双 reviewer 只读审查，不运行。再次 D3-only 必须获得用户明确授权。
- Task 8D3-only 首次运行在准备阶段失败（2026-10-07 23:46 +08:00）：runId `f939171beef72635572b4296283a19a4`，隔离 root/bootstrap 核验通过，合成 fixture 创建后在首次删除交互前等待“刷新计划树”菜单项超时。未执行 D3 右键/菜单/Delete 或引用决定断言；provider 未启动、请求 0、renderer runtime exception 0。失败 fixture 保留于当前 runner 的 owner-marked Temp；旧失败夹具未触碰。当前只登记只读诊断，不运行、不改码；若需再次运行，需先明确授权，因为本轮一次性 D3-only 运行已用完。
- Task 8D3 参数防误触修复复审通过（2026-10-07 23:40 +08:00）：未知 CLI 参数在任何副作用前拒绝且不回显值；无参数默认完整 runner、两个精确 D1/D3 mode 保持。仅 runner 文件精确差异 8+/2-，最终 SHA256 `F7040E5CB00F32A804F75AFA76FE09D6E6DD2CE4FA25655ABEC6645C76AC5B69`；node --check 与空白检查通过。Spec/Standards 两名独立只读 reviewer 均 Ready: Yes、0 findings；确认拒绝发生在 Temp 初始化前且原默认/诊断行为未变。D3 首次单独运行结果见上条；Task 8 仍进行中。
- Task 8D3 当前推进（2026-10-07 23:20 +08:00）：D1-only 诊断 runId `44aa5b1692f7b3e8ee53694a4e9870cf` PASS；此前 D1 timeout 本轮未复现，根因仍未知。D3-only runner mode 已实施/释放：仅修改 `scripts/trace-phase2-isolated-electron-runner.cjs`，相对快照 SHA256 `871043A0C51AC06105C6744514A0B4FE6105E0F1BA726C926C1A2F4568FCB404` → `76F7443870D9E581234A2DC65E2A68D554352B3AEE854F3BE38C3609C4B7998C`，37 行新增/2 行删除。新模式在根核验后只运行普通计划删除/引用 keep-replace 场景，跳过 provider/D1/D2，默认和 D1-only 路径保留；`node --check`/快照空白检查通过，未运行 Electron。两名独立 reviewer 正审精确增量，待审完后协调者可运行一次 D3-only。D3 尚无运行通过证据；无第三次完整 runner。Task 8 仍进行中；full suite 保持 1181/1183。

- Task 8D2 已完成；D3 代码已实现、静态复审通过但运行未验证（2026-10-07 22:40 +08:00）：D3 runner 增量为 231 行新增、1 行删除，node --check 通过，Spec 与 Standards 两轴各 0 findings。两次完整 runner 均在 D3 前停止：首轮既有 SAVE_FAILED，第二轮在 D1 恢复对话框关闭等待超时；不声称 D3 运行通过，也不再启动第三次 runner。两份失败夹具仍留在 Temp；首份清理被自动审查拒绝，未绕过。产品及真实库未写，已接受的 SAVE_FAILED 仍暂缓；Task 8 保持进行中。

- Task 8D1 完成、D2 已登记（2026-10-07 18:08 +08:00）：真实 React 回收站同名冲突/改名重新预览恢复/稳定 ID 定位和 purge 名称门槛/main 取消已通过实施者实跑、独立精确增量复审与协调者完整 runner 复跑（9 个 loopback 请求、owner Temp 核验清理）。下一片仍只改 QA runner：目标移动/删除授权失效、读取后外发取消、顺序批次中途业务冲突与只继续未执行项。产品/用户库只读；全量仍保留 1181/1183 的已接受异常记录，Task 8 其余覆盖和人工环境体验仍进行中。

- Task 8D1 已登记并开始（2026-10-07 17:57 +08:00）：子代理仅修改主 checkout 的隔离 Electron runner，补真实 React 回收站同名恢复冲突、改名恢复后的稳定 ID 定位，以及永久清除的名称门槛和主进程第二确认取消。产品源码/bootstrap/安装版/真实库只读；复用 fresh build，不重跑全量以追查已接受的保存异常。待本片实跑、精确增量独立复审及协调者复跑后同步结果，Task 8 仍进行中。

- Task 8 继续推进（2026-10-07 17:44 +08:00）：用户明确决定暂缓偶发保存问题，将其作为已知未解决异常记录，不再阻塞其余验收/开发；不删除或跳过测试、不称全量通过。继续核对并补齐隔离 Electron 的目标移位/失效、恢复冲突/定位、失败批次等实际覆盖缺口，当前无新产品修改；源/QA 所有权实施前登记。系统与应用层 I/O 追因均暂停，真实库不作写入。

- Task 8 最新验证（2026-10-07 17:38 +08:00）：失败版本副作用的最小修复完成，RED→GREEN、两完整 specs 60/60、精确三文件独立规格/质量复审 Approved；前次回收站精确读取 Minor 复审也 Approved。协调者 typecheck、现有 renderer 保留草稿回归 1/1、build、fresh production build 隔离 Electron（9 次 loopback 请求）通过，临时库已核验清理。完整串行 84 specs / 1183 tests 为 1181 passed / 2 failed：transfer 语料保存阶段 SAVE_FAILED，底层 errno/主体未捕获，原始偶发 I/O 故障仍未解决。真实安装版及用户库未修改，Task 8 仍进行中、全量门槛未满足。详见 HANDOFF 和既有保存 issue；无提交/合并/升版/安装包/推送/发布。

- Task 8C 保存失败恢复（2026-10-07 17:18 +08:00）：用户确认已安装版偶发自动保存失败、下一次成功；只读核对 `D:\trace` 为 v0.18.1，实际库为 `D:\Desktop\Plan`。不能证明与测试中的 `rename EPERM` 同根因。按 TDD 与子代理实施/独立复审修复已确定的失败版本副作用，精确三文件所有权见 HANDOFF；应用/用户库未修改，尚无本批验证结果。Task 8 仍 `in_progress`、上一轮全量 1177/1181，系统级追因继续暂缓，无推送或发布。

- Task 8 换向方案与受控诊断（2026-10-07 14:16 +08:00）：现有公开服务接口的一次注入 `rename EPERM` 实验确认，保存失败后旧文件/磁盘版本不变，但传入文档的 `updated_at` 已变化；按该文档版本重试冲突，按原服务端版本重试成功。Renderer 独立维护 `serverUpdatedAt`，不能据此认定 UI 重试故障。候选路线为保存失败恢复契约、夹具依赖检查及分层最小对照，尚未实施产品/测试改动；原始 EPERM 根因仍未知，Task 8 门槛未变，上一轮全量仍为 1177/1181。本轮临时库已校验后清理，系统级追因继续暂缓。详见既有保存 issue、HANDOFF 与执行计划。

- Task 8 当前执行（2026-10-07 13:48 +08:00）：Agent 精确 `trash.list` 读取已接入 `PlanReferenceService` 提交队列，并在队列内校验授权 manifest revision。恢复/清除两项并发回归和 typed IPC 精确目标断言通过；相关完整 specs 95/95、typecheck、build、隔离 Electron 真实 IPC runner 均通过。无探针串行全量 84 specs / 1181 tests 为 1177/1181；4 项 `SAVE_FAILED` 都在 plan-reference/search 测试夹具 `writeJsonAtomic` 阶段，根因未确认。用户选择暂缓系统追因，未启动 ProcMon/ETW。独立 scoped review 固定点待用户选择；Task 8 仍未完成，真实用户库/DPI/IME/读屏验收待后续。详见 HANDOFF、执行计划和 issue。

- Task 8 验证（2026-10-07 12:02）：核心 4 specs 130/130、IPC fixture 修复 3 specs 55/55、Node/Web typecheck 及固定启动时区后的 DST 定向 2/2 通过。固定 `TZ=America/New_York` 的全量为 84 specs / 1179 tests，1178/1179；唯一 `SAVE_FAILED` 在 plan-reference 测试夹具保存时触发，窄探针捕获一次 `rename EPERM (-4048)`，但路径、进程及过滤器均未知，同一单测无注入重跑通过。按用户偏好暂缓进一步系统诊断，问题未修复/未归因。下一步当前源码 build + fresh-build 隔离 Electron E2E + 最终审查；Task 8 未完成。详见 HANDOFF 和当前问题条目。

- Task 8 SAVE_FAILED（2026-10-07 00:33）：继续验收时 CAS focused suite 出现 2/194 个 fixture 保存失败，发生在目标业务动作之前；单独复跑 3/3 通过，底层 FS 错误码仍未知。按用户给定的再次出现条件，恢复窄范围诊断；只收集操作名/错误码，不做系统过滤器归因、不碰 PML。详见计划与 HANDOFF。

- Task 8 ProcMon（2026-10-07 00:19）：用户确认重新打开 PML 无报错；先前加载错误由协调者在 ProcMon 已运行时发起命令行 `/OpenLog` 尝试引起，不代表 PML 损坏。最新定向测试两项各 20/20，未复现；历史自动化失败发生于 fixture 准备阶段，根因仍不明。依用户意见暂缓此问题的主动追查，等待真实使用再次复现；未修复、不归责过滤器。PML 保留本机、未解析事件记录。详见[本机获取与验证记录](./research/ProcMon官方获取与签名验证-20261006.md)。

- Task 8 ProcMon（2026-10-07 00:02）：ProcMon 捕获期间在隔离 worktree 对两项登记测试各串行 20 轮，folder rename/trash 20/20、transfer-junction 20/20，未复现 `SAVE_FAILED`，根因未确认。PML 当时仅核元数据，为 671,088,640 bytes；停止采集后的稳定性和加载检查见上方最新状态。详见[本机获取与验证记录](./research/ProcMon官方获取与签名验证-20261006.md)。

- Task 8 ProcMon（2026-10-06 23:52）：最新截图确认 ProcMon 应用仍开着，底栏 `No events (capture disabled)` 表示采集关闭，`Backed by virtual memory` 表示 PML backing file 未设置；更正 23:50“应用已关闭”的误读。用户确认过滤规则已应用。下一步先配置本地 PML，再点击 Capture Events/Ctrl+E 开始；目前未采集、未运行测试。详见[本机获取与验证记录](./research/ProcMon官方获取与签名验证-20261006.md)。

- Task 8 ProcMon（2026-10-06 23:50）：用户确认过滤规则已应用，ProcMon 当前关闭，故采集已停止；不需要重启 Windows，只需重开 ProcMon。重开后核对过滤设置是否保留及采集是否自动开启，再配置本机 backing file。PML 尚未生成，未运行目标测试。详见[本机获取与验证记录](./research/ProcMon官方获取与签名验证-20261006.md)。

- Task 8 ProcMon（2026-10-06 23:42）：截图确认 `Filter > Drop Filtered Events` 已勾选。进程级 `TEMP`/`TMP` 指向 fixture 根目录时，`node:os.tmpdir()` 实测返回该路径，目标测试夹具可匹配 Path Include；未改系统环境。backing file 尚未配置、PML 不存在，采集/目标测试均未开始；Path Include 是否已应用与 Capture Events 状态仍待核实。下一步配置本机 backing file，再确认采集状态后短时复现。详见[本机获取与验证记录](./research/ProcMon官方获取与签名验证-20261006.md)。

- Task 8 ProcMon（2026-10-06 23:37）：主窗口 File 菜单截图中 Capture Events 前没有明显勾选标记，视觉上判断为停止/暂停；不再次点该切换项，采集状态仍非独立确认。此前过滤截图确认 6 条 Process Exclude 已取消启用而规则保留，fixture-root Path Include 保持启用；Filter 对话框已关闭，但是否 Apply 未证实。尚未复现/运行用例，PML 尚未创建。下一步只检查 Filter > Drop Filtered Events 是否勾选；保持/启用后回传状态，再决定开始捕获。详见[本机获取与验证记录](./research/ProcMon官方获取与签名验证-20261006.md)。

- Task 8 ETW 状态（2026-10-06 22:33）：管理员已成功停止并导出目标 ETL；本机核验 source 134,217,728 bytes、merged 143,654,912 bytes，丢失 buffers/events 均为 0。初筛观察到 281 条 `MiniFilterPreOpFail`、235,035 条 `FileIoOpEnd`、5 条 `FileIoRename`，但文件名报告没有目标夹具路径，事件/状态码无法关联到失败保存或具体过滤器；Task 8A 根因仍未知。ETL 留在本机 Trace `temp`，未上传或删除。该时间点 ProcMon 尚未获取；当前便携包与启动/采集授权边界见上方最新状态。没有代码、测试或系统设置变更。

- Task 8 ETW 复现记录（2026-10-06 21:52）：正确 source 路径的管理员采集已运行；目标用例第 1 轮 2/2 通过，第 2 轮 folder rename/trash 用例在准备保存 `RenameSource` 时再次 `SAVE_FAILED`，业务层 folder rename/trash 未执行，已按首次失败停止。此时 source ETL 达到 128 MiB，合并 ETL 尚待管理员导出；后续导出与分析结果见上方。

> Task 8 ETW 收尾已核验（2026-10-06 21:29）：用户管理员 PowerShell 已停止本轮 `NT Kernel Logger` 并导出到 Trace temp；Codex 只读核验 logger 无活动、退出码 0，ETL 存在（144,703,488 bytes）。跟踪窗口没有运行目标用例，ETL 不作故障归因且未读取内容；`C:\kernel.etl` 仍保留（134,217,728 bytes），未读取/移动/删除。下一轮 source/export 文件名已预检不存在，将通过 `-f` 显式放入 Trace temp；logger 确认活动后立即串行运行已登记的 plan-reference folder rename/trash 与 transfer junction 两项目标测试（最多 20 轮、首次失败即停），然后显式停止并导出；其他 logger 不触碰。

> Task 8 ETW 启动结果待核实（2026-10-06 20:54）：用户执行启动命令后发现默认位置 `C:\kernel.etl` 有 128 MiB 文件（20:46:20 创建、20:53:38 最后写入），并非登记的 Trace temp 输出位置。Codex 非提升 shell 当前未列出活动 `NT Kernel Logger`；仍需管理员 PowerShell 只读查询确认会话状态。目标测试没有在跟踪窗口运行，ETL 未读取/搬动/删除，不作为失败证据。下一步先回传管理员侧 `xperf -loggers "NT Kernel Logger"` 及 `$LASTEXITCODE`；核清当前 session 与默认 ETL 后再决定后续，暂不再启动或测试、不碰既有 logger。

> Task 8 ETW 跟踪待启动（2026-10-06 19:19）：已只读核验 WPR not recording、无活动 `NT Kernel Logger`；FilterMgr、Defender、DiagTrack 等既有 session 未触碰。短时跟踪配置和唯一忽略输出目录已登记在 HANDOFF。等待用户在可见管理员 PowerShell 启动本轮 logger 并确认；随后在 dirty 隔离 worktree 对两个目标用例串行最多 20 轮，首个失败立即停止。MessageTransfer 缺席时已在第 4/5 轮重现一次 `SAVE_FAILED`，故它不是必要条件，但根因未明。当前不改代码/系统设置、不导入 `.reg`。

> Task 8 MessageTransfer 缺席状态验证（2026-10-06 19:10）：用户确认 PWA 在重启前已卸载。隔离 worktree 的两个临时库目标测试共运行 5 轮，folder rename/trash 4/5、transfer-junction 5/5；第 4 轮 folder case 在准备阶段保存 `RenameSource` 时重现 `SAVE_FAILED`（`StorageService.savePlan → PlanRepository.writeJsonAtomic`），底层 Win32 错误未捕获，本轮无 ETW。TEMP/TMP 均为 C: 默认临时目录。说明无 MessageTransfer 时仍能发生该故障，故它不是必要条件；不排除其他过滤器参与。结果仅为应用卸载后的状态观察，不是 Start=4 单变量对照。

> Task 8 软件归属只读核验（2026-10-06 18:28）：MessageTransfer 的驱动元数据为 PerfectWorld Ltd. / 版本 1.0.0.2，找到匹配的软件登记“完美世界竞技平台 1.0.26072311”；当下未发现从该插件目录运行的进程，但驱动仍 Running/Auto，关闭 UI 并不能证明已隔离。AliPaladin 文件元数据为 AliBaba Group / 版本 1.19.4.1989，当前卸载登记查询未找到匹配软件，来源仍不明。没有系统/软件变更。若要做单候选对照，需先批准禁用方式与重启窗口。

> Task 8 追加只读核验（2026-10-06 18:17）：`MessageTransfer` 与 `AliPaladin` 均为 Running/Auto 的 `FSFilter Activity Monitor` 文件系统驱动；`gameflt` 为 Running/Manual，`WdFilter` 为 Running/Boot。当前 Codex 执行 shell 的 `fltmc` 仍因权限不足失败；WPR 未录制，但多个已有 ETW logger 未被触碰，本轮未启动/停止跟踪。候选相关性增强，拒绝者仍未知。没有驱动、代码或测试变更；下一步需用户先选定单一候选与可逆隔离方式，不直接 `fltmc unload`。

> Task 8 最新状态（2026-10-06 18:07）：用户提供管理员 `fltmc instances -v C:` 输出，确认 `MessageTransfer`、`ahflt`、`WdFilter`、`AliPaladin`、`gameflt` 等均附着 C:，且这些过滤器在故障前有 FilterManager 加载记录。只读映像查询确认 MessageTransfer 与 AliPaladin 为有效签名的厂商驱动；gameflt 是微软 Gaming Install Filter；PC Manager 3.22.6.0 包含微软签名的 AntiHack `ahflt.sys`，但运行实例的精确映像关联未验证。挂载提高相关性但没有归责证据，先前 ETW 仍无匹配 `MiniFilterPreOpFail`。没有驱动/系统配置修改。若继续归因，需先经用户确认再做单个候选的可逆隔离对照；不盲目 `fltmc unload`。

> Task 8 当前状态更新（2026-10-06 15:05）：首批 ETL identity 正确且 helper `stopped:0`，但测试在错误 checkout，仅 3 specs / 42 tests、42 pass，不作为目标复现。清理该批自有 128 MiB Temp 目录被执行策略拒绝；未尝试替代手段，精确路径见 HANDOFF。第二批已登记在正确隔离 worktree `codex/xiaoyuan-plan-operations`（HEAD `3cc1439`），不改动其既有 dirty/untracked 文件；仅运行四个目标 specs。新 Temp、128 MiB circular/180 秒、只 stackwalk `FileRename+FileOpEnd`；提权 helper 必须先核实 ETL identity，否则不跑测试。其他系统/应用 ETW sessions 均保持不动。Task 8A 根因未知，Task 8 未完成。

| 计划 | 状态 | 创建日期 | 审计/规格 | 当前下一步 |
|---|---|---|---|---|
| [前端体验与地基整改](./Future_Plan/Qore/Trace/Plan-260915-01-前端体验与地基整改/Frontend-Experience-Foundation-Implementation-Plan.md) | Task 1–11 实施与验证完成；上限树动效和 Release 多轮性能采样另行跟踪 | 2026-09-15 | [综合审计报告](../audit/2026-09-15-frontend-ui-performance-architecture-audit.md) | 见真实性能报告；尚未合入主分支或推送 |
| [注释 Muya 正式集成](./Future_Plan/Qore/Trace/Plan-260917-02-注释Muya正式集成/Muya-Note-Formal-Integration-Implementation-Plan.md) | 实施完成，待正式卡片人工验收 | 2026-09-17 | [Muya 设计规格](../superpowers/specs/2026-09-15-muya-note-editor-design.md) | 用户验收 IME、剪贴板、语言选择、连续删除、切卡 flush、亮暗主题和窄窗口 |
| [v0.15.0 双平台发布](./Future_Plan/Qore/Trace/Plan-260923-03-v0.15.0双平台发布/Trace-v0.15.0-Release-Plan.md) | 已完成：GitHub/Gitee Release 已发布并核验 | 2026-09-23 | 上次发布 v0.12.0，增量为 F2、Muya 与前端地基批次 | 发布闭环；后续跟进 Muya 人工验收等独立待办 |
| [发布后稳定性与 v0.15.1 修订发布](./Future_Plan/Qore/Trace/Plan-260924-04-发布后稳定性/Trace-Post-Release-Stability-Plan.md) | 稳定性修复及 v0.15.1 双平台发布已完成；Muya 人工验收待后续 | 2026-09-24 | 发布后稳定性 issue 与 Muya 正式集成验收清单 | 重启开发服务器复验正式 NoteCard 首次激活，再完成 IME/剪贴板等人工体验验收 |
| [任务三态视觉反馈](./Future_Plan/Qore/Trace/Plan-260926-01-任务三态反馈/Task-Three-State-Feedback-Implementation-Plan.md) | 自动实现、完整验证及双阶段审查完成；待 Electron 亮暗主题和交互人工验收 | 2026-09-26 | [已批准设计规格](../superpowers/specs/2026-09-26-task-state-and-offline-plantuml-design.md) | 首次 in_progress 选择器问题已修；人工检查第一次进行中、第二次完成、第三次回退，并覆盖鼠标/键盘 |
| [离线 PlantUML 本地服务](./Future_Plan/Qore/Trace/Plan-260926-02-离线PlantUML本地服务/Offline-PlantUML-Service-Implementation-Plan.md) | 实现、自动验证、双平台 Release 与发布记录均完成 | 2026-09-26 | [已批准设计规格](../superpowers/specs/2026-09-26-task-state-and-offline-plantuml-design.md) | 发布计划已闭环；任务三态人工验收仍作为独立后续项 |
| [顶栏居中胶囊式页面导航](./Future_Plan/Qore/Trace/Plan-260927-01-居中胶囊导航/Centered-Liquid-View-Navigation-Implementation-Plan.md) | Task1–4 实施、审查和实窗验证完成；已本地合入 `main`（`efa6941`）；合并后 typecheck、40 files / 396 tests、build 全通过 | 2026-09-27 | [已确认设计规格](../superpowers/specs/2026-09-27-centered-liquid-view-navigation-design.md) | 功能已纳入当前 v0.18.0 双平台发布计划 |
| [v0.18.0 双平台发布](./Future_Plan/Qore/Trace/Plan-260927-02-v0.18.0双平台发布/Trace-v0.18.0-Release-Plan.md) | 已完成：GitHub/Gitee Release 均公开核验；GitHub 安装包 210,584,915 bytes、digest 匹配；Gitee ID `1169912`、正文匹配且无 exe；tag 指向 `d91ece4`；发布账本提交 `c3a985e` 已双端同步 | 2026-09-27 | [页面导航设计规格](../superpowers/specs/2026-09-27-centered-liquid-view-navigation-design.md) | 发布闭环；NSIS 安装交互未单独执行，见发布说明 |
| [逾期标签布局稳定](./Future_Plan/Qore/Trace/Plan-260927-03-逾期标签布局稳定/Overdue-Badge-Layout-Stability-Plan.md) | 修复与验证完成，已纳入 v0.18.1 双平台 Release | 2026-09-27 | [当前 issue](../../.issues/2026-09-27-任务详情卡片瞬时宽度跳变.md) | 用户可用 v0.18.1 安装版复验取消勾选时布局稳定性 |
| [v0.18.1 双平台补丁发布](./Future_Plan/Qore/Trace/Plan-260927-04-v0.18.1补丁发布/Trace-v0.18.1-Release-Plan.md) | 已完成：GitHub/Gitee Release 公开核验；GitHub 安装包 210,580,598 bytes、digest 匹配；Gitee 无 EXE；发布账本 `f618a51` 已双端同步 | 2026-09-27 | 逾期标签布局稳定修复 `fda4972` / `8491c00` | 用户安装版复验和 NSIS 安装向导交互尚未执行 |
| [日记自动补建与计划命名模板](./Future_Plan/Qore/Trace/Plan-260928-01-日记补建与计划命名模板/Diary-Backfill-and-Plan-Templates-Implementation-Plan.md) | 已完成并本地合入 `main`（merge `363dce0`）；合并后 typecheck、48 files / 512 tests、build、diff-check 通过；真实 Electron 模板设置/预览/创建与 renderer 切库 UI 验收通过；五个隔离 QA Temp 目录均已复核不存在。TOCTOU 与 storage cleanup 残余已记录 | 2026-09-28 | [已确认设计规格](../superpowers/specs/2026-09-27-diary-backfill-and-plan-name-templates-design.md) | 无剩余计划项；未推送/发布，版本未变更 |
| [右侧计划标签栏](./Future_Plan/Qore/Trace/Plan-260930-01-计划标签栏/Plan-Tabs-Implementation-Plan.md) | Task 1–4 实现、53 files / 559 tests、typecheck/build、独立审查与真实 Electron 用户路径验收完成；Task 4 `76578c5d` | 2026-09-30 | [已确认设计规格](../superpowers/specs/2026-09-30-plan-references-remarks-tabs-design.md) | 开始依赖它的 Plan 02「跨计划引用」；不含发布 |
| [跨计划引用](./Future_Plan/Qore/Trace/Plan-260930-02-跨计划引用/Cross-Plan-References-Implementation-Plan.md) | Task 1–5 完成；`54e9cac` + 实窗竞态修复 `ca37816`；64 files / 672 tests、typecheck、build、diff-check 通过；累计独立复审 0 Critical/Important；隔离 Electron 全流程验收完成并清理 QA 目录 | 2026-10-03 | [已确认设计规格](../superpowers/specs/2026-09-30-plan-references-remarks-tabs-design.md) | 转入小沅 Phase 2 设计与实施；未合并、未升级版本、未发布 |
| [小沅计划操作与统一回收站](./Future_Plan/Qore/Trace/Plan-261003-01-小沅计划操作与统一回收站/Xiaoyuan-Plan-Operations-Implementation-Plan.md) | Task 8 代码已合入并随 v1.0.0 正式发布；集成全量测试 1187/1190（用户批准跳过 3 项，不记全绿）。Claude 报告 D3 通过，Codex 未独立重跑；CDP runner 本地真实运行证据仍未通过，8A 根因未知。 | 2026-10-03 | [Phase 2 设计规格](../superpowers/specs/2026-10-03-agent-plan-operations-design.md) | 用户侧安装/卸载与键鼠/IME/DPI/窄窗口/读屏验收待安排；CDP 与 8A 按各自记录继续，不将其描述成发布已验证 |
| [Trace v1.0.0 正式版发布](./Future_Plan/Qore/Trace/Plan-261009-01-v1.0.0正式版发布/Trace-v1.0.0-Release-Plan.md) | 已完成：版本更新、Windows x64 安装包、GitHub/Gitee Release、发布账本与双端 refs 均核验 | 2026-10-09 | [v1.0.0 发布说明](../../builds/release_notes/release_notes_v1.0.0.md) | 用户侧 NSIS 安装/卸载及输入体验验收仍待安排；不改变本计划已完成的发布状态 |
| [组件 Markdown 备注](./Future_Plan/Qore/Trace/Plan-260930-03-组件Markdown备注/Component-Markdown-Remarks-Implementation-Plan.md) | 已确认规格；计划已编制，依赖标签栏与跨计划引用 | 2026-09-30 | [已确认设计规格](../superpowers/specs/2026-09-30-plan-references-remarks-tabs-design.md) | 前两计划验收并释放卡片公共文件后执行；所有组件复用按需 Muya |

Task 8 历史状态快照（2026-10-06 12:55；当前状态见上方）：Task 8A `SAVE_FAILED` 根因未知、产品代码未修复。完整串行 84 specs / 1174 tests 为 1167 pass、7 fail；定向四 spec 87 tests 为 82 pass、5 fail，失败用例变化。UAC WPR helper 返回 `0xc5583001 profiles already running`；有多个 `WPR_initiated_*` ETW session 运行，未生成 ETL、未运行跟踪测试、未取消未知会话。专用临时目录残留两个非 ETL 状态文件，删除调用被工具策略拒绝。需确认冲突 session 并安全处理后再采集。Task 8B entry 284716 B、budget 5/5；AppShell test-only follow-up focused 10/10，Node/Web typecheck 通过，独立 review APPROVED。当前 Electron E2E、DPI/IME/读屏人工验收与 Task 8 最终复审仍待办。Task 8 未完成。详见 [HANDOFF-CURRENT.md](../HANDOFF-CURRENT.md)。

发布进展（2026-09-26）：Gitee Release `v0.17.0` 已发布（ID `1168823`，`2026-09-26T15:13:45Z`），公开页 HTTP 200，tag 与 prerelease 状态正确，正文与本地发行说明一致；未上传安装包。Gitee API 返回 `v0.17.0.zip`、`v0.17.0.tar.gz` 两份自动源码归档。GitHub Release 同样已发布，Windows 安装包 API SHA-256 与本地一致。发布状态核对时 GitHub/Gitee `main` 均为 `14c82294f1cad702ccd4b68d671b35fcefa62b81`；两端 tag object 为 `12941bdcf036aa9ff566fa236a01c8d307ea915b`，peeled commit 为 `403fcb174667743f2979ba55b9d29b5ef35ce4f4`。发布账本与跨文档状态已纳入本次同步。

历史状态快照（2026-09-26，后续 Step8/9 状态见下文）：步骤 1–7 已完成双阶段审查；Step7 retry 状态 P2 已由 `6c72de0c558e9f9c107eaf14fa54650af83df236` 按 TDD 修复。父级独立验证：定向偏好+无障碍 21/21、typecheck、全量 35 files / 345 tests、build（renderer 7,154 模块）、diff-check 均通过；规格与质量/安全复审 Ready: Yes。Electron 设置 UI 人工验收待后续用户侧完成。Step8 实现提交 `10269efe3a8ba62863a5bce884159665f9781ec6`，定向 82/82、38 files / 373 tests、typecheck、build 均通过。慢 bootstrap/UNC Minor 与 macOS 范围外 P3 仍按前文记录。分支未合入、未推送。

最新进展（2026-09-26）：上方早期摘要之后，Step8 的独立复审已发现 MEDIUM Off-mode 异步泄漏竞态，已重开 MuyaNoteEditor/muya-config/集成测试三文件精确边界修复；Step9 提交 `4875a7a867a8f3c05c0dbc6de7c06015e127fe3a` 且真实本机 SANDBOX smoke 通过，完整 build/build:win 与安装包体积/资源核验仍待协调者执行。当前分支未合入、未推送。

最新更正（2026-09-26）：Step8 首个竞态修复提交 `48dd5ce0443a66d59eda55880f2a2c2912d986ab`，TDD 新增 4 个 RED 用例；focused 35/35、typecheck、全量 39 files / 383 tests、build 通过。但独立复审 Ready: No：源码 preload 与 Vite 预优化 `@muyajs/core` 内的运行时 loader 是两份缓存实例，真实 Muya 路径尚可能向旧 endpoint 发送源码；现重开 `electron.vite.config.ts` 加三个 Muya 文件的精确边界修复。Step6 shutdown API 针对性复核已完成，无代码改动，定向 29/29 与 typecheck 通过。Step9 smoke 安全门禁的失败语义断言和 finally 清理正在补强。完整 build:win/安装包验收仍未运行。

再更新（2026-09-26）：Step9 smoke 加固已提交 `567c9c878ef4b6730e55431dceb2494324629405`；新增用例先 RED，定向 2 files / 12 tests、`node --check`、真实 bundled-runtime offline smoke、diff-check 均通过。独立复审确认 include 拒绝断言无 false-pass，但 Ready: No：cleanup 错误可覆盖原 smoke 断言失败，CLI 会隐藏 AggregateError.errors。现重开同两文件边界保留原始与 cleanup 错误；未运行 build/build:win。

Step8 子任务状态更新（2026-09-26）：用户已选择仅开发测试用 `happy-dom`。实现代理 `/root/plantuml_step8_renderer_impl` 获得以下所有权：`package.json`、`package-lock.json`（只新增 happy-dom 开发依赖）、`electron.vite.config.ts`、`MuyaNoteEditor.tsx`、`muya-config.ts`、`test/muya-note-integration.spec.tsx`。目标是挂载真实 React/Muya 编辑器，测试真实 loader 实例并验证切 Off/error/换端口时旧 endpoint 不会收到注释源码；不得修改 `vendor/muya` 或指纹。若需扩展文件，实施前先回报协调者、更新 HANDOFF 并登记边界。

用户同时批准重新复核 Step6 的退出服务 API。针对性审查确认现有 shutdown 强制升级、退出确认和 fail-closed quit gate 满足要求；无代码改动。`plantuml-service`/`startup-coordinator` 定向测试 29/29 与 typecheck 通过，服务文件边界已释放。

Step9 独立质量审查未发现生产打包代码安全漏洞，但发现 runtime smoke 拒绝判定与异常清理两处可靠性缺口。该轮将 `scripts/test-plantuml-runtime.mjs`、`test/plantuml-runtime-security.spec.ts` 登记给 `/root/plantuml_step9_packaging_impl` 补回归；当前状态见下方更新。

当前状态（2026-09-26）：Step8 首个 preload race 修复的独立复审 Ready: No，确认 vendor 源 preload 与 Vite optimizeDeps 中 Muya 实际加载的 renderer cache 并非同一实例。用户已选择 happy-dom（仅开发测试依赖），实施代理 `/root/plantuml_step8_renderer_impl` 正在精确登记的 renderer/editor/test 边界实施真实生命周期回归；不得触碰 vendor/muya。Step9 第二轮诊断修复已提交 `d1fb4a4c99ba5bb5de0c911538e1733124d280c6`，范围只有 runtime smoke runner 与 security spec；实施方报告定向 2 files / 13 tests、`node --check`、真实 bundled-runtime smoke、清理与 diff-check 通过。独立复审 Ready: Yes，额外实跑 focused security spec 9/9、Node 语法、真实 runtime smoke、两文件 diff-check。非阻断注意项：人工自引用 AggregateError 可能递归过深但无生产可达路径证据；原生文件错误消息可能含本机临时路径，外传诊断日志时需脱敏。协调者实跑 `npm run typecheck` 通过、`npm run test` 39 files / 387 tests passed；`npm run build`、`npm run build:win` 与安装包资源/体积/SHA 核验尚未执行。完成 Step8 并复审后再串行打包；分支仍未合入/推送/发布。

Step8 验证边界补充（2026-09-26）：现已将 `vitest.config.ts` 登记给 `/root/plantuml_step8_renderer_impl`，范围仅为启用 Vitest client optimizer 并 include `@muyajs/core`，以重现 Electron renderer 的真实优化/源码双 loader。happy-dom 用例需挂载真实 editor/runtime，不 mock loader。SSR optimizer 因 Prism `import.meta.glob` 语言表缺失而停止，不作为有效 RED。

Step8 测试夹具补充（2026-09-26）：另允许同一实现者在 `vitest.config.ts` 增加测试专用 client esbuild alias，将 `plantuml-encoder` 指向其包内 `browser-index.js`（与已检查的 Electron Vite 优化产物相同入口），并对精确 PlantUML renderer 源模块注入异步 gate。不得改 `vendor/muya`、运行依赖或生产构建配置；真实 happy-dom editor/runtime 回归不 mock loader/preloader。client optimizer 已精确映射该浏览器入口，且确认 gate 注入真实 PlantUML renderer 模块前；允许测试插件仅 stub Node/happy-dom 不支持的 CSS/图片/字体静态导入，不能拦截 JS/TS、renderer/chunk 或网络图像请求。helper 过滤用例通过，但目标生命周期 RED 尚未完成，生产代码尚未修改。此前 browser-deflate/pako optimizer 启动失败、绝对路径资源加载失败及 SSR/Prism 尝试均不是有效 RED。

## 更新规则

1. 开工前：更新计划状态、任务复选框、执行者和文件边界，再更新 `HANDOFF-CURRENT.md`。
2. 每个提交后：勾选真实完成的步骤，写入提交 hash 和实际测试结果。
3. 暂停时：写清下一步、等待什么、还差什么；禁止只写“进行中”。
4. 完成时：同步更新 Markdown、`plan.json`、本索引和 `HANDOFF-CURRENT.md`。
5. 不得把设计、Demo、代码实现和验证混为同一状态。
