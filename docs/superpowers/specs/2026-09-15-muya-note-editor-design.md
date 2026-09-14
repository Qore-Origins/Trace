# Trace 注释 Muya 实时 Markdown 编辑器设计

## 1. 目标

将 `D:\Code\Project\marktext-develop\packages\muya` 中的 `@muyajs/core 0.2.0` 编辑能力完整移植到 Trace 注释组件，使注释在同一编辑面内实时渲染 Markdown，并具备 MarkText 同源的自动补全、块转换、代码语言选择、复杂图表、撤销重做、粘贴与中文输入法行为。

Markdown 字符串仍是唯一持久化格式。Muya 的 JSON State 仅作为活动编辑器的内存状态，不改变现有 `NotePayload.content`、计划文件格式或主进程存储边界。

## 2. 已批准的产品决策

- 自动渲染默认开启。
- 自动渲染关闭时不退回旧 textarea；继续使用 Muya 编辑面，但完整显示 Markdown 标记。
- 自动换行是独立持久化设置，默认开启。
- 设置项名称悬停 2 秒后显示描述；键盘聚焦时同样可查看描述。
- 启用 Muya 全功能：CommonMark、GFM、自动配对、代码块语言选择、表格、数学、脚注、链接、图片、Mermaid、Vega/Vega-Lite、PlantUML、Flowchart、Sequence、快捷插入、格式浮层、撤销重做、搜索替换、剪贴板和 IME。
- PlantUML 功能保留，但默认不连接公共服务器。用户配置本地或自有服务器后才请求渲染。
- 先完成独立可运行的真实 Muya Demo，用户验收后才能集成正式注释卡。

## 3. 方案比较与结论

### 方案 A：内置 Muya 源码快照（采用）

把经过审计的 Muya 版本放入 Trace 仓库的独立 workspace 包，保留 MIT 许可证、上游声明、版本及来源指纹。Trace 直接构建这一固定快照。

优点是行为与指定 MarkText 源码一致、构建可复现、无需依赖开发机绝对路径，并可在 Trace 内修复上游问题。代价是仓库和依赖体积增加，升级必须经过差异审查。

### 方案 B：依赖 npm 的 `@muyajs/core`

仓库较轻，但已检查的本地版本标为 `0.2.0` 且处于开发批次，公开注册表版本和本地修复集合不一定一致。它不能保证复刻用户指定源码，因此不采用。

### 方案 C：在 Trace 内重写实时编辑器

会重复实现 selection、IME、剪贴板、Markdown 往返、虚拟 DOM、块树、图表和安全清理，短期只能得到外观相似的残缺版本，因此不采用。

## 4. 仓库与许可边界

Muya 作为独立包存放于 `vendor/muya/`，不混入 Trace 业务组件：

```text
vendor/muya/
├── LICENSE
├── UPSTREAM.md
├── package.json
├── src/
└── assets/
```

`UPSTREAM.md` 记录来源目录、`@muyajs/core` 版本、复制日期、文件清单摘要及内容 SHA-256。当前 `marktext-develop` 目录不是 Git 工作树，不能编造 commit hash；首次快照用版本、锁文件和内容哈希建立可核验基线。

正式业务只通过 `src/renderer/src/components/muya-note/` 下的适配层访问 Muya，不直接依赖其内部块类。未来升级只替换 vendor 包并运行适配层测试。

## 5. 编辑器生命周期与性能

计划可包含大量注释卡，不能为每张卡常驻完整 Muya。采用单活动编辑器模型：

1. 非活动注释卡用 Muya 的安全静态渲染结果展示。
2. 用户点击某张卡后，该卡挂载一个完整 Muya 实例并恢复光标。
3. 切换卡片、切换计划或卸载组件时，先同步最终 Markdown，再调用 `destroy()` 清理监听器和浮层。
4. 同一时刻最多一个完整 Muya 实例；图表渲染器按 Muya 原有动态导入机制加载。
5. 空注释首次聚焦直接挂载编辑器，不经过“预览/编辑”双态按钮。

静态态和编辑态共享 Muya 排版变量，避免激活时字体、间距和高度突然变化。编辑态只增加光标、语法标记和工具浮层。

## 6. 数据流

```text
NotePayload.content
        ↓ 初始化
Muya markdownToState → 活动 JSON State → contenteditable DOM
        ↑                                      ↓ 用户输入
        └──── getMarkdown ← json-change ← OT 操作
                              ↓ 150 ms 防抖
                    patchComponent(content)
```

- `json-change` 后通过 `muya.getMarkdown()` 获取 Markdown，150 ms 防抖写入 zustand；blur、切卡和卸载前强制 flush。
- 适配器保存最近一次由自身写出的 Markdown，避免 store 回写再次调用 `setContent()` 造成光标跳动。
- 外部文件监视导致当前注释内容变化时：未聚焦则立即 `setContent()`；已聚焦则保留本地编辑并显示冲突提示，不静默覆盖。
- Muya 初始化失败时保留原 Markdown，显示主题兼容的错误提示，并降级到现有 textarea，确保数据仍可编辑。

## 7. 自动渲染与自动补全

自动渲染开启时沿用 Muya 原生规则：格式化内容持续排版；光标进入某一格式 token 时只显示该 token 的灰色 Markdown 标记，离开后收起。标题、列表、引用、代码块、表格和图表均在同一编辑面转换。

自动补全直接启用 Muya 原生选项：

- `autoPairMarkdownSyntax: true`：`**`、`*`、`~~`、反引号、行内数学等成对标记。
- `autoPairBracket: true`：圆括号、方括号、花括号自动闭合。
- `autoPairQuote: true`：单双引号自动闭合。
- 围栏代码块输入语言时显示 `CodeBlockLanguageSelector`，支持 Prism 语言以及 Mermaid、Vega-Lite、PlantUML、Flowchart、Sequence。
- `/` 快捷插入使用 `ParagraphQuickInsertMenu`；选区格式使用 `InlineFormatToolbar`。

自动渲染关闭时，通过适配层选项让语法标记保持可见，但不关闭自动配对、代码补全、历史和结构化编辑。

## 8. 图表与网络安全

- Mermaid、Vega/Vega-Lite、Flowchart、Sequence 在渲染进程本地执行。
- PlantUML Server 默认值为空；空值时展示“需要配置 PlantUML Server”的本地占位，不发送网络请求。
- 设置中允许填写 `http://localhost`、局域网或 HTTPS Server。配置值须校验为 `http:`/`https:` URL。
- 启用远程 PlantUML 前明确提示：图表源码会编码进请求 URL并发送给所选服务器。
- Muya 的 HTML 输出保持 DOMPurify 清理，链接仅允许现有安全策略批准的协议，外链使用 `noopener,noreferrer`。
- 图片选取和本地路径必须通过现有 IPC/path-safety 链，不让 Muya 直接访问 Electron 或文件系统。

## 9. 设置模型

`pref-store` 新增：

- `noteAutoRender: boolean`，默认 `true`。
- `noteWrap: boolean`，默认 `true`。
- `plantumlServer: string`，默认空字符串。

旧 `trace-prefs` 无新字段时由 zustand persist 的默认状态补齐。设置 UI 使用 antd 主题上下文；描述通过 `Tooltip mouseEnterDelay={2}` 提供，不使用浏览器 `title` 代替。中英文文案同步增加。

## 10. Demo 阶段

在 `demo/muya-note-editor/` 创建隔离的 Vite Demo，使用与正式适配层相同的 Muya 包和主题 token。Demo 必须能实际输入，不能用静态 HTML 模拟。

验收场景：

1. 输入 `**粗体**`、反引号、括号和引号，验证自动配对及光标位置。
2. 输入三个反引号并选择 TypeScript，验证语言候选与高亮。
3. 输入 Mermaid、Vega-Lite、PlantUML、Flowchart、Sequence 围栏，验证本地图表和 PlantUML 离线占位。
4. 测试标题、列表、任务列表、引用、表格、数学、脚注、链接和图片。
5. 测试中文输入法组合输入、撤销重做、复制粘贴和跨块选区。
6. 切换自动渲染与自动换行，确认没有双态 textarea，设置说明延迟 2 秒出现。
7. 反复创建/销毁编辑器，确认无残留浮层、监听器或持续增长的实例数。

用户确认 Demo 后才能进入正式 NoteCard 集成。

## 11. 正式集成边界

- 新建 `MuyaNoteEditor` React 适配组件，负责实例生命周期、事件桥接、主题、locale 和 flush。
- `cards.tsx` 的 NoteCard 只负责卡片业务、激活状态和 `NotePayload` 接线，不承载 Muya 内部逻辑。
- 现有 `note-md.tsx` 暂留作失败降级与非活动卡静态回退；待 Muya 静态渲染路径经过兼容测试后再决定是否删除。
- 原有 7 个固定格式按钮由 Muya 的选区工具与快捷插入替代，不保留两套重复工具栏。
- 不修改主进程 IPC 合约和计划文件格式。

## 12. 测试与验收门槛

- vendor 快照：许可证、来源指纹、关键导出及依赖完整性检查。
- 单元测试：偏好默认值/迁移、Markdown 同步防抖、外部更新防回声、URL 校验和降级路径。
- 真实浏览器测试：selection、IME、自动配对、代码语言选择、剪贴板、图表预览和实例销毁。
- 集成测试：NoteCard 激活切换、计划切换前 flush、旧 Markdown 无损往返、自动渲染设置实时生效。
- 安全测试：危险 HTML、`javascript:` 链接、图片路径、PlantUML 空 Server 与非法 Server。
- 项目门槛：`npm run typecheck`、`npm run test`、`npm run build` 全部通过；用户真机验收 Demo 和正式卡片两轮。

## 13. 非目标

- 本阶段不改变其他计划组件为富文本编辑器。
- 不引入协作服务器或 OT 网络传输。
- 不默认连接公共 PlantUML 服务。
- 不重做 Trace 整体视觉；Muya 仅适配现有语义 token 和卡片布局。
