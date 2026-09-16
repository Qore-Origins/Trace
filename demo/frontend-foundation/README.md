# Trace 正式动作组件集成验收宿主

运行（在项目根目录）：`npx vite --config demo/frontend-foundation/vite.config.ts --strictPort`

入口：`http://127.0.0.1:52822/integration.html`。原型 `000e48f` 已经用户确认，独立按钮和撤销实现已移除，决策在正式 `components/ui/`、`stores/undo-store.ts` 中重新实现。此目录现在复用真实 ContentArea/PlanTreePanel/UndoNotice 与 antd 主题宿主，只提供内存 IPC 桥和禁持久化的偏好存储，不读写真实计划库。

浏览器回归：独立无头 Chrome 的 CDP 端口 52821 就绪后，运行 `node demo/frontend-foundation/integration-check.mjs`。检查真实组件删除、原位撤销、后续编辑保留、Enter/Space、Escape 焦点、暗色弹层、切计划/切库旧确认失效、超时焦点、四档宽度与减弱动效。截图写入忽略的 `out/demo/frontend-foundation/`。

Task 4 基础验收入口：`http://127.0.0.1:52822/integration.html?foundation=1`。此模式额外挂载正式 TopBar、SearchOverlay、StatusBar；默认无参数入口保留动作回归流程。

运行 `node demo/frontend-foundation/foundation-check.mjs`，检查双主题真实信息对比度、输入与日期/菜单/树标题 computed focus、菜单及搜索 Enter/Space、状态栏 polite、正常树高度过渡、减动效回忆/格式/目录/窗口、任务删除撤销、树重复删除仅一次且焦点落到剩余根行、隐藏树快捷操作键盘可见且不打开父节点。动效探针使用真实 CSS 类，回忆完整数据页不在本宿主内。

两个脚本使用 Vite 52822 与 Chrome CDP 52821，均恢复 `prefers-reduced-motion: no-preference` 后退出，可依次重复运行。Chrome 使用独立测试 profile；验收是浏览器加内存 IPC，不等同 Electron 真机验收。

补充验收：搜索结果 Escape 关闭浮层；连续心情数字使用主题适配色，原冷暖色阶保留为装饰；双主题 antd 实心/危险按钮、危险文字与错误文字检查实际对比度。`test/score-accessibility.spec.ts` 扫描 0–100 每 0.01 分、两主题四种底色、徽标与代码高亮。

菜单 hover 等待父弹层动画结束、子菜单非零尺寸且坐标实际命中后再发鼠标事件，避免首次 DOM 挂载时的零尺寸坐标。失败时输出菜单位置并保存 `integration-hover-failure.png`，便于复现。
