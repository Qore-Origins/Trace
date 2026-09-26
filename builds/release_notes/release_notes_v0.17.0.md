# v0.17.0 — 溯源 Trace 公测版 Beta 6

本次发布包含两个独立功能域：任务列表三态反馈与完全离线 PlantUML。相对 v0.15.1，本次按功能跨度递增至 v0.17.0；计划文件格式和数据目录保持兼容。

## 新增功能

### 任务状态三态

任务状态按「未开始 → 进行中 → 已完成 → 进行中」循环，保留回退能力；一次点击即可获得对应状态反馈。

### 完全离线 PlantUML

- PlantUML 和精简 Java 运行时随应用提供，无需在电脑上单独安装 Java 或服务，也不需要联网渲染。
- Trace 窗口优先启动，PlantUML 服务在窗口显示后于后台初始化。
- 设置中可选择本地服务、自定义服务或关闭服务，查看端口和服务状态并重试；升级时保留已有自定义服务地址。
- 内置服务仅监听本机 `127.0.0.1`，通过 SANDBOX 禁止本地文件和 URL include，并关闭统计。

## 修复与兼容

- Muya 图表预加载与正式 renderer 共用同一 loader 实例；关闭服务、服务出错或切换端口后，旧地址不会继续收到注释源码。
- 注释图表处于等待服务时，编辑器仍可继续使用。
- 任务 Markdown 格式、既有计划内容和数据目录不变。

## 安装包与校验

Windows x64 安装包：`Trace_0.17.0_beta_20260926_01.exe`（210,577,133 字节 / 200.82 MiB）；SHA-256：`394DFFA219B9329B150D19D33DD0887FC67619551AE7E38093DF841E39B41699`。相较 v0.15.1 的 479,952,122 字节，减少 269,374,989 字节（56.13%）。已核对包内 Java、PlantUML JAR、模块清单与许可证；包内 Java 本机渲染 SVG 和 SANDBOX smoke 通过。

安装包未数字签名，Windows 可能显示 SmartScreen/未知发布者提示；这与上一版 v0.15.1 相同。本轮没有手动安装并交互启动 Electron GUI。安装包仅附于 GitHub Release；Gitee Release 不上传安装包，并链接 GitHub 下载资产。

自动验证：`npm run typecheck`、`npm run test`（39 个测试文件 / 388 项）、`npm run build`、`npm run build:win` 通过。安装包归档路径：`builds/windows/Trace_0.17.0_beta_20260926_01.exe`。GitHub Release 附带该安装包；Gitee Release 同步本说明并链接 GitHub 下载，不附安装包。

GitHub Release 页面：<https://github.com/Qore-Origins/Trace/releases/tag/v0.17.0>

Windows x64 安装包下载：<https://github.com/Qore-Origins/Trace/releases/download/v0.17.0/Trace_0.17.0_beta_20260926_01.exe>
