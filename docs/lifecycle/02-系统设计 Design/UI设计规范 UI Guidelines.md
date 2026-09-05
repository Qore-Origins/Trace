# UI设计规范 UI Design Guidelines

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | 2026-09-05 |
| 最后修改 Last Modified | 2026-09-05 |
| 设计负责人 Design Lead | HeYS-Snowe |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | 2026-09-05 | HeYS-Snowe | HeYS-Snowe | 初始版本 Initial Version（基于 antd v5 默认主题 token） |

---

## 目录 Table of Contents

1. [设计概述 Design Overview](#1-设计概述-design-overview)
2. [色彩系统 Color System](#2-色彩系统-color-system)
3. [字体系统 Typography](#3-字体系统-typography)
4. [间距系统 Spacing System](#4-间距系统-spacing-system)
5. [组件规范 Component Guidelines](#5-组件规范-component-guidelines)
6. [图标系统 Icon System](#6-图标系统-icon-system)
7. [响应式设计 Responsive Design](#7-响应式设计-responsive-design)
8. [动效规范 Animation Guidelines](#8-动效规范-animation-guidelines)

---

## 1. 设计概述 Design Overview

### 1.1 设计原则 Design Principles

| 原则 Principle | 说明 Description | 应用示例 Example |
|--------------|---------------|--------------|
| 计划先行 Plan First | 一切围绕"计划"对象：树即结构、内容即组件 | 左树 280px 常驻 |
| 清楚 Clarity | 状态一眼可读：任务三态/完成/逾期可视化 | 状态 Tag + 勾选线 |
| 一致性 Consistency | 与 antd 默认交互一致（少自定义=少心智负担） | 弹窗/按钮/选中态 全部 antd 语义 |
| 低噪音 Minimal | 计划内容为主要视觉对象，装饰让位于信息 | 无重阴影/无渐变泛滥 |
| 安宁 Calm | 长期使用不刺眼；主色青蓝（溯源/时间语义） | 背景纯白/灰 50 |
| 可访问 Accessibility | 键盘可达、对比度足够、减弱动效支持 | Tab 导航 + prefers-reduced-motion |

### 1.2 设计风格 Design Style

| 风格维度 Style Dimension | 定义 Definition |
|----------------------|---------------|
| 整体风格 Overall Style | 现代简约（antd 默认气质） |
| 色彩风格 Color Style | 明亮清爽（白底 + 青蓝主色 + 灰阶文本） |
| 圆角风格 Border Radius | 默认 6px（antd v5）；卡片/弹窗 8px |
| 阴影风格 Shadow | 轻微阴影（卡片 1 级；浮层/弹窗 2 级） |
| 侧重 Budget | 不增加独立设计语言：全部语义以 antd token 表达，规范仅补充"布局与组合"约定 |

---

## 2. 色彩系统 Color System

> **规则：色彩体系 = antd v5 默认色板（token 引用）**。下方为使用到 token 的值快照（antd 升级时以 token 为准，不手改 hex）；自定义色仅限"溯源路径"高亮（Primary 系）。

### 2.1 品牌色 Brand Colors

| 颜色名称 Color Name | 色值 Hex | antd Token | 用途 Usage |
|------------------|---------|-----------|----------|
| **主色 Primary** | #1677FF | colorPrimary | 主按钮/选中节点/链接/激活态 |
| Primary Hover | #4096FF | colorPrimaryHover | 悬停 |
| Primary Active | #0958D9 | colorPrimaryActive | 按下 |
| Primary BG | #E6F4FF | colorPrimaryBg | 选中背景/标签底 |
| Primary BG Hover | #BAE0FF | colorPrimaryBgHover | 悬停反馈底 |
| Primary Border | #91CAFF | colorPrimaryBorder | 描边反馈 |

**溯源高亮（自定义，基于 Primary 系列）**：回溯定位高亮 = `#1677FF` 30% 透明描边 + 背景 `#E6F4FF` 60%，渐隐 2s。

### 2.2 功能色 Functional Colors

| 颜色名称 Color Name | 色值 Hex | antd Token | 用途 Usage |
|------------------|---------|-----------|----------|
| **成功 Success** | #52C41A | colorSuccess | 任务完成态/完成 Tag |
| Success BG | #F6FFED | colorSuccessBg | 完成背景 |
| **警告 Warning** | #FAAD14 | colorWarning | 逾期标记 |
| Warning BG | #FFFBE6 | colorWarningBg | 逾期 Tag 底 |
| **错误 Error** | #FF4D4F | colorError | 校验错误/危险按钮 |
| Error BG | #FFF2F0 | colorErrorBg | 错误提示底 |
| **信息 Info** | #1677FF | colorInfo | 信息提示=主色 |
| **进行中 Processing** | #1677FF | colorPrimary（蓝） | 任务"进行中"态视觉 |

### 2.3 中性色 Neutral Colors

| 颜色名称 Color Name | 色值 Hex | antd Token | 用途 Usage |
|------------------|---------|-----------|----------|
| **文本主色 Text Primary** | #262626 | colorText（近似） | 标题/正文（antd 为 rgba 黑，取值近似化） |
| Text Secondary | #595959 | colorTextSecondary | 次要文本/路径 |
| Text Tertiary | #8C8C8C | colorTextTertiary | 辅助文本 |
| Text Quaternary | #BFBFBF | colorTextQuaternary | 禁用/占位 |
| 边框 Border | #D9D9D9 | colorBorder | 输入框/按钮边框 |
| 分割线 Split | #F0F0F0 | colorSplit | 树分隔/列表分割线 |
| 背景 BG | #FFFFFF | colorBgContainer | 主背景 |
| 背景灰 BG Gray | #FAFAFA | colorBgLayout | 内容底/悬停 |
| 背景灰 100 | #F5F5F5 | colorFillTertiary | 表头/引用块底 |

### 2.4 渐变色 Gradients

**不使用渐变**（低噪音原则）。如有必要（禁用态/占位），用纯色 + 透明度。

---

## 3. 字体系统 Typography

### 3.1 字体家族 Font Family

```css
--font-family-base: "Segoe UI", "Microsoft YaHei", -apple-system, sans-serif;
--font-family-code: Consolas, "SFMono-Regular", monospace;
```

> Windows（唯一承诺平台）：西文 Segoe UI、中文 Microsoft YaHei；不额外打包字体（文件体积控制）。

### 3.2 字号规范 Font Size

| 级别 Level | 字号 Size | 行高 Line-Height | 字重 Weight | 用途 Usage |
|----------|---------|----------------|-----------|----------|
| H1 | 24px | 32px | 600 | 应用标题（顶栏） |
| H2 | 20px | 28px | 600 | 页面标题/搜索面板标题 |
| H3 | 16px | 24px | 600 | 组件/计划标题 |
| **Body-Regular** | **14px** | **22px** | **400** | **正文/任务行/树节点** |
| Body-Small | 13px | 22px | 400 | 路径/辅助行（检索结果次行） |
| Caption | 12px | 20px | 400 | 状态栏/说明文字 |

### 3.3 字重规范 Font Weight

| 字重名称 Weight Name | 数值 Value | 说明 Description |
|------------------|----------|---------------|
| **Regular** | **400** | 正文/默认 |
| **Medium** | **500** | 树节点/强调行 |
| **Semi-Bold** | **600** | 标题/主操作 |
| Bold（700） | 700 | 仅 H1/H2 备选（常规用 600，控制渲染粗细噪音） |

### 3.4 文本样式 Text Styles

| 样式类型 Style Type | 说明 Description | 示例 Example |
|------------------|---------------|-------------|
| 删除线 Line-through | 已完成任务标题 | ~~任务A~~（+ 文本色降为 Secondary） |
| 无大写变换 | 中文场景无大小写；西文保持原样（产品名固定 "Trace" 首字母大写） | Trace |
| 省略号 Ellipsis | 长名截断（树/列表行） | 2026-A 学期—… |

---

## 4. 间距系统 Spacing System

### 4.1 间距规范 Spacing Scale（antd 8 基数）

| 间距名称 Spacing | 值 Value | 用途 Usage |
|--------------|---------|----------|
| xs | 4px | 图标-文字间隙/勾选框间距 |
| sm | 8px | 行内元素/树节点缩进步长 |
| **md** | **12px** | **表单字段间/组件内部** |
| **lg** | **16px** | **组件间距/卡片内边距** |
| xl | 24px | 分区/面板间距 |
| xxl | 32px | 页面级留白（引导页）/空态 |

### 4.2 组件内间距 Component Padding

| 组件 Component | 内边距 Padding |
|--------------|---------------|
| 按钮 Button | antd 默认（中 8px 15px，高 32px） |
| 输入框 Input / 搜索框 | 8px 12px |
| 组件卡片 Card | 12px 16px |
| 弹窗 Modal | 24px |
| 顶栏 Header | 12px 16px |
| 树节点 Tree Node | 0 4px（缩进 24px/级） |

### 4.3 组件外间距 Component Margin

| 组件关系 Relationship | 间距 Spacing |
|-------------------|------------|
| 组件卡片之间 | 12px |
| 任务行之间 | 8px（紧凑）/ 12px（宽松，可选） |
| 标题与内容 | 8px |
| 面包屑与内容 | 12px |
| 检索结果项之间 | 8px |
| 空态内容 | 居中，四周 32px+ |

---

## 5. 组件规范 Component Guidelines

> 全部基础组件取 antd（Button/Input/Tree/Table/Modal/Tag/Drawer/Spin/Tooltip）。本规范只定义**语义与组合约束**，样式细节以 antd 默认与 §2 色板为准。

### 5.1 按钮 Button

| 类型 Type | 场景 Usage | 语义 Semantics |
|----------|----------|--------------|
| 主要 Primary | 新建计划 / 进入溯源 | colorPrimary 实心 |
| 默认 Default | 次要操作 | 白底描边 |
| 危险 Danger | 删除确认弹窗 确认键 | colorError 实心 |
| 文字 Text | 卡内/树内轻操作 | 无底无边框 |

> 桌面应用仅用"中"尺寸（高 32px）；不做 3 档响应式按钮。

### 5.2 输入框 Input

| 状态 State | 边框 Border | 说明 Notes |
|----------|----------|----------|
| 默认 Default | BG-Gray-300(#D9D9D9) | - |
| 焦点 Focused | Primary(#1677FF) | antd Focus 光环 |
| 错误 Error | Error(#FF4D4F) | 即时校验（计划名非法字符等） |
| 禁用 Disabled | quaternary | 灰底 |

### 5.3 选择器 Select

默认 antd Select；本应用选择器场景少（下拉仅组件类型选择/排序策略），无自定义覆盖。

### 5.4 复选框与勾选 Checkbox

| 尺寸 Dimension | 值 Value |
|--------------|---------|
| 尺寸 | antd 默认（16px） |
| 选中背景 | Primary(#1677FF) |
| 状态语义 | 勾选控件保持 antd 默认蓝 Primary；"完成"语义以**标题删除线 + 行降色**表达，避免双色混淆 |

**任务三态视觉（本项目自定义语义，详见 5.5）**：未开始 = 空勾框；进行中 = 实心蓝 + 文字 Primary；完成 = ⭑ 勾选 + 删除线 + Text Secondary；逾期标记 = 行尾 Warning Tag（展示层）。

### 5.5 卡片 Card（计划单片组件容器）

| 属性 Attribute | 值 Value |
|--------------|---------|
| 圆角 | 8px |
| 阴影 | 0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.05) |
| 内边距 | 12px 16px |
| 背景 | #FFFFFF |
| 类型徽标 | 左上角 Caption 文字（如"任务列表"），弱化（Text Tertiary） |

### 5.6 任务状态标签 Task Status Tags

| 状态 State | 样式 Style | 示例 |
|----------|----------|------|
| 未开始 | 默认（灰底） | 未开始 |
| 进行中 | Processing（蓝底） | 进行中 |
| 完成 | Success（绿底） | 完成 |
| 逾期（展示层） | Warning（橙底） | 逾期 |

### 5.7 标签 Tag

默认 antd Tag；语义映射：计划类型（单选/多选/任务列表/任务详情/注释）——v1.0 以正文顶部分组标题代替 Tag（不额外用色分类，保持低噪）。检索结果类型徽标：任务 = 蓝 Tag，注释 = 灰 Tag，计划 = 无 Tag（靠路径区分）。

---

## 6. 图标系统 Icon System

### 6.1 图标来源 Icon Source

| 来源 Source | 说明 Description |
|-----------|---------------|
| `@ant-design/icons` | 唯一图标源（v1.0 不自定义图标） |

### 6.2 图标尺寸 Icon Sizes

| 尺寸 Size | 像素 Pixels | 用途 Usage |
|---------|-----------|----------|
| SM | 12px | 状态栏/内联标识 |
| **MD (默认)** | **16px** | **树节点/按钮/组件标题** |
| LG | 20px | 顶栏/搜索框 |

### 6.3 图标选型 Map（业务映射）

| 语义 Semantics | 图标 Icon |
|-------------|----------|
| 计划文件夹 | Folder / FolderOpen |
| 子计划 | FolderFilled（不同色阶） |
| 单选计划 | Aim / Flag |
| 多选计划 | CheckSquareOutlined |
| 任务列表 | UnorderedList |
| 任务详情 | FileText |
| 注释 | Comment |
| 搜索 | Search |
| 新建 | Plus |
| 删除 | Delete |
| 溯源定位 | Aim（命中高亮辅助） |

### 6.4 图标颜色 Icon Colors

| 状态 State | 颜色 Color |
|----------|---------|
| 默认 Default | Text Secondary（#595959） |
| 激活/选中 | Primary（#1677FF） |
| 禁用 | Text Quaternary |
| 完成/成功 | Success（#52C41A）（仅任务勾选态） |

---

## 7. 响应式设计 Responsive Design

### 7.1 断点定义 Breakpoints（桌面单窗口）

| 断点名称 Breakpoint | 窗口宽度 Window Width | 布局 Layout | 说明 Description |
|------------------|---------------------|-----------|---------------|
| 紧凑 Compact | < 960px | 树折叠为 Drawer（顶栏按钮唤起）；内容区全宽 | 小窗口/摸鱼模式 |
| 标准 Standard | ≥ 960px | 双栏：树 280px + 内容区自适应 | 默认 |

### 7.2 布局约束 Layout Constraints

| 项 Item | 值 Value |
|--------|---------|
| 最小窗口 | 720 × 480（LLD 落 `mainWindow.setMinimumSize`） |
| 默认窗口 | 1200 × 800（居中） |
| 树宽 | 280px（可拖拽调宽 220-400px，LLD 确认 antd Tree/抽屉实现） |
| 顶栏高 | 48px |
| 状态栏高 | 28px |

---

## 8. 动效规范 Animation Guidelines

### 8.1 动效时长 Animation Duration

| 动效类型 Animation Type | 时长 Duration | 说明 Description |
|----------------------|-------------|---------------|
| 树节点展开/收起 | 150ms | ease-out |
| 编辑态进入/离开 | 120ms | ease-out（轻反馈） |
| 浮动面板/命中列表 | 200ms | ease-out |
| 回溯定位高亮 | 渐隐 2000ms | ease-out；**高亮本身 1 帧出现**（不限时长帧控） |
| 后台重载/索引构建 | 无动画 | 进度条（Spin/Progress）即可 |

### 8.2 缓动函数 Easing Functions

| 缓动名称 Easing | CSS值 CSS Value | 说明 Description |
|--------------|----------------|---------------|
| ease-out | cubic-bezier(0, 0, 0.58, 1) | 一律使用（桌面"收敛"感） |
| 不用回弹/弹性 | - | 低噪音原则 |

### 8.3 常用动画 Common Animations

| 动画名称 Animation | 触发场景 Trigger | 时长 Duration |
|----------------|----------------|-------------|
| Fade In | 命中列表/空态进入 | 200ms |
| 高亮渐隐 | 溯源定位 | 2000ms |
| 插入线出现 | 拖拽悬停 | 即时（0ms） |
| Loading | 索引构建/大计划加载 | Progress 条 |

**减弱动效（可访问性）**：`prefers-reduced-motion` 开启时，全部动画时长 ≤ 50ms（或关闭），仅保留状态变化。

---

## 附录 Appendix

### 附录A：设计资源 Design Resources

| 资源名称 Resource | 链接 Link | 说明 Description |
|----------------|---------|---------------|
| antd Design Tokens | https://ant.design/docs/react/customize-theme | 一切 token 的权威源 |
| antd 组件文档 | https://ant.design/components/overview | 组件默认实现/API |
| 交互原型（98 低保真） | `01-需求分析\原型设计文档 Prototype Design.md` | 布局与结构 |

### 附录B：开发资源 Developer Resources

| 资源名称 Resource | 链接 Link | 说明 Description |
|----------------|---------|---------------|
| 主题定制入口 | antd `ConfigProvider`（App.vue 根包裹，v1.0 默认主题不改 token） | 未来换主题只动此处 |
| 项目结构 | `src/shared/design-tokens.ts`（LLD 落位） | 常量集中 |

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 设计负责人 Design Lead | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 产品经理 Product Manager | HeYS-Snowe | 电子批准 | 2026-09-05 |
| 前端负责人 Frontend Lead | HeYS-Snowe | 电子批准 | 2026-09-05 |

---

**文档结束 End of Document**
