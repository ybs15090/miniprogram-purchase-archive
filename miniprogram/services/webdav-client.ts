// services/webdav-client.ts
// 坚果云 WebDAV 客户端：仅使用 HEAD/GET/PUT/DELETE（PROPFIND/MKCOL 已被真机确认不可用）。
// 本文件只负责远程文件操作与本地文件摘要，不包含备份/恢复业务编排。

import type { RemoteManifest } from '../models/backup'
import { readBinaryFile } from '../storage/local-storage'
import { sha256Hex } from '../utils/sha256'

export interface WebDavConfig {
  /** 服务器地址，如 https://dav.jianguoyun.com/dav/ */
  serverUrl: string
  /** 远程目录名（须由用户在坚果云预先创建），如 PurchaseArchive */
  remoteDir: string
  /** 坚果云账号邮箱 */
  username: string
  /** 应用密码（仅内存，不落盘，除非用户开启"记住应用密码"） */
  appPassword: string
}

export interface WebDavConnectionResult {
  ok: boolean
  statusCode: number
  message: string
}

export interface WebDavFileStat {
  size: number
  sha256: string
}

export interface WebDavClient {
  checkConnection(): Promise<WebDavConnectionResult>
  putText(name: string, content: string): Promise<void>
  getText(name: string): Promise<string>
  deleteText(name: string): Promise<void>
  downloadFile(name: string, filePath: string): Promise<void>
  getFileStat(filePath: string): Promise<WebDavFileStat>
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function utf8Bytes(str: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    let code = str.codePointAt(i)
    if (code === undefined) break
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

interface RequestResult {
  statusCode: number
  data: string
}

class WebDavClientImpl implements WebDavClient {
  private readonly config: WebDavConfig

  constructor(config: WebDavConfig) {
    this.config = config
  }

  private authHeader(): Record<string, string> {
    const token = base64Encode(`${this.config.username}:${this.config.appPassword}`)
    return { Authorization: `Basic ${token}` }
  }

  private fileUrl(name: string): string {
    const base = this.config.serverUrl.endsWith('/') ? this.config.serverUrl : `${this.config.serverUrl}/`
    const dir = this.config.remoteDir.replace(/^\/+|\/+$/g, '')
    return dir ? `${base}${dir}/${name}` : `${base}${name}`
  }

  private async request(
    method: 'HEAD' | 'GET' | 'PUT' | 'DELETE',
    url: string,
    data?: string,
  ): Promise<RequestResult> {
    try {
      return await this.doRequest(method, url, data)
    } catch {
      // HTTP 状态码仍由 doRequest 正常返回，仅 wx.request 网络层 fail 会进入重试。
      return this.doRequest(method, url, data)
    }
  }

  private doRequest(
    method: 'HEAD' | 'GET' | 'PUT' | 'DELETE',
    url: string,
    data?: string,
  ): Promise<RequestResult> {
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method,
        dataType: 'text',
        header: {
          ...this.authHeader(),
          ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        data: data as string | undefined,
        success: (res) => {
          const statusCode = res.statusCode
          const body =
            typeof res.data === 'string'
              ? res.data
              : res.data === undefined
                ? ''
                : JSON.stringify(res.data)
          resolve({ statusCode, data: body })
        },
        fail: (err) => reject(new Error(err.errMsg)),
      })
    })
  }

  async checkConnection(): Promise<WebDavConnectionResult> {
    try {
      // 用 GET manifest-a.json 代替 HEAD 目录：与实际传输一致，避免坚果云对目录 HEAD 返回 401
      const res = await this.request('GET', this.fileUrl('manifest-a.json'))
      if (res.statusCode === 200) {
        return { ok: true, statusCode: res.statusCode, message: '连接成功' }
      }
      if (res.statusCode === 404) {
        return { ok: true, statusCode: res.statusCode, message: '连接正常，云端暂无备份（或目录未创建）' }
      }
      if (res.statusCode === 401 || res.statusCode === 403) {
        return { ok: false, statusCode: res.statusCode, message: '认证失败，请检查账号或应用密码' }
      }
      return { ok: false, statusCode: res.statusCode, message: `连接失败，状态码 ${res.statusCode}` }
    } catch (error) {
      return {
        ok: false,
        statusCode: 0,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async putText(name: string, content: string): Promise<void> {
    const res = await this.request('PUT', this.fileUrl(name), content)
    if (res.statusCode !== 200 && res.statusCode !== 201 && res.statusCode !== 204) {
      throw new Error(`上传失败，状态码 ${res.statusCode}`)
    }
  }

  async getText(name: string): Promise<string> {
    const res = await this.request('GET', this.fileUrl(name))
    if (res.statusCode !== 200) {
      throw new Error(`下载失败，状态码 ${res.statusCode}`)
    }
    return res.data
  }

  async deleteText(name: string): Promise<void> {
    const res = await this.request('DELETE', this.fileUrl(name))
    if (res.statusCode !== 200 && res.statusCode !== 204) {
      throw new Error(`删除失败，状态码 ${res.statusCode}`)
    }
  }

  async downloadFile(name: string, filePath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      wx.downloadFile({
        url: this.fileUrl(name),
        filePath,
        header: this.authHeader(),
        success: (res) => {
          if (res.statusCode === 200) resolve()
          else reject(new Error(`下载失败，状态码 ${res.statusCode}`))
        },
        fail: (err) => reject(new Error(err.errMsg)),
      })
    })
  }

  async getFileStat(filePath: string): Promise<WebDavFileStat> {
    const buffer = await readBinaryFile(filePath)
    return { size: buffer.byteLength, sha256: sha256Hex(buffer) }
  }
}

/** 创建 WebDAV 客户端（凭据由调用方在页面内存中持有） */
export function createWebDavClient(config: WebDavConfig): WebDavClient {
  return new WebDavClientImpl(config)
}

/** 解析并校验远程 manifest 结构 */
export function parseRemoteManifest(text: string): RemoteManifest | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    const v = parsed as Record<string, unknown>
    if (v.format !== 'purchase-archive-manifest') return null
    if (typeof v.schemaVersion !== 'number' || !Number.isInteger(v.schemaVersion)) return null
    if (typeof v.revision !== 'number' || !Number.isInteger(v.revision) || v.revision < 0) return null
    if (typeof v.updatedAt !== 'number' || !Number.isFinite(v.updatedAt)) return null
    if (!Array.isArray(v.backups) || !v.backups.every((it) => typeof it === 'object' && it !== null)) return null
    if (!Array.isArray(v.pendingDeletes) || !v.pendingDeletes.every((it) => typeof it === 'string')) return null
    return parsed as RemoteManifest
  } catch {
    return null
  }
}
