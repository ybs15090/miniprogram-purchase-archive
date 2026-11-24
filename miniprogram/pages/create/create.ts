// pages/create/create.ts
// 新建物品：共用 item-form，提交经 itemService.saveDraft 完整校验后入库。
import type { Category } from '../../models/category'
import type { ItemDraft } from '../../services/item-service'
import { categoryService } from '../../services/category-service'
import { itemService } from '../../services/item-service'
import { ROUTES } from '../../constants/routes'

Page({
  data: {
    categories: [] as Category[],
  },

  onShow() {
    const tabbar = this.getTabBar()
    if (tabbar) {
      tabbar.setSelected(2)
    }
    this.loadCategories()
  },

  async loadCategories() {
    try {
      const categories = await categoryService.list()
      this.setData({ categories })
    } catch {
      wx.showToast({ title: '分类加载失败', icon: 'none' })
    }
  },

  async onSubmit(e: WechatMiniprogram.CustomEvent) {
    const draft = e.detail.draft as ItemDraft
    try {
      const saved = await itemService.saveDraft(draft, this.data.categories)
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => {
        wx.redirectTo({ url: `${ROUTES.itemDetail}?id=${saved.id}` })
      }, 400)
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '保存失败', icon: 'none' })
    }
  },
})
