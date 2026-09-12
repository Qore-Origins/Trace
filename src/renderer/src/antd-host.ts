// antd 上下文化实例宿主：静态方法（message.* / Modal.confirm 等）渲染在 ConfigProvider 之外，
// 不消费主题算法/locale——暗色下弹窗仍是亮色（2026-09-12 用户截图实证）。
// 官方正解 = antd <App> 组件 + App.useApp() 实例；但 store（非组件）无法用 hook——
// 故 App 挂载时把实例绑定到此模块，全部调用点经 getModal/getMessage 取用（fallback=antd 静态，绑定前不炸）
import { App, Modal, message as staticMessage } from 'antd'
import type { HookAPI as ModalHookAPI } from 'antd/es/modal/useModal'
import type { MessageInstance } from 'antd/es/message/interface'

// fallback=antd 静态（绑定前兜底）；静态 Modal 是静态/Hook 联合类型，收窄到用到的确认/提示子集
type ModalLike = Pick<ModalHookAPI, 'confirm' | 'info' | 'success' | 'error' | 'warning'>
type MessageLike = MessageInstance

let boundModal: ModalLike | null = null
let boundMessage: MessageLike | null = null

/** App 挂载时绑定上下文化实例（AntdHostBinder 内调用一次） */
export function bindAntdHost(modal: ModalLike, msg: MessageLike): void {
  boundModal = modal
  boundMessage = msg
}

export function getModal(): ModalLike {
  return boundModal ?? (Modal as unknown as ModalLike)
}

export function getMessage(): MessageLike {
  return boundMessage ?? staticMessage
}

// 供 AntdHostBinder 使用（转发 re-export 避免调用点直接 import antd/App）
export { App as AntdApp }
