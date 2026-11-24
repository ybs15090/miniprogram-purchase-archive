// components/statistics-card/index.ts
// 统计卡片：label + 主数值 + 可选说明。
Component({
  properties: {
    label: {
      type: String,
      value: '',
    },
    value: {
      type: String,
      value: '',
    },
    hint: {
      type: String,
      value: '',
    },
    /** 数值较长（金额）时缩小字号 */
    size: {
      type: String,
      value: 'normal',
    },
  },
})
