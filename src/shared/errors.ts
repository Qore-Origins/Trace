// 错误码与业务异常（唯一事实源：接口设计文档 §7 / LLD §7）
export const ERR = {
  OK: 0,
  PATH_NOT_FOUND: 10,
  PATH_UNSAFE: 11,
  NAME_CONFLICT: 12,
  CIRCULAR_NESTING: 13,
  FORMAT_INVALID: 14,
  SAVE_FAILED: 15,
  VALIDATION: 20,
  STATE_MACHINE: 21,
  CONFLICT: 22,
  INDEX_NOT_READY: 23,
  CONFIRMATION_REQUIRED: 24,
  INTERNAL: 50
} as const

export type ErrCode = (typeof ERR)[keyof typeof ERR]

export class TraceError extends Error {
  constructor(
    readonly code: ErrCode,
    message: string
  ) {
    super(message)
    this.name = 'TraceError'
  }
}

// IPC 入口统一包装用：未知异常 → INTERNAL
export function toTraceResultError(e: unknown): { code: ErrCode; message: string } {
  if (e instanceof TraceError) return { code: e.code, message: e.message }
  return { code: ERR.INTERNAL, message: '主进程内部错误（已记录日志）' }
}
