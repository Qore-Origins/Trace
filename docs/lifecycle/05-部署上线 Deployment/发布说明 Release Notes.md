# 发布说明 Release Notes

## 当前版本 Current Release

| 项目 | 内容 |
|------|------|
| 版本 | v0.18.0 公测版 Beta 7 |
| 日期 | 2026-09-27 |
| 类型 | 功能批次 / Beta |
| 升级兼容 | 计划文件格式和数据目录不变 |
| 版本唯一真源 | `package.json`；版本史见 `docs/changelog/CHANGELOG.md` |

## 版本概述

本次相对 v0.17.0 增加一个完整用户可见功能域：顶栏居中胶囊式页面导航。计划文件格式和数据目录不变。

## 新增与改进

- **页面导航层级**：将「计划 / 日记 / 回忆」从菜单栏中区分出来，改为以窗口中轴为基准的胶囊选择器；命令菜单仍位于左侧。
- **液态滑块动效**：胶囊内部活动滑块随页面选择轻柔变形并回弹；连续快速切换跟随最新目标，不排队。
- **键盘与无障碍**：三个页面入口使用原生按钮及唯一当前页语义；支持键盘操作和系统减少动态效果偏好。
- **响应式与主题**：窄窗口下优先收缩搜索框，菜单、胶囊与窗口控件不重叠；兼容亮暗主题和标题栏 no-drag 交互。
- **兼容性**：计划 Markdown 格式、数据目录、IPC 合约与页面状态来源不变。

## 已知验收边界

- `npm run typecheck`、`npm run test`（40 个测试文件 / 397 项）、`npm run build`（renderer 7,156 modules）和 `npm run build:win` 均通过。
- Windows x64 安装包 `Trace_0.18.0_beta_20260927_01.exe`：210,584,915 字节 / 200.83 MiB；SHA-256 `EBDF485209FEFB2FB3E9922BC091AE14C192D26A7E0FDE13F3FCC9867017855B`。包内 FileVersion/ProductVersion 均为 0.18.0；`app.asar` 未包含项目内 QA profile/cache/log。
- 随包 PlantUML runtime 的 148 个文件哈希与准备目录逐项一致；打包目录中的 Java 实际离线渲染 SVG。安全 smoke 验证 loopback-only、SANDBOX 阻止本地/URL include、关闭统计及服务退出释放端口。
- 隔离临时配置下启动打包版 Electron，首启空库引导、配置计划库、全文搜索和回溯到源注释组件均通过；使用的是 `release/win-unpacked` 内应用，未单独执行 NSIS 安装交互。
- 安装包未数字签名，Windows 可能显示 SmartScreen/未知发布者提示。

## 安装与升级

- Windows x64 使用 GitHub Release 提供的安装包。Gitee Release 仅发布本说明并链接 GitHub 下载，不上传超过 100 MB 的安装包。
- 升级前建议按个人习惯备份计划库；应用不改变既有计划文件格式或数据根目录。
- 本次不改变 v0.17.0 引入的 PlantUML 本地服务配置和旧自定义地址迁移行为。

详细版本说明与发布资产以 `builds/release_notes/release_notes_v0.18.0.md` 和 `builds/release_history.json` 为准。

## 已发布渠道

- GitHub Release（Windows x64 安装包）：<https://github.com/Qore-Origins/Trace/releases/tag/v0.18.0>
- Gitee Release（仅说明，无安装包）：<https://gitee.com/Qore/trace/releases/v0.18.0>
