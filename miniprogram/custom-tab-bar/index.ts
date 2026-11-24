// custom-tab-bar/index.ts
// 自定义底部导航：首页/分类/新建/我的。文字为主，选中项带简约图标与主色高亮。
Component({
  data: {
    selected: 0,
    list: [
      { path: '/pages/home/home', text: '首页', icon: '⌂' },
      { path: '/pages/category/category', text: '分类', icon: '▦' },
      { path: '/pages/create/create', text: '新建', icon: '＋' },
      { path: '/pages/mine/mine', text: '我的', icon: '☰' },
    ],
  },
  methods: {
    switchTab(e: WechatMiniprogram.TouchEvent) {
      const path = e.currentTarget.dataset.path as string
      if (!path) return
      wx.switchTab({ url: path })
    },
    setSelected(index: number) {
      this.setData({ selected: index })
    },
  },
})
