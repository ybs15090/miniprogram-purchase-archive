// pages/mine/mine.ts
// 我的页：四项统计、数据管理、缓存管理与 WebDAV 配置入口。
import { toastInfo } from '../../utils/toast'
import { statisticsService } from '../../services/statistics-service'
import type { StatisticsSummary } from '../../services/statistics-service'
import { fenToYuan } from '../../utils/money'
import { DatabaseCorruptedError } from '../../storage/database-storage'

interface Entry {
  key: string
  title: string
  note: string
  stage: string
}

const ENTRIES: Entry[] = [
  { key: 'category-manage', title: '分类管理', note: '新增、改名、排序与删除', stage: '' },
  { key: 'recycle-bin', title: '回收站', note: '恢复或永久删除物品', stage: '' },
  { key: 'image-cache', title: '图片缓存管理', note: '查看占用、清空缓存', stage: '' },
  { key: 'backup', title: '数据备份', note: '本地 JSON 导入、导出与恢复', stage: '' },
  { key: 'webdav-config', title: 'WebDAV 配置', note: '坚果云目录与凭据管理（不传输）', stage: '' },
]

/** 可直接跳转的管理入口 */
const ENTRY_ROUTES: Record<string, string> = {
  'category-manage': '/pages/category-manage/category-manage',
  'recycle-bin': '/pages/recycle-bin/recycle-bin',
  'image-cache': '/pages/image-cache/image-cache',
  backup: '/pages/backup/backup',
  'webdav-config': '/pages/webdav-config/webdav-config',
}

Page({
  data: {
    summary: null as StatisticsSummary | null,
    validCountText: '0',
    totalAmountText: '0.00',
    averageText: '--',
    categoryCountText: '0',
    entries: ENTRIES,
    dbError: false,
  },

  onShow() {
    const tabbar = this.getTabBar()
    if (tabbar) {
      tabbar.setSelected(3)
    }
    this.refresh()
  },

  async refresh() {
    this.setData({ dbError: false })
    try {
      const summary = await statisticsService.summary()
      this.setData({
        summary,
        validCountText: String(summary.validItemCount),
        totalAmountText: fenToYuan(summary.totalPaidAmount),
        averageText: summary.averagePerUnit === null ? '--' : fenToYuan(summary.averagePerUnit),
        categoryCountText: String(summary.categoryCounts.length),
      })
    } catch (e) {
      if (e instanceof DatabaseCorruptedError) {
        this.setData({ dbError: true })
      } else {
        toastInfo('加载失败，请重试')
      }
    }
  },

  onEntryTap(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string
    const route = ENTRY_ROUTES[key]
    if (route) {
      wx.navigateTo({ url: route })
      return
    }
    const entry = ENTRIES.find((it) => it.key === key)
    if (entry) {
      toastInfo(`${entry.title}将在${entry.stage}开放`)
    }
  },
})
