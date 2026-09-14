# Trace 当前协作状态

> 此文件是两个开发智能体的**当前唯一协作状态源**。历史交接文件保留为当时快照，不可用其判断当前任务。
>
> 更新：2026-09-14（Claude 核验：HEAD hash 核正 + 登记 F2 实施所有权；上一更新 2026-09-14 Codex 接手核验）

## 接手前必做

1. 阅读本文件、仓库根 `AGENTS.md` 或 `CLAUDE.md`。
2. 执行 `git status --short --branch`，核对本文件的基线提交、分支领先状态与未跟踪文件；不一致时先更新本文件，禁止直接开始实现。
3. 对将修改的文件写明所有权；另一智能体占用或工作区存在相关未提交改动时，不得覆盖，先交接或拆分文件边界。

## 代码库基线

| 项 | 当前状态 |
|---|---|
| 分支 | `main` |
| 本地 HEAD | `4018864` — 多智能体状态同步协议（前序 `65571da` 为 F2 回忆视图原型）。注：前次记录 `35d85fd` 为 hash 笔误，已按 git log 实测核正 |
| 远端基线 | `origin/main` / `gitee/main` = `ded121e`（本地领先 2 个提交，待推送） |
| 已发布版本 | v0.12.0 Beta 4（2026-09-12） |
| 工作区非代码文件 | `Resource/pic/`、`Resource/vid/` 未跟踪，属用户资源，禁止暂存、删除或重命名 |

## 当前工作项：F2 回忆视图

| 字段 | 状态 |
|---|---|
| 阶段 | **已实现 + 已提交（9d4663e，双端已推）；等用户真机验收** |
| 产物 | 原型 `demo/memories-view-demo.html`；spec `docs/superpowers/specs/2026-09-14-memories-view-design.md`；实现 `MemoriesView.tsx` + `diary:memories` 通道（diary-service listMemories） |
| 已验证 | `npm run typecheck` 0 错（2026-09-14）；`npm run test` 176/176（含 +4 memories 用例：onthisday 降序/里程碑 days/random 排除今天/空根） |
| 未验证 | 真机视觉验收（CDP 环境内存受限不可用——交用户 `npm run dev` 顶栏「回忆」走查） |
| 文件所有权 | Claude（F2 已完成）；后续修改须重新登记 |
| 下一工作项候选 | F4 年视图热力 / J2 自动更新 / 渲染层测试基建（路线图见会话记录；等用户点名） |

## 下一动作与阻塞

- 下一动作：用户确认原型的布局、信息密度与三区块范围后，Claude 先写 F2 spec，再开始实现（所有权已登记，见上表）。
- 等待：用户对原型的明确验收意见。
- 禁止并行：未完成 F2 spec 前，两个智能体都不得各自实现回忆页，避免架构和数据模型分叉。
- 待推送：`65571da`（F2 原型）与 `4018864`（协作协议）+ 本次状态核正提交——由 Claude 随本次同步推送双端。

## 核验记录

| 时间 | 智能体 | 动作与验证 |
|---|---|---|
| 2026-09-14 | Codex | 接手核验：建立本文件，确认原型 node --check 通过 |
| 2026-09-14 | Claude | `git status --short --branch` 实测：ahead 2（65571da + 4018864），工作区仅用户资源未跟踪 ✓；HEAD hash 核正（35d85fd→4018864，git log 实测）；登记 F2 实施所有权（文件边界见上表）；推送双端（含本核正提交） |

## Claude 致 Codex 的交接备忘（长期有效的技术约定）

1. **基线**：typecheck 0 错 + test 172/172（v0.12.0 后）。接手后先跑一遍对齐；低于此数说明环境/代码被动过。
2. **深色主题已全量落地**——新写 UI **必须用 workspace.css 的语义 token**（--paper/--text-*/--warn-bg/--danger-text/--hl-* 等），**禁硬编码色**（本会话刚完成 40 处收敛，别再新增）。原生控件（date picker/滚动条）靠 `color-scheme` 已兜住。
3. **弹层禁用 antd 静态方法**（`message.*`/`Modal.confirm`）——它们不吃主题算法，暗色下发白。一律经 `src/renderer/src/antd-host.ts` 的 `getMessage()`/`getModal()`（antd App 组件绑定，全库 24 处已迁移）。
4. **ERROR 库高价值条目**（`D:\Code\.Rules\ERROR\entries\`）：`inline-span-transform-ignored`（动画容器必须 block/inline-flex，裸 span transform 静默失效）、`catch-comment-claims-phantom-mechanism`（注释声称"由别处处理"的兜底，先验证机制真实存在）、`gitee-release-chinese-garbled`（Gitee 发布四坑：SSH 推送/`target_commitish` 参数/中文走 UTF-8 JSON 文件传输/附件 100MB 上限）。
5. **发布惯例**：版本三件套（package.json + package-lock + CLAUDE.md 当前版本行 + CHANGELOG）→ build:win → 归档 builds/windows/ + SHA-256（pwsh Get-FileHash）→ build_history/release_notes/release_history 三账本 → GitHub `gh release create + upload` → Gitee API（payload 文件法）→ 双端 push。
6. **排序契约**：树子项 = `localeCompare(b, 'zh-CN', { ignorePunctuation: true })`——混用分隔符的命名按日期直觉序（2026-09-12 修复，勿回退为无参 localeCompare）。

## 更新协议

每次开始、完成、暂停或移交一个工作项时，实施智能体必须原子更新本文件，至少写清：

- 当前 HEAD、远端领先/落后状态、工作区例外；
- 阶段、已完成项、尚未完成项、验证命令及其实际结果；
- 当前文件所有权和下一动作；
- 已知阻塞、用户待确认事项。

不得把“已讨论”“已写原型”“测试应当会通过”写成“已实现”或“已验证”。
