// components/empty-state/index.ts
// 空态组件：无数据 / 无搜索结果统一占位。
Component({
  properties: {
    text: {
      type: String,
      value: '暂无数据',
    },
    hint: {
      type: String,
      value: '',
    },
  },
})
