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
