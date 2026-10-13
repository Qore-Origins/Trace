# 设置使用说明实施记录

> 状态：代码已接入，定向验证、类型检查与构建通过；全量测试未通过。2026-10-13。本文是共享执行真源，同目录 `plan.json` 为 Trace 原生镜像。

## 目标与边界

为设置页中不易仅凭名称理解的选项增加可展开说明。每条说明写明功能、设置目的、适用对象、设置效果；默认收起，保留现有短描述与操作方式。覆盖常规项中的动画、Markdown、PlantUML，以及命名模板、工作流和小沅模型服务。中英文同步，说明不承诺未实现的行为。

## 任务

- [x] 核对设置入口、现有文案和对应行为，登记文件所有权。
- [x] 增加可复用说明组件、14 个主题的中英文文案及设置页入口。
- [x] 增加基础可访问性与窄布局样式，并做定向验证。
- [x] 运行全量测试、构建并记录结果；全量失败项保留为未解决问题。

## 已验证

- `npm run typecheck`：通过。
- `npx vitest run test/setting-help.spec.tsx test/settings-navigation.spec.tsx test/agent-settings.spec.tsx test/plan-workflow-ui.spec.tsx`：4 文件、23 测试通过。
- `npm run build`：通过。
- `npm run test`：98 文件中 96 通过、2 失败；1280 项中 1278 通过、2 失败。`agent-target-picker.spec.tsx` 一项等待 UI 状态超时，`search-service.spec.ts` 一项原子保存遇 Windows `EPERM`。两失败文件合并定向复跑：目标选择 4/4 通过，搜索 7/8；搜索文件单独再跑仍为 7/8，失败落在另一条 `多词 AND` 用例的同类 `EPERM`。不将全量测试记为通过，也不把 `EPERM` 归因于本轮说明文案。
- 尚未运行真实 Electron 设置页的键鼠、窄窗口和读屏检查。

## 下一步 / 等待 / 剩余

下一步在隔离应用中检查设置展开后的布局与键盘操作，并单独调查持续出现的 `search-service` Windows `EPERM`。无需等待用户输入。剩余为原生界面体验检查及上述全量测试失败项的根因；本任务不涉及 `D:\Desktop\Plan` 的计划数据写入，不提交、推送或发布。
