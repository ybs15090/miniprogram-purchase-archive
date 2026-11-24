// utils/money.ts
// 金额以整数分存储，显示时转换为元。

/** 分转元（字符串，保留两位小数） */
export function fenToYuan(fen: number): string {
  return (fen / 100).toFixed(2)
}

/** 元转分（四舍五入为整数分） */
export function yuanToFen(yuan: number): number {
  return Math.round(yuan * 100)
}

/** 分转带单位字符串，例如 18000 -> "180.00 元" */
export function formatAmountFen(fen: number): string {
  return `${fenToYuan(fen)} 元`
}
