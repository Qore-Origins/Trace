# v0.18.0 — 溯源 Trace 公测版 Beta 7（顶栏居中胶囊导航）

本次相对 v0.17.0 增加一个完整用户可见功能域：将「计划 / 日记 / 回忆」从普通菜单项升级为顶栏中轴上的胶囊选择器，使页面切换与「文件 / 编辑 / 查看 / 帮助」命令菜单清楚区分。

## 新增与改进

- 页面导航作为独立胶囊固定在窗口水平中轴，与左侧命令菜单保持视觉和空间区分。
- 选中状态通过胶囊内部液态滑块表达；滑块轻柔拉伸后回落，快速连续切换不会累积动画队列。
- 页面仍由现有单一 view 状态驱动，没有引入重复状态、IPC 通道或持久化字段。
- 使用原生按钮和当前页无障碍语义，支持键盘操作；系统减少动态效果偏好下关闭弹性过渡。
- 窄窗口下优先收缩搜索框，避免导航与菜单、窗口控件重叠；亮暗主题均使用现有语义色。

## 兼容与验证

- 计划 Markdown 格式、数据目录、IPC 合约和用户数据均不变，无需迁移。
- 自动验证：`npm run typecheck`；`npm run test`（40 files / 397 tests）；`npm run build`（renderer 7,156 modules）；`npm run build:win` 均通过。
- UI Electron 实窗验收覆盖 720 / 813 / 1220 / 最大化窗口、亮暗主题、鼠标与键盘切换、快速重定向、减少动态效果、菜单/搜索/设置及窗口控制；无重叠或裁切。打包版 Electron 在隔离临时用户配置和临时空库内通过首启引导、计划库初始化、全文搜索与回溯到源注释组件检查。
- Windows x64 安装包：`Trace_0.18.0_beta_20260927_01.exe`，210,584,915 字节 / 200.83 MiB；SHA-256：`EBDF485209FEFB2FB3E9922BC091AE14C192D26A7E0FDE13F3FCC9867017855B`。包内 FileVersion/ProductVersion 均为 0.18.0，`app.asar` 未包含 QA profile/cache/log。NSIS 安装交互未单独执行。
- 随包 PlantUML runtime 共 148 个文件，均与构建准备目录哈希匹配；从打包路径运行 Java 成功离线渲染 SVG；PlantUML loopback-only、SANDBOX 拒绝本地/URL include、禁用统计与进程正常退出 smoke 通过。
- 安装包未数字签名，Windows 可能显示 SmartScreen/未知发布者提示。

## 下载

- GitHub Release：<https://github.com/Qore-Origins/Trace/releases/tag/v0.18.0>
- Windows x64 安装包：<https://github.com/Qore-Origins/Trace/releases/download/v0.18.0/Trace_0.18.0_beta_20260927_01.exe>
- Gitee Release：<https://gitee.com/Qore/trace/releases/v0.18.0>。Gitee 仅发布本说明，不上传超过 100 MB 的安装包。
