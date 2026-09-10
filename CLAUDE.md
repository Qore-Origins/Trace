# Trace - 项目定制规则

> **应用名称**: 溯源 Trace（by Qore）
> **更新日期**: 2026-09-07
> **项目类型**: Electron 桌面计划管理软件（本地优先）
> **技术栈**: Electron 44 / React 19 / TypeScript 5 / zustand 4 / antd 5 / electron-vite 5 / vitest 5

---

## 0. 规则体系引用

### 基础规则（自动生效）

本项目的编码规则基于 AI 编码规则体系：

- **精简核心**: `D:\Code\.Rules\compact-core.md` — AI 始终加载的约束层（行为 / 安全 / 代码底线）+ 按需加载清单
- **完整索引**: `D:\Code\.Rules\main.md`
- **规则优先级**: 本文件(定制规则) > 预设配置 > 核心规则 > 默认行为
- **规则冲突时**: 以本文件中的定制规则为准
- **组织身份**: `D:\Code\.Rules\OrganizationAndUser.md` — 包名/署名/口号 SSOT

> 安全红线、代码风格底线、AI 行为约束已由 `compact-core.md` 统一提供，此处不重复。
> 项目特定禁止事项见本文档 §十二。

---

## 一、项目概述

### 1.1 项目信息

| 属性 | 值 |
|------|-----|
| 项目名称 | 溯源 Trace（`productName: 溯源 Trace`） |
| 项目类型 | 桌面计划管理软件（个人自用，本地优先） |
| 当前版本 | v0.10.1 公测版 Beta 2 修订（版本史见 docs/changelog/CHANGELOG.md；1.0.0 为正式版） |
| 应用 ID | `com.qore.trace` |
| 署名 | Copyright (c) 2026 Qore |
| GitHub 仓库 | `git@github.com:Qore-Origins/Trace.git`（**组织为 Qore-Origins，简称 Qore 已被占用**） |
| 平台定位 | Windows 优先（macOS 仅将来可能经黑苹果 VM，用户无 Apple 设备） |
| 定位 | 计划有迹可循——树形计划 + 全文搜索 + 回溯定位，随时回到源头 |

### 1.2 技术栈

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 桌面壳 | Electron | ^44.0.0 | 主进程/预加载/渲染进程 |
| UI 框架 | React | ^19.0.0 | 渲染层 |
| 语言 | TypeScript | ^5.0.0 | 全栈 TS |
| 状态管理 | zustand | ^4.0.0 | 渲染层 stores/ |
| 组件库 | antd | ^5.0.0 | 界面组件 |
| 构建 | electron-vite | ^5.0.0 | dev/build 一体化 |
| 打包 | electron-builder | ^26.0.0 | NSIS 安装包 |
| 测试 | vitest | ^5.0.0 | 单测（Node 环境） |
| 压缩 | fflate | ^0.8.3 | 导入导出 zip |
| 监视 | chokidar | ^5.0.0 | 计划文件夹 watch |

---

## 二、目录结构规范

### 2.1 项目根目录

```
Trace/
├── src/
│   ├── main/                  # 主进程
│   │   ├── index.ts           # 应用入口
│   │   ├── ipc/register.ts    # IPC 注册（合约见 shared/ipc-contract.ts）
│   │   └── services/          # 服务层
│   │       ├── plan-repository.ts   # 计划树仓库
│   │       ├── storage-service.ts   # 存储/落盘
│   │       ├── search-service.ts    # 全文搜索（Sprint 3 溯源）
│   │       ├── diary-service.ts     # 日记深化（幂等 ensure/月枚举/日摘要）
│   │       ├── transfer-service.ts  # 导入导出
│   │       ├── tree-cache.ts        # 树缓存
│   │       ├── watch-service.ts     # 文件夹监视
│   │       ├── path-safety.ts       # 路径安全（防越界）
│   │       ├── config-service.ts    # 配置
│   │       ├── app-service.ts       # 应用服务
│   │       └── event-bus.ts         # 事件总线
│   ├── preload/               # 预加载（expose IPC 桥）
│   │   ├── index.ts
│   │   └── index.d.ts
│   ├── renderer/              # 渲染进程
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── views/         # 页面级（OnboardingView / WorkspaceView）
│   │       ├── components/    # 组件（PlanTreePanel / ContentArea / SearchOverlay / TopBar / StatusBar / WindowControls / NameDialogModal / cards）
│   │       ├── stores/        # zustand（app / plan / tree / search / ui）
│   │       ├── spikes/        # 实验性探针（Poc 级，不入主流程）
│   │       ├── styles/        # 样式（workspace.css）
│   │       └── ipc-client.ts
│   └── shared/                # 主进程/渲染进程共享
│       ├── ipc-contract.ts    # IPC 合约（域：plan/note/task/title/search/status/system）
│       ├── event-types.ts
│       ├── errors.ts
│       └── path-utils.ts
├── test/                      # vitest 单测（*.spec.ts，Node 环境）
├── scripts/                   # make-ico.mjs 等工具
├── docs/                      # Plan/ / lifecycle/ / changelog/ / prototype/
├── Resource/ / release/ / out/ / resources/
├── electron-builder.yml
├── electron.vite.config.ts
├── vitest.config.ts           # alias: @shared → src/shared
├── tsconfig.{node,web,root}.json
└── package.json
```

### 2.2 四层架构（IPC 边界）

| 层 | 职责 | 可访问 shared |
|----|------|---------------|
| main/ | 文件系统、服务、IPC handler | ✓ |
| preload/ | 桥接（contextBridge 暴露受限 API） | ✓ |
| renderer/ | UI + zustand stores | ✓（仅经 IPC） |
| shared/ | 合约/类型/工具，三处共用 | — |

> renderer 的 stores 不直接触碰文件系统——一切经 `ipc-client.ts` → preload 桥 → main 服务。
> 新增 IPC 必须同步更新 `shared/ipc-contract.ts`（单一合约源）。

---

## 三、代码规范

### 3.1 命名规范（TypeScript）

```yaml
命名约定:
  组件文件: PascalCase.tsx        # PlanTreePanel.tsx / SearchOverlay.tsx
  服务/工具: kebab-case.ts        # plan-repository.ts / path-utils.ts
  stores: kebab-store.ts         # app-store.ts / tree-store.ts
  IPC 事件域: 短小写               # 'plan' / 'note' / 'search' / 'status'
  共享类型: PascalCase             # PlanNode / SearchResult
```

### 3.2 TypeScript 规范

- 严格模式；NEVER 使用 `any` 逃逸（如确需，加注释说明并收敛）
- React 组件用函数式 + hooks；无 class 组件
- zustand store 单一职责（一个文件一个域：tree / plan / search 分开）
- `@shared/*` alias 已配置（vitest 同），只能导入 shared 模块

---

## 四、IPC 合约规范

```yaml
规则:
  - 所有 IPC 通道在 shared/ipc-contract.ts 集中定义（channel 常量 + 请求/响应类型）
  - 新增通道三步: shared 定类型 → main/ipc/register.ts 注册 → preload/index.ts 暴露
  - 错误处理统一走 shared/errors.ts；交互式确认与 file:line 引用遵循 compact-core
  - path-safety.ts 为路径越界单点防护——任何文件操作路径必须先过它
```

---

## 五、业务规则

| 规则ID | 规则描述 | 备注 |
|--------|----------|------|
| BR-001 | 计划树的根节点指向用户选择的文件夹 | 空文件夹需引导「新建第一个计划/迁入 Markdown」 |
| BR-002 | 搜索定位=回溯脉冲：内存扫索引 → 浮层 → 定位到树节点 | Sprint 3 溯源 |
| BR-003 | 空库「+」号数据驱动补全根节点 | 空库时「+」恢复的修复已定案（++号相关 bug 全历史教训：任何 + 号状态变更必须主动刷新，NEVER 依赖重启） |
| BR-004 | 导入导出走 transfer-service（fflate zip） | 格式 `xxx.plan`（参考 `D:\Desktop\Plan` 目录结构）；路径安全前置 |
| BR-005 | 树节点 = 计划 / 文件夹 两类，语义区分 | "计划与文件夹没区别"是已识别的问题——视觉效果与操作必须可区分 |
| BR-006 | 远期：智能体接入（开放 API 供 agent 调用） | 用户自配 base_url + API Key（含预设列表）；用于导入识别失败兜底等；不限于此，属规划保留项 |
| BR-007 | 日记根自动管理区 | Diary/<YYYY-MM-DD>/ 由 diary-service 幂等维护（只建不补）；显示名「日记」；契约零变更（日计划=普通计划） |

### 窗口行为（无边框自绘约定）

- 无边框窗口，**自绘**最小化/最大化/还原/关闭；保留 Windows 窗口特性（拖拽/双击标题栏等）
- 窗口控件视觉：极简无背景（三个图标），与整体 UI 统一
- 菜单栏：VS Code 式（文件/编辑/查看/帮助），全局快捷键；导入导出收进「文件」；「文件 → 设置」入口
- 菜单/标题栏必须加 `no-drag` 白名单（历史 bug：事件被窗口拖拽吞掉致点击无效）

---

## 六、构建与测试命令

```bash
npm run typecheck        # tsconfig.node + tsconfig.web 双过
npm run test             # vitest run（test/**/*.spec.ts）
npm run dev              # electron-vite dev
npm run build            # electron-vite build（产出 out/）
npm run build:win        # build + electron-builder --win --x64（产出 release/）
npm run icon             # 生成 ico
```

**变更后自动测试**（修改 `src/` 下任何代码或 `shared/` 合约后必跑）：
1. `npm run typecheck`（0 错）
2. `npm run test`（全绿）
3. 涉及主进程服务逻辑：同时更新 `test/` 对应 spec（现有 6 组：plan-repository / storage-service / tree-utils / task-state / transfer-service / search-service）

---

## 七、发布规范

```yaml
打包: npm run build:win
产物: release/溯源 Trace-{version}-setup.exe  （electron-builder artifactName）
版本: package.json version 为唯一真源；发布前更新 docs/changelog/
生命周期: docs/lifecycle/（00 启动 ~ 07 用户文档）
```

---

## 八、检查清单

### 开发前
- [ ] `npm install`（锁 package-lock）
- [ ] 读 `docs/Plan/` 当前阶段计划 + `.issues/` 未决条目

### 提交前
- [ ] `npm run typecheck` 0 错
- [ ] `npm run test` 全绿
- [ ] 无 TODO 残留（或已登记 .issues）
- [ ] git commit 约定式（feat/fix/refactor + scope）

### 发布前
- [ ] 版本号已升（package.json + docs/changelog）
- [ ] 三跑全绿（typecheck/test/build:win）
- [ ] 真机启动验证空库引导 + 搜索回溯两条主路径

---

## 九、协作约定（用户对 AI 的明确要求，源自本会话）

```yaml
进度与交接:
  - 每个阶段结束必须讲清三件事: 下一步要干嘛 / 等什么 / 还差什么（用户原话"以后这些要说清楚"）
  - 阶段完了可以提前开下一阶段，NEVER 干等用户指令
  - 用户离开/忙时: 能跳过的先跳过，最后汇总给用户（NEVER 因等待中断）

环境与网络:
  - npm 装依赖用 npmmirror 源 + electron 镜像；网络问题先确认用户 VPN 状态
  - 用户 AI 额度有限（曾有"5 小时额度没了"中断）——长任务别赌单次会话，拆批

设计节奏:
  - 用户未要求时优先功能验证；UI/视觉/前端整体设计在用户提出时再做（"先做视觉设计吧"）
  - 用户会拿手机实测并反馈截图级细节（如"索引就绪被底部遮挡"）——UI 改动必须自测遮挡/越界
```

---

## 十、禁止事项

```yaml
禁止:
  - 在 renderer 直接使用 fs/electron 模块（必须经 IPC）
  - 绕过 path-safety.ts 处理文件路径
  - 直接改 out/ 或 release/（均为构建产物）
  - 在 spikes/ 存放"正式"功能（探针转正须移出）
  - 使用 emoji（代码/注释/commit/文档全禁）
  - git add node_modules / out / release / Resource（.gitignore 已配，勿 -f）
```

## 十一、变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0.0 | 2026-09-07 | 初始版本：项目信息、四层架构、IPC 合约、构建/测试/发布规范、禁止事项 |
| v1.0.1 | 2026-09-07 | 依会话回溯补充：GitHub 仓库 Qore-Origins、无边框自绘窗口约定、BR-005/006（.plan 导出/智能体接入远期）、协作约定（讲清下一步/等什么/还差什么） |
| v0.9.0 | 2026-09-09 | 版本线确立：<1.0.0 按 git 里程碑编目（0.1-0.9），package.json 唯一真源；changelog 转正式 CHANGELOG.md（keep-a-changelog 风格） |

---

*此规则由 AI-Rules 规则体系 + Trace 项目定制需求自动生成*
*规则即模板，模板即规则*
