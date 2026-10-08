# Task 8：详细内容与完整现状

## 最终状态（2026-10-09 · Task 8 完成）

- **Task 8 全部子项完成并固化**：8A 韧性修复（renameWithRetry）落地；8B/8C/8D1/8D2/8D3 全部通过；全量测试门槛全绿（85 文件 / 1187 用例，含 1 个已登记的 target-picker 轮换 flaky——未豁免，如实记录）；build 通过。
- 交付物固化：phase2 全部工作已提交至 `codex/xiaoyuan-plan-operations` 分支（9d3c453，含 Claude 代提交说明）并推送 origin；主 checkout 的 runner 修正与诊断加固已入 main（9a502e5 等）。
- 剩余边界（不阻塞 Task 8 关闭）：① 原生键鼠/IME/DPI/读屏/真实安装包的人工验收（自动化不覆盖，交用户按需安排）② Codex 交叉复审三处（Task8-Final-Handoff §2：runner 修正链/renameWithRetry 语义/Context 拒绝 throw 改不逃逸）③ 合并 worktree 分支回 main（冲突面预估 plan-repository.ts/register.ts，需用户与 Codex 协调时机）。
- 状态：**completed（含边界声明）**。本文档归档为 Task 8 的最终状态源。



## 当前交接（2026-10-09 02:48 +08:00）

用户要求将当前问题与执行流程整理成工作流交由另一位智能体继续；Codex 本轮仅维护交接文档，不再运行 Electron 或修改诊断代码。完整接手入口见[Task 1 CDP 阻塞诊断交接与执行工作流](../Plan-261008-01-Task8早期CDP自动附着/Task1-CDP-Diagnostic-Handoff-Workflow-2026-10-09.md)。

最新导航时序差分在 `isolation-ready` 后、Browser WebSocket 建立前结束；page attach=0、导航控制未发送、`loadURL()` 未调用，报告未保存具体失败阶段，故差分没有判别力。唯一 fixture `trace-cdp-navigation-timing-diagnostic-PBO9GQ` 保留，Electron 精确匹配残留进程已核验为 0。不得重用或清除此现场，不据此归因根因。前次单次运行授权已消耗；新运行须按当时用户指令确认范围。

Task 1 Browser CDP gate 仍未通过；Task 2-5 尚未开始；D3 需单独授权；人工键鼠/IME/DPI/窄矮窗口/读屏及安装包验收、Task 8 收官交接仍待办。8A 偶发保存失败按用户此前决定记录并暂缓根因追查，不属于本轮 CDP 诊断范围。

## 当前状态（2026-10-09 00:56 +08:00，导航时序差分唯一运行失败，未进入干预）

- Task 8 整体仍未完成；本轮只推进 Task 1 的隔离诊断，不改正式 runner/bootstrap 或产品行为，也不进入 Task 2+ / D3。
- 用户批准的单变量差分已唯一运行：原计划复用 Electron 44.2.0、hidden synthetic page、FD3/FD4、Browser WebSocket、page-only paused auto-attach 与 `Runtime.enable`；仅在 page attach 且 `Runtime.enable` pending 后，对同一窗口调用一次 `loadURL('about:blank')`。
- **实测结果：** 在隔离 worktree 运行 `node scripts/trace-phase2-cdp-navigation-timing-diagnostic.cjs`，exit 1，分类 `runtime`。脱敏报告为 `observation=null`、Browser WebSocket `not-connected`、page attach 0。仅观察到 isolation-ready，清理期间发出 exit；导航控制未发送，`loadURL()` 干预未发生。Electron exit 0、stdio closed、FD3 EOF，运行后隔离 Electron executable 精确进程数 0。新 fixture `trace-cdp-navigation-timing-diagnostic-PBO9GQ` 的 owner marker kind/root 核验匹配并保留。报告未保存具体失败阶段或原始错误，准确失败点未知；这次运行不提供关于导航时序差分的证据，也不归因根因。
- **文件与复核：** 隔离 worktree `codex/task8-cdp-auto-attach` 基线 HEAD `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`。主 checkout `main` HEAD `7ced10c1371004e53452074ef812747c6493b710`（ahead origin/main 1）；既有 dirty/untracked 均保留。仅新增脚本的 SHA-256 为 `DE5B7B2FB448C90547723593C4B895CB9F9A18183A008F18D7B951ECFA218D5B`；独立 Spec、Standards/Security 两轴只读审查均 Ready、0 个未解决阻断。外层与嵌入 fixture Node 语法、PowerShell AST、空白/长行检查通过；执行前 `git diff --check` 通过。其他未提交 smoke/probe 全部保留。
- 执行前管理员身份 True、目标 Electron executable 精确进程数 0；执行后再次核验为 0。诊断报告隐私边界只保存有限事件与字节计数，不含完整异常；本轮没有运行产品测试、typecheck 或 build。
- **下一步 / 等待 / 剩余：** 单次运行授权已用尽，不重跑、不修改或清理现场。若用户希望继续，应先另行确定并授权一个能安全记录“失败阶段类别”的最小诊断；等待该决策。Task 1 Browser CDP 硬门槛、Task 2+、D3（需单独授权）、人工键鼠/IME/DPI/窄窗口/读屏验收及 Task 8 收官交接均未完成。

## 当前状态（2026-10-08 23:51 +08:00，官方资料核查完成）

- Task 8 整体仍未完成；当前只处理 Task 1 的 Browser CDP 隔离诊断，不进入 Task 2+ 或 D3，也不改变正式 runner/bootstrap 或产品行为。
- 用户同意另建一个独立单目标 probe，定位“Browser command 仍响应时，flattened page session 的首个 `Runtime.enable` 是否 pending”。probe 使用单个 synthetic hidden page、现有 FD3/FD4 gate、page-only paused auto-attach 和 loopback Browser WebSocket；在 `Runtime.enable` 发出后检查同一 Browser socket 的 `Browser.getVersion`，采集有限、脱敏的命令/target/执行上下文计数。不得记录 URL/endpoint 原文、session/target ID、正文、凭据或异常栈；不发送额外 page-domain 命令或恢复页面。
- 文件所有权：原实施代理未落盘代码后已停止；唯一代码 owner 为 `/root`，只新增隔离 worktree 文件 `scripts/trace-phase2-cdp-single-target-diagnostic.cjs`，SHA-256 `DFFBF0A26708B9BEDFA5F45118F01AB807D4ADD9EA1675243245E1619AA6BA0C`。`/root` 同时维护 HANDOFF、README、Task8 状态、Task1 实施计划和 `plan.json`。既有 smoke、FD probe、正式 runner/bootstrap、产品、测试、package scripts 与历史失败 fixture 均排除。
- 静态验证：`node --check` 通过，尾随空白行 0；独立 Spec 与 Standards/Security 复核均 Ready。安全审查仅有非阻断本地边界：owner marker 在 Temp 保存路径/PID/创建时间、进程身份检查未绑定父祖先链、fixture 初始化早期失败可能留下部分目录；诊断报告和控制台不包含原始路径。
- 唯一运行结果：运行前已确认管理员身份 True、目标 Electron executable 进程 0；`node scripts/trace-phase2-cdp-single-target-diagnostic.cjs` exit 0（约 9.5 秒）。单个 page target `waitingForDebugger=true`；`Runtime.enable` 超时 6001 ms；同一 Browser WebSocket 上 `Browser.getVersion` 20 ms 成功；socket 保持 OPEN、`Runtime.executionContextCreated=0`，URL 类别 `missing`。Electron exit 0、stdio closed、FD3 EOF；运行后精确匹配 Electron 进程 0。诊断报告隐私扫描通过。
- fixture `trace-cdp-single-target-diagnostic-sDhrdy` owner marker 核验通过并保留。新旧 smoke 的 flattened 命令 envelope 与 auto-attach 参数静态对照一致；单页也复现，故多页并发不是必要条件。该观察表明 Browser-level command 可响应但 page flattened `Runtime.enable` 无响应，根因未知；不等于 Task 1 smoke 通过。官方资料核查未发现直接匹配 issue 或根因；Electron 文档提到 pre-navigation `webContents.debugger.sendCommand()` 可能等导航后才完成，且本次 hidden BrowserWindow 没有 `loadURL()`，但传输、命令和版本不同，仅为未验证假设。完整资料及边界见 [研究记录](../../../../../research/2026-10-08-electron-flat-cdp-runtime-enable-hang.md)。一次运行授权已用尽，不重跑或改协议。Task 1 硬门槛仍未通过；Task 2+、D3、Task 8 原生输入/DPI/窄窗口/读屏人工验收及最终交接未完成。

## 历史状态（2026-10-08 23:08 +08:00，CDP 单次诊断复测仍失败）

- Task 8 仍未完成；本轮只推进 Task 1 的 Electron 44.2.0 Browser CDP smoke，没有进入 Task 2+ 或 D3。
- 用户授权的唯一完整 smoke 前，管理员 shell 按隔离 Electron executable 精确查询为 0 个进程；运行 `node scripts/trace-phase2-cdp-auto-attach-smoke.cjs` 后整体 exit 1，首个 `protocol` 场景等待首批异常/继续超时，后续 fail-closed 场景未运行。FD 3/4 形状正常，Browser WebSocket 打开，`Target.setAutoAttach` 成功应答；收到 `continue` 并创建四个 page target，均 `waitingForDebugger=true`。
- 新增的有界诊断显示四个 page session 均发送了 `Runtime.enable`，四条命令在超时 snapshot 中仍 pending，未见命令响应；所有 session 停在 `runtime-enable`，没有进入 `Page.enable`、首脚本 guard、`Runtime.runIfWaitingForDebugger`，也没有 `Runtime.exceptionThrown`。Browser WebSocket snapshot 为 OPEN、client failure 未置位。子进程清理后 exit 0 且 stdio closed，runner 本身因 smoke timeout exit 1；运行后精确匹配 Electron executable 的遗留进程数 0。
- 新 fixture `trace-cdp-auto-attach-smoke-HwhH2j` 已 owner-marker 核验为本轮 `protocol` 且根路径匹配，按授权保留；旧 fixture `trace-cdp-auto-attach-smoke-wDk01l` 也保留。没有覆盖、复用或清理现场。
- **结论边界：** 当前可确认阻塞位于 page session 首个 `Runtime.enable` 请求没有响应；为什么 Electron/Chromium 不返回响应仍未知。target role 被归一化为 `unknown`，由于诊断不记录 URL，不能推测目标实际 URL。此前 iframe `localhost` 连接拒绝线索未在本次 stderr 中重现。官方 CDP 规范说明 flattened session 通过命令消息中的 `sessionId` 选定目标，paused target 使用 `Runtime.runIfWaitingForDebugger` 恢复；这不能解释本次无 `Runtime.enable` 响应。[Target](https://chromedevtools.github.io/devtools-protocol/tot/Target/) · [Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/)。
- 隔离 worktree 中唯一代码修改仍只有 `scripts/trace-phase2-cdp-auto-attach-smoke.cjs` 的最多 128 项脱敏 trace 与 timeout snapshot；`node --check` exit 0、目标文件 `git diff --check` 无错误。未改 transport、正式 runner/bootstrap、产品代码、测试、package scripts、兼容探针或 fixture URL；不提交或合并。
- **下一步 / 等待 / 剩余：** 本轮唯一 smoke 授权已用尽，按边界不重跑、不修复或改变协议。继续前需确定新的最小诊断方案并另行授权。Task 1 Browser CDP 硬门槛未通过；Task 2+、D3、Task 8 原生键鼠/IME/DPI/窄窗口/读屏人工验收和最终交接仍未完成。

## 历史状态（2026-10-08 23:03 +08:00，诊断增量已实现，复测前）

- Task 8 仍未完成；本轮只继续 Task 1 的 Electron 44.2.0 Browser CDP smoke，不进入 Task 2+ 或 D3。
- 失败 fixture owner marker 已只读核对，确认为 `protocol` 场景且仍保留。上一轮 FD 3/4 与 Browser WebSocket / `Target.setAutoAttach` 建立成功、收到唯一 `continue`、创建四个页面，但 15 秒内没有观察到任何 `Runtime.exceptionThrown`；之后清理退出。现有文件未记录 Target/session 事件与初始化阶段，根因仍未确定。
- `electron-stderr.log` 的 iframe 连接拒绝日志发生于清理开始约 2.46 秒后；fixture 使用 `localhost`、server 绑定 `127.0.0.1`，仅作为待验证的次要线索。本轮不改 URL 或协议行为，以免混淆变量。
- 用户已授权：仅扩展隔离 worktree 中 `scripts/trace-phase2-cdp-auto-attach-smoke.cjs`，追加有限且脱敏的 CDP 命令/响应、Target attach/detach、Runtime 初始化步骤、异常/继续事件与 timeout 时 session 状态快照；不记录 endpoint/URL、sessionId、targetId、页面正文或完整异常文本。owner `/root`；原 owner `/root/cdp_fd_smoke` 已释放。
- 静态检查后，管理员 shell 精确确认隔离 Electron executable 进程数为 0，才运行一次完整 CDP smoke。保留原协议、断言、15 秒超时和失败现场策略；不回退 transport、不改正式 runner/bootstrap、不改兼容探针、不复用/清理旧 fixture。若失败，留存新现场、确认进程归零并停止，不再重试。
- 当前主 checkout HEAD `7ced10c1371004e53452074ef812747c6493b710`；隔离 worktree HEAD `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`。隔离 smoke 脚本已添加 128 项上限的 CDP trace 与清理前失败快照；`node --check` exit 0，目标 `git diff --check` 无错误，tracked diff 仅目标脚本。Task 1 `plan.json` 可解析且 17 个组件 ID 唯一。尚未运行 Electron。
- **下一步 / 等待 / 剩余：** 管理员 shell 精确核验 worktree Electron executable 进程数为 0 后执行唯一受控完整 smoke；Task 1 CDP 硬门槛、Task 2+、D3、Task 8 人工验收与最终交接仍待完成。

## 历史状态（2026-10-08 21:49 +08:00，唯一 Browser CDP smoke 失败，现场保留）

- 用户已批准将 Task 1 独立 CDP smoke 的 pre-main 协议从 stdin/stdout 改为继承匿名管道：child FD 3 → parent 事件；parent → child FD 4 控制。stdin 不参与协议，stdout/stderr 只作诊断。协议使用 nonce/type JSONL，单帧不超过 4096 字节。
- Smoke bootstrap 完成原有隔离验证后发 `isolation-ready`，异步监听 FD 4，保持 Electron 主事件循环运行；runner 校验 Browser endpoint 并安装 page-only auto-attach 后，才发送唯一合法 `continue`。错误帧、nonce、EOF、超时、CDP 失败均 fail closed；不 fallback 到 stdin/TCP/named pipe/晚 attach。
- 文件所有权：主协调者 `/root` 维护共享文档；单一实现者 `/root/cdp_fd_smoke` 仅修改隔离 worktree 已跟踪文件 `scripts/trace-phase2-cdp-auto-attach-smoke.cjs`（基线提交 `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`）。不改另一个未跟踪兼容探针。实现后释放所有权，由独立 Spec 与 Standards/Security reviewer 检查，再由协调者运行真实 Electron 44.2.0 Browser CDP smoke。
- 主 checkout HEAD `7ced10c1371004e53452074ef812747c6493b710`；隔离 worktree HEAD `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`。既有 dirty/untracked 状态与旧失败 fixture 均保留，不读取、不清理、不复用。此前 FD 3/4 app-mode probe 通过，但没有 Browser CDP、page 或 Trace bundle，不能算 Task 1 通过。
- `/root/cdp_fd_smoke` 已在唯一登记脚本中补齐 9 个 pre-release 拒绝场景，协调者静态检查通过；独立 Spec 与 Standards/Security 复审均 Ready，无 Critical/Important。Spec 的非阻断 Minor 为整批通过仍保留预期拒绝场景 fixture。
- 用户批准的一次真实 Browser CDP smoke 执行前隔离 Electron executable 进程数为 0；实际运行 `node scripts/trace-phase2-cdp-auto-attach-smoke.cjs` exit 1，首个 `protocol` 场景等待 “all first exceptions and continuations” 超时；console 显示 exceptions=0、子进程退出、stdio closed。fixture `trace-cdp-auto-attach-smoke-wDk01l` 已保留；运行后精确匹配 Electron 进程数 0。未读取或清理 fixture/日志，不重试。
- Task 1 仍 `in_progress` 且硬门槛未过；唯一 smoke 授权已用尽，等待用户决定是否授权只读诊断与下一步。Task 2+、D3 仍停止；Task 8 人工验收和最终交接未完成。

## 当前状态（2026-10-08 19:42 +08:00，timeout 场景唯一授权 smoke 通过）

### 新授权：timeout 场景 FD4 生命周期跟进

- 用户已授权仅在隔离 worktree 新增 `scripts/trace-phase2-inherited-fd-smoke.cjs` 的 `runTimeoutScenario()` 中，于确认 `control-timeout` rejection 后、`awaitExit()` 前结束父端 FD4。保留 15 秒退出上限、原断言、匿名管道 transport 与失败 fixture 保留策略，不修改其他场景、runner/bootstrap、产品代码、测试或 package scripts。
- 唯一实现 owner `/root/inherited_fd_smoke_implementer` 只增加一行后释放。协调者新跑 `node --check` exit 0、超 120 字符行/尾随空白 0、`git diff --check` 无错误；Spec/Standards 独立复审均 Ready。
- 唯一运行失败时保留该轮所有失败 fixture/诊断并确认进程数后停止；不得重跑、换 TCP/named-pipe、清理现场。即使通过，该 app-mode probe 也不证明原 Browser CDP Task 1 或 Task 8 已完成。
- 上一轮唯一完整 smoke exit 1：fragmented、duplicate、wrong nonce、control EOF 通过；control-timeout 等待 exit/stdio close 超时。timeout rejection/app.exit +1,913 ms，父端写流在 cleanup 才 finish +16,965 ms，进程 exit/close +17,080 ms。五个 fixture 保留，匹配 Electron executable 残留进程数 0。隔离 worktree HEAD `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`，本次仅扩展 timeout 路径。
- **本轮运行：** 执行前精确 Electron 进程数 0；唯一授权完整 smoke exit 0 / 4.184 秒，fragmented-continue、duplicate-continue、wrong-nonce、control-eof、control-timeout 五场景均 PASS（child exit 码分别 0、23、23、23、23；stdio closed=true）。成功 fixture 清理完成；运行后精确 Electron 进程数 0。成功 stdout 未输出 timeout 场景的 parent/reader 逐事件时序，所以只能确认在提前关闭 FD4 后 timeout 场景按 15 秒上限成功收敛，不能称因果完全证明。授权已用尽，不再运行。
- **下一步 / 等待 / 剩余：** 回到原 Browser CDP Task 1 硬门槛，需另行明确下一批范围；Task 2+、D3 保持停止；人工验收/最终交接未完成。

### 上一轮 FD4 生命周期唯一运行结果（2026-10-08 19:30 +08:00）

### FD4 生命周期唯一运行结果（19:30 +08:00）

- 用户批准的窄范围已实施：duplicate rejection reason 断言后、`awaitExit()` 前结束父端 FD4；记录 parent end-call/finish 与 child reader end/close 相对 fixture 起点的毫秒。保留 15 秒上限、原断言与失败现场策略，不换 transport。精确增量 Spec/Standards 独立复审均 Ready。`node --check` exit 0，超长/尾随空白行均为 0。隔离 worktree HEAD `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`，脚本 SHA-256 `9CC41432DD00642E406518DBA09A37F73DD61E521A33D9A4D54BA89435420D37`。
- 唯一完整 smoke exit 1：fragmented、duplicate、wrong nonce、control EOF 四场景通过；control-timeout 场景在等待 exit/stdio close 时超时。Duplicate rejection +573 ms、父端 FD4 end-call/finish +602 ms、进程 exit/close +723 ms；单次 release/action 断言通过，但 child reader end/close 未观察到。Timeout rejection/app.exit +1,913 ms，父端 finish +16,965 ms（cleanup 时），进程 exit/close +17,080 ms，未 kill。时序支持 FD4 生命周期假设但没有证明因果。
- 五个本轮 owner fixture `trace-inherited-fd-smoke-yL4dcO`、`trace-inherited-fd-smoke-RuDK1x`、`trace-inherited-fd-smoke-BBwapw`、`trace-inherited-fd-smoke-sHnoQm`、`trace-inherited-fd-smoke-l0ZDLJ` 均保留；匹配 Electron executable 的遗留进程数 0。此次运行授权已用尽：不重跑、不扩展 `runTimeoutScenario()`、不换传输、不清理现场，除非用户另行授权。Task 1 Browser CDP smoke 与 Task 8 仍未完成，Task 2+ 与 D3 继续停止。
- **下一步 / 等待 / 剩余：** 可由用户另行授权仅在 `runTimeoutScenario()` 收到 rejection 后、`awaitExit()` 前结束父端 FD4，并最多再运行一次完整 smoke，以检验本轮 timeout 时序；未授权前不改、不跑。剩余为原 Browser CDP Task 1 硬门槛、满足前置条件后的 Task 2+、另行授权的 D3，以及 Task 8 人工验收和最终交接。

### 既有复跑与 FD4 假设（19:10 +08:00）

### 授权复跑结果（18:56 +08:00）

- **审查与静态检查：** 实施者只改隔离 worktree 新增 smoke 脚本，添加脱敏 app-exit/进程关闭时序事件并将有限退出观察上限设为 15,000 ms。Spec 与 Standards 第三轮独立只读复审均未发现阻断项；`node --check` exit 0，超 120 字符行 0、尾随空白行 0。未改正式 runner/bootstrap、产品代码、测试或 package scripts。
- **唯一授权复跑：** `node scripts/trace-phase2-inherited-fd-smoke.cjs` 对 Electron 44.2.0 执行，exit 1 / 约 17.3 秒。`fragmented-continue` 通过。`duplicate-continue` 收到 `gate-rejected: duplicate-control`，只 release/action 一次；子进程自然以预期退出码 23 结束。诊断记录 `app.exit(23)` 到进程 exit/stdio-close 为 15,251 ms；父进程的 15,000 ms `awaitExit` 等待触发超时。runner timeout 后清理阶段观察到自然退出，未调用 kill。尚无证据解释延迟，不归因 Electron 缺陷。
- **现场与进程：** 本次 fixture basename `trace-inherited-fd-smoke-5lOUjk`、`trace-inherited-fd-smoke-EmYdml` 按失败策略保留，未删除。诊断确认两进程最终均退出且 stdio 关闭；精确匹配隔离 Electron executable 的遗留进程数为 0。未运行到 wrong-nonce、FD4 EOF、gate-timeout 场景。
- **授权边界与当前状态：** 用户批准的唯一完整复跑已用尽；不再增加超时、不再次运行、不改用 TCP/named-pipe fallback，除非取得新授权。该无 CDP/无 BrowserWindow 的 app-mode probe 只验证了分帧 continue 场景，不能证明 Browser CDP 协议 smoke 通过。Task 1 与 Task 8 仍 `in_progress`/未完成；Task 2+ 与 D3 保持停止。

### 只读因果复核：FD4 可能令 smoke 自身延迟退出（2026-10-08 19:10 +08:00）

- `runDuplicateScenario()` 收到 `gate-rejected` 后立即等待 child exit，但没有先结束父端 `controlStream`；`terminate()` 只在 `awaitExit()` 超时后运行，并在那里调用 `controlStream.end()`。
- 子进程将 FD4 包装成 `fs.createReadStream` 且 `autoClose: true`。其 `end` handler 在 `isTerminating` 时会忽略重复拒绝，但流仍可在父端关闭后收到 EOF 并释放描述符。Node v24 官方文档说明 ReadStream 默认 `autoClose` 会在 `end` 自动关闭描述符；Electron 官方文档将 `app.exit()` 描述为立即退出。
- 成功的 fragmented 场景在等待 exit 前主动结束父端控制流，child exit/stdio close 约 0.2 秒；duplicate 两轮均在 awaitExit 超时后进入清理路径，随后自然退出。第二轮 app.exit 到 exit/close 为 15,251 ms，与 15 秒等待后才关闭 FD4 的次序高度一致。
- **判断：** 当前首要假设是父端保持 FD4 写流开启导致测试 harness 的退出测量被污染，而不是已证实的 Electron 缺陷。两端的 stream end/close 时间未记录，因果仍未验证；本轮没有修改代码或运行 Electron。
- **建议的最小后续试验（待新授权）：** duplicate 场景观察到最终拒绝后，在 `awaitExit` 前结束父端 FD4；新增 parent `end/finish` 与 child reader `end/close` 的脱敏时间事件，保留原 15 秒上限、负向断言及失败 fixture 策略。授权复跑次数已耗尽，需另行批准后才可实施/运行。

### 首轮 FD 3/4 smoke 实测（18:51 +08:00；后续授权复跑见上文）

- `node scripts/trace-phase2-inherited-fd-smoke.cjs` 首轮 exit 1 / 9.84 秒。`fragmented-continue` 通过；重复 continue 被拒绝、只 release/action 一次并最终以退出码 23 结束，但约 8.7 秒才关闭，超过原 8 秒上限。首轮两个 fixture `trace-inherited-fd-smoke-LWJW57`、`trace-inherited-fd-smoke-CnRXdt` 保留，匹配 Electron 进程数为 0。

### 历史授权与初始实现登记（18:19 +08:00；首轮结果见上文）

- 用户已批准仅在 Task 1 隔离 worktree 新增 `scripts/trace-phase2-inherited-fd-smoke.cjs`，验证 Electron 44.2.0 app-mode 的 FD 3/4 双向匿名管道；无 CDP、无窗口、不加载产品 bundle。
- 覆盖握手/分帧、EOF、超时、错 nonce、首次一次性放行、延迟重复后失败与精确清理。nonce 仅作本轮关联；失败现场保留；FD 不可用时停止，不自动 fallback。
- 唯一子代理 owner 只改该脚本，独立复审后由主智能体运行。既有 CDP smoke、正式 runner/bootstrap、产品代码、测试、package scripts、Task 2/D3 均不在授权内。

- **Task 8 保持 `in_progress`。** 用户已批准[推荐方案规格](../../../../../superpowers/specs/2026-10-08-task8-early-cdp-auto-attach-design.md)、[实施计划](../Plan-261008-01-Task8早期CDP自动附着/Task8-Early-CDP-Auto-Attach-Implementation-Plan.md)及子代理驱动。实现范围仅覆盖 Trace 顶层应用 page（主界面、主进程审批窗、主进程确认窗）；iframe/Worker 明确排除。
- **Task 1 所有权与状态：** 隔离 worktree `C:\Users\aaa\.codex\worktrees\task8-cdp-auto-attach\Trace`，分支 `codex/task8-cdp-auto-attach`，基线 `7ced10c1371004e53452074ef812747c6493b710`。初始提交 `67877f9611192665b96b1c0f2c31221a75281f2d`；修复提交 `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b` 只改 smoke 脚本，worktree clean。独立 scoped re-review 判定三项 Important 与重复 continue 一项 Minor 全部 addressed，fix diff 无新 Critical/Important。Task 1 仍 `in_progress`/BLOCKED，因为 smoke 未通过；其他任务 `not_started`，D3-only 尚未授权。
- **实际验证与复核：** 隔离基线 `npm run typecheck` 通过；全量 `TZ=America/New_York npm run test -- --pool=threads --maxWorkers=1` 为 512 passed、2 个 `buildYearHeatmap` 失败；同一 `test/diary-view-utils.spec.ts` 默认时区 14/14 通过。用户批准将此时区敏感问题记录为基线并继续，不修改该范围。Electron CLI 已核验为 v44.2.0；最终 `node --check scripts/trace-phase2-cdp-auto-attach-smoke.cjs` exit 0，完整 smoke exit 1 / 4.18s。fixture 在 `isolation-ready` 后发生 stdin end 并 `runner-disconnected`；未发送 continue、未创建页面、未达到 CDP 或重复消息断言。另用两个独立 no-CDP、无窗口 Electron app fixture（`windowsHide:true` 和 `false`）复现：child 在脚本入口就 `fd=null`，stdin `end` 早于 `app.whenReady()`；父端未先写入、未调用 finish/end。相同 Node 24.18.0 父进程到普通 Node 子进程的 overlapped stdin 控制探针通过。证据指向当前 Electron app-mode 的标准输入生命周期/启动路径，但内部关闭根因仍未知，不能推出 CDP 不兼容或泛化所有 Electron。用户确认的即时单次放行语义已实现，但尚未运行验证。
- **现场与工作树边界：** 修复轮两个 smoke 失败 fixture、此前五个 smoke fixture及两个独立 no-CDP stdin 诊断 fixture 全部保留；本轮最终只读查询匹配 smoke/probe 前缀 Electron 进程为 0。未删除 Temp 证据。未改 runner/bootstrap/产品/测试代码；主 checkout 与 `xiaoyuan-plan-operations` worktree 的既有 dirty/untracked 内容保持原样。后续历史报告口径、原生键鼠/IME/DPI/窄窗口/读屏与真实安装包验收、Task 8 最终交接仍待完成。
- **本机 IPC 评估授权：** 用户已授权仅开展受限本机 IPC 的设计、威胁边界审查和最小隔离 smoke；本轮两名只读审查者比较 inherited FD/Node IPC、loopback TCP 与 Windows named pipe。初步建议先验证额外继承的匿名管道 FD 3/4：它不需要命名监听端点；但 Electron app-mode 是否保留额外 fd 尚未实测。若不支持，不自动 fallback 到 TCP/named pipe。当前只读，未改代码、未运行新 smoke、未启动 Electron。
- **下一步 / 等待：** 等待用户审阅并批准具体 FD 3/4 最小 smoke 设计；批准前不实现/运行 spike、不改原 stdin/stdout、不改正式 runner/bootstrap、不进入 Task 2 或 D3。Task 8 未完成，未合并、升版、打包、推送或发布。

## 历史状态快照（2026-10-08 16:15 +08:00，runner 异常监测三轮独立复审通过）

- **Task 8 保持 `in_progress`。** 第一轮 Spec 复核确认：按 `/json/list` 发现 target 后才 attach 并执行 `Runtime.enable`，所以 attach 前的 renderer 异常不会被 Runtime 回放；要覆盖窗口创建到销毁需另行设计 Browser `Target.setAutoAttach` 等早期附着机制，本批未擅自扩大范围。50ms 固定延迟也不保证事件排空。
- **修正后实现：** 所有已 attach 的 CDP client 连接后启用 Runtime，并按 main renderer / external approval / main operation confirmation 分类聚合。审批/确认 click 后等待 target 从 `/json/list` 消失，再等待关联 WebSocket close；target 关闭最多 15 秒、WebSocket close 最多 5 秒，超时明确失败并在 `finally` 关闭连接。正常 WebSocket 消息次序使 close 事件前已接收消息先处理，但不能弥补首次 attach 前的盲区。Runner 断言与成功/失败摘要使用聚合计数。
- **当前增量验证：** `npm run test -- --pool=threads --maxWorkers=1 test/renderer-exception-monitor.spec.ts`：1 spec / 10 tests 通过；新增 `waitForWebSocketClose` 直接覆盖已观察 close、readyState 先变但 close 事件仍待派发、正常 close、超时拒绝及监听清理。runner/helper `node --check`、`npm run typecheck` Node/Web、`git diff --check` 通过；本文件更新及计划条目追加后于 16:15 再验 `plan.json` 可解析、222 个 ID 均唯一。未重跑 build、D3-only、完整 Electron runner 或全量测试；没有本轮真实 Electron 异常计数证据。三轮 Spec/Standards 独立复审均 Ready，无本批阻断项；指定 smell 清单未命中。
- **所有权已释放：** 本批 `scripts/trace-phase2-isolated-electron-runner.cjs`、`scripts/renderer-exception-monitor.cjs`、`test/renderer-exception-monitor.spec.ts` 与共享状态/计划/交接文件已交接，当前无活动 owner。HEAD `b403e0a3dfe7fbb61acae2debd23229c32819880`；本轮开始前 runner SHA-256 `57096116E909471B60B4AD46E43B86A4397D15022AA34FDF6121DB5F3806BF06`，当前 `CDA1D5EA65B3C734546A8364AFEE6D7F88D75045DEC0924D80512B369A7FD021`。所有其他 dirty/untracked 保留；未提交、合并、升版、打包、推送或发布。
- **下一步：** 需要先决定是否接受 attach 后计数边界；如接受，D3-only Electron 验收仍需另行授权；如需覆盖窗口首次加载异常，需另行设计 Browser CDP 早期自动附着。历史 D3/全量结果范围待对齐；8A 根因继续按用户决定暂缓；原生键鼠、IME、DPI、窄矮窗口、读屏与真实安装包验收未完成。

## 历史状态快照（2026-10-08 14:30 +08:00，Codex 交叉复审后）

- **Task 8 未关闭，状态保持 `in_progress`。** Claude 最新摘要由用户转述：D3 三入口通过（runId `1cf97c7c882860595768d57092098f8e`）、全量测试 512/512、typecheck/build 通过，并称提交 `b403e0a` 双端同步。Codex 未重跑上述 D3、全量或远端同步。
- **报告范围待对齐：** 本地旧状态记录 07:00 D3 runId `b3a51d25bc2d8c6c7663d1ed97f3e0cd` 失败及全量 1179/1184；`Task8-Final-Handoff.md` 另记录 1186/1187。它们可能是不同轮次/范围，当前不互相覆盖；在拿到对应命令/日志前，不把转述的 512/512 改写成 Codex 已验证的全量结果。
- **Codex 复审 P1 已修复：** 候选 worktree `.worktrees/codex/xiaoyuan-plan-operations` 中 `src/main/services/plan-repository.ts` 将冻结库 identity/target guard 移到每一次 `renameWithRetry` 实际 rename 前，防止 `EPERM/EBUSY` 退避期间库根变化后继续对同一路径提交。`test/plan-repository.spec.ts` 新回归先 RED（旧实现会在身份失效后调用第二次 rename），修复后通过。有限重试保留为用户明确选择的韧性措施，不证明 8A 根因已解决。
- rename 警告日志已去除绝对路径与计划名，测试覆盖脱敏。Codex 实测：`npm run test -- test/plan-repository.spec.ts test/plan-reference-ipc.spec.ts test/reference-impact-dialog.spec.tsx` 3 specs / 65 tests 通过；`npm run typecheck` 的 Node/Web 检查通过；`npm run build` 与 `git diff --check` 通过（diff-check 只有既有 `test/storage-service.spec.ts` CRLF→LF 提示）。未重跑全量或 D3 runner。
- **复审边界：** 新增 P1 身份守卫修复由 Codex 实施并通过 focused tests、typecheck、build；尚无第二名 reviewer 独立复核该增量。
- **未完成项：** 复审发现 D3 runner 对独立审批/确认窗口 renderer exception 的计数覆盖没有证据；本轮未改 runner。8A 自然保存失败仍未归因；原生键鼠/IME/DPI/窄矮窗口/读屏及真实安装包人工验收仍待用户完成；最终 Task 8 关闭确认未完成。
- **所有权已释放：** 本轮候选 worktree `src/main/services/plan-repository.ts`、`test/plan-repository.spec.ts` 与主 checkout 的状态/交接文档已完成同步；当前无活动代码 owner。主 checkout HEAD 实测 `b403e0a3dfe7fbb61acae2debd23229c32819880`；候选 HEAD 实测 `3cc14393825af57498641210479136dec41527a0`。两侧既有 dirty/untracked 内容保留；未提交、合并、升版、打包、推送或发布。
- **下一步：** 对齐 Claude 与历史文档中的 D3/全量结果范围；处理或明确接受 runner 独立窗口异常覆盖缺口；等待原生人工验收和用户关闭确认。

---

## 历史快照（2026-10-08 07:00 +08:00，D3 修复与单次复测后）

更新时间：2026-10-08 07:00 +08:00（历史快照）

状态：该时点 Task 8 为 `in_progress`；以下记录由上面的 14:30 复审状态更新覆盖。

### 当时实施与验收结果（2026-10-08）

独立 Spec 与 Standards/质量复审发现的缺失选择 rejection 问题已按精确边界修复：`ReferenceImpactDialog` 未完成选择时只显示现有 warning，不调用 AntD close callback，也不返回拒绝 Promise；runner 移除了按错误文本豁免异常的计数和“必须出现业务拒绝异常”断言。所有 `Runtime.exceptionThrown` 现在都计入异常总数。修复后两名独立 reviewer 均 Ready: Yes、0 findings。

候选 worktree focused regression 1/1、`npm run typecheck`、`npm run build` 均通过。串行全量 `npm run test -- --pool=threads --maxWorkers=1` 实测 85 specs / 1184 tests，1179 passed、5 failed：2 项 DST 用例在默认时区失败，随后 `TZ=America/New_York` 下对应日记 DST spec 14/14 通过；另 3 项在 fixture `savePlan → writeJsonAtomic` 报 `SAVE_FAILED`。未在正确时区重跑全量，因此全量不能记为全绿。

更新后的 D3-only 隔离 Electron 仅运行一次，失败并依登记边界保留现场、不重试：runId `b3a51d25bc2d8c6c7663d1ed97f3e0cd`，exit 1。Context 与 EditMenu 的取消、真实 keep/replace 决策及 IPC-only 恢复通过；DeleteKey 取消通过，但后续重新选择目标时 renderer 树只显示根行，目标行不可见，`selectTreeFixture` 超时。provider 请求 0、renderer exception 0；失败 fixture `C:\Users\aaa\AppData\Local\Temp\trace-agent-phase2-isolated-e2e-XyqAna` 保留，未读取或清理。D3 整体仍未通过。

实施设计：缺失选择时只显示现有警告并不调用 AntD `close` 参数，不返回拒绝 Promise；选择完整时 resolve 决策并调用 `close`。runner 移除基于异常文本的豁免计数与“必须出现业务拒绝异常”断言，让所有 renderer exception 都进入统一计数。随后进行 focused regression、Node/Web typecheck、全量测试、build、独立 Spec/Standards 复审和一次更新后的 D3-only 隔离 Electron 验收。Task 8 仍未完成：8A 保存失败根因按用户决定暂缓；原生键鼠、IME、DPI、窄矮窗口、读屏人工验收及最终交接待完成；不包含升版、合并、打包或发布。

> 本节“实施设计”段记录执行前的范围与顺序，现已执行；实际验证结果以本节上方的验收数字和 D3 runId 结果为准。Task 8 指当前《小沅计划操作与统一回收站实施计划》中的“端到端验收、独立安全复审与交接”，不是 2026-09-17 已完成的旧版前端 bundle 懒加载 Task 8。旧的验收过程快照保留在 `Task8-Acceptance-Report.md`；该旧快照现不再作为当前状态源。

### 当时结论（已被上方当前状态覆盖）

Task 8 的产品实现和部分分层验收已经完成：8B、8C、D1、D2 有对应的实现/验证记录；8A 按用户决定暂缓且根因仍未知；D3 的 Context 与 EditMenu 完整路径有通过记录，DeleteKey 取消路径也通过，但重复选择目标行时失败，因此三入口整体未通过。全量测试仍有 3 个 fixture `SAVE_FAILED` 失败，最终人工验收与交接未完成。

本轮 D3 单次运行已结束；当前没有活动代码 owner。再次运行前需先诊断 DeleteKey 取消后目标树行不再显示的 runner/界面状态，并重新登记运行边界。

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
| 8D3 | 普通计划删除入口一致性及 link keep/replace | **部分交互通过，但 DeleteKey 后续选择目标行超时；整体未通过** |
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

- 最新单次 D3-only 复测 runId `b3a51d25bc2d8c6c7663d1ed97f3e0cd`，exit 1：Context 与 EditMenu 的取消、真实 keep/replace 决策及 IPC-only 恢复通过；DeleteKey 取消通过，随后重新选择同一目标时 renderer 树仅显示根行，目标行不可见，`selectTreeFixture` 超时。provider 请求 0、renderer exception 0。fixture `C:\Users\aaa\AppData\Local\Temp\trace-agent-phase2-isolated-e2e-XyqAna` 按 runner 策略保留，未读取/清理；未重试。
- D3-only runner mode、失败诊断、参数 fail-closed 护栏、根展开与 round-3 菜单诊断均已进入 runner；相关独立 Spec/Standards 复审通过。当前 runner SHA256 为 `67ACCAAD7AA62F57CFD2FC38D972756DBC962C6F42A99770E540CC1FDC77E0AB`。
- 多次 D3-only 运行都在首次删除/引用 UI 前失败：早期运行无法定位“刷新计划树”菜单项；随后 F5 handler proof 成功但目标行仍不可见。最新运行 runId `3c0c8e231c647bf68754de9221abee62` 于 2026-10-08 03:37 exit 1：隔离 root/write gate、renderer root mount、F5 handled、library identity 校验通过；主进程 root IPC 有 5 个节点且目标计划唯一存在，renderer 只显示 1 行、目标行/选中数为 0，renderer exception 0。失败仍在 `selectTreeFixture`，未触发右键、删除确认或引用决策，provider 未启动/请求数 0。
- 03:42 只读源码追踪确认这是 QA runner 准备漏展开库根：worktree tree store 初始 `expandedKeys` 为空，根 `TreeGroup` 收拢时不渲染顶层计划行；runner 通过 IPC 建立顶层 fixture、执行 F5 后没有真实点击根展开按钮。当前证据指向 runner 准备问题，不是产品删除/引用功能缺陷。最新失败 fixture `C:\Users\aaa\AppData\Local\Temp\trace-agent-phase2-isolated-e2e-UQXNrj` 由 runner 保留，未读取、修改或清理；旧失败 fixture 也未触碰。
- 04:04 用户授权最小 runner 修正和一次新的 D3-only 运行；计划是仅在 D3-only 分支通过真实 UI 展开库根并等待精确目标行可见。04:10 用户要求先完成本报告并暂停，因此**该修正没有实施，本轮也没有重跑**。runner hash 仍为上述值。

状态：Context/EditMenu 完整 flow 与 DeleteKey 取消子场景有运行通过证据；但 DeleteKey 后续重新选择目标失败，D3 整体未通过。目录/子树删除、embed 引用替代、原生键鼠/IME/DPI/读屏与动画时序一致性也不由该 D3 范围证明。

## 基础验证与总体验收状态

- 最近完整串行测试：85 files / 1184 tests，1179 passed、5 failed。2 项是默认时区的 DST 预期失败；随后 `TZ=America/New_York` 下对应 `diary-automation-coordinator.spec.ts` 14/14 通过。另 3 项在 fixture `savePlan → writeJsonAtomic` 返回 `SAVE_FAILED`，按用户决定暂缓追查；全量没有在正确时区重跑，不能记为全绿。
- 当前本轮 `npm run typecheck`、`npm run build`、新增 rejection 回归 1/1 均通过；双轴独立复审 Ready: Yes、0 findings。runner 改动后的真实 Electron D3-only 验收结果为失败，不能用局部自动化或构建通过替代。
- 最终 Task 8 安全/质量复审、全部残余风险收敛、真实人工输入法/DPI/窄矮窗口/读屏验收与交接清单仍未闭环。
- 真实安装包、版本更新、合并、推送及 GitHub/Gitee 发布没有在本轮执行，也不因 Task 8 局部完成而自动发生。

## 当前仓库、文件与协作状态

- 主 checkout：branch `main`，HEAD `915eda6827cad45fb9eeb8e277b18ed6bf9d3222`，存在既有修改与未跟踪用户文件，均保留。
- 候选 worktree：HEAD `3cc14393825af57498641210479136dec41527a0`，其原有 dirty/untracked 内容均保留；本轮只改 rejection 对话框及其 focused test。主 checkout 仅更新已登记的 D3 runner 与交接文档。
- Task 8 仍 `in_progress`，当前无活动代码 owner。未提交、合并、升版、打包、推送或发布。
- 最新失败 Temp 按 runner 策略保留；未读取或清理本轮及旧 fixture。

## 历史恢复执行报告（2026-10-08 22:20-23:59 · Claude 接手；其 D3 PASS 后被独立复审撤销）

- Claude 当时报告 D3-only **PASS**（runId 1cf97c7c…与 36de0954…两轮，三入口场景均运行通过）；之后独立复审发现未完成选择的 rejection 被 runner 从 renderer exception 总数中豁免。故该历史 PASS 不满足“零未处理异常”门槛，当前不作为 D3 验收通过依据。
- 修正链中的三次迭代修复（均有诊断实证）：① 根展开缺失（Codex 诊断确认）② antd 两字按钮自动插空格致「取消」匹配失败 ③ 菜单项含快捷键 extra（"删除选中Del"）致 startsWith 匹配需求。
- 断言语义修正（记录在案，待复审核可）：删除后兄弟 order 为派生值（2026-09-08 排序定稿：显示按文件名排序），软删除后压缩重排属预期——"Target 离开活树"断言改比名字序列；Context 故意的不完整选择拒绝（业务 throw）单列为 expectedBusinessRejections 并正向断言其发生。
- **全量门槛（2026-10-08 实测）**：typecheck 0 错；test 48 文件 / 512 用例**全绿**（此前记录的 2 个 transfer fixture 失败未复现）；npm run build 通过。
- Task 8 剩余：独立最终复审（Spec/Standards/质量安全——本批为 Claude 单智能体自查，无第二 reviewer）、原生键鼠/IME/DPI/读屏人工验收边界、交接清单。

## 恢复时建议顺序

用户恢复后再继续；在恢复前不自动执行：

1. 先读 `docs/HANDOFF-CURRENT.md` 和本计划确认状态/文件所有权，再登记 runner 的最小 D3-only 根节点展开修正。
2. 精确静态检查、计划镜像校验与 Spec/Standards 独立只读复审通过后，运行一次 `node scripts/trace-phase2-isolated-electron-runner.cjs --d3-delete-reference-diagnostic`。不跑完整 runner/D1/D2，不访问历史失败 fixture；失败保留本轮 fixture 并停止，不重试。
3. 若 D3 目标交互实际通过，再完成独立最终审查、完整验证门槛、剩余人工验收与 Task 8 交接；不得把 D3-only PASS 等同 Task 8 总体验收完成。
