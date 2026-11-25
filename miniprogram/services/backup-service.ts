// services/backup-service.ts
// 备份服务：本地备份、导出 JSON、严格校验与整库恢复。
// POC-05（wx.shareFileMessage / wx.chooseMessageFile 的分享与选择）尚未真机验证；
// 阶段 6 页面已接入入口，但在真机验收前不得承诺文件交互完全可用。

import type { BackupFile } from '../models/backup'
import type { Item } from '../models/item'
import type { Category } from '../models/category'
import { readDatabase, saveDatabase, snapshotToPreRestore, CURRENT_SCHEMA_VERSION, isItemShape, isCategoryShape } from '../storage/database-storage'
import { getUserDataPath, joinPath, readTextFile, writeTextFile, mkdir, exists } from '../storage/local-storage'
import { DATA_DIR, PRE_RESTORE } from '../constants/storage-keys'
import { now } from '../utils/date'
import { isHttpUrl, isNonNegativeInteger, isPositiveInteger } from '../utils/validation'

export interface BackupSummary {
  activeItems: number
  deletedItems: number
  categories: number
}

export interface BackupValidationResult {
  valid: boolean
  errors: string[]
  /** 仅从实际数据计算，供恢复确认展示；不信任文件内声明的 summary */
  summary?: BackupSummary
}

const BACKUP_FORMAT = 'purchase-archive-backup'
const APP_VERSION = '1.0.0'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 从当前本地库构建导出文件（含回收站记录） */
export async function buildBackupFile(): Promise<BackupFile> {
  const db = await readDatabase()
  return {
    format: BACKUP_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now(),
    sourceRevision: db.revision,
    summary: {
      activeItems: db.items.filter((it) => it.deletedAt === null).length,
      deletedItems: db.items.filter((it) => it.deletedAt !== null).length,
      categories: db.categories.length,
    },
    data: {
      items: db.items,
      categories: db.categories,
    },
  }
}

/** 导出 JSON 字符串（分享/写文件由调用方在 POC-05 验证后接入） */
export async function exportJson(): Promise<string> {
  const backup = await buildBackupFile()
  return JSON.stringify(backup, null, 2)
}

/** 严格校验备份内容：结构、版本、字段、ID 唯一性、分类引用、金额/数量约束 */
export function validateBackupContent(text: string): BackupValidationResult {
  const errors: string[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { valid: false, errors: [`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`] }
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT) {
    return { valid: false, errors: ['文件格式不正确（缺少 backup 标识）'] }
  }
  if (parsed.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    errors.push(`不支持的 schema 版本：${String(parsed.schemaVersion)}`)
  }
  const data = isRecord(parsed.data) ? parsed.data : undefined
  const items: unknown[] = Array.isArray(data?.items) ? (data?.items as unknown[]) : []
  const categories: unknown[] = Array.isArray(data?.categories) ? (data?.categories as unknown[]) : []
  if (!data || !Array.isArray(data.items) || !Array.isArray(data.categories)) {
    errors.push('缺少 items / categories 数据')
    return { valid: false, errors }
  }

  const categoryIds = new Set<string>()
  for (const c of categories) {
    if (!isCategoryShape(c)) {
      errors.push('存在结构不合法的分类记录')
      break
    }
    if (!c.id.trim() || !c.name.trim()) {
      errors.push('存在 ID 或名称为空的分类记录')
    }
    categoryIds.add(c.id)
  }
  const itemIds = new Set<string>()
  for (const it of items) {
    if (!isItemShape(it)) {
      errors.push('存在结构不合法的物品记录')
      break
    }
    const item = it as Item
    if (!item.id.trim()) errors.push('存在 ID 为空的物品记录')
    if (itemIds.has(item.id)) {
      errors.push(`物品 ID 重复：${item.id}`)
    }
    itemIds.add(item.id)
    if (!Number.isSafeInteger(item.paidAmount) || !isNonNegativeInteger(item.paidAmount)) {
      errors.push(`物品 ${item.id} 金额不是安全的非负整数分`)
    }
    if (!Number.isSafeInteger(item.quantity) || !isPositiveInteger(item.quantity)) {
      errors.push(`物品 ${item.id} 数量不是安全的正整数`)
    }
    if (!item.title.trim()) {
      errors.push(`物品 ${item.id} 标题为空`)
    }
    if (item.coverImageUrl.trim() !== '' && !isHttpUrl(item.coverImageUrl.trim())) {
      errors.push(`物品 ${item.id} 封面 URL 格式不正确`)
    }
    if (new Set(item.categoryIds).size !== item.categoryIds.length) {
      errors.push(`物品 ${item.id} 存在重复分类关联`)
    }
    const unknownCat = item.categoryIds.filter((cid) => !categoryIds.has(cid))
    if (unknownCat.length > 0) {
      errors.push(`物品 ${item.id} 引用了不存在的分类`)
    }
  }
  const catIdList = (categories as Category[]).map((c) => c.id)
  if (new Set(catIdList).size !== catIdList.length) {
    errors.push('分类 ID 重复')
  }
  if (errors.length > 0) return { valid: false, errors }
  const validItems = items as Item[]
  return {
    valid: true,
    errors,
    summary: {
      activeItems: validItems.filter((item) => item.deletedAt === null).length,
      deletedItems: validItems.filter((item) => item.deletedAt !== null).length,
      categories: categories.length,
    },
  }
}

/** 读取用户选择的备份文件，页面不直接操作文件系统 */
export function readBackupContent(path: string): Promise<string> {
  return readTextFile(path)
}

/** 校验文件路径上的备份内容 */
export async function validateBackup(path: string): Promise<BackupValidationResult> {
  try {
    const text = await readTextFile(path)
    return validateBackupContent(text)
  } catch (e) {
    return { valid: false, errors: [`读取文件失败：${e instanceof Error ? e.message : String(e)}`] }
  }
}

/** 在本地数据目录写一份备份快照文件，返回路径 */
export async function createLocalBackup(): Promise<string> {
  const text = await exportJson()
  const path = joinPath(getUserDataPath(), DATA_DIR, `local-backup-${Date.now()}.json`)
  await mkdir(joinPath(getUserDataPath(), DATA_DIR))
  await writeTextFile(path, text)
  return path
}

/** 生成用于分享的唯一备份文件；不得复用旧路径，避免微信会话引用的文件被覆盖 */
export async function createShareBackup(): Promise<string> {
  const text = await exportJson()
  const path = joinPath(getUserDataPath(), DATA_DIR, `local-backup-share-${Date.now()}.json`)
  await mkdir(joinPath(getUserDataPath(), DATA_DIR))
  await writeTextFile(path, text)
  return path
}


/**
 * 整库恢复（覆盖语义）：
 * 先严格校验 → pre-restore 保护点 → 写入新库。
 * 恢复失败时原库保留。阶段 6 已生成保护点；"撤销本次恢复"入口仍按实施计划保留占位。
 */
export async function restoreFromContent(text: string): Promise<BackupValidationResult> {
  const result = validateBackupContent(text)
  if (!result.valid) {
    return result
  }
  const backup = JSON.parse(text) as BackupFile
  await snapshotToPreRestore()
  await saveDatabase({
    format: 'purchase-archive-database',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0,
    updatedAt: now(),
    items: backup.data.items,
    categories: backup.data.categories,
  })
  return { valid: true, errors: [] }
}

/** 恢复保护点文件路径（用于后续"撤销本次恢复"能力） */
export function preRestorePath(): string {
  return joinPath(getUserDataPath(), DATA_DIR, PRE_RESTORE)
}

export function hasPreRestoreSnapshot(): Promise<boolean> {
  return exists(preRestorePath())
}
