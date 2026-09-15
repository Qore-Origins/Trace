# Trace 正式动作组件集成验收宿主

运行（在项目根目录）：`npx vite --config demo/frontend-foundation/vite.config.ts --strictPort`

入口：`http://127.0.0.1:52822/integration.html`。原型 `000e48f` 已经用户确认，独立按钮和撤销实现已移除，决策在正式 `components/ui/`、`stores/undo-store.ts` 中重新实现。此目录现在复用真实 ContentArea/PlanTreePanel/UndoNotice 与 antd 主题宿主，只提供内存 IPC 桥和禁持久化的偏好存储，不读写真实计划库。

浏览器回归：独立无头 Chrome 的 CDP 端口 52821 就绪后，运行 `node demo/frontend-foundation/integration-check.mjs`。检查真实组件删除、原位撤销、后续编辑保留、Enter/Space、Escape 焦点、暗色弹层、切计划/切库旧确认失效、超时焦点、四档宽度与减弱动效。截图写入忽略的 `out/demo/frontend-foundation/`。
