// models/category.ts
// 分类模型：字段与《最新交接报告》第 5.2 节保持一致。
export interface Category {
  /** 分类唯一 ID，创建后稳定 */
  id: string
  /** 分类名称，可修改 */
  name: string
  /** 排序值 */
  sortOrder: number
  /** 创建时间，Unix 毫秒时间戳 */
  createdAt: number
  /** 最后更新时间，Unix 毫秒时间戳 */
  updatedAt: number
}
