// storage/database-storage.ts
// A/B 双版本本地数据库的读取、校验、交替安全写入与损坏回退。
// 写入协议（不可省略顺序）：
//   1. 读取 A/B，解析校验，选择 revision 较高的有效库；
//   2. 调用方在内存中完成新状态的完整业务校验；
//   3. 写入非活动文件，写入后重新读取、解析并校验内容一致；
//   4. 确认有效后新库 revision 比当前库大 1；
//   5. 任一文件损坏时回退另一有效副本；双库均不可用时抛可恢复错误，绝不静默覆盖。

import type { RuntimeDatabase } from '../models/backup'
import type { Item } from '../models/item'
import type { Category } from '../models/category'
import { DATA_DIR, DATABASE_A, DATABASE_B, PRE_RESTORE } from '../constants/storage-keys'
import { getUserDataPath, joinPath, readTextFile, writeTextFile, exists, mkdir, removeFile } from './local-storage'
import { now } from '../utils/date'

/** 当前 schema 版本；未来结构变更须经 migrateDatabase 分发 */
export const CURRENT_SCHEMA_VERSION = 1

const DB_FORMAT = 'purchase-archive-database'

/** 双库均存在但均损坏：可恢复错误，禁止覆盖写入 */
export class DatabaseCorruptedError extends Error {
  constructor() {
    super('本地数据库两份副本均不可用，已停止写入以保护数据')
    this.name = 'DatabaseCorruptedError'
  }
}

type SlotName = 'a' | 'b'

/** 解析结果：null 表示文件不存在或损坏（损坏细节记录在 error 中） */
interface SlotParseResult {
  slot: SlotName
  exists: boolean
  db: RuntimeDatabase | null
  error?: string
}

/** 单库文件完整路径 */
function slotPath(slot: SlotName): string {
  return joinPath(getUserDataPath(), DATA_DIR, slot === 'a' ? DATABASE_A : DATABASE_B)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Item 结构校验（存储层结构级；业务校验在 Service 层完成） */
export function isItemShape(v: unknown): v is Item {
  if (!isRecord(v)) return false
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.coverImageUrl === 'string' &&
    Array.isArray(v.detailImageUrls) &&
    v.detailImageUrls.every((u) => typeof u === 'string') &&
    typeof v.description === 'string' &&
    Array.isArray(v.categoryIds) &&
    v.categoryIds.every((c) => typeof c === 'string') &&
    typeof v.paidAmount === 'number' &&
    Number.isInteger(v.paidAmount) &&
    v.paidAmount >= 0 &&
    typeof v.quantity === 'number' &&
    Number.isInteger(v.quantity) &&
    v.quantity >= 1 &&
    typeof v.purchaseDate === 'number' &&
    Number.isFinite(v.purchaseDate) &&
    typeof v.createdAt === 'number' &&
    Number.isFinite(v.createdAt) &&
    typeof v.updatedAt === 'number' &&
    Number.isFinite(v.updatedAt) &&
    (v.purchasePlatform === undefined || typeof v.purchasePlatform === 'string') &&
    (v.productUrl === undefined || typeof v.productUrl === 'string') &&
    (v.orderNumber === undefined || typeof v.orderNumber === 'string') &&
    (v.deletedAt === null || (typeof v.deletedAt === 'number' && Number.isFinite(v.deletedAt)))
  )
}

/** Category 结构校验 */
export function isCategoryShape(v: unknown): v is Category {
  if (!isRecord(v)) return false
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.sortOrder === 'number' &&
    Number.isInteger(v.sortOrder) &&
    typeof v.createdAt === 'number' &&
    Number.isFinite(v.createdAt) &&
    typeof v.updatedAt === 'number' &&
    Number.isFinite(v.updatedAt)
  )
}

/** RuntimeDatabase 结构校验（不含业务规则） */
export function isDatabaseShape(v: unknown): v is RuntimeDatabase {
  if (!isRecord(v)) return false
  if (v.format !== DB_FORMAT) return false
  if (typeof v.schemaVersion !== 'number' || !Number.isInteger(v.schemaVersion)) return false
  if (typeof v.revision !== 'number' || !Number.isInteger(v.revision) || v.revision < 0) return false
  if (typeof v.updatedAt !== 'number' || !Number.isFinite(v.updatedAt)) return false
  if (!Array.isArray(v.items) || !v.items.every(isItemShape)) return false
  if (!Array.isArray(v.categories) || !v.categories.every(isCategoryShape)) return false
  return true
}

/** schema 迁移分发入口：当前仅 v1，保留结构供后续版本使用 */
function migrateDatabase(db: RuntimeDatabase): RuntimeDatabase {
  if (db.schemaVersion === CURRENT_SCHEMA_VERSION) return db
  // 未来版本在此按 schemaVersion 逐级迁移；未知更高版本视为不兼容。
  throw new Error(`暂不支持的数据库版本：${db.schemaVersion}`)
}

/** 空初始库（首次使用） */
function emptyDatabase(): RuntimeDatabase {
  return {
    format: DB_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0,
    updatedAt: now(),
    items: [],
    categories: [],
  }
}

async function parseSlot(slot: SlotName): Promise<SlotParseResult> {
  const path = slotPath(slot)
  if (!(await exists(path))) {
    return { slot, exists: false, db: null }
  }
  try {
    const text = await readTextFile(path)
    const parsed: unknown = JSON.parse(text)
    if (!isDatabaseShape(parsed)) {
      return { slot, exists: true, db: null, error: '结构校验失败' }
    }
    const migrated = migrateDatabase(parsed)
    return { slot, exists: true, db: migrated }
  } catch (e) {
    return { slot, exists: true, db: null, error: e instanceof Error ? e.message : String(e) }
  }
}

interface LoadedState {
  db: RuntimeDatabase
  active: SlotName
}

let cached: LoadedState | null = null
/** 串行化写入，避免并发写导致 A/B 状态竞争 */
let writeQueue: Promise<unknown> = Promise.resolve()

/** 读取当前有效数据库；首次使用自动落盘空库。双库损坏抛 DatabaseCorruptedError。 */
async function load(): Promise<LoadedState> {
  if (cached) return cached
  const [a, b] = await Promise.all([parseSlot('a'), parseSlot('b')])
  const dbA = a.db
  const dbB = b.db
  if (dbA && dbB) {
    const active: SlotParseResult = dbA.revision >= dbB.revision ? a : b
    const activeDb: RuntimeDatabase = active === a ? dbA : dbB
    cached = { db: activeDb, active: active.slot }
    return cached
  }
  if (dbA || dbB) {
    // 单库损坏：回退另一有效副本（不修改文件，下次写入自然覆盖损坏副本）
    const validDb: RuntimeDatabase = dbA ?? (dbB as RuntimeDatabase)
    cached = { db: validDb, active: dbA ? 'a' : 'b' }
    return cached
  }
  // 两文件均不存在：首次使用，创建空库
  if (!a.exists && !b.exists) {
    const db = emptyDatabase()
    await mkdir(joinPath(getUserDataPath(), DATA_DIR))
    await writeTextFile(slotPath('a'), JSON.stringify(db, null, 2))
    cached = { db, active: 'a' }
    return cached
  }
  // 存在文件但全部损坏：可恢复错误
  throw new DatabaseCorruptedError()
}

/** 读取当前有效数据库的快照（调用方不得原地修改后直接写回，应经 save 提交新状态） */
export async function readDatabase(): Promise<RuntimeDatabase> {
  const state = await load()
  // 返回浅拷贝并深拷贝集合，防止调用方原地修改污染缓存
  return {
    ...state.db,
    items: state.db.items.map((it) => ({ ...it, detailImageUrls: [...it.detailImageUrls], categoryIds: [...it.categoryIds] })),
    categories: state.db.categories.map((c) => ({ ...c })),
  }
}

/**
 * 提交新数据库状态：写入非活动文件、回读校验、revision+1 生效。
 * 调用方提交的 revision 会被忽略，由本层保证单调递增。
 */
export function saveDatabase(next: RuntimeDatabase): Promise<void> {
  const task = writeQueue.then(() => doSave(next))
  writeQueue = task.catch(() => undefined)
  return task
}

async function doSave(next: RuntimeDatabase): Promise<void> {
  const state = await load()
  const target: SlotName = state.active === 'a' ? 'b' : 'a'
  const targetSlot = await parseSlot(target)

  const candidate: RuntimeDatabase = {
    format: DB_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: state.db.revision + 1,
    updatedAt: now(),
    items: next.items,
    categories: next.categories,
  }

  // 活动副本已经比候选新：拒绝陈旧写入
  if (state.db.revision >= candidate.revision) {
    throw new Error('数据库并发写入冲突，请刷新后重试')
  }

  const path = slotPath(target)
  await mkdir(joinPath(getUserDataPath(), DATA_DIR))
  const payload = JSON.stringify(candidate, null, 2)
  await writeTextFile(path, payload)

  // 回读校验：解析、结构校验、内容一致
  try {
    const rereadText = await readTextFile(path)
    const reread: unknown = JSON.parse(rereadText)
    if (!isDatabaseShape(reread)) {
      throw new Error('回读结构校验失败')
    }
    if (JSON.stringify(reread) !== JSON.stringify(candidate)) {
      throw new Error('回读内容与写入不一致')
    }
  } catch (e) {
    // 写入结果不可信：移除目标文件，保持活动副本不变
    await removeFile(path).catch(() => undefined)
    throw new Error(`数据库写入校验失败，已保留原数据：${e instanceof Error ? e.message : String(e)}`)
  }

  // 写入被覆盖前如果目标文件原本有效（旧版本副本），现在已被新版本替代，属正常交替
  void targetSlot
  cached = { db: candidate, active: target }
}

/** 仅测试/维护用途：清空内存缓存，强制下次重新读盘 */
export function resetDatabaseCache(): void {
  cached = null
}

/**
 * 恢复导入前的保护点：把当前有效数据库原样复制为 pre-restore.json。
 * 必须在恢复写入之前调用；恢复失败时原库不受影响。
 */
export async function snapshotToPreRestore(): Promise<void> {
  const state = await load()
  const src = slotPath(state.active)
  const text = await readTextFile(src)
  const dest = joinPath(getUserDataPath(), DATA_DIR, PRE_RESTORE)
  await writeTextFile(dest, text)
}
