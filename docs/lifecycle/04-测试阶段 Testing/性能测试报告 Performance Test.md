# Trace Electron 性能测试报告

## 文档信息

| 项目 | 内容 |
|---|---|
| 报告版本 | v1.1.0 |
| 采集日期 | 2026-09-25 至 2026-09-26（原始记录时间为 UTC） |
| 测试环境 | Windows x64、Electron 开发构建、临时合成计划库 |
| 测试工具 | Electron DevTools Protocol、Performance API、Trace 专用 fixture/capture 脚本 |
| 测试范围 | 渲染器首帧/交互标记、树展开、计划打开、任务行渲染、搜索、Muya 激活与 JS Heap |

## 1. 测试概述

本报告替换通用服务器/订单并发模板，记录 Trace 单机桌面应用的可复现诊断基线。所有样本均由 `scripts/trace-perf-fixture.mjs` 写入 `%TEMP%` 下的隔离目录，没有读取或修改用户计划库。

当前记录适合发现规模退化，不构成稳定 SLA：多数场景只执行一轮，表中 P50/P95 在 N=1 时相同；帧采样由 Electron 前台窗口内的 `requestAnimationFrame` 获取，不等同于屏幕录制或真实显示器帧率。进程冷启动时间、操作系统 RSS、持续多轮编辑吞吐量未测。

### 1.1 测试环境

| 环境项 | 实测值 |
|---|---|
| 操作系统 | Windows 10.0.26340 x64 |
| CPU | AMD Ryzen 9 8940HX with Radeon Graphics，32 个逻辑处理器 |
| 内存 | 16,337,637,376 bytes（约 15.2 GiB） |
| Electron / Chromium | Electron 44.2.0 / Chrome 152.0.7977.76 |
| 构建模式 | `electron-vite dev`；Muya/重型图表依赖按需加载 |
| 样本规模 | 标准：100 计划/1,000 任务；上限：1,000 计划/10,000 任务；任务卡专项：100/1,000 任务 |

## 2. 指标定义与方法

- `app-interactive`：渲染器导航之后，应用阶段进入可交互状态的 mark；不包含 Electron 进程创建前耗时。另列 FCP 以区分浏览器绘制与 React/App 阶段。
- `task-render`：任务行批次挂载后的 React/DOM 测量值；不含持久化。
- `tree-expand`：树展开/收拢交互的测量值。1,000 计划上限场景另记录单轮展开中的 RAF 间隔分布。
- `plan-open`、`search-query`、`muya-activate`：各自从交互/异步边界开始到完成的前端耗时；Muya 冷激活和 warm 再激活分开观察。
- `edit-commit`：`storage:savePlan` 成功/失败返回前后的 commit 包围测量。当前记录数量少且包含启动/初始化期间产生的保存，不当作用户键入延迟分布。
- JS Heap 来自 Chromium `performance.memory`，不是 Electron 所有进程的 RSS，也不代表完整应用内存。

标准与上限 fixture 使用相同计划结构。专项任务卡 fixture 只挂载一张含 100 或 1,000 行的任务卡。脚本在采样时使用 `Page.bringToFront`，避免后台页面 RAF 节流。Muya 首次激活还检查编辑宿主保持可编辑且 `performance.timeOrigin` 不变，以发现整页重载。

## 3. 测试结果

### 3.1 代表性指标

| 场景 | 样本/观察 | 结果 | 判断 |
|---|---:|---|---|
| 标准库首屏（100 计划/1,000 任务） | 1 轮冷导航 | FCP 4,360 ms；App interactive mark 距导航 4,364 ms；App 阶段 measure 119.6 ms | 开发服务器冷导航包含 Vite 依赖优化开销，不等于安装版冷启动 |
| 标准库树/计划/任务 | 1 轮 | `plan-open` 154.1 ms；10 行 `task-render` 8.7 ms；树样本两次 192.5/235.6 ms；RAF 间隔 P50 6.1 ms、P95 12.2 ms，>20 ms 1 帧 | 标准规模交互在本机流畅；树动画样本量有限 |
| 搜索（标准库） | 1 轮 | `search-query` 318.1 ms | 单轮诊断值，不作为稳定分位数 |
| Muya 冷/热激活（标准库） | 3 次 activation measure | 冷 1,126.7 ms；热 5.9、8.5 ms | 首次加载明显更慢；首次激活仍在同一 renderer 且可编辑 |
| 100 行任务卡 | 1 轮 | `task-render` 22.2 ms | 单轮 |
| 1,000 行任务卡 | 1 轮 | `task-render` 75.4 ms | 1,000 行挂载可感知，应持续观察但本样本未显示秒级卡顿 |
| 上限库（1,000 计划/10,000 任务） | 树展开 N=1 | 展开 15,799.1 ms；22 个 RAF 间隔的 P50 60.6 ms、P95 115.1 ms；其中 21 个 >20 ms，样本中位间隔对应约 16.5 FPS | 明确退化；不可视为达标，需后续对千节点展开动画与 DOM 工作分解优化 |
| 上限库计划打开/搜索/Muya | 各 N=1 | `plan-open` 618.5 ms；搜索 415.8 ms；Muya 冷激活 1,043.8 ms；10 行任务渲染 5.9 ms | 搜索/计划载入接近 1s 目标边界；首击编辑仍可用且未重载 |
| 上限库渲染器 JS Heap | 1 次交互后快照 | 使用 170.9 MB；V8 total heap 233.6 MB | 仅 renderer JS Heap，不含主进程/GPU/原生资源 |
| 标准库静置快照 | 启动约 5 秒后，无脚本交互 | renderer JS Heap 使用 49.0 MB；100 计划/1,000 任务，已挂载 101 个树行和 10 个任务行 | 单次快照；启动自带树/当前计划初始化，不能代表所有空闲阶段 |
| 失焦注释图表 | 真实 Electron，图表 fixture | Mermaid/Vega-Lite/Flowchart/Sequence 均为 `ready` 并生成 4 个 SVG；PlantUML 为 `plantuml-required`；普通 TypeScript 围栏仍为源码代码块 | 五种 Muya 图表语言均有预期阅读态行为；默认未向网络发送 PlantUML 源码 |

### 3.2 原始记录

原始 JSON 包含采集时间、机器信息、导航/FCP、计数、Performance mark/measure、帧样本摘要与交互结果：

- [标准规模交互基线](../../performance/2026-09-25-electron-baseline/standard.json)
- [标准规模启动静置快照](../../performance/2026-09-25-electron-baseline/standard-startup.json)
- [100 行任务卡](../../performance/2026-09-25-electron-baseline/task-100.json)
- [1,000 行任务卡](../../performance/2026-09-25-electron-baseline/task-1000.json)
- [1,000 计划上限规模](../../performance/2026-09-25-electron-baseline/upper.json)
- [失焦图表专项验证](../../performance/2026-09-25-electron-baseline/static-diagrams.json)

### 3.3 构建验证

`npm run build` 成功：renderer 转换 7,153 个模块；Muya 与图表运行时仍按异步分块输出，未并入主首屏同步 bundle。完整产物清单过长，不在正文复制；以构建命令输出及当前 chunk 配置为准。

## 4. 结论与行动项

1. **P1：上限规模树动画退化。** 1,000 计划展开样本约 15.8 秒，P95 RAF 间隔约 115 ms。应先剖析 1,000 行动画期间 React commit、布局/绘制和分波算法，再选择分批、虚拟化或高规模降级；不得仅凭测试绿灯宣告体验达标。
2. **P2：首次 Muya 激活约 1.0–1.2 秒。** 热激活约 6–9 ms；下一步在安装构建与实际注释中复测，并评估可见加载反馈和预热时机。
3. **P2：1,000 行任务卡挂载约 75 ms。** 监视实际交互和内存；只有用户反馈或可复测证据显示问题时再引入虚拟化。
4. **补充样本。** 对冷启动进程、用户键入到保存、搜索与展开至少重复 10 轮，并在 Release/安装包环境中采集；当前 N=1 样本只作诊断。

## 5. 重现方式

```powershell
node scripts/trace-perf-fixture.mjs --profile standard
node scripts/trace-perf-capture.mjs --port 9338 --exercise --output <raw-output.json>
```

上限及任务卡专项 profile 为 `upper`、`task-100`、`task-1000`；失焦图表专项使用 `diagram-matrix` 并附加 `--verify-static-diagrams`。Electron 必须使用独立临时 `--user-data-dir` 启动；不要复用正在运行的单实例，也不要指向用户的正式计划库。脚本输出目录位于临时系统目录。

> 当前证据没有覆盖安装版启动、IME、剪贴板、持续键入及实际 GPU/进程 RSS。上述项目仍需独立真机体验/性能验收。
