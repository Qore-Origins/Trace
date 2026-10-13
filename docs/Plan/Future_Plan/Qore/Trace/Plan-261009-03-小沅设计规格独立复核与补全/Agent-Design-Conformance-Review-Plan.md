# 小沅智能体 Phase 1/2 设计规格独立复核与补全

- 日期：2026-10-10
- 状态：实现与自动化验证完成；用户侧验收待办
- 验收基线：[Phase 1 基础层设计规格](../../../../../../superpowers/specs/2026-10-02-agent-foundation-design.md)；[Phase 2 计划操作设计规格](../../../../../../superpowers/specs/2026-10-03-agent-plan-operations-design.md)
- 范围：Phase 1/2；不包含 Phase 3 偏好提取/日记润色、真实 provider 请求、真实用户计划库操作、版本升级与发布。

## 目标

不把既有交接或计划状态当成验收依据，从批准的设计规格重新逐项审查当前代码、IPC 边界、自动化覆盖与隔离 Electron runner；修复审查确认的遗漏，留下真实验证结果和仍需用户侧完成的验收项。

## 执行清单

- [x] 读取两份设计规格、当前共享计划入口、当前交接和 Git 工作区状态。
- [x] 建立 Phase 1/2 验收矩阵，区分代码实现、自动化验证和用户侧未验证项。
- [x] 修复确认的实现或测试边界缺口，并为行为改动补充定向回归。
- [x] 运行定向 Agent/Trash/Plan Reference 回归、串行全量测试、Node/Web typecheck、build、隔离 Electron runner 与 diff-check。
- [x] 同步本计划 JSON 镜像、`docs/Plan/README.md` 和 `docs/HANDOFF-CURRENT.md` 的真实状态与剩余验收。

## 当前证据

- 基线 HEAD：`aa8c99c70b5dcc28b1fa2bd87ac035172f615aed`；分支：`main...origin/main`。当前工作树含大量预存未提交/未跟踪改动，本轮仅在登记边界内增量修改，未暂存、提交、推送、发布或清理其他内容。
- 定向回归：`npm run test -- test/agent-tool-registry.spec.ts test/agent-operation-ipc.spec.ts test/agent-session-repository.spec.ts test/agent-conversation-ipc.spec.ts test/agent-operation-view.spec.tsx test/trash-dialog.spec.tsx test/style-boundaries.spec.ts --pool=threads --maxWorkers=1 --no-file-parallelism`：7 files / 200 tests passed。
- `npm run typecheck`：Node/Web typecheck 均通过。`npm run build`：通过，7186 renderer modules transformed。
- 串行全量 `npm run test -- --pool=threads --maxWorkers=1 --no-file-parallelism`：87 files / 1231 tests，1229 passed、2 failed。失败仅为 `test/diary-automation-coordinator.spec.ts` 两个跨 DST 午夜用例在 `TZ=Asia/Shanghai` 下使用了非预期的进程时区；该 spec 在 `TZ=America/New_York` 定向 14/14 通过，`test/diary-view-utils.spec.ts` 在 `TZ=Asia/Shanghai` 定向 14/14 通过。先前两项 fixture `SAVE_FAILED` 在本次最终全量运行中未复现。
- `node scripts/trace-phase2-isolated-electron-runner.cjs`：PASS。production main/preload/renderer、隔离用户数据与一次性计划库、仅 `127.0.0.1` 合成 SSE；11 次 provider 请求，覆盖外发预览、计划操作卡、无参数只读 `trash.list`、恢复/清空、三种删除入口和引用替换/恢复；renderer runtime exception 为 0。runner 确认进程退出后删除了本次唯一自有临时夹具。
- `node scripts/trace-phase2-isolated-electron-runner.cjs --d3-delete-reference-diagnostic`：PASS；三种删除入口及关联处理均通过，未启动 provider，0 次外发。两个 runner 的脚本语法检查通过；最终 `git diff --check` exit 0，仅报告 CRLF/LF 转换提示。
- 之前失败运行留下的 8 个 runner 临时目录仍在 `%TEMP%\trace-agent-phase2-isolated-e2e-*`（后缀：`D07I0A`、`3onVyd`、`ToLANw`、`j6Y2dM`、`ngvHcZ`、`ZOWIkp`、`RQHvX7`、`ZYE212`）。已逐一核验普通目录、精确 Temp 父目录及 runner owner marker；PowerShell 递归清理被执行策略拒绝，因此保持原样供用户决定后续处理。成功运行自动清理了其自有临时目录。

## Phase 1/2 验收矩阵

| 规格面 | 代码实现与静态复核 | 自动化验证 | 本轮用户侧边界 |
|---|---|---|---|
| 配置、凭据、Provider 与 SSE | main-process safeStorage/会话内存降级；远端 HTTPS、loopback HTTP、禁重定向；完整累积后校验工具调用；能力探测为合成消息 | provider、profile、capability 与请求 IPC 已在本轮定向套件中覆盖；当前隔离 runner 能发出 loopback 合成 SSE 能力请求 | 未连接真实 Provider；safeStorage 在最终桌面安装环境的实际状态及模型续轮仍待用户操作 |
| 会话、目标授权、外发预览 | 外发预览按消息冻结目标引用；计划库操作由 main 解析与提交；所有模型请求经过独立审批窗 | runner 验证 renderer→preload→main、预览取消、无 Key 展示、单次 loopback 请求 | 原生焦点/键盘/IME/DPI/读屏与真实服务兼容性未验证 |
| 计划工具、CAS、审计、回收站 | 严格工具 schema、批次预检、库身份与 CAS；已补齐无参数只读 trash.list、策略化确认、重启中断恢复与审计撤销身份校验 | 7 个重点 spec 200/200；production Electron runner 全流程通过，11 次 loopback 请求 | 不读取或写入真实用户计划库 |
| UI 与主题 | 操作卡承接本地确认，取消重复主进程确认；重启中断状态有可理解提示；回收站减少动态效果规则覆盖弹窗根节点且保留 motion 生命周期 | 相关视图测试通过；完整 runner 的 TrashDialog 关闭、冲突恢复、清空确认与三种删除入口通过 | 真实窄窗口、主题、原生键鼠/IME/DPI/读屏体验未验证 |

## 已修复缺口与验收结论

经两份规格的只读对照，本轮修复并补充回归：

1. Phase 2 §2.1/§2.2.1：`trash.list` 现在无参数枚举当前活动库全部回收站条目，只读且不签发恢复/清空授权。
2. Phase 2 §2.3：受限/无限制策略下，符合策略的普通可撤销小范围写入不再仅因经 `@` 目标读取而额外逐项确认；结构操作、批量、引用影响与清空仍走规格要求的确认。
3. 重启时待确认批次明确转为取消、撤销入口关闭；原工具调用 transcript 补入未执行结果，避免遗留不可用确认。
4. 重启后 undo 使用持久化审计重新验证当前库、对象身份与 CAS，不依赖仅存于内存的消息级授权。
5. 会话操作卡是普通本地操作的唯一确认入口；IPC 不再默认弹第二确认窗，永久清空保留独立精确确认。
6. Runner 原先引用旧 worktree，现使用当前 checkout 的构建产物；后台节流曾冻结隐藏 renderer 的 rAF，现通过 QA-only Chromium 开关保持动画帧推进。可见树行检查和重试前的库根展开也已修正。生产 Trash 弹窗 reduced-motion 时长覆盖根节点和后代，并以极短正时长保留 antd motion 完成事件。

代码与自动化验收已完成，登记文件所有权释放。实际 Provider/模型续轮、原生窗口输入、窄屏/主题/读屏，以及真实用户计划库操作仍需用户侧验证；本轮没有发真实外部请求，也没有读取或写入真实用户计划库。

## 收尾要求

每个结论区分“实现”“自动化验证”“用户侧验证”。串行全量测试仍有 2 个依赖时区的 DST 用例在 `Asia/Shanghai` 失败；不记作全绿。真实模型请求需由用户在外发隔离预览中检查并确认；原生窗口交互、IME、DPI、读屏和真实用户库行为不得由单测或隔离 runner 代替。
