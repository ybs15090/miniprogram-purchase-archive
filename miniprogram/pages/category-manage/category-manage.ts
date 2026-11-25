// pages/category-manage/category-manage.ts
// 分类管理：新增、改名、排序（上移/下移）、删除（影响提示 + 级联清理）。
import { toastInfo, toastSuccess } from '../../utils/toast'
import { categoryService } from '../../services/category-service'

interface CategoryRow {
  id: string
  name: string
  count: number
}

Page({
  data: {
    rows: [] as CategoryRow[],
    loading: true,
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    this.setData({ loading: true })
    try {
      const list = await categoryService.listWithCounts()
      this.setData({
        rows: list.map((c) => ({ id: c.id, name: c.name, count: c.itemCount })),
        loading: false,
      })
    } catch {
      this.setData({ loading: false })
      toastInfo('加载失败')
    }
  },

  onAddTap() {
    wx.showModal({
      title: '新增分类',
      editable: true,
      placeholderText: '分类名称',
      confirmText: '新增',
      success: (res) => {
        if (!res.confirm) return
        const name = res.content ?? ''
        categoryService
          .create(name)
          .then(() => {
            toastSuccess('已新增')
            this.refresh()
          })
          .catch((err) => {
            toastInfo(err instanceof Error ? err.message : '新增失败')
          })
      },
    })
  },

  onRenameTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const row = this.data.rows.find((r) => r.id === id)
    if (!row) return
    wx.showModal({
      title: '重命名分类',
      editable: true,
      placeholderText: row.name,
      confirmText: '保存',
      success: (res) => {
        if (!res.confirm) return
        const name = res.content ?? ''
        categoryService
          .rename(id, name)
          .then(() => {
            toastSuccess('已保存')
            this.refresh()
          })
          .catch((err) => {
            toastInfo(err instanceof Error ? err.message : '重命名失败')
          })
      },
    })
  },

  async onMoveTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const dir = e.currentTarget.dataset.dir as 'up' | 'down'
    const ids = this.data.rows.map((r) => r.id)
    const index = ids.indexOf(id)
    const target = dir === 'up' ? index - 1 : index + 1
    if (index < 0 || target < 0 || target >= ids.length) return
    const tmp = ids[index]
    ids[index] = ids[target]
    ids[target] = tmp
    try {
      await categoryService.reorder(ids)
      this.refresh()
    } catch {
      toastInfo('排序失败')
    }
  },

  onDeleteTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const row = this.data.rows.find((r) => r.id === id)
    if (!row) return
    categoryService
      .getRemoveImpact(id)
      .then((impact) => {
        const scope =
          impact.totalItems > 0
            ? `将解除 ${impact.totalItems} 件物品（含回收站 ${impact.totalItems - impact.activeItems} 件）与该分类的关联`
            : '没有物品关联该分类'
        wx.showModal({
          title: `删除“${row.name}”`,
          content: `${scope}。删除后不可恢复，确认删除？`,
          confirmText: '删除',
          confirmColor: '#D54941',
          success: (res) => {
            if (!res.confirm) return
            categoryService
              .removeWithCascade(id)
              .then(() => {
                toastSuccess('已删除')
                this.refresh()
              })
              .catch(() => toastInfo('删除失败'))
          },
        })
      })
      .catch(() => toastInfo('无法评估影响'))
  },
})
