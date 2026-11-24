// services/image-cache-service.ts
// 图片缓存：仅按需下载 + 手动清空（不做自动淘汰/LRU）。
// 策略：URL 经 FNV-1a 哈希派生文件名，存入 IMAGE_CACHE_DIR；
//   启动时 readdir 加载已缓存哈希集合（内存 Set），getCachedPath 同步返回本地路径或原 URL；
//   未命中时触发后台下载（并发≤3），成功后更新集合，调用方可择机刷新。
// 不依赖 Storage 映射表——文件名即哈希，重启后 readdir 即可重建索引。

import {
  getUserDataPath,
  joinPath,
  mkdir,
  exists,
  saveFile,
  readdir,
  removeFile,
  stat,
} from '../storage/local-storage'
import { IMAGE_CACHE_DIR } from '../constants/storage-keys'
import { hashStringToHex } from '../utils/hash'

/** 并发下载上限 */
const MAX_CONCURRENT = 3

/** 内存中已缓存的文件名（哈希）集合，启动后由 readdir 填充 */
const cachedFiles = new Set<string>()
let initialized = false
let initPromise: Promise<void> | null = null

/** 当前并发计数与等待队列 */
let active = 0
const queue: Array<() => void> = []
/** 清空前需等待的下载任务；清空期间新任务会等待清空完成 */
const downloadTasks = new Set<Promise<void>>()
let clearingPromise: Promise<void> | null = null

function cacheDir(): string {
  return joinPath(getUserDataPath(), IMAGE_CACHE_DIR)
}

function pathForHash(h: string): string {
  return joinPath(cacheDir(), h)
}

function hashOf(url: string): string {
  return hashStringToHex(url)
}

/** 启动初始化：扫描缓存目录，重建内存哈希集合。幂等。 */
export function init(): Promise<void> {
  if (initialized) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const dir = cacheDir()
      if (!(await exists(dir))) {
        await mkdir(dir)
      } else {
        const files = await readdir(dir)
        files.forEach((f) => cachedFiles.add(f))
      }
    } catch {
      // 初始化失败不阻断业务，退化为全程走网络
    }
    initialized = true
  })()
  return initPromise
}

/**
 * 同步获取缓存路径：命中返回本地路径，未命中返回原 URL。
 * 未初始化完成时也返回原 URL（首屏可能走网络，后续访问走缓存）。
 */
export function getCachedPath(url: string): string {
  if (!url) return url
  if (!initialized) return url
  const h = hashOf(url)
  if (cachedFiles.has(h)) {
    return pathForHash(h)
  }
  return url
}

/** 信号量：获取下载槽位 */
function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      active++
      resolve()
    })
  })
}

function releaseSlot(): void {
  active--
  const next = queue.shift()
  if (next) next()
}

function isDecodableImage(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: filePath,
      success: (res) => resolve(res.width > 0 && res.height > 0),
      fail: () => resolve(false),
    })
  })
}

async function performDownload(url: string): Promise<void> {
  await init()
  if (clearingPromise) await clearingPromise.catch(() => undefined)
  const h = hashOf(url)
  if (cachedFiles.has(h)) return
  await acquireSlot()
  let tempFilePath = ''
  try {
    // 等待槽位期间可能已被其他任务缓存
    if (cachedFiles.has(h)) return
    const target = pathForHash(h)
    const res = await new Promise<WechatMiniprogram.DownloadFileSuccessCallbackResult>(
      (resolve, reject) => {
        wx.downloadFile({ url, success: resolve, fail: reject })
      },
    )
    tempFilePath = res.tempFilePath
    if (res.statusCode !== 200 || !(await isDecodableImage(tempFilePath))) {
      await removeFile(tempFilePath).catch(() => undefined)
      tempFilePath = ''
      return
    }
    await mkdir(cacheDir())
    await saveFile(tempFilePath, target)
    tempFilePath = ''
    cachedFiles.add(h)
  } catch {
    // 网络、解码或保存失败：清理临时文件并保持走原 URL，下次再试
    if (tempFilePath) await removeFile(tempFilePath).catch(() => undefined)
  } finally {
    releaseSlot()
  }
}

/**
 * 按需下载并缓存。已命中则跳过；失败静默回退原 URL（不中断列表）。
 * 返回时若已缓存，调用方可刷新 src。
 */
export function downloadIfNeeded(url: string): Promise<void> {
  if (!url) return Promise.resolve()
  const task = performDownload(url)
  downloadTasks.add(task)
  void task.then(() => downloadTasks.delete(task))
  return task
}

/** 本地文件损坏或丢失时移除缓存关联，让界面回退原 URL 并重新下载 */
export async function discardCached(url: string): Promise<void> {
  if (!url) return
  const h = hashOf(url)
  cachedFiles.delete(h)
  await removeFile(pathForHash(h)).catch(() => undefined)
}

export interface CacheStats {
  fileCount: number
  totalBytes: number
}

/** 缓存目录统计：文件数与总字节数 */
export async function getStats(): Promise<CacheStats> {
  await init()
  const dir = cacheDir()
  if (!(await exists(dir))) return { fileCount: 0, totalBytes: 0 }
  const files = await readdir(dir)
  let total = 0
  for (const f of files) {
    try {
      total += (await stat(pathForHash(f))).size
    } catch {
      // 单文件 stat 失败忽略
    }
  }
  return { fileCount: files.length, totalBytes: total }
}

/** 一键清空：等待已有下载结束，删除目录内全部文件并同步内存集合 */
export function clearAll(): Promise<void> {
  if (clearingPromise) return clearingPromise
  const pendingDownloads = Array.from(downloadTasks)
  const operation = (async () => {
    await init()
    await Promise.all(pendingDownloads)
    const dir = cacheDir()
    let failedCount = 0
    try {
      if (await exists(dir)) {
        const files = await readdir(dir)
        for (const f of files) {
          try {
            await removeFile(pathForHash(f))
          } catch {
            failedCount++
          }
        }
        const remaining = await readdir(dir)
        cachedFiles.clear()
        remaining.forEach((f) => cachedFiles.add(f))
      } else {
        cachedFiles.clear()
      }
    } catch (error) {
      // 无法确认目录状态时不要保留可能已失效的本地路径
      cachedFiles.clear()
      throw error
    }
    if (failedCount > 0) {
      throw new Error(`${failedCount} 个缓存文件删除失败，请重试`)
    }
  })()
  clearingPromise = operation
  void operation.then(
    () => { clearingPromise = null },
    () => { clearingPromise = null },
  )
  return operation
}

/** 下载完成后的刷新回调类型 */
export type RefreshCallback = (cachedPath: string) => void

/**
 * 下载并在完成后回调（供组件刷新 src）。若已命中，立即同步回调。
 */
export function downloadAndRefresh(url: string, cb: RefreshCallback): void {
  const current = getCachedPath(url)
  if (current !== url) {
    cb(current)
    return
  }
  downloadIfNeeded(url).then(() => {
    const path = getCachedPath(url)
    if (path !== url) cb(path)
  })
}
