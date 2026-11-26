// pages/item-detail/item-detail.ts
// 物品详情：封面、字段、分类、详情图预览、编辑/复制/软删除/显式打开商品链接。
import { toastInfo, toastSuccess } from '../../utils/toast'
import type { Item } from '../../models/item'
import { itemService } from '../../services/item-service'
import { categoryService } from '../../services/category-service'
import { fenToYuan } from '../../utils/money'
import { formatDate, formatDateTime, formatHoldingDuration } from '../../utils/date'
import { ROUTES } from '../../constants/routes'
import { getCachedPath, downloadAndRefresh, discardCached } from '../../services/image-cache-service'

Page({
  data: {
    item: null as Item | null,
    categoryNames: [] as string[],
    amountText: '',
    averageText: '',
    dateText: '',
    holdingText: '',
    createdAtText: '',
    updatedAtText: '',
    coverFailed: false,
    notFound: false,
    coverSrc: '',
    detailImageSrcs: [] as string[],
    detailImageFailed: [] as boolean[],
  },
  itemId: '',
  detailObserver: null as WechatMiniprogram.IntersectionObserver | null,
  requestedDetailIndexes: new Set<number>(),

  onLoad(options: Record<string, string | undefined>) {
    this.itemId = options.id ?? ''
  },

  onShow() {
    this.loadData()
  },

  onUnload() {
    this.detailObserver?.disconnect()
    this.detailObserver = null
  },

  async loadData() {
    try {
      const [item, categories] = await Promise.all([
        itemService.getById(this.itemId),
        categoryService.list(),
      ])
      if (!item || item.deletedAt !== null) {
        this.setData({ notFound: true, item: null })
        return
      }
      const nameMap = new Map(categories.map((c) => [c.id, c.name]))
      const coverSrc = item.coverImageUrl ? getCachedPath(item.coverImageUrl) : ''
      const detailImageSrcs = item.detailImageUrls.map((u) => getCachedPath(u))
      this.detailObserver?.disconnect()
      this.detailObserver = null
      this.requestedDetailIndexes.clear()
      this.setData({
        item,
        notFound: false,
        coverFailed: !item.coverImageUrl,
        coverSrc,
        detailImageSrcs,
        detailImageFailed: item.detailImageUrls.map(() => false),
        categoryNames: item.categoryIds
          .map((cid) => nameMap.get(cid))
          .filter((n): n is string => n !== undefined),
        amountText: `¥${fenToYuan(item.paidAmount)}`,
        averageText: item.quantity > 0 ? `¥${fenToYuan(Math.round(item.paidAmount / item.quantity))}` : '--',
        dateText: formatDate(item.purchaseDate),
        holdingText: formatHoldingDuration(item.purchaseDate),
        createdAtText: formatDateTime(item.createdAt),
        updatedAtText: formatDateTime(item.updatedAt),
      })
      wx.setNavigationBarTitle({ title: item.title })
      // 封面优先；详情图进入可视区域或邻近区域后才请求下载
      if (item.coverImageUrl) {
        downloadAndRefresh(item.coverImageUrl, (path) => {
          if (this.data.item && this.data.item.coverImageUrl === item.coverImageUrl) {
            this.setData({ coverSrc: path, coverFailed: false })
          }
        })
      }
      wx.nextTick(() => this.observeDetailImages())
    } catch {
      toastInfo('加载失败')
    }
  },

  observeDetailImages() {
    if (!this.data.item || this.data.item.detailImageUrls.length === 0) return
    this.detailObserver = wx.createIntersectionObserver(this, { observeAll: true })
    this.detailObserver.relativeToViewport({ bottom: 240 }).observe('.detail-image', (res) => {
      if (res.intersectionRatio <= 0) return
      const index = Number(res.dataset.index)
      if (Number.isInteger(index)) this.requestDetailImage(index)
    })
  },

  requestDetailImage(index: number) {
    const item = this.data.item
    const url = item?.detailImageUrls[index]
    if (!item || !url || this.requestedDetailIndexes.has(index)) return
    this.requestedDetailIndexes.add(index)
    downloadAndRefresh(url, (path) => {
      const current = this.data.item
      if (current && current.detailImageUrls[index] === url) {
        const next = [...this.data.detailImageSrcs]
        const failed = [...this.data.detailImageFailed]
        next[index] = path
        failed[index] = false
        this.setData({ detailImageSrcs: next, detailImageFailed: failed })
      }
    })
  },

  async onCoverError() {
    const item = this.data.item
    if (!item) return
    if (this.data.coverSrc !== item.coverImageUrl) {
      await discardCached(item.coverImageUrl)
      if (this.data.item?.coverImageUrl === item.coverImageUrl) {
        this.setData({ coverSrc: item.coverImageUrl, coverFailed: false })
        downloadAndRefresh(item.coverImageUrl, (path) => {
          if (this.data.item?.coverImageUrl === item.coverImageUrl) {
            this.setData({ coverSrc: path, coverFailed: false })
          }
        })
      }
      return
    }
    this.setData({ coverFailed: true })
  },

  async onDetailImageError(e: WechatMiniprogram.TouchEvent) {
    const index = e.currentTarget.dataset.index as number
    const item = this.data.item
    const url = item?.detailImageUrls[index]
    if (!item || !url) return
    if (this.data.detailImageSrcs[index] !== url) {
      await discardCached(url)
      if (this.data.item?.detailImageUrls[index] === url) {
        const next = [...this.data.detailImageSrcs]
        next[index] = url
        this.requestedDetailIndexes.delete(index)
        this.setData({ detailImageSrcs: next })
        this.requestDetailImage(index)
      }
      return
    }
    const failed = [...this.data.detailImageFailed]
    failed[index] = true
    this.setData({ detailImageFailed: failed })
  },

  /** 封面图预览：点击查看大图 */
  onCoverTap() {
    const item = this.data.item
    if (!item?.coverImageUrl || this.data.coverFailed) return
    const src = this.data.coverSrc || item.coverImageUrl
    wx.previewImage({ current: src, urls: [src] })
  },

  /** 详情图预览：左右浏览全部详情图（使用缓存路径，未命中回退原 URL） */
  onDetailImageTap(e: WechatMiniprogram.TouchEvent) {
    const item = this.data.item
    if (!item || item.detailImageUrls.length === 0) return
    const index = (e.currentTarget.dataset.index as number) ?? 0
    const srcs = this.data.detailImageSrcs.length > 0 ? this.data.detailImageSrcs : item.detailImageUrls
    wx.previewImage({
      current: srcs[index] ?? item.detailImageUrls[index],
      urls: srcs,
    })
  },

  onEditTap() {
    if (!this.data.item) return
    wx.navigateTo({ url: `${ROUTES.itemEdit}?id=${this.data.item.id}` })
  },

  onCopyTap() {
    const item = this.data.item
    if (!item) return
    wx.showModal({
      title: '复制物品',
      content: '将创建一个副本（新 ID、新时间），原物品不受影响。',
      confirmText: '复制',
      success: (res) => {
        if (!res.confirm) return
        itemService
          .duplicate(item.id)
          .then((copy) => {
            if (copy) {
              toastSuccess('已创建副本')
              setTimeout(() => {
                wx.redirectTo({ url: `${ROUTES.itemDetail}?id=${copy.id}` })
              }, 400)
            }
          })
          .catch(() => toastInfo('复制失败'))
      },
    })
  },

  onDeleteTap() {
    const item = this.data.item
    if (!item) return
    wx.showModal({
      title: '移入回收站',
      content: '删除后可在回收站恢复，物品数据不会丢失。',
      confirmText: '删除',
      confirmColor: '#D54941',
      success: (res) => {
        if (!res.confirm) return
        itemService
          .softDelete(item.id)
          .then(() => {
            toastSuccess('已移入回收站')
            setTimeout(() => wx.navigateBack(), 400)
          })
          .catch(() => toastInfo('删除失败'))
      },
    })
  },

  /** 商品链接仅显式打开：复制到剪贴板由用户在浏览器访问 */
  onOpenLinkTap() {
    const item = this.data.item
    if (!item?.productUrl) return
    wx.setClipboardData({
      data: item.productUrl,
      success: () => {
        toastInfo('链接已复制，请在浏览器打开')
      },
    })
  },
})
