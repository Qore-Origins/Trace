# Task 1 Browser CDP 阻塞诊断交接与执行工作流

更新时间：2026-10-09 02:48 +08:00
用途：交给接手 Task 8 的智能体作为当前诊断入口。本文记录问题和执行顺序，不代表新的 Electron 运行授权。

## 1. 当前结论

Task 8 尚未完成，当前首要阻塞是 Task 1 的 Electron Browser CDP 自动附着 smoke 未通过。最近一次导航时序差分在 Browser WebSocket 建立前就失败，页面 attach 数为 0，因此既没有发送导航控制，也没有调用 `loadURL('about:blank')`。它不能支持或反驳“导航时序会解除 `Runtime.enable` 卡住”的假设。

已知的是：完整 CDP smoke 中 page flattened session 的 `Runtime.enable` 曾持续 pending；单目标 probe 中同一 Browser WebSocket 的 Browser 级命令能响应，但 page session 的 `Runtime.enable` 超时。尚不知道最近这次启动在 `isolation-ready` 之后具体失败于哪一步。不得把根因归结为 Chromium、Electron、WebSocket 或导航时序。

## 2. CDP 执行链与故障位置

```text
启动隔离 Electron 44.2.0
  -> bootstrap 完成隔离检查
  -> FD3 发出带 nonce 的 isolation-ready
  -> runner 等待 DevToolsActivePort
  -> runner 校验 /json/version 的 loopback Browser endpoint
  -> 建立唯一 Browser WebSocket
  -> Target.setAutoAttach(page-only, flatten=true, waitForDebuggerOnStart=true)
  -> auto-attach 成功后才经 FD4 发唯一 continue
  -> 合成 page 被暂停并附着
  -> 建立 session/异常事件路由
  -> Runtime.enable
  -> Runtime.runIfWaitingForDebugger
  -> 验证首段异常计数与后续脚本执行
```

FD3 是 child 到 parent 的事件通道；FD4 是 parent 到 child 的控制通道。stdin 不承载协议，stdout/stderr 只用于诊断，不得解析成握手。目标仅是隔离的顶层 page；不扩大到 iframe/Worker，不访问真实计划库、真实 provider 或外网。

故障分层：

| 证据 | 已证实 | 未证实/未知 |
|---|---|---|
| 2026-10-08 Browser CDP 完整 smoke | Browser WebSocket 打开、auto-attach 应答、continue 成功、4 个 page target 暂停附着；4 个 `Runtime.enable` 均 pending，无 CDP response；socket 仍 OPEN；后续初始化未执行 | 为什么 page session 命令没有响应；后续 fail-closed 场景因首场景失败未运行 |
| 2026-10-08 单目标 probe | 单个 paused page 的 `Runtime.enable` 约 6001 ms 超时；同一 Browser WebSocket 上 `Browser.getVersion` 约 20 ms 成功；socket OPEN，execution context 数为 0 | flattened page 命令无响应的内部原因 |
| 2026-10-09 导航时序差分唯一运行 | Electron fixture 发出 `isolation-ready` 后进入清理；报告 `observation=null`、Browser WebSocket `not-connected`、page attach 0；Electron 退出 0、stdio closed、FD3 EOF，精确匹配的遗留 Electron 进程为 0 | `isolation-ready` 后究竟卡在端口文件、HTTP 版本端点、endpoint 校验、WebSocket 握手还是其他步骤；本次没有到达原假设所需的 page attach 与 pending `Runtime.enable` |

因此，最近一次的有效结论仅是“差分未进入干预，失败阶段记录不足”。导航假设仍为未验证，不是已失败或已成立。

## 3. 现场、基线与文件边界

- 主 checkout：`D:\Code\Project\Qore\Trace`，分支 `main`，HEAD `7ced10c1371004e53452074ef812747c6493b710`，相对 `origin/main` ahead 1。工作区有大量既有修改和未跟踪文件，全部属于既有工作；不得清理、回退或覆盖。
- 隔离 worktree：`C:\Users\aaa\.codex\worktrees\task8-cdp-auto-attach\Trace`，分支 `codex/task8-cdp-auto-attach`，HEAD `f315ef4d602f4fed41ac2708ca12d96e2b77fc7b`。
- 隔离 worktree 当前已有修改：`scripts/trace-phase2-cdp-auto-attach-smoke.cjs`；已有未跟踪文件：`scripts/trace-phase2-cdp-navigation-timing-diagnostic.cjs`、`scripts/trace-phase2-cdp-single-target-diagnostic.cjs`、`scripts/trace-phase2-inherited-fd-smoke.cjs`。本交接不改变这些文件。
- 最近差分脚本 SHA-256：`DE5B7B2FB448C90547723593C4B895CB9F9A18183A008F18D7B951ECFA218D5B`。此前针对该脚本的 Spec 与 Standards/Security 静态复审为 Ready、0 个未解决阻断；这些复审不自动覆盖后续修改。
- 最近新增 fixture 名称：`trace-cdp-navigation-timing-diagnostic-PBO9GQ`，位于用户 Temp。其 owner marker 的类型与根目录已核验匹配，现场按失败规则保留。不要复用、覆盖或删除；若确需只读检查，先核对 owner marker，并只查看该 fixture 的 `diagnostics.json`。不得据未记录的 stderr 字节数推测错误内容。
- 本轮没有运行产品测试、typecheck 或 build；没有提交、合并、版本升级、打包、推送或发布。

## 4. 接手时的同步步骤

1. 先读项目 `AGENTS.md`、[`docs/HANDOFF-CURRENT.md`](../../../../../HANDOFF-CURRENT.md)、[`docs/Plan/README.md`](../../../../README.md)、[Task 8 完整现状](../Plan-261003-01-小沅计划操作与统一回收站/Task8-Current-Status-2026-10-08.md)、[Task 1 实施计划](Task8-Early-CDP-Auto-Attach-Implementation-Plan.md) 和 [Electron flattened session 调查](../../../../../research/2026-10-08-electron-flat-cdp-runtime-enable-hang.md)。本文是本次诊断工作流，不取代 HANDOFF 或实施计划。
2. 分别核对主 checkout 与隔离 worktree 的 `git status --short --branch`、`git log -1`；核对隔离 worktree 的实际路径和 Electron 版本。不得因为主 checkout 有脏文件就清理或把它们复制进 worktree。
3. 在 HANDOFF 明确登记新 owner、精确文件清单、任务范围、验证方式和运行上限；更新 Markdown 计划及 `plan.json` 镜像。上一位 owner 已释放，本文件不替下一位自动取得代码所有权。
4. 仅阅读最近差分 fixture 的 owner marker 与允许的脱敏诊断 JSON；不要打开旧 smoke、旧 probe 或无关 fixture。不要读取原始日志来绕开既有隐私边界。

## 5. 推荐的下一片：只定位失败阶段

最近一次报告只记到 `isolation-ready` 和清理 `exit`，故下一步应先补齐阶段证据，而不是换协议、改产品或重跑完整 smoke。建议新 owner 仅在隔离 worktree 的 `scripts/trace-phase2-cdp-navigation-timing-diagnostic.cjs` 增加有界阶段记录；先做规格/隐私审查，后续运行需遵守第 6 节。

建议使用固定 allow-list 的 `failurePhase`，覆盖实际存在的阶段：

1. `fixture-created`
2. `electron-spawned`
3. `isolation-ready`
4. `devtools-port-ready`
5. `version-endpoint-validated`
6. `browser-websocket-open`
7. `auto-attach-installed`
8. `continue-sent`
9. `page-attached`
10. `runtime-enable-pending`
11. `navigation-requested`、`navigation-started`、`navigation-finished`
12. `runtime-outcome`
13. `cleanup`、`report-written`

阶段值必须由脚本常量映射产生，不写任意异常文本。发生失败时，应在清理前冻结主失败阶段；清理失败单独记为 cleanup 状态，不能覆盖主失败。可额外记录受限错误类别，例如 allow-listed `error.code` 或 `error.name`；禁止记录异常 message/stack、原始 URL/endpoint、target/session ID、nonce、页面内容、凭据、任意 stdout/stderr 或本机绝对路径。报告只需回答“最后确认到哪一阶段、失败归类、Electron/FD/socket 的有限状态”。

本片不得同时改变诊断实验变量：保持 Electron 44.2.0、合成隐藏窗口、FD3/FD4、Browser WebSocket、page-only paused auto-attach 与现有命令顺序；唯一差分仍应是“首个 `Runtime.enable` 确认 pending 后，对同一窗口调用一次 `loadURL('about:blank')`”。不增加 page、不恢复 paused target、不加 fallback、不碰正式 runner/bootstrap、产品、测试或 package scripts。

## 6. 静态审查与运行门槛

### 静态实施/审查

1. 实施前后核对精确 diff，确认只改登记脚本及确需同步的共享文档；保留同 worktree 的 smoke/probe 修改。
2. 运行 `node --check scripts/trace-phase2-cdp-navigation-timing-diagnostic.cjs`，并检查生成的 Electron fixture source 可解析。
3. 检查 allow-list 阶段覆盖成功/失败/清理路径；检查报告不会泄露 message、stack、路径、URL/endpoint、IDs、nonce、页面正文或完整 stdout/stderr。
4. 运行 `git diff --check` 与计划 JSON/ID 唯一性校验；由独立 reviewer 对精确增量做规格与 Standards/Security 双轴只读复审。之前对旧 hash 的 Ready 结论不能替代新一轮复审。

### Electron 运行

- 前置审批：此前导航差分“一次运行”的授权已经用完。本工作流不把一次性授权无限延长；运行前须确认当前任务消息明确授权了这次具体诊断、运行上限、失败保留策略和禁止范围。没有时先停下向用户报告/询问，不自行运行。
- 执行前再次核验当前 PowerShell/Codex 进程为管理员；若不是，告知用户。按隔离 worktree Electron executable 的完整路径精确确认进程数为 0。
- 只使用新唯一 owner-marked fixture，最多执行一次登记命令；记录 exit code、failurePhase、运行前后精确进程数。失败保留本次现场并停止，不自动重试，不修改失败 fixture。
- 运行后验证 Electron 遗留进程为 0；核验本次 owner marker 与报告路径一致。不要删除保留 fixture。不得启用 TCP、named pipe、stdin 协议或 late attach fallback。

## 7. 结果判读与后续顺序

- **在 Browser WebSocket 前失败：** 只报告新增的精确阶段和安全可记录状态；导航时序实验仍未发生。先针对这个阶段单独形成下一份方案，不同时改连接逻辑并重跑。
- **达到唯一 page attach 且 `Runtime.enable` pending，之后完成导航干预：** 按报告如实比较 `Runtime.enable` response/timeout 与 target 生命周期。一次合成诊断只是诊断证据，不等于正式 Task 1 smoke 通过，也不等于已证明普遍因果。
- **到达干预但 `Runtime.enable` 仍无响应：** 只说明此边界下的导航差分未观察到解除；不能据此宣布所有导航方案无效或推断 Chromium 内因。
- **Task 1 通过门槛：** 仍以实施计划中的独立 Browser CDP smoke 为准，需真实证明 Electron 44.2.0、loopback Browser endpoint、page-only paused attach、首段异常捕获、放行顺序及 iframe/Worker 非 page 过滤。probe 通过不能替代。
- **后续开发顺序：** Task 1 硬门槛通过后，按原计划依次完成 Task 2 pre-main nonce gate 与单测、Task 3 flattened session manager 与单测、Task 4 隔离 bootstrap/runner 接入、Task 5 focused/full Vitest、typecheck、build 与双轴复审。Task 1 未通过不得继续这些依赖步骤，不以晚 attach、第二套 WebSocket 或放宽 target filter 降级。
- **Task 6 / Task 8 收官：** 前置门槛完成后，D3-only 仍需单独用户授权；之后还需真实人工验收键鼠、IME、DPI、窄矮窗口、读屏及安装包边界，最后更新 Task 8 收官交接。上述任一验收未完成均不得写 Task 8 已完成。

## 8. 与当前主阻塞无关但仍开放的事项

- Task 8A 的偶发保存失败已按用户决定保留有限韧性处理并暂缓追查根因；它是已记录的未归因残余问题，不是本轮 CDP 阻塞的证据，也不应在本片顺手重开。
- Task 2 至 Task 5 当前尚未开始；Task 1 仍为 `in_progress`。D3、原生输入/辅助功能验收及 Task 8 最终交接尚未完成。
- 不在本工作流内做 commit、merge、升版、安装包构建、push 或 release；这些动作需要按用户后续明确指令处理。

## 9. 每个阶段的交接模板

阶段结束后更新 HANDOFF、Task 8 状态文档、Task 1 实施计划、`docs/Plan/README.md` 与 `plan.json`，并按以下字段汇报：

```text
阶段/owner：
基线与精确改动文件：
状态：设计 / 已实现 / 已验证（分别说明）
真实命令与退出码：
运行范围、fixture owner 与进程核验：
发现 / 未发现 / 仍未知：
是否触及下一阶段门槛：
下一步 / 等待 / 剩余工作：
```

只有实际运行的命令才写“已验证”；不要用静态审查代替运行结果，不要把诊断采集成功写成 Task 1 或 Task 8 通过。
