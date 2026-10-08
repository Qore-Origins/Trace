# v1.0.0 — 溯源 Trace 正式版：计划协作与小沅 Agent

相较 v0.18.1，本版跨越多个完整功能域，标志着溯源 Trace 进入 1.0.0 正式版。

## 新增与改进

- **日记自动补建**：激活计划库后在后台补齐缺失的空白日记；保留已有日记内容并使用 checkpoint，避免应用重启后重复创建已删除的日期。
- **计划名称模板**：按目标文件夹配置命名规则；新建时自动填入日期与前缀，用户只需补充自定义内容。
- **计划标签页与引用**：支持工作区计划标签页、跨计划链接和只读嵌入；改名、删除等操作可预览引用影响并选择同步更新。
- **小沅 Agent**：用户可配置模型服务与个人 API Key，使用 `@` 指定计划或文件夹、选择上下文并预览外发内容；会话和操作记录保存在本地，可追溯。
- **授权计划操作**：小沅通过白名单工具创建或编辑计划内容；每批操作先预览并遵循确认策略，计划与文件夹删除统一进入可恢复回收站。
- **隐私边界**：不默认上传整库；模型外发请求由主进程控制的隔离预览流程授权后发送。API Key 不进入聊天记录。

## 兼容性与已知边界

- 本版新增计划引用组件与工作区标签页数据；现有计划仍由本地 Markdown/JSON 文件管理。升级前仍建议按个人习惯备份计划库。
- `npm run typecheck` 与 `npm run build` 通过。合入后串行全量测试为 85 files / 1190 tests，1187 passed / 3 failed；用户批准跳过这三个失败门槛以继续发布。两个 DST 用例在 `TZ=America/New_York` 下和 SearchService spec 定向复跑共 22/22 通过；一次 SearchService `SAVE_FAILED` 未在重跑中复现，原因未明。全量测试不标记为全绿。
- 用户侧原生键鼠、IME、DPI、窄窗口、屏幕阅读器和 NSIS 安装/卸载验收仍需人工完成。
- 安装包未数字签名，Windows 可能显示 SmartScreen 或未知发布者提示。

## 构建产物

- Windows x64 安装包：`builds/windows/Trace_1.0.0_stable_20261009_01.exe`
- 大小：210,738,662 字节（200.98 MiB）
- SHA-256：`76ED2D64F0313D0D9FDBE3333BDC306D6C10E839513BBE27D0328BDF1EA8157E`
- 本地构建产物：`release/溯源 Trace-1.0.0-setup.exe`
- 安装包未数字签名；Windows 可能显示 SmartScreen 或未知发布者提示。

## 发布渠道

- GitHub Release：<https://github.com/Qore-Origins/Trace/releases/tag/v1.0.0>
- Windows x64 安装包：<https://github.com/Qore-Origins/Trace/releases/download/v1.0.0/Trace_1.0.0_stable_20261009_01.exe>
- Gitee Release：<https://gitee.com/Qore/trace/releases/v1.0.0>；仅发布本说明，不上传安装包。
