# 小沅计划操作与统一回收站设计规格

- 日期：2026-10-03
- 状态：产品范围已确认；独立规格复审 Ready，按实施计划分批开发
- 阶段：智能体 Phase 2（计划操作）
- 前置：Phase 1 小沅基础层 `ba17704c7d6fd91923f362a099e3974c32f62668`；跨计划引用 Task 5 `ca378166d72ac6db6a3aaa7ecfdfd20388b3781d`
- 范围决策：全应用统一计划/文件夹回收站；日记页与日记目录不纳入本阶段

## 1. 目标

让小沅能在用户明确指定的计划/文件夹范围内，通过 Trace 定义的受限工具读取和修改计划；把模型请求、目标授权、本地变更、确认、执行、撤销与引用影响形成可追溯的本地会话记录。计划树、菜单/快捷键与小沅共用同一可恢复删除机制，消除普通 UI 永久删除和 Agent 删除语义不一致。

所有工具执行位于 Electron main process。模型只提出结构化工具调用；Trace 自己验证对象身份、当前库、版本、路径、权限、引用影响和用户决定。`@` 只标记本次消息的目标/范围，不是写授权，也不是外发授权。

## 2. 用户已确认的行为

### 2.1 `@` 目标与读取

- 同一条消息允许选择多个 `@计划` / `@文件夹`；目标标签只属于本条消息，不延续到下一条。
- main 为用户消息生成内部 ID，在主进程控制的隔离预览窗确认精确外发快照、并将该消息提交到会话时，将该次冻结预览实际展示的 target refs 绑定到此 ID；renderer/provider 不得指定、重绑或扩大此范围。绑定是单次的，同一消息的请求重试和工具续轮可沿用已确认 refs，但不能在同一消息的后续预览中追加目标；新目标必须进入新的用户消息与新预览。main 工具解析必须携带并校验当前消息 ID。仅被取消的外发预览不会消耗 grant 绑定。
- 对已有计划/文件夹执行操作而目标未明确时，小沅追问并要求选择 `@` 目标；绝不默认为当前打开计划。
- 新建不是对既有对象的操作，不要求 `@`；未指定父文件夹时创建到计划库根目录。若用户选了 `@文件夹`，它仅作为本次新建的父目录。
- `@计划` 授予本地只读理解权限，不代表可写。`@文件夹` 只授予该文件夹本身的目标身份、直接子项只读枚举及作为新建父目录的范围；它不递归读取/写入子树。用户可对这个被明确标注的文件夹本身提出改名、移动或移入回收站操作，但主进程必须展示整个受影响子树及引用影响并执行对应确认；不得借此逐项读取/修改子计划。需要对子计划读写时，先列出具体对象并由用户逐个选择/标注。
- 回收站读取可以通过只读 `trash.list` 查看当前活动库条目；列表返回项不会签发恢复/清除写授权。用户可在目标选择器中将单个回收站条目标注为 `@回收站条目`，其 grant 绑定库身份、root generation、entry ID、manifest revision/digest；它仅允许生成该条目的恢复/永久清除预览，不能直接提交。也可在回收站 UI 选择精确条目发起同一预览。每种写操作在用户确认后签发操作专属、一次性 commit token。
- `@` 或本地工具读取不会自动把正文发送给模型。任何读取结果进入下一次模型请求前，必须重新显示准确的外发预览；用户可取消发送，已完成的本地操作不会因此自动撤回。
- 任何模型网络请求都必须通过主进程控制的隔离预览窗确认，包括普通聊天、工具结果续发和模型能力测试。窗体显示将要发送的目标服务/模型与完整 request body；确认 IPC 只接受来自当前预览窗主 frame 的一次性决定。调用普通 renderer 的 `agent:request:send` 或能力测试 IPC 本身不构成用户确认。取消、关闭、导航、崩溃或过期一律不发请求。隔离窗不暴露通用 Trace IPC、API Key、计划文件路径或持久化预览正文。
- 同名目标以相对路径/类型区分。目标不存在、已移动、库已切换或身份不唯一时停止并要求重选；禁止按同名静默重绑。
- `@` 计划 grant 不得为分配身份而修改计划文件。对已有有效 `plan_id` 的计划，grant 绑定 `plan_id`、规范相对路径、已校验的目录身份、`updated_at`、library UUID 与 root generation。对 `plan_id` 缺省的计划，按用户 2026-10-04 确认，使用规范相对路径、已校验的目录身份、`updated_at`、library UUID 与 root generation 形成仅本轮有效的只读身份快照；不调用会写入 `plan.json` 的 `PlanReferenceService.commitTarget`。任一值变化、目标移动/替换或切库均使 grant 失效，不按名称回退。
- 模型工具只接收主进程签发、绑定本轮目标、当前用户消息、活动库及版本快照的短期不透明引用，不接受模型提供的磁盘路径或任意绝对路径。每个 target grant set 不得跨用户消息重绑或解析。

### 2.2 白名单工具

首期限于计划库内的计划与文件夹，以及同一库的回收站：

1. 列出已选文件夹的直接子项（非递归）并读取已选计划。
2. 在根目录或用户指定的父文件夹创建计划/文件夹。计划使用对应父目录的现有命名模板；外发/本地操作预览均显示生成后的完整名称。不得覆盖同名项。
3. 以 `shared/plan-types.ts` 当前 discriminated union 为封闭 schema，查询、添加、更新或删除组件/任务；不接受额外键、不接受 `plan_id`、组件 ID 或系统时间由模型指定，每次写通过稳定 ID 与计划 `updated_at` 做 CAS。保留无法识别的旧组件且只读。首期支持已知 `single_plan`、`multi_plan`、`task_list`、`task_detail`、`note`、`mood`、`heading`、`custom` 的受限字段写入；`plan_reference` 仅可经现有引用服务及影响确认修改。
4. 重命名、移动计划/文件夹；计划级重命名与删除继续走 Task 5 `PlanReferenceService` 的影响预览、逐条选择、并发复核和提交队列。
5. 将计划/文件夹移动到本计划库回收站；只读列出回收站条目；恢复精确条目；在二次强确认后永久清除精确条目。列表结果本身不授权恢复或清除。

不提供任意文件系统读写、Shell、动态插件、MCP 或通用代码执行。Phase 2 不让小沅修改 Diary 日记内容；日记读取仍沿用 Phase 1 的按篇选择与外发预览。

### 2.2.1 工具参数契约（V1）

工具定义为固定名称 + strict JSON Schema 对象（`additionalProperties: false`）。未知字段、任意路径、额外 payload 字段或不支持的枚举一律拒绝。所有写工具都要求 main-issued `target_ref`、稳定对象 ID（若适用）、`expected_updated_at`/manifest revision，并先通过 main 预检；需要用户确认的操作返回不可执行预览，确认后提交需匹配一次性 preview token。策略判定可自动执行的可撤销操作仍须生成相同预检快照/审计记录，由 main policy service 签发一次性自动执行 token，不要求 UI 确认。只追加/更新/删除明确指定的条目，不支持重排、通用 patch、自由 JSON patch 或直接保存整个计划文档；唯一例外是 `plan.create` 可在同一原子新建中携带一个闭合的初始 task list。

模型发出的写调用只是不可执行的 draft intent；整批完整解析并通过预检后，按权限策略产生确认卡或自动执行授权，再由 main 对冻结的同一快照提交。没有任何面向模型的通用 `commit` / path 工具。

| 工具 | 必需参数/允许效果 |
|---|---|
| `plan.list_children` | `{ folder_ref }`；只列直接子项，不递归。 |
| `plan.read` | `{ plan_ref }`；读取该计划的结构化已知组件与只读未知组件快照。 |
| `plan.create` / `folder.create` | `{ parent_ref?: folder grant, name_part, task_list?: { title?: string, tasks: [{ title, planned_at?, note? }] } }` / `{ parent_ref?: folder grant, name }`；main 按模板生成完整计划名，ID/时间由 main 生成，同名拒绝。`task_list` 最多 50 项，全部字段严格校验；main 生成列表/任务 ID、默认标题和 `not_started` 状态，并与新计划在同一原子 `plan.json` 写入中提交。多任务按批量操作策略进入确认。 |
| `component.add` | `{ plan_ref, expected_updated_at, type, payload }`；payload 是类型表内闭合字段，支持 8 种已知非引用组件；ID/`created_at` 由 main 生成。 |
| `component.update` / `component.delete` | `{ plan_ref, component_id, expected_updated_at, patch?, clear_fields? }` / `{ plan_ref, component_id, expected_updated_at }`；patch 只接受下表相应类型字段及可选组件 `remark`；delete 精确删除该组件并先做引用影响预览。 |
| `task.add` / `task.update` / `task.delete` | `{ plan_ref, list_component_id, expected_updated_at, title, planned_at?, note? }` / `{ plan_ref, list_component_id, task_id, expected_updated_at, patch?, clear_fields? }` / `{ plan_ref, list_component_id, task_id, expected_updated_at }`；仅 `task_list`，main 分配 Task ID，单次只操作一条任务。 |
| `multi_option.add` / `multi_option.update` / `multi_option.delete` | `{ plan_ref, component_id, expected_updated_at, text }` / `{ plan_ref, component_id, option_id, expected_updated_at, text?, checked? }` / `{ plan_ref, component_id, option_id, expected_updated_at }`；仅 `multi_plan`，main 分配 option ID，单次只操作一项。 |
| `plan.rename` / `folder.rename` | `{ target_ref, expected_revision, new_name }`；重命名经过引用影响预览及统一队列。 |
| `plan.move` / `folder.move` | `{ target_ref, expected_revision, parent_ref }`；移入自身/后代、路径越界或目录 identity 变化即拒绝；共用引用服务移动队列。 |
| `plan.trash` / `folder.trash` | `{ target_ref, expected_revision }`；文件夹以整棵子树为影响范围，经过逐条引用影响预览后进入统一回收站。 |
| `trash.list` / `trash.restore` / `trash.purge` | `{}` / `{ trash_entry_ref, manifest_revision, destination_parent_ref?, new_name? }` / `{ trash_entry_ref, manifest_revision }`；list 当前库只读，列表不签发写权限；restore/purge 要求显式 `@回收站条目`，purge 永远需要 UI 二次强确认。 |

`plan.rename` / `folder.rename` / `plan.move` / `folder.move` 的 `expected_revision` 是 main 目标签发快照里的不透明 revision：计划绑定 `updated_at`，文件夹绑定经过校验的目录 identity 与规范相对位置。所有 `component.add` 可带可选 `remark`；所有 `component.update` 的 `patch.remark` 可改旁注，`clear_fields` 可包含 `remark`。

已知组件字段是下列 schema 的全集；更新中的字段省略表示不改变。仅 `clear_fields` 明确列出的可选字段可被清除；`null` 不隐式代表清空，除 `mood.score`（其领域类型本身允许 null）外拒绝 null：

| `type` | add payload 与 update 字段 | 专用子项操作/硬边界 |
|---|---|---|
| `single_plan` | `title` (必填，≤200)、`done`、`summary` (≤20000)、`due_date` (`YYYY-MM-DD`) | 可清除 `summary`/`due_date`；`created_at` main 生成；日期按 `validateDueDate` 校验。 |
| `multi_plan` | `title` (必填，≤200)、`summary` (≤20000) | 可清除 `summary`；option 仅经 `multi_option.add/update/delete`；ID main 生成，只可更新 `text` (≤20000)/`checked`。 |
| `task_list` | `title` (必填，≤200) | 新计划可由 `plan.create.task_list` 一次创建多项初始任务；既有列表的后续 task 变更仅经 `task.add/update/delete`。字段 `title` (≤200)、`status`、`planned_at`、`completed_at`、`note` (≤20000)；可清除 `planned_at`/`note`；状态变更经 `applyStatusChange`，日期经现有规则，ID/完成时间 main 管理。 |
| `task_detail` | `title` (必填，≤200)、`description`/`note` (≤20000)、`planned_at` (`YYYY-MM-DD`)、`status` | 可清除 `description`/`planned_at`/`note`；`created_at` 与 `completed_at` main 管理；日期/状态机复用现有 validator。 |
| `note` | `content` (必填，≤20000) | `created_at` main 生成；`remark` 同样 ≤20000。 |
| `mood` | `score` (null 或 0–100、最多两位小数)、`text` (≤20000)、`mood_date` (`YYYY-MM-DD`) | `created_at` main 生成；不得写日记文件。 |
| `heading` | `title` (≤200)、`size` (14–32 的整数) | 不允许额外样式字段。 |
| `custom` | `content` (必填，≤20000)、`source` (≤20000，可清空) | 不接受可执行内容、路径或组件元数据。 |

`plan_reference` 不在该表的 component add/update/delete 中。所有文字、日期、状态、分数还要经过项目现有共享 validator；Tool schema 与 main validator 必须一致。未知旧组件可通过 `plan.read` 原样只读显示，不可修改或删除，避免损坏未来版本数据。

### 2.3 权限模式与执行

- **确认模式（默认）**：所有修改操作先展示本地操作预览，由用户确认后执行。
- **部分受限**：仅可撤销的创建与小范围编辑可自动执行；删除、覆盖、批量、范围不清或其它高风险操作仍需确认。
- **不受限制**：免普通逐项确认，但不能绕过计划库根/路径保护、CAS、白名单、引用影响选择或逐次外发预览。删除只能进入回收站；永久清除始终另行强确认。
- 三种模式都不允许模型提升自身权限。初始默认确认模式；模式显示在会话中，并在设置中由用户配置。
- 任何批次必须完整解析并预检全部调用后才可开始写入。合法调用按模型顺序串行执行；首个失败后停止，保留已成功项，并报告已完成/失败/未执行项。不自动重放成功项或整体回滚。
- 预检拒绝同批次内依赖本批新建/移动/恢复结果的调用，以及同一目标计划上互相冲突的结构/引用操作；拒绝时整批不写。组件/任务/选项写入先在独立的内存副本上按模型原顺序校验可执行性，绝不把不同调用合并为一次计划保存。每个调用的 `expected_updated_at` 必须匹配批次预检时该计划的起始 revision；预检完成后每个工具调用分别持久化，严格按模型顺序串行执行。对同一计划的后续调用，main 只能使用前一调用成功后返回的新 revision 继续 CAS，不接受模型临时改写 revision。若序列为 `A1、B1、A2` 且 `B1` 失败，`A2` 必须保持未执行；已成功调用不重放，不回滚。
- 同一用户请求最多 8 轮工具调用往返、总计 20 个工具调用。达到上限后停止自动继续，用户须发起一条新的消息并重新审阅外发内容。
- 每个模型请求（包括工具结果后的续轮）都必须重新创建外发预览。预览展示实际消息/历史/目标标注/计划或日记内容/工具定义和工具结果；用户确认后发送与预览相同的快照。取消外发只停止后续模型调用，不撤回已完成的本地操作。
- 只有完整收流且校验通过的工具调用才能进入预检。畸形、截断、取消或超限的参数一律不执行；provider 错误不自动重试。

### 2.4 删除、恢复和引用

- 计划树的右键删除、Delete 快捷键、顶栏菜单及小沅共用同一个软删除/回收站路径；普通删除不再永久清除数据。
- 旧 `storage:deletePlan` IPC 不保留永久删除兼容行为：从 renderer/preload typed API 移除；若主进程为显式拒绝旧调用而保留 handler，它恒定返回拒绝错误且不得读取/改动存储，`confirmed: true` 也不能执行。唯一永久清除路径是新回收站 purge-preview/commit。
- 回收站数据按当前计划库存放于该库 `.trace/trash/`，不混合不同库；计划树提供统一入口，切换计划库后展示该库的回收站。内部目录不出现在计划树，也不能由普通名称/路径操作访问。
- 回收站永久保留，默认不按时间自动清理。永久清除必须二次确认，确认内容明确说明不可恢复；小沅在任何权限模式下均不能绕过。
- 计划/文件夹及其子树作为一个条目整体移动，内容、组件 ID、`plan_id` 和引用身份均保留。安全检查拒绝库根、`.trace`、Diary 目录、越界 symlink/junction、过期库和路径越界。
- 进入回收站前，Task 5 引用影响预览仍枚举受影响引用并要求逐条选择保留失效引用或替换目标；不因权限模式跳过。选择保留的引用在目标位于回收站期间显示失效，原计划恢复且身份唯一后自动恢复解析；选择替换的引用保持新目标，不因恢复旧计划而回退。
- 恢复默认回到原路径。原路径占用时不得覆盖、合并或静默改名；用户可选择新父文件夹/新名称后重试。身份冲突/损坏条目保留在回收站并说明原因。
- 永久清除只处理已在回收站中的指定条目；若其仍有失效的入站引用，必须明确展示数量/影响并由用户再次确认。引用不会被静默删除或改写。
- 两阶段目录移动必须有可恢复的状态清单/启动后惰性修复策略。进程中断、磁盘写入失败、清单损坏或恢复冲突不能导致静默数据丢失；未知/损坏条目保留原始文件，默认拒绝永久清理。
- 回收站事务布局为 `.trace/trash/<entryId>/manifest.json` + `payload/`；manifest 采用 temp-file + atomic rename，记录 schema/revision、entry/library IDs、root generation、源相对路径、稳定 plan IDs/版本、目录身份及阶段。状态先写后移动，恢复决策固定如下：

  | manifest 阶段 | 源位置 | payload | 启动恢复决策 |
  |---|---|---|---|
  | `staging` | 存在且身份匹配 | 不存在 | 移动未发生；记为取消，清理空 entry 元数据，源数据不动。 |
  | `staging` | 不存在 | 存在且身份/稳定 IDs 匹配 manifest | 移动已完成；推进到 `trashed`，恢复可见条目。 |
  | `staging` | 存在 | 存在，或任一方身份不匹配 | `needs_attention`；保留两边与 manifest，禁止覆盖/清理。 |
  | `staging` | 不存在 | 不存在 | `needs_attention` / missing；不猜测、不自动删除记录。 |
  | `trashed` | 原路径空闲 | payload 身份匹配 | 正常可恢复条目。原路径有新对象时只可走新目的地预览，不覆盖。 |
  | `restoring` | 目标不存在 | payload 身份匹配 | 恢复移动未发生；退回 `trashed`。 |
  | `restoring` | 目标存在且身份与原 payload 一致 | payload 不存在 | 恢复移动已完成；登记 `restored`，刷新索引/引用后清理 entry 元数据。 |
  | `restoring` | 目标与 payload 同时存在/均不存在/身份不符 | 任意 | `needs_attention`；保留所有现存数据，禁自动合并、覆盖或清理。 |
  | `purging` | 任意 | 不存在 | 清除已完成；清理 manifest 元数据。 |
  | `purging` | 任意 | 存在（可能部分删除） | `purge_interrupted`；不自动续删、不允许恢复；UI 提示，只有新 purge 预览 + 二次强确认可清除剩余 payload。 |
  | manifest 无效/损坏、entry 不完整或身份无法判定 | 任意 | 任意 | `needs_attention`；原样保留并显示原因，禁自动动作。 |

  自动修复只允许表中明确无损的阶段转换；绝不自动继续 purge。清理 metadata 只在 payload 已经由身份校验安全归位或阶段可证明已完成后进行。
- 日记页和 Diary 目录明确不在本期回收站范围。日记服务会对缺失日期页自动补建，纳入前须单独设计日记补建与恢复冲突策略。

### 2.5 溯源

- 会话本地记录 provider/profile/model、每次请求目标与版本、操作名称、目标稳定身份/库身份、执行前后差异、所需和实际确认、执行结果、失败/未执行项、撤销/恢复状态及时间。
- 计划操作成功后可从会话跳回对象；对象已移动/删除时提供状态与恢复入口，不以旧相对路径误开同名对象。
- 本地记录不保存 API Key、原始 HTTP 包或不必要的原始请求头。工具结果若含用户数据，只能在用户确认的外发预览中发送。
- 用户删除会话时，其会话消息与该会话溯源一起删除；计划/回收站数据不随会话删除。

- restore/purge 的一次性 commit token 绑定 `operation`、`entryId`、manifest revision + canonical digest、`library_id`、root generation、restore 目的地路径/目录身份（restore）、入站引用影响签名（purge）、精确预览摘要、签发/过期时间。main 在 commit 内复核全部字段；任何变化、切库、过期或重放均拒绝并要求新预览。purge 预览后的入站引用变化也使 token 失效。

## 3. 交互方案

- 保留现有“小沅”第四胶囊与 Phase 1 两栏会话布局，不增加顶级页面。
- 输入区把“操作目标 `@`”与“本次外发上下文”分成两行；多目标以可移除标签显示。目标用于本地白名单，不等于正文附件。
- 每一轮完整工具调用进入原会话中的“操作批次卡”，保持卡片挂载和滚动位置；逐项显示读取/创建/修改/重命名/移动/移入回收站/恢复/永久清除、目标、状态、差异、引用影响、确认要求、执行结果和可用撤销动作。
- 本地操作确认与外发确认严格分离。外发的最终授权在主进程控制的独立隔离预览窗中完成；普通 renderer 中的预览/按钮只负责发起预览请求，不是授权证明。本地批次在会话卡内确认；不得把“已完成本地操作”误写为“已把结果发给模型”。
- 批次状态至少包括：检查中、待确认、可自动执行、执行中、已完成、目标需补充、内容已变化、预检失败、执行失败、未执行、用户停止、可撤销、已撤销。
- UI 必须支持键盘及 IME；避免确认弹窗叠加、卡片闪烁、强制滚动和布局顶动。仅使用 `workspace.css` 语义 token；弹层走 `getModal()` / `getMessage()`；英文/中文文案同步；覆盖亮暗主题、窄窗口与 `prefers-reduced-motion`。
- 按项目交互约定，Agent 操作批次与回收站 UI 先做 `demo/` 本地体验稿；正式组件整合前由用户验收交互顺序与信息密度。Demo 不放入 `docs/`，不接真实 IPC/模型/用户数据。

## 4. 架构与一致性约束

- 实施 worktree 从 Phase 1 `codex/agent-foundation` 创建，再合入 Task 5 `ca378166`；不能在 main 或旧 Phase 1/Task 5 工作区直接开发。保留两侧完整 Git 历史。
- main process 是目标引用签发、工具校验、权限判断、CAS、回收站事务及 provider 请求的唯一执行边界；renderer 只持有不透明 token 和展示 DTO。
- Agent library identity（Phase 1 的规范根路径摘要）与 Task 5 `library_id`（`.trace` 中 UUID32）用途不同；跨 IPC DTO 必须显式分别传递，不能混用。
- `PlanReferenceService.commitImpact`、`saveRendererPlan` 和 `appendRendererComponent` 已自行排入 `commitQueue`；调用者不能用 `runRendererMutation` 再套同一个队列，否则会死锁。目录移动必须新增 `PlanReferenceService.commitMove` 同队列入口：普通 renderer 的 `storage:movePlan` 与 Agent move 共用它；队列内复核 root generation、library ID、来源/目标目录身份、稳定 plan IDs 与相关版本，再调用不再入队的 StorageService 移动原语；不得保留绕过该入口的旧 IPC 路由。路径/树/search/reference-target 事件只在磁盘移动成功后发布，失败不得预发成功事件。
- 创建计划复用 `PlanNameTemplateService` 与 `formatPlanNameTemplate`；编辑经共享类型/验证及 `PlanReferenceService.saveRendererPlan`，引用目标编辑经引用服务，禁止绕过 CAS 或入站引用规则。
- 回收站路径是应用保留区；仅靠目录以点开头隐藏不构成安全保护，所有公开路径 API 必须显式拒绝 `.trace/trash` 与其后代。
- 维持窗口先启动、Agent 服务惰性初始化；新增回收站读取/修复和 agent tool registry 不得阻塞主窗口创建。

## 5. 失败与并发规则

- 任一 `@` 目标对应的 root generation、library ID、plan ID/目录身份或版本变化，当前预览/确认失效；要求重新选择/预检，不按路径或名称重绑定。
- 用户可见的差异来自 main process 刚读取并冻结的快照；确认时 main 再用 CAS/影响签名复核。变更不一致即拒绝执行并生成新预览。
- 计划/文件夹移动的普通 UI 与 Agent 写入共享同一个 `commitQueue`；确认预览后、实际文件系统移动前，在队列内重新验证 source subtree 中的稳定身份/版本、目标目录 identity、root generation、library ID、路径安全和冲突。任何一项变化都拒绝移动并要求重新预检。目录 identity 由 main 在授权时取得并在提交时核验；无法可靠取得或已变化时 fail closed。队列内不得调用会再次排入同队列的高层提交 API。
- 所有工具调用整批预检后才写；多条写操作逐条持久化并逐条记录结果。失败不自动回滚已成功项，且重试仅能选失败/未执行且仍有效的项。
- 回收站每个 entry 带版本化 manifest 与明确状态；初始设计须覆盖“预备记录写入、源目录移动、完成标记、恢复移动、永久清除”中断点。复用同盘移动，失败不调用递归删除作为补偿。
- watcher/cache/search index/PlanReference resolve 事件必须与移入、恢复、清除保持一致；恢复后索引和引用目标解析刷新，删除/移入后旧计划内容不残留在搜索结果。
- 本地 TOCTOU（realpath 检查和实际文件操作之间）仍须通过最短临界区、重复检查及现有路径安全层缩小；如果当前架构无法彻底消除，应在最终审计中明确残余，不能声称零竞态。

## 6. 非目标

- 日记写入、日记删除/恢复、日记润色、偏好提取属于 Phase 3 或专门日记变更，不在本阶段实施。
- 不加入新的模型供应商协议、JSON 文本工具调用 fallback、任意文件、Shell、MCP、插件、计划树批量递归改写。
- 不升版本、不编译发布包、不创建 Release、不推送远端；除非后续用户单独要求。

## 7. 验收标准

1. `@` 支持一条消息多个计划/文件夹目标；缺失目标时明确追问；切库、移动、改名、删除或同名冲突后旧 token 失效，不会绑定错误对象。
2. `@` 不自动外发计划正文；文件夹 list 非递归；每次读结果/工具结果进入下一次模型调用前，主进程隔离预览展示的 request body 与实际请求字节等价；普通 renderer 直接调用发送 IPC 不能绕过该确认，取消/关窗不发请求。
3. Provider 使用原生多工具 `tool_calls`；fragment 按 index 完整重组；一次性参数完整收流后解析。工具回复和 assistant tool-call history 符合 Chat Completions schema；多调用验证先完整预检再按序执行。
4. profile 未通过当前能力测试时无计划工具定义/执行入口；工具 schema 与 tool_choice 使用已验证的 Chat Completions 形态。
5. 确认模式、部分受限、不受限制分别遵守本规格；首次安装默认确认模式；任何模式均不能越权、绕过 CAS/路径/引用影响或逐次外发确认。
6. 计划组件读写用强类型且显示可读差异；每次变更复核 `updated_at`；不能通过自由 JSON、raw path 或直接存储 IPC 绕过引用影响。
7. 所有计划/文件夹删除入口均软删除到活动计划库 `.trace/trash`，包括右键、快捷键、菜单、小沅；无永久删除的常规分支；Diary 保持原有语义不变。
8. 回收站条目可列举、恢复、确认永久清除；重启后可恢复中断事务状态；同名/身份冲突时绝不覆盖；不会自动过期/清空。
9. 入站引用改名/删除/替换/保留按 Task 5 行为；进入回收站后保留的 refs 显示失效，恢复后解析恢复；替换 refs 不受旧计划恢复影响。
10. 本地操作历史保存目标、版本、前后差异、确认/执行/失败/撤销结果；任何可撤销动作都以最新 CAS 校验，过期动作要求重新预览；会话删除不影响计划/回收站。
11. 自动化测试使用临时目录、真实公共 IPC、loopback HTTP SSE；无真实 API Key/外部模型/用户库数据；safeStorage 仅在加密边界替身。
12. 每个提交后类型检查、定向测试、全量测试、build/diff-check 通过；完成前独立质量与安全审查；隔离 Electron 测试确认树删除/恢复、引用解析、Agent 目标、确认与回收站 UI；完整报告实际命令和残留风险。
13. 普通 renderer 的 `storage:movePlan` 与 Agent move 通过同一 `PlanReferenceService` `commitQueue`；source subtree、目标目录身份、root generation、library ID、版本及路径安全均在实际移动前复核。并发引用提交不能交错，失败不得发出成功的 watcher/tree/search/resolver 事件。
