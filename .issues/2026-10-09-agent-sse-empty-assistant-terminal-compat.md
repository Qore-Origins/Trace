# 小沅能力测试被空 assistant 终止延续帧拒绝

状态：已修复并通过应用内能力测试复测
发现日期：2026-10-09
关联计划：`docs/Plan/Future_Plan/Qore/Trace/Plan-261009-02-小沅请求错误诊断与复制/Agent-Request-Diagnostics-Plan.md`

## 现象

在 Trace 设置中执行小沅“测试工具能力”，服务返回 HTTP 200 和 SSE，但 UI 显示“服务返回格式不兼容”。

## 证据与原因

开发环境中仅针对固定合成能力探针启用脱敏结构诊断。一次真实应用请求的序列为：合法工具调用与 `finish_reason=tool_calls` 同帧、同结束原因的后续空 assistant 片段（delta 仅有 `role` 与空字符串 `content`）、`[DONE]`。旧累加器在第一帧立刻进入 finished 状态，并因第二帧的 delta 不是完全空对象而报 `sse.duplicate_terminal_mismatch`。

诊断不会记录 API Key、endpoint、请求正文、模型正文或原始字段值。此次诊断未记录 `role` 的实际值；是否匹配 assistant 由精确兼容规则和后续真实应用复测共同确认。

## 修复与验证

- 仅额外允许 delta 严格等于 `{ role: 'assistant', content: '' }` 的相同 finish reason 终止延续帧；保留完全空 delta 的既有兼容。
- 非空尾文、工具调用或额外 delta 字段、role 不符、结束原因不一致及结构不合法仍 fail-closed。
- 新真实形状 loopback 回归先 RED、修复后通过；非空尾文拒绝回归通过。
- `npm run test -- test/agent-provider-http.spec.ts`：47/47；`npm run typecheck`：通过；`git diff --check`：通过。

## 剩余事项

Electron main 终端出现两组完整能力测试通过日志；只读核验 profile 文件的非敏感能力状态为 `passed`、`errorCategory=null`，确认成功状态已写入。普通会话连续中断是否同因仍未验证，因此不宣称整体中断问题已解决。未跑全量测试、未构建安装包、未提交或发布。
