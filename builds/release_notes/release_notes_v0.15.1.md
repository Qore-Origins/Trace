# v0.15.1

溯源 Trace 公测版 Beta 5 修订（2026-09-24）——稳定性修复。

- 平台：Windows x64（NSIS 安装包）
- 数据：计划文件格式与数据目录保持不变，可继续使用 v0.15.0 的计划库
- 版本跨度：本版仅包含维护修复，相对 v0.15.0 升一个 patch 版本，不新增功能批次

## 修复

- 双击计划树中的另一计划时，同一路径的重复打开现在会合并为一次读取，消除“载入中…”和计划内容连续闪烁两次的问题。
- Windows 根目录使用正斜杠时，合法子路径不再被误判为越界；`..` 路径穿越仍被拒绝。
- 开发模式启动时预优化本地链接的 Muya 依赖，避免首次进入注释编辑器时因 Vite late dependency optimization 导致页面重载。

## 下载

| 平台 | 文件 | 大小 | SHA-256 |
|---|---|---:|---|
| Windows x64 | [Trace_0.15.1_beta_20260924_01.exe](https://github.com/Qore-Origins/Trace/releases/download/v0.15.1/Trace_0.15.1_beta_20260924_01.exe) | 457.72 MiB / 479952122 B | F7892ED833EFC84C6AA5B9FDD8A7F83C869686C9BDCA95DCF0BAD8BABBEB0EE9 |

Gitee Release 不上传安装包；请通过 [GitHub v0.15.1 Release](https://github.com/Qore-Origins/Trace/releases/tag/v0.15.1) 下载。下载后可用 SHA-256 核对文件完整性。
