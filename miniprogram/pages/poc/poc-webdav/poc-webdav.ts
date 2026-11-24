// pages/poc/poc-webdav/poc-webdav.ts
// POC-06 WebDAV 域名/TLS + POC-07 认证/方法 + POC-08 manifest 前置验证页。
// 安全约束：应用密码仅存于页面内存 data，不写入 Storage、不写入日志、不进入导出/备份。
//           Authorization 请求头不记录到日志；日志只记录 URL（不含凭据）、method、状态码、脱敏错误。
// 本页所有结果须在“合法域名校验开启 + 真实微信客户端”下验证，开发者工具关闭 urlCheck 不作为结论。

import { formatDateTime, now } from '../../../utils/date'

type LogStatus = 'ok' | 'fail' | 'info'

interface LogEntry {
  time: string
  title: string
  status: LogStatus
  detail: string
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function utf8Bytes(str: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    let code = str.codePointAt(i) as number
    if (code > 0xffff) i++
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return bytes
}

function base64Encode(str: string): string {
  const bytes = utf8Bytes(str)
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    result += B64_CHARS[b0 >> 2]
    result += B64_CHARS[((b0 & 0x3) << 4) | (b1 >> 4)]
    result += i + 1 < bytes.length ? B64_CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] : '='
    result += i + 2 < bytes.length ? B64_CHARS[b2 & 0x3f] : '='
  }
  return result
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

function joinUrl(base: string, ...parts: string[]): string {
  return `${base.replace(/\/+$/, '')}/${parts.filter((p) => p.length > 0).join('/')}`
}

type StandardMethod = 'OPTIONS' | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'TRACE' | 'CONNECT'

function rawRequest(opts: {
  url: string
  method: StandardMethod
  auth: string
  data?: string
}): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: opts.url,
      method: opts.method,
      header: { Authorization: opts.auth },
      data: opts.data,
      success: (res) => {
        const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
        resolve({ statusCode: res.statusCode, data: body })
      },
      fail: reject,
    })
  })
}

/** PROPFIND / MKCOL 不在 wx.request 公开方法类型中，用类型断言验证运行时是否接受 */
function rawRequestNonStandard(opts: {
  url: string
  method: string
  auth: string
}): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: opts.url,
      method: opts.method as StandardMethod,
      header: { Authorization: opts.auth },
      success: (res) => {
        const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
        resolve({ statusCode: res.statusCode, data: body })
      },
      fail: reject,
    })
  })
}

Page({
  data: {
    webdavBase: 'https://dav.jianguoyun.com/dav/',
    webdavAccount: '',
    webdavPassword: '',
    remoteDir: 'PurchaseArchive',
    probeFile: '',
    logs: [] as LogEntry[],
  },

  onInputBase(e: WechatMiniprogram.Input) {
    this.setData({ webdavBase: e.detail.value })
  },
  onInputAccount(e: WechatMiniprogram.Input) {
    this.setData({ webdavAccount: e.detail.value })
  },
  onInputPassword(e: WechatMiniprogram.Input) {
    this.setData({ webdavPassword: e.detail.value })
  },
  onInputDir(e: WechatMiniprogram.Input) {
    this.setData({ remoteDir: e.detail.value })
  },

  addLog(title: string, status: LogStatus, detail: string) {
    const entry: LogEntry = { time: formatDateTime(now()), title, status, detail }
    this.setData({ logs: [entry, ...this.data.logs].slice(0, 200) })
  },

  buildAuth(): string {
    const { webdavAccount, webdavPassword } = this.data
    return `Basic ${base64Encode(`${webdavAccount}:${webdavPassword}`)}`
  },

  async testConnection() {
    const url = joinUrl(this.data.webdavBase, this.data.remoteDir)
    this.addLog('测试连接(HEAD)', 'info', url)
    try {
      const res = await rawRequest({ url, method: 'HEAD', auth: this.buildAuth() })
      this.addLog('测试连接(HEAD)', 'ok', `status=${res.statusCode}`)
    } catch (e) {
      this.addLog('测试连接(HEAD)', 'fail', errText(e))
    }
  },

  async testPut() {
    const name = `poc-probe-${now()}.txt`
    const url = joinUrl(this.data.webdavBase, this.data.remoteDir, name)
    this.addLog('PUT 上传探测', 'info', url)
    try {
      const res = await rawRequest({
        url,
        method: 'PUT',
        auth: this.buildAuth(),
        data: `probe-${now()}`,
      })
      this.setData({ probeFile: name })
      this.addLog('PUT 上传探测', 'ok', `status=${res.statusCode}`)
    } catch (e) {
      this.addLog('PUT 上传探测', 'fail', errText(e))
    }
  },

  async testGet() {
    if (!this.data.probeFile) {
      this.addLog('GET 下载探测', 'fail', '请先执行 PUT 上传探测')
      return
    }
    const url = joinUrl(this.data.webdavBase, this.data.remoteDir, this.data.probeFile)
    this.addLog('GET 下载探测', 'info', url)
    try {
      const res = await rawRequest({ url, method: 'GET', auth: this.buildAuth() })
      this.addLog('GET 下载探测', 'ok', `status=${res.statusCode}, body=${res.data.slice(0, 80)}`)
    } catch (e) {
      this.addLog('GET 下载探测', 'fail', errText(e))
    }
  },

  async testDelete() {
    if (!this.data.probeFile) {
      this.addLog('DELETE 删除探测', 'fail', '请先执行 PUT 上传探测')
      return
    }
    const url = joinUrl(this.data.webdavBase, this.data.remoteDir, this.data.probeFile)
    this.addLog('DELETE 删除探测', 'info', url)
    try {
      const res = await rawRequest({ url, method: 'DELETE', auth: this.buildAuth() })
      this.addLog('DELETE 删除探测', 'ok', `status=${res.statusCode}`)
    } catch (e) {
      this.addLog('DELETE 删除探测', 'fail', errText(e))
    }
  },

  async testPropfind() {
    const url = joinUrl(this.data.webdavBase, this.data.remoteDir)
    this.addLog('PROPFIND 能力边界', 'info', url)
    try {
      const res = await rawRequestNonStandard({ url, method: 'PROPFIND', auth: this.buildAuth() })
      this.addLog('PROPFIND 能力边界', 'ok', `status=${res.statusCode}, body=${res.data.slice(0, 120)}`)
    } catch (e) {
      this.addLog('PROPFIND 能力边界', 'fail', errText(e))
    }
  },

  async testMkcol() {
    const url = joinUrl(this.data.webdavBase, this.data.remoteDir, `poc-mkcol-${now()}`)
    this.addLog('MKCOL 能力边界', 'info', url)
    try {
      const res = await rawRequestNonStandard({ url, method: 'MKCOL', auth: this.buildAuth() })
      this.addLog('MKCOL 能力边界', 'ok', `status=${res.statusCode}`)
    } catch (e) {
      this.addLog('MKCOL 能力边界', 'fail', errText(e))
    }
  },
})
