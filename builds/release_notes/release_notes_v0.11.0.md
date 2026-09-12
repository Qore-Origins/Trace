# v0.11.0

溯源 Trace 公测版 Beta 3（2026-09-12 发布）——代码高亮与交互打磨。

- 平台：Windows x64（NSIS 安装包）
- 构建状态：beta（公测版 Beta 3）
- 数据：.plan 明文存储于计划库根目录，可整库拷贝备份；数据不出设备

## 本版新增

- **代码块语法高亮**：注释与自定义组件里的代码块按语言着色（JavaScript/TypeScript/Python/Bash/JSON/CSS/SQL/Go/Rust 等 ~35 种常用语言；配色对齐界面纸面主题；未声明语言的代码块保持纯文本）
- **删除过渡动画**：删除计划/文件夹时行平滑收合，与新建的展开动画对仗（右键与 Delete 键均生效）

## 修复与改进

- 拖拽排序时被拖卡片不再被拉伸成目标卡片的形状
- 新建/重命名重名时弹窗提示具体原因（此前点击无反馈），对话框保持开启可直接改名

## 下载

| 平台 | 文件 | 大小 | SHA-256 |
|------|------|------|---------|
| Windows x64 | [Trace_0.11.0_beta_20260910_01.exe](https://github.com/Qore-Origins/Trace/releases/download/v0.11.0/Trace_0.11.0_beta_20260910_01.exe) | 118.55 MB / 124280807 B | 56114FAB272E5BB880D30BE4BF58DF7FE0C0EED252C42B7DDD4EED45EDA40D96 |

安装包使用本地缓签（无商业证书），Windows SmartScreen 可能提示「运行前确认」——点击「更多信息 → 仍要运行」即可。
