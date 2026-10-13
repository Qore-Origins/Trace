# 发布说明 Release Notes

## v1.1.0 发布准备（2026-10-13）

`package.json` 已升至 1.1.0。本版增加按目录匹配的可配置计划工作流、周日 1+7 联动、可修改创建预览、工作流设置概览与名称编辑，以及不常见设置的使用说明；小沅计划操作与请求诊断同步更新。详细范围、兼容性和已知边界见 `builds/release_notes/release_notes_v1.1.0.md`。

发布门槛核验：`npm run typecheck` 通过，默认环境完整 `npm run test` 连续两轮各 98 文件 / 1283 项通过，`npm run build:win` 通过。最终候选 `builds/windows/Trace_1.1.0_stable_20261013_02.exe` 为 210,786,164 字节，SHA-256 `D12DABE620873454B43EFB5260010B748AD9392F60162F6F780A793278F798E0`，PE 与 app.asar 版本均为 1.1.0。隔离 Electron 生产 bundle 实窗检查覆盖首次建库引导、全文搜索回溯与工作流创建。安装包未签名，NSIS 安装/卸载和真实个人计划库尚未验收。

Windows 对已有 `plan.json` 原子覆盖的间歇性 `EPERM` 拒绝主体仍未知。限定 ProcMon 捕获中 `MsMpEng.exe` 映射同一临时文件的事件晚于首次拒绝，不能证明 Defender 导致锁文件；本版仅增加一次有界退避机会，并保留失败时的编辑草稿。公开发布状态以 GitHub/Gitee Release 页面及发布账本为准。

## 当前版本 Current Release

| 项目 | 内容 |
|------|------|
| 版本 | v1.0.0 正式版 |
| 日期 | 2026-10-09 |
| 类型 | 正式版 / Stable |
| 升级兼容 | 计划 Markdown 与既有数据根目录保持兼容；新增计划引用与小沅会话数据 |
| 版本唯一真源 | `package.json`；版本史见 `docs/changelog/CHANGELOG.md` |

## 版本概述

这是溯源 Trace 的首个正式版。相较 v0.18.1，集中交付日记自动补建、计划名称模板、计划标签页与跨计划引用，以及本地优先的小沅 Agent 与可追溯计划操作。

## 新增与改进

- **日记自动补建**：激活计划库后在后台补齐缺失的空白日记；保留已有内容并使用 checkpoint，避免重启后重建已删除日期。新日记心情初始为空。
- **计划名称模板**：按目标文件夹配置命名规则，新建时自动填入日期与前缀，用户只需补充自定义名称。
- **计划标签页与引用**：支持工作区计划标签页、跨计划链接和只读嵌入；重命名、删除等引用目标变更可预览影响并选择是否同步更新。
- **小沅 Agent**：用户自配模型服务、端点和 API Key；通过 `@` 指定计划/文件夹，选择并预览上下文和外发内容；计划操作按批次预览、授权、执行并保留本地溯源。
- **回收站与隐私**：计划/文件夹统一支持恢复与永久清除；不默认上传整库，API Key 不进入会话记录。
- **兼容性**：既有计划 Markdown 和数据根目录保持兼容；新增引用与 Agent 会话数据由应用本地管理。

## 已知验收边界

- `npm run typecheck` 与 `npm run build` 通过；Windows x64 `npm run build:win` 完成。用户决定跳过合入后全量测试 3 个失败项：85 个文件 / 1190 项，1187 通过、3 失败；不得视为全量全绿。两个 DST 用例在 `TZ=America/New_York` 下与 SearchService spec 定向复跑共 22/22 通过；一次 `SAVE_FAILED` 未复现，原因未明。
- 安装包 `Trace_1.0.0_stable_20261009_01.exe`：210,738,662 字节 / 200.98 MiB；SHA-256 `76ED2D64F0313D0D9FDBE3333BDC306D6C10E839513BBE27D0328BDF1EA8157E`。归档文件与构建输出的大小及哈希一致；产品版本 1.0.0.0，文件版本 1.0.0。
- 随包 PlantUML runtime 149 个文件的路径和哈希与准备目录一致；`app.asar` 共 28,017 项，未发现项目 QA 路径。NSIS 安装/卸载交互及用户侧键鼠、IME、DPI、窄窗口、屏幕阅读器验收尚未完成。
- 安装包未数字签名，Windows 可能显示 SmartScreen 或未知发布者提示。

## 安装与升级

- Windows x64 安装包归档于 `builds/windows/Trace_1.0.0_stable_20261009_01.exe`；GitHub Release 提供安装包，Gitee Release 仅发布说明并链接 GitHub 下载，不上传超过 100 MB 的安装包。
- 升级前建议按个人习惯备份计划库。既有计划 Markdown 与数据根目录兼容；新增的会话、操作审计和引用数据由本地存储管理。
- v0.17.0 起的完全离线 PlantUML 行为保持不变。

详细版本说明与发布资产以 `builds/release_notes/release_notes_v1.0.0.md`、`builds/build_history.json` 和 `builds/release_history.json` 为准。

## 已发布渠道

- GitHub Release（正式版、非预发布）：<https://github.com/Qore-Origins/Trace/releases/tag/v1.0.0>；唯一 EXE 为 210,738,662 字节，远端 digest 与本地 SHA-256 一致。
- Gitee Release（正式版、无 EXE）：<https://gitee.com/Qore/trace/releases/v1.0.0>；Release ID `1191066`，公开页面 HTTP 200，正文与本地说明一致；仅有平台自动生成的 `v1.0.0.zip` / `v1.0.0.tar.gz` 源码归档。
