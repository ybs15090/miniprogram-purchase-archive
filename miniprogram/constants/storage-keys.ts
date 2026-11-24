// constants/storage-keys.ts
// 轻量偏好配置的 Storage 键，及文件系统目录/文件名约定。

/** Storage API 偏好键（轻量、非核心业务数据） */
export const STORAGE_KEYS = {
  /** 首页布局模式：single | double */
  homeLayout: 'pref_home_layout',
  /** 默认排序方式 */
  defaultSort: 'pref_default_sort',
  /** 是否记住 WebDAV 应用密码 */
  webdavRemember: 'pref_webdav_remember',
  /**
   * WebDAV 认证信息（敏感）。
   * 仅当用户主动开启“记住应用密码”后才写入；不进入 JSON 导出/备份/日志。
   */
  webdavAuth: 'pref_webdav_auth',
} as const

/** 用户文件目录（USER_DATA_PATH）下的目录名 */
export const DATA_DIR = 'data'
/** 图片缓存目录名，与业务数据分离 */
export const IMAGE_CACHE_DIR = 'image-cache'

/** 双版本数据库文件名 */
export const DATABASE_A = 'database-a.json'
export const DATABASE_B = 'database-b.json'
/** 导入/云端恢复前的本地安全备份文件名 */
export const PRE_RESTORE = 'pre-restore.json'
