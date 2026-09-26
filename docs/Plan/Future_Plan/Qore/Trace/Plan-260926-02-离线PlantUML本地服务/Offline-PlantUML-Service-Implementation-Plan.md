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
- 实现阶段在 `codex/trace-task10-11` 隔离分支完成；用户现已明确授权进入 v0.17.0 发布闭环。按实测的安装包体积、SHA-256 和 runtime 验收推进合入与推送，不预设未确认的体积硬限制。

## 文件所有权

- 运行时资源构建：scripts/plantuml-runtime.lock.json、scripts/prepare-plantuml-runtime.mjs、.build/plantuml-runtime（生成目录）、.gitignore、package.json、electron-builder.yml。
- 主进程：src/main/services/plantuml-service.ts、src/main/services/startup-coordinator.ts、src/main/index.ts、src/main/ipc/register.ts。
- IPC 合约：src/shared/plantuml-types.ts、src/shared/ipc-contract.ts、src/shared/event-types.ts、src/preload/index.ts。
- renderer 偏好与设置：src/renderer/src/stores/pref-store.ts、src/renderer/src/App.tsx、src/renderer/src/i18n/locales/zh-CN.ts、src/renderer/src/i18n/locales/en-US.ts。
- 图表接入：src/renderer/src/components/cards.tsx、src/renderer/src/components/note-diagram.tsx、src/renderer/src/components/muya-note/MuyaNoteEditor.tsx、src/renderer/src/components/muya-note/muya-config.ts。
- 自动验证：test/plantuml-service.spec.ts、test/startup-coordinator.spec.ts、test/plantuml-preferences.spec.ts、test/plantuml-runtime-lock.spec.ts、test/plantuml-renderer.spec.ts、test/note-md.spec.ts、scripts/test-plantuml-runtime.mjs；不改 vendor/muya 源码。
- 发布闭环：package.json、package-lock.json、CLAUDE.md、docs/changelog/CHANGELOG.md、docs/lifecycle/05-部署上线 Deployment/发布说明 Release Notes.md、builds/release_notes/ 下以新 tag 命名的发行说明、builds/build_history.json、builds/release_history.json、builds/windows/、本计划、docs/Plan/README.md 与 HANDOFF-CURRENT.md。

本计划 plan.json 中的十个核心实施任务与下方十个编号步骤一一对应；步骤内复选框是执行子项。审查发现问题后的专项 follow-up 可在两处单独追加。只有一个编号步骤的必需子项全部完成后，才把对应镜像任务标记 done；分阶段推进时标记 in_progress 并保留子项勾选状态。条件性分支只在触发时纳入完成判定。

## 当前实施状态（2026-09-26）

- 步骤 1 已完成：`/root/plantuml_preferences` 提交 `343ff18355eb840bbc485c50e1871350273f53fa` 与 `c156d69efbc8927f92ffa039ed4c367bd43fe9f3`，负责 `src/shared/plantuml-types.ts`、`src/renderer/src/stores/pref-store.ts`、`test/plantuml-preferences.spec.ts`；规格与质量复审均通过，文件边界已释放。验证：定向测试 8/8、`npm run test` 31 files / 270 tests passed、`npm run typecheck` 通过、`git diff --check` 通过。
- 步骤 2 已由 `/root/plantuml_artifact_lock` 提交 `79acec82929643b5020fbb09ba033ce0b7677e6b`，仅含登记的四个 lock/license 文件；独立规格和质量复审均通过，文件边界已释放。已验证两项固定资产字节数/SHA 与锁一致、Temurin 官方 sidecar 匹配；固定 JDK 的 `jdeps` 输出与 modules 根数组一致；44 个 Temurin legal 文件与两个 PlantUML 上游许可段内容核验通过；隔离 PicoWeb/SANDBOX 图表 smoke 返回 HTTP 200 和 2,101 字节 SVG，监听端口释放。lock 中 `modules` 暂表示 jdeps roots；精简 jlink image 的模块充分性必须在步骤 3 实测，不能把当前候选表描述为 runtime 已验证。
- 步骤 3 由 `/root/plantuml_runtime_prep` 实施，文件边界为 `scripts/prepare-plantuml-runtime.mjs`、`test/plantuml-runtime-lock.spec.ts`、`.gitignore`、`package.json`、生成目录 `.build/plantuml-runtime/`；若 jlink 离线 smoke 证明候选根模块不足，可只调整 `scripts/plantuml-runtime.lock.json` 的 `modules` 字段并在交接记录证据。其余 lock 字段、许可证文件、共享计划和 HANDOFF 不在该子代理边界内。
- 临时下载/解压目录 `C:\Users\aaa\AppData\Local\Temp\trace-plantuml-step2-bc5cc206b79e4b8bb85398285d01f888` 仅包含本步骤生成/下载内容；执行器拒绝清理，暂定步骤 3 完成后复核清理。

## 执行步骤

### 1. 先建立偏好迁移与运行状态的失败测试

- [x] 在 src/shared/plantuml-types.ts 定义 PlantUmlMode、PlantUmlServiceState 和状态 DTO；在 pref-store 中加入三模式、默认本地端口 18080、hydration 标记，保留已有 plantumlServer 字段。
- [x] 在 test/plantuml-preferences.spec.ts 测试空存储新装默认、旧空 URL 升级默认本地、旧非空 URL 原样迁移到 custom、无效端口拒绝、切换模式不丢失旧远程地址。

    核心迁移断言：

        expect(migratePlantumlPreference({ plantumlServer: '' }).plantumlMode).toBe('local')
        expect(migratePlantumlPreference({ plantumlServer: 'https://plantuml.example/plantuml' })).toMatchObject({
          plantumlMode: 'custom',
          plantumlServer: 'https://plantuml.example/plantuml'
        })
        expect(() => validatePlantumlPort(1023)).toThrow()

- [x] 先运行定向用例确认红灯，再实现纯迁移/端口校验函数；不得在 migrate 过程中把旧非空地址替换成 localhost。

    验证命令：

        npm run test -- test/plantuml-preferences.spec.ts

步骤 1 完成记录：先红后绿；定向测试 8/8；完整 `npm run test` 31 files / 270 tests、`npm run typecheck`、`git diff --check` 均通过。独立规格审查与质量审查通过；修复了无效持久化 mode/port 可绕过 setter merge 的问题，并在测试后清理模块级 store 状态。提交：`343ff18355eb840bbc485c50e1871350273f53fa`、`c156d69efbc8927f92ffa039ed4c367bd43fe9f3`。

### 2. 锁定上游产物、运行时模块根清单与许可证

- [x] 新建 scripts/plantuml-runtime.lock.json，固定 PlantUML LGPL 1.2026.8 JAR 与 Temurin OpenJDK 21.0.12+8 Windows x64 JDK ZIP 的官方来源 URL、准确 SHA-256、版本、架构和 jdeps 根模块清单；精简 runtime 的充分性留到步骤 3 验证。
- [x] 只从 PlantUML 官方下载页及 Adoptium 官方发布资产取产物；记录并核验原始文件 SHA-256，校验失败立即中止，不接受浮动 latest URL。
- [x] 从原始发行包和官方源取得 PlantUML LGPL、Temurin/OpenJDK 与第三方声明文本，并保存供后续安装包 LICENSES/ 目录复制；JAR 保持原样，不修改或重打包。
- [x] 用固定 UML 样例验证 LGPL 版 PicoWeb；默认不加入 GraphViz。最小 jlink image 的模块/图表矩阵验证属于步骤 3。
- 若验收图型缺失，先记录具体反例及所需最小依赖，再单独审查体积和许可。

    锁文件必须包含以下真实字段：PlantUML version/url/sha256、Temurin version/url/sha256、Windows x64 架构以及 jlink 根模块数组。PlantUML 版本固定为 1.2026.8，Temurin 固定为 21.0.12+8；URL 指向这两个确切版本的官方发行文件，两个摘要必须与实际下载文件逐字节一致。根模块数组写入固定 JDK jdeps 实测结果；能否构成足够且最小的 jlink runtime，由步骤 3 的裁剪运行时离线图表 smoke 最终验证。无 latest 或未核验值。

- [x] 对照 PlantUML 官方 PicoWeb、下载/许可、安全文档，以及 Adoptium 对应发行页；把复核日期和上游地址写入锁文件/许可证说明。

步骤 2 完成记录：提交 `79acec82929643b5020fbb09ba033ce0b7677e6b`；独立规格审查与质量审查通过。锁 JSON、固定资产实际 SHA-256/字节数及 Temurin 官方 sidecar、jdeps roots、44 份 Temurin legal 文本与 2 段 PlantUML 许可文本、PicoWeb/SANDBOX HTTP 200 / 2,101-byte SVG smoke 均已验证。jlink runtime 模块充分性和安装包尚未验证，归入步骤 3 与步骤 9 验收。

### 3. 生成并验证最小运行时资源

- [x] 新建 scripts/prepare-plantuml-runtime.mjs：下载到专用缓存目录，逐项核对锁文件 SHA-256，再解压固定 JDK 到临时目录。
- [x] 用固定 JDK 的 jdeps 分析 JAR 模块；以经测试的准确模块表调用 jlink，启用 strip-debug、无头文件/手册和压缩；不得直接把整个 JDK 放入应用。
- [x] 输出到 .build/plantuml-runtime，包含 jlink runtime、PlantUML JAR、许可证与 manifest；输出内直接有 bin/java.exe 和 manifest 校验信息。
- [x] 脚本重复运行校验 manifest/逐文件哈希并复用相同产物；下载损坏、版本/哈希不匹配、jlink 失败或关键文件缺失时非零退出。清理限定于带归属标记的本步骤目录与白名单，不覆盖未知输出或用户文件。
- [x] 将生成目录加入 .gitignore；新增 plantuml:prepare npm script。普通测试与 typecheck 不触发下载。
- [x] 新建 test/plantuml-runtime-lock.spec.ts 验证锁文件版本/架构/sha256 格式，不联网下载产物；prepare 脚本校验生成目录中的 manifest、java.exe、JAR 与许可证。
- [x] 使用刚构建的 jlink image 完成隔离离线 smoke：仅调用 `.build/plantuml-runtime/bin/java.exe` 启动 PicoWeb，绑定 127.0.0.1，以固定 UML 样例取得有效 SVG；不调用系统 Java、不依赖外网或 GraphViz PATH。记录 jdeps roots 无需调整即通过；修复后的监听校验要求目标 PID/端口的全部 TCP LISTENING 本地地址严格为 127.0.0.1。

    验证命令：

        npm run plantuml:prepare
        npm run test -- test/plantuml-runtime-lock.spec.ts
        .build/plantuml-runtime/bin/java.exe -version

步骤 3 实施记录（规格审查发现 minor 待修，质量审查尚未开始）：提交 `12d8dd838b20de02e2667821c47215a6053da8e7`，仅包含 `.gitignore`、`package.json`、`scripts/prepare-plantuml-runtime.mjs`、`test/plantuml-runtime-lock.spec.ts`。`npm run plantuml:prepare` 首次构建成功，第二次通过 manifest 和逐文件 SHA-256 验证后复用；实际运行时共 66,542,936 bytes，其中 jlink image 48,584,554 bytes / 145 files。固定 PlantUML JAR SHA-256 为 `99e271611aa65a2319c0a4502ae9a4289f02933fdcc4f96a4e2f62a9b4e5b4ce`，Temurin JDK ZIP 为 `9ba963ee2371874a74185d18bc7bb2ab9407df7683300855ed7606e0662321d0`；两项实际字节数与锁一致，jdeps roots 与 lock 一致。最终路径 `.build/plantuml-runtime/bin/java.exe` 在隔离 PATH（仅 System32）、无 GraphViz PATH/外网的条件下启动 PicoWeb/SANDBOX/-disablestats，监听 `127.0.0.1:53417`；固定 UML smoke 返回 HTTP 200 与有效 2,537-byte SVG，PID 27172 退出、端口释放、smoke 目录清理。验证：`npm run test -- test/plantuml-runtime-lock.spec.ts` 5/5；`npm run typecheck` node/web 通过；`npm run test` 32 files / 275 tests passed；`git diff --check` 通过（`.gitignore` 存在 LF→CRLF 警告）。规格审查指出监听检测只排除 wildcard，没有断言该 PID/端口不存在另一具体网卡地址上的附加 listener；原实现代理 `/root/plantuml_runtime_prep` 重新获得 `scripts/prepare-plantuml-runtime.mjs` 与对应测试文件所有权，补充回归验证后提交，再重新进行规格与质量审查。步骤 3 临时缓存/暂存目录已清理；步骤 2 历史临时验证目录仍待安全复核与清理。

步骤 3 规格问题修复追加记录：`66eb291cdcff932615c9da069fae4faa3a87cc16` 仅改 prepare 脚本与测试。新增纯解析回归覆盖同 PID/目标端口的 `192.168.*` 监听拒绝，以及其他 PID/端口/非 LISTENING 不误判；定向测试先红后绿为 7/7。重新验证 `node --check`、`npm run plantuml:prepare` manifest 复用、实际 `--smoke`（HTTP 200 / 有效 2,537-byte SVG，`127.0.0.1:51558`，PID 26984 退出且端口回收）、`npm run typecheck`、`npm run test` 32 files / 277 tests、`git diff --check` 均通过。独立规格复审已通过（Ready: Yes，无遗留发现）；当前等待独立质量/安全审查。步骤 2 的历史临时验证目录仍待精确复核与安全清理。

步骤 3 质量审查记录：独立 bug-detector 审查 Ready: Yes，无 Critical/Important。Minor 注意：多个 `plantuml:prepare` 并发执行会共享缓存/暂存/产物并互相中断；按本计划构建流程顺序运行，不承诺并发安全。清理只针对独占的 `.build/plantuml-runtime` 生成目录，禁止在其中存放手工文件。步骤 3 的实现与规格/质量审查已完成，进入步骤 4。

### 4. 实现可注入、可测试的 PlantUML 子进程服务

当前实施已提交，代码边界释放；独立规格审查通过，当前质量/安全审查中。原子提交：`07482c52c05471b8c8782a32b2a7fc567d6b0c41`，仅含 `src/main/services/plantuml-service.ts`、`test/plantuml-service.spec.ts`、`package.json`、`package-lock.json`。步骤 3 的服务准备脚本并发限制不变，与本服务无关。

- [x] 新建可注入 `createPlantumlService({ spawn, checkPlantumlEndpoint, delay, resolveResources })`，封装 configure/start/stop/retry/status 与状态订阅；单测不启动真实长驻子进程。`plantuml-encoder@1.4.0` 已声明为直接运行依赖，lock 保持既有版本且未更新其他依赖。
- [x] 子进程 executable 必须是资源目录中的绝对 `bin/java.exe`；`shell:false`、隐藏窗口、参数数组分离；参数包含 headless、SANDBOX、固定 JAR、`-picoweb:<port>:127.0.0.1`、`-disablestats`。
- [x] 状态 `stopped/starting/running/error`；默认端口 18080，只接受 1024–65535；同配置幂等；端口变更先停旧子进程，避免重复启动。
- [x] 限时轮询固定内部 UML 的本机 SVG 健康探针；要求 HTTP 200、SVG content type、SVG 标签及专用健康 marker 同时匹配，普通服务、HTML、无关 SVG 和重定向均拒绝；确认子进程存活才进入 running。runtime/JAR 缺失、spawn error、超时、非预期退出、重试和退出清理均有测试覆盖。
- [x] 服务固定忽略子进程 stdout/stderr；错误 DTO 不含原始子进程错误/敏感 sentinel，日志仅暴露脱敏类别、状态码和端口。

    单测必须覆盖的调用形态：

        const service = createPlantumlService({ spawn, checkPlantumlEndpoint, resolveResources })
        await service.configure({ enabled: true, port: 18080 })
        expect(spawn).toHaveBeenCalledWith(javaExe, expectedArgs, { shell: false, windowsHide: true, stdio: 'ignore' })
        await service.stop()

- [x] 在 test/plantuml-service.spec.ts 覆盖单实例/idempotency、监听地址、参数、安全 profile、端口验证、状态广播、超时、进程异常退出、stop/retry 幂等与退出回收，包括 stop timeout 时保留活进程所有权、禁止替代实例的竞态。

    验证命令：

        npm run test -- test/plantuml-service.spec.ts

步骤 4 验证记录：TDD 首次缺模块 RED；分批扩展测试，其中端口转换竞态及 stop deadline 场景均在修复前红、修复后绿。最终聚焦测试 23/23；全量 `npm run test` 33 files / 300 tests passed；`npm run typecheck` node/web 通过；测试文件独立 strict TypeScript 检查通过；`git diff --check`、staged diff-check 通过；`npm ls plantuml-encoder --depth=0` 确认为 1.4.0。独立规格复核 Ready: Yes，无发现；质量审查结论见下方记录。服务当前未集成 IPC/应用主窗口启动顺序/renderer，分别留给步骤 5–8。

步骤 4 审查记录：规格复核 Ready: Yes，无发现；独立 bug-detector 质量审查 Ready: Yes，无 Critical/Important。Minor 仅为测试覆盖建议：未直接覆盖探针响应体超限、请求取消和原生 `ENOENT` 事件顺序；实现已有响应上限/取消及错误处理，此项不阻塞本步，留待服务接线后集成测试加强。IPC 注册与应用退出接线仍是后续步骤范围。

### 5. 增加严格白名单 IPC 与状态广播

步骤 5 实现所有权已随提交 `665bc0ee8254553005b70ed6712a574a8328fdc6` 释放：`src/shared/ipc-contract.ts`、`src/shared/event-types.ts`、`src/preload/index.ts`、`src/main/ipc/register.ts`、`test/plantuml-ipc.spec.ts`。本步骤不得改 `plantuml-service.ts`、package 清单、主进程入口/startup coordinator、renderer 或其他后续步骤文件。

- [x] 在 src/shared/ipc-contract.ts 添加 plantuml:configure、plantuml:getStatus、plantuml:retry 合约；configure 请求仅允许 enabled 与 port，不接收 renderer 的 URL、Java 路径、JAR 路径或源码。
- [x] 在 src/shared/event-types.ts 增加 trace:plantuml-status 状态事件；在 src/preload/index.ts 增加精确事件/调用白名单。
- [x] 在 src/main/ipc/register.ts 注册三条通道并把服务状态转发给窗口；handler 统一走当前 TraceResult 包装。由于应用入口归步骤 6，本步依赖注入保持可选；步骤 6 负责接入真实服务。
- [x] 增加 IPC 合约测试：未白名单通道仍拒绝，服务配置载荷无法携带额外路径/远程地址；窗口关闭后不向已销毁 webContents 推送。

步骤 5 实施与复审记录：提交 `665bc0ee8254553005b70ed6712a574a8328fdc6`，仅含 `src/main/ipc/register.ts`、`src/preload/index.ts`、`src/shared/event-types.ts`、`src/shared/ipc-contract.ts`、`test/plantuml-ipc.spec.ts`。TDD 首轮 IPC 测试 RED 16/16；最终 IPC 定向 16/16、服务回归 23/23、全量 `npm run test` 34 files / 316 tests、`npm run typecheck` node/web、新测试 strict tsc 与 `git diff --check` 全部通过。独立规格复核 Ready: Yes，无发现；质量/安全复核 Ready: Yes，无已证实问题。非阻塞建议：增加 accessor、Symbol own key、port 下界拒绝测试；Step6 应持有 registerIpc disposer 的生命周期。步骤 5 已完成，队列状态 done。

    验证命令：

        npm run test -- test/plantuml-service.spec.ts
        npm run typecheck

### 6. 将主窗口首显移到重型服务之前

历史复审记录（2026-09-26，中途）：原 P1 已由 `828fd5f6938774c68a8a75ccc659368ea0662621` 修复，独立规格复审 Ready: Yes；独立质量审查与另一审查者随后确认两个 P2 并发缺口：bootstrap 在 await 前读取 failed 状态会让过期响应覆盖重新选库后的状态；并发 `app:setRootDir` 可都以旧 failed 状态取得确认豁免。随后通过 `5cb011f0c0e2e57ea73c8930b04365f6a1b919b3` 修复并发串行化。

历史复审记录（2026-09-26，中途）：Step6 初始实现提交 `51eabbddc3e1264a2d5d2e770396521b78de03c9`。独立规格/质量审查发现根目录核心初始化失败仍误报 ready（Important/P1）；已由 `828fd5f6938774c68a8a75ccc659368ea0662621` 及后续状态串行化、inactive-root 修复关闭。

步骤 6 最新状态：P2 `stopActiveChild()` 超时后遗留临时 `exit` listener 已由 `e13c01339029710be275db1da2d7498c3db123e0` 按 TDD 修复；重复 retry 不再累积监听器，超时与正常退出后均释放临时监听和计时器。规格复审 Ready: Yes、质量/安全复审 Ready: Yes。代码边界已释放。已接受限制：慢 bootstrap 队列遇到慢 `fs.access` 可能延迟恢复（Minor，未做 UNC 实测）；macOS 无窗口 stop timeout 为 P3，按 Windows-first 暂不阻塞且未做 macOS 实测。shutdown 保持 fail-closed，必须确认 child 实际退出才允许正常退出。

用户于 2026-09-26 再次明确批准扩展服务 API 的关闭策略复核，要求 Trace 退出时升级终止并可验证 Java 子进程已退出，避免遗留进程。专项审查确认现有 `shutdown()`、强制终止、exit/exitCode 确认与主进程 fail-closed quit gate 已满足要求；无代码修改，服务文件边界已释放。实施代理实跑 `npm run test -- --run test/plantuml-service.spec.ts test/startup-coordinator.spec.ts`（2 files / 29 tests passed）及 `npm run typecheck`（通过），对应两文件 diff 为空；Step6 原有规格/质量双阶段审查仍有效。

#### Step 6 退出升级与确认专项复核

- [x] 以故障路径检查普通 stop 超时后是否升级终止、成功返回是否必须证明 Java 子进程已退出、无法确认时是否保留 child ownership 并阻止 Trace 退出；现有 deferred-child 测试已覆盖升级后等待真实 exit、确认失败及所有权保留。
- [x] 验证 shutdown 重入/迟到 exit/已 populated exitCode，以及失败后重试的结果不会假报 stopped；实施代理复跑 `test/plantuml-service.spec.ts`、`test/startup-coordinator.spec.ts` 和 `npm run typecheck`。现状完整覆盖，无需改码；Step6 旧双阶段审查结论继续有效。

- [x] 新建 src/main/services/startup-coordinator.ts，显式提供 onWindowShown、waitForBootstrap 与后台启动顺序；在窗口显示前，根目录激活和 PlantUML 只能排队，不能被 await 到创建窗口链路。
- [x] 调整 src/main/index.ts：保留必要的轻量 config.load；先注册 IPC、创建隐藏 BrowserWindow 并加载 renderer；ready-to-show 回调第一步 show()，随后释放启动协调器开始 appService.activateConfiguredRoot，PlantUML 配置也只能在窗口已显示后执行。
- [x] 在 src/main/ipc/register.ts 让 app:bootstrap 等待根目录核心激活 Promise，再返回 onboarding/workspace 信息；不能因 PlantUML 启动或 search 全量索引阻塞进入应用。
- [x] window-all-closed、before-quit 与服务 configure/retry 路径统一停止 PlantUML child；应用 shutdown 必须在终止升级后确认实际退出才放行 app.quit；配置服务失败不得抛穿主窗口启动链路。
- [x] 在 test/startup-coordinator.spec.ts 用可控 Promise 证明顺序为 window.show → root activation → 后台服务；证明 bootstrap 等 root activation、PlantUML 不作为 bootstrap 门槛。

    目标调用顺序：

        window.once('ready-to-show', () => {
          window.show()
          startup.onWindowShown()
        })
        await startup.waitForRootActivation()
        return appService.bootstrap()

- [x] 运行 coordinator 单测、完整 typecheck 与主进程相关测试，确认 startup Promise 不会因服务失败永久 pending。

    验证命令：

        npm run test -- test/startup-coordinator.spec.ts test/plantuml-service.spec.ts
        npm run typecheck

步骤 6 完成记录（2026-09-26）：提交链为 `51eabbddc3e1264a2d5d2e770396521b78de03c9`、`828fd5f6938774c68a8a75ccc659368ea0662621`、`5cb011f0c0e2e57ea73c8930b04365f6a1b919b3`、`14507f2db71a6ecda7ec8f5718c143ab2df811e8`、`e13c01339029710be275db1da2d7498c3db123e0`。TDD 修复覆盖超时 listenerCount 稳定、timer abort、child ownership 与迟到退出。规格审查 Ready: Yes；质量/安全复审 Ready: Yes。协调者实跑 `npx vitest run test/plantuml-service.spec.ts` 25/25、`npm run typecheck`、`npm run test` 35 files / 335 tests、`npm run build` 成功（renderer 7,154 modules）；独立复审实跑 PlantUML IPC/startup/service 58/58、typecheck、diff-check。实施代理报告 IPC spec strict tsc 通过。Electron 窗口人工验收仍待后续集成阶段；UNC 慢路径与 macOS P3 按前述记录接受，不是本步骤 blocker。步骤 7 已开始。

### 7. 迁移偏好并扩展设置界面

步骤 7 原实现记录：提交 `05017c826b4eb456f160c9d8bfb71bc7868973d6`，仅改 `src/renderer/src/App.tsx`、两份 locale、`test/plantuml-preferences.spec.ts`。`pref-store.ts` 的 version=1 migration、hydrated 标记、旧非空 URL→custom 迁移及不持久化 hydration 已由步骤 1 实现并复用。原验证：偏好+无障碍定向 18/18；typecheck；全量 35 files / 342 tests；build（renderer 7,154 modules）。原质量审查发现唯一 P2：retry 异步回包缺少代次校验，旧状态可能覆盖新模式状态。该历史问题由下方修复记录处理。

步骤 7 P2 修复：提交 `6c72de0c558e9f9c107eaf14fa54650af83df236`，只改 `src/renderer/src/App.tsx` 与 `test/plantuml-preferences.spec.ts`。TDD deferred 回归先证实迟到的旧 `running`、`starting`、失败回包均会倒灌新模式 stopped，再以偏好 hydration/mode/port、服务状态事件和 retry 代次校验阻断；卸载时请求失效，retry loading 在当前请求结束时清除。协调者独立实跑定向偏好+无障碍 21/21、`npm run typecheck`、`npm run test`（35 files / 345 tests）、`npm run build`（renderer 7,154 modules）、diff-check，均通过。规格复审 Ready: Yes；质量/安全审查 Ready: Yes，无阻断或已证实安全问题。步骤 7 自动验收完成；Electron UI 亮/暗主题及键盘人工验收未完成，作为用户侧验收待办。

- [x] 在 src/renderer/src/stores/pref-store.ts 为已有 persist 配置加明确版本迁移与 hydrated 标记；未完成 hydration 前不得用默认本地模式覆盖旧非空 PlantUML Server。步骤 1 已实现，本步确认并复用。
- [x] 在 src/renderer/src/App.tsx 设置弹窗用三态 Radio 选择器表达「Trace 本地服务 / 自定义服务 / 关闭」；本地模式提供端口与 stopped/starting/running/error 状态、重试；自定义模式显示原 URL 输入；关闭模式不显示可误解为离线远程的 URL 字段。
- [x] 保留 validatePlantumlServer 的 HTTP(S) 校验与远程外发提示；模式切换不清除 plantumlServer 草稿。renderer 恢复旧非空 URL 时保持原目标，明确仍为用户显式自定义服务。
- [x] 本地设置 hydration 完成后才 IPC 配置服务；先订阅状态、读取当前快照，再发 configure；使用事件版本避免过期 snapshot/configure 结果覆盖新状态，并避免订阅空窗。custom/off 的停止超时会显示错误并重发 disabled 配置，不会调用启动 retry。
- [x] 在 zh-CN.ts/en-US.ts 增加全部模式、服务状态、端口错误/冲突、启动中、重试、远程隐私与离线描述文案；配置项延续现有 Tooltip mouseEnterDelay=2 和主题语义 token。
- [x] 在 test/plantuml-preferences.spec.ts 覆盖 hydration 前不启动、hydrated 后订阅/configure、custom/off 无 URL 停止、停止超时可见状态、按模式正确重试；步骤 1 已覆盖新装迁移/旧非空 URL/端口迁移边界。

    验证命令：

        npm run test -- test/plantuml-preferences.spec.ts test/accessibility-contract.spec.tsx
        npm run typecheck

步骤 7 实现、自动验证与规格/质量双阶段复审均已完成，plan.json 任务状态为 `done`。Electron UI 亮/暗主题及键盘人工验收另列为用户侧待办，不写成自动验证通过。

### 8. 让阅读态和 Muya 编辑态共享服务就绪状态

步骤 8 已于 2026-09-26 登记 `/root/plantuml_step8_renderer_impl` 实施，登记前完成只读侦察。原因：当前设置状态仅在 App 组件局部，阅读态和 Muya 仅消费旧 plantumlServer 字符串；本地默认模式没有可用 URL，off 模式还可能沿用持久化远端 URL。不得触碰 IPC/preload/主进程服务、持久化 pref-store、vendor/muya 或指纹。

- [x] 新建非持久化 `stores/plantuml-status-store.ts`；App.tsx 将 status snapshot、IPC event、configure/retry 结果同步到此 store，同时保持 Step7 设置状态一致。hydration 前不得错误显示远程或本地 ready。
- [x] 在 `muya-config.ts` 提供纯函数统一派生 PlantUML render config：local 仅在 state=running 且 status.port 与所选端口一致时返回 `http://127.0.0.1:<port>/plantuml`；starting/stopped/error 不给 server；custom 仅用经过 HTTP(S) 校验的地址；off 无条件不返回 server，即使偏好仍保存旧 URL；坏持久化 URL fail-closed。
- [x] `cards.tsx` 从已 hydration 的偏好与 transient 状态派生唯一 config，并将同一 config 同时传给静态 `NoteMarkdown` 和活跃 `MuyaNoteEditor`；不得在两个渲染路径各自复制 mode/port 逻辑。
- [x] `note-md.tsx` 将 config 传入 `NoteDiagram`。静态 PlantUML 在 disabled/starting/service-error 时展示本地化状态，不调用 PlantUML renderer/不创建图片请求；状态变成 ready 后渲染，running 失效、换端口、关闭或错误后清除旧图并按新状态 fail-closed。其他图表不受 PlantUML 状态影响。
- [x] `MuyaNoteEditor.tsx` 用现有 `setOptions(..., true)` 在有效 render config 改变时刷新；非 ready 时不得请求 URL，清楚说明 PlantUML 尚未启用/启动中/服务异常，同时保证其余 Markdown 内容仍可编辑。`vendor/muya` 内部在 server 为空时会抛可捕获错误；不得修改其源码或指纹。
- [x] 使用 `zh-CN.ts`、`en-US.ts` 为阅读态与编辑态配置本地化的关闭/启动中/服务错误/未配置状态；复用语义 token 和已有图表状态样式，不硬编码颜色。
- [x] 在新增 `test/plantuml-status-store.spec.ts`、`test/plantuml-renderer.spec.ts`、既有 `test/note-md.spec.ts`、`test/muya-note-integration.spec.tsx` 与 `test/plantuml-preferences.spec.ts` 覆盖 store 更新、local ready/stopped/端口不匹配/starting/error/custom 有效与无效/off+已保存远程 URL；验证 non-ready/off 不调用 renderer、ready 后命中本地 `/plantuml/svg/...`、ready→error/off 清除旧图，以及 Muya options 状态切换与编辑能力。
- [x] 修复独立质量审查发现的 Muya stale-render 竞态：对 PlantUML renderer 预加载/选项更新增加代次守卫，避免配置已切 Off 后延迟完成的 renderer 使用旧 custom URL 发出源码；新增 deferred renderer → 切 Off/error/换端口 → resolve 回归测试，禁止改 `vendor/muya`。
- [x] 确保上述 preload 与 Muya 实际运行时是同一 renderer loader 模块实例。独立复审发现 Vite 对 `@muyajs/core` 的 optimizeDeps 预打包生成独立 rendererCache，而 helper 从 vendor 源码另行 preload，因此预热不保证覆盖 Muya 的异步 loader。扩展精确边界到 `electron.vite.config.ts`，增加真实 editor/runtime loader 路径回归，证明 custom→Off/error/换端口期间旧 endpoint 不发送源码；测试以真实 loopback HTTP 服务接收请求，不拦截或替换图像请求；仍不得改 `vendor/muya`。

    验证命令：

        npm run test -- test/plantuml-status-store.spec.ts test/plantuml-renderer.spec.ts test/note-md.spec.ts test/muya-note-integration.spec.tsx test/plantuml-preferences.spec.ts
        npm run typecheck

Step8 原实现提交：`10269efe3a8ba62863a5bce884159665f9781ec6`。独立质量/安全复审发现 MEDIUM：首次 renderer 动态 import 未完成时切 Off，旧 preview 仍可能沿用先前 custom URL 发源码。TDD 修复提交 `48dd5ce0443a66d59eda55880f2a2c2912d986ab`，仅改登记的 MuyaNoteEditor、muya-config 和 Muya integration test；新增 4 项 deferred preload/Off/error/port 切换回归，先红后绿。focused 35/35、`npm run typecheck`、全量 39 files / 383 tests、`npm run build` 均由实施代理实跑通过，协调者核实 HEAD/hash 与文件范围。初始化时 server 强制为空，只有 loader preload 成功且 generation/config 未过期后才设置；离开 ready 同步清除。当前等待 `/root/plantuml_step8_postfix_review` 独立复审；Electron 窗口人工 smoke 未完成，不将其记为自动通过。

Step8 修复复审结论（2026-09-26）：Ready: No。复审确认 `MuyaNoteEditor.tsx` 从 vendor 源码直接 preload，但 `electron.vite.config.ts` 将 `@muyajs/core` 预优化到 `node_modules/.vite/deps/@muyajs_core.js`，其中包含独立 rendererCache 和另一个 PlantUML 动态 chunk。切 Off/error/换端口时，Muya 真实 loader 仍可能带着快照旧 URL 发送源码；现有 16/16 helper/mock 测试未覆盖实际 React 生命周期或模块身份。现将精确边界重新开放给 `/root/plantuml_step8_renderer_impl`：`electron.vite.config.ts`、`src/renderer/src/components/muya-note/MuyaNoteEditor.tsx`、`src/renderer/src/components/muya-note/muya-config.ts`、`test/muya-note-integration.spec.tsx`。需先新建真实 loader/editor 路径的 RED 回归，再保障同一实例预加载/失效，不改 vendor/muya。原 `48dd5ce` 保留为第一阶段改动，不能误判其修复完整。

最新状态（2026-09-26）：用户已选择仅开发测试依赖 `happy-dom`。现由 `/root/plantuml_step8_renderer_impl` 实施，精确边界为 `package.json`、`package-lock.json`（只新增 happy-dom devDependency）、`electron.vite.config.ts`、`src/renderer/src/components/muya-note/MuyaNoteEditor.tsx`、`src/renderer/src/components/muya-note/muya-config.ts`、`test/muya-note-integration.spec.tsx`。目标为挂载真实 React/Muya 编辑器，验证 Muya 实际 loader 与预加载路径为同一实例，并覆盖 custom→Off/error/换端口时旧 endpoint 不发送注释源码。若实施需要更多文件，先向协调者报告，更新 HANDOFF 和所有权后再改；禁止改 `vendor/muya` 与指纹。原审查发现尚未关闭，修复及独立复审完成前不发布。

Step8 所有权补充（2026-09-26）：另登记 `vitest.config.ts` 给 `/root/plantuml_step8_renderer_impl`，仅用于配置 Vitest client dependency optimizer 复现 Electron renderer 的优化模块边界；允许该文件增加测试专用 esbuild 插件，对精确的 PlantUML renderer 模块注入延迟 gate，以构造真实异步竞态，不写 vendor 源码、不 mock runtime/loader/preloader，且不影响生产构建。happy-dom 测试必须挂载真实 editor/runtime；此前 SSR optimizer 因 Prism `import.meta.glob` 语言表缺失无法初始化，已停止且不计有效 RED。client optimizer 已通过精确 `onResolve` 映射至包内 `browser-index.js`（与 Electron Vite 当前优化产物一致），并确认 gate 注入实际 renderer 模块前。另允许测试 plugin 仅 stub Node/happy-dom 不支持的 CSS/图片/字体静态导入；禁止拦截 JS/TS、runtime/loader/chunk 或图像请求。client optimizer 输出的绝对路径静态资源加载失败尚属测试夹具问题；目标生命周期 RED 尚未完成，生产代码尚未修改。

Step8 边界授权更新（2026-09-26）：用户批准仅在 `vitest.config.ts` 的测试构建插件中，对 Muya Prism 语言注册的精确 `import.meta.glob` 作等价展开，目标是让 happy-dom 能加载真实 Prism 语言模块。转换不得改 `vendor/muya` 源码；不得 mock 或替换真实 React/Muya runtime、PlantUML renderer/loader、动态 chunk 或图像请求；不得影响生产构建。此前 `glob is not a function` 是测试夹具限制，不是目标回归 RED。

Step8 有效 RED（2026-09-26）：实施代理实跑 `npx vitest run test/muya-note-integration.spec.tsx -t "does not issue a stale custom PlantUML request" --reporter=verbose`。happy-dom 真实挂载 React 与优化的 `@muyajs/core`，真实 PlantUML chunk gate 启动；切换 Off 并释放 gate 后，interceptor 捕获旧 custom endpoint 的 PlantUML 请求，解码请求包含 `TRACE_PRIVATE_PLANTUML_SOURCE`，零泄漏断言按预期失败（1 个请求）。这是有效的目标 RED，生产文件仍未修改；当前实施只尝试在已登记的 `MuyaNoteEditor.tsx` 与 `muya-config.ts` 修正同 loader 实例预加载/失效，再重跑回归并提交证据。

Step8 共享 loader 实现（2026-09-26）：提交 `b31631d43a721db96228ecb64c0da60095137f21`（`fix(note): share Muya PlantUML renderer preload`），只改登记的六个代码/测试文件。MuyaNoteEditor 改从 `@muyajs/core/utils/diagram/index.js` preload，并在 Electron optimizeDeps 中 include 同一子路径；真实构建只包含一份 `rendererCache`，Vitest client optimizer metadata 证明两个入口复用相同共享 chunk。happy-dom 实际挂载 React/Muya editor、真实优化 runtime 与 renderer，通过动态门控覆盖 Off、error、旧端口、新端口切换，旧 endpoint 0 次请求、只有新端口发出包含测试源码的请求且 code block 仍可编辑。验证：定向 `test/muya-note-integration.spec.tsx` 17/17、`npm run typecheck`、全量 `npm run test` 39 files / 388 tests、`npm run build`、`git diff --check` 均通过；happy-dom 20.14.5 为 dev-only。当前独立规格/质量双审进行中；未启动 packaged Electron 窗口，不能代替安装包验收。

Step8 双审结论与测试边界修正（2026-09-26）：首轮规格审查与质量/安全审查均 Ready: No，唯一 P2 为 `test/muya-note-integration.spec.tsx` 使用 happy-dom `fetch.interceptor` 捕获请求后返回合成 SVG，违反“不拦截或替换图像请求”边界。按复审意见重新登记仅修改该测试文件，使用真实 loopback HTTP 服务。修正后两阶段复审均 Ready: Yes，无 P1/P2/P3；非阻断备注：contenteditable 已断言，未额外派发按键。真实 HTTP 回归验证旧 custom/旧端口零请求、新端口收到含源码哨兵请求。协调者已重跑 focused 17/17、typecheck、全量 test 39 files / 388 tests、build renderer 7,155 modules、diff-check 均通过；happy-dom 为 dev-only。Step8 完成；未手动启动 packaged Electron，须与安装包验证区分。

Step8 真实 HTTP 测试修正状态（2026-09-26）：仅修改 `test/muya-note-integration.spec.tsx`。3 个临时服务绑定 `127.0.0.1` 随机端口，happy-dom 对真实 `img.src` 发出 GET，服务实际记录路径与 PlantUML 源码并返回 `image/svg+xml`；旧 custom/旧本地服务零请求，新端点收到源码哨兵。无请求拦截或合成响应，监听/关闭均等待，CORS 仅通过正常 HTTP 响应头允许 happy-dom 读取本机响应。协调者重跑 focused 17/17、`npm run typecheck`、全量 `npm run test`（39 files / 388 tests）、`npm run build`（renderer 7,155 modules）、测试文件 diff-check 均通过。规格与质量/安全两份独立复审针对修正版进行中；在 Ready 前不进入打包/发布。

### 9. 加入 electron-builder 资源并跑完整自动门槛

执行者：`/root/plantuml_step9_packaging_impl`。精确文件所有权见 `docs/HANDOFF-CURRENT.md`；本步骤与 Step8 renderer 并行实施，协调者单独维护共享计划与交接文档。

- [x] 在 electron-builder.yml 将 .build/plantuml-runtime 作为 extraResources 打包到 resources/plantuml；确认 ASAR 外资源路径使用 process.resourcesPath，不通过相对工作目录寻找。
- [x] 更新 package.json build:win 先执行 npm run plantuml:prepare，再执行 electron-vite build 与 electron-builder；普通 typecheck/test 不下载 Java/JAR，不依赖网络。
- [x] 执行已加固的 scripts/test-plantuml-runtime.mjs：启动随包 runtime 的 PicoWeb，以固定内部样例请求 127.0.0.1 上的 PlantUML SVG；验证不需公共网络、服务不绑定其他网卡、SANDBOX 拒绝本地/外部 URL include、统计关闭、子进程停止后端口释放。local/URL include 拒绝断言需匹配精确错误头、HTTP 状态和内容类型；URL 侧需先确认 loopback canary 健康且随后无 include 请求。此集成命令要求先 prepare；普通 npm run test 仅验证锁文件与 mock 服务，不下载或要求生成运行时。
- [x] 运行完整门槛并核对 Windows x64 安装包内 bin/java.exe、PlantUML JAR、最小模块清单和许可证；与 v0.15.1 已归档安装包比较并记录字节增量与 SHA-256。

Step9 实现提交：`4875a7a867a8f3c05c0dbc6de7c06015e127fe3a`。TDD 配置测试 RED 2 项；定向 3 文件 34/34、`npm run typecheck`、Node 脚本语法检查、js-yaml extraResources/filter 解析、真实 bundled-runtime SANDBOX smoke（有效 SVG、loopback-only、local/URL include sentinel 未泄漏且本机 URL canary 零请求、统计关闭、停止释放端口）通过。实际 `build:win`、安装包内容/体积/SHA 核验待协调者执行。

Step9 质量/安全复审（2026-09-26）：生产打包代码未发现可证明安全漏洞；复核者实跑 packaging/security 定向 9/9 与 `node scripts/test-plantuml-runtime.mjs` 成功。但复核指出当前拒绝检查只看正文 sentinel（URL canary 另看零请求），未证明本地 include 确实被拒绝且 URL include 响应符合预期失败语义；另若 `stopChild` 抛错，finally 会跳过 canary 关闭与临时目录清理。已将 `scripts/test-plantuml-runtime.mjs` 和 `test/plantuml-runtime-security.spec.ts` 登记给 `/root/plantuml_step9_packaging_impl`：先写能 RED 的回归，保证正常/异常路径资源释放并严格断言 SANDBOX 拒绝结果。此补强前不把 smoke 视为可靠的自动安全门禁；Step9 安装包验收仍待。

Step9 smoke 门禁加固提交（2026-09-26）：`567c9c878ef4b6730e55431dceb2494324629405`，仅含 runner 与 security spec。5 项新增回归先 RED；定向 2 files / 12 tests、`node --check`、真实 bundled runtime smoke、diff-check 通过。实测拒绝特征：local include 返回 HTTP 400 + SVG + PlantUML `cannot include` 错误；URL include 返回 HTTP 400 + SVG + `Cannot open URL`，并在 canary health 成功后保持 include 请求计数为零。stopChild/canary server stop 失败时仍尝试后续清理，temp 删除要求路径已解析且位于系统 tmpdir。

Step9 加固质量复审补充（2026-09-26）：复审者重新实跑 security spec 8/8 与真实 smoke；无 false-pass 发现，但 Ready: No。若 finally cleanup 失败，清理异常会覆盖原本的 smoke assertion 失败（独立 Node 复现 `originalPreserved:false`）；CLI 只输出 AggregateError.message，不显示 `.errors`。实现所有权现重开 `/root/plantuml_step9_packaging_impl`，只含 `scripts/test-plantuml-runtime.mjs`、`test/plantuml-runtime-security.spec.ts`。先写 RED，确保 primary failure 与全部 cleanup failures 同时保留且在 CLI 可见；然后独立复审。未跑构建。

Step9 第二轮修复状态（2026-09-26，覆盖上条当时的所有权状态）：提交 `d1fb4a4c99ba5bb5de0c911538e1733124d280c6`，仅含 `scripts/test-plantuml-runtime.mjs` 与 `test/plantuml-runtime-security.spec.ts`。实施方先新增端到端错误链回归并验证 RED→GREEN；定向 2 files / 13 tests、`node --check`、真实 bundled-runtime smoke、`git diff --check` 与临时资源清理通过。独立复审 Ready: Yes，复核者实跑 security spec 9/9、Node 语法、真实 runtime smoke 和两文件 diff-check。两个非阻断注意项：人为自引用 AggregateError 可能令 formatter 递归过深，但没有生产可达路径证据；原生文件错误消息可能含本机临时路径，未来若外传诊断日志需脱敏。实施代码边界已释放，smoke 门禁补强已完成。

协调者复验（2026-09-26）：`npm run typecheck` 通过；`npm run test` 39 files / 387 tests passed。`npm run build`、`npm run build:win` 与安装包内容/体积/SHA 核验尚未执行，等待 Step8 真实 loader 测试路径确定并完成修复后串行运行。

v0.17.0 发布门槛与 Windows 包核验（2026-09-26）：`npm run typecheck`、`npm run test`（39 files / 388 tests）、`npm run build`（7,155 renderer modules）、`npm run build:win` 均成功。产物 `release/溯源 Trace-0.17.0-setup.exe` 的 ProductVersion/FileVersion 为 0.17.0.0/0.17.0；归档至 `builds/windows/Trace_0.17.0_beta_20260926_01.exe`，字节数 210,577,133（200.82 MiB），SHA-256 `394DFFA219B9329B150D19D33DD0887FC67619551AE7E38093DF841E39B41699`，源/归档摘要一致。相对 v0.15.1 的 479,952,122 bytes 减少 269,374,989 bytes（56.13%）。`app.asar` 中 package version、main、renderer HTML 和 JS chunks 齐全；打包的 149 个 PlantUML runtime 文件与 `.build/plantuml-runtime` 逐文件 SHA 完全一致，Java 21.0.12、PlantUML 1.2026.8 及两份许可证在包内。直接使用包内 Java 通过 loopback 返回含哨兵的 SVG；`node scripts/test-plantuml-runtime.mjs` 的离线本机/SANDBOX/统计关闭/停止释放端口 smoke 通过。Windows 安装包未签名（v0.15.1 同为 NotSigned）；本轮未手动安装并交互启动 Electron GUI，故 build_history 保持 `verificationPassed: false` 并写明边界。现转入推送和双平台 Release 验收。

    验证命令：

        npm run typecheck
        npm run test
        npm run build
        npm run build:win

### 10. 按用户已授权的发布流程交付

- [x] 用户已确认发布版本 `v0.17.0`：相对 v0.15.1，按任务三态反馈与完全离线 PlantUML 两个独立功能域递增。版本批准已完成；现同步 package.json、package-lock.json、CLAUDE.md 当前版本行、docs/changelog/CHANGELOG.md、lifecycle 发布说明、builds 发布说明/历史与累计改动文档。
- [x] 构建并归档 Windows x64 安装包；`builds/build_history.json`、`builds/release_notes/release_notes_v0.17.0.md`、累计改动文档与 lifecycle 发布说明已写入实测版本信息、字节数、SHA-256 和人工验收边界。
- [x] 完成最终 diff 与验证复核，并将 Codex 隔离分支发布准备提交 `f769415676bc3ebe7676bbc4f6902b8206679a0f` 快进合入 `main`。用户未跟踪 `Resource/pic/`、`Resource/vid/` 均保留未动。
- [x] 在合并后的主目录重跑 `npm run typecheck`、`npm run test`（39 files / 388 tests）与 `npm run build`（7,155 renderer modules）；主目录缺少 happy-dom 的安装环境经 npmmirror 同步后全绿。
- [x] 通过 SSH 将 `main` 与 `v0.17.0` annotated tag 推送至 GitHub/Gitee；发布状态同步时 `main` 核对锚点为 `3ce352b771fafaf50f9eef871700902a54bd56ab`，tag object 为 `12941bdcf036aa9ff566fa236a01c8d307ea915b`、peeled commit 为 `403fcb174667743f2979ba55b9d29b5ef35ce4f4`。随后纯交接同步提交 `385aef6951bd1f37ef9d4958a67666ed4bc6344e` 已双端推送；精确当前远端 main 以 `git ls-remote` 实测为准。
- [x] 创建 GitHub Release `https://github.com/Qore-Origins/Trace/releases/tag/v0.17.0`，预发布；附加 Windows x64 安装包。GitHub API 实测附件为 210,577,133 bytes，digest `sha256:394dffa219b9329b150d19d33dd0887fc67619551ae7e38093df841e39b41699`，与本地一致；预发布版不能标成 Latest，GitHub 按 `latest=false` 发布。
- [ ] 创建 Gitee Release，仅发布相同说明并链接 GitHub 下载，不上传安装包；`GITEE_TRACE_ACCESS_TOKEN` 仅存在于用户级环境，当前进程未继承，尚未发起 Gitee Release API 请求。该变量值对应聊天中暴露的凭据，不使用，建议撤销轮换；新凭据须仅由 Codex 进程环境安全提供。发布后核验说明、无附件，并更新其 `builds/release_history.json` 记录。
- [x] 双平台 SSH 推送、GitHub Release 与资产已核验；Gitee 发布结果及最终跨文档回填仍待完成，不将整个双平台发布闭环提前标为完成。

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
