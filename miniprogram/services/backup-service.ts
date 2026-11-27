// services/backup-service.ts
// 备份服务：本地备份、导出 JSON、严格校验与整库恢复。
// POC-05（wx.shareFileMessage / wx.chooseMessageFile 的分享与选择）尚未真机验证；
// 阶段 6 页面已接入入口，但在真机验收前不得承诺文件交互完全可用。

import type { BackupFile, RuntimeDatabase } from '../models/backup'
import type { Item } from '../models/item'
import type { Category } from '../models/category'
import { readDatabase, saveDatabase, snapshotToPreRestore, CURRENT_SCHEMA_VERSION, isItemShape, isCategoryShape, isDatabaseShape } from '../storage/database-storage'
import { getUserDataPath, joinPath, readTextFile, writeTextFile, mkdir, exists, readdir, removeFile, stat } from '../storage/local-storage'
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
    if (item.detailImageUrls.some((url) => !isHttpUrl(url.trim()))) {
      errors.push(`物品 ${item.id} 详情图 URL 格式不正确`)
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

/** 本地备份快照池上限：local-backup-<ts>.json 与 local-backup-share-<ts>.json 合计保留数 */
const MAX_LOCAL_SNAPSHOTS = 3
/** 快照白名单：整串锚定，database-a/b.json、pre-restore.json 等永远不会匹配 */
const SNAPSHOT_PATTERN = /^local-backup-(?:share-)?(\d+)\.json$/
/** 旧版本遗留的无时间戳快照文件名：当前代码不再生成，直接清理 */
const LEGACY_SNAPSHOT_NAMES = ['local-backup.json', 'local-backup-share.json']
/** WebDAV 异常中断可能残留的临时文件（正常流程已在 finally 中删除） */
const TEMP_FILE_PATTERNS = [/^webdav-upload-verify-(\d+)\.json$/, /^webdav-download-(\d+)\.json$/]
/** 临时文件保护窗口：避免误删仍在进行中的上传/下载校验文件 */
const TEMP_FILE_MIN_AGE_MS = 10 * 60 * 1000

/**
 * 本地备份文件轮转（只在生成备份后调用）：
 * 1. 快照池合计保留最新 MAX_LOCAL_SNAPSHOTS 份；
 * 2. 删除旧版本遗留的无时间戳快照；
 * 3. 删除超过保护窗口的 WebDAV 临时文件；
 * 4. 只按白名单文件名匹配，删除失败静默忽略，不影响备份主流程。
 */
export async function pruneLocalBackups(protectedPath?: string): Promise<void> {
  const dir = joinPath(getUserDataPath(), DATA_DIR)
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    // 目录尚未创建或不可读：没有可清理内容
    return
  }

  // 刚生成的快照必须无条件保留
  const protectedName = protectedPath ? protectedPath.slice(protectedPath.lastIndexOf('/') + 1) : ''
  const snapshots: { name: string; ts: number }[] = []
  const legacySnapshots: string[] = []
  const expiredTemps: string[] = []
  const currentTs = now()

  for (const name of files) {
    const snapshot = SNAPSHOT_PATTERN.exec(name)
    if (snapshot) {
      snapshots.push({ name, ts: Number(snapshot[1]) })
      continue
    }
    if (LEGACY_SNAPSHOT_NAMES.includes(name)) {
      legacySnapshots.push(name)
      continue
    }
    for (const pattern of TEMP_FILE_PATTERNS) {
      const temp = pattern.exec(name)
      if (temp) {
        const ts = Number(temp[1])
        if (Number.isFinite(ts) && currentTs - ts > TEMP_FILE_MIN_AGE_MS) {
          expiredTemps.push(name)
        }
        break
      }
    }
  }

  // 按文件名中的时间戳倒序；同一毫秒时按名称倒序，保证结果稳定
  snapshots.sort((a, b) => b.ts - a.ts || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
  const stale = [
    ...snapshots.slice(MAX_LOCAL_SNAPSHOTS).map((item) => item.name),
    ...legacySnapshots,
    ...expiredTemps,
  ]
  for (const name of stale) {
    if (name === protectedName) continue
    await removeFile(joinPath(dir, name)).catch(() => undefined)
  }
}

/** 在本地数据目录写一份备份快照文件，返回路径 */
export async function createLocalBackup(): Promise<string> {
  const text = await exportJson()
  const path = joinPath(getUserDataPath(), DATA_DIR, `local-backup-${Date.now()}.json`)
  await mkdir(joinPath(getUserDataPath(), DATA_DIR))
  await writeTextFile(path, text)
  await pruneLocalBackups(path).catch(() => undefined)
  return path
}

/** 生成用于分享的唯一备份文件；不得复用旧路径，避免微信会话引用的文件被覆盖 */
export async function createShareBackup(): Promise<string> {
  const text = await exportJson()
  const path = joinPath(getUserDataPath(), DATA_DIR, `local-backup-share-${Date.now()}.json`)
  await mkdir(joinPath(getUserDataPath(), DATA_DIR))
  await writeTextFile(path, text)
  // 备份页 onShow 每次都会走到这里，是本地快照累积的主要来源
  await pruneLocalBackups(path).catch(() => undefined)
  return path
}


/**
 * 整库恢复（覆盖语义）：
 * 先严格校验 → pre-restore 保护点 → 写入新库。
 * 恢复失败时原库保留；保护点可由"撤销上次恢复"入口写回。
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

/** 恢复保护点文件路径（供"撤销上次恢复"读写） */
export function preRestorePath(): string {
  return joinPath(getUserDataPath(), DATA_DIR, PRE_RESTORE)
}

export function hasPreRestoreSnapshot(): Promise<boolean> {
  return exists(preRestorePath())
}

/** 恢复保护点（pre-restore.json）的可展示信息 */
export interface PreRestoreInfo {
  exists: boolean
  /** 文件可解析且校验通过时的数据概要 */
  summary?: BackupSummary
  /** 保护点保存时间（毫秒）；无法取得时为 undefined */
  savedAt?: number
  /** 文件存在但不可用时的原因 */
  error?: string
}

/** 撤销结果：数据回退与保护点清理分别报告 */
export interface UndoRestoreResult {
  summary: BackupSummary
  protectionRemoved: boolean
}

interface LoadedPreRestore {
  db: RuntimeDatabase
  savedAt?: number
}

function summarizeDatabase(db: RuntimeDatabase): BackupSummary {
  return {
    activeItems: db.items.filter((it) => it.deletedAt === null).length,
    deletedItems: db.items.filter((it) => it.deletedAt !== null).length,
    categories: db.categories.length,
  }
}

/**
 * 用现有备份校验规则复核保护点内容：
 * 把 RuntimeDatabase 包装成同构的 BackupFile 交给 validateBackupContent，
 * 复用 ID 唯一性、分类引用、金额/数量等业务规则，避免两套规则漂移。
 */
function validatePreRestoreContent(db: RuntimeDatabase): string[] {
  const synthetic: BackupFile = {
    format: BACKUP_FORMAT,
    schemaVersion: db.schemaVersion,
    appVersion: APP_VERSION,
    exportedAt: db.updatedAt,
    sourceRevision: db.revision,
    summary: summarizeDatabase(db),
    data: {
      items: db.items,
      categories: db.categories,
    },
  }
  return validateBackupContent(JSON.stringify(synthetic)).errors
}

/**
 * 读取并校验保护点：文件不存在返回 null，内容不可用抛错。
 * 全部校验必须在 saveDatabase 之前完成。
 */
async function readPreRestoreDatabase(): Promise<LoadedPreRestore | null> {
  const path = preRestorePath()
  if (!(await exists(path))) return null
  let text: string
  try {
    text = await readTextFile(path)
  } catch (error) {
    throw new Error(`保护点读取失败：${error instanceof Error ? error.message : String(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('保护点文件已损坏，无法撤销')
  }
  if (!isDatabaseShape(parsed)) {
    throw new Error('保护点结构不合法，无法撤销')
  }
  if (parsed.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`保护点版本不受支持：${parsed.schemaVersion}`)
  }
  const errors = validatePreRestoreContent(parsed)
  if (errors.length > 0) {
    throw new Error(`保护点内容校验失败：${errors[0]}`)
  }
  let savedAt: number | undefined
  try {
    // lastModifiedTime 单位为秒
    const ms = (await stat(path)).lastModifiedTime * 1000
    if (ms > 0) savedAt = ms
  } catch {
    // 取不到时间只影响展示，不影响撤销
  }
  return { db: parsed, savedAt }
}

/** 读取保护点摘要供页面展示；任何错误都转为 error 字段，不抛异常 */
export async function getPreRestoreInfo(): Promise<PreRestoreInfo> {
  try {
    const loaded = await readPreRestoreDatabase()
    if (loaded === null) return { exists: false }
    return { exists: true, summary: summarizeDatabase(loaded.db), savedAt: loaded.savedAt }
  } catch (error) {
    return { exists: true, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 撤销上一次恢复：把保护点写回为当前库，成功后删除保护点。
 * 保存失败时保护点保留、数据库保持原状；删除失败不影响撤销结果。
 */
export async function undoLastRestore(): Promise<UndoRestoreResult> {
  const loaded = await readPreRestoreDatabase()
  if (loaded === null) throw new Error('暂无可撤销的恢复保护点')
  const summary = summarizeDatabase(loaded.db)
  await saveDatabase({
    format: 'purchase-archive-database',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0,
    updatedAt: now(),
    items: loaded.db.items,
    categories: loaded.db.categories,
  })
  // 数据已回退，删除失败不能再抛错，否则页面会误报撤销失败
  const protectionRemoved = await removeFile(preRestorePath()).then(() => true).catch(() => false)
  return { summary, protectionRemoved }
}
