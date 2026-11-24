// pages/recycle-bin/recycle-bin.ts
// 回收站：恢复与永久删除（永久删除须明确说明不可恢复并二次确认）。
import type { Item } from '../../models/item'
import { itemService } from '../../services/item-service'
import { fenToYuan } from '../../utils/money'
import { formatDate } from '../../utils/date'
import { getCachedPath, downloadAndRefresh, discardCached } from '../../services/image-cache-service'

interface RecycleRow {
  item: Item
  amountText: string
  deletedDateText: string
  coverSrc: string
  coverFailed: boolean
}

Page({
  data: {
    rows: [] as RecycleRow[],
    loading: true,
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    this.setData({ loading: true })
    try {
      const all = await itemService.listAllIncludeDeleted()
      const rows: RecycleRow[] = all
        .filter((it) => it.deletedAt !== null)
        .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
        .map((item) => ({
          item,
          amountText: `¥${fenToYuan(item.paidAmount)}`,
          deletedDateText: item.deletedAt !== null ? formatDate(item.deletedAt) : '',
          coverSrc: getCachedPath(item.coverImageUrl),
          coverFailed: false,
        }))
      this.setData({ rows, loading: false })
      // 后台按需下载封面，完成后刷新对应行
      rows.forEach((row, i) => {
        downloadAndRefresh(row.item.coverImageUrl, (path) => {
          if (this.data.rows[i] && this.data.rows[i].item.id === row.item.id) {
            const next = [...this.data.rows]
            next[i] = { ...next[i], coverSrc: path, coverFailed: false }
            this.setData({ rows: next })
          }
        })
      })
    } catch {
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onRestoreTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    wx.showModal({
      title: '恢复物品',
      content: '该物品将重新出现在首页与统计中。',
      confirmText: '恢复',
      success: (res) => {
        if (!res.confirm) return
        itemService
          .restore(id)
          .then(() => {
            wx.showToast({ title: '已恢复', icon: 'success' })
            this.refresh()
          })
          .catch(() => wx.showToast({ title: '恢复失败', icon: 'none' }))
      },
    })
  },

  onPermanentDeleteTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const row = this.data.rows.find((r) => r.item.id === id)
    if (!row) return
    // 永久删除：明确说明不可恢复 + 二次确认
    wx.showModal({
      title: '永久删除',
      content: `“${row.item.title}”将被物理删除且不可恢复，确认继续？`,
      confirmText: '永久删除',
      confirmColor: '#D54941',
      success: (res) => {
        if (!res.confirm) return
        itemService
          .permanentDelete(id)
          .then(() => {
            wx.showToast({ title: '已永久删除', icon: 'success' })
            this.refresh()
          })
          .catch(() => wx.showToast({ title: '删除失败', icon: 'none' }))
      },
    })
  },

  onRowTap(e: WechatMiniprogram.TouchEvent) {
    void e
    wx.showToast({ title: '回收站物品不支持查看详情，请先恢复', icon: 'none' })
  },

  async onCoverError(e: WechatMiniprogram.CustomEvent) {
    const index = e.currentTarget.dataset.index as number
    const row = this.data.rows[index]
    if (!row) return
    const url = row.item.coverImageUrl
    if (row.coverSrc !== url) {
      await discardCached(url)
      const current = this.data.rows[index]
      if (current?.item.id === row.item.id) {
        const next = [...this.data.rows]
        next[index] = { ...current, coverSrc: url, coverFailed: false }
        this.setData({ rows: next })
        downloadAndRefresh(url, (path) => {
          const latest = this.data.rows[index]
          if (latest?.item.id === row.item.id) {
            const updated = [...this.data.rows]
            updated[index] = { ...latest, coverSrc: path, coverFailed: false }
            this.setData({ rows: updated })
          }
        })
      }
      return
    }
    const next = [...this.data.rows]
    next[index] = { ...row, coverFailed: true }
    this.setData({ rows: next })
  },
})
