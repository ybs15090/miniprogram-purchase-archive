// models/item.ts
// 物品模型：字段与《最新交接报告》第 5.1 节保持一致。
export interface Item {
  /** 系统生成的唯一 ID，创建后不变 */
  id: string
  /** 物品标题 */
  title: string
  /** 首页封面图片 URL（必填） */
  coverImageUrl: string
  /** 详情图片 URL 数组，顺序代表展示顺序 */
  detailImageUrls: string[]
  /** 物品描述，可为空字符串 */
  description: string
  /** 关联分类 ID 数组（多对多） */
  categoryIds: string[]
  /** 整笔实际支付总额，整数分 */
  paidAmount: number
  /** 购买数量，正整数，默认 1 */
  quantity: number
  /** 购买时间，Unix 毫秒时间戳 */
  purchaseDate: number
  /** 购买平台（可选） */
  purchasePlatform?: string
  /** 商品网页链接（可选） */
  productUrl?: string
  /** 原始订单编号（可选） */
  orderNumber?: string
  /** 创建时间，Unix 毫秒时间戳 */
  createdAt: number
  /** 最后更新时间，Unix 毫秒时间戳 */
  updatedAt: number
  /** null 为有效记录；时间戳代表进入回收站的时间 */
  deletedAt: number | null
}
