# Trace v1.0.0 正式版发布计划

> 状态：已完成（2026-10-09）
> 版本：v1.0.0 · 溯源 Trace 正式版
> 上一发布：v0.18.1 · 公测版 Beta 7 修订

## 范围与版本决策

本次正式版涵盖多个完整功能域：日记自动补建与计划名称模板、计划标签页与跨计划引用、小沅 Agent 与用户授权的计划操作/统一回收站。与 v0.18.1 的增量达到正式版里程碑，按用户批准的版本跨度升至 `1.0.0`，而非只增加一个 patch/minor。

发布范围为已合入 `main` 的 Task 8 集成及其依赖功能；不把未完成的用户侧安装/输入体验验收或 CDP runner 诊断宣称为已通过。完整测试有 3 项失败，用户明确批准跳过后继续发布；该例外在本计划与发行说明中保留。

## 执行队列

- [x] 更新版本号、CHANGELOG、生命周期发布说明与发行说明。
- [x] 运行 typecheck、集成后的全量测试、build 与 Windows x64 NSIS 构建；如实登记测试结果。
- [x] 核验安装包版本、大小、SHA-256、PlantUML 随包资源与构建归档一致性。
- [x] 将 v1.0.0 版本提交与 annotated tag 推送到 GitHub/Gitee；核验两端 main/tag。
- [x] 发布 GitHub Release（附安装包）与 Gitee Release（仅说明，不上传 exe）；核验正文、asset digest 与远端状态。
- [x] 回填 build/release 账本、计划索引与 HANDOFF。

## 验证与发布证据

- `npm run typecheck`、`npm run build`、`npm run build:win` 通过。
- 全量测试：85 files / 1190 tests，1187 passed、3 failed。两个 DST 用例在 `TZ=America/New_York` 下与 SearchService spec 定向复验共 22/22 通过；SearchService 曾出现的 `SAVE_FAILED` 重跑未复现，根因未知。用户批准跳过 3 项继续发布；全量测试不标记为全绿。
- 安装包：`builds/windows/Trace_1.0.0_stable_20261009_01.exe`，210,738,662 bytes / 200.98 MiB，SHA-256 `76ED2D64F0313D0D9FDBE3333BDC306D6C10E839513BBE27D0328BDF1EA8157E`。本地构建输出与归档大小/哈希一致，PE ProductVersion `1.0.0.0`、FileVersion `1.0.0`；PlantUML runtime 149 个文件路径/哈希一致，app.asar 28,017 条记录且未发现项目 QA 路径。安装包未数字签名。
- 发布提交：`7819ff6ad778456059f9232d69cd2c1c34986740`；annotated tag object：`6c610ac102e976092b3f752efb27814e1913c1d8`。发布记录最终提交：`aa8c99c70b5dcc28b1fa2bd87ac035172f615aed`。本地、GitHub `main`、Gitee `main` 均核验为最终记录提交；两端 tag peel 到发布提交。
- GitHub Release：[v1.0.0](https://github.com/Qore-Origins/Trace/releases/tag/v1.0.0)，asset 大小 210,738,662 bytes，远端 digest 与本地 SHA-256 匹配。
- Gitee Release：[v1.0.0](https://gitee.com/Qore/trace/releases/v1.0.0)，未上传 exe，仅有 Gitee 自动生成的源码归档。

## 发布后仍待人工验收的边界

- NSIS 安装/卸载交互，以及用户侧原生键鼠、IME、DPI、窄窗口和屏幕阅读器体验尚未执行。
- Task 8 CDP runner 有失败记录；Claude 报告 D3 通过，但 Codex 未独立重跑。8A 偶发保存失败的自然根因仍未知；有界重试是韧性措施，不是根因修复。
- 等待用户安装体验并报告结果；此项不改变 v1.0.0 已发布的事实。
