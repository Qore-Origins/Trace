# 可配置计划工作流实施执行记录

> 状态：任务 1–9 已实现并完成相应定向验证；任务 10 的隔离应用验收进行中，尚未覆盖规格九条的全部真实界面路径。2026-10-12。本文是 Codex 与 Claude Code 的共享执行真源；同目录 `plan.json` 只是 Trace 原生任务镜像。

## 目标与依据

按已确认的[设计规格](../../../../../superpowers/specs/2026-10-11-plan-workflow-templates-design.md)，让文件树新建计划按目录自动匹配可配置预设，先展示可修改预览，再生成合适的目标目录、名称和组件；支持周计划与最多七份日计划联动，小沅沿用同一解析器。完整代码文件边界、接口、用例和验收步骤见[技术实施计划](../../../../../superpowers/plans/2026-10-11-plan-workflow-presets-implementation.md)。

## 阶段与任务

### A. 规则与纯预览

- [x] 1. 实现目标日期、目标父目录等命名变量，保留旧模板入口。（分支 `codex/plan-workflow-presets`；见下方验证边界）
- [x] 2. 实现工作流预设配置、作用域匹配及新旧名称规则合成。（见下方验证边界）
- [x] 3. 实现只读预览、冲突报告、序号候选和修订标识。（见下方验证边界）

### B. 单计划创建

- [x] 4. 实现内容模板编译、可选工作流元数据和单计划完整文档创建。（见下方验证边界）
- [x] 5. 接通设置、IPC、文件树自动匹配和可编辑单计划预览。（隔离 Electron 实际点击通过）

### C. 周日联动

- [x] 6. 实现 1+7 批量创建、已有日计划确认、操作记录与安全续做。（隔离 Electron 批量提交及定向失败续做通过）
- [x] 7. 实现周视图汇总、草稿和明确的跨周任务交接。（定向用例通过；原生界面未验收）
- [x] 8. 导入导出、移动与重命名后保持稳定 ID 关联。（定向用例通过；原生界面未验收）

### D. 小沅与验收

- [x] 9. 小沅工具调用同一工作流预览与提交服务，逐目录走权限与确认。（合成工具集成用例通过；真实模型选择行为未验证）
- [ ] 10. 在一次性隔离库完成设计规格九项用户视角验收，并记录真实结果。（进行中）

## 已完成的准备

- 用户确认方案 B 和文件树内按目录自动匹配、可修改预览；随后回复“可以，继续”，进入实施规划。
- 只读检查 `D:\Desktop\Plan`、现有命名模板、单计划创建、IPC、组件、引用与小沅工具边界。
- 设计已获确认，技术实施计划已写明分阶段文件边界；没有对真实计划库执行写入。

## 已实施与实际验证

- 任务 1：新增 `src/shared/plan-workflow-naming.ts`，提供白名单变量、目标日期、目标父目录、分类、周期和序号命名；从旧 `plan-name-templates.ts` 再导出新入口，原有 `formatPlanNameTemplate` 未改语义。新增 `test/plan-workflow-naming.spec.ts`。
- RED：新 spec 初次运行因模块不存在失败；GREEN：新旧命名定向 2 files / 12 tests passed。`npm run typecheck` 通过。
- 默认并行全量 `npm run test`：88 files 中 87 passed、1 failed，1235/1237；失败的是 `agent-target-picker.spec.tsx` 两项 UI 状态等待超时。该文件随后单独运行 4/4 通过。
- 串行全量 `npm run test -- --pool=threads --maxWorkers=1`：同为 1235/1237，失败的是 `diary-automation-coordinator.spec.ts` 两项纽约 DST 预期，当前机器时区为上海；以 `TZ=America/New_York` 单独运行该文件 14/14 通过。全量测试**没有**获得全绿，不把不同配置的定向通过拼成全量通过。`git diff --check` 对任务 1 跟踪文件通过。
- 任务 1 未做 Electron 视觉或真实库验收；目前没有暂存、提交、推送或发布。
- 任务 2：新增 `plan-workflow-types.ts`、配置服务和规则服务；配置保存在每库 `.trace/plan-workflows.json`，可损坏保留、显式启用、保存时检查路径、删除默认预设后回退。旧 `.trace/plan-name-templates.json` 仍是准确父路径权威来源。任务 2 新旧定向 2 files / 12 tests passed，`npm run typecheck` 通过。
- 任务 2 后默认并行全量：89 files 中 87 passed、2 failed，1241/1243；失败分别为 `agent-target-picker` 一项 UI 等待超时与 `storage-service` 一项写入 `SAVE_FAILED`。随后定向重跑两文件为 34/35，UI 文件通过，存储服务另一条用例仍遇 `SAVE_FAILED`；当前未把存储失败归因于工作流代码。全量未通过。
- 任务 3：新增主进程只读解析器，展开生成项，预览最终目标路径、命名规则来源、组件、任务分配、同名与同日期候选冲突及修订标识；不写计划。工作流与旧命名相关 5 files / 30 tests passed，`npm run typecheck` 通过。默认全量 1248/1249，一项既有 `plan-reference-ipc` 写入遇 `SAVE_FAILED`；该文件单独重跑 31/31 通过。全量未通过。
- 任务 4：新增内容模板编译器、工作流周／日可选元数据及主进程校验；存储服务在保留既有小沅初始任务列表校验的前提下增加完整文档 create-only 入口。内容与存储定向 2 files / 35 tests passed；小沅旧操作/工具注册定向 2 files / 87 tests passed；配置/预览回归 2 files / 12 tests passed；`npm run typecheck` 通过。默认全量 1252/1253，失败仍是 `agent-target-picker` 一项 UI 等待超时；全量未通过。未做 Electron/真实库验收。
- 任务 5：实现单计划主进程服务、IPC/preload 白名单、设置页表单和文件树自动匹配预览；用户可改目标目录、最终名称、组件顺序与任务，提交前重跑解析并核对修订。无匹配默认预设回到旧命名弹窗。工作流 UI/IPC/解析器/旧命名弹窗定向 4 files / 19 tests 通过；`npm run typecheck` 与 `npm run build` 通过。全量 1260/1261，一项既有 `agent-target-picker` 等待 UI 状态超时，全量未通过。Electron dev `http://localhost:5173/` HTTP 200，主进程 ready，Windows 窗口标题为“溯源 Trace”；尚未在一次性隔离库中点击验证布局与创建。
- 任务 6：先写七份日计划、后写周草稿，journal 逐项记录，可安全续做；同日旧计划复用需明确选择及任务合并确认。失败注入与幂等续做见 `test/plan-workflow-batch.spec.ts`。隔离 Electron 生产构建经正式 IPC 提交跨年周期 1+7，返回 8 个已创建项，读取落盘文档确认周计划关联 7 个日计划 ID、次日任务按目标日期分配。只验证新建批次，未在 Electron 内注入中途失败。
- 任务 7：周视图按稳定计划 ID 读取日计划并汇总，缺失目标有提示；跨周仅显式逐项交接，目标先写、来源后标记 `moved`，来源写失败报告 partial，重试识别已复制任务。`test/plan-workflow-week-view.spec.tsx` 与 `test/plan-workflow-batch.spec.ts` 通过。隔离 Electron 未点击跨周交接。
- 任务 8：导入冲突重映射同步维护周日关联及任务来源/转移 ID；导入后重命名日计划仍可依 ID 解析。保留既有传输语义：未冲突的 ID 不重映射。`test/plan-workflow-transfer.spec.ts` 单独 1/1 通过。隔离 Electron 未点击导入导出。
- 任务 9：新增小沅 `plan.workflow.preview` 与 `plan.workflow.create`，严格参数 schema，逐目标目录核对本次授权；创建必须经过同一预览修订、独立确认和主进程提交。多文件部分成功时审计记录失败并列出逐文件结果，不宣称成功。`test/agent-tool-registry.spec.ts` 19/19；`test/agent-operation-ipc.spec.ts` 全文件与周视图等定向复跑 84/85，唯一失败为 Windows `EPERM` 批次写，单独复跑该批次文件 5/5；小沅工作流四项新集成用例通过。真实模型是否主动选择工具尚未验证。
- 任务 10 已完成的隔离库部分：`node scripts/trace-workflow-isolated-smoke.cjs` exit 0；生产构建 Electron 中从文件树打开自动匹配的预设，修改标题/目标日期，刷新并确认创建，树中出现 `disposable-library_20261013_QA`；同一隔离库跨年 1+7 批量落盘和关联验证通过；成功现场经精确身份检查后删除。Electron 开发窗口另以 TTY 启动，renderer `http://localhost:5173/` HTTP 200，主进程 `main ready`，窗口标题“溯源 Trace”。未在真实 `D:\Desktop\Plan` 写入。
- 最新 `npm run typecheck` exit 0；`npm run build` exit 0。修正周视图 CSS 所属文件后的全量 `npm run test` 为 97 files 中 95 passed、2 failed，1275/1277；失败为既有小沅目标选择 UI 等待超时和新增导入用例遇 Windows `EPERM`。分别单独复跑为 4/4 与 1/1。全量仍未全绿；不能把单文件结果合并声称全量通过。
- 隔离脚本早期两次因按钮定位错误保留 Temp 现场 `trace-workflow-qa-Boynla`、`trace-workflow-qa-5bViuX`；已确认非产品故障。精确路径清理命令被自动审批拒绝，现场暂存待安全清理，不得对整个 Temp 执行递归清理。
- 小沅 schema 错误诊断现接受 `plan.workflow.preview`、`plan.workflow.create` 三段式工具名，仍仅记录允许的工具名、schema 路径与类型，不记录参数值；`test/agent-provider-http.spec.ts` 增加回归。Provider/工具注册/操作集成定向 3 files / 142 tests，`npm run typecheck` 通过。随后最终一次默认全量 1276/1278、95/97 文件通过；失败转为既有 `agent-target-picker` UI 等待超时和 `plan-reference-ipc` Windows `EPERM`，各自单独重跑 4/4 与 31/31。全量未全绿，失败在不同运行间漂移。
- 扩充同一隔离 Electron 烟测后再次 exit 0：第一周 1+7、下一周 1+7 均完整；主进程 `suggestPeriod` 给出上周结束次日起日，重叠周预览报告 `period_overlap`；显式将未完成任务从上一周日计划移入下一周指定日计划，来源状态 `moved`，目标记录来源稳定 ID；第三周已有同日计划时，无确认批次被拒。成功现场仍按唯一标记删除。此结果覆盖主进程与落盘，周视图按钮及设置页尚未点击。
- 最终源代码重新执行 `npm run build` exit 0；随后基于最新生产 bundle 再跑上述扩充隔离烟测 exit 0。`node --check` 和 `git diff --check` exit 0（后者仅换行符提示）。
- 隔离生产 Electron 又经全局设置快捷键打开设置、切换到工作流导航，实际看到隔离库已保存的 `QA Workflow` 预设，然后关闭设置并完成后续批次。首次加入该检查时，脚本错误地把已关闭但仍保留在 DOM 的 Ant Design 弹窗当作未关闭，留下 `trace-workflow-qa-bZkeIq` 第三个 Temp 失败现场；取消这一错误 DOM 存在断言后完整烟测 exit 0。该失败发生在脚本等待逻辑，后续产品路径未执行；清理限制与前两现场相同。

## 规格第 9 节九项验收覆盖

| 条目 | 当前证据 | 仍需补齐 |
| --- | --- | --- |
| 1. 父目录变量与提前创建 | 隔离 Electron 文件树点击、修改未来目标日、预览与创建一致；命名单测覆盖 `Trace` 目录 | 隔离界面在 `Trace` 目录复核精确示例 |
| 2. 周日与跨年日期 | 隔离 Electron 跨年 1+7 落盘和关联；纯函数单测覆盖闰日 | 闰日生产界面路径 |
| 3. 规则优先级与旧规则 | 配置/解析器定向单测 | 隔离库设置页逐级切换 |
| 4. 自动匹配与手动切换 | 自动匹配已在隔离 Electron 点击；手动切换 UI 单测 | 隔离库手动切换不改默认的界面核对 |
| 5. 预设修改与周日父目录 | 隔离 Electron 设置导航可见已保存预设、批次实际目录名；设置 UI 单测 | 隔离库设置页复制/修改/停用点击 |
| 6. 同日/同名/不安全路径 | 隔离 IPC 同日无确认拒绝；服务定向安全用例 | 隔离界面选择复用/另建并核对同名提示 |
| 7. 周状态与跨周交接 | 隔离 IPC 显式交接、来源/目标落盘；周视图 UI 单测 | 隔离周视图按钮和可见汇总 |
| 8. 小沅与手工预览、部分失败 | 合成工具集成用例与批次失败注入单测 | 隔离 Electron 小沅面板的合成模型交互 |
| 9. 旧库与真实库不改写 | 烟测仅指向唯一 Temp 库，未对 `D:\Desktop\Plan` 写入 | 真实用户库只读确认仍可由用户验收 |

## 执行边界

- 开始各任务前读 `docs/HANDOFF-CURRENT.md` 与 `git status --short --branch`，先登记文件所有权。仓库现有大量未提交改动；不得覆盖别人的工作。
- 源码变更后的 `npm run typecheck`、`npm run test` 与适用的隔离应用验收须记录实际结果；当前结果如上，不将未覆盖的真实界面路径视为通过。
- 不对 `D:\Desktop\Plan` 做开发写入或批量迁移；使用一次性隔离库验收。

## 下一步 / 等待 / 剩余

下一步补齐任务 10 剩余的隔离 Electron 界面路径：预设设置与切换、同日冲突确认、周视图与跨周交接、导入后重命名，以及小沅合成调用与手工预览对照；再查全量测试的偶发 UI 等待和 Windows 原子写 `EPERM` 根因。当前没有必须等待的用户输入；真实小沅模型选择工具、原生 IME/DPI/读屏及真实计划库效果仍未验证。未暂存、提交、推送或发布。
