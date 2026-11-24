// utils/validation.ts
// 基础校验工具。URL 是否要求 HTTPS、是否限制域名，待结合合法域名与图片方案定稿。

export function isNonNegativeInteger(n: number): boolean {
  return Number.isInteger(n) && n >= 0
}

export function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n > 0
}

/** 基本 URL 格式校验（http/https） */
export function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s)
}
