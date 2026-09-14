# Muya Note Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将指定 MarkText 源码中的 Muya 0.2.0 作为可复现快照引入 Trace，并交付运行真实内核的全功能注释 Demo；正式 NoteCard 集成在 Demo 验收后另立计划。

**Architecture:** Muya 源码隔离在 `vendor/muya`，Trace 通过公开 API 和 React 适配层使用它。Demo 与正式组件复用初始化选项、插件注册、主题桥和安全策略；同一时刻只保留一个活动 Muya 实例，Markdown 字符串仍是持久化真源。

**Tech Stack:** Electron 44、React 19、TypeScript、Vite、Vitest、`@muyajs/core 0.2.0`、Muya/DOMPurify/Prism/Mermaid/Vega/PlantUML。

---

## 文件职责

- `vendor/muya/`：指定 MarkText Muya 源码快照、MIT 许可证和来源指纹，不放 Trace 业务代码。
- `src/renderer/src/components/muya-note/muya-config.ts`：插件一次性注册、默认选项、locale 和 PlantUML 安全策略。
- `src/renderer/src/components/muya-note/muya-theme.css`：Muya CSS 变量到 Trace 语义 token 的映射，以及源码模式覆盖。
- `demo/muya-note-editor/`：真实 Muya Demo，不依赖 Electron 主进程和计划 store。
- `test/muya-vendor.spec.ts`：快照完整性、来源与禁止公共 PlantUML 默认值。
- `test/muya-config.spec.ts`：默认实时渲染、自动补全、自动换行和 PlantUML 配置规则。
- `src/renderer/src/components/muya-note/MuyaNoteEditor.tsx`：Demo 验收后的 React 生命周期与 Markdown 同步适配器。
- `src/renderer/src/stores/pref-store.ts`、`src/renderer/src/App.tsx`：Demo 验收后的正式偏好与设置 UI。

## Task 1：建立可核验的 Muya 快照

**Files:**
- Create: `test/muya-vendor.spec.ts`
- Create: `vendor/muya/**`
- Create: `vendor/muya/UPSTREAM.md`

- [ ] **Step 1：先写失败测试**

```ts
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('vendored Muya', () => {
  it('固定 0.2.0、MIT 许可并记录来源指纹', async () => {
    const pkg = JSON.parse(await readFile('vendor/muya/package.json', 'utf8')) as { name: string; version: string }
    expect(pkg).toMatchObject({ name: '@muyajs/core', version: '0.2.0' })
    expect(await readFile('vendor/muya/LICENSE', 'utf8')).toContain('MIT License')
    expect(await readFile('vendor/muya/UPSTREAM.md', 'utf8')).toMatch(/SHA-256: `[a-f0-9]{64}`/)
  })

  it('PlantUML 不保留公共服务器默认值', async () => {
    const config = await readFile('vendor/muya/src/config/index.ts', 'utf8')
    expect(config).not.toContain("plantumlServer: 'https://www.plantuml.com/plantuml'")
  })
})
```

- [ ] **Step 2：运行并确认因快照不存在而失败**

Run: `npx vitest run test/muya-vendor.spec.ts`

Expected: FAIL，错误指向 `vendor/muya/package.json` 不存在。

- [ ] **Step 3：机械复制指定源码并生成来源记录**

从 `D:\Code\Project\marktext-develop\packages\muya` 复制 `src/`、`package.json` 和许可证所需文件到 `vendor/muya/`，排除 `node_modules/`、`lib/`、测试缓存和构建产物。对复制后的文件清单按相对路径排序并计算组合 SHA-256，将结果写入 `UPSTREAM.md`；记录源目录、版本、复制日期和“源目录不是 Git 工作树，故无 commit hash”。

将 Muya 默认配置改为 `plantumlServer: ''`；PlantUML renderer 收到空服务器时渲染本地配置提示，不回退公共 URL。

- [ ] **Step 4：运行快照测试并确认通过**

Run: `npx vitest run test/muya-vendor.spec.ts`

Expected: 2 tests PASS。

- [ ] **Step 5：提交快照**

```bash
git add vendor/muya test/muya-vendor.spec.ts
git commit -m "feat(note): 引入可核验的 Muya 0.2.0 快照"
```

## Task 2：建立 Trace 的 Muya 配置边界

**Files:**
- Create: `test/muya-config.spec.ts`
- Create: `src/renderer/src/components/muya-note/muya-config.ts`
- Create: `src/renderer/src/components/muya-note/muya-theme.css`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `electron.vite.config.ts`

- [ ] **Step 1：先写默认行为失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { createMuyaOptions, validatePlantumlServer } from '../src/renderer/src/components/muya-note/muya-config'

describe('Muya note config', () => {
  it('默认启用实时写作能力与自动换行', () => {
    expect(createMuyaOptions('')).toMatchObject({
      autoPairMarkdownSyntax: true,
      autoPairBracket: true,
      autoPairQuote: true,
      wrapCodeBlocks: true,
      plantumlServer: ''
    })
  })

  it('PlantUML 只接受 HTTP(S)，空值表示离线', () => {
    expect(validatePlantumlServer('')).toBe('')
    expect(validatePlantumlServer('http://127.0.0.1:8080/plantuml')).toBe('http://127.0.0.1:8080/plantuml')
    expect(() => validatePlantumlServer('file:///tmp/a')).toThrow()
  })
})
```

- [ ] **Step 2：运行并确认因配置模块不存在而失败**

Run: `npx vitest run test/muya-config.spec.ts`

Expected: FAIL，无法解析 `muya-config`。

- [ ] **Step 3：实现最小配置模块**

`createMuyaOptions(server)` 返回已批准的完整 Muya 选项；`validatePlantumlServer` 对空值直接返回，只允许 `http:`/`https:`。`registerMuyaPlugins()` 幂等注册 Emoji、Footnote、InlineFormat、Image、CodeBlockLanguageSelector、LinkTools、ParagraphFront、QuickInsert、Table 和 Preview 插件。

`muya-theme.css` 仅使用 `workspace.css` 已有语义 token；`.trace-muya-source-mode` 将 Muya 的隐藏语法标记恢复为可见，不创建第二套预览态。

- [ ] **Step 4：安装固定本地包与完整依赖**

`package.json` 添加 `"@muyajs/core": "file:vendor/muya"`，并同步 Muya `package.json` 的运行依赖。使用 npmmirror 和 Electron 镜像运行 `npm install`，更新锁文件。

- [ ] **Step 5：验证配置测试和类型检查**

Run: `npx vitest run test/muya-config.spec.ts && npm run typecheck`

Expected: tests PASS；node/web typecheck 0 错。

- [ ] **Step 6：提交配置边界**

```bash
git add package.json package-lock.json electron.vite.config.ts src/renderer/src/components/muya-note test/muya-config.spec.ts
git commit -m "feat(note): 建立 Muya 配置与主题边界"
```

## Task 3：开发真实 Muya Demo

**Files:**
- Create: `demo/muya-note-editor/index.html`
- Create: `demo/muya-note-editor/main.ts`
- Create: `demo/muya-note-editor/style.css`
- Create: `demo/muya-note-editor/vite.config.ts`
- Modify: `package.json`

- [ ] **Step 1：建立真实编辑器入口**

`main.ts` 必须从 `@muyajs/core` 导入 `Muya` 及全部已批准插件，调用 `registerMuyaPlugins()`，用真实 Markdown 初始化实例，并监听 `json-change` 将 `muya.getMarkdown()` 显示到只读调试区。禁止用 `innerHTML` 正则替换模拟 Markdown。

- [ ] **Step 2：加入唯一的实时渲染开关**

开关文案固定为「实时渲染」。开启时使用 Muya 原生 token 显隐；关闭时只给编辑器根添加 `.trace-muya-source-mode`，让 Markdown 标记保持可见。自动换行是另一独立设置，只调用 `muya.setOptions({ wrapCodeBlocks })`。

- [ ] **Step 3：加入完整验收样例**

默认文档包含粗斜删下划线、行内代码、标题、引用、任务列表、表格、数学、脚注、链接、代码块、Mermaid、Vega-Lite、PlantUML、Flowchart 和 Sequence。PlantUML 在空服务器时显示离线提示。

- [ ] **Step 4：加入删除行为观测区**

Demo 顶部列出四个可直接删除的相邻 token：粗体、链接、行内代码和嵌套格式。事件日志记录 `selection-change` 与 `json-change`，用于确认 `Backspace`/`Delete` 只展开当前 token，邻居不退回源码。

- [ ] **Step 5：构建 Demo**

在 `package.json` 添加：

```json
"demo:muya": "vite --config demo/muya-note-editor/vite.config.ts",
"demo:muya:build": "vite build --config demo/muya-note-editor/vite.config.ts"
```

Run: `npm run demo:muya:build`

Expected: Vite build 成功，输出到临时构建目录且不进入 Git。

- [ ] **Step 6：启动 Demo 并交用户验收**

Run: `npm run demo:muya`

验收必须覆盖实时输入、自动配对、代码语言选择、全部图表、中文输入法、撤销重做、剪贴板、唯一实时渲染开关、自动换行和 token 级删除回退。未获得用户确认不得开始 Task 4。

- [ ] **Step 7：提交 Demo**

```bash
git add demo/muya-note-editor package.json package-lock.json docs/HANDOFF-CURRENT.md
git commit -m "feat(note): 添加真实 Muya 全功能交互 Demo"
```

## 后续门槛

本计划在真实 Demo 交付时结束。用户逐项验收实时输入、自动补全、语言选择、图表、IME 和 token 级删除行为后，再根据实际体验编写正式 NoteCard 集成计划；验收前不修改 `cards.tsx`、`pref-store.ts` 或设置宿主。
