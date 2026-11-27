// services/webdav-backup-service.ts
// WebDAV 云端备份编排：双 manifest、SHA-256 回读校验、三份轮转、pendingDeletes 重试。
// 仅使用 HEAD/GET/PUT/DELETE；远程目录必须由用户在坚果云预先创建。

import type { BackupFile, ManifestBackupEntry, RemoteManifest } from '../models/backup'
import { createShareBackup, restoreFromContent, validateBackupContent } from './backup-service'
import { createWebDavClient, parseRemoteManifest } from './webdav-client'
import type { WebDavConfig, WebDavClient, WebDavConnectionResult } from './webdav-client'
import { getUserDataPath, joinPath, mkdir, readBinaryFile, readTextFile, removeFile } from '../storage/local-storage'
import { DATA_DIR } from '../constants/storage-keys'
import { now } from '../utils/date'
import { sha256Hex } from '../utils/sha256'

const MANIFEST_SCHEMA_VERSION = 1
const MAX_BACKUPS = 3

type ManifestSlot = 'a' | 'b'

interface ManifestState {
  slot: ManifestSlot
  manifest: RemoteManifest
}

/** 单个 manifest 槽位的读取结果 */
interface ManifestSlotState {
  slot: ManifestSlot
  /** 远程是否存在该文件（仅 404 视为不存在） */
  exists: boolean
  /** null 表示文件存在但无法解析 */
  manifest: RemoteManifest | null
  /** manifest 为 null 时的原因，用于组装用户提示 */
  error?: string
}

interface BackupUploadResult {
  fileName: string
  sha256: string
  size: number
  activeItems: number
  deletedItems: number
  categories: number
}

function manifestFileName(slot: ManifestSlot): string {
  return `manifest-${slot}.json`
}

function otherSlot(slot: ManifestSlot): ManifestSlot {
  return slot === 'a' ? 'b' : 'a'
}

/**
 * 读取单个 manifest 槽位：
 * - 404 → 不存在（首次上传场景）；
 * - 200 但解析失败 → 存在且损坏；
 * - 鉴权/服务端/网络失败 → 由客户端抛错，调用方中止操作。
 */
async function readManifestSlot(client: WebDavClient, slot: ManifestSlot): Promise<ManifestSlotState> {
  const name = manifestFileName(slot)
  const text = await client.getTextIfExists(name)
  if (text === null) {
    return { slot, exists: false, manifest: null }
  }
  const manifest = parseRemoteManifest(text)
  if (manifest === null) {
    return { slot, exists: true, manifest: null, error: `${name} 内容无法解析` }
  }
  return { slot, exists: true, manifest }
}

/**
 * 读取当前有效的云端索引：
 * - 任一槽位可解析 → 取 revision 高者（另一个损坏/缺失时由上传写入 otherSlot 自愈）；
 * - 两个槽位都不存在 → null（首次上传）；
 * - 文件存在但没有任何可解析副本 → 抛错中止，避免空索引重建导致旧备份失联。
 */
async function readActiveManifest(client: WebDavClient): Promise<ManifestState | null> {
  const [a, b] = await Promise.all([readManifestSlot(client, 'a'), readManifestSlot(client, 'b')])

  const candidates: ManifestState[] = []
  if (a.manifest !== null) candidates.push({ slot: 'a', manifest: a.manifest })
  if (b.manifest !== null) candidates.push({ slot: 'b', manifest: b.manifest })
  if (candidates.length > 0) {
    return candidates.reduce((best, current) =>
      current.manifest.revision > best.manifest.revision ? current : best,
    )
  }

  const existing = [a, b].filter((state) => state.exists)
  if (existing.length === 0) return null

  const details = existing.map((state) => state.error ?? `${manifestFileName(state.slot)} 无法解析`).join('；')
  throw new Error(
    `云端备份索引损坏（${details}）。请在坚果云检查 manifest-a.json / manifest-b.json，确认损坏后删除再重试；` +
      '已有的 backup-*.json 不会自动恢复为可恢复备份，请谨慎删除索引。',
  )
}

async function writeManifest(client: WebDavClient, slot: ManifestSlot, manifest: RemoteManifest): Promise<void> {
  const text = JSON.stringify(manifest, null, 2)
  await client.putText(manifestFileName(slot), text)
  const readBack = await client.getText(manifestFileName(slot))
  const parsed = parseRemoteManifest(readBack)
  if (parsed === null || parsed.revision !== manifest.revision || parsed.backups.length !== manifest.backups.length) {
    throw new Error('manifest 回读校验失败')
  }
}

function buildBackupEntry(
  fileName: string,
  backup: BackupFile,
  size: number,
  sha256: string,
): ManifestBackupEntry {
  return {
    fileName,
    exportedAt: backup.exportedAt,
    schemaVersion: backup.schemaVersion,
    sourceRevision: backup.sourceRevision,
    size,
    activeItems: backup.summary.activeItems,
    deletedItems: backup.summary.deletedItems,
    categories: backup.summary.categories,
    sha256,
  }
}

function uniqueLocalPath(prefix: string, extension: string): string {
  return joinPath(getUserDataPath(), DATA_DIR, `${prefix}-${Date.now()}.${extension}`)
}

async function readBackupFileFromPath(path: string): Promise<BackupFile> {
  const text = await readTextFile(path)
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('备份文件结构不合法')
  }
  return parsed as BackupFile
}

async function hashAndSize(filePath: string): Promise<{ sha256: string; size: number }> {
  const buffer = await readBinaryFile(filePath)
  return { sha256: sha256Hex(buffer), size: buffer.byteLength }
}

/** 连接测试：HEAD 远程目录 */
export async function checkWebDavConnection(config: WebDavConfig): Promise<WebDavConnectionResult> {
  const client = createWebDavClient(config)
  return client.checkConnection()
}

/** 列出云端有效备份（按导出时间倒序，排除 pendingDeletes） */
export async function listWebDavBackups(config: WebDavConfig): Promise<ManifestBackupEntry[]> {
  const client = createWebDavClient(config)
  const state = await readActiveManifest(client)
  if (!state) return []
  const pending = new Set(state.manifest.pendingDeletes)
  return state.manifest.backups
    .filter((entry) => !pending.has(entry.fileName))
    .sort((a, b) => b.exportedAt - a.exportedAt)
}

/** 尽力删除远程文件；返回是否清理成功 */
async function deleteRemoteFileQuietly(client: WebDavClient, fileName: string): Promise<boolean> {
  try {
    await client.deleteText(fileName)
    return true
  } catch {
    return false
  }
}

/** 上传失败时附加“云端文件是否已清理”的说明，便于用户手动兜底 */
function buildUploadError(error: unknown, fileName: string, cleanupOk: boolean): Error {
  const raw = error instanceof Error ? error.message : String(error)
  const suffix = cleanupOk
    ? `已自动删除本次上传的云端文件 ${fileName}`
    : `自动清理云端文件失败，请在坚果云手动删除 ${fileName}`
  return new Error(`云端备份失败：${raw}（${suffix}）`)
}

/**
 * 上传当前本地库到云端（执行顺序不可调换）：
 * 1. 先读云端索引：读取失败时远程与本地都零写入
 * 2. 生成本地快照并计算 SHA-256（createShareBackup 内部顺带轮转本地文件）
 * 3. PUT 上传备份文件
 * 4. GET 回读校验：任意异常都删除刚 PUT 的文件
 * 5. 更新双 manifest，保留最近三份；第一次写索引失败同样删除新文件
 * 6. 删除旧备份；失败记入 pendingDeletes，下次重试
 */
export async function uploadWebDavBackup(config: WebDavConfig): Promise<BackupUploadResult> {
  const client = createWebDavClient(config)

  // 1. 先读索引：鉴权/网络/索引损坏在此中止，不产生任何写入
  const state = await readActiveManifest(client)

  // 2. 本地快照（createShareBackup 末尾会轮转本地备份文件）
  const backupPath = await createShareBackup()
  const backup = await readBackupFileFromPath(backupPath)
  const { sha256, size } = await hashAndSize(backupPath)
  const backupFileName = `backup-${backup.exportedAt}-${backup.sourceRevision}.json`

  // 3. 上传
  await client.putText(backupFileName, await readTextFile(backupPath))

  // 4. 回读校验：downloadFile / getFileStat / SHA 不一致 / mkdir 失败都清理远程新文件
  const downloadPath = uniqueLocalPath('webdav-upload-verify', 'json')
  try {
    await mkdir(joinPath(getUserDataPath(), DATA_DIR))
    await client.downloadFile(backupFileName, downloadPath)
    const downloadedStat = await client.getFileStat(downloadPath)
    if (downloadedStat.sha256 !== sha256) {
      throw new Error('云端备份回读 SHA-256 不一致')
    }
  } catch (error) {
    const cleanupOk = await deleteRemoteFileQuietly(client, backupFileName)
    throw buildUploadError(error, backupFileName, cleanupOk)
  } finally {
    await removeFile(downloadPath).catch(() => undefined)
  }

  // 5. 构造新索引
  const activeSlot: ManifestSlot = state ? otherSlot(state.slot) : 'a'
  const previous: RemoteManifest = state
    ? state.manifest
    : {
        format: 'purchase-archive-manifest',
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        updatedAt: now(),
        backups: [],
        pendingDeletes: [],
      }

  const newEntry = buildBackupEntry(backupFileName, backup, size, sha256)
  const pendingSet = new Set(previous.pendingDeletes)
  const sortedBackups = [...previous.backups, newEntry].sort((a, b) => b.exportedAt - a.exportedAt)
  const keep = sortedBackups.slice(0, MAX_BACKUPS)
  const remove = sortedBackups.slice(MAX_BACKUPS)
  for (const entry of remove) pendingSet.add(entry.fileName)

  const nextManifest: RemoteManifest = {
    format: 'purchase-archive-manifest',
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: previous.revision + 1,
    updatedAt: now(),
    backups: keep,
    pendingDeletes: Array.from(pendingSet),
  }
  // 第一次写索引失败：删除新文件，保持“远程无新增”的原子语义
  try {
    await writeManifest(client, activeSlot, nextManifest)
  } catch (error) {
    const cleanupOk = await deleteRemoteFileQuietly(client, backupFileName)
    throw buildUploadError(error, backupFileName, cleanupOk)
  }

  // 6. 删除旧备份；最终索引写回为 best-effort，pendingDeletes 可由下次上传自愈
  const retryPending = Array.from(pendingSet)
  const stillPending: string[] = []
  for (const fileName of retryPending) {
    try {
      await client.deleteText(fileName)
    } catch {
      stillPending.push(fileName)
    }
  }
  // 有删除成功时才更新 manifest，避免 pendingDeletes 残留已删除文件
  if (stillPending.length < retryPending.length) {
    const finalSlot = otherSlot(activeSlot)
    const finalManifest: RemoteManifest = {
      ...nextManifest,
      revision: nextManifest.revision + 1,
      updatedAt: now(),
      pendingDeletes: stillPending,
    }
    // 核心备份与索引已成功；这里失败留待下次上传重试，不向用户报错
    await writeManifest(client, finalSlot, finalManifest).catch(() => undefined)
  }

  return {
    fileName: backupFileName,
    sha256,
    size,
    activeItems: backup.summary.activeItems,
    deletedItems: backup.summary.deletedItems,
    categories: backup.summary.categories,
  }
}

/** 下载指定云端备份并校验 SHA-256，返回备份文本 */
async function downloadBackupText(config: WebDavConfig, entry: ManifestBackupEntry): Promise<string> {
  const client = createWebDavClient(config)
  const downloadPath = uniqueLocalPath('webdav-download', 'json')
  await mkdir(joinPath(getUserDataPath(), DATA_DIR))
  try {
    await client.downloadFile(entry.fileName, downloadPath)
    const stat = await client.getFileStat(downloadPath)
    if (stat.sha256 !== entry.sha256) {
      throw new Error('云端备份 SHA-256 校验失败')
    }
    return await readTextFile(downloadPath)
  } finally {
    await removeFile(downloadPath).catch(() => undefined)
  }
}

/** 恢复最新云端备份：下载 → SHA-256 校验 → 严格校验 → pre-restore → 整库恢复 */
export async function restoreLatestWebDavBackup(config: WebDavConfig): Promise<ManifestBackupEntry> {
  const backups = await listWebDavBackups(config)
  if (backups.length === 0) {
    throw new Error('云端暂无可用备份')
  }
  const latest = backups[0]
  if (!latest) throw new Error('云端暂无可用备份')
  const text = await downloadBackupText(config, latest)
  const validation = validateBackupContent(text)
  if (!validation.valid) {
    throw new Error(`云端备份校验失败：${validation.errors[0] ?? '未知错误'}`)
  }
  await restoreFromContent(text)
  return latest
}
