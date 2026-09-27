# Trace v0.18.0 双平台发布计划

> 状态：已完成（2026-09-27）
> 版本：v0.18.0 · 公测版 Beta 7
> 上一发布：v0.17.0 · 公测版 Beta 6

## 发布范围与版本判断

本次主交付是顶栏居中胶囊式页面导航：将「计划 / 日记 / 回忆」与菜单栏视觉区分，并加入胶囊内的液态滑块切换。相对 v0.17.0 属于一个完整用户可见功能域，因此按项目版本策略提升一个 minor 版本至 `0.18.0`；不改计划格式或用户数据结构。发布名为 Beta 7。

当前本地 `main` 为 `d03aca48850f24418932f310d677698aee215b35`，相较两个远端 `main` 均领先 32 个提交。远端 `main` 实测均为 `495a9e4ba542899d05e6e1e58818d5505341656a`；`v0.18.0` 尚无本地或远端标签。工作区另有未跟踪用户资源 `Resource/pic/`、`Resource/vid/`，必须保留且不得纳入提交。

## 文件所有权

由 Codex 独占本次发布元数据边界：

- `package.json`、`package-lock.json`
- `electron-builder.yml`（仅修正生产输入目录，避免将 `out/` 下的 QA profile/cache 包入安装包）
- `test/plantuml-packaging.spec.ts`（锁定 electron-builder 的生产文件边界）
- `AGENTS.md`、`CLAUDE.md`
- `docs/changelog/CHANGELOG.md`
- `docs/changelog/改动文档_20260926_近期版本累计更新.md`
- `docs/lifecycle/05-部署上线 Deployment/发布说明 Release Notes.md`
- `builds/release_notes/release_notes_v0.18.0.md`
- `builds/build_history.json`、`builds/release_history.json`
- `docs/Plan/README.md`、本计划 Markdown/JSON、`docs/HANDOFF-CURRENT.md`
- 构建产物 `release/`、归档 `builds/windows/Trace_0.18.0_beta_20260927_01.exe`

不改产品实现代码，不覆盖或清理其他 worktree 和上述未跟踪用户资源。

## 执行步骤

### 1. 版本与发布文档准备

- [x] 实测本地/远端版本、HEAD 与工作区；确认两个远端位于同一基线且 `v0.18.0` 尚未使用。
- [x] 按功能跨度确定版本 `0.18.0`（Beta 7），并登记文件所有权。
- [x] 更新 package/package-lock、项目版本信息、CHANGELOG、累计改动文档与生命周期发布说明。
- [x] 准备正式 release notes（构建尺寸、SHA 与发布链接在构建完成后回填）。

### 2. 验证与 Windows 安装包（已完成）

- [x] 收紧 `electron-builder.yml` 的输入为 `out/main`、`out/preload`、`out/renderer` 和 `package.json`；新增 `test/plantuml-packaging.spec.ts` 回归，目标断言先 RED（原 broad `out/**/*` 不符合生产目录契约），修正后 targeted 5/5 通过。
- [x] 重跑 `npm run build:win`；确认 `app.asar` 不含 QA profile/cache/log，体积回到合理范围。结果：app.asar 276,798,022 bytes（仅生产输出与依赖），无项目 QA 目录；installer 210,584,915 bytes。
- [x] 运行 `npm run typecheck`、`npm run test`、`npm run build`、`npm run build:win`。结果：40 files / 397 tests、renderer 7,156 modules，全部通过。
- [x] 核验 Windows x64 NSIS 安装包 ProductVersion/FileVersion 0.18.0、148 个 runtime 文件 SHA-256、打包路径 PlantUML 离线 SVG 与 SANDBOX/loopback smoke。
- [x] 安装包归档至 `builds/windows/Trace_0.18.0_beta_20260927_01.exe`；210,584,915 bytes / 200.83 MiB，SHA-256 `EBDF485209FEFB2FB3E9922BC091AE14C192D26A7E0FDE13F3FCC9867017855B`。隔离 Electron 实窗 smoke 验证空库引导和搜索回溯通过；NSIS setup 安装交互未单独执行，未签名。

### 3. 双端推送

- [x] 提交经验证的版本与发行说明元数据：`d91ece4`（`chore(release): prepare v0.18.0`）。
- [x] 在该版本提交创建 annotated tag `v0.18.0`；tag 解引用为 `d91ece4326ca3a6024644d331c0263b4680fd324`。
- [x] 通过 SSH 推送 `main` 和 tag 至 `origin`（GitHub）与 `gitee`；`git ls-remote` 核实两端 main=`e69e3d25cf0e15ad84ceb334bd5560762018e1f5`，tag object=`4e0e2d0997f5883abdccf69a18aaa2623d46baf5`，peeled commit=`d91ece4326ca3a6024644d331c0263b4680fd324`。

### 4. 创建并核验 Release、收尾账本

- [x] 创建 GitHub prerelease，附 Windows x64 安装包和发行说明；核对远端资产大小 210,584,915 bytes、digest `sha256:ebdf485209fefb2fb3e9922bc091ae14c192d26a7e0fde13f3fcc9867017855b`，正文与本地一致。
- [x] 创建 Gitee prerelease（ID `1169912`），仅发布发行说明，不上传安装包；正文经 UTF-8 JSON payload 传输；核对公开页面 HTTP 200、tag `v0.18.0`、目标 commit `d91ece4326ca3a6024644d331c0263b4680fd324` 和正文一致；仅有平台自动源码归档 `v0.18.0.zip` 与 `v0.18.0.tar.gz`。
- [x] 更新 build/release history、CHANGELOG/lifecycle、共享 README 与 HANDOFF；同步本计划 Markdown/JSON。
- [x] 发布账本提交 `c3a985e` 已通过 SSH 推送到 GitHub 与 Gitee；推送后两端 main=`c3a985eceee285ef2322083b77283ce3d4f0b650`、tag object=`4e0e2d0997f5883abdccf69a18aaa2623d46baf5`、peeled commit=`d91ece4326ca3a6024644d331c0263b4680fd324`。本计划与完成状态随本次文档同步推送。

## 发布策略与验收标准

- 版本唯一真源为 `package.json`；Beta 7，tag `v0.18.0`。
- Git push 使用 SSH，不使用 HTTP token URL。任何令牌只从已配置环境变量在当前 PowerShell 进程读取，不输出、不写文件、不提交。
- GitHub Release 上传安装包；Gitee 因 100 MB 限制只发布说明并提供 GitHub 下载地址。
- 双端 `main` 与 annotated tag 指向预期提交；Release 标题、正文、预发布状态和附件符合上述策略。
- 记录实际验证结果，不将未运行的安装/GUI 测试写为通过；保留 `Resource/pic/` 与 `Resource/vid/`。

## 验证记录

| 阶段 | 结果 |
|---|---|
| 发布前状态复核 | `git status --short --branch`：`main...origin/main [ahead 32]`；仅 `Resource/pic/`、`Resource/vid/` 未跟踪。HEAD 和两个远端 main 已实测；tag 未占用。 |
| 版本元数据与文档 | 已更新至 0.18.0 / Beta 7；发行说明已填入构建和验收数据 |
| typecheck / test / build / build:win | 通过；40 files / 397 tests；renderer 7,156 modules；NSIS 构建成功 |
| Windows x64 包 | 210,584,915 bytes / 200.83 MiB；SHA-256 `EBDF485209FEFB2FB3E9922BC091AE14C192D26A7E0FDE13F3FCC9867017855B`；Package GUI smoke 通过；NSIS 安装交互未执行 |
| 版本准备提交 | `d91ece4`（`chore(release): prepare v0.18.0`）；`Resource/pic/`、`Resource/vid/` 未纳入 |
| 双端 SSH 推送 | GitHub 与 Gitee `main`=`e69e3d25cf0e15ad84ceb334bd5560762018e1f5`；annotated tag object=`4e0e2d0997f5883abdccf69a18aaa2623d46baf5`；peeled=`d91ece4326ca3a6024644d331c0263b4680fd324` |
| GitHub Release | https://github.com/Qore-Origins/Trace/releases/tag/v0.18.0；预发布，说明正文一致；安装包 size/digest 与本地匹配 |
| Gitee Release | https://gitee.com/Qore/trace/releases/v0.18.0；ID `1169912`；预发布，HTTP 200；正文一致；无安装包附件 |
| 发布账本推送后 refs | 两端 `main`=`c3a985eceee285ef2322083b77283ce3d4f0b650`；annotated tag object=`4e0e2d0997f5883abdccf69a18aaa2623d46baf5`；peeled=`d91ece4326ca3a6024644d331c0263b4680fd324` |
