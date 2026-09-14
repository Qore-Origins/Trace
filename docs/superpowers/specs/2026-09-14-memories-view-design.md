# 回忆视图设计（F2 · 那年今日/里程碑/随机回忆）

> 2026-09-14 · 原型已获用户确认（demo/memories-view-demo.html，"按照 demo 执行"）；本 spec 固化实现细节。

## 1. 目标

日记软件属性的下一步：把"过去的自己"呈现出来。独立回忆页（顶栏第三导航），三区块 + 当日预览。

## 2. 决策记录

| # | 决策 | 选择 |
|---|---|---|
| D1 | 形态 | 独立回忆页（用户三选一拍板，弃"那年今日嵌入卡"/"启动闪现"） |
| D2 | 布局 | 三区块（那年今日/里程碑/随机回忆）+ 右列当日预览，照 demo 定稿 |

## 3. 数据层（diary-service 扩展）

新函数 `listMemories(planRoot): Promise<MemoriesPayload>`，一次枚举 `Diary/` 全目录：

- **onthisday**：`MM-DD` 与今天相同且年份更早的日计划，按年份**降序**（最近的过去在前）
- **milestones**：整数天前的今天且有记录——通式 `n % 100 === 0 || n % 365 === 0`（n ∈ [100, 3650]），按 n 升序；条目带 `days`
- **random**：全部历史日（排除今天）随机一天；无记录为 `null`

聚合口径复用 `aggregateDay`（score=首张 mood 分；notePreview=首 note 前 60 字；compCount=组件数）。今天由 main 侧 `todayDateStr()` 取（与 diary:ensure 一致）。

## 4. IPC（diary 域扩展）

```
diary:memories { req: {} } → {
  today: string
  onthisday: Array<DiaryMemoryEntry>
  milestones: Array<DiaryMemoryEntry & { days: number }>
  random: DiaryMemoryEntry | null
}
DiaryMemoryEntry = { date, score, notePreview, compCount }
```

## 5. 渲染层

- `ui-store.view` 扩展 `'memories'`；TopBar ViewNav 加「回忆」第三钮（i18n `diary.navMemories`：回忆/Memories）
- `MemoriesView.tsx`：三区块卡片网格（年份/N 天前 徽标 + 心情色分数 + 摘要首行）+ 右列当日预览（点卡片 → `diary:day` 摘要 + 「在树中打开」复用日记视图同款动作）；样式走语义 token（双主题天然适配）
- 「在树中打开」：与 DiaryView 同款——App 级接线（setView('workspace') + 定向双刷新 + locate）

## 6. 边界

- 只统计日记根下日计划；普通计划不进回忆
- 今年今天的日计划不算回忆（onthisday 排除；random 排除今天）
- 无任何历史记录时三区块空态文案

## 7. 测试

diary-service.spec 新增：onthisday 跨年匹配与降序、里程碑存在性（造 100 天前目录）、random 排除今天、坏 JSON 目录跳过（复用既有语义）。
