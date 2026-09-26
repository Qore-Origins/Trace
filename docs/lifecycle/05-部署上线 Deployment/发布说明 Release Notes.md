# 发布说明 Release Notes

## 当前版本 Current Release

| 项目 | 内容 |
|------|------|
| 版本 | v0.17.0 公测版 Beta 6 |
| 日期 | 2026-09-26 |
| 类型 | 功能批次 / Beta |
| 升级兼容 | 计划文件格式和数据目录不变 |
| 版本唯一真源 | `package.json`；版本史见 `docs/changelog/CHANGELOG.md` |

## 版本概述

本次相对 v0.15.1 按两个独立功能域递增版本：任务三态反馈，以及无需系统 Java 或网络即可使用的离线 PlantUML。

## 新增与改进

- **任务列表三态**：未开始、进行中、已完成之间可循环并可回退；修正状态按钮单击反馈。
- **完全离线 PlantUML**：将 PlantUML 和精简 Java 运行时随应用分发；Trace 主窗口优先显示，PlantUML 服务随后后台启动。
- **服务配置**：设置支持本地服务、自定义服务和关闭三态，显示端口/运行状态并支持重试；既有自定义地址保留迁移兼容。
- **本地安全**：内置服务只监听 `127.0.0.1`；SANDBOX 拒绝本地与 URL include，统计关闭。
- **注释竞态修复**：Muya 的预加载路径与正式图表 renderer 共享同一 loader；切换关闭、错误状态或端口时不会继续向旧地址发送源码。

## 已知验收边界

- 自动验证已通过：`npm run typecheck`、`npm run test`（39 个测试文件 / 388 项）、`npm run build`。
- Windows x64 安装包已构建并归档：210,577,133 字节 / 200.82 MiB，SHA-256 `394DFFA219B9329B150D19D33DD0887FC67619551AE7E38093DF841E39B41699`。包内 Java/JAR/许可证已核对，随包 Java 真实渲染和 SANDBOX smoke 通过。
- 尚未在本轮手动启动安装后的 Electron 窗口；该项与自动化及安装包内容核验分开记录。
- 安装包未数字签名，Windows 可能显示 SmartScreen/未知发布者提示；与 v0.15.1 相同。

## 安装与升级

- Windows x64 使用 GitHub Release 提供的安装包。Gitee Release 仅发布本说明并链接 GitHub 下载，不上传超过 100 MB 的安装包。
- 升级前建议按个人习惯备份计划库；应用不改变既有计划文件格式或数据根目录。
- 若以前配置了 PlantUML 地址，升级后该地址作为自定义服务保留；用户可在设置中切回本地服务或关闭服务。

详细版本说明与发布资产以 `builds/release_notes/release_notes_v0.17.0.md` 和 `builds/release_history.json` 为准。
