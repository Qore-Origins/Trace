# UI设计规范 UI Design Guidelines

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | YYYY-MM-DD |
| 最后修改 Last Modified | YYYY-MM-DD |
| 设计负责人 Design Lead | |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | YYYY-MM-DD | [Name] | | 初始版本 Initial Version |

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
| 清晰 Clarity | 信息传达清晰明确 | 重要信息突出显示 |
| 一致性 Consistency | 视觉和交互保持一致 | 相同功能使用相同样式 |
| 效率 Efficiency | 操作流程简洁高效 | 减少用户操作步骤 |
| 美观 Beauty | 视觉设计美观大方 | 适当留白，和谐配色 |
| 可访问 Accessibility | 确保所有用户可用 | 支持键盘导航，屏幕阅读器 |

### 1.2 设计风格 Design Style

| 风格维度 Style Dimension | 定义 Definition |
|----------------------|---------------|
| 整体风格 Overall Style | 现代简约 Modern Minimalist |
| 色彩风格 Color Style | 明亮清爽 Light & Fresh |
| 圆角风格 Border Radius | 中等圆角 Medium Rounded (4-8px) |
| 阴影风格 Shadow | 轻微阴影 Subtle Shadow |

---

## 2. 色彩系统 Color System

### 2.1 品牌色 Brand Colors

| 颜色名称 Color Name | 色值 Hex | RGB | 用途 Usage |
|------------------|---------|-----|----------|
| **主色 Primary** | | | |
| Primary-50 | #E6F7FF | rgb(230,247,255) | 背景淡色 |
| Primary-100 | #BAE7FF | rgb(186,231,255) | 背景色 |
| Primary-200 | #91D5FF | rgb(145,213,255) | 背景色 |
| Primary-300 | #69C0FF | rgb(105,192,255) | 辅助色 |
| Primary-400 | #40A9FF | rgb(64,169,255) | 辅助色 |
| **Primary-500** | **#1890FF** | **rgb(24,144,255)** | **主色调** |
| Primary-600 | #096DD9 | rgb(9,109,217) | 悬停状态 |
| Primary-700 | #0050B3 | rgb(0,80,179) | 按下状态 |
| | | | |
| **辅助色 Secondary** | | | |
| Secondary-500 | #722ED1 | rgb(114,46,209) | 辅助主色 |
| | | | |
| **强调色 Accent** | | | |
| Accent-500 | #FA541C | rgb(250,84,28) | 强调/警告 |

### 2.2 功能色 Functional Colors

| 颜色名称 Color Name | 色值 Hex | RGB | 用途 Usage |
|------------------|---------|-----|----------|
| **成功 Success** | | | |
| Success-50 | #F6FFED | rgb(246,255,237) | 成功背景 |
| Success-100 | #D9F7BE | rgb(217,247,190) | 成功背景 |
| **Success-500** | **#52C41A** | **rgb(82,196,26)** | **成功主色** |
| Success-700 | #389E0D | rgb(56,158,13) | 成功深色 |
| | | | |
| **警告 Warning** | | | |
| Warning-50 | #FFFBE6 | rgb(255,251,230) | 警告背景 |
| Warning-100 | #FFF1B8 | rgb(255,241,184) | 警告背景 |
| **Warning-500** | **#FAAD14** | **rgb(250,173,20)** | **警告主色** |
| Warning-700 | #D48806 | rgb(212,136,6) | 警告深色 |
| | | | |
| **错误 Error** | | | |
| Error-50 | #FFF2F0 | rgb(255,242,240) | 错误背景 |
| Error-100 | #FFCCC7 | rgb(255,204,199) | 错误背景 |
| **Error-500** | **#F5222D** | **rgb(245,34,45)** | **错误主色** |
| Error-700 | #CF1322 | rgb(207,19,34) | 错误深色 |
| | | | |
| **信息 Info** | | | |
| Info-50 | #E6F7FF | rgb(230,247,255) | 信息背景 |
| Info-100 | #BAE7FF | rgb(186,231,255) | 信息背景 |
| **Info-500** | **#1890FF** | **rgb(24,144,255)** | **信息主色** |
| Info-700 | #0050B3 | rgb(0,80,179) | 信息深色 |

### 2.3 中性色 Neutral Colors

| 颜色名称 Color Name | 色值 Hex | RGB | 用途 Usage |
|------------------|---------|-----|----------|
| **文本色 Text** | | | |
| Text-Primary | #262626 | rgb(38,38,38) | 主要文本 |
| Text-Secondary | #595959 | rgb(89,89,89) | 次要文本 |
| Text-Tertiary | #8C8C8C | rgb(140,140,140) | 辅助文本 |
| Text-Quaternary | #BFBFBF | rgb(191,191,191) | 禁用文本 |
| Text-Disabled | #D9D9D9 | rgb(217,217,217) | 禁用文本 |
| | | | |
| **背景色 Background** | | | |
| BG-White | #FFFFFF | rgb(255,255,255) | 白色背景 |
| BG-Gray-50 | #FAFAFA | rgb(250,250,250) | 浅灰背景 |
| BG-Gray-100 | #F5F5F5 | rgb(245,245,245) | 浅灰背景 |
| BG-Gray-200 | #E8E8E8 | rgb(232,232,232) | 分割线 |
| BG-Gray-300 | #D9D9D9 | rgb(217,217,217) | 边框 |
| BG-Gray-400 | #BFBFBF | rgb(191,191,191) | 禁用边框 |
| BG-Black | #000000 | rgb(0,0,0) | 黑色背景 |

### 2.4 渐变色 Gradients

| 渐变名称 Gradient Name | 起始色 Start | 结束色 End | 角度 Angle | 用途 Usage |
|---------------------|-------------|-----------|----------|----------|
| Primary Gradient | #1890FF | #096DD9 | 135° | 主按钮背景 |
| Success Gradient | #52C41A | #389E0D | 135° | 成功状态 |
| Sunset Gradient | #FF6B6B | #FF8E53 | 135° | 特殊卡片 |
| Ocean Gradient | #4FACFE | #00F2FE | 135° | 特殊卡片 |

---

## 3. 字体系统 Typography

### 3.1 字体家族 Font Family

```css
/* 字体栈定义 */
--font-family-base: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji",
  "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";

--font-family-code: "SFMono-Regular", Consolas, "Liberation Mono", Menlo,
  Courier, monospace;
```

### 3.2 字号规范 Font Size

| 级别 Level | 字号 Size | 行高 Line-Height | 字重 Weight | 用途 Usage |
|----------|---------|----------------|-----------|----------|
| Display-1 | 48px | 1.2 | 600 | 大标题 |
| Display-2 | 40px | 1.2 | 600 | 大标题 |
| Display-3 | 32px | 1.3 | 600 | 页面标题 |
| H1 | 28px | 1.3 | 600 | 一级标题 |
| H2 | 24px | 1.4 | 600 | 二级标题 |
| H3 | 20px | 1.4 | 500 | 三级标题 |
| H4 | 18px | 1.5 | 500 | 四级标题 |
| H5 | 16px | 1.5 | 500 | 五级标题 |
| Body-Large | 16px | 1.6 | 400 | 大号正文 |
| **Body-Regular** | **14px** | **1.6** | **400** | **正文** |
| Body-Small | 13px | 1.5 | 400 | 小号正文 |
| Caption | 12px | 1.5 | 400 | 说明文字 |
| Overline | 10px | 1.5 | 400 | 标签文字 |

### 3.3 字重规范 Font Weight

| 字重名称 Weight Name | 数值 Value | 说明 Description |
|------------------|----------|---------------|
| Thin | 100 | 极细（一般不用） |
| Light | 300 | 细体 |
| **Regular** | **400** | **常规** |
| **Medium** | **500** | **中等** |
| **Semi-Bold** | **600** | **半粗** |
| **Bold** | **700** | **粗体** |

### 3.4 文本样式 Text Styles

| 样式类型 Style Type | 说明 Description | 示例 Example |
|------------------|---------------|-------------|
| 大写 Uppercase | 全部大写 | BUTTON |
| 首字母大写 Capitalize | 首字母大写 | Button |
| 小写 Lowercase | 全部小写 | button |
| 删除线 Line-through | | ~~删除内容~~ |
| 下划线 Underline | | 下划线内容 |

---

## 4. 间距系统 Spacing System

### 4.1 间距规范 Spacing Scale

| 间距名称 Spacing | 变量 Variable | 值 Value | 用途 Usage |
|--------------|-------------|---------|----------|
| nano | --spacing-nano | 2px | 极小间距 |
| xs | --spacing-xs | 4px | 超小间距 |
| sm | --spacing-sm | 8px | 小间距 |
| **md** | **--spacing-md** | **16px** | **常规间距** |
| lg | --spacing-lg | 24px | 大间距 |
| xl | --spacing-xl | 32px | 超大间距 |
| xxl | --spacing-xxl | 48px | 特大间距 |

### 4.2 组件内间距 Component Padding

| 组件 Component | 内边距 Padding |
|--------------|---------------|
| 按钮 Button（小） | 6px 12px |
| 按钮 Button（中） | 8px 16px |
| 按钮 Button（大） | 12px 24px |
| 输入框 Input | 8px 12px |
| 卡片 Card | 16px 24px |
| 弹窗 Modal | 24px |
| 导航栏 Navbar | 0 24px |

### 4.3 组件外间距 Component Margin

| 组件关系 Relationship | 间距 Spacing |
|-------------------|------------|
| 段落间距 Paragraph | 16px |
| 标题与内容间距 Title-Content | 8px |
| 表单字段间距 Form Field | 16px |
| 列表项间距 List Item | 8px |
| 卡片间距 Card Gap | 16px |

---

## 5. 组件规范 Component Guidelines

### 5.1 按钮 Button

#### 按钮类型 Button Types

| 类型 Type | 背景色 Background | 文字色 Text | 边框 Border |
|----------|----------------|-----------|----------|
| Primary | Primary-500 | White | 无 |
| Secondary | White | Text-Primary | BG-Gray-300 |
| Dashed | White | Text-Primary | Dashed BG-Gray-300 |
| Text | Transparent | Primary-500 | 无 |
| Link | Transparent | Primary-500 | 无 |

#### 按钮尺寸 Button Sizes

| 尺寸 Size | 高度 Height | 水平内边距 Padding-X | 字号 Font Size |
|---------|-----------|-------------------|--------------|
| Small | 24px | 8px | 12px |
| **Medium** | **32px** | **16px** | **14px** |
| Large | 40px | 24px | 16px |

#### 按钮状态 Button States

| 状态 State | 样式变化 Style Change |
|----------|-------------------|
| 默认 Default | 默认样式 |
| 悬停 Hover | 背景色加深 |
| 点击 Active | 背景色再加深 |
| 焦点 Focused | 显示焦点环 |
| 禁用 Disabled | 50%透明度，禁用光标 |
| 加载 Loading | 显示Loading图标，禁用点击 |

### 5.2 输入框 Input

#### 输入框规格 Input Specifications

| 属性 Attribute | 值 Value |
|--------------|---------|
| 高度 Height | 32px |
| 内边距 Padding | 8px 12px |
| 边框 Border | 1px solid BG-Gray-300 |
| 圆角 Border Radius | 4px |
| 字号 Font Size | 14px |
| 占位符颜色 Placeholder | Text-Tertiary |

#### 输入框状态 Input States

| 状态 State | 边框颜色 Border | 阴影 Shadow |
|----------|---------------|------------|
| 默认 Default | BG-Gray-300 | 无 |
| 焦点 Focused | Primary-500 | 0 0 0 2px Primary-100 |
| 错误 Error | Error-500 | 0 0 0 2px Error-50 |
| 禁用 Disabled | BG-Gray-400 | 无 |

### 5.3 选择器 Select

| 属性 Attribute | 值 Value |
|--------------|---------|
| 高度 Height | 32px |
| 下拉列表最大高度 Max Height | 256px |
| 选项高度 Option Height | 32px |
| 选项内边距 Option Padding | 8px 12px |

### 5.4 复选框 Checkbox & 单选框 Radio

| 尺寸 Dimension | 值 Value |
|--------------|---------|
| 尺寸 Size | 16px × 16px |
| 边框宽度 Border Width | 1.5px |
| 选中背景 Checked Background | Primary-500 |
| 选中图标 Checked Icon | ✓ |

### 5.5 卡片 Card

| 属性 Attribute | 值 Value |
|--------------|---------|
| 圆角 Border Radius | 8px |
| 阴影 Shadow | 0 2px 8px rgba(0,0,0,0.08) |
| 内边距 Padding | 16px 24px |
| 背景色 Background | White |
| 悬停阴影 Hover Shadow | 0 4px 16px rgba(0,0,0,0.12) |

### 5.6 表格 Table

| 元素 Element | 规范 Specification |
|-----------|-------------------|
| 表头背景 Header Background | BG-Gray-50 |
| 表头文字 Header Text | Text-Primary, Medium |
| 边框 Border | 1px solid BG-Gray-200 |
| 行高 Row Height | 56px |
| 单元格内边距 Cell Padding | 12px 16px |
| 斑马纹 Zebra | BG-Gray-50 |

### 5.7 标签 Tag

| 类型 Type | 背景色 Background | 文字色 Text | 边框 Border |
|----------|----------------|-----------|----------|
| Default | BG-Gray-100 | Text-Secondary | 无 |
| Primary | Primary-50 | Primary-600 | 无 |
| Success | Success-50 | Success-600 | 无 |
| Warning | Warning-50 | Warning-600 | 无 |
| Error | Error-50 | Error-600 | 无 |

---

## 6. 图标系统 Icon System

### 6.1 图标来源 Icon Source

| 来源 Source | 说明 Description |
|-----------|---------------|
| Ant Design Icons | 主要图标库 |
| Heroicons | 辅助图标库 |
| 自定义图标 Custom | 业务特定图标 |

### 6.2 图标尺寸 Icon Sizes

| 尺寸 Size | 像素 Pixels | 用途 Usage |
|---------|-----------|----------|
| XS | 12px | 极小图标 |
| SM | 16px | 小图标 |
| **MD (默认)** | **20px** | **常规图标** |
| LG | 24px | 大图标 |
| XL | 32px | 超大图标 |

### 6.3 图标颜色 Icon Colors

| 状态 State | 颜色 Color |
|----------|---------|
| 默认 Default | Text-Secondary |
| 激活 Active | Primary-500 |
| 禁用 Disabled | Text-Disabled |
| 悬停 Hover | Text-Primary |

---

## 7. 响应式设计 Responsive Design

### 7.1 断点定义 Breakpoints

| 断点名称 Breakpoint | 屏幕宽度 Screen Width | 设备类型 Device | 说明 Description |
|------------------|---------------------|---------------|---------------|
| xs | < 576px | 手机（小） | 小屏手机 |
| sm | ≥ 576px | 手机（大） | 大屏手机 |
| **md** | **≥ 768px** | **平板（小）** | **小平板** |
| lg | ≥ 992px | 平板（大）/桌面（小） | 大平板/小桌面 |
| **xl** | **≥ 1200px** | **桌面** | **常规桌面** |
| xxl | ≥ 1600px | 大屏桌面 | 超大桌面 |

### 7.2 响应式布局 Responsive Layout

| 布局类型 Layout Type | xs | sm | md | lg | xl | xxl |
|------------------|----|----|----|----|----|-----|
| 容器最大宽 Container Max-Width | 100% | 540px | 720px | 960px | 1140px | 1320px |
| 列数 Columns | 1 | 2 | 4 | 6 | 8 | 10 |
| 间距 Gutter | 8px | 12px | 16px | 16px | 24px | 24px |

### 7.3 隐藏显示规则 Show/Hide Rules

| 类别 Class | 显示范围 Display Range |
|----------|---------------------|
| .hide-xs | 隐藏在xs |
| .show-sm | 仅在sm显示 |
| .hide-md | 隐藏在md及以下 |

---

## 8. 动效规范 Animation Guidelines

### 8.1 动效时长 Animation Duration

| 动效类型 Animation Type | 时长 Duration | 说明 Description |
|----------------------|-------------|---------------|
| 快速 Fast | 100-200ms | 小元素变化 |
| 常规 Regular | 200-300ms | 一般过渡 |
| 缓慢 Slow | 300-500ms | 复杂动画 |
| 页面切换 Page Transition | 300-400ms | 页面跳转 |

### 8.2 缓动函数 Easing Functions

| 缓动名称 Easing | CSS值 CSS Value | 说明 Description |
|--------------|----------------|---------------|
| ease-in | cubic-bezier(0.42, 0, 1, 1) | 加速 |
| ease-out | cubic-bezier(0, 0, 0.58, 1) | 减速 |
| ease-in-out | cubic-bezier(0.42, 0, 0.58, 1) | 加速后减速 |
| ease-out-back | cubic-bezier(0.34, 1.56, 0.64, 1) | 回弹效果 |

### 8.3 常用动画 Common Animations

| 动画名称 Animation | 触发场景 Trigger | 时长 Duration |
|----------------|----------------|-------------|
| Fade In | 元素显示 | 200ms |
| Fade Out | 元素隐藏 | 150ms |
| Slide Up | 底部弹出 | 300ms |
| Slide Down | 顶部下拉 | 300ms |
| Scale In | 放大显示 | 200ms |
| Scale Out | 缩小隐藏 | 150ms |
| Shrink | 加载中 | 800ms循环 |

---

## 附录 Appendix

### 附录A：设计资源 Design Resources

| 资源名称 Resource | 链接 Link | 说明 Description |
|----------------|---------|---------------|
| Figma设计稿 | | 完整设计文件 |
| Icon图标库 | | SVG图标资源 |
| 图片素材 | | 品牌图片资源 |

### 附录B：开发资源 Developer Resources

| 资源名称 Resource | 链接 Link | 说明 Description |
|----------------|---------|---------------|
| UI组件库 | | 前端组件库 |
| 设计Token | | 设计变量定义 |
| Sketch插件 | | 设计工具插件 |

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 设计负责人 Design Lead | | | |
| 产品经理 Product Manager | | | |
| 前端负责人 Frontend Lead | | | |

---

**文档结束 End of Document**
