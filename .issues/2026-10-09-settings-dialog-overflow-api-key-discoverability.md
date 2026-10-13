# 设置弹窗出界与 API Key 入口不明显

- 状态：设置弹窗分类导航与 API Key 提示已实现并通过定向自动验证；待用户视觉验收
- 发现日期：2026-10-09
- 来源：用户截图与提问
- 当前 owner：`/root`；文件边界见 `docs/HANDOFF-CURRENT.md` 当前所有权。

## 现象

1. 设置弹窗包含偏好、计划库、名称模板和小沅模型服务等长内容；窗口高度不足时弹窗整体超出 viewport，底部无法正常访问。窄的 Descriptions 标签列还会把标签逐字挤成竖排。
2. API Key 输入框只在服务配置先保存并选中后显示。新建服务面板不说明这个顺序，用户无法判断密钥的填写位置。

## 根因与修复边界

- Modal body 没有限制最大高度或内部滚动；宽度使用 antd 默认值，复杂字段挤压了描述表格的列宽。修复仅调整设置弹窗尺寸/滚动和描述表格的列约束，不改变其他弹窗。
- `AgentSettingsSection` 已有独立的 `agent:key:set` 调用和密码输入。新建服务必须先创建配置以获得服务 ID，然后才可保存密钥。增加中英文流程说明，不改 IPC、加密、密钥回读或服务存储。

## 验收

- 长设置页的 Modal body 有 viewport 约束并可纵向滚动；窄窗口下字段、标签不横向溢出或逐字竖排。
- 新建服务状态明确提示先保存服务再配置 API Key；保存服务后密钥输入框出现，且仍为密码输入，不回显既有密钥。
- 运行对应 UI 回归、`npm run typecheck` 与 `npm run build`；记录实际结果。

## 实施结果（2026-10-09）

- Modal 宽度改为 viewport 自适应；内容区限制最大高度并可纵向滚动。描述表固定布局，标签列设定宽度；移除偏好和库根目录内容的最小宽度挤压。
- 新建模型服务时显示中英文提示，说明服务保存后才显示 API Key 输入框。现有 API Key 仍由独立主进程密钥通道保存，UI 不回读密钥。
- 先加入断言验证旧实现：目标两项回归失败；修复后 `npm run test -- test/app-shell.spec.tsx test/agent-settings.spec.tsx` 为 2 files / 26 tests passed，`npm run typecheck`、`npm run build`、所涉 tracked diff-check 均通过。
- 未构建安装包、未升版本、未提交或推送。仍待用户实机确认弹窗滚动与整体视觉效果。

## 分类导航重构（2026-10-09）

- 用户补充目标：设置整体高度仍显得过高，希望参照所附 ChatGPT 设置界面使用左侧分类导航，右侧只显示当前设置类别，而不是把全部类别连续堆叠在一个滚动表格中。
- 设计决策：分类为「常规」「计划库」「命名模板」「小沅模型服务」「关于与快捷键」；设置主区限高并独立滚动，窄窗口下导航横向滚动；沿用 Trace 主题 token 与字体，不新增搜索功能。
- 实现：设置弹窗拆分为「常规」「计划库」「命名模板」「小沅模型服务」「关于与快捷键」。桌面采用左侧固定导航和右侧当前分类内容；小窗口导航横向滚动，主内容区独立纵向滚动。弹窗最大高度为 760px，继续响应 viewport 尺寸。颜色沿用语义 token，保留键盘焦点态和 reduced-motion 处理。
- API Key：新建服务的先保存后配置提示继续在「小沅模型服务」内显示。密钥仍使用原密码输入和独立主进程加密 IPC，不回读、不显示已保存密钥。
- 验证：`npm run test -- test/app-shell.spec.tsx test/settings-navigation.spec.tsx test/agent-settings.spec.tsx` 为 3 files / 27 tests passed；其中 loopback 401 为预期认证失败测试。`npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 未覆盖：未启动 Electron 做低矮/窄窗口实际视觉验收；未跑全量测试、Windows 安装包构建、升版或发布。工作区其它既有未提交及未跟踪内容均保留；本批修改未提交、未推送。
