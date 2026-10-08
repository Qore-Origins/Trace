# 发布说明 Release Notes

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

- GitHub Release（Windows x64 安装包）：发布后补充 URL 与远端 digest 核验结果。
- Gitee Release（仅说明，无安装包）：发布后补充公开页面、正文与 HTTP 状态核验结果。
