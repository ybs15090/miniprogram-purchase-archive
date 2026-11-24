// pages/poc/poc-image/poc-image.ts
// POC-09 图床域名 + POC-10 图片下载与本地显示 + POC-11 图片缓存管理验证页。
// 验证 downloadFile 对两个图床域名的可用性、下载文件本地落地、本地路径显示、图片解码与坏图处理。
// 离线显示、重启持久性需在真机上断网/重启后人工复核（步骤见交接报告）。

import { getUserDataPath, joinPath, mkdir, saveFile, exists, removeFile, readdir } from '../../../storage/local-storage'
import { formatDateTime, now } from '../../../utils/date'

type LogStatus = 'ok' | 'fail' | 'info'

interface LogEntry {
  time: string
  title: string
  status: LogStatus
  detail: string
}

const IMAGE_URLS = {
  gcore: 'https://gcore.jsdelivr.net/gh/ybs15090/ybs-tuchuang-1@main/img/202610/20261025-1-demo-02.png',
  raw: 'https://raw.githubusercontent.com/ybs15090/ybs-tuchuang-1/main/img/202610/20261025-2-AI-01.png',
  notExist: 'https://gcore.jsdelivr.net/gh/ybs15090/ybs-tuchuang-1@main/img/202610/not-exist-xxx.png',
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null) {
    const anyErr = e as { errno?: number; errMsg?: string }
    return [anyErr.errno !== undefined ? `errno=${anyErr.errno}` : '', anyErr.errMsg || '']
      .filter(Boolean)
      .join(' | ')
  }
  return String(e)
}

function downloadFile(url: string): Promise<{ statusCode: number; tempFilePath: string }> {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode === 200) {
          resolve({ statusCode: res.statusCode, tempFilePath: res.tempFilePath })
        } else {
          reject(new Error(`status=${res.statusCode}`))
        }
      },
      fail: reject,
    })
  })
}

Page({
  data: {
    downloaded: { gcore: '', raw: '' },
    cachedPath: '',
    displayedSrc: '',
    logs: [] as LogEntry[],
  },

  addLog(title: string, status: LogStatus, detail: string) {
    const entry: LogEntry = { time: formatDateTime(now()), title, status, detail }
    this.setData({ logs: [entry, ...this.data.logs].slice(0, 200) })
  },

  async testDownloadGcore() {
    this.addLog('downloadFile(gcore)', 'info', IMAGE_URLS.gcore)
    try {
      const res = await downloadFile(IMAGE_URLS.gcore)
      this.setData({ 'downloaded.gcore': res.tempFilePath })
      this.addLog('downloadFile(gcore)', 'ok', `status=${res.statusCode}, temp=${res.tempFilePath}`)
    } catch (e) {
      this.addLog('downloadFile(gcore)', 'fail', errText(e))
    }
  },

  async testDownloadRaw() {
    this.addLog('downloadFile(raw)', 'info', IMAGE_URLS.raw)
    try {
      const res = await downloadFile(IMAGE_URLS.raw)
      this.setData({ 'downloaded.raw': res.tempFilePath })
      this.addLog('downloadFile(raw)', 'ok', `status=${res.statusCode}, temp=${res.tempFilePath}`)
    } catch (e) {
      this.addLog('downloadFile(raw)', 'fail', errText(e))
    }
  },

  async testSaveCache() {
    const tmp = this.data.downloaded.gcore || this.data.downloaded.raw
    if (!tmp) {
      this.addLog('保存缓存', 'fail', '请先执行 downloadFile 下载')
      return
    }
    try {
      const cacheDir = joinPath(getUserDataPath(), 'image-cache')
      await mkdir(cacheDir)
      const target = joinPath(cacheDir, `poc-${now()}.png`)
      await saveFile(tmp, target)
      this.setData({ cachedPath: target })
      this.addLog('保存缓存', 'ok', `local=${target}`)
    } catch (e) {
      this.addLog('保存缓存', 'fail', errText(e))
    }
  },

  testShowLocal() {
    if (!this.data.cachedPath) {
      this.addLog('本地显示', 'fail', '请先执行保存缓存')
      return
    }
    this.setData({ displayedSrc: this.data.cachedPath })
    this.addLog('本地显示', 'info', `已设置 image.src=${this.data.cachedPath}`)
  },

  testGetImageInfo() {
    const src = this.data.cachedPath || this.data.downloaded.gcore
    if (!src) {
      this.addLog('图片信息', 'fail', '请先下载或保存缓存')
      return
    }
    wx.getImageInfo({
      src,
      success: (res) => {
        this.addLog('图片信息', 'ok', `${res.width}x${res.height}, type=${res.type}, path=${res.path.slice(-40)}`)
      },
      fail: (e) => {
        this.addLog('图片信息', 'fail', errText(e))
      },
    })
  },

  async testBadImage() {
    this.addLog('坏图处理(404)', 'info', IMAGE_URLS.notExist)
    try {
      await downloadFile(IMAGE_URLS.notExist)
      this.addLog('坏图处理(404)', 'fail', '返回 200，不符合预期（CDN 可能返回 HTML）')
    } catch (e) {
      this.addLog('坏图处理(404)', 'ok', `被拒绝：${errText(e)}`)
    }
  },

  async testClearCache() {
    const cacheDir = joinPath(getUserDataPath(), 'image-cache')
    try {
      if (!(await exists(cacheDir))) {
        this.addLog('清理缓存', 'ok', '缓存目录不存在，无需清理')
        return
      }
      const files = await readdir(cacheDir)
      for (const f of files) {
        await removeFile(joinPath(cacheDir, f))
      }
      this.setData({ cachedPath: '', displayedSrc: '' })
      this.addLog('清理缓存', 'ok', `已删除 ${files.length} 个文件`)
    } catch (e) {
      this.addLog('清理缓存', 'fail', errText(e))
    }
  },
})
