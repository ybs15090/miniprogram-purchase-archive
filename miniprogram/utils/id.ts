// utils/id.ts
// ID 生成策略为占位实现；正式实现细节（冲突概率、长度、可读性）需在正式开发前确认。
// 首期仅要求：生成后稳定、在单机范围内足够唯一。

export function generateId(prefix = ''): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}${Date.now().toString(36)}${random}`
}
