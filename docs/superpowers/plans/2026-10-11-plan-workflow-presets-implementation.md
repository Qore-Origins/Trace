# 可配置计划工作流预设 Implementation Plan

> **For agentic workers:** 按任务顺序实施并逐项勾选。原 `writing-plans` 技能建议使用 `subagent-driven-development` 或 `executing-plans`；本项目是否委派由当次用户指令决定，当前未授权多智能体实施。此文件是实施计划，不代表功能已实现。

**Goal:** 让 Trace 与小沅按当前目录自动匹配可配置工作流，在可修改预览后，按用户的放置、命名、内容及周日联动规则创建计划。

**Architecture:** 主进程提供唯一的预设解析、预览与提交服务；渲染进程只编辑请求和展示结果，小沅通过同一服务提交。配置与现有名称模板并存，旧计划保持可读；周视图以日计划任务为状态真源，批量创建以可恢复的操作记录处理跨目录失败。

**Tech Stack:** Electron 44 / React 19 / TypeScript 5 / zustand 4 / antd 5 / electron-vite 5 / vitest 5；本地 `.trace` 配置和 `plan.json`。

## Global Constraints

- 执行真源：[工作流设计规格](../specs/2026-10-11-plan-workflow-templates-design.md)；本计划不得把目标行为写成当前已实现。
- `{this.folder_name}` 是每个生成项最终目标目录的直接父文件夹名；`{date}` 是明确的计划目标日，格式 `YYYYMMDD`；周期名使用 `{week_start}`、`{week_end}`。
- 自动匹配：准确目录默认 → 已启用分类默认 → 已启用全库默认；同级多个候选让用户选择；无匹配退回现有单计划入口。
- 名称解析：预设显式模板优先；若沿用目录规则，则准确父路径自定义 → 显式分类 → 显式全库 → 未停用内置 → 手填。
- 周日工作流最多创建 1 份周计划和 7 份新日计划；已有日计划须明确复用与合并确认。日计划任务是执行状态真源。
- 新配置在当前库 `.trace/plan-workflows.json`；保留 `.trace/plan-name-templates.json`、旧 `plan.json` 与用户已停用的内置规则。
- 所有写入经主进程 `path-safety.ts`、IPC 合约和现有权限／确认边界；真实库 `D:\Desktop\Plan` 不作为开发或测试夹具。
- 新增代码遵循项目 `AGENTS.md`：严格 TypeScript、不用 `any`、不使用 emoji、早返回。执行源码任务时先核对 `git status --short --branch` 和 `docs/HANDOFF-CURRENT.md`，登记文件所有权；项目要求变更后 `npm run typecheck`、`npm run test`。
- 工作树在编写本计划时已有大量别人的未提交改动，尤其 `storage-service.ts`、`register.ts`、`App.tsx` 和小沅相关文件。每阶段先复核内容并增量修改，不覆盖或回退既有工作。

---

## 文件边界与实施顺序

| 阶段 | 交付能力 | 主要新文件 | 主要既有接线文件 |
|---|---|---|---|
| A | 名称变量、预设配置和纯预览 | `src/shared/plan-workflow-types.ts`、`src/shared/plan-workflow-naming.ts`、`src/main/services/plan-workflow-config-service.ts`、`src/main/services/plan-workflow-resolver.ts` | `plan-name-templates.ts`、`plan-name-template-service.ts` |
| B | 内容模板、单计划提交、设置与文件树预览 | `src/main/services/plan-workflow-content.ts`、`src/main/services/plan-workflow-service.ts`、`src/renderer/src/components/PlanWorkflowSettings.tsx`、`PlanWorkflowCreateModal.tsx` | `plan-types.ts`、`storage-service.ts`、`ipc-contract.ts`、`register.ts`、`preload/index.ts`、`main/index.ts`、`App.tsx`、`NameDialogModal.tsx`、`tree-store.ts`、`SettingsNavigation.tsx` |
| C | 周日批次、周视图、交接、导入导出 | `src/main/services/plan-workflow-batch-service.ts`、`src/renderer/src/components/WeekPlanOverview.tsx` | `plan-repository.ts`、`task-state.ts`、`ContentArea.tsx`、任务卡片、`transfer-service.ts` |
| D | 小沅共用入口与隔离验收 | 无专用文件要求；复用 A–C 服务 | `agent-tool-registry.ts`、`agent-operation-service.ts`、对应 IPC/renderer 提示 |

后续任务只编辑该任务列出的文件，交叉文件先在 `HANDOFF-CURRENT.md` 重新确认所有权。每任务以一个可审查的行为为界，完成后更新共享[执行记录](../../Plan/Future_Plan/Qore/Trace/Plan-261011-02-可配置计划工作流实施/Plan-Workflow-Presets-Implementation-Plan.md)和 `plan.json` 镜像，写入实际验证结果与提交 hash（若有）。阶段验收使用一次性隔离库，不对真实计划库运行写入验证。

### Task 1：目标日期与文件夹命名上下文（阶段 A）

**Files:** Modify `src/shared/plan-name-templates.ts`; Create `src/shared/plan-workflow-naming.ts`; Test `test/plan-workflow-naming.spec.ts`。现有调用 `formatPlanNameTemplate(template, title, date?)` 保持兼容。

**Interfaces:** 导出 `renderWorkflowName(template: string, context: WorkflowNameContext): string` 和 `validateWorkflowNameTemplate(template: string): TemplateValidationResult`。`WorkflowNameContext` 精确包含 `destinationPath`、`libraryRoot`、`title?`、`targetDate?`、`weekStart?`、`weekEnd?`、`createdDate`、`sequence?`；日期输入是 `YYYY-MM-DD` 本地日历字符串。输出名称随后仍过现有文件名校验。

- [ ] 写失败用例：`Feature_Plan/Qore/Trace` + `2026-10-12` + `{this.folder_name}_{date}_{title}` 得 `Trace_20261012_迭代计划`；同一日创建与提前创建结果一致。另测库根、跨年、闰日、空标题且未用 `{title}`、周期内使用 `{date}` 缺独立目标日时拒绝。
- [ ] 运行 `npm run test -- test/plan-workflow-naming.spec.ts`，确认新增用例先因缺导出失败。
- [ ] 仅按白名单逐 token 替换，不执行表达式；拒绝斜线、反斜线、未知 token 与缺少的必需上下文。按最终目标目录求 `{this.folder_name}`，从库根第一级求 `{category_name}`。示例目标：`renderWorkflowName('{this.folder_name}_{date}_{title}', { destinationPath, libraryRoot, title: '迭代计划', targetDate: '2026-10-12', createdDate: '2026-10-11' })`。
- [ ] 运行该 spec、`npm run typecheck`、`npm run test`；只记录真实结果。复核旧两变量格式化测试未退化。
- [ ] 按项目提交规范只暂存本任务文件；如工作树所有权或现有脏改动不明，先交接，不盲目提交。

### Task 2：预设配置、旧命名规则合成与作用域匹配（阶段 A）

**Files:** Create `src/shared/plan-workflow-types.ts`、`src/main/services/plan-workflow-config-service.ts`、`src/main/services/plan-workflow-rule-service.ts`; Modify `src/main/services/plan-name-template-service.ts` only where read-only resolution hook is required; Test `test/plan-workflow-config.spec.ts`。

**Interfaces:** `PlanWorkflowConfig` 含 `format_version: '1'`、`name_rules`、`content_templates`、`presets`；`WorkflowOutput` 含 `destination`、`name_template_mode: 'explicit' | 'inherit'`、`name_template?`、`content_template_id`、`repeat: 'once' | 'each_day'`。`PlanWorkflowConfigService.load(root): Promise<PlanWorkflowConfig>` / `save(root, config): Promise<void>`；`resolveWorkflowPreset(config, selectedPath)` 返回 `matched | candidates | none`；`resolveNameRule(...)` 返回模板和来源。

- [ ] 写失败用例：准确目录默认优先于显式分类、分类优先于全库；同级多候选返回 `candidates`；无默认返回 `none`；停用内置规则保持停用；准确父路径旧规则不向后代继承。
- [ ] 运行 `npm run test -- test/plan-workflow-config.spec.ts`，确认失败原因是尚未实现上述接口。
- [ ] 将用户配置限制为固定 schema：每范围最多一个默认、已知生成次数、已存在的内容模板引用、无路径穿越；保存到当前库 `.trace/plan-workflows.json`，写入临时文件后原子替换。损坏配置返回可展示错误且不重建覆盖。
- [ ] 规则服务在读取旧 `.trace/plan-name-templates.json` 后合成来源；不迁移、不复制、不重新启用被禁用的内置项。删除预设时清除所有指向它的默认绑定。
- [ ] 配置首次为空时给出可编辑的“当前文件夹计划／项目或功能计划／未来计划／周与日联动”建议预设；不自动写入真实库、不改变旧目录默认值。内容模板与命名规则分别保存，新增同类生成项仅改配置。
- [ ] 运行该 spec、`npm run typecheck`、`npm run test`，记录结果并更新共享计划。

### Task 3：确定性的纯预览和冲突报告（阶段 A）

**Files:** Create `src/main/services/plan-workflow-resolver.ts`; Test `test/plan-workflow-resolver.spec.ts`。仅主进程读取目录快照；此任务不写计划文件。

**Interfaces:** `previewWorkflow(input: WorkflowDraftInput, context: WorkflowReadContext): Promise<WorkflowPreview>`；`WorkflowPreview` 含 `library_id`、`preset_id`、`outputs[]`（目标相对路径、展开名称、目标日期或周期、规则来源、组件草稿、已存在对象、冲突）及 `revision_token`。`WorkflowDraftInput` 显式包含库、所选目录、标题、单日目标日或周期、预设选择及逐日分配。

- [ ] 写失败用例：每个输出分别求父文件夹名；七天跨月和周四起周三终；`{sequence}` 预览候选来自目标目录已有同名序列；已有目录、重复目标日、不安全路径和同级规则冲突以结构化项呈现。
- [ ] 运行 `npm run test -- test/plan-workflow-resolver.spec.ts` 确认失败。
- [ ] 按 `once` / `each_day` 展开生成项，最多七个逐日输出；排序稳定。预览只读，拒绝缺失目标目录、未知预设或无效日期；对旧文件只输出待用户确认的候选，不能凭文件名直接认定同日日计划。
- [ ] 对输入、配置及目标文件树生成主进程可复核的 `revision_token`，不能把 token 当成提交授权。运行该 spec、`npm run typecheck`、`npm run test`。

### Task 4：内容模板、元数据和单计划写入（阶段 B）

**Files:** Create `src/main/services/plan-workflow-content.ts`; Modify `src/shared/plan-types.ts`、`src/main/services/plan-repository.ts`、`src/main/services/storage-service.ts`; Test `test/plan-workflow-content.spec.ts`、`test/storage-service.spec.ts`。

**Interfaces:** `compileWorkflowDocument(output: ResolvedWorkflowOutput, ids: WorkflowIds): PlanDocument`；新增可选 `workflow` 文档元数据：周计划 `kind: 'week'` + `status` + `start_date` + `end_date` + `day_plan_ids`，日计划 `kind: 'day'` + `target_date`。`StorageService.createPlanDocument(parentPath, name, document)` 只创建不存在的目录与文件，返回实际路径和 `plan_id`；保留现有 `createPlanWithInitialComponents`。

- [ ] 写失败用例：heading/note/task_list/plan_reference 顺序和标题由内容模板决定；新组件与任务 ID 唯一；旧 v1 文档不含 `workflow` 仍可读；非法 workflow 元数据被拒；同名目录绝不覆盖。
- [ ] 运行相关 spec，确认先失败。
- [ ] 编译时填充 ID、计划 ID 和初始任务状态 `not_started`；在仓库读写验证可选 workflow；在存储层添加创建完整文档的窄入口，沿用 path safety、目录创建与原子 `plan.json` 写入流程。不要把预览中的任意 JSON 原样写入。
- [ ] 运行定向 spec、`npm run typecheck`、`npm run test`，记录结果和现有单计划 `task_list` 兼容行为。

### Task 5：设置入口与单计划可编辑预览（阶段 B）

**Files:** Create `src/main/services/plan-workflow-service.ts`、`src/renderer/src/components/PlanWorkflowSettings.tsx`、`src/renderer/src/components/PlanWorkflowCreateModal.tsx`; Modify `src/shared/ipc-contract.ts`、`src/main/ipc/register.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`、`src/renderer/src/ipc-client.ts`、`src/renderer/src/components/SettingsNavigation.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/components/NameDialogModal.tsx`、`src/renderer/src/stores/tree-store.ts`、相关中英文本与样式； Test `test/plan-workflow-ipc.spec.ts`、`test/plan-workflow-ui.spec.tsx`。

**Interfaces:** 新 IPC `plan-workflow:list`、`plan-workflow:save`、`plan-workflow:remove`、`plan-workflow:preview`、`plan-workflow:commit`；preload 逐项白名单暴露。`PlanWorkflowService.preview(input)` 调用 Task 3；`commit(input, revisionToken)` 在主进程重跑预览并比较库身份、目录快照、规则、名称和冲突后才调用 Task 4。

- [ ] 写失败用例：从文件树目录点新建时匹配默认预设并直接进入可编辑预览；无匹配走旧 `NameDialog`；设置可新建、复制、编辑、停用、删除；切换预设只改本次；预览变脏须刷新；提交后树立即显示新节点。
- [ ] 写 IPC 拒绝用例：未知通道、跨库请求、旧 revision token、目标目录变化、同名与无效模板均不写入。运行两个新 spec 确认失败。
- [ ] 主进程服务只接受结构化参数，保存配置与计划创建走各自 path safety；renderer 不读写文件。保留 `Diary` 专用入口和旧单计划创建路径；`今日任务` 将来从日计划读取，不在本任务复制任务状态。预览列最终相对路径、目标日期、来源、组件顺序、冲突及“需要确认复用”的候选。
- [ ] 运行定向 spec、`npm run typecheck`、`npm run test`；在一次性隔离库手工点文件树新建，核实弹窗遮挡、路径、名称和树刷新，记录实际应用结果。

### Task 6：周日批量创建与安全续做（阶段 C）

**Files:** Create `src/main/services/plan-workflow-batch-service.ts`; Modify `src/main/services/plan-workflow-service.ts`、`src/main/services/plan-workflow-resolver.ts`、`src/shared/plan-workflow-types.ts`; Test `test/plan-workflow-batch.spec.ts`。

**Interfaces:** `commitBatch(input, revisionToken, confirmations): Promise<WorkflowBatchResult>` 返回每个输出 `created | reused | pending | failed` 和恢复标识。批次记录置于当前库 `.trace/`，列操作 ID、库身份、每个新建目录的身份及完成状态；只清理本批确认属于自己的新目录。

- [ ] 写失败用例：周四到下周三生成一个周计划和七个日计划；上周未结束时默认起日取上一份周计划结束次日，并报告范围重叠；空任务日仍生成留白日计划；已有目标日日计划未经确认不合并；重复提交定位已有周草稿；第 N 个写入失败时精确报告已建与待办，不删除既有目录；切换库或外部改动阻断旧预览。
- [ ] 运行新 spec 确认失败。
- [ ] 提交前重新解析全部输出和目标目录身份，先分配所有稳定计划 ID；明确确认复用和任务合并才允许写旧日计划。批次先记录 journal，再逐日写新日计划，最后写周计划引用；每步更新 journal，失败时只回收经身份验证的新目录，回收失败保留记录供续做。不得宣称跨目录文件系统原子性。
- [ ] 运行定向 spec、`npm run typecheck`、`npm run test`，再在一次性隔离库模拟中途失败与续做；记录成功项、失败项及清理结果。

### Task 7：周视图、草稿、交接与任务状态（阶段 C）

**Files:** Create `src/renderer/src/components/WeekPlanOverview.tsx`; Modify `src/shared/task-state.ts`、`src/shared/plan-types.ts`、`src/renderer/src/components/ContentArea.tsx`、`src/renderer/src/components/cards/TaskListCard.tsx`、`src/renderer/src/components/cards/TaskDetailCard.tsx`、`src/main/services/plan-workflow-batch-service.ts` 和周日文案； Test `test/plan-workflow-week-view.spec.tsx`、`test/task-state.spec.ts`。

**Interfaces:** 日计划执行任务依旧落在 `task_list`；旧项转移用显式 `moved` 状态与 `moved_to_plan_id` / `moved_to_task_id` 来源信息，`isOverdue` 对 moved 返回 false。周视图按 `day_plan_ids` 查日任务汇总，目标计划缺失时显示失效项与修复入口，不复制任务状态。

- [ ] 写失败用例：七天摘要显示日期、任务数、完成数和日计划入口；新周为 `draft`；旧周未完成任务先列为待交接，未选择前新周日计划无副本；选择移动后旧项为 `moved` 而非 `done`，新项保留来源。
- [ ] 运行两个 spec 确认失败。
- [ ] 在共享任务类型和状态函数中加入 moved 的受控迁移，更新所有状态展示和统计；交接服务用现有计划写入队列或等价串行边界，先校验源与目标修订，再写目标、写来源标记，失败结果可恢复且不得静默双写。周视图从日计划现值汇总，点击直接定位该日计划。
- [ ] 运行定向 spec、`npm run typecheck`、`npm run test`；隔离库实测跨周草稿和手工交接。记录真实 UI 与数据结果。

### Task 8：导入导出与移动后的关联完整性（阶段 C）

**Files:** Modify `src/main/services/transfer-service.ts`、`src/main/services/plan-repository.ts` 和计划 ID 索引相关服务； Test `test/transfer-service.spec.ts`、`test/plan-workflow-transfer.spec.ts`。

**Interfaces:** 导出保留 `workflow` 元数据；导入为同一批次内 `day_plan_ids`、转移来源/目标 ID 建立旧→新映射，不改引用批次外计划的 ID。计划移动/重命名后按稳定 ID 找目标，路径只是显示快照。

- [ ] 写失败用例：导出后导入一个周计划与七个日计划，ID 全部重建且内部关系指向新 ID；跨批外部引用保留或标记失效，不误连到同名计划；移动后周摘要仍能定位日计划。
- [ ] 运行新 spec 确认失败。
- [ ] 扩展 transfer 现有 ID remap，对新 workflow 字段复用同一映射；旧文档无新字段仍按旧流程；索引重复 ID 时明确报错，不通过旧路径猜目标。
- [ ] 运行定向 spec、`npm run typecheck`、`npm run test`，用隔离库进行导入导出往返和移动验证。

### Task 9：小沅共用工作流入口（阶段 D）

**Files:** Modify `src/main/services/agent-tool-registry.ts`、`src/main/services/agent-operation-service.ts`、必要的 shared agent 类型及操作预览 UI； Test `test/agent-tool-registry.spec.ts`、`test/agent-operation-ipc.spec.ts`、`test/plan-workflow-agent.spec.ts`。

**Interfaces:** 新工具 `plan.workflow.preview` 接受预设 ID、已授权的目标上下文、明确的日期/周期、标题和分配；写入工具 `plan.workflow.create` 引用主进程预览标识及确认信息。两者调用 Task 5/6 的同一服务；原 `plan.create` 保持单计划兼容。每个目标目录必须符合现有 agent grant/确认策略。

- [ ] 写失败用例：小沅与 UI 同输入得到同一输出列表；缺目标日期时请求澄清；未知预设、未授权跨目录目标、外部改动后的旧预览均拒绝；批量操作逐文件路径与组件摘要进入现有确认；取消不创建。
- [ ] 运行新 spec 确认失败。
- [ ] 为工具注册严格参数 schema；模型只给结构化意图，由主进程确定命名、路径、组件与批次。授权检查覆盖每个生成项；不把多次 `plan.create` 伪装为一个事务。所有提示文案说明真实计划数、复用、冲突与部分失败。
- [ ] 运行定向 spec、`npm run typecheck`、`npm run test`；隔离库用合成模型/本地工具请求验证预览及确认。真实 provider 是否正确选用工具另行标为应用验收，不能由合成测试推断。

### Task 10：用户视角验收和收尾（阶段 D）

**Files:** Update `docs/Plan/Future_Plan/Qore/Trace/Plan-261011-02-可配置计划工作流实施/Plan-Workflow-Presets-Implementation-Plan.md`、同目录 `plan.json`、`docs/Plan/README.md`、`docs/HANDOFF-CURRENT.md`；有新增配置说明时同步用户文档。此任务不改真实计划库。

- [ ] 用一次性隔离库核对规格第 9 节全部九条验收行为：目标父目录变量、提前创建的目标日、跨月/年/闰日、优先级、自动匹配及手动切换、周日 1+7 文件与状态真源、已有日计划确认、迁移与重命名、批次中断、UI/小沅预览一致。
- [ ] 记录每条的实际测试命令、运行时间和结果；`npm run typecheck`、`npm run test`、`npm run build` 仅在源码实施完成后运行。产品界面改动按项目规则检查窄窗口遮挡、键盘操作和弹窗滚动。
- [ ] 核对 `D:\Desktop\Plan` 无本轮非预期改动；有无法验证的真实模型行为、损坏旧文档或导入外部引用情形，清楚列为待验，不写成通过。
- [ ] 同步复选框、Trace 任务镜像、HANDOFF 文件所有权与准确提交 hash；仅在实际验证完成后把实现状态改为“已验证”。

## 自审覆盖

- 规格 §3–5 对应 Task 1–5；§6 对应 Task 6–8；§7 对应 Task 3、5、6、9；§8 对应 Task 2、4、8；§9 对应 Task 10。
- 关键风险：现有脏工作树中的大文件接线、旧名称模板与新工作流的优先级、跨目录部分失败、跨周交接双写和导入时 ID 重映射。各自有独立阶段与失败用例，不能用“全量测试通过”替代应用验收。
- 本文只制定实施步骤；当前状态是设计确认、实施未开始。执行前必须重新核对当时的代码和文件所有权。
