// components/item-card/index.ts
// 物品卡片：双列突出封面/标题/支付总额；单列补充分类与购买日期。
// 图片加载失败显示占位，不中断列表。封面优先读本地缓存。
import type { Item } from '../../models/item'
import { fenToYuan } from '../../utils/money'
import { formatDate } from '../../utils/date'
import { getCachedPath, downloadAndRefresh, discardCached } from '../../services/image-cache-service'

const coverObservers = new WeakMap<object, WechatMiniprogram.IntersectionObserver>()

Component({
  properties: {
    item: {
      type: Object,
      value: null,
    },
    layout: {
      type: String,
      value: 'double',
    },
    /** 单列模式下展示的分类名列表 */
    categoryNames: {
      type: Array,
      value: [] as string[],
    },
  },
  data: {
    coverFailed: false,
    coverSrc: '',
    amountText: '',
    dateText: '',
    coverVisible: false,
    coverRequestedUrl: '',
  },
  lifetimes: {
    ready() {
      const observer = wx.createIntersectionObserver(this)
      coverObservers.set(this, observer)
      observer.relativeToViewport({ bottom: 160 }).observe('.item-card-root', (res) => {
        if (res.intersectionRatio <= 0) return
        this.setData({ coverVisible: true })
        this.requestCover()
      })
    },
    detached() {
      coverObservers.get(this)?.disconnect()
      coverObservers.delete(this)
    },
  },
  observers: {
    item(item: Item) {
      if (!item) return
      this.setData({
        coverFailed: !item.coverImageUrl,
        coverSrc: item.coverImageUrl ? getCachedPath(item.coverImageUrl) : '',
        amountText: `¥${fenToYuan(item.paidAmount)}`,
        dateText: formatDate(item.purchaseDate),
        coverRequestedUrl: '',
      })
      if (this.data.coverVisible) this.requestCover()
    },
  },
  methods: {
    requestCover() {
      const item = this.data.item as Item | null
      if (!item || !item.coverImageUrl || this.data.coverRequestedUrl === item.coverImageUrl) return
      this.setData({ coverRequestedUrl: item.coverImageUrl })
      downloadAndRefresh(item.coverImageUrl, (path) => {
        const current = this.data.item as Item | null
        if (current && current.coverImageUrl === item.coverImageUrl && this.data.coverSrc !== path) {
          this.setData({ coverSrc: path, coverFailed: false })
        }
      })
    },
    async onCoverError() {
      const item = this.data.item as Item | null
      if (!item) return
      if (this.data.coverSrc !== item.coverImageUrl) {
        await discardCached(item.coverImageUrl)
        const current = this.data.item as Item | null
        if (current?.coverImageUrl === item.coverImageUrl) {
          this.setData({ coverSrc: item.coverImageUrl, coverFailed: false, coverRequestedUrl: '' })
          this.requestCover()
        }
        return
      }
      this.setData({ coverFailed: true })
    },
    onCardTap() {
      const item = this.data.item as Item | null
      if (item) {
        this.triggerEvent('cardtap', { id: item.id })
      }
    },
  },
})
