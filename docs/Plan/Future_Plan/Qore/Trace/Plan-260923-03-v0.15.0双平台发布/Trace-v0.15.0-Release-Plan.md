# Trace v0.15.0 Beta 5 双平台发布计划

状态：已完成；执行者：Codex；开始：2026-09-23；发布完成：2026-09-24。文件所有权以 `docs/HANDOFF-CURRENT.md` 为准。本计划 Markdown 为执行真源，同目录 `plan.json` 为 Trace 镜像队列。

## 版本判断

上次正式发布 v0.12.0（2026-09-12）；两端 `main` 当前基线 `5058037`，本地尚未发布增量包含 F2 回忆视图、真实 Muya 注释编辑器、前端动作/应用壳/主题/性能系统性整改及缺陷修复。相当于多个独立功能批次，版本号跨三个 minor 至 v0.15.0，维持 0.x 公测版，不提前宣称 v1.0.0。发布称谓 Beta 5。

## 执行队列

- [x] 核对双端分支、上次 Release、增量范围、凭据可用性与基线测试。`main` HEAD `4491da8`，双端远端同为 `5058037`，typecheck 0 错、28 文件 246/246。
- [x] 更新 `package.json`、锁文件、`CLAUDE.md`/`AGENTS.md` 版本行、CHANGELOG 和 v0.15.0 发行说明；明确已知限制，不把 Chrome 验收写作 Electron 真机验收。
- [x] 运行 `npm run typecheck`（通过）、`npm run test`（28 文件 246/246）、`npm run build:win`（成功）；打包版隔离烟测通过（首开编辑 254ms，本机单次记录）。
- [x] 归档安装包到 `builds/windows/`，大小 462,698,904 B / 441.26 MiB，SHA-256 `489561BBE91519D825D54BFC10291F090FFCD9FC74DDC89E0796C1E164B88810`；`build_history.json` 与发行说明已记录。
- [x] 提交并推送 `main` 到 GitHub/Gitee；创建并推送 `v0.15.0` tag；GitHub v0.15.0 预发布已上传安装包（发布代码提交 `2316a3b`）。
- [x] 核验两端 tag/commit；GitHub Release 正文/asset 大小/hash 已 GET 核验。Gitee Release 已创建，仅发行说明和 GitHub 下载链接，没有上传安装包；API GET 确认正文逐字等价（换行归一化后）、tag 目标和 prerelease 状态正确；回填账本、计划、HANDOFF。最终状态记录提交后推送到两端。

## 发布门槛与恢复

- 版本号以 `package.json` 为真源；发布标签 `v0.15.0`，安装包内版本必须一致。
- Gitee 中文正文使用 UTF-8 JSON 文件发 API，参数名 `target_commitish`；不在命令或日志中输出令牌。
- 不修改、暂存或清理 `Resource/pic/`、`Resource/vid/`；不强推。
- 如发布链路中断，保留已经成功的平台记录和上传资产，禁止重复创建/覆盖而不先 GET 核对。
- 正式 Muya 首次加载延迟及未完成的人机体验验收须在发行说明中如实标注；若打包版核心编辑路径失败，停止发布。

## 结果记录

2026-09-24：本地版本、自动验证、Windows x64 安装包与隔离应用烟测完成。发布代码提交 `2316a3b` 已推送两端，tag `v0.15.0` 两端均剥离到同一 commit。GitHub Release GET 确认 tag、标题、正文、462,698,904 B asset 与 SHA-256 `sha256:489561bbe91519d825d54bfc10291f090ffcd9fc74ddc89e0796c1e164b88810`；URL `https://github.com/Qore-Origins/Trace/releases/tag/v0.15.0`。Gitee Release 于 `2026-09-24T12:20:29+08:00` 创建；GET 核验 tag/目标 commit/prerelease/正文，正文与本地说明一致，无人工上传的 Release asset；Gitee 自动源码归档不含 Windows 安装包。URL `https://gitee.com/Qore/trace/releases/v0.15.0`。最终文档闭环待提交推送。每阶段只记录实际运行过的命令与远端证据。
