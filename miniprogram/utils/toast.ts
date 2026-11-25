// utils/toast.ts
// 统一 Toast/错误提示封装：页面不再裸调 wx.showToast，便于全局调整时长与图标策略。

/** 中性提示（无图标） */
export function toastInfo(title: string, duration = 1500): void {
  wx.showToast({ title, icon: 'none', duration })
}

/** 成功提示 */
export function toastSuccess(title: string, duration = 1500): void {
  wx.showToast({ title, icon: 'success', duration })
}

/** 失败提示（无图标，稍长停留） */
export function toastError(title: string, duration = 2000): void {
  wx.showToast({ title, icon: 'none', duration })
}

/** 从 unknown 异常中提取用户可读信息（兼容 wx 回调 errMsg） */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'errMsg' in error) {
    return String((error as { errMsg?: unknown }).errMsg ?? '操作失败')
  }
  return String(error)
}

/** 失败提示：自动提取异常信息 */
export function toastErrorOf(error: unknown, fallback = '操作失败'): void {
  const message = errorMessage(error)
  toastError(message && message !== '[object Object]' ? message : fallback)
}
