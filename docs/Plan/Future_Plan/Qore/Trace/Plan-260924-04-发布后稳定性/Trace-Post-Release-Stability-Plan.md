# Trace v0.15.0 发布后稳定性与 Muya 首次激活计划

状态：稳定性修复与 v0.15.1 双平台发布已完成；正式 NoteCard 人工验收待后续；执行者：Codex；开始：2026-09-24。

## 范围与所有权

- Windows 根路径分隔符：`src/main/services/path-safety.ts`、`test/validation-path.spec.ts`、`.issues/2026-09-23-Windows根路径斜杠规范化.md`。
- Muya 首次激活重载/延迟：诊断优先；实际修改 `electron.vite.config.ts`、`test/bundle-budget.spec.ts`，其余正式编辑器/vendor 边界未改。
- 双击计划重复加载：`src/renderer/src/stores/plan-store.ts`、`test/plan-editing.spec.ts`；相同计划重复打开幂等，但显式刷新和外部变更重载仍需保留。
- 双击缺陷条目：`.issues/2026-09-24-双击计划重复加载.md`。
- v0.15.1 发布：`package.json`、`package-lock.json`、`AGENTS.md`、`CLAUDE.md`、`docs/changelog/CHANGELOG.md`、`builds/release_notes/release_notes_v0.15.1.md`、`builds/build_history.json`、`builds/release_history.json`；只在 `release/` 与 `builds/windows/` 生成/归档构建产物。
- 协作记录：本文件、同目录 `plan.json`、`docs/Plan/README.md`、`docs/HANDOFF-CURRENT.md`。
- 其他智能体避开以上精确边界；用户资源 `Resource/pic/`、`Resource/vid/` 不触碰。

## 验收任务

- [x] 为 Windows 正斜杠根路径下的子路径操作写失败回归；规范化根路径后不放宽越界检查；覆盖合法子路径与 `..` 拒绝。
- [x] 追踪 Muya 首次激活：证据确认首次动态导入触发 Vite late dependency optimization 及 renderer reload；在 Electron renderer config 显式 include 本地链接包 `@muyajs/core`，保持 production dynamic import 边界。
- [x] 独立 Vite 冷缓存验证：`@muyajs/core` 出现在首轮优化 metadata，相关图表/编辑依赖共 18 项；服务器监听 107ms，Muya 预优化就绪约 2.8s。该耗时移到开发服务器启动期；Electron 点击后首次编辑无重载尚未做自动 GUI 验收，生产包先前单次 Muya 初始化测量为 254ms，不作为普遍保证。
- [x] 运行 `npm run typecheck`、`npm run test`（28 文件 249/249）、`npm run build`；打包应用的 Windows 根路径回归留待下个正式包。
- [x] 修复双击计划时同一路径重复读取导致的“载入中…”及计划内容连续闪烁；同一路径打开幂等，显式刷新/外部变更仍可重新读取。
- [x] 按维护修订跨度将版本从 v0.15.0 更新为 v0.15.1；更新变更日志和双平台发行说明，构建并归档 Windows 安装包。
- [x] 用户在当前 Electron 应用双击切换计划并确认问题已修复；隔离打包版 GUI 烟测启动被执行策略拒绝，仍未单独验证。
- [x] 推送 main 与 v0.15.1 tag 至 GitHub/Gitee；GitHub Release 发布安装包，Gitee Release 只发布说明/提供 GitHub 下载链接；两端 GET 核验通过。
- [ ] 重启使用新配置的开发服务器，在正式 NoteCard 首次打开注释，确认页面不 reload 且可编辑；当前运行的 5173 server 未被我重启。
- [ ] 人工检查 IME、真实系统剪贴板、语言选择浮层、连续删除、切卡 flush、亮暗主题及窄窗口；需用户在本机配合完成后才能关闭 Muya 人工验收。
- [x] 回填 release_history，更新 HANDOFF/计划索引与缺陷状态，并提交推送发布收尾记录。

## 实施记录

2026-09-24：起始 `main` HEAD `c716b05`，用户资源未跟踪且未触碰。路径回归 32/32；冷 Vite 验证 18 项依赖约 2.8s 优化于 server startup；双击回归先红后绿（2 次读取→1 次，显式刷新仍触发读取）。`npm run typecheck`、`npm run test`（28/249）、`npm run build`、`npm run build:win` 通过。v0.15.1 安装包 479,952,122 B；SHA-256 `F7892ED833EFC84C6AA5B9FDD8A7F83C869686C9BDCA95DCF0BAD8BABBEB0EE9`；归档副本哈希一致，EXE ProductVersion/FileVersion 均为 0.15.1。打包 GUI 隔离启动调用被执行策略拒绝，故没有声称 smoke 通过。用户已在当前 Electron 应用复验双击行为并确认修复；下一步提交、推送并发布。正式 NoteCard 完整人工验收仍待单独确认。

2026-09-25：发布准备提交 `b55d0f3` 已推送至 GitHub/Gitee；`v0.15.1` tag 两端均指向该提交。GitHub Release 已发布（2026-09-25T14:13:55Z），安装包 479,952,122 B；GitHub asset digest 与本地 SHA-256 一致。Gitee Release 已创建（2026-09-25T14:17:35Z），GET 返回正文与本地 payload 完全一致；Release 页面 HTTP 200 且包含版本与 GitHub 下载链接，未上传安装包（仅平台自动源码归档）。v0.15.1 双平台发布完成；打包 GUI smoke 未运行，开发服务器首次 NoteCard 激活复验与其余 NoteCard 人工验收仍待后续。
