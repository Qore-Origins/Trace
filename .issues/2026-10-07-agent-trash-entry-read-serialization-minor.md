# Agent 单条回收站读取与写事务的并发一致性

状态：**已修复并通过独立 scoped review（2026-10-07）。** 审查范围内 0 Critical / 0 Important / 0 Minor；此结论不代表整个 Task 8 完成。

## 观察

Task 8 最终只读安全/质量复审发现，小沅的 `trash.list` 工具按消息授权读取一个精确回收站条目，但该只读路径没有加入 `PlanReferenceService` 的回收站提交队列。普通回收站列表、恢复和清除提交已共用排队机制。

如果同一条目恰好与恢复或清除并发，小沅可能读到旧条目快照，或遇到 manifest revision 冲突。该读取仍被限制到精确授权条目，并校验 revision；复审未发现它可绕过授权、执行越权写入或破坏数据。当前没有运行时复现。

## 已批准的最小修复边界

Agent 的精确条目读取通过 `PlanReferenceService` 现有提交队列执行，并在队列内校验授权快照的 manifest revision；恢复/清除与读取按队列顺序串行化。只改服务调用与公开服务/Agent typed IPC 回归，没有改权限、消息授权范围、renderer、IPC 合约或全量回收站枚举语义。此修复不改变此前独立审查 Ready: Yes 的历史结论。

## 实施与验证（2026-10-07）

- TDD：新增恢复/清除两种并发用例后先以缺少排队读取入口稳定失败；实现后相关用例通过。
- 通过：`npm run test -- test/plan-reference-ipc.spec.ts test/agent-operation-ipc.spec.ts`（2 specs / 95 tests）；`npm run typecheck`；`npm run build`；隔离 Electron production main/preload/renderer runner（9 次 loopback provider 请求，隔离 Temp fixture 校验并清理）；`git diff --check`；计划 `plan.json` JSON 解析。
- 不通过的全量：`TZ=America/New_York npm run test -- --maxWorkers=1`，84 specs / 1181 tests，1177 passed / 4 failed。3 个 `plan-reference-ipc`、1 个 `search-service` 失败都发生在夹具准备 `StorageService.savePlan → PlanRepository.writeJsonAtomic` 阶段并显示 `SAVE_FAILED`；无探针，本轮没有取得底层 errno 或调用主体。与原间歇保存 issue 相关但不能据此确认根因。
- 按用户决定暂停系统级追因，未启动 ProcMon/ETW、未读取或改动既有 PML；原子保存问题仍未解决。
- 17:30 +08:00 独立只读复审完成：规格与质量均 Approved，无新发现。固定 HEAD `3cc14393825af57498641210479136dec41527a0` 的四文件审查包实际只显示服务与服务测试两个 tracked diff；两个 Agent 文件是 Phase 2 未跟踪新文件，按精确调用/授权测试核对了当前实现，未声称固定比较其历史增量。复核共享队列、队列内 revision 校验、精确条目授权和无兄弟条目枚举。复审没有重跑测试，95/95 是上面的历史控制者结果；本批最终全量验证由协调者进行。Task 8 仍未关闭。

## 证据

- 只读复审：2026-10-07；结果 Ready: Yes，0 Critical / 0 Important / 1 Minor。
- 相关代码：`src/main/services/agent-operation-service.ts` 的精确 `trash.list` 读取，以及 `src/main/services/plan-reference-service.ts` 的回收站提交队列。
- 初始发现是代码路径审查得出的并发可能性，不是已观察到的数据故障；当前并发顺序由新增测试覆盖，未发现数据损坏或越权。
