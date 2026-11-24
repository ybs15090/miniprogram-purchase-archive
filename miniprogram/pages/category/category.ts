// pages/category/category.ts
// 分类页：分类汇总、日期筛选、多分类 OR/AND 组合筛选。口径与首页一致（Item 去重）。
import type { Category } from '../../models/category'
import type { Item } from '../../models/item'
import { categoryService } from '../../services/category-service'
import { itemService, queryItems } from '../../services/item-service'
import { statisticsService } from '../../services/statistics-service'
import type { StatisticsSummary } from '../../services/statistics-service'
import { fenToYuan } from '../../utils/money'
import { DatabaseCorruptedError } from '../../storage/database-storage'

interface CategoryVm extends Category {
  count: number
  selected: boolean
}

interface RangeOption {
  key: 'all' | 'month' | 'quarter' | 'year'
  label: string
}

const RANGE_OPTIONS: RangeOption[] = [
  { key: 'all', label: '全部时间' },
  { key: 'month', label: '本月' },
  { key: 'quarter', label: '近三个月' },
  { key: 'year', label: '近一年' },
]

function rangeStartDate(key: RangeOption['key']): number | undefined {
  const d = new Date()
  switch (key) {
    case 'month':
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    case 'quarter':
      return d.getTime() - 90 * 24 * 60 * 60 * 1000
    case 'year':
      return d.getTime() - 365 * 24 * 60 * 60 * 1000
    case 'all':
    default:
      return undefined
  }
}

Page({
  data: {
    categories: [] as CategoryVm[],
    selectedIds: [] as string[],
    matchMode: 'OR' as 'OR' | 'AND',
    rangeOptions: RANGE_OPTIONS,
    rangeKey: 'all' as RangeOption['key'],
    summary: null as StatisticsSummary | null,
    validCountText: '0',
    totalAmountText: '0.00',
    averageText: '--',
    cards: [] as Array<{ item: Item; categoryNames: string[] }>,
    loading: true,
    dbError: false,
  },

  onShow() {
    const tabbar = this.getTabBar()
    if (tabbar) {
      tabbar.setSelected(1)
    }
    this.refresh()
  },

  async refresh() {
    this.setData({ loading: true, dbError: false })
    try {
      const [cats, items] = await Promise.all([
        categoryService.listWithCounts(),
        itemService.listAll(),
      ])
      const selectedSet = new Set(this.data.selectedIds)
      const categories: CategoryVm[] = cats.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        count: c.itemCount,
        selected: selectedSet.has(c.id),
      }))
      const summary = await statisticsService.summaryForQuery({
        categoryIds: this.data.selectedIds,
        categoryMatch: this.data.matchMode,
        dateFrom: rangeStartDate(this.data.rangeKey),
      })
      const nameMap = new Map(categories.map((c) => [c.id, c.name]))
      const filtered = queryItems(items, {
        categoryIds: this.data.selectedIds,
        categoryMatch: this.data.matchMode,
        dateFrom: rangeStartDate(this.data.rangeKey),
        sortBy: 'purchaseDate',
      })
      const cards = filtered.map((item) => ({
        item,
        categoryNames: item.categoryIds
          .map((cid) => nameMap.get(cid))
          .filter((n): n is string => n !== undefined),
      }))
      this.setData({
        categories,
        summary,
        cards,
        validCountText: String(summary.validItemCount),
        totalAmountText: fenToYuan(summary.totalPaidAmount),
        averageText: summary.averagePerUnit === null ? '--' : fenToYuan(summary.averagePerUnit),
        loading: false,
      })
    } catch (e) {
      if (e instanceof DatabaseCorruptedError) {
        this.setData({ dbError: true, loading: false })
      } else {
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败，请重试', icon: 'none' })
      }
    }
  },

  onCategoryToggle(e: WechatMiniprogram.CustomEvent) {
    const id = e.currentTarget.dataset.id as string
    const selected = [...this.data.selectedIds]
    const index = selected.indexOf(id)
    if (index >= 0) {
      selected.splice(index, 1)
    } else {
      selected.push(id)
    }
    this.setData({ selectedIds: selected })
    this.refresh()
  },

  onMatchModeToggle() {
    this.setData({ matchMode: this.data.matchMode === 'OR' ? 'AND' : 'OR' })
    this.refresh()
  },

  onRangeTap(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as RangeOption['key']
    if (key === this.data.rangeKey) return
    this.setData({ rangeKey: key })
    this.refresh()
  },

  onClearFilter() {
    this.setData({ selectedIds: [], rangeKey: 'all' })
    this.refresh()
  },
})
