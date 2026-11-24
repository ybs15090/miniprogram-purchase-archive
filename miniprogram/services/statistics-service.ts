// services/statistics-service.ts
// 统计服务：全部为纯函数，保证首页/分类页/我的页口径一致。
// 口径：仅统计有效物品（deletedAt === null）；"全部"按 Item 去重，绝不累加各分类计数。

import type { Item } from '../models/item'
import type { Category } from '../models/category'
import { itemRepository } from '../repositories/item-repository'
import { categoryRepository } from '../repositories/category-repository'
import { queryItems } from './item-service'
import type { ItemQuery } from './item-service'

export interface CategoryCount {
  categoryId: string
  name: string
  /** 有效物品数（Item 去重，一件多分类物品在每个分类各计 1 次） */
  count: number
  /** 该分类下有效物品的累计支出（分） */
  totalPaidAmount: number
}

export interface StatisticsSummary {
  /** 有效物品记录数 */
  validItemCount: number
  /** 累计实际支出（分） */
  totalPaidAmount: number
  /** 平均单件购买支出（分）＝ 总额 ÷ 总数量；数量为 0 时 null */
  averagePerUnit: number | null
  /** 各分类关联的有效物品数与金额 */
  categoryCounts: CategoryCount[]
}

/** 核心统计：输入应为全部物品（含回收站），内部仅取有效物品并去重 */
export function computeSummary(items: Item[], categories: Category[]): StatisticsSummary {
  const active = items.filter((it) => it.deletedAt === null)
  // 按 Item id 去重，防止上游重复传入
  const seen = new Set<string>()
  const unique: Item[] = []
  for (const it of active) {
    if (!seen.has(it.id)) {
      seen.add(it.id)
      unique.push(it)
    }
  }

  const totalPaidAmount = unique.reduce((sum, it) => sum + it.paidAmount, 0)
  const totalQuantity = unique.reduce((sum, it) => sum + it.quantity, 0)

  const sortedCategories = [...categories].sort((a, b) => a.sortOrder - b.sortOrder)
  const categoryCounts: CategoryCount[] = sortedCategories.map((c) => {
    const members = unique.filter((it) => it.categoryIds.includes(c.id))
    return {
      categoryId: c.id,
      name: c.name,
      count: members.length,
      totalPaidAmount: members.reduce((sum, it) => sum + it.paidAmount, 0),
    }
  })

  return {
    validItemCount: unique.length,
    totalPaidAmount,
    averagePerUnit: totalQuantity > 0 ? Math.round(totalPaidAmount / totalQuantity) : null,
    categoryCounts,
  }
}

/** 带筛选条件的统计（分类页：按当前筛选口径统计） */
export function computeSummaryForQuery(items: Item[], categories: Category[], query: ItemQuery): StatisticsSummary {
  const filtered = queryItems(items, query)
  // 筛选后的统计中，分类计数仍按全部分类展示命中数量
  const sortedCategories = [...categories].sort((a, b) => a.sortOrder - b.sortOrder)
  const totalPaidAmount = filtered.reduce((sum, it) => sum + it.paidAmount, 0)
  const totalQuantity = filtered.reduce((sum, it) => sum + it.quantity, 0)
  return {
    validItemCount: filtered.length,
    totalPaidAmount,
    averagePerUnit: totalQuantity > 0 ? Math.round(totalPaidAmount / totalQuantity) : null,
    categoryCounts: sortedCategories.map((c) => {
      const members = filtered.filter((it) => it.categoryIds.includes(c.id))
      return {
        categoryId: c.id,
        name: c.name,
        count: members.length,
        totalPaidAmount: members.reduce((sum, it) => sum + it.paidAmount, 0),
      }
    }),
  }
}

export class StatisticsServiceImpl {
  /** 全量统计（我的页/首页"全部"口径） */
  async summary(): Promise<StatisticsSummary> {
    const [items, categories] = await Promise.all([itemRepository.list(false), categoryRepository.list()])
    return computeSummary(items, categories)
  }

  /** 筛选统计（分类页口径） */
  async summaryForQuery(query: ItemQuery): Promise<StatisticsSummary> {
    const [items, categories] = await Promise.all([itemRepository.list(false), categoryRepository.list()])
    return computeSummaryForQuery(items, categories, query)
  }
}

export const statisticsService = new StatisticsServiceImpl()
