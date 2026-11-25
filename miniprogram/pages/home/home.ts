// pages/home/home.ts
// 首页：搜索、排序、单/双列切换、物品卡片列表。数据统一经 Service 获取。
import { toastInfo } from '../../utils/toast'
import type { Item } from '../../models/item'
import { itemService, queryItems } from '../../services/item-service'
import type { SortKey } from '../../services/item-service'
import { categoryService } from '../../services/category-service'
import { getStorage, setStorage } from '../../storage/local-storage'
import { STORAGE_KEYS } from '../../constants/storage-keys'
import { DatabaseCorruptedError } from '../../storage/database-storage'

interface ItemCard {
  item: Item
  categoryNames: string[]
}

interface SortOption {
  key: SortKey
  label: string
}

const SORT_OPTIONS: SortOption[] = [
  { key: 'purchaseDate', label: '最近购买' },
  { key: 'createdAt', label: '最近添加' },
  { key: 'amountDesc', label: '金额从高到低' },
  { key: 'amountAsc', label: '金额从低到高' },
  { key: 'title', label: '标题名称' },
]

Page({
  data: {
    layout: 'double' as 'double' | 'single',
    keyword: '',
    sortKey: 'purchaseDate' as SortKey,
    sortOptions: SORT_OPTIONS,
    sortLabel: '最近购买',
    cards: [] as ItemCard[],
    totalCount: 0,
    loading: true,
    dbError: false,
  },
  /** 搜索防抖定时器 */
  searchTimer: 0,

  onLoad() {
    const savedLayout = getStorage<'double' | 'single'>(STORAGE_KEYS.homeLayout)
    const savedSort = getStorage<SortKey>(STORAGE_KEYS.defaultSort)
    const validSort = SORT_OPTIONS.find((o) => o.key === savedSort)
    this.setData({
      layout: savedLayout === 'single' ? 'single' : 'double',
      sortKey: validSort ? validSort.key : 'purchaseDate',
      sortLabel: validSort ? validSort.label : '最近购买',
    })
  },

  onShow() {
    const tabbar = this.getTabBar()
    if (tabbar) {
      tabbar.setSelected(0)
    }
    this.refresh()
  },

  async refresh() {
    this.setData({ loading: true, dbError: false })
    try {
      const [items, categories] = await Promise.all([
        itemService.listAll(),
        categoryService.list(),
      ])
      const nameMap = new Map(categories.map((c) => [c.id, c.name]))
      const filtered = queryItems(items, {
        keyword: this.data.keyword,
        sortBy: this.data.sortKey,
      })
      const cards: ItemCard[] = filtered.map((item) => ({
        item,
        categoryNames: item.categoryIds
          .map((cid) => nameMap.get(cid))
          .filter((n): n is string => n !== undefined),
      }))
      this.setData({ cards, totalCount: filtered.length, loading: false })
    } catch (e) {
      if (e instanceof DatabaseCorruptedError) {
        this.setData({ dbError: true, loading: false })
      } else {
        this.setData({ loading: false })
        toastInfo('加载失败，请重试')
      }
    }
  },

  onSearchChange(e: WechatMiniprogram.CustomEvent) {
    const value = (e.detail.value as string) ?? ''
    this.setData({ keyword: value })
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
    }
    this.searchTimer = setTimeout(() => {
      this.searchTimer = 0
      this.refresh()
    }, 300) as unknown as number
  },

  onSearchClear() {
    this.setData({ keyword: '' })
    this.refresh()
  },

  onToggleLayout() {
    const next = this.data.layout === 'double' ? 'single' : 'double'
    this.setData({ layout: next })
    setStorage(STORAGE_KEYS.homeLayout, next)
  },

  onSortTap(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as SortKey
    const option = SORT_OPTIONS.find((o) => o.key === key)
    if (!option || key === this.data.sortKey) return
    this.setData({ sortKey: key, sortLabel: option.label })
    setStorage(STORAGE_KEYS.defaultSort, key)
    this.refresh()
  },

  onCardTap(e: WechatMiniprogram.CustomEvent) {
    const id = e.detail.id as string
    if (id) {
      wx.navigateTo({ url: `/pages/item-detail/item-detail?id=${id}` })
    }
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },
})
