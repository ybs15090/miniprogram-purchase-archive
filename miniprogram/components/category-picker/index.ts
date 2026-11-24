// components/category-picker/index.ts
// 分类选择器：多对多，标签点选切换，选中态高亮。
// 注意：WXML 数据绑定不支持 .indexOf() 等方法调用，故在 JS 中预计算 selected 字段。
import type { Category } from '../../models/category'

interface TagVm {
  id: string
  name: string
  selected: boolean
}

Component({
  properties: {
    categories: {
      type: Array,
      value: [] as Category[],
    },
    /** 当前选中的分类 ID 数组 */
    value: {
      type: Array,
      value: [] as string[],
    },
  },
  data: {
    tags: [] as TagVm[],
  },
  observers: {
    'categories, value'(categories: Category[], value: string[]) {
      const selectedSet = new Set(value)
      const tags: TagVm[] = (categories ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        selected: selectedSet.has(c.id),
      }))
      this.setData({ tags })
    },
  },
  methods: {
    onTagTap(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string
      if (!id) return
      const selected = [...(this.data.value as string[])]
      const index = selected.indexOf(id)
      if (index >= 0) {
        selected.splice(index, 1)
      } else {
        selected.push(id)
      }
      this.triggerEvent('change', { value: selected })
    },
  },
})
