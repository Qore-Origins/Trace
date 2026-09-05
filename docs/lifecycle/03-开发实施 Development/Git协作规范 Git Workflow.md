# Git协作规范 Git Workflow

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | YYYY-MM-DD |
| 技术负责人 Tech Lead | |

---

## 目录 Table of Contents

1. [Git工作流 Git Workflow](#1-git工作流-git-workflow)
2. [分支管理 Branch Management](#2-分支管理-branch-management)
3. [提交规范 Commit Convention](#3-提交规范-commit-convention)
4. [代码审查 Code Review](#4-代码审查-code-review)
5. [常用命令 Common Commands](#5-常用命令-common-commands)

---

## 1. Git工作流 Git Workflow

### 1.1 工作流选择 Workflow Selection

本项目采用 **Git Flow** 工作流

```
                    main (生产)
                       │
                       ▼ merge
                   develop (开发)
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
    feature/*     release/*      hotfix/*
    (功能分支)      (发布分支)      (紧急修复)
```

### 1.2 分支类型说明 Branch Types

| 分支类型 Branch Type | 命名规范 Naming | 生命周期 Lifecycle | 说明 Description |
|------------------|---------------|----------------|---------------|
| main | main | 长期 | 生产环境代码 |
| develop | develop | 长期 | 开发环境代码 |
| feature | feature/功能名称 | 临时 | 新功能开发 |
| release | release/版本号 | 临时 | 发布准备 |
| hotfix | hotfix/问题描述 | 临时 | 紧急问题修复 |

---

## 2. 分支管理 Branch Management

### 2.1 分支策略 Branch Strategy

#### main分支

| 属性 Attribute | 说明 Description |
|-------------|---------------|
| 保护 Protected | ✅ 是 |
| 直接推送 Direct Push | ❌ 禁止 |
| 合并要求 Merge Req | 需要Pull Request + 审查 |

#### develop分支

| 属性 Attribute | 说明 Description |
|-------------|---------------|
| 保护 Protected | ✅ 是 |
| 直接推送 Direct Push | ❌ 禁止 |
| 合并要求 Merge Req | 需要Pull Request + 审查 |

#### feature分支

| 属性 Attribute | 说明 Description |
|-------------|---------------|
| 来源 From | develop |
| 合并到 Merge To | develop |
| 命名 Naming | feature/功能描述 或 feature/任务编号 |
| 删除 Delete | 合并后删除 |

**命名示例:**

```
feature/user-login
feature/123-shopping-cart
feature/product-search
```

#### hotfix分支

| 属性 Attribute | 说明 Description |
|-------------|---------------|
| 来源 From | main |
| 合并到 Merge To | main + develop |
| 命名 Naming | hotfix/问题描述 |
| 删除 Delete | 合并后删除 |

**命名示例:**

```
hotfix/payment-error
hotfix/security-fix
```

### 2.2 分支操作流程 Branch Operations

#### 功能开发流程 Feature Development Flow

```
1. 从develop创建feature分支
   git checkout develop
   git pull origin develop
   git checkout -b feature/功能名称

2. 开发并提交
   git add .
   git commit -m "feat: 功能描述"

3. 推送到远程
   git push -u origin feature/功能名称

4. 创建Pull Request到develop

5. 代码审查通过后合并

6. 删除feature分支
   git branch -d feature/功能名称
```

#### 紧急修复流程 Hotfix Flow

```
1. 从main创建hotfix分支
   git checkout main
   git pull origin main
   git checkout -b hotfix/问题描述

2. 修复并提交
   git add .
   git commit -m "fix: 问题描述"

3. 推送到远程
   git push -u origin hotfix/问题描述

4. 创建Pull Request到main

5. 审查通过后合并到main

6. 同步回develop
   git checkout develop
   git merge hotfix/问题描述
   git push origin develop
```

---

## 3. 提交规范 Commit Convention

### 3.1 提交消息格式 Commit Message Format

```
<类型>(<范围>): <主题>

<body>

<footer>
```

### 3.2 提交类型 Commit Types

| 类型 Type | 说明 Description | 示例 Example |
|----------|---------------|-------------|
| feat | 新功能 | feat: 添加用户登录功能 |
| fix | Bug修复 | fix: 修复支付回调处理错误 |
| docs | 文档更新 | docs: 更新API文档 |
| style | 代码格式(不影响功能) | style: 格式化代码 |
| refactor | 重构(不是新功能也不是修复) | refactor: 重构用户服务 |
| perf | 性能优化 | perf: 优化查询性能 |
| test | 测试相关 | test: 添加单元测试 |
| chore | 构建/工具相关 | chore: 更新依赖版本 |
| revert | 回滚提交 | revert: 回滚提交abc123 |

### 3.3 提交范围 Commit Scopes

| 范围 Scope | 说明 Description |
|----------|---------------|
| user | 用户模块 |
| order | 订单模块 |
| product | 产品模块 |
| payment | 支付模块 |
| auth | 认证模块 |
| ui | 前端界面 |
| api | 接口相关 |
| config | 配置相关 |
| database | 数据库相关 |

### 3.4 提交示例 Commit Examples

```bash
# 简单提交
git commit -m "feat(user): 添加用户注册功能"

# 带说明的提交
git commit -m "fix(order): 修复订单金额计算错误

- 修复折扣计算时精度丢失问题
- 使用BigDecimal替代double计算
- 添加相关单元测试

Closes #123"

# 功能开发提交
git commit -m "feat(product): 添加产品搜索功能

- 实现关键词搜索
- 支持按分类筛选
- 添加搜索结果分页

Refs #45"
```

### 3.5 提交最佳实践 Commit Best Practices

| 原则 Principle | 说明 Description |
|--------------|---------------|
| 原子性 Atomic | 每次提交只做一件事 |
| 频繁提交 Frequent | 小步快跑，频繁提交 |
| 清晰描述 Clear | 提交信息清晰描述变更 |
| 不提交暂存 No Staging | 不要提交临时调试代码 |

---

## 4. 代码审查 Code Review

### 4.1 Pull Request流程 PR Process

```
开发完成 → 创建PR → 自动检查 → 人工审查 → 修改反馈 → 审查通过 → 合并 → 删除分支
```

### 4.2 PR模板 PR Template

```markdown
## 变更描述 Description
<!-- 简要描述本次变更的内容 -->

## 变更类型 Type of Change
- [ ] 新功能 New Feature
- [ ] Bug修复 Bug Fix
- [ ] 重构 Refactor
- [ ] 文档 Documentation
- [ ] 其他 Other

## 相关 Issues Related Issues
<!-- 关联的Issue编号，如 Closes #123 -->
Resolves #

## 测试 Testing
- [ ] 单元测试通过 Unit tests pass
- [ ] 手动测试完成 Manual testing completed
- [ ] 代码自审查完成 Self-review completed

## 截图 Screenshots
<!-- 如果是UI变更，请提供截图 -->

## 检查清单 Checklist
- [ ] 代码符合项目规范
- [ ] 添加了必要的注释
- [ ] 更新了相关文档
- [ ] 无新的警告产生

## 其他说明 Additional Notes
<!-- 其他需要说明的事项 -->
```

### 4.3 审查标准 Review Standards

| 检查项 Check Item | 标准 Standard |
|----------------|-------------|
| 功能正确性 Functionality | 实现符合需求，功能正确 |
| 代码质量 Code Quality | 代码清晰，符合规范 |
| 性能 Performance | 无明显性能问题 |
| 安全性 Security | 无安全漏洞 |
| 测试 Tests | 有足够的测试覆盖 |
| 文档 Docs | 必要的文档已更新 |

### 4.4 审查响应时间 Response Time

| 优先级 Priority | 响应时间 Response Time |
|--------------|----------------------|
| 紧急 Urgent | 2小时 |
| 高 High | 1个工作日 |
| 普通 Normal | 2个工作日 |
| 低 Low | 3个工作日 |

---

## 5. 常用命令 Common Commands

### 5.1 分支操作 Branch Operations

```bash
# 查看所有分支
git branch -a

# 创建新分支
git branch <branch-name>

# 切换分支
git checkout <branch-name>

# 创建并切换分支
git checkout -b <branch-name>

# 删除本地分支
git branch -d <branch-name>

# 删除远程分支
git push origin --delete <branch-name>

# 重命名分支
git branch -m <old-name> <new-name>
```

### 5.2 提交操作 Commit Operations

```bash
# 查看状态
git status

# 添加所有变更
git add .

# 添加指定文件
git add <file>

# 提交变更
git commit -m "message"

# 修改最后一次提交
git commit --amend

# 查看提交历史
git log
git log --oneline
git log --graph --oneline --all
```

### 5.3 远程操作 Remote Operations

```bash
# 查看远程仓库
git remote -v

# 拉取更新
git pull origin <branch>

# 推送变更
git push origin <branch>

# 首次推送(建立关联)
git push -u origin <branch>

# 拉取远程分支
git fetch origin
git fetch origin <branch>
```

### 5.4 合并与冲突 Merge & Conflicts

```bash
# 合并分支
git merge <branch>

# 变基合并
git rebase <branch>

# 终止合并
git merge --abort

# 继续合并(解决冲突后)
git merge --continue

# 查看冲突文件
git diff --name-only --diff-filter=U
```

### 5.5 撤销操作 Undo Operations

```bash
# 撤销工作区修改
git checkout -- <file>

# 撤销暂存区修改
git reset HEAD <file>

# 撤销最后一次提交(保留修改)
git reset --soft HEAD~1

# 撤销最后一次提交(不保留修改)
git reset --hard HEAD~1

# 回退到指定提交
git reset --hard <commit-hash>
```

---

## 附录 Appendix

### 附录A：Git配置 Git Configuration

```bash
# 用户信息
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# 默认分支名称
git config --global init.defaultBranch main

# 别名设置
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.unstage 'reset HEAD --'
git config --global alias.last 'log -1 HEAD'
git config --global alias.visual 'log --graph --oneline --all'
```

### 附录B：.gitignore模板 .gitignore Template

```gitignore
# 编译产物
target/
build/
dist/
out/

# IDE
.idea/
.vscode/
*.iml
.DS_Store

# 日志
*.log
logs/

# 临时文件
*.tmp
*.bak
*.swp
*~

# 依赖
node_modules/
vendor/

# 环境配置
.env
.env.local

# 测试覆盖率
coverage/
.nyc_output/
```

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 技术负责人 Tech Lead | | | |

---

**文档结束 End of Document**
