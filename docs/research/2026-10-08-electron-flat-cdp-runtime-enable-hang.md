# Electron 44.2.0 flattened CDP 中 Runtime.enable 无响应：官方资料调查

- 调研日期：2026-10-08
- 范围：Electron 44.2.0 所带 Chromium/CDP；page target 通过 Browser WebSocket 的 flattened session 自动附着并保持 paused 时，Runtime.enable 无响应的官方解释。
- 方法：只读检索 Electron 官方发布记录、Electron 官方仓库 issue、Chrome DevTools Protocol 官方规范与仓库、Chromium/V8 官方源码及 Chromium issue tracker。未运行脚本或 Electron，未执行任何代码。

## 结论

查到的官方规范说明了 flattened session 如何寻址，以及 waitForDebuggerOnStart 如何暂停 target；V8 Runtime.enable 源码说明其内部启用执行上下文报告的流程。但这些资料没有说明“paused page 的 Runtime.enable 应当无响应”，也没有解释本机所见的约 6 秒超时。

截至调研日期，在检索的公开 Electron 和 Chromium 官方 issue 中，**未找到直接匹配“Browser.getVersion 正常、同一 Browser WebSocket 上 paused flattened page session 的 Runtime.enable 静默 pending/超时”的 issue；未找到直接根因**。查到四个相邻但症状不同的 issue，见下文，不能据此归因本机现象。

## 检索记录

- 日期：2026-10-08。
- 检索范围：Electron v44.2.0 发布页；Electron GitHub issue tracker；Chrome DevTools Protocol viewer 与官方 protocol repository；Chromium Gitiles/source.chromium.org；Chromium issue tracker。
- 关键词：Electron 44.2.0、Chromium 152.0.7977.76、Runtime.enable、waitForDebuggerOnStart、Target.setAutoAttach、flatten、page session、executionContextCreated、timeout、no response、paused target。
- 版本基线：[Electron v44.2.0 发布记录](https://releases.electronjs.org/release/v44.2.0) 标明该版本使用 Chromium 152.0.7977.76、V8 15.2.124.19。

## 已知本机观测

以下内容来自任务提供的脱敏观察，本轮没有复跑：

- 单个隐藏 page target，paused=true。
- Runtime.enable 约 6 秒超时。
- 同一 Browser WebSocket 上 Browser.getVersion 约 20 ms 成功。
- WebSocket 状态为 OPEN。
- Runtime.executionContextCreated 计数为 0。
- Root cause unknown。

## 规格事实

1. Target.setAutoAttach 的 waitForDebuggerOnStart 定义为附着时暂停新 target；协议文档指出用 Runtime.runIfWaitingForDebugger 运行被暂停的 target。flatten=true 则允许在命令中通过 sessionId 访问 session。Target.attachedToTarget 事件也带有 waitingForDebugger 状态。[Target protocol：setAutoAttach](https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-setAutoAttach) · [Target protocol：attachedToTarget](https://chromedevtools.github.io/devtools-protocol/tot/Target/#event-attachedToTarget)
2. Runtime.enable 的协议职责是启用 executionContextCreated 报告；对已存在的执行上下文，启用后会立即发送该事件。[Runtime protocol：enable](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-enable)
3. 上述规范没有定义 Runtime.enable 在 paused target 上必须等待恢复，也没有规定该命令在此状态下应超时或保持 pending。因此，协议文本本身不能解释本机无响应。
4. 当前 tip-of-tree 文档会持续变化；本节描述的是调研时可访问的官方协议文档，不等同于对 Electron 44.2.0 内嵌协议 JSON 的逐字版本核对。

## 源码事实

- Electron 发布记录将 44.2.0 对应到 Chromium 152.0.7977.76。
- Chromium TargetHandler 的当前官方源码快照显示，flattened 自动附着会建立 child session；waiting 标志会创建 resume callback，并随 Target.attachedToTarget 事件发出。[附着流程](https://chromium.googlesource.com/chromium/src/+/e05470d76d365cfce9ff5261b914950337763934/content/browser/devtools/protocol/target_handler.cc#L403) 相同文件的导航处理注释还区分 Tab 与 Page target：waitForDebuggerOnStart 在该导航路径中对 Tab 生效、对 Page 忽略。[导航处理注释](https://chromium.googlesource.com/chromium/src/+/e05470d76d365cfce9ff5261b914950337763934/content/browser/devtools/protocol/target_handler.cc#L755)
- 上述 target 类型区分属于当前源码快照；本次没有把它映射到 Electron 44.2.0 所固定的 Chromium revision。它表明需要按具体 target 类型和生命周期理解等待状态，但不能解释本机观测，也不能据此否定任务提供的 paused=true 观察。
- Chromium DevToolsSession 源码按传入消息的 sessionId 查找 child session，并将协议命令分派到对应 session。该路由逻辑区分了 Browser root command 与 flattened child-session command；它不能单独证明某条命令已到达 renderer 或已从 renderer 收到响应。[Chromium DevToolsSession 源码快照](https://chromium.googlesource.com/chromium/src/+/c7ce80628782117c4044a8a4f20d50ff58bba7fb/content/browser/devtools/devtools_session.cc)
- V8 Runtime agent 的源码实现中，enable 会请求确保 context group 的上下文、标记 Runtime agent 为 enabled、报告已存在的 contexts，最后返回 Response::OK()。[V8 Runtime agent 源码快照](https://chromium.googlesource.com/v8/v8/+/6808ec1f83435c365db196313370c35e5f51147d/src/inspector/v8-runtime-agent-impl.cc#662)
- 上述 Chromium/V8 源码链接是官方仓库中的源码快照，不是本次已映射到 Electron 44.2.0 所固定 Chromium/V8 revision 的源码链接。因此它们用于解释实现结构，不能当作该 Electron 二进制精确构建源码的逐行证明。

## 官方 issue 核对

| 来源 | 与现象的关系 | 为什么不是直接根因 |
|---|---|---|
| [Electron issue 14810：Debugger.sendCommand 回调要等窗口加载后才完成](https://github.com/electron/electron/issues/14810) | Electron 3.0.0 / Windows 7 的报告中，`webContents.debugger.sendCommand('Page.enable')` 在 `loadURL()` 之前发出，回调直到五秒后触发导航才返回。当前 Electron API 文档也说明，目标尚未导航时发送命令，promise 可能要等导航发生才完成。[Electron Debugger API](https://www.electronjs.org/docs/latest/api/debugger) | 这是最值得继续验证的生命周期线索，但旧 issue 用的是 Electron 内嵌 `webContents.debugger` 传输、`Page.enable` 和 Electron 3，不是当前 Electron 44.2.0 的 Browser WebSocket flattened `Runtime.enable`。当前 probe 的隐藏 `BrowserWindow` 没有调用 `loadURL`，但这个相似性不足以证明两条命令路径相同或确定了根因。 |
| [Electron issue 35318：首个导航延迟时未发出 Target.attachedToTarget](https://github.com/electron/electron/issues/35318) | Electron 14+ 的 issue 报告使用 autoAttach=true、waitForDebuggerOnStart=true、flatten=true；首个导航延迟时缺少附着事件，Playwright 的 firstWindow() 因而挂起。 | 故障发生在 Target.attachedToTarget 缺失，而不是已附着 page session 的 Runtime.enable 未响应。该 issue 已关闭为 not planned，属于相邻 Electron/CDP 生命周期案例。 |
| [Chromium issue 339596719：CDP 下打开新窗口后停在 about:blank](https://issues.chromium.org/issues/339596719) | 报告中使用 flattened auto-attach、waitForDebuggerOnStart=true，并在 page session 序列中发送 Runtime.enable。 | 报告的症状是点击 target=_blank 后新窗口没有继续导航；没有报告 Runtime.enable 本身无响应，也没有本机所见的 Browser.getVersion 对照。issue 状态为 Can't Repro / Won't Fix（Not Reproducible），故只是相邻案例。 |
| [Electron issue 54149：44.x 沙盒扩展后台页的初始空文档异常](https://github.com/electron/electron/issues/54149) | issue 报告指出，Electron 44.3.0 上对特定 sandboxed extension background/offscreen page 在首个 navigation commit 前启用 Runtime，会创建初始空文档的脚本上下文并触发 Electron sandbox bundle 的 console exception。 | 报告的 Runtime.enable 会触发可见 console error，之后已提交页面仍正常加载；没有报告 CDP 命令 pending 或无响应。场景限于扩展后台页/offscreen 文档，不能推定为普通隐藏 page 的原因，也不是 Chromium 根因。 |

## 可操作但未验证的线索

- 对隔离 probe 源码的只读检查显示，它创建 `new BrowserWindow({ show: false, ... })`，未调用 `loadURL()`；probe 报告的 `urlCategory=missing` 只是粗粒度采集类别，不足以断言真实 URL。也就是说，测试目标可能仍处在 Electron 窗口的初始未导航生命周期。
- Electron 当前 `Debugger` API 文档确实说明：通过 `webContents.debugger.sendCommand()` 在 target 导航前发送命令，返回 promise 可能不会在导航发生前 resolve；Electron issue 14810 的历史复现展示了 `Page.enable` 回调在随后 `loadURL()` 才完成。这为“pre-navigation 初始化/导航时序可能参与挂起”提供了可测试假设。[Electron Debugger API](https://www.electronjs.org/docs/latest/api/debugger) · [Electron issue 14810](https://github.com/electron/electron/issues/14810)
- **不能外推为本机根因：** 本机走的是 Browser-level WebSocket 的 flattened page session，不是 `webContents.debugger.sendCommand()`；等待的是 `Runtime.enable`，历史 issue 等待的是 `Page.enable`；Electron 版本相隔多个主版本，而且本机 target 同时带 `waitingForDebugger=true`。必须通过新的、有明确授权的对照实验验证，不能按该文档改变正式 smoke 或宣称已定位。
- 若后续获准验证，应先设计一个只改变初始导航时序、其余保持不变的隔离差分 probe，并继续避免触碰产品 runner/bootstrap 与已保留 fixture。当前这次运行授权已耗尽，本文不授权新一轮 Electron 执行。

## 推论与边界

- Browser.getVersion 在同一 WebSocket 成功，说明该连接及 Browser root command 路径在该时刻可响应；这不能证明带 sessionId 的 Runtime.enable 已被正确路由到 page agent，也不能证明 renderer 对它作出了处理。
- executionContextCreated=0 只说明本次采集期间没有观察到该事件；结合 Runtime.enable 未获响应，不能单凭事件计数定位问题发生在 CDP client、Browser session 路由、DevTools agent、renderer 初始化或事件返回中的哪一层。
- 现有观察与官方资料之间的差异仍未解释。基于本次一手资料检索，准确结论是：**存在相关规范、相邻 issue 与一个值得差分验证的 pre-navigation 线索，但未找到直接根因；root cause remains unknown。**
