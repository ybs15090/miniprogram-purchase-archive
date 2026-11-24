// app.ts
import { init as initImageCache } from './services/image-cache-service'

App<IAppOption>({
  globalData: {},
  onLaunch() {
    // 首期不引入微信登录与用户识别；业务数据初始化由 Service 层负责。
    // 启动时预热图片缓存索引（扫描本地已缓存文件），不阻塞首屏。
    initImageCache().catch(() => undefined)
  },
})
