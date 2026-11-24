// constants/routes.ts
// 页面路由常量：业务页 + PoC 页。业务页在正式开发阶段实现并登记。

export const ROUTES = {
  // 底部导航业务页
  home: '/pages/home/home',
  category: '/pages/category/category',
  create: '/pages/create/create',
  mine: '/pages/mine/mine',
  // 普通业务页
  itemDetail: '/pages/item-detail/item-detail',
  itemEdit: '/pages/item-edit/item-edit',
  categoryManage: '/pages/category-manage/category-manage',
  recycleBin: '/pages/recycle-bin/recycle-bin',
  imageCache: '/pages/image-cache/image-cache',
  backup: '/pages/backup/backup',
  webdavConfig: '/pages/webdav-config/webdav-config',
  // PoC 验证页（首期已实现）
  pocFilesystem: '/pages/poc/poc-filesystem/poc-filesystem',
  pocWebdav: '/pages/poc/poc-webdav/poc-webdav',
  pocImage: '/pages/poc/poc-image/poc-image',
} as const
