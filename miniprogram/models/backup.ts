// models/backup.ts
// 备份与远程索引类型：与《最新交接报告》第 7.1、8.3 节保持一致。
import type { Item } from './item'
import type { Category } from './category'

/** 运行时数据库文件（双版本 A/B） */
export interface RuntimeDatabase {
  format: 'purchase-archive-database'
  schemaVersion: number
  revision: number
  updatedAt: number
  items: Item[]
  categories: Category[]
}

/** 用户导出/备份文件 */
export interface BackupFile {
  format: 'purchase-archive-backup'
  schemaVersion: number
  appVersion: string
  exportedAt: number
  sourceRevision: number
  summary: {
    activeItems: number
    deletedItems: number
    categories: number
  }
  data: {
    items: Item[]
    categories: Category[]
  }
}

/** manifest 中单条备份记录 */
export interface ManifestBackupEntry {
  fileName: string
  exportedAt: number
  schemaVersion: number
  sourceRevision: number
  size: number
  activeItems: number
  deletedItems: number
  categories: number
  sha256: string
}

/** 坚果云远程 manifest（A/B 双版本） */
export interface RemoteManifest {
  format: 'purchase-archive-manifest'
  schemaVersion: number
  revision: number
  updatedAt: number
  backups: ManifestBackupEntry[]
  pendingDeletes: string[]
}
