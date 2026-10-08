# Task 8：早期 CDP 自动附着 renderer 异常监测设计

状态：用户已同意按推荐架构编写本设计；本文件完成自审后等待用户审阅。本文是 QA runner 的设计规格，不代表实现或验证已完成。

## 1. 背景与目标

当前隔离 Electron runner 在应用启动后轮询 DevTools 的 `/json/list`，发现 page target 后才建立独立 CDP 连接并启用 Runtime。`Runtime.exceptionThrown` 不会补发首次 attach 和 `Runtime.enable` 之前已经发生的 renderer 异常，因此启动早期的同步错误可能漏计。Task 8 需要可靠覆盖目标应用窗口从首次脚本执行到窗口销毁的 renderer 异常。

本设计只改变隔离 QA runner 的观测顺序，不改 Trace 产品行为。目标窗口限于 Trace 的顶层 page：主界面、外部审批窗口、主进程本地确认窗口。iframe、Worker、Service Worker、其他非 page target 不在本次目标内。

## 2. 已确认目标与非目标

目标：

- 在生产 main bundle 执行并创建应用窗口之前，先建立 Browser CDP 连接并启用 page-only 自动附着。
- 每个新 page 在首段脚本运行前保持暂停；runner 先注册异常事件接收、启用 Runtime，再恢复该 page。
- 用同一 Browser WebSocket 和 flattened session 同时承载异常监测与既有页面自动化，避免每个窗口再开独立 WebSocket、产生 attach 时序差异或重复连接。
- 所有 page 异常都计入总数。窗口角色暂时无法分类时标为 `unknown-page`，不得静默忽略。
- 启动隔离核验、CDP 初始化、握手、窗口关闭或清理任何一步失败，都明确使 QA 运行失败；不退回当前“先启动、后 attach”的弱覆盖模式。

非目标：

- 不修改生产 renderer、preload、BrowserWindow 生命周期或应用功能。
- 不在本设计阶段修改 runner/bootstrap、编写实现计划、运行协议 smoke、运行 D3 或完整 Electron runner。
- 不覆盖 iframe/Worker 异常，也不把 CDP 结果扩张为对原生输入法、DPI、读屏或真实安装包体验的证明。
- 不连接真实计划库、真实模型服务或外部网络；协议通信只通过本轮唯一隔离 Electron 的 loopback 调试端口。

## 3. 推荐架构与启动时序

### A. 隔离 bootstrap 的 pre-main gate

保留现有的路径与配置隔离核验：run root、userData、sessionData、日志目录、crash dump 目录及 disposable library 均须通过 realpath/symlink 检查，config root 必须精确指向本轮 disposable library，生产 main bundle 必须存在。只有这些检查全部通过后，bootstrap 才发送带本轮随机 nonce 的 `isolation-ready` 消息，并暂停在 `require(mainBundlePath)` 之前。

runner 与 Electron 子进程使用已连接的 stdin/stdout pipe 完成一次性握手。runner 只在收到 nonce 匹配的 ready 消息、验证浏览器调试 endpoint、连上 Browser WebSocket 且 page-only auto-attach 命令成功后，才发送匹配 nonce 的 `continue`。bootstrap 对错误 nonce、重复消息、握手超时、runner 退出均 fail closed，不载入 main bundle；父进程随后只终止本轮可识别的隔离 Electron process tree，并保留已有 owner-marker 清理门禁。

nonce 仅用于区分本轮握手，不是安全认证机制；调试端口仍必须绑定 127.0.0.1 且只服务本轮隔离进程。

### B. Browser CDP 控制连接

runner 读取本轮 `sessionData/DevToolsActivePort`，仅向 `http://127.0.0.1:<port>/json/version` 请求浏览器元数据，并验证返回的 `webSocketDebuggerUrl` 使用 WebSocket、loopback 主机和预期端口；拒绝非 loopback URL、端口不匹配、缺少 browser endpoint 或无法连接的情况。必要时用同一调试 endpoint 的 `/json/protocol` 检查当前打包 Chromium 实际暴露的协议 schema；不得用 tip-of-tree 文档替代运行时兼容验证。

runner 先建立唯一 Browser-level CDP WebSocket，再安装一条全局消息分发器。分发器以 command id 路由命令结果，以 flattened `sessionId` 路由 page 命令和 Runtime 事件；异步处理某个 target 的初始化时，不得阻塞或丢弃同一 socket 上其他 target 的事件。

### C. 只自动附着 Trace 顶层 page

隔离 ready 握手期间不执行 main bundle，因此正常情况下尚无 Trace 应用 page。runner 在 Browser endpoint 上设置 `Target.setAutoAttach`，要求新 target 在 debugger ready 后暂停，并启用 flattened session。过滤器采用显式 page allowlist，逻辑为：

1. `{ type: "page", exclude: false }`：包含顶层 page target。
2. `{ exclude: true }`：排除其他所有 target 类型。

CDP 的 TargetFilter 按顺序匹配，第一个匹配项决定是否包含；该过滤能力在公开协议文档中标注为 experimental，所以精确 schema、Browser target 权限和 Electron 44.2.0 的行为必须由后述协议 smoke 验证。若运行时拒绝该命令或产生 iframe/Worker 附着，不得放宽过滤器或悄悄改用旧路径。

### D. 每个 page 的监测与恢复

消息分发器收到 `Target.attachedToTarget` 后，为 target/session 建立一次性记录，确认 target type 为 page，并先安装该 session 的 `Runtime.exceptionThrown` 事件路由。随后按顺序执行 `Runtime.enable`、`Runtime.runIfWaitingForDebugger`。恢复页面必须发生在异常监听器就绪且 Runtime 已成功启用之后。

窗口分类复用 runner 现有的 URL/title 或已定义的页面语义识别，预期标签为 main renderer、external approval、main operation confirmation。未知 page 仍启用 Runtime 并计入聚合异常数，同时记录为 `unknown-page`，使新增窗口不能绕过总断言。

所有 DOM、Accessibility、Runtime.evaluate 等既有自动化命令都经该 Browser WebSocket 的 flattened `sessionId` 发往相应 page，不再对 `/json/list` 中的每个 page 建立第二条 target WebSocket。保留现有测试场景和 IPC 断言，不改变业务交互步骤。

收到 `Target.detachedFromTarget` 时结束对应 session 的计数与生命周期；所有已接收的异常都归入 run 级总计。异常文本继续遵循当前脱敏逻辑，不增加原始用户内容、计划正文、密钥或未经脱敏的本机绝对路径输出。

## 4. 故障与清理语义

- 隔离检查未通过、ready nonce 不匹配、Browser endpoint 校验失败或 auto-attach 安装失败：不放行 bootstrap，不载入 main bundle，报告 QA 失败并清理本轮子进程。
- 单个 target 的 Runtime 启用失败：该 run 失败；对已经暂停的 target 做一次有界的 best-effort resume，若不能确认恢复，则终止本轮隔离进程树，不能让测试悬挂，也不能将该窗口当作无异常跳过。
- `Runtime.runIfWaitingForDebugger` 超时/失败、CDP 连接意外关闭、目标窗口关闭超时或事件路由状态不一致：run 失败并进入统一 finally 清理；不再用固定短延迟推断事件已排空。
- 错误输出只保留现有必要的脱敏诊断、target 类别、CDP 方法/错误码和计数，不输出调试 endpoint 中的 token/标识符、注释正文、计划内容或原始完整异常栈。

## 5. 验收门槛

实现前须单独通过真实 Electron 44.2.0 的协议 smoke。smoke 使用全新、一次性、带 owner marker 的本机 Temp，不读取用户配置/计划库、不启动 provider、不复用失败 fixture；新建隔离结束后按现有清理守卫验证处置。该 smoke 是后续设计阶段的测试计划，不是本轮已执行工作。

协议 smoke 至少证明：

1. bootstrap 在隔离核验后确实暂停于 main bundle 前；没有有效 nonce 的继续命令不能放行，正确 nonce 只放行一次。
2. Browser `/json/version` endpoint、Browser WebSocket、Target.setAutoAttach 确切参数在 Electron 44.2.0 可用；附着事件带有效 flattened session，并报告 target 正处于等待 debugger 状态。
3. 在 page 首脚本放置同步 throw，runner 先收到 `Runtime.exceptionThrown`，然后页面后续标记/加载事件才发生；异常必须进入计数，证明不是 attach 后补听。
4. 已恢复的 page 可以执行脚本并关闭；异常事件在 detach 前可完整计入，目标关闭后 session 不残留。
5. 至少再创建主界面、审批窗、确认窗三个真实应用 page，三者全部自动附着并分类；未知 page 仍进入总计。
6. 构造 iframe 与 Worker 作为负向控制，证明过滤策略不会将它们作为本次顶层 page session 监测；如果 Electron 44.2.0 将它们以 page target 暴露，smoke 必须记录并拒绝该实现方案。
7. 关闭/超时/协议拒绝路径不留下孤儿 Electron、runner、Browser CDP socket 或误删非本轮 Temp；错误路径 fail closed。

smoke 通过后，方可在独立授权与文件所有权登记下实现 runner/bootstrap 与对应回归。实现后先跑 focused 自动化和 review，再根据 Task 8 当前门槛执行所需全量验证；D3-only Electron 验收须在改动后另行单独授权，不因本设计或 smoke 自动获批。自动化通过仍不等同于用户侧原生键鼠、IME、DPI、窄矮窗口、读屏或安装包人工验收。

## 6. 方案比较

| 方案 | 优点 | 局限 | 结论 |
|---|---|---|---|
| Browser-level CDP 自动附着 + 隔离 bootstrap gate | 能在 page 首脚本前安装监测；一个 flattened 连接统一承载所有窗口和自动化；严格 page-only 范围 | 依赖 Browser CDP 与 Electron 所带 Chromium 的具体协议能力；需要重构当前每窗口一个 socket 的 runner 客户端 | 推荐，须先以 Electron 44.2.0 协议 smoke 验证 |
| 主进程逐个使用 Electron WebContents debugger API | 可从窗口创建流程观察 WebContents | 窗口首次导航时序与 Runtime.enable 仍需证明；与现有外部 CDP UI 驱动并用可能造成调试器所有权/连接冲突，可能需要双路径维护 | 不选，除非 Browser CDP smoke 证明推荐方案不可用后重新设计 |
| preload/renderer 自行安装 error/unhandledrejection 监听 | 实现概念简单 | preload 与 bundle 首段之前仍有时序盲点；不能可靠覆盖初始同步脚本异常，也容易改变产品渲染行为 | 不满足目标 |

## 7. 外部协议参考

以下官方资料用于协议概念参考；CDP 的 tip-of-tree 版本会变化，实际验收必须以本项目 Electron 44.2.0 运行时 `/json/protocol` 和真实 smoke 为准。

- [Chrome DevTools Protocol：Browser endpoint 与协议概述](https://chromedevtools.github.io/devtools-protocol/)
- [Target 域：setAutoAttach、attachedToTarget、TargetFilter](https://chromedevtools.github.io/devtools-protocol/tot/Target/)
- [Runtime 域：runIfWaitingForDebugger](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-runIfWaitingForDebugger)
- [Electron command line switches：remote-debugging-port](https://www.electronjs.org/docs/latest/api/command-line-switches)

## 8. 规格自审记录

- 范围一致：只描述 Task 8 隔离 QA runner；未写成产品功能、D3 通过或代码已实现。
- 关键时序一致：bootstrap gate → Browser CDP auto-attach 就绪 → nonce 放行 → page Runtime.enable → resume → 自动化/关闭与聚合。
- 未验证协议事实被标为 smoke 前置条件；公开 TargetFilter 过滤器顺序单独写明。
- 失败分支均 fail closed；不能静默降级到 attach-later 路径。
- 用户已确认的窗口范围、非目标、重新授权 D3 条件无互相矛盾。
- 未发现占位符或未完成段落；设计仍需用户审阅后才能进入实施计划。
