// utils/date.ts
// 日期工具：内部统一使用 Unix 毫秒时间戳。

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 格式化日期，YYYY-MM-DD */
export function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 格式化日期时间，YYYY-MM-DD HH:mm:ss */
export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${formatDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 当前时间戳（毫秒） */
export function now(): number {
  return Date.now()
}

/** 格式化持有时长，xx年xx天；fromTs 为购买时间，toTs 默认当前时间 */
export function formatHoldingDuration(fromTs: number, toTs: number = Date.now()): string {
  const start = new Date(fromTs)
  const end = new Date(toTs)

  // 购买时间无效或晚于当前时间时做下限保护，避免出现负值
  if (Number.isNaN(start.getTime()) || end.getTime() <= start.getTime()) {
    return '0年0天'
  }

  let years = end.getFullYear() - start.getFullYear()

  // end 年份中与 start 同月同日的周年日期
  let anniversary = new Date(end.getFullYear(), start.getMonth(), start.getDate())
  if (anniversary.getTime() > end.getTime()) {
    years -= 1
    anniversary = new Date(end.getFullYear() - 1, start.getMonth(), start.getDate())
  }

  const days = Math.floor((end.getTime() - anniversary.getTime()) / 86400000)

  return `${Math.max(0, years)}年${Math.max(0, days)}天`
}
