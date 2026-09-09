# 组件体系扩展 + 计划截止日期 设计（2026-09-09）

> 状态：已批准（用户 2026-09-09 确认）；阶段目标：从"计划软件"向"计划+日记"演进，现阶段仍以计划为主。
> 用户决策：心情评分=1-100 数字自由输入（可小数）、标题=字号滑杆、预设=插入即快照、日期=默认今天可改、计划截止日期=计划文档级（可选、可清空）。

## 一、背景与目标

现有组件 5 种（single_plan / multi_plan / task_list / task_detail / note）。本次新增：

1. `mood` 今日心情（日记向）
2. `heading` 标题（可调字号）
3. `custom` 自定义组件（Markdown + 可保存预设）
4. `PlanDocument.due_date` 计划截止日期（可选、可清空）

约束：不引入新依赖（沿用自研 NoteMarkdown）；契约向前兼容（旧包/旧文档零迁移）；未知类型已有 FallbackBlock 降级。

## 二、数据契约（src/shared/plan-types.ts）

### 类型联合扩展

```ts
export type ComponentType = 'single_plan' | 'multi_plan' | 'task_list' | 'task_detail' | 'note' | 'mood' | 'heading' | 'custom'
```

### 新 Payload

```ts
export interface MoodPayload {
  score: number        // 0-100，允许小数（写入前收敛 ≤2 位）；必填（新卡默认 50）
  text: string         // 心情描述，≤20000（复用 validateNoteText）
  mood_date: string    // YYYY-MM-DD，默认今天，可改（补写场景）
  created_at: string   // ISO
}

export interface HeadingPayload {
  title: string        // ≤200（validateTitle）
  size: number         // 字号 px，14-32，默认 18
}

export interface CustomPayload {
  content: string      // Markdown 原文，≤20000
  source?: string      // 来源预设名（快照提示，不参与语义）
}
```

### PlanDocument

```ts
export interface PlanDocument {
  format_version: '1'  // 不变（可选字段兼容）
  created_at: string
  updated_at: string
  components: Component[]
  due_date?: string    // 'YYYY-MM-DD'；undefined=未设置；旧文档缺键即未设置
}
```

## 三、组件交互设计

### mood（今日心情）

- 卡渲染：左侧大数字（score，随分值色阶：≤30 冷灰蓝 → ≥80 暖橙，线性插值）；右侧描述多行纯文本；日期行（原生 `input[type=date]`）可改；卡尾创建日期
- 编辑态：数字输入（0-100 校验，clamp+报错如超界）、描述 textarea、日期控件同卡
- 新卡默认 score=50、mood_date=今天、text=''
- 校验：`validateScore`（shared/validation，数字、0≤x≤100、两位小数收敛）

### heading（标题）

- 渲染：`fontSize = size` px，字重 600，单行纯标题
- 编辑：标题输入 + 滑杆（14-32，默认 18，实时预览）；空标题时卡呈编辑态
- 校验：`validateTitle` 复用；size clamp 14-32

### custom（自定义组件）

- 卡体 = Markdown 双态（view 用 NoteMarkdown 渲染；edit 用 textarea + 完成钮）——与 note 卡同构，抽公共组件 `MdContent`（note 改用它，custom 使用它，消除重复；MdContent 职责：content 值 + onChange + 渲染/编辑双态 + 链接拦截）
- **预设**：存 `pref-store`（zustand persist，与语言/发牌方向同机制，零新增 IPC）

```ts
interface CustomPreset { id: string; name: string; content: string }
// pref-store 新增: customPresets: CustomPreset[]
// 动作: addPreset / removePreset
```

- 插入菜单「自定义组件」子菜单：预设列表（点击插入快照）+「新建自定义组件」
- 卡内「保存为预设」按钮 → 命名对话框（复用 NameDialogModal，参数化：注入预设名校验函数 `(s)=>void` 与文案键，不增加硬编码 mode）→ 存入
- 删除预设：菜单条目 hover 显示删除钮；预设不重命名（第一版）
- 快照语义：插入时复制 `content` 到新建 custom 卡（`source=预设名`）；改预设不影响已插入卡

## 四、截止日期（两级，用户澄清：组件级为重点）

### 4.1 计划文档级（PlanDocument.due_date，2026-09-09 用户已确认实现）

- `PlanDocument.due_date?: string`（'YYYY-MM-DD'）；计划=树节点语义（BR-005）；纯文件夹节点无此字段
- UI（内容区计划头部）：未设置→「＋ 截止日期」轻按钮；已设置→日期可改+清除钮；过期红警示
- 保存链路：savePlan 随文档原子写；清空=删除键；校验：`validateDueDate`（已实现并提交 c3f7ce9/5f35f9f）

### 4.2 计划组件级（single_plan.due_date，Task 2b——用户真实意图：**每一个计划文件中的每一个计划组件**）

- `SinglePlanPayload.due_date?: string`（'YYYY-MM-DD'；undefined=未设置；新卡默认无）
- UI（SinglePlanCard 摘要下方）：`input[type=date]` 可设置/清空（清空=删除键）；过期（<今天）红字 + `cards.overdue` 文案（键已存在）
- 校验复用 `validateDueDate`；`todayDateStr()` 移入 shared/validation（ContentArea 已有本地 todayStr 不动）
- 测试：validation.spec 增 todayDateStr 格式用例；CDP 设置/清除/过期红三态验证

## 五、搜索与计数

- `search-service.indexComponentInto` 增 case：
  - `mood` → scope `note`，text=`text`（描述），matched_field `note_content`（描述当笔记检索）
  - `heading` → scope `plan`，text=`title`，matched_field `title`
  - `custom` → scope `note`，text=`content` 原文（md 原文检索，含代码块文本），matched_field `note_content`
- `due_date` 不纳索引（日期检索语义后置）
- SearchOverlay 零改动（scope 复用现分组）

## 六、测试策略

| 层 | 项目 |
|----|------|
| validation | validateScore（边界 0/100/负数/超界/小数收敛）、validateDueDate（格式/非法日期/空串拒绝） |
| search-service | 新增 3 类型索引用例（mood/heading/custom 命中与 scope 归属） |
| plan-types | due_date 可选字段类型用例（存储读写往返） |
| note-md | 现有 8 用例不动（复用回归） |
| 总数 | 预计 100 → 108±（新增 8± 用例） |

## 七、实施顺序

1. **due_date 先行**（契约层小改，涉及现有保存链路，先落地隔离风险）：plan-types → validation → storage 保存 → 内容区头部 UI → 测试
2. 组件批次：plan-types → validation → search-service → cards.tsx（mood/heading）+ MdContent 抽取 + custom → insertItems 菜单 + 子菜单 → pref-store 预设 → NameDialogModal 参数化 → 测试
3. i18n 中英全量新键

## 八、推荐后续组件（下批候选，本批不做）

① 附件组件（拖文件存路径引用）→ ② 目标进度组件（百分比+里程碑）→ ③ 回顾组件（"距今天 N 天，当时的你写下……"—日记味最浓）→ ④ 标签组件（#tag 聚合检索）
