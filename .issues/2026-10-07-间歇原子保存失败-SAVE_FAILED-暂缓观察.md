# 间歇性原子保存失败（`SAVE_FAILED`）

## v1.1.0 发布门槛复核（2026-10-13）

- 用户随后允许一次限定范围的 ProcMon 文件事件捕获。第一轮继承旧 git 过滤器，仅有 2 条无关事件；第二轮清除过滤器后，在全量测试中捕获 `plan-workflow-transfer` 合成库 `Bundle/Day7/plan.json` 的保存失败。Node 对同一临时文件 4 次 `SetRenameInformationFile` 均为 `ACCESS DENIED`，首次 15:43:42.2319948、末次 15:43:43.0176512，约 786ms。最后一个 Node 目标读取句柄的 `IRP_MJ_CLOSE` 出现在首次失败前约 9ms。合成目录事件仅涉及 `node.exe`、`System`、`MsMpEng.exe`；MsMpEng 在首次失败后约 2ms 尝试映射该临时文件，结果为 `FILE LOCKED WITH ONLY READERS`，并无证据证明它先持有目标或导致重命名被拒。Windows Defender 实时保护开启、受控文件夹访问关闭；这些状态也不构成归因。
- 根据捕获的拒绝持续时间，将默认有界退避从 `[50,200,500]` 延长为 `[50,200,500,1000]`，仍在每次实际重命名前复核库身份和变更守卫。注入前四次 `EPERM`、第五次成功的原子覆盖回归先 RED 后 GREEN；`plan-repository`、工作流批次和小沅目标选择定向 44/44、typecheck 通过。批次磁盘用例的 5 秒全量负载超时改为该 spec 20 秒上限。默认环境全量两轮连续各 98 文件 / 1283 项通过，最终 Windows 构建与隔离生产 Electron 烟测通过。该变更只提高短时拒绝后的恢复机会，原始拒绝主体仍未知；失败时保留草稿和既有错误语义不变。
- 限定捕获原始 PML 与聚焦合成路径的 CSV 留在本机忽略的诊断目录，未上传。捕获本身额外触发 batch 测试超时及并发 bundle build 失败，因此那一轮不作为发布门槛通过证据。完整 CSV/XML 导出清理被自动审批策略拒绝，文件目前仍留在同一诊断目录；未改系统安全配置、未触碰真实库。
- 用户要求 v1.1.0 先定位并修复全量测试失败，再公开发布；当时未将发布要求视作恢复系统捕获授权。随后用户单独允许限定 ProcMon 捕获，执行结果见本节首项。
- 小沅目标选择 UI 测试另有初始化等待竞态，已用延迟 `agent:session:list` 的先红后绿回归修复测试辅助函数；与本条保存故障分开。
- 当前完整测试 98 文件 / 1282 项。默认 Temp 一轮 1280/1282：`search-service` 在测试语料保存时对已有 `plan.json` 原子覆盖连续 4 次 `EPERM`，另一个工作流批次用例 5 秒超时。D 盘独立 Temp 与 C 盘独立 Temp 子目录各有一轮 1282/1282，但将每轮独立 Temp 固化到测试入口后又为 1280/1282，两个 `EPERM` 分别漂移到 `storage-service` 和 `plan-reference-ipc` 测试夹具。隔离 Temp 不能作为稳定修复，入口改动已撤销。
- 在该阶段尚无拒绝主体、过滤器或可复现的应用内竞争证据；不能归因 Defender、索引器或 Trace 自身，也不能用当时个别全绿轮次宣称解决。后续限定捕获和连续全绿结果见本节前列；底层主体至今未归因。完整日志仅在本地忽略的诊断目录，未上传。

## 最新决策与复审修正（2026-10-08 14:30 +08:00）

- 用户明确选择**保留有限重试**。该决定仅 supersede 下文 2026-10-07“暂不加 I/O 重试”的处理策略；8A 自然故障仍未复现归因，有限重试不等于根因已修复，也不证明安装版问题已经消失。
- 候选 worktree 的 `PlanRepository.renameWithRetry` 保留有界 `EPERM/EBUSY` 退避序列 `[50, 200, 500]`。Codex 复审发现 Agent 冻结库身份仅在重试开始前校验；已修复为每次实际 rename 前复核身份/目标守卫。新增回归先 RED（旧行为身份失效后仍执行第二次 rename），修复后通过。Focused `plan-repository`、`plan-reference-ipc` 与 `reference-impact-dialog` 共 65/65，Node/Web typecheck 通过。
- rename 重试日志已移除绝对目标路径，只保留尝试序号与错误码；测试确认不包含库路径或计划名。没有配置安全软件排除、调整系统设置或修改已安装版。
- 根因仍未知；复审记录的检查与文件系统 rename 之间极窄的 TOCTOU 窗口仍存在。后续只有在自然故障再次出现或影响加重时，才按用户偏好重新评估追因。

## 后续验收观察（2026-10-07 18:35 +08:00，未继续追因）

Task 8D3 的首次完整隔离 Electron runner 退出 1，在既有 D2 `createMarkedPlan(QA Read Authorized)` 的公开 `storage:appendComponent` 准备阶段返回 Trace code 15 / SAVE_FAILED，尚未进入 D3 删除入口/引用场景。原场景到 provider 请求 9 次，D1 与目标移动/删除部分已通过；没有底层 errno/主体证据，不直接标为 EPERM 或同根因证明。首轮完整日志保留为 `task-8D3-runner.log`。遵循用户暂缓决定不启用追踪、探针、I/O 重试、系统配置修改或真实库操作；仅允许一次新 fixture 的有界验收尝试，仍失败则标新场景未验证。失败临时 fixture 仅为合成测试数据，按本次 owner marker/真实路径/直接 Temp 子目录及进程退出核验后精确清理，结果随后记录。

## 历史处理决定（2026-10-07 17:44 +08:00；“不加重试”已被 2026-10-08 新决定覆盖）

用户明确表示此问题偶现、目前未造成崩溃或无法使用，决定先跳过，继续 Task 8。本问题仍未解决，但不再阻塞其余 Task 8 验收/开发；暂停进一步应用层 I/O 与系统级追因，不修改安装版、不加重试、不清理用户库。已完成并验证的失败版本恢复修复保留。本次完整测试仍为 1181 passed / 2 failed，不删除或跳过失败用例、不标全绿。后续若频率或影响加重再重新评估；新增安全/功能问题不适用此例外。

状态：**未解决；用户接受暂缓，应用层 I/O 与系统追因均暂停。** 2026-10-07 用户确认已安装版也偶发自动保存失败，下一次保存成功；此前“用户侧尚无实际保存失败反馈”已被新证据覆盖。最近串行全量回归仍重复出现夹具失败，根因未明、未修复。测试中捕获过替换已有 `plan.json` 的 `rename EPERM`，但尚未归因到具体进程、文件系统过滤器或其他外部因素，也不能证明与用户反馈同根因。不增加盲目 I/O 重试或系统安全软件排除项。

## 新增用户反馈与本批范围（2026-10-07 17:18 +08:00）

- 用户提供 `D:\trace`；只读核对为 v0.18.1 安装目录。安全提取配置中的库位置为 `D:\Desktop\Plan`，未读取计划正文、未启动应用或写入用户库。
- 用户现象为“偶尔自动保存失败，下一次保存成功”，未提供发生时的底层错误、时间或目标版本，不能直接归为 `EPERM`。
- 安装包内保存器在 rename 前关闭临时文件句柄；失败时只向上抛统一 `SAVE_FAILED`，底层 errno 没有保留为可见诊断。安装包没有当前开发源码中的同计划写队列；此差异只作版本对照，不是因果证据。
- 用户数据目录存在历史配置临时文件（77 个，4 个为空，时间范围 2026-09-06 至 2026-10-06）。未清理、未读取内容；不能将其当成计划保存故障证据。
- 按前次换向实验实施最小失败恢复修复，所有权与公开测试边界见当前 HANDOFF / Task 8C。17:30 前实现者报告两条新增回归 RED 后 GREEN、两份完整 specs 60/60；独立精确增量规格/质量复审 Approved，无新发现。协调者 typecheck 与既有编辑态失败保留草稿回归 1/1 通过，完整串行测试仍在执行；最终结果待补。修复仅消除已确认的调用方版本副作用，不宣称解决原始偶发 I/O 故障。
- 只读补查：当前 D 盘 NTFS、Healthy、剩余约 318.5 GiB；真实库根不是链接目录，枚举未发现 `.plan.json.*.tmp`，无枚举错误。仅为当前状态，不证明故障发生当时没有文件占用或其他异常。
- 安装版 renderer 使用独立 `serverUpdatedAt`，普通保存失败保留草稿/CAS 版本，不作无限自动重试；下一次编辑可触发再次保存。与用户现象相符，但不能证明失败原因。安装版主进程未发现持久化日志实现，统一 `SAVE_FAILED` 会丢失底层 errno，无法从现有反馈追溯具体拒绝主体。

## 现象与证据边界

- 2026-10-06 的隔离自动化测试中曾间歇出现 `SAVE_FAILED`。已确认的一次失败发生于 `addPlanId('RenameSource')` 的测试夹具准备保存阶段，调用链为 `StorageService.savePlan → PlanRepository.writeJsonAtomic`；目标 folder rename/trash 业务操作尚未执行。因此该失败提示原子写入路径存在间歇异常，但不能直接等同于普通用户编辑计划时的故障。
- 2026-10-07 Task 8 继续验收时，5 个 CAS focused specs 共 194 tests，曾有 2 个 fixture `savePlan` 阶段失败；失败发生在目标 rename/trash 业务动作前，三个单项复跑通过。随后一次性、只记录操作名和错误码的 FS observer 复跑为 193/194，其中 `storage-service.spec.ts` 的 stable-target-id document-save 用例出现一次 `rename` / `EPERM` / errno `-4048`。observer 不记录路径，无法确认具体目标、调用主体或过滤器。该用例无 observer 单项复跑 1/1 通过，未稳定复现，也不是用户实际编辑/保存失败的证据。
- 2026-10-07 后续 Task 8 复核中，相关 4 specs 首次 129/130（唯一 `SAVE_FAILED` 位于 `plan-reference-ipc.spec.ts` setup `savePlan`）；单项复跑通过。串行全量首次 84 specs / 1179 tests 为 1170/1179，含 5 个 fixture `SAVE_FAILED` 和 IPC fixture 缺依赖、picker 连带超时、DST 测试时区不匹配。补齐三个测试夹具的 `PlanReferenceService` 后，`agent-target-ipc`、`trash-ipc`、`agent-target-picker` 为 55/55；Node/Web typecheck 通过；在进程启动时指定 `TZ=America/New_York` 后 DST 定向测试 2/2 通过。
- 固定该 TZ 的第二次串行全量为 84 specs / 1179 tests，1178/1179；唯一失败再次发生于 `plan-reference-ipc.spec.ts` 的 `addPlanId → StorageService.savePlan → PlanRepository.writeJsonAtomic` setup 阶段，计划引用 rename/trash 尚未执行。针对 3 个相关失败候选的单次窄 observer 运行中，folder fixture 用例失败并观测到 `rename` / `EPERM` / errno `-4048`；另外两个目标用例通过。observer 不记录路径、数据、进程或驱动，故仍不能将拒绝关联到临时文件、目标文件、外部程序或过滤器。结束后删除 observer，同一用例无注入单项重跑 1/1 通过。核心 Task 8 四 specs 随后 130/130；当前结论为全量压力下的间歇性 fixture 写入异常，根因未确认。
- 一次性 observer `.dbg/trace-fs-error-probe.cjs` 已在诊断后移除；本轮未启动 ProcMon/ETW，未读取/修改/删除留存 PML。
- 2026-10-07 13:04 +08:00 的新一轮无探针串行全量为 84 specs / 1179 tests，1174 通过、5 失败：`plan-reference-ipc.spec.ts` 两项、`search-service.spec.ts` 三项；五项都在测试准备阶段 `StorageService.savePlan → PlanRepository.writeJsonAtomic` 失败，未进入对应业务断言。固定 `TZ=America/New_York`、相同单 worker 参数及默认 `TEMP/TMP`，进程未设置 `NODE_OPTIONS`；未发现测试命令或静态环境配置上的区别。
- 使用仅在 `writeJsonAtomic` 已捕获异常后输出脱敏阶段的 catch-only 临时诊断，`search-service.spec.ts` 全 spec 8/8 通过；一个 plan-reference 目标用例发生同类失败时记录为 `rename-target / rename / EPERM / errno -4048`，源为临时计划文件、目标角色为 `plan.json`。随后固定条件的 search、transfer、plan-reference 目标单测分别连续 5 次均通过。每轮使用新的随机 Temp fixture，失败时的瞬时文件系统状态/占用主体未知；不能从这些对照认定是 Defender、MessageTransfer 或任一进程导致。
- 旧的全局 `fs.promises` monkey-patch observer 会改变异步时序，其通过结果不作为有效对照。catch-only 诊断代码和新建 observer 脚本已移除；无 ProcMon/ETW 新采集，旧 PML 采集窗口未包含本轮失败，不能直接比较失败与通过事件。
- ETW 捕获没有把拒绝结果关联到目标文件或具体文件系统过滤器；不能归责 Defender、MessageTransfer 或其他单一驱动，也没有证据支持增加通用重试、修改权限或排除安全软件。
- 后续 ProcMon 定向窗口内，folder rename/trash 用例串行 20/20、external destination junction 用例串行 20/20，均未再次触发。该结果只说明这 40 次未复现，不能证明根因消失。
- 本轮 PML 已由用户确认可正常打开。原始事件记录尚未解析；PML 约 640 MiB，留在本机 `temp/Trace-ProcMon-20261006/logs/atomic-save-20261006.pml`，未上传或删除。

## 处理决定

先前暂不修改产品保存逻辑的决定已由 17:18 新增真实反馈和失败恢复实施范围覆盖；仍不添加无证据的重试或系统/Defender 排除项。由于全量测试再次出现多项失败，不能按“没有再犯”结案；但现有测试证据只确定 Node `rename` 的拒绝结果，仍不足以证明根因在 Trace、Defender 或特定驱动。

用户已选择暂缓系统级进一步根因调查：不启动新的 ProcMon/ETW，不读取或修改留存 PML，也不更改系统/安全软件配置。此决定不代表异常已消失或修复。问题继续保留为未解决的应用反馈与自动化测试异常；13:48 全量记录为 1177/1181，4 个夹具保存失败仍意味着 Task 8 的全量测试门槛未满足，不能把单测重跑通过写成全绿。新增实际保存反馈按应用层证据重新评估；新的系统级采集仍须先确认范围和状态。

## 换向诊断：失败恢复契约（2026-10-07 14:16 +08:00）

用户询问换方向或思路。本轮仅检查源码并执行受控实验，没有修改产品源码/测试或重新运行全量；自然发生的 `EPERM` 根因仍未知。

- 搜索测试的 `beforeEach` 先调用 `createPlan`，再通过 `putDoc → savePlan` 填充语料；计划引用夹具的 `addPlanId` 也先读取已建计划，再保存固定 ID。因而测试准备中的原子替换失败会阻止后续搜索/引用业务断言。这只是测试依赖结构，不证明这些调用引发底层拒绝。
- 保存实现已在 rename 前关闭临时文件句柄，并有同实例、同计划路径的写队列；本轮未找到直接支持“未关闭自身写句柄”或“缺少该路径串行”的证据。
- 现有 `writePlanUnlocked` 在落盘前修改调用方文档的 `updated_at`。通过公开构造注入 `PlanRepository({ renameFn })`，在独立随机临时库对一次保存明确注入 `EPERM` 后，实际得到：`SAVE_FAILED`；旧文件字节不变；磁盘版本不变；传入文档版本改变；按传入文档的新版本重试为 `CONFLICT`；按原服务端版本重试成功并保存草稿。该实验确定的是服务层失败后的对象副作用，不能归因自然出现的 I/O 故障。
- Renderer 的 `plan-store` 用单独的 `serverUpdatedAt` 提交 CAS，且普通保存失败不更新该字段。因此当前结果不能写成用户界面重试已经失效。
- 实验代码只在进程内由现有源码构建，没有生成脚本或修改源码；临时库位于项目 `temp` 下，校验真实路径及直接子目录后已删除。命令退出码 0。

候选路线尚未实施：先补保存失败恢复契约，明确磁盘、草稿与服务端 CAS 版本的状态；对仅验证搜索/引用的初始化评估一次建立最终语料，保留真正保存/CAS/事务测试的真实写入；必要时使用原始文件操作、仓库、StorageService、完整 Electron 的分层小规模对照。继续完成独立复审及真实操作验收。不能为取得全绿而跳过失败、增加无依据重试或宣称保存根因已修复；Task 8 门槛与状态保持原样。

## 既有验证记录

### 本批最终验证（2026-10-07 17:38 +08:00）

- Task 8C 最小修复已完成并独立规格/质量复审 Approved，无发现：候选文档先获得新版本，`writeJsonAtomic` 完整成功后才同步调用方。两个真实临时库用例 RED 2/2 正确失败后 GREEN 2/2，两完整 specs 60/60。只消除提交前失败后的版本副作用，不承诺后提交失败必然未写盘，也没有 I/O 重试。
- 协调者 `npm run typecheck`、现有 renderer 失败/草稿保留 focused 回归 1/1（14 未选中）、`npm run build`、fresh-build 隔离 Electron main/preload/renderer runner 通过。Electron 使用独立 userData/sessionData/disposable library、9 次仅 `127.0.0.1` 合成 provider 请求；退出后精确 owner-marked 临时库核验清理。真实安装版、用户库、系统和旧跟踪文件没有修改。
- `TZ=America/New_York npm run test -- --pool=threads --maxWorkers=1 --no-file-parallelism` 的本批全量：84 specs / 1183 tests，1181 passed、2 failed（255.72s）。两项均为 `transfer-service.spec.ts` 语料准备的保存错误，分别在 `makePlan` 和建立包含失效外部目标的源文档后 `savePlan` 失败；尚未进入对应 export/import 行为。堆栈为 `StorageService.savePlan → PlanRepository.mutatePlanAtomic → writePlanUnlocked → writeJsonAtomic`，统一 `SAVE_FAILED`；本次未捕获底层 errno，不直接标为 EPERM，也不能归责某进程/驱动。
- 不做重复重跑“刷绿”、不删除或跳过失败用例、不调整 Task 8 门槛。原始偶发 I/O 故障保持未解决；新局部修复不等于安装版故障已解决。后续优先应用层失败恢复与可归因诊断，系统级追因仍暂停；Task 8 仍进行中。

- ProcMon 定向测试：两项目标测试各 20 轮，均通过；没有命中 `SAVE_FAILED`。
- 2026-10-07 13:04 +08:00 最新无探针串行全量：1174/1179，失败均在测试夹具保存阶段。此前窄捕获与本轮 catch-only 诊断均确认过 `rename EPERM (-4048)`；本轮另有 search 8/8、transfer、plan-reference 目标用例各连续 5 次通过。代码诊断已撤销，typecheck 在全量运行前通过；不能因此宣称全量通过或根因已明。未启动 ProcMon/ETW。
- PML 文件可重新打开；只读检查文件头签名，未解析事件记录。
- 更新问题、协作记录，并修复 Task 8 审查问题；没有修改或清理系统配置、PML、ProcMon/ETW。
