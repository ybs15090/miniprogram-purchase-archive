// pages/image-cache/image-cache.ts
// 图片缓存管理：展示占用（文件数 + 总大小）、一键清空。
import { toastInfo, toastSuccess } from '../../utils/toast'
import { getStats, clearAll } from '../../services/image-cache-service'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

Page({
  data: {
    fileCountText: '0',
    sizeText: '0 B',
    clearing: false,
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    try {
      const stats = await getStats()
      this.setData({
        fileCountText: String(stats.fileCount),
        sizeText: formatBytes(stats.totalBytes),
      })
    } catch {
      toastInfo('统计失败')
    }
  },

  onClearTap() {
    if (this.data.clearing) return
    wx.showModal({
      title: '清空图片缓存',
      content: '将删除全部已缓存的图片文件，下次查看时会重新从网络下载。确认清空？',
      confirmText: '清空',
      confirmColor: '#D54941',
      success: (res) => {
        if (!res.confirm) return
        this.doClear()
      },
    })
  },

  async doClear() {
    this.setData({ clearing: true })
    try {
      await clearAll()
      toastSuccess('已清空')
      this.refresh()
    } catch {
      toastInfo('清空失败')
    } finally {
      this.setData({ clearing: false })
    }
  },
})
