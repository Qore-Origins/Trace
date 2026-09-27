# v0.18.1 — 溯源 Trace 公测版 Beta 7 修订（逾期标签布局稳定）

本次是 v0.18.0 的补丁更新。取消已完成任务的勾选时，逾期标签不再短暂折行并顶动卡片内容。

## 修复

- 任务详情与任务列表的逾期标签不再通过宽度动画入场，卡片高度和标题位置保持稳定。
- 过期但已完成的任务保留布局位置，标签透明且不向读屏器播报；未过期任务不额外占位。
- 亮色、暗色、窄窗口与减少动态效果场景的浏览器逐帧回归均已覆盖。

## 兼容与验证

- 计划 Markdown 格式、数据目录与 IPC 合约不变，无需迁移。
- 自动验证：`npm run typecheck`、`npm run test`（40 文件 / 398 项）、`npm run build`（renderer 7,156 模块）及 `npm run build:win` 均通过。
- Windows x64 安装包：`Trace_0.18.1_beta_20260927_01.exe`，210,580,598 字节 / 200.83 MiB；SHA-256：`36679588F921F338B8DC27FA229B968F00D11387B2843C2F5DB9B7828BF94654`。包内 FileVersion/ProductVersion 均为 0.18.1；归档与构建输出大小及哈希一致。
- `app.asar` 仅含生产输出和依赖，不含项目 QA 目录；随包 PlantUML 的 149 个文件逐项哈希一致，打包路径 Java 离线渲染 SVG。SANDBOX、本机回环、关闭统计和子进程退出 smoke 通过。
- 隔离配置下启动 `release/win-unpacked` 应用，已验证首启空库引导、配置测试库、全文搜索及回溯到源注释组件；未单独执行 NSIS 安装界面的交互验收。
- 安装包未数字签名，Windows 可能显示 SmartScreen/未知发布者提示。

## 下载

- GitHub Release：<https://github.com/Qore-Origins/Trace/releases/tag/v0.18.1>
- Windows x64 安装包：<https://github.com/Qore-Origins/Trace/releases/download/v0.18.1/Trace_0.18.1_beta_20260927_01.exe>
- Gitee Release：<https://gitee.com/Qore/trace/releases/v0.18.1>。Gitee 仅发布本说明，不上传超过 100 MB 的安装包。
