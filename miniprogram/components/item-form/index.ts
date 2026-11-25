// components/item-form/index.ts
// 物品表单：新建与编辑共用。字段校验复用 services/item-service 的 validateItemDraft。
// URL 前缀模式：gcore（默认）/ raw（提示网络不可用）/ 自定义完整 URL。
import { toastInfo } from '../../utils/toast'
import type { Item } from '../../models/item'
import type { Category } from '../../models/category'
import type { ItemDraft } from '../../services/item-service'
import { validateItemDraft } from '../../services/item-service'
import { yuanToFen } from '../../utils/money'
import { generateId } from '../../utils/id'
import { formatDate } from '../../utils/date'
import { isHttpUrl } from '../../utils/validation'
import {
  IMAGE_PREFIX_OPTIONS,
  IMAGE_PREFIX_DEFAULT,
  IMAGE_PREFIX_CUSTOM,
} from '../../constants/image-prefixes'

type PrefixMode = 'gcore' | 'raw' | 'custom'

/** 详情图行：mode 决定 path（预设路径）或 full（完整 URL） */
interface DetailImageRow {
  uid: string
  mode: PrefixMode
  path: string
  full: string
  /** 解析后的完整 URL 预览（供 WXML 展示，避免 t-input 截断） */
  preview: string
}

/** 从既有 URL 反推输入模式（编辑回显用） */
function detectUrlMode(url: string): { mode: PrefixMode; path: string; full: string } {
  for (const opt of IMAGE_PREFIX_OPTIONS) {
    if (url.startsWith(opt.prefix)) {
      return { mode: opt.key as PrefixMode, path: url.slice(opt.prefix.length), full: '' }
    }
  }
  return { mode: IMAGE_PREFIX_CUSTOM as PrefixMode, path: '', full: url }
}

/** 按模式解析最终 URL；空串返回 ''（该行被忽略） */
function resolveUrl(mode: PrefixMode, path: string, full: string): string {
  if (mode === IMAGE_PREFIX_CUSTOM) {
    return full.trim()
  }
  const opt = IMAGE_PREFIX_OPTIONS.find((o) => o.key === mode)
  if (!opt) return ''
  const p = path.trim()
  return p ? `${opt.prefix}${p}` : ''
}

// 购买时间范围：1949-10-01 ~ 2049-10-01；初次默认 2026-07-15
const DEFAULT_PURCHASE_DATE = new Date(2026, 6, 15, 0, 0, 0, 0).getTime()
const DATE_RANGE_START = new Date(1949, 9, 1, 0, 0, 0, 0).getTime()
const DATE_RANGE_END = new Date(2049, 9, 1, 0, 0, 0, 0).getTime()

Component({
  properties: {
    categories: {
      type: Array,
      value: [] as Category[],
    },
    /** 编辑模式传入既有 Item；新建传 null */
    initial: {
      type: Object,
      value: null,
    },
    submitLabel: {
      type: String,
      value: '保存',
    },
  },
  data: {
    isEdit: false,
    prefixOptions: IMAGE_PREFIX_OPTIONS,
    title: '',
    description: '',
    // 封面
    coverMode: IMAGE_PREFIX_DEFAULT as PrefixMode,
    coverPath: '',
    coverFull: '',
    coverPreview: '',
    // 购买信息
    amountYuan: '',
    quantity: 1,
    purchaseDate: DEFAULT_PURCHASE_DATE,
    purchaseDateText: formatDate(DEFAULT_PURCHASE_DATE),
    dateStart: DATE_RANGE_START,
    dateEnd: DATE_RANGE_END,
    purchasePlatform: '',
    orderNumber: '',
    productUrl: '',
    // 分类
    categoryIds: [] as string[],
    // 详情图
    detailImages: [] as DetailImageRow[],
    // 日期选择器
    pickerVisible: false,
  },
  observers: {
    initial(item: Item | null) {
      if (!item) return
      const cover = detectUrlMode(item.coverImageUrl)
      this.setData({
        isEdit: true,
        title: item.title,
        description: item.description,
        coverMode: cover.mode,
        coverPath: cover.path,
        coverFull: cover.full,
        coverPreview: resolveUrl(cover.mode, cover.path, cover.full),
        amountYuan: (item.paidAmount / 100).toFixed(2),
        quantity: item.quantity,
        purchaseDate: item.purchaseDate,
        purchaseDateText: formatDate(item.purchaseDate),
        purchasePlatform: item.purchasePlatform ?? '',
        orderNumber: item.orderNumber ?? '',
        productUrl: item.productUrl ?? '',
        categoryIds: [...item.categoryIds],
        detailImages: item.detailImageUrls.map((url) => {
          const detected = detectUrlMode(url)
          return {
            uid: generateId('img_'),
            ...detected,
            preview: resolveUrl(detected.mode, detected.path, detected.full),
          }
        }),
      })
    },
    // 封面 URL 预览
    'coverMode, coverPath, coverFull'() {
      this.setData({
        coverPreview: resolveUrl(this.data.coverMode, this.data.coverPath, this.data.coverFull),
      })
    },
  },
  methods: {
    // ---- 基本字段 ----
    onTitleChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ title: (e.detail.value as string) ?? '' })
    },
    onDescriptionChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ description: (e.detail.value as string) ?? '' })
    },

    // ---- 封面 URL ----
    onCoverModeTap(e: WechatMiniprogram.TouchEvent) {
      const mode = e.currentTarget.dataset.mode as PrefixMode
      if (mode === this.data.coverMode) return
      this.setData({ coverMode: mode })
      if (mode === 'raw') {
        toastInfo('raw 当前网络环境实测不可用，仅作兼容选项', 2000)
      }
    },
    onCoverPathChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ coverPath: (e.detail.value as string) ?? '' })
    },
    onCoverFullChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ coverFull: (e.detail.value as string) ?? '' })
    },

    // ---- 购买信息 ----
    onAmountChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ amountYuan: (e.detail.value as string) ?? '' })
    },
    onQuantityChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ quantity: (e.detail.value as number) ?? 1 })
    },
    onDateTap() {
      this.setData({ pickerVisible: true })
    },
    onDateConfirm(e: WechatMiniprogram.CustomEvent) {
      // format="" 时组件返回时间戳（number）
      const value = e.detail.value as number
      this.setData({
        pickerVisible: false,
        purchaseDate: value,
        purchaseDateText: formatDate(value),
      })
    },
    onDateCancel() {
      this.setData({ pickerVisible: false })
    },
    onPlatformChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ purchasePlatform: (e.detail.value as string) ?? '' })
    },
    onOrderNumberChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ orderNumber: (e.detail.value as string) ?? '' })
    },
    onProductUrlChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ productUrl: (e.detail.value as string) ?? '' })
    },

    // ---- 分类 ----
    onCategoryChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ categoryIds: (e.detail.value as string[]) ?? [] })
    },

    // ---- 详情图 ----
    onAddDetailImage() {
      const rows = [...this.data.detailImages]
      rows.push({ uid: generateId('img_'), mode: IMAGE_PREFIX_DEFAULT as PrefixMode, path: '', full: '', preview: '' })
      this.setData({ detailImages: rows })
    },
    onRowModeTap(e: WechatMiniprogram.TouchEvent) {
      const uid = e.currentTarget.dataset.uid as string
      const mode = e.currentTarget.dataset.mode as PrefixMode
      const rows = this.data.detailImages.map((r) =>
        r.uid === uid ? { ...r, mode, preview: resolveUrl(mode, r.path, r.full) } : r,
      )
      this.setData({ detailImages: rows })
      if (mode === 'raw') {
        toastInfo('raw 当前网络环境实测不可用，仅作兼容选项', 2000)
      }
    },
    onRowPathChange(e: WechatMiniprogram.CustomEvent) {
      const uid = e.currentTarget.dataset.uid as string
      const value = (e.detail.value as string) ?? ''
      const rows = this.data.detailImages.map((r) =>
        r.uid === uid ? { ...r, path: value, preview: resolveUrl(r.mode, value, r.full) } : r,
      )
      this.setData({ detailImages: rows })
    },
    onRowFullChange(e: WechatMiniprogram.CustomEvent) {
      const uid = e.currentTarget.dataset.uid as string
      const value = (e.detail.value as string) ?? ''
      const rows = this.data.detailImages.map((r) =>
        r.uid === uid ? { ...r, full: value, preview: resolveUrl(r.mode, r.path, value) } : r,
      )
      this.setData({ detailImages: rows })
    },
    onRowMove(e: WechatMiniprogram.TouchEvent) {
      const uid = e.currentTarget.dataset.uid as string
      const dir = e.currentTarget.dataset.dir as 'up' | 'down'
      const rows = [...this.data.detailImages]
      const index = rows.findIndex((r) => r.uid === uid)
      if (index < 0) return
      const target = dir === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= rows.length) return
      const tmp = rows[index]
      rows[index] = rows[target]
      rows[target] = tmp
      this.setData({ detailImages: rows })
    },
    onRowRemove(e: WechatMiniprogram.TouchEvent) {
      const uid = e.currentTarget.dataset.uid as string
      this.setData({ detailImages: this.data.detailImages.filter((r) => r.uid !== uid) })
    },

    // ---- 提交 ----
    onSubmit() {
      const coverUrl = this.data.coverPreview
      if (coverUrl && !isHttpUrl(coverUrl)) {
        toastInfo('封面图片 URL 格式不正确')
        return
      }
      const detailUrls: string[] = []
      for (const row of this.data.detailImages) {
        const url = row.preview
        if (!url) continue
        if (!isHttpUrl(url)) {
          toastInfo(`详情图 ${detailUrls.length + 1} 的 URL 无效`)
          return
        }
        detailUrls.push(url)
      }

      const yuan = parseFloat(this.data.amountYuan)
      if (!Number.isFinite(yuan) || yuan < 0) {
        toastInfo('请输入有效的支付金额')
        return
      }

      const initial = this.data.initial as Item | null
      const draft: ItemDraft = {
        id: initial?.id,
        title: this.data.title,
        coverImageUrl: coverUrl,
        detailImageUrls: detailUrls,
        description: this.data.description,
        categoryIds: [...this.data.categoryIds],
        paidAmount: yuanToFen(yuan),
        quantity: this.data.quantity,
        purchaseDate: this.data.purchaseDate,
        purchasePlatform: this.data.purchasePlatform || undefined,
        productUrl: this.data.productUrl || undefined,
        orderNumber: this.data.orderNumber || undefined,
      }

      const result = validateItemDraft(draft, this.data.categories as Category[])
      if (!result.valid) {
        toastInfo(result.errors[0] ?? '表单校验未通过')
        return
      }
      this.triggerEvent('submit', { draft })
    },
  },
})
