// app.ts
import { init as initImageCache } from './services/image-cache-service'
import { runStartupCheck } from './services/startup-check-service'

App<IAppOption>({
  globalData: {},
  onLaunch() {
    // 首期不引入微信登录与用户识别；业务数据初始化由 Service 层负责。
    // 启动时预热图片缓存索引（扫描本地已缓存文件），不阻塞首屏。
    initImageCache().catch(() => undefined)
    runStartupCheck()
      .then((result) => {
        if (result.orphanCategoryRefsFixed > 0) {
          console.info('[startup-check] 清理孤儿分类引用', result.orphanCategoryRefsFixed)
        }
        if (result.corrupted) {
          console.warn('[startup-check] A/B 双库均不可读，保持停止写入')
        }
      })
      .catch(() => undefined)
  },
  onError(error: string) {
    console.error('[app] unhandled:', error)
  },
})
