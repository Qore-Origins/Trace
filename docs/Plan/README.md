# Trace 计划目录

> 本目录是 Trace 项目计划的共享读取入口。Codex 与 Claude Code 在接手、实施、暂停和完成计划时必须同步更新对应计划文档，并在 `docs/HANDOFF-CURRENT.md` 登记当前所有权与验证结果。

## 目录约定

结构参考用户计划库 `D:\Desktop\Plan`：

```text
docs/Plan/
├── README.md
├── Future_Plan/
│   └── Qore/
│       └── Trace/
│           └── Plan-YYMMDD-NN-名称/
│               ├── <Implementation-Plan>.md
│               └── plan.json
└── <历史平面计划文件>.md
```

- `Future_Plan/Qore/Trace/`：尚未完成或正在实施的 Trace 项目计划。
- 每个计划使用独立目录，目录名包含日期、序号和主题。
- Markdown 是人类与智能体共同阅读的执行真源。
- `plan.json` 是与 Trace 原生计划结构对齐的镜像队列；任务状态更新时必须与 Markdown 同步。
- `docs/HANDOFF-CURRENT.md` 仍是智能体当前工作状态与文件所有权的唯一真源；本目录不取代交接文件。

## 状态约定

| 状态 | 含义 |
|---|---|
| 待确认 | 已形成方案，尚未获得实施确认 |
| 待实施 | 已确认，尚未开始改代码 |
| 实施中 | 已在 `HANDOFF-CURRENT.md` 登记执行者和文件边界 |
| 阻塞 | 已写明阻塞条件、已完成部分和恢复入口 |
| 暂停 | 用户要求停工；已记录当前完成边界和恢复入口，不自动续跑 |
| 已完成 | 验收标准全部通过，并记录真实验证命令 |

## 当前计划索引

| 计划 | 状态 | 创建日期 | 审计/规格 | 当前下一步 |
|---|---|---|---|---|
| [前端体验与地基整改](./Future_Plan/Qore/Trace/Plan-260915-01-前端体验与地基整改/Frontend-Experience-Foundation-Implementation-Plan.md) | 暂停：Task 1–3 完成 | 2026-09-15 | [综合审计报告](../audit/2026-09-15-frontend-ui-performance-architecture-audit.md) | 用户恢复后执行 Task 4；Task 3 提交 9478fb9 已集成主目录，未推送 |

## 更新规则

1. 开工前：更新计划状态、任务复选框、执行者和文件边界，再更新 `HANDOFF-CURRENT.md`。
2. 每个提交后：勾选真实完成的步骤，写入提交 hash 和实际测试结果。
3. 暂停时：写清下一步、等待什么、还差什么；禁止只写“进行中”。
4. 完成时：同步更新 Markdown、`plan.json`、本索引和 `HANDOFF-CURRENT.md`。
5. 不得把设计、Demo、代码实现和验证混为同一状态。
