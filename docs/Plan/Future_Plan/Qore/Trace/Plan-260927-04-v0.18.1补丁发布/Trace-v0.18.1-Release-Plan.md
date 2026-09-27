# Trace v0.18.1 双平台补丁发布计划

> 状态：实施中（2026-09-27）
> 版本：v0.18.1 · 公测版 Beta 7 修订
> 上一发布：v0.18.0 · 公测版 Beta 7

## 范围与边界

本次仅发布逾期标签布局稳定修复：取消任务完成状态时，标签不再因宽度动画折行而使任务详情或任务列表卡片短暂跳动。相对 v0.18.0 为单一缺陷修复，因此使用用户指定的 patch 版本 `0.18.1`；不变更计划格式、数据目录或 IPC 合约。

开工实测：本地 `main` 为 `8491c00`，GitHub/Gitee `main` 均为 `1b31518`；本地领先两笔已验证修复提交 `fda4972`、`8491c00`。`v0.18.1` 本地/双端均未占用。未跟踪的 `Resource/pic/`、`Resource/vid/` 为用户资源，原样保留。

Codex 独占本轮发布元数据：`package.json`、`package-lock.json`、`AGENTS.md`、`CLAUDE.md`、`docs/changelog/CHANGELOG.md`、`docs/changelog/改动文档_20260926_近期版本累计更新.md`、`docs/lifecycle/05-部署上线 Deployment/发布说明 Release Notes.md`、`builds/release_notes/release_notes_v0.18.1.md`、`builds/build_history.json`、`builds/release_history.json`、`docs/Plan/README.md`、本计划 Markdown/JSON、`docs/HANDOFF-CURRENT.md`。构建输出仅在忽略目录 `release/` 和 `builds/windows/`，不得触碰用户资源与其他 worktree。

## 执行队列

- [x] 更新版本、项目版本标识、变更日志和发行说明。
- [x] 重跑 typecheck、全量测试、构建与 Windows NSIS 打包；核验版本、大小、SHA-256、PlantUML 离线资源与可执行包主路径。未单独执行 NSIS 安装交互，已在发行说明明确记录。
- [x] 提交发布准备，在该提交创建 annotated tag `v0.18.1`；通过 SSH 推送 `main` 与 tag 至 GitHub/Gitee，并实测远端 refs。
- [x] GitHub 创建预发布并附安装包；Gitee 仅发布相同说明、不上传安装包。核对正文、tag、预发布状态及 GitHub asset 大小/digest。
- [ ] 回填 build/release 账本、共享计划与交接；文档提交双端同步，最终复核。

## 发布门禁

版本以 `package.json` 为唯一真源。所有发布文档只记录实际跑过的测试；发布前确认 installer 内 FileVersion/ProductVersion 为 0.18.1，打包文件不含 QA 缓存；未签名及 NSIS 安装交互边界如实披露。令牌只从环境变量读取，禁止进入输出、文件、命令行参数或 Git。保留未跟踪用户资源。发行说明需包括 GitHub 下载地址，Gitee 不上传超过 100 MB 的安装包。

## 验证记录

- `npm run typecheck` 通过；`npm run test` 40 files / 398 tests；`npm run build` 与 `npm run build:win` 均退出 0，renderer 7,156 modules。
- 安装包 ProductVersion/FileVersion 均为 0.18.1；`release/溯源 Trace-0.18.1-setup.exe` 210,580,598 bytes，SHA-256 `36679588F921F338B8DC27FA229B968F00D11387B2843C2F5DB9B7828BF94654`；归档 `builds/windows/Trace_0.18.1_beta_20260927_01.exe` 大小和哈希一致。未签名；比 v0.18.0 少 4,317 bytes。
- `app.asar` 28,002 条记录，仅生产输出/依赖，无根级 QA/test/demo/scripts；所需 main/preload/renderer/package 入口齐全。随包 PlantUML 149/149 文件哈希相同；打包路径 Java 离线 SVG 与 `node scripts/test-plantuml-runtime.mjs` 的 SANDBOX/loopback/统计/退出 smoke 通过。
- 打包应用使用独立 `.build/release-smoke-0181-20260927/` 配置和计划库启动：首启显示空库引导，设置测试库并通过 UI 全文搜索、点击结果回溯，源注释组件获得 pulse。测试进程已通过窗口关闭通道正常退出；未操作既有用户计划库。首轮 smoke 脚本因测试树未展开而未找到节点，展开后复验通过；产品代码无变更。NSIS 安装向导未单独执行。
- 发布准备提交 `9787e4932b74552a462194a0058754c426b8209e`；annotated tag `v0.18.1` 对象 `7b3c673e333c2b2b68d51f99b9cc4f3a88934080` 解引用为该提交。提交前/中断后 `npm run typecheck` 与全量 `npm run test`（40/398）复跑通过，`git diff --cached --check` 通过。提交后工作区仅用户资源未跟踪，发布状态文档新更新尚待收尾提交。
- 双端 SSH 推送完成：`git ls-remote` 实测 GitHub/Gitee `main`=`9787e4932b74552a462194a0058754c426b8209e`，annotated tag object=`7b3c673e333c2b2b68d51f99b9cc4f3a88934080`，peeled commit=`9787e4932b74552a462194a0058754c426b8209e`。
- GitHub Release `https://github.com/Qore-Origins/Trace/releases/tag/v0.18.1`，ID `397653862`，预发布/非草稿；正文与本地发行说明一致，唯一安装包 210,580,598 bytes，API digest `sha256:36679588f921f338b8dc27fa229b968f00d11387b2843c2f5db9b7828bf94654`。Gitee Release `https://gitee.com/Qore/trace/releases/v0.18.1`，ID `1170435`，预发布，公开页 HTTP 200；正文一致，目标提交 `9787e49`，无 EXE，仅自动源码归档 `v0.18.1.zip` / `v0.18.1.tar.gz`。
- 待执行：发布历史与共享交接收尾提交、双端推送和最终复核。
