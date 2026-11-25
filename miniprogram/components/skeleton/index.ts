// components/skeleton/index.ts
// 列表加载占位：支持双列卡片与单列行两种形态。
Component({
  properties: {
    type: {
      type: String,
      value: 'cards',
    },
    count: {
      type: Number,
      value: 6,
    },
  },

  data: {
    items: [0, 1, 2, 3, 4, 5],
  },

  observers: {
    count(value: number) {
      const count = Math.max(1, Math.min(12, Math.floor(value) || 1))
      this.setData({ items: Array.from({ length: count }, (_, index) => index) })
    },
  },
})
