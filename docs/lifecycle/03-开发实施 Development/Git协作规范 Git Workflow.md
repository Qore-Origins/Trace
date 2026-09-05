# Git协作规范 Git Workflow（单人项目精简版）

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | 2026-09-05 |
| 技术负责人 Tech Lead | HeYS-Snowe |

---

## 修改记录 Change History

| 版本 Version | 日期 Date | 修改人 Modifier | 审核人 Reviewer | 修改内容 Description |
|-------------|---------|---------------|---------------|-------------------|
| v1.0.0 | 2026-09-05 | HeYS-Snowe | HeYS-Snowe | 初始版本（单人主干模式，取代 Git Flow 模板） |

---

## 目录 Table of Contents

1. [工作流 Workflow](#1-工作流-workflow)
2. [分支管理 Branch Management](#2-分支管理-branch-management)
3. [提交规范 Commit Convention](#3-提交规范-commit-convention)
4. [代码审查 Code Review](#4-代码审查-code-review)
5. [发布与标签 Release & Tags](#5-发布与标签-release--tags)

---

## 1. 工作流 Workflow

单人项目采用 **主干开发（Trunk-Based）**，不使用 Git Flow（develop/release 分支对单人纯开销）。

```
main ──────●────●────●───▶（直接提交/推送；CI 每次验证）
            \         \
            （可选）spike/* 或 feature/* 临时分支 → 合回 main 后删除
```

- 仓库：`Qore-Origins/Trace`（远端 origin，main 跟踪）
- 通用规则遵循 `D:\Code\.Rules\common\core\workflow.md` §3（开发流程与提交规范）

## 2. 分支管理 Branch Management

| 分支 Branch | 用途 Usage | 规则 Rule |
|------------|-----------|----------|
| main | 唯一长期分支 | 直接提交；CI 必须绿；**禁止 force push** |
| spike/* | 技术验证（如 spike/search-poc） | 用完即删（结论回写文档后分支无价值） |
| feature/* | 大块功能（预计跨多次会话、可能弄脏 main 时） | 合回 main 后删除；单人项目默认不用，直接在 main 提交 |
| hotfix/* | 发布后紧急修复 | 从 tag 拉出 → 修复合入 main → 打新 tag |

保护约定：远端 main 在 v1.0 发布后开启保护（禁 force push / 禁删除）；发布前单人无保护必要。

## 3. 提交规范 Commit Convention

约定式提交（同 `.Rules` 底线规则，禁 emoji）：

```
<type>(<scope>): <subject>
```

| 类型 Type | 用途 | 本项目 scope 取值 |
|----------|------|------------------|
| feat | 新功能 | storage（存储/主进程）· renderer（UI）· search（检索）· config · ipc · scaffold |
| fix | 缺陷修复 | 同上 |
| docs | 文档 | lifecycle / design / changelog / plan |
| refactor / perf / test / style / chore / revert | 常规 | 同上或省略 scope |
| spike | 技术验证（临时） | spike |

示例（真实历史）：`feat(scaffold): Sprint 0 工程骨架——Electron 44+React 19+antd 脚手架…`、`docs(design): LLD 定稿…`

最佳实践：原子提交、小步快跑、不提交调试残留（`git status` 干净再切任务）。

## 4. 代码审查 Code Review

单人项目：PR 流程省略，替代机制为**三层审查**（03 开发计划 §6.2）：

1. **提交前自查**：对照 LLD 附录A 规范 + 改动 diff 通读；
2. **AI 代理复核**：bug-detector 视角（安全/质量）对新增代码扫描；
3. **周度回看**：每周里程碑核销时回看本周全部提交。

M4 后若引入协作者，升级为 PR + 审查模式（届时修订本文档）。

## 5. 发布与标签 Release & Tags

| 项 Item | 约定 Rule |
|--------|----------|
| tag 格式 | `v<MAJOR>.<MINOR>.<PATCH>`（如 v1.0.0） |
| 打 tag 时机 | M6 发布（安装包构建通过 + 验收清单通过） |
| Release | GitHub Release 附 NSIS 安装包 + Release Notes（05 文档） |
| 版本号 | package.json 与 tag 同步；语义化版本 |

---

## 附录 Appendix

### 附录A：Git配置（本机既有，记录备查）

```bash
git config user.name  # HeYS
git config user.email # GitHub noreply
git config --global init.defaultBranch main
```

### 附录B：.gitignore

见仓库根 `.gitignore`（node_modules/out/release/logs/IDE 等，已入库）。

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 技术负责人 Tech Lead | HeYS-Snowe | 电子批准 | 2026-09-05 |

---

**文档结束 End of Document**
