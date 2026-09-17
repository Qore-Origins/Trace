# Trace Muya Note Formal Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已验收的真实 Muya 内核接入正式 NoteCard，以单活动编辑器实现同面实时 Markdown 编辑、自动补全和持久化设置，同时保持 Markdown 字符串为唯一数据真源。

**Architecture:** 新建 `MuyaNoteEditor` 封装异步运行时、实例销毁、Markdown 同步和 textarea 降级；用独立 store 保证同一时刻只有一个活动注释编辑器。NoteCard 只负责业务接线，非活动态继续复用 `NoteMarkdown`；不修改 IPC、计划文件格式或 vendor Muya 行为。

**Tech Stack:** React 19、TypeScript、zustand、Ant Design 5、Muya 0.2.0、Vitest、electron-vite。

---

## 文件边界

- Create: `src/renderer/src/components/muya-note/MuyaNoteEditor.tsx` — Muya 生命周期、Markdown 桥接、动态配置与降级。
- Create: `src/renderer/src/stores/note-editor-store.ts` — 单活动注释组件 ID。
- Create: `test/muya-note-integration.spec.tsx` — 偏好、生命周期、单实例和 NoteCard 接线契约。
- Modify: `src/renderer/src/components/cards.tsx` — 移除旧 textarea/格式工具栏双态，接入活动编辑器。
- Modify: `src/renderer/src/components/note-md.tsx`、`test/note-md.spec.ts` — 阅读态链接协议收口，仅允许 HTTP(S) 导航。
- Modify: `src/renderer/src/stores/pref-store.ts` — `noteLiveRender`、`noteWrap`、`plantumlServer` 默认值与 setter。
- Modify: `src/renderer/src/App.tsx` — 设置项、2 秒 Tooltip 和 PlantUML 校验。
- Modify: `src/renderer/src/i18n/locales/zh-CN.ts`、`en-US.ts` — 正式编辑器和设置说明文案。
- Modify: `src/renderer/src/styles/cards.css`、`components/muya-note/muya-theme.css` — 激活态、加载/错误与源码模式样式，仅使用语义 token。

## Task 1：持久化偏好与设置 UI

- [x] 先在 `test/muya-note-integration.spec.tsx` 写失败测试，断言三项默认值分别为 `true`、`true`、空字符串，setter 可更新，App 使用 `Tooltip mouseEnterDelay={2}` 且不再出现“自动渲染”概念。
- [x] 运行 `npx vitest run test/muya-note-integration.spec.tsx`，确认因字段和设置项不存在而失败。
- [x] 在 pref-store 添加字段与 setter；在 App 设置宿主加入实时渲染、自动换行和 PlantUML Server，空值离线，非法协议拒绝保存并通过主题宿主提示。
- [x] 同步中英文文案；运行定向测试和 `npm run typecheck`。

## Task 2：Muya React 生命周期适配器

- [x] 写失败测试，规定适配器必须调用 `loadMuyaRuntime`、初始化 `createMuyaOptions`、监听 `json-change`、卸载前读取最终 Markdown 并 `destroy()`，运行时失败时渲染可编辑 textarea。
- [x] 实现 `MuyaNoteEditor`：异步加载可取消；只对自身未回声的外部 value 调用 `setContent`；实时渲染切换根 class；wrap/PlantUML 通过 `setOptions` 更新；所有颜色来自 Muya 主题桥。
- [x] 定向测试先绿，再运行 Muya 配置、Demo 与 vendor 回归。

## Task 3：NoteCard 单活动编辑器接线

- [x] 写失败测试，规定旧 `Input.TextArea`/七按钮格式栏从 NoteCard 移除，空注释和点击阅读态会激活 Muya，同一时刻仅一个 component ID 活跃，失活/卸载保留最后 Markdown。
- [x] 新建 `note-editor-store.ts`；NoteCard 从偏好读取实时渲染、自动换行和 PlantUML Server，通过 `patchComponent` 写回 `NotePayload.content`；非活动卡继续 `NoteMarkdown`，不保留“预览/编辑”双态按钮。
- [x] 更新卡片样式，保证静态态与编辑态宽度、排版和高度过渡不突跳；运行定向测试、现有卡片注册表和编辑竞态测试。

## Task 4：完整验证与交付

- [x] 运行 `npm run typecheck`、`npm run test`、`npm run build`、`npm run demo:muya:build`，记录真实结果与 chunk。
- [x] 审查危险 HTML/链接仍经 Muya/NoteMarkdown 既有清理，PlantUML 空 Server 不联网，renderer 不直接访问文件系统。
- [x] 更新本计划、`plan.json`、`docs/Plan/README.md` 和 `docs/HANDOFF-CURRENT.md`；提交 `feat(note): 集成 Muya 实时注释编辑器`。
- [ ] 正式卡片仍需用户第二轮真机验收：IME、剪贴板、语言选择、连续删除、切卡 flush、亮暗主题和窄窗口。

## 实施记录（2026-09-17）

- 代码提交：`d0acd3b`（`feat(note): 集成 Muya 实时注释编辑器`），位于 `codex/muya-note-formal-integration`，尚未合并 main、未推送。
- TDD：偏好、生命周期与 NoteCard 三批测试均先红后绿；安全自审额外复现并修复阅读态 `javascript:`/`data:`/相对链接仍生成可导航锚点的问题。
- 最终验证：`npm run typecheck` 0 错；`npm run test` 28 文件 244/244；`npm run build` 成功（renderer 7151 模块，入口 644.91 kB，Muya 核心 2,548.81 kB 与 190.61 kB 样式保持异步）；`npm run demo:muya:build` 3998 模块成功，重型图表大块提示为已批准能力。
- 当前状态：代码与自动验证完成，等待用户在正式 NoteCard 做第二轮真机体验验收；不把 Demo 验收等同正式卡片验收。
