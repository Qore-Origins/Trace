# Task 8：早期 Browser CDP 自动附着实施计划

For agentic workers: REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` if the user chooses subagent-driven execution; use `superpowers:executing-plans` if the user chooses inline execution. Before touching code, follow the Task 8 ownership and HANDOFF protocol.

## Goal

让隔离 Electron QA runner 在 Trace 首个顶层 renderer 脚本执行前完成 Browser CDP 连接和 page-only 自动附着；每个 page 都先启用 renderer 异常监测再恢复执行。异常监测与页面自动化统一使用一个 flattened Browser WebSocket，使主界面、外部审批窗、主进程确认窗从首段脚本到销毁都纳入异常计数。

本计划只改变 QA runner/bootstrap，不改变 Trace 产品行为。完成本子计划不等于 Task 8 总体验收完成，也不等于 D3 通过。

### 当前诊断交接入口（2026-10-09 02:48 +08:00）

用户已将当前 Task 1 CDP 阻塞交由另一位智能体继续。接手者应先阅读[Task 1 CDP 阻塞诊断交接与执行工作流](Task1-CDP-Diagnostic-Handoff-Workflow-2026-10-09.md)：最近导航差分在 Browser WebSocket 建立前失败，未进入 page attach 或导航干预，具体失败阶段未知。前一次单次运行授权已用尽；该工作流不授权重复运行。Task 1 仍是后续步骤的硬前置。

### Task 1 单目标 Browser CDP 诊断 — 用户同意 2026-10-08 23:19 +08:00；运行结果 23:40 +08:00；资料核查完成 23:51 +08:00

上轮真实 Electron 44.2.0 smoke 在四个 flattened page session 上均观察到首个 `Runtime.enable` 无响应，Browser WebSocket 仍 OPEN，根因未知。用户已同意另做一个只诊断、不修复的单目标 probe，区分 Browser 级 CDP command 与单一 flattened page session command 的响应状态。

- **精确文件所有权：** 原实施代理 `/root/cdp_fd_smoke` 未落盘文件并已停止；唯一代码 owner 改为 `/root`，仅新增隔离 worktree 文件 `scripts/trace-phase2-cdp-single-target-diagnostic.cjs`。`/root` 同时维护 HANDOFF、共享计划索引、Task 8 状态、本文与 `plan.json`。不得改既有 CDP smoke、FD 兼容 probe、正式 runner/bootstrap、产品、测试、package scripts 或历史 fixture。
- **诊断流程：** 单个 synthetic hidden page；连接该隔离 Electron 的 loopback Browser WebSocket；先确认 `Target.setAutoAttach` page-only paused 配置；用已有 FD3/FD4 gate 放行创建页面；attach 后把 `Runtime.enable` 作为该 flattened session 的第一个 page 命令；等待其 pending 期间发 Browser 级 `Browser.getVersion` 并记录是否响应。只收集方法名、响应/协议错误/超时阶段及 elapsed time、target type/paused、粗粒度 URL category、`Runtime.executionContextCreated` 计数和 socket 状态。原始 endpoint/URL、target/session ID、页面正文、凭据及完整异常栈不得落盘。
- **严格不做：** 不发送第二个 page-domain 命令、不恢复 paused page、不改变协议/正式 smoke 行为、不使用 stdin/TCP/named pipe/晚 attach fallback、不访问真实库/provider、不重跑既有 CDP smoke。
- **唯一运行条件：** `node --check`、目标差异与脱敏审查、独立 Spec/Standards 静态复核就绪；管理员 shell 对隔离 worktree Electron executable 的精确进程数实测为 0。随后只运行该新 probe 一次并保留其唯一 owner-marked fixture；失败核验进程归零后停止，不重试。
- **实现与静态复核：** `/root` 已只新增上述脚本，SHA-256 `DFFBF0A26708B9BEDFA5F45118F01AB807D4ADD9EA1675243245E1619AA6BA0C`；`node --check` exit 0，尾随空白行 0。Spec 与 Standards/Security 独立只读审查均 Ready，无阻断项。非阻断边界：owner marker 仅在本地 fixture 保存绝对路径/PID/创建时间；进程匹配未绑定祖先链；fixture 初始化早期失败可能留部分目录。原始路径、URL、endpoint、target/session ID、nonce 不进入诊断报告或控制台。
- **唯一运行结果：** 管理员身份确认，运行前/后精确匹配 worktree Electron executable 进程数均为 0。`node scripts/trace-phase2-cdp-single-target-diagnostic.cjs` exit 0（约 9.5 秒）；page target `waitingForDebugger=true`，`Runtime.enable` 在 6001 ms 超时；同一 Browser WebSocket 的 Browser 级 `Browser.getVersion` 在 20 ms 成功。socket 仍 OPEN，`Runtime.executionContextCreated=0`，URL 类别 `missing`；Electron exit 0、stdio closed、FD3 EOF。fixture `trace-cdp-single-target-diagnostic-sDhrdy` 按授权保留，报告隐私扫描通过。该证据将现象收窄到 page flattened command 路径，但根因仍未知；probe 本身不是 Task 1 通过。
- **只读对照与当前状态：** 新旧 smoke 使用相同 flattened 命令 envelope（顶层 `sessionId`）与 page-only paused auto-attach 参数；单页复现说明多页并发不是必要条件。官方规范与 issue 未解释当前无响应；Electron 文档关于 pre-navigation `webContents.debugger.sendCommand()` 可能等到导航才完成、且本 probe 的 hidden BrowserWindow 未调用 `loadURL()`，构成一个值得验证但未证实的时序假设。两者使用的 transport、命令类型和版本不同，不能据此归因。详见 [官方资料调查](../../../../../research/2026-10-08-electron-flat-cdp-runtime-enable-hang.md)。实现、独立 Spec/Standards 静态复核及一手资料调查完成；唯一运行授权已用尽，不重跑、不扩展协议或修改旧 smoke。Task 1 硬门槛仍未通过；Task 2+ 与 D3 保持停止。

### Task 1 navigation timing differential — user approved 2026-10-09 00:18 +08:00; unique run 00:56 +08:00 (inconclusive before intervention)

The previous single-target diagnostic remains immutable and its one-run authorization is exhausted. This new isolated one-variable differential also had a one-run limit, which is now exhausted:

- **Control baseline:** the recorded 2026-10-08 single-target observation, where the paused synthetic page received no explicit `loadURL()` call and `Runtime.enable` timed out.
- **Planned treatment:** reproduce the same Electron 44.2.0 fixture, FD3/FD4 gate, Browser WebSocket, page-only paused auto-attach, and first flattened page command. Once the one page target is attached and `Runtime.enable` is confirmed pending, send one FD4 `navigate` control; the fixture main process calls `loadURL('about:blank')` once on that same BrowserWindow.
- **Allowed boundary:** only the explicit local `about:blank` navigation request after the pending command. Do not change transport, CDP command order/parameters, auto-attach configuration, timeouts, paused-target state, or add pages. Do not resume the target, use network, access Trace data, or run any existing probe/smoke.
- **Code ownership and review:** `/root` added only `scripts/trace-phase2-cdp-navigation-timing-diagnostic.cjs` in isolated worktree `codex/task8-cdp-auto-attach`; SHA-256 `DE5B7B2FB448C90547723593C4B895CB9F9A18183A008F18D7B951ECFA218D5B`. Review baseline was exact worktree HEAD `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`; main checkout HEAD was `7ced10c1371004e53452074ef812747c6493b710` (ahead origin/main by 1). Independent Spec and Standards/Security reviews are Ready with zero unresolved blockers. Existing smoke, inherited-FD probe, prior single-target probe, product, tests, runner/bootstrap, package scripts, and all old fixtures were preserved.
- **Static verification:** outer script `node --check`, generated fixture `vm.Script`, both embedded PowerShell command AST checks, trailing whitespace, >180-character line scan, and pre-run `git diff --check` passed. Pre-run administrator identity was True and exact isolated Electron executable process count was 0.
- **Unique actual run:** `node scripts/trace-phase2-cdp-navigation-timing-diagnostic.cjs` exited 1 and reported `category=runtime`. Retained diagnostic says `observation=null`, Browser WebSocket `not-connected`, and page attach count 0. It recorded fixture `isolation-ready` followed by cleanup `exit`; the navigation control was never sent and the planned treatment did not happen. Electron itself exited 0, stdio closed, FD3 reached EOF; after-run exact Electron process count was 0. Owner marker kind and exact fixture root were checked for the sole new fixture `trace-cdp-navigation-timing-diagnostic-PBO9GQ`, which is retained. Raw stderr was not captured; only its 100-byte count remains. Therefore the precise failing operation is unknown, and this run offers no evidence for or against the navigation timing hypothesis.
- **Stop condition:** do not rerun this diagnostic, reuse or remove its fixture, or claim Task 1 passed. Any further Electron run requires a separately specified and authorized diagnostic that records a bounded failure-stage category. Task 1's Browser CDP gate, Task 2+, D3, and Task 8's native keyboard/IME/DPI/narrow-window/screen-reader acceptance remain incomplete.

### Task 1 transport revision — 2026-10-08 20:20 +08:00

用户已批准将 Task 1 独立 CDP smoke 的 pre-main 通道改为继承匿名管道：child FD 3 → parent 事件，parent → child FD 4 控制；stdin 不再参与协议，stdout/stderr 仅用于诊断。Electron 使用 `stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']`，parent 通过 `child.stdio[3]` 读取事件、`child.stdio[4]` 写控制。协议为带 nonce、类型字段的 UTF-8 JSONL，最大帧 4096 字节。

Smoke fixture 通过隔离检查后，以 FD 3 发送 `isolation-ready`，然后异步等待 FD 4 上的控制，同时让 Electron 主事件循环和 `app.whenReady()` 正常推进；不得同步阻塞读取 FD 4。parent 等待 `DevToolsActivePort`、校验 loopback Browser endpoint、建立 Browser WebSocket 并成功安装 page-only auto-attach 后才发送首个合法 `continue`。错误 nonce、畸形/超长帧、未知类型、FD 缺失/EOF、超时、CDP 失败均 fail closed，不载入 page fixture；成功 `continue` 后重复输入使本轮失败，但不承诺撤销首次放行。不得 fallback 到 stdin、TCP、named pipe 或晚 attach。

此前 `scripts/trace-phase2-inherited-fd-smoke.cjs` 的五个 app-mode 场景通过，只证明 Electron 44.2.0 可使用 FD 3/4；不等于本 CDP smoke 或 Task 1 通过。Task 1 实现只允许在隔离 worktree 修改已跟踪的 `scripts/trace-phase2-cdp-auto-attach-smoke.cjs`；正式 runner/bootstrap、产品、测试、package scripts、D3 均不在本步范围。失败场景创建的 fixture 保留，不触碰此前留存目录；只有本轮通过后才能按 owner-marker 守卫清理本轮 fixture。

### Task 1 失败现场诊断复测 — 用户授权 2026-10-08 22:58 +08:00

首次完整 Browser CDP smoke 的 `protocol` 场景超时。用户已授权只读核验该轮精确 owner-marked fixture；核验结果是 FD 3/4 方向和 stream 状态正常、Browser endpoint/WebSocket 连接及 `Target.setAutoAttach` acknowledgement 成功、收到 continue 且生成四个 page fixture，但没有记录到 `Runtime.exceptionThrown`。当时诊断没有保存 Target/session 事件序列、pending CDP 方法或每个 page 的初始化进度，无法定位到 attach、Runtime.enable、resume 或事件分发哪一阶段。iframe `localhost` 连接拒绝的日志晚于 teardown 开始，未认定为主因。

用户进一步授权本批只在隔离 worktree 的上述 smoke 文件增补有界脱敏诊断，并进行一次完整 CDP smoke。精确所有权 `/root`；原 owner `/root/cdp_fd_smoke` 已释放。诊断记录 CDP 命令方法及成功/协议错误/超时、Target 事件类型和 paused 状态、page 初始化阶段、归一化 role、异常与继续事件、timeout 时 session/待处理命令摘要，所有时间相对 fixture 起点。禁止保存 URL/endpoint、targetId、sessionId、页面正文、原始异常正文/完整栈；设置事件数量与文件大小上限。保留既有 transport、timeout、功能断言及 fail-closed 语义；不改 iframe URL、不改正式 runner/bootstrap、不改兼容探针、不回退或清理旧 fixture。

复测前先执行 `node --check`、增量 diff/敏感字段审查与隔离 Electron executable 精确进程数预检。仅当预检为 0 才运行一次 `node scripts/trace-phase2-cdp-auto-attach-smoke.cjs`。失败则保留本轮 fixture/日志、检查本 worktree executable 无遗留 Electron 后停止，不重跑；通过则记录全套场景真实结果，不据此宣称 Task 8 完成。Task 2+ 与 D3 仍需各自前置条件/授权。

**历史检查点（2026-10-08 23:03，复测前）：** 诊断增量已在唯一登记文件中实现，最多保留 128 条受限 trace，timeout 先冻结 session/command 状态再清理；新增字段未包含 URL、endpoint、session/target ID 或异常正文。`node --check` exit 0，目标 `git diff --check` 无错误，隔离 worktree tracked diff 仅目标脚本；`plan.json` 可解析且 ID 唯一。Electron 复测尚未启动。

### Task 1 诊断增量唯一完整 smoke 结果 — 2026-10-08 23:08 +08:00

- 执行前管理员 shell 按隔离 worktree 的 Electron executable 精确查询为 0 个进程；`node scripts/trace-phase2-cdp-auto-attach-smoke.cjs` 整体 exit 1，第一个 `protocol` 场景等待首批异常/继续超时，后续 fail-closed 场景没有运行。运行后精确匹配的 Electron 遗留进程数为 0。
- 证据顺序：FD 3/4 通道形状正常 → Browser WebSocket 打开 → `Target.setAutoAttach` response 成功 → runner 发出 continue → 收到 4 个 `Target.attachedToTarget` page target，均 `waitingForDebugger=true` → 4 个 page session 各发出 `Runtime.enable` → 超时 snapshot 中 4 个均 pending 且无任何命令 response。四个 session 均停在 `runtime-enable`，未进入 `Page.enable`、`Page.addScriptToEvaluateOnNewDocument` 或 `Runtime.runIfWaitingForDebugger`；`Runtime.exceptionThrown=0`，Browser WebSocket 为 OPEN，client failure 未置位。子进程在清理后 exit 0、stdio closed，runner 因场景超时整体失败。
- 新 owner-marked fixture `trace-cdp-auto-attach-smoke-HwhH2j` 保留，旧 fixture `trace-cdp-auto-attach-smoke-wDk01l` 也保留；未覆盖、复用或清理。归一化 target role 全为 unknown；诊断未记录 URL，因此不推断目标实际 URL。
- 结论：故障点已从“没有首个 renderer 异常”收窄为 page session 首个 `Runtime.enable` 无响应，但具体原因未知。官方 CDP 资料定义 flattened session 通过 envelope `sessionId` 选择会话，暂停 target 由 `Runtime.runIfWaitingForDebugger` 恢复；这些契约不解释本次无 `Runtime.enable` 响应。此轮 stderr 未重现旧 fixture teardown 后的 iframe localhost 连接拒绝线索。
- 本轮授权仅覆盖上述一次完整 smoke，失败后停止；不重跑、不改协议/正式 runner/bootstrap/产品、不 fallback、不清理现场。诊断代码仅在隔离 smoke 脚本；`node --check` exit 0、目标 `git diff --check` 无错误。Task 1 硬门槛仍未通过，Task 2+、D3 保持停止。
- 下一步如需继续，先另行定义并授权一个新的最小诊断方案；Task 8 仍未完成，人工键鼠/IME/DPI/窄窗口/读屏验收与最终交接待办。

### Task 1 隔离 follow-up：timeout 生命周期扩展结果（2026-10-08 19:42 +08:00）

用户已授权本轮精确实验：只在 `runTimeoutScenario()` 确认 `control-timeout` rejection 后、`awaitExit()` 前关闭父端 FD4。实现者只增加一行；隔离 HEAD `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`，脚本 SHA-256 `E831F71B3A911F7CA086058F91A937F3D1BDFE134CB71BA7C0966C3489FF913C`。协调者静态检查、Spec/Standards 复审均通过。执行前精确 Electron executable 进程数 0；唯一完整运行 `node scripts/trace-phase2-inherited-fd-smoke.cjs` exit 0 / 4.184 秒。五场景均 PASS：fragmented-continue(exit 0)、duplicate-continue(exit 23)、wrong-nonce(exit 23)、control-eof(exit 23)、control-timeout(exit 23)，stdio 均 closed=true；脚本成功清理本轮 fixtures，运行后进程数 0。

本次成功运行支持 harness 之前因父端 FD4 保持打开而污染 timeout 退出等待的假设：修改后 control-timeout 在原 15 秒观察上限内通过。但 stdout 只包含 duplicate 场景时序，没有 timeout parent/reader end/close 的精确时间；成功清理也移除了本轮诊断文件，因此不将此单次结果表述为事件级因果证明。该 follow-up 授权已耗尽，不再重复运行或扩充诊断。FD 3/4 app-mode probe 通过不等于原 Browser CDP Task 1 通过；Task 1 硬门槛和 Task 8 总体验收仍未完成。

### Task 1 隔离 follow-up 上一轮结果（2026-10-08 19:32 +08:00）

该 follow-up 按用户授权实施，精确增量的 Spec 与 Standards 独立复审 Ready。duplicate rejection reason 断言后、`awaitExit()` 前关闭父端 FD4，新增 parent end-call/finish、child reader end/close 的 fixture-relative 毫秒诊断；15 秒上限、全部原断言、失败 fixture 保留策略、既有 app-exit 诊断均保持。隔离 HEAD `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`，脚本 SHA-256 `9CC41432DD00642E406518DBA09A37F73DD61E521A33D9A4D54BA89435420D37`。

唯一完整运行 `node scripts/trace-phase2-inherited-fd-smoke.cjs` exit 1。fragmented、duplicate、wrong-nonce、control-eof 四场景通过；control-timeout 等待 Electron exit/stdio close 超时。Duplicate rejection +573 ms，父端 end-call/finish +602 ms，进程 exit/close +723 ms，单次 release/action 断言通过；child reader end/close 未观察到。Timeout rejection/app.exit +1,913 ms，父端流直到 awaitExit 超时后 cleanup 才 finish +16,965 ms，进程 exit/close +17,080 ms，未调用 kill。时序支持但未证明 FD4 生命周期假设。五个本轮 fixture 均保留，匹配 Electron executable 进程数 0。此次授权已用尽：不得重跑、扩展 timeout 场景修复、换 transport 或清理现场，除非用户另行批准。本 follow-up 不改变 Task 1/Task 8 完成状态。

上轮结束后原本提议的 timeout 生命周期跟进现已获得用户授权，执行边界见本节顶部。即使最多一次完整 FD 3/4 smoke 通过，也不能替代 Browser CDP Task 1 硬门槛；Task 2+、D3 和 Task 8 最终人工验收/交接仍未完成。

## Architecture

1. 先用仓库配套 Electron 44.2.0 做独立协议 smoke，验证 Browser `/json/version`、Browser WebSocket、`Target.setAutoAttach` 的 page-only filter、暂停/恢复时序、异常首脚本及负向 target。Smoke 不依赖 Trace 正式 runner 的新实现。
2. 将 bootstrap 的 pre-main 等待抽成纯 Node helper：隔离检查通过后发送本轮 nonce-bound `isolation-ready`，main bundle 只能在收到首个匹配且一次性的 `continue` 后加载；释放前的非法输入、EOF、超时均 fail closed。首个合法 `continue` 被接受后不可撤销；之后到达的重复控制消息使 QA run 失败但不得第二次释放，不要求也不得声称能回滚第一次放行已启动的页面。
3. 增加 Browser CDP session manager：单 socket 路由 command id 和 flattened `sessionId`，非阻塞初始化每个 page，先注册 Runtime 事件接收并执行 `Runtime.enable`，再执行 `Runtime.runIfWaitingForDebugger`。未知 page 仍计数为 `unknown-page`；非 page 自动附着或协议异常导致本轮失败。
4. runner 启动 Electron 后等待隔离握手，读取本轮 `DevToolsActivePort` 并严格校验 loopback `/json/version` endpoint，装好 auto-attach 后才 nonce 放行。主界面、审批窗、确认窗的现有 CDP 自动化改走对应 page session；窗口关闭改等待该 session detach，不再以 `/json/list` 轮询后另开 target WebSocket。
5. 在真实 Electron smoke、focused regression、全量测试、typecheck、build 与独立复审完成后，更新 Task 8 状态并请求用户是否授权一次 D3-only 验收。D3 不包含在本计划的自动执行授权内。

## Tech Stack

- Node.js CommonJS QA scripts
- 仓库 Electron 44.2.0 与 Chromium DevTools Protocol
- Vitest 5（Node 环境）
- PowerShell 7（`pwsh`）

## Global Constraints

- 代码实施前先更新并检查 `docs/HANDOFF-CURRENT.md`，核对 `git status --short --branch` 和真实 HEAD，并登记精确文件所有权；当前 dirty/untracked 文件全部视为既有改动，不覆盖、不回退、不顺手清理。
- 先通过协议 smoke，才可改 bootstrap / runner；若 Browser endpoint、filter、flattened session 或首脚本异常捕获任一项失败，停止并修订设计，不使用晚 attach、第二套 WebSocket 或放宽 filter 作为降级。
- 目标仅限 Trace 顶层 page：主界面、外部审批窗、主进程确认窗。iframe、Worker、Service Worker 和其他非 page target 不在覆盖范围；若运行时 filter 仍附着非 page，验收失败。
- 每个 page 的顺序必须是：接收并登记 attach 事件 → 注册异常路由 → `Runtime.enable` → `Runtime.runIfWaitingForDebugger`。任何未能确认初始化的暂停 page 都不能静默略过。
- CDP 只连接本轮隔离 Electron 的 `127.0.0.1` 调试端口；不读取用户计划库、不启动真实 provider、不使用真实凭据或外部网络。
- Temp fixture 必须由本轮唯一 owner marker 识别。失败现场按既有 runner 规则保留；成功后仅在进程完全退出且路径/marker 校验一致时清理本轮目录。
- nonce gate 立即接受首个匹配的 `continue` 并且只释放一次。错误 nonce、损坏消息或首次合法放行前的重复输入必须 fail closed 且不创建页面；首次合法放行之后的重复消息必须作为协议故障使 smoke/run 失败，但首次放行和已启动页面不可撤销，不得加入任意 grace period 来声称 late duplicate 保证零页面。
- Task 1 pre-main gate 仅使用继承匿名管道 FD 3/FD 4；stdin 不用作协议，stdout/stderr 不解析为协议。Electron event loop 必须保持运行；不得使用同步控制读取。
- FD 不可用或协议初始化失败即停止；不自动 fallback 到 stdin、TCP、named pipe 或晚 attach。
- 不改产品 UI、main/preload IPC 合约、D3 交互断言、8A 文件系统行为、版本、发布、安装包或远端仓库。
- 所有 renderer exception 均计数；不得按异常文本豁免。日志遵循已有脱敏边界，不输出计划正文、真实密钥、原始完整异常栈或未经脱敏的本机绝对路径。

---

## 实施步骤

### Task 1 — 建立 Electron 44.2.0 独立协议 smoke（后续实现的硬前置）

**文件所有权：** 新增 `scripts/trace-phase2-cdp-auto-attach-smoke.cjs`。本步不改现有 runner、bootstrap 或产品文件。

**实现：**

1. 从当前隔离 worktree 的 `node_modules/electron/dist/electron.exe` 派生 Electron 二进制，确认其版本精确为 `44.2.0`；任何版本不符都停止，不拿系统 Electron 替代。
2. smoke 脚本创建唯一 owner-marked Temp root，生成本轮最小 Electron main/HTML fixture，配置独立 userData/sessionData，以 `stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']` 启动 Electron；child FD 3 写事件、child FD 4 异步读控制。stdin 不参与握手，stdout/stderr 只收集诊断。fixture 的 FD gate 不得阻塞主事件循环。
3. 隔离校验通过后，fixture 以 FD 3 发送带 nonce 的 `isolation-ready`。parent 等待本轮 `DevToolsActivePort`，确认 Electron `app.whenReady()` / Browser endpoint 可用，严格校验 `/json/version` 返回 Browser WebSocket 为 loopback 且端口匹配，再连接 Browser WebSocket。
4. runner 按批准规格原样提交 `Target.setAutoAttach` page allowlist、`flatten: true`、`waitForDebuggerOnStart: true`。只有 auto-attach 成功后才通过 FD 4 发送唯一首个合法 `continue`，fixture 才创建 main、approval、confirmation 和 unknown 四个顶层 page。
5. 每个 page 首段脚本同步抛错，后续脚本写入可验证标记。Smoke 必须证明异常事件在放行后进入相应 session/总计，且继续脚本只在初始化完成后执行；unknown page 仍进入总计。
6. fixture 同时创建 iframe 与 Worker 负向控制，断言没有为其产生目标 page session；如果 Electron 把它们以非 page target 交给 runner，严格过滤后不得初始化成 page，若出现非 page attach 则 smoke 明确失败。
7. 覆盖错 nonce/坏帧/超时/EOF 等 gate 拒绝、重复放行、endpoint 非 loopback/端口不符、协议拒绝和 Electron 退出路径；每个场景有界结束。首次合法放行后的重复 continue 必须使 smoke 失败并保持唯一 release，但不要求回滚已启动页面。不得误删 Temp，失败现场保留以便审查。

**验证命令：**

```powershell
node --check scripts/trace-phase2-cdp-auto-attach-smoke.cjs
node scripts/trace-phase2-cdp-auto-attach-smoke.cjs
```

**退出门槛：** smoke 输出 PASS，精确证明 Electron 44.2.0 的协议参数、paused attach、首脚本异常事件和 page-only 过滤。若失败，停止 Task 2 之后的实现，记录实测协议差异并更新规格；不得通过改成晚 attach 来通过。

### Task 2 — 实现可测的 pre-main nonce gate

**文件所有权：** 新增 `scripts/trace-phase2-qa-pre-main-gate.cjs`、`test/trace-phase2-qa-pre-main-gate.spec.ts`。本步不修改 bootstrap/runner。

**模块接口：** 导出 `waitForContinue({ nonce, controlInput, eventOutput, timeoutMs, onProtocolViolation })`。函数以 `eventOutput` 发送带 nonce 的 JSONL `isolation-ready`，从异步 `controlInput` 读取首个匹配的 `continue`；验证 nonce 为非空字符串、帧 UTF-8 大小不超过 4096 字节，成功只放行/resolve 一次。格式损坏、nonce 错误、重复 ready/continue、control EOF、runner 退出和超时均 reject，并清理 listener/timer。首次成功 resolve 后仍把后续控制消息/EOF 作为 run-level protocol violation 交给调用方，不能再次 resolve/放行；run 失败不能回滚已由第一次合法放行启动的页面。同步 `readSync` 不可用于 gate。

**回归覆盖：**

- 匹配 nonce 的第一个 continue 立即成功并仅放行一次。
- 错 nonce、畸形 JSON、未知消息类型或首次合法 continue 前的重复输入均不能 resolve。
- 首次合法 continue 后再发送重复 continue，调用方收到 protocol violation，gate 不再次 resolve/放行；该情况下第一次合法放行产生的页面不要求回滚。
- control FD EOF、超时可结束且清理监听器与计时器；缺失或方向错误的继承 FD fail closed。
- 错误分支不向调用方返回可被误当作成功的值。

**验证命令：**

```powershell
node --check scripts/trace-phase2-qa-pre-main-gate.cjs
npx vitest run test/trace-phase2-qa-pre-main-gate.spec.ts --pool=threads --maxWorkers=1
```

### Task 3 — 实现单 Browser WebSocket flattened session manager

**文件所有权：** 新增 `scripts/browser-cdp-auto-attach.cjs`、`test/browser-cdp-auto-attach.spec.ts`。不改现有 runner/bootstrap。

**模块接口：** 提供 `BrowserCdpAutoAttach`，用可注入 WebSocket factory 构造；对外提供 `connect(browserWebSocketUrl)`、`installPageAutoAttach()`、`waitForPage(predicate, timeoutMs)`、page session 的 `send(method, params)` / `evaluate(expression)`、`waitForDetach(targetId, timeoutMs)` 和 `close()`。命令对象仅在存在 page session 时包含对应 `sessionId`；Browser 命令不带 session id。

**实现约束：**

1. command id 与 pending response 独立路由；response 按 id resolve/reject，事件按 `sessionId` 分派。某一 target 初始化失败不得阻塞同 socket 其他 target 的事件处理。
2. 对 `Target.attachedToTarget` 校验 `type === 'page'` 和 `waitingForDebugger === true`；未知页角色分类为 `unknown-page`。非 page 或状态不符立即标记 manager 为失败，进行有界 best-effort resume，最终由调用方停止隔离进程。
3. attach 事件到达时先建立 session 与异常事件处理器，再 `Runtime.enable`，最后 `Runtime.runIfWaitingForDebugger`。这三步的调用次序必须可由 fake socket 直接断言。
4. `Runtime.exceptionThrown` 经现有 `RendererExceptionMonitor.recordProtocolEvent` 聚合；错误详情沿用现有脱敏策略。`Target.detachedFromTarget` 删除 session、解决 detach waiter 并阻止后续命令复用已 detach 的 id。
5. Browser socket close/error 时拒绝所有 pending command/waiter；每个 timeout 和 listener 都有清理路径。

**回归覆盖：**

- 精确 auto-attach 参数与 page-only filter 顺序。
- 多 session 命令结果及事件交错时不串线。
- attach → Runtime.enable → resume 次序；异常在恢复后进入对应角色和总计。
- unknown page 计数、非 page attach fail-closed、detach 清理、socket close 拒绝 pending、timeout 清理。

**验证命令：**

```powershell
node --check scripts/browser-cdp-auto-attach.cjs
npx vitest run test/browser-cdp-auto-attach.spec.ts test/renderer-exception-monitor.spec.ts --pool=threads --maxWorkers=1
```

### Task 4 — 将 gate 与 Browser session manager 接入隔离 runner

**文件所有权：** 仅修改 `scripts/trace-phase2-isolated-electron-bootstrap.cjs`、`scripts/trace-phase2-isolated-electron-runner.cjs`。两个文件作为一个原子集成边界；此步开始前须确认 Task 2/3 已完成并释放所有权。

**Bootstrap 改动：** 保留现有 run root、profile、config、disposable library 与生产 bundle 检查；全部通过后读取本轮随机 `TRACE_PHASE2_QA_NONCE`，调用 gate 发 ready 并等待 continue；只有 gate 成功后才 `require(mainBundlePath)`。不得移动或省略任何既有隔离检查。

**Runner 改动：**

1. Electron spawn 使用 `stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']`；FD 3 只承载 child→parent 事件，FD 4 只承载 parent→child 控制。收到结构完整且 nonce 匹配的 isolation-ready 后，读取 `DevToolsActivePort`、请求 `/json/version` 并校验 `ws:`、loopback host 与调试端口一致，再连 Browser WebSocket；stdin 不参与协议，stdout/stderr 不作协议解析。
2. 成功安装 page-only auto-attach 后发送一次匹配 nonce 的 continue；随后以 session manager 等待 main page，不再靠 sentinel 出现就认为 main bundle 已安全放行。
3. 把现有 `CdpClient` 的 main、approval、confirmation 三个实例改为 session manager 返回的 page session。保留现有角色名、`runtimeExceptionCount` / `lastRendererException` 断言、DOM 自动化、IPC 场景和 provider 请求断言。
4. 将 `waitForApproval`、`waitForTrustedConfirmation` 与关闭等待改为按附着 page session 获取及按 `Target.detachedFromTarget` 等待；移除按 `/json/list` 发现 page 后另开 WebSocket 的路径。
5. `finally` 先在有界时间内关闭隔离 Electron，再关闭 Browser CDP socket 并关闭 loopback provider。任何握手、CDP 或关闭超时都让 `succeeded = false`，不执行成功 fixture 清理。
6. 输出 run 摘要保留总异常数与按角色统计；分类不明的 page 显示为 `unknown-page`，不得从总数中扣除。

**验证命令：**

```powershell
node --check scripts/trace-phase2-isolated-electron-bootstrap.cjs
node --check scripts/trace-phase2-isolated-electron-runner.cjs
node --check scripts/trace-phase2-cdp-auto-attach-smoke.cjs
```

接入后再次运行 Task 1 协议 smoke，确保共用 session manager 的真实 Browser session 不改变其 Electron 44.2.0 首脚本和 target-filter 证据。

### Task 5 — 回归、全量验证与独立复审

**文件所有权：** 代码 owner 释放后由协调者核对精确 diff；独立审查者只读，分别覆盖规格/协议一致性与标准/安全性。所有审查反馈均按实际增量处理，不覆盖其他既有 Phase 2 改动。

**聚焦验证：**

```powershell
npx vitest run test/trace-phase2-qa-pre-main-gate.spec.ts test/browser-cdp-auto-attach.spec.ts test/renderer-exception-monitor.spec.ts --pool=threads --maxWorkers=1
node --check scripts/trace-phase2-qa-pre-main-gate.cjs
node --check scripts/browser-cdp-auto-attach.cjs
node --check scripts/trace-phase2-isolated-electron-bootstrap.cjs
node --check scripts/trace-phase2-isolated-electron-runner.cjs
node --check scripts/trace-phase2-cdp-auto-attach-smoke.cjs
npm run typecheck
npm run build
git diff --check
```

全量 Vitest 按项目曾验证的 Windows DST 时区执行，并恢复原环境变量：

```powershell
$previousTz = $env:TZ
$env:TZ = 'America/New_York'
try {
  npm run test -- --pool=threads --maxWorkers=1
  if ($LASTEXITCODE -ne 0) { throw "Vitest failed with exit code $LASTEXITCODE" }
} finally {
  if ($null -eq $previousTz) { Remove-Item Env:TZ -ErrorAction SilentlyContinue }
  else { $env:TZ = $previousTz }
}
```

**复审条件：** Spec reviewer 确认首脚本前无竞态、filter 与窗口范围一致、所有异常均进入总计；Standards/Security reviewer 确认 loopback endpoint 验证、nonce gate、异常/超时/关闭清理、脱敏、fixture 所有权未被削弱。独立审查未 Ready 或任何全量门槛失败时，修复并重跑受影响门槛，不得宣称完成。

### Task 6 — 单独请求一次 D3-only 隔离 Electron 验收

Task 1/4 smoke、Task 5 全量验证及独立复审全部通过后，先更新 HANDOFF 与 Task 8 现状，向用户说明 runner SHA-256、隔离命令、唯一 Temp 规则及将验证的 D3 场景，再单独询问是否执行一次 D3-only。未经该次明确授权不运行 runner。失败时保留本轮 fixture 并停止；不自动重试，不运行默认完整 runner、D1 或 D2，不触碰历史失败 fixture。成功清理仍须通过现有 owner-marker、真实路径和进程退出验证。

**D3-only 通过仍不关闭 Task 8。** 还需对齐历史 D3/全量报告边界、完成原生键鼠/IME/DPI/窄矮窗口/读屏与真实安装包人工验收，以及最终 Task 8 交接；8A 根因仍按用户决定暂缓。发布、版本升级、合并与推送不在本计划。

## 完成标准

- Electron 44.2.0 独立协议 smoke 证明 page 首脚本执行前已完成 Runtime 监测初始化，三个指定窗口及 unknown page 都进入异常总计；page-only filter 对非 page 负向目标有效。
- pre-main nonce gate 与 Browser flattened session manager 的 focused specs 全绿，错误路径 fail closed、资源有界清理。
- runner 的三种应用窗口自动化全部使用同一 Browser WebSocket 下的 page session；旧 `/json/list` 后开 WebSocket 路径已移除；既有 DOM、IPC 和 provider 断言保持。
- Node/Web typecheck、Vitest 全量、build、node syntax check、diff-check 通过；独立规格与标准/安全审查 Ready。
- 当前子计划仅在上述自动门槛通过且 D3 是否另行授权/执行如实记录后完成；不把它等同 Task 8、Phase 2 或 1.0.0 发布完成。

## 当前状态（2026-10-08 21:49 +08:00）

**历史首轮 smoke 快照（2026-10-08 21:49）：** 用户已批准上述 Task 1 FD 3/FD 4 transport 修订。CDP smoke 已在唯一登记脚本中补齐 9 个 pre-release 拒绝场景，并通过静态检查及独立 Spec/Standards 复审（均 Ready，无 Critical/Important）。执行前隔离 worktree Electron executable 精确进程数为 0。首轮真实 Electron 44.2.0 Browser CDP smoke exit 1：首个 `protocol` 场景等待 “all first exceptions and continuations” 超时；控制台报告 exceptions=0、进程退出、stdio closed。失败 owner fixture `trace-cdp-auto-attach-smoke-wDk01l` 保留，运行后精确匹配 Electron 进程数 0。该时点依既定边界未读/清理现场、不重试；后续在 22:58 获准只读诊断，详见上述 Task 1 诊断章节。本快照不代表当前授权或当前最新结果。Task 1 仍未通过，Task 2+ 和 D3 仍停止。

### 历史 Task 1 stdin-blocked 状态（截至 19:42）

用户已批准设计规格、实施计划与子代理驱动。Task 1 初始提交 `67877f9611192665b96b1c0f2c31221a75281f2d`；修复提交 `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`，只修改 `scripts/trace-phase2-cdp-auto-attach-smoke.cjs`。隔离 worktree 为 `C:\Users\aaa\.codex\worktrees\task8-cdp-auto-attach\Trace`，分支 `codex/task8-cdp-auto-attach`，基线 `7ced10c1371004e53452074ef812747c6493b710`，修复后 worktree clean。原 reviewer 提出的三项 Important 与一项 Minor 均由 scoped re-review 判为 addressed，fix diff 无新 Critical/Important；但 Task 1 仍未完成，因为最终 smoke 未通过。

重复 continue 语义经用户明确：第一个正确 nonce 立即只放行一次；后续重复消息必须使 smoke/run 失败且不发生第二次放行，但不能声称回滚已由第一次合法放行启动的页面，也不增加等待窗口。此决定已同步本规格、Task 1 实施项和 Task 1 brief。

隔离基线 `npm run typecheck` 通过；全量测试在 `TZ=America/New_York` 下 512 passed、2 个 `buildYearHeatmap` 测试失败，同一 `test/diary-view-utils.spec.ts` 在默认时区 14/14 通过。用户同意将该时区敏感基线如实记录、不扩大 Task 1 范围并继续。最终 `node --check scripts/trace-phase2-cdp-auto-attach-smoke.cjs` exit 0；真实协议 smoke exit 1 / 4.18s，在 fixture `isolation-ready` 后观察到 stdin end 并 fail-closed 为 `runner-disconnected`。没有发送 continue、创建页面或到达 Browser WebSocket 协议断言。随后两个无 CDP/无窗口 Electron app-mode 诊断 fixture 都在 `app.whenReady()` 前收到 stdin end，`windowsHide:true/false` 结果相同；父端没有预先写入或调用 `stdin.end()`。相同 Node 24.18.0 父进程到普通 Node 子进程的 overlapped stdin 控制探针收发通过。证据定位到当前 Electron app-mode 标准输入生命周期/启动路径，但内部关闭原因未证实，不证明 CDP 不兼容或所有 Electron 启动方式都如此。最终清理后匹配 smoke/probe 前缀的 Electron 进程为 0；新增两个 smoke、此前五个 smoke 与两个 no-CDP 诊断失败 owner-marked fixture 均保留。用户确认的即时一次性 continue 语义已实现，但重复消息场景也因前置 EOF 未运行。Task 2+ 继续停止；不替换 stdin/stdout 通道、不 late attach、不扩大 target filter。当前要先由用户决定是否批准另行设计/验证本机 IPC；D3-only 仍需后续单独授权。本轮未运行 build 或 D3。

**最新进展（2026-10-08 19:10 +08:00）：** 新增 FD 3/4 smoke 经 Spec/Standards 第三轮独立只读复审均无阻断，`node --check` exit 0。用户授权的唯一完整复跑 exit 1 / 约 17.3 秒：Electron 44.2.0 `fragmented-continue` 通过；`duplicate-continue` 正确拒绝重复且只 release/action 一次，最终自然以退出码 23 退出。诊断显示 `app.exit(23)` 到进程 exit/stdio-close 为 15,251 ms；父进程的 15,000 ms `awaitExit` 等待触发超时。只读代码路径复核发现，duplicate 场景直到 awaitExit 超时后的 `terminate()` 才结束父端 `controlStream`；子端 FD4 ReadStream 使用 `autoClose: true`，在收到 EOF 后可自动关闭。成功场景则在 awaitExit 前结束父端流，约 0.2 秒后 child 退出。故首要假设是 harness 保持 FD4 打开令退出计时被污染；两端 EOF/close 时间未记录，仍未证实，不能归因 Electron。两个失败 fixture 保留，匹配隔离 Electron 进程数 0；其后 wrong-nonce、FD4 EOF、gate-timeout 场景未运行。授权复跑已用尽，本轮未再运行或改代码。**建议的最小后续试验（待新授权）：** 在 duplicate 拒绝后、awaitExit 前结束父端 FD4，并记录两端 end/close 时序；保留 15 秒上限与原断言，不换传输。**未完成：** Task 1 Browser CDP 协议硬门槛、完整 CDP 验收；Task 8 历史报告对齐、原生键鼠/IME/DPI/窄窗口/读屏与真实安装包验收及最终交接；Task 2+ 与 D3 继续停止。
