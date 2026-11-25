// storage/local-storage.ts
// 微信本地文件系统与 Storage API 的统一封装。
// 页面不得直接调用 wx.setStorageSync 或文件系统 API 修改业务数据，应由 Repository 经由本层实现。

const fs = wx.getFileSystemManager()

export interface FileStat {
  size: number
  lastModifiedTime: number
}

/** 用户文件目录根路径 */
export function getUserDataPath(): string {
  return wx.env.USER_DATA_PATH
}

/** 简单路径拼接（本项目内部使用正斜杠分隔） */
export function joinPath(...parts: string[]): string {
  return parts.filter((p) => p.length > 0).join('/')
}

export function readTextFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      encoding: 'utf-8',
      success: (res) => resolve(res.data as string),
      fail: reject,
    })
  })
}

export function readBinaryFile(filePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      success: (res) => resolve(res.data as ArrayBuffer),
      fail: reject,
    })
  })
}

export function writeTextFile(filePath: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.writeFile({
      filePath,
      data,
      encoding: 'utf-8',
      success: () => resolve(),
      fail: reject,
    })
  })
}

export function exists(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    fs.access({
      path: filePath,
      success: () => resolve(true),
      fail: () => resolve(false),
    })
  })
}

export function mkdir(dirPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdir({
      dirPath,
      recursive: true,
      success: () => resolve(),
      fail: reject,
    })
  })
}

export function removeFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.unlink({
      filePath,
      success: () => resolve(),
      fail: reject,
    })
  })
}

export function stat(filePath: string): Promise<FileStat> {
  return new Promise((resolve, reject) => {
    fs.stat({
      path: filePath,
      success: (res) => {
        const s = res.stats as WechatMiniprogram.Stats
        resolve({
          size: s.size,
          lastModifiedTime: s.lastModifiedTime,
        })
      },
      fail: reject,
    })
  })
}

export function readdir(dirPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    fs.readdir({
      dirPath,
      success: (res) => resolve(res.files),
      fail: reject,
    })
  })
}

/** 将临时文件保存到用户文件目录（用于下载图片落地缓存） */
export function saveFile(tempFilePath: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.saveFile({
      tempFilePath,
      filePath,
      success: () => resolve(),
      fail: reject,
    })
  })
}

/** 同步读取 Storage（仅限轻量偏好） */
export function getStorage<T>(key: string): T | undefined {
  try {
    return wx.getStorageSync(key) as T
  } catch {
    return undefined
  }
}

/** 同步写入 Storage（仅限轻量偏好） */
export function setStorage(key: string, value: unknown): void {
  wx.setStorageSync(key, value)
}

/** 删除轻量偏好；用于用户关闭记住密码或主动清除授权 */
export function removeStorage(key: string): void {
  wx.removeStorageSync(key)
}
