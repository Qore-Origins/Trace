# Trace 计划目录

> 本目录是 Trace 项目计划的共享读取入口。Codex 与 Claude Code 在接手、实施、暂停和完成计划时必须同步更新对应计划文档，并在 `docs/HANDOFF-CURRENT.md` 登记当前所有权与验证结果。

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

| 计划 | 状态 | 创建日期 | 审计/规格 | 当前下一步 |
|---|---|---|---|---|
| [前端体验与地基整改](./Future_Plan/Qore/Trace/Plan-260915-01-前端体验与地基整改/Frontend-Experience-Foundation-Implementation-Plan.md) | Task 1–11 实施与验证完成；上限树动效和 Release 多轮性能采样另行跟踪 | 2026-09-15 | [综合审计报告](../audit/2026-09-15-frontend-ui-performance-architecture-audit.md) | 见真实性能报告；尚未合入主分支或推送 |
| [注释 Muya 正式集成](./Future_Plan/Qore/Trace/Plan-260917-02-注释Muya正式集成/Muya-Note-Formal-Integration-Implementation-Plan.md) | 实施完成，待正式卡片人工验收 | 2026-09-17 | [Muya 设计规格](../superpowers/specs/2026-09-15-muya-note-editor-design.md) | 用户验收 IME、剪贴板、语言选择、连续删除、切卡 flush、亮暗主题和窄窗口 |
| [v0.15.0 双平台发布](./Future_Plan/Qore/Trace/Plan-260923-03-v0.15.0双平台发布/Trace-v0.15.0-Release-Plan.md) | 已完成：GitHub/Gitee Release 已发布并核验 | 2026-09-23 | 上次发布 v0.12.0，增量为 F2、Muya 与前端地基批次 | 发布闭环；后续跟进 Muya 人工验收等独立待办 |
| [发布后稳定性与 v0.15.1 修订发布](./Future_Plan/Qore/Trace/Plan-260924-04-发布后稳定性/Trace-Post-Release-Stability-Plan.md) | 稳定性修复及 v0.15.1 双平台发布已完成；Muya 人工验收待后续 | 2026-09-24 | 发布后稳定性 issue 与 Muya 正式集成验收清单 | 重启开发服务器复验正式 NoteCard 首次激活，再完成 IME/剪贴板等人工体验验收 |
| [任务三态视觉反馈](./Future_Plan/Qore/Trace/Plan-260926-01-任务三态反馈/Task-Three-State-Feedback-Implementation-Plan.md) | 自动实现、完整验证及双阶段审查完成；待 Electron 亮暗主题和交互人工验收 | 2026-09-26 | [已批准设计规格](../superpowers/specs/2026-09-26-task-state-and-offline-plantuml-design.md) | 首次 in_progress 选择器问题已修；人工检查第一次进行中、第二次完成、第三次回退，并覆盖鼠标/键盘 |
| [离线 PlantUML 本地服务](./Future_Plan/Qore/Trace/Plan-260926-02-离线PlantUML本地服务/Offline-PlantUML-Service-Implementation-Plan.md) | 实现、自动验证、双平台 Release 与发布记录均完成 | 2026-09-26 | [已批准设计规格](../superpowers/specs/2026-09-26-task-state-and-offline-plantuml-design.md) | 发布计划已闭环；任务三态人工验收仍作为独立后续项 |

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
