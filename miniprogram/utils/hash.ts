// utils/hash.ts
// 简易稳定哈希：URL → 文件名。采用 FNV-1a 32 位，个人数据量下冲突概率极低。
// 仅用于缓存文件名派生，非安全用途。

/** 将字符串哈希为 8 位十六进制字符串 */
export function hashStringToHex(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
