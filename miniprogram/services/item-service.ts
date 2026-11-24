// services/item-service.ts
// 物品业务服务：查询/筛选/排序（纯函数）+ 表单校验 + 仓储封装。
// 页面只经本层访问物品数据，不直接接触 Repository 以下层级。

import type { Item } from '../models/item'
import type { Category } from '../models/category'
import { itemRepository } from '../repositories/item-repository'
import { isHttpUrl, isNonNegativeInteger, isPositiveInteger } from '../utils/validation'

export type SortKey = 'purchaseDate' | 'createdAt' | 'amountDesc' | 'amountAsc' | 'title'

export interface ItemQuery {
  /** 标题关键词，大小写不敏感的部分匹配 */
  keyword?: string
  /** 分类筛选（配合 categoryMatch） */
  categoryIds?: string[]
  categoryMatch?: 'OR' | 'AND'
  /** 购买日期范围（毫秒时间戳，含边界） */
  dateFrom?: number
  dateTo?: number
  sortBy?: SortKey
}

export interface ItemDraft {
  id?: string
  title: string
  coverImageUrl: string
  detailImageUrls: string[]
  description: string
  categoryIds: string[]
  paidAmount: number
  quantity: number
  purchaseDate: number
  purchasePlatform?: string
  productUrl?: string
  orderNumber?: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/** 标题关键词匹配：实时、大小写不敏感、部分匹配 */
export function matchesKeyword(item: Item, keyword: string): boolean {
  if (!keyword) return true
  return item.title.toLowerCase().includes(keyword.toLowerCase())
}

/** 分类筛选：OR=任意命中；AND=包含全部选中分类 */
export function matchesCategories(item: Item, categoryIds: string[], mode: 'OR' | 'AND'): boolean {
  if (categoryIds.length === 0) return true
  if (mode === 'AND') {
    return categoryIds.every((cid) => item.categoryIds.includes(cid))
  }
  return categoryIds.some((cid) => item.categoryIds.includes(cid))
}

/** 购买日期范围筛选（含边界） */
export function matchesDateRange(item: Item, from?: number, to?: number): boolean {
  if (from !== undefined && item.purchaseDate < from) return false
  if (to !== undefined && item.purchaseDate > to) return false
  return true
}

/** 排序：最近购买/最近添加/金额降/金额升/标题 */
export function sortItems(items: Item[], sortBy: SortKey): Item[] {
  const list = [...items]
  switch (sortBy) {
    case 'purchaseDate':
      return list.sort((a, b) => b.purchaseDate - a.purchaseDate)
    case 'createdAt':
      return list.sort((a, b) => b.createdAt - a.createdAt)
    case 'amountDesc':
      return list.sort((a, b) => b.paidAmount - a.paidAmount)
    case 'amountAsc':
      return list.sort((a, b) => a.paidAmount - b.paidAmount)
    case 'title':
      return list.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
  }
}

/** 查询管道：过滤（仅有效物品）→ 搜索 → 分类 → 日期 → 排序 */
export function queryItems(items: Item[], query: ItemQuery): Item[] {
  const active = items.filter((it) => it.deletedAt === null)
  const keyword = query.keyword?.trim() ?? ''
  const filtered = active.filter((it) => {
    if (!matchesKeyword(it, keyword)) return false
    if (!matchesCategories(it, query.categoryIds ?? [], query.categoryMatch ?? 'OR')) return false
    if (!matchesDateRange(it, query.dateFrom, query.dateTo)) return false
    return true
  })
  return sortItems(filtered, query.sortBy ?? 'purchaseDate')
}

/** 表单业务校验：必填、金额整数分、数量正整数、分类引用真实存在 */
export function validateItemDraft(draft: ItemDraft, existingCategories: Category[]): ValidationResult {
  const errors: string[] = []
  if (!draft.title.trim()) errors.push('标题不能为空')
  if (!isHttpUrl(draft.coverImageUrl.trim())) errors.push('封面图片 URL 格式不正确')
  if (!isNonNegativeInteger(draft.paidAmount)) errors.push('实际支付总金额必须是有效的整数分')
  if (!isPositiveInteger(draft.quantity)) errors.push('购买数量必须是大于 0 的整数')
  if (!Number.isFinite(draft.purchaseDate)) errors.push('购买时间无效')
  const knownIds = new Set(existingCategories.map((c) => c.id))
  const unknown = draft.categoryIds.filter((cid) => !knownIds.has(cid))
  if (unknown.length > 0) errors.push('存在无效的分类引用')
  if (draft.detailImageUrls.some((u) => !isHttpUrl(u.trim()))) errors.push('详情图片存在无效 URL')
  if (draft.productUrl !== undefined && draft.productUrl !== '' && !isHttpUrl(draft.productUrl.trim())) {
    errors.push('商品链接格式不正确')
  }
  return { valid: errors.length === 0, errors }
}

export class ItemServiceImpl {
  async listAll(): Promise<Item[]> {
    return itemRepository.list(false)
  }

  /** 全部物品（含回收站记录），供回收站页使用 */
  async listAllIncludeDeleted(): Promise<Item[]> {
    return itemRepository.list(true)
  }

  async query(query: ItemQuery): Promise<Item[]> {
    const all = await itemRepository.list(false)
    return queryItems(all, query)
  }

  getById(id: string): Promise<Item | undefined> {
    return itemRepository.getById(id)
  }

  /** 保存草稿：先完整业务校验，再经仓储落地 */
  async saveDraft(draft: ItemDraft, existingCategories: Category[]): Promise<Item> {
    const result = validateItemDraft(draft, existingCategories)
    if (!result.valid) {
      throw new Error(result.errors.join('；'))
    }
    const item: Item = {
      id: draft.id ?? '',
      title: draft.title.trim(),
      coverImageUrl: draft.coverImageUrl.trim(),
      detailImageUrls: draft.detailImageUrls.map((u) => u.trim()).filter((u) => u.length > 0),
      description: draft.description.trim(),
      categoryIds: [...draft.categoryIds],
      paidAmount: draft.paidAmount,
      quantity: draft.quantity,
      purchaseDate: draft.purchaseDate,
      purchasePlatform: draft.purchasePlatform?.trim() || undefined,
      productUrl: draft.productUrl?.trim() || undefined,
      orderNumber: draft.orderNumber?.trim() || undefined,
      createdAt: 0,
      updatedAt: 0,
      deletedAt: null,
    }
    return itemRepository.save(item)
  }

  softDelete(id: string): Promise<void> {
    return itemRepository.softDelete(id)
  }

  restore(id: string): Promise<void> {
    return itemRepository.restore(id)
  }

  permanentDelete(id: string): Promise<void> {
    return itemRepository.permanentDelete(id)
  }

  duplicate(id: string): Promise<Item | undefined> {
    return itemRepository.duplicate(id)
  }
}

export const itemService = new ItemServiceImpl()
