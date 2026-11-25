// pages/item-edit/item-edit.ts
// 编辑物品：复用 item-form；ID 与创建时间由仓储保持不变，仅更新 updatedAt。
import { toastInfo, toastSuccess } from '../../utils/toast'
import type { Category } from '../../models/category'
import type { Item } from '../../models/item'
import type { ItemDraft } from '../../services/item-service'
import { categoryService } from '../../services/category-service'
import { itemService } from '../../services/item-service'
import { ROUTES } from '../../constants/routes'

Page({
  data: {
    item: null as Item | null,
    categories: [] as Category[],
    notFound: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.itemId = options.id ?? ''
  },
  itemId: '',

  onShow() {
    this.loadData()
  },

  async loadData() {
    try {
      const [item, categories] = await Promise.all([
        itemService.getById(this.itemId),
        categoryService.list(),
      ])
      if (!item || item.deletedAt !== null) {
        this.setData({ notFound: true, item: null, categories })
        return
      }
      this.setData({ item, categories, notFound: false })
    } catch {
      toastInfo('加载失败')
    }
  },

  async onSubmit(e: WechatMiniprogram.CustomEvent) {
    const draft = e.detail.draft as ItemDraft
    try {
      await itemService.saveDraft(draft, this.data.categories)
      toastSuccess('已保存')
      setTimeout(() => {
        // 返回详情页（详情页 onShow 会刷新）
        const pages = getCurrentPages()
        if (pages.length >= 2) {
          wx.navigateBack()
        } else {
          wx.redirectTo({ url: `${ROUTES.itemDetail}?id=${draft.id ?? ''}` })
        }
      }, 400)
    } catch (err) {
      toastInfo(err instanceof Error ? err.message : '保存失败')
    }
  },
})
