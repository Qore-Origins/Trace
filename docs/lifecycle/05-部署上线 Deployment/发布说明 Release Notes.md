# 发布说明 Release Notes

## 当前版本 Current Release

| 项目 | 内容 |
|------|------|
| 版本 | v0.18.1 公测版 Beta 7 修订 |
| 日期 | 2026-09-27 |
| 类型 | 功能批次 / Beta |
| 升级兼容 | 计划文件格式和数据目录不变 |
| 版本唯一真源 | `package.json`；版本史见 `docs/changelog/CHANGELOG.md` |

## 版本概述

本次相对 v0.18.0 修复任务卡片逾期标签的布局跳动。计划文件格式和数据目录不变。

## 新增与改进

- **逾期标签布局**：取消已完成任务的勾选时，逾期标记不再通过宽度动画入场或短暂折行；任务详情和任务列表的内容位置保持稳定。
- **状态与无障碍**：已过截止日期的已完成任务保留标签布局槽位，但标签透明且从无障碍树隐藏；未逾期任务不预留槽位。
- **兼容性**：计划 Markdown 格式、数据目录和 IPC 合约不变。

## 已知验收边界

- `npm run typecheck`、`npm run test`（40 个测试文件 / 398 项）、`npm run build`（renderer 7,156 模块）和 `npm run build:win` 均通过。此前逾期标签浏览器逐帧回归覆盖 1200px 亮色、720px 暗色及减少动态效果，共 6/6 场景。
- Windows x64 安装包 `Trace_0.18.1_beta_20260927_01.exe`：210,580,598 字节 / 200.83 MiB；SHA-256 `36679588F921F338B8DC27FA229B968F00D11387B2843C2F5DB9B7828BF94654`。包内 FileVersion/ProductVersion 均为 0.18.1；归档哈希一致，`app.asar` 不含项目 QA 目录。
- 随包 PlantUML 149 个文件哈希逐项匹配；打包目录 Java 实际离线渲染 SVG。SANDBOX、本机回环、关闭统计及服务退出释放端口的 smoke 通过。
- 隔离配置下启动打包版 Electron，首启空库引导、选择测试计划库、全文搜索和回溯到源注释组件均通过；未单独执行 NSIS 安装交互。
- 安装包未数字签名，Windows 可能显示 SmartScreen/未知发布者提示。

## 安装与升级

- Windows x64 使用 GitHub Release 提供的安装包。Gitee Release 仅发布本说明并链接 GitHub 下载，不上传超过 100 MB 的安装包。
- 升级前建议按个人习惯备份计划库；应用不改变既有计划文件格式或数据根目录。
- 本次不改变 v0.17.0 引入的 PlantUML 本地服务配置和旧自定义地址迁移行为。

详细版本说明与发布资产以 `builds/release_notes/release_notes_v0.18.1.md` 和 `builds/release_history.json` 为准。

## 已发布渠道

- GitHub Release（Windows x64 安装包）：<https://github.com/Qore-Origins/Trace/releases/tag/v0.18.1>（发布后核验）。
- Gitee Release（仅说明，无安装包）：<https://gitee.com/Qore/trace/releases/v0.18.1>（发布后核验）。
