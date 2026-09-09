# 溯源 Trace

> **计划有迹可循** —— 树形计划 + 全文搜索 + 回溯定位，随时回到源头。

一款本地优先的桌面计划管理软件（by Qore / 叩心），用文件夹式树形结构组织计划，搜索命中后可回溯定位到树中节点，让每一条计划都有迹可循。

- 应用 ID：`com.qore.trace`（GitHub 组织：[Qore-Origins/Trace](https://github.com/Qore-Origins/Trace)）
- 平台：Windows 优先（无边框自绘窗口）
- 版本：v1.0.0 · Copyright (c) 2026 Qore
- 数据：全部存储在本地，根节点绑定用户选择的文件夹，不经过任何云端

---

## 功能特性

| 类别 | 说明 |
|------|------|
| 树形计划 | 计划 / 文件夹两类节点语义区分，支持新建、重命名、拖拽排序、右键菜单操作 |
| 搜索回溯 | 内存索引扫全文 → 浮层展示命中 → 定位到树节点（回溯脉冲），回到检索当下来的源头 |
| 导入导出 | `.plan`（fflate zip 打包）导出到本地文件夹，路径安全前置（path-safety 防越界） |
| 文件夹监视 | chokidar 监视计划文件夹，外部变更实时同步到树 |
| 卡牌摞动效 | 计划树卡片化视觉，D1-D8 展开/收拢/发牌动效（demo: `docs/prototype/tree-animation-demo.html`） |
| 双语界面 | i18next 中英全量适配，偏好设置里切换语言 |
| 偏好设置 | 语言（中文/English）、发牌方向，zustand persist 本地持久化 |
| 自绘窗口 | 无边框窗口 + 自定义最小化/最大化/关闭（保留 Windows 拖拽/双击标题栏特性） |

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | Electron 44 |
| UI | React 19 + antd 5 + zustand 4 |
| 语言 | TypeScript 5（严格模式） |
| 构建 | electron-vite 5 + electron-builder 26（NSIS） |
| 测试 | vitest 5（Node 环境单测） |
| 其他 | fflate（zip）· chokidar（监视）· i18next（i18n） |

## 架构

四层结构，IPC 边界清晰：

```
main/     主进程：文件系统、服务层（仓库/存储/搜索/树缓存/监视/导入导出/IPC 注册）
preload/  桥接层：contextBridge 暴露受控 IPC API
renderer/ UI：React + zustand stores（不直接触碰文件系统，一切经 IPC）
shared/   契约层：IPC 合约/事件类型/错误/路径工具，三处共用
```

- 所有 IPC 通道在 `src/shared/ipc-contract.ts` 集中定义（单一合约源）
- 新增 IPC 三步：shared 定类型 → `main/ipc/register.ts` 注册 → `preload/index.ts` 暴露
- 路径越界单点防护：`src/main/services/path-safety.ts`

## 快速开始

```bash
npm install          # 建议配置 npmmirror 源（见下方「国内网络」）
npm run dev          # 开发模式（热更新）
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | electron-vite 开发模式 |
| `npm run typecheck` | TS 双过（tsconfig.node + tsconfig.web） |
| `npm run test` | vitest 单测（`test/**/*.spec.ts`） |
| `npm run build` | electron-vite 构建（产出 `out/`） |
| `npm run build:win` | 构建 + 打包 NSIS 安装包（产出 `release/溯源 Trace-{version}-setup.exe`） |
| `npm run start` | electron-vite preview（预览构建产物） |
| `npm run icon` | 生成应用图标（`scripts/make-ico.mjs`） |

> 修改 `src/` 或 `shared/` 后必跑：`npm run typecheck`（0 错）+ `npm run test`（全绿）。

## 目录结构

```
Trace/
├── src/
│   ├── main/            # 主进程（services/ 服务层、ipc/ 注册）
│   ├── preload/         # 预加载（IPC 桥）
│   ├── renderer/        # 渲染进程（views/、components/、stores/、spikes/）
│   └── shared/          # 三处共用（ipc-contract.ts 等）
├── test/                # vitest 单测
├── docs/                # Plan 计划 / lifecycle 生命周期 / changelog 改动文档 / prototype 原形
├── scripts/             # make-ico.mjs 等构建工具
├── resources/           # electron-builder 构建资源（icon 等）
└── electron-builder.yml
```

## 国内网络

npm / electron 下载走镜像（npmmirror）：

```bash
# npm 源
npm config set registry https://registry.npmmirror.com

# electron / electron-builder 二进制镜像（打包时如遇 “The server aborted pending request” 即 GitHub 源断流）
# 在 build:win 前设置环境变量：
#   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
#   ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

## 开发约定

- 项目定制规则见 `CLAUDE.md` / `AGENTS.md`（两份内容相同，前者供 Claude Code 加载）
- 编码底线遵循 `D:\Code\.Rules\compact-core.md`（AI 行为约束、安全红线、代码风格）
- 禁止事项：renderer 直触 fs/electron · 绕过 path-safety · 改 out/ 或 release/ · 使用 emoji
- 状态推进与交接：`docs/HANDOFF-*.md`（中断会话的接手文档）

## 许可

UNLICENSED（私有项目）。署名：Copyright (c) 2026 Qore
