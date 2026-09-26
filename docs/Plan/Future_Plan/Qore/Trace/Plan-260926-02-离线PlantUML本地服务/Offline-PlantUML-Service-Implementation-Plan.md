# 离线 PlantUML 本地服务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不依赖系统 Java 或网络的 Windows x64 新安装中，随 Trace 内置精简 Java 运行时与 PlantUML，窗口优先显示，再后台启动仅绑定本机的 PlantUML 服务；同时保留本地、用户自定义远程、关闭三种模式。

**Architecture:** 构建阶段校验并固定上游 JAR/JDK 的版本与 SHA-256，使用 jdeps/jlink 生成只含运行所需模块的资源目录，由 electron-builder 随应用打包。主进程通过绝对资源路径、无 shell 的 spawn 管理单一子进程；白名单 IPC 只传递启用标志和端口。renderer 在偏好恢复后选择本地/自定义/关闭模式，并让静态阅读态与 Muya 编辑态在服务就绪后用相同地址刷新。

**Tech Stack:** Electron 44、React 19、TypeScript 5、Node child_process/net、PlantUML LGPL 1.2026.8、Eclipse Temurin OpenJDK 21 LTS jlink runtime、electron-builder、Vitest。

---

## 已批准决策与范围

- 执行真规格：docs/superpowers/specs/2026-09-26-task-state-and-offline-plantuml-design.md。
- 新安装默认 Trace 本地模式，默认端口 18080；升级时旧 plantumlServer 非空值迁移到自定义远程模式，空值迁移到本地模式。
- 本地模式、用户自定义 HTTP(S) 模式、关闭模式是三种互斥选择。切换远程或关闭时停止本地子进程；远程地址仅保留在 renderer 偏好中，不进入本地服务配置。
- 默认不联网。PlantUML SANDBOX 禁止本地文件和 URL 访问，禁用统计；服务绑定 127.0.0.1，不使用系统 PATH 查找 Java，不依赖独立服务安装。
- 源码阶段继续在 codex/trace-task10-11 隔离分支，不合并 main、不提前推送。安装包体积增量须实测，不预设未确认的硬限制。

## 文件所有权

- 运行时资源构建：scripts/plantuml-runtime.lock.json、scripts/prepare-plantuml-runtime.mjs、.build/plantuml-runtime（生成目录）、.gitignore、package.json、electron-builder.yml。
- 主进程：src/main/services/plantuml-service.ts、src/main/services/startup-coordinator.ts、src/main/index.ts、src/main/ipc/register.ts。
- IPC 合约：src/shared/plantuml-types.ts、src/shared/ipc-contract.ts、src/shared/event-types.ts、src/preload/index.ts。
- renderer 偏好与设置：src/renderer/src/stores/pref-store.ts、src/renderer/src/App.tsx、src/renderer/src/i18n/locales/zh-CN.ts、src/renderer/src/i18n/locales/en-US.ts。
- 图表接入：src/renderer/src/components/cards.tsx、src/renderer/src/components/note-diagram.tsx、src/renderer/src/components/muya-note/MuyaNoteEditor.tsx、src/renderer/src/components/muya-note/muya-config.ts。
- 自动验证：test/plantuml-service.spec.ts、test/startup-coordinator.spec.ts、test/plantuml-preferences.spec.ts、test/plantuml-runtime-lock.spec.ts、test/plantuml-renderer.spec.ts、test/note-md.spec.ts、scripts/test-plantuml-runtime.mjs；不改 vendor/muya 源码。
- 发布闭环：package.json、package-lock.json、CLAUDE.md、docs/changelog/CHANGELOG.md、docs/lifecycle/05-部署上线 Deployment/发布说明 Release Notes.md、builds/release_notes/ 下以新 tag 命名的发行说明、builds/build_history.json、builds/release_history.json、builds/windows/、本计划、docs/Plan/README.md 与 HANDOFF-CURRENT.md。

本计划 plan.json 中的十个任务与下方十个编号步骤一一对应；步骤内复选框是执行子项。只有一个编号步骤的必需子项全部完成后，才把对应镜像任务标记 done；分阶段推进时标记 in_progress 并保留子项勾选状态。条件性分支只在触发时纳入完成判定。

## 执行步骤

### 1. 先建立偏好迁移与运行状态的失败测试

- [ ] 在 src/shared/plantuml-types.ts 定义 PlantUmlMode、PlantUmlServiceState 和状态 DTO；在 pref-store 中加入三模式、默认本地端口 18080、hydration 标记，保留已有 plantumlServer 字段。
- [ ] 在 test/plantuml-preferences.spec.ts 测试空存储新装默认、旧空 URL 升级默认本地、旧非空 URL 原样迁移到 custom、无效端口拒绝、切换模式不丢失旧远程地址。

    核心迁移断言：

        expect(migratePlantumlPreference({ plantumlServer: '' }).plantumlMode).toBe('local')
        expect(migratePlantumlPreference({ plantumlServer: 'https://plantuml.example/plantuml' })).toMatchObject({
          plantumlMode: 'custom',
          plantumlServer: 'https://plantuml.example/plantuml'
        })
        expect(() => validatePlantumlPort(1023)).toThrow()

- [ ] 先运行定向用例确认红灯，再实现纯迁移/端口校验函数；不得在 migrate 过程中把旧非空地址替换成 localhost。

    验证命令：

        npm run test -- test/plantuml-preferences.spec.ts

### 2. 锁定上游产物、运行时模块与许可证

- [ ] 新建 scripts/plantuml-runtime.lock.json，固定 PlantUML LGPL 1.2026.8 JAR 与 Temurin OpenJDK 21.0.12+8 Windows x64 JDK ZIP 的官方来源 URL、准确 SHA-256、版本、架构和经验证的 jlink 模块清单。
- [ ] 只从 PlantUML 官方下载页及 Adoptium 官方发布资产取产物；记录并核验原始文件 SHA-256，校验失败立即中止，不接受浮动 latest URL。
- [ ] 从原始发行包取得 PlantUML LGPL、Temurin/OpenJDK 与第三方声明文本，并纳入安装包的 LICENSES/ 目录；JAR 保持原样，不修改或重打包。
- [ ] 验证 LGPL 版具备本计划需要的 PicoWeb 与现有 UML 样例能力；默认不加入 GraphViz。
- 若验收图型缺失，先记录具体反例及所需最小依赖，再单独审查体积和许可。

    锁文件必须包含以下真实字段：PlantUML version/url/sha256、Temurin version/url/sha256、Windows x64 架构以及 jlink modules 数组。PlantUML 版本固定为 1.2026.8，Temurin 固定为 21.0.12+8；URL 指向这两个确切版本的官方发行文件，两个摘要必须与实际下载文件逐字节一致，模块数组写入 jdeps 分析并通过离线图表矩阵验证后的模块名，不使用 latest 或未核验值。

- [ ] 对照 PlantUML 官方 PicoWeb、下载/许可、安全文档，以及 Adoptium 对应发行页；把复核日期和上游地址写入锁文件/许可证说明。

### 3. 生成并验证最小运行时资源

- [ ] 新建 scripts/prepare-plantuml-runtime.mjs：下载到专用缓存目录，逐项核对锁文件 SHA-256，再解压固定 JDK 到临时目录。
- [ ] 用固定 JDK 的 jdeps 分析 JAR 模块；以经测试的准确模块表调用 jlink，启用 strip-debug、无头文件/手册和压缩；不得直接把整个 JDK 放入应用。
- [ ] 输出到 .build/plantuml-runtime，包含 jlink runtime、PlantUML JAR、许可证与 manifest；输出内必须有 bin/java.exe 和 manifest 校验信息。
- [ ] 脚本重复运行应校验并复用相同产物；输入下载损坏、版本/哈希不匹配、jlink 失败或关键文件缺失时非零退出。构建脚本只清理它自己拥有的 .build/plantuml-runtime 临时输出，不触碰用户文件。
- [ ] 将生成目录加入 .gitignore；新增 plantuml:prepare npm script。开发态路径可使用 .build/plantuml-runtime，打包态使用 process.resourcesPath/plantuml。
- [ ] 新建 test/plantuml-runtime-lock.spec.ts 验证锁文件版本/架构/sha256 格式，不联网下载产物；prepare 脚本负责强制验证生成目录中的 manifest、java.exe、JAR 与许可证，缺件必须非零退出。

    验证命令：

        npm run plantuml:prepare
        npm run test -- test/plantuml-runtime-lock.spec.ts
        .build/plantuml-runtime/bin/java.exe -version

### 4. 实现可注入、可测试的 PlantUML 子进程服务

- [ ] 新建 src/main/services/plantuml-service.ts，封装 configure/start/stop/retry/status；spawn、PlantUML 健康请求、计时器和资源路径解析通过依赖注入，以便单测不启动真实子进程；将已由 Muya 间接使用的 plantuml-encoder 声明为 package.json 直接运行依赖，保证主进程健康检查使用明确依赖。
- [ ] 子进程 executable 必须是应用资源目录中的绝对 bin/java.exe；shell:false、隐藏窗口、参数数组分离；服务参数包含 headless、SANDBOX、固定 JAR、-picoweb:<port>:127.0.0.1、-disablestats。
- [ ] 状态使用 stopped/starting/running/error；默认端口 18080，只接受 1024–65535；重复配置幂等；改端口时停止旧进程后只启动一个新进程。
- [ ] 限时轮询固定内部 UML 样例的本机 SVG 健康请求并确认 spawned child 仍存活；使用 plantuml-encoder 将固定样例编码后请求 127.0.0.1 的 /plantuml/svg/ 路径，只有预期 SVG 响应才进入 running，普通占用该端口的其他服务必须判为冲突。处理 runtime/JAR 缺失、spawn error、超时、非预期退出、重试和应用退出清理。
- [ ] 主进程日志仅记录状态码/端口/错误类别，不写图表源码、外部 URL 或子进程完整输出。

    单测必须覆盖的调用形态：

        const service = createPlantumlService({ spawn, checkPlantumlEndpoint, resolveResources })
        await service.configure({ enabled: true, port: 18080 })
        expect(spawn).toHaveBeenCalledWith(javaExe, expectedArgs, { shell: false, windowsHide: true, stdio: 'ignore' })
        await service.stop()

- [ ] 在 test/plantuml-service.spec.ts 覆盖单实例/idempotency、监听地址、参数、安全 profile、端口验证、状态广播、超时、进程异常退出、stop 幂等与退出回收。

    验证命令：

        npm run test -- test/plantuml-service.spec.ts

### 5. 增加严格白名单 IPC 与状态广播

- [ ] 在 src/shared/ipc-contract.ts 添加 plantuml:configure、plantuml:getStatus、plantuml:retry 合约；configure 请求仅允许 enabled 与 port，不接收 renderer 的 URL、Java 路径、JAR 路径或源码。
- [ ] 在 src/shared/event-types.ts 增加 trace:plantuml-status 状态事件；在 src/preload/index.ts 增加 plantuml: 前缀和唯一事件白名单。
- [ ] 在 src/main/ipc/register.ts 注入 PlantUmlService、注册三条通道并把服务状态转发给窗口；handler 统一走当前 TraceResult 包装。
- [ ] 增加 IPC 合约测试：未白名单通道仍拒绝，服务配置载荷无法携带额外路径/远程地址；窗口关闭后不向已销毁 webContents 推送。

    验证命令：

        npm run test -- test/plantuml-service.spec.ts
        npm run typecheck

### 6. 将主窗口首显移到重型服务之前

- [ ] 新建 src/main/services/startup-coordinator.ts，显式提供 onWindowShown、waitForBootstrap 与后台启动顺序；在窗口显示前，根目录激活和 PlantUML 只能排队，不能被 await 到创建窗口链路。
- [ ] 调整 src/main/index.ts：保留必要的轻量 config.load；先注册 IPC、创建隐藏 BrowserWindow 并加载 renderer；ready-to-show 回调第一步 show()，随后释放启动协调器开始 appService.activateConfiguredRoot，PlantUML 配置也只能在窗口已显示后执行。
- [ ] 在 src/main/ipc/register.ts 让 app:bootstrap 等待根目录核心激活 Promise，再返回 onboarding/workspace 信息；不能因 PlantUML 启动或 search 全量索引阻塞进入应用。
- [ ] window-all-closed、before-quit 与服务 configure/retry 路径统一 stop PlantUML child；配置服务失败不得抛穿主窗口启动链路。
- [ ] 在 test/startup-coordinator.spec.ts 用可控 Promise 证明顺序为 window.show → root activation → 后台服务；证明 bootstrap 等 root activation、PlantUML 不作为 bootstrap 门槛。

    目标调用顺序：

        window.once('ready-to-show', () => {
          window.show()
          startup.onWindowShown()
        })
        await startup.waitForRootActivation()
        return appService.bootstrap()

- [ ] 运行 coordinator 单测、完整 typecheck 与主进程相关测试，确认 startup Promise 不会因服务失败永久 pending。

    验证命令：

        npm run test -- test/startup-coordinator.spec.ts test/plantuml-service.spec.ts
        npm run typecheck

### 7. 迁移偏好并扩展设置界面

- [ ] 在 src/renderer/src/stores/pref-store.ts 为已有 persist 配置加明确版本迁移与 hydrated 标记；未完成 hydration 前不得用默认本地模式覆盖旧非空 PlantUML Server。
- [ ] 在 src/renderer/src/App.tsx 设置弹窗用三态 Radio/Segmented 选择器表达「Trace 本地服务 / 自定义服务 / 关闭」；本地模式提供端口与 stopped/starting/running/error 状态、重试；自定义模式显示原 URL 输入；关闭模式不显示可误解为离线远程的 URL 字段。
- [ ] 保留 validatePlantumlServer 的 HTTP(S) 校验与远程外发提示；模式切换不清除 plantumlServer 草稿。renderer 恢复旧非空 URL 时保持原目标，明确仍为用户显式自定义服务。
- [ ] 本地设置 hydration 完成后才 IPC 配置服务；状态先读 getStatus，再监听 trace:plantuml-status，避免首次状态事件早于订阅造成 UI 永远停在旧值。
- [ ] 在 zh-CN.ts/en-US.ts 增加全部模式、服务状态、端口错误/冲突、启动中、重试、远程隐私与离线描述文案；配置项延续现有 Tooltip mouseEnterDelay=2 和主题语义 token。
- [ ] 在 test/plantuml-preferences.spec.ts 覆盖新装、旧配置迁移、hydration 前不启动、切模式启停调用，以及本地端口修改。

    验证命令：

        npm run test -- test/plantuml-preferences.spec.ts test/accessibility-contract.spec.tsx
        npm run typecheck

### 8. 让阅读态和 Muya 编辑态共享服务就绪状态

- [ ] 在 cards.tsx 从偏好与本地服务状态派生唯一 plantumlServer：本地 running 时为 http://127.0.0.1:<port>/plantuml；custom 时为已校验 URL；off、starting、error 时不构造可发送源码的 URL。
- [ ] 在 note-diagram.tsx 增加 disabled/starting/service-error 展示状态；本地服务 running 前不调用 renderer、不发图片请求；收到 running 或 error 变化后静态图表按当前代码重新判定。
- [ ] 在 MuyaNoteEditor.tsx 使用现有 setOptions(..., true) 在服务 ready/error、模式或 URL 改变时刷新 Muya 文档；服务启动中的 PlantUML 块显示明确等待/失败态，不阻止 Muya 内容编辑。不得修改 vendor/muya 源文件或其指纹。
- [ ] 在 muya-config.ts 保留 URL 的协议验证；仅 local running 和 custom 模式可传非空地址；remote 地址不得进入 IPC configure。
- [ ] 在 test/plantuml-renderer.spec.ts 确认 PlantUML 不 ready 时静态路径不创建请求、ready 后本地 URL 命中 /plantuml/svg、custom 不被重写、关闭模式不请求；Muya 的 setOptions 只在状态变化后强制重渲染。
  - [ ] 在 test/note-md.spec.ts 保持既有 Markdown/图表块解析回归覆盖。

    验证命令：

        npm run test -- test/note-md.spec.ts test/plantuml-renderer.spec.ts test/muya-note-integration.spec.tsx
        npm run typecheck

### 9. 加入 electron-builder 资源并跑完整自动门槛

- [ ] 在 electron-builder.yml 将 .build/plantuml-runtime 作为 extraResources 打包到 resources/plantuml；确认 ASAR 外资源路径使用 process.resourcesPath，不通过相对工作目录寻找。
- [ ] 更新 package.json build:win 先执行 npm run plantuml:prepare，再执行 electron-vite build 与 electron-builder；普通 typecheck/test 不下载 Java/JAR，不依赖网络。
- [ ] 执行 scripts/test-plantuml-runtime.mjs：启动随包 runtime 的 PicoWeb，以固定内部样例请求 127.0.0.1 上的 PlantUML SVG；验证不需公共网络、服务不绑定其他网卡、SANDBOX 拒绝本地/外部 URL include、统计关闭、子进程停止后端口释放。此集成命令要求先 prepare；普通 npm run test 仅验证锁文件与 mock 服务，不下载或要求生成运行时。
- [ ] 运行完整门槛并核对 Windows x64 安装包内 bin/java.exe、PlantUML JAR、最小模块清单和许可证；与 v0.15.1 已归档安装包比较并记录字节增量与 SHA-256。

    验证命令：

        npm run typecheck
        npm run test
        npm run build
        npm run build:win

### 10. 按用户已授权的发布流程交付

- [ ] 所有自动验证通过、Electron 窗口首显/离线渲染 smoke test 通过后，根据相对 v0.15.1 的功能跨度确定版本递增，不机械只加一个 patch；同步 package.json、package-lock.json、CLAUDE.md 当前版本行、docs/changelog/CHANGELOG.md、lifecycle 发布说明和本计划。
- [ ] 将当前 Codex 隔离分支中的既有实现与本批提交完整核对后再合入 main；保留用户未跟踪 Resource/pic/、Resource/vid/，禁止覆盖或清理。
- [ ] 构建并归档 Windows x64 安装包到 builds/windows/ 并记录 SHA-256；更新 builds/build_history.json、builds/release_notes/ 下以实际新 tag 命名的发行说明、builds/release_history.json 与 docs/lifecycle/05-部署上线 Deployment/发布说明 Release Notes.md。GitHub Release 上传安装包，Gitee Release 仅发布相同说明并链接 GitHub，不上传超过 100 MB 的安装包。
- [ ] 通过 SSH 推送授权分支/主分支与版本 tag；核验 GitHub 资产摘要、Gitee Release 说明及双端 tag/commit，再回填 Markdown、plan.json、docs/Plan/README.md 与 HANDOFF 的提交和真实结果。
- [ ] 若缺少可验证的 GitHub/Gitee 身份或发布 API 权限，停止在打包归档处，明确指出未推送/未发布部分，不将其标成完成。

    发布前命令：

        npm run typecheck
        npm run test
        npm run build
        npm run build:win

## 完成标准

- 无系统 Java、首次安装、断网时 PlantUML UML 样例渲染成功；主窗口不等待 Java/JAR 服务启动。
- 本地服务只绑定 127.0.0.1，源码默认不发往外网，停止/退出会回收进程；错误仅影响 PlantUML，不影响其他图表和编辑。
- 新装默认本地，旧非空 URL 保持自定义远程目标，设置中三态、端口、状态和重试均可用；静态态和 Muya 态行为一致。
- 提供可核验的 PlantUML/Temurin 版本、来源、SHA-256、许可证和安装包增量。
- 全量 typecheck/test/build/build:win 通过；GitHub Release 含安装包，Gitee Release 只有说明与 GitHub 链接；远端内容已实测核验。
- 逐项同步同目录 plan.json、docs/Plan/README.md 和 HANDOFF；不得把规格、计划、实现、自动验证和人工/发布验收混写为同一状态。
