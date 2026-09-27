# 居中胶囊式页面导航 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Track each task in this Markdown and the sibling `plan.json`.

**Goal:** 将「计划 / 日记 / 回忆」改造成窗口水平中轴上的大胶囊页面导航，以柔弹液态滑块区分于「文件 / 编辑 / 查看 / 帮助」命令菜单，同时保留现有页面切换与标题栏行为。

**Architecture:** `useUiStore().view` 是页面状态唯一真源。`TopBar` 读取 `view` 与 `setView` 并提供本地化文案；无状态 `PageNavigation` 负责原生按钮、导航语义和当前态标记。样式以语义 token 绘制轨道、滑块、文字和焦点，滑块仅在胶囊内部运动。不得增加路由状态、IPC、存储字段或依赖。

**Tech Stack:** React 19、TypeScript 5、i18next、CSS custom properties、Vitest、happy-dom。

## 当前状态与已定设计

- 状态：实现与验证完成（2026-09-27；用户选择子代理驱动），代码尚未集成。步骤 1–4 均已完成。Task1–2 双阶段审查通过；Task3 首尾过冲 Important 已按 TDD 修复。Task3 实现提交 `e5503651a90c3ed5601167cb0254dcacc7622974`，最终修复提交 `a8e5e073858091b5ed985b213e24cf6e55f883b4`；独立 scoped re-review Ready。完整实现最终审查 `/root/nav_final_review` Ready，无 Critical/Important/Minor。功能分支 `codex/centered-liquid-view-navigation` 当前 HEAD `4a85706`，等待用户选择本地集成、推送 PR 或保留分支。设计方向：B「居中主导航」+ C「柔弹回落」。正式规格：[`2026-09-27-centered-liquid-view-navigation-design.md`](../../../../../superpowers/specs/2026-09-27-centered-liquid-view-navigation-design.md)。
- 顶栏保持一行 48px；菜单留在左区，中轴胶囊约 226 × 42px，搜索与窗口控制留在右区。
- 页面切换由现有 `setView` 立即生效；唯一选中项及 `aria-current="page"` 均由 `view` 派生。动效不能延迟或排队页面切换。
- 滑块在目标段间柔弹移动并有方向感的轻微拉伸/回落；快速连续点击时从最新位置重新定向。启用系统减少动态效果时取消弹性动效。
- 亮/暗主题一律使用语义 token；保留键盘焦点、no-drag 和 720px 最小窗口下三栏不重叠的约束。

## 文件边界

实现前再次检查 `git status --short --branch`、当前 HANDOFF 与计划状态。实施应在独立 worktree `.worktrees/codex/centered-liquid-view-navigation` 内进行；新建前检查 worktree 列表、目标路径和分支名。登记完成前不得修改以下代码文件。

预计代码与测试边界：

- 新增 `src/renderer/src/components/PageNavigation.tsx`：纯展示组件，接收当前 `ViewName`、导航回调和本地化标签。
- 修改 `src/renderer/src/components/TopBar.tsx`：保留现有 Zustand 状态源，将顶栏划分为左 / 中 / 右区并接入展示组件；菜单行为与文案不重设计。
- 修改 `src/renderer/src/styles/shell.css`：居中布局、胶囊轨道和滑块、响应式压缩、焦点与减少动态效果。
- 修改 `src/renderer/src/i18n/locales/zh-CN.ts`、`src/renderer/src/i18n/locales/en-US.ts`：新增页面导航无障碍名称并保持词典类型一致。
- 新增 `test/page-navigation.spec.tsx`：真实 React + happy-dom 行为测试，不添加测试依赖。
- 修改 `test/frontend-foundation-css.spec.ts`、`test/app-shell.spec.tsx`：补充样式、无障碍/响应式契约；保留既有布局契约。

不修改 `src/renderer/src/stores/ui-store.ts`、`src/renderer/src/App.tsx`、IPC 合约、主进程、Muya、菜单下拉内容或计划数据。若实现前检查发现必须扩大边界，先更新 HANDOFF 并显式登记后再改。

同目录 `plan.json` 的四项任务按本计划四个编号步骤一一对应；步骤内复选框是执行子项。仅当一个编号步骤的全部子项完成且其验证通过后，才把对应 JSON 状态改为 `done`；部分推进标为 `in_progress` 并保留实际勾选状态。

## 执行步骤

### 1. 先建立页面导航行为测试并确认红灯

- [x] 新建 `test/page-navigation.spec.tsx`，先挂载当前真实 `TopBar` 和 Zustand store；使用 `// @vitest-environment happy-dom`、React `createRoot` 与 `act`，参照 `test/muya-note-integration.spec.tsx` 的挂载/清理方式，不引入 Testing Library，也不 mock 页面导航。
- [x] 覆盖独立的「页面导航」无障碍名称、三个原生按钮及显示顺序、每个按钮只切换到对应 `ViewName`，并要求当前项唯一带 `aria-current="page"`。当前实现复用「查看」菜单标签且没有 `aria-current`，测试应具体在这两项断言失败，按钮切页行为作为既有行为回归保护。
- [x] 先运行定向测试并确认是上述真实 UI 断言失败；如果 React/antd 测试环境报错，先修正测试夹具，不能把模块加载错误记作目标 RED。

```text
npm run test -- test/page-navigation.spec.tsx
预期：当前 `TopBar` 集成输出在无障碍名称与唯一 `aria-current` 断言上失败；完成步骤 2 后同一命令通过。
```

### 2. 实现无状态导航组件并接入现有状态与文案

- [x] 新建 `PageNavigation.tsx`，使用 `ViewName` 类型；以 `currentView`、`onNavigate`、标签与导航 aria-label 作为输入，不在组件中保存第二份页面选择状态。
- [x] 三个 `<button type="button">` 分别调用 `onNavigate('workspace' | 'diary' | 'memories')`；当前项设置 `aria-current="page"`，其他项不设置该值。
- [x] 在 `TopBar.tsx` 中继续从 `useUiStore` 读取 `view` 和 `setView`，通过薄容器把既有 `diary.navPlans`、`diary.nav`、`diary.navMemories` 以及新导航名称传给组件。
- [x] 在两份 locale 词典中对齐新增 `navigation.pages`：中文「页面导航」、英文 “Page navigation”；不得再把 `menu.view` 用作页面导航名称。
- [x] 运行组件测试并检查不同 view 下的唯一活动态、按钮标签、切换回调和 locale 词典类型。
- [x] 独立规格审查与代码质量审查均通过；若发现问题，交回当前实施代理修复并复审后再释放文件边界。

```text
npm run test -- test/page-navigation.spec.tsx
npm run typecheck
预期：组件行为测试全绿；node/web TypeScript 检查均通过。
```

### 3. 完成三栏居中布局、胶囊动效与样式契约

- [x] 在 `TopBar.tsx` 中形成左（品牌 + 菜单）、中（页面导航）、右（搜索 + 窗口控制）三个布局组；页面导航以窗口中轴为基准，不用左右剩余空间差制造“看似居中”。
- [x] 在 `shell.css` 中制作约 226 × 42px 胶囊与三个等宽点击段；活动滑块按当前 view 派生位置，使用 `--ease-spring` 做约 500–590ms 的轻微方向拉伸和一次回落，不改变 `view` 更新时机。过冲绘制由圆角胶囊裁切约束。
- [x] 顶栏剩余空间不足时先收缩搜索框，再收敛菜单间距；在 BrowserWindow 最小宽度 720px 时不得出现导航、菜单、搜索、窗口控制相互覆盖、裁切或隐藏。实际 Electron 几何仍由 Task4 验收。
- [x] 轨道、边框、滑块、文字、hover、focus-visible 均使用现有语义 token；确保导航和内部按钮属于 no-drag 白名单。减少动态效果下滑块不执行弹性/拉伸动画，但状态仍即时切换。
- [x] 在 `test/frontend-foundation-css.spec.ts` 覆盖导航专属样式、token 使用、滑块过渡、焦点可见、减少动态效果和 no-drag；在 `test/app-shell.spec.tsx` 更新/扩充紧凑顶栏契约，确保现有一行标签及搜索可收缩约束不回退。
- [x] 运行样式与顶栏定向测试，检查新规则没有新增硬编码颜色或破坏现有 CSS 契约；修复轮定向结果 2 files / 21 tests passed。
- [x] 独立规格审查与代码质量审查均通过；过冲 Important 已按 TDD 修复，`e550365..a8e5e07` scoped re-review Ready，无未解决 finding；Task3 四文件边界已释放。

```text
npm run test -- test/frontend-foundation-css.spec.ts test/app-shell.spec.tsx
预期：新增导航样式/响应式契约与既有前端基础、AppShell 契约全部通过。
```

### 4. 运行完整门槛并进行 Electron 用户视角验收（已完成）

- [x] 在隔离 worktree 运行 `npm run typecheck`、`npm run test`、`npm run build`：typecheck 通过；Vitest 40 files / 396 tests 通过；electron-vite build 成功（renderer 7,156 modules）。
- [x] 启动 Electron 开发版实窗验收：720px、813px、1220px、最大化约 1707px CSS viewport，页面导航始终位于窗口水平中轴，左右菜单/搜索/窗口控件无重叠；三段各约 72.2px。720px 亮/暗主题及宽屏亮/暗主题均检查。最大化测量的中轴偏差约 0.17px。
- [x] 通过真实鼠标与 Tab + Enter/Space 验证三个页面切换、唯一活动项、快速重定向无动画队列；实测弹性滑块移动后回落。经 Chromium reduced-motion media emulation 验证减少动态效果时 CSS transition 为 none / 0s，页面状态仍即时切换。
- [x] 验证文件菜单与 Escape、Ctrl+F 搜索与 Escape、Ctrl+, 设置与 Escape、亮暗主题切换、最小化、最大化/还原、关闭、标题栏双击最大化及拖拽移动。
- [x] 完整实现最终审查 `/root/nav_final_review` Ready，无 Critical/Important/Minor；检查了唯一 view 状态、`aria-current`、溢出裁切、reduced-motion、语义 token 与 no-drag。Electron dev 测试环境的 PlantUML bundled Java runtime 未准备，显示 runtime unavailable；与导航无关，未影响导航与窗口验收。独立 QA profile/测试库未接触用户真实计划库；完成后已对精确临时目录做路径与 reparse-point 核验，并移入 Windows 回收站（可恢复）。

## 完成标准

1. 命令菜单和页面导航第一眼可区分，页面导航相对窗口水平中轴居中。
2. 页面状态仍只由 `ui-store.view` 控制；三按钮、页面、`aria-current` 同步，无额外 IPC/持久状态。
3. 液态动画只发生在胶囊内部；快速切换不排队；减少动态效果仍可正常使用。
4. 720px 最小窗口、亮暗主题、键盘焦点和标题栏 no-drag 均验收，无覆盖或裁切。
5. 定向测试、`npm run typecheck`、`npm run test`、`npm run build` 全部有实测通过记录；Markdown、JSON、README、HANDOFF 状态一致。实现分支尚未合并或推送，等待用户选择集成方式。

## 协作与发布边界

- Task3 代码所有权由实现代理 `/root/nav_task3_implementation` 持有：`src/renderer/src/components/TopBar.tsx`（仅左/中/右布局结构）、`src/renderer/src/styles/shell.css`、`test/frontend-foundation-css.spec.ts`、`test/app-shell.spec.tsx`。只读预检由 `/root/nav_task3_impl` 完成；HANDOFF/计划状态提交已同步到隔离 worktree。其余代码文件不在本次所有权内。
- 仅本地 UI 改动：本计划不包含改版本、编译安装包、推送 GitHub/Gitee 或发布 Release；除非用户之后明确提出，不做发布动作。
- 完成实现与验证后先报告下一步 / 等待 / 剩余工作；不把“设计已确认”写成“实现已完成”。
