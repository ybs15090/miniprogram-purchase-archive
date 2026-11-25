// services/webdav-backup-service.ts
// WebDAV 云端备份编排：双 manifest、SHA-256 回读校验、三份轮转、pendingDeletes 重试。
// 仅使用 HEAD/GET/PUT/DELETE；远程目录必须由用户在坚果云预先创建。

import type { BackupFile, ManifestBackupEntry, RemoteManifest } from '../models/backup'
import { createShareBackup, restoreFromContent, validateBackupContent } from './backup-service'
import { createWebDavClient, parseRemoteManifest } from './webdav-client'
import type { WebDavConfig, WebDavClient, WebDavConnectionResult } from './webdav-client'
import { getUserDataPath, joinPath, mkdir, readBinaryFile, readTextFile, removeFile } from '../storage/local-storage'
import { now } from '../utils/date'
import { sha256Hex } from '../utils/sha256'

const MANIFEST_SCHEMA_VERSION = 1
const MAX_BACKUPS = 3

type ManifestSlot = 'a' | 'b'

interface ManifestState {
  slot: ManifestSlot
  manifest: RemoteManifest
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

async function readManifestSlot(client: WebDavClient, slot: ManifestSlot): Promise<RemoteManifest | null> {
  try {
    const text = await client.getText(manifestFileName(slot))
    return parseRemoteManifest(text)
  } catch {
    return null
  }
}

async function readActiveManifest(client: WebDavClient): Promise<ManifestState | null> {
  const [a, b] = await Promise.all([readManifestSlot(client, 'a'), readManifestSlot(client, 'b')])
  if (a && b) {
    return a.revision >= b.revision ? { slot: 'a', manifest: a } : { slot: 'b', manifest: b }
  }
  if (a) return { slot: 'a', manifest: a }
  if (b) return { slot: 'b', manifest: b }
  return null
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
  return joinPath(getUserDataPath(), 'data', `${prefix}-${Date.now()}.${extension}`)
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

/**
 * 上传当前本地库到云端：
 * 1. 生成本地备份文件并计算 SHA-256
 * 2. PUT 上传备份文件
 * 3. GET 回读并校验 SHA-256
 * 4. 更新双 manifest，保留最近三份
 * 5. 删除旧备份；失败记入 pendingDeletes，下次重试
 */
export async function uploadWebDavBackup(config: WebDavConfig): Promise<BackupUploadResult> {
  const client = createWebDavClient(config)
  const backupPath = await createShareBackup()
  const backup = await readBackupFileFromPath(backupPath)
  const { sha256, size } = await hashAndSize(backupPath)
  const backupFileName = `backup-${backup.exportedAt}-${backup.sourceRevision}.json`
  await client.putText(backupFileName, await readTextFile(backupPath))

  const downloadPath = uniqueLocalPath('webdav-upload-verify', 'json')
  await mkdir(joinPath(getUserDataPath(), 'data'))
  try {
    await client.downloadFile(backupFileName, downloadPath)
    const downloadedStat = await client.getFileStat(downloadPath)
    if (downloadedStat.sha256 !== sha256) {
      await client.deleteText(backupFileName).catch(() => undefined)
      throw new Error('云端备份回读 SHA-256 不一致')
    }
  } finally {
    await removeFile(downloadPath).catch(() => undefined)
  }

  const state = await readActiveManifest(client)
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
  await writeManifest(client, activeSlot, nextManifest)

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
    await writeManifest(client, finalSlot, finalManifest)
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
  await mkdir(joinPath(getUserDataPath(), 'data'))
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
