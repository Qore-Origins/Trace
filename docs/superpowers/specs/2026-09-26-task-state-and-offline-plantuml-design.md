# 任务三态反馈与离线 PlantUML 服务设计

日期：2026-09-26

状态：用户已确认设计方向；书面规格待用户审阅
范围：Windows x64 桌面安装版；本文只定义设计，不代表已实现或已验证。

## 背景与现状

任务列表使用 `not_started → in_progress → done → in_progress` 的既有三态循环。第一次点击确实写入 `in_progress`，但 DOM class 是 `task-row in_progress`，样式却选择 `.task-row.doing`，所以进行中外观没有生效；第二次进入 `done` 才显出勾号和删除线。此任务只修复反馈，不改变状态机或计划数据格式。

注释阅读态已由 Muya 图表渲染器支持 Mermaid、Vega-Lite、PlantUML、Flowchart 和 Sequence；除 PlantUML 外，这些渲染器在应用本地运行。PlantUML 当前需要一个非空 Server URL，空值时显示离线提示。偏好存在 renderer 的 `pref-store`，Muya 编辑态和静态阅读态都消费 PlantUML Server 地址。

主进程当前在创建窗口前依次加载配置、激活计划库并启动 watcher/search，再注册 IPC 和创建窗口。窗口首帧因此可能等待非窗口服务。electron-builder 当前只收集 `out/**/*` 和 `package.json`，尚未为 Java 运行时及 PlantUML JAR 配置额外资源。

## 目标

1. 保留任务的三态循环，让第一次点击立即呈现明确的“进行中”反馈，并维持现有完成与回退动画。
2. 新安装在没有系统 Java、没有网络的 Windows x64 机器上，也能首次启动并渲染 PlantUML。
3. 由 Trace 管理 PlantUML 服务进程；先显示主窗口，再后台启动服务与其他耗时服务。
4. 默认仅本机处理注释源码；远程 PlantUML 服务仍可由用户显式选择，沿用现有 HTTP(S) 校验及外发提示。
5. 服务或图表失败时不阻塞主界面、不崩溃、不使注释不可编辑，并提供明确状态与重试路径。

## 非目标

- 不改变任务三态、完成数计算、计划文件格式或 task-state 合约。
- 不依赖用户预装 Java，不要求用户独立安装或手动启动 PlantUML Server。
- 不将 Mermaid、Vega、Flowchart、Sequence 等已有本地 renderer 再打包一份。
- 托管本地模式不支持从用户磁盘或互联网读取 PlantUML `!include`；随 JAR 提供的标准库是否可用，以离线集成测试确认。
- 规格阶段不合并现有 `codex/trace-task10-11` 与 main，也不推送或发布；源代码实施前先由用户决定继续扩展隔离分支或集成该分支。

## 方案比较与决定

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| 随包只带 PlantUML JAR，依赖系统 Java | 安装包增量较小 | 没有 Java 的用户无法使用 | 不满足离线首次安装要求 |
| 随包带完整 JDK/JRE 与 JAR | 完全自包含，兼容面宽 | 包含开发工具及不需要的模块，体积较大 | 不采用 |
| 随包带 PlantUML JAR 与裁剪后的 Java 运行时 | 离线自包含；不带编译器、调试器等开发工具 | 仍会增加安装包体积；需要维护运行时和许可证清单 | 采用 |

运行时由固定版本的 Eclipse Temurin OpenJDK 21 LTS 构建，使用 `jdeps` 分析依赖，再由 `jlink` 生成 Windows x64 自定义运行时。最终模块清单必须经过服务启动和图表渲染测试确认；不得凭经验省略动态加载依赖。安装包只带生成后的运行时和 JAR，不带 JDK 工具链。构建完成后实测并汇报安装包体积增量，不预设未经用户确认的硬性体积上限。

PlantUML 采用官方 LGPL 版 JAR，初始固定候选为 `1.2026.8`（规格日期时官方最新版本）；实现时核验 LGPL 构建确实支持 PicoWeb，并固定正式下载文件 SHA-256。保持 JAR 原样，并随应用提供许可证与第三方声明。该构建不包含嵌入式 GraphViz；实现测试需覆盖当前已有 PlantUML 注释样例和常见 UML 图。如果验收样例确实需要 GraphViz，再评估仅加入所需的最小依赖，不默认把完整 GraphViz 加进安装包。

依据：PlantUML 将 PicoWeb 内嵌在 JAR 中，仅需 Java 运行时与 JAR；其文档支持显式绑定 `127.0.0.1`。官方提供 LGPL 构建并说明未修改 JAR 的再分发与声明要求。Oracle 文档说明 `jlink` 可按模块及传递依赖构建自定义运行时；`jdeps` 可生成模块依赖清单。[PicoWeb](https://plantuml.com/picoweb)、[PlantUML 下载与许可](https://plantuml.com/download)、[PlantUML 许可 FAQ](https://plantuml.com/faq)、[Adoptium 许可](https://adoptium.net/what-we-do)、[jdeps](https://docs.oracle.com/en/java/javase/12/tools/jdeps.html)、[jlink](https://docs.oracle.com/en/java/javase/26/docs/specs/man/jlink.html)

## 设计一：任务列表状态反馈

- 保持 `TaskListCard` 当前的 `nextStatus` 与共享三态定义不变。
- 将进行中样式绑定到真实状态 `in_progress`，让圆环和标题颜色在第一次点击后立即变化；继续使用现有语义 token 和过渡，不引入硬编码颜色或新的状态。
- `done` 的勾号、删除线及 `done → in_progress` 回退保持原行为。
- 回归测试验证三次连续交互的状态序列与渲染 class；人工检查亮色、暗色及键盘焦点下的进行中反馈。

## 设计二：PlantUML 运行时与设置

### 用户设置与兼容

设置提供三种模式：

- **Trace 本地服务**：新安装默认模式，默认端口 `18080`，随 Trace 窗口显示后自动启动；用户可关闭或调整端口。
- **自定义服务**：保留现有 URL 输入与 HTTP(S) 校验；用户选择此项即明确同意将 PlantUML 源码发送给该地址。切换到远程时停止 Trace 本地子进程。
- **关闭**：不启动服务，PlantUML 区块显示离线状态；其他图表不受影响。

现有非空 `plantumlServer` 偏好迁移为“自定义服务”，不得改变其网络目标；空值迁移到本地服务，使升级后的默认体验与新安装一致。用户可在设置中关闭服务。新设置遵循现有偏好存储方式，并在应用启动时由 renderer 通过白名单 IPC 把“是否启用本地服务 + 端口”交给主进程；远程 URL 不传给本地服务进程。

设置显示 `stopped / starting / running / error` 状态、当前端口及重试入口。端口仅接受有效的非特权 TCP 端口；端口冲突时不自动改用未展示的端口，而是报错并允许用户修改，确保 renderer 使用的地址可预测。新设置项继续使用现有悬停 2 秒显示描述的交互。

### 服务生命周期与数据流

1. `app.whenReady()` 后只做窗口创建所需的轻量配置读取、注册 IPC 和创建 BrowserWindow；renderer 首屏先显示现有 `checking` 启动画面。
2. 窗口 `ready-to-show` 时先调用 `show()`。根目录激活、watcher/search 启动及本地 PlantUML 服务随后在后台进行。
3. `app:bootstrap` 在核心根目录初始化完成后返回 onboarding/workspace 状态；search 的全量索引继续按现有异步状态更新，不阻挡窗口出现。PlantUML 就绪不作为 workspace 解锁条件。
4. renderer 完成偏好恢复后发送本地服务配置。主进程 `PlantUmlService` 仅在窗口可见且选择本地模式时启动一个子进程；重复配置幂等。服务状态通过受限 IPC 返回并广播给 renderer。
5. 服务 `running` 后，renderer 将本地 Base URL 设为 `http://127.0.0.1:<port>/plantuml`，匹配 PicoWeb 的 `/plantuml/svg/...` 路径。静态阅读态和活动 Muya 编辑态都使用同一运行状态；启动期间不提前发出必然失败的图片请求，服务转为 ready 后再渲染/刷新。
6. 模式切换为远程或关闭时，主进程停止本地子进程。应用退出时终止并回收子进程，不留下后台服务。

PicoWeb 以 `spawn` 启动打包资源中的 `bin/java.exe` 和 PlantUML JAR，绝不依赖 PATH 上的系统 Java；`shell: false`、隐藏窗口、参数分离传入，资源路径固定解析到打包资源目录。服务显式绑定 `127.0.0.1`，不用默认监听全部网卡。进程状态和有界健康检查由主进程持有；renderer 不接触文件系统或子进程。

建议的运行参数包含 `-Djava.awt.headless=true`、`-DPLANTUML_SECURITY_PROFILE=SANDBOX`、`-jar <固定版本的 PlantUML LGPL JAR>`、`-picoweb:<port>:127.0.0.1` 与显式关闭统计的 `-disablestats`；子进程标准输出不写入应用日志。PlantUML 官方说明 `SANDBOX` 禁止本地文件与 URL 访问；测试需验证内置标准库仍可用。若使用标准库必须突破此边界，则先停下复核安全方案，不降低为允许任意网络访问的配置。[PlantUML 安全配置](https://plantuml.com/security)、[统计选项](https://plantuml.com/statistics-report)

### 错误处理

- Java 运行时或 JAR 缺失/损坏：状态为 `error`，主窗口及非 PlantUML 功能可用；设置提供诊断，不提示安装系统 Java。
- 端口占用、子进程启动失败、启动超时或服务意外退出：状态显示可读错误码与重试；不记录图表源码，不把完整子进程输出写入应用日志。
- 服务正在启动时打开注释：显示“本地服务启动中”，不可因图片请求过早失败而永久空白；服务出错时显示本地失败态。
- 图表语法错误：只影响当前图表块，注释文字及编辑继续工作。
- 自定义远程模式沿用现有外发提示和协议校验，不把它称作离线模式。

## 测试与验收

### 自动验证

- 任务组件测试覆盖 `not_started → in_progress → done → in_progress`；第一步的 class 与状态样式 selector 一致。
- `PlantUmlService` 单测覆盖参数绑定、只启一个实例、状态变更、端口错误、启动超时、意外退出、停止与退出清理；配置输入校验拒绝非法端口/模式。
- IPC 与 renderer 测试覆盖设置迁移、启停/重试状态、就绪前不发请求、就绪后活动 Muya 与静态阅读态都刷新到本地 URL。
- runtime 构建测试检查固定版本、SHA-256、许可证文件和生成的运行时存在；集成脚本在禁网条件下启动 PicoWeb 并渲染固定 UML 样例。
- 项目全量门槛：`npm run typecheck`、`npm run test`、`npm run build`、`npm run build:win`。

### 用户视角验收

1. 在无系统 Java、网络断开的干净 Windows x64 环境安装；首次启动 Trace 后无需额外安装或手动开服务，即可渲染 PlantUML。
2. 窗口先显示加载壳，后台服务随后启动；慢启动或 PlantUML 失败不让窗口白屏，也不阻挡计划库进入可用状态。
3. 确认 PlantUML 服务只监听 `127.0.0.1`，默认不访问公共 PlantUML、不发统计；远程 URL 只有用户显式切换后才会接收源码。
4. 关闭 Trace 后确认子进程退出；端口冲突可在设置修复；禁用本地服务后普通注释和其他图表仍可编辑/查看。
5. 亮色/暗色主题下第一次点击任务明确显示“进行中”，后续完成与回退语义正确。
6. 构建后记录安装包体积与 v0.15.1 的实际增量；当前规格不把增量写成已测结果。

### 发布边界

本阶段只提交设计规格。功能实现完成并通过验收后，按用户已明确要求的发布流程执行：依据相对 v0.15.1 的功能跨度更新版本，更新变更日志，运行 typecheck/test/build:win，GitHub Release 上传 Windows 安装包，Gitee Release 只更新说明并链接 GitHub 下载，再核验两端发布内容；安装包不上传 Gitee。

## 当前协作边界

本规格阶段只修改本文件与 `docs/HANDOFF-CURRENT.md`。现有 `codex/trace-task10-11` 分支已经包含对 TaskListCard、卡片样式、主进程启动、Muya 和静态图表的提交修改；这些文件未在本规格阶段编辑。用户审阅规格后，再生成共享执行计划并登记源文件精确所有权；实现前必须先由用户决定该分支继续扩展还是先集成，避免与 main 或另一智能体的文件所有权冲突。
