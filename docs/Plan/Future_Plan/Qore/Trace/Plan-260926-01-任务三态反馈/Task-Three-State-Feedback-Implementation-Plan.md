# Task 三态视觉反馈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复任务列表从未开始第一次切到进行中时没有视觉反馈的问题，同时保持既有三态状态机和数据格式。

**Architecture:** TaskListCard 已按 TaskItem.status 输出行状态类；缺陷仅在 cards.css 仍选择旧的 doing 类。本计划用现有前端样式契约测试先复现，再把样式选择器改为 in_progress，不改状态转换、持久化或组件结构。

**Tech Stack:** React 19、TypeScript、CSS 语义 token、Vitest。

---

## 范围与文件边界

- 修改 src/renderer/src/styles/cards.css 中任务进行中状态选择器。
- 修改 test/frontend-foundation-css.spec.ts，增加状态类与视觉选择器一致的回归契约。
- 不修改 TaskListCard、shared/task-state、计划文件格式或任务完成数逻辑。

本计划 plan.json 中的三个任务与下方三个编号步骤一一对应；步骤内复选框是执行子项。只有一个编号步骤全部完成后，才把对应镜像任务标记 done；部分推进时标记 in_progress 并保留子项勾选状态。

## 执行步骤

### 1. 先加入失败的视觉契约测试

- [ ] 在 test/frontend-foundation-css.spec.ts 中增加一个任务状态反馈用例，要求进行中圆环、标题样式都选择真实的 in_progress 类，并拒绝旧 doing 选择器。

    在测试顶部现有 css/workspace 常量下读取 TaskListCard 源码不是必需的；渲染类由现有组件代码确认，回归测试应专注于本次错误的 CSS 合约：

        it('styles the task state emitted for in-progress rows', () => {
          expect(css).toContain('.task-row.in_progress .state-ring')
          expect(css).toContain('.task-row.in_progress .task-title input')
          expect(css).not.toContain('.task-row.doing')
        })

- [ ] 运行定向测试，确认新增断言在当前代码上失败，失败原因为找不到 in_progress 选择器。

    验证命令：

        npm run test -- test/frontend-foundation-css.spec.ts

### 2. 修复进行中状态选择器

- [ ] 在 src/renderer/src/styles/cards.css 中，将两条 .task-row.doing 规则改为 .task-row.in_progress；保留当前 --link、--trace-500、--trace-bg token 和现有过渡参数。
- [ ] 不新增硬编码颜色，不改变 .task-row.done 的勾号、删除线及回退表现，不触碰状态机。

    目标规则：

        .task-row.in_progress .state-ring { border-color: var(--link); background: var(--trace-500); box-shadow: 0 0 0 3px var(--trace-bg); }
        .task-row.in_progress .task-title input { color: var(--link); }

- [ ] 重跑定向测试，确认新增契约变绿。

    验证命令：

        npm run test -- test/frontend-foundation-css.spec.ts

### 3. 完成自动与用户视角验证

- [ ] 运行 shared 状态机测试和完整 typecheck/test/build，记录真实结果。

    验证命令：

        npm run test -- test/task-state.spec.ts test/frontend-foundation-css.spec.ts
        npm run typecheck
        npm run test
        npm run build

- [ ] 启动 Electron，使用未开始任务依次点击三次：确认第一次立即出现进行中圆环/标题反馈；第二次出现完成勾号与删除线；第三次恢复进行中样式。亮色、暗色、鼠标和键盘激活均检查一次。
- 若人工验收发现状态写入正确但样式未更新，沿 React class、CSS 加载和主题 token 三层追根因，不以测试通过代替用户视角验收。

## 完成标准

- 首次点击状态为 in_progress 时圆环填色/外环及标题颜色立即出现。
- 第二次与第三次交互保持现有完成和回退行为。
- 自动化验证全绿，亮/暗主题无硬编码颜色。
- Markdown 与同目录 plan.json、docs/Plan/README.md、docs/HANDOFF-CURRENT.md 同步；提交前记录实测 HEAD 与测试结果。
